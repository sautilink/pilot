import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.js';
import { applySchema, createStore } from '../src/store.js';
import { createBotExperience } from '../src/commands.js';
import { TelegramError } from '../src/telegram.js';
import {
  renderBotPage, PUBLIC_COMMANDS, ADMIN_COMMANDS, getPublicCommands,
  getGroupCommands, getAdminCommands, getBotDescription, getBotShortDescription,
} from '../src/bot-ui.js';

const GROUP = -1001001, OTHER_GROUP = -1001002, ADMIN = 102, USER = 101, TARGET = 103, BOT = 900;
const NOW = 1792584000;
const identity = { id: BOT, is_bot: true, first_name: 'SautiLink Pilot', username: 'sautilinkpilotbot' };
const sensitive = /\/(?:status|strikes|forgive|unban|pause|resume|testnotice)\b|BOT_TOKEN|webhook|workers\.dev|\/setup|D1|Durable Object/i;

class FakeTelegram {
  constructor() {
    this.calls = [];
    this.members = new Map();
    this.hooks = new Map();
    this.nextMessage = 1000;
  }
  member(chat, user, status = 'member') {
    this.members.set(`${chat}:${user}`, { status, user: { id: user, is_bot: false } });
  }
  callsOf(method) { return this.calls.filter(call => call.method === method); }
  async call(method, params = {}) {
    this.calls.push({ method, params: structuredClone(params) });
    if (this.hooks.has(method)) return this.hooks.get(method)(params, this);
    if (method === 'getMe') return identity;
    if (method === 'getChatMember') {
      if (params.user_id === BOT) return { status: 'administrator', can_delete_messages: true, can_restrict_members: true };
      return this.members.get(`${params.chat_id}:${params.user_id}`) || { status: 'member' };
    }
    if (method === 'getChat') return { id: params.chat_id, type: 'supergroup', title: 'Private <group>' };
    if (method === 'sendMessage' || method === 'editMessageText') return { message_id: this.nextMessage++, chat: { id: params.chat_id }, text: params.text };
    if (method === 'answerCallbackQuery' || method === 'unbanChatMember') return true;
    throw new Error(`Unexpected Telegram method: ${method}`);
  }
}

async function fixture(t) {
  const db = new TestD1();
  t.after(() => db.close());
  await applySchema(db);
  const store = createStore(db), api = new FakeTelegram();
  api.member(GROUP, ADMIN, 'administrator');
  const experience = createBotExperience({ db, store, api, clock: () => NOW });
  let id = 1;
  return {
    db, store, api, experience,
    command(message, updateId = id++) { return experience.handleCommand(message, updateId); },
    callback(query, updateId = id++) { return experience.handleCallback(query, updateId); },
  };
}

function privateMessage(text, user = USER, extra = {}) {
  return { message_id: 1, date: NOW, chat: { id: user, type: 'private' }, from: { id: user, first_name: 'Juma', is_bot: false }, text, ...extra };
}
function groupMessage(text, user = ADMIN, extra = {}) {
  return { message_id: 2, date: NOW, chat: { id: GROUP, type: 'supergroup', title: 'Private <group>' }, from: { id: user, first_name: 'Asha', is_bot: false }, text, ...extra };
}
function callback(data, user = USER, extra = {}) {
  return { id: 'callback-1', data, from: { id: user, first_name: 'Juma' }, message: { message_id: 55, date: NOW, chat: { id: user, type: 'private' }, from: identity }, ...extra };
}
const sent = f => f.api.callsOf('sendMessage');

test('private start is a welcoming menu without administrative command or infrastructure dumps', async t => {
  const f = await fixture(t);
  await f.command(privateMessage('/start', USER, { from: { id: USER, first_name: '<Juma & Co>' } }));
  const reply = sent(f)[0].params;
  assert.match(reply.text, /Karibu SautiLink Pilot/);
  assert.match(reply.text, /&lt;Juma &amp; Co&gt;/);
  assert.doesNotMatch(reply.text, sensitive);
  const callbacks = reply.reply_markup.inline_keyboard.flat().map(button => button.callback_data);
  for (const page of ['about', 'how', 'rules', 'connect', 'help', 'developer', 'admin', 'language']) assert.ok(callbacks.includes(`pilot:${page}`));
  assert.equal(f.api.callsOf('getChatMember').length, 0);
});

