import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.js';
import { applySchema,createStore } from '../src/store.js';
import { createControlStore } from '../src/control-store.js';
import { createToolsStore,ToolsError } from '../src/tools-store.js';
import { createGovernanceService } from '../src/governance-service.js';
import { readConfiguration } from '../src/configuration-history.js';
import { isAllowedUrl } from '../src/policy.js';
import { TelegramError } from '../src/telegram.js';

const GROUP=-1001100,SOURCE=-1002200,ADMIN=102,OTHER_ADMIN=103,MEMBER=104,BOT=900;
const START=Date.UTC(2026,9,22,12)/1000;
const actor={id:ADMIN,is_bot:false};
const code=expected=>error=>error instanceof ToolsError&&error.code===expected;

async function fixture(t) {
  const db=new TestD1();t.after(()=>db.close());await applySchema(db);
  const store=createToolsStore(db),control=createControlStore(db),base=createStore(db);
  await store.ensure();await control.ensure();await base.group(GROUP);await base.group(SOURCE);
  const roles=new Map(),calls=[],hooks=new Map();let now=START,sequence=0,omitFalse=false;
  let permissions={can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true,can_invite_users:true,can_change_info:false,can_pin_messages:false,can_manage_topics:false};
  const api={async call(method,params={}){
    calls.push({method,params:structuredClone(params)});
    if(hooks.has(method))return hooks.get(method)(params);
    if(method==='getMe')return {id:BOT,is_bot:true};
    if(method==='getChatMember')return roles.get(`${params.chat_id}:${params.user_id}`)||{status:[ADMIN,OTHER_ADMIN,BOT].includes(params.user_id)?'administrator':'member',can_restrict_members:true};
    if(method==='getChat')return {id:params.chat_id,type:'supergroup',title:'Group',permissions:omitFalse?Object.fromEntries(Object.entries(permissions).filter(([,value])=>value)):structuredClone(permissions)};
    if(method==='setChatPermissions'){permissions=structuredClone(params.permissions);return true;}
    throw new Error(`Unexpected call ${method}`);
  }};
  const service=createGovernanceService({db,api,clock:()=>now});
  const perform=(action,input={},extra={})=>service.perform({actor,chatId:GROUP,action,input,requestId:`governance_request_${++sequence}`,...extra});
  return {db,store,control,base,service,api,roles,calls,hooks,perform,now:()=>now,advance:n=>{now+=n;},omitFalse:value=>{omitFalse=value;},permissions:()=>structuredClone(permissions),setPermissions:value=>{permissions=structuredClone(value);},query:(view='governance',input={},extra={})=>service.query({actor,chatId:GROUP,view,input,...extra}),lockdown:()=>store.first('SELECT * FROM pilot_raid_lockdowns WHERE chat_id=?',String(GROUP)),permissionCalls:()=>calls.filter(item=>item.method==='setChatPermissions')};
}

test('governance reads, previews, writes and replays require current admin authority',async t=>{
  const f=await fixture(t),input={url:'https://example.org/event',expiresAt:f.now()+3600},requestId='governance_authority_replay';
  await f.perform('temp_link_add',input,{requestId});f.roles.set(`${GROUP}:${ADMIN}`,{status:'member'});
  await assert.rejects(f.query(),code('forbidden'));
  await assert.rejects(f.query('config_preview',{presetId:'study'}),code('forbidden'));
  await assert.rejects(f.perform('temp_link_add',input,{requestId}),code('forbidden'));
  await assert.rejects(f.query('governance',{}, {actor:{id:ADMIN,is_bot:true}}),code('unauthorized'));
});

test('configuration preview must match current settings at apply time',async t=>{
  const f=await fixture(t),selection={presetId:'study',sections:['settings']};
  const preview=await f.query('config_preview',selection);
  assert.ok(preview.changes.some(item=>item.key==='flood_enabled'));
  await f.control.run('INSERT INTO pilot_group_settings(chat_id,settings_json,updated_at) VALUES(?,?,?)',String(GROUP),JSON.stringify({rules_en:'New human decision'}),f.now());
  await assert.rejects(f.perform('config_apply',{...selection,expectedHash:preview.expectedHash,confirmed:true}),code('configuration_changed'));
  assert.equal((await f.control.settings(GROUP)).rules_en,'New human decision');
  const fresh=await f.query('config_preview',selection);
  await f.perform('config_apply',{...selection,expectedHash:fresh.expectedHash,confirmed:true});
  assert.equal((await f.control.settings(GROUP)).flood_enabled,true);
  assert.equal((await f.control.settings(GROUP)).flood_action,'delete');
});

