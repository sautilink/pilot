import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.js';
import { applySchema, createStore } from '../src/store.js';
import { createBotExperience } from '../src/commands.js';
import { dashboardButton, getPublicCommands, getGroupCommands, getAdminCommands, renderBotPage } from '../src/bot-ui.js';
import { publicGroupRules } from '../src/templates.js';

const GROUP = -1001001, OTHER = -1001002, ADMIN = 102, USER = 101, BOT = 900, NOW = 1792670400;
const bot = { id: BOT, is_bot: true, username: 'sautilinkpilotbot' };
const privateMessage = (text, user = USER, extra = {}) => ({ message_id: 1, date: NOW, chat: { id: user, type: 'private' }, from: { id: user, first_name: '<Asha>', language_code: 'en', is_bot: false }, text, ...extra });
const groupMessage = (text, user = USER, extra = {}) => ({ message_id: 2, date: NOW, chat: { id: GROUP, type: 'supergroup', title: 'Private group' }, from: { id: user, first_name: 'Asha', is_bot: false }, text, ...extra });
const callback = (data, user = USER, extra = {}) => ({ id: 'cb', data, from: { id: user, first_name: 'Asha', language_code: 'en' }, message: { message_id: 40, chat: { id: user, type: 'private' }, from: bot }, ...extra });
const incident = (extra = {}) => ({ id: 'case-1', chat_id: String(GROUP), user_id: String(USER), event_at: NOW, created_at: NOW, strike: 1, until_date: NOW + 86400, status: 'confirmed', reasons: ['link'], corrected: false, notification: { status: 'sent' }, appeal: null, ...extra });

async function fixture(t) {
  const db = new TestD1();
  t.after(() => db.close());
  await applySchema(db);
  const store = createStore(db), calls = [], queries = [], writes = [], audits = [], remembered = [];
  const state = {
    admin: true, ownCases: [incident()],
    overview: { ok: true, group: { id: GROUP, title: 'Private <group>', type: 'supergroup' }, moderation: { enabled: true }, language: 'sw',
      settings: {}, rules: [], subscription: { alerts: true, report: 'weekly' }, incidents: [incident()], appeals: [], audit: [], stats: { today: { incidents: 3, confirmed: 2, links: 1, forwards: 2 }, week: {}, month: {} } },
  };
  const api = { async call(method, params = {}) {
    calls.push({ method, params: structuredClone(params) });
    if (method === 'getMe') return bot;
    if (method === 'getChatMember') return { status: params.user_id === ADMIN && state.admin ? 'administrator' : 'member' };
    if (method === 'getChat') return state.overview.group;
    if (method === 'answerCallbackQuery' || method === 'unbanChatMember') return true;
    if (['sendMessage', 'editMessageText'].includes(method)) return { message_id: 42, chat: { id: params.chat_id } };
    throw new Error(`Unexpected method ${method}`);
  } };
  const control = { async query(query) {
    queries.push(structuredClone(query));
    if (query.view === 'mystatus') return { ok: true, incidents: state.ownCases };
    if (query.view === 'checklink') return { ok: true, scope: { type: 'base' }, destinations: [{ value: query.input.text, allowed: true, source: 'base' }], forwardWarning: true };
    if (!state.admin || query.actor.id !== ADMIN || String(query.chatId) !== String(GROUP)) throw Object.assign(new Error('private error token'), { status: 403, code: 'not_admin' });
    return state.overview;
  }, async mutate() { throw new Error('Private bot commands must never mutate directly'); } };
  const dispatchControl = async request => {
    writes.push(structuredClone(request));
    if (request.action === 'subscribe') return { ok: true, subscription: request.input };
    return { ok: true, appeal: { id: 'appeal-1', status: 'open' } };
  };
  const controlStore = {
    async rememberAdmin(user, chat, at) { remembered.push({ user, chat, at }); },
    async audit(row) { audits.push(row); },
    async settings() { return { rules_sw: 'Karibu <b>rafiki</b> & wote', rules_en: 'Welcome <b>friend</b> & everyone' }; },
  };
  const experience = createBotExperience({ db, store, api, control, controlStore, dispatchControl, clock: () => NOW });
  let next = 100;
  return { db, store, api, control, state, calls, queries, writes, audits, remembered,
    command: (message, updateId = next++) => experience.handleCommand(message, updateId),
    callback: (query, updateId = next++) => experience.handleCallback(query, updateId),
    replies: () => calls.filter(call => call.method === 'sendMessage'),
  };
}

