import { applySchema, createStore } from './store.js';
import { createTelegram, secureEqual, webhookSecret } from './telegram.js';
import { renderHome, renderSetup, renderPrivacy } from './pages.js';
import { isExpectedBot, readExperienceState, syncExperience } from './experience-sync.js';
import { isMenuCallback } from './commands.js';
import {renderDashboard} from './dashboard.js';
import {handleDashboardApi} from './dashboard-api.js';
import {createGuardrailStore} from './guardrail-store.js';
import {operationalHealth} from './monitoring.js';
import {createOwnerAuth} from './owner-auth.js';
import {iconAssetResponse} from './public-icons.js';
import {seoDiscoveryResponse} from './seo-discovery.js';
import {renderToolsPage} from './tools-page.js';
import {handleToolsApi,handleIntegrationApi} from './tools-api.js';
import {createCommunityService} from './community-service.js';
import {renderCommunityHub} from './community-pages.js';
import {renderReleasePage} from './release-pages.js';

const SECURITY_HEADERS={
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'X-Robots-Tag':'noindex, nofollow',
  'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://sautilink.com data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Cache-Control':'no-store'
};
function response(body,status=200,type='application/json; charset=utf-8',extraHeaders={}) {
  return new Response(type.startsWith('application/json') ? JSON.stringify(body) : body,{status,headers:{...SECURITY_HEADERS,'Content-Type':type,...extraHeaders}});
}
const html=(body,{head=false,indexable=true}={})=>response(head ? null : body,200,'text/html; charset=utf-8',{'X-Robots-Tag':indexable ? 'index, follow' : 'noindex, nofollow'});
const appHtml=(body,{head=false}={})=>{
  const headers={...SECURITY_HEADERS,'Content-Type':'text/html; charset=utf-8'};
  delete headers['X-Frame-Options'];
  headers['Content-Security-Policy']="default-src 'self'; script-src 'self' 'unsafe-inline' https://telegram.org; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://sautilink.com; connect-src 'self'; frame-ancestors https://web.telegram.org https://*.telegram.org; base-uri 'none'; form-action 'self'";
  return new Response(head ? null : body,{headers});
};
const error=(message,status)=>response({ok:false,message},status);
const validToken=value=>/^\d+:[A-Za-z0-9_-]{20,}$/.test(value || '');
const SETUP_MESSAGES={
  sw:{
    authorization:'SETUP_KEY si sahihi au haijawekwa kama Secret yenye angalau herufi 32.',
    origin:'Origin hairuhusiwi.',database:'Ongeza D1 database binding yenye jina DB kwenye Worker.',
    groups:'Deploy repo ili kuunda GROUPS Durable Object binding.',
    token:'Weka token ya BotFather kwenye Secret inayoitwa BOT_TOKEN.',
    identity:'BOT_TOKEN ni ya bot tofauti na BOT_USERNAME. Thibitisha token ya @sautilinkpilotbot.',
    incomplete:'Usanidi wa Telegram haujakamilika. Jaribu tena baada ya muda mfupi.',
    connected:'SautiLink Pilot imeunganishwa na Telegram.',
    failed:'Hatua haijakamilika. Kagua binding/Secrets na ujaribu tena.',
  },
  en:{
    authorization:'SETUP_KEY is missing or incorrect. Configure it as a Secret with at least 32 characters.',
    origin:'This origin is not allowed.',database:'Add a D1 database binding named DB to the Worker.',
    groups:'Deploy the repository to create the GROUPS Durable Object binding.',
    token:'Store the BotFather token in a Secret named BOT_TOKEN.',
    identity:'BOT_TOKEN belongs to a different bot than BOT_USERNAME. Verify the token for @sautilinkpilotbot.',
    incomplete:'Telegram setup is incomplete. Try again shortly.',
    connected:'SautiLink Pilot is connected to Telegram.',
    failed:'The operation could not be completed. Check the bindings and Secrets, then try again.',
  },
};

async function publicState(env) {
  try {
    const state=await readExperienceState(env.DB);
    return {ready:validToken(env.BOT_TOKEN) && Boolean(env.GROUPS) && state.ready,username:state.username};
  } catch { return {ready:false,username:env.BOT_USERNAME || null}; }
}

async function authorize(request,env) {
  if(!env.SETUP_KEY || env.SETUP_KEY.length<32) return false;
  const header=request.headers.get('Authorization');
  return header?.startsWith('Bearer ') && secureEqual(header.slice(7),env.SETUP_KEY);
}

function baseUrl(env) {
  const url=new URL(env.PUBLIC_BASE_URL || 'https://pilot.sautilink.com');
  if(url.protocol!=='https:' || url.username || url.password || url.port || url.pathname!=='/' || url.search || url.hash) throw new Error('PUBLIC_BASE_URL lazima iwe HTTPS origin halali.');
  return url.origin;
}

