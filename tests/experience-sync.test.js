import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { syncExperience, readExperienceState, ALLOWED_UPDATES, WEBHOOK_VERSION } from '../src/experience-sync.js';
import { EXPERIENCE_VERSION } from '../src/bot-ui.js';
import { applySchema, createStore } from '../src/store.js';
import { TelegramError } from '../src/telegram.js';
import { TestD1 } from './helpers/d1.js';

const TOKEN = `900:${'test_only_'.repeat(4)}`;
const WEBHOOK = 'https://pilot.sautilink.com/telegram/webhook';
const IDENTITY = { id: 900, is_bot: true, username: 'sautilinkpilotbot', first_name: 'Custom bot name' };
const START = 1792584000;
const profileCalls = calls => calls.filter(call => ['setMyCommands', 'setMyDescription', 'setMyShortDescription'].includes(call.method));
const operationKey = call => `${call.method}:${call.params.language_code}:${call.params.scope?.type || ''}`;

async function fixture(t, { ready = true } = {}) {
  const db = new TestD1();
  await applySchema(db);
  t.after(() => db.close());
  const store = createStore(db);
  if (ready) await store.settings({ ready: '1', ready_since: START - 1000 });
  const calls = [];
  const hooks = new Map();
  let now = START;
  const api = { async call(method, params = {}) {
    calls.push({ method, params: structuredClone(params) });
    if (hooks.has(method)) return hooks.get(method)(params);
    return method === 'getMe' ? IDENTITY : true;
  } };
  const sync = options => syncExperience({ db, api, token: TOKEN, webhookUrl: WEBHOOK, clock: () => now, ...options });
  return { db, store, calls, hooks, sync, advance(seconds) { now += seconds; }, now: () => now };
}

test('sync registers bilingual profile metadata and correctly scoped menus without changing identity or sending messages', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.sync({ force: true })).status, 'synced');
  assert.equal(f.calls.length, 20, 'a successful migration has a fixed, bounded API budget');
  assert.deepEqual(f.calls.slice(0, 2).map(call => call.method), ['getMe', 'setWebhook']);
  const webhook = f.calls.find(call => call.method === 'setWebhook').params;
  assert.deepEqual(webhook.allowed_updates, ALLOWED_UPDATES);
  assert.ok(webhook.allowed_updates.includes('callback_query'));
  assert.ok(webhook.allowed_updates.includes('chat_member'));
  assert.equal(webhook.url, WEBHOOK);
  assert.equal(webhook.max_connections, 40);
  assert.equal(webhook.drop_pending_updates, false);
  assert.equal(webhook.secret_token, createHmac('sha256', TOKEN).update('sautilink-pilot:telegram-webhook:v1').digest('hex'));

  const adminOnly = new Set(['status', 'strikes', 'forgive', 'unban', 'pause', 'resume', 'testnotice', 'doctor', 'policytest']);
  const menus = f.calls.filter(call => call.method === 'setMyCommands');
  assert.equal(menus.length, 12);
  for (const language of ['', 'sw', 'en']) {
    const localized = menus.filter(call => call.params.language_code === language);
    assert.deepEqual(localized.map(call => call.params.scope.type), ['default', 'all_private_chats', 'all_group_chats', 'all_chat_administrators']);
    for (const { params } of localized) {
      const names = params.commands.map(command => command.command);
      assert.equal(new Set(names).size, names.length, 'scope menus must not duplicate a command');
      assert.ok(!names.includes('performance'), 'owner tools do not belong in shared command scopes');
      assert.ok(names.includes('support')); assert.ok(names.includes('communities'));
      if (params.scope.type === 'all_chat_administrators') {
        for (const name of adminOnly) assert.ok(names.includes(name));
      } else {
        assert.ok(names.every(name => !adminOnly.has(name)), `${params.scope.type} exposes an admin command`);
      }
    }
    const description = f.calls.find(call => call.method === 'setMyDescription' && call.params.language_code === language).params.description;
    const short = f.calls.find(call => call.method === 'setMyShortDescription' && call.params.language_code === language).params.short_description;
    assert.ok(description.length > 0 && description.length <= 512);
    assert.ok(short.length > 0 && short.length <= 120);
    if (language === 'en') assert.match(description, /helps moderate Telegram groups/);
    else assert.match(description, /husaidia kusimamia Telegram groups/);
  }
  assert.ok(f.calls.every(call => ['getMe', 'setWebhook', 'setMyCommands', 'setMyDescription', 'setMyShortDescription'].includes(call.method)));
  assert.equal(await f.store.setting('experience_version'), EXPERIENCE_VERSION);
  const saved = await f.db.prepare('SELECT key,value FROM settings').all();
  assert.ok(!JSON.stringify(saved.results).includes(TOKEN), 'settings must never retain the bot token');
});

