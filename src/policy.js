/** Pure moderation rules. Administrator and linked-channel exemptions belong upstream. */

const TELEGRAM_HANDLES = new Set([
  "techhubtz",
  "sautilink",
  "sautilink_cloud",
  "drcharlesofficial",
]);

const LEGACY_FORWARD_FIELDS = [
  "forward_from",
  "forward_from_chat",
  "forward_from_message_id",
  "forward_signature",
  "forward_sender_name",
  "forward_date",
];

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const UNSAFE_URL_CHARACTERS = /[\s\p{Cc}\p{Cf}\\]/u;

// Explicit schemes include non-HTTP links (for example tg:// and ftp://), which
// are detected but never whitelisted. Ordinary emails and phone numbers are not
// links under this policy unless Telegram supplies an actual hyperlink entity.
const SCHEME_LINK = /(?<![\p{L}\p{N}_])[a-z][a-z0-9+.-]*:\/\/[^\s<>"'`\u2018\u2019\u201c\u201d]+/giu;
const DOMAIN_LINK = /(?<![\p{L}\p{N}_@.-])(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+(?:[\p{L}]{2,63}|xn--[a-z0-9-]{2,59})(?::[0-9]+)?(?:[/?#][^\s<>"'`\u2018\u2019\u201c\u201d]*)?(?![\p{L}\p{N}_@-]|\.[\p{L}\p{N}_-])/giu;

/**
 * Match the actual destination, never a substring of its display label.
 * Bare domains use HTTPS; explicit HTTP and other protocols stay forbidden.
 */
export function isAllowedUrl(value) {
  if (typeof value !== "string") return false;
  const raw = value.trim();
  if (!raw || UNSAFE_URL_CHARACTERS.test(raw) || raw.startsWith("//")) return false;

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  const authority = candidate.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i)?.[1];
  // Empty credentials and percent-escaped hostnames are ambiguous spellings,
  // even where URL() would normalize them to a trusted destination.
  if (!authority || /[@%]/.test(authority)) return false;

  let url;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    return false;
  }

  const hostname = url.hostname.toLowerCase();
  if (hostname.length > 253 || !hostname.split(".").every((label) => DNS_LABEL.test(label))) {
    return false;
  }
  if (hostname === "sautilink.com" || hostname.endsWith(".sautilink.com")) return true;
  if (hostname !== "t.me") return false;

  // Validate the original path as well as URL()'s interpretation. Dot segments
  // or encoded separators must not broaden an exact Telegram-channel rule.
  const path = candidate.match(/^[a-z][a-z0-9+.-]*:\/\/[^/?#]*([^?#]*)/i)?.[1] || "/";
  const match = path.match(/^\/(?:s\/)?([a-z0-9_]+)(?:\/([0-9]+))?\/?$/i);
  return Boolean(match && TELEGRAM_HANDLES.has(match[1].toLowerCase()));
}

function stripSentencePunctuation(value) {
  let result = value.replace(/[.,;:!?\u3002\uff0c\uff1b\uff01\uff1f]+$/u, "");
  const pairs = [["(", ")"], ["[", "]"], ["{", "}"]];
  let previous;
  do {
    previous = result;
    for (const [open, close] of pairs) {
      while (result.endsWith(close)) {
        const opened = result.split(open).length - 1;
        const closed = result.split(close).length - 1;
        if (closed <= opened) break;
        result = result.slice(0, -1);
      }
    }
    result = result.replace(/[.,;:!?\u3002\uff0c\uff1b\uff01\uff1f]+$/u, "");
  } while (result !== previous);
  return result;
}

function maskRanges(text, ranges) {
  if (!ranges.length) return text;
  const sorted = ranges.sort((a, b) => a[0] - b[0]);
  let result = "";
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (end <= cursor) continue;
    result += text.slice(cursor, Math.max(cursor, start));
    result += " ".repeat(end - Math.max(cursor, start));
    cursor = end;
  }
  return result + text.slice(cursor);
}

function entityRange(entity, text) {
  const { offset, length } = entity;
  if (!Number.isInteger(offset) || !Number.isInteger(length) || offset < 0 || length <= 0) return null;
  const end = offset + length;
  return end <= text.length ? [offset, end] : null;
}

/** Return unique link destinations found directly in this message. */
export function detectLinks(message) {
  const found = new Set();
  if (!message || typeof message !== "object") return [];

  const add = (value) => {
    if (typeof value === "string" && value.trim()) found.add(value.trim());
  };

  const inspectText = (value, entities) => {
    if (typeof value !== "string") return;
    const ranges = [];
    for (const entity of Array.isArray(entities) ? entities : []) {
      if (!entity || typeof entity !== "object") continue;
      const range = entityRange(entity, value);
      if (entity.type === "text_link") {
        add(entity.url);
        if (range) ranges.push(range);
      } else if (entity.type === "url" && range) {
        // Telegram measures these offsets in UTF-16 code units, as JS slice does.
        add(value.slice(range[0], range[1]));
        ranges.push(range);
      } else if (["email", "mention", "text_mention", "phone_number"].includes(entity.type) && range) {
        ranges.push(range);
      }
    }

    const plain = maskRanges(value, ranges);
    const explicitRanges = [];
    for (const match of plain.matchAll(SCHEME_LINK)) {
      add(stripSentencePunctuation(match[0]));
      explicitRanges.push([match.index, match.index + match[0].length]);
    }
    // Do not mistake a domain in an existing URL's query/path for a second link.
    const withoutExplicitLinks = maskRanges(plain, explicitRanges);
    for (const match of withoutExplicitLinks.matchAll(DOMAIN_LINK)) {
      const prefix = withoutExplicitLinks.slice(Math.max(0, match.index - 2), match.index) === "//" ? "//" : "";
      add(stripSentencePunctuation(prefix + match[0]));
    }
  };

  inspectText(message.text, message.entities);
  inspectText(message.caption, message.caption_entities);

  const keyboard = message.reply_markup?.inline_keyboard;
  for (const row of Array.isArray(keyboard) ? keyboard : []) {
    for (const button of Array.isArray(row) ? row : []) {
      if (!button || typeof button !== "object") continue;
      add(button.url);
      add(button.login_url?.url);
      add(button.web_app?.url);
    }
  }

  const poll = message.poll;
  if (poll && typeof poll === "object") {
    inspectText(poll.question, poll.question_entities);
    inspectText(poll.explanation, poll.explanation_entities);
    inspectText(poll.description, poll.description_entities);
    for (const option of Array.isArray(poll.options) ? poll.options : []) {
      inspectText(option?.text, option?.text_entities);
    }
  }
  return [...found];
}

export function analyzeMessage(message) {
  const blockedLinks = detectLinks(message).filter((value) => !isAllowedUrl(value));
  const reasons = [];
  if (blockedLinks.length) reasons.push("link");
  if (message && typeof message === "object" && (
    message.forward_origin != null || LEGACY_FORWARD_FIELDS.some((field) => message[field] != null)
  )) {
    reasons.push("forward");
  }
  return { reasons, blockedLinks };
}

/** Zero means a permanent ban, never a zero-length temporary ban. */
export function banDuration(strike) {
  if (!Number.isSafeInteger(strike) || strike < 1) throw new RangeError("Strike count must be a positive integer");
  return strike === 1 ? 86400 : strike === 2 ? 604800 : 0;
}

export function escapeHtml(value) {
  const replacements = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  return String(value ?? "").replace(/[&<>"']/g, (character) => replacements[character]);
}
