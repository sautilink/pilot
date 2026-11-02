import { classifyBanLookupFailure } from './ban-roster.js';
import { escapeHtml } from './policy.js';

// Interpret Telegram API failures for the verified administrator ONLY.
// Never echo raw provider errors or tokens, and never describe an unconfirmed
// Telegram mutation as successful.
export function classifyUnbanFailure(error) {
  if(error?.code === 'result_unconfirmed') return 'result_unconfirmed';
  if(error?.ambiguous === true) return 'telegram_unavailable';
  return classifyBanLookupFailure(error);
}

export function formatUnbanFailure(error,{language='sw',userId,groupTitle=''}={}) {
  const en=language==='en';
  const reason=classifyUnbanFailure(error);
  const reasons={
    user_unavailable:en?'Telegram cannot resolve this user ID.':'Telegram haiwezi kutambua ID ya mtumiaji huyu.',
    permission:en?'Telegram refused the bot permission to unban.':'Telegram imekataa ruhusa za bot za kuondoa ban.',
    rate_limited:en?'Telegram temporarily limited API requests.':'Telegram imeweka kikomo cha muda kwenye maombi ya API.',
    telegram_unavailable:en?'Telegram did not confirm whether the action succeeded.':'Telegram haijathibitisha kama hatua imefanikiwa.',
    result_unconfirmed:en?'Telegram did not confirm the unban result.':'Telegram haijathibitisha matokeo ya kuondoa ban.',
    unknown:en?'Telegram rejected or could not confirm the action.':'Telegram imekataa au haijathibitisha ombi.',
  };
  const shared=en
    ? 'No ban or strike was changed in Pilot. This response does not prove the ban is active or removed.'
    : 'Hakuna ban wala strike iliyobadilishwa kwenye rekodi za Pilot. Jibu hili halithibitishi ban ipo au imeondoka.';
  const manual=en
    ? 'For an existing ban, a group owner/admin can open the group in Telegram → Manage/Edit Group → Permissions → Removed Users/Banned Users, find the person by their real account/profile, and remove the ban manually. Names of menus may differ by device.'
    : 'Kama ban bado ipo, owner/admin afungue group kwenye Telegram → Manage/Edit Group → Permissions → Removed Users/Banned Users, atafute account halisi ya member na aiondoe ban mwenyewe. Majina ya menu yanaweza kutofautiana kwa simu.';
  const next=reason==='user_unavailable'
    ? (en
      ? 'Double-check that this is the member’s current numeric Telegram ID. If you cannot find the account, ask the member to open @sautilinkpilotbot privately and press Start, then check their identity again. This does not guarantee Telegram can unban that ID.'
      : 'Hakikisha ID ni ya account halisi ya member. Kama haionekani kwenye orodha, muombe afungue @sautilinkpilotbot faraghani na aguse Start, kisha kagua utambulisho wake tena. Hili halihakikishi Telegram itaweza kuondoa ban kwa ID ileile.')
    : reason==='permission'
      ? (en
        ? 'Run /doctor in the group and confirm Pilot is admin with Ban Users/Restrict Members permission. Then check the account in Telegram.'
        : 'Tumia /doctor kwenye group kuthibitisha Pilot ni admin na ina ruhusa ya Ban Users/Restrict Members. Kisha kagua account Telegram.')
      : reason==='rate_limited'
        ? (en
          ? 'Do not repeat the command rapidly. Check the account before trying again.'
          : 'Usirudie command mara nyingi kwa haraka. Hakiki hali ya account kabla ya kujaribu tena.')
        : (en
          ? 'Check the member’s real Telegram status and bot permissions before retrying. A lost API response may conceal an earlier success.'
          : 'Kagua hali halisi ya member na ruhusa za bot kabla ya kurudia. Jibu la API likipotea, huenda hatua ilikamilika bila uthibitisho.');
  const title=en?'⛔ Unban not confirmed':'⛔ Kuondoa ban hakujathibitishwa';
  const group=String(groupTitle).slice(0,100);
  const id=Number(userId);
  return [
    '<b>'+title+'</b>',
    ...(group?['<b>'+escapeHtml(group)+'</b>']:[]),
    (en?'Member ID: ':'ID ya member: ')+`<code>${Number.isSafeInteger(id)&&id>0?id:'—'}</code>`,
    '',
    reasons[reason]||reasons.unknown,
    shared,
    '',
    next,
    '',
    manual,
  ].join('\n');
}
