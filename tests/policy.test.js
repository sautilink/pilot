import test from "node:test";
import assert from "node:assert/strict";
import { analyzeMessage, banDuration, detectLinks, escapeHtml, isAllowedUrl, normalizeWhitelistRule, explainUrl } from "../src/policy.js";

test("whitelist accepts HTTPS SautiLink hosts and normal paths", () => {
  for (const url of [
    "https://sautilink.com", "https://sautilink.com/", "https://www.sautilink.com/news?a=1#top",
    "https://staff.sautilink.com/path", "https://a.b.sautilink.com/path", "HTTPS://SAUTILINK.COM/path",
    "https://sautilink.com:443/path", "sautilink.com", "www.sautilink.com/path", "staff.sautilink.com:443/a",
    "https://sautilink.com/habari-za-leo/😀", "https://sautilink.com/?next=https://elsewhere.example",
  ]) assert.equal(isAllowedUrl(url), true, url);
});

test("whitelist accepts only the four Telegram destinations and their posts", () => {
  for (const handle of ["techhubtz", "sautilink", "sautilink_cloud", "drcharlesofficial"]) {
    for (const path of [`/${handle}`, `/${handle}/`, `/${handle}/123`, `/s/${handle}`, `/s/${handle}/123/`]) {
      assert.equal(isAllowedUrl(`https://t.me${path}`), true, path);
    }
  }
  assert.equal(isAllowedUrl("t.me/SAUTILINK/123?single#photo"), true);
});

test("whitelist rejects lookalike hosts, credentials, unsupported ports and protocols", () => {
  for (const url of [
    "https://sautilink.com.evil.test", "https://evil-sautilink.com", "https://sautilinkcom.evil.test",
    "https://evil.test@sautilink.com", "https://@sautilink.com", "https://sautilink.com@evil.test",
    "https://user:password@sautilink.com", "https://sautilink.com:444/", "https://t.me:80/sautilink",
    "http://sautilink.com", "ftp://sautilink.com", "tg://resolve?domain=sautilink", "javascript:sautilink.com",
    "https:sautilink.com", "//sautilink.com", "https://%73autilink.com", "https://sautilink.com./",
    "https://a..sautilink.com", "https://-a.sautilink.com", "https://a-.sautilink.com", "https://a_b.sautilink.com",
    `https://${"a".repeat(64)}.sautilink.com`, "https://sautilink.com\\@evil.test", "https://sau\ttilink.com",
    "https://sau\u200btilink.com", "https://sautilіnk.com", "https://192.168.1.1", "not a URL", "", null,
  ]) assert.equal(isAllowedUrl(url), false, String(url));
});

test("Telegram allowlist does not expand through suffixes, extra paths or encoded routes", () => {
  for (const url of [
    "https://t.me/other", "https://t.me/sautilink_scams", "https://t.me/sautilinkevil", "https://t.me/sautilink.com",
    "https://t.me/sautilink/abc", "https://t.me/sautilink/123/456", "https://t.me/sautilink//",
    "https://t.me/sautilink/../other", "https://t.me/other/../sautilink", "https://t.me/%73autilink",
    "https://t.me/sautilink%2f123", "https://t.me/s/sautilink/123/extra", "https://t.me/share?url=https://sautilink.com",
    "https://t.me/+sautilink", "https://t.me/joinchat/sautilink", "https://www.t.me/sautilink", "https://t.me.evil.test/sautilink",
  ]) assert.equal(isAllowedUrl(url), false, url);
});

test("URL entities use Telegram UTF-16 offsets after an emoji", () => {
  const text = "😀 Angalia https://evil.test/offer";
  const offset = text.indexOf("https://");
  const message = { text, entities: [{ type: "url", offset, length: text.length - offset }] };
  assert.deepEqual(detectLinks(message), ["https://evil.test/offer"]);
  assert.deepEqual(analyzeMessage(message), { reasons: ["link"], blockedLinks: ["https://evil.test/offer"] });
});

test("hidden links are judged by the actual destination, not the displayed label", () => {
  const text = "https://sautilink.com";
  assert.deepEqual(analyzeMessage({ text, entities: [{ type: "text_link", offset: 0, length: text.length, url: "https://evil.test" }] }), {
    reasons: ["link"], blockedLinks: ["https://evil.test"],
  });
  const misleadingLabel = "evil.test";
  assert.deepEqual(analyzeMessage({ text: misleadingLabel, entities: [{ type: "text_link", offset: 0, length: misleadingLabel.length, url: "https://sautilink.com" }] }), {
    reasons: [], blockedLinks: [],
  });
});

test("plain text detects multiple destinations, trims punctuation, and preserves allowed URLs", () => {
  const message = { text: "Visit https://sautilink.com, (https://evil.test/path). Or t.me/other!" };
  assert.deepEqual(detectLinks(message), ["https://sautilink.com", "https://evil.test/path", "t.me/other"]);
  assert.deepEqual(analyzeMessage(message), { reasons: ["link"], blockedLinks: ["https://evil.test/path", "t.me/other"] });
});

