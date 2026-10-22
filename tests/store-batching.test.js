import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.js';
import { applySchema, createStore } from '../src/store.js';

const GROUP = -1001122, USER = 101, OTHER = 102, NOW = 1792660000;
const incident = (overrides = {}) => ({ id: `${GROUP}:message:11`, chat_id: GROUP, user_id: USER, message_id: 11, event_at: NOW, created_at: NOW, strike: 1, until_date: NOW + 86400, reasons: '["link"]', ...overrides });
async function fixture(t) {
  const db = new TestD1(); t.after(() => db.close()); await applySchema(db);
  const batches = [], originalBatch = db.batch.bind(db);
  db.batch = async statements => { batches.push(statements.map(item => item.sql)); return originalBatch(statements); };
  return { db, store: createStore(db), batches, clear() { batches.length = 0; } };
}

test('moderation state is one batch with durable group defaults and a read-only synthetic member', async t => {
  const f = await fixture(t); f.clear();
  const state = await f.store.moderationState(GROUP, USER, incident().id);
  assert.equal(f.batches.length, 1);
  assert.deepEqual(state.group, { chat_id: String(GROUP), enabled: 1, activated_at: 0, notice_at: 0 });
  assert.equal(state.activation, 0); assert.equal(state.incident, null);
  assert.deepEqual(state.member, { chat_id: String(GROUP), user_id: String(USER), strikes: 0, last_incident: null, active_until: 0, episode_at: 0, override_at: 0 });
  assert.equal((await f.store.first('SELECT COUNT(*) AS n FROM members')).n, 0);
  assert.equal((await f.store.first('SELECT COUNT(*) AS n FROM incidents')).n, 0);
});

test('moderation snapshots reflect pauses, activation changes, member overrides and existing incident state', async t => {
  const f = await fixture(t), row = await f.store.plan(incident());
  await f.store.settings({ ready_since: NOW - 500 });
  await f.store.group(GROUP); await f.store.run('UPDATE groups SET enabled=0,activated_at=? WHERE chat_id=?', NOW - 100, String(GROUP));
  await f.store.override(GROUP, USER, NOW + 1);
  f.clear();
  const state = await f.store.moderationState(GROUP, USER, row.id);
  assert.equal(f.batches.length, 1); assert.equal(state.group.enabled, 0); assert.equal(state.group.activated_at, NOW - 100);
  assert.equal(state.activation, NOW - 500); assert.equal(state.member.override_at, NOW + 1); assert.equal(state.incident.status, 'cancelled');
  await f.store.settings({ ready_since: NOW + 10 });
  assert.equal((await f.store.moderationState(GROUP, USER, row.id)).activation, NOW + 10);
});

test('channel senders have no member identity or synthetic database row', async t => {
  const f = await fixture(t);
  const row = incident({ id: 'channel-incident', user_id: null, strike: 0, until_date: 0 });
  const first = await f.store.moderationState(GROUP, null, row.id);
  assert.equal(first.member, null); assert.equal(first.incident, null);
  f.clear(); await f.store.plan(row);
  assert.equal(f.batches.length, 1); assert.ok(!f.batches[0].some(sql => /INTO members/i.test(sql)));
  assert.equal((await f.store.moderationState(GROUP, null, row.id)).incident.user_id, null);
  assert.equal((await f.store.first('SELECT COUNT(*) AS n FROM members')).n, 0);
});

test('planning ensures the member in the same batch and retries preserve confirmed or cancelled state', async t => {
  const f = await fixture(t); f.clear();
  const planned = await f.store.plan(incident()); assert.equal(f.batches.length, 1);
  assert.equal(planned.status, 'planned'); assert.equal((await f.store.member(GROUP, USER)).strikes, 0);
  await f.store.confirm(planned, NOW); await f.store.run('UPDATE incidents SET deleted=1 WHERE id=?', planned.id);
  f.clear(); const repeated = await f.store.plan(incident({ strike: 3, until_date: 0 }));
  assert.equal(f.batches.length, 1); assert.equal(repeated.strike, 1); assert.equal(repeated.status, 'confirmed'); assert.equal(repeated.deleted, 1);
  assert.equal((await f.store.member(GROUP, USER)).strikes, 1);
  await f.store.override(GROUP, USER, NOW + 1);
  assert.equal((await f.store.plan(incident())).status, 'cancelled');
});

test('failed planning rolls back new member creation and retry can safely create the incident', async t => {
  const f = await fixture(t);
  await f.db.exec("CREATE TRIGGER fail_plan BEFORE INSERT ON incidents BEGIN SELECT RAISE(ABORT,'plan storage failed'); END;");
  await assert.rejects(f.store.plan(incident()), /plan storage failed/);
  assert.equal((await f.store.first('SELECT COUNT(*) AS n FROM members')).n, 0);
  assert.equal((await f.store.first('SELECT COUNT(*) AS n FROM incidents')).n, 0);
  await f.db.exec('DROP TRIGGER fail_plan;');
  assert.equal((await f.store.plan(incident())).status, 'planned');
});

