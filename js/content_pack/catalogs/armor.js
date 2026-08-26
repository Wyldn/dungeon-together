import { gear, ef } from './helpers.js';

function setPieces(setId, name, slotStats, bonuses, extra = {}) {
  if (!extra.rarity || !extra.pieceRarity) {
    throw new Error(`setPieces ${setId}: rarity and pieceRarity are required (no category default)`);
  }
  const slots = [
    { slot: 'helmet', suffix: 'helm', def: 2, ...slotStats.helm },
    { slot: 'chest', suffix: 'chest', def: 3, ...slotStats.chest },
    { slot: 'legs', suffix: 'legs', def: 2, ...slotStats.legs },
  ];
  return slots.map(s => gear({
    id: `cp_${setId}_${s.suffix}`,
    name: `${name} ${s.slot === 'helmet' ? 'Helm' : s.slot === 'chest' ? 'Cuirass' : 'Greaves'}`,
    slot: s.slot,
    setId,
    setBonus: bonuses,
    def: s.def,
    rarity: s.slot === 'chest' ? extra.rarity : extra.pieceRarity,
    tier: extra.tier || (s.slot === 'chest' ? 3 : 2),
    acquisition: extra.acquisition || 'class',
    classBound: extra.classBound,
    resonance: extra.resonance,
    desc: extra.desc || `${name} set piece.`,
    ...extra.pieceExtra,
    hp: s.hp, str: s.str, dex: s.dex, int: s.int, wis: s.wis, lk: s.lk, mp: s.mp,
  }));
}

const lastBastion = {
  2: [ef('onDamageTaken', 'addCounter', { key: 'bastion', scope: 'combat' })],
  3: [ef('onHit', 'modDamage', { add: 3, when: { flag: 'bastion' } })],
};
const illegalMargin = {
  2: [ef('onSkillUse', 'addCounter', { key: 'marginCats', scope: 'combat' })],
  3: [ef('onHit', 'modDamage', { mult: 1.1, when: { differentFromPrior: true } })],
};
const threeTrails = {
  2: [ef('onCombatStart', 'chooseStance', { stance: 'hunt' })],
  3: [ef('onHit', 'modDamage', { mult: 1.1 })],
};
const unseenAuditor = {
  2: [ef('onHit', 'reduceCharge', { amount: 1, once: 'turn' })],
  3: [ef('onHit', 'modDamage', { vsShielded: 1.12 })],
};
const namelessSaint = {
  2: [ef('onHeal', 'overhealWard')],
  3: [ef('onHit', 'modDamage', { add: 2 })],
};
const emptyGate = {
  2: [ef('onHit', 'modDamage', { mult: 1.1, when: { differentFromPrior: true } })],
  3: [ef('onGuard', 'armNextHit', { add: 4 })],
};
const stolenApplause = {
  2: [ef('onHit', 'spendFamePower', { fame: 1, mult: 1.08, once: 'turn' })],
  3: [ef('onKill', 'gainFame', { amount: 1, once: 'combat' })],
};
const seventhFuneral = {
  2: [ef('onKill', 'addCounter', { key: 'remains', scope: 'combat' })],
  3: [ef('onKill', 'summonAlly', { archetype: 'skeleton', once: 'combat', capability: 'summon' })],
};
const inwardEdge = {
  2: [ef('onHit', 'modDamage', { mult: 1.1, when: { differentFromPrior: true } })],
  3: [ef('onHit', 'echoAction', { mult: 0.35, once: 'turn', capability: 'echo_copy' })],
};
const clauseSeven = {
  2: [ef('onHit', 'applyStatus', { status: 'hexed', turns: 2 })],
  3: [ef('onHit', 'grantResource', { amount: 4, when: { status: 'hexed' } })],
};
const raidWake = {
  2: [ef('onDamageTaken', 'grantResource', { amount: 2, once: 'turn' })],
  3: [ef('onHit', 'heal', { pct: 0.03, once: 'turn' })],
};

