import test from 'node:test';
import assert from 'node:assert/strict';
import { TestD1 } from './helpers/d1.js';
import { applySchema } from '../src/store.js';
import { createCommunityService } from '../src/community-service.js';
import { createBroadcastStore } from '../src/broadcast-store.js';
import { renderCommunityDiscovery } from '../src/community-pages.js';

const CHAT=-1001122,ADMIN=21,MEMBER=31,BOT=900,NOW=1792670000;
const code=value=>error=>error.code===value;
async function fixture(t){
 const db=new TestD1();t.after(()=>db.close());await applySchema(db);let seq=0;const roles=new Map();
 const role=(user,status,chat=CHAT)=>roles.set(`${chat}:${user}`,{status});role(ADMIN,'administrator');role(BOT,'administrator');role(MEMBER,'member');
 const api={async call(method,input){if(method==='getMe')return{id:BOT};if(method==='getChatMember')return roles.get(`${input.chat_id}:${input.user_id}`)||{status:'left'};throw Error(method);}};
 const service=createCommunityService({db,api,clock:()=>NOW});
 const write=(action,input,user=ADMIN,chatId=CHAT)=>service.perform({actor:{id:user},chatId,action,input,requestId:`discovery-${++seq}`});
 const hub=(overrides={})=>({visibility:'public',slug:'study-club',title:'Study Club',description:'Learn with other people.',rules:'Be kind.',joinUrl:'https://t.me/studyclub',resources:[],language:'en',showFaq:false,...overrides});
 return{db,service,write,hub,role};
}

test('a public hub is excluded until a separate current admin opts in',async t=>{
 const f=await fixture(t);await f.write('hub_save',f.hub());assert.equal((await f.service.discover()).communities.length,0);
 await assert.rejects(f.write('discovery_save',{enabled:true,category:'education'},MEMBER),code('forbidden'));
 await f.write('discovery_save',{enabled:true,category:'education'});const result=await f.service.discover();assert.equal(result.communities.length,1);
 assert.deepEqual(Object.keys(result.communities[0]).sort(),['category','description','language','slug','title','url']);
 for(const key of ['chat_id','updated_by','user_id','join_url','reports','members'])assert.equal(JSON.stringify(result).includes(key),false);
});

test('private or unlisted hubs cannot opt in, and no join URL cannot list',async t=>{
 const f=await fixture(t);
 for(const visibility of ['private','unlisted']){await f.write('hub_save',f.hub({visibility}));await assert.rejects(f.write('discovery_save',{enabled:true,category:'education'}),code('public_hub_required'));}
 await f.write('hub_save',f.hub({joinUrl:''}));await assert.rejects(f.write('discovery_save',{enabled:true,category:'education'}),code('public_hub_required'));
});

test('unpublish, explicit opt-out and bot removal immediately hide a listing',async t=>{
 const f=await fixture(t);await f.write('hub_save',f.hub());await f.write('discovery_save',{enabled:true,category:'education'});
 await f.write('discovery_save',{enabled:false,category:'education'});assert.equal((await f.service.discover()).communities.length,0);
 await f.write('discovery_save',{enabled:true,category:'education'});await f.write('hub_save',f.hub({visibility:'unlisted'}));assert.equal((await f.service.discover()).communities.length,0);
 await f.write('hub_save',f.hub());assert.equal((await f.service.discover()).communities.length,0);
 await f.write('discovery_save',{enabled:true,category:'education'});await createBroadcastStore(f.db).recordMembership(CHAT,'left',NOW+1,99);assert.equal((await f.service.discover()).communities.length,0);
});

test('listing publication rechecks bot/admin authority and validates categories',async t=>{
 const f=await fixture(t);await f.write('hub_save',f.hub());
 await assert.rejects(f.write('discovery_save',{enabled:true,category:'all'}),code('invalid_discovery'));
 await assert.rejects(f.write('discovery_save',{enabled:true,category:'education',chat_id:-123}),code('invalid_input'));
 f.role(BOT,'left');await assert.rejects(f.write('discovery_save',{enabled:true,category:'education'}),code('bot_permission'));
 f.role(BOT,'administrator');f.role(ADMIN,'member');await assert.rejects(f.write('discovery_save',{enabled:true,category:'education'}),code('forbidden'));
});

test('directory supports bounded pagination, literal search and language/category filters',async t=>{
 const f=await fixture(t);
 for(let n=0;n<14;n++){const chat=CHAT-n;f.role(ADMIN,'administrator',chat);f.role(BOT,'administrator',chat);await f.write('hub_save',f.hub({slug:`study-club-${n}`,title:`Group ${String(n).padStart(2,'0')}`,language:n===0?'sw':'en'}),ADMIN,chat);await f.write('discovery_save',{enabled:true,category:n===0?'local':'education'},ADMIN,chat);}
 const first=await f.service.discover(),second=await f.service.discover({page:2});assert.equal(first.communities.length,12);assert.equal(first.hasNext,true);assert.equal(second.communities.length,2);assert.equal(second.hasNext,false);
 assert.equal((await f.service.discover({category:'local',language:'sw'})).communities.length,1);
 assert.equal((await f.service.discover({query:'Group 03'})).communities.length,1);
 assert.equal((await f.service.discover({query:'%'})).communities.length,0);
 assert.equal((await f.service.discover({query:"' OR 1=1 --"})).communities.length,0);
});

test('directory rendering is bilingual, escaped, no-store-ready and has real empty states',async()=>{
 const html=renderCommunityDiscovery({communities:[{slug:'study-club',title:'<script>evil()</script>',description:'<img src=x onerror=evil()>',language:'en',category:'education'}],query:'" onfocus="evil()',page:1,hasNext:true},{lang:'en'});
 assert.ok(html.includes('&lt;script&gt;evil()&lt;/script&gt;'));assert.ok(!html.includes('<script>evil()'));assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('data-theme-toggle'));
 assert.ok(html.includes('name="robots" content="noindex,follow"'));assert.ok(html.includes('/community/study-club'));assert.ok(html.includes('page=2'));
 const empty=renderCommunityDiscovery({communities:[]},{lang:'sw'});assert.ok(empty.includes('<html lang="sw">'));assert.ok(empty.includes('Jumuiya zitaonekana'));assert.ok(!empty.includes('community-card"><'));
 assert.ok(empty.includes('name="robots" content="index,follow"'));
});
