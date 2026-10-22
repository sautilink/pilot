import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { icon, ICON_ALIASES, ICON_CSS, iconScripts, iconAssetResponse, PUBLIC_ICON_VERSION } from '../src/public-icons.js';
import { STATIC_ICONS } from '../src/vendor/public-icons/static.generated.js';
import { renderStaticIcons } from '../scripts/build-public-icons.mjs';

const vendor = new URL('../src/vendor/public-icons/', import.meta.url);
const read = name => readFile(new URL(name, vendor), 'utf8');
const request = (name, options) => new Request(`https://pilot.sautilink.com/assets/public-icons/${name}`, options);
const adapterSource = await read('adapter.js');

test('served Router runtime, adapter and notices retain their exact source bytes and recorded hashes', async () => {
  const provenance = JSON.parse(await read('PROVENANCE.json'));
  assert.equal(provenance.gitTree, '48a687b7d0e34155e834950213f4af4ff6a6bf45');
  assert.equal(provenance.package, '@animateicons/vanilla');
  assert.equal(provenance.version, '0.1.0');
  for (const [name, expectedHash] of Object.entries(provenance.files)) {
    const source = await read(name), response = iconAssetResponse(request(name));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), source, `${name} must be served unchanged`);
    assert.equal(createHash('sha256').update(source).digest('hex'), expectedHash);
    assert.equal(response.headers.get('Content-Length'), String(Buffer.byteLength(source)));
  }
  assert.equal(ICON_CSS, await read('icons.css'));
  assert.match(ICON_CSS, /prefers-reduced-motion:reduce/);
});

test('all static SVGs are exact normal-state renders from the Router bundle before browser JavaScript', async () => {
  const manifest = JSON.parse(await read('manifest.json'));
  const rendered = renderStaticIcons(await read('icons.js'));
  assert.equal(Object.keys(rendered).length, 89);
  assert.deepEqual(Object.keys(rendered), [...manifest.names].sort());
  assert.deepEqual(STATIC_ICONS, rendered);
  for (const [name, svg] of Object.entries(rendered)) {
    assert.match(svg, /^<svg /);
    assert.match(svg, /<(?:path|circle|rect|line) /);
    assert.doesNotMatch(svg, /<script|<foreignObject|\son\w+=|href=|url\(/i);
    const output = icon(name);
    assert.match(output, /class="public-icon"/);
    assert.ok(output.includes(`data-public-icon="${name}"`));
    assert.match(output, /aria-hidden="true" focusable="false"/);
  }
});

test('public and Mini App aliases use the same packaged drawings and class input stays inside its attribute', () => {
  const required = ['plane', 'shield', 'link', 'forward', 'check', 'users', 'radio', 'clock', 'infinity', 'lock', 'reset', 'router', 'cloud', 'help', 'compass', 'mail', 'file', 'book', 'settings', 'key', 'copy', 'globe', 'code', 'arrow-right', 'arrow-up-right', 'plus', 'overview', 'incidents', 'appeals', 'activity', 'mystatus', 'checklink', 'joins', 'refresh', 'whitelist', 'moon', 'sun'];
  for (const name of required) {
    assert.ok(Object.hasOwn(ICON_ALIASES, name));
    assert.equal(icon(name), icon(ICON_ALIASES[name]));
  }
  assert.equal(icon('__proto__'), icon('help'));
  assert.equal(icon('missing-icon'), icon('help'));
  assert.match(icon('plane', 'public-icon--action'), /class="public-icon public-icon--action"/);
  const escaped = icon('"><script>bad()</script>', '" onload="bad()<>&');
  assert.match(escaped, /class="public-icon &quot; onload=&quot;bad\(\)&lt;&gt;&amp;"/);
  assert.doesNotMatch(escaped, /<script|class="[^"]*" onload=/);
});

test('deferred browser assets are same-origin, ordered, versioned and independently cacheable', async () => {
  const scripts = iconScripts();
  assert.equal(scripts, `<script defer src="/assets/public-icons/icons.js?v=${PUBLIC_ICON_VERSION}"></script><script defer src="/assets/public-icons/adapter.js?v=${PUBLIC_ICON_VERSION}"></script>`);
  const response = iconAssetResponse(request(`icons.js?v=${PUBLIC_ICON_VERSION}`));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.equal(response.headers.get('Content-Type'), 'application/javascript; charset=utf-8');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Cross-Origin-Resource-Policy'), 'same-origin');
  assert.equal(iconAssetResponse(request('icons.js')).headers.get('Cache-Control'), 'public, max-age=3600');
  assert.equal(iconAssetResponse(request('icons.js?v=old')).headers.get('Cache-Control'), 'public, max-age=3600');
  const head = iconAssetResponse(request('icons.js', { method: 'HEAD' }));
  assert.equal(head.headers.get('Content-Length'), response.headers.get('Content-Length'));
  assert.equal(await head.text(), '');
  const cached = iconAssetResponse(request('icons.js', { headers: { 'If-None-Match': `"other", W/${response.headers.get('ETag')}` } }));
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), '');
  for (const req of [request('icons.js', { method: 'POST' }), request('unknown.js'), request('%2e%2e%2fsecret'), new Request('https://pilot.sautilink.com/api/setup')]) assert.equal(iconAssetResponse(req), null);
});

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    emit(type, event = {}) { for (const callback of listeners.get(type) || []) callback(event); },
  };
}

