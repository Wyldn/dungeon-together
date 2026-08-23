// Headless consumer of the live combat core. No DOM, audio, or timers.
// Replays scripted actions or a policy through js/combat_core.js.
// This is not tools/combat_sim.js (legacy climb approximation).

import {
  createCombatContext, applyAction, stepSolo, snapshotCombat,
  applyCombatStartMana, finishHeadlessSolo,
} from '../js/combat_core.js';
import { computeCombatPayout } from '../js/rewards.js';

export async function runHeadlessFight({
  run, rng, enemies, modifier = null, actions = null, policy = null,
  faithful = false, resume = false,
} = {}) {
  if (faithful) applyCombatStartMana(run, { resume });
  const f = createCombatContext(run, rng, enemies, modifier);
  if (actions) {
    for (const action of actions) await applyAction(f, action);
    return snapshotCombat(f);
  }
  if (policy) {
    const snap = await stepSolo(f, policy);
    if (!faithful) return snap;
    let gold = 0, xp = 0;
    if (f._outcome === 'win') {
      const pay = computeCombatPayout(run, rng, enemies, modifier || {});
      gold = pay.gold;
      xp = pay.xp;
    }
    const extra = finishHeadlessSolo(f, f._outcome || 'ongoing', { gold, xp });
    return { ...snap, ...extra };
  }
  return snapshotCombat(f);
}

export { createCombatContext, applyAction, stepSolo, snapshotCombat };
