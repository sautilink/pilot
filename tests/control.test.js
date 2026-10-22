import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TestD1 } from './helpers/d1.js';
import { applySchema, createStore } from '../src/store.js';
import { createControlStore, CONTROL_SCHEMA_SQL, CONTROL_DEFAULTS } from '../src/control-store.js';
import { createControlService, ControlError } from '../src/control-service.js';
import { createGuardrailStore } from '../src/guardrail-store.js';
import { TelegramError } from '../src/telegram.js';
import { analyzeMessage } from '../src/policy.js';

const GROUP = -1001100, OTHER = -1002200, ADMIN = 102, USER = 101, STRANGER = 103, BOT = 900;
const START = Date.UTC(2026, 9, 22, 12) / 1000;
const actor = id => ({ id, first_name: 'Person', language_code: 'sw' });

class FakeTelegram {
  constructor() { this.calls = []; this.members = new Map(); this.hooks = new Map(); }
  setMember(chat, user, status, extra = {}) { this.members.set(`${chat}:${user}`, { status, user: { id: user }, ...extra }); }
  callsOf(method) { return this.calls.filter(call => call.method === method); }
  async call(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (this.hooks.has(method)) return this.hooks.get(method)(params, this);
    if (method === 'getMe') return { id: BOT, is_bot: true, username: 'sautilinkpilotbot' };
    if (method === 'getChat') return { id: params.chat_id, type: 'supergroup', title: params.chat_id === GROUP ? 'Group A' : 'Private other group' };
    if (method === 'getChatMember') {
      if (params.user_id === BOT) return { status: 'administrator', can_delete_messages: true, can_restrict_members: true };
      return this.members.get(`${params.chat_id}:${params.user_id}`) || { status: 'left' };
    }
    if (method === 'unbanChatMember') { this.setMember(params.chat_id, params.user_id, 'left'); return true; }
    throw new Error(`Unexpected API method ${method}`);
  }
}

async function fixture(t) {
  const db = new TestD1();
  t.after(() => db.close());
  await applySchema(db);
  const base = createStore(db), control = createControlStore(db), guards = createGuardrailStore(db), api = new FakeTelegram();
  await control.ensure();
  api.setMember(GROUP, ADMIN, 'administrator');
  let now = START, request = 0, incident = 0;
  const service = createControlService({ db, api, clock: () => now });
  return {
    db, base, control, guards, api, service,
    now: () => now, advance: seconds => { now += seconds; },
    query(view, input = {}, chatId = GROUP, user = ADMIN) { return service.query({ actor: actor(user), chatId, view, input }); },
    mutate(action, input = {}, options = {}) { return service.mutate({ actor: actor(ADMIN), chatId: GROUP, action, input, requestId: `test:${++request}`, ...options }); },
    async case(overrides = {}) {
      const seq = ++incident;
      const row = {
        id: `case-${seq}`, chat_id: GROUP, user_id: USER, message_id: seq, event_at: now - 10,
        created_at: now - 5, strike: 1, until_date: now + 86400, reasons: '["link"]', ...overrides,
      };
      await base.member(row.chat_id, row.user_id);
      await base.plan(row);
      await base.confirm(row, now);
      api.setMember(row.chat_id, row.user_id, 'kicked', { until_date: row.until_date });
      return row;
    },
  };
}

const code = expected => error => error instanceof ControlError && error.code === expected;

test('control schema is idempotent, matches its migration, and supplies current protection defaults', async t => {
  const f = await fixture(t);
  await f.control.ensure();
  await createControlStore(f.db).ensure();
  assert.deepEqual(await f.control.settings(GROUP), CONTROL_DEFAULTS);
  assert.deepEqual(await f.control.rules(GROUP), []);
  assert.deepEqual(await f.control.subscription(ADMIN, GROUP), { alerts: false, report: 'off' });
  const migration = await readFile(new URL('../migrations/0003_control_center.sql', import.meta.url), 'utf8');
  assert.equal(migration.trim(), CONTROL_SCHEMA_SQL.trim());
});

test('command-spam deletion defaults on for new and legacy groups while explicit opt-outs persist', async t => {
  const f = await fixture(t);
  assert.equal((await f.control.settings(GROUP)).command_spam_enabled, true);
  assert.equal((await f.control.settings(GROUP)).command_spam_allowlist, '');
  await f.control.run('INSERT INTO pilot_group_settings VALUES(?,?,?)', String(GROUP), JSON.stringify({ welcome_enabled: true, flood_action: 'mute' }), START);
  let settings = await f.control.settings(GROUP);
  assert.equal(settings.command_spam_enabled, true);
  assert.equal(settings.welcome_enabled, true);
  assert.equal(settings.flood_action, 'mute');
  await f.mutate('configure', { settings: { command_spam_enabled: false, command_spam_allowlist: '/get_*@MusicBot' } });
  // A new store instance represents a later Worker request/deployment.
  settings = await createControlStore(f.db).settings(GROUP);
  assert.equal(settings.command_spam_enabled, false);
  assert.equal(settings.command_spam_allowlist, '/get_*@musicbot');
  assert.equal((await f.control.settings(OTHER)).command_spam_enabled, true);
  assert.equal((await f.control.settings(OTHER)).command_spam_allowlist, '');
});

