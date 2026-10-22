import { escapeHtml } from './policy.js';
import { renderBotPage } from './bot-ui.js';
import { createFeatureCommands, FEATURE_COMMANDS, ADMIN_FEATURE_COMMANDS } from './feature-commands.js';

const isAdmin = member => member?.status === 'creator' || member?.status === 'administrator';
const validId = value => Number.isSafeInteger(Number(value)) && Number(value) !== 0;
const userId = value => validId(value) && Number(value) > 0;
const groupId = value => /^-[1-9]\d*$/.test(String(value)) && validId(value);
const isGroup = chat => ['group', 'supergroup'].includes(chat?.type);
const commandPattern = /^\/(start|help|pilot|about|howitworks|rules|connect|developer|admin|status|strikes|forgive|unban|pause|resume|testnotice|language|dashboard|checklink|mystatus|appeal|history|appeals|settings|stats|alerts|report|whitelist)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/i;
const pages = { start: 'home', pilot: 'home', help: 'help', about: 'about', howitworks: 'how', rules: 'rules', connect: 'connect', developer: 'developer', language: 'language' };
const publicStartPages = new Set(['home', 'about', 'how', 'rules', 'connect', 'developer', 'help', 'language']);
const callbackPages = new Set(['home', 'about', 'how', 'rules', 'connect', 'developer', 'help', 'admin', 'status', 'language', ...FEATURE_COMMANDS]);

