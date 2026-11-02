import {escapeHtml} from './policy.js';

// Keep all placeholders explicit. Templates are text (not arbitrary HTML)
// except for a deliberately generated, escaped Telegram user mention.
export const WELCOME_TAGS=Object.freeze([
  'user','name','first_name','last_name','username','user_id',
  'mention','user_mention','group','group_name','group_id',
  'rules','rules_link','group_link','bot_username','member_count','date','time'
]);
export const WELCOME_DEFAULTS=Object.freeze({
  sw:'Karibu {mention}! ✨\nUmejiunga na {group_name}.\n\n{rules}',
  en:'Welcome {mention}! ✨\nYou joined {group_name}.\n\n{rules}',
});
export const WELCOME_DELETE_OPTIONS=Object.freeze([0,60,300,900,3600,86400]);

// Reused by preview and admin validation, no network-side data in saved copy.
export function validateWelcomeTemplate(value,max=1800) {
  if(typeof value!=='string'||value.length>max||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) throw new TypeError('invalid_template');
  const rest=value.replace(/\{([^{}]*)\}/g,(_,key)=>{
    if(!WELCOME_TAGS.includes(key)) throw new TypeError('invalid_template');
    return '';
  });
  if(/[{}]/.test(rest)) throw new TypeError('invalid_template');
  return value.trim();
}
export function fillTemplate(template,values,maxLength=3500) {
  const text=String(template || '').replace(/\{([a-z_]+)\}/g,(token,key)=>Object.hasOwn(values,key) ? String(values[key] ?? '') : token);
  return text.length>maxLength ? text.slice(0,maxLength-1).replace(/[\uD800-\uDBFF]$/,'')+'…' : text;
}
export function memberName(user,language='sw') {
  return [user?.first_name,user?.last_name].filter(Boolean).join(' ').slice(0,160) || (language==='en' ? 'Member' : 'Mtumiaji');
}
function safePart(value,max=300) {
  return String(value??'').slice(0,max).replace(/[\uD800-\uDBFF]$/,'');
}
export function welcomeValues({user,chat,bot,language='sw',rules='',memberCount,now=new Date()}={}) {
  const name=memberName(user,language);
  const handle=/^[a-zA-Z0-9_]{5,32}$/.test(user?.username||'')?'@'+user.username:'—';
  const botName=/^[a-zA-Z0-9_]{5,32}$/.test(bot?.username||'')?'@'+bot.username:'@sautilinkpilotbot';
  const groupName=safePart(chat?.title||'Group',128);
  const groupLink=/^[a-zA-Z0-9_]{5,32}$/.test(chat?.username||'')?'https://t.me/'+chat.username:'';
  const rulesLink='https://t.me/'+botName.slice(1)+'?start=rules';
  const date=now instanceof Date&&!Number.isNaN(now.getTime())?now:new Date(0);
  const stamp=new Intl.DateTimeFormat(language==='en'?'en-GB':'sw-TZ',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}).format(date);
  const time=new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'UTC'}).format(date)+' UTC';
  const id=Number.isSafeInteger(user?.id)&&user.id>0?String(user.id):'';
  return {
    user:name,name,first_name:safePart(user?.first_name,100),last_name:safePart(user?.last_name,100),
    username:handle,user_id:id,mention:name,user_mention:name,
    group:groupName,group_name:groupName,group_id:String(chat?.id||''),
    rules:safePart(rules,2400),rules_link:rulesLink,group_link:groupLink,
    bot_username:botName,member_count:Number.isSafeInteger(memberCount)&&memberCount>=0?String(memberCount):'—',
    date:stamp,time
  };
}
// Escape each interpolated part BEFORE constructing a Telegram HTML mention;
// no admin-supplied HTML, URL, member name or group title is trusted.
export function renderWelcome(template,values,{userId,maxLength=3500}={}) {
  const raw=String(template||'');
  const safeId=Number.isSafeInteger(Number(userId))&&Number(userId)>0?Number(userId):null;
  const token=/\{([a-z_]+)\}/g;
  const segments=[],plainParts=[];
  let position=0,match;
  while((match=token.exec(raw))) {
    const before=raw.slice(position,match.index);
    segments.push({text:before});plainParts.push(before);
    const label=String(values[match[1]]??'');
    if(['mention','user_mention'].includes(match[1])&&safeId) segments.push({text:label,mention:safeId});
    else segments.push({text:label});
    plainParts.push(label);
    position=match.index+match[0].length;
  }
  const trailing=raw.slice(position);segments.push({text:trailing});plainParts.push(trailing);
  // Allocate whole characters and close each entity. Telegram counts decoded
  // text length, but bound serialized HTML too to avoid oversized requests.
  let html='',plain='',length=0;
  for(const segment of segments){
    let chunk=String(segment.text);
    if(length>=maxLength)break;
    chunk=chunk.slice(0,maxLength-length).replace(/[\uD800-\uDBFF]$/,'');
    let encoded=escapeHtml(chunk);
    if(segment.mention) encoded='<a href="tg://user?id='+segment.mention+'">'+encoded+'</a>';
    if(html.length+encoded.length>12000) break;
    html+=encoded;plain+=chunk;length+=chunk.length;
  }
  return {html,plain};
}
export function publicGroupRules(settings,language='sw') {
  const base=language==='en'
    ? 'First prohibited link: delete and tag with a warning. Repeated links: no-post restrictions 1h → 12h → 24h → 3d → 7d, then bans 24h → 7d → permanent. Forward-only messages use the existing ban rules.'
    : 'Link ya kwanza isiyoruhusiwa: futa na tag kwa onyo. Links zinazofuata: restrictions za kutopost saa 1 → 12 → 24 → siku 3 → 7, kisha bans saa 24 → siku 7 → permanent. Forward-only zinafuata sheria za ban.';
  const commands=settings?.command_spam_enabled!==false
    ? language==='en'
      ? 'Unapproved long /command-only spam is silently deleted. No ban, mute or strike is added. Normal bot commands remain allowed.'
      : 'Spam ya /command ndefu zisizoruhusiwa hufutwa kimya kimya. Hakuna ban, mute wala kosa linaloongezwa. Commands za kawaida zinaruhusiwa.'
    : '';
  const extra=settings?.[`rules_${language==='en'?'en':'sw'}`];
  return [base,commands,extra].filter(Boolean).join('\n\n');
}
