// Latency records deliberately contain only bounded categories and durations.
// Telegram URLs, parameters, chat/user/update identifiers and message content
// never enter this helper. It samples ordinary work and always records slow work.
const ROUTES = new Set(['webhook', 'telegram', 'control', 'broadcast', 'broadcast_wake', 'broadcast_alarm', 'tools', 'tools_wake', 'integration']);
const REPLIES = new Set(['sendMessage','editMessageText','sendPhoto','sendVideo','sendAnimation','sendDocument','copyMessage']);
const ACTIONS = new Set(['deleteMessage','deleteMessages','banChatMember','restrictChatMember']);
const databaseBindings = new WeakMap();
// Instrumentation must not create a new identity for existing schema/identity
// caches. Their readiness keys still belong to the actual Cloudflare binding.
export const databaseIdentity = db => databaseBindings.get(db) || db;
export function createRequestTiming(route, {
  now = () => performance.now(), sample = () => Math.random() < 0.02,
  report = record => console.info('pilot_performance', record),
  observe,
} = {}) {
  if (!ROUTES.has(route)) throw new TypeError('invalid_timing_route');
  const queuedAt = now();
  let startedAt = null, telegramMs = 0, telegramCalls = 0, databaseMs = 0, databaseCalls = 0;
  let firstReplyMs = null, firstActionMs = null, callbackAckMs = null;
  return {
    start() { startedAt = now(); },
    telegram(duration) { telegramCalls++; telegramMs += Math.max(0, duration); },
    database(duration) { databaseCalls++; databaseMs += Math.max(0, duration); },
    visible(method) {
      const elapsed = Math.max(0, now() - queuedAt);
      if (firstReplyMs === null && REPLIES.has(method)) firstReplyMs = elapsed;
      if (firstActionMs === null && ACTIONS.has(method)) firstActionMs = elapsed;
      if (callbackAckMs === null && method === 'answerCallbackQuery') callbackAckMs = elapsed;
    },
    finish(outcome = 'ok') {
      const endedAt = now(), beganAt = startedAt ?? endedAt;
      const queueMs = Math.max(0, beganAt - queuedAt), handlingMs = Math.max(0, endedAt - beganAt);
      // The distribution sample is independent of success and latency. Slow/error
      // diagnostics are retained separately and must never bias its percentiles.
      const sampled = sample();
      const record = {
        route, outcome: ['ok', 'retry', 'error'].includes(outcome) ? outcome : 'error',
        queue_ms: Math.round(queueMs), handling_ms: Math.round(handlingMs),
        telegram_calls: telegramCalls, telegram_ms: Math.round(telegramMs),
        db_calls: databaseCalls, db_ms: Math.round(databaseMs),
        first_reply_ms: firstReplyMs === null ? null : Math.round(firstReplyMs),
        first_action_ms: firstActionMs === null ? null : Math.round(firstActionMs),
        callback_ack_ms: callbackAckMs === null ? null : Math.round(callbackAckMs),
      };
      try { observe?.(record, { sampled }); } catch { /* Optional, non-blocking observer. */ }
      if (outcome === 'ok' && queueMs < 250 && handlingMs < 1000 && !sampled) return;
      try { report(record); } catch { /* Telemetry must not change an action's outcome. */ }
    },
  };
}

export function instrumentTelegram(api, currentTiming, now = () => performance.now()) {
  return {
    async call(method, parameters = {}) {
      const timing = currentTiming(), startedAt = now();
      try {
        const result = await api.call(method, parameters);
        if (result !== false && result != null) timing?.visible(method);
        return result;
      }
      finally { timing?.telegram(now() - startedAt); }
    },
  };
}

/** Preserve native D1 statements, transactions and errors. A batch is one RPC,
 * irrespective of its statement count. Only elapsed durations are observed;
 * neither SQL, bindings nor returned data enter a performance record.
 */
export function instrumentDatabase(db, currentTiming, now = () => performance.now()) {
  const originals = new WeakMap();
  const measure = async work => {
    const timing = currentTiming(), startedAt = now();
    try { return await work(); }
    finally { timing?.database(now() - startedAt); }
  };
  const statement = native => {
    const wrapped = { bind: (...values) => statement(native.bind(...values)) };
    for (const method of ['first','all','run','raw']) {
      wrapped[method] = (...args) => measure(() => native[method](...args));
    }
    originals.set(wrapped,native);
    return wrapped;
  };
  const binding = {
    prepare: sql => statement(db.prepare(sql)),
    batch: statements => measure(() => db.batch(statements.map(item => originals.get(item) || item))),
  };
  for (const method of ['exec','dump']) {
    if (typeof db[method] === 'function') binding[method] = (...args) => measure(() => db[method](...args));
  }
  if (typeof db.withSession === 'function') binding.withSession = (...args) => instrumentDatabase(db.withSession(...args),currentTiming,now);
  if (typeof db.getBookmark === 'function') binding.getBookmark = () => db.getBookmark();
  databaseBindings.set(binding,databaseIdentity(db));
  return binding;
}
