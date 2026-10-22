import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.js';
import { applySchema,createStore } from '../src/store.js';
import { createControlStore } from '../src/control-store.js';
import { createToolServices } from '../src/tools-api.js';
import { createToolsCommands } from '../src/tools-commands.js';
import { createModerator } from '../src/moderator.js';
import { createOwnerAuth } from '../src/owner-auth.js';
import { GROUP_PICKER_ID } from '../src/care-service.js';

const GROUP=-1001001,OTHER_GROUP=-1001002,ADMIN=102,MEMBER=101,TARGET=103,BOT=900,NOW=1792670400;
async function fixture(t) {
  const db=new TestD1();t.after(()=>db.close());await applySchema(db);
  const base=createStore(db),control=createControlStore(db);await control.ensure();
  const calls=[],roles=new Map();let sequence=100;
  const api={async call(method,params={}){
    calls.push({method,params:structuredClone(params)});
    if(method==='getMe')return {id:BOT,is_bot:true,username:'sautilinkpilotbot'};
    if(method==='getChat')return {id:params.chat_id,type:'supergroup',title:'Community',linked_chat_id:-1003001};
    if(method==='getChatMember')return roles.get(`${params.chat_id}:${params.user_id}`)||{status:[ADMIN,BOT].includes(params.user_id)?'administrator':'member',can_restrict_members:true,can_delete_messages:true,user:{id:params.user_id,is_bot:params.user_id===BOT}};
    if(method==='getChatAdministrators')return [{status:'administrator',user:{id:BOT,is_bot:true}},{status:'administrator',user:{id:ADMIN,is_bot:false}}];
    if(method==='sendMessage')return params.ephemeral_message_parameters?{message_id:0,ephemeral_message_id:++sequence}:{message_id:++sequence};
    if(method==='deleteMessage')return true;
    if(method==='banChatMember'){roles.set(`${params.chat_id}:${params.user_id}`,{status:'kicked',until_date:params.until_date});return true;}
    if(method==='restrictChatMember')return true;
    throw new Error(`Unexpected call ${method}`);
  }};
  const me=()=>api.call('getMe'),tools=createToolServices({db,api,clock:()=>NOW});
  const commands=createToolsCommands({db,api,tools,me,clock:()=>NOW});
  const moderator=createModerator({db,api,tools,clock:()=>NOW});
  const message=(text,extra={})=>({message_id:++sequence,date:NOW,chat:{id:GROUP,type:'supergroup'},from:{id:MEMBER,is_bot:false,first_name:'Juma',language_code:'en'},text,...extra});
  return {db,base,control,calls,roles,api,tools,commands,moderator,message,sends:()=>calls.filter(call=>call.method==='sendMessage'),handle:(text,extra={})=>commands.handle(message(text,extra),++sequence),update:(text,extra={})=>({update_id:++sequence,message:message(text,extra)}),requestId:()=>`tools_command_request_${++sequence}`};
}

test('flag uses the original replied-to message as evidence and never imposes a penalty',async t=>{
  const f=await fixture(t),original=f.message('Original message <text>',{from:{id:TARGET,is_bot:false}});
  await f.handle('/flag Please review the original', {reply_to_message:original});
  const records=await f.db.prepare('SELECT * FROM pilot_member_reports').all();assert.equal(records.results.length,1);
  const row=records.results[0];assert.equal(row.message_id,original.message_id);assert.equal(row.target_user_id,String(TARGET));assert.equal(row.reporter_id,String(MEMBER));
  assert.equal(row.excerpt,'Original message <text>');assert.equal(row.reason,'Please review the original');
  assert.equal(f.calls.some(call=>['banChatMember','restrictChatMember','deleteMessage'].includes(call.method)),false);
  assert.ok(f.sends()[0].params.ephemeral_message_parameters);assert.match(f.sends()[0].params.text,/No penalty/);
});

