// Gold earn/spend ledger and heal-consumable helpers.
// Gameplay code should go through earnGold / spendGold so climb reports
// can split sources and sinks. Derived spent (start + earned - held) remains
// valid even on older saves that never recorded goldSpent.

import { CONSUMABLES, itemById } from './data/items.js';
import { SKILLS } from './data/skills.js';
import { CLASSES } from './data/classes.js';

export const START_GOLD = 30;

export const HEAL_CONSUMABLE_IDS = new Set(
  CONSUMABLES.filter(c => c && (c.heal || c.healPct)).map(c => c.id),
);

export function isHealConsumableId(id) {
  if (!id) return false;
  if (HEAL_CONSUMABLE_IDS.has(id)) return true;
  const c = itemById(id);
  return !!(c && (c.heal || c.healPct));
}

export function healConsumableCount(run) {
  return (run?.consumables || []).filter(isHealConsumableId).length;
}

export function potionIdCount(run) {
  return (run?.consumables || []).filter(id => id === 'potion_s' || id === 'potion_l').length;
}

export function startGoldFor(run) {
  const fortune = run?.metaStartFortune ?? 0;
  return START_GOLD + fortune * 25;
}

export function derivedGoldSpent(run, startGold = null) {
  const start = startGold != null ? startGold : startGoldFor(run);
  return Math.max(0, start + (run.goldEarned || 0) - (run.gold || 0));
}

function bump(map, key, n) {
  if (!key || !n) return;
  map[key] = (map[key] || 0) + n;
}

export function earnGold(run, amt, reason = 'other') {
  const n = Math.max(0, Math.round(Number(amt) || 0));
  if (!n || !run) return 0;
  run.gold = (run.gold || 0) + n;
  run.goldEarned = (run.goldEarned || 0) + n;
  run.goldEarnedBy = run.goldEarnedBy || {};
  bump(run.goldEarnedBy, reason, n);
  return n;
}

export function spendGold(run, amt, reason = 'other') {
  const n = Math.max(0, Math.round(Number(amt) || 0));
  if (!n || !run) return 0;
  const paid = Math.min(n, Math.max(0, run.gold || 0));
  run.gold = Math.max(0, (run.gold || 0) - paid);
  run.goldSpent = (run.goldSpent || 0) + paid;
  run.goldSpentBy = run.goldSpentBy || {};
  bump(run.goldSpentBy, reason, paid);
  return paid;
}

/** Apply a signed gold delta. Positive earns (with goldMult already applied by caller). */
export function applyGoldDelta(run, amt, { earnReason = 'event', spendReason = 'event' } = {}) {
  const n = Math.round(Number(amt) || 0);
  if (n > 0) return earnGold(run, n, earnReason);
  if (n < 0) return -spendGold(run, -n, spendReason);
  return 0;
}

/** Classes whose starting kit includes a combat heal (lower potion pressure). */
export function classHasStartHeal(classId) {
  const cls = CLASSES[classId];
  if (!cls?.startSkills) return false;
  return cls.startSkills.some(id => {
    const sk = SKILLS[id];
    return !!(sk && (sk.healPct || sk.heal));
  });
}

export function economySnapshot(run) {
  const heal = healConsumableCount(run);
  return {
    gold: run.gold || 0,
    goldEarned: run.goldEarned || 0,
    goldSpent: run.goldSpent || derivedGoldSpent(run),
    goldEarnedBy: { ...(run.goldEarnedBy || {}) },
    goldSpentBy: { ...(run.goldSpentBy || {}) },
    healConsumables: heal,
    potions: potionIdCount(run),
    consumables: (run.consumables || []).length,
  };
}
