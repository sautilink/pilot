import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { syncExperience, ALLOWED_UPDATES } from '../src/experience-sync.js';
import { EXPERIENCE_VERSION } from '../src/bot-ui.js';
import { applySchema, createStore } from '../src/store.js';
import { TelegramError } from '../src/telegram.js';
import { TestD1 } from './helpers/d1.js';

const TOKEN = `900:${'test_only_'.repeat(4)}`;
const WEBHOOK = 'https://pilot.sautilink.com/telegram/webhook';
const IDENTITY = { id: 900, is_bot: true, username: 'sautilinkpilotbot', first_name: 'Custom bot name' };
const START = 1792584000;

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
  assert.equal((await f.sync()).status, 'synced');
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

  const adminOnly = new Set(['status', 'strikes', 'forgive', 'unban', 'pause', 'resume', 'testnotice']);
  const menus = f.calls.filter(call => call.method === 'setMyCommands');
  assert.equal(menus.length, 12);
  for (const language of ['', 'sw', 'en']) {
    const localized = menus.filter(call => call.params.language_code === language);
    assert.deepEqual(localized.map(call => call.params.scope.type), ['default', 'all_private_chats', 'all_group_chats', 'all_chat_administrators']);
    for (const { params } of localized) {
      const names = params.commands.map(command => command.command);
      assert.equal(new Set(names).size, names.length, 'scope menus must not duplicate a command');
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
    else assert.match(description, /inasaidia kusimamia Telegram groups/);
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
  await f.store.settings({ experience_version: EXPERIENCE_VERSION });
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
  assert.equal((await f.sync()).status, 'failed');
  assert.equal(await f.store.setting('experience_version'), null);
  assert.equal(await f.store.setting('experience_webhook_version'), EXPERIENCE_VERSION);
  assert.equal(Number(await f.store.setting('experience_sync_retry_at')), START + 120);
  const saved = await f.db.prepare('SELECT key,value FROM settings').all();
  assert.ok(!JSON.stringify(saved.results).includes(TOKEN));
  assert.ok(!JSON.stringify(logs).includes(TOKEN));
  const attempts = f.calls.length;
  f.advance(119);
  assert.equal((await f.sync()).status, 'throttled');
  assert.equal(f.calls.length, attempts);
  f.advance(2);
  f.hooks.delete('setMyDescription');
  assert.equal((await f.sync()).status, 'synced');
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
  assert.equal((await first).status, 'synced');
  assert.equal(f.calls.length, 20);
  assert.equal(await f.store.setting('experience_sync_lease_until'), null);
});

test('callback subscription is confirmed before background profile work is handed to waitUntil', async (t) => {
  const f = await fixture(t);
  let releaseDescription;
  const background = [];
  f.hooks.set('setMyDescription', () => new Promise(resolve => { releaseDescription = resolve; }));
  const result = await f.sync({ waitUntil: task => background.push(task) });
  assert.equal(result.status, 'scheduled');
  assert.equal(result.webhookReady, true);
  assert.equal(await f.store.setting('experience_webhook_version'), EXPERIENCE_VERSION);
  assert.equal(await f.store.setting('experience_version'), null);
  assert.equal(background.length, 1);
  assert.deepEqual(f.calls.slice(0, 2).map(call => call.method), ['getMe', 'setWebhook']);
  f.hooks.delete('setMyDescription');
  releaseDescription(true);
  assert.equal((await background[0]).status, 'synced');
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
  assert.equal((await f.sync()).status, 'synced');
  assert.equal(f.calls.length, 20);
});
