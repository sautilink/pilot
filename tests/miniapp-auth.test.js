import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { validateMiniAppInitData } from '../src/miniapp-auth.js';

const TOKEN = '900:public_test_only_token';
const NOW = 1792641600;
export function signedData(values = {}, token = TOKEN) {
  const params = new URLSearchParams({ auth_date: String(NOW), user: JSON.stringify({ id: 101, first_name: 'Asha', language_code: 'sw' }), query_id: 'test_public_query', ...values });
  const payload = [...params].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(payload).digest('hex'));
  return params.toString();
}

test('validates independently signed Telegram HMAC with signature included and retains only actor fields', async () => {
  const result = await validateMiniAppInitData(signedData({ signature: 'public_telegram_signature' }), TOKEN, { now: NOW });
  assert.deepEqual(result, { actor: { id: 101, first_name: 'Asha', language_code: 'sw' }, authenticatedAt: NOW });
});

test('rejects tampered identities, a token from another bot, and duplicate decoded parameters', async () => {
  const valid = signedData();
  for (const raw of [valid.replace('Asha', 'Admin'), `${valid}&user=%7B%7D`, `${valid}&%75ser=%7B%7D`, `${valid}&hash=${'0'.repeat(64)}`]) {
    await assert.rejects(validateMiniAppInitData(raw, TOKEN, { now: NOW }), { code: 'AUTH_REQUIRED' });
  }
  await assert.rejects(validateMiniAppInitData(valid, `${TOKEN}wrong`, { now: NOW }), { code: 'AUTH_REQUIRED' });
});

test('enforces expiry, future skew, numeric timestamps and real safe Telegram user IDs', async () => {
  await assert.rejects(validateMiniAppInitData(signedData({ auth_date: String(NOW - 3601) }), TOKEN, { now: NOW }), { code: 'SESSION_EXPIRED' });
  for (const auth_date of [String(NOW + 61), 'NaN', `${NOW}.5`, '0']) await assert.rejects(validateMiniAppInitData(signedData({ auth_date }), TOKEN, { now: NOW }));
  for (const id of [0, -101, 101.5, '101', 9007199254740992]) await assert.rejects(validateMiniAppInitData(signedData({ user: JSON.stringify({ id, first_name: 'Asha' }) }), TOKEN, { now: NOW }));
  await assert.rejects(validateMiniAppInitData(signedData({ user: JSON.stringify({ id: 101, first_name: 'Bot', is_bot: true }) }), TOKEN, { now: NOW }));
  assert.equal((await validateMiniAppInitData(signedData({ auth_date: String(NOW + 60) }), TOKEN, { now: NOW })).actor.id, 101);
});

test('rejects overlong, malformed and line-break-bearing init data', async () => {
  for (const raw of ['', 'a'.repeat(16385), `${signedData()}%ZZ`, signedData({ query_id: 'one\ntwo' }), signedData({ user: '{broken' })]) await assert.rejects(validateMiniAppInitData(raw, TOKEN, { now: NOW }));
});
