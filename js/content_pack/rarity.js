// Explicit rarity model and category-specific power budgets.
// Missing rarity is a validation error — helpers must never invent one.

export const VALID_RARITIES = Object.freeze([
  'common', 'uncommon', 'rare', 'epic', 'legendary', 'unique', 'wrld',
]);

export const ORDINARY_RARITIES = Object.freeze([
  'common', 'uncommon', 'rare', 'epic', 'legendary',
]);

/** Initial distribution bands (not quotas). Unique/WRLD are excluded. */
export const DISTRIBUTION_BANDS = Object.freeze({
  ordinaryEquipment: {
    common: [0.20, 0.30],
    uncommon: [0.25, 0.35],
    rare: [0.20, 0.30],
    epic: [0.10, 0.18],
    legendary: [0.03, 0.08],
  },
  consumables: {
    common: [0.30, 0.45],
    uncommon: [0.30, 0.40],
    rare: [0.15, 0.25],
    epic: [0.05, 0.10],
    legendary: [0.01, 0.05],
  },
  relics: {
    common: [0.05, 0.15],
    uncommon: [0.20, 0.30],
    rare: [0.25, 0.35],
    epic: [0.15, 0.25],
    legendary: [0.08, 0.15],
  },
});

/**
 * Inclusive score bands by catalog category. Weapons, armor, relics, and
 * consumables use different formulas — do not compare raw ATK across kinds.
 */
export const POWER_BANDS = Object.freeze({
  weapon: {
    common: [3, 18],
    uncommon: [5, 26],
    rare: [8, 40],
    epic: [10, 40],
    legendary: [32, 70],
    unique: [40, 140],
    wrld: [80, 200],
  },
  armor: {
    common: [2, 16],
    uncommon: [4, 20],
    rare: [5, 24],
    epic: [8, 40],
    legendary: [18, 78],
    unique: [22, 120],
    wrld: [50, 180],
  },
  accessory: {
    common: [1, 12],
    uncommon: [3, 16],
    rare: [4, 20],
    epic: [6, 32],
    legendary: [10, 70],
    unique: [20, 110],
    wrld: [40, 160],
  },
  relic: {
    common: [2, 12],
    uncommon: [2, 16],
    rare: [3, 20],
    epic: [2, 24],
    legendary: [12, 40],
    unique: [18, 85],
    wrld: [28, 120],
  },
  consumable: {
    common: [2, 36],
    uncommon: [2, 24],
    rare: [2, 30],
    epic: [8, 42],
    legendary: [8, 70],
    unique: [20, 70],
    wrld: [28, 90],
  },
});

export const LIST_PRICE = Object.freeze({
  equipment: {
    common: 42, uncommon: 80, rare: 170, epic: 310, legendary: 700, unique: 1250, wrld: 3100,
  },
  relic: {
    common: 40, uncommon: 70, rare: 120, epic: 200, legendary: 400, unique: 700, wrld: 1200,
  },
  consumable: {
    common: 18, uncommon: 36, rare: 70, epic: 120, legendary: 200, unique: 400, wrld: 800,
  },
});

export const DROP_WEIGHT = Object.freeze({
  common: 50, uncommon: 30, rare: 14, epic: 5, legendary: 1, unique: 0, wrld: 0,
});

export const BIOME_FLOORS = Object.freeze({
  forest: [1, 10],
  ruins: [11, 20],
  frost: [21, 30],
  swamp: [31, 40],
  hell: [41, 50],
  throne: [51, 51],
});

const OP_SCORE = Object.freeze({
  modDamage: 6, flatDamage: 4, statusChance: 5, applyStatus: 5, removeStatus: 4,
  convertStatus: 7, extendStatus: 5,
  heal: 6, overhealWard: 7, shareHeal: 6,
  grantCharge: 8, grantResource: 4, spendResource: 3,
  setFlag: 2, clearFlag: 2, addCounter: 3,
  lethalWard: 18, redirectDamage: 9, interceptAoe: 14,
  echoAction: 11, copySupport: 10,
  summonAlly: 11, storeArchetype: 9,
  revealIntent: 5, weakenIntent: 6,
  chooseStance: 8, setOath: 8,
  markTarget: 5, recordName: 4,
  spendGoldPower: 8, spendFamePower: 8,
  convertResource: 4, delayEffect: 6,
  evolveItem: 16, crackItem: 10,
  contestLethal: 12, borrowTechnique: 8, storeMemory: 5,
  modIncoming: 7, modAccuracy: 4,
  gainFame: 3, gainGold: 3, reduceCharge: 5,
  altTargetShot: 6, leaveAtOne: 7,
  armNextHit: 5, armNextIncoming: 5,
  cancelEventPenalty: 9, restoreMemory: 5, noOp: 0,
});

