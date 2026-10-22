import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { renderHome, renderSetup, renderPrivacy } from '../src/pages.js';

test('public pages explain silent command deletion and the stored admin exceptions in both languages', () => {
  for (const lang of ['sw', 'en']) {
    const home = renderHome({ username: 'sautilinkpilotbot', ready: true, lang });
    assert.match(home, lang === 'en' ? /Command spam/ : /Spam ya commands/);
    assert.match(home, lang === 'en' ? /without a ban, mute or strike/ : /bila ban, mute wala kosa/);
    assert.match(home, lang === 'en' ? /admins can add exceptions or turn it off/ : /admin anaweza kuweka exceptions au kukizima/);
    for (const username of ['techhubtz', 'sautilink', 'sautilinkcloud_bot', 'drcharlesofficial', 'drcharlestz']) assert.ok(home.includes(`href="https://t.me/${username}"`), username);
    assert.equal([...home.matchAll(/class="channel-link"/g)].length, 5);
    assert.doesNotMatch(home, /sautilink_cloud|these Telegram channel links|links za channels hizi/);
    const privacy = renderPrivacy(lang);
    assert.match(privacy, lang === 'en' ? /command exceptions/ : /exceptions za commands/);
    assert.match(privacy, lang === 'en' ? /without retaining the deleted code/ : /bila kuhifadhi code iliyoondolewa/);
  }
});

test('public page only creates the add-to-group link for a ready, valid bot identity', () => {
  assert.match(renderHome({ username: 'sautilinkpilotbot', ready: true }), /https:\/\/t\.me\/sautilinkpilotbot\?startgroup=pilot/);
  for (const options of [undefined, { username: 'sautilinkpilotbot', ready: false }, { username: 'bad/name', ready: true }, { username: '\"><script>alert(1)</script>', ready: true }]) {
    const page = renderHome(options);
    assert.doesNotMatch(page, /\?startgroup=/);
    assert.doesNotMatch(page, /<script>alert/);
    assert.match(page, /Bot coming soon/);
  }
});

test('public rules explain the agreed exceptions and consequential Telegram limitations', () => {
  const page = renderHome({ lang: 'sw' });
  for (const text of ['Saa 24', 'Siku 7', 'Permanent', 'anonymous admins', 'linked channel', 'supergroups', 'copy-paste', 'ujumbe mwingine', 't.me/techhubtz', 't.me/drcharlesofficial']) assert.ok(page.includes(text), text);
  assert.match(page, /Mfano wa tangazo · Si tukio halisi/);
  assert.match(page, /lang="sw"/);
  assert.match(page, /family=Inter/);
});