test('each public command has a useful private page in both languages', async t => {
  const f = await fixture(t);
  const commands = { about: 'about', howitworks: 'how', rules: 'rules', connect: 'connect', developer: 'developer', help: 'help', language: 'language' };
  for (const language of ['sw', 'en']) {
    await f.store.setLanguage('user', USER, language, NOW);
    for (const [command, page] of Object.entries(commands)) {
      await f.command(privateMessage(`/${command}`));
      const reply = sent(f).at(-1).params;
      assert.equal(reply.text, renderBotPage(page, { language, username: identity.username, firstName: 'Juma' }).text);
      assert.doesNotMatch(reply.text, sensitive);
      assert.ok(reply.reply_markup.inline_keyboard.length > 0);
    }
  }
  assert.equal(f.api.callsOf('getChatMember').length, 0);
});

test('allowlisted public start payloads open their pages without reading internal group data', async t => {
  const f = await fixture(t);
  const payloads = { home: 'home', about: 'about', how: 'how', howitworks: 'how', rules: 'rules', connect: 'connect', developer: 'developer', help: 'help', language: 'language' };
  await f.store.setAdminContext(USER, GROUP, NOW);
  for (const language of ['sw', 'en']) {
    await f.store.setLanguage('user', USER, language, NOW);
    for (const [payload, page] of Object.entries(payloads)) {
      await f.command(privateMessage(`/start ${payload}`));
      assert.equal(sent(f).at(-1).params.text, renderBotPage(page, { language, username: identity.username, firstName: 'Juma' }).text);
      assert.doesNotMatch(sent(f).at(-1).params.text, sensitive);
    }
  }
  assert.equal(f.api.callsOf('getChatMember').length, 0);
  assert.equal(f.api.callsOf('getChat').length, 0);
});

test('invalid start payloads fall back safely and malformed manage payloads cannot access group data', async t => {
  const f = await fixture(t);
  for (const payload of ['status', 'admin', '__proto__', 'rules extra', '../status', 'manage']) {
    await f.command(privateMessage(`/start ${payload}`));
    assert.match(sent(f).at(-1).params.text, /Karibu SautiLink Pilot/);
    assert.doesNotMatch(sent(f).at(-1).params.text, sensitive);
  }
  for (const payload of ['manage_0', 'manage_foo', 'manage_900', 'manage_-1001/../status', 'manage_-9007199254740992']) {
    await f.command(privateMessage(`/start ${payload}`));
    assert.doesNotMatch(sent(f).at(-1).params.text, sensitive);
    assert.doesNotMatch(sent(f).at(-1).params.text, /Private|Moderation:|Matangazo:/);
  }
  assert.equal(f.api.callsOf('getChatMember').length, 0);
  assert.equal(f.api.callsOf('getChat').length, 0);
  assert.equal(await f.store.adminContext(USER), null);
  await f.command(groupMessage('/start rules', USER));
  assert.ok(sent(f).at(-1).params.text.length < 200);
});

test('group public commands are brief private pointers, and rules contain no admin command list', async t => {
  const f = await fixture(t);
  for (const command of ['start', 'help', 'about', 'howitworks', 'connect', 'developer']) {
    await f.command(groupMessage(`/${command}`, USER));
    const reply = sent(f).at(-1).params;
    assert.equal(reply.chat_id, GROUP);
    assert.ok(reply.text.length < 200);
    assert.doesNotMatch(reply.text, sensitive);
    assert.match(reply.reply_markup.inline_keyboard[0][0].url, /^https:\/\/t\.me\/sautilinkpilotbot\?start=home$/);
  }
  await f.command(groupMessage('/rules', USER));
  assert.match(sent(f).at(-1).params.text, /Kosa 1/);
  assert.doesNotMatch(sent(f).at(-1).params.text, sensitive);
  assert.equal(f.api.callsOf('getChatMember').length, 0);
});

