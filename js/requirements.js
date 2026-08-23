import { CLASSES } from './data/classes.js';
import { derived } from './character.js';

const STAT_WHY = {
  str: 'strength', dex: 'deftness', int: 'learning', wis: 'insight', lk: 'fortune',
};

/** Live requirement check (knowledge + sigil included). */
export function reqMet(run, req) {
  if (!req) return { ok: true };
  const d = derived(run);
  if (req.stat && d[req.stat] < req.min) {
    return { ok: false, why: 'you lack the ' + (STAT_WHY[req.stat] || 'gift') };
  }
  if (req.class && run.classId !== req.class) {
    return { ok: false, why: `${CLASSES[req.class].name} only` };
  }
  if (req.gold && run.gold < req.gold) return { ok: false, why: `${req.gold}g needed` };
  if (req.fame && run.fame < req.fame) return { ok: false, why: 'your name is not yet known' };
  if (req.flag && !run.flags[req.flag]) return { ok: false, why: '???' };
  if (req.notFlag && run.flags[req.notFlag]) return { ok: false, why: 'unavailable' };
  if (req.sigil && !(run.sigils || []).includes(req.sigil)) return { ok: false, why: '???' };
  if (req.knowledge && !(run.world?.knowledge || []).includes(req.knowledge)) return { ok: false, why: '???' };
  if (req.item && !run.consumables.includes(req.item)) return { ok: false, why: 'item needed' };
  return { ok: true };
}
