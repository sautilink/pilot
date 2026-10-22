import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { themeHead, themeButton } from '../src/ui-system.js';
import { renderHome, renderPrivacy, renderSetup } from '../src/pages.js';
import { renderDashboard } from '../src/dashboard.js';

function themeHarness({ href = 'https://pilot.sautilink.com/?lang=en', dark = false, telegramTheme } = {}) {
  const listeners = {}, mediaListeners = {}, writes = [], platformColors = [];
  const location = new URL(href);
  const node = attributes => ({ attributes: { ...attributes }, listeners: {},
    getAttribute(key) { return this.attributes[key]; },
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(event, callback) { this.listeners[event] = callback; },
  });
  const button = node({}), meta = node({});
  const links = ['/privacy?lang=en', '#jaribu', '/?lang=sw', 'https://t.me/sautilinkpilotbot?start=dashboard', '//other.example/path'].map(href => node({ href }));
  const document = {
    documentElement: { dataset: {} },
    querySelector: () => meta,
    querySelectorAll: selector => selector === '[data-theme-toggle]' ? [button] : links,
    addEventListener(event, callback) { listeners[event] = callback; },
  };
  const media = { matches: dark, addEventListener(event, callback) { mediaListeners[event] = callback; } };
  const WebApp = telegramTheme ? { colorScheme: telegramTheme, isVersionAtLeast: () => true,
    setHeaderColor: value => platformColors.push(value), setBackgroundColor: value => platformColors.push(value) } : undefined;
  const script = themeHead().match(/<script data-pilot-theme>([\s\S]*)<\/script>/)[1];
  vm.runInNewContext(script, { document, location, window: { Telegram: { WebApp } }, URL,
    matchMedia: () => media,
    history: { replaceState(state, title, path) { writes.push(path); location.href = new URL(path, location).href; } },
  });
  listeners.DOMContentLoaded();
  return { document, button, meta, links, writes, platformColors, media, mediaListeners };
}

test('theme follows Telegram or system preference and an explicit choice survives system changes', () => {
  const system = themeHarness({ dark: true });
  assert.equal(system.document.documentElement.dataset.theme, 'dark');
  assert.equal(system.meta.attributes.content, '#0b0b0e');
  system.button.listeners.click();
  assert.equal(system.document.documentElement.dataset.theme, 'light');
  assert.equal(system.button.attributes['aria-pressed'], 'false');
  assert.match(system.writes[0], /theme=light/);
  system.media.matches = true; system.mediaListeners.change();
  assert.equal(system.document.documentElement.dataset.theme, 'light');

  const app = themeHarness({ dark: true, telegramTheme: 'light' });
  assert.equal(app.document.documentElement.dataset.theme, 'light');
  assert.equal(app.platformColors.at(-1), '#ffffff');
  app.button.listeners.click();
  assert.equal(app.platformColors.at(-1), '#0b0b0e');
});

test('theme navigation retains language but never copies signed launch parameters to links', () => {
  const h = themeHarness({ href: 'https://pilot.sautilink.com/app?lang=en&theme=dark&tgWebAppData=private-launch-value#tgWebAppData=private-fragment' });
  assert.equal(h.document.documentElement.dataset.theme, 'dark');
  assert.equal(h.links[0].attributes.href, '/privacy?lang=en&theme=dark');
  assert.equal(h.links[1].attributes.href, '/app?lang=en&theme=dark#jaribu');
  assert.equal(h.links[2].attributes.href, '/?lang=sw&theme=dark');
  assert.equal(h.links[3].attributes.href, 'https://t.me/sautilinkpilotbot?start=dashboard');
  assert.equal(h.links[4].attributes.href, '//other.example/path');
  for (const link of h.links) assert.doesNotMatch(link.attributes.href, /private-launch|private-fragment|tgWebAppData/);
  assert.equal(h.writes.length, 0);
  assert.doesNotMatch(themeHead(), /localStorage|sessionStorage|fetch\(/);
});

test('the theme control uses the shared animated moon and sun with localized accessible labels', () => {
  const button = themeButton();
  assert.match(button, /aria-label="Switch color theme"/);
  assert.match(button, /data-public-icon="moon-0-1"/);
  assert.match(button, /data-public-icon="sun-0-1"/);
  assert.match(themeButton('sw'), /aria-label="Badili mwonekano"/);
});

test('public pages share Router navigation and the connection task precedes the simulator', () => {
  for (const lang of ['sw', 'en']) {
    const home = renderHome({ ready: true, username: 'sautilinkpilotbot', lang });
    assert.ok(home.indexOf('id="connect-pilot"') < home.indexOf('id="jaribu"'));
    assert.match(home, /class="connect-card"/);
    for (const html of [home, renderSetup(lang), renderPrivacy(lang)]) {
      assert.match(html, /class="site-header"/);
      assert.match(html, /class="page-local-nav"/);
      assert.match(html, /https:\/\/router\.sautilink\.com/);
      assert.match(html, /class="site-footer"/);
      assert.match(html, /data-theme-toggle/);
    }
    const app = renderDashboard({ lang });
    assert.match(app, /<img src="https:\/\/sautilink\.com\/logo\.png" alt="" width="30" height="30">/);
    assert.match(app, /class="login-access"/);
    assert.match(app, /data-theme-toggle/);
    assert.doesNotMatch(app, /class="login-visual"/);
  }
});
