import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.js';
import {applySchema,createStore} from '../src/store.js';
import {createControlStore} from '../src/control-store.js';
import {createModerator} from '../src/moderator.js';
import {createGuardrails} from '../src/guardrails.js';
import {formatAnnouncement} from '../src/announcements.js';
import {TelegramError} from '../src/telegram.js';

const GROUP=-100123,OTHER=-100124,BOT=900,USER=101,ADMIN=102,START=1792620000;
async function fixture(t,settings={}) {
  const db=new TestD1();await applySchema(db);t.after(()=>db.close());
  let now=START,sequence=1;
  const calls=[],roles=new Map(),hooks=new Map();
  const api={async call(method,p={}){
    calls.push({method,p:structuredClone(p)});
    if(hooks.has(method)) return hooks.get(method)(p);
    if(method==='getMe') return {id:BOT,is_bot:true,username:'sautilinkpilotbot'};
    if(method==='getChat') return {id:p.chat_id,title:'Our <group>',type:'supergroup',linked_chat_id:-100900};
    if(method==='getChatMember') return roles.get(`${p.chat_id}:${p.user_id}`) || (p.user_id===BOT?{status:'administrator',can_delete_messages:true,can_restrict_members:true,can_invite_users:true}:p.user_id===ADMIN?{status:'administrator'}:{status:'member'});
    if(method==='sendMessage') return {message_id:5000+calls.length};
    if(method==='banChatMember') roles.set(`${p.chat_id}:${p.user_id}`,{status:'kicked',until_date:p.until_date});
    if(method==='restrictChatMember') roles.set(`${p.chat_id}:${p.user_id}`,{status:'restricted',is_member:true,until_date:p.until_date});
    return true;
  }};
  const store=createStore(db),controlStore=createControlStore(db),clock=()=>now;
  await store.group(GROUP);await store.settings({ready:'1',ready_since:START-1});
  await controlStore.ensure();
  const configure=async(value,chat=GROUP)=>db.prepare('INSERT INTO pilot_group_settings VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at').bind(String(chat),JSON.stringify(value),now).run();
  await configure(settings);
  const moderator=createModerator({db,api,clock});
  const guards=createGuardrails({db,store,controlStore,api,clock,me:()=>api.call('getMe'),say:(chat,text,extra={})=>api.call('sendMessage',{chat_id:Number(chat),text,...extra})});
  return {db,api,roles,hooks,store,controlStore,moderator,guards,configure,calls,clock,advance:seconds=>{now+=seconds;},of:method=>calls.filter(call=>call.method===method),
    message(extra={},edited=false){return {update_id:sequence++,[edited?'edited_message':'message']:{message_id:sequence++,date:now,chat:{id:GROUP,type:'supergroup',title:'Group'},from:{id:USER,first_name:'Juma'},text:'Habari',...extra}};},
    join(extra={}){roles.set(`${GROUP}:${USER}`,{status:'left'});return {update_id:sequence++,chat_join_request:{chat:{id:GROUP,type:'supergroup',title:'Group'},from:{id:USER,first_name:'Juma'},user_chat_id:USER,date:now,...extra}};},
    callback(row,{user=USER,answer=row.answer,chat=USER}={}){return {update_id:sequence++,callback_query:{id:`q-${sequence}`,from:{id:user,language_code:'en'},data:`pilot:join:${row.id}:${answer}`,message:{message_id:row.telegram_message_id,date:now,chat:{id:chat,type:'private'},from:{id:BOT,is_bot:true}}}};},
  };
}

test('optional tools are off by default and do not change ordinary conversations',async t=>{
  const f=await fixture(t);
  for(let i=0;i<12;i++) await f.moderator.handle(f.message());
  assert.equal(f.of('deleteMessage').length,0);assert.equal(f.of('restrictChatMember').length,0);assert.equal(f.of('banChatMember').length,0);
  await f.moderator.handle(f.join());assert.equal(f.of('sendMessage').length,0);assert.equal(f.of('approveChatJoinRequest').length,0);
});

test('flood deletion is group-scoped, counts albums once and never adds link/forward strikes',async t=>{
  const f=await fixture(t,{flood_enabled:true,flood_limit:3,flood_window:10});
  for(let i=0;i<3;i++) await f.moderator.handle(f.message({media_group_id:'album1'}));
  await f.moderator.handle(f.message());await f.moderator.handle(f.message());
  assert.equal(f.of('deleteMessage').length,0);
  const excess=f.message();await f.moderator.handle(excess);await f.moderator.handle(excess);
  assert.equal(f.of('deleteMessage').length,1);assert.equal(f.of('banChatMember').length,0);
  assert.equal((await f.store.member(GROUP,USER)).strikes,0);
  assert.equal(f.of('sendMessage').length,1);
  await f.moderator.handle(f.message({chat:{id:OTHER,type:'supergroup'}}));assert.equal(f.of('deleteMessage').length,1);
});

