import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.js';
import { applySchema, createStore } from '../src/store.js';
import { createOwnerAuth } from '../src/owner-auth.js';
import { createBotExperience } from '../src/commands.js';
import { snapshotBroadcastContent } from '../src/broadcast-commands.js';
import { getPublicCommands, getGroupCommands, getAdminCommands } from '../src/bot-ui.js';

const OWNER = 100, OTHER = 200, BOT = 900, GROUP = -1001001, NOW = 1792670400;
const bot = { id: BOT, username: 'sautilinkpilotbot', is_bot: true };
const from = (id = OWNER, extra = {}) => ({ id, is_bot: false, first_name: '<Charles>', username: id === OWNER ? 'drcharlestz' : 'someone', language_code: 'en', ...extra });
const privateMessage = (text, id = OWNER, extra = {}) => ({ message_id: 10, date: NOW, chat: { id, type: 'private' }, from: from(id), ...(text === undefined ? {} : { text }), ...extra });
const callback = (action, id, user = OWNER, extra = {}) => ({ id: 'callback', data: `pilot:bc:${action}${id ? `:${id}` : ''}`, from: from(user), message: { message_id: 50, date: NOW, chat: { id: user, type: 'private' }, from: bot }, ...extra });
const failure = code => Object.assign(new Error(`private details ${code}`), { code, status: 409 });

async function fixture(t, { bound = true } = {}) {
  const db = new TestD1();
  t.after(() => db.close());
  await applySchema(db);
  const store = createStore(db), owner = createOwnerAuth({ db, clock: () => NOW });
  if (bound) {
    const pair = await owner.beginPairing();
    await owner.claim({ ...from(), chatId: OWNER, chatType: 'private' }, pair.command.split(' ')[1]);
  }
  const calls = [], requests = [], drafts = new Map(), sources = new Map();
  const state = { awaitingContent: false, ownerChecks: 0, hook: null, dispatchHook: null };
  const auth = { ...owner, async isOwner(actor) { state.ownerChecks++; return owner.isOwner(actor); } };
  let messageId = 1000, draftId = 1, update = 100;
  const api = { async call(method, params = {}) {
    calls.push({ method, params: structuredClone(params) });
    if (state.hook) {
      const result = await state.hook(method, params);
      if (result !== undefined) return result;
    }
    if (method === 'getMe') return bot;
    if (method === 'getChatMember') return { status: 'administrator', can_delete_messages: true, can_restrict_members: true };
    if (method === 'getChat') return { id: params.chat_id, type: 'supergroup', title: 'Test group' };
    if (method === 'answerCallbackQuery') return true;
    if (['sendMessage', 'sendPhoto', 'sendVideo', 'sendDocument', 'sendAnimation', 'sendAudio', 'sendVoice', 'editMessageText'].includes(method)) return { message_id: messageId++, chat: { id: params.chat_id }, from: bot };
    throw new Error(`Unexpected API method ${method}`);
  } };
  const dispatchBroadcast = async request => {
    requests.push(structuredClone(request));
    if (state.dispatchHook) await state.dispatchHook(request);
    const { actor, action, input = {} } = request;
    assert.equal(actor.chatId, actor.id);
    assert.equal(actor.chatType, 'private');
    assert.equal(actor.is_bot, false);
    if (action === 'claim') return owner.claim(actor, input.code);
    if (!await owner.isOwner(actor)) throw failure('owner_required');
    if (action === 'compose_start') {
      if (input.replaceDraftId) {
        const old = drafts.get(input.replaceDraftId);
        if (!old || old.status !== 'draft') throw failure('broadcast_busy');
        old.status = 'cancelled';
      }
      state.awaitingContent = true;
      return { ok: true, awaitingContent: true, expiresAt: NOW + 900 };
    }
    if (action === 'compose_state') return { ok: true, awaitingContent: state.awaitingContent, expiresAt: NOW + 900 };
    if (action === 'compose_clear') { state.awaitingContent = false; return { ok: true }; }
    if (action === 'draft_create') {
      if (sources.has(input.sourceUpdateId)) return { ok: true, draft: structuredClone(drafts.get(sources.get(input.sourceUpdateId))) };
      const id = (draftId++).toString(16).padStart(24, '0');
      const draft = { id, status: 'draft', content: structuredClone(input.content), candidateCount: 3, counts: { staged: 3, total: 3 }, created_at: NOW, expires_at: NOW + 900, preview_message_id: null };
      drafts.set(id, draft); sources.set(input.sourceUpdateId, id); state.awaitingContent = false;
      return { ok: true, draft: structuredClone(draft) };
    }
    if (action === 'panel') return { ok: true, candidateCount: 3, active: [...drafts.values()].find(draft => ['draft', 'running'].includes(draft.status)) || null, recent: [...drafts.values()].reverse(), composition: { awaitingContent: state.awaitingContent } };
    const draft = drafts.get(input.id);
    if (!draft) throw failure('not_found');
    if (action === 'draft_get') return { ok: true, draft: structuredClone(draft) };
    if (action === 'preview_set') {
      if (draft.preview_message_id && draft.preview_message_id !== input.messageId) throw failure('preview_mismatch');
      draft.preview_message_id = input.messageId;
    } else if (action === 'confirm') {
      if (!draft.preview_message_id || draft.preview_message_id !== input.previewMessageId) throw failure('preview_mismatch');
      if (draft.status !== 'draft') throw failure('broadcast_busy');
      draft.status = 'running'; draft.counts = { total: 3, pending: 3 };
    } else if (action === 'cancel') { draft.status = 'cancelled'; draft.counts = { total: 3, cancelled: 3 }; }
    else throw failure('invalid_action');
    return { ok: true, draft: structuredClone(draft) };
  };
  const experience = createBotExperience({ db, store, api, owner: auth, dispatchBroadcast, clock: () => NOW });
  return { db, store, owner, calls, requests, drafts, state,
    command: (message, updateId = update++) => experience.handleCommand(message, updateId),
    callback: (query, updateId = update++) => experience.handleCallback(query, updateId),
    sent: () => calls.filter(call => call.method.startsWith('send')),
    lastReply: () => calls.filter(call => call.method === 'sendMessage').at(-1)?.params,
  };
}

