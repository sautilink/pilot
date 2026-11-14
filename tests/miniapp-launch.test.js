import test from 'node:test';
import assert from 'node:assert/strict';
import {miniAppLaunchData,miniAppTelegramContext} from '../src/miniapp-launch.js';

const SIGNED='auth_date=1794620000&user=%7B%22id%22%3A101%7D&hash='+ 'a'.repeat(64);
const launch='https://pilot.sautilink.com/app?tab=settings#tgWebAppData='+encodeURIComponent(SIGNED)+'&tgWebAppVersion=9.0&tgWebAppPlatform=android';

test('official Telegram bridge initData wins over URL fragment and remains opaque',()=>{
  assert.equal(miniAppLaunchData({initData:'signed-by-bridge'},launch),'signed-by-bridge');
  assert.equal(miniAppLaunchData({initData:''},launch),SIGNED);
  assert.equal(miniAppLaunchData(null,launch),SIGNED);
  assert.equal(miniAppTelegramContext(null,launch),true);
});
test('without Telegram signed data, never authenticate via user hints or URL query',()=>{
  for(const url of [
    'https://pilot.sautilink.com/app',
    'https://pilot.sautilink.com/app?tgWebAppData='+encodeURIComponent(SIGNED),
    'https://pilot.sautilink.com/app#tgWebAppData=unsigned',
    'https://pilot.sautilink.com/app#tgWebAppData='+encodeURIComponent(SIGNED)+'&tgWebAppData=duplicate',
    'https://pilot.sautilink.com/app#tgWebAppData='+encodeURIComponent('x'.repeat(17000)),
    'not a URL'
  ]) assert.equal(miniAppLaunchData({initData:'',initDataUnsafe:{user:{id:101}}},url),'');
  assert.equal(miniAppTelegramContext({platform:'android'},'https://pilot.sautilink.com/app'),true);
  assert.equal(miniAppTelegramContext({platform:'unknown'},'https://pilot.sautilink.com/app'),false);
  assert.equal(miniAppTelegramContext(null,'https://pilot.sautilink.com/app'),false);
  assert.equal(miniAppTelegramContext(null,'https://pilot.sautilink.com/app','Mozilla/5.0 Telegram/11.0'),true);
  assert.equal(miniAppTelegramContext(null,'https://pilot.sautilink.com/app','',true),true);
  assert.equal(miniAppLaunchData(null,'https://pilot.sautilink.com/app'),'', 'browser context alone never authorizes the API');
});
test('recovered launch data is still passed as signed raw initData to backend HMAC validation',()=>{
  const data=miniAppLaunchData(null,launch);
  assert.equal(new URLSearchParams(data).get('hash'),'a'.repeat(64));
  assert.equal(new URLSearchParams(data).get('user'),'{"id":101}');
  assert.equal(data.includes('auth_date='),true);
  // Fallback deliberately has no permission to trust any of these fields.
  assert.equal(typeof miniAppLaunchData(null,launch),'string');
});
