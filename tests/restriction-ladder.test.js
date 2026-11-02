import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.js';
import {applySchema,createStore} from '../src/store.js';
import {createModerator} from '../src/moderator.js';
import {restrictionDuration,NO_POST_PERMISSIONS} from '../src/policy.js';
import {TelegramError} from '../src/telegram.js';

const GROUP=-1001001,OTHER=-1001002,USER=101,BOT=900,START=1800000000;
async function fixture(t) {
  const db=new TestD1();await applySchema(db);t.after(()=>db.close());
  const store=createStore(db),calls=[],members=new Map(),hooks=new Map();
  let now=START,update=0,message=0,notice=5000;
  const member=(chat,user,status='member',extra={})=>{
    const row={status,user:{id:user,first_name:'Member'},...extra};
    members.set(`${chat}:${user}`,row);return row;
  };
  const api={async call(method,params={}) {
    calls.push({method,params:structuredClone(params)});
    if(hooks.has(method)) return hooks.get(method)(params);
    if(method==='getMe')return {id:BOT,is_bot:true,username:'sautilinkpilotbot'};
    if(method==='getChat')return {id:params.chat_id,type:'supergroup',linked_chat_id:-1002002};
    if(method==='getChatMember'){
      if(params.user_id===BOT)return {status:'administrator',can_delete_messages:true,can_restrict_members:true};
      let row=members.get(`${params.chat_id}:${params.user_id}`)||member(params.chat_id,params.user_id);
      if(['restricted','kicked'].includes(row.status)&&row.until_date>0&&row.until_date<=now)row=member(params.chat_id,params.user_id);
      return row;
    }
    if(method==='restrictChatMember'){
      member(params.chat_id,params.user_id,'restricted',{is_member:true,until_date:params.until_date,can_send_messages:false});
      return true;
    }
    if(method==='banChatMember'){
      member(params.chat_id,params.user_id,'kicked',{until_date:params.until_date});return true;
    }
    if(method==='unbanChatMember'){member(params.chat_id,params.user_id,'left');return true;}
    if(method==='deleteMessage')return true;
    if(method==='sendMessage')return {message_id:notice++,chat:{id:params.chat_id}};
    throw new Error('Unexpected Telegram method: '+method);
  }};
  const moderator=createModerator({db,api,clock:()=>now});
  const send=(overrides={})=>({update_id:++update,message:{
    message_id:++message,date:now,
    chat:{id:GROUP,type:'supergroup',title:'Demo'},
    from:{id:USER,is_bot:false,first_name:'Member'},
    text:'https://unapproved.example/link',
    ...overrides
  }});
  return {db,store,api,moderator,send,calls,members,hooks,
    advance:time=>{now+=time;},now:()=>now,
    callsOf:method=>calls.filter(c=>c.method===method),
    getRestriction:(chat=GROUP)=>store.restriction(chat,USER)};
}

test('Telegram posting restrictions use proper temporary permissions and never remove member',async t=>{
  const f=await fixture(t);
  await f.moderator.handle(f.send());
  f.advance(2);
  const result=await f.moderator.handle(f.send());
  assert.equal(result.status,'restricted');
  const restrictions=f.callsOf('restrictChatMember');
  assert.equal(restrictions.length,1);
  const payload=restrictions[0].params;
  assert.equal(payload.chat_id,GROUP);assert.equal(payload.user_id,USER);
  assert.equal(payload.until_date,f.now()+3600);
  assert.equal(payload.use_independent_chat_permissions,true);
  assert.deepEqual(payload.permissions,NO_POST_PERMISSIONS);
  assert.equal(f.callsOf('banChatMember').length,0);
  assert.equal(f.members.get(`${GROUP}:${USER}`).is_member,true);
  assert.equal(f.members.get(`${GROUP}:${USER}`).can_send_messages,false);
  assert.equal((await f.store.member(GROUP,USER)).strikes,0);
  assert.equal((await f.getRestriction()).level,1);
  const summary=f.callsOf('sendMessage').at(-1).params.text;
  assert.match(summary,/RESTRICTION|AMEWEKEWA RESTRICTION/);
  assert.match(summary,/1\/5/);
  assert.doesNotMatch(summary,/MEMBER BANNED|MEMBER AMEFUNGIWA/);
});