test('invalid stored command-spam settings safely fall back without creating broad exceptions', async t => {
  const f = await fixture(t);
  await f.control.run('INSERT INTO pilot_group_settings VALUES(?,?,?)', String(GROUP), JSON.stringify({ command_spam_enabled: 'false', command_spam_allowlist: '/*', command_spam_action: 'ban', rules_en: 'Be kind.' }), START);
  const settings = await f.control.settings(GROUP);
  assert.equal(settings.command_spam_enabled, true);
  assert.equal(settings.command_spam_allowlist, '');
  assert.equal(settings.rules_en, 'Be kind.');
  assert.equal(Object.hasOwn(settings, 'command_spam_action'), false);
});

test('command exceptions normalize per group and configuration retries do not duplicate mutations', async t => {
  const f = await fixture(t);
  const requestId = 'command-rules:configure:1';
  const exact = '/AbC123_' + 'X'.repeat(40);
  const result = await f.mutate('configure', { settings: { command_spam_allowlist: `  ${exact}\r\n/get_*@MusicBot\n${exact}\n` } }, { requestId });
  assert.equal(result.settings.command_spam_allowlist, `${exact}\n/get_*@musicbot`);
  const repeated = await f.mutate('configure', { settings: { command_spam_allowlist: `${exact}\n/get_*@musicbot` } }, { requestId });
  assert.equal(repeated.duplicate, true);
  const audit = await f.control.all('SELECT action,details_json FROM pilot_audit');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'configure');
  assert.deepEqual(JSON.parse(audit[0].details_json), { keys: ['command_spam_allowlist'] });
  assert.equal((await f.control.settings(OTHER)).command_spam_allowlist, '');
  assert.deepEqual(await f.control.rules(GROUP), []);
  assert.deepEqual(analyzeMessage({ text: '/get_x https://unapproved.example' }, await f.control.rules(GROUP)).reasons, ['link']);
  assert.deepEqual(analyzeMessage({ text: exact, forward_origin: { type: 'hidden_user' } }, await f.control.rules(GROUP)).reasons, ['forward']);
});

test('command-spam settings require the current group admin and cannot enable punitive actions', async t => {
  const f = await fixture(t);
  const settings = { command_spam_enabled: false, command_spam_allowlist: '/get_*' };
  await assert.rejects(f.mutate('configure', { settings }, { actor: actor(USER) }), code('forbidden'));
  await assert.rejects(f.mutate('configure', { settings }, { chatId: OTHER }), code('forbidden'));
  assert.equal((await f.control.settings(GROUP)).command_spam_enabled, true);
  assert.equal((await f.control.settings(OTHER)).command_spam_allowlist, '');
  await assert.rejects(f.mutate('configure', { settings: { command_spam_action: 'mute' } }), code('invalid_settings'));
  await assert.rejects(f.mutate('configure', { settings: { command_spam_action: 'ban' } }), code('invalid_settings'));
  await f.mutate('configure', { settings });
  f.api.setMember(GROUP, ADMIN, 'member');
  await assert.rejects(f.mutate('configure', { settings: { command_spam_enabled: true } }), code('forbidden'));
  assert.equal((await f.control.settings(GROUP)).command_spam_enabled, false);
  assert.ok(f.api.calls.every(call => ['getChatMember'].includes(call.method)));
});

test('command exceptions reject wildcard bypasses, malformed values and oversized lists atomically', async t => {
  const f = await fixture(t);
  const invalid = [
    null, true, 12, [], {}, '/*', '*', '/ab*', '/foo**', '/get_.+', '/get_*@someone',
    'https://example.com', '/get_.*', '/get_ argument', '/get_\u0000', '/foo@a_bot_2',
    '/' + 'a'.repeat(129), '/' + 'a'.repeat(33) + '*', '/get_*@' + 'a'.repeat(30) + 'bot',
    Array.from({ length: 21 }, (_, i) => `/command_${i}`).join('\n'), ' '.repeat(2001),
  ];
  for (const value of invalid) {
    await assert.rejects(f.mutate('configure', { settings: { command_spam_enabled: false, command_spam_allowlist: value } }), code('invalid_settings'));
  }
  await assert.rejects(f.mutate('configure', { settings: { command_spam_enabled: 0 } }), code('invalid_settings'));
  assert.equal((await f.control.settings(GROUP)).command_spam_enabled, true);
  assert.equal((await f.control.settings(GROUP)).command_spam_allowlist, '');
  assert.equal((await f.control.all('SELECT * FROM pilot_audit')).length, 0);
  const saved = await f.mutate('configure', { settings: { command_spam_allowlist: '  \n\r\n' } });
  assert.equal(saved.settings.command_spam_allowlist, '');
});

