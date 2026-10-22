import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TestD1 } from './helpers/d1.js';
import { createOperationsService } from '../src/operations-service.js';
import { createOperationsStore } from '../src/operations-store.js';
import { createSupportStore } from '../src/support-store.js';
import { EVENT_EXTENSIONS_SCHEMA_SQL } from '../src/event-store.js';
import { eventCalendar, eventLocalTime, eventTimestamp, validEventTimezone } from '../src/event-calendar.js';
import { TelegramError } from '../src/telegram.js';

const CHAT = -1008877, OTHER_CHAT = -1009988, ADMIN = 42, FIRST = 100, SECOND = 101, LATE = 5, BOT = 999;
const START = Date.UTC(2026, 9, 22, 9) / 1000;
const code = wanted => error => error?.code === wanted;
function fixture(t) {
  const db = new TestD1(); t.after(() => db.close());
  const store = createOperationsStore(db), contacts = createSupportStore(db), roles = new Map(), calls = [], hooks = new Map();
  let current = START, sequence = 0;
  const api = { async call(method, input = {}) {
    calls.push({ method, input: structuredClone(input) });
    if (hooks.has(method)) return hooks.get(method)(input);
    if (method === 'getMe') return { id: BOT, is_bot: true };
    if (method === 'getChatMember') return roles.get(`${input.chat_id}:${input.user_id}`) || { status: [ADMIN, BOT].includes(input.user_id) ? 'administrator' : [FIRST, SECOND, LATE].includes(input.user_id) ? 'member' : 'left' };
    if (method === 'getChat') return { id: input.chat_id, type: 'supergroup', title: 'Community' };
    if (method === 'sendMessage') return { message_id: 100 + calls.filter(item => item.method === 'sendMessage').length };
    throw new Error(`Unexpected API call: ${method}`);
  } };
  const service = createOperationsService({ db, api, clock: () => current });
  const perform = (action, input = {}, user = ADMIN, extra = {}) => service.perform({ actor: { id: user }, chatId: CHAT, action, input, requestId: `event_operation_request_${++sequence}`, ...extra });
  const event = (extra = {}) => perform('event_create', { title: 'Community discussion', description: 'Questions and answers', startsAt: current + 3600, endsAt: current + 7200, language: 'en', ...extra });
  const query = (user = ADMIN, view = 'events', input = {}, chatId = CHAT) => service.query({ actor: { id: user }, chatId, view, input });
  const contact = user => contacts.rememberPrivateContact({ date: current, from: { id: user }, chat: { id: user, type: 'private' } }, current);
  const remind = (id, user = FIRST, extra = {}) => perform('event_reminders', { id, enabled: true, leadMinutes: 15, language: 'en', ...extra }, user);
  return { db, store, service, contacts, roles, calls, hooks, perform, event, query, contact, remind, now: () => current, advance: n => { current += n; }, time: n => { current = n; }, sends: () => calls.filter(item => item.method === 'sendMessage'), notifications: () => store.all('SELECT * FROM pilot_event_notifications ORDER BY created_at,id'), another: () => createOperationsService({ db, api, clock: () => current }) };
}

test('event extension schema is additive and matches migration', async t => {
  const f = fixture(t); await f.store.ensure();
  assert.equal((await readFile(new URL('../migrations/0010_event_extensions.sql', import.meta.url), 'utf8')).trim(), EVENT_EXTENSIONS_SCHEMA_SQL.trim());
  assert.equal(await f.service.nextRunAt(CHAT), null);
  assert.deepEqual(await f.service.nextDueGroups(), []);
});

