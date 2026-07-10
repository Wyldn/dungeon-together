// Scripted co-op partner for testing: joins a room, readies up, mirrors
// ready-gates, and passes every combat turn while soaking hits.
//   node test-bot.js <ROOMCODE> [ws://host:port] [name]

const WebSocket = require('ws');

const code = process.argv[2];
const url = process.argv[3] || 'ws://127.0.0.1:3117';
const name = process.argv[4] || 'TestBot';
if (!code) { console.error('usage: node test-bot.js <ROOMCODE> [url] [name]'); process.exit(1); }

const ws = new WebSocket(url);
let you = null;
const me = { hp: 60, maxHp: 60, sanity: 60, maxSanity: 60, level: 1, gold: 30, floor: 0, down: false };

const send = data => ws.send(JSON.stringify({ t: 'msg', data }));
const status = act => send({
  k: 'status', act, classId: 'mage', className: 'Mage', level: me.level,
  hp: me.hp, maxHp: me.maxHp, sanity: me.sanity, maxSanity: me.maxSanity,
  gold: me.gold, floor: me.floor, down: me.down, def: 1, dodge: 8,
});

ws.on('open', () => ws.send(JSON.stringify({ t: 'join', code, name })));

ws.on('message', raw => {
  const msg = JSON.parse(raw);
  if (msg.t === 'room') {
    you = msg.you;
    console.log(`[bot] joined room ${msg.code} as ${you}`);
    send({ k: 'lobby', classId: 'mage', ready: true, name });
    return;
  }
  if (msg.t === 'err') { console.error('[bot] error:', msg.why); process.exit(1); }
  if (msg.t !== 'msg') return;
  const d = msg.data;

  switch (d.k) {
    case 'lobby':
      // stay ready whenever the lobby state changes
      setTimeout(() => send({ k: 'lobby', classId: 'mage', ready: true, name }), 200);
      break;
    case 'start':
      console.log('[bot] run started');
      me.floor = 1;
      status('choosing');
      break;
    case 'floor':
      me.floor = d.floor;
      console.log(`[bot] floor ${d.floor}: ${d.type}${d.eventId ? ' (' + d.eventId + ')' : ''}${d.cards ? ' [' + d.cards.map(c => c.category).join(', ') + ']' : ''}`);
      // next-floor revive (25%)
      if (me.down) { me.down = false; me.hp = Math.round(me.maxHp * 0.25); }
      status('choosing');
      // three-card draw: vote for a random card after a beat
      if (d.type === 'cards') {
        const idx = Math.floor(Math.random() * d.cards.length);
        setTimeout(() => { console.log(`[bot] picking card ${idx}`); send({ k: 'pick', floor: d.floor, idx }); }, 700);
      }
      break;
    case 'cardresult':
      console.log(`[bot] party chose card ${d.idx} on floor ${d.floor}`);
      break;
    case 'mode':
      console.log(`[bot] decision mode: ${d.mode}`);
      break;
    case 'gate':
      // mirror every gate so the host never waits on us
      console.log(`[bot] gate ${d.tag} — mirroring`);
      setTimeout(() => {
        send({ k: 'gate', tag: d.tag });
        if (d.tag.startsWith('fight-')) {
          // combat begins: pass our first turn
          setTimeout(() => { status('fighting'); send({ k: 'cpass', why: 'bot' }); }, 800);
        }
      }, 400);
      break;
    case 'eturn':
      // apply hits aimed at us, then pass our next turn
      for (const op of d.ops || []) {
        if (op.type === 'hit' && op.target === you && !op.dodged) {
          me.hp = Math.max(0, me.hp - op.dmg);
          console.log(`[bot] took ${op.dmg} (hp ${me.hp}/${me.maxHp})`);
          if (me.hp <= 0) { me.down = true; console.log('[bot] DOWN'); }
        }
      }
      status('fighting');
      setTimeout(() => send({ k: 'cpass', why: 'bot' }), 500);
      break;
    case 'cend':
      console.log(`[bot] combat over: ${d.result} (+${d.gold || 0}g +${d.xp || 0}xp)`);
      me.hp = Math.min(me.maxHp, me.hp + 10);
      status('waiting');
      break;
    case 'throne':
      console.log('[bot] throne:', d.ending || 'fight');
      break;
  }
});

ws.on('close', () => { console.log('[bot] disconnected'); process.exit(0); });
