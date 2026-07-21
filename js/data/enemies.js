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

import { ROSTER } from './roster_worlds.js';
import { GALLERY_ENEMIES, GALLERY_WANDERING, GALLERY_BOSSES, GALLERY_NPCS } from './gallery_units.js';

const PLACEHOLDER_IDS = new Set(ROSTER.placeholders || []);

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
      specials: [{ at: 4, name: 'Savage Pounce', mult: 1.6, frail: 0.45, desc: 'lunges for the throat' }] },
    { id: 'sprite', name: 'Feral Sprite', glyph: '🧚', hp: 28, atk: 5, def: 0, spd: 11, gold: [8, 16], xp: 9, caster: true, intelligent: true,
      specials: [{ at: 4, name: 'Glimmer Burst', mult: 1.25, aoe: true, confused: 0.35, desc: 'gathers stolen light' }] },
    { id: 'boar', name: 'Ironback Boar', glyph: '🐗', hp: 38, atk: 7, def: 2, spd: 4, gold: [7, 15], xp: 12,
      specials: [{ at: 5, name: 'Full Gore', mult: 1.8, stun: 0.45, desc: 'paws the ground' }] },
    { id: 'bandit', name: 'Forest Bandit', glyph: '🗡️', hp: 31, atk: 7, def: 1, spd: 7, gold: [14, 28], xp: 12, pack: true, intelligent: true,
      specials: [{ at: 4, name: 'Dirty Trick', mult: 1.4, stun: 0.4, desc: 'palms something glinting' }] },
    { id: 'treant', name: 'Young Treant', glyph: '🌳', hp: 52, atk: 8, def: 4, spd: 2, gold: [10, 20], xp: 16, elite: true,
      specials: [{ at: 4, name: 'Rootquake', mult: 1.3, aoe: true, lazy: 0.4, desc: 'roots coil beneath everyone' }] },
    { id: 'spider', name: 'Widow Spider', glyph: '🕷️', hp: 26, atk: 6, def: 1, spd: 9, gold: [6, 13], xp: 10, poison: 0.4,
      specials: [{ at: 4, name: 'Venom Flood', mult: 1.3, poisonSure: true, desc: 'fangs drip freely' }] },
    { id: 'myconid', name: 'Sporeback Myconid', glyph: '🍄', hp: 34, atk: 6, def: 2, spd: 5, gold: [7, 15], xp: 11, poison: 0.5,
      specials: [{ at: 4, name: 'Spore Bloom', mult: 1.2, aoe: true, poisonSure: true, desc: 'caps swell with spores' }] },
    { id: 'vampire', name: 'Pale Wanderer', glyph: '🧛', hp: 44, atk: 9, def: 2, spd: 9, gold: [18, 34], xp: 18, lifesteal: 0.4, intelligent: true, elite: true,
      specials: [{ at: 3, name: 'Crimson Draught', mult: 1.5, heal: 0.1, weaken: 0.5, desc: 'bares a red smile' }, { at: 6, name: 'Night\'s Embrace', mult: 1.45, aoe: true, heal: 0.1, frailSure: true, desc: 'the shadows lean in hungrily' }] },
    { id: 'rat', name: 'Tunnel Rat', glyph: '🐀', hp: 26, atk: 5, def: 0, spd: 12, gold: [4, 10], xp: 7, pack: true,
      specials: [{ at: 3, name: 'Nip Tendon', mult: 1.3, frail: 0.5, desc: 'darts for the ankles' }] },
    { id: 'slime', name: 'Grove Slime', glyph: '🟢', hp: 32, atk: 5, def: 2, spd: 3, gold: [5, 12], xp: 9, poison: 0.25, pack: true,
      specials: [{ at: 5, name: 'Acid Splash', mult: 1.2, aoe: true, poisonSure: true, desc: 'the blob ripples hungrily' }] },
    { id: 'orc', name: 'Woods Orc', glyph: '🪓', hp: 36, atk: 8, def: 2, spd: 5, gold: [12, 24], xp: 13, pack: true, intelligent: true,
      specials: [{ at: 5, name: 'Cleaving Chop', mult: 1.3, aoe: true, weaken: 0.4, desc: 'raises a notched axe' }] },
    { id: 'dusk_lurker', name: 'Dusk Lurker', glyph: '👁️', hp: 48, atk: 9, def: 3, spd: 8, gold: [16, 30], xp: 17, elite: true,
      specials: [{ at: 3, name: 'Tongue Lash', mult: 1.45, poison: 0.35, desc: 'something wet uncoils' }, { at: 5, name: 'Many-Eyed Stare', mult: 1.4, aoe: true, stun: 0.35, confused: 0.25, desc: 'too many pupils find you' }] },
  ],
  ruins: [
    { id: 'skeleton', name: 'Restless Skeleton', glyph: '💀', hp: 34, atk: 10, def: 3, spd: 6, gold: [12, 22], xp: 14, pack: true,
      specials: [{ at: 5, name: 'Bone Shatter', mult: 1.25, aoe: true, frail: 0.4, desc: 'rattles ominously' }] },
    { id: 'cursed_knight', name: 'Cursed Knight', glyph: '⚔️', hp: 56, atk: 12, def: 6, spd: 5, gold: [18, 32], xp: 20, elite: true, intelligent: true,
      specials: [{ at: 4, name: 'Oathbreaker\'s Arc', mult: 1.35, aoe: true, weaken: 0.4, desc: 'raises a blackened blade' }, { at: 6, name: 'Grave Oath', mult: 2.0, frailSure: true, desc: 'the armor begins to weep' }] },
    { id: 'shade', name: 'Weeping Shade', glyph: '👻', hp: 36, atk: 11, def: 1, spd: 10, gold: [10, 20], xp: 15,
      specials: [{ at: 4, name: 'Wail', mult: 1.2, aoe: true, confused: 0.4, desc: 'draws a breath it doesn\'t need' }] },
    { id: 'scarab', name: 'Tomb Scarab Swarm', glyph: '🪲', hp: 34, atk: 9, def: 2, spd: 8, gold: [8, 18], xp: 12, pack: true,
      specials: [{ at: 4, name: 'Burrowing Swarm', mult: 1.35, poison: 0.4, frail: 0.3, desc: 'carapaces click underfoot' }] },
    { id: 'golem', name: 'Broken Golem', glyph: '🗿', hp: 70, atk: 11, def: 8, spd: 1, gold: [20, 36], xp: 22, elite: true,
      specials: [{ at: 3, name: 'Grindstone Fist', mult: 1.6, stun: 0.5, desc: 'gears shriek inside it' }, { at: 5, name: 'Quake Stomp', mult: 1.35, aoe: true, lazy: 0.4, desc: 'the floor remembers it was a temple' }] },
    { id: 'acolyte', name: 'Hollow Acolyte', glyph: '🕯️', hp: 32, atk: 12, def: 2, spd: 7, gold: [14, 26], xp: 16, caster: true, intelligent: true,
      specials: [{ at: 4, name: 'Hollow Litany', mult: 1.25, aoe: true, weaken: 0.4, desc: 'chants in a dead tongue' }] },
    { id: 'wight', name: 'Barrow Wight', glyph: '🧟', hp: 46, atk: 11, def: 4, spd: 5, gold: [16, 28], xp: 18, lifesteal: 0.25,
      specials: [{ at: 4, name: 'Grave Grip', mult: 1.5, weaken: 0.5, lazy: 0.3, desc: 'cold fingers find your throat' }] },
    { id: 'horned_stalker', name: 'Horned Stalker', glyph: '👹', hp: 52, atk: 13, def: 4, spd: 7, gold: [16, 30], xp: 19,
      specials: [{ at: 4, name: 'Chestgaze', mult: 1.5, confused: 0.4, desc: 'the eyes on its ribs open' }] },
    { id: 'void_eye', name: 'Void Eye', glyph: '🧿', hp: 62, atk: 14, def: 3, spd: 9, gold: [18, 32], xp: 20, caster: true, elite: true,
      specials: [{ at: 3, name: 'Warp Beam', mult: 1.55, confused: 0.5, desc: 'the central pupil dilates' }, { at: 6, name: 'Unmake', mult: 1.9, aoe: true, tormentedSure: true, desc: 'space forgets how to hold you' }] },
  ],
  frost: [
    { id: 'wraith', name: 'Ice Wraith', glyph: '❄️', hp: 44, atk: 13, def: 4, spd: 10, gold: [16, 30], xp: 20, freeze: 0.3,
      specials: [{ at: 4, name: 'Flash Freeze', mult: 1.3, freezeSure: true, desc: 'the air crystallizes' }] },
    { id: 'frost_giant', name: 'Frost Giant', glyph: '🧊', hp: 80, atk: 14, def: 8, spd: 2, gold: [26, 44], xp: 30, elite: true, intelligent: true,
      specials: [{ at: 4, name: 'Avalanche Swing', mult: 1.4, aoe: true, desc: 'hefts a club the size of a door' }] },
    { id: 'winter_wolf', name: 'Winter Wolf', glyph: '🐺', hp: 48, atk: 14, def: 4, spd: 10, gold: [18, 30], xp: 22, pack: true,
      specials: [{ at: 5, name: 'Killing Cold Howl', mult: 1.25, aoe: true, freeze: 0.35, weaken: 0.3, desc: 'breath steams with intent' }] },
    { id: 'ice_maiden', name: 'Court Ice-Maiden', glyph: '👑', hp: 44, atk: 14, def: 4, spd: 9, gold: [22, 38], xp: 24, caster: true, freeze: 0.35, intelligent: true,
      specials: [{ at: 3, name: 'Courtly Spite', mult: 1.5, freezeSure: true, desc: 'smiles with December behind it' }] },
    { id: 'frozen_soldier', name: 'Frozen Soldier', glyph: '🛡️', hp: 56, atk: 12, def: 8, spd: 3, gold: [18, 32], xp: 22, pack: true,
      specials: [{ at: 4, name: 'Shield Wall', mult: 1.35, desc: 'ice cracks along the kite shield' }] },
    { id: 'yeti', name: 'Glacial Yeti', glyph: '🦍', hp: 76, atk: 14, def: 6, spd: 4, gold: [24, 40], xp: 28, elite: true, freeze: 0.25,
      specials: [{ at: 5, name: 'Avalanche Slam', mult: 1.4, aoe: true, stun: 0.35, freeze: 0.3, desc: 'raises both fists overhead' }] },
    { id: 'void_specter', name: 'Rime Specter', glyph: '👻', hp: 44, atk: 13, def: 3, spd: 11, gold: [20, 34], xp: 23, freeze: 0.4, caster: true,
      specials: [{ at: 4, name: 'Pale Howl', mult: 1.2, aoe: true, freeze: 0.3, confused: 0.35, desc: 'the cold gains a voice' }] },
  ],
  swamp: [
    { id: 'hag', name: 'Mire Hag', glyph: '🧙', hp: 54, atk: 16, def: 5, spd: 7, gold: [24, 42], xp: 30, caster: true, intelligent: true,
      specials: [{ at: 3, name: 'Curdling Hex', mult: 1.5, weakenSure: true, desc: 'mutters your name backwards' }, { at: 6, name: 'The Old Recipe', mult: 1.9, aoe: true, lazy: 0.45, desc: 'the cauldron boils over' }] },
    { id: 'croc', name: 'Bog Render', glyph: '🐊', hp: 72, atk: 18, def: 7, spd: 5, gold: [22, 40], xp: 32,
      specials: [{ at: 5, name: 'Death Roll', mult: 1.9, frail: 0.55, stun: 0.3, desc: 'jaws widen past reason' }] },
    { id: 'leech', name: 'Giant Leech', glyph: '🪱', hp: 48, atk: 15, def: 3, spd: 6, gold: [16, 30], xp: 24, lifesteal: 0.45, pack: true,
      specials: [{ at: 4, name: 'Drain Latch', mult: 1.45, weaken: 0.45, desc: 'latches and will not let go' }] },
    { id: 'will_o_wisp', name: 'Will-o\'-Wisp', glyph: '🔥', hp: 38, atk: 15, def: 2, spd: 12, gold: [20, 36], xp: 26, caster: true,
      specials: [{ at: 4, name: 'False Dawn', mult: 1.25, aoe: true, burn: 0.4, confused: 0.35, desc: 'burns suddenly brighter' }] },
    { id: 'troll', name: 'Moss Troll', glyph: '👹', hp: 96, atk: 17, def: 8, spd: 2, gold: [30, 52], xp: 38, elite: true, regen: 0.05, intelligent: true,
      specials: [{ at: 4, name: 'Uproot & Swing', mult: 1.5, aoe: true, stun: 0.35, desc: 'tears a sapling loose' }] },
    { id: 'mire_abomination', name: 'Mire Abomination', glyph: '👁', hp: 86, atk: 17, def: 6, spd: 3, gold: [28, 48], xp: 36, elite: true, poison: 0.40, regen: 0.03,
      specials: [{ at: 3, name: 'Toxic Gaze', mult: 1.4, poisonSure: true, desc: 'three eyes blink in wrong order' }, { at: 6, name: 'Green Miasma', mult: 1.75, aoe: true, poisonSure: true, desc: 'the aura thickens into weather' }] },
  ],
  hell: [
    { id: 'imp', name: 'Cinder Imp', glyph: '👺', hp: 50, atk: 17, def: 5, spd: 11, gold: [26, 46], xp: 34, pack: true, burn: 0.30, intelligent: true,
      specials: [{ at: 5, name: 'Spitfire Tantrum', mult: 1.2, aoe: true, burnSure: true, desc: 'giggles and ignites' }] },
    { id: 'hellhound', name: 'Hellhound', glyph: '🐕‍🦺', hp: 62, atk: 18, def: 5, spd: 10, gold: [28, 48], xp: 38, pack: true, burn: 0.34,
      specials: [{ at: 4, name: 'Immolating Lunge', mult: 1.6, burnSure: true, desc: 'flame gutters between its teeth' }] },
    { id: 'tormentor', name: 'Chain Tormentor', glyph: '⛓️', hp: 78, atk: 19, def: 7, spd: 5, gold: [34, 56], xp: 44, elite: true, intelligent: true,
      specials: [{ at: 3, name: 'Lash Volley', mult: 1.3, aoe: true, frail: 0.4, desc: 'chains rise like serpents' }, { at: 6, name: 'Penance', mult: 2.0, tormentedSure: true, desc: 'selects an instrument with care' }] },
    { id: 'pit_mage', name: 'Pit Magus', glyph: '🔮', hp: 58, atk: 20, def: 5, spd: 8, gold: [32, 54], xp: 42, caster: true, burn: 0.40, intelligent: true,
      specials: [{ at: 4, name: 'Brimstone Sermon', mult: 1.5, aoe: true, burnSure: true, desc: 'opens a book that screams' }] },
    { id: 'brute', name: 'Obsidian Brute', glyph: '🌋', hp: 100, atk: 20, def: 10, spd: 3, gold: [38, 64], xp: 50, elite: true,
      specials: [{ at: 5, name: 'Magma Haymaker', mult: 1.45, aoe: true, burn: 0.4, stun: 0.35, desc: 'knuckles glow white-hot' }] },
    { id: 'sin_eater', name: 'Sin-Eater', glyph: '👄', hp: 70, atk: 19, def: 6, spd: 9, gold: [34, 58], xp: 46, lifesteal: 0.28, intelligent: true,
      specials: [{ at: 3, name: 'Devour', mult: 1.6, heal: 0.08, weaken: 0.45, frail: 0.35, desc: 'unhinges a doorway of a mouth' }] },
    { id: 'magma_golem', name: 'Magma Golem', glyph: '🪨', hp: 95, atk: 19, def: 11, spd: 2, gold: [36, 60], xp: 48, elite: true, burn: 0.30,
      specials: [{ at: 3, name: 'Furnace Punch', mult: 1.65, burnSure: true, desc: 'fists glow white' }, { at: 5, name: 'Furnace Burst', mult: 1.35, aoe: true, burnSure: true, desc: 'vents a wave of slag-heat' }] },
    { id: 'eye_horror', name: 'Eye Horror', glyph: '👀', hp: 74, atk: 20, def: 5, spd: 6, gold: [32, 54], xp: 45, caster: true, elite: true,
      specials: [{ at: 3, name: 'Burning Gaze', mult: 1.45, burnSure: true, desc: 'eight pupils ignite' }, { at: 6, name: 'Chorus of Sight', mult: 1.9, aoe: true, confusedSure: true, desc: 'every eye speaks a different doom' }] },
    { id: 'crimson_wretch', name: 'Crimson Wretch', glyph: '🩸', hp: 58, atk: 18, def: 4, spd: 10, gold: [28, 50], xp: 40, lifesteal: 0.25, pack: true,
      specials: [{ at: 4, name: 'Frenzy Bite', mult: 1.55, heal: 0.06, desc: 'bloodshot eyes lock on' }] },
    { id: 'slag_knight', name: 'Slag Knight', glyph: '⚔️', hp: 88, atk: 20, def: 9, spd: 4, gold: [36, 62], xp: 50, elite: true, intelligent: true, burn: 0.22,
      specials: [{ at: 3, name: 'Molten Arc', mult: 1.35, aoe: true, burn: 0.35, weaken: 0.3, desc: 'a blade of cooling iron swings' }, { at: 6, name: 'Core Detonation', mult: 1.55, aoe: true, burnSure: true, desc: 'the chest-runes overbrighten' }] },
  ],
};

