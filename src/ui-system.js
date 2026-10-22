// Shared with the visual language of SautiLink Router: neutral grouped surfaces,
// Inter typography and restrained blue actions. Keep both Pilot surfaces aligned.
export const UI_TOKENS = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;450;500;550;600;650;700;750;800&display=swap');
:root{color-scheme:light;--page:#ffffff;--surface:#ffffff;--surface-soft:#f5f5f7;--surface-raised:#e8e8ed;--text:#1d1d1f;--text-soft:#616166;--text-faint:#6e6e73;--line:#dedee2;--line-strong:#86868b;--primary:#0066cc;--button:#2563eb;--button-hover:#1d4ed8;--primary-soft:#edf4ff;--success:#187747;--success-soft:#edf7f1;--warning:#996000;--warning-soft:#fff7e8;--danger:#b42332;--danger-soft:#fff0f1;--shadow:0 12px 36px rgb(0 0 0 / 4%);--font-primary:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--bg:var(--page);--surface2:var(--surface-soft);--ink:var(--text);--muted:var(--text-soft);--green:var(--primary);--mint:var(--primary);--blue:var(--primary);--amber:var(--warning);--red:var(--danger)}
:root[data-theme=dark]{color-scheme:dark;--page:#0b0b0e;--surface:#141417;--surface-soft:#1d1d21;--surface-raised:#36363b;--text:#f5f5f7;--text-soft:#b4b4ba;--text-faint:#a1a1a8;--line:#36363b;--line-strong:#68686f;--primary:#79b6ff;--primary-soft:#192a42;--success:#70d29d;--success-soft:#172a20;--warning:#eac06b;--warning-soft:#302719;--danger:#ff909c;--danger-soft:#321e24;--shadow:none}
*{box-sizing:border-box}body,button,input,textarea,select{font-family:var(--font-primary)}[hidden]{display:none!important}a,button,input,textarea,select,summary{touch-action:manipulation;-webkit-tap-highlight-color:transparent}:focus-visible{outline:3px solid var(--primary);outline-offset:4px}::selection{background:#b8d8ff;color:#102b52}.theme-toggle{width:40px;height:40px;display:inline-grid;place-items:center;flex:none;border:0;border-radius:50%;background:transparent;color:var(--text-soft);cursor:pointer}.theme-toggle:hover{background:var(--surface-raised);color:var(--text)}.theme-toggle svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.theme-toggle .sun-icon{display:none}:root[data-theme=dark] .theme-toggle .moon-icon{display:none}:root[data-theme=dark] .theme-toggle .sun-icon{display:block}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto!important}*,*:before,*:after{animation:none!important;transition:none!important}}
`;

export function themeButton(lang = 'sw') {
  return `<button class="theme-toggle" type="button" data-theme-toggle aria-label="${lang === 'en' ? 'Switch color theme' : 'Badili mwonekano'}" aria-pressed="false"><svg class="moon-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 13A9 9 0 0 1 11 3.2 9 9 0 1 0 20.8 13Z"/></svg><svg class="sun-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg></button>`;
}

// The optional choice lives in this page's URL, never in browser storage. It
// carries only the theme to our own links, never Telegram authentication data.
export function themeHead() {
  return `<script data-pilot-theme>(${themeClient.toString()})();</script>`;
}

function themeClient() {
  const root = document.documentElement;
  const url = new URL(location.href);
  const explicit = url.searchParams.get('theme');
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  let selected = explicit === 'light' || explicit === 'dark' ? explicit : null;
  const preferred = () => {
    const appTheme = window.Telegram?.WebApp?.colorScheme;
    if (appTheme === 'light' || appTheme === 'dark') return appTheme;
    return media?.matches ? 'dark' : 'light';
  };
  const update = () => {
    const theme = selected || preferred();
    root.dataset.theme = theme;
    const color = theme === 'dark' ? '#0b0b0e' : '#ffffff';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color);
    for (const button of document.querySelectorAll('[data-theme-toggle]')) {
      button.setAttribute('aria-pressed', String(theme === 'dark'));
    }
    try {
      const app = window.Telegram?.WebApp;
      if (app?.isVersionAtLeast?.('6.1')) { app.setHeaderColor(color); app.setBackgroundColor(color); }
    } catch { /* Theme still applies inside older Telegram clients. */ }
  };
  const carry = () => {
    if (!selected) return;
    for (const link of document.querySelectorAll('a[href]')) {
      const raw = link.getAttribute('href');
      if (!raw || (!raw.startsWith('/') && !raw.startsWith('#'))) continue;
      const target = new URL(raw, location.href);
      if (target.origin !== location.origin) continue;
      // Do not carry signed launch query parameters into a newly created link.
      if (raw.startsWith('#')) {
        const clean = new URL(location.pathname, location.origin);
        const lang = new URL(location.href).searchParams.get('lang');
        if (lang === 'sw' || lang === 'en') clean.searchParams.set('lang', lang);
        clean.searchParams.set('theme', selected); clean.hash = raw;
        link.setAttribute('href', clean.pathname + clean.search + clean.hash);
      } else {
        target.searchParams.set('theme', selected);
        link.setAttribute('href', target.pathname + target.search + target.hash);
      }
    }
  };
  update();
  document.addEventListener('DOMContentLoaded', () => {
    update(); carry();
    for (const button of document.querySelectorAll('[data-theme-toggle]')) {
      button.addEventListener('click', () => {
        selected = root.dataset.theme === 'dark' ? 'light' : 'dark';
        const next = new URL(location.href); next.searchParams.set('theme', selected);
        try { history.replaceState(null, '', next.pathname + next.search + next.hash); } catch { /* A sandboxed view may disallow URL changes. */ }
        update(); carry();
      });
    }
  });
  media?.addEventListener?.('change', () => { if (!selected) update(); });
}
