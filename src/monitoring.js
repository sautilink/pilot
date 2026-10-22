import {createStore} from './store.js';
import {createControlStore} from './control-store.js';
import {createGuardrailStore} from './guardrail-store.js';
import {escapeHtml} from './policy.js';
import {createToolsStore} from './tools-store.js';

const admin=value=>['creator','administrator'].includes(value?.status);
const LABELS={
  en:{missing_permissions:'Pilot needs its delete/restrict admin permissions restored.',join_permissions:'Join screening needs the Invite Users admin permission.',notice_delivery:'A moderation announcement was not confirmed as delivered.',moderation_review:'A moderation action needs an administrator to review its outcome.',paused:'Moderation is paused for this group.',flood_action_failed:'An anti-flood action needs review.',command_spam_action_failed:'Deletion of a command-spam message could not be confirmed. No restriction was applied for this filter.',welcome_delivery_failed:'A welcome message could not be confirmed.'},
  sw:{missing_permissions:'Pilot inahitaji kurejeshewa ruhusa za kufuta ujumbe na kuzuia members.',join_permissions:'Ukaguzi wa wanaojiunga unahitaji ruhusa ya Invite Users.',notice_delivery:'Tangazo la moderation halijathibitishwa kufika.',moderation_review:'Hatua ya moderation inahitaji admin akague matokeo yake.',paused:'Moderation imesitishwa kwenye group hili.',flood_action_failed:'Hatua ya anti-flood inahitaji ukaguzi.',command_spam_action_failed:'Ufutaji wa ujumbe wa spam ya commands haujathibitishwa. Kichujio hiki hakijaweka restriction yoyote.',welcome_delivery_failed:'Ujumbe wa kukaribisha haujathibitishwa kufika.'},
};

export async function operationalHealth(db,now=Math.floor(Date.now()/1000)) {
  const guards=createGuardrailStore(db),store=createStore(db),control=createControlStore(db);
  await Promise.all([guards.ensure(),store.ensureExtras(),control.ensure()]);
  const counts=await guards.first('SELECT COUNT(*) AS total,SUM(CASE WHEN enabled=0 THEN 1 ELSE 0 END) AS paused FROM groups');
  const notices=await guards.first("SELECT COUNT(*) AS total FROM notification_delivery WHERE status IN ('failed','unknown') OR (status IN ('sending','pending') AND updated_at<?)",now-600);
  const review=await guards.first("SELECT COUNT(*) AS total FROM incidents WHERE status IN ('uncertain','failed','review','channel_review') AND created_at>?",now-30*86400);
  return {groups:Number(counts?.total || 0),pausedGroups:Number(counts?.paused || 0),noticeIssues:Number(notices?.total || 0),reviewIncidents:Number(review?.total || 0),lastMonitorAt:Number(await store.setting('monitoring_last_run') || 0),lastMonitorError:await store.setting('monitoring_last_error') || null};
}

/** Only opted-in admins receive reports. Re-check their role before every send.
 * A delivery is claimed before Telegram: a lost response never creates duplicates.
 */
