import { escapeHtml } from './policy.js';

// Telegram has no API for enumerating all banned members. Never describe this
// private, per-group list of Pilot-known users as the complete Telegram ban list.
const PAGE_SIZE = 8;
const MAX_PAGE = 1000;
const CHECK_CONCURRENCY = 3;
const validChat = chat => Number.isSafeInteger(Number(chat)) && Number(chat) < 0;
const validUser = user => Number.isSafeInteger(Number(user)) && Number(user) > 0;
const notBanned = new Set(['left', 'member', 'restricted', 'administrator', 'creator']);

export function createBanRoster({db, api, clock = () => Math.floor(Date.now() / 1000)}) {
  async function list(chatId, page = 1) {
    if (!validChat(chatId) || !Number.isSafeInteger(page) || page < 1 || page > MAX_PAGE) return {invalid:true};
    const now = clock();
    // Prioritize Pilot permanent and still-current temporary bans. Old expired
    // records must not bury more relevant cases on the first page.
    const stored = await db.prepare(`SELECT user_id,active_until,strikes
      FROM members WHERE chat_id=? AND last_incident IS NOT NULL
        AND (active_until=-1 OR active_until>0)
      ORDER BY CASE WHEN active_until=-1 THEN 0 WHEN active_until>? THEN 1 ELSE 2 END,
        CASE WHEN active_until>0 THEN active_until ELSE 0 END DESC, user_id
      LIMIT ? OFFSET ?`).bind(String(chatId),now,PAGE_SIZE+1,(page-1)*PAGE_SIZE).all();
    const candidates = (stored.results || []).slice(0,PAGE_SIZE);
    const visible = [], unverified = [];
    let released = 0;
    // Unlike sequential eight-second Telegram calls, each small group runs
    // concurrently. The cap prevents bursts and respects rate limiting.
    for (let offset = 0; offset < candidates.length; offset += CHECK_CONCURRENCY) {
      const outcomes = await Promise.all(candidates.slice(offset,offset+CHECK_CONCURRENCY).map(async row => {
        const userId = Number(row.user_id);
        if (!validUser(userId)) return {kind:'unknown',userId:null,until:Number(row.active_until)};
        let member;
        try {
          member = await api.call('getChatMember',{chat_id:Number(chatId),user_id:userId});
        } catch {
          return {kind:'unknown',userId,until:Number(row.active_until)};
        }
        if (member?.status === 'kicked') {
          const until = Number(member.until_date);
          if (!Number.isSafeInteger(until) || until < 0) return {kind:'unknown',userId,until:Number(row.active_until)};
          const storedUntil = Number(row.active_until);
          const name = [member.user?.first_name,member.user?.last_name].filter(value => typeof value === 'string').join(' ').slice(0,72).trim();
          return {kind:'banned',userId,until,
            expired:until>0 && until<=now,
            matchesPilot:storedUntil===-1 ? until===0 : until===storedUntil,
            strikes:Number(row.strikes || 0),name};
        }
        if (notBanned.has(member?.status)) return {kind:'released'};
        return {kind:'unknown',userId,until:Number(row.active_until)};
      }));
      for (const result of outcomes) {
        if (result.kind === 'banned') {
          const {kind,...row} = result; visible.push(row);
        } else if (result.kind === 'unknown') {
          if (validUser(result.userId)) unverified.push({userId:result.userId,until:result.until});
        } else released++;
      }
    }
    return {
      invalid:false,page,visible,unverified,released,
      unavailable:unverified.length,checked:candidates.length,
      more:(stored.results || []).length>PAGE_SIZE
    };
  }
  return {list};
}

export function formatBanRoster(result,{language='sw',groupTitle=''}={}) {
  const en = language==='en';
  if(result.invalid) return en?'Invalid page. Use /bans or /bans 2.':'Ukurasa si sahihi. Tumia /bans au /bans 2.';
  const unknown = result.unverified || [];
  const unavailable = Number(result.unavailable || 0);
  const noLonger = Number(result.released || 0);
  const header = en?'🛡 Pilot · Ban status':'🛡 Pilot · Hali ya ban';
  const lines = [`<b>${header}</b>`,`<b>${escapeHtml(String(groupTitle).slice(0,100))}</b>`,
    en?`Page ${result.page} · ${result.checked} Pilot records checked with Telegram`
      :`Ukurasa ${result.page} · Rekodi ${result.checked} za Pilot zimekaguliwa Telegram`,
    en?`Banned now: ${result.visible.length} · Not banned: ${noLonger} · Unverified: ${unavailable}`
      :`Bado banned: ${result.visible.length} · Hawajabaniwa: ${noLonger} · Haijathibitishwa: ${unavailable}`,''];
  if(!result.visible.length) lines.push(en?'No bans confirmed by Telegram on this page.':'Hakuna ban iliyothibitishwa na Telegram kwenye ukurasa huu.');
  for(const row of result.visible) {
    const duration = row.until===0
      ? (en?'Permanent':'Kudumu')
      : row.expired
        ? (en?'Expired, but Telegram still reports a ban':'Muda umeisha, lakini Telegram bado inaonyesha ban')
        : new Date(row.until*1000).toISOString().slice(0,16).replace('T',' ')+' UTC';
    const name = row.name ? ` · ${escapeHtml(row.name)}` : '';
    lines.push(`• <code>${row.userId}</code>${name} — ${duration}${!row.matchesPilot?(en?' (changed outside Pilot)':' (imebadilishwa nje ya Pilot)'):''}`);
  }
  if (unknown.length) {
    lines.push('',en?'<b>Could not verify in Telegram (NOT confirmed banned):</b>':'<b>Haijathibitishwa Telegram (SIYO ban iliyothibitishwa):</b>');
    for(const row of unknown) {
      const stored = row.until===-1 ? (en?'Pilot record: permanent':'Rekodi ya Pilot: kudumu')
        : row.until>0 ? (en?'Pilot record until':'Rekodi ya Pilot hadi')+' '+new Date(row.until*1000).toISOString().slice(0,16).replace('T',' ')+' UTC'
        : (en?'Pilot record':'Rekodi ya Pilot');
      lines.push(`• <code>${row.userId}</code> — ${stored}`);
    }
    lines.push(en?'Telegram could not confirm these users. Check bot permissions or retry /bans; do not assume the ban is active or removed.':'Telegram haikuweza kuthibitisha users hawa. Kagua ruhusa za bot au rudia /bans; usidhani ban ipo au imeondoka.');
  } else if (unavailable) {
    lines.push('',en?`${unavailable} membership checks could not be verified.`:`Hali za members ${unavailable} hazikuweza kuthibitishwa.`);
  }
  lines.push('',en?'Remove a ban in the group: <code>/unban USER_ID</code>':'Ondoa ban ndani ya group: <code>/unban USER_ID</code>');
  if(result.more) lines.push(en?`Next page: <code>/bans ${result.page+1}</code>`:`Ukurasa unaofuata: <code>/bans ${result.page+1}</code>`);
  lines.push('',en?'Telegram has no full ban-list API; only Pilot-recorded IDs were checked.':'Telegram haina API ya orodha kamili ya ban; tumekagua ID zilizorekodiwa na Pilot tu.');
  return lines.join('\n');
}
