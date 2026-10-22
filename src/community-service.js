import { createCommunityStore } from './community-store.js';
import { createControlStore } from './control-store.js';
import { createOwnerAuth } from './owner-auth.js';
import { createSupportService, SUPPORT_READS, SUPPORT_ACTIONS } from './support-service.js';
import { createDiscoveryStore, discoverCommunities, DISCOVERY_CATEGORIES } from './discovery-service.js';
import { createBroadcastStore } from './broadcast-store.js';

export class CommunityError extends Error {
  constructor(code, status = 400) { super(code); this.name = 'CommunityError'; this.code = code; this.status = status; }
}
const fail = (code, status = 400) => { throw new CommunityError(code, status); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const admin = member => ['creator', 'administrator'].includes(member?.status);
const member = value => admin(value) || value?.status === 'member' || value?.status === 'restricted' && value.is_member === true;
const userId = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const groupId = value => /^-[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const json = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const id = () => crypto.randomUUID().replaceAll('-', '');
const validKeys = (value, keys) => {
  if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) fail('invalid_input');
};
const text = (value, max, { empty = false } = {}) => {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail('invalid_input');
  return value.trim();
};
const https = (value, { empty = true, telegram = false } = {}) => {
  const raw = text(value ?? '', 1000, { empty });
  if (!raw && empty) return '';
  let url;
  try { url = new URL(raw); } catch { fail('invalid_url'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !url.hostname.includes('.') || /[\s\\]/.test(raw)) fail('invalid_url');
  if (telegram && (url.hostname !== 't.me' || !/^\/(?:[A-Za-z][A-Za-z0-9_]{3,31}|\+[A-Za-z0-9_-]{8,100}|joinchat\/[A-Za-z0-9_-]{8,100})\/?$/.test(url.pathname) || url.search || url.hash)) fail('invalid_join_url');
  return url.href;
};
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
async function hash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value))))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export const COMMUNITY_HUB_DEFAULTS = Object.freeze({ visibility: 'private', slug: '', title: '', description: '', rules: '', joinUrl: '', resources: [], language: 'en', showFaq: false });
export const COMMUNITY_READS = new Set(['community', 'reports', 'faq', 'feedback', ...SUPPORT_READS]);
export const COMMUNITY_ACTIONS = new Set(['flag_claim', 'flag_resolve', 'faq_save', 'faq_remove', 'hub_save', 'feedback_create', 'feedback_resolve', 'discovery_save', ...SUPPORT_ACTIONS]);

function hubView(row) {
  if (!row) return { ...COMMUNITY_HUB_DEFAULTS, resources: [] };
  return {
    visibility: row.visibility, slug: row.slug || '', title: row.title, description: row.description,
    rules: row.rules, joinUrl: row.join_url, resources: json(row.resources_json, []), language: row.language,
    showFaq: !!row.show_faq, updated_at: row.updated_at,
    url: row.slug && row.visibility !== 'private' ? `https://pilot.sautilink.com/community/${row.slug}` : null,
  };
}
const faqView = row => ({ id: row.id, question: row.question, answer: row.answer, url: row.url, language: row.language, updated_at: row.updated_at });
const reportView = row => ({
  id: row.id, message_id: row.message_id, target_user_id: row.target_user_id, reporter_id: row.reporter_id,
  reason: row.reason, excerpt: row.excerpt, status: row.status, claimed_by: row.claimed_by,
  decision: row.decision, reviewed_by: row.reviewed_by, created_at: row.created_at, updated_at: row.updated_at,
});

