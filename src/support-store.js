import { ensureSchemaFamily } from './schema-ready.js';

export const SUPPORT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pilot_private_contacts (
  user_id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
  can_message INTEGER NOT NULL DEFAULT 1 CHECK(can_message IN (0,1))
);
CREATE TABLE IF NOT EXISTS pilot_support_settings (
  chat_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_support_counters (
  chat_id TEXT PRIMARY KEY, last_number INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS pilot_support_tickets (
  id TEXT PRIMARY KEY, number INTEGER NOT NULL, chat_id TEXT NOT NULL,
  user_id TEXT NOT NULL, subject TEXT NOT NULL, language TEXT NOT NULL CHECK(language IN ('en','sw')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved')),
  claimed_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(chat_id,number)
);
CREATE INDEX IF NOT EXISTS pilot_support_tickets_chat ON pilot_support_tickets(chat_id,updated_at);
CREATE INDEX IF NOT EXISTS pilot_support_tickets_user ON pilot_support_tickets(user_id,chat_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_support_messages (
  id TEXT PRIMARY KEY, ticket_id TEXT NOT NULL REFERENCES pilot_support_tickets(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL, author_role TEXT NOT NULL CHECK(author_role IN ('member','admin')),
  body TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_support_messages_ticket ON pilot_support_messages(ticket_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_support_deliveries (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, ticket_id TEXT NOT NULL REFERENCES pilot_support_tickets(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL UNIQUE REFERENCES pilot_support_messages(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','unknown','failed','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL, error_kind TEXT,
  telegram_message_id INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_support_deliveries_due ON pilot_support_deliveries(chat_id,status,next_attempt_at);
`;

export function createSupportStore(db) {
  const ensure = () => ensureSchemaFamily(db, 'support', SUPPORT_SCHEMA_SQL, '1');
  const first = (sql, ...values) => db.prepare(sql).bind(...values).first();
  const all = async (sql, ...values) => (await db.prepare(sql).bind(...values).all()).results || [];
  const run = (sql, ...values) => db.prepare(sql).bind(...values).run();
  return {
    ensure, first, all, run,
    async rememberPrivateContact(message, now = Math.floor(Date.now() / 1000)) {
      const user = message?.from;
      if (message?.chat?.type !== 'private' || user?.is_bot || message?.sender_chat || !Number.isSafeInteger(user?.id) || user.id <= 0 || Number(message.chat.id) !== user.id || !Number.isSafeInteger(message.date) || message.date <= 0 || message.date > now + 300 || !Number.isSafeInteger(now) || now < 0) return false;
      await ensure();
      await run('INSERT INTO pilot_private_contacts(user_id,started_at,last_seen_at,can_message) VALUES(?,?,?,1) ON CONFLICT(user_id) DO UPDATE SET last_seen_at=MAX(last_seen_at,excluded.last_seen_at),can_message=1 WHERE excluded.last_seen_at>pilot_private_contacts.last_seen_at OR pilot_private_contacts.can_message=1', String(user.id), message.date, message.date);
      return true;
    },
    async privateContact(user) {
      await ensure();
      return first('SELECT user_id,started_at,last_seen_at FROM pilot_private_contacts WHERE user_id=? AND can_message=1', String(user));
    },
    async disablePrivateContact(user, now = Math.floor(Date.now() / 1000)) {
      await ensure();
      return run('UPDATE pilot_private_contacts SET can_message=0,last_seen_at=? WHERE user_id=?', now, String(user));
    },
    async cleanup(now = Math.floor(Date.now() / 1000)) {
      await ensure();
      await db.batch([
        db.prepare('DELETE FROM pilot_support_tickets WHERE id IN (SELECT id FROM pilot_support_tickets WHERE updated_at<? LIMIT 100)').bind(now - 90 * 86400),
        db.prepare('DELETE FROM pilot_private_contacts WHERE user_id IN (SELECT user_id FROM pilot_private_contacts WHERE last_seen_at<? LIMIT 500)').bind(now - 365 * 86400),
      ]);
    },
  };
}
