import { createStore } from './store.js';
import { createTelegram, webhookSecret } from './telegram.js';
import {
  EXPERIENCE_VERSION, getPublicCommands, getGroupCommands, getAdminCommands,
  getBotDescription, getBotShortDescription,
} from './bot-ui.js';

export const ALLOWED_UPDATES = ['message', 'edited_message', 'my_chat_member', 'chat_member', 'callback_query', 'chat_join_request'];
// Menu copy changes do not change the webhook subscription. Only bump this
// version when ALLOWED_UPDATES or the webhook contract itself changes.
export const WEBHOOK_VERSION = 'subscriptions-v1';
const LEGACY_WEBHOOK_VERSIONS = new Set(['2026-10-22.4']);
const LEASE_SECONDS = 60;
const RETRY_SECONDS = 60;
const CONTINUE_SECONDS = 5;
const PROFILE_BATCH_SIZE = 3;
const LEASE_KEY = 'experience_sync_lease_until';
const PROGRESS_KEY = 'experience_sync_progress';
const webhookCurrent = version => version === WEBHOOK_VERSION || LEGACY_WEBHOOK_VERSIONS.has(version);

function profileOperations() {
  return ['', 'sw', 'en'].flatMap(languageCode => {
    const language = languageCode || 'sw';
    return [
      ['setMyDescription', { language_code: languageCode, description: getBotDescription(language) }],
      ['setMyShortDescription', { language_code: languageCode, short_description: getBotShortDescription(language) }],
      ...[
        ['default', getPublicCommands(language)],
        ['all_private_chats', getPublicCommands(language)],
        ['all_group_chats', getGroupCommands(language)],
        ['all_chat_administrators', getAdminCommands(language)],
      ].map(([type, commands]) => ['setMyCommands', { language_code: languageCode, scope: { type }, commands }]),
    ];
  });
}

function progressValue(value) {
  if (typeof value !== 'string' || value.length > 256) return null;
  try {
    const parsed = JSON.parse(value);
    return typeof parsed?.version === 'string' && parsed.version.length <= 64 &&
      Number.isSafeInteger(parsed.botId) && parsed.botId > 0 &&
      Number.isSafeInteger(parsed.completed) && parsed.completed >= 0 && parsed.completed < 2 ** 18
      ? parsed : null;
  } catch { return null; }
}

function newerProfile(version) {
  const parse = value => /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(String(value || ''));
  const current = parse(EXPERIENCE_VERSION), candidate = parse(version);
  return !!(current && candidate && (candidate[1] > current[1] || candidate[1] === current[1] && Number(candidate[2]) > Number(current[2])));
}

function automaticStatus(state, now) {
  if (!state.ready) return 'not_ready';
  const webhookRevision = version => Number(/^subscriptions-v(\d+)$/.exec(version || '')?.[1]);
  if (newerProfile(state.version) || webhookRevision(state.webhookVersion) > webhookRevision(WEBHOOK_VERSION)) return 'newer';
  if (state.version === EXPERIENCE_VERSION && webhookCurrent(state.webhookVersion)) return 'current';
  return state.retryAt > now ? 'throttled' : null;
}