export const PACK_ARMOR_SETS = [
  ...setPieces('last_bastion', 'Last Bastion', { helm: { str: 1 }, chest: { hp: 8, str: 1 }, legs: { hp: 4 } }, lastBastion, {
    classBound: 'warrior', rarity: 'rare', pieceRarity: 'uncommon',
    desc: 'Warrior set · protection becomes controlled retaliation.',
  }),
  ...setPieces('illegal_margin', 'Illegal Margin', { helm: { int: 2 }, chest: { int: 2, mp: 8 }, legs: { int: 1 } }, illegalMargin, {
    classBound: 'mage', rarity: 'rare', pieceRarity: 'uncommon',
    desc: 'Mage set · rewards changing spell categories.',
  }),
  ...setPieces('three_trails', 'Three Trails', { helm: { dex: 2 }, chest: { dex: 1, dodge: 3 }, legs: { dex: 1 } }, threeTrails, {
    classBound: 'archer', rarity: 'rare', pieceRarity: 'uncommon',
    desc: 'Ranger set · Hunt, Rescue, or Escape.',
  }),
  ...setPieces('unseen_auditor', 'Unseen Auditor', { helm: { dex: 1, crit: 3 }, chest: { dex: 2 }, legs: { dodge: 3 } }, unseenAuditor, {
    classBound: 'rogue', rarity: 'rare', pieceRarity: 'uncommon',
    desc: 'Rogue set · fees from buffs and revealed intents.',
  }),
  ...setPieces('nameless_saint', 'Nameless Saint', { helm: { wis: 2 }, chest: { wis: 2, hp: 6 }, legs: { wis: 1 } }, namelessSaint, {
    classBound: 'priest', rarity: 'rare', pieceRarity: 'uncommon',
    desc: 'Priest set · overhealing becomes wards.',
  }),
  ...setPieces('empty_gate', 'Empty Gate', { helm: { dex: 1 }, chest: { dex: 2 }, legs: { dex: 1, dodge: 3 } }, emptyGate, {
    classBound: 'monk', rarity: 'rare', pieceRarity: 'uncommon',
    desc: 'Monk set · alternating actions build Flow.',
  }),
  ...setPieces('stolen_applause', 'Stolen Applause', { helm: { lk: 2 }, chest: { lk: 2 }, legs: { lk: 1 } }, stolenApplause, {
    classBound: 'bard', rarity: 'rare', pieceRarity: 'uncommon',
    desc: 'Bard set · Fame spent in combat becomes song duration.',
  }),
  ...setPieces('seventh_funeral', 'Seventh Funeral', { helm: { int: 2 }, chest: { int: 2, mp: 6 }, legs: { int: 1 } }, seventhFuneral, {
    classBound: 'necromancer', rarity: 'rare', pieceRarity: 'uncommon',
    desc: 'Necromancer set · summon deaths produce remains.',
  }),
  ...setPieces('inward_edge', 'Inward Edge', { helm: { str: 1, int: 1 }, chest: { str: 1, int: 1 }, legs: { str: 1 } }, inwardEdge, {
    classBound: 'spellsword', rarity: 'rare', pieceRarity: 'uncommon',
    desc: 'Spellsword set · alternating physical and magical creates Spellweave.',
  }),
  ...setPieces('clause_seven', 'Clause Seven', { helm: { int: 2 }, chest: { int: 2, lk: 1 }, legs: { int: 1 } }, clauseSeven, {
    classBound: 'warlock', rarity: 'rare', pieceRarity: 'uncommon',
    desc: 'Warlock set · hex and invoice synergy.',
  }),
  ...setPieces('raid_wake', 'Raid Wake', { helm: { str: 2 }, chest: { str: 2, hp: 8 }, legs: { str: 1, hp: 4 } }, raidWake, {
    classBound: 'viking', rarity: 'rare', pieceRarity: 'uncommon',
    desc: 'Viking set · lost HP becomes Fury and a bounded lifesteal window.',
  }),
];