test('copy preview and apply recheck source authority and source changes',async t=>{
  const f=await fixture(t);
  await f.control.run('INSERT INTO pilot_group_settings(chat_id,settings_json,updated_at) VALUES(?,?,?)',String(SOURCE),JSON.stringify({rules_en:'Source rules'}),f.now());
  const selection={sourceChatId:SOURCE,sections:['settings']},preview=await f.query('config_preview',selection);
  f.roles.set(`${SOURCE}:${ADMIN}`,{status:'member'});
  await assert.rejects(f.perform('config_apply',{...selection,expectedHash:preview.expectedHash,confirmed:true}),code('forbidden'));
  f.roles.delete(`${SOURCE}:${ADMIN}`);
  await f.control.run('UPDATE pilot_group_settings SET settings_json=? WHERE chat_id=?',JSON.stringify({rules_en:'Source changed'}),String(SOURCE));
  await assert.rejects(f.perform('config_apply',{...selection,expectedHash:preview.expectedHash,confirmed:true}),code('configuration_changed'));
  const fresh=await f.query('config_preview',selection);
  await f.perform('config_apply',{...selection,expectedHash:fresh.expectedHash,confirmed:true});
  assert.equal((await f.control.settings(GROUP)).rules_en,'Source changed');
});

test('configuration restore returns selected settings without changing penalties or owner state',async t=>{
  const f=await fixture(t),before=await readConfiguration(f.db,GROUP);
  await f.base.run('INSERT INTO members(chat_id,user_id,strikes,last_incident,active_until,override_at) VALUES(?,?,?,?,?,?)',String(GROUP),String(MEMBER),2,'existing-case',f.now()+7*86400,f.now()-1);
  await f.base.settings({owner_telegram_id:'102',ready:'1'});
  const penalties=await f.base.first('SELECT * FROM members WHERE chat_id=?',String(GROUP));
  const selected={presetId:'business',sections:['settings']},preview=await f.query('config_preview',selected);
  await f.perform('config_apply',{...selected,expectedHash:preview.expectedHash,confirmed:true});
  const snapshot=(await f.query()).history[0];assert.ok(snapshot.id);
  const restore={snapshotId:snapshot.id,sections:['settings','language']},restored=await f.query('config_preview',restore);
  await f.perform('config_apply',{...restore,expectedHash:restored.expectedHash,confirmed:true});
  assert.deepEqual(await readConfiguration(f.db,GROUP),before);
  assert.deepEqual(await f.base.first('SELECT * FROM members WHERE chat_id=?',String(GROUP)),penalties);
  assert.equal(await f.base.setting('owner_telegram_id'),'102');
  assert.equal(f.calls.some(item=>['banChatMember','unbanChatMember','restrictChatMember'].includes(item.method)),false);
});

test('configuration history and copy are group scoped and permit only known sections',async t=>{
  const f=await fixture(t),selection={presetId:'tech',sections:['settings']},preview=await f.query('config_preview',selection);
  await f.perform('config_apply',{...selection,expectedHash:preview.expectedHash,confirmed:true});
  const history=(await f.query()).history[0];
  await assert.rejects(f.query('config_preview',{snapshotId:history.id},{chatId:SOURCE}),code('not_found'));
  await assert.rejects(f.query('config_preview',{sourceChatId:SOURCE,sections:['members']}),code('invalid_input'));
  await assert.rejects(f.query('config_preview',{presetId:'study',sourceChatId:SOURCE}),code('invalid_input'));
  await assert.rejects(f.perform('config_apply',{...selection,expectedHash:preview.expectedHash,confirmed:false}),code('confirmation_required'));
});

test('temporary URL rules are exact, local to one group, and expire prospectively',async t=>{
  const f=await fixture(t),link='https://events.example.org/register?event=one';
  await f.perform('temp_link_add',{url:link,expiresAt:f.now()+60});
  assert.equal(isAllowedUrl(link,await f.control.rules(GROUP,f.now())),true);
  assert.equal(isAllowedUrl(link+'&other=two',await f.control.rules(GROUP,f.now())),false);
  assert.equal(isAllowedUrl(link,await f.control.rules(SOURCE,f.now())),false);
  f.advance(60);assert.equal(isAllowedUrl(link,await f.control.rules(GROUP,f.now())),false);
  assert.deepEqual((await f.query()).temporaryLinks,[]);assert.equal(f.permissionCalls().length,0);
});

test('temporary allowlist still applies when 100 permanent allowances already exist',async t=>{
  const f=await fixture(t);
  await f.db.batch(Array.from({length:100},(_,index)=>f.db.prepare('INSERT INTO pilot_whitelist_rules(id,chat_id,kind,value,created_by,created_at) VALUES(?,?,?,?,?,?)').bind(`000${String(index).padStart(3,'0')}`,String(GROUP),'url',`https://permanent.example.org/${index}`,String(ADMIN),f.now())));
  const link='https://event.example.org/approved';await f.perform('temp_link_add',{url:link,expiresAt:f.now()+3600});
  const rules=await f.control.rules(GROUP,f.now());assert.equal(rules.length,101);
  assert.equal(isAllowedUrl(link,rules),true);
});

