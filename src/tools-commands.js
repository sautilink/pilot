import { escapeHtml } from './policy.js';
import { createStore } from './store.js';
import { createControlStore } from './control-store.js';
import { sendPrivateReply } from './private-replies.js';
import { isAdmin, isMember } from './tools-store.js';

export function createToolsCommands({db,api,tools,me,clock=()=>Math.floor(Date.now()/1000),baseUrl='https://pilot.sautilink.com'}) {
  const store=createStore(db),control=createControlStore(db);
  async function handle(message,updateId,{context}={}) {
    const text=String(message.text||''),match=/^\/(tools|flag|ask|events|changelog|feedback)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/i.exec(text);
    const start=/^\/start(?:@([A-Za-z0-9_]+))?\s+(tools(?:_(-[1-9]\d*))?|community_(-[1-9]\d*)|feedback)$/i.exec(text);
    if(!match&&!start)return false;
    if(!Number.isSafeInteger(message.from?.id)||message.from.id<=0||message.from.is_bot||message.sender_chat)return true;
    const isGroup=['group','supergroup'].includes(message.chat?.type),peer=message.chat?.type==='private'&&Number(message.chat.id)===message.from.id;if(!isGroup&&!peer)return true;
    const actor={id:message.from.id,first_name:message.from.first_name,language_code:message.from.language_code};
    const fallback=/^sw/i.test(actor.language_code||'')?'sw':'en';
    const [bot,language]=await Promise.all([me(),Object.hasOwn(context||{},'userLanguage')
      ? (['sw','en'].includes(context.userLanguage)?context.userLanguage:fallback)
      : store.getLanguage('user',actor.id,fallback)]);
    const target=match?.[2]||start?.[1];if(target&&target.toLowerCase()!==String(bot.username).toLowerCase())return true;
    const sw=language==='sw';
    const command=match?match[1].toLowerCase():start[2]==='feedback'?'feedback':'tools',argument=(match?.[3]||'').trim();
    let chat=isGroup?String(message.chat.id):start?.[3]||start?.[4]||null;
    const t=(en,swahili)=>sw?swahili:en;
    async function reply(body,markup){return sendPrivateReply({api,message,text:body,extra:markup?{reply_markup:markup}:{},clock});}
    const botLink=chat?`https://t.me/${bot.username}?start=community_${chat}`:`https://t.me/${bot.username}?start=tools`;
    const open=(section='')=>({inline_keyboard:[[{text:t('Open Community tools','Fungua zana za jumuiya'),...(peer?{web_app:{url:`${baseUrl}/tools?lang=${language}${chat?`&chat=${chat}`:''}${section?`&section=${section}`:''}`}}:{url:botLink})}]]});
    try{
      if(command==='tools'){
        let memberMode=false;
        if(chat){const role=await api.call('getChatMember',{chat_id:Number(chat),user_id:actor.id});if(!isMember(role))throw {status:403};memberMode=!isAdmin(role);if(isAdmin(role)){await store.setAdminContext(actor.id,chat,clock());await control.rememberAdmin(actor.id,chat,clock());}}
        await reply(t('<b>Community tools</b>\n\nPlan announcements and events, review reports, manage approved answers and shape your community. Pilot checks your access when you open a group.','<b>Zana za jumuiya</b>\n\nPanga matangazo na events, kagua reports, simamia majibu na taarifa za jumuiya. Pilot itahakiki ruhusa zako unapofungua group.'),open(memberMode?'events':''));return true;
      }
      if(command==='changelog'){await reply(t('See what is new in SautiLink Pilot and the ideas being explored.','Ona vipengele vipya vya SautiLink Pilot na mipango inayochunguzwa.'),{inline_keyboard:[[{text:t('Latest updates','Updates mpya'),url:`${baseUrl}/updates?lang=${language}`},{text:t('Roadmap','Mipango'),url:`${baseUrl}/roadmap?lang=${language}`}]]});return true;}
      if(command==='feedback'){await reply(t('Share a feature idea or report a problem from the feedback form. Your message is visible to the Pilot owner.','Tuma wazo la feature au tatizo kwenye fomu ya maoni. Ujumbe wako utaonekana kwa mmiliki wa Pilot.'),open('feedback'));return true;}
      if(command==='flag'){
        if(!isGroup||!message.reply_to_message){await reply(t('Reply to the message in your group with <code>/flag reason</code>. Admins review reports privately. A report never adds a ban or strike.','Reply kwenye ujumbe wa group kwa <code>/flag sababu</code>. Admins watakagua faraghani. Report yenyewe haitoi ban wala kosa.'));return true;}
        const result=await tools.community.createReportFromMessage({actor,chatId:chat,message:message.reply_to_message,reason:argument||t('Please review this message.','Naomba ujumbe huu ukaguliwe.'),updateId});
        await reply(t(`Report <code>${escapeHtml(result.id)}</code> ${result.duplicate?'is already in':'has been added to'} the admin inbox. No penalty was applied.`,`Report <code>${escapeHtml(result.id)}</code> ${result.duplicate?'tayari ipo':'imeongezwa'} kwenye inbox ya admins. Hakuna adhabu iliyotolewa.`));return true;
      }
      if(!chat){const session=await store.adminContext(actor.id);chat=session?.chat_id;}
      if(!chat){await reply(t('Use this command inside the relevant group so Pilot can verify your membership.','Tumia command hii ndani ya group husika ili Pilot ithibitishe uanachama wako.'));return true;}
      if(command==='ask'){
        if(!argument||argument.length>200){await reply(t('Ask <code>/ask your question</code> in the group. Answers come from material approved by that group’s admins.','Tuma <code>/ask swali lako</code> kwenye group. Majibu yanatokana na taarifa zilizoidhinishwa na admins wa group hilo.'));return true;}
        const result=await tools.community.query({actor,chatId:chat,view:'faq',input:{query:argument,language}});
        const entries=(result.faq||[]).slice(0,3);await reply(entries.length?entries.map(item=>`<b>${escapeHtml(item.question)}</b>\n${escapeHtml(item.answer.slice(0,850))}${item.url?`\n<a href="${escapeHtml(item.url)}">${t('Source','Chanzo')}</a>`:''}`).join('\n\n'):t('No approved answer matches yet. Ask an admin to add it to the group’s knowledge base.','Hakuna jibu lililoidhinishwa linalolingana kwa sasa. Omba admin aongeze kwenye maswali na majibu ya group.'),open('knowledge'));return true;
      }
      if(command==='events'){
        const result=await tools.operations.query({actor,chatId:chat,view:'events',input:{}});
        const entries=(result.events||[]).filter(item=>item.status!=='cancelled').slice(0,5);
        await reply(entries.length?entries.map(item=>`<b>${escapeHtml(item.title)}</b>\n${escapeHtml(new Intl.DateTimeFormat(sw?'sw-TZ':'en-GB',{dateStyle:'medium',timeStyle:'short',timeZone:'Africa/Dar_es_Salaam'}).format(new Date(item.starts_at*1000)))} EAT`).join('\n\n'):t('No upcoming events have been published.','Hakuna events zijazo zilizochapishwa.'),open('events'));return true;
      }
    }catch(error){await reply(error?.status===403?t('This information is available only to current members with the required role.','Taarifa hizi zinapatikana kwa members wa sasa wenye ruhusa inayohitajika.'):error?.status===429?t('You have reached the request limit. Please try again later.','Umefikia kikomo cha maombi. Jaribu tena baadaye.'):t('Pilot could not complete this request. Check the details and try again.','Pilot haijaweza kukamilisha ombi hili. Kagua taarifa kisha ujaribu tena.'));}
    return true;
  }
  return {handle};
}
