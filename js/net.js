// Client networking: thin wrapper over the relay's WebSocket protocol.
// Game-level messages ride inside {t:'msg', data:{k:...}} envelopes.

// When the game is served by the relay itself, same-origin just works.
// HTTPS hosts (Cloudflare) use a same-origin wss proxy that forwards to the
// public relay. Localhost / missing location keep talking to the relay
// directly so `python -m http.server` still matches the old workflow.
export const PUBLIC_RELAY = 'ws://132.226.66.6:3117';
export const PUBLIC_GAME_URL = 'http://132.226.66.6:3117/';
export const SECURE_RELAY_PATH = '/party';

export function defaultServerUrl(loc = globalThis.location) {
  if (loc?.protocol === 'https:') {
    return `wss://${loc.host}${SECURE_RELAY_PATH}`;
  }
  if (loc?.protocol === 'http:' && loc.hostname && !['localhost', '127.0.0.1'].includes(loc.hostname)) {
    return `ws://${loc.host}`;
  }
  // Local relay serves the game on the same port (3117+). Static file
  // servers (python -m http.server on 8000/8877, etc.) keep the public relay.
  const host = String(loc?.host || '');
  const port = String(loc?.port || host.split(':')[1] || '');
  const staticDev = new Set(['', '80', '8000', '8080', '5500', '5173', '8877']);
  if (loc?.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(loc.hostname)
    && !staticDev.has(port)) {
    return `ws://${host}`;
  }
  return PUBLIC_RELAY;
}

export function isMixedContentBlocked() {
  return false;
}

/** What to do when the transport drops. Mid-climb seats resume via token. */
export function partyLinkRecovery({ climbing = false, hasCode = false, hasToken = false } = {}) {
  if (climbing && (hasToken || hasCode)) return 'resume';
  if (hasCode) return 'rejoin';
  return 'exit-lobby';
}

export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map(); // k -> Set<fn>
    this.sysHandlers = new Map(); // t -> Set<fn>
    this.you = null;
    this.code = null;
    this.isHost = false;
    this.seed = null;
    this.roster = [];
    this.runId = null;
    this.resumeToken = null;
  }

  connect(url) {
    return new Promise((resolve, reject) => {
      this.intentionalClose = false;
      try { this.ws = new WebSocket(url); } catch (e) { return reject(e); }
      const timer = setTimeout(() => { this.ws.close(); reject(new Error('timeout')); }, 8000);
      this.ws.onopen = () => { clearTimeout(timer); resolve(); };
      this.ws.onerror = () => { clearTimeout(timer); reject(new Error('connect failed')); };
      this.ws.onmessage = ev => this._route(JSON.parse(ev.data));
      this.ws.onclose = () => this._emitSys('close', { intentional: !!this.intentionalClose });
    });
  }

  _route(msg) {
    if (msg.t === 'msg') {
      const set = this.handlers.get(msg.data?.k);
      if (set) for (const fn of [...set]) fn(msg.data, msg.from);
      const any = this.handlers.get('*');
      if (any) for (const fn of [...any]) fn(msg.data, msg.from);
    } else {
      if (msg.t === 'room' || msg.t === 'resume-ok') {
        this.you = msg.you; this.code = msg.code; this.isHost = msg.host;
        this.seed = msg.seed; this.roster = msg.roster;
        if (msg.runId) this.runId = msg.runId;
        if (msg.token) this.resumeToken = msg.token;
      }
      if (msg.t === 'run' && msg.runId) this.runId = msg.runId;
      if (msg.t === 'roster') this.roster = msg.roster;
      if (msg.t === 'left') {
        this.roster = msg.roster;
        // host may have migrated
        this.isHost = msg.roster.find(p => p.id === this.you)?.host || false;
      }
      this._emitSys(msg.t, msg);
    }
  }

  _emitSys(t, msg) {
    const set = this.sysHandlers.get(t);
    if (set) for (const fn of [...set]) fn(msg);
  }

  // game-level messages
  send(data) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify({ t: 'msg', data }));
  }
  on(k, fn) {
    if (!this.handlers.has(k)) this.handlers.set(k, new Set());
    this.handlers.get(k).add(fn);
    return () => this.handlers.get(k)?.delete(fn);
  }
  once(k, filter = null) {
    return new Promise(resolve => {
      const off = this.on(k, (data, from) => {
        if (filter && !filter(data, from)) return;
        off();
        resolve({ data, from });
      });
    });
  }

  // relay-level messages
  sys(t, fn) {
    if (!this.sysHandlers.has(t)) this.sysHandlers.set(t, new Set());
    this.sysHandlers.get(t).add(fn);
    return () => this.sysHandlers.get(t)?.delete(fn);
  }

  create(name, pub = false, token = null) {
    this.ws.send(JSON.stringify({ t: 'create', name, pub, token: token || undefined }));
  }
  join(code, name, token = null) {
    this.ws.send(JSON.stringify({ t: 'join', code, name, token: token || undefined }));
  }
  quickjoin(name, token = null) {
    this.ws.send(JSON.stringify({ t: 'quickjoin', name, token: token || undefined }));
  }
  resume(code, token, name = null) {
    this.ws.send(JSON.stringify({ t: 'resume', code, token, name }));
  }
  discard(token = null) {
    this.ws.send(JSON.stringify({ t: 'discard', token: token || this.resumeToken || undefined }));
  }
  sendCheckpoint(payload) {
    this.ws.send(JSON.stringify({ t: 'checkpoint', ...payload }));
  }
  sendPhase(phase) {
    this.ws.send(JSON.stringify({ t: 'phase', phase }));
  }
  listPublic() { this.ws.send(JSON.stringify({ t: 'list' })); }

  close() {
    this.intentionalClose = true;
    try { this.ws?.close(); } catch {}
    this.ws = null;
  }
}
