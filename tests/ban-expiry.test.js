import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.js';
import { applySchema, createStore } from '../src/store.js';
import { createBanExpiry } from '../src/ban-expiry.js';

const START=Date.UTC(2026,9,21,12)/1000;
const GROUP=-1001001,SECOND_GROUP=-1001002;

async function fixture(t) {
  const db=new TestD1(); await applySchema(db); t.after(()=>db.close());
  let now=START;
  const store=createStore(db),members=new Map(),calls=[],errors=new Set();
  const api={async call(method,params) {
    calls.push({method,params});
    const key=`${params.chat_id}:${params.user_id}`;
    if(errors.has(method)) throw new Error('Mock Telegram outage');
    if(method==='getChatMember') return members.get(key) || {status:'left'};
    if(method==='unbanChatMember') {members.set(key,{status:'left'});return true;}
    throw new Error('Unexpected Telegram method');
  }};
  const expiry=createBanExpiry({db,api,clock:()=>now});
  async function ban(user,{chat=GROUP,strike=1,until=now+(strike===1?86400:604800)}={}) {
    const id=`${chat}:message:${user}:${strike}:${now}`;
    const row=await store.plan({id,chat_id:chat,user_id:user,message_id:user,event_at:now,created_at:now,strike,until_date:until,reasons:'["link"]'});
    await store.confirm(row,now);
    members.set(`${chat}:${user}`,{status:'kicked',until_date:until});
    return row;
  }
  return {db,store,api,expiry,members,calls,errors,ban,now:()=>now,advance:seconds=>{now+=seconds;}};
}

test('24-hour ban is released after expiry and keeps the original strike',async t=>{
  const f=await fixture(t);
  await f.ban(101);
  assert.deepEqual(await f.expiry.dueGroups(),[]);
  assert.equal((await f.expiry.expireGroup(GROUP)).checked,0);
  f.advance(86401);
  assert.deepEqual(await f.expiry.dueGroups(),[String(GROUP)]);
  const result=await f.expiry.expireGroup(GROUP);
  assert.equal(result.unbanned,1);
  assert.deepEqual(f.calls.find(c=>c.method==='unbanChatMember').params,
    {chat_id:GROUP,user_id:101,only_if_banned:true});
  const member=await f.store.member(GROUP,101);
  assert.equal(member.active_until,0);
  assert.equal(member.strikes,1);
  assert.equal((await f.db.prepare('SELECT status FROM incidents').first()).status,'confirmed');
  assert.deepEqual(await f.expiry.dueGroups(),[]);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM pilot_health_events WHERE kind='ban_expiry_review' AND resolved_at=0").first()).n,0);
});

test('seven-day ban expires and a third permanent strike is never unbanned',async t=>{
  const f=await fixture(t);
  const second=await f.ban(102,{strike:2});
  await f.ban(103,{strike:3,until:0});
  f.advance(604801);
  const result=await f.expiry.expireGroup(GROUP);
  assert.equal(result.unbanned,1);
  assert.equal(f.calls.filter(c=>c.method==='unbanChatMember').length,1);
  assert.equal(f.calls.find(c=>c.method==='unbanChatMember').params.user_id,102);
  assert.equal((await f.store.member(GROUP,102)).strikes,2);
  assert.equal((await f.store.member(GROUP,103)).active_until,-1);
  assert.equal((await f.store.incident(second.id)).status,'confirmed');
});

test('manual newer bans with different dates or permanent duration are protected',async t=>{
  const f=await fixture(t);
  await f.ban(101);
  await f.ban(102);
  f.advance(86402);
  f.members.set(`${GROUP}:101`,{status:'kicked',until_date:0});
  f.members.set(`${GROUP}:102`,{status:'kicked',until_date:f.now()+30*86400});
  const result=await f.expiry.expireGroup(GROUP);
  assert.equal(result.conflicts,2);
  assert.equal(result.unbanned,0);
  assert.equal(f.calls.filter(c=>c.method==='unbanChatMember').length,0);
  assert.ok((await f.store.member(GROUP,101)).active_until>0);
  const health=await f.db.prepare("SELECT kind,resolved_at FROM pilot_health_events WHERE chat_id=? AND kind='ban_expiry_review'").bind(String(GROUP)).first();
  assert.equal(health.kind,'ban_expiry_review');
  assert.equal(health.resolved_at,0);
});