test('full warning + five escalating restrictions + three bans with correct clock and retained history',async t=>{
  const f=await fixture(t);
  await f.moderator.handle(f.send());
  for(let level=1;level<=5;level++){
    f.advance(level===1?2:restrictionDuration(level-1)+5);
    const result=await f.moderator.handle(f.send());
    assert.equal(result.status,'restricted',`restriction ${level}`);
    assert.equal(f.callsOf('restrictChatMember').length,level);
    assert.equal(f.callsOf('restrictChatMember').at(-1).params.until_date,
      f.now()+restrictionDuration(level));
    assert.equal((await f.getRestriction()).level,level);
    assert.equal((await f.store.member(GROUP,USER)).strikes,0);
  }
  const last=f.callsOf('restrictChatMember').at(-1).params.until_date;
  f.advance(restrictionDuration(5)+5);
  await f.moderator.handle(f.send());
  assert.equal(f.callsOf('banChatMember').length,1);
  assert.equal(f.callsOf('banChatMember')[0].params.until_date,f.now()+86400);
  assert.equal((await f.getRestriction()).level,5);
  assert.equal((await f.store.member(GROUP,USER)).strikes,1);
  f.advance(86405);
  await f.moderator.handle(f.send());
  assert.equal(f.callsOf('banChatMember')[1].params.until_date,f.now()+604800);
  f.advance(604805);
  await f.moderator.handle(f.send());
  assert.equal(f.callsOf('banChatMember')[2].params.until_date,0);
  assert.equal((await f.store.member(GROUP,USER)).strikes,3);
  assert.equal((await f.store.member(GROUP,USER)).active_until,-1);
  assert.equal(f.callsOf('restrictChatMember').length,5);
  assert.ok(last< f.now());
});

test('new violations while restriction is active are deleted without advancing the ladder',async t=>{
  const f=await fixture(t);
  await f.moderator.handle(f.send());f.advance(1);await f.moderator.handle(f.send());
  const level=(await f.getRestriction()).level;
  const initial=f.callsOf('restrictChatMember').length;
  f.advance(30);
  const result=await f.moderator.handle(f.send());
  assert.equal(result.status,'restriction_active');
  assert.equal(f.callsOf('restrictChatMember').length,initial);
  assert.equal(f.callsOf('banChatMember').length,0);
  assert.equal((await f.getRestriction()).level,level);
});

test('forward-only preserves existing ban sequence; legacy link violations use restrictions',async t=>{
  const f=await fixture(t);
  await f.moderator.handle(f.send({text:'plain forward',forward_origin:{type:'hidden_user',date:START-1}}));
  assert.equal(f.callsOf('banChatMember').length,1);
  assert.equal(f.callsOf('restrictChatMember').length,0);
  const g=await fixture(t);
  await g.store.member(GROUP,USER);
  await g.store.run('UPDATE members SET strikes=1,episode_at=? WHERE chat_id=? AND user_id=?',
    START-30,String(GROUP),String(USER));
  await g.moderator.handle(g.send()); // introductory warning still applies
  g.advance(2);
  await g.moderator.handle(g.send());
  assert.equal(g.callsOf('restrictChatMember').length,1);
  assert.equal(g.callsOf('restrictChatMember')[0].params.until_date,g.now()+3600);
  assert.equal(g.callsOf('banChatMember').length,0);
  assert.equal((await g.store.member(GROUP,USER)).strikes,1);
  assert.equal((await g.getRestriction()).level,1);
});

