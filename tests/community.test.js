import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TestD1 } from './helpers/d1.js';
import { applySchema } from '../src/store.js';
import { createCommunityStore, COMMUNITY_SCHEMA_SQL } from '../src/community-store.js';
import { createCommunityService, CommunityError } from '../src/community-service.js';
import { renderCommunityHub } from '../src/community-pages.js';
import { TelegramError } from '../src/telegram.js';

const CHAT = -1001122, OTHER = -1003344, ADMIN = 21, ADMIN2 = 22, REPORTER = 31, TARGET = 32, OWNER = 99, BOT = 900;
const NOW = Date.UTC(2026, 9, 22, 12) / 1000;
const actor = id => ({ id, first_name: `Person ${id}` });
const code = expected => error => error instanceof CommunityError && error.code === expected;

async function fixture(t) {
  const db = new TestD1(); t.after(() => db.close()); await applySchema(db);
  const roles = new Map(), calls = [];
  const setRole = (user, status, chat = CHAT, extra = {}) => roles.set(`${chat}:${user}`, { user: { id: user }, status, ...extra });
  setRole(ADMIN, 'administrator'); setRole(ADMIN2, 'administrator'); setRole(REPORTER, 'member'); setRole(TARGET, 'member');
  setRole(BOT, 'administrator', CHAT, { can_delete_messages: true });
  let now = NOW, seq = 0, deleteError, deleteResult = true;
  const api = { async call(method, input) {
    calls.push({ method, input: structuredClone(input) });
    if (method === 'getChatMember') return roles.get(`${input.chat_id}:${input.user_id}`) || { status: 'left' };
    if (method === 'getMe') return { id: BOT, is_bot: true };
    if (method === 'deleteMessage') { if (deleteError) throw deleteError; return deleteResult; }
    throw new Error(`Unexpected ${method}`);
  } };
  const store = createCommunityStore(db); await store.ensure();
  const service = createCommunityService({ db, api, clock: () => now, owner: { isOwner: async user => user.id === OWNER } });
  return {
    db, store, service, calls, setRole,
    advance(seconds) { now += seconds; }, failDelete(error) { deleteError = error; }, deleteReturns(value) { deleteResult = value; },
    query(view, input = {}, user = ADMIN, chatId = CHAT) { return service.query({ actor: actor(user), chatId, view, input }); },
    write(action, input, options = {}) { return service.perform({ actor: actor(ADMIN), chatId: CHAT, action, input, requestId: `request:${++seq}`, ...options }); },
    report(options = {}) {
      return service.createReportFromMessage({ actor: actor(REPORTER), chatId: CHAT,
        message: { message_id: 11, date: now - 30, chat: { id: CHAT }, from: actor(TARGET), text: 'Please review this message.' },
        reason: 'Suspicious offer', updateId: ++seq, ...options });
    },
    message(messageId, user = TARGET) { return { message_id: messageId, date: now - 10, chat: { id: CHAT }, from: actor(user), text: 'Flagged text' }; },
    hub(overrides = {}) { return { visibility: 'public', slug: 'study-club', title: 'Study Club', description: 'Learning together.', rules: 'Be respectful.', joinUrl: 'https://t.me/studyclub', resources: [{ label: 'Learning resources', url: 'https://sautilink.com/learn' }], language: 'en', showFaq: false, ...overrides }; },
  };
}

test('community schema is repeatable and matches the migration', async t => {
  const f = await fixture(t); await createCommunityStore(f.db).ensure();
  assert.equal((await readFile(new URL('../migrations/0008_community.sql', import.meta.url), 'utf8')).trim(), COMMUNITY_SCHEMA_SQL.trim());
  assert.equal((await f.query('community')).hub.visibility, 'private');
});

