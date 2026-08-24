// Measurement-only: baseline routing, but knowingly take gallery NPC duels.
// Live autoplay and default climb policies are unchanged.

import { reqMet } from '../../js/requirements.js';
import { isGalleryNpc } from '../../js/data/enemies.js';
import { baselinePolicy } from './baseline.js';

function galleryMeet(ev) {
  const id = String(ev?.id || '').replace(/_meet$/, '');
  const art = ev?.npc?.art || ev?.npc?.id;
  return isGalleryNpc(id) || isGalleryNpc(art);
}

export function duelistPolicy(opts = {}) {
  const minHp = opts.minHp ?? 0.40;
  const base = baselinePolicy();
  return {
    ...base,
    name: 'duelist',
    chooseEvent(run, ev, choices) {
      const ok = choices.filter(c => reqMet(run, c.req).ok);
      const pool = ok.length ? ok : choices;
      if (galleryMeet(ev) && run.hp / Math.max(1, run.maxHp) >= minHp) {
        const duel = pool.find(c => /accept the duel/i.test(c.label || ''));
        if (duel) return duel;
      }
      return base.chooseEvent(run, ev, pool);
    },
    ...opts,
  };
}
