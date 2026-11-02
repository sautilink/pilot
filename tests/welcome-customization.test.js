import test from 'node:test';
import assert from 'node:assert/strict';
import {TestD1} from './helpers/d1.js';
import {applySchema,createStore} from '../src/store.js';
import {createControlStore} from '../src/control-store.js';
import {createGuardrails} from '../src/guardrails.js';
import {createWelcomeExpiries} from '../src/welcome-expiry.js';
import {WELCOME_TAGS,validateWelcomeTemplate,welcomeValues,renderWelcome,fillTemplate} from '../src/templates.js';

const GROUP=-100987654,USER=123456789,BOT=900,START=1800000000;
async function fixture(t,config={}){
  const db=new TestD1();await applySchema(db);t.after(()=>db.close());
  const store=createStore(db),controlStore=createControlStore(db),calls=[];
  let now=START,serial=2000;
  const api={async call(method,p){
    calls.push({method,p:structuredClone(p)});
    if(method==='getMe')return {id:BOT,username:'sautilinkpilotbot',is_bot:true};
    if(method==='getChat')return {id:GROUP,type:'supergroup',title:'Tech <Hub> & friends',username:'thetechgroup'};
    if(method==='getChatMemberCount')return 145;
    if(method==='sendMessage')return {message_id:serial++};
    if(method==='deleteMessage')return true;
    throw new Error('Unexpected API '+method);
  }};
  await store.group(GROUP);await store.settings({ready_since:START-1,ready:'1'});
  await controlStore.ensure();
  const settings={welcome_enabled:true,...config};
  await db.prepare('INSERT INTO pilot_group_settings VALUES(?,?,?)')
    .bind(String(GROUP),JSON.stringify(settings),START).run();
  const clock=()=>now;
  const guards=createGuardrails({db,store,controlStore,api,clock,
    me:()=>api.call('getMe'),
    say:(chat,text,extra)=>api.call('sendMessage',{chat_id:chat,text,...extra})});
  const expiries=createWelcomeExpiries({db,api,clock});
  return {db,store,controlStore,guards,expiries,api,calls,settings,clock,
    advance:s=>{now+=s;},of:name=>calls.filter(x=>x.method===name),
    user:{id:USER,first_name:'<Asha>',last_name:'& Company',username:'asha_user'}};
}
test('welcome template permits all documented placeholders and rejects malformed or unknown tags',()=>{
  assert.ok(WELCOME_TAGS.length>=16);
  assert.equal(validateWelcomeTemplate('Hi {user_id}, {mention}!'), 'Hi {user_id}, {mention}!');
  for(const value of ['hi {password}','hi {mention','hi {{name}}', 'x'.repeat(1801),'<bad>\u0000']) {
    assert.throws(()=>validateWelcomeTemplate(value));
  }
  const values=welcomeValues({user:{id:USER,first_name:'<Asha>',last_name:'& Company',username:'asha_user'},
    chat:{id:GROUP,title:'Tech <Hub> & friends',username:'thetechgroup'},
    bot:{username:'sautilinkpilotbot'},language:'en',rules:'Read <rules>',
    memberCount:145,now:new Date('2026-11-02T08:10:00Z')});
  assert.equal(values.user_id,String(USER));
  assert.equal(values.username,'@asha_user');
  assert.equal(values.member_count,'145');
  assert.equal(values.group_link,'https://t.me/thetechgroup');
  const welcome=renderWelcome('Hi {mention} | {name} | {user_id} | {group_name} | {rules} | {date} {time}',values,{userId:USER});
  assert.match(welcome.html,/href="tg:\/\/user\?id=123456789"/);
  assert.match(welcome.html,/&lt;Asha&gt; &amp; Company/);
  assert.match(welcome.html,/Read &lt;rules&gt;/);
  assert.doesNotMatch(welcome.html,/<script|<Asha>|<Hub>/);
  assert.match(welcome.plain,/Hi <Asha> & Company/);
  assert.ok(welcome.html.length<12000);
});
test('welcome sends one clickable tagged greeting with safe CTA, topic and live member count',async t=>{
  const f=await fixture(t,{
    welcome_en:'Hello {mention}! ID: {user_id}, {username} in {group_name}. Total {member_count}, read {rules_link}',
    welcome_button_label:'Community rules',
    welcome_button_url:'https://example.org/rules',
    welcome_delete_seconds:60,
  });
  await f.store.setLanguage('group',GROUP,'en',START);
  const result=await f.guards.welcome(GROUP,f.user,START,await f.controlStore.settings(GROUP),{messageThreadId:12});
  assert.equal(result,'sent');
  const sent=f.of('sendMessage');
  assert.equal(sent.length,1);
  assert.equal(sent[0].p.parse_mode,'HTML');
  assert.equal(sent[0].p.message_thread_id,12);
  assert.match(sent[0].p.text,/tg:\/\/user\?id=123456789/);
  assert.match(sent[0].p.text,/Total 145/);
  assert.match(sent[0].p.text,/Tech &lt;Hub&gt; &amp; friends/);
  assert.equal(sent[0].p.reply_markup.inline_keyboard[0][0].url,'https://example.org/rules');
  assert.equal(sent[0].p.reply_markup.inline_keyboard[0][0].text,'Community rules');
  assert.equal(sent[0].p.link_preview_options.is_disabled,true);
  assert.equal((await f.expiries.nextRunAt(GROUP)),START+60);
  assert.equal(await f.guards.welcome(GROUP,f.user,START,await f.controlStore.settings(GROUP)),'duplicate');
  assert.equal(f.of('sendMessage').length,1);
});
test('optional auto-delete removes only its own welcome, never a member message',async t=>{
  const f=await fixture(t,{welcome_delete_seconds:300});
  await f.guards.welcome(GROUP,f.user,START,await f.controlStore.settings(GROUP));
  f.advance(299);
  assert.equal((await f.expiries.drain(GROUP)).checked,0);
  f.advance(1);
  assert.equal((await f.expiries.drain(GROUP)).done,1);
  assert.deepEqual(f.of('deleteMessage').map(x=>x.p.message_id),[2000]);
  await f.expiries.drain(GROUP);
  assert.equal(f.of('deleteMessage').length,1);
  assert.deepEqual(await f.expiries.dueGroups(),[]);
});
test('stale, disabled and bot join events do not produce greetings',async t=>{
  const f=await fixture(t);
  assert.equal(await f.guards.welcome(GROUP,{...f.user,is_bot:true},START,f.settings),'disabled_or_stale');
  assert.equal(await f.guards.welcome(GROUP,f.user,START-180,f.settings),'disabled_or_stale');
  assert.equal(await f.guards.welcome(GROUP,f.user,START,{welcome_enabled:false}),'disabled_or_stale');
  assert.equal(f.of('sendMessage').length,0);
});
test('definite Telegram HTML rejection falls back to safe plain text without duplicate greeting',async t=>{
  const f=await fixture(t,{welcome_sw:'Karibu {mention} & {group_name}'});
  const raw=f.api.call.bind(f.api);
  let calls=0;
  f.api.call=async(method,p)=>{
    if(method==='sendMessage'&&++calls===1)throw {code:400,ambiguous:false,message:"Bad Request: can't parse entities"};
    return raw(method,p);
  };
  assert.equal(await f.guards.welcome(GROUP,f.user,START,await f.controlStore.settings(GROUP)),'sent');
  const sent=f.of('sendMessage');
  assert.equal(sent.length,1);
  assert.equal(sent[0].p.parse_mode,undefined);
  assert.match(sent[0].p.text,/Karibu <Asha> & Company/);
});
test('sending failures never create an automatic deletion of an unknown message',async t=>{
  const f=await fixture(t,{welcome_delete_seconds:60});
  f.api.call=async(method)=>{if(method==='getChat')return {id:GROUP,title:'G'};if(method==='getMe')return {id:BOT,username:'sautilinkpilotbot'};throw {code:403,ambiguous:false};};
  assert.equal(await f.guards.welcome(GROUP,f.user,START,await f.controlStore.settings(GROUP)),'failed');
  assert.equal(await f.expiries.nextRunAt(GROUP),null);
});
test('old placeholder aliases continue to work on preexisting group templates',()=>{
  const values={user:'Juma',group:'Technology Hub',rules:'Be respectful'};
  assert.equal(fillTemplate('Welcome {user} to {group}. {rules}',values),'Welcome Juma to Technology Hub. Be respectful');
});
