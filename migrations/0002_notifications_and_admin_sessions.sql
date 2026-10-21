CREATE TABLE IF NOT EXISTS notification_delivery (
  incident_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0, error_kind TEXT,
  telegram_message_id INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  user_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS language_preferences (
  scope TEXT NOT NULL, subject_id TEXT NOT NULL,
  language TEXT NOT NULL CHECK(language IN ('sw','en')), updated_at INTEGER NOT NULL,
  PRIMARY KEY(scope,subject_id)
);
