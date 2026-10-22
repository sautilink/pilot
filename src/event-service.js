import { createEventStore } from './event-store.js';
import { createSupportStore } from './support-store.js';
import { DEFAULT_EVENT_TIMEZONE, eventCalendar } from './event-calendar.js';

const DAY = 86400, LEASE = 120, MAX_PARTICIPANTS = 2000, MAX_REMINDERS = 500;
const admin = value => ['creator', 'administrator'].includes(value?.status);
const changes = result => Number(result?.meta?.changes ?? result?.changes ?? 0);

export function createEventExtensions({ db, api, clock, fail, authorize }) {
  const store = createEventStore(db), contacts = createSupportStore(db);
  let botIdentity;
  const now = () => Math.floor(clock());
  const timezone = async chat => (await store.first('SELECT timezone FROM pilot_event_settings WHERE chat_id=?', chat))?.timezone || DEFAULT_EVENT_TIMEZONE;
  const options = async eventId => await store.first('SELECT capacity,revision FROM pilot_event_options WHERE event_id=?', eventId) || { capacity: null, revision: 1 };

  function cancelPending(eventId, current, user = null) {
    return db.prepare(`UPDATE pilot_event_notifications SET status='skipped',error_kind='superseded',lease_token=NULL,updated_at=? WHERE event_id=? AND status IN ('pending','checking')${user ? ' AND user_id=?' : ''}`).bind(current, eventId, ...(user ? [user] : []));
  }

  function reminderStatements({ event, revision, current, user = null }) {
    return [db.prepare(`INSERT INTO pilot_event_notifications(id,chat_id,event_id,user_id,kind,revision,due_at,expires_at,status,created_at,updated_at)
      SELECT 'reminder:'||?||':'||?||':'||s.user_id,?,s.event_id,s.user_id,'reminder',?,MAX(?,?-s.lead_minutes*60),?,'pending',?,?
      FROM pilot_event_subscriptions s WHERE s.event_id=? AND s.enabled=1${user ? ' AND s.user_id=?' : ''}
      ON CONFLICT(id) DO UPDATE SET due_at=excluded.due_at,expires_at=excluded.expires_at,status='pending',attempts=0,read_failures=0,error_kind=NULL,updated_at=excluded.updated_at
      WHERE pilot_event_notifications.status IN ('pending','skipped')`).bind(event.id, revision, event.chat_id, revision, current, event.starts_at, event.starts_at, current, current, event.id, ...(user ? [user] : []))];
  }

  function notifySubscribers({ event, revision, current, kind, key }) {
    return db.prepare(`INSERT OR IGNORE INTO pilot_event_notifications(id,chat_id,event_id,user_id,kind,revision,due_at,expires_at,status,created_at,updated_at)
      SELECT ?||':'||s.user_id,?,s.event_id,s.user_id,?,?,?,?,'pending',?,?
      FROM pilot_event_subscriptions s WHERE s.event_id=? AND s.enabled=1`).bind(key, event.chat_id, kind, revision, current, current + DAY, current, current, event.id);
  }

  function reconcileStatements({ event, capacity, revision, current, key }) {
    return [
      // Old RSVP records remain valid when this feature is deployed.
      db.prepare(`INSERT OR IGNORE INTO pilot_event_attendance(event_id,user_id,joined_at,state)
        SELECT event_id,user_id,updated_at,'going' FROM pilot_event_rsvps WHERE event_id=? AND response='going' ORDER BY updated_at,rowid`).bind(event.id),
      db.prepare(`INSERT OR IGNORE INTO pilot_event_notifications(id,chat_id,event_id,user_id,kind,revision,due_at,expires_at,status,created_at,updated_at)
        SELECT ?||':'||a.user_id,?,a.event_id,a.user_id,'promoted',?,?,?,'pending',?,?
        FROM pilot_event_attendance a JOIN pilot_event_subscriptions s ON s.event_id=a.event_id AND s.user_id=a.user_id
        WHERE a.event_id=? AND a.state='waitlisted' AND s.enabled=1 AND a.user_id IN
        (SELECT user_id FROM pilot_event_attendance WHERE event_id=? ORDER BY joined_at,rowid LIMIT ?)`).bind(`promoted:${key}`, event.chat_id, revision, current, event.ends_at, current, current, event.id, event.id, capacity ?? MAX_PARTICIPANTS),
      db.prepare(`UPDATE pilot_event_attendance SET state=CASE WHEN user_id IN
        (SELECT user_id FROM pilot_event_attendance WHERE event_id=? ORDER BY joined_at,rowid LIMIT ?) THEN 'going' ELSE 'waitlisted' END
        WHERE event_id=?`).bind(event.id, capacity ?? MAX_PARTICIPANTS, event.id),
    ];
  }

  async function prepare({ action, value, user, chat, key, current }) {
    const statements = [], result = {};
    if (action === 'event_settings') {
      statements.push(db.prepare('INSERT INTO pilot_event_settings(chat_id,timezone,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET timezone=excluded.timezone,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(chat, value.timezone, user, current));
      return { statements, result: { timezone: value.timezone } };
    }
    let event;
    if (action === 'event_create') {
      const quota = await store.first("SELECT COUNT(*) AS total FROM pilot_events WHERE chat_id=? AND status='active' AND ends_at>=?", chat, current);
      if (Number(quota.total) >= 50) fail('quota_exceeded', 409);
      event = { id: key, chat_id: chat, creator_id: user, title: value.title, description: value.description, url: value.url, language: value.language, starts_at: value.startsAt, ends_at: value.endsAt, status: 'active', updated_at: current };
      statements.push(db.prepare("INSERT INTO pilot_events(id,chat_id,creator_id,title,description,url,language,starts_at,ends_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'active',?,?)").bind(key, chat, user, value.title, value.description, value.url, value.language, value.startsAt, value.endsAt, current, current));
      statements.push(db.prepare('INSERT INTO pilot_event_options(event_id,capacity,revision) VALUES(?,?,1)').bind(key, value.capacity ?? null));
      return { statements, result: { status: 'active', capacity: value.capacity ?? null } };
    }
    event = await store.first('SELECT * FROM pilot_events WHERE id=? AND chat_id=?', value.id, chat);
    if (!event) fail('not_found', 404);
    if (event.status !== 'active' && !(action === 'event_reminders' && value.enabled === false)) fail('operation_stale', 409);
    const meta = await options(event.id);
    if (action === 'event_update' || action === 'event_cancel') {
      const revision = Number(meta.revision) + 1;
      const capacity = Object.hasOwn(value, 'capacity') ? value.capacity : meta.capacity;
      statements.push(cancelPending(event.id, current));
      statements.push(db.prepare('INSERT INTO pilot_event_options(event_id,capacity,revision) VALUES(?,?,?) ON CONFLICT(event_id) DO UPDATE SET capacity=excluded.capacity,revision=excluded.revision').bind(event.id, capacity, revision));
      if (action === 'event_update') {
        event = { ...event, creator_id: user, title: value.title, description: value.description, url: value.url, language: value.language, starts_at: value.startsAt, ends_at: value.endsAt };
        statements.push(db.prepare('UPDATE pilot_events SET creator_id=?,title=?,description=?,url=?,language=?,starts_at=?,ends_at=?,updated_at=? WHERE id=? AND chat_id=?').bind(user, value.title, value.description, value.url, value.language, value.startsAt, value.endsAt, current, event.id, chat));
        statements.push(notifySubscribers({ event, revision, current, kind: 'updated', key: `updated:${event.id}:${revision}` }));
        statements.push(...reminderStatements({ event, revision, current }));
        // The update notification also informs members about capacity changes.
        statements.push(...reconcileStatements({ event, capacity, revision, current, key }));
        result.status = 'active'; result.capacity = capacity;
      } else {
        statements.push(db.prepare("UPDATE pilot_events SET status='cancelled',creator_id=?,updated_at=? WHERE id=? AND chat_id=?").bind(user, current, event.id, chat));
        statements.push(notifySubscribers({ event, revision, current, kind: 'cancelled', key: `cancelled:${event.id}:${revision}` }));
        result.status = 'cancelled';
      }
      return { statements, result };
    }
    if (action === 'event_rsvp') {
      if (event.ends_at <= current) fail('event_ended', 409);
      const previous = await store.first('SELECT response FROM pilot_event_rsvps WHERE event_id=? AND user_id=?', event.id, user);
      if (!previous && Number((await store.first('SELECT COUNT(*) AS total FROM pilot_event_rsvps WHERE event_id=?', event.id)).total) >= MAX_PARTICIPANTS) fail('quota_exceeded', 409);
      statements.push(db.prepare("INSERT OR IGNORE INTO pilot_event_attendance(event_id,user_id,joined_at,state) SELECT event_id,user_id,updated_at,'going' FROM pilot_event_rsvps WHERE event_id=? AND response='going' ORDER BY updated_at,rowid").bind(event.id));
      statements.push(db.prepare('INSERT INTO pilot_event_rsvps(event_id,user_id,response,updated_at) VALUES(?,?,?,?) ON CONFLICT(event_id,user_id) DO UPDATE SET response=excluded.response,updated_at=excluded.updated_at').bind(event.id, user, value.response, current));
      let response = value.response;
      if (value.response === 'going') {
        statements.push(db.prepare("INSERT OR IGNORE INTO pilot_event_attendance(event_id,user_id,joined_at,state) VALUES(?,?,?,'new')").bind(event.id, user, current));
        const existing = await store.first('SELECT joined_at,rowid AS queue_order FROM pilot_event_attendance WHERE event_id=? AND user_id=?', event.id, user);
        const queued = await store.all("SELECT r.user_id,COALESCE(a.joined_at,r.updated_at) AS joined_at,COALESCE(a.rowid,r.rowid) AS queue_order FROM pilot_event_rsvps r LEFT JOIN pilot_event_attendance a ON a.event_id=r.event_id AND a.user_id=r.user_id WHERE r.event_id=? AND r.response='going' AND r.user_id!=?", event.id, user);
        queued.push({ user_id: user, joined_at: existing?.joined_at ?? current, queue_order: existing?.queue_order ?? Math.max(0,...queued.map(item=>Number(item.queue_order)))+1 });
        queued.sort((a, b) => Number(a.joined_at) - Number(b.joined_at) || Number(a.queue_order) - Number(b.queue_order));
        if (meta.capacity != null && queued.findIndex(row => row.user_id === user) >= Number(meta.capacity)) response = 'waitlisted';
      } else statements.push(db.prepare('DELETE FROM pilot_event_attendance WHERE event_id=? AND user_id=?').bind(event.id, user));
      if (value.response === 'declined') {
        statements.push(db.prepare('UPDATE pilot_event_subscriptions SET enabled=0,updated_at=? WHERE event_id=? AND user_id=?').bind(current, event.id, user));
        statements.push(cancelPending(event.id, current, user));
      }
      statements.push(...reconcileStatements({ event, capacity: meta.capacity, revision: meta.revision, current, key }));
      return { statements, result: { response, requested_response: value.response } };
    }
    if (action === 'event_reminders') {
      if (value.enabled && event.starts_at <= current) fail('event_started', 409);
      if (value.enabled && !await contacts.privateContact(user)) fail('private_chat_required', 409);
      const previous = await store.first('SELECT enabled FROM pilot_event_subscriptions WHERE event_id=? AND user_id=?', event.id, user);
      if (value.enabled && !previous?.enabled && Number((await store.first('SELECT COUNT(*) AS total FROM pilot_event_subscriptions WHERE event_id=? AND enabled=1', event.id)).total) >= MAX_REMINDERS) fail('reminder_limit', 409);
      if (value.enabled && (await store.first('SELECT response FROM pilot_event_rsvps WHERE event_id=? AND user_id=?', event.id, user))?.response === 'declined') fail('rsvp_declined', 409);
      statements.push(db.prepare('INSERT INTO pilot_event_subscriptions(event_id,user_id,enabled,lead_minutes,language,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(event_id,user_id) DO UPDATE SET enabled=excluded.enabled,lead_minutes=excluded.lead_minutes,language=excluded.language,updated_at=excluded.updated_at').bind(event.id, user, value.enabled ? 1 : 0, value.leadMinutes, value.language || event.language, current, current));
      if (value.enabled) statements.push(...reminderStatements({ event, revision: meta.revision, current, user }));
      else statements.push(cancelPending(event.id, current, user));
      return { statements, result: { reminders: { enabled: value.enabled, leadMinutes: value.leadMinutes } } };
    }
    fail('invalid_action');
  }

  async function calendar(chat, eventId) {
    const event = await store.first('SELECT e.*,COALESCE(o.revision,1) AS revision FROM pilot_events e LEFT JOIN pilot_event_options o ON o.event_id=e.id WHERE e.chat_id=? AND e.id=? AND e.ends_at>=?', chat, eventId, now() - 30 * DAY);
    if (!event) fail('not_found', 404);
    return eventCalendar(event, await timezone(chat));
  }

  async function summary(chat) {
    return store.all('SELECT kind,status,COUNT(*) AS count FROM pilot_event_notifications WHERE chat_id=? AND created_at>=? GROUP BY kind,status ORDER BY kind,status', chat, now() - 30 * DAY);
  }
  const dueExpression = "CASE WHEN status IN ('checking','sending') THEN COALESCE(claimed_at,updated_at)+120 ELSE MIN(due_at,expires_at) END";
  async function nextRunAt(chat) {
    const row = await store.first(`SELECT MIN(${dueExpression}) AS due FROM pilot_event_notifications WHERE chat_id=? AND status IN ('pending','checking','sending')`, chat);
    return row?.due == null ? null : Number(row.due);
  }
  async function nextDueGroups(limit) {
    return store.all(`SELECT chat_id,MIN(${dueExpression}) AS due FROM pilot_event_notifications WHERE status IN ('pending','checking','sending') GROUP BY chat_id HAVING due<=? ORDER BY due,chat_id LIMIT ?`, now() + 600, limit);
  }

  async function drain(chat, { limit = 1, shouldYield = () => false } = {}) {
    const current = now();
    const next = await nextRunAt(chat);
    if (next == null || next > current) return [];
    await db.batch([
      db.prepare("UPDATE pilot_event_notifications SET status='unknown',error_kind='delivery_unknown',lease_token=NULL,updated_at=? WHERE chat_id=? AND status='sending' AND claimed_at<=?").bind(current, chat, current - LEASE),
      db.prepare("UPDATE pilot_event_notifications SET status='pending',lease_token=NULL,claimed_at=NULL,updated_at=? WHERE chat_id=? AND status='checking' AND claimed_at<=?").bind(current, chat, current - LEASE),
      db.prepare("UPDATE pilot_event_notifications SET status='skipped',error_kind='expired',updated_at=? WHERE chat_id=? AND status='pending' AND expires_at<=?").bind(current, chat, current),
    ]);
    const results = [];
    for (let index = 0; index < Math.min(3, Math.max(1, Number(limit) || 1)); index++) {
      if (shouldYield()) break;
      if (Number((await store.first('SELECT next_send_at FROM pilot_operations_runtime WHERE chat_id=?', chat))?.next_send_at || 0) > now()) break;
      const row = await store.first("SELECT * FROM pilot_event_notifications WHERE chat_id=? AND status='pending' AND due_at<=? AND expires_at>? ORDER BY due_at,id LIMIT 1", chat, now(), now());
      if (!row) break;
      if (shouldYield()) break;
      const lease = crypto.randomUUID();
      if (!changes(await store.run("UPDATE pilot_event_notifications SET status='checking',claimed_at=?,lease_token=?,updated_at=? WHERE id=? AND status='pending'", now(), lease, now(), row.id))) continue;
      const finish = async (status, error = null, due = row.due_at) => {
        await store.run('UPDATE pilot_event_notifications SET status=?,error_kind=?,due_at=?,lease_token=NULL,claimed_at=NULL,updated_at=? WHERE id=? AND lease_token=?', status, error, due, now(), row.id, lease);
        results.push({ id: row.id, kind: 'event_notice', status, error_kind: error });
      };
      let event, subscription, groupTitle = '';
      try {
        event = await store.first('SELECT e.*,COALESCE(o.revision,1) AS revision FROM pilot_events e LEFT JOIN pilot_event_options o ON o.event_id=e.id WHERE e.id=? AND e.chat_id=?', row.event_id, chat);
        subscription = await store.first('SELECT * FROM pilot_event_subscriptions WHERE event_id=? AND user_id=?', row.event_id, row.user_id);
        const cancelled = row.kind === 'cancelled';
        if (!event || !subscription?.enabled || Number(event.revision) !== Number(row.revision) || (cancelled ? event.status !== 'cancelled' : event.status !== 'active') || !await contacts.privateContact(row.user_id)) { await finish('skipped', 'no_longer_eligible'); continue; }
        await authorize(event.creator_id, chat);
        await authorize(row.user_id, chat, true);
        botIdentity ||= await api.call('getMe');
        if (!Number.isSafeInteger(botIdentity?.id) || botIdentity.id <= 0 || !botIdentity.is_bot) throw new Error('bot_unavailable');
        const [bot, info] = await Promise.all([api.call('getChatMember', { chat_id: Number(chat), user_id: botIdentity.id }), api.call('getChat', { chat_id: Number(chat) })]);
        if (!admin(bot) || !['group', 'supergroup'].includes(info?.type) || Number(info.id) !== Number(chat)) { await finish('skipped', 'bot_unavailable'); continue; }
        groupTitle = String(info.title || '').slice(0, 250);
      } catch (error) {
        if (error?.code === 'forbidden') await finish('skipped', 'access_changed');
        else {
          const failures = Number(row.read_failures) + 1;
          await store.run('UPDATE pilot_event_notifications SET read_failures=? WHERE id=? AND lease_token=?', failures, row.id, lease);
          await finish(failures >= 3 ? 'failed' : 'pending', 'authorization_unavailable', now() + 60);
        }
        continue;
      }
      const sw = subscription.language === 'sw', zone = await timezone(chat);
      const headings = { reminder: sw ? 'Kumbusho la event' : 'Event reminder', updated: sw ? 'Event imebadilishwa' : 'Event updated', cancelled: sw ? 'Event imeghairiwa' : 'Event cancelled', promoted: sw ? 'Nafasi yako ya event imethibitishwa' : 'Your event place is confirmed' };
      const when = new Intl.DateTimeFormat(sw ? 'sw-TZ' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: zone }).format(new Date(event.starts_at * 1000));
      const attendance = await store.first('SELECT state FROM pilot_event_attendance WHERE event_id=? AND user_id=?', event.id, row.user_id);
      if (row.kind === 'promoted' && attendance?.state !== 'going') { await finish('skipped', 'place_changed'); continue; }
      const body = `${headings[row.kind]}\n\n${event.title}${groupTitle ? '\n' + groupTitle : ''}\n${when} (${zone})${attendance?.state === 'waitlisted' ? '\n' + (sw ? 'Uko kwenye orodha ya kusubiri.' : 'You are on the waiting list.') : ''}${event.url && row.kind !== 'cancelled' ? '\n' + event.url : ''}\n\nSautiLink Pilot · from SautiLink Corporation`;
      if (shouldYield()) { await finish('pending'); break; }
      const claim = await db.batch([
        db.prepare("UPDATE pilot_event_notifications SET status='sending',claimed_at=?,attempts=attempts+1,updated_at=? WHERE id=? AND lease_token=? AND status='checking' AND EXISTS(SELECT 1 FROM pilot_event_subscriptions s WHERE s.event_id=pilot_event_notifications.event_id AND s.user_id=pilot_event_notifications.user_id AND s.enabled=1)").bind(now(), now(), row.id, lease),
        db.prepare('INSERT INTO pilot_operations_runtime(chat_id,next_send_at) VALUES(?,?) ON CONFLICT(chat_id) DO UPDATE SET next_send_at=MAX(pilot_operations_runtime.next_send_at,excluded.next_send_at)').bind(chat, now() + 3),
      ]);
      if (!changes(claim[0])) { await finish('skipped', 'no_longer_eligible'); continue; }
      try {
        const sent = await api.call('sendMessage', { chat_id: Number(row.user_id), text: body, link_preview_options: { is_disabled: true }, reply_markup: { inline_keyboard: [[{ text: sw ? 'Fungua event na vikumbusho' : 'Open events and reminders', url: `https://t.me/sautilinkpilotbot?start=community_${chat}` }]] } });
        if (!Number.isSafeInteger(sent?.message_id) || sent.message_id <= 0) throw new Error('delivery_unknown');
        await store.run("UPDATE pilot_event_notifications SET status='sent',message_id=?,error_kind=NULL,lease_token=NULL,claimed_at=NULL,updated_at=? WHERE id=? AND lease_token=?", sent.message_id, now(), row.id, lease);
        results.push({ id: row.id, kind: 'event_notice', status: 'sent' });
      } catch (error) {
        const definite = error?.ambiguous === false && Number.isInteger(error?.code) && error.code >= 400 && error.code < 500;
        const retry = definite && error.code === 429 && Number(row.attempts) < 2;
        const delay = Number.isFinite(Number(error?.retryAfter)) && Number(error.retryAfter) > 0 ? Math.ceil(Number(error.retryAfter)) : 60;
        const retryAt = Math.min(row.expires_at, now() + Math.max(3, delay));
        await finish(retry ? 'pending' : definite ? 'failed' : 'unknown', definite ? error.code === 429 ? 'rate_limit' : 'telegram_rejected' : 'delivery_unknown', retryAt);
        if (definite && error.code === 403) await contacts.disablePrivateContact(row.user_id, now());
      }
    }
    return results;
  }
  return { prepare, timezone, calendar, summary, nextRunAt, nextDueGroups, drain, limits: { participants: MAX_PARTICIPANTS, reminders: MAX_REMINDERS } };
}
