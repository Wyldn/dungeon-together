// Bestiary. Base stats are for the biome's first floor; the engine scales
// them via the Tower Difficulty Curve in js/data/tdc.js (depth × biome
// multipliers — never by live player power).
//
// Battle Charge (handoff §12): enemies share the player charge framework.
// specials: [{ at, name, mult, aoe?, stun?, burn?, freeze?, heal?, desc }]
//   — used when charge >= at (highest affordable wins), then charge resets.
//   Telegraphed in the UI one segment before it's ready.
// freezeEvery: N → freeze only on every Nth turn (overrides per-hit freeze chance).
// cleanseEvery / cleanseCost (bosses): periodic full shrug, or spend FOC to break freeze/stun.
// spd doubles as the initiative stat. intelligent gates bribery (§25).
//
// Phase evolve (optional on bosses with phases:true):
//   phaseArt / phaseName / phaseGlyph / phaseSpecials / phaseText
//   — at ≤50% HP the sprite (and optional identity) swap mid-fight.

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
    flavor: 'The Frost Queen\'s court froze mid-betrayal. The cold keeps grudges fresh.',
    particle: 'snow',
  },
  {
    id: 'swamp', name: 'Weeping Mire', floors: [31, 40], glow: '#5f8a3f',
    flavor: 'The water is patient. Everything sinks eventually — hope included.',
    particle: 'spores',
  },
  {
    id: 'hell', name: 'The Scorch', floors: [41, 50], glow: '#c9503a',
    flavor: 'The final ascent. The air itself has chosen a side, and it isn\'t yours.',
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

export const ENEMIES = {
  forest: [
    { id: 'wolf', name: 'Dire Wolf', glyph: '🐺', hp: 28, atk: 6, def: 1, spd: 8, gold: [6, 14], xp: 10, pack: true,
      specials: [{ at: 4, name: 'Savage Pounce', mult: 1.6, desc: 'lunges for the throat' }] },
    { id: 'sprite', name: 'Feral Sprite', glyph: '🧚', hp: 28, atk: 5, def: 0, spd: 11, gold: [8, 16], xp: 9, caster: true, intelligent: true,
      specials: [{ at: 4, name: 'Glimmer Burst', mult: 1.25, aoe: true, desc: 'gathers stolen light' }] },
    { id: 'boar', name: 'Ironback Boar', glyph: '🐗', hp: 38, atk: 7, def: 2, spd: 4, gold: [7, 15], xp: 12,
      specials: [{ at: 5, name: 'Full Gore', mult: 1.8, desc: 'paws the ground' }] },
    { id: 'bandit', name: 'Forest Bandit', glyph: '🗡️', hp: 31, atk: 7, def: 1, spd: 7, gold: [14, 28], xp: 12, pack: true, intelligent: true,
      specials: [{ at: 4, name: 'Dirty Trick', mult: 1.4, stun: 0.4, desc: 'palms something glinting' }] },
    { id: 'treant', name: 'Young Treant', glyph: '🌳', hp: 52, atk: 8, def: 4, spd: 2, gold: [10, 20], xp: 16, elite: true,
      specials: [{ at: 4, name: 'Rootquake', mult: 1.3, aoe: true, desc: 'roots coil beneath everyone' }] },
    { id: 'spider', name: 'Widow Spider', glyph: '🕷️', hp: 26, atk: 6, def: 1, spd: 9, gold: [6, 13], xp: 10, poison: 0.4,
      specials: [{ at: 4, name: 'Venom Flood', mult: 1.3, poisonSure: true, desc: 'fangs drip freely' }] },
    { id: 'myconid', name: 'Sporeback Myconid', glyph: '🍄', hp: 34, atk: 6, def: 2, spd: 5, gold: [7, 15], xp: 11, poison: 0.5,
      specials: [{ at: 4, name: 'Spore Bloom', mult: 1.2, aoe: true, poisonSure: true, desc: 'caps swell with spores' }] },
    { id: 'vampire', name: 'Pale Wanderer', glyph: '🧛', hp: 44, atk: 9, def: 2, spd: 9, gold: [18, 34], xp: 18, lifesteal: 0.4, intelligent: true, elite: true,
      specials: [{ at: 3, name: 'Crimson Draught', mult: 1.5, heal: 0.1, weaken: 0.5, desc: 'bares a red smile' }, { at: 6, name: 'Night\'s Embrace', mult: 1.45, aoe: true, heal: 0.1, frailSure: true, desc: 'the shadows lean in hungrily' }] },
    { id: 'rat', name: 'Tunnel Rat', glyph: '🐀', hp: 26, atk: 5, def: 0, spd: 12, gold: [4, 10], xp: 7, pack: true,
      specials: [{ at: 3, name: 'Nip Tendon', mult: 1.3, desc: 'darts for the ankles' }] },
    { id: 'slime', name: 'Grove Slime', glyph: '🟢', hp: 32, atk: 5, def: 2, spd: 3, gold: [5, 12], xp: 9, poison: 0.25, pack: true,
      specials: [{ at: 5, name: 'Acid Splash', mult: 1.2, aoe: true, poisonSure: true, desc: 'the blob ripples hungrily' }] },
    { id: 'orc', name: 'Woods Orc', glyph: '🪓', hp: 36, atk: 8, def: 2, spd: 5, gold: [12, 24], xp: 13, pack: true, intelligent: true,
      specials: [{ at: 5, name: 'Cleaving Chop', mult: 1.3, aoe: true, desc: 'raises a notched axe' }] },
    { id: 'dusk_lurker', name: 'Dusk Lurker', glyph: '👁️', hp: 48, atk: 9, def: 3, spd: 8, gold: [16, 30], xp: 17, elite: true,
      specials: [{ at: 3, name: 'Tongue Lash', mult: 1.45, desc: 'something wet uncoils' }, { at: 5, name: 'Many-Eyed Stare', mult: 1.4, aoe: true, stun: 0.2, desc: 'too many pupils find you' }] },
  ],
  ruins: [
    { id: 'skeleton', name: 'Restless Skeleton', glyph: '💀', hp: 34, atk: 10, def: 3, spd: 6, gold: [12, 22], xp: 14, pack: true,
      specials: [{ at: 5, name: 'Bone Shatter', mult: 1.25, aoe: true, desc: 'rattles ominously' }] },
    { id: 'cursed_knight', name: 'Cursed Knight', glyph: '⚔️', hp: 56, atk: 12, def: 6, spd: 5, gold: [18, 32], xp: 20, elite: true, intelligent: true,
      specials: [{ at: 4, name: 'Oathbreaker\'s Arc', mult: 1.35, aoe: true, weaken: 0.4, desc: 'raises a blackened blade' }, { at: 6, name: 'Grave Oath', mult: 2.0, frailSure: true, desc: 'the armor begins to weep' }] },
    { id: 'shade', name: 'Weeping Shade', glyph: '👻', hp: 36, atk: 11, def: 1, spd: 10, gold: [10, 20], xp: 15,
      specials: [{ at: 4, name: 'Wail', mult: 1.2, aoe: true, desc: 'draws a breath it doesn\'t need' }] },
    { id: 'scarab', name: 'Tomb Scarab Swarm', glyph: '🪲', hp: 34, atk: 9, def: 2, spd: 8, gold: [8, 18], xp: 12, pack: true },
    { id: 'golem', name: 'Broken Golem', glyph: '🗿', hp: 70, atk: 11, def: 8, spd: 1, gold: [20, 36], xp: 22, elite: true,
      specials: [{ at: 3, name: 'Grindstone Fist', mult: 1.6, desc: 'gears shriek inside it' }, { at: 5, name: 'Quake Stomp', mult: 1.35, aoe: true, desc: 'the floor remembers it was a temple' }] },
    { id: 'acolyte', name: 'Hollow Acolyte', glyph: '🕯️', hp: 32, atk: 12, def: 2, spd: 7, gold: [14, 26], xp: 16, caster: true, intelligent: true,
      specials: [{ at: 4, name: 'Hollow Litany', mult: 1.25, aoe: true, desc: 'chants in a dead tongue' }] },
    { id: 'wight', name: 'Barrow Wight', glyph: '🧟', hp: 46, atk: 11, def: 4, spd: 5, gold: [16, 28], xp: 18, lifesteal: 0.25,
      specials: [{ at: 4, name: 'Grave Grip', mult: 1.5, desc: 'cold fingers find your throat' }] },
    { id: 'horned_stalker', name: 'Horned Stalker', glyph: '👹', hp: 52, atk: 13, def: 4, spd: 7, gold: [16, 30], xp: 19,
      specials: [{ at: 4, name: 'Chestgaze', mult: 1.5, desc: 'the eyes on its ribs open' }] },
    { id: 'void_eye', name: 'Void Eye', glyph: '🧿', hp: 62, atk: 14, def: 3, spd: 9, gold: [18, 32], xp: 20, caster: true, elite: true,
      specials: [{ at: 3, name: 'Warp Beam', mult: 1.55, confused: 0.5, desc: 'the central pupil dilates' }, { at: 6, name: 'Unmake', mult: 1.9, aoe: true, tormentedSure: true, desc: 'space forgets how to hold you' }] },
  ],
  frost: [
    { id: 'wraith', name: 'Ice Wraith', glyph: '❄️', hp: 44, atk: 13, def: 4, spd: 10, gold: [16, 30], xp: 20, freeze: 0.3,
      specials: [{ at: 4, name: 'Flash Freeze', mult: 1.3, freezeSure: true, desc: 'the air crystallizes' }] },
    { id: 'frost_giant', name: 'Frost Giant', glyph: '🧊', hp: 80, atk: 14, def: 8, spd: 2, gold: [26, 44], xp: 30, elite: true, intelligent: true,
      specials: [{ at: 4, name: 'Avalanche Swing', mult: 1.4, aoe: true, desc: 'hefts a club the size of a door' }] },
    { id: 'winter_wolf', name: 'Winter Wolf', glyph: '🐺', hp: 48, atk: 14, def: 4, spd: 10, gold: [18, 30], xp: 22, pack: true,
      specials: [{ at: 5, name: 'Killing Cold Howl', mult: 1.25, aoe: true, desc: 'breath steams with intent' }] },
    { id: 'ice_maiden', name: 'Court Ice-Maiden', glyph: '👑', hp: 44, atk: 14, def: 4, spd: 9, gold: [22, 38], xp: 24, caster: true, freeze: 0.35, intelligent: true,
      specials: [{ at: 3, name: 'Courtly Spite', mult: 1.5, freezeSure: true, desc: 'smiles with December behind it' }] },
    { id: 'frozen_soldier', name: 'Frozen Soldier', glyph: '🛡️', hp: 56, atk: 12, def: 8, spd: 3, gold: [18, 32], xp: 22, pack: true,
      specials: [{ at: 4, name: 'Shield Wall', mult: 1.35, desc: 'ice cracks along the kite shield' }] },
    { id: 'yeti', name: 'Glacial Yeti', glyph: '🦍', hp: 76, atk: 14, def: 6, spd: 4, gold: [24, 40], xp: 28, elite: true, freeze: 0.25,
      specials: [{ at: 5, name: 'Avalanche Slam', mult: 1.4, aoe: true, desc: 'raises both fists overhead' }] },
    { id: 'void_specter', name: 'Rime Specter', glyph: '👻', hp: 44, atk: 13, def: 3, spd: 11, gold: [20, 34], xp: 23, freeze: 0.4, caster: true,
      specials: [{ at: 4, name: 'Pale Howl', mult: 1.2, aoe: true, desc: 'the cold gains a voice' }] },
  ],
  swamp: [
    { id: 'hag', name: 'Mire Hag', glyph: '🧙', hp: 54, atk: 16, def: 5, spd: 7, gold: [24, 42], xp: 30, caster: true, intelligent: true,
      specials: [{ at: 3, name: 'Curdling Hex', mult: 1.5, weakenSure: true, desc: 'mutters your name backwards' }, { at: 6, name: 'The Old Recipe', mult: 1.9, aoe: true, lazy: 0.45, desc: 'the cauldron boils over' }] },
    { id: 'croc', name: 'Bog Render', glyph: '🐊', hp: 72, atk: 18, def: 7, spd: 5, gold: [22, 40], xp: 32,
      specials: [{ at: 5, name: 'Death Roll', mult: 1.9, desc: 'jaws widen past reason' }] },
    { id: 'leech', name: 'Giant Leech', glyph: '🪱', hp: 48, atk: 15, def: 3, spd: 6, gold: [16, 30], xp: 24, lifesteal: 0.45, pack: true },
    { id: 'will_o_wisp', name: 'Will-o\'-Wisp', glyph: '🔥', hp: 38, atk: 15, def: 2, spd: 12, gold: [20, 36], xp: 26, caster: true,
      specials: [{ at: 4, name: 'False Dawn', mult: 1.25, aoe: true, desc: 'burns suddenly brighter' }] },
    { id: 'troll', name: 'Moss Troll', glyph: '👹', hp: 96, atk: 17, def: 8, spd: 2, gold: [30, 52], xp: 38, elite: true, regen: 0.05, intelligent: true,
      specials: [{ at: 4, name: 'Uproot & Swing', mult: 1.5, aoe: true, desc: 'tears a sapling loose' }] },
    { id: 'mire_abomination', name: 'Mire Abomination', glyph: '👁', hp: 86, atk: 17, def: 6, spd: 3, gold: [28, 48], xp: 36, elite: true, poison: 0.35, regen: 0.03,
      specials: [{ at: 3, name: 'Toxic Gaze', mult: 1.4, poisonSure: true, desc: 'three eyes blink in wrong order' }, { at: 6, name: 'Green Miasma', mult: 1.75, aoe: true, poisonSure: true, desc: 'the aura thickens into weather' }] },
  ],
  hell: [
    { id: 'imp', name: 'Cinder Imp', glyph: '👺', hp: 50, atk: 17, def: 5, spd: 11, gold: [26, 46], xp: 34, pack: true, burn: 0.25, intelligent: true,
      specials: [{ at: 5, name: 'Spitfire Tantrum', mult: 1.2, aoe: true, burnSure: true, desc: 'giggles and ignites' }] },
    { id: 'hellhound', name: 'Hellhound', glyph: '🐕‍🦺', hp: 62, atk: 18, def: 5, spd: 10, gold: [28, 48], xp: 38, pack: true, burn: 0.3,
      specials: [{ at: 4, name: 'Immolating Lunge', mult: 1.6, burnSure: true, desc: 'flame gutters between its teeth' }] },
    { id: 'tormentor', name: 'Chain Tormentor', glyph: '⛓️', hp: 78, atk: 19, def: 7, spd: 5, gold: [34, 56], xp: 44, elite: true, intelligent: true,
      specials: [{ at: 3, name: 'Lash Volley', mult: 1.3, aoe: true, frail: 0.4, desc: 'chains rise like serpents' }, { at: 6, name: 'Penance', mult: 2.0, tormentedSure: true, desc: 'selects an instrument with care' }] },
    { id: 'pit_mage', name: 'Pit Magus', glyph: '🔮', hp: 58, atk: 20, def: 5, spd: 8, gold: [32, 54], xp: 42, caster: true, burn: 0.35, intelligent: true,
      specials: [{ at: 4, name: 'Brimstone Sermon', mult: 1.5, aoe: true, burnSure: true, desc: 'opens a book that screams' }] },
    { id: 'brute', name: 'Obsidian Brute', glyph: '🌋', hp: 100, atk: 20, def: 10, spd: 3, gold: [38, 64], xp: 50, elite: true,
      specials: [{ at: 5, name: 'Magma Haymaker', mult: 1.45, aoe: true, desc: 'knuckles glow white-hot' }] },
    { id: 'sin_eater', name: 'Sin-Eater', glyph: '👄', hp: 70, atk: 19, def: 6, spd: 9, gold: [34, 58], xp: 46, lifesteal: 0.28, intelligent: true,
      specials: [{ at: 3, name: 'Devour', mult: 1.6, heal: 0.08, desc: 'unhinges a doorway of a mouth' }] },
    { id: 'magma_golem', name: 'Magma Golem', glyph: '🪨', hp: 95, atk: 19, def: 11, spd: 2, gold: [36, 60], xp: 48, elite: true, burn: 0.25,
      specials: [{ at: 3, name: 'Furnace Punch', mult: 1.65, burnSure: true, desc: 'fists glow white' }, { at: 5, name: 'Furnace Burst', mult: 1.35, aoe: true, burnSure: true, desc: 'vents a wave of slag-heat' }] },
    { id: 'eye_horror', name: 'Eye Horror', glyph: '👀', hp: 74, atk: 20, def: 5, spd: 6, gold: [32, 54], xp: 45, caster: true, elite: true,
      specials: [{ at: 3, name: 'Burning Gaze', mult: 1.45, burnSure: true, desc: 'eight pupils ignite' }, { at: 6, name: 'Chorus of Sight', mult: 1.9, aoe: true, confusedSure: true, desc: 'every eye speaks a different doom' }] },
    { id: 'crimson_wretch', name: 'Crimson Wretch', glyph: '🩸', hp: 58, atk: 18, def: 4, spd: 10, gold: [28, 50], xp: 40, lifesteal: 0.25, pack: true,
      specials: [{ at: 4, name: 'Frenzy Bite', mult: 1.55, heal: 0.06, desc: 'bloodshot eyes lock on' }] },
    { id: 'slag_knight', name: 'Slag Knight', glyph: '⚔️', hp: 88, atk: 20, def: 9, spd: 4, gold: [36, 62], xp: 50, elite: true, intelligent: true, burn: 0.18,
      specials: [{ at: 3, name: 'Molten Arc', mult: 1.35, aoe: true, desc: 'a blade of cooling iron swings' }, { at: 6, name: 'Core Detonation', mult: 1.55, aoe: true, burnSure: true, desc: 'the chest-runes overbrighten' }] },
  ],
};

// One boss guards the gate out of each biome. Boss initiative matches
// identity (§14): trees and hydras are slow; dukes and kings are fast.
// ATK bases sit well above mimic-tier threats — DEF should never leave a
// boss swinging for single-digit damage at the end of a biome.
export const BOSSES = {
  10: {
    id: 'elderwood', name: 'The Elderwood Guardian', glyph: '🌲', biome: 'forest',
    // Scaled ~200 HP; DEF keeps solo HTK ~7–9 turns. Co-op pads via partyBossHpMult.
    hp: 190, atk: 27, def: 4, spd: 3, gold: [60, 90], xp: 60, regen: 0.02, boss: true,
    chargeGain: 1,
    specials: [
      { at: 3, name: 'Limb Sweep', mult: 1.35, aoe: true, desc: 'branches groan overhead' },
      { at: 5, name: 'Falling Canopy', mult: 1.55, aoe: true, desc: 'the whole crown comes down' },
      { at: 6, name: 'FOREST\'S VERDICT', mult: 2.0, desc: 'ten thousand judged climbers watch through its rings' },
    ],
    intro: 'The oldest tree in the forest uproots itself. It has judged ten thousand climbers.\nIt has approved of none.',
    taunt: 'YOU BURN LIKE ALL THE REST.',
  },
  // A midboss, not a gate: he sits mid-biome between the Guardian and the Lich,
  // so he's tuned under the F20 curve. Adding the key is all it takes — game.js
  // derives BOSS_FLOORS from BOSSES, so F15 routes to the boss floor (taking the
  // slot the every-5th-floor trial used to hold) and F14 becomes a campfire.
  15: {
    id: 'crowned_revenant', name: 'The Crowned Revenant', glyph: '🗡️', biome: 'ruins',
    hp: 260, atk: 26, def: 5, spd: 6, gold: [75, 110], xp: 75, boss: true,
    chargeGain: 1,
    specials: [
      { at: 3, name: 'Oathbreaker', mult: 1.35, desc: 'the greatsword drags a line through the dust' },
      { at: 4, name: 'Ring of Ash', mult: 1.4, aoe: true, desc: 'the crown sheds a burning halo' },
      { at: 6, name: 'CROWN OF ASH', mult: 1.85, desc: 'the dead king remembers he was crowned' },
    ],
    intro: 'A knight kneels in the dust, greatsword planted, crown fused to the helm.\nHe has knelt here for six hundred years, waiting for a king who never came.\nHe stands up for you.',
    taunt: 'I KEPT MY OATH. WHERE IS YOURS?',
  },
  20: {
    id: 'lich', name: 'Lich of the Fallen King', glyph: '👑', biome: 'ruins',
    hp: 340, atk: 30, def: 7, spd: 8, gold: [90, 130], xp: 90, caster: true, summons: 'skeleton', boss: true,
    chargeGain: 1,
    specials: [
      { at: 3, name: 'Soul Tithe', mult: 1.4, heal: 0.06, weaken: 0.5, desc: 'the crown\'s lights burn colder' },
      { at: 4, name: 'Court of Bones', mult: 1.35, aoe: true, frail: 0.4, desc: 'the floor remembers its subjects' },
      { at: 6, name: 'DYNASTY\'S END', mult: 1.7, aoe: true, tormentedSure: true, desc: 'six hundred years of grievance condenses' },
    ],
    intro: 'A crown floats above a throne of dust. Beneath it, two cold lights ignite.\n"Kneel. My kingdom needs subjects."',
    taunt: 'DEATH IS A DOOR. I AM THE KEY.',
  },
  30: {
    id: 'frost_queen', name: 'Queen Vessalia the Unmelting', glyph: '❄️', biome: 'frost',
    hp: 395, atk: 37, def: 10, spd: 9, gold: [120, 170], xp: 130, boss: true,
    // Freeze is a court decree, not every swing — pulse every 4 of her turns.
    freezeEvery: 4,
    cleanseCost: 3, // harder to burn FOC out of ice than most bosses
    chargeGain: 1,
    specials: [
      { at: 3, name: 'Glacial Decree', mult: 1.35, desc: 'the temperature plummets' },
      { at: 4, name: 'Courtly Reproach', mult: 1.4, aoe: true, desc: 'the frozen court exhales as one' },
      { at: 6, name: 'ETERNAL WINTER', mult: 1.75, aoe: true, desc: 'the court\'s frozen betrayers turn their heads in unison' },
    ],
    intro: 'The Frost Queen does not rise from her throne. She merely opens her eyes,\nand the temperature of your blood becomes negotiable.',
    taunt: 'WINTER OUTLASTS EVERYTHING. EVEN HOPE.',
  },
  40: {
    id: 'hydra', name: 'The Grieving Hydra', glyph: '🐉', biome: 'swamp',
    hp: 550, atk: 38, def: 12, spd: 4, gold: [160, 220], xp: 180, regen: 0.02, heads: true, boss: true,
    chargeGain: 1,
    specials: [
      { at: 3, name: 'Threefold Snap', mult: 1.4, poisonSure: true, desc: 'three heads inhale together' },
      { at: 4, name: 'Threefold Breath', mult: 1.45, aoe: true, frail: 0.45, desc: 'three throats glow at once' },
      { at: 6, name: 'SORROW UNENDING', mult: 1.85, aoe: true, tormentedSure: true, desc: 'the weeping head finally screams' },
    ],
    intro: 'Three heads surface from the black water. One weeps. One laughs.\nThe third simply opens its jaws.',
    taunt: 'CUT ONE SORROW DOWN. TWO MORE RISE.',
  },
  50: {
    id: 'infernal_duke', name: 'Duke Malgrimm, Gatekeeper of the Throne', glyph: '😈', biome: 'hell',
    hp: 655, atk: 40, def: 14, spd: 10, gold: [220, 300], xp: 250, burn: 0.22, boss: true,
    chargeGain: 1,
    specials: [
      { at: 3, name: 'Sword of Swords', mult: 1.5, weaken: 0.45, desc: 'the blades within his blade align' },
      { at: 4, name: 'Bladestorm Toll', mult: 1.45, aoe: true, frail: 0.4, desc: 'the sword of swords fans open' },
      { at: 6, name: 'GATEKEEPER\'S TOLL', mult: 1.9, aoe: true, burnSure: true, tormented: 0.5, desc: 'he stops being polite about it' },
    ],
    intro: '"Fifty floors," the Duke muses, drawing a sword made of other swords.\n"Impressive. The King will want to kill you personally. Let\'s disappoint him."',
    taunt: 'THE THRONE IS A PRIVILEGE. DYING HERE IS FREE.',
  },
  // Default throne: Spike Sovereign. The two-phase slime→king Vorath fight lives
  // on ALT_BOSSES[51] (~50% via pickBossForFloor).
  51: {
    id: 'ashen_sovereign', name: 'ASHKAR, THE SPIKE SOVEREIGN', glyph: '🔥', biome: 'throne',
    hp: 640, atk: 43, def: 14, spd: 12, gold: [0, 0], xp: 0, phases: true, boss: true, burn: 0.35,
    chargeGain: 1, chargeOnPhase: 2,
    cleanseCost: 1,
    specials: [
      { at: 3, name: 'Crystal Coronation', mult: 1.55, burnSure: true, desc: 'spine-crystals bloom from its mane' },
      { at: 4, name: 'Spike Bloom', mult: 1.5, aoe: true, desc: 'crystals erupt in a widening ring' },
      { at: 6, name: 'THE THRONE REMEMBERS SPIKES', mult: 2.1, aoe: true, desc: 'the room itself chooses a side — puncture' },
    ],
    intro: 'Something older than names sits the throne — a sovereign of spikes and molten light.\n"Interesting," it says, and the air crystallizes into knives.',
    taunt: 'KINGS ARE TEMPORARY. SPIKES ARE FOREVER.',
  },
};

// One alternate gatekeeper per world (and the throne). Seeded pick — same
// run always faces the same boss once chosen. Unique art from NEW_ASSETS packs.
export const ALT_BOSSES = {
  10: {
    id: 'heartwood', name: 'The Thornbeast', glyph: '🦔', biome: 'forest',
    hp: 190, atk: 27, def: 5, spd: 2, gold: [60, 90], xp: 60, regen: 0.025, boss: true,
    chargeGain: 1,
    specials: [
      { at: 3, name: 'Bristle Storm', mult: 1.4, aoe: true, desc: 'spines fan out like a crown' },
      { at: 5, name: 'Quill Nova', mult: 1.6, aoe: true, desc: 'the whole hide fires at once' },
      { at: 6, name: 'CANOPY IMPALE', mult: 1.9, desc: 'every thorn remembers a climber' },
    ],
    intro: 'Where the Guardian judges with rings, this beast judges with spines.\nIt has been waiting under the roots for something soft enough to pierce.',
    taunt: 'THE FOREST WEARS ME LIKE ARMOR.',
  },
  20: {
    id: 'ossuary_king', name: 'The Void Oracle', glyph: '🧿', biome: 'ruins',
    hp: 340, atk: 30, def: 8, spd: 7, gold: [90, 130], xp: 90, caster: true, summons: 'skeleton', boss: true,
    chargeGain: 1,
    specials: [
      { at: 3, name: 'Pupil Tax', mult: 1.35, heal: 0.05, desc: 'the central eye drinks a memory' },
      { at: 4, name: 'Witness Wave', mult: 1.4, aoe: true, desc: 'every lesser eye opens on someone' },
      { at: 6, name: 'CATACOMB UNMAKING', mult: 1.8, aoe: true, desc: 'the ruins forget they were ever solid' },
    ],
    intro: 'A floating knot of eyes and claws hangs above the ossuary.\n"I do not need subjects," it whispers without a mouth. "I need witnesses."',
    taunt: 'BLINK AND YOU ARE ALREADY BONE.',
  },
  30: {
    id: 'jarl_whitegrave', name: 'Jarl of the White Grave', glyph: '🧊', biome: 'frost',
    hp: 395, atk: 35, def: 11, spd: 4, gold: [120, 170], xp: 130, boss: true, freeze: 0.35,
    freezeEvery: 3,
    cleanseCost: 3,
    chargeGain: 1,
    specials: [
      { at: 3, name: 'Grave Hail', mult: 1.4, aoe: true, desc: 'ice axes peel from the ceiling' },
      { at: 5, name: 'Glacier\'s Answer', mult: 1.6, aoe: true, desc: 'the stair itself calves and falls' },
      { at: 6, name: 'WHITE FUNERAL', mult: 1.85, freezeSure: true, desc: 'the jarl raises a horn that freezes the breath in your lungs' },
    ],
    intro: 'A horned abomination in a stolen coronet blocks the citadel stair.\nThe Queen\'s court may scheme; this jarl simply ends arguments.',
    taunt: 'THE GRAVE IS WARM COMPARED TO ME.',
  },
  40: {
    // Multi-phase: starts as a slime prince, evolves into the demon-slime cleaver.
    id: 'bogmother', name: 'The Putrid Prince', glyph: '🟢', biome: 'swamp',
    hp: 550, atk: 38, def: 11, spd: 5, gold: [160, 220], xp: 180, poison: 0.35, boss: true,
    phases: true, summons: 'slime', chargeGain: 1, chargeOnPhase: 2,
    phaseArt: 'demon_slime',
    phaseName: 'PRINCE OF THE INFERNAL SLIME',
    phaseGlyph: '😈',
    phaseText: 'The slime splits — and a horned cleaver-fiend climbs out of itself.',
    phaseSpecials: [
      { at: 3, name: 'Molten Cleave', mult: 1.55, burnSure: true, desc: 'the cleaver drinks swamp-fire' },
      { at: 6, name: 'THRONE OF OOZE', mult: 2.0, aoe: true, burnSure: true, desc: 'every droplet becomes a blade' },
    ],
    specials: [
      { at: 3, name: 'Acid Coronation', mult: 1.4, poisonSure: true, desc: 'the blob crowns itself in fumes' },
      { at: 4, name: 'Regal Spray', mult: 1.4, aoe: true, poisonSure: true, desc: 'the realm rains sideways' },
      { at: 6, name: 'ROYAL SPLATTER', mult: 1.75, aoe: true, poisonSure: true, desc: 'the prince bursts — on purpose' },
    ],
    intro: 'A crown of moss floats atop a quivering green mass blocking the causeway.\n"Bow," it burps, somehow regal. "Or become part of the realm."',
    taunt: 'EVERY KINGDOM STARTS AS A PUDDLE.',
  },
  50: {
    id: 'arch_tormentor', name: 'Arch-Cyclops Vex', glyph: '🔥', biome: 'hell',
    hp: 655, atk: 40, def: 14, spd: 9, gold: [220, 300], xp: 250, burn: 0.28, boss: true, summons: 'imp',
    chargeGain: 1,
    specials: [
      { at: 3, name: 'Solar Pupil', mult: 1.45, burnSure: true, desc: 'the chest-eye overcharges' },
      { at: 4, name: 'Cinder Sweep', mult: 1.45, aoe: true, desc: 'the beam drags across the whole line' },
      { at: 6, name: 'PENANCE ABSOLUTE', mult: 2.0, aoe: true, burnSure: true, desc: 'Vex selects a beam meant for kings' },
    ],
    intro: 'The Duke is elsewhere. In his place: a horned cyclops of slag and flame,\npolishing the glow in its chest like a favorite hymn. "Malgrimm sends regrets," it says. "I do not."',
    taunt: 'THE THRONE CAN WAIT. YOUR ASH CANNOT.',
  },
  // Two-phase alternate final boss (~50%). Shed-blood slime shell, then the true
  // Demon King with a fresh bar (combat.js `twoPhase`). Total HP matches the old
  // single-bar tuning. Distinct from ≤50% `phases` enrage — which the king keeps.
  51: {
    id: 'demon_king', name: 'VORATH — SHED BLOOD', glyph: '🩸', artId: 'demon_slime', biome: 'throne',
    // Two bars ≈ ~1100 scaled total (shell + king).
    hp: 260, atk: 44, def: 12, spd: 11, gold: [0, 0], xp: 0, boss: true, twoPhase: true,
    chargeGain: 1,
    specials: [
      { at: 3, name: 'Hemorrhage', mult: 1.4, desc: 'the mass splits and lashes outward' },
      { at: 4, name: 'Arterial Lash', mult: 1.4, aoe: true, desc: 'whips of blood find every climber' },
      { at: 6, name: 'CRIMSON TIDE', mult: 1.9, aoe: true, desc: 'a wave of boiling blood swells to the ceiling' },
    ],
    intro: 'The throne room is wrong. No king — only a churning mass of blood that stands up\nand turns its many eyes on you. "He will see you," it gurgles, "if you are worth the walk."',
    taunt: 'YOU ARE NOT WORTH HIS HANDS. YET.',
    phase2: {
      artId: 'demon_king', name: 'VORATH, THE DEMON KING', glyph: '🜏',
      hp: 380, atk: 46, def: 16, spd: 11, chargeGain: 1, chargeOnPhase: 2, phases: true, cleanseCost: 1,
      specials: [
        { at: 3, name: 'Century\'s Edge', mult: 1.5, desc: 'his blade remembers every hero it has ended' },
        { at: 4, name: 'Kingdom\'s Weight', mult: 1.5, aoe: true, desc: 'the throne room leans on all of you' },
        { at: 6, name: 'THE KING\'S QUESTION', mult: 2.0, aoe: true, desc: 'the air itself takes his side' },
      ],
      taunt: 'I HAVE KILLED HEROES WITH BETTER STATS THAN YOURS.',
      transformText: 'The blood boils upward and FOLDS into a shape that remembers being a king.\nVorath sets down his book, marks his page, and finally stands.\n"Every century, one of you reaches this room. You are the first to make me rise.\nAre you the interesting kind?"',
    },
  },
};

/** Resolve which boss appears on a boss floor (seeded; sticky per run). */
export function pickBossForFloor(floor, rng, run) {
  if (!run.bossPicks) run.bossPicks = {};
  if (run.bossPicks[floor]) {
    const id = run.bossPicks[floor];
    if (BOSSES[floor]?.id === id) return BOSSES[floor];
    if (ALT_BOSSES[floor]?.id === id) return ALT_BOSSES[floor];
  }
  const primary = BOSSES[floor];
  const alt = ALT_BOSSES[floor];
  const pick = alt && rng.chance(0.5) ? alt : primary;
  if (pick) run.bossPicks[floor] = pick.id;
  return pick || primary;
}

export function bossById(id) {
  for (const b of Object.values(BOSSES)) if (b.id === id) return b;
  for (const b of Object.values(ALT_BOSSES)) if (b.id === id) return b;
  return null;
}

/** Event / social NPCs — harder than mimics at the same floor (elite-leaning). */
export const NPC_ENEMIES = {
  // Knight Hero Platformer pack (anim/warrior) — social duel NPC.
  blade_hero: {
    id: 'blade_hero', name: 'Oathbound Champion', glyph: '⚔️', hp: 50, atk: 11, def: 3, spd: 7,
    gold: [28, 48], xp: 22, intelligent: true, elite: true,
    specials: [
      { at: 3, name: 'Oath Swing', mult: 1.55, desc: 'raises a well-kept blade' },
      { at: 5, name: 'Shield Answer', mult: 1.35, desc: 'plants and answers' },
    ],
  },
  // Blue-mage pack (anim/mage) — a scholar who slid into forbidden work.
  dark_mage: {
    id: 'dark_mage', name: 'Apostate Channeler', glyph: '🔮', hp: 44, atk: 12, def: 2, spd: 8,
    gold: [30, 52], xp: 24, caster: true, intelligent: true, elite: true,
    specials: [
      { at: 3, name: 'Black Margin', mult: 1.45, aoe: true, desc: 'ink-smoke curls into a hex' },
      { at: 5, name: 'Unwritten Name', mult: 1.7, desc: 'whispers something the tower forgot' },
    ],
  },
  pathfinder_veteran: {
    id: 'pathfinder_veteran', name: 'Pathfinder Veteran', glyph: '🏹', hp: 44, atk: 11, def: 2, spd: 10,
    gold: [26, 46], xp: 23, intelligent: true, elite: true,
    specials: [{ at: 3, name: 'Trail Shot', mult: 1.6, desc: 'nocks without looking' }],
  },
  // Pre-bob Viking class look (viking_axe_pack idle strip).
  axe_northman: {
    id: 'axe_northman', name: 'Axe-Pack Veteran', glyph: '🪓', hp: 54, atk: 12, def: 3, spd: 6,
    gold: [34, 58], xp: 26, intelligent: true, elite: true,
    specials: [{ at: 4, name: 'Bearded Cleave', mult: 1.75, desc: 'hefts an axe that remembers coastlines' }],
  },
  farmer_a: {
    id: 'farmer_a', name: 'Stubborn Farmer', glyph: '🌾', hp: 26, atk: 5, def: 1, spd: 5,
    gold: [4, 10], xp: 7, pack: true, intelligent: true,
    specials: [{ at: 4, name: 'Pitchfork Prod', mult: 1.35, desc: 'levels a pitchfork' }],
  },
  farmer_b: {
    id: 'farmer_b', name: 'Orchard Hand', glyph: '🍎', hp: 24, atk: 5, def: 1, spd: 6,
    gold: [4, 9], xp: 6, pack: true, intelligent: true,
    specials: [{ at: 4, name: 'Basket Swing', mult: 1.3, desc: 'swings a heavy basket' }],
  },
  farmer_c: {
    id: 'farmer_c', name: 'Mill Hand', glyph: '🌽', hp: 28, atk: 6, def: 1, spd: 4,
    gold: [5, 11], xp: 7, pack: true, intelligent: true,
    specials: [{ at: 5, name: 'Sack Toss', mult: 1.4, desc: 'hefts a grain sack' }],
  },
  farmer_d: {
    id: 'farmer_d', name: 'Field Watch', glyph: '🥕', hp: 25, atk: 5, def: 1, spd: 6,
    gold: [4, 10], xp: 6, pack: true, intelligent: true,
    specials: [{ at: 4, name: 'Scarecrow Feint', mult: 1.25, stun: 0.25, desc: 'feints like a scarecrow' }],
  },
  farmer_e: {
    id: 'farmer_e', name: 'Dairy Hand', glyph: '🧀', hp: 27, atk: 5, def: 2, spd: 4,
    gold: [5, 10], xp: 7, pack: true, intelligent: true,
    specials: [{ at: 4, name: 'Churn Bash', mult: 1.35, desc: 'brandishes a churn' }],
  },
  farmer_f: {
    id: 'farmer_f', name: 'Hedge Witch\'s Kin', glyph: '🌿', hp: 24, atk: 6, def: 1, spd: 7,
    gold: [5, 12], xp: 8, pack: true, intelligent: true, caster: true,
    specials: [{ at: 3, name: 'Hedge Pinch', mult: 1.3, poisonSure: true, desc: 'pins a bitter leaf' }],
  },
  roadside_npc: {
    id: 'roadside_npc', name: 'Roadside Climber', glyph: '🧳', hp: 46, atk: 10, def: 3, spd: 7,
    gold: [24, 44], xp: 20, intelligent: true, elite: true,
    specials: [{ at: 3, name: 'Trail Bargain', mult: 1.5, desc: 'draws a travel blade' }],
  },
  roadside_npc2: {
    id: 'roadside_npc2', name: 'Wandering Hireling', glyph: '🗡️', hp: 44, atk: 11, def: 2, spd: 8,
    gold: [26, 46], xp: 21, intelligent: true, elite: true,
    specials: [{ at: 3, name: 'Contract Cut', mult: 1.55, desc: 'honors a bloody clause' }],
  },
  oldman_gentle: {
    id: 'oldman_gentle', name: 'Kindly Elder', glyph: '🧓', hp: 40, atk: 8, def: 2, spd: 6,
    gold: [20, 40], xp: 18, intelligent: true,
    specials: [{ at: 4, name: 'Cane Tap', mult: 1.35, desc: 'taps the cane once' }],
  },
  oldman_wrath: {
    id: 'oldman_wrath', name: 'Trialmaster', glyph: '⚡', hp: 95, atk: 16, def: 5, spd: 9,
    gold: [80, 140], xp: 55, intelligent: true, elite: true, boss: true,
    specials: [
      { at: 3, name: 'Lesson One', mult: 1.6, desc: 'the cane becomes a verdict' },
      { at: 6, name: 'Final Examination', mult: 2.1, aoe: true, stun: 0.25, desc: 'the air itself quizzes you' },
    ],
  },
};

export function findEnemySpec(id) {
  if (NPC_ENEMIES[id]) return NPC_ENEMIES[id];
  for (const pool of Object.values(ENEMIES)) {
    const found = pool.find(e => e.id === id);
    if (found) return found;
  }
  return bossById(id);
}

// Trial-floor battle modifiers (every 5th non-boss floor).
export const MODIFIERS = [
  { id: 'ambush', name: 'Ambush!', desc: 'Enemies strike first this battle.', enemyFirst: true },
  { id: 'thirsting_ground', name: 'Thirsting Ground', desc: 'The floor drinks: lose 3% max HP at the end of each round.', hpDrainPct: 0.03 },
  { id: 'blood_moon', name: 'Blood Moon', desc: 'Everyone deals +40% damage. Everyone.', dmgMult: 1.4 },
  { id: 'mana_void', name: 'Null Field', desc: 'Skills cost +50% class resource this battle.', costMult: 1.5 },
  { id: 'gilded', name: 'Gilded Foes', desc: 'Enemies are tougher but drop triple gold.', hpMult: 1.2, goldMult: 3 },
  { id: 'horde', name: 'The Horde', desc: 'An extra enemy joins the fray.', extraEnemy: true },
  { id: 'swarm', name: 'The Swarm', desc: 'Two extra enemies join the fray — each a little thinner-blooded.', extraEnemy: 2, hpMult: 0.85 },
  { id: 'surging', name: 'Surging Air', desc: 'Everyone gains Battle Charge twice as fast. Everyone.', chargeMult: 2 },
];
