import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { register } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';

// Source tests cannot see helpers inserted by Wrangler/esbuild. Import the
// deployed bundle, render its pages, then execute their scripts in a different
// realm without Worker globals or bundler helper shims. No bindings or secrets
// are supplied, and every attempted network request makes this check fail.
register('./cloudflare-smoke-loader.mjs', import.meta.url);
const bundle = process.argv[2] ? pathToFileURL(resolve(process.argv[2])) : new URL('../dist/index.js', import.meta.url);
const originalFetch = globalThis.fetch;
let networkCalls = 0;
const forbidNetwork = () => { networkCalls += 1; throw new Error('Build smoke tests must not make network requests'); };
globalThis.fetch = forbidNetwork;

function attributes(source) {
  const result = {};
  for (const match of source.matchAll(/(?:^|\s)([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
    result[match[1].toLowerCase()] = (match[2] ?? match[3] ?? match[4] ?? '').replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
  }
  return result;
}

function events(target) {
  const handlers = new Map();
  return Object.assign(target, {
    addEventListener(type, callback, options = {}) {
      const list = handlers.get(type) || [];
      list.push({ callback, once: options.once === true }); handlers.set(type, list);
    },
    dispatch(type) {
      const list = [...(handlers.get(type) || [])];
      for (const item of list) {
        if (item.once) handlers.set(type, (handlers.get(type) || []).filter(entry => entry !== item));
        item.callback({ target: this, preventDefault() {} });
      }
    },
    listenerCount(type) { return (handlers.get(type) || []).length; },
  });
}

function browserFixture(html, href, readyState) {
  const location = new URL(href), nodes = [];
  // Keep source offsets so a head script only sees elements parsed before it.
  // The fixture intentionally implements only DOM operations used by these
  // public startup paths; selectors or markup changes cannot silently pass.
  const markup = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, block => ' '.repeat(block.length));
  for (const match of markup.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const attrs = attributes(match[2]);
    const node = events({ tagName: match[1].toLowerCase(), attributes: attrs, offset: match.index,
      dataset: Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()), value])),
      value: attrs.value || '', textContent: '', hidden: Object.hasOwn(attrs, 'hidden'), disabled: Object.hasOwn(attrs, 'disabled'),
      getAttribute(name) { return this.attributes[name] ?? null; },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      classList: { toggle() {} },
    });
    nodes.push(node);
  }
  let parsedThrough = readyState === 'loading' ? 0 : Infinity;
  const matches = (node, selector) => {
    if (selector === 'a[href]') return node.tagName === 'a' && Object.hasOwn(node.attributes, 'href');
    if (selector === 'meta[name="theme-color"]') return node.tagName === 'meta' && node.attributes.name === 'theme-color';
    const data = /^\[(data-[a-z-]+)\]$/.exec(selector);
    if (data) return Object.hasOwn(node.attributes, data[1]);
    throw new Error(`Unsupported smoke-test selector: ${selector}`);
  };
  const document = events({ readyState,
    documentElement: nodes.find(node => node.tagName === 'html'),
    getElementById(id) { return nodes.find(node => node.offset < parsedThrough && node.attributes.id === id) || null; },
    querySelectorAll(selector) { return nodes.filter(node => node.offset < parsedThrough && matches(node, selector)); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
  });
  const replacements = [];
  location.replace = value => { replacements.push(value); location.href = new URL(value, location).href; };
  const context = vm.createContext({
    document, location, URL, URLSearchParams, crypto: webcrypto, AbortSignal,
    window: {}, navigator: { clipboard: { writeText: async () => {} } }, fetch: forbidNetwork,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    history: { replaceState(state, title, value) { location.href = new URL(value, location).href; } },
    setTimeout() { throw new Error('Unexpected startup timer in build smoke'); }, clearTimeout() {},
  });
  return { document, context, location, replacements,
    parseThrough(offset) { if (document.readyState === 'loading') parsedThrough = offset; },
    finish() { parsedThrough = Infinity; document.readyState = 'interactive'; document.dispatch('DOMContentLoaded'); },
  };
}

function inlineScripts(html) {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].flatMap(match => {
    const attrs = attributes(match[1]);
    if (Object.hasOwn(attrs, 'src')) return [];
    const type = (attrs.type || '').toLowerCase().split(';')[0].trim();
    assert.notEqual(type, 'module', 'Add module execution coverage before shipping an inline module');
    // JSON-LD is metadata, not browser JavaScript.
    if (type && !['text/javascript', 'application/javascript'].includes(type)) return [];
    return [{ code: match[2], offset: match.index, theme: Object.hasOwn(attrs, 'data-pilot-theme') }];
  });
}

