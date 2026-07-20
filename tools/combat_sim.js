// Headless combat simulation — encounter-first balance tooling.
// Used by tools/sim.js and tools/test.js. No DOM.
//
// Player policy mirrors Fight.autoPlayAct (js/combat.js): potion → heal skill →
// Guard on ready telegraph → strongest affordable skill, lowest-HP target.
// Kits are abstract (power/cost/charge), not full skill tables — fast enough
// for thousands of Monte Carlo climbs.

import { CONFIG } from '../js/data/config.js';
import {
  softLevelDamage, enemyScale, partyBossAoeMult, expectedCurveT, soloBossChargeForScale,
  levelDefBonus, resourceRegen, partyTrashAtkMult, TDC,
} from '../js/data/tdc.js';
import { biomeForFloor } from '../js/data/enemies.js';
import {
  applyGuard, applyDefense, addCharge, tickEnemyCharge, pickEnemySpecial,
  enemyTelegraph, canAfford, skillEffectivePower,
} from '../js/systems.js';

/** Re-export: build a fight snapshot from a real run (derived stats + SKILLS). */
export { climberFromRun } from './sim_run_state.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Pure enemy builder (mirrors combat.buildEnemy without DOM imports). */
export function simBuildEnemy(spec, floor, biomeStart, {
  boss = false, hpMult = 1, atkMult = 1, partySize = 1,
} = {}) {
  const isBoss = boss || !!spec.boss;
  const biome = biomeForFloor(floor);
  const sc = enemyScale(floor, biomeStart, biome.id, {
    boss: isBoss, elite: !!spec.elite, partySize,
    eliteAtkRole: !!spec.eliteAtkRole,
  });
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
    baseAtk: Math.round(spec.atk * atkScale),
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
 * Abstract kit matching auto-play's decision surface:
 * Strike always, a free-ish technique, a charge finisher, optional self-heal.
 */
export function buildSimKit(level, loot, q = 0.5) {
  const skills = [
    { id: 'basic_attack', power: 100, cost: 0, charge: 0, target: 'one' },
  ];
  if (level >= 2 || loot > 0.12) {
    skills.push({
      id: 'tech',
      power: Math.round(115 + loot * 45 + q * 15),
      cost: Math.round(8 + loot * 6),
      charge: 0,
      target: 'one',
    });
  }
  if (level >= 4 || loot > 0.22) {
    skills.push({
      id: 'finisher',
      power: Math.round(140 + loot * 50 + q * 20),
      cost: Math.round(6 + loot * 4),
      charge: loot > 0.5 ? 3 : 2,
      target: loot > 0.55 ? 'all' : 'one',
    });
  }
  if (level >= 5 || loot > 0.28) {
    skills.push({
      id: 'mend',
      power: 0,
      healPct: 0.28 + loot * 0.08,
      cost: Math.round(10 + loot * 5),
      charge: 0,
      target: 'self',
    });
  }
  return skills;
}

/**
 * Synthetic climber for clear-rate / boss RTK sims.
 * `band` ≈ loot luck: 0.25 underdog, 0.50 typical, 0.75 strong.
 *
 * Early floors are intentionally lean — real F10 kits are usually ~2 rares
 * (weapon + armor/accessory), not a full mid-climb pad. Loot maturity lags
 * expectedCurveT so P50 tracks the power curve without overstating gear.
 */
export function syntheticClimber(floor, band = 0.5, classBias = 'str') {
  const t = expectedCurveT(floor);
  const q = band;
  // Early lean (F10 ≈ 2 rares), catch up through mid-climb, ease off late
  // so endgame P50 still tracks expectedPower instead of floating +20%.
  const early = Math.pow(t, 0.78);
  const midCatch = Math.min(1, Math.max(0, (t - 0.10) / 0.26));
  const lateFade = 1 - Math.min(1, Math.max(0, t - 0.45) / 0.55);
  const loot = early * (1 + 0.30 * midCatch * lateFade);
  const level = Math.max(1, Math.round(1 + t * 18 + (q - 0.5) * 2.2 + loot * 2));
  const primary = Math.round(8 + t * 19 + q * 5.5 + loot * 2);
  const secondary = Math.round(6 + t * 10 + q * 2.5);
  const stats = {
    str: secondary, dex: secondary, int: secondary, wis: secondary,
    lk: Math.round(6 + t * 6.5 + q * 2),
  };
  stats[classBias] = primary;
  const atk = Math.round(2 + loot * 16 + q * (2.2 + loot * 4.2));
  // Gear DEF + innate level DEF (combat uses diminishing-returns mitigation).
  const def = Math.round(
    levelDefBonus(level) + 1 + loot * 14 + q * (1.8 + loot * 4.2)
  );
  // Lean HP pool (~150 late); tankiness is mostly DEF now.
  const hp = Math.round(52 + loot * 40 + loot * loot * 16 + q * (8 + loot * 14) + level * 1.35);
  const dmgMult = 1 + q * (0.05 + loot * 0.13) + loot * 0.09;
  const dmgTakenMult = Math.max(0.42, 1 - q * (0.07 + loot * 0.11) - loot * 0.09);
  const crit = 5 + secondary * 0.35 + stats.lk * 0.5 + q * 5 + loot * 5;
  const maxMp = Math.round(44 + level * 2.2);
  return {
    level, stats, atk, def, hp, maxHp: hp, mp: maxMp, maxMp,
    dmgMult, dmgTakenMult, crit, dodge: Math.min(32, 4 + stats.dex * 0.5),
    classBias, floor, band, loot,
    skills: buildSimKit(level, loot, q),
    // Expected potions on hand for this power band (auto-play consumes these).
    potions: Math.max(0, Math.round(loot * 2.2 + q * 1.2)),
    potionCap: Math.max(0, Math.round(loot * 2.2 + q * 1.2)),
    manaRegen: resourceRegen(stats.wis),
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
  return applyDefense(dmg, enemy.def);
}

function enemyHit(e, p, rng, { special = null, chargeScale = 1, playerGuarding = false } = {}) {
  let dmg = e.atk * CONFIG.combat.enemyAtkMult * (0.85 + rng.next() * 0.3)
    * (special?.mult || 1) * chargeScale;
  dmg = applyDefense(dmg, p.def);
  dmg = applyGuard(dmg, playerGuarding);
  dmg *= p.dmgTakenMult;
  return Math.max(1, Math.round(dmg));
}

function endSimTurn(p) {
  p.charge = addCharge(p.charge, CONFIG.charge.gainPerTurn);
  p.mp = Math.min(p.maxMp, (p.mp || 0) + (p.manaRegen || 4));
}

/**
 * One player action — thresholds/order match Fight.autoPlayAct.
 * Returns true if the actor spent the turn (always, unless no foes).
 */
function simAutoPlayTurn(p, enemies, rng) {
  const living = () => enemies.filter(e => e.hp > 0);
  if (!living().length) return false;

  const hpRatio = p.hp / Math.max(1, p.maxHp);
  const skills = p.skills?.length
    ? p.skills
    : [{ id: 'basic_attack', power: 100, cost: 0, charge: 0, target: 'one' }];
  const afford = sk => canAfford(
    { cost: sk.cost || 0, charge: sk.charge || 0 },
    p.mp || 0,
    p.charge || 0,
  );

  // 1) Potion under 35% (auto-play)
  if (hpRatio < 0.35 && (p.potions || 0) > 0) {
    p.potions -= 1;
    p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * 0.35));
    endSimTurn(p);
    return true;
  }

  // 2) Heal skill under 40%
  if (hpRatio < 0.4) {
    const healSk = skills.find(sk => sk.healPct && sk.target === 'self' && afford(sk));
    if (healSk) {
      p.mp = Math.max(0, (p.mp || 0) - (healSk.cost || 0));
      if (healSk.charge) p.charge = Math.max(0, p.charge - healSk.charge);
      p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * healSk.healPct));
      endSimTurn(p);
      return true;
    }
  }

  // 3) Guard when a special is READY and HP < 55%
  const threatened = living().some(e => {
    const t = enemyTelegraph(e);
    return t && t.ready;
  });
  if (threatened && hpRatio < 0.55) {
    p.guarding = true;
    p.charge = addCharge(p.charge, CONFIG.guard.chargeGain);
    endSimTurn(p);
    return true;
  }

  // 4) Strongest affordable offensive skill → lowest HP foe (or all)
  const pool = skills
    .filter(sk => !sk.healPct && sk.target !== 'self' && afford(sk))
    .sort((a, b) => skillEffectivePower(b) - skillEffectivePower(a) || (b.charge || 0) - (a.charge || 0));
  const sk = pool[0] || { id: 'basic_attack', power: 100, cost: 0, charge: 0, target: 'one' };

  p.mp = Math.max(0, (p.mp || 0) - (sk.cost || 0));
  if (sk.charge) p.charge = Math.max(0, p.charge - sk.charge);

  const foes = living().sort((a, b) => a.hp - b.hp);
  const targets = sk.target === 'all' ? foes : (foes[0] ? [foes[0]] : []);
  for (const target of targets) {
    if (target.hp <= 0) continue;
    target.hp = Math.max(0, target.hp - playerHit(p, target, rng, { power: skillEffectivePower(sk) || 100 }));
    if (target.hp <= 0 && target.twoPhase && target.phase2) simTransform(target);
    if (target.hp <= 0) p.charge = addCharge(p.charge, CONFIG.charge.gainOnKill);
  }

  endSimTurn(p);
  return true;
}