test('report creation verifies real membership, stores bounded evidence and never punishes', async t => {
  const f = await fixture(t);
  const result = await f.report({ message: { ...f.message(11), text: 'x'.repeat(900) } });
  const rows = (await f.query('reports')).reports;
  assert.equal(rows.length, 1); assert.equal(rows[0].id, result.id); assert.equal(rows[0].excerpt.length, 500);
  assert.equal(rows[0].reporter_id, String(REPORTER));
  assert.deepEqual([...new Set(f.calls.map(call => call.method))], ['getChatMember']);
  await assert.rejects(f.query('reports', {}, REPORTER), code('forbidden'));
  await assert.rejects(f.query('community', {}, REPORTER), code('forbidden'));
  f.setRole(REPORTER, 'left'); await assert.rejects(f.report(), code('forbidden'));
});

test('reports deduplicate retries and same reporter-target, cap repeated target flags', async t => {
  const f = await fixture(t);
  const first = await f.report({ updateId: 77 });
  const retry = await f.report({ updateId: 77 }); assert.equal(retry.duplicate, true); assert.equal(retry.id, first.id);
  const next = await f.report({ updateId: 78 }); assert.equal(next.duplicate, true); assert.equal(next.id, first.id);
  for (let n = 1; n <= 4; n++) { f.setRole(REPORTER + 10 * n, 'member'); await f.report({ actor: actor(REPORTER + 10 * n) }); }
  f.setRole(1001, 'member'); await assert.rejects(f.report({ actor: actor(1001) }), code('report_limit'));
  assert.equal((await f.query('reports')).reports.length, 5);
});

test('reports reject anonymous admins, linked channels, bots, regular admins and fabricated browser evidence', async t => {
  const f = await fixture(t);
  for (const message of [
    { ...f.message(11), sender_chat: { id: CHAT } },
    { ...f.message(11), sender_chat: { id: -1009988 }, is_automatic_forward: true },
    { ...f.message(11), from: { ...actor(TARGET), is_bot: true } },
    f.message(11, ADMIN),
  ]) await assert.rejects(f.report({ message }), code('protected_target'));
  await assert.rejects(f.report({ message: { ...f.message(11), chat: { id: OTHER } } }), code('invalid_report'));
  await assert.rejects(f.report({ message: f.message(0) }), code('invalid_report'));
  await assert.rejects(f.write('flag_create', { messageId: 11, reason: 'Fake' }, { actor: actor(REPORTER) }), code('invalid_action'));
  assert.equal((await f.query('reports')).reports.length, 0);
});

test('a reporter has three flags per hour in one group, verified restricted members may flag', async t => {
  const f = await fixture(t); f.setRole(REPORTER, 'restricted', CHAT, { is_member: true });
  for (const n of [1, 2, 3]) await f.report({ message: f.message(n) });
  await assert.rejects(f.report({ message: f.message(4) }), code('report_rate_limited'));
  f.advance(3601); await f.report({ message: f.message(4) });
  f.setRole(REPORTER, 'restricted', CHAT, { is_member: false });
  await assert.rejects(f.report({ message: f.message(5) }), code('forbidden'));
});

test('shared inbox claim prevents conflicting decisions and cannot cross group boundaries', async t => {
  const f = await fixture(t), report = await f.report();
  await f.write('flag_claim', { id: report.id });
  await assert.rejects(f.write('flag_claim', { id: report.id }, { actor: actor(ADMIN2) }), code('report_claimed'));
  await assert.rejects(f.write('flag_resolve', { id: report.id, decision: 'delete' }, { actor: actor(ADMIN2) }), code('report_claimed'));
  f.setRole(ADMIN, 'administrator', OTHER);
  await assert.rejects(f.write('flag_resolve', { id: report.id, decision: 'dismiss' }, { chatId: OTHER }), code('not_found'));
  await f.write('flag_resolve', { id: report.id, decision: 'dismiss' });
  assert.equal((await f.query('reports')).reports[0].status, 'resolved');
  assert.equal(f.calls.filter(call => call.method === 'deleteMessage').length, 0);
});

