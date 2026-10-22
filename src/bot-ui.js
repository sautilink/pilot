import { escapeHtml } from './policy.js';

export const EXPERIENCE_VERSION = '2026-10-22.5';
export const BOT_DESCRIPTION = 'SautiLink Pilot husaidia kusimamia Telegram groups kwa sheria wazi, moderation ya links na forwards, na matangazo yenye sababu. Kagua link, ona matukio yako au tuma rufaa. Shiriki events, chagua vikumbusho na omba msaada wa admins faraghani ikiwa group limeruhusu. Admin ana paneli yake ya mipangilio na zana. Kiswahili / English.';
export const BOT_SHORT_DESCRIPTION = 'Moderation, events, msaada wa faragha na zana za admins. Kiswahili / English.';

export const PUBLIC_COMMANDS = [
  { command: 'start', description: 'Fungua menyu ya SautiLink Pilot' },
  { command: 'dashboard', description: 'Fungua paneli ya Pilot' },
  { command: 'tools', description: 'Zana za jumuiya, ratiba na mipango' },
  { command: 'flag', description: 'Ripoti ujumbe kwa reply ndani ya group' },
  { command: 'ask', description: 'Tafuta jibu lililoidhinishwa na admins' },
  { command: 'events', description: 'Ona events, RSVP na vikumbusho' },
  { command: 'support', description: 'Omba msaada wa admins wa group faraghani' },
  { command: 'communities', description: 'Gundua jumuiya zilizochagua kuorodheshwa' },
  { command: 'changelog', description: 'Vipengele vipya na mipango ya Pilot' },
  { command: 'feedback', description: 'Tuma wazo au ripoti tatizo' },
  { command: 'checklink', description: 'Kagua kama link inaruhusiwa' },
  { command: 'mystatus', description: 'Ona matukio yako na hali ya rufaa' },
  { command: 'appeal', description: 'Omba admin apitie tukio lako' },
  { command: 'about', description: 'Kuhusu SautiLink Pilot' },
  { command: 'howitworks', description: 'Jinsi moderation inavyofanya kazi' },
  { command: 'rules', description: 'Sheria za links, forwards na spam ya commands' },
  { command: 'connect', description: 'Chagua group na ukague muunganisho' },
  { command: 'developer', description: 'Mwongozo wa kuunganisha huduma na API' },
  { command: 'help', description: 'Msaada wa kutumia bot' },
  { command: 'admin', description: 'Fungua paneli ya faragha ya admin' },
  { command: 'language', description: 'Chagua Kiswahili au English' },
];

export const GROUP_COMMANDS = [
  { command: 'rules', description: 'Soma sheria za group' },
  { command: 'help', description: 'Pata msaada kwenye mazungumzo ya faragha' },
  { command: 'flag', description: 'Reply kuripoti ujumbe kwa admins', is_ephemeral: true },
  { command: 'ask', description: 'Tafuta kwenye majibu ya group', is_ephemeral: true },
  { command: 'events', description: 'Events za group, RSVP na vikumbusho', is_ephemeral: true },
  { command: 'support', description: 'Fungua msaada wa group faraghani', is_ephemeral: true },
  { command: 'communities', description: 'Gundua jumuiya zilizo kwenye orodha', is_ephemeral: true },
  { command: 'tools', description: 'Fungua zana za jumuiya', is_ephemeral: true },
  { command: 'checklink', description: 'Kagua link faraghani kabla ya kuituma', is_ephemeral: true },
];

// Register only with Telegram's administrator command scope.
export const ADMIN_COMMANDS = [
  ...GROUP_COMMANDS,
  { command: 'connect', description: 'Chagua group na ukague muunganisho' },
  { command: 'doctor', description: 'Kagua ruhusa na utayari wa group', is_ephemeral: true },
  { command: 'policytest', description: 'Jaribu sheria bila kufuta ujumbe au adhabu', is_ephemeral: true },
  { command: 'admin', description: 'Fungua paneli ya faragha ya admin' },
  { command: 'dashboard', description: 'Fungua paneli ya usimamizi faraghani' },
  { command: 'history', description: 'Ona matukio ya group faraghani', is_ephemeral: true },
  { command: 'appeals', description: 'Kagua rufaa za wanachama faraghani', is_ephemeral: true },
  { command: 'settings', description: 'Mipangilio ya group faraghani', is_ephemeral: true },
  { command: 'stats', description: 'Takwimu za group faraghani', is_ephemeral: true },
  { command: 'whitelist', description: 'Kagua links za ziada zinazoruhusiwa', is_ephemeral: true },
  { command: 'alerts', description: 'Chagua taarifa zako za matatizo' },
  { command: 'report', description: 'Chagua ripoti yako ya siku au wiki' },
  { command: 'language', description: 'Badili lugha ya group' },
  { command: 'status', description: 'Pokea hali ya group kwenye mazungumzo ya faragha', is_ephemeral: true },
  { command: 'strikes', description: 'Kagua makosa ya mtumiaji kwenye group hili' },
  { command: 'forgive', description: 'Safisha historia ya makosa ya mtumiaji' },
  { command: 'unban', description: 'Ondoa ban bila kufuta historia ya makosa' },
  { command: 'pause', description: 'Sitisha moderation kwenye group hili' },
  { command: 'resume', description: 'Washa moderation kwenye group hili' },
  { command: 'testnotice', description: 'Tuma tangazo la majaribio bila kumfungia mtu' },
];

