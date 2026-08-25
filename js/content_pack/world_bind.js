// Out-of-combat pack hooks. Outcomes, shop, floor, and rest all call here.
// No item/skill ID conditionals — catalogs declare onEventResolve / onShopAction /
// onCampfire / onFloorStart / onBiomeEnter.

import { isPackOn } from './flags.js';
import { dispatchEffects } from './engine.js';
import { cleanupAfterFloor, cleanupAfterBiome } from './state.js';

export function packOnEventResolve(run, ev, outcome, rng) {
  if (!isPackOn() || !run) return {};
  const acc = dispatchEffects(run, 'onEventResolve', { rng, outcome, event: ev });
  if (ev?.id === 'campfire' || ev?.type === 'rest') {
    const rest = dispatchEffects(run, 'onCampfire', { rng, outcome, event: ev });
    mergeAcc(acc, rest);
  }
  return acc;
}

export function packOnShopAction(run, kind = 'buy', extra = {}) {
  if (!isPackOn() || !run) return {};
  return dispatchEffects(run, 'onShopAction', { shopKind: kind, price: extra.price });
}

export function packOnFloorAdvance(run, { prevBiome } = {}) {
  if (!run) return;
  cleanupAfterFloor(run);
  if (prevBiome && prevBiome !== run.biomeId) cleanupAfterBiome(run);
  if (!isPackOn()) return;
  dispatchEffects(run, 'onFloorStart', {});
  if (prevBiome && prevBiome !== run.biomeId) dispatchEffects(run, 'onBiomeEnter', {});
}

function mergeAcc(into, extra) {
  if (!extra) return into;
  into.dmgMult = (into.dmgMult || 1) * (extra.dmgMult || 1);
  into.inMult = (into.inMult || 1) * (extra.inMult || 1);
  into.dmgAdd = (into.dmgAdd || 0) + (extra.dmgAdd || 0);
  return into;
}
