import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.js';
import { applySchema, createStore } from '../src/store.js';
import { createModerator } from '../src/moderator.js';
import { TelegramError } from '../src/telegram.js';

const GROUP = -1001001;
const OTHER_GROUP = -1001002;
const LINKED_CHANNEL = -1002001;
const BOT_ID = 900;
const USER_ID = 101;
const ADMIN_ID = 102;
const START = Date.UTC(2026, 9, 21, 12) / 1000;

class FakeTelegram {
  constructor() {
    this.calls = [];
    this.members = new Map();
    this.chats = new Map();
    this.hooks = new Map();
    this.nextMessage = 5000;
  }

  member(chatId, userId, status = 'member', extra = {}) {
    const result = { status, user: { id: userId, first_name: 'Juma', is_bot: userId === BOT_ID }, ...extra };
    this.members.set(`${chatId}:${userId}`, result);
    return result;
  }

  callsOf(method) {
    return this.calls.filter((call) => call.method === method);
  }

  async call(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    const hook = this.hooks.get(method);
    if (hook) return hook(params, this);
    switch (method) {
      case 'getMe':
        return { id: BOT_ID, is_bot: true, first_name: 'SautiLink Pilot', username: 'sautilinkpilotbot' };
      case 'getChat':
        return this.chats.get(params.chat_id) ?? {
          id: params.chat_id, type: 'supergroup', title: 'Test group', linked_chat_id: LINKED_CHANNEL,
        };
      case 'getChatMember':
        if (params.user_id === BOT_ID) {
          return { status: 'administrator', user: { id: BOT_ID, is_bot: true }, can_delete_messages: true, can_restrict_members: true };
        }
        return this.members.get(`${params.chat_id}:${params.user_id}`) ?? this.member(params.chat_id, params.user_id);
      case 'getChatAdministrators':
        return [
          { status: 'administrator', user: { id: BOT_ID, is_bot: true }, can_delete_messages: true, can_restrict_members: true },
          ...Array.from(this.members.entries()).filter(([key, member]) => key.startsWith(`${params.chat_id}:`) && ['creator', 'administrator'].includes(member.status)).map(([, member]) => member),
        ];
      case 'banChatMember':
        this.member(params.chat_id, params.user_id, 'kicked', { until_date: params.until_date ?? 0 });
        return true;
      case 'unbanChatMember':
        this.member(params.chat_id, params.user_id, 'left');
        return true;
      case 'deleteMessage':
        return true;
      case 'sendMessage':
        return { message_id: this.nextMessage++, chat: { id: params.chat_id }, text: params.text };
      default:
        throw new Error(`Unexpected Telegram method: ${method}`);
    }
  }
}

async function fixture(t) {
  const db = new TestD1();
  await applySchema(db);
  t.after(() => db.close());
  const api = new FakeTelegram();
  let now = START;
  let updateId = 1;
  let messageId = 1;
  const moderator = createModerator({ db, api, clock: () => now });
  return {
    db, api, moderator,
    now: () => now,
    advance: (seconds) => { now += seconds; },
    message(overrides = {}, type = 'message') {
      return {
        update_id: updateId++,
        [type]: {
          message_id: messageId++, date: now,
          chat: { id: GROUP, type: 'supergroup', title: 'Test group' },
          from: { id: USER_ID, is_bot: false, first_name: 'Juma' },
          text: 'Visit https://unapproved.example/offer',
          ...overrides,
        },
      };
    },
  };
}

test('first violation removes the message, bans for 24 hours, then announces it', async (t) => {
  const f = await fixture(t);
  await f.moderator.handle(f.message());
  const bans = f.api.callsOf('banChatMember');
  assert.equal(bans.length, 1);
  assert.equal(bans[0].params.user_id, USER_ID);
  assert.equal(bans[0].params.until_date, f.now() + 86400);
  const deletion = f.api.calls.findIndex(({ method }) => method === 'deleteMessage');
  const ban = f.api.calls.findIndex(({ method }) => method === 'banChatMember');
  const notice = f.api.calls.findIndex(({ method }) => method === 'sendMessage');
  assert.ok(deletion >= 0 && deletion < ban, 'offending message is removed before punishment');
  assert.ok(notice > ban, 'a ban is never announced before Telegram confirms it');
  assert.match(f.api.callsOf('sendMessage')[0].params.text, /AMEFUNGIWA/i, 'group announcements default to Swahili');
});

