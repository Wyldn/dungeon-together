// World-state / narrative engine.
// Extends the existing run.flags + Milestone pattern with structured
// characters, factions, counters, knowledge, event history, and threads.
// Old flag writes still work; FLAG_BRIDGES keep them in sync.

import { noteNarrativeTake } from './eventpace.js';
import { noteDiscovery } from '../compendium_seen.js';

export function emptyWorld() {
  return {
    characters: {},
    factions: {},
    counters: {},
    knowledge: [],
    tags: [],
    usedItems: [],
    locations: [],
    bossesSpared: [],
    events: {},
    threads: {},
    since: {},
  };
}

function worldOf(run) {
  if (!run) return emptyWorld();
  if (!run.world || typeof run.world !== 'object') run.world = emptyWorld();
  const w = run.world;
  w.characters = w.characters || {};
  w.factions = w.factions || {};
  w.counters = w.counters || {};
  w.knowledge = Array.isArray(w.knowledge) ? w.knowledge : [];
  w.tags = Array.isArray(w.tags) ? w.tags : [];
  w.usedItems = Array.isArray(w.usedItems) ? w.usedItems : [];
  w.locations = Array.isArray(w.locations) ? w.locations : [];
  w.bossesSpared = Array.isArray(w.bossesSpared) ? w.bossesSpared : [];
  w.events = w.events || {};
  w.threads = w.threads || {};
  w.since = w.since || {};
  run.flags = run.flags || {};
  return w;
}

export function ensureWorld(run) {
  const w = worldOf(run);
  if (!w._bridged) {
    w._bridged = true;
    applyFlagBridgesFromFlags(run);
  }
  applyTendencyBridgesFromState(run);
  return w;
}

/* ------------------------- catalogs ------------------------- */

export const CHARACTERS = {
  mira: { name: 'Mira', title: 'the Wounded Climber', role: 'climber', faction: 'climbers' },
  lyra: { name: 'Lyra', title: 'the Bard Who Stayed', role: 'bard', faction: 'wanderers' },
  merchant: { name: 'the Hooded Merchant', title: 'of the Vertical Supply Chain', role: 'merchant', faction: 'merchants' },
  assay: { name: 'the Assay Clerk', title: 'who opens the vertical tab', role: 'clerk', faction: 'merchants' },
  ghost_king: { name: 'the King Who Stayed', title: 'of the Sunken Ruins', role: 'ghost', faction: 'the_fallen' },
  witch: { name: 'the Heron-Hut Witch', title: 'who keeps the appointments', role: 'witch', faction: 'mire' },
  vess: { name: 'V', title: 'who leaves dinner out', role: 'host', faction: 'unknown' },
  angel: { name: 'the Chained Light', title: 'who answered wrongly', role: 'angel', faction: 'celestial' },
  oathbound: { name: 'the Oathbound Champion', title: 'of the old knightly cut', role: 'duelist', faction: 'oathbound' },
  gardener: { name: 'the Seed Gardener', title: 'who sells futures', role: 'gardener', faction: 'wanderers' },
  devil: { name: 'the Clause Devil', title: 'of the seventh article', role: 'devil', faction: 'scorch' },
  revenant: { name: 'the Crowned Revenant', title: 'who waits on floor fifteen', role: 'boss', faction: 'the_fallen' },
  gravekeeper: { name: 'the Pale Keeper', title: 'who listens to rent', role: 'keeper', faction: 'pale_choir' },
  channeler: { name: 'the Apostate Channeler', title: 'who left the academy', role: 'mage', faction: 'wanderers' },
  pathfinder: { name: 'the Pathfinder Veteran', title: 'who maps indoors', role: 'ranger', faction: 'wanderers' },
  northman: { name: 'the Axe-Pack Veteran', title: 'who bleeds correctly', role: 'raider', faction: 'wanderers' },
  frost_climber: { name: 'the Thawed Climber', title: 'who almost made the stairs', role: 'climber', faction: 'climbers' },
  bandit_chief: { name: 'the Toll Captain', title: 'of the Vertical Company', role: 'bandit', faction: 'bandits' },
};

/**
 * Portrait keys that uniquely map to a catalog character.
 * `old_man` is shared (merchant / gravekeeper / toll captain) and must not be inferred.
 */
export const NPC_ART_TO_CHAR = {
  girl: 'mira',
  woman: 'lyra',
  soldier: 'ghost_king',
  dark_mage: 'channeler',
  pathfinder_veteran: 'pathfinder',
  axe_northman: 'northman',
};

export const FACTIONS = {
  climbers: { name: 'Fellow Climbers' },
  wanderers: { name: 'Tower Wanderers' },
  merchants: { name: 'Vertical Trade' },
  the_fallen: { name: 'the Fallen Kingdoms' },
  mire: { name: 'the Weeping Mire' },
  forest: { name: 'the Whispering Forest' },
  celestial: { name: 'the Chained Host' },
  oathbound: { name: 'the Oathbound' },
  scorch: { name: 'the Scorch' },
  pale_choir: { name: 'the Pale Choir' },
  bandits: { name: 'the Toll Company' },
  unknown: { name: 'Unaligned' },
};

/**
 * Ordered stages so a thread can be entered late and still make sense.
 * Secret-route discovery is knowledge, not a thread stage — the thread
 * begins at initiation (deferred / accept). Forest anger/peace and the
 * swallowed-seed check live on flags / NPC memory, not extra stages.
 */
export const THREADS = {
  mira: { name: "Mira's Debt", stages: ['met', 'saved', 'betrayed', 'ignored', 'rumored', 'returned', 'closed'] },
  bard: { name: "Lyra's Verse", stages: ['met', 'patron', 'heard', 'encore', 'last_song'] },
  king: { name: "The King's Complaint", stages: ['met', 'petition', 'bowed', 'mocked', 'echoed', 'delivered'] },
  witch: { name: 'The Late Appointment', stages: ['rumored', 'met', 'hinted', 'bell'] },
  pale: { name: 'the Pale Choir', stages: ['whisper', 'tome', 'noticed', 'deferred', 'rite'] },
  oathbound: { name: 'the Oathbound Road', stages: ['met', 'counseled', 'dueled', 'watch', 'gate'] },
  forest: { name: "the Forest's Memory", stages: ['angered', 'peace', 'remembered'] },
  void: { name: 'Margin Notes', stages: ['read', 'footnote', 'deferred', 'annotated'] },
  seed: { name: 'the Swallowed Seed', stages: ['planted', 'bloomed'] },
  doom: { name: 'Colleague Benefits', stages: ['deferred', 'benefits'] },
  storm: { name: 'the Sky Ledger', stages: ['deferred', 'collected'] },
  phantom: { name: 'People Who Aren\'t', stages: ['deferred', 'filed'] },
  heretic: { name: 'the Halo That Forgave', stages: ['deferred', 'vocation'] },
  ashen: { name: 'the Still Strike', stages: ['deferred', 'ash'] },
  dawn: { name: 'Leftover Dawn', stages: ['deferred', 'pact'] },
  eclipse: { name: 'the Gap', stages: ['deferred', 'cut'] },
  valhalla: { name: 'Halls Upstairs', stages: ['deferred', 'notice'] },
  doomsong: { name: 'the Unsung Last Note', stages: ['deferred', 'taken'] },
  assay: { name: 'the Vertical Ledger', stages: ['opened', 'collected', 'settled'] },
};

/**
 * When an existing flag is set (or found on load), mirror it into structured
 * world state. Idempotent — safe on every ensureWorld().
 */
