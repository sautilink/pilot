import {CONTROL_SCHEMA_SQL} from './control-store.js';
import {GUARDRAIL_SCHEMA_SQL} from './guardrail-store.js';
import {OWNER_SCHEMA_SQL} from './owner-auth.js';
import {BROADCAST_SCHEMA_SQL} from './broadcast-store.js';

// D1 is the source of truth; a Durable Object serializes each chat's actions.
// Moderated message bodies, captions and Telegram tokens are never persisted.
export const EXPERIENCE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS notification_delivery (
  incident_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0, error_kind TEXT,
  telegram_message_id INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_sessions (
  user_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS language_preferences (
  scope TEXT NOT NULL, subject_id TEXT NOT NULL,
  language TEXT NOT NULL CHECK(language IN ('sw','en')), updated_at INTEGER NOT NULL,
  PRIMARY KEY(scope,subject_id)
);
`;
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS groups (
  chat_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1,
  activated_at INTEGER NOT NULL DEFAULT 0, notice_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS members (
  chat_id TEXT NOT NULL, user_id TEXT NOT NULL,
  strikes INTEGER NOT NULL DEFAULT 0 CHECK(strikes BETWEEN 0 AND 3),
  last_incident TEXT, active_until INTEGER NOT NULL DEFAULT 0,
  episode_at INTEGER NOT NULL DEFAULT 0, override_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_id, user_id)
);
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, user_id TEXT,
  message_id INTEGER NOT NULL, event_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
  strike INTEGER NOT NULL, until_date INTEGER NOT NULL, reasons TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned', deleted INTEGER NOT NULL DEFAULT 0,
  notified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS incidents_member ON incidents(chat_id, user_id, created_at);
CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY, processed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS processed_age ON processed_updates(processed_at);
` + EXPERIENCE_SCHEMA_SQL + CONTROL_SCHEMA_SQL + GUARDRAIL_SCHEMA_SQL + OWNER_SCHEMA_SQL + BROADCAST_SCHEMA_SQL;

export async function applySchema(db) {
  const statements = SCHEMA_SQL.split(';').map(s => s.trim()).filter(Boolean);
  await db.batch(statements.map(sql => db.prepare(sql)));
}

export function createStore(db) {
  const run = (sql, ...args) => db.prepare(sql).bind(...args).run();
  const first = (sql, ...args) => db.prepare(sql).bind(...args).first();
  let extras;
  const ensureExtras = () => extras ||= db.batch(EXPERIENCE_SCHEMA_SQL.split(';').map(s=>s.trim()).filter(Boolean).map(sql=>db.prepare(sql))).catch(error=>{ extras=null; throw error; });
  return {
    run, first, ensureExtras,
    async setting(key) { return (await first('SELECT value FROM settings WHERE key = ?', key))?.value ?? null; },
    async settings(values) {
      await db.batch(Object.entries(values).map(([k,v]) => db.prepare(
        'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
      ).bind(k,String(v))));
    },
    seen(id) { return first('SELECT update_id FROM processed_updates WHERE update_id = ?', id); },
    done(id, now) { return run('INSERT OR IGNORE INTO processed_updates VALUES(?,?)', id, now); },
    async group(chat) {
      await run('INSERT OR IGNORE INTO groups(chat_id) VALUES(?)', String(chat));
      return first('SELECT * FROM groups WHERE chat_id = ?', String(chat));
    },
    async member(chat,user) {
      await run('INSERT OR IGNORE INTO members(chat_id,user_id) VALUES(?,?)', String(chat),String(user));
      return first('SELECT * FROM members WHERE chat_id=? AND user_id=?',String(chat),String(user));
    },
    incident(id) { return first('SELECT * FROM incidents WHERE id=?',id); },
    async plan(row) {
      await run('INSERT OR IGNORE INTO incidents(id,chat_id,user_id,message_id,event_at,created_at,strike,until_date,reasons) VALUES(?,?,?,?,?,?,?,?,?)',
        row.id,String(row.chat_id),row.user_id == null ? null : String(row.user_id),row.message_id,row.event_at,row.created_at,row.strike,row.until_date,row.reasons);
      return this.incident(row.id);
    },
    status(id,status) { return run('UPDATE incidents SET status=? WHERE id=?',status,id); },
    async confirm(row,now) {
      await db.batch([
        db.prepare("UPDATE members SET strikes=MAX(strikes,?),last_incident=?,active_until=?,episode_at=? WHERE chat_id=? AND user_id=? AND override_at < ? AND EXISTS(SELECT 1 FROM incidents WHERE id=? AND status!='cancelled')")
          .bind(row.strike,row.id,row.until_date || -1,row.event_at,String(row.chat_id),String(row.user_id),row.event_at,row.id),
        db.prepare("UPDATE incidents SET status='confirmed' WHERE id=? AND status!='cancelled' AND EXISTS(SELECT 1 FROM members WHERE chat_id=? AND user_id=? AND override_at<?)").bind(row.id,String(row.chat_id),String(row.user_id),row.event_at)
      ]);
    },
    async override(chat,user,at,reset=false,updateId=null) {
      await ensureExtras();
      await this.member(chat,user);
      const changes=[
        db.prepare(`UPDATE members SET ${reset ? 'strikes=0,' : ''} active_until=CASE WHEN episode_at<=? THEN 0 ELSE active_until END,override_at=MAX(override_at,?) WHERE chat_id=? AND user_id=?`)
          .bind(at,at,String(chat),String(user)),
        db.prepare("UPDATE incidents SET status='cancelled' WHERE chat_id=? AND user_id=? AND event_at<=? AND status!='cancelled'")
          .bind(String(chat),String(user),at),
        db.prepare("UPDATE notification_delivery SET status='cancelled',error_kind='admin_override',updated_at=? WHERE status='pending' AND incident_id IN (SELECT id FROM incidents WHERE chat_id=? AND user_id=? AND event_at<=?)")
          .bind(at,String(chat),String(user),at)
      ];
      if(updateId!==null) changes.push(db.prepare('INSERT OR IGNORE INTO processed_updates VALUES(?,?)').bind(updateId,at));
      await db.batch(changes);
    },
    async noticeRecord(id,now) {
      await ensureExtras();
      // Existing notified=1 records are legacy claims, not proof of delivery.
      // Do not replay them: Telegram may already have received the old notice.
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO notification_delivery(incident_id,updated_at) SELECT id,? FROM incidents WHERE id=? AND notified=0").bind(now,id),
        db.prepare('UPDATE incidents SET notified=1 WHERE id=? AND EXISTS(SELECT 1 FROM notification_delivery WHERE incident_id=?)').bind(id,id)
      ]);
      return first('SELECT * FROM notification_delivery WHERE incident_id=?',id);
    },
    async startNoticeAttempt(id,now) {
      const result=await run("UPDATE notification_delivery SET status='sending',attempts=attempts+1,updated_at=? WHERE incident_id=? AND status='pending' AND retry_at<=?",now,id,now);
      return (result.meta?.changes ?? result.changes ?? 0)>0;
    },
    noticeState(id,status,now,{retryAt=0,errorKind=null,messageId=null}={}) {
      return run('UPDATE notification_delivery SET status=?,retry_at=?,error_kind=?,telegram_message_id=?,updated_at=? WHERE incident_id=?',status,retryAt,errorKind,messageId,now,id);
    },
    async latestNotice(chat) {
      await ensureExtras();
      return first('SELECT n.* FROM notification_delivery n JOIN incidents i ON i.id=n.incident_id WHERE i.chat_id=? ORDER BY n.updated_at DESC,i.created_at DESC,i.rowid DESC LIMIT 1',String(chat));
    },
    async setAdminContext(user,chat,now) {
      await ensureExtras();
      return run('INSERT INTO admin_sessions(user_id,chat_id,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET chat_id=excluded.chat_id,updated_at=excluded.updated_at',String(user),String(chat),now);
    },
    async adminContext(user) {
      await ensureExtras();
      return first('SELECT chat_id,updated_at FROM admin_sessions WHERE user_id=?',String(user));
    },
    async clearAdminContext(user) { await ensureExtras(); return run('DELETE FROM admin_sessions WHERE user_id=?',String(user)); },
    async getLanguage(scope,id,fallback='sw') {
      await ensureExtras();
      return (await first('SELECT language FROM language_preferences WHERE scope=? AND subject_id=?',scope,String(id)))?.language || (fallback==='en' ? 'en' : 'sw');
    },
    async setLanguage(scope,id,language,now) {
      if(!['user','group'].includes(scope) || !['sw','en'].includes(language)) throw new Error('Invalid language preference');
      await ensureExtras();
      return run('INSERT INTO language_preferences(scope,subject_id,language,updated_at) VALUES(?,?,?,?) ON CONFLICT(scope,subject_id) DO UPDATE SET language=excluded.language,updated_at=excluded.updated_at',scope,String(id),language,now);
    },
    async cleanup(now) {
      await ensureExtras();
      // 7 days exceeds Telegram's update retention; stale messages are never enforced.
      await db.batch([
        db.prepare('DELETE FROM processed_updates WHERE processed_at < ?').bind(now-7*86400),
        db.prepare('DELETE FROM notification_delivery WHERE incident_id IN (SELECT id FROM incidents WHERE created_at < ?)').bind(now-30*86400),
        db.prepare('DELETE FROM admin_sessions WHERE updated_at < ?').bind(now-30*86400),
        db.prepare('DELETE FROM incidents WHERE created_at < ?').bind(now-30*86400)
      ]);
    }
  };
}
