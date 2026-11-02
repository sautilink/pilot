// The Bot API has no method to enumerate all banned users. This bounded,
// read-only roster shows only identities Pilot previously recorded, verified
// individually against current Telegram membership. Never present it publicly.
const PAGE_SIZE=8;
const maxPage=1000;
const validChat=chat=>Number.isSafeInteger(Number(chat)) && Number(chat)<0;

export function createBanRoster({db,api,clock=()=>Math.floor(Date.now()/1000)}) {
  async function list(chatId,page=1) {
    if(!validChat(chatId) || !Number.isSafeInteger(page) || page<1 || page>maxPage) return {invalid:true};
    const candidateRows=await db.prepare(`SELECT user_id,active_until,strikes
      FROM members WHERE chat_id=? AND last_incident IS NOT NULL
      AND (active_until=-1 OR active_until>0)
      ORDER BY CASE WHEN active_until=-1 THEN 0 ELSE 1 END, user_id
      LIMIT ? OFFSET ?`).bind(String(chatId),PAGE_SIZE+1,(page-1)*PAGE_SIZE).all();
    const candidates=candidateRows.results || [];
    const visible=[],now=clock();
    let unavailable=0;
    for(const row of candidates.slice(0,PAGE_SIZE)) {
      const userId=Number(row.user_id);
      if(!Number.isSafeInteger(userId) || userId<=0) continue;
      let member;
      try {
        member=await api.call('getChatMember',{chat_id:Number(chatId),user_id:userId});
      } catch {
        unavailable++;
        continue;
      }
      if(member?.status!=='kicked') continue;
      const until=Number(member.until_date || 0);
      // Source attribution is tentative if Telegram no longer matches Pilot's
      // recorded expiry; a human admin may have replaced the original ban.
      const matches=Number(row.active_until)===-1 ? until===0 : until===Number(row.active_until);
      visible.push({
        userId,until,
        expired:until>0 && until<=now,
        matchesPilot:matches,
        strikes:Number(row.strikes || 0),
      });
    }
    return {invalid:false,page,visible,more:candidates.length>PAGE_SIZE,unavailable,checked:Math.min(PAGE_SIZE,candidates.length)};
  }
  return {list};
}

export function formatBanRoster(result,{language='sw',groupTitle=''}={}) {
  const en=language==='en';
  if(result.invalid) return en?'Invalid page. Use /bans or /bans 2.':'Ukurasa si sahihi. Tumia /bans au /bans 2.';
  const header=en?'🛡 Pilot · Known bans':'🛡 Pilot · Ban zinazojulikana';
  const lines=[`<b>${header}</b>`,`<b>${escapeHtml(String(groupTitle).slice(0,100))}</b>`,
    en?`Page ${result.page} · Telegram status checked for ${result.checked} stored records`
      :`Ukurasa ${result.page} · Hali ya Telegram imekaguliwa kwa rekodi ${result.checked}`,''];
  if(!result.visible.length) lines.push(en?'No confirmed banned members among these stored records.':'Hakuna member aliyethibitishwa kuwa banned kati ya rekodi hizi.');
  for(const row of result.visible) {
    const duration=row.until===0
      ? (en?'Permanent':'Kudumu')
      : row.expired
        ? (en?'Expired; Telegram still shows banned':'Muda umekwisha; Telegram bado inaonyesha ban')
        : new Date(row.until*1000).toISOString().slice(0,16).replace('T',' ')+' UTC';
    lines.push(`• <code>${row.userId}</code> — ${duration}${!row.matchesPilot?(en?' (changed outside Pilot)':' (imebadilishwa nje ya Pilot)'):''}`);
  }
  if(result.unavailable) lines.push('',en?`${result.unavailable} membership checks could not be verified.`:`Hali za members ${result.unavailable} hazikuweza kuthibitishwa.`);
  lines.push('',en?'Unban now in the group: <code>/unban USER_ID</code>':'Ondoa ban sasa ndani ya group: <code>/unban USER_ID</code>');
  if(result.more) lines.push(en?`Next: <code>/bans ${result.page+1}</code>`:`Ukurasa unaofuata: <code>/bans ${result.page+1}</code>`);
  lines.push('',en?'Only Pilot-recorded users are checked; this is not Telegram’s complete ban list.':'Hii si orodha kamili ya ban zote za Telegram; ni za users waliosajiliwa na Pilot tu.');
  return lines.join('\n');
}
import { escapeHtml } from './policy.js';