export const FLAG_BRIDGES = {
  bard_friend: { char: { id: 'lyra', met: true, relSet: 3, memory: 'tipped' }, thread: { id: 'bard', stage: 'patron' } },
  saved_climber: { char: { id: 'mira', met: true, alive: true, relSet: 3, memory: 'saved' }, thread: { id: 'mira', stage: 'saved' }, counter: { id: 'mercy', add: 1 } },
  left_climber: { char: { id: 'mira', met: true, alive: true, relSet: -4, memory: 'robbed' }, thread: { id: 'mira', stage: 'betrayed' }, counter: { id: 'cruelty', add: 1 } },
  planted_seed: { char: { id: 'gardener', met: true, memory: 'swallowed_seed' }, thread: { id: 'seed', stage: 'planted' } },
  kings_petition: { char: { id: 'ghost_king', met: true, relSet: 2, memory: 'petition' }, thread: { id: 'king', stage: 'petition' } },
  kings_bowed: { char: { id: 'ghost_king', met: true, relSet: 2, memory: 'bowed' }, thread: { id: 'king', stage: 'bowed' } },
  kings_mocked: { char: { id: 'ghost_king', met: true, relSet: -1, memory: 'mocked' }, thread: { id: 'king', stage: 'mocked' } },
  witch_hint: { char: { id: 'witch', met: true, memory: 'check_under_the_bell' }, knowledge: 'witch_hint', thread: { id: 'witch', stage: 'hinted' } },
  seen_throne: { char: { id: 'witch', met: true, memory: 'drank_tea' }, knowledge: 'seen_throne' },
  freed_angel: { char: { id: 'angel', met: true, alive: true, relSet: 4, memory: 'freed' }, knowledge: 'freed_angel', faction: { id: 'celestial', rel: 3 } },
  angel_lore: { char: { id: 'angel', met: true, memory: 'asked_the_question' }, knowledge: 'angel_lore' },
  clause_seven: { char: { id: 'devil', met: true, relSet: -1, memory: 'signed' }, knowledge: 'clause_seven' },
  ate_v_dinner: { char: { id: 'vess', met: true, relSet: 2, memory: 'ate' }, knowledge: 'ate_v_dinner' },
  v_lore: { char: { id: 'vess', met: true, memory: 'candle' }, knowledge: 'v_lore' },
  tree_lore: { knowledge: 'tree_lore' },
  defiler: { tag: 'defiler', counter: { id: 'sacrilege', add: 1 } },
  stole_rose: { knowledge: 'stole_rose', tag: 'thief' },
  statue_grudge: { tag: 'statue_grudge', faction: { id: 'the_fallen', rel: -2 } },
  angered_forest: { faction: { id: 'forest', rel: -3 }, thread: { id: 'forest', stage: 'angered' } },
  forest_peace: { faction: { id: 'forest', relSet: 0 }, thread: { id: 'forest', stage: 'peace' } },
  paid_toll: { faction: { id: 'bandits', rel: 1 }, knowledge: 'paid_toll', char: { id: 'bandit_chief', met: true, alive: true, relSet: 2, memory: 'paid' } },
  revenant_oath: { char: { id: 'revenant', met: true, memory: 'knelt' }, sparedBoss: 'crowned_revenant' },
  dukes_mark: { knowledge: 'dukes_mark' },
  pilgrim_lore: { knowledge: 'pilgrim_lore' },
  mentor_words: { knowledge: 'mentor_words' },
  evener_met: { knowledge: 'evener_met' },
  freed_climber: { knowledge: 'freed_climber', counter: { id: 'mercy', add: 1 }, char: { id: 'frost_climber', met: true, alive: true, memory: 'thawed' } },
  lit_candle: { knowledge: 'lit_candle' },
  refused_escape: { knowledge: 'refused_escape' },
  origin_arcane: { tag: 'academy' },
  guild_notes: { tag: 'guild' },
  undercity_ties: { faction: { id: 'merchants', rel: 1 } },
  lodge_mark: { tag: 'lodge' },
  guard_trained: { tag: 'guard' },
  let_it_ride: { counter: { id: 'defiance', add: 1 } },
  assay_paid: { char: { id: 'assay', met: true, relSet: 2, memory: 'stamped' }, thread: { id: 'assay', stage: 'opened' }, knowledge: 'assay_stamp' },
  assay_potion: { char: { id: 'assay', met: true, memory: 'vial' }, thread: { id: 'assay', stage: 'opened' }, knowledge: 'assay_vial' },
  assay_blood: { char: { id: 'assay', met: true, memory: 'signed_in_blood' }, thread: { id: 'assay', stage: 'opened' }, knowledge: 'assay_blood' },
  assay_refused: { char: { id: 'assay', met: true, relSet: -1, memory: 'walked' }, thread: { id: 'assay', stage: 'opened' }, knowledge: 'assay_refused' },
  assay_collected_paid: { thread: { id: 'assay', stage: 'collected' }, knowledge: 'assay_refined' },
  assay_collected_foresight: { thread: { id: 'assay', stage: 'collected' }, knowledge: 'assay_foresight' },
  assay_collected_vial: { thread: { id: 'assay', stage: 'collected' }, knowledge: 'assay_vial_returned' },
  assay_collected_drew: { thread: { id: 'assay', stage: 'collected' }, knowledge: 'assay_drew' },
  assay_collected_late: { thread: { id: 'assay', stage: 'collected' } },
  assay_collected_sold: { thread: { id: 'assay', stage: 'collected' } },
  assay_collected_reclaim: { thread: { id: 'assay', stage: 'collected' } },
  assay_collected_bought: { thread: { id: 'assay', stage: 'collected' } },
  assay_debt: { thread: { id: 'assay', stage: 'collected' }, knowledge: 'assay_debt' },
  assay_marked: { thread: { id: 'assay', stage: 'collected' }, tag: 'assay_marked' },
  assay_settled: { thread: { id: 'assay', stage: 'settled' } },
};

/**
 * Hidden habit tallies. Debug labels only — never shown in play.
 * Thresholds open copy / rare eligibility; they do not pay out.
 */
export const TENDENCIES = {
  mercy: { label: 'mercy', warm: 2, marked: 3 },
  cruelty: { label: 'cruelty', warm: 2, marked: 3 },
  greed: { label: 'greed', warm: 2, marked: 3 },
  curiosity: { label: 'curiosity', warm: 2, marked: 3 },
  defiance: { label: 'defiance', warm: 2, marked: 3 },
};

/**
 * Infer tendencies from flags already on the run. Own tags so an older
 * `_bridged_<flag>` mark does not skip a newly authored increment.
 */
export const TENDENCY_FLAG_BRIDGES = {
  stole_rose: { id: 'greed', add: 1 },
  statue_grudge: { id: 'greed', add: 1 },
  kings_mocked: { id: 'defiance', add: 1 },
  refused_escape: { id: 'defiance', add: 1 },
  tree_lore: { id: 'curiosity', add: 1 },
  angel_lore: { id: 'curiosity', add: 1 },
  v_lore: { id: 'curiosity', add: 1 },
  witch_hint: { id: 'curiosity', add: 1 },
  freed_angel: { id: 'mercy', add: 1 },
};

/**
 * Infer tendencies from recorded event choices (old saves and live recordEvent).
 * Match `recordEvent`'s stored label. Own tags so outcome writes do not double.
 */
