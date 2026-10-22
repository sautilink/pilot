// Group responses target one verified Telegram user. Never degrade a private
// response into a normal group message when Telegram rejects ephemeral delivery.
export async function sendPrivateReply({api,message,text,extra={},clock=()=>Math.floor(Date.now()/1000)}) {
  const user=Number(message.from?.id);
  if(!Number.isSafeInteger(user)||user<=0||message.from?.is_bot||message.sender_chat)return null;
  const payload={text,parse_mode:'HTML',link_preview_options:{is_disabled:true},...extra};
  const privateChat=message.chat?.type==='private'&&Number(message.chat.id)===user;
  if(privateChat){try{return await api.call('sendMessage',{...payload,chat_id:user});}catch{return null;}}
  if(!['group','supergroup'].includes(message.chat?.type)||Number(message.chat.id)>=0)return null;
  const markup=extra.reply_markup?.inline_keyboard;
  const safeMarkup=Array.isArray(markup)?{inline_keyboard:markup.map(row=>row.map(button=>{
    if(button.url)return {text:button.text,url:button.url};
    const page=button.web_app?.url?.includes('/tools')?'tools':'dashboard';
    return {text:button.text,url:`https://t.me/sautilinkpilotbot?start=${page}`};
  }))}:undefined;
  try{
    return await api.call('sendMessage',{...payload,chat_id:message.chat.id,
      ...(safeMarkup?{reply_markup:safeMarkup}:{}),ephemeral_message_parameters:{receiver_user_id:user},
      ...(Number.isSafeInteger(message.ephemeral_message_id)&&clock()-Number(message.date)<=15?{reply_parameters:{ephemeral_message_id:message.ephemeral_message_id}}:{})});
  }catch(error){
    // A lost response may already have delivered; do not create a second copy.
    if(error?.ambiguous!==false)return {unconfirmed:true};
    try{return await api.call('sendMessage',{...payload,chat_id:user});}catch{return null;}
  }
}
