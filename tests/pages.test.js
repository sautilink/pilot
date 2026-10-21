import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { renderHome, renderSetup, renderPrivacy } from '../src/pages.js';

test('public page only creates the add-to-group link for a ready, valid bot identity', () => {
  assert.match(renderHome({ username: 'sautilinkpilotbot', ready: true }), /https:\/\/t\.me\/sautilinkpilotbot\?startgroup=pilot/);
  for (const options of [undefined, { username: 'sautilinkpilotbot', ready: false }, { username: 'bad/name', ready: true }, { username: '\"><script>alert(1)</script>', ready: true }]) {
    const page = renderHome(options);
    assert.doesNotMatch(page, /\?startgroup=/);
    assert.doesNotMatch(page, /<script>alert/);
    assert.match(page, /Bot inaandaliwa/);
  }
});

test('public rules explain the agreed exceptions and consequential Telegram limitations', () => {
  const page = renderHome();
  for (const text of ['Saa 24', 'Siku 7', 'Permanent', 'anonymous admins', 'linked channel', 'supergroups', 'copy-paste', 'ujumbe mwingine', 't.me/techhubtz', 't.me/drcharlesofficial']) assert.ok(page.includes(text), text);
  assert.match(page, /Mfano wa tangazo · Si tukio halisi/);
  assert.match(page, /lang="sw"/);
  assert.match(page, /family=Inter/);
});

function setupHarness(response = { ok: true, ready: true, username: 'sautilinkpilotbot' }) {
  const html = renderSetup();
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const ids = ['setup-form', 'setup-key', 'generated-key', 'feedback', 'key-feedback', 'setup-result', 'connect', 'check-status', 'copy-key', 'generate-key'];
  const elements = Object.fromEntries(ids.map(id => [id, { value: '', textContent: '', hidden: false, disabled: false, listeners: {}, classList: { toggle() {} }, addEventListener(event, handler) { this.listeners[event] = handler; }, reportValidity() { return true; }, focus() {}, select() {} }]));
  const requests = [];
  const clipboard = [];
  const context = { document: { getElementById: id => elements[id] }, crypto: webcrypto, Uint8Array, Array, JSON, String, Error, Boolean, AbortSignal, navigator: { clipboard: { writeText: async value => clipboard.push(value) } }, fetch: async (url, options) => { requests.push({ url, options }); return { ok: response.ok !== false, status: response.ok === false ? 401 : 200, json: async () => response }; } };
  vm.runInNewContext(script, context);
  return { elements, requests, clipboard, html };
}

test('setup is inert on load and never requests a Telegram token through the browser', () => {
  const { html, requests } = setupHarness();
  assert.equal(requests.length, 0);
  assert.doesNotMatch(html, /<input[^>]+(?:id|name)="(?:BOT_TOKEN|bot_token|token)"/i);
  assert.doesNotMatch(html, /(?:localStorage|sessionStorage)/);
  assert.match(html, /noindex,nofollow/);
});

test('generated setup key has 256 bits of randomness and remains in page memory', async () => {
  const h = setupHarness();
  h.elements['generate-key'].listeners.click();
  const value = h.elements['generated-key'].value;
  assert.match(value, /^[a-f0-9]{64}$/);
  assert.equal(h.elements['setup-key'].value, value);
  assert.equal(h.requests.length, 0);
  await h.elements['copy-key'].listeners.click();
  assert.deepEqual(h.clipboard, [value]);
});

test('operator status sends the key only in Authorization and renders text safely', async () => {
  const h = setupHarness({ ok: true, ready: true, username: '<img onerror=alert(1)>', status: 'ready' });
  const key = 's'.repeat(64);
  h.elements['setup-key'].value = key;
  await h.elements['check-status'].listeners.click();
  assert.equal(h.requests.length, 1);
  const { url, options } = h.requests[0];
  assert.equal(url, '/api/setup/status');
  assert.equal(options.method, 'GET');
  assert.equal(options.headers.Authorization, `Bearer ${key}`);
  assert.equal(options.body, undefined);
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(h.elements['setup-result'].innerHTML, undefined);
  assert.match(h.elements['setup-result'].textContent, /<img onerror/);
});

test('connecting uses an empty POST body; a script failure cannot put the key into a form URL', async () => {
  const h = setupHarness();
  const key = 'secret'.repeat(10);
  h.elements['setup-key'].value = key;
  let prevented = false;
  await h.elements['setup-form'].listeners.submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].url, '/api/setup');
  assert.equal(h.requests[0].options.method, 'POST');
  assert.equal(h.requests[0].options.body, '{}');
  assert.equal(h.requests[0].options.headers.Authorization, `Bearer ${key}`);
  assert.match(h.html, /<form id="setup-form" method="post" action="\/api\/setup">/);
  assert.doesNotMatch(h.html, /<input[^>]+name=/);
});

test('failed status does not claim success or repeat the setup key', async () => {
  const key = 'a'.repeat(64);
  const h = setupHarness({ ok: false, error: `Invalid key ${key}` });
  h.elements['setup-key'].value = key;
  await h.elements['check-status'].listeners.click();
  assert.match(h.elements.feedback.textContent, /Invalid key \[siri\]/);
  assert.doesNotMatch(h.elements.feedback.textContent, /imeunganishwa/);
  assert.equal(h.elements.connect.disabled, false);
});

test('privacy page describes per-group metadata without promising a retention period', () => {
  const page = renderPrivacy();
  assert.match(page, /haihifadhi nakala kamili za mazungumzo/);
  assert.match(page, /Historia hii hutenganishwa kwa kila group/);
  assert.match(page, /Telegram na Cloudflare/);
});
