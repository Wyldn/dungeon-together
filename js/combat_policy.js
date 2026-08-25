// Shared autoplay combat decision. Fight.autoPlayAct and V2 baseline both call this.
// Returns an applyAction-shaped object. Does not mutate combat state.
//
// Targeting: live combat applies self effects iff `sk.target === 'self'`
// (combat.js / combat_core applySelfSkill). `allyTarget` is a co-op overlay
// that also allows aiming the same skill at a living companion. Autoplay
// must not treat `allyTarget` as "cannot heal self".

import { SKILLS, skillById } from './data/skills.js';
import { CONSUMABLES } from './data/items.js';
import { usableSkillIds } from './character.js';
import { skillEffectivePower, enemyTelegraph, skillEligibility } from './systems.js';

/** Canonical: can this skill legally apply its heal to the acting player? */
export function skillCanHealSelf(sk) {
  return !!(sk && sk.healPct && sk.target === 'self');
}

/** Canonical: can this skill legally apply its heal to a living companion? */
export function skillCanHealAlly(sk) {
  return !!(sk && sk.healPct && sk.allyTarget);
}

function hpRatioOf(hp, maxHp) {
  return hp / Math.max(1, maxHp);
}

function livingAllyEntries(f) {
  const allies = f?.allies;
  if (!allies) return [];
  const entries = typeof allies.entries === 'function'
    ? [...allies.entries()]
    : Object.entries(allies);
  return entries.filter(([, a]) => a && !a.down && (a.hp ?? 0) > 0);
}

/** Lowest-HP legal living target. Tie-break is stable (self, then seat id). */
export function pickAutoplayHealTo(f, sk) {
  if (!skillCanHealAlly(sk) || !f?.shared) return 'self';
  const selfRatio = hpRatioOf(f.run.hp, f.run.maxHp);
  let best = { id: 'self', hpRatio: selfRatio, tie: '' };
  for (const [id, a] of livingAllyEntries(f)) {
    const hpRatio = hpRatioOf(a.hp, a.maxHp || a.hp);
    const row = { id, hpRatio, tie: String(id) };
    if (row.hpRatio < best.hpRatio
      || (row.hpRatio === best.hpRatio && row.tie < best.tie)) {
      best = row;
    }
  }
  return best.id;
}

export function chooseAutoPlayAction(f) {
  const run = f.run;
  const hpRatio = hpRatioOf(run.hp, run.maxHp);
  if (hpRatio < 0.35) {
    const healId = (run.consumables || []).find(id => {
      const c = CONSUMABLES.find(x => x.id === id);
      return c && (c.heal || c.healPct);
    });
    if (healId) return { type: 'useConsumable', itemId: healId };
  }

  const costMult = f.mod?.costMult || 1;
  const usable = usableSkillIds(run);
  const afford = sk => skillEligibility(sk, {
    mp: run.mp,
    charge: f.charge,
    cds: f.skillCDs,
    hasTarget: (f.aliveEnemies?.() || f.enemies.filter(e => e.hp > 0)).length > 0 || sk.target !== 'one',
    usable: true,
    stanceLocked: sk.id === 'guard' && !!f.player?.ironStance,
    cost: Math.ceil((sk.cost || 0) * costMult),
  }).ok;

  if (hpRatio < 0.4) {
    const healSk = ['basic_attack', ...run.skills]
      .map(id => skillById(id) || SKILLS[id])
      .find(sk => sk && usable.includes(sk.id) && skillCanHealSelf(sk) && afford(sk));
    if (healSk) {
      return { type: 'useSkill', skillId: healSk.id, healTo: pickAutoplayHealTo(f, healSk) };
    }
  }

  const threatened = (f.aliveEnemies?.() || f.enemies.filter(e => e.hp > 0)).some(e => {
    const t = enemyTelegraph(e);
    return t && t.ready;
  });
  if (threatened && hpRatio < 0.55 && usable.includes('guard') && afford(SKILLS.guard)) {
    return { type: 'useSkill', skillId: 'guard' };
  }

  const pool = ['basic_attack', ...run.skills]
    .map(id => skillById(id) || SKILLS[id])
    .filter(sk => sk && usable.includes(sk.id) && !sk.allyTarget && sk.id !== 'guard')
    .filter(afford)
    .sort((a, b) => skillEffectivePower(b) - skillEffectivePower(a) || (b.charge || 0) - (a.charge || 0));
  const sk = pool[0] || SKILLS.basic_attack;

  let best = -1;
  const enemies = f.enemies || [];
  for (let i = 0; i < enemies.length; i++) {
    if (enemies[i].hp <= 0) continue;
    if (best < 0 || enemies[i].hp < enemies[best].hp) best = i;
  }
  return { type: 'useSkill', skillId: sk.id, enemy: best >= 0 ? best : 0 };
}