test('reports cannot use evidence from another group or target an admin or linked-channel post',async t=>{
  const f=await fixture(t);
  const originals=[f.message('Other group',{chat:{id:OTHER_GROUP,type:'supergroup'},from:{id:TARGET}}),f.message('Admin post',{from:{id:ADMIN}}),f.message('Linked post',{from:{id:TARGET},sender_chat:{id:-1003001,type:'channel'},is_automatic_forward:true})];
  for(const original of originals)await f.handle('/flag Review', {reply_to_message:original});
  await f.tools.community.query({actor:{id:ADMIN},chatId:GROUP,view:'reports'});
  assert.equal((await f.db.prepare('SELECT * FROM pilot_member_reports').all()).results.length,0);
  assert.equal(f.calls.some(call=>call.method==='deleteMessage'),false);
});

test('ask returns escaped approved content only after current group membership verification',async t=>{
  const f=await fixture(t);
  await f.tools.community.perform({actor:{id:ADMIN},chatId:GROUP,action:'faq_save',input:{question:'Where is the guide?',answer:'Read <our guide> & ask questions.',url:'https://example.org/guide',language:'en'},requestId:f.requestId()});
  await f.handle('/ask guide');assert.match(f.sends().at(-1).params.text,/&lt;our guide&gt; &amp;/);
  assert.ok(f.sends().at(-1).params.ephemeral_message_parameters);
  f.roles.set(`${GROUP}:${MEMBER}`,{status:'left'});await f.handle('/ask guide');
  assert.doesNotMatch(f.sends().at(-1).params.text,/our guide/);assert.match(f.sends().at(-1).params.text,/current members/);
});

test('events rechecks membership, excludes cancelled entries and labels the configured timezone',async t=>{
  const f=await fixture(t);
  await f.tools.operations.perform({actor:{id:ADMIN},chatId:GROUP,action:'event_create',input:{title:'Open questions',startsAt:NOW+3600},requestId:f.requestId()});
  const cancelled=await f.tools.operations.perform({actor:{id:ADMIN},chatId:GROUP,action:'event_create',input:{title:'Cancelled event',startsAt:NOW+7200},requestId:f.requestId()});
  await f.tools.operations.perform({actor:{id:ADMIN},chatId:GROUP,action:'event_cancel',input:{id:cancelled.id},requestId:f.requestId()});
  await f.handle('/events');assert.match(f.sends().at(-1).params.text,/Open questions/);assert.match(f.sends().at(-1).params.text,/Africa\/Dar_es_Salaam/);assert.doesNotMatch(f.sends().at(-1).params.text,/Cancelled event/);
  f.roles.set(`${GROUP}:${MEMBER}`,{status:'kicked'});await f.handle('/events');assert.doesNotMatch(f.sends().at(-1).params.text,/Open questions/);
});

test('tools links verify membership and never treat a deep-linked group ID as authority',async t=>{
  const f=await fixture(t);f.roles.set(`${OTHER_GROUP}:${MEMBER}`,{status:'left'});
  await f.handle(`/start community_${OTHER_GROUP}`,{chat:{id:MEMBER,type:'private'}});
  assert.match(f.sends().at(-1).params.text,/current members/);assert.equal(f.sends().at(-1).params.reply_markup,undefined);
  await f.handle('/tools');assert.match(f.sends().at(-1).params.reply_markup.inline_keyboard[0][0].url,/start=community_/);
  assert.equal(await f.base.adminContext(MEMBER),null);
  await f.handle('/tools',{from:{id:ADMIN,is_bot:false,language_code:'en'}});assert.equal((await f.base.adminContext(ADMIN)).chat_id,String(GROUP));
});

