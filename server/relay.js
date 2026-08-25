// Dungeon Together — relay server.
// One process serves BOTH the static game and the WebSocket relay, so the
// browser talks same-origin ws:// with zero TLS/mixed-content headaches.
//
//   node relay.js [port]          (default 3117)
//
// The server is a room-scoped relay: it never simulates combat. It does
// hold in-memory seats + the last safe checkpoint so a climber can resume
// while this process is alive. That memory is not durable across restarts.

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.argv[2] || process.env.PORT || 3117);
const GAME_ROOT = path.join(__dirname, '..');

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
const { createPartyHub } = require('./party-session');
const hub = createPartyHub();

const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  hub.connect(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    hub.receive(ws, msg);
  });

  ws.on('close', () => hub.disconnect(ws));
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
