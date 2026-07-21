// Weapon / armor affix pools. Random loot clones a base item, rolls affixes,
// then clamps total power to the TDC item budget (rarity/tier cap × slack).
// Named exclusives / uniques skip affixes — identity stays hand-authored.

import { TDC } from './tdc.js';
import { itemPowerScore, itemPowerCap } from './balance.js';

/** @typedef {{ id: string, name: string, pools: string[], props: Record<string, number>, weight?: number }} Affix */

export const WEAPON_AFFIXES = [
  { id: 'keen', name: 'Keen', pools: ['weapon'], props: { atk: 1 }, weight: 12 },
  { id: 'vicious', name: 'Vicious', pools: ['weapon'], props: { atk: 2 }, weight: 8 },
  { id: 'savage', name: 'Savage', pools: ['weapon'], props: { atk: 3 }, weight: 4 },
  { id: 'brutal', name: 'Brutal', pools: ['weapon'], props: { dmgMult: 1.04 }, weight: 6 },
  { id: 'ruthless', name: 'Ruthless', pools: ['weapon'], props: { dmgMult: 1.06 }, weight: 3 },
  // Opening Battle Charge is relic-mutex only — no random gear affix for it.
  { id: 'swift', name: 'Swift', pools: ['weapon'], props: { initiative: 1 }, weight: 8 },
  { id: 'hasty', name: 'Hasty', pools: ['weapon'], props: { initiative: 2 }, weight: 4 },
  { id: 'vampiric', name: 'Vampiric', pools: ['weapon'], props: { lifesteal: 0.05 }, weight: 5 },
  { id: 'draining', name: 'Draining', pools: ['weapon'], props: { lifesteal: 0.08 }, weight: 3 },
  { id: 'precise', name: 'Precise', pools: ['weapon'], props: { crit: 4 }, weight: 9 },
  { id: 'deadly', name: 'Deadly', pools: ['weapon'], props: { crit: 7 }, weight: 5 },
  { id: 'of_might', name: 'of Might', pools: ['weapon'], props: { str: 2 }, weight: 7 },
  { id: 'of_grace', name: 'of Grace', pools: ['weapon'], props: { dex: 2 }, weight: 7 },
  { id: 'of_insight', name: 'of Insight', pools: ['weapon'], props: { int: 2 }, weight: 7 },
  { id: 'of_clarity', name: 'of Clarity', pools: ['weapon'], props: { wis: 2 }, weight: 6 },
  { id: 'of_fortune', name: 'of Fortune', pools: ['weapon'], props: { lk: 2 }, weight: 5 },
  { id: 'ember', name: 'Ember', pools: ['weapon'], props: { burn: 0.08 }, weight: 5 },
  { id: 'rime', name: 'Rime', pools: ['weapon'], props: { freeze: 0.07 }, weight: 5 },
  { id: 'spellblade', name: 'Spellblade', pools: ['weapon'], props: { int: 1, atk: 1 }, weight: 4 },
  { id: 'berserker', name: 'Berserker', pools: ['weapon'], props: { str: 1, dmgMult: 1.03 }, weight: 4 },
  { id: 'siphoning', name: 'Siphoning', pools: ['weapon'], props: { manaRegen: 1 }, weight: 2, minRarity: 'epic' },
];

export const ARMOR_AFFIXES = [
  { id: 'sturdy', name: 'Sturdy', pools: ['armor'], props: { def: 1 }, weight: 12 },
  { id: 'reinforced', name: 'Reinforced', pools: ['armor'], props: { def: 2 }, weight: 7 },
  { id: 'fortified', name: 'Fortified', pools: ['armor'], props: { def: 3 }, weight: 3 },
  { id: 'vital', name: 'Vital', pools: ['armor'], props: { hp: 8 }, weight: 10 },
  { id: 'hearty', name: 'Hearty', pools: ['armor'], props: { hp: 14 }, weight: 6 },
  { id: 'titan', name: 'Titan', pools: ['armor'], props: { hp: 20 }, weight: 3 },
  { id: 'warding', name: 'Warding', pools: ['armor'], props: { dmgTakenMult: 0.97 }, weight: 5 },
  { id: 'bulwark', name: 'Bulwark', pools: ['armor'], props: { dmgTakenMult: 0.94 }, weight: 3 },
  { id: 'nimble', name: 'Nimble', pools: ['armor'], props: { initiative: 1 }, weight: 7 },
  { id: 'fleet', name: 'Fleet', pools: ['armor'], props: { initiative: 2 }, weight: 3 },
  { id: 'renowned', name: 'Renowned', pools: ['armor'], props: { fameGainMult: 1.12 }, weight: 5 },
  { id: 'famous', name: 'Famous', pools: ['armor'], props: { fameGainMult: 1.2 }, weight: 2 },
  { id: 'focused', name: 'Focused', pools: ['armor'], props: { manaRegen: 1 }, weight: 2, minRarity: 'epic' },
  { id: 'meditative', name: 'Meditative', pools: ['armor'], props: { manaRegen: 2 }, weight: 1, minRarity: 'epic' },
  { id: 'of_iron', name: 'of Iron', pools: ['armor'], props: { str: 1, def: 1 }, weight: 6 },
  { id: 'of_shadows', name: 'of Shadows', pools: ['armor'], props: { dex: 1, dodge: 3 }, weight: 6 },
  { id: 'of_lore', name: 'of Lore', pools: ['armor'], props: { int: 1, mp: 6 }, weight: 6 },
  { id: 'of_faith', name: 'of Faith', pools: ['armor'], props: { wis: 1, hp: 6 }, weight: 6 },
  { id: 'lucky', name: 'Lucky', pools: ['armor'], props: { lk: 2 }, weight: 5 },
  { id: 'evasive', name: 'Evasive', pools: ['armor'], props: { dodge: 4 }, weight: 7 },
  { id: 'critical', name: 'Critical', pools: ['armor'], props: { crit: 3 }, weight: 5 },
];

