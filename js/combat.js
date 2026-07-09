// Turn-based combat engine. Two modes:
//   solo   — exactly what it says.
//   shared — co-op: every party member fights in seat order, then enemies.
//            The acting client computes its own results and broadcasts
//            absolute numbers; the host computes enemy turns. HP authority
//            always stays with the owning client.

import { SKILLS } from './data/skills.js';
import { CONSUMABLES } from './data/items.js';
import { derived, gearHas, changeSanity, heal, restoreMana } from './character.js';
import { ICONS } from './icons.js';
import { SFX } from './audio.js';
import { screenShake } from './fx.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function buildEnemy(spec, floor, biomeStart, { boss = false, hpMult = 1 } = {}) {
  const depth = Math.max(0, floor - biomeStart);
  const scale = 1 + depth * 0.045;
  return {
    ...spec,
    boss,
    elite: !!spec.elite,
    maxHp: Math.round(spec.hp * scale * hpMult),
    hp: Math.round(spec.hp * scale * hpMult),
    atk: Math.round(spec.atk * scale),
    def: Math.round(spec.def * (1 + depth * 0.02)),
    statuses: {},
    phaseTriggers: [],
    turnCount: 0,
    uid: spec.uid || Math.random().toString(36).slice(2, 8),
  };
}

// opts.coop: CoopSession for shared fights (null/undefined = solo)
export function startCombat({ container, run, rng, enemies, modifier = null, introText = null, onHud, coop = null }) {
  return new Promise(resolve => {
    const C = new Fight(container, run, rng, enemies, modifier, introText, onHud, resolve, coop);
    C.begin();
  });
}

class Fight {
  constructor(container, run, rng, enemies, modifier, introText, onHud, resolve, coop) {
    this.el = container;
    this.run = run;
    this.rng = rng;
    this.enemies = enemies;
    this.mod = modifier || {};
    this.introText = introText;
    this.onHud = onHud;
    this.resolve = resolve;
    this.coop = coop;
    this.shared = !!coop;
    this.player = { statuses: {}, buffs: [] };
    this.target = 0;
    this.locked = true;
    this.usedDeathward = false;
    this.turn = 0;
    this.ended = false;
    this.offs = [];

    // allies (shared mode): id -> {name, classId, hp, maxHp, down}
    this.allies = new Map();
    if (this.shared) {
      for (const [id, p] of coop.partners) {
        this.allies.set(id, {
          name: p.name, classId: p.classId || 'warrior',
          hp: p.status?.hp ?? 1, maxHp: p.status?.maxHp ?? 1,
          down: p.status?.down || false,
          def: p.status?.def ?? 0, dodge: p.status?.dodge ?? 5,
        });
      }
    }
  }

  /* ---------------- helpers ---------------- */
  d() { return derived(this.run); }
  aliveEnemies() { return this.enemies.filter(e => e.hp > 0); }
  buffValue(stat) {
    let mult = 1, add = 0;
    for (const b of this.player.buffs) {
      if (b.stat === stat) { if (b.mult) mult *= b.mult; if (b.add) add += b.add; }
    }
    return { mult, add };
  }

  log(msg, cls = '') {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = msg;
    this.logEl.prepend(div);
    while (this.logEl.children.length > 50) this.logEl.lastChild.remove();
  }

  float(hostEl, text, cls) {
    if (!hostEl) return;
    const f = document.createElement('div');
    f.className = `float-text ${cls}`;
    f.textContent = text;
    hostEl.appendChild(f);
    setTimeout(() => f.remove(), 1000);
  }

  enemyByUid(uid) { return this.enemies.find(e => e.uid === uid); }
  sprite(uid) { return this.el.querySelector(`#sprite-${uid}`); }

  /* ---------------- rendering ---------------- */
  begin() {
    this.el.innerHTML = `
      <div class="combat-screen">
        ${this.mod.name ? `<div class="modifier-banner">⚠ ${this.mod.name} — ${this.mod.desc}</div>` : ''}
        <div class="battlefield">
          <div class="enemy-row"></div>
          <div class="player-row"></div>
        </div>
        <div class="combat-log panel"></div>
        <div class="action-bar"></div>
        <div class="combat-utility"></div>
      </div>`;
    this.enemyRow = this.el.querySelector('.enemy-row');
    this.playerRow = this.el.querySelector('.player-row');
    this.logEl = this.el.querySelector('.combat-log');
    this.actionBar = this.el.querySelector('.action-bar');
    this.utilBar = this.el.querySelector('.combat-utility');

    this.renderEnemies();
    this.renderPlayers();
    if (this.introText) this.log(this.introText, 'log-sys');

    const anyBoss = this.enemies.some(e => e.boss);
    if (anyBoss) SFX.bossIntro(); else SFX.cardDeal();

    if (this.shared) this.sharedLoop();
    else this.soloLoop();
  }

  renderEnemies() {
    this.enemyRow.innerHTML = '';
    this.enemies.forEach((e, i) => {
      const div = document.createElement('div');
      div.className = `combatant enemy ${e.elite ? 'elite' : ''} ${e.boss ? 'boss' : ''} ${e.hp <= 0 ? 'dead' : 'targetable'} ${i === this.target ? 'target' : ''}`;
      div.innerHTML = `
        <div class="fighter-sprite" id="sprite-${e.uid}">${e.glyph}</div>
        <div class="fighter-name">${e.name}</div>
        <div class="fighter-hp"><div class="bar"><div class="bar-fill hp" style="width:${clamp(e.hp / e.maxHp * 100, 0, 100)}%"></div></div></div>
        <div class="fighter-statuses">${this.statusPips(e.statuses)}</div>`;
      div.onclick = () => { if (e.hp > 0) { this.target = i; this.renderEnemies(); SFX.click(); } };
      this.enemyRow.appendChild(div);
    });
    if (this.enemies[this.target]?.hp <= 0) {
      this.target = this.enemies.findIndex(e => e.hp > 0);
    }
  }

