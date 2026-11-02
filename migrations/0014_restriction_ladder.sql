-- Independent durable restriction ladder; never rewrites old ban strikes.
CREATE TABLE IF NOT EXISTS member_restrictions (
  chat_id TEXT NOT NULL, user_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 0 CHECK(level BETWEEN 0 AND 5),
  until_date INTEGER NOT NULL DEFAULT 0,
  episode_at INTEGER NOT NULL DEFAULT 0,
  incident_id TEXT,
  PRIMARY KEY(chat_id,user_id)
);
CREATE INDEX IF NOT EXISTS member_restrictions_due ON member_restrictions(until_date);
