import { escapeHtml } from './policy.js';

export const EXPERIENCE_VERSION = '2026-10-21.2';
export const BOT_DESCRIPTION = 'SautiLink Pilot inasaidia kusimamia Telegram groups: huondoa links zisizoruhusiwa na forwarded messages, kisha hutangaza sababu ya hatua iliyochukuliwa. Fungua menyu ujifunze sheria, uongeze bot kwenye group au uingie kwenye paneli ya admin.';
export const BOT_SHORT_DESCRIPTION = 'Msaidizi wa group lako: sheria wazi, moderation ya links na forwards, na paneli ya faragha kwa admin.';

export const PUBLIC_COMMANDS = [
  { command: 'start', description: 'Fungua menyu ya SautiLink Pilot' },
  { command: 'about', description: 'Kuhusu SautiLink Pilot' },
  { command: 'howitworks', description: 'Jinsi moderation inavyofanya kazi' },
  { command: 'rules', description: 'Sheria za links na forwarded messages' },
  { command: 'connect', description: 'Ongeza bot kwenye group lako' },
  { command: 'developer', description: 'Mradi na taarifa za SautiLink' },
  { command: 'help', description: 'Msaada wa kutumia bot' },
  { command: 'admin', description: 'Fungua paneli ya faragha ya admin' },
  { command: 'language', description: 'Chagua Kiswahili au English' },
];

export const GROUP_COMMANDS = [
  { command: 'rules', description: 'Soma sheria za group' },
  { command: 'help', description: 'Pata msaada kwenye mazungumzo ya faragha' },
];

