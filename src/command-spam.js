// A narrow, delete-only classifier for the long slash codes that are repeatedly
// copied into groups. It never treats every slash command as spam and never
// decides whether a third-party bot really implements a command.
const MAX_RULES = 20;
const MAX_RULE_CHARS = 2000;
const tokenPattern = /^\/([A-Za-z0-9_]+)(?:@([A-Za-z0-9_]+))?$/;
const rulePattern = /^\/([A-Za-z0-9_]{1,128})(\*)?(?:@([A-Za-z0-9_]{5,32}))?$/;

/** Names are case-sensitive (opaque codes can be case-sensitive); bot targets
 * are case-insensitive. A targetless rule covers only targetless commands.
 * Wildcards apply only to a deliberately chosen command-name prefix.
 */
export function normalizeCommandExceptions(value) {
  if (typeof value !== 'string') throw new TypeError('Invalid command exceptions');
  if (value.length > MAX_RULE_CHARS) throw new RangeError('Too many command exceptions');
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length > MAX_RULES) throw new RangeError('Too many command exceptions');
  const normalized = [];
  for (const line of lines) {
    const match = rulePattern.exec(line);
    if (!match || match[2] && (match[1].length < 3 || match[1].length > 32)
      || match[3] && !/bot$/i.test(match[3])) throw new TypeError('Invalid command exception');
    const rule = `/${match[1]}${match[2] || ''}${match[3] ? `@${match[3].toLowerCase()}` : ''}`;
    if (!normalized.includes(rule)) normalized.push(rule);
  }
  return normalized.join('\n');
}

function exceptions(value) {
  try {
    const normalized = normalizeCommandExceptions(value);
    return normalized ? normalized.split('\n').map(line => {
      const [, name, wildcard, target] = rulePattern.exec(line);
      return { name, prefix: !!wildcard, target: target || '' };
    }) : [];
  } catch {
    // Corrupt configuration must not become an unrestricted wildcard.
    return [];
  }
}

function codeExample(entities, offset, length) {
  return Array.isArray(entities) && entities.some(entity => ['code', 'pre'].includes(entity?.type)
    && Number.isSafeInteger(entity.offset) && Number.isSafeInteger(entity.length)
    && entity.offset >= 0 && entity.length > 0
    && entity.offset <= offset && entity.offset + entity.length >= offset + length);
}

function inspect(text, entities, rules, source) {
  if (typeof text !== 'string' || !text || text.length > 16384) return null;
  const tokens = [...text.matchAll(/\S+/g)];
  if (!tokens.length) return null;
  // A normal command may legitimately accept another slash-prefixed code as
  // an argument (for example a media bot's /play /file_code...).
  const first = tokenPattern.exec(tokens[0][0]);
  if (first && first[1].length <= 32 && tokens.length > 1) return null;
  let count = 0, longest = 0;
  for (const token of tokens) {
    const match = tokenPattern.exec(token[0]);
    // Ordinary sentences, file paths and command arguments are not this rule's
    // target. Examine the complete token instead of trusting a possibly shorter
    // Telegram bot_command entity boundary.
    if (!match) return null;
    const [, name, target = ''] = match;
    if (name.length <= 32 || codeExample(entities, token.index, token[0].length)) continue;
    if (rules.some(rule => rule.target === target.toLowerCase()
      && (rule.prefix ? name.startsWith(rule.name) : name === rule.name))) continue;
    count++;
    longest = Math.max(longest, name.length);
  }
  // Deliberately return metadata only: raw command codes are never audited.
  return count ? { source, count, longest } : null;
}

export function detectCommandSpam(message, allowlist = '') {
  const rules = exceptions(allowlist);
  return inspect(message?.text, message?.entities, rules, 'text')
    || inspect(message?.caption, message?.caption_entities, rules, 'caption');
}
