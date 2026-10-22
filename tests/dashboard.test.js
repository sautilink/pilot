import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { webcrypto } from 'node:crypto';
import { renderDashboard, dashboardRequestId } from '../src/dashboard.js';

test('Mini App renders a complete bilingual unauthenticated welcome without private group data', () => {
  const sw = renderDashboard({ lang: 'sw' }); const en = renderDashboard();
  assert.match(sw, /<html lang="sw">/); assert.match(en, /<html lang="en">/);
  assert.match(sw, /Group lako\./); assert.match(en, /Your group\./);
  assert.match(sw, /Fungua ndani ya Telegram/); assert.match(en, /Open in Telegram/);
  for (const html of [sw, en]) {
    assert.match(html, /https:\/\/t\.me\/sautilinkpilotbot\?start=dashboard/);
    assert.match(html, /<div id="app" class="shell" hidden>/);
    assert.match(html, /name="robots" content="noindex,nofollow"/);
    assert.doesNotMatch(html, /SETUP_KEY|BOT_TOKEN|api\/setup|initDataUnsafe|localStorage|sessionStorage|\.innerHTML\s*=/);
  }
});

test('generated client script compiles and untrusted locale hints cannot become HTML', () => {
  const html = renderDashboard({ lang: '</script><script>alert(1)</script>' });
  assert.match(html, /<html lang="en">/);
  assert.doesNotMatch(html, /alert\(1\)/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0][1]));
});