test('admin queries freshly authorize before titles and only list currently authorized known groups', async t => {
  const f = await fixture(t);
  await f.control.rememberAdmin(ADMIN, GROUP, START);
  await f.control.rememberAdmin(ADMIN, OTHER, START);
  const groups = await f.query('groups');
  assert.deepEqual(groups.groups.map(group => group.id), [GROUP]);
  assert.ok(!f.api.callsOf('getChat').some(call => call.params.chat_id === OTHER));
  const role = f.api.calls.findIndex(call => call.method === 'getChatMember' && call.params.chat_id === GROUP);
  const title = f.api.calls.findIndex(call => call.method === 'getChat' && call.params.chat_id === GROUP);
  assert.ok(role >= 0 && title > role);
  f.api.setMember(GROUP, ADMIN, 'member');
  await assert.rejects(f.query('overview'), code('forbidden'));
  await assert.rejects(f.mutate('configure', { settings: { welcome_enabled: true } }), code('forbidden'));
  assert.equal((await f.control.settings(GROUP)).welcome_enabled, false);
});

test('cross-group admin requests and forged actor inputs cannot expose or alter another group', async t => {
  const f = await fixture(t);
  const other = await f.case({ chat_id: OTHER });
  await assert.rejects(f.query('overview', {}, OTHER), code('forbidden'));
  await assert.rejects(f.mutate('case_unban', { incidentId: other.id }), code('not_found'));
  await assert.rejects(f.mutate('configure', { settings: { welcome_enabled: true }, actor: actor(ADMIN) }, { actor: actor(USER) }), code('invalid_input'));
  assert.equal(f.api.callsOf('getChat').length, 0);
  assert.equal(f.api.callsOf('unbanChatMember').length, 0);
});

test('known groups paginate over at most 20 stable candidates, including revoked entries without leaking their titles', async t => {
  const f = await fixture(t);
  const chats = Array.from({ length: 21 }, (_, index) => String(-1003000 - index)).sort();
  for (const chat of chats) {
    await f.control.rememberAdmin(ADMIN, chat, START);
    f.api.setMember(Number(chat), ADMIN, 'administrator');
  }
  // A second actor's association is not a pagination candidate.
  await f.control.rememberAdmin(STRANGER, -1001000, START);
  const first = await f.query('groups');
  assert.equal(first.groups.length, 20);
  assert.equal(first.nextCursor, chats[19]);
  assert.equal(f.api.callsOf('getChatMember').length, 20);
  assert.equal(f.api.callsOf('getChat').length, 20);
  f.advance(5); // Authorization updates verified_at without changing cursor order.
  const second = await f.query('groups', { cursor: first.nextCursor });
  assert.deepEqual(second.groups.map(row => String(row.id)), [chats[20]]);
  assert.equal(second.nextCursor, null);
  assert.equal(f.api.callsOf('getChatMember').length, 21);

  for (const chat of chats.slice(0, 20)) f.api.setMember(Number(chat), ADMIN, 'member');
  f.api.calls = [];
  const revokedPage = await f.query('groups');
  assert.deepEqual(revokedPage.groups, []);
  assert.equal(revokedPage.nextCursor, chats[19]);
  assert.equal(f.api.callsOf('getChat').length, 0);
  assert.equal((await f.query('groups', { cursor: revokedPage.nextCursor })).groups[0].id, Number(chats[20]));
  await assert.rejects(f.query('groups', { cursor: 'not-a-chat' }), code('invalid_cursor'));
  await assert.rejects(f.query('groups', { limit: 100 }), code('invalid_input'));
});

test('group discovery includes a previously verified private admin context within its bounded candidates', async t => {
  const f = await fixture(t);
  await f.base.setAdminContext(ADMIN, GROUP, START);
  assert.equal((await f.control.listAdminAssociations({ userId: ADMIN })).length, 0);
  const result = await f.query('groups');
  assert.deepEqual(result.groups.map(row => row.id), [GROUP]);
  assert.equal(result.nextCursor, null);
  assert.equal(f.api.callsOf('getChatMember').length, 1);
});

