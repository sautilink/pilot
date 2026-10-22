// Stable bot identity can be reused; member/administrator permissions cannot.
// Entries are scoped to the actual DB binding, complete token and expected bot.
import { databaseIdentity } from './request-timing.js';
const bindings = new WeakMap();
const MAX_IDENTITIES = 4;
const TTL_MS = 5 * 60 * 1000;
const valid = (identity, id, username) => identity?.is_bot === true && identity.id === id &&
  Number.isSafeInteger(identity.id) && identity.id > 0 && typeof identity.username === 'string' && identity.username.toLowerCase() === username;

export function createBotIdentity({ db, api, token, expectedUsername = 'sautilinkpilotbot', clock = Date.now }) {
  const id = Number(/^([1-9]\d*):[A-Za-z0-9_-]{20,}$/.exec(token || '')?.[1]);
  const username = String(expectedUsername).toLowerCase();
  if (!Number.isSafeInteger(id) || id <= 0 || !/^[a-z][a-z0-9_]{4,31}$/.test(username)) throw new TypeError('invalid_bot_identity_configuration');
  const key = `${token}\n${username}`;
  const cacheKey = databaseIdentity(db);
  let cache = bindings.get(cacheKey);
  if (!cache) { cache = new Map(); bindings.set(cacheKey, cache); }
  return async () => {
    const now = clock(), previous = cache.get(key);
    if (previous && previous.expiresAt > now) return previous.promise;
    const entry = { expiresAt: now + TTL_MS, promise: null };
    entry.promise = (async () => {
      const result = await db.prepare("SELECT key,value FROM settings WHERE key IN ('bot_id','bot_username')").all();
      const saved = Object.fromEntries((result.results || []).map(row => [row.key, row.value]));
      const stored = { id: Number(saved.bot_id), username: saved.bot_username, is_bot: true };
      // Both parts were written by protected setup after getMe verification.
      // A different token's bot ID or a changed configured username invalidates
      // them; update bodies never provide identity or cache keys.
      if (valid(stored, id, username)) return Object.freeze(stored);
      const identity = await api.call('getMe');
      if (!valid(identity, id, username)) throw new Error('unexpected_bot_identity');
      return Object.freeze({ ...identity });
    })();
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > MAX_IDENTITIES) cache.delete(cache.keys().next().value);
    entry.promise.catch(() => { if (cache.get(key) === entry) cache.delete(key); });
    return entry.promise;
  };
}
