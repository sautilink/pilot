import { ensureSchemaFamily } from './schema-ready.js';
import { createOwnerAuth } from './owner-auth.js';
import { createToolsStore, fail, objectKeys, validActor } from './tools-store.js';

export const PERFORMANCE_RELEASE = '2026-10-22-care.1';
export const PERFORMANCE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pilot_performance_buckets (
  bucket INTEGER NOT NULL, route TEXT NOT NULL, release TEXT NOT NULL, kind TEXT NOT NULL,
  samples INTEGER NOT NULL DEFAULT 0, errors INTEGER NOT NULL DEFAULT 0, retries INTEGER NOT NULL DEFAULT 0,
  slow INTEGER NOT NULL DEFAULT 0, queue_ms INTEGER NOT NULL DEFAULT 0, db_ms INTEGER NOT NULL DEFAULT 0,
  telegram_ms INTEGER NOT NULL DEFAULT 0, total_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(bucket,route,release,kind)
);
CREATE TABLE IF NOT EXISTS pilot_performance_histograms (
  bucket INTEGER NOT NULL, route TEXT NOT NULL, release TEXT NOT NULL,
  metric TEXT NOT NULL, upper_ms INTEGER NOT NULL, observations INTEGER NOT NULL,
  PRIMARY KEY(bucket,route,release,metric,upper_ms)
);
CREATE TABLE IF NOT EXISTS pilot_performance_preferences (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1), alerts_enabled INTEGER NOT NULL DEFAULT 0,
  language TEXT NOT NULL DEFAULT 'en', last_alert_at INTEGER NOT NULL DEFAULT 0,
  last_alert_status TEXT, updated_at INTEGER NOT NULL
);
`;
const ROUTES = new Set(['telegram','control','broadcast','broadcast_wake','broadcast_alarm','tools','tools_wake','integration','webhook']);
const BOUNDS = [25,50,100,250,500,1000,2000,5000,10000,30000,60000,300000];
const METRICS = ['total_ms','queue_ms','db_ms','telegram_ms','first_reply_ms','first_action_ms'];
const MAX_MS = 3600000;
const OVERFLOW_BUCKET = MAX_MS + 1;
const duration = n => Number.isFinite(n) && n >= 0 ? Math.min(MAX_MS,Math.round(n)) : null;
const isSlow = row => row.queue_ms >= 250 || row.handling_ms >= 1000;
export function performancePercentile(rows, fraction) {
  const total=rows.reduce((sum,row)=>sum+Number(row.observations),0);
  if(!total)return null;
  let seen=0;
  for(const row of [...rows].sort((a,b)=>a.upper_ms-b.upper_ms)) {
    seen+=Number(row.observations);
    if(seen>=Math.ceil(total*fraction))return {upperMs:Number(row.upper_ms)===OVERFLOW_BUCKET?BOUNDS.at(-1):Number(row.upper_ms),overflow:Number(row.upper_ms)===OVERFLOW_BUCKET};
  }
  return null;
}

export function createPerformanceService({db,api,owner,clock=()=>Math.floor(Date.now()/1000)}) {
  const ensure=()=>ensureSchemaFamily(db,'performance',PERFORMANCE_SCHEMA_SQL,'1');
  const auth=owner||createOwnerAuth({db,clock});
  const first=(sql,...args)=>db.prepare(sql).bind(...args).first();
  const all=async(sql,...args)=>(await db.prepare(sql).bind(...args).all()).results||[];
  async function authorize(actor) {validActor(actor);if(!await auth.isOwner(actor))fail('forbidden',403);}
  async function record(row,{sampled=false}={}) {
    if(!row||!ROUTES.has(row.route)||!['ok','retry','error'].includes(row.outcome))return;
    const slow=isSlow(row),issue=slow||row.outcome!=='ok';
    if(!sampled&&!issue)return;
    const values={total_ms:duration(row.queue_ms+row.handling_ms),...Object.fromEntries(METRICS.slice(1).map(key=>[key,duration(row[key])]))};
    if(values.total_ms===null||values.queue_ms===null||values.db_ms===null||values.telegram_ms===null)return;
    await ensure();
    const bucket=Math.floor(clock()/300)*300,statements=[];
    for(const kind of [...(sampled?['sample']:[]),...(issue?['issue']:[])])statements.push(db.prepare(`INSERT INTO pilot_performance_buckets
      (bucket,route,release,kind,samples,errors,retries,slow,queue_ms,db_ms,telegram_ms,total_ms)
      VALUES(?,?,?,?,1,?,?,?,?,?,?,?) ON CONFLICT(bucket,route,release,kind) DO UPDATE SET
      samples=samples+1,errors=errors+excluded.errors,retries=retries+excluded.retries,slow=slow+excluded.slow,
      queue_ms=queue_ms+excluded.queue_ms,db_ms=db_ms+excluded.db_ms,telegram_ms=telegram_ms+excluded.telegram_ms,total_ms=total_ms+excluded.total_ms`)
      .bind(bucket,row.route,PERFORMANCE_RELEASE,kind,Number(row.outcome==='error'),Number(row.outcome==='retry'),Number(slow),values.queue_ms,values.db_ms,values.telegram_ms,values.total_ms));
    if(sampled)for(const [metric,value]of Object.entries(values))if(value!==null)statements.push(db.prepare(`INSERT INTO pilot_performance_histograms(bucket,route,release,metric,upper_ms,observations)
      VALUES(?,?,?,?,?,1) ON CONFLICT(bucket,route,release,metric,upper_ms) DO UPDATE SET observations=observations+1`)
      .bind(bucket,row.route,PERFORMANCE_RELEASE,metric,BOUNDS.find(bound=>value<=bound)??OVERFLOW_BUCKET));
    await db.batch(statements);
  }
  async function query({actor,input={}}) {
    await authorize(actor);objectKeys(input,['hours','route']);
    const hours=input.hours??24,route=input.route??'telegram';
    if(![1,6,24,168].includes(hours)||!ROUTES.has(route))fail('invalid_input');
    await ensure();const since=Math.floor((clock()-hours*3600)/300)*300;
    const [summary,histogram,timeline,prefs,releases,issues]=await Promise.all([
      first(`SELECT SUM(samples) AS samples,SUM(errors) AS errors,SUM(retries) AS retries,SUM(slow) AS slow,
        SUM(queue_ms) AS queue_ms,SUM(db_ms) AS db_ms,SUM(telegram_ms) AS telegram_ms,SUM(total_ms) AS total_ms
        FROM pilot_performance_buckets WHERE kind='sample' AND route=? AND bucket>=?`,route,since),
      all('SELECT metric,upper_ms,SUM(observations) AS observations FROM pilot_performance_histograms WHERE route=? AND bucket>=? GROUP BY metric,upper_ms ORDER BY upper_ms',route,since),
      all(`SELECT CAST(bucket/3600 AS INTEGER)*3600 AS hour,SUM(samples) AS samples,SUM(total_ms) AS total_ms,SUM(errors) AS errors,SUM(retries) AS retries FROM pilot_performance_buckets
        WHERE kind='sample' AND route=? AND bucket>=? GROUP BY hour ORDER BY hour DESC LIMIT 168`,route,since),
      first('SELECT alerts_enabled,language,last_alert_at,last_alert_status FROM pilot_performance_preferences WHERE singleton=1'),
      all(`SELECT release,SUM(samples) AS samples,SUM(total_ms) AS total_ms FROM pilot_performance_buckets WHERE kind='sample' AND route=? AND bucket>=? GROUP BY release ORDER BY MAX(bucket) DESC LIMIT 5`,route,since),
      first(`SELECT SUM(samples) AS observations,SUM(errors) AS errors,SUM(retries) AS retries,SUM(slow) AS slow FROM pilot_performance_buckets WHERE kind='issue' AND route=? AND bucket>=?`,route,since),
    ]);
    const n=Number(summary?.samples||0),average=key=>n?Math.round(Number(summary[key]||0)/n):null;
    return {ok:true,checkedAt:clock(),hours,route,release:PERFORMANCE_RELEASE,sampleRate:0.02,samples:n,
      averages:Object.fromEntries(['total_ms','queue_ms','db_ms','telegram_ms'].map(key=>[key,average(key)])),
      sampleErrors:Number(summary?.errors||0),sampleRetries:Number(summary?.retries||0),
      percentiles:Object.fromEntries(METRICS.map(metric=>{const rows=histogram.filter(row=>row.metric===metric);return [metric,{observations:rows.reduce((sum,row)=>sum+Number(row.observations),0),p50:performancePercentile(rows,.5),p95:performancePercentile(rows,.95)}];})),
      issues:{observations:Number(issues?.observations||0),errors:Number(issues?.errors||0),retries:Number(issues?.retries||0),slow:Number(issues?.slow||0)},
      timeline:timeline.reverse().map(row=>({...row,averageMs:row.samples?Math.round(row.total_ms/row.samples):null})),
      releases:releases.map(row=>({release:row.release,samples:row.samples,averageMs:row.samples?Math.round(row.total_ms/row.samples):null})),
      preferences:{alerts:!!prefs?.alerts_enabled,language:prefs?.language||'en',lastAlertAt:prefs?.last_alert_at||null,lastAlertStatus:prefs?.last_alert_status||null}};
  }
  async function perform(payload) {
    const {actor,input={},requestId}=payload;await authorize(actor);objectKeys(input,['alerts','language']);
    if(typeof input.alerts!=='boolean'||!['en','sw'].includes(input.language??'en'))fail('invalid_input');
    await ensure();const operations=createToolsStore(db);await operations.ensure();
    const replay=await operations.claim({...payload,chatId:'__pilot_performance__'},clock());if(replay)return replay;
    return operations.finish(requestId,{ok:true,alerts:input.alerts},clock(),[db.prepare(`INSERT INTO pilot_performance_preferences(singleton,alerts_enabled,language,updated_at)
      VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET alerts_enabled=excluded.alerts_enabled,language=excluded.language,updated_at=excluded.updated_at`)
      .bind(Number(input.alerts),input.language??'en',clock())]);
  }
  async function monitor() {
    await ensure();const now=clock(),prefs=await first('SELECT * FROM pilot_performance_preferences WHERE singleton=1');
    if(prefs?.last_alert_status==='sending'&&prefs.last_alert_at<=now-120) {
      // Delivery may have reached Telegram before a previous process stopped.
      // Reconcile the display without repeating an uncertain notification.
      await db.prepare("UPDATE pilot_performance_preferences SET last_alert_status='unknown' WHERE singleton=1 AND last_alert_status='sending' AND last_alert_at=?").bind(prefs.last_alert_at).run();
      prefs.last_alert_status='unknown';
    }
    if(!prefs?.alerts_enabled||prefs.last_alert_at>now-3600)return {status:'idle'};
    const row=await first(`SELECT SUM(errors+retries) AS errors,SUM(slow) AS slow FROM pilot_performance_buckets WHERE route='telegram' AND kind='issue' AND bucket>=?`,Math.floor((now-600)/300)*300);
    if(Number(row?.errors||0)<3&&Number(row?.slow||0)<5)return {status:'quiet'};
    const bound=await auth.status();if(!bound.bound)return {status:'unbound'};
    const claimed=await db.prepare(`UPDATE pilot_performance_preferences SET last_alert_at=?,last_alert_status='sending' WHERE singleton=1 AND alerts_enabled=1 AND last_alert_at<=?`).bind(now,now-3600).run();
    if(!Number(claimed.meta?.changes??claimed.changes??0))return {status:'claimed'};
    const sw=prefs.language==='sw';
    const text=sw?`Pilot · Tahadhari ya speed\n\nKatika takriban dakika 10: ${Number(row.slow||0)} shughuli zilizochelewa, ${Number(row.errors||0)} errors/retries.\n\nFungua /performance kuona vipimo. Unaweza kuzima tahadhari kwenye paneli.`:
      `Pilot · Performance alert\n\nIn approximately 10 minutes: ${Number(row.slow||0)} slow operations, ${Number(row.errors||0)} errors/retries.\n\nOpen /performance for measurements. You can turn alerts off in the panel.`;
    let status='unknown';
    try {const sent=await api.call('sendMessage',{chat_id:Number(bound.userId),text,link_preview_options:{is_disabled:true}});if(Number.isSafeInteger(sent?.message_id)&&sent.message_id>0)status='sent';}
    catch(error){if(error.ambiguous===false)status='failed';}
    await db.prepare('UPDATE pilot_performance_preferences SET last_alert_status=? WHERE singleton=1 AND last_alert_at=?').bind(status,now).run();
    return {status};
  }
  async function cleanup(now=clock()) {await ensure();await db.batch(['pilot_performance_buckets','pilot_performance_histograms'].map(table=>db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE bucket<? LIMIT 5000)`).bind(now-7*86400)));}
  return {ensure,record,query,perform,monitor,cleanup};
}
