import { createStore } from './store.js';
import { createControlStore, CONTROL_DEFAULTS, safeAuditDetails } from './control-store.js';
import { detectLinks, explainUrl, normalizeWhitelistRule } from './policy.js';
import { createGuardrailStore } from './guardrail-store.js';
import { normalizeCommandExceptions } from './command-spam.js';

export class ControlError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'ControlError';
    this.code = code;
    this.status = status;
  }
}

const admin = member => ['creator', 'administrator'].includes(member?.status);
const positiveId = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const negativeId = value => /^-[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const fail = (code, status = 400) => { throw new ControlError(code, status); };
const ACTIONS = new Set(['configure', 'whitelist_add', 'whitelist_remove', 'pause', 'resume', 'subscribe', 'appeal_create', 'appeal_resolve', 'case_unban', 'case_forgive']);
const ADMIN_VIEWS = new Set(['overview', 'incident', 'incidents', 'appeals', 'audit', 'stats', 'settings', 'whitelist']);
const NOTICE_ERRORS = new Set(['send_permission', 'topic_unavailable', 'message_rejected', 'delivery_unknown', 'telegram_rejected', 'rate_limit', 'admin_override', 'membership_changed']);
const ERROR_STATUS = { forbidden: 403, not_found: 404, case_stale: 409, case_already_corrected: 409, appeal_resolved: 409, appeal_rate_limited: 429, whitelist_limit: 409, request_conflict: 409, operation_pending: 409, operation_unknown: 409, telegram_rejected: 502, membership_unavailable: 503, internal_error: 500 };

function actorId(actor) {
  if (!object(actor) || !positiveId(actor.id)) fail('unauthorized', 401);
  return Number(actor.id);
}
function requireChat(chat) {
  if (!negativeId(chat)) fail('invalid_chat');
  return Number(chat);
}
function boundedString(value, max, code, { empty = false } = {}) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail(code);
  return value.trim();
}
function allowedKeys(value, keys, code = 'invalid_input') {
  if (!object(value) || Object.keys(value).some(key => !keys.includes(key))) fail(code);
}
function template(value, max, names) {
  const result = boundedString(value, max, 'invalid_template', { empty: true });
  const rest = result.replace(/\{([^{}]*)\}/g, (_, key) => {
    if (!names.includes(key)) fail('invalid_template');
    return '';
  });
  if (/[{}]/.test(rest)) fail('invalid_template');
  return result;
}

function normalizeSettings(input) {
  allowedKeys(input, Object.keys(CONTROL_DEFAULTS), 'invalid_settings');
  const result = {};
  const numbers = { flood_limit: [3, 30], flood_window: [5, 60], flood_mute_seconds: [60, 3600] };
  const enums = { notice_template: ['detailed', 'compact', 'formal'], flood_action: ['delete', 'mute'], join_gate_mode: ['review', 'challenge'] };
  for (const [key, value] of Object.entries(input)) {
    if (key.endsWith('_enabled')) {
      if (typeof value !== 'boolean') fail('invalid_settings');
      result[key] = value;
    } else if (numbers[key]) {
      const [min, max] = numbers[key];
      if (!Number.isInteger(value) || value < min || value > max) fail('invalid_settings');
      result[key] = value;
    } else if (enums[key]) {
      if (!enums[key].includes(value)) fail('invalid_settings');
      result[key] = value;
    } else if (key === 'command_spam_allowlist') {
      try { result[key] = normalizeCommandExceptions(value); } catch { fail('invalid_settings'); }
    } else if (key.startsWith('welcome_')) result[key] = template(value, 400, ['user', 'group', 'rules']);
    else if (key.startsWith('notice_')) result[key] = template(value, 240, ['user', 'reason', 'duration', 'group']);
    else result[key] = boundedString(value, 600, 'invalid_settings', { empty: true });
  }
  return result;
}