/** Band of Knights elite variants — always fight as a pack (see rollKnightBand). */
export const KNIGHT_BAND_IDS = [
  'knight_armor',
  'knight_knight_sheet_alt_heads',
  'knight_knight_sheet_alt_heads_nyx8',
  'knight_knight_sheet_alt_heads_zughy32',
];

// Drop placeholder units from native pools, then merge gallery adds.
for (const biome of Object.keys(ENEMIES)) {
  ENEMIES[biome] = ENEMIES[biome].filter(e => !PLACEHOLDER_IDS.has(e.id));
  const extra = GALLERY_ENEMIES[biome] || [];
  for (const e of extra) {
    if (!ENEMIES[biome].some(x => x.id === e.id)) ENEMIES[biome].push(e);
  }
  for (const e of ENEMIES[biome]) {
    if (ROSTER.renames?.[e.id]) e.name = ROSTER.renames[e.id];
    if (KNIGHT_BAND_IDS.includes(e.id)) e.band = 'knights';
  }
}

/** Trash that can appear in any biome encounter pool. */
export const WANDERING_ENEMIES = GALLERY_WANDERING.filter(e => !PLACEHOLDER_IDS.has(e.id));

function applyRosterRename(e) {
  if (e && ROSTER.renames?.[e.id]) e.name = ROSTER.renames[e.id];
  return e;
}
for (const e of WANDERING_ENEMIES) applyRosterRename(e);
for (const b of Object.values(GALLERY_BOSSES)) applyRosterRename(b);
for (const n of Object.values(GALLERY_NPCS)) applyRosterRename(n);

