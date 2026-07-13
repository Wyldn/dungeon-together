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

// Enemy special selection: highest special the enemy can afford, else null.
export function pickEnemySpecial(enemy) {
  if (!enemy.specials) return null;
  const affordable = enemy.specials.filter(s => (enemy.charge || 0) >= s.at);
  if (!affordable.length) return null;
  return affordable.reduce((best, s) => (s.at > best.at ? s : best), affordable[0]);
}

// Is a dangerous enemy move one segment away (or ready)? → telegraph.
export function enemyTelegraph(enemy) {
  if (!enemy.specials) return null;
  const c = enemy.charge || 0;
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
