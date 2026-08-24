// Headless tests for the Vercel wss → Oracle ws transport proxy.
// Covers URL selection plus reconnect / error / close piping.
//   node tools/test_party_proxy.js

import { createServer } from 'http';
import { createRequire } from 'module';
import { WebSocket, WebSocketServer } from 'ws';
import { defaultServerUrl, partyLinkRecovery, PUBLIC_RELAY, SECURE_RELAY_PATH, Net } from '../js/net.js';

const require = createRequire(import.meta.url);
const { attachPartyProxy } = require('../api/party-proxy.js');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('no port'));
      resolve(addr.port);
    });
    server.on('error', reject);
  });
}

function closeHttp(httpServer, wss) {
  return new Promise(resolve => {
    try {
      if (wss) {
        for (const ws of wss.clients) {
          try { ws.terminate(); } catch {}
        }
        wss.close();
      }
    } catch {}
    try { httpServer.closeAllConnections?.(); } catch {}
    const timer = setTimeout(() => resolve(), 500);
    httpServer.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function once(target, event, ms = 2500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    const onEvent = (...args) => {
      clearTimeout(timer);
      target.off?.('error', onError);
      resolve(args);
    };
    const onError = (err) => {
      clearTimeout(timer);
      target.off?.(event, onEvent);
      reject(err || new Error(`${event} error`));
    };
    target.once(event, onEvent);
    if (event !== 'error') target.once('error', onError);
  });
}

function openClient(url) {
  const ws = new WebSocket(url);
  return once(ws, 'open').then(() => ws);
}

function waitClosed(ws, ms = 2500) {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.CLOSED) return resolve();
    const timer = setTimeout(() => reject(new Error('timeout waiting for close')), ms);
    const done = () => { clearTimeout(timer); resolve(); };
    ws.once('close', done);
    ws.once('error', done);
  });
}

function readJson(ws, ms = 2500) {
  return once(ws, 'message', ms).then(([data]) => JSON.parse(String(data)));
}

function startMockOracle(onConnect) {
  const httpServer = createServer();
  const wss = new WebSocketServer({ server: httpServer });
  const sockets = [];
  wss.on('connection', ws => {
    sockets.push(ws);
    onConnect?.(ws);
  });
  return listen(httpServer).then(port => ({
    port,
    url: `ws://127.0.0.1:${port}`,
    sockets,
    async close() {
      for (const ws of sockets) {
        try { ws.terminate(); } catch {}
      }
      await closeHttp(httpServer, wss);
    },
  }));
}

function startProxy(upstreamUrl, timeoutMs = 800) {
  const httpServer = createServer((_req, res) => { res.writeHead(426); res.end(); });
  const wss = attachPartyProxy(httpServer, { upstreamUrl, timeoutMs });
  return listen(httpServer).then(port => ({
    port,
    url: `ws://127.0.0.1:${port}/api/party`,
    async close() {
      await closeHttp(httpServer, wss);
    },
  }));
}

