import { applySchema, createStore } from './store.js';
import { createTelegram, secureEqual, webhookSecret } from './telegram.js';
import { renderHome, renderSetup, renderPrivacy } from './pages.js';

const SECURITY_HEADERS={
  'X-Content-Type-Options':'nosniff',
  'Referrer-Policy':'no-referrer',
  'X-Frame-Options':'DENY',
  'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://sautilink.com data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  'Cache-Control':'no-store'
};
function response(body,status=200,type='application/json; charset=utf-8') {
  return new Response(type.startsWith('application/json') ? JSON.stringify(body) : body,{status,headers:{...SECURITY_HEADERS,'Content-Type':type}});
}
const html=body=>response(body,200,'text/html; charset=utf-8');
const error=(message,status)=>response({ok:false,message},status);
const validToken=value=>/^\d+:[A-Za-z0-9_-]{20,}$/.test(value || '');

async function publicState(env) {
  try {
    const store=createStore(env.DB);
    return {ready:validToken(env.BOT_TOKEN) && Boolean(env.GROUPS) && await store.setting('ready')==='1',username:await store.setting('bot_username')};
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

async function setup(request,env) {
  if(!await authorize(request,env)) return error('SETUP_KEY si sahihi au haijawekwa kama Secret yenye angalau herufi 32.',401);
  const origin=request.headers.get('Origin');
  if(origin && origin!==baseUrl(env)) return error('Origin hairuhusiwi.',403);
  if(!env.DB) return error('Ongeza D1 database binding yenye jina DB kwenye Worker.',503);
  if(!env.GROUPS) return error('Deploy repo ili kuunda GROUPS Durable Object binding.',503);
  if(!validToken(env.BOT_TOKEN)) return error('Weka token ya BotFather kwenye Secret inayoitwa BOT_TOKEN.',503);
  const api=createTelegram(env.BOT_TOKEN);
  if(request.method==='GET') {
    const state=await publicState(env);
    const webhook=await api.call('getWebhookInfo');
    return response({ok:true,...state,database:'connected',webhook_url:webhook.url,
      status:{pending_updates:webhook.pending_update_count,last_error:webhook.last_error_message || null,allowed_updates:webhook.allowed_updates || []}});
  }
  const identity=await api.call('getMe');
  if(!identity.is_bot || !identity.username || identity.username.toLowerCase()!==String(env.BOT_USERNAME || 'sautilinkpilotbot').toLowerCase()) {
    return error('BOT_TOKEN ni ya bot tofauti na BOT_USERNAME. Thibitisha token ya @sautilinkpilotbot.',409);
  }
  await applySchema(env.DB);
  const store=createStore(env.DB);
  const firstActivation=await store.setting('ready_since');
  const shared=[
    {command:'start',description:'Anza kutumia SautiLink Pilot'},
    {command:'help',description:'Msaada wa kutumia bot'},
    {command:'rules',description:'Sheria na links zinazoruhusiwa'}
  ];
  await api.call('setMyCommands',{commands:shared});
  await api.call('setMyCommands',{scope:{type:'all_chat_administrators'},commands:[...shared,
    {command:'status',description:'Hali ya moderation na ruhusa'},
    {command:'strikes',description:'Angalia makosa: reply au user ID'},
    {command:'forgive',description:'Safisha makosa: reply au user ID'},
    {command:'unban',description:'Ondoa ban bila kufuta historia'},
    {command:'pause',description:'Sitisha moderation ya group hili'},
    {command:'resume',description:'Washa moderation ya group hili'}
  ]});
  const url=`${baseUrl(env)}/telegram/webhook`;
  await api.call('setWebhook',{
    url,secret_token:await webhookSecret(env.BOT_TOKEN),max_connections:40,
    allowed_updates:['message','edited_message','my_chat_member','chat_member'],drop_pending_updates:false
  });
  await store.settings({ready:'1',bot_id:identity.id,bot_username:identity.username,ready_since:firstActivation || Math.floor(Date.now()/1000),schema_version:'1'});
  return response({ok:true,ready:true,username:identity.username,webhook_url:url,database:'ready',status:'SautiLink Pilot imeunganishwa na Telegram.'});
}

export async function handleFetch(request,env) {
  try {
    const url=new URL(request.url),path=url.pathname;
    if(request.method==='GET' && path==='/') return html(renderHome(await publicState(env)));
    if(request.method==='GET' && path==='/privacy') return html(renderPrivacy());
    if(request.method==='GET' && path==='/setup') return html(renderSetup());
    if(request.method==='GET' && path==='/health') {
      const {ready}=await publicState(env); return response({ok:ready,service:'SautiLink Pilot'},ready ? 200 : 503);
    }
    if((path==='/api/setup' && request.method==='POST') || (path==='/api/setup/status' && request.method==='GET')) return await setup(request,env);
    if(path!=='/telegram/webhook') return error('Haijapatikana.',404);
    if(request.method!=='POST') return error('Tumia POST.',405);
    if(!validToken(env.BOT_TOKEN) || !env.DB || !env.GROUPS) return error('Bot bado haijaunganishwa.',503);
    if(!await secureEqual(request.headers.get('X-Telegram-Bot-Api-Secret-Token'),await webhookSecret(env.BOT_TOKEN))) return error('Unauthorized',401);
    if(Number(request.headers.get('Content-Length') || 0)>1048576) return error('Ombi ni kubwa sana.',413);
    const body=await request.text();
    if(new TextEncoder().encode(body).byteLength>1048576) return error('Ombi ni kubwa sana.',413);
    let update; try { update=JSON.parse(body); } catch { return error('JSON si sahihi.',400); }
    if(!Number.isSafeInteger(update?.update_id)) return error('Update si sahihi.',400);
    if(!(await publicState(env)).ready) return error('Kamilisha setup kwanza.',503);
    const event=update.message || update.edited_message || update.my_chat_member || update.chat_member;
    if(!event || !Number.isSafeInteger(event.chat?.id)) return response({ok:true});
    // Same group -> same object. Its queue protects strikes across network awaits.
    const id=env.GROUPS.idFromName(String(event.chat.id));
    const result=await env.GROUPS.get(id).fetch('https://internal/telegram',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(update)
    });
    return response({ok:result.ok},result.ok ? 200 : 503);
  } catch(errorValue) {
    // Do not log an error stack or outbound URL (Telegram URLs contain BOT_TOKEN).
    console.error('pilot_request_failed',{type:errorValue?.name || 'Error'});
    return error('Hatua haijakamilika. Kagua binding/Secrets na ujaribu tena.',503);
  }
}
