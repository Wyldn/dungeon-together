// Encounter-first balance: budgets, mechanic costs, floor benchmarks,
// item power scoring, and loadout validators.
//
// Central rule: do not tune HP, enemy count, Guard, or revival in isolation.
// Balance the complete encounter around action economy (threat budget),
// expected rounds-to-kill, damage taken, and resource spend.

import { CONFIG } from './config.js';
import { TDC, expectedPower, enemyScale, partyPadEase } from './tdc.js';
import { biomeForFloor } from './enemies.js';

/* ================================================================== */
/*  Guard ↔ revival reconciliation                                     */
/*  Both use the same fraction: Guard blocks 30%; revival restores 30%. */
/* ================================================================== */

export function guardBlockPct() {
  return CONFIG.guard.blockPct;
}

export function reviveHpPct() {
  return CONFIG.death.reviveHpPct;
}

/** True when Guard block and revival share the reconciled fraction. */
export function guardReviveReconciled() {
  return Math.abs(CONFIG.guard.blockPct - CONFIG.death.reviveHpPct) < 1e-9
    && Math.abs(CONFIG.death.respawnHpPct - CONFIG.death.reviveHpPct) < 1e-9
    && Math.abs(CONFIG.death.respawnResourcePct - CONFIG.death.reviveHpPct) < 1e-9;
}

/* ================================================================== */
/*  Global floor benchmark                                             */
/* ================================================================== */

/** Encounter targets for a P50 climber at `floor`. */
export function floorBenchmark(floor) {
  const f = Math.max(1, Math.min(TDC.lastFloor, floor | 0));
  const power = expectedPower(f);
  const t = (f - 1) / (TDC.lastFloor - 1);
  // Combat lengthens slightly with depth; bosses stretch more.
  const combatRounds = [
    Math.round(TDC.benchmark.combatRounds[0] + t * 0.5),
    Math.round(TDC.benchmark.combatRounds[1] + t * 1.5),
  ];
  const bossRounds = [
    Math.round(TDC.benchmark.bossRounds[0] + t * 1),
    Math.round(TDC.benchmark.bossRounds[1] + t * 2),
  ];
  return {
    floor: f,
    power,
    combat: {
      rounds: combatRounds,
      hpLoss: [...TDC.benchmark.combatHpLoss],
    },
    boss: {
      rounds: bossRounds,
      hpLoss: [
        TDC.benchmark.bossHpLoss[0],
        Math.min(0.7, TDC.benchmark.bossHpLoss[1] + t * 0.05),
      ],
    },
    // Solo threat budget at this floor (1.0 ≈ one mid biome trash pack on F1).
    budget: soloEncounterBudget(f),
  };
}

export function soloEncounterBudget(floor) {
  return TDC.budget.base * expectedPower(floor);
}

/** Party-scaled encounter budget. Extra players buy threat, not double-dips. */
export function encounterBudget(floor, partySize = 1) {
  const n = Math.max(1, partySize | 0);
  const solo = soloEncounterBudget(floor);
  const table = TDC.budget.budgetBySize;
  const full = (table && table[n] != null)
    ? table[n]
    : (1 + TDC.budget.perExtraPlayer * (n - 1));
  if (n <= 1 || full <= 1) return solo * full;
  // Early co-op trash eases in with the same pad curve as boss ATK.
  return solo * (1 + (full - 1) * partyPadEase(floor));
}

/* ================================================================== */
/*  Enemy mechanic budget costs                                        */
/* ================================================================== */

/** Additive threat multipliers for special enemy mechanics. */
export const MECHANIC_COSTS = {
  elite: 0.28,
  caster: 0.12,
  pack: 0.06,          // flag only; extra bodies cost their own threat
  regen: 0.18,         // plus regen rate below
  lifesteal: 0.14,
  poison: 0.10,
  burn: 0.10,
  freeze: 0.14,
  summons: 0.38,
  heads: 0.32,
  phases: 0.42,
  aoeSpecial: 0.16,
  healSpecial: 0.10,
  stunSpecial: 0.08,
  chargeGainBonus: 0.12, // chargeGain > 1
};

/**
 * Budget cost of an enemy's mechanics (fraction of base threat).
 * Does not include raw hp/atk — see enemyThreatCost.
 */
