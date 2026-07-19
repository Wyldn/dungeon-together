// Headless combat simulation — encounter-first balance tooling.
// Used by tools/sim.js and tools/test.js. No DOM.

import { CONFIG } from '../js/data/config.js';
import { softLevelDamage, enemyScale, partyBossAoeMult } from '../js/data/tdc.js';
import { biomeForFloor } from '../js/data/enemies.js';
import { applyGuard, addCharge, tickEnemyCharge, pickEnemySpecial } from '../js/systems.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Pure enemy builder (mirrors combat.buildEnemy without DOM imports). */
export function simBuildEnemy(spec, floor, biomeStart, { boss = false, hpMult = 1, atkMult = 1 } = {}) {
  const isBoss = boss || !!spec.boss;
  const biome = biomeForFloor(floor);
  const sc = enemyScale(floor, biomeStart, biome.id, { boss: isBoss, elite: !!spec.elite });
  const spd = Math.max(1, Math.round((spec.spd || 5) * sc.spd));
  const atkScale = sc.atk * (atkMult || 1);
  return {
    ...spec,
    boss: isBoss,
    elite: !!spec.elite,
    maxHp: Math.round(spec.hp * sc.hp * hpMult),
    hp: Math.round(spec.hp * sc.hp * hpMult),
    atk: Math.round(spec.atk * atkScale),
    def: Math.round(spec.def * sc.def),
    spd,
    chargeGain: (spec.chargeGain || 1) * sc.chargeGain,
    charge: 0,
    statuses: {},
    _m: { hp: sc.hp * hpMult, atk: atkScale, def: sc.def },
  };
}

// Mirror combat.js transformBoss: a two-phase boss whose shell is destroyed
// rises with a fresh, identically-scaled HP bar. Keeps the RTK benchmark honest.
function simTransform(e) {
  const p2 = e.phase2 || {};
  const m = e._m || { hp: 1, atk: 1, def: 1 };
  if (p2.atk != null) e.atk = Math.round(p2.atk * m.atk);
  if (p2.def != null) e.def = Math.round(p2.def * m.def);
  e.maxHp = p2.hp != null ? Math.round(p2.hp * m.hp) : e.maxHp;
  e.hp = e.maxHp;
  e.specials = p2.specials ?? e.specials;
  e.chargeGain = p2.chargeGain ?? e.chargeGain;
  e.charge = 0; e.statuses = {};
  e.twoPhase = false;
}

/**
 * Synthetic climber snapshot for a given floor percentile band.
 * `band`: 0.25 | 0.50 | 0.75 — relative gear/stat quality.
 */
export function syntheticClimber(floor, band = 0.5, classBias = 'str') {
  const t = (Math.max(1, floor) - 1) / 50;
  const q = band;
  const level = Math.max(1, Math.round(1 + t * 18 + (q - 0.5) * 2));
  const primary = Math.round(8 + t * 18 + q * 6);
  const secondary = Math.round(6 + t * 10 + q * 3);
  const stats = { str: secondary, dex: secondary, int: secondary, wis: secondary, lk: Math.round(5 + t * 6 + q * 2) };
  stats[classBias] = primary;
  const atk = Math.round(2 + t * 8 + q * 4);
  const def = Math.round(t * 6 + q * 3);
  const hp = Math.round(42 + t * 110 + q * 40 + level * 3.5);
  const dmgMult = 1 + q * 0.12 + t * 0.08;
  const dmgTakenMult = Math.max(0.45, 1 - q * 0.12 - t * 0.08);
  const crit = 5 + secondary * 0.35 + stats.lk * 0.5 + q * 8;
  return {
    level, stats, atk, def, hp, maxHp: hp, mp: 40 + level * 2, maxMp: 40 + level * 2,
    dmgMult, dmgTakenMult, crit, dodge: Math.min(30, 3 + stats.dex * 0.45),
    classBias, floor, band,
  };
}

function playerHit(p, enemy, rng, { power = 100 } = {}) {
  const C = CONFIG.combat;
  const statVal = p.stats[p.classBias] || p.stats.str;
  let base = (statVal * C.playerStatWeight + p.atk * C.playerAtkWeight
    + softLevelDamage(p.level, C.playerLevelWeight) + C.playerFlat)
    * (power / 100);
  let dmg = base * (0.85 + rng.next() * 0.3);
  if (rng.chance(clamp(p.crit, 0, 85) / 100)) dmg *= 1.6;
  dmg *= p.dmgMult;
  dmg -= enemy.def;
  return Math.max(1, Math.round(dmg));
}

function enemyHit(e, p, rng, { special = null, chargeScale = 1, playerGuarding = false } = {}) {
  let dmg = e.atk * CONFIG.combat.enemyAtkMult * (0.85 + rng.next() * 0.3)
    * (special?.mult || 1) * chargeScale;
  dmg -= p.def;
  dmg = applyGuard(dmg, playerGuarding);
  dmg *= p.dmgTakenMult;
  return Math.max(1, Math.round(dmg));
}

/**
 * Simulate a full solo fight. Returns rounds, hp loss, win/loss.
 * Policy: mostly Strike; spend charge on a 140-power hit when ≥3 charge;
 * Guard when below 35% HP and an enemy telegraphs. Models kit use without DOM.
 */