test('flood mute respects human restrictions and admin, anonymous, and linked-channel senders',async t=>{
  const f=await fixture(t,{flood_enabled:true,flood_limit:3,flood_window:10,flood_action:'mute',flood_mute_seconds:300});
  for(let i=0;i<4;i++) await f.moderator.handle(f.message());
  assert.equal(f.of('restrictChatMember').length,1);assert.equal(f.of('restrictChatMember')[0].p.until_date,START+300);
  await f.moderator.handle(f.message());assert.equal(f.of('restrictChatMember').length,1,'existing restrictions must not be extended');
  f.roles.set(`${GROUP}:${USER}`,{status:'administrator'});
  for(let i=0;i<5;i++) await f.moderator.handle(f.message());
  for(const sender of [GROUP,-100900]) for(let i=0;i<5;i++) await f.moderator.handle(f.message({sender_chat:{id:sender}}));
  assert.equal(f.of('deleteMessage').length,2);assert.equal(f.of('banChatMember').length,0);
});

test('a primary link violation retains the original escalation even when flood control is enabled',async t=>{
  const f=await fixture(t,{flood_enabled:true,flood_limit:3,flood_window:10,flood_action:'mute'});
  for(let i=0;i<3;i++) await f.moderator.handle(f.message());
  await f.moderator.handle(f.message({text:'https://forbidden.example'}));
  assert.equal(f.of('banChatMember').length,1);assert.equal(f.of('banChatMember')[0].p.until_date,START+86400);
  assert.equal(f.of('restrictChatMember').length,0);assert.equal((await f.store.member(GROUP,USER)).strikes,1);
});

test('per-group whitelist is applied by the real moderator and does not allow forwarded messages',async t=>{
  const f=await fixture(t);
  await f.db.prepare('INSERT INTO pilot_whitelist_rules VALUES(?,?,?,?,?,?)').bind('rule-one',String(GROUP),'domain','example.com',String(ADMIN),START).run();
  await f.moderator.handle(f.message({text:'https://example.com/path'}));assert.equal(f.of('banChatMember').length,0);
  await f.moderator.handle(f.message({text:'https://example.com/path',forward_origin:{type:'hidden_user',date:START-1,sender_user_name:'Person'}}));
  assert.equal(f.of('banChatMember').length,1);
  await f.moderator.handle(f.message({chat:{id:OTHER,type:'supergroup'},text:'https://example.com/path'}));assert.equal(f.of('banChatMember').length,2);
});

test('welcome is deduplicated across service and membership events and safely escapes custom text',async t=>{
  const f=await fixture(t,{welcome_enabled:true,welcome_sw:'Karibu {user} — {group}\n{rules}',rules_sw:'<Soma> sheria'});
  const user={id:USER,first_name:'<Juma & Asha>'};
  await f.moderator.handle(f.message({new_chat_members:[user],text:undefined}));
  await f.moderator.handle({update_id:900,chat_member:{chat:{id:GROUP,type:'supergroup'},date:START,from:user,old_chat_member:{status:'left',user},new_chat_member:{status:'member',user}}});
  assert.equal(f.of('sendMessage').length,1);assert.match(f.of('sendMessage')[0].p.text,/&lt;Juma &amp; Asha&gt;/);assert.match(f.of('sendMessage')[0].p.text,/&lt;Soma&gt;/);
});

test('join challenge requires the same person and message, then approves at most once',async t=>{
  const f=await fixture(t,{join_gate_enabled:true,join_gate_mode:'challenge'});
  const request=f.join();await f.moderator.handle(request);await f.moderator.handle({...request,update_id:999});
  const row=await f.db.prepare('SELECT * FROM pilot_join_requests').first();
  assert.equal(row.status,'challenged');assert.equal(f.of('sendMessage').length,1);
  await f.moderator.handle(f.callback(row,{user:ADMIN}));
  await f.moderator.handle(f.callback(row,{answer:'99'}));assert.equal(f.of('approveChatJoinRequest').length,0);
  await f.moderator.handle(f.callback(row));await f.moderator.handle(f.callback(row));
  assert.equal(f.of('approveChatJoinRequest').length,1);assert.equal(f.of('banChatMember').length,0);
});

