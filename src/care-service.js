import { createStore } from './store.js';
import { createControlStore } from './control-store.js';
import { normalizeSettings } from './control-service.js';
import { analyzeMessage, banDuration, normalizeWhitelistRule } from './policy.js';
import { detectCommandSpam } from './command-spam.js';
import { createPerformanceService } from './performance-service.js';
import { fail, objectKeys, validActor, validChat, isAdmin, textValue } from './tools-store.js';

export const CARE_READS=new Set(['doctor','policy_test','performance']);
export const CARE_ACTIONS=new Set(['performance_settings']);
export const GROUP_PICKER_ID=73021;
export function groupPicker(language='en') {
  const rights={is_anonymous:false,can_manage_chat:true,can_delete_messages:true,can_manage_video_chats:false,can_restrict_members:true,can_promote_members:false,can_change_info:false,can_invite_users:false,can_post_stories:false,can_edit_stories:false,can_delete_stories:false,can_send_welcome_messages:false};
  return {keyboard:[[{text:language==='sw'?'Chagua group langu':'Choose my group',request_chat:{request_id:GROUP_PICKER_ID,chat_is_channel:false,user_administrator_rights:rights,bot_administrator_rights:rights,request_title:true}}]],resize_keyboard:true,one_time_keyboard:true,input_field_placeholder:language==='sw'?'Chagua group unalosimamia':'Choose a group you manage'};
}

export function simulatePolicy({input,settings,rules,enabled=true}) {
  objectKeys(input,['text','caption','forwarded','sender','priorStrikes','format','proposedSettings','extraRules','messagesInWindow']);
  const text=textValue(input.text??'',4096,true),caption=textValue(input.caption??'',1024,true);
  if(!text&&!caption&&!input.forwarded)fail('invalid_input');
  if(input.forwarded!==undefined&&typeof input.forwarded!=='boolean')fail('invalid_input');
  const sender=input.sender??'member',priorStrikes=input.priorStrikes??0,format=input.format??'plain';
  if(!['member','admin','anonymous_admin','linked_channel'].includes(sender)||!Number.isInteger(priorStrikes)||priorStrikes<0||priorStrikes>100||!['plain','code'].includes(format))fail('invalid_input');
  if(input.messagesInWindow!==undefined&&(!Number.isInteger(input.messagesInWindow)||input.messagesInWindow<1||input.messagesInWindow>100))fail('invalid_input');
  const proposed=input.proposedSettings===undefined?settings:{...settings,...normalizeSettings(input.proposedSettings)};
  let effectiveRules=rules;
  if(input.extraRules!==undefined){if(!Array.isArray(input.extraRules)||input.extraRules.length>20)fail('invalid_input');try{effectiveRules=[...rules,...input.extraRules.map(normalizeWhitelistRule)];}catch{fail('invalid_rule');}}
  const message={text,caption,...(input.forwarded?{forward_origin:{type:'user',date:1,sender_user:{id:1}}}:{})};
  if(format==='code'){if(text)message.entities=[{type:'code',offset:0,length:text.length}];if(caption)message.caption_entities=[{type:'code',offset:0,length:caption.length}];}
  const output={simulated:true,scenario:{sender,priorStrikes},decision:'allow',reasons:[],strike:null,durationSeconds:null,usesProposedSettings:!!input.proposedSettings||!!input.extraRules,conditions:['current_member','fresh_admin_check','bot_permissions','message_age','human_overrides']};
  if(sender!=='member')return {...output,decision:'exempt',reasons:[sender]};
  if(!enabled)return {...output,decision:'paused',reasons:['moderation_paused']};
  const analyzed=analyzeMessage(message,effectiveRules);
  if(analyzed.reasons.length){const strike=Math.min(3,priorStrikes+1);return {...output,decision:'delete_and_ban',reasons:analyzed.reasons,strike,durationSeconds:banDuration(strike),blockedLinks:analyzed.blockedLinks.length};}
  const spam=detectCommandSpam(message,proposed.command_spam_allowlist||'');
  if(spam)return {...output,decision:proposed.command_spam_enabled===false?'allow':'delete_only',reasons:[proposed.command_spam_enabled===false?'command_filter_off':'command_spam']};
  if(proposed.flood_enabled&&input.messagesInWindow>proposed.flood_limit)return {...output,decision:proposed.flood_action==='mute'?'delete_and_mute':'delete_only',reasons:['flood'],durationSeconds:proposed.flood_action==='mute'?proposed.flood_mute_seconds:null};
  return output;
}