export function createCommunityService({ db, api, clock = () => Math.floor(Date.now() / 1000), owner = createOwnerAuth({ db, clock }) }) {
  const store = createCommunityStore(db), control = createControlStore(db);
  const support = createSupportService({ db, api, clock }), discovery = createDiscoveryStore(db);
  let bot;
  const identity = async () => bot ||= await api.call('getMe');

  function actorNumber(actor) {
    if (!plain(actor) || !userId(actor.id) || actor.is_bot === true) fail('unauthorized', 401);
    return Number(actor.id);
  }
  function chatNumber(chat) {
    if (!groupId(chat)) fail('invalid_chat');
    return Number(chat);
  }
  async function current(chat, user) {
    try { return await api.call('getChatMember', { chat_id: Number(chat), user_id: Number(user) }); }
    catch { fail('authorization_unavailable', 503); }
  }
  async function authorize(actor, chatId, needsAdmin = true) {
    const user = actorNumber(actor), chat = chatNumber(chatId), role = await current(chat, user);
    if (needsAdmin ? !admin(role) : !member(role)) fail('forbidden', 403);
    if (needsAdmin) await control.rememberAdmin(user, chat, clock());
    return { user, chat, role };
  }
  async function authorizeOwner(actor) {
    const user = actorNumber(actor);
    if (!owner || !await owner.isOwner(actor)) fail('forbidden', 403);
    return user;
  }
  async function audit(chat, user, action, targetId, requestId) {
    if (!chat) return;
    await control.audit({ id: `community:${requestId}`, chatId: chat, actorId: user, action, targetId, at: clock() });
  }

  async function operation({ user, chat = '', action, input, requestId }, work) {
    if (typeof requestId !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(requestId)) fail('invalid_request_id');
    const fingerprint = await hash(input), now = clock();
    await store.run(`INSERT OR IGNORE INTO pilot_community_operations(request_id,chat_id,actor_id,action,input_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,'processing',?,?)`, requestId, String(chat), String(user), action, fingerprint, now, now);
    const row = await store.first('SELECT * FROM pilot_community_operations WHERE request_id=?', requestId);
    if (row.chat_id !== String(chat) || row.actor_id !== String(user) || row.action !== action || row.input_hash !== fingerprint) fail('request_conflict', 409);
    if (row.status === 'succeeded') return { ...json(row.result_json, { ok: true }), duplicate: true };
    if (row.status === 'failed') fail(row.error_code || 'operation_failed', 409);
    if (row.status === 'unknown') fail('operation_unknown', 409);
    // The same group uses its Durable Object queue. A claim from a prior request
    // must not be performed again after a crash, even if no Telegram result exists.
    const claim = await store.run("UPDATE pilot_community_operations SET status='processing',result_json='claimed' WHERE request_id=? AND result_json IS NULL AND status='processing'", requestId);
    if (!claim.meta?.changes) fail('operation_pending', 409);
    try {
      const result = await work();
      await store.run("UPDATE pilot_community_operations SET status='succeeded',result_json=?,updated_at=? WHERE request_id=?", JSON.stringify(result), clock(), requestId);
      return result;
    } catch (error) {
      const unknown = error?.code === 'delivery_unknown';
      await store.run('UPDATE pilot_community_operations SET status=?,error_code=?,updated_at=? WHERE request_id=?', unknown ? 'unknown' : 'failed', error instanceof CommunityError ? error.code : 'unavailable', clock(), requestId);
      if (error instanceof CommunityError) throw error;
      fail('unavailable', 503);
    }
  }

  async function faq(chat, input = {}) {
    validKeys(input, ['query', 'language']);
    const query = text(input.query ?? '', 200, { empty: true });
    if (input.language !== undefined && !['en', 'sw'].includes(input.language)) fail('invalid_language');
    let rows = (await store.all('SELECT * FROM pilot_community_faq WHERE chat_id=? ORDER BY updated_at DESC,id LIMIT 50', String(chat))).map(faqView);
    if (input.language) rows = rows.filter(row => row.language === input.language);
    if (query) {
      const words = query.toLocaleLowerCase().split(/\s+/u).filter(Boolean).slice(0, 12);
      rows = rows.map(row => ({ row, score: words.reduce((score, word) => score + (row.question.toLocaleLowerCase().includes(word) ? 3 : 0) + (row.answer.toLocaleLowerCase().includes(word) ? 1 : 0), 0) }))
        .filter(item => item.score > 0).sort((a, b) => b.score - a.score).map(item => item.row).slice(0, 10);
    }
    return { faq: rows, query };
  }
  async function reports(chat) {
    return (await store.all('SELECT * FROM pilot_member_reports WHERE chat_id=? AND created_at>=? ORDER BY CASE WHEN status IN (\'open\',\'claimed\',\'delete_unknown\') THEN 0 ELSE 1 END,updated_at DESC,id LIMIT 100', String(chat), clock() - 30 * 86400)).map(reportView);
  }
  async function query({ actor, chatId, view, input = {} }) {
    if (!COMMUNITY_READS.has(view)) fail('invalid_view');
    if (SUPPORT_READS.has(view)) return support.query({ actor, chatId, view, input });
    if (view === 'feedback') {
      await authorizeOwner(actor); validKeys(input, []); await store.ensure();
      return { feedback: await store.all('SELECT id,user_id,kind,message,status,created_at,updated_at FROM pilot_feature_feedback WHERE created_at>=? ORDER BY created_at DESC,id LIMIT 100', clock() - 90 * 86400) };
    }
    const { chat } = await authorize(actor, chatId, view !== 'faq');
    await store.ensure();
    if (view === 'faq') return faq(chat, input);
    validKeys(input, []);
    if (view === 'reports') return { reports: await reports(chat) };
    return { reports: await reports(chat), ...(await faq(chat)), hub: hubView(await store.first('SELECT * FROM pilot_community_hubs WHERE chat_id=?', String(chat))), discovery: await discovery.settings(chat) };
  }

  async function protectedTarget(chat, message) {
    // Anonymous admins and channel senders are never deletable through reports.
    // In particular, automatic posts from a group's linked channel stay intact.
    if (message?.sender_chat || message?.is_automatic_forward || message?.from?.is_bot || !userId(message?.from?.id)) fail('protected_target', 403);
    const target = await current(chat, message.from.id);
    if (admin(target)) fail('protected_target', 403);
    return Number(message.from.id);
  }

  async function createReportFromMessage({ actor, chatId, message, reason, updateId }) {
    const { user, chat } = await authorize(actor, chatId, false);
    if (!Number.isSafeInteger(updateId) || updateId < 0 || !plain(message) || Number(message.chat?.id) !== chat || !Number.isSafeInteger(message.message_id) || message.message_id <= 0 || !Number.isSafeInteger(message.date) || message.date <= 0 || message.date > clock() + 300) fail('invalid_report');
    const explanation = text(reason || '', 500), target = await protectedTarget(chat, message);
    if (target === user) fail('invalid_report');
    const excerpt = String(message.text ?? message.caption ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').slice(0, 500);
    await store.ensure();
    return operation({ user, chat, action: 'flag_create', input: { messageId: message.message_id, target, reason: explanation }, requestId: `flag:${chat}:${updateId}:${user}` }, async () => {
      const prior = await store.first('SELECT id,status FROM pilot_member_reports WHERE chat_id=? AND message_id=? AND reporter_id=?', String(chat), message.message_id, String(user));
      if (prior) return { ok: true, id: prior.id, status: prior.status, duplicate: true };
      const now = clock();
      const recent = await store.first(`SELECT COUNT(*) AS daily,SUM(CASE WHEN chat_id=? AND created_at>=? THEN 1 ELSE 0 END) AS hourly FROM pilot_member_reports WHERE reporter_id=? AND created_at>=?`, String(chat), now - 3600, String(user), now - 86400);
      if (Number(recent.daily) >= 10 || Number(recent.hourly) >= 3) fail('report_rate_limited', 429);
      const count = await store.first("SELECT COUNT(*) AS total,SUM(CASE WHEN message_id=? THEN 1 ELSE 0 END) AS target FROM pilot_member_reports WHERE chat_id=? AND status!='resolved' AND created_at>=?", message.message_id, String(chat), now - 30 * 86400);
      if (Number(count.total) >= 100 || Number(count.target) >= 5) fail('report_limit', 429);
      const reportId = id();
      await store.run('INSERT INTO pilot_member_reports(id,chat_id,message_id,target_user_id,reporter_id,reason,excerpt,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)', reportId, String(chat), message.message_id, String(target), String(user), explanation, excerpt, now, now);
      return { ok: true, id: reportId, status: 'open' };
    });
  }

  function normalize(action, input) {
    if (action === 'flag_claim' || action === 'faq_remove') {
      validKeys(input, ['id']); return { id: text(input.id, 80) };
    }
    if (action === 'flag_resolve') {
      validKeys(input, ['id', 'decision']);
      if (!['dismiss', 'resolved', 'delete'].includes(input.decision)) fail('invalid_decision');
      return { id: text(input.id, 80), decision: input.decision };
    }
    if (action === 'faq_save') {
      validKeys(input, ['id', 'question', 'answer', 'url', 'language']);
      if (!['en', 'sw'].includes(input.language)) fail('invalid_language');
      return { id: input.id ? text(input.id, 80) : null, question: text(input.question, 180), answer: text(input.answer, 2000), url: https(input.url), language: input.language };
    }
    if (action === 'hub_save') {
      validKeys(input, ['visibility', 'slug', 'title', 'description', 'rules', 'joinUrl', 'resources', 'language', 'showFaq']);
      if (!['private', 'unlisted', 'public'].includes(input.visibility) || !['en', 'sw'].includes(input.language) || typeof input.showFaq !== 'boolean') fail('invalid_hub');
      const slug = text(input.slug ?? '', 48, { empty: true }).toLowerCase();
      if (slug && !/^[a-z0-9][a-z0-9-]{2,46}[a-z0-9]$/.test(slug)) fail('invalid_slug');
      if (input.visibility !== 'private' && !slug) fail('invalid_slug');
      if (!Array.isArray(input.resources) || input.resources.length > 12) fail('invalid_resources');
      const resources = input.resources.map(resource => { validKeys(resource, ['label', 'url']); return { label: text(resource.label, 80), url: https(resource.url, { empty: false }) }; });
      return { visibility: input.visibility, slug, title: text(input.title ?? '', 100, { empty: input.visibility === 'private' }), description: text(input.description ?? '', 600, { empty: true }), rules: text(input.rules ?? '', 1500, { empty: true }), joinUrl: https(input.joinUrl, { telegram: true }), resources, language: input.language, showFaq: input.showFaq };
    }
    if (action === 'discovery_save') {
      validKeys(input, ['enabled', 'category']);
      if (typeof input.enabled !== 'boolean' || !DISCOVERY_CATEGORIES.includes(input.category)) fail('invalid_discovery');
      return { enabled: input.enabled, category: input.category };
    }
    if (action === 'feedback_create') {
      validKeys(input, ['kind', 'message']);
      if (!['feature', 'bug'].includes(input.kind)) fail('invalid_feedback');
      return { kind: input.kind, message: text(input.message, 1500) };
    }
    if (action === 'feedback_resolve') {
      validKeys(input, ['id', 'status']);
      if (!['planned', 'resolved', 'declined'].includes(input.status)) fail('invalid_feedback');
      return { id: text(input.id, 80), status: input.status };
    }
    fail('invalid_action');
  }

  async function perform({ actor, chatId, action, input = {}, requestId }) {
    if (!COMMUNITY_ACTIONS.has(action)) fail('invalid_action');
    if (SUPPORT_ACTIONS.has(action)) return support.perform({ actor, chatId, action, input, requestId });
    const data = normalize(action, input);
    let user, chat = '';
    if (action === 'feedback_create') user = actorNumber(actor);
    else if (action === 'feedback_resolve') user = await authorizeOwner(actor);
    else ({ user, chat } = await authorize(actor, chatId));
    await store.ensure();
    return operation({ user, chat, action, input: data, requestId }, async () => {
      const now = clock();
      if (action.startsWith('flag_')) {
        const row = await store.first('SELECT * FROM pilot_member_reports WHERE id=? AND chat_id=? AND created_at>=?', data.id, String(chat), now - 30 * 86400);
        if (!row) fail('not_found', 404);
        if (row.status === 'resolved') fail('report_resolved', 409);
        if (row.status === 'claimed' && row.claimed_by !== String(user)) {
          // A claim is coordination, never lasting authority. A departed or
          // demoted admin must not leave a case permanently locked for the team.
          if (admin(await current(chat, row.claimed_by))) fail('report_claimed', 409);
        }
        if (action === 'flag_claim') {
          if (row.status === 'delete_unknown') fail('operation_unknown', 409);
          await store.run("UPDATE pilot_member_reports SET status='claimed',claimed_by=?,updated_at=? WHERE id=?", String(user), now, row.id);
          await audit(chat, user, action, row.id, requestId);
          return { ok: true, id: row.id, status: 'claimed' };
        }
        if (data.decision === 'delete') {
          if (row.status === 'delete_unknown') fail('operation_unknown', 409);
          const target = await current(chat, row.target_user_id);
          if (admin(target) || target?.user?.is_bot) fail('protected_target', 403);
          const me = await identity(), role = await current(chat, me.id);
          if (!admin(role) || role.can_delete_messages !== true) fail('bot_permission', 403);
          // Set an uncertain state before crossing the network. A Worker crash
          // or ambiguous Telegram response must never generate a second delete.
          await store.run("UPDATE pilot_member_reports SET status='delete_unknown',decision='delete',reviewed_by=?,updated_at=? WHERE id=?", String(user), now, row.id);
          try {
            const confirmed = await api.call('deleteMessage', { chat_id: chat, message_id: row.message_id });
            if (confirmed !== true) fail('delivery_unknown', 503);
          }
          catch (error) {
            if (error?.ambiguous !== false) fail('delivery_unknown', 503);
            await store.run("UPDATE pilot_member_reports SET status='claimed',claimed_by=?,decision='delete_failed',updated_at=? WHERE id=?", String(user), clock(), row.id);
            fail('telegram_rejected', 502);
          }
        }
        await store.run("UPDATE pilot_member_reports SET status='resolved',decision=?,reviewed_by=?,updated_at=? WHERE id=?", data.decision, String(user), clock(), row.id);
        await audit(chat, user, action, row.id, requestId);
        return { ok: true, id: row.id, status: 'resolved', decision: data.decision };
      }
      if (action === 'faq_save') {
        let faqId = data.id;
        if (faqId) {
          if (!await store.first('SELECT id FROM pilot_community_faq WHERE id=? AND chat_id=?', faqId, String(chat))) fail('not_found', 404);
          await store.run('UPDATE pilot_community_faq SET question=?,answer=?,url=?,language=?,updated_by=?,updated_at=? WHERE id=? AND chat_id=?', data.question, data.answer, data.url, data.language, String(user), now, faqId, String(chat));
        } else {
          if (Number((await store.first('SELECT COUNT(*) AS total FROM pilot_community_faq WHERE chat_id=?', String(chat))).total) >= 50) fail('faq_limit', 409);
          faqId = id();
          await store.run('INSERT INTO pilot_community_faq(id,chat_id,question,answer,url,language,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)', faqId, String(chat), data.question, data.answer, data.url, data.language, String(user), String(user), now, now);
        }
        await audit(chat, user, action, faqId, requestId);
        return { ok: true, id: faqId };
      }
      if (action === 'faq_remove') {
        const result = await store.run('DELETE FROM pilot_community_faq WHERE id=? AND chat_id=?', data.id, String(chat));
        if (!result.meta?.changes) fail('not_found', 404);
        await audit(chat, user, action, data.id, requestId);
        return { ok: true, id: data.id };
      }
      if (action === 'hub_save') {
        if (data.slug) {
          const used = await store.first('SELECT chat_id FROM pilot_community_hubs WHERE slug=?', data.slug);
          if (used && used.chat_id !== String(chat)) fail('slug_unavailable', 409);
        }
        await store.run(`INSERT INTO pilot_community_hubs(chat_id,slug,visibility,title,description,rules,join_url,resources_json,language,show_faq,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(chat_id) DO UPDATE SET slug=excluded.slug,visibility=excluded.visibility,title=excluded.title,description=excluded.description,rules=excluded.rules,join_url=excluded.join_url,resources_json=excluded.resources_json,language=excluded.language,show_faq=excluded.show_faq,updated_by=excluded.updated_by,updated_at=excluded.updated_at`, String(chat), data.slug || null, data.visibility, data.title, data.description, data.rules, data.joinUrl, JSON.stringify(data.resources), data.language, Number(data.showFaq), String(user), now);
        if (data.visibility !== 'public') { await discovery.ensure(); await store.run('UPDATE pilot_community_discovery SET enabled=0,updated_at=? WHERE chat_id=?', now, String(chat)); }
        await audit(chat, user, action, data.slug || null, requestId);
        return { ok: true, visibility: data.visibility, url: data.visibility === 'private' ? null : `https://pilot.sautilink.com/community/${data.slug}` };
      }
      if (action === 'discovery_save') {
        await discovery.ensure();
        if (data.enabled) {
          const hub = await store.first("SELECT slug,title,join_url FROM pilot_community_hubs WHERE chat_id=? AND visibility='public'", String(chat));
          if (!hub?.slug || !hub.title || !hub.join_url) fail('public_hub_required', 409);
          const me = await identity(), role = await current(chat, me.id);
          if (!admin(role)) fail('bot_permission', 403);
          await createBroadcastStore(db).recordMembership(chat, role.status, now);
        }
        await store.run('INSERT INTO pilot_community_discovery(chat_id,enabled,category,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET enabled=excluded.enabled,category=excluded.category,updated_by=excluded.updated_by,updated_at=excluded.updated_at', String(chat), Number(data.enabled), data.category, String(user), now);
        await audit(chat, user, action, null, requestId);
        return { ok: true, enabled: data.enabled, category: data.category };
      }
      if (action === 'feedback_create') {
        if (Number((await store.first('SELECT COUNT(*) AS total FROM pilot_feature_feedback WHERE user_id=? AND created_at>=?', String(user), now - 86400)).total) >= 5) fail('feedback_rate_limited', 429);
        const feedbackId = id();
        await store.run('INSERT INTO pilot_feature_feedback(id,user_id,kind,message,created_at,updated_at) VALUES(?,?,?,?,?,?)', feedbackId, String(user), data.kind, data.message, now, now);
        return { ok: true, id: feedbackId, status: 'open' };
      }
      if (action === 'feedback_resolve') {
        const result = await store.run('UPDATE pilot_feature_feedback SET status=?,reviewed_by=?,updated_at=? WHERE id=? AND created_at>=?', data.status, String(user), now, data.id, now - 90 * 86400);
        if (!result.meta?.changes) fail('not_found', 404);
        return { ok: true, id: data.id, status: data.status };
      }
      fail('invalid_action');
    });
  }

  async function getPublicHub(slug, { language = 'en' } = {}) {
    if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{2,46}[a-z0-9]$/.test(slug)) return null;
    await store.ensure();
    const row = await store.first("SELECT * FROM pilot_community_hubs WHERE slug=? AND visibility IN ('unlisted','public')", slug);
    if (!row) return null;
    const result = hubView(row);
    // This separate projection deliberately excludes group and Telegram user IDs,
    // reports, creation identity, memberships, and every private setting.
    if (result.showFaq) result.faq = (await faq(row.chat_id, { language: language === 'sw' ? 'sw' : 'en' })).faq;
    else result.faq = [];
    return result;
  }

  return { query, perform, createReportFromMessage, getPublicHub,
    async discover(input = {}) { await store.ensure(); return discoverCommunities(db, input); },
    processSupportDeliveries: support.processDeliveries, nextSupportDue: support.nextDue, dueSupportChats: support.dueChats,
    async cleanup(now) { await store.cleanup(now); await support.cleanup(now); },
  };
}