test('a forged manage link cannot read the group title or save an admin selection', async t => {
  const f = await fixture(t);
  await f.command(privateMessage(`/start manage_${GROUP}`));
  assert.deepEqual(f.api.callsOf('getChatMember')[0].params, { chat_id: GROUP, user_id: USER });
  assert.equal(f.api.callsOf('getChat').length, 0);
  assert.equal(await f.store.adminContext(USER), null);
  assert.equal(await f.store.first('SELECT COUNT(*) AS count FROM groups').then(row => row.count), 0);
  assert.doesNotMatch(sent(f)[0].params.text, /Private|Moderation|Matangazo/);
  assert.doesNotMatch(sent(f)[0].params.text, sensitive);
});

test('a valid manage link verifies the actual user before reading a group title or saving context', async t => {
  const f = await fixture(t);
  await f.command(privateMessage(`/start manage_${GROUP}`, ADMIN));
  const check = f.api.calls.findIndex(call => call.method === 'getChatMember');
  const title = f.api.calls.findIndex(call => call.method === 'getChat');
  assert.ok(check >= 0 && title > check);
  assert.equal((await f.store.adminContext(ADMIN)).chat_id, String(GROUP));
  assert.equal(await f.store.adminContext(USER), null);
  assert.match(sent(f)[0].params.text, /Private &lt;group&gt;/);
  assert.match(sent(f)[0].params.text, /\/strikes USER_ID/);
  assert.match(sent(f)[0].params.text, /\/language sw/);
  assert.match(sent(f)[0].params.text, /\/language en/);
});

test('revoked admins cannot read status or strikes from a saved private context', async t => {
  const f = await fixture(t);
  f.api.member(GROUP, ADMIN, 'member');
  for (const command of ['/status', `/strikes ${TARGET}`]) {
    await f.store.setAdminContext(ADMIN, GROUP, NOW);
    await f.command(privateMessage(command, ADMIN));
    assert.equal(await f.store.adminContext(ADMIN), null);
    assert.doesNotMatch(sent(f).at(-1).params.text, /Private|Moderation:|Matangazo:|makosa \d/);
  }
  assert.equal(f.api.callsOf('getChat').length, 0);
  assert.equal((await f.store.first('SELECT COUNT(*) AS count FROM members')).count, 0);
});

test('a failed fresh admin lookup exposes no private data and does not destroy a potentially valid selection', async t => {
  const f = await fixture(t);
  await f.store.setAdminContext(ADMIN, GROUP, NOW);
  f.api.hooks.set('getChatMember', () => { throw new TelegramError('upstream secret', 503, true); });
  await f.command(privateMessage('/status', ADMIN));
  assert.equal(f.api.callsOf('getChat').length, 0);
  assert.ok(await f.store.adminContext(ADMIN));
  assert.doesNotMatch(sent(f)[0].params.text, /Private|secret|Moderation:/);
});

test('group status goes privately in the admin’s language and includes only sanitized notification status', async t => {
  const f = await fixture(t);
  await f.store.setLanguage('user', ADMIN, 'en', NOW);
  await f.store.plan({ id: 'incident', chat_id: GROUP, user_id: TARGET, message_id: 88, event_at: NOW, created_at: NOW, strike: 1, until_date: NOW + 86400, reasons: '["link"]' });
  await f.store.noticeRecord('incident', NOW);
  await f.store.noticeState('incident', 'failed', NOW, { errorKind: 'raw-secret-token-value' });
  await f.command(groupMessage('/status'));
  const replies = sent(f);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].params.chat_id, ADMIN);
  assert.match(replies[0].params.text, /Group status/);
  assert.match(replies[0].params.text, /<b>Group language:<\/b> Kiswahili/);
  assert.match(replies[0].params.text, /Announcements:.*latest announcement was not sent/s);
  assert.doesNotMatch(replies[0].params.text, /raw-secret|incident|worker|token/i);
  assert.equal((await f.store.adminContext(ADMIN)).chat_id, String(GROUP));
  const memberChecks = f.api.callsOf('getChatMember');
  assert.equal(memberChecks[0].params.user_id, ADMIN);
});

