import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TestD1 } from './helpers/d1.js';
import { applySchema, createStore } from '../src/store.js';
import { createBroadcastStore, BROADCAST_SCHEMA_SQL } from '../src/broadcast-store.js';
import { createBroadcastService, BroadcastError, normalizeBroadcastContent } from '../src/broadcast-service.js';
import { TelegramError } from '../src/telegram.js';

const OWNER = 202, OTHER = 203, BOT = 900, GROUP = -1001100, SECOND = -1002200;
const START = Date.UTC(2026,9,22,12)/1000;
const actor = {id:OWNER,username:'project_owner',is_bot:false};
const content = {method:'sendMessage',params:{text:'Habari za SautiLink'}};
const errorCode = code => error => error instanceof BroadcastError && error.code === code;

class FakeTelegram {
  constructor() { this.calls=[];this.members=new Map();this.hooks=new Map();this.sequence=1; }
  callsOf(method) { return this.calls.filter(call => call.method === method); }
  sends() { return this.calls.filter(call => call.method.startsWith('send')); }
  async call(method,params={}) {
    this.calls.push({method,params:structuredClone(params)});
    if (this.hooks.has(method)) return this.hooks.get(method)(params,this);
    if (method === 'getMe') return {id:BOT,is_bot:true};
    if (method === 'getChatMember') return this.members.get(params.chat_id) || {user:{id:BOT,is_bot:true},status:'administrator'};
    if (method.startsWith('send')) return {message_id:++this.sequence,chat:{id:params.chat_id,type:'supergroup'}};
    throw new Error('Unexpected API method');
  }
}
async function fixture(t) {
  const db=new TestD1();t.after(()=>db.close());await applySchema(db);
  const records=createBroadcastStore(db),base=createStore(db),api=new FakeTelegram();
  let current=START,source=0,authorized=true;
  const owner={async isOwner(value){return authorized && value?.id===OWNER && value?.is_bot!==true;}};
  const service=createBroadcastService({db,api,owner,clock:()=>current});
  await records.ensure();
  return {
    db,records,base,api,service,owner,now:()=>current,advance:seconds=>{current+=seconds;},
    authorize:value=>{authorized=value;},
    another:()=>createBroadcastService({db,api,owner,clock:()=>current}),
    async group(chat=GROUP,{status='unknown',enabled=true}={}) {
      await base.group(chat);await base.run('UPDATE groups SET enabled=? WHERE chat_id=?',enabled?1:0,String(chat));
      if(status==='unknown')await records.rememberGroup(chat,current);
      else await records.recordMembership(chat,status,current,10);
    },
    async draft(value=content) { return (await service.createDraft({actor,content:structuredClone(value),sourceUpdateId:++source})).draft; },
    async ready(value=content) {
      const draft=(await service.createDraft({actor,content:structuredClone(value),sourceUpdateId:++source})).draft;
      await service.setPreview({actor,id:draft.id,messageId:100+source});
      return (await service.confirm({actor,id:draft.id,previewMessageId:100+source})).draft;
    },
    delivery:(id,chat=GROUP)=>records.first('SELECT * FROM pilot_broadcast_deliveries WHERE campaign_id=? AND chat_id=?',id,String(chat)),
  };
}

test('broadcast schema matches its migration and remains idempotent',async t=>{
  const f=await fixture(t);await createBroadcastStore(f.db).ensure();
  const migration=await readFile(new URL('../migrations/0006_broadcasts.sql',import.meta.url),'utf8');
  assert.equal(migration.trim(),BROADCAST_SCHEMA_SQL.trim());
  assert.equal((await f.records.all('SELECT * FROM pilot_broadcast_runtime')).length,1);
  assert.equal(await f.service.nextRunAt(),null);
});

