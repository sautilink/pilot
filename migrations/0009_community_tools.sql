-- Additive community tools tables. Existing moderation history is unchanged.
CREATE TABLE IF NOT EXISTS pilot_config_history (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  label TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_config_history_chat ON pilot_config_history(chat_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_temporary_links (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, url TEXT NOT NULL,
  expires_at INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE(chat_id,url)
);
CREATE INDEX IF NOT EXISTS pilot_temporary_links_chat ON pilot_temporary_links(chat_id,expires_at);
CREATE TABLE IF NOT EXISTS pilot_tool_operations (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL,
  input_hash TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT, error_code TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_raid_settings (
  chat_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
  join_threshold INTEGER NOT NULL DEFAULT 10, spam_threshold INTEGER NOT NULL DEFAULT 8,
  window_seconds INTEGER NOT NULL DEFAULT 60, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_raid_signals (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, user_id TEXT NOT NULL,
  kind TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_raid_signals_window ON pilot_raid_signals(chat_id,kind,created_at);
CREATE TABLE IF NOT EXISTS pilot_raid_alerts (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, kind TEXT NOT NULL,
  count INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_raid_alerts_chat ON pilot_raid_alerts(chat_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_raid_lockdowns (
  chat_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, before_json TEXT NOT NULL,
  applied_json TEXT NOT NULL, status TEXT NOT NULL, until_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_raid_lockdowns_due ON pilot_raid_lockdowns(status,until_at);
CREATE TABLE IF NOT EXISTS pilot_integration_tokens (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, actor_id TEXT NOT NULL, label TEXT NOT NULL,
  token_hash TEXT NOT NULL, scopes_json TEXT NOT NULL, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, revoked_at INTEGER NOT NULL DEFAULT 0, last_used_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pilot_integration_tokens_chat ON pilot_integration_tokens(chat_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_integration_limits (
  token_id TEXT NOT NULL, bucket INTEGER NOT NULL, uses INTEGER NOT NULL,
  PRIMARY KEY(token_id,bucket)
);
CREATE TABLE IF NOT EXISTS pilot_integration_drafts (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, token_id TEXT NOT NULL, title TEXT NOT NULL,
  text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', reviewed_by TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_integration_drafts_chat ON pilot_integration_drafts(chat_id,created_at);
