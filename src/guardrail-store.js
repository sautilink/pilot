// Optional moderation keeps only identifiers, counters and delivery outcomes.
// No message body, invite link or join-request bio is stored.
export const GUARDRAIL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pilot_flood_events (
  chat_id TEXT NOT NULL,user_id TEXT NOT NULL,event_key TEXT NOT NULL,event_at INTEGER NOT NULL,
  PRIMARY KEY(chat_id,user_id,event_key)
);
CREATE INDEX IF NOT EXISTS pilot_flood_age ON pilot_flood_events(event_at);
CREATE TABLE IF NOT EXISTS pilot_guard_actions (
  id TEXT PRIMARY KEY,chat_id TEXT NOT NULL,target_id TEXT,actor_id TEXT,kind TEXT NOT NULL,
  status TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,telegram_message_id INTEGER
);
CREATE INDEX IF NOT EXISTS pilot_guard_age ON pilot_guard_actions(created_at);
CREATE TABLE IF NOT EXISTS pilot_join_requests (
  id TEXT PRIMARY KEY,chat_id TEXT NOT NULL,user_id TEXT NOT NULL,user_chat_id TEXT NOT NULL,
  event_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,status TEXT NOT NULL,
  answer TEXT,telegram_message_id INTEGER,updated_at INTEGER NOT NULL,
  UNIQUE(chat_id,user_id,event_at)
);
CREATE INDEX IF NOT EXISTS pilot_join_group ON pilot_join_requests(chat_id,event_at);
CREATE TABLE IF NOT EXISTS pilot_health_events (
  chat_id TEXT NOT NULL,kind TEXT NOT NULL,severity TEXT NOT NULL,
  created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,resolved_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(chat_id,kind)
);
CREATE TABLE IF NOT EXISTS pilot_admin_deliveries (
  id TEXT PRIMARY KEY,user_id TEXT NOT NULL,chat_id TEXT NOT NULL,kind TEXT NOT NULL,
  status TEXT NOT NULL,attempted_at INTEGER NOT NULL,error_kind TEXT,telegram_message_id INTEGER
);
CREATE INDEX IF NOT EXISTS pilot_admin_delivery_age ON pilot_admin_deliveries(attempted_at);
`;

export function createGuardrailStore(db) {
  let ready;
  const ensure=()=>ready ||= db.batch(GUARDRAIL_SCHEMA_SQL.split(';').map(s=>s.trim()).filter(Boolean).map(sql=>db.prepare(sql))).catch(error=>{ready=null;throw error;});
  const run=(sql,...args)=>db.prepare(sql).bind(...args).run();
  const first=(sql,...args)=>db.prepare(sql).bind(...args).first();
  const all=async(sql,...args)=>(await db.prepare(sql).bind(...args).all()).results || [];
  return {
    ensure,run,first,all,
    async claim({id,chatId,targetId=null,actorId=null,kind,now}) {
      await ensure();
      const result=await run("INSERT OR IGNORE INTO pilot_guard_actions(id,chat_id,target_id,actor_id,kind,status,created_at,updated_at) VALUES(?,?,?,?,?,'sending',?,?)",id,String(chatId),targetId==null?null:String(targetId),actorId==null?null:String(actorId),kind,now,now);
      return (result.meta?.changes ?? result.changes ?? 0)>0;
    },
    async finish(id,status,now,messageId=null) {
      return run('UPDATE pilot_guard_actions SET status=?,updated_at=?,telegram_message_id=? WHERE id=?',status,now,messageId,id);
    },
    async health(chatId,kind,active,now,severity='warning') {
      await ensure();
      if(!active) return run('UPDATE pilot_health_events SET resolved_at=?,updated_at=? WHERE chat_id=? AND kind=? AND resolved_at=0',now,now,String(chatId),kind);
      return run('INSERT INTO pilot_health_events(chat_id,kind,severity,created_at,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(chat_id,kind) DO UPDATE SET severity=excluded.severity,created_at=CASE WHEN resolved_at>0 THEN excluded.created_at ELSE created_at END,updated_at=excluded.updated_at,resolved_at=0',String(chatId),kind,severity,now,now);
    },
    async joins(chatId) {
      await ensure();
      return all('SELECT id,chat_id,user_id,event_at,expires_at,status FROM pilot_join_requests WHERE chat_id=? ORDER BY event_at DESC LIMIT 50',String(chatId));
    },
    async cleanup(now) {
      await ensure();
      await db.batch([
        db.prepare('DELETE FROM pilot_flood_events WHERE event_at<?').bind(now-120),
        db.prepare('DELETE FROM pilot_guard_actions WHERE created_at<?').bind(now-30*86400),
        db.prepare('DELETE FROM pilot_join_requests WHERE event_at<?').bind(now-7*86400),
        db.prepare('DELETE FROM pilot_health_events WHERE resolved_at>0 AND resolved_at<?').bind(now-30*86400),
        db.prepare('DELETE FROM pilot_admin_deliveries WHERE attempted_at<?').bind(now-30*86400),
      ]);
    },
  };
}
