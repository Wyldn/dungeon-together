// Co-op session state. The tower is shared (one seed, host-drawn cards,
// lock-step floors); choices and consequences are personal — except combat
// on encounter/trial/boss/throne floors, which the whole party fights together.

import { Net } from './net.js';

export class CoopSession {
  constructor(net) {
    this.net = net;
    this.partners = new Map(); // id -> {name, classId, status, act}
    this.gates = new Map();    // tag -> Set<playerId>
    this.gateWaiters = new Map(); // tag -> resolve fn
    this.floorContent = new Map(); // floor -> content msg
    this.floorWaiters = new Map(); // floor -> resolve fn
    this.offs = [];
    this.lastStatus = '';

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
    this.offs.push(net.sys('left', () => {
      const ids = new Set(this.net.roster.map(p => p.id));
      for (const id of [...this.partners.keys()]) if (!ids.has(id)) this.partners.delete(id);
      // a smaller party may satisfy pending gates now
      for (const tag of [...this.gates.keys()]) this._checkGate(tag);
      this.onPartnerUpdate?.();
      this.onPartnerLeft?.();
    }));
  }

  get isHost() { return this.net.isHost; }
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
    if (this._gateDone(tag)) return Promise.resolve();
    return new Promise(r => { this.gateWaiters.set(tag, r); });
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

  broadcastStatus(run, act) {
    if (!run) return;
    const msg = {
      k: 'status', act,
      classId: run.classId, className: run.className, level: run.level,
      hp: Math.round(run.hp), maxHp: run.maxHp,
      sanity: Math.round(run.sanity), maxSanity: run.maxSanity,
      gold: run.gold, floor: run.floor, down: !!run.down,
      def: run.def, dodge: run.dodge, // callers pass derived values via runStatus()
    };
    const key = JSON.stringify(msg);
    if (key === this.lastStatus) return;
    this.lastStatus = key;
    this.net.send(msg);
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