export const CHOICE_BRIDGES = {
  discarded_kit: { choices: ['Leave a note and move on'], counter: { id: 'mercy', add: 1 } },
  abandoned_armory: { choices: ['Leave it for the next desperate soul'], counter: { id: 'mercy', add: 1 } },
  merchant_tab: { choices: ['Tell him to give it to the next desperate soul'], counter: { id: 'mercy', add: 1 } },
  wounded_adventurer: { choices: ['Walk past'], counter: { id: 'cruelty', add: 1 } },
  frozen_climber: { choices: ['Take their gear'], counter: { id: 'cruelty', add: 1 } },
  chained_angel: { choices: ['Leave it chained'], counter: { id: 'cruelty', add: 1 } },
  gilded_fountain: { choices: ['Take coins OUT instead'], counter: { id: 'greed', add: 1 } },
  royal_crypt: { choices: ['Rob the dead'], counter: { id: 'greed', add: 1 } },
  ancient_tree: { choices: ['Got any gold?'], counter: { id: 'greed', add: 1 } },
  soul_broker: { choices: ['Ask what happens to the bottles'], counter: { id: 'curiosity', add: 1 } },
  mysterious_door: { choices: ['Knock politely'], counter: { id: 'curiosity', add: 1 } },
  buried_library: { choices: ['Decipher it', 'Read the crumbling books instead'], counter: { id: 'curiosity', add: 1 } },
  tax_collector: { choices: ['Refuse outright'], counter: { id: 'defiance', add: 1 } },
};

export function choiceBridgeTag(eventId) {
  return `_tend_choice_${eventId}`;
}

function tendencyFlagTag(flag) {
  return `_tend_${flag}`;
}

export function tendencyBand(run, id) {
  const spec = TENDENCIES[id];
  if (!spec) return 'cold';
  const value = counterValue(run, id);
  if (value >= spec.marked) return 'marked';
  if (value >= spec.warm) return 'warm';
  return 'cold';
}

export function tendencyInspect(run) {
  return Object.entries(TENDENCIES).map(([id, spec]) => ({
    id,
    label: spec.label,
    value: counterValue(run, id),
    warm: spec.warm,
    marked: spec.marked,
    band: tendencyBand(run, id),
  }));
}

/**
 * Hidden subclass discovery. Routes and fallbacks only make an initiation
 * event eligible. The level-6 UI checks `unlock` knowledge, written solely
 * by the diegetic accept choice. Labels are debug-only — never shown in play.
 */
export const SECRET_ROUTES = {
  doomguard: {
    name: 'Doomguard', parent: 'warrior',
    unlock: 'unlock_doomguard',
    initiation: 'doom_benefits',
    routes: [
      { id: 'named', label: 'heard Death name you colleague', when: { knowledge: 'doom_named' } },
    ],
    fallbacks: [
      { id: 'harvest', label: 'killed enough that Death files you as staff', when: { kills: 20 } },
    ],
  },
  void_scholar: {
    name: 'Void Scholar', parent: 'mage',
    unlock: 'unlock_void_scholar',
    initiation: 'void_annotation',
    routes: [
      { id: 'tree', label: 'asked the speaking tree', when: { flag: 'tree_lore' } },
      { id: 'candle', label: 'read the V candle', when: { flag: 'v_lore' } },
      { id: 'witch', label: 'the witch remembered you', when: { flag: 'witch_hint' } },
      { id: 'margin', label: 'read the tower\'s margin notes', when: { knowledge: 'void_margin_read' } },
    ],
    fallbacks: [
      { id: 'archive', label: 'came from the archive', when: { origin: 'archive' } },
      { id: 'channeler', label: 'met the Apostate Channeler', when: { event: 'dark_mage_meet' } },
    ],
  },
  stormcaller: {
    name: 'Stormcaller', parent: 'archer',
    unlock: 'unlock_stormcaller',
    initiation: 'storm_collect',
    routes: [
      { id: 'owed', label: 'the sky marked a debt', when: { knowledge: 'storm_owed' } },
    ],
    fallbacks: [
      { id: 'pathfinder', label: 'used the Pathfinder\'s dirt', when: { event: 'pathfinder_meet' } },
    ],
  },
  phantom: {
    name: 'Phantom', parent: 'rogue',
    unlock: 'unlock_phantom',
    initiation: 'phantom_file',
    routes: [
      { id: 'defiler', label: 'desecrated a shrine', when: { flag: 'defiler' } },
      { id: 'rose', label: 'stole the ice rose', when: { flag: 'stole_rose' } },
      { id: 'mira', label: 'robbed a wounded climber', when: { flag: 'left_climber' } },
      { id: 'ledger', label: 'found the shadow ledger', when: { knowledge: 'shadow_ledger' } },
    ],
    fallbacks: [
      { id: 'saw_ledger', label: 'found the un-writing clerk\'s book', when: { event: 'shadow_ledger' } },
    ],
  },
  heretic_saint: {
    name: 'Heretic Saint', parent: 'priest',
    unlock: 'unlock_heretic_saint',
    initiation: 'halo_vocation',
    routes: [
      { id: 'famous_heretic', label: 'defiled a shrine and stayed known', when: { all: [{ flag: 'defiler' }, { fame: 15 }] } },
      { id: 'halo', label: 'a cracked halo forgave you first', when: { knowledge: 'cracked_halo' } },
    ],
    fallbacks: [
      { id: 'infamous', label: 'infamous enough that light got there first', when: { fame: 40 } },
    ],
  },
  ashen_fist: {
    name: 'Ashen Fist', parent: 'monk',
    unlock: 'unlock_ashen_fist',
    initiation: 'ashen_strike',
    routes: [
      { id: 'still', label: 'stood the still stone', when: { knowledge: 'still_stone' } },
    ],
    fallbacks: [
      { id: 'guarded', label: 'guarded until the guarding burned', when: { guards: 8 } },
    ],
  },
  lightbreaker: {
    name: 'Lightbreaker', parent: 'warlock',
    unlock: 'unlock_lightbreaker',
    initiation: 'dawn_pact',
    routes: [
      { id: 'angel', label: 'freed the chained light', when: { flag: 'freed_angel' } },
      { id: 'heretic', label: 'defiled a shrine and stayed infamous', when: { all: [{ flag: 'defiler' }, { fame: 20 }] } },
      { id: 'heartbeat', label: 'learned of the warrior without a heartbeat', when: { all: [{ knowledge: 'heartbeat_story' }, { flag: 'freed_angel' }] } },
    ],
    fallbacks: [
      { id: 'lore', label: 'asked the chained light the question', when: { flag: 'angel_lore' } },
      { id: 'clause', label: 'signed clause seven and kept looking up', when: { flag: 'clause_seven' } },
    ],
  },
  doomsinger: {
    name: 'Doomsinger', parent: 'bard',
    unlock: 'unlock_doomsinger',
    initiation: 'doomsong_offer',
    routes: [
      { id: 'patron', label: 'tipped the bard who stayed', when: { flag: 'bard_friend' } },
      { id: 'unsung', label: 'heard the verse she never performs', when: { knowledge: 'unsung_verse' } },
    ],
    fallbacks: [
      { id: 'heard', label: 'heard your own verse sung back', when: { knowledge: 'heard_own_verse' } },
      { id: 'medallion', label: 'carry the encore', when: { item: 'encore_medallion' } },
    ],
  },
  lichling: {
    name: 'Lichling', parent: 'necromancer',
    unlock: 'unlock_lichling',
    initiation: 'pale_rite',
    routes: [
      { id: 'whisper', label: 'heard the dead language', when: { knowledge: 'heard_dead_language' } },
      { id: 'study', label: 'heard the dead and read their book', when: { all: [{ knowledge: 'heard_dead_language' }, { knowledge: 'pale_tome' }] } },
      { id: 'offered', label: 'the keeper offered the rite', when: { knowledge: 'pale_rite_offered' } },
      { id: 'choir', label: 'claimed a pale choir gift', when: { event: 'pale_choir_cache' } },
    ],
    fallbacks: [
      { id: 'harvest', label: 'killed enough that the basin already knows', when: { kills: 25 } },
      { id: 'sigil', label: 'carry a sigil that keeps rent-books', when: { sigilCount: 1 } },
    ],
  },
  void_edge: {
    name: 'Void Edge', parent: 'spellsword',
    unlock: 'unlock_void_edge',
    initiation: 'eclipse_accept',
    routes: [
      { id: 'eclipse', label: 'saw the cut between steel and spell', when: { knowledge: 'eclipse_cut' } },
    ],
    fallbacks: [
      { id: 'dummy', label: 'found the dummy that hates being chosen', when: { event: 'eclipse_cut' } },
      { id: 'archive', label: 'owe the archive a margin', when: { flag: 'archive_debt' } },
    ],
  },
  einherjar: {
    name: 'Einherjar', parent: 'viking',
    unlock: 'unlock_einherjar',
    initiation: 'valhalla_notice',
    routes: [
      { id: 'named', label: 'heard Death name you colleague', when: { knowledge: 'doom_named' } },
    ],
    fallbacks: [
      { id: 'axe', label: 'bled for the Axe-Pack Veteran', when: { event: 'axe_northman_meet' } },
      { id: 'harvest', label: 'died correctly enough times, counted in other people', when: { kills: 22 } },
    ],
  },
};

