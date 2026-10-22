/** Shared DOM-only views. The host supplies its authenticated request/review helpers. */
export function createCommunityToolsUI({ t, state, el, add, button, hint, card, item, field, checkbox, formCard, listCard, review, request, load, showError, timestamp, link }) {
  const label = status => ({ open: t('Wazi', 'Open'), in_progress: t('Inashughulikiwa', 'In progress'), resolved: t('Imeshughulikiwa', 'Resolved') })[status] || status;
  const supportLink = () => `https://t.me/sautilinkpilotbot?start=support_${state.chatId}`;
  function privatePrompt(content) {
    const box = el('div', 'hint'); box.append(el('p', '', t('Fungua mazungumzo binafsi na Pilot kwanza ili majibu yaweze kukufikia.', 'Open a private conversation with Pilot first so replies can reach you.')));
    const open = link(supportLink(), t('Fungua Pilot privately', 'Open Pilot privately')); if (open) box.append(open); content.append(box);
  }
  async function renderSupport(content, data) {
    const capturedChat = state.chatId, generation = state.generation;
    if (state.editing?.kind === 'support-ticket') {
      const selected = state.editing.id;
      content.append(el('div', 'loading', t('Inafungua ticket…', 'Opening ticket…')));
      try {
        const details = await request({ view: 'support_ticket', chatId: capturedChat, input: { id: selected } });
        if (capturedChat !== state.chatId || generation !== state.generation || state.view !== 'support') return;
        content.replaceChildren(); renderTicket(content, details);
      } catch (error) { if (capturedChat === state.chatId && generation === state.generation) { content.replaceChildren(button(t('Rudi kwenye tickets', 'Back to tickets'), () => { state.editing = null; load(); })); showError(error); } }
      return;
    }
    content.append(hint(t('Tuma swali au tatizo kwa admins wa group hili. Maudhui ya ticket yanaonekana kwako na admins wa sasa pekee.', 'Ask this group’s admins for help. Ticket contents are visible only to you and the current group admins.')));
    if (data.admin) content.append(formCard(t('Msaada wa members', 'Member support'), (form, fields) => {
      checkbox(form, fields, 'enabled', t('Ruhusu members kufungua tickets', 'Allow members to open support tickets'), data.enabled);
      form.append(el('p', 'card-copy', t('Kuzima intake hakufuti tickets zilizopo. Unaweza kuendelea kujibu na kuzifunga.', 'Pausing intake keeps existing tickets available for replies and resolution.')));
    }, fields => review('support_settings', { enabled: fields.enabled.checked }, [[t('Tickets mpya', 'New tickets'), fields.enabled.checked ? t('Ruhusu', 'Enabled') : t('Sitisha', 'Paused')]])));
    if (!data.contactReady) privatePrompt(content);
    if (data.enabled && data.contactReady) content.append(formCard(t('Fungua ticket', 'Open a ticket'), (form, fields) => {
      field(form, fields, 'subject', t('Swali linahusu nini?', 'What do you need help with?'), { required: true, max: 120 });
      field(form, fields, 'body', t('Maelezo', 'Details'), { type: 'textarea', required: true, max: 2000, help: t('Usitume password, token au taarifa za malipo.', 'Do not send passwords, tokens or payment details.') });
      field(form, fields, 'language', t('Lugha ya majibu', 'Reply language'), { value: t('sw', 'en'), choices: [['en', 'English'], ['sw', 'Kiswahili']] });
    }, fields => { const input = { subject: fields.subject.value.trim(), body: fields.body.value.trim(), language: fields.language.value }; review('ticket_create', input, [[t('Mada', 'Subject'), input.subject], [t('Maelezo', 'Details'), input.body]], { title: t('Kagua ticket', 'Review ticket') }); }));
    else if (!data.enabled) content.append(hint(t('Group hili halipokei tickets mpya kwa sasa.', 'This group is not accepting new tickets right now.')));
    content.append(listCard(data.admin ? t('Tickets za group', 'Group tickets') : t('Tickets zako', 'Your tickets'), data.tickets || [], row => {
      const node = item(`${row.number} · ${row.subject}`, `${timestamp(row.updated_at)} · ${label(row.status)}`, data.admin ? `${t('Member', 'Member')}: ${row.user_id}${row.claimed_by ? ` · ${t('Anashughulikia', 'Claimed by')}: ${row.claimed_by}` : ''}` : '', row.status);
      node.append(add(el('div', 'actions'), button(t('Fungua mazungumzo', 'Open conversation'), () => { state.editing = { kind: 'support-ticket', id: row.id }; load(); }, 'secondary small'))); return node;
    }, t('Tickets mpya zitaonekana hapa.', 'New tickets will appear here.')));
  }
  function renderTicket(content, data) {
    const row = data.ticket;
    content.append(button(t('Rudi kwenye tickets', 'Back to tickets'), () => { state.editing = null; load(); }, 'secondary small'));
    const header = el('div', 'card-body'); header.append(el('h2', '', `${row.number} · ${row.subject}`), el('p', 'item-meta', `${label(row.status)} · ${timestamp(row.updated_at)}`));
    const actions = el('div', 'actions');
    if (data.admin && row.status !== 'resolved') actions.append(button(t('Nitaishughulikia', 'Claim ticket'), () => review('ticket_claim', { id: row.id }, [[t('Ticket', 'Ticket'), row.number]]), 'secondary small'));
    if (row.status !== 'resolved') actions.append(button(t('Imeshughulikiwa', 'Mark resolved'), () => review('ticket_status', { id: row.id, status: 'resolved' }, [[t('Ticket', 'Ticket'), row.number], [t('Hali', 'Status'), label('resolved')]]), 'secondary small'));
    else if (data.admin) actions.append(button(t('Fungua tena', 'Reopen'), () => review('ticket_status', { id: row.id, status: 'open' }, [[t('Ticket', 'Ticket'), row.number], [t('Hali', 'Status'), label('open')]]), 'secondary small'));
    header.append(actions); content.append(card(t('Mazungumzo ya msaada', 'Support conversation'), header, 'inbox'));
    content.append(listCard(t('Ujumbe', 'Messages'), data.messages || [], message => {
      const node = item(message.author_role === 'admin' ? t('Admin wa group', 'Group admin') : t('Member', 'Member'), timestamp(message.created_at), message.body);
      if (message.delivery_status) node.append(el('p', 'item-meta', `${t('Jibu binafsi', 'Private reply')}: ${{ pending: t('Linasubiri kutumwa', 'Waiting to send'), sending: t('Linatuma', 'Sending'), sent: t('Limetumwa', 'Sent'), unknown: t('Utumaji haujathibitishwa', 'Delivery unconfirmed'), failed: t('Halijafika; linaweza kusomwa hapa', 'Could not deliver; available here'), cancelled: t('Utumaji umesitishwa', 'Delivery cancelled') }[message.delivery_status] || message.delivery_status}`));
      return node;
    }, ''));
    if (!data.contactReady && !data.admin) privatePrompt(content);
    if (row.status !== 'resolved' && (data.admin || data.contactReady)) content.append(formCard(t('Jibu ticket', 'Reply to ticket'), (form, fields) => {
      field(form, fields, 'body', t('Ujumbe wako', 'Your message'), { type: 'textarea', required: true, max: 2000 });
      form.append(el('p', 'card-copy', data.admin ? t('Jibu litawekwa kwenye ticket na kupangwa kutumwa privately kwa member.', 'The reply is saved to the ticket and queued for private delivery to the member.') : t('Jibu litaonekana kwenye inbox ya admins wa group hili.', 'Your reply will appear in this group’s admin inbox.')));
    }, fields => review('ticket_reply', { id: row.id, body: fields.body.value.trim() }, [[t('Ticket', 'Ticket'), row.number], [t('Ujumbe', 'Message'), fields.body.value.trim()]], { title: t('Kagua jibu', 'Review reply') })));
  }
  function renderDiscoverySettings(content, data) {
    const settings = data.discovery || { enabled: false, category: 'other' }, hub = data.hub || {};
    const canList = hub.visibility === 'public' && !!hub.slug && !!hub.joinUrl;
    const choices = [['technology', t('Teknolojia', 'Technology')], ['education', t('Elimu', 'Education')], ['business', t('Biashara', 'Business')], ['entertainment', t('Burudani', 'Entertainment')], ['local', t('Jumuiya za karibu', 'Local communities')], ['other', t('Nyingine', 'Other')]];
    content.append(formCard(t('Gunduliwa na members wapya', 'Be discovered by new members'), (form, fields) => {
      const enabled = checkbox(form, fields, 'enabled', t('Weka jumuiya hii kwenye Explore communities', 'List this community in Explore communities'), settings.enabled && canList);
      enabled.disabled = !canList;
      field(form, fields, 'category', t('Aina ya jumuiya', 'Community category'), { value: settings.category, choices });
      form.append(hint(canList ? t('Orodha inaonyesha maelezo ya ukurasa wako wa public pekee. Taarifa za members na moderation hazichapishwi. Unaweza kujiondoa wakati wowote.', 'The directory shows only your public community page information. Member and moderation data stay private. You can leave the directory at any time.') : t('Chapisha ukurasa kama Public na uweke join link kwanza. Kuchapisha ukurasa pekee hakuweki group kwenye orodha.', 'Publish the page as Public and add a join link first. Publishing a page alone does not list the group.')));
      const explore = link(`https://pilot.sautilink.com/communities?lang=${t('sw','en')}`, t('Angalia orodha ya jumuiya', 'Explore communities')); if (explore) form.append(explore);
    }, fields => review('discovery_save', { enabled: fields.enabled.checked, category: fields.category.value }, [[t('Kuwepo kwenye orodha', 'Directory listing'), fields.enabled.checked ? t('Itaonekana kwa kila mtu', 'Visible to everyone') : t('Haitaonekana', 'Not listed')], [t('Aina', 'Category'), choices.find(([value]) => value === fields.category.value)?.[1] || '']], { title: t('Kagua discoverability', 'Review discoverability') })));
  }
  return { renderSupport, renderDiscoverySettings };
}
