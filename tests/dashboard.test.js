import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
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
