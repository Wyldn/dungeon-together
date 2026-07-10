// Turn-based combat engine (handoff §8–§14).
//   - Initiative rolls at every battle; visible turn order on the left.
//   - Universal Guard (70% block) and Basic Attack, regardless of weapon.
//   - Six-segment Battle Charge for players AND enemies; AOE/heavy hits gated.
//   - Enemy specials telegraphed one segment before they're ready.
// Two drivers: solo (fully interleaved initiative) and shared co-op
// (players act in seat order, then the host resolves enemies — protocol
// constraint; the displayed order reflects what actually happens).

import { SKILLS } from './data/skills.js';
import { CONSUMABLES } from './data/items.js';
import { CONFIG } from './data/config.js';
import { derived, gearHas, heal, restoreMana, usableSkillIds, resourceName, changeFame } from './character.js';
import { initiativeOrder, addCharge, canAfford, pickEnemySpecial, enemyTelegraph, applyGuard } from './systems.js';
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
    boss: boss || !!spec.boss,
    elite: !!spec.elite,
    maxHp: Math.round(spec.hp * scale * hpMult),
    hp: Math.round(spec.hp * scale * hpMult),
    atk: Math.round(spec.atk * scale),
    def: Math.round(spec.def * (1 + depth * 0.02)),
    charge: 0,
    statuses: {},
    phaseTriggers: [],
    turnCount: 0,
    uid: spec.uid || Math.random().toString(36).slice(2, 8),
  };
}

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
    this.player = { statuses: {}, buffs: [], guarding: false };
    this.charge = clamp((run.metaStartCharge || 0) + derived(run).startCharge, 0, CONFIG.charge.max);
    this.target = 0;
    this.locked = true;
    this.usedDeathward = false;
    this.round = 0;
    this.ended = false;
    this.order = []; // initiative order (display + solo driver)
    this.offs = [];

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
  gainCharge(n) {
    const before = this.charge;
    this.charge = addCharge(this.charge, n, this.mod.chargeMult || 1);
    if (this.charge > before) this.renderCharge();
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

  // click a companion (or yourself) to receive the mend
  pickHealTarget() {
    return new Promise(res => {
      this.log('Choose who to mend — click a companion, or yourself.', 'log-sys');
      const row = this.playerRow;
      row.classList.add('heal-pick');
      const ids = ['self', ...this.allies.keys()];
      const combatants = [...row.querySelectorAll('.combatant')];
      combatants.forEach((c, i) => {
        c.style.cursor = 'pointer';
        c.onclick = () => {
          row.classList.remove('heal-pick');
          combatants.forEach(x => { x.onclick = null; x.style.cursor = ''; });
          res(ids[i] ?? 'self');
        };
      });
    });
  }

  showTurnBanner(show) {
    const b = this.el.querySelector('#turn-banner');
    if (b) b.style.display = show ? '' : 'none';
    if (show) SFX.yourTurn();
  }

  // per-skill-type visual: a brief overlay on the target sprite
  spawnFx(spriteEl, fxType) {
    if (!spriteEl || !fxType) return;
    const f = document.createElement('div');
    f.className = `skill-fx fx-${fxType}`;
    spriteEl.appendChild(f);
    setTimeout(() => f.remove(), 750);
    SFX.skill(fxType);
  }

  /* ---------------- initiative ---------------- */
  rollBattleOrder() {
    const d = this.d();
    const entities = [
      { key: 'player', name: this.run.name, glyph: null, spdStat: Math.round(4 + d.dex * 0.3), mod: d.initiative + (this.mod.enemyFirst ? -100 : 0), isPlayer: true, stableId: 'p-' + (this.coop?.you || 'me') },
      ...this.aliveEnemies().map(e => ({ key: e.uid, name: e.name, glyph: e.glyph, spdStat: e.spd, mod: 0, isPlayer: false, stableId: e.uid })),
    ];
    if (this.shared) {
      for (const [id, a] of this.allies) {
        entities.push({ key: 'ally-' + id, name: a.name, glyph: null, spdStat: 8, mod: 0, isPlayer: true, stableId: id });
      }
    }
    this.order = initiativeOrder(this.rng, entities, this.run.floor);
    this.log('Initiative: ' + this.order.map(o => o.name).join(' → '), 'log-sys');
  }

  /* ---------------- rendering ---------------- */
  begin() {
    this.el.innerHTML = `
      <div class="combat-screen">
        ${this.mod.name ? `<div class="modifier-banner">⚠ ${this.mod.name} — ${this.mod.desc}</div>` : ''}
        <div class="battlefield">
          <div class="turn-order panel-inset" id="turn-order"></div>
          <div class="enemy-row"></div>
          <div class="player-row"></div>
        </div>
        <div class="turn-banner" id="turn-banner" style="display:none">⚔ YOUR TURN</div>
        <div class="charge-tray" id="charge-tray"></div>
        <div class="combat-log panel"></div>
        <div class="action-bar"></div>
        <div class="combat-utility"></div>
      </div>`;
    this.enemyRow = this.el.querySelector('.enemy-row');
    this.playerRow = this.el.querySelector('.player-row');
    this.turnOrderEl = this.el.querySelector('#turn-order');
    this.chargeTray = this.el.querySelector('#charge-tray');
    this.logEl = this.el.querySelector('.combat-log');
    this.actionBar = this.el.querySelector('.action-bar');
    this.utilBar = this.el.querySelector('.combat-utility');

    this.rollBattleOrder();
    this.renderEnemies();
    this.renderPlayers();
    this.renderTurnOrder();
    this.renderCharge();
    if (this.introText) this.log(this.introText, 'log-sys');

    const anyBoss = this.enemies.some(e => e.boss);
    if (anyBoss) SFX.bossIntro(); else SFX.cardDeal();

    if (this.shared) this.sharedLoop();
    else this.soloLoop();
  }

  chargePips(current, max = CONFIG.charge.max, cls = '') {
    let pips = '';
    for (let i = 0; i < max; i++) pips += `<span class="cpip ${i < current ? 'lit' : ''} ${cls}"></span>`;
    return `<span class="cpips">${pips}</span>`;
  }

  renderCharge() {
    if (!this.chargeTray) return;
    this.chargeTray.innerHTML = `
      <span class="charge-label">${CONFIG.charge.displayName}</span>
      ${this.chargePips(this.charge)}
      <span class="charge-num">${this.charge}/${CONFIG.charge.max}</span>`;
  }

  renderTurnOrder(activeKey = null) {
    if (!this.turnOrderEl) return;
    this.turnOrderEl.innerHTML = `<div class="to-title">TURN ORDER</div>` + this.order
      .filter(o => o.isPlayer || (this.enemyByUid(o.key)?.hp > 0))
      .map(o => `<div class="to-entry ${o.key === activeKey ? 'active' : ''} ${o.isPlayer ? 'to-player' : ''}">
        <span class="to-glyph">${o.glyph || '🛡'}</span><span class="to-name">${o.name}</span>
      </div>`).join('');
  }

  renderEnemies() {
    this.enemyRow.innerHTML = '';
    this.enemies.forEach((e, i) => {
      const tel = e.hp > 0 ? enemyTelegraph(e) : null;
      const div = document.createElement('div');
      div.className = `combatant enemy ${e.elite ? 'elite' : ''} ${e.boss ? 'boss' : ''} ${e.hp <= 0 ? 'dead' : 'targetable'} ${i === this.target ? 'target' : ''}`;
      div.innerHTML = `
        ${tel ? `<div class="telegraph ${tel.ready ? 'ready' : ''}">${tel.ready ? '⚠ ' + tel.name + '!' : '… ' + tel.desc}</div>` : ''}
        <div class="fighter-sprite" id="sprite-${e.uid}">${e.glyph}</div>
        <div class="fighter-name">${e.name}</div>
        <div class="fighter-hp"><div class="bar"><div class="bar-fill hp" style="width:${clamp(e.hp / e.maxHp * 100, 0, 100)}%"></div></div></div>
        ${e.specials ? `<div class="fighter-charge">${this.chargePips(e.charge || 0, CONFIG.charge.max, 'enemy')}</div>` : ''}
        <div class="fighter-statuses">${this.statusPips(e.statuses)}</div>`;
      div.onclick = () => { if (e.hp > 0) { this.target = i; this.renderEnemies(); SFX.click(); } };
      this.enemyRow.appendChild(div);
    });
    if (this.enemies[this.target]?.hp <= 0) {
      this.target = this.enemies.findIndex(e => e.hp > 0);
      if (this.target > -1) this.renderEnemies();
    }
  }

  renderPlayers(actingKey = null) {
    const s = this.player.statuses;
    let html = `
      <div class="combatant ${this.run.down ? 'downed' : ''} ${actingKey === 'player' ? 'acting' : ''}">
        <div class="fighter-sprite" id="sprite-player">${ICONS[this.run.classId]}</div>
        <div class="fighter-name">${this.run.name}${this.run.down ? ' (down)' : ''}</div>
        <div class="fighter-statuses">
          ${this.player.guarding ? '<span class="status-pip guard-pip">🛡 GUARD</span>' : ''}
          ${this.statusPips(s)}${this.player.buffs.map(b => `<span class="status-pip">▲${b.label} ${b.turns}</span>`).join('')}
        </div>
      </div>`;
    for (const [id, a] of this.allies) {
      html += `
        <div class="combatant ${a.down ? 'downed' : ''} ${actingKey === 'ally-' + id ? 'acting' : ''}">
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
    if (st.hexed) pips.push(`<span class="status-pip">🕯 hex ${st.hexed}</span>`);
    return pips.join('');
  }

  renderActions(enabled) {
    this.actionBar.innerHTML = '';
    const costMult = this.mod.costMult || 1;
    const usable = usableSkillIds(this.run);
    const incompatible = !usable.includes(this.run.skills[0]) && this.run.skills.length > 0;
    const resName = resourceName(this.run);

    const ids = ['basic_attack', 'guard', ...this.run.skills];
    for (const id of ids) {
      const sk = SKILLS[id];
      if (!sk) continue;
      const cost = Math.ceil((sk.cost || 0) * costMult);
      const chargeCost = sk.charge || 0;
      const isUsable = usable.includes(id);
      const affordable = canAfford({ cost, charge: chargeCost }, this.run.mp, this.charge);
      const btn = document.createElement('button');
      btn.className = `skill-btn ${sk.class === 'universal' ? 'universal' : ''} ${!isUsable ? 'incompatible' : ''}`;
      btn.disabled = !enabled || !isUsable || !affordable;
      btn.innerHTML = `
        <div class="sk-name"><span>${sk.name}</span>
          <span class="sk-cost">${cost ? `${cost} ${resName}` : ''}${cost && chargeCost ? ' + ' : ''}${chargeCost ? `${chargeCost}⚡` : ''}${!cost && !chargeCost ? 'FREE' : ''}</span></div>
        <div class="sk-desc">${!isUsable ? '⚠ Your weapon cannot channel this — class techniques need a compatible weapon.' : sk.desc}</div>`;
      btn.onclick = () => { if (!this.locked) this.useSkill(sk, cost); };
      this.actionBar.appendChild(btn);
    }
    if (incompatible) {
      const warn = document.createElement('div');
      warn.className = 'modifier-banner';
      warn.style.gridColumn = '1/-1';
      warn.textContent = '⚠ Incompatible weapon equipped — only Strike and Guard are available.';
      this.actionBar.prepend(warn);
    }

    this.utilBar.innerHTML = '';
    const pots = this.run.consumables;
    if (pots.length) {
      const uniq = [...new Set(pots)];
      for (const cid of uniq) {
        const c = CONSUMABLES.find(x => x.id === cid);
        if (!c) continue;
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

  /* ================= SOLO DRIVER: interleaved initiative ================= */
  async soloLoop() {
    await sleep(600);
    while (!this.ended) {
      this.round++;
      for (const entry of this.order) {
        if (this.ended) return;
        if (entry.isPlayer) {
          this.renderTurnOrder('player');
          await this.playerTurn();
          if (this.checkEndSolo()) return;
        } else {
          const e = this.enemyByUid(entry.key);
          if (!e || e.hp <= 0) continue;
          this.renderTurnOrder(entry.key);
          await this.enemyTurn(e);
          if (this.checkEndSolo()) return;
        }
      }
      await this.upkeep();
      if (this.checkEndSolo()) return;
    }
  }

  async playerTurn() {
    // guard expires at the start of your turn
    this.player.guarding = false;
    restoreMana(this.run, this.d().manaRegen);
    const st = this.player.statuses;
    if (st.frozen || st.stunned) {
      this.log(`You are ${st.frozen ? 'frozen solid' : 'stunned'} — turn lost!`, 'log-hit');
      delete st.frozen; delete st.stunned;
      this.gainCharge(CONFIG.charge.gainPerTurn);
      this.renderPlayers();
      await sleep(700);
      return;
    }
    this.locked = false;
    this.showTurnBanner(true);
    this.renderActions(true);
    this.renderPlayers('player');
    await new Promise(r => { this._turnDone = r; });
    this._turnDone = null;
    this.showTurnBanner(false);
    this.renderActions(false);
  }

  endPlayerAction() {
    this.gainCharge(CONFIG.charge.gainPerTurn);
    if (this.shared) { this._sharedTurnDone?.(); }
    else this._turnDone?.();
  }

  /* ================= SHARED DRIVER (co-op) ================= */
  async sharedLoop() {
    this.offs.push(this.coop.net.on('cact', (d, from) => this._pendingActs.push({ d, from })));
    this.offs.push(this.coop.net.on('cpass', (d, from) => this._pendingActs.push({ d: { ...d, pass: true }, from })));
    this.offs.push(this.coop.net.on('eturn', d => { this._eturn = d; this._eturnResolve?.(); }));
    this.offs.push(this.coop.net.on('cend', d => this.finishShared(d)));
    this.offs.push(this.coop.net.on('status', (d, from) => {
      const a = this.allies.get(from);
      if (a) { a.hp = d.hp; a.maxHp = d.maxHp; a.down = d.down; a.def = d.def ?? a.def; a.dodge = d.dodge ?? a.dodge; }
      this.renderPlayers(this._actingKey);
    }));
    this.offs.push(this.coop.net.sys('left', () => {
      for (const id of [...this.allies.keys()]) {
        if (!this.coop.partners.has(id)) this.allies.delete(id);
      }
      this.renderPlayers(this._actingKey);
    }));
    this._pendingActs = [];
    // ally healing (e.g. a Priest's Mend cast on a companion)
    this.offs.push(this.coop.net.on('cheal', (d, from) => {
      const healer = this.allies.get(from)?.name || 'A companion';
      if (d.to === this.coop.you) {
        const amt = heal(this.run, this.run.maxHp * d.pct);
        this.float(this.el.querySelector('#sprite-player'), `+${amt}`, 'heal');
        this.spawnFx(this.el.querySelector('#sprite-player'), 'heal');
        this.log(`${healer} mends you with ${d.label}. (+${amt} HP)`, 'log-good');
        this.coop.broadcastStatus(this.runStatus(), 'fighting');
        this.onHud();
      } else {
        const a = this.allies.get(d.to);
        if (a) {
          a.hp = Math.min(a.maxHp, a.hp + Math.round(a.maxHp * d.pct));
          this.spawnFx(this.sprite(d.to), 'heal');
          this.log(`${healer} mends ${a.name}.`, 'log-good');
        }
      }
      this.renderPlayers(this._actingKey);
    }));

    // ONE turn order for the whole party: the host rolls it and broadcasts;
    // every client displays and iterates the same sequence (patch)
    if (this.coop.isHost) {
      this.coop.net.send({
        k: 'corder',
        order: this.order.map(o => ({ key: o.key, name: o.name, glyph: o.glyph, isPlayer: o.isPlayer, stableId: o.stableId })),
      });
    } else {
      this.offs.push(this.coop.net.on('corder', d => { this._corder = d; this._corderResolve?.(); }));
      if (!this._corder) {
        await new Promise(r => {
          this._corderResolve = r;
          setTimeout(r, 4000); // never hang on a lost packet — fall back to local order
        });
      }
      if (this._corder) {
        // remap the host's keys to local ones (the host's own seat is our ally)
        this.order = this._corder.order.map(o => {
          if (!o.isPlayer) return o;
          const seat = String(o.stableId).replace(/^p-/, '');
          return { ...o, key: seat === this.coop.you ? 'player' : 'ally-' + seat, stableId: seat };
        });
        this.renderTurnOrder();
      }
    }
    this.sharedSeats = this.order.filter(o => o.isPlayer).map(o => String(o.stableId).replace(/^p-/, ''));
    if (!this.sharedSeats.length) this.sharedSeats = this.coop.seatOrder();

    await sleep(700);
    while (!this.ended) {
      this.round++;
      for (const seat of this.sharedSeats) {
        if (this.ended) return;
        if (seat !== this.coop.you && !this.allies.has(seat)) continue;
        this._actingKey = seat === this.coop.you ? 'player' : 'ally-' + seat;
        this.renderPlayers(this._actingKey);
        this.renderTurnOrder(this._actingKey);
        if (seat === this.coop.you) {
          await this.localSharedTurn();
        } else {
          await this.remoteTurn(seat);
        }
        if (this.hostCheckEnd()) return;
      }
      if (this.ended) return;
      this._actingKey = null;
      if (this.coop.isHost) {
        await this.hostEnemyPhase();
        if (this.hostCheckEnd()) return;
      } else {
        await this.awaitEnemyPhase();
        if (this.ended) return;
      }
      await this.upkeep();
      this.coop.broadcastStatus(this.runStatus(), 'fighting');
    }
  }

  runStatus() {
    const d = this.d();
    const r = this.run;
    return { ...r, def: d.def, dodge: d.dodge };
  }

  async localSharedTurn() {
    if (this.run.down) {
      this.coop.net.send({ k: 'cpass', why: 'down' });
      this.log('You are down — your companions fight on.', 'log-hit');
      await sleep(400);
      return;
    }
    this.player.guarding = false;
    restoreMana(this.run, this.d().manaRegen);
    const st = this.player.statuses;
    if (st.frozen || st.stunned) {
      this.log(`You are ${st.frozen ? 'frozen solid' : 'stunned'} — turn lost!`, 'log-hit');
      delete st.frozen; delete st.stunned;
      this.gainCharge(CONFIG.charge.gainPerTurn);
      this.coop.net.send({ k: 'cpass', why: 'stunned' });
      this.renderPlayers(this._actingKey);
      await sleep(600);
      return;
    }
    this.locked = false;
    this.showTurnBanner(true);
    this.renderActions(true);
    await new Promise(r => { this._sharedTurnDone = r; });
    this._sharedTurnDone = null;
    this.showTurnBanner(false);
    this.renderActions(false);
  }

  async remoteTurn(seat) {
    const ally = this.allies.get(seat);
    this.waitingBanner(ally?.name || 'A companion');
    let entry = null;
    while (!entry && !this.ended) {
      const idx = this._pendingActs.findIndex(a => a.from === seat);
      if (idx > -1) { entry = this._pendingActs.splice(idx, 1)[0]; break; }
      if (!this.allies.has(seat)) return;
      await new Promise(r => setTimeout(r, 120));
    }
    if (!entry || this.ended) return;
    if (entry.d.pass) {
      this.log(`${ally?.name || 'Companion'} cannot act.`, 'log-hit');
      await sleep(400);
      return;
    }
    await this.applyRemoteAct(entry.d, ally, seat);
  }

  async applyRemoteAct(act, ally, seatId) {
    const name = ally?.name || 'Companion';
    const sprite = this.sprite(seatId);
    if (sprite) { sprite.classList.add('attack'); setTimeout(() => sprite.classList.remove('attack'), 420); }
    if (act.label === 'Guard') { this.log(`${name} raises their guard.`, 'log-good'); await sleep(300); return; }
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
        this.spawnFx(es, t.fx || act.fx);
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
      e.charge = addCharge(e.charge || 0, (e.chargeGain || 1), this.mod.chargeMult || 1);
      ops.push({ type: 'echarge', uid: e.uid, charge: e.charge });

      if (e.summons && e.turnCount % 3 === 0 && this.enemies.filter(x => x.hp > 0).length < 3) {
        const minion = buildEnemy(
          { id: 'skeleton', name: 'Risen Skeleton', glyph: '💀', hp: 30, atk: 9, def: 2, spd: 6, gold: [0, 0], xp: 5 },
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

      const special = pickEnemySpecial(e);
      const targets = [{ id: this.coop.you, def: this.d().def, dodge: this.d().dodge, down: this.run.down },
        ...[...this.allies.entries()].map(([id, a]) => ({ id, def: a.def, dodge: a.dodge, down: a.down }))]
        .filter(t => !t.down);
      if (!targets.length) break;

      const hitTargets = special?.aoe ? targets : [this.rng.pick(targets)];
      if (special) {
        e.charge = 0;
        ops.push({ type: 'echarge', uid: e.uid, charge: 0 });
        this.log(`${e.name} unleashes ${special.name}!`, 'log-sys');
        SFX.bossIntro();
      }

      const es = this.sprite(e.uid);
      if (es) { es.classList.add('attack'); setTimeout(() => es.classList.remove('attack'), 420); }
      await sleep(240);

      for (const target of hitTargets) {
        const dodgeBuff = target.id === this.coop.you ? this.buffValue('dodge').add : 0;
        if (!special && this.rng.chance(clamp(target.dodge + dodgeBuff, 0, 80) / 100)) {
          const op = { type: 'hit', uid: e.uid, target: target.id, dodged: true };
          ops.push(op);
          this.applyHitOp(op, e);
          continue;
        }
        let dmg = e.atk * CONFIG.combat.enemyAtkMult * (0.85 + this.rng.next() * 0.3) * (this.mod.dmgMult || 1) * (special?.mult || 1);
        if (this.rng.chance(this.d().enemyCrit / 100)) dmg *= 1.5;
        if (e.caster && !special && e.turnCount % 2 === 0) dmg *= 1.4;
        dmg = Math.max(1, Math.round(dmg - target.def));
        const riders = {};
        if ((e.poison && this.rng.chance(e.poison)) || special?.poisonSure) riders.poison = 3;
        if ((e.burn && this.rng.chance(e.burn)) || special?.burnSure) riders.burn = 2;
        if ((e.freeze && this.rng.chance(e.freeze)) || special?.freezeSure) riders.freeze = 1;
        if (e.lifesteal || special?.heal) e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * (special?.heal || 0)) + Math.round(dmg * (e.lifesteal || 0)));
        const op = { type: 'hit', uid: e.uid, target: target.id, dmg, riders, special: special?.name };
        ops.push(op);
        this.applyHitOp(op, e);
      }
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
      if (e.chargeOnPhase) e.charge = addCharge(e.charge || 0, e.chargeOnPhase);
      ops.push({ type: 'phase', uid: e.uid, atk: e.atk, hpAfter: e.hp, charge: e.charge, text: `${e.name}: "${e.taunt}" — the Demon King stops holding back.` });
      this.log(`${e.name}: "${e.taunt}"`, 'log-sys');
      SFX.bossIntro(); screenShake();
    }
  }

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
      dmg = applyGuard(dmg, this.player.guarding);
      dmg = Math.max(1, Math.round(dmg * this.d().dmgTakenMult));
      this.run.hp = Math.max(0, this.run.hp - dmg);
      this.damageTaken = (this.damageTaken || 0) + dmg;
      if (this.d().chargeOnHit) this.gainCharge(1);
      this.float(this.el.querySelector('#sprite-player'), `-${dmg}`, 'dmg');
      SFX.hit();
      this.log(`${e?.name || 'The enemy'}${op.special ? ` (${op.special})` : ''} hits you for ${dmg}${this.player.guarding ? ' (guarded)' : ''}.`, 'log-hit');
      const r = op.riders || {};
      if (r.poison && !this.rng.chance(this.d().poisonResist)) { this.player.statuses.poison = r.poison; this.log('You are poisoned!', 'log-hit'); }
      if (r.burn) { this.player.statuses.burn = r.burn; this.log('You are set ablaze!', 'log-hit'); }
      if (r.freeze) { this.player.statuses.frozen = 1; this.log('You are frozen!', 'log-hit'); SFX.freeze(); }
      if (this.run.hp <= 0) this.deathSaves();
      if (this.run.hp <= 0) this.goDown();
      this.coop.broadcastStatus(this.runStatus(), 'fighting');
      this.onHud();
    } else {
      const a = this.allies.get(op.target);
      if (a) {
        a.hp = Math.max(0, a.hp - op.dmg);
        this.float(this.sprite(op.target), `-${op.dmg}`, 'dmg');
        this.log(`${e?.name || 'The enemy'} hits ${a.name} for ~${op.dmg}.`, 'log-hit');
      }
    }
    this.renderPlayers(this._actingKey);
  }

  broadcastEturn(ops) {
    this.coop.net.send({ k: 'eturn', ops, snapshot: this.enemies.map(e => ({ uid: e.uid, hp: e.hp, charge: e.charge || 0 })) });
  }

  async awaitEnemyPhase() {
    this.waitingBanner('The enemy');
    if (!this._eturn) await new Promise(r => { this._eturnResolve = r; });
    const { ops, snapshot } = this._eturn;
    this._eturn = null; this._eturnResolve = null;
    for (const op of ops) {
      if (this.ended) return;
      await sleep(280);
      if (op.type === 'summon') {
        this.enemies.push({ ...op.spec, statuses: op.spec.statuses || {} });
        this.log('Reinforcements claw their way in!', 'log-hit');
        this.renderEnemies();
      } else if (op.type === 'echarge') {
        const e = this.enemyByUid(op.uid);
        if (e) e.charge = op.charge;
        this.renderEnemies();
      } else if (op.type === 'phase') {
        const e = this.enemyByUid(op.uid);
        if (e) { e.atk = op.atk; e.hp = op.hpAfter; if (op.charge != null) e.charge = op.charge; }
        this.log(op.text, 'log-hit');
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
    if (snapshot) {
      for (const s of snapshot) {
        const e = this.enemyByUid(s.uid);
        if (e) { e.hp = s.hp; e.charge = s.charge; }
      }
    }
    this.renderEnemies();
  }

  goDown() {
    if (!this.shared || this.run.down) return;
    this.run.down = true;
    this.log('You fall! Your companions fight on — hold fast for the next floor.', 'log-sys');
    SFX.death();
    this.renderPlayers(this._actingKey);
  }

  hostCheckEnd() {
    if (!this.coop?.isHost) return this.ended;
    if (this.aliveEnemies().length === 0) {
      let gold = 0, xp = 0;
      for (const e of this.enemies) {
        gold += this.rng.int(e.gold?.[0] ?? 0, e.gold?.[1] ?? 0);
        xp += e.xp || 0;
      }
      gold = Math.round(gold * (this.mod.goldMult || 1));
      xp = Math.round(xp * 1.45);
      this.coop.net.send({ k: 'cend', result: 'win', gold, xp });
      this.finishShared({ result: 'win', gold, xp });
      return true;
    }
    if (this.run.down && (this.coop.partners.size === 0 || this.coop.allPartnersDown())) {
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
    setTimeout(() => this.resolve({ result: d.result, gold: d.gold || 0, xp: d.xp || 0, noDamage: !this.damageTaken, usedUltimate: !!this.usedUltimate }), d.result === 'win' ? 500 : 900);
  }

  /* ================= PLAYER ACTIONS (both modes) ================= */
  async useSkill(sk, cost) {
    this.locked = true;
    this.actionBar.querySelectorAll('button').forEach(b => b.disabled = true);
    this.run.mp -= cost;
    if (sk.charge) { this.charge = Math.max(0, this.charge - sk.charge); this.renderCharge(); if (sk.charge >= 6) this.usedUltimate = true; }
    if (sk.selfHpCost) this.run.hp = Math.max(1, this.run.hp - Math.round(this.run.maxHp * sk.selfHpCost));
    const d = this.d();

    // Guard: the universal defensive action
    if (sk.guard) {
      this.player.guarding = true;
      this.run.guardCount = (this.run.guardCount || 0) + 1;
      this.gainCharge(CONFIG.guard.chargeGain);
      this.log('You brace behind your guard.', 'log-good');
      SFX.heal();
      if (this.shared) {
        this.coop.net.send({ k: 'cact', label: 'Guard', targets: [] });
        this.coop.broadcastStatus(this.runStatus(), 'fighting');
      }
      this.renderPlayers(this._actingKey);
      await sleep(450);
      this.endPlayerAction();
      return;
    }

    // healer support: skills marked allyTarget can mend a companion (patch)
    if (sk.allyTarget && this.shared && [...this.allies.values()].some(a => !a.down)) {
      const to = await this.pickHealTarget();
      if (to !== 'self') {
        const pct = sk.healPct || 0.3;
        this.coop.net.send({ k: 'cheal', to, pct, label: sk.name });
        this.coop.net.send({ k: 'cact', label: sk.name, targets: [] }); // advances partners' turn wait
        const a = this.allies.get(to);
        if (a) {
          a.hp = Math.min(a.maxHp, a.hp + Math.round(a.maxHp * pct));
          this.spawnFx(this.sprite(to), 'heal');
          this.log(`You mend ${a.name}.`, 'log-good');
          SFX.heal();
        }
        this.renderPlayers(this._actingKey);
        await sleep(500);
        this.endPlayerAction();
        return;
      }
    }

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
    if (this.shared) {
      this.coop.net.send(actOps);
      this.coop.broadcastStatus(this.runStatus(), 'fighting');
    }
    this.renderEnemies();
    this.renderPlayers(this._actingKey);
    await sleep(650);
    this.endPlayerAction();
  }

  applySelfSkill(sk, d) {
    this.spawnFx(this.el.querySelector('#sprite-player'), sk.fx || (sk.healPct ? 'heal' : 'buff'));
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
    if (sk.gainResource) {
      const amt = restoreMana(this.run, sk.gainResource);
      if (amt > 0) this.float(this.el.querySelector('#sprite-player'), `+${amt}`, 'mana');
    }
    if (sk.gainCharge) this.gainCharge(sk.gainCharge);
    SFX.heal();
  }

  hitEnemy(e, sk, d) {
    // damage scales off the skill's governing stat (STR warriors, INT mages...)
    const statVal = sk.stat === 'best' ? Math.max(d.str, d.dex, d.int, d.wis) : (d[sk.stat] || d.str);
    const buff = this.buffValue('str');
    const C = CONFIG.combat;
    let base = (statVal * C.playerStatWeight + d.atk * C.playerAtkWeight + this.run.level * C.playerLevelWeight + C.playerFlat)
      * (sk.power / 100) * buff.mult;
    let critChance = d.crit + (sk.critBonus || 0);
    const isCrit = this.rng.chance(clamp(critChance, 0, 85) / 100);
    let dmg = base * (0.85 + this.rng.next() * 0.3);
    if (isCrit) { dmg *= 1.6; this.gainCharge(CONFIG.charge.gainOnCrit); }
    dmg *= d.dmgMult * (this.mod.dmgMult || 1);
    if (e.boss) dmg *= d.bossDmgMult;
    if (e.statuses.hexed) dmg *= C.hexTakenMult;
    if (!sk.ignoreDef) dmg -= e.def;
    dmg = Math.max(1, Math.round(dmg));
    this.spawnFx(this.sprite(e.uid), sk.fx);

    if (sk.execute && !e.boss && e.hp / e.maxHp <= sk.execute) {
      dmg = e.hp;
      this.log(`${sk.name.toUpperCase()} — ${e.name} is slain outright!`, 'log-sys');
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

    if (sk.healPct) {
      const amt = heal(this.run, this.run.maxHp * sk.healPct);
      if (amt > 0) this.float(this.el.querySelector('#sprite-player'), `+${amt}`, 'heal');
    }

    const newStatuses = {};
    const burnCh = (sk.burn || 0) + d.burn;
    const freezeCh = (sk.freeze || 0) + d.freeze;
    if (e.hp > 0) {
      if (sk.poison && this.rng.chance(sk.poison)) { e.statuses.poison = 3; newStatuses.poison = 3; this.log(`${e.name} is poisoned.`, 'log-good'); }
      if (burnCh && this.rng.chance(burnCh)) { e.statuses.burn = 2; newStatuses.burn = 2; this.log(`${e.name} catches fire.`, 'log-good'); SFX.fire(); }
      if (freezeCh && this.rng.chance(freezeCh)) { e.statuses.frozen = 1; newStatuses.frozen = 1; this.log(`${e.name} is frozen solid.`, 'log-good'); SFX.freeze(); }
      if (sk.stun && this.rng.chance(sk.stun)) { e.statuses.stunned = 1; newStatuses.stunned = 1; this.log(`${e.name} is stunned.`, 'log-good'); }
      if (sk.hex && this.rng.chance(sk.hex)) { e.statuses.hexed = 3; newStatuses.hexed = 3; this.log(`${e.name} is hexed — it will suffer more.`, 'log-good'); }
    } else {
      this.gainCharge(CONFIG.charge.gainOnKill);
    }
    // lifesteal is capped hard: no single hit may heal more than a sliver (patch)
    const ls = (sk.lifesteal || 0) + d.lifesteal;
    if (ls > 0) {
      const capped = Math.min(dmg * ls, this.run.maxHp * CONFIG.combat.lifestealCapPct);
      const amt = heal(this.run, capped);
      if (amt > 0) this.float(this.el.querySelector('#sprite-player'), `+${amt}`, 'heal');
    }
    if (e.hp <= 0) this.log(`${e.name} is defeated!`, 'log-sys');

    return { uid: e.uid, dmg, crit: isCrit, hpAfter: e.hp, statuses: newStatuses, fx: sk.fx };
  }

  useConsumable(c) {
    this.locked = true;
    const idx = this.run.consumables.indexOf(c.id);
    if (idx === -1) return;
    this.run.consumables.splice(idx, 1);
    const actOps = { k: 'cact', label: c.name, targets: [] };
    if (c.heal) { const amt = heal(this.run, c.heal); this.float(this.el.querySelector('#sprite-player'), `+${amt}`, 'heal'); SFX.heal(); }
    if (c.mana) { restoreMana(this.run, c.mana); this.float(this.el.querySelector('#sprite-player'), `+${c.mana}`, 'mana'); }
    if (c.fame) changeFame(this.run, c.fame);
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
    this.renderPlayers(this._actingKey);
    setTimeout(() => this.endPlayerAction(), 600);
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
      setTimeout(() => this.endPlayerAction(), 600);
    }
  }

  /* ================= ENEMY TURN (solo) ================= */
  async enemyTurn(e) {
    e.turnCount++;
    e.charge = addCharge(e.charge || 0, (e.chargeGain || 1), this.mod.chargeMult || 1);
    this.renderEnemies();

    if (e.summons && e.turnCount % 3 === 0 && this.enemies.filter(x => x.hp > 0).length < 3) {
      const minion = buildEnemy(
        { id: 'skeleton', name: 'Risen Skeleton', glyph: '💀', hp: 30, atk: 9, def: 2, spd: 6, gold: [0, 0], xp: 5 },
        this.run.floor, this.run.floor);
      this.enemies.push(minion);
      this.order.push({ key: minion.uid, name: minion.name, glyph: minion.glyph, spdStat: minion.spd, isPlayer: false, stableId: minion.uid, init: 0 });
      this.log(`${e.name} drags a servant up from the dust!`, 'log-hit');
      this.renderEnemies();
      this.renderTurnOrder(e.uid);
      await sleep(400);
      return;
    }
    this.bossPhaseChecksSolo(e);

    if (e.statuses.frozen || e.statuses.stunned) {
      this.log(`${e.name} is ${e.statuses.frozen ? 'frozen' : 'stunned'} — it cannot act.`, 'log-good');
      delete e.statuses.frozen; delete e.statuses.stunned;
      this.renderEnemies();
      await sleep(350);
      return;
    }

    const special = pickEnemySpecial(e);
    if (special) {
      e.charge = 0;
      this.log(`${e.name} unleashes ${special.name}!`, 'log-sys');
      SFX.bossIntro();
    }

    const sprite = this.sprite(e.uid);
    if (sprite) { sprite.classList.add('attack'); setTimeout(() => sprite.classList.remove('attack'), 420); }
    await sleep(240);

    const d = this.d();
    const dodgeBuff = this.buffValue('dodge');
    const dodgeCh = clamp(d.dodge + dodgeBuff.add, 0, 80);
    if (!special && this.rng.chance(dodgeCh / 100)) {
      this.float(this.el.querySelector('#sprite-player'), 'MISS', 'miss');
      this.log(`${e.name} attacks — you evade!`, 'log-good');
      SFX.miss();
      await sleep(380);
      return;
    }

    let dmg = e.atk * CONFIG.combat.enemyAtkMult * (0.85 + this.rng.next() * 0.3) * (this.mod.dmgMult || 1) * (special?.mult || 1);
    if (this.rng.chance(d.enemyCrit / 100)) dmg *= 1.5;
    dmg -= d.def;
    if (e.caster && !special && e.turnCount % 2 === 0) { dmg *= 1.4; this.log(`${e.name} channels a darker spell!`, 'log-hit'); }
    const shield = this.player.statuses.shield;
    if (shield) dmg *= (1 - shield.mult);
    dmg = applyGuard(Math.max(1, Math.round(dmg * d.dmgTakenMult)), this.player.guarding);

    this.run.hp = Math.max(0, this.run.hp - dmg);
    this.damageTaken = (this.damageTaken || 0) + dmg;
    if (d.chargeOnHit) this.gainCharge(1);
    this.float(this.el.querySelector('#sprite-player'), `-${dmg}`, 'dmg');
    SFX.hit();
    this.log(`${e.name}${special ? ` (${special.name})` : ''} hits you for ${dmg}${this.player.guarding ? ' (guarded)' : ''}.`, 'log-hit');

    if (e.lifesteal || special?.heal) {
      e.hp = Math.min(e.maxHp, e.hp + Math.round(dmg * (e.lifesteal || 0)) + Math.round(e.maxHp * (special?.heal || 0)));
      this.log(`${e.name} drinks deep.`, 'log-hit');
    }
    if (((e.poison && this.rng.chance(e.poison)) || special?.poisonSure) && !this.rng.chance(d.poisonResist)) { this.player.statuses.poison = 3; this.log('You are poisoned!', 'log-hit'); }
    if ((e.burn && this.rng.chance(e.burn)) || special?.burnSure) { this.player.statuses.burn = 2; this.log('You are set ablaze!', 'log-hit'); }
    if ((e.freeze && this.rng.chance(e.freeze)) || special?.freezeSure) { this.player.statuses.frozen = 1; this.log('You are frozen!', 'log-hit'); SFX.freeze(); }

    if (this.run.hp <= 0) this.deathSaves();

    this.renderPlayers();
    this.renderEnemies();
    await sleep(420);
  }

  bossPhaseChecksSolo(e) {
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
        }
      }
    }
    if (e.phases && e.hp / e.maxHp <= 0.5 && !e.phaseTriggers.includes('enrage')) {
      e.phaseTriggers.push('enrage');
      e.atk = Math.round(e.atk * 1.3);
      e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * 0.12));
      if (e.chargeOnPhase) e.charge = addCharge(e.charge || 0, e.chargeOnPhase);
      this.log(`${e.name}: "${e.taunt}"`, 'log-sys');
      this.log('The Demon King stops holding back.', 'log-hit');
      SFX.bossIntro(); screenShake();
      this.renderEnemies(); this.renderPlayers();
    }
  }

  /* ---- end-of-round upkeep ---- */
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
      if (e.statuses.hexed) { e.statuses.hexed--; if (e.statuses.hexed <= 0) delete e.statuses.hexed; }
      if (e.regen && e.hp > 0 && e.hp < e.maxHp) {
        const amt = Math.round(e.maxHp * e.regen);
        e.hp = Math.min(e.maxHp, e.hp + amt);
        this.log(`${e.name} regenerates ${amt}.`, 'log-hit');
        ops?.push({ type: 'eregen', uid: e.uid, amt, hpAfter: e.hp });
      }
    }
    this.renderEnemies();
    await sleep(200);
  }

  async upkeep() {
    if (!this.shared) await this.tickEnemyStatuses();
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
    if (this.mod.hpDrainPct && !this.run.down && this.run.hp > 0) {
      const drain = Math.max(1, Math.round(this.run.maxHp * this.mod.hpDrainPct));
      this.run.hp = Math.max(0, this.run.hp - drain);
      this.log(`The floor drinks ${drain} of your blood.`, 'log-hit');
      SFX.bad();
      if (this.run.hp <= 0) { this.deathSaves(); if (this.shared && this.run.hp <= 0) this.goDown(); }
    }
    this.renderPlayers(this._actingKey);
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
    if (this.aliveEnemies().length === 0) {
      const d = this.d();
      let gold = 0, xp = 0;
      for (const e of this.enemies) {
        gold += this.rng.int(e.gold[0], e.gold[1]);
        xp += e.xp;
      }
      gold = Math.round(gold * d.goldMult * d.combatGoldMult * (this.mod.goldMult || 1));
      xp = Math.round(xp * 1.45 * d.xpMult);
      this.finishSolo('win', { gold, xp });
      return true;
    }
    return false;
  }

  finishSolo(result, extra = {}) {
    this.locked = true;
    this.ended = true;
    if (CONFIG.charge.resetAfterCombat) this.charge = 0;
    this.rng.advance?.();
    setTimeout(() => this.resolve({ result, noDamage: !this.damageTaken, usedUltimate: !!this.usedUltimate, ...extra }), result === 'win' ? 500 : 900);
  }
}
