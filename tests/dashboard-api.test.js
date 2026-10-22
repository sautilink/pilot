import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handleDashboardApi } from '../src/dashboard-api.js';
import { createControlService, ControlError } from '../src/control-service.js';
import { createControlStore } from '../src/control-store.js';
import { applySchema } from '../src/store.js';
import { TestD1 } from './helpers/d1.js';

const TOKEN = '900:public_test_only_token';
const NOW = 1792641600;
const BASE = 'https://pilot.sautilink.com';
function signedData(user = { id: 101, first_name: 'Asha', language_code: 'sw' }, date = NOW) {
  const params = new URLSearchParams({ auth_date: String(date), user: JSON.stringify(user), query_id: 'public_test_query' });
  const payload = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const key = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  params.set('hash', createHmac('sha256', key).update(payload).digest('hex'));
  return params.toString();
}
function makeRequest(body = { view: 'groups' }, { method = 'POST', origin = BASE, auth = signedData(), headers = {}, raw } = {}) {
  return new Request(`${BASE}/api/pilot`, {
    method,
    headers: { ...(origin === null ? {} : { Origin: origin }), 'Content-Type': 'application/json', ...(auth === null ? {} : { Authorization: `tma ${auth}` }), ...headers },
    ...(method === 'POST' ? { body: raw ?? JSON.stringify(body) } : {}),
  });
}
function fixture() {
  const queries = [], dispatches = [], groups = [];
  const service = { async query(input) { queries.push(input); return { ok: true, groups: [] }; }, async mutate() { assert.fail('HTTP mutations must not bypass the group coordinator'); } };
  const env = { DB: {}, BOT_TOKEN: TOKEN, PUBLIC_BASE_URL: BASE, GROUPS: {
    idFromName(value) { groups.push(value); return value; },
    get(id) { return { async fetch(request) { dispatches.push({ id, url: request.url, body: await request.json() }); return Response.json({ ok: true, action: 'pause' }); } }; },
  } };
  const run = request => handleDashboardApi(request, env, { service, clock: () => NOW });
  return { env, service, queries, dispatches, groups, run };
}

test('Mini App API derives identity exclusively from signed Telegram data and never enables caching or CORS', async () => {
  const f = fixture();
  const response = await f.run(makeRequest());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), null);
  assert.deepEqual(await response.json(), { ok: true, data: { ok: true, groups: [] } });
  assert.deepEqual(f.queries[0], { actor: { id: 101, first_name: 'Asha', language_code: 'sw' }, chatId: undefined, view: 'groups', input: {} });
  assert.equal((await f.run(makeRequest({ view: 'groups', actor: { id: 1 } }))).status, 400);
  assert.equal(f.queries.length, 1);
});

test('cross-origin, missing authentication and expired sessions are rejected before any service or coordinator work', async () => {
  const f = fixture();
  assert.equal((await f.run(makeRequest({}, { method: 'GET' }))).status, 405);
  assert.equal((await f.run(makeRequest({}, { origin: 'https://unrelated.example' }))).status, 403);
  assert.equal((await f.run(makeRequest({}, { origin: 'null' }))).status, 403);
  assert.equal((await f.run(makeRequest({}, { auth: null }))).status, 401);
  assert.equal((await f.run(makeRequest({}, { auth: signedData().replace('Asha', 'Admin') }))).status, 401);
  const expired = await f.run(makeRequest({}, { auth: signedData(undefined, NOW - 3601) }));
  assert.deepEqual(await expired.json(), { ok: false, error: 'SESSION_EXPIRED' });
  assert.equal(f.queries.length, 0); assert.equal(f.dispatches.length, 0);
});

test('valid writes route to the exact group coordinator with authenticated actor and stable request ID', async () => {
  const f = fixture();
  const requestId = 'test_request_1234567890';
  const response = await f.run(makeRequest({ action: 'pause', chatId: '-1001001', input: {}, requestId }));
  assert.equal(response.status, 200);
  assert.deepEqual(f.groups, ['-1001001']);
  assert.deepEqual(f.dispatches, [{ id: '-1001001', url: 'https://group.internal/control', body: { actor: { id: 101, first_name: 'Asha', language_code: 'sw' }, chatId: '-1001001', action: 'pause', input: {}, requestId } }]);
  assert.equal(f.queries.length, 0);
});