test("plain text supports bare domains, international domains and non-HTTPS schemes", () => {
  assert.deepEqual(analyzeMessage({ text: "sautilink.com/path www.evil.test/path habari.co.tz tg://resolve?domain=other ftp://evil.test/file" }), {
    reasons: ["link"], blockedLinks: ["tg://resolve?domain=other", "ftp://evil.test/file", "www.evil.test/path", "habari.co.tz"],
  });
  assert.deepEqual(analyzeMessage({ text: "Tembelea mfano.рф au https://例え.テスト" }).reasons, ["link"]);
});

test("generic emails, decimals, versions and normal conversation are not links", () => {
  const text = "Mr. X: bei ni 12.50, version 1.2.3.4. email first.last@example.com au user+tag@foo.co.tz. @sautilink habari njema!";
  assert.deepEqual(detectLinks({ text }), []);
  assert.deepEqual(analyzeMessage({ text }), { reasons: [], blockedLinks: [] });
});

test("domain in an allowed URL query is not treated as another destination", () => {
  const url = "https://sautilink.com/search?q=evil.example&next=https://other.example";
  assert.deepEqual(detectLinks({ text: url }), [url]);
  assert.deepEqual(analyzeMessage({ text: url }), { reasons: [], blockedLinks: [] });
});

test("protocol-relative links retain their scheme ambiguity instead of becoming allowed bare domains", () => {
  assert.deepEqual(analyzeMessage({ text: "Use //sautilink.com/path or //t.me/sautilink" }), {
    reasons: ["link"], blockedLinks: ["//sautilink.com/path", "//t.me/sautilink"],
  });
});

test("caption text and hidden caption links are inspected", () => {
  const caption = "😀 Bonyeza hapa";
  const message = { caption, caption_entities: [{ type: "text_link", offset: 3, length: caption.length - 3, url: "https://evil.test" }] };
  assert.deepEqual(analyzeMessage(message), { reasons: ["link"], blockedLinks: ["https://evil.test"] });
  assert.deepEqual(analyzeMessage({ caption: "https://t.me/sautilink/123" }).reasons, []);
});

test("inline keyboard destinations and login URLs are inspected without treating labels as links", () => {
  const message = { reply_markup: { inline_keyboard: [[
    { text: "evil.test", url: "https://sautilink.com" },
    { text: "Login", login_url: { url: "https://login.evil.test" } },
    { text: "Next", callback_data: "https://internal.example/id" },
    { text: "Open", web_app: { url: "https://app.evil.test" } },
  ]] } };
  assert.deepEqual(analyzeMessage(message), { reasons: ["link"], blockedLinks: ["https://login.evil.test", "https://app.evil.test"] });
});

test("poll questions, answers, descriptions and explanation destinations are inspected", () => {
  const message = { poll: {
    question: "Which? evil.test or sautilink.com", options: [{ text: "https://other.test" }, { text: "No" }],
    description: "https://t.me/sautilink", explanation: "read", explanation_entities: [{ type: "text_link", offset: 0, length: 4, url: "https://hidden.test" }],
  } };
  assert.deepEqual(analyzeMessage(message), { reasons: ["link"], blockedLinks: ["evil.test", "https://hidden.test", "https://other.test"] });
});

test("forward detection supports current and legacy fields without consulting the source allowlist", () => {
  assert.deepEqual(analyzeMessage({ text: "https://sautilink.com", forward_origin: { type: "channel", chat: { username: "sautilink" } } }), {
    reasons: ["forward"], blockedLinks: [],
  });
  for (const forward of [{ forward_origin: { type: "hidden_user" } }, { forward_date: 123 }, { forward_sender_name: "Name" }, { forward_from_chat: { id: -1001 } }]) {
    assert.deepEqual(analyzeMessage(forward).reasons, ["forward"]);
  }
});

test("a forbidden link and a forward are two reasons for one incident", () => {
  assert.deepEqual(analyzeMessage({ text: "https://evil.test", forward_origin: { type: "user" } }), {
    reasons: ["link", "forward"], blockedLinks: ["https://evil.test"],
  });
});

test("same-chat replies, quotes, external replies, and story attachments are not new forwards", () => {
  const message = {
    text: "Asante!", reply_to_message: { text: "https://evil.test", forward_origin: { type: "user" } },
    quote: { text: "https://evil.test" }, external_reply: { origin: { type: "channel" }, chat: { id: -100 } },
    story: { chat: { id: 123 }, id: 1 },
  };
  assert.deepEqual(analyzeMessage(message), { reasons: [], blockedLinks: [] });
});

test("an edited message uses the same detection rules and duplicate destinations appear once", () => {
  const text = "https://evil.test https://evil.test";
  const message = { text, edit_date: 12345, entities: [{ type: "url", offset: 0, length: 17 }] };
  assert.deepEqual(analyzeMessage(message), { reasons: ["link"], blockedLinks: ["https://evil.test"] });
});