test('a blocked DM never causes group diagnostics or raw errors to be posted publicly', async t => {
  const f = await fixture(t);
  f.api.hooks.set('sendMessage', params => {
    if (params.chat_id > 0) throw new TelegramError('forbidden sensitive-token', 403, false);
    return { message_id: 123 };
  });
  await f.command(groupMessage('/status'));
  const groupReplies = sent(f).filter(call => call.params.chat_id === GROUP);
  assert.equal(groupReplies.length, 1);
  assert.doesNotMatch(groupReplies[0].params.text, /Private|Moderation|Matangazo|sensitive|Ruhusa|ID:/);
  assert.match(groupReplies[0].params.reply_markup.inline_keyboard[0][0].url, new RegExp(`manage_${GROUP}$`));
});

test('all announcer error kinds have safe meaningful summaries in both languages', async t => {
  const f = await fixture(t);
  await f.store.plan({ id: 'notice-summary', chat_id: GROUP, user_id: TARGET, message_id: 88, event_at: NOW, created_at: NOW, strike: 1, until_date: NOW + 86400, reasons: '["link"]' });
  await f.store.noticeRecord('notice-summary', NOW);
  const summaries = {
    send_permission: [/Kagua ruhusa/, /permission to send/],
    topic_unavailable: [/Mada ya group/, /group topic/],
    message_rejected: [/haikukubali ujumbe/, /rejected the announcement message/],
    delivery_unknown: [/Kufika kwa tangazo/, /Delivery has not been confirmed/],
    telegram_rejected: [/haikukubali ombi/, /rejected the request/],
    rate_limit: [/imeomba kusubiri/, /requested a delay/],
    admin_override: [/Admin amebadili/, /An admin changed/],
    membership_changed: [/Hali ya mtumiaji imebadilika/, /member’s status changed/],
  };
  for (const [language, index] of [['sw', 0], ['en', 1]]) {
    await f.store.setLanguage('user', ADMIN, language, NOW);
    for (const [kind, expected] of Object.entries(summaries)) {
      await f.store.noticeState('notice-summary', 'failed', NOW, { errorKind: kind });
      await f.command(groupMessage('/status'));
      assert.match(sent(f).at(-1).params.text, expected[index]);
      assert.ok(!sent(f).at(-1).params.text.includes(kind));
      assert.equal(sent(f).at(-1).params.chat_id, ADMIN);
    }
  }
});

test('ordinary members cannot get admin diagnostics or change moderation', async t => {
  const f = await fixture(t);
  for (const command of ['/admin', '/status', '/pause', `/strikes ${TARGET}`, `/unban ${TARGET}`]) await f.command(groupMessage(command, USER));
  assert.equal(f.api.callsOf('getChat').length, 0);
  assert.equal(f.api.callsOf('unbanChatMember').length, 0);
  assert.equal((await f.store.first('SELECT COUNT(*) AS count FROM groups')).count, 0);
  for (const reply of sent(f)) {
    assert.equal(reply.params.chat_id, GROUP);
    assert.doesNotMatch(reply.params.text, sensitive);
  }
});

test('anonymous group admins may act but receive only a generic group link, never a fake-user DM', async t => {
  const f = await fixture(t);
  const extra = { sender_chat: { id: GROUP, type: 'supergroup' }, from: { id: 1087968824, is_bot: true, first_name: 'GroupAnonymousBot' } };
  await f.command(groupMessage('/status', ADMIN, extra));
  await f.command(groupMessage('/pause', ADMIN, extra));
  assert.equal((await f.store.group(GROUP)).enabled, 0);
  assert.equal(f.api.callsOf('getChatMember').length, 0);
  for (const reply of sent(f)) {
    assert.equal(reply.params.chat_id, GROUP);
    assert.doesNotMatch(reply.params.text, sensitive);
    assert.doesNotMatch(reply.params.text, /Moderation|imesitishwa|Private/);
  }
});

test('a channel sender cannot borrow a real admin user id for commands', async t => {
  const f = await fixture(t);
  await f.command(groupMessage('/pause', ADMIN, { sender_chat: { id: -1009000, type: 'channel' } }));
  assert.equal((await f.store.group(GROUP)).enabled, 1);
  assert.equal(f.api.callsOf('getChatMember').length, 0);
  assert.equal(sent(f)[0].params.chat_id, GROUP);
});

