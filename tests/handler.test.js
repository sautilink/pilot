import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handleFetch } from '../src/handler.js';
import { applySchema, createStore } from '../src/store.js';
import { TestD1 } from './helpers/d1.js';
import { EXPERIENCE_VERSION } from '../src/bot-ui.js';
import { WEBHOOK_VERSION } from '../src/experience-sync.js';
import {createGuardrailStore} from '../src/guardrail-store.js';
import {createOwnerAuth} from '../src/owner-auth.js';

// Public fixtures only. These are not usable Telegram or Cloudflare credentials.
const TOKEN = `900:${'test_only_'.repeat(4)}`;
const KEY = 'test-only-operator-secret-with-more-than-32-characters';
const BASE = 'https://pilot.sautilink.com';
const SECRET = createHmac('sha256', TOKEN).update('sautilink-pilot:telegram-webhook:v1').digest('hex');
const UPDATE = { update_id: 100, message: { message_id: 20, date: 1792584000, chat: { id: -1001001, type: 'supergroup' }, from: { id: 101, first_name: 'Test user' }, text: 'Hello' } };

async function fixture(t, { ready = false, identity = 'sautilinkpilotbot' } = {}) {
  const db = new TestD1();
  const forwarded = [];
  const selectedGroups = [];
  const calls = [];
  const results = new Map();
  const timeline = [];
  const background = [];
  const ctx = { waitUntil(task) { background.push(task); } };
  const env = {
    DB: db, BOT_TOKEN: TOKEN, SETUP_KEY: KEY,
    BOT_USERNAME: 'sautilinkpilotbot', PUBLIC_BASE_URL: BASE,
    GROUPS: {
      idFromName(name) { selectedGroups.push(name); return `group:${name}`; },
      get(id) {
        return { async fetch(url, options) {
          timeline.push('forward');
          forwarded.push({ id, url, update: JSON.parse(options.body), headers: new Headers(options.headers) });
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
    timeline.push(method);
    calls.push({ method, params });
    if (results.has(method)) return Response.json(results.get(method));
    const result = method === 'getMe'
      ? { id: 900, is_bot: true, first_name: 'SautiLink Pilot', username: identity }
      : method === 'getWebhookInfo'
        ? { url: `${BASE}/telegram/webhook`, pending_update_count: 0, allowed_updates: ['message', 'edited_message', 'my_chat_member', 'chat_member'] }
        : true;
    return Response.json({ ok: true, result });
  };
  t.after(async () => { await Promise.allSettled(background); globalThis.fetch = originalFetch; db.close(); });
  return { db, env, forwarded, selectedGroups, calls, results, ctx, timeline, flush: () => Promise.all(background) };
}

function request(path, { method = 'GET', headers = {}, body } = {}) {
  return new Request(`${BASE}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) });
}

function setupRequest({ key = KEY, origin = BASE, lang } = {}) {
  return request(`/api/setup${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
}

function pairRequest({ key = KEY, origin = BASE, body = { action: 'pair' } } = {}) {
  return request('/api/setup/owner', { method: 'POST', headers: {
    Authorization: `Bearer ${key}`, Origin: origin, 'Content-Type': 'application/json',
  }, body: JSON.stringify(body) });
}

test('owner pairing requires the operator key, same origin and completed setup', async t => {
  const f = await fixture(t);
  assert.equal((await handleFetch(pairRequest({ key: 'wrong' }), f.env)).status, 401);
  assert.equal((await handleFetch(pairRequest({ origin: 'https://attacker.example' }), f.env)).status, 403);
  assert.equal((await handleFetch(pairRequest(), f.env)).status, 409);
  assert.equal((await handleFetch(request('/api/setup/owner'), f.env)).status, 405);
  assert.equal(f.calls.length, 0, 'pairing neither calls Telegram nor sends any message');
});

test('protected pairing issues a single-use code and public routes never expose its owner ID', async t => {
  const f = await fixture(t, { ready: true });
  assert.equal((await handleFetch(pairRequest({ body: { action: 'pair', ownerId: 666 } }), f.env)).status, 400);
  const response = await handleFetch(pairRequest(), f.env);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const result = await response.json();
  assert.equal(result.owner.bound, false);
  assert.match(result.pairing.command, /^\/claimowner [a-f0-9]{64}$/);
  assert.equal((await handleFetch(pairRequest(), f.env)).status, 429);
  const id = 8877665544;
  await createOwnerAuth({ db: f.db }).claim({ id, chatId: id, chatType: 'private', username: 'drcharlestz', is_bot: false }, result.pairing.command.split(' ')[1]);
  const status = await handleFetch(request('/api/setup/status', { headers: { Authorization: `Bearer ${KEY}`, Origin: BASE } }), f.env);
  assert.deepEqual((await status.json()).owner, { bound: true, userId: String(id), expectedUsername: 'drcharlestz' });
  const again = await handleFetch(pairRequest(), f.env);
  assert.equal(again.status, 409);
  assert.equal((await again.json()).error, 'owner_bound');
  for (const path of ['/', '/privacy', '/setup', '/health', '/app']) {
    const content = await (await handleFetch(request(path), f.env)).text();
    assert.ok(!content.includes(String(id)), `${path} must not reveal the owner ID`);
    assert.ok(!content.includes(result.pairing.command), `${path} must not reveal a pairing code`);
  }
  assert.equal(f.forwarded.length, 0, 'operator setup never initiates a campaign');
});

test('health is unavailable before configuration and never claims an active bot', async () => {
  const response = await handleFetch(request('/health'), {});
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { ok: false, service: 'SautiLink Pilot' });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('public icon assets are served before any configuration, database, or bot access', async () => {
  const unavailable = new Proxy({}, { get() { throw new Error('Public assets must not access service configuration'); } });
  for (const name of ['icons.js', 'adapter.js']) {
    const response = await handleFetch(request(`/assets/public-icons/${name}`), unavailable);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('Content-Type'), /javascript/);
    assert.match(response.headers.get('Cache-Control'), /^public,/);
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.ok((await response.text()).length > 1000);
    const head = await handleFetch(request(`/assets/public-icons/${name}`, { method: 'HEAD' }), unavailable);
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal(head.headers.get('ETag'), response.headers.get('ETag'));
  }
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
  assert.deepEqual(webhook.params.allowed_updates, ['message', 'edited_message', 'my_chat_member', 'chat_member', 'callback_query', 'chat_join_request']);
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
  t.mock.method(console, 'warn', () => {});
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

test('public requests, invalid payloads, and failed authentication cannot trigger automatic Telegram metadata changes', async (t) => {
  const f = await fixture(t, { ready: true });
  for (const path of ['/', '/setup', '/privacy', '/health', '/api/setup/status']) {
    await handleFetch(request(path), f.env, f.ctx);
  }
  await handleFetch(request('/telegram/webhook', { method: 'POST', body: JSON.stringify(UPDATE) }), f.env, f.ctx);
  await handleFetch(request('/telegram/webhook', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET }, body: 'invalid JSON',
  }), f.env, f.ctx);
  await handleFetch(request('/telegram/webhook', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET }, body: JSON.stringify({ update_id: 1, unsupported: {} }),
  }), f.env, f.ctx);
  await f.flush();
  assert.equal(f.calls.length, 0);
  assert.equal(f.forwarded.length, 0);
});

test('authenticated callbacks route by their accessible message chat or safely fall back to the sender', async (t) => {
  const f = await fixture(t, { ready: true });
  const callback = {
    update_id: 101,
    callback_query: {
      id: 'test-callback', from: { id: 101, first_name: 'User' }, data: 'pilot:rules',
      message: { message_id: 50, date: 1792584000, chat: { id: -1001001, type: 'supergroup' }, from: { id: 900, is_bot: true } },
    },
  };
  const post = (update, secret = SECRET) => request('/telegram/webhook', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify(update),
  });
  assert.equal((await handleFetch(post(callback, 'wrong'), f.env)).status, 401);
  assert.equal(f.forwarded.length, 0);
  assert.equal((await handleFetch(post(callback), f.env)).status, 200);
  const inaccessible = structuredClone(callback);
  inaccessible.update_id++;
  inaccessible.callback_query.message.date = 0;
  assert.equal((await handleFetch(post(inaccessible), f.env)).status, 200);
  const noMessage = structuredClone(callback);
  noMessage.update_id += 2;
  delete noMessage.callback_query.message;
  assert.equal((await handleFetch(post(noMessage), f.env)).status, 200);
  assert.deepEqual(f.selectedGroups, ['-1001001', '101', '101']);
  assert.deepEqual(f.forwarded[0].update, callback);
  assert.equal(f.calls.length, 0, 'routing tests without a Worker context remain independent of migration');
});

for (const blockedMethod of ['getMe', 'setWebhook']) test(`a ready authenticated webhook forwards commands while metadata ${blockedMethod} is still pending`, async (t) => {
  const f = await fixture(t, { ready: true });
  const update = structuredClone(UPDATE);
  update.message.chat = { id: 101, type: 'private' };
  update.message.text = '/start';
  const post = () => request('/telegram/webhook', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET }, body: JSON.stringify(update),
  });
  let release, entered, timer;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const telegram = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith(`/${blockedMethod}`)) { entered(); await gate; }
    return telegram(url, options);
  };
  try {
    const response = await Promise.race([handleFetch(post(), f.env, f.ctx), new Promise(resolve => { timer = setTimeout(() => resolve(null), 1000); })]);
    assert.ok(response, 'metadata latency must not hold the user command outside its coordinator');
    assert.equal(response.status, 200);
    await started;
    assert.equal(f.forwarded.length, 1);
    assert.equal(await createStore(f.db).setting('experience_version'), null);
  } finally {
    clearTimeout(timer); release(); await f.flush();
  }
  assert.equal(await createStore(f.db).setting('experience_webhook_version'), WEBHOOK_VERSION);
  assert.equal(await createStore(f.db).setting('experience_version'), null, 'the bounded subscription phase does not claim profile completion');
  const count = f.calls.length;
  assert.equal((await handleFetch(post(), f.env, f.ctx)).status, 200);
  await f.flush();
  assert.equal(f.calls.length, count, 'continuation cooldown prevents repeated background work for every arriving update');
});

