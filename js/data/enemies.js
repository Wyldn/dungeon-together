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
      specials: [{ at: 3, name: 'Glimmer Burst', mult: 1.5, desc: 'gathers stolen light' }] },
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
      specials: [{ at: 3, name: 'Crimson Draught', mult: 1.5, heal: 0.1, desc: 'bares a red smile' }, { at: 6, name: 'Night\'s Embrace', mult: 1.9, heal: 0.15, desc: 'the shadows lean in hungrily' }] },
  ],
  ruins: [
    { id: 'skeleton', name: 'Restless Skeleton', glyph: '💀', hp: 34, atk: 10, def: 3, spd: 6, gold: [12, 22], xp: 14, pack: true,
      specials: [{ at: 5, name: 'Bone Shatter', mult: 1.5, desc: 'rattles ominously' }] },
    { id: 'cursed_knight', name: 'Cursed Knight', glyph: '⚔️', hp: 56, atk: 12, def: 6, spd: 5, gold: [18, 32], xp: 20, elite: true, intelligent: true,
      specials: [{ at: 3, name: 'Oathbreaker\'s Arc', mult: 1.5, desc: 'raises a blackened blade' }, { at: 6, name: 'Grave Oath', mult: 2.0, desc: 'the armor begins to weep' }] },
    { id: 'shade', name: 'Weeping Shade', glyph: '👻', hp: 36, atk: 11, def: 1, spd: 10, gold: [10, 20], xp: 15,
      specials: [{ at: 4, name: 'Wail', mult: 1.2, aoe: true, desc: 'draws a breath it doesn\'t need' }] },
    { id: 'scarab', name: 'Tomb Scarab Swarm', glyph: '🪲', hp: 34, atk: 9, def: 2, spd: 8, gold: [8, 18], xp: 12, pack: true },
    { id: 'golem', name: 'Broken Golem', glyph: '🗿', hp: 70, atk: 11, def: 8, spd: 1, gold: [20, 36], xp: 22, elite: true,
      specials: [{ at: 4, name: 'Grindstone Fist', mult: 1.8, desc: 'gears shriek inside it' }] },
    { id: 'acolyte', name: 'Hollow Acolyte', glyph: '🕯️', hp: 32, atk: 12, def: 2, spd: 7, gold: [14, 26], xp: 16, caster: true, intelligent: true,
      specials: [{ at: 3, name: 'Hollow Litany', mult: 1.5, desc: 'chants in a dead tongue' }] },
    { id: 'wight', name: 'Barrow Wight', glyph: '🧟', hp: 46, atk: 11, def: 4, spd: 5, gold: [16, 28], xp: 18, lifesteal: 0.25,
      specials: [{ at: 4, name: 'Grave Grip', mult: 1.5, desc: 'cold fingers find your throat' }] },
  ],
  frost: [
    { id: 'wraith', name: 'Ice Wraith', glyph: '❄️', hp: 44, atk: 14, def: 4, spd: 10, gold: [16, 30], xp: 20, freeze: 0.3,
      specials: [{ at: 4, name: 'Flash Freeze', mult: 1.3, freezeSure: true, desc: 'the air crystallizes' }] },
    { id: 'frost_giant', name: 'Frost Giant', glyph: '🧊', hp: 88, atk: 16, def: 8, spd: 2, gold: [26, 44], xp: 30, elite: true, intelligent: true,
      specials: [{ at: 4, name: 'Avalanche Swing', mult: 1.4, aoe: true, desc: 'hefts a club the size of a door' }] },
    { id: 'winter_wolf', name: 'Winter Wolf', glyph: '🐺', hp: 50, atk: 15, def: 4, spd: 10, gold: [18, 30], xp: 22, pack: true,
      specials: [{ at: 4, name: 'Killing Cold Howl', mult: 1.5, desc: 'breath steams with intent' }] },
    { id: 'ice_maiden', name: 'Court Ice-Maiden', glyph: '👑', hp: 46, atk: 16, def: 4, spd: 9, gold: [22, 38], xp: 24, caster: true, freeze: 0.35, intelligent: true,
      specials: [{ at: 3, name: 'Courtly Spite', mult: 1.5, freezeSure: true, desc: 'smiles with December behind it' }] },
    { id: 'frozen_soldier', name: 'Frozen Soldier', glyph: '🛡️', hp: 60, atk: 14, def: 9, spd: 3, gold: [18, 32], xp: 22, pack: true },
    { id: 'yeti', name: 'Glacial Yeti', glyph: '🦍', hp: 84, atk: 16, def: 6, spd: 4, gold: [24, 40], xp: 28, elite: true, freeze: 0.25,
      specials: [{ at: 4, name: 'Avalanche Slam', mult: 1.6, freezeSure: true, desc: 'raises both fists overhead' }] },
  ],
  swamp: [
    { id: 'hag', name: 'Mire Hag', glyph: '🧙', hp: 58, atk: 19, def: 5, spd: 7, gold: [24, 42], xp: 30, caster: true, intelligent: true,
      specials: [{ at: 3, name: 'Curdling Hex', mult: 1.5, desc: 'mutters your name backwards' }, { at: 6, name: 'The Old Recipe', mult: 1.9, aoe: true, desc: 'the cauldron boils over' }] },
    { id: 'croc', name: 'Bog Render', glyph: '🐊', hp: 80, atk: 21, def: 7, spd: 5, gold: [22, 40], xp: 32,
      specials: [{ at: 5, name: 'Death Roll', mult: 1.9, desc: 'jaws widen past reason' }] },
    { id: 'leech', name: 'Giant Leech', glyph: '🪱', hp: 52, atk: 17, def: 3, spd: 6, gold: [16, 30], xp: 24, lifesteal: 0.5, pack: true },
    { id: 'will_o_wisp', name: 'Will-o\'-Wisp', glyph: '🔥', hp: 40, atk: 18, def: 2, spd: 12, gold: [20, 36], xp: 26, caster: true,
      specials: [{ at: 3, name: 'False Dawn', mult: 1.6, desc: 'burns suddenly brighter' }] },
    { id: 'troll', name: 'Moss Troll', glyph: '👹', hp: 110, atk: 20, def: 9, spd: 2, gold: [30, 52], xp: 38, elite: true, regen: 0.06, intelligent: true,
      specials: [{ at: 4, name: 'Uproot & Swing', mult: 1.5, aoe: true, desc: 'tears a sapling loose' }] },
  ],
  hell: [
    { id: 'imp', name: 'Cinder Imp', glyph: '👺', hp: 60, atk: 23, def: 5, spd: 11, gold: [26, 46], xp: 34, pack: true, burn: 0.3, intelligent: true,
      specials: [{ at: 4, name: 'Spitfire Tantrum', mult: 1.4, burnSure: true, desc: 'giggles and ignites' }] },
    { id: 'hellhound', name: 'Hellhound', glyph: '🐕‍🦺', hp: 76, atk: 26, def: 6, spd: 10, gold: [28, 48], xp: 38, pack: true, burn: 0.35,
      specials: [{ at: 4, name: 'Immolating Lunge', mult: 1.6, burnSure: true, desc: 'flame gutters between its teeth' }] },
    { id: 'tormentor', name: 'Chain Tormentor', glyph: '⛓️', hp: 96, atk: 27, def: 9, spd: 5, gold: [34, 56], xp: 44, elite: true, intelligent: true,
      specials: [{ at: 3, name: 'Lash Volley', mult: 1.3, aoe: true, desc: 'chains rise like serpents' }, { at: 6, name: 'Penance', mult: 2.0, desc: 'selects an instrument with care' }] },
    { id: 'pit_mage', name: 'Pit Magus', glyph: '🔮', hp: 70, atk: 29, def: 5, spd: 8, gold: [32, 54], xp: 42, caster: true, burn: 0.4, intelligent: true,
      specials: [{ at: 4, name: 'Brimstone Sermon', mult: 1.5, aoe: true, burnSure: true, desc: 'opens a book that screams' }] },
    { id: 'brute', name: 'Obsidian Brute', glyph: '🌋', hp: 130, atk: 28, def: 12, spd: 3, gold: [38, 64], xp: 50, elite: true,
      specials: [{ at: 5, name: 'Magma Haymaker', mult: 1.9, desc: 'knuckles glow white-hot' }] },
    { id: 'sin_eater', name: 'Sin-Eater', glyph: '👄', hp: 88, atk: 27, def: 7, spd: 9, gold: [34, 58], xp: 46, lifesteal: 0.35, intelligent: true,
      specials: [{ at: 3, name: 'Devour', mult: 1.6, heal: 0.08, desc: 'unhinges a doorway of a mouth' }] },
  ],
};