test('mystatus is restricted to the authenticated actor, including when that actor is banned', async t => {
  const f = await fixture(t);
  const own = await f.case();
  await f.case({ user_id: STRANGER });
  await f.case({ chat_id: OTHER, user_id: STRANGER });
  const result = await f.query('mystatus', {}, null, USER);
  assert.deepEqual(result.incidents.map(row => row.id), [own.id]);
  assert.equal(result.incidents[0].user_id, String(USER));
  assert.equal(f.api.calls.length, 0);
  await assert.rejects(f.service.query({ actor: { id: -1 }, view: 'mystatus' }), code('unauthorized'));
});

test('link checker defaults to global rules and group scope requires membership or an owned incident', async t => {
  const f = await fixture(t);
  await f.mutate('whitelist_add', { kind: 'domain', value: 'example.com' });
  const base = await f.query('checklink', { text: 'https://example.com https://sautilink.com tg://resolve?domain=other' }, null, STRANGER);
  assert.equal(base.scope.type, 'base');
  assert.deepEqual(base.destinations.map(link => link.allowed), [false, true, false]);
  assert.equal(base.forwardWarning, true);
  await assert.rejects(f.query('checklink', { text: 'https://example.com' }, GROUP, STRANGER), code('forbidden'));
  f.api.setMember(GROUP, STRANGER, 'member');
  assert.equal((await f.query('checklink', { text: 'https://example.com' }, GROUP, STRANGER)).destinations[0].allowed, true);
  await f.case();
  assert.equal((await f.query('checklink', { text: 'https://example.com' }, GROUP, USER)).destinations[0].allowed, true);
  assert.equal(f.api.callsOf('getChat').length, 0);
  await assert.rejects(f.query('checklink', { text: 'x'.repeat(4097) }, null, USER), code('invalid_text'));
});

test('custom whitelist additions are normalized, group-scoped, additive, and removable only by their group', async t => {
  const f = await fixture(t);
  const added = await f.mutate('whitelist_add', { kind: 'subdomains', value: 'HTTPS://EXAMPLE.COM:443/' });
  assert.deepEqual({ kind: added.rule.kind, value: added.rule.value }, { kind: 'subdomains', value: 'example.com' });
  const rules = await f.control.rules(GROUP);
  assert.deepEqual(analyzeMessage({ text: 'https://www.example.com' }, rules).reasons, []);
  assert.deepEqual(analyzeMessage({ text: 'https://www.example.com' }, await f.control.rules(OTHER)).reasons, ['link']);
  assert.deepEqual(analyzeMessage({ text: 'https://sautilink.com' }, rules).reasons, []);
  const duplicate = await f.mutate('whitelist_add', { kind: 'subdomains', value: 'example.com' });
  assert.equal(duplicate.rule.id, added.rule.id);
  assert.equal((await f.control.rules(GROUP)).length, 1);
  f.api.setMember(OTHER, ADMIN, 'creator');
  await assert.rejects(f.mutate('whitelist_remove', { id: added.rule.id }, { chatId: OTHER }), code('not_found'));
  await f.mutate('whitelist_remove', { id: added.rule.id });
  assert.deepEqual(await f.control.rules(GROUP), []);
  await assert.rejects(f.mutate('whitelist_add', { kind: 'domain', value: 'https://example.com@evil.test' }), code('invalid_rule'));
});

test('configure validates every field and placeholder before applying any setting', async t => {
  const f = await fixture(t);
  const invalid = [
    { flood_limit: 2 }, { flood_limit: 31 }, { flood_limit: '8' }, { flood_window: 4 }, { flood_window: 61 },
    { flood_mute_seconds: 59 }, { flood_mute_seconds: 3601 }, { flood_action: 'ban' }, { join_gate_mode: 'automatic' },
    { welcome_enabled: 1 }, { welcome_sw: 'x'.repeat(401) }, { rules_en: 'x'.repeat(601) }, { notice_en: 'x'.repeat(241) },
    { notice_template: 'raw' }, { welcome_sw: 'Hello {token}' }, { notice_sw: '{rules}' }, { welcome_en: 'Hello {user' }, { made_up: true },
  ];
  for (const settings of invalid) await assert.rejects(f.mutate('configure', { settings: { welcome_enabled: true, ...settings } }), error => error instanceof ControlError && ['invalid_settings', 'invalid_template'].includes(error.code));
  await assert.rejects(f.mutate('configure', { settings: null }), code('invalid_settings'));
  assert.deepEqual(await f.control.settings(GROUP), CONTROL_DEFAULTS);
  const valid = await f.mutate('configure', { language: 'en', settings: { welcome_enabled: true, welcome_en: 'Hello {user}, welcome to {group}. {rules}', rules_en: 'Be kind.', notice_template: 'compact', notice_en: '{user}: {reason}, {duration} in {group}.', flood_limit: 30, flood_window: 60, flood_mute_seconds: 3600, join_gate_mode: 'challenge' } });
  assert.equal(valid.settings.welcome_enabled, true);
  assert.equal(valid.language, 'en');
  assert.equal(await f.base.getLanguage('group', GROUP), 'en');
  assert.equal(await f.base.getLanguage('user', ADMIN), 'sw');
  assert.equal((await f.control.settings(OTHER)).welcome_enabled, false);
});

