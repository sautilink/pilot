export const DOCTOR_COPY={
  connection:{en:['Bot connection','Add @sautilinkpilotbot as an administrator in the group.'],sw:['Muunganisho wa bot','Ongeza @sautilinkpilotbot kama admin kwenye group.']},
  supergroup:{en:['Group type','Pilot needs a supergroup for its full moderation policy. Review the group settings in Telegram.'],sw:['Aina ya group','Pilot inahitaji supergroup kwa moderation kamili. Kagua mipangilio ya group ndani ya Telegram.']},
  delete:{en:['Delete messages','Group → Edit → Administrators → SautiLink Pilot → enable Delete messages → Save.'],sw:['Kufuta ujumbe','Group → Edit → Administrators → SautiLink Pilot → washa Delete messages → Save.']},
  restrict:{en:['Ban members','Group → Edit → Administrators → SautiLink Pilot → enable Ban users → Save.'],sw:['Kufungia members','Group → Edit → Administrators → SautiLink Pilot → washa Ban users → Save.']},
  moderation:{en:['Moderation','If paused, a group admin can send /resume in the group. If Pilot is not activated, contact Pilot support.'],sw:['Moderation','Ikiwa imesitishwa, admin atume /resume kwenye group. Ikiwa Pilot haijaunganishwa, wasiliana na support ya Pilot.']},
  command_spam:{en:['Command cleanup','Choose Moderation → Settings → Command spam to enable or change this delete-only filter.'],sw:['Usafishaji wa commands','Chagua Moderation → Settings → Command spam kuwasha au kubadili kichujio hiki cha kufuta pekee.']},
  join_screening:{en:['Join screening','Enable Invite users in Pilot’s administrator permissions, then configure Join screening in Settings.'],sw:['Ukaguzi wa wanaojiunga','Washa Invite users kwenye ruhusa za admin za Pilot, kisha chagua Join screening kwenye Settings.']},
  join_requests:{en:['Join-request link','Check that the invite link used by applicants has Request admin approval enabled. This cannot be confirmed for every invite link from here.'],sw:['Link ya maombi ya kujiunga','Hakikisha invite link wanayotumia members imewashwa Request admin approval. Hali ya kila invite link haiwezi kuthibitishwa hapa.']},
  notices:{en:['Latest moderation notice','Open Moderation → Incidents to review its delivery status. Check Pilot’s sending permissions in Telegram.'],sw:['Tangazo la mwisho la moderation','Fungua Moderation → Incidents kukagua hali ya tangazo. Hakiki ruhusa za Pilot kutuma ujumbe ndani ya Telegram.']},
};

