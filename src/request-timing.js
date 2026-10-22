// Latency records deliberately contain only bounded categories and durations.
// Telegram URLs, parameters, chat/user/update identifiers and message content
// never enter this helper. It samples ordinary work and always records slow work.
const ROUTES = new Set(['telegram', 'control', 'broadcast', 'broadcast_wake', 'broadcast_alarm', 'tools', 'tools_wake', 'integration']);
export function createRequestTiming(route, {
  now = () => performance.now(), sample = () => Math.random() < 0.02,
  report = record => console.info('pilot_performance', record),
} = {}) {
  if (!ROUTES.has(route)) throw new TypeError('invalid_timing_route');
  const queuedAt = now();
  let startedAt = null, telegramMs = 0, telegramCalls = 0;
  return {
    start() { startedAt = now(); },
    telegram(duration) { telegramCalls++; telegramMs += Math.max(0, duration); },
    finish(outcome = 'ok') {
      const endedAt = now(), beganAt = startedAt ?? endedAt;
      const queueMs = Math.max(0, beganAt - queuedAt), handlingMs = Math.max(0, endedAt - beganAt);
      if (outcome === 'ok' && queueMs < 250 && handlingMs < 1000 && !sample()) return;
      const record = {
        route, outcome: ['ok', 'retry', 'error'].includes(outcome) ? outcome : 'error',
        queue_ms: Math.round(queueMs), handling_ms: Math.round(handlingMs),
        telegram_calls: telegramCalls, telegram_ms: Math.round(telegramMs),
      };
      try { report(record); } catch { /* Telemetry must not change an action's outcome. */ }
    },
  };
}

export function instrumentTelegram(api, currentTiming, now = () => performance.now()) {
  return {
    async call(method, parameters = {}) {
      const timing = currentTiming(), startedAt = now();
      try { return await api.call(method, parameters); }
      finally { timing?.telegram(now() - startedAt); }
    },
  };
}
