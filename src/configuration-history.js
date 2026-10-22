import { createToolsStore } from './tools-store.js';
import { createControlStore } from './control-store.js';
import { createStore } from './store.js';

export async function readConfiguration(db, chat) {
  const control = createControlStore(db), base = createStore(db);
  await control.ensure(); await base.ensureExtras();
  return {
    settings: await control.settings(chat), language: await base.getLanguage('group', chat),
    rules: await control.all('SELECT kind,value FROM pilot_whitelist_rules WHERE chat_id=? ORDER BY kind,value LIMIT 100', String(chat)),
  };
}

export async function rememberConfiguration(db, chat, actor, label, now) {
  const store = createToolsStore(db); await store.ensure();
  const snapshot = await readConfiguration(db, chat);
  const id = crypto.randomUUID();
  await db.batch([
    db.prepare('INSERT INTO pilot_config_history(id,chat_id,actor_id,label,snapshot_json,created_at) VALUES(?,?,?,?,?,?)').bind(id, String(chat), String(actor), String(label).slice(0,80), JSON.stringify(snapshot), now),
    db.prepare('DELETE FROM pilot_config_history WHERE chat_id=? AND id NOT IN (SELECT id FROM pilot_config_history WHERE chat_id=? ORDER BY created_at DESC,rowid DESC LIMIT 100)').bind(String(chat), String(chat)),
  ]);
  return id;
}
