// Headless tests for HTTPS relay selection and the Cloudflare /party proxy.
//   node tools/test_party_proxy.js

import {
  defaultServerUrl, PUBLIC_RELAY, SECURE_RELAY_PATH, isMixedContentBlocked, partyLinkRecovery,
} from '../js/net.js';
import {
  handleParty, isPartyPath, normalizeUpstreamUrl, pipePartySockets, partyUpgradeRequiredResponse,
  DEFAULT_PARTY_UPSTREAM,
} from '../workers/party-proxy.js';

class MockSocket {
  constructor() {
    this.readyState = 1;
    this.sent = [];
    this.closed = null;
    this._listeners = { message: [], close: [], error: [] };
  }
  addEventListener(type, fn) {
    (this._listeners[type] || (this._listeners[type] = [])).push(fn);
  }
  emit(type, event) {
    for (const fn of this._listeners[type] || []) fn(event);
  }
  send(data) { this.sent.push(data); }
  close(code, reason) {
    if (this.readyState === 2 || this.readyState === 3) return;
    this.readyState = 3;
    this.closed = { code, reason };
    this.emit('close', { code, reason });
  }
}

export async function runPartyProxyTests(t) {
  t('https uses same-origin wss /party',
    defaultServerUrl({ protocol: 'https:', host: 'dt.example.workers.dev', hostname: 'dt.example.workers.dev' })
      === `wss://dt.example.workers.dev${SECURE_RELAY_PATH}`);
  t('https path is /party not /api/party', SECURE_RELAY_PATH === '/party');
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
  t('https is not treated as mixed-content blocked', isMixedContentBlocked() === false);
  t('lobby drop recovers by rejoin', partyLinkRecovery({ climbing: false, hasCode: true }) === 'rejoin');
  t('mid-climb drop exits the run', partyLinkRecovery({ climbing: true, hasCode: true }) === 'exit-run');
  t('no-code drop exits the lobby', partyLinkRecovery({ climbing: false, hasCode: false }) === 'exit-lobby');

  t('party path matches /party', isPartyPath('/party') && isPartyPath('/party/') && !isPartyPath('/index.html'));
  t('upstream ws url becomes http for fetch upgrade',
    normalizeUpstreamUrl('ws://132.226.66.6:3117') === 'http://132.226.66.6:3117');
  t('default upstream is the oracle http origin', DEFAULT_PARTY_UPSTREAM === 'http://132.226.66.6:3117');

  {
    const res = partyUpgradeRequiredResponse();
    t('non-upgrade helper is 426', res.status === 426);
  }

  {
    const res = await handleParty(new Request('https://host/party'));
    t('GET /party without upgrade is 426', res.status === 426);
    t('426 body explains websocket required', (await res.text()).includes('WebSocket'));
  }

  {
    const res = await handleParty(new Request('https://host/party', {
      headers: { Upgrade: 'websocket' },
    }), {}, {
      async connectUpstream() { throw new Error('down'); },
      upgradeClient() { throw new Error('unused'); },
    });
    t('failed upstream connect is 502', res.status === 502);
  }

  {
    const client = new MockSocket();
    const upstream = new MockSocket();
    const runtime = {
      async connectUpstream() { return upstream; },
      upgradeClient(ws) {
        pipePartySockets(client, ws);
        // Node's Fetch Response forbids status 101; the Worker runtime accepts it.
        return { status: 101 };
      },
    };
    const res = await handleParty(new Request('https://host/party', {
      headers: { Upgrade: 'websocket' },
    }), {}, runtime);
    t('valid upgrade returns 101', res.status === 101);

    const create = JSON.stringify({ t: 'create', name: 'Ava', pub: false });
    client.emit('message', { data: create });
    t('client create forwarded unchanged', upstream.sent[0] === create);

    const room = JSON.stringify({ t: 'room', code: 'ABCD', you: 'p1', host: true, seed: 7, roster: [] });
    upstream.emit('message', { data: room });
    t('oracle room forwarded unchanged', client.sent[0] === room);

    const bin = new Uint8Array([1, 2, 3]).buffer;
    client.emit('message', { data: bin });
    t('binary payload forwarded as-is', upstream.sent[1] === bin);

    const roster = JSON.stringify({ t: 'roster', roster: [{ id: 'p1', name: 'Ava', host: true }, { id: 'p2', name: 'Bo', host: false }] });
    upstream.emit('message', { data: roster });
    t('lobby roster forwarded unchanged', client.sent[1] === roster);
  }

  {
    const a = new MockSocket();
    const b = new MockSocket();
    pipePartySockets(a, b);
    a.close(1000, 'done');
    t('client close closes upstream', b.readyState === 3 && b.closed?.code === 1000);
  }

  {
    const a = new MockSocket();
    const b = new MockSocket();
    pipePartySockets(a, b);
    b.emit('error', {});
    t('upstream error closes the client', a.readyState === 3);
  }

  {
    const assets = { fetched: 0, fetch() { this.fetched++; return new Response('ok'); } };
    const { default: worker } = await import('../workers/party.js');
    const staticRes = await worker.fetch(new Request('https://host/index.html'), { ASSETS: assets });
    t('non-party requests stay on static assets', assets.fetched === 1 && staticRes.status === 200);
    const partyRes = await worker.fetch(new Request('https://host/party'), { ASSETS: assets });
    t('/party does not fall through to assets', assets.fetched === 1 && partyRes.status === 426);
  }
}

const standalone = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/test_party_proxy.js');
if (standalone) {
  let pass = 0, fail = 0;
  function t(name, cond) {
    if (cond) pass++;
    else { fail++; console.error('  ✗ FAIL:', name); }
  }
  try {
    await runPartyProxyTests(t);
  } catch (err) {
    fail++;
    console.error('  ✗ FAIL: party proxy suite threw', err);
  }
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
