import {CONTROL_SCHEMA_SQL} from './control-store.js';
import {GUARDRAIL_SCHEMA_SQL} from './guardrail-store.js';
import {OWNER_SCHEMA_SQL} from './owner-auth.js';
import {BROADCAST_SCHEMA_SQL} from './broadcast-store.js';
import {ensureSchemaFamily, applyCompleteSchema} from './schema-ready.js';

// D1 is the source of truth; a Durable Object serializes each chat's actions.
// Moderated message bodies, captions and Telegram tokens are never persisted.
// This independent ledger deliberately outlives incident retention. Existing
// strikes are ban history, not evidence that a member received the new warning.
const adoptLinkWarningsSql = scoped => `
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
  ${scoped ? 'AND i.chat_id=? AND i.user_id=?' : ''}
ORDER BY delivery_proof DESC,i.created_at DESC,i.id DESC
ON CONFLICT(chat_id,user_id) DO UPDATE SET incident_id=excluded.incident_id,
  warned_at=excluded.warned_at,delivered_at=excluded.delivered_at
WHERE member_link_warnings.delivered_at=0 AND excluded.delivered_at>0
  AND member_link_warnings.incident_id=excluded.incident_id;
`;
export const LINK_WARNING_ADOPTION_SQL = adoptLinkWarningsSql(false);
export const LINK_WARNING_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS member_link_warnings (
  chat_id TEXT NOT NULL, user_id TEXT NOT NULL,
  incident_id TEXT NOT NULL, warned_at INTEGER NOT NULL,
  delivered_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(chat_id,user_id)
);
` + LINK_WARNING_ADOPTION_SQL;
export const RESTRICTION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS member_restrictions (
  chat_id TEXT NOT NULL, user_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 0 CHECK(level BETWEEN 0 AND 5),
  until_date INTEGER NOT NULL DEFAULT 0,
  episode_at INTEGER NOT NULL DEFAULT 0,
  incident_id TEXT,
  PRIMARY KEY(chat_id,user_id)
);
CREATE INDEX IF NOT EXISTS member_restrictions_due ON member_restrictions(until_date);
`;
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
` + EXPERIENCE_SCHEMA_SQL + LINK_WARNING_SCHEMA_SQL + RESTRICTION_SCHEMA_SQL + CONTROL_SCHEMA_SQL + GUARDRAIL_SCHEMA_SQL + OWNER_SCHEMA_SQL + BROADCAST_SCHEMA_SQL;

export const applySchema = db => applyCompleteSchema(db, SCHEMA_SQL);

export function createStore(db) {
  const run = (sql, ...args) => db.prepare(sql).bind(...args).run();
  const first = (sql, ...args) => db.prepare(sql).bind(...args).first();
  const ensureExtras = () => ensureSchemaFamily(db, 'experience', EXPERIENCE_SCHEMA_SQL);
  const ensureLinkWarnings = async () => {
    await ensureExtras();
    return ensureSchemaFamily(db, 'linkwarnings', LINK_WARNING_SCHEMA_SQL);
  };
  const ensureRestrictions = () => ensureSchemaFamily(db,'restrictions',RESTRICTION_SCHEMA_SQL);
  const adoptMemberWarnings = (chat,user) => db.prepare(adoptLinkWarningsSql(true)).bind(String(chat),String(user));
  return {
    run, first, ensureExtras, ensureLinkWarnings, ensureRestrictions,
    async restriction(chat,user) {
      await ensureRestrictions();
      return (await first('SELECT * FROM member_restrictions WHERE chat_id=? AND user_id=?',String(chat),String(user)))
        || {chat_id:String(chat),user_id:String(user),level:0,until_date:0,episode_at:0,incident_id:null};
    },
    async confirmRestriction(row,now) {
      await ensureRestrictions();
      const level=-row.strike;
      if(!Number.isSafeInteger(level)||level<1||level>5) throw new RangeError('Invalid restriction stage');
      // API success has already been confirmed. Restriction level and the
      // incident are committed together; existing ban strikes stay untouched.
      const changes=await db.batch([
        db.prepare(`INSERT INTO member_restrictions(chat_id,user_id,level,until_date,episode_at,incident_id)
          SELECT chat_id,user_id,?,?,event_at,id FROM incidents
          WHERE id=? AND strike=? AND status='restriction_sent'
          AND EXISTS(SELECT 1 FROM members m WHERE m.chat_id=incidents.chat_id
            AND m.user_id=incidents.user_id AND m.override_at<incidents.event_at)
          ON CONFLICT(chat_id,user_id) DO UPDATE SET
          level=MAX(member_restrictions.level,excluded.level),
          until_date=excluded.until_date,episode_at=excluded.episode_at,
          incident_id=excluded.incident_id
          WHERE excluded.level>=member_restrictions.level`).bind(level,row.until_date,row.id,row.strike),
        db.prepare(`UPDATE incidents SET status='restricted' WHERE id=? AND status='restriction_sent'
          AND EXISTS(SELECT 1 FROM member_restrictions r WHERE r.chat_id=incidents.chat_id
            AND r.user_id=incidents.user_id AND r.incident_id=incidents.id)`).bind(row.id),
        db.prepare('SELECT * FROM incidents WHERE id=?').bind(row.id)
      ]);
      return changes.at(-1).results[0];
    },
    async linkWarning(chat,user) {
      await ensureLinkWarnings();
      const results=await db.batch([
        adoptMemberWarnings(chat,user),
        db.prepare('SELECT * FROM member_link_warnings WHERE chat_id=? AND user_id=?').bind(String(chat),String(user)),
      ]);
      return results[1].results[0] || null;
    },
    async setting(key) { return (await first('SELECT value FROM settings WHERE key = ?', key))?.value ?? null; },
    async settings(values) {
      await db.batch(Object.entries(values).map(([k,v]) => db.prepare(
        'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
      ).bind(k,String(v))));
    },
    seen(id) { return first('SELECT update_id FROM processed_updates WHERE update_id = ?', id); },
    done(id, now) { return run('INSERT OR IGNORE INTO processed_updates VALUES(?,?)', id, now); },
    async group(chat) {
      const existing=await first('SELECT * FROM groups WHERE chat_id = ?', String(chat));
      if(existing) return existing;
      const results=await db.batch([
        db.prepare('INSERT OR IGNORE INTO groups(chat_id) VALUES(?)').bind(String(chat)),
        db.prepare('SELECT * FROM groups WHERE chat_id = ?').bind(String(chat)),
      ]);
      return results[1].results[0];
    },
    async member(chat,user) {
      const existing=await first('SELECT * FROM members WHERE chat_id=? AND user_id=?',String(chat),String(user));
      if(existing) return existing;
      const results=await db.batch([
        db.prepare('INSERT OR IGNORE INTO members(chat_id,user_id) VALUES(?,?)').bind(String(chat),String(user)),
        db.prepare('SELECT * FROM members WHERE chat_id=? AND user_id=?').bind(String(chat),String(user)),
      ]);
      return results[1].results[0];
    },
    async moderationState(chat,user,incidentId) {
      await Promise.all([ensureLinkWarnings(),ensureRestrictions()]);
      const chatId=String(chat), target=user == null ? null : String(user);
      const statements=[
        db.prepare('INSERT OR IGNORE INTO groups(chat_id) VALUES(?)').bind(chatId),
        db.prepare('SELECT * FROM groups WHERE chat_id=?').bind(chatId),
        db.prepare("SELECT value FROM settings WHERE key='ready_since'"),
      ];
      // A role-exempt sender should not acquire a member record merely because
      // their message contains a link. Read defaults until an incident is planned.
      if(target!==null) statements.push(
        db.prepare('SELECT * FROM members WHERE chat_id=? AND user_id=?').bind(chatId,target),
        // A previous deployment can finish a warning after the operator ran the
        // migration. Reconcile durable proof in this same snapshot transaction.
        adoptMemberWarnings(chatId,target),
        db.prepare('SELECT * FROM member_link_warnings WHERE chat_id=? AND user_id=?').bind(chatId,target),
      );
      statements.push(db.prepare('SELECT * FROM incidents WHERE id=?').bind(incidentId));
      if(target!==null) statements.push(db.prepare('SELECT * FROM member_restrictions WHERE chat_id=? AND user_id=?').bind(chatId,target));
      const results=await db.batch(statements);
      const member=target===null ? null : results[3].results[0] || {
        chat_id:chatId,user_id:target,strikes:0,last_incident:null,active_until:0,episode_at:0,override_at:0,
      };
      return {group:results[1].results[0],activation:Number(results[2].results[0]?.value || 0),member,
        linkWarning:target===null ? null : results[5].results[0] || null,
        incident:results[target===null?3:6].results[0] || null,
        restriction:target===null ? null : results[7].results[0] ||
          {chat_id:chatId,user_id:target,level:0,until_date:0,episode_at:0,incident_id:null}};
    },
    incident(id) { return first('SELECT * FROM incidents WHERE id=?',id); },
    async plan(row) {
      const statements=[];
      if(row.user_id!=null) statements.push(db.prepare('INSERT OR IGNORE INTO members(chat_id,user_id) VALUES(?,?)').bind(String(row.chat_id),String(row.user_id)));
      statements.push(
        db.prepare('INSERT OR IGNORE INTO incidents(id,chat_id,user_id,message_id,event_at,created_at,strike,until_date,reasons) VALUES(?,?,?,?,?,?,?,?,?)')
          .bind(row.id,String(row.chat_id),row.user_id == null ? null : String(row.user_id),row.message_id,row.event_at,row.created_at,row.strike,row.until_date,row.reasons),
        db.prepare('SELECT * FROM incidents WHERE id=?').bind(row.id),
      );
      const results=await db.batch(statements);
      return results.at(-1).results[0] || null;
    },
    status(id,status) { return run('UPDATE incidents SET status=? WHERE id=?',status,id); },
    async confirmWarning(row,now) {
      await Promise.all([ensureLinkWarnings(),ensureExtras()]);
      // Delete confirmation, durable eligibility and the incident outcome commit
      // together. A failed transaction leaves a retryable, unconsumed warning.
      const results=await db.batch([
        db.prepare("INSERT INTO member_link_warnings(chat_id,user_id,incident_id,warned_at) SELECT chat_id,user_id,id,? FROM incidents WHERE id=? AND user_id IS NOT NULL AND strike=0 AND status='planned' AND EXISTS(SELECT 1 FROM members m WHERE m.chat_id=incidents.chat_id AND m.user_id=incidents.user_id AND m.override_at<incidents.event_at) ON CONFLICT(chat_id,user_id) DO UPDATE SET incident_id=excluded.incident_id,warned_at=excluded.warned_at WHERE member_link_warnings.delivered_at=0").bind(now,row.id),
        db.prepare("UPDATE notification_delivery SET status='cancelled',error_kind='warning_superseded',updated_at=? WHERE status='pending' AND incident_id IN (SELECT i.id FROM incidents i JOIN member_link_warnings w ON w.chat_id=i.chat_id AND w.user_id=i.user_id WHERE w.incident_id=? AND i.id!=? AND i.strike=0 AND i.status='warned')").bind(now,row.id,row.id),
        db.prepare("UPDATE incidents SET status='warned',deleted=1 WHERE id=? AND strike=0 AND status='planned' AND EXISTS(SELECT 1 FROM member_link_warnings w WHERE w.chat_id=incidents.chat_id AND w.user_id=incidents.user_id) AND EXISTS(SELECT 1 FROM members m WHERE m.chat_id=incidents.chat_id AND m.user_id=incidents.user_id AND m.override_at<incidents.event_at)").bind(row.id),
        db.prepare('SELECT i.*,EXISTS(SELECT 1 FROM member_link_warnings w WHERE w.incident_id=i.id) AS warning_current FROM incidents i WHERE i.id=?').bind(row.id),
      ]);
      return results.at(-1).results[0] || null;
    },
    async confirm(row,now) {
      if(!Number.isSafeInteger(row.strike) || row.strike<1 || row.strike>3) throw new RangeError('Only a positive ban strike can be confirmed');
      const statements=[];
      if(/^[1-9]\d*$/.test(String(row.user_id)) && Number.isSafeInteger(Number(row.user_id))) {
        // Recovery may find an existing incident after a missing member row was
        // repaired. Ensure its defaults atomically without replacing overrides.
        statements.push(db.prepare('INSERT OR IGNORE INTO members(chat_id,user_id) VALUES(?,?)').bind(String(row.chat_id),String(row.user_id)));
      }
      statements.push(
        db.prepare("UPDATE members SET strikes=MAX(strikes,?),last_incident=?,active_until=?,episode_at=? WHERE chat_id=? AND user_id=? AND override_at < ? AND EXISTS(SELECT 1 FROM incidents WHERE id=? AND status!='cancelled')")
          .bind(row.strike,row.id,row.until_date || -1,row.event_at,String(row.chat_id),String(row.user_id),row.event_at,row.id),
        db.prepare("UPDATE incidents SET status='confirmed' WHERE id=? AND status!='cancelled' AND EXISTS(SELECT 1 FROM members WHERE chat_id=? AND user_id=? AND override_at<?)").bind(row.id,String(row.chat_id),String(row.user_id),row.event_at)
      );
      await db.batch(statements);
    },
    async override(chat,user,at,reset=false,updateId=null) {
      await Promise.all([ensureExtras(),ensureRestrictions()]);
      if(reset) await ensureLinkWarnings();
      const changes=[
        db.prepare('INSERT OR IGNORE INTO members(chat_id,user_id) VALUES(?,?)').bind(String(chat),String(user)),
        db.prepare(`UPDATE members SET ${reset ? 'strikes=0,' : ''} active_until=CASE WHEN episode_at<=? THEN 0 ELSE active_until END,override_at=MAX(override_at,?) WHERE chat_id=? AND user_id=?`)
          .bind(at,at,String(chat),String(user)),
        db.prepare("UPDATE incidents SET status='cancelled' WHERE chat_id=? AND user_id=? AND event_at<=? AND status!='cancelled'")
          .bind(String(chat),String(user),at),
        db.prepare("UPDATE notification_delivery SET status='cancelled',error_kind='admin_override',updated_at=? WHERE status='pending' AND incident_id IN (SELECT id FROM incidents WHERE chat_id=? AND user_id=? AND event_at<=?)")
          .bind(at,String(chat),String(user),at)
      ];
      changes.push(db.prepare(`UPDATE member_restrictions SET
        ${reset ? 'level=0,incident_id=NULL,' : ''} until_date=CASE WHEN episode_at<=? THEN 0 ELSE until_date END
        WHERE chat_id=? AND user_id=?`).bind(at,String(chat),String(user)));
      // Forgiveness is the explicit fresh start. Unban and ordinary human
      // overrides preserve both the prior strike level and link warning.
      if(reset) changes.push(db.prepare('DELETE FROM member_link_warnings WHERE chat_id=? AND user_id=? AND warned_at<=?').bind(String(chat),String(user),at));
      if(updateId!==null) changes.push(db.prepare('INSERT OR IGNORE INTO processed_updates VALUES(?,?)').bind(updateId,at));
      await db.batch(changes);
    },
    async noticeRecord(id,now) {
      await ensureExtras();
      // Existing notified=1 records are legacy claims, not proof of delivery.
      // Do not replay them: Telegram may already have received the old notice.
      const results=await db.batch([
        db.prepare("INSERT OR IGNORE INTO notification_delivery(incident_id,updated_at) SELECT id,? FROM incidents WHERE id=? AND notified=0").bind(now,id),
        db.prepare('UPDATE incidents SET notified=1 WHERE id=? AND EXISTS(SELECT 1 FROM notification_delivery WHERE incident_id=?)').bind(id,id),
        db.prepare('SELECT * FROM notification_delivery WHERE incident_id=?').bind(id),
      ]);
      return results[2].results[0] || null;
    },
    async startNoticeAttempt(id,now) {
      const result=await run("UPDATE notification_delivery SET status='sending',attempts=attempts+1,updated_at=? WHERE incident_id=? AND status='pending' AND retry_at<=?",now,id,now);
      return (result.meta?.changes ?? result.changes ?? 0)>0;
    },
    async noticeState(id,status,now,{retryAt=0,errorKind=null,messageId=null}={}) {
      const statement=db.prepare('UPDATE notification_delivery SET status=?,retry_at=?,error_kind=?,telegram_message_id=?,updated_at=? WHERE incident_id=?').bind(status,retryAt,errorKind,messageId,now,id);
      if(status!=='sent') return statement.run();
      if(!Number.isSafeInteger(messageId) || messageId<=0) throw new RangeError('Confirmed delivery needs a Telegram message ID');
      await ensureLinkWarnings();
      // Delivery proof must survive notification and incident retention. If this
      // transaction fails after Telegram sent, no later link is prematurely banned.
      const results=await db.batch([
        statement,
        db.prepare("UPDATE member_link_warnings SET delivered_at=CASE WHEN delivered_at=0 THEN ? ELSE delivered_at END WHERE incident_id=? AND EXISTS(SELECT 1 FROM notification_delivery n WHERE n.incident_id=member_link_warnings.incident_id AND n.status='sent') AND EXISTS(SELECT 1 FROM incidents i WHERE i.id=member_link_warnings.incident_id AND i.status='warned')").bind(now,id),
      ]);
      return results[0];
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
      await ensureLinkWarnings();
      // 7 days exceeds Telegram's update retention; stale messages are never enforced.
      await db.batch([
        // Preserve late warnings from the previous deployment before deleting
        // their retained incidents and notification-delivery evidence.
        db.prepare(LINK_WARNING_ADOPTION_SQL),
        db.prepare('DELETE FROM processed_updates WHERE processed_at < ?').bind(now-7*86400),
        db.prepare('DELETE FROM notification_delivery WHERE incident_id IN (SELECT id FROM incidents WHERE created_at < ?)').bind(now-30*86400),
        db.prepare('DELETE FROM admin_sessions WHERE updated_at < ?').bind(now-30*86400),
        db.prepare('DELETE FROM incidents WHERE created_at < ?').bind(now-30*86400)
      ]);
    }
  };
}
