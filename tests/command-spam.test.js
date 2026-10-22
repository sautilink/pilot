import test from 'node:test';
import assert from 'node:assert/strict';
import {detectCommandSpam,normalizeCommandExceptions} from '../src/command-spam.js';

const NAME='zTwNCWkqQtZ2UaBbYTVvyPRKI1KawCiwB6yVwDkEXYT14Y0HmKu6YI0qT';
const TAG=`/${NAME}`;

test('full long slash tokens are detected independently of Telegram entity length',()=>{
  assert.deepEqual(detectCommandSpam({text:TAG,entities:[{type:'bot_command',offset:0,length:33}]}),{source:'text',count:1,longest:NAME.length});
  assert.deepEqual(detectCommandSpam({caption:` ${TAG}\n${TAG}@MusicBot `}),{source:'caption',count:2,longest:NAME.length});
  assert.equal(detectCommandSpam({text:`/${'a'.repeat(32)}`}),null);
  assert.ok(detectCommandSpam({text:`/${'a'.repeat(33)}`}));
});

test('ordinary Pilot and third-party commands, including long and slash-prefixed arguments, pass',()=>{
  for(const text of ['/start','/help@sautilinkpilotbot','/unknowncommand@MusicBot',`/start ${NAME}`,`/play ${TAG}`,`/play@MusicBot ${TAG}`,'/play jina la wimbo']) {
    assert.equal(detectCommandSpam({text}),null,text);
  }
});

test('ordinary prose, paths, hashtags, mentions and code samples are outside this narrow filter',()=>{
  for(const text of ['@juma','#habari','/usr/local/bin',`Maelezo kuhusu ${TAG}`,`Use ${TAG} to fetch a file`,`${TAG} maelezo`,'`'+TAG+'`']) assert.equal(detectCommandSpam({text}),null,text);
  for(const type of ['code','pre']) {
    assert.equal(detectCommandSpam({text:TAG,entities:[{type,offset:0,length:TAG.length}]}),null);
    assert.equal(detectCommandSpam({caption:TAG,caption_entities:[{type,offset:0,length:TAG.length}]}),null);
    assert.ok(detectCommandSpam({text:TAG,entities:[{type,offset:0,length:1}]}),'formatting only the slash cannot exempt the token');
  }
});

test('an arbitrary bot suffix cannot exempt a long unwanted command',()=>{
  for(const suffix of ['@MusicBot','@unknownbot','@fake','@'+'x'.repeat(40)]) assert.ok(detectCommandSpam({text:TAG+suffix}));
});

test('exceptions preserve opaque name case and bind bot targets exactly',()=>{
  const rule=normalizeCommandExceptions(` ${TAG}\r\n/get_*@MusicBot\n${TAG}\n`);
  assert.equal(rule,`${TAG}\n/get_*@musicbot`);
  assert.equal(detectCommandSpam({text:TAG},rule),null);
  assert.ok(detectCommandSpam({text:TAG.toLowerCase()},rule));
  assert.ok(detectCommandSpam({text:TAG+'@MusicBot'},rule),'targetless exception does not exempt a targeted token');
  assert.equal(detectCommandSpam({text:`/get_${NAME}@MUSICBOT`},rule),null);
  assert.ok(detectCommandSpam({text:`/get_${NAME}@anotherbot`},rule));
  assert.ok(detectCommandSpam({text:`/get_${NAME}`},rule));
  assert.equal(detectCommandSpam({text:`/get_${NAME}`},'/get_*'),null);
});

test('one allowed long token cannot conceal another unwanted long token',()=>{
  assert.ok(detectCommandSpam({text:`${TAG} /${'b'.repeat(40)}`},TAG));
  assert.ok(detectCommandSpam({text:`${TAG} /help`}));
});

test('exception validation rejects unrestricted patterns, malformed targets and excessive input',()=>{
  for(const value of [null,[],{},'/*','/ab*','/a.b','/get_*@foo','/get_*@longbotusernamewhichismorethan32charactersbot','/get_**','/get_* anywhere','/get_*/more','https://example.com',`/${'a'.repeat(129)}`,`/${'a'.repeat(33)}*`,Array.from({length:21},(_,i)=>`/cmd${i}`).join('\n'),'a'.repeat(2001)]) {
    assert.throws(()=>normalizeCommandExceptions(value),String(value));
  }
  assert.equal(normalizeCommandExceptions(' \n\t '),'');
  assert.equal(normalizeCommandExceptions('/abc*\n/'+ 'a'.repeat(128)), '/abc*\n/'+ 'a'.repeat(128));
});

test('invalid stored exceptions do not act as a broad allowlist',()=>{
  for(const value of ['/*','/get_*\n/*',{},null]) assert.ok(detectCommandSpam({text:TAG},value));
});
