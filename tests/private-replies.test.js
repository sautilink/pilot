import test from 'node:test';
import assert from 'node:assert/strict';
import { sendPrivateReply } from '../src/private-replies.js';
import { TelegramError } from '../src/telegram.js';

const USER=101,GROUP=-1001001,NOW=1792670400;
const group=extra=>({message_id:5,date:NOW,chat:{id:GROUP,type:'supergroup'},from:{id:USER,is_bot:false},...extra});
function fixture(hook) {
  const calls=[];const api={async call(method,params){calls.push({method,params:structuredClone(params)});return hook?hook(params,calls.length):{message_id:0,ephemeral_message_id:55};}};
  return {calls,send:(extra={})=>sendPrivateReply({api,message:group(),text:'Private case detail',clock:()=>NOW,...extra})};
}

test('group responses target only the triggering member via ephemeral parameters',async()=>{
  const f=fixture();await f.send();assert.equal(f.calls.length,1);
  assert.equal(f.calls[0].params.chat_id,GROUP);assert.deepEqual(f.calls[0].params.ephemeral_message_parameters,{receiver_user_id:USER});
  assert.equal(f.calls[0].params.text,'Private case detail');
});

test('a definite ephemeral rejection falls back only to direct private chat',async()=>{
  const f=fixture((params,index)=>{if(index===1)throw new TelegramError('method not supported',400,false);return {message_id:9};});
  await f.send();assert.equal(f.calls.length,2);
  assert.equal(f.calls[0].params.chat_id,GROUP);assert.ok(f.calls[0].params.ephemeral_message_parameters);
  assert.equal(f.calls[1].params.chat_id,USER);assert.equal(f.calls[1].params.ephemeral_message_parameters,undefined);
  assert.equal(f.calls.some(call=>call.params.chat_id===GROUP&&!call.params.ephemeral_message_parameters),false);
});

test('blocked private chat does not degrade to a public group response',async()=>{
  const f=fixture(()=>{throw new TelegramError('forbidden',403,false);});const result=await f.send();
  assert.equal(result,null);assert.deepEqual(f.calls.map(call=>call.params.chat_id),[GROUP,USER]);
});

test('uncertain ephemeral delivery never retries or creates a direct-message duplicate',async()=>{
  const f=fixture(()=>{throw new TelegramError('timeout',0,true);});
  assert.deepEqual(await f.send(),{unconfirmed:true});assert.equal(f.calls.length,1);
  const plain=fixture(()=>{throw new Error('transport ended');});assert.deepEqual(await plain.send(),{unconfirmed:true});assert.equal(plain.calls.length,1);
});

test('private chats reply only to their authenticated peer and never include ephemeral parameters',async()=>{
  const f=fixture();await f.send({message:group({chat:{id:USER,type:'private'}}),extra:{chat_id:999}});
  assert.equal(f.calls[0].params.chat_id,USER);assert.equal(f.calls[0].params.ephemeral_message_parameters,undefined);
  const mismatch=fixture();assert.equal(await mismatch.send({message:group({chat:{id:USER+1,type:'private'}})}),null);assert.equal(mismatch.calls.length,0);
});

test('anonymous admin, channel and bot senders cannot generate private replies to synthetic identities',async()=>{
  for(const change of [{sender_chat:{id:GROUP,type:'supergroup'}},{from:{id:USER,is_bot:true}},{from:{id:0}},{chat:{id:GROUP,type:'channel'}},{chat:{id:5,type:'supergroup'}}]){
    const f=fixture();assert.equal(await f.send({message:group(change)}),null);assert.equal(f.calls.length,0);
  }
});

test('group buttons use safe private-chat links while private fallback keeps its Web App button',async()=>{
  const markup={inline_keyboard:[[{text:'Tools',web_app:{url:'https://pilot.sautilink.com/tools?chat=-1001001'}},{text:'Public guide',url:'https://pilot.sautilink.com/'}]]};
  const f=fixture((params,index)=>{if(index===1)throw new TelegramError('unsupported',400,false);return {message_id:8};});
  await f.send({extra:{reply_markup:markup}});
  const first=f.calls[0].params.reply_markup.inline_keyboard[0],fallback=f.calls[1].params.reply_markup.inline_keyboard[0];
  assert.equal(first[0].web_app,undefined);assert.equal(first[0].url,'https://t.me/sautilinkpilotbot?start=tools');assert.equal(first[1].url,'https://pilot.sautilink.com/');
  assert.deepEqual(fallback[0].web_app,markup.inline_keyboard[0][0].web_app);
});

test('a fresh ephemeral command can be replied to without confusing its ID with a public message',async()=>{
  const f=fixture();await f.send({message:group({message_id:0,ephemeral_message_id:7})});
  assert.equal(f.calls[0].params.reply_parameters?.ephemeral_message_id,7);
  assert.equal(f.calls[0].params.reply_parameters?.message_id,undefined);
  const old=fixture();await old.send({message:group({message_id:0,ephemeral_message_id:7,date:NOW-16})});
  assert.equal(old.calls[0].params.reply_parameters,undefined);
});