test('request ids bind actor, group, action and normalized input without duplicating successful mutations', async t => {
  const f = await fixture(t);
  const requestId = 'tg:99:102:configure';
  const input = { settings: { welcome_enabled: true } };
  await f.mutate('configure', input, { requestId });
  assert.equal((await f.mutate('configure', input, { requestId })).duplicate, true);
  assert.equal((await f.control.all('SELECT * FROM pilot_audit')).length, 1);
  await assert.rejects(f.mutate('configure', { settings: { welcome_enabled: false } }, { requestId }), code('request_conflict'));
  await assert.rejects(f.mutate('pause', {}, { requestId }), code('request_conflict'));
  await assert.rejects(f.mutate('pause', {}, { requestId: 'invalid id with spaces' }), code('invalid_request_id'));
  assert.equal((await f.control.settings(GROUP)).welcome_enabled, true);
  f.api.setMember(GROUP, ADMIN, 'member');
  await assert.rejects(f.mutate('configure', input, { requestId }), code('forbidden'));
});

test('pause/resume and opt-in subscriptions preserve independent group and personal preferences', async t => {
  const f = await fixture(t);
  await f.mutate('pause');
  assert.equal((await f.base.group(GROUP)).enabled, 0);
  f.advance(10);
  await f.mutate('resume');
  assert.equal((await f.base.group(GROUP)).activated_at, f.now());
  const first = await f.mutate('subscribe', { alerts: true, report: 'weekly' });
  assert.deepEqual(first.subscription, { alerts: true, report: 'weekly' });
  const second = await f.mutate('subscribe', { alerts: false });
  assert.deepEqual(second.subscription, { alerts: false, report: 'weekly' });
  assert.deepEqual(await f.control.subscription(USER, GROUP), { alerts: false, report: 'off' });
  assert.deepEqual(await f.control.subscription(ADMIN, OTHER), { alerts: false, report: 'off' });
});

test('an owned appeal works while banned, stores one case only, and never caches its private text in operations or audit', async t => {
  const f = await fixture(t);
  const row = await f.case();
  const input = { incidentId: row.id, message: 'Private explanation of this mistake.' };
  const created = await f.mutate('appeal_create', input, { actor: actor(USER), requestId: 'appeal:first' });
  assert.equal(created.appeal.status, 'open');
  assert.equal(created.appeal.user_id, String(USER));
  const repeat = await f.mutate('appeal_create', { ...input, message: 'Different explanation' }, { actor: actor(USER) });
  assert.equal(repeat.appeal.id, created.appeal.id);
  assert.equal((await f.control.first('SELECT message FROM pilot_appeals WHERE id=?', created.appeal.id)).message, input.message);
  assert.equal(f.api.callsOf('getChatMember').length, 0);
  assert.ok((await f.control.all('SELECT result_json FROM pilot_operations')).every(row => !row.result_json.includes('Private explanation')));
  assert.ok((await f.control.all('SELECT details_json FROM pilot_audit')).every(row => !row.details_json.includes('explanation')));
  await assert.rejects(f.mutate('appeal_create', input, { actor: actor(STRANGER) }), code('not_found'));
});

test('appeals are rate-limited across cases without allowing another user’s case or group', async t => {
  const f = await fixture(t);
  const first = await f.case(), second = await f.case(), third = await f.case(), fourth = await f.case();
  await f.mutate('appeal_create', { incidentId: first.id, message: 'Review please.' }, { actor: actor(USER) });
  await assert.rejects(f.mutate('appeal_create', { incidentId: second.id, message: 'Review please.' }, { actor: actor(USER) }), code('appeal_rate_limited'));
  for (const row of [second, third]) {
    f.advance(61);
    await f.mutate('appeal_create', { incidentId: row.id, message: 'Review please.' }, { actor: actor(USER) });
  }
  f.advance(61);
  await assert.rejects(f.mutate('appeal_create', { incidentId: fourth.id, message: 'Review please.' }, { actor: actor(USER) }), code('appeal_rate_limited'));
  await assert.rejects(f.mutate('appeal_create', { incidentId: first.id, message: 'Wrong group.' }, { actor: actor(USER), chatId: OTHER }), code('not_found'));
  assert.equal((await f.control.all('SELECT * FROM pilot_appeals')).length, 3);
});

