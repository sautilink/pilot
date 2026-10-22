import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TestD1 } from './helpers/d1.js';
import { createOperationsStore,OPERATIONS_SCHEMA_SQL } from '../src/operations-store.js';
import { createOperationsService,OperationsError } from '../src/operations-service.js';
import { TelegramError } from '../src/telegram.js';

const CHAT=-1002200,SECOND=-1003300,USER=42,MEMBER=43,OTHER=44,BOT=999;
const START=Date.UTC(2026,9,22,9)/1000;
const actor={id:USER,is_bot:false};
const code=value=>error=>error instanceof OperationsError && error.code===value;

function fixture(t) {
  const db=new TestD1();t.after(()=>db.close());
  const store=createOperationsStore(db),roles=new Map(),calls=[],hooks=new Map();
  let current=START,sequence=0;
  const api={async call(method,input={}){
    calls.push({method,input:structuredClone(input)});
    if(hooks.has(method))return hooks.get(method)(input);
    if(method==='getMe')return {id:BOT,is_bot:true};
    if(method==='getChatMember')return roles.get(`${input.chat_id}:${input.user_id}`) || {status:[USER,BOT].includes(input.user_id)?'administrator':input.user_id===MEMBER?'member':'left'};
    if(method==='getChat')return {id:input.chat_id,type:'supergroup',title:'Community'};
    if(method==='sendMessage')return {message_id:100+calls.filter(item=>item.method==='sendMessage').length,chat:{id:input.chat_id,type:'supergroup'}};
    throw new Error('Unexpected API call');
  }};
  const service=createOperationsService({db,api,clock:()=>current});
  const requestId=()=>`operation_request_${++sequence}`;
  const perform=(action,input={},extra={})=>service.perform({actor,chatId:CHAT,action,input,requestId:requestId(),...extra});
  const schedule=(extra={})=>perform('schedule_create',{text:'An announcement',runAt:current+60,repeat:'once',language:'en',confirmed:true,...extra});
  const event=(extra={})=>perform('event_create',{title:'Meet the group',description:'Bring your questions',startsAt:current+3600,endsAt:current+7200,language:'en',...extra});
  return {db,store,service,api,roles,calls,hooks,perform,schedule,event,requestId,now:()=>current,advance:n=>{current+=n;},setTime:n=>{current=n;},sends:()=>calls.filter(item=>item.method==='sendMessage'),another:()=>createOperationsService({db,api,clock:()=>current}),query:(view='operations',extra={})=>service.query({actor,chatId:CHAT,view,...extra}),row:id=>store.first('SELECT * FROM pilot_schedules WHERE id=?',id)};
}

test('operations schema matches migration and can initialize independently',async t=>{
  const f=fixture(t);await f.store.ensure();await createOperationsStore(f.db).ensure();
  assert.equal((await readFile(new URL('../migrations/0007_operations.sql',import.meta.url),'utf8')).trim(),OPERATIONS_SCHEMA_SQL.trim());
  assert.equal(await f.service.nextRunAt(CHAT),null);
  assert.deepEqual(await f.service.nextDueGroups(),[]);
});

test('admin views and writes fail closed, including replay after demotion',async t=>{
  const f=fixture(t),req=f.requestId(),input={text:'Hello',runAt:f.now()+60,confirmed:true};
  await f.perform('schedule_create',input,{requestId:req});
  f.roles.set(`${CHAT}:${USER}`,{status:'member'});
  await assert.rejects(f.query(),code('forbidden'));
  await assert.rejects(f.perform('schedule_create',input,{requestId:req}),code('forbidden'));
  await assert.rejects(f.query('events',{actor:{id:OTHER}}),code('forbidden'));
  assert.equal(f.sends().length,0);
  f.hooks.set('getChatMember',()=>{throw new Error('sensitive transport detail');});
  await assert.rejects(f.query(),error=>error.code==='authorization_unavailable'&&!error.message.includes('sensitive'));
});

test('validation requires explicit confirmation, bounded text/time and safe URLs',async t=>{
  const f=fixture(t);
  for(const value of [
    {confirmed:false},{runAt:f.now()+10},{runAt:f.now()+366*86400},{runAt:NaN},{text:'x'.repeat(3801)},{text:'\u0000secret'},{repeat:'hourly'},{language:'zz'},{chat_id:SECOND},
  ])await assert.rejects(f.schedule(value),error=>error instanceof OperationsError);
  await assert.rejects(f.perform('event_create',{title:'Event',startsAt:f.now()+3600,url:'javascript:alert(1)'}),code('invalid_url'));
  await assert.rejects(f.perform('event_create',{title:'Event',startsAt:f.now()+3600,url:'https://name:secret@example.org'}),code('invalid_url'));
  await assert.rejects(f.perform('highlight_add',{text:'hi'},{actor:{id:USER,is_bot:true}}),code('unauthorized'));
  await assert.rejects(f.perform('highlight_add',{text:'hi'},{chatId:1}),code('invalid_chat'));
  assert.equal(f.sends().length,0);
});

