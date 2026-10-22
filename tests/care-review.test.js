import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { TestD1 } from './helpers/d1.js';
import { applySchema, createStore } from '../src/store.js';
import { createControlStore, CONTROL_DEFAULTS } from '../src/control-store.js';
import { createToolsStore } from '../src/tools-store.js';
import { createOwnerAuth } from '../src/owner-auth.js';
import { createCareService, simulatePolicy, GROUP_PICKER_ID } from '../src/care-service.js';
import { createPerformanceService } from '../src/performance-service.js';
import { createRequestTiming } from '../src/request-timing.js';
import { createToolServices, handleToolsApi } from '../src/tools-api.js';

const NOW = 1792670400, ADMIN = 101, MEMBER = 102, OWNER = 103, BOT = 900;
const GROUP = -1001001, OTHER = -1001002, TOKEN = '900:public_care_review_fixture';
const BASE = 'https://pilot.sautilink.com';
const actor = { id: ADMIN, first_name: 'Asha' };
const publicRow = overrides => ({
  route: 'telegram', outcome: 'ok', queue_ms: 10, handling_ms: 80,
  db_ms: 20, telegram_ms: 30, first_reply_ms: 65, first_action_ms: null,
  ...overrides,
});

async function fixture(t) {
  const db = new TestD1(); t.after(() => db.close()); await applySchema(db);
  const store = createStore(db), control = createControlStore(db), tools = createToolsStore(db);
  await store.ensureExtras(); await control.ensure(); await tools.ensure();
  await store.group(GROUP); await store.group(OTHER); await store.settings({ ready: '1' });
  const owner = createOwnerAuth({ db }); await owner.ensure();
  await db.prepare('UPDATE pilot_owner SET user_id=? WHERE singleton=1').bind(String(OWNER)).run();
  let now = NOW, sendResult = { message_id: 1 }, sendError = null, roleError = null;
  const roles = new Map(), calls = [];
  const api = { async call(method, params = {}) {
    calls.push({ method, params: structuredClone(params) });
    if (method === 'getMe') return { id: BOT, is_bot: true, username: 'sautilinkpilotbot' };
    if (method === 'getChat') return { id: params.chat_id, type: 'supergroup', title: 'Review group' };
    if (method === 'getChatMember') {
      if (roleError) throw roleError;
      return roles.get(`${params.chat_id}:${params.user_id}`) || {
        status: [ADMIN, BOT].includes(params.user_id) ? 'administrator' : 'member',
        can_delete_messages: true, can_restrict_members: true,
      };
    }
    if (method === 'sendMessage') { if (sendError) throw sendError; return sendResult; }
    throw new Error(`Unexpected Telegram mutation: ${method}`);
  } };
  const clock = () => now, care = createCareService({ db, api, owner, clock });
  const performance = createPerformanceService({ db, api, owner, clock });
  const query = (view, input = {}, chatId = GROUP, who = actor) => care.query({ actor: who, chatId, view, input });
  return { db, store, control, tools, owner, api, roles, calls, care, performance, query, clock,
    setNow(value) { now = value; },
    setSendError(value) { sendError = value; },
    setSendResult(value) { sendResult = value; },
    setRoleError(value) { roleError = value; },
  };
}

test('doctor reports concrete missing permissions without posting or changing moderation state', async t => {
  const f = await fixture(t);
  f.roles.set(`${GROUP}:${BOT}`, { status: 'administrator', can_delete_messages: true, can_restrict_members: false });
  const before = await f.db.prepare('SELECT * FROM groups ORDER BY chat_id').all();
  const result = await f.query('doctor');
  assert.equal(result.ready, false);
  assert.equal(result.checks.find(check => check.id === 'delete').status, 'ready');
  assert.equal(result.checks.find(check => check.id === 'restrict').status, 'needs_attention');
  assert.equal(result.checks.find(check => check.id === 'moderation').status, 'ready');
  assert.deepEqual(await f.db.prepare('SELECT * FROM groups ORDER BY chat_id').all(), before);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM incidents').first()).n, 0);
  assert.ok(f.calls.every(call => ['getMe', 'getChat', 'getChatMember'].includes(call.method)));
});

