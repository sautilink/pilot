import { normalizeCommandExceptions } from './command-spam.js';

export const CONTROL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pilot_group_settings (
  chat_id TEXT PRIMARY KEY, settings_json TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_whitelist_rules (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('url','domain','subdomains')), value TEXT NOT NULL,
  created_by TEXT, created_at INTEGER NOT NULL, UNIQUE(chat_id,kind,value)
);
CREATE INDEX IF NOT EXISTS pilot_whitelist_chat ON pilot_whitelist_rules(chat_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_known_admins (
  user_id TEXT NOT NULL, chat_id TEXT NOT NULL, verified_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,chat_id)
);
CREATE TABLE IF NOT EXISTS pilot_audit (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, actor_id TEXT,
  action TEXT NOT NULL, target_id TEXT, incident_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_audit_chat ON pilot_audit(chat_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_appeals (
  id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, incident_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL, message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  decision TEXT CHECK(decision IN ('keep','unban','forgive')), reviewed_by TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pilot_appeals_chat ON pilot_appeals(chat_id,updated_at);
CREATE INDEX IF NOT EXISTS pilot_appeals_user ON pilot_appeals(user_id,created_at);
CREATE TABLE IF NOT EXISTS pilot_operations (
  request_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, actor_id TEXT NOT NULL,
  action TEXT NOT NULL, input_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('claimed','sending','succeeded','failed','unknown')),
  result_json TEXT, error_code TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_case_corrections (
  incident_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, user_id TEXT NOT NULL,
  actor_id TEXT, request_id TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pilot_subscriptions (
  user_id TEXT NOT NULL, chat_id TEXT NOT NULL, alerts_enabled INTEGER NOT NULL,
  report_frequency TEXT NOT NULL CHECK(report_frequency IN ('off','daily','weekly')),
  last_report_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,chat_id)
);
`;

export const CONTROL_DEFAULTS = Object.freeze({
  welcome_enabled: false, welcome_sw: '', welcome_en: '', rules_sw: '', rules_en: '',
  notice_template: 'detailed', notice_sw: '', notice_en: '',
  flood_enabled: false, flood_limit: 8, flood_window: 10, flood_action: 'delete', flood_mute_seconds: 300,
  command_spam_enabled: true, command_spam_allowlist: '',
  join_gate_enabled: false, join_gate_mode: 'review',
});

export function safeAuditDetails(details = {}) {
  const clean = {};
  if (!details || typeof details !== 'object' || Array.isArray(details)) return clean;
  for (const [key, value] of Object.entries(details).slice(0, 20)) {
    if (!/^[a-zA-Z0-9_]{1,40}$/.test(key) || /token|secret|password|authorization|cookie|message|text|error(?!_kind)/i.test(key)) continue;
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || value === null) clean[key] = value;
    else if (typeof value === 'string') clean[key] = value.slice(0, 160);
    else if (Array.isArray(value)) clean[key] = value.filter(item => typeof item === 'string' || typeof item === 'number').slice(0, 20).map(item => String(item).slice(0, 80));
  }
  return clean;
}

export function createControlStore(db) {
  const first = (sql, ...values) => db.prepare(sql).bind(...values).first();
  const run = (sql, ...values) => db.prepare(sql).bind(...values).run();
  const all = async (sql, ...values) => (await db.prepare(sql).bind(...values).all()).results || [];
  let initialized;
  const ensure = () => initialized ||= db.batch(CONTROL_SCHEMA_SQL.split(';').map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql))).catch(error => { initialized = null; throw error; });
  return {
    ensure, first, run, all,
    async settings(chat) {
      await ensure();
      const row = await first('SELECT settings_json FROM pilot_group_settings WHERE chat_id=?', String(chat));
      let saved;
      try { saved = JSON.parse(row?.settings_json || '{}'); } catch { saved = {}; }
      const settings = { ...CONTROL_DEFAULTS, ...Object.fromEntries(Object.entries(saved || {}).filter(([key]) => Object.hasOwn(CONTROL_DEFAULTS, key))) };
      // Old group settings inherit the delete-only filter. Invalid manually
      // stored values cannot turn into broad command exceptions or an action.
      if (typeof settings.command_spam_enabled !== 'boolean') settings.command_spam_enabled = CONTROL_DEFAULTS.command_spam_enabled;
      try { settings.command_spam_allowlist = normalizeCommandExceptions(settings.command_spam_allowlist); }
      catch { settings.command_spam_allowlist = CONTROL_DEFAULTS.command_spam_allowlist; }
      return settings;
    },
    async rules(chat) {
      await ensure();
      return all('SELECT id,kind,value FROM pilot_whitelist_rules WHERE chat_id=? ORDER BY created_at,id LIMIT 100', String(chat));
    },
    async rememberAdmin(user, chat, now) {
      await ensure();
      return run('INSERT INTO pilot_known_admins(user_id,chat_id,verified_at) VALUES(?,?,?) ON CONFLICT(user_id,chat_id) DO UPDATE SET verified_at=excluded.verified_at', String(user), String(chat), now);
    },
    async listAdminAssociations({ userId, chatId, limit = 100 } = {}) {
      await ensure();
      const where = [], values = [];
      if (userId != null) { where.push('user_id=?'); values.push(String(userId)); }
      if (chatId != null) { where.push('chat_id=?'); values.push(String(chatId)); }
      values.push(Math.max(1, Math.min(100, Number.isInteger(limit) ? limit : 100)));
      return all(`SELECT user_id,chat_id,verified_at FROM pilot_known_admins${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY verified_at DESC LIMIT ?`, ...values);
    },
    async audit({ id, chatId, actorId = null, action, targetId = null, incidentId = null, details = {}, at }) {
      await ensure();
      return run('INSERT OR IGNORE INTO pilot_audit(id,chat_id,actor_id,action,target_id,incident_id,details_json,created_at) VALUES(?,?,?,?,?,?,?,?)',
        String(id), String(chatId), actorId == null ? null : String(actorId), String(action).slice(0, 80), targetId == null ? null : String(targetId), incidentId == null ? null : String(incidentId), JSON.stringify(safeAuditDetails(details)), at);
    },
    async subscription(user, chat) {
      await ensure();
      const row = await first('SELECT alerts_enabled,report_frequency,last_report_at FROM pilot_subscriptions WHERE user_id=? AND chat_id=?', String(user), String(chat));
      return { alerts: !!row?.alerts_enabled, report: row?.report_frequency || 'off' };
    },
    async cleanup(now) {
      await ensure();
      // Each sweep is bounded; repeated scheduled sweeps finish larger backlogs.
      await db.batch([
        db.prepare('DELETE FROM pilot_audit WHERE id IN (SELECT id FROM pilot_audit WHERE created_at<? LIMIT 500)').bind(now - 30 * 86400),
        db.prepare('DELETE FROM pilot_appeals WHERE id IN (SELECT id FROM pilot_appeals WHERE created_at<? LIMIT 500)').bind(now - 30 * 86400),
        db.prepare('DELETE FROM pilot_operations WHERE request_id IN (SELECT request_id FROM pilot_operations WHERE updated_at<? LIMIT 500)').bind(now - 30 * 86400),
        db.prepare('DELETE FROM pilot_known_admins WHERE rowid IN (SELECT rowid FROM pilot_known_admins WHERE verified_at<? LIMIT 500)').bind(now - 180 * 86400),
        db.prepare('DELETE FROM pilot_case_corrections WHERE incident_id IN (SELECT c.incident_id FROM pilot_case_corrections c WHERE c.created_at<? AND NOT EXISTS(SELECT 1 FROM incidents i WHERE i.id=c.incident_id) LIMIT 500)').bind(now - 30 * 86400),
      ]);
    },
  };
}
