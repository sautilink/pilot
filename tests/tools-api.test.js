import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { TestD1 } from './helpers/d1.js';
import { applySchema } from '../src/store.js';
import { handleToolsApi,handleIntegrationApi,readToolsBody,createToolServices } from '../src/tools-api.js';
import { createRequestTiming } from '../src/request-timing.js';

const TOKEN='900:public_test_only_tools_token',NOW=1792670400,BASE='https://pilot.sautilink.com';
const ADMIN=101,MEMBER=102,BOT=900,GROUP=-1001001,OTHER=-1001002;
function signedData(user={id:ADMIN,first_name:'Asha',language_code:'en'},date=NOW) {
  const params=new URLSearchParams({auth_date:String(date),user:JSON.stringify(user),query_id:'public_tools_test'});
  const payload=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('\n');
  const key=createHmac('sha256','WebAppData').update(TOKEN).digest();
  params.set('hash',createHmac('sha256',key).update(payload).digest('hex'));return params.toString();
}
function request(body={view:'groups'},{method='POST',origin=BASE,auth=signedData(),headers={},raw,path='/api/tools'}={}) {
  return new Request(BASE+path,{method,headers:{...(origin===null?{}:{Origin:origin}),'Content-Type':'application/json',...(auth===null?{}:{Authorization:`tma ${auth}`}),...headers},...(method==='POST'?{body:raw??JSON.stringify(body)}:{})});
}
async function fixture(t) {
  const db=new TestD1();t.after(()=>db.close());await applySchema(db);
  const calls=[],dispatches=[],roles=new Map();let sequence=0;
  const api={async call(method,params={}){
    calls.push({method,params:structuredClone(params)});
    if(method==='getMe')return {id:BOT,username:'sautilinkpilotbot',is_bot:true};
    if(method==='getChatMember')return roles.get(`${params.chat_id}:${params.user_id}`)||{status:params.user_id===BOT||params.user_id===ADMIN&&params.chat_id===GROUP?'administrator':'member',can_delete_messages:true,can_restrict_members:true};
    if(method==='getChat')return {id:params.chat_id,type:'supergroup',title:params.chat_id===GROUP?'Our group':'Private other group'};
    throw new Error('No external mutation expected');
  }};
  const services=createToolServices({db,api,clock:()=>NOW});
  const env={DB:db,BOT_TOKEN:TOKEN,PUBLIC_BASE_URL:BASE,GROUPS:{idFromName:name=>name,get(name){return {async fetch(url,options){
    const incoming=url instanceof Request?url:new Request(url,options),payload=await incoming.json();
    dispatches.push({name,path:new URL(incoming.url).pathname,payload});
    try {return Response.json(await (new URL(incoming.url).pathname==='/integration'?services.integration.perform(payload):services.perform(payload)));}
    catch(error){return Response.json({ok:false,error:error.code||'unavailable'},{status:error.status||503});}
  }};}}};
  const run=value=>handleToolsApi(value,env,{api,clock:()=>NOW});
  const integration=value=>handleIntegrationApi(value,env,{api,clock:()=>NOW});
  const write=(action,input={},extra={})=>({action,input,chatId:GROUP,requestId:`tools_api_request_${++sequence}`,...extra});
  return {db,api,calls,dispatches,roles,services,env,run,integration,write};
}

test('the real coordinator timing gate accepts every tools dispatch category',()=>{
  const records=[];
  for(const route of ['tools','tools_wake','integration']) {
    const timing=createRequestTiming(route,{now:()=>1,sample:()=>true,report:record=>records.push(record)});
    timing.start();timing.finish();
  }
  assert.deepEqual(records.map(record=>record.route),['tools','tools_wake','integration']);
  assert.ok(records.every(record=>Object.keys(record).sort().join(',')==='callback_ack_ms,db_calls,db_ms,first_action_ms,first_reply_ms,handling_ms,outcome,queue_ms,route,telegram_calls,telegram_ms'));
  assert.throws(()=>createRequestTiming('/tools?chat=-1001'),/invalid_timing_route/);
});

test('tools API authenticates signed Telegram identity and routes writes through the exact group',async t=>{
  const f=await fixture(t),body=f.write('highlight_add',{text:'A selected resource'});
  const response=await f.run(request(body));assert.equal(response.status,200);
  assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Robots-Tag'),'noindex, nofollow');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'),null);
  assert.equal(f.dispatches.length,1);assert.equal(f.dispatches[0].name,String(GROUP));assert.equal(f.dispatches[0].path,'/tools');
  assert.deepEqual(f.dispatches[0].payload.actor,{id:ADMIN,first_name:'Asha',language_code:'en'});
  assert.equal((await f.run(request({...body,actor:{id:1}}))).status,400);
  assert.equal(f.dispatches.length,1);
});

test('invalid, expired, forged and foreign-origin sessions stop before group service work',async t=>{
  const f=await fixture(t);
  const cases=[
    [{method:'GET'},405],[{origin:'https://unrelated.example'},403],[{origin:'null'},403],
    [{auth:null},401],[{auth:signedData().replace('Asha','Owner')},401],
    [{auth:signedData(undefined,NOW-3601)},401],[{auth:signedData(undefined,NOW+61)},401],
    [{auth:signedData({id:ADMIN,first_name:'Bot',is_bot:true})},401],
  ];
  for(const [options,status] of cases)assert.equal((await f.run(request(f.write('highlight_add',{text:'Nope'}),options))).status,status);
  assert.equal(f.dispatches.length,0);assert.equal(f.calls.length,0);
});