test('every owner-facing service method fails closed for a stranger, bot or unavailable owner check',async t=>{
  const f=await fixture(t);
  const calls=[
    ['composeStart',{}],['composeState',{}],['clearCompose',{}],
    ['createDraft',{content,sourceUpdateId:1}],['getDraft',{id:'a'.repeat(24)}],
    ['setPreview',{id:'a'.repeat(24),messageId:1}],['confirm',{id:'a'.repeat(24),previewMessageId:1}],
    ['cancel',{id:'a'.repeat(24)}],['panel',{}],
  ];
  for(const [method,input]of calls)await assert.rejects(f.service[method]({...input,actor:{id:OTHER,username:actor.username}}),errorCode('owner_required'));
  await assert.rejects(f.service.panel({actor:{...actor,is_bot:true}}),errorCode('owner_required'));
  const closed=createBroadcastService({db:f.db,api:f.api,owner:{async isOwner(){throw new Error('private secret');}},clock:f.now});
  await assert.rejects(closed.panel({actor}),error=>error.code==='owner_required'&&!error.message.includes('secret'));
  assert.equal(f.api.calls.length,0);
});

test('frozen text and media preserve native UTF-16 entities, dates and visual caption placement',()=>{
  const typed={method:'sendMessage',params:{text:'😀 Soma hapa',entities:[{type:'bold',offset:3,length:4},{type:'text_link',offset:8,length:4,url:'https://example.org'}],link_preview_options:{is_disabled:true}}};
  assert.deepEqual(normalizeBroadcastContent(typed),typed);
  const dated={method:'sendMessage',params:{text:'Kesho',entities:[{type:'date_time',offset:0,length:5,unix_time:START,date_time_format:'wDt'}]}};
  assert.equal(normalizeBroadcastContent(dated).params.entities[0].date_time_format,'wDt');
  for(const [method,key]of Object.entries({sendPhoto:'photo',sendVideo:'video',sendDocument:'document',sendAnimation:'animation',sendAudio:'audio',sendVoice:'voice'})){
    const media={method,params:{[key]:'telegram_file_id-123',caption:'Habari',caption_entities:[{type:'italic',offset:0,length:6}]}};
    if(['sendPhoto','sendVideo','sendAnimation'].includes(method))Object.assign(media.params,{has_spoiler:true,show_caption_above_media:true});
    assert.deepEqual(normalizeBroadcastContent(media),media);
  }
});

test('content validation rejects target overrides, unsafe fields, external file URLs and malformed entities',()=>{
  for(const candidate of [
    {method:'copyMessage',params:{from_chat_id:OWNER,message_id:1}},
    {method:'sendMessage',params:{text:'Hi',chat_id:GROUP}},
    {method:'sendMessage',params:{text:'Hi',reply_markup:{inline_keyboard:[]}}},
    {method:'sendMessage',params:{text:'Hi',parse_mode:'HTML'}},
    {method:'sendMessage',params:{text:'Hi',allow_paid_broadcast:true}},
    {method:'sendPhoto',params:{photo:'https://example.com/photo.jpg'}},
    {method:'sendMessage',params:{text:'😀',entities:[{type:'bold',offset:1,length:1}]}},
    {method:'sendMessage',params:{text:'Hi',entities:[{type:'text_link',offset:0,length:2,url:'javascript:alert(1)'}]}},
    {method:'sendMessage',params:{text:'Hi',entities:[{type:'date_time',offset:0,length:2,unix_time:START,date_time_format:'rt'}]}},
    {method:'sendMessage',params:{text:'x'.repeat(4097)}},
    {method:'sendVoice',params:{voice:'file_id',caption:'x'.repeat(1025)}},
  ])assert.throws(()=>normalizeBroadcastContent(candidate),errorCode('invalid_content'));
});

test('membership events are monotonic by timestamp/update ID and old observed messages cannot revive a disconnect',async t=>{
  const f=await fixture(t);await f.group();
  await f.records.recordMembership(GROUP,'administrator',START,10);
  await f.records.recordMembership(GROUP,'left',START+10,100);
  await f.records.rememberGroup(GROUP,START+9);
  await f.records.recordMembership(GROUP,'member',START+10,99);
  await f.records.backfillGroups(START+20);
  assert.equal((await f.records.first('SELECT status FROM pilot_broadcast_groups WHERE chat_id=?',String(GROUP))).status,'disconnected');
  await f.records.recordMembership(GROUP,'member',START+10,101);
  assert.equal((await f.records.first('SELECT status FROM pilot_broadcast_groups WHERE chat_id=?',String(GROUP))).status,'active');
  await f.records.recordMembership(GROUP,'kicked',START+10,102);
  await f.records.rememberGroup(GROUP,START+10);
  assert.equal((await f.records.first('SELECT status FROM pilot_broadcast_groups WHERE chat_id=?',String(GROUP))).status,'disconnected');
  await f.records.rememberGroup(GROUP,START+11);
  assert.equal((await f.records.first('SELECT status FROM pilot_broadcast_groups WHERE chat_id=?',String(GROUP))).status,'unknown');
  await f.records.recordMembership(GROUP,'member',START+11,103);
  const untouched=await f.records.rememberGroup(GROUP,START+20);
  assert.equal(untouched.meta.changes,0);
});

