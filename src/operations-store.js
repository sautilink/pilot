import { ensureSchemaFamily } from './schema-ready.js';
import { createEventStore } from './event-store.js';

export const OPERATIONS_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS pilot_schedules (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, creator_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('announcement','highlights')),
  text TEXT NOT NULL DEFAULT '', language TEXT NOT NULL CHECK(language IN ('en','sw')),
  repeat TEXT NOT NULL CHECK(repeat IN ('once','daily','weekly')),
  run_at INTEGER NOT NULL, next_attempt_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','checking','sending','completed','cancelled','paused','unknown')),
  claimed_at INTEGER, lease_token TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  read_failures INTEGER NOT NULL DEFAULT 0, sent_count INTEGER NOT NULL DEFAULT 0,
  error_kind TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_schedule_due ON pilot_schedules(status,next_attempt_at,chat_id);
CREATE INDEX IF NOT EXISTS pilot_schedule_group ON pilot_schedules(chat_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_schedule_deliveries (
  schedule_id TEXT NOT NULL REFERENCES pilot_schedules(id) ON DELETE CASCADE,
  run_at INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('checking','sending','sent','failed','unknown','skipped')),
  message_id INTEGER, error_kind TEXT, highlight_ids TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL, PRIMARY KEY(schedule_id,run_at)
);
CREATE TABLE IF NOT EXISTS pilot_events (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, creator_id TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL CHECK(language IN ('en','sw')),
  starts_at INTEGER NOT NULL, ends_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','cancelled')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_event_group ON pilot_events(chat_id,starts_at);
CREATE TABLE IF NOT EXISTS pilot_event_rsvps (
  event_id TEXT NOT NULL REFERENCES pilot_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, response TEXT NOT NULL CHECK(response IN ('going','maybe','declined')),
  updated_at INTEGER NOT NULL, PRIMARY KEY(event_id,user_id)
);
CREATE TABLE IF NOT EXISTS pilot_highlights (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, creator_id TEXT NOT NULL,
  text TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', sent_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_highlight_group ON pilot_highlights(chat_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_operations_requests (
  request_id TEXT NOT NULL, chat_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  action TEXT NOT NULL, input_hash TEXT NOT NULL, result_json TEXT NOT NULL,
  created_at INTEGER NOT NULL, PRIMARY KEY(request_id,chat_id,actor_id)
);
CREATE TABLE IF NOT EXISTS pilot_operations_audit (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  action TEXT NOT NULL, target_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_operations_audit_group ON pilot_operations_audit(chat_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_operations_runtime (
  chat_id TEXT PRIMARY KEY, next_send_at INTEGER NOT NULL DEFAULT 0
);`;

export function createOperationsStore(db) {
  const first = (sql, ...values) => db.prepare(sql).bind(...values).first();
  const all = async (sql, ...values) => (await db.prepare(sql).bind(...values).all()).results || [];
  const run = (sql, ...values) => db.prepare(sql).bind(...values).run();
  const events = createEventStore(db);
  const ensure = async () => { await ensureSchemaFamily(db, 'operations', OPERATIONS_SCHEMA_SQL, '1'); await events.ensure(); };
  return {
    first, all, run, ensure,
    async cleanup(now = Math.floor(Date.now() / 1000)) {
      await ensure();
      const since = now - 30 * 86400;
      await db.batch([
        db.prepare("DELETE FROM pilot_schedules WHERE id IN (SELECT id FROM pilot_schedules WHERE status IN ('completed','cancelled','paused','unknown') AND updated_at<? LIMIT 200)").bind(since),
        db.prepare('DELETE FROM pilot_schedule_deliveries WHERE (schedule_id,run_at) IN (SELECT schedule_id,run_at FROM pilot_schedule_deliveries WHERE updated_at<? LIMIT 500)').bind(since),
        db.prepare('DELETE FROM pilot_events WHERE id IN (SELECT id FROM pilot_events WHERE ends_at<? LIMIT 200)').bind(since),
        db.prepare('DELETE FROM pilot_highlights WHERE id IN (SELECT id FROM pilot_highlights WHERE created_at<? LIMIT 200)').bind(since),
        db.prepare('DELETE FROM pilot_operations_requests WHERE (request_id,chat_id,actor_id) IN (SELECT request_id,chat_id,actor_id FROM pilot_operations_requests WHERE created_at<? LIMIT 500)').bind(since),
        db.prepare('DELETE FROM pilot_operations_audit WHERE id IN (SELECT id FROM pilot_operations_audit WHERE created_at<? LIMIT 500)').bind(since),
        db.prepare("DELETE FROM pilot_event_notifications WHERE id IN (SELECT id FROM pilot_event_notifications WHERE status IN ('sent','failed','unknown','skipped') AND updated_at<? LIMIT 500)").bind(since),
        db.prepare('DELETE FROM pilot_operations_runtime WHERE next_send_at<? AND chat_id NOT IN (SELECT chat_id FROM pilot_schedules)').bind(since),
      ]);
    },
  };
}
