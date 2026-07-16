// Equipment, relics, consumables.
// Slots (handoff §19): weapon, helmet, chest, legs, boots, accessory ×3.
// Weapons carry a wtype; classes define compatible types (§20). Equipping an
// incompatible weapon disables everything except Strike and Guard.
// Random loot applies affixes from js/data/affixes.js, gated by TDC power caps.

import { applyAffixes, finalizeLootItem } from './affixes.js';
import { CLASSES } from './classes.js';

export const EQUIP_SLOTS = ['weapon', 'helmet', 'chest', 'legs', 'boots', 'accessory1', 'accessory2', 'accessory3'];

export const WEAPONS = [
  // ---- starting weapons (one per class) ----
  { id: 'rusty_sword', name: 'Rusty Sword', slot: 'weapon', wtype: 'sword', rarity: 'common', tier: 1, atk: 2, desc: 'Sword · +2 damage. Tetanus sold separately.', price: 25 },
  { id: 'runed_shortsword', name: 'Runed Shortsword', slot: 'weapon', wtype: 'sword', rarity: 'common', tier: 1, atk: 2, int: 1, desc: 'Sword · +2 damage, +1 INT. A practice blade that still remembers its grammar.', price: 30 },
  { id: 'oak_staff', name: 'Oak Staff', slot: 'weapon', wtype: 'staff', rarity: 'common', tier: 1, atk: 1, int: 2, desc: 'Staff · +1 damage, +2 INT.', price: 30 },
  { id: 'hunting_bow', name: 'Hunting Bow', slot: 'weapon', wtype: 'bow', rarity: 'common', tier: 1, atk: 2, dex: 1, desc: 'Bow · +2 damage, +1 DEX.', price: 30 },
  { id: 'runed_dagger_worn', name: 'Worn Dagger', slot: 'weapon', wtype: 'dagger', rarity: 'common', tier: 1, atk: 2, crit: 3, desc: 'Dagger · +2 damage, +3% crit.', price: 25 },
  { id: 'hand_axe', name: 'Notched Hand Axe', slot: 'weapon', wtype: 'axe', rarity: 'common', tier: 1, atk: 2, str: 1, desc: 'Axe · +2 damage, +1 STR. The notches are not decorative.', price: 28 },
  { id: 'novice_mace', name: 'Novice\'s Mace', slot: 'weapon', wtype: 'mace', rarity: 'common', tier: 1, atk: 2, wis: 1, desc: 'Mace · +2 damage, +1 WIS.', price: 25 },
  { id: 'wraps', name: 'Cloth Wraps', slot: 'weapon', wtype: 'fist', rarity: 'common', tier: 1, atk: 2, dex: 1, desc: 'Fist · +2 damage, +1 DEX. Your hands were always the weapon.', price: 20 },

  // ---- found/shop weapons ----
  { id: 'steel_blade', name: 'Steel Blade', slot: 'weapon', wtype: 'sword', rarity: 'uncommon', tier: 2, atk: 4, desc: 'Sword · +4 damage. Honest work.', price: 70 },
  { id: 'battle_axe', name: 'Bearded Axe', slot: 'weapon', wtype: 'axe', rarity: 'uncommon', tier: 2, atk: 5, str: 1, desc: 'Axe · +5 damage, +1 STR.', price: 85 },
  { id: 'runed_dagger', name: 'Runed Dagger', slot: 'weapon', wtype: 'dagger', rarity: 'uncommon', tier: 2, atk: 3, crit: 6, desc: 'Dagger · +3 damage, +6% crit.', price: 85 },
  { id: 'pilgrims_cudgel', name: 'Pilgrim\'s Cudgel', slot: 'weapon', wtype: 'mace', rarity: 'uncommon', tier: 2, atk: 3, wis: 2, desc: 'Mace · +3 damage, +2 WIS.', price: 80 },
  { id: 'ashwood_staff', name: 'Ashwood Staff', slot: 'weapon', wtype: 'staff', rarity: 'uncommon', tier: 2, atk: 2, int: 3, mp: 8, desc: 'Staff · +2 damage, +3 INT, +8 max resource.', price: 90 },
  { id: 'tiger_wraps', name: 'Tigerhide Wraps', slot: 'weapon', wtype: 'fist', rarity: 'uncommon', tier: 2, atk: 4, dex: 2, desc: 'Fist · +4 damage, +2 DEX.', price: 85 },
  { id: 'frost_brand', name: 'Frostbrand', slot: 'weapon', wtype: 'sword', rarity: 'rare', tier: 3, atk: 6, freeze: 0.15, desc: 'Sword · +6 damage, 15% freeze on hit.', price: 160 },
  { id: 'storm_bow', name: 'Stormcaller Bow', slot: 'weapon', wtype: 'bow', rarity: 'rare', tier: 3, atk: 5, dex: 3, crit: 8, desc: 'Bow · +5 damage, +3 DEX, +8% crit.', price: 175 },
  { id: 'sun_mace', name: 'Morning Benediction', slot: 'weapon', wtype: 'mace', rarity: 'rare', tier: 3, atk: 6, wis: 3, desc: 'Mace · +6 damage, +3 WIS. Warm to the touch.', price: 170 },
  { id: 'void_scepter', name: 'Void Scepter', slot: 'weapon', wtype: 'staff', rarity: 'epic', tier: 4, atk: 8, int: 5, lifesteal: 0.15, desc: 'Staff · +8 damage, +5 INT, 15% lifesteal.', price: 300 },
  { id: 'dragonfang', name: 'Dragonfang Greatsword', slot: 'weapon', wtype: 'sword', rarity: 'epic', tier: 4, atk: 11, str: 3, desc: 'Sword · +11 damage, +3 STR. Still warm.', price: 320 },
  { id: 'comet_wraps', name: 'Comet-Trail Wraps', slot: 'weapon', wtype: 'fist', rarity: 'epic', tier: 4, atk: 9, dex: 4, initiative: 2, desc: 'Fist · +9 damage, +4 DEX, faster initiative.', price: 310 },
  // ---- extra variety across the worlds (each world outclasses the last) ----
  { id: 'war_pick', name: 'Ruinbreaker Pick', slot: 'weapon', wtype: 'axe', rarity: 'uncommon', tier: 2, atk: 4, str: 2, crit: 3, desc: 'Axe · +4 damage, +2 STR, +3% crit.', price: 90 },
  { id: 'moonlit_bow', name: 'Moonlit Longbow', slot: 'weapon', wtype: 'bow', rarity: 'rare', tier: 3, atk: 5, dex: 4, freeze: 0.1, desc: 'Bow · +5 damage, +4 DEX, 10% freeze on hit.', price: 175 },
  { id: 'assassins_kiss', name: 'Assassin\'s Kiss', slot: 'weapon', wtype: 'dagger', rarity: 'rare', tier: 3, atk: 4, crit: 12, lifesteal: 0.08, desc: 'Dagger · +4 damage, +12% crit, 8% lifesteal.', price: 180 },
  { id: 'warhammer', name: 'Sunken Warhammer', slot: 'weapon', wtype: 'mace', rarity: 'rare', tier: 4, atk: 8, str: 3, wis: 1, desc: 'Mace · +8 damage, +3 STR, +1 WIS.', price: 210 },
  { id: 'glacial_edge', name: 'Glacial Edge', slot: 'weapon', wtype: 'sword', rarity: 'rare', tier: 3, atk: 7, dex: 2, freeze: 0.18, desc: 'Sword · +7 damage, +2 DEX, 18% freeze.', price: 200 },
  { id: 'infernal_lash', name: 'Infernal Lash', slot: 'weapon', wtype: 'dagger', rarity: 'epic', tier: 5, atk: 10, dex: 4, burn: 0.2, desc: 'Dagger · +10 damage, +4 DEX, 20% burn.', price: 340 },
  { id: 'titan_maul', name: 'Titan\'s Maul', slot: 'weapon', wtype: 'mace', rarity: 'epic', tier: 5, atk: 13, str: 5, desc: 'Mace · +13 damage, +5 STR. Swings like a verdict.', price: 350 },
  // ---- class-flavored finds (widen event / shop / loot variety) ----
  { id: 'battle_cleaver', name: 'Battle Cleaver', slot: 'weapon', wtype: 'axe', rarity: 'uncommon', tier: 2, atk: 5, str: 2, desc: 'Axe · +5 damage, +2 STR. Made for splitting problems.', price: 88 },
  { id: 'farmer_sickle', name: 'Harvest Sickle', slot: 'weapon', wtype: 'dagger', rarity: 'uncommon', tier: 1, atk: 3, crit: 4, exclusive: true, desc: 'Dagger · +3 damage, +4% crit. Meant for wheat. Works on other things. (event)', price: 70 },
  { id: 'farmer_pitchfork', name: 'Pitchfork', slot: 'weapon', wtype: 'axe', rarity: 'uncommon', tier: 1, atk: 4, str: 1, exclusive: true, desc: 'Axe · +4 damage, +1 STR. Three tines, one opinion. (event)', price: 75 },
  { id: 'farmer_rake', name: 'Iron Rake', slot: 'weapon', wtype: 'axe', rarity: 'uncommon', tier: 1, atk: 3, dex: 1, exclusive: true, desc: 'Axe · +3 damage, +1 DEX. Rakes leaves; rakes faces. (event)', price: 70 },
  { id: 'elder_cane', name: 'Trialmaster\'s Cane', slot: 'weapon', wtype: 'staff', rarity: 'legendary', tier: 5, atk: 12, int: 5, wis: 5, mp: 16, exclusive: true, desc: 'Legendary staff · +12 dmg, +5 INT/WIS, +16 resource. (event)', price: 750 },
  { id: 'elder_blade', name: 'Lesson Steel', slot: 'weapon', wtype: 'sword', rarity: 'unique', tier: 5, atk: 22, str: 6, int: 6, crit: 12, dmgMult: 1.12, exclusive: true, unique: true, noAffix: true, desc: 'UNIQUE · +22 dmg, +6 STR/INT, +12% crit, +12% damage. The hard lesson.', price: 1350 },
  { id: 'raider_hatchet', name: 'Raider\'s Hatchet', slot: 'weapon', wtype: 'axe', rarity: 'rare', tier: 3, atk: 7, str: 2, crit: 5, desc: 'Axe · +7 damage, +2 STR, +5% crit.', price: 165 },
  { id: 'executioner_axe', name: 'Tower Executioner', slot: 'weapon', wtype: 'axe', rarity: 'epic', tier: 4, atk: 11, str: 4, crit: 6, desc: 'Axe · +11 damage, +4 STR, +6% crit. Still smells of paperwork.', price: 310 },
  { id: 'judge_gavel', name: 'Judge\'s Gavel', slot: 'weapon', wtype: 'mace', rarity: 'rare', tier: 3, atk: 6, wis: 2, str: 2, desc: 'Mace · +6 damage, +2 WIS, +2 STR. Sentences are optional.', price: 170 },
  { id: 'starwood_staff', name: 'Starwood Staff', slot: 'weapon', wtype: 'staff', rarity: 'uncommon', tier: 2, atk: 3, int: 3, mp: 6, desc: 'Staff · +3 damage, +3 INT, +6 max resource.', price: 95 },
  { id: 'glass_wand', name: 'Glassfire Wand', slot: 'weapon', wtype: 'staff', rarity: 'rare', tier: 3, atk: 4, int: 4, burn: 0.12, desc: 'Staff · +4 damage, +4 INT, 12% burn on hit.', price: 175 },
  { id: 'astral_focus', name: 'Astral Focus', slot: 'weapon', wtype: 'staff', rarity: 'epic', tier: 4, atk: 7, int: 6, mp: 14, manaRegen: 1, desc: 'Staff · +7 damage, +6 INT, +14 resource, +1 resource regen/turn.', price: 315 },
  { id: 'trailbow', name: 'Trailbow', slot: 'weapon', wtype: 'bow', rarity: 'uncommon', tier: 2, atk: 4, dex: 2, desc: 'Bow · +4 damage, +2 DEX. Quiet in the undergrowth.', price: 85 },
  { id: 'thornknife', name: 'Thornknife', slot: 'weapon', wtype: 'dagger', rarity: 'rare', tier: 3, atk: 4, dex: 3, crit: 7, desc: 'Dagger · +4 damage, +3 DEX, +7% crit. Barbed for keeping.', price: 160 },
  { id: 'skyneedle', name: 'Skyneedle Bow', slot: 'weapon', wtype: 'bow', rarity: 'epic', tier: 4, atk: 8, dex: 5, crit: 10, desc: 'Bow · +8 damage, +5 DEX, +10% crit. Arrows forget gravity.', price: 320 },
  { id: 'smokeknife', name: 'Smokeknife', slot: 'weapon', wtype: 'dagger', rarity: 'rare', tier: 3, atk: 4, dodge: 5, crit: 8, desc: 'Dagger · +4 damage, +5% dodge, +8% crit.', price: 170 },
  { id: 'silk_rapier', name: 'Silk Rapier', slot: 'weapon', wtype: 'sword', rarity: 'uncommon', tier: 2, atk: 4, dex: 2, lk: 1, desc: 'Sword · +4 damage, +2 DEX, +1 LK. A performer\'s edge.', price: 90 },
  { id: 'stage_rapier', name: 'Stage Rapier', slot: 'weapon', wtype: 'sword', rarity: 'rare', tier: 3, atk: 5, dex: 2, lk: 3, fameGainMult: 1.1, desc: 'Sword · +5 damage, +2 DEX, +3 LK. Applause is optional.', price: 180 },
  { id: 'censer_mace', name: 'Censer Mace', slot: 'weapon', wtype: 'mace', rarity: 'rare', tier: 3, atk: 5, wis: 4, mp: 8, desc: 'Mace · +5 damage, +4 WIS, +8 max resource. Smokes faintly.', price: 175 },
  { id: 'iron_knuckles', name: 'Iron Knuckles', slot: 'weapon', wtype: 'fist', rarity: 'uncommon', tier: 2, atk: 5, str: 1, dex: 1, desc: 'Fist · +5 damage, +1 STR, +1 DEX.', price: 80 },
  { id: 'storm_wraps', name: 'Storm Wraps', slot: 'weapon', wtype: 'fist', rarity: 'epic', tier: 4, atk: 8, dex: 4, crit: 6, initiative: 1, desc: 'Fist · +8 damage, +4 DEX, +6% crit, quicker starts.', price: 300 },
  { id: 'pact_blade', name: 'Pact Blade', slot: 'weapon', wtype: 'dagger', rarity: 'rare', tier: 3, atk: 5, int: 2, lifesteal: 0.1, desc: 'Dagger · +5 damage, +2 INT, 10% lifesteal. Signed in fine print.', price: 185 },
  { id: 'hex_stiletto', name: 'Hex Stiletto', slot: 'weapon', wtype: 'dagger', rarity: 'epic', tier: 4, atk: 7, int: 3, dex: 2, burn: 0.12, desc: 'Dagger · +7 damage, +3 INT, +2 DEX, 12% burn.', price: 305 },
  { id: 'grave_spike', name: 'Grave Spike', slot: 'weapon', wtype: 'staff', rarity: 'rare', tier: 3, atk: 5, int: 3, lifesteal: 0.08, desc: 'Staff · +5 damage, +3 INT, 8% lifesteal. Cold as a nameplate.', price: 180 },
  // ---- event-exclusive gear (never in random loot / shops) ----
  { id: 'necro_rod', name: 'Rod of the Pale Choir', slot: 'weapon', wtype: 'staff', rarity: 'epic', tier: 4, atk: 6, int: 7, lifesteal: 0.1, exclusive: true, desc: 'Staff · +6 damage, +7 INT, 10% lifesteal. Whispers the names of the buried. (event-exclusive)', price: 360 },
  // ---- legendary (ordinary loot can find these; below UNIQUE) ----
  { id: 'sunforged_blade', name: 'Sunforged Blade', slot: 'weapon', wtype: 'sword', rarity: 'legendary', tier: 5, atk: 14, str: 5, crit: 10, dmgMult: 1.1, desc: 'Legendary · +14 dmg, +5 STR, +10% crit, +10% damage. Forged for a name the tower still remembers.', price: 720 },
  { id: 'skyfall_bow', name: 'Skyfall Bow', slot: 'weapon', wtype: 'bow', rarity: 'legendary', tier: 5, atk: 13, dex: 6, crit: 14, initiative: 1, desc: 'Legendary · +13 dmg, +6 DEX, +14% crit, quicker starts. Arrows find the horizon.', price: 700 },
  { id: 'archon_staff', name: 'Archon Staff', slot: 'weapon', wtype: 'staff', rarity: 'legendary', tier: 5, atk: 12, int: 7, mp: 22, crit: 6, desc: 'Legendary · +12 dmg, +7 INT, +22 resource, +6% crit.', price: 710 },
  // ---- UNIQUE (hand-authored; never in ordinary rolls) ----
  { id: 'excalibur', name: 'Excalibur, the Promised Dawn', slot: 'weapon', wtype: 'sword', rarity: 'unique', tier: 5, atk: 26, str: 8, wis: 6, crit: 16, dmgMult: 1.15, desc: 'UNIQUE · the one-of-one blade. +26 dmg, +8 STR, +6 WIS, +16% crit, +15% damage.', price: 1400, unique: true, noAffix: true },
  { id: 'worldsplitter', name: 'Worldsplitter', slot: 'weapon', wtype: 'axe', rarity: 'unique', tier: 5, atk: 28, str: 10, crit: 12, dmgMult: 1.18, desc: 'UNIQUE · an axe that remembers continents. +28 dmg, +10 STR, +12% crit, +18% damage.', price: 1350, unique: true, noAffix: true },
  { id: 'quietus', name: 'Quietus', slot: 'weapon', wtype: 'dagger', rarity: 'unique', tier: 5, atk: 20, dex: 9, crit: 24, lifesteal: 0.16, dmgMult: 1.08, desc: 'UNIQUE · +20 dmg, +9 DEX, +24% crit, 16% lifesteal, +8% damage. Endings arrive early.', price: 1300, unique: true, noAffix: true },
  // ---- WRLD (one of each per run / party; never ordinary loot) ----
  { id: 'caladbolg', name: 'Caladbolg, the World-Cleaver', slot: 'weapon', wtype: 'sword', rarity: 'wrld', tier: 5, atk: 34, str: 12, wis: 6, crit: 18, dmgMult: 1.22, desc: 'WRLD · the blade that split a kingdom in half. +34 dmg, +12 STR, +6 WIS, +18% crit, +22% damage. There is only one.', price: 3200, wrld: true, noAffix: true },
  { id: 'merlin_staff', name: 'Merlin\'s Staff', slot: 'weapon', wtype: 'staff', rarity: 'wrld', tier: 5, atk: 30, int: 14, wis: 8, mp: 45, manaRegen: 2, crit: 12, dmgMult: 1.18, desc: 'WRLD · the staff of the world\'s first archmage. +30 dmg, +14 INT, +8 WIS, +45 resource, +2 regen/turn, +12% crit, +18% damage.', price: 3200, wrld: true, noAffix: true },
  { id: 'artemis_bow', name: 'Artemis\' Moonbow', slot: 'weapon', wtype: 'bow', rarity: 'wrld', tier: 5, atk: 32, dex: 14, crit: 22, initiative: 2, dmgMult: 1.15, desc: 'WRLD · arrows that choose their own sky. +32 dmg, +14 DEX, +22% crit, +2 initiative, +15% damage.', price: 3100, wrld: true, noAffix: true },
  { id: 'carnwennan', name: 'Carnwennan', slot: 'weapon', wtype: 'dagger', rarity: 'wrld', tier: 5, atk: 28, dex: 12, crit: 28, lifesteal: 0.18, dmgMult: 1.12, desc: 'WRLD · the white-hilted knife that ends arguments. +28 dmg, +12 DEX, +28% crit, 18% lifesteal, +12% damage.', price: 3000, wrld: true, noAffix: true },
  { id: 'mjolnir', name: 'Mjölnir, the World-Hammer', slot: 'weapon', wtype: 'mace', rarity: 'wrld', tier: 5, atk: 33, str: 10, wis: 8, crit: 10, dmgMult: 1.2, desc: 'WRLD · only the worthy lift it. +33 dmg, +10 STR, +8 WIS, +10% crit, +20% damage.', price: 3150, wrld: true, noAffix: true },
  { id: 'world_fang', name: 'Worldfang', slot: 'weapon', wtype: 'axe', rarity: 'wrld', tier: 5, atk: 36, str: 14, crit: 14, dmgMult: 1.24, desc: 'WRLD · forged from a mountain\'s last scream. +36 dmg, +14 STR, +14% crit, +24% damage.', price: 3150, wrld: true, noAffix: true },
  { id: 'vajra', name: 'Vajra of the Still Point', slot: 'weapon', wtype: 'fist', rarity: 'wrld', tier: 5, atk: 30, dex: 12, str: 8, crit: 16, initiative: 2, dmgMult: 1.15, desc: 'WRLD · the fist that ends storms. +30 dmg, +12 DEX, +8 STR, +16% crit, +2 initiative, +15% damage.', price: 3000, wrld: true, noAffix: true },
];