test('private home and dashboard launch the Mini App; groups receive only private-chat links', async t => {
  const f = await fixture(t);
  for (const command of ['/start', '/dashboard', '/start dashboard']) {
    await f.command(privateMessage(command));
    const buttons = f.replies().at(-1).params.reply_markup.inline_keyboard.flat();
    assert.ok(buttons.some(button => button.web_app?.url === 'https://pilot.sautilink.com/app?lang=en'));
  }
  for (const command of ['/dashboard', '/mystatus', '/appeal', '/checklink']) {
    await f.command(groupMessage(command));
    const reply = f.replies().at(-1).params;
    assert.equal(reply.chat_id, GROUP);
    assert.ok(reply.reply_markup.inline_keyboard.flat().every(button => !button.web_app));
    assert.ok(reply.text.length < 200);
  }
  assert.equal(f.queries.length, 0);
});

test('link checks use the shared service, escape destinations, label scope and avoid website-safety claims', async t => {
  const f = await fixture(t);
  await f.command(privateMessage('/checklink https://sautilink.com/?q=<admin>&x=1'));
  assert.deepEqual(f.queries[0], { actor: { id: USER, first_name: '<Asha>', language_code: 'en' }, view: 'checklink', input: { text: 'https://sautilink.com/?q=<admin>&x=1' } });
  const reply = f.replies().at(-1).params;
  assert.match(reply.text, /Pilot’s base rules/);
  assert.match(reply.text, /&lt;admin&gt;&amp;x=1/);
  assert.match(reply.text, /does not verify website safety/);
  assert.match(reply.text, /forwarded message still violates/);
  assert.equal(f.calls.filter(call => call.method === 'getChatMember').length, 0);
  assert.equal(f.writes.length, 0);
  await f.command(privateMessage('/checklink ' + 'a'.repeat(4097)));
  assert.equal(f.queries.length, 1);
  assert.match(f.replies().at(-1).params.text, /4,096/);
});

test('case history always queries the actual private sender and never accepts a target-user argument', async t => {
  const f = await fixture(t);
  await f.command(privateMessage(`/mystatus ${ADMIN}`));
  assert.deepEqual(f.queries[0], { actor: { id: USER, first_name: '<Asha>', language_code: 'en' }, view: 'mystatus' });
  assert.match(f.replies().at(-1).params.text, /case-1/);
  assert.match(f.replies().at(-1).params.text, /belong only to you/);
  assert.doesNotMatch(f.replies().at(-1).params.text, /Private &lt;group&gt;/);
  await f.command(privateMessage('/mystatus', ADMIN, { from: { id: USER } }));
  assert.equal(f.queries.length, 1);
});

test('appeals derive their group from the caller’s own case and dispatch a stable operation ID', async t => {
  const f = await fixture(t);
  const message = privateMessage('/appeal case-1 Please review this link.');
  await f.command(message, 701);
  await f.command(message, 701);
  assert.equal(f.writes.length, 2); // The group service owns durable idempotency.
  assert.deepEqual(f.writes[0], f.writes[1]);
  assert.deepEqual(f.writes[0], { actor: { id: USER, first_name: '<Asha>', language_code: 'en' }, chatId: String(GROUP), action: 'appeal_create', input: { incidentId: 'case-1', message: 'Please review this link.' }, requestId: `tg:701:${USER}:appeal_create` });
  assert.match(f.replies().at(-1).params.text, /Appeal saved/);
  assert.match(f.replies().at(-1).params.text, /existing ban remains/);
});

test('forged, duplicate and oversized appeals never reach a mutation', async t => {
  const f = await fixture(t);
  await f.command(privateMessage('/appeal someone-elses-case Please remove the ban'));
  assert.match(f.replies().at(-1).params.text, /not in your recent history/);
  await f.command(privateMessage('/appeal case-1 ' + 'x'.repeat(1001)));
  assert.match(f.replies().at(-1).params.text, /1,000/);
  f.state.ownCases[0].appeal = { id: 'appeal-1', status: 'open' };
  await f.command(privateMessage('/appeal case-1 Again'));
  assert.match(f.replies().at(-1).params.text, /already exists/);
  assert.equal(f.writes.length, 0);
});

test('every selected-group view calls fresh service authorization and revoked admins lose the selection', async t => {
  const f = await fixture(t);
  await f.store.setAdminContext(ADMIN, GROUP, NOW);
  for (const command of ['history', 'appeals', 'settings', 'stats', 'whitelist', 'alerts', 'report']) {
    await f.command(privateMessage('/' + command, ADMIN));
    assert.match(f.replies().at(-1).params.text, /Private &lt;group&gt;/);
    assert.equal(f.queries.at(-1).view, 'overview');
    assert.equal(f.queries.at(-1).chatId, String(GROUP));
    assert.equal(f.queries.at(-1).actor.id, ADMIN);
  }
  f.state.admin = false;
  await f.command(privateMessage('/history', ADMIN));
  assert.equal(await f.store.adminContext(ADMIN), null);
  assert.doesNotMatch(f.replies().at(-1).params.text, /Private|case-1|token/);
  assert.equal(f.writes.length, 0);
});

