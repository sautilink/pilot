import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
import { TestD1 } from './helpers/d1.js';
import { applySchema, createStore, SCHEMA_SQL, LINK_WARNING_SCHEMA_SQL } from '../src/store.js';
import { createModerator } from '../src/moderator.js';
import { TelegramError } from '../src/telegram.js';

const GROUP = -1001001, OTHER_GROUP = -1001002, BOT = 900, USER = 101, OTHER = 102;
const START = Date.UTC(2026, 10, 2, 9) / 1000;
const forward = { type: 'hidden_user', date: START - 1, sender_user_name: 'Origin' };

async function fixture(t) {
  const db = new TestD1(); await applySchema(db); t.after(() => db.close());
  const store = createStore(db), calls = [], members = new Map(), hooks = new Map();
  let now = START, update = 0, message = 0, nextMessage = 5000;
  const member = (chat, user, status = 'member', extra = {}) => {
    const value = { status, user: { id: user, first_name: 'Juma' }, ...extra };
    members.set(`${chat}:${user}`, value); return value;
  };
  const api = { async call(method, params = {}) {
    calls.push({ method, params: structuredClone(params) });
    if (hooks.has(method)) return hooks.get(method)(params);
    if (method === 'getMe') return { id: BOT, username: 'sautilinkpilotbot', is_bot: true };
    if (method === 'getChat') return { id: params.chat_id, type: 'supergroup', linked_chat_id: -1002001 };
    if (method === 'getChatMember') return params.user_id === BOT
      ? { status: 'administrator', user: { id: BOT }, can_delete_messages: true, can_restrict_members: true }
      : members.get(`${params.chat_id}:${params.user_id}`) || member(params.chat_id, params.user_id);
    if (method === 'getChatAdministrators') return [...members.entries()].filter(([key, value]) => key.startsWith(`${params.chat_id}:`) && ['administrator', 'creator'].includes(value.status)).map(([, value]) => value);
    if (method === 'banChatMember') { member(params.chat_id, params.user_id, 'kicked', { until_date: params.until_date }); return true; }
    if (method === 'unbanChatMember') { member(params.chat_id, params.user_id, 'left'); return true; }
    if (method === 'deleteMessage') return true;
    if (method === 'sendMessage') return { message_id: nextMessage++, chat: { id: params.chat_id } };
    throw new Error(`Unexpected Telegram method: ${method}`);
  } };
  const moderator = createModerator({ db, api, clock: () => now });
  return { db, store, api, moderator, hooks, member, calls,
    now: () => now, advance: value => { now += value; },
    callsOf: method => calls.filter(call => call.method === method),
    message(overrides = {}, type = 'message') { return { update_id: ++update, [type]: {
      message_id: ++message, date: now, chat: { id: GROUP, type: 'supergroup', title: 'Group' },
      from: { id: USER, first_name: 'Juma', is_bot: false }, text: 'https://unapproved.example/offer', ...overrides,
    } }; },
    warning: (chat = GROUP, user = USER) => db.prepare('SELECT * FROM member_link_warnings WHERE chat_id=? AND user_id=?').bind(String(chat), String(user)).first(),
    state: (chat = GROUP, user = USER) => store.member(chat, user),
  };
}

async function seedUpstreamWarning(f, { delivery = 'sent', messageId = 4800, at = START - 10 } = {}) {
  const id = `${GROUP}:message:4800`;
  await f.store.plan({ id, chat_id: GROUP, user_id: USER, message_id: 4800, event_at: at - 5, created_at: at - 5, strike: 0, until_date: 0, reasons: '["link"]' });
  await f.store.run("UPDATE incidents SET status='warned',deleted=1,notified=1 WHERE id=?", id);
  await f.store.run('UPDATE members SET last_incident=? WHERE chat_id=? AND user_id=?', id, String(GROUP), String(USER));
  if (delivery) await f.store.run('INSERT INTO notification_delivery(incident_id,status,attempts,telegram_message_id,updated_at) VALUES(?,?,?,?,?)', id, delivery, 1, messageId, at);
  return id;
}

