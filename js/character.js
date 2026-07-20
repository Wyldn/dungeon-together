// Derived stats, leveling, growth, subclasses, appraisal, fame, inventory.

import { CLASSES, SUBCLASSES, EVOLUTION_LEVELS, subclassOptions, deeperBranch } from './data/classes.js';
import { RACES } from './data/races.js';
import { resolveItem, RELICS, EQUIP_SLOTS } from './data/items.js';
import { SKILLS } from './data/skills.js';
import { CONFIG } from './data/config.js';
import { rankFor, appraisalRange, growthMult, growthGainMult } from './data/ranks.js';
import { cappedDmgTakenMult, softHpGain, levelDefBonus, resourceRegen } from './data/tdc.js';

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
    // Flag from boss clear, or already past that floor (legacy saves).
    if (run.flags?.[bp.flag] || run.floor > bp.floor) n += bp.slots;
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
    // Level DEF + gear/race; combat applies diminishing-returns mitigation.
    def: Math.round(
      levelDefBonus(run.level)
      + gearSum(run, 'def')
      + (race.def || 0)
      + (run.raceDef || 0)
    ),
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

/**
 * Pick a random stat, weighted toward the class growthBias (and its secondary).
 * `biasChance` = odds of landing in the class's preferred stats.
 */
export function pickClassWeightedStat(run, rng, { biasChance = 0.7 } = {}) {
  const bias = CLASSES[run.classId]?.growthBias || APPRAISABLE;
  if (rng.chance(biasChance) && bias.length) return rng.pick(bias);
  return rng.pick(APPRAISABLE);
}

/** Grant N class-weighted permanent stats. Returns the tally map. */
export function grantClassWeightedStats(run, rng, count = 1, opts = {}) {
  const n = Math.max(0, count | 0);
  const gained = {};
  for (let i = 0; i < n; i++) {
    const st = pickClassWeightedStat(run, rng, opts);
    run.stats[st] = (run.stats[st] || 0) + 1;
    gained[st] = (gained[st] || 0) + 1;
  }
  return gained;
}

export function appraiseRun(rng, run, { partial = false, location = 'the tower' } = {}) {
  const d = derived(run);
  const stats = partial ? rng.shuffle(APPRAISABLE).slice(0, 2) : APPRAISABLE;
  const results = {};
  for (const st of stats) results[st] = appraisalRange(rng, d[st]);
  const total = APPRAISABLE.reduce((s, k) => s + d[k], 0);
  // Full readings unlock the hidden growth rank; partials leave it sealed.
  if (!partial) run.growthRevealed = true;
  run.appraisal = {
    floor: run.floor,
    level: run.level,
    location,
    partial,
    results,
    overall: rankFor(Math.round(total / APPRAISABLE.length * 1.6)),
    growthRank: run.growthRevealed ? (run.growthRank || 'C') : null,
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

// Level up. Hidden growth mostly multiplies XP intake; a mild residue still
// scales HP/MP/stat gains. Returns records:
// {level, evolutionChoice?: [options], deeper?: subclass}
export function gainXp(run, amount, rng) {
  const rank = run.growthRank || 'C';
  const boost = run.growthBoost || 1;
  const xpMult = growthMult(rank) * boost;
  run.xp += Math.max(0, Math.round((Number(amount) || 0) * xpMult));
  const ups = [];
  const gainMult = growthGainMult(rank, boost);
  while (run.xp >= run.xpNext) {
    run.xp -= run.xpNext;
    run.level++;
    run.xpNext = xpForLevel(run.level);

    // Lean HP curve (~150 late); tankiness comes from level+gear DEF instead.
    const hpGain = softHpGain(run.level, Math.round((4 + rng.int(0, 2)) * gainMult));
    const mpGain = Math.round((3 + rng.int(0, 2)) * gainMult); // resource pools stay linear
    // Early levels get an extra point — forest climbs need more than 2 rares of power.
    const earlyBonus = run.level <= 8 ? 1 : 0;
    const statPoints = Math.max(1, Math.round(2 * gainMult + (rng.chance(0.35) ? 1 : 0))) + earlyBonus;
    grantClassWeightedStats(run, rng, statPoints, { biasChance: 0.72 });
    // Keep the same fill % after max pools grow (e.g. 20/40 → 25/50).
    const hpRatio = run.hp / Math.max(1, run.maxHp);
    const mpRatio = run.mp / Math.max(1, run.maxMp);
    run.maxHp += hpGain;
    run.maxMp += mpGain;
    run.hp = Math.min(run.maxHp, Math.max(0, Math.round(hpRatio * run.maxHp)));
    run.mp = Math.min(run.maxMp, Math.max(0, Math.round(mpRatio * run.maxMp)));

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