test('draft creation snapshots legacy and paused groups, excludes disconnected groups and never expands after preview',async t=>{
  const f=await fixture(t);
  await f.base.group(GROUP);await f.base.run('UPDATE groups SET enabled=0 WHERE chat_id=?',String(GROUP));
  await f.group(SECOND,{status:'left'});
  const draft=await f.draft();
  assert.equal(draft.candidateCount,1);assert.equal(draft.counts.staged,1);
  assert.equal((await f.records.first('SELECT status FROM pilot_broadcast_groups WHERE chat_id=?',String(GROUP))).status,'unknown');
  await f.group(-1003300);
  await f.service.setPreview({actor,id:draft.id,messageId:45});
  await f.service.confirm({actor,id:draft.id,previewMessageId:45});
  await f.service.drain();
  assert.deepEqual(f.api.sends().map(call=>call.params.chat_id),[GROUP]);
});

test('drafts are frozen, idempotent by source update and constrained to one active campaign',async t=>{
  const f=await fixture(t);await f.group();
  const original=structuredClone(content);
  const created=await f.service.createDraft({actor,content:original,sourceUpdateId:20});
  original.params.text='Changed after save';
  const duplicate=await f.service.createDraft({actor,content,sourceUpdateId:20});
  assert.equal(duplicate.duplicate,true);assert.equal(duplicate.draft.id,created.draft.id);
  assert.equal(duplicate.draft.content.params.text,content.params.text);
  await assert.rejects(f.service.createDraft({actor,content:{method:'sendMessage',params:{text:'Different'}},sourceUpdateId:20}),errorCode('source_conflict'));
  await assert.rejects(f.service.createDraft({actor,content,sourceUpdateId:21}),errorCode('broadcast_busy'));
  assert.equal(f.api.sends().length,0);
});

test('concurrent draft requests cannot create two active campaigns',async t=>{
  const f=await fixture(t);await f.group();
  const outcomes=await Promise.allSettled([
    f.service.createDraft({actor,content,sourceUpdateId:10}),
    f.another().createDraft({actor,content,sourceUpdateId:11}),
  ]);
  assert.equal(outcomes.filter(result=>result.status==='fulfilled').length,1);
  assert.equal((await f.records.all("SELECT id FROM pilot_broadcast_campaigns WHERE status='draft'")).length,1);
});

test('composition expires after 15 minutes, invalid content preserves it, and successful draft creation consumes it',async t=>{
  const f=await fixture(t);await f.group();
  await f.service.composeStart({actor});
  await assert.rejects(f.service.createDraft({actor,content:{method:'sendPoll',params:{}},sourceUpdateId:1}),errorCode('invalid_content'));
  assert.equal((await f.service.composeState({actor})).awaitingContent,true);
  f.advance(901);assert.equal((await f.service.composeState({actor})).awaitingContent,false);
  await f.service.composeStart({actor});await f.draft();
  assert.equal((await f.service.composeState({actor})).awaitingContent,false);
});

test('replace composition cancels only a pending draft and cannot replace an active delivery',async t=>{
  const f=await fixture(t);await f.group();const draft=await f.draft();
  await f.service.composeStart({actor,replaceDraftId:draft.id});
  assert.equal((await f.service.getDraft({actor,id:draft.id})).draft.status,'cancelled');
  assert.equal((await f.service.composeState({actor})).awaitingContent,true);
  const active=await f.ready();
  await assert.rejects(f.service.composeStart({actor,replaceDraftId:active.id}),errorCode('broadcast_busy'));
  assert.equal((await f.service.getDraft({actor,id:active.id})).draft.status,'running');
});

