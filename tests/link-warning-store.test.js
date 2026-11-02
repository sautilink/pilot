import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {TestD1} from './helpers/d1.js';
import {applySchema, createStore, LINK_WARNING_SCHEMA_SQL, SCHEMA_SQL} from '../src/store.js';

const CHAT=-1001122, USER=101, NOW=1792660000;
const warning=(extra={})=>({id:`${CHAT}:message:11`,chat_id:CHAT,user_id:USER,message_id:11,event_at:NOW,created_at:NOW,strike:0,until_date:0,reasons:'["link"]',...extra});
async function fixture(t) {
  const db=new TestD1();t.after(()=>db.close());await applySchema(db);
  return {db,store:createStore(db)};
}

test('warning confirmation is idempotent and preserves legacy penalty state',async t=>{
  const {store}=await fixture(t);
  await store.member(CHAT,USER);
  await store.run('UPDATE members SET strikes=2,last_incident=?,active_until=?,episode_at=? WHERE chat_id=? AND user_id=?','legacy',NOW-10,NOW-604800,String(CHAT),String(USER));
  const before=await store.member(CHAT,USER),row=await store.plan(warning());
  const confirmed=await store.confirmWarning(row,NOW+1);
  assert.equal(confirmed.status,'warned');assert.equal(confirmed.deleted,1);
  assert.deepEqual(await store.member(CHAT,USER),before);
  const first=await store.linkWarning(CHAT,USER);
  assert.deepEqual(first,{chat_id:String(CHAT),user_id:String(USER),incident_id:row.id,warned_at:NOW+1,delivered_at:0});
  assert.equal((await store.confirmWarning(row,NOW+2)).status,'warned');
  assert.deepEqual(await store.linkWarning(CHAT,USER),first);
});

test('failed warning transaction rolls back eligibility and outcome for safe retry',async t=>{
  const {db,store}=await fixture(t),row=await store.plan(warning());
  await db.exec("CREATE TRIGGER fail_warning BEFORE UPDATE OF status ON incidents WHEN NEW.status='warned' BEGIN SELECT RAISE(ABORT,'warning storage failed'); END;");
  await assert.rejects(store.confirmWarning(row,NOW),/warning storage failed/);
  assert.equal(await store.linkWarning(CHAT,USER),null);
  const pending=await store.incident(row.id);
  assert.equal(pending.status,'planned');assert.equal(pending.deleted,0);
  await db.exec('DROP TRIGGER fail_warning;');
  assert.equal((await store.confirmWarning(row,NOW+1)).status,'warned');
});

test('a later admin override prevents a pending warning from consuming eligibility',async t=>{
  const {store}=await fixture(t),row=await store.plan(warning());
  await store.override(CHAT,USER,NOW+1);
  assert.equal((await store.confirmWarning(row,NOW+2)).status,'cancelled');
  assert.equal(await store.linkWarning(CHAT,USER),null);
  assert.equal((await store.member(CHAT,USER)).override_at,NOW+1);
});

test('a delivered warning ledger cannot be replaced by another preplanned warning',async t=>{
  const {store}=await fixture(t),one=await store.plan(warning()),two=await store.plan(warning({id:'other',message_id:12}));
  await store.confirmWarning(one,NOW);await store.noticeRecord(one.id,NOW);
  await store.noticeState(one.id,'sent',NOW+1,{messageId:500});
  const result=await store.confirmWarning(two,NOW+2);
  assert.equal(result.status,'warned');assert.equal(result.warning_current,0);
  assert.equal((await store.linkWarning(CHAT,USER)).incident_id,one.id);
  assert.equal((await store.linkWarning(CHAT,USER)).delivered_at,NOW+1);
  assert.equal((await store.member(CHAT,USER)).strikes,0);
});