test('ordinary-member moderation does not depend on unrelated linked-channel metadata', async t => {
  const f = await fixture(t);
  f.api.hooks.set('getChat', () => { throw new Error('group metadata temporarily unavailable'); });
  await f.moderator.handle(f.message());
  assert.equal(f.api.callsOf('getChat').length, 0);
  assert.equal(f.api.callsOf('deleteMessage').length, 1);
  assert.equal(f.api.callsOf('banChatMember').length, 1);
});

test('channel-sent violations still use the current linked-channel identity before deleting', async t => {
  const f = await fixture(t);
  f.api.chats.set(GROUP, { id: GROUP, type: 'supergroup', linked_chat_id: LINKED_CHANNEL });
  await f.moderator.handle(f.message({ sender_chat: { id: LINKED_CHANNEL, type: 'channel' } }));
  assert.equal(f.api.callsOf('getChat').length, 1);
  assert.equal(f.api.callsOf('deleteMessage').length, 0);
});

test('repeat violations escalate to 7 days and permanent independently for each group', async (t) => {
  const f = await fixture(t);
  await f.moderator.handle(f.message());
  f.advance(2 * 86400);
  f.api.member(GROUP, USER_ID);
  await f.moderator.handle(f.message());
  const secondAt = f.now();
  f.advance(8 * 86400);
  f.api.member(GROUP, USER_ID);
  await f.moderator.handle(f.message());
  await f.moderator.handle(f.message({ chat: { id: OTHER_GROUP, type: 'supergroup' } }));
  const bans = f.api.callsOf('banChatMember');
  assert.equal(bans.length, 4);
  assert.equal(bans[1].params.until_date, secondAt + 7 * 86400);
  assert.ok(bans[2].params.until_date === 0 || bans[2].params.until_date === undefined);
  assert.equal(bans[3].params.chat_id, OTHER_GROUP);
  assert.equal(bans[3].params.until_date, f.now() + 86400);
});

test('owners and newly promoted administrators are exempt from both rules', async (t) => {
  const f = await fixture(t);
  f.api.member(GROUP, USER_ID, 'administrator');
  await f.moderator.handle(f.message({ forward_origin: { type: 'hidden_user', date: START - 1, sender_user_name: 'Someone' } }));
  f.api.member(GROUP, USER_ID, 'creator');
  await f.moderator.handle(f.message());
  assert.equal(f.api.callsOf('deleteMessage').length, 0);
  assert.equal(f.api.callsOf('banChatMember').length, 0);
});

test('anonymous administrators and the actual linked channel are exempt', async (t) => {
  const f = await fixture(t);
  await f.moderator.handle(f.message({ sender_chat: { id: GROUP, type: 'supergroup' } }));
  await f.moderator.handle(f.message({
    sender_chat: { id: LINKED_CHANNEL, type: 'channel' }, is_automatic_forward: true,
    forward_origin: { type: 'channel', date: START - 1, chat: { id: LINKED_CHANNEL, type: 'channel' }, message_id: 50 },
  }));
  assert.equal(f.api.callsOf('deleteMessage').length, 0);
  assert.equal(f.api.callsOf('banChatMember').length, 0);
});

test('approved link is allowed, but a forwarded message containing it is still moderated', async (t) => {
  const f = await fixture(t);
  await f.moderator.handle(f.message({ text: 'https://sautilink.com/news' }));
  assert.equal(f.api.callsOf('banChatMember').length, 0);
  await f.moderator.handle(f.message({
    text: 'https://sautilink.com/news',
    forward_origin: { type: 'user', date: START - 1, sender_user: { id: 200, first_name: 'Origin' } },
  }));
  assert.equal(f.api.callsOf('banChatMember').length, 1);
});

test('duplicate webhook deliveries do not apply the ban or announcement twice', async (t) => {
  const f = await fixture(t);
  const update = f.message();
  await f.moderator.handle(update);
  await f.moderator.handle(structuredClone(update));
  assert.equal(f.api.callsOf('banChatMember').length, 1);
  assert.equal(f.api.callsOf('sendMessage').length, 1);
});

test('new update IDs for an already moderated message do not add another strike', async (t) => {
  const f = await fixture(t);
  const first = f.message();
  await f.moderator.handle(first);
  f.advance(2 * 86400);
  f.api.member(GROUP, USER_ID);
  await f.moderator.handle(f.message({ ...first.message, edit_date: START }, 'edited_message'));
  assert.equal(f.api.callsOf('banChatMember').length, 1);
});

