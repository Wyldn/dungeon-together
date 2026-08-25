// Turn-based combat engine (handoff §8–§14).
//   - Initiative rolls at every battle; visible turn order on the left.
//   - Universal Guard (22% block) and Basic Attack, regardless of weapon.
//   - Six-segment Battle Charge for players AND enemies; AOE/heavy hits gated.
//   - Enemy specials telegraphed one segment before they're ready.
// Two drivers: solo (fully interleaved initiative) and shared co-op
// (players act in seat order, then the host resolves enemies — protocol
// constraint; the displayed order reflects what actually happens).

import { SKILLS, skillById } from './data/skills.js';
import { CONSUMABLES, consumableCombatValue } from './data/items.js';
import { CONFIG } from './data/config.js';
import {
  softLevelDamage, rewardMult, partyBossAoeMult, partyOutgoingDmgMult, TDC,
} from './data/tdc.js';
import { derived, heal, restoreMana, usableSkillIds, resourceName, changeFame, classTitle } from './character.js';
import { initiativeOrder, skillEffectivePower, enemyTelegraph, formatEnemyTelegraph, applyGuard, applyDefense, enemySpecialPayoff, enemyPayoffLine, skillEligibility, skillBlockLabel, skillCooldownTurns } from './systems.js';
import {
  emitCombatEvent, beginActionLog, queueHitOutcome, endActionLog,
  emitSkillCooldown, basicVerbFor, combatLogAriaAttrs, combatLogLine,
} from './combat_log.js';
import { biomeForFloor } from './data/enemies.js';
import {
  skillStatValue, buildEnemy, spawnSummon as coreSpawnSummon,
  statusOutgoingMult, collectEnemyRiders, initiativePenaltyFromStatuses,
  applyPlayerFrail as coreApplyPlayerFrail,
  buffValue as coreBuffValue, partyBuffMult as corePartyBuffMult,
  gainCharge as coreGainCharge, gainFury as coreGainFury,
  classResourceTick as coreClassResourceTick, gainCorpse as coreGainCorpse,
  consumeStanceIgnore as coreConsumeStance,
  notePlayerHpLoss as coreNoteHpLoss,
  hasDebuff as coreHasDebuff, hasHardCC as coreHasHardCC,
  cleanseBoss as coreCleanseBoss, resolveBossAntiCC as coreResolveBossAntiCC,
  resolveEnemySpecial as coreResolveEnemySpecial,
  applyStatusRiders as coreApplyStatusRiders,
  deathSaves as coreDeathSaves,
  applyEnrage as coreApplyEnrage,
  bossPhaseChecksSolo as coreBossPhaseSolo,
  transformBoss as coreTransformBoss, maybeTransform as coreMaybeTransform,
  resolvePlayerHit, applySelfSkill as coreApplySelfSkill,
  resolveUseConsumable, resolveEnemyTurn, resolveEnemyTurnStart,
  resolveEnemyConfusedStrike,
  tickEnemyStatuses as coreTickEnemyStatuses, upkeep as coreUpkeep,
  beginPlayerTurn, combatantEntries, rollRoundInitiativeSolo,
  endPlayerAction as coreEndPlayerAction,
  snapshotCombat, applyCombatStartMana, applyCombatSnapshot,
  startSkillCooldown, tickPlayerCooldowns, resetPlayerCooldowns,
} from './combat_core.js';
import { packOnCombatStart } from './content_pack/combat_bind.js';
import { computeCombatPayout } from './rewards.js';
import { chooseAutoPlayAction } from './combat_policy.js';

export {
  skillStatValue, buildEnemy, enemyHitFreezes, statusOutgoingMult,
  collectEnemyRiders, initiativePenaltyFromStatuses,
} from './combat_core.js';
import { ICONS } from './icons.js';
import { enemySpriteHtml, heroSpriteHtml, playHeroAnim, heroHasAnim, heroCombatSize, biomeBgUrl } from './art.js';
import { enemyBoxHtml } from './data/sprite_present.js';
import * as SpriteAnim from './anim.js';
import { SFX } from './audio.js';
import { screenShake } from './fx.js';
import { climberNameHtml, loadMeta } from './state.js';
import { isAutoPlay } from './autoplay.js';
import {
  trackDamageDealt, trackDamageTaken, trackHealed, trackBuff, trackDebuff,
} from './runlog.js';

let _sleepImpl = ms => new Promise(r => setTimeout(r, ms));
const sleep = ms => _sleepImpl(ms);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const LAST_FLOOR = 51;

/** Test/headless only: make combat sleeps instant. Does not change rule math. */
export function setCombatSleep(fn) {
  _sleepImpl = fn || (ms => new Promise(r => setTimeout(r, ms)));
}

/** Paint the biome on #combat-bleed (outside the scaled frame) so letterbox wings fill. */
function setCombatBleed(bg) {
  const bleed = typeof document === 'undefined' ? null : document.getElementById('combat-bleed');
  if (!bleed) return;
  if (bg) {
    bleed.style.backgroundImage = `url('${bg}')`;
    bleed.classList.add('has-bg');
  } else {
    bleed.style.backgroundImage = '';
    bleed.classList.remove('has-bg');
  }
}

/** Live solo fight — used to persist mid-battle on Save. */
let activeFight = null;

export function snapshotActiveCombat() {
  if (!activeFight || activeFight.ended || activeFight.shared) return null;
  return {
    enemies: activeFight.enemies.map(e => ({
      id: e.id, name: e.name, glyph: e.glyph, boss: !!e.boss, elite: !!e.elite,
      hp: e.hp, maxHp: e.maxHp, atk: e.atk, def: e.def, spd: e.spd,
      charge: e.charge || 0, chargeGain: e.chargeGain || 1,
      statuses: { ...(e.statuses || {}) },
      uid: e.uid, specials: e.specials, phase: e.phase,
      _m: e._m, summon: e.summon,
    })),
    charge: activeFight.charge,
    skillCDs: { ...(activeFight.skillCDs || {}) },
    turnPrepared: !!activeFight._turnPrepared,
    round: activeFight.round || 0,
    introText: activeFight.introText || null,
    modifier: activeFight.mod || null,
    playerStatuses: { ...(activeFight.player?.statuses || {}) },
    playerBuffs: [...(activeFight.player?.buffs || [])],
    corpses: activeFight.corpses || 0,
  };
}

function spawnSummon(fight, bossEnemy) {
  return coreSpawnSummon(fight, bossEnemy);
}

export function startCombat({
  container, run, rng, enemies, modifier = null, introText = null, onHud, coop = null,
  onCharacter = null, onSettings = null,
  resume = null,
}) {
  return new Promise(resolve => {
    // Fresh fights top off class resource a bit so mid-kit spends stay usable.
    // Skip on resume so a reloaded mid-fight doesn't free-refill.
    applyCombatStartMana(run, { resume });
    const C = new Fight(container, run, rng, enemies, modifier, introText, onHud, resolve, coop, {
      onCharacter, onSettings, resume: !!resume,
    });
    if (resume) {
      applyCombatSnapshot(C, resume);
      if (resume.charge != null) C.charge = resume.charge;
      if (resume.playerStatuses) C.player.statuses = { ...resume.playerStatuses };
      if (resume.playerBuffs) C.player.buffs = [...resume.playerBuffs];
      if (resume.round != null) C.round = resume.round;
      if (resume.corpses != null) C.corpses = resume.corpses;
      if (resume.skillCDs) C.skillCDs = { ...resume.skillCDs };
      if (resume.turnPrepared != null) C._turnPrepared = !!resume.turnPrepared;
    }
    if (!coop) activeFight = C;
    const done = (result) => {
      if (activeFight === C) activeFight = null;
      resolve(result);
    };
    C.resolve = done;
    C.begin();
  });
}

/** Headless Fight for characterization / tests. Same rule methods, no DOM. */
export function createSilentFight(run, rng, enemies, modifier = null) {
  setCombatSleep(() => Promise.resolve());
  const fight = new Fight(null, run, rng, enemies, modifier, null, null, () => {}, null, { headless: true });
  fight.headless = true;
  fight.logs = [];
  return fight;
}

/** Serializable combat snapshot used by characterization goldens. */
export function snapshotFightState(fight) {
  return snapshotCombat(fight);
}

class Fight {
  constructor(container, run, rng, enemies, modifier, introText, onHud, resolve, coop, ui = {}) {
    this.headless = !container || !!ui.headless;
    this.el = container;
    this.logs = [];
    this.run = run;
    this.rng = rng;
    this.enemies = enemies;
    this.mod = modifier || {};
    this.introText = introText;
    this.onHud = onHud;
    this.resolve = resolve;
    this.coop = coop;
    this.onCharacter = ui.onCharacter || null;
    this.onSettings = ui.onSettings || null;
    this.shared = !!coop;
    this.player = { statuses: {}, buffs: [], guarding: false };
    this.corpses = 0;
    this.charge = clamp((run.metaStartCharge || 0) + derived(run).startCharge, 0, CONFIG.charge.max);
    this.skillCDs = {};
    this._cdUsedThisTurn = {};
    this._turnPrepared = false;
    this.actionMode = 'root'; // root | skills | items | flee (handoff moded menu)
    this._actEnabled = false;
    this.target = 0;
    this.aimBySeat = new Map(); // seat id → enemy uid (co-op aim chips)
    this.locked = true;
    this.usedDeathward = false;
    this.round = 0;
    this.ended = false;
    this.order = []; // initiative order (display + solo driver)
    this._actingKey = null; // seat id / 'player' / enemy uid currently acting
    this.offs = [];
    if (!ui.resume) packOnCombatStart(this);

    const cos = loadMeta();
    this._nameTitle = cos.equippedTitle || null;
    this._nameStyle = cos.equippedNameStyle || null;

    this.allies = new Map();
    if (this.shared) {
      for (const [id, p] of coop.partners) {
        this.allies.set(id, {
          name: p.name, classId: p.classId || 'warrior',
          appearanceId: p.status?.appearanceId || p.appearanceId,
          hp: p.status?.hp ?? 1, maxHp: p.status?.maxHp ?? 1,
          down: p.status?.down || false,
          def: p.status?.def ?? 0, dodge: p.status?.dodge ?? 5,
          dex: p.status?.stats?.dex ?? p.status?.dex,
          spdStat: p.status?.spdStat,
          initiative: p.status?.initiative ?? 0,
          level: p.status?.level ?? 1,
          taunt: p.status?.taunt || 0,
          title: p.status?.title || null,
          nameStyle: p.status?.nameStyle || null,
        });
      }
    }
  }