/**
 * Party-scaled Band of Knights size: 1p→2, 2p→3–4, 3p→4–5, 4p+→5–7.
 * Armor variants are rolled at random (with replacement).
 */
export function knightBandSize(rng, partySize = 1) {
  const n = Math.max(1, partySize | 0);
  if (n <= 1) return 2;
  if (n === 2) return rng.chance(0.45) ? 3 : 4;
  if (n === 3) return rng.chance(0.4) ? 4 : 5;
  if (typeof rng.int === 'function') return rng.int(5, 7);
  return rng.chance(0.4) ? 5 : rng.chance(0.5) ? 6 : 7;
}

/** Build a full knight-band encounter (replaces a lone knight elite draw). */
export function rollKnightBand(rng, partySize = 1) {
  const variants = (ENEMIES.ruins || []).filter(e => e.band === 'knights');
  const pool = variants.length
    ? variants
    : KNIGHT_BAND_IDS.map(id => ({ id, name: id, elite: true, hp: 60, atk: 13, def: 5, spd: 7, gold: [21, 37], xp: 23 }));
  const count = knightBandSize(rng, partySize);
  const specs = [];
  for (let i = 0; i < count; i++) specs.push(rng.pick(pool));
  // Soften per-knight HP so multi-elite packs stay fair.
  const hpMult = count <= 2 ? 0.88 : count <= 4 ? 0.76 : 0.66;
  return { specs, hpMult, count };
}