test('a mismatched bot identity cannot mutate Telegram metadata or record a completed migration', async (t) => {
  const f = await fixture(t);
  t.mock.method(console, 'warn', () => {});
  f.hooks.set('getMe', () => ({ ...IDENTITY, username: 'anotherbot' }));
  const result = await f.sync();
  assert.equal(result.status, 'failed');
  assert.equal(result.errorKind, 'identity_mismatch');
  assert.deepEqual(f.calls.map(call => call.method), ['getMe']);
  assert.equal(await f.store.setting('experience_version'), null);
  assert.equal(await f.store.setting('experience_webhook_version'), null);
});

test('a completed version skips automatic API work while forced setup can reapply the metadata', async (t) => {
  const f = await fixture(t);
  await f.store.settings({ experience_version: EXPERIENCE_VERSION, experience_webhook_version: WEBHOOK_VERSION });
  assert.equal((await f.sync()).status, 'current');
  assert.equal(f.calls.length, 0);
  const background = [];
  assert.equal((await f.sync({ force: true, waitUntil: task => background.push(task) })).status, 'synced');
  assert.equal(background.length, 0, 'forced setup must finish synchronously');
  assert.equal(f.calls.filter(call => call.method === 'setWebhook').length, 1);
  assert.equal(await f.store.setting('ready_since'), String(START - 1000));
});

test('failed metadata sync is sanitized and throttled, then resumes on a future update without resetting its webhook', async (t) => {
  const f = await fixture(t);
  const logs = [];
  t.mock.method(console, 'warn', (...args) => logs.push(args));
  f.hooks.set('setMyDescription', () => { throw new TelegramError(`Provider detail ${TOKEN}`, 429, false, 120); });
  assert.equal((await f.sync()).status, 'pending', 'subscription is a separate bounded phase');
  f.advance(6);
  assert.equal((await f.sync()).status, 'failed');
  assert.equal(await f.store.setting('experience_version'), null);
  assert.equal(await f.store.setting('experience_webhook_version'), WEBHOOK_VERSION);
  assert.equal(Number(await f.store.setting('experience_sync_retry_at')), f.now() + 120);
  assert.equal(JSON.parse(await f.store.setting('experience_sync_progress')).completed, 6, 'the two confirmed calls survive another operation rejecting');
  const saved = await f.db.prepare('SELECT key,value FROM settings').all();
  assert.ok(!JSON.stringify(saved.results).includes(TOKEN));
  assert.ok(!JSON.stringify(logs).includes(TOKEN));
  const attempts = f.calls.length;
  f.advance(119);
  assert.equal((await f.sync()).status, 'throttled');
  assert.equal(f.calls.length, attempts);
  f.advance(2);
  f.hooks.delete('setMyDescription');
  let result = await f.sync();
  for (let attempts = 0; result.status === 'pending' && attempts < 10; attempts++) { f.advance(6); result = await f.sync(); }
  assert.equal(result.status, 'synced');
  assert.equal(f.calls.filter(call => call.method === 'setWebhook').length, 1);
  assert.equal(await f.store.setting('experience_sync_error'), '');
});

test('the D1 lease prevents concurrent updates from issuing duplicate profile migrations', async (t) => {
  const f = await fixture(t);
  let releaseIdentity, signalEntered;
  const entered = new Promise(resolve => { signalEntered = resolve; });
  f.hooks.set('getMe', () => {
    signalEntered();
    return new Promise(resolve => { releaseIdentity = resolve; });
  });
  const first = f.sync();
  await entered;
  assert.equal((await f.sync()).status, 'busy');
  assert.deepEqual(f.calls.map(call => call.method), ['getMe']);
  releaseIdentity(IDENTITY);
  assert.equal((await first).status, 'pending');
  assert.equal(f.calls.length, 2);
  assert.equal(await f.store.setting('experience_sync_lease_until'), null);
});