test('album items and messages already in flight during a ban count as one incident', async (t) => {
  const f = await fixture(t);
  await f.moderator.handle(f.message({ media_group_id: 'album-a' }));
  await f.moderator.handle(f.message({ media_group_id: 'album-a' }));
  await f.moderator.handle(f.message());
  assert.equal(f.api.callsOf('banChatMember').length, 1);
  f.advance(2 * 86400);
  f.api.member(GROUP, USER_ID);
  await f.moderator.handle(f.message());
  const bans = f.api.callsOf('banChatMember');
  assert.equal(bans.length, 2);
  assert.equal(bans[1].params.until_date, f.now() + 7 * 86400);
});

test('an ordinary member cannot trigger a timed ban in a legacy basic group', async (t) => {
  const f = await fixture(t);
  f.api.chats.set(GROUP, { id: GROUP, type: 'group', title: 'Legacy group' });
  await f.moderator.handle(f.message({ chat: { id: GROUP, type: 'group', title: 'Legacy group' } }));
  assert.equal(f.api.callsOf('banChatMember').length, 0);
});

test('adding a forbidden link by editing a previously clean message is moderated', async (t) => {
  const f = await fixture(t);
  const clean = f.message({ text: 'Hello everyone' });
  await f.moderator.handle(clean);
  await f.moderator.handle(f.message({
    message_id: clean.message.message_id, text: 'Now https://unapproved.example', edit_date: START + 1,
  }, 'edited_message'));
  assert.equal(f.api.callsOf('banChatMember').length, 1);
});

test('ordinary forwards from the linked channel do not impersonate its automatic posts', async (t) => {
  const f = await fixture(t);
  await f.moderator.handle(f.message({
    text: 'A normal member forwarded this',
    forward_origin: { type: 'channel', date: START - 1, chat: { id: LINKED_CHANNEL, type: 'channel' }, message_id: 50 },
  }));
  assert.equal(f.api.callsOf('banChatMember').length, 1);
});

test('posts on behalf of unrelated channels are never punished through a fake user ID', async (t) => {
  const f = await fixture(t);
  await f.moderator.handle(f.message({
    sender_chat: { id: -1009999, type: 'channel', title: 'Unrelated channel' },
    from: { id: 136817688, first_name: 'Channel', is_bot: true },
  }));
  assert.equal(f.api.callsOf('banChatMember').length, 0);
  assert.equal(f.api.callsOf('deleteMessage').length, 1);
});

test('an existing human-admin ban is not shortened or counted as a new bot offense', async (t) => {
  const f = await fixture(t);
  f.api.member(GROUP, USER_ID, 'kicked', { until_date: START + 30 * 86400 });
  await f.moderator.handle(f.message());
  assert.equal(f.api.callsOf('banChatMember').length, 0);
});

test('manual admin unban cancels replay of old messages but preserves strike history', async (t) => {
  const f = await fixture(t);
  const oldMessage = f.message();
  await f.moderator.handle(oldMessage);
  f.advance(30);
  f.api.member(GROUP, ADMIN_ID, 'administrator');
  f.api.member(GROUP, USER_ID, 'member');
  await f.moderator.handle({
    update_id: 500,
    chat_member: {
      chat: { id: GROUP, type: 'supergroup' }, date: f.now(),
      from: { id: ADMIN_ID, first_name: 'Admin' },
      old_chat_member: { status: 'kicked', until_date: START + 86400, user: { id: USER_ID, first_name: 'Juma' } },
      new_chat_member: { status: 'member', user: { id: USER_ID, first_name: 'Juma' } },
    },
  });
  await f.moderator.handle(f.message({ date: START + 1 }));
  assert.equal(f.api.callsOf('banChatMember').length, 1, 'older queued content cannot undo an admin unban');
  f.advance(1);
  await f.moderator.handle(f.message());
  const bans = f.api.callsOf('banChatMember');
  assert.equal(bans.length, 2);
  assert.equal(bans[1].params.until_date, f.now() + 7 * 86400);
});