test('only the permanently bound owner receives a private home broadcast button; global menus never contain it', async t => {
  const f = await fixture(t);
  await f.command(privateMessage('/start'));
  assert.ok(f.lastReply().reply_markup.inline_keyboard.flat().some(button => button.callback_data === 'pilot:bc:panel'));
  await f.command(privateMessage('/start', OTHER, { from: from(OTHER, { username: 'drcharlestz' }) }));
  assert.ok(f.lastReply().reply_markup.inline_keyboard.flat().every(button => !button.callback_data?.startsWith('pilot:bc:')));
  await f.command(privateMessage('/start', OWNER, { from: from(OWNER, { username: 'renamed_owner' }) }));
  assert.ok(f.lastReply().reply_markup.inline_keyboard.flat().some(button => button.callback_data === 'pilot:bc:panel'));
  for (const language of ['sw', 'en']) for (const commands of [getPublicCommands(language), getGroupCommands(language), getAdminCommands(language)]) assert.ok(commands.every(item => !['updates', 'broadcast', 'claimowner'].includes(item.command)));
  assert.equal(f.requests.length, 0);
});

test('nonowners cannot view counts and group or fake-private commands cause no broadcasts or private replies', async t => {
  const f = await fixture(t);
  for (const command of ['/updates', '/broadcast', '/broadcast Important update']) await f.command(privateMessage(command, OTHER));
  assert.equal(f.requests.length, 0);
  assert.ok(f.sent().every(call => call.params.chat_id === OTHER && /not available to this account/.test(call.params.text)));
  const sent = f.sent().length;
  for (const message of [
    privateMessage('/updates', OWNER, { chat: { id: GROUP, type: 'supergroup' } }),
    privateMessage('/broadcast hi', OTHER, { from: from(OWNER) }),
    privateMessage('/broadcast hi', OWNER, { sender_chat: { id: GROUP } }),
    privateMessage('/broadcast hi', OWNER, { from: from(OWNER, { is_bot: true }) }),
    privateMessage('/broadcast hi', OWNER, { from: { id: OWNER, username: 'drcharlestz' } }),
    privateMessage('/broadcast hi', OWNER, { from: from(String(OWNER)) }),
    privateMessage('/broadcast hi', OWNER, { chat: { id: String(OWNER), type: 'private' } }),
    privateMessage('/broadcast hi', String(OWNER)),
  ]) await f.command(message);
  assert.equal(f.sent().length, sent);
  assert.equal(f.requests.length, 0);
});