test('fresh prohibited link is deleted, durably warned and tagged without any ban strike', async t => {
  const f = await fixture(t), update = f.message({ from: { id: USER, first_name: '<Juma & Sana>' } });
  let atSend;
  f.hooks.set('sendMessage', async () => {
    atSend = { warning: await f.warning(), state: await f.state(), incident: await f.store.incident(`${GROUP}:message:1`) };
    return { message_id: 7001 };
  });
  assert.equal((await f.moderator.handle(update)).status, 'warned');
  assert.equal(f.callsOf('deleteMessage').length, 1); assert.equal(f.callsOf('banChatMember').length, 0);
  assert.ok(atSend.warning, 'the warning is durable before a notice can be sent');
  assert.equal(atSend.warning.delivered_at, 0, 'a durable warning claim is not proof of delivery');
  assert.equal((await f.warning()).delivered_at, f.now(), 'only a confirmed Telegram message records delivery');
  assert.equal(atSend.incident.status, 'warned'); assert.equal(atSend.incident.strike, 0); assert.equal(atSend.incident.until_date, 0);
  assert.equal(atSend.state.strikes, 0); assert.equal(atSend.state.active_until, 0); assert.equal(atSend.state.episode_at, 0);
  const notice = f.callsOf('sendMessage')[0].params;
  assert.match(notice.text, /tg:\/\/user\?id=101/); assert.match(notice.text, /&lt;Juma &amp; Sana&gt;/);
  assert.match(notice.text, /onyo|warning/i); assert.match(notice.text, /ukirudia|ukituma tena|repeat/i);
  assert.doesNotMatch(notice.text, /MEMBER AMEFUNGIWA|MEMBER BANNED|Ban ya kudumu/);
  assert.ok(f.calls.findIndex(call => call.method === 'deleteMessage') < f.calls.findIndex(call => call.method === 'sendMessage'));
});

test('the next three independent link violations ban for 24h, 7d, then permanently', async t => {
  const f = await fixture(t);
  await f.moderator.handle(f.message()); f.advance(1);
  await f.moderator.handle(f.message());
  assert.equal(f.callsOf('banChatMember')[0].params.until_date, f.now() + 86400);
  f.advance(86401); f.member(GROUP, USER); await f.moderator.handle(f.message());
  assert.equal(f.callsOf('banChatMember')[1].params.until_date, f.now() + 7 * 86400);
  f.advance(7 * 86400 + 1); f.member(GROUP, USER); await f.moderator.handle(f.message());
  assert.equal(f.callsOf('banChatMember')[2].params.until_date, 0);
  assert.equal((await f.state()).strikes, 3); assert.equal((await f.state()).active_until, -1);
});

test('warning eligibility belongs to each member in each group; allowed links do not consume it', async t => {
  const f = await fixture(t);
  await f.moderator.handle(f.message({ text: 'https://sautilink.com/news' }));
  assert.equal(await f.warning(), null);
  await f.moderator.handle(f.message());
  await f.moderator.handle(f.message({ from: { id: OTHER, first_name: 'Other' } }));
  await f.moderator.handle(f.message({ chat: { id: OTHER_GROUP, type: 'supergroup' } }));
  assert.ok(await f.warning()); assert.ok(await f.warning(GROUP, OTHER)); assert.ok(await f.warning(OTHER_GROUP));
  assert.equal(f.callsOf('banChatMember').length, 0); assert.equal(f.callsOf('sendMessage').length, 3);
});

test('additive whitelist and unexpired temporary permissions preserve first-warning eligibility', async t => {
  const f = await fixture(t);
  await f.store.run('INSERT INTO pilot_whitelist_rules VALUES(?,?,?,?,?,?)', 'rule', String(GROUP), 'domain', 'unapproved.example', String(OTHER), START);
  assert.equal((await f.moderator.handle(f.message())).status, 'allowed'); assert.equal(await f.warning(), null);
  await f.store.run('DELETE FROM pilot_whitelist_rules WHERE id=?', 'rule');
  await f.store.run('INSERT INTO pilot_temporary_links(id,chat_id,url,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?)', 'temporary', String(GROUP), 'https://unapproved.example/offer', String(OTHER), START, START + 60);
  assert.equal((await f.moderator.handle(f.message())).status, 'allowed'); assert.equal(await f.warning(), null);
  f.advance(61); assert.equal((await f.moderator.handle(f.message())).status, 'warned');
  assert.equal(f.callsOf('banChatMember').length, 0);
});

test('concealed caption links receive the same first-warning policy', async t => {
  const f = await fixture(t);
  assert.equal((await f.moderator.handle(f.message({ text: undefined, caption: 'Read', caption_entities: [{ type: 'text_link', offset: 0, length: 4, url: 'https://unapproved.example/hidden' }] }))).status, 'warned');
  assert.ok(await f.warning()); assert.equal((await f.state()).strikes, 0); assert.equal(f.callsOf('banChatMember').length, 0);
});