// Passed as a function into the existing authenticated workspace.
export function careToolsClient(h,doctorCopy) {
  const {state,t,el,add,card,hint,button,item,field,checkbox,formCard,listCard,review,request,load,timestamp,showError}=h;
  const labels={ready:t('Tayari','Ready'),needs_attention:t('Inahitaji hatua','Needs attention'),off:t('Haijawashwa','Off'),manual:t('Hakiki ndani ya Telegram','Check in Telegram'),unobserved:t('Hakuna tangazo bado','No notice yet'),pending:t('Inasubiri','Pending')};
  const copy=id=>(doctorCopy[id]||{en:[id,''],sw:[id,'']})[t('sw','en')];
  function renderDoctor(content,data) {
    content.append(hint(t('Ukaguzi huu hauposti test message, haufuti ujumbe wala kumpa member adhabu. Bonyeza Kagua tena baada ya kubadili ruhusa.','This check does not post a test message, delete messages or penalize a member. Check again after changing permissions.')));
    const body=el('div','card-body');add(body,el('h2','',data.ready?t('Group liko tayari','Your group is ready'):t('Kuna vitu vya kukagua','A few things need attention')),el('p','card-copy',`${t('Imehakikiwa','Checked')}: ${timestamp(data.checkedAt)}`),add(el('div','actions'),button(t('Kagua tena','Check again'),()=>load(),'', 'refresh')));
    content.append(card(data.group?.title||t('Ukaguzi wa group','Group check'),body,'doctor'));
    content.append(listCard(t('Hali ya vipengele','Feature readiness'),data.checks||[],row=>{
      const [title,fix]=copy(row.id),node=item(title,'',row.status==='ready'?'':fix);
      node.append(el('p',`status ${row.status==='ready'?'good':row.status==='needs_attention'?'warn':''}`,labels[row.status]||row.status));return node;
    },t('Hakuna ukaguzi kwa sasa.','No checks available.')));
    const actions=el('div','actions'),connect=el('a','button secondary',t('Unganisha group jingine','Connect another group'));connect.href='https://t.me/sautilinkpilotbot?start=connect';actions.append(connect);
    actions.append(button(t('Nakili taarifa ya msaada','Copy support report'),async()=>{
      const text=['SautiLink Pilot · Group diagnostic',new Date(data.checkedAt*1000).toISOString(),...(data.checks||[]).map(row=>`${copy(row.id)[0]}: ${labels[row.status]||row.status}`)].join('\n');
      try{await navigator.clipboard.writeText(text);h.toast(t('Imenakiliwa bila IDs au taarifa binafsi.','Copied without IDs or personal information.'));}catch{const area=el('textarea','input');area.readOnly=true;area.value=text;content.append(area);area.select();}
    }));content.append(actions);
  }
  function renderPolicy(content) {
    content.append(hint(t('Hili ni jaribio la settings za group ulilochagua. Halihifadhi sample yako wala kubadili makosa, ban au ruhusa. Historia ya makosa unayoingiza ni ya mfano.','Test the selected group’s settings. Your sample is not stored and no strikes, bans or permissions change. The prior-strike count you enter is hypothetical.')));
    const output=el('div','stack');
    content.append(formCard(t('Jaribu ujumbe','Try a message'),(form,fields)=>{
      field(form,fields,'text',t('Ujumbe wa mfano','Sample message'),{type:'textarea',max:4096});
      field(form,fields,'caption',t('Caption ya mfano (hiari)','Sample caption (optional)'),{max:1024});
      checkbox(form,fields,'forwarded',t('Ujumbe umetumwa kwa Forward','This is a forwarded message'));
      field(form,fields,'sender',t('Anayetuma','Sender'),{value:'member',choices:[['member',t('Member wa kawaida','Ordinary member')],['admin','Admin'],['anonymous_admin',t('Admin asiyeonekana','Anonymous admin')],['linked_channel',t('Linked channel rasmi','Official linked channel')]]});
      field(form,fields,'priorStrikes',t('Makosa ya awali (mfano)','Previous strikes (hypothetical)'),{type:'number',value:0,min:0,step:1});fields.priorStrikes.max='100';
      field(form,fields,'format',t('Muundo wa ujumbe','Message formatting'),{value:'plain',choices:[['plain',t('Kawaida','Plain text')],['code',t('Imeformat kama code','Code formatting')]]});
      field(form,fields,'messagesInWindow',t('Messages ndani ya flood window (hiari)','Messages in the flood window (optional)'),{type:'number',value:'',min:1,step:1});fields.messagesInWindow.max='100';
      field(form,fields,'commandMode',t('Jaribu chaguo la command cleanup','Try a command-cleanup setting'),{choices:[['current',t('Tumia settings za sasa','Use current settings')],['on',t('Jaribu ikiwa imewashwa','Try enabled')],['off',t('Jaribu ikiwa imezimwa','Try disabled')]]});
      field(form,fields,'exceptions',t('Jaribu command exceptions (hiari)','Try command exceptions (optional)'),{type:'textarea',max:2000,help:t('Ukiweka hapa, zitatumika kwenye jaribio hili tu.','If entered, these replace exceptions for this test only.')});
      field(form,fields,'extraLinks',t('Links za ziada za jaribio (hiari)','Additional test links (optional)'),{type:'textarea',max:6000,help:t('HTTPS URL moja kila mstari; hazitahifadhiwa kwenye whitelist.','One HTTPS URL per line; these are not saved to the whitelist.')});
    },async fields=>{
      const chatId=state.chatId;state.busy=true;output.replaceChildren(hint(t('Inajaribu…','Testing…')));
      try{
        const input={text:fields.text.value,caption:fields.caption.value,forwarded:fields.forwarded.checked,sender:fields.sender.value,priorStrikes:Number(fields.priorStrikes.value),format:fields.format.value};
        if(fields.messagesInWindow.value)input.messagesInWindow=Number(fields.messagesInWindow.value);
        const proposed={};if(fields.commandMode.value!=='current')proposed.command_spam_enabled=fields.commandMode.value==='on';if(fields.exceptions.value.trim())proposed.command_spam_allowlist=fields.exceptions.value;
        if(Object.keys(proposed).length)input.proposedSettings=proposed;
        if(fields.extraLinks.value.trim())input.extraRules=fields.extraLinks.value.trim().split('\n').filter(Boolean).map(value=>({kind:'url',value:value.trim()}));
        const data=await request({view:'policy_test',chatId,input});if(chatId!==state.chatId)return;
        const decisions={allow:t('Ujumbe unaruhusiwa','Message allowed'),exempt:t('Sender ameondolewa kwenye moderation','Sender is exempt'),paused:t('Moderation imesitishwa','Moderation is paused'),delete_only:t('Futa ujumbe pekee','Delete message only'),delete_and_ban:t('Futa ujumbe na toa ban','Delete message and ban'),delete_and_mute:t('Futa ujumbe na toa mute','Delete message and mute')};
        const reasons={link:t('Link haijaruhusiwa','Unapproved link'),forward:t('Forwarded message','Forwarded message'),command_spam:t('Spam ya commands','Command spam'),command_filter_off:t('Command cleanup imezimwa','Command cleanup is off'),flood:t('Flood limit imezidiwa','Flood threshold exceeded'),moderation_paused:t('Moderation imesitishwa','Moderation paused'),admin:'Admin',anonymous_admin:'Anonymous admin',linked_channel:'Linked channel'};
        const body=el('div','card-body');add(body,el('h2','',decisions[data.decision]||data.decision),el('p','card-copy',(data.reasons||[]).map(reason=>reasons[reason]||reason).join(' · ')));
        if(data.durationSeconds!==null)body.append(el('p','item-copy',data.durationSeconds===0?t('Muda: permanent','Duration: permanent'):`${t('Muda','Duration')}: ${data.durationSeconds>=86400?`${data.durationSeconds/86400} ${t('siku','days')}`:`${data.durationSeconds/60} ${t('dakika','minutes')}`}`));
        if(data.strike)body.append(el('p','item-copy',`${t('Kosa la mfano','Hypothetical strike')}: ${data.strike}`));
        body.append(el('p','card-copy',t('Hatua halisi bado inategemea ruhusa za sasa, hali ya member, umri wa ujumbe na maamuzi ya admins.','A real action still depends on current permissions, member status, message age and administrator decisions.')));
        output.replaceChildren(card(t('Matokeo ya mfano','Simulated result'),body,'policy'));
      }catch(error){showError(error);output.replaceChildren();}finally{state.busy=false;}
    },t('Jaribu bila kuchukua hatua','Test without taking action')),output);
  }
  function renderPerformance(content,data) {
    const ms=value=>value==null?'—':`${Number(value).toLocaleString()} ms`;
    const percentile=value=>value?`${value.overflow?'>':'≤'} ${ms(value.upperMs)}`:'—';
    content.append(hint(t('Vipimo vya owner pekee. Distribution hutumia sampuli huru ya 2%; slow/error observations zinaonyeshwa tofauti. Vipimo vinaishia Telegram kuthibitisha request, si muda halisi wa kuonekana kwenye simu.','Owner-only measurements. Distributions use an independent 2% sample; slow/error observations are separate. Timings end at Telegram API confirmation, not actual display on a phone.')));
    if(data.samples<20)content.append(hint(t('Sampuli bado ni chache. Subiri matumizi halisi kabla ya kuhukumu trend.','The sample is still small. Wait for real usage before judging a trend.'),'warn'));
    const grid=el('div','columns');
    for(const [label,value]of [[t('Sampuli ndani ya saa 24','Samples in 24 hours'),data.samples],[t('Muda wa kawaida (p50)','Typical duration (p50)'),percentile(data.percentiles?.total_ms?.p50)],[t('Muda wa upande wa juu (p95)','Upper duration (p95)'),percentile(data.percentiles?.total_ms?.p95)],[t('Uthibitisho wa reply (p50)','Reply confirmation (p50)'),percentile(data.percentiles?.first_reply_ms?.p50)]])grid.append(card(label,add(el('div','card-body'),el('h2','',value??'—')),'performance'));
    content.append(grid);
    const issues=el('div','card-body');
    for(const [key,label]of [['slow',t('Shughuli zilizochelewa','Slow operations')],['errors',t('Errors zilizorekodiwa','Recorded errors')],['retries',t('Maombi yaliyohitaji kurudiwa','Requests requiring a retry')]])issues.append(el('p','item-copy',`${label}: ${Number(data.issues?.[key]||0).toLocaleString()}`));
    issues.append(el('p','card-copy',t('Haya ni matukio yaliyorekodiwa katika muda uliochaguliwa, hata yasipokuwa kwenye sampuli. Si asilimia ya failures; shughuli moja inaweza kuhesabiwa kama slow na error.','These are recorded observations in the selected window, including those outside the sample. They are not a failure percentage; one operation can count as both slow and an error.')));
    content.append(card(t('Hali zinazohitaji kuangaliwa','Observations needing attention'),issues,'performance'));
    const latency=el('div','card-body');for(const [key,label]of [['queue_ms',t('Kusubiri kwenye foleni','Queue wait')],['db_ms',t('Database','Database')],['telegram_ms',t('Telegram API','Telegram API')]])latency.append(el('p','item-copy',`${label}: ${ms(data.averages?.[key])}`));
    latency.append(el('p','card-copy',t('Hizi ni wastani wa sampuli. Kazi zinazofanyika pamoja zinaweza ku-overlap; jumla yake si lazima ilingane na muda wa response.','These are sample averages. Concurrent work can overlap, so their sum need not equal response duration.')));content.append(card(t('Muda unatumikaje','Where time goes'),latency,'performance'));
    content.append(listCard(t('Historia kwa saa','Hourly history'),data.timeline||[],row=>item(timestamp(row.hour),`${row.samples} ${t('sampuli','samples')}`,`${t('Wastani','Average')}: ${ms(row.averageMs)}`),t('Vipimo vitaonekana baada ya matumizi halisi.','Measurements appear after real usage.')));
    content.append(listCard(t('Matoleo yaliyopimwa','Measured releases'),data.releases||[],row=>item(row.release,`${row.samples} ${t('sampuli','samples')}`,`${t('Wastani','Average')}: ${ms(row.averageMs)}`),t('Hakuna vipimo bado.','No measurements yet.')));
    const prefs=data.preferences||{};content.append(formCard(t('Tahadhari za faragha','Private alerts'),(form,fields)=>{
      checkbox(form,fields,'alerts',t('Nitumie tahadhari speed ikishuka au errors zikijirudia','Send me alerts for sustained slow work or repeated errors'),prefs.alerts);
      form.append(hint(t('Angalau slow operations 5 au errors/retries 3 katika takriban dakika 10; tahadhari moja kwa saa.','At least 5 slow operations or 3 errors/retries in approximately 10 minutes; at most one alert per hour.')));
      if(prefs.lastAlertAt)form.append(el('p','card-copy',`${t('Tahadhari ya mwisho','Last alert')}: ${timestamp(prefs.lastAlertAt)} · ${prefs.lastAlertStatus}`));
    },fields=>review('performance_settings',{alerts:fields.alerts.checked,language:t('sw','en')},[[t('Tahadhari','Alerts'),fields.alerts.checked?t('Washa','Enable'):t('Zima','Disable')]],{global:true})));
  }
  return {renderDoctor,renderPolicy,renderPerformance};
}