test('idempotent mutation replays after due time and conflicting input is rejected',async t=>{
  const f=fixture(t),input={text:'Original',runAt:f.now()+60,confirmed:true},requestId=f.requestId();
  const one=await f.perform('schedule_create',input,{requestId});
  f.advance(86400);
  const replay=await f.perform('schedule_create',input,{requestId});
  assert.equal(replay.id,one.id);assert.equal(replay.duplicate,true);
  assert.equal((await f.store.all('SELECT * FROM pilot_schedules')).length,1);
  await assert.rejects(f.perform('schedule_create',{...input,text:'Changed'},{requestId}),code('request_conflict'));
});

test('one-time schedules send plain text exactly once and preserve their delivery evidence',async t=>{
  const f=fixture(t),job=await f.schedule({text:'<b>Literal markup</b> & details'});
  assert.equal(await f.service.nextRunAt(CHAT),f.now()+60);
  assert.deepEqual(await f.service.nextDueGroups(),[String(CHAT)]);
  assert.equal((await f.service.drain(CHAT)).results.length,0);
  f.advance(60);const sent=await f.service.drain(CHAT);
  assert.equal(sent.results[0].status,'sent');assert.equal((await f.row(job.id)).status,'completed');
  assert.equal(f.sends()[0].input.text,'<b>Literal markup</b> & details');
  assert.equal(f.sends()[0].input.parse_mode,undefined);assert.equal(f.sends()[0].input.chat_id,CHAT);
  f.advance(500);await f.service.drain(CHAT);await f.another().drain(CHAT);
  assert.equal(f.sends().length,1);assert.equal(await f.service.nextRunAt(CHAT),null);
  const panel=await f.query();assert.equal(panel.deliveries[0].status,'sent');assert.equal(panel.deliveries[0].message_id,101);
});

test('recurring schedules preserve EAT wall time and skip missed intervals',async t=>{
  const f=fixture(t),job=await f.schedule({repeat:'daily'}),first=f.now()+60;
  f.setTime(first+2*86400+100);await f.service.drain(CHAT);
  const row=await f.row(job.id);
  assert.equal(row.run_at,first+3*86400);assert.equal(row.status,'pending');assert.equal(row.sent_count,1);
  assert.equal(row.expires_at,first+90*86400);
  assert.equal((row.run_at+3*3600)%86400,(first+3*3600)%86400);
  f.setTime(row.expires_at+1);await f.service.drain(CHAT);
  assert.equal((await f.row(job.id)).status,'completed');assert.equal(f.sends().length,1);
});

test('an overdue one-time announcement expires after 24 hours without catch-up delivery',async t=>{
  const f=fixture(t),job=await f.schedule();
  f.advance(60+86401);const result=await f.service.drain(CHAT);
  assert.deepEqual(result.results,[]);assert.equal(f.sends().length,0);
  assert.equal((await f.row(job.id)).error_kind,'schedule_expired');
});

test('scheduler rechecks creator and bot permissions at delivery',async t=>{
  const f=fixture(t),job=await f.schedule();f.advance(60);
  f.roles.set(`${CHAT}:${USER}`,{status:'member'});await f.service.drain(CHAT);
  assert.equal((await f.row(job.id)).error_kind,'creator_not_admin');assert.equal(f.sends().length,0);
  f.roles.set(`${CHAT}:${USER}`,{status:'administrator'});
  const second=await f.schedule();f.advance(60);f.roles.set(`${CHAT}:${BOT}`,{status:'member'});
  await f.service.drain(CHAT);assert.equal((await f.row(second.id)).error_kind,'bot_permission');assert.equal(f.sends().length,0);
});

test('temporary read failures retry preflight only, then pause without sending',async t=>{
  const f=fixture(t),job=await f.schedule();f.advance(60);
  f.hooks.set('getChatMember',()=>{throw new Error('unavailable');});
  for(let index=0;index<3;index++){await f.service.drain(CHAT);f.advance(60);}
  const row=await f.row(job.id);assert.equal(row.read_failures,3);assert.equal(row.status,'paused');assert.equal(f.sends().length,0);
});