export function catalogPrice(kind, rarity, tier = 1) {
  const table = LIST_PRICE[kind] || LIST_PRICE.equipment;
  const base = table[rarity];
  if (base == null) return undefined;
  const step = kind === 'consumable' ? 2 : 8;
  return base + Math.max(1, tier || 1) * step;
}

export function dropWeightFor(rarity) {
  return DROP_WEIGHT[rarity] ?? 0;
}

export function itemCategory(item) {
  if (!item) return 'unknown';
  if (item.slot === 'weapon') return 'weapon';
  if (item.slot === 'accessory') return 'accessory';
  if (item.slot) return 'armor';
  if (item.heal != null || item.healPct != null || item.healPerFloor != null
    || item.bombDmg != null || item.mana != null || item.cure
    || item.shopMaxTier != null || item.foodBuff) {
    return 'consumable';
  }
  return 'relic';
}

export function equipmentSlot(item) {
  if (item?.slot) return item.slot;
  if (itemCategory(item) === 'relic') return 'relic';
  if (itemCategory(item) === 'consumable') return 'consumable';
  return 'none';
}

function effectValue(ef) {
  if (!ef || typeof ef !== 'object') return 0;
  let s = OP_SCORE[ef.op] ?? 3;
  if (typeof ef.mult === 'number' && ef.mult > 1) s += (ef.mult - 1) * 28;
  if (typeof ef.mult === 'number' && ef.mult > 0 && ef.mult < 1 && ef.op === 'modIncoming') {
    s += (1 - ef.mult) * 30;
  }
  if (ef.add) s += Math.abs(ef.add) * 0.9;
  if (ef.pct) s += Math.abs(ef.pct) * 22;
  if (ef.amount) s += Math.min(8, Math.abs(ef.amount) * 0.4);
  if (ef.chance) s += ef.chance * 10;
  if (ef.once === 'run' && ef.op !== 'lethalWard' && ef.op !== 'contestLethal') s *= 0.72;
  else if (ef.once === 'combat') s *= 0.82;
  else if (ef.once === 'turn') s *= 0.7;
  if (ef.when) s *= 0.88;
  if (ef.when?.counterAt) s += 6;
  if (ef.missingAllies || ef.when?.allyDowned) s += 6;
  return s;
}

function effectsScore(item) {
  let s = 0;
  for (const ef of item.effects || []) s += effectValue(ef);
  if (item.setBonus) {
    for (const list of Object.values(item.setBonus)) {
      for (const ef of list || []) s += effectValue(ef) * 0.45;
    }
  }
  return s;
}

function curseDrawbackValue(item) {
  if (!item?.curse && item?.acquisition !== 'cursed') return 0;
  let d = 8;
  if (item.curseDrawback) d += 2;
  const curse = String(item.curse || '');
  if (/eats_|self_|unequip|corrupt|gold_for|fame_/.test(curse)) d += 4;
  if (/lethal|maxhp|parasite|echo/.test(curse)) d += 3;
  return d;
}