test('confirmation requires the exact immutable preview ID and no group delivery occurs for an unconfirmed draft',async t=>{
  const f=await fixture(t);await f.group();const draft=await f.draft();
  await assert.rejects(f.service.confirm({actor,id:draft.id,previewMessageId:90}),errorCode('preview_required'));
  await f.service.drain();assert.equal(f.api.calls.length,0);
  await f.service.setPreview({actor,id:draft.id,messageId:90});
  await assert.rejects(f.service.setPreview({actor,id:draft.id,messageId:91}),errorCode('preview_mismatch'));
  await assert.rejects(f.service.confirm({actor,id:draft.id,previewMessageId:91}),errorCode('preview_mismatch'));
  await f.service.confirm({actor,id:draft.id,previewMessageId:90});
  assert.equal((await f.service.confirm({actor,id:draft.id,previewMessageId:90})).duplicate,true);
  assert.equal((await f.service.panel({actor})).active.id,draft.id);
});

test('drafts expire after 24 hours and can no longer be confirmed',async t=>{
  const f=await fixture(t);await f.group();const draft=await f.draft();
  await f.service.setPreview({actor,id:draft.id,messageId:50});
  f.advance(86400);
  await assert.rejects(f.service.confirm({actor,id:draft.id,previewMessageId:50}),errorCode('draft_expired'));
  assert.equal((await f.delivery(draft.id)).status,'cancelled');
  assert.equal((await f.service.panel({actor})).active,null);
  assert.equal(f.api.sends().length,0);
});

test('delivery verifies the bot in each group, includes paused moderation and spaces send starts by two seconds',async t=>{
  const f=await fixture(t);await f.group(GROUP,{enabled:false});await f.group(SECOND);
  f.api.members.set(SECOND,{user:{id:BOT},status:'member'});
  const draft=await f.ready();
  const first=await f.service.drain();
  assert.equal(first.sent,1);assert.equal(first.nextRunAt,START+2);
  assert.equal((await f.service.drain()).processed,0);
  f.advance(2);await f.service.drain();
  assert.equal(f.api.sends().length,2);
  assert.equal(f.api.callsOf('getMe').length,1);
  assert.equal(f.api.callsOf('getChatMember').length,2);
  assert.equal((await f.service.getDraft({actor,id:draft.id})).draft.status,'completed');
  assert.ok(f.api.sends().every(call=>!Object.hasOwn(call.params,'allow_paid_broadcast')));
});

test('separate confirmed campaigns respect a global 60-second start cooldown',async t=>{
  const f=await fixture(t);await f.group();
  await f.ready();await f.service.drain();
  const second=await f.ready();
  assert.equal(second.starts_at,START+60);
  f.advance(59);assert.equal((await f.service.drain()).processed,0);
  f.advance(1);await f.service.drain();
  assert.equal(f.api.sends().length,2);
});

test('campaign cooldown also starts from the actual send when membership reads are delayed',async t=>{
  const f=await fixture(t);await f.group();
  f.api.hooks.set('getChatMember',()=>{f.advance(8);return {user:{id:BOT},status:'administrator'};});
  await f.ready();await f.service.drain();
  const second=await f.ready();
  assert.equal(second.starts_at,START+8+60);
});

test('a fresh left/kicked bot membership skips delivery and records disconnection',async t=>{
  const f=await fixture(t);await f.group();
  f.api.members.set(GROUP,{user:{id:BOT},status:'kicked'});
  const draft=await f.ready();await f.service.drain();
  assert.equal((await f.delivery(draft.id)).status,'skipped');
  assert.equal((await f.delivery(draft.id)).error_kind,'bot_disconnected');
  assert.equal((await f.records.first('SELECT status FROM pilot_broadcast_groups WHERE chat_id=?',String(GROUP))).status,'disconnected');
  assert.equal(f.api.sends().length,0);
});

test('a disconnect received during membership lookup wins over the stale API response',async t=>{
  const f=await fixture(t);await f.group();
  f.api.hooks.set('getChatMember',async()=>{
    f.advance(1);await f.records.recordMembership(GROUP,'left',f.now(),500);
    f.advance(1);return {user:{id:BOT},status:'administrator'};
  });
  const draft=await f.ready();await f.service.drain();
  assert.equal((await f.delivery(draft.id)).error_kind,'bot_disconnected');
  assert.equal(f.api.sends().length,0);
});

