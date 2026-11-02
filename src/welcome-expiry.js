import {ensureSchemaFamily} from './schema-ready.js';

export const WELCOME_EXPIRY_SCHEMA_SQL=`
CREATE TABLE IF NOT EXISTS pilot_welcome_expiries (
  chat_id TEXT NOT NULL, message_id INTEGER NOT NULL, due_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','sending','done','failed')),
  PRIMARY KEY(chat_id,message_id)
);
CREATE INDEX IF NOT EXISTS pilot_welcome_expiries_due
  ON pilot_welcome_expiries(status,due_at);
`;
const validChat=v=>Number.isSafeInteger(Number(v))&&Number(v)<0;
export function createWelcomeExpiries({db,api,clock=()=>Math.floor(Date.now()/1000)}) {
  const ensure=()=>ensureSchemaFamily(db,'welcome',WELCOME_EXPIRY_SCHEMA_SQL);
  async function schedule(chat,messageId,seconds){
    if(!validChat(chat)||!Number.isSafeInteger(messageId)||messageId<=0||!Number.isInteger(seconds)||seconds<60) return false;
    await ensure();
    const result=await db.prepare(`INSERT OR IGNORE INTO pilot_welcome_expiries(chat_id,message_id,due_at)
      VALUES(?,?,?)`).bind(String(chat),messageId,clock()+seconds).run();
    return (result.meta?.changes??result.changes??0)>0;
  }
  async function nextRunAt(chat){
    await ensure();const row=await db.prepare(`SELECT MIN(due_at) AS due FROM pilot_welcome_expiries
      WHERE chat_id=? AND status='pending'`).bind(String(chat)).first();
    return row?.due??null;
  }
  async function dueGroups(limit=20){
    await ensure();const rows=await db.prepare(`SELECT chat_id FROM pilot_welcome_expiries
      WHERE status='pending' AND due_at<=? GROUP BY chat_id
      ORDER BY MIN(due_at) LIMIT ?`).bind(clock(),limit).all();
    return (rows.results||[]).map(x=>x.chat_id);
  }
  async function drain(chat,{limit=3}={}){
    if(!validChat(chat))return {done:0};await ensure();
    const now=clock();
    const rows=(await db.prepare(`SELECT message_id,attempts FROM pilot_welcome_expiries
      WHERE chat_id=? AND status='pending' AND due_at<=?
      ORDER BY due_at LIMIT ?`).bind(String(chat),now,Math.min(5,limit)).all()).results||[];
    let done=0;
    for(const row of rows){
      const locked=await db.prepare(`UPDATE pilot_welcome_expiries SET status='sending'
        WHERE chat_id=? AND message_id=? AND status='pending'`).bind(String(chat),row.message_id).run();
      if(!(locked.meta?.changes??locked.changes??0))continue;
      let status='done',next=now;
      try {
        const response=await api.call('deleteMessage',{chat_id:Number(chat),message_id:row.message_id});
        if(response!==true)throw new Error('Unconfirmed deletion');
      }catch(error) {
        // Already-deleted or too-old messages must not loop forever.
        if(error?.code===400 && /message to delete not found|message can't be deleted/i.test(error.message||'')) status='done';
        else if(row.attempts>=3)status='failed';
        else {
          status='pending';
          next=now+Math.max(60,Math.min(3600,Number(error?.retryAfter||0)||60*(row.attempts+1)));
        }
      }
      await db.prepare(`UPDATE pilot_welcome_expiries SET status=?,attempts=attempts+1,due_at=?
        WHERE chat_id=? AND message_id=? AND status='sending'`).bind(status,next,String(chat),row.message_id).run();
      if(status==='done')done++;
    }
    return {done,checked:rows.length};
  }
  async function cleanup(now=clock()){
    await ensure();await db.prepare(`DELETE FROM pilot_welcome_expiries
      WHERE status IN ('done','failed') AND due_at<?`).bind(now-30*86400).run();
  }
  return {ensure,schedule,nextRunAt,dueGroups,drain,cleanup};
}