test('the ingress snapshot skips extra lease writes while another metadata phase is active', async t => {
  const f = await fixture(t);
  await f.store.settings({ experience_sync_lease_until: `${START + 60}:fixture-owner` });
  const state = await readExperienceState(f.db), queries = [];
  assert.equal(state.leaseUntil, START + 60);
  const prepare = f.db.prepare.bind(f.db);
  t.mock.method(f.db, 'prepare', sql => { queries.push(sql); return prepare(sql); });
  assert.equal((await f.sync({ state })).status, 'busy');
  assert.equal(queries.length, 0);
  assert.equal(f.calls.length, 0);
});

test('one automatic phase awaits at most three independent profile calls without nesting waitUntil', async (t) => {
  const f = await fixture(t);
  await f.store.settings({ experience_webhook_version: WEBHOOK_VERSION });
  let releaseDescription, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const background = [];
  f.hooks.set('setMyDescription', () => { entered(); return new Promise(resolve => { releaseDescription = resolve; }); });
  const task = f.sync({ waitUntil: pending => background.push(pending) });
  await started;
  assert.equal(await f.store.setting('experience_webhook_version'), WEBHOOK_VERSION);
  assert.equal(await f.store.setting('experience_version'), null);
  assert.equal(background.length, 0, 'only the HTTP handler owns the background lifetime');
  assert.equal(profileCalls(f.calls).length, 3, 'the independent calls start before the first response returns');
  releaseDescription(true);
  const result = await task;
  assert.equal(result.status, 'pending');
  assert.equal(result.webhookReady, true);
  assert.equal(f.calls.length, 4);
  assert.equal(JSON.parse(await f.store.setting('experience_sync_progress')).completed, 7);
});

test('automatic sync never runs before the installation is ready', async (t) => {
  const f = await fixture(t, { ready: false });
  assert.equal((await f.sync()).status, 'not_ready');
  assert.equal(f.calls.length, 0);
  assert.equal(await f.store.setting('experience_sync_lease_until'), null);
});

test('an expired lease can be recovered after a terminated Worker', async (t) => {
  const f = await fixture(t);
  await f.store.settings({ experience_sync_lease_until: START + 300 });
  assert.equal((await f.sync()).status, 'busy');
  f.advance(301);
  assert.equal((await f.sync()).status, 'pending');
  assert.equal(f.calls.length, 2);
});

test('a request-scoped settings snapshot is rechecked under the durable upgrade lease', async t => {
  for (const [change, expected] of [
    [{ experience_version: EXPERIENCE_VERSION, experience_webhook_version: WEBHOOK_VERSION }, 'current'],
    [{ ready: '0' }, 'not_ready'],
    [{ experience_sync_retry_at: START + 120 }, 'throttled'],
  ]) {
    const f = await fixture(t);
    const state = await readExperienceState(f.db);
    await f.store.settings(change);
    assert.equal((await f.sync({ state })).status, expected);
    assert.equal(f.calls.length, 0, 'stale snapshots cannot start Telegram metadata mutations');
    assert.equal(await f.store.setting('experience_sync_lease_until'), null);
  }
});

test('automatic phases resume durable progress and never repeat confirmed profile operations', async t => {
  const f = await fixture(t);
  assert.equal((await f.sync()).status, 'pending');
  assert.equal(f.calls.length, 2);
  assert.equal((await f.sync()).status, 'throttled');
  for (let phase = 0; phase < 6; phase++) {
    f.advance(6);
    const before = f.calls.length, result = await f.sync();
    assert.equal(result.status, phase === 5 ? 'synced' : 'pending');
    assert.equal(f.calls.length - before, 4, 'one identity read and at most three metadata operations');
    assert.equal(await f.store.setting('experience_version'), phase === 5 ? EXPERIENCE_VERSION : null, 'a partial menu is never marked synced');
    assert.equal(JSON.parse(await f.store.setting('experience_sync_progress')).completed, 2 ** ((phase + 1) * 3) - 1);
    assert.equal(await f.store.setting('experience_sync_lease_until'), null);
  }
  assert.equal(profileCalls(f.calls).length, 18);
  assert.equal(new Set(profileCalls(f.calls).map(operationKey)).size, 18);
  assert.equal(f.calls.filter(call => call.method === 'setWebhook').length, 1);
  const before = f.calls.length;
  assert.equal((await f.sync()).status, 'current');
  assert.equal(f.calls.length, before);
});