export const ACCESSORY_AFFIXES = [
  { id: 'polished', name: 'Polished', pools: ['accessory'], props: { lk: 1 }, weight: 10 },
  { id: 'gilded', name: 'Gilded', pools: ['accessory'], props: { goldMult: 1.08 }, weight: 6 },
  { id: 'scholarly', name: 'Scholarly', pools: ['accessory'], props: { xpMult: 1.08 }, weight: 6 },
  { id: 'bloodied', name: 'Bloodied', pools: ['accessory'], props: { lifesteal: 0.04 }, weight: 5 },
  { id: 'razor', name: 'Razor', pools: ['accessory'], props: { crit: 4 }, weight: 7 },
  { id: 'anchored', name: 'Anchored', pools: ['accessory'], props: { def: 1, hp: 6 }, weight: 7 },
  { id: 'arcane', name: 'Arcane', pools: ['accessory'], props: { mp: 10 }, weight: 6 },
  { id: 'heraldic', name: 'Heraldic', pools: ['accessory'], props: { fameGainMult: 1.15 }, weight: 4 },
  { id: 'warlike', name: 'Warlike', pools: ['accessory'], props: { atk: 1, str: 1 }, weight: 5 },
  { id: 'quick', name: 'Quick', pools: ['accessory'], props: { initiative: 1, dodge: 2 }, weight: 6 },
];

const ALL_AFFIXES = [...WEAPON_AFFIXES, ...ARMOR_AFFIXES, ...ACCESSORY_AFFIXES];

export function affixById(id) {
  return ALL_AFFIXES.find(a => a.id === id) || null;
}

function poolForSlot(slot) {
  if (slot === 'weapon') return WEAPON_AFFIXES;
  if (slot === 'accessory') return ACCESSORY_AFFIXES;
  return ARMOR_AFFIXES;
}

function affixCount(rng, rarity) {
  const [lo, hi] = TDC.affix.counts[rarity] || TDC.affix.counts.common;
  if (lo === hi) return lo;
  return rng.int(lo, hi);
}

/** Scale raw affix props by floor depth (mild). */
function scaleProps(props, floor = 1) {
  const scale = 1 + Math.min(0.55, Math.max(0, floor - 1) * TDC.affix.floorScale);
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    if (typeof v !== 'number') { out[k] = v; continue; }
    if (k === 'dmgMult' || k === 'dmgTakenMult' || k === 'goldMult' || k === 'xpMult' || k === 'fameGainMult') {
      // Keep multiplicative deltas proportional: 1.06 → 1 + 0.06*scale
      out[k] = v >= 1 ? 1 + (v - 1) * scale : 1 - (1 - v) * scale;
    } else if (v > 0 && v < 1) {
      out[k] = Math.round(v * scale * 1000) / 1000; // chances
    } else if (Number.isInteger(v)) {
      out[k] = Math.max(1, Math.round(v * scale));
    } else {
      out[k] = Math.round(v * scale * 10) / 10;
    }
  }
  return out;
}

function mergeProp(item, key, val) {
  if (key === 'dmgMult' || key === 'dmgTakenMult' || key === 'goldMult' || key === 'xpMult' || key === 'fameGainMult') {
    item[key] = (item[key] || 1) * val;
  } else {
    item[key] = (item[key] || 0) + val;
  }
}

function affixLabel(affix) {
  return affix.name.startsWith('of ') ? affix.name : affix.name;
}