/* ------------------------- accessors ------------------------- */

export function charState(run, id) {
  const w = worldOf(run);
  if (!w.characters[id]) {
    const cat = CHARACTERS[id] || {};
    w.characters[id] = {
      met: false,
      alive: true,
      rel: 0,
      loc: null,
      role: cat.role || null,
      faction: cat.faction || null,
      allegiance: null,
      memories: [],
    };
  }
  return w.characters[id];
}

export function charRel(run, id) {
  return charState(run, id).rel || 0;
}

/** True only when the character was created and then marked dead. Does not spawn a record. */
export function charIsDead(run, id) {
  return run?.world?.characters?.[id]?.alive === false;
}

export function factionState(run, id) {
  const w = worldOf(run);
  if (!w.factions[id]) w.factions[id] = { rel: 0, helped: false, harmed: false };
  return w.factions[id];
}

export function hasKnowledge(run, id) {
  return (worldOf(run).knowledge || []).includes(id);
}

export function threadStage(run, id) {
  return worldOf(run).threads[id]?.stage || null;
}

export function threadStageIndex(id, stage) {
  const stages = THREADS[id]?.stages || [];
  return stages.indexOf(stage);
}

export function counterValue(run, id) {
  return worldOf(run).counters[id] || 0;
}

/* ------------------------- conditions ------------------------- */

function asList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function eventSeen(run, id) {
  if ((run.seenEvents || []).includes(id)) return true;
  return !!worldOf(run).events[id];
}

function hasGear(run, id) {
  const bag = [...Object.values(run.equipment || {}), ...(run.inventory || [])];
  return bag.some(x => x === id || (typeof x === 'string' && x.startsWith(id + '__')));
}

function hasConsumable(run, id) {
  return (run.consumables || []).includes(id);
}

/** Declarative AND-object (combinators: all / any / not). */
export function evalWhen(run, when) {
  if (!when) return true;
  if (typeof when === 'function') return !!when(run);
  if (Array.isArray(when)) return when.every(w => evalWhen(run, w));
  const keys = Object.keys(when);
  if (!keys.length) return true;

  if (when.all) { if (!asList(when.all).every(w => evalWhen(run, w))) return false; }
  if (when.any) { if (!asList(when.any).some(w => evalWhen(run, w))) return false; }
  if (when.not && evalWhen(run, when.not)) return false;

  for (const flag of asList(when.flag || when.flags)) {
    if (!run.flags?.[flag]) return false;
  }
  for (const flag of asList(when.notFlag || when.notFlags)) {
    if (run.flags?.[flag]) return false;
  }
  if (when.floorMin != null && (run.floor || 0) < when.floorMin) return false;
  if (when.floorMax != null && (run.floor || 0) > when.floorMax) return false;
  if (when.biome && run.biomeId !== when.biome) return false;
  if (when.biomes && !when.biomes.includes(run.biomeId)) return false;
  for (const id of asList(when.event || when.events)) {
    if (!eventSeen(run, id)) return false;
  }
  for (const id of asList(when.notEvent || when.notEvents)) {
    if (eventSeen(run, id)) return false;
  }
  if (when.eventChoice) {
    const rec = worldOf(run).events[when.eventChoice.id];
    if (!rec || rec.choice !== when.eventChoice.choice) return false;
  }
  for (const id of asList(when.charMet)) {
    if (!charState(run, id).met) return false;
  }
  for (const id of asList(when.charAlive)) {
    const c = charState(run, id);
    if (!c.met || !c.alive) return false;
  }
  for (const id of asList(when.charDead)) {
    const c = charState(run, id);
    if (!c.met || c.alive) return false;
  }
  if (when.charRelMin) {
    for (const [id, min] of Object.entries(when.charRelMin)) {
      if (charRel(run, id) < min) return false;
    }
  }
  if (when.charRelMax) {
    for (const [id, max] of Object.entries(when.charRelMax)) {
      if (charRel(run, id) > max) return false;
    }
  }
  if (when.factionRelMin) {
    for (const [id, min] of Object.entries(when.factionRelMin)) {
      if ((factionState(run, id).rel || 0) < min) return false;
    }
  }
  if (when.factionRelMax) {
    for (const [id, max] of Object.entries(when.factionRelMax)) {
      if ((factionState(run, id).rel || 0) > max) return false;
    }
  }
  for (const id of asList(when.knowledge)) {
    if (!hasKnowledge(run, id)) return false;
  }
  for (const id of asList(when.notKnowledge)) {
    if (hasKnowledge(run, id)) return false;
  }
  if (when.counterMin) {
    for (const [id, min] of Object.entries(when.counterMin)) {
      if (counterValue(run, id) < min) return false;
    }
  }
  if (when.thread) {
    const want = typeof when.thread === 'string' ? { id: when.thread } : when.thread;
    const stage = threadStage(run, want.id);
    if (want.stage && stage !== want.stage) return false;
    if (want.stages && !want.stages.includes(stage)) return false;
    if (!want.stage && !want.stages && !stage) return false;
  }
  if (when.threadAtLeast) {
    const { id, stage } = when.threadAtLeast;
    const have = threadStageIndex(id, threadStage(run, id));
    const need = threadStageIndex(id, stage);
    if (need < 0 || have < need) return false;
  }
  for (const id of asList(when.item)) {
    if (!hasGear(run, id) && !hasConsumable(run, id) && !(run.relics || []).includes(id)) return false;
  }
  for (const id of asList(when.usedItem)) {
    if (!(worldOf(run).usedItems || []).includes(id)) return false;
  }
  for (const id of asList(when.sigil)) {
    if (!(run.sigils || []).includes(id)) return false;
  }
  if (when.sigilCount != null && (run.sigils || []).length < when.sigilCount) return false;
  if (when.kills != null && (run.kills || 0) < when.kills) return false;
  if (when.guards != null && (run.guardCount || 0) < when.guards) return false;
  if (when.fame != null && (run.fame || 0) < when.fame) return false;
  if (when.gold != null && (run.gold || 0) < when.gold) return false;
  if (when.level != null && (run.level || 1) < when.level) return false;
  if (when.classId && run.classId !== when.classId) return false;
  if (when.classes && !when.classes.includes(run.classId)) return false;
  if (when.subclassId && run.subclassId !== when.subclassId) return false;
  if (when.secretTaken && !secretPathTaken(run)) return false;
  if (when.race && run.raceId !== when.race) return false;
  if (when.origin && run.originId !== when.origin) return false;
  if (when.coop === true && !run.coopMode) return false;
  if (when.coop === false && run.coopMode) return false;
  if (when.statMin) {
    for (const [stat, min] of Object.entries(when.statMin)) {
      if ((run.stats?.[stat] || 0) < min) return false;
    }
  }
  if (when.bossPick) {
    const spec = typeof when.bossPick === 'object' ? when.bossPick : { floor: when.bossPick };
    const picked = run.bossPicks?.[spec.floor];
    if (spec.id && picked !== spec.id) return false;
    if (spec.notId && picked === spec.notId) return false;
    if (spec.id == null && spec.notId == null && !picked) return false;
  }
  if (when.bossCleared != null) {
    const list = run.climb?.bossesCleared || [];
    const ok = list.some(b => b.floor === when.bossCleared || b.id === when.bossCleared || b.name === when.bossCleared);
    if (!ok) return false;
  }
  for (const id of asList(when.bossSpared)) {
    if (!(worldOf(run).bossesSpared || []).includes(id)) return false;
  }
  for (const id of asList(when.secretEligible)) {
    if (!secretEligible(run, id)) return false;
  }
  for (const id of asList(when.secretUnlocked)) {
    if (!secretUnlocked(run, id)) return false;
  }
  for (const id of asList(when.notSecretUnlocked)) {
    if (secretUnlocked(run, id)) return false;
  }
  return true;
}