export const HELMETS = [
  { id: 'leather_cap', name: 'Leather Cap', slot: 'helmet', rarity: 'common', tier: 1, def: 1, desc: '+1 defense. Better than hair.', price: 25 },
  { id: 'iron_helm', name: 'Iron Helm', slot: 'helmet', rarity: 'uncommon', tier: 2, def: 2, hp: 6, desc: '+2 defense, +6 max HP.', price: 70 },
  { id: 'scholars_hood', name: 'Scholar\'s Hood', slot: 'helmet', rarity: 'rare', tier: 3, def: 1, int: 3, mp: 10, desc: '+1 defense, +3 INT, +10 max resource.', price: 140 },
  { id: 'warden_circlet', name: 'Warden\'s Circlet', slot: 'helmet', rarity: 'rare', tier: 3, def: 2, dex: 2, crit: 4, desc: '+2 defense, +2 DEX, +4% crit.', price: 150 },
  { id: 'dragonbone_helm', name: 'Dragonbone Helm', slot: 'helmet', rarity: 'epic', tier: 4, def: 4, hp: 15, str: 2, desc: '+4 defense, +15 HP, +2 STR.', price: 280 },
  { id: 'crown_of_ash', name: 'Crown of Ash', slot: 'helmet', rarity: 'epic', tier: 5, def: 3, int: 4, wis: 2, mp: 14, desc: '+3 defense, +4 INT, +2 WIS, +14 max resource.', price: 320 },
  { id: 'scout_coif', name: 'Scout\'s Coif', slot: 'helmet', rarity: 'uncommon', tier: 2, def: 1, dex: 2, dodge: 3, desc: '+1 defense, +2 DEX, +3% dodge.', price: 75 },
  { id: 'farmer_hat', name: 'Farmer\'s Hat', slot: 'helmet', rarity: 'uncommon', tier: 1, def: 1, wis: 1, hp: 4, exclusive: true, desc: '+1 defense, +1 WIS, +4 HP. Keeps the sun — and judgment — off. (event)', price: 55 },
  { id: 'veteran_helm', name: 'Oathbound Helm', slot: 'helmet', rarity: 'rare', tier: 3, def: 3, str: 2, hp: 8, exclusive: true, desc: '+3 defense, +2 STR, +8 HP. Still polished for a review that never comes. (event)', price: 200 },
  { id: 'scholar_cap', name: 'Apostate\'s Cap', slot: 'helmet', rarity: 'rare', tier: 3, def: 1, int: 3, mp: 10, exclusive: true, desc: '+1 defense, +3 INT, +10 resource. Smells of spoiled footnotes. (event)', price: 195 },
  { id: 'pathfinder_hood', name: 'Trail Hood', slot: 'helmet', rarity: 'rare', tier: 3, def: 2, dex: 3, crit: 4, exclusive: true, desc: '+2 defense, +3 DEX, +4% crit. Leaves do not snag it. (event)', price: 200 },
  { id: 'axe_pack_helm', name: 'Bearded Helm', slot: 'helmet', rarity: 'rare', tier: 3, def: 3, str: 2, lk: 1, hp: 8, exclusive: true, desc: '+3 defense, +2 STR, +1 LK, +8 HP. The nose-guard has opinions. (event)', price: 205 },
  { id: 'elder_circlet', name: 'Elder\'s Circlet', slot: 'helmet', rarity: 'legendary', tier: 5, def: 4, wis: 4, int: 3, mp: 12, exclusive: true, desc: 'Legendary · +4 DEF, +4 WIS, +3 INT, +12 resource. A quiet crown. (event)', price: 700 },
  { id: 'elder_crown', name: 'Crown of Quiet Trials', slot: 'helmet', rarity: 'unique', tier: 5, def: 6, wis: 6, int: 6, lk: 4, mp: 20, exclusive: true, unique: true, noAffix: true, desc: 'UNIQUE · +6 DEF, +6 WIS/INT, +4 LK, +20 resource. Earned, not found.', price: 1300 },
  { id: 'prayer_veil', name: 'Prayer Veil', slot: 'helmet', rarity: 'rare', tier: 3, def: 1, wis: 3, mp: 8, desc: '+1 defense, +3 WIS, +8 max resource.', price: 145 },
  { id: 'bone_circlet', name: 'Bone Circlet', slot: 'helmet', rarity: 'rare', tier: 3, def: 2, int: 2, lifesteal: 0.05, exclusive: true, desc: '+2 defense, +2 INT, 5% lifesteal. (event-exclusive)', price: 190 },
  { id: 'horizon_crown', name: 'Crown of the Horizon', slot: 'helmet', rarity: 'wrld', tier: 5, def: 10, int: 8, wis: 8, lk: 6, mp: 24, crit: 8, desc: 'WRLD · the crown that sees past the tower. +10 DEF, +8 INT/WIS, +6 LK, +24 resource, +8% crit.', price: 2800, wrld: true, noAffix: true },
];

