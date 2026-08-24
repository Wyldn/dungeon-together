// Bidirectional WebSocket transport proxy.
// Forwards frames as-is to the Oracle party server — no protocol parsing.
'use strict';

const { WebSocket, WebSocketServer } = require('ws');

const UPSTREAM = process.env.PARTY_UPSTREAM || 'ws://132.226.66.6:3117';
const CONNECT_TIMEOUT_MS = Number(process.env.PARTY_UPSTREAM_TIMEOUT_MS || 8000);
const PING_MS = 25000;

function closeCode(code) {
  if (!code || code === 1005 || code === 1006 || code < 1000 || code > 4999) return 1011;
  return code;
}

function safeClose(ws, code = 1011, reason = 'proxy') {
  if (!ws) return;
  if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) return;
  try {
    ws.close(closeCode(code), typeof reason === 'string' ? reason.slice(0, 123) : 'proxy');
  } catch {
    try { ws.terminate(); } catch { /* already gone */ }
  }
}

function pipePartySockets(client, upstream) {
  let closed = false;
  const shutdown = (code, reason) => {
    if (closed) return;
    closed = true;
    safeClose(client, code, reason);
    safeClose(upstream, code, reason);
  };

  const forward = (from, to) => {
    from.on('message', (data, isBinary) => {
      if (to.readyState !== WebSocket.OPEN) return;
      try { to.send(data, { binary: !!isBinary }); } catch { shutdown(1011, 'forward failed'); }
    });
    from.on('close', (code) => shutdown(code, 'peer closed'));
    from.on('error', () => shutdown(1011, 'socket error'));
  };

  forward(client, upstream);
  forward(upstream, client);

  const ping = setInterval(() => {
    if (client.readyState === WebSocket.OPEN) {
      try { client.ping(); } catch { /* ignore */ }
    }
    if (upstream.readyState === WebSocket.OPEN) {
      try { upstream.ping(); } catch { /* ignore */ }
    }
  }, PING_MS);
  if (typeof ping.unref === 'function') ping.unref();
  const stopPing = () => clearInterval(ping);
  client.on('close', stopPing);
  upstream.on('close', stopPing);

  return { shutdown };
}

function attachPartyProxy(server, { upstreamUrl = UPSTREAM, timeoutMs = CONNECT_TIMEOUT_MS } = {}) {
  // Hold the browser handshake until the Oracle socket is open so
  // client onopen means the party server is actually reachable.
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    let settled = false;
    let upstream = null;

    const fail = () => {
      if (settled) return;
      settled = true;
      safeClose(upstream, 1001, 'upgrade failed');
      try { socket.destroy(); } catch { /* already gone */ }
    };

    const timer = setTimeout(fail, timeoutMs);

    try {
      upstream = new WebSocket(upstreamUrl);
    } catch {
      clearTimeout(timer);
      fail();
      return;
    }

    upstream.on('open', () => {
      if (settled) {
        safeClose(upstream, 1001, 'late open');
        return;
      }
      settled = true;
      clearTimeout(timer);
      wss.handleUpgrade(req, socket, head, (client) => {
        wss.emit('connection', client, req);
        pipePartySockets(client, upstream);
      });
    });

    upstream.on('error', () => { clearTimeout(timer); fail(); });
    upstream.on('close', () => { if (!settled) { clearTimeout(timer); fail(); } });
    socket.on('error', () => { clearTimeout(timer); fail(); });
    socket.on('close', () => {
      if (!settled) {
        clearTimeout(timer);
        safeClose(upstream, 1001, 'client gone');
      }
    });
  });

  return wss;
}

module.exports = {
  UPSTREAM,
  CONNECT_TIMEOUT_MS,
  pipePartySockets,
  attachPartyProxy,
  safeClose,
};
