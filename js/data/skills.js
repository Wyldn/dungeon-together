// Skill library. Every ability may cost class resource (cost) AND Battle
// Charge (charge) — handoff §11/§13. AOE and heavy hits are charge-gated so
// enemies get a chance to act. All effects stay declarative.
//
// Prefer composeSkill() + COMP.* from skillcomponents.js when authoring new
// skills — combat still reads the flat merged object.
//
// target: 'one' | 'all' | 'self'
// tier: 1 = starting kit, 2 = level 6+, 3 = level 13+ offers

import { COMP, composeSkill } from './skillcomponents.js';

export const SKILLS = {
  /* ============ UNIVERSAL (every character, any weapon) ============ */
  basic_attack: {
    id: 'basic_attack', fx: 'blunt', name: 'Strike', class: 'universal', cost: 0, charge: 0, target: 'one',
    power: 80, stat: 'best',
    desc: 'A plain, honest hit. Works with anything — even bare hands.',
  },
  guard: {
    id: 'guard', fx: 'buff', name: 'Guard', class: 'universal', cost: 0, charge: 0, target: 'self',
    guard: true,
    desc: 'Brace for impact: block 30% of damage until your next turn. Builds +1 charge.',
  },

  /* ============ WARRIOR (Vigor) ============ */
  slash: composeSkill(
    { id: 'slash', name: 'Slash', class: 'warrior', fx: 'slash',
      desc: 'A dependable strike. Free to use.' },
    COMP.cost(0), COMP.charge(0), COMP.target('one'), COMP.dmg(100, 'str'),
  ),
  shield_bash: composeSkill(
    { id: 'shield_bash', name: 'Shield Bash', class: 'warrior', fx: 'blunt',
      desc: 'Slam your shield into the foe. 45% chance to stun.' },
    COMP.cost(14), COMP.charge(1), COMP.target('one'), COMP.dmg(80, 'str'), COMP.stun(0.45),
  ),
  war_cry: composeSkill(
    { id: 'war_cry', name: 'War Cry', class: 'warrior', fx: 'buff',
      desc: 'Bellow with fury. +50% damage for 3 turns.' },
    COMP.cost(16), COMP.charge(1), COMP.target('self'), COMP.buff('str', 1.5, 3),
  ),
  cleave: composeSkill(
    { id: 'cleave', name: 'Cleave', class: 'warrior', fx: 'slash',
      desc: 'A sweeping blow that hits every enemy.' },
    COMP.cost(26), COMP.charge(3), COMP.target('all'), COMP.dmg(70, 'str'),
  ),
  taunt: composeSkill(
    { id: 'taunt', name: 'Taunt', class: 'warrior', fx: 'buff',
      desc: 'Jeer every enemy into aiming at YOU for 2 turns, and brace hard (block 65%). In a party, you are the wall.' },
    COMP.cost(12), COMP.charge(1), COMP.target('self'), COMP.shield(0.65),
    { tauntTurns: 2 },
  ),
  bulwark_call: composeSkill(
    { id: 'bulwark_call', name: 'Bulwark Call', class: 'warrior', fx: 'buff', tier: 2,
      desc: 'Steel the line — the party takes 30% less damage for 3 turns.' },
    COMP.cost(18), COMP.charge(2), COMP.target('self'),
    { partyBuff: { kind: 'dr', mult: 0.7, turns: 3, label: 'BULWARK' } },
  ),
  /* ============ VIKING (Fury) ============
     The Warrior spends Vigor to stay standing; the Viking spends HP to hit
     harder and drinks it back with lifesteal. Every big swing has a bill. */
  axe_chop: composeSkill(
    { id: 'axe_chop', name: 'Axe Chop', class: 'viking', fx: 'slash',
      desc: 'A blunt, downward answer. Free to use.' },
    COMP.cost(0), COMP.charge(0), COMP.target('one'), COMP.dmg(100, 'str'),
  ),
  shield_splitter: composeSkill(
    { id: 'shield_splitter', name: 'Shield Splitter', class: 'viking', fx: 'slash',
      desc: 'Hack straight through the guard — ignores enemy defence.' },
    COMP.cost(15), COMP.charge(1), COMP.target('one'), COMP.dmg(85, 'str'), COMP.ignoreDef(),
  ),
  blood_howl: composeSkill(
    { id: 'blood_howl', name: 'Blood Howl', class: 'viking', fx: 'buff',
      desc: 'Open a vein and roar: pay 8% HP for +60% damage over 3 turns.' },
    COMP.cost(12), COMP.charge(1), COMP.target('self'),
    COMP.selfHpCost(0.08), COMP.buff('str', 1.6, 3),
  ),
  raiders_hook: composeSkill(
    { id: 'raiders_hook', name: "Raider's Hook", class: 'viking', fx: 'blunt',
      desc: 'Drag them off their footing. 40% chance to stun.' },
    COMP.cost(16), COMP.charge(1), COMP.target('one'), COMP.dmg(90, 'str'), COMP.stun(0.4),
  ),
  spinning_axes: composeSkill(
    { id: 'spinning_axes', name: 'Spinning Axes', class: 'viking', fx: 'slash',
      desc: 'Turn once, with everything. Hits every enemy and drinks the spray.' },
    COMP.cost(28), COMP.charge(3), COMP.target('all'), COMP.dmg(75, 'str'), COMP.lifesteal(0.12),
  ),
  pillage: {
    id: 'pillage', fx: 'slash', name: 'Pillage', class: 'viking', cost: 18, charge: 1, target: 'one', tier: 2,
    power: 105, stat: 'str', lifesteal: 0.2,
    desc: 'Take the hit and the wallet: heavy damage, 20% of it comes back as HP.',
  },
  bite_the_shield: {
    id: 'bite_the_shield', fx: 'buff', name: 'Bite the Shield', class: 'viking', cost: 16, charge: 1, target: 'self', tier: 2,
    selfHpCost: 0.12, buff: { stat: 'str', mult: 1.8, turns: 3 }, gainCharge: 1,
    desc: 'Chew the rim until the fear goes: pay 12% HP for +80% damage and a charge.',
  },
  longship_charge: {
    id: 'longship_charge', fx: 'slash', name: 'Longship Charge', class: 'viking', cost: 30, charge: 3, target: 'all', tier: 3,
    power: 95, stat: 'str', stun: 0.35,
    desc: 'The whole crew hits the beach at once. Hits everything, 35% chance to stun.',
  },
  thunder_of_shields: {
    id: 'thunder_of_shields', fx: 'blunt', name: 'Thunder of Shields', class: 'viking', cost: 26, charge: 3, target: 'all', tier: 3,
    power: 85, stat: 'str', shield: 0.3,
    desc: 'Beat the wall of shields until the room agrees. Hits all; block 30% for 3 turns.',
  },
  valhalla_calls: {
    id: 'valhalla_calls', fx: 'holy', name: 'Valhalla Calls', class: 'viking', cost: 24, charge: 2, target: 'one', tier: 2,
    power: 130, stat: 'str', execute: 0.2, lifesteal: 0.25,
    desc: 'The hall is watching. Devastating; finishes anything under 20% HP outright.',
  },

  iron_will: {
    id: 'iron_will', fx: 'buff', name: 'Iron Will', class: 'warrior', cost: 20, charge: 1, target: 'self', tier: 2,
    shield: 0.35, healPct: 0.12,
    desc: 'Steel yourself: heal 12% HP and block 35% of damage for 3 turns.',
  },
  rampage: {
    id: 'rampage', fx: 'slash', name: 'Rampage', class: 'warrior', cost: 26, charge: 3, target: 'one', tier: 2,
    power: 165, stat: 'str', selfHpCost: 0.06,
    desc: 'Trade blood for violence: heavy damage, costs 6% of your max HP.',
  },
  holy_strike: {
    id: 'holy_strike', fx: 'holy', name: 'Holy Strike', class: 'warrior', cost: 36, charge: 3, target: 'one', tier: 2,
    power: 170, stat: 'str', healPct: 0.06,
    desc: 'Radiant judgment. Heavy damage; the light mends you slightly.',
  },
  reapers_toll: {
    id: 'reapers_toll', fx: 'shadow', name: 'Reaper\'s Toll', class: 'warrior', cost: 30, charge: 4, target: 'one', tier: 2,
    power: 150, stat: 'str', execute: 0.25,
    desc: 'Collect what is owed. Slays non-boss foes below 25% HP outright.',
  },
  whirlwind: {
    id: 'whirlwind', fx: 'slash', name: 'Whirlwind', class: 'warrior', cost: 50, charge: 6, target: 'all', tier: 3,
    power: 130, stat: 'str', weaken: 0.45,
    desc: 'ULTIMATE — become the storm. Massive damage to all enemies; 45% weaken.',
  },

  /* ============ MAGE (Mana) ============ */
  firebolt: {
    id: 'firebolt', fx: 'fire', name: 'Firebolt', class: 'mage', cost: 0, charge: 0, target: 'one',
    power: 95, stat: 'int', burn: 0.35,
    desc: 'A dart of flame. 35% chance to burn.',
  },
  frost_lance: {
    id: 'frost_lance', fx: 'ice', name: 'Frost Lance', class: 'mage', cost: 16, charge: 1, target: 'one',
    power: 110, stat: 'int', freeze: 0.35,
    desc: 'Impale with ice. 35% chance to freeze the target.',
  },
  arcane_ward: {
    id: 'arcane_ward', fx: 'buff', name: 'Arcane Ward', class: 'mage', cost: 20, charge: 0, target: 'self',
    shield: 0.5,
    desc: 'A shimmering barrier blocks 50% of damage for 3 turns.',
  },
  mana_storm: {
    id: 'mana_storm', fx: 'arcane', name: 'Mana Storm', class: 'mage', cost: 36, charge: 3, target: 'all',
    power: 85, stat: 'int',
    desc: 'Unleash raw arcana on every enemy.',
  },
  soul_siphon: {
    id: 'soul_siphon', fx: 'shadow', name: 'Soul Siphon', class: 'mage', cost: 26, charge: 2, target: 'one', tier: 2,
    power: 90, stat: 'int', lifesteal: 0.6,
    desc: 'Drain a foe\'s essence, healing for 60% of damage dealt.',
  },
  chain_lightning: {
    id: 'chain_lightning', fx: 'thunder', name: 'Chain Lightning', class: 'mage', cost: 40, charge: 4, target: 'all', tier: 2,
    power: 105, stat: 'int', stun: 0.2,
    desc: 'Lightning arcs between foes. 20% chance to stun each.',
  },
  rune_slash: {
    id: 'rune_slash', fx: 'arcane', name: 'Rune Slash', class: 'mage', cost: 20, charge: 2, target: 'one', tier: 2,
    power: 140, stat: 'int', ignoreDef: true,
    desc: 'A blade-arc of pure script — armor means nothing to grammar.',
  },
  blade_storm: {
    id: 'blade_storm', fx: 'arcane', name: 'Blade Storm', class: 'mage', cost: 46, charge: 5, target: 'all', tier: 3,
    power: 120, stat: 'int',
    desc: 'Every spell your sword remembers, all at once, everywhere.',
  },
  unmake: {
    id: 'unmake', fx: 'shadow', name: 'Unmake', class: 'mage', cost: 40, charge: 4, target: 'one', tier: 2,
    power: 180, stat: 'int', ignoreDef: true,
    desc: 'Politely inform the target it was never really there. Ignores defense.',
  },
  meteor: {
    id: 'meteor', fx: 'fire', name: 'Meteor', class: 'mage', cost: 68, charge: 6, target: 'all', tier: 3,
    power: 175, stat: 'int', burn: 0.6,
    desc: 'ULTIMATE — call the sky down. Devastates all enemies, 60% burn.',
  },

  /* ============ ARCHER (Focus) ============ */
  quick_shot: {
    id: 'quick_shot', fx: 'pierce', name: 'Quick Shot', class: 'archer', cost: 0, charge: 0, target: 'one',
    power: 90, stat: 'dex',
    desc: 'A swift arrow. Free to use.',
  },
  aimed_shot: {
    id: 'aimed_shot', fx: 'pierce', name: 'Aimed Shot', class: 'archer', cost: 16, charge: 1, target: 'one',
    power: 130, stat: 'dex', critBonus: 30,
    desc: 'Take a breath, then loose. +30% crit chance.',
  },
  evasive_roll: {
    id: 'evasive_roll', fx: 'wind', name: 'Evasive Roll', class: 'archer', cost: 14, charge: 0, target: 'self',
    buff: { stat: 'dodge', add: 35, turns: 3 },
    desc: 'Tumble aside and keep moving. +35% dodge for 3 turns.',
  },
  volley: {
    id: 'volley', fx: 'pierce', name: 'Volley', class: 'archer', cost: 28, charge: 3, target: 'all',
    power: 75, stat: 'dex',
    desc: 'Rain arrows on every enemy.',
  },
  serpent_arrow: {
    id: 'serpent_arrow', fx: 'poison', name: 'Serpent Arrow', class: 'archer', cost: 20, charge: 2, target: 'one', tier: 2,
    power: 105, stat: 'dex', poison: 0.9,
    desc: 'An arrow that bites twice. 90% chance to poison.',
  },
  pinning_shot: {
    id: 'pinning_shot', fx: 'pierce', name: 'Pinning Shot', class: 'archer', cost: 20, charge: 2, target: 'one', tier: 2,
    power: 100, stat: 'dex', stun: 0.5,
    desc: 'Nail a foe in place. 50% chance to stun.',
  },
  piercing_arrow: {
    id: 'piercing_arrow', fx: 'pierce', name: 'Piercing Arrow', class: 'archer', cost: 30, charge: 3, target: 'one', tier: 2,
    power: 180, stat: 'dex', ignoreDef: true,
    desc: 'Punches clean through armor — ignores defense.',
  },
  lightning_arrow: {
    id: 'lightning_arrow', fx: 'thunder', name: 'Lightning Arrow', class: 'archer', cost: 28, charge: 3, target: 'one', tier: 2,
    power: 155, stat: 'dex', stun: 0.35, critBonus: 15,
    desc: 'The storm rides your arrow down. 35% stun, +15% crit.',
  },
  one_shot: {
    id: 'one_shot', fx: 'pierce', name: 'One Shot', class: 'archer', cost: 40, charge: 5, target: 'one', tier: 3,
    power: 260, stat: 'dex', critBonus: 25,
    desc: 'One arrow. One ending. +25% crit.',
  },
  arrow_tempest: {
    id: 'arrow_tempest', fx: 'wind', name: 'Arrow Tempest', class: 'archer', cost: 54, charge: 6, target: 'all', tier: 3,
    power: 130, stat: 'dex', critBonus: 15,
    desc: 'ULTIMATE — the sky darkens. Massive damage to all, +15% crit.',
  },

  /* ============ ROGUE (Energy) ============ */
  backstab: composeSkill(
    { id: 'backstab', name: 'Backstab', class: 'rogue', fx: 'slash',
      desc: 'Strike from shadow. +15% crit chance. Free.' },
    COMP.cost(0), COMP.charge(0), COMP.target('one'), COMP.dmg(85, 'dex'), COMP.critBonus(15),
  ),
  poison_blade: composeSkill(
    { id: 'poison_blade', name: 'Poison Blade', class: 'rogue', fx: 'poison',
      desc: 'A coated dagger. 85% chance to poison.' },
    COMP.cost(15), COMP.charge(1), COMP.target('one'), COMP.dmg(70, 'dex'), COMP.poison(0.85),
  ),
  smoke_bomb: composeSkill(
    { id: 'smoke_bomb', name: 'Smoke Bomb', class: 'rogue', fx: 'wind',
      desc: 'Vanish in a cloud of smoke. +45% dodge for 3 turns.' },
    COMP.cost(16), COMP.charge(0), COMP.target('self'), COMP.buffAdd('dodge', 45, 3),
  ),
  fan_of_knives: composeSkill(
    { id: 'fan_of_knives', name: 'Fan of Knives', class: 'rogue', fx: 'slash',
      desc: 'Blades in every direction. 35% chance to poison each foe.' },
    COMP.cost(26), COMP.charge(3), COMP.target('all'), COMP.dmg(65, 'dex'), COMP.poison(0.35),
  ),
  shadow_dance: {
    id: 'shadow_dance', fx: 'shadow', name: 'Shadow Dance', class: 'rogue', cost: 24, charge: 1, target: 'self', tier: 2,
    buff: { stat: 'str', mult: 1.4, turns: 3 }, buff2: { stat: 'dodge', add: 20, turns: 3 },
    desc: 'Move like darkness. +40% damage and +20% dodge for 3 turns.',
  },
  assassinate: {
    id: 'assassinate', fx: 'shadow', name: 'Assassinate', class: 'rogue', cost: 40, charge: 4, target: 'one', tier: 2,
    power: 120, stat: 'dex', execute: 0.3,
    desc: 'Go for the throat. Instantly slays non-boss foes below 30% HP.',
  },
  loaded_dice: {
    id: 'loaded_dice', fx: 'luck', name: 'Loaded Dice', class: 'rogue', cost: 16, charge: 2, target: 'one', tier: 2,
    power: 100, stat: 'lk', critBonus: 40,
    desc: 'Luck does the stabbing. Scales on Luck, +40% crit.',
  },
  ghost_step: composeSkill(
    { id: 'ghost_step', name: 'Ghost Step', class: 'rogue', fx: 'shadow', tier: 2,
      desc: 'Briefly stop existing. +60% dodge this round, +30% damage after.' },
    COMP.cost(26), COMP.charge(2), COMP.target('self'),
    COMP.buffAdd('dodge', 60, 1), COMP.buff2('str', 1.3, 2),
  ),
  shadow_step: composeSkill(
    { id: 'shadow_step', name: 'Shadow Step', class: 'rogue', fx: 'shadow', tier: 2,
      desc: 'Slip the tempo: recover Energy, gain charge, and strike harder from nowhere.' },
    COMP.cost(18), COMP.charge(1), COMP.target('self'),
    COMP.buffAdd('dodge', 30, 2), COMP.buff2('str', 1.5, 2),
    COMP.gainResource(14), COMP.gainCharge(1),
  ),
  twist_of_fate: {
    id: 'twist_of_fate', fx: 'luck', name: 'Twist of Fate', class: 'rogue', cost: 36, charge: 5, target: 'all', tier: 3,
    power: 105, stat: 'lk', critBonus: 30,
    desc: 'Reshuffle everyone\'s luck but yours. Luck-scaling AOE, +30% crit.',
  },
  thousand_cuts: {
    id: 'thousand_cuts', fx: 'slash', name: 'Thousand Cuts', class: 'rogue', cost: 52, charge: 6, target: 'all', tier: 3,
    power: 125, stat: 'dex', poison: 0.7,
    desc: 'ULTIMATE — a blur of steel. Massive damage, 70% poison chance.',
  },

  /* ============ PRIEST (Faith) ============ */
  smite: {
    id: 'smite', fx: 'holy', name: 'Smite', class: 'priest', cost: 0, charge: 0, target: 'one',
    power: 90, stat: 'wis',
    desc: 'The light\'s opinion, delivered. Free to use.',
  },
  mend: {
    id: 'mend', fx: 'heal', name: 'Mend', class: 'priest', cost: 20, charge: 1, target: 'self', allyTarget: true,
    healPct: 0.3,
    desc: 'Close wounds with a murmured word. Restore 30% HP.',
  },
  radiant_ward: {
    id: 'radiant_ward', fx: 'buff', name: 'Radiant Ward', class: 'priest', cost: 16, charge: 0, target: 'self',
    shield: 0.5,
    desc: 'A halo of light blocks 50% of damage for 3 turns.',
  },
  aegis_hymn: composeSkill(
    { id: 'aegis_hymn', name: 'Aegis Hymn', class: 'priest', fx: 'buff', tier: 2,
      desc: 'A shared blessing — the party takes 35% less damage for 3 turns.' },
    COMP.cost(20), COMP.charge(2), COMP.target('self'),
    { partyBuff: { kind: 'dr', mult: 0.65, turns: 3, label: 'AEGIS' } },
  ),
  crusader_mark: composeSkill(
    { id: 'crusaders_mark', name: "Crusader's Mark", class: 'priest', fx: 'holy', tier: 2,
      desc: 'Brand a foe frail — they take +25% damage for 3 turns. Modest hit.' },
    COMP.cost(16), COMP.charge(1), COMP.target('one'), COMP.dmg(90, 'wis'), COMP.frail(1),
  ),
  judgement: {
    id: 'judgement', fx: 'holy', name: 'Judgement', class: 'priest', cost: 36, charge: 3, target: 'all',
    power: 80, stat: 'wis',
    desc: 'The verdict arrives for every enemy at once.',
  },
  censure: {
    id: 'censure', fx: 'holy', name: 'Censure', class: 'priest', cost: 20, charge: 2, target: 'one', tier: 2,
    power: 110, stat: 'wis', stun: 0.5,
    desc: 'Formally object to the target\'s existence. 50% stun.',
  },
  sanctuary: {
    id: 'sanctuary', fx: 'heal', name: 'Sanctuary', class: 'priest', cost: 30, charge: 2, target: 'self', tier: 2,
    shield: 0.6, healPct: 0.18,
    desc: 'Declare holy ground. Heal 18% HP and block 60% for 3 turns.',
  },
  profane_mercy: {
    id: 'profane_mercy', fx: 'shadow', name: 'Profane Mercy', class: 'priest', cost: 28, charge: 3, target: 'one', tier: 2,
    power: 150, stat: 'wis', lifesteal: 0.5,
    desc: 'Forgiveness, weaponized. Heavy damage, heal for half.',
  },
  final_verdict: {
    id: 'final_verdict', fx: 'holy', name: 'Final Verdict', class: 'priest', cost: 46, charge: 5, target: 'one', tier: 3,
    power: 230, stat: 'wis', execute: 0.2, frail: 0.6,
    desc: 'Gavel down. Massive damage; slays non-boss foes below 20%; 60% frail.',
  },
  last_rites: {
    id: 'last_rites', fx: 'holy', name: 'Last Rites', class: 'priest', cost: 58, charge: 6, target: 'all', tier: 3,
    power: 140, stat: 'wis', healPct: 0.15, frail: 0.4,
    desc: 'ULTIMATE — say the words for everyone at once. Devastates enemies, mends you; 40% frail.',
  },

  /* ============ MONK (Ki) ============ */
  palm_strike: {
    id: 'palm_strike', fx: 'blunt', name: 'Palm Strike', class: 'monk', cost: 0, charge: 0, target: 'one',
    power: 95, stat: 'dex',
    desc: 'An open hand, an honest argument. Free to use.',
  },
  flurry: {
    id: 'flurry', fx: 'blunt', name: 'Flurry', class: 'monk', cost: 16, charge: 1, target: 'one',
    power: 125, stat: 'dex', critBonus: 10,
    desc: 'Three strikes that arrive as one. +10% crit.',
  },
  iron_stance: {
    id: 'iron_stance', fx: 'buff', name: 'Iron Stance', class: 'monk', cost: 16, charge: 0, target: 'self',
    shield: 0.45, healPct: 0.08,
    desc: 'Root like a mountain: heal 8% and block 45% for 3 turns.',
  },
  hurricane_kick: {
    id: 'hurricane_kick', fx: 'wind', name: 'Hurricane Kick', class: 'monk', cost: 30, charge: 3, target: 'all',
    power: 78, stat: 'dex',
    desc: 'One rotation, every jaw. Hits all enemies.',
  },
  pressure_point: {
    id: 'pressure_point', fx: 'blunt', name: 'Pressure Point', class: 'monk', cost: 20, charge: 2, target: 'one', tier: 2,
    power: 130, stat: 'dex', ignoreDef: true,
    desc: 'Anatomy is a map. Ignores defense.',
  },
  immovable: {
    id: 'immovable', fx: 'buff', name: 'Immovable', class: 'monk', cost: 26, charge: 2, target: 'self', tier: 2,
    shield: 0.65, healPct: 0.12,
    desc: 'Become terrain. Heal 12% and block 65% for 3 turns.',
  },
  gale_palm: {
    id: 'gale_palm', fx: 'wind', name: 'Gale Palm', class: 'monk', cost: 24, charge: 2, target: 'one', tier: 2,
    power: 145, stat: 'dex', stun: 0.3,
    desc: 'Strike with borrowed wind. 30% stun.',
  },
  earthbreaker: {
    id: 'earthbreaker', fx: 'blunt', name: 'Earthbreaker', class: 'monk', cost: 40, charge: 5, target: 'all', tier: 3,
    power: 115, stat: 'str', stun: 0.25,
    desc: 'Ask the ground to object. AOE with 25% stun.',
  },
  phoenix_palm: {
    id: 'phoenix_palm', fx: 'fire', name: 'Phoenix Palm', class: 'monk', cost: 36, charge: 4, target: 'one', tier: 2,
    power: 175, stat: 'dex', healPct: 0.1, burn: 0.5,
    desc: 'Strike with everything you refused to burn. Heals you 10%, 50% burn.',
  },
  hundred_fists: {
    id: 'hundred_fists', fx: 'blunt', name: 'Hundred Fists', class: 'monk', cost: 54, charge: 6, target: 'all', tier: 3,
    power: 135, stat: 'dex',
    desc: 'ULTIMATE — the count is approximate. The devastation is not.',
  },

  /* ============ KIT FILLERS (random 4th starting skill pool) ============ */
  heavy_swing: {
    id: 'heavy_swing', fx: 'blunt', name: 'Heavy Swing', class: 'warrior', cost: 14, charge: 1, target: 'one',
    power: 125, stat: 'str',
    desc: 'Wind up and commit. Slow, honest, painful.',
  },
  mana_dart: {
    id: 'mana_dart', fx: 'arcane', name: 'Mana Dart', class: 'mage', cost: 10, charge: 0, target: 'one',
    power: 110, stat: 'int',
    desc: 'A needle of raw arcana. Cheap and precise.',
  },
  double_nock: {
    id: 'double_nock', fx: 'pierce', name: 'Double Nock', class: 'archer', cost: 14, charge: 1, target: 'one',
    power: 120, stat: 'dex',
    desc: 'Two arrows, one breath.',
  },
  throat_jab: {
    id: 'throat_jab', fx: 'blunt', name: 'Throat Jab', class: 'rogue', cost: 12, charge: 1, target: 'one',
    power: 95, stat: 'dex', stun: 0.25,
    desc: 'Rude, effective. 25% chance to stun.',
  },
  rebuke: {
    id: 'rebuke', fx: 'holy', name: 'Rebuke', class: 'priest', cost: 14, charge: 1, target: 'one',
    power: 115, stat: 'wis',
    desc: 'A pointed theological correction.',
  },
  low_sweep: {
    id: 'low_sweep', fx: 'wind', name: 'Low Sweep', class: 'monk', cost: 12, charge: 1, target: 'one',
    power: 100, stat: 'dex', stun: 0.2,
    desc: 'Take the legs; the rest follows. 20% stun.',
  },

  /* ============ WARLOCK (Pact) ============ */
  eldritch_bolt: {
    id: 'eldritch_bolt', fx: 'shadow', name: 'Eldritch Bolt', class: 'warlock', cost: 0, charge: 0, target: 'one',
    power: 95, stat: 'int',
    desc: 'Something on the other side of the pact throws it for you. Free.',
  },
  hex_mark: {
    id: 'hex_mark', fx: 'shadow', name: 'Hex Mark', class: 'warlock', cost: 15, charge: 1, target: 'one',
    power: 60, stat: 'int', hex: 0.9,
    desc: 'Brand a foe for suffering: hexed enemies take +25% damage. 90% chance.',
  },
  shadow_ward: {
    id: 'shadow_ward', fx: 'buff', name: 'Shadow Ward', class: 'warlock', cost: 18, charge: 0, target: 'self',
    shield: 0.45,
    desc: 'Wrap yourself in borrowed dark. Block 45% for 3 turns.',
  },
  dark_pact: {
    id: 'dark_pact', fx: 'shadow', name: 'Dark Pact', class: 'warlock', cost: 0, charge: 0, target: 'self',
    selfHpCost: 0.08, gainResource: 32, gainCharge: 1,
    desc: 'Pay in blood, be paid in power: -8% max HP, +18 Pact, +1 charge.',
  },
  rain_of_ruin: {
    id: 'rain_of_ruin', fx: 'shadow', name: 'Rain of Ruin', class: 'warlock', cost: 30, charge: 3, target: 'all',
    power: 80, stat: 'int',
    desc: 'The sky forgets whose side it is on. Hits all enemies.',
  },
  soul_rend: {
    id: 'soul_rend', fx: 'shadow', name: 'Soul Rend', class: 'warlock', cost: 26, charge: 2, target: 'one', tier: 2,
    power: 145, stat: 'int', lifesteal: 0.4,
    desc: 'Tear a strip off the spirit and wear it. Heals you (capped).',
  },
  void_grasp: {
    id: 'void_grasp', fx: 'shadow', name: 'Void Grasp', class: 'warlock', cost: 24, charge: 2, target: 'one', tier: 2,
    power: 110, stat: 'int', stun: 0.45,
    desc: 'The dark holds them still. 45% stun.',
  },
  fiend_whip: {
    id: 'fiend_whip', fx: 'fire', name: 'Fiend Whip', class: 'warlock', cost: 28, charge: 3, target: 'one', tier: 2,
    power: 160, stat: 'int', burn: 0.5,
    desc: 'Borrowed from a very specific circle of hell. 50% burn.',
  },
  null_wave: {
    id: 'null_wave', fx: 'shadow', name: 'Null Wave', class: 'warlock', cost: 36, charge: 4, target: 'all', tier: 2,
    power: 95, stat: 'int', hex: 0.35,
    desc: 'A ripple of un-being. Hits all, 35% hex.',
  },
  oblivion: {
    id: 'oblivion', fx: 'shadow', name: 'Oblivion', class: 'warlock', cost: 64, charge: 6, target: 'all', tier: 3,
    power: 160, stat: 'int', hex: 0.5, tormented: 0.45,
    desc: 'ULTIMATE: show them the space between stars. 50% hex, 45% torment.',
  },
  dawnbreak: {
    id: 'dawnbreak', fx: 'holy', name: 'Dawnbreak', class: 'warlock', cost: 40, charge: 4, target: 'one', tier: 2,
    power: 190, stat: 'int', healPct: 0.08,
    desc: 'The pact, inverted: darkness spent as light. Heals you 8%.',
  },

  /* ============ BARD (Verve) ============ */
  cutting_quip: {
    id: 'cutting_quip', fx: 'luck', name: 'Cutting Quip', class: 'bard', cost: 0, charge: 0, target: 'one',
    power: 90, stat: 'lk',
    desc: 'Words CAN hurt, when properly aimed. Scales on Luck. Free.',
  },
  rallying_chord: {
    id: 'rallying_chord', fx: 'buff', name: 'Rallying Chord', class: 'bard', cost: 16, charge: 1, target: 'self',
    buff: { stat: 'str', mult: 1.4, turns: 3 },
    partyBuff: { kind: 'dmg', mult: 1.25, turns: 3, label: 'RALLY' },
    desc: 'One chord, and the blood remembers courage. You +40% damage; the party +25% for 3 turns.',
  },
  soothing_refrain: {
    id: 'soothing_refrain', fx: 'heal', name: 'Soothing Refrain', class: 'bard', cost: 20, charge: 1, target: 'self', allyTarget: true,
    healPct: 0.25,
    desc: 'A verse that closes wounds — yours or a companion\'s. Restore 25% HP.',
  },
  iron_ballad: composeSkill(
    { id: 'iron_ballad', name: 'Iron Ballad', class: 'bard', fx: 'buff', tier: 2,
      desc: 'A low hymn that hardens the party — 25% less damage taken for 3 turns.' },
    COMP.cost(18), COMP.charge(2), COMP.target('self'),
    { partyBuff: { kind: 'dr', mult: 0.75, turns: 3, label: 'IRON' } },
  ),
  discord: {
    id: 'discord', fx: 'thunder', name: 'Discord', class: 'bard', cost: 15, charge: 1, target: 'one',
    power: 85, stat: 'lk', stun: 0.35,
    desc: 'A note the skull disagrees with. 35% stun.',
  },
  cacophony: {
    id: 'cacophony', fx: 'thunder', name: 'Cacophony', class: 'bard', cost: 28, charge: 3, target: 'all',
    power: 75, stat: 'lk',
    desc: 'All the wrong notes at once, weaponized.',
  },
  crescendo: {
    id: 'crescendo', fx: 'thunder', name: 'Crescendo', class: 'bard', cost: 26, charge: 3, target: 'one', tier: 2,
    power: 155, stat: 'lk', critBonus: 20,
    desc: 'Build, build, RELEASE. +20% crit.',
  },
  saga_of_steel: {
    id: 'saga_of_steel', fx: 'buff', name: 'Saga of Steel', class: 'bard', cost: 24, charge: 2, target: 'self', tier: 2,
    buff: { stat: 'str', mult: 1.5, turns: 3 }, buff2: { stat: 'dodge', add: 15, turns: 3 },
    desc: 'Sing the old war-songs until they become true. +50% damage, +15% dodge.',
  },
  inspire_greatness: {
    id: 'inspire_greatness', fx: 'heal', name: 'Inspire Greatness', class: 'bard', cost: 30, charge: 2, target: 'self', tier: 2, allyTarget: true,
    healPct: 0.35,
    desc: 'Remind someone who they are. Restore 35% HP — yours or a companion\'s.',
  },
  showstopper: {
    id: 'showstopper', fx: 'luck', name: 'Showstopper', class: 'bard', cost: 36, charge: 4, target: 'one', tier: 2,
    power: 175, stat: 'lk', critBonus: 30, confused: 0.4,
    desc: 'The finale they never saw coming. +30% crit; 40% confuse.',
  },
  grand_finale: {
    id: 'grand_finale', fx: 'thunder', name: 'Grand Finale', class: 'bard', cost: 54, charge: 6, target: 'all', tier: 3,
    power: 140, stat: 'lk', critBonus: 15, weaken: 0.4,
    desc: 'ULTIMATE: bring the house down. On their heads; 40% weaken.',
  },
  last_ballad: {
    id: 'last_ballad', fx: 'shadow', name: 'The Last Ballad', class: 'bard', cost: 40, charge: 4, target: 'all', tier: 2,
    power: 110, stat: 'lk', hex: 0.4,
    desc: 'The song that ends stories. Hits all, 40% hex.',
  },

  /* ============ NECROMANCER (Essence) — hidden class ============ */
  soul_bolt: {
    id: 'soul_bolt', fx: 'shadow', name: 'Soul Bolt', class: 'necromancer', cost: 0, charge: 0, target: 'one',
    power: 95, stat: 'int',
    desc: 'Cold fire from the space a soul leaves behind. Free.',
  },
  bone_spike: {
    id: 'bone_spike', fx: 'pierce', name: 'Bone Spike', class: 'necromancer', cost: 15, charge: 1, target: 'one',
    power: 120, stat: 'int',
    desc: 'The floor of the tower is mostly climbers. Ask it for a favor.',
  },
  corpse_ward: {
    id: 'corpse_ward', fx: 'buff', name: 'Corpse Ward', class: 'necromancer', cost: 18, charge: 0, target: 'self',
    shield: 0.5,
    desc: 'The dead stand between you and harm. Block 50% for 3 turns.',
  },
  siphon_life: {
    id: 'siphon_life', fx: 'shadow', name: 'Siphon Life', class: 'necromancer', cost: 20, charge: 1, target: 'one',
    power: 90, stat: 'int', lifesteal: 0.5,
    desc: 'Borrow what they were going to waste anyway. Heals you (capped).',
  },
  grave_bloom: {
    id: 'grave_bloom', fx: 'poison', name: 'Grave Bloom', class: 'necromancer', cost: 30, charge: 3, target: 'all',
    power: 80, stat: 'int', poison: 0.4,
    desc: 'Everything buried here flowers at once. 40% poison.',
  },
  wither: {
    id: 'wither', fx: 'shadow', name: 'Wither', class: 'necromancer', cost: 30, charge: 3, target: 'one', tier: 2,
    power: 130, stat: 'int', execute: 0.25,
    desc: 'Hurry the inevitable. Slays non-boss foes below 25%.',
  },
  marrow_curse: {
    id: 'marrow_curse', fx: 'shadow', name: 'Marrow Curse', class: 'necromancer', cost: 20, charge: 2, target: 'one', tier: 2,
    power: 95, stat: 'int', hex: 0.8, poison: 0.4,
    desc: 'Rot from the inside out. 80% hex, 40% poison.',
  },
  plague_wind: {
    id: 'plague_wind', fx: 'poison', name: 'Plague Wind', class: 'necromancer', cost: 36, charge: 4, target: 'all', tier: 2,
    power: 90, stat: 'int', poison: 0.7,
    desc: 'A breeze from somewhere quarantined. 70% poison.',
  },
  raise_anguish: {
    id: 'raise_anguish', fx: 'shadow', name: 'Raise Anguish', class: 'necromancer', cost: 34, charge: 3, target: 'one', tier: 2,
    power: 165, stat: 'int',
    desc: 'Summon everything this floor regrets, briefly, on top of one enemy.',
  },
  black_rain: {
    id: 'black_rain', fx: 'shadow', name: 'Black Rain', class: 'necromancer', cost: 50, charge: 5, target: 'all', tier: 3,
    power: 125, stat: 'int', poison: 0.5,
    desc: 'The clouds here have been to funerals. 50% poison.',
  },
  final_word: {
    id: 'final_word', fx: 'shadow', name: 'The Final Word', class: 'necromancer', cost: 46, charge: 5, target: 'one', tier: 3,
    power: 240, stat: 'int', execute: 0.2,
    desc: 'Speak the sentence every living thing is born owing.',
  },
  mass_grave: {
    id: 'mass_grave', fx: 'shadow', name: 'Mass Grave', class: 'necromancer', cost: 64, charge: 6, target: 'all', tier: 3,
    power: 165, stat: 'int', hex: 0.4,
    desc: 'ULTIMATE: the tower opens beneath them, and it is full.',
  },
  phylactery_pulse: {
    id: 'phylactery_pulse', fx: 'shadow', name: 'Phylactery Pulse', class: 'necromancer', cost: 36, charge: 4, target: 'one', tier: 2,
    power: 170, stat: 'int', healPct: 0.1,
    desc: 'Beat the heart you keep elsewhere. Heavy damage, heals you 10%.',
  },

  /* ============ EXTRA CLASS TECHNIQUES (§10 — richer per-class offers) ============ */
  sunder: {
    id: 'sunder', fx: 'slash', name: 'Sunder', class: 'warrior', cost: 18, charge: 2, target: 'one', tier: 2,
    power: 150, stat: 'str', ignoreDef: true,
    desc: 'Split shield and bone alike — this blow ignores their defense.',
  },
  bulwark: {
    id: 'bulwark', fx: 'buff', name: 'Bulwark', class: 'warrior', cost: 16, charge: 1, target: 'self', tier: 2,
    shield: 0.5, buff: { stat: 'str', mult: 1.25, turns: 3 },
    desc: 'Plant your feet: block 50% for 3 turns and hit 25% harder while braced.',
  },
  scorch: {
    id: 'scorch', fx: 'fire', name: 'Scorch', class: 'mage', cost: 24, charge: 2, target: 'one', tier: 2,
    power: 135, stat: 'int', burn: 0.7,
    desc: 'A clinging gout of flame. Heavy damage, 70% chance to burn.',
  },
  time_slip: {
    id: 'time_slip', fx: 'arcane', name: 'Time Slip', class: 'mage', cost: 30, charge: 2, target: 'self', tier: 2,
    buff: { stat: 'dodge', add: 40, turns: 3 }, gainCharge: 1,
    desc: 'Step half a second out of the moment. +40% dodge for 3 turns, +1 charge.',
  },
  hunters_mark: {
    id: 'hunters_mark', fx: 'pierce', name: 'Hunter\'s Mark', class: 'archer', cost: 20, charge: 2, target: 'one', tier: 2,
    power: 120, stat: 'dex', hex: 0.9,
    desc: 'Mark the quarry — a marked foe takes +25% damage from everything. 90% chance.',
  },
  caltrops: {
    id: 'caltrops', fx: 'poison', name: 'Caltrops', class: 'rogue', cost: 24, charge: 3, target: 'all', tier: 2,
    power: 65, stat: 'dex', poison: 0.6,
    desc: 'Scatter iron thorns across the floor. Hits all enemies, 60% poison.',
  },
  benediction: {
    id: 'benediction', fx: 'heal', name: 'Benediction', class: 'priest', cost: 28, charge: 2, target: 'self', tier: 2, allyTarget: true,
    healPct: 0.3, buff: { stat: 'str', mult: 1.2, turns: 3 },
    desc: 'A blessing with teeth. Restore 30% HP — yours or a companion\'s — and steel their strikes.',
  },
  flowing_form: {
    id: 'flowing_form', fx: 'wind', name: 'Flowing Form', class: 'monk', cost: 20, charge: 2, target: 'self', tier: 2,
    buff: { stat: 'dodge', add: 35, turns: 3 }, healPct: 0.08,
    desc: 'Water has no shape to strike. +35% dodge for 3 turns, mend 8%.',
  },

  /* ============ CHEAP TECHNIQUES — free upgrades & resource-only
     Philosophy: cost reflects power. Free learnables beat the class starter
     free hit, but stay well below high charge/resource finishers. Resource-
     only skills spend class pool and skip Battle Charge entirely. */
  tempered_cut: composeSkill(
    { id: 'tempered_cut', name: 'Tempered Cut', class: 'warrior', fx: 'slash', tier: 1,
      desc: 'A practiced edge — free, and cleaner than a raw Slash. Still no substitute for a charged blow.' },
    COMP.cost(0), COMP.charge(0), COMP.target('one'), COMP.dmg(118, 'str'),
  ),
  bracing_blow: composeSkill(
    { id: 'bracing_blow', name: 'Bracing Blow', class: 'warrior', fx: 'blunt', tier: 1,
      desc: 'Spend Vigor, keep your charge. Honest damage without banking segments.' },
    COMP.cost(16), COMP.charge(0), COMP.target('one'), COMP.dmg(128, 'str'),
  ),
  second_wind: composeSkill(
    { id: 'second_wind', name: 'Second Wind', class: 'warrior', fx: 'buff', tier: 1,
      desc: 'Catch your breath mid-fight. Heal 12% — Vigor only, no charge.' },
    COMP.cost(14), COMP.charge(0), COMP.target('self'), COMP.healPct(0.12),
  ),

  spark_lance: composeSkill(
    { id: 'spark_lance', name: 'Spark Lance', class: 'mage', fx: 'fire', tier: 1,
      desc: 'A hotter free bolt than Firebolt — still a cantrip next to a real storm.' },
    COMP.cost(0), COMP.charge(0), COMP.target('one'), COMP.dmg(114, 'int'), COMP.burn(0.28),
  ),
  prism_shard: composeSkill(
    { id: 'prism_shard', name: 'Prism Shard', class: 'mage', fx: 'arcane', tier: 1,
      desc: 'Spend Mana, skip charge. Sharp, cheap, single-minded.' },
    COMP.cost(14), COMP.charge(0), COMP.target('one'), COMP.dmg(126, 'int'),
  ),
  cantrip_focus: composeSkill(
    { id: 'cantrip_focus', name: 'Cantrip Focus', class: 'mage', fx: 'buff', tier: 1,
      desc: 'A thin ward woven from spare Mana. Block 30% for 3 turns — no charge spent.' },
    COMP.cost(12), COMP.charge(0), COMP.target('self'), COMP.shield(0.3),
  ),

  steady_draw: composeSkill(
    { id: 'steady_draw', name: 'Steady Draw', class: 'archer', fx: 'pierce', tier: 1,
      desc: 'Quieter than Quick Shot, harder. Free — and still shy of a true Aimed Shot.' },
    COMP.cost(0), COMP.charge(0), COMP.target('one'), COMP.dmg(112, 'dex'), COMP.critBonus(8),
  ),
  bodkin: composeSkill(
    { id: 'bodkin', name: 'Bodkin', class: 'archer', fx: 'pierce', tier: 1,
      desc: 'A narrow tip for a narrow budget. Resource only — no charge.' },
    COMP.cost(14), COMP.charge(0), COMP.target('one'), COMP.dmg(124, 'dex'),
  ),
  windstep: composeSkill(
    { id: 'windstep', name: 'Windstep', class: 'archer', fx: 'wind', tier: 1,
      desc: 'Slip sideways on spent Focus. +28% dodge for 2 turns, no charge.' },
    COMP.cost(12), COMP.charge(0), COMP.target('self'), COMP.buffAdd('dodge', 28, 2),
  ),

  quiet_cut: composeSkill(
    { id: 'quiet_cut', name: 'Quiet Cut', class: 'rogue', fx: 'slash', tier: 1,
      desc: 'A free cut that out-sharpens Backstab — still not an Assassinate.' },
    COMP.cost(0), COMP.charge(0), COMP.target('one'), COMP.dmg(108, 'dex'), COMP.critBonus(18),
  ),
  shiv: composeSkill(
    { id: 'shiv', name: 'Shiv', class: 'rogue', fx: 'poison', tier: 1,
      desc: 'Spend Energy, keep your charge banked. 40% poison.' },
    COMP.cost(12), COMP.charge(0), COMP.target('one'), COMP.dmg(118, 'dex'), COMP.poison(0.4),
  ),
  fade: composeSkill(
    { id: 'fade', name: 'Fade', class: 'rogue', fx: 'shadow', tier: 1,
      desc: 'A cheap vanishing act. +32% dodge for 2 turns — Energy only.' },
    COMP.cost(14), COMP.charge(0), COMP.target('self'), COMP.buffAdd('dodge', 32, 2),
  ),

  blessed_strike: composeSkill(
    { id: 'blessed_strike', name: 'Blessed Strike', class: 'priest', fx: 'holy', tier: 1,
      desc: 'A free Smite with more conviction — still not a Verdict.' },
    COMP.cost(0), COMP.charge(0), COMP.target('one'), COMP.dmg(112, 'wis'),
  ),
  lucent_bolt: composeSkill(
    { id: 'lucent_bolt', name: 'Lucent Bolt', class: 'priest', fx: 'holy', tier: 1,
      desc: 'Faith spent, charge spared. Solid single-target light.' },
    COMP.cost(14), COMP.charge(0), COMP.target('one'), COMP.dmg(124, 'wis'),
  ),
  minor_mend: composeSkill(
    { id: 'minor_mend', name: 'Minor Mend', class: 'priest', fx: 'heal', tier: 1, allyTarget: true,
      desc: 'A smaller Mend — 16% HP, Faith only, no charge.' },
    COMP.cost(14), COMP.charge(0), COMP.target('self'), COMP.healPct(0.16),
  ),

  knuckle: composeSkill(
    { id: 'knuckle', name: 'Knuckle', class: 'monk', fx: 'blunt', tier: 1,
      desc: 'A free fist better than Palm Strike — still no Flurry.' },
    COMP.cost(0), COMP.charge(0), COMP.target('one'), COMP.dmg(114, 'dex'),
  ),
  jab_chain: composeSkill(
    { id: 'jab_chain', name: 'Jab Chain', class: 'monk', fx: 'blunt', tier: 1,
      desc: 'Spend Ki, keep charge. Quick links of knuckle, +8% crit.' },
    COMP.cost(14), COMP.charge(0), COMP.target('one'), COMP.dmg(126, 'dex'), COMP.critBonus(8),
  ),
  breath_cycle: composeSkill(
    { id: 'breath_cycle', name: 'Breath Cycle', class: 'monk', fx: 'buff', tier: 1,
      desc: 'In, out, ready. Heal 8% and block 22% for 2 turns — Ki only.' },
    COMP.cost(12), COMP.charge(0), COMP.target('self'), COMP.healPct(0.08), COMP.shield(0.22),
  ),

  pact_sting: composeSkill(
    { id: 'pact_sting', name: 'Pact Sting', class: 'warlock', fx: 'shadow', tier: 1,
      desc: 'A free sting the other side sharpens for you — better than Eldritch Bolt, shy of Ruin.' },
    COMP.cost(0), COMP.charge(0), COMP.target('one'), COMP.dmg(114, 'int'),
  ),
  bleak_dart: composeSkill(
    { id: 'bleak_dart', name: 'Bleak Dart', class: 'warlock', fx: 'shadow', tier: 1,
      desc: 'Spend Pact, skip charge. 30% hex on a clean hit.' },
    COMP.cost(14), COMP.charge(0), COMP.target('one'), COMP.dmg(122, 'int'), COMP.hex(0.3),
  ),
  sip_shade: composeSkill(
    { id: 'sip_shade', name: 'Sip Shade', class: 'warlock', fx: 'shadow', tier: 1,
      desc: 'A modest drain. Light damage, 30% lifesteal — Pact only.' },
    COMP.cost(16), COMP.charge(0), COMP.target('one'), COMP.dmg(100, 'int'), COMP.lifesteal(0.3),
  ),

  wry_note: composeSkill(
    { id: 'wry_note', name: 'Wry Note', class: 'bard', fx: 'luck', tier: 1,
      desc: 'A free quip with more bite than Cutting Quip — still not a Crescendo.' },
    COMP.cost(0), COMP.charge(0), COMP.target('one'), COMP.dmg(110, 'lk'), COMP.critBonus(10),
  ),
  sting_verse: composeSkill(
    { id: 'sting_verse', name: 'Sting Verse', class: 'bard', fx: 'thunder', tier: 1,
      desc: 'Spend Verve, bank your charge. A pointed couplet.' },
    COMP.cost(14), COMP.charge(0), COMP.target('one'), COMP.dmg(122, 'lk'),
  ),
  soft_encore: composeSkill(
    { id: 'soft_encore', name: 'Soft Encore', class: 'bard', fx: 'heal', tier: 1, allyTarget: true,
      desc: 'A quiet recovery. Heal 14% — Verve only, no charge.' },
    COMP.cost(14), COMP.charge(0), COMP.target('self'), COMP.healPct(0.14),
  ),

  chill_bolt: composeSkill(
    { id: 'chill_bolt', name: 'Chill Bolt', class: 'necromancer', fx: 'ice', tier: 1,
      desc: 'A free Soul Bolt with more frost in it — still not a Wither.' },
    COMP.cost(0), COMP.charge(0), COMP.target('one'), COMP.dmg(114, 'int'), COMP.freeze(0.2),
  ),
  rib_shot: composeSkill(
    { id: 'rib_shot', name: 'Rib Shot', class: 'necromancer', fx: 'pierce', tier: 1,
      desc: 'Essence spent, charge kept. A borrowed bone, thrown hard.' },
    COMP.cost(14), COMP.charge(0), COMP.target('one'), COMP.dmg(124, 'int'),
  ),
  leach_touch: composeSkill(
    { id: 'leach_touch', name: 'Leach Touch', class: 'necromancer', fx: 'shadow', tier: 1,
      desc: 'A light siphon. Modest damage, 35% lifesteal — Essence only.' },
    COMP.cost(16), COMP.charge(0), COMP.target('one'), COMP.dmg(102, 'int'), COMP.lifesteal(0.35),
  ),

  /* Tier-2 cheap options — still no/low charge, a bit more punch */
  measured_strike: composeSkill(
    { id: 'measured_strike', name: 'Measured Strike', class: 'warrior', fx: 'slash', tier: 2,
      desc: 'Free technique of a seasoned blade. Stronger than Tempered Cut — still no Rampage.' },
    COMP.cost(0), COMP.charge(0), COMP.target('one'), COMP.dmg(128, 'str'),
  ),
  reserve_cast: composeSkill(
    { id: 'reserve_cast', name: 'Reserve Cast', class: 'mage', fx: 'arcane', tier: 2,
      desc: 'Mana only, no charge. Mid-weight bolt for climbers who save their storm.' },
    COMP.cost(20), COMP.charge(0), COMP.target('one'), COMP.dmg(138, 'int'),
  ),
  pocket_sand: composeSkill(
    { id: 'pocket_sand', name: 'Pocket Sand', class: 'rogue', fx: 'wind', tier: 2,
      desc: 'Dishonorable and free. Light damage, 35% stun — no charge required.' },
    COMP.cost(0), COMP.charge(0), COMP.target('one'), COMP.dmg(95, 'dex'), COMP.stun(0.35),
  ),
  hymn_snap: composeSkill(
    { id: 'hymn_snap', name: 'Hymn Snap', class: 'priest', fx: 'holy', tier: 2,
      desc: 'Faith-only censure. Solid damage without banking charge.' },
    COMP.cost(18), COMP.charge(0), COMP.target('one'), COMP.dmg(136, 'wis'),
  ),
  open_palm: composeSkill(
    { id: 'open_palm', name: 'Open Palm', class: 'monk', fx: 'blunt', tier: 2,
      desc: 'Free, polished, still not a Pressure Point. Clean Ki-less strike.' },
    COMP.cost(0), COMP.charge(0), COMP.target('one'), COMP.dmg(126, 'dex'),
  ),
  field_shot: composeSkill(
    { id: 'field_shot', name: 'Field Shot', class: 'archer', fx: 'pierce', tier: 2,
      desc: 'Focus spent in the field, charge saved for Volley. Reliable mid damage.' },
    COMP.cost(18), COMP.charge(0), COMP.target('one'), COMP.dmg(136, 'dex'),
  ),
  spite_needle: composeSkill(
    { id: 'spite_needle', name: 'Spite Needle', class: 'warlock', fx: 'shadow', tier: 2,
      desc: 'Pact-only spite. Better than Bleak Dart, still shy of Soul Rend.' },
    COMP.cost(18), COMP.charge(0), COMP.target('one'), COMP.dmg(134, 'int'), COMP.hex(0.25),
  ),
  aside: composeSkill(
    { id: 'aside', name: 'Aside', class: 'bard', fx: 'luck', tier: 2,
      desc: 'A free stage aside that stings. Luck-scaling, no charge.' },
    COMP.cost(0), COMP.charge(0), COMP.target('one'), COMP.dmg(122, 'lk'), COMP.critBonus(12),
  ),
  grave_pinch: composeSkill(
    { id: 'grave_pinch', name: 'Grave Pinch', class: 'necromancer', fx: 'shadow', tier: 2,
      desc: 'Essence only. A pinched soul-thread — mid damage, 20% poison.' },
    COMP.cost(18), COMP.charge(0), COMP.target('one'), COMP.dmg(132, 'int'), COMP.poison(0.2),
  ),

  /* ============ EXCLUSIVE / DROP-ONLY TECHNIQUES (§10, §16) ============
     class 'special' → never appears in a class\'s learnable pool; only granted
     by specific encounters, relics, or events. Scales on your best stat so any
     class can wield the spoils of a strange kill. */
  vampire_bite: {
    id: 'vampire_bite', fx: 'shadow', name: 'Vampiric Bite', class: 'special', cost: 14, charge: 1, target: 'one',
    power: 130, stat: 'best', lifesteal: 0.6,
    desc: 'The gift of the thing you killed in the dark. Heavy damage, and you drink deep (healing capped).',
  },
  frost_nova: {
    id: 'frost_nova', fx: 'ice', name: 'Frost Nova', class: 'special', cost: 30, charge: 3, target: 'all',
    power: 90, stat: 'best', freeze: 0.45,
    desc: 'A ring of killing cold, torn from a wraith. Hits all enemies, 45% freeze.',
  },
  dragon_breath: {
    id: 'dragon_breath', fx: 'fire', name: 'Dragon\'s Breath', class: 'special', cost: 36, charge: 3, target: 'all',
    power: 110, stat: 'best', burn: 0.6,
    desc: 'Borrowed from something with scales. Devastates all enemies, 60% burn.',
  },

  /* ============ SPELLSWORD (Arcana) ============
     Dual-stat identity: every blade-spell scales on STR+INT together
     (55% of the sum — stronger than either stat alone only if you feed both). */
  rune_edge: composeSkill(
    { id: 'rune_edge', name: 'Rune Edge', class: 'spellsword', fx: 'arcane',
      desc: 'A sword-cut edged in script. Free — scales on STR+INT together.' },
    COMP.cost(0), COMP.charge(0), COMP.target('one'), COMP.dmg(100, 'str+int'),
  ),
  arc_ward: composeSkill(
    { id: 'arc_ward', name: 'Arc Ward', class: 'spellsword', fx: 'buff',
      desc: 'A thin shield of circulating Arcana. Block 48% of damage for 3 turns.' },
    COMP.cost(18), COMP.charge(0), COMP.target('self'), COMP.shield(0.48),
  ),
  mana_lunge: composeSkill(
    { id: 'mana_lunge', name: 'Mana Lunge', class: 'spellsword', fx: 'slash',
      desc: 'Close the gap with a charged blade. Solid hybrid damage.' },
    COMP.cost(16), COMP.charge(1), COMP.target('one'), COMP.dmg(125, 'str+int'),
  ),
  sigil_thrust: composeSkill(
    { id: 'sigil_thrust', name: 'Sigil Thrust', class: 'spellsword', fx: 'pierce',
      desc: 'A short thrust stamped with a killing mark. Cheap and precise.' },
    COMP.cost(12), COMP.charge(1), COMP.target('one'), COMP.dmg(118, 'str+int'),
  ),
  blade_tempest: composeSkill(
    { id: 'blade_tempest', name: 'Blade Tempest', class: 'spellsword', fx: 'arcane',
      desc: 'A whirl of steel and loose glyphs. Hits every enemy.' },
    COMP.cost(30), COMP.charge(3), COMP.target('all'), COMP.dmg(78, 'str+int'),
  ),
  aegis_cut: composeSkill(
    { id: 'aegis_cut', name: 'Aegis Cut', class: 'spellsword', fx: 'slash', tier: 2,
      desc: 'Strike and brace as one motion. Solid damage; block 30% for 3 turns.' },
    COMP.cost(22), COMP.charge(2), COMP.target('one'), COMP.dmg(135, 'str+int'),
    COMP.shield(0.3),
  ),
  hex_rend: composeSkill(
    { id: 'hex_rend', name: 'Hex Rend', class: 'spellsword', fx: 'shadow', tier: 2,
      desc: 'Carve a curse into the wound. Hexed foes take +25% damage. 85% chance.' },
    COMP.cost(20), COMP.charge(2), COMP.target('one'), COMP.dmg(115, 'str+int'),
    COMP.hex(0.85),
  ),
  sanctum_blade: composeSkill(
    { id: 'sanctum_blade', name: 'Sanctum Blade', class: 'spellsword', fx: 'holy', tier: 3,
      desc: 'ULTIMATE — oath-bound steel. Heavy single-target; light mends you 8%.' },
    COMP.cost(48), COMP.charge(5), COMP.target('one'), COMP.dmg(200, 'str+int'),
    COMP.healPct(0.08),
  ),
  living_script: composeSkill(
    { id: 'living_script', name: 'Living Script', class: 'spellsword', fx: 'arcane', tier: 3,
      desc: 'ULTIMATE — the blade writes a storm. Hits all enemies; 40% hex.' },
    COMP.cost(52), COMP.charge(6), COMP.target('all'), COMP.dmg(125, 'str+int'),
    COMP.hex(0.4),
  ),
  eclipse_cut: composeSkill(
    { id: 'eclipse_cut', name: 'Eclipse Cut', class: 'spellsword', fx: 'shadow', tier: 2,
      desc: 'Cut with the void between spell and steel. Heavy damage; ignores defense.' },
    COMP.cost(34), COMP.charge(4), COMP.target('one'), COMP.dmg(175, 'str+int'),
    COMP.ignoreDef(),
  ),
  glyph_parry: composeSkill(
    { id: 'glyph_parry', name: 'Glyph Parry', class: 'spellsword', fx: 'buff', tier: 2,
      desc: 'Intercept with a floating rune. Block 40% and recover a little Arcana.' },
    COMP.cost(16), COMP.charge(1), COMP.target('self'),
    COMP.shield(0.4), COMP.gainResource(10),
  ),
  spark_riposte: composeSkill(
    { id: 'spark_riposte', name: 'Spark Riposte', class: 'spellsword', fx: 'thunder', tier: 2,
      desc: 'Answer a threat with a charged counter-cut. 30% stun.' },
    COMP.cost(24), COMP.charge(2), COMP.target('one'), COMP.dmg(140, 'str+int'),
    COMP.stun(0.3),
  ),

  /* ---- NPC / event specials ---- */
  veteran_guard: composeSkill(
    { id: 'veteran_guard', name: 'Veteran Guard', class: 'special', fx: 'buff',
      desc: 'Old parade-ground habit. Block 40% for 3 turns and gain +1 charge.' },
    COMP.cost(10), COMP.charge(0), COMP.target('self'),
    COMP.shield(0.4), COMP.gainCharge(1),
  ),
  scholar_hex: composeSkill(
    { id: 'scholar_hex', name: 'Apostate\'s Hex', class: 'special', fx: 'arcane',
      desc: 'A footnote that bites back. Modest damage; 75% chance to hex.' },
    COMP.cost(16), COMP.charge(1), COMP.target('one'), COMP.dmg(105, 'best'),
    COMP.hex(0.75),
  ),
  pathfinder_mark: composeSkill(
    { id: 'pathfinder_mark', name: 'Pathfinder\'s Mark', class: 'special', fx: 'pierce',
      desc: 'Mark the trail — and the quarry. Solid hit; 80% hex.' },
    COMP.cost(18), COMP.charge(2), COMP.target('one'), COMP.dmg(115, 'best'),
    COMP.hex(0.8),
  ),
  axe_pack_cleave: composeSkill(
    { id: 'axe_pack_cleave', name: 'Bearded Cleave', class: 'special', fx: 'slash',
      desc: 'The old axe-pack habit: cut deep, take a little back. Heavy hit with lifesteal.' },
    COMP.cost(20), COMP.charge(2), COMP.target('one'), COMP.dmg(145, 'best'),
    COMP.lifesteal(0.25),
  ),
  harvest_swing: composeSkill(
    { id: 'harvest_swing', name: 'Harvest Swing', class: 'special', fx: 'blunt',
      desc: 'A scythe-motion meant for wheat. Mild damage. Honest work.' },
    COMP.cost(8), COMP.charge(0), COMP.target('one'), COMP.dmg(95, 'best'),
  ),
  elder_lesson: composeSkill(
    { id: 'elder_lesson', name: 'Elder\'s Lesson', class: 'special', fx: 'holy',
      desc: 'ULTIMATE — the last thing the old climber taught you. Devastates all foes.' },
    COMP.cost(56), COMP.charge(6), COMP.target('all'), COMP.dmg(155, 'best'),
  ),
  militia_press: composeSkill(
    { id: 'militia_press', name: 'Militia Press', class: 'special', fx: 'blunt',
      desc: 'Town-watch training: shove them off-balance. 40% stun.' },
    COMP.cost(14), COMP.charge(1), COMP.target('one'), COMP.dmg(100, 'best'),
    COMP.stun(0.4),
  ),
  hedge_cantrip: composeSkill(
    { id: 'hedge_cantrip', name: 'Hedge Cantrip', class: 'special', fx: 'fire',
      desc: 'Half-remembered village magic. Light burn chance, no charge required.' },
    COMP.cost(12), COMP.charge(0), COMP.target('one'), COMP.dmg(108, 'best'),
    COMP.burn(0.35),
  ),
};

// Learnable pool: class skills gated by tier + your subclass lineage's skills.
export function skillsForClass(cls, tier = 1) {
  return Object.values(SKILLS).filter(s => s.class === cls && (s.tier || 1) <= tier);
}
