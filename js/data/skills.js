// Skill library. Damage scales off a primary stat; combat.js resolves effects.
// target: 'one' | 'all' | 'self'
// Effects are declarative so new skills need no engine changes.

export const SKILLS = {
  /* ---------------- Warrior ---------------- */
  slash: {
    id: 'slash', name: 'Slash', class: 'warrior', cost: 0, target: 'one',
    power: 100, stat: 'str',
    desc: 'A dependable strike. Free to use.',
  },
  shield_bash: {
    id: 'shield_bash', name: 'Shield Bash', class: 'warrior', cost: 8, target: 'one',
    power: 80, stat: 'str', stun: 0.45,
    desc: 'Slam your shield into the foe. 45% chance to stun.',
  },
  war_cry: {
    id: 'war_cry', name: 'War Cry', class: 'warrior', cost: 10, target: 'self',
    buff: { stat: 'str', mult: 1.5, turns: 3 },
    desc: 'Bellow with fury. +50% STR for 3 turns.',
  },
  cleave: {
    id: 'cleave', name: 'Cleave', class: 'warrior', cost: 14, target: 'all',
    power: 70, stat: 'str',
    desc: 'A sweeping blow that hits every enemy.',
  },
  iron_will: {
    id: 'iron_will', name: 'Iron Will', class: 'warrior', cost: 12, target: 'self', tier: 2,
    shield: 0.35, healPct: 0.12,
    desc: 'Steel yourself: heal 12% HP and block 35% of damage for 2 turns.',
  },
  holy_strike: {
    id: 'holy_strike', name: 'Holy Strike', class: 'warrior', cost: 18, target: 'one', tier: 2,
    power: 170, stat: 'str', sanityGain: 4,
    desc: 'Radiant judgment. Heavy damage and restores 4 Sanity.',
  },
  whirlwind: {
    id: 'whirlwind', name: 'Whirlwind', class: 'warrior', cost: 24, target: 'all', tier: 3,
    power: 120, stat: 'str',
    desc: 'Become the storm. Massive damage to all enemies.',
  },

  /* ---------------- Mage ---------------- */
  firebolt: {
    id: 'firebolt', name: 'Firebolt', class: 'mage', cost: 0, target: 'one',
    power: 95, stat: 'int', burn: 0.35,
    desc: 'A dart of flame. 35% chance to burn.',
  },
  frost_lance: {
    id: 'frost_lance', name: 'Frost Lance', class: 'mage', cost: 10, target: 'one',
    power: 110, stat: 'int', freeze: 0.35,
    desc: 'Impale with ice. 35% chance to freeze the target.',
  },
  arcane_ward: {
    id: 'arcane_ward', name: 'Arcane Ward', class: 'mage', cost: 12, target: 'self',
    shield: 0.5,
    desc: 'A shimmering barrier blocks 50% of damage for 2 turns.',
  },
  mana_storm: {
    id: 'mana_storm', name: 'Mana Storm', class: 'mage', cost: 18, target: 'all',
    power: 85, stat: 'int',
    desc: 'Unleash raw arcana on every enemy.',
  },
  soul_siphon: {
    id: 'soul_siphon', name: 'Soul Siphon', class: 'mage', cost: 14, target: 'one', tier: 2,
    power: 90, stat: 'int', lifesteal: 0.6,
    desc: 'Drain a foe’s essence, healing for 60% of damage dealt.',
  },
  chain_lightning: {
    id: 'chain_lightning', name: 'Chain Lightning', class: 'mage', cost: 20, target: 'all', tier: 2,
    power: 105, stat: 'int', stun: 0.2,
    desc: 'Lightning arcs between foes. 20% chance to stun each.',
  },
  meteor: {
    id: 'meteor', name: 'Meteor', class: 'mage', cost: 32, target: 'all', tier: 3,
    power: 175, stat: 'int', burn: 0.6,
    desc: 'Call the sky down. Devastates all enemies, 60% burn.',
  },

  /* ---------------- Archer ---------------- */
  quick_shot: {
    id: 'quick_shot', name: 'Quick Shot', class: 'archer', cost: 0, target: 'one',
    power: 90, stat: 'dex',
    desc: 'A swift arrow. Free to use.',
  },
  aimed_shot: {
    id: 'aimed_shot', name: 'Aimed Shot', class: 'archer', cost: 10, target: 'one',
    power: 130, stat: 'dex', critBonus: 30,
    desc: 'Take a breath, then loose. +30% crit chance.',
  },
  evasive_roll: {
    id: 'evasive_roll', name: 'Evasive Roll', class: 'archer', cost: 8, target: 'self',
    buff: { stat: 'dodge', add: 35, turns: 2 },
    desc: 'Tumble aside. +35% dodge for 2 turns.',
  },
  volley: {
    id: 'volley', name: 'Volley', class: 'archer', cost: 15, target: 'all',
    power: 75, stat: 'dex',
    desc: 'Rain arrows on every enemy.',
  },
  pinning_shot: {
    id: 'pinning_shot', name: 'Pinning Shot', class: 'archer', cost: 12, target: 'one', tier: 2,
    power: 100, stat: 'dex', stun: 0.5,
    desc: 'Nail a foe in place. 50% chance to stun.',
  },
  piercing_arrow: {
    id: 'piercing_arrow', name: 'Piercing Arrow', class: 'archer', cost: 16, target: 'one', tier: 2,
    power: 180, stat: 'dex', ignoreDef: true,
    desc: 'Punches clean through armor — ignores defense.',
  },
  arrow_tempest: {
    id: 'arrow_tempest', name: 'Arrow Tempest', class: 'archer', cost: 26, target: 'all', tier: 3,
    power: 130, stat: 'dex', critBonus: 15,
    desc: 'The sky darkens. Massive damage to all, +15% crit.',
  },

  /* ---------------- Rogue ---------------- */
  backstab: {
    id: 'backstab', name: 'Backstab', class: 'rogue', cost: 0, target: 'one',
    power: 85, stat: 'dex', critBonus: 15,
    desc: 'Strike from shadow. +15% crit chance. Free.',
  },
  poison_blade: {
    id: 'poison_blade', name: 'Poison Blade', class: 'rogue', cost: 9, target: 'one',
    power: 70, stat: 'dex', poison: 0.85,
    desc: 'A coated dagger. 85% chance to poison.',
  },
  smoke_bomb: {
    id: 'smoke_bomb', name: 'Smoke Bomb', class: 'rogue', cost: 10, target: 'self',
    buff: { stat: 'dodge', add: 45, turns: 2 },
    desc: 'Vanish in smoke. +45% dodge for 2 turns.',
  },
  fan_of_knives: {
    id: 'fan_of_knives', name: 'Fan of Knives', class: 'rogue', cost: 14, target: 'all',
    power: 65, stat: 'dex', poison: 0.35,
    desc: 'Blades in every direction. 35% chance to poison each foe.',
  },
  shadow_dance: {
    id: 'shadow_dance', name: 'Shadow Dance', class: 'rogue', cost: 13, target: 'self', tier: 2,
    buff: { stat: 'str', mult: 1.4, turns: 3 }, buff2: { stat: 'dodge', add: 20, turns: 3 },
    desc: 'Move like darkness. +40% damage and +20% dodge for 3 turns.',
  },
  assassinate: {
    id: 'assassinate', name: 'Assassinate', class: 'rogue', cost: 20, target: 'one', tier: 2,
    power: 120, stat: 'dex', execute: 0.3,
    desc: 'Go for the throat. Instantly slays non-boss foes below 30% HP.',
  },
  thousand_cuts: {
    id: 'thousand_cuts', name: 'Thousand Cuts', class: 'rogue', cost: 25, target: 'all', tier: 3,
    power: 115, stat: 'dex', poison: 0.7,
    desc: 'A blur of steel. Massive damage, 70% poison chance.',
  },
};

export function skillsForClass(cls, tier = 1) {
  return Object.values(SKILLS).filter(s => s.class === cls && (s.tier || 1) <= tier);
}
