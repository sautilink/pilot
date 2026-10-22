import { analyzeMessage, banDuration } from './policy.js';
import { createStore } from './store.js';
import { createAnnouncer } from './announcements.js';
import { createBotExperience } from './commands.js';
import { createControlStore } from './control-store.js';
import { createControlService } from './control-service.js';
import { createGuardrails } from './guardrails.js';
import { createBroadcastStore } from './broadcast-store.js';

export const RULES = '<b>🛡 SautiLink Pilot</b>\nGroup lenye utulivu, mazungumzo yenye nafasi.\n\nLinks zisizoruhusiwa na ujumbe wa forward huondolewa.\nAdhabu: saa 24 → siku 7 → ban ya kudumu.\n\nTumia /rules kuona sheria za members, au fungua bot faraghani kwa mwongozo.';
const ENGLISH_RULES = '<b>🛡 SautiLink Pilot</b>\nA calmer group. More room for conversation.\n\nUnapproved links and forwarded messages are removed.\nPenalties: 24 hours → 7 days → permanent ban.\n\nUse /rules for member rules, or open the bot privately for a guide.';
const admin = m => m?.status === 'creator' || m?.status === 'administrator';
const validId = id => Number.isSafeInteger(Number(id)) && Number(id) !== 0;
const userId = id => validId(id) && Number(id) > 0;
const eventTime = m => Number(m.edit_date || m.date || 0);

