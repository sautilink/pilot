import { createStore } from './store.js';
import { createTelegram, webhookSecret } from './telegram.js';
import {
  EXPERIENCE_VERSION, getPublicCommands, getGroupCommands, getAdminCommands,
  getBotDescription, getBotShortDescription,
} from './bot-ui.js';

export const ALLOWED_UPDATES = ['message', 'edited_message', 'my_chat_member', 'chat_member', 'callback_query', 'chat_join_request'];
const LEASE_SECONDS = 300;
const RETRY_SECONDS = 60;
const LEASE_KEY = 'experience_sync_lease_until';

// One request-scoped snapshot avoids serial round trips for independent settings.
// Readiness is deliberately not cached across webhook requests.
export async function readExperienceState(db) {
  const result = await db.prepare(`SELECT key,value FROM settings WHERE key IN
    ('ready','bot_username','experience_version','experience_webhook_version','experience_sync_retry_at')`).all();
  const values = Object.fromEntries((result.results || []).map(row => [row.key, row.value]));
  return {
    ready: values.ready === '1', username: values.bot_username || null,
    version: values.experience_version || null,
    webhookVersion: values.experience_webhook_version || null,
    retryAt: Number(values.experience_sync_retry_at) || 0,
  };
}

export function isExpectedBot(identity, expectedUsername = 'sautilinkpilotbot') {
  return identity?.is_bot === true && Number.isSafeInteger(identity.id) && identity.id > 0 &&
    typeof identity.username === 'string' && identity.username.toLowerCase() === String(expectedUsername).toLowerCase();
}

function failureKind(error) {
  if (error?.syncKind === 'identity_mismatch') return 'identity_mismatch';
  if (error?.code === 429) return 'telegram_rate_limit';
  if (error?.ambiguous === true) return 'telegram_unconfirmed';
  if (Number(error?.code) >= 400) return 'telegram_rejected';
  return 'sync_unavailable';
}

/** Metadata changes are idempotent. This function never sends chat messages.
 * A successful callback subscription is awaited before background profile work,
 * so the first private menu can use its buttons immediately in the usual path.
 * Only settings metadata is written; moderation history and readiness are owned
 * by the existing setup/moderation paths.
 */
export async function syncExperience({
  db, token, webhookUrl, expectedUsername = 'sautilinkpilotbot', api,
  force = false, waitUntil, state, clock = () => Math.floor(Date.now() / 1000),
}) {
  const store = createStore(db);
  let leaseUntil = null;
  let stage = 'state';
  let identity;
  const release = async () => {
    if (leaseUntil === null) return;
    try {
      await store.run('DELETE FROM settings WHERE key=? AND value=?', LEASE_KEY, String(leaseUntil));
    } catch {
      // A crashed or disconnected owner cannot hold the lease indefinitely.
      console.warn('pilot_experience_sync_failed', { stage: 'lease_release', kind: 'sync_unavailable' });
    }
  };
  const failed = async error => {
    const kind = failureKind(error);
    console.warn('pilot_experience_sync_failed', { stage, kind, error_code: Number.isFinite(Number(error?.code)) ? Number(error.code) : 0 });
    if (leaseUntil !== null) {
      const retryAfter = Number(error?.retryAfter);
      const delay = Number.isFinite(retryAfter) ? Math.max(RETRY_SECONDS, Math.ceil(retryAfter)) : RETRY_SECONDS;
      try {
        await store.settings({ experience_sync_retry_at: clock() + delay, experience_sync_error: kind });
      } catch { /* A D1 outage must not interrupt moderation or expose provider errors. */ }
    }
    return { status: 'failed', errorKind: kind };
  };

  try {
    if (!force) {
      state ||= await readExperienceState(db);
      if (!state.ready) return { status: 'not_ready' };
      if (state.version === EXPERIENCE_VERSION) return { status: 'current' };
      if (state.retryAt > clock()) return { status: 'throttled' };
    }
    const now = clock();
    const claimedUntil = now + LEASE_SECONDS;
    const claimed = await store.run(
      'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<=?',
      LEASE_KEY, String(claimedUntil), now,
    );
    if (!(claimed.meta?.changes ?? claimed.changes ?? 0)) return { status: 'busy' };
    leaseUntil = claimedUntil;
    // Another owner may have finished between the initial snapshot and acquisition.
    // Recheck after the durable lease; a supplied snapshot is never used here.
    if (!force) {
      state = await readExperienceState(db);
      const status = !state.ready ? 'not_ready'
        : state.version === EXPERIENCE_VERSION ? 'current'
          : state.retryAt > clock() ? 'throttled' : null;
      if (status) {
        await release();
        return { status };
      }
    }
    api ||= createTelegram(token);
    stage = 'identity';
    identity = await api.call('getMe');
    if (!isExpectedBot(identity, expectedUsername)) {
      const mismatch = new Error('Unexpected bot identity');
      mismatch.syncKind = 'identity_mismatch';
      throw mismatch;
    }
    if (force || state.webhookVersion !== EXPERIENCE_VERSION) {
      stage = 'webhook';
      const result = await api.call('setWebhook', {
        url: webhookUrl, secret_token: await webhookSecret(token), max_connections: 40,
        allowed_updates: ALLOWED_UPDATES, drop_pending_updates: false,
      });
      if (result !== true) throw new Error('Webhook change was not confirmed');
      await store.settings({ experience_webhook_version: EXPERIENCE_VERSION });
    }
  } catch (error) {
    const result = await failed(error);
    await release();
    return result;
  }

  const finish = async () => {
    try {
      stage = 'profile';
      for (const languageCode of ['', 'sw', 'en']) {
        const language = languageCode || 'sw';
        const operations = [
          ['setMyDescription', { language_code: languageCode, description: getBotDescription(language) }],
          ['setMyShortDescription', { language_code: languageCode, short_description: getBotShortDescription(language) }],
          ...[
            ['default', getPublicCommands(language)],
            ['all_private_chats', getPublicCommands(language)],
            ['all_group_chats', getGroupCommands(language)],
            ['all_chat_administrators', getAdminCommands(language)],
          ].map(([type, commands]) => ['setMyCommands', { language_code: languageCode, scope: { type }, commands }]),
        ];
        for (const [method, parameters] of operations) {
          if (await api.call(method, parameters) !== true) throw new Error('Profile change was not confirmed');
        }
      }
      await store.settings({
        experience_version: EXPERIENCE_VERSION, experience_synced_at: clock(),
        experience_sync_retry_at: 0, experience_sync_error: '',
      });
      return { status: 'synced', identity, version: EXPERIENCE_VERSION };
    } catch (error) {
      return await failed(error);
    } finally {
      await release();
    }
  };
  if (!force && typeof waitUntil === 'function') {
    const completion = finish();
    try { waitUntil(completion); } catch { return await completion; }
    return { status: 'scheduled', identity, webhookReady: true };
  }
  return finish();
}
