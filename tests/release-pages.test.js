import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReleasePage } from '../src/release-pages.js';

test('public release pages have canonical EN/SW metadata and inert valid structured data', () => {
  for (const page of ['updates', 'roadmap', 'developers']) for (const lang of ['en', 'sw']) {
    const html = renderReleasePage(`/${page}`, { lang });
    assert.ok(html.includes(`<html lang="${lang}">`));
    assert.ok(html.includes(`<link rel="canonical" href="https://pilot.sautilink.com/${page}${lang === 'sw' ? '?lang=sw' : ''}">`));
    assert.ok(html.includes(`hreflang="en" href="https://pilot.sautilink.com/${page}"`));
    assert.ok(html.includes(`hreflang="sw" href="https://pilot.sautilink.com/${page}?lang=sw"`));
    assert.ok(html.includes(`hreflang="x-default" href="https://pilot.sautilink.com/${page}"`));
    assert.ok(html.includes('name="robots" content="index,follow'));
    assert.ok(html.includes('name="twitter:card" content="summary"'));
    const json = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html)?.[1];
    const graph = JSON.parse(json); assert.equal(graph['@type'], 'WebPage'); assert.equal(graph.inLanguage, lang);
    assert.equal(graph.publisher.name, 'SautiLink Corporation');
    assert.equal((html.match(/<h1>/g) || []).length, 1);
  }
});

test('release pages share real animated icons, working serialized theme initialization and restrained identity', () => {
  for (const page of ['updates', 'roadmap', 'developers']) {
    const html = renderReleasePage(page);
    assert.ok(html.includes('data-public-icons')); assert.ok(html.includes('data-public-icon='));
    assert.ok(html.includes('/assets/public-icons/adapter.js'));
    assert.ok(html.includes('data-theme-toggle')); assert.ok(html.includes('data-pilot-theme'));
    assert.ok(html.includes("document.readyState === 'loading'"));
    assert.ok(html.includes('from <a href="https://www.sautilink.com/">SautiLink Corporation</a>'));
    assert.ok(!html.includes('localStorage')); assert.ok(!html.includes('sessionStorage'));
    assert.ok(!html.includes('initData')); assert.ok(!html.includes('BOT_TOKEN'));
    const script = /<script data-pilot-theme>([\s\S]*?)<\/script>/.exec(html)[1];
    assert.doesNotThrow(() => new Function(script));
  }
});

test('invalid routes cannot inject markup or arbitrary canonical hosts; invalid languages default to English', () => {
  for (const page of ['https://evil.example', '../setup', 'updates?theme=dark', '<script>alert(1)</script>', '__proto__', '']) {
    assert.throws(() => renderReleasePage(page), /Unknown public Pilot release page/);
  }
  const html = renderReleasePage('developers', { lang: '"><script>alert(1)</script>' });
  assert.ok(html.includes('<html lang="en">')); assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('href="/tools?section=feedback"'));
});

test('developer examples use the current scoped API and placeholders without automatic send authority', () => {
  const html = renderReleasePage('developers');
  for (const text of ['knowledge:read', 'events:read', 'drafts:write', 'YOUR_GROUP_TOKEN', 'YOUR_UNIQUE_REQUEST_ID', 'https://pilot.sautilink.com/api/integrations']) assert.ok(html.includes(text));
  assert.ok(html.includes('Authorization: Bearer YOUR_GROUP_TOKEN'));
  assert.ok(html.includes('&quot;operation&quot;: &quot;draft&quot;'));
  assert.ok(html.includes('A draft is never sent automatically.'));
  assert.ok(html.includes('1–90 days')); assert.ok(html.includes('60 requests per minute per token.'));
  assert.ok(html.includes('20 new drafts per token in a rolling 24 hours'));
  assert.ok(html.includes('up to 50 pending drafts per group'));
  assert.ok(html.includes('the creator must still be an admin'));
  assert.ok(html.includes('Expired or revoked credentials stop working'));
  assert.doesNotMatch(html, /GitHub|github\.com|Pilot stores a hash|D1|Durable Object/);
  assert.ok(!/slp_[a-f0-9]{32}\.[a-f0-9]{64}/.test(html));
  const examples = [...html.matchAll(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)];
  assert.equal(examples.length, 2); for (const [, value] of examples) assert.ok(!value.includes('<script'));
});

test('release notes describe delivered tools and safeguards; roadmap labels ideas without promised dates', () => {
  const updates = renderReleasePage('updates'), roadmap = renderReleasePage('roadmap');
  assert.ok(updates.includes('<time datetime="2026-10-22">22 October 2026</time>'));
  for (const term of ['/connect', '/doctor', '/policytest', '/support', '/communities', '/flag', '/ask', 'Events and RSVPs', 'waiting list', 'private reminders', 'Curated highlights', 'Presets', 'expiry', 'Raid signals', 'Scoped developer access']) assert.ok(updates.includes(term));
  assert.ok(updates.includes('Reports never create automatic strikes or bans.'));
  assert.ok(updates.includes('Command spam removal remains delete-only.'));
  assert.ok(updates.includes('ephemeral reply visible only to the requesting member'));
  assert.ok(roadmap.includes('there are no promised release dates'));
  assert.ok(roadmap.includes('Exploring')); assert.ok(roadmap.includes('future AI option would be an explicit choice'));
  assert.ok(roadmap.includes('Available now'));
  assert.ok(roadmap.includes('Private support tickets and community discovery'));
  assert.doesNotMatch(roadmap, /Richer event planning|Explore more event options/);
  for (const page of ['updates', 'roadmap', 'developers']) for (const lang of ['en', 'sw']) {
    assert.ok(renderReleasePage(page, { lang }).includes(`href="/communities${lang === 'sw' ? '?lang=sw' : ''}"`));
  }
  assert.ok(renderReleasePage('updates', { lang: 'sw' }).includes('22 Oktoba 2026'));
});