const button = (text, page) => ({ text, callback_data: `pilot:${page}` });
const homeButton = () => button('⌂ Mwanzo', 'home');
const cleanName = value => escapeHtml(String(value || '').slice(0, 128));

// A web_app button is rendered only in private messages by commands.js.
export function dashboardButton(language = 'sw', { appUrl = 'https://pilot.sautilink.com/app', tab, chatId } = {}) {
  let url;
  try {
    url = new URL(appUrl);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid_app_url');
  } catch { url = new URL('https://pilot.sautilink.com/app'); }
  url.searchParams.set('lang', language === 'en' ? 'en' : 'sw');
  if (['overview', 'incidents', 'appeals', 'settings', 'links', 'activity', 'mycases', 'checker'].includes(tab)) url.searchParams.set('tab', tab);
  if (/^-[1-9]\d*$/.test(String(chatId)) && Number.isSafeInteger(Number(chatId))) url.searchParams.set('group', String(chatId));
  return { text: language === 'en' ? '✦ Open Pilot panel' : '✦ Fungua paneli ya Pilot', web_app: { url: url.href } };
}

export function renderBotPage(page, context = {}) {
  if (context.language === 'en') return renderEnglishPage(page, context);
  const candidate = String(context.username || 'sautilinkpilotbot').replace(/^@/, '');
  const username = /^[A-Za-z0-9_]{5,32}$/.test(candidate) ? candidate : 'sautilinkpilotbot';
  const addUrl = `https://t.me/${username}?startgroup=true&admin=delete_messages+restrict_members`;
  let text, rows;

  switch (page) {
    case 'language':
      text = '🌐 <b>Chagua lugha yako</b>\n\nLugha hii itatumika kwenye mazungumzo yako ya faragha na Pilot.\n\nAdmin anaweza kubadili lugha ya group kwa kutuma <code>/language sw</code> au <code>/language en</code> ndani ya group hilo.';
      rows = [[{ text: '✓ Kiswahili', callback_data: 'pilot:lang:sw' }, { text: 'English', callback_data: 'pilot:lang:en' }], [homeButton()]];
      break;
    case 'about':
      text = '✦ <b>Kuhusu SautiLink Pilot</b>\n\nMsaidizi wa usimamizi wa Telegram groups. Pilot huondoa links zisizoruhusiwa na forwarded messages, huku ikifuata sheria zilezile kwa wanachama wa group.\n\nKila group lina historia yake ya makosa. Owner na admins wa group wanaendelea kusimamia maamuzi ya group lao.\n\nPia unaweza kukagua link kabla ya kuituma, kuona matukio yako na kuomba admin apitie uamuzi. Admin huchagua mipangilio ya group. Code ndefu za commands zisizoruhusiwa hufutwa kimya kimya ikiwa kichujio kimewashwa, bila ban au mute.\n\nChagua sehemu hapa chini kujua zaidi.';
      rows = [[button('🧭 Inavyofanya kazi', 'how'), button('📋 Sheria', 'rules')], [homeButton()]];
      break;
    case 'how':
      text = '🧭 <b>Jinsi Pilot inavyofanya kazi</b>\n\n<b>1. Hukagua ujumbe</b>\nHutambua links zisizoruhusiwa na ujumbe uliotumwa kwa Forward. Ujumbe uliohaririwa hukaguliwa pia.\n\n<b>2. Huondoa ujumbe unaovunja sheria</b>\nLinks zilizoruhusiwa zinaweza kutumwa moja kwa moja. Forward bado inafuata sheria ya forwarded messages.\n\n<b>3. Hufuata adhabu za links na forwards</b>\nKosa la kwanza: saa 24. La pili: siku 7. La tatu: ban ya kudumu. Makosa huhesabiwa ndani ya kila group.\n\n<b>4. Hutoa sababu</b>\nBan ikithibitishwa, Pilot hutuma tangazo la hatua na sababu kwenye group. Admin anaweza kukagua hali kupitia paneli yake ya faragha.\n\n<b>Code ndefu za commands</b>\nKichujio kikiwa kimewashwa, ujumbe wenye code ndefu za /command tu zisizoruhusiwa hufutwa kimya kimya. Hakuna ban, mute wala kosa kwa code hizo. Commands za kawaida zinaendelea kufanya kazi.';
      rows = [[button('📋 Sheria kamili', 'rules'), button('➕ Ongeza kwenye group', 'connect')], [homeButton()]];
      break;
    case 'rules':
      text = '📋 <b>Sheria za SautiLink Pilot</b>\n\n• Links zisizoruhusiwa na forwarded messages huondolewa.\n• Kosa 1 la link au forward ni ban saa 24; kosa 2 siku 7; kosa 3 ban ya kudumu. Historia ni ya kila group.\n• HTTPS za <b>sautilink.com</b> na subdomains zake zinaruhusiwa.\n• Links hizi za Telegram zinaruhusiwa: <b>t.me/techhubtz</b>, <b>t.me/sautilink</b>, <b>t.me/sautilinkcloud_bot</b>, <b>t.me/drcharlesofficial</b> na <b>t.me/drcharlestz</b>.\n• Forward haipati ruhusa kwa kuwa tu ina link iliyoruhusiwa.\n• Kichujio cha commands kikiwa kimewashwa, ujumbe wenye code ndefu tu zisizoruhusiwa hufutwa kimya kimya. Hakuna ban, mute wala kosa kwa code hizo; commands za kawaida zinaendelea kupita.\n• Owner, admins, anonymous admins na ujumbe rasmi wa linked channel wameondolewa kwenye ukaguzi huu.\n\nAdmin anaweza kuongeza links zinazoruhusiwa kwa group lake. Kagua link faraghani kwa /checklink kabla ya kuituma.\n\nUna swali kuhusu hatua iliyochukuliwa? Fungua /mystatus kuona tukio lako na kutuma rufaa.';
      rows = [[button('🧭 Inavyofanya kazi', 'how'), button('❔ Msaada', 'help')], [homeButton()]];
      break;
    case 'connect':
      text = '➕ <b>Unganisha Pilot na group lako</b>\n\n<b>1. Chagua group</b>\nTuma /connect hapa faraghani, kisha chagua group unalosimamia. Pilot itakagua ruhusa na kukuonyesha hatua zinazohitajika.\n\n<b>2. Kamilisha ruhusa</b>\nPilot inahitaji kuwa admin yenye <b>Delete messages</b> na <b>Ban users</b>. Tumia <b>supergroup</b> kwa ban za saa 24 na siku 7. Ukaguzi wa maombi ya kujiunga unahitaji pia <b>Invite users</b>.\n\n<b>3. Chagua zana zako</b>\nFungua /admin kwenye group kuchagua lugha, sheria na zana. Support ya faragha na kuorodheshwa kwa jumuiya huanza tu admin akivichagua.\n\nTaarifa za usimamizi zinaonekana baada ya uadmin wako kuthibitishwa.';
      rows = [[{ text: '➕ Chagua group langu', url: `https://t.me/${username}?start=connect` }], [{ text: 'Ongeza Pilot kwenye group', url: addUrl }], [button('📋 Soma sheria', 'rules'), button('🛡 Paneli ya admin', 'admin')], [homeButton()]];
      break;
    case 'developer':
      text = '⌘ <b>Unganisha huduma zako na Pilot</b>\n\nAPI ya Pilot husaidia programu yako kusoma majibu yaliyoidhinishwa na matukio ya group, au kuwasilisha rasimu ya tangazo kwa mapitio ya admin.\n\nAdmin wa group huchagua ruhusa na muda wa credential kupitia <b>Zana za jumuiya → Miunganisho</b>. Rasimu haitumwi moja kwa moja.\n\nMwongozo wa huduma una hatua za kuanza, mifano ya maombi na mipaka ya matumizi. Kwa maswali kuhusu moderation, wasiliana na admin wa group husika.';
      rows = [[{ text: '⌘ Mwongozo wa integrations na API', url: 'https://pilot.sautilink.com/developers?lang=sw' }], [{ text: '🌐 Tovuti ya Pilot', url: 'https://pilot.sautilink.com?lang=sw' }, { text: 'SautiLink Corporation', url: 'https://www.sautilink.com/' }], [homeButton()]];
      break;
    case 'help':
      text = '❔ <b>Tunaweza kukusaidiaje?</b>\n\n<b>Sheria na links</b>\n/rules na /howitworks zinaeleza moderation. Tuma /checklink na link faraghani kabla ya kuipost. Code ndefu za commands zikifutwa, hakuna ban, mute wala kosa; admin anaweza kuweka exception kwa bot inayozihitaji.\n\n<b>Tukio langu au ban</b>\n/mystatus inaonyesha matukio yako; /appeal inafungua njia ya kuomba ukaguzi. Ban ya muda ikiisha, unaweza kujiunga tena ikiwa group linaruhusu.\n\n<b>Msaada wa group</b>\nTuma /support kwenye group husika kufungua ticket faraghani ikiwa admins wamewasha huduma. Ticket inaonekana kwako na kwa admins wa group hilo.\n\n<b>Events na jumuiya</b>\n/events kwenye group hufungua matukio, RSVP na vikumbusho vya hiari. Fungua bot faraghani kwanza ili kuweza kuchagua vikumbusho. /communities inaonyesha jumuiya zilizochagua kuorodheshwa.\n\n<b>Nina group au integration</b>\n/connect inakusaidia kuunganisha group. /admin inafungua paneli baada ya kuthibitisha ruhusa. /developer ina mwongozo wa huduma na API.\n\nRudi /start kufungua menyu.';
      rows = [[button('📋 Sheria', 'rules'), button('➕ Unganisha group', 'connect')], [button('🛡 Paneli ya admin', 'admin'), button('⌘ Integrations', 'developer')], [homeButton()]];
      break;
    case 'admin':
      if (!context.groupId) {
        text = '🛡 <b>Paneli ya faragha ya admin</b>\n\nFungua group unalosimamia na utume /admin. Bonyeza kiungo utakachopewa kurudi hapa.\n\nPilot itathibitisha kuwa wewe bado ni owner au admin kabla ya kuonyesha taarifa za group hilo.\n\nHujaongeza Pilot kwenye group? Anza hapa chini.';
        rows = [[button('➕ Unganisha group', 'connect')], [homeButton()]];
      } else {
        text = `🛡 <b>Paneli ya admin</b>\n<b>Group:</b> ${cleanName(context.groupTitle) || 'Group lako'}\n\n<b>Paneli yako ya usimamizi</b>\nHistoria, rufaa, takwimu, links za ziada na zana za group vinapatikana kwenye paneli. Zana za jumuiya zina events, vikumbusho, support ya hiari na chaguo la kuorodhesha ukurasa wa public.\n\n<b>Unaweza kukagua hapa</b>\n/status — hali ya moderation na matangazo.\n/doctor — ruhusa na utayari wa group.\n/policytest — jaribu sheria kwa ujumbe wa mfano, bila kufuta ujumbe au kutoa adhabu.\n<code>/strikes USER_ID</code> — makosa ya mtumiaji katika group hili.\n\n /history · /appeals · /stats · /settings · /whitelist\n<code>/alerts on</code> — taarifa za matatizo kwako.\n<code>/report daily</code> au <code>/report weekly</code> — ripoti ulizoomba.\n\n<b>Amri hizi hutumwa ndani ya group lenyewe</b>\n/pause na /resume — sitisha au washa moderation.\n<code>/forgive USER_ID</code> — safisha historia ya makosa.\n<code>/unban USER_ID</code> — ondoa ban, hifadhi historia.\n/testnotice — tangazo la majaribio bila adhabu.\n<code>/language sw</code> au <code>/language en</code> — chagua lugha ya group.\n\nKwa amri zinazomhusu mtu, unaweza pia kujibu ujumbe wake ndani ya group. Majibu yenye taarifa za usimamizi yatakuja faraghani.\n\nKubadili group, tuma /admin katika group jingine unalosimamia.`;
        rows = [[button('↻ Hali ya group', 'status')], [button('❔ Msaada', 'help'), homeButton()]];
      }
      break;
    case 'status':
      if (!context.groupId) return renderBotPage('admin', context);
      text = `🛡 <b>Hali ya group</b>\n<b>Group:</b> ${cleanName(context.groupTitle) || 'Group lako'}\n<b>ID:</b> <code>${escapeHtml(String(context.groupId))}</code>\n\n<b>Moderation:</b> ${context.moderationEnabled ? 'imewashwa' : 'imesitishwa'}.\n<b>Aina:</b> ${context.groupType === 'supergroup' ? 'supergroup' : 'group'}.\n<b>Lugha ya group:</b> ${context.groupLanguage === 'en' ? 'English' : 'Kiswahili'}.\n<b>Ruhusa:</b> ${context.permissionsComplete ? 'zimekamilika' : 'kagua nafasi ya admin, Delete messages na Ban users'}.\n<b>Adhabu:</b> saa 24 → siku 7 → ban ya kudumu.\n\n<b>Matangazo:</b> ${escapeHtml(context.noticeSummary || 'Hakuna taarifa ya tangazo bado.')}\n\nTaarifa hizi ni za group ulilochagua pekee.`;
      rows = [[button('↻ Sasisha hali', 'status'), button('🛡 Paneli ya admin', 'admin')], [homeButton()]];
      break;
    default:
      text = `✦ <b>Karibu SautiLink Pilot${context.firstName ? `, ${cleanName(context.firstName)}` : ''}!</b>\n\nGroup lenye mpangilio huanza na sheria zilizo wazi. Pilot hukusaidia kuzifuata na kupata msaada unapouhitaji.\n\n🔎 Kagua link kabla ya kuituma.\n📂 Ona matukio yako na tuma rufaa.\n📅 Shiriki events na chagua vikumbusho.\n💬 Pata msaada wa admins ikiwa group limewasha support.\n🛡 Simamia groups zako kwenye paneli.\n\nChagua lugha yako au anza na sehemu iliyo hapa chini.\n\n<b>Ungependa kuanzia wapi?</b>`;
      rows = [[button('ℹ️ Kuhusu Pilot', 'about'), button('🧭 Inavyofanya kazi', 'how')], [button('📋 Sheria', 'rules'), button('➕ Ongeza kwenye group', 'connect')], [button('❔ Msaada', 'help'), button('⌘ Integrations', 'developer')], [button('🛡 Paneli ya admin', 'admin')]];
  }

  if (['home', 'admin', 'status', 'help', 'connect'].includes(page)) rows.unshift([dashboardButton('sw', { appUrl: context.appUrl, chatId: context.groupId })]);
  if (page === 'home' || page === 'help') rows.splice(1, 0, [button('🔎 Kagua link', 'checklink'), button('📂 Matukio yangu', 'mystatus')]);
  if (page === 'admin' && context.groupId) rows.splice(1, 0, [button('📋 Historia', 'history'), button('📝 Rufaa', 'appeals')], [button('⚙ Mipangilio', 'settings'), button('▥ Takwimu', 'stats')]);
  if (page === 'home' && context.isOwner === true) {
    text += '\n\n<b>Zana za mmiliki</b>\n/performance — vipimo vya utendaji na tahadhari zako za faragha.';
    rows.push([button('📣 Updates za Pilot', 'bc:panel'), { text: '⏱ Utendaji', url: `https://t.me/${username}?start=performance` }]);
  }
  if (['home','admin','help'].includes(page)) rows.push([{text:'✦ Zana za jumuiya',web_app:{url:`https://pilot.sautilink.com/tools?lang=sw${context.groupId?`&chat=${context.groupId}`:''}`}}]);
  if (page === 'home' || page === 'help') rows.push([{ text: '🌐 Gundua jumuiya', url: 'https://pilot.sautilink.com/communities?lang=sw' }]);
  if (page === 'admin' && context.groupId) rows.splice(1, 0, [{ text: '🩺 Kagua group', url: `https://t.me/${username}?start=doctor_${context.groupId}` }, { text: '✓ Jaribu sheria', url: `https://t.me/${username}?start=policytest_${context.groupId}` }]);
  if (page !== 'language') rows.push([button('🌐 Lugha / Language', 'language')]);
  return { text, reply_markup: { inline_keyboard: rows } };
}

