CREATE TABLE IF NOT EXISTS pilot_broadcast_groups (
  chat_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('active','unknown','disconnected')),
  telegram_status TEXT, updated_at INTEGER NOT NULL DEFAULT 0, event_id INTEGER NOT NULL DEFAULT 0,
  observed_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pilot_broadcast_group_status ON pilot_broadcast_groups(status,chat_id);
CREATE TABLE IF NOT EXISTS pilot_broadcast_campaigns (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, source_update_id TEXT NOT NULL UNIQUE,
  content_json TEXT, content_hash TEXT NOT NULL, preview_message_id INTEGER,
  status TEXT NOT NULL CHECK(status IN ('draft','running','completed','cancelled','expired')),
  candidate_count INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, confirmed_at INTEGER, completed_at INTEGER, starts_at INTEGER,
  slot INTEGER NOT NULL DEFAULT 1 CHECK(slot=1)
);
CREATE UNIQUE INDEX IF NOT EXISTS pilot_broadcast_active ON pilot_broadcast_campaigns(slot) WHERE status IN ('draft','running');
CREATE INDEX IF NOT EXISTS pilot_broadcast_history ON pilot_broadcast_campaigns(created_at);
CREATE TABLE IF NOT EXISTS pilot_broadcast_deliveries (
  campaign_id TEXT NOT NULL REFERENCES pilot_broadcast_campaigns(id) ON DELETE CASCADE, chat_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('staged','pending','checking','sending','sent','skipped','failed','unknown','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0, read_failures INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL DEFAULT 0, claimed_at INTEGER, lease_token TEXT,
  telegram_message_id INTEGER, error_kind TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  PRIMARY KEY(campaign_id,chat_id)
);
CREATE INDEX IF NOT EXISTS pilot_broadcast_pending ON pilot_broadcast_deliveries(status,next_attempt_at,campaign_id);
CREATE TABLE IF NOT EXISTS pilot_broadcast_composition (
  user_id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_broadcast_audit (
  id TEXT PRIMARY KEY, campaign_id TEXT, actor_id TEXT, action TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_broadcast_audit_time ON pilot_broadcast_audit(created_at);
CREATE TABLE IF NOT EXISTS pilot_broadcast_runtime (
  id INTEGER PRIMARY KEY CHECK(id=1), lease_token TEXT, lease_until INTEGER NOT NULL DEFAULT 0,
  next_send_at INTEGER NOT NULL DEFAULT 0, next_campaign_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO pilot_broadcast_runtime(id) VALUES(1);
