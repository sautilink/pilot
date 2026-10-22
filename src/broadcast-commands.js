import { escapeHtml } from './policy.js';

const positive = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const realPeer = message => message?.chat?.type === 'private' && Number.isSafeInteger(message.from?.id) && message.from.id > 0 && message.chat.id === message.from.id && !message.sender_chat && message.from.is_bot === false;
const commandPattern = /^\/(updates|broadcast|claimowner|myid)(?:@([A-Za-z0-9_]+))?(?:([\t\r\n ]+)([\s\S]*))?$/i;
const callbackPattern = /^pilot:bc:(panel|compose|stop|preview|confirm|cancel|edit|status)(?::([a-f0-9]{24}))?$/;
const MEDIA = [['animation', 'sendAnimation'], ['video', 'sendVideo'], ['document', 'sendDocument'], ['audio', 'sendAudio'], ['voice', 'sendVoice']];
const METHODS = new Set(['sendMessage', 'sendPhoto', ...MEDIA.map(([, method]) => method)]);
const FORMATTING = new Set(['bold', 'italic', 'underline', 'strikethrough', 'spoiler', 'blockquote', 'expandable_blockquote', 'code', 'pre']);
const SERVICE_FIELDS = ['new_chat_members', 'left_chat_member', 'new_chat_title', 'new_chat_photo', 'delete_chat_photo', 'group_chat_created', 'supergroup_chat_created', 'channel_chat_created', 'migrate_to_chat_id', 'migrate_from_chat_id', 'pinned_message', 'message_auto_delete_timer_changed', 'forum_topic_created', 'forum_topic_edited', 'forum_topic_closed', 'forum_topic_reopened', 'general_forum_topic_hidden', 'general_forum_topic_unhidden', 'video_chat_scheduled', 'video_chat_started', 'video_chat_ended', 'video_chat_participants_invited', 'users_shared', 'chat_shared', 'write_access_allowed', 'web_app_data', 'successful_payment', 'refunded_payment', 'proximity_alert_triggered', 'boost_added', 'chat_background_set', 'giveaway_created', 'giveaway_completed'];
const fail = code => { const error = new Error(code); error.code = code; throw error; };
const safe = value => escapeHtml(String(value ?? ''));
const numeric = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const actorFor = (from, chat) => ({ id: from.id, is_bot: false, username: from.username, first_name: from.first_name, language_code: from.language_code, chatId: chat.id, chatType: 'private' });

function contentEntities(entities, originalLength, start = 0) {
  if (entities === undefined) return undefined;
  if (!Array.isArray(entities) || entities.length > 100) fail('unsupported_content');
  const result = [];
  for (const source of entities) {
    if (!source || typeof source.type !== 'string' || !Number.isInteger(source.offset) || !Number.isInteger(source.length) || source.offset < 0 || source.length < 1 || source.offset + source.length > originalLength) fail('unsupported_content');
    if (source.offset + source.length <= start) continue;
    if (source.offset < start && !FORMATTING.has(source.type)) continue;
    const entity = structuredClone(source);
    const left = Math.max(start, source.offset);
    entity.offset = left - start;
    entity.length = source.offset + source.length - left;
    result.push(entity);
  }
  return result.length ? result : undefined;
}

/** Freeze an owner's original message using Telegram file IDs and native entities.
 * The broadcast service validates this independently before storing it.
 */
