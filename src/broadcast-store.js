export const BROADCAST_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS pilot_broadcast_groups (
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
INSERT OR IGNORE INTO pilot_broadcast_runtime(id) VALUES(1);`;


const chatId = value => /^-[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const timestamp = value => Number.isSafeInteger(value) && value >= 0;
const changes = result => Number(result?.meta?.changes ?? result?.changes ?? 0);

export function createBroadcastStore(db) {
  const first = (sql, ...values) => db.prepare(sql).bind(...values).first();
  const run = (sql, ...values) => db.prepare(sql).bind(...values).run();
  const all = async (sql, ...values) => (await db.prepare(sql).bind(...values).all()).results || [];
  let initialized;
  const ensure = () => initialized ||= db.batch(BROADCAST_SCHEMA_SQL.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql))).catch(error => { initialized = null; throw error; });
  return {
    ensure, first, run, all,
    async rememberGroup(chat, at) {
      if (!chatId(chat) || !timestamp(at)) throw new TypeError('invalid_group_observation');
      await ensure();
      // Normal messages do not rewrite an active registry row. Only evidence
      // newer than a disconnect can reopen discovery, still requiring preflight.
      return run("INSERT INTO pilot_broadcast_groups(chat_id,status,observed_at) VALUES(?,'unknown',?) ON CONFLICT(chat_id) DO UPDATE SET status='unknown',telegram_status=NULL,updated_at=excluded.observed_at,event_id=0,observed_at=excluded.observed_at WHERE pilot_broadcast_groups.status='disconnected' AND excluded.observed_at>pilot_broadcast_groups.updated_at", String(chat), at);
    },
    async recordMembership(chat, telegramStatus, at, updateId = 0) {
      if (!chatId(chat) || !timestamp(at) || !timestamp(updateId) || !['creator','administrator','member','restricted','left','kicked'].includes(telegramStatus)) throw new TypeError('invalid_membership');
      await ensure();
      const status = ['left','kicked'].includes(telegramStatus) ? 'disconnected' : telegramStatus === 'restricted' ? 'unknown' : 'active';
      return run("INSERT INTO pilot_broadcast_groups(chat_id,status,telegram_status,updated_at,event_id,observed_at) VALUES(?,?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET status=excluded.status,telegram_status=excluded.telegram_status,updated_at=excluded.updated_at,event_id=excluded.event_id,observed_at=MAX(pilot_broadcast_groups.observed_at,excluded.observed_at) WHERE excluded.updated_at>pilot_broadcast_groups.updated_at OR (excluded.updated_at=pilot_broadcast_groups.updated_at AND excluded.event_id>pilot_broadcast_groups.event_id) OR (excluded.updated_at=pilot_broadcast_groups.updated_at AND excluded.event_id=pilot_broadcast_groups.event_id AND excluded.status='disconnected' AND pilot_broadcast_groups.status<>'disconnected')", String(chat), status, telegramStatus, at, updateId, at);
    },
    async backfillGroups(at) {
      if (!timestamp(at)) throw new TypeError('invalid_timestamp');
      await ensure();
      if (!await first("SELECT name FROM sqlite_master WHERE type='table' AND name='groups'")) return 0;
      return changes(await run("INSERT OR IGNORE INTO pilot_broadcast_groups(chat_id,status,observed_at) SELECT chat_id,'unknown',? FROM groups WHERE chat_id GLOB '-[0-9]*'", at));
    },
    async cleanup(now) {
      if (!timestamp(now)) throw new TypeError('invalid_timestamp');
      await ensure();
      const since = now - 30 * 86400;
      await db.batch([
        db.prepare('DELETE FROM pilot_broadcast_composition WHERE user_id IN (SELECT user_id FROM pilot_broadcast_composition WHERE expires_at<=? LIMIT 100)').bind(now),
        db.prepare("UPDATE pilot_broadcast_campaigns SET status='expired',updated_at=?,completed_at=? WHERE (status='draft' AND expires_at<=?) OR (status='running' AND created_at<=?)").bind(now,now,now,since),
        db.prepare("UPDATE pilot_broadcast_deliveries SET status='cancelled',error_kind='draft_expired',lease_token=NULL,updated_at=? WHERE (campaign_id,chat_id) IN (SELECT d.campaign_id,d.chat_id FROM pilot_broadcast_deliveries d JOIN pilot_broadcast_campaigns c ON c.id=d.campaign_id WHERE c.status='expired' AND d.status IN ('staged','pending','checking') LIMIT 500)").bind(now),
        // Content is removed independently of a large delivery-history backlog.
        db.prepare("UPDATE pilot_broadcast_campaigns SET content_json=NULL WHERE id IN (SELECT id FROM pilot_broadcast_campaigns WHERE created_at<? AND status NOT IN ('draft','running') AND content_json IS NOT NULL LIMIT 100)").bind(since),
        db.prepare('DELETE FROM pilot_broadcast_audit WHERE id IN (SELECT id FROM pilot_broadcast_audit WHERE created_at<? LIMIT 500)').bind(since),
        db.prepare("DELETE FROM pilot_broadcast_deliveries WHERE (campaign_id,chat_id) IN (SELECT d.campaign_id,d.chat_id FROM pilot_broadcast_deliveries d JOIN pilot_broadcast_campaigns c ON c.id=d.campaign_id WHERE c.created_at<? AND c.status NOT IN ('draft','running') LIMIT 500)").bind(since),
        db.prepare("DELETE FROM pilot_broadcast_campaigns WHERE id IN (SELECT c.id FROM pilot_broadcast_campaigns c WHERE c.created_at<? AND c.status NOT IN ('draft','running') AND NOT EXISTS(SELECT 1 FROM pilot_broadcast_deliveries d WHERE d.campaign_id=c.id) LIMIT 100)").bind(since),
      ]);
    },
  };
}