// One boss guards the gate out of each biome. Boss initiative matches
// identity (§14): trees and hydras are slow; dukes and kings are fast.
// ATK bases sit well above mimic-tier threats — DEF should never leave a
// boss swinging for single-digit damage at the end of a biome.
export const BOSSES = {
  10: {
    id: 'elderwood', name: 'Sylvanor, the Elderwood Guardian', glyph: '🌲', biome: 'forest',
    // Scaled ~200 HP; DEF keeps solo HTK ~7–9 turns. Co-op pads via partyBossHpMult.
    hp: 190, atk: 27, def: 4, spd: 3, gold: [60, 90], xp: 60, regen: 0.02, boss: true,
    // Slow bruiser — banks for 4 then 6. No cheap at:3 dump.
    chargeGain: 1, bankChance: 0.72,
    specials: [
      { at: 4, name: 'Limb Sweep', mult: 1.55, aoe: true, lazy: 0.35, desc: 'branches groan overhead' },
      { at: 6, name: 'FOREST\'S VERDICT', mult: 2.70, frail: 0.5, desc: 'ten thousand judged climbers watch through its rings' },
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
    // Midboss — tuned under F20; solo ease + this HP keep on-curve clears ~40%+ HP.
    hp: 235, atk: 26, def: 5, spd: 6, gold: [75, 110], xp: 75, boss: true,
    // Tempo: early chip (1), mid pressure (3), then a heavy 6.
    chargeGain: 1, bankChance: 0.72,
    specials: [
      { at: 1, name: 'Oathbreaker', mult: 1.2, desc: 'the greatsword drags a line through the dust' },
      { at: 3, name: 'Ring of Ash', mult: 1.55, aoe: true, burn: 0.35, desc: 'the crown sheds a burning halo' },
      { at: 6, name: 'CROWN OF ASH', mult: 2.75, frailSure: true, desc: 'the dead king remembers he was crowned' },
    ],
    intro: 'A knight kneels in the dust, greatsword planted, crown fused to the helm.\nHe has knelt here for six hundred years, waiting for a king who never came.\nHe stands up for you.',
    taunt: 'I KEPT MY OATH. WHERE IS YOURS?',
  },
  20: {
    id: 'lich', name: 'Lich of the Fallen King', glyph: '👑', biome: 'ruins',
    hp: 340, atk: 30, def: 7, spd: 8, gold: [90, 130], xp: 90, caster: true, summons: 'skeleton', boss: true,
    // Mid-bar pressure only — no free at:3; banks 4→5.
    chargeGain: 1, bankChance: 0.72,
    specials: [
      { at: 4, name: 'Soul Tithe', mult: 1.65, heal: 0.06, weaken: 0.5, desc: 'the crown\'s lights burn colder' },
      { at: 5, name: 'DYNASTY\'S END', mult: 2.60, aoe: true, tormentedSure: true, desc: 'six hundred years of grievance condenses' },
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
    // Court tempo: light 2, mid 4, finale 6.
    chargeGain: 1, bankChance: 0.72,
    specials: [
      { at: 2, name: 'Glacial Decree', mult: 1.3, freeze: 0.35, desc: 'the temperature plummets' },
      { at: 4, name: 'Courtly Reproach', mult: 1.7, aoe: true, weaken: 0.4, desc: 'the frozen court exhales as one' },
      { at: 6, name: 'ETERNAL WINTER', mult: 2.65, aoe: true, freezeSure: true, desc: 'the court\'s frozen betrayers turn their heads in unison' },
    ],
    intro: 'The Frost Queen does not rise from her throne. She merely opens her eyes,\nand the temperature of your blood becomes negotiable.',
    taunt: 'WINTER OUTLASTS EVERYTHING. EVEN HOPE.',
  },
  40: {
    id: 'hydra', name: 'The Grieving Hydra', glyph: '🐉', biome: 'swamp',
    hp: 550, atk: 38, def: 12, spd: 4, gold: [160, 220], xp: 180, regen: 0.02, heads: true, boss: true,
    // Two-step: bite at 3, then bank hard for the 6.
    chargeGain: 1, bankChance: 0.75,
    specials: [
      { at: 3, name: 'Threefold Snap', mult: 1.55, poisonSure: true, desc: 'three heads inhale together' },
      { at: 6, name: 'SORROW UNENDING', mult: 3.05, aoe: true, tormentedSure: true, frail: 0.5, desc: 'the weeping head finally screams' },
    ],
    intro: 'Three heads surface from the black water. One weeps. One laughs.\nThe third simply opens its jaws.',
    taunt: 'CUT ONE SORROW DOWN. TWO MORE RISE.',
  },
  50: {
    id: 'infernal_duke', name: 'Duke Malgrimm, Gatekeeper of the Throne', glyph: '😈', biome: 'hell',
    hp: 655, atk: 40, def: 14, spd: 10, gold: [220, 300], xp: 250, burn: 0.22, boss: true,
    // Duelist: feint at 2, heavy 5, ultimate 6.
    chargeGain: 1, bankChance: 0.72,
    specials: [
      { at: 2, name: 'Sword of Swords', mult: 1.35, weaken: 0.45, desc: 'the blades within his blade align' },
      { at: 5, name: 'Bladestorm Toll', mult: 2.95, aoe: true, frail: 0.5, desc: 'the sword of swords fans open' },
      { at: 6, name: 'GATEKEEPER\'S TOLL', mult: 3.25, aoe: true, burnSure: true, tormented: 0.55, desc: 'he stops being polite about it' },
    ],
    intro: '"Fifty floors," the Duke muses, drawing a sword made of other swords.\n"Impressive. The King will want to kill you personally. Let\'s disappoint him."',
    taunt: 'THE THRONE IS A PRIVILEGE. DYING HERE IS FREE.',
  },
  // Throne: sticky 50/50 between Vorath (primary) and Malqor (ALT_BOSSES[51]).
  51: GALLERY_BOSSES.tr_mon_demon,
};

// One alternate gatekeeper per world (and the throne). Seeded pick — same
// run always faces the same boss once chosen.
export const ALT_BOSSES = {
  10: GALLERY_BOSSES.gv_grotto_escape_2_boss_dragon,
  20: GALLERY_BOSSES.undead_executioner,
  30: GALLERY_BOSSES.tr_mon_centaur,
  40: GALLERY_BOSSES.tr_live_ogre,
  50: GALLERY_BOSSES.kryos_demon_general,
  51: GALLERY_BOSSES.boss_demon_slime,
};

/** Secret corrupt-king fight (throne "answer honestly" path). */
export const SECRET_BOSS = GALLERY_BOSSES.medieval_king;

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
  for (const b of Object.values(BOSSES)) if (b?.id === id) return b;
  for (const b of Object.values(ALT_BOSSES)) if (b?.id === id) return b;
  if (SECRET_BOSS?.id === id) return SECRET_BOSS;
  if (GALLERY_BOSSES[id]) return GALLERY_BOSSES[id];
  return null;
}

/**
 * Chest mimic — event-only. Uses elite TDC role; bases stay off the floor budget
 * so clear-rate targets (brick / long / win) are unaffected.
 */
/**
 * Chest mimic — event-only. Uses elite TDC role; bases stay off the floor budget
 * so clear-rate targets (brick / long / win) are unaffected.
 */
export function mimicSpec(floor) {
  return {
    id: 'mimic', name: 'Mimic', glyph: '🦷',
    // Mild bump vs old 42+5f / 8+f; co-op uses TDC.eventFight pads.
    hp: 46 + floor * 5.25, atk: 8 + Math.round(floor * 1.05), def: 3, spd: 8,
    gold: [48 + floor * 4, 74 + floor * 5], xp: 21 + floor * 3,
    elite: true,
    specials: [
      { at: 3, name: 'Lid Bite', mult: 1.6, desc: 'the hinge screams' },
      { at: 5, name: 'Chest Slam', mult: 1.85, stun: 0.2, desc: 'the lid comes down like a guillotine' },
    ],
  };
}


/** Event / social NPCs — harder than mimics at the same floor (elite-leaning). Farmers stay weak. */
export const NPC_ENEMIES = {
  // Knight Hero Platformer pack (anim/warrior) — social duel NPC.
  blade_hero: {
    id: 'blade_hero', name: 'Oathbound Champion', glyph: '⚔️', hp: 74, atk: 14, def: 4, spd: 7,
    gold: [36, 60], xp: 30, intelligent: true, elite: true, enrageAtRound: 6,
    specials: [
      { at: 3, name: 'Oath Swing', mult: 1.8, desc: 'raises a well-kept blade' },
      { at: 5, name: 'Shield Answer', mult: 1.6, desc: 'plants and answers' },
    ],
  },
  // Blue-mage pack (anim/mage) — a scholar who slid into forbidden work.
  dark_mage: {
    id: 'dark_mage', name: 'Apostate Channeler', glyph: '🔮', hp: 64, atk: 15, def: 3, spd: 8,
    gold: [38, 64], xp: 32, caster: true, intelligent: true, elite: true, enrageAtRound: 6,
    specials: [
      { at: 3, name: 'Black Margin', mult: 1.7, aoe: true, desc: 'ink-smoke curls into a hex' },
      { at: 5, name: 'Unwritten Name', mult: 1.95, desc: 'whispers something the tower forgot' },
    ],
  },
  pathfinder_veteran: {
    id: 'pathfinder_veteran', name: 'Pathfinder Veteran', glyph: '🏹', hp: 64, atk: 14, def: 3, spd: 11,
    gold: [34, 58], xp: 31, intelligent: true, elite: true,
    specials: [{ at: 3, name: 'Trail Shot', mult: 1.85, desc: 'nocks without looking' }],
  },
  // Pre-bob Viking class look (viking_axe_pack idle strip).
  axe_northman: {
    id: 'axe_northman', name: 'Axe-Pack Veteran', glyph: '🪓', hp: 80, atk: 15, def: 4, spd: 6,
    gold: [42, 72], xp: 34, intelligent: true, elite: true,
    specials: [{ at: 4, name: 'Bearded Cleave', mult: 2.0, desc: 'hefts an axe that remembers coastlines' }],
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
    id: 'farmer_f', name: "Hedge Witch's Kin", glyph: '🌿', hp: 24, atk: 6, def: 1, spd: 7,
    gold: [5, 12], xp: 8, pack: true, intelligent: true, caster: true,
    specials: [{ at: 3, name: 'Hedge Pinch', mult: 1.3, poisonSure: true, desc: 'pins a bitter leaf' }],
  },
  roadside_npc: {
    id: 'roadside_npc', name: 'Roadside Climber', glyph: '🧳', hp: 66, atk: 13, def: 4, spd: 7,
    gold: [32, 56], xp: 28, intelligent: true, elite: true,
    specials: [{ at: 3, name: 'Trail Bargain', mult: 1.75, desc: 'draws a travel blade' }],
  },
  roadside_npc2: {
    id: 'roadside_npc2', name: 'Wandering Hireling', glyph: '🗡️', hp: 64, atk: 14, def: 3, spd: 9,
    gold: [34, 58], xp: 29, intelligent: true, elite: true,
    specials: [{ at: 3, name: 'Contract Cut', mult: 1.8, desc: 'honors a bloody clause' }],
  },
  oldman_gentle: {
    id: 'oldman_gentle', name: 'Kindly Elder', glyph: '🧓', hp: 58, atk: 11, def: 3, spd: 6,
    gold: [28, 50], xp: 24, intelligent: true, elite: true,
    specials: [{ at: 4, name: 'Cane Tap', mult: 1.55, desc: 'taps the cane once' }],
  },
  oldman_wrath: {
    // boss:true for UI/rewards; eliteAtkRole avoids crushed boss.atk role scale.
    id: 'oldman_wrath', name: 'Trialmaster', glyph: '⚡', hp: 130, atk: 19, def: 6, spd: 9,
    gold: [100, 170], xp: 72, intelligent: true, elite: true, boss: true, eliteAtkRole: true,
    enrageAtRound: 6, chargeGain: 1.1,
    specials: [
      { at: 3, name: 'Lesson One', mult: 1.85, desc: 'the cane becomes a verdict' },
      { at: 6, name: 'Final Examination', mult: 2.3, aoe: true, stun: 0.3, desc: 'the air itself quizzes you' },
    ],
  },
  ...GALLERY_NPCS,
};

export function findEnemySpec(id) {
  if (PLACEHOLDER_IDS.has(id)) return null;
  if (NPC_ENEMIES[id]) return NPC_ENEMIES[id];
  for (const pool of Object.values(ENEMIES)) {
    const found = pool.find(e => e.id === id);
    if (found) return found;
  }
  const wander = WANDERING_ENEMIES.find(e => e.id === id);
  if (wander) return wander;
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
