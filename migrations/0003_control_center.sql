CREATE TABLE IF NOT EXISTS pilot_group_settings (
  chat_id TEXT PRIMARY KEY, settings_json TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_whitelist_rules (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('url','domain','subdomains')), value TEXT NOT NULL,
  created_by TEXT, created_at INTEGER NOT NULL, UNIQUE(chat_id,kind,value)
);
CREATE INDEX IF NOT EXISTS pilot_whitelist_chat ON pilot_whitelist_rules(chat_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_known_admins (
  user_id TEXT NOT NULL, chat_id TEXT NOT NULL, verified_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,chat_id)
);
CREATE TABLE IF NOT EXISTS pilot_audit (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, actor_id TEXT,
  action TEXT NOT NULL, target_id TEXT, incident_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_audit_chat ON pilot_audit(chat_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_appeals (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, incident_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL, message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  decision TEXT CHECK(decision IN ('keep','unban','forgive')), reviewed_by TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_appeals_chat ON pilot_appeals(chat_id,updated_at);
CREATE INDEX IF NOT EXISTS pilot_appeals_user ON pilot_appeals(user_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_operations (
  request_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  action TEXT NOT NULL, input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('claimed','sending','succeeded','failed','unknown')),
  result_json TEXT, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_case_corrections (
  incident_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, user_id TEXT NOT NULL,
  actor_id TEXT, request_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_subscriptions (
  user_id TEXT NOT NULL, chat_id TEXT NOT NULL, alerts_enabled INTEGER NOT NULL,
  report_frequency TEXT NOT NULL CHECK(report_frequency IN ('off','daily','weekly')),
  last_report_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,chat_id)
);