test('a non-admin cannot forgive a member or pause moderation', async (t) => {
  const f = await fixture(t);
  await f.moderator.handle(f.message());
  await f.moderator.handle(f.message({
    from: { id: ADMIN_ID, first_name: 'Not an admin' }, text: `/forgive ${USER_ID}`,
  }));
  await f.moderator.handle(f.message({
    from: { id: ADMIN_ID, first_name: 'Not an admin' }, text: '/pause',
  }));
  f.advance(2 * 86400);
  f.api.member(GROUP, USER_ID);
  await f.moderator.handle(f.message());
  const bans = f.api.callsOf('banChatMember');
  assert.equal(bans.length, 2);
  assert.equal(bans[1].params.until_date, f.now() + 7 * 86400);
});

test('an authorized admin can forgive strikes and pause/resume this group', async (t) => {
  const f = await fixture(t);
  f.api.member(GROUP, ADMIN_ID, 'administrator');
  await f.moderator.handle(f.message());
  f.advance(2 * 86400);
  f.api.member(GROUP, USER_ID);
  const adminMessage = (text) => f.message({ from: { id: ADMIN_ID, first_name: 'Admin' }, text });
  await f.moderator.handle(adminMessage(`/forgive ${USER_ID}`));
  await f.moderator.handle(adminMessage('/pause'));
  f.advance(1);
  await f.moderator.handle(f.message());
  assert.equal(f.api.callsOf('banChatMember').length, 1);
  await f.moderator.handle(adminMessage('/resume'));
  f.advance(1);
  await f.moderator.handle(f.message());
  const bans = f.api.callsOf('banChatMember');
  assert.equal(bans.length, 2);
  assert.equal(bans[1].params.until_date, f.now() + 86400);
});

test('failure to verify administrator status defers destructive actions', async (t) => {
  const f = await fixture(t);
  f.api.hooks.set('getChatMember', () => { throw new TelegramError('Transient Telegram failure', 503, true); });
  await assert.rejects(f.moderator.handle(f.message()));
  assert.equal(f.api.callsOf('banChatMember').length, 0);
  assert.equal(f.api.callsOf('deleteMessage').length, 0);
});

test('an uncertain ban result is not falsely announced or blindly retried', async (t) => {
  const f = await fixture(t);
  f.api.hooks.set('banChatMember', (_params, self) => {
    self.hooks.delete('banChatMember');
    throw new TelegramError('Network response lost before result was known', 0, true);
  });
  const update = f.message();
  await f.moderator.handle(update);
  assert.equal(f.api.callsOf('sendMessage').length, 0);
  await f.moderator.handle(structuredClone(update));
  assert.equal(f.api.callsOf('banChatMember').length, 1);
  assert.equal(f.api.callsOf('sendMessage').length, 0);
});

test('a timeout after Telegram applied a ban never causes a second ban call', async (t) => {
  const f = await fixture(t);
  f.api.hooks.set('banChatMember', (params, self) => {
    self.member(params.chat_id, params.user_id, 'kicked', { until_date: params.until_date });
    self.hooks.delete('banChatMember');
    throw new TelegramError('Response timed out after server processed request', 0, true);
  });
  const update = f.message();
  await f.moderator.handle(update);
  assert.equal(f.api.callsOf('sendMessage').length, 0);
  await f.moderator.handle(structuredClone(update));
  assert.equal(f.api.callsOf('banChatMember').length, 1);
});

test('an ordinary member cannot hide a forbidden link inside a bot command', async (t) => {
  const f = await fixture(t);
  await f.moderator.handle(f.message({ text: '/help https://unapproved.example/spam' }));
  assert.equal(f.api.callsOf('deleteMessage').length, 1);
  assert.equal(f.api.callsOf('banChatMember').length, 1);
});

test('a forwarded bot command is still a forwarded-message violation', async (t) => {
  const f = await fixture(t);
  await f.moderator.handle(f.message({
    text: '/rules',
    forward_origin: { type: 'hidden_user', date: START - 1, sender_user_name: 'Someone' },
  }));
  assert.equal(f.api.callsOf('deleteMessage').length, 1);
  assert.equal(f.api.callsOf('banChatMember').length, 1);
});

