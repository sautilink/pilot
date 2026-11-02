CREATE TABLE IF NOT EXISTS pilot_welcome_expiries (
  chat_id TEXT NOT NULL, message_id INTEGER NOT NULL, due_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','sending','done','failed')),
  PRIMARY KEY(chat_id,message_id)
);
CREATE INDEX IF NOT EXISTS pilot_welcome_expiries_due
  ON pilot_welcome_expiries(status,due_at);
