-- Optional rules, join review, and opt-in admin delivery metadata.
CREATE TABLE IF NOT EXISTS pilot_flood_events (
  chat_id TEXT NOT NULL,user_id TEXT NOT NULL,event_key TEXT NOT NULL,event_at INTEGER NOT NULL,
  PRIMARY KEY(chat_id,user_id,event_key)
);
CREATE INDEX IF NOT EXISTS pilot_flood_age ON pilot_flood_events(event_at);
CREATE TABLE IF NOT EXISTS pilot_guard_actions (
  id TEXT PRIMARY KEY,chat_id TEXT NOT NULL,target_id TEXT,actor_id TEXT,kind TEXT NOT NULL,
  status TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,telegram_message_id INTEGER
);
CREATE INDEX IF NOT EXISTS pilot_guard_age ON pilot_guard_actions(created_at);
CREATE TABLE IF NOT EXISTS pilot_join_requests (
  id TEXT PRIMARY KEY,chat_id TEXT NOT NULL,user_id TEXT NOT NULL,user_chat_id TEXT NOT NULL,
  event_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,status TEXT NOT NULL,
  answer TEXT,telegram_message_id INTEGER,updated_at INTEGER NOT NULL,
  UNIQUE(chat_id,user_id,event_at)
);
CREATE INDEX IF NOT EXISTS pilot_join_group ON pilot_join_requests(chat_id,event_at);
CREATE TABLE IF NOT EXISTS pilot_health_events (
  chat_id TEXT NOT NULL,kind TEXT NOT NULL,severity TEXT NOT NULL,
  created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,resolved_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(chat_id,kind)
);
CREATE TABLE IF NOT EXISTS pilot_admin_deliveries (
  id TEXT PRIMARY KEY,user_id TEXT NOT NULL,chat_id TEXT NOT NULL,kind TEXT NOT NULL,
  status TEXT NOT NULL,attempted_at INTEGER NOT NULL,error_kind TEXT,telegram_message_id INTEGER
);
CREATE INDEX IF NOT EXISTS pilot_admin_delivery_age ON pilot_admin_deliveries(attempted_at);
