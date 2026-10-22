// Serialized into the existing authenticated tools client; all content uses DOM text nodes.
export function renderEnhancedEvents(content, data, ui) {
  const { t, language, state, el, add, button, hint, card, field, formCard, listCard, item, link, review, load, request, showError, toast, statusLabel, eventTimestamp, eventLocalTime } = ui;
  const timezone = data.timezone || 'Africa/Dar_es_Salaam';
  const moment = value => new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'sw-TZ', { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(Number(value) * 1000)) + ` · ${timezone}`;
  const local = value => eventLocalTime(Number(value) || Math.floor(Date.now() / 1000) + 3600, timezone);
  const answerLabel = value => value === 'waitlisted' ? t('Orodha ya kusubiri', 'Waiting list') : statusLabel(value);
  const leadLabel = value => value === 1440 ? t('Siku 1 kabla', '1 day before') : value === 60 ? t('Saa 1 kabla', '1 hour before') : t(`Dakika ${value} kabla`, `${value} minutes before`);
  const editing = state.editing?.kind === 'event' ? state.editing.row : null;

  content.append(hint(t('Chagua RSVP yako, pakua calendar au jiunge na vikumbusho binafsi. Ukiwa kwenye waiting list, nafasi itathibitishwa ikipatikana.', 'Choose your RSVP, download a calendar entry or opt in to private reminders. A waiting-list place is confirmed when space becomes available.')));
  if (state.admin) {
    content.append(formCard(t('Timezone ya events', 'Events timezone'), (form, fields) => {
      field(form, fields, 'eventTimezone', t('Timezone ya group', 'Group timezone'), { value: timezone, required: true, max: 80, help: t('Mfano: Africa/Dar_es_Salaam, Europe/London au America/New_York. Kubadili timezone hakubadili muda halisi wa event iliyohifadhiwa.', 'For example: Africa/Dar_es_Salaam, Europe/London or America/New_York. Changing timezone keeps existing events at the same instant.') });
    }, fields => {
      const zone = fields.eventTimezone.value.trim();
      try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(new Date()); } catch { throw new Error('invalid_timezone'); }
      review('event_settings', { timezone: zone }, [[t('Timezone', 'Timezone'), zone]]);
    }));
    content.append(formCard(editing ? t('Hariri event', 'Edit event') : t('Event mpya', 'New event'), (form, fields) => {
      field(form, fields, 'title', t('Jina la event', 'Event title'), { value: editing?.title || '', required: true, max: 160 });
      field(form, fields, 'description', t('Maelezo', 'Description'), { type: 'textarea', value: editing?.description || '', max: 1500 });
      field(form, fields, 'startsAt', t(`Inaanza · ${timezone}`, `Starts · ${timezone}`), { type: 'datetime-local', required: true, value: local(editing?.starts_at) });
      field(form, fields, 'endsAt', t(`Inaisha · ${timezone}`, `Ends · ${timezone}`), { type: 'datetime-local', value: local(editing?.ends_at || Number(editing?.starts_at || Math.floor(Date.now() / 1000) + 3600) + 3600) });
      const capacity = field(form, fields, 'capacity', t('Idadi ya nafasi (si lazima)', 'Capacity (optional)'), { type: 'number', min: 1, step: 1, value: editing?.capacity ?? '', help: t('Acha wazi kama hakuna kikomo cha nafasi. Ukiweka kikomo, maombi yanayozidi yataingia waiting list. Hadi nafasi 2,000.', 'Leave empty for no seat limit. When capacity is reached, further requests join the waiting list. Up to 2,000 places.') });
      capacity.max = '2000';
      field(form, fields, 'url', t('Link ya HTTPS (si lazima)', 'HTTPS link (optional)'), { type: 'url', max: 1000, value: editing?.url || '' });
      field(form, fields, 'language', t('Lugha', 'Language'), { value: editing?.language || language, choices: [['en', 'English'], ['sw', 'Kiswahili']] });
    }, fields => {
      const startsAt = eventTimestamp(fields.startsAt.value, timezone);
      const input = { title: fields.title.value.trim(), description: fields.description.value.trim(), startsAt, endsAt: fields.endsAt.value ? eventTimestamp(fields.endsAt.value, timezone) : startsAt + 3600, capacity: fields.capacity.value === '' ? null : Number(fields.capacity.value), url: fields.url.value.trim(), language: fields.language.value, ...(editing ? { id: editing.id } : {}) };
      review(editing ? 'event_update' : 'event_create', input, [[t('Event', 'Event'), input.title], [t('Maelezo', 'Description'), input.description], [t('Inaanza', 'Starts'), moment(input.startsAt)], [t('Inaisha', 'Ends'), moment(input.endsAt)], [t('Nafasi', 'Capacity'), input.capacity ?? t('Hakuna kikomo cha nafasi', 'No seat limit')], ['Link', input.url || '—']], { warning: editing ? t('Members waliochagua vikumbusho watapokea taarifa binafsi ya mabadiliko.', 'Members who opted in to reminders receive a private update.') : '' });
    }));
  }

  content.append(listCard(t('Events za group', 'Group events'), data.events || [], row => {
    const node = item(row.title, moment(row.starts_at), row.description, row.status), counts = row.counts || {};
    const own = row.response;
    node.append(el('p', 'item-meta', `${t('Wanahudhuria', 'Going')}: ${Number(counts.going || 0)}${row.capacity ? ` / ${row.capacity}` : ''} · ${t('Wanasubiri', 'Waiting')}: ${Number(row.waiting || 0)} · ${t('Labda', 'Maybe')}: ${Number(counts.maybe || 0)}${own ? ` · ${t('Jibu lako', 'Your answer')}: ${answerLabel(own)}` : ''}`));
    if (row.url) { const resource = link(row.url, t('Maelezo ya event', 'Event details')); if (resource) node.append(resource); }
    const actions = el('div', 'actions');
    const calendar = button(t('Ongeza kwenye calendar', 'Add to calendar'), async () => {
      if (state.busy) return;
      const chat = state.chatId; calendar.disabled = true;
      try {
        const result = await request({ view: 'event_calendar', chatId: chat, input: { id: row.id } });
        if (state.chatId !== chat) return;
        if (typeof result.content !== 'string' || !result.content.startsWith('BEGIN:VCALENDAR') || !/^pilot-event-[a-f0-9]{24}\.ics$/.test(result.filename)) throw new Error('unavailable');
        const destination = URL.createObjectURL(new Blob([result.content], { type: 'text/calendar;charset=utf-8' }));
        const anchor = el('a'); anchor.href = destination; anchor.download = result.filename; document.body.append(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(destination), 30000);
        toast(t('Fungua file la calendar kwenye programu yako ya calendar. Updates za baadaye zinaweza kuhitaji kupakua file jipya.', 'Open the calendar file in your calendar app. Later event updates may require a fresh download.'));
      } catch (error) { showError(error); } finally { calendar.disabled = false; }
    }, 'secondary small');
    actions.append(calendar);
    if (row.status !== 'cancelled' && Number(row.ends_at) > Date.now() / 1000) {
      for (const response of ['going', 'maybe', 'declined']) actions.append(button(statusLabel(response), () => review('event_rsvp', { id: row.id, response }, [[t('Event', 'Event'), row.title], [t('Jibu lako', 'Your answer'), statusLabel(response)]], { warning: response === 'going' && row.capacity ? t('Kama nafasi zimejaa, utajiunga na waiting list.', 'If places are full, you will join the waiting list.') : response === 'declined' && row.reminders?.enabled ? t('Kukataa event kunazima vikumbusho vyake.', 'Declining also turns off reminders for this event.') : '' }), 'secondary small'));
      if (state.admin) {
        if (Number(row.starts_at) > Date.now() / 1000) actions.append(button(t('Hariri', 'Edit'), () => { state.editing = { kind: 'event', row }; load(); }, 'secondary small'));
        actions.append(button(t('Ghairi event', 'Cancel event'), () => review('event_cancel', { id: row.id }, [[t('Event', 'Event'), row.title]], { warning: t('Members waliochagua vikumbusho watapokea taarifa binafsi ya kughairiwa.', 'Members who opted in receive a private cancellation notice.') }), 'danger small'));
      }
    }
    node.append(actions);
    const upcoming = row.status !== 'cancelled' && Number(row.starts_at) > Date.now() / 1000;
    if (upcoming || row.reminders?.enabled) {
      const reminder = el('div', 'item-copy');
      reminder.append(el('p', 'item-meta', row.reminders?.enabled ? `${t('Vikumbusho vimewashwa', 'Reminders on')} · ${leadLabel(Number(row.reminders.leadMinutes))}` : t('Vikumbusho vimezimwa. Kuviwasha pia kunaruhusu taarifa za mabadiliko, kughairiwa na nafasi ya waiting list.', 'Reminders off. Opting in also enables updates, cancellation notices and waiting-list confirmations.')));
      const controls = el('div', 'actions');
      if (upcoming && own !== 'declined') {
        const selector = el('select', 'input'); selector.style.width = 'auto'; selector.setAttribute('aria-label', t(`Kumbusho la ${row.title}`, `Reminder for ${row.title}`));
        for (const minutes of [5, 15, 30, 60, 1440]) { const option = el('option', '', leadLabel(minutes)); option.value = String(minutes); selector.append(option); }
        selector.value = String(row.reminders?.leadMinutes || 60); controls.append(selector);
        controls.append(button(row.reminders?.enabled ? t('Badili kumbusho', 'Change reminder') : t('Nikumbushe privately', 'Remind me privately'), () => review('event_reminders', { id: row.id, enabled: true, leadMinutes: Number(selector.value), language }, [[t('Event', 'Event'), row.title], [t('Kumbusho', 'Reminder'), leadLabel(Number(selector.value))]], { warning: t('Fungua /start kwenye bot privately kwanza. Unaweza kuzima vikumbusho wakati wowote hapa.', 'Open /start privately with the bot first. You can turn these reminders off here at any time.') }), 'secondary small'));
        if (!row.reminders?.enabled) { const start = link(`https://t.me/sautilinkpilotbot?start=community_${state.chatId}`, t('Fungua bot privately', 'Open bot privately')); if (start) controls.append(start); }
      }
      if (row.reminders?.enabled) controls.append(button(t('Zima vikumbusho', 'Turn off reminders'), () => review('event_reminders', { id: row.id, enabled: false, leadMinutes: Number(row.reminders.leadMinutes || 60), language }, [[t('Event', 'Event'), row.title], [t('Vikumbusho', 'Reminders'), t('Zima', 'Turn off')]]), 'secondary small'));
      reminder.append(controls); node.append(reminder);
    }
    return node;
  }, t('Events zinazoandaliwa na admins zitaonekana hapa.', 'Events created by your admins will appear here.')));

  if (state.admin && data.eventDeliveries?.length) {
    const body = el('div', 'card-body');
    const counts = new Map(); for (const row of data.eventDeliveries) counts.set(row.status, (counts.get(row.status) || 0) + Number(row.count || 0));
    for (const [status, count] of counts) body.append(el('p', 'item-meta', `${statusLabel(status)}: ${count}`));
    body.append(el('p', 'card-copy', t('Jumla za taarifa binafsi za siku 30. Majina ya wanaopokea hayaonyeshwi hapa.', 'Private event-notice totals over 30 days. Recipient identities are not shown here.')));
    content.append(card(t('Taarifa za events', 'Event notifications'), body, 'events'));
  }
}