async function setup(request,env,lang='en') {
  const messages=SETUP_MESSAGES[lang==='sw' ? 'sw' : 'en'];
  if(!await authorize(request,env)) return error(messages.authorization,401);
  const origin=request.headers.get('Origin');
  if(origin && origin!==baseUrl(env)) return error(messages.origin,403);
  if(!env.DB) return error(messages.database,503);
  if(!env.GROUPS) return error(messages.groups,503);
  if(!validToken(env.BOT_TOKEN)) return error(messages.token,503);
  const api=createTelegram(env.BOT_TOKEN);
  if(request.method==='GET') {
    const state=await publicState(env);
    const webhook=await api.call('getWebhookInfo');
    return response({ok:true,...state,database:'connected',webhook_url:webhook.url,
      status:{pending_updates:webhook.pending_update_count,last_error:webhook.last_error_message || null,allowed_updates:webhook.allowed_updates || []},operations:state.ready ? await operationalHealth(env.DB) : null,
      owner:state.ready ? await createOwnerAuth({db:env.DB}).status() : {bound:false,expectedUsername:'drcharlestz'}});
  }
  const identity=await api.call('getMe');
  if(!isExpectedBot(identity,env.BOT_USERNAME || 'sautilinkpilotbot')) {
    return error(messages.identity,409);
  }
  await applySchema(env.DB);
  const store=createStore(env.DB);
  const firstActivation=await store.setting('ready_since');
  const url=`${baseUrl(env)}/telegram/webhook`;
  const synced=await syncExperience({
    db:env.DB,token:env.BOT_TOKEN,api,webhookUrl:url,
    expectedUsername:env.BOT_USERNAME || 'sautilinkpilotbot',force:true,
  });
  if(synced.status!=='synced') return error(messages.incomplete,503);
  await store.settings({ready:'1',bot_id:identity.id,bot_username:identity.username,ready_since:firstActivation || Math.floor(Date.now()/1000),schema_version:'1'});
  return response({ok:true,ready:true,username:identity.username,webhook_url:url,database:'ready',status:messages.connected});
}

async function pairOwner(request,env,lang) {
  const messages=SETUP_MESSAGES[lang==='sw' ? 'sw' : 'en'];
  if(!await authorize(request,env)) return error(messages.authorization,401);
  const origin=request.headers.get('Origin');
  if(origin && origin!==baseUrl(env)) return error(messages.origin,403);
  if(!(await publicState(env)).ready) return response({ok:false,error:'owner_setup_not_ready'},409);
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return response({ok:false,error:'owner_request_invalid'},400);
  if(Number(request.headers.get('Content-Length') || 0)>1024) return response({ok:false,error:'owner_request_invalid'},413);
  const raw=await request.text();
  if(new TextEncoder().encode(raw).byteLength>1024) return response({ok:false,error:'owner_request_invalid'},413);
  let body; try {body=JSON.parse(raw);} catch {return response({ok:false,error:'owner_request_invalid'},400);}
  if(body?.action!=='pair' || Object.keys(body).length!==1) return response({ok:false,error:'owner_request_invalid'},400);
  const owner=createOwnerAuth({db:env.DB});
  try {
    const pairing=await owner.beginPairing();
    return response({ok:true,owner:await owner.status(),pairing});
  } catch(cause) {
    if(['owner_bound','owner_pair_rate_limited'].includes(cause?.code)) return response({ok:false,error:cause.code},cause.status);
    throw cause;
  }
}