test('care reads recheck current group authority and reject failures without exposing settings', async t => {
  const f = await fixture(t);
  await f.query('policy_test', { text: 'Hello' });
  f.roles.set(`${GROUP}:${ADMIN}`, { status: 'member' });
  for (const view of ['doctor', 'policy_test']) {
    await assert.rejects(f.query(view, view === 'policy_test' ? { text: 'Hello' } : {}), error => error.code === 'forbidden' && error.status === 403);
  }
  f.setRoleError(new Error('private upstream response must not leak'));
  await assert.rejects(f.query('doctor'), error => error.code === 'authorization_unavailable' && error.status === 503);
  assert.equal(f.calls.filter(call => call.method === 'getChatMember' && call.params.user_id === ADMIN).length, 4);
});

test('group chooser verifies the native request and live admin before remembering a group', async t => {
  const f = await fixture(t);
  const message = { chat: { id: ADMIN, type: 'private' }, from: actor, chat_shared: { request_id: GROUP_PICKER_ID, chat_id: GROUP } };
  for (const bad of [
    { ...message, chat: { id: MEMBER, type: 'private' } },
    { ...message, sender_chat: { id: GROUP } },
    { ...message, chat_shared: { request_id: GROUP_PICKER_ID + 1, chat_id: GROUP } },
  ]) await assert.rejects(f.care.acceptShared(bad), error => error.code === 'invalid_request');
  f.roles.set(`${GROUP}:${ADMIN}`, { status: 'left' });
  await assert.rejects(f.care.acceptShared(message), error => error.code === 'forbidden');
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM pilot_known_admins').first()).n, 0);
  f.roles.delete(`${GROUP}:${ADMIN}`);
  assert.equal((await f.care.acceptShared(message)).group.id, String(GROUP));
  const known = await f.db.prepare('SELECT user_id,chat_id FROM pilot_known_admins').first();
  assert.deepEqual(known, { user_id: String(ADMIN), chat_id: String(GROUP) });
});

test('policy preview uses the selected group and current expiry without persisting samples or proposals', async t => {
  const f = await fixture(t), url = 'https://approved.example/resource';
  await f.db.prepare('INSERT INTO pilot_whitelist_rules(id,chat_id,kind,value,created_by,created_at) VALUES(?,?,?,?,?,?)')
    .bind('review-rule', String(GROUP), 'url', url, String(ADMIN), NOW).run();
  await f.db.prepare('INSERT INTO pilot_temporary_links(id,chat_id,url,expires_at,created_by,created_at) VALUES(?,?,?,?,?,?)')
    .bind('review-temporary', String(GROUP), 'https://temporary.example/test', NOW + 30, String(ADMIN), NOW).run();
  await f.db.prepare('INSERT INTO pilot_group_settings(chat_id,settings_json,updated_at) VALUES(?,?,?)')
    .bind(String(GROUP), JSON.stringify({ flood_enabled: true, flood_limit: 2, flood_action: 'mute' }), NOW).run();
  const snapshot = async () => Promise.all(['pilot_group_settings', 'pilot_whitelist_rules', 'pilot_temporary_links', 'pilot_config_history', 'members', 'incidents', 'pilot_tool_operations'].map(table => f.db.prepare(`SELECT * FROM ${table}`).all()));
  const before = await snapshot();
  assert.equal((await f.query('policy_test', { text: url })).decision, 'allow');
  assert.equal((await f.query('policy_test', { text: url }, OTHER)).decision, 'delete_and_ban');
  assert.equal((await f.query('policy_test', { text: 'https://temporary.example/test' })).decision, 'allow');
  f.setNow(NOW + 31);
  assert.equal((await f.query('policy_test', { text: 'https://temporary.example/test' })).decision, 'delete_and_ban');
  const proposed = await f.query('policy_test', { text: 'private_sample_952 https://proposed.example/path', extraRules: [{ kind: 'url', value: 'https://proposed.example/path' }] });
  assert.equal(proposed.decision, 'allow'); assert.equal(proposed.usesProposedSettings, true);
  assert.equal((await f.query('policy_test', { text: 'https://proposed.example/path' })).decision, 'delete_and_ban');
  assert.deepEqual(await snapshot(), before);
  assert.ok(f.calls.every(call => call.method === 'getChatMember'));
});