// One boss guards the gate out of each biome. Boss initiative matches
// identity (§14): trees and hydras are slow; dukes and kings are fast.
export const BOSSES = {
  10: {
    id: 'elderwood', name: 'The Elderwood Guardian', glyph: '🌲', biome: 'forest',
    // Tuned for P50 RTK ~6–10 and ~20–35% HP loss (tools/sim.js §9).
    hp: 125, atk: 8, def: 5, spd: 3, gold: [60, 90], xp: 60, regen: 0.03, boss: true,
    chargeGain: 1,
    specials: [
      { at: 3, name: 'Limb Sweep', mult: 1.35, aoe: true, desc: 'branches groan overhead' },
      { at: 6, name: 'FOREST\'S VERDICT', mult: 2.0, desc: 'ten thousand judged climbers watch through its rings' },
    ],
    intro: 'The oldest tree in the forest uproots itself. It has judged ten thousand climbers.\nIt has approved of none.',
    taunt: 'YOU BURN LIKE ALL THE REST.',
  },
  20: {
    id: 'lich', name: 'Lich of the Fallen King', glyph: '👑', biome: 'ruins',
    hp: 190, atk: 11, def: 5, spd: 8, gold: [90, 130], xp: 90, caster: true, summons: 'skeleton', boss: true,
    chargeGain: 1,
    specials: [
      { at: 3, name: 'Soul Tithe', mult: 1.4, heal: 0.06, desc: 'the crown\'s lights burn colder' },
      { at: 6, name: 'DYNASTY\'S END', mult: 1.7, aoe: true, desc: 'six hundred years of grievance condenses' },
    ],
    intro: 'A crown floats above a throne of dust. Beneath it, two cold lights ignite.\n"Kneel. My kingdom needs subjects."',
    taunt: 'DEATH IS A DOOR. I AM THE KEY.',
  },
  30: {
    id: 'frost_queen', name: 'Queen Vessalia the Unmelting', glyph: '❄️', biome: 'frost',
    hp: 270, atk: 13, def: 7, spd: 9, gold: [120, 170], xp: 130, boss: true,
    // Freeze is a court decree, not every swing — pulse every 4 of her turns.
    freezeEvery: 4,
    cleanseCost: 3, // harder to burn FOC out of ice than most bosses
    chargeGain: 1,
    specials: [
      { at: 3, name: 'Glacial Decree', mult: 1.35, desc: 'the temperature plummets' },
      { at: 6, name: 'ETERNAL WINTER', mult: 1.75, aoe: true, desc: 'the court\'s frozen betrayers turn their heads in unison' },
    ],
    intro: 'The Frost Queen does not rise from her throne. She merely opens her eyes,\nand the temperature of your blood becomes negotiable.',
    taunt: 'WINTER OUTLASTS EVERYTHING. EVEN HOPE.',
  },
  40: {
    id: 'hydra', name: 'The Grieving Hydra', glyph: '🐉', biome: 'swamp',
    hp: 330, atk: 14, def: 8, spd: 4, gold: [160, 220], xp: 180, regen: 0.04, heads: true, boss: true,
    chargeGain: 1,
    specials: [
      { at: 3, name: 'Threefold Snap', mult: 1.4, desc: 'three heads inhale together' },
      { at: 6, name: 'SORROW UNENDING', mult: 1.85, aoe: true, desc: 'the weeping head finally screams' },
    ],
    intro: 'Three heads surface from the black water. One weeps. One laughs.\nThe third simply opens its jaws.',
    taunt: 'CUT ONE SORROW DOWN. TWO MORE RISE.',
  },
  50: {
    id: 'infernal_duke', name: 'Duke Malgrimm, Gatekeeper of the Throne', glyph: '😈', biome: 'hell',
    hp: 400, atk: 14, def: 10, spd: 10, gold: [220, 300], xp: 250, burn: 0.25, boss: true,
    chargeGain: 2, // the Duke is a duelist — he banks momentum fast
    specials: [
      { at: 3, name: 'Sword of Swords', mult: 1.5, desc: 'the blades within his blade align' },
      { at: 6, name: 'GATEKEEPER\'S TOLL', mult: 1.9, aoe: true, burnSure: true, desc: 'he stops being polite about it' },
    ],
    intro: '"Fifty floors," the Duke muses, drawing a sword made of other swords.\n"Impressive. The King will want to kill you personally. Let\'s disappoint him."',
    taunt: 'THE THRONE IS A PRIVILEGE. DYING HERE IS FREE.',
  },
  51: {
    id: 'demon_king', name: 'VORATH, THE DEMON KING', glyph: '🜏', biome: 'throne',
    hp: 510, atk: 15, def: 11, spd: 11, gold: [0, 0], xp: 0, phases: true, boss: true,
    chargeGain: 1, chargeOnPhase: 3, // enrage banks charge instantly
    cleanseCost: 1, // the King breaks bindings cheaply
    specials: [
      { at: 3, name: 'Century\'s Edge', mult: 1.5, desc: 'his blade remembers every hero it has ended' },
      { at: 6, name: 'THE KING\'S QUESTION', mult: 2.0, aoe: true, desc: 'the air itself takes his side' },
    ],
    intro: 'The Demon King sets down a book, marks his page, and stands.\n"Every century, one of you reaches this room. Every century I ask the same question."\nHis blade ignites the air itself.\n"Are you the interesting kind?"',
    taunt: 'I HAVE KILLED HEROES WITH BETTER STATS THAN YOURS.',
  },
};

// Trial-floor battle modifiers (every 5th non-boss floor).
export const MODIFIERS = [
  { id: 'ambush', name: 'Ambush!', desc: 'Enemies strike first this battle.', enemyFirst: true },
  { id: 'thirsting_ground', name: 'Thirsting Ground', desc: 'The floor drinks: lose 3% max HP at the end of each round.', hpDrainPct: 0.03 },
  { id: 'blood_moon', name: 'Blood Moon', desc: 'Everyone deals +40% damage. Everyone.', dmgMult: 1.4 },
  { id: 'mana_void', name: 'Null Field', desc: 'Skills cost +50% class resource this battle.', costMult: 1.5 },
  { id: 'gilded', name: 'Gilded Foes', desc: 'Enemies are tougher but drop triple gold.', hpMult: 1.35, goldMult: 3 },
  { id: 'horde', name: 'The Horde', desc: 'An extra enemy joins the fray.', extraEnemy: true },
  { id: 'surging', name: 'Surging Air', desc: 'Everyone gains Battle Charge twice as fast. Everyone.', chargeMult: 2 },
];