test('delete rechecks current target admin immunity and bot rights, with no ban or strike', async t => {
  const f = await fixture(t), report = await f.report();
  f.setRole(TARGET, 'administrator');
  await assert.rejects(f.write('flag_resolve', { id: report.id, decision: 'delete' }), code('protected_target'));
  f.setRole(TARGET, 'member'); f.setRole(BOT, 'administrator', CHAT, { can_delete_messages: false });
  await assert.rejects(f.write('flag_resolve', { id: report.id, decision: 'delete' }), code('bot_permission'));
  f.setRole(BOT, 'administrator', CHAT, { can_delete_messages: true });
  await f.write('flag_resolve', { id: report.id, decision: 'delete' }, { requestId: 'delete-report-1' });
  const replay = await f.write('flag_resolve', { id: report.id, decision: 'delete' }, { requestId: 'delete-report-1' });
  assert.equal(replay.duplicate, true); assert.equal(f.calls.filter(call => call.method === 'deleteMessage').length, 1);
  assert.equal((await f.query('reports')).reports[0].decision, 'delete');
  assert.equal(f.calls.filter(call => /ban|restrict/i.test(call.method)).length, 0);
  f.setRole(ADMIN, 'member');
  await assert.rejects(f.write('flag_resolve', { id: report.id, decision: 'delete' }, { requestId: 'delete-report-1' }), code('forbidden'));
});

test('a report claim can be recovered after its owner loses admin authority', async t => {
  const f = await fixture(t), report = await f.report();
  await f.write('flag_claim', { id: report.id });
  f.setRole(ADMIN, 'member');
  await f.write('flag_claim', { id: report.id }, { actor: actor(ADMIN2) });
  assert.equal((await f.query('reports', {}, ADMIN2)).reports[0].claimed_by, String(ADMIN2));
  await assert.rejects(f.write('flag_resolve', { id: report.id, decision: 'dismiss' }), code('forbidden'));
});

test('ambiguous report deletion is not retried under the same or a new request', async t => {
  const f = await fixture(t), report = await f.report(); f.failDelete(new TelegramError('Network timeout', 0, true));
  await assert.rejects(f.write('flag_resolve', { id: report.id, decision: 'delete' }, { requestId: 'uncertain-delete' }), code('delivery_unknown'));
  await assert.rejects(f.write('flag_resolve', { id: report.id, decision: 'delete' }, { requestId: 'uncertain-delete' }), code('operation_unknown'));
  await assert.rejects(f.write('flag_resolve', { id: report.id, decision: 'delete' }), code('operation_unknown'));
  assert.equal(f.calls.filter(call => call.method === 'deleteMessage').length, 1);
  assert.equal((await f.query('reports')).reports[0].status, 'delete_unknown');
  await f.write('flag_resolve', { id: report.id, decision: 'resolved' });
  assert.equal((await f.query('reports')).reports[0].status, 'resolved');
});

test('a deletion without an explicit Telegram true result remains unconfirmed', async t => {
  const f = await fixture(t), report = await f.report(); f.deleteReturns(false);
  await assert.rejects(f.write('flag_resolve', { id: report.id, decision: 'delete' }), code('delivery_unknown'));
  assert.equal((await f.query('reports')).reports[0].status, 'delete_unknown');
  await assert.rejects(f.write('flag_resolve', { id: report.id, decision: 'delete' }), code('operation_unknown'));
  assert.equal(f.calls.filter(call => call.method === 'deleteMessage').length, 1);
});

