// Minimal RFC 6455 helpers for the Cloudflare TCP upstream socket.
// Production Workers cannot fetch() a raw IP:port WebSocket, so /party
// speaks WebSocket frames over cloudflare:sockets instead.

export function parseUpstreamTarget(url) {
  const raw = String(url || '').trim();
  const httpUrl = raw.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
  const u = new URL(httpUrl.includes('://') ? httpUrl : `http://${httpUrl}`);
  const port = u.port ? Number(u.port) : (u.protocol === 'https:' ? 443 : 80);
  const path = u.pathname && u.pathname !== '/' ? u.pathname + u.search : '/';
  return {
    hostname: u.hostname,
    port,
    path: path || '/',
    hostHeader: u.port ? `${u.hostname}:${u.port}` : u.hostname,
  };
}

export function randomWsKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function buildUpgradeRequest(target, key = randomWsKey()) {
  return (
    `GET ${target.path} HTTP/1.1\r\n` +
    `Host: ${target.hostHeader}\r\n` +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Key: ${key}\r\n` +
    'Sec-WebSocket-Version: 13\r\n' +
    '\r\n'
  );
}

export function findHeaderEnd(buf) {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) return i + 4;
  }
  return -1;
}

export function concatBytes(a, b) {
  if (!a.length) return b;
  if (!b.length) return a;
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export function encodeWsFrame(payload, opcode = 1, masked = true) {
  const data = typeof payload === 'string'
    ? new TextEncoder().encode(payload)
    : payload instanceof Uint8Array
      ? payload
      : new Uint8Array(payload);
  const len = data.length;
  const maskKey = masked ? crypto.getRandomValues(new Uint8Array(4)) : null;

  let header;
  if (len < 126) {
    header = new Uint8Array(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = (masked ? 0x80 : 0) | len;
  } else if (len < 65536) {
    header = new Uint8Array(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = (masked ? 0x80 : 0) | 126;
    header[2] = (len >> 8) & 0xff;
    header[3] = len & 0xff;
  } else {
    header = new Uint8Array(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = (masked ? 0x80 : 0) | 127;
    const view = new DataView(header.buffer);
    view.setUint32(2, 0);
    view.setUint32(6, len);
  }

  const out = new Uint8Array(header.length + (masked ? 4 : 0) + len);
  out.set(header, 0);
  let offset = header.length;
  if (masked) {
    out.set(maskKey, offset);
    offset += 4;
    for (let i = 0; i < len; i++) out[offset + i] = data[i] ^ maskKey[i & 3];
  } else {
    out.set(data, offset);
  }
  return out;
}

export function tryDecodeWsFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const fin = (buf[0] & 0x80) !== 0;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let offset = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = (buf[2] << 8) | buf[3];
    offset = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    if (view.getUint32(offset) !== 0) throw new Error('frame too large');
    len = view.getUint32(offset + 4);
    offset = 10;
  }
  if (masked) {
    if (buf.length < offset + 4 + len) return null;
    const key = buf.subarray(offset, offset + 4);
    offset += 4;
    const payload = new Uint8Array(len);
    for (let i = 0; i < len; i++) payload[i] = buf[offset + i] ^ key[i & 3];
    return { opcode, fin, payload, bytes: offset + len };
  }
  if (buf.length < offset + len) return null;
  return { opcode, fin, payload: buf.subarray(offset, offset + len), bytes: offset + len };
}
