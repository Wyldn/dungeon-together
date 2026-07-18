// Client networking: thin wrapper over the relay's WebSocket protocol.
// Game-level messages ride inside {t:'msg', data:{k:...}} envelopes.

// When the game is served by the relay itself, same-origin just works.
// Anywhere else (GitHub Pages, localhost python server), fall back to the
// public relay below.
export const PUBLIC_RELAY = 'ws://132.226.66.6:3117';
export const PUBLIC_GAME_URL = 'http://132.226.66.6:3117/';

export function defaultServerUrl() {
  // https page → ws:// is blocked by mixed-content rules; caller should
  // detect this via canUseSameOrigin() and direct players to PUBLIC_GAME_URL.
  if (location.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(location.hostname)) {
    return `ws://${location.host}`;
  }
  return PUBLIC_RELAY;
}

export function isMixedContentBlocked() {
  return location.protocol === 'https:';
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
  }

  connect(url) {
    return new Promise((resolve, reject) => {
      try { this.ws = new WebSocket(url); } catch (e) { return reject(e); }
      const timer = setTimeout(() => { this.ws.close(); reject(new Error('timeout')); }, 8000);
      this.ws.onopen = () => { clearTimeout(timer); resolve(); };
      this.ws.onerror = () => { clearTimeout(timer); reject(new Error('connect failed')); };
      this.ws.onmessage = ev => this._route(JSON.parse(ev.data));
      this.ws.onclose = () => this._emitSys('close', {});
    });
  }

  _route(msg) {
    if (msg.t === 'msg') {
      const set = this.handlers.get(msg.data?.k);
      if (set) for (const fn of [...set]) fn(msg.data, msg.from);
      const any = this.handlers.get('*');
      if (any) for (const fn of [...any]) fn(msg.data, msg.from);
    } else {
      if (msg.t === 'room') {
        this.you = msg.you; this.code = msg.code; this.isHost = msg.host;
        this.seed = msg.seed; this.roster = msg.roster;
      }
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

  create(name, pub = false) { this.ws.send(JSON.stringify({ t: 'create', name, pub })); }
  join(code, name) { this.ws.send(JSON.stringify({ t: 'join', code, name })); }
  quickjoin(name) { this.ws.send(JSON.stringify({ t: 'quickjoin', name })); }
  listPublic() { this.ws.send(JSON.stringify({ t: 'list' })); }

  close() { try { this.ws?.close(); } catch {} this.ws = null; }
}
