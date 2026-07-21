// Pure combat math — no DOM, no audio. Shared by the combat engine and the
// developer simulations in tools/ (handoff §34).

import { CONFIG } from './data/config.js';

/* ---------------- initiative (handoff §14) ---------------- */
// entity: { spdStat, mod = 0, isPlayer, floor }
export function rollInitiative(rng, entity, floor) {
  let v = entity.spdStat + rng.int(1, CONFIG.initiative.die) + (entity.mod || 0);
  if (entity.isPlayer && floor <= CONFIG.initiative.beginnerFloors) {
    v += CONFIG.initiative.beginnerPlayerBonus;
  }
  return v;
}

// Sort a list of combatant wrappers into turn order.
// Each entry: { key, spdStat, mod, isPlayer, stableId }
export function initiativeOrder(rng, entities, floor) {
  const rolled = entities.map(e => ({ ...e, init: rollInitiative(rng, e, floor) }));
  rolled.sort((a, b) => {
    if (b.init !== a.init) return b.init - a.init;
    // ties (handoff §14): higher base stat → beginner player preference → roll → stable id
    if (b.spdStat !== a.spdStat) return b.spdStat - a.spdStat;
    if (floor <= CONFIG.initiative.beginnerFloors && a.isPlayer !== b.isPlayer) {
      return a.isPlayer ? -1 : 1;
    }
    const r = rng.int(0, 1);
    if (r === 0) return a.stableId < b.stableId ? -1 : 1;
    return String(a.stableId) < String(b.stableId) ? -1 : 1;
  });
  return rolled;
}

/* ---------------- Battle Charge (handoff §11) ---------------- */
export function chargeMax() { return CONFIG.charge.max; }

export function addCharge(current, amount, mult = 1) {
  return Math.max(0, Math.min(CONFIG.charge.max, current + Math.round(amount * mult)));
}

/** Apply fractional per-turn charge rates (biome TDC multipliers). */
export function tickEnemyCharge(enemy, mod = 1) {
  const rate = (enemy.chargeGain || 1) * mod;
  enemy._chargeFrac = (enemy._chargeFrac || 0) + rate;
  const gained = Math.floor(enemy._chargeFrac);
  enemy._chargeFrac -= gained;
  if (gained <= 0) return enemy.charge || 0;
  enemy.charge = addCharge(enemy.charge || 0, gained);
  return enemy.charge;
}

export function canAfford(skill, mp, charge) {
  return mp >= (skill.cost || 0) && charge >= (skill.charge || 0);
}

/**
 * Effective offensive power for a skill.
 * Authored `power` alone under-rewards high cost/charge spends vs cheap hits.
 * Under-tuned skills are lifted toward a spend expectation curve; already-strong
 * finishers (high authored power) are left alone.
 *
 * Spend units: cost/14 + charge  (bread-and-butter ≈ 14 cost + 1⚡ → 2.0)
 */
export function skillEffectivePower(sk) {
  const power = sk?.power;
  if (power == null || power <= 0) return power || 0;
  const cost = sk.cost || 0;
  const charge = sk.charge || 0;
  const spend = cost / 14 + charge;
  let expected = 100 + 16 * spend + 1.4 * spend * spend;
  if (sk.target === 'all') expected *= 0.66;
  if (power >= expected) return power;
  // Close more of the gap on heavy spends so ultimates clearly beat mid skills.
  const close = spend >= 5 ? 0.95 : spend >= 3 ? 0.80 : 0.55;
  return Math.round(power + (expected - power) * close);
}

/**
 * Enemy special selection: highest affordable special.
 * Bosses (and `bankCharge` elites) may return null to bank toward a heavier
 * special when close — so finishers at 5–6 actually fire instead of forever
 * dumping charge on the lightest threshold.
 *
 * @param {object} enemy
 * @param {{ chance: (p: number) => boolean } | null} [rng]  required for banking
 */
export function pickEnemySpecial(enemy, rng = null) {
  if (!enemy.specials?.length) return null;
  const charge = enemy.charge || 0;
  const affordable = enemy.specials.filter(s => charge >= s.at);
  if (!affordable.length) return null;
  const best = affordable.reduce((a, b) => (b.at > a.at ? b : a));
  const maxAt = enemy.specials.reduce((m, s) => Math.max(m, s.at || 0), 0);
  const next = enemy.specials.filter(s => s.at > charge).sort((a, b) => a.at - b.at)[0];
  const canBank = !!(enemy.boss || enemy.bankCharge);
  if (canBank && next && best.at < maxAt && rng && typeof rng.chance === 'function') {
    const gap = next.at - charge;
    const base = enemy.bankChance ?? CONFIG.boss?.bankChance ?? 0.55;
    // Strong urge when one segment from a heavier move; softer at gap 2–3.
    let p = 0;
    if (gap === 1) p = base;
    else if (gap === 2) p = base * 0.8;
    else if (gap === 3) p = base * 0.4;
    if (p > 0 && rng.chance(p)) return null;
  }
  return best;
}

// Is a dangerous enemy move one segment away (or ready)? → telegraph.
// Bosses telegraph the heavier upcoming special when they are banking toward it.
export function enemyTelegraph(enemy) {
  if (!enemy.specials?.length) return null;
  const c = enemy.charge || 0;
  const maxAt = enemy.specials.reduce((m, s) => Math.max(m, s.at || 0), 0);
  const canBank = !!(enemy.boss || enemy.bankCharge);
  if (canBank) {
    // Prefer the heaviest special within 2 segments (what the boss is saving for).
    const heavy = enemy.specials
      .filter(s => s.at - c <= 2 && s.at >= Math.max(c, maxAt - 2))
      .sort((a, b) => b.at - a.at)[0];
    if (heavy) {
      return { ready: c >= heavy.at, name: heavy.name, desc: heavy.desc, aoe: !!heavy.aoe };
    }
  }
  const next = enemy.specials.filter(s => s.at - c <= 1).sort((a, b) => b.at - a.at)[0];
  if (!next) return null;
  return { ready: c >= next.at, name: next.name, desc: next.desc, aoe: !!next.aoe };
}

/* ---------------- Guard (handoff §10) ---------------- */
export function guardReduction() { return CONFIG.guard.blockPct; }

export function applyGuard(dmg, guarding, pierces = false) {
  if (!guarding || pierces) return dmg;
  return Math.max(1, Math.round(dmg * (1 - CONFIG.guard.blockPct)));
}

/**
 * Apply defense with diminishing returns.
 * mitigation = cap * def / (def + k) — early DEF matters a lot; stacking softens.
 */
export function applyDefense(rawDmg, def, { ignoreDef = false } = {}) {
  const raw = Number(rawDmg) || 0;
  if (ignoreDef || raw <= 0) return Math.max(1, Math.round(raw));
  const d = Math.max(0, Number(def) || 0);
  if (d <= 0) return Math.max(1, Math.round(raw));
  const k = CONFIG.combat.defMitigationK ?? 12;
  const cap = CONFIG.combat.defMitigationCap ?? 0.85;
  const mit = cap * (d / (d + k));
  return Math.max(1, Math.round(raw * (1 - mit)));
}