  /* ---------------- helpers ---------------- */
  d() { return derived(this.run); }
  partySize() {
    if (!this.shared || !this.coop) return 1;
    return 1 + (this.coop.partners?.size || 0);
  }
  /** Rough power score for co-op single-target bias (higher = slightly more heat). */
  targetPowerScore(id) {
    if (!this.coop) return 1;
    if (id === this.coop.you) {
      const d = this.d();
      return (this.run.level || 1) * 2 + (this.run.maxHp || 40) / 10 + (d.def || 0) * 3 + (d.atk || 0);
    }
    const a = this.allies.get(id);
    const p = this.coop.partners.get(id);
    const s = p?.status;
    const level = s?.level ?? a?.level ?? 1;
    const maxHp = s?.maxHp ?? a?.maxHp ?? 40;
    const def = s?.def ?? a?.def ?? 0;
    return level * 2 + maxHp / 10 + def * 3;
  }
  /** Weighted single-target pick: higher-power allies get +focusPowerBias relative weight. */
  pickEnemyFocusTarget(pool) {
    if (!pool?.length) return null;
    if (pool.length === 1) return pool[0];
    const bias = TDC.party?.focusPowerBias ?? 0;
    if (bias <= 0) return this.rng.pick(pool);
    const powers = pool.map(t => this.targetPowerScore(t.id));
    const lo = Math.min(...powers);
    const hi = Math.max(...powers);
    const span = hi - lo;
    const weighted = pool.map((t, i) => ({
      t,
      w: 1 + (span > 0 ? bias * ((powers[i] - lo) / span) : 0),
    }));
    return this.rng.weighted(weighted).t;
  }
  aliveEnemies() { return this.enemies.filter(e => e.hp > 0); }
  _dealt(n) { trackDamageDealt(this.run, n); }
  _taken(n) { trackDamageTaken(this.run, n); }
  _healed(n) { trackHealed(this.run, n); }
  _buff() { trackBuff(this.run); }
  _debuff() { trackDebuff(this.run); }
  buffValue(stat) { return coreBuffValue(this, stat); }
  gainCharge(n) { return coreGainCharge(this, n); }
  gainFury(amount) { return coreGainFury(this, amount); }
  classResourceTick() { return coreClassResourceTick(this); }
  gainCorpse() { return coreGainCorpse(this); }

  /** Solo taunt delays a special; pack howls and self-wards apply here. */
  resolveEnemySpecial(e, special) { return coreResolveEnemySpecial(this, e, special); }

  applyPlayerFrail(dmg) { return coreApplyPlayerFrail(this, dmg); }
  notePlayerHpLoss(dmg) { return coreNoteHpLoss(this, dmg); }
  consumeStanceIgnore() { return coreConsumeStance(this); }

  log(msg, cls = '') {
    this.logs.push({ msg, cls: cls || '' });
    if (this.headless || !this.logEl) return;
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
    if (this.headless || !hostEl) return;
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
    if (!this.el) return null;
    const spr = this.el?.querySelector?.('#sprite-player');
    return spr?.parentElement || spr;
  }
  allyFloatHost(id) {
    const spr = this.sprite(id);
    return spr?.parentElement || spr;
  }

  enemyByUid(uid) { return this.enemies.find(e => e.uid === uid); }
  sprite(uid) { return this.el?.querySelector?.(`#sprite-${uid}`) || null; }

  // §12: has the boss picked up any player-applied affliction?
  hasDebuff(st) { return coreHasDebuff(st); }
  hasHardCC(st) { return coreHasHardCC(st); }

  resolveBossAntiCC(e, ops = null) {
    const result = coreResolveBossAntiCC(this, e, ops);
    if (result && !this.headless) SFX.bossIntro();
    return result;
  }

  cleanseBoss(e) {
    coreCleanseBoss(this, e);
    if (!this.headless) SFX.bossIntro();
  }

  // §15 Prism of Discord: a bewildered enemy strikes one of its own instead.
  async enemyConfusedStrike(e) {
    const hit = resolveEnemyConfusedStrike(this, e);
    if (!hit || this.headless) return hit;
    const sprite = this.sprite(e.uid);
    if (sprite) { sprite.classList.add('attack'); setTimeout(() => sprite.classList.remove('attack'), 420); }
    SpriteAnim.play(e.uid, 'attack');
    SFX.hit();
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
    if (this.headless || !this.el) return;
    const b = this.el.querySelector('#turn-banner');
    if (b) b.style.display = show ? '' : 'none';
    if (show) {
      SFX.yourTurn();
      this.setTabTurnAlert(true);
    } else {
      this.setTabTurnAlert(false);
    }
  }

  /** Flash the browser tab title while it's your turn (esp. when the tab is in the background). */
  setTabTurnAlert(on) {
    if (this.headless || typeof document === 'undefined') return;
    this._tabFlashActive = !!on;
    if (!on) {
      this._stopTabFlash();
      return;
    }
    if (!this._baseTitle) this._baseTitle = document.title.replace(/^(⚔ YOUR TURN! · )+/, '');
    if (this._tabFlashTimer) return;
    let lit = false;
    this._tabFlashTimer = setInterval(() => {
      if (!this._tabFlashActive || this.ended) { this._stopTabFlash(); return; }
      if (!document.hidden) {
        document.title = this._baseTitle;
        lit = false;
        return;
      }
      lit = !lit;
      document.title = lit ? '⚔ YOUR TURN!' : this._baseTitle;
    }, 900);
  }

  _stopTabFlash() {
    if (this._tabFlashTimer) {
      clearInterval(this._tabFlashTimer);
      this._tabFlashTimer = null;
    }
    this._tabFlashActive = false;
    if (this._baseTitle != null && typeof document !== 'undefined') {
      document.title = this._baseTitle;
      this._baseTitle = null;
    }
  }

  // per-skill-type visual: a brief overlay on the target sprite
  spawnFx(spriteEl, fxType) {
    if (this.headless || !spriteEl || !fxType) return;
    const f = document.createElement('div');
    f.className = `skill-fx fx-${fxType}`;
    spriteEl.appendChild(f);
    setTimeout(() => f.remove(), 750);
    SFX.skill(fxType);
  }

  /* ---------------- initiative ---------------- */
  _combatantEntries() {
    const d = this.d();
    if (this.shared) {
      // Use seat / enemy ids as keys on every client so corder + highlights match.
      const seats = this.coop.seatOrder();
      const players = seats.map(sid => {
        if (sid === this.coop.you) {
          return {
            key: sid, name: this.run.name, glyph: null,
            spdStat: Math.round(4 + d.dex * 0.3),
            mod: d.initiative + (this.mod.enemyFirst ? -100 : 0)
              + initiativePenaltyFromStatuses(this.player.statuses),
            isPlayer: true, stableId: sid,
          };
        }
        const a = this.allies.get(sid);
        const spd = a?.spdStat ?? (a?.dex != null ? Math.round(4 + a.dex * 0.3) : 8);
        return {
          key: sid, name: a?.name || 'Companion', glyph: null,
          spdStat: spd,
          mod: (a?.initiative || 0) + initiativePenaltyFromStatuses(a?.statuses),
          isPlayer: true, stableId: sid,
        };
      });
      const foes = this.aliveEnemies().map(e => ({
        key: e.uid, name: e.name, glyph: null, spdStat: e.spd,
        mod: initiativePenaltyFromStatuses(e.statuses),
        isPlayer: false, stableId: e.uid,
      }));
      return [...players, ...foes];
    }
    return combatantEntries(this);
  }

  rollBattleOrder() {
    // Solo: local roll. Co-op opening order is seat-stable until the first
    // per-round host roll (see rollRoundInitiative).
    if (this.shared && !this._sharedInitReady) {
      this.order = this._combatantEntries();
      // Stable foe order before the first host roll so every client matches.
      const players = this.order.filter(o => o.isPlayer);
      const foes = this.order.filter(o => !o.isPlayer)
        .sort((a, b) => String(a.stableId).localeCompare(String(b.stableId)));
      this.order = [...players, ...foes];
      return;
    }
    this.order = initiativeOrder(this.rng, this._combatantEntries(), this.run.floor);
  }

  /**
   * Co-op protocol acts all climbers, then all foes. Reshape a full initiative
   * roll into that sequence (init order preserved within each group) so the
   * rail matches what actually plays.
   */
  _orderForSharedDriver(rolled) {
    const players = rolled.filter(o => o.isPlayer);
    const foes = rolled.filter(o => !o.isPlayer);
    return [...players, ...foes];
  }

  /** Re-roll initiative each round. Host broadcasts so co-op stays in lockstep. */
  async rollRoundInitiative() {
    this._actingKey = null;
    if (!this.shared) {
      rollRoundInitiativeSolo(this);
      return;
    }
    this._sharedInitReady = true;
    if (this.coop.isHost) {
      const rolled = initiativeOrder(this.rng, this._combatantEntries(), this.run.floor);
      this.order = this._orderForSharedDriver(rolled);
      this.coop.net.send({
        k: 'corder',
        round: this.round,
        order: this.order.map(o => ({
          key: o.key, name: o.name, glyph: null, spdStat: o.spdStat,
          isPlayer: o.isPlayer, stableId: o.stableId, init: o.init,
        })),
      });
    } else {
      if (!this._corder || this._corder.round !== this.round) {
        await new Promise(r => { this._corderResolve = r; });
      }
      const msg = this._corder;
      this._corder = null;
      this._corderResolve = null;
      if (msg?.order) this.order = this._orderForSharedDriver(msg.order);
    }
    this.sharedSeats = this.order.filter(o => o.isPlayer).map(o => String(o.stableId));
    this.renderTurnOrder();
  }

  /** Mark who is acting — rail highlight + combatant glow. */
  setActing(key) {
    this._actingKey = key ?? null;
    this.renderTurnOrder();
    this.el?.querySelectorAll?.('.combatant.acting')?.forEach(n => n.classList.remove('acting'));
    if (!this._actingKey || !this.el) return;
    const selfKey = this.shared ? this.coop.you : 'player';
    const sel = (this._actingKey === selfKey || this._actingKey === 'player')
      ? '#sprite-player'
      : `#sprite-${this._actingKey}`;
    this.el.querySelector(sel)?.closest('.combatant')?.classList.add('acting');
  }

