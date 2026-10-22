export const DEFAULT_EVENT_TIMEZONE = 'Africa/Dar_es_Salaam';

export function validEventTimezone(value = DEFAULT_EVENT_TIMEZONE) {
  if (typeof value !== 'string' || value.length > 80 || !/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)*$/.test(value)) throw new Error('invalid_timezone');
  try { return new Intl.DateTimeFormat('en-GB', { timeZone: value }).resolvedOptions().timeZone; }
  catch { throw new Error('invalid_timezone'); }
}

// These two helpers are also serialized into the authenticated events UI.
export function eventLocalTime(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(Number(value) * 1000));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

export function eventTimestamp(value, timezone) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value || '')) throw new Error('invalid_time');
  const numeric = value.match(/\d+/g).map(Number), [year, month, day, hour, minute] = numeric;
  const naive = Date.UTC(year, month - 1, day, hour, minute);
  if (!Number.isFinite(naive) || new Date(naive).toISOString().slice(0, 16) !== value) throw new Error('invalid_time');
  let formatter;
  try { formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
  catch { throw new Error('invalid_timezone'); }
  const wall = at => { const p = Object.fromEntries(formatter.formatToParts(new Date(at)).map(item => [item.type, item.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
  const offsets = new Set();
  for (let delta = -36; delta <= 36; delta += 6) {
    const at = naive + delta * 3600000;
    offsets.add(Date.parse(wall(at) + ':00Z') - at);
  }
  const matches = [...offsets].map(offset => naive - offset).filter(at => wall(at) === value);
  if (matches.length !== 1) throw new Error(matches.length ? 'ambiguous_local_time' : 'invalid_time');
  return matches[0] / 1000;
}

const escapeValue = value => String(value || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const stamp = value => new Date(Number(value) * 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
function fold(line) {
  const encoder = new TextEncoder(), chunks = []; let current = '', bytes = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (bytes + size > 75) { chunks.push(current); current = ' '; bytes = 1; }
    current += character; bytes += size;
  }
  chunks.push(current); return chunks.join('\r\n');
}

export function eventCalendar(event, timezone = DEFAULT_EVENT_TIMEZONE) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SautiLink Corporation//Pilot Events//EN',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-TIMEZONE:${escapeValue(validEventTimezone(timezone))}`,
    'BEGIN:VEVENT', `UID:${event.id}@pilot.sautilink.com`, `DTSTAMP:${stamp(event.updated_at)}`,
    `DTSTART:${stamp(event.starts_at)}`, `DTEND:${stamp(event.ends_at)}`,
    `SEQUENCE:${Number(event.revision || 1)}`, `STATUS:${event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    `SUMMARY:${escapeValue(event.title)}`, `DESCRIPTION:${escapeValue(event.description)}`,
    ...(event.url ? [`URL:${event.url}`] : []), 'END:VEVENT', 'END:VCALENDAR', '',
  ];
  return { filename: `pilot-event-${event.id}.ics`, contentType: 'text/calendar; charset=utf-8', content: lines.map(fold).join('\r\n') };
}
