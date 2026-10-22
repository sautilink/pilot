import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TestD1 } from './helpers/d1.js';
import { applySchema } from '../src/store.js';
import { createCommunityService } from '../src/community-service.js';
import { createSupportStore, SUPPORT_SCHEMA_SQL } from '../src/support-store.js';
import { DISCOVERY_SCHEMA_SQL } from '../src/discovery-service.js';
import { TelegramError } from '../src/telegram.js';

const CHAT=-1001122, OTHER=-1005566, ADMIN=21, ADMIN2=22, MEMBER=31, MEMBER2=32, BOT=900, NOW=1792670000;
const code=value=>error=>error.code===value;
async function fixture(t){
 const db=new TestD1();t.after(()=>db.close());await applySchema(db);
 let now=NOW,sequence=0,sendError,sendResult={message_id:500};const calls=[],roles=new Map();
 const setRole=(id,status,chat=CHAT)=>roles.set(`${chat}:${id}`,{status,user:{id},can_delete_messages:true});
 [ADMIN,ADMIN2,BOT].forEach(id=>setRole(id,'administrator'));[MEMBER,MEMBER2].forEach(id=>setRole(id,'member'));
 const api={async call(method,input){calls.push({method,input});if(method==='getMe')return{id:BOT,is_bot:true};if(method==='getChatMember')return roles.get(`${input.chat_id}:${input.user_id}`)||{status:'left'};if(method==='sendMessage'){if(sendError)throw sendError;return sendResult;}throw Error(method);}};
 const store=createSupportStore(db),service=createCommunityService({db,api,clock:()=>now});await store.ensure();
 const write=(action,input,user=ADMIN,chatId=CHAT,requestId=`support-request-${++sequence}`)=>service.perform({actor:{id:user},chatId,action,input,requestId});
 const query=(view,input={},user=MEMBER,chatId=CHAT)=>service.query({actor:{id:user},chatId,view,input});
 const contact=user=>store.rememberPrivateContact({chat:{id:user,type:'private'},from:{id:user},date:now},now);
 return{db,store,service,calls,setRole,write,query,contact,advance:value=>now+=value,failSend:error=>sendError=error,sendReturns:result=>sendResult=result,create:(user=MEMBER,requestId)=>write('ticket_create',{subject:'Help with registration',body:'Please help me get started.',language:'en'},user,CHAT,requestId)};
}

test('support schema migration is additive, repeatable, and retains shared private contacts',async t=>{
 const f=await fixture(t);await f.store.ensure();
 const migration=await readFile(new URL('../migrations/0011_support_discovery.sql',import.meta.url),'utf8');
 assert.equal(migration.trim(),`${SUPPORT_SCHEMA_SQL.trim()}\n\n${DISCOVERY_SCHEMA_SQL.trim()}`);
 assert.equal((await f.query('support')).enabled,false);
});

test('private contact evidence rejects group, forged and older replayed messages',async t=>{
 const f=await fixture(t);
 assert.equal(await f.store.rememberPrivateContact({chat:{id:CHAT,type:'supergroup'},from:{id:MEMBER},date:NOW},NOW),false);
 assert.equal(await f.store.rememberPrivateContact({chat:{id:MEMBER2,type:'private'},from:{id:MEMBER},date:NOW},NOW),false);
 await f.contact(MEMBER);assert.ok(await f.store.privateContact(MEMBER));
 await f.store.disablePrivateContact(MEMBER,NOW+10);
 await f.store.rememberPrivateContact({chat:{id:MEMBER,type:'private'},from:{id:MEMBER},date:NOW},NOW+11);
 assert.equal(await f.store.privateContact(MEMBER),null);
 f.advance(12);await f.contact(MEMBER);assert.ok(await f.store.privateContact(MEMBER));
});

test('ticket intake is opt-in, requires private contact, deduplicates and never moderates',async t=>{
 const f=await fixture(t);await assert.rejects(f.create(),code('private_chat_required'));
 await f.contact(MEMBER);await assert.rejects(f.create(),code('support_disabled'));
 await assert.rejects(f.write('support_settings',{enabled:true},MEMBER),code('forbidden'));
 await f.write('support_settings',{enabled:true});
 const result=await f.create(MEMBER,'ticket-request-original');const replay=await f.create(MEMBER,'ticket-request-original');
 assert.equal(result.number,'P-1');assert.equal(replay.id,result.id);assert.equal(replay.duplicate,true);
 assert.equal((await f.query('support')).tickets.length,1);
 assert.equal(f.calls.some(call=>/send|delete|ban|restrict/i.test(call.method)),false);
});

