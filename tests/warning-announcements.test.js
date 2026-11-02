import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAnnouncement, createAnnouncer } from '../src/announcements.js';
import { applySchema, createStore } from '../src/store.js';
import { TestD1 } from './helpers/d1.js';
import { TelegramError } from '../src/telegram.js';

const message={chat:{id:-1001,title:'Group'},from:{id:101,first_name:'😀 <Juma & Asha>'},message_id:1};
const row={id:'warning:1',chat_id:-1001,user_id:101,message_id:1,event_at:100,created_at:100,strike:0,until_date:0,reasons:'["link"]',status:'warned'};

test('warnings tag the member safely in both languages and every notice style',()=>{
  for(const language of ['sw','en'])for(const notice_template of ['detailed','compact','formal']) {
    const notice=formatAnnouncement(row,message,false,language,{notice_template,notice_en:'custom ban',notice_sw:'custom ban'});
    assert.match(notice.rich,/<a href="tg:\/\/user\?id=101">😀 &lt;Juma &amp; Asha&gt;<\/a>/);
    assert.doesNotMatch(notice.rich,/MEMBER BANNED|MEMBER AMEFUNGIWA|Ends:|Mwisho:|0 \/ 3|custom ban/);
    assert.match(notice.plain,language==='en' ? /If you post a prohibited link again, you will be banned/ : /Links zinazofuata huleta restrictions za kutopost/);
    const [entity]=notice.plainEntities;
    assert.equal(notice.plain.slice(entity.offset,entity.offset+entity.length),message.from.first_name);
    assert.equal(entity.user.id,101); assert.equal(entity.type,'text_mention');
  }
});

test('HTML rejection keeps a real member tag in the plain fallback and sends once',async t=>{
  const db=new TestD1(); t.after(()=>db.close()); await applySchema(db);
  const store=createStore(db); await store.plan(row); await store.status(row.id,'warned');
  const calls=[];
  const announcer=createAnnouncer({store,clock:()=>100,api:{async call(method,params){
    calls.push(params);
    if(calls.length===1)throw new TelegramError('Cannot parse entities',400,false);
    return {message_id:99};
  }}});
  assert.equal(await announcer.notify(row,message,false,{groupLanguage:'en',groupSettings:{}}),false);
  assert.equal(calls.length,2); assert.equal(calls[1].parse_mode,undefined);
  assert.deepEqual(calls[1].entities,formatAnnouncement(row,message,false,'en').plainEntities);
  assert.equal((await store.latestNotice(-1001)).status,'sent');
  await announcer.notify(row,message,false); assert.equal(calls.length,2);
});

test('invalid sendMessage success never records confirmed warning delivery',async t=>{
  for(const message_id of [0,-1,null]) {
    const db=new TestD1(); t.after(()=>db.close()); await applySchema(db);
    const store=createStore(db); await store.plan(row); await store.status(row.id,'warned');
    let calls=0;
    const announcer=createAnnouncer({store,clock:()=>100,api:{async call(){calls++;return {message_id};}}});
    await announcer.notify(row,message,false,{groupLanguage:'en',groupSettings:{}});
    assert.equal((await store.latestNotice(-1001)).status,'unknown');
    await announcer.notify(row,message,false); assert.equal(calls,1);
  }
});