function statScore(item) {
  let s = 0;
  s += (item.atk || 0) * 1.5;
  s += (item.def || 0) * 1.25;
  s += (item.hp || 0) * 0.12;
  s += (item.mp || 0) * 0.08;
  for (const st of ['str', 'dex', 'int', 'wis', 'lk']) s += (item[st] || 0) * 0.9;
  s += (item.crit || 0) * 0.35;
  s += (item.dodge || 0) * 0.4;
  s += (item.lifesteal || 0) * 40;
  s += (item.initiative || 0) * 2.5;
  s += (item.startCharge || 0) * 6;
  s += (item.manaRegen || 0) * 1.5;
  s += (item.burn || 0) * 35;
  s += (item.freeze || 0) * 40;
  s += (item.poison || 0) * 32;
  s += (item.weaken || 0) * 30;
  s += (item.frail || 0) * 30;
  s += (item.stun || 0) * 38;
  if (item.dmgMult) s += (item.dmgMult - 1) * 45;
  if (item.bossDmgMult) s += (item.bossDmgMult - 1) * 35;
  if (item.dmgTakenMult) s += (1 - item.dmgTakenMult) * 55;
  if (item.maxHpMult) s += (item.maxHpMult - 1) * 40;
  if (item.goldMult) s += (item.goldMult - 1) * 8;
  if (item.xpMult) s += (item.xpMult - 1) * 10;
  if (item.fameGainMult) s += (item.fameGainMult - 1) * 6;
  if (item.revive) s += 22;
  if (item.deathward) s += 14;
  if (item.thorns) s += item.thorns * 30;
  if (item.echoChance) s += item.echoChance * 28;
  if (item.doubleDmgRound) s += 18;
  if (item.victoryHeal) s += item.victoryHeal * 40;
  if (item.extraSkillSlots) s += item.extraSkillSlots * 8;
  if (item.allStats) s += item.allStats * 4.5;
  return s;
}

function consumableScore(item) {
  let s = 0;
  s += (item.heal || 0) / 5;
  s += (item.healPct || 0) * 42;
  s += (item.healPerFloor || 0) * 2;
  s += (item.bombDmg || 0) / 4;
  s += (item.bombPerFloor || 0);
  s += (item.mana || 0) / 8;
  if (item.cure) s += 8;
  if (item.foodBuff) s += 6;
  if (item.appraisal) s += 5;
  s += effectsScore(item);
  return s;
}

function relicScore(item) {
  let s = effectsScore(item) + statScore(item) * 0.35;
  if (item.mutex) s += 3;
  if (item.quest) s += 2;
  return s;
}

/** Expected offensive / defensive / heal / utility / economy / flexibility (0–20 each). */
export function facetValues(item) {
  const cat = itemCategory(item);
  const fx = item.effects || [];
  const ops = new Set(fx.map(e => e.op));
  const off = Math.min(20, (item.atk || 0) * 1.2
    + (item.dmgMult ? (item.dmgMult - 1) * 40 : 0)
    + (ops.has('modDamage') ? 6 : 0) + (ops.has('echoAction') ? 5 : 0)
    + (item.crit || 0) * 0.3 + (item.burn || 0) * 20);
  const def = Math.min(20, (item.def || 0) * 1.4
    + (item.hp || 0) * 0.08
    + (ops.has('modIncoming') ? 6 : 0) + (ops.has('lethalWard') ? 8 : 0)
    + (ops.has('interceptAoe') ? 7 : 0) + (item.dodge || 0) * 0.35);
  const heal = Math.min(20, (item.heal || 0) / 4 + (item.healPct || 0) * 35
    + (ops.has('heal') ? 5 : 0) + (ops.has('shareHeal') ? 4 : 0)
    + (ops.has('overhealWard') ? 4 : 0) + (item.lifesteal || 0) * 25);
  const util = Math.min(20, (ops.has('revealIntent') ? 5 : 0)
    + (ops.has('storeMemory') ? 4 : 0) + (ops.has('chooseStance') || ops.has('setOath') ? 5 : 0)
    + (ops.has('cancelEventPenalty') ? 6 : 0) + (ops.has('weakenIntent') ? 4 : 0)
    + (item.reveal ? 6 : 0) + (cat === 'consumable' && !item.heal && !item.healPct ? 4 : 0));
  const econ = Math.min(20, (ops.has('gainGold') ? 5 : 0) + (ops.has('convertResource') ? 4 : 0)
    + (item.goldMult ? (item.goldMult - 1) * 20 : 0) + (ops.has('spendGoldPower') ? 3 : 0)
    + (item.price ? Math.min(4, item.price / 200) : 0));
  const flex = Math.min(20, (ops.has('evolveItem') ? 8 : 0) + (item.setId ? 4 : 0)
    + (ops.has('borrowTechnique') ? 6 : 0) + (item.resonance ? 3 : 0)
    + (ops.has('echoAction') || ops.has('copySupport') ? 4 : 0)
    + (item.unique || item.rarity === 'unique' ? 3 : 0));
  return {
    offensive: Math.round(off * 10) / 10,
    defensive: Math.round(def * 10) / 10,
    healing: Math.round(heal * 10) / 10,
    utility: Math.round(util * 10) / 10,
    economy: Math.round(econ * 10) / 10,
    flexibility: Math.round(flex * 10) / 10,
  };
}