export function snapshotBroadcastContent(message, { textStart = 0 } = {}) {
  if (!message || message.edit_date || message.media_group_id || message.has_protected_content || message.forward_origin || message.forward_date || message.forward_from || message.forward_from_chat || message.is_automatic_forward || message.paid_media || message.is_paid_post || SERVICE_FIELDS.some(key => message[key] !== undefined)) fail('unsupported_content');
  if (!Number.isInteger(textStart) || textStart < 0) fail('unsupported_content');
  if (typeof message.text === 'string') {
    const text = message.text.slice(textStart);
    if (!text.trim() || text.length > 4096) fail('unsupported_content');
    const entities = contentEntities(message.entities, message.text.length, textStart);
    return { method: 'sendMessage', params: { text, ...(entities ? { entities } : {}), link_preview_options: { is_disabled: true } } };
  }
  let field, method, fileId;
  if (Array.isArray(message.photo) && message.photo.length) {
    field = 'photo'; method = 'sendPhoto'; fileId = message.photo.at(-1)?.file_id;
  } else {
    const media = MEDIA.find(([key]) => message[key]);
    if (media) { [field, method] = media; fileId = message[field]?.file_id; }
  }
  if (!method || typeof fileId !== 'string' || !/^[A-Za-z0-9_-]{1,2048}$/.test(fileId)) fail('unsupported_content');
  const params = { [field]: fileId };
  if (message.caption !== undefined) {
    if (typeof message.caption !== 'string' || message.caption.length > 1024) fail('unsupported_content');
    params.caption = message.caption;
    const entities = contentEntities(message.caption_entities, message.caption.length);
    if (entities) params.caption_entities = entities;
  }
  if (['photo', 'video', 'animation'].includes(field)) {
    if (message.has_media_spoiler === true) params.has_spoiler = true;
    if (message.show_caption_above_media === true) params.show_caption_above_media = true;
  }
  return { method, params };
}

