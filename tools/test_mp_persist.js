// Multiplayer run persistence: checkpoints, resume tokens, two-client seats.
//   node tools/test_mp_persist.js

import { createRequire } from 'module';
import {
  CHECKPOINT_SCHEMA, GAME_CONTENT_VERSION, buildCheckpoint, catchUpFloors,
  checkpointRevision, classifyResumeMeta, clearCoopResume, COOP_RESUME_KEY,
  loadCoopResume, newResumeToken, saveCoopResume, serializeClimber, validateCheckpoint,
  resumeErrorCopy,
} from '../js/mp_checkpoint.js';
import { newRun } from '../js/state.js';
import { EVENTS } from '../js/data/events.js';
import { eventEligible } from '../js/data/world.js';
import { applyShopBuy } from '../js/shop.js';
import { spendEnemySpecialCharge } from '../js/systems.js';

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

const require = createRequire(import.meta.url);
const {
  createPartyHub, checkpointRevision: serverRevision, GAME_CONTENT_VERSION: serverVersion,
  CHECKPOINT_SCHEMA: serverSchema,
} = require('../server/party-session.js');

class MockWs {
  constructor() {
    this.readyState = 1;
    this.sent = [];
    this.closed = false;
  }
  send(raw) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.closed = true; }
  last(t) { return [...this.sent].reverse().find(m => !t || m.t === t); }
}

function memStorage() {
  const mem = {};
  return {
    getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; },
  };
}

function climber(name = 'Ava', extra = {}) {
  const run = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name, seed: 1 });
  run.coopMode = true;
  run.floor = extra.floor ?? 3;
  run.gold = extra.gold ?? 40;
  Object.assign(run, extra);
  return run;
}

function startTwo(hub, { tokenA = 'aa'.repeat(16), tokenB = 'bb'.repeat(16) } = {}) {
  const a = new MockWs();
  const b = new MockWs();
  hub.receive(a, { t: 'create', name: 'Ava', token: tokenA });
  const room = a.last('room');
  hub.receive(b, { t: 'join', code: room.code, name: 'Bo', token: tokenB });
  hub.receive(a, { t: 'msg', data: { k: 'start', mode: 'majority' } });
  const runId = a.last('run').runId;
  return { a, b, room, runId, tokenA, tokenB };
}

function writeReady(hub, ws, { runId, floor, gold, shared = {} }) {
  const phase = 'floor-ready';
  const built = buildCheckpoint({ runId, floor, phase, seed: 1, shared });
  const ser = serializeClimber(climber('Ava', { floor, gold }));
  hub.receive(ws, { t: 'checkpoint', checkpoint: built.checkpoint, climber: ser.climber, revision: built.checkpoint.revision });
  return built.checkpoint;
}