test('owner pairing goes through the global dispatch, uses the authentic username, and never echoes a code', async t => {
  const f = await fixture(t, { bound: false });
  const pair = await f.owner.beginPairing(), code = pair.command.split(' ')[1];
  await f.command(privateMessage('/claimowner ' + code, OTHER));
  assert.equal((await f.owner.status()).bound, false);
  assert.doesNotMatch(f.lastReply().text, new RegExp(code));
  await f.command(privateMessage('/claimowner ' + code));
  assert.equal((await f.owner.status()).userId, String(OWNER));
  assert.equal(f.requests.at(-1).action, 'claim');
  assert.equal(f.requests.at(-1).actor.username, 'drcharlestz');
  assert.match(f.lastReply().text, /permanent Telegram ID/);
  assert.doesNotMatch(f.lastReply().text, new RegExp(code));
  await f.command(privateMessage('/myid', OTHER));
  assert.equal(f.lastReply().text, `Your Telegram ID: <code>${OTHER}</code>`);
});

test('immediate text creates a frozen preview using native entities and binds the separate confirmation message', async t => {
  const f = await fixture(t);
  const text = '/broadcast Hello 🚀 visit', start = '/broadcast '.length;
  await f.command(privateMessage(text, OWNER, { entities: [
    { type: 'bot_command', offset: 0, length: 10 },
    { type: 'bold', offset: 0, length: text.length },
    { type: 'text_link', offset: text.indexOf('visit'), length: 5, url: 'https://example.org' },
  ] }), 400);
  const create = f.requests.find(request => request.action === 'draft_create');
  assert.equal(create.input.sourceUpdateId, 400);
  assert.equal(create.input.content.params.text, 'Hello 🚀 visit');
  assert.deepEqual(create.input.content.params.entities, [
    { type: 'bold', offset: 0, length: text.length - start },
    { type: 'text_link', offset: text.indexOf('visit') - start, length: 5, url: 'https://example.org' },
  ]);
  const native = f.sent().find(call => call.params.text === 'Hello 🚀 visit');
  assert.equal(native.params.parse_mode, undefined);
  assert.equal(native.params.chat_id, OWNER);
  const preview = f.requests.find(request => request.action === 'preview_set');
  const draft = [...f.drafts.values()][0];
  assert.equal(draft.preview_message_id, preview.input.messageId);
  assert.ok(f.lastReply().reply_markup.inline_keyboard.flat().some(button => button.callback_data === `pilot:bc:confirm:${draft.id}`));
  assert.match(f.lastReply().text, /Target groups: <b>3/);
  assert.equal(f.requests.filter(request => request.action === 'confirm').length, 0);
  assert.ok(f.sent().every(call => call.params.chat_id === OWNER));
  for (const call of f.sent()) for (const row of call.params.reply_markup?.inline_keyboard || []) for (const button of row) if (button.callback_data) assert.ok(new TextEncoder().encode(button.callback_data).length <= 64);
});

test('draft composition persists through the global service and never captures ordinary commands', async t => {
  const f = await fixture(t);
  await f.command(privateMessage('/broadcast'));
  assert.equal(f.state.awaitingContent, true);
  await f.command(privateMessage('/start'));
  await f.command(privateMessage('/unknown something'));
  assert.equal(f.requests.filter(request => request.action === 'draft_create').length, 0);
  assert.equal(f.state.awaitingContent, true);
  await f.command(privateMessage(undefined, OWNER, { photo: [{ file_id: 'small_id' }, { file_id: 'largest_id' }], caption: 'A <literal> caption', caption_entities: [{ type: 'italic', offset: 2, length: 9 }], has_media_spoiler: true }), 410);
  const content = f.requests.find(request => request.action === 'draft_create').input.content;
  assert.deepEqual(content, { method: 'sendPhoto', params: { photo: 'largest_id', caption: 'A <literal> caption', caption_entities: [{ type: 'italic', offset: 2, length: 9 }], has_spoiler: true } });
  assert.equal(f.state.awaitingContent, false);
  assert.ok(f.sent().some(call => call.method === 'sendPhoto' && call.params.chat_id === OWNER && call.params.parse_mode === undefined));
});

