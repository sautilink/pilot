import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {renderDashboard} from '../src/dashboard.js';
import {renderToolsPage} from '../src/tools-page.js';
import {MINIAPP_LOADING_CSS,miniAppLoadingMarkup,createMiniAppLoading} from '../src/miniapp-loading.js';

test('both Mini Apps contain accessible branded loading and 2-language waiting text',()=>{
  for(const [render,id] of [[renderDashboard,'pilot-startup-loading'],[renderToolsPage,'pilot-tools-startup-loading']]){
    for(const lang of ['sw','en']){
      const page=render({lang});
      assert.match(page,new RegExp('id="'+id+'"[^>]*aria-busy="true" hidden'));
      assert.match(page,new RegExp('id="'+id+'-slow"[^>]*hidden'));
      assert.match(page,lang==='en'?/Please wait…/:/Tafadhali subiri…/);
      assert.match(page,/SautiLink <span>Pilot<\/span>/);
      assert.match(page,/pilot-loading-spin/);
      assert.match(page,/pilot-loading-progress/);
      assert.match(page,/createMiniAppLoading/);
    }
  }
  assert.match(MINIAPP_LOADING_CSS,/prefers-reduced-motion:reduce/);
  assert.doesNotMatch(MINIAPP_LOADING_CSS,/fonts.googleapis.com|https?:\/\//);
});

test('loader reveals wait feedback and closes only on explicit finished outcome',()=>{
  const nodes=new Map();
  for(const id of ['pilot-startup-loading','pilot-startup-loading-slow'])nodes.set(id,{hidden:true});
  const scheduled=[],cancelled=[];
  const doc={getElementById:id=>nodes.get(id)};
  const timers={setTimeout:(fn,ms)=>{scheduled.push({fn,ms});return scheduled.length;},clearTimeout:id=>cancelled.push(id)};
  // Helpers are deliberately dependency-free: inject the browser stubs in VM.
  const loader=vm.runInNewContext('('+createMiniAppLoading.toString()+')("pilot-startup-loading")',{
    document:doc,setTimeout:timers.setTimeout,clearTimeout:timers.clearTimeout
  });
  loader.show();
  assert.equal(nodes.get('pilot-startup-loading').hidden,false);
  assert.equal(nodes.get('pilot-startup-loading-slow').hidden,true);
  assert.equal(scheduled[0].ms,8000);
  scheduled[0].fn();
  assert.equal(nodes.get('pilot-startup-loading-slow').hidden,false);
  loader.hide();
  assert.equal(nodes.get('pilot-startup-loading').hidden,true);
  assert.equal(nodes.get('pilot-startup-loading-slow').hidden,true);
  loader.show();loader.hide();scheduled.at(-1).fn();
  assert.equal(nodes.get('pilot-startup-loading-slow').hidden,true);
});
