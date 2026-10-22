import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { TestD1 } from './helpers/d1.js';
import { applySchema } from '../src/store.js';
import { createControlStore } from '../src/control-store.js';
import { createToolsStore } from '../src/tools-store.js';
import { createOperationsStore } from '../src/operations-store.js';
import { createSupportStore } from '../src/support-store.js';
import { createToolServices } from '../src/tools-api.js';
import { createPerformanceService } from '../src/performance-service.js';
import { instrumentDatabase, instrumentTelegram } from '../src/request-timing.js';

// Reuse the fail-closed render loader. Bypass only the platform constructor;
// the queue, fetch, alarm and scheduling methods under review are the real code.
register('../scripts/cloudflare-smoke-loader.mjs', import.meta.url);
const { GroupCoordinator } = await import('../src/index.js');
const CHAT = -1007766, ADMIN = 100, FIRST = 101, SECOND = 102, BOT = 900;
const START = Date.UTC(2026, 9, 22, 9) / 1000;
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};

class CountedD1 extends TestD1 {
  calls = [];
  statements = 0;
  prepare(sql) {
    const wrap = statement => {
      const bind = statement.bind.bind(statement);
      statement.bind = (...values) => wrap(bind(...values));
      for (const method of ['first', 'all', 'run', 'raw']) {
        const execute = statement[method].bind(statement);
        statement[method] = (...args) => {
          this.calls.push({ method, sql }); this.statements++;
          return execute(...args);
        };
      }
      return statement;
    };
    return wrap(super.prepare(sql));
  }
  batch(statements) {
    this.calls.push({ method: 'batch', sql: statements.map(statement => statement.sql).join('\n') });
    this.statements += statements.length;
    return super.batch(statements);
  }
  reset() { this.calls.length = 0; this.statements = 0; }
}