test('members see only their own tickets; revoked admins cannot read the group inbox',async t=>{
 const f=await fixture(t);await f.write('support_settings',{enabled:true});await f.contact(MEMBER);await f.contact(MEMBER2);
 const first=await f.create(),second=await f.create(MEMBER2);
 assert.equal((await f.query('support')).tickets.length,1);
 await assert.rejects(f.query('support_ticket',{id:first.id},MEMBER2),code('not_found'));
 const admin=await f.query('support',{},ADMIN);assert.equal(admin.tickets.length,2);assert.ok(admin.tickets[0].user_id);
 assert.equal(Object.hasOwn((await f.query('support')).tickets[0],'user_id'),false);
 f.setRole(ADMIN,'member');assert.equal((await f.query('support',{},ADMIN)).tickets.length,0);
 await assert.rejects(f.query('support_ticket',{id:second.id},ADMIN),code('not_found'));
 f.setRole(MEMBER,'left');await assert.rejects(f.query('support'),code('forbidden'));
});

test('cross-group ticket access and injected fields are rejected',async t=>{
 const f=await fixture(t);await f.write('support_settings',{enabled:true});await f.contact(MEMBER);const row=await f.create();
 f.setRole(ADMIN,'administrator',OTHER);
 await assert.rejects(f.query('support_ticket',{id:row.id},ADMIN,OTHER),code('not_found'));
 await assert.rejects(f.write('ticket_reply',{id:row.id,body:'Wrong group'},ADMIN,OTHER),code('not_found'));
 await assert.rejects(f.write('ticket_create',{subject:'X',body:'X',language:'en',user_id:MEMBER2},MEMBER),code('invalid_input'));
});

test('claims coordinate admins and can be recovered from a demoted admin',async t=>{
 const f=await fixture(t);await f.write('support_settings',{enabled:true});await f.contact(MEMBER);const row=await f.create();
 await f.write('ticket_claim',{id:row.id});
 await assert.rejects(f.write('ticket_reply',{id:row.id,body:'A conflicting response'},ADMIN2),code('ticket_claimed'));
 f.setRole(ADMIN,'member');await f.write('ticket_claim',{id:row.id},ADMIN2);
 assert.equal((await f.query('support_ticket',{id:row.id},ADMIN2)).ticket.claimed_by,String(ADMIN2));
});

test('admin reply is queued privately and delivered once with role checks',async t=>{
 const f=await fixture(t);await f.write('support_settings',{enabled:true});await f.contact(MEMBER);const row=await f.create();
 const reply=await f.write('ticket_reply',{id:row.id,body:'Use the registration page.'},ADMIN,CHAT,'ticket-reply-original');
 assert.equal(reply.delivery,'pending');assert.equal(f.calls.filter(call=>call.method==='sendMessage').length,0);
 assert.equal(await f.service.nextSupportDue(CHAT),NOW);assert.deepEqual(await f.service.dueSupportChats(),[String(CHAT)]);
 await f.service.processSupportDeliveries(CHAT);await f.service.processSupportDeliveries(CHAT);
 const sent=f.calls.filter(call=>call.method==='sendMessage');assert.equal(sent.length,1);assert.equal(sent[0].input.chat_id,MEMBER);assert.equal(sent[0].input.parse_mode,undefined);
 assert.ok(sent[0].input.text.includes('Use the registration page.'));assert.equal(await f.service.nextSupportDue(CHAT),null);
 assert.equal((await f.query('support_ticket',{id:row.id})).messages[1].delivery_status,'sent');
 await f.write('ticket_reply',{id:row.id,body:'Use the registration page.'},ADMIN,CHAT,'ticket-reply-original');
 assert.equal((await f.query('support_ticket',{id:row.id})).messages.length,2);
});

test('a changed actor or recipient role cancels pending private delivery',async t=>{
 const f=await fixture(t);await f.write('support_settings',{enabled:true});await f.contact(MEMBER);const row=await f.create();
 await f.write('ticket_reply',{id:row.id,body:'Reply.'});f.setRole(ADMIN,'member');
 assert.equal((await f.service.processSupportDeliveries(CHAT)).status,'cancelled');assert.equal(f.calls.some(call=>call.method==='sendMessage'),false);
});