test('expired and disabled join challenges leave a manual review without banning the applicant',async t=>{
  const f=await fixture(t,{join_gate_enabled:true,join_gate_mode:'challenge'});
  await f.moderator.handle(f.join());const row=await f.db.prepare('SELECT * FROM pilot_join_requests').first();
  f.advance(301);await f.moderator.handle(f.callback(row));
  assert.equal(f.of('approveChatJoinRequest').length,0);assert.equal(f.of('declineChatJoinRequest').length,0);assert.equal(f.of('banChatMember').length,0);
  await assert.rejects(f.guards.control({actor:{id:USER},chatId:GROUP,action:'join_approve',input:{joinId:row.id},requestId:'join-operation-001'}),error=>error.code==='admin_required');
  await f.guards.control({actor:{id:ADMIN},chatId:GROUP,action:'join_approve',input:{joinId:row.id},requestId:'join-operation-002'});
  await f.guards.control({actor:{id:ADMIN},chatId:GROUP,action:'join_approve',input:{joinId:row.id},requestId:'join-operation-002'});
  assert.equal(f.of('approveChatJoinRequest').length,1);
});

test('an uncertain join approval is never repeated and a human ban always wins',async t=>{
  const f=await fixture(t,{join_gate_enabled:true,join_gate_mode:'challenge'});
  await f.moderator.handle(f.join());const row=await f.db.prepare('SELECT * FROM pilot_join_requests').first();
  f.hooks.set('approveChatJoinRequest',()=>{throw new TelegramError('Response lost',0,true);});
  await f.moderator.handle(f.callback(row));await f.moderator.handle(f.callback(row));assert.equal(f.of('approveChatJoinRequest').length,1);
  f.advance(2);await f.moderator.handle(f.join());const next=await f.db.prepare('SELECT * FROM pilot_join_requests ORDER BY event_at DESC LIMIT 1').first();
  f.roles.set(`${GROUP}:${USER}`,{status:'kicked',until_date:START+90000});
  await f.moderator.handle(f.callback(next));assert.equal(f.of('approveChatJoinRequest').length,1);assert.equal(f.of('unbanChatMember').length,0);
});

test('a cancelled corrected incident cannot be resurrected by confirmation recovery',async t=>{
  const f=await fixture(t);await f.moderator.handle(f.message({text:'https://forbidden.example'}));
  const row=await f.db.prepare('SELECT * FROM incidents').first();
  await f.store.status(row.id,'cancelled');await f.store.run('UPDATE members SET strikes=0,override_at=?',START);
  await f.store.confirm(row,START+1);
  assert.equal((await f.store.member(GROUP,USER)).strikes,0);assert.equal((await f.store.incident(row.id)).status,'cancelled');
});

test('all announcement styles preserve penalty facts and custom placeholders remain plain text',()=>{
  const row={user_id:String(USER),strike:2,until_date:START+7*86400,reasons:'["link","forward"]'};
  for(const notice_template of ['detailed','compact','formal']) {
    const result=formatAnnouncement(row,{chat:{id:GROUP,title:'<Group>'},from:{first_name:'<Juma>'}},true,'en',{notice_template,notice_en:'Please contact {group}, {user}. Reason: {reason}. Duration: {duration}.'});
    assert.match(result.plain,/7 days/);assert.match(result.plain,/2\s*\/\s*3/);assert.match(result.plain,/EAT/);assert.match(result.plain,/forward/i);assert.match(result.plain,/link/i);
    assert.match(result.rich,/&lt;Group&gt;/);assert.match(result.rich,/&lt;Juma&gt;/);
  }
});

test('template expansion stays bounded without discarding mandatory penalty facts',async t=>{
  const f=await fixture(t,{welcome_enabled:true,welcome_sw:'{rules}'.repeat(57),rules_sw:'a'.repeat(600)});
  await f.moderator.handle(f.message({new_chat_members:[{id:USER,first_name:'Juma'}],text:undefined}));
  assert.ok(f.of('sendMessage')[0].p.text.length<=3500);
  const row={user_id:USER,strike:1,until_date:START+86400,reasons:'["link","forward"]'};
  const notice=formatAnnouncement(row,{chat:{id:GROUP,title:'G'.repeat(128)},from:{first_name:'Juma'}},true,'en',{notice_en:'{reason}'.repeat(30)});
  assert.ok(notice.plain.length<2000);assert.match(notice.plain,/24 hours/);assert.match(notice.plain,/1 \/ 3/);assert.match(notice.plain,/EAT/);
});

