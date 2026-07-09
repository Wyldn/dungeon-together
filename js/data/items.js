// Equipment, relics, consumables. Rarity gates where things can drop.
// tier roughly tracks biome depth (1=forest ... 5=hell).

export const WEAPONS = [
  { id: 'rusty_sword', name: 'Rusty Sword', slot: 'weapon', rarity: 'common', tier: 1, atk: 2, desc: '+2 damage. Tetanus sold separately.', price: 25 },
  { id: 'hunting_bow', name: 'Hunting Bow', slot: 'weapon', rarity: 'common', tier: 1, atk: 2, dex: 1, desc: '+2 damage, +1 DEX.', price: 30 },
  { id: 'oak_staff', name: 'Oak Staff', slot: 'weapon', rarity: 'common', tier: 1, atk: 1, int: 2, desc: '+1 damage, +2 INT.', price: 30 },
  { id: 'steel_blade', name: 'Steel Blade', slot: 'weapon', rarity: 'uncommon', tier: 2, atk: 4, desc: '+4 damage. Honest work.', price: 70 },
  { id: 'runed_dagger', name: 'Runed Dagger', slot: 'weapon', rarity: 'uncommon', tier: 2, atk: 3, crit: 6, desc: '+3 damage, +6% crit.', price: 85 },
  { id: 'frost_brand', name: 'Frostbrand', slot: 'weapon', rarity: 'rare', tier: 3, atk: 6, freeze: 0.15, desc: '+6 damage, 15% chance to freeze on hit.', price: 160 },
  { id: 'storm_bow', name: 'Stormcaller Bow', slot: 'weapon', rarity: 'rare', tier: 3, atk: 5, dex: 3, crit: 8, desc: '+5 damage, +3 DEX, +8% crit.', price: 175 },
  { id: 'void_scepter', name: 'Void Scepter', slot: 'weapon', rarity: 'epic', tier: 4, atk: 8, int: 5, lifesteal: 0.15, desc: '+8 damage, +5 INT, 15% lifesteal.', price: 300 },
  { id: 'dragonfang', name: 'Dragonfang Greatsword', slot: 'weapon', rarity: 'epic', tier: 4, atk: 11, str: 3, desc: '+11 damage, +3 STR. Still warm.', price: 320 },
  { id: 'excalibur', name: 'Excalibur, the Promised Dawn', slot: 'weapon', rarity: 'legendary', tier: 5, atk: 15, str: 4, wis: 4, crit: 10, desc: 'The one-of-one blade of legend. +15 dmg, +4 STR/WIS, +10% crit.', price: 999, unique: true },
];

export const ARMORS = [
  { id: 'cloth_garb', name: 'Traveler’s Garb', slot: 'armor', rarity: 'common', tier: 1, def: 1, desc: '+1 defense. Fashionably doomed.', price: 20 },
  { id: 'leather_jerkin', name: 'Leather Jerkin', slot: 'armor', rarity: 'common', tier: 1, def: 2, desc: '+2 defense.', price: 40 },
  { id: 'chainmail', name: 'Chainmail Hauberk', slot: 'armor', rarity: 'uncommon', tier: 2, def: 4, desc: '+4 defense. Jingles ominously.', price: 90 },
  { id: 'wardweave', name: 'Wardweave Robe', slot: 'armor', rarity: 'rare', tier: 3, def: 3, int: 3, mp: 12, desc: '+3 defense, +3 INT, +12 max Mana.', price: 150 },
  { id: 'frostplate', name: 'Frostforged Plate', slot: 'armor', rarity: 'rare', tier: 3, def: 6, hp: 15, desc: '+6 defense, +15 max HP.', price: 190 },
  { id: 'shadow_shroud', name: 'Shroud of Still Shadows', slot: 'armor', rarity: 'epic', tier: 4, def: 5, dodge: 8, dex: 3, desc: '+5 defense, +8% dodge, +3 DEX.', price: 280 },
  { id: 'aegis', name: 'Aegis of the First Climber', slot: 'armor', rarity: 'legendary', tier: 5, def: 9, hp: 40, sanityGuard: 1, desc: '+9 defense, +40 HP. Sanity losses reduced by 1.', price: 850, unique: true },
];

export const ACCESSORIES = [
  { id: 'lucky_coin', name: 'Lucky Coin', slot: 'accessory', rarity: 'common', tier: 1, lk: 3, desc: '+3 Luck. Heads, you live.', price: 45 },
  { id: 'iron_ring', name: 'Iron Signet', slot: 'accessory', rarity: 'common', tier: 1, str: 2, hp: 8, desc: '+2 STR, +8 max HP.', price: 45 },
  { id: 'clarity_pendant', name: 'Pendant of Clarity', slot: 'accessory', rarity: 'uncommon', tier: 2, wis: 3, sanityGuard: 1, desc: '+3 WIS. Sanity losses reduced by 1.', price: 110 },
  { id: 'hawk_charm', name: 'Hawkeye Charm', slot: 'accessory', rarity: 'uncommon', tier: 2, crit: 8, desc: '+8% crit chance.', price: 100 },
  { id: 'vampire_fang', name: 'Vampire Fang', slot: 'accessory', rarity: 'rare', tier: 3, lifesteal: 0.12, desc: 'Heal 12% of damage you deal.', price: 180 },
  { id: 'greed_band', name: 'Band of Greed', slot: 'accessory', rarity: 'rare', tier: 3, goldMult: 1.35, desc: '+35% gold from all sources.', price: 200 },
  { id: 'phoenix_feather', name: 'Phoenix Feather', slot: 'accessory', rarity: 'epic', tier: 4, revive: true, desc: 'Once per run: survive a killing blow with 30% HP.', price: 350 },
  { id: 'kings_eye', name: 'Eye of the Nameless King', slot: 'accessory', rarity: 'legendary', tier: 5, int: 4, wis: 4, lk: 4, desc: '+4 INT/WIS/LK. It blinks when you lie.', price: 800, unique: true },
];

