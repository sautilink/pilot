import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { webcrypto } from 'node:crypto';
import { renderToolsPage, toolsEATTimestamp, toolsRequestId } from '../src/tools-page.js';

test('tools render a bilingual private welcome with shared icons and no secret or client-side identity shortcuts', () => {
  for (const lang of ['en', 'sw']) {
    const html = renderToolsPage({ lang });
    assert.match(html, new RegExp(`<html lang="${lang}">`));
    assert.match(html, /id="tools-app" hidden/);
    assert.match(html, /name="robots" content="noindex,nofollow"/);
    assert.match(html, /data-pilot-theme/);
    assert.match(html, /https:\/\/t\.me\/sautilinkpilotbot\?start=tools/);
    assert.match(html, /<body data-public-icons>/);
    assert.match(html, /data-public-icon="clock-0-1"/);
    assert.match(html, /script defer src="\/assets\/public-icons\/icons\.js/);
    assert.match(html, /class="welcome-foot">[\s\S]*?<a href="https:\/\/www\.sautilink\.com\/" rel="noopener noreferrer">from SautiLink Corporation<\/a>/);
    assert.doesNotMatch(html, /initDataUnsafe|localStorage|sessionStorage|BOT_TOKEN|SETUP_KEY|\.innerHTML\s*=/);
    const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.equal(script.length, 1); assert.doesNotThrow(() => new vm.Script(script[0][1]));
  }
  const malicious = renderToolsPage({ lang: '</script><script>alert(1)</script>' });
  assert.match(malicious, /<html lang="en">/); assert.doesNotMatch(malicious, /alert\(1\)/);
});

test('EAT schedule input has explicit UTC+3 semantics and rejects rollover dates', () => {
  assert.equal(toolsEATTimestamp('2026-10-22T18:30'), Date.parse('2026-10-22T15:30:00Z') / 1000);
  assert.equal(toolsEATTimestamp('2028-02-29T00:00'), Date.parse('2028-02-28T21:00:00Z') / 1000);
  for (const value of ['2026-02-29T12:00', '2026-10-22T25:01', '2026-10-22T09:00Z', '', '<script>', null]) assert.throws(() => toolsEATTimestamp(value), /INVALID_TIME/);
});

test('request IDs always use secure browser randomness', () => {
  assert.equal(toolsRequestId({ randomUUID: () => 'test-uuid' }), 'test-uuid');
  const generated = toolsRequestId({ getRandomValues(bytes) { bytes.fill(7); return bytes; } });
  assert.equal(generated, '07'.repeat(16));
  assert.throws(() => toolsRequestId({}), /Secure randomness unavailable/);
});

async function harness({ lang = 'en', view = 'overview', group = '-1001', groups = [{ id: '-1001', title: 'Example community' }], owner = false, signed = true, data = {}, errorAction = null, member = false, theme = null } = {}) {
  const ids = new Map(), requests = [], replaced = [];
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.attributes = {}; this.dataset = {}; this.style = {}; this.value = ''; this.checked = false; this.disabled = false; this.hidden = false; this._text = ''; }
    set id(value) { this._id = value; ids.set(value, this); } get id() { return this._id; }
    set textContent(value) { this._text = String(value); this.children = []; } get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    get firstElementChild() { return this.children.find(child => !child.tag.startsWith('#')); }
    append(...nodes) { for (const node of nodes) this.children.push(node); }
    replaceChildren(...nodes) { this._text = ''; this.children = nodes; }
    addEventListener(event, callback) { this.listeners[event] = callback; }
    setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'class') this.className = String(value); if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value); }
    cloneNode(deep) { const node = new Node(this.tag); node._text = this._text; for (const [name, value] of Object.entries(this.attributes)) node.setAttribute(name, value); if (deep) node.append(...this.children.map(child => child.cloneNode(true))); return node; }
    reportValidity() { return true; }
    showModal() { this.open = true; }
    close() { this.open = false; this.listeners.close?.(); }
  }
  const document = {
    getElementById(id) { if (!ids.has(id)) { if (id.startsWith('tools-icon-')) return null; const node = new Node('div'); node.id = id; if (id === 'tools-app') node.hidden = true; } return ids.get(id); },
    createElement(tag) { return new Node(tag); },
    createTextNode(text) { const node = new Node('#text'); node.textContent = text; return node; },
    querySelectorAll(selector) { return selector === '[data-lang]' ? languages : []; },
  };
  const languages = ['en', 'sw'].map(lang => { const node = new Node('button'); node.dataset.lang = lang; return node; });
  const html = renderToolsPage({ lang });
  for (const [, id, markup] of html.matchAll(/<template id="([^"]+)">([\s\S]*?)<\/template>/g)) {
    const template = new Node('template'); template.id = id; template.content = new Node('#document-fragment');
    const stack = [template.content];
    for (const [token, closing, tag, attributes] of markup.matchAll(/<(\/)?([\w:-]+)([^>]*)>/g)) {
      if (closing) { assert.equal(stack.pop().tag, tag); continue; }
      const node = new Node(tag); for (const [, name, value] of attributes.matchAll(/([\w:-]+)="([^"]*)"/g)) node.setAttribute(name, value);
      stack.at(-1).append(node); if (!token.endsWith('/>')) stack.push(node);
    }
  }
  const url = new URL(`https://pilot.sautilink.com/tools?${member ? 'section' : 'view'}=${view}&${member ? 'chat' : 'group'}=${group}&lang=${lang}#tgWebAppData=launch-placeholder`);
  if (theme !== null) url.searchParams.set('theme', theme);
  url.searchParams.set('tgWebAppStartParam', 'private-launch-hint');
  vm.runInNewContext([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1], {
    document, window: { Telegram: { WebApp: { initData: signed ? 'test-signed-data' : '', ready() {}, expand() {} } } },
    location: { href: url.href, origin: url.origin, replace(value) { replaced.push(value); } }, URL, URLSearchParams, crypto: webcrypto, setTimeout: () => 1, clearTimeout() {},
    navigator: { clipboard: { async writeText() {} } },
    fetch: async (endpoint, options) => {
      const body = JSON.parse(options.body); requests.push({ endpoint, options, body });
      if (body.action === errorAction) return { ok: false, json: async () => ({ ok: false, error: 'operation_unknown' }) };
      let result;
      if (body.action) result = body.action === 'integration_create' ? { token: 'test-one-time-token' } : { ok: true };
      else if (body.view === 'groups') result = { groups, nextCursor: null, owner };
      else result = data[body.view] || {};
      return { ok: true, json: async () => ({ ok: true, data: result }) };
    },
  });
  await nextTurn(); await nextTurn();
  const walk = node => [node, ...node.children.flatMap(walk)];
  return {
    html, requests, replaced, languages, get: id => document.getElementById(id), flush: async () => { await nextTurn(); await nextTurn(); },
    content: () => document.getElementById('tools-content'),
    nodes: (id = 'tools-content') => walk(document.getElementById(id)),
    field: name => walk(document.getElementById('tools-content')).find(node => node.name === name),
    form: () => walk(document.getElementById('tools-content')).find(node => node.tag === 'form'),
    async submit(fieldName) { const form = walk(document.getElementById('tools-content')).find(node => node.tag === 'form' && (!fieldName || walk(node).some(child => child.name === fieldName))); assert.ok(form, `form for ${fieldName || 'first form'} exists`); await form.listeners.submit({ preventDefault() {} }); await nextTurn(); },
    async confirm() { const nodes = walk(document.getElementById('tools-modal')); const acknowledgement = nodes.find(node => node.type === 'checkbox'); if (acknowledgement) { acknowledgement.checked = true; acknowledgement.listeners.change?.(); } const button = nodes.find(node => node.tag === 'button' && ['Confirm', 'Thibitisha'].includes(node.textContent)); await button.listeners.click(); await nextTurn(); },
  };
}