test('policy preview matches saturated strike tiers and delete-only command cleanup precedence', () => {
  const settings = { ...CONTROL_DEFAULTS, flood_enabled: true, flood_limit: 2, flood_action: 'mute' };
  const simulate = input => simulatePolicy({ input, settings, rules: [] });
  for (const [priorStrikes, strike, durationSeconds] of [[0, 1, 86400], [1, 2, 604800], [2, 3, 0], [3, 3, 0]]) {
    const result = simulate({ text: 'https://blocked.example/', priorStrikes });
    assert.equal(result.decision, 'delete_and_ban'); assert.equal(result.strike, strike); assert.equal(result.durationSeconds, durationSeconds);
  }
  for (const sender of ['admin', 'anonymous_admin', 'linked_channel']) assert.equal(simulate({ text: 'https://blocked.example/', forwarded: true, sender }).decision, 'exempt');
  const text = `/${'a'.repeat(40)}`;
  assert.equal(simulate({ text, messagesInWindow: 10 }).decision, 'delete_only');
  assert.equal(simulate({ text, messagesInWindow: 10, proposedSettings: { command_spam_enabled: false } }).decision, 'allow');
  assert.equal(simulate({ text, format: 'code' }).decision, 'allow');
  assert.equal(simulate({ text: 'ordinary text', messagesInWindow: 10 }).decision, 'delete_and_mute');
  assert.equal(simulatePolicy({ input: { text: 'https://blocked.example/' }, settings, rules: [], enabled: false }).decision, 'paused');
});

test('performance authorization uses the bound numeric owner and rechecks each operation', async t => {
  const f = await fixture(t);
  const impostor = { id: MEMBER, username: 'drcharlestz' };
  await assert.rejects(f.performance.query({ actor: impostor }), error => error.code === 'forbidden');
  await assert.rejects(f.performance.perform({ actor: impostor, action: 'performance_settings', input: { alerts: true }, requestId: 'review_owner_denied' }), error => error.code === 'forbidden');
  assert.equal(await f.db.prepare("SELECT name FROM sqlite_master WHERE name='pilot_performance_preferences'").first(), null);
  assert.equal((await f.performance.query({ actor: { id: OWNER } })).samples, 0);
  await f.db.prepare('UPDATE pilot_owner SET user_id=? WHERE singleton=1').bind(String(ADMIN)).run();
  await assert.rejects(f.performance.query({ actor: { id: OWNER } }), error => error.code === 'forbidden');
  assert.equal(f.calls.length, 0);
});

test('independent timing samples keep slow and failed observations out of the distribution', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) await f.performance.record(publicRow({ first_reply_ms: i < 4 ? 65 : null }), { sampled: true });
  for (let i = 0; i < 20; i++) await f.performance.record(publicRow({ handling_ms: 10000, outcome: i < 3 ? 'error' : i < 5 ? 'retry' : 'ok' }), { sampled: false });
  await f.performance.record(publicRow({ handling_ms: 1 }), { sampled: false });
  const result = await f.performance.query({ actor: { id: OWNER } });
  assert.equal(result.samples, 10); assert.equal(result.averages.total_ms, 90);
  assert.deepEqual(result.percentiles.total_ms.p95, { upperMs: 100, overflow: false });
  assert.equal(result.percentiles.first_reply_ms.observations, 4);
  assert.deepEqual(result.issues, { observations: 20, errors: 3, retries: 2, slow: 20 });
  assert.equal(result.sampleErrors, 0); assert.equal(result.sampleRetries, 0);
  let now = 0, draws = 0; const observed = [];
  for (const outcome of ['ok', 'error']) {
    const timer = createRequestTiming('telegram', { now: () => now, sample: () => { draws++; return false; }, report: () => {}, observe: (row, selection) => observed.push({ row, selection }) });
    timer.start(); now += outcome === 'ok' ? 20 : 10000; timer.finish(outcome);
  }
  assert.equal(draws, 2); assert.equal(observed.length, 2);
  assert.ok(observed.every(item => item.selection.sampled === false));
  assert.deepEqual(Object.keys(observed[0].row).sort(), ['callback_ack_ms','db_calls','db_ms','first_action_ms','first_reply_ms','handling_ms','outcome','queue_ms','route','telegram_calls','telegram_ms']);
});

