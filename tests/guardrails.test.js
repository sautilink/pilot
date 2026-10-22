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
