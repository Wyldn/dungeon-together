// Cloudflare /party transport helpers. The Worker entry (party.js) may only
// default-export a fetch handler — named exports here are for tests.

export const DEFAULT_PARTY_UPSTREAM = 'http://132.226.66.6:3117';
export const CONNECT_TIMEOUT_MS = 8000;

export function isPartyPath(pathname) {
  return pathname === '/party' || pathname === '/party/';
}

export function isWebSocketUpgrade(request) {
  return (request.headers.get('Upgrade') || '').toLowerCase() === 'websocket';
}

export function partyUpgradeRequiredResponse() {
  return new Response('WebSocket upgrade required', {
    status: 426,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export function partyUnavailableResponse() {
  return new Response('Party server unavailable', {
    status: 502,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

/** Accept ws://, wss://, http://, or https:// and return an http(s) URL for fetch() upgrade. */
export function normalizeUpstreamUrl(url) {
  const raw = String(url || DEFAULT_PARTY_UPSTREAM).trim();
  if (raw.startsWith('ws://')) return `http://${raw.slice(5)}`;
  if (raw.startsWith('wss://')) return `https://${raw.slice(6)}`;
  return raw || DEFAULT_PARTY_UPSTREAM;
}

export function sanitizeCloseCode(code) {
  if (!code || code === 1005 || code === 1006 || code < 1000 || code > 4999) return 1011;
  return code;
}

export function safeClose(ws, code = 1011, reason = 'proxy') {
  if (!ws) return;
  const state = ws.readyState;
  if (state === 2 || state === 3) return;
  const text = typeof reason === 'string' ? reason.slice(0, 123) : 'proxy';
  try {
    ws.close(sanitizeCloseCode(code), text);
  } catch {
    try { ws.close(1011, 'proxy'); } catch { /* already gone */ }
  }
}

/** Bidirectional frame pipe. Does not buffer a session. */
export function pipePartySockets(left, right) {
  let closed = false;
  const shutdown = (code, reason) => {
    if (closed) return;
    closed = true;
    safeClose(left, code, reason);
    safeClose(right, code, reason);
  };

  const forward = (from, to) => {
    from.addEventListener('message', (event) => {
      if (to.readyState !== 1) return;
      try { to.send(event.data); } catch { shutdown(1011, 'forward failed'); }
    });
    from.addEventListener('close', (event) => {
      shutdown(event.code, event.reason || 'peer closed');
    });
    from.addEventListener('error', () => shutdown(1011, 'socket error'));
  };

  forward(left, right);
  forward(right, left);
  return { shutdown };
}

export async function connectUpstream(url, fetchImpl = globalThis.fetch, timeoutMs = CONNECT_TIMEOUT_MS) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const resp = await fetchImpl(url, {
      headers: { Upgrade: 'websocket' },
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
    const ws = resp.webSocket;
    if (!ws) throw new Error('upstream did not accept WebSocket');
    return ws;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function acceptProxiedSocket(ws) {
  if (ws.binaryType !== undefined) ws.binaryType = 'arraybuffer';
  ws.accept({ allowHalfOpen: true });
  return ws;
}

export const cloudflareRuntime = {
  async connectUpstream(url, timeoutMs) {
    const ws = await connectUpstream(url, globalThis.fetch, timeoutMs);
    return acceptProxiedSocket(ws);
  },
  upgradeClient(upstream) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    acceptProxiedSocket(server);
    pipePartySockets(server, upstream);
    return new Response(null, { status: 101, webSocket: client });
  },
};

export async function handleParty(request, env = {}, runtime = cloudflareRuntime) {
  if (!isWebSocketUpgrade(request)) return partyUpgradeRequiredResponse();
  const upstreamUrl = normalizeUpstreamUrl(env.PARTY_UPSTREAM || DEFAULT_PARTY_UPSTREAM);
  let upstream;
  try {
    upstream = await runtime.connectUpstream(upstreamUrl, CONNECT_TIMEOUT_MS);
  } catch {
    return partyUnavailableResponse();
  }
  try {
    return runtime.upgradeClient(upstream);
  } catch {
    safeClose(upstream, 1011, 'upgrade failed');
    return partyUnavailableResponse();
  }
}
