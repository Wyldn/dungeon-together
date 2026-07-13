// Starting races (handoff §22). Descriptions suggest affinities without
// forcing a build. Promotions are rare, run-specific transformations.

export const RACES = {
  human: {
    id: 'human',
    name: 'Human',
    glyph: '🧑',
    blurb: 'Adaptable and ambitious. Humans are welcome in most halls, and the tower seems to enjoy watching them gamble.',
    hint: 'Affinity: anything. Fame comes easier to a human face.',
    // stat adds applied at creation
    stats: {},
    hp: 0, mp: 0,
    fameGainMult: 1.25,
    extraReroll: 1,        // adaptable: one extra creation reroll
    initiative: 0,
    promotion: {
      to: 'Awakened Human', glyph: '✨',
      blurb: 'Something dormant in the bloodline answers the tower\'s pressure.',
      bonus: { statsAll: 2, hp: 15 },
    },
  },
  elf: {
    id: 'elf',
    name: 'Elf',
    glyph: '🧝',
    blurb: 'Long-lived, light-footed, and faintly luminous in moonlight. Elves hear the tower breathing and find it rude.',
    hint: 'Affinity: precision and magic. Quick to act, slow to bleed out gracefully.',
    stats: { dex: 2, int: 1 },
    hp: -5, mp: 6,
    initiative: 2,
    promotion: {
      to: 'High Elf', glyph: '🌙',
      blurb: 'The old light of the first forests takes residence behind your eyes.',
      bonus: { dex: 3, int: 3, mp: 20 },
    },
  },
  orc: {
    id: 'orc',
    name: 'Orc',
    glyph: '🐗',
    blurb: 'Built like a door and twice as hard to argue with. Orc blood runs hot enough to keep the frost floors interesting.',
    hint: 'Affinity: the front line. Hits harder, charges faster when wounded.',
    stats: { str: 3, int: -1 },
    hp: 10, mp: -4,
    chargeOnHit: true,     // gain 1 Battle Charge when taking damage
    initiative: -1,
    promotion: {
      to: 'High Orc', glyph: '🔥',
      blurb: 'The war-spirits of your ancestors stop whispering and start cheering.',
      bonus: { str: 4, hp: 30 },
    },
  },
  dwarf: {
    id: 'dwarf',
    name: 'Dwarf',
    glyph: '🧔',
    blurb: 'Stone-patient and ale-powered. Dwarves read the tower\'s masonry like a diary and disapprove of the grammar.',
    hint: 'Affinity: endurance and craft. Poison rolls off; gold rolls in.',
    stats: { str: 1, wis: 1 },
    hp: 8, mp: 0,
    def: 1,
    goldMult: 1.15,
    poisonResist: 0.5,     // halves poison-chance rolls against you
    initiative: -2,
    promotion: {
      to: 'Runeforged Dwarf', glyph: '⚒️',
      blurb: 'Old runes surface on your skin like the mountain remembering your name.',
      bonus: { str: 2, wis: 3, hp: 20, def: 2 },
    },
  },
  halfling: {
    id: 'halfling',
    name: 'Halfling',
    glyph: '🍀',
    blurb: 'Small enough to duck under trouble and lucky enough that trouble often ducks first. Halflings treat the tower like a very tall pub crawl.',
    hint: 'Affinity: scoundrels, storytellers, and sharpshooters. Fortune favors the light-footed.',
    stats: { lk: 2, dex: 1 },
    hp: -4, mp: 0,
    initiative: 2,
    fameGainMult: 1.1,
    promotion: {
      to: 'Fate-Touched Halfling', glyph: '🎲',
      blurb: 'The tower\'s dice finally land on your name. Coincidence stops being coincidental.',
      bonus: { lk: 4, dex: 2, hp: 12 },
    },
  },
  tiefling: {
    id: 'tiefling',
    name: 'Tiefling',
    glyph: '😈',
    blurb: 'Infernal ink in the family tree. Horns catch lamplight; contracts catch everything else. The tower smells like home to them — which is concerning.',
    hint: 'Affinity: pact-makers, scholars, and charming liars. Mind sharp, luck sharper.',
    stats: { int: 2, lk: 1 },
    hp: -5, mp: 8,
    initiative: 0,
    promotion: {
      to: 'Infernal Heir', glyph: '☄️',
      blurb: 'The old signature on your bloodline flares. Something downstairs sends congratulations — and expectations.',
      bonus: { int: 3, lk: 2, mp: 22 },
    },
  },
  beastfolk: {
    id: 'beastfolk',
    name: 'Beastfolk',
    glyph: '🐺',
    blurb: 'Claw, fang, and a spine that remembers the hunt. Beastfolk climb the tower the way wolves climb hills — low, fast, and hungry.',
    hint: 'Affinity: brawlers, monks, stalkers, and rangers. Muscle that moves like a predator.',
    stats: { str: 1, dex: 2 },
    hp: 5, mp: -2,
    initiative: 1,
    promotion: {
      to: 'Apex Kin', glyph: '🌕',
      blurb: 'The pack-instinct goes quiet. You were never prey. The tower learns this the hard way.',
      bonus: { str: 3, dex: 3, hp: 22 },
    },
  },
  dragonkin: {
    id: 'dragonkin',
    name: 'Dragonkin',
    glyph: '🐉',
    blurb: 'Scaled and stubborn, with a furnace under the ribs. Dragonkin argue with the tower in the original dialect: heat, pride, and territorial hissing.',
    hint: 'Affinity: vanguard steel and spellfire. Strength and intellect share the same blood.',
    stats: { str: 2, int: 1 },
    hp: 6, mp: 4,
    def: 1,
    initiative: -1,
    promotion: {
      to: 'Wyrmblooded', glyph: '🌋',
      blurb: 'Ancestral fire wakes along your scales. The tower\'s cold floors suddenly feel optional.',
      bonus: { str: 3, int: 3, hp: 16, mp: 16, def: 1 },
    },
  },
};

export function applyRacePromotion(run) {
  const race = RACES[run.raceId];
  if (!race || run.promoted) return null;
  const p = race.promotion;
  run.promoted = true;
  run.raceName = p.to;
  const b = p.bonus;
  if (b.statsAll) for (const k of Object.keys(run.stats)) run.stats[k] += b.statsAll;
  for (const k of ['str', 'dex', 'int', 'wis', 'lk']) if (b[k]) run.stats[k] += b[k];
  if (b.hp) { run.maxHp += b.hp; run.hp += b.hp; }
  if (b.mp) { run.maxMp += b.mp; run.mp += b.mp; }
  if (b.def) run.raceDef = (run.raceDef || 0) + b.def;
  return p;
}