test('a retried lost-success response reconciles one strike so the next violation gets seven days', async (t) => {
  const f = await fixture(t);
  f.api.hooks.set('banChatMember', (params, self) => {
    self.member(params.chat_id, params.user_id, 'kicked', { until_date: params.until_date });
    self.hooks.delete('banChatMember');
    throw new TelegramError('Response lost after successful ban', 0, true);
  });
  const update = f.message();
  await f.moderator.handle(update);
  await f.moderator.handle(structuredClone(update));
  assert.equal(f.api.callsOf('banChatMember').length, 1, 'reconciliation must query, not ban twice');
  f.advance(2 * 86400);
  f.api.member(GROUP, USER_ID);
  await f.moderator.handle(f.message());
  const bans = f.api.callsOf('banChatMember');
  assert.equal(bans.length, 2);
  assert.equal(bans[1].params.until_date, f.now() + 7 * 86400);
});

test('a delayed message sent during the previous ban episode does not escalate after expiry', async (t) => {
  const f = await fixture(t);
  await f.moderator.handle(f.message());
  f.advance(86405);
  f.api.member(GROUP, USER_ID, 'member');
  await f.moderator.handle(f.message({ date: START + 10 }));
  assert.equal(f.api.callsOf('banChatMember').length, 1);
});

test('a failed command acknowledgement cannot replay an unban against a later new punishment', async (t) => {
  const f = await fixture(t);
  f.api.member(GROUP, ADMIN_ID, 'administrator');
  await f.moderator.handle(f.message());
  f.advance(1);
  f.api.hooks.set('sendMessage', (_params, self) => {
    self.hooks.delete('sendMessage');
    throw new TelegramError('Acknowledgement response lost', 0, true);
  });
  const command = f.message({ from: { id: ADMIN_ID, first_name: 'Admin' }, text: `/unban ${USER_ID}` });
  await f.moderator.handle(command).catch(() => {});
  f.api.member(GROUP, USER_ID, 'member');
  f.advance(2);
  await f.moderator.handle(f.message());
  assert.equal(f.api.callsOf('banChatMember').length, 2);
  await f.moderator.handle(structuredClone(command));
  assert.equal(f.api.callsOf('unbanChatMember').length, 1);
});

test('a definite HTML or mention rejection retries a ban notice with a plain name and no formatting', async (t) => {
  const f = await fixture(t);
  f.api.hooks.set('sendMessage', (_params, self) => {
    self.hooks.delete('sendMessage');
    throw new TelegramError("Bad Request: can't parse entities", 400, false);
  });
  await f.moderator.handle(f.message({ from: { id: USER_ID, is_bot: false, first_name: '<Juma & Sana>' } }));
  const notices = f.api.callsOf('sendMessage');
  assert.equal(notices.length, 2);
  assert.equal(f.api.callsOf('banChatMember').length, 1);
  assert.equal(notices[0].params.parse_mode, 'HTML');
  assert.match(notices[0].params.text, /<a href="https:\/\/www\.sautilink\.com\/">from SautiLink Corporation<\/a>/);
  assert.ok(!notices[1].params.parse_mode, 'fallback must not repeat the formatting that Telegram rejected');
  assert.doesNotMatch(notices[1].params.text, /tg:\/\/user\?id=|<\/?(?:b|a)(?:\s|>)/);
  assert.match(notices[1].params.text, /Juma/);
  assert.match(notices[1].params.text, /SautiLink Pilot · from SautiLink Corporation \(https:\/\/www\.sautilink\.com\/\)$/);
  assert.ok(notices.every(notice => notice.params.link_preview_options.is_disabled), 'the attribution must not add a website preview');
});

test('an invalid forum topic retries the ban announcement in the main group', async (t) => {
  const f = await fixture(t);
  f.api.chats.set(GROUP, { id: GROUP, type: 'supergroup', title: 'Forum group', is_forum: true });
  f.api.hooks.set('sendMessage', (_params, self) => {
    self.hooks.delete('sendMessage');
    throw new TelegramError('Bad Request: message thread not found', 400, false);
  });
  await f.moderator.handle(f.message({ message_thread_id: 55, is_topic_message: true }));
  const notices = f.api.callsOf('sendMessage');
  assert.equal(notices.length, 2);
  assert.equal(notices[0].params.message_thread_id, 55);
  assert.equal(notices[1].params.message_thread_id, undefined);
  assert.equal(notices[1].params.chat_id, GROUP);
  assert.equal(f.api.callsOf('banChatMember').length, 1);
});

