import { analyzeMessage, banDuration } from './policy.js';
import { createStore } from './store.js';
import { createAnnouncer } from './announcements.js';
import { createBotExperience } from './commands.js';
import { createControlStore } from './control-store.js';
import { createControlService } from './control-service.js';
import { createGuardrails } from './guardrails.js';
import { createBroadcastStore } from './broadcast-store.js';
import { createToolsCommands } from './tools-commands.js';
import { loadUpdateContext } from './update-context.js';

export const RULES = '<b>🛡 SautiLink Pilot</b>\nGroup lenye utulivu, mazungumzo yenye nafasi.\n\nLinks zisizoruhusiwa na ujumbe wa forward huondolewa.\nAdhabu: saa 24 → siku 7 → ban ya kudumu.\n\nTumia /rules kuona sheria za members, au fungua bot faraghani kwa mwongozo.';
const ENGLISH_RULES = '<b>🛡 SautiLink Pilot</b>\nA calmer group. More room for conversation.\n\nUnapproved links and forwarded messages are removed.\nPenalties: 24 hours → 7 days → permanent ban.\n\nUse /rules for member rules, or open the bot privately for a guide.';
const admin = m => m?.status === 'creator' || m?.status === 'administrator';
const validId = id => Number.isSafeInteger(Number(id)) && Number(id) !== 0;
const userId = id => validId(id) && Number(id) > 0;
const messageChat = chat => Number.isSafeInteger(chat?.id) && (chat.type==='private' ? chat.id>0 : ['group','supergroup'].includes(chat.type) && chat.id<0);
const eventTime = m => Number(m.edit_date || m.date || 0);