export const CHEST_ARMOR = [
  { id: 'cloth_garb', name: 'Traveler\'s Garb', slot: 'chest', rarity: 'common', tier: 1, def: 1, desc: '+1 defense. Fashionably doomed.', price: 20 },
  { id: 'leather_jerkin', name: 'Leather Jerkin', slot: 'chest', rarity: 'common', tier: 1, def: 2, desc: '+2 defense.', price: 40 },
  { id: 'chainmail', name: 'Chainmail Hauberk', slot: 'chest', rarity: 'uncommon', tier: 2, def: 4, desc: '+4 defense. Jingles ominously.', price: 90 },
  { id: 'wardweave', name: 'Wardweave Robe', slot: 'chest', rarity: 'rare', tier: 3, def: 3, int: 3, mp: 12, desc: '+3 defense, +3 INT, +12 max resource.', price: 150 },
  { id: 'frostplate', name: 'Frostforged Plate', slot: 'chest', rarity: 'rare', tier: 3, def: 6, hp: 15, desc: '+6 defense, +15 max HP.', price: 190 },
  { id: 'shadow_shroud', name: 'Shroud of Still Shadows', slot: 'chest', rarity: 'epic', tier: 4, def: 5, dodge: 8, dex: 3, desc: '+5 defense, +8% dodge, +3 DEX.', price: 280 },
  { id: 'mage_regalia', name: 'Archmagus Regalia', slot: 'chest', rarity: 'epic', tier: 5, def: 4, int: 5, wis: 3, mp: 20, desc: '+4 defense, +5 INT, +3 WIS, +20 max resource.', price: 320 },
  { id: 'meditation_sash', name: 'Meditation Sash', slot: 'chest', rarity: 'uncommon', tier: 2, def: 2, dex: 2, wis: 1, desc: '+2 defense, +2 DEX, +1 WIS. Ties like a promise.', price: 85 },
  { id: 'farmer_tunic', name: 'Farmer\'s Tunic', slot: 'chest', rarity: 'uncommon', tier: 1, def: 2, hp: 8, exclusive: true, desc: '+2 defense, +8 HP. Patched thrice, still proud. (event)', price: 60 },
  { id: 'veteran_cuirass', name: 'Veteran\'s Cuirass', slot: 'chest', rarity: 'rare', tier: 3, def: 5, str: 2, hp: 12, exclusive: true, desc: '+5 defense, +2 STR, +12 HP. Dents with stories. (event)', price: 220 },
  { id: 'axe_pack_mail', name: 'Sea-Reaver Mail', slot: 'chest', rarity: 'rare', tier: 3, def: 5, str: 3, hp: 10, exclusive: true, desc: '+5 defense, +3 STR, +10 HP. Salt in every ring. (event)', price: 225 },
  { id: 'scholar_robe', name: 'Tower Scholar\'s Robe', slot: 'chest', rarity: 'rare', tier: 3, def: 3, int: 4, mp: 14, exclusive: true, desc: '+3 defense, +4 INT, +14 resource. (event)', price: 220 },
  { id: 'vanguard_cuirass', name: 'Vanguard Cuirass', slot: 'chest', rarity: 'rare', tier: 3, def: 5, str: 2, hp: 10, desc: '+5 defense, +2 STR, +10 HP.', price: 185 },
  { id: 'grave_shroud', name: 'Grave Shroud', slot: 'chest', rarity: 'rare', tier: 3, def: 3, int: 3, mp: 10, exclusive: true, desc: '+3 defense, +3 INT, +10 resource. (event-exclusive)', price: 210 },
  // event-exclusive: the necromancer\'s coat + the vampire\'s cape (§1, §16)
  { id: 'necro_regalia', name: 'Regalia of the Pale Choir', slot: 'chest', rarity: 'epic', tier: 4, def: 4, int: 6, mp: 16, exclusive: true, desc: '+4 defense, +6 INT, +16 max resource. Scales with the dead you command. (event-exclusive)', price: 340 },
  { id: 'vampire_cloak', name: 'Cloak of the Crimson Court', slot: 'chest', rarity: 'rare', tier: 3, def: 3, dodge: 6, lifesteal: 0.1, exclusive: true, desc: '+3 defense, +6% dodge, 10% lifesteal. Torn from a vampire that misjudged you. (event-exclusive)', price: 260 },
  { id: 'mythril_cuirass', name: 'Mythril Cuirass', slot: 'chest', rarity: 'legendary', tier: 5, def: 9, hp: 36, str: 3, dmgTakenMult: 0.92, desc: 'Legendary · +9 defense, +36 HP, +3 STR, take 8% less damage.', price: 680 },
  { id: 'aegis', name: 'Aegis of the First Climber', slot: 'chest', rarity: 'unique', tier: 5, def: 14, hp: 70, str: 4, wis: 3, dmgTakenMult: 0.82, desc: 'UNIQUE · +14 defense, +70 HP, +4 STR, +3 WIS, take 18% less damage.', price: 1200, unique: true, noAffix: true },
  { id: 'starfall_mail', name: 'Starfall Mail', slot: 'chest', rarity: 'unique', tier: 5, def: 11, int: 7, wis: 5, mp: 36, manaRegen: 2, desc: 'UNIQUE · +11 defense, +7 INT, +5 WIS, +36 resource, +2 resource regen/turn.', price: 1250, unique: true, noAffix: true },
  { id: 'worldspine_plate', name: 'Worldspine Plate', slot: 'chest', rarity: 'wrld', tier: 5, def: 20, hp: 110, str: 8, wis: 6, dmgTakenMult: 0.72, desc: 'WRLD · armor grown from the tower\'s own bones. +20 DEF, +110 HP, +8 STR, +6 WIS, take 28% less damage.', price: 3000, wrld: true, noAffix: true },
];