test('own appeal writes still go through the group coordinator for ownership and case checks', async () => {
  const f = fixture();
  await f.run(makeRequest({ action: 'appeal_create', chatId: -1001001, requestId: 'appeal_public_request_1', input: { incidentId: 'case-123', message: 'Please review this case.' } }));
  assert.equal(f.dispatches[0].body.actor.id, 101);
  assert.equal(f.dispatches[0].body.action, 'appeal_create');
  assert.equal(f.dispatches[0].body.chatId, '-1001001');
});

test('request limits and schema checks reject malformed or oversized input before services', async () => {
  const f = fixture();
  for (const body of [[], null, { view: 'unknown' }, { view: 'overview' }, { view: 'groups', action: 'pause' }, { view: 'overview', chatId: '1001' }, { view: 'overview', chatId: '-9007199254740992' }, { view: 'groups', input: [] }, { action: 'pause', chatId: '-1001', requestId: 'tiny' }, { action: 'unsafe', chatId: '-1001', requestId: 'test_request_1234567890' }]) assert.equal((await f.run(makeRequest(body))).status, 400);
  assert.equal((await f.run(makeRequest({}, { raw: '{broken' }))).status, 400);
  assert.equal((await f.run(makeRequest({}, { raw: ' '.repeat(32769) }))).status, 413);
  assert.equal((await f.run(makeRequest({}, { headers: { 'Content-Length': '32769' } }))).status, 413);
  assert.equal((await f.run(makeRequest({}, { headers: { 'Content-Type': 'text/plain' } }))).status, 415);
  assert.equal(f.queries.length, 0); assert.equal(f.dispatches.length, 0);
});

test('service and coordinator failures expose only bounded error codes, never provider diagnostics', async () => {
  const f = fixture();
  f.service.query = async () => { throw new ControlError('forbidden', 403); };
  const denied = await f.run(makeRequest());
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { ok: false, error: 'forbidden' });
  f.service.query = async () => { throw new Error(`provider URL contains ${TOKEN}`); };
  assert.deepEqual(await (await f.run(makeRequest())).json(), { ok: false, error: 'UNAVAILABLE' });
  f.env.GROUPS.get = () => ({ fetch: async () => Response.json({ ok: false, error: 'case_stale' }, { status: 409 }) });
  const stale = await f.run(makeRequest({ action: 'case_unban', chatId: '-1001', requestId: 'public_request_123456', input: { incidentId: 'case-123' } }));
  assert.equal(stale.status, 409); assert.deepEqual(await stale.json(), { ok: false, error: 'case_stale' });
});

test('real control-service integration rechecks group access on every authenticated request', async t => {
  const db = new TestD1(); t.after(() => db.close()); await applySchema(db);
  let role = 'administrator'; const roles = [];
  const api = { async call(method, params) {
    if (method === 'getMe') return { id: 900, username: 'sautilinkpilotbot', is_bot: true };
    if (method === 'getChatMember') { roles.push(params); return { status: params.user_id === 900 ? 'administrator' : role, can_delete_messages: true, can_restrict_members: true }; }
    if (method === 'getChat') return { id: -1001001, title: 'Private group', type: 'supergroup' };
    throw new Error('Unexpected method');
  } };
  const control = createControlStore(db); await control.ensure(); await control.rememberAdmin(101, -1001001, NOW);
  const env = { DB: db, BOT_TOKEN: TOKEN, PUBLIC_BASE_URL: BASE };
  const service = createControlService({ db, api, clock: () => NOW });
  const first = await handleDashboardApi(makeRequest(), env, { service, clock: () => NOW });
  assert.equal((await first.json()).data.groups[0].title, 'Private group');
  role = 'member';
  const overview = await handleDashboardApi(makeRequest({ view: 'overview', chatId: '-1001001' }), env, { service, clock: () => NOW });
  assert.equal(overview.status, 403);
  const text = await overview.text(); assert.equal(text.includes('Private group'), false);
  assert.ok(roles.filter(row => row.user_id === 101).length >= 2);
});
