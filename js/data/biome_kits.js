// Gallery kits: biome + inferred archetype → a small special pattern.
// Authored native specs are never passed through applyGalleryKit.

export const SPECIAL_RIDER_KEYS = [
  'poison', 'poisonSure', 'burn', 'burnSure', 'freeze', 'freezeSure',
  'weaken', 'weakenSure', 'frail', 'frailSure', 'confused', 'confusedSure',
  'lazy', 'lazySure', 'stun', 'paralyze', 'tormented', 'tormentedSure',
];

export const SUPPORTED_SPECIAL_KEYS = new Set([
  'at', 'name', 'mult', 'desc', 'aoe', 'heal',
  'selfShield', 'selfDef', 'vsStatus', 'vsStatusMult', 'consumeStatus',
  'vsWounded', 'vsWoundedAt',
  ...SPECIAL_RIDER_KEYS,
]);

export function specialHasRider(s) {
  return SPECIAL_RIDER_KEYS.some(k => s?.[k]);
}

export function specialRiderKeys(s) {
  return SPECIAL_RIDER_KEYS.filter(k => s?.[k]);
}

const HINTS = [
  { re: /golem|mecha|armor|knight_sheet|construct|effigy|congregant/i, arch: 'construct' },
  { re: /treant|soldier|toad/i, arch: 'tank' },
  { re: /warden|scholar/i, arch: 'disruptor' },
  { re: /wolf|hound|bat|rat|wretch|stalker|nightmare/i, arch: 'assassin' },
  { re: /spider|slime|leech|mushroom|frog|worm|myconid|haunt/i, arch: 'attrition' },
  { re: /eye|sprite|wisp|skull|ghost|shade|specter|witch|maiden|mage|wizard/i, arch: 'controller' },
  { re: /ogre|brute|giant|yeti|troll|demon|centaur/i, arch: 'bruiser' },
  { re: /vampire|mummy|wight/i, arch: 'attrition' },
  { re: /knight|executioner/i, arch: 'bruiser' },
  { re: /goblin|bandit|imp|skeleton/i, arch: 'disruptor' },
];

export function inferArchetype(enemy) {
  const key = `${enemy.id || ''} ${enemy.name || ''}`;
  for (const h of HINTS) {
    if (h.re.test(key)) return h.arch;
  }
  if (enemy.caster) return 'controller';
  if ((enemy.def || 0) >= 6 && (enemy.spd || 5) <= 4) return 'tank';
  if ((enemy.spd || 5) >= 9 && (enemy.hp || 30) <= 40) return 'assassin';
  if (enemy.elite) return 'bruiser';
  return 'disruptor';
}