export function createModerator({db,api,clock=()=>Math.floor(Date.now()/1000),dispatchControl,appUrl,owner,dispatchBroadcast,getIdentity,tools}) {
  const store=createStore(db);
  const controlStore=createControlStore(db),control=createControlService({db,api,clock});
  let identity;
  const me=async()=>identity ||= await (getIdentity ? getIdentity() : api.call('getMe'));
  const say=(chat,text,extra={})=>api.call('sendMessage',{
    chat_id:Number(chat),text,parse_mode:'HTML',link_preview_options:{is_disabled:true},...extra
  });
  const member=(chat,user)=>api.call('getChatMember',{chat_id:Number(chat),user_id:Number(user)});
  const announcer=createAnnouncer({store,api,clock,controlStore});
  const guards=createGuardrails({db,store,controlStore,api,clock,me,say});
  const broadcastRecords=createBroadcastStore(db);
  const experience=createBotExperience({db,store,api,clock,me,say,control,controlStore,dispatchControl,appUrl,owner,dispatchBroadcast});
  const toolCommands=tools?createToolsCommands({db,api,tools,me,clock,baseUrl:new URL(appUrl||'https://pilot.sautilink.com/app').origin}):null;
  const observe=signal=>tools?.governance.observeSignal(signal).catch(()=>{});

  async function notice(chat,text,extra={}) {
    const group=await store.group(chat), now=clock();
    if(group.notice_at && now-group.notice_at<3600) return;
    // Claim first: a failed response must not flood the chat with repeated notices.
    await store.run('UPDATE groups SET notice_at=? WHERE chat_id=?',now,String(chat));
    try { await say(chat,text,extra); } catch { /* Permission failures are visible privately via /status. */ }
  }

  async function deleteMessage(message) {
    try {
      const deleted=await api.call('deleteMessage',{chat_id:message.chat.id,message_id:message.message_id});
      if(deleted!==true) throw new Error('Deletion was not confirmed');
      return true;
    } catch(error) {
      if(error.code===400 && /message to delete not found/i.test(error.message)) return true;
      throw error;
    }
  }

  async function membership(update) {
    const change=update.chat_member || update.my_chat_member;
    if(!change || !validId(change.chat?.id) || !['group','supergroup'].includes(change.chat.type)) return;
    const chat=change.chat.id, bot=await me();
    if(chat<0) await broadcastRecords.rememberGroup(chat,Number(change.date || clock()));
    if(update.my_chat_member) {
      const group=await store.group(chat);
      const own=change.new_chat_member;
      if(Number(own?.user?.id)===Number(bot.id)) await broadcastRecords.recordMembership(chat,own.status,Number(change.date || clock()),update.update_id);
      if(admin(own) && !admin(change.old_chat_member)) {
        await store.run('UPDATE groups SET activated_at=? WHERE chat_id=?',Number(change.date || clock()),String(chat));
        const language=await store.getLanguage('group',chat);
        await notice(chat,language==='en' ? ENGLISH_RULES : RULES,{reply_markup:{inline_keyboard:[[{text:language==='en' ? '✈️ Open Pilot' : '✈️ Fungua Pilot',url:`https://t.me/${bot.username}?start=home`}]]}});
      }
      return;
    }
    const target=change.new_chat_member?.user?.id, actor=change.from?.id;
    if(!userId(target) || !userId(actor) || Number(actor)===Number(bot.id) || Number(actor)===Number(target)) return;
    // Membership updates include joins too; only verified human admin actions override policy.
    if(admin(await member(chat,actor))) {
      await store.override(chat,target,Number(change.date || clock()));
      await guards.humanOverride(chat,target);
    }
  }

  async function enforce(message,update,rules=[],context={}) {
    const chat=message.chat.id, now=clock(), time=eventTime(message);
    if(!['group','supergroup'].includes(message.chat.type) || !validId(chat)) return 'ignored';
    if(String(message.sender_chat?.id)===String(chat)) return 'anonymous_admin';
    const violation=analyzeMessage(message,rules);
    if(!violation.reasons.length) return 'allowed';
    if(!time || time>now+60 || now-Number(message.date || time)>=48*3600) return 'stale';
    const incidentId=`${chat}:${message.media_group_id ? `album:${message.media_group_id}` : `message:${message.message_id}`}`;
    const snapshot=await store.moderationState(chat,!message.sender_chat && userId(message.from?.id) ? message.from.id : null,incidentId);
    const {group,activation}=snapshot;
    if(!group.enabled || time<Math.max(group.activated_at,activation)) return 'paused_or_old';
    const bot=await me();
    if(Number(message.from?.id)===Number(bot.id)) return 'self';
    if(message.sender_chat) {
      const info=await api.call('getChat',{chat_id:chat});
      if(String(message.sender_chat.id)===String(info.linked_chat_id)) return 'linked_channel';
    }
    // These initial lookups are independent. Authority is still rechecked
    // separately immediately before deletion and immediately before a ban.
    const [own,initialMember]=await Promise.all([
      member(chat,bot.id),
      !message.sender_chat && userId(message.from?.id) ? member(chat,message.from.id) : null,
    ]);
    if(!admin(own) || !own.can_delete_messages || !own.can_restrict_members) {
      await guards.records.health(chat,'missing_permissions',true,now);
      const language=context.groupLanguage || 'sw';
      await notice(chat,language==='en' ? '🛡 Pilot is waiting for an admin to finish its permissions. The private bot guide has the next steps.' : '🛡 Pilot inasubiri admin akamilishe ruhusa zake. Mwongozo unapatikana kwenye bot faraghani.');
      return 'missing_permissions';
    }
    if(message.chat.type!=='supergroup') {
      const language=context.groupLanguage || 'sw';
      await notice(chat,language==='en' ? '🛡 This group needs an admin to complete setup before timed moderation can begin. Open Pilot privately for guidance.' : '🛡 Group hili linahitaji admin akamilishe maandalizi kabla ya ban za muda kuanza. Fungua Pilot faraghani kwa mwongozo.');
      return 'requires_supergroup';
    }
    if(message.sender_chat) {
      // Telegram does not disclose the person behind unrelated channel senders.
      // banChatSenderChat is permanent and wider than the requested timed policy.
      let row=snapshot.incident;
      if(row?.status==='channel_review') {
        await deleteMessage(message);
        return await announcer.notify(row,message,false,context) ? 'notification_pending' : 'channel_review';
      }
      row=await store.plan({id:incidentId,chat_id:chat,user_id:null,message_id:message.message_id,event_at:time,created_at:now,strike:0,until_date:0,reasons:JSON.stringify(violation.reasons)});
      await deleteMessage(message);
      await store.status(row.id,'channel_review');
      return await announcer.notify(row,message,false,context) ? 'notification_pending' : 'channel_review';
    }
    if(!userId(message.from?.id)) return 'unknown_sender';
    const user=message.from.id;
    let live=initialMember;
    if(admin(live)) return 'admin';
    const state=snapshot.member;
    let row=snapshot.incident;
    if(time<=state.override_at) return 'admin_override';
    if(row?.status==='cancelled') return 'cancelled';
    if(row && ['failed','review'].includes(row.status)) {
      await deleteMessage(message); return row.status;
    }

    // Recovery after a crash/network timeout never re-issues an uncertain ban.
    if(row && ['ban_sent','uncertain','confirmed'].includes(row.status)) {
      if(message.message_id!==row.message_id) await deleteMessage(message);
      const matches=live.status==='kicked' && Number(live.until_date || 0)===Number(row.until_date);
      if(!matches) {
        await store.status(row.id,'review');
        await store.ensureExtras();
        await store.run("UPDATE notification_delivery SET status='cancelled',error_kind='membership_changed',updated_at=? WHERE incident_id=? AND status='pending'",clock(),row.id);
        return 'review';
      }
      if(row.status!=='confirmed') await store.confirm(row,now);
      await controlStore.audit({id:`incident:${row.id}`,chatId:chat,action:'ban_confirmed',targetId:user,incidentId:row.id,details:{strike:row.strike,until:row.until_date,reasons:violation.reasons},at:now});
      return await announcer.notify(row,message,true,context) ? 'notification_pending' : 'confirmed';
    }
    if(live.status==='kicked') { await deleteMessage(message); return 'already_banned'; }
    // queued messages from the same offence episode cannot escalate the punishment.
    if(state.episode_at && (time<=state.episode_at || (state.active_until>0 && time<=state.active_until))) {
      await deleteMessage(message); return 'same_episode';
    }
    if(state.active_until===-1 || state.active_until>now) {
      // The live membership contradicts our previous ban: a human has overridden it.
      await store.override(chat,user,now); return 'admin_override';
    }
    if(!row) {
      const strike=Math.min(3,state.strikes+1),duration=banDuration(strike);
      row=await store.plan({id:incidentId,chat_id:chat,user_id:user,message_id:message.message_id,event_at:time,created_at:now,strike,until_date:duration ? now+duration : 0,reasons:JSON.stringify(violation.reasons)});
    }
    // Fresh verification immediately before destructive actions, never cached admin lists.
    live=await member(chat,user);
    if(admin(live) || live.status==='kicked') { await store.status(row.id,'cancelled'); return 'membership_changed'; }
    await deleteMessage(message);
    await store.run('UPDATE incidents SET deleted=1 WHERE id=?',row.id);
    live=await member(chat,user);
    if(admin(live) || live.status==='kicked') { await store.status(row.id,'cancelled'); return 'membership_changed'; }
    const duration=banDuration(row.strike);
    row.until_date=duration ? clock()+duration : 0;
    await store.run("UPDATE incidents SET status='ban_sent',until_date=? WHERE id=?",row.until_date,row.id);
    try {
      const banned=await api.call('banChatMember',{chat_id:chat,user_id:user,until_date:row.until_date,revoke_messages:true});
      if(banned!==true) throw new Error('Ban was not confirmed');
    } catch(error) {
      if(error.code===429 && error.ambiguous===false) {
        await store.status(row.id,'planned'); throw error;
      }
      await store.status(row.id,error.ambiguous===false ? 'failed' : 'uncertain');
      // No success announcement or strike on an unconfirmed Telegram outcome.
      return error.ambiguous===false ? 'failed' : 'uncertain';
    }
    await store.confirm(row,now);
    // Observe an immediate human override before announcing a continuing ban.
    // banChatMember already confirmed the completed action. A failed secondary
    // read must not discard its announcement; a verified human override still wins.
    const [,after]=await Promise.all([
      controlStore.audit({id:`incident:${row.id}`,chatId:chat,action:'ban_confirmed',targetId:user,incidentId:row.id,details:{strike:row.strike,until:row.until_date,reasons:violation.reasons},at:now}),
      member(chat,user).catch(()=>null),
    ]);
    if(after && (after.status!=='kicked' || Number(after.until_date || 0)!==row.until_date)) {
      await store.override(chat,user,clock()); return 'admin_override';
    }
    return await announcer.notify(row,message,true,context) ? 'notification_pending' : 'confirmed';
  }

  async function handle(update,{callbackAcknowledgementStarted=false}={}) {
    if(!Number.isSafeInteger(update?.update_id)) return {status:'ignored'};
    const context=await loadUpdateContext(db,update);
    if(context.seen) return {status:'duplicate'};
    let status='ignored';
    let groupObservation=null;
    if(update.callback_query) {
      if(!await guards.callback(update.callback_query)) await experience.handleCallback(update.callback_query,update.update_id,{updateChecked:true,callbackAcknowledgementStarted,context});
      status='callback';
    } else if(update.chat_join_request) {
      const request=update.chat_join_request;
      if(Number.isSafeInteger(request.chat?.id) && request.chat.id<0 && ['group','supergroup'].includes(request.chat.type)) await broadcastRecords.rememberGroup(request.chat.id,Number(request.date || clock()));
      status=await guards.joinRequest(update.chat_join_request);
    } else if(update.chat_member || update.my_chat_member) {
      await membership(update);
      await guards.membership(update.chat_member || update.my_chat_member);
      const change=update.chat_member,joining=change?.new_chat_member;
      if(change&&['member','restricted'].includes(joining?.status)&&!['creator','administrator','member','restricted'].includes(change.old_chat_member?.status)&&!joining.user?.is_bot)await observe({chatId:change.chat.id,userId:joining.user?.id,kind:'join',id:`${joining.user?.id}:${change.date}`,at:change.date});
      status='membership';
    } else {
      const message=update.message || update.edited_message;
      if(message && messageChat(message.chat) && Number.isSafeInteger(message.message_id)) {
        if(Number.isSafeInteger(message.ephemeral_message_id)&&message.ephemeral_message_id>0) {
          // Ephemeral IDs can be reused and ordinary message_id is zero. These
          // private commands must never create moderation cases or flood counts.
          if(update.message&&(await toolCommands?.handle(message,update.update_id,{context})||await experience.handleCommand(message,update.update_id,{updateChecked:true,context})))status='command';
        } else if(message.message_id>0) {
        // An edit is re-evaluated for violations but can never re-run an admin command.
        const isGroup=['group','supergroup'].includes(message.chat.type);
        if(isGroup && message.chat.id<0) {
          groupObservation={chat:message.chat.id,at:eventTime(message)};
          if(Number.isSafeInteger(message.migrate_to_chat_id) && message.migrate_to_chat_id<0) {
            await broadcastRecords.recordMembership(message.chat.id,'left',eventTime(message),update.update_id);
            await broadcastRecords.rememberGroup(message.migrate_to_chat_id,eventTime(message));
          }
          if(Number.isSafeInteger(message.migrate_from_chat_id) && message.migrate_from_chat_id<0) {
            await broadcastRecords.recordMembership(message.migrate_from_chat_id,'left',eventTime(message),update.update_id);
          }
        }
        // Additive group rules can only allow a link rejected by global policy.
        // Text, commands, allowed URLs and forward-only messages need no lookup.
        const needsRules=isGroup && analyzeMessage(message,[]).blockedLinks.length>0;
        const rules=needsRules ? await controlStore.rules(message.chat.id,clock()) : [];
        const groupViolation=isGroup && analyzeMessage(message,rules).reasons.length>0;
        let optionalAction=null;
        if(isGroup && !groupViolation) {
          const settings=context.groupSettings;
          // Long slash codes are delete-only, including edits and captions. Run
          // this before flood counting so repeating them can never trigger mute.
          optionalAction=await guards.commandSpam(message,settings);
          if(update.message) {
            if(!optionalAction) optionalAction=await guards.flood(message,settings);
            for(const user of message.new_chat_members || []) {await guards.welcome(message.chat.id,user,Number(message.date || clock()),settings);if(!user.is_bot)await observe({chatId:message.chat.id,userId:user.id,kind:'join',id:`${user.id}:${message.date}`,at:message.date});}
          }
        }
        if(optionalAction) status=optionalAction;
        else if(update.message && !groupViolation && (await toolCommands?.handle(message,update.update_id,{context})||await experience.handleCommand(message,update.update_id,{updateChecked:true,context}))) status='command';
        else status=await enforce(message,update,rules,context);
        if(isGroup&&['confirmed','command_spam','flood'].includes(status)&&!message.sender_chat)await observe({chatId:message.chat.id,userId:message.from?.id,kind:'spam',id:message.message_id,at:message.date});
        }
      }
    }
    // A ban can succeed while its HTTP response is lost. Telegram must retry
    // this update so we can reconcile membership without issuing another ban.
    if(status==='uncertain' || status==='notification_pending' || status==='command_spam_retry') {
      if(groupObservation) await broadcastRecords.rememberGroup(groupObservation.chat,groupObservation.at);
      return {status,retry:true};
    }
    if(groupObservation) await broadcastRecords.completeUpdate(groupObservation.chat,groupObservation.at,update.update_id,clock());
    else await store.done(update.update_id,clock());
    return {status};
  }
  async function controlMutation(payload) {
    const result=await guards.control(payload) || await control.mutate(payload);
    if(['pause','resume'].includes(payload.action)) await guards.records.health(payload.chatId,'paused',payload.action==='pause',clock(),'info');
    return result;
  }
  return {handle,controlMutation};
}
