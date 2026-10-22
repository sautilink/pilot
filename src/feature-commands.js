import { escapeHtml } from './policy.js';
import { dashboardButton } from './bot-ui.js';

export const FEATURE_COMMANDS = new Set(['dashboard', 'checklink', 'mystatus', 'appeal', 'history', 'appeals', 'settings', 'stats', 'alerts', 'report', 'whitelist']);
export const ADMIN_FEATURE_COMMANDS = new Set(['history', 'appeals', 'settings', 'stats', 'alerts', 'report', 'whitelist']);

const safe = value => escapeHtml(String(value ?? ''));
const trim = (value, length) => String(value ?? '').slice(0, length);
const preview = (value, limit) => {
  let result = '';
  for (const character of String(value ?? '')) {
    const escaped = safe(character);
    if (result.length + escaped.length > limit - 1) return result + '…';
    result += escaped;
  }
  return result;
};
const date = (value, language) => Number.isFinite(Number(value)) && Number(value) > 0
  ? new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'sw-TZ', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Dar_es_Salaam' }).format(Number(value) * 1000) + ' EAT'
  : '—';
const count = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;

const labels = {
  sw: {
    app: '✦ Fungua Pilot', home: '⌂ Mwanzo', unavailable: 'Taarifa hazipatikani kwa sasa. Jaribu tena baada ya muda.',
    denied: 'Unahitaji kuwa owner au admin wa group hili. Tuma /admin ndani ya group unalosimamia ili kuchagua group.',
    choose: '🛡 <b>Chagua group lako</b>\n\nTuma /admin ndani ya group unalosimamia, kisha fungua kiungo utakachopewa. Unaweza pia kuchagua group ulilounganisha kwenye Pilot hapa chini.',
    dashboard: '✦ <b>Pilot iko tayari</b>\n\nFungua paneli kuona taarifa zako, kukagua link au kutuma rufaa. Wasimamizi wanaweza pia kuona matukio, mipangilio na taarifa za groups zao.\n\nKila taarifa ya group inahitaji uthibitisho wa admin wa group hilo.',
    checkTitle: '🔎 <b>Kikagua link</b>', checkUsage: 'Tuma <code>/checklink https://example.com</code> hapa faraghani.\n\nKikagua hutumia sheria za Pilot bila kutembelea tovuti. Kwa sheria za group fulani, chagua group kwenye paneli kisha ufungue kikagua.',
    baseScope: 'Sheria za msingi za Pilot', groupScope: 'Sheria za group ulilochagua', noLinks: 'Sijaona link kwenye maandishi hayo. Tuma anwani kamili, kwa mfano https://sautilink.com.',
    allowed: 'Inaruhusiwa', blocked: 'Hairuhusiwi', baseAllowed: 'Ipo kwenye orodha ya msingi ya links zinazoruhusiwa.', groupAllowed: 'Inalingana na ruhusa ya ziada ya group.', rejected: 'Haipo kwenye links zinazoruhusiwa au anwani haijakubalika.',
    checkFoot: 'Huu ni ukaguzi wa sheria za link, si uthibitisho wa usalama wa tovuti. Forward bado inavunja sheria hata ikiwa link inaruhusiwa.',
    moreLinks: 'Fungua paneli kukagua maelezo zaidi.', tooLong: 'Maandishi ni marefu sana. Tuma hadi herufi 4,096.',
    myTitle: '📂 <b>Matukio yangu</b>', myEmpty: 'Hakuna tukio lako linalopatikana kwenye historia ya hivi karibuni.', myFoot: 'Taarifa hizi ni zako pekee. Kutuma rufaa hakubadili ban moja kwa moja; admin wa group ndiye huamua.',
    case: 'Tukio', group: 'Group', member: 'Mtumiaji', strike: 'Kosa', reason: 'Sababu', ban: 'Ban', at: 'Tarehe', permanent: 'Ya kudumu', hours: 'saa 24', days: 'siku 7', until: 'Hadi',
    link: 'link isiyoruhusiwa', forward: 'forwarded message', otherReason: 'ukaguzi wa sheria',
    confirmed: 'Hatua imethibitishwa', cancelled: 'Hatua imesitishwa', failed: 'Hatua haikukamilika', planned: 'Inasubiri uthibitisho', corrected: 'Kosa limerekebishwa',
    notice: 'Tangazo', noticeSent: 'limetumwa', noticePending: 'linasubiri', noticeUnknown: 'halijathibitishwa', noticeFailed: 'halikutumwa', noticeCancelled: 'limesitishwa',
    appeal: 'Rufaa', appealOpen: 'inasubiri admin', appealResolved: 'imepitiwa', appealUsage: '📝 <b>Omba ukaguzi wa tukio</b>\n\nFungua /mystatus kupata ID ya tukio lako, kisha tuma:\n<code>/appeal ID_YA_TUKIO maelezo yako</code>\n\nAndika sababu kwa herufi zisizozidi 1,000. Kila tukio linapokea rufaa moja. Unaweza pia kutumia fomu kwenye paneli.',
    noCase: 'Tukio hilo halipatikani kwenye historia yako ya hivi karibuni. Fungua /mystatus kuangalia matukio yako.',
    appealSent: '📝 <b>Rufaa imehifadhiwa</b>\n\nAdmin wa group anaweza kuipitia kwenye paneli yake. Ban iliyopo itaendelea mpaka iishe au admin aibadilishe.',
    appealDuplicate: 'Rufaa ya tukio hili tayari ipo. Fungua /mystatus au paneli kuangalia hali yake.',
    appealLength: 'Andika sababu yenye herufi 1 hadi 1,000 baada ya ID ya tukio.',
    appealRate: 'Subiri angalau dakika moja kati ya rufaa. Unaweza kutuma hadi rufaa tatu kwa siku; angalia rufaa zilizopo kwenye /mystatus.',
    historyTitle: '📋 <b>Matukio ya group</b>', historyEmpty: 'Hakuna tukio kwenye historia ya hivi karibuni.', historyFoot: 'Paneli ina historia zaidi, hali ya matangazo na hatua za ukaguzi.',
    appealsTitle: '📝 <b>Rufaa za group</b>', appealsEmpty: 'Hakuna rufaa ya hivi karibuni.', appealsFoot: 'Fungua paneli kusoma rufaa na kufanya uamuzi. Kuondoa ban huhifadhi makosa; kurekebisha kosa moja huhifadhi ban iliyopo.',
    statsTitle: '▥ <b>Takwimu za group</b>', today: 'Leo', week: 'Siku 7', month: 'Siku 30', incidents: 'matukio', bansConfirmed: 'hatua zilizothibitishwa', links: 'links', forwards: 'forwards',
    settingsTitle: '⚙ <b>Mipangilio ya group</b>', enabled: 'imewashwa', disabled: 'imezimwa', language: 'Lugha', welcome: 'Karibu kwa wanachama', flood: 'Udhibiti wa ujumbe mwingi', commandSpam: 'Spam ya commands · futa tu', joins: 'Ukaguzi wa maombi ya kujiunga', settingsFoot: 'Fungua paneli kubadili mipangilio na exceptions za commands. Ufutaji wa code ndefu huanza ukiwa umewashwa: hakuna ban, mute wala kosa kwa code hizo. Admin anaweza kuzima kwa group hili.',
    whitelistTitle: '🔗 <b>Links za ziada zinazoruhusiwa</b>', whitelistEmpty: 'Hakuna ruhusa ya ziada. Orodha ya msingi ya SautiLink bado inatumika.', whitelistFoot: 'Ruhusa hizi zinatumika kwenye group hili pekee. Paneli inatofautisha URL moja, domain moja na domain pamoja na subdomains zake.', url: 'URL moja', domain: 'Domain moja', subdomains: 'Domain na subdomains',
    alertsTitle: '🔔 <b>Taarifa zako za admin</b>', alertsUsage: 'Tumia <code>/alerts on</code> kuwasha taarifa za matatizo au <code>/alerts off</code> kuzima. Zitatumwa kwako faraghani ukiendelea kuwa admin.', reportUsage: 'Tumia <code>/report daily</code>, <code>/report weekly</code> au <code>/report off</code>. Ripoti ni za group ulilochagua, na hutumwa kwako faraghani ukiendelea kuwa admin.', alerts: 'Taarifa za matatizo', report: 'Ripoti', off: 'zimezimwa', daily: 'kila siku', weekly: 'kila wiki', subscribed: 'Chaguo lako limehifadhiwa kwa group hili.',
    unknown: 'Ombi halijathibitishwa. Kagua hali kwenye paneli kabla ya kurudia hatua.',
  },
  en: {
    app: '✦ Open Pilot', home: '⌂ Home', unavailable: 'This information is unavailable right now. Please try again shortly.',
    denied: 'You need to be this group’s owner or an admin. Send /admin inside a group you manage to select it.',
    choose: '🛡 <b>Select your group</b>\n\nSend /admin inside a group you manage, then open the link you receive. You can also select a connected group in Pilot below.',
    dashboard: '✦ <b>Pilot is ready</b>\n\nOpen your panel to view your cases, check a link or submit an appeal. Admins can also review incidents, settings and reports for their groups.\n\nGroup information requires a fresh check of your admin role in that group.',
    checkTitle: '🔎 <b>Link checker</b>', checkUsage: 'Send <code>/checklink https://example.com</code> here privately.\n\nThe checker applies Pilot’s rules without visiting the website. To check a particular group’s rules, select that group in the panel and open the checker.',
    baseScope: 'Pilot’s base rules', groupScope: 'The selected group’s rules', noLinks: 'I could not find a link in that text. Send a complete address, such as https://sautilink.com.',
    allowed: 'Allowed', blocked: 'Not allowed', baseAllowed: 'Included in the base allowlist.', groupAllowed: 'Matches an additional allowance for this group.', rejected: 'Not on the allowlist, or the address is not accepted.',
    checkFoot: 'This checks the link policy; it does not verify website safety. A forwarded message still violates the forwarding rule, even when its link is allowed.',
    moreLinks: 'Open the panel for further details.', tooLong: 'The text is too long. Send up to 4,096 characters.',
    myTitle: '📂 <b>My cases</b>', myEmpty: 'You have no cases in the recent history.', myFoot: 'These records belong only to you. An appeal does not automatically change a ban; the group’s admin decides.',
    case: 'Case', group: 'Group', member: 'Member', strike: 'Strike', reason: 'Reason', ban: 'Ban', at: 'Date', permanent: 'Permanent', hours: '24 hours', days: '7 days', until: 'Until',
    link: 'unapproved link', forward: 'forwarded message', otherReason: 'rule review',
    confirmed: 'Action confirmed', cancelled: 'Action cancelled', failed: 'Action incomplete', planned: 'Awaiting confirmation', corrected: 'Strike corrected',
    notice: 'Announcement', noticeSent: 'sent', noticePending: 'pending', noticeUnknown: 'unconfirmed', noticeFailed: 'not sent', noticeCancelled: 'cancelled',
    appeal: 'Appeal', appealOpen: 'awaiting admin review', appealResolved: 'reviewed', appealUsage: '📝 <b>Request a case review</b>\n\nOpen /mystatus to find your case ID, then send:\n<code>/appeal CASE_ID your explanation</code>\n\nUse up to 1,000 characters for your reason. Each case accepts one appeal. You can also use the form in the panel.',
    noCase: 'That case is not in your recent history. Open /mystatus to find your cases.',
    appealSent: '📝 <b>Appeal saved</b>\n\nThe group’s admin can review it in their panel. An existing ban remains until it expires or an admin changes it.',
    appealDuplicate: 'An appeal already exists for this case. Open /mystatus or the panel to check its status.',
    appealLength: 'Write a reason of 1 to 1,000 characters after the case ID.',
    appealRate: 'Wait at least one minute between appeals. You may submit up to three appeals per day; check existing appeals with /mystatus.',
    historyTitle: '📋 <b>Group incidents</b>', historyEmpty: 'There are no recent incidents.', historyFoot: 'The panel includes more history, announcement status and review actions.',
    appealsTitle: '📝 <b>Group appeals</b>', appealsEmpty: 'There are no recent appeals.', appealsFoot: 'Open the panel to read appeals and decide. Removing a ban preserves strikes; correcting one strike keeps the existing ban.',
    statsTitle: '▥ <b>Group statistics</b>', today: 'Today', week: '7 days', month: '30 days', incidents: 'incidents', bansConfirmed: 'confirmed actions', links: 'links', forwards: 'forwards',
    settingsTitle: '⚙ <b>Group settings</b>', enabled: 'enabled', disabled: 'disabled', language: 'Language', welcome: 'Member welcome', flood: 'Flood control', commandSpam: 'Command spam · delete only', joins: 'Join request screening', settingsFoot: 'Open the panel to change settings and command exceptions. Long command code removal starts on: no ban, mute or strike for those codes. An admin can turn it off for this group.',
    whitelistTitle: '🔗 <b>Additional allowed links</b>', whitelistEmpty: 'No additional allowances yet. The SautiLink base allowlist still applies.', whitelistFoot: 'These allowances apply only to this group. The panel distinguishes one URL, one domain, and a domain with its subdomains.', url: 'One URL', domain: 'One domain', subdomains: 'Domain and subdomains',
    alertsTitle: '🔔 <b>Your admin notifications</b>', alertsUsage: 'Use <code>/alerts on</code> to enable problem alerts or <code>/alerts off</code> to disable them. They are delivered privately while you remain an admin.', reportUsage: 'Use <code>/report daily</code>, <code>/report weekly</code> or <code>/report off</code>. Reports cover the selected group and are delivered privately while you remain an admin.', alerts: 'Problem alerts', report: 'Reports', off: 'off', daily: 'daily', weekly: 'weekly', subscribed: 'Your preference has been saved for this group.',
    unknown: 'The request is unconfirmed. Check its status in the panel before repeating the action.',
  },
};