const copy = {
  sw: {
    openPanel: '🛡 Fungua paneli ya faragha', openPilot: '✦ Fungua Pilot', privateHelp: '❔ Msaada faraghani',
    panelPointer: 'Fungua paneli ya faragha ili kuendelea. Uanachama wako wa admin utathibitishwa huko.',
    publicPointer: 'Fungua SautiLink Pilot faraghani kwa menyu na msaada.',
    unavailable: 'Sijaweza kuthibitisha ruhusa zako kwa sasa. Jaribu tena baada ya muda.',
    deniedPanel: 'Paneli hii inapatikana kwa owner au admin wa group husika. Fungua group unalosimamia na utume /admin.',
    denied: 'Ombi hili linapatikana kwa wasimamizi wa group hili.',
    strikesUsage: 'Tumia <code>/strikes USER_ID</code> kwa ID ya mtumiaji katika group ulilochagua.',
    strikes: 'Mtumiaji <code>{user}</code>: makosa {strikes} kati ya 3 katika group hili.',
    group: 'Group lako',
    readOnly: 'Tuma /{command} ndani ya group unalosimamia. Amri hii hutekelezwa kwenye group lenyewe; majibu yake ya kina yatakuja hapa. Fungua /dashboard kwa mipangilio na ukaguzi wa matukio.',
    demo: '🧪 <b>TANGAZO LA MAJARIBIO — SautiLink Pilot</b>\n\nHuu ni mfano wa tangazo la usimamizi. Hakuna mtu aliyefungiwa, hakuna ujumbe uliofutwa, na hakuna kosa lililoongezwa.',
    demoSent: 'Tangazo la majaribio limetumwa kwenye group. Hakuna ban au kosa lililoongezwa.',
    demoFailed: 'Tangazo la majaribio halikutumwa. Kagua ruhusa za bot kutuma ujumbe kwenye group, kisha ujaribu tena.',
    demoUnknown: 'Kufika kwa tangazo la majaribio hakujathibitishwa. Kagua group kabla ya kurudia amri.',
    resumed: 'Moderation imewashwa. Nitachunguza ujumbe mpya kuanzia sasa.',
    paused: 'Moderation imesitishwa na admin. Tumia /resume ndani ya group kuiwasha.',
    targetUsage: 'Reply kwa ujumbe wa mtumiaji ndani ya group au tumia <code>/{command} USER_ID</code>. Username pekee haitoshi kutambua mtu kwa uhakika.',
    unbanUnknown: 'Kuondolewa kwa ban hakujathibitishwa. Admin kagua hali ya mtumiaji kwenye Telegram kabla ya kurudia amri.',
    unbanned: 'Ban imeondolewa. Mtumiaji anaweza kujiunga tena. Historia ya makosa imehifadhiwa.',
    forgiven: 'Historia ya makosa ya mtumiaji katika group hili imesafishwa. Tumia /unban ndani ya group ikiwa pia unataka kuondoa ban iliyopo.',
    groupLanguageUsage: 'Tuma <code>/language sw</code> kwa Kiswahili au <code>/language en</code> kwa English ndani ya group. Chaguo hili hubadili ujumbe wa group hilo pekee.',
    groupLanguageSaved: 'Lugha ya group imehifadhiwa: <b>{language}</b>. Lugha yako ya faragha ina chaguo lake tofauti kwenye /language.',
  },
  en: {
    openPanel: '🛡 Open private panel', openPilot: '✦ Open Pilot', privateHelp: '❔ Private help',
    panelPointer: 'Open the private panel to continue. Your admin role will be verified there.',
    publicPointer: 'Open SautiLink Pilot privately for the menu and help.',
    unavailable: 'I could not verify your permissions right now. Please try again shortly.',
    deniedPanel: 'This panel is available to the relevant group’s owner or admins. Open a group you manage and send /admin.',
    denied: 'This request is available to this group’s admins.',
    strikesUsage: 'Use <code>/strikes USER_ID</code> for a member of the group you selected.',
    strikes: 'Member <code>{user}</code>: {strikes} of 3 strikes in this group.',
    group: 'Your group',
    readOnly: 'Send /{command} inside the group you manage. This command runs in the group itself; detailed replies are delivered here. Open /dashboard for settings and case reviews.',
    demo: '🧪 <b>TEST ANNOUNCEMENT — SautiLink Pilot</b>\n\nThis is a sample moderation notice. Nobody was banned, no message was deleted, and no strike was added.',
    demoSent: 'The test announcement was sent to the group. No ban or strike was added.',
    demoFailed: 'The test announcement was not sent. Check the bot’s permission to send messages in the group, then try again.',
    demoUnknown: 'Delivery of the test announcement is unconfirmed. Check the group before repeating the command.',
    resumed: 'Moderation is enabled. New messages will be checked from now on.',
    paused: 'An admin paused moderation. Send /resume inside the group to enable it.',
    targetUsage: 'Reply to the member’s message inside the group or use <code>/{command} USER_ID</code>. A username alone cannot reliably identify the member.',
    unbanUnknown: 'Removal of the ban is unconfirmed. Check the member’s Telegram status before repeating the command.',
    unbanned: 'The ban was removed. The member may rejoin. Strike history was preserved.',
    forgiven: 'The member’s strike history in this group was cleared. Send /unban inside the group if you also want to remove an existing ban.',
    groupLanguageUsage: 'Send <code>/language sw</code> for Kiswahili or <code>/language en</code> for English inside the group. This changes only that group’s messages.',
    groupLanguageSaved: 'Group language saved: <b>{language}</b>. Your private language preference is separate and can be changed with /language.',
  },
};
const textFor = (language, key, values = {}) => copy[language === 'en' ? 'en' : 'sw'][key].replace(/\{([a-z]+)\}/g, (_, name) => String(values[name] ?? ''));