const COPY = {
  sw: {
    denied: 'Ombi hili halipatikani kwa akaunti hii.', unavailable: 'Sijaweza kukamilisha ombi hili kwa sasa. Fungua /updates kukagua hali kabla ya kurudia.',
    panel: '📣 <b>Updates za SautiLink Pilot</b>', panelIntro: 'Hii ni sehemu yako ya matangazo kwa groups zinazolengwa. Tangazo hutumwa baada ya kulikagua na kuthibitisha.',
    targets: 'Groups zinazolengwa', frozen: 'Walengwa hawa wamehifadhiwa pamoja na rasimu. Groups mpya zitaingia kwenye tangazo linalofuata.',
    new: '✍️ Andika tangazo', refresh: '↻ Sasisha', home: '⌂ Mwanzo', compose: '✍️ <b>Andaa tangazo</b>\n\nTuma ujumbe mmoja: maandishi, picha, video, document, animation, audio au voice. Unaweza kuongeza caption na muundo wa Telegram.\n\nNitakuonyesha muonekano wake na idadi ya groups zinazolengwa kabla ya kuthibitisha. Hatua hii inaisha baada ya dakika 15.',
    stopCompose: '✕ Sitisha kuandika', stopped: 'Kuandaa tangazo kumesitishwa.',
    unsupported: 'Aina hiyo haiwezi kutumika kwa tangazo hili. Tuma ujumbe mpya mmoja wa maandishi, picha, video, document, animation, audio au voice. Albums, forwards, ujumbe uliolindwa na service messages hazitumiki.',
    confirmTitle: '📣 <b>Kagua kabla ya kutuma</b>', confirmText: 'Ukithibitisha, nakala hii ya tangazo itatumwa kwa groups zilizoorodheshwa kuwa walengwa. Ruhusa na uwepo wa bot vitakaguliwa wakati wa kutuma.',
    confirm: '✓ Thibitisha na tuma', edit: '✎ Badili maudhui', cancel: '✕ Ghairi tangazo', statusButton: '▥ Hali ya tangazo', previewAgain: '👁 Fungua muonekano',
    previewFailed: 'Muonekano wa tangazo haujakamilika. Hakuna group lililotumiwa. Fungua muonekano tena hapa chini kabla ya kuthibitisha.',
    alreadyPreviewed: 'Muonekano huu tayari umetumwa. Tumia kitufe cha kuthibitisha kwenye ujumbe wake wa awali. Unaweza pia kubadili maudhui au kughairi.',
    queued: '✓ <b>Tangazo limewekwa kwenye foleni</b>\n\nKutuma kutaendelea kwa awamu. Unaweza kufuatilia hali au kusimamisha walengwa ambao bado hawajashughulikiwa. Ujumbe uliotumwa tayari hauondolewi kwa kughairi.',
    cancelled: 'Tangazo limeghairiwa. Ujumbe uliotumwa tayari haujaondolewa; walengwa ambao hawajashughulikiwa watasitishwa.',
    statusTitle: '▥ <b>Hali ya tangazo</b>', id: 'ID', state: 'Hali', created: 'Limeandaliwa', expires: 'Mwisho wa kuthibitisha',
    draft: 'linasubiri kuthibitishwa', running: 'linatumwa', completed: 'limekamilika', cancelledState: 'limeghairiwa', expired: 'muda wa rasimu umeisha',
    sent: 'Yaliyofika', failed: 'Yaliyokataliwa', skipped: 'Yaliyorukwa', unknown: 'Hayajathibitishwa', pending: 'Yanasubiri / yanashughulikiwa', cancelledDelivery: 'Yaliyositishwa',
    unknownHelp: 'Matokeo yasiyothibitishwa hayarudiwi kiotomatiki ili kuzuia nakala mbili.', none: 'Hakuna tangazo la hivi karibuni.', recent: 'Matangazo ya hivi karibuni', composing: 'Una hatua ya kuandika tangazo inayoendelea.',
    claimUsage: 'Tuma code ya kuunganisha kupitia <code>/claimowner CODE</code> hapa faraghani. Code inapatikana kwenye ukurasa wa usanidi uliolindwa.',
    claimed: '✓ Akaunti yako imeunganishwa kama mmiliki wa Pilot. Utambulisho umefungwa kwa Telegram ID yako. Fungua /updates kuandaa matangazo.',
    claimFailed: 'Kuunganisha akaunti hakujakubaliwa. Kagua akaunti na code kwenye ukurasa wa usanidi uliolindwa. Code haitarudishwa kwenye ujumbe huu.',
    myId: 'Telegram ID yako', stale: 'Hatua hii haipatikani tena kwa rasimu hiyo. Fungua /updates kukagua hali ya sasa.',
  },
  en: {
    denied: 'This request is not available to this account.', unavailable: 'I could not complete this request right now. Open /updates to check the status before repeating it.',
    panel: '📣 <b>SautiLink Pilot updates</b>', panelIntro: 'Your announcement area for target groups. A broadcast is sent only after you preview and confirm it.',
    targets: 'Target groups', frozen: 'This audience is saved with the draft. New groups will be included in a later broadcast.',
    new: '✍️ Write an announcement', refresh: '↻ Refresh', home: '⌂ Home', compose: '✍️ <b>Prepare an announcement</b>\n\nSend one message: text, photo, video, document, animation, audio or voice. You can add a caption and native Telegram formatting.\n\nI will show its preview and target-group count before you confirm. This composition step expires after 15 minutes.',
    stopCompose: '✕ Stop composing', stopped: 'Announcement composition stopped.',
    unsupported: 'That content cannot be used for this broadcast. Send one new text, photo, video, document, animation, audio or voice message. Albums, forwarded or protected content, and service messages are not supported.',
    confirmTitle: '📣 <b>Review before sending</b>', confirmText: 'Confirming sends this saved announcement to the target groups. The bot’s membership and permissions are checked at delivery.',
    confirm: '✓ Confirm and send', edit: '✎ Change content', cancel: '✕ Cancel broadcast', statusButton: '▥ Broadcast status', previewAgain: '👁 Open preview',
    previewFailed: 'The preview is incomplete. No group has received this broadcast. Open the preview again below before confirming.',
    alreadyPreviewed: 'This preview was already sent. Use the confirm button on its original message. You can also change its content or cancel.',
    queued: '✓ <b>Broadcast queued</b>\n\nDelivery will continue in batches. You can follow its progress or stop targets that have not been processed. Cancelling does not remove messages already sent.',
    cancelled: 'Broadcast cancelled. Messages already sent remain; targets that have not been processed will be stopped.',
    statusTitle: '▥ <b>Broadcast status</b>', id: 'ID', state: 'State', created: 'Prepared', expires: 'Confirm before',
    draft: 'awaiting confirmation', running: 'sending', completed: 'completed', cancelledState: 'cancelled', expired: 'draft expired',
    sent: 'Delivered', failed: 'Rejected', skipped: 'Skipped', unknown: 'Unconfirmed', pending: 'Pending / in progress', cancelledDelivery: 'Cancelled targets',
    unknownHelp: 'Unconfirmed deliveries are not repeated automatically, preventing duplicate messages.', none: 'No recent broadcasts.', recent: 'Recent broadcasts', composing: 'You have an active composition step.',
    claimUsage: 'Send the pairing code using <code>/claimowner CODE</code> here privately. Obtain the code from the protected setup page.',
    claimed: '✓ Your account is now bound as Pilot’s owner using your permanent Telegram ID. Open /updates to prepare announcements.',
    claimFailed: 'Account pairing was not accepted. Check the account and code on the protected setup page. The code is not repeated in this reply.',
    myId: 'Your Telegram ID', stale: 'That action is no longer available for this draft. Open /updates to check its current status.',
  },
};
const button = (text, action, id) => ({ text, callback_data: `pilot:bc:${action}${id ? `:${id}` : ''}` });
const languageOf = (store, from) => store.getLanguage('user', from.id, /^en(?:-|$)/i.test(from.language_code || '') ? 'en' : 'sw');
const formattedTime = (time, language) => positive(time) ? new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'sw-TZ', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Dar_es_Salaam' }).format(Number(time) * 1000) + ' EAT' : '—';