test('legacy strikes receive one new link warning while preserving the next ban level', async t => {
  for (const strikes of [1, 2, 3]) {
    const f = await fixture(t); await f.state();
    await f.store.run('UPDATE members SET strikes=?,last_incident=?,episode_at=? WHERE chat_id=? AND user_id=?', strikes, 'legacy', START - 10, String(GROUP), String(USER));
    assert.equal((await f.moderator.handle(f.message())).status, 'warned');
    const state = await f.state(); assert.equal(state.strikes, strikes); assert.equal(state.last_incident, 'legacy'); assert.equal(state.episode_at, START - 10);
    f.advance(1); await f.moderator.handle(f.message());
    const ban = f.callsOf('banChatMember'); assert.equal(ban.length, 1);
    assert.equal(ban[0].params.until_date, strikes === 1 ? f.now() + 7 * 86400 : 0);
  }
});

test('a warning never lifts or rewrites a prior active or permanent ban', async t => {
  const f = await fixture(t); await f.state();
  await f.store.run('UPDATE members SET strikes=3,active_until=-1,episode_at=? WHERE chat_id=? AND user_id=?', START - 10, String(GROUP), String(USER));
  f.member(GROUP, USER, 'kicked', { until_date: 0 });
  assert.equal((await f.moderator.handle(f.message())).status, 'already_banned');
  assert.equal(await f.warning(), null); assert.equal((await f.state()).active_until, -1);
  assert.equal(f.callsOf('unbanChatMember').length, 0); assert.equal(f.callsOf('banChatMember').length, 0);
});

test('forwards keep immediate progressive bans; they do not consume the independent link warning', async t => {
  const f = await fixture(t);
  await f.moderator.handle(f.message({ text: 'Forward only', forward_origin: forward }));
  assert.equal(f.callsOf('banChatMember').length, 1); assert.equal(await f.warning(), null);
  f.advance(86401); f.member(GROUP, USER);
  assert.equal((await f.moderator.handle(f.message())).status, 'warned'); assert.equal((await f.state()).strikes, 1);
  f.advance(1); await f.moderator.handle(f.message());
  assert.equal(f.callsOf('banChatMember')[1].params.until_date, f.now() + 7 * 86400);
});

test('a mixed prohibited link and forward receives the first-link warning', async t => {
  const f = await fixture(t), update = f.message({ forward_origin: forward });
  assert.equal((await f.moderator.handle(update)).status, 'warned');
  assert.equal(f.callsOf('banChatMember').length, 0);
  assert.deepEqual(new Set(JSON.parse((await f.store.incident(`${GROUP}:message:1`)).reasons)), new Set(['forward', 'link']));
});

test('administrators, anonymous admins and the linked channel never consume member warnings', async t => {
  const f = await fixture(t); f.member(GROUP, USER, 'administrator');
  await f.moderator.handle(f.message());
  f.member(GROUP, USER, 'member');
  await f.moderator.handle(f.message({ sender_chat: { id: GROUP, type: 'supergroup' } }));
  await f.moderator.handle(f.message({ sender_chat: { id: -1002001, type: 'channel' } }));
  assert.equal(await f.warning(), null); assert.equal(f.callsOf('deleteMessage').length, 0); assert.equal(f.callsOf('banChatMember').length, 0);
});