test('case correction removes one current strike, preserves the ban, and cannot be replayed or reconfirmed', async t => {
  const f = await fixture(t);
  const row = await f.case({ strike: 2, until_date: START + 7 * 86400 });
  const before = await f.base.member(GROUP, USER);
  const result = await f.mutate('case_forgive', { incidentId: row.id }, { requestId: 'correct:one' });
  assert.equal(result.strikes, 1);
  assert.equal(result.banPreserved, true);
  const after = await f.base.member(GROUP, USER);
  assert.equal(after.active_until, before.active_until);
  assert.equal(after.episode_at, before.episode_at);
  assert.equal(after.override_at, row.event_at);
  assert.equal((await f.base.incident(row.id)).status, 'cancelled');
  assert.equal((await f.mutate('case_forgive', { incidentId: row.id }, { requestId: 'correct:one' })).duplicate, true);
  await assert.rejects(f.mutate('case_forgive', { incidentId: row.id }), code('case_already_corrected'));
  await f.base.confirm(row, f.now());
  assert.equal((await f.base.member(GROUP, USER)).strikes, 1);
  assert.equal((await f.base.incident(row.id)).status, 'cancelled');
  assert.equal(f.api.callsOf('unbanChatMember').length, 0);
});

test('a corrected current case can still be explicitly unbanned without restoring its forgiven strike', async t => {
  const f = await fixture(t);
  const row = await f.case({ strike: 2 });
  await f.mutate('case_forgive', { incidentId: row.id });
  const result = await f.mutate('case_unban', { incidentId: row.id });
  assert.equal(result.unbanned, true);
  assert.equal(result.strikes, 1);
  assert.equal((await f.base.member(GROUP, USER)).strikes, 1);
  assert.equal((await f.base.member(GROUP, USER)).active_until, 0);
  assert.deepEqual(f.api.callsOf('unbanChatMember')[0].params, { chat_id: GROUP, user_id: USER, only_if_banned: true });
});

test('newer incidents and human overrides prevent stale case buttons from correcting or unbanning', async t => {
  const f = await fixture(t);
  const older = await f.case();
  f.advance(20);
  await f.case({ strike: 2 });
  await assert.rejects(f.mutate('case_unban', { incidentId: older.id }), code('case_stale'));
  await assert.rejects(f.mutate('case_forgive', { incidentId: older.id }), code('case_stale'));
  const current = await f.case({ user_id: STRANGER });
  await f.base.override(GROUP, STRANGER, f.now());
  await assert.rejects(f.mutate('case_unban', { incidentId: current.id }), code('case_stale'));
  assert.equal((await f.base.member(GROUP, USER)).strikes, 2);
  assert.equal(f.api.callsOf('unbanChatMember').length, 0);
});

test('unban checks current Telegram status, exact expiry, and local state again after the membership lookup', async t => {
  const f = await fixture(t);
  const row = await f.case();
  f.api.setMember(GROUP, USER, 'kicked', { until_date: row.until_date + 60 });
  await assert.rejects(f.mutate('case_unban', { incidentId: row.id }), code('case_stale'));
  f.api.hooks.set('getChatMember', async params => {
    if (params.user_id === ADMIN) return { status: 'administrator' };
    await f.base.override(GROUP, USER, f.now());
    return { status: 'kicked', until_date: row.until_date };
  });
  await assert.rejects(f.mutate('case_unban', { incidentId: row.id }), code('case_stale'));
  assert.equal(f.api.callsOf('unbanChatMember').length, 0);
});

test('a newer planned incident also blocks old unban and correction even before it becomes the last confirmed case', async t => {
  const f = await fixture(t);
  const row = await f.case();
  await f.base.plan({ ...row, id: 'new-planned', message_id: 55, event_at: f.now(), created_at: f.now(), strike: 2 });
  await assert.rejects(f.mutate('case_unban', { incidentId: row.id }), code('case_stale'));
  await assert.rejects(f.mutate('case_forgive', { incidentId: row.id }), code('case_stale'));
  assert.equal(f.api.callsOf('unbanChatMember').length, 0);
});

