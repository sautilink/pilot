import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.js';
import { applySchema } from '../src/store.js';
import { createToolsStore,ToolsError,digest } from '../src/tools-store.js';
import { createGovernanceService } from '../src/governance-service.js';
import { createIntegrationService } from '../src/integration-service.js';
import { createCommunityService } from '../src/community-service.js';
import { createOperationsService } from '../src/operations-service.js';

const GROUP=-1001100,SECOND=-1002200,ADMIN=102,STRANGER=103,BOT=900;
const START=Date.UTC(2026,9,22,12)/1000;
const actor={id:ADMIN,is_bot:false};
const code=expected=>error=>error instanceof ToolsError&&error.code===expected;

async function fixture(t) {
  const db=new TestD1();t.after(()=>db.close());await applySchema(db);
  const store=createToolsStore(db);await store.ensure();
  const roles=new Map(),calls=[];let now=START,sequence=0;
  const api={async call(method,params={}){
    calls.push({method,params:structuredClone(params)});
    if(method==='getMe')return {id:BOT,is_bot:true};
    if(method==='getChatMember')return roles.get(`${params.chat_id}:${params.user_id}`)||{status:[ADMIN,BOT].includes(params.user_id)?'administrator':'member'};
    if(method==='getChat')return {id:params.chat_id,type:'supergroup',title:'Group'};
    throw new Error(`No external mutation is expected: ${method}`);
  }};
  const clock=()=>now,governance=createGovernanceService({db,api,clock}),community=createCommunityService({db,api,clock}),operations=createOperationsService({db,api,clock});
  const integration=createIntegrationService({db,api,community,operations,clock});
  const requestId=()=>`integration_test_request_${++sequence}`;
  const perform=(action,input={},extra={})=>governance.perform({actor,chatId:GROUP,action,input,requestId:requestId(),...extra});
  const token=(input={},extra={})=>perform('integration_create',{label:'Example service',scopes:['knowledge:read','events:read','drafts:write'],expiresInDays:7,confirmed:true,...input},extra);
  return {db,store,api,calls,roles,governance,community,operations,integration,perform,token,requestId,now:clock,advance:n=>{now+=n;}};
}

test('integration token plaintext is returned once and never persisted in metadata, history or replay',async t=>{
  const f=await fixture(t),requestId=f.requestId(),created=await f.token({}, {requestId});
  assert.match(created.token,/^slp_[a-f0-9]{32}\.[a-f0-9]{64}$/);
  const row=await f.store.first('SELECT * FROM pilot_integration_tokens WHERE id=?',created.integration.id);
  assert.equal(row.token_hash,await digest(created.token));assert.equal(JSON.stringify(row).includes(created.token),false);
  const records=await f.store.all('SELECT * FROM pilot_tool_operations');assert.equal(JSON.stringify(records).includes(created.token),false);
  const replay=await f.token({}, {requestId});assert.equal(replay.duplicate,true);assert.equal(replay.token,undefined);assert.equal(replay.tokenUnavailable,true);
  const panel=await f.governance.query({actor,chatId:GROUP,view:'governance'});assert.equal(JSON.stringify(panel).includes(created.token),false);assert.equal('token_hash' in panel.integrations[0],false);
});

test('tokens are narrow in scope, expire, and cease working immediately after revocation',async t=>{
  const f=await fixture(t),created=await f.token({scopes:['knowledge:read'],expiresInDays:1});
  await assert.rejects(f.integration.perform({token:created.token,operation:'events'}),code('scope_denied'));
  await assert.rejects(f.integration.perform({token:created.token,operation:'broadcast'}),code('scope_denied'));
  await f.integration.perform({token:created.token,operation:'knowledge'});
  await f.perform('integration_revoke',{id:created.integration.id,confirmed:true});
  await assert.rejects(f.integration.perform({token:created.token,operation:'knowledge'}),code('unauthorized'));
  const second=await f.token({expiresInDays:1});f.advance(86400);
  await assert.rejects(f.integration.perform({token:second.token,operation:'events'}),code('unauthorized'));
});

test('token delegation checks current creator role on every request',async t=>{
  const f=await fixture(t),created=await f.token();
  f.roles.set(`${GROUP}:${ADMIN}`,{status:'member'});
  await assert.rejects(f.integration.perform({token:created.token,operation:'events'}),code('forbidden'));
  assert.equal((await f.store.all('SELECT * FROM pilot_integration_drafts')).length,0);
  await assert.rejects(f.token({}, {actor:{id:STRANGER}}),code('forbidden'));
});

test('a token cannot choose a different group or leak private RSVP identities',async t=>{
  const f=await fixture(t),created=await f.token();
  const first=await f.operations.perform({actor,chatId:GROUP,action:'event_create',input:{title:'Our event',startsAt:f.now()+3600},requestId:f.requestId()});
  await f.operations.perform({actor,chatId:SECOND,action:'event_create',input:{title:'Other group secret',startsAt:f.now()+3600},requestId:f.requestId()});
  await f.operations.perform({actor,chatId:GROUP,action:'event_rsvp',input:{id:first.id,response:'going'},requestId:f.requestId()});
  const events=await f.integration.perform({token:created.token,operation:'events'});
  assert.equal(events.events.length,1);assert.equal(events.events[0].title,'Our event');
  for(const field of ['counts','response','user_id','creator_id'])assert.equal(field in events.events[0],false);
  await assert.rejects(f.integration.perform({token:created.token,operation:'events',input:{chatId:SECOND}}),code('invalid_input'));
});

