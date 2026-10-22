// Render-only Node smoke tests import the real Wrangler bundle. The public GET
// routes do not construct Durable Objects; fail closed if that ever changes.
const workerStub = 'data:text/javascript,' + encodeURIComponent(`
  export class DurableObject {
    constructor() { throw new Error('A render smoke test must not construct a Durable Object'); }
  }
`);

export function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return { url: workerStub, shortCircuit: true };
  return nextResolve(specifier, context);
}
