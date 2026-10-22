import {writeFile} from 'node:fs/promises';
import {TestD1} from '../tests/helpers/d1.js';
import {applySchema,createStore} from '../src/store.js';
import {createModerator} from '../src/moderator.js';
import {createOwnerAuth} from '../src/owner-auth.js';
import {createBotIdentity} from '../src/bot-identity.js';
import {createToolsStore} from '../src/tools-store.js';
import {createOperationsStore} from '../src/operations-store.js';
import {createToolServices} from '../src/tools-api.js';
import {EXPERIENCE_VERSION} from '../src/bot-ui.js';

const NOW=1792700000,CHAT=-10001000100,BOT=987654321,TOKEN=`${BOT}:this_is_fake_test_token_do_not_send_network`;
const sleep=ms=>ms?new Promise(resolve=>setTimeout(resolve,ms)):Promise.resolve();
const clean=sql=>sql.replace(/\s+/g,' ').trim();
const longCode='/zTwNCWkqQtZ2UaBbYTVvyPRKI1KawCiwB6yVwDkEXYT14Y0HmKu6YI0qT';
let updateId=1000,messageId=1000;

function instrumentation(raw,{dbDelay=0,telegramDelay=0}={}){
  const traces=[],banned=new Map();let active=0;
  async function run(kind,label,work,details={}){
    const event={kind,label,...details,start:performance.now(),activeAtStart:++active};traces.push(event);
    try{await sleep(kind==='db'?dbDelay:telegramDelay);return await work();}
    finally{event.end=performance.now();active--;}
  }
  function statement(inner,sql){return {inner,sql,
    bind(...values){return statement(inner.bind(...values),sql);},
    first(...args){return run('db',clean(sql),()=>inner.first(...args),{method:'first',statements:1});},
    all(...args){return run('db',clean(sql),()=>inner.all(...args),{method:'all',statements:1});},
    run(...args){return run('db',clean(sql),()=>inner.run(...args),{method:'run',statements:1});},
    raw(...args){return run('db',clean(sql),()=>inner.raw(...args),{method:'raw',statements:1});},
  };}
  const db={prepare(sql){return statement(raw.prepare(sql),sql);},
    batch(statements){return run('db',statements.map(s=>clean(s.sql)).join(' || '),()=>raw.batch(statements.map(s=>s.inner)),{method:'batch',statements:statements.length});},
    exec(sql){return run('db',clean(sql),()=>raw.exec(sql),{method:'exec',statements:1});},
    withSession(){return db;},
  };
  const api={async call(method,payload={}){return run('telegram',method,async()=>{
    if(method==='getMe')return {id:BOT,is_bot:true,username:'sautilinkpilotbot'};
    if(method==='getChat')return {id:payload.chat_id,type:'supergroup',title:'Local performance fixture',permissions:{can_send_messages:true}};
    if(method==='getChatMember')return Number(payload.user_id)===BOT?{status:'administrator',can_delete_messages:true,can_restrict_members:true,can_invite_users:true,can_post_messages:true,user:{id:BOT,is_bot:true}}:
      banned.has(Number(payload.user_id))?{status:'kicked',until_date:banned.get(Number(payload.user_id)),user:{id:payload.user_id,is_bot:false}}:{status:'member',user:{id:payload.user_id,is_bot:false}};
    if(method==='banChatMember'){banned.set(Number(payload.user_id),payload.until_date);return true;}
    if(['deleteMessage','answerCallbackQuery','restrictChatMember'].includes(method))return true;
    if(['sendMessage','editMessageText'].includes(method))return {message_id:++messageId,chat:{id:payload.chat_id}};
    throw new Error(`Unexpected mocked API method: ${method}`);
  },{chat:payload.chat_id??null,user:payload.user_id??null});}};
  return {db,api,traces};
}

async function fixture(options={}){
  const raw=new TestD1();await applySchema(raw);await createToolsStore(raw).ensure();await createOperationsStore(raw).ensure();
  const store=createStore(raw);
  await store.settings({ready:'1',ready_since:NOW-100000,bot_id:BOT,bot_username:'sautilinkpilotbot',experience_version:EXPERIENCE_VERSION,experience_webhook_version:EXPERIENCE_VERSION});
  await store.group(CHAT);for(let n=100;n<125;n++)await store.member(CHAT,n);
  await raw.prepare('UPDATE pilot_owner SET user_id=?,claimed_at=? WHERE singleton=1').bind('42',NOW-10000).run();
  await raw.prepare("INSERT INTO pilot_broadcast_groups(chat_id,status,telegram_status,updated_at,event_id,observed_at) VALUES(?,'active','administrator',?,0,?)").bind(String(CHAT),NOW-1000,NOW-1000).run();
  const instrument=instrumentation(raw,options),{db,api}=instrument,clock=()=>NOW;
  const owner=createOwnerAuth({db,clock}),getIdentity=createBotIdentity({db,api,token:TOKEN,clock:()=>NOW*1000});
  const tools=createToolServices({db,api,owner,clock});
  const moderator=createModerator({db,api,owner,getIdentity,tools,clock});
  return {raw,...instrument,moderator};
}

