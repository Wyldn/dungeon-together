// Headless consumer of the live combat core. No DOM, audio, or timers.
// Replays scripted actions or a policy through js/combat_core.js.
// This is not tools/combat_sim.js (legacy climb approximation).

import {
  createCombatContext, applyAction, stepSolo, snapshotCombat,
  applyCombatStartMana, finishHeadlessSolo,
} from '../js/combat_core.js';
import { computeCombatPayout } from '../js/rewards.js';

function attachMeasure(f) {
  if (!f.measure) {
    f.measure = {
      damageDealt: 0, damageTaken: 0, healed: 0, lifesteal: 0,
      shields: 0, revives: 0, deathwards: 0, packWards: 0,
      skillUses: {}, consumableUses: {},
      mpStarve: 0, mpOverflow: 0, chargeStarve: 0, cdBlocked: 0, cdActive: 0,
      effectOps: {}, effectCaps: {},
    };
  }
  const prevDealt = f._dealt;
  const prevTaken = f._taken;
  const prevHealed = f._healed;
  f._dealt = (n) => {
    f.measure.damageDealt += Math.round(n) || 0;
    prevDealt?.(n);
  };
  f._taken = (n) => {
    f.measure.damageTaken += Math.round(n) || 0;
    prevTaken?.(n);
  };
  f._healed = (n) => {
    f.measure.healed += Math.round(n) || 0;
    prevHealed?.(n);
  };
  if (f.run?._cpMeasure?.effectOps && !f.measure.effectOps) {
    f.measure.effectOps = f.run._cpMeasure.effectOps;
    f.measure.effectCaps = f.run._cpMeasure.effectCaps;
  }
  return f;
}

function wrapPolicy(f, policy) {
  return async (fight) => {
    const mp = fight.run.mp || 0;
    const maxMp = fight.run.maxMp || 0;
    if (maxMp > 0 && mp <= 0) fight.measure.mpStarve += 1;
    if (maxMp > 0 && mp >= maxMp) fight.measure.mpOverflow += 1;
    const cds = fight.skillCDs || {};
    for (const v of Object.values(cds)) {
      if ((v || 0) > 0) fight.measure.cdActive += 1;
    }
    if ((fight.charge || 0) <= 0) fight.measure.chargeStarve += 1;
    const action = await policy(fight);
    if (!action) return action;
    if (action.type === 'useSkill' || action.type === 'hitEnemy') {
      const id = action.skillId || 'unknown';
      fight.measure.skillUses[id] = (fight.measure.skillUses[id] || 0) + 1;
      if ((cds[id] || 0) > 0) fight.measure.cdBlocked += 1;
    }
    if (action.type === 'useConsumable') {
      const id = action.itemId || 'unknown';
      fight.measure.consumableUses[id] = (fight.measure.consumableUses[id] || 0) + 1;
    }
    return action;
  };
}

export async function runHeadlessFight({
  run, rng, enemies, modifier = null, actions = null, policy = null,
  faithful = false, resume = false,
} = {}) {
  if (faithful) applyCombatStartMana(run, { resume });
  const f = attachMeasure(createCombatContext(run, rng, enemies, modifier));
  if (run?._cpMeasure) {
    f.measure.effectOps = run._cpMeasure.effectOps || (run._cpMeasure.effectOps = {});
    f.measure.effectCaps = run._cpMeasure.effectCaps || (run._cpMeasure.effectCaps = {});
  }
  if (actions) {
    for (const action of actions) await applyAction(f, action);
    const snap = snapshotCombat(f);
    snap.measure = f.measure;
    return snap;
  }
  if (policy) {
    const snap = await stepSolo(f, wrapPolicy(f, policy));
    snap.measure = f.measure;
    if (!faithful) return snap;
    let gold = 0, xp = 0;
    if (f._outcome === 'win') {
      const pay = computeCombatPayout(run, rng, enemies, modifier || {});
      gold = pay.gold;
      xp = pay.xp;
    }
    const extra = finishHeadlessSolo(f, f._outcome || 'ongoing', { gold, xp });
    return { ...snap, ...extra, measure: f.measure };
  }
  const snap = snapshotCombat(f);
  snap.measure = f.measure;
  return snap;
}

export { createCombatContext, applyAction, stepSolo, snapshotCombat };