test('unban is claimed before Telegram and is never blindly repeated after an ambiguous failure', async t => {
  const f = await fixture(t);
  f.api.hooks.set('unbanChatMember', async params => {
    assert.ok(await f.store.seen(77));
    assert.equal(params.only_if_banned, true);
    throw new TelegramError('private secret error', 503, true);
  });
  const message = groupMessage(`/unban ${TARGET}`);
  await f.command(message, 77);
  await f.command(message, 77);
  assert.equal(f.api.callsOf('unbanChatMember').length, 1);
  assert.equal(sent(f).length, 1);
  assert.equal(sent(f)[0].params.chat_id, ADMIN);
  assert.doesNotMatch(sent(f)[0].params.text, /secret/);
});

test('forgive stays scoped to its group, while pause and resume atomically mark their updates', async t => {
  const f = await fixture(t);
  await f.store.member(GROUP, TARGET);
  await f.store.member(OTHER_GROUP, TARGET);
  await f.store.run('UPDATE members SET strikes=2');
  await f.command(groupMessage(`/forgive ${TARGET}`), 81);
  assert.equal((await f.store.member(GROUP, TARGET)).strikes, 0);
  assert.equal((await f.store.member(OTHER_GROUP, TARGET)).strikes, 2);
  assert.ok(await f.store.seen(81));
  await f.command(groupMessage('/pause'), 82);
  assert.equal((await f.store.group(GROUP)).enabled, 0);
  assert.ok(await f.store.seen(82));
  await f.command(groupMessage('/resume'), 83);
  assert.equal((await f.store.group(GROUP)).enabled, 1);
  assert.equal((await f.store.group(GROUP)).activated_at, NOW);
  assert.ok(await f.store.seen(83));
  assert.ok(sent(f).every(call => call.params.chat_id === ADMIN));
});

test('private admin panel stays read-only even when the selected admin requests group mutations', async t => {
  const f = await fixture(t);
  await f.store.setAdminContext(ADMIN, GROUP, NOW);
  await f.store.member(GROUP, TARGET);
  await f.store.run('UPDATE members SET strikes=2');
  for (const command of ['/pause', '/resume', `/forgive ${TARGET}`, `/unban ${TARGET}`, '/testnotice']) await f.command(privateMessage(command, ADMIN));
  assert.equal((await f.store.member(GROUP, TARGET)).strikes, 2);
  assert.equal((await f.store.group(GROUP)).enabled, 1);
  assert.equal(f.api.callsOf('unbanChatMember').length, 0);
  assert.ok(sent(f).every(call => call.params.chat_id === ADMIN && /ndani ya group/.test(call.params.text)));
  assert.equal(f.api.callsOf('getChatMember').filter(call => call.params.user_id === ADMIN).length, 5);
});

test('testnotice sends one clearly labelled group demo, no punishment, and a private localized result', async t => {
  const f = await fixture(t);
  await f.store.setLanguage('user', ADMIN, 'en', NOW);
  await f.store.member(GROUP, TARGET);
  await f.store.run('UPDATE members SET strikes=2');
  const message = groupMessage('/testnotice');
  await f.command(message, 90);
  await f.command(message, 90);
  const groupReplies = sent(f).filter(call => call.params.chat_id === GROUP);
  assert.equal(groupReplies.length, 1);
  assert.match(groupReplies[0].params.text, /TANGAZO LA MAJARIBIO/);
  assert.match(sent(f).at(-1).params.text, /test announcement was sent/i);
  assert.equal(sent(f).at(-1).params.chat_id, ADMIN);
  assert.equal((await f.store.member(GROUP, TARGET)).strikes, 2);
  assert.equal(f.api.callsOf('banChatMember').length, 0);
  assert.equal(f.api.callsOf('deleteMessage').length, 0);
});

test('private callback navigation acknowledges promptly, edits in place, and supports every page in both languages', async t => {
  const f = await fixture(t);
  await f.store.setAdminContext(ADMIN, GROUP, NOW);
  for (const language of ['sw', 'en']) {
    await f.store.setLanguage('user', ADMIN, language, NOW);
    for (const page of ['home', 'about', 'how', 'rules', 'connect', 'developer', 'help', 'admin', 'status', 'language']) {
      const start = f.api.calls.length;
      assert.equal(await f.callback(callback(`pilot:${page}`, ADMIN)), true);
      assert.equal(f.api.calls[start].method, 'answerCallbackQuery');
      const edit = f.api.callsOf('editMessageText').at(-1).params;
      assert.equal(edit.chat_id, ADMIN);
      assert.equal(edit.message_id, 55);
      assert.ok(edit.reply_markup.inline_keyboard.length > 0);
      assert.ok(edit.text.length < 4096);
      if (page === 'status') assert.match(edit.text, language === 'en' ? /Announcements:/ : /Matangazo:/);
    }
  }
  assert.equal(sent(f).length, 0);
});