test('the confirmed legacy subscription remains valid across profile revisions without resetting webhook delivery', async t => {
  const f = await fixture(t);
  await f.store.settings({ experience_version: EXPERIENCE_VERSION, experience_webhook_version: '2026-10-22.4' });
  assert.equal((await f.sync()).status, 'current');
  assert.equal(f.calls.length, 0);
  await f.store.settings({ experience_version: '2026-10-22.4' });
  assert.equal((await f.sync()).status, 'pending');
  assert.equal(f.calls.filter(call => call.method === 'setWebhook').length, 0);
  assert.equal(await f.store.setting('experience_webhook_version'), WEBHOOK_VERSION);
  assert.equal(profileCalls(f.calls).length, 3);
});

test('a current profile with an unconfirmed subscription upgrades only the webhook', async t => {
  const f = await fixture(t);
  await f.store.settings({ experience_version: EXPERIENCE_VERSION });
  assert.equal((await f.sync()).status, 'synced');
  assert.deepEqual(f.calls.map(call => call.method), ['getMe', 'setWebhook']);
  assert.equal(await f.store.setting('experience_webhook_version'), WEBHOOK_VERSION);
});

test('ambiguous and false metadata results never advance their progress bits or the completed version', async t => {
  for (const result of [false, new TelegramError(`Token ${TOKEN}`, 0, true)]) {
    const f = await fixture(t);
    t.mock.method(console, 'warn', () => {});
    await f.store.settings({ experience_webhook_version: WEBHOOK_VERSION });
    f.hooks.set('setMyDescription', () => { if (result instanceof Error) throw result; return result; });
    assert.equal((await f.sync()).status, 'failed');
    assert.equal(JSON.parse(await f.store.setting('experience_sync_progress')).completed, 6);
    assert.equal(await f.store.setting('experience_version'), null);
    f.advance(61); f.hooks.delete('setMyDescription');
    const before = f.calls.length;
    assert.equal((await f.sync()).status, 'pending');
    const retried = profileCalls(f.calls.slice(before));
    assert.deepEqual(retried.map(operationKey), ['setMyDescription::', 'setMyCommands::all_private_chats', 'setMyCommands::all_group_chats']);
  }
});

test('a resumed expired worker cannot overwrite progress, retry time, version, or a new lease', async t => {
  const f = await fixture(t);
  await f.store.settings({ experience_webhook_version: WEBHOOK_VERSION });
  let releaseOld, enteredOld;
  const oldStarted = new Promise(resolve => { enteredOld = resolve; });
  f.hooks.set('setMyDescription', () => { enteredOld(); return new Promise(resolve => { releaseOld = resolve; }); });
  const old = f.sync(); await oldStarted;
  const oldLease = await f.store.setting('experience_sync_lease_until');
  assert.equal(Number.parseInt(oldLease, 10), START + 60);
  f.advance(61);
  let releaseNew, enteredNew;
  const newStarted = new Promise(resolve => { enteredNew = resolve; });
  f.hooks.set('getMe', () => { enteredNew(); return new Promise(resolve => { releaseNew = resolve; }); });
  f.hooks.delete('setMyDescription');
  const current = f.sync(); await newStarted;
  const newLease = await f.store.setting('experience_sync_lease_until');
  assert.notEqual(oldLease, newLease);
  releaseOld(true);
  assert.equal((await old).status, 'superseded');
  assert.equal(await f.store.setting('experience_sync_lease_until'), newLease, 'old finally cannot release the current owner');
  assert.equal(await f.store.setting('experience_sync_progress'), null, 'old confirmed calls cannot replace a new owner’s progress');
  assert.equal(await f.store.setting('experience_sync_retry_at'), null);
  assert.equal(await f.store.setting('experience_version'), null);
  releaseNew(IDENTITY);
  assert.equal((await current).status, 'pending');
  assert.equal(JSON.parse(await f.store.setting('experience_sync_progress')).completed, 7);
});