function fakeSVG(name, { control = eventTarget(), intro = false } = {}) {
  const attrs = new Map([['viewBox', '0 0 24 24'], ['stroke', 'currentColor']]);
  const styles = new Map();
  return {
    nodeType: 1, localName: 'svg', dataset: { publicIcon: name }, attrs, control, intro,
    isConnected: true, hidden: false, inLayout: true, childNodes: [{ normal: true }],
    style: { setProperty(key, value) { styles.set(key, value); }, getPropertyValue(key) { return styles.get(key); }, [Symbol.iterator]() { return styles.keys(); } },
    setAttribute(key, value) { attrs.set(key, value); }, getAttribute(key) { return attrs.get(key) ?? null; },
    replaceChildren(...nodes) { this.childNodes = nodes; },
    getClientRects() { return this.inLayout ? [{}] : []; },
    matches(selector) { return selector === '[data-public-icon]'; },
    querySelector() { return null; },
    closest(selector) {
      if (selector === '[hidden],[inert]') return this.hidden ? {} : null;
      if (selector.startsWith('a,button,')) return this.control;
      if (selector.startsWith('h1,h2,')) return this.intro ? {} : null;
      return null;
    },
  };
}

function adapterHarness({ reduced = false, intro = false } = {}) {
  const icons = [fakeSVG('send', { intro })], microtasks = [], timers = new Map();
  const counts = { rendered: 0, started: 0, destroyed: 0, mutationDisconnected: 0, intersectionDisconnected: 0 };
  let nextTimer = 0, mutation, intersection;
  const root = { querySelectorAll() { return icons; } };
  const document = { ...eventTarget(), visibilityState: 'visible', querySelector() { return root; } };
  const motion = { ...eventTarget(), matches: reduced };
  const runtime = {
    catalog: { send: {}, 'shield-check': {} },
    renderIcon(name) { counts.rendered++; return fakeSVG(name); },
    play(svg) { return { start() { counts.started++; svg.childNodes[0].normal = false; }, destroy() { counts.destroyed++; } }; },
  };
  class Intersection {
    constructor(callback) { this.callback = callback; this.observed = new Set(); intersection = this; }
    observe(svg) { this.observed.add(svg); }
    unobserve(svg) { this.observed.delete(svg); }
    disconnect() { counts.intersectionDisconnected++; this.observed.clear(); }
    visible(svg, value) { this.callback([{ target: svg, isIntersecting: value }]); }
  }
  class Mutations {
    constructor(callback) { this.callback = callback; mutation = this; }
    observe() {}
    disconnect() { counts.mutationDisconnected++; }
  }
  const window = { ...eventTarget(), SautiPublicIcons: runtime, matchMedia() { return motion; }, IntersectionObserver: Intersection };
  vm.runInNewContext(adapterSource, {
    document, window, IntersectionObserver: Intersection, MutationObserver: Mutations,
    clearTimeout(id) { timers.delete(id); }, setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    queueMicrotask(callback) { microtasks.push(callback); },
  });
  const flush = () => { while (microtasks.length) microtasks.shift()(); };
  const notify = changes => { mutation.callback(changes); flush(); };
  return { icons, counts, timers, document, window, motion, intersection, notify };
}

