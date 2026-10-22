CREATE TABLE IF NOT EXISTS pilot_schedules (
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
);
