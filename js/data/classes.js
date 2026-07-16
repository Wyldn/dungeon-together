// Six starting classes (handoff §21). Each has: a class resource identity,
// compatible weapon types, two immediate subclasses (level 6 choice), one
// deeper branch per immediate (level 13), and one SECRET subclass whose
// requirements are never shown to the player.
//
// The full tree is intentionally not rendered anywhere in the UI.

export const CLASSES = {
  warrior: {
    id: 'warrior',
    name: 'Warrior',
    epithet: 'Unbreakable wall of the vanguard. Trades subtlety for steel.',
    accent: '#d9763f',
    resource: { name: 'Vigor', color: '#d97f3f' },
    weapons: ['sword', 'axe', 'mace'],
    startWeapon: 'rusty_sword',
    base: { hp: 46, mp: 20, str: 9, dex: 5, int: 3, wis: 5, lk: 4 },
    roll: { hp: 12, mp: 6, str: 5, dex: 3, int: 2, wis: 3, lk: 3 },
    startSkills: ['slash', 'shield_bash', 'war_cry'],
    pool: { common: 'heavy_swing', rare: 'cleave' },
    aoeSkill: 'cleave',
    growthBias: ['str', 'str', 'dex', 'wis'],
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    epithet: 'A scholar who read one forbidden book too many.',
    accent: '#6f8ff0',
    resource: { name: 'Mana', color: '#4f8fd9' },
    weapons: ['staff'],
    startWeapon: 'oak_staff',
    base: { hp: 32, mp: 42, str: 3, dex: 4, int: 10, wis: 7, lk: 4 },
    roll: { hp: 8, mp: 14, str: 2, dex: 3, int: 5, wis: 4, lk: 3 },
    startSkills: ['firebolt', 'frost_lance', 'arcane_ward'],
    pool: { common: 'mana_dart', rare: 'mana_storm' },
    aoeSkill: 'mana_storm',
    growthBias: ['int', 'int', 'wis', 'lk'],
  },
  archer: {
    id: 'archer',
    name: 'Ranger',
    epithet: 'Never misses twice. Rarely misses once. The wilds are home.',
    accent: '#7fd95a',
    resource: { name: 'Focus', color: '#5ac98f' },
    weapons: ['bow', 'dagger'],
    startWeapon: 'hunting_bow',
    base: { hp: 38, mp: 26, str: 5, dex: 10, int: 4, wis: 5, lk: 5 },
    roll: { hp: 10, mp: 8, str: 3, dex: 5, int: 2, wis: 3, lk: 4 },
    startSkills: ['quick_shot', 'aimed_shot', 'evasive_roll'],
    pool: { common: 'double_nock', rare: 'volley' },
    aoeSkill: 'volley',
    growthBias: ['dex', 'dex', 'lk', 'str'],
  },
  rogue: {
    id: 'rogue',
    name: 'Rogue',
    epithet: 'The tower has many locks. You have many answers.',
    accent: '#c08af0',
    resource: { name: 'Energy', color: '#b06fd9' },
    weapons: ['dagger', 'sword'],
    startWeapon: 'runed_dagger_worn',
    base: { hp: 36, mp: 24, str: 5, dex: 9, int: 4, wis: 4, lk: 8 },
    roll: { hp: 9, mp: 7, str: 3, dex: 5, int: 2, wis: 3, lk: 5 },
    startSkills: ['backstab', 'poison_blade', 'smoke_bomb'],
    pool: { common: 'throat_jab', rare: 'fan_of_knives' },
    aoeSkill: 'fan_of_knives',
    growthBias: ['dex', 'lk', 'lk', 'str'],
  },
  priest: {
    id: 'priest',
    name: 'Priest',
    epithet: 'The tower is full of the dead. Somebody should say the words.',
    accent: '#f0d76f',
    resource: { name: 'Faith', color: '#d9c04f' },
    weapons: ['mace', 'staff'],
    startWeapon: 'novice_mace',
    base: { hp: 38, mp: 36, str: 4, dex: 4, int: 6, wis: 10, lk: 4 },
    roll: { hp: 10, mp: 12, str: 3, dex: 2, int: 4, wis: 5, lk: 3 },
    startSkills: ['smite', 'mend', 'radiant_ward'],
    pool: { common: 'rebuke', rare: 'judgement' },
    aoeSkill: 'judgement',
    growthBias: ['wis', 'wis', 'int', 'str'],
  },
  monk: {
    id: 'monk',
    name: 'Monk',
    epithet: 'Owns nothing, owes nothing, fears nothing. Punches everything.',
    accent: '#6fd9d9',
    resource: { name: 'Ki', color: '#4fc9b8' },
    weapons: ['fist', 'staff'],
    startWeapon: 'wraps',
    base: { hp: 42, mp: 26, str: 7, dex: 8, int: 3, wis: 6, lk: 4 },
    roll: { hp: 11, mp: 8, str: 4, dex: 4, int: 2, wis: 4, lk: 3 },
    startSkills: ['palm_strike', 'flurry', 'iron_stance'],
    pool: { common: 'low_sweep', rare: 'hurricane_kick' },
    aoeSkill: 'hurricane_kick',
    growthBias: ['dex', 'str', 'wis', 'wis'],
  },
  warlock: {
    id: 'warlock',
    name: 'Warlock',
    epithet: 'Signed something, once. The power is real; the invoice is pending.',
    accent: '#9a5fd9',
    resource: { name: 'Pact', color: '#8a4fd0' },
    weapons: ['staff', 'dagger'],
    startWeapon: 'oak_staff',
    base: { hp: 36, mp: 34, str: 4, dex: 4, int: 9, wis: 5, lk: 5 },
    roll: { hp: 9, mp: 11, str: 2, dex: 3, int: 5, wis: 3, lk: 4 },
    startSkills: ['eldritch_bolt', 'hex_mark', 'shadow_ward'],
    pool: { common: 'dark_pact', rare: 'rain_of_ruin' },
    aoeSkill: 'rain_of_ruin',
    growthBias: ['int', 'int', 'lk', 'wis'],
  },
  bard: {
    id: 'bard',
    name: 'Bard',
    epithet: 'The tower is a story. Stories can be edited.',
    accent: '#e08fb8',
    resource: { name: 'Verve', color: '#d9709f' },
    weapons: ['dagger', 'sword'],
    startWeapon: 'runed_dagger_worn',
    base: { hp: 38, mp: 30, str: 4, dex: 6, int: 5, wis: 5, lk: 9 },
    roll: { hp: 10, mp: 9, str: 3, dex: 4, int: 3, wis: 3, lk: 5 },
    startSkills: ['cutting_quip', 'rallying_chord', 'soothing_refrain'],
    pool: { common: 'discord', rare: 'cacophony' },
    aoeSkill: 'cacophony',
    growthBias: ['lk', 'lk', 'dex', 'wis'],
  },
  necromancer: {
    id: 'necromancer',
    name: 'Necromancer',
    epithet: 'The tower is full of the dead. Somebody should ORGANIZE them.',
    accent: '#7a9a6a',
    resource: { name: 'Essence', color: '#6a8a5a' },
    weapons: ['staff', 'dagger'],
    startWeapon: 'oak_staff',
    hidden: true,
    unlockCond: meta => (meta.bestFloor || 0) >= 20,
    unlockHint: 'Climb past floor 20 and the tower will show you what it keeps below.',
    base: { hp: 34, mp: 38, str: 3, dex: 4, int: 10, wis: 6, lk: 4 },
    roll: { hp: 9, mp: 12, str: 2, dex: 3, int: 5, wis: 4, lk: 3 },
    startSkills: ['soul_bolt', 'bone_spike', 'corpse_ward'],
    pool: { common: 'siphon_life', rare: 'grave_bloom' },
    aoeSkill: 'grave_bloom',
    growthBias: ['int', 'int', 'wis', 'lk'],
  },
  spellsword: {
    id: 'spellsword',
    name: 'Spellsword',
    epithet: 'Steel in one hand, syntax in the other. Refuses to specialize.',
    accent: '#5ec8c0',
    resource: { name: 'Arcana', color: '#5ec8c0' },
    weapons: ['sword', 'staff'],
    startWeapon: 'runed_shortsword',
    base: { hp: 40, mp: 34, str: 7, dex: 5, int: 7, wis: 5, lk: 4 },
    roll: { hp: 10, mp: 10, str: 4, dex: 3, int: 4, wis: 3, lk: 3 },
    startSkills: ['rune_edge', 'arc_ward', 'mana_lunge'],
    pool: { common: 'sigil_thrust', rare: 'blade_tempest' },
    aoeSkill: 'blade_tempest',
    growthBias: ['str', 'int', 'str', 'int'],
  },
};

