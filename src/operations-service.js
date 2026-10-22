import { createOperationsStore } from './operations-store.js';
import { createEventExtensions } from './event-service.js';
import { validEventTimezone } from './event-calendar.js';

export class OperationsError extends Error {
  constructor(code, status = 400) {
    super(code); this.name = 'OperationsError'; this.code = code; this.status = status;
  }
}

const DAY = 86400, LEASE = 120, MAX_SCHEDULES = 20, MAX_EVENTS = 50, MAX_HIGHLIGHTS = 50;
const ID = /^[a-f0-9]{24}$/;
export const OPERATIONS_READS = new Set(['operations','events','event_calendar']);
export const OPERATIONS_ACTIONS = new Set(['schedule_create','schedule_update','schedule_cancel','event_create','event_update','event_cancel','event_rsvp','event_reminders','event_settings','highlight_add','highlight_remove','highlight_schedule']);
const fail = (code, status = 400) => { throw new OperationsError(code, status); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const admin = value => ['creator','administrator'].includes(value?.status);
const member = value => ['creator','administrator','member'].includes(value?.status) || value?.status === 'restricted' && value.is_member === true;
const validUser = value => /^\d+$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
const validChat = value => /^-[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value));
const changes = value => Number(value?.meta?.changes ?? value?.changes ?? 0);
const parse = (value, fallback) => { try { return JSON.parse(value); } catch { return fallback; } };
const stable = value => Array.isArray(value) ? '[' + value.map(stable).join(',') + ']' : object(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}' : JSON.stringify(value);
async function hash(value) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value)));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,'0')).join('');
}
function keys(value, names) { if (!object(value) || Object.keys(value).some(key => !names.includes(key))) fail('invalid_input'); }
function text(value, limit, empty = false) {
  if (typeof value !== 'string' || value.length > limit || !empty && !value.trim() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) fail('invalid_text');
  return value.trim();
}
function id(value) { if (typeof value !== 'string' || !ID.test(value)) fail('invalid_id'); return value; }
function url(value = '') {
  if (value === '') return '';
  const source = text(value, 1024);
  let parsed; try { parsed = new URL(source); } catch { fail('invalid_url'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || /[\r\n]/.test(source)) fail('invalid_url');
  return parsed.href;
}
function language(value = 'en') { if (!['en','sw'].includes(value)) fail('invalid_language'); return value; }
function timestamp(value, current, min = 60) {
  if (!Number.isSafeInteger(value) || value < current + min || value > current + 365 * DAY) fail('invalid_time');
  return value;
}
function repeat(value = 'once') { if (!['once','daily','weekly'].includes(value)) fail('invalid_repeat'); return value; }
function digestText(items, lang) {
  const heading = lang === 'sw' ? 'Muhtasari wa community wa wiki' : 'This week in the community';
  const pieces = [heading];
  const included = [];
  for (const item of items.slice(0, 10)) {
    const entry = `• ${item.text}${item.url ? '\n' + item.url : ''}`;
    if (pieces.join('\n\n').length + entry.length + 2 > 3800) break;
    pieces.push(entry); included.push(item.id);
  }
  return { text: pieces.join('\n\n'), ids: included };
}

export function createOperationsService({ db, api, clock = () => Math.floor(Date.now() / 1000) }) {
  const store = createOperationsStore(db);
  let botIdentity;
  function now() {
    const value = Math.floor(clock());
    if (!Number.isSafeInteger(value) || value < 0) fail('unavailable', 503);
    return value;
  }
  function scope(actor, chatId) {
    if (!object(actor) || !validUser(actor.id) || actor.is_bot === true) fail('unauthorized', 401);
    if (!validChat(chatId)) fail('invalid_chat');
    return { user: String(actor.id), chat: String(chatId) };
  }
  async function authorize(user, chat, membership = false) {
    let current;
    try { current = await api.call('getChatMember', { chat_id: Number(chat), user_id: Number(user) }); }
    catch { fail('authorization_unavailable', 503); }
    if (!(membership ? member(current) : admin(current))) fail('forbidden', 403);
    return current;
  }
  const eventTools = createEventExtensions({ db, api, clock: now, fail, authorize });
  function scheduleView(row) {
    return { id:row.id,kind:row.kind,text:row.text,language:row.language,repeat:row.repeat,run_at:row.run_at,
      next_attempt_at:row.next_attempt_at,expires_at:row.expires_at,status:row.status,sent_count:row.sent_count,
      error_kind:row.error_kind,created_at:row.created_at,updated_at:row.updated_at,creator_id:row.creator_id };
  }
  async function events(chat, user) {
    const rows = await store.all(`SELECT e.*,
      SUM(CASE WHEN r.response='going' AND COALESCE(a.state,'going')!='waitlisted' THEN 1 ELSE 0 END) AS going_count,
      SUM(CASE WHEN r.response='maybe' THEN 1 ELSE 0 END) AS maybe_count,
      SUM(CASE WHEN r.response='declined' THEN 1 ELSE 0 END) AS declined_count,
      SUM(CASE WHEN a.state='waitlisted' THEN 1 ELSE 0 END) AS waitlisted_count,
      MAX(CASE WHEN r.user_id=? THEN CASE WHEN a.state='waitlisted' THEN 'waitlisted' ELSE r.response END ELSE NULL END) AS own_response,
      o.capacity,COALESCE(o.revision,1) AS revision,
      COALESCE(s.enabled,0) AS reminders_enabled,COALESCE(s.lead_minutes,60) AS reminder_lead
      FROM pilot_events e LEFT JOIN pilot_event_rsvps r ON r.event_id=e.id
      LEFT JOIN pilot_event_attendance a ON a.event_id=r.event_id AND a.user_id=r.user_id
      LEFT JOIN pilot_event_options o ON o.event_id=e.id
      LEFT JOIN pilot_event_subscriptions s ON s.event_id=e.id AND s.user_id=?
      WHERE e.chat_id=? AND e.ends_at>=? GROUP BY e.id ORDER BY CASE WHEN e.status='active' THEN 0 ELSE 1 END,e.starts_at,e.id LIMIT 50`,user,user,chat,now()-DAY);
    return rows.map(row=>({ id:row.id,title:row.title,description:row.description,url:row.url,language:row.language,starts_at:row.starts_at,ends_at:row.ends_at,status:row.status,
      counts:{going:Number(row.going_count),maybe:Number(row.maybe_count),declined:Number(row.declined_count)},response:row.own_response || null,
      capacity:row.capacity,waiting:Number(row.waitlisted_count),revision:Number(row.revision),reminders:{enabled:!!row.reminders_enabled,leadMinutes:Number(row.reminder_lead)} }));
  }
  async function query({ actor, chatId, view, input = {} }) {
    const {user,chat} = scope(actor,chatId);
    if (!OPERATIONS_READS.has(view)) fail('invalid_view');
    keys(input,view === 'event_calendar' ? ['id'] : []);
    await authorize(user,chat,view !== 'operations');
    await store.ensure();
    if(view === 'event_calendar') return eventTools.calendar(chat,id(input.id));
    const eventRows = await events(chat,user);
    const timezone = await eventTools.timezone(chat);
    if (view === 'events') return { events:eventRows, timezone };
    const schedules = (await store.all('SELECT * FROM pilot_schedules WHERE chat_id=? ORDER BY created_at DESC,id DESC LIMIT 50',chat)).map(scheduleView);
    const deliveries = await store.all('SELECT d.schedule_id,d.run_at,d.status,d.message_id,d.error_kind,d.updated_at FROM pilot_schedule_deliveries d JOIN pilot_schedules s ON s.id=d.schedule_id WHERE s.chat_id=? ORDER BY d.updated_at DESC,d.run_at DESC LIMIT 50',chat);
    const highlights = await store.all('SELECT id,text,url,created_at,sent_at,creator_id FROM pilot_highlights WHERE chat_id=? AND created_at>=? ORDER BY created_at DESC,id DESC LIMIT 50',chat,now()-30*DAY);
    const audit = await store.all('SELECT actor_id,action,target_id,created_at FROM pilot_operations_audit WHERE chat_id=? ORDER BY created_at DESC,id DESC LIMIT 30',chat);
    return { schedules,events:eventRows,highlights,deliveries,audit,timezone,eventDeliveries:await eventTools.summary(chat),limits:{schedules:MAX_SCHEDULES,events:MAX_EVENTS,highlights:MAX_HIGHLIGHTS,recurrenceDays:90,...eventTools.limits} };
  }

  function normalize(action,input,current) {
    if (action === 'schedule_create' || action === 'schedule_update') {
      keys(input,['id','text','runAt','repeat','language','confirmed']);
      if (input.confirmed !== true) fail('confirmation_required');
      if (action === 'schedule_create' && input.id !== undefined) fail('invalid_input');
      return { ...(action === 'schedule_update' ? {id:id(input.id)} : {}),text:text(input.text,3800),runAt:timestamp(input.runAt,current),repeat:repeat(input.repeat),language:language(input.language),confirmed:true };
    }
    if (['schedule_cancel','event_cancel','highlight_remove'].includes(action)) { keys(input,['id']); return {id:id(input.id)}; }
    if (action === 'event_create' || action === 'event_update') {
      keys(input,['id','title','description','startsAt','endsAt','url','language','capacity']);
      if (action === 'event_create' && input.id !== undefined) fail('invalid_input');
      const startsAt = timestamp(input.startsAt,current);
      const endsAt = input.endsAt ?? startsAt + 3600;
      if (!Number.isSafeInteger(endsAt) || endsAt <= startsAt || endsAt > startsAt + 7 * DAY) fail('invalid_time');
      if(input.capacity !== undefined && input.capacity !== null && (!Number.isSafeInteger(input.capacity) || input.capacity < 1 || input.capacity > 2000)) fail('invalid_capacity');
      return { ...(action === 'event_update' ? {id:id(input.id)} : {}),title:text(input.title,160),description:text(input.description ?? '',1500,true),startsAt,endsAt,url:url(input.url),language:language(input.language),...(input.capacity === undefined ? {} : {capacity:input.capacity}) };
    }
    if (action === 'event_rsvp') {
      keys(input,['id','response']);
      if (!['going','maybe','declined'].includes(input.response)) fail('invalid_response');
      return {id:id(input.id),response:input.response};
    }
    if(action === 'event_settings') {
      keys(input,['timezone']);let timezone;
      try { timezone=validEventTimezone(input.timezone); } catch { fail('invalid_timezone'); }
      return {timezone};
    }
    if(action === 'event_reminders') {
      keys(input,['id','enabled','leadMinutes','language']);
      if(typeof input.enabled !== 'boolean') fail('invalid_input');
      const leadMinutes=input.leadMinutes??60;
      if(![5,15,30,60,1440].includes(leadMinutes)) fail('invalid_reminder');
      return {id:id(input.id),enabled:input.enabled,leadMinutes,...(input.language===undefined?{}:{language:language(input.language)})};
    }
    if (action === 'highlight_add') { keys(input,['text','url']); return {text:text(input.text,600),url:url(input.url)}; }
    if (action === 'highlight_schedule') {
      keys(input,['ids','runAt','repeat','language','confirmed']);
      if (input.confirmed !== true) fail('confirmation_required');
      const recurrence = repeat(input.repeat);
      if (recurrence === 'daily') fail('invalid_repeat');
      if (input.ids !== undefined && (!Array.isArray(input.ids) || input.ids.length < 1 || input.ids.length > 10 || new Set(input.ids).size !== input.ids.length || recurrence !== 'once')) fail('invalid_highlights');
      return { ...(input.ids === undefined ? {} : {ids:input.ids.map(id)}),runAt:timestamp(input.runAt,current),repeat:recurrence,language:language(input.language),confirmed:true };
    }
    fail('invalid_action');
  }

  async function perform({actor,chatId,action,input = {},requestId}) {
    const {user,chat} = scope(actor,chatId);
    if (!OPERATIONS_ACTIONS.has(action)) fail('invalid_action');
    if (typeof requestId !== 'string' || !/^[a-zA-Z0-9_:-]{16,160}$/.test(requestId)) fail('invalid_request_id');
    await authorize(user,chat,['event_rsvp','event_reminders'].includes(action));
    await store.ensure();
    // Replays are checked before time validation so a legitimate retry tomorrow
    // can still recover the result of today's schedule without making a new send.
    const rawHash = await hash({action,input});
    const previous = await store.first('SELECT * FROM pilot_operations_requests WHERE request_id=? AND chat_id=? AND actor_id=?',requestId,chat,user);
    if (previous) {
      if (previous.action !== action || previous.input_hash !== rawHash) fail('request_conflict',409);
      return {...parse(previous.result_json,{}),duplicate:true};
    }
    const current = now(), value = normalize(action,input,current);
    const recent = await store.first('SELECT COUNT(*) AS total FROM pilot_operations_requests WHERE chat_id=? AND actor_id=? AND created_at>?',chat,user,current-3600);
    if (Number(recent.total) >= (['event_rsvp','event_reminders'].includes(action)?60:120)) fail('rate_limited',429);
    const key = (await hash({requestId,chat,user,action})).slice(0,24);
    const target = value.id || key;
    const statements = [];
    let result = {ok:true,id:target,action};
    const requireRow = async (table,requiredStatus) => {
      const row = await store.first(`SELECT * FROM ${table} WHERE id=? AND chat_id=?`,value.id,chat);
      if (!row) fail('not_found',404);
      if (requiredStatus && !requiredStatus.includes(row.status)) fail('operation_stale',409);
      return row;
    };
    const quota = async (sql,max) => { if (Number((await store.first(sql,chat,current)).total) >= max) fail('quota_exceeded',409); };
    const insertSchedule = (kind,source,recurrence,runAt,lang) => {
      const expiry = runAt + (recurrence === 'once' ? DAY : 90 * DAY);
      statements.push(db.prepare("INSERT INTO pilot_schedules(id,chat_id,creator_id,kind,text,language,repeat,run_at,next_attempt_at,expires_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'pending',?,?)").bind(key,chat,user,kind,source,lang,recurrence,runAt,runAt,expiry,current,current));
      result = {...result,status:'pending',run_at:runAt,expires_at:expiry};
    };
    if (action === 'schedule_create' || action === 'highlight_schedule') {
      await quota("SELECT COUNT(*) AS total FROM pilot_schedules WHERE chat_id=? AND status IN ('pending','checking','sending') AND expires_at>=?",MAX_SCHEDULES);
      if (action === 'schedule_create') insertSchedule('announcement',value.text,value.repeat,value.runAt,value.language);
      else if (value.ids) {
        const rows = [];
        for (const itemId of value.ids) {
          const row = await store.first('SELECT id,text,url FROM pilot_highlights WHERE id=? AND chat_id=? AND created_at>=?',itemId,chat,current-30*DAY);
          if (!row) fail('not_found',404); rows.push(row);
        }
        const digest = digestText(rows,value.language);
        if (digest.ids.length !== rows.length) fail('digest_too_long');
        insertSchedule('announcement',digest.text,'once',value.runAt,value.language);
      } else insertSchedule('highlights','',value.repeat,value.runAt,value.language);
    } else if (action === 'schedule_update') {
      const row = await requireRow('pilot_schedules',['pending','paused']);
      if (row.kind !== 'announcement') fail('invalid_action');
      if (row.status==='paused') await quota("SELECT COUNT(*) AS total FROM pilot_schedules WHERE chat_id=? AND status IN ('pending','checking','sending') AND expires_at>=?",MAX_SCHEDULES);
      // The editing admin becomes the sending authority for future occurrences.
      statements.push(db.prepare("UPDATE pilot_schedules SET creator_id=?,text=?,language=?,repeat=?,run_at=?,next_attempt_at=?,expires_at=?,status='pending',lease_token=NULL,claimed_at=NULL,attempts=0,read_failures=0,error_kind=NULL,updated_at=? WHERE id=? AND chat_id=?").bind(user,value.text,value.language,value.repeat,value.runAt,value.runAt,value.runAt+(value.repeat==='once'?DAY:90*DAY),current,value.id,chat));
      result.status='pending';
    } else if (action === 'schedule_cancel') {
      await requireRow('pilot_schedules',['pending','paused','unknown']);
      statements.push(db.prepare("UPDATE pilot_schedules SET status='cancelled',lease_token=NULL,claimed_at=NULL,error_kind='admin_cancelled',updated_at=? WHERE id=? AND chat_id=?").bind(current,value.id,chat));
      result.status='cancelled';
    } else if (action.startsWith('event_')) {
      const prepared = await eventTools.prepare({action,value,user,chat,key,current});
      statements.push(...prepared.statements);result={...result,...prepared.result};
    } else if (action === 'highlight_add') {
      await quota('SELECT COUNT(*) AS total FROM pilot_highlights WHERE chat_id=? AND created_at>=?-2592000',MAX_HIGHLIGHTS);
      statements.push(db.prepare('INSERT INTO pilot_highlights(id,chat_id,creator_id,text,url,created_at) VALUES(?,?,?,?,?,?)').bind(key,chat,user,value.text,value.url,current));
    } else if (action === 'highlight_remove') {
      await requireRow('pilot_highlights');
      statements.push(db.prepare('DELETE FROM pilot_highlights WHERE id=? AND chat_id=?').bind(value.id,chat));
    }
    statements.push(db.prepare('INSERT INTO pilot_operations_requests(request_id,chat_id,actor_id,action,input_hash,result_json,created_at) VALUES(?,?,?,?,?,?,?)').bind(requestId,chat,user,action,rawHash,JSON.stringify(result),current));
    // RSVP identities are kept only in the RSVP table, never in admin activity.
    if (!['event_rsvp','event_reminders'].includes(action)) statements.push(db.prepare('INSERT INTO pilot_operations_audit(id,chat_id,actor_id,action,target_id,created_at) VALUES(?,?,?,?,?,?)').bind(key,chat,user,action,target,current));
    try { await db.batch(statements); }
    catch (error) {
      const replay = await store.first('SELECT * FROM pilot_operations_requests WHERE request_id=? AND chat_id=? AND actor_id=?',requestId,chat,user);
      if (replay?.input_hash === rawHash && replay?.action === action) return {...parse(replay.result_json,{}),duplicate:true};
      throw error;
    }
    return result;
  }

  async function recover(chat) {
    const current = now(), since = current - LEASE;
    await db.batch([
      db.prepare("UPDATE pilot_schedule_deliveries SET status='unknown',error_kind='delivery_unknown',updated_at=? WHERE status='sending' AND schedule_id IN (SELECT id FROM pilot_schedules WHERE chat_id=? AND status='sending' AND claimed_at<=?)").bind(current,chat,since),
      db.prepare("UPDATE pilot_schedules SET status='unknown',error_kind='delivery_unknown',lease_token=NULL,updated_at=? WHERE chat_id=? AND status='sending' AND claimed_at<=?").bind(current,chat,since),
      db.prepare("UPDATE pilot_schedules SET status='pending',lease_token=NULL,claimed_at=NULL,next_attempt_at=?,updated_at=? WHERE chat_id=? AND status='checking' AND claimed_at<=?").bind(current,current,chat,since),
      db.prepare("UPDATE pilot_schedules SET status='completed',error_kind='schedule_expired',updated_at=? WHERE chat_id=? AND status='pending' AND expires_at<?").bind(current,chat,current),
    ]);
  }
  async function nextRunAt(chatId) {
    if (!validChat(chatId)) fail('invalid_chat');
    await store.ensure();
    const chat = String(chatId);
    const row = await store.first("SELECT MIN(CASE WHEN status IN ('checking','sending') THEN COALESCE(claimed_at,updated_at)+? ELSE MAX(run_at,next_attempt_at) END) AS due FROM pilot_schedules WHERE chat_id=? AND status IN ('pending','checking','sending')",LEASE,chat);
    const eventDue = await eventTools.nextRunAt(chat);
    const due = [row?.due,eventDue].filter(value=>value!=null).map(Number);
    if (!due.length) return null;
    const runtime = await store.first('SELECT next_send_at FROM pilot_operations_runtime WHERE chat_id=?',chat);
    return Math.max(Math.min(...due),Number(runtime?.next_send_at || 0));
  }
  async function nextDueGroups({limit = 50} = {}) {
    await store.ensure();
    const bounded = Math.min(100,Math.max(1,Math.floor(limit) || 50));
    const schedules=await store.all("SELECT chat_id,MIN(CASE WHEN status IN ('checking','sending') THEN COALESCE(claimed_at,updated_at)+? ELSE MAX(run_at,next_attempt_at) END) AS due FROM pilot_schedules WHERE status IN ('pending','checking','sending') GROUP BY chat_id HAVING due<=? ORDER BY due,chat_id LIMIT ?",LEASE,now()+600,bounded);
    const eventGroups=await eventTools.nextDueGroups(bounded),due=new Map();
    for(const row of [...schedules,...eventGroups])due.set(row.chat_id,Math.min(due.get(row.chat_id)??Infinity,Number(row.due)));
    return [...due].sort((a,b)=>a[1]-b[1]||a[0].localeCompare(b[0])).slice(0,bounded).map(([chat])=>chat);
  }
  async function drain(chatId,{limit = 1,shouldYield = () => false} = {}) {
    if (!validChat(chatId)) fail('invalid_chat');
    const chat = String(chatId);
    await store.ensure();
    await recover(chat);
    const results = [];
    for (let index=0;index<Math.min(3,Math.max(1,Math.floor(limit) || 1));index++) {
      if (shouldYield()) break;
      const current = now();
      const runtime = await store.first('SELECT next_send_at FROM pilot_operations_runtime WHERE chat_id=?',chat);
      if (Number(runtime?.next_send_at || 0)>current) break;
      const row = await store.first("SELECT * FROM pilot_schedules WHERE chat_id=? AND status='pending' AND run_at<=? AND next_attempt_at<=? AND expires_at>=? ORDER BY MAX(run_at,next_attempt_at),run_at,id LIMIT 1",chat,current,current,current);
      const eventDue = await eventTools.nextRunAt(chat);
      // Share one optional-work budget and choose the earlier due item. A slow
      // schedule cannot spend a second job on reminders or starve an older one.
      if (eventDue != null && eventDue <= current && (!row || eventDue <= Math.max(row.run_at,row.next_attempt_at))) {
        results.push(...await eventTools.drain(chat,{limit:1,shouldYield}));
        continue;
      }
      if (!row) break;
      if (shouldYield()) break;
      const lease = crypto.randomUUID();
      if (!changes(await store.run("UPDATE pilot_schedules SET status='checking',lease_token=?,claimed_at=?,updated_at=? WHERE id=? AND status='pending' AND run_at=?",lease,current,current,row.id,row.run_at))) continue;
      const stop = async (status,errorKind,nextAttempt = null) => {
        await store.run('UPDATE pilot_schedules SET status=?,error_kind=?,next_attempt_at=?,lease_token=NULL,claimed_at=NULL,updated_at=? WHERE id=? AND lease_token=?',status,errorKind,nextAttempt ?? current,current,row.id,lease);
        results.push({id:row.id,status,error_kind:errorKind});
      };
      try {
        await authorize(row.creator_id,chat);
        botIdentity ||= await api.call('getMe');
        if (!validUser(botIdentity?.id) || botIdentity.is_bot !== true) fail('bot_unavailable',503);
        const bot = await api.call('getChatMember',{chat_id:Number(chat),user_id:Number(botIdentity.id)});
        if (!admin(bot) || bot.can_send_messages === false) { await stop('paused','bot_permission'); continue; }
        const info = await api.call('getChat',{chat_id:Number(chat)});
        if (!['group','supergroup'].includes(info?.type) || Number(info.id) !== Number(chat)) { await stop('paused','invalid_group'); continue; }
      } catch(error) {
        if (error?.code === 'forbidden') await stop('paused','creator_not_admin');
        else {
          const failures = Number(row.read_failures)+1;
          await store.run('UPDATE pilot_schedules SET read_failures=? WHERE id=? AND lease_token=?',failures,row.id,lease);
          await stop(failures>=3?'paused':'pending','authorization_unavailable',current+60);
        }
        continue;
      }
      let content = row.text, highlightIds = [];
      if (row.kind === 'highlights') {
        const items = await store.all('SELECT id,text,url FROM pilot_highlights WHERE chat_id=? AND created_at>=? AND sent_at IS NULL ORDER BY created_at,id LIMIT 10',chat,current-7*DAY);
        const digest = digestText(items,row.language);
        content = digest.text; highlightIds = digest.ids;
      }
      const prior = await store.first('SELECT status FROM pilot_schedule_deliveries WHERE schedule_id=? AND run_at=?',row.id,row.run_at);
      if (prior && ['sending','unknown','sent','skipped'].includes(prior.status)) {
        await stop('unknown','delivery_state_conflict'); continue;
      }
      const interval = row.repeat === 'daily' ? DAY : row.repeat === 'weekly' ? 7*DAY : 0;
      const following = interval ? row.run_at+(Math.floor(Math.max(0,current-row.run_at)/interval)+1)*interval : 0;
      const completion = (status,messageId,errorKind = null) => {
        const recurring = following>0 && following<=row.expires_at;
        const batch = [
          db.prepare('INSERT INTO pilot_schedule_deliveries(schedule_id,run_at,status,message_id,error_kind,highlight_ids,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(schedule_id,run_at) DO UPDATE SET status=excluded.status,message_id=excluded.message_id,error_kind=excluded.error_kind,highlight_ids=excluded.highlight_ids,updated_at=excluded.updated_at').bind(row.id,row.run_at,status,messageId,errorKind,JSON.stringify(highlightIds),now()),
          db.prepare("UPDATE pilot_schedules SET status=?,run_at=?,next_attempt_at=?,lease_token=NULL,claimed_at=NULL,attempts=0,read_failures=0,sent_count=sent_count+?,error_kind=?,updated_at=? WHERE id=? AND lease_token=?").bind(recurring?'pending':'completed',recurring?following:row.run_at,recurring?following:row.run_at,status==='sent'?1:0,errorKind,now(),row.id,lease),
        ];
        for (const itemId of highlightIds) batch.push(db.prepare('UPDATE pilot_highlights SET sent_at=? WHERE id=? AND chat_id=? AND sent_at IS NULL').bind(now(),itemId,chat));
        return batch;
      };
      if (row.kind==='highlights' && highlightIds.length===0) {
        await db.batch(completion('skipped',null,'no_highlights'));
        results.push({id:row.id,status:'skipped',error_kind:'no_highlights'}); continue;
      }
      if (shouldYield()) { await stop('pending',null,row.next_attempt_at); break; }
      const sending = await db.batch([
        db.prepare("UPDATE pilot_schedules SET status='sending',claimed_at=?,attempts=attempts+1,updated_at=? WHERE id=? AND lease_token=? AND status='checking'").bind(now(),now(),row.id,lease),
        db.prepare("INSERT INTO pilot_schedule_deliveries(schedule_id,run_at,status,highlight_ids,updated_at) SELECT ?,?,'sending',?,? WHERE EXISTS(SELECT 1 FROM pilot_schedules WHERE id=? AND lease_token=? AND status='sending') ON CONFLICT(schedule_id,run_at) DO UPDATE SET status='sending',highlight_ids=excluded.highlight_ids,updated_at=excluded.updated_at WHERE pilot_schedule_deliveries.status IN ('failed','checking')").bind(row.id,row.run_at,JSON.stringify(highlightIds),now(),row.id,lease),
        db.prepare('INSERT INTO pilot_operations_runtime(chat_id,next_send_at) VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET next_send_at=MAX(pilot_operations_runtime.next_send_at,excluded.next_send_at)').bind(chat,now()+3),
      ]);
      if (!changes(sending[0]) || !changes(sending[1])) { await stop('unknown','delivery_state_conflict'); continue; }
      try {
        const response = await api.call('sendMessage',{chat_id:Number(chat),text:content,link_preview_options:{is_disabled:true}});
        if (!Number.isSafeInteger(response?.message_id) || response.message_id <= 0) throw new Error('delivery_unknown');
        await db.batch(completion('sent',response.message_id));
        results.push({id:row.id,status:'sent',message_id:response.message_id});
      } catch(error) {
        const definite = error?.ambiguous === false && Number.isInteger(error?.code) && error.code>=400 && error.code<500;
        const retry = definite && error.code===429 && Number(row.attempts)<2;
        const errorKind = definite ? error.code===429?'rate_limit':'telegram_rejected' : 'delivery_unknown';
        const retryAt = now()+Math.min(3600,Math.max(3,Number(error?.retryAfter)||60));
        await db.batch([
          db.prepare('UPDATE pilot_schedule_deliveries SET status=?,error_kind=?,updated_at=? WHERE schedule_id=? AND run_at=?').bind(definite?'failed':'unknown',errorKind,now(),row.id,row.run_at),
          db.prepare('UPDATE pilot_schedules SET status=?,error_kind=?,next_attempt_at=?,lease_token=NULL,claimed_at=NULL,updated_at=? WHERE id=? AND lease_token=?').bind(retry?'pending':definite?'paused':'unknown',errorKind,retryAt,now(),row.id,lease),
        ]);
        results.push({id:row.id,status:retry?'pending':definite?'paused':'unknown',error_kind:errorKind});
      }
    }
    return {ok:true,results,nextRunAt:await nextRunAt(chat)};
  }
  return { query,perform,nextRunAt,nextDueGroups,drain,cleanup:at=>store.cleanup(at??now()) };
}
