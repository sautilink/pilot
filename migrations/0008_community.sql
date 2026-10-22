CREATE TABLE IF NOT EXISTS pilot_member_reports (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, message_id INTEGER NOT NULL,
  target_user_id TEXT NOT NULL, reporter_id TEXT NOT NULL, reason TEXT NOT NULL,
  excerpt TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','claimed','resolved','delete_unknown')),
  claimed_by TEXT, decision TEXT, reviewed_by TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(chat_id,message_id,reporter_id)
);
CREATE INDEX IF NOT EXISTS pilot_member_reports_chat ON pilot_member_reports(chat_id,updated_at);
CREATE INDEX IF NOT EXISTS pilot_member_reports_reporter ON pilot_member_reports(reporter_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_community_faq (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '', language TEXT NOT NULL CHECK(language IN ('en','sw')),
  created_by TEXT NOT NULL, updated_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_community_faq_chat ON pilot_community_faq(chat_id,updated_at);
CREATE TABLE IF NOT EXISTS pilot_community_hubs (
  chat_id TEXT PRIMARY KEY, slug TEXT UNIQUE,
  visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','unlisted','public')),
  title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '', rules TEXT NOT NULL DEFAULT '',
  join_url TEXT NOT NULL DEFAULT '', resources_json TEXT NOT NULL DEFAULT '[]',
  language TEXT NOT NULL DEFAULT 'en' CHECK(language IN ('en','sw')),
  show_faq INTEGER NOT NULL DEFAULT 0, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_feature_feedback (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('feature','bug')),
  message TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open'
    CHECK(status IN ('open','planned','resolved','declined')),
  reviewed_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_feature_feedback_user ON pilot_feature_feedback(user_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_community_operations (
  request_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  action TEXT NOT NULL, input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('processing','succeeded','failed','unknown')),
  result_json TEXT, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
