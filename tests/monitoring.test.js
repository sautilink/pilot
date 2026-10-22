import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.js';
import {applySchema,createStore} from '../src/store.js';
import {createControlStore} from '../src/control-store.js';
import {createGuardrailStore} from '../src/guardrail-store.js';
import {runMonitoring,operationalHealth} from '../src/monitoring.js';
import {TelegramError} from '../src/telegram.js';

const NOW=1792620000,GROUP='-100123',ADMIN='102';
async function fixture(t) {
  const db=new TestD1();await applySchema(db);t.after(()=>db.close());
  const store=createStore(db),control=createControlStore(db),guards=createGuardrailStore(db);
  await store.settings({ready:'1'});await store.group(GROUP);await control.ensure();await guards.ensure();
  const calls=[],hooks=new Map();let now=NOW;
  const api={async call(method,p={}){
    calls.push({method,p:structuredClone(p)});if(hooks.has(method)) return hooks.get(method)(p);
    if(method==='getMe') return {id:900,is_bot:true,username:'sautilinkpilotbot'};
    if(method==='getChatMember') return {status:'administrator',can_delete_messages:true,can_restrict_members:true,can_invite_users:true};
    if(method==='getChat') return {id:Number(GROUP),title:'Private group <safe>'};
    if(method==='getWebhookInfo') return {pending_update_count:0};
    if(method==='sendMessage') return {message_id:calls.length+100};
    throw new Error('Unexpected method');
  }};
  return {db,store,control,guards,api,hooks,calls,run:()=>runMonitoring({db,api,clock:()=>now}),advance:n=>{now+=n;},of:method=>calls.filter(call=>call.method===method),subscribe:async({alerts=0,report='off',at=now}={})=>db.prepare('INSERT INTO pilot_subscriptions VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,chat_id) DO UPDATE SET alerts_enabled=excluded.alerts_enabled,report_frequency=excluded.report_frequency,updated_at=excluded.updated_at').bind(ADMIN,GROUP,alerts,report,0,at).run()};
}

test('monitoring sends nothing without a per-admin opt-in',async t=>{
  const f=await fixture(t);await f.store.run('UPDATE groups SET enabled=0');await f.run();
  assert.equal(f.of('sendMessage').length,0);
});

test('command-spam deletion failures are localized private alerts for opted-in admins',async t=>{
  for(const language of ['sw','en']) {
    const f=await fixture(t);await f.subscribe({alerts:1});await f.store.setLanguage('user',ADMIN,language,NOW);
    await f.guards.health(GROUP,'command_spam_action_failed',true,NOW);
    await f.run();
    assert.equal(f.of('sendMessage').length,1);
    assert.equal(f.of('sendMessage')[0].p.chat_id,Number(ADMIN));
    assert.match(f.of('sendMessage')[0].p.text,language==='en'?/Deletion of a command-spam message could not be confirmed/:/Ufutaji wa ujumbe wa spam ya commands haujathibitishwa/);
    assert.match(f.of('sendMessage')[0].p.text,language==='en'?/No restriction was applied/:/hakijaweka restriction yoyote/);
    f.advance(600);await f.run();assert.equal(f.of('sendMessage').length,1);
  }
});

test('alerts are private, localized, rate-limited and only for current admins',async t=>{
  const f=await fixture(t);await f.subscribe({alerts:1});await f.store.setLanguage('user',ADMIN,'en',NOW);
  await f.store.run('UPDATE groups SET enabled=0');await f.run();
  assert.equal(f.of('sendMessage').length,1);assert.equal(f.of('sendMessage')[0].p.chat_id,Number(ADMIN));
  assert.match(f.of('sendMessage')[0].p.text,/Moderation is paused/);assert.match(f.of('sendMessage')[0].p.text,/&lt;safe&gt;/);
  f.advance(600);await f.run();assert.equal(f.of('sendMessage').length,1);
  f.hooks.set('getChatMember',p=>p.user_id===Number(ADMIN)?{status:'member'}:{status:'administrator'});
  f.advance(90000);await f.run();assert.equal(f.of('sendMessage').length,1);
  assert.equal((await f.db.prepare('SELECT alerts_enabled FROM pilot_subscriptions').first()).alerts_enabled,0);
});

test('daily report waits one day and never exposes the original moderated text',async t=>{
  const f=await fixture(t);await f.subscribe({report:'daily'});await f.store.setLanguage('user',ADMIN,'en',NOW);
  await f.run();assert.equal(f.of('sendMessage').length,0);
  await f.store.plan({id:'case1',chat_id:GROUP,user_id:101,message_id:10,event_at:NOW+5,created_at:NOW+5,strike:1,until_date:NOW+86400,reasons:'["link"]'});
  await f.store.status('case1','confirmed');f.advance(86400);await f.run();
  assert.equal(f.of('sendMessage').length,1);assert.match(f.of('sendMessage')[0].p.text,/Confirmed bans: 1/);assert.match(f.of('sendMessage')[0].p.text,/Link violations: 1/);
  f.advance(600);await f.run();assert.equal(f.of('sendMessage').length,1);
});

test('lost report response is saved as unknown without a public fallback or duplicate retry',async t=>{
  const f=await fixture(t);await f.subscribe({report:'daily',at:NOW-90000});
  f.hooks.set('sendMessage',()=>{throw new TelegramError('Lost response',0,true);});
  await f.run();f.advance(601);await f.run();assert.equal(f.of('sendMessage').length,1);
  assert.equal(f.of('sendMessage')[0].p.chat_id,Number(ADMIN));
  assert.equal((await f.db.prepare('SELECT status FROM pilot_admin_deliveries').first()).status,'unknown');
});

test('a role revoked at the actual delivery boundary prevents sending group details',async t=>{
  const f=await fixture(t);await f.subscribe({alerts:1});await f.store.run('UPDATE groups SET enabled=0');
  let checks=0;f.hooks.set('getChatMember',p=>p.user_id===Number(ADMIN)?{status:++checks===1?'administrator':'member'}:{status:'administrator',can_delete_messages:true,can_restrict_members:true});
  await f.run();assert.equal(f.of('sendMessage').length,0);
});

test('operator health is aggregate and cleanup expires optional event records',async t=>{
  const f=await fixture(t);await f.guards.health(GROUP,'missing_permissions',true,NOW);
  await f.guards.claim({id:'old',chatId:GROUP,targetId:101,kind:'welcome',now:NOW-31*86400});
  await f.guards.run('INSERT INTO pilot_flood_events VALUES(?,?,?,?)',GROUP,'101','message:old',NOW-180);
  await f.guards.cleanup(NOW);
  assert.equal(await f.guards.first('SELECT id FROM pilot_guard_actions WHERE id=?','old'),null);
  assert.equal((await f.guards.first('SELECT COUNT(*) AS n FROM pilot_flood_events')).n,0);
  const status=await operationalHealth(f.db,NOW);assert.equal(status.groups,1);assert.ok(!JSON.stringify(status).includes(ADMIN));
});