async function fixture(t) {
  const db = new CountedD1();
  let now = START, sequence = 0, permissions = { can_send_messages: true, can_send_polls: true };
  let coordinator;
  const calls = [], trace = [], hooks = new Map(), background = [], alarms = [];
  t.mock.method(Date, 'now', () => now * 1000);
  t.mock.method(Math, 'random', () => 0.5);
  t.mock.method(console, 'info', () => {});
  await applySchema(db);
  await createControlStore(db).ensure();
  await createToolsStore(db).ensure();
  await createOperationsStore(db).ensure();
  const contacts = createSupportStore(db); await contacts.ensure();
  const api = instrumentTelegram({ async call(method, input = {}) {
    calls.push({ method, input: structuredClone(input) }); trace.push(method);
    if (hooks.has(method)) {
      const result = await hooks.get(method)(input);
      if (result !== undefined) return result;
    }
    if (method === 'getMe') return { id: BOT, is_bot: true, username: 'sautilinkpilotbot' };
    if (method === 'getChatMember') return {
      status: [ADMIN, BOT].includes(input.user_id) ? 'administrator' : 'member',
      can_restrict_members: true, can_delete_messages: true,
    };
    if (method === 'getChat') return { id: Number(input.chat_id), type: 'supergroup', title: 'Runtime fixture', permissions };
    if (method === 'setChatPermissions') { permissions = structuredClone(input.permissions); return true; }
    if (method === 'sendMessage') return { message_id: calls.filter(call => call.method === 'sendMessage').length };
    throw new Error(`Unexpected Telegram method: ${method}`);
  } }, () => coordinator?.currentTiming);
  const tools = createToolServices({ db: instrumentDatabase(db, () => coordinator?.currentTiming), api, clock: () => now });
  let alarmAt = null;
  const values = new Map([['pilot_tools_chat', String(CHAT)]]);
  const ctx = {
    waitUntil(promise) { background.push(promise); },
    storage: {
      async get(key) { return values.get(key); },
      async put(key, value) { values.set(key, value); },
      async getAlarm() { return alarmAt; },
      async setAlarm(value) { alarmAt = value; alarms.push(value); },
      async deleteAlarm() { alarmAt = null; },
    },
  };
  coordinator = Object.assign(Object.create(GroupCoordinator.prototype), {
    ctx, env: { DB: db }, tools, toolsChat: String(CHAT),
    tail: Promise.resolve(), pendingWork: 0, currentTiming: null,
    performance: { async record() {} },
    moderator: { async handle() { trace.push('handled'); return { status: 'ignored' }; } },
  });
  const settle = async () => { for (let index = 0; index < background.length; index++) await background[index]; };
  t.after(async () => { await settle(); db.close(); });
  const perform = (action, input, user = ADMIN) => tools.perform({
    actor: { id: user }, chatId: CHAT, action, input, requestId: `care_runtime_request_${++sequence}`,
  });
  const contact = user => contacts.rememberPrivateContact({ from: { id: user }, chat: { id: user, type: 'private' }, date: now }, now);
  const reminders = async (users = [FIRST], startsAt = START + 1000) => {
    const event = await perform('event_create', { title: 'Runtime event', startsAt, endsAt: startsAt + 3600, language: 'en' });
    for (const user of users) {
      await contact(user);
      await perform('event_reminders', { id: event.id, enabled: true, leadMinutes: 15, language: 'en' }, user);
    }
    return event;
  };
  const support = async () => {
    await contact(FIRST);
    await perform('support_settings', { enabled: true });
    const ticket = await perform('ticket_create', { subject: 'Need assistance', body: 'Please help with an event.', language: 'en' }, FIRST);
    await perform('ticket_reply', { id: ticket.id, body: 'Here is the private reply.' });
    return ticket;
  };
  const schedule = runAt => perform('schedule_create', { text: 'Scheduled group notice', runAt, repeat: 'once', language: 'en', confirmed: true });
  const alarm = async () => { alarmAt = null; return coordinator.alarm(); };
  return { db, tools, api, contacts, coordinator, calls, trace, hooks, alarms, background, settle, perform, contact, reminders, support, schedule, alarm,
    now: () => now, time: value => { now = value; }, advance: value => { now += value; },
    sends: () => calls.filter(call => call.method === 'sendMessage'),
    async notices() { return (await db.prepare('SELECT * FROM pilot_event_notifications ORDER BY due_at,id').all()).results; },
  };
}

test('due permission restoration runs while queued interactive work suppresses optional sends', async t => {
  const f = await fixture(t);
  await f.perform('raid_lockdown', { minutes: 1, confirmed: true });
  await f.schedule(START + 60); await f.support();
  f.time(START + 61); f.calls.length = 0; f.trace.length = 0;
  const entered = deferred(), resume = deferred();
  f.hooks.set('getChatMember', async input => {
    if (input.user_id === ADMIN) { entered.resolve(); await resume.promise; }
  });
  const alarm = f.alarm(); await entered.promise;
  const interactive = f.coordinator.queued('telegram', async () => { f.trace.push('interactive'); return {}; });
  resume.resolve(); await Promise.all([alarm, interactive]);
  assert.equal((await f.db.prepare('SELECT status FROM pilot_raid_lockdowns').first()).status, 'restored');
  assert.equal(f.sends().length, 0);
  assert.ok(f.trace.indexOf('setChatPermissions') < f.trace.indexOf('interactive'));
  assert.ok(f.alarms.at(-1) > f.now() * 1000);
});

test('optional-work backoff does not push a future permission restoration past its deadline', async t => {
  const f = await fixture(t);
  await f.perform('raid_lockdown', { minutes: 1, confirmed: true });
  await f.schedule(START + 60); f.time(START + 55);
  await f.coordinator.scheduleTools(CHAT, 30000);
  assert.equal(f.alarms.at(-1), (START + 60) * 1000);
  // A restore that was already due and failed still needs a bounded retry delay.
  await f.coordinator.ctx.storage.deleteAlarm(); f.time(START + 61);
  await f.coordinator.scheduleTools(CHAT, 30000);
  assert.equal(f.alarms.at(-1), (START + 91) * 1000);
});

