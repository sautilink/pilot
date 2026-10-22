import { formatAnnouncement } from './announcements.js';
import { fillTemplate, publicGroupRules } from './templates.js';

const APP_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;550;600;650;700;750;800&display=swap');
:root{color-scheme:dark;--bg:#080e17;--surface:#101d2b;--surface2:#162637;--ink:#eaf4ff;--muted:#8fa7bd;--line:#253a4d;--mint:#76dfd0;--blue:#8bbaff;--amber:#ebc594;--red:#f2aaac;--safe-top:var(--tg-content-safe-area-inset-top,0px)}
*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 85% 0,#173f5033,transparent 65%),var(--bg);font:14px/1.6 Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--ink);min-height:100vh;-webkit-font-smoothing:antialiased}button,input,select,textarea{font:inherit}button,a,input,select,textarea{touch-action:manipulation}button,a,summary{ -webkit-tap-highlight-color:transparent }button{cursor:pointer}button:disabled{opacity:.5;cursor:default}a{color:var(--mint);text-decoration:none}a:hover{text-decoration:underline}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid var(--blue);outline-offset:3px}[hidden]{display:none!important}h1,h2,h3,h4,p{margin:0}h1,h2,h3,h4{line-height:1.25;letter-spacing:-.04em}h1{font-size:clamp(25px,4.5vw,38px);font-weight:650}h2{font-size:21px;font-weight:600}h3{font-size:16px;font-weight:600}small{font-size:11px}code{font:11px/1.6 ui-monospace,SFMono-Regular,monospace;overflow-wrap:anywhere;color:#b5d7e8}.muted{color:var(--muted)}.eyebrow{text-transform:uppercase;letter-spacing:.16em;font-weight:650;font-size:9px;color:var(--mint)}.app-header{height:80px;display:flex;align-items:center;justify-content:space-between;gap:20px;padding:0 max(28px,calc((100vw - 1440px)/2));border-bottom:1px solid var(--line);background:#09111dd9}.brand{display:flex;gap:11px;align-items:center;color:var(--ink)}.brand svg{width:31px;height:31px;color:var(--mint)}.brand strong{font-size:18px;letter-spacing:-.04em;font-weight:700}.brand strong span{color:#9db5cd;font-weight:500}.brand small{display:block;font-size:8px;letter-spacing:.18em;color:#688aa4;text-transform:uppercase;margin-top:-3px}.header-right{display:flex;align-items:center;gap:17px}.language-toggle{display:flex;background:#0b1521;border:1px solid var(--line);padding:3px;border-radius:8px}.language-toggle button{min-height:31px;border:0;border-radius:5px;padding:3px 9px;background:transparent;color:var(--muted);font-size:10px;font-weight:700}.language-toggle button[aria-pressed=true]{background:#233b4e;color:#d9f4f2}.header-state{font-size:10px;color:#9db8c7;display:flex;align-items:center;gap:6px}.dot{width:6px;height:6px;background:var(--mint);border-radius:50%;display:inline-block;flex:none}.dot.off{background:var(--amber)}.shell{max-width:1440px;margin:auto;display:grid;grid-template-columns:236px minmax(0,1fr);min-height:calc(100vh - 80px)}.sidebar-inner{display:grid;gap:22px}.sidebar{border-right:1px solid var(--line);padding:28px 17px 22px;display:flex;flex-direction:column;gap:22px;background:#09131e88}.side-label{display:block;font-size:9px;text-transform:uppercase;letter-spacing:.15em;color:#6c8ba4;margin:0 12px 9px}.side-nav{display:grid;gap:4px}.nav-button{display:flex;align-items:center;gap:11px;text-align:left;width:100%;min-height:43px;padding:10px 12px;border-radius:8px;border:1px solid transparent;background:transparent;color:#8fa9bf;font-size:12px;white-space:nowrap}.nav-button svg{width:17px;height:17px;flex:none;color:#7392ac}.nav-button:hover{background:#142536}.nav-button[aria-current=page]{color:#d9f7f2;border-color:#365667;background:#193340}.nav-button[aria-current=page] svg{color:var(--mint)}.nav-count{margin-left:auto;background:#31515d;color:#bde8e1;border-radius:5px;font-size:9px;padding:0 5px}.sidebar-foot{margin-top:auto;padding:20px 12px 0;font-size:10px;line-height:1.8;color:#6f8a9e;border-top:1px solid var(--line)}.sidebar-foot a{font-size:10px;color:#9cb9c8}.workspace{padding:34px clamp(20px,3.5vw,48px) 45px;min-width:0}.workspace-top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:29px}.group-field{max-width:440px;min-width:0;flex:1}.group-field label{font-size:9px;color:#7795ab;letter-spacing:.14em;text-transform:uppercase;display:block;margin-bottom:7px}.group-picker{display:flex;gap:8px;align-items:center}.group-picker .group-select{flex:1;width:0}.group-picker button{flex:none}.group-select{max-width:100%;min-height:43px;border:1px solid #365267;background:#102332;color:#cfe3ef;border-radius:8px;padding:9px 35px 9px 13px;font-size:12px;width:100%;text-overflow:ellipsis}.button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:43px;padding:10px 16px;border:1px solid transparent;border-radius:8px;background:linear-gradient(120deg,#8bd5f8,#7adfce);color:#082532;font-size:12px;line-height:1.4;font-weight:700}.button:hover:not(:disabled){background:#a3e9e4}.button.secondary{background:#14283a;border-color:#355368;color:#cee2ef}.button.secondary:hover:not(:disabled){background:#1c3a4c}.button.ghost{background:transparent;border-color:#294355;color:#8fb0c4}.button.danger{background:#37252f;border-color:#69444f;color:#ffc2bf}.button.small{min-height:35px;padding:8px 11px;font-size:10px}.button svg{width:15px;height:15px}.title-row{display:flex;justify-content:space-between;align-items:flex-start;gap:22px;margin-bottom:24px}.title-row .eyebrow{margin-bottom:10px}.title-row p{font-size:12px;max-width:610px;color:var(--muted);margin-top:12px;line-height:1.8}.title-actions{display:flex;gap:8px;flex-wrap:wrap;flex:none;padding-top:20px}.badge{display:inline-flex;align-items:center;gap:6px;border:1px solid #2e5c5b;border-radius:5px;background:#143331;color:#91decf;font-size:9px;letter-spacing:.03em;padding:4px 7px;white-space:nowrap;line-height:1.35}.badge.warn{background:#342c23;border-color:#5c4b35;color:#e3c496}.badge.bad{background:#392831;border-color:#62414b;color:#efb0ad}.badge.neutral{background:#152b3e;border-color:#33516b;color:#a1c3df}.stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:22px}.stat{background:linear-gradient(130deg,#15283888,#0d1927);border:1px solid var(--line);border-radius:13px;padding:20px 22px;min-width:0}.stat-head{font-size:10px;color:#8eacbf;display:flex;align-items:center;justify-content:space-between;gap:10px}.stat-head svg{width:16px;height:16px;color:#5e91a9}.stat strong{display:block;font-size:35px;font-weight:550;line-height:1.3;letter-spacing:-.06em;margin:12px 0 5px;color:#c1eee6}.stat small{color:#6f8da4;font-size:10px}.main-grid{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(240px,1fr);gap:20px;align-items:start}.stack{display:grid;gap:18px}.card{border:1px solid var(--line);border-radius:13px;background:#0e1b2988;overflow:hidden;min-width:0}.card-head{display:flex;align-items:center;justify-content:space-between;gap:15px;padding:21px 23px;border-bottom:1px solid var(--line)}.card-head h2{font-size:15px}.card-head small{color:#7796ad;font-size:10px}.card-body{padding:22px 23px}.card-copy{color:var(--muted);font-size:12px;line-height:1.8;margin-top:9px}.list{display:grid}.list-item{padding:19px 23px;border-bottom:1px solid #253a4d99;min-width:0}.list-item:last-child{border-bottom:0}.item-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.item-title{font-size:12px;font-weight:600;overflow-wrap:anywhere}.item-meta{font-size:10px;line-height:1.8;color:#7d9cb1;margin-top:5px;overflow-wrap:anywhere}.item-badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}.item-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:15px}.item-message{font-size:12px;color:#bad0df;white-space:pre-wrap;overflow-wrap:anywhere;border-left:2px solid #36596b;padding-left:12px;margin:15px 0 0;line-height:1.8}.kv{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:11px 0;border-bottom:1px solid #253a4d88;font-size:11px}.kv:last-child{border:0}.kv-label{color:#8ca9bd}.kv-value{font-weight:550;text-align:right;color:#c7deeb}.empty{padding:36px 25px;text-align:center}.empty svg{width:29px;height:29px;color:#507c93;margin-bottom:12px}.empty h3{font-size:14px}.empty p{font-size:11px;color:#7f9eb4;line-height:1.8;max-width:400px;margin:10px auto 0}.empty .button{margin-top:17px}.info{display:flex;gap:11px;border:1px solid #2e4c60;background:#102838;border-radius:9px;padding:14px 16px;font-size:11px;line-height:1.8;color:#a3c4d5;margin-bottom:19px}.info svg{width:17px;height:17px;flex:none;color:#7cbbd0;margin-top:2px}.info.warn{border-color:#5b4935;background:#2a241c;color:#d8bc92}.info.bad{border-color:#60434b;background:#2d212a;color:#edb5b1}.info p{min-width:0}.setting-section{margin-bottom:20px}.setting-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px}.setting-heading h3{font-size:15px}.setting-heading p{margin-top:8px;font-size:11px;line-height:1.8;color:#8ca7bc;max-width:650px}.field-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:17px}.field{display:flex;flex-direction:column;gap:8px;margin-bottom:16px;min-width:0}.field>label{font-size:11px;font-weight:600;color:#bdd3e1}.field small{font-size:10px;color:#6e8fa6;line-height:1.8}.input{width:100%;min-width:0;min-height:43px;border:1px solid #314b60;border-radius:7px;background:#091622;color:var(--ink);padding:10px 12px;font-size:12px}.input:disabled{opacity:.55}textarea.input{resize:vertical;min-height:90px;line-height:1.8}.switch{display:inline-flex;align-items:center;gap:11px;cursor:pointer;font-size:12px;color:#c1d9e5}.switch input{width:17px;height:17px;margin:0;accent-color:var(--mint);flex:none}.setting-divider{border:0;border-top:1px solid var(--line);margin:25px 0}.form-footer{display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-top:7px}.form-footer p{font-size:10px;color:#7c9caf;max-width:510px;line-height:1.8}.preview{border:1px solid #315469;border-radius:10px;background:#102737;padding:17px;margin:8px 0 19px}.preview-label{font-size:8px;text-transform:uppercase;letter-spacing:.16em;color:#729fb6;margin-bottom:11px}.preview-copy{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;color:#c7dfec}.rule-value{font-size:12px;color:#a1ccdf;overflow-wrap:anywhere}.rule-kind{font-size:9px;text-transform:uppercase;letter-spacing:.1em;color:#6f91a7;margin-bottom:7px}.scope-preview{border-left:2px solid var(--mint);padding:9px 12px;background:#112b31;color:#a4d5d0;font-size:11px;line-height:1.8;margin-bottom:17px;overflow-wrap:anywhere}.baseline{display:flex;flex-wrap:wrap;gap:7px;margin-top:15px}.baseline span{font-size:10px;padding:5px 8px;border:1px solid #2a4758;border-radius:5px;background:#0b1e2b;color:#9cbccc;overflow-wrap:anywhere}.progress-row{margin-bottom:18px}.progress-row:last-child{margin-bottom:0}.progress-top{display:flex;justify-content:space-between;gap:10px;color:#8dabc0;font-size:10px;margin-bottom:8px}.progress-track{height:5px;border-radius:9px;background:#23394b;overflow:hidden}.progress-fill{height:100%;background:linear-gradient(90deg,#69b9cb,#79dfc9);border-radius:9px}.status-list{display:grid;gap:12px}.status-item{display:flex;align-items:flex-start;gap:10px;font-size:11px;color:#a3bece;line-height:1.7}.status-item .dot{margin-top:6px}.checker-results{margin-top:20px}.checker-result{border:1px solid #2d594f;background:#122c2a;border-radius:10px;padding:17px 18px;margin-bottom:10px}.checker-result.blocked{border-color:#60434d;background:#2c222b}.checker-result strong{display:block;font-size:12px;color:#a0e1ce}.checker-result.blocked strong{color:#e9b4af}.checker-result code{display:block;font-size:11px;line-height:1.9;margin:8px 0;color:#c8dde8}.checker-result p{font-size:11px;color:#8faeb9}.banner{max-width:1384px;margin:16px auto 0;padding:13px 18px;border:1px solid #34556a;border-radius:9px;font-size:12px;background:#122a3b;color:#b7d8e7;display:flex;align-items:center;justify-content:space-between;gap:15px}.banner.error{border-color:#78525a;background:#30232b;color:#efc0bb}.banner button{border:0;background:none;font-size:11px;color:inherit;cursor:pointer;padding:7px}.toast{position:fixed;bottom:calc(25px + env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%);width:max-content;max-width:calc(100% - 36px);z-index:12;border:1px solid #3c6b68;border-radius:10px;background:#153936;color:#ceeee5;padding:13px 20px;font-size:12px;box-shadow:0 12px 40px #0008}.loading{padding:65px 22px;text-align:center;color:#8ca8bc;font-size:12px}.spinner{width:24px;height:24px;border:2px solid #284251;border-top-color:var(--mint);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 17px}.login-shell{max-width:980px;margin:65px auto 55px;padding:0 25px}.login-card{position:relative;isolation:isolate;overflow:hidden;border:1px solid #305066;background:radial-gradient(ellipse at 80% 20%,#1a586955,transparent 60%),linear-gradient(135deg,#132737,#0c1827);border-radius:24px;padding:52px;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(230px,.7fr);align-items:center;gap:45px}.login-card:after{position:absolute;content:'';width:500px;height:500px;right:-240px;top:-220px;border:1px solid #46738866;border-radius:50%;box-shadow:0 0 0 50px #46738815,0 0 0 100px #4673880c;z-index:-1}.login-card h1{font-size:clamp(36px,6vw,55px);line-height:1.1;margin:19px 0}.login-card h1 span{color:#9ee7dc}.login-card p{color:#90b1c4;font-size:13px;line-height:1.95;max-width:430px}.login-card .button{margin-top:27px}.login-visual{width:100%;max-width:250px;justify-self:center;filter:drop-shadow(0 15px 35px #0006)}.login-foot{display:flex;justify-content:space-between;gap:22px;margin:21px 4px;font-size:11px;color:#6f90a5;line-height:1.8}.login-foot a{color:#9ac3d1}.login-features{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin-top:35px}.login-feature{border-top:1px solid #294657;padding-top:20px}.login-feature h2{font-size:14px;font-weight:550;margin:10px 0}.login-feature p{color:#7899af;font-size:11px;line-height:1.85}.login-feature svg{width:20px;height:20px;color:#6fb5c2}.modal{border:1px solid #3c5a6d;border-radius:17px;background:#0f2130;color:var(--ink);max-width:min(500px,calc(100% - 30px));width:100%;padding:27px;box-shadow:0 30px 100px #0008}.modal::backdrop{background:#030b14cf;backdrop-filter:blur(5px)}.modal h2{font-size:23px;margin-bottom:15px}.modal-copy{font-size:12px;line-height:1.85;color:#a2bece;white-space:pre-wrap}.modal-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:23px}.modal .field{margin-top:19px}.mobile-only{display:none}.footer-note{color:#5f8097;font-size:10px;margin-top:24px;line-height:1.8}.footer-note a{color:#8caebf}
@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;scroll-behavior:auto!important}}@media(max-width:1050px){.shell{grid-template-columns:205px minmax(0,1fr)}.sidebar{padding:23px 12px}.workspace{padding:28px 23px}.main-grid{grid-template-columns:1fr}.stat{padding:17px}.title-row{flex-wrap:wrap}.title-actions{padding-top:0}.login-card{padding:38px;gap:22px}}@media(max-width:720px){.app-header{height:68px;padding:0 19px}.brand strong{font-size:16px}.brand svg{width:27px;height:27px}.brand small{font-size:7px}.header-state{display:none}.header-right{gap:8px}.shell{display:block}.sidebar{border-right:0;border-bottom:1px solid var(--line);padding:14px 16px;display:block;position:sticky;top:0;background:#091522f2;backdrop-filter:blur(16px);z-index:4;overflow-x:auto}.sidebar-groups,.sidebar-personal{display:contents}.side-label,.sidebar-foot{display:none}.side-nav{display:inline-flex;gap:6px;vertical-align:middle}.sidebar-inner{display:flex;gap:10px;width:max-content}.nav-button{width:auto;min-height:42px;padding:8px 10px;font-size:10px;gap:7px}.nav-button svg{width:14px;height:14px}.nav-count{font-size:8px}.workspace{padding:24px 18px 38px}.workspace-top{margin-bottom:24px;gap:11px}.workspace-top .button{padding:10px;min-height:43px}.refresh-label{display:none}.workspace-top .button svg{width:17px;height:17px}.group-field{max-width:none}.title-row{gap:15px;margin-bottom:21px}.title-row p{font-size:11px;margin-top:10px}.title-row h1{font-size:28px}.title-actions{gap:8px}.stats{gap:9px;margin-bottom:17px}.stat{padding:14px 12px;border-radius:10px}.stat-head{font-size:9px}.stat-head svg{display:none}.stat strong{font-size:28px;margin:9px 0 5px}.stat small{font-size:8px;line-height:1.8;display:block}.main-grid{gap:16px}.card-head{padding:18px}.card-body,.list-item{padding:19px 18px}.card-head h2{font-size:14px}.field-grid{grid-template-columns:1fr;gap:0}.field{margin-bottom:17px}.form-footer{gap:15px}.form-footer .button{width:100%}.setting-heading{gap:12px}.setting-heading h3{font-size:14px}.item-top{gap:9px;flex-wrap:wrap}.item-actions .button{flex:1;min-width:100px;min-height:42px}.input,.group-select{font-size:16px}.item-title{font-size:12px}.badge{font-size:8px}.info{padding:13px 14px;font-size:10px}.empty{padding:28px 20px}.banner{margin:12px 18px 0;font-size:11px}.login-shell{margin:30px auto;padding:0 18px}.login-card{grid-template-columns:1fr;padding:31px 27px;gap:19px;border-radius:19px}.login-card h1{font-size:39px;margin:16px 0}.login-card p{font-size:12px}.login-visual{max-width:155px;grid-row:1;justify-self:start;margin-bottom:0}.login-card .button{width:100%;margin-top:23px}.login-card:after{right:-310px;top:-100px}.login-foot{flex-direction:column;gap:10px;font-size:10px}.login-features{grid-template-columns:1fr;gap:22px;margin-top:29px}.login-feature{padding-top:16px}.login-feature h2{display:inline-block;margin:0 0 10px 9px}.login-feature svg{vertical-align:middle}.modal{padding:24px 21px}.modal h2{font-size:21px}.modal-actions{flex-wrap:wrap}.modal-actions .button{flex:1}.mobile-only{display:block}}`;

export function dashboardRequestId(cryptoSource = globalThis.crypto) {
  if (typeof cryptoSource?.randomUUID === 'function') return cryptoSource.randomUUID();
  if (typeof cryptoSource?.getRandomValues !== 'function') throw new Error('Secure randomness unavailable');
  const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
  return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
}

const PLANE = '<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><path d="m57 7-17 51-11-23L7 24 57 7Z" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="m29 35 28-28M29 35l-2 16 10-11" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';

export function renderDashboard({ lang = 'sw' } = {}) {
  const language = lang === 'en' ? 'en' : 'sw';
  const t = (sw, en) => language === 'en' ? en : sw;
  const previewData = { notices: {}, rules: { sw: publicGroupRules({}, 'sw'), en: publicGroupRules({}, 'en') } };
  const sample = { user_id: 201, strike: 1, until_date: Math.floor(Date.now() / 1000) + 86400, reasons: '["link"]' };
  for (const locale of ['sw', 'en']) {
    previewData.notices[locale] = {};
    for (const style of ['detailed', 'compact', 'formal']) previewData.notices[locale][style] = formatAnnouncement(sample, { from: { first_name: 'Asha' }, chat: { title: 'Group' } }, true, locale, { notice_template: style }).plain;
  }
  return `<!doctype html><html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><meta name="theme-color" content="#080e17"><title>${t('Kituo cha udhibiti', 'Control center')} · SautiLink Pilot</title><script src="https://telegram.org/js/telegram-web-app.js?64"></script><style>${APP_STYLES}</style></head><body>
<header class="app-header"><a href="/" class="brand" aria-label="SautiLink Pilot">${PLANE}<div><strong>SautiLink <span>Pilot</span></strong><small>${t('Kituo cha udhibiti', 'Control center')}</small></div></a><div class="header-right"><span class="header-state" id="header-state"><i class="dot"></i>${t('Nafasi yako ya faragha', 'Your private workspace')}</span><div class="language-toggle" aria-label="Language"><button type="button" data-lang="sw" aria-pressed="${language === 'sw'}">SW</button><button type="button" data-lang="en" aria-pressed="${language === 'en'}">EN</button></div></div></header>
<div id="banner" class="banner" role="alert" hidden></div>
<main id="login" class="login-shell"><section class="login-card"><div><div class="eyebrow">${t('Utulivu unaanza hapa', 'A calmer group starts here')}</div><h1>${t('Group lako.<br><span>Udhibiti wako.</span>', 'Your group.<br><span>Your controls.</span>')}</h1><p>${t('Fungua kupitia Telegram kuona matukio yako, kukagua links au kusimamia groups unazoongoza. Pilot inathibitisha nafasi yako kabla ya kuonyesha taarifa.', 'Open through Telegram to see your cases, check links or manage the groups you lead. Pilot verifies your role before showing group information.')}</p><a class="button" href="https://t.me/sautilinkpilotbot?start=dashboard">${t('Fungua ndani ya Telegram', 'Open in Telegram')} <span aria-hidden="true">↗</span></a></div><svg class="login-visual" viewBox="0 0 280 280" fill="none" aria-hidden="true"><defs><linearGradient id="wing" x1="70" y1="70" x2="205" y2="210" gradientUnits="userSpaceOnUse"><stop stop-color="#a2ddff"/><stop offset="1" stop-color="#70dccc"/></linearGradient></defs><circle cx="140" cy="140" r="128" stroke="#376071" stroke-dasharray="4 9"/><circle cx="140" cy="140" r="101" stroke="#2c4e63"/><circle cx="140" cy="140" r="75" fill="#183b4b" fill-opacity=".5"/><path d="m213 70-43 145-38-65-65-34 146-46Z" fill="url(#wing)"/><path d="m132 150 81-80-65 99-16 34v-53Z" fill="#437e9f"/><path d="m132 150 16 19 22 46-38-65Z" fill="#a0eadd"/><circle cx="39" cy="140" r="4" fill="#7bdccb"/><circle cx="235" cy="54" r="3" fill="#87baff"/></svg></section><div class="login-foot"><span>${t('SW / EN · Kwa members na admins · Kila group na mipangilio yake', 'SW / EN · For members and admins · Each group has its own settings')}</span><a href="/privacy${language === 'en' ? '?lang=en' : ''}">${t('Faragha na taarifa zako', 'Privacy and your information')}</a></div><section class="login-features"><div class="login-feature">${PLANE}<h2>${t('Maamuzi yaliyo wazi', 'Clear decisions')}</h2><p>${t('Ona sababu ya hatua, muda wa adhabu na hali ya ujumbe wa taarifa.', 'See the reason for an action, its duration and the announcement status.')}</p></div><div class="login-feature">${PLANE}<h2>${t('Nafasi ya kusikilizwa', 'Room to be heard')}</h2><p>${t('Tuma rufaa yako kwa admins wa group na fuatilia jibu lao faraghani.', 'Send an appeal to your group admins and follow their decision privately.')}</p></div><div class="login-feature">${PLANE}<h2>${t('Usimamizi unaokufaa', 'Controls that fit')}</h2><p>${t('Admins huamua whitelist, ukaribisho, ulinzi wa spam na namna ya kupokea taarifa.', 'Admins choose the whitelist, welcomes, spam controls and the reports they receive.')}</p></div></section></main>
<div id="app" class="shell" hidden><aside id="sidebar" class="sidebar" aria-label="${t('Urambazaji', 'Navigation')}"></aside><main class="workspace"><div class="workspace-top"><div class="group-field" id="group-field"><label for="group-select">${t('Group unayosimamia', 'Group you manage')}</label><div class="group-picker"><select id="group-select" class="group-select"></select><button id="more-groups" class="button ghost small" type="button" hidden>${t('Zaidi', 'More')}</button></div></div><button id="refresh" class="button ghost" type="button" aria-label="${t('Sasisha taarifa', 'Refresh data')}"><span aria-hidden="true">↻</span><span class="refresh-label">${t('Sasisha', 'Refresh')}</span></button></div><div id="content" aria-live="polite"></div><p class="footer-note">${t('Taarifa za matukio za siku 30 za karibuni. Kila hatua ya admin huhakikiwa upya.', 'Incident information covers the last 30 days. Admin access is checked for every action.')} <a href="/privacy${language === 'en' ? '?lang=en' : ''}">${t('Faragha', 'Privacy')}</a></p></main></div><div id="toast" class="toast" role="status" hidden></div><dialog id="modal" class="modal"></dialog><script>(${dashboardClient.toString()})(${JSON.stringify(language)},${JSON.stringify(previewData)},${dashboardRequestId.toString()},${fillTemplate.toString()});</script></body></html>`;
}

function dashboardClient(initialLanguage, previewData, makeRequestId, fillTemplate) {
  'use strict';
  let language = initialLanguage;
  const t = (sw, en) => language === 'en' ? en : sw;
  const app = window.Telegram?.WebApp;
  const initData = app?.initData || '';
  const $ = id => document.getElementById(id);
  const state = { groups: [], groupsCursor: null, groupsLoading: false, chatId: null, overview: null, own: null, view: 'overview', busy: false, requestKeys: new Map(), reloadToken: 0, ownToken: 0 };
  const icons = {
    overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    incidents: 'M12 3 2 21h20L12 3Z M12 9v5 M12 17h.01',
    appeals: 'M21 11a8 8 0 0 1-8 8H6l-4 3V11a9 9 0 0 1 19 0Z M7 10h10 M7 14h6',
    settings: 'M4 7h16 M4 17h16 M9 4v6 M15 14v6',
    whitelist: 'm10 13 4-4 M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M14 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
    activity: 'M4 19V9 M10 19V4 M16 19v-7 M22 19V6',
    mystatus: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 21v-2a8 8 0 0 1 16 0v2',
    checklink: 'M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z m6-2 6 6 M6 10l3 3 5-6',
    joins: 'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M2 22v-3a7 7 0 0 1 14 0v3 M20 7v6 M17 10h6',
    refresh: 'M20 7v5h-5 M4 17v-5h5 M4 8a8 8 0 0 1 14-4l2 3 M20 16a8 8 0 0 1-14 4l-2-3',
    shield: 'M12 2 3 6v7c0 4 4 7 9 9 5-2 9-5 9-9V6l-9-4Z m-5 10 3 3 7-7',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 6v6l4 3',
  };
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', icons[name] || icons.shield); svg.append(path); return svg;
  }
  function el(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = String(text); return node; }
  function append(parent, ...children) { for (const child of children.flat()) if (child != null) parent.append(typeof child === 'string' ? document.createTextNode(child) : child); return parent; }
  function button(label, callback, kind = 'secondary', iconName) { const node = el('button', `button ${kind}`); node.type = 'button'; if (iconName) node.append(icon(iconName)); node.append(document.createTextNode(label)); if (callback) node.addEventListener('click', callback); return node; }
  function badge(text, tone = '') { return el('span', `badge ${tone}`, text); }
  function card(title, children = [], subtitle = '') { const box = el('section', 'card'); const head = el('div', 'card-head'); append(head, el('h2', '', title), subtitle ? el('small', '', subtitle) : null); append(box, head, ...children); return box; }
  function empty(title, description, action) { const box = el('div', 'empty'); append(box, icon('shield'), el('h3', '', title), el('p', '', description), action); return box; }
  function info(copy, tone = '') { const box = el('div', `info ${tone}`); append(box, icon('shield'), el('p', '', copy)); return box; }
  function timestamp(value) { return value ? new Intl.DateTimeFormat(language === 'en' ? 'en-GB' : 'sw-TZ', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Dar_es_Salaam' }).format(new Date(Number(value) * 1000)) + ' EAT' : '—'; }
  function reason(row) { return (row.reasons || []).map(value => value === 'link' ? t('Link isiyoruhusiwa', 'Unapproved link') : value === 'forward' ? t('Ujumbe wa forward', 'Forwarded message') : value).join(' · ') || t('Hatua ya usimamizi', 'Moderation action'); }
  function duration(row) { if (row.strike >= 3 || !row.until_date) return t('Ban ya kudumu', 'Permanent ban'); return row.strike === 2 ? t('Siku 7', '7 days') : t('Saa 24', '24 hours'); }
  function userLabel(id) { return `${t('Mtumiaji', 'User')} ${id || '—'}`; }
  function noticeLabel(status) { return ({ sent: t('Taarifa imetumwa', 'Announcement sent'), pending: t('Taarifa inasubiri', 'Announcement pending'), failed: t('Taarifa haikutumwa', 'Announcement failed'), unknown: t('Taarifa haijathibitishwa', 'Announcement unconfirmed'), cancelled: t('Taarifa imesitishwa', 'Announcement cancelled') })[status] || t('Hakuna taarifa iliyorekodiwa', 'No announcement recorded'); }
  function statusLabel(status) { return ({ confirmed: t('Imethibitishwa', 'Confirmed'), planned: t('Inashughulikiwa', 'Processing'), cancelled: t('Imesahihishwa / imesitishwa', 'Corrected / cancelled'), failed: t('Haikufanikiwa', 'Failed'), unknown: t('Inahitaji ukaguzi', 'Needs review'), open: t('Inasubiri uamuzi', 'Awaiting decision'), resolved: t('Imejibiwa', 'Resolved'), pending: t('Inasubiri', 'Pending'), challenged: t('Uthibitisho umetumwa', 'Verification sent'), review: t('Inahitaji admin', 'Needs an admin'), approved: t('Imekubaliwa', 'Approved'), declined: t('Imekataliwa', 'Declined') })[status] || String(status || '—'); }
  function decisionLabel(value) { return ({ keep: t('Adhabu imebakizwa', 'Action upheld'), unban: t('Ban imeondolewa; makosa yamebaki', 'Unbanned; strikes kept'), forgive: t('Kosa moja limesahihishwa; ban imebaki', 'One strike corrected; ban kept') })[value] || ''; }
  const errorText = code => {
    const key = String(code || '').toUpperCase();
    if (/AUTH|SESSION/.test(key)) return t('Kipindi hiki kimeisha au hakijathibitishwa. Funga paneli, kisha ifungue tena kupitia bot.', 'This session has expired or could not be verified. Close the panel and reopen it through the bot.');
    if (/ADMIN|FORBIDDEN|DENIED|NOT_MEMBER/.test(key)) return t('Huna ruhusa ya kufikia taarifa hizi kwa sasa. Hakikisha bado ni admin wa group hili.', 'You do not currently have access to this information. Check that you are still an admin of this group.');
    if (/CONFLICT|STALE|NEWER|NOT_CURRENT|ALREADY|REPLAY|UNKNOWN|IN_PROGRESS/.test(key)) return t('Hali ya tukio hili imebadilika au hatua ya awali bado inathibitishwa. Sasisha taarifa kabla ya kujaribu tena.', 'This case has changed or an earlier action is still being confirmed. Refresh the information before trying again.');
    if (/RATE|LIMIT/.test(key)) return t('Kikomo cha maombi kimefikiwa. Subiri kidogo kabla ya kujaribu tena.', 'The request limit has been reached. Wait a little before trying again.');
    if (/INVALID|VALIDATION|RULE|SETTING|TEMPLATE|PLACEHOLDER/.test(key)) return t('Kagua taarifa ulizoandika. Tumia chaguo na mipaka iliyoonyeshwa kwenye fomu.', 'Check the information you entered. Use the choices and limits shown in the form.');
    if (/NOT_FOUND|MISSING/.test(key)) return t('Taarifa hizi hazipo tena. Sasisha paneli.', 'This information is no longer available. Refresh the panel.');
    if (/PERMISSION/.test(key)) return t('Pilot hana ruhusa zinazohitajika. Kagua ruhusa zake kwenye group.', 'Pilot does not have the required permissions. Check its permissions in the group.');
    return t('Hatukuweza kuthibitisha ombi hili. Sasisha taarifa; usirudie hatua ikiwa hali yake bado haijulikani.', 'We could not confirm this request. Refresh the information; do not repeat an action while its outcome is unknown.');
  };
  function showError(error) { const box = $('banner'); box.replaceChildren(el('span', '', errorText(error?.code))); box.className = 'banner error'; box.append(button(t('Funga', 'Dismiss'), () => { box.hidden = true; }, 'ghost small')); box.hidden = false; }
  function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => { $('toast').hidden = true; }, 4200); }
  async function request(body) {
    const response = await fetch('/api/pilot', { method: 'POST', credentials: 'omit', cache: 'no-store', headers: { 'Content-Type': 'application/json', Authorization: `tma ${initData}` }, body: JSON.stringify(body) });
    let payload; try { payload = await response.json(); } catch { throw { code: 'UNAVAILABLE' }; }
    if (!response.ok || !payload.ok) throw { code: payload.error || 'UNAVAILABLE' };
    return payload.data;
  }
  function query(view, chatId = state.chatId, input = {}) { return request({ view, ...(chatId ? { chatId } : {}), input }); }
  async function mutate(action, input = {}, chatId = state.chatId) {
    const key = JSON.stringify({ action, input, chatId });
    if (!state.requestKeys.has(key)) state.requestKeys.set(key, makeRequestId());
    const result = await request({ action, chatId, input, requestId: state.requestKeys.get(key) });
    state.requestKeys.delete(key);
    return result;
  }
  async function perform(action, input, options = {}) {
    if (state.busy) return;
    state.busy = true;
    const targets = [...document.querySelectorAll('#content button,#modal button,#group-select,#more-groups,#refresh,[data-lang]')];
    targets.forEach(node => { node.disabled = true; });
    try {
      await mutate(action, input, options.chatId || state.chatId);
      $('banner').hidden = true; toast(options.success || t('Mabadiliko yamehifadhiwa.', 'Changes saved.'));
      await refreshData();
    } catch (error) { showError(error); }
    finally { state.busy = false; targets.forEach(node => { node.disabled = false; }); }
  }
  function confirmAction(title, description, label, callback, danger = false) {
    const modal = $('modal'); modal.replaceChildren();
    const heading = el('h2', '', title); heading.id = 'modal-title'; modal.setAttribute('aria-labelledby', 'modal-title');
    const actions = el('div', 'modal-actions');
    append(actions, button(t('Ghairi', 'Cancel'), () => modal.close(), 'secondary'), button(label, () => { modal.close(); callback(); }, danger ? 'danger' : ''));
    append(modal, heading, el('p', 'modal-copy', description), actions); modal.showModal();
  }
  function field(label, { name, value = '', type = 'text', maxLength, min, max, note = '', options, rows } = {}) {
    const box = el('div', 'field'); const id = `field-${name}`; const caption = el('label', '', label); caption.htmlFor = id;
    const input = el(options ? 'select' : rows ? 'textarea' : 'input', 'input'); input.id = id; input.name = name;
    if (options) for (const [value, label] of options) { const option = el('option', '', label); option.value = value; input.append(option); }
    else if (!rows) input.type = type;
    if (rows) input.rows = rows;
    if (maxLength) input.maxLength = maxLength;
    if (min !== undefined) input.min = min;
    if (max !== undefined) input.max = max;
    input.value = value ?? ''; append(box, caption, input, note ? el('small', '', note) : null); return { box, input };
  }
  function toggle(label, name, checked) { const box = el('label', 'switch'); const input = el('input'); input.type = 'checkbox'; input.name = name; input.checked = !!checked; append(box, input, el('span', '', label)); return { box, input }; }
  function sectionHeading(title, description, toggleControl) { const box = el('div', 'setting-heading'); const text = el('div'); append(text, el('h3', '', title), el('p', '', description)); append(box, text, toggleControl); return box; }
  function title(heading, description, actions = []) { const row = el('div', 'title-row'); const words = el('div'); append(words, el('div', 'eyebrow', state.overview && !['mystatus', 'checklink'].includes(state.view) ? state.overview.group.title : t('Nafasi yako ya faragha', 'Your private workspace')), el('h1', '', heading), el('p', '', description)); append(row, words, actions.length ? append(el('div', 'title-actions'), actions) : null); return row; }
  function kv(label, value) { return append(el('div', 'kv'), el('span', 'kv-label', label), typeof value === 'string' ? el('span', 'kv-value', value) : value); }
  function changeView(view) { if (state.busy) return; state.view = view; $('banner').hidden = true; render(); if (view === 'mystatus' && !state.own) loadOwn(); }
  function navigation() {
    const nav = $('sidebar'); nav.replaceChildren(); const inner = el('div', 'sidebar-inner');
    const groupItems = [['overview', t('Muhtasari', 'Overview')], ['incidents', t('Matukio', 'Incidents')], ['appeals', t('Rufaa', 'Appeals')], ['joins', t('Wanaojiunga', 'Join requests')], ['settings', t('Mipangilio', 'Settings')], ['whitelist', t('Links zinazoruhusiwa', 'Allowed links')], ['activity', t('Shughuli za admins', 'Admin activity')]];
    function navigationGroup(items, label, className) {
      const section = el('div', className); const list = el('nav', 'side-nav'); list.setAttribute('aria-label', label);
      for (const [name, label] of items) { const node = el('button', 'nav-button'); node.type = 'button'; if (state.view === name) node.setAttribute('aria-current', 'page'); append(node, icon(name), el('span', '', label)); const count = name === 'appeals' ? state.overview?.appeals.filter(item => item.status === 'open').length : 0; if (count) node.append(el('span', 'nav-count', count)); node.addEventListener('click', () => changeView(name)); list.append(node); }
      append(section, el('span', 'side-label', label), list); return section;
    }
    if (state.groups.length) inner.append(navigationGroup(groupItems, t('Usimamizi wa group', 'Group management'), 'sidebar-groups'));
    inner.append(navigationGroup([['mystatus', t('Matukio yangu', 'My cases')], ['checklink', t('Kagua link', 'Check a link')]], t('Zana zako', 'Your tools'), 'sidebar-personal'));
    const foot = el('div', 'sidebar-foot'); append(foot, el('p', '', t('Admins na channel iliyo linked huheshimiwa. Kila group lina historia yake.', 'Admins and the linked channel are respected. Each group has its own history.')), el('a', '', t('Fungua mwongozo ↗', 'Open the guide ↗'))); foot.lastChild.href = 'https://t.me/sautilinkpilotbot?start=help'; append(nav, inner, foot);
  }
  function renderGroupSelect() {
    const select = $('group-select'); select.replaceChildren();
    for (const group of state.groups) { const option = el('option', '', group.title); option.value = String(group.id); select.append(option); }
    if (!state.groups.length && state.groupsCursor) { const option = el('option', '', t('Tafuta groups nyingine', 'Find more groups')); option.value = ''; select.append(option); }
    select.disabled = state.groups.length === 0 || state.busy;
    if (state.chatId) select.value = state.chatId;
    $('more-groups').hidden = !state.groupsCursor;
    $('more-groups').disabled = state.groupsLoading || state.busy;
    $('more-groups').textContent = state.groupsLoading ? t('Inapakia…', 'Loading…') : t('Zaidi', 'More');
    $('more-groups').setAttribute('aria-label', t('Pakia groups nyingine unazosimamia', 'Load more groups you manage'));
    $('group-field').hidden = !(state.groups.length || state.groupsCursor) || (state.groups.length > 0 && ['mystatus', 'checklink'].includes(state.view));
  }
  function appendGroups(groups) {
    const known = new Set(state.groups.map(group => String(group.id)));
    for (const group of groups || []) if (!known.has(String(group.id))) { state.groups.push(group); known.add(String(group.id)); }
  }
  async function loadMoreGroups() {
    if (state.groupsLoading || state.busy || !state.groupsCursor) return;
    state.groupsLoading = true; renderGroupSelect();
    try {
      const data = await query('groups', null, { cursor: state.groupsCursor });
      appendGroups(data.groups); state.groupsCursor = data.nextCursor || null;
      const needsGroup = !state.chatId && state.groups.length;
      if (needsGroup) state.chatId = String(state.groups[0].id);
      navigation(); renderGroupSelect();
      if (needsGroup) await loadGroup({ preservePersonal: true });
      toast(t('Orodha ya groups imesasishwa.', 'Group list updated.'));
    } catch (error) { showError(error); }
    finally { state.groupsLoading = false; renderGroupSelect(); }
  }
  function incidentItem(row, { actions = false, personal = false } = {}) {
    const item = el('article', 'list-item'); const top = el('div', 'item-top'); const details = el('div');
    append(details, el('div', 'item-title', personal ? `${t('Group', 'Group')} ${row.chat_id}` : userLabel(row.user_id)), el('p', 'item-meta', `${timestamp(row.event_at)} · ${t('Tukio', 'Case')} ${row.id}`));
    append(top, details, badge(row.corrected ? t('Kosa limesahihishwa', 'Strike corrected') : statusLabel(row.status), row.status === 'confirmed' ? '' : 'neutral'));
    append(item, top, el('p', 'item-message', reason(row)), append(el('div', 'item-badges'), badge(`${t('Kosa', 'Strike')} ${row.strike}/3`, 'neutral'), badge(`${t('Hatua', 'Action')}: ${duration(row)}`, 'warn'), badge(noticeLabel(row.notification?.status), ['failed', 'unknown'].includes(row.notification?.status) ? 'warn' : 'neutral')));
    if (row.until_date) item.append(el('p', 'item-meta', `${t('Muda wa mwisho uliorekodiwa', 'Recorded end time')}: ${timestamp(row.until_date)}`));
    if (row.appeal) item.append(el('p', 'item-meta', `${t('Rufaa', 'Appeal')}: ${row.appeal.decision ? decisionLabel(row.appeal.decision) : statusLabel(row.appeal.status)}`));
    if (personal && !row.appeal && row.status === 'confirmed') item.append(append(el('div', 'item-actions'), button(t('Tuma rufaa', 'Submit an appeal'), () => appealDialog(row), 'secondary small')));
    if (actions && row.user_id && (row.status === 'confirmed' || row.corrected)) {
      const buttons = el('div', 'item-actions');
      buttons.append(button(t('Ondoa ban', 'Remove ban'), () => confirmAction(t('Ondoa ban ya tukio hili?', 'Remove this case’s ban?'), t('Mtumiaji ataweza kujiunga tena. Idadi ya makosa yake itabaki. Hatua itakataliwa ikiwa tukio jipya au uamuzi wa admin umebadilisha ban.', 'The user will be able to rejoin. Their strike count stays unchanged. This is rejected if a newer incident or admin decision has changed the ban.'), t('Ondoa ban', 'Remove ban'), () => perform('case_unban', { incidentId: row.id })), 'secondary small'));
      if (!row.corrected) buttons.append(button(t('Sahihisha kosa moja', 'Correct one strike'), () => confirmAction(t('Sahihisha kosa hili?', 'Correct this strike?'), t('Kosa moja tu la tukio hili litaondolewa kwenye hesabu. Ban iliyopo itaendelea; tumia “Ondoa ban” kama unataka pia kumruhusu kujiunga. Tukio lazima liwe la mwisho la mtumiaji.', 'Only this incident’s strike will be removed from the count. The current ban stays; use “Remove ban” if the user should also be allowed to rejoin. This must be the user’s latest incident.'), t('Sahihisha kosa', 'Correct strike'), () => perform('case_forgive', { incidentId: row.id })), 'ghost small'));
      item.append(buttons);
    }
    return item;
  }
  function renderOverview(content) {
    const data = state.overview; const enabled = data.moderation.enabled;
    content.append(title(t('Kila kitu, mbele yako.', 'Everything, in view.'), t('Fuatilia hatua za Pilot, sikiliza members na weka group katika mpangilio unaokufaa.', 'Follow Pilot’s actions, hear from your members and shape the settings for your group.'), [button(enabled ? t('Sitisha ulinzi', 'Pause moderation') : t('Washa ulinzi', 'Resume moderation'), () => confirmAction(enabled ? t('Sitisha usimamizi?', 'Pause moderation?') : t('Washa usimamizi?', 'Resume moderation?'), enabled ? t('Pilot atasitisha utekelezaji wa sheria kwenye group hili hadi admin awashe tena. Historia itabaki.', 'Pilot will pause enforcement in this group until an admin resumes it. History stays available.') : t('Sheria za links na forwards pamoja na vipengele ulivyowasha zitaanza kutumika tena.', 'Link and forward rules, together with the features you enabled, will apply again.'), enabled ? t('Sitisha', 'Pause') : t('Washa', 'Resume'), () => perform(enabled ? 'pause' : 'resume', {})), 'secondary', 'shield')]));
    if (!data.moderation.permissionsComplete) content.append(info(t('Pilot hana ruhusa zote za kufuta ujumbe na kufungia members. Kagua ruhusa zake za admin kwenye Telegram.', 'Pilot is missing permissions to delete messages or ban members. Check its admin permissions in Telegram.'), 'warn'));
    if (!enabled) content.append(info(t('Usimamizi umesitishwa na admin. Taarifa na mipangilio bado zinapatikana.', 'Moderation is paused by an admin. Information and settings remain available.'), 'warn'));
    const stats = el('div', 'stats');
    for (const [key, label] of [['today', t('Leo', 'Today')], ['week', t('Siku 7', '7 days')], ['month', t('Siku 30', '30 days')]]) {
      const values = data.stats[key] || {}; const stat = el('div', 'stat'); append(stat, append(el('div', 'stat-head'), el('span', '', label), icon('clock')), el('strong', '', Number(values.incidents || 0)), el('small', '', `${Number(values.confirmed || 0)} ${t('hatua zimethibitishwa', 'confirmed actions')}`)); stats.append(stat);
    }
    content.append(stats);
    const grid = el('div', 'main-grid'); const left = el('div', 'stack');
    const recent = el('div', 'list'); for (const row of data.incidents.slice(0, 4)) recent.append(incidentItem(row)); if (!data.incidents.length) recent.append(empty(t('Group lina nafasi ya kupumua.', 'Room for conversation.'), t('Hakuna tukio lililorekodiwa katika siku 30 zilizopita.', 'No incidents have been recorded in the last 30 days.')));
    const recentCard = card(t('Matukio ya karibuni', 'Recent incidents'), [recent]); recentCard.firstChild.append(button(t('Ona yote', 'View all'), () => changeView('incidents'), 'ghost small')); left.append(recentCard);
    const pending = data.appeals.filter(row => row.status === 'open').length;
    if (pending) left.append(info(t(`Rufaa ${pending} zinasubiri uamuzi wako. Fungua sehemu ya Rufaa kuzisoma.`, `${pending} appeals are waiting for a decision. Open Appeals to review them.`)));
    const right = el('div', 'stack'); const health = el('div', 'card-body');
    append(health, kv(t('Usimamizi', 'Moderation'), badge(enabled ? t('Unafanya kazi', 'Active') : t('Umesitishwa', 'Paused'), enabled ? '' : 'warn')), kv(t('Lugha ya group', 'Group language'), data.language === 'en' ? 'English' : 'Kiswahili'), kv(t('Makosa ya links / forwards', 'Link / forward strikes'), '24h → 7d → ∞'), kv(t('Whitelist ya ziada', 'Additional allowlist'), String(data.rules.length)), kv(t('Ulinzi wa flood', 'Flood control'), data.settings.flood_enabled ? t('Umewashwa', 'On') : t('Umezimwa', 'Off')), kv(t('Ukaguzi wa wanaojiunga', 'Join screening'), data.settings.join_gate_enabled ? t('Umewashwa', 'On') : t('Umezimwa', 'Off')));
    right.append(card(t('Hali ya group', 'Group status'), [health]));
    const breakdown = el('div', 'card-body'); const month = data.stats.month || {}; const total = Math.max(1, month.incidents || 0);
    for (const [key, label] of [['links', t('Links zisizoruhusiwa', 'Unapproved links')], ['forwards', t('Ujumbe wa forward', 'Forwarded messages')]]) { const row = el('div', 'progress-row'); const fill = el('div', 'progress-fill'); fill.style.width = `${Math.min(100, (Number(month[key]) || 0) / total * 100)}%`; append(row, append(el('div', 'progress-top'), el('span', '', label), el('span', '', Number(month[key] || 0))), append(el('div', 'progress-track'), fill)); breakdown.append(row); }
    right.append(card(t('Sababu · siku 30', 'Reasons · 30 days'), [breakdown])); append(grid, left, right); content.append(grid);
  }
  function renderIncidents(content) {
    const rows = state.overview.incidents; content.append(title(t('Historia yenye maelezo.', 'A clear incident history.'), t('Sababu, hatua iliyothibitishwa na hali ya taarifa. Marekebisho huandikwa kwenye historia ya admins.', 'Reasons, confirmed actions and announcement delivery. Corrections are recorded in the admin activity log.')));
    const list = el('div', 'list'); for (const row of rows) list.append(incidentItem(row, { actions: true }));
    if (!rows.length) list.append(empty(t('Hakuna matukio kwa sasa', 'No incidents yet'), t('Matukio mapya ya group hili yataonekana hapa.', 'New incidents for this group will appear here.')));
    content.append(card(t('Matukio ya hivi karibuni', 'Latest incidents'), [list], t('Hadi 50 · siku 30', 'Up to 50 · 30 days')));
  }
  function renderAppeals(content) {
    content.append(title(t('Sikiliza. Kagua. Amua.', 'Hear it. Review it. Decide.'), t('Kila rufaa inahusu tukio moja. Kubakiza adhabu, kuondoa ban na kusahihisha kosa ni maamuzi tofauti.', 'Each appeal concerns one incident. Upholding an action, removing a ban and correcting a strike are separate decisions.')));
    const list = el('div', 'list'); const rows = state.overview.appeals;
    for (const row of rows) {
      const item = el('article', 'list-item'); const top = el('div', 'item-top'); const words = el('div'); append(words, el('div', 'item-title', userLabel(row.user_id)), el('p', 'item-meta', `${timestamp(row.created_at)} · ${t('Tukio', 'Case')} ${row.incident_id}`));
      append(top, words, badge(statusLabel(row.status), row.status === 'open' ? 'warn' : 'neutral')); append(item, top, el('p', 'item-message', row.message));
      if (row.status === 'open') {
        const actions = el('div', 'item-actions');
        for (const [decision, label, explanation] of [
          ['keep', t('Bakiza adhabu', 'Uphold action'), t('Rufaa itafungwa na adhabu pamoja na idadi ya makosa vitabaki.', 'The appeal will be closed. The action and strike count remain unchanged.')],
          ['unban', t('Ondoa ban', 'Remove ban'), t('Rufaa itafungwa na mtumiaji ataruhusiwa kujiunga tena. Idadi ya makosa itabaki.', 'The appeal will be closed and the user may rejoin. Their strike count stays unchanged.')],
          ['forgive', t('Sahihisha kosa moja', 'Correct one strike'), t('Rufaa itafungwa na kosa moja litasahihishwa. Ban iliyopo itaendelea; kuondoa ban ni hatua nyingine.', 'The appeal will be closed and one strike corrected. The current ban remains; removing the ban is a separate action.')],
        ]) actions.append(button(label, () => confirmAction(label, explanation, t('Thibitisha uamuzi', 'Confirm decision'), () => perform('appeal_resolve', { appealId: row.id, decision })), 'secondary small'));
        item.append(actions);
      } else item.append(el('p', 'item-meta', `${decisionLabel(row.decision)} · ${timestamp(row.updated_at)}`));
      list.append(item);
    }
    if (!rows.length) list.append(empty(t('Hakuna rufaa kwa sasa', 'No appeals right now'), t('Rufaa zinazotumwa na members wa group hili zitaonekana hapa.', 'Appeals submitted by this group’s members will appear here.')));
    content.append(card(t('Rufaa za group', 'Group appeals'), [list], t('Hadi 50', 'Up to 50')));
  }
  function renderJoins(content) {
    content.append(title(t('Karibu, kwa mpangilio.', 'A considered welcome.'), t('Kagua maombi ya kujiunga. Kushindwa au kuchelewa kuthibitisha hakutoi ban ya moja kwa moja.', 'Review requests to join. Failed or expired verification does not automatically ban anyone.')));
    if (!state.overview.settings.join_gate_enabled) content.append(info(t('Ukaguzi wa wanaojiunga umezimwa. Unaweza kuuwasha kwenye Mipangilio; unahitaji ruhusa ya kupokea na kuamua maombi ya kujiunga.', 'Join screening is off. Enable it in Settings; Pilot needs permission to receive and decide join requests.')));
    const list = el('div', 'list'); const rows = state.overview.joins || [];
    for (const row of rows) {
      const item = el('article', 'list-item'); const top = el('div', 'item-top'); append(top, el('div', 'item-title', userLabel(row.user_id)), badge(statusLabel(row.status), ['approved', 'declined', 'cancelled'].includes(row.status) ? 'neutral' : 'warn'));
      append(item, top, el('p', 'item-meta', timestamp(row.event_at || row.created_at)));
      if (['review', 'challenged'].includes(row.status)) { const actions = el('div', 'item-actions'); for (const [action, label, description] of [['join_approve', t('Kubali kujiunga', 'Approve request'), t('Mtumiaji ataruhusiwa kujiunga ikiwa ombi bado linasubiri na hakuna uamuzi mpya wa admin.', 'The user may join if the request is still pending and no newer admin decision has changed it.')], ['join_decline', t('Kataa ombi', 'Decline request'), t('Ombi hili la kujiunga litakataliwa. Hatua hii haiweki ban wala kosa la link.', 'This join request will be declined. This does not add a ban or a link strike.')]]) actions.append(button(label, () => confirmAction(label, description, label, () => perform(action, { joinId: row.id })), 'secondary small')); item.append(actions); }
      list.append(item);
    }
    if (!rows.length) list.append(empty(t('Hakuna maombi ya kuonyesha', 'No requests to show'), t('Maombi yanayopokelewa wakati ukaguzi umewashwa yataonekana hapa.', 'Requests received while screening is enabled will appear here.')));
    content.append(card(t('Maombi ya kujiunga', 'Join requests'), [list]));
  }
  function renderSettings(content) {
    const data = state.overview; const settings = data.settings; content.append(title(t('Pilot, kwa namna yako.', 'Make Pilot yours.'), t('Mipangilio hii inahusu group lililochaguliwa pekee. Vipengele vipya huanza vikiwa vimezimwa.', 'These settings apply only to the selected group. New protection features start switched off.')));
    const form = el('form'); const body = el('div', 'card-body'); const inputs = {};
    function addField(parent, label, options) { const result = field(label, options); inputs[options.name] = result.input; parent.append(result.box); return result.input; }
    append(body, sectionHeading(t('Lugha na maelezo ya group', 'Language and group notes'), t('Matangazo ya group yatafuata lugha hii. Lugha yako binafsi ya paneli ni tofauti.', 'Group announcements use this language. Your personal panel language is separate.')));
    const groupLang = addField(body, t('Lugha ya group', 'Group language'), { name: 'groupLanguage', value: data.language, options: [['sw', 'Kiswahili'], ['en', 'English']] });
    const rules = el('div', 'field-grid'); for (const lang of ['sw', 'en']) addField(rules, lang === 'sw' ? t('Maelezo ya sheria · Kiswahili', 'Rule notes · Swahili') : t('Maelezo ya sheria · English', 'Rule notes · English'), { name: `rules_${lang}`, value: settings[`rules_${lang}`], rows: 3, maxLength: 600, note: t('Hadi herufi 600. Huongezwa kwenye sheria za msingi.', 'Up to 600 characters. Added to the base rules.') }); body.append(rules, el('hr', 'setting-divider'));
    const welcome = toggle(t('Washa', 'Enable'), 'welcome_enabled', settings.welcome_enabled); inputs.welcome_enabled = welcome.input;
    append(body, sectionHeading(t('Ujumbe wa ukaribisho', 'Welcome message'), t('Karibisha members wapya kwa ujumbe mfupi. Hakuna adhabu kwa kutobofya sheria.', 'Welcome new members with a short message. Not opening the rules does not cause a penalty.'), welcome.box));
    const welcomeFields = el('div', 'field-grid'); for (const lang of ['sw', 'en']) addField(welcomeFields, lang === 'sw' ? 'Kiswahili' : 'English', { name: `welcome_${lang}`, value: settings[`welcome_${lang}`], rows: 3, maxLength: 400, note: t('Hadi herufi 400 · {user}, {group}, {rules}. Acha tupu kutumia ujumbe wa kawaida.', 'Up to 400 characters · {user}, {group}, {rules}. Leave blank for the default welcome.') }); body.append(welcomeFields);
    const welcomePreview = el('div', 'preview'); const welcomeCopy = el('div', 'preview-copy'); append(welcomePreview, el('p', 'preview-label', t('Mfano wa ukaribisho · haujatumiwa', 'Welcome preview · not sent')), welcomeCopy); body.append(welcomePreview, el('hr', 'setting-divider'));
    function updateWelcomePreview() {
      const lng = groupLang.value; const raw = inputs[`welcome_${lng}`].value || (lng === 'en' ? 'Welcome, {user}! ✈️\nYou are joining {group}.\n\n{rules}' : 'Karibu, {user}! ✈️\nUmejiunga na {group}.\n\n{rules}');
      welcomeCopy.textContent = fillTemplate(raw, { user: 'Asha', group: data.group.title, rules: previewData.rules[lng] + (inputs[`rules_${lng}`].value.trim() ? `\n\n${inputs[`rules_${lng}`].value.trim()}` : '') }, 3500);
    }
    [groupLang, inputs.welcome_sw, inputs.welcome_en, inputs.rules_sw, inputs.rules_en].forEach(node => node.addEventListener('input', updateWelcomePreview)); updateWelcomePreview();
    append(body, sectionHeading(t('Muonekano wa matangazo', 'Announcement style'), t('Jina, sababu na muda wa adhabu hubaki kwenye taarifa. Maandishi yako huongezwa kwa usalama.', 'The name, reason and penalty duration always remain in the notice. Your text is added safely.')));
    addField(body, t('Mtindo', 'Style'), { name: 'notice_template', value: settings.notice_template, options: [['detailed', t('Maelezo kamili', 'Detailed')], ['compact', t('Mfupi', 'Compact')], ['formal', t('Rasmi', 'Formal')]] });
    const notices = el('div', 'field-grid'); for (const lang of ['sw', 'en']) addField(notices, lang === 'sw' ? t('Nyongeza · Kiswahili', 'Extra text · Swahili') : t('Nyongeza · English', 'Extra text · English'), { name: `notice_${lang}`, value: settings[`notice_${lang}`], rows: 3, maxLength: 240, note: '{user}, {reason}, {duration}, {group} · 240' }); body.append(notices);
    const preview = el('div', 'preview'); const previewCopy = el('div', 'preview-copy'); append(preview, el('p', 'preview-label', t('Mfano wa ujumbe · haujatumiwa', 'Message preview · not sent')), previewCopy); body.append(preview);
    function updatePreview() {
      const lng = groupLang.value; const extra = fillTemplate(inputs[`notice_${lng}`].value, { user: 'Asha', group: data.group.title, reason: lng === 'en' ? 'The posted link is not allowed.' : 'Link iliyotumwa hairuhusiwi.', duration: lng === 'en' ? '24 hours' : 'Saa 24' }, 800);
      const core = previewData.notices[lng][inputs.notice_template.value] || previewData.notices[lng].detailed;
      previewCopy.textContent = core + (extra.trim() ? `\n\n${extra}` : '');
    }
    [groupLang, inputs.notice_sw, inputs.notice_en, inputs.notice_template].forEach(node => node.addEventListener('input', updatePreview)); updatePreview(); body.append(el('hr', 'setting-divider'));
    const flood = toggle(t('Washa', 'Enable'), 'flood_enabled', settings.flood_enabled); inputs.flood_enabled = flood.input;
    append(body, sectionHeading(t('Ulinzi wa ujumbe mwingi', 'Flood control'), t('Hudhibiti ujumbe mwingi kwa muda mfupi. Hatua hizi haziongezi makosa ya links au forwards.', 'Controls messages sent too quickly. These actions do not add link or forward strikes.'), flood.box));
    const floodFields = el('div', 'field-grid');
    addField(floodFields, t('Idadi ya ujumbe inayoruhusiwa', 'Messages allowed'), { name: 'flood_limit', type: 'number', value: settings.flood_limit, min: 3, max: 30, note: '3–30' });
    addField(floodFields, t('Ndani ya sekunde', 'Within seconds'), { name: 'flood_window', type: 'number', value: settings.flood_window, min: 5, max: 60, note: '5–60' });
    const floodAction = addField(floodFields, t('Hatua', 'Action'), { name: 'flood_action', value: settings.flood_action, options: [['delete', t('Futa ujumbe uliozidi', 'Delete excess messages')], ['mute', t('Futa na nyamazisha kwa muda', 'Delete and temporarily mute')]] });
    const mute = addField(floodFields, t('Muda wa kunyamazisha · sekunde', 'Mute duration · seconds'), { name: 'flood_mute_seconds', type: 'number', value: settings.flood_mute_seconds, min: 60, max: 3600, note: '60–3600' });
    const toggleMute = () => { mute.disabled = floodAction.value !== 'mute'; }; floodAction.addEventListener('change', toggleMute); toggleMute(); body.append(floodFields, el('hr', 'setting-divider'));
    const joins = toggle(t('Washa', 'Enable'), 'join_gate_enabled', settings.join_gate_enabled); inputs.join_gate_enabled = joins.input;
    append(body, sectionHeading(t('Ukaguzi wa maombi ya kujiunga', 'Join request screening'), t('Hufanya kazi kwa maombi ya kujiunga. Pilot anahitaji ruhusa ya kuwaalika users. Maombi yasiyokamilisha uthibitisho hubaki kwa ukaguzi wa admin.', 'Works with join requests. Pilot needs invite-user permission. Incomplete verification stays available for admin review.'), joins.box));
    addField(body, t('Namna ya ukaguzi', 'Screening mode'), { name: 'join_gate_mode', value: settings.join_gate_mode, options: [['review', t('Admin aamue kila ombi', 'An admin reviews each request')], ['challenge', t('Uthibitisho mwepesi, kisha ukubali', 'Simple verification, then approval')]] });
    const save = button(t('Hifadhi mipangilio', 'Save settings'), null, ''); save.type = 'submit'; append(body, append(el('div', 'form-footer'), el('p', '', t('Admins, admin asiyejulikana na channel halisi iliyo linked bado wanaheshimiwa.', 'Admins, anonymous admins and the actual linked channel remain exempt.')), save)); form.append(body);
    form.addEventListener('submit', event => { event.preventDefault(); if (!form.reportValidity()) return; const next = {}; for (const [name, input] of Object.entries(inputs)) if (name !== 'groupLanguage') next[name] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value; perform('configure', { settings: next, language: groupLang.value }); });
    content.append(card(t('Mipangilio ya group', 'Group settings'), [form]));
    const subscription = el('form', 'card-body'); subscription.style.marginTop = '0';
    const alerts = toggle(t('Nitumie taarifa za matatizo faraghani', 'Send me private issue alerts'), 'alerts', data.subscription.alerts); subscription.append(alerts.box);
    const report = field(t('Ripoti za group hili', 'Reports for this group'), { name: 'report', value: data.subscription.report, options: [['off', t('Usitume', 'Off')], ['daily', t('Kila siku', 'Daily')], ['weekly', t('Kila wiki', 'Weekly')]], note: t('Chaguo hili ni lako binafsi. Admin mwingine hachaguliwi kwa niaba yake.', 'This is your personal preference. Other admins choose their own subscriptions.') }); report.box.style.marginTop = '20px'; subscription.append(report.box);
    const subscribe = button(t('Hifadhi taarifa zangu', 'Save my notifications'), null, 'secondary'); subscribe.type = 'submit'; subscription.append(subscribe); subscription.addEventListener('submit', event => { event.preventDefault(); perform('subscribe', { alerts: alerts.input.checked, report: report.input.value }); });
    const subscriptionCard = card(t('Taarifa unazopokea', 'Notifications you receive'), [subscription]); subscriptionCard.style.marginTop = '20px'; content.append(subscriptionCard);
  }
  function renderWhitelist(content) {
    content.append(title(t('Links zenye nafasi hapa.', 'Links welcome here.'), t('Panua orodha ya group hili kwa uwazi. Sheria za msingi za SautiLink zinaendelea kutumika.', 'Extend this group’s allowlist with a clear scope. The base SautiLink rules continue to apply.')));
    const base = el('div', 'card-body'); append(base, el('p', 'card-copy', t('HTTPS za sautilink.com na subdomains zake; pamoja na channels zilizoidhinishwa hapa chini.', 'HTTPS links on sautilink.com and its subdomains, plus the approved channels below.')), append(el('div', 'baseline'), ...['sautilink.com', '*.sautilink.com', 't.me/techhubtz', 't.me/sautilink', 't.me/sautilink_cloud', 't.me/drcharlesofficial'].map(value => el('span', '', value))), el('p', 'card-copy', t('Forward kutoka kwa member bado inakiuka sheria, hata ikiwa chanzo kinaruhusiwa.', 'A member’s forwarded message still breaks the rule, even when its source is allowed.')));
    content.append(card(t('Orodha ya msingi', 'Base allowlist'), [base]));
    const form = el('form', 'card-body'); const grid = el('div', 'field-grid'); const kind = field(t('Unaruhusu nini?', 'What should be allowed?'), { name: 'ruleKind', value: 'url', options: [['url', t('URL hii tu', 'Only this exact URL')], ['domain', t('Domain hii tu', 'Only this hostname')], ['subdomains', t('Domain na subdomains zake', 'Hostname and its subdomains')]] }); const value = field(t('URL au domain', 'URL or hostname'), { name: 'ruleValue', maxLength: 2048, note: t('HTTPS pekee. Hakuna wildcard au username/password.', 'HTTPS only. No wildcards or username/password.') }); value.input.required = true; append(grid, kind.box, value.box); const preview = el('div', 'scope-preview');
    function updateScope() { const text = value.input.value.trim() || (kind.input.value === 'url' ? 'https://example.com/page' : 'example.com'); preview.textContent = kind.input.value === 'url' ? t(`Itaruhusu URL hii pekee: ${text}`, `Allows only this exact URL: ${text}`) : kind.input.value === 'domain' ? t(`Itaruhusu paths zote za HTTPS kwenye host hii pekee: ${text}. Subdomains hazijajumuishwa.`, `Allows HTTPS paths on this exact hostname: ${text}. Subdomains are not included.`) : t(`Itaruhusu HTTPS kwenye host hii na subdomains zake zote: ${text}.`, `Allows HTTPS on this hostname and all its subdomains: ${text}.`); }
    kind.input.addEventListener('change', updateScope); value.input.addEventListener('input', updateScope); updateScope();
    const add = button(t('Ongeza kwenye group hili', 'Add to this group'), null, ''); add.type = 'submit'; append(form, grid, preview, add); form.addEventListener('submit', event => { event.preventDefault(); if (!form.reportValidity()) return; confirmAction(t('Ruhusu link hii?', 'Allow this link scope?'), preview.textContent, t('Ongeza ruhusa', 'Add permission'), () => perform('whitelist_add', { kind: kind.input.value, value: value.input.value.trim() })); });
    const custom = card(t('Ongeza ruhusa', 'Add a permission'), [form]); custom.style.marginTop = '20px'; content.append(custom);
    const list = el('div', 'list'); for (const rule of state.overview.rules) { const item = el('div', 'list-item'); const top = el('div', 'item-top'); const copy = el('div'); append(copy, el('div', 'rule-kind', rule.kind === 'url' ? t('URL hii tu', 'Exact URL') : rule.kind === 'domain' ? t('Host hii tu', 'Exact hostname') : t('Host + subdomains', 'Hostname + subdomains')), el('div', 'rule-value', rule.value)); append(top, copy, button(t('Ondoa', 'Remove'), () => confirmAction(t('Ondoa ruhusa hii?', 'Remove this permission?'), t(`Links zinazotegemea ruhusa hii hazitaruhusiwa tena kwenye group hili.\n\n${rule.value}`, `Links relying on this permission will no longer be allowed in this group.\n\n${rule.value}`), t('Ondoa ruhusa', 'Remove permission'), () => perform('whitelist_remove', { id: rule.id }), true), 'ghost small')); item.append(top); list.append(item); }
    if (!state.overview.rules.length) list.append(empty(t('Hakuna nyongeza bado', 'No extra permissions yet'), t('Group hili linatumia orodha ya msingi ya SautiLink.', 'This group currently uses the base SautiLink allowlist.')));
    const listCard = card(t('Ruhusa za group hili', 'This group’s permissions'), [list]); listCard.style.marginTop = '20px'; content.append(listCard);
  }
  function renderActivity(content) {
    content.append(title(t('Kila uamuzi una kumbukumbu.', 'Every decision has a record.'), t('Ona nani alibadilisha mipangilio au kushughulikia tukio. Maudhui kamili ya ujumbe uliofutwa hayahifadhiwi hapa.', 'See who changed settings or handled an incident. The full text of deleted messages is not stored here.')));
    const names = { configure: t('Mipangilio imebadilishwa', 'Settings updated'), whitelist_add: t('Ruhusa ya link imeongezwa', 'Link permission added'), whitelist_remove: t('Ruhusa ya link imeondolewa', 'Link permission removed'), pause: t('Usimamizi umesitishwa', 'Moderation paused'), resume: t('Usimamizi umewashwa', 'Moderation resumed'), subscribe: t('Chaguo la taarifa limebadilishwa', 'Notification preference updated'), case_unban: t('Ban imeondolewa', 'Ban removed'), case_forgive: t('Kosa moja limesahihishwa', 'One strike corrected'), appeal_create: t('Rufaa imetumwa', 'Appeal submitted'), appeal_resolve: t('Rufaa imejibiwa', 'Appeal resolved'), join_approve: t('Ombi la kujiunga limekubaliwa', 'Join request approved'), join_decline: t('Ombi la kujiunga limekataliwa', 'Join request declined') };
    const list = el('div', 'list'); for (const row of state.overview.audit) { const item = el('article', 'list-item'); append(item, el('div', 'item-title', names[row.action] || t('Hatua ya usimamizi', 'Moderation activity')), el('p', 'item-meta', `${row.actor_id ? userLabel(row.actor_id) : t('Pilot / admin asiyejulikana', 'Pilot / anonymous admin')} · ${timestamp(row.created_at)}`), row.incident_id ? el('p', 'item-meta', `${t('Tukio', 'Case')} ${row.incident_id}`) : null, row.details?.decision ? el('p', 'item-meta', decisionLabel(row.details.decision)) : null); list.append(item); }
    if (!state.overview.audit.length) list.append(empty(t('Historia inaanza hapa', 'The record starts here'), t('Hatua mpya za usimamizi zitaonekana hapa.', 'New management actions will appear here.'))); content.append(card(t('Shughuli za karibuni', 'Recent activity'), [list], t('Hadi 50', 'Up to 50')));
  }
  function appealDialog(row) {
    const modal = $('modal'); modal.replaceChildren(); const heading = el('h2', '', t('Eleza kilichotokea.', 'Tell us what happened.')); heading.id = 'modal-title'; modal.setAttribute('aria-labelledby', 'modal-title');
    const form = el('form'); const message = field(t('Ujumbe kwa admins wa group', 'Message to the group admins'), { name: 'appealMessage', rows: 5, maxLength: 1000, note: t('Rufaa moja kwa tukio. Hadi herufi 1,000. Usitume nywila au token.', 'One appeal per case. Up to 1,000 characters. Do not include passwords or tokens.') }); message.input.required = true; message.input.minLength = 5; const actions = el('div', 'modal-actions'); const send = button(t('Tuma rufaa', 'Submit appeal'), null, ''); send.type = 'submit'; append(actions, button(t('Ghairi', 'Cancel'), () => modal.close(), 'secondary'), send); append(form, el('p', 'modal-copy', t('Admins wa group hili wataona ujumbe wako na tukio husika. Rufaa haibadilishi ban moja kwa moja.', 'The group’s admins will see your message and the related incident. Submitting an appeal does not automatically change the ban.')), message.box, actions); form.addEventListener('submit', event => { event.preventDefault(); if (!form.reportValidity()) return; modal.close(); perform('appeal_create', { incidentId: row.id, message: message.input.value.trim() }, { chatId: String(row.chat_id), success: t('Rufaa imetumwa kwa ukaguzi.', 'Your appeal is ready for review.') }); }); append(modal, heading, form); modal.showModal();
  }
  function renderOwn(content) {
    content.append(title(t('Taarifa zako, faraghani.', 'Your cases, privately.'), t('Ona matukio yanayokuhusu na tuma rufaa kwa admins wa group husika. Historia ya members wengine haionekani hapa.', 'See incidents involving you and appeal to the relevant group admins. Other members’ histories are not visible here.')));
    if (!state.own) { content.append(loading()); return; }
    const list = el('div', 'list'); for (const row of state.own.incidents) list.append(incidentItem(row, { personal: true }));
    if (!state.own.incidents.length) list.append(empty(t('Hakuna tukio linalokuhusu', 'No cases involving you'), t('Hakuna tukio lako lililorekodiwa katika siku 30 zilizopita.', 'There are no recorded incidents involving you in the last 30 days.')));
    content.append(card(t('Matukio yangu', 'My cases'), [list], t('Siku 30 za karibuni', 'Last 30 days')));
  }
  function renderChecker(content) {
    content.append(title(t('Kagua kabla ya kutuma.', 'Check before you share.'), t('Ona kama link inaruhusiwa na sheria za Pilot. Kikagua hiki hakifungui tovuti wala kuthibitisha usalama wa maudhui yake.', 'See whether a link is permitted by Pilot’s rules. This checker does not open websites or certify that their content is safe.')));
    const form = el('form', 'card-body'); const text = field(t('Link au ujumbe wenye links', 'Link or message containing links'), { name: 'checkText', rows: 4, maxLength: 4096, note: t('Hadi herufi 4,096. Tumia sehemu hii faraghani kujaribu links.', 'Up to 4,096 characters. Use this private space to try links.') }); text.input.required = true;
    const choices = [['base', t('Sheria za msingi za SautiLink', 'Base SautiLink rules')], ...state.groups.map(group => [String(group.id), group.title])]; const scope = field(t('Kagua kwa sheria zipi?', 'Which rules should be checked?'), { name: 'checkScope', value: state.chatId || 'base', options: choices }); const submit = button(t('Kagua link', 'Check link'), null, '', 'checklink'); submit.type = 'submit'; const results = el('div', 'checker-results'); results.setAttribute('aria-live', 'polite'); append(form, text.box, scope.box, submit, results);
    form.addEventListener('submit', async event => {
      event.preventDefault(); if (!form.reportValidity()) return; submit.disabled = true; results.replaceChildren(loading());
      try { const data = await query('checklink', scope.input.value === 'base' ? null : scope.input.value, { text: text.input.value }); results.replaceChildren();
        for (const item of data.destinations) { const result = el('div', `checker-result${item.allowed ? '' : ' blocked'}`); append(result, el('strong', '', item.allowed ? t('Inaruhusiwa', 'Allowed') : t('Hairuhusiwi', 'Not allowed')), el('code', '', item.value), el('p', '', item.allowed ? item.source === 'group' ? t('Inaruhusiwa na whitelist ya group lililochaguliwa.', 'Permitted by the selected group’s allowlist.') : t('Inaruhusiwa na sheria za msingi za SautiLink.', 'Permitted by the base SautiLink rules.') : t('Haipo kwenye whitelist inayotumika au muundo wake hauruhusiwi.', 'It is outside the active allowlist or uses an unsupported URL format.'))); results.append(result); }
        if (!data.destinations.length) results.append(info(t('Hakuna link iliyogunduliwa kwenye maandishi haya.', 'No links were detected in this text.')));
        results.append(info(t('Forward kutoka kwa member hairuhusiwi, hata link ikipita ukaguzi huu.', 'Member forwards are not allowed, even when a link passes this check.')));
      } catch (error) { results.replaceChildren(); showError(error); } finally { submit.disabled = false; }
    }); content.append(card(t('Kikagua sheria za links', 'Link policy checker'), [form]));
  }
  function loading() { return append(el('div', 'loading'), el('div', 'spinner'), el('p', '', t('Tunathibitisha na kuleta taarifa…', 'Verifying access and loading information…'))); }
  function render() {
    navigation(); renderGroupSelect(); const content = $('content'); content.replaceChildren();
    if (state.view === 'mystatus') { renderOwn(content); return; }
    if (state.view === 'checklink') { renderChecker(content); return; }
    if (!state.overview) { content.append(loading()); return; }
    ({ overview: renderOverview, incidents: renderIncidents, appeals: renderAppeals, joins: renderJoins, settings: renderSettings, whitelist: renderWhitelist, activity: renderActivity }[state.view] || renderOverview)(content);
  }
  async function loadOwn() {
    const version = ++state.ownToken;
    try { const data = await query('mystatus', null); if (version !== state.ownToken) return; state.own = data; if (state.view === 'mystatus') render(); }
    catch (error) { if (version !== state.ownToken || state.view !== 'mystatus') return; showError(error); $('content').replaceChildren(empty(t('Taarifa hazijapatikana', 'Information unavailable'), errorText(error.code), button(t('Jaribu tena', 'Try again'), loadOwn))); }
  }
  async function loadGroup({ preservePersonal = false } = {}) {
    const version = ++state.reloadToken; state.overview = null;
    if (!(preservePersonal && ['mystatus', 'checklink'].includes(state.view))) render();
    try {
      const data = await query('overview'); if (version !== state.reloadToken) return; state.overview = data;
      if (['mystatus', 'checklink'].includes(state.view)) { navigation(); renderGroupSelect(); } else render();
    } catch (error) {
      if (version !== state.reloadToken || ['mystatus', 'checklink'].includes(state.view)) return;
      showError(error); $('content').replaceChildren(empty(t('Group halijathibitishwa', 'Group access not verified'), errorText(error.code), button(t('Sasisha', 'Refresh'), refreshData)));
    }
  }
  async function refreshData() {
    if (state.view === 'mystatus') { state.own = null; render(); await loadOwn(); return; }
    if (state.chatId) await loadGroup(); else await loadOwn();
  }
  async function start() {
    try { app?.ready(); app?.expand(); if (app?.isVersionAtLeast?.('6.1')) { app.setHeaderColor('#080e17'); app.setBackgroundColor('#080e17'); } } catch { /* Older Telegram clients still use the standard page. */ }
    if (!initData) return;
    $('login').hidden = true; $('app').hidden = false; $('content').append(loading());
    try {
      const data = await query('groups', null); state.groups = data.groups || []; state.groupsCursor = data.nextCursor || null;
      const params = new URLSearchParams(location.search); const preferred = params.get('chat') || params.get('group');
      let preferredOverview = null;
      if (preferred && /^-[1-9]\d{0,15}$/.test(preferred) && !state.groups.some(group => String(group.id) === preferred)) {
        try { preferredOverview = await query('overview', preferred); appendGroups([preferredOverview.group]); } catch { /* A display hint never grants access. */ }
      }
      state.chatId = String(state.groups.find(group => String(group.id) === preferred)?.id || state.groups[0]?.id || '') || null;
      if (preferredOverview && String(preferredOverview.group.id) === state.chatId) state.overview = preferredOverview;
      const hint = params.get('view') || params.get('tab'); const requestedView = ({ links: 'whitelist', mycases: 'mystatus', checker: 'checklink' })[hint] || hint; const validViews = ['overview', 'incidents', 'appeals', 'joins', 'settings', 'whitelist', 'activity', 'mystatus', 'checklink'];
      state.view = validViews.includes(requestedView) ? requestedView : state.groups.length ? 'overview' : 'mystatus';
      if (!state.groups.length && !['mystatus', 'checklink'].includes(state.view)) state.view = 'mystatus';
      $('header-state').replaceChildren(append(el('i', 'dot')), document.createTextNode(t('Telegram imethibitishwa', 'Telegram verified')));
      render(); if (state.chatId && !state.overview) await loadGroup(); if (state.view === 'mystatus') await loadOwn();
      if (!state.groups.length) { const tip = info(t('Unasimamia group? Tuma /admin kwenye group hilo, kisha fungua kiungo cha faragha. Group litaonekana hapa baada ya nafasi yako kuthibitishwa.', 'Manage a group? Send /admin in that group, then open the private link. It will appear here after your admin role is verified.')); $('content').prepend(tip); }
    } catch (error) { showError(error); $('content').replaceChildren(empty(t('Fungua tena kupitia Telegram', 'Reopen through Telegram'), errorText(error.code), button(t('Fungua bot', 'Open bot'), () => { location.href = 'https://t.me/sautilinkpilotbot?start=dashboard'; }))); }
  }
  $('group-select').addEventListener('change', event => { if (state.busy) return; state.chatId = event.target.value; loadGroup(); });
  $('more-groups').addEventListener('click', loadMoreGroups);
  $('refresh').addEventListener('click', () => { if (!state.busy) { $('banner').hidden = true; refreshData(); } });
  document.querySelectorAll('[data-lang]').forEach(node => node.addEventListener('click', () => { const next = node.dataset.lang; if (state.busy || next === language) return; const url = new URL(location.href); url.searchParams.set('lang', next); location.replace(url.toString()); }));
  start();
}