const blSets = [
  ['many_banner', 'Many-Banner', 'human', { 2: [ef('onCombatStart', 'armNextHit', { add: 2 })], 3: [ef('onHit', 'modDamage', { add: 1 })] }],
  ['memory_bark', 'Memory-Bark', 'elf', { 2: [ef('onHit', 'storeMemory', { key: 'seenFamily', scope: 'run' })], 3: [ef('onHit', 'modDamage', { add: 2 })] }],
  ['oathscar', 'Oathscar', 'orc', { 2: [ef('onDamageTaken', 'setOath', { oath: 'protect' })], 3: [ef('onHit', 'modDamage', { add: 2 })] }],
  ['mason_plate', 'Mason Plate', 'dwarf', { 2: [ef('onHit', 'modDamage', { vsFamily: 'golem', mult: 1.1 })], 3: [ef('beforeDamageTaken', 'modIncoming', { mult: 0.94 })] }],
  ['hidden_pocket', 'Hidden-Pocket', 'halfling', { 2: [ef('onConsumable', 'heal', { amount: 6 })], 3: [ef('onMiss', 'armNextHit', { add: 3, once: 'combat' })] }],
  ['clauseplate', 'Clauseplate', 'tiefling', { 2: [ef('onHit', 'extendStatus', { status: 'burn', turns: 1, selfHarm: true })], 3: [ef('beforeDamageTaken', 'modIncoming', { mult: 0.92, when: { selfStatus: 'burn' } })] }],
  ['packhide', 'Packhide', 'beastfolk', { 2: [ef('onHit', 'modDamage', { mult: 1.08 })], 3: [ef('onHit', 'markTarget')] }],
  ['hingescale', 'Hingescale', 'dragonkin', { 2: [ef('onDamageTaken', 'addCounter', { key: 'storedElem', scope: 'combat' })], 3: [ef('onHit', 'modDamage', { add: 3, once: 'turn' })] }],
];

export const PACK_ARMOR_BLOODLINE = blSets.flatMap(([id, name, race, bonus]) =>
  setPieces(id, name, { helm: {}, chest: { hp: 6 }, legs: {} }, bonus, {
    acquisition: 'bloodline', resonance: race, classBound: undefined,
    desc: `${name} armor. Usable by anyone; ${race} awakens the set's second property.`,
    rarity: 'rare', pieceRarity: 'uncommon', tier: 3,
  }));