function formatAffixLine(affix, props) {
  const bits = [];
  for (const [k, v] of Object.entries(props)) {
    if (k === 'dmgMult') bits.push(`+${Math.round((v - 1) * 100)}% dmg`);
    else if (k === 'dmgTakenMult') bits.push(`−${Math.round((1 - v) * 100)}% dmg taken`);
    else if (k === 'goldMult') bits.push(`+${Math.round((v - 1) * 100)}% gold`);
    else if (k === 'xpMult') bits.push(`+${Math.round((v - 1) * 100)}% XP`);
    else if (k === 'fameGainMult') bits.push(`+${Math.round((v - 1) * 100)}% fame`);
    else if (k === 'manaRegen') bits.push(`+${v} resource regen`);
    else if (k === 'lifesteal' || k === 'burn' || k === 'freeze') bits.push(`+${Math.round(v * 100)}% ${k}`);
    else if (k === 'crit' || k === 'dodge') bits.push(`+${v}% ${k}`);
    else bits.push(`+${v} ${k.toUpperCase()}`);
  }
  return `${affixLabel(affix)} (${bits.join(', ')})`;
}

function powerBudget(base, floor = 1) {
  const cap = itemPowerCap(base) * TDC.validators.itemSlack;
  return { hardCap: cap };
}

function rarityRank(r) {
  return { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4, unique: 5, wrld: 6 }[r] ?? 0;
}

function pickAffixes(rng, pool, count, usedIds, rarity = 'common') {
  const picked = [];
  let available = pool.filter(a => {
    if (usedIds.has(a.id)) return false;
    if (a.minRarity && rarityRank(rarity) < rarityRank(a.minRarity)) return false;
    return true;
  });
  for (let i = 0; i < count && available.length; i++) {
    const weighted = available.map(a => ({ w: a.weight || 1, a }));
    const choice = rng.weighted(weighted).a;
    picked.push(choice);
    usedIds.add(choice.id);
    available = available.filter(a => a.id !== choice.id);
  }
  return picked;
}

/**
 * Clone a catalog item and roll affixes. Mutates nothing in the catalog.
 * @returns {object} instance (may equal a shallow clone with no affixes)
 */
export function applyAffixes(base, rng, { floor = 1, force = false } = {}) {
  if (!base || base.slot == null) return base ? { ...base } : null;
  if (!force && (base.exclusive || base.unique || base.wrld || base.rarity === 'unique' || base.rarity === 'wrld' || base.noAffix)) {
    return { ...base, baseId: base.id, affixes: [] };
  }

  const rarity = base.rarity || 'common';
  const count = affixCount(rng, rarity);
  const item = {
    ...base,
    baseId: base.id,
    affixes: [],
  };

  if (count <= 0) return item;

  const pool = poolForSlot(base.slot === 'accessory' ? 'accessory' : base.slot === 'weapon' ? 'weapon' : 'armor');
  const chosen = pickAffixes(rng, pool, count, new Set(), rarity);
  const { hardCap } = powerBudget(base, floor);

  for (const aff of chosen) {
    const props = scaleProps(aff.props, floor);
    const trial = { ...item };
    for (const [k, v] of Object.entries(props)) mergeProp(trial, k, v);
    if (itemPowerScore(trial) > hardCap) continue; // skip affixes that breach TDC cap
    for (const [k, v] of Object.entries(props)) mergeProp(item, k, v);
    item.affixes.push({ id: aff.id, name: aff.name, props });
  }

  // Final clamp: strip last affix until under budget (safety net)
  while (item.affixes.length && itemPowerScore(item) > hardCap) {
    const last = item.affixes.pop();
    // Rebuild from base + remaining affixes
    const rebuilt = { ...base, baseId: base.id, affixes: [] };
    for (const a of item.affixes) {
      for (const [k, v] of Object.entries(a.props)) mergeProp(rebuilt, k, v);
      rebuilt.affixes.push(a);
    }
    Object.assign(item, rebuilt);
    void last;
  }

  if (item.affixes.length) {
    const prefix = item.affixes.filter(a => !a.name.startsWith('of '));
    const suffix = item.affixes.filter(a => a.name.startsWith('of '));
    const hasWord = (name, word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(name);
    const nameBits = [
      ...prefix.map(a => a.name).filter(n => !hasWord(base.name, n)),
      base.name,
      ...suffix.map(a => a.name).filter(n => !hasWord(base.name, n)),
    ];
    item.name = nameBits.join(' ');
    const lines = item.affixes.map(a => formatAffixLine(affixById(a.id) || a, a.props));
    item.desc = `${base.desc}\n✦ ${lines.join(' · ')}`;
    item.price = Math.round((base.price || 40) * (1 + item.affixes.length * 0.22));
  }

  return item;
}

/** Mint a unique instance id and stamp it on the item. */
export function mintInstance(item, rng) {
  if (!item) return null;
  if (item.instanceId) return item;
  const baseId = item.baseId || item.id;
  const tag = Math.floor(rng.next() * 0xFFFFFF).toString(16).padStart(6, '0');
  item.instanceId = `${baseId}__${tag}`;
  item.id = item.instanceId;
  return item;
}

/**
 * Full loot roll path: affix + mint. Pass run to register in gearBag.
 */
export function finalizeLootItem(item, rng, run = null) {
  if (!item) return null;
  mintInstance(item, rng);
  if (run) {
    run.gearBag = run.gearBag || {};
    run.gearBag[item.id] = item;
  }
  return item;
}