test('group timezone validates IANA names, remains scoped, and requires current admin', async t => {
  const f = fixture(t);
  assert.equal((await f.query()).timezone, 'Africa/Dar_es_Salaam');
  await f.perform('event_settings', { timezone: 'America/New_York' });
  assert.equal((await f.query(FIRST)).timezone, 'America/New_York');
  assert.equal((await f.query(ADMIN, 'events', {}, OTHER_CHAT)).timezone, 'Africa/Dar_es_Salaam');
  await assert.rejects(f.perform('event_settings', { timezone: 'Mars/Olympus' }), code('invalid_timezone'));
  await assert.rejects(f.perform('event_settings', { timezone: 'Europe/London' }, FIRST), code('forbidden'));
  assert.equal(f.sends().length, 0);
});

test('wall-time conversion supports fractional offsets and rejects DST gaps and ambiguous times', () => {
  assert.equal(validEventTimezone('Asia/Kathmandu'), new Intl.DateTimeFormat('en', { timeZone: 'Asia/Kathmandu' }).resolvedOptions().timeZone);
  assert.equal(eventTimestamp('2026-10-22T12:00', 'Africa/Dar_es_Salaam'), START);
  assert.equal(eventLocalTime(START, 'Asia/Kathmandu'), '2026-10-22T14:45');
  assert.equal(eventTimestamp('2026-10-22T14:45', 'Asia/Kathmandu'), START);
  assert.throws(() => eventTimestamp('2026-03-08T02:30', 'America/New_York'), /invalid_time/);
  assert.throws(() => eventTimestamp('2026-11-01T01:30', 'America/New_York'), /ambiguous_local_time/);
  assert.throws(() => eventTimestamp('2026-02-30T12:00', 'UTC'), /invalid_time/);
});

test('capacity keeps first confirmations and FIFO waiting even within the same second', async t => {
  const f = fixture(t), event = await f.event({ capacity: 1 });
  assert.equal((await f.perform('event_rsvp', { id: event.id, response: 'going' }, FIRST)).response, 'going');
  assert.equal((await f.perform('event_rsvp', { id: event.id, response: 'going' }, SECOND)).response, 'waitlisted');
  assert.equal((await f.perform('event_rsvp', { id: event.id, response: 'going' }, LATE)).response, 'waitlisted');
  assert.equal((await f.query(FIRST)).events[0].response, 'going');
  const waiting = (await f.query(SECOND)).events[0];
  assert.equal(waiting.response, 'waitlisted'); assert.equal(waiting.waiting, 2); assert.equal(waiting.capacity, 1);
  assert.deepEqual(waiting.counts, { going: 1, maybe: 0, declined: 0 });
  await f.perform('event_rsvp', { id: event.id, response: 'declined' }, FIRST);
  assert.equal((await f.query(SECOND)).events[0].response, 'going');
  assert.equal((await f.query(LATE)).events[0].response, 'waitlisted');
  assert.equal(f.sends().length, 0);
});

test('rejoining a waitlist goes to its end and a capacity increase promotes deterministically', async t => {
  const f = fixture(t), event = await f.event({ capacity: 1 });
  for (const user of [FIRST, SECOND, LATE]) await f.perform('event_rsvp', { id: event.id, response: 'going' }, user);
  await f.perform('event_rsvp', { id: event.id, response: 'maybe' }, SECOND);
  await f.perform('event_rsvp', { id: event.id, response: 'going' }, SECOND);
  await f.perform('event_update', { id: event.id, title: 'Larger event', startsAt: f.now() + 3600, endsAt: f.now() + 7200, capacity: 2 });
  assert.equal((await f.query(LATE)).events[0].response, 'going');
  assert.equal((await f.query(SECOND)).events[0].response, 'waitlisted');
  await assert.rejects(f.event({ capacity: 0 }), code('invalid_capacity'));
  await assert.rejects(f.event({ capacity: 2001 }), code('invalid_capacity'));
});

