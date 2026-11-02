import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.js';
import { applySchema,createStore } from '../src/store.js';
import { createBanRoster,formatBanRoster } from '../src/ban-roster.js';

const CHAT=-1001001,NOW=1800000000;
async function setup(t){
  const db=new TestD1();await applySchema(db);t.after(()=>db.close());
  const store=createStore(db),users=new Map(),calls=[];
  const api={async call(method,params){
    calls.push({method,params});
    if(method!=='getChatMember')throw new Error('Unexpected method');
    return users.get(params.user_id) || {status:'left'};
  }};
  const roster=createBanRoster({db,api,clock:()=>NOW});
  async function add(id,{strike=1,until=NOW+86400}={}){
    const row=await store.plan({id:'case:'+id,chat_id:CHAT,user_id:id,message_id:id,
      event_at:NOW-120,created_at:NOW-120,strike,until_date:until,reasons:'["link"]'});
    await store.confirm(row,NOW);
    users.set(id,{status:'kicked',until_date:until});
  }
  return {db,store,users,calls,roster,add};
}
test('only Telegram-confirmed Pilot-known bans appear, with safe dates and identifiers',async t=>{
  const f=await setup(t);
  await f.add(101);
  await f.add(102,{strike:3,until:0});
  await f.add(103);
  f.users.set(103,{status:'left'});
  const result=await f.roster.list(CHAT,1);
  assert.equal(result.checked,3);
  assert.deepEqual(result.visible.map(x=>x.userId),[102,101]);
  assert.equal(result.visible[0].until,0);
  assert.equal(result.visible[1].matchesPilot,true);
  const text=formatBanRoster(result,{groupTitle:'<Group & Friends>',language:'sw'});
  assert.match(text,/&lt;Group &amp; Friends&gt;/);
  assert.match(text,/Kudumu/);
  assert.match(text,/\/unban USER_ID/);
  assert.doesNotMatch(text,/<Group & Friends>/);
  assert.equal(f.calls.length,3);
});
test('Telegram override is labelled without modifying the member ban',async t=>{
  const f=await setup(t);await f.add(101);
  f.users.set(101,{status:'kicked',until_date:0});
  const result=await f.roster.list(CHAT,1);
  assert.equal(result.visible[0].matchesPilot,false);
  assert.match(formatBanRoster(result,{language:'en'}),/changed outside Pilot/);
  assert.equal(f.calls.filter(x=>x.method==='unbanChatMember').length,0);
  assert.equal((await f.store.member(CHAT,101)).active_until,NOW+86400);
});
test('pagination is bounded and group-scoped',async t=>{
  const f=await setup(t);
  for(let i=101;i<=111;i++)await f.add(i);
  assert.equal((await f.roster.list(CHAT,1)).visible.length,8);
  assert.equal((await f.roster.list(CHAT,1)).more,true);
  const second=await f.roster.list(CHAT,2);
  assert.equal(second.visible.length,3);
  assert.equal(second.more,false);
  assert.match(formatBanRoster(await f.roster.list(CHAT,1),{language:'en'}),/Next page: <code>\/bans 2<\/code>/);
  assert.equal((await f.roster.list(-1001099,1)).visible.length,0);
  assert.equal((await f.roster.list(CHAT,1001)).invalid,true);
  assert.equal((await f.roster.list(CHAT,-1)).invalid,true);
  assert.equal((await f.roster.list('bad',1)).invalid,true);
});
test('Telegram read failure cannot be mistaken for a confirmed ban',async t=>{
  const f=await setup(t);await f.add(101);
  const broken=createBanRoster({db:f.db,api:{call:async()=>{throw new Error('private provider secret')}},clock:()=>NOW});
  const result=await broken.list(CHAT);
  assert.equal(result.visible.length,0);assert.equal(result.unavailable,1);
  assert.doesNotMatch(formatBanRoster(result,{language:'en'}),/private provider secret/);
});

test('mixed live response: released members, unknown checks, and confirmed bans are distinguished',async t=>{
  const f=await setup(t);
  for(const id of [101,102,103,104,105,106,107,108]) await f.add(id);
  for(const id of [101,102,103,104,105,106]) f.users.set(id,{status:'left'});
  const mixed=createBanRoster({
    db:f.db,clock:()=>NOW,
    api:{call:async(method,params)=>{
      if(params.user_id===107 || params.user_id===108)throw new Error('token and private upstream details');
      return f.users.get(params.user_id);
    }}
  });
  const result=await mixed.list(CHAT);
  assert.equal(result.checked,8);
  assert.equal(result.released,6);
  assert.equal(result.unavailable,2);
  assert.equal(result.visible.length,0);
  assert.deepEqual(result.unverified.map(x=>x.userId),[107,108]);
  const summary=formatBanRoster(result,{language:'en',groupTitle:'Tech <group>'});
  assert.match(summary,/Banned now: 0 · Not banned: 6 · Unverified: 2/);
  assert.match(summary,/107/);assert.match(summary,/108/);
  assert.match(summary,/NOT confirmed banned/);
  assert.doesNotMatch(summary,/token and private upstream details/);
  assert.match(summary,/Tech &lt;group&gt;/);
});
test('permanent and unexpired bans take priority over stale expired records',async t=>{
  const f=await setup(t);
  for(let id=100;id<109;id++)await f.add(id,{until:NOW-100});
  await f.add(300,{until:NOW+3600});
  await f.add(310,{strike:3,until:0});
  const result=await f.roster.list(CHAT);
  assert.deepEqual(result.visible.slice(0,2).map(x=>x.userId),[310,300]);
  assert.equal(result.more,true);
  assert.deepEqual((await f.roster.list(CHAT,2)).visible.map(x=>x.userId).length,3);
});
test('Telegram membership checks run in bounded concurrency and retain order',async t=>{
  const f=await setup(t);
  for(let id=101;id<=108;id++)await f.add(id);
  let active=0,peak=0;
  const concurrent=createBanRoster({db:f.db,clock:()=>NOW,api:{
    call:async(method,params)=>{
      active++;peak=Math.max(peak,active);
      await Promise.resolve();await Promise.resolve();
      active--;return f.users.get(params.user_id);
    }
  }});
  const result=await concurrent.list(CHAT);
  assert.deepEqual(result.visible.map(x=>x.userId),[101,102,103,104,105,106,107,108]);
  assert.ok(peak>=2);
  assert.ok(peak<=3);
});
test('Telegram names are escaped and malformed membership responses stay unverified',async t=>{
  const f=await setup(t);
  await f.add(101);await f.add(102);
  f.users.set(101,{status:'kicked',until_date:NOW+86400,user:{first_name:'<Hidden &',last_name:'User>'}});
  f.users.set(102,{status:'kicked',user:{first_name:'No until date'}});
  const result=await f.roster.list(CHAT);
  assert.deepEqual(result.visible.map(x=>x.userId),[101]);
  assert.deepEqual(result.unverified.map(x=>x.userId),[102]);
  const summary=formatBanRoster(result,{language:'en'});
  assert.match(summary,/&lt;Hidden &amp; User&gt;/);
  assert.doesNotMatch(summary,/<Hidden &/);
  assert.match(summary,/102/);
  assert.equal((await f.store.member(CHAT,102)).active_until,NOW+86400);
});