test('FAQ is admin-curated, searchable to real members and isolated per group', async t => {
  const f = await fixture(t);
  const entry = { question: 'How do I register?', answer: 'Use the approved registration page.', url: 'https://sautilink.com/register', language: 'en' };
  const created = await f.write('faq_save', entry);
  const matching = await f.query('faq', { query: 'register', language: 'en' }, REPORTER);
  assert.equal(matching.faq.length, 1); assert.equal(matching.faq[0].id, created.id);
  assert.deepEqual((await f.query('faq', { query: 'unrelated' }, REPORTER)).faq, []);
  assert.deepEqual((await f.query('faq', { language: 'sw' }, REPORTER)).faq, []);
  await assert.rejects(f.write('faq_save', entry, { actor: actor(REPORTER) }), code('forbidden'));
  f.setRole(ADMIN, 'administrator', OTHER);
  await assert.rejects(f.write('faq_remove', { id: created.id }, { chatId: OTHER }), code('not_found'));
  await f.write('faq_remove', { id: created.id }); assert.deepEqual((await f.query('faq', {}, REPORTER)).faq, []);
  f.setRole(REPORTER, 'left'); await assert.rejects(f.query('faq', {}, REPORTER), code('forbidden'));
});

test('community mutations reject injected fields, unsafe URLs and changed request payloads', async t => {
  const f = await fixture(t), entry = { question: 'Question', answer: 'Answer', language: 'en' };
  await assert.rejects(f.write('faq_save', { ...entry, created_by: OWNER }), code('invalid_input'));
  for (const url of ['javascript:alert(1)', 'http://example.com', 'https://user:password@example.com', 'https://example.com:8080/', 'https://example.com/has space']) {
    await assert.rejects(f.write('faq_save', { ...entry, url }), code('invalid_url'));
  }
  await f.write('faq_save', entry, { requestId: 'same-faq' });
  await assert.rejects(f.write('faq_save', { ...entry, answer: 'Changed' }, { requestId: 'same-faq' }), code('request_conflict'));
  assert.equal((await f.query('community')).faq.length, 1);
});

test('hubs default private; publication includes only specifically approved fields and FAQ opt-in', async t => {
  const f = await fixture(t); await f.report();
  await f.write('faq_save', { question: 'Internal resource', answer: 'Group-specific answer.', language: 'en' });
  assert.equal(await f.service.getPublicHub('study-club'), null);
  await f.write('hub_save', f.hub({ visibility: 'private' }));
  assert.equal(await f.service.getPublicHub('study-club'), null);
  await f.write('hub_save', f.hub({ visibility: 'unlisted' }));
  let published = await f.service.getPublicHub('study-club');
  assert.equal(published.visibility, 'unlisted'); assert.deepEqual(published.faq, []);
  for (const key of ['chat_id', 'reporter_id', 'reports', 'updated_by', 'target_user_id']) assert.equal(Object.hasOwn(published, key), false);
  await f.write('hub_save', f.hub({ showFaq: true }));
  published = await f.service.getPublicHub('study-club'); assert.equal(published.faq.length, 1);
  await f.write('hub_save', f.hub({ visibility: 'private', showFaq: true }));
  assert.equal(await f.service.getPublicHub('study-club'), null);
});

test('hub names cannot be taken from another group and publication requires fresh admin authority', async t => {
  const f = await fixture(t); await f.write('hub_save', f.hub());
  f.setRole(ADMIN, 'administrator', OTHER);
  await assert.rejects(f.write('hub_save', f.hub(), { chatId: OTHER }), code('slug_unavailable'));
  f.setRole(ADMIN, 'member'); await assert.rejects(f.write('hub_save', f.hub({ visibility: 'private' })), code('forbidden'));
  await assert.rejects(f.write('hub_save', f.hub({ joinUrl: 'https://evil.example/invite' }), { actor: actor(ADMIN2) }), code('invalid_join_url'));
  await assert.rejects(f.write('hub_save', f.hub({ slug: '../../private' }), { actor: actor(ADMIN2) }), code('invalid_slug'));
});

