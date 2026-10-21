import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handleFetch } from '../src/handler.js';
import { applySchema, createStore } from '../src/store.js';
import { TestD1 } from './helpers/d1.js';

// Public fixtures only. These are not usable Telegram or Cloudflare credentials.
const TOKEN = `900:${'test_only_'.repeat(4)}`;
const KEY = 'test-only-operator-secret-with-more-than-32-characters';
const BASE = 'https://pilot.sautilink.com';
const SECRET = createHmac('sha256', TOKEN).update('sautilink-pilot:telegram-webhook:v1').digest('hex');
const UPDATE = { update_id: 100, message: { message_id: 20, date: 1792584000, chat: { id: -1001001, type: 'supergroup' }, from: { id: 101, first_name: 'Test user' }, text: 'Hello' } };

async function fixture(t, { ready = false, identity = 'sautilinkpilotbot' } = {}) {
  const db = new TestD1();
  t.after(() => db.close());
  const forwarded = [];
  const selectedGroups = [];
  const calls = [];
  const results = new Map();
  const env = {
    DB: db, BOT_TOKEN: TOKEN, SETUP_KEY: KEY,
    BOT_USERNAME: 'sautilinkpilotbot', PUBLIC_BASE_URL: BASE,
    GROUPS: {
      idFromName(name) { selectedGroups.push(name); return `group:${name}`; },
      get(id) {
        return { async fetch(url, options) {
          forwarded.push({ id, url, update: JSON.parse(options.body) });
          return Response.json({ status: 'confirmed' });
        } };
      },
    },
  };
  if (ready) {
    await applySchema(db);
    await createStore(db).settings({ ready: '1', bot_username: 'sautilinkpilotbot', ready_since: 1792580000 });
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    assert.ok(String(url).startsWith(`https://api.telegram.org/bot${TOKEN}/`), 'only the mocked Telegram endpoint may be called');
    const method = new URL(url).pathname.split('/').at(-1);
    const params = JSON.parse(options.body || '{}');
    calls.push({ method, params });
    if (results.has(method)) return Response.json(results.get(method));
    const result = method === 'getMe'
      ? { id: 900, is_bot: true, first_name: 'SautiLink Pilot', username: identity }
      : method === 'getWebhookInfo'
        ? { url: `${BASE}/telegram/webhook`, pending_update_count: 0, allowed_updates: ['message', 'edited_message', 'my_chat_member', 'chat_member'] }
        : true;
    return Response.json({ ok: true, result });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  return { db, env, forwarded, selectedGroups, calls, results };
}

function request(path, { method = 'GET', headers = {}, body } = {}) {
  return new Request(`${BASE}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) });
}

function setupRequest({ key = KEY, origin = BASE } = {}) {
  return request('/api/setup', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
}

test('health is unavailable before configuration and never claims an active bot', async () => {
  const response = await handleFetch(request('/health'), {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, service: 'SautiLink Pilot' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('missing and incorrect webhook secrets are rejected before group forwarding', async (t) => {
  const f = await fixture(t, { ready: true });
  for (const supplied of [null, 'incorrect-secret']) {
    const headers = supplied ? { 'X-Telegram-Bot-Api-Secret-Token': supplied } : {};
    const response = await handleFetch(request('/telegram/webhook', { method: 'POST', headers, body: JSON.stringify(UPDATE) }), f.env);
    assert.equal(response.status, 401);
  }
  assert.equal(f.forwarded.length, 0);
  assert.equal(f.selectedGroups.length, 0);
  assert.equal(f.calls.length, 0);
});

test('the independently derived webhook HMAC routes a valid update to its chat coordinator', async (t) => {
  const f = await fixture(t, { ready: true });
  const response = await handleFetch(request('/telegram/webhook', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET }, body: JSON.stringify(UPDATE),
  }), f.env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(f.selectedGroups, ['-1001001']);
  assert.equal(f.forwarded.length, 1);
  assert.deepEqual(f.forwarded[0].update, UPDATE);
  assert.equal(f.calls.length, 0);
});

test('operator setup requires an exact bearer key and at least 32 configured characters', async (t) => {
  const f = await fixture(t);
  const unauthenticated = request('/api/setup', { method: 'POST', body: '{}' });
  assert.equal((await handleFetch(unauthenticated, f.env)).status, 401);
  assert.equal((await handleFetch(setupRequest({ key: `${KEY}x` }), f.env)).status, 401);
  assert.equal((await handleFetch(setupRequest({ key: 'short' }), { ...f.env, SETUP_KEY: 'short' })).status, 401);
  const status = request('/api/setup/status', { headers: { Authorization: `Bearer ${KEY}x` } });
  assert.equal((await handleFetch(status, f.env)).status, 401);
  assert.equal(f.calls.length, 0);
});

test('even an authenticated setup request cannot come from another browser origin', async (t) => {
  const f = await fixture(t);
  const response = await handleFetch(setupRequest({ origin: 'https://unrelated.example' }), f.env);
  assert.equal(response.status, 403);
  assert.equal(f.calls.length, 0);
});

test('a token belonging to another bot cannot register a webhook or initialize moderation', async (t) => {
  const f = await fixture(t, { identity: 'differentbot' });
  const response = await handleFetch(setupRequest(), f.env);
  assert.equal(response.status, 409);
  assert.deepEqual(f.calls.map(call => call.method), ['getMe']);
  assert.equal(await f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").first('n'), 0);
});

test('successful setup creates durable state, subscribes to membership updates, and becomes healthy', async (t) => {
  const f = await fixture(t);
  const response = await handleFetch(setupRequest(), f.env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.ready, true);
  assert.equal(result.username, 'sautilinkpilotbot');
  assert.equal(result.webhook_url, `${BASE}/telegram/webhook`);
  const webhook = f.calls.find(call => call.method === 'setWebhook');
  assert.equal(webhook.params.secret_token, SECRET);
  assert.equal(webhook.params.url, `${BASE}/telegram/webhook`);
  assert.deepEqual(webhook.params.allowed_updates, ['message', 'edited_message', 'my_chat_member', 'chat_member']);
  assert.equal(webhook.params.drop_pending_updates, false);
  const store = createStore(f.db);
  assert.equal(await store.setting('ready'), '1');
  assert.equal(await store.setting('bot_username'), 'sautilinkpilotbot');
  assert.equal((await handleFetch(request('/health'), f.env)).status, 200);
  const status = await handleFetch(request('/api/setup/status', { headers: { Authorization: `Bearer ${KEY}`, Origin: BASE } }), f.env);
  assert.equal(status.status, 200);
  assert.equal((await status.json()).ready, true);
});

test('a failed Telegram setup cannot become ready or echo the bot token', async (t) => {
  const f = await fixture(t);
  f.results.set('setWebhook', { ok: false, error_code: 429, description: `Mock failure ${TOKEN}` });
  t.mock.method(console, 'error', () => {});
  const response = await handleFetch(setupRequest(), f.env);
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.ok(!body.includes(TOKEN));
  assert.ok(!body.includes(KEY));
  assert.equal(await createStore(f.db).setting('ready'), null);
  assert.equal((await handleFetch(request('/health'), f.env)).status, 503);
});

test('public HTML and setup responses never render configured secret values', async (t) => {
  const f = await fixture(t, { ready: true });
  for (const path of ['/', '/setup', '/privacy']) {
    const response = await handleFetch(request(path), f.env);
    assert.equal(response.status, 200);
    const body = await response.text();
    assert.ok(!body.includes(TOKEN), `${path} leaked the Telegram token`);
    assert.ok(!body.includes(KEY), `${path} leaked the setup key`);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  }
});

test('unsupported routes, methods, and invalid webhook bodies do not reach the coordinator', async (t) => {
  const f = await fixture(t, { ready: true });
  assert.equal((await handleFetch(request('/unknown'), f.env)).status, 404);
  assert.equal((await handleFetch(request('/telegram/webhook'), f.env)).status, 405);
  const headers = { 'X-Telegram-Bot-Api-Secret-Token': SECRET };
  assert.equal((await handleFetch(request('/telegram/webhook', { method: 'POST', headers, body: 'not JSON' }), f.env)).status, 400);
  assert.equal((await handleFetch(request('/telegram/webhook', { method: 'POST', headers, body: JSON.stringify({ update_id: '100' }) }), f.env)).status, 400);
  assert.equal((await handleFetch(request('/telegram/webhook', { method: 'POST', headers, body: 'x'.repeat(1048577) }), f.env)).status, 413);
  assert.equal(f.forwarded.length, 0);
});