test('unsupported or protected source content leaves composition open without creating a draft', async t => {
  const f = await fixture(t);
  await f.command(privateMessage('/broadcast'));
  for (const extra of [
    { media_group_id: 'album', photo: [{ file_id: 'photo_id' }] },
    { text: 'forward', forward_origin: { type: 'user' } },
    { text: 'protected', has_protected_content: true },
    { text: 'service', new_chat_members: [{ id: OTHER }] },
    { sticker: { file_id: 'sticker' } },
    { document: { file_id: 'https://example.org/file.pdf' } },
  ]) await f.command(privateMessage(undefined, OWNER, extra));
  assert.equal(f.requests.filter(request => request.action === 'draft_create').length, 0);
  assert.equal(f.state.awaitingContent, true);
  assert.match(f.lastReply().text, /not supported/);
  await f.callback(callback('stop'));
  assert.equal(f.state.awaitingContent, false);
});

test('all supported single media types snapshot only file IDs and deliberate captions', () => {
  for (const [field, method] of [['video', 'sendVideo'], ['document', 'sendDocument'], ['animation', 'sendAnimation'], ['audio', 'sendAudio'], ['voice', 'sendVoice']]) {
    const message = privateMessage(undefined, OWNER, { [field]: { file_id: 'Telegram_file-ID_123', file_unique_id: 'do_not_copy', file_name: 'private-name' }, caption: 'Hello' });
    assert.deepEqual(snapshotBroadcastContent(message), { method, params: { [field]: 'Telegram_file-ID_123', caption: 'Hello' } });
  }
  assert.equal(snapshotBroadcastContent(privateMessage(undefined, OWNER, { animation: { file_id: 'animation_id' }, document: { file_id: 'document_id' } })).method, 'sendAnimation');
  assert.equal(snapshotBroadcastContent(privateMessage(undefined, OWNER, { video: { file_id: 'video_id' }, caption: 'Caption above', show_caption_above_media: true })).params.show_caption_above_media, true);
  const dateEntity = { type: 'date_time', offset: 0, length: 8, unix_time: NOW, date_time_format: 'wDT' };
  assert.deepEqual(snapshotBroadcastContent(privateMessage('Tomorrow', OWNER, { entities: [dateEntity] })).params.entities, [dateEntity]);
  assert.throws(() => snapshotBroadcastContent(privateMessage('x'.repeat(4097))), /unsupported_content/);
  assert.throws(() => snapshotBroadcastContent(privateMessage('short', OWNER, { entities: [{ type: 'bold', offset: 4, length: 9 }] })), /unsupported_content/);
});

test('confirmation requires the bound private owner, known bot message and exact preview message ID', async t => {
  const f = await fixture(t);
  await f.command(privateMessage('/broadcast A test announcement'));
  const draft = [...f.drafts.values()][0], message = { message_id: draft.preview_message_id, date: NOW, chat: { id: OWNER, type: 'private' }, from: bot };
  const before = f.requests.length;
  for (const forged of [
    callback('confirm', draft.id, OTHER),
    callback('confirm', draft.id, OWNER, { message: { ...message, chat: { id: OTHER, type: 'private' } } }),
    callback('confirm', draft.id, OWNER, { message: { ...message, chat: { id: GROUP, type: 'supergroup' } } }),
    callback('confirm', draft.id, OWNER, { message: { ...message, from: { id: 901, is_bot: true } } }),
    callback('confirm', draft.id, OWNER, { message: { ...message, from: undefined } }),
    callback('confirm', draft.id, OWNER, { message: { ...message, from: { ...bot, id: String(BOT) } } }),
    callback('confirm', draft.id, OWNER, { message: { ...message, from: { ...bot, is_bot: false } } }),
    callback('confirm', draft.id, OWNER, { message: { ...message, from: { id: BOT } } }),
    callback('confirm', draft.id, OWNER, { message: { ...message, date: 0 } }),
    callback('confirm', draft.id, OWNER, { message: { ...message, message_id: 0 } }),
    callback('confirm', draft.id, OWNER, { from: from(String(OWNER)), message }),
    callback('confirm', draft.id, OWNER, { message: { ...message, chat: { id: String(OWNER), type: 'private' } } }),
    callback('confirm', draft.id, OWNER, { from: from(OWNER, { is_bot: true }), message }),
  ]) await f.callback(forged);
  assert.equal(f.requests.length, before);
  await f.callback(callback('confirm', draft.id, OWNER, { message: { ...message, message_id: draft.preview_message_id + 1 } }));
  assert.equal(draft.status, 'draft');
  assert.match(f.lastReply().text, /no longer available/);
  await f.callback(callback('confirm', draft.id, OWNER, { message }));
  assert.equal(draft.status, 'running');
  assert.match(f.lastReply().text, /Broadcast queued/);
  assert.ok(f.state.ownerChecks >= 3);
  assert.ok(f.sent().every(call => call.params.chat_id > 0));
});