// Register only with Telegram's administrator command scope.
export const ADMIN_COMMANDS = [
  ...GROUP_COMMANDS,
  { command: 'admin', description: 'Fungua paneli ya faragha ya admin' },
  { command: 'language', description: 'Badili lugha ya group' },
  { command: 'status', description: 'Pokea hali ya group kwenye mazungumzo ya faragha' },
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
      text = '✦ <b>Kuhusu SautiLink Pilot</b>\n\nMsaidizi wa usimamizi wa Telegram groups. Pilot huondoa links zisizoruhusiwa na forwarded messages, huku ikifuata sheria zilezile kwa wanachama wa group.\n\nKila group lina historia yake ya makosa. Owner na admins wa group wanaendelea kusimamia maamuzi ya group lao.\n\nChagua sehemu hapa chini kujua zaidi.';
      rows = [[button('🧭 Inavyofanya kazi', 'how'), button('📋 Sheria', 'rules')], [homeButton()]];
      break;
    case 'how':
      text = '🧭 <b>Jinsi Pilot inavyofanya kazi</b>\n\n<b>1. Hukagua ujumbe</b>\nHutambua links zisizoruhusiwa na ujumbe uliotumwa kwa Forward. Ujumbe uliohaririwa hukaguliwa pia.\n\n<b>2. Huondoa ujumbe unaovunja sheria</b>\nLinks zilizoruhusiwa zinaweza kutumwa moja kwa moja. Forward bado inafuata sheria ya forwarded messages.\n\n<b>3. Hufuata hatua za adhabu</b>\nKosa la kwanza: saa 24. La pili: siku 7. La tatu: ban ya kudumu. Makosa huhesabiwa ndani ya kila group.\n\n<b>4. Hutoa sababu</b>\nBan ikithibitishwa, Pilot hutuma tangazo la hatua na sababu kwenye group. Admin anaweza kukagua hali kupitia paneli yake ya faragha.';
      rows = [[button('📋 Sheria kamili', 'rules'), button('➕ Ongeza kwenye group', 'connect')], [homeButton()]];
      break;
    case 'rules':
      text = '📋 <b>Sheria za SautiLink Pilot</b>\n\n• Links zisizoruhusiwa na forwarded messages huondolewa.\n• Kosa 1: ban saa 24. Kosa 2: siku 7. Kosa 3: ban ya kudumu. Historia ni ya kila group.\n• HTTPS za <b>sautilink.com</b> na subdomains zake zinaruhusiwa.\n• Links za <b>t.me/techhubtz</b>, <b>t.me/sautilink</b>, <b>t.me/sautilink_cloud</b> na <b>t.me/drcharlesofficial</b> zinaruhusiwa.\n• Forward haipati ruhusa kwa kuwa tu ina link iliyoruhusiwa.\n• Owner, admins, anonymous admins na ujumbe rasmi wa linked channel wameondolewa kwenye ukaguzi huu.\n\nUna swali kuhusu hatua iliyochukuliwa? Wasiliana na admin wa group lako.';
      rows = [[button('🧭 Inavyofanya kazi', 'how'), button('❔ Msaada', 'help')], [homeButton()]];
      break;
    case 'connect':
      text = '➕ <b>Ongeza Pilot kwenye group lako</b>\n\n<b>1.</b> Bonyeza kitufe hapa chini na uchague group unalosimamia.\n<b>2.</b> Mpe bot nafasi ya admin yenye ruhusa za <b>Delete messages</b> na <b>Ban users</b>.\n<b>3.</b> Tumia <b>supergroup</b> ili ban za saa 24 na siku 7 zifanye kazi.\n<b>4.</b> Ndani ya group, tuma /admin kufungua paneli yako ya faragha.\n\nHali ya group na historia za wanachama huonekana kwa wasimamizi wake waliothibitishwa.';
      rows = [[{ text: '➕ Chagua group', url: addUrl }], [button('📋 Soma sheria', 'rules'), button('🛡 Paneli ya admin', 'admin')], [homeButton()]];
      break;
    case 'developer':
      text = '⌘ <b>Mradi wa SautiLink Pilot</b>\n\nPilot ni mradi wa SautiLink kwa usimamizi wa Telegram groups.\n\nTembelea tovuti kwa taarifa za mradi, au GitHub kusoma nyaraka na msimbo wa mradi.\n\nKwa swali linalohusu adhabu au sheria katika group fulani, wasiliana na admin wa group hilo.';
      rows = [[{ text: '🌐 Tovuti ya Pilot', url: 'https://pilot.sautilink.com' }, { text: '⌘ GitHub na nyaraka', url: 'https://github.com/sautilink/pilot' }], [{ text: 'SautiLink', url: 'https://sautilink.com' }], [homeButton()]];
      break;
    case 'help':
      text = '❔ <b>Tunaweza kukusaidiaje?</b>\n\n<b>Nataka kuelewa sheria</b>\nFungua /rules au /howitworks.\n\n<b>Nataka kuongeza bot</b>\nFungua /connect kwa hatua fupi za kuanza.\n\n<b>Mimi ni admin</b>\nTuma /admin ndani ya group lako, kisha fungua kiungo cha paneli ya faragha.\n\n<b>Nimefungiwa kwenye group</b>\nWasiliana na admin wa group hilo kwa ukaguzi. Ban ya muda ikiisha, unaweza kujiunga tena; bot haikurudishi moja kwa moja.\n\nRudi /start wakati wowote kufungua menyu.';
      rows = [[button('📋 Sheria', 'rules'), button('➕ Ongeza bot', 'connect')], [button('🛡 Paneli ya admin', 'admin'), button('⌘ Mradi', 'developer')], [homeButton()]];
      break;
    case 'admin':
      if (!context.groupId) {
        text = '🛡 <b>Paneli ya faragha ya admin</b>\n\nFungua group unalosimamia na utume /admin. Bonyeza kiungo utakachopewa kurudi hapa.\n\nPilot itathibitisha kuwa wewe bado ni owner au admin kabla ya kuonyesha taarifa za group hilo.\n\nHujaongeza Pilot kwenye group? Anza hapa chini.';
        rows = [[button('➕ Unganisha group', 'connect')], [homeButton()]];
      } else {
        text = `🛡 <b>Paneli ya admin</b>\n<b>Group:</b> ${cleanName(context.groupTitle) || 'Group lako'}\n\n<b>Unaweza kukagua hapa</b>\n/status — hali ya moderation na matangazo.\n<code>/strikes USER_ID</code> — makosa ya mtumiaji katika group hili.\n\n<b>Hatua za usimamizi hutumwa ndani ya group lenyewe</b>\n/pause na /resume — sitisha au washa moderation.\n<code>/forgive USER_ID</code> — safisha historia ya makosa.\n<code>/unban USER_ID</code> — ondoa ban, hifadhi historia.\n/testnotice — tangazo la majaribio bila adhabu.\n<code>/language sw</code> au <code>/language en</code> — chagua lugha ya group.\n\nKwa amri zinazomhusu mtu, unaweza pia kujibu ujumbe wake ndani ya group. Majibu yenye taarifa za usimamizi yatakuja faraghani.\n\nKubadili group, tuma /admin katika group jingine unalosimamia.`;
        rows = [[button('↻ Hali ya group', 'status')], [button('❔ Msaada', 'help'), homeButton()]];
      }
      break;
    case 'status':
      if (!context.groupId) return renderBotPage('admin', context);
      text = `🛡 <b>Hali ya group</b>\n<b>Group:</b> ${cleanName(context.groupTitle) || 'Group lako'}\n<b>ID:</b> <code>${escapeHtml(String(context.groupId))}</code>\n\n<b>Moderation:</b> ${context.moderationEnabled ? 'imewashwa' : 'imesitishwa'}.\n<b>Aina:</b> ${context.groupType === 'supergroup' ? 'supergroup' : 'group'}.\n<b>Lugha ya group:</b> ${context.groupLanguage === 'en' ? 'English' : 'Kiswahili'}.\n<b>Ruhusa:</b> ${context.permissionsComplete ? 'zimekamilika' : 'kagua nafasi ya admin, Delete messages na Ban users'}.\n<b>Adhabu:</b> saa 24 → siku 7 → ban ya kudumu.\n\n<b>Matangazo:</b> ${escapeHtml(context.noticeSummary || 'Hakuna taarifa ya tangazo bado.')}\n\nTaarifa hizi ni za group ulilochagua pekee.`;
      rows = [[button('↻ Sasisha hali', 'status'), button('🛡 Paneli ya admin', 'admin')], [homeButton()]];
      break;
    default:
      text = `✦ <b>Karibu SautiLink Pilot${context.firstName ? `, ${cleanName(context.firstName)}` : ''}!</b>\n\nMsaidizi wa group lako kwa links, forwarded messages na sheria zilizo wazi.\n\nJifunze jinsi Pilot inavyofanya kazi, ongeza bot kwenye group, au fungua paneli yako ya admin.\n\n<b>Ungependa kuanzia wapi?</b>`;
      rows = [[button('ℹ️ Kuhusu Pilot', 'about'), button('🧭 Inavyofanya kazi', 'how')], [button('📋 Sheria', 'rules'), button('➕ Ongeza kwenye group', 'connect')], [button('❔ Msaada', 'help'), button('⌘ Mradi', 'developer')], [button('🛡 Paneli ya admin', 'admin')]];
  }

  if (page !== 'language') rows.push([button('🌐 Lugha / Language', 'language')]);
  return { text, reply_markup: { inline_keyboard: rows } };
}