function setupHarness(response = { ok: true, ready: true, username: 'sautilinkpilotbot' }, lang = 'sw') {
  const html = renderSetup(lang);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const ids = ['setup-form', 'setup-key', 'generated-key', 'feedback', 'key-feedback', 'setup-result', 'connect', 'check-status', 'copy-key', 'generate-key', 'owner-check', 'owner-pair', 'owner-feedback', 'owner-bound', 'owner-next', 'owner-pairing', 'owner-command', 'owner-expiry', 'owner-copy'];
  const elements = Object.fromEntries(ids.map(id => [id, { value: '', textContent: '', hidden: false, disabled: false, listeners: {}, classList: { toggle() {} }, addEventListener(event, handler) { this.listeners[event] = handler; }, reportValidity() { return true; }, focus() {}, select() {} }]));
  const requests = [];
  const clipboard = [];
  const timers = [];
  let currentResponse = response;
  for (const id of ['owner-pair', 'owner-bound', 'owner-next', 'owner-pairing']) elements[id].hidden = true;
  const context = { document: { getElementById: id => elements[id] }, crypto: webcrypto, Uint8Array, Array, JSON, String, Error, Boolean, AbortSignal, navigator: { clipboard: { writeText: async value => clipboard.push(value) } }, setTimeout(handler, delay) { const timer = { handler, delay, cleared: false }; timers.push(timer); return timer; }, clearTimeout(timer) { timer.cleared = true; }, fetch: async (url, options) => { requests.push({ url, options }); return { ok: currentResponse.ok !== false, status: currentResponse.httpStatus || (currentResponse.ok === false ? 401 : 200), json: async () => currentResponse }; } };
  vm.runInNewContext(script, context);
  return { elements, requests, clipboard, timers, html, setResponse(value) { currentResponse = value; } };
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
  assert.equal(url, '/api/setup/status?lang=sw');
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
  assert.equal(h.requests[0].url, '/api/setup?lang=sw');
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

test('owner pairing is explicit, authenticated and keeps the one-use command out of URLs and request bodies', async () => {
  const owner = { bound: false, expectedUsername: 'drcharlestz' };
  const h = setupHarness({ ok: true, ready: true, owner }, 'en');
  assert.equal(h.elements['owner-pair'].hidden, true);
  assert.equal(h.elements['owner-command'].value, '');
  assert.equal(h.requests.length, 0);
  const key = 'operator-key-'.repeat(5);
  const command = '/claimowner public_test_pairing_code_1234567890';
  h.elements['setup-key'].value = key;
  await h.elements['owner-check'].listeners.click();
  assert.equal(h.requests[0].url, '/api/setup/status?lang=en');
  assert.equal(h.elements['owner-pair'].hidden, false);
  h.setResponse({ ok: true, owner, pairing: { command, expiresAt: Math.floor(Date.now() / 1000) + 600, username: 'drcharlestz' } });
  await h.elements['owner-pair'].listeners.click();
  const request = h.requests[1];
  assert.equal(request.url, '/api/setup/owner?lang=en');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, `Bearer ${key}`);
  assert.equal(request.options.body, JSON.stringify({ action: 'pair' }));
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.cache, 'no-store');
  assert.equal(request.options.redirect, 'error');
  assert.equal(h.elements['owner-command'].value, command);
  assert.equal(h.elements['owner-pairing'].hidden, false);
  assert.match(h.elements['owner-expiry'].textContent, /10 minutes/);
  assert.match(h.elements['owner-feedback'].textContent, /@drcharlestz/);
  assert.ok(h.timers[0].delay > 0 && h.timers[0].delay <= 600000);
  await h.elements['owner-copy'].listeners.click();
  assert.deepEqual(h.clipboard, [command]);
  assert.equal(h.elements['owner-command'].innerHTML, undefined);
  assert.doesNotMatch(h.html, /public_test_pairing_code|localStorage|sessionStorage/);
});

test('verified owner binding replaces pairing with the authenticated ID and private workflow', async () => {
  const h = setupHarness({ ok: true, ready: true, owner: { bound: false, expectedUsername: 'drcharlestz' } });
  h.elements['setup-key'].value = 's'.repeat(64);
  await h.elements['check-status'].listeners.click();
  assert.equal(h.elements['owner-pair'].hidden, false);
  h.setResponse({ ok: true, owner: { bound: false, expectedUsername: 'drcharlestz' }, pairing: { command: '/claimowner public_test_code_1234567890', expiresAt: Math.floor(Date.now() / 1000) + 600, username: 'drcharlestz' } });
  await h.elements['owner-pair'].listeners.click();
  h.setResponse({ ok: true, ready: true, owner: { bound: true, userId: '123456789', expectedUsername: 'drcharlestz' } });
  await h.elements['owner-check'].listeners.click();
  assert.equal(h.elements['owner-pair'].hidden, true);
  assert.equal(h.elements['owner-pairing'].hidden, true);
  assert.equal(h.elements['owner-command'].value, '');
  assert.equal(h.elements['owner-bound'].hidden, false);
  assert.match(h.elements['owner-bound'].textContent, /@drcharlestz.*123456789/);
  assert.match(h.elements['owner-next'].textContent, /\/updates.*\/broadcast/);
  assert.match(h.elements['owner-feedback'].textContent, /Haiwezi kubadilishwa/);
  assert.equal(h.timers[0].cleared, true);
  assert.doesNotMatch(h.html, /123456789/);
});

