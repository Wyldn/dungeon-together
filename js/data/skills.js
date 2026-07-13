// Skill library. Every ability may cost class resource (cost) AND Battle
// Charge (charge) — handoff §11/§13. AOE and heavy hits are charge-gated so
// enemies get a chance to act. All effects stay declarative.
//
// target: 'one' | 'all' | 'self'
// tier: 1 = starting kit, 2 = level 6+, 3 = level 13+ offers

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
  slash: {
    id: 'slash', fx: 'slash', name: 'Slash', class: 'warrior', cost: 0, charge: 0, target: 'one',
    power: 100, stat: 'str',
    desc: 'A dependable strike. Free to use.',
  },
  shield_bash: {
    id: 'shield_bash', fx: 'blunt', name: 'Shield Bash', class: 'warrior', cost: 8, charge: 1, target: 'one',
    power: 80, stat: 'str', stun: 0.45,
    desc: 'Slam your shield into the foe. 45% chance to stun.',
  },
  war_cry: {
    id: 'war_cry', fx: 'buff', name: 'War Cry', class: 'warrior', cost: 10, charge: 1, target: 'self',
    buff: { stat: 'str', mult: 1.5, turns: 3 },
    desc: 'Bellow with fury. +50% damage for 3 turns.',
  },
  cleave: {
    id: 'cleave', fx: 'slash', name: 'Cleave', class: 'warrior', cost: 14, charge: 3, target: 'all',
    power: 70, stat: 'str',
    desc: 'A sweeping blow that hits every enemy.',
  },
  iron_will: {
    id: 'iron_will', fx: 'buff', name: 'Iron Will', class: 'warrior', cost: 12, charge: 1, target: 'self', tier: 2,
    shield: 0.35, healPct: 0.12,
    desc: 'Steel yourself: heal 12% HP and block 35% of damage for 3 turns.',
  },
  rampage: {
    id: 'rampage', fx: 'slash', name: 'Rampage', class: 'warrior', cost: 14, charge: 3, target: 'one', tier: 2,
    power: 165, stat: 'str', selfHpCost: 0.06,
    desc: 'Trade blood for violence: heavy damage, costs 6% of your max HP.',
  },
  holy_strike: {
    id: 'holy_strike', fx: 'holy', name: 'Holy Strike', class: 'warrior', cost: 18, charge: 3, target: 'one', tier: 2,
    power: 170, stat: 'str', healPct: 0.06,
    desc: 'Radiant judgment. Heavy damage; the light mends you slightly.',
  },
  reapers_toll: {
    id: 'reapers_toll', fx: 'shadow', name: 'Reaper\'s Toll', class: 'warrior', cost: 16, charge: 4, target: 'one', tier: 2,
    power: 150, stat: 'str', execute: 0.25,
    desc: 'Collect what is owed. Slays non-boss foes below 25% HP outright.',
  },
  whirlwind: {
    id: 'whirlwind', fx: 'slash', name: 'Whirlwind', class: 'warrior', cost: 24, charge: 6, target: 'all', tier: 3,
    power: 130, stat: 'str',
    desc: 'ULTIMATE — become the storm. Massive damage to all enemies.',
  },

  /* ============ MAGE (Mana) ============ */
  firebolt: {
    id: 'firebolt', fx: 'fire', name: 'Firebolt', class: 'mage', cost: 0, charge: 0, target: 'one',
    power: 95, stat: 'int', burn: 0.35,
    desc: 'A dart of flame. 35% chance to burn.',
  },
  frost_lance: {
    id: 'frost_lance', fx: 'ice', name: 'Frost Lance', class: 'mage', cost: 10, charge: 1, target: 'one',
    power: 110, stat: 'int', freeze: 0.35,
    desc: 'Impale with ice. 35% chance to freeze the target.',
  },
  arcane_ward: {
    id: 'arcane_ward', fx: 'buff', name: 'Arcane Ward', class: 'mage', cost: 12, charge: 0, target: 'self',
    shield: 0.5,
    desc: 'A shimmering barrier blocks 50% of damage for 3 turns.',
  },
  mana_storm: {
    id: 'mana_storm', fx: 'arcane', name: 'Mana Storm', class: 'mage', cost: 18, charge: 3, target: 'all',
    power: 85, stat: 'int',
    desc: 'Unleash raw arcana on every enemy.',
  },
  soul_siphon: {
    id: 'soul_siphon', fx: 'shadow', name: 'Soul Siphon', class: 'mage', cost: 14, charge: 2, target: 'one', tier: 2,
    power: 90, stat: 'int', lifesteal: 0.6,
    desc: 'Drain a foe\'s essence, healing for 60% of damage dealt.',
  },
  chain_lightning: {
    id: 'chain_lightning', fx: 'thunder', name: 'Chain Lightning', class: 'mage', cost: 20, charge: 4, target: 'all', tier: 2,
    power: 105, stat: 'int', stun: 0.2,
    desc: 'Lightning arcs between foes. 20% chance to stun each.',
  },
  rune_slash: {
    id: 'rune_slash', fx: 'arcane', name: 'Rune Slash', class: 'mage', cost: 12, charge: 2, target: 'one', tier: 2,
    power: 140, stat: 'int', ignoreDef: true,
    desc: 'A blade-arc of pure script — armor means nothing to grammar.',
  },
  blade_storm: {
    id: 'blade_storm', fx: 'arcane', name: 'Blade Storm', class: 'mage', cost: 22, charge: 5, target: 'all', tier: 3,
    power: 120, stat: 'int',
    desc: 'Every spell your sword remembers, all at once, everywhere.',
  },
  unmake: {
    id: 'unmake', fx: 'shadow', name: 'Unmake', class: 'mage', cost: 20, charge: 4, target: 'one', tier: 2,
    power: 180, stat: 'int', ignoreDef: true,
    desc: 'Politely inform the target it was never really there. Ignores defense.',
  },
  meteor: {
    id: 'meteor', fx: 'fire', name: 'Meteor', class: 'mage', cost: 32, charge: 6, target: 'all', tier: 3,
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
    id: 'aimed_shot', fx: 'pierce', name: 'Aimed Shot', class: 'archer', cost: 10, charge: 1, target: 'one',
    power: 130, stat: 'dex', critBonus: 30,
    desc: 'Take a breath, then loose. +30% crit chance.',
  },
  evasive_roll: {
    id: 'evasive_roll', fx: 'wind', name: 'Evasive Roll', class: 'archer', cost: 8, charge: 0, target: 'self',
    buff: { stat: 'dodge', add: 35, turns: 3 },
    desc: 'Tumble aside and keep moving. +35% dodge for 3 turns.',
  },
  volley: {
    id: 'volley', fx: 'pierce', name: 'Volley', class: 'archer', cost: 15, charge: 3, target: 'all',
    power: 75, stat: 'dex',
    desc: 'Rain arrows on every enemy.',
  },
  serpent_arrow: {
    id: 'serpent_arrow', fx: 'poison', name: 'Serpent Arrow', class: 'archer', cost: 12, charge: 2, target: 'one', tier: 2,
    power: 105, stat: 'dex', poison: 0.9,
    desc: 'An arrow that bites twice. 90% chance to poison.',
  },
  pinning_shot: {
    id: 'pinning_shot', fx: 'pierce', name: 'Pinning Shot', class: 'archer', cost: 12, charge: 2, target: 'one', tier: 2,
    power: 100, stat: 'dex', stun: 0.5,
    desc: 'Nail a foe in place. 50% chance to stun.',
  },
  piercing_arrow: {
    id: 'piercing_arrow', fx: 'pierce', name: 'Piercing Arrow', class: 'archer', cost: 16, charge: 3, target: 'one', tier: 2,
    power: 180, stat: 'dex', ignoreDef: true,
    desc: 'Punches clean through armor — ignores defense.',
  },
  lightning_arrow: {
    id: 'lightning_arrow', fx: 'thunder', name: 'Lightning Arrow', class: 'archer', cost: 15, charge: 3, target: 'one', tier: 2,
    power: 155, stat: 'dex', stun: 0.35, critBonus: 15,
    desc: 'The storm rides your arrow down. 35% stun, +15% crit.',
  },
  one_shot: {
    id: 'one_shot', fx: 'pierce', name: 'One Shot', class: 'archer', cost: 20, charge: 5, target: 'one', tier: 3,
    power: 260, stat: 'dex', critBonus: 25,
    desc: 'One arrow. One ending. +25% crit.',
  },
  arrow_tempest: {
    id: 'arrow_tempest', fx: 'wind', name: 'Arrow Tempest', class: 'archer', cost: 26, charge: 6, target: 'all', tier: 3,
    power: 130, stat: 'dex', critBonus: 15,
    desc: 'ULTIMATE — the sky darkens. Massive damage to all, +15% crit.',
  },

  /* ============ ROGUE (Energy) ============ */
  backstab: {
    id: 'backstab', fx: 'slash', name: 'Backstab', class: 'rogue', cost: 0, charge: 0, target: 'one',
    power: 85, stat: 'dex', critBonus: 15,
    desc: 'Strike from shadow. +15% crit chance. Free.',
  },
  poison_blade: {
    id: 'poison_blade', fx: 'poison', name: 'Poison Blade', class: 'rogue', cost: 9, charge: 1, target: 'one',
    power: 70, stat: 'dex', poison: 0.85,
    desc: 'A coated dagger. 85% chance to poison.',
  },
  smoke_bomb: {
    id: 'smoke_bomb', fx: 'wind', name: 'Smoke Bomb', class: 'rogue', cost: 10, charge: 0, target: 'self',
    buff: { stat: 'dodge', add: 45, turns: 3 },
    desc: 'Vanish in a cloud of smoke. +45% dodge for 3 turns.',
  },
  fan_of_knives: {
    id: 'fan_of_knives', fx: 'slash', name: 'Fan of Knives', class: 'rogue', cost: 14, charge: 3, target: 'all',
    power: 65, stat: 'dex', poison: 0.35,
    desc: 'Blades in every direction. 35% chance to poison each foe.',
  },
  shadow_dance: {
    id: 'shadow_dance', fx: 'shadow', name: 'Shadow Dance', class: 'rogue', cost: 13, charge: 1, target: 'self', tier: 2,
    buff: { stat: 'str', mult: 1.4, turns: 3 }, buff2: { stat: 'dodge', add: 20, turns: 3 },
    desc: 'Move like darkness. +40% damage and +20% dodge for 3 turns.',
  },
  assassinate: {
    id: 'assassinate', fx: 'shadow', name: 'Assassinate', class: 'rogue', cost: 20, charge: 4, target: 'one', tier: 2,
    power: 120, stat: 'dex', execute: 0.3,
    desc: 'Go for the throat. Instantly slays non-boss foes below 30% HP.',
  },
  loaded_dice: {
    id: 'loaded_dice', fx: 'luck', name: 'Loaded Dice', class: 'rogue', cost: 10, charge: 2, target: 'one', tier: 2,
    power: 100, stat: 'lk', critBonus: 40,
    desc: 'Luck does the stabbing. Scales on Luck, +40% crit.',
  },
  ghost_step: {
    id: 'ghost_step', fx: 'shadow', name: 'Ghost Step', class: 'rogue', cost: 14, charge: 2, target: 'self', tier: 2,
    buff: { stat: 'dodge', add: 60, turns: 1 }, buff2: { stat: 'str', mult: 1.3, turns: 2 },
    desc: 'Briefly stop existing. +60% dodge this round, +30% damage after.',
  },
  twist_of_fate: {
    id: 'twist_of_fate', fx: 'luck', name: 'Twist of Fate', class: 'rogue', cost: 18, charge: 5, target: 'all', tier: 3,
    power: 105, stat: 'lk', critBonus: 30,
    desc: 'Reshuffle everyone\'s luck but yours. Luck-scaling AOE, +30% crit.',
  },
  thousand_cuts: {
    id: 'thousand_cuts', fx: 'slash', name: 'Thousand Cuts', class: 'rogue', cost: 25, charge: 6, target: 'all', tier: 3,
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
    id: 'mend', fx: 'heal', name: 'Mend', class: 'priest', cost: 12, charge: 1, target: 'self', allyTarget: true,
    healPct: 0.3,
    desc: 'Close wounds with a murmured word. Restore 30% HP.',
  },
  radiant_ward: {
    id: 'radiant_ward', fx: 'buff', name: 'Radiant Ward', class: 'priest', cost: 10, charge: 0, target: 'self',
    shield: 0.5,
    desc: 'A halo of light blocks 50% of damage for 3 turns.',
  },
  judgement: {
    id: 'judgement', fx: 'holy', name: 'Judgement', class: 'priest', cost: 18, charge: 3, target: 'all',
    power: 80, stat: 'wis',
    desc: 'The verdict arrives for every enemy at once.',
  },
  censure: {
    id: 'censure', fx: 'holy', name: 'Censure', class: 'priest', cost: 12, charge: 2, target: 'one', tier: 2,
    power: 110, stat: 'wis', stun: 0.5,
    desc: 'Formally object to the target\'s existence. 50% stun.',
  },
  sanctuary: {
    id: 'sanctuary', fx: 'heal', name: 'Sanctuary', class: 'priest', cost: 16, charge: 2, target: 'self', tier: 2,
    shield: 0.6, healPct: 0.18,
    desc: 'Declare holy ground. Heal 18% HP and block 60% for 3 turns.',
  },
  profane_mercy: {
    id: 'profane_mercy', fx: 'shadow', name: 'Profane Mercy', class: 'priest', cost: 15, charge: 3, target: 'one', tier: 2,
    power: 150, stat: 'wis', lifesteal: 0.5,
    desc: 'Forgiveness, weaponized. Heavy damage, heal for half.',
  },
  final_verdict: {
    id: 'final_verdict', fx: 'holy', name: 'Final Verdict', class: 'priest', cost: 22, charge: 5, target: 'one', tier: 3,
    power: 230, stat: 'wis', execute: 0.2,
    desc: 'Gavel down. Massive damage; slays non-boss foes below 20%.',
  },
  last_rites: {
    id: 'last_rites', fx: 'holy', name: 'Last Rites', class: 'priest', cost: 28, charge: 6, target: 'all', tier: 3,
    power: 140, stat: 'wis', healPct: 0.15,
    desc: 'ULTIMATE — say the words for everyone at once. Devastates enemies, mends you.',
  },

  /* ============ MONK (Ki) ============ */
  palm_strike: {
    id: 'palm_strike', fx: 'blunt', name: 'Palm Strike', class: 'monk', cost: 0, charge: 0, target: 'one',
    power: 95, stat: 'dex',
    desc: 'An open hand, an honest argument. Free to use.',
  },
  flurry: {
    id: 'flurry', fx: 'blunt', name: 'Flurry', class: 'monk', cost: 10, charge: 1, target: 'one',
    power: 125, stat: 'dex', critBonus: 10,
    desc: 'Three strikes that arrive as one. +10% crit.',
  },
  iron_stance: {
    id: 'iron_stance', fx: 'buff', name: 'Iron Stance', class: 'monk', cost: 10, charge: 0, target: 'self',
    shield: 0.45, healPct: 0.08,
    desc: 'Root like a mountain: heal 8% and block 45% for 3 turns.',
  },
  hurricane_kick: {
    id: 'hurricane_kick', fx: 'wind', name: 'Hurricane Kick', class: 'monk', cost: 16, charge: 3, target: 'all',
    power: 78, stat: 'dex',
    desc: 'One rotation, every jaw. Hits all enemies.',
  },
  pressure_point: {
    id: 'pressure_point', fx: 'blunt', name: 'Pressure Point', class: 'monk', cost: 12, charge: 2, target: 'one', tier: 2,
    power: 130, stat: 'dex', ignoreDef: true,
    desc: 'Anatomy is a map. Ignores defense.',
  },
  immovable: {
    id: 'immovable', fx: 'buff', name: 'Immovable', class: 'monk', cost: 14, charge: 2, target: 'self', tier: 2,
    shield: 0.65, healPct: 0.12,
    desc: 'Become terrain. Heal 12% and block 65% for 3 turns.',
  },
  gale_palm: {
    id: 'gale_palm', fx: 'wind', name: 'Gale Palm', class: 'monk', cost: 13, charge: 2, target: 'one', tier: 2,
    power: 145, stat: 'dex', stun: 0.3,
    desc: 'Strike with borrowed wind. 30% stun.',
  },
  earthbreaker: {
    id: 'earthbreaker', fx: 'blunt', name: 'Earthbreaker', class: 'monk', cost: 20, charge: 5, target: 'all', tier: 3,
    power: 115, stat: 'str', stun: 0.25,
    desc: 'Ask the ground to object. AOE with 25% stun.',
  },
  phoenix_palm: {
    id: 'phoenix_palm', fx: 'fire', name: 'Phoenix Palm', class: 'monk', cost: 18, charge: 4, target: 'one', tier: 2,
    power: 175, stat: 'dex', healPct: 0.1, burn: 0.5,
    desc: 'Strike with everything you refused to burn. Heals you 10%, 50% burn.',
  },
  hundred_fists: {
    id: 'hundred_fists', fx: 'blunt', name: 'Hundred Fists', class: 'monk', cost: 26, charge: 6, target: 'all', tier: 3,
    power: 135, stat: 'dex',
    desc: 'ULTIMATE — the count is approximate. The devastation is not.',
  },

  /* ============ KIT FILLERS (random 4th starting skill pool) ============ */
  heavy_swing: {
    id: 'heavy_swing', fx: 'blunt', name: 'Heavy Swing', class: 'warrior', cost: 8, charge: 1, target: 'one',
    power: 125, stat: 'str',
    desc: 'Wind up and commit. Slow, honest, painful.',
  },
  mana_dart: {
    id: 'mana_dart', fx: 'arcane', name: 'Mana Dart', class: 'mage', cost: 6, charge: 0, target: 'one',
    power: 110, stat: 'int',
    desc: 'A needle of raw arcana. Cheap and precise.',
  },
  double_nock: {
    id: 'double_nock', fx: 'pierce', name: 'Double Nock', class: 'archer', cost: 8, charge: 1, target: 'one',
    power: 120, stat: 'dex',
    desc: 'Two arrows, one breath.',
  },
  throat_jab: {
    id: 'throat_jab', fx: 'blunt', name: 'Throat Jab', class: 'rogue', cost: 7, charge: 1, target: 'one',
    power: 95, stat: 'dex', stun: 0.25,
    desc: 'Rude, effective. 25% chance to stun.',
  },
  rebuke: {
    id: 'rebuke', fx: 'holy', name: 'Rebuke', class: 'priest', cost: 8, charge: 1, target: 'one',
    power: 115, stat: 'wis',
    desc: 'A pointed theological correction.',
  },
  low_sweep: {
    id: 'low_sweep', fx: 'wind', name: 'Low Sweep', class: 'monk', cost: 7, charge: 1, target: 'one',
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
    id: 'hex_mark', fx: 'shadow', name: 'Hex Mark', class: 'warlock', cost: 9, charge: 1, target: 'one',
    power: 60, stat: 'int', hex: 0.9,
    desc: 'Brand a foe for suffering: hexed enemies take +25% damage. 90% chance.',
  },
  shadow_ward: {
    id: 'shadow_ward', fx: 'buff', name: 'Shadow Ward', class: 'warlock', cost: 11, charge: 0, target: 'self',
    shield: 0.45,
    desc: 'Wrap yourself in borrowed dark. Block 45% for 3 turns.',
  },
  dark_pact: {
    id: 'dark_pact', fx: 'shadow', name: 'Dark Pact', class: 'warlock', cost: 0, charge: 0, target: 'self',
    selfHpCost: 0.08, gainResource: 18, gainCharge: 1,
    desc: 'Pay in blood, be paid in power: -8% max HP, +18 Pact, +1 charge.',
  },
  rain_of_ruin: {
    id: 'rain_of_ruin', fx: 'shadow', name: 'Rain of Ruin', class: 'warlock', cost: 16, charge: 3, target: 'all',
    power: 80, stat: 'int',
    desc: 'The sky forgets whose side it is on. Hits all enemies.',
  },
  soul_rend: {
    id: 'soul_rend', fx: 'shadow', name: 'Soul Rend', class: 'warlock', cost: 14, charge: 2, target: 'one', tier: 2,
    power: 145, stat: 'int', lifesteal: 0.4,
    desc: 'Tear a strip off the spirit and wear it. Heals you (capped).',
  },
  void_grasp: {
    id: 'void_grasp', fx: 'shadow', name: 'Void Grasp', class: 'warlock', cost: 13, charge: 2, target: 'one', tier: 2,
    power: 110, stat: 'int', stun: 0.45,
    desc: 'The dark holds them still. 45% stun.',
  },
  fiend_whip: {
    id: 'fiend_whip', fx: 'fire', name: 'Fiend Whip', class: 'warlock', cost: 15, charge: 3, target: 'one', tier: 2,
    power: 160, stat: 'int', burn: 0.5,
    desc: 'Borrowed from a very specific circle of hell. 50% burn.',
  },
  null_wave: {
    id: 'null_wave', fx: 'shadow', name: 'Null Wave', class: 'warlock', cost: 18, charge: 4, target: 'all', tier: 2,
    power: 95, stat: 'int', hex: 0.35,
    desc: 'A ripple of un-being. Hits all, 35% hex.',
  },
  oblivion: {
    id: 'oblivion', fx: 'shadow', name: 'Oblivion', class: 'warlock', cost: 30, charge: 6, target: 'all', tier: 3,
    power: 160, stat: 'int', hex: 0.5,
    desc: 'ULTIMATE: show them the space between stars. 50% hex.',
  },
  dawnbreak: {
    id: 'dawnbreak', fx: 'holy', name: 'Dawnbreak', class: 'warlock', cost: 20, charge: 4, target: 'one', tier: 2,
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
    id: 'rallying_chord', fx: 'buff', name: 'Rallying Chord', class: 'bard', cost: 10, charge: 1, target: 'self',
    buff: { stat: 'str', mult: 1.4, turns: 3 },
    desc: 'One chord, and the blood remembers courage. +40% damage, 3 turns.',
  },
  soothing_refrain: {
    id: 'soothing_refrain', fx: 'heal', name: 'Soothing Refrain', class: 'bard', cost: 12, charge: 1, target: 'self', allyTarget: true,
    healPct: 0.25,
    desc: 'A verse that closes wounds — yours or a companion\'s. Restore 25% HP.',
  },
  discord: {
    id: 'discord', fx: 'thunder', name: 'Discord', class: 'bard', cost: 9, charge: 1, target: 'one',
    power: 85, stat: 'lk', stun: 0.35,
    desc: 'A note the skull disagrees with. 35% stun.',
  },
  cacophony: {
    id: 'cacophony', fx: 'thunder', name: 'Cacophony', class: 'bard', cost: 15, charge: 3, target: 'all',
    power: 75, stat: 'lk',
    desc: 'All the wrong notes at once, weaponized.',
  },
  crescendo: {
    id: 'crescendo', fx: 'thunder', name: 'Crescendo', class: 'bard', cost: 14, charge: 3, target: 'one', tier: 2,
    power: 155, stat: 'lk', critBonus: 20,
    desc: 'Build, build, RELEASE. +20% crit.',
  },
  saga_of_steel: {
    id: 'saga_of_steel', fx: 'buff', name: 'Saga of Steel', class: 'bard', cost: 13, charge: 2, target: 'self', tier: 2,
    buff: { stat: 'str', mult: 1.5, turns: 3 }, buff2: { stat: 'dodge', add: 15, turns: 3 },
    desc: 'Sing the old war-songs until they become true. +50% damage, +15% dodge.',
  },
  inspire_greatness: {
    id: 'inspire_greatness', fx: 'heal', name: 'Inspire Greatness', class: 'bard', cost: 16, charge: 2, target: 'self', tier: 2, allyTarget: true,
    healPct: 0.35,
    desc: 'Remind someone who they are. Restore 35% HP — yours or a companion\'s.',
  },
  showstopper: {
    id: 'showstopper', fx: 'luck', name: 'Showstopper', class: 'bard', cost: 18, charge: 4, target: 'one', tier: 2,
    power: 175, stat: 'lk', critBonus: 30,
    desc: 'The finale they never saw coming. +30% crit.',
  },
  grand_finale: {
    id: 'grand_finale', fx: 'thunder', name: 'Grand Finale', class: 'bard', cost: 26, charge: 6, target: 'all', tier: 3,
    power: 140, stat: 'lk', critBonus: 15,
    desc: 'ULTIMATE: bring the house down. On their heads.',
  },
  last_ballad: {
    id: 'last_ballad', fx: 'shadow', name: 'The Last Ballad', class: 'bard', cost: 20, charge: 4, target: 'all', tier: 2,
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
    id: 'bone_spike', fx: 'pierce', name: 'Bone Spike', class: 'necromancer', cost: 9, charge: 1, target: 'one',
    power: 120, stat: 'int',
    desc: 'The floor of the tower is mostly climbers. Ask it for a favor.',
  },
  corpse_ward: {
    id: 'corpse_ward', fx: 'buff', name: 'Corpse Ward', class: 'necromancer', cost: 11, charge: 0, target: 'self',
    shield: 0.5,
    desc: 'The dead stand between you and harm. Block 50% for 3 turns.',
  },
  siphon_life: {
    id: 'siphon_life', fx: 'shadow', name: 'Siphon Life', class: 'necromancer', cost: 12, charge: 1, target: 'one',
    power: 90, stat: 'int', lifesteal: 0.5,
    desc: 'Borrow what they were going to waste anyway. Heals you (capped).',
  },
  grave_bloom: {
    id: 'grave_bloom', fx: 'poison', name: 'Grave Bloom', class: 'necromancer', cost: 16, charge: 3, target: 'all',
    power: 80, stat: 'int', poison: 0.4,
    desc: 'Everything buried here flowers at once. 40% poison.',
  },
  wither: {
    id: 'wither', fx: 'shadow', name: 'Wither', class: 'necromancer', cost: 16, charge: 3, target: 'one', tier: 2,
    power: 130, stat: 'int', execute: 0.25,
    desc: 'Hurry the inevitable. Slays non-boss foes below 25%.',
  },
  marrow_curse: {
    id: 'marrow_curse', fx: 'shadow', name: 'Marrow Curse', class: 'necromancer', cost: 12, charge: 2, target: 'one', tier: 2,
    power: 95, stat: 'int', hex: 0.8, poison: 0.4,
    desc: 'Rot from the inside out. 80% hex, 40% poison.',
  },
  plague_wind: {
    id: 'plague_wind', fx: 'poison', name: 'Plague Wind', class: 'necromancer', cost: 18, charge: 4, target: 'all', tier: 2,
    power: 90, stat: 'int', poison: 0.7,
    desc: 'A breeze from somewhere quarantined. 70% poison.',
  },
  raise_anguish: {
    id: 'raise_anguish', fx: 'shadow', name: 'Raise Anguish', class: 'necromancer', cost: 17, charge: 3, target: 'one', tier: 2,
    power: 165, stat: 'int',
    desc: 'Summon everything this floor regrets, briefly, on top of one enemy.',
  },
  black_rain: {
    id: 'black_rain', fx: 'shadow', name: 'Black Rain', class: 'necromancer', cost: 24, charge: 5, target: 'all', tier: 3,
    power: 125, stat: 'int', poison: 0.5,
    desc: 'The clouds here have been to funerals. 50% poison.',
  },
  final_word: {
    id: 'final_word', fx: 'shadow', name: 'The Final Word', class: 'necromancer', cost: 22, charge: 5, target: 'one', tier: 3,
    power: 240, stat: 'int', execute: 0.2,
    desc: 'Speak the sentence every living thing is born owing.',
  },
  mass_grave: {
    id: 'mass_grave', fx: 'shadow', name: 'Mass Grave', class: 'necromancer', cost: 30, charge: 6, target: 'all', tier: 3,
    power: 165, stat: 'int', hex: 0.4,
    desc: 'ULTIMATE: the tower opens beneath them, and it is full.',
  },
  phylactery_pulse: {
    id: 'phylactery_pulse', fx: 'shadow', name: 'Phylactery Pulse', class: 'necromancer', cost: 18, charge: 4, target: 'one', tier: 2,
    power: 170, stat: 'int', healPct: 0.1,
    desc: 'Beat the heart you keep elsewhere. Heavy damage, heals you 10%.',
  },

  /* ============ EXTRA CLASS TECHNIQUES (§10 — richer per-class offers) ============ */
  sunder: {
    id: 'sunder', fx: 'slash', name: 'Sunder', class: 'warrior', cost: 11, charge: 2, target: 'one', tier: 2,
    power: 150, stat: 'str', ignoreDef: true,
    desc: 'Split shield and bone alike — this blow ignores their defense.',
  },
  bulwark: {
    id: 'bulwark', fx: 'buff', name: 'Bulwark', class: 'warrior', cost: 10, charge: 1, target: 'self', tier: 2,
    shield: 0.5, buff: { stat: 'str', mult: 1.25, turns: 3 },
    desc: 'Plant your feet: block 50% for 3 turns and hit 25% harder while braced.',
  },
  scorch: {
    id: 'scorch', fx: 'fire', name: 'Scorch', class: 'mage', cost: 13, charge: 2, target: 'one', tier: 2,
    power: 135, stat: 'int', burn: 0.7,
    desc: 'A clinging gout of flame. Heavy damage, 70% chance to burn.',
  },
  time_slip: {
    id: 'time_slip', fx: 'arcane', name: 'Time Slip', class: 'mage', cost: 16, charge: 2, target: 'self', tier: 2,
    buff: { stat: 'dodge', add: 40, turns: 3 }, gainCharge: 1,
    desc: 'Step half a second out of the moment. +40% dodge for 3 turns, +1 charge.',
  },
  hunters_mark: {
    id: 'hunters_mark', fx: 'pierce', name: 'Hunter\'s Mark', class: 'archer', cost: 12, charge: 2, target: 'one', tier: 2,
    power: 120, stat: 'dex', hex: 0.9,
    desc: 'Mark the quarry — a marked foe takes +25% damage from everything. 90% chance.',
  },
  caltrops: {
    id: 'caltrops', fx: 'poison', name: 'Caltrops', class: 'rogue', cost: 13, charge: 3, target: 'all', tier: 2,
    power: 65, stat: 'dex', poison: 0.6,
    desc: 'Scatter iron thorns across the floor. Hits all enemies, 60% poison.',
  },
  benediction: {
    id: 'benediction', fx: 'heal', name: 'Benediction', class: 'priest', cost: 15, charge: 2, target: 'self', tier: 2, allyTarget: true,
    healPct: 0.3, buff: { stat: 'str', mult: 1.2, turns: 3 },
    desc: 'A blessing with teeth. Restore 30% HP — yours or a companion\'s — and steel their strikes.',
  },
  flowing_form: {
    id: 'flowing_form', fx: 'wind', name: 'Flowing Form', class: 'monk', cost: 12, charge: 2, target: 'self', tier: 2,
    buff: { stat: 'dodge', add: 35, turns: 3 }, healPct: 0.08,
    desc: 'Water has no shape to strike. +35% dodge for 3 turns, mend 8%.',
  },

  /* ============ EXCLUSIVE / DROP-ONLY TECHNIQUES (§10, §16) ============
     class 'special' → never appears in a class\'s learnable pool; only granted
     by specific encounters, relics, or events. Scales on your best stat so any
     class can wield the spoils of a strange kill. */
  vampire_bite: {
    id: 'vampire_bite', fx: 'shadow', name: 'Vampiric Bite', class: 'special', cost: 8, charge: 1, target: 'one',
    power: 130, stat: 'best', lifesteal: 0.6,
    desc: 'The gift of the thing you killed in the dark. Heavy damage, and you drink deep (healing capped).',
  },
  frost_nova: {
    id: 'frost_nova', fx: 'ice', name: 'Frost Nova', class: 'special', cost: 16, charge: 3, target: 'all',
    power: 90, stat: 'best', freeze: 0.45,
    desc: 'A ring of killing cold, torn from a wraith. Hits all enemies, 45% freeze.',
  },
  dragon_breath: {
    id: 'dragon_breath', fx: 'fire', name: 'Dragon\'s Breath', class: 'special', cost: 18, charge: 3, target: 'all',
    power: 110, stat: 'best', burn: 0.6,
    desc: 'Borrowed from something with scales. Devastates all enemies, 60% burn.',
  },
};

// Learnable pool: class skills gated by tier + your subclass lineage's skills.
export function skillsForClass(cls, tier = 1) {
  return Object.values(SKILLS).filter(s => s.class === cls && (s.tier || 1) <= tier);
}