test('capacity update handles old RSVP records without losing attendance', async t => {
  const f = fixture(t), event = await f.event();
  await f.store.run('DELETE FROM pilot_event_options WHERE event_id=?', event.id);
  await f.store.run("INSERT INTO pilot_event_rsvps VALUES(?,?, 'going',?)", event.id, String(FIRST), f.now() - 1);
  await f.store.run("INSERT INTO pilot_event_rsvps VALUES(?,?, 'going',?)", event.id, String(SECOND), f.now());
  await f.perform('event_update', { id: event.id, title: 'Capacity set', startsAt: f.now() + 3600, capacity: 1 });
  assert.equal((await f.query(FIRST)).events[0].response, 'going');
  assert.equal((await f.query(SECOND)).events[0].response, 'waitlisted');
});

test('reminder opt-in requires authentic private contact, never group-based evidence', async t => {
  const f = fixture(t), event = await f.event();
  assert.equal(await f.contacts.rememberPrivateContact({ date: f.now(), from: { id: FIRST }, chat: { id: CHAT, type: 'supergroup' } }, f.now()), false);
  await assert.rejects(f.remind(event.id), code('private_chat_required'));
  assert.equal((await f.notifications()).length, 0);
  await f.contact(FIRST); await f.remind(event.id);
  assert.equal((await f.query(FIRST)).events[0].reminders.enabled, true);
  assert.equal(await f.service.nextRunAt(CHAT), f.now() + 2700);
  assert.equal(f.sends().length, 0);
});

test('private reminder sends only at its due time and only once across restarts', async t => {
  const f = fixture(t), event = await f.event(); await f.contact(FIRST); await f.remind(event.id);
  f.advance(2699); await f.service.drain(CHAT); assert.equal(f.sends().length, 0);
  f.advance(1); assert.deepEqual(await f.service.nextDueGroups(), [String(CHAT)]);
  await f.service.drain(CHAT); assert.equal(f.sends().length, 1);
  assert.equal(f.sends()[0].input.chat_id, FIRST); assert.match(f.sends()[0].input.text, /Event reminder/);
  f.advance(5); await f.another().drain(CHAT); assert.equal(f.sends().length, 1);
  assert.equal(await f.service.nextRunAt(CHAT), null);
});

test('waitlist promotions notify opted-in members and preserve the other memberships', async t => {
  const f = fixture(t), event = await f.event({ capacity: 1 });
  await f.perform('event_rsvp', { id: event.id, response: 'going' }, FIRST);
  await f.perform('event_rsvp', { id: event.id, response: 'going' }, SECOND);
  await f.contact(SECOND); await f.remind(event.id, SECOND);
  await f.perform('event_rsvp', { id: event.id, response: 'declined' }, FIRST);
  await f.service.drain(CHAT);
  assert.equal(f.sends().length, 1); assert.equal(f.sends()[0].input.chat_id, SECOND);
  assert.match(f.sends()[0].input.text, /place is confirmed/);
  assert.equal((await f.query(FIRST)).events[0].reminders.enabled, false);
});

test('event edits notify subscribers, replace old reminders, and keep delivery data aggregate-only', async t => {
  const f = fixture(t), event = await f.event(); await f.contact(FIRST); await f.remind(event.id);
  await f.perform('event_update', { id: event.id, title: 'New title', startsAt: f.now() + 7200, endsAt: f.now() + 10800 });
  await f.service.drain(CHAT);
  assert.equal(f.sends().length, 1); assert.match(f.sends()[0].input.text, /Event updated/); assert.match(f.sends()[0].input.text, /New title/);
  const rows = await f.notifications();
  assert.equal(rows.find(row => row.kind === 'reminder' && row.revision === 1).status, 'skipped');
  assert.equal(rows.find(row => row.kind === 'reminder' && row.revision === 2).due_at, f.now() + 6300);
  const admin = await f.query(ADMIN, 'operations');
  assert.equal(admin.eventDeliveries.some(row => 'user_id' in row), false);
  assert.equal('eventDeliveries' in await f.query(FIRST), false);
});