test('tools reuse the admitted personal preference with their existing English fallback and no extra language query',async t=>{
  const f=await fixture(t),prepare=f.db.prepare.bind(f.db);let languageReads=0,updateId=2000;
  f.db.prepare=sql=>{if(/SELECT[\s\S]*FROM language_preferences/i.test(sql))languageReads++;return prepare(sql);};
  for(const [stored,telegram,expected] of [
    ['sw','en',/Ona vipengele vipya/],['en','sw',/See what is new/],
    [null,'sw-TZ',/Ona vipengele vipya/],[null,'fr',/See what is new/],[null,undefined,/See what is new/],
  ]){
    await f.commands.handle(f.message('/changelog',{from:{id:MEMBER,is_bot:false,language_code:telegram}}),updateId++,{
      context:{userLanguage:stored,groupLanguage:'sw'},
    });
    assert.match(f.sends().at(-1).params.text,expected);
  }
  assert.equal(languageReads,0);
  await f.base.setLanguage('user',MEMBER,'sw',NOW);
  await f.handle('/changelog');
  assert.match(f.sends().at(-1).params.text,/Ona vipengele vipya/);
  assert.equal(languageReads,1,'standalone tool handlers still load the stored preference');
});

test('other-bot commands are not executed, and ordinary link enforcement runs first',async t=>{
  const f=await fixture(t);
  assert.equal(await f.handle('/ask@OtherBot guide'),true);assert.equal(f.sends().length,0);
  assert.equal(await f.handle('An ordinary message'),false);
  const update=f.update('/ask@OtherBot https://unapproved.example/spam');await f.moderator.handle(update);
  assert.equal(f.calls.filter(call=>call.method==='banChatMember').length,1);
  assert.equal(f.calls.filter(call=>call.method==='deleteMessage').length,1);
  assert.equal((await f.base.member(GROUP,MEMBER)).strikes,1);
});

test('anonymous admins and channel senders cannot trigger private tool mutations',async t=>{
  const f=await fixture(t),original=f.message('Message',{from:{id:TARGET}});
  await f.handle('/flag Reason',{sender_chat:{id:GROUP,type:'supergroup'},reply_to_message:original});
  await f.handle('/events',{sender_chat:{id:-1003001,type:'channel'}});
  assert.equal(f.sends().length,0);assert.equal(f.calls.filter(call=>call.method==='getChatMember').length,0);
});

test('ephemeral message_id zero commands cannot create strikes, bans, deletions or flood counts',async t=>{
  const f=await fixture(t);
  await f.control.run('INSERT INTO pilot_group_settings(chat_id,settings_json,updated_at) VALUES(?,?,?)',String(GROUP),JSON.stringify({flood_enabled:true,flood_limit:3,flood_window:10,flood_action:'mute',command_spam_enabled:true}),NOW);
  for(let index=0;index<8;index++)await f.moderator.handle(f.update('/events',{message_id:0,ephemeral_message_id:7}));
  await f.moderator.handle(f.update('https://unapproved.example/private',{message_id:0,ephemeral_message_id:7}));
  await f.moderator.handle(f.update('/get_repeated_command_code_123456789012345678901234567890',{message_id:0,ephemeral_message_id:8}));
  assert.equal(f.calls.some(call=>['banChatMember','restrictChatMember','deleteMessage'].includes(call.method)),false);
  assert.equal((await f.db.prepare('SELECT * FROM incidents').all()).results.length,0);
  assert.equal((await f.db.prepare('SELECT * FROM pilot_flood_events').all()).results.length,0);
  assert.equal((await f.db.prepare('SELECT * FROM members').all()).results.length,0);
  assert.equal(f.sends().length,8);assert.ok(f.sends().every(call=>call.params.ephemeral_message_parameters?.receiver_user_id===MEMBER));
});

