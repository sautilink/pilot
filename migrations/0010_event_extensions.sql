CREATE TABLE IF NOT EXISTS pilot_event_settings (
  chat_id TEXT PRIMARY KEY, timezone TEXT NOT NULL DEFAULT 'Africa/Dar_es_Salaam',
  updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_event_options (
  event_id TEXT PRIMARY KEY REFERENCES pilot_events(id) ON DELETE CASCADE,
  capacity INTEGER, revision INTEGER NOT NULL DEFAULT 1,
  CHECK(capacity IS NULL OR capacity BETWEEN 1 AND 2000)
);
CREATE TABLE IF NOT EXISTS pilot_event_attendance (
  event_id TEXT NOT NULL REFERENCES pilot_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, joined_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('new','going','waitlisted')),
  PRIMARY KEY(event_id,user_id)
);
CREATE INDEX IF NOT EXISTS pilot_event_queue ON pilot_event_attendance(event_id,joined_at,user_id);
CREATE TABLE IF NOT EXISTS pilot_event_subscriptions (
  event_id TEXT NOT NULL REFERENCES pilot_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
  lead_minutes INTEGER NOT NULL DEFAULT 60,
  language TEXT NOT NULL CHECK(language IN ('en','sw')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY(event_id,user_id)
);
CREATE TABLE IF NOT EXISTS pilot_event_notifications (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES pilot_events(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('reminder','updated','cancelled','promoted')),
  revision INTEGER NOT NULL, due_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','checking','sending','sent','failed','unknown','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0, read_failures INTEGER NOT NULL DEFAULT 0,
  claimed_at INTEGER, lease_token TEXT, message_id INTEGER, error_kind TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_event_notification_due ON pilot_event_notifications(status,due_at,chat_id);
CREATE INDEX IF NOT EXISTS pilot_event_notification_member ON pilot_event_notifications(event_id,user_id,status);
