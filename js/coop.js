// Co-op session state. The tower is shared (one seed, host-drawn cards,
// lock-step floors). Path cards and combat-capable events are party-voted;
// combat (including event/mimic fights) is shared. Peaceful event rewards
// still roll personally from shared pools.

import { Net } from './net.js';

export class CoopSession {
  constructor(net) {
    this.net = net;
    this.partners = new Map(); // id -> {name, classId, status, act}
    this.gates = new Map();    // tag -> Set<playerId>
    this.gateWaiters = new Map(); // tag -> resolve fn
    this.gatePromises = new Map(); // tag -> Promise (idempotent waits)
    this.floorContent = new Map(); // floor -> content msg
    this.floorWaiters = new Map(); // floor -> resolve fn
    this.offs = [];
    this.lastStatus = '';

    // Vote / result buffers — survive late UI entry under dual auto-play.
    this.cardResults = new Map(); // floor -> idx (first write wins)
    this.eventResults = new Map(); // `${floor}:${eventId}` -> idx
    this.pickBuf = new Map(); // floor -> Map(from -> idx)
    this.pickOrder = new Map(); // floor -> [from, ...] arrival order
    this.evPickBuf = new Map(); // `${floor}:${eventId}` -> Map(from -> idx)
    this.evPickOrder = new Map(); // key -> [from, ...]

    this._pendingEvFight = null;
    this._pendingChestRoll = null;
    this._pendingEvEnemies = null;
    this._pendingEvResolves = []; // queue — roll then randomOutcome must not overwrite

    for (const p of net.roster) {
      if (p.id !== net.you) this.partners.set(p.id, { name: p.name, classId: null, status: null, act: 'lobby' });
    }

    this.offs.push(net.on('status', (d, from) => {
      const p = this.partners.get(from);
      if (p) { p.status = d; p.act = d.act; p.classId = d.classId ?? p.classId; }
      this.onPartnerUpdate?.();
    }));
    this.offs.push(net.on('gate', (d, from) => this._gateAdd(d.tag, from)));
    this.offs.push(net.on('floor', d => {
      this.floorContent.set(d.floor, d);
      this.floorWaiters.get(d.floor)?.(d);
      this.floorWaiters.delete(d.floor);
    }));

    // Results: first write wins so a late duplicate (first-pick race) cannot overwrite.
    this.offs.push(net.on('cardresult', d => {
      if (d?.floor == null || this.cardResults.has(d.floor)) return;
      this.cardResults.set(d.floor, d.idx);
    }));
    this.offs.push(net.on('evresult', d => {
      if (d?.floor == null || d?.eventId == null) return;
      const key = `${d.floor}:${d.eventId}`;
      if (this.eventResults.has(key)) return;
      this.eventResults.set(key, d.idx);
    }));

    // Buffer picks even when no UI listener is mounted yet (dual auto race).
    this.offs.push(net.on('pick', (d, from) => {
      if (d?.floor == null || d?.idx == null) return;
      this.notePick(d.floor, from, d.idx);
    }));
    this.offs.push(net.on('evpick', (d, from) => {
      if (d?.floor == null || d?.eventId == null || d?.idx == null) return;
      this.noteEvPick(d.floor, d.eventId, from, d.idx);
    }));

    this.throneMsg = null;
    this.offs.push(net.on('throne', d => { this.throneMsg = d; }));
    // WRLD: one of each catalog id per climb across the whole party
    this.claimedWrld = new Set();
    this.offs.push(net.on('wrldclaim', (d) => {
      if (d?.id) this.claimedWrld.add(d.id);
    }));
    // Legacy elim channel (disconnect / rare wipe paths). Normal co-op deaths
    // use run.down + next-floor revive instead of removing the climber.
    this.eliminated = new Set();
    this.offs.push(net.on('elim', (d, from) => {
      this.eliminated.add(from);
      const p = this.partners.get(from);
      if (p) {
        this.partners.delete(from);
        for (const tag of [...this.gates.keys()]) this._checkGate(tag);
        this.onPartnerUpdate?.();
        this.onPartnerEliminated?.(p.name);
      }
    }));
    this.offs.push(net.on('reopen', () => {
      this.eliminated.clear();
      this._syncRoster();
      this.onPartnerUpdate?.();
    }));
    // Party requeue votes — buffered so a late end-screen still sees earlier votes
    this.requeueVotes = new Set();
    this.offs.push(net.on('requeue', (d, from) => {
      if (!this.requeueVotes) this.requeueVotes = new Set();
      if (d.yes) this.requeueVotes.add(from);
      else this.requeueVotes.delete(from);
      this.onRequeue?.();
    }));

    // Host→guest packages (buffered so a slow client cannot miss them).
    this.offs.push(net.on('evfight', d => { this._pendingEvFight = d; }));
    this.offs.push(net.on('chestroll', d => { this._pendingChestRoll = d; }));
    this.offs.push(net.on('evenemies', d => { this._pendingEvEnemies = d; }));
    this.offs.push(net.on('evresolve', d => { this._pendingEvResolves.push(d); }));

    this.offs.push(net.sys('roster', () => {
      this._syncRoster();
      this.onPartnerUpdate?.();
    }));
    this.offs.push(net.sys('left', () => {
      this._syncRoster();
      // a smaller party may satisfy pending gates now
      for (const tag of [...this.gates.keys()]) this._checkGate(tag);
      this.onPartnerUpdate?.();
      this.onPartnerLeft?.();
    }));
  }