test('raid monitoring starts disabled and counts distinct accounts, with alert deduplication',async t=>{
  const f=await fixture(t),signal=(user,id)=>f.service.observeSignal({chatId:GROUP,userId:user,kind:'join',id,at:f.now()});
  for(let index=0;index<5;index++)await signal(1000+index,`disabled${index}`);
  assert.equal((await f.store.all('SELECT * FROM pilot_raid_signals')).length,0);
  await f.perform('raid_configure',{enabled:true,joinThreshold:3,spamThreshold:3,windowSeconds:60});
  await signal(2000,'a');await signal(2000,'b');await signal(2001,'c');
  assert.equal((await f.store.all('SELECT * FROM pilot_raid_alerts')).length,0);
  await signal(2002,'d');await signal(2002,'d');await signal(2003,'e');
  const alerts=await f.store.all('SELECT * FROM pilot_raid_alerts');assert.equal(alerts.length,1);assert.equal(alerts[0].count,3);
  assert.equal(f.permissionCalls().length,0);
  assert.equal(f.calls.some(item=>['banChatMember','restrictChatMember'].includes(item.method)),false);
});

test('disabling raid alerts resolves an existing activity health warning',async t=>{
  const f=await fixture(t),settings={enabled:true,joinThreshold:3,spamThreshold:3,windowSeconds:60};
  await f.perform('raid_configure',settings);
  for(let index=0;index<3;index++)await f.service.observeSignal({chatId:GROUP,userId:1000+index,kind:'spam',id:String(index),at:f.now()});
  f.advance(1);await f.perform('raid_configure',{...settings,enabled:false});
  const health=await f.store.first("SELECT * FROM pilot_health_events WHERE chat_id=? AND kind='raid_activity'",String(GROUP));
  assert.ok(health.resolved_at>0);
});

test('temporary lockdown restores semantic permissions when Telegram omits false fields',async t=>{
  const f=await fixture(t),before=f.permissions();f.omitFalse(true);
  await f.perform('raid_lockdown',{minutes:1,confirmed:true});assert.equal((await f.lockdown()).status,'active');
  assert.equal(f.permissions().can_send_messages,false);assert.equal(f.permissions().can_invite_users,true);
  f.advance(60);await f.service.drain(GROUP);
  assert.equal((await f.lockdown()).status,'restored');assert.equal(f.permissionCalls().length,2);
  for(const [key,value] of Object.entries(before))assert.equal(f.permissions()[key]??false,value);
});

test('automatic permission restoration respects later human changes',async t=>{
  const f=await fixture(t);await f.perform('raid_lockdown',{minutes:1,confirmed:true});
  f.setPermissions({...f.permissions(),can_invite_users:false});const humanDecision=f.permissions();
  f.advance(60);await f.service.drain(GROUP);
  assert.equal((await f.lockdown()).status,'admin_override');assert.deepEqual(f.permissions(),humanDecision);assert.equal(f.permissionCalls().length,1);
});

test('a reviewed ambiguous restore can be resolved by a current admin',async t=>{
  const f=await fixture(t),before=f.permissions();await f.perform('raid_lockdown',{minutes:1,confirmed:true});
  f.hooks.set('setChatPermissions',()=>{throw new TelegramError('timeout',0,true);});f.advance(60);
  await assert.rejects(f.service.drain(GROUP));assert.equal((await f.lockdown()).status,'review');
  f.hooks.delete('setChatPermissions');
  const restored=await f.perform('raid_restore',{confirmed:true},{actor:{id:OTHER_ADMIN}});
  assert.equal(restored.status,'restored');assert.equal((await f.lockdown()).status,'restored');
  for(const [key,value] of Object.entries(before))assert.equal(f.permissions()[key]??false,value);
  await f.perform('raid_lockdown',{minutes:1,confirmed:true});assert.equal((await f.lockdown()).status,'active');
});

test('demoted lockdown creator requires a current admin to resolve the locked state',async t=>{
  const f=await fixture(t);await f.perform('raid_lockdown',{minutes:1,confirmed:true});
  f.roles.set(`${GROUP}:${ADMIN}`,{status:'member'});f.advance(60);await f.service.drain(GROUP);
  assert.equal((await f.lockdown()).status,'review');assert.equal(f.permissionCalls().length,1);
  await f.perform('raid_restore',{confirmed:true},{actor:{id:OTHER_ADMIN}});
  assert.equal((await f.lockdown()).status,'restored');assert.equal(f.permissionCalls().length,2);
});

test('lockdown writes require confirmation, bot permission, and never duplicate on replay',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.perform('raid_lockdown',{minutes:1,confirmed:false}),code('confirmation_required'));
  f.roles.set(`${GROUP}:${BOT}`,{status:'administrator',can_restrict_members:false});
  await assert.rejects(f.perform('raid_lockdown',{minutes:1,confirmed:true}),code('missing_permissions'));
  f.roles.delete(`${GROUP}:${BOT}`);
  const input={minutes:1,confirmed:true},requestId='governance_lockdown_replay';
  await f.perform('raid_lockdown',input,{requestId});const replay=await f.perform('raid_lockdown',input,{requestId});
  assert.equal(replay.duplicate,true);assert.equal(f.permissionCalls().length,1);
});
