// Vercel WebSocket entry: wss://<host>/api/party → ws://132.226.66.6:3117
// The Oracle party server is unchanged; this is TLS/mixed-content transport only.
'use strict';

const http = require('http');
const { attachPartyProxy, UPSTREAM } = require('./party-proxy');

const server = http.createServer((req, res) => {
  const path = (req.url || '/').split('?')[0];
  if (path === '/health' || path === '/api/party/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('ok');
  }
  res.writeHead(426, { 'Content-Type': 'text/plain' });
  res.end('WebSocket upgrade required');
});

attachPartyProxy(server);

module.exports = server;

if (require.main === module) {
  const port = Number(process.env.PORT || 3118);
  server.listen(port, () => {
    console.log(`Dungeon Together party proxy ws://127.0.0.1:${port}/api/party → ${UPSTREAM}`);
  });
}
