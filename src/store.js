// D1 is the source of truth; a Durable Object serializes each chat's actions.
// Message bodies, captions, links and Telegram tokens are never persisted here.
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
`;

export async function applySchema(db) {
  const statements = SCHEMA_SQL.split(';').map(s => s.trim()).filter(Boolean);
  await db.batch(statements.map(sql => db.prepare(sql)));
}

export function createStore(db) {
  const run = (sql, ...args) => db.prepare(sql).bind(...args).run();
  const first = (sql, ...args) => db.prepare(sql).bind(...args).first();
  return {
    run, first,
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
        db.prepare("UPDATE members SET strikes=MAX(strikes,?),last_incident=?,active_until=?,episode_at=? WHERE chat_id=? AND user_id=? AND override_at < ?")
          .bind(row.strike,row.id,row.until_date || -1,row.event_at,String(row.chat_id),String(row.user_id),row.event_at),
        db.prepare("UPDATE incidents SET status='confirmed' WHERE id=?").bind(row.id)
      ]);
    },
    async override(chat,user,at,reset=false,updateId=null) {
      await this.member(chat,user);
      const changes=[
        db.prepare(`UPDATE members SET ${reset ? 'strikes=0,' : ''} active_until=CASE WHEN episode_at<=? THEN 0 ELSE active_until END,override_at=MAX(override_at,?) WHERE chat_id=? AND user_id=?`)
          .bind(at,at,String(chat),String(user)),
        db.prepare("UPDATE incidents SET status='cancelled' WHERE chat_id=? AND user_id=? AND event_at<=? AND status!='cancelled'")
          .bind(String(chat),String(user),at)
      ];
      if(updateId!==null) changes.push(db.prepare('INSERT OR IGNORE INTO processed_updates VALUES(?,?)').bind(updateId,at));
      await db.batch(changes);
    },
    async claimNotice(id) {
      const result=await run('UPDATE incidents SET notified=1 WHERE id=? AND notified=0',id);
      return (result.meta?.changes ?? result.changes ?? 0)>0;
    },
    async cleanup(now) {
      // 7 days exceeds Telegram's update retention; stale messages are never enforced.
      await db.batch([
        db.prepare('DELETE FROM processed_updates WHERE processed_at < ?').bind(now-7*86400),
        db.prepare('DELETE FROM incidents WHERE created_at < ?').bind(now-30*86400)
      ]);
    }
  };
}