function rows(language, appUrl, tab = null, chatId = null) {
  const t = labels[language];
  return { inline_keyboard: [[dashboardButton(language, { appUrl, tab, chatId })], [{ text: t.home, callback_data: 'pilot:home' }]] };
}

function incidentText(row, language, personal = false) {
  const t = labels[language];
  const status = row.corrected ? t.corrected : ({ confirmed: t.confirmed, cancelled: t.cancelled, failed: t.failed, planned: t.planned, pending: t.planned, review: t.planned }[row.status] || t.planned);
  const reasons = Array.isArray(row.reasons) ? row.reasons.map(reason => reason === 'link' ? t.link : reason === 'forward' ? t.forward : t.otherReason).join(', ') : t.otherReason;
  const lines = [
    `<b>${t.case}</b> <code>${safe(trim(row.id, 120))}</code>`,
    `${personal ? t.group : t.member}: <code>${safe(personal ? row.chat_id : row.user_id ?? '—')}</code> · ${safe(date(row.event_at, language))}`,
    `${safe(status)} · ${t.strike}: ${count(row.strike)}/3`,
    `${t.reason}: ${safe(reasons)}`,
  ];
  if (row.status === 'confirmed' || row.corrected) lines.push(Number(row.until_date) > 0 ? `${t.until}: ${safe(date(row.until_date, language))}` : `${t.ban}: ${t.permanent}`);
  if (!personal && row.notification) {
    const notice = { sent: t.noticeSent, pending: t.noticePending, sending: t.noticeUnknown, unknown: t.noticeUnknown, failed: t.noticeFailed, cancelled: t.noticeCancelled }[row.notification.status] || t.noticeUnknown;
    lines.push(`${t.notice}: ${notice}`);
  }
  if (row.appeal) lines.push(`${t.appeal}: ${row.appeal.status === 'open' ? t.appealOpen : t.appealResolved}`);
  return lines.join('\n');
}