test('private settings show default-on command deletion and preserve the selected group’s off choice', async t => {
  const f = await fixture(t);
  await f.store.setAdminContext(ADMIN, GROUP, NOW);
  await f.command(privateMessage('/settings', ADMIN));
  assert.match(f.replies().at(-1).params.text, /Command spam · delete only: enabled/);
  assert.match(f.replies().at(-1).params.text, /no ban, mute or strike/);
  f.state.overview.settings.command_spam_enabled = false;
  await f.command(privateMessage('/settings', ADMIN));
  assert.match(f.replies().at(-1).params.text, /Command spam · delete only: disabled/);
  await f.store.setLanguage('user', ADMIN, 'sw', NOW);
  await f.command(privateMessage('/settings', ADMIN));
  assert.match(f.replies().at(-1).params.text, /Spam ya commands · futa tu: imezimwa/);
  assert.match(f.replies().at(-1).params.text, /hakuna ban, mute wala kosa/);
  assert.equal(f.writes.length, 0);
});

test('public guides distinguish silent command-code deletion from link and forward bans in both languages', () => {
  for (const language of ['sw', 'en']) {
    for (const page of ['how', 'rules', 'help']) {
      const text = renderBotPage(page, { language }).text;
      assert.match(text, language === 'en' ? /(?:no|never add a) ban, mute or strike/i : /hakuna ban, mute wala kosa|haina ban, mute wala kosa/i);
      assert.match(text, language === 'en' ? /command|code/ : /command|code/);
      assert.doesNotMatch(text, /SETUP_KEY|BOT_TOKEN|claimowner|command_spam_allowlist/);
    }
  }
});

test('welcome and join rules include command deletion only while the group filter is enabled', () => {
  for (const language of ['sw', 'en']) {
    const defaults = publicGroupRules({}, language);
    const enabled = publicGroupRules({ command_spam_enabled: true }, language);
    const disabled = publicGroupRules({ command_spam_enabled: false, [`rules_${language}`]: 'Custom note.' }, language);
    assert.equal(defaults, enabled);
    assert.match(enabled, language === 'en' ? /silently deleted.*does not add a ban, mute or strike/ : /kimya kimya.*Hakuna ban, mute wala kosa/);
    assert.doesNotMatch(disabled, /command/);
    assert.match(disabled, /24.*7/);
    assert.match(disabled, /Custom note\./);
  }
});

test('notification choices preserve the other preference and use only the selected group queue', async t => {
  const f = await fixture(t);
  await f.store.setAdminContext(ADMIN, GROUP, NOW);
  await f.command(privateMessage('/alerts off', ADMIN), 710);
  assert.deepEqual(f.writes[0].input, { alerts: false });
  assert.match(f.replies().at(-1).params.text, /Reports: weekly/);
  assert.equal(f.writes[0].chatId, GROUP);
  assert.equal(f.writes[0].requestId, `tg:710:${ADMIN}:subscribe`);
  await f.command(privateMessage('/report daily', ADMIN), 711);
  assert.deepEqual(f.writes[1].input, { report: 'daily' });
  assert.match(f.replies().at(-1).params.text, /Problem alerts: enabled/);
  for (const command of ['/alerts maybe', '/report monthly', '/alerts', '/report']) await f.command(privateMessage(command, ADMIN));
  assert.equal(f.writes.length, 2);
  await f.store.setAdminContext(ADMIN, OTHER, NOW);
  await f.command(privateMessage('/report daily', ADMIN));
  assert.equal(f.writes.length, 2);
});

test('group feature requests expose no reports and require admin verification before selecting a group', async t => {
  const f = await fixture(t);
  await f.command(groupMessage('/history', USER));
  assert.equal(await f.store.adminContext(USER), null);
  await f.command(groupMessage('/stats', ADMIN));
  assert.equal((await f.store.adminContext(ADMIN)).chat_id, String(GROUP));
  assert.equal(f.queries.length, 0);
  for (const reply of f.replies()) {
    assert.equal(reply.params.chat_id, GROUP);
    assert.doesNotMatch(reply.params.text, /case-1|Private|matukio \d/);
    assert.ok(reply.params.text.length < 200);
  }
  assert.deepEqual(f.remembered, [{ user: ADMIN, chat: GROUP, at: NOW }]);
});

