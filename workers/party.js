// Cloudflare Worker entry: static assets + wss://<host>/party proxy.
// Named helpers live in party-proxy.js — this file may only default-export
// a fetch handler or workerd rejects the module.

import { handleParty, isPartyPath } from './party-proxy.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isPartyPath(url.pathname)) return handleParty(request, env);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