/**
 * Solo or party fight. `players` may be one climber or an array.
 * Player turns use the auto-play policy; enemies resolve after all players.
 */
export function simulateFight(rng, playerOrParty, enemySpecs, {
  floor = 1,
  biomeStart = 1,
  hpMult = 1,
  escortHpMult = null,
  escortAtkMult = null, // boss-floor adds; default CONFIG.boss.escortAtkMult
  atkMult = 1,
  boss = false,
  maxRounds = 40,
} = {}) {
  const partyIn = Array.isArray(playerOrParty) ? playerOrParty : [playerOrParty];
  const partySize = partyIn.length;
  const trashAtk = partyTrashAtkMult(partySize, floor);
  const escort = escortAtkMult ?? CONFIG.boss.escortAtkMult ?? 0.55;
  const enemies = enemySpecs.map((s, i) => {
    // Only the lead (or flagged) enemy is the boss — escorts keep trash scaling.
    const isBoss = !!s.boss || (boss && i === 0);
    return simBuildEnemy(s, floor, isBoss ? floor : biomeStart, {
      boss: isBoss,
      hpMult: isBoss ? hpMult : (escortHpMult ?? 1),
      atkMult: isBoss ? atkMult : (boss ? escort : trashAtk),
      partySize,
    });
  });
  const party = partyIn.map(pl => ({
    ...pl,
    hp: pl.hp ?? pl.maxHp,
    maxHp: pl.maxHp ?? pl.hp,
    mp: pl.mp ?? pl.maxMp ?? 40,
    maxMp: pl.maxMp ?? pl.mp ?? 40,
    charge: pl.charge || 0,
    guarding: false,
    skills: pl.skills || buildSimKit(pl.level || 1, pl.loot || 0.3, pl.band || 0.5),
    potions: pl.potions ?? 0,
    manaRegen: pl.manaRegen ?? 4,
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

    // Stall enrage — bosses and event elites ramp if the fight drags.
    for (const e of livingEnemies()) {
      const bossR = e.enrageAtRound ?? (e.boss ? TDC.enrage?.bossAtRound : null);
      const eventR = e.enrageAtRound ?? ((e.elite && !e.boss) ? TDC.enrage?.eventAtRound : null);
      const at = bossR ?? eventR;
      if (at != null && rounds >= at && !e._enraged) {
        const mult = e.boss
          ? (TDC.enrage?.bossAtkMult || 1.25)
          : (TDC.enrage?.eventAtkMult || 1.25);
        e.atk = Math.round((e.baseAtk || e.atk) * mult);
        e._enraged = true;
      }
    }

    for (const p of livingPlayers()) {
      if (!livingEnemies().length) break;
      simAutoPlayTurn(p, enemies, rng);
    }

    if (!livingEnemies().length) break;

    for (const e of livingEnemies()) {
      if (!livingPlayers().length) break;
      if (e.regen && e.hp > 0) e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * e.regen));
      tickEnemyCharge(e);
      const special = pickEnemySpecial(e, rng);
      let chargeScale = 1;
      if (special && e.boss) {
        const banked = party.length <= 1
          ? soloBossChargeForScale(floor, e.charge || 0)
          : (e.charge || 0);
        chargeScale = 1 + CONFIG.boss.chargeDamageScale * banked;
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
  // Write combat state back (potions + vitals) for multi-fight climbs / real runs.
  const syncBack = (src, dst) => {
    if (!src || !dst) return;
    dst.potions = src.potions;
    dst.hp = src.hp;
    dst.mp = src.mp;
    dst.charge = src.charge;
  };
  if (Array.isArray(playerOrParty)) {
    for (let i = 0; i < playerOrParty.length; i++) syncBack(party[i], playerOrParty[i]);
  } else {
    syncBack(party[0], playerOrParty);
  }
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
