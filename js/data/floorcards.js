// Pure floor-card generation — shared by live game.js and run-health telemetry.
// Callers own rng.advance(). No module-level run.

import { CONFIG } from './config.js';
import { TDC } from './tdc.js';
import { drawEvent, findEvent, liveEventCatalog } from './events.js';
import { NARRATIVE_EVENTS } from './narrative_events.js';
import { eventEligible } from './world.js';
import { biomeForFloor, ENEMIES, BOSSES, WANDERING_ENEMIES } from './enemies.js';
import { planEncounter, pushOfferedEventHistory } from './balance.js';

export const LAST_FLOOR = TDC.lastFloor;
export const BOSS_FLOORS = Object.keys(BOSSES).map(Number);
const BOSS_FLOOR_SET = new Set(BOSS_FLOORS);

export const NARRATIVE_EVENT_IDS = new Set(NARRATIVE_EVENTS.map(e => e.id));

export function isBossFloor(floor) {
  return BOSS_FLOOR_SET.has(floor);
}

export function isThroneFloor(floor) {
  return floor === LAST_FLOOR;
}

export function isCampfireFloor(floor) {
  return isBossFloor(floor + 1) && !isBossFloor(floor) && !isThroneFloor(floor);
}

export function isTrialFloor(floor) {
  return floor % 5 === 0 && !isBossFloor(floor);
}

/** boss | campfire | trial | throne | travel */
export function classifyFloor(floor) {
  if (isThroneFloor(floor)) return 'throne';
  if (isBossFloor(floor)) return 'boss';
  if (isTrialFloor(floor)) return 'trial';
  if (isCampfireFloor(floor)) return 'campfire';
  return 'travel';
}

export function rollCardsPerDraw(rng) {
  const two = CONFIG.events.cardsPerDrawTwoChance ?? 0.1;
  const four = CONFIG.events.cardsPerDrawFourChance ?? 0.1;
  const r = rng.next();
  if (r < two) return 2;
  if (r < two + four) return 4;
  return CONFIG.events.cardsPerDraw || 3;
}

/** Budget-aware encounter plan (bodies first; leftover → mild HP pad). */
export function pickEnemyPlan(rng, run, biome, partySize = 1) {
  const depth = run.floor - biome.floors[0];
  const native = ENEMIES[biome.id] || ENEMIES.hell;
  let pool = [...native];
  // Thin biomes keep wanderers rarer so Frost/Swamp/Hell stay themselves.
  const wanderChance = native.length <= 12 ? 0.18 : 0.38;
  if (WANDERING_ENEMIES?.length && rng.chance(wanderChance)) {
    const wander = depth < 4
      ? WANDERING_ENEMIES.filter(e => !e.elite)
      : WANDERING_ENEMIES;
    if (wander.length) pool = pool.concat(wander);
  }
  if (depth < 4) pool = pool.filter(e => !e.elite);
  return planEncounter(rng, {
    floor: run.floor,
    biomeStart: biome.floors[0],
    pool,
    partySize,
    allowElite: depth >= 4,
    recentIds: run.recentEncounterIds || [],
    recentBodies: run.recentEncounterBodies || [],
  });
}

function eventAffine(ev, run, classes, races, underdog) {
  if (!ev.affinity) return false;
  const cls = classes || [run.classId];
  const raceList = races || [run.raceId];
  if (ev.affinity.classes?.some(c => cls.includes(c))) return true;
  if (ev.affinity.races?.some(r => raceList.includes(r))) return true;
  if (ev.affinity.underdog && (underdog ?? run.underdog)) return true;
  return false;
}

function encounterCard(plan, hydrateEnemies) {
  return {
    kind: 'encounter',
    category: 'combat',
    enemies: hydrateEnemies
      ? hydrateEnemies(plan)
      : plan.specs.map(g => ({ ...g })),
    hpMult: plan.hpMult,
    sparkle: false,
  };
}

function eventCard(rng, ev, run, { classes, races, underdog, forceCat = null } = {}) {
  const affine = eventAffine(ev, run, classes, races, underdog);
  return {
    kind: 'event',
    category: ev.category || forceCat || 'unknown',
    eventId: ev.id,
    sparkle: affine && rng.chance(CONFIG.events.sparkleChance ?? 0.1),
  };
}

/**
 * Same rules as the live travel-map draw. Does not advance run.rngState.
 * @param {object} [opts]
 * @param {number} [opts.partySize]
 * @param {string[]} [opts.classes]
 * @param {object[]} [opts.party] companion eligibility snapshots
 * @param {(plan: object) => object[]} [opts.hydrateEnemies] live co-op enemy builder
 */