export async function handleFetch(request,env,ctx) {
  let lang='en';
  try {
    const discovery=seoDiscoveryResponse(request);
    if(discovery) return discovery;
    const iconAsset=iconAssetResponse(request);
    if(iconAsset) return iconAsset;
    const url=new URL(request.url),path=url.pathname;
    const readPage=request.method==='GET' || request.method==='HEAD';
    const head=request.method==='HEAD';
    lang=url.searchParams.get('lang')==='sw' ? 'sw' : 'en';
    if(readPage && path==='/') return html(renderHome({...await publicState(env),lang}),{head});
    if(readPage && path==='/privacy') return html(renderPrivacy(lang),{head});
    if(readPage && path==='/app') return appHtml(renderDashboard({lang}),{head});
    if(readPage && path==='/tools') return appHtml(renderToolsPage({lang}),{head});
    if(readPage && ['/updates','/roadmap','/developers'].includes(path)) return html(renderReleasePage(path,{lang}),{head});
    if(readPage && /^\/community\/[a-z0-9][a-z0-9-]{2,46}[a-z0-9]$/.test(path)) {
      if(!env.DB)return error('Haijapatikana.',404);
      const hub=await createCommunityService({db:env.DB}).getPublicHub(path.slice('/community/'.length),{language:lang});
      return hub?html(renderCommunityHub(hub,{lang}),{head,indexable:hub.visibility==='public'}):error('Haijapatikana.',404);
    }
    if(path==='/api/tools')return handleToolsApi(request,env);
    if(path==='/api/integrations')return handleIntegrationApi(request,env);
    if(path==='/api/pilot') {
      const result=await handleDashboardApi(request,env);
      result.headers.set('X-Robots-Tag','noindex, nofollow');
      return result;
    }
    if(readPage && path==='/setup') return html(renderSetup(lang),{head,indexable:false});
    if(request.method==='GET' && path==='/health') {
      const {ready}=await publicState(env); return response({ok:ready,service:'SautiLink Pilot'},ready ? 200 : 503);
    }
    if((path==='/api/setup' && request.method==='POST') || (path==='/api/setup/status' && request.method==='GET')) return await setup(request,env,lang);
    if(path==='/api/setup/owner') return request.method==='POST' ? await pairOwner(request,env,lang) : error('Tumia POST.',405);
    if(path!=='/telegram/webhook') return error('Haijapatikana.',404);
    if(request.method!=='POST') return error('Tumia POST.',405);
    if(!validToken(env.BOT_TOKEN) || !env.DB || !env.GROUPS) return error('Bot bado haijaunganishwa.',503);
    if(!await secureEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token'),await webhookSecret(env.BOT_TOKEN))) return error('Unauthorized',401);
    if(Number(request.headers.get('Content-Length') || 0)>1048576) return error('Ombi ni kubwa sana.',413);
    const body=await request.text();
    if(new TextEncoder().encode(body).byteLength>1048576) return error('Ombi ni kubwa sana.',413);
    let update; try { update=JSON.parse(body); } catch { return error('JSON si sahihi.',400); }
    if(!Number.isSafeInteger(update?.update_id)) return error('Update si sahihi.',400);
    const state=await readExperienceState(env.DB);
    if(!state.ready) return error('Kamilisha setup kwanza.',503);
    const event=update.message || update.edited_message || update.my_chat_member || update.chat_member || update.chat_join_request;
    const callback=update.callback_query;
    const accessibleCallbackChat=callback?.message?.date!==0 && Number.isSafeInteger(callback?.message?.chat?.id);
    const callbackChat=accessibleCallbackChat ? callback.message.chat.id : callback?.from?.id;
    let chatId=callback ? callbackChat : event?.chat?.id;
    const joinCallback=/^pilot:join:([a-f0-9]{24}):\d{1,3}$/.exec(String(callback?.data || ''));
    if(joinCallback && Number.isSafeInteger(callback?.from?.id)) {
      const guards=createGuardrailStore(env.DB);
      await guards.ensure();
      const join=await guards.first('SELECT chat_id,user_id FROM pilot_join_requests WHERE id=?',joinCallback[1]);
      if(join && join.user_id===String(callback.from.id)) chatId=Number(join.chat_id);
    }
    if(!Number.isSafeInteger(chatId) || chatId===0 || (callback && !accessibleCallbackChat && chatId<0)) return response({ok:true});
    let callbackAcknowledgementStarted=false;
    if(typeof ctx?.waitUntil==='function' && isMenuCallback(callback) && Number.isSafeInteger(callback.from?.id) && callback.from.id>0) {
      // Empty acknowledgements disclose no data and grant no authority. Starting
      // one here lets the spinner stop while the chat coordinator does its work.
      // The internal header is created here, never copied from an incoming one.
      const acknowledgement=createTelegram(env.BOT_TOKEN).call('answerCallbackQuery',{callback_query_id:callback.id}).catch(()=>{});
      try {ctx.waitUntil(acknowledgement);} catch {await acknowledgement;}
      callbackAcknowledgementStarted=true;
    }
    // Upgrade metadata only on authenticated, valid updates for an already-ready
    // installation. Public GETs and failed authentication cannot mutate Telegram.
    // Await callback subscription first; profile/menu updates finish in waitUntil.
    if(typeof ctx?.waitUntil==='function') {
      try {
        await syncExperience({
          db:env.DB,token:env.BOT_TOKEN,webhookUrl:`${baseUrl(env)}/telegram/webhook`,
          expectedUsername:env.BOT_USERNAME || 'sautilinkpilotbot',
          state,
          waitUntil:promise=>ctx.waitUntil(promise),
        });
      } catch {
        // Metadata availability must not block moderation of this update.
        console.warn('pilot_experience_sync_failed',{stage:'webhook_trigger',kind:'sync_unavailable'});
      }
    }
    // Same group -> same object. Its queue protects strikes across network awaits.
    const id=env.GROUPS.idFromName(String(chatId));
    const result=await env.GROUPS.get(id).fetch('https://internal/telegram',{
      method:'POST',headers:{'Content-Type':'application/json',...(callbackAcknowledgementStarted?{'X-Pilot-Callback-Acknowledgement':'started'}:{})},body:JSON.stringify(update)
    });
    return response({ok:result.ok},result.ok ? 200 : 503);
  } catch(errorValue) {
    // Do not log an error stack or outbound URL (Telegram URLs contain BOT_TOKEN).
    console.error('pilot_request_failed',{type:errorValue?.name || 'Error'});
    return error(SETUP_MESSAGES[lang].failed,503);
  }
}