test('a failed automatic metadata upgrade does not stop existing moderation or reveal credentials', async (t) => {
  const f = await fixture(t, { ready: true });
  const logs = [];
  t.mock.method(console, 'warn', (...args) => logs.push(args));
  f.results.set('setWebhook', { ok: false, error_code: 429, description: `Mock rejection ${TOKEN}`, parameters: { retry_after: 120 } });
  const response = await handleFetch(request('/telegram/webhook', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET }, body: JSON.stringify(UPDATE),
  }), f.env, f.ctx);
  assert.equal(response.status, 200);
  assert.equal(f.forwarded.length, 1);
  await f.flush();
  const store = createStore(f.db);
  assert.equal(await store.setting('ready'), '1');
  assert.equal(await store.setting('experience_version'), null);
  assert.ok(Number(await store.setting('experience_sync_retry_at')) > Date.now() / 1000);
  assert.ok(!JSON.stringify(logs).includes(TOKEN));
  assert.ok(!(await response.text()).includes(TOKEN));
});

test('forced operator setup reapplies metadata without resetting readiness time or member punishment history', async (t) => {
  const f = await fixture(t, { ready: true });
  const store = createStore(f.db);
  await store.settings({ experience_version: EXPERIENCE_VERSION, experience_webhook_version: WEBHOOK_VERSION });
  await store.member(-1001001, 101);
  await store.run('UPDATE members SET strikes=2,active_until=?,episode_at=?,override_at=? WHERE chat_id=? AND user_id=?',
    1793188800, 1792584000, 1790000000, '-1001001', '101');
  const before = await f.db.prepare('SELECT * FROM members').all();
  assert.equal((await handleFetch(setupRequest(), f.env, f.ctx)).status, 200);
  const after = await f.db.prepare('SELECT * FROM members').all();
  assert.deepEqual(after.results, before.results);
  assert.equal(await store.setting('ready_since'), '1792580000');
  assert.equal(await store.setting('ready'), '1');
  assert.equal(f.calls.filter(call => call.method === 'setWebhook').length, 1);
  assert.equal(f.calls.filter(call => call.method === 'setMyCommands').length, 12);
});

