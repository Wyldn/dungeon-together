// Bestiary. Base stats are for the biome's first floor; the engine scales
// them by floor depth. glyphs keep the low-poly/2D readable-silhouette vibe.

export const BIOMES = [
  {
    id: 'forest', name: 'Whispering Forest', floors: [1, 10], glow: '#3f7d4a',
    flavor: 'Sunlight dies somewhere above the canopy. The trees remember when this was a kingdom.',
    particle: 'leaves',
  },
  {
    id: 'ruins', name: 'Sunken Ruins', floors: [11, 20], glow: '#8a7d4f',
    flavor: 'A civilization sleeps beneath the dust. Some of it snores. Some of it watches.',
    particle: 'dust',
  },
  {
    id: 'frost', name: 'Frozen Citadel', floors: [21, 30], glow: '#5a9ec9',
    flavor: 'The Frost Queen’s court froze mid-betrayal. The cold keeps grudges fresh.',
    particle: 'snow',
  },
  {
    id: 'swamp', name: 'Weeping Mire', floors: [31, 40], glow: '#5f8a3f',
    flavor: 'The water is patient. Everything sinks eventually — hope included.',
    particle: 'spores',
  },
  {
    id: 'hell', name: 'The Scorch', floors: [41, 50], glow: '#c9503a',
    flavor: 'The final ascent. The air itself has chosen a side, and it isn’t yours.',
    particle: 'embers',
  },
  {
    id: 'throne', name: 'Throne of the Demon King', floors: [51, 51], glow: '#8a2f6e',
    flavor: 'He has been waiting. He is always waiting. That is the curse of kings.',
    particle: 'embers',
  },
];

export function biomeForFloor(floor) {
  return BIOMES.find(b => floor >= b.floors[0] && floor <= b.floors[1]) || BIOMES[BIOMES.length - 1];
}

// hp/atk/def/spd are pre-scale. traits: aggressive|caster|sturdy|swift
export const ENEMIES = {
  forest: [
    { id: 'wolf', name: 'Dire Wolf', glyph: '🐺', hp: 26, atk: 7, def: 1, spd: 9, gold: [6, 14], xp: 10, pack: true },
    { id: 'sprite', name: 'Feral Sprite', glyph: '🧚', hp: 18, atk: 6, def: 0, spd: 12, gold: [8, 16], xp: 9, caster: true },
    { id: 'boar', name: 'Ironback Boar', glyph: '🐗', hp: 38, atk: 8, def: 3, spd: 5, gold: [7, 15], xp: 12 },
    { id: 'bandit', name: 'Forest Bandit', glyph: '🗡️', hp: 30, atk: 8, def: 2, spd: 8, gold: [14, 28], xp: 12, pack: true },
    { id: 'treant', name: 'Young Treant', glyph: '🌳', hp: 52, atk: 9, def: 5, spd: 3, gold: [10, 20], xp: 16, elite: true },
    { id: 'spider', name: 'Widow Spider', glyph: '🕷️', hp: 24, atk: 7, def: 1, spd: 10, gold: [6, 13], xp: 10, poison: 0.4 },
  ],
  ruins: [
    { id: 'skeleton', name: 'Restless Skeleton', glyph: '💀', hp: 34, atk: 10, def: 3, spd: 7, gold: [12, 22], xp: 14, pack: true },
    { id: 'cursed_knight', name: 'Cursed Knight', glyph: '⚔️', hp: 56, atk: 12, def: 6, spd: 5, gold: [18, 32], xp: 20, elite: true },
    { id: 'shade', name: 'Weeping Shade', glyph: '👻', hp: 30, atk: 11, def: 1, spd: 11, gold: [10, 20], xp: 15, sanityHit: 3 },
    { id: 'scarab', name: 'Tomb Scarab Swarm', glyph: '🪲', hp: 28, atk: 9, def: 2, spd: 9, gold: [8, 18], xp: 12, pack: true },
    { id: 'golem', name: 'Broken Golem', glyph: '🗿', hp: 70, atk: 11, def: 8, spd: 2, gold: [20, 36], xp: 22, elite: true },
    { id: 'acolyte', name: 'Hollow Acolyte', glyph: '🕯️', hp: 32, atk: 12, def: 2, spd: 8, gold: [14, 26], xp: 16, caster: true },
  ],
  frost: [
    { id: 'wraith', name: 'Ice Wraith', glyph: '❄️', hp: 44, atk: 14, def: 4, spd: 10, gold: [16, 30], xp: 20, freeze: 0.3 },
    { id: 'frost_giant', name: 'Frost Giant', glyph: '🧊', hp: 88, atk: 16, def: 8, spd: 3, gold: [26, 44], xp: 30, elite: true },
    { id: 'winter_wolf', name: 'Winter Wolf', glyph: '🐺', hp: 50, atk: 15, def: 4, spd: 11, gold: [18, 30], xp: 22, pack: true },
    { id: 'ice_maiden', name: 'Court Ice-Maiden', glyph: '👑', hp: 46, atk: 16, def: 4, spd: 9, gold: [22, 38], xp: 24, caster: true, freeze: 0.35 },
    { id: 'frozen_soldier', name: 'Frozen Soldier', glyph: '🛡️', hp: 60, atk: 14, def: 9, spd: 4, gold: [18, 32], xp: 22, pack: true },
  ],
  swamp: [
    { id: 'hag', name: 'Mire Hag', glyph: '🧙', hp: 58, atk: 19, def: 5, spd: 8, gold: [24, 42], xp: 30, caster: true, sanityHit: 4 },
    { id: 'croc', name: 'Bog Render', glyph: '🐊', hp: 80, atk: 21, def: 7, spd: 6, gold: [22, 40], xp: 32 },
    { id: 'leech', name: 'Giant Leech', glyph: '🪱', hp: 52, atk: 17, def: 3, spd: 7, gold: [16, 30], xp: 24, lifesteal: 0.5, pack: true },
    { id: 'will_o_wisp', name: 'Will-o’-Wisp', glyph: '🔥', hp: 40, atk: 18, def: 2, spd: 13, gold: [20, 36], xp: 26, caster: true },
    { id: 'troll', name: 'Moss Troll', glyph: '👹', hp: 110, atk: 20, def: 9, spd: 3, gold: [30, 52], xp: 38, elite: true, regen: 0.06 },
  ],
  hell: [
    { id: 'imp', name: 'Cinder Imp', glyph: '👺', hp: 60, atk: 23, def: 5, spd: 12, gold: [26, 46], xp: 34, pack: true, burn: 0.3 },
    { id: 'hellhound', name: 'Hellhound', glyph: '🐕‍🦺', hp: 76, atk: 26, def: 6, spd: 11, gold: [28, 48], xp: 38, pack: true, burn: 0.35 },
    { id: 'tormentor', name: 'Chain Tormentor', glyph: '⛓️', hp: 96, atk: 27, def: 9, spd: 6, gold: [34, 56], xp: 44, elite: true, sanityHit: 5 },
    { id: 'pit_mage', name: 'Pit Magus', glyph: '🔮', hp: 70, atk: 29, def: 5, spd: 9, gold: [32, 54], xp: 42, caster: true, burn: 0.4 },
    { id: 'brute', name: 'Obsidian Brute', glyph: '🌋', hp: 130, atk: 28, def: 12, spd: 4, gold: [38, 64], xp: 50, elite: true },
  ],
};