/**
 * Solo or party fight. `players` may be one climber or an array.
 * Enemies pick a random living target; AOE specials hit everyone.
 * Wipe when every climber is down. Returns per-player hpLeft[].
 */
export function simulateFight(rng, playerOrParty, enemySpecs, {
  floor = 1,
  biomeStart = 1,
  hpMult = 1,
  escortHpMult = null,
  escortAtkMult = 0.55, // boss-floor adds hit softer than open-floor trash
  atkMult = 1,
  boss = false,
  maxRounds = 40,
} = {}) {
  const partyIn = Array.isArray(playerOrParty) ? playerOrParty : [playerOrParty];
  const enemies = enemySpecs.map((s, i) => {
    // Only the lead (or flagged) enemy is the boss — escorts keep trash scaling.
    const isBoss = !!s.boss || (boss && i === 0);
    return simBuildEnemy(s, floor, isBoss ? floor : biomeStart, {
      boss: isBoss,
      hpMult: isBoss ? hpMult : (escortHpMult ?? 1),
      atkMult: isBoss ? atkMult : (boss ? escortAtkMult : 1),
    });
  });
  const party = partyIn.map(pl => ({
    ...pl,
    hp: pl.hp ?? pl.maxHp,
    maxHp: pl.maxHp ?? pl.hp,
    charge: 0,
    guarding: false,
    usedPotion: false,
  }));
  const startHp = party.reduce((s, p) => s + p.hp, 0);
  let rounds = 0;

  const livingPlayers = () => party.filter(p => p.hp > 0);
  const livingEnemies = () => enemies.filter(e => e.hp > 0);

  while (rounds < maxRounds) {
    rounds++;
    for (const p of party) p.guarding = false;
    if (!livingEnemies().length) break;
    if (!livingPlayers().length) break;

    for (const p of livingPlayers()) {
      if (!livingEnemies().length) break;
      if (!p.usedPotion && p.hp / p.maxHp < 0.4) {
        p.usedPotion = true;
        p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.35));
      }
      const threatened = livingEnemies().some(e => (e.specials || []).some(s => (e.charge || 0) >= s.at - 1));
      if (p.hp / p.maxHp < 0.35 && threatened) {
        p.guarding = true;
        p.charge = addCharge(p.charge, CONFIG.guard.chargeGain);
        continue;
      }
      const target = livingEnemies().sort((a, b) => a.hp - b.hp)[0];
      const heavy = p.charge >= 3;
      const power = heavy ? 140 : 100;
      target.hp = Math.max(0, target.hp - playerHit(p, target, rng, { power }));
      if (heavy) p.charge = Math.max(0, p.charge - 3);
      else p.charge = addCharge(p.charge, CONFIG.charge.gainPerTurn);
      if (target.hp <= 0 && target.twoPhase && target.phase2) simTransform(target);
      if (target.hp <= 0) p.charge = addCharge(p.charge, CONFIG.charge.gainOnKill);
    }

    if (!livingEnemies().length) break;

    for (const e of livingEnemies()) {
      if (!livingPlayers().length) break;
      if (e.regen && e.hp > 0) e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * e.regen));
      tickEnemyCharge(e);
      const special = pickEnemySpecial(e);
      let chargeScale = 1;
      if (special && e.boss) {
        chargeScale = 1 + CONFIG.boss.chargeDamageScale * (e.charge || 0);
      }
      const living = livingPlayers();
      if (!living.length) break;
      const targets = special?.aoe ? living : [rng.pick(living)];
      const aoeShare = special?.aoe ? partyBossAoeMult(living.length) : 1;
      let landed = false;
      for (const p of targets) {
        if (p.hp <= 0) continue;
        if (rng.chance(clamp(p.dodge, 0, 35) / 100)) continue;
        landed = true;
        let dmg = enemyHit(e, p, rng, { special, chargeScale, playerGuarding: p.guarding });
        if (aoeShare !== 1) dmg = Math.max(1, Math.round(dmg * aoeShare));
        p.hp = Math.max(0, p.hp - dmg);
        if (e.lifesteal) e.hp = Math.min(e.maxHp, e.hp + Math.round(dmg * e.lifesteal));
      }
      if (special) {
        e.charge = 0;
        if (special.heal) e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * special.heal));
        if (!landed && !special.aoe) { /* dodge ate the special */ }
      }
    }
    for (const p of party) p.guarding = false;
  }

  const survivors = livingPlayers();
  const won = enemies.every(e => e.hp <= 0) && survivors.length > 0;
  const hpLeftTotal = party.reduce((s, p) => s + Math.max(0, p.hp), 0);
  const hpLost = Math.max(0, startHp - hpLeftTotal);
  return {
    won,
    rounds,
    hpLost,
    hpLeft: survivors.length ? Math.max(1, Math.round(hpLeftTotal / survivors.length)) : 0,
    hpLeftAll: party.map(p => Math.max(0, p.hp)),
    hpLossPct: startHp > 0 ? Math.min(1, hpLost / startHp) : 1,
    enemiesLeft: enemies.filter(e => e.hp > 0).length,
    survivors: survivors.length,
  };
}

/** Percentile helper on a pre-sorted ascending array. */
export function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
