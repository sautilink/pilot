// Shared zero-dependency loading UI for both Telegram Mini Apps.
// Loading is shown only when signed initData exists. Auth is always server-side.
export const MINIAPP_LOADING_CSS = `
.pilot-loading{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:32px 22px;background:var(--page,#fff);color:var(--text,#1d1d1f);text-align:center;overflow:auto}
.pilot-loading[hidden]{display:none!important}
.pilot-loading-inner{width:100%;max-width:350px;display:flex;flex-direction:column;align-items:center;gap:12px}
.pilot-loading-brand{font-size:clamp(24px,5.2vw,31px);font-weight:780;letter-spacing:-.055em;line-height:1.1}
.pilot-loading-brand span{color:var(--primary,#0066cc)}
.pilot-loading-eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-soft,#616166);font-weight:650}
.pilot-loading-spinner{width:38px;height:38px;border:3px solid var(--line,#dedee2);border-top-color:var(--primary,#0066cc);border-radius:50%;animation:pilot-loading-spin .82s linear infinite;margin:18px 0 6px}
.pilot-loading-title{font-size:18px;line-height:1.3;font-weight:680}
.pilot-loading-desc{font-size:13px;line-height:1.5;color:var(--text-soft,#616166);max-width:280px}
.pilot-loading-track{height:4px;width:min(210px,78%);overflow:hidden;border-radius:9px;background:var(--surface-raised,#e8e8ed);margin-top:12px}
.pilot-loading-pulse{width:40%;height:100%;border-radius:9px;background:var(--primary,#0066cc);animation:pilot-loading-progress 1.55s ease-in-out infinite alternate}
.pilot-loading-slow{font-size:12px;line-height:1.5;color:var(--text-soft,#616166);margin-top:10px}
.pilot-loading-retry{color:var(--primary,#0066cc);font-weight:650;text-decoration:underline;text-underline-offset:3px}
@keyframes pilot-loading-spin{to{transform:rotate(360deg)}}
@keyframes pilot-loading-progress{from{transform:translateX(-90%)}to{transform:translateX(240%)}}
@media(prefers-reduced-motion:reduce){.pilot-loading-spinner,.pilot-loading-pulse{animation:none}}
`;
export function miniAppLoadingMarkup(language='en',id='pilot-loading',kind='dashboard'){
  const en=language==='en';
  const work=kind==='tools'?(en?'Community tools':'Zana za community'):(en?'Control center':'Kituo cha udhibiti');
  const title=en?'Please wait…':'Tafadhali subiri…';
  const description=en?'Connecting securely and fetching your information.':'Tunaunganisha kwa usalama na kupakua taarifa zako.';
  const slow=en?'Still working. Telegram and group permissions may take longer to respond.':'Bado tunakamilisha. Telegram na ruhusa za group zinaweza kuchukua muda.';
  const retry=en?'Try opening again':'Jaribu kufungua tena';
  const botLink=kind==='tools'?'https://t.me/sautilinkpilotbot?start=tools':'https://t.me/sautilinkpilotbot?start=dashboard';
  return `<section id="${id}" class="pilot-loading" aria-label="${title}" aria-busy="true" hidden>
    <div class="pilot-loading-inner" role="status" aria-live="polite" aria-atomic="true">
      <div class="pilot-loading-brand">SautiLink <span>Pilot</span></div>
      <div class="pilot-loading-eyebrow">${work}</div>
      <div class="pilot-loading-spinner" aria-hidden="true"></div>
      <div class="pilot-loading-title">${title}</div>
      <p class="pilot-loading-desc">${description}</p>
      <div class="pilot-loading-track" aria-hidden="true"><div class="pilot-loading-pulse"></div></div>
      <p id="${id}-slow" class="pilot-loading-slow" hidden>${slow} <a class="pilot-loading-retry" href="${botLink}">${retry}</a></p>
    </div>
  </section>`;
}
// Timers only reveal truthful waiting feedback. They never imply auth success.
export function createMiniAppLoading(id){
  const panel=document.getElementById(id),slow=document.getElementById(id+'-slow');
  let delayed=null;
  function show(){
    if(!panel)return;
    if(delayed!==null)clearTimeout(delayed);
    panel.hidden=false;
    if(slow)slow.hidden=true;
    delayed=setTimeout(()=>{delayed=null;if(!panel.hidden&&slow)slow.hidden=false;},8000);
  }
  function hide(){
    if(delayed!==null){clearTimeout(delayed);delayed=null;}
    if(panel)panel.hidden=true;
    if(slow)slow.hidden=true;
  }
  return {show,hide};
}
