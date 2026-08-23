// Shared autoplay combat decision. Fight.autoPlayAct and V2 baseline both call this.
// Returns an applyAction-shaped object. Does not mutate combat state.

import { SKILLS } from './data/skills.js';
import { CONSUMABLES } from './data/items.js';
import { usableSkillIds } from './character.js';
import { canAfford, skillEffectivePower, enemyTelegraph } from './systems.js';

export function chooseAutoPlayAction(f) {
  const run = f.run;
  const hpRatio = run.hp / Math.max(1, run.maxHp);
  if (hpRatio < 0.35) {
    const healId = (run.consumables || []).find(id => {
      const c = CONSUMABLES.find(x => x.id === id);
      return c && (c.heal || c.healPct);
    });
    if (healId) return { type: 'useConsumable', itemId: healId };
  }

  const costMult = f.mod?.costMult || 1;
  const usable = usableSkillIds(run);
  const afford = sk => canAfford(
    { cost: Math.ceil((sk.cost || 0) * costMult), charge: sk.charge || 0 },
    run.mp, f.charge,
  );

  if (hpRatio < 0.4) {
    const healSk = ['basic_attack', ...run.skills]
      .map(id => SKILLS[id])
      .find(sk => sk && usable.includes(sk.id) && sk.healPct && !sk.allyTarget && afford(sk));
    if (healSk) return { type: 'useSkill', skillId: healSk.id };
  }

  const threatened = (f.aliveEnemies?.() || f.enemies.filter(e => e.hp > 0)).some(e => {
    const t = enemyTelegraph(e);
    return t && t.ready;
  });
  if (threatened && hpRatio < 0.55 && usable.includes('guard') && afford(SKILLS.guard)) {
    return { type: 'useSkill', skillId: 'guard' };
  }

  const pool = ['basic_attack', ...run.skills]
    .map(id => SKILLS[id])
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