// One request-scoped snapshot avoids serial round trips for independent settings.
// Readiness is deliberately not cached across webhook requests.
export async function readExperienceState(db) {
  const result = await db.prepare(`SELECT key,value FROM settings WHERE key IN
    ('ready','bot_username','experience_version','experience_webhook_version','experience_sync_retry_at','experience_sync_lease_until')`).all();
  const values = Object.fromEntries((result.results || []).map(row => [row.key, row.value]));
  return {
    ready: values.ready === '1', username: values.bot_username || null,
    version: values.experience_version || null,
    webhookVersion: values.experience_webhook_version || null,
    retryAt: Number(values.experience_sync_retry_at) || 0,
    leaseUntil: Number.parseInt(values.experience_sync_lease_until, 10) || 0,
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

/** Metadata changes are idempotent and never send chat messages. The HTTP
 * handler owns waitUntil: automatic work is one resumable phase, either getMe +
 * setWebhook or getMe + at most three independent profile requests. At the
 * Telegram client's eight-second timeout, these are two network waves instead
 * of eighteen serial calls. Forced operator setup awaits every phase inline.
 * Only confirmed calls advance progress; an interrupted call can safely repeat.
 */
export async function syncExperience({
  db, token, webhookUrl, expectedUsername = 'sautilinkpilotbot', api,
  force = false, state, clock = () => Math.floor(Date.now() / 1000),
}) {
  const store = createStore(db);
  let leaseValue = null;
  const nonce = crypto.randomUUID();
  let stage = 'state';
  let identity;
  const lost = () => { const error = new Error('Metadata lease is no longer owned'); error.syncKind = 'lease_lost'; throw error; };
  const persist = async values => {
    const now = clock();
    const results = await db.batch(Object.entries(values).map(([key, value]) => db.prepare(
      'INSERT INTO settings(key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM settings WHERE key=? AND value=? AND CAST(value AS INTEGER)>?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
    ).bind(key, String(value), LEASE_KEY, leaseValue, now)));
    if (results.some(result => !(result.meta?.changes ?? result.changes ?? 0))) lost();
  };
  const renew = async () => {
    const now = clock(), next = `${now + LEASE_SECONDS}:${nonce}`;
    const result = await store.run('UPDATE settings SET value=? WHERE key=? AND value=? AND CAST(value AS INTEGER)>?', next, LEASE_KEY, leaseValue, now);
    if (!(result.meta?.changes ?? result.changes ?? 0)) lost();
    leaseValue = next;
  };
  const release = async () => {
    if (leaseValue === null) return;
    try {
      await store.run('DELETE FROM settings WHERE key=? AND value=?', LEASE_KEY, leaseValue);
    } catch {
      // A crashed or disconnected owner cannot hold the lease indefinitely.
      console.warn('pilot_experience_sync_failed', { stage: 'lease_release', kind: 'sync_unavailable' });
    }
  };
  const failed = async error => {
    if (error?.syncKind === 'lease_lost') return { status: 'superseded' };
    const kind = failureKind(error);
    console.warn('pilot_experience_sync_failed', { stage, kind, error_code: Number.isFinite(Number(error?.code)) ? Number(error.code) : 0 });
    if (leaseValue !== null) {
      const retryAfter = Number(error?.retryAfter);
      const delay = Number.isFinite(retryAfter) ? Math.max(RETRY_SECONDS, Math.ceil(retryAfter)) : RETRY_SECONDS;
      try {
        await persist({ experience_sync_retry_at: clock() + delay, experience_sync_error: kind });
      } catch { /* A D1 outage must not interrupt moderation or expose provider errors. */ }
    }
    return { status: 'failed', errorKind: kind };
  };

  try {
    if (!force) {
      state ||= await readExperienceState(db);
      const status = automaticStatus(state, clock());
      if (status) return { status };
      // Reuse the already-fresh ingress snapshot so high-volume groups do not
      // attempt another D1 lease write while background maintenance is active.
      if (state.leaseUntil > clock()) return { status: 'busy' };
    }
    const now = clock();
    const claimedValue = `${now + LEASE_SECONDS}:${nonce}`;
    const claimed = await store.run(
      'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<=?',
      LEASE_KEY, claimedValue, now,
    );
    if (!(claimed.meta?.changes ?? claimed.changes ?? 0)) return { status: 'busy' };
    leaseValue = claimedValue;
    // Another owner may have finished between the initial snapshot and acquisition.
    // Recheck after the durable lease; a supplied snapshot is never used here.
    if (!force) {
      state = await readExperienceState(db);
      const status = automaticStatus(state, clock());
      if (status) return { status };
    }
    const savedProgress = force ? null : progressValue(await store.setting(PROGRESS_KEY));
    if (!force && newerProfile(savedProgress?.version)) return { status: 'newer' };
    api ||= createTelegram(token);
    stage = 'identity';
    identity = await api.call('getMe');
    if (!isExpectedBot(identity, expectedUsername)) {
      const mismatch = new Error('Unexpected bot identity');
      mismatch.syncKind = 'identity_mismatch';
      throw mismatch;
    }
    let completed = savedProgress?.version === EXPERIENCE_VERSION && savedProgress.botId === identity.id ? savedProgress.completed : 0;
    const progress = () => JSON.stringify({ version: EXPERIENCE_VERSION, botId: identity.id, completed });
    if (force) {
      // An interrupted forced repair remains resumable by later background
      // phases. Readiness and moderation history are never changed here.
      await persist({ experience_version: '', experience_webhook_version: '', [PROGRESS_KEY]: progress() });
    }
    if (force || !webhookCurrent(state.webhookVersion)) {
      stage = 'webhook';
      await renew();
      const result = await api.call('setWebhook', {
        url: webhookUrl, secret_token: await webhookSecret(token), max_connections: 40,
        allowed_updates: ALLOWED_UPDATES, drop_pending_updates: false,
      });
      if (result !== true) throw new Error('Webhook change was not confirmed');
      await persist({ experience_webhook_version: WEBHOOK_VERSION, experience_sync_retry_at: force || state?.version === EXPERIENCE_VERSION ? 0 : clock() + CONTINUE_SECONDS, experience_sync_error: '' });
      if (!force) return { status: state.version === EXPERIENCE_VERSION ? 'synced' : 'pending', identity, webhookReady: true, version: state.version === EXPERIENCE_VERSION ? EXPERIENCE_VERSION : undefined };
    } else if (state.webhookVersion !== WEBHOOK_VERSION) {
      // The old marker was written only after this exact subscription was
      // confirmed. Adopt it without resetting Telegram's delivery configuration.
      await persist({ experience_webhook_version: WEBHOOK_VERSION });
    }
    const operations = profileOperations(), allCompleted = 2 ** operations.length - 1;
    for (;;) {
      stage = 'profile';
      await renew();
      const batch = operations.map((operation, index) => ({ operation, index })).filter(({ index }) => !(completed & 2 ** index)).slice(0, PROFILE_BATCH_SIZE);
      const results = await Promise.allSettled(batch.map(async ({ operation: [method, parameters] }) => {
        if (await api.call(method, parameters) !== true) throw new Error('Profile change was not confirmed');
      }));
      const errors = [];
      for (let index = 0; index < results.length; index++) {
        if (results[index].status === 'fulfilled') completed |= 2 ** batch[index].index;
        else errors.push(results[index].reason);
      }
      const done = completed === allCompleted;
      await persist({ [PROGRESS_KEY]: progress(), ...(done ? {
        experience_version: EXPERIENCE_VERSION, experience_synced_at: clock(),
        experience_sync_retry_at: 0, experience_sync_error: '',
      } : { experience_sync_retry_at: clock() + CONTINUE_SECONDS, experience_sync_error: '' }) });
      if (errors.length) {
        // Honor the longest confirmed rate-limit delay without exposing any
        // provider description, request URL, token, or profile payload in logs.
        const first = errors[0];
        throw { code: first?.code, ambiguous: first?.ambiguous, syncKind: first?.syncKind,
          retryAfter: Math.max(0, ...errors.map(error => Number(error?.retryAfter) || 0)) };
      }
      if (done) return { status: 'synced', identity, version: EXPERIENCE_VERSION };
      if (!force) return { status: 'pending', identity, webhookReady: true };
    }
  } catch (error) {
    return await failed(error);
  } finally {
    await release();
  }
}