/* ============================================================
   SUBCLASS TREE (hidden from players)
   tier 1 = level-6 choice · tier 2 = level-13 branch · secret = hidden 3rd
   secretCond(run) — never surfaced in UI; the option simply appears.
   ============================================================ */
export const SUBCLASSES = {
  /* ---- Warrior ---- */
  knight: {
    id: 'knight', name: 'Knight', parent: 'warrior', tier: 1,
    blurb: 'Your oath hardens into armor. The tower takes notice.',
    hint: 'The shield-road: endure, protect, outlast.',
    bonus: { str: 2, wis: 2, hp: 20 }, skill: 'iron_will',
    next: 'paladin',
  },
  berserker: {
    id: 'berserker', name: 'Berserker', parent: 'warrior', tier: 1,
    blurb: 'You stop holding the anger back. The anger appreciates it.',
    hint: 'The blood-road: hit first, hit hardest, heal never.',
    bonus: { str: 4, hp: 8 }, skill: 'rampage',
    next: 'warlord',
  },
  paladin: {
    id: 'paladin', name: 'Paladin', parent: 'knight', tier: 2,
    blurb: 'Light answers when you call. Even demons hesitate.',
    bonus: { str: 3, wis: 4, hp: 25 }, skill: 'holy_strike',
  },
  warlord: {
    id: 'warlord', name: 'Warlord', parent: 'berserker', tier: 2,
    blurb: 'Armies would follow you. The tower only has monsters; they follow too, briefly, into walls.',
    bonus: { str: 5, dex: 2, hp: 15 }, skill: 'whirlwind',
  },
  doomguard: {
    id: 'doomguard', name: 'Doomguard', parent: 'warrior', tier: 1, secret: true,
    blurb: 'You have killed enough that Death considers you a colleague.',
    hint: 'A black option that was not there for other climbers.',
    secretCond: run => run.kills >= 15,
    bonus: { str: 4, wis: 2, hp: 20 }, skill: 'reapers_toll',
    next: null,
  },

  /* ---- Mage ---- */
  sorcerer: {
    id: 'sorcerer', name: 'Sorcerer', parent: 'mage', tier: 1,
    blurb: 'The forbidden pages begin reading you back.',
    hint: 'The deep-arcana road: more power, fewer apologies.',
    bonus: { int: 4, mp: 15 }, skill: 'chain_lightning',
    next: 'archmage',
  },
  spellblade: {
    id: 'spellblade', name: 'Spellblade', parent: 'mage', tier: 1,
    blurb: 'Why choose between the library and the armory? Rude question. Correct question.',
    hint: 'The war-mage road: swords stop being someone else\'s problem.',
    bonus: { int: 2, str: 3, hp: 12 }, skill: 'rune_slash',
    weaponAdd: ['sword'], // the Spellblade exception (handoff §20)
    next: 'runeknight',
  },
  archmage: {
    id: 'archmage', name: 'Archmage', parent: 'sorcerer', tier: 2,
    blurb: 'Reality bends politely when you clear your throat.',
    bonus: { int: 5, wis: 4, mp: 25 }, skill: 'meteor',
  },
  runeknight: {
    id: 'runeknight', name: 'Runeknight', parent: 'spellblade', tier: 2,
    blurb: 'Your blade remembers every spell it has ever been.',
    bonus: { int: 3, str: 4, hp: 20 }, skill: 'blade_storm',
  },
  void_scholar: {
    id: 'void_scholar', name: 'Void Scholar', parent: 'mage', tier: 1, secret: true,
    blurb: 'You have read the tower\'s footnotes. The tower is embarrassed.',
    hint: 'An option written in ink that isn\'t there.',
    secretCond: run => (run.sigils?.length || 0) >= 1 || run.flags.tree_lore || run.flags.v_lore || run.flags.witch_hint,
    bonus: { int: 5, wis: 3, mp: 20 }, skill: 'unmake',
    next: null,
  },

  /* ---- Archer ---- */
  ranger: {
    id: 'ranger', name: 'Warden', parent: 'archer', tier: 1,
    blurb: 'The wilds whisper the wind\'s secrets to you.',
    hint: 'The wild-road: poisons, patience, and pathfinding.',
    bonus: { dex: 3, wis: 2, hp: 10 }, skill: 'serpent_arrow',
    next: 'windwalker',
  },
  sniper: {
    id: 'sniper', name: 'Sniper', parent: 'archer', tier: 1,
    blurb: 'One arrow, one ending. You have stopped counting the middles.',
    hint: 'The still-road: distance, precision, finality.',
    bonus: { dex: 4, lk: 2 }, skill: 'piercing_arrow',
    next: 'deadeye',
  },
  windwalker: {
    id: 'windwalker', name: 'Windwalker', parent: 'ranger', tier: 2,
    blurb: 'Your arrows arrive before the sound of the bowstring.',
    bonus: { dex: 5, lk: 3, hp: 15 }, skill: 'arrow_tempest',
  },
  deadeye: {
    id: 'deadeye', name: 'Deadeye', parent: 'sniper', tier: 2,
    blurb: 'You see the world as a set of distances, and every distance as solved.',
    bonus: { dex: 6, lk: 3 }, skill: 'one_shot',
  },
  stormcaller: {
    id: 'stormcaller', name: 'Stormcaller', parent: 'archer', tier: 1, secret: true,
    blurb: 'The sky owes you a favor. Several, actually.',
    hint: 'A crackling option that fortune reveals.',
    secretCond: run => run.stats.lk >= 12,
    bonus: { dex: 3, lk: 4, mp: 10 }, skill: 'lightning_arrow',
    next: null,
  },

  /* ---- Rogue ---- */
  assassin: {
    id: 'assassin', name: 'Assassin', parent: 'rogue', tier: 1,
    blurb: 'Death signs your work now. It admires the craftsmanship.',
    hint: 'The quiet-road: one perfect strike over ten loud ones.',
    bonus: { dex: 4, lk: 2 }, skill: 'assassinate',
    next: 'nightblade',
  },
  trickster: {
    id: 'trickster', name: 'Trickster', parent: 'rogue', tier: 1,
    blurb: 'The tower deals the cards. You deal from the bottom.',
    hint: 'The luck-road: fortune, larceny, and lovely accidents.',
    bonus: { lk: 5, dex: 2 }, skill: 'loaded_dice',
    next: 'fatecutter',
  },
  nightblade: {
    id: 'nightblade', name: 'Nightblade', parent: 'assassin', tier: 2,
    blurb: 'You are the reason dungeons fear the dark.',
    bonus: { dex: 5, lk: 4, hp: 12 }, skill: 'thousand_cuts',
  },
  fatecutter: {
    id: 'fatecutter', name: 'Fatecutter', parent: 'trickster', tier: 2,
    blurb: 'Somewhere, a ledger of destinies has your penmanship in the margins.',
    bonus: { lk: 6, dex: 3 }, skill: 'twist_of_fate',
  },
  phantom: {
    id: 'phantom', name: 'Phantom', parent: 'rogue', tier: 1, secret: true,
    blurb: 'Officially, you do not exist. Unofficially, you\'re rich.',
    hint: 'An option only the guilty can read.',
    secretCond: run => run.flags.defiler || run.flags.stole_rose || run.flags.left_climber || run.gold >= 300,
    bonus: { dex: 4, lk: 3, hp: 10 }, skill: 'ghost_step',
    next: null,
  },

  /* ---- Priest ---- */
  cleric: {
    id: 'cleric', name: 'Cleric', parent: 'priest', tier: 1,
    blurb: 'Your prayers stopped being requests somewhere around floor five.',
    hint: 'The mending-road: keep everything alive out of spite.',
    bonus: { wis: 4, hp: 15, mp: 10 }, skill: 'sanctuary',
    next: 'hierophant',
  },
  inquisitor: {
    id: 'inquisitor', name: 'Inquisitor', parent: 'priest', tier: 1,
    blurb: 'Some prayers are questions. Yours are verdicts.',
    hint: 'The burning-road: heresy ends where you\'re standing.',
    bonus: { wis: 3, str: 3 }, skill: 'censure',
    next: 'judge',
  },
  hierophant: {
    id: 'hierophant', name: 'Hierophant', parent: 'cleric', tier: 2,
    blurb: 'The divine takes your calls directly now. It sounds tired but fond.',
    bonus: { wis: 5, int: 3, hp: 20, mp: 15 }, skill: 'last_rites',
  },
  judge: {
    id: 'judge', name: 'Judge', parent: 'inquisitor', tier: 2,
    blurb: 'Your verdicts are appealable only to gravity.',
    bonus: { wis: 4, str: 4, hp: 15 }, skill: 'final_verdict',
  },
  heretic_saint: {
    id: 'heretic_saint', name: 'Heretic Saint', parent: 'priest', tier: 1, secret: true,
    blurb: 'You broke the rules and the light forgave you FIRST. The clergy are furious.',
    hint: 'An option that should not be offered to someone like you.',
    secretCond: run => run.flags.defiler && run.fame >= 15,
    bonus: { wis: 4, lk: 3, mp: 15 }, skill: 'profane_mercy',
    next: null,
  },

  /* ---- Monk ---- */
  ironbody: {
    id: 'ironbody', name: 'Ironbody', parent: 'monk', tier: 1,
    blurb: 'Blades bend. You do not. The blades take it personally.',
    hint: 'The mountain-road: become the thing walls wish they were.',
    bonus: { str: 3, wis: 2, hp: 25 }, skill: 'immovable',
    next: 'mountain_sage',
  },
  windfist: {
    id: 'windfist', name: 'Windfist', parent: 'monk', tier: 1,
    blurb: 'You hit like weather: everywhere, briefly, undeniably.',
    hint: 'The gale-road: speed until speed becomes violence.',
    bonus: { dex: 4, str: 2 }, skill: 'gale_palm',
    next: 'storm_dancer',
  },
  mountain_sage: {
    id: 'mountain_sage', name: 'Mountain Sage', parent: 'ironbody', tier: 2,
    blurb: 'Old masters climb mountains for wisdom. You skipped a step and became one.',
    bonus: { str: 4, wis: 4, hp: 30 }, skill: 'earthbreaker',
  },
  storm_dancer: {
    id: 'storm_dancer', name: 'Storm Dancer', parent: 'windfist', tier: 2,
    blurb: 'Somewhere between the third and fourth strike, you stop touching the ground.',
    bonus: { dex: 6, str: 3, hp: 12 }, skill: 'hundred_fists',
  },
  ashen_fist: {
    id: 'ashen_fist', name: 'Ashen Fist', parent: 'monk', tier: 1, secret: true,
    blurb: 'You guarded until the guarding burned away, and what remained was the strike.',
    hint: 'An option earned in stillness.',
    secretCond: run => (run.guardCount || 0) >= 8,
    bonus: { str: 4, dex: 3, hp: 15 }, skill: 'phoenix_palm',
    next: null,
  },

  /* ---- Warlock ---- */
  fiendbinder: {
    id: 'fiendbinder', name: 'Fiendbinder', parent: 'warlock', tier: 1,
    blurb: 'Your patron now reports to YOU. It is furious. It is also contractually obligated.',
    hint: 'The chain-road: fire, leverage, and renegotiated terms.',
    bonus: { int: 3, hp: 12 }, skill: 'fiend_whip',
    next: 'pactlord',
  },
  voidcaller: {
    id: 'voidcaller', name: 'Voidcaller', parent: 'warlock', tier: 1,
    blurb: 'You stopped asking the dark for power and started taking messages from it.',
    hint: 'The hollow-road: silence, unmaking, and patience.',
    bonus: { int: 4, mp: 12 }, skill: 'null_wave',
    next: 'abysswalker',
  },
  pactlord: {
    id: 'pactlord', name: 'Pactlord', parent: 'fiendbinder', tier: 2,
    blurb: 'Hell keeps your contract in a frame now. As a warning to the others.',
    bonus: { int: 4, str: 2, hp: 20 }, skill: 'oblivion',
  },
  abysswalker: {
    id: 'abysswalker', name: 'Abysswalker', parent: 'voidcaller', tier: 2,
    blurb: 'You have been where the tower does not go. It is polite to you now.',
    bonus: { int: 5, wis: 3, mp: 20 }, skill: 'oblivion',
  },
  lightbreaker: {
    id: 'lightbreaker', name: 'Lightbreaker', parent: 'warlock', tier: 1, secret: true,
    blurb: 'The pact never said which side the power had to come from.',
    hint: 'An option written in daylight, impossibly.',
    secretCond: run => run.flags.freed_angel || (run.flags.defiler && run.fame >= 20),
    bonus: { int: 4, wis: 3, hp: 15 }, skill: 'dawnbreak',
    next: null,
  },

  /* ---- Bard ---- */
  skald: {
    id: 'skald', name: 'Skald', parent: 'bard', tier: 1,
    blurb: 'Your songs have edges now. Audiences bleed, enemies applaud.',
    hint: 'The war-verse road: courage as a weapon.',
    bonus: { str: 3, lk: 2, hp: 12 }, skill: 'saga_of_steel',
    next: 'sagalord',
  },
  muse: {
    id: 'muse', name: 'Muse', parent: 'bard', tier: 1,
    blurb: 'People near you become the best versions of themselves. It exhausts everyone.',
    hint: 'The heart-song road: mend, inspire, outlast.',
    bonus: { wis: 3, lk: 2, mp: 12 }, skill: 'inspire_greatness',
    next: 'siren',
  },
  sagalord: {
    id: 'sagalord', name: 'Sagalord', parent: 'skald', tier: 2,
    blurb: 'You no longer sing about legends. Legends sing about keeping up.',
    bonus: { str: 4, lk: 4, hp: 18 }, skill: 'grand_finale',
  },
  siren: {
    id: 'siren', name: 'Siren', parent: 'muse', tier: 2,
    blurb: 'Your voice reaches the parts of people that armor was invented for.',
    bonus: { lk: 5, wis: 4, mp: 15 }, skill: 'grand_finale',
  },
  doomsinger: {
    id: 'doomsinger', name: 'Doomsinger', parent: 'bard', tier: 1, secret: true,
    blurb: 'The bard in the tower taught you the verse she never performs.',
    hint: 'An option hummed in a familiar key.',
    secretCond: run => !!run.flags.bard_friend,
    bonus: { lk: 4, int: 3, hp: 10 }, skill: 'last_ballad',
    next: null,
  },

  /* ---- Necromancer ---- */
  plaguelord: {
    id: 'plaguelord', name: 'Plaguelord', parent: 'necromancer', tier: 1,
    blurb: 'Disease is just life with different management. You manage.',
    hint: 'The blight-road: everything withers eventually. Sooner, with help.',
    bonus: { int: 3, wis: 2, hp: 12 }, skill: 'plague_wind',
    next: 'pestilence',
  },
  gravecaller: {
    id: 'gravecaller', name: 'Gravecaller', parent: 'necromancer', tier: 1,
    blurb: 'The dead answer you first now. The living are learning to.',
    hint: 'The deep-road: raw power drawn from full graves.',
    bonus: { int: 4, mp: 12 }, skill: 'raise_anguish',
    next: 'deathspeaker',
  },
  pestilence: {
    id: 'pestilence', name: 'Pestilence', parent: 'plaguelord', tier: 2,
    blurb: 'You are no longer a person who spreads plagues. You are the plague with opinions.',
    bonus: { int: 4, wis: 3, hp: 18 }, skill: 'black_rain',
  },
  deathspeaker: {
    id: 'deathspeaker', name: 'Deathspeaker', parent: 'gravecaller', tier: 2,
    blurb: 'Death takes your calls personally. Sometimes it asks for advice.',
    bonus: { int: 5, wis: 3, mp: 18 }, skill: 'final_word',
  },
  lichling: {
    id: 'lichling', name: 'Lichling', parent: 'necromancer', tier: 1, secret: true,
    blurb: 'You put a piece of yourself somewhere safe. The rest of you is negotiable.',
    hint: 'An option with your own handwriting on it.',
    secretCond: run => (run.sigils?.length || 0) >= 1 || run.kills >= 25,
    bonus: { int: 4, wis: 3, hp: 15 }, skill: 'phylactery_pulse',
    next: null,
  },

  /* ---- Spellsword ---- */
  spellknight: {
    id: 'spellknight', name: 'Spellknight', parent: 'spellsword', tier: 1,
    blurb: 'You put the ward on the blade and the blade on the problem.',
    hint: 'The aegis-road: steel that protects as it cuts.',
    bonus: { str: 2, int: 2, hp: 16, mp: 6 }, skill: 'aegis_cut',
    next: 'arcane_paladin',
  },
  hexblade: {
    id: 'hexblade', name: 'Hexblade', parent: 'spellsword', tier: 1,
    blurb: 'Every cut leaves a footnote the enemy would rather unread.',
    hint: 'The brand-road: hex first, then harvest the weakness.',
    bonus: { int: 3, str: 2, mp: 10 }, skill: 'hex_rend',
    next: 'runeblade',
  },
  arcane_paladin: {
    id: 'arcane_paladin', name: 'Arcane Paladin', parent: 'spellknight', tier: 2,
    blurb: 'Oath and formula agree for once. The tower files a complaint.',
    bonus: { str: 3, int: 3, wis: 2, hp: 22 }, skill: 'sanctum_blade',
  },
  runeblade: {
    id: 'runeblade', name: 'Runeblade', parent: 'hexblade', tier: 2,
    blurb: 'Your sword is a living manuscript. Enemies are the edit.',
    bonus: { int: 4, str: 3, mp: 18 }, skill: 'living_script',
  },
  void_edge: {
    id: 'void_edge', name: 'Void Edge', parent: 'spellsword', tier: 1, secret: true,
    blurb: 'You learned to cut with the space between steel and spell.',
    hint: 'An option that only appears when both hands are equally bloody.',
    secretCond: run =>
      (run.stats.str >= 12 && run.stats.int >= 12)
      || (run.kills >= 20 && run.stats.str >= 10 && run.stats.int >= 10),
    bonus: { str: 3, int: 4, hp: 12, mp: 12 }, skill: 'eclipse_cut',
    next: null,
  },
};

export const EVOLUTION_LEVELS = { first: 6, second: 13 };

// Options for the level-6 advancement: two immediates + secret if earned.
export function subclassOptions(run) {
  const options = Object.values(SUBCLASSES)
    .filter(s => s.parent === run.classId && s.tier === 1 && !s.secret);
  const secret = Object.values(SUBCLASSES)
    .find(s => s.parent === run.classId && s.secret && s.secretCond?.(run));
  if (secret) options.push(secret);
  return options;
}

export function deeperBranch(run) {
  const current = SUBCLASSES[run.subclassId];
  return current?.next ? SUBCLASSES[current.next] : null;
}

export const RANDOM_NAMES = [
  'Kael', 'Seris', 'Bramble', 'Vex', 'Thorne', 'Isolde', 'Garrick', 'Lyra',
  'Dorn', 'Ashwyn', 'Fen', 'Maribel', 'Oskar', 'Riven', 'Sable', 'Tamsin',
  'Corvus', 'Elba', 'Hark', 'Nyx', 'Piper', 'Quill', 'Wren', 'Yorick',
];