  renderPlayers(actingSeat = null) {
    const s = this.player.statuses;
    let html = `
      <div class="combatant ${this.run.down ? 'downed' : ''} ${actingSeat === (this.coop?.you ?? 'me') ? 'acting' : ''}">
        <div class="fighter-sprite" id="sprite-player">${ICONS[this.run.classId]}</div>
        <div class="fighter-name">${this.run.name}${this.run.down ? ' (down)' : ''}</div>
        <div class="fighter-statuses">${this.statusPips(s)}${this.player.buffs.map(b => `<span class="status-pip">▲${b.label} ${b.turns}</span>`).join('')}</div>
      </div>`;
    for (const [id, a] of this.allies) {
      html += `
        <div class="combatant ${a.down ? 'downed' : ''} ${actingSeat === id ? 'acting' : ''}">
          <div class="fighter-sprite" id="sprite-${id}">${ICONS[a.classId] || ICONS.warrior}</div>
          <div class="fighter-name">${a.name}${a.down ? ' (down)' : ''}</div>
          <div class="ally-hp"><div class="bar"><div class="bar-fill hp" style="width:${clamp(a.hp / a.maxHp * 100, 0, 100)}%"></div></div></div>
        </div>`;
    }
    this.playerRow.innerHTML = html;
    this.onHud();
  }

  statusPips(st) {
    const pips = [];
    if (st.poison) pips.push(`<span class="status-pip">☠ ${st.poison}</span>`);
    if (st.burn) pips.push(`<span class="status-pip">🔥 ${st.burn}</span>`);
    if (st.frozen) pips.push(`<span class="status-pip">❄ frozen</span>`);
    if (st.stunned) pips.push(`<span class="status-pip">✦ stunned</span>`);
    if (st.shield) pips.push(`<span class="status-pip">◈ ward ${st.shield.turns}</span>`);
    return pips.join('');
  }

  renderActions(enabled) {
    this.actionBar.innerHTML = '';
    const costMult = this.mod.costMult || 1;
    for (const id of this.run.skills) {
      const sk = SKILLS[id];
      if (!sk) continue;
      const cost = Math.ceil((sk.cost || 0) * costMult);
      const btn = document.createElement('button');
      btn.className = 'skill-btn';
      btn.disabled = !enabled || this.run.mp < cost;
      btn.innerHTML = `
        <div class="sk-name"><span>${sk.name}</span><span class="sk-cost">${cost ? cost + ' MP' : 'FREE'}</span></div>
        <div class="sk-desc">${sk.desc}</div>`;
      btn.onclick = () => { if (!this.locked) this.useSkill(sk, cost); };
      this.actionBar.appendChild(btn);
    }
    this.utilBar.innerHTML = '';
    const pots = this.run.consumables;
    if (pots.length) {
      const uniq = [...new Set(pots)];
      for (const cid of uniq) {
        const c = CONSUMABLES.find(x => x.id === cid);
        const count = pots.filter(x => x === cid).length;
        const b = document.createElement('button');
        b.className = 'btn small';
        b.disabled = !enabled;
        b.textContent = `${c.name} ×${count}`;
        b.onclick = () => { if (!this.locked) this.useConsumable(c); };
        this.utilBar.appendChild(b);
      }
    }
    const anyBoss = this.enemies.some(e => e.boss);
    if (!anyBoss && !this.shared) {
      const flee = document.createElement('button');
      flee.className = 'btn small ghost';
      flee.disabled = !enabled;
      flee.textContent = '🏃 Flee';
      flee.onclick = () => { if (!this.locked) this.tryFlee(); };
      this.utilBar.appendChild(flee);
    }
  }

  waitingBanner(name) {
    this.actionBar.innerHTML = `<div class="modifier-banner" style="grid-column:1/-1;border-color:var(--panel-edge);color:var(--ink-dim)">⏳ ${name} is acting…</div>`;
    this.utilBar.innerHTML = '';
  }

  /* ================= SOLO DRIVER (original flow) ================= */
  async soloLoop() {
    await sleep(600);
    if (this.mod.enemyFirst) {
      this.log('You walked into an ambush — the enemy strikes first!', 'log-sys');
      await this.enemyPhase();
      if (this.checkEndSolo()) return;
      this.upkeep();
    }
    this.playerPhase();
  }

  playerPhase() {
    if (this.checkEndSolo()) return;
    this.turn++;
    const st = this.player.statuses;
    restoreMana(this.run, this.d().manaRegen);
    if (st.frozen || st.stunned) {
      this.log(`You are ${st.frozen ? 'frozen solid' : 'stunned'} — turn lost!`, 'log-hit');
      delete st.frozen; delete st.stunned;
      this.renderPlayers();
      this.locked = true;
      setTimeout(async () => {
        await this.tickEnemyStatuses();
        if (this.checkEndSolo()) return;
        await this.enemyPhase();
        if (this.checkEndSolo()) return;
        this.upkeep();
        this.playerPhase();
      }, 700);
      return;
    }
    this.locked = false;
    this.renderActions(true);
    this.renderPlayers();
  }

  async afterPlayerAction() {
    if (this.shared) { this._turnDone?.(); return; }
    await this.tickEnemyStatuses();
    if (this.checkEndSolo()) return;
    await this.enemyPhase();
    if (this.checkEndSolo()) return;
    this.upkeep();
    this.playerPhase();
  }