export function mechanicBudgetCost(spec) {
  if (!spec) return 0;
  let m = 0;
  if (spec.elite) m += MECHANIC_COSTS.elite;
  if (spec.caster) m += MECHANIC_COSTS.caster;
  if (spec.pack) m += MECHANIC_COSTS.pack;
  if (spec.regen) m += MECHANIC_COSTS.regen + Number(spec.regen) * 1.5;
  if (spec.lifesteal) m += MECHANIC_COSTS.lifesteal + Number(spec.lifesteal) * 0.35;
  if (spec.poison) m += MECHANIC_COSTS.poison + Number(spec.poison) * 0.2;
  if (spec.burn) m += MECHANIC_COSTS.burn + Number(spec.burn) * 0.2;
  if (spec.freeze) m += MECHANIC_COSTS.freeze + Number(spec.freeze) * 0.25;
  if (spec.summons) m += MECHANIC_COSTS.summons;
  if (spec.heads) m += MECHANIC_COSTS.heads;
  if (spec.phases) m += MECHANIC_COSTS.phases;
  if ((spec.chargeGain || 1) > 1) m += MECHANIC_COSTS.chargeGainBonus * ((spec.chargeGain || 1) - 1);
  for (const s of spec.specials || []) {
    if (s.aoe) m += MECHANIC_COSTS.aoeSpecial;
    if (s.heal) m += MECHANIC_COSTS.healSpecial + Number(s.heal);
    if (s.stun) m += MECHANIC_COSTS.stunSpecial;
  }
  return m;
}

/**
 * Threat cost of one enemy at a floor, including scaled stats + mechanics.
 * Reference: F1 wolf ≈ 1.0 after biome/depth scale.
 */
export function enemyThreatCost(spec, floor, biomeStart, { boss = false } = {}) {
  const biome = biomeForFloor(floor);
  const start = biomeStart ?? biome.floors[0];
  const sc = enemyScale(floor, start, biome.id, { boss: boss || !!spec.boss, elite: !!spec.elite });
  const hp = (spec.hp || 1) * sc.hp;
  const atk = (spec.atk || 1) * sc.atk;
  const def = (spec.def || 0) * sc.def;
  // Action-economy weighted: HP (survivability) + ATK (outgoing pressure) + DEF.
  const base = (hp / TDC.budget.refHp) * 0.52
    + (atk / TDC.budget.refAtk) * 0.38
    + (def / TDC.budget.refDef) * 0.10;
  return Math.max(0.15, base * (1 + mechanicBudgetCost(spec)));
}

/** Convert unused (or overspent) budget into a capped HP pad / trim. */
export function residualHpMult(remaining, totalBudget) {
  if (totalBudget <= 0) return 1;
  if (remaining > 0) {
    const frac = remaining / totalBudget;
    return 1 + Math.min(TDC.budget.residualHpCap, frac * TDC.budget.residualHpFactor);
  }
  if (remaining < 0) {
    const frac = (-remaining) / totalBudget;
    return Math.max(1 - TDC.budget.residualHpCap, 1 - frac * TDC.budget.residualHpFactor);
  }
  return 1;
}

/**
 * Fill an encounter from a pool under a threat budget.
 * Prefers additional bodies; leftover budget → mild HP mult only.
 *
 * Solo early tower (first two biomes) caps body count so a lone climber
 * is not handed 1v4 trash packs before they have tools.
 */
export function soloEarlyMaxEnemies(floor, partySize = 1) {
  if ((partySize || 1) > 1) return null;
  const f = floor | 0;
  if (f <= 10) return 2;  // Whispering Forest
  if (f <= 20) return 3;  // Sunken Ruins
  return null;
}

