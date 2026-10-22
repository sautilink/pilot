import { createSupportStore } from './support-store.js';
import { createToolsStore, fail, isAdmin, isMember, validActor, validChat, objectKeys, textValue } from './tools-store.js';
import { createControlStore } from './control-store.js';

export const SUPPORT_READS = new Set(['support', 'support_ticket']);
export const SUPPORT_ACTIONS = new Set(['support_settings', 'ticket_create', 'ticket_reply', 'ticket_claim', 'ticket_status']);
const RETENTION = 90 * 86400, uid = () => crypto.randomUUID().replaceAll('-', '');
const ticketView = (row, admin) => ({ id: row.id, number: `P-${row.number}`, subject: row.subject, language: row.language, status: row.status,
  claimed: !!row.claimed_by, created_at: row.created_at, updated_at: row.updated_at,
  ...(admin ? { user_id: row.user_id, claimed_by: row.claimed_by } : {}) });

export function createSupportService({ db, api, clock = () => Math.floor(Date.now() / 1000) }) {
  const store = createSupportStore(db), tools = createToolsStore(db), control = createControlStore(db);
  let bot;
  async function role(chat, user) {
    try { return await api.call('getChatMember', { chat_id: Number(chat), user_id: Number(user) }); }
    catch { fail('authorization_unavailable', 503); }
  }
  async function authorize(actor, chatId, adminOnly = false) {
    const user = validActor(actor), chat = validChat(chatId), current = await role(chat, user);
    if (adminOnly ? !isAdmin(current) : !isMember(current)) fail('forbidden', 403);
    return { user, chat, admin: isAdmin(current) };
  }
  async function ready() { await Promise.all([store.ensure(), tools.ensure(), control.ensure()]); }
  async function ticket(chat, id, user, admin) {
    const row = await store.first('SELECT * FROM pilot_support_tickets WHERE id=? AND chat_id=? AND updated_at>=?', id, chat, clock() - RETENTION);
    if (!row || !admin && row.user_id !== user) fail('not_found', 404);
    return row;
  }
  async function checkClaim(row, user) {
    if (row.claimed_by && row.claimed_by !== user && isAdmin(await role(row.chat_id, row.claimed_by))) fail('ticket_claimed', 409);
  }
  async function query({ actor, chatId, view, input = {} }) {
    if (!SUPPORT_READS.has(view)) fail('invalid_view');
    const { user, chat, admin } = await authorize(actor, chatId); await ready();
    const enabled = !!(await store.first('SELECT enabled FROM pilot_support_settings WHERE chat_id=?', chat))?.enabled;
    const contactReady = !!await store.privateContact(user);
    if (view === 'support_ticket') {
      objectKeys(input, ['id']); const row = await ticket(chat, textValue(input.id, 80), user, admin);
      const messages = await store.all(`SELECT m.id,m.author_role,m.body,m.created_at,d.status AS delivery_status
        FROM pilot_support_messages m LEFT JOIN pilot_support_deliveries d ON d.message_id=m.id
        WHERE m.ticket_id=? ORDER BY m.created_at,m.rowid LIMIT 100`, row.id);
      return { admin, enabled, contactReady, ticket: ticketView(row, admin), messages };
    }
    objectKeys(input, ['status']);
    if (input.status && !['open', 'in_progress', 'resolved'].includes(input.status)) fail('invalid_status');
    const where = ['chat_id=?', 'updated_at>=?'], values = [chat, clock() - RETENTION];
    if (!admin) { where.push('user_id=?'); values.push(user); }
    if (input.status) { where.push('status=?'); values.push(input.status); }
    const rows = await store.all(`SELECT * FROM pilot_support_tickets WHERE ${where.join(' AND ')} ORDER BY CASE status WHEN 'resolved' THEN 1 ELSE 0 END,updated_at DESC,id LIMIT 100`, ...values);
    return { admin, enabled, contactReady, tickets: rows.map(row => ticketView(row, admin)) };
  }
  function normalize(action, input) {
    if (action === 'support_settings') { objectKeys(input, ['enabled']); if (typeof input.enabled !== 'boolean') fail('invalid_input'); return { enabled: input.enabled }; }
    if (action === 'ticket_create') {
      objectKeys(input, ['subject', 'body', 'language']); if (!['en', 'sw'].includes(input.language)) fail('invalid_language');
      return { subject: textValue(input.subject, 120), body: textValue(input.body, 2000), language: input.language };
    }
    if (action === 'ticket_reply') { objectKeys(input, ['id', 'body']); return { id: textValue(input.id, 80), body: textValue(input.body, 2000) }; }
    if (action === 'ticket_claim') { objectKeys(input, ['id']); return { id: textValue(input.id, 80) }; }
    if (action === 'ticket_status') {
      objectKeys(input, ['id', 'status']); if (!['open', 'in_progress', 'resolved'].includes(input.status)) fail('invalid_status');
      return { id: textValue(input.id, 80), status: input.status };
    }
    fail('invalid_action');
  }
  async function perform({ actor, chatId, action, input = {}, requestId }) {
    if (!SUPPORT_ACTIONS.has(action)) fail('invalid_action');
    const value = normalize(action, input), auth = await authorize(actor, chatId, ['support_settings', 'ticket_claim'].includes(action));
    const { user, chat, admin } = auth; await ready();
    const replay = await tools.claim({ actor, chatId: chat, action, input: value, requestId }, clock()); if (replay) return replay;
    try {
      const now = clock(), statements = [];
      let result;
      if (action === 'support_settings') {
        statements.push(db.prepare('INSERT INTO pilot_support_settings(chat_id,enabled,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(chat, Number(value.enabled), user, now));
        result = { ok: true, enabled: value.enabled };
      } else if (action === 'ticket_create') {
        if (!await store.privateContact(user)) fail('private_chat_required', 409);
        if (!(await store.first('SELECT enabled FROM pilot_support_settings WHERE chat_id=?', chat))?.enabled) fail('support_disabled', 409);
        const counts = await store.first(`SELECT SUM(CASE WHEN user_id=? AND status!='resolved' THEN 1 ELSE 0 END) AS own_open,
          SUM(CASE WHEN status!='resolved' THEN 1 ELSE 0 END) AS group_open,
          SUM(CASE WHEN user_id=? AND created_at>=? THEN 1 ELSE 0 END) AS recent
          FROM pilot_support_tickets WHERE chat_id=? AND updated_at>=?`, user, user, now - 3600, chat, now - RETENTION);
        if (Number(counts.own_open) >= 3 || Number(counts.group_open) >= 100 || Number(counts.recent) >= 3) fail('ticket_rate_limited', 429);
        const number = Number((await store.first('SELECT last_number FROM pilot_support_counters WHERE chat_id=?', chat))?.last_number || 0) + 1;
        const id = uid(), messageId = uid();
        statements.push(db.prepare('INSERT INTO pilot_support_counters(chat_id,last_number) VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET last_number=excluded.last_number').bind(chat, number),
          db.prepare('INSERT INTO pilot_support_tickets(id,number,chat_id,user_id,subject,language,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id, number, chat, user, value.subject, value.language, now, now),
          db.prepare("INSERT INTO pilot_support_messages(id,ticket_id,author_id,author_role,body,created_at) VALUES(?,?,?,'member',?,?)").bind(messageId, id, user, value.body, now));
        result = { ok: true, id, number: `P-${number}`, status: 'open' };
      } else {
        const row = await ticket(chat, value.id, user, admin);
        if (action === 'ticket_reply') {
          if (row.status === 'resolved') fail('ticket_resolved', 409);
          if (admin && row.user_id !== user) await checkClaim(row, user);
          if (!admin && !await store.privateContact(user)) fail('private_chat_required', 409);
          const counts = await store.first('SELECT COUNT(*) AS total,SUM(CASE WHEN author_id=? AND created_at>=? THEN 1 ELSE 0 END) AS recent FROM pilot_support_messages WHERE ticket_id=?', user, now - 3600, row.id);
          if (Number(counts.total) >= 100 || Number(counts.recent) >= 10) fail('ticket_rate_limited', 429);
          const messageId = uid(), replyAsAdmin = admin && row.user_id !== user;
          statements.push(db.prepare('INSERT INTO pilot_support_messages(id,ticket_id,author_id,author_role,body,created_at) VALUES(?,?,?,?,?,?)').bind(messageId, row.id, user, replyAsAdmin ? 'admin' : 'member', value.body, now),
            db.prepare("UPDATE pilot_support_tickets SET updated_at=?,status=CASE WHEN ? THEN 'in_progress' ELSE status END,claimed_by=CASE WHEN ? THEN ? ELSE claimed_by END WHERE id=?").bind(now, Number(replyAsAdmin), Number(replyAsAdmin), user, row.id));
          if (replyAsAdmin) statements.push(db.prepare('INSERT INTO pilot_support_deliveries(id,chat_id,ticket_id,message_id,user_id,actor_id,next_attempt_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(uid(), chat, row.id, messageId, row.user_id, user, now, now, now));
          result = { ok: true, id: row.id, messageId, delivery: replyAsAdmin ? 'pending' : null };
        } else if (action === 'ticket_claim') {
          if (row.status === 'resolved') fail('ticket_resolved', 409); await checkClaim(row, user);
          statements.push(db.prepare("UPDATE pilot_support_tickets SET claimed_by=?,status='in_progress',updated_at=? WHERE id=?").bind(user, now, row.id));
          result = { ok: true, id: row.id, status: 'in_progress' };
        } else {
          if (!admin && value.status !== 'resolved') fail('forbidden', 403);
          if (admin) await checkClaim(row, user);
          statements.push(db.prepare('UPDATE pilot_support_tickets SET status=?,claimed_by=CASE WHEN ? THEN NULL ELSE claimed_by END,updated_at=? WHERE id=?').bind(value.status, Number(value.status === 'open'), now, row.id));
          result = { ok: true, id: row.id, status: value.status };
        }
      }
      if (admin) statements.push(db.prepare("INSERT OR IGNORE INTO pilot_audit(id,chat_id,actor_id,action,target_id,details_json,created_at) VALUES(?,?,?,?,?,'{}',?)").bind(`support:${requestId}`, chat, user, action, result.id || null, now));
      return await tools.finish(requestId, result, now, statements);
    } catch (error) {
      await tools.run("UPDATE pilot_tool_operations SET status='failed',error_code=?,updated_at=? WHERE id=? AND status='claimed'", typeof error?.code === 'string' ? error.code : 'unavailable', clock(), requestId);
      throw error;
    }
  }
  async function nextDue(chatId) {
    const chat = validChat(chatId); await store.ensure();
    const row = await store.first("SELECT MIN(CASE WHEN status='sending' THEN updated_at+120 ELSE next_attempt_at END) AS due FROM pilot_support_deliveries WHERE chat_id=? AND status IN ('pending','sending')", chat);
    return row?.due == null ? null : Number(row.due);
  }
  async function dueChats(limit = 100) {
    await store.ensure();
    const cap = Math.min(100, Math.max(1, Number.isInteger(limit) ? limit : 100));
    return (await store.all("SELECT chat_id FROM pilot_support_deliveries WHERE (status='pending' AND next_attempt_at<=?) OR (status='sending' AND updated_at<=?) GROUP BY chat_id ORDER BY MIN(next_attempt_at) LIMIT ?", clock(), clock() - 120, cap)).map(row => row.chat_id);
  }
  async function processDeliveries(chatId, { shouldYield = () => false } = {}) {
    if (shouldYield()) return { processed: 0, status: 'yielded' };
    const chat = validChat(chatId); await store.ensure(); const now = clock();
    await store.run("UPDATE pilot_support_deliveries SET status='unknown',error_kind='delivery_unknown',updated_at=? WHERE chat_id=? AND status='sending' AND updated_at<=?", now, chat, now - 120);
    const row = await store.first(`SELECT d.*,m.body,t.number,t.language,t.updated_at AS ticket_updated
      FROM pilot_support_deliveries d JOIN pilot_support_messages m ON m.id=d.message_id JOIN pilot_support_tickets t ON t.id=d.ticket_id
      WHERE d.chat_id=? AND d.status='pending' AND d.next_attempt_at<=? ORDER BY d.created_at,d.id LIMIT 1`, chat, now);
    if (!row) return { processed: 0 };
    const change = (status, error = null, retry = 0, messageId = null) => store.run('UPDATE pilot_support_deliveries SET status=?,error_kind=?,next_attempt_at=?,telegram_message_id=?,updated_at=? WHERE id=?', status, error, retry, messageId, clock(), row.id);
    try {
      if (row.ticket_updated < now - RETENTION || row.created_at < now - 86400 || !await store.privateContact(row.user_id)) { await change('cancelled', 'private_chat_unavailable'); return { processed: 1, status: 'cancelled' }; }
      bot ||= await api.call('getMe');
      const [sender, recipient, botRole] = await Promise.all([role(chat, row.actor_id), role(chat, row.user_id), role(chat, bot.id)]);
      if (!isAdmin(sender) || !isMember(recipient) || !isAdmin(botRole)) { await change('cancelled', 'access_changed'); return { processed: 1, status: 'cancelled' }; }
    } catch {
      await change('pending', 'authorization_unavailable', now + 600); return { processed: 0, status: 'pending' };
    }
    if (shouldYield()) return { processed: 0, status: 'yielded' };
    const claim = await store.run("UPDATE pilot_support_deliveries SET status='sending',attempts=attempts+1,updated_at=? WHERE id=? AND status='pending'", now, row.id);
    if (!Number(claim.meta?.changes || 0)) return { processed: 0 };
    try {
      const body = `${row.language === 'sw' ? 'Jibu la msaada' : 'Support reply'} · P-${row.number}\n\n${row.body}\n\nSautiLink Pilot · from SautiLink Corporation`;
      const result = await api.call('sendMessage', { chat_id: Number(row.user_id), text: body,
        entities: [{ type: 'text_link', offset: body.length - 'SautiLink Corporation'.length, length: 'SautiLink Corporation'.length, url: 'https://www.sautilink.com/' }],
        link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: [[{ text: row.language === 'sw' ? 'Fungua ticket' : 'Open ticket', url: `https://t.me/sautilinkpilotbot?start=support_${chat}` }]] } });
      if (!Number.isSafeInteger(result?.message_id) || result.message_id <= 0) { await change('unknown', 'delivery_unknown'); return { processed: 1, status: 'unknown' }; }
      await change('sent', null, 0, result.message_id); return { processed: 1, status: 'sent' };
    } catch (error) {
      if (error?.ambiguous !== false) { await change('unknown', 'delivery_unknown'); return { processed: 1, status: 'unknown' }; }
      if (error.code === 429 && Number(row.attempts) < 2) { const requested = Number(error.retryAfter || error.retry_after || 60); const wait = Number.isFinite(requested) ? Math.min(86400, Math.max(1, Math.ceil(requested))) : 60; await change('pending', 'rate_limit', now + wait); return { processed: 1, status: 'pending' }; }
      if (error.code === 403) await store.disablePrivateContact(row.user_id, now);
      await change('failed', error.code === 403 ? 'private_chat_unavailable' : 'telegram_rejected'); return { processed: 1, status: 'failed' };
    }
  }
  return { query, perform, nextDue, dueChats, processDeliveries, cleanup: store.cleanup };
}