test('the exact Router adapter enhances new Mini App nodes and cleans up removed controls', () => {
  const h = adapterHarness(), first = h.icons[0];
  assert.equal(first.dataset.publicIconReady, 'true');
  assert.equal(first.attrs.get('aria-hidden'), 'true');
  assert.equal(first.attrs.get('focusable'), 'false');
  assert.equal(h.counts.started, 0, 'offscreen enhancement does not animate');
  const added = fakeSVG('shield-check');
  h.icons.push(added);
  h.notify([{ type: 'childList', addedNodes: [added], removedNodes: [] }]);
  assert.equal(added.dataset.publicIconReady, 'true');
  assert.ok(h.intersection.observed.has(added));
  h.intersection.visible(added, true);
  added.control.emit('focusin');
  assert.equal(h.counts.started, 1);
  assert.equal(h.timers.size, 1);
  added.isConnected = false; h.icons.pop();
  h.notify([{ type: 'childList', addedNodes: [], removedNodes: [added] }]);
  assert.equal(h.counts.destroyed, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(h.intersection.observed.has(added), false);
  assert.ok([...added.control.listeners.values()].every(listeners => listeners.size === 0));
});

test('adapter interactions skip hidden, offscreen and disabled icons, then settle when leaving view', () => {
  const h = adapterHarness(), svg = h.icons[0];
  svg.control.emit('pointerenter'); assert.equal(h.counts.started, 0);
  h.intersection.visible(svg, true);
  svg.hidden = true; svg.control.emit('pointerenter'); assert.equal(h.counts.started, 0);
  svg.hidden = false; svg.inLayout = false; svg.control.emit('pointerenter'); assert.equal(h.counts.started, 0);
  svg.inLayout = true; svg.control.disabled = true; svg.control.emit('pointerenter'); assert.equal(h.counts.started, 0);
  svg.control.disabled = false; svg.control.emit('pointerenter'); assert.equal(h.counts.started, 1);
  h.intersection.visible(svg, false);
  assert.equal(h.counts.destroyed, 1);
  assert.equal(h.timers.size, 0);
  assert.equal(svg.childNodes[0].normal, true);
});

test('reduced motion and hidden tabs stop active animation while retaining normal artwork', () => {
  const h = adapterHarness({ reduced: true, intro: true }), svg = h.icons[0];
  h.intersection.visible(svg, true);
  svg.control.emit('focusin');
  assert.equal(h.counts.started, 0);
  assert.equal(svg.childNodes[0].normal, true);
  h.motion.matches = false; h.motion.emit('change'); svg.control.emit('pointerdown');
  assert.equal(h.counts.started, 1);
  h.motion.matches = true; h.motion.emit('change');
  assert.equal(h.counts.destroyed, 1);
  assert.equal(svg.childNodes[0].normal, true);
  h.motion.matches = false; svg.control.emit('pointerdown');
  h.document.visibilityState = 'hidden'; h.document.emit('visibilitychange');
  assert.equal(h.counts.destroyed, 2);
  assert.equal(h.timers.size, 0);
  svg.control.emit('pointerdown'); assert.equal(h.counts.started, 2);
});

test('page teardown disconnects observers and controls while a persisted page settles for return', () => {
  const h = adapterHarness(), svg = h.icons[0];
  h.intersection.visible(svg, true); svg.control.emit('pointerenter');
  h.window.emit('pagehide', { persisted: true });
  assert.equal(h.counts.destroyed, 1);
  assert.equal(h.counts.mutationDisconnected, 0);
  h.window.emit('pageshow', { persisted: true });
  svg.control.emit('pointerenter'); assert.equal(h.counts.started, 2);
  h.window.emit('pagehide', { persisted: false });
  assert.equal(h.counts.destroyed, 2);
  assert.equal(h.counts.mutationDisconnected, 1);
  assert.equal(h.counts.intersectionDisconnected, 1);
  assert.equal(h.timers.size, 0);
  assert.ok([...svg.control.listeners.values()].every(listeners => listeners.size === 0));
});