  /** Clear per-climb buffers so a requeue cannot reuse stale votes / packages. */
  resetRunBuffers() {
    this.cardResults.clear();
    this.eventResults.clear();
    this.pickBuf.clear();
    this.pickOrder.clear();
    this.evPickBuf.clear();
    this.evPickOrder.clear();
    this.floorContent.clear();
    this.gates.clear();
    this.gateWaiters.clear();
    this.gatePromises.clear();
    this.floorWaiters.clear();
    this._pendingEvFight = null;
    this._pendingChestRoll = null;
    this._pendingEvEnemies = null;
    this._pendingEvResolves = [];
    this.throneMsg = null;
    this.lastStatus = '';
  }

  notePick(floor, from, idx) {
    if (!this.pickBuf.has(floor)) {
      this.pickBuf.set(floor, new Map());
      this.pickOrder.set(floor, []);
    }
    const m = this.pickBuf.get(floor);
    const first = !m.has(from);
    m.set(from, idx);
    if (first) this.pickOrder.get(floor).push(from);
  }

  /** Local send + buffer (relay does not echo back to sender). */
  emitPick(floor, idx) {
    this.notePick(floor, this.net.you, idx);
    this.net.send({ k: 'pick', floor, idx });
  }

  picksFor(floor) {
    return this.pickBuf.get(floor) || new Map();
  }

  /** Earliest buffered pick for first-pick arbitration. */
  firstBufferedPick(floor) {
    const order = this.pickOrder.get(floor) || [];
    const m = this.pickBuf.get(floor);
    if (!order.length || !m) return null;
    const from = order[0];
    return { from, idx: m.get(from) };
  }

  noteEvPick(floor, eventId, from, idx) {
    const key = `${floor}:${eventId}`;
    if (!this.evPickBuf.has(key)) {
      this.evPickBuf.set(key, new Map());
      this.evPickOrder.set(key, []);
    }
    const m = this.evPickBuf.get(key);
    const first = !m.has(from);
    m.set(from, idx);
    if (first) this.evPickOrder.get(key).push(from);
  }

  emitEvPick(floor, eventId, idx) {
    this.noteEvPick(floor, eventId, this.net.you, idx);
    this.net.send({ k: 'evpick', floor, eventId, idx });
  }

  evPicksFor(floor, eventId) {
    return this.evPickBuf.get(`${floor}:${eventId}`) || new Map();
  }

  firstBufferedEvPick(floor, eventId) {
    const key = `${floor}:${eventId}`;
    const order = this.evPickOrder.get(key) || [];
    const m = this.evPickBuf.get(key);
    if (!order.length || !m) return null;
    const from = order[0];
    return { from, idx: m.get(from) };
  }