test('callback menus refuse another user’s private chat and messages from another bot', async t => {
  const f = await fixture(t);
  await f.store.setAdminContext(ADMIN, GROUP, NOW);
  await f.callback(callback('pilot:status', ADMIN, { message: { message_id: 55, chat: { id: USER, type: 'private' }, from: identity } }));
  await f.callback(callback('pilot:status', ADMIN, { message: { message_id: 55, chat: { id: ADMIN, type: 'private' }, from: { id: 901, is_bot: true } } }));
  assert.equal(f.api.callsOf('answerCallbackQuery').length, 2);
  assert.equal(f.api.callsOf('getChatMember').length, 0);
  assert.equal(f.api.callsOf('editMessageText').length, 0);
  assert.equal(sent(f).length, 0);
});

test('old group callbacks only point to private chat and never render admin details publicly', async t => {
  const f = await fixture(t);
  await f.callback(callback('pilot:status', USER, { message: { message_id: 55, chat: { id: GROUP, type: 'supergroup' }, from: identity } }));
  assert.equal(f.api.callsOf('editMessageText').length, 0);
  assert.equal(f.api.callsOf('getChatMember').length, 0);
  assert.equal(sent(f)[0].params.chat_id, GROUP);
  assert.doesNotMatch(sent(f)[0].params.text, sensitive);
  assert.doesNotMatch(sent(f)[0].params.text, /Private|Moderation|Matangazo/);
});

test('callback edit fallback sends only after a definite rejection, never an ambiguous edit or no-op', async t => {
  for (const [error, expectedSends] of [
    [new TelegramError('message cannot be edited', 400, false), 1],
    [new TelegramError('upstream unavailable', 503, true), 0],
    [new TelegramError('message is not modified', 400, false), 0],
    [new Error('unknown network result'), 0],
  ]) {
    const f = await fixture(t);
    f.api.hooks.set('editMessageText', () => { throw error; });
    await f.callback(callback('pilot:about'));
    assert.equal(sent(f).length, expectedSends);
  }
});

test('language initially follows Telegram English, then persists the user’s explicit choice across new handlers', async t => {
  const f = await fixture(t);
  const englishFrom = { id: USER, first_name: 'Juma', language_code: 'en-GB' };
  await f.command(privateMessage('/start', USER, { from: englishFrom }));
  assert.match(sent(f).at(-1).params.text, /Welcome to SautiLink Pilot/);
  await f.callback(callback('pilot:lang:sw', USER, { from: englishFrom }));
  assert.equal(await f.store.getLanguage('user', USER, 'en'), 'sw');
  assert.equal(await f.store.getLanguage('group', GROUP), 'sw');
  const restarted = createBotExperience({ db: f.db, store: createStore(f.db), api: f.api, clock: () => NOW });
  await restarted.handleCommand(privateMessage('/start', USER, { from: englishFrom }), 800);
  assert.match(sent(f).at(-1).params.text, /Karibu SautiLink Pilot/);
  await f.callback(callback('pilot:lang:en'));
  assert.equal(await f.store.getLanguage('user', USER), 'en');
  assert.match(f.api.callsOf('editMessageText').at(-1).params.text, /Choose your language/);
});