export function powerScore(item) {
  const cat = itemCategory(item);
  let raw = 0;
  if (cat === 'consumable') raw = consumableScore(item);
  else if (cat === 'relic') raw = relicScore(item);
  else raw = statScore(item) + effectsScore(item) * (cat === 'weapon' ? 0.85 : 0.95);
  raw -= curseDrawbackValue(item) * 0.35;
  // Named chase identity is scored as acquisition/identity, not vanilla ATK.
  if (item.rarity === 'wrld' || item.wrld) raw += 24;
  else if (item.rarity === 'unique') raw += 18;
  else if (item.unique) raw += 12;
  return Math.round(Math.max(0, raw) * 10) / 10;
}

export function powerBandFor(item) {
  const cat = itemCategory(item);
  const rarity = item?.rarity;
  return POWER_BANDS[cat]?.[rarity] || null;
}

const COMBAT_OPS = new Set([
  'modDamage', 'flatDamage', 'statusChance', 'applyStatus',
  'heal', 'overhealWard', 'shareHeal',
  'grantCharge', 'lethalWard', 'redirectDamage', 'interceptAoe',
  'echoAction', 'copySupport', 'summonAlly',
  'weakenIntent', 'contestLethal', 'modIncoming', 'armNextHit', 'armNextIncoming',
  'leaveAtOne', 'altTargetShot',
]);

export function isUtilityCatalog(item) {
  const cat = itemCategory(item);
  if (cat === 'weapon') return false;
  if (cat === 'armor') return false;
  const ops = (item.effects || []).map(e => e.op);
  const combat = ops.some(o => COMBAT_OPS.has(o));
  if (cat === 'consumable' && (item.heal || item.healPct || item.bombDmg || combat)) return false;
  if (cat === 'relic' && (combat || item.allStats || item.deathward || item.echoChance || item.dmgMult)) return false;
  if (cat === 'accessory' && (combat || (item.atk || 0) + (item.def || 0) >= 3)) return false;
  return cat === 'relic' || cat === 'consumable' || cat === 'accessory';
}

export function fitsPowerBand(item, { slack = 1.18 } = {}) {
  if (isUtilityCatalog(item)) {
    return { ok: true, score: powerScore(item), band: 'utility', reason: 'event-utility' };
  }
  const band = powerBandFor(item);
  const score = powerScore(item);
  if (!band) return { ok: false, score, band: null, reason: 'no band' };
  const [lo, hi] = band;
  const ok = score >= lo / slack && score <= hi * slack;
  return { ok, score, band, lo, hi, slack };
}

export function duplicatePolicy(item) {
  if (item?.rarity === 'wrld' || item?.wrld) return 'party_claim';
  if (item?.rarity === 'unique' || item?.unique) return 'character';
  if (itemCategory(item) === 'relic') return 'character';
  if (itemCategory(item) === 'consumable') return 'stack';
  if (item?.exclusive || item?.quest) return 'grant_once';
  return 'affixed_instance';
}

export function affixEligible(item) {
  if (!item) return false;
  if (item.noAffix || item.unique || item.wrld) return false;
  if (item.rarity === 'unique' || item.rarity === 'wrld') return false;
  if (item.exclusive) return false;
  return item.packOrdinary || item.acquisition === 'ordinary';
}

export function ordinaryLootEligible(item) {
  if (!item) return false;
  if (item.exclusive || item.quest || item.unique || item.wrld) return false;
  if (item.rarity === 'unique' || item.rarity === 'wrld') return false;
  return !!(item.packOrdinary && (item.acquisition || 'ordinary') === 'ordinary');
}

export function shopEligible(item, tier = 1) {
  if (!ordinaryLootEligible(item)) return false;
  if (item.shopMaxTier != null && tier > item.shopMaxTier) return false;
  return true;
}