export function createModerator({db,api,clock=()=>Math.floor(Date.now()/1000),dispatchControl,appUrl,owner,dispatchBroadcast}) {
  const store=createStore(db);
  const controlStore=createControlStore(db),control=createControlService({db,api,clock});
  let identity;
  const me=async()=>identity ||= await api.call('getMe');
  const say=(chat,text,extra={})=>api.call('sendMessage',{
    chat_id:Number(chat),text,parse_mode:'HTML',link_preview_options:{is_disabled:true},...extra
  });
  const member=(chat,user)=>api.call('getChatMember',{chat_id:Number(chat),user_id:Number(user)});
  const announcer=createAnnouncer({store,api,clock,controlStore});
  const guards=createGuardrails({db,store,controlStore,api,clock,me,say});
  const broadcastRecords=createBroadcastStore(db);
  const experience=createBotExperience({db,store,api,clock,me,say,control,controlStore,dispatchControl,appUrl,owner,dispatchBroadcast});

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

  async function enforce(message,update,rules=[]) {
    const chat=message.chat.id, now=clock(), time=eventTime(message);
    if(!['group','supergroup'].includes(message.chat.type) || !validId(chat)) return 'ignored';
    if(String(message.sender_chat?.id)===String(chat)) return 'anonymous_admin';
    const violation=analyzeMessage(message,rules);
    if(!violation.reasons.length) return 'allowed';
    if(!time || time>now+60 || now-Number(message.date || time)>=48*3600) return 'stale';
    const group=await store.group(chat);
    const activation=Number(await store.setting('ready_since') || 0);
    if(!group.enabled || time<Math.max(group.activated_at,activation)) return 'paused_or_old';
    const bot=await me();
    if(Number(message.from?.id)===Number(bot.id)) return 'self';
    const info=await api.call('getChat',{chat_id:chat});
    if(message.sender_chat && String(message.sender_chat.id)===String(info.linked_chat_id)) return 'linked_channel';
    const own=await member(chat,bot.id);
    if(!admin(own) || !own.can_delete_messages || !own.can_restrict_members) {
      await guards.records.health(chat,'missing_permissions',true,now);
      const language=await store.getLanguage('group',chat);
      await notice(chat,language==='en' ? '🛡 Pilot is waiting for an admin to finish its permissions. The private bot guide has the next steps.' : '🛡 Pilot inasubiri admin akamilishe ruhusa zake. Mwongozo unapatikana kwenye bot faraghani.');
      return 'missing_permissions';
    }
    if(message.chat.type!=='supergroup') {
      const language=await store.getLanguage('group',chat);
      await notice(chat,language==='en' ? '🛡 This group needs an admin to complete setup before timed moderation can begin. Open Pilot privately for guidance.' : '🛡 Group hili linahitaji admin akamilishe maandalizi kabla ya ban za muda kuanza. Fungua Pilot faraghani kwa mwongozo.');
      return 'requires_supergroup';
    }
    const incidentId=`${chat}:${message.media_group_id ? `album:${message.media_group_id}` : `message:${message.message_id}`}`;
    if(message.sender_chat) {
      // Telegram does not disclose the person behind unrelated channel senders.
      // banChatSenderChat is permanent and wider than the requested timed policy.
      let row=await store.incident(incidentId);
      if(row?.status==='channel_review') {
        await deleteMessage(message);
        return await announcer.notify(row,message,false) ? 'notification_pending' : 'channel_review';
      }
      row=await store.plan({id:incidentId,chat_id:chat,user_id:null,message_id:message.message_id,event_at:time,created_at:now,strike:0,until_date:0,reasons:JSON.stringify(violation.reasons)});
      await deleteMessage(message);
      await store.status(row.id,'channel_review');
      return await announcer.notify(row,message,false) ? 'notification_pending' : 'channel_review';
    }
    if(!userId(message.from?.id)) return 'unknown_sender';
    const user=message.from.id;
    let live=await member(chat,user);
    if(admin(live)) return 'admin';
    const state=await store.member(chat,user);
    let row=await store.incident(incidentId);
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
      return await announcer.notify(row,message) ? 'notification_pending' : 'confirmed';
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
    await controlStore.audit({id:`incident:${row.id}`,chatId:chat,action:'ban_confirmed',targetId:user,incidentId:row.id,details:{strike:row.strike,until:row.until_date,reasons:violation.reasons},at:now});
    // Observe an immediate human override before announcing a continuing ban.
    // banChatMember already confirmed the completed action. A failed secondary
    // read must not discard its announcement; a verified human override still wins.
    let after;
    try { after=await member(chat,user); } catch { /* Preserve the confirmed action. */ }
    if(after && (after.status!=='kicked' || Number(after.until_date || 0)!==row.until_date)) {
      await store.override(chat,user,clock()); return 'admin_override';
    }
    return await announcer.notify(row,message) ? 'notification_pending' : 'confirmed';
  }

  async function handle(update) {
    if(!Number.isSafeInteger(update?.update_id)) return {status:'ignored'};
    if(await store.seen(update.update_id)) return {status:'duplicate'};
    let status='ignored';
    if(update.callback_query) {
      if(!await guards.callback(update.callback_query)) await experience.handleCallback(update.callback_query,update.update_id);
      status='callback';
    } else if(update.chat_join_request) {
      const request=update.chat_join_request;
      if(Number.isSafeInteger(request.chat?.id) && request.chat.id<0 && ['group','supergroup'].includes(request.chat.type)) await broadcastRecords.rememberGroup(request.chat.id,Number(request.date || clock()));
      status=await guards.joinRequest(update.chat_join_request);
    } else if(update.chat_member || update.my_chat_member) {
      await membership(update);
      await guards.membership(update.chat_member || update.my_chat_member);
      status='membership';
    } else {
      const message=update.message || update.edited_message;
      if(message && validId(message.chat?.id) && Number.isSafeInteger(message.message_id)) {
        // An edit is re-evaluated for violations but can never re-run an admin command.
        const isGroup=['group','supergroup'].includes(message.chat.type);
        if(isGroup && message.chat.id<0) {
          await broadcastRecords.rememberGroup(message.chat.id,eventTime(message));
          if(Number.isSafeInteger(message.migrate_to_chat_id) && message.migrate_to_chat_id<0) {
            await broadcastRecords.recordMembership(message.chat.id,'left',eventTime(message),update.update_id);
            await broadcastRecords.rememberGroup(message.migrate_to_chat_id,eventTime(message));
          }
          if(Number.isSafeInteger(message.migrate_from_chat_id) && message.migrate_from_chat_id<0) {
            await broadcastRecords.recordMembership(message.migrate_from_chat_id,'left',eventTime(message),update.update_id);
          }
        }
        const rules=isGroup ? await controlStore.rules(message.chat.id) : [];
        const groupViolation=isGroup && analyzeMessage(message,rules).reasons.length>0;
        let optionalAction=null;
        if(update.message && isGroup && !groupViolation) {
          const settings=await controlStore.settings(message.chat.id);
          optionalAction=await guards.flood(message,settings);
          for(const user of message.new_chat_members || []) await guards.welcome(message.chat.id,user,Number(message.date || clock()),settings);
        }
        if(optionalAction) status=optionalAction;
        else if(update.message && !groupViolation && await experience.handleCommand(message,update.update_id)) status='command';
        else status=await enforce(message,update,rules);
      }
    }
    // A ban can succeed while its HTTP response is lost. Telegram must retry
    // this update so we can reconcile membership without issuing another ban.
    if(status==='uncertain' || status==='notification_pending') return {status,retry:true};
    await store.done(update.update_id,clock());
    return {status};
  }
  async function controlMutation(payload) {
    const result=await guards.control(payload) || await control.mutate(payload);
    if(['pause','resume'].includes(payload.action)) await guards.records.health(payload.chatId,'paused',payload.action==='pause',clock(),'info');
    return result;
  }
  return {handle,controlMutation};
}
