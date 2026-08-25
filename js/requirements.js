import { CLASSES } from './data/classes.js';
import { derived } from './character.js';
import { hasEligibleOffering } from './offering.js';
import { packGet } from './content_pack/state.js';

const STAT_WHY = {
  str: 'strength', dex: 'deftness', int: 'learning', wis: 'insight', lk: 'fortune',
};

/** Live requirement check (knowledge + sigil included). */
export function reqMet(run, req, ctx = {}) {
  if (!req) return { ok: true };
  const d = derived(run);
  const party = ctx.party || [];
  const scope = req.identityScope || ctx.identityScope || 'actor';
  const classIds = scope === 'any' || scope === 'party'
    ? [run.classId, ...party.map(p => p.classId)].filter(Boolean)
    : [run.classId];
  const raceIds = scope === 'any' || scope === 'party'
    ? [run.raceId, ...party.map(p => p.raceId)].filter(Boolean)
    : [run.raceId];
  if (req.stat && d[req.stat] < req.min) {
    return { ok: false, why: 'you lack the ' + (STAT_WHY[req.stat] || 'gift') };
  }
  if (req.class && !classIds.includes(req.class)) {
    return { ok: false, why: `${CLASSES[req.class]?.name || req.class} only` };
  }
  if (req.race && !raceIds.includes(req.race)) {
    return { ok: false, why: `${req.race} bloodline only` };
  }
  if (req.gold && run.gold < req.gold) return { ok: false, why: `${req.gold}g needed` };
  const fame = (run.fame || 0)
    + (run.flags?.fameBoost ? 3 : 0)
    + (run.flags?.counterfeitHalo ? 2 : 0)
    + (packGet(run, 'floor', 'stamp') ? 4 : 0);
  if (req.fame && fame < req.fame) return { ok: false, why: 'your name is not yet known' };
  if (req.flag && !run.flags[req.flag]) return { ok: false, why: '???' };
  if (req.notFlag && run.flags[req.notFlag]) return { ok: false, why: 'unavailable' };
  if (req.sigil && !(run.sigils || []).includes(req.sigil)) return { ok: false, why: '???' };
  if (req.knowledge && !(run.world?.knowledge || []).includes(req.knowledge)) return { ok: false, why: '???' };
  if (req.item && !run.consumables.includes(req.item)) return { ok: false, why: 'item needed' };
  if (req.offering && !hasEligibleOffering(run, req.offering === true ? {} : req.offering)) {
    return { ok: false, why: 'nothing suitable to offer' };
  }
  return { ok: true };
}