test('already unbanned user is reconciled without removing an existing member',async t=>{
  const f=await fixture(t);
  await f.ban(101);
  f.advance(86401);
  f.members.set(`${GROUP}:101`,{status:'member'});
  assert.equal((await f.expiry.expireGroup(GROUP)).alreadyReleased,1);
  assert.equal(f.calls.filter(c=>c.method==='unbanChatMember').length,0);
  assert.equal((await f.store.member(GROUP,101)).active_until,0);
});

test('failed unban is retried on the next sweep',async t=>{
  const f=await fixture(t);
  await f.ban(101);
  f.advance(86401);
  f.errors.add('unbanChatMember');
  assert.equal((await f.expiry.expireGroup(GROUP)).failed,1);
  assert.ok((await f.store.member(GROUP,101)).active_until>0);
  f.errors.delete('unbanChatMember');
  assert.equal((await f.expiry.expireGroup(GROUP)).unbanned,1);
  const resolved=await f.db.prepare("SELECT resolved_at FROM pilot_health_events WHERE chat_id=? AND kind='ban_expiry_review'").bind(String(GROUP)).first();
  assert.equal(resolved.resolved_at,f.now());
});

test('admin overrides cancelled incidents and permanent bans are excluded',async t=>{
  const f=await fixture(t);
  await f.ban(101);
  await f.ban(102,{strike:2});
  await f.ban(103,{strike:3,until:0});
  await f.store.override(GROUP,101,f.now()+1);
  await f.store.status((await f.store.member(GROUP,102)).last_incident,'cancelled');
  f.advance(604801);
  assert.deepEqual(await f.expiry.dueGroups(),[]);
  assert.equal((await f.expiry.expireGroup(GROUP)).checked,0);
});

test('rotating cursors check all groups and members without starvation',async t=>{
  const f=await fixture(t);
  for(const user of [101,102,103]) await f.ban(user);
  await f.ban(201,{chat:SECOND_GROUP});
  f.advance(86401);
  const groups=new Set();
  for(let i=0;i<3;i++) for(const chat of await f.expiry.dueGroups({limit:1})) groups.add(chat);
  assert.deepEqual(groups,new Set([String(GROUP),String(SECOND_GROUP)]));
  const users=new Set();
  for(let i=0;i<4;i++) {
    const start=f.calls.length;
    await f.expiry.expireGroup(GROUP,{limit:1});
    for(const call of f.calls.slice(start)) if(call.method==='unbanChatMember') users.add(call.params.user_id);
  }
  assert.deepEqual(users,new Set([101,102,103]));
});

test('failed Telegram membership read raises a temporary-ban health alert',async t=>{
  const f=await fixture(t);
  await f.ban(101);
  f.advance(86402);
  f.errors.add('getChatMember');
  assert.equal((await f.expiry.expireGroup(GROUP)).failed,1);
  assert.equal((await f.db.prepare("SELECT resolved_at FROM pilot_health_events WHERE kind='ban_expiry_review'").first()).resolved_at,0);
  assert.equal(f.calls.filter(c=>c.method==='unbanChatMember').length,0);
  f.errors.delete('getChatMember');
  assert.equal((await f.expiry.expireGroup(GROUP)).unbanned,1);
  assert.equal((await f.db.prepare("SELECT resolved_at FROM pilot_health_events WHERE kind='ban_expiry_review'").first()).resolved_at,f.now());
});

test('read-only admin status counts overdue Pilot bans and records the scheduled sweep',async t=>{
  const f=await fixture(t);
  await f.ban(101);
  f.advance(86401);
  assert.deepEqual(await f.expiry.status(GROUP),{lastScanAt:0,pending:1});
  await f.expiry.dueGroups();
  assert.deepEqual(await f.expiry.status(GROUP),{lastScanAt:f.now(),pending:1});
  assert.equal((await f.expiry.expireGroup(GROUP)).unbanned,1);
  assert.deepEqual(await f.expiry.status(GROUP),{lastScanAt:f.now(),pending:0});
  assert.deepEqual(await f.expiry.status('invalid'),{lastScanAt:0,pending:null});
});