test('public community rendering escapes admin text, restricts links, supports shared theme and noindex', async t => {
  const f = await fixture(t);
  const hub = { ...f.hub(), title: '<script>steal()</script>', description: 'A <b>description</b>', rules: '</div><img src=x onerror=alert(1)>',
    resources: [{ label: '<svg onload=alert(1)>', url: 'javascript:alert(1)' }, { label: 'Valid resource', url: 'https://sautilink.com/?a=1&b=2' }], showFaq: true,
    faq: [{ question: 'Is <script> safe?', answer: '</script><script>evil()</script>', url: 'javascript:alert(2)' }] };
  const html = renderCommunityHub(hub);
  assert.ok(html.includes('<html lang="en">')); assert.ok(html.includes('data-pilot-theme')); assert.ok(html.includes('data-theme-toggle'));
  assert.ok(html.includes('&lt;script&gt;steal()&lt;/script&gt;')); assert.ok(!html.includes('<script>steal()'));
  assert.ok(!html.includes('href="javascript:')); assert.ok(!html.includes('<img src=x')); assert.ok(!html.includes('<script>evil()'));
  assert.ok(html.includes('https://sautilink.com/?a=1&amp;b=2')); assert.ok(html.includes('name="robots" content="index,follow"'));
  const unlisted = renderCommunityHub({ ...hub, visibility: 'unlisted' }, { lang: 'sw' });
  assert.ok(unlisted.includes('<html lang="sw">')); assert.ok(unlisted.includes('name="robots" content="noindex,nofollow"'));
  assert.ok(!unlisted.includes('application/ld+json'));
});

test('feedback accepts signed users, limits intake, and only the numeric owner can review', async t => {
  const f = await fixture(t);
  const result = await f.write('feedback_create', { kind: 'feature', message: 'Please add a useful integration.' }, { actor: actor(REPORTER), chatId: undefined });
  await assert.rejects(f.query('feedback'), code('forbidden'));
  await assert.rejects(f.service.query({ view: 'feedback', actor: { id: ADMIN, username: 'drcharlestz' } }), code('forbidden'));
  const feedback = (await f.query('feedback', {}, OWNER)).feedback;
  assert.equal(feedback[0].id, result.id);
  await f.write('feedback_resolve', { id: result.id, status: 'planned' }, { actor: actor(OWNER), chatId: undefined });
  assert.equal((await f.query('feedback', {}, OWNER)).feedback[0].status, 'planned');
  for (let n = 0; n < 4; n++) await f.write('feedback_create', { kind: 'bug', message: `Bug ${n}` }, { actor: actor(REPORTER), chatId: undefined });
  await assert.rejects(f.write('feedback_create', { kind: 'feature', message: 'Sixth' }, { actor: actor(REPORTER), chatId: undefined }), code('feedback_rate_limited'));
  await assert.rejects(f.write('feedback_create', { kind: 'bug', message: 'Forged' }, { actor: { id: OWNER, is_bot: true } }), code('unauthorized'));
});

test('retention removes report evidence and expired operation replays without deleting curated configuration', async t => {
  const f = await fixture(t); await f.report();
  await f.write('faq_save', { question: 'A stable question', answer: 'An approved answer', language: 'en' });
  await f.write('hub_save', f.hub());
  await f.write('feedback_create', { kind: 'feature', message: 'A suggestion.' }, { actor: actor(REPORTER) });
  f.advance(31 * 86400); await f.service.cleanup(NOW + 31 * 86400);
  assert.equal((await f.store.first('SELECT COUNT(*) AS total FROM pilot_member_reports')).total, 0);
  assert.equal((await f.store.first('SELECT COUNT(*) AS total FROM pilot_community_operations')).total, 0);
  assert.equal((await f.query('community')).faq.length, 1); assert.ok(await f.service.getPublicHub('study-club'));
  assert.equal((await f.query('feedback', {}, OWNER)).feedback.length, 1);
  f.advance(60 * 86400); await f.service.cleanup(NOW + 91 * 86400);
  assert.equal((await f.store.first('SELECT COUNT(*) AS total FROM pilot_feature_feedback')).total, 0);
});