test('ambiguous deliveries and interrupted sends never blindly resend',async t=>{
 const f=await fixture(t);await f.write('support_settings',{enabled:true});await f.contact(MEMBER);const row=await f.create();
 await f.write('ticket_reply',{id:row.id,body:'Reply.'});f.failSend(new TelegramError('timeout',0,true));
 assert.equal((await f.service.processSupportDeliveries(CHAT)).status,'unknown');f.advance(600);await f.service.processSupportDeliveries(CHAT);
 assert.equal(f.calls.filter(call=>call.method==='sendMessage').length,1);
 await f.write('ticket_reply',{id:row.id,body:'Another reply.'});
 await f.store.run("UPDATE pilot_support_deliveries SET status='sending',updated_at=? WHERE status='pending'",NOW);
 await f.service.processSupportDeliveries(CHAT);assert.equal(f.calls.filter(call=>call.method==='sendMessage').length,1);
 assert.equal((await f.store.first("SELECT COUNT(*) AS total FROM pilot_support_deliveries WHERE status='unknown'")).total,2);
});

test('explicit rate limits retry at the returned time at most three times',async t=>{
 const f=await fixture(t);await f.write('support_settings',{enabled:true});await f.contact(MEMBER);const row=await f.create();
 await f.write('ticket_reply',{id:row.id,body:'Reply.'});f.failSend(new TelegramError('rate limit',429,false,30));
 assert.equal((await f.service.processSupportDeliveries(CHAT)).status,'pending');assert.equal(await f.service.nextSupportDue(CHAT),NOW+30);
 await f.service.processSupportDeliveries(CHAT);assert.equal(f.calls.filter(call=>call.method==='sendMessage').length,1);
 f.advance(30);await f.service.processSupportDeliveries(CHAT);f.advance(30);assert.equal((await f.service.processSupportDeliveries(CHAT)).status,'failed');
 assert.equal(f.calls.filter(call=>call.method==='sendMessage').length,3);
});

test('blocked private delivery is disabled without public fallback',async t=>{
 const f=await fixture(t);await f.write('support_settings',{enabled:true});await f.contact(MEMBER);const row=await f.create();
 await f.write('ticket_reply',{id:row.id,body:'Reply.'});f.failSend(new TelegramError('blocked',403,false));
 assert.equal((await f.service.processSupportDeliveries(CHAT)).status,'failed');assert.equal(await f.store.privateContact(MEMBER),null);
 assert.ok(f.calls.filter(call=>call.method==='sendMessage').every(call=>call.input.chat_id===MEMBER));
});

test('members can resolve their own ticket but cannot reopen or claim; resolved threads reject replies',async t=>{
 const f=await fixture(t);await f.write('support_settings',{enabled:true});await f.contact(MEMBER);const row=await f.create();
 await f.write('ticket_status',{id:row.id,status:'resolved'},MEMBER);
 await assert.rejects(f.write('ticket_reply',{id:row.id,body:'More'},MEMBER),code('ticket_resolved'));
 await assert.rejects(f.write('ticket_status',{id:row.id,status:'open'},MEMBER),code('forbidden'));
 await f.write('ticket_status',{id:row.id,status:'open'});await f.write('ticket_reply',{id:row.id,body:'More information.'},MEMBER);
 assert.equal((await f.query('support_ticket',{id:row.id})).messages.length,2);
});

test('intake and per-thread replies are bounded, and expired evidence cascades',async t=>{
 const f=await fixture(t);await f.write('support_settings',{enabled:true});await f.contact(MEMBER);const row=await f.create();await f.create();await f.create();
 await assert.rejects(f.create(),code('ticket_rate_limited'));
 for(let i=0;i<9;i++)await f.write('ticket_reply',{id:row.id,body:`Detail ${i}`},MEMBER);
 await assert.rejects(f.write('ticket_reply',{id:row.id,body:'Too many'},MEMBER),code('ticket_rate_limited'));
 await f.write('ticket_reply',{id:row.id,body:'Reply from admin.'});f.advance(91*86400);
 assert.equal((await f.query('support',{},ADMIN)).tickets.length,0);await f.service.cleanup(NOW+91*86400);
 assert.equal((await f.store.first('SELECT COUNT(*) AS total FROM pilot_support_messages')).total,0);assert.equal((await f.store.first('SELECT COUNT(*) AS total FROM pilot_support_deliveries')).total,0);
});
