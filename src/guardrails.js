import {createGuardrailStore} from './guardrail-store.js';
import {escapeHtml} from './policy.js';
import {fillTemplate,memberName,publicGroupRules} from './templates.js';
import {detectCommandSpam} from './command-spam.js';

const admin=role=>['creator','administrator'].includes(role?.status);
const positive=id=>Number.isSafeInteger(Number(id)) && Number(id)>0;
const failure=error=>error?.ambiguous===false ? 'failed' : 'unknown';
const activeJoin=['review','challenged'];
function fail(code,status=409) {const error=new Error(code);error.code=code;error.status=status;throw error;}

/** These configurable rules run in the same group queue as the primary policy.
 * Slash-code cleanup is silent and delete-only. Neither it nor flood creates a
 * link/forward strike. Pending joins are never banned on timeout.
 */
export function createGuardrails({db,store,controlStore,api,clock,me,say}) {
  const records=createGuardrailStore(db);
  const member=(chat,user)=>api.call('getChatMember',{chat_id:Number(chat),user_id:Number(user)});
  const audit=(id,chat,action,target,details={})=>controlStore.audit({id,chatId:chat,action,targetId:target,details,at:clock()});

  async function commandSpam(message,settings) {
    if(!['group','supergroup'].includes(message.chat?.type)) return null;
    const detected=detectCommandSpam(message,settings.command_spam_allowlist || '');
    const chat=message.chat.id,now=clock(),date=Number(message.date || 0),time=Number(message.edit_date || date);
    if(!detected || settings.command_spam_enabled===false) {
      if(Number.isSafeInteger(chat) && chat<0 && Number.isSafeInteger(message.message_id) && message.message_id>0
        && Number.isSafeInteger(time) && time>0 && time<=now+60 && (message.edit_date || detected)) {
        // A later clean edit invalidates a pending retry of an older payload.
        // This also applies while cleanup is disabled. For cancelled_edit,
        // updated_at is the latest observed cancellation event time; advance it
        // monotonically so an out-of-order edit cannot revive an older payload.
        await records.ensure();
        // An UPSERT also protects a clean edit delivered before its original
        // message webhook. It stores identifiers/event time only, not content.
        await records.run("INSERT INTO pilot_guard_actions(id,chat_id,kind,status,created_at,updated_at) VALUES(?,?,'command_spam','cancelled_edit',?,?) ON CONFLICT(id) DO UPDATE SET status='cancelled_edit',updated_at=excluded.updated_at WHERE pilot_guard_actions.kind='command_spam' AND ((pilot_guard_actions.status IN ('retry_1','retry_2') AND pilot_guard_actions.created_at<=excluded.updated_at) OR (pilot_guard_actions.status='cancelled_edit' AND pilot_guard_actions.updated_at<excluded.updated_at))",`commandspam:${chat}:${message.message_id}`,String(chat),time,time);
      }
      // Even when cleanup is switched off, repeating these same detected codes
      // must not escalate through optional flood mutes.
      return detected ? 'command_spam_disabled' : null;
    }
    if(!Number.isSafeInteger(chat) || chat>=0 || !Number.isSafeInteger(message.message_id) || message.message_id<=0) return 'command_spam_ignored';
    if(String(message.sender_chat?.id)===String(chat)) return 'anonymous_admin';
    if(!message.sender_chat && (message.from?.is_bot || !positive(message.from?.id))) return 'command_spam_exempt';
    if(!Number.isSafeInteger(date) || date<=0 || !Number.isSafeInteger(time) || time<=0 || date>now+60 || time>now+60 || now-date>=48*3600) return 'command_spam_stale';
    const group=await store.group(chat);
    if(!group.enabled || time<Math.max(group.activated_at,Number(await store.setting('ready_since') || 0))) return 'paused_or_old';
    const id=`commandspam:${chat}:${message.message_id}`;
    await records.ensure();
    let previous=await records.first('SELECT status,created_at,updated_at FROM pilot_guard_actions WHERE id=?',id);
    let retry=/^retry_([12])$/.exec(previous?.status || '');
    if(previous) {
      // created_at is this rule's source event time. An older webhook payload
      // must not delete a message after a newer edit has already been observed.
      if(time<previous.created_at) return 'command_spam_duplicate';
      if(retry && message.edit_date && time>previous.created_at) {
        await records.run("UPDATE pilot_guard_actions SET created_at=? WHERE id=? AND status=? AND created_at=?",time,id,previous.status,previous.created_at);
        previous={...previous,created_at:time};
      }
      if(retry && now<previous.updated_at) return 'command_spam_retry';
      if(!retry && !(previous.status==='cancelled_edit' && message.edit_date && time>previous.updated_at)) return 'command_spam_duplicate';
    }
    const bot=await me(),user=message.sender_chat ? null : Number(message.from.id);
    if(user===Number(bot.id)) return 'self';
    if(message.sender_chat) {
      if(!Number.isSafeInteger(message.sender_chat.id) || message.sender_chat.id>=0) return 'command_spam_ignored';
      const info=await api.call('getChat',{chat_id:chat});
      if(String(info.linked_chat_id)===String(message.sender_chat.id)) return 'linked_channel';
    } else {
      const live=await member(chat,user);
      if(admin(live)) return 'admin';
      if(!['member','restricted'].includes(live.status)) return 'command_spam_inactive_member';
      const prior=await store.first('SELECT override_at FROM members WHERE chat_id=? AND user_id=?',String(chat),String(user));
      if(prior && time<=prior.override_at) return 'admin_override';
    }
    // This rule needs only delete permission. It never calls a restriction API,
    // creates a link/forward incident, or adds a member strike.
    const own=await member(chat,bot.id);
    if(!admin(own) || !own.can_delete_messages) {
      await records.health(chat,'command_spam_action_failed',true,now);
      return 'command_spam_missing_permission';
    }
    // Fresh verification immediately before claiming and deleting also protects
    // a member promoted, or a channel linked, while earlier checks were running.
    if(message.sender_chat) {
      const info=await api.call('getChat',{chat_id:chat});
      if(String(info.linked_chat_id)===String(message.sender_chat.id)) return 'linked_channel';
    } else {
      const live=await member(chat,user);
      if(admin(live)) return 'admin';
      if(!['member','restricted'].includes(live.status)) return 'command_spam_inactive_member';
    }
    const target=user ?? message.sender_chat.id;
    let attempt=1;
    if(previous?.status==='cancelled_edit') {
      const claimed=await records.run("UPDATE pilot_guard_actions SET status='sending',target_id=?,created_at=?,updated_at=? WHERE id=? AND status='cancelled_edit' AND updated_at<?",String(target),time,clock(),id,time);
      if(!(claimed.meta?.changes ?? claimed.changes ?? 0)) return 'command_spam_duplicate';
    } else if(retry) {
      // For retry_N only, updated_at is the next permitted attempt time. No
      // uncertain deletion is replayed; only Telegram's definite 429 rejection.
      const claimed=await records.run("UPDATE pilot_guard_actions SET status='sending',updated_at=? WHERE id=? AND status=? AND created_at=? AND updated_at<=?",clock(),id,previous.status,time,clock());
      if(!(claimed.meta?.changes ?? claimed.changes ?? 0)) return 'command_spam_retry';
      attempt=Number(retry[1])+1;
    } else if(!await records.claim({id,chatId:chat,targetId:target,kind:'command_spam',now:time})) {
      return 'command_spam_duplicate';
    }
    try {
      const deleted=await api.call('deleteMessage',{chat_id:chat,message_id:message.message_id});
      if(deleted!==true) throw new Error('Unconfirmed deletion');
    } catch(error) {
      if(!(error.code===400 && /message to delete not found/i.test(error.message || ''))) {
        const delay=Number.isSafeInteger(error.retryAfter) && error.retryAfter>0 ? error.retryAfter : 1;
        if(error.code===429 && error.ambiguous===false && attempt<3 && clock()+delay<date+48*3600) {
          await records.finish(id,`retry_${attempt}`,clock()+delay);
          return 'command_spam_retry';
        }
        const outcome=failure(error);
        await records.finish(id,outcome,clock());
        await records.health(chat,'command_spam_action_failed',true,clock());
        await audit(id,chat,'command_spam_review',target,{action:outcome,...detected});
        return 'command_spam_review';
      }
    }
    await records.finish(id,'deleted',clock());
    await records.health(chat,'command_spam_action_failed',false,clock());
    await audit(id,chat,'command_spam_deleted',target,{action:'deleted',...detected});
    // Silent by design: repeated codes do not create repeated bot notices.
    return 'command_spam';
  }

  async function flood(message,settings) {
    const chat=message.chat.id,now=clock(),time=Number(message.date || 0);
    if(!settings.flood_enabled || message.edit_date || !['group','supergroup'].includes(message.chat.type) || message.sender_chat || !positive(message.from?.id)) return null;
    if(message.new_chat_members || message.left_chat_member || !time || time>now+60 || now-time>120) return null;
    const group=await store.group(chat);
    if(!group.enabled || time<Math.max(group.activated_at,Number(await store.setting('ready_since') || 0))) return null;
    const bot=await me(),user=message.from.id;
    if(Number(user)===Number(bot.id)) return null;
    const live=await member(chat,user);
    if(admin(live) || live.status==='kicked' || live.status==='left') return null;
    const prior=await store.first('SELECT override_at FROM members WHERE chat_id=? AND user_id=?',String(chat),String(user));
    if(prior && time<=prior.override_at) return null;
    const own=await member(chat,bot.id);
    if(!admin(own) || !own.can_delete_messages) {
      await records.health(chat,'missing_permissions',true,now);return null;
    }
    await records.ensure();
    const eventKey=message.media_group_id ? `album:${message.media_group_id}` : `message:${message.message_id}`;
    await records.run('DELETE FROM pilot_flood_events WHERE chat_id=? AND user_id=? AND event_at<?',String(chat),String(user),now-120);
    await records.run('INSERT OR IGNORE INTO pilot_flood_events VALUES(?,?,?,?)',String(chat),String(user),eventKey,time);
    const count=await records.first('SELECT COUNT(*) AS total FROM pilot_flood_events WHERE chat_id=? AND user_id=? AND event_at>=? AND event_at<=?',String(chat),String(user),time-settings.flood_window,time);
    if(count.total<=settings.flood_limit) return null;
    const id=`flood:${chat}:${message.message_id}`;
    if(!await records.claim({id,chatId:chat,targetId:user,kind:'flood',now})) return 'flood_duplicate';
    // Administrator roles can change between counting and taking action.
    if(admin(await member(chat,user))) {await records.finish(id,'cancelled',now);return 'admin';}
    try {
      const deleted=await api.call('deleteMessage',{chat_id:chat,message_id:message.message_id});
      if(deleted!==true) throw new Error('Unconfirmed deletion');
    } catch(error) {
      if(!(error.code===400 && /message to delete not found/i.test(error.message || ''))) {
        await records.finish(id,failure(error),clock());
        await records.health(chat,'flood_action_failed',true,clock());return 'flood_review';
      }
    }
    let action='deleted';
    if(settings.flood_action==='mute' && message.chat.type==='supergroup' && own.can_restrict_members) {
      const current=await member(chat,user);
      // Do not replace any human restriction or extend an existing mute.
      if(current.status==='member') {
        try {
          const result=await api.call('restrictChatMember',{
            chat_id:chat,user_id:user,until_date:clock()+settings.flood_mute_seconds,
            use_independent_chat_permissions:true,
            permissions:{can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false,can_react_to_messages:false,can_change_info:false,can_invite_users:false,can_pin_messages:false,can_manage_topics:false,can_edit_tag:false},
          });
          if(result!==true) throw new Error('Unconfirmed restriction');
          action='muted';
        } catch(error) {
          action=failure(error)==='unknown' ? 'mute_unknown' : 'deleted';
          await records.health(chat,'flood_action_failed',true,clock());
        }
      }
    }
    await records.finish(id,action,clock());
    if(action==='muted' || action==='deleted' && settings.flood_action==='delete') await records.health(chat,'flood_action_failed',false,clock());
    await audit(id,chat,'flood_action',user,{action,limit:settings.flood_limit,window:settings.flood_window,...(action==='muted'?{seconds:settings.flood_mute_seconds}:{})});
    // One notice per group/user/window prevents the anti-spam tool becoming spam.
    const noticeId=`floodnotice:${chat}:${user}:${Math.floor(now/60)}`;
    if(await records.claim({id:noticeId,chatId:chat,targetId:user,kind:'flood_notice',now})) {
      const lang=await store.getLanguage('group',chat),name=memberName(message.from,lang);
      const text=lang==='en'
        ? `🕊 ${name}: please slow down. Excess messages were removed.${action==='muted' ? ` A ${Math.ceil(settings.flood_mute_seconds/60)}-minute mute was applied.` : ''}\nThis does not add a link/forward offense.`
        : `🕊 ${name}: tafadhali punguza kasi ya kutuma ujumbe. Ujumbe uliozidi umeondolewa.${action==='muted' ? ` Umezuiwa kutuma kwa dakika ${Math.ceil(settings.flood_mute_seconds/60)}.` : ''}\nHatua hii haiongezi kosa la link/forward.`;
      try {
        const sent=await say(chat,escapeHtml(text));
        await records.finish(noticeId,Number.isSafeInteger(sent?.message_id)?'sent':'unknown',clock(),sent?.message_id ?? null);
      } catch(error) {await records.finish(noticeId,failure(error),clock());}
    }
    return 'flood';
  }

  async function welcome(chat,user,eventAt,settings) {
    if(!settings.welcome_enabled || !positive(user?.id) || user.is_bot || clock()-eventAt>120 || eventAt>clock()+60) return;
    const group=await store.group(chat);
    if(!group.enabled || eventAt<Math.max(group.activated_at,Number(await store.setting('ready_since') || 0))) return;
    await records.ensure();
    const recent=await records.first("SELECT id FROM pilot_guard_actions WHERE chat_id=? AND target_id=? AND kind='welcome' AND created_at>? LIMIT 1",String(chat),String(user.id),clock()-60);
    if(recent) return;
    const id=`welcome:${chat}:${user.id}:${eventAt}`;
    if(!await records.claim({id,chatId:chat,targetId:user.id,kind:'welcome',now:clock()})) return;
    const language=await store.getLanguage('group',chat);
    try {
      const info=await api.call('getChat',{chat_id:Number(chat)});
      const bot=await me(),name=memberName(user,language);
      const template=settings[`welcome_${language}`] || (language==='en' ? 'Welcome, {user}! ✈️\nYou are joining {group}.\n\n{rules}' : 'Karibu, {user}! ✈️\nUmejiunga na {group}.\n\n{rules}');
      const text=fillTemplate(template,{user:name,group:info.title || 'Group',rules:publicGroupRules(settings,language)});
      const sent=await say(chat,escapeHtml(text),{reply_markup:{inline_keyboard:[[{text:language==='en' ? '📖 Read the rules' : '📖 Soma sheria',callback_data:undefined,url:`https://t.me/${bot.username}?start=rules`}]]}});
      await records.finish(id,Number.isSafeInteger(sent?.message_id)?'sent':'unknown',clock(),sent?.message_id ?? null);
      if(Number.isSafeInteger(sent?.message_id)) await records.health(chat,'welcome_delivery_failed',false,clock());
    } catch(error) {await records.finish(id,failure(error),clock());await records.health(chat,'welcome_delivery_failed',true,clock());}
  }

  async function membership(change) {
    if(!['group','supergroup'].includes(change?.chat?.type)) return;
    const chat=change.chat.id,user=change.new_chat_member?.user;
    if(!positive(user?.id)) return;
    await records.ensure();
    const status=change.new_chat_member.status;
    const inside=role=>['member','administrator','creator'].includes(role?.status) || role?.status==='restricted' && role.is_member;
    // A human approval, rejection, ban, or any observed join wins over an old button.
    if(inside(change.new_chat_member) || status==='kicked' || change.from?.id!==user.id && status==='left') {
      await records.run("UPDATE pilot_join_requests SET status='cancelled',answer=NULL,updated_at=? WHERE chat_id=? AND user_id=? AND event_at<=? AND status IN ('review','challenged','sending','deciding')",clock(),String(chat),String(user.id),Number(change.date || clock()));
    }
    if(inside(change.new_chat_member) && !inside(change.old_chat_member)) await welcome(chat,user,Number(change.date || clock()),await controlStore.settings(chat));
  }

  async function joinRequest(request) {
    const chat=request.chat?.id,user=request.from?.id,now=clock(),eventAt=Number(request.date || 0);
    if(!['group','supergroup'].includes(request.chat?.type) || !positive(user) || !positive(request.user_chat_id) || !eventAt || now-eventAt>86400 || eventAt>now+60) return 'join_ignored';
    // Guard-bot query mode has a separate ten-second protocol. Leave its decision
    // to the group's human admins instead of accidentally timing out the request.
    if(request.query_id) {
      try {await api.call('answerChatJoinRequestQuery',{chat_join_request_query_id:request.query_id,result:'queue'});} catch { /* no decline or ban */ }
      return 'join_manual';
    }
    const settings=await controlStore.settings(chat),group=await store.group(chat);
    if(!settings.join_gate_enabled || !group.enabled || eventAt<Math.max(group.activated_at,Number(await store.setting('ready_since') || 0))) return 'join_disabled';
    await records.ensure();
    if(await records.first('SELECT id FROM pilot_join_requests WHERE chat_id=? AND user_id=? AND event_at>=? LIMIT 1',String(chat),String(user),eventAt)) return 'join_duplicate';
    const id=crypto.randomUUID().replaceAll('-','').slice(0,24);
    const a=crypto.getRandomValues(new Uint8Array(1))[0]%8+2,b=crypto.getRandomValues(new Uint8Array(1))[0]%6+2;
    await records.run("UPDATE pilot_join_requests SET status='cancelled',answer=NULL,updated_at=? WHERE chat_id=? AND user_id=? AND status IN ('review','challenged','sending')",now,String(chat),String(user));
    await records.run("INSERT INTO pilot_join_requests(id,chat_id,user_id,user_chat_id,event_at,expires_at,status,answer,updated_at) VALUES(?,?,?,?,?,?,'review',?,?)",id,String(chat),String(user),String(request.user_chat_id),eventAt,eventAt+290,String(a+b),now);
    if(settings.join_gate_mode!=='challenge' || now>=eventAt+290) return 'join_review';
    const bot=await me(),own=await member(chat,bot.id);
    if(!admin(own) || !own.can_invite_users) {await records.health(chat,'join_permissions',true,now);return 'join_review';}
    await records.run("UPDATE pilot_join_requests SET status='sending',updated_at=? WHERE id=?",now,id);
    const language=await store.getLanguage('group',chat),en=language==='en';
    const text=en
      ? `Welcome to ${request.chat.title || 'the group'}! ✈️\n\n${publicGroupRules(settings,language)}\n\nTo accept these rules, choose the answer: ${a} + ${b} = ?\nThis step expires in five minutes. An admin can still review your request.`
      : `Karibu ${request.chat.title || 'kwenye group'}! ✈️\n\n${publicGroupRules(settings,language)}\n\nKukubali sheria hizi, chagua jibu: ${a} + ${b} = ?\nHatua hii inaisha ndani ya dakika tano. Admin bado anaweza kukagua ombi lako.`;
    const answers=[a+b-1,a+b,a+b+1].sort(()=>crypto.getRandomValues(new Uint8Array(1))[0]%3-1);
    try {
      const sent=await say(request.user_chat_id,escapeHtml(text),{reply_markup:{inline_keyboard:[answers.map(answer=>({text:String(answer),callback_data:`pilot:join:${id}:${answer}`}))]}});
      await records.run('UPDATE pilot_join_requests SET status=?,telegram_message_id=?,updated_at=? WHERE id=?',Number.isSafeInteger(sent?.message_id)?'challenged':'review',sent?.message_id ?? null,clock(),id);
    } catch {await records.run("UPDATE pilot_join_requests SET status='review',updated_at=? WHERE id=?",clock(),id);}
    return 'join_pending';
  }

  async function decide(row,approve,actorId=null) {
    const bot=await me(),own=await member(row.chat_id,bot.id);
    if(!admin(own) || !own.can_invite_users) fail('missing_invite_permission',403);
    const live=await member(row.chat_id,row.user_id);
    if(live.status!=='left') {
      await records.run("UPDATE pilot_join_requests SET status='cancelled',answer=NULL,updated_at=? WHERE id=?",clock(),row.id);
      fail('membership_changed');
    }
    const claimed=await records.run("UPDATE pilot_join_requests SET status='deciding',answer=NULL,updated_at=? WHERE id=? AND status IN ('review','challenged')",clock(),row.id);
    if(!(claimed.meta?.changes ?? claimed.changes ?? 0)) fail('join_already_handled');
    try {
      const result=await api.call(approve?'approveChatJoinRequest':'declineChatJoinRequest',{chat_id:Number(row.chat_id),user_id:Number(row.user_id)});
      if(result!==true) throw new Error('Unconfirmed join decision');
    } catch(error) {
      await records.run('UPDATE pilot_join_requests SET status=?,updated_at=? WHERE id=?',failure(error)==='unknown'?'unknown':'review',clock(),row.id);
      // A rejected decision stays for manual review; never silently retry it.
      fail(failure(error)==='unknown'?'telegram_unconfirmed':'join_unavailable');
    }
    const status=approve?'approved':'declined';
    await records.run('UPDATE pilot_join_requests SET status=?,updated_at=? WHERE id=?',status,clock(),row.id);
    await controlStore.audit({id:`join:${row.id}:${status}`,chatId:row.chat_id,actorId,action:`join_${status}`,targetId:row.user_id,details:{source:actorId?'admin':'rules_challenge'},at:clock()});
    return {ok:true,join:{id:row.id,status}};
  }

  async function callback(query) {
    const match=/^pilot:join:([a-f0-9]{24}):(\d{1,3})$/.exec(String(query.data || ''));
    if(!match) return false;
    await records.ensure();
    const row=await records.first('SELECT * FROM pilot_join_requests WHERE id=?',match[1]);
    const language=String(query.from?.language_code || '').startsWith('en')?'en':'sw';
    const answer=async text=>{try{await api.call('answerCallbackQuery',{callback_query_id:query.id,text,show_alert:true});}catch{/* spinner acknowledgement is best effort */}};
    if(!row || String(query.from?.id)!==row.user_id || query.message?.chat?.type!=='private' || String(query.message.chat.id)!==row.user_chat_id || query.message.message_id!==row.telegram_message_id || Number(query.message.from?.id)!==Number((await me()).id)) {
      await answer(language==='en'?'This request is not available.':'Ombi hili halipatikani.');return true;
    }
    if(row.status!=='challenged' || clock()>row.expires_at) {
      await answer(language==='en'?'This step has ended. A group admin can review your request.':'Hatua hii imeisha. Admin wa group anaweza kukagua ombi lako.');return true;
    }
    const settings=await controlStore.settings(row.chat_id),group=await store.group(row.chat_id);
    if(!group.enabled || !settings.join_gate_enabled || settings.join_gate_mode!=='challenge') {
      await answer(language==='en'?'Please wait for a group admin.':'Tafadhali subiri admin wa group.');return true;
    }
    if(match[2]!==row.answer) {await answer(language==='en'?'Try the calculation again.':'Jaribu hesabu tena.');return true;}
    try {
      await decide(row,true);
      await answer(language==='en'?'Your join request was approved. Welcome!':'Ombi lako limekubaliwa. Karibu!');
    } catch {await answer(language==='en'?'An admin needs to review your request.':'Admin anahitaji kukagua ombi lako.');}
    return true;
  }

  async function control({actor,chatId,action,input={},requestId}) {
    if(!['join_approve','join_decline'].includes(action)) return null;
    if(!positive(actor?.id) || actor.is_bot || !Number.isSafeInteger(Number(chatId)) || Number(chatId)>=0) fail('forbidden',403);
    if(!/^[A-Za-z0-9:_-]{8,128}$/.test(String(requestId || '')) || !/^[a-f0-9]{24}$/.test(String(input.joinId || ''))) fail('invalid_request',400);
    if(!admin(await member(chatId,actor.id))) fail('admin_required',403);
    await controlStore.rememberAdmin(actor.id,chatId,clock());
    await records.ensure();
    const row=await records.first('SELECT * FROM pilot_join_requests WHERE id=? AND chat_id=?',input.joinId,String(chatId));
    if(!row) fail('join_not_found',404);
    const operationId=`joinop:${requestId}`,kind=`${action}:${row.id}`;
    const old=await records.first('SELECT * FROM pilot_guard_actions WHERE id=?',operationId);
    if(old) {
      if(old.chat_id!==String(chatId) || old.actor_id!==String(actor.id) || old.kind!==kind) fail('request_conflict');
      if(['approved','declined'].includes(old.status)) return {ok:true,join:{id:row.id,status:old.status},replayed:true};
      fail('operation_unconfirmed');
    }
    if(!activeJoin.includes(row.status) || clock()-row.event_at>7*86400) fail('join_already_handled');
    if(!await records.claim({id:operationId,chatId,targetId:row.user_id,actorId:actor.id,kind,now:clock()})) fail('operation_unconfirmed');
    try {
      const result=await decide(row,action==='join_approve',actor.id);
      await records.finish(operationId,result.join.status,clock());return result;
    } catch(error) {await records.finish(operationId,error.code==='telegram_unconfirmed'?'unknown':'failed',clock());throw error;}
  }
  async function humanOverride(chat,user) {
    await records.ensure();
    await records.run('DELETE FROM pilot_flood_events WHERE chat_id=? AND user_id=?',String(chat),String(user));
  }
  return {commandSpam,flood,welcome,membership,joinRequest,callback,control,humanOverride,records};
}
