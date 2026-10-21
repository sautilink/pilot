CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS groups (
  chat_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1,
  activated_at INTEGER NOT NULL DEFAULT 0, notice_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS members (
  chat_id TEXT NOT NULL, user_id TEXT NOT NULL,
  strikes INTEGER NOT NULL DEFAULT 0 CHECK(strikes BETWEEN 0 AND 3),
  last_incident TEXT, active_until INTEGER NOT NULL DEFAULT 0,
  episode_at INTEGER NOT NULL DEFAULT 0, override_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, user_id)
);
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, user_id TEXT,
  message_id INTEGER NOT NULL, event_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
  strike INTEGER NOT NULL, until_date INTEGER NOT NULL, reasons TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned', deleted INTEGER NOT NULL DEFAULT 0,
  notified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS incidents_member ON incidents(chat_id, user_id, created_at);
CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY, processed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS processed_age ON processed_updates(processed_at);
