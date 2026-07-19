// Dungeon Together — relay server.
// One process serves BOTH the static game and the WebSocket relay, so the
// browser talks same-origin ws:// with zero TLS/mixed-content headaches.
//
//   node relay.js [port]          (default 3117)
//
// The server is a dumb room-scoped relay: it never simulates the game.
// Room = { code, players: Map<id, {ws, name}>, hostId }

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.argv[2] || process.env.PORT || 3117);
const GAME_ROOT = path.join(__dirname, '..');
const MAX_ROOM = 4;

/* ---------------- static file serving ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  if (urlPath === '/health') { res.writeHead(200); return res.end('ok'); }
  const filePath = path.normalize(path.join(GAME_ROOT, urlPath));
  if (!filePath.startsWith(GAME_ROOT) || filePath.includes('server' + path.sep)) {
    res.writeHead(403); return res.end('forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

/* ---------------- rooms ---------------- */
const rooms = new Map();
let nextId = 1;

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no easy-to-confuse chars
function makeCode() {
  let code;
  do { code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function roster(room) {
  return [...room.players.entries()].map(([id, p]) => ({ id, name: p.name, host: id === room.hostId }));
}

function broadcast(room, msg, exceptId = null) {
  const raw = JSON.stringify(msg);
  for (const [id, p] of room.players) {
    if (id !== exceptId && p.ws.readyState === 1) p.ws.send(raw);
  }
}

const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  const id = 'p' + (nextId++);
  let room = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const send = msg => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (typeof msg !== 'object' || !msg) return;

    const createRoom = (pub) => {
      const code = makeCode();
      room = { code, players: new Map(), hostId: id, seed: (Math.random() * 0xFFFFFFFF) >>> 0, pub: !!pub };
      room.players.set(id, { ws, name: String(msg.name || 'Climber').slice(0, 16) });
      rooms.set(code, room);
      send({ t: 'room', code, you: id, host: true, seed: room.seed, roster: roster(room), pub: room.pub });
    };
    const joinRoom = (r) => {
      room = r;
      room.players.set(id, { ws, name: String(msg.name || 'Climber').slice(0, 16) });
      send({ t: 'room', code: room.code, you: id, host: false, seed: room.seed, roster: roster(room), pub: !!room.pub });
      broadcast(room, { t: 'roster', roster: roster(room) }, id);
    };
    const openPublicRooms = () =>
      [...rooms.values()].filter(r => r.pub && !r.started && r.players.size < MAX_ROOM);

    switch (msg.t) {
      case 'create': {
        if (room) return;
        createRoom(!!msg.pub);
        break;
      }
      case 'join': {
        if (room) return;
        const r = rooms.get(String(msg.code || '').toUpperCase());
        if (!r) return send({ t: 'err', why: 'No such room. Codes expire when everyone leaves.' });
        if (r.players.size >= MAX_ROOM) return send({ t: 'err', why: 'Room is full (4 max).' });
        if (r.started) return send({ t: 'err', why: 'That party has already entered the tower.' });
        joinRoom(r);
        break;
      }
      case 'list': { // open public parties, for a lobby browser
        const open = openPublicRooms().slice(0, 20).map(r => ({
          code: r.code,
          count: r.players.size,
          host: r.players.get(r.hostId)?.name || 'Climber',
        }));
        send({ t: 'publist', rooms: open });
        break;
      }
      case 'quickjoin': { // matchmaking: join any open public party, or host one
        if (room) return;
        const open = openPublicRooms();
        if (open.length) joinRoom(open[Math.floor(Math.random() * open.length)]);
        else createRoom(true);
        break;
      }
      case 'msg': { // game-level payload, relayed verbatim to the rest of the room
        if (!room) return;
        if (msg.data && msg.data.k === 'start') room.started = true;
        // Party returned to lobby after a climb — reopen for public list / join.
        if (msg.data && msg.data.k === 'reopen') room.started = false;
        broadcast(room, { t: 'msg', from: id, data: msg.data }, id);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!room) return;
    room.players.delete(id);
    if (room.players.size === 0) {
      rooms.delete(room.code);
    } else {
      if (room.hostId === id) room.hostId = room.players.keys().next().value;
      broadcast(room, { t: 'left', id, roster: roster(room) });
    }
  });
});

// reap dead connections
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => console.log(`Dungeon Together relay + game on http://0.0.0.0:${PORT}`));
