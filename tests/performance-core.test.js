import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.js';
import { applySchema, createStore, SCHEMA_SQL } from '../src/store.js';
import { createControlStore } from '../src/control-store.js';
import { createGuardrailStore } from '../src/guardrail-store.js';
import { createOwnerAuth, OWNER_SCHEMA_SQL } from '../src/owner-auth.js';
import { createBroadcastStore } from '../src/broadcast-store.js';
import { createBotIdentity } from '../src/bot-identity.js';
import { ensureSchemaFamily } from '../src/schema-ready.js';
import { createRequestTiming, instrumentTelegram } from '../src/request-timing.js';

function observed(db) {
  const prepared = [], batches = [];
  const binding = {
    prepare(sql) { prepared.push(sql); return db.prepare(sql); },
    batch(statements) { batches.push(statements); return db.batch(statements); },
  };
  return { binding, prepared, batches };
}
async function database(t, legacy = false) {
  const db = new TestD1(); t.after(() => db.close());
  if (legacy) await db.exec(SCHEMA_SQL); else await applySchema(db);
  return db;
}
async function ensureAll(db) {
  await createStore(db).ensureExtras();
  await createControlStore(db).ensure();
  await createGuardrailStore(db).ensure();
  await createOwnerAuth({ db }).ensure();
  await createBroadcastStore(db).ensure();
}
const isCreate = sql => /^\s*CREATE\b/i.test(sql);

test('fresh coordinators share durable schema readiness with one catalog read and no DDL', async t => {
  const db = await database(t);
  for (let restart = 0; restart < 3; restart++) {
    const f = observed(db);
    await ensureAll(f.binding);
    await ensureAll(f.binding);
    assert.equal(f.prepared.length, 1, 'one readiness read for all families on this new binding');
    assert.equal(f.batches.length, 0);
    assert.ok(!f.prepared.some(isCreate));
  }
});

test('a fully provisioned legacy database adopts markers without replaying CREATE batches', async t => {
  const db = await database(t, true), first = observed(db);
  await ensureAll(first.binding);
  assert.ok(!first.prepared.some(isCreate));
  const markers = await db.prepare("SELECT key FROM settings WHERE key LIKE 'pilot_schema:%'").all();
  assert.equal(markers.results.length, 5);
  const next = observed(db);
  await ensureAll(next.binding);
  assert.equal(next.prepared.length, 1);
  assert.equal(next.batches.length, 0);
});

test('legacy adoption restores required owner and broadcast seed rows before marking ready', async t => {
  const db = await database(t, true);
  await db.prepare('DELETE FROM pilot_owner').run();
  await db.prepare('DELETE FROM pilot_broadcast_runtime').run();
  const f = observed(db);
  assert.equal((await createOwnerAuth({ db: f.binding }).status()).bound, false);
  await createBroadcastStore(f.binding).ensure();
  assert.ok(await db.prepare('SELECT * FROM pilot_owner WHERE singleton=1').first());
  assert.ok(await db.prepare('SELECT * FROM pilot_broadcast_runtime WHERE id=1').first());
  assert.ok(!f.prepared.some(isCreate));
});

test('a partial legacy table is never certified by name and an operator repair is retryable', async t => {
  const db = new TestD1(); t.after(() => db.close());
  await db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE pilot_owner(singleton INTEGER PRIMARY KEY);');
  const f = observed(db), owner = createOwnerAuth({ db: f.binding });
  await assert.rejects(owner.ensure(), /pilot_schema_migration_required/);
  assert.equal(await db.prepare("SELECT value FROM settings WHERE key='pilot_schema:owner'").first(), null);
  await db.exec('DROP TABLE pilot_owner;');
  await db.exec(OWNER_SCHEMA_SQL);
  assert.equal((await owner.status()).bound, false);
  assert.equal((await db.prepare("SELECT value FROM settings WHERE key='pilot_schema:owner'").first()).value, '1');
});

for (const settingsExist of [true, false]) {
  test(`complete setup rejects a partial owner table with settings ${settingsExist ? 'present' : 'missing'}`, async t => {
    const db = new TestD1(); t.after(() => db.close());
    if (settingsExist) await db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);');
    await db.exec('CREATE TABLE pilot_owner(singleton INTEGER PRIMARY KEY);');
    const f = observed(db);
    await assert.rejects(applySchema(f.binding), /pilot_schema_migration_required/);
    assert.ok(!f.prepared.some(isCreate), 'an incompatible table is rejected before setup mutations');
    if (settingsExist) {
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'pilot_schema:%'").first()).n, 0);
    } else {
      assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name='settings'").first(), null);
    }
    await db.exec('DROP TABLE pilot_owner;');
    await applySchema(f.binding);
    const restarted = observed(db);
    const pairing = await createOwnerAuth({ db: restarted.binding }).beginPairing();
    assert.match(pairing.command, /^\/claimowner [a-f0-9]{64}$/);
  });
}

