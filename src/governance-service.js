import { createToolsStore, ToolsError, fail, isAdmin, validActor, validChat, objectKeys, textValue, digest, json, stableJson } from './tools-store.js';
import { createControlStore, CONTROL_DEFAULTS } from './control-store.js';
import { normalizeSettings } from './control-service.js';
import { normalizeWhitelistRule } from './policy.js';
import { readConfiguration, rememberConfiguration } from './configuration-history.js';
import { createGuardrailStore } from './guardrail-store.js';

export const GOVERNANCE_VIEWS = new Set(['governance','config_preview','integration_drafts']);
export const GOVERNANCE_ACTIONS = new Set(['config_apply','temp_link_add','temp_link_remove','raid_configure','raid_lockdown','raid_restore','integration_create','integration_revoke','integration_draft_resolve']);
export const INTEGRATION_SCOPES = ['knowledge:read','events:read','drafts:write'];
export const CONFIG_PRESETS = [
  {id:'community',name:'Community',description:'Clear rules, a warm welcome, and delete-only command filtering.',settings:{welcome_enabled:true,notice_template:'detailed',flood_enabled:false,join_gate_enabled:false}},
  {id:'study',name:'Study group',description:'Concise notices, a welcome and gentle delete-only flood control.',settings:{welcome_enabled:true,notice_template:'compact',flood_enabled:true,flood_action:'delete',flood_limit:12,flood_window:10,join_gate_enabled:false}},
  {id:'tech',name:'Tech community',description:'Room for technical discussion, with command filtering preserved.',settings:{welcome_enabled:true,notice_template:'compact',flood_enabled:false,join_gate_enabled:false}},
  {id:'business',name:'Business community',description:'Formal notices, a welcome and manual join-request review.',settings:{welcome_enabled:true,notice_template:'formal',flood_enabled:true,flood_action:'delete',flood_limit:10,flood_window:10,join_gate_enabled:true,join_gate_mode:'review'}},
];
const publicToken = row => ({id:row.id,label:row.label,scopes:json(row.scopes_json,[]),created_at:row.created_at,expires_at:row.expires_at,revoked_at:row.revoked_at,last_used_at:row.last_used_at});
const PERMISSIONS=['can_send_messages','can_send_audios','can_send_documents','can_send_photos','can_send_videos','can_send_video_notes','can_send_voice_notes','can_send_polls','can_send_other_messages','can_add_web_page_previews','can_change_info','can_invite_users','can_pin_messages','can_manage_topics','can_react_to_messages','can_edit_tag'];
const permissions = value => {
  const known=Object.fromEntries(PERMISSIONS.map(key=>[key,typeof value?.[key]==='boolean'?value[key]:key==='can_react_to_messages'?!!value?.can_send_messages:['can_manage_topics','can_edit_tag'].includes(key)?!!value?.can_pin_messages:false]));
  return Object.fromEntries(Object.entries({...known,...Object.fromEntries(Object.entries(value||{}).filter(([key,v])=>/^can_[a-z_]+$/.test(key)&&typeof v==='boolean'))}).sort(([a],[b])=>a.localeCompare(b)));
};
const lockedPermissions = original => Object.fromEntries(Object.entries(original).map(([key,value]) => [key,/^can_send_|^can_add_web_page_previews$/.test(key) ? false : value]));
const integer = (value,min,max) => {if(!Number.isInteger(value) || value<min || value>max) fail('invalid_input');return value;};

