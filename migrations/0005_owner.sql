CREATE TABLE IF NOT EXISTS pilot_owner (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  user_id TEXT UNIQUE,
  claimed_at INTEGER NOT NULL DEFAULT 0,
  pair_hash TEXT,
  pair_expires_at INTEGER NOT NULL DEFAULT 0,
  pair_created_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO pilot_owner(singleton) VALUES(1);
