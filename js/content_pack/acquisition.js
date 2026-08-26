// Acquisition channels. Ordinary loot never receives the full pack catalog.
// Class, bloodline, biome-find, campfire, unique, and WRLD are competing
// pools — they are not packOrdinary.

import { isPackOn } from './flags.js';
import { packEquipment, packRelicList, packConsumableList } from './registry.js';
import { BIOME_FLOORS, floorRangeFor } from './rarity.js';

export const CHANNEL = Object.freeze({
  ordinary: 'ordinary',
  class: 'class',
  bloodline: 'bloodline',
  shop: 'shop',
  boss: 'boss',
  trial: 'trial',
  campfire: 'campfire',
  event: 'event',
  event_chain: 'event_chain',
  cursed: 'cursed',
  evolution: 'evolution',
  technique: 'technique',
  bloodline_art: 'bloodline_art',
  unique: 'unique',
  wrld: 'wrld',
  biome_find: 'biome_find',
});

export const CLASS_LOOT_CHANCE = 0.22;
export const BLOODLINE_LOOT_CHANCE = 0.16;
export const BIOME_FIND_CHANCE = 0.14;

export function canonicalClassId(id) {
  if (!id) return id;
  if (id === 'ranger') return 'archer';
  return id;
}

export function classIdsMatch(a, b) {
  return canonicalClassId(a) === canonicalClassId(b);
}

export function isChaseIdentity(item) {
  return !!(item && (item.unique || item.wrld || item.rarity === 'unique' || item.rarity === 'wrld'));
}

export function inOrdinaryLoot(item) {
  if (!item || item.exclusive || item.quest) return false;
  if (item.unique || item.wrld || item.rarity === 'unique' || item.rarity === 'wrld') return false;
  return !!(item.packOrdinary && (item.acquisition || 'ordinary') === 'ordinary');
}

export function shopEligiblePack(item, tier = 1) {
  if (!inOrdinaryLoot(item)) return false;
  if (item.shopMaxTier != null && tier > item.shopMaxTier) return false;
  return true;
}

function floorOk(item, floor) {
  if (floor == null) return true;
  const span = floorRangeFor(item);
  if (item.minFloor != null && floor < item.minFloor) return false;
  if (item.maxFloor != null && floor > item.maxFloor) return false;
  if (span && floor < span.minFloor) return false;
  if (span && floor > span.maxFloor) return false;
  return true;
}

function biomeOk(item, biomeId) {
  if (!biomeId || !item?.biomes?.length) return true;
  return item.biomes.includes(biomeId);
}

/** Class-bound pack gear that is not Unique/WRLD/cursed/quest. */
export function classLootEligible(item, classId = null, { floor, biomeId } = {}) {
  if (!item || isChaseIdentity(item) || item.curse || item.quest) return false;
  if (item.acquisition !== 'class') return false;
  if (item.packOrdinary) return false;
  if (!floorOk(item, floor) || !biomeOk(item, biomeId)) return false;
  if (classId && item.classBound && !classIdsMatch(item.classBound, classId)) return false;
  return !!item.classBound;
}

/** Bloodline-resonant pack gear. Usable by anyone; resonance is a trait, not a hard lock. */
export function bloodlineLootEligible(item, raceId = null, { floor, biomeId } = {}) {
  if (!item || isChaseIdentity(item) || item.curse || item.quest) return false;
  if (item.acquisition !== 'bloodline') return false;
  if (item.packOrdinary) return false;
  if (!floorOk(item, floor) || !biomeOk(item, biomeId)) return false;
  if (raceId && item.resonance && item.resonance !== raceId) return false;
  return !!item.resonance;
}

/**
 * Named-event leftovers that still need a legal find: foundation pieces
 * that are not ordinary loot, class, bloodline, cursed, Unique, or WRLD.
 */
export function biomeFindEligible(item, { floor, biomeId } = {}) {
  if (!item || isChaseIdentity(item) || item.curse || item.quest) return false;
  if (item.packOrdinary || item.classBound || item.resonance) return false;
  if (item.acquisition === 'class' || item.acquisition === 'bloodline') return false;
  if (item.acquisition === 'cursed' || item.acquisition === 'unique' || item.acquisition === 'wrld') return false;
  if (item.slot == null) return false;
  if (!floorOk(item, floor)) return false;
  if (item.biomes?.length && biomeId && !item.biomes.includes(biomeId)) return false;
  if (!item.biomes?.length && biomeId) {
    const span = floorRangeFor(item);
    const band = BIOME_FLOORS[biomeId];
    if (band && span && (span.maxFloor < band[0] || span.minFloor > band[1])) return false;
  }
  return true;
}