test('ephemeral IDs can be reused across updates while update retries stay idempotent',async t=>{
  const f=await fixture(t),one=f.update('/events',{message_id:0,ephemeral_message_id:5});
  await f.moderator.handle(one);assert.equal((await f.moderator.handle(one)).status,'duplicate');
  await f.moderator.handle(f.update('/events',{message_id:0,ephemeral_message_id:5}));assert.equal(f.sends().length,2);
  const edit=f.update('/events',{message_id:0,ephemeral_message_id:5});edit.edited_message=edit.message;delete edit.message;
  await f.moderator.handle(edit);assert.equal(f.sends().length,2);
});

test('connect provides a native chooser and only an authenticated current admin can accept the share',async t=>{
  const f=await fixture(t);
  await f.handle('/connect',{chat:{id:MEMBER,type:'private'}});
  const choice=f.sends().at(-1).params.reply_markup.keyboard[0][0].request_chat;
  assert.equal(choice.request_id,GROUP_PICKER_ID);assert.equal(choice.chat_is_channel,false);
  assert.equal(choice.bot_administrator_rights.can_delete_messages,true);
  assert.equal(choice.bot_administrator_rights.can_restrict_members,true);
  assert.equal(choice.user_administrator_rights.can_delete_messages,true);
  assert.equal(f.sends().at(-1).params.chat_id,MEMBER);
  const shared={chat:{id:MEMBER,type:'private'},chat_shared:{request_id:GROUP_PICKER_ID,chat_id:GROUP}};
  await f.handle('',shared);
  assert.match(f.sends().at(-1).params.text,/current members with the required role/);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM pilot_known_admins').first()).n,0);
  const count=f.sends().length;
  assert.equal(await f.handle('',{...shared,chat_shared:{request_id:GROUP_PICKER_ID+1,chat_id:GROUP}}),false);
  await f.handle('',{...shared,chat:{id:ADMIN,type:'private'}});
  assert.equal(f.sends().length,count,'a mismatched private chat cannot impersonate its owner');
  await f.base.settings({ready:'1'});
  await f.handle('',{chat:{id:ADMIN,type:'private'},from:{id:ADMIN,is_bot:false,first_name:'Asha',language_code:'en'},chat_shared:{request_id:GROUP_PICKER_ID,chat_id:GROUP}});
  assert.equal((await f.base.adminContext(ADMIN)).chat_id,String(GROUP));
  assert.ok(f.sends().some(call=>call.params.reply_markup?.remove_keyboard===true));
  assert.match(f.sends().at(-1).params.reply_markup.inline_keyboard[0][0].web_app.url,/section=doctor/);
  assert.equal(f.calls.some(call=>['deleteMessage','banChatMember','restrictChatMember'].includes(call.method)),false);
});

test('doctor and policy commands expose group diagnostics only to a current admin with private delivery',async t=>{
  const f=await fixture(t);
  await f.base.settings({ready:'1'});
  for(const command of ['/doctor','/policytest']) {
    await f.handle(command);
    assert.match(f.sends().at(-1).params.text,/current members with the required role/);
    assert.equal(f.sends().at(-1).params.reply_markup,undefined);
  }
  await f.handle('/doctor',{from:{id:ADMIN,is_bot:false,language_code:'en'}});
  const diagnosis=f.sends().at(-1).params;
  assert.match(diagnosis.text,/Bot connection/);assert.match(diagnosis.text,/Ban members/);
  assert.equal(diagnosis.ephemeral_message_parameters.receiver_user_id,ADMIN);
  assert.match(diagnosis.reply_markup.inline_keyboard[0][0].url,new RegExp(`start=doctor_${GROUP}$`));
  await f.handle(`/start policytest_${GROUP}`,{chat:{id:ADMIN,type:'private'},from:{id:ADMIN,is_bot:false,language_code:'en'}});
  const preview=f.sends().at(-1).params;
  assert.match(preview.text,/Tests do not delete messages, ban members or add strikes/);
  assert.match(preview.reply_markup.inline_keyboard[0][0].web_app.url,/section=policy/);
  f.roles.set(`${GROUP}:${ADMIN}`,{status:'member'});
  await f.handle('/doctor',{from:{id:ADMIN,is_bot:false,language_code:'en'}});
  assert.doesNotMatch(f.sends().at(-1).params.text,/Bot connection/);
  assert.equal(f.calls.some(call=>['deleteMessage','banChatMember','restrictChatMember'].includes(call.method)),false);
});