test('a slow scheduled send cannot start another optional job ahead of a queued command', async t => {
  const f = await fixture(t);
  await f.schedule(START + 60); await f.reminders([FIRST, SECOND]); await f.support();
  f.time(START + 101); f.calls.length = 0;
  const entered = deferred(), resume = deferred();
  f.hooks.set('sendMessage', async input => {
    if (input.chat_id === CHAT) { entered.resolve(); await resume.promise; }
  });
  const alarm = f.alarm(); await entered.promise;
  f.advance(4);
  const interactive = f.coordinator.queued('telegram', async () => ({ status: 'handled' }));
  resume.resolve(); await Promise.all([alarm, interactive]);
  assert.deepEqual(f.sends().map(call => call.input.chat_id), [CHAT]);
  assert.equal((await f.notices()).filter(row => row.status === 'pending').length, 2);
  assert.equal((await f.db.prepare('SELECT status FROM pilot_support_deliveries').first()).status, 'pending');
});

test('the operations limit covers schedules and reminders together even after the send throttle expires', async t => {
  const f = await fixture(t);
  await f.schedule(START + 60); await f.reminders(); f.time(START + 101); f.calls.length = 0;
  f.hooks.set('sendMessage', () => { f.advance(4); });
  const result = await f.tools.operations.drain(CHAT, { limit: 1 });
  assert.equal(result.results.length, 1); assert.equal(f.sends().length, 1);
  assert.equal(f.sends()[0].input.chat_id, CHAT);
  assert.equal((await f.notices())[0].status, 'pending');
});

test('an earlier due reminder is not starved by later schedules and only one notice runs per alarm', async t => {
  const f = await fixture(t);
  await f.schedule(START + 120); await f.schedule(START + 125); await f.reminders([FIRST, SECOND]);
  f.time(START + 130); f.calls.length = 0;
  await f.alarm();
  assert.equal(f.sends().length, 1); assert.notEqual(f.sends()[0].input.chat_id, CHAT);
  assert.equal((await f.notices()).filter(row => row.status === 'sent').length, 1);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM pilot_schedules WHERE status='pending'").first()).n, 2);
  f.advance(3); await f.alarm();
  assert.equal(f.sends().length, 2); assert.ok(f.sends().every(call => call.input.chat_id !== CHAT));
  f.advance(3); await f.alarm();
  assert.equal(f.sends()[2].input.chat_id, CHAT);
});

test('late interactive work releases an event preflight claim without spending an attempt', async t => {
  const f = await fixture(t); await f.reminders(); f.time(START + 101); f.calls.length = 0;
  const entered = deferred(), resume = deferred();
  f.hooks.set('getChat', async () => { entered.resolve(); await resume.promise; });
  const alarm = f.alarm(); await entered.promise;
  const interactive = f.coordinator.queued('telegram', async () => ({}));
  resume.resolve(); await Promise.all([alarm, interactive]);
  assert.equal(f.sends().length, 0);
  const row = (await f.notices())[0];
  assert.equal(row.status, 'pending'); assert.equal(row.attempts, 0); assert.equal(row.lease_token, null);
  f.hooks.delete('getChat'); f.advance(3); await f.alarm(); assert.equal(f.sends().length, 1);
});

test('late interactive work also leaves a support reply pending without claiming a send', async t => {
  const f = await fixture(t); await f.support(); f.calls.length = 0;
  const entered = deferred(), resume = deferred();
  f.hooks.set('getChatMember', async input => {
    if (input.user_id === FIRST) { entered.resolve(); await resume.promise; }
  });
  const alarm = f.alarm(); await entered.promise;
  const interactive = f.coordinator.queued('telegram', async () => ({}));
  resume.resolve(); await Promise.all([alarm, interactive]);
  assert.equal(f.sends().length, 0);
  const row = await f.db.prepare('SELECT status,attempts FROM pilot_support_deliveries').first();
  assert.deepEqual(row, { status: 'pending', attempts: 0 });
});