test('all website routes default to English and honor explicit Swahili without reflecting arbitrary input', async (t) => {
  const f = await fixture(t, { ready: true });
  for (const path of ['/', '/privacy', '/setup', '/app']) {
    for (const query of ['', '?lang=en']) {
      const english = await handleFetch(request(`${path}${query}`), f.env, f.ctx);
      assert.match(await english.text(), /<html lang="en"/);
    }
    const swahili = await handleFetch(request(`${path}?lang=sw`), f.env, f.ctx);
    assert.match(await swahili.text(), /<html lang="sw"/);
    const arbitrary = 'malicious-language-marker';
    const fallback = await handleFetch(request(`${path}?lang=${arbitrary}`), f.env, f.ctx);
    const text = await fallback.text();
    assert.match(text, /<html lang="en"/);
    assert.ok(!text.includes(arbitrary));
  }
  assert.equal(f.calls.length, 0);
});

test('setup feedback defaults to English and honors an explicit Swahili choice', async (t) => {
  const f = await fixture(t);
  const missing = await handleFetch(request('/api/setup', { method: 'POST', body: '{}' }), f.env);
  assert.equal(missing.status, 401);
  assert.match((await missing.json()).message, /missing or incorrect/);
  const invalid = await handleFetch(setupRequest({ key: 'incorrect', lang: 'en' }), f.env);
  assert.equal(invalid.status, 401);
  assert.match((await invalid.json()).message, /at least 32 characters/);
  const missingDatabase = await handleFetch(setupRequest({ lang: 'en' }), { ...f.env, DB: undefined });
  assert.equal(missingDatabase.status, 503);
  assert.match((await missingDatabase.json()).message, /Add a D1 database binding named DB/);
  const swahili = await handleFetch(setupRequest({ key: 'incorrect', lang: 'sw' }), f.env);
  assert.match((await swahili.json()).message, /si sahihi/);
  const success = await handleFetch(setupRequest({ lang: 'en' }), f.env);
  assert.equal(success.status, 200);
  assert.match((await success.json()).status, /connected to Telegram/);
});

