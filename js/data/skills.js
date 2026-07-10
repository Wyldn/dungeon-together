// Skill library. Every ability may cost class resource (cost) AND Battle
// Charge (charge) — handoff §11/§13. AOE and heavy hits are charge-gated so
// enemies get a chance to act. All effects stay declarative.
//
// target: 'one' | 'all' | 'self'
// tier: 1 = starting kit, 2 = level 6+, 3 = level 13+ offers

export const SKILLS = {
  /* ============ UNIVERSAL (every character, any weapon) ============ */
  basic_attack: {
    id: 'basic_attack', name: 'Strike', class: 'universal', cost: 0, charge: 0, target: 'one',
    power: 80, stat: 'best',
    desc: 'A plain, honest hit. Works with anything — even bare hands.',
  },
  guard: {
    id: 'guard', name: 'Guard', class: 'universal', cost: 0, charge: 0, target: 'self',
    guard: true,
    desc: 'Brace for impact: block 70% of damage until your next turn. Builds +1 charge.',
  },

  /* ============ WARRIOR (Vigor) ============ */
  slash: {
    id: 'slash', name: 'Slash', class: 'warrior', cost: 0, charge: 0, target: 'one',
    power: 100, stat: 'str',
    desc: 'A dependable strike. Free to use.',
  },
  shield_bash: {
    id: 'shield_bash', name: 'Shield Bash', class: 'warrior', cost: 8, charge: 1, target: 'one',
    power: 80, stat: 'str', stun: 0.45,
    desc: 'Slam your shield into the foe. 45% chance to stun.',
  },
  war_cry: {
    id: 'war_cry', name: 'War Cry', class: 'warrior', cost: 10, charge: 1, target: 'self',
    buff: { stat: 'str', mult: 1.5, turns: 3 },
    desc: 'Bellow with fury. +50% damage for 3 turns.',
  },
  cleave: {
    id: 'cleave', name: 'Cleave', class: 'warrior', cost: 14, charge: 3, target: 'all',
    power: 70, stat: 'str',
    desc: 'A sweeping blow that hits every enemy.',
  },
  iron_will: {
    id: 'iron_will', name: 'Iron Will', class: 'warrior', cost: 12, charge: 1, target: 'self', tier: 2,
    shield: 0.35, healPct: 0.12,
    desc: 'Steel yourself: heal 12% HP and block 35% of damage for 2 turns.',
  },
  rampage: {
    id: 'rampage', name: 'Rampage', class: 'warrior', cost: 14, charge: 3, target: 'one', tier: 2,
    power: 165, stat: 'str', selfHpCost: 0.06,
    desc: 'Trade blood for violence: heavy damage, costs 6% of your max HP.',
  },
  holy_strike: {
    id: 'holy_strike', name: 'Holy Strike', class: 'warrior', cost: 18, charge: 3, target: 'one', tier: 2,
    power: 170, stat: 'str', healPct: 0.06,
    desc: 'Radiant judgment. Heavy damage; the light mends you slightly.',
  },
  reapers_toll: {
    id: 'reapers_toll', name: 'Reaper\'s Toll', class: 'warrior', cost: 16, charge: 4, target: 'one', tier: 2,
    power: 150, stat: 'str', execute: 0.25,
    desc: 'Collect what is owed. Slays non-boss foes below 25% HP outright.',
  },
  whirlwind: {
    id: 'whirlwind', name: 'Whirlwind', class: 'warrior', cost: 24, charge: 6, target: 'all', tier: 3,
    power: 130, stat: 'str',
    desc: 'ULTIMATE — become the storm. Massive damage to all enemies.',
  },

  /* ============ MAGE (Mana) ============ */
  firebolt: {
    id: 'firebolt', name: 'Firebolt', class: 'mage', cost: 0, charge: 0, target: 'one',
    power: 95, stat: 'int', burn: 0.35,
    desc: 'A dart of flame. 35% chance to burn.',
  },
  frost_lance: {
    id: 'frost_lance', name: 'Frost Lance', class: 'mage', cost: 10, charge: 1, target: 'one',
    power: 110, stat: 'int', freeze: 0.35,
    desc: 'Impale with ice. 35% chance to freeze the target.',
  },
  arcane_ward: {
    id: 'arcane_ward', name: 'Arcane Ward', class: 'mage', cost: 12, charge: 0, target: 'self',
    shield: 0.5,
    desc: 'A shimmering barrier blocks 50% of damage for 2 turns.',
  },
  mana_storm: {
    id: 'mana_storm', name: 'Mana Storm', class: 'mage', cost: 18, charge: 3, target: 'all',
    power: 85, stat: 'int',
    desc: 'Unleash raw arcana on every enemy.',
  },
  soul_siphon: {
    id: 'soul_siphon', name: 'Soul Siphon', class: 'mage', cost: 14, charge: 2, target: 'one', tier: 2,
    power: 90, stat: 'int', lifesteal: 0.6,
    desc: 'Drain a foe\'s essence, healing for 60% of damage dealt.',
  },
  chain_lightning: {
    id: 'chain_lightning', name: 'Chain Lightning', class: 'mage', cost: 20, charge: 4, target: 'all', tier: 2,
    power: 105, stat: 'int', stun: 0.2,
    desc: 'Lightning arcs between foes. 20% chance to stun each.',
  },
  rune_slash: {
    id: 'rune_slash', name: 'Rune Slash', class: 'mage', cost: 12, charge: 2, target: 'one', tier: 2,
    power: 140, stat: 'int', ignoreDef: true,
    desc: 'A blade-arc of pure script — armor means nothing to grammar.',
  },
  blade_storm: {
    id: 'blade_storm', name: 'Blade Storm', class: 'mage', cost: 22, charge: 5, target: 'all', tier: 3,
    power: 120, stat: 'int',
    desc: 'Every spell your sword remembers, all at once, everywhere.',
  },
  unmake: {
    id: 'unmake', name: 'Unmake', class: 'mage', cost: 20, charge: 4, target: 'one', tier: 2,
    power: 180, stat: 'int', ignoreDef: true,
    desc: 'Politely inform the target it was never really there. Ignores defense.',
  },
  meteor: {
    id: 'meteor', name: 'Meteor', class: 'mage', cost: 32, charge: 6, target: 'all', tier: 3,
    power: 175, stat: 'int', burn: 0.6,
    desc: 'ULTIMATE — call the sky down. Devastates all enemies, 60% burn.',
  },

  /* ============ ARCHER (Focus) ============ */
  quick_shot: {
    id: 'quick_shot', name: 'Quick Shot', class: 'archer', cost: 0, charge: 0, target: 'one',
    power: 90, stat: 'dex',
    desc: 'A swift arrow. Free to use.',
  },
  aimed_shot: {
    id: 'aimed_shot', name: 'Aimed Shot', class: 'archer', cost: 10, charge: 1, target: 'one',
    power: 130, stat: 'dex', critBonus: 30,
    desc: 'Take a breath, then loose. +30% crit chance.',
  },
  evasive_roll: {
    id: 'evasive_roll', name: 'Evasive Roll', class: 'archer', cost: 8, charge: 0, target: 'self',
    buff: { stat: 'dodge', add: 35, turns: 2 },
    desc: 'Tumble aside. +35% dodge for 2 turns.',
  },
  volley: {
    id: 'volley', name: 'Volley', class: 'archer', cost: 15, charge: 3, target: 'all',
    power: 75, stat: 'dex',
    desc: 'Rain arrows on every enemy.',
  },
  serpent_arrow: {
    id: 'serpent_arrow', name: 'Serpent Arrow', class: 'archer', cost: 12, charge: 2, target: 'one', tier: 2,
    power: 105, stat: 'dex', poison: 0.9,
    desc: 'An arrow that bites twice. 90% chance to poison.',
  },
  pinning_shot: {
    id: 'pinning_shot', name: 'Pinning Shot', class: 'archer', cost: 12, charge: 2, target: 'one', tier: 2,
    power: 100, stat: 'dex', stun: 0.5,
    desc: 'Nail a foe in place. 50% chance to stun.',
  },
  piercing_arrow: {
    id: 'piercing_arrow', name: 'Piercing Arrow', class: 'archer', cost: 16, charge: 3, target: 'one', tier: 2,
    power: 180, stat: 'dex', ignoreDef: true,
    desc: 'Punches clean through armor — ignores defense.',
  },
  lightning_arrow: {
    id: 'lightning_arrow', name: 'Lightning Arrow', class: 'archer', cost: 15, charge: 3, target: 'one', tier: 2,
    power: 155, stat: 'dex', stun: 0.35, critBonus: 15,
    desc: 'The storm rides your arrow down. 35% stun, +15% crit.',
  },
  one_shot: {
    id: 'one_shot', name: 'One Shot', class: 'archer', cost: 20, charge: 5, target: 'one', tier: 3,
    power: 260, stat: 'dex', critBonus: 25,
    desc: 'One arrow. One ending. +25% crit.',
  },
  arrow_tempest: {
    id: 'arrow_tempest', name: 'Arrow Tempest', class: 'archer', cost: 26, charge: 6, target: 'all', tier: 3,
    power: 130, stat: 'dex', critBonus: 15,
    desc: 'ULTIMATE — the sky darkens. Massive damage to all, +15% crit.',
  },

  /* ============ ROGUE (Energy) ============ */
  backstab: {
    id: 'backstab', name: 'Backstab', class: 'rogue', cost: 0, charge: 0, target: 'one',
    power: 85, stat: 'dex', critBonus: 15,
    desc: 'Strike from shadow. +15% crit chance. Free.',
  },
  poison_blade: {
    id: 'poison_blade', name: 'Poison Blade', class: 'rogue', cost: 9, charge: 1, target: 'one',
    power: 70, stat: 'dex', poison: 0.85,
    desc: 'A coated dagger. 85% chance to poison.',
  },
  smoke_bomb: {
    id: 'smoke_bomb', name: 'Smoke Bomb', class: 'rogue', cost: 10, charge: 0, target: 'self',
    buff: { stat: 'dodge', add: 45, turns: 2 },
    desc: 'Vanish in smoke. +45% dodge for 2 turns.',
  },
  fan_of_knives: {
    id: 'fan_of_knives', name: 'Fan of Knives', class: 'rogue', cost: 14, charge: 3, target: 'all',
    power: 65, stat: 'dex', poison: 0.35,
    desc: 'Blades in every direction. 35% chance to poison each foe.',
  },
  shadow_dance: {
    id: 'shadow_dance', name: 'Shadow Dance', class: 'rogue', cost: 13, charge: 1, target: 'self', tier: 2,
    buff: { stat: 'str', mult: 1.4, turns: 3 }, buff2: { stat: 'dodge', add: 20, turns: 3 },
    desc: 'Move like darkness. +40% damage and +20% dodge for 3 turns.',
  },
  assassinate: {
    id: 'assassinate', name: 'Assassinate', class: 'rogue', cost: 20, charge: 4, target: 'one', tier: 2,
    power: 120, stat: 'dex', execute: 0.3,
    desc: 'Go for the throat. Instantly slays non-boss foes below 30% HP.',
  },
  loaded_dice: {
    id: 'loaded_dice', name: 'Loaded Dice', class: 'rogue', cost: 10, charge: 2, target: 'one', tier: 2,
    power: 100, stat: 'lk', critBonus: 40,
    desc: 'Luck does the stabbing. Scales on Luck, +40% crit.',
  },
  ghost_step: {
    id: 'ghost_step', name: 'Ghost Step', class: 'rogue', cost: 14, charge: 2, target: 'self', tier: 2,
    buff: { stat: 'dodge', add: 60, turns: 1 }, buff2: { stat: 'str', mult: 1.3, turns: 2 },
    desc: 'Briefly stop existing. +60% dodge this round, +30% damage after.',
  },
  twist_of_fate: {
    id: 'twist_of_fate', name: 'Twist of Fate', class: 'rogue', cost: 18, charge: 5, target: 'all', tier: 3,
    power: 105, stat: 'lk', critBonus: 30,
    desc: 'Reshuffle everyone\'s luck but yours. Luck-scaling AOE, +30% crit.',
  },
  thousand_cuts: {
    id: 'thousand_cuts', name: 'Thousand Cuts', class: 'rogue', cost: 25, charge: 6, target: 'all', tier: 3,
    power: 125, stat: 'dex', poison: 0.7,
    desc: 'ULTIMATE — a blur of steel. Massive damage, 70% poison chance.',
  },

  /* ============ PRIEST (Faith) ============ */
  smite: {
    id: 'smite', name: 'Smite', class: 'priest', cost: 0, charge: 0, target: 'one',
    power: 90, stat: 'wis',
    desc: 'The light\'s opinion, delivered. Free to use.',
  },
  mend: {
    id: 'mend', name: 'Mend', class: 'priest', cost: 12, charge: 1, target: 'self',
    healPct: 0.3,
    desc: 'Close wounds with a murmured word. Restore 30% HP.',
  },
  radiant_ward: {
    id: 'radiant_ward', name: 'Radiant Ward', class: 'priest', cost: 10, charge: 0, target: 'self',
    shield: 0.5,
    desc: 'A halo of light blocks 50% of damage for 2 turns.',
  },
  judgement: {
    id: 'judgement', name: 'Judgement', class: 'priest', cost: 18, charge: 3, target: 'all',
    power: 80, stat: 'wis',
    desc: 'The verdict arrives for every enemy at once.',
  },
  censure: {
    id: 'censure', name: 'Censure', class: 'priest', cost: 12, charge: 2, target: 'one', tier: 2,
    power: 110, stat: 'wis', stun: 0.5,
    desc: 'Formally object to the target\'s existence. 50% stun.',
  },
  sanctuary: {
    id: 'sanctuary', name: 'Sanctuary', class: 'priest', cost: 16, charge: 2, target: 'self', tier: 2,
    shield: 0.6, healPct: 0.18,
    desc: 'Declare holy ground. Heal 18% HP and block 60% for 2 turns.',
  },
  profane_mercy: {
    id: 'profane_mercy', name: 'Profane Mercy', class: 'priest', cost: 15, charge: 3, target: 'one', tier: 2,
    power: 150, stat: 'wis', lifesteal: 0.5,
    desc: 'Forgiveness, weaponized. Heavy damage, heal for half.',
  },
  final_verdict: {
    id: 'final_verdict', name: 'Final Verdict', class: 'priest', cost: 22, charge: 5, target: 'one', tier: 3,
    power: 230, stat: 'wis', execute: 0.2,
    desc: 'Gavel down. Massive damage; slays non-boss foes below 20%.',
  },
  last_rites: {
    id: 'last_rites', name: 'Last Rites', class: 'priest', cost: 28, charge: 6, target: 'all', tier: 3,
    power: 140, stat: 'wis', healPct: 0.15,
    desc: 'ULTIMATE — say the words for everyone at once. Devastates enemies, mends you.',
  },

  /* ============ MONK (Ki) ============ */
  palm_strike: {
    id: 'palm_strike', name: 'Palm Strike', class: 'monk', cost: 0, charge: 0, target: 'one',
    power: 95, stat: 'dex',
    desc: 'An open hand, an honest argument. Free to use.',
  },
  flurry: {
    id: 'flurry', name: 'Flurry', class: 'monk', cost: 10, charge: 1, target: 'one',
    power: 125, stat: 'dex', critBonus: 10,
    desc: 'Three strikes that arrive as one. +10% crit.',
  },
  iron_stance: {
    id: 'iron_stance', name: 'Iron Stance', class: 'monk', cost: 10, charge: 0, target: 'self',
    shield: 0.45, healPct: 0.08,
    desc: 'Root like a mountain: heal 8% and block 45% for 2 turns.',
  },
  hurricane_kick: {
    id: 'hurricane_kick', name: 'Hurricane Kick', class: 'monk', cost: 16, charge: 3, target: 'all',
    power: 78, stat: 'dex',
    desc: 'One rotation, every jaw. Hits all enemies.',
  },
  pressure_point: {
    id: 'pressure_point', name: 'Pressure Point', class: 'monk', cost: 12, charge: 2, target: 'one', tier: 2,
    power: 130, stat: 'dex', ignoreDef: true,
    desc: 'Anatomy is a map. Ignores defense.',
  },
  immovable: {
    id: 'immovable', name: 'Immovable', class: 'monk', cost: 14, charge: 2, target: 'self', tier: 2,
    shield: 0.65, healPct: 0.12,
    desc: 'Become terrain. Heal 12% and block 65% for 2 turns.',
  },
  gale_palm: {
    id: 'gale_palm', name: 'Gale Palm', class: 'monk', cost: 13, charge: 2, target: 'one', tier: 2,
    power: 145, stat: 'dex', stun: 0.3,
    desc: 'Strike with borrowed wind. 30% stun.',
  },
  earthbreaker: {
    id: 'earthbreaker', name: 'Earthbreaker', class: 'monk', cost: 20, charge: 5, target: 'all', tier: 3,
    power: 115, stat: 'str', stun: 0.25,
    desc: 'Ask the ground to object. AOE with 25% stun.',
  },
  phoenix_palm: {
    id: 'phoenix_palm', name: 'Phoenix Palm', class: 'monk', cost: 18, charge: 4, target: 'one', tier: 2,
    power: 175, stat: 'dex', healPct: 0.1, burn: 0.5,
    desc: 'Strike with everything you refused to burn. Heals you 10%, 50% burn.',
  },
  hundred_fists: {
    id: 'hundred_fists', name: 'Hundred Fists', class: 'monk', cost: 26, charge: 6, target: 'all', tier: 3,
    power: 135, stat: 'dex',
    desc: 'ULTIMATE — the count is approximate. The devastation is not.',
  },
};

// Learnable pool: class skills gated by tier + your subclass lineage's skills.
export function skillsForClass(cls, tier = 1) {
  return Object.values(SKILLS).filter(s => s.class === cls && (s.tier || 1) <= tier);
}