test('definite restriction rejection does not increment level or announce success',async t=>{
  const f=await fixture(t);
  await f.moderator.handle(f.send());f.advance(2);
  f.hooks.set('restrictChatMember',()=>{throw new TelegramError('Forbidden',403,false);});
  const result=await f.moderator.handle(f.send());
  assert.equal(result.status,'failed');
  assert.equal((await f.getRestriction()).level,0);
  assert.equal(f.callsOf('sendMessage').length,1);
  assert.equal(f.callsOf('banChatMember').length,0);
});
test('ambiguous restriction response is never blindly retried',async t=>{
  const f=await fixture(t);
  await f.moderator.handle(f.send());f.advance(2);
  const update=f.send();
  f.hooks.set('restrictChatMember',()=>{throw new TelegramError('Timeout',0,true);});
  const first=await f.moderator.handle(update);
  assert.equal(first.status,'uncertain');
  assert.equal((await f.getRestriction()).level,0);
  f.hooks.delete('restrictChatMember');
  await f.moderator.handle(structuredClone(update));
  assert.equal(f.callsOf('restrictChatMember').length,1);
  assert.equal((await f.getRestriction()).level,0);
});
test('forgive resets restriction ladder in one group without changing another',async t=>{
  const f=await fixture(t);
  await f.moderator.handle(f.send());f.advance(2);await f.moderator.handle(f.send());
  assert.equal((await f.getRestriction()).level,1);
  await f.store.override(GROUP,USER,f.now()+1,true);
  assert.equal((await f.getRestriction()).level,0);
  assert.equal((await f.getRestriction(OTHER)).level,0);
});

test('lost response after Telegram actually restricted user safely reconciles with exactly one API mutation',async t=>{
  const f=await fixture(t);
  await f.moderator.handle(f.send());
  f.advance(2);
  const update=f.send();
  f.hooks.set('restrictChatMember',params=>{
    f.members.set(`${params.chat_id}:${params.user_id}`,{
      status:'restricted',is_member:true,until_date:params.until_date,can_send_messages:false,
      user:{id:params.user_id,first_name:'Member'}
    });
    throw new TelegramError('Response lost after Telegram success',0,true);
  });
  const uncertain=await f.moderator.handle(update);
  assert.equal(uncertain.status,'uncertain');
  assert.equal((await f.getRestriction()).level,0);
  f.hooks.delete('restrictChatMember');
  const retried=await f.moderator.handle(structuredClone(update));
  assert.equal(retried.status,'restricted');
  assert.equal(f.callsOf('restrictChatMember').length,1);
  assert.equal((await f.getRestriction()).level,1);
  assert.equal(f.callsOf('banChatMember').length,0);
  const incident=await f.store.incident(`${GROUP}:message:${update.message.message_id}`);
  assert.equal(incident.status,'restricted');
  const again=await f.moderator.handle(structuredClone(update));
  assert.equal(again.status,'duplicate');
  assert.equal(f.callsOf('restrictChatMember').length,1);
});

async function seedLegacyBan(f,level) {
  const eventAt=START-20*86400;
  const row=await f.store.plan({
    id:'legacy-ban-'+level,chat_id:GROUP,user_id:USER,message_id:900+level,
    event_at:eventAt,created_at:eventAt,strike:level,
    until_date:eventAt+(level===1?86400:604800),reasons:'["link"]'
  });
  await f.store.confirm(row,eventAt);
  assert.equal((await f.store.member(GROUP,USER)).strikes,level);
}

test('existing 1/3 ban history starts with a warning then restriction 1/5, never another ban',async t=>{
  const f=await fixture(t);
  await seedLegacyBan(f,1);
  const first=await f.moderator.handle(f.send());
  assert.equal(first.status,'warned');
  assert.equal(f.callsOf('banChatMember').length,0);
  assert.equal(f.callsOf('restrictChatMember').length,0);
  assert.equal((await f.store.member(GROUP,USER)).strikes,1);
  f.advance(3);
  const second=await f.moderator.handle(f.send());
  assert.equal(second.status,'restricted');
  assert.equal(f.callsOf('restrictChatMember').length,1);
  assert.equal(f.callsOf('restrictChatMember')[0].params.until_date,f.now()+3600);
  assert.equal(f.callsOf('banChatMember').length,0);
  assert.equal((await f.getRestriction()).level,1);
  assert.equal((await f.store.member(GROUP,USER)).strikes,1);
  assert.match(f.callsOf('sendMessage').at(-1).params.text,/1\/5/);
});

