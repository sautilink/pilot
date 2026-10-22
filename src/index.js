import { DurableObject } from 'cloudflare:workers';
import { handleFetch } from './handler.js';
import { createModerator } from './moderator.js';
import { createTelegram } from './telegram.js';
import { createStore } from './store.js';
import { createControlStore } from './control-store.js';
import { createGuardrailStore } from './guardrail-store.js';
import { runMonitoring } from './monitoring.js';

export class GroupCoordinator extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.tail=Promise.resolve();
    this.moderator=createModerator({db:env.DB,api:createTelegram(env.BOT_TOKEN),appUrl:`${env.PUBLIC_BASE_URL || 'https://pilot.sautilink.com'}/app`,dispatchControl:async payload=>{
      const stub=env.GROUPS.get(env.GROUPS.idFromName(String(payload.chatId)));
      const response=await stub.fetch(new Request('https://group.internal/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}));
      const result=await response.json();
      if(!response.ok) {const error=new Error(result.error || 'unavailable');error.code=result.error;error.status=response.status;throw error;}
      return result;
    }});
  }
  async fetch(request) {
    if(request.method!=='POST') return Response.json({ok:false,error:'method_not_allowed'},{status:405});
    const update=await request.json();
    const isControl=new URL(request.url).pathname==='/control';
    // A Durable Object is single-threaded but awaits interleave; the explicit queue
    // keeps Telegram actions and D1 writes for a chat in one serial decision stream.
    const task=this.tail.then(()=>isControl ? this.moderator.controlMutation(update) : this.moderator.handle(update));
    this.tail=task.catch(()=>{});
    try {
      const result=await task;
      return Response.json(result,{status:result.retry ? 503 : 200});
    }
    catch(error) {
      if(isControl) {
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
      })().catch(()=>{console.error('pilot_retention_cleanup_failed');}));
    } else if(env.BOT_TOKEN) ctx.waitUntil(runMonitoring({db:env.DB,api:createTelegram(env.BOT_TOKEN)}).catch(()=>{console.error('pilot_monitoring_failed');}));
  }
};
