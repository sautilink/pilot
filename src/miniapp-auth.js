// Telegram's bot-token Mini App validation scheme. `signature`, when present,
// remains in this HMAC payload; only third-party Ed25519 validation omits it.
const encoder = new TextEncoder();

export class MiniAppAuthError extends Error {
  constructor(code = 'AUTH_REQUIRED') {
    super(code);
    this.name = 'MiniAppAuthError';
    this.code = code;
    this.status = 401;
  }
}

async function hmac(key, value) {
  const imported = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(value)));
}

export async function validateMiniAppInitData(raw, botToken, { now = Math.floor(Date.now() / 1000), maxAgeSeconds = 3600 } = {}) {
  if (typeof raw !== 'string' || raw.length === 0 || encoder.encode(raw).length > 16384 || typeof botToken !== 'string' || !botToken) throw new MiniAppAuthError();
  if (/%(?![\da-f]{2})/i.test(raw)) throw new MiniAppAuthError();
  const params = new URLSearchParams(raw);
  const seen = new Set();
  for (const [key, value] of params) {
    if (seen.has(key) || !/^[a-zA-Z0-9_]+$/.test(key) || /[\r\n\u0000]/.test(value)) throw new MiniAppAuthError();
    seen.add(key);
  }
  const hash = params.get('hash');
  if (!/^[a-f0-9]{64}$/i.test(hash || '')) throw new MiniAppAuthError();
  const payload = [...params].filter(([key]) => key !== 'hash').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = await hmac(encoder.encode('WebAppData'), botToken);
  const expected = await hmac(secret, payload);
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= expected[index] ^ Number.parseInt(hash.slice(index * 2, index * 2 + 2), 16);
  if (difference !== 0) throw new MiniAppAuthError();

  const authDate = params.get('auth_date');
  if (!/^[1-9]\d{0,12}$/.test(authDate || '')) throw new MiniAppAuthError();
  const authenticatedAt = Number(authDate);
  if (!Number.isSafeInteger(authenticatedAt) || !Number.isFinite(now) || authenticatedAt > now + 60) throw new MiniAppAuthError();
  if (now - authenticatedAt > maxAgeSeconds) throw new MiniAppAuthError('SESSION_EXPIRED');

  let user;
  try { user = JSON.parse(params.get('user') || 'null'); } catch { throw new MiniAppAuthError(); }
  if (!user || typeof user !== 'object' || Array.isArray(user) || !Number.isSafeInteger(user.id) || user.id <= 0 || user.id > 4503599627370495 || user.is_bot === true || typeof user.first_name !== 'string' || user.first_name.length > 256) throw new MiniAppAuthError();
  return {
    actor: { id: user.id, first_name: user.first_name, ...(typeof user.language_code === 'string' && user.language_code.length <= 35 ? { language_code: user.language_code } : {}) },
    authenticatedAt,
  };
}