function checkTheme(h, label) {
  const { document, location } = h;
  const buttons = document.querySelectorAll('[data-theme-toggle]');
  assert.equal(buttons.length, 1, `${label}: theme control exists`);
  const button = buttons[0];
  assert.equal(button.listenerCount('click'), 1, `${label}: one click listener`);
  assert.equal(document.documentElement.dataset.theme, 'light', `${label}: initial theme`);
  for (const theme of ['dark', 'light']) {
    button.dispatch('click');
    assert.equal(document.documentElement.dataset.theme, theme, `${label}: click changes theme`);
    assert.equal(button.getAttribute('aria-pressed'), String(theme === 'dark'), `${label}: accessible state`);
    assert.equal(location.searchParams.get('theme'), theme, `${label}: URL choice`);
    assert.equal(location.searchParams.get('lang'), 'en', `${label}: language preserved`);
    assert.equal(document.querySelector('meta[name="theme-color"]').getAttribute('content'), theme === 'dark' ? '#0b0b0e' : '#ffffff', `${label}: browser chrome`);
    const internalLinks = document.querySelectorAll('a[href]').filter(link => {
      const value = link.getAttribute('href');
      return value.startsWith('/') && new URL(value, location).origin === location.origin;
    });
    assert.ok(internalLinks.length, `${label}: internal navigation exists`);
    for (const link of internalLinks) assert.equal(new URL(link.getAttribute('href'), location).searchParams.get('theme'), theme, `${label}: navigation retains theme`);
  }
}

try {
  const { default: worker, GroupCoordinator } = await import(bundle.href);
  assert.equal(typeof worker.fetch, 'function', 'Built Worker export exists');
  assert.equal(typeof GroupCoordinator, 'function', 'Durable Object named export survives bundling');
  let scriptsExecuted = 0;
  for (const path of ['/', '/privacy', '/setup', '/app', '/tools', '/updates', '/roadmap', '/developers']) {
    const href = `https://pilot.sautilink.com${path}?lang=en`;
    const response = await worker.fetch(new Request(href), {}, { waitUntil() { throw new Error('Unexpected background work while rendering a public page'); } });
    assert.equal(response.status, 200, `${path}: compiled Worker renders successfully`);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    const html = await response.text();
    const scripts = inlineScripts(html);
    assert.equal(scripts.filter(script => script.theme).length, 1, `${path}: one executable theme script`);
    assert.ok(scripts.length >= (['/','/setup','/app','/tools'].includes(path) ? 2 : 1), `${path}: page client script is present`);
    for (const readyState of ['loading', 'complete']) {
      const label = `${path} (${readyState})`;
      const h = browserFixture(html, href, readyState);
      for (const [index, script] of scripts.entries()) {
        h.parseThrough(script.offset);
        vm.runInContext(script.code, h.context, { filename: `${path === '/' ? 'home' : path.slice(1)}-inline-${index}.js`, timeout: 1000 });
        // Also catch helper references hidden in callbacks that startup does
        // not invoke. Never add a __name shim to make this assertion pass.
        assert.doesNotMatch(script.code, /\b__name\s*\(/, `${label}: serialized script leaked an esbuild helper`);
        scriptsExecuted += 1;
      }
      h.finish();
      checkTheme(h, label);
      if (path === '/') {
        h.document.getElementById('sim-run').dispatch('click');
        assert.equal(h.document.getElementById('sim-count').textContent, '1 / 3', `${label}: built simulator works`);
        h.document.getElementById('sim-reset').dispatch('click');
        assert.equal(h.document.getElementById('sim-count').textContent, '0 / 3');
      } else if (path === '/setup') {
        h.document.getElementById('generate-key').dispatch('click');
        assert.match(h.document.getElementById('generated-key').value, /^[a-f0-9]{64}$/, `${label}: browser key generation works`);
      } else if (path === '/app' || path === '/tools') {
        const tools=path==='/tools';
        assert.equal(h.document.getElementById(tools?'tools-welcome':'login').hidden, false, `${label}: visitor welcome remains visible`);
        assert.equal(h.document.getElementById(tools?'tools-app':'app').hidden, true, `${label}: private workspace requires Telegram`);
        const language = h.document.querySelectorAll('[data-lang]').find(node => node.dataset.lang === 'sw');
        assert.equal(language.listenerCount('click'), 1, `${label}: dashboard client initialized`);
        language.dispatch('click');
        assert.equal(h.location.searchParams.get('lang'), 'sw', `${label}: built dashboard language control works`);
        assert.equal(h.location.searchParams.get('theme'), 'light');
      }
      // Flush async startup microtasks; these public paths must stay local.
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  assert.equal(networkCalls, 0, 'The build smoke must stay entirely offline');
  console.log(`Built browser scripts verified: 8 pages, 2 document states, ${scriptsExecuted} inline executions; theme, URL, aria, simulator, setup, dashboard and Community tools controls passed without network access.`);
} finally {
  globalThis.fetch = originalFetch;
}