test('an ambiguous send is never retried automatically, including after coordinator restart',async t=>{
  const f=fixture(t),job=await f.schedule();f.advance(60);
  f.hooks.set('sendMessage',()=>{throw new TelegramError('timeout',0,true);});
  await f.service.drain(CHAT);assert.equal((await f.row(job.id)).status,'unknown');
  f.advance(10000);await f.another().drain(CHAT);
  assert.equal(f.sends().length,1);assert.equal(await f.service.nextRunAt(CHAT),null);
  await assert.rejects(f.perform('schedule_update',{id:job.id,text:'Retry',runAt:f.now()+60,confirmed:true}),code('operation_stale'));
});

test('a successful send with failed database confirmation becomes unknown, not a second send',async t=>{
  const f=fixture(t),job=await f.schedule();f.advance(60);
  const batch=f.db.batch.bind(f.db);let failed=false;
  f.db.batch=async statements=>{
    if(!failed&&statements.some(item=>item.sql.includes('INSERT INTO pilot_schedule_deliveries')&&item.values[2]==='sent')){failed=true;throw new Error('write unavailable');}
    return batch(statements);
  };
  await f.service.drain(CHAT);assert.equal((await f.row(job.id)).status,'unknown');
  f.advance(1000);await f.service.drain(CHAT);assert.equal(f.sends().length,1);
});

test('stale sending leases become unknown; stale preflight checks can resume safely',async t=>{
  const f=fixture(t),one=await f.schedule();f.advance(60);
  await f.store.run("UPDATE pilot_schedules SET status='sending',claimed_at=?,lease_token='old' WHERE id=?",f.now()-121,one.id);
  await f.service.drain(CHAT);assert.equal((await f.row(one.id)).status,'unknown');assert.equal(f.sends().length,0);
  const two=await f.schedule();f.advance(60);
  await f.store.run("UPDATE pilot_schedules SET status='checking',claimed_at=?,lease_token='old' WHERE id=?",f.now()-121,two.id);
  await f.service.drain(CHAT);assert.equal((await f.row(two.id)).status,'completed');assert.equal(f.sends().length,1);
});

test('definite rate limits retry at Telegram retry_after but cap attempts',async t=>{
  const f=fixture(t),job=await f.schedule();f.advance(60);
  f.hooks.set('sendMessage',()=>{throw new TelegramError('rate limit',429,false,17);});
  for(let index=0;index<3;index++){
    await f.service.drain(CHAT);
    assert.equal((await f.row(job.id)).next_attempt_at,f.now()+17);
    f.advance(17);
  }
  assert.equal((await f.row(job.id)).status,'paused');assert.equal(f.sends().length,3);
  await f.service.drain(CHAT);assert.equal(f.sends().length,3);
});

test('definite message rejection pauses a schedule without blind retries',async t=>{
  const f=fixture(t),job=await f.schedule();f.advance(60);
  f.hooks.set('sendMessage',()=>{throw new TelegramError('forbidden',403,false);});
  await f.service.drain(CHAT);f.advance(200);await f.service.drain(CHAT);
  assert.equal((await f.row(job.id)).status,'paused');assert.equal(f.sends().length,1);
});

test('two concurrent workers cannot send the same occurrence twice',async t=>{
  const f=fixture(t);await f.schedule();f.advance(60);
  await Promise.all([f.service.drain(CHAT),f.another().drain(CHAT)]);
  assert.equal(f.sends().length,1);
});

test('schedule edits transfer future sending authority and cancellation stays group scoped',async t=>{
  const f=fixture(t),job=await f.schedule();
  await assert.rejects(f.perform('schedule_cancel',{id:job.id},{chatId:SECOND}),code('not_found'));
  f.roles.set(`${CHAT}:${MEMBER}`,{status:'administrator'});
  await f.perform('schedule_update',{id:job.id,text:'Edited',runAt:f.now()+120,repeat:'weekly',confirmed:true},{actor:{id:MEMBER}});
  assert.equal((await f.row(job.id)).creator_id,String(MEMBER));
  await f.perform('schedule_cancel',{id:job.id});f.advance(500);await f.service.drain(CHAT);
  assert.equal((await f.row(job.id)).status,'cancelled');assert.equal(f.sends().length,0);
});

test('RSVPs expose only aggregate counts and the current member response',async t=>{
  const f=fixture(t),event=await f.event();
  await f.perform('event_rsvp',{id:event.id,response:'going'},{actor:{id:MEMBER}});
  await f.perform('event_rsvp',{id:event.id,response:'maybe'});
  const response=await f.query('events',{actor:{id:MEMBER}}),item=response.events[0];
  assert.deepEqual(item.counts,{going:1,maybe:1,declined:0});assert.equal(item.response,'going');
  assert.equal('user_id' in item,false);assert.equal('creator_id' in item,false);assert.equal('audit' in response,false);
  const audit=(await f.query()).audit;assert.equal(audit.some(entry=>entry.action==='event_rsvp'),false);
  await f.perform('event_rsvp',{id:event.id,response:'declined'},{actor:{id:MEMBER}});
  assert.deepEqual((await f.query('events')).events[0].counts,{going:0,maybe:1,declined:1});
  await assert.rejects(f.perform('event_rsvp',{id:event.id,response:'going'},{actor:{id:OTHER}}),code('forbidden'));
});