test('direct private language commands persist only the personal preference and render the selected language immediately', async t => {
  const f = await fixture(t);
  await f.command(privateMessage('/language en'));
  assert.equal(await f.store.getLanguage('user', USER), 'en');
  assert.match(sent(f).at(-1).params.text, /Choose your language/);
  const restarted = createBotExperience({ db: f.db, store: createStore(f.db), api: f.api, clock: () => NOW });
  await restarted.handleCommand(privateMessage('/start', USER, { from: { id: USER, first_name: 'Juma', language_code: 'sw' } }), 801);
  assert.match(sent(f).at(-1).params.text, /Welcome to SautiLink Pilot/);
  await f.command(privateMessage('/language unsupported'));
  assert.equal(await f.store.getLanguage('user', USER), 'en');
  await f.command(privateMessage('/language sw'));
  assert.equal(await f.store.getLanguage('user', USER, 'en'), 'sw');
  assert.match(sent(f).at(-1).params.text, /Chagua lugha yako/);
  assert.equal((await f.store.first("SELECT COUNT(*) AS count FROM language_preferences WHERE scope='group'")).count, 0);
  assert.equal(f.api.callsOf('getChatMember').length, 0);
});

test('a private language command cannot change a preference when the chat and actual sender differ', async t => {
  const f = await fixture(t);
  await f.command(privateMessage('/language en', ADMIN, { from: { id: USER, first_name: 'Juma' } }));
  assert.equal((await f.store.first('SELECT COUNT(*) AS count FROM language_preferences')).count, 0);
  assert.equal(sent(f).length, 0);
});

test('language callbacks cannot change another private user or any group preference', async t => {
  const f = await fixture(t);
  await f.callback(callback('pilot:lang:en', USER, { message: { message_id: 55, chat: { id: ADMIN, type: 'private' }, from: identity } }));
  await f.callback(callback('pilot:lang:en', USER, { message: { message_id: 55, chat: { id: GROUP, type: 'supergroup' }, from: identity } }));
  assert.equal((await f.store.first('SELECT COUNT(*) AS count FROM language_preferences')).count, 0);
  assert.equal(f.api.callsOf('editMessageText').length, 0);
});

test('group language changes require a current admin and remain separate from personal and other-group language', async t => {
  const f = await fixture(t);
  await f.command(groupMessage('/language en', USER));
  assert.equal(await f.store.getLanguage('group', GROUP), 'sw');
  await f.command(groupMessage('/language en', ADMIN));
  assert.equal(await f.store.getLanguage('group', GROUP), 'en');
  assert.equal(await f.store.getLanguage('group', OTHER_GROUP), 'sw');
  assert.equal(await f.store.getLanguage('user', ADMIN), 'sw');
  assert.equal(sent(f).at(-1).params.chat_id, ADMIN);
  await f.command(groupMessage('/rules', USER));
  assert.match(sent(f).at(-1).params.text, /SautiLink Pilot rules/);
  f.api.member(GROUP, ADMIN, 'member');
  await f.command(groupMessage('/language sw', ADMIN));
  assert.equal(await f.store.getLanguage('group', GROUP), 'en');
  assert.match(sent(f).at(-1).params.text, /available to this group’s admins/);
});

test('command menus and bot descriptions are localized without publishing admin-only commands in public scopes', () => {
  for (const language of ['sw', 'en']) {
    const commands = getPublicCommands(language);
    assert.ok(commands.some(command => command.command === 'language'));
    assert.ok(commands.some(command => command.command === 'howitworks'));
    assert.ok(!commands.some(command => ['status', 'unban', 'forgive', 'pause', 'testnotice'].includes(command.command)));
    assert.ok(getGroupCommands(language).every(command => !['status', 'unban', 'forgive', 'admin', 'language'].includes(command.command)));
    assert.ok(getAdminCommands(language).some(command => command.command === 'testnotice'));
    assert.ok(getBotDescription(language).length <= 512);
    assert.ok(getBotShortDescription(language).length <= 120);
    for (const command of getAdminCommands(language)) assert.ok(command.description.length <= 256);
  }
  assert.deepEqual(getPublicCommands(), PUBLIC_COMMANDS);
  assert.deepEqual(getAdminCommands(), ADMIN_COMMANDS);
});

test('unrecognized commands and commands directed to another bot cause no replies or mutations', async t => {
  const f = await fixture(t);
  assert.equal(await f.command(privateMessage('/unknown')), false);
  assert.equal(await f.command(groupMessage('/pause@AnotherBot')), true);
  assert.equal(sent(f).length, 0);
  assert.equal((await f.store.first('SELECT COUNT(*) AS count FROM groups')).count, 0);
});
