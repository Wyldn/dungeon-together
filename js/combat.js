// Turn-based combat engine (handoff §8–§14).
//   - Initiative rolls at every battle; visible turn order on the left.
//   - Universal Guard (30% block) and Basic Attack, regardless of weapon.
//   - Six-segment Battle Charge for players AND enemies; AOE/heavy hits gated.
//   - Enemy specials telegraphed one segment before they're ready.
// Two drivers: solo (fully interleaved initiative) and shared co-op
// (players act in seat order, then the host resolves enemies — protocol
// constraint; the displayed order reflects what actually happens).

import { SKILLS } from './data/skills.js';
import { CONSUMABLES } from './data/items.js';
import { CONFIG } from './data/config.js';
import { enemyScale, softLevelDamage, rewardMult } from './data/tdc.js';
import { derived, gearHas, heal, restoreMana, usableSkillIds, resourceName, changeFame, classTitle } from './character.js';
import { initiativeOrder, addCharge, tickEnemyCharge, canAfford, pickEnemySpecial, enemyTelegraph, applyGuard } from './systems.js';
import { biomeForFloor, ENEMIES } from './data/enemies.js';
import { ICONS } from './icons.js';
import { enemySpriteHtml, heroSpriteHtml, biomeBgUrl } from './art.js';
import { SFX } from './audio.js';
import { screenShake } from './fx.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const LAST_FLOOR = 51;

const DEFAULT_SUMMONS = {
  skeleton: { id: 'skeleton', name: 'Risen Skeleton', glyph: '💀', hp: 30, atk: 9, def: 2, spd: 6, gold: [0, 0], xp: 5 },
  leech: { id: 'leech', name: 'Bound Leech', glyph: '🪱', hp: 28, atk: 10, def: 1, spd: 6, gold: [0, 0], xp: 5, lifesteal: 0.35 },
  imp: { id: 'imp', name: 'Cinder Imp', glyph: '👺', hp: 26, atk: 11, def: 2, spd: 11, gold: [0, 0], xp: 5, burn: 0.25 },
  slime: { id: 'slime', name: 'Spawn Slime', glyph: '🟢', hp: 24, atk: 8, def: 1, spd: 4, gold: [0, 0], xp: 5 },
  rat: { id: 'rat', name: 'Sewer Rat', glyph: '🐀', hp: 18, atk: 7, def: 0, spd: 10, gold: [0, 0], xp: 4 },
};

function summonSpecFor(summonId) {
  if (!summonId) return DEFAULT_SUMMONS.skeleton;
  if (DEFAULT_SUMMONS[summonId]) return { ...DEFAULT_SUMMONS[summonId] };
  for (const pool of Object.values(ENEMIES)) {
    const found = pool.find(e => e.id === summonId);
    if (found) {
      return {
        id: found.id, name: found.name, glyph: found.glyph,
        hp: Math.round(found.hp * 0.55), atk: Math.round(found.atk * 0.7),
        def: Math.max(0, found.def - 1), spd: found.spd,
        gold: [0, 0], xp: 5,
        burn: found.burn, poison: found.poison, lifesteal: found.lifesteal, freeze: found.freeze,
      };
    }
  }
  return DEFAULT_SUMMONS.skeleton;
}

function spawnSummon(fight, bossEnemy) {
  const spec = summonSpecFor(bossEnemy.summons);
  const minion = buildEnemy(spec, fight.run.floor, fight.run.floor);
  minion.summon = true;
  minion.spawnIn = true;
  fight.enemies.push(minion);
  fight.order.push({
    key: minion.uid, name: minion.name, glyph: minion.glyph,
    spdStat: minion.spd, isPlayer: false, stableId: minion.uid, init: 0,
  });
  return minion;
}

/** Whether this enemy hit should freeze the player. `freezeEvery` = once per N turns. */
function enemyHitFreezes(e, special, rng) {
  if (e.freezeEvery) {
    return e.turnCount > 0 && e.turnCount % e.freezeEvery === 0;
  }
  return (e.freeze && rng.chance(e.freeze)) || !!special?.freezeSure;
}

export function buildEnemy(spec, floor, biomeStart, { boss = false, hpMult = 1 } = {}) {
  const isBoss = boss || !!spec.boss;
  const biome = biomeForFloor(floor);
  const sc = enemyScale(floor, biomeStart, biome.id, { boss: isBoss, elite: !!spec.elite });
  const spd = Math.max(1, Math.round((spec.spd || 5) * sc.spd));
  return {
    ...spec,
    boss: isBoss,
    elite: !!spec.elite,
    maxHp: Math.round(spec.hp * sc.hp * hpMult),
    hp: Math.round(spec.hp * sc.hp * hpMult),
    atk: Math.round(spec.atk * sc.atk),
    def: Math.round(spec.def * sc.def),
    spd,
    chargeGain: (spec.chargeGain || 1) * sc.chargeGain,
    charge: 0,
    statuses: {},
    phaseTriggers: [],
    turnCount: 0,
    uid: spec.uid || Math.random().toString(36).slice(2, 8),
  };
}

export function startCombat({ container, run, rng, enemies, modifier = null, introText = null, onHud, coop = null, onCharacter = null }) {
  return new Promise(resolve => {
    const C = new Fight(container, run, rng, enemies, modifier, introText, onHud, resolve, coop, onCharacter);
    C.begin();
  });
}

class Fight {
  constructor(container, run, rng, enemies, modifier, introText, onHud, resolve, coop, onCharacter) {
    this.el = container;
    this.run = run;
    this.rng = rng;
    this.enemies = enemies;
    this.mod = modifier || {};
    this.introText = introText;
    this.onHud = onHud;
    this.resolve = resolve;
    this.coop = coop;
    this.onCharacter = onCharacter;
    this.shared = !!coop;
    this.player = { statuses: {}, buffs: [], guarding: false };
    this.charge = clamp((run.metaStartCharge || 0) + derived(run).startCharge, 0, CONFIG.charge.max);
    this.actionMode = 'root'; // root | skills | items | flee (handoff moded menu)
    this._actEnabled = false;
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
          dex: p.status?.stats?.dex ?? p.status?.dex,
          spdStat: p.status?.spdStat,
          initiative: p.status?.initiative ?? 0,
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
    if (!this.logEl) return;
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = msg;
    this.logEl.appendChild(div);
    while (this.logEl.children.length > 60) this.logEl.firstChild.remove();

    // New action → wake the log and snap to the latest (bottom) line
    this._wakeCombatLog();
    this.logEl.scrollTop = this.logEl.scrollHeight;
  }