export function createCareService({db,api,owner,clock=()=>Math.floor(Date.now()/1000)}) {
  const base=createStore(db),control=createControlStore(db),performance=createPerformanceService({db,api,owner,clock});
  const member=(chat,user)=>api.call('getChatMember',{chat_id:Number(chat),user_id:Number(user)});
  async function authorize(actor,chatId) {const user=validActor(actor),chat=validChat(chatId);let role;try{role=await member(chat,user);}catch{fail('authorization_unavailable',503);}if(!isAdmin(role))fail('forbidden',403);return chat;}
  async function doctor(actor,chatId) {
    const chat=await authorize(actor,chatId);
    const [bot,info]=await Promise.all([api.call('getMe'),api.call('getChat',{chat_id:Number(chat)})]);
    if(!['group','supergroup'].includes(info?.type)||String(info.id)!==chat)fail('invalid_chat');
    const [own,settings]=await Promise.all([member(chat,bot.id),control.settings(chat)]);
    await base.ensureExtras();
    const [group,notice,ready]=await Promise.all([base.first('SELECT enabled FROM groups WHERE chat_id=?',chat),base.latestNotice(chat),base.setting('ready')]);
    const admin=isAdmin(own),checks=[
      {id:'connection',status:admin?'ready':'needs_attention',fix:'add_admin'},
      {id:'supergroup',status:info.type==='supergroup'?'ready':'needs_attention',fix:'supergroup'},
      {id:'delete',status:admin&&!!own.can_delete_messages?'ready':'needs_attention',fix:'delete_messages'},
      {id:'restrict',status:admin&&!!own.can_restrict_members?'ready':'needs_attention',fix:'ban_users'},
      {id:'moderation',status:ready==='1'&&group?.enabled!==0?'ready':'needs_attention',fix:ready==='1'?'resume':'owner_setup'},
      {id:'command_spam',status:settings.command_spam_enabled?'ready':'off',fix:'settings'},
      {id:'join_screening',status:!settings.join_gate_enabled?'off':admin&&!!own.can_invite_users?'ready':'needs_attention',fix:'invite_users'},
      ...(settings.join_gate_enabled?[{id:'join_requests',status:info.join_by_request===true?'ready':'manual',fix:'join_requests'}]:[]),
      {id:'notices',status:!notice?'unobserved':['failed','unknown'].includes(notice.status)?'needs_attention':notice.status==='sent'?'ready':'pending',fix:'notice_delivery'},
    ];
    return {ok:true,checkedAt:clock(),group:{id:chat,title:String(info.title||'').slice(0,128),type:info.type},ready:checks.every(c=>c.status!=='needs_attention'),checks,notice:notice?{status:notice.status,updatedAt:notice.updated_at}:null};
  }
  async function acceptShared(message) {
    if(message.chat?.type!=='private'||message.sender_chat||Number(message.chat.id)!==message.from?.id||message.chat_shared?.request_id!==GROUP_PICKER_ID)fail('invalid_request');
    const chat=await authorize(message.from,message.chat_shared.chat_id);
    await base.ensureExtras();await control.rememberAdmin(message.from.id,chat,clock());await base.setAdminContext(message.from.id,chat,clock());
    return doctor(message.from,chat);
  }
  async function query(payload) {
    if(payload.view==='performance')return performance.query(payload);
    if(payload.view==='doctor'){objectKeys(payload.input??{},[]);return doctor(payload.actor,payload.chatId);}
    if(payload.view!=='policy_test')fail('invalid_view');
    const chat=await authorize(payload.actor,payload.chatId);
    await base.ensureExtras();
    const [settings,rules,group]=await Promise.all([control.settings(chat),control.rules(chat,clock()),base.first('SELECT enabled FROM groups WHERE chat_id=?',chat)]);
    return {ok:true,checkedAt:clock(),...simulatePolicy({input:payload.input??{},settings,rules,enabled:group?.enabled!==0})};
  }
  return {query,doctor,acceptShared,performance,perform:payload=>performance.perform(payload)};
}