export function createFeatureCommands({ store, control, dispatchControl, appUrl = 'https://pilot.sautilink.com/app' }) {
  async function render({ command, argument = '', from, language = 'sw', updateId, groupId }) {
    language = language === 'en' ? 'en' : 'sw';
    const t = labels[language];
    const page = (text, tab, chatId) => ({ text, reply_markup: rows(language, appUrl, tab, chatId) });
    if (command === 'dashboard') return page(t.dashboard);
    if (command === 'checklink' && !argument) return page(`${t.checkTitle}\n\n${t.checkUsage}`, 'checker');
    if (command === 'appeal' && !argument) return page(t.appealUsage, 'mycases');
    if (!control?.query) return page(t.unavailable);
    const actor = { id: from.id, first_name: from.first_name, language_code: from.language_code };

    try {
      if (command === 'checklink') {
        if (argument.length > 4096) return page(t.tooLong, 'checker');
        const result = await control.query({ actor, ...(groupId?{chatId:groupId}:{}), view: 'checklink', input: { text: argument } });
        const destinations = Array.isArray(result.destinations) ? result.destinations : [];
        if (!destinations.length) return page(`${t.checkTitle}\n\n${t.noLinks}`, 'checker');
        const entries = destinations.slice(0, 8).map(item => {
          const explanation = item.allowed ? (item.source === 'group' || item.matchedRule ? t.groupAllowed : t.baseAllowed) : t.rejected;
          return `${item.allowed ? '✓' : '✕'} <b>${item.allowed ? t.allowed : t.blocked}</b>\n<code>${preview(item.value, 220)}</code>\n${explanation}`;
        });
        return page(`${t.checkTitle}\n${result.scope?.type === 'group' ? t.groupScope : t.baseScope}\n\n${entries.join('\n\n')}\n\n${t.checkFoot}${destinations.length > 8 ? `\n${t.moreLinks}` : ''}`, 'checker');
      }

      if (command === 'mystatus' || command === 'appeal') {
        const result = await control.query({ actor, view: 'mystatus' });
        const incidents = Array.isArray(result.incidents) ? result.incidents : [];
        if (command === 'mystatus') return page(`${t.myTitle}\n\n${incidents.length ? incidents.slice(0, 5).map(row => incidentText(row, language, true)).join('\n\n') : t.myEmpty}\n\n${t.myFoot}${incidents.length ? `\n\n${t.appealUsage}` : ''}`, 'mycases');
        const match = String(argument).match(/^(\S{1,120})\s+([\s\S]+)$/);
        if (!match || !match[2].trim() || match[2].trim().length > 1000) return page(t.appealLength, 'mycases');
        const incident = incidents.find(row => String(row.id) === match[1]);
        if (!incident) return page(t.noCase, 'mycases');
        if (incident.appeal) return page(t.appealDuplicate, 'mycases');
        if (!dispatchControl || !Number.isSafeInteger(updateId)) return page(t.unavailable, 'mycases');
        const saved = await dispatchControl({ actor, chatId: incident.chat_id, action: 'appeal_create', input: { incidentId: incident.id, message: match[2].trim() }, requestId: `tg:${updateId}:${actor.id}:appeal_create` });
        if (!saved?.ok) return page(t.unknown, 'mycases');
        return page(saved.duplicate ? t.appealDuplicate : t.appealSent, 'mycases');
      }

      const session = await store.adminContext(from.id);
      if (!session) return page(t.choose);
      const result = await control.query({ actor, chatId: session.chat_id, view: 'overview' });
      const chatId = result.group.id;
      const heading = `<b>${preview(result.group.title, 256)}</b>`;
      if (command === 'history') {
        const incidents = Array.isArray(result.incidents) ? result.incidents : [];
        return page(`${t.historyTitle}\n${heading}\n\n${incidents.length ? incidents.slice(0, 5).map(row => incidentText(row, language)).join('\n\n') : t.historyEmpty}\n\n${t.historyFoot}`, 'incidents', chatId);
      }
      if (command === 'appeals') {
        const appeals = Array.isArray(result.appeals) ? result.appeals : [];
        const items = appeals.slice(0, 5).map(item => `<b>${t.case}</b> <code>${safe(trim(item.incident_id, 120))}</code>\n${t.member}: <code>${safe(item.user_id)}</code> · ${item.status === 'open' ? t.appealOpen : t.appealResolved}\n${preview(item.message, 220)}`);
        return page(`${t.appealsTitle}\n${heading}\n\n${items.length ? items.join('\n\n') : t.appealsEmpty}\n\n${t.appealsFoot}`, 'appeals', chatId);
      }
      if (command === 'stats') {
        const stats = ['today', 'week', 'month'].map(period => {
          const value = result.stats?.[period] || {};
          return `<b>${t[period]}</b>\n${count(value.incidents)} ${t.incidents} · ${count(value.confirmed)} ${t.bansConfirmed}\n${count(value.links)} ${t.links} · ${count(value.forwards)} ${t.forwards}`;
        });
        return page(`${t.statsTitle}\n${heading}\n\n${stats.join('\n\n')}`, 'overview', chatId);
      }
      if (command === 'settings') {
        const settings = result.settings || {};
        const flag = value => value ? t.enabled : t.disabled;
        return page(`${t.settingsTitle}\n${heading}\n\nModeration: ${flag(result.moderation?.enabled)}\n${t.language}: ${result.language === 'en' ? 'English' : 'Kiswahili'}\n${t.welcome}: ${flag(settings.welcome_enabled)}\n${t.commandSpam}: ${flag(settings.command_spam_enabled !== false)}\n${t.flood}: ${flag(settings.flood_enabled)}\n${t.joins}: ${flag(settings.join_gate_enabled)}\n\n${t.settingsFoot}`, 'settings', chatId);
      }
      if (command === 'whitelist') {
        const rules = Array.isArray(result.rules) ? result.rules : [];
        const lines = rules.slice(0, 8).map(rule => `• ${t[rule.kind] || t.url}: <code>${preview(rule.value, 220)}</code>`);
        return page(`${t.whitelistTitle}\n${heading}\n\n${lines.length ? lines.join('\n') : t.whitelistEmpty}\n\n${t.whitelistFoot}`, 'links', chatId);
      }
      if (command === 'alerts' || command === 'report') {
        let subscription = result.subscription || { alerts: false, report: 'off' };
        const selection = argument.toLowerCase();
        const valid = command === 'alerts' ? ['on', 'off'].includes(selection) : ['off', 'daily', 'weekly'].includes(selection);
        let saved = false;
        if (valid) {
          if (!dispatchControl || !Number.isSafeInteger(updateId)) return page(t.unavailable, 'settings', chatId);
          // Send only the chosen field. The group queue merges current settings,
          // so a simultaneous preference change in the app cannot be overwritten.
          const input = command === 'alerts' ? { alerts: selection === 'on' } : { report: selection };
          const response = await dispatchControl({ actor, chatId, action: 'subscribe', input, requestId: `tg:${updateId}:${actor.id}:subscribe` });
          if (!response?.ok) return page(t.unknown, 'settings', chatId);
          subscription = { ...subscription, ...input, ...response.subscription };
          saved = true;
        }
        const report = ['daily', 'weekly'].includes(subscription.report) ? t[subscription.report] : t.off;
        return page(`${t.alertsTitle}\n${heading}\n\n${t.alerts}: ${subscription.alerts ? t.enabled : t.disabled}\n${t.report}: ${report}\n\n${saved ? `${t.subscribed}\n\n` : ''}${command === 'alerts' ? t.alertsUsage : t.reportUsage}`, 'settings', chatId);
      }
      return page(t.unavailable);
    } catch (error) {
      if (error?.status === 403) {
        if (ADMIN_FEATURE_COMMANDS.has(command)) await store.clearAdminContext(from.id);
        return page(t.denied);
      }
      if (error?.code === 'appeal_exists') return page(t.appealDuplicate, 'mycases');
      if (error?.code === 'appeal_rate_limited') return page(t.appealRate, 'mycases');
      return page(t.unavailable);
    }
  }
  return { render };
}