export const LEG_ARMOR = [
  { id: 'cloth_trousers', name: 'Sturdy Trousers', slot: 'legs', rarity: 'common', tier: 1, def: 1, desc: '+1 defense. Pockets included.', price: 20 },
  { id: 'chain_leggings', name: 'Chain Leggings', slot: 'legs', rarity: 'uncommon', tier: 2, def: 2, hp: 5, desc: '+2 defense, +5 max HP.', price: 65 },
  { id: 'windstriders', name: 'Windstrider Greaves', slot: 'legs', rarity: 'rare', tier: 3, def: 2, dex: 2, initiative: 1, desc: '+2 defense, +2 DEX, quicker into the fray.', price: 150 },
  { id: 'warplate_legs', name: 'Warplate Legguards', slot: 'legs', rarity: 'rare', tier: 4, def: 5, hp: 12, desc: '+5 defense, +12 max HP.', price: 200 },
  { id: 'infernal_greaves', name: 'Infernal Greaves', slot: 'legs', rarity: 'epic', tier: 5, def: 4, str: 3, dodge: 4, desc: '+4 defense, +3 STR, +4% dodge.', price: 300 },
  { id: 'ranger_chaps', name: 'Ranger\'s Chaps', slot: 'legs', rarity: 'uncommon', tier: 2, def: 2, dex: 2, dodge: 2, desc: '+2 defense, +2 DEX, +2% dodge.', price: 70 },
  { id: 'farmer_pants', name: 'Farmer\'s Trousers', slot: 'legs', rarity: 'uncommon', tier: 1, def: 1, hp: 6, exclusive: true, desc: '+1 defense, +6 HP. Mud is a feature. (event)', price: 50 },
  { id: 'duelist_hose', name: 'Duelist\'s Hose', slot: 'legs', rarity: 'rare', tier: 3, def: 2, dex: 3, crit: 4, desc: '+2 defense, +3 DEX, +4% crit.', price: 155 },
];