test('ordinary group updates cause no contact-store work and genuine private evidence persists after the reply path', async t => {
  const f = await fixture(t); f.db.reset();
  const message = { message_id: 1, date: f.now(), from: { id: FIRST }, chat: { id: CHAT, type: 'supergroup' }, text: 'An ordinary group message' };
  const send = update => f.coordinator.fetch(new Request('https://group.internal/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(update) }));
  assert.equal((await send({ update_id: 1, message })).status, 200); await f.settle();
  assert.equal(f.db.calls.length, 0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM pilot_private_contacts').first()).n, 0);
  assert.equal((await send({ update_id: 2, message: { ...message, chat: { id: FIRST, type: 'private' }, text: '/start' } })).status, 200);
  await f.settle();
  assert.equal((await f.contacts.privateContact(FIRST)).user_id, String(FIRST));
  assert.equal(f.trace.filter(value => value === 'handled').length, 2);
});

test('background timing persistence does not hold the chat queue or expose message contents', async t => {
  const f = await fixture(t), hold = deferred(), records = [];
  t.mock.method(Math, 'random', () => 0);
  f.coordinator.performance = { async record(row, selection) { records.push({ row, selection }); await hold.promise; } };
  await f.coordinator.queued('telegram', async () => ({ status: 'handled', privateText: 'never retained' }));
  assert.equal(f.coordinator.pendingWork, 0); assert.equal(f.coordinator.currentTiming, null);
  assert.deepEqual(await f.coordinator.queued('control', async () => ({ ok: true })), { ok: true });
  assert.equal(records.length, 2);
  assert.ok(records.every(record => record.selection.sampled === true));
  assert.doesNotMatch(JSON.stringify(records), /never retained|privateText|user_id|chat_id/);
  hold.resolve(); await f.settle();
});

test('a warmed alarm with restoration, an event and a support reply remains bounded including sampled measurements', async t => {
  const f = await fixture(t);
  await f.perform('raid_lockdown', { minutes: 1, confirmed: true });
  await f.reminders(); await f.support(); f.time(START + 101); f.calls.length = 0;
  const performance = createPerformanceService({ db: f.db, api: f.api, clock: f.now });
  await performance.ensure(); f.coordinator.performance = performance;
  t.mock.method(Math, 'random', () => 0);
  f.db.reset(); await f.alarm(); await f.settle();
  const rpc = f.db.calls.length, statements = f.db.statements, telegram = f.calls.length;
  t.diagnostic(`Alarm work: ${rpc} D1 calls, ${statements} SQL statements, ${telegram} Telegram calls.`);
  assert.ok(rpc < 50); assert.ok(statements <= 50); assert.ok(telegram < 20);
  assert.equal(f.sends().length, 2);
  assert.equal((await f.notices()).filter(row => row.status === 'sent').length, 1);
});

test('the maximum ten-highlight digest also fits the bounded alarm budget with restoration and support', async t => {
  const f = await fixture(t);
  await f.perform('raid_lockdown', { minutes: 1, confirmed: true });
  for (let index = 0; index < 10; index++) await f.perform('highlight_add', { text: `Approved highlight ${index + 1}` });
  await f.perform('highlight_schedule', { runAt: START + 60, repeat: 'weekly', language: 'en', confirmed: true });
  await f.support(); f.time(START + 61); f.calls.length = 0;
  const performance = createPerformanceService({ db: f.db, api: f.api, clock: f.now });
  await performance.ensure(); f.coordinator.performance = performance;
  t.mock.method(Math, 'random', () => 0);
  f.db.reset(); await f.alarm(); await f.settle();
  const rpc = f.db.calls.length, statements = f.db.statements, telegram = f.calls.length;
  t.diagnostic(`Digest alarm work: ${rpc} D1 calls, ${statements} SQL statements, ${telegram} Telegram calls.`);
  assert.ok(rpc < 50); assert.ok(statements <= 50); assert.ok(telegram < 20);
  assert.equal(f.sends().length, 2);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM pilot_highlights WHERE sent_at IS NOT NULL').first()).n, 10);
});