export async function runMpPersistTests(t) {
  console.log('— multiplayer run persistence —');

  t('client/server schema versions match', CHECKPOINT_SCHEMA === serverSchema && GAME_CONTENT_VERSION === serverVersion);
  t('revision helper matches server', checkpointRevision(4, 'floor-resolved') === serverRevision(4, 'floor-resolved'));
  t('floor-ready precedes floor-resolved on the same floor',
    checkpointRevision(2, 'floor-ready') < checkpointRevision(2, 'floor-resolved'));
  t('later floors outrank earlier resolved floors',
    checkpointRevision(3, 'floor-ready') > checkpointRevision(2, 'floor-resolved'));

  {
    const ser = serializeClimber(climber('Ava', { gold: 77, pending: { kind: 'travel', cards: [] } }));
    t('serialize keeps gold and drops travel pending', ser.ok && ser.climber.gold === 77 && !ser.climber.pending);
    const fight = serializeClimber(climber('Ava', { pending: { kind: 'combat', enemies: [{ id: 'x' }] } }));
    t('serialize rejects mid-combat pending', fight.ok === false && fight.why === 'combat-pending');
    const fnRun = climber('Ava');
    fnRun.onClick = () => {};
    const fnSer = serializeClimber(fnRun);
    t('serialize drops functions', fnSer.ok && fnSer.climber.onClick == null);
  }

  {
    const built = buildCheckpoint({ runId: 'r-1', floor: 2, phase: 'floor-ready', seed: 9, shared: { cardResults: { 2: 1 } } });
    t('buildCheckpoint stamps schema and revision', built.ok && built.checkpoint.schema === 1 && built.checkpoint.revision === 21);
    const older = buildCheckpoint({ runId: 'r-1', floor: 1, phase: 'floor-ready', seed: 9, shared: {} });
    const stale = validateCheckpoint(older.checkpoint, { current: built.checkpoint });
    t('stale revision is rejected', stale.ok === false && stale.code === 'stale');
    const badVer = validateCheckpoint({ ...built.checkpoint, gameVersion: 'dt-mp-0' });
    t('version mismatch is incompatible', badVer.ok === false && badVer.code === 'incompatible');
    const combat = validateCheckpoint({ ...built.checkpoint, phase: 'combat', revision: 20 });
    t('combat phase cannot be a checkpoint', combat.ok === false);
    const dup = validateCheckpoint(built.checkpoint, { current: built.checkpoint });
    t('idempotent same revision is accepted', dup.ok === true);
  }

  {
    const prev = globalThis.localStorage;
    globalThis.localStorage = memStorage();
    clearCoopResume();
    t('empty resume slot is none', classifyResumeMeta(loadCoopResume()).kind === 'none');
    saveCoopResume({ token: 'abc', code: 'ABCD', status: 'active', floor: 4, gameVersion: GAME_CONTENT_VERSION });
    t('active resume is classified', classifyResumeMeta(loadCoopResume()).kind === 'active');
    saveCoopResume({ token: 'abc', code: 'ABCD', status: 'active', gameVersion: 'old' });
    t('old game version is incompatible', classifyResumeMeta(loadCoopResume()).kind === 'incompatible');
    t('resume copy exists for discard/expired', !!resumeErrorCopy('expired').title && !!resumeErrorCopy('incompatible').body);
    clearCoopResume();
    t('discarded local slot is gone', !globalThis.localStorage.getItem(COOP_RESUME_KEY));
    globalThis.localStorage = prev;
  }

  t('catch-up never rewinds', catchUpFloors(5, 3) === 0 && catchUpFloors(3, 5) === 2);
  t('token looks random', newResumeToken().length === 32 && newResumeToken() !== newResumeToken());

  const hub = createPartyHub();
  const { a, b, room, runId, tokenA, tokenB } = startTwo(hub);
  t('two clients share a started room', !!runId && room.code.length === 4 && b.last('room')?.you !== a.last('room')?.you);

  const cp1 = writeReady(hub, a, { runId, floor: 3, gold: 40, shared: { cardResults: {} } });
  t('host floor-ready checkpoint stored', hub.rooms.get(room.code).checkpoint.revision === cp1.revision);

  hub.receive(a, {
    t: 'checkpoint',
    checkpoint: { ...cp1, revision: 11, floor: 1, phase: 'floor-ready' },
    revision: 11,
  });
  t('stale host checkpoint does not overwrite', hub.rooms.get(room.code).checkpoint.floor === 3);
  t('stale write reports stale', a.last('err')?.code === 'stale');

  const goldBefore = 40;
  const serB = serializeClimber(climber('Bo', { floor: 3, gold: goldBefore }));
  hub.receive(b, { t: 'checkpoint', climber: serB.climber, revision: cp1.revision });
  t('guest climber stored without duplicating gold', hub.rooms.get(room.code).seats.get(b.last('room').you).climber.gold === goldBefore);
  hub.receive(b, { t: 'checkpoint', climber: { ...serB.climber, gold: goldBefore }, revision: 11 });
  t('stale guest climber rejected', b.last('err')?.code === 'stale');

  // One player disconnects outside combat: seat persists, party stays live.
  hub.disconnect(b);
  const afterLeave = hub.rooms.get(room.code);
  t('disconnect keeps started room', !!afterLeave && afterLeave.started);
  t('away player is not in the live roster', afterLeave.seats.get(b.last('room').you).away === true
    && !afterLeave.seats.get(b.last('room').you).ws);
  const b2 = new MockWs();
  hub.receive(b2, { t: 'resume', code: room.code, token: tokenB, name: 'Bo' });
  t('rejoin outside combat restores last climber', b2.last('resume-ok')?.climber?.gold === goldBefore);
  t('rejoin outside combat does not wait on combat', b2.last('resume-ok')?.wait == null);

  // Mid-combat: remaining party stays live; rejoiner waits; no combat snapshot.
  hub.receive(a, { t: 'phase', phase: 'combat' });
  hub.disconnect(b2);
  const cWait = new MockWs();
  hub.receive(cWait, { t: 'resume', code: room.code, token: tokenB });
  t('rejoin during live combat waits', cWait.last('resume-ok')?.wait === 'combat');
  t('waiting rejoin does not include a combat pending blob', !cWait.last('resume-ok')?.climber?.pending);

  // Combat completes: next safe floor; waiter is released.
  const cp2 = writeReady(hub, a, { runId, floor: 4, gold: 40, shared: { cardResults: { 3: 0 } } });
  hub.receive(a, { t: 'phase', phase: 'safe' });
  t('post-combat checkpoint is the next floor', hub.rooms.get(room.code).checkpoint.floor === 4 && cp2.phase === 'floor-ready');
  t('safe phase notifies the waiting client', cWait.sent.some(m => m.t === 'checkpoint' && m.wait == null));

  // Duplicate resume / two tabs: newest connection wins.
  const tab1 = new MockWs();
  hub.receive(tab1, { t: 'resume', code: room.code, token: tokenA });
  const tab2 = new MockWs();
  hub.receive(tab2, { t: 'resume', code: room.code, token: tokenA });
  t('second tab kicks the first live socket', tab1.last('kicked')?.why === 'resumed-elsewhere' && tab1.closed);
  t('second tab becomes the live instance', tab2.last('resume-ok')?.you && !tab2.closed);

  // All players disconnect during combat → last safe checkpoint, not combat.
  hub.receive(tab2, { t: 'phase', phase: 'combat' });
  hub.disconnect(tab2);
  hub.disconnect(cWait);
  const empty = hub.rooms.get(room.code);
  t('empty combat room rewinds live phase to last safe checkpoint', empty.live.phase === 'safe' && empty.checkpoint.floor === 4);
  const allBack = new MockWs();
  hub.receive(allBack, { t: 'resume', code: room.code, token: tokenA });
  t('full-party restore is not a mid-combat snapshot', allBack.last('resume-ok')?.wait == null
    && allBack.last('resume-ok')?.checkpoint?.phase === 'floor-ready'
    && allBack.last('resume-ok')?.checkpoint?.floor === 4);

  // Discarded save cannot resume.
  hub.receive(allBack, { t: 'discard', token: tokenA });
  const afterDiscard = new MockWs();
  hub.receive(afterDiscard, { t: 'resume', code: room.code, token: tokenA });
  t('discarded token is expired', afterDiscard.last('err')?.code === 'expired');

  // Incompatible checkpoint on a fresh room.
  const hub2 = createPartyHub();
  const x = new MockWs();
  const y = new MockWs();
  hub2.receive(x, { t: 'create', name: 'Ava', token: 'cc'.repeat(16) });
  const code2 = x.last('room').code;
  hub2.receive(y, { t: 'join', code: code2, name: 'Bo', token: 'dd'.repeat(16) });
  hub2.receive(x, { t: 'msg', data: { k: 'start' } });
  const run2 = x.last('run').runId;
  const bad = buildCheckpoint({ runId: run2, floor: 1, phase: 'floor-ready', seed: 1, shared: {} });
  bad.checkpoint.gameVersion = 'dt-mp-0';
  // Bypass client builder: stuff an incompatible blob the way a future mismatch would.
  const room2 = hub2.rooms.get(code2);
  room2.checkpoint = { ...bad.checkpoint, revision: 11 };
  hub2.disconnect(x);
  const z = new MockWs();
  hub2.receive(z, { t: 'resume', code: code2, token: 'cc'.repeat(16) });
  t('incompatible stored checkpoint is rejected on resume', z.last('err')?.code === 'incompatible');

  // Reward duplication: restoring the same resolved climber does not grant gold again.
  const resolvedGold = 120;
  const resolved = serializeClimber(climber('Ava', { floor: 5, gold: resolvedGold }));
  const once = resolved.climber.gold;
  const twice = serializeClimber(resolved.climber).climber.gold;
  t('rehydrating a resolved climber does not double gold', once === resolvedGold && twice === resolvedGold);
  t('cardresult first write wins in live buffers', (() => {
    const h = createPartyHub();
    const p = new MockWs();
    h.receive(p, { t: 'create', name: 'Ava', token: 'ee'.repeat(16) });
    h.receive(p, { t: 'msg', data: { k: 'start' } });
    const id = p.last('room').you;
    const rr = h.rooms.get(p.last('room').code);
    h.receive(p, { t: 'msg', data: { k: 'cardresult', floor: 2, idx: 0 } });
    h.receive(p, { t: 'msg', data: { k: 'cardresult', floor: 2, idx: 1 } });
    return rr.live.cardResults[2] === 0 && id;
  })());

  // Host disconnect migrates host to the remaining live player.
  const hub3 = createPartyHub();
  const { a: hA, b: hB, room: r3, tokenA: tA } = startTwo(hub3, { tokenA: 'ff'.repeat(16), tokenB: '99'.repeat(16) });
  writeReady(hub3, hA, { runId: hA.last('run').runId, floor: 2, gold: 10 });
  hub3.disconnect(hA);
  t('remaining player becomes host after host disconnect', hub3.rooms.get(r3.code).hostId === hB.last('room').you);
  const hostBack = new MockWs();
  hub3.receive(hostBack, { t: 'resume', code: r3.code, token: tA });
  t('returning host may rejoin as guest while the live host remains', hostBack.last('resume-ok')?.host === false);

  // No-token lobby still expires when empty (old clients / test-bot).
  const hub4 = createPartyHub();
  const lone = new MockWs();
  hub4.receive(lone, { t: 'create', name: 'Bot' });
  const lobbyCode = lone.last('room').code;
  hub4.disconnect(lone);
  t('tokenless lobby room is deleted on last leave', !hub4.rooms.has(lobbyCode));

  // Lobby-only resume: token reconnect before start has no climber yet.
  {
    const hubL = createPartyHub();
    const l1 = new MockWs();
    hubL.receive(l1, { t: 'create', name: 'Ava', token: '22'.repeat(16) });
    const lobbyTok = l1.last('room').code;
    const l2 = new MockWs();
    hubL.receive(l2, { t: 'resume', code: lobbyTok, token: '22'.repeat(16) });
    const ok = l2.last('resume-ok');
    t('lobby second tab kicks the live socket', l1.last('kicked')?.why === 'resumed-elsewhere' && l1.closed);
    t('lobby resume-ok has no climber or run yet', !!(ok && !ok.climber && !ok.runId && !ok.checkpoint));
  }

  t('new party is blocked while a token already has a save', (() => {
    const h = createPartyHub();
    const p = new MockWs();
    h.receive(p, { t: 'create', name: 'Ava', token: '11'.repeat(16) });
    h.receive(p, { t: 'msg', data: { k: 'start' } });
    const q = new MockWs();
    h.receive(q, { t: 'create', name: 'Ava', token: '11'.repeat(16) });
    return q.last('err')?.code === 'has-save';
  })());

  // Cross-commit integration: economy flags, shop gold, kiln once, boss remainder.
  {
    const stamped = climber('Ava', {
      floor: 8,
      gold: 55,
      consumables: ['potion_s', 'potion_l'],
      flags: { assay_paid: true },
      goldSpent: 40,
      goldSpentBy: { shop: 15, event: 25 },
    });
    stamped.world.threads = { assay: { stage: 'opened' } };
    stamped.world.knowledge = ['assay_stamp'];
    const ser = serializeClimber(stamped);
    t('mp snapshot keeps personal gold', ser.ok && ser.climber.gold === 55);
    t('mp snapshot keeps consumables', ser.ok && ser.climber.consumables.join(',') === 'potion_s,potion_l');
    t('mp snapshot keeps assay flag and thread',
      ser.ok && ser.climber.flags.assay_paid && ser.climber.world.threads.assay.stage === 'opened');
    t('mp snapshot keeps goldSpentBy', ser.ok && ser.climber.goldSpentBy.shop === 15);
  }

  {
    const shopper = climber('Ava', { gold: 120, consumables: [] });
    shopper.pending = { kind: 'shop', eventId: 'merchant', stock: [{ kind: 'consumable', item: { id: 'potion_s' } }] };
    const stock = [{ kind: 'consumable', item: { id: 'potion_s', name: 'Potion', price: 20 }, price: 20 }];
    const bought = applyShopBuy(shopper, stock, 0, 0);
    const goldAfter = shopper.gold;
    const ser = serializeClimber(shopper);
    t('shop buy succeeds before snapshot', bought.ok && shopper.consumables.includes('potion_s'));
    t('shop pending is not restored from a safe climber', ser.ok && !ser.climber.pending);
    t('shop gold is not replayed on re-serialize',
      serializeClimber(ser.climber).climber.gold === goldAfter && ser.climber.gold === goldAfter);
    t('sold-out listing cannot fire twice', applyShopBuy(shopper, stock, 0, 0).ok === false);
  }

  {
    const kiln = EVENTS.find(e => e.id === 'remembering_kiln');
    const fresh = climber('Ava', { floor: 14, biomeId: 'ruins', seenEvents: [] });
    t('kiln eligible before it is resolved', eventEligible(kiln, fresh));
    recordResolvedKiln(fresh);
    const ser = serializeClimber(fresh);
    const restored = { ...ser.climber, biomeId: 'ruins', floor: 14 };
    t('kiln seenEvents survive the safe snapshot', ser.ok && ser.climber.seenEvents.includes('remembering_kiln'));
    t('resolved kiln does not reappear after checkpoint', !eventEligible(kiln, restored));
  }

  {
    const enemy = { boss: true, charge: 6, specials: [{ at: 4, name: 'Mid' }] };
    t('partial boss spend leaves remainder', spendEnemySpecialCharge(enemy, enemy.specials[0]) === 4 && enemy.charge === 2);
    const midBoss = serializeClimber(climber('Ava', { pending: { kind: 'boss', enemies: [enemy] } }));
    t('boss charge bar is not client-restored from combat pending', midBoss.ok === false && midBoss.why === 'combat-pending');
    const cdPending = serializeClimber(climber('Ava', { pending: { kind: 'combat', skillCDs: { whirlwind: 3 } } }));
    t('player cooldowns are not checkpointed mid-combat', cdPending.ok === false && cdPending.why === 'combat-pending');
    const afterFight = serializeClimber(climber('Ava', { floor: 10, skillCDs: { whirlwind: 3 } }));
    t('event/shop climber snapshot drops live combat CDs', afterFight.ok && afterFight.climber.skillCDs == null);
    t('safe checkpoint has no leftover enemy charge blob', afterFight.ok && afterFight.climber.charge == null && !afterFight.climber.pending);
    const still = { boss: true, charge: 6 };
    spendEnemySpecialCharge(still, { at: 4 });
    t('remainder spend still banks after a safe climber snapshot', still.charge === 2);
  }
}

function recordResolvedKiln(run) {
  run.seenEvents = [...(run.seenEvents || []), 'remembering_kiln'];
}

const standalone = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/test_mp_persist.js');
if (standalone) {
  let pass = 0, fail = 0;
  function t(name, cond) {
    if (cond) pass++;
    else { fail++; console.error('  ✗ FAIL:', name); }
  }
  try {
    await runMpPersistTests(t);
  } catch (err) {
    fail++;
    console.error('  ✗ FAIL: mp persist suite threw', err);
  }
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