test('a rate-limited ban announcement retries delivery without repeating the confirmed ban', async (t) => {
  const f = await fixture(t);
  f.api.hooks.set('sendMessage', (_params, self) => {
    self.hooks.delete('sendMessage');
    throw new TelegramError('Too Many Requests: retry after 4', 429, false, 4);
  });
  const update = f.message();
  const result = await f.moderator.handle(update);
  assert.equal(result.status, 'notification_pending');
  assert.equal(result.retry, true, 'a definite rate-limit rejection must stay pending for Telegram retry');
  assert.equal(f.api.callsOf('sendMessage').length, 1);
  const pending = await f.db.prepare('SELECT status,retry_at,telegram_message_id FROM notification_delivery WHERE incident_id=?')
    .bind(`${GROUP}:message:${update.message.message_id}`).first();
  assert.equal(pending.status, 'pending');
  assert.equal(pending.retry_at, f.now() + 4);
  assert.equal(pending.telegram_message_id, null);
  assert.equal((await f.moderator.handle(structuredClone(update))).retry, true);
  assert.equal(f.api.callsOf('sendMessage').length, 1, 'early retries must respect Telegram retry_after');
  f.advance(5);
  await f.moderator.handle(structuredClone(update));
  assert.equal(f.api.callsOf('sendMessage').length, 2);
  assert.equal(f.api.callsOf('banChatMember').length, 1);
  const strikes = await f.db.prepare('SELECT strikes FROM members WHERE chat_id=? AND user_id=?')
    .bind(String(GROUP), String(USER_ID)).first('strikes');
  assert.equal(strikes, 1, 'notification retry must not increment the member offense count');
  await f.moderator.handle(structuredClone(update));
  assert.equal(f.api.callsOf('sendMessage').length, 2);
});

test('an ambiguous announcement timeout never triggers an automatic duplicate announcement', async (t) => {
  const f = await fixture(t);
  f.api.hooks.set('sendMessage', (_params, self) => {
    self.hooks.delete('sendMessage');
    throw new TelegramError('Announcement response was lost after dispatch', 0, true);
  });
  const update = f.message();
  await f.moderator.handle(update);
  await f.moderator.handle(structuredClone(update));
  await f.moderator.handle({ ...structuredClone(update), update_id: 1000 });
  assert.equal(f.api.callsOf('sendMessage').length, 1);
  assert.equal(f.api.callsOf('banChatMember').length, 1);
  const delivery = await f.db.prepare('SELECT status,telegram_message_id FROM notification_delivery WHERE incident_id=?')
    .bind(`${GROUP}:message:${update.message.message_id}`).first();
  assert.equal(delivery.status, 'unknown', 'a lost response is neither confirmed delivery nor confirmed rejection');
  assert.equal(delivery.telegram_message_id, null);
});

test('a ban announcement becomes sent only after Telegram returns its message ID', async (t) => {
  const f = await fixture(t);
  const update = f.message({ from: { id: USER_ID, is_bot: false, first_name: '<Juma & Sana>' } });
  const incidentId = `${GROUP}:message:${update.message.message_id}`;
  let observedDuringSend;
  f.api.hooks.set('sendMessage', async (params) => {
    observedDuringSend = await f.db.prepare('SELECT status,telegram_message_id FROM notification_delivery WHERE incident_id=?')
      .bind(incidentId).first();
    return { message_id: 7001, chat: { id: params.chat_id }, text: params.text };
  });
  await f.moderator.handle(update);
  assert.equal(observedDuringSend.status, 'sending', 'claiming delivery must not mark the notice as sent');
  assert.equal(observedDuringSend.telegram_message_id, null);
  const delivered = await f.db.prepare('SELECT status,telegram_message_id FROM notification_delivery WHERE incident_id=?')
    .bind(incidentId).first();
  assert.equal(delivered.status, 'sent');
  assert.equal(delivered.telegram_message_id, 7001);
  const notice = f.api.callsOf('sendMessage')[0].params;
  assert.doesNotMatch(notice.text, /tg:\/\/user\?id=/, 'a kicked user must not require a Telegram mention that may be unavailable');
  assert.match(notice.text, /&lt;Juma &amp; Sana&gt;/);
  assert.match(notice.text, /101/);
});