export function planEncounter(rng, {
  floor,
  biomeStart,
  pool,
  partySize = 1,
  allowElite = true,
  maxEnemies = null,
} = {}) {
  const budget = encounterBudget(floor, partySize);
  let remaining = budget;
  const usable = allowElite ? [...pool] : pool.filter(e => !e.elite);
  if (!usable.length) return { specs: [], hpMult: 1, budget, spent: 0 };

  const cap = maxEnemies ?? soloEarlyMaxEnemies(floor, partySize);
  const roomFor = (n = 1) => !cap || specs.length + n <= cap;

  // Swarm draws (AoE showcase): many cheap pack bodies instead of a heavy
  // lead. Same threat budget — more targets, thinner blood each.
  const swarmPool = usable.filter(e => !e.elite && e.pack);
  const swarm = swarmPool.length > 0 && rng.chance(TDC.budget.swarmChance || 0);
  const swarmMax = TDC.budget.swarmMaxBodies || 5;
  const swarmCap = cap != null ? Math.min(cap, swarmMax) : swarmMax;

  const lead = swarm ? rng.pick(swarmPool) : rng.pick(usable);
  const specs = [lead];
  remaining -= enemyThreatCost(lead, floor, biomeStart);

  const nonElite = () => usable.filter(e => !e.elite);
  const cheapest = () => {
    const cands = nonElite();
    if (!cands.length) return null;
    return cands.reduce((best, e) => {
      const c = enemyThreatCost(e, floor, biomeStart);
      return !best || c < best.cost ? { e, cost: c } : best;
    }, null);
  };

  // Pack mates are identity, not optional budget luxuries — always bring them
  // when the cap allows. Overspend is clawed back via residual HP.
  if (lead.pack && roomFor(1)) {
    const depth = Math.max(0, floor - biomeStart);
    let extras;
    if (cap != null && (partySize || 1) <= 1) {
      // Solo early: usually +1 mate, sometimes a lone pack leader
      extras = depth < 4 && rng.chance(0.35) ? 0 : 1;
      if (cap === 2) extras = Math.min(extras, 1);
    } else {
      extras = depth < 3 ? 1 : rng.int(1, 2);
    }
    if (cap != null) extras = Math.min(extras, Math.max(0, cap - specs.length));
    for (let i = 0; i < extras; i++) {
      const mate = rng.chance(0.7) ? lead : (rng.pick(nonElite()) || lead);
      specs.push(mate);
      remaining -= enemyThreatCost(mate, floor, biomeStart);
    }
  } else if (!lead.elite && roomFor(1) && (floor - biomeStart) >= 2 && rng.chance(0.28)) {
    const mate = rng.pick(nonElite());
    if (mate) {
      specs.push(mate);
      remaining -= enemyThreatCost(mate, floor, biomeStart);
    }
  }

  // Spend remaining budget on more bodies (party scaling lives here).
  // Allow mild overspend (fillThreshold) so co-op buys actions, not just HP pads.
  let guard = 0;
  const fillAt = TDC.budget.fillThreshold;
  while (guard++ < 8) {
    const bodyCap = swarm ? swarmCap : cap;
    if (bodyCap != null && specs.length >= bodyCap) break;
    // Swarms keep stacking the lead's kin; normal draws take the cheapest body.
    const next = swarm && rng.chance(0.75)
      ? { e: lead, cost: enemyThreatCost(lead, floor, biomeStart) }
      : cheapest();
    if (!next) break;
    if (next.cost > remaining && next.cost * fillAt > remaining) break;
    if (!swarm && specs.length >= 2 + Math.max(0, (partySize | 0) - 1) && remaining < next.cost * 0.85 && rng.chance(0.4)) break;
    specs.push(next.e);
    remaining -= next.cost;
  }

  const spent = budget - remaining;
  const hpMult = residualHpMult(remaining, budget);
  return { specs, hpMult, budget, spent, remaining, maxEnemies: cap, swarm };
}

/**
 * Boss encounter plan: boss consumes most of the budget; escort only if
 * leftover covers a minion's cost (replaces partyHpMult + bossMinionAt).
 */
export function planBossEncounter(rng, {
  floor,
  boss,
  pool,
  partySize = 1,
} = {}) {
  const budget = encounterBudget(floor, partySize) * TDC.budget.bossBudgetMult;
  const bossCost = enemyThreatCost(boss, floor, floor, { boss: true });
  let remaining = budget - bossCost;
  const specs = [boss];
  const nonElite = (pool || []).filter(e => !e.elite);
  if (remaining >= TDC.budget.bossEscortMinFrac * budget && nonElite.length) {
    const escort = rng.pick(nonElite);
    const cost = enemyThreatCost(escort, floor, biomeForFloor(floor).floors[0]);
    if (cost <= remaining) {
      specs.push(escort);
      remaining -= cost;
    }
  }
  const spent = budget - Math.max(0, remaining);
  const hpMult = residualHpMult(Math.max(0, remaining), budget);
  return { specs, hpMult, budget, spent, remaining: Math.max(0, remaining) };
}