test('cancellation skips scheduled reminders and sends one private cancellation notice', async t => {
  const f = fixture(t), event = await f.event(); await f.contact(FIRST); await f.remind(event.id);
  await f.perform('event_cancel', { id: event.id }); await f.service.drain(CHAT);
  assert.equal(f.sends().length, 1); assert.match(f.sends()[0].input.text, /Event cancelled/);
  f.advance(3000); await f.service.drain(CHAT); assert.equal(f.sends().length, 1);
  await f.remind(event.id, FIRST, { enabled: false });
  assert.equal((await f.query(FIRST)).events[0].reminders.enabled, false);
});

test('disabling reminders cancels pending notices and declining RSVP opts out', async t => {
  const f = fixture(t), event = await f.event(); await f.contact(FIRST); await f.remind(event.id);
  await f.remind(event.id, FIRST, { enabled: false });
  f.advance(2800); await f.service.drain(CHAT); assert.equal(f.sends().length, 0);
  await f.remind(event.id); await f.perform('event_rsvp', { id: event.id, response: 'declined' }, FIRST);
  await f.service.drain(CHAT); assert.equal(f.sends().length, 0);
  await assert.rejects(f.remind(event.id), code('rsvp_declined'));
});

test('delivery rechecks creator authority, recipient membership and bot membership', async t => {
  for (const target of [ADMIN, FIRST, BOT]) {
    const f = fixture(t), event = await f.event(); await f.contact(FIRST); await f.remind(event.id);
    f.roles.set(`${CHAT}:${target}`, { status: 'left' }); f.advance(2700); await f.service.drain(CHAT);
    assert.equal(f.sends().length, 0); assert.equal((await f.notifications())[0].status, 'skipped');
  }
});

test('unknown private sends are not retried and stale sending claims become unknown', async t => {
  const f = fixture(t), event = await f.event(); await f.contact(FIRST); await f.remind(event.id);
  f.hooks.set('sendMessage', () => { throw new TelegramError('timeout', 0, true); });
  f.advance(2700); await f.service.drain(CHAT); f.advance(100); await f.another().drain(CHAT);
  assert.equal(f.sends().length, 1); assert.equal((await f.notifications())[0].status, 'unknown');
  const second = await f.event(); await f.remind(second.id); f.advance(2700);
  await f.store.run("UPDATE pilot_event_notifications SET status='sending',claimed_at=? WHERE event_id=?", f.now() - 121, second.id);
  await f.service.drain(CHAT); assert.equal(f.sends().length, 1);
  assert.equal((await f.notifications()).find(row => row.event_id === second.id).status, 'unknown');
});

test('rate limits use retry_after with a bounded number of attempts', async t => {
  const f = fixture(t), event = await f.event(); await f.contact(FIRST); await f.remind(event.id);
  f.hooks.set('sendMessage', () => { throw new TelegramError('rate limit', 429, false, 17); });
  f.advance(2700);
  for (let index = 0; index < 3; index++) { await f.service.drain(CHAT); assert.equal((await f.notifications())[0].due_at, f.now() + 17); f.advance(17); }
  assert.equal((await f.notifications())[0].status, 'failed');
  await f.service.drain(CHAT); assert.equal(f.sends().length, 3);
});

test('concurrent drains claim a private notice once', async t => {
  const f = fixture(t), event = await f.event(); await f.contact(FIRST); await f.remind(event.id);
  f.advance(2700); await Promise.all([f.service.drain(CHAT), f.another().drain(CHAT)]);
  assert.equal(f.sends().length, 1);
});

