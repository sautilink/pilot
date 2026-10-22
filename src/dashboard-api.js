import { validateMiniAppInitData, MiniAppAuthError } from './miniapp-auth.js';
import { createControlService, ControlError } from './control-service.js';
import { createTelegram } from './telegram.js';

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const READS = new Set(['groups', 'overview', 'incidents', 'appeals', 'settings', 'stats', 'audit', 'whitelist', 'mystatus', 'checklink']);
const WRITES = new Set(['configure', 'whitelist_add', 'whitelist_remove', 'pause', 'resume', 'subscribe', 'appeal_create', 'appeal_resolve', 'case_unban', 'case_forgive', 'join_approve', 'join_decline']);
const errorResponse = (code, status) => new Response(JSON.stringify({ ok: false, error: code }), { status, headers: HEADERS });
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const validChat = value => /^-[1-9]\d{0,15}$/.test(String(value)) && Number.isSafeInteger(Number(value));

async function readBody(request) {
  if (Number(request.headers.get('Content-Length') || 0) > 32768) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 32768) { await reader.cancel(); return null; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function handleDashboardApi(request, env, { api, clock = () => Math.floor(Date.now() / 1000), service } = {}) {
  if (request.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 405);
  let origin;
  try { origin = new URL(env.PUBLIC_BASE_URL || 'https://pilot.sautilink.com').origin; } catch { return errorResponse('UNAVAILABLE', 503); }
  if (request.headers.has('Origin') && request.headers.get('Origin') !== origin) return errorResponse('ORIGIN_REJECTED', 403);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return errorResponse('INVALID_REQUEST', 415);
  if (!env.DB || !env.BOT_TOKEN) return errorResponse('UNAVAILABLE', 503);
  try {
    const authorization = request.headers.get('Authorization') || '';
    if (!authorization.startsWith('tma ')) throw new MiniAppAuthError();
    const { actor } = await validateMiniAppInitData(authorization.slice(4), env.BOT_TOKEN, { now: clock() });
    const text = await readBody(request);
    if (text === null) return errorResponse('REQUEST_TOO_LARGE', 413);
    let body;
    try { body = JSON.parse(text); } catch { return errorResponse('INVALID_REQUEST', 400); }
    if (!plainObject(body) || Object.keys(body).some(key => !['view', 'action', 'chatId', 'input', 'requestId'].includes(key)) || (body.view === undefined) === (body.action === undefined) || (body.input !== undefined && !plainObject(body.input))) return errorResponse('INVALID_REQUEST', 400);
    const chatId = body.chatId == null ? undefined : String(body.chatId);
    if (chatId !== undefined && !validChat(chatId)) return errorResponse('INVALID_REQUEST', 400);
    const input = body.input || {};
    if (body.view !== undefined) {
      if (!READS.has(body.view)) return errorResponse('INVALID_REQUEST', 400);
      if (!['groups', 'mystatus', 'checklink'].includes(body.view) && !chatId) return errorResponse('INVALID_REQUEST', 400);
      const control = service || createControlService({ db: env.DB, api: api || createTelegram(env.BOT_TOKEN), clock });
      const result = await control.query({ actor, chatId, view: body.view, input });
      return new Response(JSON.stringify({ ok: true, data: result }), { headers: HEADERS });
    }
    if (!WRITES.has(body.action) || !chatId || typeof body.requestId !== 'string' || !/^[a-zA-Z0-9_-]{16,80}$/.test(body.requestId)) return errorResponse('INVALID_REQUEST', 400);
    if (!env.GROUPS) return errorResponse('UNAVAILABLE', 503);
    const coordinator = env.GROUPS.get(env.GROUPS.idFromName(chatId));
    const response = await coordinator.fetch(new Request('https://group.internal/control', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ actor, chatId, action: body.action, input, requestId: body.requestId }),
    }));
    let result;
    try { result = await response.json(); } catch { return errorResponse('UNAVAILABLE', 503); }
    if (!response.ok || result?.ok === false) {
      const code = typeof result?.error === 'string' && /^[A-Za-z_]{2,64}$/.test(result.error) ? result.error : 'UNAVAILABLE';
      return errorResponse(code, response.status >= 400 && response.status <= 599 ? response.status : 409);
    }
    return new Response(JSON.stringify({ ok: true, data: result }), { headers: HEADERS });
  } catch (error) {
    if (error instanceof MiniAppAuthError) return errorResponse(error.code, error.status);
    if (error instanceof ControlError) return errorResponse(error.code, error.status);
    return errorResponse('UNAVAILABLE', 503);
  }
}