  _wakeCombatLog() {
    if (!this.logEl) return;
    this.logEl.classList.add('log-awake');
    this.logEl.classList.remove('log-idle');
    clearTimeout(this._logFade);
    // Stay readable while hovered; otherwise drift to translucent after a quiet stretch
    if (!this.logEl.matches(':hover')) {
      this._logFade = setTimeout(() => {
        if (!this.logEl || this.logEl.matches(':hover')) return;
        this.logEl.classList.remove('log-awake');
        this.logEl.classList.add('log-idle');
      }, 4500);
    }
  }

  _bindCombatLog() {
    if (!this.logEl || this._logBound) return;
    this._logBound = true;
    this.logEl.classList.add('log-awake');
    this.logEl.addEventListener('mouseenter', () => {
      clearTimeout(this._logFade);
      this.logEl.classList.add('log-awake');
      this.logEl.classList.remove('log-idle');
    });
    this.logEl.addEventListener('mouseleave', () => {
      clearTimeout(this._logFade);
      this._logFade = setTimeout(() => {
        if (!this.logEl || this.logEl.matches(':hover')) return;
        this.logEl.classList.remove('log-awake');
        this.logEl.classList.add('log-idle');
      }, 1800);
    });
    // If the player was reading older lines, a new move still resumes to latest (handled in log())
  }

  float(hostEl, text, cls) {
    if (!hostEl) return;
    const layer = this.fxLayer || this.el;
    const isCrit = cls === 'crit';
    const isIncoming = cls === 'incoming';
    const f = document.createElement('div');
    f.className = `float-text ${cls || 'dmg'}`;
    if (isCrit) {
      f.innerHTML = `<span class="float-crit-tag">CRIT</span><span class="float-crit-num">${text}</span>`;
    } else {
      f.textContent = text;
    }
    layer.appendChild(f);
    const hr = hostEl.getBoundingClientRect();
    const lr = layer.getBoundingClientRect();
    // Slight horizontal jitter so multi-hits / stacked floats don't fully overlap
    const jitter = (Math.random() * 18) - 9;
    f.style.left = `${hr.left + hr.width / 2 - lr.left + jitter}px`;
    f.style.top = `${hr.top + hr.height * (isIncoming ? 0.05 : 0.1) - lr.top}px`;
    const ms = isCrit
      ? Math.round((CONFIG.combat.floatMs || 1200) * 1.35)
      : (CONFIG.combat.floatMs || 1200);
    setTimeout(() => f.remove(), ms);
  }

  /** Anchor floating numbers on the combatant card (sprite parent), not the sprite alone. */
  playerFloatHost() {
    const spr = this.el.querySelector('#sprite-player');
    return spr?.parentElement || spr;
  }
  allyFloatHost(id) {
    const spr = this.sprite(id);
    return spr?.parentElement || spr;
  }

  enemyByUid(uid) { return this.enemies.find(e => e.uid === uid); }
  sprite(uid) { return this.el.querySelector(`#sprite-${uid}`); }

  // §12: has the boss picked up any player-applied affliction?
  hasDebuff(st) { return !!(st.poison || st.burn || st.frozen || st.stunned || st.hexed); }
  hasHardCC(st) { return !!(st.frozen || st.stunned); }

  // §12: bosses shrug afflictions on a slow cadence, or burn Battle Charge to break freeze/stun.
  // Returns 'broke' | 'cleansed' | null. Call after charge tick, before the skip check.
  resolveBossAntiCC(e, ops = null) {
    if (!e.boss) return null;
    const every = e.cleanseEvery ?? CONFIG.boss.cleanseEvery;
    const cost = e.cleanseCost ?? CONFIG.boss.cleanseCost;

    // Spend FOC to tear free of hard CC and keep acting this turn
    if (this.hasHardCC(e.statuses) && cost > 0 && (e.charge || 0) >= cost) {
      e.charge -= cost;
      delete e.statuses.frozen;
      delete e.statuses.stunned;
      this.log(`${e.name} burns ${cost} Battle Charge and tears free of the binding!`, 'log-hit');
      SFX.bossIntro();
      ops?.push({ type: 'echarge', uid: e.uid, charge: e.charge });
      ops?.push({ type: 'breakcc', uid: e.uid, cost });
      this.renderEnemies();
      return 'broke';
    }

    // Periodic full cleanse (DoTs + any leftover hard CC)
    if (e.turnCount > 0 && e.turnCount % every === 0 && this.hasDebuff(e.statuses)) {
      this.cleanseBoss(e);
      ops?.push({ type: 'cleanse', uid: e.uid });
      return 'cleansed';
    }
    return null;
  }

  // §12: bosses periodically shrug off crowd-control so it can't be cheesed.
  cleanseBoss(e) {
    delete e.statuses.poison; delete e.statuses.burn; delete e.statuses.frozen;
    delete e.statuses.stunned; delete e.statuses.hexed;
    this.log(`${e.name} draws a breath of pure spite — every affliction sloughs away.`, 'log-hit');
    SFX.bossIntro();
    this.renderEnemies();
  }

