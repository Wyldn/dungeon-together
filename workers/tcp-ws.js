// WebSocket client over a Cloudflare TCP socket.
// fetch() in production Workers cannot open ws://IP:custom-port, which is
// how the Oracle relay is reached. cloudflare:sockets can.

import {
  buildUpgradeRequest, concatBytes, encodeWsFrame, findHeaderEnd,
  parseUpstreamTarget, tryDecodeWsFrame,
} from './ws-frames.js';

function emit(target, type, event) {
  for (const fn of target._listeners[type] || []) fn(event);
}

export class TcpWebSocket {
  constructor(socket) {
    this.readyState = 0;
    this._socket = socket;
    this._writer = socket.writable.getWriter();
    this._reader = socket.readable.getReader();
    this._listeners = { message: [], close: [], error: [] };
    this._buf = new Uint8Array(0);
    this._frag = null;
    this._pumping = false;
  }

  addEventListener(type, fn) {
    (this._listeners[type] || (this._listeners[type] = [])).push(fn);
  }

  send(data) {
    if (this.readyState !== 1) return;
    if (typeof data === 'string') {
      this._write(encodeWsFrame(data, 1, true));
      return;
    }
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data)
      : data instanceof Uint8Array ? data
      : new Uint8Array(data);
    this._write(encodeWsFrame(bytes, 2, true));
  }

  close(code = 1000, reason = '') {
    if (this.readyState === 2 || this.readyState === 3) return;
    this.readyState = 2;
    const text = String(reason || '').slice(0, 123);
    const reasonBytes = new TextEncoder().encode(text);
    const payload = new Uint8Array(2 + reasonBytes.length);
    const c = (!code || code < 1000 || code > 4999 || code === 1005 || code === 1006) ? 1000 : code;
    payload[0] = (c >> 8) & 0xff;
    payload[1] = c & 0xff;
    payload.set(reasonBytes, 2);
    this._write(encodeWsFrame(payload, 8, true));
    this._shutdown(c, text);
  }

  async handshake(target, timeoutMs) {
    const req = buildUpgradeRequest(target);
    await this._writer.write(new TextEncoder().encode(req));
    this._pumping = true;
    this._pump();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('upstream upgrade timeout')), timeoutMs);
      this._onOpen = () => { clearTimeout(timer); resolve(); };
      this._onFail = (err) => { clearTimeout(timer); reject(err); };
    });
  }

  async _pump() {
    try {
      while (this._pumping) {
        const { done, value } = await this._reader.read();
        if (done) break;
        this._buf = concatBytes(this._buf, value instanceof Uint8Array ? value : new Uint8Array(value));
        if (this.readyState === 0) {
          const end = findHeaderEnd(this._buf);
          if (end < 0) continue;
          const header = new TextDecoder().decode(this._buf.subarray(0, end));
          this._buf = this._buf.subarray(end);
          if (!/^HTTP\/1\.[01] 101\b/.test(header)) {
            throw new Error('upstream refused WebSocket upgrade');
          }
          this.readyState = 1;
          this._onOpen?.();
        }
        this._drainFrames();
      }
      if (this.readyState !== 3) this._shutdown(1011, 'upstream ended');
    } catch (err) {
      if (this.readyState === 0) this._onFail?.(err);
      else this._shutdown(1011, 'upstream error');
    }
  }

  _drainFrames() {
    while (this.readyState === 1) {
      let frame;
      try { frame = tryDecodeWsFrame(this._buf); } catch { this._shutdown(1011, 'bad frame'); return; }
      if (!frame) return;
      this._buf = this._buf.subarray(frame.bytes);
      const piece = frame.payload instanceof Uint8Array ? frame.payload.slice() : new Uint8Array(frame.payload);
      if (!frame.fin || this._frag) {
        this._frag = this._frag
          ? { opcode: this._frag.opcode, payload: concatBytes(this._frag.payload, piece) }
          : { opcode: frame.opcode, payload: piece };
        if (!frame.fin) continue;
        frame = { opcode: this._frag.opcode, payload: this._frag.payload, fin: true };
        this._frag = null;
      }
      if (frame.opcode === 1) {
        emit(this, 'message', { data: new TextDecoder().decode(frame.payload) });
      } else if (frame.opcode === 2) {
        emit(this, 'message', { data: frame.payload.buffer });
      } else if (frame.opcode === 8) {
        const code = frame.payload.length >= 2 ? (frame.payload[0] << 8) | frame.payload[1] : 1000;
        this._shutdown(code, 'peer closed');
        return;
      } else if (frame.opcode === 9) {
        this._write(encodeWsFrame(frame.payload, 10, true));
      }
    }
  }

  _write(bytes) {
    try {
      Promise.resolve(this._writer.write(bytes)).catch(() => this._shutdown(1011, 'write failed'));
    } catch {
      this._shutdown(1011, 'write failed');
    }
  }

  _shutdown(code, reason) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this._pumping = false;
    try { this._writer.close(); } catch { /* gone */ }
    try { this._socket.close?.(); } catch { /* gone */ }
    emit(this, 'close', { code, reason });
  }
}

export async function openTcpWebSocket(url, connect, timeoutMs = 8000) {
  const target = parseUpstreamTarget(url);
  const socket = connect({ hostname: target.hostname, port: target.port });
  if (socket.opened) {
    await Promise.race([
      socket.opened,
      new Promise((_, reject) => setTimeout(() => reject(new Error('tcp timeout')), timeoutMs)),
    ]);
  }
  const ws = new TcpWebSocket(socket);
  await ws.handshake(target, timeoutMs);
  return ws;
}