export function generateFloorCards(rng, run, opts = {}) {
  const partySize = opts.partySize || 1;
  const classes = opts.classes || null;
  const party = opts.party || [];
  const races = opts.races || [run.raceId, ...party.map(s => s.raceId).filter(Boolean)];
  const underdog = !!(run.underdog || party.some(s => s.underdog));
  const hydrateEnemies = opts.hydrateEnemies || null;
  const biome = biomeForFloor(run.floor);
  const cards = [];
  const usedEvents = [];
  const n = rollCardsPerDraw(rng);
  const combatChance = run.floor <= 3 ? 0.35 : run.floor <= 6 ? 0.6 : 0.75;
  const combatSlot = rng.chance(combatChance) ? rng.int(0, n - 1) : -1;
  for (let i = 0; i < n; i++) {
    if (i === combatSlot) {
      const plan = pickEnemyPlan(rng, run, biome, partySize);
      cards.push(encounterCard(plan, hydrateEnemies));
      continue;
    }
    const ev = drawEvent(rng, run, { exclude: usedEvents, party, skipPace: !!opts.skipPace });
    usedEvents.push(ev.id);
    const card = eventCard(rng, ev, run, { classes, races, underdog });
    if (rng.chance(CONFIG.events.mysteryNodeChance ?? 0.10)) card.hidden = true;
    cards.push(card);
  }

  const forceCat = run.forcedNextCategory || run.mapHintCategory || null;
  delete run.forcedNextCategory;
  delete run.mapHintCategory;
  if (forceCat) {
    if (forceCat === 'combat') {
      const plan = pickEnemyPlan(rng, run, biome, partySize);
      const enc = encounterCard(plan, hydrateEnemies);
      let slot = cards.findIndex(c => c.kind !== 'encounter');
      if (slot < 0) slot = 0;
      cards[slot] = enc;
    } else {
      const pool = liveEventCatalog().filter(e => e.category === forceCat
        && eventEligible(e, run, { exclude: usedEvents, party }));
      if (pool.length) {
        const ev = rng.pick(pool);
        usedEvents.push(ev.id);
        let slot = cards.findIndex(c => c.kind === 'event' && c.category !== forceCat);
        if (slot < 0) slot = cards.findIndex(c => c.kind === 'event');
        if (slot < 0) slot = 0;
        cards[slot] = eventCard(rng, ev, run, { classes, races, underdog, forceCat });
      }
    }
  }
  return cards;
}

/**
 * Live travel-map deal — the function `game.js` `generateCards` calls.
 * generateFloorCards first (does not persist rngState), then rng.advance().
 * Telemetry that owns its own trial stream must call generateFloorCards only.
 */
export function dealLiveFloorCards(rng, run, opts = {}) {
  const cards = generateFloorCards(rng, run, opts);
  pushOfferedEventHistory(run, cards);
  if (typeof rng.advance === 'function') rng.advance();
  return cards;
}

/** Comparable shape for parity tests (families, ids, enemy plan, order). */
export function cardDealFingerprint(cards) {
  return (cards || []).map(c => ({
    kind: c.kind,
    category: c.category,
    eventId: c.eventId || null,
    hidden: !!c.hidden,
    sparkle: !!c.sparkle,
    hpMult: c.hpMult ?? null,
    enemies: (c.enemies || []).map(e => ({
      id: e.id || null,
      elite: !!e.elite,
      hp: e.hp ?? null,
      atk: e.atk ?? null,
    })),
  }));
}

export function eventById(id) {
  return findEvent(id);
}

/** combat | narrative | shop | rest | trial | boss | other */
export function broadFamily(card, ev = null) {
  if (!card) return 'other';
  if (card.kind === 'special') return card.family || 'other';
  if (card.kind === 'encounter' || card.category === 'combat') return 'combat';
  const event = ev || (card.eventId ? eventById(card.eventId) : null);
  if (event?.shop || event?.type === 'shop' || card.category === 'merchant') return 'shop';
  if (event?.id === 'campfire' || event?.type === 'rest' || card.category === 'recovery') return 'rest';
  if (isNarrativeEvent(event, card)) return 'narrative';
  return 'other';
}

export function isNarrativeEvent(ev, card = null) {
  const id = ev?.id || card?.eventId;
  if (id && NARRATIVE_EVENT_IDS.has(id)) return true;
  if (ev?.family && ev?.thread) return true;
  if (ev?.type === 'story') return true;
  return false;
}

export function cardLooksPayoff(ev) {
  if (!ev) return false;
  return whenLooksPayoff(ev.when) || (ev.variants || []).some(v => whenLooksPayoff(v.when));
}

function whenLooksPayoff(when) {
  if (!when || typeof when !== 'object') return false;
  const keys = [
    'flag', 'notFlag', 'knowledge', 'notKnowledge', 'thread', 'threadAtLeast',
    'event', 'notEvent', 'eventChoice', 'charMet', 'charAlive', 'charRelMin',
    'item', 'secretEligible', 'secretUnlocked', 'notSecretUnlocked',
    'bossPick', 'bossCleared', 'bossSpared',
  ];
  if (keys.some(k => when[k] != null)) return true;
  if (when.all) return asList(when.all).some(whenLooksPayoff);
  if (when.any) return asList(when.any).some(whenLooksPayoff);
  if (when.not) return whenLooksPayoff(when.not);
  return false;
}

function asList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}