test('malformed or wrong-bot membership cannot authorize a broadcast send',async t=>{
  const f=await fixture(t);await f.group();
  f.api.hooks.set('getChatMember',()=>({user:{id:OTHER},status:'administrator'}));
  const draft=await f.ready();await f.service.drain();
  assert.equal((await f.delivery(draft.id)).status,'pending');
  assert.equal(f.api.sends().length,0);
});

test('429 responses honor retry_after without duplicating an already accepted delivery',async t=>{
  const f=await fixture(t);await f.group();
  let calls=0;
  f.api.hooks.set('sendMessage',params=>{
    if(++calls===1)throw new TelegramError('Too Many Requests token-secret',429,false,17);
    return {message_id:44,chat:{id:params.chat_id}};
  });
  const draft=await f.ready();const attempt=await f.service.drain();
  assert.equal(attempt.nextRunAt,START+17);assert.equal((await f.delivery(draft.id)).status,'pending');
  f.advance(16);assert.equal((await f.service.drain()).processed,0);
  f.advance(1);await f.service.drain();await f.service.drain();
  const row=await f.delivery(draft.id);
  assert.equal(row.status,'sent');assert.equal(row.attempts,2);assert.equal(row.telegram_message_id,44);
  assert.equal(f.api.sends().length,2);assert.ok(!JSON.stringify(row).includes('token-secret'));
});

test('transient preflight read failures retry at most three times without sending',async t=>{
  const f=await fixture(t);await f.group();
  f.api.hooks.set('getChatMember',()=>{throw new TelegramError('Network timeout',503,true);});
  const draft=await f.ready();
  await f.service.drain();f.advance(5);await f.service.drain();f.advance(15);await f.service.drain();
  assert.equal((await f.delivery(draft.id)).status,'failed');
  assert.equal(f.api.callsOf('getChatMember').length,3);assert.equal(f.api.sends().length,0);
  assert.equal((await f.service.getDraft({actor,id:draft.id})).draft.status,'completed');
});

test('unknown send outcomes are terminal and cannot be automatically replayed',async t=>{
  const f=await fixture(t);await f.group();
  f.api.hooks.set('sendMessage',()=>{throw new TelegramError('Response lost with private-token',0,true);});
  const draft=await f.ready();await f.service.drain();
  f.advance(600);await f.another().drain();
  const row=await f.delivery(draft.id);
  assert.equal(row.status,'unknown');assert.equal(row.telegram_message_id,null);
  assert.equal(f.api.sends().length,1);assert.ok(!JSON.stringify(row).includes('private-token'));
});

test('unexpected send success payload is unconfirmed and never marked sent',async t=>{
  const f=await fixture(t);await f.group();f.api.hooks.set('sendMessage',()=>true);
  const draft=await f.ready();await f.service.drain();
  assert.equal((await f.delivery(draft.id)).status,'unknown');assert.equal((await f.delivery(draft.id)).telegram_message_id,null);
  f.advance(600);await f.service.drain();assert.equal(f.api.sends().length,1);
});

test('generic 400/403 send failures are classified without falsely disconnecting a group',async t=>{
  const f=await fixture(t);await f.group(GROUP);await f.group(SECOND);
  f.api.hooks.set('sendMessage',params=>{throw new TelegramError('Unrelated raw secret detail',params.chat_id===GROUP?403:400,false);});
  const draft=await f.ready();await f.service.drain();f.advance(2);await f.service.drain();
  assert.equal((await f.delivery(draft.id,GROUP)).error_kind,'send_forbidden');
  assert.equal((await f.delivery(draft.id,SECOND)).error_kind,'message_rejected');
  assert.ok((await f.records.all('SELECT status FROM pilot_broadcast_groups')).every(row=>row.status==='active'));
  assert.ok(!(await f.records.all('SELECT * FROM pilot_broadcast_deliveries')).some(row=>JSON.stringify(row).includes('secret')));
});

test('a durable lease prevents duplicate global drain workers from sending concurrently',async t=>{
  const f=await fixture(t);await f.group();
  let release,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const wait=new Promise(resolve=>{release=resolve;});
  f.api.hooks.set('sendMessage',async params=>{entered();await wait;return {message_id:45,chat:{id:params.chat_id}};});
  await f.ready();const first=f.service.drain();await started;
  const duplicate=await f.another().drain();assert.equal(duplicate.busy,true);
  release();await first;assert.equal(f.api.sends().length,1);
});