// One boss guards the gate out of each biome (design doc: boss every 10 floors).
export const BOSSES = {
  10: {
    id: 'elderwood', name: 'The Elderwood Guardian', glyph: '🌲', biome: 'forest',
    hp: 140, atk: 12, def: 6, spd: 5, gold: [60, 90], xp: 60, regen: 0.04,
    intro: 'The oldest tree in the forest uproots itself. It has judged ten thousand climbers.\nIt has approved of none.',
    taunt: 'YOU BURN LIKE ALL THE REST.',
  },
  20: {
    id: 'lich', name: 'Lich of the Fallen King', glyph: '👑', biome: 'ruins',
    hp: 200, atk: 17, def: 7, spd: 8, gold: [90, 130], xp: 90, caster: true, sanityHit: 4, summons: 'skeleton',
    intro: 'A crown floats above a throne of dust. Beneath it, two cold lights ignite.\n“Kneel. My kingdom needs subjects.”',
    taunt: 'DEATH IS A DOOR. I AM THE KEY.',
  },
  30: {
    id: 'frost_queen', name: 'Queen Vessalia the Unmelting', glyph: '❄️', biome: 'frost',
    hp: 280, atk: 22, def: 10, spd: 9, gold: [120, 170], xp: 130, freeze: 0.4,
    intro: 'The Frost Queen does not rise from her throne. She merely opens her eyes,\nand the temperature of your blood becomes negotiable.',
    taunt: 'WINTER OUTLASTS EVERYTHING. EVEN HOPE.',
  },
  40: {
    id: 'hydra', name: 'The Grieving Hydra', glyph: '🐉', biome: 'swamp',
    hp: 380, atk: 27, def: 10, spd: 6, gold: [160, 220], xp: 180, regen: 0.08, heads: true,
    intro: 'Three heads surface from the black water. One weeps. One laughs.\nThe third simply opens its jaws.',
    taunt: 'CUT ONE SORROW DOWN. TWO MORE RISE.',
  },
  50: {
    id: 'infernal_duke', name: 'Duke Malgrimm, Gatekeeper of the Throne', glyph: '😈', biome: 'hell',
    hp: 480, atk: 33, def: 13, spd: 10, gold: [220, 300], xp: 250, burn: 0.45,
    intro: '“Fifty floors,” the Duke muses, drawing a sword made of other swords.\n“Impressive. The King will want to kill you personally. Let’s disappoint him.”',
    taunt: 'THE THRONE IS A PRIVILEGE. DYING HERE IS FREE.',
  },
  51: {
    id: 'demon_king', name: 'VORATH, THE DEMON KING', glyph: '🜏', biome: 'throne',
    hp: 650, atk: 38, def: 15, spd: 12, gold: [0, 0], xp: 0, phases: true, sanityHit: 6,
    intro: 'The Demon King sets down a book, marks his page, and stands.\n“Every century, one of you reaches this room. Every century I ask the same question.”\nHis blade ignites the air itself.\n“Are you the interesting kind?”',
    taunt: 'I HAVE KILLED HEROES WITH BETTER STATS THAN YOURS.',
  },
};

// Modifier floors (every 5th non-boss floor): battle objectives (design doc).
export const MODIFIERS = [
  { id: 'ambush', name: 'Ambush!', desc: 'Enemies strike first this battle.', enemyFirst: true },
  { id: 'cursed_ground', name: 'Cursed Ground', desc: 'Lose 2 Sanity at the end of each turn.', sanityDrain: 2 },
  { id: 'blood_moon', name: 'Blood Moon', desc: 'Everyone deals +40% damage. Everyone.', dmgMult: 1.4 },
  { id: 'mana_void', name: 'Mana Void', desc: 'Skills cost +50% mana this battle.', costMult: 1.5 },
  { id: 'gilded', name: 'Gilded Foes', desc: 'Enemies are tougher but drop triple gold.', hpMult: 1.35, goldMult: 3 },
  { id: 'horde', name: 'The Horde', desc: 'An extra enemy joins the fray.', extraEnemy: true },
];