test('complete setup rejects future markers even after this binding was previously ready', async t => {
  const db = await database(t);
  await db.prepare("UPDATE settings SET value='2' WHERE key='pilot_schema:owner'").run();
  await assert.rejects(applySchema(db), /pilot_schema_version_newer/);
  assert.equal((await db.prepare("SELECT value FROM settings WHERE key='pilot_schema:owner'").first()).value, '2');
  await assert.rejects(createOwnerAuth({ db }).ensure(), /pilot_schema_version_newer/);
});

test('repeated complete setup skips DDL, restores missing seeds and preserves the bound owner', async t => {
  const db = await database(t);
  await db.prepare('UPDATE pilot_owner SET user_id=?,claimed_at=? WHERE singleton=1').bind('101', 123).run();
  await db.prepare('DELETE FROM pilot_broadcast_runtime').run();
  const f = observed(db);
  await applySchema(f.binding);
  assert.ok(!f.prepared.some(isCreate));
  const count = f.prepared.length;
  await ensureAll(f.binding);
  assert.equal(f.prepared.length, count, 'verified setup makes all families ready');
  assert.equal((await createOwnerAuth({ db }).status()).userId, '101');
  assert.equal((await db.prepare('SELECT claimed_at FROM pilot_owner WHERE singleton=1').first()).claimed_at, 123);
  assert.ok(await db.prepare('SELECT * FROM pilot_broadcast_runtime WHERE id=1').first());
});

test('complete setup verifies actual definitions before writing any version markers', async t => {
  const db = new TestD1(); t.after(() => db.close());
  const f = observed(db), originalBatch = f.binding.batch;
  let corruptOnce = true;
  f.binding.batch = async statements => {
    const results = await originalBatch(statements);
    if (corruptOnce) {
      corruptOnce = false;
      await db.exec('DROP TABLE pilot_owner; CREATE TABLE pilot_owner(singleton INTEGER PRIMARY KEY);');
    }
    return results;
  };
  await assert.rejects(applySchema(f.binding), /pilot_schema_migration_required/);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'pilot_schema:%'").first()).n, 0);
  await assert.rejects(createOwnerAuth({ db: f.binding }).ensure(), /pilot_schema_migration_required/);
  await db.exec('DROP TABLE pilot_owner;');
  await applySchema(f.binding);
  assert.equal((await createOwnerAuth({ db: f.binding }).status()).bound, false);
});

test('a marker raised after setup preflight is preserved and never cached as an older version', async t => {
  const db = await database(t, true), f = observed(db), originalBatch = f.binding.batch;
  f.binding.batch = async statements => {
    const results = await originalBatch(statements);
    await db.prepare("INSERT INTO settings(key,value) VALUES('pilot_schema:owner','2')").run();
    return results;
  };
  await assert.rejects(applySchema(f.binding), /pilot_schema_version_newer/);
  assert.equal((await db.prepare("SELECT value FROM settings WHERE key='pilot_schema:owner'").first()).value, '2');
  await assert.rejects(createOwnerAuth({ db: f.binding }).ensure(), /pilot_schema_version_newer/);
});

test('initial family setup coalesces concurrent callers and records readiness only after success', async t => {
  const db = new TestD1(); t.after(() => db.close());
  const f = observed(db);
  let rejected = false;
  const originalBatch = f.binding.batch;
  f.binding.batch = async statements => {
    if (!rejected) { rejected = true; throw new Error('temporary_database_failure'); }
    return originalBatch(statements);
  };
  await assert.rejects(createOwnerAuth({ db: f.binding }).ensure(), /temporary_database_failure/);
  await Promise.all(Array.from({ length: 4 }, () => createOwnerAuth({ db: f.binding }).ensure()));
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM pilot_owner').first()).n, 1);
  const successfulOwnerCreates = f.batches.flat().filter(statement => /^CREATE TABLE IF NOT EXISTS pilot_owner/.test(statement.sql));
  assert.equal(successfulOwnerCreates.length, 1);
});

test('a new family version runs its migration and an older worker cannot downgrade its marker', async t => {
  const db = await database(t), f = observed(db);
  await ensureSchemaFamily(f.binding, 'owner', OWNER_SCHEMA_SQL, '2');
  assert.ok(f.prepared.some(isCreate), 'a new version cannot take legacy adoption shortcut');
  assert.equal((await db.prepare("SELECT value FROM settings WHERE key='pilot_schema:owner'").first()).value, '2');
  await assert.rejects(createOwnerAuth({ db: observed(db).binding }).ensure(), /pilot_schema_version_newer/);
});

test('existing group and member reads do not issue redundant insert writes', async t => {
  const db = await database(t);
  const original = createStore(db);
  await original.group(-1001); await original.member(-1001, 101);
  const f = observed(db), store = createStore(f.binding);
  assert.equal((await store.group(-1001)).chat_id, '-1001');
  assert.equal((await store.member(-1001, 101)).user_id, '101');
  assert.equal(f.prepared.length, 2);
  assert.ok(f.prepared.every(sql => /^SELECT/.test(sql)));
  assert.equal(f.batches.length, 0);
});