test('an undelivered warning can be replaced by a new reminder without replaying the old pending notice',async t=>{
  const {store}=await fixture(t),one=await store.plan(warning()),two=await store.plan(warning({id:'reminder',message_id:12}));
  await store.confirmWarning(one,NOW);await store.noticeRecord(one.id,NOW);
  await store.noticeState(one.id,'pending',NOW,{retryAt:NOW+100,errorKind:'rate_limit'});
  assert.equal((await store.confirmWarning(two,NOW+1)).warning_current,1);
  const previous=await store.first('SELECT * FROM notification_delivery WHERE incident_id=?',one.id);
  assert.equal(previous.status,'cancelled');assert.equal(previous.error_kind,'warning_superseded');
  assert.equal((await store.linkWarning(CHAT,USER)).delivered_at,0);
  // Even a late proof for a superseded send cannot unlock bans for its replacement.
  await store.noticeState(one.id,'sent',NOW+2,{messageId:500});
  assert.equal((await store.linkWarning(CHAT,USER)).delivered_at,0);
  await store.noticeRecord(two.id,NOW+3);await store.noticeState(two.id,'sent',NOW+3,{messageId:501});
  assert.equal((await store.linkWarning(CHAT,USER)).delivered_at,NOW+3);
});

test('delivery proof commits atomically and survives incident retention',async t=>{
  const {db,store}=await fixture(t),row=await store.plan(warning());
  await store.confirmWarning(row,NOW);await store.noticeRecord(row.id,NOW);await store.startNoticeAttempt(row.id,NOW);
  await db.exec("CREATE TRIGGER fail_proof BEFORE UPDATE OF delivered_at ON member_link_warnings BEGIN SELECT RAISE(ABORT,'proof storage failed'); END;");
  await assert.rejects(store.noticeState(row.id,'sent',NOW+1,{messageId:500}),/proof storage failed/);
  assert.equal((await store.linkWarning(CHAT,USER)).delivered_at,0);
  assert.equal((await store.first('SELECT * FROM notification_delivery WHERE incident_id=?',row.id)).status,'sending');
  await db.exec('DROP TRIGGER fail_proof;');
  await assert.rejects(store.noticeState(row.id,'sent',NOW+1,{messageId:0}),/Telegram message ID/);
  await store.noticeState(row.id,'sent',NOW+2,{messageId:500});
  await store.cleanup(NOW+31*86400);
  assert.equal((await store.linkWarning(CHAT,USER)).delivered_at,NOW+2);
  assert.equal(await store.incident(row.id),null);
});

test('warning cannot confirm a positive-strike ban incident or an anonymous channel',async t=>{
  const {store}=await fixture(t);
  const ban=await store.plan(warning({strike:1,until_date:NOW+86400}));
  assert.equal((await store.confirmWarning(ban,NOW)).status,'planned');
  const channel=await store.plan(warning({id:'channel',user_id:null}));
  assert.equal((await store.confirmWarning(channel,NOW)).status,'planned');
  assert.equal(await store.linkWarning(CHAT,USER),null);
  const zero=await store.plan(warning({id:'zero'}));
  await assert.rejects(store.confirm(zero,NOW),/positive ban strike/);
  assert.equal((await store.member(CHAT,USER)).active_until,0);
});

test('incident retention never grants a second warning',async t=>{
  const {store}=await fixture(t),row=await store.plan(warning());
  await store.confirmWarning(row,NOW);
  await store.cleanup(NOW+31*86400);
  assert.equal(await store.incident(row.id),null);
  assert.equal((await store.linkWarning(CHAT,USER)).incident_id,row.id);
  assert.equal((await store.moderationState(CHAT,USER,'new')).linkWarning.incident_id,row.id);
});

test('ordinary overrides preserve warnings while explicit forgiveness resets them',async t=>{
  const {store}=await fixture(t),row=await store.plan(warning());
  await store.confirmWarning(row,NOW);
  await store.override(CHAT,USER,NOW+1,false);
  assert.ok(await store.linkWarning(CHAT,USER));
  await store.override(CHAT,USER,NOW+2,true);
  assert.equal(await store.linkWarning(CHAT,USER),null);
  assert.equal((await store.member(CHAT,USER)).strikes,0);
  assert.equal((await store.incident(row.id)).status,'cancelled');
});

test('a stale forgiveness cannot remove a warning recorded after its timestamp',async t=>{
  const {store}=await fixture(t),row=await store.plan(warning());
  await store.confirmWarning(row,NOW+10);
  await store.override(CHAT,USER,NOW+5,true);
  assert.ok(await store.linkWarning(CHAT,USER));
});