export async function runMonitoring({db,api,clock=()=>Math.floor(Date.now()/1000),limit=12}) {
  const store=createStore(db),control=createControlStore(db),guards=createGuardrailStore(db),now=clock();
  await Promise.all([store.ensureExtras(),control.ensure(),guards.ensure(),createToolsStore(db).ensure()]);
  if(await store.setting('ready')!=='1') return {status:'not_ready'};
  const lease=now+540;
  const claim=await store.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(settings.value AS INTEGER)<=?','monitoring_lease',String(lease),now);
  if(!(claim.meta?.changes ?? claim.changes ?? 0)) return {status:'busy'};
  let processed=0,sent=0;
  try {
    const bot=await api.call('getMe');
    try {
      const webhook=await api.call('getWebhookInfo');
      await guards.health('0','webhook_error',Boolean(webhook.last_error_date && now-webhook.last_error_date<3600),now);
      await guards.health('0','webhook_backlog',Number(webhook.pending_update_count)>100,now);
    } catch {await guards.health('0','webhook_unavailable',true,now);}
    const cursor=await store.setting('monitoring_cursor') || '';
    const select="SELECT * FROM pilot_subscriptions WHERE (alerts_enabled=1 OR report_frequency!='off') AND (chat_id || '|' || user_id)>? ORDER BY (chat_id || '|' || user_id) LIMIT ?";
    let subscriptions=await guards.all(select,cursor,Math.min(30,Math.max(1,limit)));
    if(!subscriptions.length && cursor) subscriptions=await guards.all(select,'',Math.min(30,Math.max(1,limit)));
    const groupCache=new Map();
    for(const subscription of subscriptions) {
      const {chat_id:chat,user_id:user}=subscription;
      processed++;
      let role;
      try {role=await api.call('getChatMember',{chat_id:Number(chat),user_id:Number(user)});} catch {continue;}
      if(!admin(role)) {
        await guards.run('UPDATE pilot_subscriptions SET alerts_enabled=0,report_frequency=\'off\',updated_at=? WHERE chat_id=? AND user_id=?',now,chat,user);
        continue;
      }
      let group=groupCache.get(chat);
      if(!group) {
        try {
          const own=await api.call('getChatMember',{chat_id:Number(chat),user_id:bot.id});
          const info=await api.call('getChat',{chat_id:Number(chat)}),state=await store.group(chat),settings=await control.settings(chat);
          await guards.health(chat,'missing_permissions',!admin(own) || !own.can_delete_messages || !own.can_restrict_members,now);
          await guards.health(chat,'join_permissions',settings.join_gate_enabled && (!admin(own) || !own.can_invite_users),now);
          await guards.health(chat,'paused',!state.enabled,now,'info');
          const delivery=await store.latestNotice(chat);
          await guards.health(chat,'notice_delivery',Boolean(delivery && (['failed','unknown'].includes(delivery.status) || ['sending','pending'].includes(delivery.status) && delivery.updated_at<now-600)),now);
          const review=await guards.first("SELECT id FROM incidents WHERE chat_id=? AND status IN ('uncertain','failed','review','channel_review') AND created_at>? LIMIT 1",chat,now-86400);
          await guards.health(chat,'moderation_review',Boolean(review),now);
          const raid=await guards.first('SELECT a.id FROM pilot_raid_alerts a JOIN pilot_raid_settings s ON s.chat_id=a.chat_id WHERE a.chat_id=? AND s.enabled=1 AND a.created_at>? LIMIT 1',chat,now-600);
          await guards.health(chat,'raid_activity',Boolean(raid),now);
          group={title:info.title || 'Group',state};groupCache.set(chat,group);
        } catch {continue;}
      }
      const language=await store.getLanguage('user',user),en=language==='en';
      if(subscription.alerts_enabled) {
        const events=await guards.all('SELECT kind,created_at FROM pilot_health_events WHERE chat_id=? AND resolved_at=0 ORDER BY kind',chat);
        if(events.length) {
          // A new incident can alert immediately; a persistent issue at most daily.
          const signature=events.map(event=>`${event.kind}:${event.created_at}`).join(',');
          const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature));
          const digest=Array.from(new Uint8Array(bytes)).slice(0,8).map(byte=>byte.toString(16).padStart(2,'0')).join('');
          const last=await guards.first("SELECT attempted_at FROM pilot_admin_deliveries WHERE user_id=? AND chat_id=? AND kind='alert' ORDER BY attempted_at DESC LIMIT 1",user,chat);
          if(!last || last.attempted_at<=now-3600) {
            const id=`alert:${chat}:${user}:${digest}:${Math.floor(now/86400)}`;
            const lines=events.map(event=>`• ${LABELS[language][event.kind] || (en?'A Pilot action needs review.':'Hatua ya Pilot inahitaji ukaguzi.')}`);
            const text=[en?'🛡 Pilot · Admin alert':'🛡 Pilot · Taarifa kwa admin',group.title,'',...lines,'',en?'Open /dashboard for the current status. You can turn these alerts off with /alerts off.':'Fungua /dashboard kuona hali ya sasa. Unaweza kuzima taarifa hizi kwa /alerts off.'].join('\n');
            if(await deliver({id,user,chat,kind:'alert',text,language})) sent++;
          }
        }
      }
      const period=subscription.report_frequency==='daily'?86400:subscription.report_frequency==='weekly'?7*86400:0;
      if(period && now-Math.max(subscription.last_report_at,subscription.updated_at)>=period) {
        // Group timezone is fixed to EAT for readable day boundaries.
        const periodKey=Math.floor((now+3*3600)/period),id=`report:${chat}:${user}:${subscription.report_frequency}:${periodKey}`;
        const report=await guards.first("SELECT COUNT(*) AS incidents,SUM(CASE WHEN status='confirmed' THEN 1 ELSE 0 END) AS confirmed,SUM(CASE WHEN reasons LIKE '%\"link\"%' THEN 1 ELSE 0 END) AS links,SUM(CASE WHEN reasons LIKE '%\"forward\"%' THEN 1 ELSE 0 END) AS forwards FROM incidents WHERE chat_id=? AND created_at>=?",chat,now-period);
        const pending=await guards.first("SELECT COUNT(*) AS total FROM pilot_appeals WHERE chat_id=? AND status='open'",chat);
        const label=period===86400?(en?'24-hour report':'Ripoti ya saa 24'):(en?'7-day report':'Ripoti ya siku 7');
        const text=[`✈️ Pilot · ${label}`,group.title,'',`${en?'Incidents':'Matukio'}: ${report.incidents || 0}`,`${en?'Confirmed bans':'Ban zilizothibitishwa'}: ${report.confirmed || 0}`,`${en?'Link violations':'Makosa ya link'}: ${report.links || 0}`,`${en?'Forward violations':'Makosa ya forward'}: ${report.forwards || 0}`,`${en?'Pending appeals':'Rufaa zinazosubiri'}: ${pending.total || 0}`,'',en?'Open /dashboard for details. /report off stops these reports.':'Fungua /dashboard kwa maelezo. /report off inasimamisha ripoti hizi.'].join('\n');
        if(await deliver({id,user,chat,kind:'report',text,language})) sent++;
        // Retry of the cron must not deliver an uncertain report again.
        await guards.run('UPDATE pilot_subscriptions SET last_report_at=? WHERE chat_id=? AND user_id=?',now,chat,user);
      }
    }
    const last=subscriptions.at(-1);
    await store.settings({monitoring_cursor:last?`${last.chat_id}|${last.user_id}`:'',monitoring_last_run:now,monitoring_last_error:''});
    return {status:'complete',processed,sent};
  } catch {
    await store.settings({monitoring_last_error:'monitoring_unavailable'}).catch(()=>{});
    return {status:'unavailable',processed,sent};
  } finally {
    await store.run('DELETE FROM settings WHERE key=? AND value=?','monitoring_lease',String(lease)).catch(()=>{});
  }

  async function deliver({id,user,chat,kind,text,language}) {
    // Verify again at the delivery boundary; never fall back to the public group.
    let role;
    try {role=await api.call('getChatMember',{chat_id:Number(chat),user_id:Number(user)});} catch {return false;}
    if(!admin(role)) return false;
    const claimed=await guards.run("INSERT OR IGNORE INTO pilot_admin_deliveries(id,user_id,chat_id,kind,status,attempted_at) VALUES(?,?,?,?,'sending',?)",id,user,chat,kind,clock());
    if(!(claimed.meta?.changes ?? claimed.changes ?? 0)) return false;
    try {
      const sent=await api.call('sendMessage',{chat_id:Number(user),text:escapeHtml(text),parse_mode:'HTML',link_preview_options:{is_disabled:true},reply_markup:{inline_keyboard:[[{text:language==='en'?'Open dashboard':'Fungua dashboard',web_app:{url:`https://pilot.sautilink.com/app?lang=${language}`}}]]}});
      const confirmed=Number.isSafeInteger(sent?.message_id);
      await guards.run('UPDATE pilot_admin_deliveries SET status=?,telegram_message_id=? WHERE id=?',confirmed?'sent':'unknown',sent?.message_id ?? null,id);
      return confirmed;
    } catch(error) {
      const state=error.ambiguous===false?'failed':'unknown',kind=error.code===403?'private_chat_unavailable':error.code===429?'rate_limit':state==='unknown'?'delivery_unknown':'telegram_rejected';
      await guards.run('UPDATE pilot_admin_deliveries SET status=?,error_kind=? WHERE id=?',state,kind,id);
      if(error.code===403 && error.ambiguous===false) await guards.run("UPDATE pilot_subscriptions SET alerts_enabled=0,report_frequency='off',updated_at=? WHERE user_id=? AND chat_id=?",clock(),user,chat);
      return false;
    }
  }
}
