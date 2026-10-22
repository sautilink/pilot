import { validateMiniAppInitData } from './miniapp-auth.js';
import { createControlService } from './control-service.js';
import { createTelegram } from './telegram.js';
import { createCommunityService, COMMUNITY_READS, COMMUNITY_ACTIONS } from './community-service.js';
import { createOperationsService } from './operations-service.js';
import { createGovernanceService, GOVERNANCE_VIEWS, GOVERNANCE_ACTIONS } from './governance-service.js';
import { createIntegrationService } from './integration-service.js';
import { fail, objectKeys, validChat } from './tools-store.js';
import { createOwnerAuth } from './owner-auth.js';

const OP_READS=new Set(['operations','events']);
const OP_ACTIONS=new Set(['schedule_create','schedule_update','schedule_cancel','event_create','event_update','event_cancel','event_rsvp','highlight_add','highlight_remove','highlight_schedule']);
const NO_CHAT_READS=new Set(['groups','feedback']);
const NO_CHAT_ACTIONS=new Set(['feedback_create','feedback_resolve']);
const HEADERS={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'};
const result=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:HEADERS});
function failure(error){const code=typeof error?.code==='string'&&/^[A-Za-z_]{2,64}$/.test(error.code)?error.code:'unavailable';const status=Number.isInteger(error?.status)&&error.status>=400&&error.status<=599?error.status:503;return result({ok:false,error:code},status);}
export async function readToolsBody(request,max=24576){
  if(Number(request.headers.get('Content-Length')||0)>max)fail('request_too_large',413);
  const reader=request.body?.getReader();if(!reader)fail('invalid_request');let size=0;const chunks=[];
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){await reader.cancel();fail('request_too_large',413);}chunks.push(part.value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail('invalid_request');}
}
function checkRequest(request,env,{integration=false}={}){
  if(request.method!=='POST')fail('method_not_allowed',405);
  const origin=new URL(env.PUBLIC_BASE_URL||'https://pilot.sautilink.com').origin;
  if(request.headers.has('Origin')&&request.headers.get('Origin')!==origin)fail('origin_rejected',403);
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type')||''))fail('invalid_request',415);
  if(!env.DB||!env.BOT_TOKEN||!env.GROUPS&&!integration)fail('unavailable',503);
}
export function createToolServices({db,api,clock,owner}){
  const community=createCommunityService({db,api,clock,owner}),operations=createOperationsService({db,api,clock}),governance=createGovernanceService({db,api,clock});
  return {community,operations,governance,integration:createIntegrationService({db,api,community,operations,clock}),
    async query(payload){if(COMMUNITY_READS.has(payload.view))return community.query(payload);if(OP_READS.has(payload.view))return operations.query(payload);if(GOVERNANCE_VIEWS.has(payload.view))return governance.query(payload);fail('invalid_view');},
    async perform(payload){if(COMMUNITY_ACTIONS.has(payload.action))return community.perform(payload);if(OP_ACTIONS.has(payload.action))return operations.perform(payload);if(GOVERNANCE_ACTIONS.has(payload.action))return governance.perform(payload);fail('invalid_action');}};
}
export async function handleToolsApi(request,env,{api,clock=()=>Math.floor(Date.now()/1000)}={}){
  try{
    checkRequest(request,env);
    const auth=request.headers.get('Authorization')||'';if(!auth.startsWith('tma '))fail('unauthorized',401);
    const {actor}=await validateMiniAppInitData(auth.slice(4),env.BOT_TOKEN,{now:clock()});
    const body=await readToolsBody(request);objectKeys(body,['view','action','chatId','input','requestId']);
    if((body.view===undefined)===(body.action===undefined))fail('invalid_request');
    const input=body.input??{};if(!input||typeof input!=='object'||Array.isArray(input))fail('invalid_request');
    const chatId=body.chatId==null?undefined:validChat(body.chatId),telegram=api||createTelegram(env.BOT_TOKEN);
    if(chatId&&(NO_CHAT_ACTIONS.has(body.action)||body.view==='feedback'))fail('invalid_chat');
    if(body.view!==undefined){
      if(!NO_CHAT_READS.has(body.view)&&!chatId)fail('invalid_chat');
      const data=body.view==='groups'?await createControlService({db:env.DB,api:telegram,clock}).query({actor,view:'groups',input}):await createToolServices({db:env.DB,api:telegram,clock}).query({actor,chatId,view:body.view,input});
      if(body.view==='groups')data.owner=await createOwnerAuth({db:env.DB,clock}).isOwner(actor);
      return result({ok:true,data});
    }
    if(!NO_CHAT_ACTIONS.has(body.action)&&!chatId)fail('invalid_chat');
    if(!COMMUNITY_ACTIONS.has(body.action)&&!OP_ACTIONS.has(body.action)&&!GOVERNANCE_ACTIONS.has(body.action))fail('invalid_action');
    if(typeof body.requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(body.requestId))fail('invalid_request_id');
    const name=NO_CHAT_ACTIONS.has(body.action)?'__pilot_feedback__':chatId;
    const response=await env.GROUPS.get(env.GROUPS.idFromName(name)).fetch('https://group.internal/tools',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actor,chatId,action:body.action,input,requestId:body.requestId})});
    const data=await response.json();if(!response.ok||data?.ok===false)throw {code:data.error,status:response.status};return result({ok:true,data});
  }catch(error){return failure(error);}
}
export async function handleIntegrationApi(request,env,{api,clock=()=>Math.floor(Date.now()/1000)}={}){
  try{
    checkRequest(request,env,{integration:true});if(!env.GROUPS)fail('unavailable',503);
    const auth=request.headers.get('Authorization')||'';if(!auth.startsWith('Bearer '))fail('unauthorized',401);
    const token=auth.slice(7),body=await readToolsBody(request,8192);objectKeys(body,['operation','input','requestId']);
    const services=createToolServices({db:env.DB,api:api||createTelegram(env.BOT_TOKEN),clock});
    const authorized=await services.integration.authenticate(token,body.operation,{checkRole:false});
    // The bound group is resolved from the credential, never a client-supplied ID.
    const response=await env.GROUPS.get(env.GROUPS.idFromName(authorized.chat_id)).fetch('https://group.internal/integration',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,operation:body.operation,input:body.input??{},requestId:body.requestId})});
    const data=await response.json();if(!response.ok||data?.ok===false)throw {code:data.error,status:response.status};return result({ok:true,data});
  }catch(error){return failure(error);}
}