export const BOOTS = [
  { id: 'worn_boots', name: 'Worn Boots', slot: 'boots', rarity: 'common', tier: 1, def: 1, desc: '+1 defense. They know the road.', price: 20 },
  { id: 'scouts_boots', name: 'Scout\'s Boots', slot: 'boots', rarity: 'uncommon', tier: 2, dodge: 4, initiative: 1, desc: '+4% dodge, quicker initiative.', price: 75 },
  { id: 'stoneroot_sabatons', name: 'Stoneroot Sabatons', slot: 'boots', rarity: 'rare', tier: 3, def: 3, hp: 10, desc: '+3 defense, +10 max HP.', price: 145 },
  { id: 'frostwalkers', name: 'Frostwalker Boots', slot: 'boots', rarity: 'rare', tier: 3, def: 2, dex: 2, dodge: 3, desc: '+2 defense, +2 DEX, +3% dodge.', price: 150 },
  { id: 'seven_league', name: 'Seven-League Boots', slot: 'boots', rarity: 'epic', tier: 4, dodge: 6, dex: 3, initiative: 3, desc: '+6% dodge, +3 DEX, always first to the argument.', price: 290 },
  { id: 'emberstride', name: 'Emberstride Sabatons', slot: 'boots', rarity: 'epic', tier: 5, def: 4, hp: 14, initiative: 2, desc: '+4 defense, +14 HP, quicker initiative.', price: 310 },
  { id: 'softstep_slippers', name: 'Softstep Slippers', slot: 'boots', rarity: 'uncommon', tier: 2, dodge: 5, lk: 1, desc: '+5% dodge, +1 LK. For exits that weren\'t doors.', price: 80 },
  { id: 'dawnstriders', name: 'Dawnstriders', slot: 'boots', rarity: 'wrld', tier: 5, dodge: 12, dex: 8, initiative: 4, lk: 4, def: 4, desc: 'WRLD · boots that walk into stories. +12% dodge, +8 DEX, +4 initiative, +4 LK, +4 DEF.', price: 2700, wrld: true, noAffix: true },
];