test('a confirmed ban still announces when its post-ban member lookup transiently fails', async (t) => {
  const f = await fixture(t);
  f.api.hooks.set('banChatMember', (params, self) => {
    self.member(params.chat_id, params.user_id, 'kicked', { until_date: params.until_date });
    self.hooks.delete('banChatMember');
    self.hooks.set('getChatMember', () => {
      self.hooks.delete('getChatMember');
      throw new TelegramError('Telegram member lookup temporarily unavailable', 503, true);
    });
    return true;
  });
  const update = f.message();
  await f.moderator.handle(update);
  assert.equal(f.api.callsOf('banChatMember').length, 1);
  assert.equal(f.api.callsOf('sendMessage').length, 1, 'the accepted ban must not silently lose its announcement');
  const delivery = await f.db.prepare('SELECT status FROM notification_delivery WHERE incident_id=?')
    .bind(`${GROUP}:message:${update.message.message_id}`).first();
  assert.equal(delivery.status, 'sent');
  await f.moderator.handle(structuredClone(update));
  assert.equal(f.api.callsOf('banChatMember').length, 1);
  assert.equal(f.api.callsOf('sendMessage').length, 1);
});

test('an observed immediate admin unban suppresses an outdated continuing-ban announcement', async (t) => {
  const f = await fixture(t);
  f.api.hooks.set('banChatMember', (params, self) => {
    // Telegram accepted the ban, then a human immediately lifted it before
    // the bot's post-success read could announce that it was still active.
    self.member(params.chat_id, params.user_id, 'left');
    self.hooks.delete('banChatMember');
    return true;
  });
  const update = f.message();
  await f.moderator.handle(update);
  assert.equal(f.api.callsOf('banChatMember').length, 1);
  assert.equal(f.api.callsOf('sendMessage').length, 0);
  await f.moderator.handle(structuredClone(update));
  assert.equal(f.api.callsOf('banChatMember').length, 1, 'replaying the update must respect the human override');
  assert.equal(f.api.callsOf('sendMessage').length, 0);
});

test('a rejected ban announcement remains failed and changes admin status without exposing raw provider errors', async (t) => {
  const f = await fixture(t);
  f.api.member(GROUP, ADMIN_ID, 'administrator');
  const statusCommand = () => f.message({ from: { id: ADMIN_ID, is_bot: false, first_name: 'Admin' }, text: '/status' });
  await f.moderator.handle(statusCommand());
  const before = f.api.callsOf('sendMessage').findLast(({ params }) => params.chat_id === ADMIN_ID)?.params.text;
  assert.ok(before, 'verified admin diagnostics should be sent privately');
  const rawProviderError = 'RAW_PROVIDER_RESPONSE_TOKEN_SHOULD_NEVER_APPEAR';
  f.api.hooks.set('sendMessage', () => {
    throw new TelegramError(`Bad Request: ${rawProviderError}`, 400, false);
  });
  const update = f.message();
  await f.moderator.handle(update);
  const delivery = await f.db.prepare('SELECT status,error_kind,telegram_message_id FROM notification_delivery WHERE incident_id=?')
    .bind(`${GROUP}:message:${update.message.message_id}`).first();
  assert.equal(delivery.status, 'failed');
  assert.equal(delivery.telegram_message_id, null);
  assert.ok(delivery.error_kind, 'failed delivery needs a useful sanitized category');
  assert.ok(!delivery.error_kind.includes(rawProviderError), 'raw Telegram errors must not enter stored diagnostics');
  const attempted = f.api.callsOf('sendMessage').length;
  await f.moderator.handle(structuredClone(update));
  assert.equal(f.api.callsOf('sendMessage').length, attempted, 'permanent rejection must not create endless webhook sends');
  assert.equal(f.api.callsOf('banChatMember').length, 1);
  f.api.hooks.delete('sendMessage');
  const statusCallStart = f.api.calls.length;
  await f.moderator.handle(statusCommand());
  const after = f.api.callsOf('sendMessage').findLast(({ params }) => params.chat_id === ADMIN_ID)?.params.text;
  assert.ok(after, 'updated diagnostic details should be sent privately');
  assert.match(after, /Matangazo/);
  assert.notEqual(after, before, 'admin status must reflect the announcement delivery failure');
  assert.ok(!after.includes(rawProviderError), 'admin diagnostics must not echo raw provider errors');
  const publicMessages = f.api.calls.slice(statusCallStart).filter(({ method, params }) => method === 'sendMessage' && params.chat_id === GROUP);
  assert.ok(publicMessages.every(({ params }) => !/Matangazo/.test(params.text)), 'ordinary group members must not receive the admin delivery report');
});