test('Mini App can be framed by Telegram while public pages retain their framing restriction',async t=>{
  const f=await fixture(t,{ready:true});const app=await handleFetch(request('/app?lang=en'),f.env);
  assert.equal(app.status,200);assert.equal(app.headers.get('X-Frame-Options'),null);
  assert.match(app.headers.get('Content-Security-Policy'),/frame-ancestors https:\/\/web\.telegram\.org/);
  const body=await app.text();assert.match(body,/telegram-web-app\.js/);assert.match(body,/<html lang="en"/);assert.ok(!body.includes(TOKEN));
  const denied=await handleFetch(request('/api/pilot',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"view":"groups"}'}),f.env);
  assert.equal(denied.status,401);assert.equal(f.forwarded.length,0);
});

test('join requests and their signed-owner callbacks use the same group coordinator',async t=>{
  const f=await fixture(t,{ready:true});const guards=createGuardrailStore(f.db);await guards.ensure();
  const joinId='0123456789abcdef01234567';
  await guards.run("INSERT INTO pilot_join_requests(id,chat_id,user_id,user_chat_id,event_at,expires_at,status,updated_at) VALUES(?,?,?,?,?,?,'challenged',?)",joinId,'-1001001','101','101',1792584000,1792584290,1792584000);
  const post=update=>request('/telegram/webhook',{method:'POST',headers:{'X-Telegram-Bot-Api-Secret-Token':SECRET},body:JSON.stringify(update)});
  const join={update_id:110,chat_join_request:{chat:{id:-1001001,type:'supergroup'},from:{id:101},user_chat_id:101,date:1792584000}};
  await handleFetch(post(join),f.env);
  const callback={update_id:111,callback_query:{id:'join-callback',from:{id:101},data:`pilot:join:${joinId}:6`,message:{date:1792584000,message_id:90,chat:{id:101,type:'private'},from:{id:900}}}};
  await handleFetch(post(callback),f.env);assert.deepEqual(f.selectedGroups,['-1001001','-1001001']);
  callback.callback_query.from.id=102;callback.callback_query.message.chat.id=102;callback.update_id++;
  await handleFetch(post(callback),f.env);assert.equal(f.selectedGroups.at(-1),'102','an unrelated person cannot select the group through another member’s callback');
});

test('a current webhook uses one settings request and observes readiness changes on the next update', async t => {
  const f = await fixture(t, { ready: true });
  const store = createStore(f.db);
  await store.settings({ experience_version: EXPERIENCE_VERSION, experience_webhook_version: WEBHOOK_VERSION });
  const prepared = [];
  const prepare = f.db.prepare.bind(f.db);
  f.db.prepare = sql => { prepared.push(sql); return prepare(sql); };
  const post = () => request('/telegram/webhook', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET }, body: JSON.stringify(UPDATE),
  });
  assert.equal((await handleFetch(post(), f.env, f.ctx)).status, 200);
  await f.flush();
  assert.equal(prepared.length, 1, 'readiness and metadata share one database query');
  assert.match(prepared[0], /SELECT key,value FROM settings/);
  assert.equal(f.calls.length, 0, 'current menus need no Telegram metadata work');
  await store.settings({ ready: '0' });
  prepared.length = 0;
  assert.equal((await handleFetch(post(), f.env, f.ctx)).status, 503);
  assert.equal(prepared.length, 1);
  assert.equal(f.forwarded.length, 1, 'no stale readiness cache may admit another update');
});