function noticeSummary(notice, language) {
  if (language === 'en') {
    if (!notice) return 'No announcement record yet.';
    const status = {
      sent: 'The latest announcement was sent.',
      pending: 'An announcement is waiting to be sent or retried.',
      sending: 'Announcement delivery has not yet been confirmed.',
      unknown: 'Telegram has not confirmed whether the latest announcement arrived. It is not repeated automatically to avoid duplicates.',
      failed: 'The latest announcement was not sent.',
      cancelled: 'The latest announcement was cancelled.',
    }[notice.status] || 'The latest announcement’s status is unconfirmed.';
    const detail = {
      permission: ' Check the bot’s permission to send messages.',
      permissions: ' Check the bot’s permission to send messages.',
      forbidden: ' Check the bot’s permission to send messages.',
      rate_limit: ' Telegram requested a delay before retrying.',
      invalid_topic: ' The group topic is unavailable for the announcement.',
      thread: ' The group topic is unavailable for the announcement.',
      formatting: ' Telegram did not accept the announcement’s formatting.',
      send_permission: ' Check the bot’s permission to send messages.',
      topic_unavailable: ' The group topic is unavailable for the announcement.',
      message_rejected: ' Telegram rejected the announcement message.',
      delivery_unknown: ' Delivery has not been confirmed.',
      telegram_rejected: ' Telegram rejected the request to send the announcement.',
      admin_override: ' An admin changed the member’s status.',
      membership_changed: ' The member’s status changed.',
    }[notice.error_kind] || '';
    return status + detail;
  }
  if (!notice) return 'Hakuna taarifa ya tangazo bado.';
  const summary = {
    sent: 'Tangazo la mwisho limetumwa.',
    pending: 'Tangazo linasubiri kutumwa au kujaribiwa tena.',
    sending: 'Kutumwa kwa tangazo bado hakujathibitishwa.',
    unknown: 'Telegram haijathibitisha kama tangazo la mwisho lilifika. Halirudiwi kiotomatiki ili kuepuka nakala.',
    failed: 'Tangazo la mwisho halikutumwa.',
    cancelled: 'Tangazo la mwisho limesitishwa.',
  }[notice.status] || 'Hali ya tangazo la mwisho haijathibitishwa.';
  const detail = {
    permission: ' Kagua ruhusa za bot kutuma ujumbe.',
    permissions: ' Kagua ruhusa za bot kutuma ujumbe.',
    forbidden: ' Kagua ruhusa za bot kutuma ujumbe.',
    rate_limit: ' Telegram imeomba kusubiri kabla ya kujaribu tena.',
    invalid_topic: ' Mada ya group haipatikani kwa tangazo.',
    thread: ' Mada ya group haipatikani kwa tangazo.',
    formatting: ' Telegram haikukubali muundo wa tangazo.',
    send_permission: ' Kagua ruhusa za bot kutuma ujumbe.',
    topic_unavailable: ' Mada ya group haipatikani kwa tangazo.',
    message_rejected: ' Telegram haikukubali ujumbe wa tangazo.',
    delivery_unknown: ' Kufika kwa tangazo hakujathibitishwa.',
    telegram_rejected: ' Telegram haikukubali ombi la kutuma tangazo.',
    admin_override: ' Admin amebadili hali ya mtumiaji.',
    membership_changed: ' Hali ya mtumiaji imebadilika.',
  }[notice.error_kind] || '';
  return summary + detail;
}