test('crash recovery marks stale sending claims unknown without replaying them',async t=>{
  const f=await fixture(t);await f.group();const draft=await f.ready();
  await f.records.run("UPDATE pilot_broadcast_deliveries SET status='sending',attempts=1,claimed_at=?,lease_token='crashed' WHERE campaign_id=?",START,draft.id);
  await f.records.run("UPDATE pilot_broadcast_runtime SET lease_token='crashed',lease_until=? WHERE id=1",START+120);
  assert.equal((await f.service.drain()).busy,true);
  f.advance(121);await f.service.drain();
  assert.equal((await f.delivery(draft.id)).status,'unknown');assert.equal(f.api.sends().length,0);
  assert.equal((await f.service.getDraft({actor,id:draft.id})).draft.status,'completed');
});

test('crashed read-only checks may safely retry after lease expiry',async t=>{
  const f=await fixture(t);await f.group();const draft=await f.ready();
  await f.records.run("UPDATE pilot_broadcast_deliveries SET status='checking',claimed_at=?,lease_token='crashed' WHERE campaign_id=?",START,draft.id);
  f.advance(121);await f.service.drain();
  assert.equal((await f.delivery(draft.id)).status,'pending');assert.equal(f.api.sends().length,0);
  f.advance(5);await f.service.drain();assert.equal((await f.delivery(draft.id)).status,'sent');
});

test('cancellation stops pending targets but an already committed send may finish',async t=>{
  const f=await fixture(t);await f.group();await f.group(SECOND);
  let release,entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const wait=new Promise(resolve=>{release=resolve;});
  f.api.hooks.set('sendMessage',async params=>{entered();await wait;return {message_id:55,chat:{id:params.chat_id}};});
  const draft=await f.ready();const sending=f.service.drain();await started;
  await f.service.cancel({actor,id:draft.id});release();await sending;
  f.advance(3);await f.service.drain();
  const current=(await f.service.getDraft({actor,id:draft.id})).draft;
  assert.equal(current.status,'cancelled');assert.equal(current.counts.sent,1);assert.equal(current.counts.cancelled,1);
  assert.equal(f.api.sends().length,1);
});

test('cancellation while a membership check is in flight prevents the uncommitted send',async t=>{
  const f=await fixture(t);await f.group();
  let release,entered;const started=new Promise(resolve=>{entered=resolve;});
  const wait=new Promise(resolve=>{release=resolve;});
  f.api.hooks.set('getChatMember',async()=>{entered();await wait;return {user:{id:BOT},status:'administrator'};});
  const draft=await f.ready();const checking=f.service.drain();await started;
  await f.service.cancel({actor,id:draft.id});release();await checking;
  assert.equal((await f.delivery(draft.id)).status,'cancelled');assert.equal(f.api.sends().length,0);
});

test('a running campaign older than 30 days expires instead of resuming after an outage or blocking new drafts',async t=>{
  const f=await fixture(t);await f.group();const draft=await f.ready();
  f.advance(31*86400);await f.service.drain();
  const old=await f.records.first('SELECT status,content_json FROM pilot_broadcast_campaigns WHERE id=?',draft.id);
  assert.equal(old.status,'expired');assert.equal(old.content_json,null);assert.equal(f.api.sends().length,0);
  assert.equal((await f.service.panel({actor})).active,null);
  assert.ok((await f.draft()).id);
});

test('retention clears content independently of bounded delivery-history cleanup',async t=>{
  const f=await fixture(t);
  for(let index=0;index<520;index++)await f.records.rememberGroup(-100000-index,START);
  const draft=await f.draft();await f.service.cancel({actor,id:draft.id});
  f.advance(31*86400);await f.records.cleanup(f.now());
  const old=await f.records.first('SELECT content_json FROM pilot_broadcast_campaigns WHERE id=?',draft.id);
  assert.equal(old.content_json,null);
  assert.equal((await f.records.first('SELECT COUNT(*) AS count FROM pilot_broadcast_deliveries WHERE campaign_id=?',draft.id)).count,20);
  await f.records.cleanup(f.now());
  assert.equal(await f.records.first('SELECT id FROM pilot_broadcast_campaigns WHERE id=?',draft.id),null);
  assert.equal((await f.records.all('SELECT * FROM pilot_broadcast_audit')).length,0);
});

