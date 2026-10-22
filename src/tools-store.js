import { ensureSchemaFamily } from './schema-ready.js';

export const TOOLS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pilot_config_history (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  label TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_config_history_chat ON pilot_config_history(chat_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_temporary_links (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, url TEXT NOT NULL,
  expires_at INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  UNIQUE(chat_id,url)
);
CREATE INDEX IF NOT EXISTS pilot_temporary_links_chat ON pilot_temporary_links(chat_id,expires_at);
CREATE TABLE IF NOT EXISTS pilot_tool_operations (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL,
  input_hash TEXT NOT NULL, status TEXT NOT NULL, result_json TEXT, error_code TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_raid_settings (
  chat_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0,
  join_threshold INTEGER NOT NULL DEFAULT 10, spam_threshold INTEGER NOT NULL DEFAULT 8,
  window_seconds INTEGER NOT NULL DEFAULT 60, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_raid_signals (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, user_id TEXT NOT NULL,
  kind TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_raid_signals_window ON pilot_raid_signals(chat_id,kind,created_at);
CREATE TABLE IF NOT EXISTS pilot_raid_alerts (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, kind TEXT NOT NULL,
  count INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_raid_alerts_chat ON pilot_raid_alerts(chat_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_raid_lockdowns (
  chat_id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, before_json TEXT NOT NULL,
  applied_json TEXT NOT NULL, status TEXT NOT NULL, until_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_raid_lockdowns_due ON pilot_raid_lockdowns(status,until_at);
CREATE TABLE IF NOT EXISTS pilot_integration_tokens (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, actor_id TEXT NOT NULL, label TEXT NOT NULL,
  token_hash TEXT NOT NULL, scopes_json TEXT NOT NULL, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, revoked_at INTEGER NOT NULL DEFAULT 0, last_used_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pilot_integration_tokens_chat ON pilot_integration_tokens(chat_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_integration_limits (
  token_id TEXT NOT NULL, bucket INTEGER NOT NULL, uses INTEGER NOT NULL,
  PRIMARY KEY(token_id,bucket)
);
CREATE TABLE IF NOT EXISTS pilot_integration_drafts (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, token_id TEXT NOT NULL, title TEXT NOT NULL,
  text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', reviewed_by TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_integration_drafts_chat ON pilot_integration_drafts(chat_id,created_at);
`;

export const json = (value, fallback = null) => { try { return JSON.parse(value); } catch { return fallback; } };
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function digest(value) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(typeof value === 'string' ? value : stableJson(value)));
  return Array.from(new Uint8Array(data), byte => byte.toString(16).padStart(2, '0')).join('');
}
export class ToolsError extends Error {
  constructor(code, status = 400) { super(code); this.name = 'ToolsError'; this.code = code; this.status = status; }
}
export const fail = (code, status = 400) => { throw new ToolsError(code, status); };
export const isAdmin = member => ['creator', 'administrator'].includes(member?.status);
export const isMember = member => isAdmin(member) || member?.status === 'member' || (member?.status === 'restricted' && member.is_member === true);
export function validActor(actor) {
  if (!Number.isSafeInteger(actor?.id) || actor.id <= 0 || actor.is_bot) fail('unauthorized', 401);
  return String(actor.id);
}
export function validChat(chat) {
  if (!/^-[1-9]\d{0,15}$/.test(String(chat)) || !Number.isSafeInteger(Number(chat))) fail('invalid_chat');
  return String(chat);
}
export function objectKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) fail('invalid_input');
}
export function textValue(value, max, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail('invalid_input');
  return value.trim();
}
export function createToolsStore(db) {
  const ensure = () => ensureSchemaFamily(db, 'tools', TOOLS_SCHEMA_SQL, '1');
  const first = (sql, ...args) => db.prepare(sql).bind(...args).first();
  const all = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
  const run = (sql, ...args) => db.prepare(sql).bind(...args).run();
  async function claim({ actor, chatId, action, input, requestId }, now) {
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) fail('invalid_request_id');
    const user = validActor(actor), chat = String(chatId), hash = await digest(input);
    const result = await run("INSERT OR IGNORE INTO pilot_tool_operations(id,chat_id,actor_id,action,input_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,'claimed',?,?)", requestId, chat, user, action, hash, now, now);
    if (Number(result.meta?.changes || result.changes || 0)) return null;
    const row = await first('SELECT * FROM pilot_tool_operations WHERE id=?', requestId);
    if (!row || row.chat_id !== chat || row.actor_id !== user || row.action !== action || row.input_hash !== hash) fail('request_conflict', 409);
    if (row.status === 'succeeded') return { ...json(row.result_json, { ok: true }), duplicate: true };
    if (row.status === 'failed') fail(row.error_code || 'operation_failed', 409);
    fail(row.status === 'sending' || row.status === 'unknown' ? 'operation_unknown' : 'operation_pending', 409);
  }
  async function finish(requestId, result, now, statements = []) {
    await db.batch([...statements, db.prepare("UPDATE pilot_tool_operations SET status='succeeded',result_json=?,updated_at=? WHERE id=?").bind(JSON.stringify(result), now, requestId)]);
    return result;
  }
  async function cleanup(now) {
    await ensure();
    const tables = [
      ['pilot_config_history', 'created_at', now - 90 * 86400], ['pilot_temporary_links', 'expires_at', now - 86400],
      ['pilot_tool_operations', 'updated_at', now - 30 * 86400], ['pilot_raid_signals', 'created_at', now - 86400],
      ['pilot_raid_alerts', 'created_at', now - 30 * 86400], ['pilot_integration_drafts', 'created_at', now - 30 * 86400],
      ['pilot_integration_tokens', 'expires_at', now - 30 * 86400], ['pilot_integration_limits', 'bucket', Math.floor(now / 60) - 1440],
    ];
    await db.batch(tables.map(([table, field, before]) => db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${field}<? LIMIT 500)`).bind(before)));
  }
  return { ensure, first, all, run, claim, finish, cleanup };
}