test('cancelled, ended and cross-group events cannot accept RSVPs',async t=>{
  const f=fixture(t),one=await f.event();
  await assert.rejects(f.perform('event_rsvp',{id:one.id,response:'going'},{chatId:SECOND}),code('not_found'));
  await f.perform('event_cancel',{id:one.id});await assert.rejects(f.perform('event_rsvp',{id:one.id,response:'going'}),code('operation_stale'));
  const two=await f.event();f.advance(7201);await assert.rejects(f.perform('event_rsvp',{id:two.id,response:'going'}),code('event_ended'));
});

test('scheduled weekly highlights use only newly curated content and skip empty weeks',async t=>{
  const f=fixture(t);
  const highlight=await f.perform('highlight_add',{text:'A useful discussion',url:'https://example.org/reading'});
  const job=await f.perform('highlight_schedule',{runAt:f.now()+60,repeat:'weekly',language:'sw',confirmed:true});
  f.advance(60);await f.service.drain(CHAT);
  assert.match(f.sends()[0].input.text,/Muhtasari wa community wa wiki/);assert.match(f.sends()[0].input.text,/A useful discussion/);
  assert.equal((await f.store.first('SELECT sent_at FROM pilot_highlights WHERE id=?',highlight.id)).sent_at,f.now());
  f.advance(7*86400);const skipped=await f.service.drain(CHAT);
  assert.equal(skipped.results[0].status,'skipped');assert.equal(f.sends().length,1);
  assert.equal((await f.row(job.id)).status,'pending');
  await f.perform('highlight_add',{text:'Next week’s learning'});f.advance(7*86400);
  await f.service.drain(CHAT);assert.equal(f.sends().length,2);assert.doesNotMatch(f.sends()[1].input.text,/A useful discussion/);
});

test('explicit highlights freeze exactly the chosen content without reading other groups',async t=>{
  const f=fixture(t),one=await f.perform('highlight_add',{text:'Chosen item'}),two=await f.perform('highlight_add',{text:'Unchosen item'});
  const foreign=await f.perform('highlight_add',{text:'Private elsewhere'},{chatId:SECOND});
  await assert.rejects(f.perform('highlight_schedule',{ids:[foreign.id],runAt:f.now()+60,confirmed:true}),code('not_found'));
  const job=await f.perform('highlight_schedule',{ids:[one.id],runAt:f.now()+60,confirmed:true});
  await f.perform('highlight_remove',{id:one.id});f.advance(60);await f.service.drain(CHAT);
  assert.equal((await f.row(job.id)).kind,'announcement');assert.match(f.sends()[0].input.text,/Chosen item/);assert.doesNotMatch(f.sends()[0].input.text,/Unchosen|Private/);
  assert.ok(two.id);
});

test('per-group quotas and per-user mutation limits bound stored work',async t=>{
  const f=fixture(t);
  for(let index=0;index<20;index++)await f.schedule();
  await assert.rejects(f.schedule(),code('quota_exceeded'));
  const event=await f.event();
  for(let index=0;index<60;index++)await f.perform('event_rsvp',{id:event.id,response:'going'},{actor:{id:MEMBER}});
  await assert.rejects(f.perform('event_rsvp',{id:event.id,response:'going'},{actor:{id:MEMBER}}),code('rate_limited'));
});

test('retention removes past private records while retaining future schedules and events',async t=>{
  const f=fixture(t),old=await f.schedule(),event=await f.event();await f.perform('highlight_add',{text:'Old note'});
  await f.perform('event_rsvp',{id:event.id,response:'going'},{actor:{id:MEMBER}});
  f.advance(60);await f.service.drain(CHAT);
  const future=await f.schedule({runAt:f.now()+90*86400});
  f.advance(32*86400);await f.service.cleanup();
  assert.equal(await f.row(old.id),null);assert.ok(await f.row(future.id));
  assert.equal((await f.store.all('SELECT * FROM pilot_event_rsvps')).length,0);
  assert.equal((await f.store.all('SELECT * FROM pilot_highlights')).length,0);
  assert.equal((await f.store.all('SELECT * FROM pilot_operations_requests')).length,0);
});
