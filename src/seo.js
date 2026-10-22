export const SEO_ORIGIN = 'https://pilot.sautilink.com';
export const PUBLIC_SEO_PAGES = Object.freeze(['/', '/privacy', '/updates', '/roadmap', '/developers', '/communities']);

const LOGO_URL = 'https://sautilink.com/logo.png';
const ORGANIZATION_ID = 'https://www.sautilink.com/#organization';
const WEBSITE_ID = `${SEO_ORIGIN}/#website`;
const APPLICATION_ID = `${SEO_ORIGIN}/#application`;
const normalizeLang = lang => lang === 'sw' ? 'sw' : 'en';
const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

// Canonicals are built from an explicit public route and language, never a
// request URL's theme, tracking parameters, or Telegram launch credentials.
export function canonicalUrl(path = '/', lang = 'en') {
  const url = new URL(path, SEO_ORIGIN);
  if (url.origin !== SEO_ORIGIN || !PUBLIC_SEO_PAGES.includes(url.pathname)) {
    throw new TypeError('A canonical URL requires a public Pilot page');
  }
  return `${SEO_ORIGIN}${url.pathname}${normalizeLang(lang) === 'sw' ? '?lang=sw' : ''}`;
}

function structuredData({ title, description, path, lang, url }) {
  const graph = [
    {
      '@type': 'Organization',
      '@id': ORGANIZATION_ID,
      name: 'SautiLink Corporation',
      url: 'https://www.sautilink.com/',
      logo: LOGO_URL,
    },
    {
      '@type': 'WebSite',
      '@id': WEBSITE_ID,
      url: `${SEO_ORIGIN}/`,
      name: 'SautiLink Pilot',
      inLanguage: ['en', 'sw'],
      publisher: { '@id': ORGANIZATION_ID },
    },
    {
      '@type': 'WebPage',
      '@id': `${url}#webpage`,
      url,
      name: title,
      description,
      inLanguage: lang,
      isPartOf: { '@id': WEBSITE_ID },
      publisher: { '@id': ORGANIZATION_ID },
      about: { '@id': APPLICATION_ID },
      ...(path === '/' ? { mainEntity: { '@id': APPLICATION_ID } } : {}),
    },
  ];
  if (path === '/') {
    graph.push({
      '@type': 'SoftwareApplication',
      '@id': APPLICATION_ID,
      name: 'SautiLink Pilot',
      url: `${SEO_ORIGIN}/`,
      description,
      applicationCategory: 'CommunicationApplication',
      applicationSubCategory: 'Telegram group moderation bot',
      softwareRequirements: 'Telegram',
      inLanguage: ['en', 'sw'],
      publisher: { '@id': ORGANIZATION_ID },
      image: LOGO_URL,
      sameAs: 'https://t.me/sautilinkpilotbot',
      softwareHelp: `${SEO_ORIGIN}/${lang === 'sw' ? '?lang=sw' : ''}#anza`,
      featureList: lang === 'sw' ? [
        'Kuondoa links zisizoruhusiwa na forwarded messages',
        'Kuheshimu admins na posts za linked channel',
        'Ban ya saa 24, siku 7 na permanent kwa makosa yanayojirudia',
        'Kufuta spam ya commands bila ban, mute wala kosa',
        'Paneli ya admin na rufaa za wanachama',
        'Events, vikumbusho vya hiari na msaada wa faragha wa group',
        'Orodha ya jumuiya zilizochagua kuorodheshwa',
      ] : [
        'Unapproved link and forwarded-message moderation',
        'Admin and linked-channel exemptions',
        '24-hour, 7-day and permanent bans for repeat offenses',
        'Command spam deletion without a ban, mute or strike',
        'Admin dashboard and member appeals',
        'Group events, optional reminders and private group support',
        'Community directory with explicit listing choices',
      ],
    });
  }
  // JSON-LD remains inert even if a future title contains HTML or script text.
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function renderSeoHead({ title, description, path = '/', lang = 'en', robots = 'index,follow' }) {
  lang = normalizeLang(lang);
  const indexable = PUBLIC_SEO_PAGES.includes(path) && !robots.split(',').map(value => value.trim()).includes('noindex');
  const directives = indexable ? 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1' : 'noindex,nofollow';
  const basic = `<title>${escape(title)}</title><meta name="description" content="${escape(description)}"><meta name="robots" content="${directives}">`;
  if (!indexable) return basic;

  const url = canonicalUrl(path, lang);
  const alternate = language => canonicalUrl(path, language);
  const imageAlt = lang === 'sw' ? 'Nembo ya SautiLink Corporation' : 'SautiLink Corporation logo';
  const locale = lang === 'sw' ? 'sw_TZ' : 'en_US';
  const alternateLocale = lang === 'sw' ? 'en_US' : 'sw_TZ';
  return `${basic}
<link rel="canonical" href="${escape(url)}">
<link rel="alternate" hreflang="en" href="${escape(alternate('en'))}">
<link rel="alternate" hreflang="sw" href="${escape(alternate('sw'))}">
<link rel="alternate" hreflang="x-default" href="${escape(alternate('en'))}">
<meta property="og:site_name" content="SautiLink Pilot">
<meta property="og:type" content="website">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:url" content="${escape(url)}">
<meta property="og:locale" content="${locale}">
<meta property="og:locale:alternate" content="${alternateLocale}">
<meta property="og:image" content="${LOGO_URL}">
<meta property="og:image:secure_url" content="${LOGO_URL}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:alt" content="${imageAlt}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escape(title)}">
<meta name="twitter:description" content="${escape(description)}">
<meta name="twitter:image" content="${LOGO_URL}">
<meta name="twitter:image:alt" content="${imageAlt}">
<script type="application/ld+json">${structuredData({ title, description, path, lang, url })}</script>`;
}
