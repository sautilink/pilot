import { createStore } from './store.js';
import { createControlStore, normalizeGroupSettings } from './control-store.js';
import { createOwnerAuth } from './owner-auth.js';

const positive = value => Number.isSafeInteger(value) && value > 0;
const group = chat => ['group', 'supergroup'].includes(chat?.type) && Number.isSafeInteger(chat.id) && chat.id < 0;
const language = value => value === 'sw' || value === 'en' ? value : null;
const ownerId = value => /^\d+$/.test(String(value)) && positive(Number(value)) ? String(value) : null;

/** One current-request snapshot, not a persistent cache or authorization result.
 * Only the menu presentation can use ownerChecked/ownerId. All privileged
 * operations must retain their own fresh authorization and member-role checks.
 */
export async function loadUpdateContext(db, update) {
  if (!Number.isSafeInteger(update?.update_id)) throw new TypeError('invalid_update_context');
  const callback = update.callback_query;
  const message = callback?.message || update.message || update.edited_message;
  const from = callback ? callback.from : message?.from;
  const user = positive(from?.id) ? String(from.id) : null;
  const chat = group(message?.chat) ? String(message.chat.id) : null;
  const privatePeer = message?.chat?.type === 'private' && positive(message.chat.id)
    && message.chat.id === from?.id && !from?.is_bot && !message.sender_chat;
  const home = privatePeer && (callback
    ? callback.data === 'pilot:home'
    : !!update.message && /^\/start(?:@[A-Za-z0-9_]+)?(?:\s|$)/i.test(String(message.text || '')));

  // These ensure calls reuse the established durable schema-family mechanism.
  // A warm binding does not perform extra database calls for schema readiness.
  const readiness = [];
  if (user !== null || chat !== null) readiness.push(createStore(db).ensureExtras());
  if (chat !== null) readiness.push(createControlStore(db).ensure());
  if (home) readiness.push(createOwnerAuth({ db }).ensure());
  await Promise.all(readiness);

  const statements = [db.prepare('SELECT update_id FROM processed_updates WHERE update_id=?').bind(update.update_id)];
  let languagesIndex = null, settingsIndex = null, ownerIndex = null;
  if (user !== null || chat !== null) {
    languagesIndex = statements.length;
    statements.push(db.prepare("SELECT scope,language FROM language_preferences WHERE (scope='user' AND subject_id=?) OR (scope='group' AND subject_id=?)").bind(user,chat));
  }
  if (chat !== null) {
    settingsIndex = statements.length;
    statements.push(db.prepare('SELECT settings_json FROM pilot_group_settings WHERE chat_id=?').bind(chat));
  }
  if (home) {
    ownerIndex = statements.length;
    statements.push(db.prepare('SELECT user_id FROM pilot_owner WHERE singleton=1'));
  }
  const results = await db.batch(statements);
  const languages = languagesIndex === null ? [] : results[languagesIndex].results;
  return {
    seen: results[0].results.length > 0,
    userLanguage: language(languages.find(row => row.scope === 'user')?.language),
    groupLanguage: language(languages.find(row => row.scope === 'group')?.language),
    groupSettings: settingsIndex === null ? undefined : normalizeGroupSettings(results[settingsIndex].results[0]?.settings_json),
    ownerId: ownerIndex === null ? null : ownerId(results[ownerIndex].results[0]?.user_id),
    ownerChecked: ownerIndex !== null,
  };
}