/** biome → archetype → { trash, elite, passives? } */
const KITS = {
  forest: {
    attrition: {
      trash: [{ at: 4, name: 'Spore Burst', mult: 1.3, poison: 0.45, desc: 'caps swell' }],
      elite: [
        { at: 3, name: 'Spore Pinch', mult: 1.25, poison: 0.4, desc: 'a sweet rot' },
        { at: 6, name: 'Bloom', mult: 1.45, aoe: true, poisonSure: true, desc: 'the air fills with spores' },
      ],
      passives: { poison: 0.28 },
    },
    assassin: {
      trash: [{ at: 4, name: 'Hamstring', mult: 1.4, frail: 0.45, desc: 'goes for the tendon' }],
      elite: [
        { at: 3, name: 'Open Vein', mult: 1.3, frail: 0.4, desc: 'finds the weak spot' },
        { at: 5, name: 'Blood Hunt', mult: 1.7, vsWounded: 1.25, frail: 0.3, desc: 'finishes what the pack started' },
      ],
    },
    controller: {
      trash: [{ at: 4, name: 'Hex Glance', mult: 1.2, confused: 0.4, desc: 'too many pupils' }],
      elite: [
        { at: 3, name: 'Bewilder', mult: 1.2, confused: 0.45, desc: 'the woods rearrange' },
        { at: 6, name: 'Lost Path', mult: 1.5, aoe: true, confused: 0.35, weaken: 0.3, desc: 'north becomes a rumor' },
      ],
      passives: { caster: true },
    },
    disruptor: {
      trash: [{ at: 4, name: 'Dirty Feint', mult: 1.35, stun: 0.4, desc: 'palms something glinting' }],
      elite: [
        { at: 3, name: 'Tripwire', mult: 1.2, stun: 0.4, desc: 'a snare in the brush' },
        { at: 5, name: 'Jackal Cut', mult: 1.55, weaken: 0.4, desc: 'laughs while it cuts' },
      ],
    },
    bruiser: {
      trash: [{ at: 4, name: 'Crushing Swing', mult: 1.5, stun: 0.4, desc: 'puts its weight behind it' }],
      elite: [
        { at: 4, name: 'Tree-Feller', mult: 1.45, stun: 0.35, desc: 'the swing starts from the hips' },
        { at: 6, name: 'Uproot', mult: 1.7, aoe: true, lazy: 0.35, desc: 'the ground disagrees' },
      ],
    },
    tank: {
      trash: [{ at: 4, name: 'Rootgrasp', mult: 1.25, lazy: 0.45, desc: 'roots find ankles' }],
      elite: [
        { at: 4, name: 'Rootquake', mult: 1.3, aoe: true, lazy: 0.4, desc: 'the grove holds you' },
        { at: 6, name: 'Heartwood', mult: 1.2, selfDef: 3, heal: 0.06, desc: 'rings close over the wound' },
      ],
      passives: { regen: 0.02 },
    },
    construct: {
      trash: [{ at: 4, name: 'Bark Slam', mult: 1.4, lazy: 0.35, desc: 'wood remembers being a wall' }],
      elite: [
        { at: 3, name: 'Harden', mult: 1.15, selfDef: 2, desc: 'sap seals the grain' },
        { at: 6, name: 'Falling Limb', mult: 1.6, aoe: true, lazy: 0.35, desc: 'a branch decides to be a club' },
      ],
    },
  },
  ruins: {
    construct: {
      trash: [{ at: 4, name: 'Grindstone', mult: 1.4, stun: 0.4, desc: 'gears shriek' }],
      elite: [
        { at: 3, name: 'Brace Plates', mult: 1.15, selfDef: 3, desc: 'ancient joints lock' },
        { at: 5, name: 'Quake Stomp', mult: 1.45, aoe: true, lazy: 0.4, desc: 'the floor was a temple' },
      ],
    },
    bruiser: {
      trash: [{ at: 4, name: 'Oath Cut', mult: 1.45, weaken: 0.4, desc: 'a blackened blade rises' }],
      elite: [
        { at: 4, name: 'Oathbreaker\'s Arc', mult: 1.35, aoe: true, weaken: 0.4, desc: 'the vow still cuts' },
        { at: 6, name: 'Grave Oath', mult: 1.75, frailSure: true, desc: 'armor begins to weep' },
      ],
    },
    tank: {
      trash: [{ at: 4, name: 'Shield Wall', mult: 1.2, selfShield: 0.3, desc: 'dust sheets the kite' }],
      elite: [
        { at: 3, name: 'Lockstep', mult: 1.2, selfShield: 0.25, desc: 'the band closes ranks' },
        { at: 6, name: 'Falling Standard', mult: 1.55, aoe: true, frail: 0.35, desc: 'the banner hits like a hammer' },
      ],
    },
    attrition: {
      trash: [{ at: 4, name: 'Grave Grip', mult: 1.4, weaken: 0.45, desc: 'cold fingers find a throat' }],
      elite: [
        { at: 3, name: 'Wither Touch', mult: 1.3, weaken: 0.4, desc: 'the wrappings drink' },
        { at: 6, name: 'Dynasty Tax', mult: 1.55, heal: 0.08, frail: 0.35, desc: 'six hundred years of thirst' },
      ],
      passives: { lifesteal: 0.18 },
    },
    controller: {
      trash: [{ at: 4, name: 'Hollow Litany', mult: 1.25, aoe: true, weaken: 0.35, desc: 'chants in a dead tongue' }],
      elite: [
        { at: 3, name: 'Unmake Glance', mult: 1.35, confused: 0.45, desc: 'the pupil dilates' },
        { at: 6, name: 'Forget the Floor', mult: 1.7, aoe: true, confused: 0.35, desc: 'space loses its manners' },
      ],
      passives: { caster: true },
    },
    disruptor: {
      trash: [{ at: 4, name: 'Bone Shatter', mult: 1.25, aoe: true, frail: 0.4, desc: 'rattles ominously' }],
      elite: [
        { at: 4, name: 'Rattle Volley', mult: 1.3, aoe: true, frail: 0.35, desc: 'splinters seek joints' },
        { at: 6, name: 'Collapse', mult: 1.6, lazy: 0.35, desc: 'the ribcage remembers falling' },
      ],
    },
    assassin: {
      trash: [{ at: 4, name: 'Chestgaze', mult: 1.45, confused: 0.4, desc: 'eyes on the ribs open' }],
      elite: [
        { at: 3, name: 'Mark the Living', mult: 1.3, frail: 0.4, desc: 'picks a pulse' },
        { at: 5, name: 'Horn Dive', mult: 1.7, vsWounded: 1.25, desc: 'commits the horns to whoever is already bleeding' },
      ],
    },
  },
  frost: {
    controller: {
      trash: [{ at: 4, name: 'Numb', mult: 1.25, paralyze: 0.45, desc: 'fingers forget their job' }],
      elite: [
        { at: 3, name: 'Courtly Spite', mult: 1.4, freeze: 0.4, desc: 'December smiles' },
        { at: 6, name: 'Flash Freeze', mult: 1.55, freezeSure: true, desc: 'the air crystallizes' },
      ],
      passives: { caster: true },
    },
    bruiser: {
      trash: [{ at: 4, name: 'Rime Slam', mult: 1.5, frail: 0.4, desc: 'ice in the knuckles' }],
      elite: [
        { at: 4, name: 'Avalanche Swing', mult: 1.4, aoe: true, frail: 0.35, desc: 'the club is a door — it finds the crack' },
        { at: 6, name: 'Shatter', mult: 1.8, vsStatus: 'frail', vsStatusMult: 1.25, stun: 0.3, desc: 'hits the crack it made' },
      ],
    },
    tank: {
      trash: [{ at: 4, name: 'Ice Wall', mult: 1.2, selfShield: 0.3, desc: 'a pane grows between you' }],
      elite: [
        { at: 3, name: 'Rime Plate', mult: 1.15, selfDef: 3, desc: 'frost thickens on the mail' },
        { at: 6, name: 'Glacial Brace', mult: 1.35, selfShield: 0.35, lazy: 0.3, desc: 'the wall leans on you' },
      ],
    },
    assassin: {
      trash: [{ at: 4, name: 'Killing Cold', mult: 1.4, paralyze: 0.4, desc: 'breath steams with intent' }],
      elite: [
        { at: 4, name: 'Hoarfrost Bite', mult: 1.35, frail: 0.4, desc: 'teeth like icicles' },
        { at: 6, name: 'Winter Lunge', mult: 1.7, vsStatus: 'frail', vsStatusMult: 1.2, freeze: 0.25, desc: 'the pack finishes the brittle' },
      ],
    },
    attrition: {
      trash: [{ at: 4, name: 'Pale Howl', mult: 1.2, aoe: true, weaken: 0.35, desc: 'the cold gains a voice' }],
      elite: [
        { at: 3, name: 'Chill Tax', mult: 1.25, weaken: 0.4, desc: 'warmth is collected' },
        { at: 6, name: 'Whiteout', mult: 1.5, aoe: true, paralyze: 0.35, desc: 'the hall forgets color' },
      ],
    },
    disruptor: {
      trash: [{ at: 4, name: 'Slip', mult: 1.3, lazy: 0.4, desc: 'the floor ices' }],
      elite: [
        { at: 3, name: 'Black Ice', mult: 1.2, lazy: 0.4, desc: 'a polite hazard' },
        { at: 5, name: 'Court Reproach', mult: 1.55, weaken: 0.4, desc: 'the frozen attendants exhale' },
      ],
    },
    construct: {
      trash: [{ at: 4, name: 'Ice Wall', mult: 1.2, selfShield: 0.3, desc: 'a pane grows between you' }],
      elite: [
        { at: 3, name: 'Rime Plate', mult: 1.15, selfDef: 3, desc: 'frost thickens' },
        { at: 6, name: 'Calve', mult: 1.6, aoe: true, frail: 0.35, desc: 'a slab lets go' },
      ],
    },
  },
  swamp: {
    attrition: {
      trash: [{ at: 4, name: 'Fen Spit', mult: 1.3, poison: 0.45, desc: 'the spit is patient' }],
      elite: [
        { at: 3, name: 'Tadpole Fog', mult: 1.25, poison: 0.4, desc: 'something hatches in the air' },
        { at: 6, name: 'Green Miasma', mult: 1.55, aoe: true, poisonSure: true, desc: 'the aura becomes weather' },
      ],
      passives: { poison: 0.3 },
    },
    tank: {
      trash: [{ at: 4, name: 'Tongue Lash', mult: 1.35, lazy: 0.4, desc: 'something wet uncoils' }],
      elite: [
        { at: 3, name: 'Glue-Tongue', mult: 1.3, lazy: 0.45, poison: 0.3, desc: 'you are an appointment' },
        { at: 6, name: 'Swallow', mult: 1.7, heal: 0.08, weaken: 0.35, desc: 'the maw decides' },
      ],
    },
    assassin: {
      trash: [{ at: 4, name: 'Drain Latch', mult: 1.4, weaken: 0.45, desc: 'will not let go' }],
      elite: [
        { at: 3, name: 'Leech Kiss', mult: 1.35, weaken: 0.4, desc: 'a polite theft' },
        { at: 5, name: 'Empty You', mult: 1.65, vsWounded: 1.2, heal: 0.06, desc: 'finishes the drink' },
      ],
      passives: { lifesteal: 0.22 },
    },
    bruiser: {
      trash: [{ at: 4, name: 'Death Roll', mult: 1.55, frail: 0.4, desc: 'jaws widen past reason' }],
      elite: [
        { at: 4, name: 'Uproot & Swing', mult: 1.45, aoe: true, stun: 0.35, desc: 'a sapling becomes a club' },
        { at: 6, name: 'Bog Slam', mult: 1.75, frail: 0.4, desc: 'the mire applauds' },
      ],
    },
    controller: {
      trash: [{ at: 4, name: 'Curdling Hex', mult: 1.35, weakenSure: true, desc: 'mutters your name backwards' }],
      elite: [
        { at: 3, name: 'Wrong Recipe', mult: 1.3, weaken: 0.4, desc: 'the cauldron notices you' },
        { at: 6, name: 'The Old Recipe', mult: 1.7, aoe: true, lazy: 0.4, desc: 'it boils over' },
      ],
      passives: { caster: true },
    },
    disruptor: {
      trash: [{ at: 4, name: 'False Dawn', mult: 1.25, aoe: true, confused: 0.35, desc: 'burns suddenly brighter' }],
      elite: [
        { at: 3, name: 'Will-Light', mult: 1.2, confused: 0.4, desc: 'the path lies' },
        { at: 6, name: 'Drown the Compass', mult: 1.5, aoe: true, lazy: 0.35, desc: 'down becomes a suggestion' },
      ],
    },
    construct: {
      trash: [{ at: 4, name: 'Peat Crush', mult: 1.4, lazy: 0.35, desc: 'the bank gives way' }],
      elite: [
        { at: 4, name: 'Sink', mult: 1.3, lazy: 0.45, desc: 'the floor is optional' },
        { at: 6, name: 'Fen Collapse', mult: 1.6, aoe: true, poison: 0.3, desc: 'everything goes under' },
      ],
    },
  },
  hell: {
    assassin: {
      trash: [{ at: 4, name: 'Immolating Lunge', mult: 1.5, burn: 0.45, desc: 'flame between the teeth' }],
      elite: [
        { at: 3, name: 'Cinder Snap', mult: 1.35, burn: 0.4, desc: 'a playful ignition' },
        { at: 5, name: 'Chase the Smoke', mult: 1.7, vsStatus: 'burn', vsStatusMult: 1.2, burn: 0.3, desc: 'hunts the one already alight' },
      ],
      passives: { burn: 0.22 },
    },
    controller: {
      trash: [{ at: 4, name: 'Wrong Psalm', mult: 1.3, confused: 0.45, desc: 'the book speaks sideways' }],
      elite: [
        { at: 3, name: 'Burning Gaze', mult: 1.4, burnSure: true, desc: 'pupils ignite' },
        { at: 6, name: 'Chorus of Ash', mult: 1.7, aoe: true, confused: 0.35, desc: 'every eye a different doom' },
      ],
      passives: { caster: true },
    },
    bruiser: {
      trash: [{ at: 4, name: 'Slag Haymaker', mult: 1.55, stun: 0.4, desc: 'the swing arrives like weather' }],
      elite: [
        { at: 4, name: 'Magma Haymaker', mult: 1.45, aoe: true, stun: 0.3, desc: 'knuckles go white' },
        { at: 6, name: 'Core Hit', mult: 1.8, vsStatus: 'burn', vsStatusMult: 1.2, desc: 'cashes the heat' },
      ],
    },
    attrition: {
      trash: [{ at: 4, name: 'Cinder Kiss', mult: 1.35, burn: 0.45, desc: 'a haunt leans in' }],
      elite: [
        { at: 3, name: 'Ember Tax', mult: 1.3, burn: 0.4, desc: 'takes a little warmth' },
        { at: 6, name: 'Ash Bloom', mult: 1.55, aoe: true, burnSure: true, desc: 'the room snows cinders' },
      ],
      passives: { burn: 0.25 },
    },
    disruptor: {
      trash: [{ at: 4, name: 'Cinder Mock', mult: 1.3, weaken: 0.4, desc: 'giggles and points' }],
      elite: [
        { at: 3, name: 'Tantrum', mult: 1.2, aoe: true, weaken: 0.35, desc: 'too much joy' },
        { at: 6, name: 'Scatter Coals', mult: 1.5, frail: 0.4, desc: 'the floor is a grate' },
      ],
    },
    tank: {
      trash: [{ at: 4, name: 'Slag Guard', mult: 1.25, selfShield: 0.3, desc: 'cooling iron between you' }],
      elite: [
        { at: 3, name: 'Molten Brace', mult: 1.2, selfDef: 2, desc: 'the plate re-pours' },
        { at: 6, name: 'Core Detonation', mult: 1.55, aoe: true, burnSure: true, desc: 'chest-runes overbrighten' },
      ],
    },
    construct: {
      trash: [{ at: 4, name: 'Forge Slam', mult: 1.5, stun: 0.4, desc: 'fists remember the anvil' }],
      elite: [
        { at: 3, name: 'Vent', mult: 1.3, aoe: true, burn: 0.35, desc: 'slag-heat' },
        { at: 6, name: 'Re-Forge', mult: 1.2, selfDef: 3, heal: 0.05, desc: 'the cracks weld shut' },
      ],
    },
  },
  throne: {
    controller: {
      trash: [{ at: 4, name: 'Royal Feint', mult: 1.35, confused: 0.4, desc: 'a courtly lie' }],
      elite: [
        { at: 3, name: 'The Story', mult: 1.3, confused: 0.45, desc: 'the throne sells a tale' },
        { at: 6, name: 'Mask Off', mult: 1.8, aoe: true, frailSure: true, desc: 'the secret ends in blood' },
      ],
    },
    bruiser: {
      trash: [{ at: 4, name: 'Iron Decree', mult: 1.45, weaken: 0.4, desc: 'the crown sheds sparks' }],
      elite: [
        { at: 4, name: 'Kingdom\'s Weight', mult: 1.5, aoe: true, weaken: 0.4, desc: 'the room leans on you' },
        { at: 6, name: 'The Question', mult: 1.85, frailSure: true, desc: 'the air takes a side' },
      ],
    },
    disruptor: {
      trash: [{ at: 4, name: 'Protocol', mult: 1.3, paralyze: 0.4, desc: 'you are out of order' }],
      elite: [
        { at: 3, name: 'Contempt', mult: 1.25, weaken: 0.45, desc: 'filed under insolent' },
        { at: 6, name: 'Summary Judgment', mult: 1.75, tormented: 0.4, desc: 'the ledger closes' },
      ],
    },
    assassin: {
      trash: [{ at: 4, name: 'Quiet Writ', mult: 1.5, frail: 0.4, desc: 'signed in your absence' }],
      elite: [
        { at: 3, name: 'Name You', mult: 1.35, frail: 0.4, desc: 'the throne learned it' },
        { at: 6, name: 'Execute', mult: 1.85, vsWounded: 1.25, vsStatus: 'frail', vsStatusMult: 1.2, desc: 'the sentence arrives for the brittle and the wounded' },
      ],
    },
    attrition: {
      trash: [{ at: 4, name: 'Tithe', mult: 1.35, weaken: 0.4, heal: 0.05, desc: 'the court collects' }],
      elite: [
        { at: 3, name: 'Rent', mult: 1.3, weaken: 0.4, desc: 'due on demand' },
        { at: 6, name: 'The Invoice', mult: 1.7, tormented: 0.45, heal: 0.06, desc: 'unpaid interest' },
      ],
    },
    tank: {
      trash: [{ at: 4, name: 'Throne Guard', mult: 1.25, selfShield: 0.3, desc: 'the dais has opinions' }],
      elite: [
        { at: 3, name: 'Hold Court', mult: 1.2, selfDef: 3, desc: 'nobody sits without leave' },
        { at: 6, name: 'Crownfall', mult: 1.6, aoe: true, frail: 0.35, desc: 'gold is still heavy' },
      ],
    },
    construct: {
      trash: [{ at: 4, name: 'Edict', mult: 1.4, weaken: 0.4, desc: 'carved into the step' }],
      elite: [
        { at: 4, name: 'Law of Stone', mult: 1.3, lazy: 0.4, desc: 'the floor agrees with the king' },
        { at: 6, name: 'Seal', mult: 1.55, selfShield: 0.3, desc: 'wax and iron' },
      ],
    },
  },
  wandering: {
    assassin: {
      trash: [{ at: 4, name: 'Nip Tendon', mult: 1.3, frail: 0.45, desc: 'darts for the ankles' }],
      elite: [
        { at: 3, name: 'Nip', mult: 1.25, frail: 0.4, desc: 'a small, ugly cut' },
        { at: 5, name: 'Pile-On', mult: 1.55, vsWounded: 1.2, desc: 'the rest arrive' },
      ],
    },
    attrition: {
      trash: [{ at: 4, name: 'Acid Splash', mult: 1.25, aoe: true, poison: 0.35, desc: 'the blob ripples' }],
      elite: [
        { at: 3, name: 'Drip', mult: 1.2, poison: 0.4, desc: 'it is always dripping' },
        { at: 6, name: 'Split', mult: 1.45, aoe: true, poisonSure: true, desc: 'one becomes several problems' },
      ],
    },
    controller: {
      trash: [{ at: 4, name: 'Wail', mult: 1.2, aoe: true, confused: 0.4, desc: 'draws a breath it doesn\'t need' }],
      elite: [
        { at: 3, name: 'Unquiet', mult: 1.25, confused: 0.4, desc: 'a name you almost know' },
        { at: 6, name: 'Haunt', mult: 1.5, weaken: 0.4, desc: 'it stands in the doorway' },
      ],
    },
    disruptor: {
      trash: [{ at: 4, name: 'Skitter', mult: 1.3, stun: 0.35, desc: 'too many feet' }],
      elite: [
        { at: 3, name: 'Startle', mult: 1.2, stun: 0.4, desc: 'from the rafters' },
        { at: 5, name: 'Scatter', mult: 1.45, aoe: true, frail: 0.3, desc: 'they come back' },
      ],
    },
    bruiser: {
      trash: [{ at: 4, name: 'Heavy Lunge', mult: 1.45, stun: 0.35, desc: 'no subtlety left' }],
      elite: [
        { at: 4, name: 'Corner', mult: 1.4, stun: 0.35, desc: 'the hall shrinks' },
        { at: 6, name: 'Body Check', mult: 1.65, frail: 0.35, desc: 'mass is the plan' },
      ],
    },
    tank: {
      trash: [{ at: 4, name: 'Hunker', mult: 1.2, selfShield: 0.25, desc: 'makes itself a problem' }],
      elite: [
        { at: 3, name: 'Brace', mult: 1.15, selfDef: 2, desc: 'it came to stay' },
        { at: 6, name: 'Shoulder', mult: 1.5, lazy: 0.3, desc: 'you are the door' },
      ],
    },
    construct: {
      trash: [{ at: 4, name: 'Rattle', mult: 1.3, frail: 0.35, desc: 'loose parts, still sharp' }],
      elite: [
        { at: 4, name: 'Shed', mult: 1.25, aoe: true, frail: 0.35, desc: 'screws and teeth' },
        { at: 6, name: 'Seize', mult: 1.5, lazy: 0.35, desc: 'a hand that was a tool' },
      ],
    },
  },
};