test('pairing commands clear at expiry or key changes and owner errors never echo provider content', async () => {
  const h = setupHarness({ ok: true, owner: { bound: false, expectedUsername: 'drcharlestz' }, pairing: { command: '/claimowner public_test_code_1234567890', expiresAt: Math.floor(Date.now() / 1000) + 600, username: 'drcharlestz' } }, 'en');
  h.elements['setup-key'].value = 's'.repeat(64);
  await h.elements['owner-pair'].listeners.click();
  h.timers[0].handler();
  assert.equal(h.elements['owner-command'].value, '');
  assert.equal(h.elements['owner-pairing'].hidden, true);
  assert.match(h.elements['owner-feedback'].textContent, /expired/);
  await h.elements['owner-pair'].listeners.click();
  h.elements['setup-key'].listeners.input();
  assert.equal(h.elements['owner-command'].value, '');
  assert.equal(h.elements['owner-pair'].hidden, true);
  h.setResponse({ ok: false, httpStatus: 409, error: 'owner_bound', message: 'private-provider-information' });
  await h.elements['owner-pair'].listeners.click();
  assert.match(h.elements['owner-feedback'].textContent, /already connected/);
  assert.doesNotMatch(h.elements['owner-feedback'].textContent, /private-provider-information/);
  assert.equal(h.elements['owner-command'].value, '');
});

test('public copy explains owner product announcements and retention without exposing operator commands', () => {
  for (const [lang, title, retention] of [['sw', 'Taarifa za maboresho.', 'historia ya matangazo ya siku 30 zilizopita'], ['en', 'Product updates.', 'announcement history for the past 30 days']]) {
    const home = renderHome({ lang });
    const privacy = renderPrivacy(lang);
    assert.ok(home.includes(title));
    assert.ok(privacy.includes(retention));
    assert.match(privacy, lang === 'en' ? /delivery records are removed in scheduled batches; clearing a large backlog may take longer/ : /rekodi za kutuma za zamani huondolewa kwa awamu kwenye usafishaji uliopangwa; rekodi zikiwa nyingi/);
    for (const page of [home, privacy]) assert.doesNotMatch(page, /(?:^|[>\s])\/(?:claimowner|broadcast|updates)\b|\/api\/setup\/owner|owner-user-id/);
  }
});

test('privacy page describes per-group metadata without claiming to archive conversations', () => {
  const page = renderPrivacy('sw');
  assert.match(page, /haihifadhi nakala kamili za mazungumzo/);
  assert.match(page, /Historia hii hutenganishwa kwa kila group/);
  assert.match(page, /Telegram na Cloudflare/);
});

