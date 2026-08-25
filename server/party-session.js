// In-memory party rooms + multiplayer checkpoints.
// Not durable across process restart. No account system. One resume token
// maps to one seat in one room. Combat is never stored as a restorable snapshot.

const CHECKPOINT_SCHEMA = 2;
const GAME_CONTENT_VERSION = 'dt-mp-2';
const MAX_ROOM = 4;
const MAX_CHECKPOINT_BYTES = 200_000;
const SAFE_PHASES = new Set(['floor-ready', 'floor-resolved', 'ended']);
const PHASE_RANK = { 'floor-ready': 1, 'floor-resolved': 2, ended: 9 };
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function checkpointRevision(floor, phase) {
  const rank = PHASE_RANK[phase];
  if (rank == null) return null;
  return Math.max(0, Math.floor(Number(floor) || 0)) * 10 + rank;
}

function jsonSize(value) {
  try { return JSON.stringify(value).length; }
  catch { return Infinity; }
}

function hasCombatPending(run) {
  return run?.pending?.kind === 'combat' || run?.pending?.kind === 'boss';
}

function makeCode(rooms) {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function livePlayers(room) {
  return [...room.seats.values()].filter(s => s.ws);
}

function roster(room) {
  return livePlayers(room).map(s => ({
    id: s.id, name: s.name, host: s.id === room.hostId,
  }));
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(room, msg, exceptId = null) {
  const raw = JSON.stringify(msg);
  for (const s of room.seats.values()) {
    if (s.id !== exceptId && s.ws && s.ws.readyState === 1) s.ws.send(raw);
  }
}

function tokenKey(token) {
  return String(token || '').trim().toLowerCase();
}

function emptyLive() {
  return {
    phase: 'safe',
    floorContent: {},
    picks: {},
    pickOrder: {},
    evPicks: {},
    evPickOrder: {},
    cardResults: {},
    eventResults: {},
    gates: {},
    claimedWrld: [],
    eliminated: [],
    throne: null,
    decisionMode: 'majority',
  };
}

function liveFromCheckpoint(cp) {
  const live = emptyLive();
  live.phase = 'safe';
  if (!cp?.shared) return live;
  const s = cp.shared;
  live.floorContent = { ...(s.floorContent || {}) };
  live.cardResults = { ...(s.cardResults || {}) };
  live.eventResults = { ...(s.eventResults || {}) };
  live.claimedWrld = [...(s.claimedWrld || [])];
  live.eliminated = [...(s.eliminated || [])];
  live.decisionMode = s.decisionMode || 'majority';
  live.throne = s.throne || null;
  return live;
}

function pickHost(room) {
  const live = livePlayers(room);
  if (!live.length) return null;
  const current = live.find(s => s.id === room.hostId);
  if (current) return current.id;
  live.sort((a, b) => a.id < b.id ? -1 : 1);
  return live[0].id;
}

function validateCheckpoint(cp, current) {
  if (!cp || typeof cp !== 'object') return { ok: false, why: 'missing', code: 'unrecoverable' };
  if (cp.schema === 1 || cp.gameVersion === 'dt-mp-1') {
    cp = { ...cp, schema: CHECKPOINT_SCHEMA, gameVersion: GAME_CONTENT_VERSION };
  }
  if (cp.schema !== CHECKPOINT_SCHEMA) return { ok: false, why: 'schema', code: 'incompatible' };
  if (cp.gameVersion !== GAME_CONTENT_VERSION) return { ok: false, why: 'version', code: 'incompatible' };
  if (!SAFE_PHASES.has(cp.phase)) return { ok: false, why: 'unsafe-phase', code: 'unrecoverable' };
  if (!cp.runId || typeof cp.runId !== 'string') return { ok: false, why: 'runId', code: 'unrecoverable' };
  const revision = checkpointRevision(cp.floor, cp.phase);
  if (revision == null || cp.revision !== revision) return { ok: false, why: 'revision', code: 'unrecoverable' };
  if (jsonSize(cp) > MAX_CHECKPOINT_BYTES) return { ok: false, why: 'too-large', code: 'unrecoverable' };
  if (current) {
    if (cp.runId !== current.runId) return { ok: false, why: 'run-mismatch', code: 'unrecoverable' };
    if (cp.revision < current.revision) return { ok: false, why: 'stale', code: 'stale' };
    if (cp.revision === current.revision
      && (cp.floor !== current.floor || cp.phase !== current.phase)) {
      return { ok: false, why: 'revision-conflict', code: 'stale' };
    }
  }
  return { ok: true };
}

function sanitizeClimber(input) {
  if (!input || typeof input !== 'object') return { ok: false, why: 'no-climber' };
  if (hasCombatPending(input)) return { ok: false, why: 'combat-pending' };
  let cloned;
  try { cloned = JSON.parse(JSON.stringify(input)); }
  catch { return { ok: false, why: 'not-serializable' }; }
  delete cloned.pending;
  cloned.coopMode = true;
  if (jsonSize(cloned) > MAX_CHECKPOINT_BYTES) return { ok: false, why: 'too-large' };
  return { ok: true, climber: cloned };
}

function noteLiveMsg(room, fromId, data) {
  if (!data || typeof data !== 'object') return;
  const live = room.live || (room.live = emptyLive());
  switch (data.k) {
    case 'floor':
      if (data.floor != null) live.floorContent[data.floor] = data;
      break;
    case 'pick':
      if (data.floor == null || data.idx == null) break;
      live.picks[data.floor] = live.picks[data.floor] || {};
      live.pickOrder[data.floor] = live.pickOrder[data.floor] || [];
      if (live.picks[data.floor][fromId] == null) live.pickOrder[data.floor].push(fromId);
      live.picks[data.floor][fromId] = data.idx;
      break;
    case 'evpick': {
      if (data.floor == null || data.eventId == null || data.idx == null) break;
      const key = `${data.floor}:${data.eventId}`;
      live.evPicks[key] = live.evPicks[key] || {};
      live.evPickOrder[key] = live.evPickOrder[key] || [];
      if (live.evPicks[key][fromId] == null) live.evPickOrder[key].push(fromId);
      live.evPicks[key][fromId] = data.idx;
      break;
    }
    case 'cardresult':
      if (data.floor != null && live.cardResults[data.floor] == null) live.cardResults[data.floor] = data.idx;
      break;
    case 'evresult':
      if (data.floor != null && data.eventId != null) {
        const key = `${data.floor}:${data.eventId}`;
        if (live.eventResults[key] == null) live.eventResults[key] = data.idx;
      }
      break;
    case 'gate':
      if (data.tag) {
        live.gates[data.tag] = live.gates[data.tag] || [];
        if (!live.gates[data.tag].includes(fromId)) live.gates[data.tag].push(fromId);
      }
      break;
    case 'wrldclaim':
      if (data.id && !live.claimedWrld.includes(data.id)) live.claimedWrld.push(data.id);
      break;
    case 'elim':
      if (!live.eliminated.includes(fromId)) live.eliminated.push(fromId);
      break;
    case 'throne':
      live.throne = data;
      break;
    case 'mode':
      if (data.mode) live.decisionMode = data.mode;
      break;
    default:
      break;
  }
}

function resumePayload(room, seat, { wait = null } = {}) {
  return {
    t: 'resume-ok',
    you: seat.id,
    code: room.code,
    host: seat.id === room.hostId,
    seed: room.seed,
    roster: roster(room),
    pub: !!room.pub,
    runId: room.runId || null,
    token: seat.token,
    wait,
    checkpoint: room.checkpoint || null,
    climber: seat.climber || null,
    live: room.live || emptyLive(),
  };
}

function kickSeat(seat, why) {
  if (!seat?.ws) return;
  const old = seat.ws;
  send(old, { t: 'kicked', why: why || 'resumed-elsewhere' });
  seat.ws = null;
  try { old.close(); } catch {}
}

function createPartyHub() {
  const rooms = new Map();
  const sockets = new Map(); // ws -> { room, seatId }
  const tokens = new Map(); // token -> { code, playerId }
  let nextId = 1;

  const allocId = () => 'p' + (nextId++);

  function roomOf(ws) {
    return sockets.get(ws)?.room || null;
  }

  function seatOf(ws) {
    const bind = sockets.get(ws);
    if (!bind) return null;
    return bind.room.seats.get(bind.seatId) || null;
  }

  function bindSocket(ws, room, seat) {
    const prev = sockets.get(ws);
    if (prev && (prev.room !== room || prev.seatId !== seat.id)) {
      disconnect(ws, { keepSeat: true });
    }
    sockets.set(ws, { room, seatId: seat.id });
    seat.ws = ws;
    seat.away = false;
  }

  function findToken(token) {
    const key = tokenKey(token);
    if (!key) return null;
    const loc = tokens.get(key);
    if (!loc) return null;
    const room = rooms.get(loc.code);
    const seat = room?.seats.get(loc.playerId);
    if (!seat || seat.token !== key) return null;
    return { room, seat, key };
  }

  function rememberToken(seat, room) {
    if (!seat.token) return;
    tokens.set(seat.token, { code: room.code, playerId: seat.id });
  }

  function forgetToken(seat) {
    if (seat?.token) tokens.delete(seat.token);
  }

  function addSeat(room, { ws, name, token, host }) {
    const id = allocId();
    const seat = {
      id,
      name: String(name || 'Climber').slice(0, 16),
      token: tokenKey(token) || null,
      ws,
      away: false,
      climber: null,
      climberRevision: 0,
    };
    room.seats.set(id, seat);
    if (host) room.hostId = id;
    bindSocket(ws, room, seat);
    rememberToken(seat, room);
    return seat;
  }

  function abandonEmpty(room) {
    if (livePlayers(room).length) return;
    // Keep started climbs so they can be resumed from the last safe checkpoint.
    // Lobby rooms with nobody left still expire immediately.
    // Retention: started-empty rooms live until this relay process exits.
    // There is no idle TTL and no max-abandoned-rooms bound, so a long-lived
    // Oracle accumulates one room plus seat snapshots per disconnected party.
    // Bounded eviction or a multi-hour idle expiry is required for production
    // traffic; a short (e.g. five-minute) cap would drop same-day resumes.
    if (!room.started) {
      for (const s of room.seats.values()) forgetToken(s);
      rooms.delete(room.code);
    } else {
      room.hostId = [...room.seats.keys()][0] || null;
      room.live = liveFromCheckpoint(room.checkpoint);
    }
  }

  function openPublicRooms() {
    return [...rooms.values()].filter(r => r.pub && !r.started && livePlayers(r).length > 0 && livePlayers(r).length < MAX_ROOM);
  }

  function joinRoom(ws, room, name, token) {
    const seat = addSeat(room, { ws, name, token, host: false });
    send(ws, {
      t: 'room',
      code: room.code,
      you: seat.id,
      host: false,
      seed: room.seed,
      roster: roster(room),
      pub: !!room.pub,
      token: seat.token,
      runId: room.runId || null,
    });
    broadcast(room, { t: 'roster', roster: roster(room) }, seat.id);
    return seat;
  }

  function handleResume(ws, msg) {
    const found = findToken(msg.token);
    const code = String(msg.code || '').toUpperCase();
    if (!found || (code && found.room.code !== code)) {
      return send(ws, { t: 'err', why: 'No saved party remains on this relay.', code: 'expired' });
    }
    const { room, seat } = found;
    if (room.checkpoint) {
      const v = validateCheckpoint(room.checkpoint, null);
      if (!v.ok && v.code === 'incompatible') {
        return send(ws, { t: 'err', why: 'This climb is from an incompatible game version.', code: 'incompatible' });
      }
    }
    if (seat.ws && seat.ws !== ws) {
      const old = seat.ws;
      sockets.delete(old);
      kickSeat(seat, 'resumed-elsewhere');
    }
    bindSocket(ws, room, seat);
    if (msg.name) seat.name = String(msg.name).slice(0, 16);
    room.hostId = pickHost(room) || seat.id;
    const othersLive = livePlayers(room).some(s => s.id !== seat.id);
    const wait = (room.live?.phase === 'combat' && othersLive) ? 'combat' : null;
    send(ws, resumePayload(room, seat, { wait }));
    broadcast(room, { t: 'roster', roster: roster(room) }, seat.id);
    broadcast(room, { t: 'msg', from: seat.id, data: { k: 'rejoin', name: seat.name } }, seat.id);
  }

  function handleCheckpoint(ws, msg) {
    const room = roomOf(ws);
    const seat = seatOf(ws);
    if (!room || !seat) return;
    if (!room.started || !room.runId) return send(ws, { t: 'err', why: 'No climb is in progress.', code: 'expired' });
    const cp = msg.checkpoint;
    if (cp) {
      if (seat.id !== room.hostId) {
        // Guests may not advance shared party state.
      } else {
        const v = validateCheckpoint(cp, room.checkpoint);
        if (!v.ok) return send(ws, { t: 'err', why: v.why, code: v.code });
        if (cp.runId !== room.runId) return send(ws, { t: 'err', why: 'run-mismatch', code: 'unrecoverable' });
        const prevRev = room.checkpoint?.revision || 0;
        room.checkpoint = cp;
        if (cp.phase !== 'ended' && cp.revision > prevRev) {
          room.live = { ...liveFromCheckpoint(cp), phase: 'safe' };
        }
      }
    }
    if (msg.climber) {
      const s = sanitizeClimber(msg.climber);
      if (!s.ok) return send(ws, { t: 'err', why: s.why, code: 'unrecoverable' });
      const rev = Number(msg.revision);
      if (Number.isFinite(rev) && rev < seat.climberRevision) {
        return send(ws, { t: 'err', why: 'stale', code: 'stale' });
      }
      seat.climber = s.climber;
      if (Number.isFinite(rev)) seat.climberRevision = Math.max(seat.climberRevision, rev);
    }
    if (seat.id === room.hostId && room.checkpoint) {
      broadcast(room, { t: 'checkpoint', checkpoint: room.checkpoint, live: room.live }, null);
    }
  }

  function handlePhase(ws, msg) {
    const room = roomOf(ws);
    const seat = seatOf(ws);
    if (!room || !seat || seat.id !== room.hostId) return;
    const phase = msg.phase === 'combat' ? 'combat' : 'safe';
    if (livePlayers(room).length === 0) {
      room.live = liveFromCheckpoint(room.checkpoint);
      return;
    }
    room.live = room.live || emptyLive();
    room.live.phase = phase;
    broadcast(room, { t: 'phase', phase }, seat.id);
    if (phase === 'safe') {
      for (const s of room.seats.values()) {
        if (s.ws && s.ws !== ws) send(s.ws, { t: 'checkpoint', checkpoint: room.checkpoint, live: room.live, wait: null });
      }
    }
  }

  function handleDiscard(ws, msg) {
    const found = findToken(msg.token) || (() => {
      const seat = seatOf(ws);
      const room = roomOf(ws);
      return seat && room ? { room, seat } : null;
    })();
    if (!found) {
      send(ws, { t: 'discarded' });
      return;
    }
    const { room, seat } = found;
    forgetToken(seat);
    if (seat.ws && seat.ws !== ws) kickSeat(seat, 'discarded');
    room.seats.delete(seat.id);
    sockets.delete(ws);
    if (seat.ws) sockets.delete(seat.ws);
    seat.ws = null;
    if (!room.seats.size) {
      rooms.delete(room.code);
    } else {
      room.hostId = pickHost(room) || [...room.seats.keys()][0];
      broadcast(room, { t: 'left', id: seat.id, roster: roster(room) });
      abandonEmpty(room);
    }
    send(ws, { t: 'discarded' });
  }

  function receive(ws, msg) {
    if (typeof msg !== 'object' || !msg) return;
    switch (msg.t) {
      case 'create': {
        if (roomOf(ws)) return;
        const key = tokenKey(msg.token);
        if (key && tokens.has(key)) {
          return send(ws, { t: 'err', why: 'This browser already has a saved party climb.', code: 'has-save' });
        }
        const code = makeCode(rooms);
        const room = {
          code,
          seats: new Map(),
          hostId: null,
          seed: (Math.random() * 0xFFFFFFFF) >>> 0,
          pub: !!msg.pub,
          started: false,
          runId: null,
          checkpoint: null,
          live: emptyLive(),
        };
        rooms.set(code, room);
        const seat = addSeat(room, { ws, name: msg.name, token: key, host: true });
        send(ws, {
          t: 'room', code, you: seat.id, host: true, seed: room.seed,
          roster: roster(room), pub: room.pub, token: seat.token, runId: null,
        });
        break;
      }
      case 'join': {
        if (roomOf(ws)) return;
        const r = rooms.get(String(msg.code || '').toUpperCase());
        if (!r) return send(ws, { t: 'err', why: 'No such room. Codes expire when everyone leaves.', code: 'expired' });
        if (r.started) return send(ws, { t: 'err', why: 'That party has already entered the tower.', code: 'started' });
        if (livePlayers(r).length >= MAX_ROOM) return send(ws, { t: 'err', why: 'Room is full (4 max).' });
        const key = tokenKey(msg.token);
        if (key && tokens.has(key)) {
          return send(ws, { t: 'err', why: 'This browser already has a saved party climb.', code: 'has-save' });
        }
        joinRoom(ws, r, msg.name, key);
        break;
      }
      case 'list': {
        const open = openPublicRooms().slice(0, 20).map(r => ({
          code: r.code,
          count: livePlayers(r).length,
          host: r.seats.get(r.hostId)?.name || 'Climber',
        }));
        send(ws, { t: 'publist', rooms: open });
        break;
      }
      case 'quickjoin': {
        if (roomOf(ws)) return;
        const key = tokenKey(msg.token);
        if (key && tokens.has(key)) {
          return send(ws, { t: 'err', why: 'This browser already has a saved party climb.', code: 'has-save' });
        }
        const open = openPublicRooms();
        if (open.length) joinRoom(ws, open[Math.floor(Math.random() * open.length)], msg.name, key);
        else receive(ws, { t: 'create', name: msg.name, pub: true, token: msg.token });
        break;
      }
      case 'resume':
        handleResume(ws, msg);
        break;
      case 'checkpoint':
        handleCheckpoint(ws, msg);
        break;
      case 'phase':
        handlePhase(ws, msg);
        break;
      case 'discard':
        handleDiscard(ws, msg);
        break;
      case 'msg': {
        const room = roomOf(ws);
        const seat = seatOf(ws);
        if (!room || !seat) return;
        if (msg.data && msg.data.k === 'start') {
          room.started = true;
          room.runId = room.runId || `r-${room.code}-${Date.now().toString(36)}`;
          room.live = emptyLive();
          send(ws, { t: 'run', runId: room.runId });
          broadcast(room, { t: 'run', runId: room.runId }, seat.id);
        }
        if (msg.data && msg.data.k === 'reopen') {
          room.started = false;
          room.runId = null;
          room.checkpoint = null;
          room.live = emptyLive();
          for (const s of room.seats.values()) {
            s.climber = null;
            s.climberRevision = 0;
          }
        }
        noteLiveMsg(room, seat.id, msg.data);
        broadcast(room, { t: 'msg', from: seat.id, data: msg.data }, seat.id);
        break;
      }
    }
  }

  function disconnect(ws, { keepSeat = false } = {}) {
    const bind = sockets.get(ws);
    sockets.delete(ws);
    if (!bind) return;
    const { room, seatId } = bind;
    const seat = room.seats.get(seatId);
    if (!seat) return;
    if (seat.ws === ws) seat.ws = null;
    if (keepSeat) return;
    const persist = room.started && seat.token;
    if (persist) {
      seat.away = true;
      room.hostId = pickHost(room) || seat.id;
      broadcast(room, { t: 'left', id: seat.id, roster: roster(room) });
      abandonEmpty(room);
      return;
    }
    forgetToken(seat);
    room.seats.delete(seat.id);
    if (!room.seats.size || (livePlayers(room).length === 0 && !room.started)) {
      for (const s of room.seats.values()) forgetToken(s);
      rooms.delete(room.code);
      return;
    }
    room.hostId = pickHost(room) || [...room.seats.keys()][0];
    broadcast(room, { t: 'left', id: seat.id, roster: roster(room) });
    abandonEmpty(room);
  }

  function connect(ws) {
    // Identity is assigned on create/join/resume, not on the socket itself.
    return ws;
  }

  return {
    rooms,
    tokens,
    connect,
    receive,
    disconnect,
    constants: { CHECKPOINT_SCHEMA, GAME_CONTENT_VERSION, MAX_ROOM },
  };
}

module.exports = { createPartyHub, checkpointRevision, GAME_CONTENT_VERSION, CHECKPOINT_SCHEMA };
