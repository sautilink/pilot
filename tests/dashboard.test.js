import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { webcrypto } from 'node:crypto';
import { renderDashboard, dashboardRequestId } from '../src/dashboard.js';

test('Mini App renders a complete bilingual unauthenticated welcome without private group data', () => {
  const sw = renderDashboard(); const en = renderDashboard({ lang: 'en' });
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
  assert.match(html, /<html lang="sw">/);
  assert.doesNotMatch(html, /alert\(1\)/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0][1]));
});

test('request IDs use cryptographic random bytes when randomUUID is unavailable and never downgrade to Math.random', () => {
  let calls = 0;
  const value = dashboardRequestId({ getRandomValues(bytes) { calls++; assert.equal(bytes.byteLength, 16); for (let index = 0; index < bytes.length; index++) bytes[index] = index + 1; return bytes; } });
  assert.equal(value, '0102030405060708090a0b0c0d0e0f10');
  assert.equal(calls, 1);
  assert.equal(dashboardRequestId({ randomUUID: () => 'public-test-random-uuid' }), 'public-test-random-uuid');
  assert.throws(() => dashboardRequestId({}), /Secure randomness unavailable/);
});

async function settingsHarness(language = 'en', saved = {}) {
  const ids = new Map(), requests = [];
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.style = {}; this.dataset = {}; this.attributes = {}; this.value = ''; this.hidden = false; this.checked = false; this.disabled = false; this._text = ''; }
    set id(value) { this._id = value; ids.set(value, this); }
    get id() { return this._id; }
    set textContent(value) { this._text = String(value); this.children = []; }
    get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
    get lastChild() { return this.children.at(-1); }
    append(...nodes) { this.children.push(...nodes); }
    prepend(...nodes) { this.children.unshift(...nodes); }
    replaceChildren(...nodes) { this._text = ''; this.children = nodes; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    addEventListener(kind, callback) { this.listeners[kind] = callback; }
    reportValidity() { return true; }
  }
  const walk = node => [node, ...node.children.flatMap(walk)];
  const document = {
    getElementById(id) { if (!ids.has(id)) { const node = new Node('div'); node.id = id; } return ids.get(id); },
    createElement: tag => new Node(tag),
    createElementNS(namespace, tag) { const node = new Node(tag); node.namespaceURI = namespace; return node; },
    createTextNode(text) { const node = new Node('#text'); node.textContent = text; return node; },
    querySelectorAll() { return []; },
  };
  const group = { id: '-1001001', title: 'Example group', type: 'supergroup' };
  const overview = { group, language, moderation: { enabled: true, permissionsComplete: true }, settings: {
    welcome_enabled: false, welcome_sw: '', welcome_en: '', rules_sw: '', rules_en: '', notice_template: 'detailed', notice_sw: '', notice_en: '',
    flood_enabled: false, flood_limit: 8, flood_window: 10, flood_action: 'delete', flood_mute_seconds: 300, join_gate_enabled: false, join_gate_mode: 'review', ...saved,
  }, subscription: { alerts: false, report: 'off' }, rules: [], incidents: [], appeals: [], joins: [], audit: [], stats: {} };
  const html = renderDashboard({ lang: language });
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  vm.runInNewContext(script, {
    document, window: { Telegram: { WebApp: { initData: 'public-test-init-data', ready() {}, expand() {} } } },
    location: { href: `https://pilot.sautilink.com/app?tab=settings&group=${group.id}`, search: `?tab=settings&group=${group.id}` },
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
  return { content, requests, nodes: () => walk(content), input: name => walk(content).find(node => node.name === name), flush: nextTurn };
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