test('ordinary browser visitor makes no API calls and sees no admin workspace', async () => {
  const h = await harness({ signed: false });
  assert.equal(h.requests.length, 0); assert.equal(h.get('tools-app').hidden, true); assert.equal(h.get('tools-welcome').hidden, false);
});

test('a member deep link requests only member FAQ and hides all admin navigation', async () => {
  const h = await harness({ member: true, groups: [], group: '-1009', view: 'knowledge', data: { faq: { faq: [{ id: 'faq', question: '<img src=x onerror=alert(1)>', answer: 'Use /ask to search approved answers', language: 'en' }] } } });
  assert.deepEqual(h.requests.map(row => row.body.view), ['groups', 'faq']);
  assert.equal(h.requests[1].body.chatId, '-1009');
  const nav = h.get('tools-nav').textContent;
  assert.match(nav, /Events/); assert.match(nav, /Knowledge/); assert.doesNotMatch(nav, /Admin inbox|Integrations|Presets|Raid|Schedule/);
  assert.match(h.content().textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(h.nodes().some(node => node.tag === 'img'), false);
  assert.equal(h.requests[1].options.headers.Authorization, 'tma test-signed-data');
});

test('schedule submission requires preview plus acknowledgement and sends exact EAT time once', async () => {
  const h = await harness({ view: 'schedule', data: { operations: { schedules: [] } } });
  h.field('text').value = 'Community workshop\nBring your questions.';
  h.field('runAt').value = '2026-11-02T19:00'; h.field('repeat').value = 'weekly';
  await h.submit();
  assert.equal(h.requests.some(row => row.body.action), false);
  assert.equal(h.get('tools-modal').open, true);
  const confirm = h.nodes('tools-modal').find(node => node.tag === 'button' && node.textContent === 'Confirm');
  assert.equal(confirm.disabled, true);
  await confirm.listeners.click(); assert.equal(h.requests.some(row => row.body.action), false);
  await h.confirm();
  const sent = h.requests.filter(row => row.body.action);
  assert.equal(sent.length, 1); assert.equal(sent[0].body.action, 'schedule_create');
  assert.equal(sent[0].body.input.runAt, Date.parse('2026-11-02T16:00:00Z') / 1000);
  assert.equal(sent[0].body.input.confirmed, true); assert.equal(sent[0].body.chatId, '-1001');
  assert.equal(sent[0].body.input.text, 'Community workshop\nBring your questions.');
  assert.match(sent[0].body.requestId, /^[a-f0-9-]{36}$/);
  await confirm.listeners.click(); assert.equal(h.requests.filter(row => row.body.action).length, 1);
});

test('unknown mutation outcome exposes refresh and never repeats the request automatically', async () => {
  const h = await harness({ view: 'schedule', errorAction: 'schedule_create' });
  h.field('text').value = 'A single scheduled message'; h.field('runAt').value = '2026-11-02T10:00';
  await h.submit(); await h.confirm();
  assert.match(h.get('tools-modal').textContent, /unconfirmed/);
  assert.equal(h.nodes('tools-modal').some(node => node.tag === 'button' && node.textContent === 'Confirm'), false);
  assert.equal(h.requests.filter(row => row.body.action).length, 1);
});

test('hub publishing defaults private and FAQ exposure requires explicit choice in preview', async () => {
  const h = await harness({ view: 'community', data: { community: { hub: { visibility: 'private' } } } });
  assert.equal(h.field('visibility').value, 'private'); assert.equal(h.field('showFaq').checked, false);
  h.field('visibility').value = 'unlisted'; h.field('slug').value = 'study-room'; h.field('title').value = 'Study Room';
  h.field('showFaq').checked = true; await h.submit();
  assert.match(h.get('tools-modal').textContent, /visible to anyone with the link/);
  assert.match(h.get('tools-modal').textContent, /Included on the page/);
  assert.equal(h.requests.some(row => row.body.action), false);
  await h.confirm();
  const mutation = h.requests.find(row => row.body.action);
  assert.equal(mutation.body.input.showFaq, true); assert.equal(mutation.body.input.visibility, 'unlisted');
});

test('preset application reviews server differences and includes the preview hash', async () => {
  const h = await harness({ view: 'presets', data: { governance: { presets: [{ id: 'study', name: 'Study', description: 'Study configuration' }], history: [] }, config_preview: { expectedHash: 'test-preview-hash', changes: [{ key: 'settings.welcome_enabled', before: false, after: true }] } } });
  assert.equal(h.field('whitelist').disabled, true);
  await h.submit();
  const preview = h.requests.find(row => row.body.view === 'config_preview');
  assert.deepEqual(preview.body.input.sections, ['settings', 'language']);
  assert.match(h.get('tools-modal').textContent, /Current: Disabled/); assert.match(h.get('tools-modal').textContent, /New: Enabled/);
  assert.equal(h.requests.some(row => row.body.action), false);
  await h.confirm(); const mutation = h.requests.find(row => row.body.action);
  assert.equal(mutation.body.action, 'config_apply'); assert.equal(mutation.body.input.expectedHash, 'test-preview-hash'); assert.equal(mutation.body.input.confirmed, true);
});

test('one-time integration token is shown only after confirmation and removed on close', async () => {
  const h = await harness({ view: 'integrations' });
  h.field('label').value = 'Documentation helper'; h.field('knowledge:read').checked = true;
  await h.submit(); assert.doesNotMatch(h.get('tools-modal').textContent, /test-one-time-token/);
  await h.confirm();
  assert.match(h.get('tools-modal').textContent, /test-one-time-token/); assert.match(h.get('tools-modal').textContent, /shown once/);
  h.get('tools-modal').close(); assert.equal(h.get('tools-modal').textContent, '');
  assert.equal(h.requests.filter(row => row.body.action === 'integration_create').length, 1);
});

test('feedback inbox is requested only when the server identifies the owner', async () => {
  for (const owner of [false, true]) {
    const h = await harness({ view: 'feedback', groups: [], owner, data: { feedback: { feedback: [{ id: 'f1', kind: 'feature', message: 'Improve the docs', status: 'open', user_id: '42' }] } } });
    assert.equal(h.requests.some(row => row.body.view === 'feedback'), owner);
    assert.equal(h.content().textContent.includes('Pilot owner inbox'), owner);
  }
});

test('language navigation preserves launch context only on the same Mini App page', async () => {
  const h = await harness({ view: 'schedule' });
  h.languages.find(node => node.dataset.lang === 'sw').listeners.click();
  const switched = new URL(h.replaced[0]);
  assert.equal(switched.pathname, '/tools'); assert.equal(switched.searchParams.get('lang'), 'sw');
  assert.equal(switched.hash, '#tgWebAppData=launch-placeholder');
  const publicLinks = [...h.html.matchAll(/<a[^>]+href="([^\"]+)"/g)].map(match => match[1]);
  assert.ok(publicLinks.every(url => !url.includes('tgWebAppData')));
  h.get('tools-back').listeners.click();
  h.get('tools-back-mobile').listeners.click();
  assert.equal(h.replaced[1], h.replaced[2], 'desktop and mobile return controls share the same trusted navigation');
  const returned = new URL(h.replaced[2]);
  assert.equal(returned.origin, 'https://pilot.sautilink.com');
  assert.equal(returned.pathname, '/app');
  assert.equal(returned.hash, '#tgWebAppData=launch-placeholder');
  assert.equal(returned.searchParams.has('tgWebAppStartParam'), false);
});

test('async public links carry only language and an explicit valid theme', async () => {
  for (const lang of ['en', 'sw']) for (const theme of ['dark', 'light', 'invalid', null]) {
    for (const [view, paths] of [['feedback', ['/updates', '/roadmap']], ['integrations', ['/developers']]]) {
      const h = await harness({ lang, view, theme });
      const anchors = h.nodes().filter(node => node.tag === 'a' && paths.includes(new URL(node.href, 'https://pilot.sautilink.com').pathname));
      assert.equal(anchors.length, paths.length);
      for (const node of anchors) {
        assert.ok(node.href.startsWith('/'), 'relative links remain eligible for the shared theme toggle');
        const target = new URL(node.href, 'https://pilot.sautilink.com');
        assert.equal(target.searchParams.get('lang'), lang);
        assert.equal(target.searchParams.get('theme'), ['light', 'dark'].includes(theme) ? theme : null);
        assert.equal(target.hash, '');
        assert.deepEqual([...target.searchParams.keys()].sort(), ['light', 'dark'].includes(theme) ? ['lang', 'theme'] : ['lang']);
      }
      assert.equal(h.requests.some(row => row.body.action), false);
    }
  }
});

test('all admin tool sections initialize in both languages without exposing an unauthenticated route', async () => {
  const data = {
    operations: { schedules: [], events: [], highlights: [], deliveries: [] },
    community: { reports: [], faq: [], hub: { visibility: 'private', showFaq: false } },
    governance: { presets: [{ id: 'community', name: 'Community', description: 'Welcome messages' }], history: [], temporaryLinks: [], raid: { enabled: false, joinThreshold: 10, spamThreshold: 8, windowSeconds: 60, alerts: [] }, integrations: [] },
    integration_drafts: { drafts: [] },
  };
  for (const lang of ['en', 'sw']) for (const view of ['overview', 'inbox', 'schedule', 'events', 'highlights', 'knowledge', 'community', 'presets', 'links', 'raid', 'integrations', 'feedback']) {
    const h = await harness({ lang, view, data });
    assert.equal(h.get('tools-banner').hidden, true, `${lang}/${view} renders`);
    assert.doesNotMatch(h.content().textContent, /Information is unavailable|Taarifa hazipatikani/);
    assert.ok(h.requests.every(row => row.endpoint === '/api/tools' && row.options.headers.Authorization === 'tma test-signed-data'));
    assert.equal(h.requests.some(row => row.body.action), false, `${lang}/${view} never mutates on render`);
  }
});

test('active and uncertain lockdown states do not offer a second lockdown', async () => {
  for (const status of ['active', 'review', 'unknown', 'applying', 'restoring']) {
    const h = await harness({ view: 'raid', data: { governance: { raid: { lockdown: { status, until_at: 1793000000 }, alerts: [] } } } });
    assert.equal(h.field('minutes'), undefined);
    assert.equal(h.content().textContent.includes('Review restoring permissions now'), status === 'active');
    if (status !== 'active') assert.match(h.content().textContent, /admin review in Telegram/);
  }
});

test('setup checklist and sandbox require the server-verified admin workspace', async () => {
  const doctor = { ready: false, checkedAt: 1792670400, group: { title: 'Verified group' }, checks: [{ id: 'restrict', status: 'needs_attention' }, { id: 'delete', status: 'ready' }] };
  const admin = await harness({ view: 'doctor', data: { doctor } });
  assert.deepEqual(admin.requests.map(row => row.body.view), ['groups', 'doctor']);
  assert.equal(admin.requests[1].body.chatId, '-1001');
  assert.match(admin.content().textContent, /Verified group/);
  assert.match(admin.content().textContent, /enable Ban users/);
  assert.equal(admin.requests.some(row => row.body.action), false);
  for (const view of ['doctor', 'policy']) {
    const member = await harness({ member: true, groups: [], view, data: { doctor } });
    assert.equal(member.requests.some(row => ['doctor', 'policy_test'].includes(row.body.view)), false);
    assert.doesNotMatch(member.get('tools-nav').textContent, /Setup & checks|Test group rules/);
    assert.equal(member.field('priorStrikes'), undefined);
  }
});

test('policy form sends a selected-group preview with explicit hypothetical settings and no action', async () => {
  const h = await harness({ view: 'policy', data: { policy_test: { decision: 'delete_only', reasons: ['command_spam'], strike: null, durationSeconds: null } } });
  assert.deepEqual(h.requests.map(row => row.body.view), ['groups']);
  h.field('text').value = '/a_repeated_opaque_command_1234567890123456789012';
  h.field('priorStrikes').value = '2'; h.field('sender').value = 'member';
  h.field('commandMode').value = 'on'; h.field('messagesInWindow').value = '10';
  h.field('extraLinks').value = 'https://example.org/guide';
  await h.submit('text'); await h.flush();
  const preview = h.requests.find(row => row.body.view === 'policy_test');
  assert.equal(preview.body.chatId, '-1001');
  assert.equal(preview.body.input.priorStrikes, 2); assert.equal(preview.body.input.messagesInWindow, 10);
  assert.deepEqual(preview.body.input.proposedSettings, { command_spam_enabled: true });
  assert.deepEqual(preview.body.input.extraRules, [{ kind: 'url', value: 'https://example.org/guide' }]);
  assert.match(h.content().textContent, /Delete message only/);
  assert.match(h.content().textContent, /current permissions, member status, message age/);
  assert.equal(h.requests.some(row => row.body.action), false);
});

test('member support shows only private intake and own conversation controls', async () => {
  const ticket = { id: 'private-ticket', number: 'P-7', subject: 'Account question', status: 'open', updated_at: 1792670400 };
  const h = await harness({ member: true, groups: [], group: '-1009', view: 'support', data: {
    support: { admin: false, enabled: true, contactReady: true, tickets: [ticket] },
    support_ticket: { admin: false, enabled: true, contactReady: true, ticket, messages: [{ author_role: 'admin', created_at: 1792670400, body: '<script>private reply</script>', delivery_status: 'unknown' }] },
  } });
  assert.deepEqual(h.requests.map(row => row.body.view), ['groups', 'support']);
  assert.equal(h.requests[1].body.chatId, '-1009');
  assert.equal(h.field('enabled'), undefined);
  assert.doesNotMatch(h.get('tools-nav').textContent, /Admin inbox|Schedule|Setup & checks|Integrations|Speed & health/);
  assert.match(h.content().textContent, /Your tickets/);
  h.field('subject').value = 'Help with the meeting'; h.field('body').value = 'Please explain the attendance steps.';
  await h.submit('subject'); assert.equal(h.requests.some(row => row.body.action), false);
  await h.confirm();
  const created = h.requests.find(row => row.body.action === 'ticket_create');
  assert.equal(created.body.chatId, '-1009'); assert.equal(created.body.input.subject, 'Help with the meeting');
  await h.nodes().find(node => node.tag === 'button' && node.textContent === 'Open conversation').listeners.click(); await h.flush();
  const detail = h.requests.find(row => row.body.view === 'support_ticket');
  assert.deepEqual(detail.body.input, { id: 'private-ticket' }); assert.equal(detail.body.chatId, '-1009');
  assert.match(h.content().textContent, /Delivery unconfirmed/);
  assert.match(h.content().textContent, /<script>private reply<\/script>/);
  assert.equal(h.nodes().some(node => node.tag === 'script'), false);
  assert.equal(h.nodes().some(node => node.tag === 'button' && node.textContent === 'Claim ticket'), false);
  assert.equal(h.field('enabled'), undefined);
});

test('member support requires a private bot contact before presenting the intake form', async () => {
  const h = await harness({ member: true, groups: [], group: '-1009', view: 'support', data: { support: { admin: false, enabled: true, contactReady: false, tickets: [] } } });
  assert.equal(h.field('subject'), undefined); assert.equal(h.field('body'), undefined);
  const open = h.nodes().find(node => node.tag === 'a' && node.href.includes('start=support_'));
  assert.equal(open.href, 'https://t.me/sautilinkpilotbot?start=support_-1009');
  assert.equal(h.requests.some(row => row.body.action), false);
});

test('performance UI and settings are owner-only and never attach the current group', async () => {
  const data = { performance: { samples: 12, percentiles: { total_ms: { p50: { upperMs: 100, overflow: false }, p95: { upperMs: 500, overflow: false } } }, issues: { observations: 8, slow: 5, errors: 2, retries: 1 }, preferences: { alerts: false } } };
  const hidden = await harness({ view: 'performance', owner: false, data });
  assert.equal(hidden.requests.some(row => row.body.view === 'performance'), false);
  assert.doesNotMatch(hidden.get('tools-nav').textContent, /Speed & health/);
  const h = await harness({ view: 'performance', owner: true, data });
  const read = h.requests.find(row => row.body.view === 'performance');
  assert.deepEqual(read.body, { view: 'performance', input: { hours: 24 } });
  assert.match(h.content().textContent, /Slow operations: 5/);
  assert.match(h.content().textContent, /Recorded errors: 2/);
  h.field('alerts').checked = true; await h.submit('alerts');
  assert.match(h.get('tools-modal').textContent, /Owner settings/);
  assert.doesNotMatch(h.get('tools-modal').textContent, /Group: Example community/);
  assert.equal(h.requests.some(row => row.body.action), false);
  await h.confirm();
  const sent = h.requests.find(row => row.body.action === 'performance_settings');
  assert.equal(Object.hasOwn(sent.body, 'chatId'), false);
  assert.deepEqual(sent.body.input, { alerts: true, language: 'en' });
});

test('community discovery stays off by default and requires explicit public-listing acknowledgement', async () => {
  const privateHub = await harness({ view: 'community', data: { community: { hub: { visibility: 'private', slug: 'private-room', joinUrl: 'https://t.me/example' } } } });
  assert.equal(privateHub.field('enabled').disabled, true); assert.equal(privateHub.field('enabled').checked, false);
  const h = await harness({ view: 'community', data: { community: { hub: { visibility: 'public', slug: 'study-room', title: 'Study Room', joinUrl: 'https://t.me/example' }, discovery: { enabled: false, category: 'education' } } } });
  assert.equal(h.field('enabled').disabled, false); assert.equal(h.field('enabled').checked, false);
  assert.equal(h.requests.some(row => row.body.action), false);
  h.field('enabled').checked = true; h.field('category').value = 'education';
  await h.submit('enabled');
  assert.match(h.get('tools-modal').textContent, /Visible to everyone/);
  const confirm = h.nodes('tools-modal').find(node => node.tag === 'button' && node.textContent === 'Confirm');
  assert.equal(confirm.disabled, true); await confirm.listeners.click();
  assert.equal(h.requests.some(row => row.body.action), false);
  await h.confirm();
  const sent = h.requests.find(row => row.body.action === 'discovery_save');
  assert.equal(sent.body.chatId, '-1001'); assert.deepEqual(sent.body.input, { enabled: true, category: 'education' });
  assert.equal(h.requests.some(row => row.body.action === 'hub_save'), false);
});

test('event editor preserves configured timezone and capacity through review before submission', async () => {
  const h = await harness({ view: 'events', data: { operations: { events: [], timezone: 'America/New_York' } } });
  assert.equal(h.field('eventTimezone').value, 'America/New_York');
  assert.match(h.content().textContent, /Starts · America\/New_York/);
  h.field('title').value = 'Global workshop'; h.field('startsAt').value = '2027-02-10T19:00'; h.field('endsAt').value = '2027-02-10T21:00'; h.field('capacity').value = '12';
  await h.submit('title');
  assert.match(h.get('tools-modal').textContent, /America\/New_York/); assert.match(h.get('tools-modal').textContent, /Capacity12/);
  assert.equal(h.requests.some(row => row.body.action), false); await h.confirm();
  const sent = h.requests.find(row => row.body.action === 'event_create');
  assert.equal(sent.body.input.startsAt, Date.parse('2027-02-11T00:00:00Z') / 1000);
  assert.equal(sent.body.input.endsAt, Date.parse('2027-02-11T02:00:00Z') / 1000);
  assert.equal(sent.body.input.capacity, 12); assert.equal(sent.body.chatId, '-1001');
});

test('members explicitly opt into private event reminders and never see event admin controls', async () => {
  const starts = Math.floor(Date.now() / 1000) + 86400;
  const h = await harness({ member: true, groups: [], group: '-1009', view: 'events', data: { events: { timezone: 'Europe/London', events: [{ id: 'future-event', title: 'Study workshop', starts_at: starts, ends_at: starts + 3600, status: 'active', capacity: 1, counts: { going: 1 }, waiting: 2, response: 'waitlisted', reminders: { enabled: false } }] } } });
  assert.equal(h.field('eventTimezone'), undefined); assert.equal(h.field('title'), undefined);
  assert.match(h.content().textContent, /Waiting list/); assert.match(h.content().textContent, /Reminders off/);
  assert.equal(h.nodes().some(node => node.tag === 'button' && ['Edit', 'Cancel event'].includes(node.textContent)), false);
  assert.equal(h.requests.some(row => row.body.action), false);
  const lead = h.nodes().find(node => node.tag === 'select' && node.attributes['aria-label'] === 'Reminder for Study workshop'); lead.value = '15';
  await h.nodes().find(node => node.tag === 'button' && node.textContent === 'Remind me privately').listeners.click();
  assert.match(h.get('tools-modal').textContent, /Open \/start privately with the bot first/);
  assert.equal(h.requests.some(row => row.body.action), false); await h.confirm();
  const sent = h.requests.find(row => row.body.action === 'event_reminders');
  assert.equal(sent.body.chatId, '-1009'); assert.deepEqual(sent.body.input, { id: 'future-event', enabled: true, leadMinutes: 15, language: 'en' });
});
