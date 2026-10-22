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

CREATE TABLE IF NOT EXISTS pilot_community_discovery (
  chat_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  category TEXT NOT NULL DEFAULT 'other' CHECK(category IN ('technology','education','business','entertainment','local','other')),
  updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_community_discovery_enabled ON pilot_community_discovery(enabled,category,chat_id);