test('warning message duplicates, edits and album siblings never turn into a ban', async t => {
  const f = await fixture(t), update = f.message({ media_group_id: 'album' });
  await f.moderator.handle(update); assert.equal((await f.moderator.handle(structuredClone(update))).status, 'duplicate');
  await f.moderator.handle(f.message({ media_group_id: 'album' }));
  f.advance(10);
  await f.moderator.handle(f.message({ ...update.message, edit_date: f.now() }, 'edited_message'));
  assert.equal(f.callsOf('sendMessage').length, 1); assert.equal(f.callsOf('banChatMember').length, 0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM incidents').first()).n, 1);
  assert.equal((await f.state()).strikes, 0);
  await f.moderator.handle(f.message()); assert.equal(f.callsOf('banChatMember').length, 1);
});

test('an edited clean message receives the first-link warning once', async t => {
  const f = await fixture(t), clean = f.message({ text: 'Hello' }); await f.moderator.handle(clean); f.advance(1);
  const edit = f.message({ message_id: clean.message.message_id, edit_date: f.now() }, 'edited_message');
  assert.equal((await f.moderator.handle(edit)).status, 'warned');
  await f.moderator.handle({ ...structuredClone(edit), update_id: 1000 });
  assert.equal(f.callsOf('sendMessage').length, 1); assert.equal(f.callsOf('banChatMember').length, 0);
});

test('false or failed deletion never consumes a warning; a successful retry remains warning-only', async t => {
  for (const result of [false, new TelegramError('Deletion unavailable', 503, true), new TelegramError('Forbidden', 403, false)]) {
    const f = await fixture(t), update = f.message();
    f.hooks.set('deleteMessage', () => { if (result instanceof Error) throw result; return result; });
    await assert.rejects(f.moderator.handle(update));
    assert.equal(await f.warning(), null); assert.equal(f.callsOf('sendMessage').length, 0); assert.equal(f.callsOf('banChatMember').length, 0);
    f.hooks.delete('deleteMessage'); assert.equal((await f.moderator.handle(update)).status, 'warned');
    assert.equal((await f.state()).strikes, 0);
  }
});

test('a different album item cannot consume the warning until the original deletion succeeds', async t => {
  const f = await fixture(t), original = f.message({ media_group_id: 'retry-album' });
  f.hooks.set('deleteMessage', () => false); await assert.rejects(f.moderator.handle(original));
  f.hooks.delete('deleteMessage');
  const sibling = f.message({ media_group_id: 'retry-album' });
  assert.equal((await f.moderator.handle(sibling)).status, 'warned');
  assert.deepEqual(f.callsOf('deleteMessage').map(call => call.params.message_id), [1, 2, 1]);
  assert.ok(await f.warning()); assert.equal(f.callsOf('banChatMember').length, 0); assert.equal(f.callsOf('sendMessage').length, 1);
});

test('an admin override during deletion cancels warning consumption and its notification', async t => {
  const f = await fixture(t);
  f.hooks.set('deleteMessage', async () => { await f.store.override(GROUP, USER, f.now()); return true; });
  assert.equal((await f.moderator.handle(f.message())).status, 'cancelled');
  assert.equal(await f.warning(), null); assert.equal(f.callsOf('sendMessage').length, 0); assert.equal(f.callsOf('banChatMember').length, 0);
});

test('Telegram message-not-found proves absence and permits warning recovery', async t => {
  const f = await fixture(t); f.hooks.set('deleteMessage', () => { throw new TelegramError('Bad Request: message to delete not found', 400, false); });
  assert.equal((await f.moderator.handle(f.message())).status, 'warned'); assert.ok(await f.warning());
  assert.equal(f.callsOf('sendMessage').length, 1); assert.equal(f.callsOf('banChatMember').length, 0);
});

test('D1 failure rolls back warning consumption and no notice precedes durable recovery', async t => {
  const f = await fixture(t), update = f.message();
  await f.db.exec("CREATE TRIGGER fail_warning BEFORE INSERT ON member_link_warnings BEGIN SELECT RAISE(ABORT,'warning storage failed'); END;");
  await assert.rejects(f.moderator.handle(update), /warning storage failed/);
  assert.equal(await f.warning(), null); assert.equal(f.callsOf('sendMessage').length, 0); assert.equal(f.callsOf('banChatMember').length, 0);
  await f.db.exec('DROP TRIGGER fail_warning;');
  assert.equal((await f.moderator.handle(update)).status, 'warned'); assert.ok(await f.warning()); assert.equal((await f.state()).strikes, 0);
});

test('rate-limited warning delivery retries without another warning, deletion or strike', async t => {
  const f = await fixture(t), update = f.message();
  f.hooks.set('sendMessage', () => { f.hooks.delete('sendMessage'); throw new TelegramError('Too Many Requests', 429, false, 4); });
  assert.equal((await f.moderator.handle(update)).retry, true);
  assert.ok(await f.warning()); assert.equal((await f.moderator.handle(update)).retry, true);
  assert.equal(f.callsOf('sendMessage').length, 1); f.advance(5);
  assert.equal((await f.moderator.handle(update)).status, 'warned');
  assert.equal(f.callsOf('sendMessage').length, 2); assert.equal(f.callsOf('deleteMessage').length, 1); assert.equal(f.callsOf('banChatMember').length, 0);
  assert.equal((await f.state()).strikes, 0);
});

test('ambiguous and malformed warning sends are never falsely marked delivered or blindly resent', async t => {
  for (const result of [new TelegramError('Response lost', 0, true), false, true, null, { message_id: 'bad' }, { message_id: 0 }, { message_id: -1 }]) {
    const f = await fixture(t), update = f.message();
    f.hooks.set('sendMessage', () => { if (result instanceof Error) throw result; return result; });
    await f.moderator.handle(update); f.hooks.delete('sendMessage');
    await f.moderator.handle({ ...structuredClone(update), update_id: 1000 });
    assert.equal(f.callsOf('sendMessage').length, 1); assert.ok(await f.warning());
    const delivery = await f.db.prepare('SELECT * FROM notification_delivery').first(); assert.equal(delivery.status, 'unknown'); assert.equal(delivery.telegram_message_id, null);
    assert.equal((await f.warning()).delivered_at, 0);
    f.advance(1); assert.equal((await f.moderator.handle(f.message())).status, 'warned');
    assert.equal(f.callsOf('banChatMember').length, 0, 'unknown delivery must never enable a premature ban');
    assert.equal((await f.warning()).delivered_at, f.now(), 'a fresh reminder can confirm delivery');
    f.advance(1); await f.moderator.handle(f.message()); assert.equal(f.callsOf('banChatMember').length, 1);
  }
});

test('a fresh reminder supersedes pending warning delivery and only confirmed delivery unlocks bans', async t => {
  const f = await fixture(t), original = f.message();
  f.hooks.set('sendMessage', () => { throw new TelegramError('Too Many Requests', 429, false, 4); });
  assert.equal((await f.moderator.handle(original)).retry, true); assert.equal((await f.warning()).delivered_at, 0);
  f.hooks.delete('sendMessage'); f.advance(1); const reminder = f.message();
  assert.equal((await f.moderator.handle(reminder)).status, 'warned'); assert.equal(f.callsOf('banChatMember').length, 0);
  assert.equal((await f.warning()).incident_id, `${GROUP}:message:${reminder.message.message_id}`);
  assert.equal((await f.warning()).delivered_at, f.now());
  const oldDelivery = await f.db.prepare('SELECT status FROM notification_delivery WHERE incident_id=?').bind(`${GROUP}:message:${original.message.message_id}`).first();
  assert.equal(oldDelivery.status, 'cancelled');
  f.advance(5); await f.moderator.handle(original);
  assert.equal(f.callsOf('sendMessage').length, 2, 'a superseded rate-limit retry cannot send an old warning');
  await f.moderator.handle(f.message()); assert.equal(f.callsOf('banChatMember').length, 1);
});

test('repeated distinct links cannot ban a member while every warning is rejected', async t => {
  const f = await fixture(t); f.hooks.set('sendMessage', () => { throw new TelegramError('Forbidden', 403, false); });
  for (let index = 0; index < 3; index++) { f.advance(1); assert.equal((await f.moderator.handle(f.message())).status, 'warned'); }
  assert.equal(f.callsOf('deleteMessage').length, 3); assert.equal(f.callsOf('banChatMember').length, 0);
  assert.equal((await f.warning()).delivered_at, 0); assert.equal((await f.state()).strikes, 0);
});

test('definitely rejected warning stays diagnostic and later links remind until delivery is confirmed', async t => {
  const f = await fixture(t); f.hooks.set('sendMessage', () => { throw new TelegramError('Forbidden', 403, false); });
  const update = f.message(); assert.equal((await f.moderator.handle(update)).status, 'warned');
  assert.equal((await f.db.prepare('SELECT status FROM notification_delivery').first()).status, 'failed');
  f.hooks.delete('sendMessage'); await f.moderator.handle({ ...structuredClone(update), update_id: 1000 });
  assert.equal(f.callsOf('sendMessage').length, 1); f.advance(1); await f.moderator.handle(f.message());
  assert.equal(f.callsOf('banChatMember').length, 0); assert.equal((await f.state()).strikes, 0);
  assert.equal((await f.warning()).delivered_at, f.now());
  f.advance(1); await f.moderator.handle(f.message());
  assert.equal(f.callsOf('banChatMember').length, 1); assert.equal((await f.state()).strikes, 1);
});

test('ordinary admin overrides preserve warning eligibility consumed; explicit forgiveness resets it', async t => {
  const f = await fixture(t), old = f.message(); await f.moderator.handle(old); f.advance(1);
  await f.store.override(GROUP, USER, f.now()); assert.ok(await f.warning());
  await f.moderator.handle({ ...structuredClone(old), update_id: 1000 }); assert.equal(f.callsOf('sendMessage').length, 1);
  f.advance(1); await f.moderator.handle(f.message()); assert.equal(f.callsOf('banChatMember').length, 1);
  f.advance(1); f.member(GROUP, USER); await f.store.override(GROUP, USER, f.now(), true);
  assert.equal(await f.warning(), null); f.advance(1);
  assert.equal((await f.moderator.handle(f.message())).status, 'warned'); assert.equal((await f.state()).strikes, 0);
});

test('warning remains consumed after incident-retention cleanup and coordinator restart', async t => {
  const f = await fixture(t); await f.moderator.handle(f.message()); f.advance(31 * 86400);
  await f.store.cleanup(f.now()); assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM incidents').first()).n, 0);
  assert.ok(await f.warning());
  const restarted = createModerator({ db: f.db, api: f.api, clock: f.now });
  await restarted.handle(f.message()); assert.equal(f.callsOf('banChatMember').length, 1); assert.equal((await f.state()).strikes, 1);
});

test('unsent legacy planned link bans downgrade to warnings, including known-rejected 429 plans', async t => {
  for (const deleted of [0, 1]) {
    const f = await fixture(t), update = f.message();
    await f.state(); await f.store.run('UPDATE members SET strikes=1,last_incident=? WHERE chat_id=? AND user_id=?', 'legacy-confirmed', String(GROUP), String(USER));
    await f.store.plan({ id: `${GROUP}:message:1`, chat_id: GROUP, user_id: USER, message_id: 1, event_at: START, created_at: START, strike: 2, until_date: START + 7 * 86400, reasons: '["link"]' });
    // Prior code leaves planned/deleted=0 before deletion or planned/deleted=1
    // after Telegram definitely rejects the unsent ban with retry_after.
    await f.store.run('UPDATE incidents SET deleted=? WHERE id=?', deleted, `${GROUP}:message:1`);
    assert.equal((await f.moderator.handle(update)).status, 'warned'); assert.equal(f.callsOf('banChatMember').length, 0);
    const row = await f.store.incident(`${GROUP}:message:1`); assert.equal(row.strike, 0); assert.equal(row.until_date, 0);
    assert.ok((await f.warning()).delivered_at); assert.equal((await f.state()).strikes, 1); assert.equal((await f.state()).last_incident, 'legacy-confirmed');
    f.advance(1); await f.moderator.handle(f.message());
    assert.equal(f.callsOf('banChatMember')[0].params.until_date, f.now() + 7 * 86400);
  }
});

test('a failed deletion of an unsent legacy link ban cannot bypass its downgraded warning on retry', async t => {
  const f = await fixture(t), update = f.message();
  await f.store.plan({ id: `${GROUP}:message:1`, chat_id: GROUP, user_id: USER, message_id: 1, event_at: START, created_at: START, strike: 1, until_date: START + 86400, reasons: '["link"]' });
  f.hooks.set('deleteMessage', () => false); await assert.rejects(f.moderator.handle(update));
  assert.equal(await f.warning(), null); assert.equal((await f.store.incident(`${GROUP}:message:1`)).strike, 0);
  f.hooks.delete('deleteMessage'); assert.equal((await f.moderator.handle(update)).status, 'warned');
  assert.equal(f.callsOf('banChatMember').length, 0); assert.equal((await f.state()).strikes, 0);
});

test('sent and uncertain legacy link bans reconcile without reissuing a ban or rewriting them as warnings', async t => {
  for (const status of ['ban_sent', 'uncertain', 'confirmed']) {
    const f = await fixture(t), update = f.message();
    await f.store.plan({ id: `${GROUP}:message:1`, chat_id: GROUP, user_id: USER, message_id: 1, event_at: START, created_at: START, strike: 1, until_date: START + 86400, reasons: '["link"]' });
    await f.store.status(`${GROUP}:message:1`, status); f.member(GROUP, USER, 'kicked', { until_date: START + 86400 });
    if (status === 'confirmed') await f.store.run('UPDATE members SET strikes=1,active_until=?,episode_at=? WHERE chat_id=? AND user_id=?', START + 86400, START, String(GROUP), String(USER));
    assert.equal((await f.moderator.handle(update)).status, 'confirmed'); assert.equal(f.callsOf('banChatMember').length, 0);
    assert.equal(await f.warning(), null); assert.equal((await f.state()).strikes, 1); assert.equal((await f.store.incident(`${GROUP}:message:1`)).strike, 1);
  }
});

test('uncertain legacy bans with contradictory live membership require review and never a replacement warning or ban', async t => {
  const f = await fixture(t), update = f.message();
  await f.store.plan({ id: `${GROUP}:message:1`, chat_id: GROUP, user_id: USER, message_id: 1, event_at: START, created_at: START, strike: 1, until_date: START + 86400, reasons: '["link"]' });
  await f.store.status(`${GROUP}:message:1`, 'uncertain');
  assert.equal((await f.moderator.handle(update)).status, 'review'); assert.equal(f.callsOf('banChatMember').length, 0);
  assert.equal(await f.warning(), null); assert.equal(f.callsOf('sendMessage').length, 0); assert.equal((await f.state()).strikes, 0);
});

test('unsent legacy forward-only plans retain their immediate progressive-ban behavior', async t => {
  const f = await fixture(t), update = f.message({ text: 'Forward only', forward_origin: forward });
  await f.store.plan({ id: `${GROUP}:message:1`, chat_id: GROUP, user_id: USER, message_id: 1, event_at: START, created_at: START, strike: 1, until_date: START + 86400, reasons: '["forward"]' });
  assert.equal((await f.moderator.handle(update)).status, 'confirmed'); assert.equal(f.callsOf('banChatMember').length, 1);
  assert.equal(await f.warning(), null); assert.equal((await f.state()).strikes, 1);
});

test('the additive migration is repeatable and a legacy database upgrades without rewriting members', async t => {
  const db = new TestD1(); t.after(() => db.close());
  await db.exec(SCHEMA_SQL.replace(LINK_WARNING_SCHEMA_SQL, ''));
  await db.prepare('INSERT INTO members(chat_id,user_id,strikes,active_until,override_at) VALUES(?,?,?,?,?)').bind(String(GROUP), String(USER), 2, -1, START - 50).run();
  const before = await db.prepare('SELECT * FROM members').first();
  const migration = await readFile(new URL('../migrations/0013_link_warnings.sql', import.meta.url), 'utf8');
  const normalize = sql => sql.replace(/^--.*$/gm, '').replace(/\s+/g, ' ').trim();
  assert.equal(normalize(migration), normalize(LINK_WARNING_SCHEMA_SQL));
  await db.exec(migration); await db.exec(migration);
  assert.deepEqual(await db.prepare('SELECT * FROM members').first(), before);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM member_link_warnings').first()).n, 0);
  const store = createStore(db); assert.equal(await store.linkWarning(GROUP, USER), null);
  assert.equal(await store.setting('pilot_schema:linkwarnings'), '1');
});

test('upgrade imports a confirmed upstream warning so the next later link starts bans without another warning', async t => {
  const f = await fixture(t), id = await seedUpstreamWarning(f);
  assert.equal(await f.warning(), null, 'upstream deployment had no separate warning ledger');
  assert.equal((await f.moderator.handle(f.message())).status, 'confirmed');
  const warning = await f.warning(); assert.equal(warning.incident_id, id); assert.equal(warning.delivered_at, START - 10);
  assert.equal(f.callsOf('banChatMember').length, 1); assert.equal(f.callsOf('banChatMember')[0].params.until_date, START + 86400);
  assert.equal(f.callsOf('sendMessage').length, 1); assert.doesNotMatch(f.callsOf('sendMessage')[0].params.text, /ONYO LA LINK/);
  assert.equal((await f.state()).strikes, 1);
});

test('an imported upstream warning also protects queued links sent before its delivery timestamp', async t => {
  const f = await fixture(t), id = await seedUpstreamWarning(f);
  for (const date of [START - 11, START - 10]) assert.equal((await f.moderator.handle(f.message({ date }))).status, 'before_warning');
  assert.equal((await f.warning()).incident_id, id); assert.equal(f.callsOf('banChatMember').length, 0); assert.equal(f.callsOf('sendMessage').length, 0);
  assert.equal((await f.moderator.handle(f.message())).status, 'confirmed'); assert.equal(f.callsOf('banChatMember').length, 1);
});

test('pending or unverified upstream warning delivery requires a fresh successful reminder before bans', async t => {
  for (const delivery of ['pending', 'unknown', 'failed', null]) {
    const f = await fixture(t); await seedUpstreamWarning(f, { delivery, messageId: null });
    assert.equal((await f.moderator.handle(f.message())).status, 'warned');
    assert.equal(f.callsOf('banChatMember').length, 0); assert.equal((await f.state()).strikes, 0);
    assert.equal((await f.warning()).delivered_at, f.now());
    f.advance(1); assert.equal((await f.moderator.handle(f.message())).status, 'confirmed'); assert.equal(f.callsOf('banChatMember').length, 1);
  }
});

test('an upstream sent claim without a valid Telegram message ID does not prove warning delivery', async t => {
  for (const messageId of [null, 0, -1, 1.5, 'invalid']) {
    const f = await fixture(t); await seedUpstreamWarning(f, { delivery: 'sent', messageId });
    assert.equal((await f.moderator.handle(f.message())).status, 'warned');
    assert.equal(f.callsOf('banChatMember').length, 0); assert.equal((await f.state()).strikes, 0);
    assert.equal((await f.warning()).delivered_at, f.now(), 'only the new successful reminder proves delivery');
  }
});

test('late upstream delivery proof upgrades an imported pending ledger on the next decision', async t => {
  const f = await fixture(t), id = await seedUpstreamWarning(f, { delivery: 'pending', messageId: null });
  await f.store.moderationState(GROUP, USER, `${GROUP}:message:1`);
  assert.equal((await f.warning()).delivered_at, 0);
  await f.store.run("UPDATE notification_delivery SET status='sent',telegram_message_id=4800,updated_at=? WHERE incident_id=?", START, id);
  f.advance(1); assert.equal((await f.moderator.handle(f.message())).status, 'confirmed');
  assert.equal((await f.warning()).incident_id, id); assert.equal((await f.warning()).delivered_at, START);
  assert.equal(f.callsOf('banChatMember').length, 1); assert.equal((await f.state()).strikes, 1);
});

test('forgiveness before upgrade prevents a cancelled upstream warning from being imported again', async t => {
  const f = await fixture(t), id = await seedUpstreamWarning(f);
  await f.store.override(GROUP, USER, START - 1, true);
  assert.equal((await f.store.incident(id)).status, 'cancelled'); assert.equal(await f.warning(), null);
  assert.equal((await f.moderator.handle(f.message())).status, 'warned');
  assert.notEqual((await f.warning()).incident_id, id); assert.equal(f.callsOf('banChatMember').length, 0); assert.equal((await f.state()).strikes, 0);
});

test('the real coordinator queue serializes concurrent duplicate and next-link decisions', async t => {
  register('../scripts/cloudflare-smoke-loader.mjs', import.meta.url);
  const { GroupCoordinator } = await import('../src/index.js');
  const f = await fixture(t), update = f.message();
  const queue = { tail: Promise.resolve(), pendingWork: 0, ctx: { waitUntil() {} }, performance: { async record() {} } };
  const invoke = value => GroupCoordinator.prototype.queued.call(queue, 'telegram', () => f.moderator.handle(value));
  const [first, duplicate, next] = await Promise.all([invoke(update), invoke(structuredClone(update)), invoke(f.message())]);
  assert.equal(first.status, 'warned'); assert.equal(duplicate.status, 'duplicate'); assert.equal(next.status, 'before_warning');
  assert.equal(f.callsOf('banChatMember').length, 0); assert.equal(f.callsOf('sendMessage').length, 1);
  f.advance(1); assert.equal((await invoke(f.message())).status, 'confirmed');
  assert.equal(f.callsOf('banChatMember').length, 1); assert.equal(f.callsOf('sendMessage').length, 2);
  assert.equal((await f.state()).strikes, 1); assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM member_link_warnings').first()).n, 1);
});

test('links sent before or in the same second as warning delivery are deleted without a premature ban', async t => {
  const f = await fixture(t); await f.moderator.handle(f.message());
  for (const date of [START - 10, START]) assert.equal((await f.moderator.handle(f.message({ date }))).status, 'before_warning');
  assert.equal(f.callsOf('banChatMember').length, 0); assert.equal(f.callsOf('sendMessage').length, 1);
  assert.equal(f.callsOf('deleteMessage').length, 3); assert.equal((await f.state()).strikes, 0);
  f.advance(1); assert.equal((await f.moderator.handle(f.message())).status, 'confirmed');
  assert.equal(f.callsOf('banChatMember')[0].params.until_date, f.now() + 86400);
});

test('an unsent legacy link plan from before delivery is cancelled only after successful deletion', async t => {
  const f = await fixture(t); await f.moderator.handle(f.message());
  const queued = f.message({ date: START - 1 });
  await f.store.plan({ id: `${GROUP}:message:2`, chat_id: GROUP, user_id: USER, message_id: 2, event_at: START - 1, created_at: START, strike: 1, until_date: START + 86400, reasons: '["link"]' });
  f.hooks.set('deleteMessage', () => false); await assert.rejects(f.moderator.handle(queued));
  assert.equal((await f.store.incident(`${GROUP}:message:2`)).status, 'planned');
  f.hooks.delete('deleteMessage'); assert.equal((await f.moderator.handle(queued)).status, 'before_warning');
  assert.equal((await f.store.incident(`${GROUP}:message:2`)).status, 'cancelled');
  assert.equal(f.callsOf('banChatMember').length, 0); assert.equal((await f.state()).strikes, 0);
});
