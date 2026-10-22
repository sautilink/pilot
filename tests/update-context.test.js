import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.js';
import { applySchema, createStore } from '../src/store.js';
import { CONTROL_DEFAULTS, createControlStore, normalizeGroupSettings } from '../src/control-store.js';
import { loadUpdateContext } from '../src/update-context.js';

const GROUP = -1001122, OTHER = -1003344, USER = 101, OWNER = 102, BOT = 900, NOW = 1792660000;
const user = id => ({ id, first_name: 'Member', language_code: 'en' });
const messageUpdate = (chat = { id: USER, type: 'private' }, text = '/start', from = user(USER)) => ({ update_id: 77, message: { message_id: 50, chat, date: NOW, text, from } });

async function fixture(t) {
  const db = new TestD1(); t.after(() => db.close()); await applySchema(db);
  const batches = [], originalBatch = db.batch.bind(db);
  db.batch = async statements => { batches.push(statements.map(item => item.sql)); return originalBatch(statements); };
  const store = createStore(db), control = createControlStore(db);
  return { db, store, control, batches, clear: () => { batches.length = 0; } };
}

test('private home context batches dedup, raw language and owner display state without fallback or authority', async t => {
  const f = await fixture(t);
  await f.store.setLanguage('user', USER, 'sw', NOW);
  await f.store.run('UPDATE pilot_owner SET user_id=? WHERE singleton=1', String(OWNER));
  f.clear();
  const context = await loadUpdateContext(f.db, messageUpdate());
  assert.deepEqual(context, { seen: false, userLanguage: 'sw', groupLanguage: null, groupSettings: undefined, ownerId: String(OWNER), ownerChecked: true });
  assert.equal(f.batches.length, 1); assert.equal(f.batches[0].length, 3);
  assert.equal(f.batches[0].filter(sql => sql.includes('language_preferences')).length, 1);
  assert.ok(!Object.hasOwn(context, 'isAdmin')); assert.ok(!Object.hasOwn(context, 'authorized'));
  assert.ok(!Object.hasOwn(context, 'isOwner'));
});

test('each context observes newly stored language, settings, owner and processed status', async t => {
  const f = await fixture(t), update = messageUpdate();
  const first = await loadUpdateContext(f.db, update);
  assert.equal(first.userLanguage, null); assert.equal(first.ownerId, null); assert.equal(first.ownerChecked, true);
  await f.store.setLanguage('user', USER, 'en', NOW);
  await f.store.run('UPDATE pilot_owner SET user_id=? WHERE singleton=1', String(USER));
  await f.store.done(update.update_id, NOW);
  f.clear();
  const next = await loadUpdateContext(f.db, update);
  assert.equal(next.userLanguage, 'en'); assert.equal(next.ownerId, String(USER)); assert.equal(next.seen, true);
  assert.equal(f.batches.length, 1);
  await f.store.setLanguage('user', USER, 'sw', NOW + 1);
  assert.equal((await loadUpdateContext(f.db, { ...update, update_id: 78 })).userLanguage, 'sw');
  assert.equal(first.userLanguage, null, 'the prior request snapshot is not mutated');
});

test('group context obtains both language rows in one statement and normalized settings in one batch', async t => {
  const f = await fixture(t), update = messageUpdate({ id: GROUP, type: 'supergroup' }, '/rules');
  await f.store.setLanguage('user', USER, 'en', NOW); await f.store.setLanguage('group', GROUP, 'sw', NOW);
  await f.store.setLanguage('group', OTHER, 'en', NOW);
  await f.control.run('INSERT INTO pilot_group_settings VALUES(?,?,?)', String(GROUP), JSON.stringify({ rules_en: 'Be kind.', flood_enabled: true, command_spam_enabled: 'no', command_spam_allowlist: '/*', unknown_private_value: 'excluded' }), NOW);
  f.clear();
  const context = await loadUpdateContext(f.db, update);
  assert.equal(f.batches.length, 1); assert.equal(f.batches[0].filter(sql => sql.includes('language_preferences')).length, 1);
  assert.equal(context.groupLanguage, 'sw'); assert.equal(context.userLanguage, 'en');
  assert.equal(context.ownerChecked, false); assert.equal(context.ownerId, null);
  assert.equal(context.groupSettings.rules_en, 'Be kind.'); assert.equal(context.groupSettings.flood_enabled, true);
  assert.equal(context.groupSettings.command_spam_enabled, true); assert.equal(context.groupSettings.command_spam_allowlist, '');
  assert.equal(Object.hasOwn(context.groupSettings, 'unknown_private_value'), false);
  assert.ok(!f.batches[0].some(sql => sql.includes('pilot_owner')));
  await f.control.run('UPDATE pilot_group_settings SET settings_json=? WHERE chat_id=?', JSON.stringify({ command_spam_enabled: false, rules_en: 'Updated rule.' }), String(GROUP));
  const next = await loadUpdateContext(f.db, { ...update, update_id: 78 });
  assert.equal(next.groupSettings.command_spam_enabled, false); assert.equal(next.groupSettings.rules_en, 'Updated rule.');
  assert.equal(context.groupSettings.rules_en, 'Be kind.');
});