  /* ---------------- rendering ---------------- */
  begin() {
    if (this.headless) return;
    const biome = biomeForFloor(this.run.floor);
    this.el.innerHTML = `
      <div class="combat-screen cx-full">
        <div class="battlefield cx-bg">
          ${this.mod.name ? `<div class="modifier-banner cx-mod">⚠ ${this.mod.name} — ${this.mod.desc}</div>` : ''}
          <div class="cx-topbar">
            <div class="cx-side"></div>
            <div class="cx-top-center">
              <div class="cx-floor">
                <div class="cx-floor-biome">${biome.name}</div>
                <div class="cx-floor-num">FLOOR ${this.run.floor} <span>/</span> ${LAST_FLOOR}</div>
              </div>
              <div class="charge-tray cx-charge" id="charge-tray"></div>
              <div class="turn-banner cx-banner" id="turn-banner" style="display:none">⚔ YOUR TURN</div>
            </div>
            <div class="cx-hero">
              <div class="cx-hero-plate">
                <div class="cx-hero-name">${climberNameHtml(this.run.name, { title: this._nameTitle, nameStyle: this._nameStyle })}</div>
                <div class="cx-hero-title">Lv.${this.run.level} ${this.run.raceName} ${classTitle(this.run)}</div>
              </div>
              <div class="cx-hero-actions">
                <button class="cx-char-btn" id="cx-character">◈ CHARACTER</button>
                <div class="cx-hero-tools">
                  <button type="button" class="cx-tool-btn ghost" id="cx-settings" title="Settings" aria-label="Settings">☰</button>
                </div>
              </div>
            </div>
          </div>
          <div class="turn-order cx-turnorder" id="turn-order"></div>
          <div class="enemy-row cx-monsters"></div>
          <div class="cx-lane-divider" aria-hidden="true"></div>
          <div class="player-row cx-party"></div>
          <div class="combat-fx-layer" id="combat-fx"></div>
          <div class="combat-log cx-log" ${combatLogAriaAttrs()}></div>
          <div class="combat-actions">
            <div class="combat-utility"></div>
            <div class="action-bar mode-root"></div>
          </div>
        </div>
      </div>`;
    const bf = this.el.querySelector('.battlefield');
    const bg = biomeBgUrl(this.run.biomeId);
    if (bf && bg) { bf.classList.add('has-bg'); bf.style.backgroundImage = `url('${bg}')`; }
    setCombatBleed(bg);
    const charBtn = this.el.querySelector('#cx-character');
    if (charBtn) charBtn.onclick = () => this.onCharacter?.();
    this.el.querySelector('#cx-settings')?.addEventListener('click', () => this.onSettings?.());
    this.enemyRow = this.el.querySelector('.enemy-row');
    this.playerRow = this.el.querySelector('.player-row');
    this.fxLayer = this.el.querySelector('#combat-fx');
    this.turnOrderEl = this.el.querySelector('#turn-order');
    this.chargeTray = this.el.querySelector('#charge-tray');
    this.laneDivider = this.el.querySelector('.cx-lane-divider');
    this.logEl = this.el.querySelector('.combat-log');
    this.actionBar = this.el.querySelector('.action-bar');
    this.utilBar = this.el.querySelector('.combat-utility');
    this._bindCombatLog();
    this._onCombatResize = () => this.syncCombatLayout();
    window.addEventListener('resize', this._onCombatResize);

    SpriteAnim.reset(); // fresh animation state for this fight
    this.rollBattleOrder();
    this.renderEnemies();
    this.renderPlayers();
    this.renderTurnOrder();
    this.renderCharge();
    if (this.introText) this.log(this.introText, 'log-sys');
    requestAnimationFrame(() => this.syncCombatLayout());

    const anyBoss = this.enemies.some(e => e.boss);
    if (anyBoss) SFX.bossIntro(); else SFX.cardDeal();

    if (this.shared) this.sharedLoop();
    else this.soloLoop();
  }

  partyCount() {
    return 1 + (this.allies?.size || 0);
  }

  /** Local target plus a short co-op announce so companions can see the mark. */
  setAim(i) {
    this.target = i;
    if (!this.shared || !this.coop) return;
    const e = this.enemies[i];
    const uid = (e && e.hp > 0) ? e.uid : null;
    const prev = this.aimBySeat.get(this.coop.you);
    if (uid === prev) return;
    if (uid) this.aimBySeat.set(this.coop.you, uid);
    else this.aimBySeat.delete(this.coop.you);
    this.coop.net.send({ k: 'caim', uid: uid || null });
  }

  aimChipsHtml(uid) {
    if (!this.shared || !uid) return '';
    const chips = [];
    for (const [seat, aimed] of this.aimBySeat) {
      if (aimed !== uid) continue;
      const you = seat === this.coop.you;
      const raw = you ? (this.run.name || 'You') : (this.allies.get(seat)?.name || 'Ally');
      const name = raw.length > 10 ? raw.slice(0, 9) + '…' : raw;
      chips.push(`<span class="aim-chip${you ? ' you' : ''}">${name}</span>`);
    }
    return chips.length ? `<div class="aim-chips">${chips.join('')}</div>` : '';
  }

  /**
   * Align turn order with Battle Charge. Party-lane bar is CSS on `.cx-party`
   * (scales with stack height). Crowded 4-player fights get a compact class.
   */
  syncCombatLayout() {
    const bf = this.el?.querySelector?.('.battlefield');
    if (!bf) return;

    const n = this.partyCount();
    bf.classList.toggle('cx-party-3', n === 3);
    bf.classList.toggle('cx-party-4', n >= 4);

    const bfRect = bf.getBoundingClientRect();
    if (this.chargeTray && this.turnOrderEl) {
      const chargeTop = this.chargeTray.getBoundingClientRect().top - bfRect.top;
      this.turnOrderEl.style.top = `${Math.max(8, Math.round(chargeTop))}px`;
    }
  }

  chargePips(current, max = CONFIG.charge.max, cls = '') {
    let pips = '';
    for (let i = 0; i < max; i++) pips += `<span class="cpip ${i < current ? 'lit' : ''} ${cls}"></span>`;
    return `<span class="cpips">${pips}</span>`;
  }

  // per-fighter Battle Charge pips (handoff §4) — filled = charge segments
  focPips(current, max = CONFIG.charge.max) {
    let p = '';
    for (let i = 0; i < max; i++) p += `<span class="fpip ${i < current ? 'lit' : ''}"></span>`;
    return `<span class="foc-pips">${p}</span>`;
  }

  renderCharge() {
    if (this.headless || !this.chargeTray) return;
    if (!this.chargeTray) return;
    // Pip fill only — match per-fighter CHG (no "0/6" suffix).
    this.chargeTray.innerHTML = `
      <span class="charge-label">${CONFIG.charge.displayName}</span>
      ${this.chargePips(this.charge)}`;
  }

  renderTurnOrder(activeKey = this._actingKey) {
    if (this.headless || !this.turnOrderEl) return;
    if (!this.turnOrderEl) return;
    this.turnOrderEl.innerHTML = `<div class="to-title">TURN ORDER</div>` + this.order
      .filter(o => {
        if (o.isPlayer) return true;
        const foe = this.enemyByUid(o.stableId || o.key);
        return foe && foe.hp > 0 && !foe.cleared;
      })
      .map(o => {
        const id = o.stableId || o.key;
        const active = activeKey != null && (
          id === activeKey || o.key === activeKey
          || (!o.isPlayer && String(id) === String(activeKey))
        );
        return `<div class="to-entry ${active ? 'active' : ''} ${o.isPlayer ? 'to-player' : 'to-foe'}">
        <span class="to-name">${o.name}</span>
      </div>`;
      }).join('');
  }

  /** Longest death beat among fallen foes (CSS fade and/or sprite death clip). */
  deathOutroMs() {
    let ms = 640;
    for (const e of this.enemies) {
      if (e.hp > 0) continue;
      ms = Math.max(ms, SpriteAnim.deathBeatMs(e.artId || e.id) || 0);
    }
    return Math.min(2000, ms);
  }

  /** Play death anim, then pull corpses off the board (mid-fight). Win outro owns the last clear. */
  scheduleClearFallen() {
    if (this.headless) return;
    for (const e of this.enemies) {
      if (e.hp > 0 || e.cleared || e._clearing) continue;
      if (e.hp < 0) e.hp = 0;
      e._clearing = true;
      const uid = e.uid;
      const beat = Math.max(580, SpriteAnim.deathBeatMs(e.artId || e.id) || 0);
      setTimeout(() => {
        // Win/loss outro clears the board itself — don't fight it.
        if (this.ended) return;
        const foe = this.enemyByUid(uid);
        if (!foe || foe.hp > 0 || foe.cleared) return;
        foe.cleared = true;
        foe._clearing = false;
        this.renderEnemies();
        this.renderTurnOrder(this._actingKey);
      }, beat);
    }
  }