export function packRelicChannelEligible(item) {
  if (!item || item.slot) return false;
  if (isChaseIdentity(item) || item.curse || item.quest) return false;
  if (item.acquisition === 'unique' || item.acquisition === 'wrld' || item.acquisition === 'cursed') return false;
  return true;
}

export function packCampfireConsumableEligible(item) {
  if (!item) return false;
  if (isChaseIdentity(item) || item.quest) return false;
  return item.heal != null || item.healPct != null || item.healPerFloor != null
    || item.bombDmg != null || item.mana != null || item.cure
    || item.shopMaxTier != null || item.foodBuff;
}

export function classLootPool(classId, ctx = {}) {
  if (!isPackOn()) return [];
  return packEquipment().filter(i => classLootEligible(i, classId, ctx));
}

export function bloodlineLootPool(raceId, ctx = {}) {
  if (!isPackOn()) return [];
  return packEquipment().filter(i => bloodlineLootEligible(i, raceId, ctx));
}

export function biomeFindPool(ctx = {}) {
  if (!isPackOn()) return [];
  return packEquipment().filter(i => biomeFindEligible(i, ctx));
}

export function packRelicChannelPool() {
  if (!isPackOn()) return [];
  return packRelicList().filter(packRelicChannelEligible);
}

export function packCampfireConsumablePool() {
  if (!isPackOn()) return [];
  return packConsumableList().filter(packCampfireConsumableEligible);
}

export function pickWeighted(rng, list) {
  if (!list?.length) return null;
  const weighted = list.map(item => ({
    w: Math.max(1, item.lootWeight != null ? item.lootWeight : ({
      common: 50, uncommon: 30, rare: 14, epic: 5, legendary: 1,
    }[item.rarity] || 8)),
    item,
  }));
  return rng.weighted(weighted).item;
}

/** Competing channel roll used by loot, shops, bosses, trials, campfires. */
export function rollPackChannel(rng, run, { floor, biomeId, classId, raceId, prefer } = {}) {
  if (!isPackOn() || !rng) return null;
  const ctx = { floor: floor ?? run?.floor, biomeId: biomeId ?? run?.biomeId };
  const cls = classId || run?.classId;
  const race = raceId || run?.raceId;
  const tryClass = () => pickWeighted(rng, classLootPool(cls, ctx));
  const tryBlood = () => pickWeighted(rng, bloodlineLootPool(race, ctx));
  const tryBiome = () => pickWeighted(rng, biomeFindPool(ctx));
  if (prefer === 'class') return tryClass();
  if (prefer === 'bloodline') return tryBlood();
  if (prefer === 'biome_find') return tryBiome();
  if (cls && rng.chance(CLASS_LOOT_CHANCE)) return tryClass() || tryBlood() || tryBiome();
  if (race && rng.chance(BLOODLINE_LOOT_CHANCE)) return tryBlood() || tryBiome();
  if (rng.chance(BIOME_FIND_CHANCE)) return tryBiome();
  return null;
}

export function duplicatePolicy(item) {
  if (item?.rarity === 'wrld' || item?.wrld) return 'party_claim';
  if (item?.rarity === 'unique' || item?.unique) return 'character';
  if (item?.curse) return 'instance_bound';
  if (item?.quest || item?.exclusive) return 'grant_once';
  if (!item?.slot && packRelicChannelEligible(item)) return 'character';
  return 'affixed_instance';
}

export function recipientRule(outcome = {}, ev = null) {
  if (outcome.receive || outcome.recipient || outcome.pay) {
    return {
      pay: outcome.pay || 'actor',
      receive: outcome.receive || outcome.recipient || 'actor',
      otherPay: outcome.otherPay || null,
      otherCost: outcome.otherCost || null,
      identityScope: ev?.identityScope || 'actor',
    };
  }
  const scope = ev?.identityScope || 'actor';
  if (scope === 'any' || scope === 'party') {
    return { pay: 'actor', receive: 'actor', partyAware: true, identityScope: scope };
  }
  return { pay: 'actor', receive: 'actor', identityScope: scope || 'actor' };
}
