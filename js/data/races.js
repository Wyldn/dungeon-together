// Four starting races (handoff §22). Descriptions suggest affinities without
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