// Relics: passive run-defining effects (design doc: random relics, snowball builds)
export const RELICS = [
  { id: 'ember_heart', name: 'Ember Heart', rarity: 'uncommon', desc: 'Your attacks have +15% chance to burn.', burn: 0.15 },
  { id: 'frozen_tear', name: 'Frozen Tear', rarity: 'uncommon', desc: 'Your attacks have +12% chance to freeze.', freeze: 0.12 },
  { id: 'whetstone', name: 'Eternal Whetstone', rarity: 'common', desc: '+12% damage dealt.', dmgMult: 1.12 },
  { id: 'tortoise_shell', name: 'Tortoise Idol', rarity: 'common', desc: 'Take 10% less damage.', dmgTakenMult: 0.9 },
  { id: 'moon_dial', name: 'Moon Dial', rarity: 'uncommon', desc: 'Restore 6 Mana at the start of each battle turn (was 4).', manaRegen: 2 },
  { id: 'blood_chalice', name: 'Blood Chalice', rarity: 'rare', desc: 'Heal 8% max HP after every victory.', victoryHeal: 0.08 },
  { id: 'gamblers_die', name: 'Gambler’s Die', rarity: 'rare', desc: '+10% crit chance, +5% enemy crit chance. Live a little.', crit: 10, enemyCrit: 5 },
  { id: 'golden_idol', name: 'Golden Idol', rarity: 'rare', desc: '+50% gold from combat.', combatGoldMult: 1.5 },
  { id: 'sanity_lantern', name: 'Lantern of Reason', rarity: 'rare', desc: 'Sanity losses reduced by 2. The dark is just dark.', sanityGuard: 2 },
  { id: 'xp_tome', name: 'Tome of Echoed Deeds', rarity: 'rare', desc: '+30% experience gained.', xpMult: 1.3 },
  { id: 'mimic_tooth', name: 'Mimic Tooth', rarity: 'uncommon', desc: 'Chests are never mimics. Mimics hold grudges about this.', noMimic: true },
  { id: 'boss_bane', name: 'Regicide Nail', rarity: 'epic', desc: '+25% damage against bosses.', bossDmgMult: 1.25 },
  { id: 'second_wind', name: 'Second Wind Bellows', rarity: 'epic', desc: 'Heal 15% max HP when a floor begins and you are below 30%.', lowHpHeal: 0.15 },
  { id: 'demon_pact', name: 'Pact of the Patient Demon', rarity: 'epic', desc: '+30% damage dealt, but max Sanity reduced by 15. Read the fine print.', dmgMult: 1.3, maxSanity: -15 },
  { id: 'hourglass', name: 'Cracked Hourglass', rarity: 'epic', desc: 'Once per battle, surviving a killing blow leaves you at 1 HP instead.', deathward: true },
  { id: 'heros_ashes', name: 'Ashes of a Previous Hero', rarity: 'legendary', desc: '+3 to ALL stats. They almost made it. Carry them the rest of the way.', allStats: 3 },
];

export const CONSUMABLES = [
  { id: 'potion_s', name: 'Minor Healing Potion', rarity: 'common', desc: 'Restore 30 HP.', heal: 30, price: 25 },
  { id: 'potion_l', name: 'Greater Healing Potion', rarity: 'uncommon', desc: 'Restore 70 HP.', heal: 70, price: 60 },
  { id: 'mana_vial', name: 'Mana Vial', rarity: 'common', desc: 'Restore 25 Mana.', mana: 25, price: 25 },
  { id: 'calming_tea', name: 'Monastery Tea', rarity: 'uncommon', desc: 'Restore 15 Sanity. Tastes like being forgiven.', sanity: 15, price: 45 },
  { id: 'bomb', name: 'Alchemist’s Bomb', rarity: 'uncommon', desc: 'Deal 40 damage to all enemies.', bombDmg: 40, price: 55 },
  { id: 'smelling_salts', name: 'Smelling Salts', rarity: 'rare', desc: 'Cure all ailments and restore 20 HP.', cure: true, heal: 20, price: 70 },
];

export const ALL_EQUIPMENT = [...WEAPONS, ...ARMORS, ...ACCESSORIES];

export function itemById(id) {
  return ALL_EQUIPMENT.find(i => i.id === id)
    || RELICS.find(i => i.id === id)
    || CONSUMABLES.find(i => i.id === id);
}

// Drop tables ------------------------------------------------------------
const RARITY_W = { common: 50, uncommon: 30, rare: 14, epic: 5, legendary: 1 };

export function rollEquipment(rng, tier, luckBonus = 0) {
  const pool = ALL_EQUIPMENT.filter(i => i.tier <= tier && i.tier >= Math.max(1, tier - 1));
  const weighted = pool.map(i => ({ w: (RARITY_W[i.rarity] || 1) + (i.rarity !== 'common' ? luckBonus : 0), item: i }));
  return rng.weighted(weighted).item;
}

export function rollRelic(rng, owned = [], luckBonus = 0) {
  const pool = RELICS.filter(r => !owned.includes(r.id));
  if (!pool.length) return null;
  const weighted = pool.map(i => ({ w: (RARITY_W[i.rarity] || 1) + luckBonus, item: i }));
  return rng.weighted(weighted).item;
}