test('an admin unban cancels a pending rate-limited announcement before its due retry', async (t) => {
  const f = await fixture(t);
  f.api.hooks.set('sendMessage', (_params, self) => {
    self.hooks.delete('sendMessage');
    throw new TelegramError('Too Many Requests: retry after 4', 429, false, 4);
  });
  const update = f.message();
  assert.equal((await f.moderator.handle(update)).retry, true);
  f.advance(1);
  f.api.member(GROUP, ADMIN_ID, 'administrator');
  f.api.member(GROUP, USER_ID, 'left');
  await f.moderator.handle({
    update_id: 500,
    chat_member: {
      chat: { id: GROUP, type: 'supergroup' }, date: f.now(),
      from: { id: ADMIN_ID, first_name: 'Admin' },
      old_chat_member: { status: 'kicked', until_date: START + 86400, user: { id: USER_ID, first_name: 'Juma' } },
      new_chat_member: { status: 'left', user: { id: USER_ID, first_name: 'Juma' } },
    },
  });
  f.advance(5);
  await f.moderator.handle(structuredClone(update));
  assert.equal(f.api.callsOf('banChatMember').length, 1, 'a delivery retry must never reapply the lifted ban');
  assert.equal(f.api.callsOf('sendMessage').length, 1, 'an outdated continuing-ban notice must not be delivered after an admin override');
});

test('a group configured for English receives its ban announcement entirely in English', async (t) => {
  const f = await fixture(t);
  await createStore(f.db).setLanguage('group', GROUP, 'en', f.now());
  await f.moderator.handle(f.message());
  const notice = f.api.callsOf('sendMessage')[0].params;
  assert.match(notice.text, /MEMBER BANNED/);
  assert.match(notice.text, /Reason/);
  assert.match(notice.text, /link/i);
  assert.match(notice.text, /24 hours/);
  assert.doesNotMatch(notice.text, /AMEFUNGIWA|\bAdhabu\b|\bSababu\b|\bKosa\b|\bUjumbe\b|\bMwisho\b/i);
  assert.doesNotMatch(notice.text, /tg:\/\/user\?id=/);
  assert.equal(f.api.callsOf('banChatMember').length, 1);
});

test('broadcast discovery includes quiet and paused groups, while removal events defeat older queued messages', async t => {
  const f = await fixture(t);
  const store = createStore(f.db);
  await store.group(GROUP);
  await store.run('UPDATE groups SET enabled=0 WHERE chat_id=?', String(GROUP));
  const earlier = f.message({ text: 'Hello from a paused group' });
  await f.moderator.handle(earlier);
  assert.equal((await f.db.prepare('SELECT status FROM pilot_broadcast_groups WHERE chat_id=?').bind(String(GROUP)).first()).status, 'unknown');
  f.advance(10);
  await f.moderator.handle({ update_id: 901, my_chat_member: {
    chat: { id: GROUP, type: 'supergroup' }, date: f.now(), from: { id: ADMIN_ID },
    old_chat_member: { status: 'administrator', user: { id: BOT_ID } },
    new_chat_member: { status: 'left', user: { id: BOT_ID } },
  } });
  await f.moderator.handle({ ...earlier, update_id: 902, message: { ...earlier.message, message_id: 902 } });
  assert.equal((await f.db.prepare('SELECT status FROM pilot_broadcast_groups WHERE chat_id=?').bind(String(GROUP)).first()).status, 'disconnected');
  assert.equal((await store.group(GROUP)).enabled, 0, 'connection discovery never resumes moderation');
  assert.equal(f.api.callsOf('sendMessage').length, 0);
});

test('broadcast discovery follows group migration but does not target private chats or channels', async t => {
  const f = await fixture(t);
  await f.moderator.handle(f.message({ text: undefined, migrate_to_chat_id: OTHER_GROUP }));
  const rows = (await f.db.prepare('SELECT chat_id,status FROM pilot_broadcast_groups ORDER BY chat_id').all()).results;
  assert.deepEqual(rows, [{ chat_id: String(GROUP), status: 'disconnected' }, { chat_id: String(OTHER_GROUP), status: 'unknown' }]);
  await f.moderator.handle(f.message({ text: 'Hello', chat: { id: USER_ID, type: 'private' } }));
  await f.moderator.handle(f.message({ text: 'Channel update', chat: { id: LINKED_CHANNEL, type: 'channel' } }));
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM pilot_broadcast_groups').first()).n, 2);
});