export const ACCESSORIES = [
  { id: 'lucky_coin', name: 'Lucky Coin', slot: 'accessory', rarity: 'common', tier: 1, lk: 3, desc: '+3 Luck. Heads, you live.', price: 45 },
  { id: 'iron_ring', name: 'Iron Signet', slot: 'accessory', rarity: 'common', tier: 1, str: 2, hp: 8, desc: '+2 STR, +8 max HP.', price: 45 },
  { id: 'hawk_charm', name: 'Hawkeye Charm', slot: 'accessory', rarity: 'uncommon', tier: 2, crit: 8, desc: '+8% crit chance.', price: 100 },
  { id: 'herald_ribbon', name: 'Herald\'s Ribbon', slot: 'accessory', rarity: 'uncommon', tier: 2, fameGainMult: 1.3, desc: 'Word of your deeds travels 30% further.', price: 95 },
  { id: 'seer_monocle', name: 'Seer\'s Monocle', slot: 'accessory', rarity: 'rare', tier: 3, reveal: 'ranks', wis: 2, desc: 'While worn: see your own LIVE stat ranks. +2 WIS.', price: 210 },
  { id: 'vampire_fang', name: 'Vampire Fang', slot: 'accessory', rarity: 'rare', tier: 3, lifesteal: 0.12, desc: 'Heal 12% of damage you deal.', price: 180 },
  { id: 'greed_band', name: 'Band of Greed', slot: 'accessory', rarity: 'rare', tier: 3, goldMult: 1.35, desc: '+35% gold from all sources.', price: 200 },
  { id: 'focus_ring', name: 'Ring of Clear Focus', slot: 'accessory', rarity: 'uncommon', tier: 2, mp: 12, int: 1, desc: '+12 max resource, +1 INT.', price: 110 },
  { id: 'berserker_totem', name: 'Berserker\'s Totem', slot: 'accessory', rarity: 'rare', tier: 3, dmgMult: 1.12, str: 2, desc: '+12% damage dealt, +2 STR.', price: 210 },
  { id: 'warding_charm', name: 'Warding Charm', slot: 'accessory', rarity: 'rare', tier: 3, def: 2, dmgTakenMult: 0.94, desc: '+2 defense, take 6% less damage.', price: 200 },
  { id: 'necro_phial', name: 'Phial of the Pale Choir', slot: 'accessory', rarity: 'epic', tier: 4, int: 4, mp: 12, manaRegen: 2, exclusive: true, desc: '+4 INT, +12 max resource, +2 resource regen/turn. (event-exclusive)', price: 300 },
  { id: 'phoenix_feather', name: 'Phoenix Feather', slot: 'accessory', rarity: 'epic', tier: 4, revive: true, desc: 'Once per run: survive a killing blow with 30% HP (matches Guard / co-op revive).', price: 350 },
  { id: 'crown_seal', name: 'Crown Seal', slot: 'accessory', rarity: 'legendary', tier: 5, int: 5, wis: 4, lk: 4, mp: 16, desc: 'Legendary · +5 INT, +4 WIS, +4 LK, +16 resource. A court\'s last signature.', price: 650 },
  { id: 'kings_eye', name: 'Eye of the Nameless King', slot: 'accessory', rarity: 'unique', tier: 5, reveal: 'exact', int: 8, wis: 8, lk: 8, crit: 6, desc: 'UNIQUE · see EXACT live stats and enemy strength. +8 INT/WIS/LK, +6% crit.', price: 1100, unique: true, noAffix: true },
  { id: 'perpetual_dial', name: 'The Perpetual Dial', slot: 'accessory', rarity: 'unique', tier: 5, manaRegen: 3, mp: 30, int: 5, wis: 5, desc: 'UNIQUE · +3 resource regen/turn, +30 max resource, +5 INT/WIS. Time prefers you.', price: 1150, unique: true, noAffix: true },
  { id: 'protagonists_ring', name: 'Ring of the Protagonist', slot: 'accessory', rarity: 'wrld', tier: 5, allStats: 4, crit: 10, dmgMult: 1.1, desc: 'WRLD · the ring worn by the story\'s chosen. +4 to ALL stats, +10% crit, +10% damage.', price: 2900, wrld: true, noAffix: true },
  { id: 'fateweaver_locket', name: 'Fateweaver\'s Locket', slot: 'accessory', rarity: 'wrld', tier: 5, reveal: 'exact', lk: 12, wis: 8, int: 6, fameGainMult: 1.4, desc: 'WRLD · see exact stats; +12 LK, +8 WIS, +6 INT; fame +40%. Destiny keeps receipts.', price: 2850, wrld: true, noAffix: true },
  // ---- class / calling charms ----
  { id: 'vanguard_buckle', name: 'Vanguard Buckle', slot: 'accessory', rarity: 'uncommon', tier: 2, str: 2, hp: 10, desc: '+2 STR, +10 HP. Holds a belt and a grudge.', price: 95 },
  { id: 'arcane_pendant', name: 'Arcane Pendant', slot: 'accessory', rarity: 'uncommon', tier: 2, int: 2, mp: 10, desc: '+2 INT, +10 max resource.', price: 100 },
  { id: 'fletcher_ring', name: 'Fletcher\'s Ring', slot: 'accessory', rarity: 'uncommon', tier: 2, dex: 2, crit: 5, desc: '+2 DEX, +5% crit.', price: 100 },
  { id: 'thieves_locket', name: 'Thief\'s Locket', slot: 'accessory', rarity: 'uncommon', tier: 2, dex: 2, lk: 2, dodge: 3, desc: '+2 DEX, +2 LK, +3% dodge.', price: 105 },
  { id: 'prayer_beads', name: 'Prayer Beads', slot: 'accessory', rarity: 'uncommon', tier: 2, wis: 2, mp: 8, desc: '+2 WIS, +8 max resource.', price: 100 },
  { id: 'monk_bracelet', name: 'Monk\'s Bracelet', slot: 'accessory', rarity: 'uncommon', tier: 2, dex: 2, str: 1, initiative: 1, desc: '+2 DEX, +1 STR, quicker initiative.', price: 95 },
  { id: 'binding_sigil', name: 'Binding Sigil', slot: 'accessory', rarity: 'rare', tier: 3, int: 2, lk: 2, lifesteal: 0.06, desc: '+2 INT, +2 LK, 6% lifesteal.', price: 190 },
  { id: 'encore_medallion', name: 'Encore Medallion', slot: 'accessory', rarity: 'uncommon', tier: 2, lk: 2, fameGainMult: 1.2, desc: '+2 LK; fame travels 20% further.', price: 110 },
  { id: 'lyre_charm', name: 'Lyre Charm', slot: 'accessory', rarity: 'rare', tier: 3, lk: 3, dex: 2, fameGainMult: 1.15, desc: '+3 LK, +2 DEX; fame +15%.', price: 185 },
  { id: 'spellthread', name: 'Spellthread Band', slot: 'accessory', rarity: 'rare', tier: 3, int: 3, mp: 14, desc: '+3 INT, +14 max resource.', price: 195 },
  { id: 'wellspring_band', name: 'Wellspring Band', slot: 'accessory', rarity: 'epic', tier: 4, int: 2, wis: 2, mp: 10, manaRegen: 1, desc: '+2 INT, +2 WIS, +10 resource, +1 resource regen/turn.', price: 280 },
  { id: 'quiver_pin', name: 'Quiver Pin', slot: 'accessory', rarity: 'rare', tier: 3, dex: 3, crit: 6, desc: '+3 DEX, +6% crit. Holds nothing; aims everything.', price: 180 },
  { id: 'oath_seal', name: 'Oath Seal', slot: 'accessory', rarity: 'rare', tier: 3, wis: 3, def: 1, hp: 8, desc: '+3 WIS, +1 defense, +8 HP.', price: 185 },
  { id: 'war_badge', name: 'War Badge', slot: 'accessory', rarity: 'rare', tier: 3, str: 3, dmgMult: 1.06, desc: '+3 STR, +6% damage dealt.', price: 190 },
  { id: 'sea_token', name: 'Sea Token', slot: 'accessory', rarity: 'rare', tier: 3, str: 2, lk: 2, dmgMult: 1.05, exclusive: true, desc: '+2 STR, +2 LK, +5% damage. A coin from a coast that isn\'t here. (event)', price: 195 },
  { id: 'shadow_earring', name: 'Shadow Earring', slot: 'accessory', rarity: 'rare', tier: 3, dex: 2, dodge: 6, crit: 4, desc: '+2 DEX, +6% dodge, +4% crit.', price: 185 },
  { id: 'mire_totem', name: 'Mire Totem', slot: 'accessory', rarity: 'uncommon', tier: 2, hp: 12, wis: 1, desc: '+12 HP, +1 WIS. Smells like patience.', price: 90 },
  { id: 'ruins_keyring', name: 'Ruins Keyring', slot: 'accessory', rarity: 'uncommon', tier: 2, lk: 2, goldMult: 1.1, desc: '+2 LK, +10% gold. Most keys open nothing useful.', price: 95 },
  { id: 'frost_charm', name: 'Frost Charm', slot: 'accessory', rarity: 'rare', tier: 3, freeze: 0.08, def: 1, dex: 1, desc: '+1 DEF, +1 DEX, 8% freeze on hit.', price: 175 },
  { id: 'scorch_brand', name: 'Scorch Brand', slot: 'accessory', rarity: 'rare', tier: 3, burn: 0.1, str: 2, desc: '+2 STR, 10% burn on hit.', price: 180 },
];

