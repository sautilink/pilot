import { pathToFileURL } from 'node:url';
import { INDEXNOW_ENDPOINT, INDEXNOW_KEY, indexNowPayload } from '../src/seo-discovery.js';

// Run explicitly after changed public content has reached production. Never
// invoke this from request handling, cron, or builds that may not deploy.
export async function notifyIndexNow({ fetchImpl = fetch } = {}) {
  const payload = indexNowPayload();
  const get = url => fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  const keyResponse = await get(payload.keyLocation);
  if (keyResponse.status !== 200 || (await keyResponse.text()).trim() !== INDEXNOW_KEY) {
    throw new Error('The deployed IndexNow verification file does not match. Deploy the current code before submitting.');
  }
  await Promise.all(payload.urlList.map(async url => {
    const response = await get(url);
    if (response.status !== 200 || /\bnoindex\b/i.test(response.headers.get('X-Robots-Tag') || '')) {
      throw new Error(`Public URL is not ready for indexing: ${url}`);
    }
    const body = await response.text();
    const canonical = body.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i)?.[1];
    if (canonical?.replaceAll('&amp;', '&') !== url || /<meta\b[^>]*name=["']robots["'][^>]*content=["'][^"']*\bnoindex\b/i.test(body)) {
      throw new Error(`Public URL has missing or conflicting indexing metadata: ${url}`);
    }
  }));
  const result = await fetchImpl(INDEXNOW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  });
  if (![200, 202].includes(result.status)) {
    throw new Error(`IndexNow returned HTTP ${result.status}. Review the response status before retrying; no automatic retry was sent.`);
  }
  return { status: result.status, submitted: payload.urlList, keyValidationPending: result.status === 202 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length && !['--dry-run', '--submit'].includes(args[0]))) {
    console.error('Usage: node scripts/notify-indexnow.mjs [--dry-run|--submit]');
    process.exitCode = 1;
  } else if (args[0] === '--submit') {
    try {
      const result = await notifyIndexNow();
      console.log(JSON.stringify({ ...result, message: 'Notification received by IndexNow. Crawling, indexing, and ranking remain search-engine decisions.' }, null, 2));
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  } else {
    console.log(JSON.stringify({ endpoint: INDEXNOW_ENDPOINT, method: 'POST', payload: indexNowPayload(), submitted: false }, null, 2));
  }
}
