import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.js';
import { applySchema } from '../src/store.js';
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