test('group defaults do not create group settings or member rows and standalone normalization matches the store', async t => {
  const f = await fixture(t), update = messageUpdate({ id: GROUP, type: 'group' }, 'hello');
  const context = await loadUpdateContext(f.db, update);
  assert.deepEqual(context.groupSettings, CONTROL_DEFAULTS); assert.notEqual(context.groupSettings, CONTROL_DEFAULTS);
  assert.deepEqual(context.groupSettings, await f.control.settings(GROUP));
  assert.equal((await f.store.first('SELECT COUNT(*) AS n FROM pilot_group_settings')).n, 0);
  assert.equal((await f.store.first('SELECT COUNT(*) AS n FROM members')).n, 0);
  assert.deepEqual(normalizeGroupSettings('{broken JSON'), CONTROL_DEFAULTS);
  assert.deepEqual(normalizeGroupSettings(null), CONTROL_DEFAULTS);
});

test('ephemeral commands and inaccessible or message-less callbacks use the actual requesting user', async t => {
  const f = await fixture(t); await f.store.setLanguage('user', USER, 'sw', NOW); await f.store.setLanguage('user', BOT, 'en', NOW);
  const ephemeral = messageUpdate({ id: GROUP, type: 'supergroup' }, '/ask question');
  ephemeral.message.message_id = 0; ephemeral.message.ephemeral_message_id = 17;
  const ep = await loadUpdateContext(f.db, ephemeral);
  assert.equal(ep.userLanguage, 'sw'); assert.deepEqual(ep.groupSettings, CONTROL_DEFAULTS);
  const callback = { update_id: 78, callback_query: { id: 'callback', from: user(USER), data: 'pilot:home', message: { message_id: 9, date: 0, from: user(BOT), chat: { id: GROUP, type: 'supergroup' } } } };
  const inaccessible = await loadUpdateContext(f.db, callback);
  assert.equal(inaccessible.userLanguage, 'sw'); assert.equal(inaccessible.ownerChecked, false); assert.deepEqual(inaccessible.groupSettings, CONTROL_DEFAULTS);
  delete callback.callback_query.message;
  const missing = await loadUpdateContext(f.db, callback);
  assert.equal(missing.userLanguage, 'sw'); assert.equal(missing.groupSettings, undefined); assert.equal(missing.ownerChecked, false);
});

test('only private start or home-menu presentation reads the stored owner and malformed subjects are ignored', async t => {
  const f = await fixture(t);
  const home = { update_id: 78, callback_query: { id: 'callback', from: user(USER), data: 'pilot:home', message: { message_id: 9, from: user(BOT), chat: { id: USER, type: 'private' } } } };
  assert.equal((await loadUpdateContext(f.db, home)).ownerChecked, true);
  for (const update of [
    messageUpdate({ id: USER, type: 'private' }, '/help'),
    messageUpdate({ id: GROUP, type: 'supergroup' }, '/start'),
    messageUpdate({ id: OWNER, type: 'private' }, '/start'),
    messageUpdate({ id: USER, type: 'private' }, '/start', { ...user(USER), is_bot: true }),
    { ...home, callback_query: { ...home.callback_query, data: 'pilot:status' } },
    { update_id: 79, edited_message: messageUpdate().message },
  ]) { f.clear(); assert.equal((await loadUpdateContext(f.db, update)).ownerChecked, false); assert.ok(!f.batches.flat().some(sql => sql.includes('pilot_owner'))); }
  const unknown = await loadUpdateContext(f.db, messageUpdate({ id: USER, type: 'private' }, '/start', { id: '101', first_name: 'Invalid typed ID' }));
  assert.equal(unknown.userLanguage, null); assert.equal(unknown.ownerChecked, false);
  await f.store.run('UPDATE pilot_owner SET user_id=? WHERE singleton=1', 'not-a-telegram-id');
  assert.equal((await loadUpdateContext(f.db, home)).ownerId, null);
  await assert.rejects(loadUpdateContext(f.db, { update_id: '78' }), /invalid_update_context/);
});

test('membership-only updates perform only the dedup read and never infer roles from update payloads', async t => {
  const f = await fixture(t); f.clear();
  const context = await loadUpdateContext(f.db, { update_id: 89, chat_member: { chat: { id: GROUP, type: 'supergroup' }, from: user(USER), new_chat_member: { user: user(OWNER), status: 'administrator' } } });
  assert.deepEqual(context, { seen: false, userLanguage: null, groupLanguage: null, groupSettings: undefined, ownerId: null, ownerChecked: false });
  assert.equal(f.batches.length, 1); assert.equal(f.batches[0].length, 1);
});

test('a failed context batch is retried from current data rather than cached as a successful snapshot', async t => {
  const f = await fixture(t), batch = f.db.batch.bind(f.db); let fail = true;
  f.db.batch = async statements => { if (fail) { fail = false; throw new Error('temporary_d1_failure'); } return batch(statements); };
  await assert.rejects(loadUpdateContext(f.db, messageUpdate()), /temporary_d1_failure/);
  await f.store.setLanguage('user', USER, 'sw', NOW);
  assert.equal((await loadUpdateContext(f.db, messageUpdate())).userLanguage, 'sw');
});