test('an expired owner failing in flight cannot impose its retry delay on the next owner', async t => {
  const f = await fixture(t); t.mock.method(console, 'warn', () => {});
  let rejectOld, enteredOld;
  const oldStarted = new Promise(resolve => { enteredOld = resolve; });
  f.hooks.set('getMe', () => { enteredOld(); return new Promise((resolve, reject) => { rejectOld = reject; }); });
  const old = f.sync(); await oldStarted;
  f.advance(61);
  let releaseNew, enteredNew;
  const newStarted = new Promise(resolve => { enteredNew = resolve; });
  f.hooks.set('getMe', () => { enteredNew(); return new Promise(resolve => { releaseNew = resolve; }); });
  const current = f.sync(); await newStarted;
  const newLease = await f.store.setting('experience_sync_lease_until');
  rejectOld(new TelegramError('Fixture rate limit', 429, false, 3600));
  assert.equal((await old).status, 'failed');
  assert.equal(await f.store.setting('experience_sync_lease_until'), newLease);
  assert.equal(await f.store.setting('experience_sync_retry_at'), null, 'the stale failure is fenced as strictly as success');
  assert.equal(await f.store.setting('experience_sync_error'), null);
  releaseNew(IDENTITY);
  assert.equal((await current).status, 'pending');
  assert.equal(Number(await f.store.setting('experience_sync_retry_at')), f.now() + 5);
});

test('progress from another profile revision or bot identity is reset before reuse', async t => {
  for (const progress of [
    { version: '2026-10-22.3', botId: IDENTITY.id, completed: 2 ** 18 - 1 },
    { version: EXPERIENCE_VERSION, botId: IDENTITY.id + 1, completed: 2 ** 18 - 1 },
    { version: EXPERIENCE_VERSION, botId: IDENTITY.id, completed: -1 },
  ]) {
    const f = await fixture(t);
    await f.store.settings({ experience_webhook_version: WEBHOOK_VERSION, experience_sync_progress: JSON.stringify(progress) });
    assert.equal((await f.sync()).status, 'pending');
    assert.equal(profileCalls(f.calls).length, 3);
    assert.deepEqual(JSON.parse(await f.store.setting('experience_sync_progress')), { version: EXPERIENCE_VERSION, botId: IDENTITY.id, completed: 7 });
    assert.equal(await f.store.setting('experience_version'), null);
  }
});

test('an older deployment never downgrades a newer completed or in-progress metadata version', async t => {
  for (const values of [
    { experience_version: '2099-01-01.1', experience_webhook_version: WEBHOOK_VERSION },
    { experience_version: EXPERIENCE_VERSION, experience_webhook_version: 'subscriptions-v2' },
    { experience_webhook_version: WEBHOOK_VERSION, experience_sync_progress: JSON.stringify({ version: '2099-01-01.1', botId: IDENTITY.id, completed: 7 }) },
  ]) {
    const f = await fixture(t); await f.store.settings(values);
    assert.equal((await f.sync()).status, 'newer');
    assert.equal(f.calls.length, 0);
    for (const [key, value] of Object.entries(values)) assert.equal(await f.store.setting(key), value);
  }
});

test('forced setup renews its short lease while fully awaiting all profile phases', async t => {
  const f = await fixture(t);
  for (const method of ['getMe', 'setWebhook', 'setMyDescription', 'setMyShortDescription', 'setMyCommands']) {
    f.hooks.set(method, () => { f.advance(7); return method === 'getMe' ? IDENTITY : true; });
  }
  assert.equal((await f.sync({ force: true })).status, 'synced');
  assert.ok(f.now() > START + 60, 'fixture exceeds one lease interval');
  assert.equal(profileCalls(f.calls).length, 18);
  assert.equal(await f.store.setting('experience_version'), EXPERIENCE_VERSION);
  assert.equal(await f.store.setting('experience_sync_lease_until'), null);
  assert.equal(await f.store.setting('ready_since'), String(START - 1000));
});