test('ambiguous unban is claimed before the external mutation and never automatically repeated', async t => {
  const f = await fixture(t);
  const row = await f.case();
  f.api.hooks.set('unbanChatMember', async () => {
    assert.equal((await f.control.first('SELECT status FROM pilot_operations WHERE request_id=?', 'unban:unknown')).status, 'sending');
    throw new TelegramError('network secret-token response', 503, true);
  });
  const options = { requestId: 'unban:unknown' };
  await assert.rejects(f.mutate('case_unban', { incidentId: row.id }, options), code('operation_unknown'));
  await assert.rejects(f.mutate('case_unban', { incidentId: row.id }, options), code('operation_unknown'));
  assert.equal(f.api.callsOf('unbanChatMember').length, 1);
  const record = await f.control.first('SELECT * FROM pilot_operations WHERE request_id=?', options.requestId);
  assert.equal(record.status, 'unknown');
  assert.ok(!JSON.stringify(record).includes('secret-token'));
  assert.ok(!(await f.control.first('SELECT details_json FROM pilot_audit WHERE id=?', `operation:${options.requestId}`)).details_json.includes('secret-token'));
});

test('a definite Telegram rejection is sanitized, recorded, and not repeated by the same request id', async t => {
  const f = await fixture(t);
  const row = await f.case();
  f.api.hooks.set('unbanChatMember', () => { throw new TelegramError('Forbidden raw private detail', 403, false); });
  await assert.rejects(f.mutate('case_unban', { incidentId: row.id }, { requestId: 'unban:rejected' }), error => error.code === 'telegram_rejected' && error.status === 502 && !error.message.includes('private'));
  await assert.rejects(f.mutate('case_unban', { incidentId: row.id }, { requestId: 'unban:rejected' }), code('telegram_rejected'));
  assert.equal(f.api.callsOf('unbanChatMember').length, 1);
  assert.equal((await f.control.first('SELECT status FROM pilot_operations WHERE request_id=?', 'unban:rejected')).status, 'failed');
});

test('an unexpected unban result is unconfirmed and cannot alter case state or be replayed', async t => {
  const f = await fixture(t);
  const row = await f.case();
  f.api.hooks.set('unbanChatMember', () => false);
  await assert.rejects(f.mutate('case_unban', { incidentId: row.id }, { requestId: 'unban:invalid-result' }), code('operation_unknown'));
  await assert.rejects(f.mutate('case_unban', { incidentId: row.id }, { requestId: 'unban:invalid-result' }), code('operation_unknown'));
  assert.equal(f.api.callsOf('unbanChatMember').length, 1);
  assert.equal((await f.base.member(GROUP, USER)).active_until, row.until_date);
  assert.equal((await f.base.incident(row.id)).status, 'confirmed');
});

test('replaying an old successful unban cannot remove a newer ban', async t => {
  const f = await fixture(t);
  const row = await f.case();
  await f.mutate('case_unban', { incidentId: row.id }, { requestId: 'unban:success' });
  f.api.setMember(GROUP, USER, 'kicked', { until_date: START + 999999 });
  assert.equal((await f.mutate('case_unban', { incidentId: row.id }, { requestId: 'unban:success' })).duplicate, true);
  await assert.rejects(f.mutate('case_unban', { incidentId: row.id }), code('case_stale'));
  assert.equal(f.api.callsOf('unbanChatMember').length, 1);
  assert.equal(f.api.members.get(`${GROUP}:${USER}`).until_date, START + 999999);
});

test('appeal keep only resolves its review, while appeal forgive uses the same safe one-strike correction', async t => {
  const f = await fixture(t);
  const first = await f.case();
  const appeal = await f.mutate('appeal_create', { incidentId: first.id, message: 'Please check.' }, { actor: actor(USER) });
  await f.mutate('appeal_resolve', { appealId: appeal.appeal.id, decision: 'keep' });
  assert.equal((await f.base.member(GROUP, USER)).strikes, 1);
  assert.equal(f.api.callsOf('unbanChatMember').length, 0);
  assert.equal((await f.control.first('SELECT status FROM pilot_appeals WHERE id=?', appeal.appeal.id)).status, 'resolved');
  await assert.rejects(f.mutate('appeal_resolve', { appealId: appeal.appeal.id, decision: 'unban' }), code('appeal_resolved'));
  f.advance(61);
  const second = await f.case({ strike: 2 });
  const appeal2 = await f.mutate('appeal_create', { incidentId: second.id, message: 'Please check this one.' }, { actor: actor(USER) });
  await f.mutate('appeal_resolve', { appealId: appeal2.appeal.id, decision: 'forgive' });
  assert.equal((await f.base.member(GROUP, USER)).strikes, 1);
  const resolved = await f.control.first('SELECT * FROM pilot_appeals WHERE id=?', appeal2.appeal.id);
  assert.equal(resolved.reviewed_by, String(ADMIN));
  assert.equal(resolved.decision, 'forgive');
});

