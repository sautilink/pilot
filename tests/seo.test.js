import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, renderSeoHead, SEO_ORIGIN, PUBLIC_SEO_PAGES } from '../src/seo.js';
import { renderHome, renderPrivacy, renderSetup } from '../src/pages.js';

const headOf = html => html.match(/<head>([\s\S]*?)<\/head>/)[1];
const schemaOf = head => JSON.parse(head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
const decode = text => text.replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>');
const meta = (head, property) => {
  const tag = [...head.matchAll(/<meta\s+(?:name|property)="([^"]+)"\s+content="([^"]*)"\s*>/g)].find(match => match[1] === property);
  return tag ? decode(tag[2]) : null;
};

test('public pages publish one self canonical and reciprocal language alternatives', () => {
  for (const lang of ['en', 'sw']) {
    for (const [path, html] of [
      ['/', renderHome({ username: 'sautilinkpilotbot', ready: true, lang })],
      ['/privacy', renderPrivacy(lang)],
    ]) {
      const head = headOf(html);
      const url = `${SEO_ORIGIN}${path}${lang === 'sw' ? '?lang=sw' : ''}`;
      assert.equal([...head.matchAll(/rel="canonical"/g)].length, 1);
      assert.ok(head.includes(`<link rel="canonical" href="${url}">`));
      assert.ok(head.includes(`<link rel="alternate" hreflang="en" href="${SEO_ORIGIN}${path}">`));
      assert.ok(head.includes(`<link rel="alternate" hreflang="sw" href="${SEO_ORIGIN}${path}?lang=sw">`));
      assert.ok(head.includes(`<link rel="alternate" hreflang="x-default" href="${SEO_ORIGIN}${path}">`));
      assert.equal([...head.matchAll(/<title>/g)].length, 1);
      assert.equal([...head.matchAll(/name="description"/g)].length, 1);
      assert.match(meta(head, 'robots'), /^index,follow,/);
      assert.doesNotMatch(head, /name="keywords"|tgWebAppData|SETUP_KEY|BOT_TOKEN/);
      assert.match(html, new RegExp(`<html lang="${lang}">`));
      assert.equal([...html.matchAll(/<h1(?:\s|>)/g)].length, 1);
    }
  }
});

test('canonical URLs strip display and launch parameters and reject nonpublic routes and foreign origins', () => {
  assert.equal(canonicalUrl('/?lang=en&theme=dark&utm_source=test#jaribu'), `${SEO_ORIGIN}/`);
  assert.equal(canonicalUrl('/privacy?theme=dark&tgWebAppData=private-launch#private', 'sw'), `${SEO_ORIGIN}/privacy?lang=sw`);
  assert.equal(canonicalUrl('/', 'unknown'), `${SEO_ORIGIN}/`);
  assert.equal(canonicalUrl('/communities?q=private-query&category=technology&page=2'), `${SEO_ORIGIN}/communities`);
  assert.equal(canonicalUrl('/communities?language=en', 'sw'), `${SEO_ORIGIN}/communities?lang=sw`);
  for (const path of ['/app', '/tools', '/setup', '/community/private', '/api/me', '/privacy/', 'https://example.com/', '//example.com/privacy']) {
    assert.throws(() => canonicalUrl(path), /public Pilot page/);
  }
  assert.deepEqual(PUBLIC_SEO_PAGES, ['/', '/privacy', '/updates', '/roadmap', '/developers', '/communities']);
});

test('social metadata describes the exact language page with a real summary image', () => {
  for (const lang of ['en', 'sw']) {
    const html = renderHome({ username: 'sautilinkpilotbot', ready: true, lang });
    const head = headOf(html);
    const title = decode(head.match(/<title>(.*?)<\/title>/)[1]);
    assert.match(title, /SautiLink Pilot/);
    assert.match(title, /Telegram/);
    assert.match(title, lang === 'en' ? /Moderation Bot/ : /kusimamia groups/);
    assert.equal(meta(head, 'og:title'), title);
    assert.equal(meta(head, 'twitter:title'), title);
    assert.equal(meta(head, 'og:description'), meta(head, 'description'));
    assert.equal(meta(head, 'twitter:description'), meta(head, 'description'));
    assert.equal(meta(head, 'og:url'), canonicalUrl('/', lang));
    assert.equal(meta(head, 'og:site_name'), 'SautiLink Pilot');
    assert.equal(meta(head, 'twitter:card'), 'summary');
    assert.equal(meta(head, 'og:image'), 'https://sautilink.com/logo.png');
    assert.equal(meta(head, 'twitter:image'), meta(head, 'og:image'));
    assert.ok(meta(head, 'og:image:alt'));
    assert.ok(meta(head, 'twitter:image:alt'));
    assert.ok(meta(head, 'description').length <= 160);
    assert.ok(html.includes(lang === 'en' ? 'Your group.' : 'Group lako.'));
    assert.ok(html.includes(lang === 'en' ? 'Your Pilot.' : 'Pilot wako.'));
  }
  assert.notEqual(meta(headOf(renderHome()), 'description'), meta(headOf(renderPrivacy()), 'description'));
});

test('public structured data identifies the real service without invented ratings or commercial claims', () => {
  for (const lang of ['en', 'sw']) {
    const graph = schemaOf(headOf(renderHome({ ready: true, username: 'sautilinkpilotbot', lang })))['@graph'];
    const organization = graph.find(node => node['@type'] === 'Organization');
    const website = graph.find(node => node['@type'] === 'WebSite');
    const webpage = graph.find(node => node['@type'] === 'WebPage');
    const application = graph.find(node => node['@type'] === 'SoftwareApplication');
    assert.equal(organization.name, 'SautiLink Corporation');
    assert.equal(organization.url, 'https://www.sautilink.com/');
    assert.equal(website.name, 'SautiLink Pilot');
    assert.equal(website.url, `${SEO_ORIGIN}/`);
    assert.deepEqual(website.inLanguage, ['en', 'sw']);
    assert.equal(webpage.url, canonicalUrl('/', lang));
    assert.equal(webpage.inLanguage, lang);
    assert.equal(webpage.mainEntity['@id'], application['@id']);
    assert.equal(application.publisher['@id'], organization['@id']);
    assert.equal(application.sameAs, 'https://t.me/sautilinkpilotbot');
    assert.equal(application.softwareRequirements, 'Telegram');
    assert.equal(application.applicationCategory, 'CommunicationApplication');
    assert.ok(application.featureList.length >= 3);
    assert.doesNotMatch(JSON.stringify(graph), /aggregateRating|reviewCount|"offers"|"price"|"downloadCount"|dateModified/);
    const privacy = schemaOf(headOf(renderPrivacy(lang)))['@graph'];
    assert.equal(privacy.find(node => node['@type'] === 'WebPage').url, canonicalUrl('/privacy', lang));
    assert.equal(privacy.some(node => node['@type'] === 'SoftwareApplication'), false);
  }
});

test('operator setup stays noindex and does not publish canonical, social or schema discovery data', () => {
  for (const lang of ['en', 'sw']) {
    const head = headOf(renderSetup(lang));
    assert.equal(meta(head, 'robots'), 'noindex,nofollow');
    assert.doesNotMatch(head, /rel="canonical"|rel="alternate"|application\/ld\+json|property="og:|name="twitter:/);
  }
});

test('titles and structured data cannot close their metadata or JSON-LD elements', () => {
  const hostile = '</script><script>alert("metadata")</script>&';
  const head = renderSeoHead({ title: hostile, description: hostile, path: '/', lang: 'en' });
  assert.doesNotMatch(head, /<script>alert/);
  assert.equal([...head.matchAll(/<script\b/g)].length, 1);
  assert.equal([...head.matchAll(/<\/script>/g)].length, 1);
  const graph = schemaOf(head)['@graph'];
  assert.equal(graph.find(node => node['@type'] === 'WebPage').name, hostile);
  assert.equal(meta(head, 'description'), hostile);
});
