// Derived stats, leveling, growth, subclasses, appraisal, fame, inventory.

import { CLASSES, SUBCLASSES, EVOLUTION_LEVELS, subclassOptions, deeperBranch } from './data/classes.js';
import { RACES } from './data/races.js';
import { resolveItem, RELICS, EQUIP_SLOTS } from './data/items.js';
import { SKILLS } from './data/skills.js';
import { CONFIG } from './data/config.js';
import { rankFor, appraisalRange, growthMult } from './data/ranks.js';
import { cappedDmgTakenMult, softHpGain, resourceRegen } from './data/tdc.js';

export function equippedItems(run) {
  return EQUIP_SLOTS
    .map(slot => run.equipment[slot] && resolveItem(run, run.equipment[slot]))
    .filter(Boolean);
}

export function relicItems(run) {
  return run.relics.map(id => RELICS.find(r => r.id === id)).filter(Boolean);
}

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
// Largest value of a prop across gear+relics (for "best wins" effects like thorns).
function gearMaxNum(run, prop, base = 0) {
  let m = base;
  for (const it of [...equippedItems(run), ...relicItems(run)]) if (it[prop] != null) m = Math.max(m, it[prop]);
  return m;
}

// Techniques you can carry into battle: 4 base, + relic/gear slots, + boss breakpoints.
export function skillCapacity(run) {
  let n = 4 + gearSum(run, 'extraSkillSlots');
  for (const bp of CONFIG.skillBreakpoints || []) {
    if (run.flags?.[bp.flag] || (run.floor > bp.floor)) n += bp.slots;
  }
  return n;
}

/** Apply any newly earned skill-slot breakpoints (call after boss wins). Returns unlock messages. */
export function applySkillBreakpoints(run) {
  const msgs = [];
  for (const bp of CONFIG.skillBreakpoints || []) {
    if (run.floor < bp.floor) continue;
    if (run.flags?.[bp.flag]) continue;
    // Only grant when this boss floor was just cleared (or already past for old saves)
    if (run.floor === bp.floor || run.floor > bp.floor) {
      if (!run.flags) run.flags = {};
      run.flags[bp.flag] = true;
      msgs.push({
        text: `${bp.label} — your mind holds more. (+${bp.slots} technique slots; now ${skillCapacity(run)} into battle.)`,
        cls: 'good',
        slots: bp.slots,
      });
    }
  }
  return msgs;
}

/* ---------------- weapon compatibility (handoff §20) ---------------- */
export function allowedWeaponTypes(run) {
  const types = [...(CLASSES[run.classId]?.weapons || [])];
  // subclass grants (Spellblade exception)
  let sub = run.subclassId && SUBCLASSES[run.subclassId];
  while (sub) {
    if (sub.weaponAdd) types.push(...sub.weaponAdd);
    sub = sub.parent && SUBCLASSES[sub.parent];
  }
  return types;
}

export function weaponCompatible(run) {
  const w = run.equipment.weapon ? resolveItem(run, run.equipment.weapon) : null;
  if (!w) return true; // bare hands never disable anything
  return allowedWeaponTypes(run).includes(w.wtype);
}

// Skills currently usable: incompatible weapon leaves Strike + Guard only.
export function usableSkillIds(run) {
  if (!weaponCompatible(run)) return ['basic_attack', 'guard'];
  return ['basic_attack', 'guard', ...run.skills];
}

/* ---------------- derived stats ---------------- */
export function derived(run) {
  const s = run.stats;
  const race = RACES[run.raceId] || {};
  const weapon = run.equipment.weapon ? resolveItem(run, run.equipment.weapon) : null;
  return {
    str: s.str + gearSum(run, 'str'),
    dex: s.dex + gearSum(run, 'dex'),
    int: s.int + gearSum(run, 'int'),
    wis: s.wis + gearSum(run, 'wis'),
    lk: s.lk + gearSum(run, 'lk'),
    atk: (weapon ? weapon.atk : 0) + run.weaponBonus,
    def: gearSum(run, 'def') + (race.def || 0) + (run.raceDef || 0),
    crit: 5 + s.dex * 0.35 + s.lk * 0.5 + gearSum(run, 'crit') + (run.foodBuff?.crit || 0),
    dodge: Math.min(35, 3 + s.dex * 0.45 + gearSum(run, 'dodge') + (run.foodBuff?.dodge || 0)),
    lifesteal: gearSum(run, 'lifesteal'),
    goldMult: gearMult(run, 'goldMult') * (race.goldMult || 1),
    combatGoldMult: gearMult(run, 'combatGoldMult'),
    xpMult: gearMult(run, 'xpMult'),
    dmgMult: gearMult(run, 'dmgMult') * (run.foodBuff?.dmgMult || 1),
    dmgTakenMult: cappedDmgTakenMult(gearMult(run, 'dmgTakenMult') * (run.foodBuff?.dmgTakenMult || 1)),
    bossDmgMult: gearMult(run, 'bossDmgMult'),
    enemyCrit: 4 + gearSum(run, 'enemyCrit'),
    burn: gearSum(run, 'burn'),
    freeze: gearSum(run, 'freeze'),
    poison: gearSum(run, 'poison'),
    weaken: gearSum(run, 'weaken'),
    frail: gearSum(run, 'frail'),
    tormented: gearSum(run, 'tormented'),
    confused: gearSum(run, 'confused'),
    lazy: gearSum(run, 'lazy'),
    stun: gearSum(run, 'stun'),
    manaRegen: resourceRegen(run.stats.wis, gearSum(run, 'manaRegen') + (run.foodBuff?.manaRegen || 0)),
    initiative: (race.initiative || 0) + gearSum(run, 'initiative') + (run.foodBuff?.initiative || 0),
    fameGainMult: (race.fameGainMult || 1) * gearMult(run, 'fameGainMult'),
    startCharge: gearSum(run, 'startCharge'),
    poisonResist: race.poisonResist || 0,
    chargeOnHit: !!race.chargeOnHit,
    // wild relic effects (§15)
    doubleDmgRound: gearMaxNum(run, 'doubleDmgRound', 0),
    confuseChance: gearMaxNum(run, 'confuseChance', 0),
    echoChance: gearMaxNum(run, 'echoChance', 0),
    thorns: gearMaxNum(run, 'thorns', 0),
    lifestealCapMult: gearMaxNum(run, 'lifestealCapMult', 1),
  };
}

