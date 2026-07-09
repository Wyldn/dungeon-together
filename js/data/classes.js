// The Basic Four. Each evolves twice during a run (design doc: class aspects).
// base = stat floor; roll = extra RNG range added at character creation.

export const CLASSES = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    epithet: 'Unbreakable wall of the vanguard. Trades subtlety for steel.',
    accent: '#d9763f',
    base: { hp: 46, mp: 20, str: 9, dex: 5, int: 3, wis: 5, lk: 4 },
    roll: { hp: 12, mp: 6, str: 5, dex: 3, int: 2, wis: 3, lk: 3 },
    startSkills: ['slash', 'shield_bash', 'war_cry', 'cleave'],
    evolutions: [
      { level: 6, name: 'Knight', bonus: { str: 3, hp: 15 }, blurb: 'Your oath hardens into armor. The tower takes notice.' },
      { level: 13, name: 'Paladin', bonus: { str: 4, wis: 4, hp: 25 }, blurb: 'Light answers when you call. Even demons hesitate.' },
    ],
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    epithet: 'A scholar who read one forbidden book too many.',
    accent: '#6f8ff0',
    base: { hp: 32, mp: 42, str: 3, dex: 4, int: 10, wis: 7, lk: 4 },
    roll: { hp: 8, mp: 14, str: 2, dex: 3, int: 5, wis: 4, lk: 3 },
    startSkills: ['firebolt', 'frost_lance', 'arcane_ward', 'mana_storm'],
    evolutions: [
      { level: 6, name: 'Sorcerer', bonus: { int: 4, mp: 15 }, blurb: 'The forbidden pages begin reading you back.' },
      { level: 13, name: 'Archmage', bonus: { int: 5, wis: 4, mp: 25 }, blurb: 'Reality bends politely when you clear your throat.' },
    ],
  },
  archer: {
    id: 'archer',
    name: 'Archer',
    epithet: 'Never misses twice. Rarely misses once.',
    accent: '#7fd95a',
    base: { hp: 38, mp: 26, str: 5, dex: 10, int: 4, wis: 5, lk: 5 },
    roll: { hp: 10, mp: 8, str: 3, dex: 5, int: 2, wis: 3, lk: 4 },
    startSkills: ['quick_shot', 'aimed_shot', 'evasive_roll', 'volley'],
    evolutions: [
      { level: 6, name: 'Ranger', bonus: { dex: 4, hp: 10 }, blurb: 'The wilds whisper the wind’s secrets to you.' },
      { level: 13, name: 'Windwalker', bonus: { dex: 5, lk: 3, hp: 15 }, blurb: 'Your arrows arrive before the sound of the bowstring.' },
    ],
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue',
    epithet: 'The tower has many locks. You have many answers.',
    accent: '#c08af0',
    base: { hp: 36, mp: 24, str: 5, dex: 9, int: 4, wis: 4, lk: 8 },
    roll: { hp: 9, mp: 7, str: 3, dex: 5, int: 2, wis: 3, lk: 5 },
    startSkills: ['backstab', 'poison_blade', 'smoke_bomb', 'fan_of_knives'],
    evolutions: [
      { level: 6, name: 'Assassin', bonus: { dex: 4, lk: 2 }, blurb: 'Death signs your work now. It admires the craftsmanship.' },
      { level: 13, name: 'Nightblade', bonus: { dex: 5, lk: 4, hp: 12 }, blurb: 'You are the reason dungeons fear the dark.' },
    ],
  },
};

export const RANDOM_NAMES = [
  'Kael', 'Seris', 'Bramble', 'Vex', 'Thorne', 'Isolde', 'Garrick', 'Lyra',
  'Dorn', 'Ashwyn', 'Fen', 'Maribel', 'Oskar', 'Riven', 'Sable', 'Tamsin',
  'Corvus', 'Elba', 'Hark', 'Nyx', 'Piper', 'Quill', 'Wren', 'Yorick',
];