test('histogram distinguishes a two-minute sample from a genuine over-five-minute sample', async t => {
  const f = await fixture(t);
  await f.performance.record(publicRow({ queue_ms: 0, handling_ms: 120000 }), { sampled: true });
  await f.performance.record(publicRow({ route: 'control', queue_ms: 0, handling_ms: 300001 }), { sampled: true });
  const within = await f.performance.query({ actor: { id: OWNER } });
  const above = await f.performance.query({ actor: { id: OWNER }, input: { route: 'control' } });
  assert.deepEqual(within.percentiles.total_ms.p95, { upperMs: 300000, overflow: false });
  assert.deepEqual(above.percentiles.total_ms.p95, { upperMs: 300000, overflow: true });
});

test('performance alerts persist unknown sends, honor cooldown and reconcile interrupted claims without resend', async t => {
  const f = await fixture(t);
  await f.performance.perform({ actor: { id: OWNER }, action: 'performance_settings', input: { alerts: true, language: 'en' }, requestId: 'review_owner_alerts' });
  for (let i = 0; i < 3; i++) await f.performance.record(publicRow({ outcome: 'error' }));
  f.setSendError(Object.assign(new Error('connection dropped after write'), { ambiguous: true }));
  assert.equal((await f.performance.monitor()).status, 'unknown');
  assert.equal((await f.performance.monitor()).status, 'idle');
  const sends = f.calls.filter(call => call.method === 'sendMessage');
  assert.equal(sends.length, 1); assert.equal(sends[0].params.chat_id, OWNER);
  assert.equal((await f.performance.query({ actor: { id: OWNER } })).preferences.lastAlertStatus, 'unknown');
  f.setNow(NOW + 3601);
  await f.db.prepare("UPDATE pilot_performance_preferences SET last_alert_status='sending' WHERE singleton=1").run();
  await f.performance.monitor();
  assert.equal((await f.performance.query({ actor: { id: OWNER } })).preferences.lastAlertStatus, 'unknown');
  assert.equal(f.calls.filter(call => call.method === 'sendMessage').length, 1);
});

test('signed tools gateway keeps performance owner-only and rejects group attachment', async t => {
  const f = await fixture(t), services = createToolServices({ db: f.db, api: f.api, clock: f.clock });
  const dispatches = [];
  const env = { DB: f.db, BOT_TOKEN: TOKEN, PUBLIC_BASE_URL: BASE, GROUPS: {
    idFromName: name => name,
    get(name) { return { async fetch(url, options) {
      const payload = await new Request(url, options).json(); dispatches.push({ name, payload });
      try { return Response.json(await services.perform(payload)); }
      catch (error) { return Response.json({ ok: false, error: error.code }, { status: error.status || 503 }); }
    } }; },
  } };
  const run = (body, id = OWNER) => {
    const params = new URLSearchParams({ auth_date: String(NOW), user: JSON.stringify({ id, first_name: 'Review', username: 'drcharlestz' }), query_id: 'review_session' });
    const content = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
    const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
    params.set('hash', createHmac('sha256', key).update(content).digest('hex'));
    return handleToolsApi(new Request(`${BASE}/api/tools`, { method: 'POST', headers: { Origin: BASE, 'Content-Type': 'application/json', Authorization: `tma ${params}` }, body: JSON.stringify(body) }), env, { api: f.api, clock: f.clock });
  };
  assert.equal((await run({ view: 'performance' }, MEMBER)).status, 403);
  assert.equal((await run({ view: 'performance', chatId: GROUP })).status, 400);
  const write = { action: 'performance_settings', input: { alerts: false }, requestId: 'review_settings_gateway_123' };
  assert.equal((await run({ ...write, chatId: GROUP })).status, 400); assert.equal(dispatches.length, 0);
  assert.equal((await run(write, MEMBER)).status, 403);
  assert.equal((await run(write)).status, 200);
  assert.ok(dispatches.every(call => call.name === '__pilot_performance__' && call.payload.chatId === undefined));
  const read = await run({ view: 'performance' }); assert.equal(read.status, 200);
  assert.equal(read.headers.get('Cache-Control'), 'no-store');
  assert.equal(read.headers.get('X-Robots-Tag'), 'noindex, nofollow');
});