test('knowledge integration returns only approved FAQ in the bound group',async t=>{
  const f=await fixture(t),created=await f.token({scopes:['knowledge:read']});
  await f.community.perform({actor,chatId:GROUP,action:'faq_save',input:{question:'How do I start?',answer:'Use the group guide.',url:'https://example.org/guide',language:'en'},requestId:f.requestId()});
  await f.community.perform({actor,chatId:SECOND,action:'faq_save',input:{question:'Secret elsewhere',answer:'Unrelated answer.',language:'en'},requestId:f.requestId()});
  const data=await f.integration.perform({token:created.token,operation:'knowledge',input:{query:'start'}});
  assert.equal(data.faq.length,1);assert.equal(data.faq[0].answer,'Use the group guide.');assert.equal('chat_id' in data.faq[0],false);
  await assert.rejects(f.integration.perform({token:created.token,operation:'knowledge',input:{query:'a'.repeat(201)}}),code('invalid_input'));
});

test('developer writes create bounded review drafts and never publish or schedule automatically',async t=>{
  const f=await fixture(t),created=await f.token({scopes:['drafts:write']}),requestId=f.requestId();
  const input={title:'Release candidate',text:'Please review this release draft.'};
  const result=await f.integration.perform({token:created.token,operation:'draft',input,requestId});
  assert.equal(result.status,'pending');
  const replay=await f.integration.perform({token:created.token,operation:'draft',input,requestId});
  assert.equal(replay.id,result.id);assert.equal(replay.duplicate,true);
  await assert.rejects(f.integration.perform({token:created.token,operation:'draft',input:{...input,text:'Changed'},requestId}),code('request_conflict'));
  assert.equal((await f.store.all('SELECT * FROM pilot_integration_drafts')).length,1);
  assert.equal(f.calls.some(item=>item.method.startsWith('send')),false);
  await f.operations.nextRunAt(GROUP);assert.equal((await f.store.all('SELECT * FROM pilot_schedules')).length,0);
  await f.perform('integration_draft_resolve',{id:result.id,decision:'approve',confirmed:true});
  assert.equal((await f.store.first('SELECT status FROM pilot_integration_drafts WHERE id=?',result.id)).status,'approved');
  assert.equal(f.calls.some(item=>item.method.startsWith('send')),false);
});

test('draft-only credentials cannot inject delivery targets or unsafe extra fields',async t=>{
  const f=await fixture(t),created=await f.token({scopes:['drafts:write']});
  for(const extra of [{chat_id:SECOND},{chatId:SECOND},{runAt:f.now()+60},{parse_mode:'HTML'},{send:true}]){
    await assert.rejects(f.integration.perform({token:created.token,operation:'draft',input:{title:'Title',text:'Body',...extra},requestId:f.requestId()}),code('invalid_input'));
  }
  await assert.rejects(f.integration.perform({token:created.token,operation:'draft',input:{title:'Title',text:'x'.repeat(3501)},requestId:f.requestId()}),code('invalid_input'));
  assert.equal((await f.store.all('SELECT * FROM pilot_integration_drafts')).length,0);
});

test('token rate limits and daily draft quota bound external work',async t=>{
  const f=await fixture(t),reader=await f.token({scopes:['events:read']});
  for(let index=0;index<60;index++)await f.integration.perform({token:reader.token,operation:'events'});
  await assert.rejects(f.integration.perform({token:reader.token,operation:'events'}),code('rate_limited'));
  f.advance(60);await f.integration.perform({token:reader.token,operation:'events'});
  const writer=await f.token({scopes:['drafts:write']});
  for(let index=0;index<20;index++)await f.integration.perform({token:writer.token,operation:'draft',input:{title:'Release',text:'Draft'},requestId:f.requestId()});
  await assert.rejects(f.integration.perform({token:writer.token,operation:'draft',input:{title:'Release',text:'Extra'},requestId:f.requestId()}),code('draft_rate_limited'));
});

test('tampered credentials and cross-group credential revocation have no authority',async t=>{
  const f=await fixture(t),created=await f.token();
  const altered=created.token.slice(0,-1)+(created.token.endsWith('a')?'b':'a');
  await assert.rejects(f.integration.perform({token:altered,operation:'events'}),code('unauthorized'));
  await f.perform('integration_revoke',{id:created.integration.id,confirmed:true},{chatId:SECOND});
  await f.integration.perform({token:created.token,operation:'events'});
  assert.equal((await f.store.first('SELECT revoked_at FROM pilot_integration_tokens WHERE id=?',created.integration.id)).revoked_at,0);
});