function eventEligibleOne(ev, state, { exclude = [], excludeFamilies = [] } = {}) {
  if (!ev) return false;
  if (ev.biome !== 'any' && ev.biome !== state.biomeId) return false;
  if (ev.once && (state.seenEvents || []).includes(ev.id)) return false;
  if (exclude.includes(ev.id)) return false;
  if (ev.family && excludeFamilies.includes(ev.family)) return false;
  if (ev.cond && !ev.cond(state)) return false;
  if (ev.when && !evalWhen(state, ev.when)) return false;
  return true;
}

/** Class / secret gates may open for any party member. Accept stays personal. */
function whenTouchesClassOrSecret(when) {
  if (!when || typeof when !== 'object') return false;
  if (when.classId || when.classes || when.secretEligible
      || when.secretUnlocked || when.notSecretUnlocked) return true;
  if (when.all) return asList(when.all).some(whenTouchesClassOrSecret);
  if (when.any) return asList(when.any).some(whenTouchesClassOrSecret);
  if (when.not) return whenTouchesClassOrSecret(when.not);
  return false;
}

/** Compact view so the host can draw class/secret cards for a companion. */
export function eligibilitySnapshot(run) {
  if (!run) return null;
  const w = worldOf(run);
  return {
    classId: run.classId || null,
    raceId: run.raceId || null,
    originId: run.originId || null,
    subclassId: run.subclassId || null,
    knowledge: [...(w.knowledge || [])],
    flags: Object.keys(run.flags || {}).filter(k => run.flags[k]),
    seenEvents: [...(run.seenEvents || [])],
    kills: run.kills || 0,
    guards: run.guardCount || 0,
    fame: run.fame || 0,
    gold: run.gold || 0,
    level: run.level || 1,
    stats: { ...(run.stats || {}) },
    underdog: !!run.underdog,
    coopMode: !!run.coopMode,
  };
}

export function overlayPartyView(host, snap) {
  if (!host || !snap) return host;
  const flags = {};
  for (const k of snap.flags || []) flags[k] = true;
  return {
    ...host,
    classId: snap.classId || host.classId,
    raceId: snap.raceId || host.raceId,
    originId: snap.originId || host.originId,
    subclassId: snap.subclassId ?? host.subclassId,
    flags,
    seenEvents: snap.seenEvents || [],
    kills: snap.kills ?? 0,
    guardCount: snap.guards ?? 0,
    fame: snap.fame ?? 0,
    gold: snap.gold ?? 0,
    level: snap.level ?? 1,
    stats: snap.stats || host.stats,
    underdog: !!snap.underdog,
    coopMode: snap.coopMode ?? host.coopMode,
    world: { ...emptyWorld(), knowledge: [...(snap.knowledge || [])] },
  };
}

export function eventEligible(ev, state, { exclude = [], excludeFamilies = [], party = [] } = {}) {
  const opts = { exclude, excludeFamilies };
  if (eventEligibleOne(ev, state, opts)) return true;
  if (!party.length || !whenTouchesClassOrSecret(ev.when)) return false;
  return party.some(snap => eventEligibleOne(ev, overlayPartyView(state, snap), opts));
}

/** First matching text variant overlays title/text/choices. First matching `append` adds one extra sentence. */
export function presentEvent(ev, state) {
  if (!ev?.variants?.length) return ev;
  let overlay = null;
  let extra = null;
  let variantId = null;
  for (const v of ev.variants) {
    if (v.when && !evalWhen(state, v.when)) continue;
    if (v.append != null) {
      if (!extra) {
        extra = v.append;
        if (!variantId && v.id) variantId = v.id;
      }
      continue;
    }
    if (!overlay) {
      overlay = v;
      variantId = v.id || variantId;
    }
  }
  if (!overlay && !extra) return ev;
  const text = extra
    ? `${overlay?.text ?? ev.text} ${extra}`
    : (overlay?.text ?? ev.text);
  return {
    ...ev,
    title: overlay?.title ?? ev.title,
    text,
    glyph: overlay?.glyph ?? ev.glyph,
    npc: overlay?.npc ?? ev.npc,
    choices: overlay?.choices ?? ev.choices,
    variantId: variantId || null,
  };
}

/** First matching boss variant overlays intro/taunt. Copy only — no mechanics. */
export function presentBoss(boss, state) {
  if (!boss?.variants?.length) return boss;
  for (const v of boss.variants) {
    if (v.when && !evalWhen(state, v.when)) continue;
    return {
      ...boss,
      intro: v.intro ?? boss.intro,
      taunt: v.taunt ?? boss.taunt,
      variantId: v.id || null,
    };
  }
  return boss;
}

/* ------------------------- mutations ------------------------- */

function pushUnique(arr, id) {
  if (id && !arr.includes(id)) arr.push(id);
}

function remember(char, memory) {
  if (!memory) return;
  if (!char.memories.includes(memory)) char.memories.push(memory);
}

function stampSince(run, key) {
  if (!key) return;
  const w = worldOf(run);
  w.since = w.since || {};
  if (w.since[key] == null) w.since[key] = run.floor || 0;
}

/** World/flag bits of an event outcome — shared by live applyOutcome and headless. */
export function applyOutcomeWorld(run, o) {
  if (!o || typeof o !== 'object') return;
  if (o.flag) applyWorldPatch(run, { flag: o.flag });
  if (o.flag2) applyWorldPatch(run, { flag: o.flag2 });
  if (o.clearFlag) applyWorldPatch(run, { clearFlag: o.clearFlag });
  if (o.world) applyWorldPatch(run, o.world);
  if (o.useItem) applyWorldPatch(run, { usedItem: o.useItem });
}