test('welcome cards use semantic Router artwork with deferred same-origin enhancement', () => {
  const html = renderDashboard();
  assert.match(html, /<body data-public-icons>/);
  const accessIcons = [...html.matchAll(/<div class="login-access-row">[\s\S]*?<svg[^>]*data-public-icon="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(accessIcons, ['user', 'shield-check', 'id-verified']);
  const featureIcons = [...html.matchAll(/<div class="login-feature"[^>]*>[\s\S]*?<svg[^>]*data-public-icon="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(featureIcons, ['sautilink:justice-scale', 'message-0-1', 'settings-0-1']);
  const enhancements = [...html.matchAll(/<script defer src="([^"]+)"/g)].map(match => match[1]);
  assert.equal(enhancements.length, 2);
  assert.ok(enhancements.every(url => /^\/assets\/public-icons\/(icons|adapter)\.js\?v=[a-f0-9]+$/.test(url)));
  assert.doesNotMatch(html, /m57 7-17 51-11-23L7 24 57 7Z|const icons =|\.innerHTML\s*=/);
});

test('request IDs use cryptographic random bytes when randomUUID is unavailable and never downgrade to Math.random', () => {
  let calls = 0;
  const value = dashboardRequestId({ getRandomValues(bytes) { calls++; assert.equal(bytes.byteLength, 16); for (let index = 0; index < bytes.length; index++) bytes[index] = index + 1; return bytes; } });
  assert.equal(value, '0102030405060708090a0b0c0d0e0f10');
  assert.equal(calls, 1);
  assert.equal(dashboardRequestId({ randomUUID: () => 'public-test-random-uuid' }), 'public-test-random-uuid');
  assert.throws(() => dashboardRequestId({}), /Secure randomness unavailable/);
});

async function settingsHarness(language = 'en', saved = {}, options = {}) {
  const ids = new Map(), requests = [], templates = new Map(), replacements = [];
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.style = {}; this.dataset = {}; this.attributes = {}; this.value = ''; this.hidden = false; this.checked = false; this.disabled = false; this._text = ''; }
    set id(value) { this._id = value; ids.set(value, this); }
    get id() { return this._id; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
    get firstChild() { return this.children[0]; }
    get firstElementChild() { return this.children.find(node => !node.tag.startsWith('#')); }
    get lastChild() { return this.children.at(-1); }
    append(...nodes) { this.children.push(...nodes); }
    prepend(...nodes) { this.children.unshift(...nodes); }
    replaceChildren(...nodes) { this._text = ''; this.children = nodes; }
    setAttribute(key, value) {
      this.attributes[key] = String(value);
      if (key === 'class') this.className = String(value);
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
    }
    cloneNode(deep = false) {
      const clone = new Node(this.tag); clone.namespaceURI = this.namespaceURI;
      for (const [key, value] of Object.entries(this.attributes)) clone.setAttribute(key, value);
      clone._text = this._text;
      if (deep) clone.append(...this.children.map(child => child.cloneNode(true)));
      return clone;
    }
    addEventListener(kind, callback) { this.listeners[kind] = callback; }
    reportValidity() { return true; }
  }
  const walk = node => [node, ...node.children.flatMap(walk)];
  const languageButtons = [];
  const document = {
    getElementById(id) { if (!ids.has(id)) { if (id.startsWith('pilot-icon-')) return null; const node = new Node('div'); node.id = id; } return ids.get(id); },
    createElement: tag => new Node(tag),
    createElementNS(namespace, tag) { const node = new Node(tag); node.namespaceURI = namespace; return node; },
    createTextNode(text) { const node = new Node('#text'); node.textContent = text; return node; },
    querySelectorAll(selector) { return selector === '[data-lang]' ? languageButtons : []; },
  };
  const group = { id: '-1001001', title: 'Example group', type: 'supergroup' };
  const overview = { group, language: options.groupLanguage || language, moderation: { enabled: true, permissionsComplete: true }, settings: {
    welcome_enabled: false, welcome_sw: '', welcome_en: '', rules_sw: '', rules_en: '', notice_template: 'detailed', notice_sw: '', notice_en: '',
    flood_enabled: false, flood_limit: 8, flood_window: 10, flood_action: 'delete', flood_mute_seconds: 300, join_gate_enabled: false, join_gate_mode: 'review', ...saved,
  }, subscription: { alerts: false, report: 'off' }, rules: [], incidents: [], appeals: [], joins: [], audit: [], stats: {} };
  const html = renderDashboard({ lang: language });
  // Materialize the actual server-rendered SVG templates. The client must clone
  // their artwork; this mock does not supply substitute paths or a fake factory.
  for (const [, id, markup] of html.matchAll(/<template id="([^"]+)">([\s\S]*?)<\/template>/g)) {
    const template = new Node('template'); template.id = id; template.content = new Node('#document-fragment');
    const stack = [template.content];
    for (const [token, closing, tag, attributes] of markup.matchAll(/<(\/)?([\w:-]+)([^>]*)>/g)) {
      if (closing) { assert.equal(stack.pop().tag, tag); continue; }
      const node = new Node(tag); node.namespaceURI = 'http://www.w3.org/2000/svg';
      for (const [, key, value] of attributes.matchAll(/([\w:-]+)="([^"]*)"/g)) node.setAttribute(key, value);
      stack.at(-1).append(node);
      if (!token.endsWith('/>')) stack.push(node);
    }
    assert.equal(stack.length, 1); assert.equal(template.content.firstElementChild.tag, 'svg');
    templates.set(id, template.content.firstElementChild);
  }
  for (const [, locale] of html.matchAll(/<button[^>]*data-lang="(sw|en)"/g)) {
    const button = new Node('button'); button.setAttribute('data-lang', locale); languageButtons.push(button);
  }
  const currentUrl = new URL(options.url || `https://pilot.sautilink.com/app?tab=settings&group=${group.id}&lang=${language}`);
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  vm.runInNewContext(script, {
    document, window: { Telegram: { WebApp: { initData: 'public-test-init-data', ready() {}, expand() {} } } },
    location: { href: currentUrl.href, search: currentUrl.search, replace(url) { replacements.push(url); } },
    URL, URLSearchParams, crypto: webcrypto, setTimeout: () => 1, clearTimeout() {},
    fetch: async (url, options) => {
      const body = JSON.parse(options.body); requests.push({ url, options, body });
      let data;
      if (body.action === 'configure') { Object.assign(overview.settings, body.input.settings); data = { ok: true }; }
      else if (body.view === 'groups') data = { groups: [group] };
      else if (body.view === 'overview') data = overview;
      else throw new Error(`Unexpected request ${JSON.stringify(body)}`);
      return { ok: true, json: async () => ({ ok: true, data }) };
    },
  });
  await nextTurn();
  const content = document.getElementById('content');
  return {
    content, requests, templates, replacements, languageButtons, html,
    nodes: () => walk(content), navigation: () => walk(document.getElementById('sidebar')),
    input: name => walk(content).find(node => node.name === name), flush: nextTurn,
  };
}

test('settings render the default-on delete-only filter and submit scoped exceptions without a restriction action', async () => {
  const h = await settingsHarness();
  assert.match(h.content.textContent, /Command spam/);
  assert.match(h.content.textContent, /No ban, mute or strike/);
  assert.match(h.content.textContent, /Link and forward rules still apply/);
  assert.equal(h.input('command_spam_enabled').checked, true);
  const exceptions = h.input('command_spam_allowlist');
  assert.equal(exceptions.tag, 'textarea');
  assert.equal(exceptions.maxLength, 2000);
  exceptions.value = '/get_*@ExampleBot\n/get_ExampleOpaqueCode12345678901234567890';
  const form = h.nodes().find(node => node.tag === 'form');
  form.listeners.submit({ preventDefault() {} });
  await h.flush();
  const mutation = h.requests.find(request => request.body.action === 'configure');
  assert.equal(mutation.body.chatId, '-1001001');
  assert.equal(mutation.body.input.settings.command_spam_enabled, true);
  assert.equal(mutation.body.input.settings.command_spam_allowlist, exceptions.value);
  assert.equal(mutation.body.input.language, 'en');
  assert.equal(mutation.options.headers.Authorization, 'tma public-test-init-data');
  assert.equal(Object.hasOwn(mutation.body.input.settings, 'command_spam_action'), false);
  assert.equal(Object.hasOwn(mutation.body.input.settings, 'command_spam_mute_seconds'), false);
});

test('saved off state stays off and welcome preview follows the toggle in both languages', async () => {
  for (const language of ['sw', 'en']) {
    const h = await settingsHarness(language, { command_spam_enabled: false, command_spam_allowlist: '/get_*' });
    const toggle = h.input('command_spam_enabled');
    assert.equal(toggle.checked, false);
    assert.equal(h.input('command_spam_allowlist').value, '/get_*');
    const preview = h.nodes().find(node => node.className === 'preview-copy');
    assert.doesNotMatch(preview.textContent, /command/);
    toggle.checked = true; toggle.listeners.change();
    assert.match(preview.textContent, language === 'en' ? /silently deleted/ : /kimya kimya/);
    toggle.checked = false; toggle.listeners.change();
    assert.doesNotMatch(preview.textContent, /command/);
    const form = h.nodes().find(node => node.tag === 'form');
    form.listeners.submit({ preventDefault() {} });
    await h.flush();
    assert.equal(h.requests.find(request => request.body.action === 'configure').body.input.settings.command_spam_enabled, false);
  }
});

test('dynamic navigation and settings safely clone the exact shared static SVG templates', async () => {
  const h = await settingsHarness();
  const sources = new Map([...h.templates.values()].map(svg => [svg.dataset.publicIcon, svg]));
  const icons = [...h.nodes(), ...h.navigation()].filter(node => node.tag === 'svg');
  const snapshot = node => ({ tag: node.tag, attributes: node.attributes, children: node.children.map(snapshot) });
  assert.ok(icons.length > 10, 'navigation and settings render without loading the icon runtime');
  assert.equal(new Set(icons).size, icons.length, 'each control receives its own SVG');
  for (const svg of icons) {
    const source = sources.get(svg.dataset.publicIcon);
    assert.ok(source, `template exists for ${svg.dataset.publicIcon}`);
    assert.notEqual(svg, source);
    assert.notEqual(svg.children[0], source.children[0]);
    assert.deepEqual(snapshot(svg), snapshot(source));
    assert.equal(svg.attributes['aria-hidden'], 'true');
    assert.equal(svg.attributes.focusable, 'false');
  }
  const headings = h.nodes().filter(node => node.className === 'setting-title');
  assert.deepEqual(headings.map(heading => heading.firstElementChild.dataset.publicIcon), [
    'globe-0-2', 'user-group', 'notification', 'code', 'activity', 'user-add-0-1',
  ]);
  const navigation = h.navigation().filter(node => node.tag === 'svg').map(node => node.dataset.publicIcon);
  for (const name of ['analytics-0-1', 'security-block', 'sautilink:justice-scale', 'settings-0-1', 'attachment-0-1', 'id-verified', 'search']) assert.ok(navigation.includes(name));
});

test('language switches preserve signed context only on the existing Mini App page and keep public links localized', async () => {
  for (const [language, next] of [['en', 'sw'], ['sw', 'en']]) {
    const fragment = '#tgWebAppData=public-test-signed-context&tgWebAppVersion=8.0';
    const h = await settingsHarness(language, {}, { url: `https://pilot.sautilink.com/app?tab=settings&group=-1001001&lang=${language}${fragment}` });
    const links = [...h.html.matchAll(/<a[^>]*href="(\/[^"]*)"/g)].map(match => new URL(match[1], 'https://pilot.sautilink.com'));
    assert.ok(links.length >= 3);
    for (const url of links) {
      assert.equal(url.searchParams.get('lang'), language);
      assert.equal(url.hash, '');
      assert.equal(url.searchParams.has('tgWebAppData'), false);
    }
    const requestCount = h.requests.length;
    h.languageButtons.find(node => node.dataset.lang === next).listeners.click();
    assert.equal(h.replacements.length, 1);
    const switched = new URL(h.replacements[0]);
    assert.equal(switched.origin, 'https://pilot.sautilink.com');
    assert.equal(switched.pathname, '/app');
    assert.equal(switched.searchParams.get('lang'), next);
    assert.equal(switched.searchParams.get('group'), '-1001001');
    assert.equal(switched.hash, fragment);
    assert.equal(h.requests.length, requestCount, 'presentation language does not submit a group mutation');
  }
});

test('English visitor presentation preserves the group’s saved Swahili language when saving other settings', async () => {
  const h = await settingsHarness('en', {}, { groupLanguage: 'sw' });
  assert.match(h.content.textContent, /Group language/);
  assert.equal(h.input('groupLanguage').value, 'sw');
  const form = h.nodes().find(node => node.tag === 'form');
  form.listeners.submit({ preventDefault() {} });
  await h.flush();
  const mutation = h.requests.find(request => request.body.action === 'configure');
  assert.equal(mutation.body.input.language, 'sw');
  assert.equal(mutation.options.headers.Authorization, 'tma public-test-init-data');
});