  /** Publish a cardresult once; ignores later calls for the same floor. */
  publishCardResult(floor, idx, extra = {}) {
    if (this.cardResults.has(floor)) return false;
    this.cardResults.set(floor, idx);
    this.net.send({ k: 'cardresult', floor, idx, ...extra });
    return true;
  }

  /** Publish an evresult once. */
  publishEvResult(floor, eventId, idx, extra = {}) {
    const key = `${floor}:${eventId}`;
    if (this.eventResults.has(key)) return false;
    this.eventResults.set(key, idx);
    this.net.send({ k: 'evresult', floor, eventId, idx, ...extra });
    return true;
  }

  _syncRoster() {
    const ids = new Set(this.net.roster.map(p => p.id));
    for (const id of [...this.partners.keys()]) if (!ids.has(id)) this.partners.delete(id);
    for (const p of this.net.roster) {
      // eliminated climbers stay connected (end screen) but are out of the run
      if (p.id !== this.net.you && !this.partners.has(p.id) && !this.eliminated.has(p.id)) {
        this.partners.set(p.id, { name: p.name, classId: null, status: null, act: 'lobby' });
      }
    }
  }

  // Acting host: publishes floors, arbitrates votes, drives shared enemies.
  // Normally the relay host — but an eliminated host can no longer simulate
  // (their run is over), so the lowest-id active climber takes over.
  get isHost() {
    const hostId = this.net.roster.find(p => p.host)?.id;
    if (hostId && !this.eliminated.has(hostId)) return this.net.isHost;
    const active = [this.net.you, ...this.partners.keys()]
      .filter(id => !this.eliminated.has(id))
      .sort();
    return active.length > 0 && active[0] === this.net.you;
  }
  get you() { return this.net.you; }
  get seed() { return this.net.seed; }
  get partySize() { return this.partners.size + 1; }
  get alone() { return this.partners.size === 0; }

  // deterministic seat order across clients: host first, then id order
  seatOrder() {
    const ids = [this.net.you, ...this.partners.keys()];
    const hostId = this.net.roster.find(p => p.host)?.id;
    return ids.sort((a, b) => (a === hostId ? -1 : b === hostId ? 1 : a < b ? -1 : 1));
  }

  /* ---- barrier: resolves when every current party member reached the tag ---- */
  gate(tag) {
    this._gateAdd(tag, this.net.you);
    this.net.send({ k: 'gate', tag });
    if (this._gateDone(tag)) {
      this.gatePromises.delete(tag);
      return Promise.resolve();
    }
    // Idempotent: a second call (double #continue under auto) shares the same Promise.
    if (this.gatePromises.has(tag)) return this.gatePromises.get(tag);
    const p = new Promise(r => { this.gateWaiters.set(tag, r); });
    this.gatePromises.set(tag, p);
    return p;
  }
  _gateAdd(tag, id) {
    if (!this.gates.has(tag)) this.gates.set(tag, new Set());
    this.gates.get(tag).add(id);
    this._checkGate(tag);
    this.onGateProgress?.(tag);
  }
  _gateDone(tag) {
    const set = this.gates.get(tag);
    if (!set || !set.has(this.net.you)) return false;
    for (const id of this.partners.keys()) if (!set.has(id)) return false;
    return true;
  }
  _checkGate(tag) {
    if (this._gateDone(tag) && this.gateWaiters.has(tag)) {
      this.gateWaiters.get(tag)();
      this.gateWaiters.delete(tag);
      this.gatePromises.delete(tag);
    }
  }
  gateProgress(tag) {
    const set = this.gates.get(tag) || new Set();
    return { have: set.size, need: this.partySize };
  }

  /* ---- floor content (host draws, everyone renders) ---- */
  publishFloor(content) {
    this.floorContent.set(content.floor, content);
    this.net.send({ ...content, k: 'floor' });
  }
  waitFloor(floor) {
    if (this.floorContent.has(floor)) return Promise.resolve(this.floorContent.get(floor));
    return new Promise(r => { this.floorWaiters.set(floor, r); });
  }