  /* ================= SHARED DRIVER (co-op) ================= */
  async sharedLoop() {
    // subscribe to combat messages
    this.offs.push(this.coop.net.on('cact', (d, from) => this._pendingActs.push({ d, from })));
    this.offs.push(this.coop.net.on('cpass', (d, from) => this._pendingActs.push({ d: { ...d, pass: true }, from })));
    this.offs.push(this.coop.net.on('eturn', d => { this._eturn = d; this._eturnResolve?.(); }));
    this.offs.push(this.coop.net.on('cend', d => this.finishShared(d)));
    this.offs.push(this.coop.net.on('status', (d, from) => {
      const a = this.allies.get(from);
      if (a) { a.hp = d.hp; a.maxHp = d.maxHp; a.down = d.down; a.def = d.def ?? a.def; a.dodge = d.dodge ?? a.dodge; }
      this.renderPlayers(this._actingSeat);
    }));
    this.offs.push(this.coop.net.sys('left', () => {
      for (const id of [...this.allies.keys()]) {
        if (!this.coop.partners.has(id)) this.allies.delete(id);
      }
      this.renderPlayers(this._actingSeat);
    }));
    this._pendingActs = [];

    await sleep(700);
    while (!this.ended) {
      this.turn++;
      for (const seat of this.coop.seatOrder()) {
        if (this.ended) return;
        // seat may have disconnected
        if (seat !== this.coop.you && !this.allies.has(seat)) continue;
        this._actingSeat = seat;
        this.renderPlayers(seat);
        if (seat === this.coop.you) {
          await this.localTurn();
        } else {
          await this.remoteTurn(seat);
        }
        if (this.hostCheckEnd()) return;
      }
      // enemy phase
      if (this.ended) return;
      this._actingSeat = null;
      if (this.coop.isHost) {
        await this.hostEnemyPhase();
        if (this.hostCheckEnd()) return;
      } else {
        await this.awaitEnemyPhase();
        if (this.ended) return;
      }
      this.upkeep();
      this.coop.broadcastStatus(this.runStatus(), 'fighting');
    }
  }

  runStatus() {
    const d = this.d();
    const r = this.run;
    return { ...r, def: d.def, dodge: d.dodge };
  }

  async localTurn() {
    if (this.run.down) {
      this.coop.net.send({ k: 'cpass', why: 'down' });
      this.log('You are down — your companions fight on.', 'log-hit');
      await sleep(400);
      return;
    }
    restoreMana(this.run, this.d().manaRegen);
    const st = this.player.statuses;
    if (st.frozen || st.stunned) {
      this.log(`You are ${st.frozen ? 'frozen solid' : 'stunned'} — turn lost!`, 'log-hit');
      delete st.frozen; delete st.stunned;
      this.coop.net.send({ k: 'cpass', why: 'stunned' });
      this.renderPlayers(this._actingSeat);
      await sleep(600);
      return;
    }
    this.locked = false;
    this.renderActions(true);
    await new Promise(r => { this._turnDone = r; });
    this._turnDone = null;
    this.renderActions(false);
  }

  async remoteTurn(seat) {
    const ally = this.allies.get(seat);
    this.waitingBanner(ally?.name || 'A companion');
    // wait for their action (may already be queued)
    let entry = null;
    while (!entry && !this.ended) {
      const idx = this._pendingActs.findIndex(a => a.from === seat);
      if (idx > -1) { entry = this._pendingActs.splice(idx, 1)[0]; break; }
      // partner might vanish mid-wait
      if (!this.allies.has(seat)) return;
      await new Promise(r => setTimeout(r, 120));
    }
    if (!entry || this.ended) return;
    if (entry.d.pass) {
      this.log(`${ally?.name || 'Companion'} cannot act.`, 'log-hit');
      await sleep(400);
      return;
    }
    await this.applyRemoteAct(entry.d, ally);
  }

  async applyRemoteAct(act, ally) {
    const name = ally?.name || 'Companion';
    const seatId = [...this.allies.entries()].find(([, a]) => a === ally)?.[0];
    const sprite = this.sprite(seatId);
    if (sprite) { sprite.classList.add('attack'); setTimeout(() => sprite.classList.remove('attack'), 420); }
    if (act.label) this.log(`${name} uses ${act.label}!`, 'log-good');
    for (const t of act.targets || []) {
      const e = this.enemyByUid(t.uid);
      if (!e) continue;
      await sleep(140);
      e.hp = clamp(t.hpAfter, 0, e.maxHp);
      if (t.statuses) Object.assign(e.statuses, t.statuses);
      const es = this.sprite(e.uid);
      if (es) {
        es.classList.add('hit');
        setTimeout(() => es.classList.remove('hit'), 360);
        this.float(es.parentElement, t.crit ? `${t.dmg}!` : `${t.dmg}`, t.crit ? 'crit' : 'dmg');
      }
      t.crit ? SFX.crit() : SFX.hit();
      if (e.hp <= 0) this.log(`${e.name} is defeated!`, 'log-sys');
    }
    this.renderEnemies();
    await sleep(400);
  }

