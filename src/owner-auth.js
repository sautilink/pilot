import { ensureSchemaFamily } from './schema-ready.js';

// A username is a pairing condition, never the persistent authorization key.
// Only the protected operator setup can issue a one-use pairing capability.
export const OWNER_USERNAME = 'drcharlestz';
export const OWNER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pilot_owner (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  user_id TEXT UNIQUE,
  claimed_at INTEGER NOT NULL DEFAULT 0,
  pair_hash TEXT,
  pair_expires_at INTEGER NOT NULL DEFAULT 0,
  pair_created_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO pilot_owner(singleton) VALUES(1);
`;

function fail(code, status = 403) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}

const human = actor => Number.isSafeInteger(actor?.id) && actor.id > 0 && !actor.is_bot;
const changes = result => Number(result?.meta?.changes ?? result?.changes ?? 0);
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
async function digest(code) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`pilot-owner-pair:v1:${code}`))));
}

export function createOwnerAuth({ db, clock = () => Math.floor(Date.now() / 1000) }) {
  const ensure = () => ensureSchemaFamily(db, 'owner', OWNER_SCHEMA_SQL);
  const row = async () => { await ensure(); return db.prepare('SELECT * FROM pilot_owner WHERE singleton=1').first(); };

  return {
    ensure,
    async status() {
      const current = await row();
      return current?.user_id
        ? { bound: true, userId: current.user_id, expectedUsername: OWNER_USERNAME }
        : { bound: false, expectedUsername: OWNER_USERNAME };
    },
    async isOwner(actor) {
      if (!human(actor)) return false;
      return (await row())?.user_id === String(actor.id);
    },
    // Caller must first verify SETUP_KEY and same-origin operator access.
    async beginPairing() {
      const now = clock(), current = await row();
      if (current?.user_id) fail('owner_bound', 409);
      if (current.pair_created_at && current.pair_created_at > now - 30) fail('owner_pair_rate_limited', 429);
      const code = hex(crypto.getRandomValues(new Uint8Array(32)));
      const expiresAt = now + 600;
      const changed = await db.prepare(`UPDATE pilot_owner SET pair_hash=?,pair_expires_at=?,pair_created_at=?
        WHERE singleton=1 AND user_id IS NULL AND (pair_created_at=0 OR pair_created_at<=?)`)
        .bind(await digest(code), expiresAt, now, now - 30).run();
      if (!changes(changed)) {
        if ((await row())?.user_id) fail('owner_bound', 409);
        fail('owner_pair_rate_limited', 429);
      }
      return { command: `/claimowner ${code}`, expiresAt, username: OWNER_USERNAME };
    },
    // Caller is derived from an authenticated, real private Telegram message.
    async claim(actor, code) {
      if (!human(actor) || actor.chatType !== 'private' || actor.chatId !== actor.id) fail('owner_private_required');
      const current = await row();
      if (current.user_id) {
        if (current.user_id === String(actor.id)) return { ok: true, userId: current.user_id };
        fail('owner_bound', 409);
      }
      if (typeof actor.username !== 'string' || actor.username.toLowerCase() !== OWNER_USERNAME) fail('owner_username_required');
      if (typeof code !== 'string' || !/^[a-f0-9]{64}$/.test(code)) fail('owner_claim_invalid');
      const now = clock();
      if (!current.pair_hash) fail('owner_claim_invalid');
      if (current.pair_expires_at <= now) fail('owner_claim_expired');
      const changed = await db.prepare(`UPDATE pilot_owner SET user_id=?,claimed_at=?,pair_hash=NULL,pair_expires_at=0,pair_created_at=0
        WHERE singleton=1 AND user_id IS NULL AND pair_hash=? AND pair_expires_at>?`)
        .bind(String(actor.id), now, await digest(code), now).run();
      if (!changes(changed)) {
        const latest = await row();
        if (latest.user_id === String(actor.id)) return { ok: true, userId: latest.user_id };
        if (latest.user_id) fail('owner_bound', 409);
        fail('owner_claim_invalid');
      }
      return { ok: true, userId: String(actor.id) };
    },
    async cleanup(now = clock()) {
      await ensure();
      await db.prepare('UPDATE pilot_owner SET pair_hash=NULL,pair_expires_at=0 WHERE user_id IS NULL AND pair_expires_at<=?').bind(now).run();
    },
  };
}
