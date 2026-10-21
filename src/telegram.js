export class TelegramError extends Error {
  constructor(description, code=0, ambiguous=false, retryAfter=0) {
    super(description);
    this.name='TelegramError'; this.code=code;
    this.ambiguous=ambiguous; this.retryAfter=retryAfter;
  }
}

export function createTelegram(token, fetcher=fetch) {
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token ?? '')) throw new Error('BOT_TOKEN haijawekwa kwa usahihi.');
  return {
    async call(method,parameters={}) {
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),8000);
      let response;
      try {
        response=await fetcher(`https://api.telegram.org/bot${token}/${method}`,{
          method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify(parameters),signal:controller.signal
        });
        const result=await response.json();
        if (!result.ok) {
          // No response object / request URL containing the token is logged or returned.
          const description=String(result.description ?? 'Telegram imekataa ombi.').split(token).join('[redacted]');
          throw new TelegramError(description,result.error_code || response.status,response.status>=500,result.parameters?.retry_after || 0);
        }
        return result.result;
      } catch(error) {
        if (error instanceof TelegramError) throw error;
        throw new TelegramError('Telegram haijatoa jibu la kuthibitisha hatua.',response?.status || 0,true);
      } finally { clearTimeout(timeout); }
    }
  };
}

export async function webhookSecret(token) {
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',enc.encode(token),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,enc.encode('sautilink-pilot:telegram-webhook:v1'));
  return [...new Uint8Array(signature)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export async function secureEqual(a,b) {
  if(typeof a!=='string' || typeof b!=='string') return false;
  const enc=new TextEncoder();
  const [one,two]=await Promise.all([a,b].map(s=>crypto.subtle.digest('SHA-256',enc.encode(s))));
  const x=new Uint8Array(one),y=new Uint8Array(two);
  let result=0; for(let i=0;i<x.length;i++) result|=x[i]^y[i];
  return result===0;
}