  /* ---- host-computed enemy phase (shared) ---- */
  async hostEnemyPhase() {
    const ops = [];
    await this.tickEnemyStatuses(ops);
    if (!this.aliveEnemies().length) { this.broadcastEturn(ops); return; }

    for (const e of this.aliveEnemies()) {
      if (this.ended) return;
      e.turnCount++;
      // boss mechanics
      if (e.summons && e.turnCount % 3 === 0 && this.enemies.filter(x => x.hp > 0).length < 3) {
        const minion = buildEnemy(
          { id: 'skeleton', name: 'Risen Skeleton', glyph: '💀', hp: 30, atk: 9, def: 2, spd: 7, gold: [0, 0], xp: 5 },
          this.run.floor, this.run.floor);
        this.enemies.push(minion);
        ops.push({ type: 'summon', spec: { ...minion, statuses: {} } });
        this.log(`${e.name} drags a servant up from the dust!`, 'log-hit');
        this.renderEnemies();
        await sleep(400);
        continue;
      }
      this.bossPhaseChecks(e, ops);

      if (e.statuses.frozen || e.statuses.stunned) {
        ops.push({ type: 'skip', uid: e.uid, why: e.statuses.frozen ? 'frozen' : 'stunned' });
        this.log(`${e.name} is ${e.statuses.frozen ? 'frozen' : 'stunned'} — it cannot act.`, 'log-good');
        delete e.statuses.frozen; delete e.statuses.stunned;
        this.renderEnemies();
        await sleep(350);
        continue;
      }

      // pick a target among standing party members
      const targets = [{ id: this.coop.you, def: this.d().def, dodge: this.d().dodge, down: this.run.down },
        ...[...this.allies.entries()].map(([id, a]) => ({ id, def: a.def, dodge: a.dodge, down: a.down }))]
        .filter(t => !t.down);
      if (!targets.length) break;
      const target = this.rng.pick(targets);

      const es = this.sprite(e.uid);
      if (es) { es.classList.add('attack'); setTimeout(() => es.classList.remove('attack'), 420); }
      await sleep(240);

      const dodgeBuff = target.id === this.coop.you ? this.buffValue('dodge').add : 0;
      if (this.rng.chance(clamp(target.dodge + dodgeBuff, 0, 80) / 100)) {
        ops.push({ type: 'hit', uid: e.uid, target: target.id, dodged: true });
        this.applyHitOp(ops[ops.length - 1], e);
        await sleep(380);
        continue;
      }
      let dmg = e.atk * 1.35 * (0.85 + this.rng.next() * 0.3) * (this.mod.dmgMult || 1);
      if (this.rng.chance(this.d().enemyCrit / 100)) dmg *= 1.5;
      if (e.caster && e.turnCount % 2 === 0) { dmg *= 1.4; this.log(`${e.name} channels a darker spell!`, 'log-hit'); }
      dmg = Math.max(1, Math.round(dmg - target.def));
      const riders = {};
      if (e.sanityHit) riders.sanity = e.sanityHit;
      if (e.poison && this.rng.chance(e.poison)) riders.poison = 3;
      if (e.burn && this.rng.chance(e.burn)) riders.burn = 2;
      if (e.freeze && this.rng.chance(e.freeze)) riders.freeze = 1;
      if (e.lifesteal) { e.hp = Math.min(e.maxHp, e.hp + Math.round(dmg * e.lifesteal)); }
      const op = { type: 'hit', uid: e.uid, target: target.id, dmg, riders };
      ops.push(op);
      this.applyHitOp(op, e);
      this.renderEnemies();
      await sleep(420);
    }
    this.broadcastEturn(ops);
  }

