-- Additive rollout: preserve every existing strike, ban and override. No legacy
-- strike is treated as proof that the member received the new link warning.
-- The warning ledger survives the 30-day incident retention window.
CREATE TABLE IF NOT EXISTS member_link_warnings (
  chat_id TEXT NOT NULL, user_id TEXT NOT NULL,
  incident_id TEXT NOT NULL, warned_at INTEGER NOT NULL,
  delivered_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(chat_id,user_id)
);
-- Preserve warnings already issued by the previous warning implementation.
-- A strike or notification claim alone never proves warning delivery.
INSERT INTO member_link_warnings(chat_id,user_id,incident_id,warned_at,delivered_at)
SELECT i.chat_id,i.user_id,i.id,MAX(i.created_at,i.event_at),
  CASE WHEN n.status='sent' AND typeof(n.telegram_message_id)='integer'
    AND n.telegram_message_id BETWEEN 1 AND 9007199254740991 AND n.updated_at>0
    THEN MAX(i.created_at,i.event_at,n.updated_at) ELSE 0 END AS delivery_proof
FROM incidents i JOIN members m ON m.chat_id=i.chat_id AND m.user_id=i.user_id
LEFT JOIN notification_delivery n ON n.incident_id=i.id
WHERE i.status='warned' AND i.deleted=1 AND i.strike=0
  AND i.user_id GLOB '[1-9]*' AND i.user_id NOT GLOB '*[^0-9]*'
  AND CAST(i.user_id AS INTEGER)<=9007199254740991 AND m.override_at<i.event_at
  AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(i.reasons) THEN i.reasons ELSE '[]' END) r WHERE r.value='link')
ORDER BY delivery_proof DESC,i.created_at DESC,i.id DESC
ON CONFLICT(chat_id,user_id) DO UPDATE SET incident_id=excluded.incident_id,
  warned_at=excluded.warned_at,delivered_at=excluded.delivered_at
WHERE member_link_warnings.delivered_at=0 AND excluded.delivered_at>0
  AND member_link_warnings.incident_id=excluded.incident_id;