test('a manual unmute clears the old flood episode and queued messages cannot remute',async t=>{
  const f=await fixture(t,{flood_enabled:true,flood_limit:3,flood_window:10,flood_action:'mute',flood_mute_seconds:300});
  for(let i=0;i<4;i++) await f.moderator.handle(f.message());
  assert.equal(f.of('restrictChatMember').length,1);
  f.advance(1);f.roles.set(`${GROUP}:${USER}`,{status:'member'});
  await f.moderator.handle({update_id:999,chat_member:{chat:{id:GROUP,type:'supergroup'},from:{id:ADMIN},date:f.clock(),old_chat_member:{status:'restricted',is_member:true,user:{id:USER}},new_chat_member:{status:'member',user:{id:USER}}}});
  for(let i=0;i<4;i++) await f.moderator.handle(f.message({date:START}));
  f.advance(1);await f.moderator.handle(f.message());
  assert.equal(f.of('restrictChatMember').length,1);
});

test('malformed success payloads never confirm a ban or an undelivered deletion',async t=>{
  const f=await fixture(t);f.hooks.set('deleteMessage',()=>false);
  await assert.rejects(f.moderator.handle(f.message({text:'https://forbidden.example'})));
  assert.equal(f.of('banChatMember').length,0);assert.equal(f.of('sendMessage').length,0);
  f.hooks.delete('deleteMessage');f.hooks.set('banChatMember',()=>false);
  const message=f.message({text:'https://forbidden.example'});assert.equal((await f.moderator.handle(message)).status,'uncertain');
  await f.moderator.handle(message);assert.equal(f.of('banChatMember').length,1);assert.equal((await f.store.member(GROUP,USER)).strikes,0);assert.equal(f.of('sendMessage').length,0);
});

test('a recovered welcome delivery resolves its issue alert',async t=>{
  const f=await fixture(t,{welcome_enabled:true});f.hooks.set('sendMessage',()=>{throw new TelegramError('Denied',403,false);});
  await f.guards.welcome(GROUP,{id:USER,first_name:'User'},START,await f.controlStore.settings(GROUP));
  let health=await f.db.prepare('SELECT * FROM pilot_health_events WHERE kind=?').bind('welcome_delivery_failed').first();assert.equal(health.resolved_at,0);
  f.hooks.delete('sendMessage');f.advance(61);await f.guards.welcome(GROUP,{id:USER,first_name:'User'},f.clock(),await f.controlStore.settings(GROUP));
  health=await f.db.prepare('SELECT * FROM pilot_health_events WHERE kind=?').bind('welcome_delivery_failed').first();assert.equal(health.resolved_at,f.clock());
});

const LONG_COMMAND='/zTwNCWkqQtZ2UaBbYTVvyPRKI1KawCiwB6yVwDkEXYT14Y0HmKu6YI0qT';

test('long slash codes are silently deleted by default without strikes, notices or restrictions',async t=>{
  const f=await fixture(t);
  for(let i=0;i<12;i++) assert.equal((await f.moderator.handle(f.message({text:LONG_COMMAND,from:{id:USER+i+10}}))).status,'command_spam');
  assert.equal(f.of('deleteMessage').length,12);
  assert.equal(f.of('banChatMember').length,0);assert.equal(f.of('restrictChatMember').length,0);assert.equal(f.of('sendMessage').length,0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM members').first()).n,0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM incidents').first()).n,0);
  const audit=(await f.db.prepare("SELECT * FROM pilot_audit WHERE action='command_spam_deleted'").all()).results;
  assert.equal(audit.length,12);
  assert.ok(audit.every(row=>!row.details_json.includes(LONG_COMMAND) && JSON.parse(row.details_json).action==='deleted'));
});