  bossPhaseChecks(e, ops) {
    if (e.heads) {
      const pct = e.hp / e.maxHp;
      for (const threshold of [0.6, 0.3]) {
        if (pct <= threshold && !e.phaseTriggers.includes(threshold)) {
          e.phaseTriggers.push(threshold);
          e.atk = Math.round(e.atk * 1.2);
          e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * 0.1));
          ops.push({ type: 'phase', uid: e.uid, atk: e.atk, hpAfter: e.hp, text: 'A severed head regrows — angrier. The Hydra swells with grief.' });
          this.log('A severed head regrows — angrier.', 'log-hit');
          SFX.bossIntro();
        }
      }
    }
    if (e.phases && e.hp / e.maxHp <= 0.5 && !e.phaseTriggers.includes('enrage')) {
      e.phaseTriggers.push('enrage');
      e.atk = Math.round(e.atk * 1.3);
      e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * 0.12));
      ops.push({ type: 'phase', uid: e.uid, atk: e.atk, hpAfter: e.hp, text: `${e.name}: "${e.taunt}" — the Demon King stops holding back.`, sanity: 8 });
      this.log(`${e.name}: "${e.taunt}"`, 'log-sys');
      changeSanity(this.run, -8);
      SFX.bossIntro(); screenShake();
    }
  }

  // apply a hit op to whoever it targets (both host + guests run this)
  applyHitOp(op, enemyRef = null) {
    const e = enemyRef || this.enemyByUid(op.uid);
    if (op.dodged) {
      const el = op.target === this.coop.you ? this.el.querySelector('#sprite-player') : this.sprite(op.target);
      this.float(el, 'MISS', 'miss');
      this.log(`${e?.name || 'The enemy'} attacks — a miss!`, 'log-good');
      SFX.miss();
      return;
    }
    if (op.target === this.coop.you) {
      let dmg = op.dmg;
      const shield = this.player.statuses.shield;
      if (shield) dmg = Math.max(1, Math.round(dmg * (1 - shield.mult)));
      dmg = Math.max(1, Math.round(dmg * this.d().dmgTakenMult));
      this.run.hp = Math.max(0, this.run.hp - dmg);
      this.float(this.el.querySelector('#sprite-player'), `-${dmg}`, 'dmg');
      SFX.hit();
      this.log(`${e?.name || 'The enemy'} hits you for ${dmg}.`, 'log-hit');
      const r = op.riders || {};
      if (r.sanity) { const lost = changeSanity(this.run, -r.sanity); if (lost < 0) SFX.sanity(); }
      if (r.poison) { this.player.statuses.poison = r.poison; this.log('You are poisoned!', 'log-hit'); }
      if (r.burn) { this.player.statuses.burn = r.burn; this.log('You are set ablaze!', 'log-hit'); }
      if (r.freeze) { this.player.statuses.frozen = 1; this.log('You are frozen!', 'log-hit'); SFX.freeze(); }
      if (this.run.hp <= 0) this.deathSaves();
      if (this.run.hp <= 0 || this.run.sanity <= 0) this.goDown();
      this.coop.broadcastStatus(this.runStatus(), 'fighting');
      this.onHud();
    } else {
      const a = this.allies.get(op.target);
      if (a) {
        a.hp = Math.max(0, a.hp - op.dmg); // estimate; corrected by their status msg
        this.float(this.sprite(op.target), `-${op.dmg}`, 'dmg');
        this.log(`${e?.name || 'The enemy'} hits ${a.name} for ~${op.dmg}.`, 'log-hit');
      }
    }
    this.renderPlayers(this._actingSeat);
  }

  broadcastEturn(ops) {
    this.coop.net.send({ k: 'eturn', ops, snapshot: this.enemies.map(e => ({ uid: e.uid, hp: e.hp })) });
  }

  async awaitEnemyPhase() {
    this.waitingBanner('The enemy');
    if (!this._eturn) await new Promise(r => { this._eturnResolve = r; });
    const { ops, snapshot } = this._eturn;
    this._eturn = null; this._eturnResolve = null;
    for (const op of ops) {
      if (this.ended) return;
      await sleep(300);
      if (op.type === 'summon') {
        this.enemies.push({ ...op.spec, statuses: op.spec.statuses || {} });
        this.log('Reinforcements claw their way in!', 'log-hit');
        this.renderEnemies();
      } else if (op.type === 'phase') {
        const e = this.enemyByUid(op.uid);
        if (e) { e.atk = op.atk; e.hp = op.hpAfter; }
        this.log(op.text, 'log-hit');
        if (op.sanity) changeSanity(this.run, -op.sanity);
        SFX.bossIntro(); screenShake();
        this.renderEnemies();
      } else if (op.type === 'skip') {
        const e = this.enemyByUid(op.uid);
        if (e) { delete e.statuses.frozen; delete e.statuses.stunned; }
        this.log(`${e?.name || 'An enemy'} cannot act.`, 'log-good');
        this.renderEnemies();
      } else if (op.type === 'edot') {
        const e = this.enemyByUid(op.uid);
        if (e) { e.hp = op.hpAfter; this.float(this.sprite(e.uid)?.parentElement, `${op.dmg}`, 'dmg'); }
        this.renderEnemies();
      } else if (op.type === 'eregen') {
        const e = this.enemyByUid(op.uid);
        if (e) e.hp = op.hpAfter;
        this.renderEnemies();
      } else if (op.type === 'hit') {
        const es = this.sprite(op.uid);
        if (es) { es.classList.add('attack'); setTimeout(() => es.classList.remove('attack'), 420); }
        await sleep(200);
        this.applyHitOp(op);
      }
    }
    // sync enemy hp to authoritative snapshot
    if (snapshot) {
      for (const s of snapshot) {
        const e = this.enemyByUid(s.uid);
        if (e) e.hp = s.hp;
      }
    }
    this.renderEnemies();
  }

  goDown() {
    if (this.run.down) return;
    this.run.down = true;
    if (this.run.sanity <= 0) this.run.sanity = 1; // held together by the party
    this.log('You fall! Your companions fight on — hold fast for the next floor.', 'log-sys');
    SFX.death();
    this.renderPlayers(this._actingSeat);
  }

  hostCheckEnd() {
    if (!this.coop?.isHost) {
      // guests still end locally on obvious win to feel responsive; host cend confirms
      return this.ended;
    }
    if (this.aliveEnemies().length === 0) {
      const d = this.d();
      let gold = 0, xp = 0;
      for (const e of this.enemies) {
        gold += this.rng.int(e.gold?.[0] ?? 0, e.gold?.[1] ?? 0);
        xp += e.xp || 0;
      }
      gold = Math.round(gold * (this.mod.goldMult || 1));
      xp = Math.round(xp * 1.3);
      this.coop.net.send({ k: 'cend', result: 'win', gold, xp });
      this.finishShared({ result: 'win', gold, xp });
      return true;
    }
    const meDown = this.run.down;
    if (meDown && (this.coop.partners.size === 0 || this.coop.allPartnersDown())) {
      this.coop.net.send({ k: 'cend', result: 'wipe' });
      this.finishShared({ result: 'wipe' });
      return true;
    }
    return this.ended;
  }

  finishShared(d) {
    if (this.ended) return;
    this.ended = true;
    this.locked = true;
    for (const off of this.offs) off();
    this.rng.advance?.();
    setTimeout(() => this.resolve({ result: d.result, gold: d.gold || 0, xp: d.xp || 0 }), d.result === 'win' ? 500 : 900);
  }

  /* ================= ACTIONS (both modes) ================= */
  async useSkill(sk, cost) {
    this.locked = true;
    this.actionBar.querySelectorAll('button').forEach(b => b.disabled = true);
    this.run.mp -= cost;
    const d = this.d();
    const targets = sk.target === 'all' ? this.aliveEnemies()
      : sk.target === 'self' ? []
      : [this.enemies[this.target]].filter(e => e && e.hp > 0);

    const spriteP = this.el.querySelector('#sprite-player');
    spriteP.classList.add('attack');
    setTimeout(() => spriteP.classList.remove('attack'), 420);

    const actOps = { k: 'cact', label: sk.name, targets: [] };
    if (sk.target === 'self') {
      this.applySelfSkill(sk, d);
    } else {
      for (const e of targets) {
        await sleep(120);
        const res = this.hitEnemy(e, sk, d);
        actOps.targets.push(res);
      }
    }
    if (sk.sanityGain) { changeSanity(this.run, sk.sanityGain); }
    if (this.shared) {
      this.coop.net.send(actOps);
      this.coop.broadcastStatus(this.runStatus(), 'fighting');
    }
    this.renderEnemies();
    this.renderPlayers(this._actingSeat);
    await sleep(650);
    this.afterPlayerAction();
  }

  applySelfSkill(sk, d) {
    if (sk.shield) {
      this.player.statuses.shield = { mult: sk.shield, turns: 2 };
      this.log(`You raise a ward — ${Math.round(sk.shield * 100)}% damage blocked.`, 'log-good');
    }
    if (sk.healPct) {
      const amt = heal(this.run, this.run.maxHp * sk.healPct);
      this.float(this.el.querySelector('#sprite-player'), `+${amt}`, 'heal');
      SFX.heal();
    }
    for (const b of [sk.buff, sk.buff2].filter(Boolean)) {
      this.player.buffs.push({ ...b, turns: b.turns, label: b.stat === 'dodge' ? 'DODGE' : 'PWR' });
      this.log(`${sk.name}: you feel ${b.stat === 'dodge' ? 'untouchable' : 'stronger'}.`, 'log-good');
    }
    SFX.heal();
  }

  hitEnemy(e, sk, d) {
    const stat = d[sk.stat] || d.str;
    const buff = this.buffValue('str');
    let base = (stat * 2.2 + d.atk * 2 + this.run.level * 1.5 + 4) * (sk.power / 100) * buff.mult;
    let critChance = d.crit + (sk.critBonus || 0);
    const isCrit = this.rng.chance(clamp(critChance, 0, 85) / 100);
    let dmg = base * (0.85 + this.rng.next() * 0.3);
    if (isCrit) dmg *= 1.6;
    dmg *= d.dmgMult * (this.mod.dmgMult || 1);
    if (e.boss) dmg *= d.bossDmgMult;
    if (!sk.ignoreDef) dmg -= e.def;
    dmg = Math.max(1, Math.round(dmg));

    if (sk.execute && !e.boss && e.hp / e.maxHp <= sk.execute) {
      dmg = e.hp;
      this.log(`ASSASSINATE — ${e.name} is slain outright!`, 'log-sys');
    }

    e.hp = Math.max(0, e.hp - dmg);
    const sprite = this.sprite(e.uid);
    if (sprite) {
      sprite.classList.add('hit');
      setTimeout(() => sprite.classList.remove('hit'), 360);
      this.float(sprite.parentElement, isCrit ? `${dmg}!` : `${dmg}`, isCrit ? 'crit' : 'dmg');
    }
    isCrit ? SFX.crit() : SFX.hit();
    if (isCrit) screenShake();
    this.log(`${sk.name} hits ${e.name} for ${dmg}${isCrit ? ' — CRITICAL!' : ''}`, isCrit ? 'log-sys' : '');

    const newStatuses = {};
    const burnCh = (sk.burn || 0) + d.burn;
    const freezeCh = (sk.freeze || 0) + d.freeze;
    if (e.hp > 0) {
      if (sk.poison && this.rng.chance(sk.poison)) { e.statuses.poison = 3; newStatuses.poison = 3; this.log(`${e.name} is poisoned.`, 'log-good'); }
      if (burnCh && this.rng.chance(burnCh)) { e.statuses.burn = 2; newStatuses.burn = 2; this.log(`${e.name} catches fire.`, 'log-good'); SFX.fire(); }
      if (freezeCh && this.rng.chance(freezeCh)) { e.statuses.frozen = 1; newStatuses.frozen = 1; this.log(`${e.name} is frozen solid.`, 'log-good'); SFX.freeze(); }
      if (sk.stun && this.rng.chance(sk.stun)) { e.statuses.stunned = 1; newStatuses.stunned = 1; this.log(`${e.name} is stunned.`, 'log-good'); }
    }
    const ls = (sk.lifesteal || 0) + d.lifesteal;
    if (ls > 0) {
      const amt = heal(this.run, dmg * ls);
      if (amt > 0) this.float(this.el.querySelector('#sprite-player'), `+${amt}`, 'heal');
    }
    if (e.hp <= 0) this.log(`${e.name} is defeated!`, 'log-sys');

    return { uid: e.uid, dmg, crit: isCrit, hpAfter: e.hp, statuses: newStatuses };
  }

  useConsumable(c) {
    this.locked = true;
    const idx = this.run.consumables.indexOf(c.id);
    if (idx === -1) return;
    this.run.consumables.splice(idx, 1);
    const actOps = { k: 'cact', label: c.name, targets: [] };
    if (c.heal) { const amt = heal(this.run, c.heal); this.float(this.el.querySelector('#sprite-player'), `+${amt}`, 'heal'); SFX.heal(); }
    if (c.mana) { restoreMana(this.run, c.mana); this.float(this.el.querySelector('#sprite-player'), `+${c.mana} MP`, 'mana'); }
    if (c.sanity) { changeSanity(this.run, c.sanity); SFX.heal(); }
    if (c.cure) { this.player.statuses = {}; this.log('Ailments cured.', 'log-good'); }
    if (c.bombDmg) {
      for (const e of this.aliveEnemies()) {
        e.hp = Math.max(0, e.hp - c.bombDmg);
        this.float(this.sprite(e.uid)?.parentElement, `${c.bombDmg}`, 'dmg');
        actOps.targets.push({ uid: e.uid, dmg: c.bombDmg, hpAfter: e.hp });
      }
      SFX.crit(); screenShake();
      this.log('The bomb detonates!', 'log-sys');
    }
    this.log(`Used ${c.name}.`, 'log-good');
    if (this.shared) {
      this.coop.net.send(actOps);
      this.coop.broadcastStatus(this.runStatus(), 'fighting');
    }
    this.renderEnemies();
    this.renderPlayers(this._actingSeat);
    setTimeout(() => this.afterPlayerAction(), 600);
  }

  tryFlee() {
    this.locked = true;
    const d = this.d();
    const avgSpd = this.aliveEnemies().reduce((s, e) => s + e.spd, 0) / this.aliveEnemies().length;
    const chance = clamp(0.45 + (d.dex - avgSpd) * 0.03 + d.lk * 0.012, 0.15, 0.9);
    if (this.rng.chance(chance)) {
      this.log('You slip away into the dark.', 'log-sys');
      SFX.miss();
      this.finishSolo('fled');
    } else {
      this.log('No escape — they cut off your retreat!', 'log-hit');
      SFX.bad();
      setTimeout(async () => {
        await this.tickEnemyStatuses();
        if (this.checkEndSolo()) return;
        await this.enemyPhase();
        if (this.checkEndSolo()) return;
        this.upkeep();
        this.playerPhase();
      }, 600);
    }
  }

  /* ================= ENEMY PHASE (solo) ================= */
  async tickEnemyStatuses(ops = null) {
    for (const e of this.aliveEnemies()) {
      if (e.statuses.poison) {
        const dmg = Math.max(2, Math.round(e.maxHp * 0.07));
        e.hp = Math.max(0, e.hp - dmg);
        this.float(this.sprite(e.uid)?.parentElement, `${dmg}`, 'dmg');
        this.log(`${e.name} suffers ${dmg} poison damage.`);
        e.statuses.poison--;
        if (e.statuses.poison <= 0) delete e.statuses.poison;
        ops?.push({ type: 'edot', uid: e.uid, dmg, hpAfter: e.hp, kind: 'poison' });
      }
      if (e.statuses.burn) {
        const dmg = Math.max(2, Math.round(e.maxHp * 0.055));
        e.hp = Math.max(0, e.hp - dmg);
        this.float(this.sprite(e.uid)?.parentElement, `${dmg}`, 'dmg');
        this.log(`${e.name} burns for ${dmg}.`);
        e.statuses.burn--;
        if (e.statuses.burn <= 0) delete e.statuses.burn;
        ops?.push({ type: 'edot', uid: e.uid, dmg, hpAfter: e.hp, kind: 'burn' });
      }
      if (e.regen && e.hp > 0 && e.hp < e.maxHp) {
        const amt = Math.round(e.maxHp * e.regen);
        e.hp = Math.min(e.maxHp, e.hp + amt);
        this.log(`${e.name} regenerates ${amt}.`, 'log-hit');
        ops?.push({ type: 'eregen', uid: e.uid, amt, hpAfter: e.hp });
      }
    }
    this.renderEnemies();
    await sleep(250);
  }

  async enemyPhase() {
    for (const e of this.aliveEnemies()) {
      if (this.run.hp <= 0) return;
      e.turnCount++;

      if (e.summons && e.turnCount % 3 === 0 && this.enemies.filter(x => x.hp > 0).length < 3) {
        const minion = buildEnemy(
          { id: 'skeleton', name: 'Risen Skeleton', glyph: '💀', hp: 30, atk: 9, def: 2, spd: 7, gold: [0, 0], xp: 5 },
          this.run.floor, this.run.floor);
        this.enemies.push(minion);
        this.log(`${e.name} drags a servant up from the dust!`, 'log-hit');
        this.renderEnemies();
        await sleep(400);
        continue;
      }
      if (e.heads) {
        const pct = e.hp / e.maxHp;
        for (const threshold of [0.6, 0.3]) {
          if (pct <= threshold && !e.phaseTriggers.includes(threshold)) {
            e.phaseTriggers.push(threshold);
            e.atk = Math.round(e.atk * 1.2);
            e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * 0.1));
            this.log('A severed head regrows — angrier. The Hydra swells with grief.', 'log-hit');
            SFX.bossIntro();
            this.renderEnemies();
            await sleep(500);
          }
        }
      }
      if (e.phases && e.hp / e.maxHp <= 0.5 && !e.phaseTriggers.includes('enrage')) {
        e.phaseTriggers.push('enrage');
        e.atk = Math.round(e.atk * 1.3);
        e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * 0.12));
        this.log(`${e.name}: "${e.taunt}"`, 'log-sys');
        this.log('The Demon King stops holding back.', 'log-hit');
        changeSanity(this.run, -8);
        SFX.bossIntro(); screenShake();
        this.renderEnemies(); this.renderPlayers();
        await sleep(700);
      }

      if (e.statuses.frozen || e.statuses.stunned) {
        this.log(`${e.name} is ${e.statuses.frozen ? 'frozen' : 'stunned'} — it cannot act.`, 'log-good');
        delete e.statuses.frozen; delete e.statuses.stunned;
        this.renderEnemies();
        await sleep(350);
        continue;
      }

      const sprite = this.sprite(e.uid);
      if (sprite) { sprite.classList.add('attack'); setTimeout(() => sprite.classList.remove('attack'), 420); }
      await sleep(240);

      const d = this.d();
      const dodgeBuff = this.buffValue('dodge');
      const dodgeCh = clamp(d.dodge + dodgeBuff.add, 0, 80);
      if (this.rng.chance(dodgeCh / 100)) {
        this.float(this.el.querySelector('#sprite-player'), 'MISS', 'miss');
        this.log(`${e.name} attacks — you evade!`, 'log-good');
        SFX.miss();
        await sleep(380);
        continue;
      }

      let dmg = e.atk * 1.35 * (0.85 + this.rng.next() * 0.3) * (this.mod.dmgMult || 1);
      if (this.rng.chance(d.enemyCrit / 100)) dmg *= 1.5;
      dmg -= d.def;
      if (e.caster && e.turnCount % 2 === 0) { dmg *= 1.4; this.log(`${e.name} channels a darker spell!`, 'log-hit'); }
      const shield = this.player.statuses.shield;
      if (shield) dmg *= (1 - shield.mult);
      dmg = Math.max(1, Math.round(dmg * d.dmgTakenMult));

      this.run.hp = Math.max(0, this.run.hp - dmg);
      this.float(this.el.querySelector('#sprite-player'), `-${dmg}`, 'dmg');
      SFX.hit();
      this.log(`${e.name} hits you for ${dmg}.`, 'log-hit');

      if (e.sanityHit) {
        const lost = changeSanity(this.run, -e.sanityHit);
        if (lost < 0) { this.log(`Its presence claws at your mind. (${lost} Sanity)`, 'log-hit'); SFX.sanity(); }
      }
      if (e.lifesteal) {
        e.hp = Math.min(e.maxHp, e.hp + Math.round(dmg * e.lifesteal));
        this.log(`${e.name} drinks deep.`, 'log-hit');
      }
      if (e.poison && this.rng.chance(e.poison)) { this.player.statuses.poison = 3; this.log('You are poisoned!', 'log-hit'); }
      if (e.burn && this.rng.chance(e.burn)) { this.player.statuses.burn = 2; this.log('You are set ablaze!', 'log-hit'); }
      if (e.freeze && this.rng.chance(e.freeze)) { this.player.statuses.frozen = 1; this.log('You are frozen!', 'log-hit'); SFX.freeze(); }

      if (this.run.hp <= 0) this.deathSaves();

      this.renderPlayers();
      this.renderEnemies();
      await sleep(420);
    }
  }

  /* ---- end-of-round upkeep: player dots, buffs, floor modifiers ---- */
  upkeep() {
    const st = this.player.statuses;
    if (st.poison && this.run.hp > 0) {
      const dmg = Math.max(2, Math.round(this.run.maxHp * 0.05));
      this.run.hp = Math.max(0, this.run.hp - dmg);
      this.float(this.el.querySelector('#sprite-player'), `-${dmg}`, 'dmg');
      this.log(`Poison courses through you for ${dmg}.`, 'log-hit');
      st.poison--; if (st.poison <= 0) delete st.poison;
      if (this.run.hp <= 0) { this.deathSaves(); if (this.shared && this.run.hp <= 0) this.goDown(); }
    }
    if (st.burn && this.run.hp > 0) {
      const dmg = Math.max(2, Math.round(this.run.maxHp * 0.045));
      this.run.hp = Math.max(0, this.run.hp - dmg);
      this.float(this.el.querySelector('#sprite-player'), `-${dmg}`, 'dmg');
      this.log(`You burn for ${dmg}.`, 'log-hit');
      st.burn--; if (st.burn <= 0) delete st.burn;
      if (this.run.hp <= 0) { this.deathSaves(); if (this.shared && this.run.hp <= 0) this.goDown(); }
    }
    if (st.shield) { st.shield.turns--; if (st.shield.turns <= 0) delete st.shield; }
    this.player.buffs = this.player.buffs.filter(b => --b.turns > 0);
    if (this.mod.sanityDrain && !this.run.down) {
      changeSanity(this.run, -this.mod.sanityDrain);
      this.log(`The cursed ground gnaws at your mind. (-${this.mod.sanityDrain} Sanity)`, 'log-hit');
      SFX.sanity();
      if (this.shared && this.run.sanity <= 0) this.goDown();
    }
    this.renderPlayers(this._actingSeat);
  }

  deathSaves() {
    if (gearHas(this.run, 'revive') && !this.run.usedRevive) {
      this.run.usedRevive = true;
      this.run.hp = Math.round(this.run.maxHp * 0.3);
      this.log('The Phoenix Feather ignites — you rise from the ashes!', 'log-sys');
      SFX.evolve();
      return;
    }
    if (gearHas(this.run, 'deathward') && !this.usedDeathward) {
      this.usedDeathward = true;
      this.run.hp = 1;
      this.log('The Cracked Hourglass shatters — time stumbles, and you are spared. Barely.', 'log-sys');
      SFX.unlock();
    }
  }

  /* ---------------- end conditions (solo) ---------------- */
  checkEndSolo() {
    if (this.shared) return this.ended;
    if (this.run.hp <= 0) { this.finishSolo('dead'); return true; }
    if (this.run.sanity <= 0) { this.finishSolo('madness'); return true; }
    if (this.aliveEnemies().length === 0) {
      const d = this.d();
      let gold = 0, xp = 0;
      for (const e of this.enemies) {
        gold += this.rng.int(e.gold[0], e.gold[1]);
        xp += e.xp;
      }
      gold = Math.round(gold * d.goldMult * d.combatGoldMult * (this.mod.goldMult || 1));
      xp = Math.round(xp * 1.3 * d.xpMult);
      this.finishSolo('win', { gold, xp });
      return true;
    }
    return false;
  }

  finishSolo(result, extra = {}) {
    this.locked = true;
    this.ended = true;
    this.rng.advance?.();
    setTimeout(() => this.resolve({ result, ...extra }), result === 'win' ? 500 : 900);
  }
}
