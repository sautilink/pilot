import { analyzeMessage, banDuration, escapeHtml } from './policy.js';
import { createStore } from './store.js';

export const RULES = '<b>SautiLink Pilot</b>\nLinks zisizoruhusiwa na forwarded messages zinaondolewa.\nKosa 1: ban saa 24. Kosa 2: siku 7. Kosa 3: permanent ban.\nOwner, admins, anonymous admins na posts rasmi za linked channel wameruhusiwa.\nLinks za sautilink.com na subdomains zake, pamoja na t.me/techhubtz, t.me/sautilink, t.me/sautilink_cloud na t.me/drcharlesofficial zinaruhusiwa.\n\nAdmin: /status, /strikes, /forgive, /unban, /pause, /resume. Reply kwa ujumbe wa mtu au tumia numeric user ID kwa amri zinazomhusu mtu.\n\nBan za muda zinahitaji supergroup. Ban ya Telegram inaweza pia kufuta ujumbe mwingine wa mtumiaji.';
const admin = m => m?.status === 'creator' || m?.status === 'administrator';
const validId = id => Number.isSafeInteger(Number(id)) && Number(id) !== 0;
const userId = id => validId(id) && Number(id) > 0;
const eventTime = m => Number(m.edit_date || m.date || 0);

export function createModerator({db,api,clock=()=>Math.floor(Date.now()/1000)}) {
  const store=createStore(db);
  let identity;
  const me=async()=>identity ||= await api.call('getMe');
  const say=(chat,text,extra={})=>api.call('sendMessage',{
    chat_id:Number(chat),text,parse_mode:'HTML',link_preview_options:{is_disabled:true},...extra
  });
  const member=(chat,user)=>api.call('getChatMember',{chat_id:Number(chat),user_id:Number(user)});

  async function notice(chat,text) {
    const group=await store.group(chat), now=clock();
    if(group.notice_at && now-group.notice_at<3600) return;
    // Claim first: a failed response must not flood the chat with repeated notices.
    await store.run('UPDATE groups SET notice_at=? WHERE chat_id=?',now,String(chat));
    try { await say(chat,text); } catch { /* Permission failures are visible via /status. */ }
  }

  async function deleteMessage(message) {
    try {
      await api.call('deleteMessage',{chat_id:message.chat.id,message_id:message.message_id});
      return true;
    } catch(error) {
      if(error.code===400 && /message to delete not found/i.test(error.message)) return true;
      throw error;
    }
  }

  async function notifyIncident(row,message,success=true) {
    if(!await store.claimNotice(row.id)) return;
    const name=escapeHtml([message.from?.first_name,message.from?.last_name].filter(Boolean).join(' ') || 'Mtumiaji');
    const who=row.user_id ? `<a href="tg://user?id=${Number(row.user_id)}">${name}</a>` : escapeHtml(message.sender_chat?.title || 'Channel');
    const reasons=JSON.parse(row.reasons);
    const reason=reasons.map(x=>x==='forward' ? 'Kutuma forwarded message isiyoruhusiwa' : 'Kutuma link isiyoruhusiwa').join(' na ');
    const duration=row.strike===1 ? 'saa 24' : row.strike===2 ? 'siku 7' : 'muda wote (permanent ban)';
    const text=success
      ? `⛔ <b>${who} amefungiwa kwa ${duration}.</b>\n<b>Sababu:</b> ${reason}.\n<b>Kosa:</b> ${row.strike} kati ya 3.\n🗑 Ujumbe umeondolewa.\n<b>SautiLink Pilot</b>`
      : `🗑 Ujumbe wa ${who} umeondolewa.\n<b>Sababu:</b> ${reason}.\nKufungiwa hakujathibitishwa; admin tafadhali kagua hali ya mtumaji.\n<b>SautiLink Pilot</b>`;
    try { await say(message.chat.id,text,message.message_thread_id ? {message_thread_id:message.message_thread_id} : {}); }
    catch { /* At-most-once notices: Telegram has no sendMessage idempotency key. */ }
  }

  async function handleCommand(message,updateId) {
    const match=String(message.text || '').match(/^\/(start|help|pilot|rules|status|strikes|forgive|unban|pause|resume)(?:@([A-Za-z0-9_]+))?(?:\s+([\s\S]*))?$/i);
    if(!match) return false;
    const bot=await me(),command=match[1].toLowerCase();
    if(match[2] && match[2].toLowerCase()!==bot.username.toLowerCase()) return true;
    const chat=message.chat.id;
    const acknowledge=async text=>{ try { await say(chat,text); } catch { /* Never replay a successful admin action because its notice failed. */ } };
    if(['start','help','pilot','rules'].includes(command)) {
      await say(chat,RULES, message.chat.type==='private' ? {
        reply_markup:{inline_keyboard:[[{text:'Ongeza kwenye group',url:`https://t.me/${bot.username}?startgroup=true&admin=delete_messages+restrict_members`}]]}
      } : {});
      return true;
    }
    if(!['group','supergroup'].includes(message.chat.type)) {
      await say(chat,'Tumia amri hii ndani ya group unalosimamia.'); return true;
    }
    const anonymous=String(message.sender_chat?.id)===String(chat);
    if(!anonymous && (!userId(message.from?.id) || message.sender_chat || !admin(await member(chat,message.from.id)))) {
      await say(chat,'Amri hii ni ya owner au admin wa group hili.'); return true;
    }
    const group=await store.group(chat);
    if(command==='status') {
      const own=await member(chat,bot.id);
      await say(chat,`<b>SautiLink Pilot</b>\nModeration: ${group.enabled ? 'imewashwa' : 'imesitishwa'}.\nAina: ${escapeHtml(message.chat.type)}.\nRuhusa: ${own.can_delete_messages && own.can_restrict_members ? 'zimekamilika' : 'inahitaji Delete messages na Ban users'}.\nAdhabu: saa 24 → siku 7 → permanent.`); return true;
    }
    if(command==='pause' || command==='resume') {
      await db.batch([
        db.prepare('UPDATE groups SET enabled=?,activated_at=? WHERE chat_id=?').bind(command==='resume' ? 1 : 0,clock(),String(chat)),
        db.prepare('INSERT OR IGNORE INTO processed_updates VALUES(?,?)').bind(updateId,clock())
      ]);
      await acknowledge(command==='resume' ? 'Moderation imewashwa. Nitachunguza ujumbe mpya kuanzia sasa.' : 'Moderation imesitishwa na admin. Tumia /resume kuiwasha.'); return true;
    }
    // Never attribute a channel's compatibility user to a real person.
    const target=match[3]?.trim() || (!message.reply_to_message?.sender_chat && message.reply_to_message?.from?.id);
    if(!userId(target) || !/^\d+$/.test(String(target))) {
      await say(chat,`Reply kwa ujumbe wa mtumiaji au tumia /${command} USER_ID. Username pekee haitoshi kutambua mtu kwa uhakika.`); return true;
    }
    const state=await store.member(chat,target);
    if(command==='strikes') { await say(chat,`Mtumiaji <code>${Number(target)}</code>: makosa ${state.strikes} kati ya 3 katika group hili.`); return true; }
    if(command==='unban') {
      // Telegram offers no idempotency key. Claim before unban so a lost response
      // can never cause an old command to remove a later human/bot punishment.
      await store.done(updateId,clock());
      try { await api.call('unbanChatMember',{chat_id:chat,user_id:Number(target),only_if_banned:true}); }
      catch {
        await acknowledge('Kuondolewa kwa ban hakujathibitishwa. Admin kagua hali ya mtumiaji kwenye Telegram kabla ya kurudia amri.');
        return true;
      }
      await store.override(chat,target,clock(),false);
      await acknowledge('Ban imeondolewa. Mtumiaji anaweza kujiunga tena. Historia ya makosa imehifadhiwa.'); return true;
    }
    await store.override(chat,target,clock(),true,updateId);
    await acknowledge('Historia ya makosa ya mtumiaji katika group hili imesafishwa. Tumia /unban ikiwa pia unataka kuondoa ban iliyopo.');
    return true;
  }

  async function membership(update) {
    const change=update.chat_member || update.my_chat_member;
    if(!change || !validId(change.chat?.id)) return;
    const chat=change.chat.id, bot=await me();
    if(update.my_chat_member) {
      const group=await store.group(chat);
      const own=change.new_chat_member;
      if(admin(own) && !admin(change.old_chat_member)) {
        await store.run('UPDATE groups SET activated_at=? WHERE chat_id=?',Number(change.date || clock()),String(chat));
        await notice(chat,`<b>SautiLink Pilot imeongezwa.</b>\n${RULES}`);
      }
      return;
    }
    const target=change.new_chat_member?.user?.id, actor=change.from?.id;
    if(!userId(target) || !userId(actor) || Number(actor)===Number(bot.id) || Number(actor)===Number(target)) return;
    // Membership updates include joins too; only verified human admin actions override policy.
    if(admin(await member(chat,actor))) await store.override(chat,target,Number(change.date || clock()));
  }

  async function enforce(message,update) {
    const chat=message.chat.id, now=clock(), time=eventTime(message);
    if(!['group','supergroup'].includes(message.chat.type) || !validId(chat)) return 'ignored';
    if(String(message.sender_chat?.id)===String(chat)) return 'anonymous_admin';
    const violation=analyzeMessage(message);
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
      await notice(chat,'SautiLink Pilot inahitaji ruhusa za <b>Delete messages</b> na <b>Ban users</b> kabla ya kuanza moderation.');
      return 'missing_permissions';
    }
    if(message.chat.type!=='supergroup') {
      await notice(chat,'Ban za saa 24 na siku 7 zinahitaji <b>supergroup</b>. Admin boresha group hili kuwa supergroup kabla ya moderation kuanza.');
      return 'requires_supergroup';
    }
    const incidentId=`${chat}:${message.media_group_id ? `album:${message.media_group_id}` : `message:${message.message_id}`}`;
    if(message.sender_chat) {
      // Telegram does not disclose the person behind unrelated channel senders.
      // banChatSenderChat is permanent and wider than the requested timed policy.
      let row=await store.incident(incidentId);
      if(row?.status==='channel_review') { await deleteMessage(message); return 'channel_review'; }
      row=await store.plan({id:incidentId,chat_id:chat,user_id:null,message_id:message.message_id,event_at:time,created_at:now,strike:0,until_date:0,reasons:JSON.stringify(violation.reasons)});
      await deleteMessage(message);
      await store.status(row.id,'channel_review');
      await notifyIncident(row,message,false);
      return 'channel_review';
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
      if(!matches) { await store.status(row.id,'review'); return 'review'; }
      if(row.status!=='confirmed') await store.confirm(row,now);
      await notifyIncident(row,message);
      return 'confirmed';
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
      await api.call('banChatMember',{chat_id:chat,user_id:user,until_date:row.until_date,revoke_messages:true});
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
    live=await member(chat,user);
    if(live.status!=='kicked' || Number(live.until_date || 0)!==row.until_date) {
      await store.override(chat,user,clock()); return 'admin_override';
    }
    await notifyIncident(row,message);
    return 'confirmed';
  }

  async function handle(update) {
    if(!Number.isSafeInteger(update?.update_id)) return {status:'ignored'};
    if(await store.seen(update.update_id)) return {status:'duplicate'};
    let status='ignored';
    if(update.chat_member || update.my_chat_member) {
      await membership(update); status='membership';
    } else {
      const message=update.message || update.edited_message;
      if(message && validId(message.chat?.id) && Number.isSafeInteger(message.message_id)) {
        // An edit is re-evaluated for violations but can never re-run an admin command.
        const groupViolation=['group','supergroup'].includes(message.chat.type) && analyzeMessage(message).reasons.length>0;
        if(update.message && !groupViolation && await handleCommand(message,update.update_id)) status='command';
        else status=await enforce(message,update);
      }
    }
    // A ban can succeed while its HTTP response is lost. Telegram must retry
    // this update so we can reconcile membership without issuing another ban.
    if(status==='uncertain') return {status,retry:true};
    await store.done(update.update_id,clock());
    return {status};
  }
  return {handle};
}