test('overview is bounded, scoped and safe, including notification summaries, audit actors and join records', async t => {
  const f = await fixture(t);
  const row = await f.case();
  await f.base.noticeRecord(row.id, f.now());
  await f.base.noticeState(row.id, 'failed', f.now(), { errorKind: 'raw-secret-error' });
  for (let index = 0; index < 55; index++) await f.base.plan({ ...row, id: `extra-${index}`, message_id: index + 10, created_at: START - index, reasons: '["forward"]' });
  await f.case({ chat_id: OTHER });
  await f.control.audit({ id: 'anonymous-event', chatId: GROUP, actorId: null, action: 'pause', details: { token: 'secret', count: 1 }, at: START });
  await f.guards.ensure();
  await f.guards.run("INSERT INTO pilot_join_requests(id,chat_id,user_id,user_chat_id,event_at,expires_at,status,answer,updated_at) VALUES(?,?,?,?,?,?,'pending',?,?)", 'join-1', String(GROUP), String(USER), 'private-address', START, START + 300, 'secret-answer', START);
  const overview = await f.query('overview');
  assert.equal(overview.incidents.length, 50);
  assert.ok(overview.incidents.every(item => item.chat_id === String(GROUP)));
  assert.equal(overview.stats.today.incidents, 56);
  assert.equal(overview.stats.week.forwards, 55);
  assert.equal(overview.audit[0].actor_id, null);
  assert.deepEqual(overview.audit[0].details, { count: 1 });
  assert.equal(overview.joins[0].id, 'join-1');
  assert.ok(!JSON.stringify(overview).includes('secret-answer'));
  assert.ok(!JSON.stringify(overview).includes('private-address'));
  assert.ok(!JSON.stringify(overview).includes('raw-secret-error'));
});

test('retention removes appeal text and operation/audit records after 30 days while preserving necessary correction markers', async t => {
  const f = await fixture(t);
  const row = await f.case();
  await f.mutate('appeal_create', { incidentId: row.id, message: 'Private retained explanation.' }, { actor: actor(USER) });
  await f.mutate('case_forgive', { incidentId: row.id });
  f.advance(31 * 86400);
  await f.control.cleanup(f.now());
  assert.equal((await f.control.all('SELECT * FROM pilot_appeals')).length, 0);
  assert.equal((await f.control.all('SELECT * FROM pilot_operations')).length, 0);
  assert.equal((await f.control.all('SELECT * FROM pilot_audit')).length, 0);
  assert.equal((await f.control.all('SELECT * FROM pilot_case_corrections')).length, 1);
  await f.base.run('DELETE FROM incidents WHERE id=?', row.id);
  await f.control.cleanup(f.now());
  assert.equal((await f.control.all('SELECT * FROM pilot_case_corrections')).length, 0);
  assert.equal((await f.base.member(GROUP, USER)).override_at, row.event_at);
  await assert.rejects(f.mutate('case_forgive', { incidentId: row.id }), code('not_found'));
});

test('case, appeal and audit views exclude records older than 30 days even before cleanup runs', async t => {
  const f = await fixture(t);
  const old = await f.case();
  await f.mutate('appeal_create', { incidentId: old.id, message: 'An old private appeal.' }, { actor: actor(USER) });
  f.advance(30 * 86400 + 1);
  const recent = await f.case();
  await f.mutate('appeal_create', { incidentId: recent.id, message: 'A recent private appeal.' }, { actor: actor(USER) });
  const overview = await f.query('overview');
  assert.deepEqual(overview.incidents.map(row => row.id), [recent.id]);
  assert.deepEqual(overview.appeals.map(row => row.incident_id), [recent.id]);
  assert.ok(overview.audit.length > 0);
  assert.ok(overview.audit.every(row => row.created_at >= f.now() - 30 * 86400));
  const own = await f.query('mystatus', {}, null, USER);
  assert.deepEqual(own.incidents.map(row => row.id), [recent.id]);
  assert.equal((await f.control.all('SELECT id FROM pilot_appeals')).length, 2);
});

test('today statistics start at EAT midnight while week remains a rolling seven-day window', async t => {
  const f = await fixture(t);
  f.advance(10 * 3600); // 22:00 UTC is 01:00 EAT on the following date.
  const row = await f.case();
  await f.base.plan({ ...row, id: 'before-eat-midnight', created_at: START + 8 * 3600 });
  await f.base.plan({ ...row, id: 'after-eat-midnight', created_at: START + 9 * 3600 + 1800 });
  const overview = await f.query('stats');
  assert.equal(overview.stats.today.incidents, 2);
  assert.equal(overview.stats.week.incidents, 3);
});