export function getPublicCommands(language = 'sw') {
  if (language !== 'en') return PUBLIC_COMMANDS;
  return [
    { command: 'start', description: 'Open the SautiLink Pilot menu' },
    { command: 'dashboard', description: 'Open your Pilot panel' },
    { command: 'tools', description: 'Community tools, schedules and planning' },
    { command: 'flag', description: 'Report a message by replying in your group' },
    { command: 'ask', description: 'Search answers approved by group admins' },
    { command: 'events', description: 'View group events, RSVP and reminders' },
    { command: 'support', description: 'Ask your group admins for help privately' },
    { command: 'communities', description: 'Explore communities that choose to be listed' },
    { command: 'changelog', description: 'Pilot updates and roadmap' },
    { command: 'feedback', description: 'Share an idea or report a problem' },
    { command: 'checklink', description: 'Check whether a link is allowed' },
    { command: 'mystatus', description: 'View your cases and appeal status' },
    { command: 'appeal', description: 'Request an admin review of your case' },
    { command: 'about', description: 'About SautiLink Pilot' },
    { command: 'howitworks', description: 'How moderation works' },
    { command: 'rules', description: 'Rules for links, forwards and command spam' },
    { command: 'connect', description: 'Choose a group and check its setup' },
    { command: 'developer', description: 'Service integration and API guide' },
    { command: 'help', description: 'Get help using Pilot' },
    { command: 'admin', description: 'Open your private admin panel' },
    { command: 'language', description: 'Choose English or Kiswahili' },
  ];
}