test('privacy discloses preferences, delivery records and retention in both languages', () => {
  for (const [lang, phrases] of [
    ['sw', ['chaguo la lugha', 'group alilochagua mwisho', 'ID ya ujumbe', 'bot hukagua upya', 'siku 7', 'siku 30', 'Idadi ya makosa hubaki mpaka admin aisafishe', 'haufuti matangazo yaliyotumwa Telegram']],
    ['en', ['private-chat language choice', 'last group selected', 'message ID', 'the bot checks again', '7 days', '30 days', 'Strike counts remain until an admin resets them', 'Language choices and group settings are kept', 'does not delete announcements already sent to Telegram']],
  ]) {
    const page = renderPrivacy(lang);
    for (const phrase of phrases) assert.ok(page.includes(phrase), phrase);
    assert.doesNotMatch(page, /BOT_TOKEN|SETUP_KEY|notification_delivery|admin_sessions|\/api\//);
  }
});

function simulatorHarness(lang = 'sw') {
  const html = renderHome({ username: 'sautilinkpilotbot', ready: true, lang });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const element = (dataset = {}) => ({
    dataset, textContent: '', hidden: false, disabled: false, attributes: {}, listeners: {},
    addEventListener(name, listener) { this.listeners[name] = listener; },
    setAttribute(name, value) { this.attributes[name] = value; },
  });
  const elements = Object.fromEntries([...html.matchAll(/id="(sim-[a-z-]+)"/g)].map(match => [match[1], element()]));
  const scenarios = ['blocked', 'allowed', 'forward', 'admin', 'linked'].map(scenario => element({ scenario }));
  const groups = ['A', 'B'].map(simGroup => element({ simGroup }));
  const stages = ['1', '2', '3'].map(stage => element({ stage }));
  let calls = 0;
  vm.runInNewContext(script, {
    document: {
      getElementById: id => elements[id],
      querySelectorAll: selector => ({ '[data-scenario]': scenarios, '[data-sim-group]': groups, '[data-stage]': stages })[selector],
    },
    fetch() { calls += 1; throw new Error('The simulator must stay local'); },
  });
  return {
    html, elements, stages, requests: () => calls,
    scenario: name => scenarios.find(button => button.dataset.scenario === name).listeners.click(),
    group: name => groups.find(button => button.dataset.simGroup === name).listeners.click(),
    run: () => elements['sim-run'].listeners.click(),
    reset: () => elements['sim-reset'].listeners.click(),
  };
}

test('simulator separates groups and caps the repeated-offense demonstration at permanent', () => {
  const h = simulatorHarness();
  assert.equal(h.elements['sim-count'].textContent, '0 / 3');
  h.run();
  assert.equal(h.elements['sim-count'].textContent, '1 / 3');
  assert.equal(h.elements['sim-outcome-title'].textContent, 'Ban ya saa 24.');
  assert.match(h.elements['sim-step-note'].textContent, /ban ya awali imeisha/);
  assert.match(h.elements['sim-announcement'].textContent, /\nSababu:/);
  h.run();
  assert.equal(h.elements['sim-outcome-title'].textContent, 'Ban ya siku 7.');
  h.scenario('forward');
  assert.equal(h.elements['sim-forward'].hidden, false);
  h.run();
  assert.equal(h.elements['sim-outcome-title'].textContent, 'Permanent ban.');
  assert.equal(h.elements['sim-run'].disabled, true);
  h.run();
  assert.equal(h.elements['sim-count'].textContent, '3 / 3');
  h.group('B');
  assert.equal(h.elements['sim-count'].textContent, '0 / 3');
  assert.equal(h.elements['sim-run'].disabled, false);
  h.run();
  assert.equal(h.elements['sim-count'].textContent, '1 / 3');
  h.group('A');
  assert.equal(h.elements['sim-count'].textContent, '3 / 3');
  assert.equal(h.elements['sim-count-b'].textContent, '1/3');
  assert.equal(h.requests(), 0);
});

test('simulator preserves strikes for whitelisted links, admins and linked channel examples', () => {
  const h = simulatorHarness();
  h.run();
  for (const scenario of ['allowed', 'admin', 'linked']) {
    h.scenario(scenario);
    h.run();
    assert.equal(h.elements['sim-outcome'].dataset.tone, 'allowed');
    assert.equal(h.elements['sim-count'].textContent, '1 / 3');
    assert.equal(h.elements['sim-announcement'].hidden, true);
  }
  assert.equal(h.elements['sim-forward'].hidden, false);
  h.reset();
  assert.equal(h.elements['sim-count-a'].textContent, '0/3');
  assert.equal(h.elements['sim-count-b'].textContent, '0/3');
  assert.equal(h.elements['sim-run'].disabled, false);
  assert.equal(h.elements['sim-outcome'].dataset.tone, 'idle');
  assert.equal(h.requests(), 0);
});

test('public visitor navigation hides owner setup and provides honest local demo and private bot guide', () => {
  const h = simulatorHarness();
  for (const anchor of ['jaribu', 'sheria', 'anza']) assert.ok(h.html.includes(`id="${anchor}"`));
  assert.match(h.html, /href="https:\/\/t\.me\/sautilinkpilotbot"/);
  assert.match(h.html, /Fungua menyu ya Pilot/);
  assert.match(h.html, /https:\/\/github\.com\/sautilink\/pilot/);
  assert.doesNotMatch(h.html, /href="\/setup|BOT_TOKEN|SETUP_KEY|D1 database|\/api\//);
  assert.match(h.html, /prefers-reduced-motion:reduce/);
  assert.match(h.html, /Haiunganishi Telegram/);
  assert.doesNotMatch(h.html, /(?:localStorage|sessionStorage)/);
});

test('both languages stay selected across public navigation and page-specific language switches', () => {
  for (const lang of ['en', 'sw']) {
    for (const [path, page] of [
      ['/', renderHome({ username: 'sautilinkpilotbot', ready: true, lang })],
      ['/privacy', renderPrivacy(lang)],
      ['/setup', renderSetup(lang)],
    ]) {
      assert.ok(page.includes(`<html lang="${lang}">`));
      for (const [locale, label] of [['en', 'English'], ['sw', 'Kiswahili']]) {
        assert.ok(page.includes(`href="${path}?lang=${locale}" lang="${locale}" hreflang="${locale}" aria-label="${label}"${locale === lang ? ' aria-current="page"' : ''}>${locale.toUpperCase()}</a>`));
      }
      for (const href of [`/?lang=${lang}`, `/?lang=${lang}#jaribu`, `/?lang=${lang}#sheria`, `/?lang=${lang}#anza`, `/privacy?lang=${lang}`]) assert.ok(page.includes(`href="${href}"`), href);
      assert.doesNotMatch(page, /(?:localStorage|sessionStorage)/);
      // The only links allowed to switch language are the explicit selectors.
      for (const match of page.matchAll(/<a\b[^>]*href="(\/[^"]*)"[^>]*>/g)) {
        const target = new URL(match[1], 'https://pilot.sautilink.com');
        if (!match[0].includes('hreflang=')) assert.equal(target.searchParams.get('lang'), lang, match[1]);
      }
    }
  }
  const english = renderHome({ username: 'sautilinkpilotbot', ready: true });
  assert.match(english, /https:\/\/t\.me\/sautilinkpilotbot\?startgroup=pilot/);
  assert.match(english, /Open the Pilot menu/);
  assert.doesNotMatch(english, /href="\/setup|BOT_TOKEN|SETUP_KEY|\/api\//);
});

test('English pages translate explanations and FAQs as well as headings', () => {
  const home = renderHome({ lang: 'en' }).replace(/<script>[\s\S]*?<\/script>|<style>[\s\S]*?<\/style>/g, '');
  for (const phrase of ['Your group.', 'Your Pilot.', 'Bot coming soon', 'Copy-pasted text and reuploaded media', 'The whitelist applies to links.', 'does not add them back automatically']) assert.ok(home.includes(phrase), phrase);
  assert.match(home, /Their strike history in that group remains until an admin resets it/);
  assert.match(home, /may also delete a member’s other messages/);
  assert.match(home, /An offense in Group A does not start you at the second penalty in Group B/);
  assert.match(home, /Example announcement · Not a real event/);
  assert.doesNotMatch(home, /\?startgroup=|Group lako|Pilot wako|Chagua ujumbe|Maswali ya kawaida|Hapana\./);
  const privacy = renderPrivacy('en');
  assert.match(privacy, /does not store full copies of conversations/);
  assert.match(privacy, /This history is separate for each group/);
  assert.match(privacy, /Service operators can access moderation records/);
  assert.match(privacy, /Telegram and Cloudflare/);
});

test('English demo translates messages, decisions and time progression without changing moderation', () => {
  const h = simulatorHarness('en');
  assert.equal(h.elements['sim-outcome-title'].textContent, 'What will Pilot do?');
  assert.equal(h.elements['sim-message'].textContent, 'Join this offer:\nhttps://offers.example/today');
  h.run();
  assert.equal(h.elements['sim-outcome-title'].textContent, 'Banned for 24 hours.');
  assert.equal(h.elements['sim-announcement'].textContent, 'Juma has been banned for 24 hours.\nReason: Posting an unapproved link.');
  assert.match(h.elements['sim-step-note'].textContent, /previous ban has expired and Juma has rejoined/);
  h.run();
  assert.equal(h.elements['sim-outcome-title'].textContent, 'Banned for 7 days.');
  h.scenario('forward');
  assert.equal(h.elements['sim-forward'].textContent, 'Forwarded from example channel');
  h.run();
  assert.equal(h.elements['sim-outcome-title'].textContent, 'Permanent ban.');
  assert.match(h.elements['sim-announcement'].textContent, /permanently\.\nReason: Posting a forwarded message\./);
  assert.equal(h.elements['sim-run'].disabled, true);
  h.group('B');
  for (const [scenario, title] of [['allowed', 'Approved link. All clear.'], ['admin', 'Admins have permission.'], ['linked', 'Linked channel. All clear.']]) {
    h.scenario(scenario);
    h.run();
    assert.equal(h.elements['sim-outcome-title'].textContent, title);
    assert.equal(h.elements['sim-count'].textContent, '0 / 3');
  }
  assert.equal(h.requests(), 0);
});

test('English operator feedback preserves credential handling and key redaction', async () => {
  const h = setupHarness(undefined, 'en');
  assert.equal(h.requests.length, 0);
  assert.match(h.html, /Generate a secure key/);
  assert.match(h.html, /Connect Telegram/);
  assert.doesNotMatch(h.html, /<input[^>]+name=/);
  h.elements['setup-key'].value = 'too-short';
  await h.elements['check-status'].listeners.click();
  assert.equal(h.elements.feedback.textContent, 'SETUP_KEY must contain at least 32 characters.');
  assert.equal(h.requests.length, 0);
  h.elements['generate-key'].listeners.click();
  assert.match(h.elements['key-feedback'].textContent, /A new key was generated in your browser/);
  const key = h.elements['setup-key'].value;
  await h.elements['setup-form'].listeners.submit({ preventDefault() {} });
  assert.equal(h.requests[0].url, '/api/setup?lang=en');
  assert.equal(h.requests[0].options.headers.Authorization, `Bearer ${key}`);
  assert.equal(h.requests[0].options.body, '{}');
  assert.equal(h.elements.feedback.textContent, 'The bot is connected. You can try it in a test supergroup.');
  const failure = setupHarness({ ok: false, error: `Invalid key ${key}` }, 'en');
  failure.elements['setup-key'].value = key;
  await failure.elements['check-status'].listeners.click();
  assert.equal(failure.requests[0].url, '/api/setup/status?lang=en');
  assert.equal(failure.elements.feedback.textContent, 'Invalid key [secret]');
});

test('unknown or untrusted locale values default to English without reflection', () => {
  for (const lang of [undefined, 'fr', '\"><script>alert(1)</script>']) {
    for (const page of [renderHome({ lang }), renderPrivacy(lang), renderSetup(lang)]) {
      assert.match(page, /<html lang="en">/);
      assert.match(page, /aria-label="English" aria-current="page">EN<\/a>/);
      assert.doesNotMatch(page, /<script>alert\(1\)<\/script>|lang="fr"/);
    }
  }
});


test('public pages render the shared icon artwork before JavaScript and load motion from this Worker', () => {
  for (const lang of ['en', 'sw']) {
    for (const page of [renderHome({ lang }), renderPrivacy(lang), renderSetup(lang)]) {
      const staticPage = page.replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style>[\s\S]*?<\/style>/g, '');
      assert.match(staticPage, /<body data-public-icons>/);
      assert.match(staticPage, /data-public-icon-intro><svg[^>]+data-public-icon=/);
      assert.match(staticPage, /class="global-links"[\s\S]*?class="public-icon public-icon--nav"/);
      assert.match(staticPage, /class="site-footer"[\s\S]*?data-public-icon=/);
      const scripts = [...page.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>/g)].map(match => match[0]);
      assert.equal(scripts.length, 2);
      assert.ok(scripts.every(script => /src="\/assets\/public-icons\//.test(script) && /\bdefer\b/.test(script)));
      assert.doesNotMatch(staticPage, /orbit-svg|hero-visual/);
    }
  }
  const home = renderHome({ ready: true, username: 'sautilinkpilotbot' });
  for (const tone of ['idle', 'blocked', 'allowed']) assert.ok(home.includes(`outcome-symbol--${tone}`));
  const h = simulatorHarness('en');
  h.run();
  assert.equal(h.elements['sim-run-label'].textContent, 'Show the next offense');
  assert.equal(h.elements['sim-outcome'].dataset.tone, 'blocked');
  assert.equal(h.requests(), 0);
});