  // §15 Prism of Discord: a bewildered enemy strikes one of its own instead.
  async enemyConfusedStrike(e) {
    const others = this.aliveEnemies().filter(x => x.uid !== e.uid);
    if (!others.length) return false;
    const victim = this.rng.pick(others);
    this.log(`${e.name} is bewildered and turns on ${victim.name}!`, 'log-good');
    const es = this.sprite(e.uid);
    if (es) { es.classList.add('attack'); setTimeout(() => es.classList.remove('attack'), 420); }
    await sleep(220);
    let dmg = Math.max(1, Math.round(e.atk * CONFIG.combat.enemyAtkMult * (0.85 + this.rng.next() * 0.3) - victim.def));
    victim.hp = Math.max(0, victim.hp - dmg);
    const vs = this.sprite(victim.uid);
    if (vs) { vs.classList.add('hit'); setTimeout(() => vs.classList.remove('hit'), 360); this.float(vs.parentElement, `${dmg}`, 'dmg'); }
    SFX.hit();
    if (victim.hp <= 0) this.log(`${victim.name} is cut down by its own ally!`, 'log-sys');
    this.renderEnemies();
    await sleep(360);
    return true;
  }

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
    // Co-op: deterministic seat order for players (same on every client), then
    // enemies by uid. Personal RNGs diverge across the party, so rolling
    // initiative locally (or racing a corder packet) desyncs the turn strip.
    if (this.shared) {
      const d = this.d();
      const seats = this.coop.seatOrder();
      const players = seats.map(sid => {
        if (sid === this.coop.you) {
          return {
            key: 'player', name: this.run.name, glyph: null,
            spdStat: Math.round(4 + d.dex * 0.3), mod: d.initiative,
            isPlayer: true, stableId: sid,
          };
        }
        const a = this.allies.get(sid);
        const spd = a?.spdStat ?? (a?.dex != null ? Math.round(4 + a.dex * 0.3) : 8);
        return {
          key: 'ally-' + sid, name: a?.name || 'Companion', glyph: null,
          spdStat: spd, mod: a?.initiative || 0,
          isPlayer: true, stableId: sid,
        };
      });
      const foes = this.aliveEnemies()
        .map(e => ({ key: e.uid, name: e.name, glyph: e.glyph, spdStat: e.spd, mod: 0, isPlayer: false, stableId: e.uid }))
        .sort((a, b) => String(a.stableId).localeCompare(String(b.stableId)));
      this.order = [...players, ...foes];
      this.log('Turn order: ' + this.order.map(o => o.name).join(' → '), 'log-sys');
      return;
    }
    const d = this.d();
    const entities = [
      { key: 'player', name: this.run.name, glyph: null, spdStat: Math.round(4 + d.dex * 0.3), mod: d.initiative + (this.mod.enemyFirst ? -100 : 0), isPlayer: true, stableId: 'p-me' },
      ...this.aliveEnemies().map(e => ({ key: e.uid, name: e.name, glyph: e.glyph, spdStat: e.spd, mod: 0, isPlayer: false, stableId: e.uid })),
    ];
    this.order = initiativeOrder(this.rng, entities, this.run.floor);
    this.log('Initiative: ' + this.order.map(o => o.name).join(' → '), 'log-sys');
  }

  /* ---------------- rendering ---------------- */
  begin() {
    const biome = biomeForFloor(this.run.floor);
    this.el.innerHTML = `
      <div class="combat-screen cx-full">
        <div class="battlefield cx-bg">
          ${this.mod.name ? `<div class="modifier-banner cx-mod">⚠ ${this.mod.name} — ${this.mod.desc}</div>` : ''}
          <!-- top bar: floor plate (centre) + hero plate + CHARACTER -->
          <div class="cx-topbar">
            <div class="cx-side"></div>
            <div class="cx-floor">
              <div class="cx-floor-biome">${biome.name}</div>
              <div class="cx-floor-num">FLOOR ${this.run.floor} <span>/</span> ${LAST_FLOOR}</div>
            </div>
            <div class="cx-hero">
              <div class="cx-hero-plate">
                <div class="cx-hero-name">${this.run.name}</div>
                <div class="cx-hero-title">Lv.${this.run.level} ${this.run.raceName} ${classTitle(this.run)}</div>
              </div>
              <button class="cx-char-btn" id="cx-character">◈ CHARACTER</button>
            </div>
          </div>
          <div class="turn-order cx-turnorder" id="turn-order"></div>
          <div class="charge-tray cx-charge" id="charge-tray"></div>
          <div class="turn-banner cx-banner" id="turn-banner" style="display:none">⚔ YOUR TURN</div>
          <div class="enemy-row cx-monsters"></div>
          <div class="player-row cx-party"></div>
          <div class="combat-fx-layer" id="combat-fx"></div>
          <div class="combat-log cx-log"></div>
          <div class="combat-actions">
            <div class="combat-utility"></div>
            <div class="action-bar mode-root"></div>
          </div>
        </div>
      </div>`;
    const bf = this.el.querySelector('.battlefield');
    const bg = biomeBgUrl(this.run.biomeId);
    if (bf && bg) { bf.classList.add('has-bg'); bf.style.backgroundImage = `url('${bg}')`; }
    const charBtn = this.el.querySelector('#cx-character');
    if (charBtn) charBtn.onclick = () => { SFX.click(); this.onCharacter?.(); };
    this.enemyRow = this.el.querySelector('.enemy-row');
    this.playerRow = this.el.querySelector('.player-row');
    this.fxLayer = this.el.querySelector('#combat-fx');
    this.turnOrderEl = this.el.querySelector('#turn-order');
    this.chargeTray = this.el.querySelector('#charge-tray');
    this.logEl = this.el.querySelector('.combat-log');
    this.actionBar = this.el.querySelector('.action-bar');
    this.utilBar = this.el.querySelector('.combat-utility');
    this._bindCombatLog();

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

  // per-fighter FOC pips (handoff §4) — filled = charge segments
  focPips(current, max = CONFIG.charge.max) {
    let p = '';
    for (let i = 0; i < max; i++) p += `<span class="fpip ${i < current ? 'lit' : ''}"></span>`;
    return `<span class="foc-pips">${p}</span>`;
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
      .filter(o => o.isPlayer || (this.enemyByUid(o.key)?.hp > 0 && !this.enemyByUid(o.key)?.cleared))
      .map(o => `<div class="to-entry ${o.key === activeKey ? 'active' : ''} ${o.isPlayer ? 'to-player' : ''}">
        <span class="to-glyph">${o.glyph || '🛡'}</span><span class="to-name">${o.name}</span>
      </div>`).join('');
  }

  /** Play death anim, then pull corpses off the board while the fight continues. */
  scheduleClearFallen() {
    for (const e of this.enemies) {
      if (e.hp > 0 || e.cleared || e._clearing) continue;
      e._clearing = true;
      const uid = e.uid;
      setTimeout(() => {
        if (this.ended) return;
        const foe = this.enemyByUid(uid);
        if (!foe || foe.hp > 0 || foe.cleared) return;
        // Only remove while other foes remain — last kill settles as a corpse for the victory beat
        if (this.aliveEnemies().length > 0) {
          foe.cleared = true;
          foe._clearing = false;
          this.renderEnemies();
          this.renderTurnOrder(this._actingKey);
        } else {
          foe._clearing = false;
          const card = this.el.querySelector(`#sprite-${uid}`)?.closest('.combatant');
          if (card) { card.classList.remove('dying'); card.classList.add('dead'); }
        }
      }, 580);
    }
  }

  renderEnemies() {
    // Fix target before paint so we don't rebuild mid-death-anim
    if (this.enemies[this.target]?.hp <= 0 || this.enemies[this.target]?.cleared) {
      this.target = this.enemies.findIndex(e => e.hp > 0 && !e.cleared);
    }
    this.scheduleClearFallen();

    // Keep in-progress death cards so re-renders don't restart the anim
    const keepDying = new Map();
    for (const child of [...this.enemyRow.children]) {
      const sid = child.querySelector('.fighter-sprite')?.id || '';
      const uid = sid.startsWith('sprite-') ? sid.slice(7) : '';
      const foe = uid ? this.enemyByUid(uid) : null;
      if (foe && foe._clearing && !foe.cleared && foe.hp <= 0) keepDying.set(uid, child);
    }

    this.enemyRow.innerHTML = '';
    this.enemies.forEach((e, i) => {
      if (e.cleared) return;
      if (keepDying.has(e.uid)) {
        this.enemyRow.appendChild(keepDying.get(e.uid));
        return;
      }
      const tel = e.hp > 0 ? enemyTelegraph(e) : null;
      const dying = e.hp <= 0 && e._clearing;
      const spawn = !!e.spawnIn && e.hp > 0;
      const div = document.createElement('div');
      div.className = [
        'combatant', 'enemy',
        e.elite ? 'elite' : '',
        e.boss ? 'boss' : '',
        e.hp <= 0 ? (dying ? 'dying' : 'dead') : 'targetable',
        spawn ? 'summon-in' : '',
        i === this.target ? 'target' : '',
      ].filter(Boolean).join(' ');
      const art = enemySpriteHtml(e.artId || e.id, { boss: e.boss, elite: e.elite, summon: e.summon });
      div.innerHTML = `
        ${tel ? `<div class="telegraph ${tel.ready ? 'ready' : ''}">${tel.ready ? '⚠ ' + tel.name + '!' : '… ' + tel.desc}</div>` : ''}
        <div class="fighter-sprite" id="sprite-${e.uid}">${art || e.glyph}</div>
        <div class="cx-info">
          <div class="cx-head"><span class="fighter-name">${e.name}</span><span class="cx-lv">Lv.${this.run.floor}</span></div>
          <div class="cx-bar-row"><span class="cx-blabel hp">HP</span><div class="bar cx-thin"><div class="bar-fill hp" style="width:${clamp(e.hp / e.maxHp * 100, 0, 100)}%"></div><span class="cx-bar-num">${Math.max(0, Math.round(e.hp))}/${Math.round(e.maxHp)}</span></div></div>
          <div class="cx-bar-row"><span class="cx-blabel foc">FOC</span>${this.focPips(e.charge || 0)}</div>
        </div>
        <div class="fighter-statuses">${this.statusPips(e.statuses)}</div>`;
      div.onclick = () => { if (e.hp > 0) { this.target = i; this.renderEnemies(); SFX.click(); } };
      this.enemyRow.appendChild(div);
      if (spawn) {
        const uid = e.uid;
        setTimeout(() => {
          const foe = this.enemyByUid(uid);
          if (foe) foe.spawnIn = false;
        }, 560);
      }
    });
  }

  renderPlayers(actingKey = null) {
    const s = this.player.statuses;
    const hpW = clamp(this.run.hp / this.run.maxHp * 100, 0, 100);
    const mpW = clamp(this.run.mp / Math.max(1, this.run.maxMp) * 100, 0, 100);
    const resName = resourceName(this.run);
    const resShort = resName.length > 4 ? resName.slice(0, 3).toUpperCase() : resName.toUpperCase();
    let html = `
      <div class="combatant ${this.run.down ? 'downed' : ''} ${actingKey === 'player' ? 'acting' : ''}">
        <div class="fighter-sprite" id="sprite-player">${heroSpriteHtml(this.run.classId) || ICONS[this.run.classId]}</div>
        <div class="cx-info">
          <div class="cx-head"><span class="fighter-name">${this.run.name}${this.run.down ? ' (down)' : ''}</span></div>
          <div class="cx-bar-row"><span class="cx-blabel hp">HP</span><div class="bar cx-thin"><div class="bar-fill hp" style="width:${hpW}%"></div><span class="cx-bar-num">${Math.round(this.run.hp)}/${Math.round(this.run.maxHp)}</span></div></div>
          <div class="cx-bar-row"><span class="cx-blabel mp" title="${resName}">${resShort}</span><div class="bar cx-thin"><div class="bar-fill mp" style="width:${mpW}%"></div><span class="cx-bar-num">${Math.round(this.run.mp)}/${Math.round(this.run.maxMp)}</span></div></div>
          <div class="cx-bar-row"><span class="cx-blabel foc">FOC</span>${this.focPips(this.charge)}<span class="cx-bar-num cx-foc-num">${this.charge}/${CONFIG.charge.max}</span></div>
        </div>
        <div class="fighter-statuses">
          ${this.player.guarding ? '<span class="status-pip guard-pip">🛡 GUARD</span>' : ''}
          ${this.statusPips(s)}${this.player.buffs.map(b => `<span class="status-pip">▲${b.label} ${b.turns}</span>`).join('')}
        </div>
      </div>`;
    for (const [id, a] of this.allies) {
      html += `
        <div class="combatant ${a.down ? 'downed' : ''} ${actingKey === 'ally-' + id ? 'acting' : ''}">
          <div class="fighter-sprite" id="sprite-${id}">${heroSpriteHtml(a.classId) || ICONS[a.classId] || ICONS.warrior}</div>
          <div class="cx-info">
            <div class="cx-head"><span class="fighter-name">${a.name}${a.down ? ' (down)' : ''}</span></div>
            <div class="cx-bar-row"><span class="cx-blabel hp">HP</span><div class="bar cx-thin"><div class="bar-fill hp" style="width:${clamp(a.hp / a.maxHp * 100, 0, 100)}%"></div><span class="cx-bar-num">${Math.round(a.hp)}/${Math.round(a.maxHp)}</span></div></div>
          </div>
        </div>`;
    }
    this.playerRow.innerHTML = html;
    this.onHud?.();
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

  // Moded floating menu (handoff §4): root → FIGHT/ITEMS/FLEE, each opening a
  // submenu with a BACK chip. Wraps the existing useSkill/useConsumable/tryFlee.
  setMode(m) { this.actionMode = m; SFX.click(); this.renderActions(this._actEnabled); }

  renderActions(enabled) {
    this._actEnabled = enabled;
    if (!enabled) this.actionMode = 'root'; // reset when the turn ends
    this.actionBar.innerHTML = '';
    this.utilBar.innerHTML = '';
    switch (this.actionMode) {
      case 'skills': this.renderSkillMode(enabled); break;
      case 'items': this.renderItemMode(enabled); break;
      case 'flee': this.renderFleeMode(enabled); break;
      default: this.renderRootMode(enabled);
    }
  }

  backChip() {
    const b = document.createElement('button');
    b.className = 'action-back';
    b.textContent = '◄ BACK';
    b.disabled = !this._actEnabled;
    b.onclick = () => { if (!this.locked) this.setMode('root'); };
    return b;
  }

  renderRootMode(enabled) {
    this.actionBar.className = 'action-bar mode-root';
    const anyBoss = this.enemies.some(e => e.boss);
    const roots = [
      { label: 'FIGHT', accent: 'var(--blood)', go: () => this.setMode('skills') },
      { label: 'ITEMS', accent: 'var(--teal)', go: () => this.setMode('items') },
    ];
    if (!anyBoss && !this.shared) roots.push({ label: 'FLEE', accent: 'var(--gold)', go: () => this.setMode('flee') });
    for (const r of roots) {
      const btn = document.createElement('button');
      btn.className = 'action-root-btn';
      btn.style.setProperty('--acc', r.accent);
      btn.disabled = !enabled;
      btn.textContent = r.label;
      btn.onclick = () => { if (!this.locked) r.go(); };
      this.actionBar.appendChild(btn);
    }
  }

  // Estimated damage for a power skill against current stats (§4). No variance,
  // no crit — the honest baseline the formula tooltip promises.
  estimateSkill(sk) {
    if (!sk.power) return null;
    const d = this.d();
    const statVal = sk.stat === 'best' ? Math.max(d.str, d.dex, d.int, d.wis) : (d[sk.stat] || d.str);
    const C = CONFIG.combat;
    const base = (statVal * C.playerStatWeight + d.atk * C.playerAtkWeight + softLevelDamage(this.run.level, C.playerLevelWeight) + C.playerFlat)
      * (sk.power / 100) * this.buffValue('str').mult;
    const label = sk.stat === 'best' ? 'best stat' : sk.stat.toUpperCase();
    return { avg: Math.max(1, Math.round(base)), label, stat: sk.stat };
  }

  renderSkillMode(enabled) {
    this.actionBar.className = 'action-bar mode-skills';
    this.utilBar.appendChild(this.backChip());
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
      const est = this.estimateSkill(sk);
      // damage-formula hint (§4): "≈42 dmg · 130% DEX + weapon"
      const formula = est
        ? `≈${est.avg}${sk.target === 'all' ? ' ea' : ''} dmg · ${sk.power}% ${est.label}`
        : '';
      const btn = document.createElement('button');
      btn.className = `skill-btn ${sk.class === 'universal' ? 'universal' : ''} ${!isUsable ? 'incompatible' : ''}`;
      btn.disabled = !enabled || !isUsable || !affordable;
      btn.title = isUsable ? `${sk.name}\n${sk.desc}${formula ? '\n\n' + formula : ''}` : 'Incompatible weapon — only Strike and Guard are available.';
      btn.innerHTML = `
        <div class="sk-name"><span>${sk.name}</span>
          <span class="sk-cost">${cost ? `${cost} ${resName}` : ''}${cost && chargeCost ? ' + ' : ''}${chargeCost ? `${chargeCost}⚡` : ''}${!cost && !chargeCost ? 'FREE' : ''}</span></div>
        <div class="sk-desc">${!isUsable ? '⚠ Your weapon cannot channel this — class techniques need a compatible weapon.' : sk.desc}</div>
        ${isUsable && formula ? `<div class="sk-formula">⚔ ${formula}</div>` : ''}`;
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
  }

  renderItemMode(enabled) {
    this.actionBar.className = 'action-bar mode-items';
    this.utilBar.appendChild(this.backChip());
    const pots = this.run.consumables;
    const uniq = [...new Set(pots)];
    if (!uniq.length) {
      const empty = document.createElement('div');
      empty.className = 'combat-empty';
      empty.textContent = 'No items in your pack.';
      this.actionBar.appendChild(empty);
      return;
    }
    for (const cid of uniq) {
      const c = CONSUMABLES.find(x => x.id === cid);
      if (!c) continue;
      const count = pots.filter(x => x === cid).length;
      const b = document.createElement('button');
      b.className = 'item-btn';
      b.disabled = !enabled;
      b.innerHTML = `<span class="it-name">${c.name}</span><span class="it-qty">×${count}</span>`;
      b.onclick = () => { if (!this.locked) this.useConsumable(c); };
      this.actionBar.appendChild(b);
    }
  }

  renderFleeMode(enabled) {
    this.actionBar.className = 'action-bar mode-flee';
    this.actionBar.innerHTML = `<div class="flee-warn">The Tower does not release its guests so easily…</div>`;
    const row = document.createElement('div');
    row.className = 'flee-row';
    const stand = document.createElement('button');
    stand.className = 'flee-stand';
    stand.textContent = 'STAND & FIGHT';
    stand.disabled = !enabled;
    stand.onclick = () => { if (!this.locked) this.setMode('root'); };
    const run = document.createElement('button');
    run.className = 'flee-go';
    run.textContent = 'ATTEMPT FLEE';
    run.disabled = !enabled;
    run.onclick = () => { if (!this.locked) this.tryFlee(); };
    row.appendChild(stand); row.appendChild(run);
    this.actionBar.appendChild(row);
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
          // §15 The Echoing Stone: a chance to take the turn twice
          const de = this.d();
          if (de.echoChance && !this.ended && this.aliveEnemies().length && this.rng.chance(de.echoChance)) {
            this.log('The Echoing Stone stutters — time folds, and you act again!', 'log-sys');
            SFX.unlock();
            await this.playerTurn();
            if (this.checkEndSolo()) return;
          }
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
      if (a) {
        a.hp = d.hp; a.maxHp = d.maxHp; a.down = d.down;
        a.def = d.def ?? a.def; a.dodge = d.dodge ?? a.dodge;
        if (d.spdStat != null) a.spdStat = d.spdStat;
        if (d.initiative != null) a.initiative = d.initiative;
        if (d.dex != null) a.dex = d.dex;
      }
      this.renderPlayers(this._actingKey);
    }));
    this.offs.push(this.coop.net.sys('left', () => {
      for (const id of [...this.allies.keys()]) {
        if (!this.coop.partners.has(id)) this.allies.delete(id);
      }
      this.renderPlayers(this._actingKey);
    }));
    this._pendingActs = [];
    // §9: a companion reports the ACTUAL damage they took (post guard/shield)
    this.offs.push(this.coop.net.on('chit', (d, from) => {
      const a = this.allies.get(from);
      if (!a) return;
      this.float(this.allyFloatHost(from), `-${d.dmg}${d.guarded ? ' 🛡' : ''}`, 'incoming');
      this.renderPlayers(this._actingKey);
    }));
    // ally healing (e.g. a Priest's Mend cast on a companion)
    this.offs.push(this.coop.net.on('cheal', (d, from) => {
      const healer = this.allies.get(from)?.name || 'A companion';
      if (d.to === this.coop.you) {
        const amt = heal(this.run, this.run.maxHp * d.pct);
        this.float(this.el.querySelector('#sprite-player'), `+${amt}`, 'heal');
        this.spawnFx(this.el.querySelector('#sprite-player'), 'heal');
        this.log(`${healer} mends you with ${d.label}. (+${amt} HP)`, 'log-good');
        this.coop.broadcastStatus(this.runStatus(), 'fighting');
        this.onHud?.();
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

    // Seat order is already identical on every client (see rollBattleOrder).
    this.sharedSeats = this.order.filter(o => o.isPlayer).map(o => String(o.stableId));
    if (!this.sharedSeats.length) this.sharedSeats = this.coop.seatOrder();
    this.renderTurnOrder();

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
    return {
      ...r, def: d.def, dodge: d.dodge,
      spdStat: Math.round(4 + d.dex * 0.3),
      initiative: d.initiative,
    };
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
      await sleep(CONFIG.combat.hitPauseMs || 340);
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
    await sleep(CONFIG.combat.skillResolveMs || 950);
  }

  /* ---- host-computed enemy phase (shared) ---- */
  async hostEnemyPhase() {
    const ops = [];
    await this.tickEnemyStatuses(ops);
    if (!this.aliveEnemies().length) { this.broadcastEturn(ops); return; }

    for (const e of this.aliveEnemies()) {
      if (this.ended) return;
      e.turnCount++;
      e.charge = tickEnemyCharge(e, this.mod.chargeMult || 1);
      ops.push({ type: 'echarge', uid: e.uid, charge: e.charge });

      // §12: burn FOC to break hard CC, or shrug everything on cadence
      const anti = this.resolveBossAntiCC(e, ops);
      if (anti) await sleep(300);

      if (e.summons && e.turnCount % 3 === 0 && this.enemies.filter(x => x.hp > 0).length < 3) {
        const minion = spawnSummon(this, e);
        ops.push({ type: 'summon', spec: { ...minion, statuses: {}, spawnIn: true, summon: true } });
        this.log(`${e.name} drags a servant up from the dust!`, 'log-hit');
        this.renderEnemies();
        this.renderTurnOrder();
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
      // §12: heavy boss telegraphs scale with the charge they banked
      let chargeScale = 1;
      if (special) {
        if (e.boss) chargeScale = 1 + CONFIG.boss.chargeDamageScale * (e.charge || 0);
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
        let dmg = e.atk * CONFIG.combat.enemyAtkMult * (0.85 + this.rng.next() * 0.3) * (this.mod.dmgMult || 1) * (special?.mult || 1) * chargeScale;
        if (this.rng.chance(this.d().enemyCrit / 100)) dmg *= 1.5;
        if (e.caster && !special && e.turnCount % 2 === 0) dmg *= 1.4;
        dmg = Math.max(1, Math.round(dmg - target.def));
        const riders = {};
        if ((e.poison && this.rng.chance(e.poison)) || special?.poisonSure) riders.poison = 3;
        if ((e.burn && this.rng.chance(e.burn)) || special?.burnSure) riders.burn = 2;
        if (enemyHitFreezes(e, special, this.rng)) riders.freeze = 1;
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
      if (e.phaseArt) e.artId = e.phaseArt;
      if (e.phaseName) e.name = e.phaseName;
      if (e.phaseGlyph) e.glyph = e.phaseGlyph;
      if (e.phaseSpecials) e.specials = e.phaseSpecials;
      const evolve = e.phaseArt ? (e.phaseText || `${e.name} evolves into something worse.`) : `${e.name}: "${e.taunt}" — stops holding back.`;
      ops.push({
        type: 'phase', uid: e.uid, atk: e.atk, hpAfter: e.hp, charge: e.charge,
        artId: e.artId, name: e.name, glyph: e.glyph, specials: e.specials, text: evolve,
      });
      this.log(evolve, 'log-sys');
      SFX.bossIntro(); screenShake();
    }
  }

  applyHitOp(op, enemyRef = null) {
    const e = enemyRef || this.enemyByUid(op.uid);
    if (op.dodged) {
      const el = op.target === this.coop.you ? this.playerFloatHost() : this.allyFloatHost(op.target);
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
      this.float(this.playerFloatHost(), `-${dmg}`, 'incoming');
      SFX.hit();
      this.log(`${e?.name || 'The enemy'}${op.special ? ` (${op.special})` : ''} hits you for ${dmg}${this.player.guarding ? ' (guarded)' : ''}.`, 'log-hit');
      // §9: tell the party the ACTUAL damage taken (after guard/shield/armor),
      // so companions render the blocked number, not the host's raw estimate.
      this.coop.net.send({ k: 'chit', dmg, guarded: this.player.guarding });
      const r = op.riders || {};
      if (r.poison && !this.rng.chance(this.d().poisonResist)) { this.player.statuses.poison = r.poison; this.log('You are poisoned!', 'log-hit'); }
      if (r.burn) { this.player.statuses.burn = r.burn; this.log('You are set ablaze!', 'log-hit'); }
      if (r.freeze) { this.player.statuses.frozen = 1; this.log('You are frozen!', 'log-hit'); SFX.freeze(); }
      if (this.run.hp <= 0) this.deathSaves();
      if (this.run.hp <= 0) this.goDown();
      this.coop.broadcastStatus(this.runStatus(), 'fighting');
      this.onHud?.();
    } else {
      // §9: don't render the host's raw estimate — the target owns its true HP
      // and broadcasts the real (post-guard) number via 'chit' + authoritative
      // 'status'. We just note that a companion was struck.
      const a = this.allies.get(op.target);
      if (a) this.log(`${e?.name || 'The enemy'} strikes ${a.name}.`, 'log-hit');
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
        const minion = { ...op.spec, statuses: op.spec.statuses || {}, spawnIn: true };
        this.enemies.push(minion);
        // §9: keep the shared turn order in sync on every client
        if (!this.order.some(o => o.key === minion.uid)) {
          this.order.push({ key: minion.uid, name: minion.name, glyph: minion.glyph, spdStat: minion.spd, isPlayer: false, stableId: minion.uid, init: 0 });
        }
        this.log('Reinforcements claw their way in!', 'log-hit');
        this.renderEnemies();
        this.renderTurnOrder();
      } else if (op.type === 'cleanse') {
        const e = this.enemyByUid(op.uid);
        if (e) { delete e.statuses.poison; delete e.statuses.burn; delete e.statuses.frozen; delete e.statuses.stunned; delete e.statuses.hexed; }
        this.log(`${e?.name || 'The boss'} sloughs off every affliction.`, 'log-hit');
        this.renderEnemies();
      } else if (op.type === 'breakcc') {
        const e = this.enemyByUid(op.uid);
        if (e) { delete e.statuses.frozen; delete e.statuses.stunned; }
        this.log(`${e?.name || 'The boss'} burns ${op.cost || '?'} Battle Charge and tears free!`, 'log-hit');
        SFX.bossIntro();
        this.renderEnemies();
      } else if (op.type === 'echarge') {
        const e = this.enemyByUid(op.uid);
        if (e) e.charge = op.charge;
        this.renderEnemies();
      } else if (op.type === 'phase') {
        const e = this.enemyByUid(op.uid);
        if (e) {
          e.atk = op.atk; e.hp = op.hpAfter;
          if (op.charge != null) e.charge = op.charge;
          if (op.artId) e.artId = op.artId;
          if (op.name) e.name = op.name;
          if (op.glyph) e.glyph = op.glyph;
          if (op.specials) e.specials = op.specials;
        }
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
      gold = Math.round(gold * (this.mod.goldMult || 1) * CONFIG.economy.combatGoldMult * rewardMult(this.run.floor).gold);
      xp = Math.round(xp * 1.45 * rewardMult(this.run.floor).xp);
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
        await sleep(CONFIG.combat.hitPauseMs || 340);
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
    await sleep(CONFIG.combat.skillResolveMs || 950);
    this.endPlayerAction();
  }

  applySelfSkill(sk, d) {
    this.spawnFx(this.el.querySelector('#sprite-player'), sk.fx || (sk.healPct ? 'heal' : 'buff'));
    if (sk.shield) {
      this.player.statuses.shield = { mult: sk.shield, turns: CONFIG.defense.wardTurns };
      this.log(`You raise a ward — ${Math.round(sk.shield * 100)}% damage blocked for ${CONFIG.defense.wardTurns} turns.`, 'log-good');
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
    let base = (statVal * C.playerStatWeight + d.atk * C.playerAtkWeight + softLevelDamage(this.run.level, C.playerLevelWeight) + C.playerFlat)
      * (sk.power / 100) * buff.mult;
    let critChance = d.crit + (sk.critBonus || 0);
    const isCrit = this.rng.chance(clamp(critChance, 0, 85) / 100);
    let dmg = base * (0.85 + this.rng.next() * 0.3);
    if (isCrit) { dmg *= 1.6; this.gainCharge(CONFIG.charge.gainOnCrit); }
    dmg *= d.dmgMult * (this.mod.dmgMult || 1);
    if (e.boss) dmg *= d.bossDmgMult;
    if (e.statuses.hexed) dmg *= C.hexTakenMult;
    // The Berserker's Heart: on its chosen round, everything doubles (§15)
    if (d.doubleDmgRound && this.round === d.doubleDmgRound) dmg *= 2;
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
      const capped = Math.min(dmg * ls, this.run.maxHp * CONFIG.combat.lifestealCapPct * (d.lifestealCapMult || 1));
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
    e.charge = tickEnemyCharge(e, this.mod.chargeMult || 1);
    this.renderEnemies();

    // §12: burn FOC to break hard CC, or shrug everything on cadence
    const anti = this.resolveBossAntiCC(e);
    if (anti) await sleep(300);

    if (e.summons && e.turnCount % 3 === 0 && this.enemies.filter(x => x.hp > 0).length < 3) {
      spawnSummon(this, e);
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

    // §15 Prism of Discord: the enemy may turn on its own kind
    const dConf = this.d();
    if (dConf.confuseChance && this.aliveEnemies().length > 1 && this.rng.chance(dConf.confuseChance)) {
      if (await this.enemyConfusedStrike(e)) return;
    }

    const special = pickEnemySpecial(e);
    // §12: a boss's heavy telegraphed hit scales with the charge it banked
    let chargeScale = 1;
    if (special) {
      if (e.boss) chargeScale = 1 + CONFIG.boss.chargeDamageScale * (e.charge || 0);
      e.charge = 0;
      this.log(`${e.name} unleashes ${special.name}!${e.boss && chargeScale > 1.2 ? ' The air screams with pent-up force.' : ''}`, 'log-sys');
      SFX.bossIntro();
    }

    const sprite = this.sprite(e.uid);
    if (sprite) { sprite.classList.add('attack'); setTimeout(() => sprite.classList.remove('attack'), 420); }
    await sleep(240);

    const d = this.d();
    const dodgeBuff = this.buffValue('dodge');
    const dodgeCh = clamp(d.dodge + dodgeBuff.add, 0, 80);
    if (!special && this.rng.chance(dodgeCh / 100)) {
      this.float(this.playerFloatHost(), 'MISS', 'miss');
      this.log(`${e.name} attacks — you evade!`, 'log-good');
      SFX.miss();
      await sleep(380);
      return;
    }

    let dmg = e.atk * CONFIG.combat.enemyAtkMult * (0.85 + this.rng.next() * 0.3) * (this.mod.dmgMult || 1) * (special?.mult || 1) * chargeScale;
    if (this.rng.chance(d.enemyCrit / 100)) dmg *= 1.5;
    dmg -= d.def;
    if (e.caster && !special && e.turnCount % 2 === 0) { dmg *= 1.4; this.log(`${e.name} channels a darker spell!`, 'log-hit'); }
    const shield = this.player.statuses.shield;
    if (shield) dmg *= (1 - shield.mult);
    dmg = applyGuard(Math.max(1, Math.round(dmg * d.dmgTakenMult)), this.player.guarding);

    this.run.hp = Math.max(0, this.run.hp - dmg);
    this.damageTaken = (this.damageTaken || 0) + dmg;
    if (d.chargeOnHit) this.gainCharge(1);
    this.float(this.playerFloatHost(), `-${dmg}`, 'incoming');
    SFX.hit();
    this.log(`${e.name}${special ? ` (${special.name})` : ''} hits you for ${dmg}${this.player.guarding ? ' (guarded)' : ''}.`, 'log-hit');

    // §15 Coat of Thorns: attackers pay for the privilege
    if (d.thorns && e.hp > 0 && dmg > 0) {
      const back = Math.max(1, Math.round(dmg * d.thorns));
      e.hp = Math.max(0, e.hp - back);
      const es2 = this.sprite(e.uid);
      if (es2) { es2.classList.add('hit'); setTimeout(() => es2.classList.remove('hit'), 360); this.float(es2.parentElement, `${back}`, 'dmg'); }
      this.log(`Thorns bite back — ${e.name} takes ${back}.`, 'log-good');
      if (e.hp <= 0) this.log(`${e.name} is defeated by its own violence!`, 'log-sys');
    }

    if (e.lifesteal || special?.heal) {
      e.hp = Math.min(e.maxHp, e.hp + Math.round(dmg * (e.lifesteal || 0)) + Math.round(e.maxHp * (special?.heal || 0)));
      this.log(`${e.name} drinks deep.`, 'log-hit');
    }
    if (((e.poison && this.rng.chance(e.poison)) || special?.poisonSure) && !this.rng.chance(d.poisonResist)) { this.player.statuses.poison = 3; this.log('You are poisoned!', 'log-hit'); }
    if ((e.burn && this.rng.chance(e.burn)) || special?.burnSure) { this.player.statuses.burn = 2; this.log('You are set ablaze!', 'log-hit'); }
    if (enemyHitFreezes(e, special, this.rng)) { this.player.statuses.frozen = 1; this.log('You are frozen!', 'log-hit'); SFX.freeze(); }

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
      if (e.phaseArt) e.artId = e.phaseArt;
      if (e.phaseName) e.name = e.phaseName;
      if (e.phaseGlyph) e.glyph = e.phaseGlyph;
      if (e.phaseSpecials) e.specials = e.phaseSpecials;
      const evolve = e.phaseArt ? (e.phaseText || `${e.name} evolves into something worse.`) : `${e.name}: "${e.taunt}"`;
      this.log(evolve, 'log-sys');
      if (!e.phaseArt) this.log('Stops holding back.', 'log-hit');
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
      this.float(this.playerFloatHost(), `-${dmg}`, 'incoming');
      this.log(`Poison courses through you for ${dmg}.`, 'log-hit');
      st.poison--; if (st.poison <= 0) delete st.poison;
      if (this.run.hp <= 0) { this.deathSaves(); if (this.shared && this.run.hp <= 0) this.goDown(); }
    }
    if (st.burn && this.run.hp > 0) {
      const dmg = Math.max(3, Math.round(this.run.maxHp * 0.06));
      this.run.hp = Math.max(0, this.run.hp - dmg);
      this.float(this.playerFloatHost(), `-${dmg}`, 'incoming');
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
      this.run.hp = Math.round(this.run.maxHp * CONFIG.death.reviveHpPct);
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
      const rw = rewardMult(this.run.floor);
      gold = Math.round(gold * d.goldMult * d.combatGoldMult * (this.mod.goldMult || 1) * CONFIG.economy.combatGoldMult * rw.gold);
      xp = Math.round(xp * 1.45 * d.xpMult * rw.xp);
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
