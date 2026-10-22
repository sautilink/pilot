import { createToolsStore, ToolsError, fail, digest, json, isAdmin, objectKeys, textValue } from './tools-store.js';

export function createIntegrationService({db,api,community,operations,clock=()=>Math.floor(Date.now()/1000)}) {
  const store=createToolsStore(db);
  async function authenticate(token,operation,{checkRole=true}={}) {
    const match=/^slp_([a-f0-9]{32})\.([a-f0-9]{64})$/.exec(String(token));if(!match)fail('unauthorized',401);
    await store.ensure();const row=await store.first('SELECT * FROM pilot_integration_tokens WHERE id=?',match[1]);
    if(!row||row.revoked_at||row.expires_at<=clock()||row.token_hash!==await digest(token))fail('unauthorized',401);
    const scope={knowledge:'knowledge:read',events:'events:read',draft:'drafts:write'}[operation];
    if(!scope||!json(row.scopes_json,[]).includes(scope))fail('scope_denied',403);
    if(checkRole)await currentRole(row);
    return row;
  }
  async function currentRole(row){let current;try{current=await api.call('getChatMember',{chat_id:Number(row.chat_id),user_id:Number(row.actor_id)});}catch{fail('authorization_unavailable',503);}if(!isAdmin(current))fail('forbidden',403);}
  async function perform({token,operation,input={},requestId}) {
    const row=await authenticate(token,operation,{checkRole:false}),now=clock(),bucket=Math.floor(now/60);
    const rate=await store.run('INSERT INTO pilot_integration_limits(token_id,bucket,uses) VALUES(?,?,1) ON CONFLICT(token_id,bucket) DO UPDATE SET uses=uses+1 WHERE uses<60',row.id,bucket);
    if(!Number(rate.meta?.changes||rate.changes||0))fail('rate_limited',429);
    await currentRole(row);
    const actor={id:Number(row.actor_id)},chatId=row.chat_id;
    await store.run('UPDATE pilot_integration_tokens SET last_used_at=? WHERE id=?',now,row.id);
    if(operation==='knowledge') {
      objectKeys(input,['query']);if(input.query!==undefined)textValue(input.query,200,true);
      const result=await community.query({actor,chatId,view:'faq',input:input.query?{query:input.query}:{}});
      return {faq:(result.faq||[]).map(item=>({id:item.id,question:item.question,answer:item.answer,url:item.url,language:item.language}))};
    }
    if(operation==='events') {
      objectKeys(input,[]);const result=await operations.query({actor,chatId,view:'events',input:{}});
      return {events:(result.events||[]).map(item=>({id:item.id,title:item.title,description:item.description,starts_at:item.starts_at,ends_at:item.ends_at,url:item.url,status:item.status,language:item.language}))};
    }
    objectKeys(input,['title','text']);const title=textValue(input.title,120),text=textValue(input.text,3500);
    if(typeof requestId!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(requestId))fail('invalid_request_id');
    const operationId=`integration:${row.id}:${requestId}`;
    const duplicate=await store.claim({actor,chatId,action:'integration_draft',input:{title,text},requestId:operationId},now);if(duplicate)return duplicate;
    try {
      if((await store.first("SELECT COUNT(*) AS n FROM pilot_integration_drafts WHERE chat_id=? AND status='pending'",chatId)).n>=50)fail('draft_limit',409);
      if((await store.first('SELECT COUNT(*) AS n FROM pilot_integration_drafts WHERE token_id=? AND created_at>?',row.id,now-86400)).n>=20)fail('draft_rate_limited',429);
      const id=crypto.randomUUID();return await store.finish(operationId,{ok:true,id,status:'pending'},now,[db.prepare('INSERT INTO pilot_integration_drafts(id,chat_id,token_id,title,text,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,chatId,row.id,title,text,'pending',now,now)]);
    }catch(error){await store.run("UPDATE pilot_tool_operations SET status='failed',error_code=?,updated_at=? WHERE id=?",error instanceof ToolsError?error.code:'internal_error',now,operationId);throw error;}
  }
  return {authenticate,perform};
}
