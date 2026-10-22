import { DurableObject } from 'cloudflare:workers';
import { handleFetch } from './handler.js';
import { createModerator } from './moderator.js';
import { createTelegram } from './telegram.js';
import { createStore } from './store.js';
import { createControlStore } from './control-store.js';
import { createGuardrailStore } from './guardrail-store.js';
import { runMonitoring } from './monitoring.js';
import { createOwnerAuth } from './owner-auth.js';
import { createBroadcastStore } from './broadcast-store.js';
import { createBroadcastService } from './broadcast-service.js';
import { routeBroadcast } from './broadcast-router.js';
import { createBotIdentity } from './bot-identity.js';
import { createRequestTiming, instrumentTelegram } from './request-timing.js';

const BROADCAST_COORDINATOR='__pilot_broadcasts__';
async function dispatch(env,name,path,payload) {
  const stub=env.GROUPS.get(env.GROUPS.idFromName(name));
  const response=await stub.fetch(new Request(`https://group.internal${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}));
  const result=await response.json();
  if(!response.ok) {const error=new Error(result.error || 'unavailable');error.code=result.error;error.status=response.status;throw error;}
  return result;
}

export class GroupCoordinator extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.tail=Promise.resolve();
    this.currentTiming=null;
    this.api=instrumentTelegram(createTelegram(env.BOT_TOKEN),()=>this.currentTiming);
    const getIdentity=createBotIdentity({db:env.DB,api:this.api,token:env.BOT_TOKEN,expectedUsername:env.BOT_USERNAME || 'sautilinkpilotbot'});
    this.owner=createOwnerAuth({db:env.DB});
    this.broadcasts=createBroadcastService({db:env.DB,api:this.api,owner:this.owner});
    this.moderator=createModerator({db:env.DB,api:this.api,owner:this.owner,getIdentity,
      appUrl:`${env.PUBLIC_BASE_URL || 'https://pilot.sautilink.com'}/app`,
      dispatchControl:payload=>dispatch(env,String(payload.chatId),'/control',payload),
      dispatchBroadcast:payload=>dispatch(env,BROADCAST_COORDINATOR,'/broadcast',payload),
    });
  }
  queued(route,work) {
    const timing=createRequestTiming(route);
    const task=this.tail.then(async()=>{
      timing.start(); this.currentTiming=timing;
      let outcome='error';
      try {
        const result=await work(); outcome=result?.retry ? 'retry' : 'ok'; return result;
      } finally {
        this.currentTiming=null; timing.finish(outcome);
      }
    });
    this.tail=task.catch(()=>{});
    return task;
  }
  async scheduleBroadcasts() {
    const next=await this.broadcasts.nextRunAt();
    if(next==null) {
      if(await this.ctx.storage.getAlarm()!=null) await this.ctx.storage.deleteAlarm();
      return;
    }
    const due=Math.max(Date.now()+1000,next*1000);
    const current=await this.ctx.storage.getAlarm();
    if(current==null || due<current) await this.ctx.storage.setAlarm(due);
  }
  async alarm() {
    // Alarm retries and incoming commands share the same serial decision stream.
    return this.queued('broadcast_alarm',async()=>{
      // One target per alarm bounds D1/Telegram subrequests on the free plan.
      try {await this.broadcasts.drain({limit:1});}
      finally {await this.scheduleBroadcasts();}
    });
  }
  async fetch(request) {
    if(request.method!=='POST') return Response.json({ok:false,error:'method_not_allowed'},{status:405});
    const update=await request.json();
    const path=new URL(request.url).pathname;
    const isControl=path==='/control',isBroadcast=path==='/broadcast',isWake=path==='/broadcast/wake';
    // A Durable Object is single-threaded but awaits interleave; the explicit queue
    // keeps Telegram actions and D1 writes for a chat in one serial decision stream.
    const callbackAcknowledgementStarted=path==='/telegram' && request.headers.get('X-Pilot-Callback-Acknowledgement')==='started';
    const route=isControl ? 'control' : isBroadcast ? 'broadcast' : isWake ? 'broadcast_wake' : 'telegram';
    const task=this.queued(route,async()=>{
      if(isWake) {await this.scheduleBroadcasts();return {ok:true};}
      if(isBroadcast) {
        const result=await routeBroadcast({owner:this.owner,service:this.broadcasts,payload:update});
        await this.scheduleBroadcasts();
        return result;
      }
      return isControl ? this.moderator.controlMutation(update) : this.moderator.handle(update,{callbackAcknowledgementStarted});
    });
    try {
      const result=await task;
      return Response.json(result,{status:result.retry ? 503 : 200});
    }
    catch(error) {
      if(isControl || isBroadcast || isWake) {
        const code=typeof error.code==='string' && /^[A-Za-z_]{2,64}$/.test(error.code) ? error.code : 'unavailable';
        return Response.json({ok:false,error:code},{status:Number.isInteger(error.status) && error.status>=400 && error.status<=599?error.status:503});
      }
      return Response.json({status:'retry'}, {status:503});
    }
  }
}

export default {
  fetch:handleFetch,
  async scheduled(event,env,ctx) {
    if(!env.DB) return;
    if(event.cron==='17 2 * * *') {
      ctx.waitUntil((async()=>{
        const now=Math.floor(Date.now()/1000);
        await createStore(env.DB).cleanup(now);
        await createControlStore(env.DB).cleanup(now);
        await createGuardrailStore(env.DB).cleanup(now);
        await createOwnerAuth({db:env.DB}).cleanup(now);
        await createBroadcastStore(env.DB).cleanup(now);
      })().catch(()=>{console.error('pilot_retention_cleanup_failed');}));
    } else if(env.BOT_TOKEN) {
      ctx.waitUntil(runMonitoring({db:env.DB,api:createTelegram(env.BOT_TOKEN)}).catch(()=>{console.error('pilot_monitoring_failed');}));
      // Recovery after an outage: wake the global queue without sending from cron.
      if(env.GROUPS) ctx.waitUntil((async()=>{
        if(await createStore(env.DB).setting('ready')==='1') await dispatch(env,BROADCAST_COORDINATOR,'/broadcast/wake',{});
      })().catch(()=>{console.error('pilot_broadcast_wake_failed');}));
    }
  }
};