export function applyWorldPatch(run, patch, { stamp = true } = {}) {
  if (!patch || typeof patch !== 'object') return;
  const w = worldOf(run);

  if (patch.flag) {
    run.flags[patch.flag] = true;
    if (stamp) stampSince(run, patch.flag);
    applyFlagBridge(run, patch.flag, { stamp });
  }
  if (patch.clearFlag) delete run.flags[patch.clearFlag];
  if (patch.flags) {
    for (const f of asList(patch.flags)) {
      run.flags[f] = true;
      if (stamp) stampSince(run, f);
      applyFlagBridge(run, f, { stamp });
    }
  }

  if (patch.char) {
    const p = patch.char;
    const c = charState(run, p.id);
    if (p.met) c.met = true;
    if (p.alive === false || p.dead) c.alive = false;
    if (p.alive === true) c.alive = true;
    if (typeof p.rel === 'number') {
      c.rel = p.relSet ? p.rel : c.rel + p.rel;
    }
    if (typeof p.relSet === 'number') c.rel = p.relSet;
    if (p.loc) c.loc = p.loc;
    if (p.role) c.role = p.role;
    if (p.faction) c.faction = p.faction;
    if (p.allegiance) c.allegiance = p.allegiance;
    remember(c, p.memory);
    for (const m of asList(p.memories)) remember(c, m);
  }

  if (patch.faction) {
    const p = patch.faction;
    const f = factionState(run, p.id);
    if (typeof p.rel === 'number') f.rel = p.relSet ? p.rel : f.rel + p.rel;
    if (typeof p.relSet === 'number') f.rel = p.relSet;
    if (p.helped) f.helped = true;
    if (p.harmed) f.harmed = true;
  }

  if (patch.counter) {
    const p = patch.counter;
    w.counters[p.id] = Math.max(0, (w.counters[p.id] || 0) + (p.add != null ? p.add : 1));
  }

  for (const id of asList(patch.knowledge)) {
    const first = !(w.knowledge || []).includes(id);
    pushUnique(w.knowledge, id);
    if (first && stamp) stampSince(run, id);
  }
  if (patch.unlockSecret) {
    const key = unlockKnowledgeId(patch.unlockSecret);
    if (key) {
      const first = !(w.knowledge || []).includes(key);
      pushUnique(w.knowledge, key);
      if (first && stamp) stampSince(run, key);
    }
  }
  for (const id of asList(patch.tag || patch.tags)) pushUnique(w.tags, id);
  for (const id of asList(patch.usedItem || patch.usedItems)) pushUnique(w.usedItems, id);
  for (const id of asList(patch.location || patch.locations)) pushUnique(w.locations, id);
  for (const id of asList(patch.sparedBoss || patch.bossesSpared)) pushUnique(w.bossesSpared, id);

  if (patch.thread) {
    const p = patch.thread;
    const prev = w.threads[p.id]?.stage;
    const prevIdx = threadStageIndex(p.id, prev);
    const nextIdx = threadStageIndex(p.id, p.stage);
    // Do not rewind a thread unless explicitly forced.
    if (p.force || nextIdx < 0 || prevIdx < 0 || nextIdx >= prevIdx) {
      const prevFloor = w.threads[p.id]?.floor;
      const changed = prev !== p.stage;
      w.threads[p.id] = {
        ...(w.threads[p.id] || {}),
        stage: p.stage,
        status: p.status || 'active',
        floor: stamp && (changed || prevFloor == null) ? (run.floor || 0) : prevFloor,
      };
    }
  }
}

export function applyFlagBridge(run, flag, { stamp = true } = {}) {
  if (stamp) stampSince(run, flag);
  const bridge = FLAG_BRIDGES[flag];
  if (bridge) {
    const w = worldOf(run);
    const mark = `_bridged_${flag}`;
    if (!w.tags.includes(mark)) {
      w.tags.push(mark);
      applyWorldPatch(run, bridge, { stamp });
    }
  }
  applyTendencyFlagBridge(run, flag);
}

export function applyFlagBridgesFromFlags(run) {
  for (const flag of Object.keys(run.flags || {})) {
    if (run.flags[flag]) applyFlagBridge(run, flag, { stamp: false });
  }
}

export function applyTendencyFlagBridge(run, flag) {
  const spec = TENDENCY_FLAG_BRIDGES[flag];
  if (!spec) return;
  const w = worldOf(run);
  const mark = tendencyFlagTag(flag);
  if (w.tags.includes(mark)) return;
  w.tags.push(mark);
  applyWorldPatch(run, { counter: spec }, { stamp: false });
}

export function applyChoiceBridge(run, eventId, choice) {
  const spec = CHOICE_BRIDGES[eventId];
  if (!spec || !choice) return;
  if (!spec.choices.includes(choice)) return;
  const w = worldOf(run);
  const mark = choiceBridgeTag(eventId);
  if (w.tags.includes(mark)) return;
  w.tags.push(mark);
  applyWorldPatch(run, { counter: spec.counter }, { stamp: false });
}

export function applyTendencyBridgesFromState(run) {
  for (const flag of Object.keys(run.flags || {})) {
    if (run.flags[flag]) applyTendencyFlagBridge(run, flag);
  }
  const events = worldOf(run).events || {};
  for (const [id, rec] of Object.entries(events)) {
    if (rec?.choice) applyChoiceBridge(run, id, rec.choice);
  }
}

export function recordEvent(run, ev, { choice = null, variantId = null } = {}) {
  if (!run || !ev?.id) return;
  noteDiscovery(ev.id);
  const w = worldOf(run);
  const prev = w.events[ev.id] || { count: 0 };
  const sameVisit = prev.seen && prev.floor === run.floor;
  w.events[ev.id] = {
    seen: true,
    count: sameVisit ? (prev.count || 1) : (prev.count || 0) + 1,
    floor: run.floor,
    choice: choice || prev.choice || null,
    variantId: variantId || ev.variantId || prev.variantId || null,
  };
  if (ev.family && ev.thread && ev.stage) {
    applyWorldPatch(run, { thread: { id: ev.thread, stage: ev.stage } });
  }
  if (ev.onSee && !sameVisit) applyWorldPatch(run, ev.onSee);
  if (!sameVisit) noteNarrativeTake(run, ev);
}

/* ------------------------- secrets / debug ------------------------- */

export function unlockKnowledgeId(id) {
  const spec = SECRET_ROUTES[id];
  if (!spec) return null;
  return spec.unlock || null;
}

function eligibilityRoutes(spec) {
  return [...(spec.routes || []), ...(spec.fallbacks || [])];
}

/** Requirements / fallbacks met — initiation event may appear. Never the level-6 UI. */
export function secretEligible(run, id) {
  const spec = SECRET_ROUTES[id];
  if (!spec) return false;
  if (secretUnlocked(run, id)) return true;
  if (spec.parent && run.classId && run.classId !== spec.parent) return false;
  return eligibilityRoutes(spec).some(r => evalWhen(run, r.when));
}

/** Live subclass is a secret path. Unlock knowledge or a declined
 *  initiation is not enough — those only make the level-6 option appear. */
export function secretPathTaken(run) {
  return !!(run?.subclassId && SECRET_ROUTES[run.subclassId]);
}

/** True after the diegetic accept writes the unlock key, or the run
 *  already selected that secret subclass (legacy saves). */
export function secretUnlocked(run, id) {
  const spec = SECRET_ROUTES[id];
  if (!spec) return false;
  if (run.subclassId === id) return true;
  if (!spec.unlock) return false;
  return hasKnowledge(run, spec.unlock);
}

/** Keep world knowledge in sync when a secret is already the live subclass. */
export function syncSecretUnlockFromSubclass(run) {
  if (!run?.subclassId || !SECRET_ROUTES[run.subclassId]) return;
  applyWorldPatch(run, { unlockSecret: run.subclassId });
}

export function secretProgress(run, id) {
  const spec = SECRET_ROUTES[id];
  if (!spec) return null;
  const routes = (spec.routes || []).map(r => ({
    id: r.id, kind: 'route', label: r.label,
    ok: evalWhen(run, r.when), explain: explainWhen(run, r.when),
  }));
  const fallbacks = (spec.fallbacks || []).map(r => ({
    id: r.id, kind: 'fallback', label: r.label,
    ok: evalWhen(run, r.when), explain: explainWhen(run, r.when),
  }));
  const all = [...routes, ...fallbacks];
  return {
    id,
    name: spec.name,
    parent: spec.parent,
    initiation: spec.initiation || null,
    unlockKey: spec.unlock || null,
    eligible: secretEligible(run, id),
    unlocked: secretUnlocked(run, id),
    routeCount: all.length,
    metCount: all.filter(r => r.ok).length,
    routes: all,
  };
}