  /**
   * Wait for a host package, using the pending buffer + a re-check after
   * subscribe so messages that arrive in the race window are not lost.
   */
  _waitBuffered(bufKey, msgKey, match) {
    return new Promise(resolve => {
      let done = false;
      const take = (d) => {
        if (done || !d || (match && !match(d))) return false;
        done = true;
        this[bufKey] = null;
        resolve(d);
        return true;
      };
      if (take(this[bufKey])) return;
      const off = this.net.on(msgKey, (d) => { if (take(d)) off(); });
      // Re-check after subscribe — covers host-send-during-await races.
      if (take(this[bufKey])) off();
    });
  }

  waitEvFight(floor, eventId) {
    return this._waitBuffered(
      '_pendingEvFight', 'evfight',
      d => d.floor === floor && d.eventId === eventId,
    );
  }

  waitChestRoll(floor, eventId) {
    return this._waitBuffered(
      '_pendingChestRoll', 'chestroll',
      d => d.floor === floor && d.eventId === eventId,
    );
  }

  waitEvEnemies(floor, eventId) {
    return this._waitBuffered(
      '_pendingEvEnemies', 'evenemies',
      d => d.floor === floor && d.eventId === eventId,
    );
  }

  waitEvResolve(floor, eventId) {
    return new Promise(resolve => {
      let done = false;
      const take = (d) => {
        if (done || !d || d.floor !== floor || d.eventId !== eventId) return false;
        done = true;
        resolve(d);
        return true;
      };
      const idx = this._pendingEvResolves.findIndex(
        d => d?.floor === floor && d?.eventId === eventId,
      );
      if (idx >= 0) {
        const d = this._pendingEvResolves.splice(idx, 1)[0];
        if (take(d)) return;
      }
      const off = this.net.on('evresolve', (d) => {
        if (!take(d)) return;
        // Drop the matching pending copy if the live listener won the race.
        const i = this._pendingEvResolves.findIndex(
          x => x?.floor === floor && x?.eventId === eventId && x === d,
        );
        if (i >= 0) this._pendingEvResolves.splice(i, 1);
        off();
      });
      // Re-check queue after subscribe.
      const idx2 = this._pendingEvResolves.findIndex(
        d => d?.floor === floor && d?.eventId === eventId,
      );
      if (idx2 >= 0) {
        const d = this._pendingEvResolves.splice(idx2, 1)[0];
        if (take(d)) off();
      }
    });
  }

  broadcastStatus(run, act) {
    if (!run) return;
    const msg = {
      k: 'status', act,
      classId: run.classId, className: run.className, level: run.level,
      name: run.name, raceName: run.raceName,
      hp: Math.round(run.hp), maxHp: run.maxHp,
      mp: Math.round(run.mp ?? 0), maxMp: run.maxMp ?? 0,
      sanity: Math.round(run.sanity), maxSanity: run.maxSanity,
      gold: run.gold, floor: run.floor, down: !!run.down,
      def: run.def, dodge: run.dodge, // callers pass derived values via runStatus()
      appearanceId: run.appearanceId || null,
      taunt: run.combatTaunt || 0,
      spdStat: run.spdStat, initiative: run.initiative,
      dex: run.stats?.dex ?? run.dex,
      gear: run.sheetGear || [],
      pack: run.sheetPack || [],
      appraisal: run.appraisal || null,
      title: run.title || null,
      nameStyle: run.nameStyle || null,
    };
    const key = JSON.stringify(msg);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.net.send(msg);
  }

  /** Tell the party this climber is out of the run (individual-combat death). */
  announceEliminated() {
    this.eliminated.add(this.net.you);
    this.net.send({ k: 'elim' });
  }

  allPartnersDown() {
    if (this.partners.size === 0) return false;
    for (const p of this.partners.values()) {
      if (!p.status || !p.status.down) return false;
    }
    return true;
  }

  destroy() {
    for (const off of this.offs) off();
    this.net.close();
  }
}

export async function connectCoop(url) {
  const net = new Net();
  await net.connect(url);
  return net;
}