export function getGroupCommands(language = 'sw') {
  if (language !== 'en') return GROUP_COMMANDS;
  return [
    { command: 'rules', description: 'Read the group rules' },
    { command: 'help', description: 'Get help in a private chat' },
    { command: 'flag', description: 'Reply to report a message to admins', is_ephemeral: true },
    { command: 'ask', description: 'Search your group’s approved answers', is_ephemeral: true },
    { command: 'events', description: 'Group events, RSVP and reminders', is_ephemeral: true },
    { command: 'support', description: 'Open private support for this group', is_ephemeral: true },
    { command: 'communities', description: 'Explore communities that opt into the directory', is_ephemeral: true },
    { command: 'tools', description: 'Open Community tools', is_ephemeral: true },
    { command: 'checklink', description: 'Check a link privately before posting', is_ephemeral: true },
  ];
}

export function getAdminCommands(language = 'sw') {
  if (language !== 'en') return ADMIN_COMMANDS;
  return [
    ...getGroupCommands('en'),
    { command: 'connect', description: 'Choose a group and check its setup' },
    { command: 'doctor', description: 'Check group permissions and readiness', is_ephemeral: true },
    { command: 'policytest', description: 'Test rules without deleting messages or penalties', is_ephemeral: true },
    { command: 'admin', description: 'Open your private admin panel' },
    { command: 'dashboard', description: 'Open your moderation panel privately' },
    { command: 'history', description: 'View group incidents privately', is_ephemeral: true },
    { command: 'appeals', description: 'Review member appeals privately', is_ephemeral: true },
    { command: 'settings', description: 'View group settings privately', is_ephemeral: true },
    { command: 'stats', description: 'View group statistics privately', is_ephemeral: true },
    { command: 'whitelist', description: 'Review additional allowed links', is_ephemeral: true },
    { command: 'alerts', description: 'Choose your problem alerts' },
    { command: 'report', description: 'Choose your daily or weekly report' },
    { command: 'language', description: 'Change the group language' },
    { command: 'status', description: 'Receive group status privately', is_ephemeral: true },
    { command: 'strikes', description: 'Check a member’s strikes in this group' },
    { command: 'forgive', description: 'Clear a member’s strike history' },
    { command: 'unban', description: 'Remove a ban and keep strike history' },
    { command: 'pause', description: 'Pause moderation in this group' },
    { command: 'resume', description: 'Resume moderation in this group' },
    { command: 'testnotice', description: 'Send a sample notice without banning anyone' },
  ];
}