export function allSecretProgress(run) {
  return Object.keys(SECRET_ROUTES).map(id => secretProgress(run, id));
}

function clause(ok, text) {
  return { ok, text };
}

export function explainWhen(run, when) {
  if (!when) return { ok: true, parts: [clause(true, 'no condition')] };
  if (typeof when === 'function') {
    const ok = !!when(run);
    return { ok, parts: [clause(ok, ok ? 'function cond passed' : 'function cond failed')] };
  }
  if (Array.isArray(when)) {
    const inner = when.map(w => explainWhen(run, w));
    return { ok: inner.every(x => x.ok), parts: inner.flatMap(x => x.parts) };
  }
  const parts = [];
  const add = (ok, text) => { parts.push(clause(ok, text)); };

  if (when.all) {
    const inner = asList(when.all).map(w => explainWhen(run, w));
    add(inner.every(x => x.ok), 'all: ' + inner.map(x => x.ok ? 'ok' : 'fail').join(', '));
    inner.forEach(x => parts.push(...x.parts));
  }
  if (when.any) {
    const inner = asList(when.any).map(w => explainWhen(run, w));
    add(inner.some(x => x.ok), 'any: ' + inner.map(x => x.ok ? 'ok' : 'fail').join(', '));
    inner.forEach(x => parts.push(...x.parts));
  }
  if (when.not) {
    const inner = explainWhen(run, when.not);
    add(!inner.ok, inner.ok ? 'blocked by NOT clause' : 'NOT clause clear');
    parts.push(...inner.parts);
  }

  for (const flag of asList(when.flag || when.flags)) {
    add(!!run.flags?.[flag], `flag ${flag} ${run.flags?.[flag] ? 'set' : 'missing'}`);
  }
  for (const flag of asList(when.notFlag || when.notFlags)) {
    add(!run.flags?.[flag], `notFlag ${flag} ${run.flags?.[flag] ? 'SET (blocked)' : 'clear'}`);
  }
  if (when.floorMin != null) add((run.floor || 0) >= when.floorMin, `floor ≥ ${when.floorMin} (now ${run.floor || 0})`);
  if (when.floorMax != null) add((run.floor || 0) <= when.floorMax, `floor ≤ ${when.floorMax} (now ${run.floor || 0})`);
  if (when.biome) add(run.biomeId === when.biome, `biome ${when.biome} (now ${run.biomeId})`);
  if (when.biomes) add(when.biomes.includes(run.biomeId), `biome in [${when.biomes.join('/')}] (now ${run.biomeId || '—'})`);
  for (const id of asList(when.event || when.events)) {
    add(eventSeen(run, id), `seen event ${id}`);
  }
  for (const id of asList(when.notEvent || when.notEvents)) {
    add(!eventSeen(run, id), `not seen event ${id}`);
  }
  if (when.eventChoice) {
    const rec = worldOf(run).events[when.eventChoice.id];
    const have = rec?.choice || '—';
    add(!!rec && rec.choice === when.eventChoice.choice, `event ${when.eventChoice.id} choice ${when.eventChoice.choice} (now ${have})`);
  }
  for (const id of asList(when.charMet)) {
    add(!!charState(run, id).met, `met ${id}`);
  }
  for (const id of asList(when.charAlive)) {
    const c = charState(run, id);
    add(!!(c.met && c.alive), `${id} alive`);
  }
  for (const id of asList(when.charDead)) {
    const c = charState(run, id);
    add(!!(c.met && !c.alive), `${id} dead`);
  }
  if (when.charRelMin) {
    for (const [id, min] of Object.entries(when.charRelMin)) {
      add(charRel(run, id) >= min, `${id} rel ≥ ${min} (now ${charRel(run, id)})`);
    }
  }
  if (when.charRelMax) {
    for (const [id, max] of Object.entries(when.charRelMax)) {
      add(charRel(run, id) <= max, `${id} rel ≤ ${max} (now ${charRel(run, id)})`);
    }
  }
  if (when.factionRelMin) {
    for (const [id, min] of Object.entries(when.factionRelMin)) {
      const rel = factionState(run, id).rel || 0;
      add(rel >= min, `faction ${id} rel ≥ ${min} (now ${rel})`);
    }
  }
  if (when.factionRelMax) {
    for (const [id, max] of Object.entries(when.factionRelMax)) {
      const rel = factionState(run, id).rel || 0;
      add(rel <= max, `faction ${id} rel ≤ ${max} (now ${rel})`);
    }
  }
  for (const id of asList(when.knowledge)) {
    add(hasKnowledge(run, id), `knowledge ${id} ${hasKnowledge(run, id) ? 'known' : 'unknown'}`);
  }
  for (const id of asList(when.notKnowledge)) {
    add(!hasKnowledge(run, id), `not knowledge ${id}`);
  }
  if (when.counterMin) {
    for (const [id, min] of Object.entries(when.counterMin)) {
      const have = counterValue(run, id);
      add(have >= min, `counter ${id} ≥ ${min} (now ${have})`);
    }
  }
  if (when.thread) {
    const want = typeof when.thread === 'string' ? { id: when.thread } : when.thread;
    const stage = threadStage(run, want.id);
    if (want.stage) add(stage === want.stage, `thread ${want.id} is ${want.stage} (now ${stage || '—'})`);
    else if (want.stages) add(want.stages.includes(stage), `thread ${want.id} in [${want.stages.join('/')}] (now ${stage || '—'})`);
    else add(!!stage, `thread ${want.id} started`);
  }
  if (when.threadAtLeast) {
    const { id, stage } = when.threadAtLeast;
    const have = threadStage(run, id);
    const haveIdx = threadStageIndex(id, have);
    const need = threadStageIndex(id, stage);
    add(need >= 0 && haveIdx >= need, `thread ${id} at least ${stage} (now ${have || '—'})`);
  }
  for (const id of asList(when.item)) {
    const have = hasGear(run, id) || hasConsumable(run, id) || (run.relics || []).includes(id);
    add(have, `item ${id} ${have ? 'held' : 'missing'}`);
  }
  for (const id of asList(when.usedItem)) {
    add((worldOf(run).usedItems || []).includes(id), `used item ${id}`);
  }
  for (const id of asList(when.sigil)) {
    add((run.sigils || []).includes(id), `sigil ${id} ${(run.sigils || []).includes(id) ? 'held' : 'missing'}`);
  }
  if (when.kills != null) add((run.kills || 0) >= when.kills, `kills ≥ ${when.kills} (now ${run.kills || 0})`);
  if (when.guards != null) add((run.guardCount || 0) >= when.guards, `guards ≥ ${when.guards} (now ${run.guardCount || 0})`);
  if (when.fame != null) add((run.fame || 0) >= when.fame, `fame ≥ ${when.fame} (now ${run.fame || 0})`);
  if (when.gold != null) add((run.gold || 0) >= when.gold, `gold ≥ ${when.gold} (now ${run.gold || 0})`);
  if (when.level != null) add((run.level || 1) >= when.level, `level ≥ ${when.level} (now ${run.level || 1})`);
  if (when.sigilCount != null) add((run.sigils || []).length >= when.sigilCount, `sigils ≥ ${when.sigilCount} (now ${(run.sigils || []).length})`);
  if (when.classId) add(run.classId === when.classId, `class ${when.classId} (now ${run.classId})`);
  if (when.classes) add(when.classes.includes(run.classId), `class in [${when.classes.join('/')}] (now ${run.classId || '—'})`);
  if (when.subclassId) add(run.subclassId === when.subclassId, `subclass ${when.subclassId} (now ${run.subclassId || '—'})`);
  if (when.secretTaken) {
    const taken = secretPathTaken(run);
    add(taken, `secret path taken (now ${taken ? run.subclassId : 'no'})`);
  }
  if (when.race) add(run.raceId === when.race, `race ${when.race} (now ${run.raceId || '—'})`);
  if (when.origin) add(run.originId === when.origin, `origin ${when.origin} (now ${run.originId || '—'})`);
  if (when.coop === true) add(!!run.coopMode, `coop required (now ${run.coopMode ? 'yes' : 'no'})`);
  if (when.coop === false) add(!run.coopMode, `solo required (now ${run.coopMode ? 'coop' : 'solo'})`);
  if (when.statMin) {
    for (const [stat, min] of Object.entries(when.statMin)) {
      add((run.stats?.[stat] || 0) >= min, `${stat} ≥ ${min} (now ${run.stats?.[stat] || 0})`);
    }
  }
  if (when.bossPick) {
    const spec = typeof when.bossPick === 'object' ? when.bossPick : { floor: when.bossPick };
    const picked = run.bossPicks?.[spec.floor];
    if (spec.id) add(picked === spec.id, `boss pick F${spec.floor} is ${spec.id} (now ${picked || '—'})`);
    else if (spec.notId) add(picked !== spec.notId, `boss pick F${spec.floor} is not ${spec.notId} (now ${picked || '—'})`);
    else add(!!picked, `boss pick F${spec.floor} set (now ${picked || '—'})`);
  }
  if (when.bossCleared != null) {
    const list = run.climb?.bossesCleared || [];
    const ok = list.some(b => b.floor === when.bossCleared || b.id === when.bossCleared || b.name === when.bossCleared);
    add(ok, `boss cleared ${when.bossCleared}`);
  }
  for (const id of asList(when.bossSpared)) {
    add((worldOf(run).bossesSpared || []).includes(id), `boss spared ${id}`);
  }
  for (const id of asList(when.secretEligible)) {
    add(secretEligible(run, id), `secretEligible ${id} ${secretEligible(run, id) ? 'yes' : 'no'}`);
  }
  for (const id of asList(when.secretUnlocked)) {
    add(secretUnlocked(run, id), `secretUnlocked ${id} ${secretUnlocked(run, id) ? 'yes' : 'no'}`);
  }
  for (const id of asList(when.notSecretUnlocked)) {
    add(!secretUnlocked(run, id), `not unlocked ${id}`);
  }

  return { ok: evalWhen(run, when), parts: parts.length ? parts : [clause(evalWhen(run, when), 'condition')] };
}