test('performance command ignores owner-name impersonation and opens only the numeric owner private panel',async t=>{
  const f=await fixture(t),owner=createOwnerAuth({db:f.db});await owner.ensure();
  await f.db.prepare('UPDATE pilot_owner SET user_id=? WHERE singleton=1').bind(String(ADMIN)).run();
  await f.handle('/performance',{chat:{id:MEMBER,type:'private'},from:{id:MEMBER,is_bot:false,username:'drcharlestz',language_code:'en'}});
  assert.match(f.sends().at(-1).params.text,/current members with the required role/);
  assert.equal(f.sends().at(-1).params.reply_markup,undefined);
  await f.handle('/performance',{chat:{id:ADMIN,type:'private'},from:{id:ADMIN,is_bot:false,language_code:'en'}});
  const target=new URL(f.sends().at(-1).params.reply_markup.inline_keyboard[0][0].web_app.url);
  assert.equal(target.searchParams.get('section'),'performance');assert.equal(target.searchParams.has('chat'),false);
  assert.equal(f.sends().at(-1).params.chat_id,ADMIN);
  await f.handle('/performance',{from:{id:ADMIN,is_bot:false,language_code:'en'}});
  assert.match(f.sends().at(-1).params.text,/private chat/);
  assert.equal(f.sends().at(-1).params.reply_markup,undefined);
  assert.equal(f.sends().at(-1).params.ephemeral_message_parameters.receiver_user_id,ADMIN);
});

test('support links retain only the verified member group and direct tickets into private bot tools',async t=>{
  const f=await fixture(t);
  await f.handle('/support');
  const group=f.sends().at(-1).params;
  assert.equal(group.ephemeral_message_parameters.receiver_user_id,MEMBER);
  assert.equal(group.reply_markup.inline_keyboard[0][0].url,`https://t.me/sautilinkpilotbot?start=support_${GROUP}`);
  await f.handle(`/start support_${GROUP}`,{chat:{id:MEMBER,type:'private'}});
  const target=new URL(f.sends().at(-1).params.reply_markup.inline_keyboard[0][0].web_app.url);
  assert.equal(target.searchParams.get('section'),'support');assert.equal(target.searchParams.get('chat'),String(GROUP));
  f.roles.set(`${OTHER_GROUP}:${MEMBER}`,{status:'left'});
  await f.handle(`/start support_${OTHER_GROUP}`,{chat:{id:MEMBER,type:'private'}});
  assert.match(f.sends().at(-1).params.text,/current members with the required role/);
  assert.equal(f.sends().at(-1).params.reply_markup,undefined);
  assert.equal((await f.db.prepare("SELECT name FROM sqlite_master WHERE name='pilot_support_tickets'").first()),null,'opening a support command does not silently create tickets');
});

test('events command formats the same stored instant in the group timezone instead of fixed EAT',async t=>{
  const f=await fixture(t),startsAt=NOW+3600;
  await f.tools.operations.perform({actor:{id:ADMIN},chatId:GROUP,action:'event_settings',input:{timezone:'America/New_York'},requestId:f.requestId()});
  await f.tools.operations.perform({actor:{id:ADMIN},chatId:GROUP,action:'event_create',input:{title:'Across timezones',startsAt},requestId:f.requestId()});
  await f.handle('/events');
  const text=f.sends().at(-1).params.text;
  const local=new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'America/New_York'}).format(new Date(startsAt*1000));
  assert.ok(text.includes(local));assert.match(text,/America\/New_York/);assert.doesNotMatch(text,/Africa\/Dar_es_Salaam| EAT/);
});
