import { escapeHtml } from './policy.js';
import { fillTemplate } from './templates.js';

const CORPORATE_URL='https://www.sautilink.com/';
const CORPORATE_LABEL='from SautiLink Corporation';
const FOOTER_RICH=`<i>SautiLink Pilot · <a href="${CORPORATE_URL}">${CORPORATE_LABEL}</a></i>`;
const FOOTER_PLAIN=`SautiLink Pilot · ${CORPORATE_LABEL} (${CORPORATE_URL})`;

function displayName(message,language) {
  return [message.from?.first_name,message.from?.last_name].filter(Boolean).join(' ') || message.sender_chat?.title || (language==='en' ? 'Member' : 'Mtumiaji');
}

function expiry(until,language) {
  if(!until) return language==='en' ? 'Permanent ban' : 'Ban ya kudumu';
  return new Intl.DateTimeFormat(language==='en' ? 'en-GB' : 'sw-TZ',{
    timeZone:'Africa/Dar_es_Salaam',year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).format(new Date(until*1000)) + ' EAT';
}

export function formatAnnouncement(row,message,success=true,language='sw',settings={}) {
  const en=language==='en';
  const name=displayName(message,language);
  const reasons=JSON.parse(row.reasons).map(reason=>reason==='forward' ? (en ? 'Forwarded messages are not allowed.' : 'Ujumbe wa forward hauruhusiwi.') : (en ? 'The posted link is not allowed.' : 'Link iliyotumwa hairuhusiwi.'));
  const duration=row.strike===1 ? (en ? '24 hours' : 'Saa 24') : row.strike===2 ? (en ? '7 days' : 'Siku 7') : (en ? 'Permanent' : 'Kudumu');
  const identity=row.user_id ? `ID: ${Number(row.user_id)}` : (en ? 'Posted on behalf of a channel' : 'Ujumbe umetumwa kwa niaba ya channel');
  const title=success ? (en ? '⛔ MEMBER BANNED' : '⛔ MEMBER AMEFUNGIWA') : (en ? '🛡 MESSAGE REMOVED' : '🛡 UJUMBE UMEONDOLEWA');
  const labels=en ? {reason:'Reason',penalty:'Penalty',strike:'Offense',ends:'Ends',removed:'The message that broke the rules has been removed.',expires:'When the ban expires, the member can rejoin.',permanent:'An administrator must decide whether to lift this ban.',review:'The message was removed. A ban is not confirmed; an administrator should review the sender.'} : {reason:'Sababu',penalty:'Adhabu',strike:'Kosa',ends:'Mwisho',removed:'Ujumbe uliokiuka sheria umeondolewa.',expires:'Ban ikiisha, mtumiaji anaweza kujiunga tena.',permanent:'Kuondoa ban kunahitaji uamuzi wa admin.',review:'Ujumbe umeondolewa. Ban haijathibitishwa; admin akague mtumaji.'};
  const body=success
    ? [name,identity,'',`${labels.reason}: ${reasons.join(' ')}`,`${labels.penalty}: ${duration}`,`${labels.strike}: ${row.strike} / 3`,`${labels.ends}: ${expiry(row.until_date,language)}`,'',labels.removed,row.until_date ? labels.expires : labels.permanent]
    : [name,identity,'',`${labels.reason}: ${reasons.join(' ')}`,'',labels.review];
  let plain=[title,'',...body].join('\n');
  // A banned user is no longer a member. Names must not depend on tg:// mentions.
  let rich=[`<b>${title}</b>`,'',`<b>${escapeHtml(name)}</b>`,row.user_id ? `<code>${escapeHtml(identity)}</code>` : escapeHtml(identity),'',
    `<b>${labels.reason}</b>\n${reasons.map(reason=>`• ${escapeHtml(reason)}`).join('\n')}`,
    ...(success ? ['',`⏳ <b>${labels.penalty}:</b> ${duration}`,`📍 <b>${labels.strike}:</b> ${row.strike} / 3`,`🗓 <b>${labels.ends}:</b> ${escapeHtml(expiry(row.until_date,language))}`,'',`🗑 ${labels.removed}`,row.until_date ? labels.expires : labels.permanent] : ['',labels.review])].join('\n');
  if(success && settings.notice_template==='compact') {
    plain=[title,name,identity,`${labels.reason}: ${reasons.join(' ')}`,`${labels.penalty}: ${duration} · ${labels.strike}: ${row.strike}/3`,`${labels.ends}: ${expiry(row.until_date,language)}`,labels.removed].join('\n');
    rich=escapeHtml(plain);
  } else if(success && settings.notice_template==='formal') {
    const heading=en?'Moderation notice':'Taarifa ya usimamizi';
    plain=[`SautiLink Pilot · ${heading}`,'',name,identity,`${labels.reason}: ${reasons.join(' ')}`,`${labels.penalty}: ${duration}`,`${labels.strike}: ${row.strike} / 3`,`${labels.ends}: ${expiry(row.until_date,language)}`,'',labels.removed,row.until_date?labels.expires:labels.permanent].join('\n');
    rich=escapeHtml(plain);
  }
  const extra=settings[`notice_${en?'en':'sw'}`];
  if(extra) {
    const custom=fillTemplate(extra,{user:name,reason:reasons.join(' '),duration:success?duration:(en?'Review pending':'Ukaguzi unasubiri'),group:message.chat?.title || 'Group'},800);
    plain+=`\n\n${custom}`;rich+=`\n\n${escapeHtml(custom)}`;
  }
  // Keep the attribution last in every style, including custom admin text. The
  // plain fallback retains a usable URL without repeating rejected HTML.
  return {rich:`${rich}\n\n${FOOTER_RICH}`,plain:`${plain}\n\n${FOOTER_PLAIN}`};
}

export function noticeErrorKind(error) {
  if(error.ambiguous!==false) return 'delivery_unknown';
  if(error.code===429) return 'rate_limit';
  if(error.code===403) return 'send_permission';
  if(error.code===400 && /thread|topic/i.test(error.message || '')) return 'topic_unavailable';
  if(error.code===400) return 'message_rejected';
  return 'telegram_rejected';
}

export function createAnnouncer({store,api,clock,controlStore}) {
  async function notify(row,message,success=true) {
    const record=await store.noticeRecord(row.id,clock());
    if(!record || ['sent','unknown','failed','cancelled'].includes(record.status)) return false;
    if(record.status==='sending') {
      // A previous process may have sent the message before losing its response.
      await store.noticeState(row.id,'unknown',clock(),{errorKind:'delivery_unknown'});
      return false;
    }
    if(record.retry_at>clock()) return true;
    const language=await store.getLanguage('group',message.chat.id);
    const settings=controlStore ? await controlStore.settings(message.chat.id) : {};
    const {rich,plain}=formatAnnouncement(row,message,success,language,settings);
    let usePlain=false;
    let thread=message.is_topic_message && Number.isSafeInteger(message.message_thread_id) ? message.message_thread_id : null;
    for(let attempt=0;attempt<3;attempt++) {
      if(!await store.startNoticeAttempt(row.id,clock())) return false;
      try {
        const result=await api.call('sendMessage',{
          chat_id:message.chat.id,text:usePlain ? plain : rich,
          ...(!usePlain ? {parse_mode:'HTML',reply_markup:{inline_keyboard:[[{text:language==='en' ? '📖 Pilot rules' : '📖 Sheria za Pilot',url:'https://t.me/sautilinkpilotbot?start=rules'}]]}} : {}),
          link_preview_options:{is_disabled:true},...(thread ? {message_thread_id:thread} : {})
        });
        if(!Number.isSafeInteger(result?.message_id)) {
          await store.noticeState(row.id,'unknown',clock(),{errorKind:'delivery_unknown'});
          return false;
        }
        await store.noticeState(row.id,'sent',clock(),{messageId:result.message_id});
        return false;
      } catch(error) {
        const errorKind=noticeErrorKind(error);
        console.warn('pilot_notice_delivery',{incident_id:row.id,error_kind:errorKind,error_code:Number(error.code || 0)});
        if(errorKind==='delivery_unknown') {
          await store.noticeState(row.id,'unknown',clock(),{errorKind});
          return false;
        }
        if(errorKind==='rate_limit') {
          await store.noticeState(row.id,'pending',clock(),{retryAt:clock()+Math.max(1,Math.ceil(Number(error.retryAfter)||1)),errorKind});
          return true;
        }
        if(error.code===400 && attempt<2 && (thread && errorKind==='topic_unavailable' || !usePlain)) {
          if(thread && errorKind==='topic_unavailable') thread=null;
          else usePlain=true;
          // Telegram explicitly rejected this attempt, so a fallback cannot duplicate it.
          await store.noticeState(row.id,'pending',clock(),{errorKind});
          continue;
        }
        await store.noticeState(row.id,'failed',clock(),{errorKind});
        return false;
      }
    }
    return false;
  }
  return {notify};
}