export function getBotDescription(language = 'sw') {
  return language === 'en'
    ? 'SautiLink Pilot helps moderate Telegram groups with clear rules, link and forward checks, and notices explaining confirmed actions. Check a link, view your cases or appeal. Join group events, choose reminders and contact admins privately where support is enabled. Admins have a private panel for settings and community tools. English / Kiswahili.'
    : BOT_DESCRIPTION;
}

export function getBotShortDescription(language = 'sw') {
  return language === 'en'
    ? 'Moderation, group events, private support and admin tools. English / Kiswahili.'
    : BOT_SHORT_DESCRIPTION;
}

function renderEnglishPage(page, context) {
  const candidate = String(context.username || 'sautilinkpilotbot').replace(/^@/, '');
  const username = /^[A-Za-z0-9_]{5,32}$/.test(candidate) ? candidate : 'sautilinkpilotbot';
  const home = () => button('⌂ Home', 'home');
  let text, rows;
  switch (page) {
    case 'language':
      text = '🌐 <b>Choose your language</b>\n\nThis language applies to your private conversations with Pilot.\n\nAn admin can change a group’s language by sending <code>/language sw</code> or <code>/language en</code> inside that group.';
      rows = [[{ text: 'Kiswahili', callback_data: 'pilot:lang:sw' }, { text: '✓ English', callback_data: 'pilot:lang:en' }], [home()]];
      break;
    case 'about':
      text = '✦ <b>About SautiLink Pilot</b>\n\nAn assistant for Telegram group moderation. Pilot removes unapproved links and forwarded messages, applying consistent rules to group members.\n\nEach group has its own strike history. The group’s owner and admins remain in control of moderation decisions.\n\nYou can also check a link before posting, see your own cases and request an admin review. Admins choose the group settings. Unapproved long command codes are silently removed when the filter is enabled, without a ban or mute.\n\nChoose a section below to learn more.';
      rows = [[button('🧭 How it works', 'how'), button('📋 Rules', 'rules')], [home()]];
      break;
    case 'how':
      text = '🧭 <b>How Pilot works</b>\n\n<b>1. Checks messages</b>\nPilot detects unapproved links and forwarded messages. Edited messages are checked too.\n\n<b>2. Removes rule-breaking messages</b>\nApproved links can be posted directly. Forwarded messages still follow the forwarding rule.\n\n<b>3. Applies bans for links and forwards</b>\nFirst strike: 24 hours. Second: 7 days. Third: permanent. Strikes are counted separately for each group.\n\n<b>4. Explains the action</b>\nAfter a ban is confirmed, Pilot posts the action and reason in the group. Admins can check its status through their private panel.\n\n<b>Long command codes</b>\nWhen the filter is enabled, messages made up of unapproved long /command codes are silently deleted. These codes never add a ban, mute or strike. Ordinary commands remain available.';
      rows = [[button('📋 Read the rules', 'rules'), button('➕ Add to a group', 'connect')], [home()]];
      break;
    case 'rules':
      text = '📋 <b>SautiLink Pilot rules</b>\n\n• Unapproved links and forwarded messages are removed.\n• Link and forward strikes: first is a 24-hour ban; second 7 days; third permanent. Each group has its own history.\n• HTTPS links to <b>sautilink.com</b> and its subdomains are allowed.\n• Approved Telegram links: <b>t.me/techhubtz</b>, <b>t.me/sautilink</b>, <b>t.me/sautilinkcloud_bot</b>, <b>t.me/drcharlesofficial</b> and <b>t.me/drcharlestz</b>.\n• An approved link does not exempt a forwarded message.\n• With the command filter enabled, messages made up of unapproved long codes are silently deleted. No ban, mute or strike for those codes; ordinary commands remain available.\n• The owner, admins, anonymous admins, and official linked-channel messages are exempt from these checks.\n\nAdmins may allow additional links for their own group. Check a link privately with /checklink before posting.\n\nQuestions about a moderation decision? Open /mystatus to see your case and submit an appeal.';
      rows = [[button('🧭 How it works', 'how'), button('❔ Help', 'help')], [home()]];
      break;
    case 'connect':
      text = '➕ <b>Connect Pilot to your group</b>\n\n<b>1. Choose a group</b>\nSend /connect here privately, then choose a group you manage. Pilot checks its permissions and shows the next steps.\n\n<b>2. Complete the permissions</b>\nPilot needs to be an admin with <b>Delete messages</b> and <b>Ban users</b>. Use a <b>supergroup</b> for 24-hour and 7-day bans. Join-request review also needs <b>Invite users</b>.\n\n<b>3. Choose your tools</b>\nOpen /admin from your group to choose its language, rules and tools. Private support and directory listing begin only when an admin opts in.\n\nManagement details appear after Pilot verifies your current admin role.';
      rows = [[{ text: '➕ Choose my group', url: `https://t.me/${username}?start=connect` }], [{ text: 'Add Pilot to a group', url: `https://t.me/${username}?startgroup=true&admin=delete_messages+restrict_members` }], [button('📋 Read the rules', 'rules'), button('🛡 Admin panel', 'admin')], [home()]];
      break;
    case 'developer':
      text = '⌘ <b>Connect your services to Pilot</b>\n\nThe Pilot API lets your application read approved answers and group events, or submit an announcement draft for admin review.\n\nA current group admin chooses the permissions and credential expiry in <b>Community tools → Integrations</b>. Drafts are never sent automatically.\n\nThe service guide covers getting started, request examples and usage limits. For moderation questions, contact the relevant group’s admins.';
      rows = [[{ text: '⌘ Integration and API guide', url: 'https://pilot.sautilink.com/developers' }], [{ text: '🌐 Pilot website', url: 'https://pilot.sautilink.com' }, { text: 'SautiLink Corporation', url: 'https://www.sautilink.com/' }], [home()]];
      break;
    case 'help':
      text = '❔ <b>How can we help?</b>\n\n<b>Rules and links</b>\n/rules and /howitworks explain moderation. Send /checklink with a link privately before posting. Deleted long command codes add no ban, mute or strike; an admin can allow an exception for a bot that needs them.\n\n<b>My case or ban</b>\n/mystatus shows your cases; /appeal explains how to request a review. After a temporary ban expires, you may rejoin if the group allows it.\n\n<b>Help from my group</b>\nSend /support in the relevant group to open a private ticket if its admins enabled support. The ticket is visible to you and that group’s admins.\n\n<b>Events and communities</b>\n/events in your group opens events, RSVPs and optional reminders. Open Pilot privately first so you can opt into reminders. /communities shows communities that chose to be listed.\n\n<b>I manage a group or integration</b>\n/connect helps connect your group. /admin opens the panel after checking your role. /developer has the service and API guide.\n\nReturn to /start to open the menu.';
      rows = [[button('📋 Rules', 'rules'), button('➕ Connect a group', 'connect')], [button('🛡 Admin panel', 'admin'), button('⌘ Integrations', 'developer')], [home()]];
      break;
    case 'admin':
      if (!context.groupId) {
        text = '🛡 <b>Your private admin panel</b>\n\nOpen a group you manage and send /admin. Tap the link you receive to return here.\n\nPilot checks that you are still the group’s owner or an admin before showing its information.\n\nHaven’t added Pilot to your group yet? Start below.';
        rows = [[button('➕ Connect a group', 'connect')], [home()]];
      } else {
        text = `🛡 <b>Admin panel</b>\n<b>Group:</b> ${cleanName(context.groupTitle) || 'Your group'}\n\n<b>Your moderation panel</b>\nFind history, appeals, statistics, extra allowed links and group tools in the panel. Community tools include events, reminders, optional private support and the choice to list a public community page.\n\n<b>Check information here</b>\n/status — moderation and announcement status.\n/doctor — group permissions and readiness.\n/policytest — test sample messages without deleting messages or applying penalties.\n<code>/strikes USER_ID</code> — a member’s strikes in this group.\n\n /history · /appeals · /stats · /settings · /whitelist\n<code>/alerts on</code> — problem alerts for you.\n<code>/report daily</code> or <code>/report weekly</code> — opt-in reports.\n\n<b>Send these commands inside the group itself</b>\n/pause and /resume — pause or resume moderation.\n<code>/forgive USER_ID</code> — clear strike history.\n<code>/unban USER_ID</code> — remove a ban, keep strike history.\n/testnotice — send a sample announcement with no punishment.\n<code>/language sw</code> or <code>/language en</code> — choose the group language.\n\nFor commands about a member, you can also reply to their message inside the group. Detailed admin replies are delivered privately.\n\nTo switch groups, send /admin inside another group you manage.`;
        rows = [[button('↻ Group status', 'status')], [button('❔ Help', 'help'), home()]];
      }
      break;
    case 'status':
      if (!context.groupId) return renderEnglishPage('admin', context);
      text = `🛡 <b>Group status</b>\n<b>Group:</b> ${cleanName(context.groupTitle) || 'Your group'}\n<b>ID:</b> <code>${escapeHtml(String(context.groupId))}</code>\n\n<b>Moderation:</b> ${context.moderationEnabled ? 'enabled' : 'paused'}.\n<b>Type:</b> ${context.groupType === 'supergroup' ? 'supergroup' : 'group'}.\n<b>Group language:</b> ${context.groupLanguage === 'en' ? 'English' : 'Kiswahili'}.\n<b>Permissions:</b> ${context.permissionsComplete ? 'complete' : 'check admin status, Delete messages, and Ban users'}.\n<b>Bans:</b> 24 hours → 7 days → permanent.\n\n<b>Announcements:</b> ${escapeHtml(context.noticeSummary || 'No announcement record yet.')}\n\nThis information belongs only to the group you selected.`;
      rows = [[button('↻ Refresh status', 'status'), button('🛡 Admin panel', 'admin')], [home()]];
      break;
    default:
      text = `✦ <b>Welcome to SautiLink Pilot${context.firstName ? `, ${cleanName(context.firstName)}` : ''}!</b>\n\nA well-run group starts with clear rules. Pilot helps you follow them and find support when you need it.\n\n🔎 Check a link before posting.\n📂 View your cases and submit an appeal.\n📅 Join events and choose reminders.\n💬 Ask your admins for help where support is enabled.\n🛡 Manage your groups in the panel.\n\nChoose your language or start below.\n\n<b>Where would you like to start?</b>`;
      rows = [[button('ℹ️ About Pilot', 'about'), button('🧭 How it works', 'how')], [button('📋 Rules', 'rules'), button('➕ Add to a group', 'connect')], [button('❔ Help', 'help'), button('⌘ Integrations', 'developer')], [button('🛡 Admin panel', 'admin')]];
  }
  if (['home', 'admin', 'status', 'help', 'connect'].includes(page)) rows.unshift([dashboardButton('en', { appUrl: context.appUrl, chatId: context.groupId })]);
  if (page === 'home' || page === 'help') rows.splice(1, 0, [button('🔎 Check a link', 'checklink'), button('📂 My cases', 'mystatus')]);
  if (page === 'admin' && context.groupId) rows.splice(1, 0, [button('📋 History', 'history'), button('📝 Appeals', 'appeals')], [button('⚙ Settings', 'settings'), button('▥ Statistics', 'stats')]);
  if (page === 'home' && context.isOwner === true) {
    text += '\n\n<b>Owner tools</b>\n/performance — service measurements and your private alerts.';
    rows.push([button('📣 Pilot updates', 'bc:panel'), { text: '⏱ Performance', url: `https://t.me/${username}?start=performance` }]);
  }
  if (['home','admin','help'].includes(page)) rows.push([{text:'✦ Community tools',web_app:{url:`https://pilot.sautilink.com/tools?lang=en${context.groupId?`&chat=${context.groupId}`:''}`}}]);
  if (page === 'home' || page === 'help') rows.push([{ text: '🌐 Explore communities', url: 'https://pilot.sautilink.com/communities' }]);
  if (page === 'admin' && context.groupId) rows.splice(1, 0, [{ text: '🩺 Check setup', url: `https://t.me/${username}?start=doctor_${context.groupId}` }, { text: '✓ Test rules', url: `https://t.me/${username}?start=policytest_${context.groupId}` }]);
  if (page !== 'language') rows.push([button('🌐 Language / Lugha', 'language')]);
  return { text, reply_markup: { inline_keyboard: rows } };
}