test('tools API rejects unexpected methods, actions, views and malformed request structure',async t=>{
  const f=await fixture(t);
  for(const body of [null,[],{}, {view:'unknown',chatId:GROUP},{view:'operations'},
    {view:'operations',action:'highlight_add',chatId:GROUP},{view:'operations',chatId:42},{view:'operations',chatId:'-9007199254740992'},
    {view:'operations',chatId:GROUP,input:[]},f.write('unknown',{}),f.write('highlight_add',{text:'No'}, {requestId:'tiny'}),
  ])assert.equal((await f.run(request(body))).status,400);
  assert.equal((await f.run(request({}, {raw:'{broken'}))).status,400);
  assert.equal((await f.run(request({}, {headers:{'Content-Type':'text/plain'}}))).status,415);
  assert.equal(f.dispatches.length,0);
});

test('body limits account for bytes and streamed bodies, including Unicode',async t=>{
  const f=await fixture(t);
  assert.equal((await f.run(request({}, {raw:' '.repeat(24577)}))).status,413);
  assert.equal((await f.run(request({}, {headers:{'Content-Length':'24577'}}))).status,413);
  assert.equal((await f.run(request({view:'groups',input:{query:'😀'.repeat(7000)}}))).status,413);
  let cancelled=false;
  const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(16));controller.enqueue(new Uint8Array(16));},cancel(){cancelled=true;}});
  await assert.rejects(readToolsBody(new Request(BASE,{method:'POST',body,duplex:'half'}),20),error=>error.code==='request_too_large');
  assert.equal(cancelled,true);assert.equal(f.dispatches.length,0);
});

test('fresh group roles protect reports and configuration while member events stay available',async t=>{
  const f=await fixture(t);
  const success=await f.run(request({view:'governance',chatId:GROUP}));assert.equal(success.status,200);
  assert.equal((await f.run(request({view:'reports',chatId:OTHER}))).status,403);
  f.roles.set(`${GROUP}:${ADMIN}`,{status:'member'});
  assert.equal((await f.run(request({view:'governance',chatId:GROUP}))).status,403);
  assert.equal((await f.run(request({view:'events',chatId:GROUP}))).status,200);
  f.roles.set(`${GROUP}:${ADMIN}`,{status:'left'});
  assert.equal((await f.run(request({view:'events',chatId:GROUP}))).status,403);
  assert.ok(f.calls.filter(call=>call.method==='getChatMember'&&call.params.user_id===ADMIN).length>=5);
});

test('global feedback routes cannot attach a group or transfer group alarm state',async t=>{
  const f=await fixture(t),input={kind:'feature',message:'Could we have another language?'};
  for(const action of ['feedback_create','feedback_resolve'])assert.equal((await f.run(request(f.write(action,input)))).status,400);
  assert.equal((await f.run(request({view:'feedback',chatId:GROUP}))).status,400);
  assert.equal(f.dispatches.length,0);
  const response=await f.run(request({action:'feedback_create',input,requestId:'feedback_request_123456'}));
  assert.equal(response.status,200);assert.equal(f.dispatches[0].name,'__pilot_feedback__');assert.equal(f.dispatches[0].payload.chatId,undefined);
  assert.equal((await f.run(request({view:'feedback'}))).status,403);
});

test('integration gateway derives target group from a hashed credential and checks role inside the queue',async t=>{
  const f=await fixture(t),created=await f.services.governance.perform({actor:{id:ADMIN},chatId:GROUP,action:'integration_create',input:{label:'Test client',scopes:['events:read'],expiresInDays:1,confirmed:true},requestId:'token_create_api_test'});
  const incoming=(body={operation:'events'},options={})=>request(body,{path:'/api/integrations',auth:null,origin:null,headers:{Authorization:`Bearer ${created.token}`},...options});
  f.calls.length=0;
  const first=await f.integration(incoming());assert.equal(first.status,200);
  assert.equal(f.dispatches[0].name,String(GROUP));assert.equal(f.dispatches[0].path,'/integration');
  assert.equal(f.calls.filter(call=>call.method==='getChatMember'&&call.params.user_id===ADMIN).length,2);
  assert.equal((await f.integration(incoming({operation:'events',chatId:OTHER}))).status,400);
  f.roles.set(`${GROUP}:${ADMIN}`,{status:'member'});
  assert.equal((await f.integration(incoming())).status,403);
  assert.equal((await f.integration(incoming({operation:'events',input:{text:'x'.repeat(9000)}}))).status,413);
  assert.equal((await f.integration(request({operation:'events'},{path:'/api/integrations',auth:null}))).status,401);
});

test('unexpected diagnostics are redacted to a bounded error code',async t=>{
  const f=await fixture(t);f.api.call=async()=>{throw new Error(`provider ${TOKEN} secret`);};
  const response=await f.run(request({view:'operations',chatId:GROUP}));
  assert.equal(response.status,503);const output=await response.text();assert.equal(output.includes(TOKEN),false);assert.equal(output.includes('secret'),false);
  f.env.GROUPS.get=()=>({fetch:async()=>Response.json({ok:false,error:`provider ${TOKEN}`},{status:503})});
  const forwarded=await f.run(request(f.write('highlight_add',{text:'Hello'})));assert.deepEqual(await forwarded.json(),{ok:false,error:'unavailable'});
});
