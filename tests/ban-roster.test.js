import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.js';
import { applySchema,createStore } from '../src/store.js';
import { createBanRoster,formatBanRoster,formatBanCheck,classifyBanLookupFailure } from '../src/ban-roster.js';

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

test('known Telegram API error kinds are classified without exposing raw provider details',async()=>{
  const examples=[
    [{code:400,message:'Bad Request: user not found secret=BOT_TOKEN'},'user_unavailable'],
    [{code:400,message:'Bad Request: member not found'},'user_unavailable'],
    [{code:400,message:'Bad Request: PARTICIPANT_ID_INVALID'},'user_unavailable'],
    [{code:403,message:'Forbidden'},'permission'],
    [{code:400,message:'Bad Request: not enough rights'},'permission'],
    [{code:429,message:'Too Many Requests',retryAfter:10},'rate_limited'],
    [{code:502,message:'Bad gateway'},'telegram_unavailable'],
    [{code:0,message:'Telegram unavailable',ambiguous:true},'telegram_unavailable'],
    [{code:400,message:'Some other reason'},'unknown'],
    [new Error('private password'), 'telegram_unavailable'],
  ];
  for(const [error,kind] of examples) assert.equal(classifyBanLookupFailure(error),kind);
});
test('unverified users show safe reasons and never leak raw Telegram error',async t=>{
  const f=await setup(t);
  await f.add(101);await f.add(102);
  const reasons=createBanRoster({db:f.db,clock:()=>NOW,api:{
    call:async(method,params)=>{
      if(params.user_id===101) throw {code:400,message:'Bad Request: user not found BOT_TOKEN=confidential'};
      throw {code:429,message:'Please wait secret-telegram-token',retryAfter:30};
    }
  }});
  const result=await reasons.list(CHAT);
  assert.equal(result.visible.length,0);
  assert.deepEqual(result.unverified.map(r=>r.reason),['user_unavailable','rate_limited']);
  const en=formatBanRoster(result,{language:'en'});
  assert.match(en,/Telegram could not resolve user identity/);
  assert.match(en,/Telegram rate limit/);
  assert.match(en,/NOT confirmed banned/);
  assert.doesNotMatch(en,/confidential|secret-telegram-token|Bad Request|BOT_TOKEN/);
  const sw=formatBanRoster(result,{language:'sw'});
  assert.match(sw,/Telegram imeshindwa kutambua user/);
  assert.match(sw,/Kikomo cha maombi ya Telegram/);
  assert.equal((await f.store.member(CHAT,101)).active_until,NOW+86400);
  assert.equal((await f.store.member(CHAT,102)).active_until,NOW+86400);
});

test('single-ID diagnostic confirms current Telegram ban and preserves history',async t=>{
  const f=await setup(t);
  await f.add(101,{until:NOW-86400});
  const before=await f.store.member(CHAT,101);
  const status=await f.roster.inspect(CHAT,101);
  assert.equal(status.known,true);
  assert.equal(status.pilotUntil,NOW-86400);
  assert.equal(status.telegram.kind,'banned');
  assert.equal(status.telegram.expired,true);
  const sw=formatBanCheck(status,{language:'sw',groupTitle:'<Group & Hub>'});
  assert.match(sw,/muda kuisha/i);
  assert.match(sw,/&lt;Group &amp; Hub&gt;/);
  assert.match(sw,/\/unban USER_ID/);
  assert.deepEqual(await f.store.member(CHAT,101),before);
  assert.equal(f.calls.filter(x=>x.method==='unbanChatMember').length,0);
});
test('diagnostic differentiates Telegram released state, later manual ban, and unknown API state',async t=>{
  const f=await setup(t);
  await f.add(101);
  f.users.set(101,{status:'left'});
  assert.match(formatBanCheck(await f.roster.inspect(CHAT,101),{language:'en'}),/NOT BANNED/);
  f.users.set(101,{status:'kicked',until_date:0});
  const changed=await f.roster.inspect(CHAT,101);
  assert.equal(changed.telegram.matchesPilot,false);
  assert.match(formatBanCheck(changed,{language:'en'}),/Another administrator may have changed it/);
  const broken=createBanRoster({db:f.db,clock:()=>NOW,api:{
    call:async()=>{throw {code:400,message:'Bad Request: user not found BOT_TOKEN private_secret'};}
  }});
  const status=await broken.inspect(CHAT,101);
  assert.equal(status.telegram.reason,'user_unavailable');
  const en=formatBanCheck(status,{language:'en'});
  assert.match(en,/UNVERIFIED/);
  assert.match(en,/Telegram could not resolve this user/);
  assert.doesNotMatch(en,/BOT_TOKEN|private_secret|Bad Request/);
  assert.ok((await f.store.member(CHAT,101)).active_until>0);
});
test('diagnostic never queries arbitrary unknown ID or writes new member state',async t=>{
  const f=await setup(t);
  const initial=f.calls.length;
  const unknown=await f.roster.inspect(CHAT,999);
  assert.equal(unknown.known,false);
  assert.match(formatBanCheck(unknown,{language:'en'}),/no moderation case/);
  assert.equal(f.calls.length,initial);
  assert.equal(await f.db.prepare('SELECT 1 FROM members WHERE chat_id=? AND user_id=?').bind(String(CHAT),'999').first(),null);
  assert.equal((await f.roster.inspect(CHAT,'invalid')).invalid,true);
});


