// Cloudflare Worker entry: static assets + wss://<host>/party proxy.
// Named helpers live in party-proxy.js — this file may only default-export
// a fetch handler or workerd rejects the module.
//
// Upstream uses cloudflare:sockets, not fetch(). Production Workers cannot
// open a WebSocket to a raw IP and custom port, which is how the Oracle
// relay is addressed.

import {
  handleParty, isPartyPath, pipePartySockets, acceptProxiedSocket,
} from './party-proxy.js';
import { openTcpWebSocket } from './tcp-ws.js';

const runtime = {
  async connectUpstream(url, timeoutMs) {
    const { connect } = await import('cloudflare:sockets');
    return openTcpWebSocket(url, connect, timeoutMs);
  },
  upgradeClient(upstream) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    acceptProxiedSocket(server);
    pipePartySockets(server, upstream);
    return new Response(null, { status: 101, webSocket: client });
  },
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (isPartyPath(url.pathname)) return handleParty(request, env, runtime);
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
};