test('repeated long codes never contribute to flood counts or activate a configured flood mute',async t=>{
  const f=await fixture(t,{flood_enabled:true,flood_limit:3,flood_window:10,flood_action:'mute'});
  for(let i=0;i<3;i++) await f.moderator.handle(f.message());
  for(let i=0;i<12;i++) await f.moderator.handle(f.message({text:LONG_COMMAND}));
  assert.equal(f.of('deleteMessage').length,12);
  assert.equal(f.of('restrictChatMember').length,0);assert.equal(f.of('banChatMember').length,0);assert.equal(f.of('sendMessage').length,0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM pilot_flood_events WHERE user_id=?').bind(String(USER)).first()).n,3);
});

test('long-code settings and command exceptions apply only to their chosen group',async t=>{
  const f=await fixture(t,{command_spam_allowlist:LONG_COMMAND});
  await f.moderator.handle(f.message({text:LONG_COMMAND}));
  assert.equal(f.of('deleteMessage').length,0);
  await f.moderator.handle(f.message({text:LONG_COMMAND,chat:{id:OTHER,type:'supergroup'}}));
  assert.equal(f.of('deleteMessage').length,1);
  await f.configure({command_spam_enabled:false});
  await f.moderator.handle(f.message({text:LONG_COMMAND}));
  assert.equal(f.of('deleteMessage').length,1);
  await f.configure({command_spam_allowlist:'/get_*@musicbot'});
  await f.moderator.handle(f.message({text:'/get_'+LONG_COMMAND.slice(1)+'@MusicBot'}));
  assert.equal(f.of('deleteMessage').length,1);
  await f.moderator.handle(f.message({text:LONG_COMMAND+'@MusicBot'}));
  assert.equal(f.of('deleteMessage').length,2);
});

test('ordinary bot commands and arguments survive the long-code guard',async t=>{
  const f=await fixture(t);
  for(const text of ['/start','/help@sautilinkpilotbot','/play@MusicBot wimbo',`/play ${LONG_COMMAND}`,`/get ${LONG_COMMAND.slice(1)}`,'@juma','#habari']) await f.moderator.handle(f.message({text}));
  assert.equal(f.of('deleteMessage').length,0);assert.equal(f.of('banChatMember').length,0);assert.equal(f.of('restrictChatMember').length,0);
});

test('long-code guard respects admins, anonymous admins, linked channels and actual bot senders',async t=>{
  const f=await fixture(t,{flood_enabled:true,flood_limit:3,flood_window:10,flood_action:'mute'});
  for(const status of ['administrator','creator']) {
    f.roles.set(`${GROUP}:${USER}`,{status});
    await f.moderator.handle(f.message({text:LONG_COMMAND}));
  }
  for(const sender of [GROUP,-100900]) await f.moderator.handle(f.message({text:LONG_COMMAND,sender_chat:{id:sender},from:{id:136817688,is_bot:true}}));
  for(const id of [BOT,901]) await f.moderator.handle(f.message({text:LONG_COMMAND,from:{id,is_bot:true}}));
  assert.equal(f.of('deleteMessage').length,0);assert.equal(f.of('banChatMember').length,0);assert.equal(f.of('restrictChatMember').length,0);
});

test('a member promoted during long-code checks is protected by a fresh role check',async t=>{
  const f=await fixture(t);let reads=0;
  f.hooks.set('getChatMember',p=>p.user_id===BOT?{status:'administrator',can_delete_messages:true}:++reads===1?{status:'member'}:{status:'administrator'});
  assert.equal((await f.moderator.handle(f.message({text:LONG_COMMAND}))).status,'admin');
  assert.equal(f.of('deleteMessage').length,0);
});

test('newly linked channel is exempt but unrelated channel codes are deleted without fake-user restrictions',async t=>{
  const f=await fixture(t);let reads=0;
  f.hooks.set('getChat',()=>({id:GROUP,type:'supergroup',linked_chat_id:++reads===1?-100900:-100999}));
  await f.moderator.handle(f.message({text:LONG_COMMAND,sender_chat:{id:-100999},from:{id:136817688,is_bot:true}}));
  assert.equal(f.of('deleteMessage').length,0);
  f.hooks.delete('getChat');
  await f.moderator.handle(f.message({text:LONG_COMMAND,sender_chat:{id:-100999},from:{id:136817688,is_bot:true}}));
  assert.equal(f.of('deleteMessage').length,1);assert.equal(f.of('banChatMember').length,0);assert.equal(f.of('restrictChatMember').length,0);
});

test('edited text and captions are checked using full tokens without rerunning a command',async t=>{
  const f=await fixture(t);
  const clean=f.message();await f.moderator.handle(clean);f.advance(1);
  await f.moderator.handle(f.message({...clean.message,text:LONG_COMMAND,edit_date:f.clock(),entities:[{type:'bot_command',offset:0,length:33}]},true));
  await f.moderator.handle(f.message({text:undefined,caption:LONG_COMMAND,edit_date:f.clock(),caption_entities:[{type:'bot_command',offset:0,length:33}]},true));
  assert.equal(f.of('deleteMessage').length,2);assert.equal(f.of('banChatMember').length,0);assert.equal(f.of('sendMessage').length,0);
});

test('formatted long-code examples are preserved but formatting only the slash does not hide a code',async t=>{
  const f=await fixture(t);
  for(const type of ['code','pre']) await f.moderator.handle(f.message({text:LONG_COMMAND,entities:[{type,offset:0,length:LONG_COMMAND.length}]}));
  assert.equal(f.of('deleteMessage').length,0);
  await f.moderator.handle(f.message({text:LONG_COMMAND,entities:[{type:'code',offset:0,length:1}]}));
  assert.equal(f.of('deleteMessage').length,1);
});

test('paused, pre-activation, stale and human-overridden codes are not removed',async t=>{
  const f=await fixture(t);
  await f.store.run('UPDATE groups SET enabled=0 WHERE chat_id=?',String(GROUP));
  await f.moderator.handle(f.message({text:LONG_COMMAND}));
  await f.store.run('UPDATE groups SET enabled=1,activated_at=? WHERE chat_id=?',START,String(GROUP));
  await f.moderator.handle(f.message({text:LONG_COMMAND,date:START-1}));
  await f.moderator.handle(f.message({text:LONG_COMMAND,date:START-48*3600,edit_date:START},true));
  await f.store.override(GROUP,USER,START);
  await f.moderator.handle(f.message({text:LONG_COMMAND}));
  assert.equal(f.of('deleteMessage').length,0);assert.equal(f.of('restrictChatMember').length,0);
  f.advance(1);await f.moderator.handle(f.message({text:LONG_COMMAND}));assert.equal(f.of('deleteMessage').length,1);
});

test('long-code deletion requires only delete permission and also works in basic groups',async t=>{
  const f=await fixture(t);
  f.roles.set(`${GROUP}:${BOT}`,{status:'administrator',can_delete_messages:true,can_restrict_members:false});
  await f.moderator.handle(f.message({text:LONG_COMMAND,chat:{id:GROUP,type:'group'}}));
  assert.equal(f.of('deleteMessage').length,1);assert.equal(f.of('restrictChatMember').length,0);assert.equal(f.of('banChatMember').length,0);
  f.roles.set(`${GROUP}:${BOT}`,{status:'administrator',can_delete_messages:false,can_restrict_members:true});
  assert.equal((await f.moderator.handle(f.message({text:LONG_COMMAND}))).status,'command_spam_missing_permission');
  assert.equal(f.of('deleteMessage').length,1);assert.equal(f.of('sendMessage').length,0);
});

test('confirmed long-code deletion is idempotent across updates and does not persist message content',async t=>{
  const f=await fixture(t),update=f.message({text:LONG_COMMAND});
  await f.moderator.handle(update);await f.moderator.handle(update);
  await f.moderator.handle({...update,update_id:1000});
  assert.equal(f.of('deleteMessage').length,1);
  const rows=(await f.db.prepare('SELECT * FROM pilot_guard_actions').all()).results;
  assert.equal(rows.length,1);assert.equal(rows[0].status,'deleted');assert.ok(!JSON.stringify(rows).includes(LONG_COMMAND));
});

test('failed and unknown code deletions are reported honestly without restriction or automatic replay',async t=>{
  const f=await fixture(t,{flood_enabled:true,flood_limit:3,flood_window:10,flood_action:'mute'});
  for(const [result,status] of [[()=>{throw new TelegramError('Forbidden',403,false);},'failed'],[()=>{throw new TelegramError('Response lost',0,true);},'unknown'],[()=>false,'unknown']]) {
    f.hooks.set('deleteMessage',result);
    const update=f.message({text:LONG_COMMAND});
    assert.equal((await f.moderator.handle(update)).status,'command_spam_review');
    await f.moderator.handle({...update,update_id:update.update_id+10000});
    const row=await f.db.prepare('SELECT status FROM pilot_guard_actions WHERE id=?').bind(`commandspam:${GROUP}:${update.message.message_id}`).first();
    assert.equal(row.status,status);
  }
  assert.equal(f.of('deleteMessage').length,3);assert.equal(f.of('restrictChatMember').length,0);assert.equal(f.of('banChatMember').length,0);assert.equal(f.of('sendMessage').length,0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM pilot_audit WHERE action='command_spam_deleted'").first()).n,0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM pilot_audit WHERE action='command_spam_review'").first()).n,3);
});