test("malformed optional structures do not break moderation", () => {
  for (const message of [null, undefined, {}, { text: 123 }, { entities: [null] }, { text: "Hello", entities: [{ type: "url", offset: -1, length: 10 }] }, { reply_markup: { inline_keyboard: [null, [null]] } }, { poll: { options: [null] } }]) {
    assert.deepEqual(analyzeMessage(message), { reasons: [], blockedLinks: [] });
  }
});

test("ban durations follow the three strikes and invalid values cannot become permanent bans", () => {
  assert.equal(banDuration(1), 86400);
  assert.equal(banDuration(2), 604800);
  assert.equal(banDuration(3), 0);
  assert.equal(banDuration(100), 0);
  for (const strike of [0, -1, 1.5, NaN, Infinity, "1", undefined]) assert.throws(() => banDuration(strike), RangeError);
});

test("HTML escaping prevents sender names from injecting bot announcement markup", () => {
  assert.equal(escapeHtml('<a href="evil">A & B\'s</a>'), "&lt;a href=&quot;evil&quot;&gt;A &amp; B&#39;s&lt;/a&gt;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml("Juma 😀"), "Juma 😀");
});

test('additive domain and subdomain rules match hostname boundaries and preserve the base whitelist', () => {
  const rules = [{ id: 'exact', kind: 'domain', value: 'HTTPS://Example.COM:443/' }, { id: 'tree', kind: 'subdomains', value: 'school.test' }];
  assert.deepEqual(normalizeWhitelistRule(rules[0]), { kind: 'domain', value: 'example.com' });
  for (const value of ['https://example.com/path', 'https://school.test', 'https://a.school.test', 'https://a.b.school.test', 'https://sautilink.com', 'https://t.me/sautilink']) assert.equal(isAllowedUrl(value, rules), true, value);
  for (const value of ['https://www.example.com', 'https://example.com.evil.test', 'https://evil-school.test', 'https://school.test.evil.test', 'http://example.com', 'https://example.com:444', 'https://evil.test@example.com']) assert.equal(isAllowedUrl(value, rules), false, value);
  assert.equal(isAllowedUrl('https://example.com'), false, 'group rules do not leak into global policy');
});

test('exact URL rules preserve path, query and fragment specificity', () => {
  const rule = normalizeWhitelistRule({ kind: 'url', value: 'https://EXAMPLE.com:443/guide?version=1#part' });
  assert.deepEqual(rule, { kind: 'url', value: 'https://example.com/guide?version=1#part' });
  assert.equal(isAllowedUrl('example.com/guide?version=1#part', [rule]), true);
  for (const value of ['https://example.com/guide', 'https://example.com/guide?version=2#part', 'https://example.com/guide?version=1#other', 'https://example.com/guide/extra?version=1#part', 'https://example.com/other/../guide?version=1#part', 'https://example.com/%2e/guide?version=1#part']) assert.equal(isAllowedUrl(value, [rule]), false, value);
});

test('custom whitelist rejects ambiguous hosts, Unicode lookalikes and malformed rule shapes', () => {
  for (const value of ['http://example.com', 'https://user@example.com', 'https://%65xample.com', 'https://ｅxample.com', 'https://exаmple.com', 'https://xn--exmple-4nf.com', 'https://example.com.', 'https://example.com:444', 'https://192.168.1.1', 'localhost', 'https://a..example.com', '*.example.com', '//example.com']) assert.throws(() => normalizeWhitelistRule({ kind: 'domain', value }), TypeError, value);
  for (const value of ['https://example.com/path', 'https://example.com?x=1', 'https://example.com#x']) assert.throws(() => normalizeWhitelistRule({ kind: 'domain', value }), TypeError);
  for (const value of ['https://example.com/a/../b', 'https://example.com/%2e%2e/b', 'https://example.com/a%2fb']) assert.throws(() => normalizeWhitelistRule({ kind: 'url', value }), TypeError);
  for (const rule of [null, {}, { kind: 'regex', value: '.*' }, { kind: 'domain', value: 123 }]) assert.throws(() => normalizeWhitelistRule(rule), TypeError);
  assert.equal(isAllowedUrl('https://ｓａｕｔｉｌｉｎｋ.com'), false);
});

test('checker explains base and group matches without overriding forwarding policy', () => {
  const rules = [{ id: 'group-rule', kind: 'domain', value: 'example.com' }];
  assert.equal(explainUrl('https://sautilink.com', rules).source, 'base');
  const group = explainUrl('https://example.com/path', rules);
  assert.equal(group.allowed, true);
  assert.equal(group.reason, 'group_domain');
  assert.equal(group.matchedRule.id, 'group-rule');
  assert.equal(explainUrl('http://example.com', rules).reason, 'https_required');
  assert.equal(explainUrl('https://other.test', rules).reason, 'not_allowed');
  assert.deepEqual(analyzeMessage({ text: 'https://example.com', forward_origin: { type: 'hidden_user' } }, rules), { reasons: ['forward'], blockedLinks: [] });
  assert.equal(isAllowedUrl('https://other.test', [null, { kind: 'domain', value: 'other.test@evil.test' }]), false);
});
