import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramError } from '../src/telegram.js';
import { classifyUnbanFailure,formatUnbanFailure } from '../src/unban-feedback.js';

const GROUP='<Tech & Hub>';
const USER=6085855685;
const sample=(error,lang='en')=>formatUnbanFailure(error,{language:lang,userId:USER,groupTitle:GROUP});

test('Telegram user not found provides a real manual removal path, without a success claim',()=>{
  const error=new TelegramError('Bad Request: user not found',400,false);
  assert.equal(classifyUnbanFailure(error),'user_unavailable');
  const en=sample(error);
  assert.match(en,/Unban not confirmed/);
  assert.match(en,/Telegram cannot resolve this user ID/);
  assert.match(en,/Removed Users\/Banned Users/);
  assert.match(en,/cannot find the account/i);
  assert.match(en,/&lt;Tech &amp; Hub&gt;/);
  assert.match(en,/6085855685/);
  assert.doesNotMatch(en,/successfully unbanned|ban was removed/);
  const sw=sample(error,'sw');
  assert.match(sw,/Telegram haiwezi kutambua ID/);
  assert.match(sw,/Hakuna ban wala strike iliyobadilishwa/);
});

test('Telegram API error categories are fixed labels, never raw Telegram payloads',()=>{
  const secret='MY_SECRET_BOT_TOKEN_123456789';
  const cases=[
    [new TelegramError('Bad Request: USER_ID_INVALID '+secret,400,false),'user_unavailable'],
    [new TelegramError('Bad Request: not enough rights '+secret,400,false),'permission'],
    [new TelegramError('Forbidden: bot was kicked '+secret,403,false),'permission'],
    [new TelegramError('Too Many Requests '+secret,429,false,10),'rate_limited'],
    [new TelegramError('Bad Gateway '+secret,502,true),'telegram_unavailable'],
    [new TelegramError('Unknown response '+secret,0,true),'telegram_unavailable'],
    [new TelegramError('Bad Request: unrecognized '+secret,400,false),'unknown'],
    [Object.assign(new Error('Unconfirmed Telegram result '+secret),{code:'result_unconfirmed'}),'result_unconfirmed'],
  ];
  for(const [error,reason] of cases) {
    assert.equal(classifyUnbanFailure(error),reason);
    for(const language of ['sw','en']){
      const reply=sample(error,language);
      assert.doesNotMatch(reply,/MY_SECRET_BOT_TOKEN|Bad Request|Bad Gateway|unrecognized/);
      assert.match(reply,/Telegram/);
      assert.ok(reply.length<4096);
    }
  }
});

test('unknown error never implies success and preserves manual owner fallback',()=>{
  const text=sample(new Error('raw exception'));
  assert.match(text,/not confirmed/i);
  assert.match(text,/owner\/admin/);
  assert.match(text,/Removed Users\/Banned Users/);
  assert.doesNotMatch(text,/raw exception/);
});
