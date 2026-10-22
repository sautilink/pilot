import { SEO_ORIGIN, PUBLIC_SEO_PAGES, canonicalUrl } from './seo.js';

// A public proof-of-hosting file for IndexNow; it grants no application access.
export const INDEXNOW_KEY = '68c7258dd4234a139b2d99a7305dcfff';
export const INDEXNOW_KEY_PATH = `/${INDEXNOW_KEY}.txt`;
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

const escapeXml = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);

export function publicSeoUrls() {
  return PUBLIC_SEO_PAGES.flatMap(path => ['en', 'sw'].map(lang => canonicalUrl(path, lang)));
}

export function robotsText() {
  // Public assets and noindex HTML shells remain crawlable. Authentication,
  // rather than crawler instructions, continues to protect all private data.
  return `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /telegram/\nDisallow: /health\n\nSitemap: ${SEO_ORIGIN}/sitemap.xml\n`;
}

export function sitemapXml() {
  const entries = PUBLIC_SEO_PAGES.flatMap(path => ['en', 'sw'].map(lang => {
    const alternatives = ['en', 'sw', 'x-default'].map(language => `    <xhtml:link rel="alternate" hreflang="${language}" href="${escapeXml(canonicalUrl(path, language === 'sw' ? 'sw' : 'en'))}"/>`).join('\n');
    return `  <url>\n    <loc>${escapeXml(canonicalUrl(path, lang))}</loc>\n${alternatives}\n  </url>`;
  })).join('\n');
  // Omit lastmod instead of claiming every request or deployment changed content.
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries}\n</urlset>\n`;
}

export function indexNowPayload() {
  return {
    host: new URL(SEO_ORIGIN).hostname,
    key: INDEXNOW_KEY,
    keyLocation: `${SEO_ORIGIN}${INDEXNOW_KEY_PATH}`,
    urlList: publicSeoUrls(),
  };
}

export function seoDiscoveryResponse(request) {
  const path = new URL(request.url).pathname;
  let body, type;
  if (path === '/robots.txt') { body = robotsText(); type = 'text/plain'; }
  else if (path === '/sitemap.xml') { body = sitemapXml(); type = 'application/xml'; }
  else if (path === INDEXNOW_KEY_PATH) { body = INDEXNOW_KEY; type = 'text/plain'; }
  else return null;

  const headers = {
    'Content-Type': `${type}; charset=utf-8`,
    'Cache-Control': 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex',
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { ...headers, 'Allow': 'GET, HEAD', 'Cache-Control': 'no-store' } });
  }
  return new Response(request.method === 'HEAD' ? null : body, { headers });
}