export async function runPartyProxyTests(t) {
  t('https uses same-origin wss proxy',
    defaultServerUrl({ protocol: 'https:', host: 'dt.vercel.app', hostname: 'dt.vercel.app' })
      === `wss://dt.vercel.app${SECURE_RELAY_PATH}`);
  t('http oracle host stays same-origin ws',
    defaultServerUrl({ protocol: 'http:', host: '132.226.66.6:3117', hostname: '132.226.66.6' })
      === 'ws://132.226.66.6:3117');
  t('localhost keeps direct public relay',
    defaultServerUrl({ protocol: 'http:', host: 'localhost:8000', hostname: 'localhost' })
      === PUBLIC_RELAY);
  t('127.0.0.1 keeps direct public relay',
    defaultServerUrl({ protocol: 'http:', host: '127.0.0.1:8000', hostname: '127.0.0.1' })
      === PUBLIC_RELAY);
  t('missing location keeps direct public relay', defaultServerUrl(null) === PUBLIC_RELAY);
  t('proxy timeout mid-climb exits the run', partyLinkRecovery({ climbing: true, hasCode: true }) === 'exit-run');
  t('proxy timeout in lobby tries rejoin', partyLinkRecovery({ climbing: false, hasCode: true }) === 'rejoin');
  t('proxy timeout without a room returns to menu', partyLinkRecovery({ climbing: false, hasCode: false }) === 'exit-lobby');

  // Protocol passthrough + reconnect after a clean client drop.
  {
    const frames = [];
    const oracle = await startMockOracle(ws => {
      ws.on('message', raw => {
        const text = String(raw);
        frames.push(text);
        const msg = JSON.parse(text);
        if (msg.t === 'create') {
          ws.send(JSON.stringify({ t: 'room', code: 'ABCD', you: 'p1', host: true, seed: 7, roster: [{ id: 'p1', name: msg.name, host: true }] }));
        } else if (msg.t === 'msg') {
          ws.send(JSON.stringify({ t: 'msg', from: 'p2', data: msg.data }));
        }
      });
    });
    const proxy = await startProxy(oracle.url);
    try {
      const rawCreate = JSON.stringify({ t: 'create', name: 'Ava', pub: false });
      const rawMsg = JSON.stringify({ t: 'msg', data: { k: 'pick', floor: 1, idx: 2 } });

      const a = await openClient(proxy.url);
      a.send(rawCreate);
      const room = await readJson(a);
      t('create envelope reaches mock oracle unchanged', frames[0] === rawCreate);
      t('room reply is forwarded unchanged', room.code === 'ABCD' && room.you === 'p1' && room.host === true);

      a.send(rawMsg);
      const echoed = await readJson(a);
      t('game msg forwarded bidirectionally', frames[1] === rawMsg && echoed.data?.k === 'pick' && echoed.from === 'p2');

      const oracleClosed = waitClosed(oracle.sockets[0]);
      a.close();
      await oracleClosed;
      t('client close tears down upstream', true);

      const b = await openClient(proxy.url);
      b.send(rawCreate);
      const room2 = await readJson(b);
      t('reconnect opens a fresh proxied session', room2.code === 'ABCD' && oracle.sockets.length === 2);
      b.close();
      await waitClosed(b).catch(() => {});
    } finally {
      await proxy.close();
      await oracle.close();
    }
  }

  // Upstream drop / error must close the browser socket.
  {
    const oracle = await startMockOracle(ws => {
      ws.on('message', () => ws.close(1011, 'boom'));
    });
    const proxy = await startProxy(oracle.url);
    try {
      const client = await openClient(proxy.url);
      const closed = waitClosed(client);
      client.send(JSON.stringify({ t: 'create', name: 'Bo' }));
      await closed;
      t('upstream close closes the client', client.readyState === WebSocket.CLOSED);
    } finally {
      await proxy.close();
      await oracle.close();
    }
  }

  // Refused / missing upstream surfaces as a client close (connect error).
  {
    const proxy = await startProxy('ws://127.0.0.1:1', 400);
    try {
      const client = new WebSocket(proxy.url);
      await waitClosed(client, 2000);
      t('upstream refuse closes the client',
        client.readyState === WebSocket.CLOSED || client.readyState === WebSocket.CLOSING);
    } finally {
      await proxy.close();
    }
  }

  // Net wrapper: unexpected close vs intentional close, plus connect failure.
  {
    const oracle = await startMockOracle();
    const proxy = await startProxy(oracle.url);
    try {
      const net = new Net();
      const closes = [];
      net.sys('close', msg => closes.push(msg));
      await net.connect(proxy.url);
      const netClosed = new Promise(r => net.sys('close', r));
      oracle.sockets[0].close(1011, 'drop');
      await netClosed;
      t('Net reports unexpected transport close', closes.length === 1 && !closes[0].intentional);

      const net2 = new Net();
      const closes2 = [];
      const net2Closed = new Promise(r => net2.sys('close', r));
      net2.sys('close', msg => closes2.push(msg));
      await net2.connect(proxy.url);
      net2.close();
      await net2Closed;
      t('Net marks an intentional close', closes2.length === 1 && closes2[0].intentional === true);

      const net3 = new Net();
      let failed = false;
      try {
        await net3.connect('ws://127.0.0.1:1');
      } catch (e) {
        failed = e instanceof Error;
      }
      t('Net.connect rejects an unreachable relay', failed);
    } finally {
      await proxy.close();
      await oracle.close();
    }
  }
}

const standalone = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/test_party_proxy.js');
if (standalone) {
  let pass = 0, fail = 0;
  function t(name, cond) {
    if (cond) { pass++; }
    else { fail++; console.error('  ✗ FAIL:', name); }
  }
  const watchdog = setTimeout(() => {
    console.error('  ✗ FAIL: party proxy suite hung');
    process.exit(1);
  }, 15000);
  try {
    await runPartyProxyTests(t);
  } catch (err) {
    fail++;
    console.error('  ✗ FAIL: party proxy suite threw', err);
  }
  clearTimeout(watchdog);
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