/* ---------------- hidden-stat reveal permissions (handoff §5) ---------- */
// 'exact' > 'ranks' > null. Sources: equipped items with reveal prop.
export function revealLevel(run) {
  let best = null;
  for (const it of equippedItems(run)) {
    if (it.reveal === 'exact') return 'exact';
    if (it.reveal === 'ranks') best = 'ranks';
  }
  return best;
}

/* ---------------- appraisal ---------------- */
export const APPRAISABLE = ['str', 'dex', 'int', 'wis', 'lk'];

export function appraiseRun(rng, run, { partial = false, location = 'the tower' } = {}) {
  const d = derived(run);
  const stats = partial ? rng.shuffle(APPRAISABLE).slice(0, 2) : APPRAISABLE;
  const results = {};
  for (const st of stats) results[st] = appraisalRange(rng, d[st]);
  const total = APPRAISABLE.reduce((s, k) => s + d[k], 0);
  run.appraisal = {
    floor: run.floor,
    level: run.level,
    location,
    partial,
    results,
    overall: rankFor(Math.round(total / APPRAISABLE.length * 1.6)),
  };
  return run.appraisal;
}

/* ---------------- fame ---------------- */
export function changeFame(run, amt) {
  if (amt > 0) amt = Math.round(amt * derived(run).fameGainMult);
  run.fame = Math.max(0, (run.fame || 0) + amt);
  return amt;
}

/* ---------------- class titles / advancement ---------------- */
export function classTitle(run) {
  if (run.subclassId) return SUBCLASSES[run.subclassId].name;
  return CLASSES[run.classId].name;
}

export function skillTier(run) {
  if (run.level >= EVOLUTION_LEVELS.second) return 3;
  if (run.level >= EVOLUTION_LEVELS.first) return 2;
  return 1;
}

export function xpForLevel(level) {
  return Math.floor(32 * Math.pow(1.22, level - 1));
}

export function applySubclass(run, sub) {
  run.subclassId = sub.id;
  run.className = sub.name;
  const b = sub.bonus || {};
  for (const k of ['str', 'dex', 'int', 'wis', 'lk']) if (b[k]) run.stats[k] += b[k];
  if (b.hp) { run.maxHp += b.hp; run.hp += b.hp; }
  if (b.mp) { run.maxMp += b.mp; run.mp += b.mp; }
  if (sub.skill && !run.knownSkills.includes(sub.skill)) run.knownSkills.push(sub.skill);
  return sub;
}

// Level up. Gains scale with the HIDDEN growth modifier. Returns records:
// {level, evolutionChoice?: [options], deeper?: subclass}
export function gainXp(run, amount, rng) {
  run.xp += amount;
  const ups = [];
  const gMult = growthMult(run.growthRank || 'C') * (run.growthBoost || 1);
  while (run.xp >= run.xpNext) {
    run.xp -= run.xpNext;
    run.level++;
    run.xpNext = xpForLevel(run.level);

    const hpGain = softHpGain(run.level, Math.round((6 + rng.int(0, 4)) * gMult));
    const mpGain = Math.round((3 + rng.int(0, 2)) * gMult); // resource pools stay linear
    const statPoints = Math.max(1, Math.round(2 * gMult + (rng.chance(0.3) ? 1 : 0)));
    const bias = CLASSES[run.classId].growthBias;
    for (let i = 0; i < statPoints; i++) {
      const st = rng.chance(0.6) ? rng.pick(bias) : rng.pick(APPRAISABLE);
      run.stats[st]++;
    }
    run.maxHp += hpGain;
    run.maxMp += mpGain;
    // level-up recovery: 50% of MISSING health/resource (handoff §15)
    run.hp = Math.min(run.maxHp, run.hp + Math.round((run.maxHp - run.hp) * CONFIG.recovery.levelUpMissingPct));
    run.mp = Math.min(run.maxMp, run.mp + Math.round((run.maxMp - run.mp) * CONFIG.recovery.levelUpMissingPct));

    const up = { level: run.level };
    if (run.level === EVOLUTION_LEVELS.first && !run.subclassId) {
      up.evolutionChoice = subclassOptions(run);
    }
    if (run.level === EVOLUTION_LEVELS.second && run.subclassId) {
      const next = deeperBranch(run);
      if (next) up.deeper = next;
    }
    ups.push(up);
  }
  return ups;
}

// Skills the player could learn right now.
export function learnableSkills(run) {
  const tier = skillTier(run);
  return Object.values(SKILLS).filter(sk =>
    sk.class === run.classId && (sk.tier || 1) <= tier && !run.knownSkills.includes(sk.id));
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

export function resourceName(run) {
  return CLASSES[run.classId]?.resource?.name || 'Mana';
}