/* ================================================================== */
/*  Item power scoring                                                 */
/* ================================================================== */

const RARITY_CAP = {
  common: 12,
  uncommon: 22,
  rare: 38,
  epic: 58,
  legendary: 85,
  unique: 130,
  wrld: 180,
};

const TIER_CAP_BONUS = { 1: 0, 2: 4, 3: 10, 4: 18, 5: 28 };

/** Numeric power score for one item or relic (higher = stronger). */
export function itemPowerScore(it) {
  if (!it) return 0;
  let s = 0;
  s += (it.atk || 0) * 1.5;
  s += (it.def || 0) * 1.2;
  s += (it.hp || 0) * 0.12;
  s += (it.mp || 0) * 0.08;
  for (const st of ['str', 'dex', 'int', 'wis', 'lk']) s += (it[st] || 0) * 0.9;
  s += (it.crit || 0) * 0.35;
  s += (it.dodge || 0) * 0.4;
  s += (it.lifesteal || 0) * 40;
  s += (it.initiative || 0) * 2.5;
  s += (it.startCharge || 0) * 6;
  s += (it.manaRegen || 0) * 1.5;
  s += (it.burn || 0) * 35;
  s += (it.freeze || 0) * 40;
  s += (it.enemyCrit || 0) * 0.5;
  if (it.dmgMult) s += (it.dmgMult - 1) * 45;
  if (it.bossDmgMult) s += (it.bossDmgMult - 1) * 35;
  if (it.dmgTakenMult) s += (1 - it.dmgTakenMult) * 55;
  if (it.maxHpMult) s += (it.maxHpMult - 1) * 40;
  if (it.goldMult) s += (it.goldMult - 1) * 8;
  if (it.xpMult) s += (it.xpMult - 1) * 10;
  if (it.fameGainMult) s += (it.fameGainMult - 1) * 6;
  if (it.revive) s += 22;
  if (it.deathward) s += 14;
  if (it.reveal === 'exact') s += 8;
  else if (it.reveal === 'ranks') s += 4;
  if (it.thorns) s += it.thorns * 30;
  if (it.confuseChance) s += it.confuseChance * 25;
  if (it.echoChance) s += it.echoChance * 28;
  if (it.doubleDmgRound) s += 18;
  if (it.victoryHeal) s += it.victoryHeal * 40;
  if (it.lowHpHeal) s += 10;
  if (it.extraSkillSlots) s += it.extraSkillSlots * 8;
  if (it.allStats) s += it.allStats * 4.5;
  return Math.round(s * 10) / 10;
}

export function itemPowerCap(it) {
  const rarity = it?.rarity || 'common';
  const tier = it?.tier || 1;
  return (RARITY_CAP[rarity] ?? 20) + (TIER_CAP_BONUS[tier] ?? tier * 4);
}

/** Reject items that exceed their rarity/tier power budget. */
export function validateItemPower(it) {
  const score = itemPowerScore(it);
  const cap = itemPowerCap(it);
  return {
    ok: score <= cap * TDC.validators.itemSlack,
    score,
    cap,
    id: it?.id,
  };
}

/**
 * Combined loadout power. Rejects stacked dmg / mitigation that breaks
 * encounter assumptions before content expands.
 */
export function loadoutPowerScore(items = []) {
  let score = 0;
  let dmgMult = 1;
  let takenMult = 1;
  for (const it of items) {
    if (!it) continue;
    score += itemPowerScore(it);
    if (it.dmgMult) dmgMult *= it.dmgMult;
    if (it.dmgTakenMult) takenMult *= it.dmgTakenMult;
  }
  return { score, dmgMult, takenMult, mitigation: 1 - takenMult };
}

