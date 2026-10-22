import { createBroadcastStore } from './broadcast-store.js';

export class BroadcastError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.name = 'BroadcastError';
    this.code = code;
    this.status = status;
  }
}

const fail = (code, status = 400) => { throw new BroadcastError(code, status); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const userId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 && /^\d+$/.test(String(value));
const groupId = value => /^-[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const changes = result => Number(result?.meta?.changes ?? result?.changes ?? 0);
const ID = /^[a-f0-9]{24}$/;
const DAY = 86400, SPACING = 2, CAMPAIGN_SPACING = 60, LEASE = 120, COMPOSE_TTL = 900;
const STATES = ['staged','pending','checking','sending','sent','skipped','failed','unknown','cancelled'];
const MEDIA = { sendPhoto:'photo', sendVideo:'video', sendDocument:'document', sendAnimation:'animation', sendAudio:'audio', sendVoice:'voice' };
const ENTITY_TYPES = new Set(['mention','hashtag','cashtag','bot_command','url','email','phone_number','bold','italic','underline','strikethrough','spoiler','blockquote','expandable_blockquote','code','pre','text_link','text_mention','custom_emoji','date_time']);

function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('invalid_content');
}
function text(value, maximum, { empty = false } = {}) {
  if (typeof value !== 'string' || value.length > maximum || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail('invalid_content');
  return value;
}
function safeUrl(value, protocols = ['http:','https:','tg:','mailto:']) {
  text(value, 2048);
  let parsed;
  try { parsed = new URL(value); } catch { fail('invalid_content'); }
  if (!protocols.includes(parsed.protocol) || parsed.username || parsed.password || /[\r\n]/u.test(value)) fail('invalid_content');
  return value;
}
function entities(value, source) {
  if (!Array.isArray(value) || value.length > 100) fail('invalid_content');
  const splitsSurrogate = offset => offset > 0 && offset < source.length && /[\uD800-\uDBFF]/u.test(source[offset - 1]) && /[\uDC00-\uDFFF]/u.test(source[offset]);
  return value.map(entity => {
    keys(entity, ['type','offset','length','url','user','language','custom_emoji_id','unix_time','date_time_format']);
    if (!ENTITY_TYPES.has(entity.type) || !Number.isSafeInteger(entity.offset) || !Number.isSafeInteger(entity.length) || entity.offset < 0 || entity.length < 1 || entity.offset + entity.length > source.length || splitsSurrogate(entity.offset) || splitsSurrogate(entity.offset + entity.length)) fail('invalid_content');
    const result = { type:entity.type, offset:entity.offset, length:entity.length };
    if (entity.type === 'text_link') result.url = safeUrl(entity.url);
    else if (entity.url !== undefined) fail('invalid_content');
    if (entity.type === 'text_mention') {
      if (!object(entity.user) || !userId(entity.user.id) || typeof entity.user.is_bot !== 'boolean') fail('invalid_content');
      result.user = { id:Number(entity.user.id), is_bot:entity.user.is_bot, first_name:text(entity.user.first_name, 256) };
      for (const key of ['last_name','username','language_code']) if (entity.user[key] !== undefined) result.user[key] = text(entity.user[key], 256, { empty:true });
    } else if (entity.user !== undefined) fail('invalid_content');
    if (entity.type === 'pre' && entity.language !== undefined) result.language = text(entity.language, 64, { empty:true });
    else if (entity.language !== undefined) fail('invalid_content');
    if (entity.type === 'custom_emoji') {
      if (typeof entity.custom_emoji_id !== 'string' || !/^\d{1,32}$/.test(entity.custom_emoji_id)) fail('invalid_content');
      result.custom_emoji_id = entity.custom_emoji_id;
    } else if (entity.custom_emoji_id !== undefined) fail('invalid_content');
    if (entity.type === 'date_time') {
      if (!Number.isSafeInteger(entity.unix_time)) fail('invalid_content');
      result.unix_time = entity.unix_time;
      if (entity.date_time_format !== undefined) {
        if (typeof entity.date_time_format !== 'string' || !/^(?:r|w?[dD]?[tT]?)$/.test(entity.date_time_format)) fail('invalid_content');
        result.date_time_format = entity.date_time_format;
      }
    } else if (entity.unix_time !== undefined || entity.date_time_format !== undefined) fail('invalid_content');
    return result;
  });
}

export function normalizeBroadcastContent(content) {
  keys(content, ['method','params']);
  const method = content.method, params = {};
  if (method === 'sendMessage') {
    keys(content.params, ['text','entities','link_preview_options']);
    params.text = text(content.params.text, 4096);
    if (content.params.entities !== undefined) params.entities = entities(content.params.entities, params.text);
    if (content.params.link_preview_options !== undefined) {
      keys(content.params.link_preview_options, ['is_disabled','url','prefer_small_media','prefer_large_media','show_above_text']);
      params.link_preview_options = {};
      for (const [key,value] of Object.entries(content.params.link_preview_options)) {
        if (key === 'url') params.link_preview_options.url = safeUrl(value, ['http:','https:']);
        else { if (typeof value !== 'boolean') fail('invalid_content'); params.link_preview_options[key] = value; }
      }
    } else params.link_preview_options = { is_disabled:true };
  } else if (MEDIA[method]) {
    const media = MEDIA[method], visual = ['sendPhoto','sendVideo','sendAnimation'].includes(method);
    keys(content.params, [media,'caption','caption_entities',...(visual ? ['has_spoiler','show_caption_above_media'] : [])]);
    const file = content.params[media];
    if (typeof file !== 'string' || file.length < 1 || file.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(file)) fail('invalid_content');
    params[media] = file;
    if (content.params.caption !== undefined) params.caption = text(content.params.caption, 1024, { empty:true });
    if (content.params.caption_entities !== undefined) params.caption_entities = entities(content.params.caption_entities, params.caption || '');
    for (const key of ['has_spoiler','show_caption_above_media']) if (content.params[key] !== undefined) {
      if (typeof content.params[key] !== 'boolean') fail('invalid_content');
      params[key] = content.params[key];
    }
  } else fail('invalid_content');
  const result = { method, params };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 32768) fail('invalid_content');
  return result;
}

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (object(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
async function digest(content) {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(content)));
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}
function retryDelay(error) {
  const value = Number(error?.retryAfter);
  return Number.isSafeInteger(value) && value > 0 ? value : 60;
}
function definiteRejection(error) {
  return error?.ambiguous === false && Number.isInteger(error?.code) && error.code >= 400 && error.code < 500;
}

export function createBroadcastService({ db, api, owner, clock = () => Math.floor(Date.now() / 1000) }) {
  const records = createBroadcastStore(db);
  let identity;
  const now = () => {
    const value = Math.floor(clock());
    if (!Number.isSafeInteger(value) || value < 0) fail('service_unavailable',503);
    return value;
  };
  async function requireOwner(actor) {
    let authorized = false;
    try { authorized = await owner?.isOwner?.(actor); } catch { /* Fail closed. */ }
    if (authorized !== true || !userId(actor?.id) || actor.is_bot === true) fail('owner_required',403);
    return String(actor.id);
  }
  function requireId(id) { if (typeof id !== 'string' || !ID.test(id)) fail('invalid_draft'); return id; }
  const audit = (id, campaign, actor, action, details = {}) => db.prepare('INSERT OR IGNORE INTO pilot_broadcast_audit(id,campaign_id,actor_id,action,details_json,created_at) VALUES(?,?,?,?,?,?)').bind(id,campaign,actor,action,JSON.stringify(details),now());
  const campaignAudit = (id, campaign, actor, action, status, details = {}) => db.prepare('INSERT OR IGNORE INTO pilot_broadcast_audit(id,campaign_id,actor_id,action,details_json,created_at) SELECT ?,id,?,?,?,? FROM pilot_broadcast_campaigns WHERE id=? AND status=?').bind(id,actor,action,JSON.stringify(details),now(),campaign,status);
  async function expire() {
    await records.ensure();
    const current = await records.first("SELECT id,owner_id,created_at FROM pilot_broadcast_campaigns WHERE (status='draft' AND expires_at<=?) OR (status='running' AND created_at<=?)",now(),now()-30*DAY);
    if (!current) return;
    await db.batch([
      db.prepare("UPDATE pilot_broadcast_campaigns SET status='expired',updated_at=?,completed_at=?,content_json=CASE WHEN created_at<=? THEN NULL ELSE content_json END WHERE id=? AND ((status='draft' AND expires_at<=?) OR (status='running' AND created_at<=?))").bind(now(),now(),now()-30*DAY,current.id,now(),now()-30*DAY),
      db.prepare("UPDATE pilot_broadcast_deliveries SET status='cancelled',error_kind='draft_expired',lease_token=NULL,updated_at=? WHERE campaign_id=? AND status IN ('staged','pending','checking') AND EXISTS(SELECT 1 FROM pilot_broadcast_campaigns WHERE id=? AND status='expired')").bind(now(),current.id,current.id),
      campaignAudit('expire:'+current.id,current.id,null,'expired','expired'),
    ]);
  }
  async function ownDraft(user, id) {
    requireId(id);
    const row = await records.first('SELECT * FROM pilot_broadcast_campaigns WHERE id=? AND owner_id=? AND created_at>=?',id,user,now()-30*DAY);
    if (!row) fail('not_found',404);
    return row;
  }
  async function view(row) {
    const counts = Object.fromEntries(STATES.map(status => [status,0]));
    for (const value of await records.all('SELECT status,COUNT(*) AS count FROM pilot_broadcast_deliveries WHERE campaign_id=? GROUP BY status',row.id)) counts[value.status] = Number(value.count);
    counts.total = Object.values(counts).reduce((sum,value) => sum+value,0);
    return {
      id:row.id,status:row.status,content:row.content_json ? JSON.parse(row.content_json) : null,
      preview_message_id:row.preview_message_id ?? null,candidateCount:Number(row.candidate_count),counts,
      created_at:row.created_at,expires_at:row.expires_at,confirmed_at:row.confirmed_at ?? null,
      completed_at:row.completed_at ?? null,starts_at:row.starts_at ?? null,
    };
  }
  async function result(user,id,extra = {}) { return { ok:true,draft:await view(await ownDraft(user,id)),...extra }; }
  async function composition(user) {
    const row = await records.first('SELECT expires_at FROM pilot_broadcast_composition WHERE user_id=? AND expires_at>?',user,now());
    return { awaitingContent:!!row,expiresAt:row?.expires_at ?? null };
  }
  async function composeStart({actor,replaceDraftId} = {}) {
    const user = await requireOwner(actor);
    await expire();
    const active = await records.first("SELECT id,status,owner_id FROM pilot_broadcast_campaigns WHERE status IN ('draft','running')");
    if (replaceDraftId !== undefined) {
      requireId(replaceDraftId);
      if (!active || active.id !== replaceDraftId || active.status !== 'draft' || active.owner_id !== user) fail('broadcast_busy',409);
    } else if (active) fail('broadcast_busy',409);
    const statements = [];
    if (replaceDraftId !== undefined) statements.push(
      db.prepare("UPDATE pilot_broadcast_campaigns SET status='cancelled',updated_at=?,completed_at=? WHERE id=? AND owner_id=? AND status='draft'").bind(now(),now(),replaceDraftId,user),
      db.prepare("UPDATE pilot_broadcast_deliveries SET status='cancelled',error_kind='owner_cancelled',updated_at=? WHERE campaign_id=? AND status='staged' AND EXISTS(SELECT 1 FROM pilot_broadcast_campaigns WHERE id=? AND status='cancelled')").bind(now(),replaceDraftId,replaceDraftId),
      campaignAudit('cancel:'+replaceDraftId,replaceDraftId,user,'cancelled','cancelled',{replacement:true}),
    );
    statements.push(db.prepare("INSERT INTO pilot_broadcast_composition(user_id,started_at,expires_at) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM pilot_broadcast_campaigns WHERE status IN ('draft','running')) ON CONFLICT(user_id) DO UPDATE SET started_at=excluded.started_at,expires_at=excluded.expires_at").bind(user,now(),now()+COMPOSE_TTL));
    const completed = await db.batch(statements);
    if (!changes(completed.at(-1))) fail('broadcast_busy',409);
    return { ok:true,...await composition(user) };
  }
  async function composeState({actor} = {}) {
    const user = await requireOwner(actor);
    await records.ensure();
    return { ok:true,...await composition(user) };
  }
  async function clearCompose({actor} = {}) {
    const user = await requireOwner(actor);
    await records.ensure();
    await records.run('DELETE FROM pilot_broadcast_composition WHERE user_id=?',user);
    return { ok:true,awaitingContent:false,expiresAt:null };
  }
  async function createDraft({actor,content,sourceUpdateId} = {}) {
    const user = await requireOwner(actor), frozen = normalizeBroadcastContent(content);
    if (!Number.isSafeInteger(Number(sourceUpdateId)) || Number(sourceUpdateId) < 0 || !/^\d+$/.test(String(sourceUpdateId))) fail('invalid_source');
    const source = String(sourceUpdateId), hash = await digest(frozen);
    await expire();
    await records.backfillGroups(now());
    const duplicate = await records.first('SELECT * FROM pilot_broadcast_campaigns WHERE source_update_id=?',source);
    if (duplicate) {
      if (duplicate.owner_id !== user || duplicate.content_hash !== hash) fail('source_conflict',409);
      return result(user,duplicate.id,{duplicate:true});
    }
    if (await records.first("SELECT id FROM pilot_broadcast_campaigns WHERE status IN ('draft','running')")) fail('broadcast_busy',409);
    const id = crypto.randomUUID().replaceAll('-','').slice(0,24), created = now();
    try {
      await db.batch([
        db.prepare("INSERT INTO pilot_broadcast_campaigns(id,owner_id,source_update_id,content_json,content_hash,status,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,'draft',?,?,?)").bind(id,user,source,JSON.stringify(frozen),hash,created,created,created+DAY),
        db.prepare("INSERT INTO pilot_broadcast_deliveries(campaign_id,chat_id,status,created_at,updated_at) SELECT ?,chat_id,'staged',?,? FROM pilot_broadcast_groups WHERE status IN ('active','unknown')").bind(id,created,created),
        db.prepare('UPDATE pilot_broadcast_campaigns SET candidate_count=(SELECT COUNT(*) FROM pilot_broadcast_deliveries WHERE campaign_id=?) WHERE id=?').bind(id,id),
        db.prepare('DELETE FROM pilot_broadcast_composition WHERE user_id=?').bind(user),
        audit('create:'+id,id,user,'draft_created',{method:frozen.method}),
      ]);
    } catch (error) {
      const existing = await records.first('SELECT id,owner_id,content_hash FROM pilot_broadcast_campaigns WHERE source_update_id=?',source);
      if (existing && existing.owner_id === user && existing.content_hash === hash) return result(user,existing.id,{duplicate:true});
      if (await records.first("SELECT id FROM pilot_broadcast_campaigns WHERE status IN ('draft','running')")) fail('broadcast_busy',409);
      throw error;
    }
    return result(user,id);
  }
  async function getDraft({actor,id} = {}) {
    const user = await requireOwner(actor);
    await expire();
    return result(user,id);
  }
  async function setPreview({actor,id,messageId} = {}) {
    const user = await requireOwner(actor);
    await expire();
    const row = await ownDraft(user,id);
    if (!Number.isSafeInteger(messageId) || messageId < 1) fail('invalid_preview');
    if (row.status === 'expired') fail('draft_expired',409);
    if (row.status !== 'draft') fail('broadcast_busy',409);
    if (row.preview_message_id !== null) {
      if (row.preview_message_id === messageId) return result(user,id,{duplicate:true});
      fail('preview_mismatch',409);
    }
    const updated = await records.run("UPDATE pilot_broadcast_campaigns SET preview_message_id=?,updated_at=? WHERE id=? AND owner_id=? AND status='draft' AND preview_message_id IS NULL AND expires_at>?",messageId,now(),id,user,now());
    if (!changes(updated)) fail('preview_mismatch',409);
    await db.batch([audit('preview:'+id,id,user,'preview_bound')]);
    return result(user,id);
  }
  async function complete() {
    const row = await records.first("SELECT id FROM pilot_broadcast_campaigns c WHERE status='running' AND NOT EXISTS(SELECT 1 FROM pilot_broadcast_deliveries d WHERE d.campaign_id=c.id AND d.status IN ('staged','pending','checking','sending'))");
    if (!row) return;
    await db.batch([
      db.prepare("UPDATE pilot_broadcast_campaigns SET status='completed',updated_at=?,completed_at=? WHERE id=? AND status='running' AND NOT EXISTS(SELECT 1 FROM pilot_broadcast_deliveries WHERE campaign_id=? AND status IN ('staged','pending','checking','sending'))").bind(now(),now(),row.id,row.id),
      campaignAudit('complete:'+row.id,row.id,null,'completed','completed'),
    ]);
  }
  async function confirm({actor,id,previewMessageId} = {}) {
    const user = await requireOwner(actor);
    await expire();
    const row = await ownDraft(user,id);
    if (!row.preview_message_id) fail('preview_required',409);
    if (!Number.isSafeInteger(previewMessageId) || row.preview_message_id !== previewMessageId) fail('preview_mismatch',409);
    if (['running','completed'].includes(row.status)) return result(user,id,{duplicate:true});
    if (row.status === 'expired') fail('draft_expired',409);
    if (row.status !== 'draft') fail('broadcast_finished',409);
    const updated = await db.batch([
      db.prepare("UPDATE pilot_broadcast_campaigns SET status='running',confirmed_at=?,updated_at=?,starts_at=MAX(?,(SELECT next_campaign_at FROM pilot_broadcast_runtime WHERE id=1),(SELECT next_send_at FROM pilot_broadcast_runtime WHERE id=1)) WHERE id=? AND owner_id=? AND status='draft' AND expires_at>?").bind(now(),now(),now(),id,user,now()),
      db.prepare("UPDATE pilot_broadcast_deliveries SET status='pending',next_attempt_at=(SELECT starts_at FROM pilot_broadcast_campaigns WHERE id=?),updated_at=? WHERE campaign_id=? AND status='staged' AND EXISTS(SELECT 1 FROM pilot_broadcast_campaigns WHERE id=? AND status='running')").bind(id,now(),id,id),
      db.prepare("UPDATE pilot_broadcast_runtime SET next_send_at=MAX(next_send_at,(SELECT starts_at FROM pilot_broadcast_campaigns WHERE id=?)),next_campaign_at=MAX(next_campaign_at,(SELECT starts_at FROM pilot_broadcast_campaigns WHERE id=?)+?),updated_at=? WHERE id=1 AND EXISTS(SELECT 1 FROM pilot_broadcast_campaigns WHERE id=? AND status='running')").bind(id,id,CAMPAIGN_SPACING,now(),id),
      campaignAudit('confirm:'+id,id,user,'confirmed','running',{candidateCount:Number(row.candidate_count)}),
    ]);
    await complete();
    return result(user,id,{duplicate:!changes(updated[0])});
  }
  async function cancel({actor,id} = {}) {
    const user = await requireOwner(actor);
    await expire();
    const row = await ownDraft(user,id);
    if (row.status === 'cancelled') return result(user,id,{duplicate:true});
    if (!['draft','running'].includes(row.status)) fail('broadcast_finished',409);
    await db.batch([
      db.prepare("UPDATE pilot_broadcast_campaigns SET status='cancelled',updated_at=?,completed_at=? WHERE id=? AND owner_id=? AND status IN ('draft','running')").bind(now(),now(),id,user),
      db.prepare("UPDATE pilot_broadcast_deliveries SET status='cancelled',error_kind='owner_cancelled',lease_token=NULL,updated_at=? WHERE campaign_id=? AND status IN ('staged','pending','checking')").bind(now(),id),
      campaignAudit('cancel:'+id,id,user,'cancelled','cancelled'),
    ]);
    return result(user,id);
  }
  async function panel({actor} = {}) {
    const user = await requireOwner(actor);
    await expire();
    await records.backfillGroups(now());
    const rows = await records.all('SELECT * FROM pilot_broadcast_campaigns WHERE owner_id=? AND created_at>=? ORDER BY created_at DESC,rowid DESC LIMIT 10',user,now()-30*DAY);
    const recent = [];
    for (const row of rows) recent.push(await view(row));
    const candidate = await records.first("SELECT COUNT(*) AS count FROM pilot_broadcast_groups WHERE status IN ('active','unknown')");
    return { ok:true,candidateCount:Number(candidate.count),active:recent.find(row => ['draft','running'].includes(row.status)) || null,recent,composition:await composition(user) };
  }


  async function nextRunAt() {
    await records.ensure();
    const runtime = await records.first("SELECT lease_token,lease_until,next_send_at,(SELECT MIN(expires_at) FROM pilot_broadcast_campaigns WHERE status='draft') AS draft_at,(SELECT MIN(created_at+2592000) FROM pilot_broadcast_campaigns WHERE status='running') AS retention_at,(SELECT MIN(d.next_attempt_at) FROM pilot_broadcast_deliveries d JOIN pilot_broadcast_campaigns c ON c.id=d.campaign_id WHERE c.status='running' AND d.status='pending') AS pending_at,(SELECT MIN(claimed_at+120) FROM pilot_broadcast_deliveries WHERE status IN ('checking','sending')) AS claimed_at FROM pilot_broadcast_runtime WHERE id=1");
    const times = [];
    const leaseAt = runtime.lease_token && runtime.lease_until > now() ? runtime.lease_until : 0;
    if (runtime.pending_at !== null) times.push(Math.max(now(),Number(runtime.pending_at),Number(runtime.next_send_at),leaseAt));
    if (runtime.claimed_at !== null) times.push(Math.max(now(),Number(runtime.claimed_at),leaseAt));
    if (runtime.draft_at !== null) times.push(Math.max(now(),Number(runtime.draft_at)));
    if (runtime.retention_at !== null) times.push(Math.max(now(),Number(runtime.retention_at)));
    return times.length ? Math.min(...times) : null;
  }
  async function terminal(row, token, status, errorKind, messageId = null) {
    return changes(await records.run("UPDATE pilot_broadcast_deliveries SET status=?,error_kind=?,telegram_message_id=?,next_attempt_at=0,lease_token=NULL,updated_at=? WHERE campaign_id=? AND chat_id=? AND lease_token=? AND status IN ('checking','sending')",status,errorKind,messageId,now(),row.campaign_id,row.chat_id,token));
  }
  async function defer(row, token, errorKind, at, { readFailure = false, global = false } = {}) {
    const statements = [
      db.prepare("UPDATE pilot_broadcast_deliveries SET status=CASE WHEN EXISTS(SELECT 1 FROM pilot_broadcast_campaigns WHERE id=? AND status='running') THEN 'pending' ELSE 'cancelled' END,error_kind=?,read_failures=read_failures+?,next_attempt_at=?,lease_token=NULL,updated_at=? WHERE campaign_id=? AND chat_id=? AND lease_token=? AND status IN ('checking','sending')").bind(row.campaign_id,errorKind,readFailure?1:0,at,now(),row.campaign_id,row.chat_id,token),
    ];
    if (global) statements.push(db.prepare('UPDATE pilot_broadcast_runtime SET next_send_at=MAX(next_send_at,?),updated_at=? WHERE id=1 AND lease_token=?').bind(at,now(),token));
    return changes((await db.batch(statements))[0]);
  }
  async function readFailure(row, token, error) {
    if (definiteRejection(error) && error.code === 429) {
      await defer(row,token,'rate_limit',now()+retryDelay(error),{global:true});
      return 'retried';
    }
    if (definiteRejection(error)) {
      await terminal(row,token,'skipped','membership_unavailable');
      return 'skipped';
    }
    if (row.read_failures >= 2) {
      await terminal(row,token,'failed','membership_unavailable');
      return 'failed';
    }
    await defer(row,token,'membership_unavailable',now()+[5,15,60][Math.min(row.read_failures,2)],{readFailure:true});
    return 'retried';
  }
  async function preflight(row,token) {
    if (!groupId(row.chat_id)) {
      await terminal(row,token,'skipped','invalid_destination');
      return 'skipped';
    }
    const registry = await records.first('SELECT status FROM pilot_broadcast_groups WHERE chat_id=?',row.chat_id);
    if (registry?.status === 'disconnected') {
      await terminal(row,token,'skipped','bot_disconnected');
      return 'skipped';
    }
    let membership, observationAt;
    try {
      if (!identity) {
        const discovered = await api.call('getMe');
        if (!Number.isSafeInteger(discovered?.id) || discovered.id < 1 || discovered.is_bot !== true) throw new Error('unconfirmed_bot_identity');
        identity = { id:Number(discovered.id) };
      }
      observationAt = now();
      membership = await api.call('getChatMember',{chat_id:Number(row.chat_id),user_id:identity.id});
      if (membership?.user?.id !== identity.id || !['creator','administrator','member','restricted','left','kicked'].includes(membership?.status)) throw new Error('unconfirmed_membership');
    } catch (error) { return readFailure(row,token,error); }
    // Timestamp the read's start, not its completion: a newer authenticated
    // disconnect event must win even if this in-flight response is stale.
    await records.recordMembership(row.chat_id,membership.status,observationAt);
    if (['left','kicked'].includes(membership.status)) {
      await terminal(row,token,'skipped','bot_disconnected');
      return 'skipped';
    }
    if (membership.status === 'restricted' && (membership.is_member !== true || membership.can_send_messages === false)) {
      await terminal(row,token,'skipped','send_permission');
      return 'skipped';
    }
    // A newer authenticated membership update may have arrived during the read.
    if ((await records.first('SELECT status FROM pilot_broadcast_groups WHERE chat_id=?',row.chat_id))?.status === 'disconnected') {
      await terminal(row,token,'skipped','bot_disconnected');
      return 'skipped';
    }
    return null;
  }
  async function deliver(row,content,token) {
    const blocked = await preflight(row,token);
    if (blocked) return blocked;
    const started = now();
    const claimed = await db.batch([
      db.prepare("UPDATE pilot_broadcast_deliveries SET status='sending',attempts=attempts+1,claimed_at=?,updated_at=? WHERE campaign_id=? AND chat_id=? AND status='checking' AND lease_token=? AND EXISTS(SELECT 1 FROM pilot_broadcast_campaigns WHERE id=? AND status='running') AND EXISTS(SELECT 1 FROM pilot_broadcast_runtime WHERE id=1 AND lease_token=? AND lease_until>? AND next_send_at<=?)").bind(started,started,row.campaign_id,row.chat_id,token,row.campaign_id,token,started,started),
      db.prepare("UPDATE pilot_broadcast_runtime SET next_send_at=MAX(next_send_at,?),next_campaign_at=MAX(next_campaign_at,?),lease_until=?,updated_at=? WHERE id=1 AND lease_token=? AND EXISTS(SELECT 1 FROM pilot_broadcast_deliveries WHERE campaign_id=? AND chat_id=? AND status='sending' AND lease_token=? AND claimed_at=?)").bind(started+SPACING,started+CAMPAIGN_SPACING,started+LEASE,started,token,row.campaign_id,row.chat_id,token,started),
    ]);
    if (!changes(claimed[0])) {
      await defer(row,token,'awaiting_turn',now()+SPACING);
      return 'retried';
    }
    let response;
    try {
      response = await api.call(content.method,{chat_id:Number(row.chat_id),...content.params});
    } catch (error) {
      if (definiteRejection(error) && error.code === 429) {
        await defer(row,token,'rate_limit',now()+retryDelay(error),{global:true});
        return 'retried';
      }
      if (definiteRejection(error)) {
        const kind = error.code === 403 ? 'send_forbidden' : error.code === 400 ? 'message_rejected' : 'telegram_rejected';
        await terminal(row,token,'failed',kind);
        return 'failed';
      }
      // A timeout, network error or 5xx response may follow a committed send.
      await terminal(row,token,'unknown','delivery_unknown');
      return 'unknown';
    }
    if (!Number.isSafeInteger(response?.message_id) || response.message_id < 1 || Number(response?.chat?.id) !== Number(row.chat_id)) {
      await terminal(row,token,'unknown','delivery_unknown');
      return 'unknown';
    }
    const saved = await terminal(row,token,'sent',null,response.message_id);
    return saved ? 'sent' : 'unknown';
  }
  async function drain({limit = 6} = {}) {
    await expire();
    await records.backfillGroups(now());
    const token = crypto.randomUUID(), acquiredAt = now();
    const acquired = await records.run('UPDATE pilot_broadcast_runtime SET lease_token=?,lease_until=?,updated_at=? WHERE id=1 AND (lease_token IS NULL OR lease_until<=?)',token,acquiredAt+LEASE,acquiredAt,acquiredAt);
    const summary = {ok:true,processed:0,sent:0,skipped:0,failed:0,unknown:0,retried:0};
    if (!changes(acquired)) return {...summary,busy:true,nextRunAt:await nextRunAt()};
    try {
      // "checking" had no mutation. "sending" may already have reached Telegram.
      await db.batch([
        db.prepare("UPDATE pilot_broadcast_deliveries SET status='unknown',error_kind='delivery_unknown',lease_token=NULL,updated_at=? WHERE status='sending' AND claimed_at<=?").bind(now(),now()-LEASE),
        db.prepare("UPDATE pilot_broadcast_deliveries SET status=CASE WHEN NOT EXISTS(SELECT 1 FROM pilot_broadcast_campaigns WHERE id=campaign_id AND status='running') THEN 'cancelled' WHEN read_failures>=2 THEN 'failed' ELSE 'pending' END,error_kind='membership_unavailable',read_failures=read_failures+1,next_attempt_at=?,lease_token=NULL,updated_at=? WHERE status='checking' AND claimed_at<=?").bind(now()+5,now(),now()-LEASE),
      ]);
      await complete();
      const bounded = Math.max(1,Math.min(6,Number.isInteger(limit)?limit:6));
      for (let index=0;index<bounded;index++) {
        const current = await records.first("SELECT id,content_json FROM pilot_broadcast_campaigns WHERE status='running'");
        if (!current) break;
        const runtime = await records.first('SELECT lease_token,lease_until,next_send_at FROM pilot_broadcast_runtime WHERE id=1');
        if (runtime.lease_token !== token || runtime.lease_until <= now() || runtime.next_send_at > now()) break;
        const row = await records.first("SELECT * FROM pilot_broadcast_deliveries WHERE campaign_id=? AND status='pending' AND next_attempt_at<=? ORDER BY next_attempt_at,chat_id LIMIT 1",current.id,now());
        if (!row) break;
        const claim = await db.batch([
          db.prepare("UPDATE pilot_broadcast_deliveries SET status='checking',claimed_at=?,lease_token=?,updated_at=? WHERE campaign_id=? AND chat_id=? AND status='pending' AND EXISTS(SELECT 1 FROM pilot_broadcast_campaigns WHERE id=? AND status='running') AND EXISTS(SELECT 1 FROM pilot_broadcast_runtime WHERE id=1 AND lease_token=? AND lease_until>?)").bind(now(),token,now(),row.campaign_id,row.chat_id,row.campaign_id,token,now()),
          db.prepare('UPDATE pilot_broadcast_runtime SET lease_until=?,updated_at=? WHERE id=1 AND lease_token=?').bind(now()+LEASE,now(),token),
        ]);
        if (!changes(claim[0])) continue;
        let content;
        try { content = normalizeBroadcastContent(JSON.parse(current.content_json)); }
        catch {
          await terminal(row,token,'failed','invalid_content');
          summary.processed++; summary.failed++;
          await complete();
          continue;
        }
        const outcome = await deliver(row,content,token);
        summary.processed++;
        if (Object.hasOwn(summary,outcome)) summary[outcome]++;
        await complete();
      }
    } finally {
      // If a Worker exits before this release, the durable lease expires and
      // stale sending claims become unknown; they are never sent again.
      await records.run('UPDATE pilot_broadcast_runtime SET lease_token=NULL,lease_until=0,updated_at=? WHERE id=1 AND lease_token=?',now(),token);
    }
    return {...summary,nextRunAt:await nextRunAt()};
  }

  const safe = operation => async args => {
    try { return await operation(args); }
    catch (error) {
      if (error instanceof BroadcastError) throw error;
      throw new BroadcastError('service_unavailable',503);
    }
  };
  return {
    composeStart:safe(composeStart),composeState:safe(composeState),clearCompose:safe(clearCompose),
    createDraft:safe(createDraft),getDraft:safe(getDraft),setPreview:safe(setPreview),
    confirm:safe(confirm),cancel:safe(cancel),panel:safe(panel),drain:safe(drain),nextRunAt:safe(nextRunAt),
  };
}