test('existing 2/3 ban history must complete five restrictions before the next ban',async t=>{
  const f=await fixture(t);
  await seedLegacyBan(f,2);
  await f.moderator.handle(f.send());
  for(let level=1;level<=5;level++) {
    f.advance(level===1?3:restrictionDuration(level-1)+3);
    assert.equal((await f.moderator.handle(f.send())).status,'restricted');
    assert.equal(f.callsOf('restrictChatMember').length,level);
    assert.equal((await f.getRestriction()).level,level);
    assert.equal((await f.store.member(GROUP,USER)).strikes,2);
    assert.equal(f.callsOf('banChatMember').length,0);
  }
  f.advance(restrictionDuration(5)+3);
  assert.equal((await f.moderator.handle(f.send())).status,'confirmed');
  assert.equal(f.callsOf('banChatMember').length,1);
  assert.equal(f.callsOf('banChatMember')[0].params.until_date,0);
  assert.equal((await f.store.member(GROUP,USER)).strikes,3);
});

test('a member with historic strikes and a previously delivered warning starts at restriction 1/5',async t=>{
  const f=await fixture(t);
  await seedLegacyBan(f,1);
  const initial=f.send();
  await f.moderator.handle(initial);
  f.advance(3);
  const check=await f.moderator.handle(f.send());
  assert.equal(check.status,'restricted');
  assert.equal(f.callsOf('banChatMember').length,0);
  assert.equal((await f.getRestriction()).level,1);
});

test('queued legacy ban plan is reclassified before Telegram is asked to punish member',async t=>{
  const f=await fixture(t);
  await seedLegacyBan(f,1);
  await f.moderator.handle(f.send());
  f.advance(4);
  const pending=f.send();
  const id=`${GROUP}:message:${pending.message.message_id}`;
  await f.store.plan({
    id,chat_id:GROUP,user_id:USER,message_id:pending.message.message_id,
    event_at:pending.message.date,created_at:f.now(),strike:2,
    until_date:f.now()+604800,reasons:'["link"]'
  });
  const action=await f.moderator.handle(pending);
  assert.equal(action.status,'restricted');
  const row=await f.store.incident(id);
  assert.equal(row.strike,-1);
  assert.equal(row.status,'restricted');
  assert.equal(f.callsOf('restrictChatMember').length,1);
  assert.equal(f.callsOf('banChatMember').length,0);
  assert.equal((await f.store.member(GROUP,USER)).strikes,1);
});

test('already active legacy ban is not lifted or converted to a restriction',async t=>{
  const f=await fixture(t);
  await f.store.member(GROUP,USER);
  const ban=await f.store.plan({
    id:'active-legacy',chat_id:GROUP,user_id:USER,message_id:991,
    event_at:START-5,created_at:START-5,strike:1,
    until_date:START+86400,reasons:'["link"]'
  });
  await f.store.confirm(ban,START-5);
  f.members.set(`${GROUP}:${USER}`,{status:'kicked',user:{id:USER},until_date:START+86400});
  const result=await f.moderator.handle(f.send());
  assert.notEqual(result.status,'restricted');
  assert.equal(f.callsOf('restrictChatMember').length,0);
  assert.equal(f.callsOf('unbanChatMember').length,0);
  assert.equal((await f.store.member(GROUP,USER)).strikes,1);
});

test('forward-only after legacy ban still follows the existing ban strike escalation',async t=>{
  const f=await fixture(t);
  await seedLegacyBan(f,1);
  const result=await f.moderator.handle(f.send({text:'plain forwarded text',forward_origin:{type:'hidden_user',date:START-100}}));
  assert.equal(result.status,'confirmed');
  assert.equal(f.callsOf('restrictChatMember').length,0);
  assert.equal(f.callsOf('banChatMember').length,1);
  assert.equal(f.callsOf('banChatMember')[0].params.until_date,f.now()+604800);
  assert.equal((await f.store.member(GROUP,USER)).strikes,2);
});