export function floorRangeFor(item, grantIndex = null) {
  if (item?.minFloor != null || item?.maxFloor != null) {
    return {
      minFloor: item.minFloor ?? 1,
      maxFloor: item.maxFloor ?? 51,
      source: 'authored',
    };
  }
  const biomes = item?.biomes || grantIndex?.get(item?.id)?.biomes;
  if (biomes?.length) {
    let min = 51;
    let max = 1;
    for (const b of biomes) {
      const span = BIOME_FLOORS[b];
      if (!span) continue;
      min = Math.min(min, span[0]);
      max = Math.max(max, span[1]);
    }
    if (min <= max) return { minFloor: min, maxFloor: max, biomes, source: 'grants' };
  }
  const tier = item?.tier || 1;
  const minFloor = { 1: 1, 2: 6, 3: 12, 4: 22, 5: 35 }[tier] || 1;
  const maxFloor = { 1: 20, 2: 30, 3: 42, 4: 51, 5: 51 }[tier] || 51;
  return { minFloor, maxFloor, source: 'tier' };
}

export function countByRarity(list) {
  const out = {};
  for (const r of VALID_RARITIES) out[r] = 0;
  out.missing = 0;
  for (const it of list || []) {
    if (!it?.rarity) out.missing += 1;
    else if (out[it.rarity] != null) out[it.rarity] += 1;
    else out[it.rarity] = (out[it.rarity] || 0) + 1;
  }
  out.total = (list || []).length;
  return out;
}

export function pctOfOrdinary(counts) {
  const denom = ORDINARY_RARITIES.reduce((n, r) => n + (counts[r] || 0), 0);
  const pct = {};
  for (const r of ORDINARY_RARITIES) {
    pct[r] = denom ? (counts[r] || 0) / denom : 0;
  }
  return { denom, pct };
}

export function inBand(pct, [lo, hi]) {
  return pct >= lo && pct <= hi;
}

export function distributionReport(list, bandKey) {
  const counts = countByRarity(list);
  const { denom, pct } = pctOfOrdinary(counts);
  const bands = DISTRIBUTION_BANDS[bandKey];
  const fit = {};
  if (bands) {
    for (const r of ORDINARY_RARITIES) {
      fit[r] = bands[r] ? inBand(pct[r], bands[r]) : null;
    }
  }
  return {
    counts,
    ordinaryDenom: denom,
    ordinaryPct: pct,
    unique: counts.unique || 0,
    wrld: counts.wrld || 0,
    bandKey,
    bands,
    inBand: fit,
  };
}

export function rarityErrors(item, path = 'item') {
  const errors = [];
  if (!item?.rarity) errors.push(`${path}: missing rarity`);
  else if (!VALID_RARITIES.includes(item.rarity)) {
    errors.push(`${path}: invalid rarity '${item.rarity}'`);
  }
  if (item?.rarity === 'cursed') errors.push(`${path}: 'cursed' is a trait, not a rarity`);
  return errors;
}

/** Parse catalog source: an id is "authored" if its object literal contains rarity:. */
export function authoredRarityMap(sourceText) {
  const map = new Map();
  const re = /\bid:\s*'([^']+)'/g;
  const hits = [];
  let m;
  while ((m = re.exec(sourceText))) hits.push({ id: m[1], index: m.index });
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].index;
    const end = i + 1 < hits.length ? hits[i + 1].index : sourceText.length;
    const chunk = sourceText.slice(start, end);
    const rm = chunk.match(/\brarity:\s*'([a-z]+)'/);
    map.set(hits[i].id, rm ? rm[1] : null);
  }
  return map;
}

export function helperFallbackNote() {
  return {
    removed: [
      { site: 'catalogs/helpers.js wpn()', previous: "p.rarity || 'uncommon'", effect: 'weapons without rarity became Uncommon' },
      { site: 'catalogs/helpers.js gear()', previous: "p.rarity || 'uncommon'", effect: 'armor/accessories without rarity became Uncommon' },
      { site: 'catalogs/helpers.js relic()', previous: "p.rarity || 'rare'", effect: 'every relic without rarity became Rare' },
      { site: 'catalogs/helpers.js potion()', previous: "p.rarity || 'uncommon'", effect: 'every consumable without rarity became Uncommon' },
      { site: 'catalogs/armor.js setPieces()', previous: "extra.rarity || 'rare'", effect: 'class set pieces without rarity became Rare' },
    ],
    notCategoryFallback: [
      'compendium/curse display defaults (must never fire once catalogs validate)',
      'affix roll base.rarity || common (vanilla loot templates always declare rarity)',
    ],
    conclusion: 'Bulk Rare relics and Uncommon consumables were helper defaults, not per-entry authoring. Class armor sets used a group Rare default in setPieces. Foundation/class/bloodline weapons mostly declared rarity explicitly.',
  };
}
