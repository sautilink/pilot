import { createStore } from './store.js';
import { createGuardrailStore } from './guardrail-store.js';

// Reconcile Telegram timed bans only after verifying the original Pilot
// incident and exact Telegram deadline. Run inside the per-group DO queue.
const DUE = `FROM members m JOIN incidents i ON i.id=m.last_incident
WHERE m.active_until>0 AND m.active_until<=?
  AND i.chat_id=m.chat_id AND i.user_id=m.user_id
  AND i.status='confirmed' AND i.strike IN (1,2)
  AND i.until_date=m.active_until AND i.event_at>m.override_at`;
const validChat = chat => Number.isSafeInteger(Number(chat)) && Number(chat)<0;
const validUser = user => Number.isSafeInteger(Number(user)) && Number(user)>0;
const released = status => ['left','member','restricted','administrator','creator'].includes(status);

export function createBanExpiry({db,api,clock=()=>Math.floor(Date.now()/1000)}) {
  const store=createStore(db);
  const health=createGuardrailStore(db);
  const rows=async(sql,...args)=>(await db.prepare(sql).bind(...args).all()).results || [];

  // Persistent cursor prevents one stuck group starving other groups.
  async function dueGroups({limit=12}={}) {
    const now=clock(),max=Math.max(1,Math.min(20,limit));
    const cursor=await store.setting('ban_expiry_group_cursor') || '';
    const select=`SELECT DISTINCT m.chat_id ${DUE} AND m.chat_id>? ORDER BY m.chat_id LIMIT ?`;
    let groups=await rows(select,now,cursor,max);
    if(!groups.length && cursor) groups=await rows(select,now,'',max);
    await store.settings({ban_expiry_group_cursor:groups.at(-1)?.chat_id || '',ban_expiry_last_scan_at:now});
    return groups.map(row=>row.chat_id).filter(validChat);
  }

  async function expireGroup(chatId,{limit=8}={}) {
    if(!validChat(chatId) || !api) return {ok:false,status:'invalid_chat'};
    const chat=String(chatId),now=clock(),max=Math.max(1,Math.min(20,limit));
    const key=`ban_expiry_member_cursor:${chat}`;
    const cursor=await store.setting(key) || '';
    const select=`SELECT m.chat_id,m.user_id,m.active_until,m.last_incident ${DUE}
      AND m.chat_id=? AND m.user_id>? ORDER BY m.user_id LIMIT ?`;
    let candidates=await rows(select,now,chat,cursor,max);
    if(!candidates.length && cursor) candidates=await rows(select,now,chat,'',max);
    if(candidates.length) await store.settings({[key]:candidates.at(-1).user_id});
    else if(cursor) await store.settings({[key]:''});
    let unbanned=0,alreadyReleased=0,conflicts=0,failed=0;
    for(const candidate of candidates) {
      const {user_id:user,active_until:until,last_incident:incident}=candidate;
      if(!validUser(user)) continue;
      let live;
      try {
        live=await api.call('getChatMember',{chat_id:Number(chat),user_id:Number(user)});
      } catch {
        failed++; continue;
      }
      // until_date=0 or another deadline can mean a human has issued a
      // different (possibly permanent) ban. Never overrule that decision.
      if(live?.status==='kicked' && Number(live.until_date || 0)!==Number(until)) {
        conflicts++; console.warn('pilot_ban_expiry_membership_conflict'); continue;
      }
      if(live?.status!=='kicked' && !released(live?.status)) continue;
      const current=await store.first(`SELECT m.last_incident FROM members m
        JOIN incidents i ON i.id=m.last_incident
        WHERE m.chat_id=? AND m.user_id=? AND m.active_until=?
          AND m.last_incident=? AND i.status='confirmed' AND i.strike IN (1,2)
          AND i.until_date=? AND i.event_at>m.override_at`,chat,String(user),until,incident,until);
      if(!current) continue;
      if(live.status==='kicked') {
        try {
          const outcome=await api.call('unbanChatMember',{
            chat_id:Number(chat),user_id:Number(user),only_if_banned:true
          });
          if(outcome!==true) throw new Error('Unconfirmed temporary ban release');
          unbanned++;
        } catch {
          failed++; console.warn('pilot_ban_expiry_release_unavailable'); continue;
        }
      } else alreadyReleased++;
      // Preserve strikes and incident history for the 24h -> 7d -> permanent policy.
      await store.run('UPDATE members SET active_until=0 WHERE chat_id=? AND user_id=? AND active_until=? AND last_incident=?',
        chat,String(user),until,incident);
    }
    // Surface any stuck expiry to opted-in administrators, rather than leaving
    // a ban silently stuck. Clear it once no Pilot temporary ban remains due.
    if(failed || conflicts) await health.health(chat,'ban_expiry_review',true,clock());
    else {
      const pending=await rows(`SELECT m.user_id ${DUE} AND m.chat_id=? LIMIT 1`,clock(),chat);
      if(!pending.length) await health.health(chat,'ban_expiry_review',false,clock());
    }
    return {ok:true,checked:candidates.length,unbanned,alreadyReleased,conflicts,failed};
  }
  // Read-only admin diagnostic. Count only confirmed Pilot temporary bans,
  // never human/permanent cases. This is not proof of actual Telegram access.
  async function status(chatId) {
    if(!validChat(chatId)) return {lastScanAt:0,pending:null};
    const [lastScan, pending] = await Promise.all([
      store.setting('ban_expiry_last_scan_at'),
      db.prepare(`SELECT COUNT(*) AS count ${DUE} AND m.chat_id=?`)
        .bind(clock(),String(chatId)).first(),
    ]);
    return {lastScanAt:Number(lastScan || 0),pending:Number(pending?.count || 0)};
  }
  return {dueGroups,expireGroup,status};
}
