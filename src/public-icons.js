import { PUBLIC_ICON_ASSETS, PUBLIC_ICON_VERSION } from './vendor/public-icons/assets.generated.js';
import { STATIC_ICONS } from './vendor/public-icons/static.generated.js';

export { PUBLIC_ICON_VERSION };
export const ICON_ALIASES = Object.freeze({
  plane: 'send', shield: 'shield-check', link: 'attachment-0-1', forward: 'share-0-1',
  check: 'check', users: 'user-group', radio: 'megaphone-0-1', clock: 'clock-0-1',
  infinity: 'repeat', lock: 'lock-keyhole', key: 'lock-keyhole', reset: 'refresh-0-1',
  router: 'lucide:router', cloud: 'lucide:cloud', help: 'help-circle', compass: 'compass-0-1',
  mail: 'mail-0-1', file: 'file-0-1', book: 'book-open-0-1', settings: 'settings-0-1',
  copy: 'copy', globe: 'globe-0-2', code: 'code', 'arrow-right': 'arrow-right-0-2',
  'arrow-up-right': 'arrow-up-right-0-1', plus: 'add-0-1',
  overview: 'analytics-0-1', incidents: 'security-block', appeals: 'sautilink:justice-scale',
  activity: 'activity', mystatus: 'id-verified', checklink: 'search', joins: 'user-add-0-1',
  refresh: 'refresh-0-1', whitelist: 'attachment-0-1', moon: 'moon-0-1', sun: 'sun-0-1',
});
export const ICON_CSS = PUBLIC_ICON_ASSETS['icons.css'].text;
const escapeAttribute = value => String(value).replace(/[&<>\"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[character]));

export function icon(name, className = '') {
  const resolved = Object.hasOwn(ICON_ALIASES, name) ? ICON_ALIASES[name]
    : Object.hasOwn(STATIC_ICONS, name) ? name : 'help-circle';
  const classes = ['public-icon', String(className).trim()].filter(Boolean).join(' ');
  return STATIC_ICONS[resolved].replace('<svg ', `<svg class="${escapeAttribute(classes)}" data-public-icon="${resolved}" aria-hidden="true" focusable="false" `);
}

export function iconScripts() {
  return ['icons.js', 'adapter.js'].map(name => `<script defer src="/assets/public-icons/${name}?v=${PUBLIC_ICON_VERSION}"></script>`).join('');
}

// These resources are public presentation assets. They never initialize or
// query D1, Telegram, owner pairing, or a user's Mini App session.
export function iconAssetResponse(request) {
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  const url = new URL(request.url), prefix = '/assets/public-icons/';
  if (!url.pathname.startsWith(prefix)) return null;
  const name = url.pathname.slice(prefix.length);
  if (!Object.hasOwn(PUBLIC_ICON_ASSETS, name)) return null;
  const asset = PUBLIC_ICON_ASSETS[name], etag = `"${asset.sha256}"`;
  const headers = {
    'Content-Type': asset.type,
    'Cache-Control': url.searchParams.get('v') === PUBLIC_ICON_VERSION
      ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    'ETag': etag,
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  };
  const matches = (request.headers.get('If-None-Match') || '').split(',').map(value => value.trim().replace(/^W\//, ''));
  if (matches.includes(etag) || matches.includes('*')) return new Response(null, { status: 304, headers });
  headers['Content-Length'] = String(asset.bytes);
  return new Response(request.method === 'HEAD' ? null : asset.text, { headers });
}