export function explainEligibility(ev, state) {
  const parts = [];
  const add = (ok, text) => { parts.push(clause(ok, text)); };
  if (!ev) return { ok: false, parts: [clause(false, 'missing event')] };
  let ok = true;
  const gate = (pass, text) => { add(pass, text); if (!pass) ok = false; };
  gate(ev.biome === 'any' || ev.biome === state.biomeId, `biome ${ev.biome} (now ${state.biomeId})`);
  if (ev.once) gate(!(state.seenEvents || []).includes(ev.id), `once — ${(state.seenEvents || []).includes(ev.id) ? 'already seen' : 'not yet seen'}`);
  if (ev.cond) {
    let passed = false;
    try { passed = !!ev.cond(state); } catch { passed = false; }
    gate(passed, `cond() ${passed ? 'passed' : 'failed'}`);
  }
  if (ev.when) {
    const inner = explainWhen(state, ev.when);
    gate(inner.ok, `when ${inner.ok ? 'matched' : 'not matched'}`);
    parts.push(...inner.parts);
  }
  if (!ev.cond && !ev.when && !ev.once) add(true, 'always eligible in this biome');
  return { ok, parts };
}

function threadInspect(id, live) {
  const stages = THREADS[id]?.stages || [];
  const stage = live?.stage || null;
  const idx = threadStageIndex(id, stage);
  if (!stage || idx < 0) {
    return { stage: null, status: 'dormant', stageIndex: 0, stageCount: stages.length, floor: live?.floor ?? null };
  }
  return {
    stage,
    status: idx === stages.length - 1 ? 'resolved' : 'active',
    stageIndex: idx + 1,
    stageCount: stages.length,
    floor: live?.floor ?? null,
  };
}

export function worldDebugSnapshot(run) {
  const w = ensureWorld(run);
  const characters = Object.entries(CHARACTERS).map(([id, cat]) => {
    const c = w.characters[id];
    return {
      id,
      name: cat.name,
      title: cat.title || '',
      met: !!c?.met,
      alive: c ? c.alive !== false : true,
      rel: c?.rel || 0,
      loc: c?.loc || null,
      memories: [...(c?.memories || [])],
    };
  });
  const factions = Object.entries(FACTIONS).map(([id, cat]) => {
    const f = w.factions[id] || { rel: 0, helped: false, harmed: false };
    return { id, name: cat.name, rel: f.rel || 0, helped: !!f.helped, harmed: !!f.harmed };
  });
  const threads = Object.entries(THREADS).map(([id, cat]) => ({
    id,
    name: cat.name,
    ...threadInspect(id, w.threads[id]),
  }));
  return {
    run: {
      name: run.name || null,
      floor: run.floor || 0,
      biome: run.biomeId || null,
      classId: run.classId || null,
      seed: run.seed ?? null,
      level: run.level || 1,
    },
    flags: { ...run.flags },
    knowledge: [...w.knowledge],
    counters: { ...w.counters },
    tendencies: tendencyInspect(run),
    tags: w.tags.filter(t => !t.startsWith('_bridged_') && !t.startsWith('_tend_')),
    usedItems: [...w.usedItems],
    bossesSpared: [...w.bossesSpared],
    characters,
    factions,
    threads,
    events: { ...w.events },
    secrets: allSecretProgress(run),
  };
}

export function cloneRunState(run) {
  if (!run) return null;
  return JSON.parse(JSON.stringify(run));
}

/** Replace `target` in place so inspector callers can keep the same run reference. */
export function restoreRunState(target, source) {
  if (!target || !source) return target;
  const copy = cloneRunState(source);
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, copy);
  return target;
}

/** Scratch World session: always poke a deep clone. Never touch the live/persisted objects. */
export function beginWorldInspect(liveRun, persistedRun) {
  const source = liveRun || persistedRun || null;
  if (!source) return null;
  return {
    source: liveRun ? 'live' : 'persisted',
    live: liveRun || null,
    baseline: cloneRunState(source),
    working: cloneRunState(source),
  };
}

export function resetWorldInspect(session) {
  if (!session?.working || !session.baseline) return;
  restoreRunState(session.working, session.baseline);
}

/** Drop the scratch copy. Returns the original live run (or null if World opened from a save only). */
export function endWorldInspect(session) {
  if (!session) return null;
  return session.live || null;
}

/** Dev inspector mutations — same patches as play, plus thread rewind. Never writes saves. */
export function worldPoke(run, action) {
  if (!run || !action || typeof action !== 'object') return;
  if (action.flag) applyWorldPatch(run, { flag: action.flag });
  if (action.knowledge) applyWorldPatch(run, { knowledge: action.knowledge });
  if (action.thread) {
    applyWorldPatch(run, { thread: { id: action.thread.id, stage: action.thread.stage, force: true } });
  }
  if (action.char) {
    const p = action.char;
    applyWorldPatch(run, { char: p });
    if (p.id && p.met === false) charState(run, p.id).met = false;
  }
  if (action.counter) applyWorldPatch(run, { counter: action.counter });
}