  renderEnemies() {
    if (this.headless || !this.enemyRow) {
      if (this.enemies[this.target]?.hp <= 0) {
        const next = this.enemies.findIndex(e => e.hp > 0 && !e.cleared);
        if (next >= 0) this.target = next;
      }
      return;
    }
    // Fix target before paint so we don't rebuild mid-death-anim
    if (this.enemies[this.target]?.hp <= 0 || this.enemies[this.target]?.cleared) {
      this.setAim(this.enemies.findIndex(e => e.hp > 0 && !e.cleared));
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
        const kept = keepDying.get(e.uid);
        kept.classList.toggle('acting', this._actingKey === e.uid);
        this.enemyRow.appendChild(kept);
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
        this._actingKey === e.uid ? 'acting' : '',
      ].filter(Boolean).join(' ');
      // Animated multi-state sprite (js/anim.js) when this art id has one; else
      // the friend's N-frame px-sprite / glyph. artId is the phase-swap override.
      const spriteKey = e.artId || e.id;
      // Same pipeline as enemy-boxes.html: native-scale sprite, then .sprite-wrap zoom/nudge/flip.
      const inner = SpriteAnim.hasAnim(spriteKey)
        ? SpriteAnim.animSpriteHtml(e.uid, spriteKey, { boss: e.boss, dead: e.hp <= 0 })
        : enemySpriteHtml(spriteKey, { boss: e.boss, elite: e.elite, summon: e.summon });
      const boxed = enemyBoxHtml(spriteKey, inner || e.glyph || '?', {
        boss: !!e.boss,
        domId: `sprite-${e.uid}`,
      });
      div.innerHTML = `
        ${tel ? `<div class="telegraph ${tel.ready ? 'ready' : ''}">${formatEnemyTelegraph(tel)}</div>` : ''}
        ${boxed}
        <div class="cx-info">
          <div class="cx-head"><span class="fighter-name">${e.name}</span><span class="cx-lv">Lv.${this.run.floor}</span></div>
          <div class="cx-bar-row"><span class="cx-blabel hp">HP</span><div class="bar cx-thin"><div class="bar-fill hp" style="width:${clamp(e.hp / e.maxHp * 100, 0, 100)}%"></div><span class="cx-bar-num">${Math.max(0, Math.round(e.hp))}/${Math.round(e.maxHp)}</span></div></div>
          <div class="cx-bar-row"><span class="cx-blabel foc">CHG</span>${this.focPips(e.charge || 0)}</div>
        </div>
          <div class="fighter-statuses">${this.statusPips(e.statuses)}</div>
          ${this.aimChipsHtml(e.uid)}`;
      div.onclick = () => { if (e.hp > 0) { this.setAim(i); this.renderEnemies(); SFX.click(); } };
      this.enemyRow.appendChild(div);
      if (spawn) {
        const uid = e.uid;
        setTimeout(() => {
          const foe = this.enemyByUid(uid);
          if (foe) foe.spawnIn = false;
        }, 560);
      }
    });
    // (Re)bind animated sprites to the freshly-rebuilt DOM nodes.
    SpriteAnim.attach(this.enemyRow);
  }

  renderPlayers(actingKey = this._actingKey) {
    if (this.headless || !this.playerRow) return;
    const s = this.player.statuses;
    const hpW = clamp(this.run.hp / this.run.maxHp * 100, 0, 100);
    const mpW = clamp(this.run.mp / Math.max(1, this.run.maxMp) * 100, 0, 100);
    const resName = resourceName(this.run);
    const resShort = resName.length > 4 ? resName.slice(0, 3).toUpperCase() : resName.toUpperCase();
    // Co-op uses seat ids; solo still uses the legacy 'player' key.
    const selfKey = this.shared ? this.coop.you : 'player';
    const selfActing = actingKey != null && (actingKey === selfKey || actingKey === 'player');
    let html = `
      <div class="combatant ${this.run.down ? 'downed' : ''} ${selfActing ? 'acting' : ''}">
        <div class="fighter-sprite" id="sprite-player">${heroSpriteHtml(this.run.classId, heroCombatSize(this.run.classId), {
          ...(this.run.down && heroHasAnim(this.run.classId, 'death') ? { anim: 'death', holdLast: true } : {}),
          faceLeft: false,
          appearanceId: this.run.appearanceId,
        }) || ICONS[this.run.classId]}</div>
        <div class="cx-info">
          <div class="cx-head"><span class="fighter-name">${climberNameHtml(this.run.name, { title: this._nameTitle, nameStyle: this._nameStyle })}${this.run.down ? ' (down)' : ''}</span></div>
          <div class="cx-bar-row"><span class="cx-blabel hp">HP</span><div class="bar cx-thin"><div class="bar-fill hp" style="width:${hpW}%"></div><span class="cx-bar-num">${Math.round(this.run.hp)}/${Math.round(this.run.maxHp)}</span></div></div>
          <div class="cx-bar-row"><span class="cx-blabel mp" title="${resName}">${resShort}</span><div class="bar cx-thin"><div class="bar-fill mp" style="width:${mpW}%"></div><span class="cx-bar-num">${Math.round(this.run.mp)}/${Math.round(this.run.maxMp)}</span></div></div>
          <div class="cx-bar-row"><span class="cx-blabel foc">CHG</span>${this.focPips(this.charge)}</div>
        </div>
        <div class="fighter-statuses">
          ${this.player.guarding ? '<span class="status-pip guard-pip">🛡 GUARD</span>' : ''}
          ${this.player.ironStance ? `<span class="status-pip">STANCE ${this.player.ironStance.strikes}</span>` : ''}
          ${this.player.scriptedEdge ? '<span class="status-pip">EDGE</span>' : ''}
          ${this.corpses ? `<span class="status-pip">CORPSE ${this.corpses}</span>` : ''}
          ${this.statusPips(s)}${this.player.buffs.map(b => `<span class="status-pip">▲${b.label} ${b.turns}</span>`).join('')}${(this.player.partyBuffs || []).map(b => `<span class="status-pip">◆${b.label || b.kind} ${b.turns}</span>`).join('')}
        </div>
      </div>`;
    for (const [id, a] of this.allies) {
      const allyActing = actingKey != null && (actingKey === id || actingKey === 'ally-' + id);
      html += `
        <div class="combatant ${a.down ? 'downed' : ''} ${allyActing ? 'acting' : ''}">
          <div class="fighter-sprite" id="sprite-${id}">${heroSpriteHtml(a.classId, heroCombatSize(a.classId), { faceLeft: false, appearanceId: a.appearanceId }) || ICONS[a.classId] || ICONS.warrior}</div>
          <div class="cx-info">
            <div class="cx-head"><span class="fighter-name">${climberNameHtml(a.name, { title: a.title, nameStyle: a.nameStyle })}${a.down ? ' (down)' : ''}</span></div>
            <div class="cx-bar-row"><span class="cx-blabel hp">HP</span><div class="bar cx-thin"><div class="bar-fill hp" style="width:${clamp(a.hp / a.maxHp * 100, 0, 100)}%"></div><span class="cx-bar-num">${Math.round(a.hp)}/${Math.round(a.maxHp)}</span></div></div>
          </div>
          <div class="fighter-statuses">${this.statusPips(a.statuses || {})}</div>
        </div>`;
    }
    this.playerRow.innerHTML = html;
    this.onHud?.();
    requestAnimationFrame(() => this.syncCombatLayout());
  }

  statusPips(st) {
    const pip = (label, title) => `<span class="status-pip" title="${title}">${label}</span>`;
    const pips = [];
    if (st.poison) pips.push(pip(`poison ${st.poison}`, 'Ticks each round. Hits harder if the body is frail.'));
    if (st.burn) pips.push(pip(`burn ${st.burn}`, 'Ticks each round. Some foes hit harder while you burn.'));
    if (st.frozen) pips.push(pip('frozen', 'Skip your next action.'));
    if (st.stunned) pips.push(pip('stunned', 'Skip your next action.'));
    if (st.paralyzed) pips.push(pip(`paralyze ${st.paralyzed}`, 'You still act, but later in the round.'));
    if (st.shield) pips.push(pip(`ward ${st.shield.turns}`, 'Incoming damage is reduced.'));
    if (st.hexed) pips.push(pip(`hex ${st.hexed}`, 'A curse. Hits land harder on the marked.'));
    if (st.marked) pips.push(pip(`mark ${st.marked}`, 'Finishers find this target sooner.'));
    if (st.weaken) pips.push(pip(`weaken ${st.weaken}`, 'Outgoing damage is reduced.'));
    if (st.frail) pips.push(pip(`frail ${st.frail}`, 'Armor failing. Finishers and poison find you.'));
    if (st.tormented) pips.push(pip(`torment ${st.tormented}`, 'Lingering pain. Bosses cannot slough it off immediately.'));
    if (st.confused) pips.push(pip(`confused ${st.confused}`, 'Attacks may whiff or strike a companion.'));
    if (st.lazy) pips.push(pip(`lazy ${st.lazy}`, 'Skip your next action.'));
    return pips.join('');
  }

  // Moded floating menu (handoff §4): root → FIGHT/ITEMS/FLEE, each opening a
  // submenu with a BACK chip. Wraps the existing useSkill/useConsumable/tryFlee.
  setMode(m) { this.actionMode = m; if (!this.headless) SFX.click(); this.renderActions(this._actEnabled); }

  renderActions(enabled) {
    if (this.headless || !this.actionBar) return;
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
    const statVal = skillStatValue(sk, d);
    const C = CONFIG.combat;
    const power = skillEffectivePower(sk);
    const base = (statVal * C.playerStatWeight + d.atk * C.playerAtkWeight + softLevelDamage(this.run.level, C.playerLevelWeight) + C.playerFlat)
      * (power / 100) * this.buffValue('str').mult
      * statusOutgoingMult(this.player.statuses)
      * partyOutgoingDmgMult(this.partySize());
    const label = sk.stat === 'best' ? 'best stat' : sk.stat.toUpperCase();
    return { avg: Math.max(1, Math.round(base)), label, stat: sk.stat, power };
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
      const sk = skillById(id) || SKILLS[id];
      if (!sk) continue;
      const cost = Math.ceil((sk.cost || 0) * costMult);
      const chargeCost = sk.charge || 0;
      const isUsable = usable.includes(id);
      const stanceLocked = id === 'guard' && !!this.player.ironStance;
      const hasTarget = sk.target !== 'one' || this.aliveEnemies().length > 0;
      const elig = skillEligibility(sk, {
        mp: this.run.mp,
        charge: this.charge,
        cds: this.skillCDs,
        hasTarget,
        usable: isUsable,
        stanceLocked,
        cost,
      });
      const est = this.estimateSkill(sk);
      // damage-formula hint (§4): "≈42 dmg · 130% DEX + weapon"
      const formula = est
        ? `≈${est.avg}${sk.target === 'all' ? ' ea' : ''} dmg · ${est.power}% ${est.label}`
        : '';
      const cdTurns = skillCooldownTurns(sk);
      const cdLeft = elig.remaining;
      const primary = elig.reasons[0];
      const blockLines = elig.reasons
        .map(r => skillBlockLabel(r, { remaining: cdLeft, resName }))
        .filter(Boolean);
      const btn = document.createElement('button');
      const reasonClass = primary === 'cooldown' ? 'on-cooldown'
        : primary === 'charge' ? 'need-charge'
        : primary === 'resource' ? 'need-resource'
        : primary === 'target' ? 'need-target'
        : '';
      btn.className = `skill-btn ${sk.class === 'universal' ? 'universal' : ''} ${!isUsable ? 'incompatible' : ''} ${reasonClass}`.trim();
      btn.disabled = !enabled || !elig.ok;
      const cdCost = cdTurns ? ` CD ${cdTurns}` : '';
      const cdNow = cdLeft ? ` · ${cdLeft} left` : '';
      btn.title = blockLines.length
        ? `${sk.name}\n${blockLines.join('\n')}${formula ? '\n\n' + formula : ''}`
        : isUsable ? `${sk.name}\n${sk.desc}${formula ? '\n\n' + formula : ''}` : 'Incompatible weapon — only Strike and Guard are available.';
      btn.innerHTML = `
        <div class="sk-name"><span>${sk.name}</span>
          <span class="sk-cost">${cost ? `${cost} ${resName}` : ''}${cost && chargeCost ? ' + ' : ''}${chargeCost ? `${chargeCost}⚡` : ''}${!cost && !chargeCost ? 'FREE' : ''}${cdTurns ? ` ·${cdCost}` : ''}${cdNow}</span></div>
        <div class="sk-desc">${!isUsable ? '⚠ Your weapon cannot channel this — class techniques need a compatible weapon.' : sk.desc}</div>
        ${primary && primary !== 'incompatible' ? `<div class="sk-block">${skillBlockLabel(primary, { remaining: cdLeft, resName })}</div>` : ''}
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
    if (this.headless || !this.actionBar) return;
    this.actionBar.innerHTML = `<div class="modifier-banner" style="grid-column:1/-1;border-color:var(--panel-edge);color:var(--ink-dim)">⏳ ${name} is acting…</div>`;
    this.utilBar.innerHTML = '';
  }

  /** Stall enrage for bosses / event elites (TDC.enrage). */
  applyEnrage() { return coreApplyEnrage(this); }

  /* ================= SOLO DRIVER: interleaved initiative ================= */
  async soloLoop() {
    await sleep(600);
    while (!this.ended) {
      this.round++;
      this.applyEnrage();
      await this.rollRoundInitiative();
      for (const entry of this.order) {
        if (this.ended) return;
        if (entry.isPlayer) {
          this.setActing('player');
          await this.playerTurn();
          if (this.checkEndSolo()) return;
          // §15 The Echoing Stone: a chance to take the turn twice
          const de = this.d();
          if (de.echoChance && !this.ended && this.aliveEnemies().length && this.rng.chance(de.echoChance)) {
            this.log('The Echoing Stone stutters — time folds, and you act again!', 'log-sys');
            SFX.unlock();
            this.setActing('player');
            await this.playerTurn();
            if (this.checkEndSolo()) return;
          }
        } else {
          const e = this.enemyByUid(entry.key);
          if (!e || e.hp <= 0) continue;
          this.setActing(entry.key);
          await this.enemyTurn(e);
          if (this.checkEndSolo()) return;
        }
      }
      this.setActing(null);
      await this.upkeep();
      if (this.checkEndSolo()) return;
    }
  }

  async playerTurn() {
    const began = beginPlayerTurn(this);
    if (began.skipped) {
      await sleep(700);
      return;
    }
    this.locked = false;
    this.showTurnBanner(true);
    this.renderActions(true);
    this.setActing('player');
    this.renderPlayers();
    this.scheduleAutoPlay();
    await new Promise(r => { this._turnDone = r; });
    clearTimeout(this._autoPlayTimer);
    this._turnDone = null;
    this.showTurnBanner(false);
    this.renderActions(false);
  }

  endPlayerAction() { return coreEndPlayerAction(this); }
  beginPlayerTurn() { return beginPlayerTurn(this); }

  /* ================= SHARED DRIVER (co-op) ================= */
  async sharedLoop() {
    this.offs.push(this.coop.net.on('cact', (d, from) => this._pendingActs.push({ d, from })));
    this.offs.push(this.coop.net.on('cpass', (d, from) => this._pendingActs.push({ d: { ...d, pass: true }, from })));
    this.offs.push(this.coop.net.on('caim', (d, from) => {
      if (d?.uid) this.aimBySeat.set(from, d.uid);
      else this.aimBySeat.delete(from);
      this.renderEnemies();
    }));
    this.setAim(this.target);
    this.offs.push(this.coop.net.on('eturn', d => { this._eturn = d; this._eturnResolve?.(); }));
    this.offs.push(this.coop.net.on('cend', d => this.finishShared(d)));
    // §51 two-phase boss: host authoritatively swaps the shell for the true king
    this.offs.push(this.coop.net.on('transform', d => this.applyTransform(d.uid, d.spec)));
    this.offs.push(this.coop.net.on('status', (d, from) => {
      const a = this.allies.get(from);
      if (a) {
        a.hp = d.hp; a.maxHp = d.maxHp; a.down = d.down;
        a.def = d.def ?? a.def; a.dodge = d.dodge ?? a.dodge;
        if (d.spdStat != null) a.spdStat = d.spdStat;
        if (d.initiative != null) a.initiative = d.initiative;
        if (d.dex != null) a.dex = d.dex;
        a.taunt = d.taunt || 0;
        if (d.level != null) a.level = d.level;
        if (d.statuses) a.statuses = { ...d.statuses };
        if (d.appearanceId) a.appearanceId = d.appearanceId;
        if (d.title !== undefined) a.title = d.title;
        if (d.nameStyle !== undefined) a.nameStyle = d.nameStyle;
        if (d.name) a.name = d.name;
      }
      this.renderPlayers(this._actingKey);
    }));
    // Confused climber struck a companion — victim applies real HP loss.
    this.offs.push(this.coop.net.on('cff', (d, from) => {
      const attacker = this.allies.get(from)?.name || 'A companion';
      if (d.to === this.coop.you) {
        const dmg = Math.max(1, Math.round(d.dmg || 0));
        this.run.hp = Math.max(0, this.run.hp - dmg);
        this._taken(dmg);
        this.float(this.playerFloatHost(), `-${dmg}`, 'incoming');
        this.log(`${attacker} strikes YOU in confusion for ${dmg}!`, 'log-foe');
        SFX.hit();
        if (this.run.hp <= 0) { this.deathSaves(); if (this.run.hp <= 0) this.goDown(); }
        this.coop.broadcastStatus(this.runStatus(), 'fighting');
        this.onHud?.();
      } else {
        const a = this.allies.get(d.to);
        if (a) {
          a.hp = Math.max(0, a.hp - Math.max(1, Math.round(d.dmg || 0)));
          this.float(this.allyFloatHost(d.to), `-${Math.round(d.dmg || 0)}`, 'incoming');
          this.log(`${attacker} strikes ${a.name} in confusion!`, 'log-foe');
        }
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
    this.offs.push(this.coop.net.on('corder', d => {
      this._corder = d;
      this._corderResolve?.();
    }));
    this.offs.push(this.coop.net.on('pbuff', d => {
      this.player.partyBuffs = this.player.partyBuffs || [];
      this.player.partyBuffs.push({ kind: d.kind, mult: d.mult, turns: d.turns, label: d.label });
      this.log(`A companion's ${d.label || 'boost'} washes over you.`, 'log-ally');
    }));
    this.offs.push(this.coop.net.on('chit', (d, from) => {
      const a = this.allies.get(from);
      if (!a) return;
      this.float(this.allyFloatHost(from), `-${d.dmg}${d.guarded ? ' 🛡' : ''}`, 'incoming');
      emitCombatEvent(this, {
        type: 'hit',
        actor: d.by || 'An enemy',
        target: a.name,
        move: d.special || null,
        verb: d.special ? (d.verb || null) : (d.verb || 'hit'),
        dmg: d.dmg,
        guarded: !!d.guarded,
        shielded: !!d.shielded,
        side: 'foe',
        basic: !d.special,
      });
      this.renderPlayers(this._actingKey);
    }));
    // ally healing (e.g. a Priest's Mend cast on a companion)
    this.offs.push(this.coop.net.on('cheal', (d, from) => {
      const healer = this.allies.get(from)?.name || 'A companion';
      if (d.to === this.coop.you) {
        const amt = heal(this.run, this.run.maxHp * d.pct);
        this.float(this.el?.querySelector?.('#sprite-player'), `+${amt}`, 'heal');
        this.spawnFx(this.el?.querySelector?.('#sprite-player'), 'heal');
        this.log(`${healer} mends you with ${d.label}. (+${amt} HP)`, 'log-ally');
        this.coop.broadcastStatus(this.runStatus(), 'fighting');
        this.onHud?.();
      } else {
        const a = this.allies.get(d.to);
        if (a) {
          a.hp = Math.min(a.maxHp, a.hp + Math.round(a.maxHp * d.pct));
          this.spawnFx(this.sprite(d.to), 'heal');
          this.log(`${healer} mends ${a.name}.`, 'log-ally');
        }
      }
      this.renderPlayers(this._actingKey);
    }));

    this.sharedSeats = this.order.filter(o => o.isPlayer).map(o => String(o.stableId));
    if (!this.sharedSeats.length) this.sharedSeats = this.coop.seatOrder();
    this.renderTurnOrder();

    await sleep(700);
    while (!this.ended) {
      this.round++;
      this.applyEnrage();
      await this.rollRoundInitiative();
      for (const seat of this.sharedSeats) {
        if (this.ended) return;
        if (seat !== this.coop.you && !this.allies.has(seat)) continue;
        // Seat id is the shared key on every client (not host-centric 'player').
        this.setActing(seat);
        this.renderPlayers();
        if (seat === this.coop.you) {
          await this.localSharedTurn();
        } else {
          await this.remoteTurn(seat);
        }
        if (this.hostCheckEnd()) return;
      }
      if (this.ended) return;
      if (this.coop.isHost) {
        await this.hostEnemyPhase();
        if (this.hostCheckEnd()) return;
      } else {
        await this.awaitEnemyPhase();
        if (this.ended) return;
      }
      this.setActing(null);
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
      statuses: { ...(this.player.statuses || {}) },
    };
  }

  /** Choose a hero sheet anim for this skill (pack heroes: attack / attack2 / special…). */
  pickHeroAnim(sk) {
    if (!sk || !heroHasAnim(this.run.classId, 'attack')) return null;
    const id = sk.id || '';
    const name = (sk.name || '').toLowerCase();
    const has = a => heroHasAnim(this.run.classId, a);
    if (sk.dodge || id.includes('roll') || id.includes('dash') || id.includes('windstep') || name.includes('evasive')) {
      return has('dash') ? 'dash' : 'attack';
    }
    if (sk.target === 'self' && (sk.healPct || sk.shield || sk.buff)) return null;
    if (sk.target === 'all') {
      if (has('special')) return 'special';
      if (has('attackHigh')) return 'attackHigh';
      if (has('attackLoop')) return 'attackLoop';
      return 'attack';
    }
    if (id.includes('aimed') || id.includes('one_shot') || name.includes('snipe')
        || id.includes('hurricane') || id.includes('earthbreaker') || id.includes('phoenix')) {
      return has('attackHigh') ? 'attackHigh' : (has('attack2') ? 'attack2' : 'attack');
    }
    if (sk.power || (sk.charge && sk.charge >= 3) || id.includes('flurry') || id.includes('grave') || id.includes('siphon')) {
      return has('attack2') ? 'attack2' : 'attack';
    }
    if (sk.target === 'one') return 'attack';
    return null;
  }

  async playLocalHeroAnim(anim, { holdLast = false } = {}) {
    if (!anim || !heroHasAnim(this.run.classId, anim)) return;
    const spriteP = this.el?.querySelector?.('#sprite-player');
    await playHeroAnim(spriteP, this.run.classId, anim, { target: heroCombatSize(this.run.classId), holdLast, faceLeft: false, appearanceId: this.run.appearanceId });
  }

  async localSharedTurn() {
    if (this.run.down) {
      this.coop.net.send({ k: 'cpass', why: 'down' });
      this.log('You are down — your companions fight on.', 'log-foe');
      tickPlayerCooldowns(this);
      await sleep(400);
      return;
    }
    const began = beginPlayerTurn(this);
    if (began.skipped) {
      this.coop.net.send({ k: 'cpass', why: 'stunned' });
      await sleep(600);
      return;
    }
    this.locked = false;
    this.showTurnBanner(true);
    this.renderActions(true);
    this.scheduleAutoPlay();
    // AFK guard: after a long idle turn, instinct picks a random valid action
    clearTimeout(this._afkTimer);
    this._afkTimer = setTimeout(() => this.autoAct(), CONFIG.afk?.turnMs || 60000);
    await new Promise(r => { this._sharedTurnDone = r; });
    clearTimeout(this._afkTimer);
    clearTimeout(this._autoPlayTimer);
    this._sharedTurnDone = null;
    this.showTurnBanner(false);
    this.renderActions(false);
  }

  scheduleAutoPlay() {
    clearTimeout(this._autoPlayTimer);
    if (!isAutoPlay()) return;
    this._autoPlayTimer = setTimeout(() => this.autoPlayAct(), 320);
  }

  /** Testing auto-play: potion / guard / best affordable skill. */
  autoPlayAct() {
    if (!isAutoPlay() || this.locked || this.ended) return;
    const waiting = this.shared ? this._sharedTurnDone : this._turnDone;
    if (!waiting) return;
    const action = chooseAutoPlayAction(this);
    if (action.type === 'useConsumable') {
      const c = CONSUMABLES.find(x => x.id === action.itemId);
      if (c) this.useConsumable(c);
      return;
    }
    const sk = skillById(action.skillId) || SKILLS[action.skillId] || SKILLS.basic_attack;
    if (action.enemy != null) this.setAim(action.enemy);
    this._pendingHealTo = action.healTo || null;
    const costMult = this.mod.costMult || 1;
    this.useSkill(sk, Math.ceil((sk.cost || 0) * costMult));
  }

  /** AFK fallback (shared driver): play a random valid action for this turn. */
  autoAct() {
    if (this.locked || this.ended || !this._sharedTurnDone) return;
    if (isAutoPlay()) { this.autoPlayAct(); return; }
    const costMult = this.mod.costMult || 1;
    const usable = usableSkillIds(this.run);
    const pool = ['basic_attack', 'guard', ...this.run.skills]
      .map(id => skillById(id) || SKILLS[id])
      .filter(sk => sk && usable.includes(sk.id) && !sk.allyTarget)
      .filter(sk => skillEligibility(sk, {
        mp: this.run.mp,
        charge: this.charge,
        cds: this.skillCDs,
        hasTarget: this.aliveEnemies().length > 0 || sk.target !== 'one',
        usable: true,
        stanceLocked: sk.id === 'guard' && !!this.player.ironStance,
        cost: Math.ceil((sk.cost || 0) * costMult),
      }).ok);
    const sk = pool.length ? pool[Math.floor(Math.random() * pool.length)] : SKILLS.basic_attack;
    const alive = this.enemies.map((e, i) => ({ e, i })).filter(x => x.e.hp > 0);
    if (alive.length) this.setAim(alive[Math.floor(Math.random() * alive.length)].i);
    this.log('You hesitate too long — instinct takes over.', 'log-sys');
    this.useSkill(sk, Math.ceil((sk.cost || 0) * costMult));
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
      this.log(`${ally?.name || 'Companion'} cannot act.`, 'log-ally');
      await sleep(400);
      return;
    }
    await this.applyRemoteAct(entry.d, ally, seat);
  }

  async applyRemoteAct(act, ally, seatId) {
    const name = ally?.name || 'Companion';
    const sprite = this.sprite(seatId);
    const classId = ally?.classId;
    if (act.heroAnim && classId && heroHasAnim(classId, act.heroAnim)) {
      await playHeroAnim(sprite, classId, act.heroAnim, { target: heroCombatSize(classId), faceLeft: false });
    } else if (sprite) {
      sprite.classList.add('attack');
      setTimeout(() => sprite.classList.remove('attack'), 420);
    }
    if (act.label === 'Guard') { this.log(`${name} raises their guard.`, 'log-ally'); await sleep(300); return; }
    const targets = act.targets || [];
    if (!targets.length) {
      if (act.label) this.log(`${name} used ${act.label}.`, 'log-ally');
      this.renderEnemies();
      await sleep(CONFIG.combat.skillResolveMs || 950);
      return;
    }
    const batch = targets.length > 1;
    if (batch) {
      beginActionLog(this, { actor: name, move: act.label, side: 'ally', aoe: true });
    }
    for (const t of targets) {
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
      SpriteAnim.play(e.uid, 'hurt');
      t.crit ? SFX.crit() : SFX.hit();
      if (batch) {
        queueHitOutcome(this, { target: e.name, dmg: t.dmg, crit: t.crit, died: e.hp <= 0 });
      } else {
        emitCombatEvent(this, {
          type: 'hit', actor: name, target: e.name, move: act.label, dmg: t.dmg, crit: t.crit, side: 'ally',
        });
      }
      for (const n of t.notes || []) combatLogLine(this, n, 'log-ally');
      if (e.hp <= 0) combatLogLine(this, `${e.name} is defeated!`, 'log-ally');
    }
    if (batch) endActionLog(this);
    this.renderEnemies();
    await sleep(CONFIG.combat.skillResolveMs || 950);
  }

  /* ---- host-computed enemy phase (shared) ---- */
  async hostEnemyPhase() {
    const ops = [];
    await this.tickEnemyStatuses(ops);
    if (!this.aliveEnemies().length) { this.broadcastEturn(ops); this.setActing(null); return; }

    // Follow the rail: foes in the post-player initiative block.
    const foeUids = this.order.filter(o => !o.isPlayer).map(o => o.stableId || o.key);
    const sequence = foeUids.length
      ? foeUids.map(uid => this.enemyByUid(uid)).filter(e => e && e.hp > 0)
      : this.aliveEnemies();

    for (const e of sequence) {
      if (this.ended) return;
      const start = resolveEnemyTurnStart(this, e, ops);
      if (start.done) {
        if (!this.headless) await sleep(start.reason === 'summon' ? 400 : 350);
        continue;
      }
      const { special, chargeScale, scream } = start;
      if (special && !this.headless) SFX.bossIntro();
      if (scream && special) {
        const tel = {
          type: 'telegraph',
          uid: e.uid,
          text: `${e.name} unleashes ${special.name}!${scream}`,
        };
        ops.push(tel);
        emitCombatEvent(this, { type: 'telegraph', text: tel.text, cls: 'log-foe' });
      }

      const targets = [{ id: this.coop.you, def: this.d().def, dodge: this.d().dodge, down: this.run.down, taunt: this.run.combatTaunt || 0 },
        ...[...this.allies.entries()].map(([id, a]) => ({ id, def: a.def, dodge: a.dodge, down: a.down, taunt: a.taunt || 0 }))]
        .filter(t => !t.down);
      if (!targets.length) break;

      // Taunt: single-target locks onto taunters, unless a boss shrugs it.
      // Otherwise soft-bias toward higher-power climbers (~focusPowerBias).
      let focusPool = targets;
      const taunters = targets.filter(t => t.taunt > 0);
      if (taunters.length) {
        const ignore = e.boss && this.rng.chance(CONFIG.boss?.ignoreTauntChance ?? 0);
        if (!ignore) focusPool = taunters;
      }
      const hitTargets = special?.aoe ? targets : [this.pickEnemyFocusTarget(focusPool)];

      const es = this.sprite(e.uid);
      if (es) { es.classList.add('attack'); setTimeout(() => es.classList.remove('attack'), 420); }
      SpriteAnim.play(e.uid, special ? 'special' : 'attack');
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
        if (special?.aoe) dmg *= partyBossAoeMult(targets.length);
        dmg *= statusOutgoingMult(e.statuses);
        if (this.rng.chance(this.d().enemyCrit / 100)) dmg *= 1.5;
        let payoff = null;
        {
          const ally = target.id === this.coop.you ? this.player : this.allies.get(target.id);
          const st = target.id === this.coop.you ? this.player.statuses : (ally?.statuses || {});
          const hpRatio = target.id === this.coop.you
            ? this.run.hp / this.run.maxHp
            : ((ally?.hp ?? 1) / (ally?.maxHp || 1));
          const pay = enemySpecialPayoff(special, st, hpRatio);
          dmg *= pay.mult;
          if (pay.consume && st) delete st[pay.consume];
          payoff = enemyPayoffLine(e.name, pay);
        }
        if (e.caster && !special && e.turnCount % 2 === 0) dmg *= 1.4;
        dmg = applyDefense(dmg, target.def);
        const riders = collectEnemyRiders(e, special, this.rng);
        if (e.lifesteal || special?.heal) e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * (special?.heal || 0)) + Math.round(dmg * (e.lifesteal || 0)));
        const op = {
          type: 'hit', uid: e.uid, target: target.id, dmg, riders,
          special: special?.name,
          verb: special ? (special.verb || null) : basicVerbFor(e),
          basic: !special,
        };
        if (payoff) op.payoff = payoff;
        ops.push(op);
        this.applyHitOp(op, e);
      }
      this.renderEnemies();
      await sleep(420);
    }
    this.setActing(null);
    this.broadcastEturn(ops);
  }

  bossPhaseChecks(e, ops) { return this.bossPhaseChecksSolo(e, ops); }

  applyStatusRiders(r) {
    const froze = !this.player.statuses.frozen;
    coreApplyStatusRiders(this, r);
    if (!this.headless && r?.freeze && this.player.statuses.frozen && froze) SFX.freeze();
  }

  /** Rough strike damage for confused friendly-fire (no crit / buff variance). */
  estimateConfusedStrikeDmg(sk, d) {
    const C = CONFIG.combat;
    const statVal = skillStatValue(sk, d);
    const power = sk.power || 100;
    const base = (statVal * C.playerStatWeight + d.atk * C.playerAtkWeight
      + softLevelDamage(this.run.level, C.playerLevelWeight) + C.playerFlat)
      * (power / 100) * statusOutgoingMult(this.player.statuses)
      * partyOutgoingDmgMult(this.partySize());
    return Math.max(1, Math.round(base * 0.85));
  }

  applyHitOp(op, enemyRef = null) {
    const e = enemyRef || this.enemyByUid(op.uid);
    if (op.dodged) {
      const el = op.target === this.coop.you ? this.playerFloatHost() : this.allyFloatHost(op.target);
      this.float(el, 'MISS', 'miss');
      emitCombatEvent(this, { type: 'miss', actor: e?.name || 'The enemy', target: 'you', reason: op.target === this.coop.you ? 'evade' : 'dodge', side: 'ally' });
      SFX.miss();
      return;
    }
    if (op.payoff) this.log(op.payoff, 'log-foe');
    if (op.target === this.coop.you) {
      let dmg = op.dmg;
      const shield = this.player.statuses.shield;
      if (shield) dmg = Math.max(1, Math.round(dmg * (1 - shield.mult)));
      dmg = applyGuard(dmg, this.player.guarding);
      dmg = Math.max(1, Math.round(dmg * this.d().dmgTakenMult * this.partyBuffMult('dr')));
      dmg = this.applyPlayerFrail(dmg);
      this.run.hp = Math.max(0, this.run.hp - dmg);
      this.notePlayerHpLoss(dmg);
      this.float(this.playerFloatHost(), `-${dmg}`, 'incoming');
      SFX.hit();
      emitCombatEvent(this, {
        type: 'hit',
        actor: e?.name || 'The enemy',
        target: 'you',
        move: op.special || null,
        verb: op.special ? (op.verb || null) : (op.verb || basicVerbFor(e)),
        dmg,
        guarded: !!this.player.guarding,
        shielded: !!shield,
        side: 'foe',
        basic: !op.special,
      });
      // §9: tell the party the ACTUAL damage taken (after guard/shield/armor),
      // so companions render the blocked number, not the host's raw estimate.
      this.coop.net.send({
        k: 'chit', dmg, guarded: this.player.guarding, shielded: !!shield,
        by: e?.name, special: op.special, verb: op.verb, basic: !op.special,
      });
      this.applyStatusRiders(op.riders || {});
      if (this.run.hp <= 0) this.deathSaves();
      if (this.run.hp <= 0) this.goDown();
      this.coop.broadcastStatus(this.runStatus(), 'fighting');
      this.onHud?.();
    }
    // Ally hits log from the victim's `chit` so every client uses the same
    // post-mitigation number — no separate "strikes at…" announcement.
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
      if (op.uid) this.setActing(op.uid);
      if (op.type === 'summon') {
        const minion = { ...op.spec, statuses: op.spec.statuses || {}, spawnIn: true };
        this.enemies.push(minion);
        // §9: keep the shared turn order in sync on every client
        if (!this.order.some(o => o.key === minion.uid)) {
          this.order.push({ key: minion.uid, name: minion.name, glyph: minion.glyph, spdStat: minion.spd, isPlayer: false, stableId: minion.uid, init: 0 });
        }
        this.log('Reinforcements claw their way in!', 'log-foe');
        this.renderEnemies();
        this.renderTurnOrder();
      } else if (op.type === 'cleanse') {
        const e = this.enemyByUid(op.uid);
        if (e) {
          if (op.blocked || e.statuses.tormented) {
            delete e.statuses.tormented;
            this.log(`${e.name} tries to slough the fight off — torment holds the spite back.`, 'log-ally');
          } else {
            delete e.statuses.poison; delete e.statuses.burn; delete e.statuses.frozen;
            delete e.statuses.stunned; delete e.statuses.hexed;
            delete e.statuses.frail; delete e.statuses.weaken; delete e.statuses.lazy;
            delete e.statuses.confused; delete e.statuses.paralyzed; delete e.statuses.marked;
            this.log(`${e.name} sloughs off every affliction.`, 'log-foe');
          }
        }
        this.renderEnemies();
      } else if (op.type === 'breakcc') {
        const e = this.enemyByUid(op.uid);
        if (e) { delete e.statuses.frozen; delete e.statuses.stunned; }
        this.log(`${e?.name || 'The boss'} burns ${op.cost || '?'} Battle Charge and tears free!`, 'log-foe');
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
        this.log(op.text, 'log-foe');
        SFX.bossIntro(); screenShake();
        this.renderEnemies();
      } else if (op.type === 'skip') {
        const e = this.enemyByUid(op.uid);
        if (e) { delete e.statuses.frozen; delete e.statuses.stunned; }
        this.log(`${e?.name || 'An enemy'} cannot act.`, 'log-foe');
        this.renderEnemies();
      } else if (op.type === 'edot') {
        const e = this.enemyByUid(op.uid);
        if (e) { e.hp = op.hpAfter; this.float(this.sprite(e.uid)?.parentElement, `${op.dmg}`, 'dmg'); }
        this.renderEnemies();
      } else if (op.type === 'eregen') {
        const e = this.enemyByUid(op.uid);
        if (e) e.hp = op.hpAfter;
        this.renderEnemies();
      } else if (op.type === 'telegraph') {
        this.log(op.text, 'log-foe');
      } else if (op.type === 'hit') {
        const es = this.sprite(op.uid);
        if (es) { es.classList.add('attack'); setTimeout(() => es.classList.remove('attack'), 420); }
        SpriteAnim.play(op.uid, op.special ? 'special' : 'attack');
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
    this.setActing(null);
    this.renderEnemies();
  }

  goDown() {
    if (!this.shared || this.run.down) return;
    this.run.down = true;
    this.log('You fall! Your companions fight on — hold fast for the next floor.', 'log-sys');
    SFX.death();
    this.renderPlayers(this._actingKey);
    if (heroHasAnim(this.run.classId, 'death')) {
      playHeroAnim(this.el?.querySelector?.('#sprite-player'), this.run.classId, 'death', { target: heroCombatSize(this.run.classId), holdLast: true, faceLeft: true });
    }
  }

  /* ---- two-phase boss transform (§51 Demon King) ---- */
  // The phase-1 shell reached 0 HP: become the true form in place (same uid) with
  // a fresh HP bar instead of dying. Mutates the entity; returns the reveal text.
  transformBoss(e) { return coreTransformBoss(this, e); }

  syncOrderIdentity(e) {
    const oe = this.order.find(o => o.key === e.uid);
    if (oe) { oe.name = e.name; oe.glyph = e.glyph; oe.spdStat = e.spd; }
  }

  // Called when a phase-1 boss hits 0 HP (solo + host). Transforms rather than
  // dying so the fight continues; the host mirrors it to companions. Returns true
  // if a transform happened (so the caller must NOT end the fight).
  maybeTransform() {
    const e = this.enemies.find(x => x.twoPhase && x.phase2 && x.hp <= 0);
    const happened = coreMaybeTransform(this);
    if (happened) this.setAim(this.target);
    if (happened && !this.headless) {
      SFX.evolve(); screenShake();
      if (this.shared && this.coop?.isHost && e) {
        this.coop.net.send({ k: 'transform', uid: e.uid, spec: {
          artId: e.artId, name: e.name, glyph: e.glyph, atk: e.atk, def: e.def, spd: e.spd,
          maxHp: e.maxHp, hp: e.hp, specials: e.specials, chargeGain: e.chargeGain,
          chargeOnPhase: e.chargeOnPhase, cleanseCost: e.cleanseCost, phases: e.phases,
          taunt: e.taunt, text: this.logs[this.logs.length - 1]?.msg } });
      }
    }
    return happened;
  }

  // Companion side: apply the host's authoritative transform.
  applyTransform(uid, spec = {}) {
    const e = this.enemyByUid(uid);
    if (!e) return;
    Object.assign(e, {
      artId: spec.artId, name: spec.name, glyph: spec.glyph, atk: spec.atk, def: spec.def,
      spd: spec.spd, maxHp: spec.maxHp, hp: spec.hp, specials: spec.specials,
      chargeGain: spec.chargeGain, chargeOnPhase: spec.chargeOnPhase, cleanseCost: spec.cleanseCost,
      phases: spec.phases, taunt: spec.taunt, charge: 0, statuses: {}, phaseTriggers: [],
      twoPhase: false, phase: 2,
    });
    this.syncOrderIdentity(e);
    this.log(spec.text || `${e.name} rises!`, 'log-sys');
    SFX.evolve(); screenShake();
    this.setAim(this.enemies.findIndex(x => x.hp > 0));
    this.renderEnemies();
    this.renderTurnOrder();
  }

  hostCheckEnd() {
    if (!this.coop?.isHost) return this.ended;
    if (this.aliveEnemies().length === 0) {
      if (this.maybeTransform()) return false;
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
    this._stopTabFlash();
    if (this._onCombatResize) window.removeEventListener('resize', this._onCombatResize);
    clearTimeout(this._afkTimer);
    delete this.run.combatTaunt;
    for (const off of this.offs) off();
    this.rng.advance?.();
    const payload = {
      result: d.result, gold: d.gold || 0, xp: d.xp || 0,
      noDamage: !this.damageTaken, usedUltimate: !!this.usedUltimate,
    };
    if (d.result === 'win') this.resolveAfterEnemyDeaths(payload);
    else setTimeout(() => this.resolve(payload), 900);
  }

  /** Drain fallen foes, play death clips, clear the board, then hand off to rewards/victory. */
  resolveAfterEnemyDeaths(payload) {
    for (const e of this.enemies) {
      if (e.hp > 0) continue;
      e.hp = 0;
      e._clearing = true;
      e.cleared = false;
    }
    this.renderEnemies();
    this.renderTurnOrder(this._actingKey);
    const beat = this.deathOutroMs();
    setTimeout(() => {
      for (const e of this.enemies) {
        if (e.hp > 0) continue;
        e.cleared = true;
        e._clearing = false;
      }
      this.renderEnemies();
      setTimeout(() => this.resolve(payload), 140);
    }, beat);
  }

  /* ================= PLAYER ACTIONS (both modes) ================= */
  async useSkill(sk, cost) {
    if (skillCooldownTurns(sk) > 0 && (this.skillCDs?.[sk.id] || 0) > 0) {
      this.locked = false;
      this.renderActions(true);
      return;
    }
    this.locked = true;
    this.actionBar?.querySelectorAll?.('button')?.forEach(b => { b.disabled = true; });
    this.run.mp -= cost;
    if (sk.charge) { this.charge = Math.max(0, this.charge - sk.charge); this.renderCharge(); if (sk.charge >= 6) this.usedUltimate = true; }
    startSkillCooldown(this, sk);
    if (sk.selfHpCost) {
      const paid = Math.round(this.run.maxHp * sk.selfHpCost);
      this.run.hp = Math.max(1, this.run.hp - paid);
      const rate = CONFIG.identity?.viking?.furyPerSelfCost ?? 0.5;
      this.gainFury(Math.max(2, Math.round(paid * rate)));
    }
    this._corpseSpent = false;
    if (sk.corpseSpend && (this.corpses || 0) > 0) {
      this.corpses--;
      this._corpseSpent = true;
      this.log('A corpse answers you.', 'log-ally');
    }
    if (sk.power && sk.target !== 'self' && this.run.classId === 'archer') {
      this._rangerOffensive = true;
    }
    const d = this.d();

    // Guard: the universal defensive action
    if (sk.guard) {
      if (this.player.ironStance) {
        this.log('Iron Stance holds you rooted — you cannot Guard.', 'log-sys');
        this.run.mp += cost;
        this.locked = false;
        this.renderActions(true);
        return;
      }
      this.player.guarding = true;
      this.run.guardCount = (this.run.guardCount || 0) + 1;
      this.gainCharge(CONFIG.guard.chargeGain);
      this.log('You brace behind your guard.', 'log-ally');
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

    // healer support: skills marked allyTarget can mend a companion (patch).
    // Autoplay supplies healTo so we do not hang on the click picker.
    if (sk.allyTarget && this.shared && [...this.allies.values()].some(a => !a.down)) {
      let to = this._pendingHealTo;
      this._pendingHealTo = null;
      if (to != null && to !== 'self') {
        const a = this.allies.get(to);
        if (!a || a.down || (a.hp ?? 0) <= 0) to = 'self';
      }
      if (to == null) to = await this.pickHealTarget();
      if (to !== 'self') {
        const pct = sk.healPct || 0.3;
        this.coop.net.send({ k: 'cheal', to, pct, label: sk.name });
        this.coop.net.send({ k: 'cact', label: sk.name, targets: [] }); // advances partners' turn wait
        const a = this.allies.get(to);
        if (a) {
          a.hp = Math.min(a.maxHp, a.hp + Math.round(a.maxHp * pct));
          this.spawnFx(this.sprite(to), 'heal');
          this.log(`You mend ${a.name}.`, 'log-ally');
          SFX.heal();
        }
        this.renderPlayers(this._actingKey);
        await sleep(500);
        this.endPlayerAction();
        return;
      }
    } else {
      this._pendingHealTo = null;
    }

    // Confused: offensive skills risk striking a companion (co-op) or whiffing (solo).
    if (this.player.statuses.confused && sk.power && sk.target !== 'self' && !sk.guard) {
      const C = CONFIG.combat;
      if (this.shared) {
        const living = [...this.allies.entries()].filter(([, a]) => a && !a.down && a.hp > 0);
        if (living.length && this.rng.chance(C.confuseAllyHitChance ?? 0.55)) {
          const [to, a] = this.rng.pick(living);
          const dmg = this.estimateConfusedStrikeDmg(sk, d);
          this.log(`Confusion takes the wheel — you strike ${a.name} for ${dmg}!`, 'log-foe');
          SFX.hit();
          this.float(this.allyFloatHost(to), `-${dmg}`, 'incoming');
          a.hp = Math.max(0, a.hp - dmg);
          this.coop.net.send({ k: 'cff', to, dmg, label: sk.name });
          this.coop.net.send({ k: 'cact', label: sk.name, targets: [], confused: true });
          this.coop.broadcastStatus(this.runStatus(), 'fighting');
          this.renderPlayers(this._actingKey);
          await sleep(CONFIG.combat.skillResolveMs || 950);
          this.endPlayerAction();
          return;
        }
      } else if (this.rng.chance(C.confuseSoloWhiffChance ?? 0.4)) {
        this.log('Confusion takes the wheel — you swing at phantoms and hit nothing!', 'log-foe');
        SFX.miss();
        this.renderPlayers();
        await sleep(700);
        this.endPlayerAction();
        return;
      }
    }

    const targets = sk.target === 'all' ? this.aliveEnemies()
      : sk.target === 'self' ? []
      : [this.enemies[this.target]].filter(e => e && e.hp > 0);

    const spriteP = this.el?.querySelector?.('#sprite-player');
    const heroAnim = this.pickHeroAnim(sk);
    if (heroAnim && heroHasAnim(this.run.classId, heroAnim)) {
      // Play sheet anim; don't also bounce-transform or it fights the sprite
      await playHeroAnim(spriteP, this.run.classId, heroAnim, { target: heroCombatSize(this.run.classId), faceLeft: false });
    } else if (spriteP) {
      spriteP.classList.add('attack');
      setTimeout(() => spriteP.classList.remove('attack'), 420);
    }

    const actOps = { k: 'cact', label: sk.name, targets: [], heroAnim };
    this._stanceIgnore = (sk.power && sk.target !== 'self') ? this.consumeStanceIgnore() : false;
    if (sk.target === 'self') {
      this.applySelfSkill(sk, d);
    } else {
      const batch = sk.target === 'all' && targets.length > 1;
      if (batch) {
        beginActionLog(this, {
          actor: 'You', move: sk.name, verb: sk.verb, side: 'ally', aoe: true,
        });
      }
      for (const e of targets) {
        await sleep(CONFIG.combat.hitPauseMs || 340);
        const res = this.hitEnemy(e, sk, d);
        actOps.targets.push(res);
      }
      if (batch) endActionLog(this);
    }
    emitSkillCooldown(this, sk, skillCooldownTurns(sk));
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
    const hpBefore = this.run.hp;
    const mpBefore = this.run.mp;
    coreApplySelfSkill(this, sk, d);
    this.spawnFx(this.el?.querySelector?.('#sprite-player'), sk.fx || (sk.healPct ? 'heal' : 'buff'));
    if (this.run.hp > hpBefore) this.float(this.el?.querySelector?.('#sprite-player'), `+${this.run.hp - hpBefore}`, 'heal');
    if (this.run.mp > mpBefore) this.float(this.el?.querySelector?.('#sprite-player'), `+${this.run.mp - mpBefore}`, 'mana');
    if (this.shared && sk.tauntTurns) this.coop.broadcastStatus(this.runStatus(), 'fighting');
    if (this.shared && sk.partyBuff) this.coop.net.send({ k: 'pbuff', ...sk.partyBuff });
    SFX.heal();
  }

  applyPartyBuff(pb) {
    if (!pb) return;
    this.player.partyBuffs = this.player.partyBuffs || [];
    this.player.partyBuffs.push({ ...pb, turns: pb.turns });
    if (this.shared) this.coop.net.send({ k: 'pbuff', ...pb });
  }

  partyBuffMult(kind) { return corePartyBuffMult(this, kind); }

  hitEnemy(e, sk, d) {
    const res = resolvePlayerHit(this, e, sk, d);
    this.spawnFx(this.sprite(e.uid), sk.fx);
    const sprite = this.sprite(e.uid);
    if (sprite) {
      sprite.classList.add('hit');
      setTimeout(() => sprite.classList.remove('hit'), 360);
      this.float(sprite.parentElement, res.crit ? `${res.dmg}!` : `${res.dmg}`, res.crit ? 'crit' : 'dmg');
    }
    SpriteAnim.play(e.uid, 'hurt');
    res.crit ? SFX.crit() : SFX.hit();
    if (res.crit) screenShake();
    if (res.statuses?.burn) SFX.fire();
    if (res.statuses?.frozen) SFX.freeze();
    return res;
  }

  useConsumable(c) {
    const hpBefore = this.run.hp;
    const mpBefore = this.run.mp;
    const beforeHp = this.enemies.map(e => e.hp);
    resolveUseConsumable(this, c);
    const actOps = { k: 'cact', label: c.name, targets: [] };
    if (this.run.hp > hpBefore) {
      this.float(this.el?.querySelector?.('#sprite-player'), `+${this.run.hp - hpBefore}`, 'heal');
      SFX.heal();
    }
    if (this.run.mp > mpBefore) {
      this.float(this.el?.querySelector?.('#sprite-player'), `+${this.run.mp - mpBefore}`, 'mana');
    }
    this.enemies.forEach((e, i) => {
      const dmg = beforeHp[i] - e.hp;
      if (dmg > 0) {
        this.float(this.sprite(e.uid)?.parentElement, `${dmg}`, 'dmg');
        SpriteAnim.play(e.uid, 'hurt');
        actOps.targets.push({ uid: e.uid, dmg, hpAfter: e.hp });
      }
    });
    if (actOps.targets.length) { SFX.crit(); screenShake(); }
    if (this.shared) {
      this.coop.net.send(actOps);
      this.coop.broadcastStatus(this.runStatus(), 'fighting');
    }
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
      this.log('No escape — they cut off your retreat!', 'log-foe');
      SFX.bad();
      setTimeout(() => this.endPlayerAction(), 600);
    }
  }

  /* ================= ENEMY TURN (solo) ================= */
  async enemyTurn(e) {
    resolveEnemyTurn(this, e);
    if (!this.headless) {
      const sprite = this.sprite(e.uid);
      if (sprite) { sprite.classList.add('attack'); setTimeout(() => sprite.classList.remove('attack'), 420); }
      await sleep(420);
    }
  }

  
  bossPhaseChecksSolo(e, ops = null) {
    const before = e.phaseTriggers.length;
    coreBossPhaseSolo(this, e, ops);
    if (!this.headless && e.phaseTriggers.length > before) {
      SFX.bossIntro();
      if (e.phases) screenShake();
    }
  }

  
  /* ---- end-of-round upkeep ---- */
  async tickEnemyStatuses(ops = null) {
    coreTickEnemyStatuses(this, ops);
    if (!this.headless) await sleep(200);
  }

  
  async upkeep() {
    coreUpkeep(this);
    if (!this.headless && this.mod.hpDrainPct) SFX.bad();
  }

  
  deathSaves() {
    const beforeRevive = this.run.usedRevive;
    const beforeWard = this.usedDeathward;
    coreDeathSaves(this);
    if (this.headless) return;
    if (this.run.usedRevive && !beforeRevive) SFX.evolve();
    else if (this.usedDeathward && !beforeWard) SFX.unlock();
  }

  /* ---------------- end conditions (solo) ---------------- */
  checkEndSolo() {
    if (this.shared) return this.ended;
    if (this.run.hp <= 0) {
      if (heroHasAnim(this.run.classId, 'death')) {
        playHeroAnim(this.el?.querySelector?.('#sprite-player'), this.run.classId, 'death', { target: heroCombatSize(this.run.classId), holdLast: true, faceLeft: true });
        this.finishSolo('dead', { _delayMs: 1100 });
      } else {
        this.finishSolo('dead');
      }
      return true;
    }
    if (this.aliveEnemies().length === 0) {
      if (this.maybeTransform()) return false;
      const { gold, xp } = computeCombatPayout(this.run, this.rng, this.enemies, this.mod);
      this.finishSolo('win', { gold, xp });
      return true;
    }
    return false;
  }

  finishSolo(result, extra = {}) {
    this.locked = true;
    this.ended = true;
    this._outcome = result;
    this._stopTabFlash();
    if (this._onCombatResize && typeof window !== 'undefined') {
      window.removeEventListener('resize', this._onCombatResize);
    }
    delete this.run.combatTaunt;
    if (CONFIG.charge.resetAfterCombat) this.charge = 0;
    resetPlayerCooldowns(this);
    this.rng.advance?.();
    const { _delayMs, ...rest } = extra;
    const payload = { result, noDamage: !this.damageTaken, usedUltimate: !!this.usedUltimate, ...rest };
    if (this.headless) {
      this.resolve?.(payload);
      return;
    }
    if (result === 'win' && _delayMs == null) {
      this.resolveAfterEnemyDeaths(payload);
      return;
    }
    const delay = _delayMs ?? 900;
    setTimeout(() => this.resolve(payload), delay);
  }
}