export const PACK_ARMOR_FOUNDATION = [
  gear({ id: 'cp_gate_surveyor_coat', name: "Gate Surveyor's Coat", slot: 'chest', rarity: 'common', tier: 1, def: 2, packOrdinary: true, minFloor: 1, maxFloor: 20,
    desc: 'Slightly improves event information and resistance to surprise attacks.',
    effects: [ef('onCombatStart', 'revealIntent', { value: 'shape' })] }),
  gear({ id: 'cp_rootwoven_vest', name: 'Rootwoven Vest', slot: 'chest', rarity: 'common', tier: 1, def: 2,
    desc: 'Small resistance to poison, roots, and bleeding.',
    effects: [ef('beforeDamageTaken', 'modIncoming', { mult: 0.94, when: { selfStatus: 'poison' } })] }),
  gear({ id: 'cp_kilnforged_cuirass', name: 'Kilnforged Cuirass', slot: 'chest', rarity: 'uncommon', tier: 2, def: 3,
    desc: 'Converts the first burn received each combat into armor.',
    effects: [ef('onStatusApplied', 'removeStatus', { status: 'burn', once: 'combat' })] }),
  gear({ id: 'cp_frost_miners_harness', name: "Frost Miner's Harness", slot: 'chest', rarity: 'uncommon', tier: 2, def: 3,
    desc: 'Reduces heavy-hit damage but weakens healing received that turn.',
    effects: [ef('beforeDamageTaken', 'modIncoming', { mult: 0.9 })] }),
  gear({ id: 'cp_bog_wader_boots', name: 'Bog-Wader Boots', slot: 'boots', rarity: 'common', tier: 1, def: 1, packOrdinary: true, minFloor: 1, maxFloor: 20,
    desc: 'Reduces damage from poison and terrain-like effects.',
    effects: [ef('beforeDamageTaken', 'modIncoming', { mult: 0.95 })] }),
  gear({ id: 'cp_ashen_traveler_cloak', name: 'Ashen Traveler Cloak', slot: 'chest', rarity: 'common', tier: 1, def: 1, dodge: 3,
    desc: 'Improves the first defensive action of combat.',
    effects: [ef('onGuard', 'armNextIncoming', { mult: 0.85, once: 'combat' })] }),
  gear({ id: 'cp_ruin_duelist_jacket', name: 'Ruin Duelist Jacket', slot: 'chest', rarity: 'uncommon', tier: 2, def: 2, dodge: 4,
    desc: 'Rewards avoiding attacks rather than absorbing them.',
    effects: [ef('onMiss', 'grantCharge', { amount: 1, once: 'combat' })] }),
  gear({ id: 'cp_funeral_plate', name: 'Funeral Plate', slot: 'chest', rarity: 'rare', tier: 3, def: 4,
    desc: 'Gains defense when an enemy or summon dies.',
    effects: [ef('onKill', 'armNextIncoming', { mult: 0.9 })] }),
  gear({ id: 'cp_pilgrims_vestments', name: "Pilgrim's Vestments", slot: 'chest', rarity: 'uncommon', tier: 2, def: 2, wis: 1,
    desc: 'Healing another character slightly protects the wearer.',
    effects: [ef('onHeal', 'overhealWard')] }),
  gear({ id: 'cp_merchants_hidden_mail', name: "Merchant's Hidden Mail", slot: 'chest', rarity: 'uncommon', tier: 2, def: 2,
    desc: 'Improves gold retained after robbery or toll events.',
    effects: [ef('onEventResolve', 'gainGold', { amount: 6, once: 'floor' })] }),
  gear({ id: 'cp_gate_iron_helm', name: 'Gate-Iron Helm', slot: 'helmet', rarity: 'common', tier: 1, def: 2, packOrdinary: true, minFloor: 1, maxFloor: 20,
    desc: 'Reduces stun duration or severity.',
    effects: [ef('onStatusApplied', 'removeStatus', { status: 'stunned', once: 'combat' })] }),
  gear({ id: 'cp_surveyors_lens', name: "Surveyor's Lens", slot: 'helmet', rarity: 'uncommon', tier: 2, def: 1,
    desc: 'Improves accuracy against disguised or transformed enemies.',
    effects: [ef('onHit', 'modAccuracy', { add: 8 })] }),
  gear({ id: 'cp_bell_ringer_gauntlets', name: 'Bell-Ringer Gauntlets', slot: 'accessory', rarity: 'uncommon', tier: 2,
    desc: 'Strengthen counters after protecting an ally.',
    effects: [ef('onDamageTaken', 'setFlag', { key: 'counterReady', scope: 'turn' }),
      ef('onHit', 'modDamage', { add: 3, when: { flag: 'counterReady' } })] }),
  gear({ id: 'cp_refugee_mantle', name: 'Refugee Mantle', slot: 'chest', rarity: 'uncommon', tier: 2, def: 2,
    desc: 'Improves benefits from low-Fame or rescued NPCs.',
    effects: [ef('onEventResolve', 'gainFame', { amount: 1, when: { fameBelow: 6 } })] }),
  gear({ id: 'cp_courtly_half_plate', name: 'Courtly Half-Plate', slot: 'chest', rarity: 'rare', tier: 3, def: 4,
    desc: 'Gains defense when targeted by a boss.',
    effects: [ef('beforeDamageTaken', 'modIncoming', { mult: 0.9 })] }),
  gear({ id: 'cp_monsterbone_pauldrons', name: 'Monsterbone Pauldrons', slot: 'helmet', rarity: 'uncommon', tier: 2, def: 2,
    desc: 'Minor resistance based on the current biome\'s common enemy family.',
    effects: [ef('beforeDamageTaken', 'modIncoming', { mult: 0.96 })] }),
  gear({ id: 'cp_quiet_step_greaves', name: 'Quiet-Step Greaves', slot: 'legs', rarity: 'common', tier: 1, def: 1, dodge: 3, packOrdinary: true, minFloor: 1, maxFloor: 20,
    desc: 'First threat-generating action is reduced.',
    effects: [ef('onHit', 'modDamage', { mult: 0.9, firstHit: true })] }),
  gear({ id: 'cp_gate_nail_buckler', name: 'Gate-Nail Buckler', slot: 'accessory', rarity: 'uncommon', tier: 2, def: 1,
    desc: 'Guarding against a charged attack slightly reduces enemy charge.',
    effects: [ef('onGuard', 'reduceCharge', { amount: 1, once: 'turn' })] }),
  gear({ id: 'cp_potioners_belt', name: "Potioner's Belt", slot: 'legs', rarity: 'uncommon', tier: 2, def: 1,
    desc: 'First potion used each combat gains a small secondary heal.',
    effects: [ef('onConsumable', 'heal', { amount: 6, once: 'combat' })] }),
  gear({ id: 'cp_last_climbers_cloak', name: "Last-Climber's Cloak", slot: 'chest', rarity: 'rare', tier: 3, def: 2, dodge: 4,
    desc: 'Stronger when the wearer is the lowest-health living party member.',
    effects: [ef('onHit', 'modDamage', { mult: 1.1, when: { hpBelow: 0.4 } })] }),
];