function cloneSpecials(list) {
  return list.map(s => ({ ...s }));
}

export function kitFor(biomeId, archetype, elite) {
  const biome = KITS[biomeId] || KITS.wandering;
  const row = biome[archetype] || biome.disruptor || KITS.wandering.disruptor;
  const specials = cloneSpecials(elite ? row.elite : row.trash);
  return { specials, passives: { ...(row.passives || {}) } };
}

/**
 * Replace generic gallery Strike kits. No-op on bosses or already-authored
 * multi-breakpoint kits (2+ named specials that are not the generator stub).
 */
export function applyGalleryKit(enemy, biomeId, opts = {}) {
  if (!enemy || enemy.boss) return enemy;
  const generic = (enemy.specials || []).every(s =>
    !s?.name || s.name === 'Strike' || s.name === 'Heavy Blow' || s.name === 'FINISHER');
  // force: gallery merge path — regen may stamp named Python kits; JS still wins.
  if (!opts.force && !generic) return enemy;
  const arch = inferArchetype(enemy);
  const kit = kitFor(biomeId || 'wandering', arch, !!enemy.elite);
  enemy.specials = kit.specials;
  for (const [k, v] of Object.entries(kit.passives)) {
    if (enemy[k] == null) enemy[k] = v;
  }
  return enemy;
}

export function biomePaletteKeys(biomeId) {
  const biome = KITS[biomeId] || KITS.wandering;
  const keys = new Set();
  for (const row of Object.values(biome)) {
    for (const s of [...(row.trash || []), ...(row.elite || [])]) {
      for (const k of specialRiderKeys(s)) keys.add(k.replace(/Sure$/, ''));
    }
  }
  return [...keys];
}