test('lost database confirmation after a successful private send remains uncertain', async t => {
  const f = fixture(t), event = await f.event(); await f.contact(FIRST); await f.remind(event.id);
  const prepare = f.db.prepare.bind(f.db); let failed = false;
  f.db.prepare = sql => {
    const statement = prepare(sql);
    if (!sql.includes("SET status='sent',message_id=")) return statement;
    const bind = statement.bind.bind(statement);
    statement.bind = (...values) => { const bound = bind(...values); const run = bound.run.bind(bound); bound.run = async () => { if (!failed) { failed = true; throw new Error('write failed'); } return run(); }; return bound; };
    return statement;
  };
  f.advance(2700); await f.service.drain(CHAT);
  assert.equal((await f.notifications())[0].status, 'unknown');
  f.advance(100); await f.another().drain(CHAT); assert.equal(f.sends().length, 1);
});

test('blocked private recipients are disabled and an old replay cannot restore consent', async t => {
  const f = fixture(t), event = await f.event(); await f.contact(FIRST); await f.remind(event.id);
  f.hooks.set('sendMessage', () => { throw new TelegramError('blocked', 403, false); });
  f.advance(2700); await f.service.drain(CHAT); assert.equal(await f.contacts.privateContact(FIRST), null);
  await f.contacts.rememberPrivateContact({ date: START, from: { id: FIRST }, chat: { id: FIRST, type: 'private' } }, f.now());
  assert.equal(await f.contacts.privateContact(FIRST), null);
  f.advance(1); await f.contact(FIRST); assert.ok(await f.contacts.privateContact(FIRST));
});

test('missed reminders expire instead of sending a late backlog', async t => {
  const f = fixture(t), event = await f.event(); await f.contact(FIRST); await f.remind(event.id);
  f.advance(3600); await f.service.drain(CHAT);
  assert.equal(f.sends().length, 0); assert.equal((await f.notifications())[0].status, 'skipped');
});

test('calendar download checks current membership and group scope and escapes content', async t => {
  const f = fixture(t), event = await f.event({ title: 'Title, one; two\nEND:VEVENT', description: 'Hello\\world\nNext line', url: 'https://sautilink.com/event' });
  const calendar = await f.query(FIRST, 'event_calendar', { id: event.id });
  assert.match(calendar.filename, /^pilot-event-[a-f0-9]{24}\.ics$/);
  assert.match(calendar.content, /SUMMARY:Title\\, one\\; two\\nEND:VEVENT/);
  assert.equal(calendar.content.match(/^END:VEVENT$/gm)?.length, 1);
  assert.doesNotMatch(calendar.content, /user_id|chat_id|-1008877/);
  assert.match(calendar.content, /DTSTART:20261022T100000Z/);
  await assert.rejects(f.query(FIRST, 'event_calendar', { id: event.id }, OTHER_CHAT), code('not_found'));
  f.roles.set(`${CHAT}:${FIRST}`, { status: 'left' });
  await assert.rejects(f.query(FIRST, 'event_calendar', { id: event.id }), code('forbidden'));
});

test('calendar lines fold at UTF-8 byte boundaries and cancellation is explicit', () => {
  const calendar = eventCalendar({ id: 'a'.repeat(24), title: '🗓️'.repeat(50), description: 'A'.repeat(500), starts_at: START, ends_at: START + 3600, updated_at: START, revision: 3, status: 'cancelled' }, 'UTC');
  for (const line of calendar.content.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75);
  assert.match(calendar.content, /STATUS:CANCELLED/); assert.match(calendar.content, /SEQUENCE:3/);
  assert.doesNotMatch(calendar.content, /\uFFFD/);
});

test('event retention cascades through subscriptions, seats and notification records', async t => {
  const f = fixture(t), event = await f.event({ capacity: 1 }); await f.contact(FIRST);
  await f.perform('event_rsvp', { id: event.id, response: 'going' }, FIRST); await f.remind(event.id);
  f.advance(32 * 86400); await f.service.cleanup();
  for (const table of ['pilot_events','pilot_event_options','pilot_event_attendance','pilot_event_rsvps','pilot_event_subscriptions','pilot_event_notifications']) assert.equal((await f.store.all(`SELECT * FROM ${table}`)).length, 0);
});