test('feature callbacks acknowledge first and reject another chat or bot before reading any cases', async t => {
  const f = await fixture(t);
  await f.callback(callback('pilot:mystatus'));
  assert.equal(f.calls[0].method, 'answerCallbackQuery');
  assert.equal(f.queries.length, 1);
  assert.match(f.calls.find(call => call.method === 'editMessageText').params.text, /case-1/);
  await f.callback(callback('pilot:mystatus', USER, { message: { message_id: 40, chat: { id: ADMIN, type: 'private' }, from: bot } }));
  await f.callback(callback('pilot:history', ADMIN, { message: { message_id: 40, chat: { id: ADMIN, type: 'private' }, from: { id: 901 } } }));
  await f.callback(callback('pilot:mystatus', USER, { message: { message_id: 40, chat: { id: GROUP, type: 'supergroup' }, from: bot } }));
  assert.equal(f.queries.length, 1);
});

test('custom group rules are public plain text, escaped safely, in the group’s own language', async t => {
  const f = await fixture(t);
  await f.command(groupMessage('/rules'));
  assert.match(f.replies().at(-1).params.text, /Sheria za ziada/);
  assert.match(f.replies().at(-1).params.text, /&lt;b&gt;rafiki&lt;\/b&gt; &amp; wote/);
  await f.store.setLanguage('group', GROUP, 'en', NOW);
  await f.command(groupMessage('/rules'));
  assert.match(f.replies().at(-1).params.text, /Additional group rules/);
  assert.match(f.replies().at(-1).params.text, /&lt;b&gt;friend/);
  assert.equal(f.queries.length, 0);
});

test('admin discovery follows verified roles; audit attributes anonymous actions to no fake user', async t => {
  const f = await fixture(t);
  await f.command(privateMessage(`/start manage_${GROUP}`, ADMIN));
  assert.equal(f.remembered.length, 1);
  assert.equal(f.remembered[0].user, ADMIN);
  await f.command(groupMessage('/pause', ADMIN), 720);
  assert.equal(f.audits.at(-1).actorId, ADMIN);
  assert.equal(f.audits.at(-1).action, 'pause');
  await f.command(groupMessage('/resume', ADMIN, { sender_chat: { id: GROUP }, from: { id: 1087968824, is_bot: true } }), 721);
  assert.equal(f.audits.at(-1).actorId, null);
  assert.equal(f.audits.at(-1).chatId, GROUP);
  await f.command(groupMessage('/pause', USER), 722);
  assert.equal(f.audits.length, 2);
  assert.ok(f.remembered.every(item => item.user === ADMIN));
});

test('bounded feature summaries escape hostile text and remain within Telegram text limits', async t => {
  const f = await fixture(t);
  await f.store.setAdminContext(ADMIN, GROUP, NOW);
  f.state.overview.group.title = '&'.repeat(128);
  f.state.overview.appeals = Array.from({ length: 50 }, (_, index) => ({ incident_id: `case-${index}`, user_id: USER, status: 'open', message: '<>&'.repeat(333) }));
  await f.command(privateMessage('/appeals', ADMIN));
  let text = f.replies().at(-1).params.text;
  assert.ok(text.length < 4096);
  assert.doesNotMatch(text, /<>&/);
  f.control.query = async () => ({ ok: true, scope: { type: 'base' }, destinations: Array.from({ length: 50 }, () => ({ value: '&'.repeat(2000), allowed: false })) });
  await f.command(privateMessage('/checklink https://example.com'));
  text = f.replies().at(-1).params.text;
  assert.ok(text.length < 4096);
});

test('new menus retain public privacy and dashboard links contain only validated display hints', () => {
  for (const language of ['sw', 'en']) {
    const publicNames = getPublicCommands(language).map(item => item.command);
    const groupNames = getGroupCommands(language).map(item => item.command);
    const adminNames = getAdminCommands(language).map(item => item.command);
    assert.equal(new Set(publicNames).size, publicNames.length);
    for (const name of ['dashboard', 'checklink', 'mystatus', 'appeal']) assert.ok(publicNames.includes(name));
    for (const name of ['history', 'appeals', 'settings', 'stats', 'whitelist', 'alerts', 'report']) {
      assert.ok(adminNames.includes(name));
      assert.ok(!publicNames.includes(name));
      assert.ok(!groupNames.includes(name));
    }
  }
  assert.deepEqual(getPublicCommands('sw').map(item => item.command), getPublicCommands('en').map(item => item.command));
  assert.deepEqual(getAdminCommands('sw').map(item => item.command), getAdminCommands('en').map(item => item.command));
  assert.equal(dashboardButton('en', { tab: 'settings', chatId: GROUP }).web_app.url, `https://pilot.sautilink.com/app?lang=en&tab=settings&group=${GROUP}`);
  assert.equal(dashboardButton('sw', { appUrl: 'javascript:alert(1)', tab: 'admin-secret', chatId: '0' }).web_app.url, 'https://pilot.sautilink.com/app?lang=sw');
});
