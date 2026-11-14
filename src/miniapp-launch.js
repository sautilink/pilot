// Telegram Mini App launch metadata is supplied by the Telegram client in the
// fragment. The official JS bridge normally exposes the same signed string in
// WebApp.initData. A network failure loading the bridge must not turn a valid
// Telegram launch into the public landing page.
//
// Never use initDataUnsafe, URL user IDs, cookies or localStorage to authorize.
// Both sources are untrusted until the backend verifies the Telegram HMAC.
export function miniAppLaunchData(app,href) {
  const native=typeof app?.initData==='string'?app.initData:'';
  if(native && native.length<=16384) return native;
  try {
    const hash=new URL(href).hash;
    if(!hash || hash.length>32768) return '';
    const params=new URLSearchParams(hash.slice(1));
    if(params.getAll('tgWebAppData').length!==1) return '';
    const data=params.get('tgWebAppData');
    return data && data.length<=16384 && data.includes('hash=') ? data : '';
  }catch {return '';}
}

// A visit inside Telegram without signed data is a broken/unsupported launch.
// Detect it without treating the platform hint as authentication.
export function miniAppTelegramContext(app,href) {
  if(typeof app?.platform==='string' && app.platform && app.platform!=='unknown')return true;
  try {
    const hash=new URLSearchParams(new URL(href).hash.slice(1));
    return hash.has('tgWebAppVersion')||hash.has('tgWebAppPlatform')||hash.has('tgWebAppData');
  }catch{return false;}
}