test('editing cancels only the pending draft atomically and starts a new composition', async t => {
  const f = await fixture(t);
  await f.command(privateMessage('/broadcast First copy'));
  const draft = [...f.drafts.values()][0];
  await f.callback(callback('edit', draft.id));
  assert.equal(draft.status, 'cancelled');
  assert.equal(f.state.awaitingContent, true);
  assert.deepEqual(f.requests.at(-1).input, { replaceDraftId: draft.id });
  await f.command(privateMessage('Replacement copy'));
  const replacement = [...f.drafts.values()].at(-1);
  assert.notEqual(replacement.id, draft.id);
  replacement.status = 'running';
  await f.callback(callback('edit', replacement.id));
  assert.equal(replacement.status, 'running');
  assert.equal(f.state.awaitingContent, false);
});

test('a repeated source update never sends a second native preview after the first confirmation is bound', async t => {
  const f = await fixture(t), message = privateMessage('/broadcast Same announcement');
  await f.command(message, 450);
  await f.command(message, 450);
  assert.equal(f.drafts.size, 1);
  assert.equal(f.sent().filter(call => call.params.text === 'Same announcement' && call.params.parse_mode === undefined).length, 1);
  assert.match(f.lastReply().text, /already sent/);
});

test('unconfirmed preview delivery cannot create a working confirmation or queue a broadcast', async t => {
  const f = await fixture(t);
  f.state.hook = (method, params) => method === 'sendMessage' && params.parse_mode === undefined ? false : undefined;
  await f.command(privateMessage('/broadcast Preview should fail'));
  const draft = [...f.drafts.values()][0];
  assert.equal(draft.preview_message_id, null);
  assert.equal(f.requests.filter(request => request.action === 'preview_set' || request.action === 'confirm').length, 0);
  assert.match(f.lastReply().text, /preview is incomplete/);
});

test('a preview response for a different chat cannot bind a confirmation', async t => {
  const f = await fixture(t);
  f.state.hook = (method, params) => method === 'sendMessage' && params.parse_mode === undefined ? { message_id: 1000, chat: { id: OTHER } } : undefined;
  await f.command(privateMessage('/broadcast Check the preview recipient'));
  assert.equal([...f.drafts.values()][0].preview_message_id, null);
  assert.equal(f.requests.some(request => request.action === 'preview_set' || request.action === 'confirm'), false);
  assert.match(f.lastReply().text, /preview is incomplete/);
});

test('owner panel and progress are localized and account for in-flight, skipped, uncertain and cancelled targets', async t => {
  const f = await fixture(t);
  await f.store.setLanguage('user', OWNER, 'sw', NOW);
  await f.command(privateMessage('/updates'));
  assert.match(f.lastReply().text, /Groups zinazolengwa/);
  await f.command(privateMessage('/broadcast Tangazo'));
  const draft = [...f.drafts.values()][0];
  draft.status = 'running'; draft.counts = { sent: 1, failed: 2, skipped: 3, unknown: 4, pending: 5, checking: 1, sending: 1, cancelled: 2 };
  await f.callback(callback('status', draft.id));
  assert.match(f.lastReply().text, /Yaliyofika: 1/);
  assert.match(f.lastReply().text, /Hayajathibitishwa: 4/);
  assert.match(f.lastReply().text, /Yanasubiri \/ yanashughulikiwa: 7/);
  assert.match(f.lastReply().text, /Yaliyositishwa: 2/);
  await f.callback(callback('cancel', draft.id));
  assert.equal(draft.status, 'cancelled');
  assert.match(f.lastReply().text, /Ujumbe uliotumwa tayari haujaondolewa/);
});

test('forged broadcast suffixes and forwarded claim commands cannot trigger owner actions', async t => {
  const f = await fixture(t);
  await f.command(privateMessage('/broadcast@AnotherBot hello'));
  await f.command(privateMessage('/broadcast forwarded', OWNER, { forward_origin: { type: 'user' } }));
  await f.command(privateMessage('/claimowner ' + 'a'.repeat(64), OWNER, { forward_from: from(OTHER) }));
  await f.callback({ ...callback('panel'), data: 'pilot:bc:confirm:bad-id' });
  assert.equal(f.requests.length, 0);
});