function normalizeInput(action, input) {
  if (!object(input)) fail('invalid_input');
  if (action === 'configure') {
    allowedKeys(input, ['settings', 'language']);
    if (input.language !== undefined && !['sw', 'en'].includes(input.language)) fail('invalid_language');
    if (input.settings === undefined && input.language === undefined) fail('invalid_input');
    return { settings: normalizeSettings(input.settings === undefined ? {} : input.settings), ...(input.language === undefined ? {} : { language: input.language }) };
  }
  if (action === 'whitelist_add') {
    allowedKeys(input, ['kind', 'value']);
    try { return normalizeWhitelistRule(input); } catch { fail('invalid_rule'); }
  }
  if (action === 'whitelist_remove') {
    allowedKeys(input, ['id']);
    return { id: boundedString(input.id, 128, 'invalid_rule') };
  }
  if (action === 'subscribe') {
    allowedKeys(input, ['alerts', 'report']);
    if (input.alerts === undefined && input.report === undefined) fail('invalid_subscription');
    if (input.alerts !== undefined && typeof input.alerts !== 'boolean') fail('invalid_subscription');
    if (input.report !== undefined && !['off', 'daily', 'weekly'].includes(input.report)) fail('invalid_subscription');
    return { ...(input.alerts === undefined ? {} : { alerts: input.alerts }), ...(input.report === undefined ? {} : { report: input.report }) };
  }
  if (action === 'appeal_create') {
    allowedKeys(input, ['incidentId', 'message']);
    return { incidentId: boundedString(input.incidentId, 180, 'invalid_case'), message: boundedString(input.message, 1000, 'invalid_appeal') };
  }
  if (action === 'appeal_resolve') {
    allowedKeys(input, ['appealId', 'decision']);
    if (!['keep', 'unban', 'forgive'].includes(input.decision)) fail('invalid_decision');
    return { appealId: boundedString(input.appealId, 128, 'invalid_appeal'), decision: input.decision };
  }
  if (action === 'case_unban' || action === 'case_forgive') {
    allowedKeys(input, ['incidentId']);
    return { incidentId: boundedString(input.incidentId, 180, 'invalid_case') };
  }
  allowedKeys(input, []);
  return {};
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function inputHash(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(input)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function json(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function appealResult(row) {
  // Replay records contain metadata only; appeal text lives solely in its bounded table.
  return { id: row.id, incident_id: row.incident_id, user_id: row.user_id, status: row.status, decision: row.decision, reviewed_by: row.reviewed_by, created_at: row.created_at, updated_at: row.updated_at };
}

export function createControlService({ db, api, clock = () => Math.floor(Date.now() / 1000) }) {
  const store = createControlStore(db), base = createStore(db), guards = createGuardrailStore(db);
  let bot;
  const me = async () => bot ||= await api.call('getMe');
  const member = (chat, user) => api.call('getChatMember', { chat_id: Number(chat), user_id: Number(user) });

  async function authorize(user, chat) {
    let current;
    try { current = await member(chat, user); } catch { fail('authorization_unavailable', 503); }
    if (!admin(current)) fail('forbidden', 403);
    await store.rememberAdmin(user, chat, clock());
  }

  async function chatInfo(chat) {
    let info;
    try { info = await api.call('getChat', { chat_id: chat }); } catch { fail('chat_unavailable', 503); }
    if (!['group', 'supergroup'].includes(info?.type) || Number(info.id) !== Number(chat)) fail('invalid_chat');
    return { id: Number(info.id), title: String(info.title || '').slice(0, 128), type: info.type };
  }

  const caseSelect = `SELECT i.*,n.status AS notification_status,n.error_kind AS notification_error,n.attempts AS notification_attempts,n.updated_at AS notification_updated,
    a.id AS appeal_id,a.status AS appeal_status,a.decision AS appeal_decision,
    c.incident_id AS corrected_incident FROM incidents i
    LEFT JOIN notification_delivery n ON n.incident_id=i.id
    LEFT JOIN pilot_appeals a ON a.incident_id=i.id
    LEFT JOIN pilot_case_corrections c ON c.incident_id=i.id`;

  function caseView(row) {
    return {
      id: row.id, chat_id: String(row.chat_id), user_id: row.user_id == null ? null : String(row.user_id),
      message_id: row.message_id, event_at: row.event_at, created_at: row.created_at, strike: row.strike,
      until_date: row.until_date, status: row.status, deleted: !!row.deleted,
      reasons: (Array.isArray(json(row.reasons, [])) ? json(row.reasons, []) : []).filter(reason => ['link', 'forward'].includes(reason)),
      notification: row.notification_status ? {
        status: ['pending', 'sending', 'sent', 'unknown', 'failed', 'cancelled'].includes(row.notification_status) ? row.notification_status : 'unknown',
        error_kind: NOTICE_ERRORS.has(row.notification_error) ? row.notification_error : null,
        attempts: Number(row.notification_attempts || 0), updated_at: Number(row.notification_updated || 0),
      } : null,
      appeal: row.appeal_id ? { id: row.appeal_id, status: row.appeal_status, decision: row.appeal_decision } : null,
      corrected: !!row.corrected_incident,
    };
  }

  async function cases(where, values) {
    return (await store.all(`${caseSelect} WHERE (${where}) AND i.created_at>=? ORDER BY i.created_at DESC,i.rowid DESC LIMIT 50`, ...values, clock() - 30 * 86400)).map(caseView);
  }

  async function stats(chat) {
    const now = clock(), result = {};
    // Group reports use East Africa Time; the longer windows are rolling periods.
    for (const [period, since] of [['today', now - (now + 3 * 3600) % 86400], ['week', now - 7 * 86400], ['month', now - 30 * 86400]]) {
      const row = await store.first(`SELECT COUNT(*) AS incidents,
        COALESCE(SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END),0) AS confirmed,
        COALESCE(SUM(CASE WHEN instr(reasons,'"forward"')>0 THEN 1 ELSE 0 END),0) AS forwards,
        COALESCE(SUM(CASE WHEN instr(reasons,'"link"')>0 THEN 1 ELSE 0 END),0) AS links
        FROM incidents WHERE chat_id=? AND created_at>=?`, String(chat), since);
      result[period] = { incidents: Number(row.incidents), confirmed: Number(row.confirmed), forwards: Number(row.forwards), links: Number(row.links) };
    }
    return result;
  }

  async function query({ actor, chatId, view, input = {} }) {
    const user = actorId(actor);
    await store.ensure();
    await base.ensureExtras();
    if (view === 'groups') {
      allowedKeys(input, ['cursor']);
      if (input.cursor !== undefined && (typeof input.cursor !== 'string' || !negativeId(input.cursor))) fail('invalid_cursor');
      const session = await base.adminContext(user);
      const saved = session && negativeId(session.chat_id) ? String(session.chat_id) : null;
      const cursor = input.cursor ?? null;
      // Cursor order cannot depend on verified_at: fresh checks update it. Scan
      // revoked entries too so an empty authorized page still advances safely.
      const candidates = await store.all(`SELECT chat_id FROM (
        SELECT chat_id FROM pilot_known_admins WHERE user_id=?
        UNION SELECT ? AS chat_id WHERE ? IS NOT NULL
      ) WHERE (? IS NULL OR chat_id>?) ORDER BY chat_id ASC LIMIT 21`, String(user), saved, saved, cursor, cursor);
      const page = candidates.slice(0, 20);
      const groups = [];
      for (const { chat_id: id } of page) {
        if (!negativeId(id)) continue;
        try { await authorize(user, Number(id)); groups.push(await chatInfo(Number(id))); } catch { /* Revoked/unavailable groups disclose no name. */ }
      }
      return { ok: true, groups, nextCursor: candidates.length > 20 ? page.at(-1).chat_id : null };
    }
    if (view === 'mystatus') {
      const chat = chatId == null ? null : requireChat(chatId);
      return { ok: true, incidents: await cases(`i.user_id=?${chat === null ? '' : ' AND i.chat_id=?'}`, chat === null ? [String(user)] : [String(user), String(chat)]) };
    }
    if (view === 'checklink') {
      allowedKeys(input, ['text']);
      const text = boundedString(input.text, 4096, 'invalid_text');
      let rules = [], scope = { type: 'base' };
      if (chatId != null) {
        const chat = requireChat(chatId);
        let current;
        try { current = await member(chat, user); } catch { current = null; }
        const permitted = admin(current) || current?.status === 'member' || (current?.status === 'restricted' && current.is_member === true);
        if (!permitted && !await store.first('SELECT id FROM incidents WHERE chat_id=? AND user_id=? LIMIT 1', String(chat), String(user))) fail('forbidden', 403);
        rules = await store.rules(chat);
        scope = { type: 'group', chatId: chat };
      }
      return { ok: true, scope, destinations: detectLinks({ text }).map(value => explainUrl(value, rules)), forwardWarning: true };
    }
    if (!ADMIN_VIEWS.has(view)) fail('invalid_view');
    const chat = requireChat(chatId);
    await authorize(user, chat);
    const group = await chatInfo(chat);
    const moderation = await base.group(chat);
    let own;
    try { own = await member(chat, (await me()).id); } catch { own = null; }
    const since = clock() - 30 * 86400;
    const audit = (await store.all('SELECT id,actor_id,action,target_id,incident_id,details_json,created_at FROM pilot_audit WHERE chat_id=? AND created_at>=? ORDER BY created_at DESC,rowid DESC LIMIT 50', String(chat), since))
      .map(row => ({ id: row.id, actor_id: row.actor_id, action: row.action, target_id: row.target_id, incident_id: row.incident_id, details: safeAuditDetails(json(row.details_json, {})), created_at: row.created_at }));
    return {
      ok: true, group,
      moderation: { enabled: !!moderation.enabled, permissionsComplete: admin(own) && !!own.can_delete_messages && !!own.can_restrict_members },
      language: await base.getLanguage('group', chat), settings: await store.settings(chat), rules: await store.rules(chat),
      subscription: await store.subscription(user, chat), incidents: await cases('i.chat_id=?', [String(chat)]),
      appeals: await store.all('SELECT id,incident_id,user_id,message,status,decision,reviewed_by,created_at,updated_at FROM pilot_appeals WHERE chat_id=? AND created_at>=? ORDER BY updated_at DESC,rowid DESC LIMIT 50', String(chat), since),
      audit, stats: await stats(chat), joins: await guards.joins(chat),
    };
  }

  async function claim({ user, chat, action, input, requestId }) {
    const hash = await inputHash(input), now = clock();
    const insert = await store.run("INSERT OR IGNORE INTO pilot_operations(request_id,chat_id,actor_id,action,input_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,'claimed',?,?)", requestId, String(chat), String(user), action, hash, now, now);
    if ((insert.meta?.changes ?? insert.changes ?? 0) > 0) return null;
    const operation = await store.first('SELECT * FROM pilot_operations WHERE request_id=?', requestId);
    if (!operation || operation.chat_id !== String(chat) || operation.actor_id !== String(user) || operation.action !== action || operation.input_hash !== hash) fail('request_conflict', 409);
    if (operation.status === 'succeeded') return { ...json(operation.result_json, { ok: true }), duplicate: true };
    if (operation.status === 'failed') fail(operation.error_code || 'internal_error', ERROR_STATUS[operation.error_code] || 400);
    fail(operation.status === 'claimed' ? 'operation_pending' : 'operation_unknown', 409);
  }

  async function finish(operation, result, statements = [], details = {}, targetId = null, incidentId = null) {
    const now = clock();
    await db.batch([
      ...statements,
      db.prepare('INSERT OR IGNORE INTO pilot_audit(id,chat_id,actor_id,action,target_id,incident_id,details_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
        .bind(`operation:${operation.requestId}`, String(operation.chat), String(operation.user), operation.action, targetId == null ? null : String(targetId), incidentId, JSON.stringify(safeAuditDetails(details)), now),
      db.prepare("UPDATE pilot_operations SET status='succeeded',result_json=?,error_code=NULL,updated_at=? WHERE request_id=?")
        .bind(JSON.stringify(result), now, operation.requestId),
    ]);
    return result;
  }

  async function currentCase(chat, incidentId, { correcting = false } = {}) {
    const row = await store.first('SELECT * FROM incidents WHERE id=? AND chat_id=?', incidentId, String(chat));
    if (!row || !positiveId(row.user_id)) fail('not_found', 404);
    const state = await store.first('SELECT * FROM members WHERE chat_id=? AND user_id=?', String(chat), String(row.user_id));
    const latest = await store.first('SELECT id FROM incidents WHERE chat_id=? AND user_id=? ORDER BY event_at DESC,created_at DESC,rowid DESC LIMIT 1', String(chat), String(row.user_id));
    const correction = await store.first('SELECT incident_id FROM pilot_case_corrections WHERE incident_id=?', incidentId);
    if (correcting && correction) fail('case_already_corrected', 409);
    if (!state || state.last_incident !== row.id || latest?.id !== row.id || state.override_at > row.event_at) fail('case_stale', 409);
    if (correcting ? (row.status !== 'confirmed' || state.strikes < 1) : !(row.status === 'confirmed' || (row.status === 'cancelled' && correction))) fail('case_stale', 409);
    return { row, state };
  }

  async function correctCase(operation, incidentId, appealId = null) {
    const { row, state } = await currentCase(operation.chat, incidentId, { correcting: true });
    const now = clock();
    const statements = [
      db.prepare('INSERT INTO pilot_case_corrections(incident_id,chat_id,user_id,actor_id,request_id,created_at) VALUES(?,?,?,?,?,?)')
        .bind(row.id, String(operation.chat), String(row.user_id), String(operation.user), operation.requestId, now),
      db.prepare('UPDATE members SET strikes=strikes-1,override_at=MAX(override_at,?) WHERE chat_id=? AND user_id=? AND last_incident=? AND strikes>0')
        .bind(row.event_at, String(operation.chat), String(row.user_id), row.id),
      db.prepare("UPDATE incidents SET status='cancelled' WHERE id=?").bind(row.id),
      db.prepare("UPDATE notification_delivery SET status='cancelled',error_kind='admin_override',updated_at=? WHERE incident_id=? AND status='pending'").bind(now, row.id),
      db.prepare("UPDATE pilot_appeals SET status='resolved',decision='forgive',reviewed_by=?,updated_at=? WHERE incident_id=? AND chat_id=? AND status='open'")
        .bind(String(operation.user), now, row.id, String(operation.chat)),
    ];
    return finish(operation, { ok: true, incidentId: row.id, corrected: true, strikes: state.strikes - 1, banPreserved: true, ...(appealId ? { appealId, decision: 'forgive' } : {}) }, statements,
      { decision: 'forgive', strikes_before: state.strikes, strikes_after: state.strikes - 1, ban_preserved: true }, row.user_id, row.id);
  }

  async function unbanCase(operation, incidentId, tracker, appealId = null) {
    let current = await currentCase(operation.chat, incidentId);
    const live = await member(operation.chat, current.row.user_id).catch(() => fail('membership_unavailable', 503));
    // Re-read local state after the network call so an observed newer override wins.
    current = await currentCase(operation.chat, incidentId);
    const { row, state } = current;
    if (live?.status !== 'kicked' || Number(live.until_date || 0) !== Number(row.until_date) || state.active_until !== (row.until_date || -1) || (row.until_date > 0 && row.until_date <= clock())) fail('case_stale', 409);
    await store.run("UPDATE pilot_operations SET status='sending',updated_at=? WHERE request_id=?", clock(), operation.requestId);
    tracker.started = true;
    try {
      const confirmed = await api.call('unbanChatMember', { chat_id: operation.chat, user_id: Number(row.user_id), only_if_banned: true });
      if (confirmed !== true) fail('operation_unknown', 409);
    }
    catch (error) {
      if (error?.ambiguous === false) {
        const rejected = new ControlError('telegram_rejected', 502);
        rejected.definite = true;
        throw rejected;
      }
      fail('operation_unknown', 409);
    }
    const now = clock();
    const statements = [
      db.prepare('UPDATE members SET active_until=0,override_at=MAX(override_at,?) WHERE chat_id=? AND user_id=? AND last_incident=?')
        .bind(now, String(operation.chat), String(row.user_id), row.id),
      db.prepare("UPDATE incidents SET status='cancelled' WHERE chat_id=? AND user_id=? AND event_at<=?").bind(String(operation.chat), String(row.user_id), now),
      db.prepare("UPDATE notification_delivery SET status='cancelled',error_kind='admin_override',updated_at=? WHERE status='pending' AND incident_id IN (SELECT id FROM incidents WHERE chat_id=? AND user_id=? AND event_at<=?)")
        .bind(now, String(operation.chat), String(row.user_id), now),
      db.prepare("UPDATE pilot_appeals SET status='resolved',decision='unban',reviewed_by=?,updated_at=? WHERE incident_id=? AND chat_id=? AND status='open'")
        .bind(String(operation.user), now, row.id, String(operation.chat)),
    ];
    return finish(operation, { ok: true, incidentId: row.id, unbanned: true, strikes: state.strikes, ...(appealId ? { appealId, decision: 'unban' } : {}) }, statements, { decision: 'unban', strikes_preserved: true }, row.user_id, row.id);
  }

  async function mutate({ actor, chatId, action, input = {}, requestId }) {
    const user = actorId(actor), chat = requireChat(chatId);
    if (!ACTIONS.has(action)) fail('invalid_action');
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)) fail('invalid_request_id');
    const clean = normalizeInput(action, input);
    await store.ensure();
    await base.ensureExtras();
    if (action === 'appeal_create') {
      if (!await store.first('SELECT id FROM incidents WHERE id=? AND chat_id=? AND user_id=?', clean.incidentId, String(chat), String(user))) fail('not_found', 404);
    } else await authorize(user, chat);
    const operation = { user, chat, action, requestId };
    const duplicate = await claim({ ...operation, input: clean });
    if (duplicate) return duplicate;
    const tracker = { started: false };
    try {
      const now = clock();
      if (action === 'configure') {
        const settings = { ...await store.settings(chat), ...clean.settings };
        const statements = [db.prepare('INSERT INTO pilot_group_settings(chat_id,settings_json,updated_at) VALUES(?,?,?) ON CONFLICT(chat_id) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at').bind(String(chat), JSON.stringify(settings), now)];
        if (clean.language) statements.push(db.prepare("INSERT INTO language_preferences(scope,subject_id,language,updated_at) VALUES('group',?,?,?) ON CONFLICT(scope,subject_id) DO UPDATE SET language=excluded.language,updated_at=excluded.updated_at").bind(String(chat), clean.language, now));
        return await finish(operation, { ok: true, settings, language: clean.language || await base.getLanguage('group', chat) }, statements, { keys: Object.keys(clean.settings), ...(clean.language ? { language: clean.language } : {}) });
      }
      if (action === 'whitelist_add') {
        const existing = await store.first('SELECT id,kind,value FROM pilot_whitelist_rules WHERE chat_id=? AND kind=? AND value=?', String(chat), clean.kind, clean.value);
        if (existing) return await finish(operation, { ok: true, rule: existing, duplicate: true }, [], { duplicate: true });
        if ((await store.first('SELECT COUNT(*) AS count FROM pilot_whitelist_rules WHERE chat_id=?', String(chat))).count >= 100) fail('whitelist_limit', 409);
        const rule = { id: crypto.randomUUID(), ...clean };
        return await finish(operation, { ok: true, rule }, [db.prepare('INSERT INTO pilot_whitelist_rules(id,chat_id,kind,value,created_by,created_at) VALUES(?,?,?,?,?,?)').bind(rule.id, String(chat), rule.kind, rule.value, String(user), now)], { kind: rule.kind, value: rule.value });
      }
      if (action === 'whitelist_remove') {
        const rule = await store.first('SELECT id,kind,value FROM pilot_whitelist_rules WHERE id=? AND chat_id=?', clean.id, String(chat));
        if (!rule) fail('not_found', 404);
        return await finish(operation, { ok: true, removed: clean.id }, [db.prepare('DELETE FROM pilot_whitelist_rules WHERE id=? AND chat_id=?').bind(clean.id, String(chat))], { kind: rule.kind, value: rule.value });
      }
      if (action === 'pause' || action === 'resume') {
        return await finish(operation, { ok: true, enabled: action === 'resume' }, [
          db.prepare('INSERT OR IGNORE INTO groups(chat_id) VALUES(?)').bind(String(chat)),
          db.prepare('UPDATE groups SET enabled=?,activated_at=? WHERE chat_id=?').bind(action === 'resume' ? 1 : 0, now, String(chat)),
        ], { enabled: action === 'resume' });
      }
      if (action === 'subscribe') {
        const subscription = { ...await store.subscription(user, chat), ...clean };
        return await finish(operation, { ok: true, subscription }, [db.prepare('INSERT INTO pilot_subscriptions(user_id,chat_id,alerts_enabled,report_frequency,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,chat_id) DO UPDATE SET alerts_enabled=excluded.alerts_enabled,report_frequency=excluded.report_frequency,updated_at=excluded.updated_at').bind(String(user), String(chat), subscription.alerts ? 1 : 0, subscription.report, now)], subscription);
      }
      if (action === 'appeal_create') {
        const existing = await store.first('SELECT * FROM pilot_appeals WHERE incident_id=? AND chat_id=? AND user_id=?', clean.incidentId, String(chat), String(user));
        if (existing) return await finish(operation, { ok: true, appeal: appealResult(existing), duplicate: true }, [], { duplicate: true }, user, clean.incidentId);
        const recent = await store.first('SELECT COUNT(*) AS count,MAX(created_at) AS latest FROM pilot_appeals WHERE user_id=? AND created_at>=?', String(user), now - 86400);
        if (recent.count >= 3 || (recent.latest != null && now - recent.latest < 60)) fail('appeal_rate_limited', 429);
        const appeal = { id: crypto.randomUUID(), incident_id: clean.incidentId, user_id: String(user), message: clean.message, status: 'open', decision: null, reviewed_by: null, created_at: now, updated_at: now };
        return await finish(operation, { ok: true, appeal: appealResult(appeal) }, [db.prepare("INSERT INTO pilot_appeals(id,chat_id,incident_id,user_id,message,status,created_at,updated_at) VALUES(?,?,?,?,?,'open',?,?)").bind(appeal.id, String(chat), clean.incidentId, String(user), clean.message, now, now)], {}, user, clean.incidentId);
      }
      if (action === 'case_forgive') return await correctCase(operation, clean.incidentId);
      if (action === 'case_unban') return await unbanCase(operation, clean.incidentId, tracker);
      const appeal = await store.first('SELECT * FROM pilot_appeals WHERE id=? AND chat_id=?', clean.appealId, String(chat));
      if (!appeal) fail('not_found', 404);
      if (appeal.status !== 'open') fail('appeal_resolved', 409);
      if (clean.decision === 'forgive') return await correctCase(operation, appeal.incident_id, appeal.id);
      if (clean.decision === 'unban') return await unbanCase(operation, appeal.incident_id, tracker, appeal.id);
      return await finish(operation, { ok: true, appealId: appeal.id, decision: 'keep' }, [db.prepare("UPDATE pilot_appeals SET status='resolved',decision='keep',reviewed_by=?,updated_at=? WHERE id=? AND chat_id=? AND status='open'").bind(String(user), now, appeal.id, String(chat))], { decision: 'keep' }, appeal.user_id, appeal.incident_id);
    } catch (error) {
      const status = tracker.started && error?.definite !== true ? 'unknown' : 'failed';
      const code = status === 'unknown' ? 'operation_unknown' : error instanceof ControlError ? error.code : 'internal_error';
      try {
        await db.batch([
          db.prepare('UPDATE pilot_operations SET status=?,error_code=?,updated_at=? WHERE request_id=?').bind(status, code, clock(), requestId),
          db.prepare('INSERT OR IGNORE INTO pilot_audit(id,chat_id,actor_id,action,details_json,created_at) VALUES(?,?,?,?,?,?)')
            .bind(`operation:${requestId}`, String(chat), String(user), action, JSON.stringify({ status, error_kind: code }), clock()),
        ]);
      } catch { /* Keep the original claim when storage is temporarily unavailable. */ }
      throw new ControlError(code, status === 'unknown' ? 409 : error instanceof ControlError ? error.status : 500);
    }
  }

  const sanitized = fn => async input => {
    try { return await fn(input); }
    catch (error) { if (error instanceof ControlError) throw error; throw new ControlError('internal_error', 500); }
  };
  return { query: sanitized(query), mutate: sanitized(mutate) };
}