// Relics: passive run-defining effects
export const RELICS = [
  { id: 'ember_heart', name: 'Ember Heart', rarity: 'uncommon', desc: 'Your attacks have +15% chance to burn.', burn: 0.15 },
  { id: 'frozen_tear', name: 'Frozen Tear', rarity: 'uncommon', desc: 'Your attacks have +12% chance to freeze.', freeze: 0.12 },
  { id: 'whetstone', name: 'Eternal Whetstone', rarity: 'common', desc: '+12% damage dealt.', dmgMult: 1.12 },
  { id: 'tortoise_shell', name: 'Tortoise Idol', rarity: 'common', desc: 'Take 10% less damage.', dmgTakenMult: 0.9 },
  { id: 'moon_dial', name: 'Moon Dial', rarity: 'epic', desc: 'Restore +1 class resource each combat turn. Rare clockwork.', manaRegen: 1 },
  { id: 'blood_chalice', name: 'Blood Chalice', rarity: 'rare', desc: 'Heal 8% max HP after every victory.', victoryHeal: 0.08 },
  { id: 'gamblers_die', name: 'Gambler\'s Die', rarity: 'rare', desc: '+10% crit chance, +5% enemy crit chance. Live a little.', crit: 10, enemyCrit: 5 },
  { id: 'golden_idol', name: 'Golden Idol', rarity: 'rare', desc: '+50% gold from combat.', combatGoldMult: 1.5 },
  { id: 'renown_lantern', name: 'Lantern of Renown', rarity: 'rare', desc: 'Your victories are witnessed — gain 1 Fame after every battle.', fameOnVictory: 1 },
  { id: 'xp_tome', name: 'Tome of Echoed Deeds', rarity: 'rare', desc: '+30% experience gained.', xpMult: 1.3 },
  { id: 'mimic_tooth', name: 'Mimic Tooth', rarity: 'uncommon', desc: 'Chests are never mimics. Mimics hold grudges about this.', noMimic: true },
  { id: 'boss_bane', name: 'Regicide Nail', rarity: 'epic', desc: '+25% damage against bosses.', bossDmgMult: 1.25 },
  { id: 'second_wind', name: 'Second Wind Bellows', rarity: 'epic', desc: 'Heal 15% max HP when a floor begins and you are below 30%.', lowHpHeal: 0.15 },
  { id: 'demon_pact', name: 'Pact of the Patient Demon', rarity: 'epic', desc: '+30% damage dealt, but max HP reduced by 10%. Read the fine print.', dmgMult: 1.3, maxHpMult: 0.9 },
  { id: 'hourglass', name: 'Cracked Hourglass', rarity: 'epic', desc: 'Once per battle, surviving a killing blow leaves you at 1 HP instead.', deathward: true },
  { id: 'war_drum', name: 'War Drum of the Deep', rarity: 'epic', desc: 'Begin every battle with 2 Battle Charge.', startCharge: 2 },
  { id: 'heros_ashes', name: 'Ashes of a Previous Hero', rarity: 'legendary', desc: '+3 to ALL stats. They almost made it. Carry them the rest of the way.', allStats: 3 },
  // ---- wild / legendary effects (§15) ----
  { id: 'berserkers_heart', name: 'The Berserker\'s Heart', rarity: 'epic', desc: 'On the third round of every battle, your damage DOUBLES.', doubleDmgRound: 3 },
  { id: 'chaos_prism', name: 'Prism of Discord', rarity: 'epic', desc: 'Enemies are sometimes bewildered and strike each other instead (20% each turn).', confuseChance: 0.2 },
  { id: 'twin_soul', name: 'The Twin Soul', rarity: 'legendary', desc: 'Your mind holds more at once — carry TWO extra techniques into battle (+2 skill slots).', extraSkillSlots: 2 },
  { id: 'thornmail', name: 'Coat of Thorns', rarity: 'rare', desc: 'Attackers take 25% of the damage they deal to you, straight back.', thorns: 0.25 },
  { id: 'echo_stone', name: 'The Echoing Stone', rarity: 'legendary', desc: 'Time stutters — each of your turns has a 22% chance to happen twice.', echoChance: 0.22 },
  { id: 'gluttons_chalice', name: 'The Glutton\'s Chalice', rarity: 'epic', desc: 'Doubles the cap on how much a single lifesteal hit can heal you.', lifestealCapMult: 2 },
  { id: 'first_strike_horn', name: 'Horn of the Vanguard', rarity: 'rare', desc: 'Begin every battle with 3 Battle Charge.', startCharge: 3 },
  // ---- WRLD relics (one of each per run / party) ----
  { id: 'chronos_heart', name: 'Heart of Chronos', rarity: 'wrld', desc: 'WRLD · time kneels. 35% chance each of your turns happens twice, and you begin battles with 2 Battle Charge.', echoChance: 0.35, startCharge: 2, wrld: true },
  { id: 'world_seed', name: 'The World Seed', rarity: 'wrld', desc: 'WRLD · +5 to ALL stats, +40% XP. A cosmos folded into a kernel.', allStats: 5, xpMult: 1.4, wrld: true },
  { id: 'protagonists_oath', name: 'The Protagonist\'s Oath', rarity: 'wrld', desc: 'WRLD · +35% damage, +15% max HP, fame +50%. The tower writes you into its main plot.', dmgMult: 1.35, maxHpMult: 1.15, fameGainMult: 1.5, wrld: true },
];

export const CONSUMABLES = [
  { id: 'potion_s', name: 'Minor Healing Potion', rarity: 'common', desc: 'Restore 30 HP.', heal: 30, price: 25 },
  { id: 'potion_l', name: 'Greater Healing Potion', rarity: 'uncommon', desc: 'Restore 70 HP.', heal: 70, price: 60 },
  { id: 'mana_vial', name: 'Essence Vial', rarity: 'common', desc: 'Restore 40 class resource.', mana: 40, price: 35 },
  { id: 'calming_tea', name: 'Hero\'s Tonic', rarity: 'uncommon', desc: 'Restore 25 HP and steel your reputation (+2 Fame).', heal: 25, fame: 2, price: 45 },
  { id: 'bomb', name: 'Alchemist\'s Bomb', rarity: 'uncommon', desc: 'Deal 40 damage to all enemies.', bombDmg: 40, price: 55 },
  { id: 'smelling_salts', name: 'Smelling Salts', rarity: 'rare', desc: 'Cure all ailments and restore 20 HP.', cure: true, heal: 20, price: 70 },
  { id: 'appraisal_scroll', name: 'Scroll of Appraisal', rarity: 'rare', desc: 'A single-use reading of your current potential.', appraisal: true, price: 90 },
  // ---- farm foods (plain) ----
  { id: 'farm_bread', name: 'Farmhouse Bread', rarity: 'common', desc: 'Restore 18 HP. Dense, honest, slightly judgmental.', heal: 18, price: 12 },
  { id: 'farm_cheese', name: 'Wheel of Soft Cheese', rarity: 'common', desc: 'Restore 22 HP. The tower\'s mice envy you.', heal: 22, price: 14 },
  { id: 'farm_stew', name: 'Traveler\'s Stew', rarity: 'common', desc: 'Restore 28 HP. One bowl, many vegetables.', heal: 28, price: 16 },
  // ---- enchanted farm foods (heal% + short floor buff) ----
  { id: 'enchanted_loaf', name: 'Sun-Warmed Loaf', rarity: 'uncommon', desc: 'Heal 22% HP. +8% damage for 3 floors.', healPct: 0.22, foodBuff: { dmgMult: 1.08, floors: 3 }, price: 40 },
  { id: 'enchanted_honey', name: 'Hivegold Honey', rarity: 'uncommon', desc: 'Heal 20% HP. +1 resource regen for 3 floors.', healPct: 0.2, foodBuff: { manaRegen: 1, floors: 3 }, price: 42 },
  { id: 'enchanted_root', name: 'Ironroot Mash', rarity: 'uncommon', desc: 'Heal 18% HP. Take 8% less damage for 3 floors.', healPct: 0.18, foodBuff: { dmgTakenMult: 0.92, floors: 3 }, price: 44 },
  { id: 'enchanted_berry', name: 'Luckberry Tart', rarity: 'uncommon', desc: 'Heal 16% HP. +6% crit for 3 floors.', healPct: 0.16, foodBuff: { crit: 6, floors: 3 }, price: 46 },
  { id: 'enchanted_cider', name: 'Orchard Cider', rarity: 'rare', desc: 'Heal 25% HP. +4% dodge and +1 initiative for 3 floors.', healPct: 0.25, foodBuff: { dodge: 4, initiative: 1, floors: 3 }, price: 55 },
];

export const ALL_EQUIPMENT = [...WEAPONS, ...HELMETS, ...CHEST_ARMOR, ...LEG_ARMOR, ...BOOTS, ...ACCESSORIES];

const RARITY_W = { common: 50, uncommon: 30, rare: 14, epic: 5, legendary: 1 };
// UNIQUE / WRLD never appear in ordinary rolls — see rollUnique / rollWrld.

/**
 * Resolve a catalog id OR a run-scoped affixed instance id.
 * Prefer resolveItem(run, id) when a run is available.
 */
