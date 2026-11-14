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
export function miniAppTelegramContext(app,href,userAgent='',hasNativeBridge=false) {
  // UI guidance only: these hints never authorize access. Real access always
  // requires signed data verified by the backend.
  if(hasNativeBridge || /Telegram/i.test(String(userAgent).slice(0,512)))return true;
  if(typeof app?.platform==='string' && app.platform && app.platform!=='unknown')return true;
  try {
    const hash=new URLSearchParams(new URL(href).hash.slice(1));
    return hash.has('tgWebAppVersion')||hash.has('tgWebAppPlatform')||hash.has('tgWebAppData');
  }catch{return false;}
}

/** Hide Telegram's native loading placeholder as soon as the Mini App UI
 * starts, even if the optional remote JS SDK has not arrived yet.
 * The event name is part of Telegram's documented WebView protocol.
 * No user data, authorization or bot credentials are sent to this bridge.
 */
export function miniAppSignalReady(app,host){
  try{
    const sdk=app || host?.Telegram?.WebApp;
    if(typeof sdk?.ready==='function'){
      sdk.ready();
      sdk.expand?.();
      return 'sdk';
    }
    if(typeof host?.TelegramWebviewProxy?.postEvent==='function'){
      host.TelegramWebviewProxy.postEvent('web_app_ready','{}');
      return 'native';
    }
    const handler=host?.webkit?.messageHandlers?.TelegramWebviewProxy;
    if(typeof handler?.postMessage==='function'){
      handler.postMessage(JSON.stringify({eventType:'web_app_ready',eventData:{}}));
      return 'ios';
    }
    if(typeof host?.external?.notify==='function'){
      host.external.notify(JSON.stringify({eventType:'web_app_ready',eventData:{}}));
      return 'desktop';
    }
  }catch{ /* Optional native bridge must never delay a verified view. */ }
  return null;
}