test('a slow empty menu acknowledgement does not hold up coordinator processing', async t => {
  const f = await fixture(t, { ready: true });
  await createStore(f.db).settings({ experience_version: EXPERIENCE_VERSION, experience_webhook_version: WEBHOOK_VERSION });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const telegram = globalThis.fetch;
  let acknowledgementStarted = false;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/answerCallbackQuery')) {
      acknowledgementStarted = true;
      const params = JSON.parse(options.body);
      assert.deepEqual(params, { callback_query_id: 'menu-speed' }, 'early ack carries no private text or success claim');
      await gate;
    }
    return telegram(url, options);
  };
  const update = { update_id: 701, callback_query: {
    id: 'menu-speed', data: 'pilot:admin', from: { id: 101 },
    message: { date: 1792584000, message_id: 80, chat: { id: 101, type: 'private' }, from: { id: 900, is_bot: true } },
  } };
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(null), 1000); });
  try {
    const response = await Promise.race([handleFetch(request('/telegram/webhook', {
      method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': SECRET }, body: JSON.stringify(update),
    }), f.env, f.ctx), timeout]);
    assert.ok(response, 'Telegram acknowledgement must not block admission to the coordinator');
    assert.equal(response.status, 200);
    assert.equal(acknowledgementStarted, true);
    assert.equal(f.forwarded[0].headers.get('X-Pilot-Callback-Acknowledgement'), 'started');
    assert.deepEqual(f.forwarded[0].update, update, 'trusted context stays outside Telegram update JSON');
  } finally {
    clearTimeout(timer);
    release();
    await f.flush();
  }
  assert.equal(f.calls.filter(call => call.method === 'answerCallbackQuery').length, 1);
});

test('external acknowledgement markers cannot suppress handling and special callbacks retain their own response path', async t => {
  const f = await fixture(t, { ready: true });
  await createStore(f.db).settings({ experience_version: EXPERIENCE_VERSION, experience_webhook_version: WEBHOOK_VERSION });
  for (const data of ['pilot:unknown', 'pilot:updates', 'pilot:broadcast:confirm:123']) {
    const update = { update_id: 702, callback_query: {
      id: 'special-callback', data, from: { id: 101 },
      message: { date: 1792584000, message_id: 80, chat: { id: 101, type: 'private' } },
    } };
    const response = await handleFetch(request('/telegram/webhook', {
      method: 'POST', headers: {
        'X-Telegram-Bot-Api-Secret-Token': SECRET, 'X-Pilot-Callback-Acknowledgement': 'started',
      }, body: JSON.stringify(update),
    }), f.env, f.ctx);
    assert.equal(response.status, 200);
    assert.equal(f.forwarded.at(-1).headers.has('X-Pilot-Callback-Acknowledgement'), false);
  }
  await f.flush();
  assert.equal(f.calls.length, 0);
});