export function itemById(id, gearBag = null) {
  if (!id) return null;
  if (gearBag && gearBag[id]) return gearBag[id];
  return ALL_EQUIPMENT.find(i => i.id === id)
    || RELICS.find(i => i.id === id)
    || CONSUMABLES.find(i => i.id === id)
    || null;
}

/** Run-aware lookup (affixed loot lives in run.gearBag). */
export function resolveItem(run, id) {
  return itemById(id, run?.gearBag);
}

/** Catalog entries with rarity UNIQUE (above legendary). */
export function uniqueCatalog() {
  return ALL_EQUIPMENT.filter(i => i.rarity === 'unique');
}

/** Catalog entries with rarity WRLD (above UNIQUE — one of each per run/party). */
export function wrldCatalog() {
  return [
    ...ALL_EQUIPMENT.filter(i => i.rarity === 'wrld'),
    ...RELICS.filter(r => r.rarity === 'wrld'),
  ];
}

/** Ids the run already holds (equipped + pack + gearBag bases). */
export function ownedGearIds(run) {
  const ids = new Set();
  if (!run) return ids;
  for (const slot of EQUIP_SLOTS) {
    const id = run.equipment?.[slot];
    if (id) {
      ids.add(id);
      const it = resolveItem(run, id);
      if (it?.baseId) ids.add(it.baseId);
    }
  }
  for (const id of run.inventory || []) {
    ids.add(id);
    const it = resolveItem(run, id);
    if (it?.baseId) ids.add(it.baseId);
  }
  return ids;
}

/**
 * WRLD ids already claimed this run — local run + optional co-op party set.
 * One of each WRLD exists per climb; different players may hold different WRLDs.
 */
export function claimedWrldIds(run, coop = null) {
  const ids = new Set(run?.claimedWrld || []);
  if (coop?.claimedWrld) {
    for (const id of coop.claimedWrld) ids.add(id);
  }
  for (const id of ownedGearIds(run)) ids.add(id);
  for (const id of run?.relics || []) ids.add(id);
  return ids;
}

/** Mark a WRLD id claimed for this run (and broadcast in co-op). */
export function markWrldClaimed(run, id, coop = null) {
  if (!run || !id) return;
  if (!run.claimedWrld) run.claimedWrld = [];
  if (!run.claimedWrld.includes(id)) run.claimedWrld.push(id);
  if (coop) {
    if (!coop.claimedWrld) coop.claimedWrld = new Set();
    coop.claimedWrld.add(id);
    coop.net?.send?.({ k: 'wrldclaim', id });
  }
}

/**
 * Pick a UNIQUE item not yet owned. Never appears in normal rollEquipment.
 * Chance helpers live in callers (boss / shop / event).
 */
export function rollUnique(rng, run = null, { preferUseful = false } = {}) {
  const owned = ownedGearIds(run);
  let pool = uniqueCatalog().filter(i => !owned.has(i.id) && !i.exclusive);
  if (!pool.length) return null;
  if (preferUseful && run?.classId) {
    const useful = pool.filter(i => itemUsefulForClass(i, run.classId));
    if (useful.length) pool = useful;
  }
  const base = rng.pick(pool);
  return finalizeLootItem({ ...base, baseId: base.id, affixes: [] }, rng, run);
}

/**
 * Pick a WRLD item not yet claimed this run/party.
 * kind: 'any' | 'equip' | 'relic' | 'weapon' | 'accessory' | slot name
 * Pass coop so multiplayer shares the "one of each" ledger.
 */
export function rollWrld(rng, run = null, { preferUseful = false, kind = 'any', coop = null, claim = true } = {}) {
  const claimed = claimedWrldIds(run, coop);
  let pool = wrldCatalog().filter(i => !claimed.has(i.id) && !i.exclusive);
  if (kind === 'relic') pool = pool.filter(i => !i.slot);
  else if (kind === 'equip') pool = pool.filter(i => !!i.slot);
  else if (kind === 'weapon') pool = pool.filter(i => i.slot === 'weapon');
  else if (kind === 'accessory') pool = pool.filter(i => i.slot === 'accessory');
  else if (kind && kind !== 'any') pool = pool.filter(i => i.slot === kind);
  if (!pool.length) return null;
  if (preferUseful && run?.classId) {
    const useful = pool.filter(i => !i.slot || i.slot !== 'weapon' || itemUsefulForClass(i, run.classId));
    if (useful.length) pool = useful;
  }
  const base = rng.pick(pool);
  const baseId = base.id;
  if (claim) markWrldClaimed(run, baseId, coop);
  if (!base.slot) {
    return { ...base };
  }
  return finalizeLootItem({ ...base, baseId, affixes: [] }, rng, run);
}

/** True if equipping this weapon would lock out class techniques. */
export function itemIncompatibleForClass(item, classId) {
  if (!item || item.slot !== 'weapon') return false;
  return !itemUsefulForClass(item, classId);
}

/** True if this item helps the class (compatible weapon, or any non-weapon). */
export function itemUsefulForClass(item, classId) {
  if (!item || !classId) return true;
  if (item.slot !== 'weapon') return true;
  const cls = CLASSES[classId];
  if (!cls?.weapons?.length) return true;
  return cls.weapons.includes(item.wtype);
}

/**
 * Roll a base template, apply TDC-gated affixes, and optionally register
 * the instance on the run. Pass `{ floor, run, classId, usefulBias, slot,
 * wtype, requireUseful }` from gameplay callers.
 * usefulBias ~3–4 ≈ 75–80% useful when the pool is mixed.
 */
export function rollEquipment(rng, tier, luckBonus = 0, opts = {}) {
  const floor = opts.floor ?? 1;
  const run = opts.run || null;
  const classId = opts.classId || run?.classId || null;
  const usefulBias = opts.usefulBias ?? (classId ? 3.5 : 1); // ~78% toward useful
  const requireUseful = !!opts.requireUseful && classId;
  const wantSlot = opts.slot || null;
  const wantWtype = opts.wtype || null;
  // event-exclusive + UNIQUE + WRLD never surface in ordinary loot/shops
  const matches = (i, looseTier = false) => {
    if (i.exclusive) return false;
    if (i.rarity === 'unique' || i.unique) return false;
    if (i.rarity === 'wrld' || i.wrld) return false;
    if (wantSlot && i.slot !== wantSlot) return false;
    if (wantWtype && i.wtype !== wantWtype) return false;
    if (looseTier) return i.tier <= tier + 1;
    return i.tier <= tier && i.tier >= Math.max(1, tier - 1);
  };
  let pool = ALL_EQUIPMENT.filter(i => matches(i));
  if (!pool.length) pool = ALL_EQUIPMENT.filter(i => matches(i, true));
  if (requireUseful) {
    const useful = pool.filter(i => itemUsefulForClass(i, classId));
    if (useful.length) pool = useful;
  }
  if (!pool.length) return null;
  const weighted = pool.map(i => {
    let w = (RARITY_W[i.rarity] || 1) + (i.rarity !== 'common' ? luckBonus : 0);
    if (classId && itemUsefulForClass(i, classId)) w *= usefulBias;
    if ((i.tier || 1) >= Math.max(2, tier - 1)) w *= 1.15;
    return { w, item: i };
  });
  const base = rng.weighted(weighted).item;
  const affixed = applyAffixes(base, rng, { floor });
  return finalizeLootItem(affixed, rng, run);
}

export function rollRelic(rng, owned = [], luckBonus = 0) {
  const pool = RELICS.filter(r => !owned.includes(r.id) && r.rarity !== 'wrld' && !r.wrld);
  if (!pool.length) return null;
  const weighted = pool.map(i => ({ w: (RARITY_W[i.rarity] || 1) + luckBonus, item: i }));
  return rng.weighted(weighted).item;
}