test('admin bancheck verifies a Telegram no-post restriction even without an old ban case',async t=>{
  const f=await setup(t);
  await f.store.member(CHAT,101);
  await f.store.restriction(CHAT,101); // create additive schema
  await f.db.prepare('INSERT INTO member_restrictions(chat_id,user_id,level,until_date,episode_at,incident_id) VALUES(?,?,?,?,?,?)')
    .bind(String(CHAT),'101',2,NOW+43200,NOW-50,'restrict:2').run();
  f.users.set(101,{status:'restricted',is_member:true,can_send_messages:false,until_date:NOW+43200});
  const before=await f.store.restriction(CHAT,101);
  const result=await f.roster.inspect(CHAT,101);
  assert.equal(result.known,true);
  assert.deepEqual(result.restriction,{level:2,until:NOW+43200});
  assert.equal(result.telegram.kind,'restricted');
  assert.equal(result.telegram.matchesPilot,true);
  assert.equal(result.telegram.isMember,true);
  assert.equal(result.telegram.canPost,false);
  const en=formatBanCheck(result,{language:'en',groupTitle:'Tech <Hub>'});
  assert.match(en,/Pilot no-post restriction stage: 2\/5/);
  assert.match(en,/Telegram: RESTRICTED/);
  assert.match(en,/Posting: blocked/);
  assert.match(en,/Member remains in group: yes/);
  assert.match(en,/Tech &lt;Hub&gt;/);
  const sw=formatBanCheck(result,{language:'sw'});
  assert.match(sw,/Hatua ya Pilot ya kutopost: 2\/5/);
  assert.match(sw,/Telegram: AMEWEKEWA RESTRICTION/);
  assert.deepEqual(await f.store.restriction(CHAT,101),before);
  assert.equal(f.calls.filter(x=>x.method==='restrictChatMember'||x.method==='banChatMember').length,0);
});

test('admin diagnostic distinguishes an external restriction override from recorded Pilot stage',async t=>{
  const f=await setup(t);
  await f.store.member(CHAT,101);
  await f.store.restriction(CHAT,101);
  await f.db.prepare('INSERT INTO member_restrictions(chat_id,user_id,level,until_date) VALUES(?,?,?,?)')
    .bind(String(CHAT),'101',1,NOW+3600).run();
  f.users.set(101,{status:'restricted',is_member:true,can_send_messages:false,until_date:NOW+604800});
  const result=await f.roster.inspect(CHAT,101);
  assert.equal(result.telegram.matchesPilot,false);
  assert.match(formatBanCheck(result,{language:'en'}),/administrator may have changed it/);
  assert.equal((await f.store.restriction(CHAT,101)).level,1);
  assert.equal((await f.store.restriction(CHAT,101)).until_date,NOW+3600);
});

test('restriction expiry and unknown API state never turn into a claimed ban release',async t=>{
  const f=await setup(t);
  await f.store.member(CHAT,101);
  await f.store.restriction(CHAT,101);
  await f.db.prepare('INSERT INTO member_restrictions(chat_id,user_id,level,until_date) VALUES(?,?,?,?)')
    .bind(String(CHAT),'101',1,NOW-5).run();
  f.users.set(101,{status:'member'});
  const released=await f.roster.inspect(CHAT,101);
  assert.equal(released.telegram.kind,'not_banned');
  assert.match(formatBanCheck(released,{language:'en'}),/Telegram: NOT BANNED/);
  assert.match(formatBanCheck(released,{language:'en'}),/Pilot no-post restriction stage: 1\/5/);
  const unreachable=createBanRoster({db:f.db,clock:()=>NOW,
    api:{call:async()=>{throw {code:429,message:'secret TOKEN'};}}});
  const unknown=await unreachable.inspect(CHAT,101);
  assert.equal(unknown.telegram.kind,'unknown');
  assert.match(formatBanCheck(unknown,{language:'en'}),/Telegram: UNVERIFIED/);
  assert.doesNotMatch(formatBanCheck(unknown,{language:'en'}),/secret TOKEN/);
});
