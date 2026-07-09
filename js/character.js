// Derived stats, leveling, evolutions, inventory helpers.

import { CLASSES } from './data/classes.js';
import { itemById, RELICS } from './data/items.js';
import { SKILLS } from './data/skills.js';

export function equippedItems(run) {
  return ['weapon', 'armor', 'accessory']
    .map(slot => run.equipment[slot] && itemById(run.equipment[slot]))
    .filter(Boolean);
}

export function relicItems(run) {
  return run.relics.map(id => RELICS.find(r => r.id === id)).filter(Boolean);
}

// Sum a numeric property across equipment + relics.
function gearSum(run, prop) {
  let sum = 0;
  for (const it of [...equippedItems(run), ...relicItems(run)]) sum += it[prop] || 0;
  return sum;
}
function gearMult(run, prop) {
  let m = 1;
  for (const it of [...equippedItems(run), ...relicItems(run)]) if (it[prop]) m *= it[prop];
  return m;
}
export function gearHas(run, prop) {
  return [...equippedItems(run), ...relicItems(run)].some(it => it[prop]);
}

export function derived(run) {
  const s = run.stats;
  const weapon = run.equipment.weapon ? itemById(run.equipment.weapon) : null;
  return {
    str: s.str + gearSum(run, 'str'),
    dex: s.dex + gearSum(run, 'dex'),
    int: s.int + gearSum(run, 'int'),
    wis: s.wis + gearSum(run, 'wis'),
    lk: s.lk + gearSum(run, 'lk'),
    atk: (weapon ? weapon.atk : 0) + run.weaponBonus,
    def: gearSum(run, 'def'),
    crit: 5 + s.dex * 0.35 + s.lk * 0.5 + gearSum(run, 'crit'),
    dodge: Math.min(35, 3 + s.dex * 0.45 + gearSum(run, 'dodge')),
    lifesteal: gearSum(run, 'lifesteal'),
    goldMult: gearMult(run, 'goldMult'),
    combatGoldMult: gearMult(run, 'combatGoldMult'),
    xpMult: gearMult(run, 'xpMult'),
    dmgMult: gearMult(run, 'dmgMult'),
    dmgTakenMult: gearMult(run, 'dmgTakenMult'),
    bossDmgMult: gearMult(run, 'bossDmgMult'),
    sanityGuard: gearSum(run, 'sanityGuard'),
    enemyCrit: 4 + gearSum(run, 'enemyCrit'),
    burn: gearSum(run, 'burn'),
    freeze: gearSum(run, 'freeze'),
    manaRegen: 4 + Math.floor(run.stats.wis / 6) + gearSum(run, 'manaRegen'),
  };
}

export function classTitle(run) {
  const cls = CLASSES[run.classId];
  let title = cls.name;
  for (const evo of cls.evolutions) if (run.level >= evo.level) title = evo.name;
  return title;
}

export function skillTier(run) {
  const cls = CLASSES[run.classId];
  let tier = 1;
  cls.evolutions.forEach((evo, i) => { if (run.level >= evo.level) tier = i + 2; });
  return tier;
}

export function xpForLevel(level) {
  return Math.floor(40 * Math.pow(1.32, level - 1));
}

// Returns array of level-up records: {level, gains, evolution?}
export function gainXp(run, amount, rng) {
  run.xp += amount;
  const ups = [];
  while (run.xp >= run.xpNext) {
    run.xp -= run.xpNext;
    run.level++;
    run.xpNext = xpForLevel(run.level);
    const cls = CLASSES[run.classId];
    const gains = { hp: 6 + rng.int(0, 4), mp: 3 + rng.int(0, 2) };
    // two random stat points, biased toward class strengths
    const bias = { warrior: ['str', 'str', 'dex', 'wis'], mage: ['int', 'int', 'wis', 'lk'],
                   archer: ['dex', 'dex', 'lk', 'str'], rogue: ['dex', 'lk', 'lk', 'str'] }[run.classId];
    for (let i = 0; i < 2; i++) {
      const st = rng.chance(0.6) ? rng.pick(bias) : rng.pick(['str', 'dex', 'int', 'wis', 'lk']);
      run.stats[st]++;
      gains[st] = (gains[st] || 0) + 1;
    }
    run.maxHp += gains.hp; run.hp = Math.min(run.maxHp, run.hp + gains.hp);
    run.maxMp += gains.mp; run.mp = Math.min(run.maxMp, run.mp + gains.mp);
    const evolution = cls.evolutions.find(e => e.level === run.level);
    if (evolution) {
      for (const [k, v] of Object.entries(evolution.bonus)) {
        if (k === 'hp') { run.maxHp += v; run.hp += v; }
        else if (k === 'mp') { run.maxMp += v; run.mp += v; }
        else run.stats[k] += v;
      }
      run.className = evolution.name;
    }
    ups.push({ level: run.level, gains, evolution });
  }
  return ups;
}

// Skills the player could learn right now (new tier unlocks + unlearned).
export function learnableSkills(run) {
  const tier = skillTier(run);
  return Object.values(SKILLS).filter(sk =>
    sk.class === run.classId && (sk.tier || 1) <= tier && !run.knownSkills.includes(sk.id));
}

export function changeSanity(run, delta) {
  if (delta < 0) {
    const d = derived(run);
    delta = Math.min(0, delta + d.sanityGuard);
  }
  run.sanity = Math.max(0, Math.min(run.maxSanity + relicMaxSanity(run), run.sanity + delta));
  return delta;
}

export function relicMaxSanity(run) {
  return relicItems(run).reduce((s, r) => s + (r.maxSanity || 0), 0);
}

export function heal(run, amount) {
  const before = run.hp;
  run.hp = Math.min(run.maxHp, run.hp + Math.round(amount));
  return run.hp - before;
}

export function restoreMana(run, amount) {
  const before = run.mp;
  run.mp = Math.min(run.maxMp, run.mp + Math.round(amount));
  return run.mp - before;
}