test('ready legacy installations lazily add the warning ledger without rewriting strikes',async t=>{
  const db=new TestD1();t.after(()=>db.close());
  await db.exec(SCHEMA_SQL.replace(LINK_WARNING_SCHEMA_SQL,''));
  const store=createStore(db);
  await store.settings({'pilot_schema:experience':'1',ready:'1'});
  await store.member(CHAT,USER);
  await store.run('UPDATE members SET strikes=3,active_until=-1,override_at=? WHERE chat_id=? AND user_id=?',NOW-1,String(CHAT),String(USER));
  const before=await store.member(CHAT,USER);
  assert.equal(await store.linkWarning(CHAT,USER),null);
  assert.equal(await store.setting('pilot_schema:linkwarnings'),'1');
  assert.deepEqual(await store.member(CHAT,USER),before);
});

test('operator migration and runtime schema declare the same additive warning ledger',async t=>{
  const db=new TestD1();t.after(()=>db.close());
  const migration=await readFile(new URL('../migrations/0013_link_warnings.sql',import.meta.url),'utf8');
  await db.exec(SCHEMA_SQL.replace(LINK_WARNING_SCHEMA_SQL,''));
  await db.exec(migration);
  const normalize=sql=>sql.replace(/\s+/g,' ').replace(/;\s*$/,'').trim();
  const actual=await db.prepare("SELECT sql FROM sqlite_master WHERE name='member_link_warnings'").first('sql');
  assert.equal(normalize(actual),normalize(LINK_WARNING_SCHEMA_SQL.split(';')[0].replace(/ IF NOT EXISTS/,'')));
});

test('migration imports prior warning delivery while preserving members and excluding cancelled records',async t=>{
  const db=new TestD1();t.after(()=>db.close());
  await db.exec(SCHEMA_SQL.replace(LINK_WARNING_SCHEMA_SQL,''));
  const store=createStore(db),row=await store.plan(warning());
  await store.run("UPDATE incidents SET status='warned',deleted=1 WHERE id=?",row.id);
  await store.run('UPDATE members SET last_incident=?,episode_at=? WHERE chat_id=? AND user_id=?',row.id,NOW,String(CHAT),String(USER));
  await store.run("INSERT INTO notification_delivery(incident_id,status,telegram_message_id,updated_at) VALUES(?,'sent',500,?)",row.id,NOW+5);
  const before=await store.member(CHAT,USER);
  const cancelled=await store.plan(warning({id:'cancelled',user_id:102}));
  await store.run("UPDATE incidents SET status='cancelled',deleted=1 WHERE id=?",cancelled.id);
  const migration=await readFile(new URL('../migrations/0013_link_warnings.sql',import.meta.url),'utf8');
  await db.exec(migration);await db.exec(migration);
  const adopted=await db.prepare('SELECT * FROM member_link_warnings WHERE chat_id=? AND user_id=?').bind(String(CHAT),String(USER)).first();
  assert.equal(adopted.delivered_at,NOW+5);assert.equal(adopted.incident_id,row.id);
  assert.deepEqual(await store.member(CHAT,USER),before);
  assert.equal(await db.prepare('SELECT * FROM member_link_warnings WHERE user_id=?').bind('102').first(),null);
});

test('cleanup adopts late prior warning proof before deleting its retained evidence',async t=>{
  const {store}=await fixture(t),row=await store.plan(warning());
  await store.run("UPDATE incidents SET status='warned',deleted=1 WHERE id=?",row.id);
  await store.run("INSERT INTO notification_delivery(incident_id,status,telegram_message_id,updated_at) VALUES(?,'sent',500,?)",row.id,NOW+5);
  await store.cleanup(NOW+31*86400);
  assert.equal(await store.incident(row.id),null);
  assert.equal((await store.linkWarning(CHAT,USER)).delivered_at,NOW+5);
});

test('late prior warning adoption cannot revive cancelled or overridden evidence',async t=>{
  const {store}=await fixture(t),row=await store.plan(warning());
  await store.run("UPDATE incidents SET status='warned',deleted=1 WHERE id=?",row.id);
  await store.run('UPDATE members SET override_at=? WHERE chat_id=? AND user_id=?',NOW+1,String(CHAT),String(USER));
  await store.run("INSERT INTO notification_delivery(incident_id,status,telegram_message_id,updated_at) VALUES(?,'sent',500,?)",row.id,NOW+5);
  assert.equal(await store.linkWarning(CHAT,USER),null);
  await store.run("UPDATE incidents SET status='cancelled' WHERE id=?",row.id);
  await store.run('UPDATE members SET override_at=0 WHERE chat_id=? AND user_id=?',String(CHAT),String(USER));
  assert.equal(await store.linkWarning(CHAT,USER),null);
});