export const PACK_ARMOR_CURSED = [
  gear({ id: 'cp_armor_applauding_crowd', name: 'Armor of the Applauding Crowd', slot: 'chest', rarity: 'epic', tier: 4, def: 6, acquisition: 'cursed', curse: 'fame_defense',
    resolution: 'Fame Eater chain or spend Fame to rename Cowardice.',
    desc: 'Cursed · high defense while Fame is high; deteriorates as Fame falls.',
    effects: [ef('beforeDamageTaken', 'modIncoming', { mult: 0.85, when: { fameAbove: 10 } })] }),
  gear({ id: 'cp_second_timeline_plate', name: 'Second Timeline Plate', slot: 'chest', rarity: 'epic', tier: 4, def: 5, acquisition: 'cursed', curse: 'echo_hit',
    resolution: 'Previous Timeline chain: merge or destroy echoes.',
    desc: 'Cursed · prevents the first major hit but repeats a portion one turn later.',
    effects: [ef('beforeDamageTaken', 'modIncoming', { mult: 0.5, once: 'combat' }),
      ef('onDamageTaken', 'delayEffect', { delayTurns: 1, mult: 1.2, once: 'combat' })] }),
  gear({ id: 'cp_the_empty_seat', name: 'The Empty Seat', slot: 'chest', rarity: 'unique', unique: true, tier: 5, def: 6, hp: 16, acquisition: 'cursed', curse: 'missing_allies',
    resolution: 'Bell of the Last Companion.',
    desc: 'UNIQUE · cursed chest. Stronger for each downed or eliminated ally; weaker in a healthy party. Never uses disconnect. One seat per climber.',
    playable: 'adapted', adaptation: 'Counts authoritative downed/eliminated allies only.',
    effects: [ef('beforeDamageTaken', 'modIncoming', { missingAllies: true, add: 0.12, mult: 1 })] }),
  gear({ id: 'cp_royal_claimant_mantle', name: "Royal Claimant's Mantle", slot: 'chest', rarity: 'rare', tier: 3, def: 3, acquisition: 'cursed', curse: 'elite_attract',
    resolution: 'Drowned Royal Family: refuse monarchy.',
    desc: 'Cursed · improves merchant/court events but attracts elite challengers.',
    effects: [ef('onEventResolve', 'setFlag', { key: 'royalClaimant', scope: 'run', persistFlag: true }),
      ef('onEventResolve', 'gainFame', { amount: 1, once: 'floor' })] }),
  gear({ id: 'cp_gate_parasite_carapace', name: 'Gate-Parasite Carapace', slot: 'chest', rarity: 'rare', tier: 3, def: 4, acquisition: 'cursed', curse: 'regen_poison',
    resolution: 'Gate Parasites cleanse.',
    desc: 'Cursed · regenerates slowly while carrying a poison-like parasite.',
    effects: [ef('onTurnStart', 'heal', { amount: 3 }), ef('onTurnStart', 'applyStatus', { status: 'poison', turns: 1 })] }),
  gear({ id: 'cp_crimson_memory_mail', name: 'Crimson Memory Mail', slot: 'chest', rarity: 'epic', tier: 4, def: 4, acquisition: 'cursed', curse: 'remember_damage',
    resolution: 'Cleanse at a campfire (Crimson Save Point refuse).',
    desc: 'Cursed · remembers damage between combats until cleansed at a campfire.',
    effects: [ef('onDamageTaken', 'addCounter', { key: 'rememberedDmg', scope: 'run' }),
      ef('onHit', 'modDamage', { add: 1, when: { counter: 'rememberedDmg' } }),
      ef('onCampfire', 'clearFlag', { key: 'rememberedDmg', scope: 'run' })] }),
  gear({ id: 'cp_armor_mandatory_optionality', name: 'Armor of Mandatory Optionality', slot: 'chest', rarity: 'epic', tier: 4, def: 5, acquisition: 'cursed', curse: 'system_stance',
    resolution: 'False System chain appeal.',
    desc: 'Cursed · two strong stances, but the System chooses which starts active.',
    effects: [ef('onCombatStart', 'chooseStance', { stance: 'system' })] }),
  gear({ id: 'cp_furnace_honest_plate', name: 'Furnace-Honest Plate', slot: 'chest', rarity: 'rare', tier: 3, def: 5, acquisition: 'cursed', curse: 'no_buffs',
    resolution: 'Furnace of Honest Metal: purify.',
    desc: 'Cursed · cannot receive temporary buffs, but negative statuses are weaker.',
    effects: [ef('beforeDamageTaken', 'modIncoming', { mult: 0.92 })] }),
  gear({ id: 'cp_drowned_court_dress', name: 'Drowned Court Dress', slot: 'chest', rarity: 'rare', tier: 3, def: 2, dodge: 8, acquisition: 'cursed', curse: 'heal_penalty',
    resolution: 'Drowned Royal Family or Wedding ring.',
    desc: 'Cursed · excellent evasion; loses effectiveness whenever the wearer is healed.',
    effects: [ef('onHeal', 'armNextIncoming', { mult: 1.12 })] }),
  gear({ id: 'cp_grave_tax_shroud', name: 'Grave-Tax Shroud', slot: 'chest', rarity: 'rare', tier: 3, def: 3, acquisition: 'cursed', curse: 'summon_gold_tax',
    resolution: 'Grave-Tax Collector or Funeral Receipt.',
    desc: 'Cursed · summons cost less, but every summon death removes gold.',
    effects: [ef('onKill', 'summonAlly', { archetype: 'rat', once: 'combat', capability: 'summon' })] }),
  gear({ id: 'cp_possessionless_robe', name: 'Possessionless Robe', slot: 'chest', rarity: 'rare', tier: 3, def: 2, mp: 8, acquisition: 'cursed', curse: 'inventory_weak',
    resolution: 'Monk Empty-Handed Gate or Staff of No Possession.',
    desc: 'Cursed · strong while carrying few relics; weakens as inventory crowds.',
    effects: [ef('onHit', 'modDamage', { add: 2, emptySlots: true })] }),
  gear({ id: 'cp_final_gate_uniform', name: 'Final Gate Uniform', slot: 'chest', rarity: 'epic', tier: 4, def: 5, acquisition: 'cursed', curse: 'biome_locked',
    resolution: 'Gate Mason last inspection.',
    desc: 'Cursed · powerful in Hell and throne encounters, ordinary everywhere else.',
    effects: [ef('onHit', 'modDamage', { mult: 1.16, when: { biome: 'hell' } })] }),
];