export function getPublicCommands(language = 'sw') {
  if (language !== 'en') return PUBLIC_COMMANDS;
  return [
    { command: 'start', description: 'Open the SautiLink Pilot menu' },
    { command: 'about', description: 'About SautiLink Pilot' },
    { command: 'howitworks', description: 'How moderation works' },
    { command: 'rules', description: 'Rules for links and forwarded messages' },
    { command: 'connect', description: 'Add Pilot to your group' },
    { command: 'developer', description: 'The SautiLink project and documentation' },
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
  ];
}

export function getAdminCommands(language = 'sw') {
  if (language !== 'en') return ADMIN_COMMANDS;
  return [
    ...getGroupCommands('en'),
    { command: 'admin', description: 'Open your private admin panel' },
    { command: 'language', description: 'Change the group language' },
    { command: 'status', description: 'Receive group status privately' },
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
    ? 'SautiLink Pilot helps moderate Telegram groups: it removes unapproved links and forwarded messages, then announces the reason for confirmed action. Open the menu to learn the rules, add Pilot to a group, or access your private admin panel.'
    : BOT_DESCRIPTION;
}

export function getBotShortDescription(language = 'sw') {
  return language === 'en'
    ? 'Your group assistant for clear rules, link and forward moderation, and a private admin panel.'
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
      text = '✦ <b>About SautiLink Pilot</b>\n\nAn assistant for Telegram group moderation. Pilot removes unapproved links and forwarded messages, applying consistent rules to group members.\n\nEach group has its own strike history. The group’s owner and admins remain in control of moderation decisions.\n\nChoose a section below to learn more.';
      rows = [[button('🧭 How it works', 'how'), button('📋 Rules', 'rules')], [home()]];
      break;
    case 'how':
      text = '🧭 <b>How Pilot works</b>\n\n<b>1. Checks messages</b>\nPilot detects unapproved links and forwarded messages. Edited messages are checked too.\n\n<b>2. Removes rule-breaking messages</b>\nApproved links can be posted directly. Forwarded messages still follow the forwarding rule.\n\n<b>3. Applies escalating bans</b>\nFirst strike: 24 hours. Second: 7 days. Third: permanent. Strikes are counted separately for each group.\n\n<b>4. Explains the action</b>\nAfter a ban is confirmed, Pilot posts the action and reason in the group. Admins can check its status through their private panel.';
      rows = [[button('📋 Read the rules', 'rules'), button('➕ Add to a group', 'connect')], [home()]];
      break;
    case 'rules':
      text = '📋 <b>SautiLink Pilot rules</b>\n\n• Unapproved links and forwarded messages are removed.\n• First strike: 24-hour ban. Second: 7 days. Third: permanent. Each group has its own history.\n• HTTPS links to <b>sautilink.com</b> and its subdomains are allowed.\n• Links to <b>t.me/techhubtz</b>, <b>t.me/sautilink</b>, <b>t.me/sautilink_cloud</b> and <b>t.me/drcharlesofficial</b> are allowed.\n• An approved link does not exempt a forwarded message.\n• The owner, admins, anonymous admins, and official linked-channel messages are exempt from these checks.\n\nQuestions about a moderation decision? Contact your group’s admin.';
      rows = [[button('🧭 How it works', 'how'), button('❔ Help', 'help')], [home()]];
      break;
    case 'connect':
      text = '➕ <b>Add Pilot to your group</b>\n\n<b>1.</b> Tap the button below and choose a group you manage.\n<b>2.</b> Make the bot an admin with <b>Delete messages</b> and <b>Ban users</b> permissions.\n<b>3.</b> Use a <b>supergroup</b> for 24-hour and 7-day bans.\n<b>4.</b> Send /admin inside the group to open your private panel.\n\nGroup status and member histories are available only to its verified admins.';
      rows = [[{ text: '➕ Choose a group', url: `https://t.me/${username}?startgroup=true&admin=delete_messages+restrict_members` }], [button('📋 Read the rules', 'rules'), button('🛡 Admin panel', 'admin')], [home()]];
      break;
    case 'developer':
      text = '⌘ <b>The SautiLink Pilot project</b>\n\nPilot is a SautiLink project for Telegram group moderation.\n\nVisit the website for project information, or GitHub for the documentation and source code.\n\nFor questions about a ban or the rules in a particular group, contact that group’s admin.';
      rows = [[{ text: '🌐 Pilot website', url: 'https://pilot.sautilink.com' }, { text: '⌘ GitHub and docs', url: 'https://github.com/sautilink/pilot' }], [{ text: 'SautiLink', url: 'https://sautilink.com' }], [home()]];
      break;
    case 'help':
      text = '❔ <b>How can we help?</b>\n\n<b>I want to understand the rules</b>\nOpen /rules or /howitworks.\n\n<b>I want to add the bot</b>\nOpen /connect for a quick setup guide.\n\n<b>I am a group admin</b>\nSend /admin inside your group, then open the link to your private panel.\n\n<b>I was banned from a group</b>\nContact the group’s admin for a review. When a temporary ban expires you may rejoin; the bot does not add you back automatically.\n\nReturn to /start whenever you want to open the menu.';
      rows = [[button('📋 Rules', 'rules'), button('➕ Add the bot', 'connect')], [button('🛡 Admin panel', 'admin'), button('⌘ Project', 'developer')], [home()]];
      break;
    case 'admin':
      if (!context.groupId) {
        text = '🛡 <b>Your private admin panel</b>\n\nOpen a group you manage and send /admin. Tap the link you receive to return here.\n\nPilot checks that you are still the group’s owner or an admin before showing its information.\n\nHaven’t added Pilot to your group yet? Start below.';
        rows = [[button('➕ Connect a group', 'connect')], [home()]];
      } else {
        text = `🛡 <b>Admin panel</b>\n<b>Group:</b> ${cleanName(context.groupTitle) || 'Your group'}\n\n<b>Check information here</b>\n/status — moderation and announcement status.\n<code>/strikes USER_ID</code> — a member’s strikes in this group.\n\n<b>Send moderation actions inside the group itself</b>\n/pause and /resume — pause or resume moderation.\n<code>/forgive USER_ID</code> — clear strike history.\n<code>/unban USER_ID</code> — remove a ban, keep strike history.\n/testnotice — send a sample announcement with no punishment.\n<code>/language sw</code> or <code>/language en</code> — choose the group language.\n\nFor commands about a member, you can also reply to their message inside the group. Detailed admin replies are delivered privately.\n\nTo switch groups, send /admin inside another group you manage.`;
        rows = [[button('↻ Group status', 'status')], [button('❔ Help', 'help'), home()]];
      }
      break;
    case 'status':
      if (!context.groupId) return renderEnglishPage('admin', context);
      text = `🛡 <b>Group status</b>\n<b>Group:</b> ${cleanName(context.groupTitle) || 'Your group'}\n<b>ID:</b> <code>${escapeHtml(String(context.groupId))}</code>\n\n<b>Moderation:</b> ${context.moderationEnabled ? 'enabled' : 'paused'}.\n<b>Type:</b> ${context.groupType === 'supergroup' ? 'supergroup' : 'group'}.\n<b>Group language:</b> ${context.groupLanguage === 'en' ? 'English' : 'Kiswahili'}.\n<b>Permissions:</b> ${context.permissionsComplete ? 'complete' : 'check admin status, Delete messages, and Ban users'}.\n<b>Bans:</b> 24 hours → 7 days → permanent.\n\n<b>Announcements:</b> ${escapeHtml(context.noticeSummary || 'No announcement record yet.')}\n\nThis information belongs only to the group you selected.`;
      rows = [[button('↻ Refresh status', 'status'), button('🛡 Admin panel', 'admin')], [home()]];
      break;
    default:
      text = `✦ <b>Welcome to SautiLink Pilot${context.firstName ? `, ${cleanName(context.firstName)}` : ''}!</b>\n\nYour group’s assistant for links, forwarded messages, and clear rules.\n\nLearn how Pilot works, add the bot to a group, or open your admin panel.\n\n<b>Where would you like to start?</b>`;
      rows = [[button('ℹ️ About Pilot', 'about'), button('🧭 How it works', 'how')], [button('📋 Rules', 'rules'), button('➕ Add to a group', 'connect')], [button('❔ Help', 'help'), button('⌘ Project', 'developer')], [button('🛡 Admin panel', 'admin')]];
  }
  if (page !== 'language') rows.push([button('🌐 Language / Lugha', 'language')]);
  return { text, reply_markup: { inline_keyboard: rows } };
}