export function validateLoadout(items = [], { floor = 1 } = {}) {
  const { score, dmgMult, takenMult, mitigation } = loadoutPowerScore(items);
  const power = expectedPower(floor);
  const maxScore = TDC.validators.loadoutScoreAt1
    + (TDC.validators.loadoutScoreAt51 - TDC.validators.loadoutScoreAt1)
      * ((Math.min(TDC.lastFloor, floor) - 1) / (TDC.lastFloor - 1));
  const reasons = [];
  if (score > maxScore * TDC.validators.loadoutSlack) {
    reasons.push(`loadout score ${score.toFixed(1)} > cap ${maxScore.toFixed(1)}`);
  }
  if (dmgMult > TDC.validators.maxDmgMult) {
    reasons.push(`dmgMult ${dmgMult.toFixed(2)} > ${TDC.validators.maxDmgMult}`);
  }
  if (mitigation > TDC.player.mitigationCap) {
    reasons.push(`mitigation ${mitigation.toFixed(2)} > cap ${TDC.player.mitigationCap}`);
  }
  if (takenMult < 1 - TDC.player.mitigationCap) {
    reasons.push(`dmgTakenMult ${takenMult.toFixed(2)} below floor`);
  }
  return { ok: reasons.length === 0, reasons, score, dmgMult, takenMult, mitigation, maxScore };
}

/* ================================================================== */
/*  Player power estimation (for percentile curves)                    */
/* ================================================================== */

/**
 * Relative player power vs floor-1 baseline.
 * Uses the same weights as combat damage + a tankiness term.
 */
export function estimatePlayerPower({
  level = 1,
  str = 8, dex = 8, int = 8, wis = 8, lk = 8,
  atk = 2, def = 0, hp = 40,
  dmgMult = 1, dmgTakenMult = 1, crit = 5,
} = {}) {
  const C = CONFIG.combat;
  const best = Math.max(str, dex, int, wis);
  const hit = (best * C.playerStatWeight + atk * C.playerAtkWeight
    + Math.min(level, TDC.player.dmgSoftAfterLevel) * C.playerLevelWeight
    + C.playerFlat) * dmgMult * (1 + Math.min(0.25, crit / 400));
  const ehp = hp / Math.max(0.35, dmgTakenMult) + def * 3;
  // Blend offense/defense so P50 tracks expectedPower roughly.
  return (hit / TDC.benchmark.refHit) * 0.62 + (ehp / TDC.benchmark.refEhp) * 0.38;
}

/* ================================================================== */
/*  Boss RTK / HP-loss targets                                         */
/* ================================================================== */

export function bossFightTargets(floor) {
  const bm = floorBenchmark(floor);
  const override = TDC.bossTargets[floor];
  return {
    rounds: override?.rounds || bm.boss.rounds,
    hpLoss: override?.hpLoss || bm.boss.hpLoss,
  };
}

/** True if simulated rounds / hpLoss sit inside the boss band (with slack). */
export function bossWithinBand(floor, { rounds, hpLossPct }) {
  const t = bossFightTargets(floor);
  const [rLo, rHi] = t.rounds;
  const [hLo, hHi] = t.hpLoss;
  const slack = TDC.validators.bossBandSlack;
  return rounds >= rLo * (1 - slack) && rounds <= rHi * (1 + slack)
    && hpLossPct >= hLo * (1 - slack) && hpLossPct <= hHi * (1 + slack);
}

/* ================================================================== */
/*  History-aware event weighting                                      */
/* ================================================================== */

/**
 * Soft-penalize categories that dominated recent draws so the climb
 * doesn't string three merchants or four combat fillers in a row.
 */
export function historyCategoryWeight(category, recentCategories = []) {
  if (!category || !recentCategories.length) return 1;
  const window = recentCategories.slice(-TDC.events.historyWindow);
  const count = window.filter(c => c === category).length;
  if (count >= 3) return TDC.events.historyHeavyPenalty;
  if (count === 2) return TDC.events.historyMediumPenalty;
  if (window[window.length - 1] === category) return TDC.events.historyRepeatPenalty;
  return 1;
}

export function pushEventHistory(state, category) {
  if (!state) return;
  if (!Array.isArray(state.recentCategories)) state.recentCategories = [];
  state.recentCategories.push(category);
  if (state.recentCategories.length > TDC.events.historyWindow * 2) {
    state.recentCategories = state.recentCategories.slice(-TDC.events.historyWindow);
  }
}