test('already-removed code messages are treated as deleted without another action',async t=>{
  const f=await fixture(t);f.hooks.set('deleteMessage',()=>{throw new TelegramError('Bad Request: message to delete not found',400,false);});
  assert.equal((await f.moderator.handle(f.message({text:LONG_COMMAND}))).status,'command_spam');
  assert.equal((await f.db.prepare("SELECT status FROM pilot_guard_actions WHERE kind='command_spam'").first()).status,'deleted');
});

test('definite 429 code deletions wait for retry_after and retry at most three times',async t=>{
  const f=await fixture(t,{flood_enabled:true,flood_limit:3,flood_window:10,flood_action:'mute'});
  f.hooks.set('deleteMessage',()=>{throw new TelegramError('Too Many Requests',429,false,10);});
  const update=f.message({text:LONG_COMMAND});
  for(let attempt=1;attempt<=3;attempt++) {
    const result=await f.moderator.handle(update);
    assert.equal(f.of('deleteMessage').length,attempt);
    if(attempt<3) {
      assert.deepEqual(result,{status:'command_spam_retry',retry:true});
      assert.equal(await f.store.seen(update.update_id),null);
      const reads=f.of('getChatMember').length;
      f.advance(9);assert.deepEqual(await f.moderator.handle(update),{status:'command_spam_retry',retry:true});
      assert.equal(f.of('getChatMember').length,reads,'not-before retries avoid further Telegram reads');
      assert.equal(f.of('deleteMessage').length,attempt);f.advance(1);
    } else {
      assert.equal(result.status,'command_spam_review');assert.ok(await f.store.seen(update.update_id));
    }
  }
  f.advance(10);await f.moderator.handle({...update,update_id:9999});assert.equal(f.of('deleteMessage').length,3);
  assert.equal(f.of('restrictChatMember').length,0);assert.equal(f.of('banChatMember').length,0);assert.equal(f.of('sendMessage').length,0);
});