export function createGovernanceService({db,api,clock=()=>Math.floor(Date.now()/1000)}) {
  const store=createToolsStore(db),control=createControlStore(db),guards=createGuardrailStore(db);
  async function authorize(actor,chatId) {
    const user=validActor(actor),chat=validChat(chatId);
    let member;try{member=await api.call('getChatMember',{chat_id:Number(chat),user_id:Number(user)});}catch{fail('authorization_unavailable',503);}
    if(!isAdmin(member)) fail('forbidden',403);
    await store.ensure();await control.ensure();
    await control.rememberAdmin(user,chat,clock());
    return {user,chat};
  }
  async function raidSettings(chat) {
    const row=await store.first('SELECT * FROM pilot_raid_settings WHERE chat_id=?',chat);
    return {enabled:!!row?.enabled,joinThreshold:row?.join_threshold??10,spamThreshold:row?.spam_threshold??8,windowSeconds:row?.window_seconds??60};
  }
  async function preview(chat,input,actor) {
    objectKeys(input,['presetId','sourceChatId','snapshotId','sections','expectedHash','confirmed']);
    if([input.presetId,input.sourceChatId,input.snapshotId].filter(value=>value!==undefined).length!==1) fail('invalid_input');
    const sections=input.sections??['settings','language'];
    if(!Array.isArray(sections)||!sections.length||sections.length>3||new Set(sections).size!==sections.length||sections.some(s=>!['settings','language','whitelist'].includes(s))) fail('invalid_input');
    const current=await readConfiguration(db,chat);let source,label;
    if(input.presetId!==undefined) {
      const preset=CONFIG_PRESETS.find(item=>item.id===input.presetId);if(!preset||sections.includes('whitelist')) fail('invalid_preset');
      source={settings:{...current.settings,...preset.settings},language:current.language,rules:current.rules};label=`preset:${preset.id}`;
    } else if(input.sourceChatId!==undefined) {
      const sourceChat=validChat(input.sourceChatId);if(sourceChat===chat) fail('invalid_source');
      await authorize(actor,sourceChat);source=await readConfiguration(db,sourceChat);label='copy_settings';
    } else {
      const row=await store.first('SELECT snapshot_json FROM pilot_config_history WHERE id=? AND chat_id=?',textValue(input.snapshotId,100),chat);
      if(!row) fail('not_found',404);source=json(row.snapshot_json);label='restore_settings';
    }
    if(!source||!['en','sw'].includes(source.language)||!Array.isArray(source.rules)||source.rules.length>100) fail('invalid_snapshot');
    source.settings={...CONTROL_DEFAULTS,...normalizeSettings(source.settings)};
    try{source.rules=source.rules.map(rule=>normalizeWhitelistRule(rule));}catch{fail('invalid_snapshot');}
    const proposal={...current,settings:sections.includes('settings')?source.settings:current.settings,language:sections.includes('language')?source.language:current.language,rules:sections.includes('whitelist')?source.rules:current.rules};
    const changes=[];
    for(const key of Object.keys(CONTROL_DEFAULTS)) if(stableJson(current.settings[key])!==stableJson(proposal.settings[key])) changes.push({key,before:current.settings[key],after:proposal.settings[key]});
    if(current.language!==proposal.language) changes.push({key:'language',before:current.language,after:proposal.language});
    if(stableJson(current.rules)!==stableJson(proposal.rules)) changes.push({key:'whitelist',before:current.rules,after:proposal.rules});
    return {changes,expectedHash:await digest({chat,current,proposal,sections}),proposal,label,sections};
  }
  async function query({actor,chatId,view,input={}}) {
    const {chat}=await authorize(actor,chatId);
    if(view==='config_preview'){const result=await preview(chat,input,actor);return {changes:result.changes,expectedHash:result.expectedHash};}
    objectKeys(input,[]);
    if(view==='integration_drafts') return {drafts:await store.all('SELECT id,title,text,status,created_at,reviewed_by FROM pilot_integration_drafts WHERE chat_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 50',chat,clock()-30*86400)};
    if(view!=='governance') fail('invalid_view');
    const lockdown=await store.first('SELECT status,until_at FROM pilot_raid_lockdowns WHERE chat_id=?',chat);
    return {configuration:await readConfiguration(db,chat),presets:CONFIG_PRESETS.map(({id,name,description})=>({id,name,description})),
      history:await store.all('SELECT id,label,actor_id,created_at FROM pilot_config_history WHERE chat_id=? AND created_at>=? ORDER BY created_at DESC,rowid DESC LIMIT 40',chat,clock()-90*86400),
      temporaryLinks:await store.all('SELECT id,url,expires_at,created_by FROM pilot_temporary_links WHERE chat_id=? AND expires_at>? ORDER BY expires_at LIMIT 50',chat,clock()),
      raid:{...await raidSettings(chat),lockdown,alerts:await store.all('SELECT id,kind,count,created_at FROM pilot_raid_alerts WHERE chat_id=? AND created_at>=? ORDER BY created_at DESC LIMIT 20',chat,clock()-30*86400)},
      integrations:(await store.all('SELECT * FROM pilot_integration_tokens WHERE chat_id=? ORDER BY created_at DESC LIMIT 30',chat)).map(publicToken)};
  }
  async function ownPermissions(chat) {
    let me,own,info;try{me=await api.call('getMe');own=await api.call('getChatMember',{chat_id:Number(chat),user_id:me.id});info=await api.call('getChat',{chat_id:Number(chat)});}catch{fail('permissions_unavailable',503);}
    if(!isAdmin(own)||!own.can_restrict_members||!['group','supergroup'].includes(info.type)||Number(info.id)!==Number(chat)||!info.permissions) fail('missing_permissions',409);
    const current=permissions(info.permissions);if(!Object.hasOwn(current,'can_send_messages')) fail('permissions_unavailable',503);
    return current;
  }
  async function restore(chat,{actor=null,automatic=false}={}) {
    const row=await store.first('SELECT * FROM pilot_raid_lockdowns WHERE chat_id=?',chat);
    if(!row||!['active','applying','unknown','restoring',...(!automatic?['review']:[])].includes(row.status)) return {ok:true,status:row?.status||'inactive'};
    if(row.status==='restoring'){await store.run("UPDATE pilot_raid_lockdowns SET status='review',updated_at=? WHERE chat_id=?",clock(),chat);return {ok:true,status:'review'};}
    if(automatic) {
      let role;try{role=await api.call('getChatMember',{chat_id:Number(chat),user_id:Number(row.actor_id)});}catch{return {ok:false,status:'retry'};}
      if(!isAdmin(role)){await store.run("UPDATE pilot_raid_lockdowns SET status='review',updated_at=? WHERE chat_id=?",clock(),chat);return {ok:true,status:'review'};}
    } else await authorize(actor,chat);
    const current=await ownPermissions(chat),applied=json(row.applied_json,{}),before=json(row.before_json,{});
    if(stableJson(current)!==stableJson(applied)) {
      const status=stableJson(current)===stableJson(before)?'restored':'admin_override';
      await store.run('UPDATE pilot_raid_lockdowns SET status=?,updated_at=? WHERE chat_id=?',status,clock(),chat);return {ok:true,status};
    }
    await store.run("UPDATE pilot_raid_lockdowns SET status='restoring',updated_at=? WHERE chat_id=?",clock(),chat);
    try {
      if(await api.call('setChatPermissions',{chat_id:Number(chat),permissions:before,use_independent_chat_permissions:true})!==true) throw new Error('unknown');
      await store.run("UPDATE pilot_raid_lockdowns SET status='restored',updated_at=? WHERE chat_id=?",clock(),chat);return {ok:true,status:'restored'};
    }catch(error){await store.run("UPDATE pilot_raid_lockdowns SET status='review',updated_at=? WHERE chat_id=?",clock(),chat);fail(error?.ambiguous===false?'telegram_rejected':'operation_unknown',409);}
  }
  async function perform(payload) {
    const {actor,chatId,action,input={},requestId}=payload,{user,chat}=await authorize(actor,chatId);
    if(!GOVERNANCE_ACTIONS.has(action)) fail('invalid_action');
    const duplicate=await store.claim({...payload,input},clock());if(duplicate)return duplicate;
    let sent=false;
    try {
      const now=clock();let result={ok:true},statements=[];
      if(action==='config_apply') {
        if(input.confirmed!==true)fail('confirmation_required');
        const resultPreview=await preview(chat,input,actor);
        if(typeof input.expectedHash!=='string'||input.expectedHash!==resultPreview.expectedHash)fail('configuration_changed',409);
        const {proposal,sections,label}=resultPreview;
        await rememberConfiguration(db,chat,user,label,now);
        if(sections.includes('settings'))statements.push(db.prepare('INSERT INTO pilot_group_settings(chat_id,settings_json,updated_at) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at').bind(chat,JSON.stringify(proposal.settings),now));
        if(sections.includes('language'))statements.push(db.prepare("INSERT INTO language_preferences(scope,subject_id,language,updated_at) VALUES('group',?,?,?) ON CONFLICT(scope,subject_id) DO UPDATE SET language=excluded.language,updated_at=excluded.updated_at").bind(chat,proposal.language,now));
        if(sections.includes('whitelist')){statements.push(db.prepare('DELETE FROM pilot_whitelist_rules WHERE chat_id=?').bind(chat));for(const rule of proposal.rules)statements.push(db.prepare('INSERT INTO pilot_whitelist_rules(id,chat_id,kind,value,created_by,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),chat,rule.kind,rule.value,user,now));}
        result={ok:true,changes:resultPreview.changes,configuration:proposal};
      } else if(action==='temp_link_add') {
        objectKeys(input,['url','expiresAt']);let rule;try{rule=normalizeWhitelistRule({kind:'url',value:input.url});}catch{fail('invalid_rule');}
        const expiresAt=integer(input.expiresAt,now+60,now+30*86400);
        if((await store.first('SELECT COUNT(*) AS n FROM pilot_temporary_links WHERE chat_id=? AND expires_at>?',chat,now)).n>=50)fail('temporary_link_limit',409);
        const id=crypto.randomUUID();statements.push(db.prepare('INSERT INTO pilot_temporary_links(id,chat_id,url,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(chat_id,url) DO UPDATE SET expires_at=excluded.expires_at,created_by=excluded.created_by,created_at=excluded.created_at').bind(id,chat,rule.value,expiresAt,user,now));result={ok:true,url:rule.value,expires_at:expiresAt};
      } else if(action==='temp_link_remove') {
        objectKeys(input,['id']);statements.push(db.prepare('DELETE FROM pilot_temporary_links WHERE id=? AND chat_id=?').bind(textValue(input.id,100),chat));
      } else if(action==='raid_configure') {
        objectKeys(input,['enabled','joinThreshold','spamThreshold','windowSeconds']);if(typeof input.enabled!=='boolean')fail('invalid_input');
        const joins=integer(input.joinThreshold,3,100),spam=integer(input.spamThreshold,3,100),window=integer(input.windowSeconds,30,300);
        statements.push(db.prepare('INSERT INTO pilot_raid_settings(chat_id,enabled,join_threshold,spam_threshold,window_seconds,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET enabled=excluded.enabled,join_threshold=excluded.join_threshold,spam_threshold=excluded.spam_threshold,window_seconds=excluded.window_seconds,updated_at=excluded.updated_at').bind(chat,input.enabled?1:0,joins,spam,window,now));
      } else if(action==='raid_lockdown') {
        objectKeys(input,['minutes','confirmed']);if(input.confirmed!==true)fail('confirmation_required');const minutes=integer(input.minutes,1,60);
        const existing=await store.first('SELECT status FROM pilot_raid_lockdowns WHERE chat_id=?',chat);if(existing&&['active','applying','unknown','restoring','review'].includes(existing.status))fail('lockdown_exists',409);
        const before=await ownPermissions(chat),applied=lockedPermissions(before);if(stableJson(before)===stableJson(applied))fail('already_locked',409);
        // This snapshot only changes default posting permissions, never strikes or individual bans.
        await store.run('INSERT INTO pilot_raid_lockdowns(chat_id,actor_id,before_json,applied_json,status,until_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET actor_id=excluded.actor_id,before_json=excluded.before_json,applied_json=excluded.applied_json,status=excluded.status,until_at=excluded.until_at,created_at=excluded.created_at,updated_at=excluded.updated_at',chat,user,JSON.stringify(before),JSON.stringify(applied),'applying',now+minutes*60,now,now);
        await store.run("UPDATE pilot_tool_operations SET status='sending',updated_at=? WHERE id=?",now,requestId);sent=true;
        const confirmed=await api.call('setChatPermissions',{chat_id:Number(chat),permissions:applied,use_independent_chat_permissions:true});if(confirmed!==true)fail('operation_unknown',409);
        await store.run("UPDATE pilot_raid_lockdowns SET status='active',updated_at=? WHERE chat_id=?",clock(),chat);result={ok:true,status:'active',until_at:now+minutes*60};
      } else if(action==='raid_restore') {
        objectKeys(input,['confirmed']);if(input.confirmed!==true)fail('confirmation_required');sent=true;result=await restore(chat,{actor});
      } else if(action==='integration_create') {
        objectKeys(input,['label','scopes','expiresInDays','confirmed']);if(input.confirmed!==true)fail('confirmation_required');const label=textValue(input.label,60),days=integer(input.expiresInDays,1,90);
        if(!Array.isArray(input.scopes)||!input.scopes.length||input.scopes.length>3||new Set(input.scopes).size!==input.scopes.length||input.scopes.some(scope=>!INTEGRATION_SCOPES.includes(scope)))fail('invalid_scope');
        if((await store.first('SELECT COUNT(*) AS n FROM pilot_integration_tokens WHERE chat_id=? AND revoked_at=0 AND expires_at>?',chat,now)).n>=10)fail('integration_limit',409);
        const id=crypto.randomUUID().replaceAll('-',''),bytes=crypto.getRandomValues(new Uint8Array(32)),secret=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join(''),token=`slp_${id}.${secret}`;
        const metadata={id,label,scopes:input.scopes,created_at:now,expires_at:now+days*86400,revoked_at:0};
        // Persist only a digest. A replay can recover metadata, never the token.
        await store.finish(requestId,{ok:true,integration:metadata,tokenUnavailable:true},now,[db.prepare('INSERT INTO pilot_integration_tokens(id,chat_id,actor_id,label,token_hash,scopes_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,chat,user,label,await digest(token),JSON.stringify(input.scopes),now,metadata.expires_at)]);
        await control.audit({id:`tool:${requestId}`,chatId:chat,actorId:user,action,details:{scopes:input.scopes},at:now});return {ok:true,integration:metadata,token};
      } else if(action==='integration_revoke') {
        objectKeys(input,['id','confirmed']);if(input.confirmed!==true)fail('confirmation_required');statements.push(db.prepare('UPDATE pilot_integration_tokens SET revoked_at=? WHERE id=? AND chat_id=? AND revoked_at=0').bind(now,textValue(input.id,100),chat));
      } else if(action==='integration_draft_resolve') {
        objectKeys(input,['id','decision','confirmed']);if(input.confirmed!==true)fail('confirmation_required');if(!['dismiss','approve'].includes(input.decision))fail('invalid_input');
        const id=textValue(input.id,100),row=await store.first('SELECT id FROM pilot_integration_drafts WHERE id=? AND chat_id=? AND status=\'pending\'',id,chat);if(!row)fail('not_found',404);
        statements.push(db.prepare('UPDATE pilot_integration_drafts SET status=?,reviewed_by=?,updated_at=? WHERE id=? AND chat_id=? AND status=\'pending\'').bind(input.decision==='approve'?'approved':'dismissed',user,now,id,chat));result={ok:true,id,status:input.decision==='approve'?'approved':'dismissed'};
      }
      const finished=await store.finish(requestId,result,clock(),statements);
      if(action==='raid_configure'&&!input.enabled)await guards.health(chat,'raid_activity',false,clock());
      await control.audit({id:`tool:${requestId}`,chatId:chat,actorId:user,action,details:{completed:true},at:clock()});return finished;
    }catch(error){const status=sent&&error?.ambiguous!==false?'unknown':'failed',code=error instanceof ToolsError?error.code:sent?'operation_unknown':'internal_error';
      await store.run('UPDATE pilot_tool_operations SET status=?,error_code=?,updated_at=? WHERE id=? AND status!=\'succeeded\'',status,code,clock(),requestId).catch(()=>{});
      if(action==='raid_lockdown'&&sent)await store.run("UPDATE pilot_raid_lockdowns SET status=?,updated_at=? WHERE chat_id=? AND status='applying'",error?.ambiguous===false?'failed':'unknown',clock(),chat).catch(()=>{});
      throw error instanceof ToolsError?error:new ToolsError(code,sent?409:500);
    }
  }
  async function observeSignal({chatId,userId,kind,id,at=clock()}) {
    if(!['join','spam'].includes(kind)||!Number.isSafeInteger(Number(userId))||Number(userId)<=0||at<clock()-300||at>clock()+60)return;
    const chat=validChat(chatId);await store.ensure();const settings=await raidSettings(chat);if(!settings.enabled)return;
    await store.run('INSERT OR IGNORE INTO pilot_raid_signals(id,chat_id,user_id,kind,created_at) VALUES(?,?,?,?,?)',`${chat}:${kind}:${String(id).slice(0,120)}`,chat,String(userId),kind,at);
    const count=Number((await store.first('SELECT COUNT(DISTINCT user_id) AS n FROM pilot_raid_signals WHERE chat_id=? AND kind=? AND created_at>=?',chat,kind,clock()-settings.windowSeconds)).n);
    if(count<(kind==='join'?settings.joinThreshold:settings.spamThreshold))return;
    const recent=await store.first('SELECT id FROM pilot_raid_alerts WHERE chat_id=? AND kind=? AND created_at>? LIMIT 1',chat,kind,clock()-600);if(recent)return;
    await store.run('INSERT INTO pilot_raid_alerts(id,chat_id,kind,count,created_at) VALUES(?,?,?,?,?)',crypto.randomUUID(),chat,kind,count,clock());
    await guards.health(chat,'raid_activity',true,clock());
  }
  async function drain(chatId) {const chat=validChat(chatId);await store.ensure();const row=await store.first("SELECT until_at FROM pilot_raid_lockdowns WHERE chat_id=? AND status IN ('active','applying','unknown','restoring')",chat);if(row&&row.until_at<=clock())return restore(chat,{automatic:true});return {ok:true};}
  async function nextRunAt(chatId){await store.ensure();const row=await store.first("SELECT until_at FROM pilot_raid_lockdowns WHERE chat_id=? AND status IN ('active','applying','unknown','restoring')",String(chatId));return row?.until_at??null;}
  async function nextDueGroups({limit=20}={}){await store.ensure();return (await store.all("SELECT chat_id FROM pilot_raid_lockdowns WHERE status IN ('active','applying','unknown','restoring') AND until_at<=? ORDER BY until_at LIMIT ?",clock(),Math.min(50,Math.max(1,limit)))).map(row=>row.chat_id);}
  return {query,perform,observeSignal,drain,nextRunAt,nextDueGroups,authorize,store};
}