export function createBotExperience({ db, store, api, clock = () => Math.floor(Date.now() / 1000), me, say, control, controlStore, dispatchControl, appUrl = 'https://pilot.sautilink.com/app' }) {
  const member = (chat, user) => api.call('getChatMember', { chat_id: Number(chat), user_id: Number(user) });
  const identity = me || (() => api.call('getMe'));
  const send = say || ((chat, text, extra = {}) => api.call('sendMessage', {
    chat_id: Number(chat), text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra,
  }));
  const peer = message => message.chat?.type === 'private' && userId(message.from?.id) && Number(message.from.id) === Number(message.chat.id) && !message.sender_chat;
  const anonymous = message => isGroup(message.chat) && String(message.sender_chat?.id) === String(message.chat.id);
  const userLanguage = from => store.getLanguage('user', from.id, /^en(?:-|$)/i.test(from.language_code || '') ? 'en' : 'sw');
  const groupLanguage = chat => store.getLanguage('group', chat, 'sw');
  const replyLanguage = message => !anonymous(message) && userId(message.from?.id) ? userLanguage(message.from) : groupLanguage(message.chat.id);
  const context = (bot, from, language) => ({ username: bot.username, firstName: from?.first_name, language, appUrl });
  const features = createFeatureCommands({ store, control, dispatchControl, appUrl });
  const link = (bot, chat) => {
    const name = /^[A-Za-z0-9_]{5,32}$/.test(bot.username || '') ? bot.username : 'sautilinkpilotbot';
    return `https://t.me/${name}?start=${chat == null ? 'home' : `manage_${chat}`}`;
  };
  const panelMarkup = (bot, chat, language) => ({ inline_keyboard: [[{ text: textFor(language, 'openPanel'), url: link(bot, chat) }]] });
  const homeMarkup = (bot, language) => renderBotPage('help', context(bot, null, language)).reply_markup;

  async function quietSend(chat, text, extra = {}) {
    try { return await send(chat, text, extra); }
    catch { return null; } // A failed acknowledgement must never replay an admin action.
  }

  async function rememberAdmin(user, chat) {
    if (!controlStore?.rememberAdmin || !userId(user)) return;
    try { await controlStore.rememberAdmin(user, chat, clock()); } catch { /* Discovery must not block moderation. */ }
  }

  async function audit(message, updateId, action, targetId = null, details = {}) {
    if (!controlStore?.audit || !Number.isSafeInteger(updateId)) return;
    try {
      await controlStore.audit({ id: `command:${updateId}:${action}`, chatId: message.chat.id,
        actorId: anonymous(message) ? null : message.from.id, action, targetId, details, at: clock() });
    } catch { /* A recorded command must not be replayed because logging failed. */ }
  }

  async function pointer(message, bot, manage = false) {
    const language = await groupLanguage(message.chat.id);
    return quietSend(message.chat.id,
      textFor(language, manage ? 'panelPointer' : 'publicPointer'),
      { reply_markup: manage ? panelMarkup(bot, message.chat.id, language) : { inline_keyboard: [[{ text: textFor(language, 'openPilot'), url: link(bot) }]] } });
  }

  async function groupAuthorized(message) {
    if (anonymous(message)) return true;
    if (!userId(message.from?.id) || message.sender_chat || message.from?.is_bot) return false;
    try {
      const allowed = isAdmin(await member(message.chat.id, message.from.id));
      if (allowed) await rememberAdmin(message.from.id, message.chat.id);
      return allowed;
    }
    catch { return false; }
  }

  async function privateReply(message, bot, text, extra = {}) {
    if (message.chat.type === 'private') return quietSend(message.chat.id, text, extra);
    // sender_chat's compatibility user is never a private recipient.
    if (anonymous(message) || message.sender_chat || !userId(message.from?.id)) return pointer(message, bot, true);
    const delivered = await quietSend(message.from.id, text, extra);
    if (!delivered) await pointer(message, bot, true);
    return delivered;
  }

  async function verifySelected(user, target) {
    if (!groupId(target) || !userId(user)) return { denied: true };
    let current;
    try { current = await member(target, user); }
    catch { return { unavailable: true }; }
    if (!isAdmin(current)) return { denied: true };
    // No title or stored group data is read before a fresh role check succeeds.
    try {
      const chat = await api.call('getChat', { chat_id: Number(target) });
      if (isGroup(chat)) await rememberAdmin(user, target);
      return isGroup(chat) ? { chat } : { denied: true };
    } catch { return { unavailable: true }; }
  }

  function unavailablePage(bot, from, language, unavailable = false) {
    return {
      text: textFor(language, unavailable ? 'unavailable' : 'deniedPanel'),
      reply_markup: homeMarkup(bot, language),
    };
  }

  async function selected(user, bot, from, language) {
    const session = await store.adminContext(user);
    if (!session) return { page: renderBotPage('admin', context(bot, from, language)) };
    const result = await verifySelected(user, session.chat_id);
    if (!result.chat) {
      if (result.denied) await store.clearAdminContext(user);
      return { page: unavailablePage(bot, from, language, result.unavailable) };
    }
    return { chat: result.chat };
  }

  async function adminPage(page, bot, from, chat, language) {
    const view = { ...context(bot, from, language), groupId: chat.id, groupTitle: chat.title, groupType: chat.type };
    if (page === 'status') {
      const group = await store.group(chat.id);
      let own;
      try { own = await member(chat.id, bot.id); } catch { own = null; }
      const notice = await store.latestNotice(chat.id);
      Object.assign(view, {
        moderationEnabled: !!group.enabled,
        groupLanguage: await groupLanguage(chat.id),
        permissionsComplete: isAdmin(own) && !!own.can_delete_messages && !!own.can_restrict_members,
        noticeSummary: noticeSummary(notice, language),
      });
    }
    return renderBotPage(page, view);
  }

  async function sendPage(message, view) {
    return quietSend(message.chat.id, view.text, { reply_markup: view.reply_markup });
  }

  async function handleCommand(message, updateId) {
    const match = String(message.text || '').match(commandPattern);
    if (!match) return false;
    const bot = await identity(), command = match[1].toLowerCase(), argument = match[3]?.trim();
    if (match[2] && match[2].toLowerCase() !== String(bot.username).toLowerCase()) return true;
    if (Number.isSafeInteger(updateId) && await store.seen(updateId)) return true;
    let language = message.chat.type === 'private' && peer(message)
      ? await userLanguage(message.from) : await groupLanguage(message.chat.id);

    const featureCommand = FEATURE_COMMANDS.has(command) ? command
      : command === 'start' && ['dashboard', 'checklink', 'mystatus', 'appeal'].includes(argument) ? argument : null;
    if (featureCommand) {
      if (message.chat.type === 'private') {
        if (peer(message)) await sendPage(message, await features.render({ command: featureCommand, argument: command === 'start' ? '' : argument, from: message.from, language, updateId }));
      } else if (isGroup(message.chat)) {
        if (ADMIN_FEATURE_COMMANDS.has(featureCommand)) {
          if (await groupAuthorized(message)) {
            if (!anonymous(message)) await store.setAdminContext(message.from.id, message.chat.id, clock());
            await pointer(message, bot, true);
          } else await quietSend(message.chat.id, textFor(language, 'denied'));
        } else await pointer(message, bot);
      }
      return true;
    }

    if (command === 'start' && argument?.startsWith('manage_') && message.chat.type === 'private') {
      if (!peer(message)) return true;
      const target = argument.slice('manage_'.length);
      const result = await verifySelected(message.from.id, target);
      if (!result.chat) return await sendPage(message, unavailablePage(bot, message.from, language, result.unavailable)), true;
      await store.setAdminContext(message.from.id, result.chat.id, clock());
      await sendPage(message, await adminPage('admin', bot, message.from, result.chat, language));
      return true;
    }

    if (command === 'language' && message.chat.type === 'private' && ['sw', 'en'].includes(argument)) {
      if (!peer(message)) return true;
      await store.setLanguage('user', message.from.id, argument, clock());
      language = argument;
    }

    if (pages[command] && !(command === 'language' && isGroup(message.chat))) {
      if (message.chat.type === 'private') {
        const page = command === 'start'
          ? (argument === 'howitworks' ? 'how' : publicStartPages.has(argument) ? argument : 'home')
          : pages[command];
        if (peer(message)) await sendPage(message, renderBotPage(page, context(bot, message.from, language)));
      } else if (isGroup(message.chat)) {
        if (command === 'rules') {
          let rules = renderBotPage('rules', context(bot, null, language)).text;
          if (controlStore?.settings) {
            const settings = await controlStore.settings(message.chat.id);
            const extra = String(settings[`rules_${language}`] || '').slice(0, 600);
            if (extra) rules += `\n\n<b>${language === 'en' ? 'Additional group rules' : 'Sheria za ziada za group'}</b>\n${escapeHtml(extra)}`;
          }
          await quietSend(message.chat.id, rules, {
            reply_markup: { inline_keyboard: [[{ text: textFor(language, 'privateHelp'), url: link(bot) }]] },
          });
        } else await pointer(message, bot);
      }
      return true;
    }

    if (message.chat.type === 'private') {
      if (!peer(message)) return true;
      const choice = await selected(message.from.id, bot, message.from, language);
      if (choice.page) return await sendPage(message, choice.page), true;
      if (command === 'admin' || command === 'status') {
        await sendPage(message, await adminPage(command, bot, message.from, choice.chat, language));
      } else if (command === 'strikes') {
        if (!/^\d+$/.test(argument || '') || !userId(argument)) {
          await quietSend(message.chat.id, textFor(language, 'strikesUsage'), { reply_markup: renderBotPage('admin', { groupId: choice.chat.id, language }).reply_markup });
        } else {
          const state = await store.member(choice.chat.id, argument);
          await quietSend(message.chat.id, `<b>${escapeHtml(choice.chat.title || textFor(language, 'group'))}</b>\n${textFor(language, 'strikes', { user: Number(argument), strikes: state.strikes })}`, { reply_markup: renderBotPage('admin', { groupId: choice.chat.id, language }).reply_markup });
        }
      } else {
        await quietSend(message.chat.id, textFor(language, 'readOnly', { command }), { reply_markup: renderBotPage('admin', { groupId: choice.chat.id, language }).reply_markup });
      }
      return true;
    }

    if (!isGroup(message.chat)) return true;
    if (!await groupAuthorized(message)) {
      await quietSend(message.chat.id, textFor(language, 'denied'));
      return true;
    }
    const chat = message.chat.id;
    const personalLanguage = await replyLanguage(message);
    if (command === 'admin') { await pointer(message, bot, true); return true; }
    if (command === 'language') {
      if (!['sw', 'en'].includes(argument)) {
        await privateReply(message, bot, textFor(personalLanguage, 'groupLanguageUsage'));
      } else {
        await store.setLanguage('group', chat, argument, clock());
        if (Number.isSafeInteger(updateId)) await store.done(updateId, clock());
        await audit(message, updateId, 'language', null, { language: argument });
        await privateReply(message, bot, textFor(personalLanguage, 'groupLanguageSaved', { language: argument === 'en' ? 'English' : 'Kiswahili' }));
      }
      return true;
    }
    if (command === 'status') {
      if (anonymous(message)) { await pointer(message, bot, true); return true; }
      await store.setAdminContext(message.from.id, chat, clock());
      const view = await adminPage('status', bot, message.from, message.chat, personalLanguage);
      await privateReply(message, bot, view.text, { reply_markup: view.reply_markup });
      return true;
    }
    if (command === 'testnotice') {
      if (!Number.isSafeInteger(updateId)) return true;
      // Claim the demo before sending: retries must never produce another notice.
      await store.done(updateId, clock());
      let outcome, deliveryStatus;
      try {
        const result = await send(chat, textFor(language, 'demo'));
        if (!Number.isSafeInteger(result?.message_id)) throw new Error('Unconfirmed sample delivery');
        deliveryStatus = 'sent';
        outcome = textFor(personalLanguage, 'demoSent');
      } catch (error) {
        deliveryStatus = error?.ambiguous === false ? 'failed' : 'unknown';
        outcome = error?.ambiguous === false
          ? textFor(personalLanguage, 'demoFailed')
          : textFor(personalLanguage, 'demoUnknown');
      }
      await audit(message, updateId, 'test_notice', null, { status: deliveryStatus });
      await privateReply(message, bot, outcome);
      return true;
    }
    await store.group(chat);
    if (command === 'pause' || command === 'resume') {
      if (!Number.isSafeInteger(updateId)) return true;
      await db.batch([
        db.prepare('UPDATE groups SET enabled=?,activated_at=? WHERE chat_id=?').bind(command === 'resume' ? 1 : 0, clock(), String(chat)),
        db.prepare('INSERT OR IGNORE INTO processed_updates VALUES(?,?)').bind(updateId, clock()),
      ]);
      await audit(message, updateId, command);
      await privateReply(message, bot, textFor(personalLanguage, command === 'resume' ? 'resumed' : 'paused'));
      return true;
    }
    // Never attribute a channel's compatibility user to a real person.
    const target = argument || (!message.reply_to_message?.sender_chat && message.reply_to_message?.from?.id);
    if (!userId(target) || !/^\d+$/.test(String(target))) {
      await privateReply(message, bot, textFor(personalLanguage, 'targetUsage', { command }));
      return true;
    }
    const state = await store.member(chat, target);
    if (command === 'strikes') {
      await privateReply(message, bot, `<b>${escapeHtml(message.chat.title || textFor(personalLanguage, 'group'))}</b>\n${textFor(personalLanguage, 'strikes', { user: Number(target), strikes: state.strikes })}`);
      return true;
    }
    if (!Number.isSafeInteger(updateId)) return true;
    if (command === 'unban') {
      // Claim before Telegram's non-idempotent mutation, even on a lost response.
      await store.done(updateId, clock());
      try {
        const result = await api.call('unbanChatMember', { chat_id: chat, user_id: Number(target), only_if_banned: true });
        if (result !== true) throw new Error('Unconfirmed unban');
      }
      catch {
        await audit(message, updateId, 'member_unban_unknown', target);
        await privateReply(message, bot, textFor(personalLanguage, 'unbanUnknown'));
        return true;
      }
      await store.override(chat, target, clock(), false);
      await audit(message, updateId, 'member_unban', target);
      await privateReply(message, bot, textFor(personalLanguage, 'unbanned'));
      return true;
    }
    await store.override(chat, target, clock(), true, updateId);
    await audit(message, updateId, 'strikes_reset', target);
    await privateReply(message, bot, textFor(personalLanguage, 'forgiven'));
    return true;
  }

  async function handleCallback(query, updateId) {
    const match = String(query?.data || '').match(/^pilot:([a-z]+)(?::(sw|en))?$/);
    if (!match || (match[1] === 'lang' ? !match[2] : match[2] || !callbackPages.has(match[1]))) return false;
    // Stop Telegram's spinner before any group authorization/network lookup.
    try { await api.call('answerCallbackQuery', { callback_query_id: query.id }); } catch { /* Expired callbacks disclose nothing. */ }
    const message = query.message;
    if (!message?.chat || !userId(query.from?.id)) return true;
    if (Number.isSafeInteger(updateId) && await store.seen(updateId)) return true;
    const bot = await identity();
    if (message.from && Number(message.from.id) !== Number(bot.id)) return true;
    if (isGroup(message.chat)) {
      await pointer(message, bot);
      return true;
    }
    if (message.chat.type !== 'private' || Number(query.from.id) !== Number(message.chat.id) || !Number.isSafeInteger(message.message_id)) return true;
    let language = await userLanguage(query.from);
    let view;
    if (match[1] === 'lang') {
      language = match[2];
      await store.setLanguage('user', query.from.id, language, clock());
      view = renderBotPage('language', context(bot, query.from, language));
    } else if (FEATURE_COMMANDS.has(match[1])) {
      view = await features.render({ command: match[1], from: query.from, language, updateId });
    } else if (match[1] === 'admin' || match[1] === 'status') {
      const choice = await selected(query.from.id, bot, query.from, language);
      view = choice.page || await adminPage(match[1], bot, query.from, choice.chat, language);
    } else view = renderBotPage(match[1], context(bot, query.from, language));
    try {
      await api.call('editMessageText', {
        chat_id: message.chat.id, message_id: message.message_id, text: view.text,
        parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: view.reply_markup,
      });
    } catch (error) {
      if (error?.code === 400 && /message is not modified/i.test(error.message || '')) return true;
      // An ambiguous edit may have succeeded. Only a definite rejection permits a new message.
      if (error?.ambiguous === false) await quietSend(message.chat.id, view.text, { reply_markup: view.reply_markup });
    }
    return true;
  }

  return { handleCommand, handleCallback };
}