export function createBroadcastCommands({ store, api, owner, dispatchBroadcast, clock = () => Math.floor(Date.now() / 1000), me, send }) {
  const identity = me || (() => api.call('getMe'));
  const say = send || ((chat, text, extra = {}) => api.call('sendMessage', { chat_id: Number(chat), text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra }));
  const isOwner = async actor => { try { return !!(owner && await owner.isOwner(actor)); } catch { return false; } };
  const dispatch = async (actor, action, input = {}) => {
    if (!dispatchBroadcast) fail('unavailable');
    return dispatchBroadcast({ actor, action, input });
  };
  async function reply(actor, text, rows = []) {
    try { return await say(actor.id, text, rows.length ? { reply_markup: { inline_keyboard: rows } } : {}); } catch { return null; }
  }
  function navigation(t) { return [[button(t.refresh, 'panel')], [{ text: t.home, callback_data: 'pilot:home' }]]; }
  function draftButtons(draft, t, { confirmation = false } = {}) {
    const rows = [];
    if (draft.status === 'draft') {
      if (confirmation) rows.push([button(t.confirm, 'confirm', draft.id)]);
      else if (!draft.preview_message_id) rows.push([button(t.previewAgain, 'preview', draft.id)]);
      rows.push([button(t.edit, 'edit', draft.id), button(t.cancel, 'cancel', draft.id)]);
    } else if (draft.status === 'running') rows.push([button(t.cancel, 'cancel', draft.id)]);
    rows.push([button(t.statusButton, 'status', draft.id)]);
    return rows;
  }
  function draftText(draft, language) {
    const t = COPY[language], counts = draft.counts || {};
    const status = ({ draft: t.draft, running: t.running, completed: t.completed, cancelled: t.cancelledState, expired: t.expired })[draft.status] || t.unknown;
    const lines = [t.statusTitle, `${t.id}: <code>${safe(draft.id)}</code>`, `${t.state}: <b>${status}</b>`, `${t.targets}: <b>${numeric(draft.candidateCount)}</b>`];
    if (draft.created_at) lines.push(`${t.created}: ${safe(formattedTime(draft.created_at, language))}`);
    if (draft.status === 'draft') lines.push(`${t.expires}: ${safe(formattedTime(draft.expires_at, language))}`, '', draft.preview_message_id ? t.alreadyPreviewed : t.previewFailed);
    else lines.push('', `${t.sent}: ${numeric(counts.sent)}`, `${t.failed}: ${numeric(counts.failed)}`, `${t.skipped}: ${numeric(counts.skipped)}`, `${t.unknown}: ${numeric(counts.unknown)}`, `${t.pending}: ${numeric(counts.pending) + numeric(counts.checking) + numeric(counts.sending)}`, `${t.cancelledDelivery}: ${numeric(counts.cancelled)}`, '', t.unknownHelp);
    return lines.join('\n');
  }
  async function showStatus(actor, id, language) {
    const { draft } = await dispatch(actor, 'draft_get', { id });
    await reply(actor, draftText(draft, language), [...draftButtons(draft, COPY[language]), ...navigation(COPY[language])]);
  }
  async function showPanel(actor, language) {
    const panel = await dispatch(actor, 'panel'), t = COPY[language];
    const lines = [t.panel, '', t.panelIntro, '', `${t.targets}: <b>${numeric(panel.candidateCount)}</b>`];
    if (panel.composition?.awaitingContent) lines.push('', t.composing);
    const rows = [[button(t.new, 'compose')]];
    if (panel.composition?.awaitingContent) rows.push([button(t.stopCompose, 'stop')]);
    if (panel.active) {
      lines.push('', draftText(panel.active, language));
      rows.push(...draftButtons(panel.active, t));
    } else if (!panel.recent?.length) lines.push('', t.none);
    const recent = (panel.recent || []).filter(draft => draft.id !== panel.active?.id).slice(0, 3);
    if (recent.length) {
      lines.push('', `<b>${t.recent}</b>`);
      for (const draft of recent) {
        const state = ({ draft: t.draft, running: t.running, completed: t.completed, cancelled: t.cancelledState, expired: t.expired })[draft.status] || t.unknown;
        lines.push(`• <code>${safe(draft.id)}</code> — ${state}`);
        rows.push([button(`${t.statusButton} · ${draft.id.slice(0, 6)}`, 'status', draft.id)]);
      }
    }
    await reply(actor, lines.join('\n'), [...rows, ...navigation(t)]);
  }
  async function compose(actor, language, replaceDraftId) {
    await dispatch(actor, 'compose_start', replaceDraftId ? { replaceDraftId } : {});
    await reply(actor, COPY[language].compose, [[button(COPY[language].stopCompose, 'stop')], ...navigation(COPY[language])]);
  }
  async function preview(actor, draft, language) {
    const t = COPY[language];
    if (draft.status !== 'draft' || Number(draft.expires_at) <= clock() || draft.preview_message_id) {
      await reply(actor, draftText(draft, language), [...draftButtons(draft, t), ...navigation(t)]);
      return;
    }
    if (!METHODS.has(draft.content?.method)) fail('unsupported_content');
    try {
      const native = await api.call(draft.content.method, { ...draft.content.params, chat_id: actor.id });
      if (!Number.isSafeInteger(native?.message_id) || native.message_id <= 0 || native.chat?.id !== actor.id) fail('preview_unconfirmed');
      const confirmation = await reply(actor, [t.confirmTitle, '', `${t.targets}: <b>${numeric(draft.candidateCount)}</b>`, t.frozen, '', t.confirmText, '', `${t.expires}: ${safe(formattedTime(draft.expires_at, language))}`].join('\n'), draftButtons(draft, t, { confirmation: true }));
      if (!Number.isSafeInteger(confirmation?.message_id) || confirmation.message_id <= 0 || confirmation.chat?.id !== actor.id) fail('preview_unconfirmed');
      await dispatch(actor, 'preview_set', { id: draft.id, messageId: confirmation.message_id });
    } catch {
      await reply(actor, t.previewFailed, [[button(t.previewAgain, 'preview', draft.id), button(t.cancel, 'cancel', draft.id)], ...navigation(t)]);
    }
  }
  async function create(actor, message, updateId, language, textStart = 0) {
    if (!Number.isSafeInteger(updateId)) fail('invalid_update');
    const content = snapshotBroadcastContent(message, { textStart });
    const { draft } = await dispatch(actor, 'draft_create', { content, sourceUpdateId: updateId });
    await preview(actor, draft, language);
  }
  async function errorReply(actor, error, language) {
    const t = COPY[language];
    const denied = ['owner_required', 'forbidden', 'unauthorized'].includes(error?.code);
    const stale = ['not_found', 'draft_not_found', 'draft_expired', 'draft_not_pending', 'draft_active', 'broadcast_active', 'broadcast_busy', 'preview_required', 'preview_mismatch', 'preview_already_set', 'broadcast_not_editable'].includes(error?.code);
    await reply(actor, denied ? t.denied : ['unsupported_content', 'invalid_content'].includes(error?.code) ? t.unsupported : stale ? t.stale : t.unavailable, denied ? [] : navigation(t));
  }

  async function handleMessage(message, updateId) {
    const match = String(message?.text || '').match(commandPattern);
    if (!match && /^\//.test(String(message?.text || ''))) return false; // Commands are never draft content.
    if (!realPeer(message) || message.edit_date) return !!match;
    if (Number.isSafeInteger(updateId) && await store.seen(updateId)) return !!match;
    const actor = actorFor(message.from, message.chat), language = await languageOf(store, message.from), t = COPY[language];
    if (match?.[2] && match[2].toLowerCase() !== String((await identity()).username).toLowerCase()) return true;
    const command = match?.[1].toLowerCase(), argument = match?.[4] || '';
    if (command === 'myid') { await reply(actor, `${t.myId}: <code>${actor.id}</code>`); return true; }
    if (command === 'claimowner') {
      if (!argument.trim() || argument.trim().length > 256) { await reply(actor, t.claimUsage); return true; }
      if (message.forward_origin || message.forward_date || message.forward_from || message.forward_from_chat || message.has_protected_content) { await reply(actor, t.claimFailed); return true; }
      try {
        const result = await dispatch(actor, 'claim', { code: argument.trim() });
        if (!result?.ok) fail('owner_claim_invalid');
        await reply(actor, t.claimed, [[button(t.panel.replace(/<[^>]*>/g, ''), 'panel')]]);
      }
      catch { await reply(actor, t.claimFailed); }
      return true;
    }
    if (!await isOwner(actor)) {
      if (match) await reply(actor, t.denied);
      return !!match;
    }
    try {
      if (command === 'updates') await showPanel(actor, language);
      else if (command === 'broadcast') {
        if (message.forward_origin || message.forward_date || message.forward_from || message.forward_from_chat || message.has_protected_content) fail('unsupported_content');
        if (argument.trim()) await create(actor, message, updateId, language, message.text.length - argument.length);
        else await compose(actor, language);
      } else {
        if (!dispatchBroadcast) return false;
        const state = await dispatch(actor, 'compose_state');
        if (!state.awaitingContent && !state.composition?.awaitingContent) return false;
        await create(actor, message, updateId, language);
      }
    } catch (error) { await errorReply(actor, error, language); }
    return true;
  }

  async function handleCallback(query, updateId) {
    const match = String(query?.data || '').match(callbackPattern);
    if (!match) return false;
    // Close the spinner even for unusable or copied callback buttons.
    try { await api.call('answerCallbackQuery', { callback_query_id: query.id }); } catch { /* Expired acknowledgements disclose nothing. */ }
    const message = query.message;
    if (!message || !realPeer({ ...message, from: query.from }) || !Number.isSafeInteger(message.message_id) || message.message_id <= 0 || message.date === 0 || message.from?.is_bot !== true || !Number.isSafeInteger(message.from?.id) || message.from.id !== (await identity()).id) return true;
    if (Number.isSafeInteger(updateId) && await store.seen(updateId)) return true;
    const actor = actorFor(query.from, message.chat), language = await languageOf(store, query.from), t = COPY[language];
    if (!await isOwner(actor)) { await reply(actor, t.denied); return true; }
    const [, action, id] = match;
    if (['panel', 'compose', 'stop'].includes(action) ? !!id : !id) return true;
    try {
      if (action === 'panel') await showPanel(actor, language);
      else if (action === 'compose') await compose(actor, language);
      else if (action === 'stop') { await dispatch(actor, 'compose_clear'); await reply(actor, t.stopped, navigation(t)); }
      else if (action === 'status') await showStatus(actor, id, language);
      else if (action === 'edit') await compose(actor, language, id);
      else if (action === 'preview') { const { draft } = await dispatch(actor, 'draft_get', { id }); await preview(actor, draft, language); }
      else if (action === 'cancel') {
        const result = await dispatch(actor, 'cancel', { id });
        if (!result?.ok) fail('unavailable');
        await reply(actor, result.draft?.status && result.draft.status !== 'cancelled' ? draftText(result.draft, language) : t.cancelled, [[button(t.statusButton, 'status', id)], ...navigation(t)]);
      }
      else if (action === 'confirm') {
        const result = await dispatch(actor, 'confirm', { id, previewMessageId: message.message_id });
        if (!result?.ok) fail('unavailable');
        await reply(actor, result.draft?.status && result.draft.status !== 'running' ? draftText(result.draft, language) : t.queued, [[button(t.statusButton, 'status', id), button(t.cancel, 'cancel', id)], ...navigation(t)]);
      }
    } catch (error) { await errorReply(actor, error, language); }
    return true;
  }
  return { handleMessage, handleCallback, isOwner };
}