test('confirmation repairs a missing member row but never replaces a later admin override', async t => {
  const f = await fixture(t), row = await f.store.plan(incident());
  await f.store.run('DELETE FROM members WHERE chat_id=? AND user_id=?', String(GROUP), String(USER));
  f.clear(); await f.store.confirm(row, NOW);
  assert.equal(f.batches.length, 1); assert.equal((await f.store.member(GROUP, USER)).strikes, 1);
  assert.equal((await f.store.incident(row.id)).status, 'confirmed');
  await f.store.override(GROUP, USER, NOW + 1, true);
  await f.store.confirm(row, NOW + 2);
  const member = await f.store.member(GROUP, USER);
  assert.equal(member.strikes, 0); assert.equal(member.active_until, 0); assert.equal(member.override_at, NOW + 1);
  assert.equal((await f.store.incident(row.id)).status, 'cancelled');
});

test('notice creation, legacy suppression and uncertain delivery state each use one batch without replay', async t => {
  const f = await fixture(t), row = await f.store.plan(incident());
  f.clear(); const notice = await f.store.noticeRecord(row.id, NOW);
  assert.equal(f.batches.length, 1); assert.equal(notice.status, 'pending');
  assert.equal((await f.store.incident(row.id)).notified, 1);
  await f.store.noticeState(row.id, 'unknown', NOW + 1, { errorKind: 'delivery_unknown' });
  f.clear(); const retry = await f.store.noticeRecord(row.id, NOW + 2);
  assert.equal(f.batches.length, 1); assert.equal(retry.status, 'unknown'); assert.equal(retry.updated_at, NOW + 1);
  const legacy = await f.store.plan(incident({ id: 'legacy', message_id: 12 }));
  await f.store.run('UPDATE incidents SET notified=1 WHERE id=?', legacy.id);
  assert.equal(await f.store.noticeRecord(legacy.id, NOW), null);
  assert.equal(await f.store.noticeRecord('nonexistent', NOW), null);
});

test('failed notice claims roll back delivery creation and remain safely retryable', async t => {
  const f = await fixture(t), row = await f.store.plan(incident());
  await f.db.exec("CREATE TRIGGER fail_notice BEFORE UPDATE OF notified ON incidents BEGIN SELECT RAISE(ABORT,'notice storage failed'); END;");
  await assert.rejects(f.store.noticeRecord(row.id, NOW), /notice storage failed/);
  assert.equal((await f.store.first('SELECT COUNT(*) AS n FROM notification_delivery')).n, 0);
  assert.equal((await f.store.incident(row.id)).notified, 0);
  await f.db.exec('DROP TRIGGER fail_notice;');
  assert.equal((await f.store.noticeRecord(row.id, NOW + 1)).status, 'pending');
});

test('override atomically creates its member, cancels eligible work and records the update exactly once', async t => {
  const f = await fixture(t); f.clear();
  await f.store.override(GROUP, OTHER, NOW, false, 400);
  assert.equal(f.batches.length, 1); assert.equal((await f.store.member(GROUP, OTHER)).override_at, NOW); assert.ok(await f.store.seen(400));
  const past = await f.store.plan(incident()), future = await f.store.plan(incident({ id: 'future', message_id: 12, event_at: NOW + 20, strike: 2 }));
  await f.store.noticeRecord(past.id, NOW); await f.store.noticeRecord(future.id, NOW);
  await f.store.confirm(future, NOW + 20);
  f.clear(); await f.store.override(GROUP, USER, NOW + 10, false, 401);
  assert.equal(f.batches.length, 1);
  assert.equal((await f.store.incident(past.id)).status, 'cancelled'); assert.equal((await f.store.incident(future.id)).status, 'confirmed');
  assert.equal((await f.store.noticeRecord(past.id, NOW + 11)).status, 'cancelled');
  const member = await f.store.member(GROUP, USER); assert.equal(member.strikes, 2); assert.equal(member.active_until, future.until_date);
  await f.store.override(GROUP, USER, NOW + 5, false, 401);
  assert.equal((await f.store.member(GROUP, USER)).override_at, NOW + 10);
  assert.equal((await f.store.first('SELECT COUNT(*) AS n FROM processed_updates WHERE update_id=401')).n, 1);
});

test('failed override cannot leave a half-created member or a processed update marker', async t => {
  const f = await fixture(t);
  await f.db.exec("CREATE TRIGGER fail_override BEFORE UPDATE ON members BEGIN SELECT RAISE(ABORT,'override storage failed'); END;");
  await assert.rejects(f.store.override(GROUP, USER, NOW, false, 402), /override storage failed/);
  assert.equal((await f.store.first('SELECT COUNT(*) AS n FROM members')).n, 0); assert.equal(await f.store.seen(402), null);
  await f.db.exec('DROP TRIGGER fail_override;');
  await f.store.override(GROUP, USER, NOW, false, 402);
  assert.equal((await f.store.member(GROUP, USER)).override_at, NOW); assert.ok(await f.store.seen(402));
});