function update(name,user=100){
  const id=++updateId;
  const from={id:user,is_bot:false,first_name:'Fixture',language_code:'en'};
  if(name.startsWith('callback_'))return {update_id:id,callback_query:{id:`callback-${id}`,from,data:name==='callback_home'?'pilot:home':'pilot:help',message:{message_id:++messageId,date:NOW-10,from:{id:BOT,is_bot:true,username:'sautilinkpilotbot'},chat:{id:user,type:'private'}}}};
  const privateChat=['start','help','private_text'].includes(name);
  const text={start:'/start',help:'/help',group_help:'/help',plain_text:'Habari za leo wote',private_text:'hello there',bad_link:'See https://unapproved.example/path',slash_code:longCode}[name];
  if(text==null)throw new Error(name);
  return {update_id:id,message:{message_id:++messageId,date:NOW,from,chat:privateChat?{id:user,type:'private'}:{id:CHAT,type:'supergroup',title:'Local performance fixture'},text}};
}

function summarize(name,warm,trace,outcome,duration){
  const checkpoints=trace.map((event,index)=>({event,index})).filter(({event})=>event.kind==='telegram'&&['sendMessage','editMessageText','deleteMessage','banChatMember','answerCallbackQuery'].includes(event.label)).map(({event,index})=>({
    method:event.label,dbBefore:trace.slice(0,index).filter(e=>e.kind==='db').length,
    telegramBefore:trace.slice(0,index).filter(e=>e.kind==='telegram').length,
    atMs:Number((event.start-trace[0].start).toFixed(2)),
  }));
  return {name,state:warm?'warm':'cold',outcome,durationMs:Number(duration.toFixed(2)),
    dbCalls:trace.filter(e=>e.kind==='db').length,dbStatements:trace.filter(e=>e.kind==='db').reduce((sum,e)=>sum+e.statements,0),
    telegramCalls:trace.filter(e=>e.kind==='telegram').length,maxConcurrent:Math.max(0,...trace.map(e=>e.activeAtStart)),checkpoints,
    trace:trace.map(({start,end,...rest})=>({...rest,startMs:Number((start-trace[0].start).toFixed(2)),durationMs:Number((end-start).toFixed(2))})),
  };
}

const results=[];
for(const name of ['start','help','callback_help','callback_home','private_text','plain_text','group_help','bad_link','bad_link_new_member','slash_code']){
  const f=await fixture();
  try{for(const warm of [false,true]){
    f.traces.length=0;const started=performance.now();
    const outcome=await f.moderator.handle(update(name==='bad_link_new_member'?'bad_link':name,name==='bad_link_new_member'?(warm?1001:1000):(warm?101:100)),{callbackAcknowledgementStarted:true});
    results.push(summarize(name,warm,[...f.traces],outcome,performance.now()-started));
  }}finally{f.raw.close();}
}

// Deliberately simulated IO latency demonstrates how already-queued work adds
// to a public command. It is not an estimate of live Cloudflare or Telegram RTT.
const simulated=[];
for(const preceding of ['plain_text','bad_link','slash_code']){
  const f=await fixture({dbDelay:10,telegramDelay:50});
  try{
    await f.moderator.handle(update('plain_text',110));f.traces.length=0;
    let tail=Promise.resolve();const started=performance.now(),items=[];
    const serial=(name,user)=>{
      const enqueued=performance.now();const task=tail.then(async()=>{
        const began=performance.now(),before=f.traces.length;const outcome=await f.moderator.handle(update(name,user));
        const trace=f.traces.slice(before);items.push({...summarize(name,true,trace,outcome,performance.now()-began),queueMs:Number((began-enqueued).toFixed(2))});
      });tail=task;return task;
    };
    const prior=serial(preceding,100),next=serial('group_help',101);await Promise.all([prior,next]);
    simulated.push({preceding,durationMs:Number((performance.now()-started).toFixed(2)),assumptions:{dbRoundTripMs:10,telegramRoundTripMs:50},items});
  }finally{f.raw.close();}
}
const report={label:process.env.PILOT_PROFILE_LABEL||'working-tree',baseHead:'44389093c3edd4f37a3ee51d3ea2637694062847',scope:'real TestD1 SQL; fake Telegram; createModerator/createToolServices/createBotIdentity as coordinator; no network; HTTP ingress adds one uncached readExperienceState D1 round trip; HTTP menu callback acknowledgement is outside this trace',results,simulated};
const output=process.env.PILOT_PROFILE_OUTPUT||'/tmp/pilot-speed-profile.json';
if(!/^\/tmp\/[A-Za-z0-9_.-]+\.json$/.test(output))throw new Error('Profile output must be a local /tmp JSON file');
await writeFile(output,JSON.stringify(report,null,2));
for(const row of results){console.log(JSON.stringify({name:row.name,state:row.state,outcome:row.outcome,db:row.dbCalls,tg:row.telegramCalls,parallel:row.maxConcurrent,checkpoints:row.checkpoints.map(({atMs,...event})=>event)}));}
for(const run of simulated)console.log(JSON.stringify({simulation:run.preceding,assumptions:run.assumptions,items:run.items.map(({trace,dbStatements,...item})=>item)}));
console.log(`Saved ${output}; zero real Telegram/network calls.`);
