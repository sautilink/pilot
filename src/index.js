import { DurableObject } from 'cloudflare:workers';
import { handleFetch } from './handler.js';
import { createModerator } from './moderator.js';
import { createTelegram } from './telegram.js';
import { createStore } from './store.js';

export class GroupCoordinator extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.tail=Promise.resolve();
    this.moderator=createModerator({db:env.DB,api:createTelegram(env.BOT_TOKEN)});
  }
  async fetch(request) {
    const update=await request.json();
    // A Durable Object is single-threaded but awaits interleave; the explicit queue
    // keeps Telegram actions and D1 writes for a chat in one serial decision stream.
    const task=this.tail.then(()=>this.moderator.handle(update));
    this.tail=task.catch(()=>{});
    try {
      const result=await task;
      return Response.json(result,{status:result.retry ? 503 : 200});
    }
    catch { return Response.json({status:'retry'}, {status:503}); }
  }
}

export default {
  fetch:handleFetch,
  async scheduled(_event,env,ctx) {
    if(!env.DB) return;
    ctx.waitUntil(createStore(env.DB).cleanup(Math.floor(Date.now()/1000)).catch(()=>{
      console.error('pilot_retention_cleanup_failed');
    }));
  }
};
