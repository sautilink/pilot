import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFetch } from '../src/handler.js';
import { INDEXNOW_ENDPOINT, INDEXNOW_KEY, INDEXNOW_KEY_PATH, indexNowPayload, publicSeoUrls } from '../src/seo-discovery.js';
import { notifyIndexNow } from '../scripts/notify-indexnow.mjs';

const BASE = 'https://pilot.sautilink.com';
const request = (path, options) => new Request(`${BASE}${path}`, options);

test('discovery routes work without bot/database configuration and give correct GET/HEAD responses', async () => {
  const unavailable = new Proxy({}, { get() { throw new Error('Discovery must not read private configuration'); } });
  for (const [path, type] of [['/robots.txt', 'text/plain'], ['/sitemap.xml', 'application/xml'], [INDEXNOW_KEY_PATH, 'text/plain']]) {
    const get = await handleFetch(request(path), unavailable);
    assert.equal(get.status, 200);
    assert.equal(get.headers.get('Content-Type'), `${type}; charset=utf-8`);
    assert.equal(get.headers.get('Cache-Control'), 'public, max-age=3600');
    assert.ok((await get.text()).length > 0);
    const head = await handleFetch(request(path, { method: 'HEAD' }), unavailable);
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    assert.equal(head.headers.get('Content-Type'), get.headers.get('Content-Type'));
    const post = await handleFetch(request(path, { method: 'POST' }), unavailable);
    assert.equal(post.status, 405);
    assert.equal(post.headers.get('Allow'), 'GET, HEAD');
  }
  assert.equal(await (await handleFetch(request(INDEXNOW_KEY_PATH), unavailable)).text(), INDEXNOW_KEY);
});

test('robots advertises the sitemap and keeps public assets plus noindex shells crawlable', async () => {
  const robots = await (await handleFetch(request('/robots.txt'), {})).text();
  assert.match(robots, /^User-agent: \*\nAllow: \/\n/);
  assert.match(robots, /^Sitemap: https:\/\/pilot\.sautilink\.com\/sitemap\.xml$/m);
  for (const path of ['/api/', '/telegram/', '/health']) assert.ok(robots.includes(`Disallow: ${path}\n`));
  assert.doesNotMatch(robots, /^Disallow:.*(?:app|setup|assets|privacy|lang|\*)/m);
});

test('sitemap contains only canonical public language versions with reciprocal alternates', async () => {
  const xml = await (await handleFetch(request('/sitemap.xml?theme=dark&tgWebAppData=private'), {})).text();
  const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
  assert.deepEqual(locations, ['/', '/privacy', '/updates', '/roadmap', '/developers', '/communities'].flatMap(path=>[`${BASE}${path}`,`${BASE}${path}?lang=sw`]));
  assert.deepEqual(locations, publicSeoUrls());
  const entries = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(match => match[1]);
  for (const entry of entries) {
    assert.equal([...entry.matchAll(/<xhtml:link /g)].length, 3);
    assert.match(entry, /hreflang="en"/);
    assert.match(entry, /hreflang="sw"/);
    assert.match(entry, /hreflang="x-default"/);
  }
  assert.doesNotMatch(xml, /\/app|\/tools|\/community\/|\/setup|\/api|\/telegram|\/health|lang=en|theme=|tgWebAppData|<lastmod>|<priority>|<changefreq>/);
});

test('public HTML stays indexable while private shells, APIs, and missing routes stay noindex', async () => {
  for (const path of ['/', '/?lang=sw', '/privacy', '/privacy?lang=sw', '/updates', '/roadmap?lang=sw', '/developers', '/app', '/setup', '/tools']) {
    const get = await handleFetch(request(path), {});
    const head = await handleFetch(request(path, { method: 'HEAD' }), {});
    assert.equal(get.status, 200);
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const indexable = !['/app', '/setup', '/tools'].includes(path);
    assert.equal(get.headers.get('X-Robots-Tag'), indexable ? 'index, follow' : 'noindex, nofollow');
    assert.equal(head.headers.get('X-Robots-Tag'), get.headers.get('X-Robots-Tag'));
    if (!indexable) assert.match(await get.text(), /<meta name="robots" content="noindex/);
  }
  for (const [path, options, status] of [
    ['/api/setup/status', undefined, 401],
    ['/api/setup', { method: 'POST' }, 401],
    ['/api/pilot', undefined, 405],
    ['/api/pilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }, 401],
    ['/telegram/webhook', { method: 'GET' }, 405],
    ['/health', undefined, 503],
    ['/does-not-exist', undefined, 404],
  ]) {
    const response = await handleFetch(request(path, options), { DB: {}, BOT_TOKEN: '900:test_fixture_only_not_a_real_token' });
    assert.equal(response.status, status, path);
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow', path);
    assert.equal(response.headers.get('Cache-Control'), 'no-store', path);
  }
});

function mockSubmission({ key = INDEXNOW_KEY, noindex = false, status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === `${BASE}${INDEXNOW_KEY_PATH}`) return new Response(key);
    if (url === INDEXNOW_ENDPOINT) return new Response(null, { status });
    assert.ok(publicSeoUrls().includes(url), 'only canonical public URLs are inspected');
    return new Response(`<head><link rel="canonical" href="${url}"></head>`, { headers: { 'X-Robots-Tag': noindex ? 'noindex' : 'index, follow' } });
  };
  return { fetchImpl, calls };
}

test('IndexNow submits one public URL batch only after deployed proof and canonicals pass', async () => {
  const f = mockSubmission({ status: 202 });
  const result = await notifyIndexNow({ fetchImpl: f.fetchImpl });
  assert.equal(result.status, 202);
  assert.equal(result.keyValidationPending, true);
  assert.deepEqual(result.submitted, publicSeoUrls());
  const posts = f.calls.filter(call => call.options.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, INDEXNOW_ENDPOINT);
  assert.deepEqual(JSON.parse(posts[0].options.body), indexNowPayload());
  assert.equal(f.calls.length, publicSeoUrls().length + 2);
});

test('IndexNow refuses an undeployed proof file or noindex page and never retries failed submission', async () => {
  for (const options of [{ key: 'old-deployment' }, { noindex: true }]) {
    const f = mockSubmission(options);
    await assert.rejects(notifyIndexNow({ fetchImpl: f.fetchImpl }));
    assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 0);
  }
  const f = mockSubmission({ status: 429 });
  await assert.rejects(notifyIndexNow({ fetchImpl: f.fetchImpl }), /HTTP 429/);
  assert.equal(f.calls.filter(call => call.options.method === 'POST').length, 1);
});