const TOKEN = '900:' + 'a'.repeat(24);
const BOT = { id: 900, is_bot: true, username: 'sautilinkpilotbot' };
async function saveIdentity(db, identity = BOT) {
  await createStore(db).settings({ bot_id: identity.id, bot_username: identity.username });
}

test('verified persisted bot identity avoids getMe across new chat coordinators', async t => {
  const db = await database(t); await saveIdentity(db);
  const f = observed(db), api = { call() { throw new Error('unexpected Telegram call'); } };
  const resolvers = Array.from({ length: 5 }, () => createBotIdentity({ db: f.binding, api, token: TOKEN }));
  const identities = await Promise.all(resolvers.map(resolve => resolve()));
  assert.ok(identities.every(identity => identity.id === BOT.id && identity.username === BOT.username));
  assert.equal(f.prepared.length, 1, 'simultaneous chats share one pending identity read');
});

test('identity cache is isolated by DB binding, complete token and configured username', async t => {
  const db = await database(t); await saveIdentity(db);
  const f = observed(db), calls = [], api = { async call(method) { calls.push(method); return BOT; } };
  await createBotIdentity({ db: f.binding, api, token: TOKEN })();
  await createBotIdentity({ db: f.binding, api, token: '900:' + 'b'.repeat(24) })();
  assert.equal(f.prepared.length, 2, 'rotated credentials have a separate entry');
  await assert.rejects(createBotIdentity({ db: f.binding, api, token: '901:' + 'c'.repeat(24) })(), /unexpected_bot_identity/);
  await assert.rejects(createBotIdentity({ db: f.binding, api, token: TOKEN, expectedUsername: 'anotherpilotbot' })(), /unexpected_bot_identity/);
  const other = await database(t);
  await createBotIdentity({ db: other, api, token: TOKEN })();
  assert.equal(calls.length, 3, 'a second database cannot inherit the first database entry');
});

test('identity lookup failures are retried and a mismatched getMe result never becomes cached', async t => {
  const db = await database(t); let count = 0;
  const api = { async call() { count++; return count === 1 ? { ...BOT, id: 901 } : BOT; } };
  const resolve = createBotIdentity({ db, api, token: TOKEN });
  await assert.rejects(resolve(), /unexpected_bot_identity/);
  assert.equal((await resolve()).id, BOT.id);
  assert.equal((await resolve()).id, BOT.id);
  assert.equal(count, 2);
});

test('identity entries expire without crossing token or binding boundaries', async t => {
  const db = await database(t); await saveIdentity(db);
  const f = observed(db); let now = 0;
  const resolve = createBotIdentity({ db: f.binding, api: { call() { throw new Error('unexpected Telegram call'); } }, token: TOKEN, clock: () => now });
  await resolve(); now = 299999; await resolve();
  assert.equal(f.prepared.length, 1);
  now = 300000; await resolve(); assert.equal(f.prepared.length, 2);
});

test('timing separates queue and handler time and records API duration without request data', async () => {
  let now = 0; const records = [];
  const timing = createRequestTiming('telegram', { now: () => now, sample: () => true, report: record => records.push(record) });
  now = 30; timing.start();
  const api = instrumentTelegram({ async call(method, parameters) { assert.equal(parameters.text, 'private message'); now += 50; return true; } }, () => timing, () => now);
  await api.call('sendMessage', { chat_id: 123, text: 'private message', token: 'never log this' });
  now = 100; timing.finish();
  assert.deepEqual(records, [{ route: 'telegram', outcome: 'ok', queue_ms: 30, handling_ms: 70, telegram_calls: 1, telegram_ms: 50 }]);
  assert.ok(!JSON.stringify(records).includes('private message'));
});

test('slow and failed work is logged even when normal work is not sampled', () => {
  let now = 0; const records = [];
  const options = { now: () => now, sample: () => false, report: record => records.push(record) };
  const normal = createRequestTiming('telegram', options); normal.start(); now = 20; normal.finish();
  assert.equal(records.length, 0);
  const queued = createRequestTiming('control', options); now += 250; queued.start(); queued.finish();
  const slow = createRequestTiming('broadcast', options); slow.start(); now += 1000; slow.finish();
  const failed = createRequestTiming('telegram', options); failed.start(); failed.finish('error');
  assert.equal(records.length, 3);
});

test('timing instrumentation preserves Telegram failures and cannot fail the action when logging fails', async () => {
  let now = 0;
  const timing = createRequestTiming('telegram', { now: () => now, sample: () => true, report() { throw new Error('log unavailable'); } });
  timing.start();
  const failure = new Error('Telegram unavailable');
  const api = instrumentTelegram({ async call() { now += 10; throw failure; } }, () => timing, () => now);
  await assert.rejects(api.call('deleteMessage', { chat_id: 123 }), error => error === failure);
  assert.doesNotThrow(() => timing.finish('error'));
});
