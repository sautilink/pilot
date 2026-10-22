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
import { createRequestTiming, instrumentTelegram, instrumentDatabase } from './request-timing.js';
import { createToolServices } from './tools-api.js';
import { createToolsStore, validChat } from './tools-store.js';
import { createSupportStore } from './support-store.js';
import { createPerformanceService } from './performance-service.js';

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
    this.env=env;
    this.tail=Promise.resolve();
    this.pendingWork=0;
    this.currentTiming=null;
    this.api=instrumentTelegram(createTelegram(env.BOT_TOKEN),()=>this.currentTiming);
    const db=instrumentDatabase(env.DB,()=>this.currentTiming);
    const getIdentity=createBotIdentity({db,api:this.api,token:env.BOT_TOKEN,expectedUsername:env.BOT_USERNAME || 'sautilinkpilotbot'});
    this.owner=createOwnerAuth({db});
    this.broadcasts=createBroadcastService({db,api:this.api,owner:this.owner});
    this.tools=createToolServices({db,api:this.api,owner:this.owner});
    this.performance=createPerformanceService({db:env.DB,api:createTelegram(env.BOT_TOKEN),owner:this.owner});
    this.moderator=createModerator({db,api:this.api,owner:this.owner,getIdentity,tools:this.tools,
      appUrl:`${env.PUBLIC_BASE_URL || 'https://pilot.sautilink.com'}/app`,
      dispatchControl:payload=>dispatch(env,String(payload.chatId),'/control',payload),
      dispatchBroadcast:payload=>dispatch(env,BROADCAST_COORDINATOR,'/broadcast',payload),
    });
  }
  queued(route,work) {
    this.pendingWork++;
    const timing=createRequestTiming(route,{observe:(record,selection)=>{
      if(selection.sampled||record.outcome!=='ok'||record.queue_ms>=250||record.handling_ms>=1000) {
        this.ctx.waitUntil(this.performance.record(record,selection).catch(()=>{console.warn('pilot_measurement_unavailable');}));
      }
    }});
    const task=this.tail.then(async()=>{
      timing.start(); this.currentTiming=timing;
      let outcome='error';
      try {
        const result=await work(); outcome=result?.retry ? 'retry' : 'ok'; return result;
      } finally {
        this.currentTiming=null; this.pendingWork--; timing.finish(outcome);
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
      const chat=await this.ctx.storage.get('pilot_tools_chat');
      if(chat) {
        try {
          // Restore due temporary permissions even when interactive work is busy.
          await this.tools.governance.drain(chat);
          // Optional sends yield before each job if an interactive request arrives.
          if(this.pendingWork<=1)await this.tools.operations.drain(chat,{limit:1,shouldYield:()=>this.pendingWork>1});
          if(this.pendingWork<=1)await this.tools.community.processSupportDeliveries(chat,{shouldYield:()=>this.pendingWork>1});
        }
        finally {await this.scheduleTools(chat,this.pendingWork>1?30000:3000);}
        return;
      }
      // One target per alarm bounds D1/Telegram subrequests on the free plan.
      try {await this.broadcasts.drain({limit:1});}
      finally {await this.scheduleBroadcasts();}
    });
  }
  async scheduleTools(chatId,minDelay=1000) {
    const chat=validChat(chatId);
    if(this.toolsChat!==chat) {await this.ctx.storage.put('pilot_tools_chat',chat);this.toolsChat=chat;}
    const nextTimes=await Promise.all([this.tools.operations.nextRunAt(chat),this.tools.governance.nextRunAt(chat),this.tools.community.nextSupportDue(chat)]);
    const now=Date.now();
    // Back off optional work, while preserving a future restoration deadline.
    // An already-overdue restoration keeps the retry backoff after a failure.
    const times=nextTimes.flatMap((value,index)=>Number.isFinite(value)?[Math.max(now+(index===1&&value*1000>now?1000:minDelay),value*1000)]:[]);
    if(!times.length){if(await this.ctx.storage.getAlarm()!=null)await this.ctx.storage.deleteAlarm();return;}
    const due=Math.min(...times),current=await this.ctx.storage.getAlarm();
    if(current==null||due<current)await this.ctx.storage.setAlarm(due);
  }
  async fetch(request) {
    if(request.method!=='POST') return Response.json({ok:false,error:'method_not_allowed'},{status:405});
    const update=await request.json();
    const path=new URL(request.url).pathname;
    const isControl=path==='/control',isBroadcast=path==='/broadcast',isWake=path==='/broadcast/wake';
    const isTools=path==='/tools',isToolsWake=path==='/tools/wake',isIntegration=path==='/integration';
    if(!['/telegram','/control','/broadcast','/broadcast/wake','/tools','/tools/wake','/integration'].includes(path))return Response.json({ok:false,error:'not_found'},{status:404});
    // A Durable Object is single-threaded but awaits interleave; the explicit queue
    // keeps Telegram actions and D1 writes for a chat in one serial decision stream.
    const callbackAcknowledgementStarted=path==='/telegram' && request.headers.get('X-Pilot-Callback-Acknowledgement')==='started';
    const route=isTools?'tools':isToolsWake?'tools_wake':isIntegration?'integration':isControl ? 'control' : isBroadcast ? 'broadcast' : isWake ? 'broadcast_wake' : 'telegram';
    const task=this.queued(route,async()=>{
      if(isToolsWake){await this.scheduleTools(update.chatId);return {ok:true};}
      if(isTools){try{return await this.tools.perform(update);}finally{if(update.chatId&&!['feedback_create','feedback_resolve'].includes(update.action))await this.scheduleTools(update.chatId);}}
      if(isIntegration)return this.tools.integration.perform(update);
      if(isWake) {await this.scheduleBroadcasts();return {ok:true};}
      if(isBroadcast) {
        const result=await routeBroadcast({owner:this.owner,service:this.broadcasts,payload:update});
        await this.scheduleBroadcasts();
        return result;
      }
      const result=await (isControl ? this.moderator.controlMutation(update) : this.moderator.handle(update,{callbackAcknowledgementStarted}));
      if(!isControl&&update.message?.chat?.type==='private') {
        // Evidence comes only from a validated Telegram update. Persist it after
        // the reply path; no ordinary group message pays for private-tool setup.
        this.ctx.waitUntil(createSupportStore(this.env.DB).rememberPrivateContact(update.message).catch(()=>{console.warn('pilot_private_contact_unavailable');}));
      }
      return result;
    });
    try {
      const result=await task;
      return Response.json(result,{status:result.retry ? 503 : 200});
    }
    catch(error) {
      if(isControl || isBroadcast || isWake || isTools || isToolsWake || isIntegration) {
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
        await createToolsStore(env.DB).cleanup(now);
        await createPerformanceService({db:env.DB}).cleanup(now);
        if(env.BOT_TOKEN){const tools=createToolServices({db:env.DB,api:createTelegram(env.BOT_TOKEN)});await tools.community.cleanup(now);await tools.operations.cleanup(now);}
      })().catch(()=>{console.error('pilot_retention_cleanup_failed');}));
    } else if(env.BOT_TOKEN) {
      ctx.waitUntil(runMonitoring({db:env.DB,api:createTelegram(env.BOT_TOKEN)}).catch(()=>{console.error('pilot_monitoring_failed');}));
      ctx.waitUntil(createPerformanceService({db:env.DB,api:createTelegram(env.BOT_TOKEN)}).monitor().catch(()=>{console.warn('pilot_performance_monitor_unavailable');}));
      // Recovery after an outage: wake the global queue without sending from cron.
      if(env.GROUPS) ctx.waitUntil((async()=>{
        if(await createStore(env.DB).setting('ready')==='1') {
          await dispatch(env,BROADCAST_COORDINATOR,'/broadcast/wake',{}).catch(()=>{console.warn('pilot_broadcast_wake_unavailable');});
          const tools=createToolServices({db:env.DB,api:createTelegram(env.BOT_TOKEN)});
          const groups=new Set([...(await tools.operations.nextDueGroups({limit:20})),...(await tools.governance.nextDueGroups({limit:20})),...(await tools.community.dueSupportChats(20))]);
          for(const chatId of groups)await dispatch(env,String(chatId),'/tools/wake',{chatId}).catch(()=>{console.warn('pilot_tools_wake_unavailable');});
        }
      })().catch(()=>{console.error('pilot_broadcast_wake_failed');}));
    }
  }
};
