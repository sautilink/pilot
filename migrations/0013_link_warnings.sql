-- Additive rollout: preserve every existing strike, ban and override. No legacy
-- strike is treated as proof that the member received the new link warning.
-- The warning ledger survives the 30-day incident retention window.
CREATE TABLE IF NOT EXISTS member_link_warnings (
  chat_id TEXT NOT NULL, user_id TEXT NOT NULL,
  incident_id TEXT NOT NULL, warned_at INTEGER NOT NULL,
  delivered_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(chat_id,user_id)
);