test('429 retry can complete but a new admin promotion cancels deletion before retry',async t=>{
  const f=await fixture(t);let attempts=0;
  f.hooks.set('deleteMessage',()=>{if(++attempts===1)throw new TelegramError('Too Many Requests',429,false,2);return true;});
  const first=f.message({text:LONG_COMMAND});await f.moderator.handle(first);f.advance(2);
  assert.equal((await f.moderator.handle(first)).status,'command_spam');
  assert.equal(f.of('deleteMessage').length,2);
  f.hooks.set('deleteMessage',()=>{throw new TelegramError('Too Many Requests',429,false,2);});
  const second=f.message({text:LONG_COMMAND});await f.moderator.handle(second);f.advance(2);
  f.roles.set(`${GROUP}:${USER}`,{status:'administrator'});
  assert.equal((await f.moderator.handle(second)).status,'admin');assert.equal(f.of('deleteMessage').length,3);
});

test('a newer clean edit cancels an old 429 payload while a later new spam edit remains removable',async t=>{
  const f=await fixture(t);f.hooks.set('deleteMessage',()=>{throw new TelegramError('Too Many Requests',429,false,10);});
  const original=f.message({text:LONG_COMMAND});
  assert.equal((await f.moderator.handle(original)).status,'command_spam_retry');
  f.advance(1);
  await f.moderator.handle(f.message({...original.message,edit_date:f.clock(),text:'Good morning everyone'},true));
  f.advance(10);f.hooks.delete('deleteMessage');
  assert.equal((await f.moderator.handle(original)).status,'command_spam_duplicate');
  assert.equal(f.of('deleteMessage').length,1,'old webhook never deletes the new clean message');
  await f.moderator.handle(f.message({...original.message,edit_date:f.clock(),text:LONG_COMMAND},true));
  assert.equal(f.of('deleteMessage').length,2,'strictly newer spam edit is still moderated');
});

test('same-second clean edit fails safe against a pending old long-code deletion',async t=>{
  const f=await fixture(t);f.hooks.set('deleteMessage',()=>{throw new TelegramError('Too Many Requests',429,false,2);});
  const original=f.message({text:LONG_COMMAND});await f.moderator.handle(original);
  await f.moderator.handle(f.message({...original.message,edit_date:f.clock(),text:'Clean now'},true));
  f.advance(2);f.hooks.delete('deleteMessage');await f.moderator.handle(original);
  assert.equal(f.of('deleteMessage').length,1);
});

test('newer long-code edit retains retry backoff and invalidates the older candidate payload',async t=>{
  const f=await fixture(t);f.hooks.set('deleteMessage',()=>{throw new TelegramError('Too Many Requests',429,false,10);});
  const original=f.message({text:LONG_COMMAND});await f.moderator.handle(original);f.advance(1);
  const edited=f.message({...original.message,edit_date:f.clock(),text:`/${'B'.repeat(40)}`},true);
  assert.equal((await f.moderator.handle(edited)).status,'command_spam_retry');assert.equal(f.of('deleteMessage').length,1);
  f.advance(10);f.hooks.delete('deleteMessage');
  assert.equal((await f.moderator.handle(original)).status,'command_spam_duplicate');assert.equal(f.of('deleteMessage').length,1);
  assert.equal((await f.moderator.handle(edited)).status,'command_spam');assert.equal(f.of('deleteMessage').length,2);
});

test('clean edits invalidate pending tags while cleanup is disabled and disabled tag retries stop',async t=>{
  const f=await fixture(t,{flood_enabled:true,flood_limit:3,flood_window:10,flood_action:'mute'});
  f.hooks.set('deleteMessage',()=>{throw new TelegramError('Too Many Requests',429,false,10);});
  const original=f.message({text:LONG_COMMAND});await f.moderator.handle(original);f.advance(1);
  await f.configure({command_spam_enabled:false,flood_enabled:true,flood_limit:3,flood_window:10,flood_action:'mute'});
  await f.moderator.handle(f.message({...original.message,edit_date:f.clock(),text:'This is clean now'},true));
  for(let i=0;i<5;i++) assert.equal((await f.moderator.handle(f.message({text:LONG_COMMAND}))).status,'command_spam_disabled');
  f.advance(10);await f.configure({command_spam_enabled:true});f.hooks.delete('deleteMessage');
  assert.equal((await f.moderator.handle(original)).status,'command_spam_duplicate');assert.equal(f.of('deleteMessage').length,1);
  assert.equal(f.of('restrictChatMember').length,0);
  const next=f.message({text:LONG_COMMAND});f.hooks.set('deleteMessage',()=>{throw new TelegramError('Too Many Requests',429,false,2);});await f.moderator.handle(next);
  await f.configure({command_spam_enabled:false});
  assert.equal((await f.moderator.handle(next)).status,'command_spam_disabled');assert.ok(await f.store.seen(next.update_id));
  f.advance(3);await f.configure({command_spam_enabled:true});await f.moderator.handle({...next,update_id:20000});
  assert.equal(f.of('deleteMessage').length,2,'disabled retry cannot resurrect after re-enable');
});

test('multiple clean edits advance a cancellation watermark against out-of-order spam edits',async t=>{
  const f=await fixture(t);f.hooks.set('deleteMessage',()=>{throw new TelegramError('Too Many Requests',429,false,10);});
  const original=f.message({text:LONG_COMMAND});await f.moderator.handle(original);f.advance(1);
  await f.moderator.handle(f.message({...original.message,edit_date:f.clock(),text:'First clean edit'},true));
  f.advance(2);
  await f.moderator.handle(f.message({...original.message,edit_date:f.clock(),text:'Latest clean edit'},true));
  f.hooks.delete('deleteMessage');
  const delayed=f.message({...original.message,edit_date:START+2,text:LONG_COMMAND},true);
  assert.equal((await f.moderator.handle(delayed)).status,'command_spam_duplicate');
  f.advance(8);await f.moderator.handle(original);assert.equal(f.of('deleteMessage').length,1);
});

test('a clean edit delivered before its original webhook protects current text without storing its body',async t=>{
  const f=await fixture(t),original=f.message({text:LONG_COMMAND});f.advance(1);
  await f.moderator.handle(f.message({...original.message,edit_date:f.clock(),text:'Clean edit arrived first'},true));
  assert.equal((await f.moderator.handle(original)).status,'command_spam_duplicate');
  assert.equal(f.of('deleteMessage').length,0);
  const saved=await f.db.prepare('SELECT * FROM pilot_guard_actions WHERE id=?').bind(`commandspam:${GROUP}:${original.message.message_id}`).first();
  assert.equal(saved.status,'cancelled_edit');assert.ok(!JSON.stringify(saved).includes('Clean edit arrived first'));
  f.advance(1);await f.moderator.handle(f.message({...original.message,edit_date:f.clock(),text:LONG_COMMAND},true));
  assert.equal(f.of('deleteMessage').length,1);
});

test('long-code exceptions cannot exempt a forwarded code or concealed prohibited link',async t=>{
  const f=await fixture(t,{command_spam_allowlist:LONG_COMMAND,flood_enabled:true,flood_limit:3,flood_window:10,flood_action:'mute'});
  await f.moderator.handle(f.message({text:LONG_COMMAND,forward_origin:{type:'hidden_user',date:START-1,sender_user_name:'Person'}}));
  assert.equal(f.of('banChatMember').length,1);assert.equal((await f.store.member(GROUP,USER)).strikes,1);
  await f.moderator.handle(f.message({text:LONG_COMMAND,from:{id:USER+5},entities:[{type:'text_link',offset:0,length:LONG_COMMAND.length,url:'https://forbidden.example'}]}));
  assert.equal(f.of('banChatMember').length,2);assert.equal(f.of('restrictChatMember').length,0);
});
