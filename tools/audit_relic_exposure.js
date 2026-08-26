#!/usr/bin/env node
// Practical relic-exposure audit. Measurement only — does not change gameplay.
// Distinguishes DEFINED / ENABLED / REACHABLE / PRACTICALLY ENCOUNTERABLE.
//
//   node tools/audit_relic_exposure.js
//   node tools/audit_relic_exposure.js --climbs=1000 --workers=6
//   node tools/audit_relic_exposure.js --phase=static
//   node tools/audit_relic_exposure.js --phase=climbs --climbs=10000

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { RELICS, itemById, rollRelic } from '../js/data/items.js';
import { makeRng } from '../js/rng.js';
import { liveEventCatalog } from '../js/data/events.js';
import { ORIGINS } from '../js/data/origins.js';
import { NARRATIVE_EVENTS } from '../js/data/narrative_events.js';
import { packRelicList } from '../js/content_pack/registry.js';
import {
  packRelicChannelEligible, packRelicChannelPool, inOrdinaryLoot, CHANNEL,
} from '../js/content_pack/acquisition.js';
import { DROP_WEIGHT, VALID_RARITIES, ORDINARY_RARITIES } from '../js/content_pack/rarity.js';
import { classifyGrant, maybeCampfirePackFind } from '../js/content_pack/grants.js';
import { walkOutcome, buildPathGraph } from '../js/content_pack/path_graph.js';
import {
  setPackEnabled, setPackGate, resetPackFlags, isPackOn, packStatus, GATE,
} from '../js/content_pack/flags.js';
import { buildShopStock } from '../js/shop.js';
import { simulateClimbV2, makeV2Run } from './run_climb_v2.js';
import { baselinePolicy } from './policies/baseline.js';
import { mix32, CANONICAL_CLASSES, CANONICAL_BLOODLINES } from './content_pack_balance_lib.js';

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const reportDir = join(root, 'reports');

const STARTING_CLASSES = ['warrior', 'mage', 'archer', 'rogue', 'priest', 'monk'];
const RARITY_W = { common: 50, uncommon: 30, rare: 14, epic: 5, legendary: 1 };
const EXPOSURE_BANDS = [
  { flag: 'VERY COMMON', min: 0.50 },
  { flag: 'COMMON', min: 0.20 },
  { flag: 'OCCASIONAL', min: 0.05 },
  { flag: 'RARE', min: 0.01 },
  { flag: 'VERY RARE', min: 0.002 },
  { flag: 'PRACTICALLY INVISIBLE', min: 0 },
];

function armPackOn() {
  resetPackFlags();
  setPackEnabled(true);
  setPackGate(GATE.MULTIPLAYER);
}

function arg(name, fallback = null) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.slice(name.length + 3);
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function bump(map, key, n = 1) {
  if (key == null || key === '') return;
  map[key] = (map[key] || 0) + n;
}

function isRelicItem(it) {
  if (!it) return false;
  return classifyGrant(it) === 'relic';
}

function isNewRelic(id) {
  return typeof id === 'string' && id.startsWith('cp_');
}

function ordinaryRollFilter(r, owned = []) {
  return !owned.includes(r.id)
    && r.rarity !== 'wrld' && !r.wrld
    && r.rarity !== 'unique' && !r.unique
    && !r.exclusive && !r.quest;
}

function liveCatalogConcat() {
  if (!isPackOn()) return RELICS.slice();
  return RELICS.concat(packRelicList().filter(packRelicChannelEligible));
}

function rollRelicPool(owned = []) {
  return liveCatalogConcat().filter(r => ordinaryRollFilter(r, owned));
}

function weightOf(item) {
  if (item.lootWeight != null) return Math.max(1, item.lootWeight);
  return (RARITY_W[item.rarity] || 1);
}

function poolStats(pool) {
  const byRarity = {};
  const byEra = { old: 0, new: 0 };
  let weightOld = 0;
  let weightNew = 0;
  const byRarityW = {};
  for (const r of VALID_RARITIES) {
    byRarity[r] = 0;
    byRarityW[r] = 0;
  }
  byRarity.missing = 0;
  const ids = [];
  for (const it of pool) {
    ids.push(it.id);
    const era = isNewRelic(it.id) ? 'new' : 'old';
    byEra[era] += 1;
    const w = weightOf(it);
    if (era === 'new') weightNew += w;
    else weightOld += w;
    if (!it.rarity) byRarity.missing += 1;
    else bump(byRarity, it.rarity);
    bump(byRarityW, it.rarity || 'missing', w);
  }
  const wTot = weightOld + weightNew;
  return {
    n: pool.length,
    ids,
    byRarity,
    byEra,
    weightOld,
    weightNew,
    weightTotal: wTot,
    pNewByWeight: wTot ? weightNew / wTot : 0,
    pOldByWeight: wTot ? weightOld / wTot : 0,
    byRarityWeight: byRarityW,
  };
}

function collectOutcomeRelicRefs(outcome, acc = []) {
  walkOutcome(outcome, (o) => {
    if (o.item) acc.push({ field: 'item', id: o.item, relicRoll: false, wrld: false });
    if (o.relic) acc.push({ field: 'relic', id: o.relic, relicRoll: false, wrld: false });
    if (o.relicRoll) acc.push({ field: 'relicRoll', id: null, relicRoll: true, wrld: false });
    if (o.wrldItem) {
      const kind = typeof o.wrldItem === 'object' ? o.wrldItem.kind : 'any';
      if (kind === 'relic' || kind === 'any' || kind == null) {
        acc.push({ field: 'wrldItem', id: null, relicRoll: false, wrld: true, kind });
      }
    }
    if (o.reward?.bonus) {
      for (const b of o.reward.bonus) {
        if (b.kind === 'relic' || b.relic) {
          acc.push({ field: 'reward.bonus', id: b.id || b.relic || null, relicRoll: !b.id && !b.relic, wrld: false });
        }
      }
    }
  });
  return acc;
}

function eventRelicGrants() {
  const catalog = liveEventCatalog();
  const originEvents = ORIGINS.map(o => ({ ...o, _origin: true }));
  const rows = [];
  for (const ev of [...catalog, ...originEvents, ...NARRATIVE_EVENTS]) {
    for (const [i, c] of (ev.choices || []).entries()) {
      const refs = collectOutcomeRelicRefs(c.outcome);
      for (const ref of refs) {
        const it = ref.id ? itemById(ref.id) : null;
        const isRelic = ref.relicRoll || ref.wrld || (it && isRelicItem(it));
        if (!isRelic) continue;
        rows.push({
          eventId: ev.id,
          origin: !!ev._origin,
          narrative: NARRATIVE_EVENTS.some(n => n.id === ev.id),
          pack: !!ev.contentPack || !!ev.pack || String(ev.id).startsWith('cp_'),
          choiceIndex: i,
          choiceLabel: c.label,
          biome: ev.biome || null,
          family: ev.family || null,
          classId: ev.when?.classId || c.req?.class || null,
          raceId: ev.when?.race || c.req?.race || null,
          req: c.req || null,
          once: !!ev.once,
          ...ref,
          name: it?.name || (ref.relicRoll ? '(rollRelic)' : ref.wrld ? '(rollWrld relic)' : ref.id),
          rarity: it?.rarity || null,
          new: ref.id ? isNewRelic(ref.id) : false,
        });
      }
    }
  }
  return rows;
}

function relicRecord(it, era, graphEntry, grants) {
  const sources = graphEntry?.sources || [];
  const sourceTypes = [...new Set(sources.map(s => s.type))];
  const namedEvents = grants.filter(g => g.id === it.id);
  const inRoll = ordinaryRollFilter(it);
  const inLiveConcat = liveCatalogConcat().some(r => r.id === it.id);
  const campfire = packRelicChannelEligible(it);
  const ordinaryLoot = inOrdinaryLoot(it);
  return {
    id: it.id,
    name: it.name,
    rarity: it.rarity || null,
    sourceFile: era === 'old' ? 'js/data/items.js' : 'js/content_pack/catalogs/relics.js',
    era,
    defined: true,
    enabled: era === 'old' ? true : isPackOn(),
    exclusive: !!it.exclusive,
    quest: !!it.quest,
    unique: !!(it.unique || it.rarity === 'unique'),
    wrld: !!(it.wrld || it.rarity === 'wrld'),
    curse: it.curse || null,
    packOrdinary: !!it.packOrdinary,
    acquisition: it.acquisition || (era === 'old' ? 'ordinary' : 'event'),
    capability: it.capability || null,
    mutex: it.mutex || null,
    minFloor: it.minFloor ?? null,
    maxFloor: it.maxFloor ?? null,
    classBound: it.classBound || null,
    resonance: it.resonance || null,
    biomes: it.biomes || null,
    inLiveRelicPoolConcat: inLiveConcat,
    inOrdinaryRollRelic: inRoll,
    inCampfirePackPool: campfire,
    inOrdinaryEquipmentLoot: ordinaryLoot,
    graphSourceTypes: sourceTypes,
    namedEventGrants: namedEvents.map(g => ({
      eventId: g.eventId,
      label: g.choiceLabel,
      biome: g.biome,
      family: g.family,
      classId: g.classId,
      raceId: g.raceId,
      coop: !!g.coop,
      req: g.req,
    })),
    appearsIn: {
      ordinaryLoot: inRoll,
      eliteRewards: false,
      bossRewards: inRoll,
      shops: inRoll,
      eventsNamed: namedEvents.length > 0,
      eventsRelicRoll: false,
      trials: false,
      treasureChests: false,
      campfirePack: campfire,
      uniqueRoll: !!(it.rarity === 'unique' && !it.exclusive && !it.quest),
      wrldRoll: !!(it.rarity === 'wrld' && !it.exclusive && !it.quest),
    },
    reachable: era === 'old' ? inRoll || !!(it.wrld || it.unique) : (namedEvents.length > 0 || campfire || inRoll),
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (1 - (idx - lo)) + sorted[hi] * (idx - lo);
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function exposureFlag(p) {
  for (const b of EXPOSURE_BANDS) {
    if (p >= b.min) return b.flag;
  }
  return 'PRACTICALLY INVISIBLE';
}

function fakeRun(floor, extras = {}) {
  return {
    floor,
    biomeId: floor <= 10 ? 'forest' : floor <= 20 ? 'ruins' : floor <= 30 ? 'frost' : floor <= 40 ? 'swamp' : 'hell',
    classId: extras.classId || 'warrior',
    raceId: extras.raceId || 'human',
    relics: extras.relics || [],
    inventory: [],
    equipment: {},
    consumables: [],
    gold: 200,
    fame: 0,
    hp: 40,
    maxHp: 40,
    recentShopItemIds: extras.recentShopItemIds || [],
    packState: { run: {} },
    flags: {},
  };
}

function monteCarloRollRelic(n, luck = 0) {
  const counts = {};
  let nulls = 0;
  for (let i = 0; i < n; i++) {
    const r = rollRelic(makeRng((i * 2654435761) >>> 0), [], luck);
    if (!r) { nulls += 1; continue; }
    bump(counts, r.id);
  }
  return { n, nulls, counts };
}

function monteCarloShops(n, floors) {
  const counts = {};
  let listings = 0;
  let visitsWithRelic = 0;
  let newListings = 0;
  for (let i = 0; i < n; i++) {
    const floor = floors[i % floors.length];
    const run = fakeRun(floor, { classId: STARTING_CLASSES[i % STARTING_CLASSES.length] });
    const rng = makeRng((0xA11CE ^ i ^ (floor * 997)) >>> 0);
    const stock = buildShopStock(run, rng);
    const relics = stock.filter(s => s.kind === 'relic' && s.item);
    if (relics.length) visitsWithRelic += 1;
    for (const s of relics) {
      listings += 1;
      bump(counts, s.item.id);
      if (isNewRelic(s.item.id)) newListings += 1;
    }
  }
  return { n, floors, listings, visitsWithRelic, pVisitHasRelic: visitsWithRelic / n, newListings, counts };
}

async function monteCarloCampfire(n) {
  const counts = {};
  let finds = 0;
  let consumableFinds = 0;
  for (let i = 0; i < n; i++) {
    const run = fakeRun(9 + (i % 5) * 10);
    const rng = makeRng((0xC0FFEE ^ i) >>> 0);
    const lines = [];
    const beforeCons = (run.consumables || []).length;
    const beforeRelics = [...(run.relics || [])];
    await maybeCampfirePackFind(run, rng, lines);
    if ((run.consumables || []).length > beforeCons) consumableFinds += 1;
    const added = (run.relics || []).filter(id => !beforeRelics.includes(id));
    for (const id of added) {
      finds += 1;
      bump(counts, id);
    }
  }
  return { n, finds, pFind: finds / n, consumableFinds, pConsumable: consumableFinds / n, counts };
}

function buildStaticReport() {
  armPackOn();
  const pack = packRelicList();
  const graph = buildPathGraph();
  const relicEntries = graph.entries.filter(e => e.category === 'relic');
  const graphById = new Map(relicEntries.map(e => [e.id, e]));
  const grants = eventRelicGrants();

  const old = RELICS.map(r => relicRecord(r, 'old', graphById.get(r.id), grants));
  const neu = pack.map(r => relicRecord(r, 'new', graphById.get(r.id), grants));
  const all = old.concat(neu);

  const rollPool = rollRelicPool();
  const liveConcat = liveCatalogConcat();
  const campPool = packRelicChannelPool();
  const exclusiveBlocked = neu.filter(r => r.exclusive && !r.quest && !r.unique && !r.wrld);
  const questBlocked = neu.filter(r => r.quest);
  const counterfactual = pack.filter(r => packRelicChannelEligible(r));
  const mixedIfExclusiveIgnored = RELICS.filter(r => ordinaryRollFilter({ ...r, exclusive: false }))
    .concat(counterfactual);

  const rarityIntended = DROP_WEIGHT;
  const rarityLive = RARITY_W;

  const namedByRelic = {};
  for (const g of grants) {
    if (!g.id) continue;
    if (!namedByRelic[g.id]) namedByRelic[g.id] = [];
    namedByRelic[g.id].push(g);
  }

  const relicRollEvents = grants.filter(g => g.relicRoll);
  const wrldRelicEvents = grants.filter(g => g.wrld);

  return {
    generatedAt: new Date().toISOString(),
    packStatus: packStatus(),
    isPackOn: isPackOn(),
    counts: {
      definedOld: old.length,
      definedNew: neu.length,
      definedTotal: all.length,
      enabledOld: old.length,
      enabledNew: isPackOn() ? neu.length : 0,
      inOrdinaryRoll: rollPool.length,
      inOrdinaryRollNew: rollPool.filter(r => isNewRelic(r.id)).length,
      inOrdinaryRollOld: rollPool.filter(r => !isNewRelic(r.id)).length,
      liveConcat: liveConcat.length,
      campfirePool: campPool.length,
      exclusiveBlockedFromRoll: exclusiveBlocked.length,
      quest: questBlocked.length,
      uniqueNew: neu.filter(r => r.unique).length,
      wrldNew: neu.filter(r => r.wrld).length,
      packOrdinaryNew: neu.filter(r => r.packOrdinary).length,
      namedEventGrantRows: grants.filter(g => g.id).length,
      relicRollGrantRows: relicRollEvents.length,
    },
    rarity: {
      intendedWeights: rarityIntended,
      liveRollRelicWeights: rarityLive,
      weightsMatch: JSON.stringify(rarityIntended) === JSON.stringify({
        ...rarityLive, unique: 0, wrld: 0,
      }) || (
        rarityIntended.common === rarityLive.common
        && rarityIntended.uncommon === rarityLive.uncommon
        && rarityIntended.rare === rarityLive.rare
        && rarityIntended.epic === rarityLive.epic
        && rarityIntended.legendary === rarityLive.legendary
      ),
      uniqueWrldInOrdinary: false,
      floorProgressionModifiesRelicWeights: false,
      pity: false,
      unknownRarityFallback: 'weight 1 (not common)',
    },
    pools: {
      ordinaryRoll: poolStats(rollPool),
      liveConcatBeforeExclusiveFilter: poolStats(liveConcat),
      campfirePack: poolStats(campPool),
      counterfactualIfExclusiveIgnored: poolStats(mixedIfExclusiveIgnored),
    },
    exclusiveDefault: {
      helper: 'js/content_pack/catalogs/helpers.js relic() → defaultExclusive() returns true unless packOrdinary',
      packOrdinaryOnAnyNewRelic: neu.some(r => r.packOrdinary),
      rollRelicFilter: '!r.exclusive && !r.quest && rarity not unique/wrld',
    },
    catalog: all,
    namedGrants: grants,
    relicRollEvents: relicRollEvents.map(g => ({ eventId: g.eventId, label: g.choiceLabel, origin: g.origin, pack: g.pack })),
    wrldRelicEvents: wrldRelicEvents.map(g => ({ eventId: g.eventId, label: g.choiceLabel })),
    newRelicSummary: neu.map(r => ({
      id: r.id,
      name: r.name,
      rarity: r.rarity,
      exclusive: r.exclusive,
      quest: r.quest,
      unique: r.unique,
      wrld: r.wrld,
      inOrdinaryRollRelic: r.inOrdinaryRollRelic,
      inCampfirePackPool: r.inCampfirePackPool,
      namedEvents: r.namedEventGrants.length,
      sourceTypes: r.graphSourceTypes,
    })),
  };
}

function emptyAgg() {
  return {
    n: 0,
    outcomes: {},
    maxFloors: [],
    presentedNew: [],
    presentedOld: [],
    acquiredNew: [],
    acquiredOld: [],
    uniqueNewPresented: [],
    uniqueNewAcquired: [],
    runsWithNewPresented: 0,
    runsWith2NewPresented: 0,
    runsWith3NewPresented: 0,
    runsWithNewAcquired: 0,
    presentedBySource: {},
    acquiredBySource: {},
    rarityPresented: {},
    rarityAcquired: {},
    relicPresentedRuns: {},
    relicAcquiredRuns: {},
    relicPresentedCount: {},
    relicAcquiredCount: {},
    relicFirstFloor: {},
    relicSources: {},
    shopListings: 0,
    shopListingsNew: 0,
    bossOffers: 0,
    bossOffersNew: 0,
    namedVisible: 0,
    namedVisibleNew: 0,
    campfireFinds: 0,
    relicRolls: 0,
    relicRollsNew: 0,
    emptyRolls: 0,
  };
}

function addRun(agg, row) {
  agg.n += 1;
  bump(agg.outcomes, row.outcome);
  agg.maxFloors.push(row.maxFloor);
  agg.presentedNew.push(row.presentedNew);
  agg.presentedOld.push(row.presentedOld);
  agg.acquiredNew.push(row.acquiredNew);
  agg.acquiredOld.push(row.acquiredOld);
  agg.uniqueNewPresented.push(row.uniqueNewPresented);
  agg.uniqueNewAcquired.push(row.uniqueNewAcquired);
  if (row.presentedNew >= 1) agg.runsWithNewPresented += 1;
  if (row.presentedNew >= 2) agg.runsWith2NewPresented += 1;
  if (row.presentedNew >= 3) agg.runsWith3NewPresented += 1;
  if (row.acquiredNew >= 1) agg.runsWithNewAcquired += 1;
  for (const [k, v] of Object.entries(row.presentedBySource || {})) bump(agg.presentedBySource, k, v);
  for (const [k, v] of Object.entries(row.acquiredBySource || {})) bump(agg.acquiredBySource, k, v);
  for (const [k, v] of Object.entries(row.rarityPresented || {})) bump(agg.rarityPresented, k, v);
  for (const [k, v] of Object.entries(row.rarityAcquired || {})) bump(agg.rarityAcquired, k, v);
  agg.shopListings += row.shopListings || 0;
  agg.shopListingsNew += row.shopListingsNew || 0;
  agg.bossOffers += row.bossOffers || 0;
  agg.bossOffersNew += row.bossOffersNew || 0;
  agg.namedVisible += row.namedVisible || 0;
  agg.namedVisibleNew += row.namedVisibleNew || 0;
  agg.campfireFinds += row.campfireFinds || 0;
  agg.relicRolls += row.relicRolls || 0;
  agg.relicRollsNew += row.relicRollsNew || 0;
  agg.emptyRolls += row.emptyRolls || 0;
  const seenP = new Set();
  const seenA = new Set();
  for (const [id, n] of Object.entries(row.newPresentedIds || {})) {
    bump(agg.relicPresentedCount, id, n);
    if (!seenP.has(id)) {
      seenP.add(id);
      bump(agg.relicPresentedRuns, id);
    }
    if (row.firstFloor?.[id] != null) {
      if (!agg.relicFirstFloor[id]) agg.relicFirstFloor[id] = [];
      agg.relicFirstFloor[id].push(row.firstFloor[id]);
    }
    if (row.relicSources?.[id]) {
      if (!agg.relicSources[id]) agg.relicSources[id] = {};
      for (const [s, c] of Object.entries(row.relicSources[id])) bump(agg.relicSources[id], s, c);
    }
  }
  for (const [id, n] of Object.entries(row.newAcquiredIds || {})) {
    bump(agg.relicAcquiredCount, id, n);
    if (!seenA.has(id)) {
      seenA.add(id);
      bump(agg.relicAcquiredRuns, id);
    }
  }
}

function summarizeAgg(agg) {
  const sort = a => a.slice().sort((x, y) => x - y);
  const pNew = agg.presentedNew;
  const pNewS = sort(pNew);
  const n = agg.n || 1;
  return {
    n: agg.n,
    outcomes: agg.outcomes,
    meanMaxFloor: mean(agg.maxFloors),
    medianMaxFloor: percentile(sort(agg.maxFloors), 0.5),
    perRun: {
      avgRelicOffers: mean(pNew.map((v, i) => v + (agg.presentedOld[i] || 0))),
      avgRelicAcquisitions: mean(agg.acquiredNew.map((v, i) => v + (agg.acquiredOld[i] || 0))),
      avgNewPresented: mean(agg.presentedNew),
      avgNewAcquired: mean(agg.acquiredNew),
      avgOldPresented: mean(agg.presentedOld),
      avgOldAcquired: mean(agg.acquiredOld),
      avgUniqueNewPresented: mean(agg.uniqueNewPresented),
      pctRunsAtLeast1NewPresented: agg.runsWithNewPresented / n,
      pctRunsAtLeast2NewPresented: agg.runsWith2NewPresented / n,
      pctRunsAtLeast3NewPresented: agg.runsWith3NewPresented / n,
      pctRunsZeroNewPresented: 1 - agg.runsWithNewPresented / n,
      pctRunsAtLeast1NewAcquired: agg.runsWithNewAcquired / n,
      medianNewPresented: percentile(pNewS, 0.5),
      p10NewPresented: percentile(pNewS, 0.1),
      p50NewPresented: percentile(pNewS, 0.5),
      p90NewPresented: percentile(pNewS, 0.9),
    },
    sources: {
      presented: agg.presentedBySource,
      acquired: agg.acquiredBySource,
      shopListingsPerRun: agg.shopListings / n,
      shopListingsNewPerRun: agg.shopListingsNew / n,
      bossOffersPerRun: agg.bossOffers / n,
      bossOffersNewPerRun: agg.bossOffersNew / n,
      namedVisiblePerRun: agg.namedVisible / n,
      namedVisibleNewPerRun: agg.namedVisibleNew / n,
      campfireFindsPerRun: agg.campfireFinds / n,
      relicRollsPerRun: agg.relicRolls / n,
      relicRollsNewPerRun: agg.relicRollsNew / n,
      emptyRolls: agg.emptyRolls,
    },
    rarityPresented: agg.rarityPresented,
    rarityAcquired: agg.rarityAcquired,
    human: {
      pZeroAfter1: 1 - agg.runsWithNewPresented / n,
      pZeroAfter3: (1 - agg.runsWithNewPresented / n) ** 3,
      pZeroAfter5: (1 - agg.runsWithNewPresented / n) ** 5,
      pZeroAfter10: (1 - agg.runsWithNewPresented / n) ** 10,
      expectedNewPresentedIn5Runs: 5 * mean(agg.presentedNew),
      expectedNewAcquiredIn5Runs: 5 * mean(agg.acquiredNew),
    },
  };
}

function instrumentPolicy(base, bag) {
  return {
    ...base,
    chooseRelic(choices) {
      for (const c of choices || []) {
        if (!c) continue;
        bag.offer({ source: 'boss', item: c, presented: true });
      }
      const pick = base.chooseRelic(choices);
      if (pick) bag.offer({ source: 'boss', item: pick, acquired: true });
      return pick;
    },
    chooseShopAction(run, stock, ctx) {
      for (const s of stock || []) {
        if (s?.kind === 'relic' && s.item) {
          bag.offer({ source: 'shop', item: s.item, presented: true });
        }
      }
      const act = base.chooseShopAction(run, stock, ctx);
      if (act?.act === 'buy') {
        const listing = stock[act.i];
        if (listing?.kind === 'relic' && listing.item) {
          bag.offer({ source: 'shop', item: listing.item, acquired: true });
        }
      }
      return act;
    },
    chooseEvent(run, ev, choices) {
      for (const c of choices || []) {
        const refs = collectOutcomeRelicRefs(c.outcome);
        for (const ref of refs) {
          const it = ref.id ? itemById(ref.id) : (ref.relicRoll ? { id: '__relicRoll__', name: 'relicRoll', rarity: 'rolled' } : null);
          if (ref.relicRoll) bag.offer({ source: 'event_roll_choice', item: { id: '__relicRoll__', rarity: null }, presented: true, virtual: true });
          else if (it && isRelicItem(it)) bag.offer({ source: 'event_named_choice', item: it, presented: true });
          else if (ref.wrld) bag.offer({ source: 'event_wrld_choice', item: { id: '__wrldRelic__', rarity: 'wrld' }, presented: true, virtual: true });
        }
      }
      return base.chooseEvent(run, ev, choices);
    },
  };
}

export async function runInstrumentedClimb(job) {
  armPackOn();
  const policy0 = baselinePolicy();
  const offers = [];
  const bag = {
    run: null,
    offer(row) { offers.push({ ...row, floor: row.floor ?? this.run?.floor ?? 0 }); },
  };
  const policy = instrumentPolicy(policy0, bag);
  const run = makeV2Run({
    classId: job.classId,
    raceId: job.raceId,
    seed: job.seed,
    name: 'RELIC-AUDIT',
  });
  bag.run = run;
  run._cpMeasure = {
    effectOps: {}, effectCaps: {}, grants: [], rarityByChannel: {}, rarityByFloor: {},
    skillUses: {}, consumableUses: {}, skillOffered: {}, skillPicked: {},
    techOffered: {}, techPicked: {}, techLearned: {},
    artOffered: {}, artPicked: {}, artLearned: {},
    shopOffers: {}, shopBuys: {}, events: {}, repeatedEvents: {},
    bosses: {}, bossEnter: {}, f10: { arrive: 0, win: 0 },
    combat: {
      n: 0, damageDealt: 0, damageTaken: 0, healed: 0, lifesteal: 0,
      shields: 0, revives: 0, deathwards: 0, packWards: 0, rounds: 0,
      mpStarve: 0, mpOverflow: 0, cdBlocked: 0, cdActive: 0, chargeStarve: 0,
    },
    shop: { visits: 0, purchases: 0, skipped: 0, unaffordable: 0, heals: 0, restocks: 0 },
  };

  let prev = [...(run.relics || [])];
  const acquired = [];
  const result = await simulateClimbV2(run, policy, {
    skipCheckpoints: true,
    dropTrace: true,
    onFloor(rec) {
      const now = [...(run.relics || [])];
      for (const id of now) {
        if (!prev.includes(id)) {
          acquired.push({
            id,
            floor: rec.floor,
            kind: rec.kind,
            eventId: rec.meta?.eventId || null,
            choice: rec.meta?.choice || null,
          });
        }
      }
      prev = now;
      bag._floor = rec.floor;
    },
  });

  const presentedBySource = {};
  const acquiredBySource = {};
  const rarityPresented = {};
  const rarityAcquired = {};
  const newPresentedIds = {};
  const newAcquiredIds = {};
  const firstFloor = {};
  const relicSources = {};
  let presentedNew = 0;
  let presentedOld = 0;
  let shopListings = 0;
  let shopListingsNew = 0;
  let bossOffers = 0;
  let bossOffersNew = 0;
  let namedVisible = 0;
  let namedVisibleNew = 0;
  let relicRolls = 0;
  let relicRollsNew = 0;
  let emptyRolls = 0;

  const presentedIdsThis = [];
  for (const o of offers) {
    const item = o.item;
    if (!item || o.virtual && item.id === '__relicRoll__') {
      if (o.source === 'event_roll_choice' && o.presented) namedVisible += 1;
      continue;
    }
    if (o.virtual) continue;
    const id = item.id;
    const neu = isNewRelic(id);
    if (o.presented) {
      presentedIdsThis.push({ id, source: o.source, rarity: item.rarity });
      if (neu) {
        presentedNew += 1;
        bump(newPresentedIds, id);
        if (firstFloor[id] == null) firstFloor[id] = o.floor || result.checkpoint?.floor || 0;
        if (!relicSources[id]) relicSources[id] = {};
        bump(relicSources[id], o.source);
      } else presentedOld += 1;
      bump(presentedBySource, o.source);
      bump(rarityPresented, item.rarity || 'unknown');
      if (o.source === 'shop') {
        shopListings += 1;
        if (neu) shopListingsNew += 1;
      }
      if (o.source === 'boss') {
        bossOffers += 1;
        if (neu) bossOffersNew += 1;
      }
      if (o.source === 'event_named_choice') {
        namedVisible += 1;
        if (neu) namedVisibleNew += 1;
      }
    }
  }

  let acquiredNew = 0;
  let acquiredOld = 0;
  const acquiredSet = new Set();
  for (const a of acquired) {
    const it = itemById(a.id);
    const neu = isNewRelic(a.id);
    if (neu) {
      acquiredNew += 1;
      bump(newAcquiredIds, a.id);
      if (firstFloor[a.id] == null) firstFloor[a.id] = a.floor;
    } else acquiredOld += 1;
    acquiredSet.add(a.id);
    bump(rarityAcquired, it?.rarity || 'unknown');
    let source = 'other';
    if (a.kind === 'boss' || a.kind === 'throne') source = 'boss';
    else if (a.kind === 'shop' || a.kind === 'campfire' || a.kind === 'rest') {
      source = a.kind === 'shop' ? 'shop' : 'campfire';
    } else if (a.eventId) {
      source = isNewRelic(a.id) ? 'event_named' : 'event_roll';
    } else if (a.kind === 'campfire') source = 'campfire';
    // Campfire floors use event id campfire
    if (a.eventId === 'campfire') source = 'campfire';
    bump(acquiredBySource, source);
    if (neu) {
      if (!relicSources[a.id]) relicSources[a.id] = {};
      bump(relicSources[a.id], source + ':acquired');
    }
    if (source === 'event_roll') {
      relicRolls += 1;
      if (neu) relicRollsNew += 1;
    }
  }

  const campfireFinds = acquired.filter(a => a.eventId === 'campfire' && isNewRelic(a.id)).length;
  // Campfire new relics are also presented (granted into the log). Count them as presented if not already.
  for (const a of acquired) {
    if (a.eventId === 'campfire' && isNewRelic(a.id) && !newPresentedIds[a.id]) {
      presentedNew += 1;
      bump(newPresentedIds, a.id);
      bump(presentedBySource, 'campfire');
      if (firstFloor[a.id] == null) firstFloor[a.id] = a.floor;
    } else if (a.eventId === 'campfire' && isNewRelic(a.id)) {
      bump(presentedBySource, 'campfire');
    }
  }

  const uniqueNewPresented = Object.keys(newPresentedIds).length;
  const uniqueNewAcquired = Object.keys(newAcquiredIds).length;
  const maxFloor = result.deathFloor || result.checkpoint?.floor || run.floor || 0;

  return {
    seed: job.seed,
    classId: job.classId,
    raceId: job.raceId,
    outcome: result.outcome,
    maxFloor,
    presentedNew,
    presentedOld,
    acquiredNew,
    acquiredOld,
    uniqueNewPresented,
    uniqueNewAcquired,
    presentedBySource,
    acquiredBySource,
    rarityPresented,
    rarityAcquired,
    newPresentedIds,
    newAcquiredIds,
    firstFloor,
    relicSources,
    shopListings,
    shopListingsNew,
    bossOffers,
    bossOffersNew,
    namedVisible,
    namedVisibleNew,
    campfireFinds,
    relicRolls,
    relicRollsNew,
    emptyRolls,
  };
}

function enumerateJobs(n) {
  const jobs = [];
  const bases = [202608251, 7, 99, 123456, 8675309];
  let i = 0;
  while (jobs.length < n) {
    const classId = STARTING_CLASSES[jobs.length % STARTING_CLASSES.length];
    const raceId = 'human';
    const base = bases[jobs.length % bases.length];
    const seed = mix32(base, CANONICAL_CLASSES.indexOf(classId), CANONICAL_BLOODLINES.indexOf(raceId), i++);
    jobs.push({ classId, raceId, seed, packOn: true });
  }
  return jobs;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function runWorker(jobs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { jobs } });
    const rows = [];
    worker.on('message', (msg) => {
      if (msg.ok) rows.push(msg.row);
      else rows.push({ error: msg.error, ...msg.job, outcome: 'error', maxFloor: 0, presentedNew: 0, presentedOld: 0, acquiredNew: 0, acquiredOld: 0, uniqueNewPresented: 0, uniqueNewAcquired: 0 });
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`worker exited ${code}`));
      else resolve(rows);
    });
  });
}

async function runJobsInProcess(jobs) {
  const rows = [];
  for (const job of jobs) rows.push(await runInstrumentedClimb(job));
  return rows;
}

function perRelicTable(staticReport, agg) {
  const n = agg.n || 1;
  const rows = [];
  for (const r of staticReport.newRelicSummary) {
    const pPresent = (agg.relicPresentedRuns[r.id] || 0) / n;
    const pAcq = (agg.relicAcquiredRuns[r.id] || 0) / n;
    const floors = (agg.relicFirstFloor[r.id] || []).slice().sort((a, b) => a - b);
    rows.push({
      id: r.id,
      name: r.name,
      rarity: r.rarity,
      exclusive: r.exclusive,
      quest: r.quest,
      unique: r.unique,
      wrld: r.wrld,
      inOrdinaryRoll: r.inOrdinaryRollRelic,
      inCampfire: r.inCampfirePackPool,
      namedEvents: r.namedEvents,
      sourceTypes: r.sourceTypes,
      pPresentOneRun: pPresent,
      pAcquiredOneRun: pAcq,
      avgRunsToSee: pPresent > 0 ? 1 / pPresent : Infinity,
      medianFirstFloor: floors.length ? percentile(floors, 0.5) : null,
      presentedCount: agg.relicPresentedCount[r.id] || 0,
      acquiredCount: agg.relicAcquiredCount[r.id] || 0,
      sources: agg.relicSources[r.id] || {},
      flag: exposureFlag(pPresent),
      restriction: r.inOrdinaryRollRelic
        ? 'in ordinary roll'
        : r.quest
          ? 'quest/named-grant only'
          : r.unique
            ? 'unique exclusive'
            : r.wrld
              ? 'wrld exclusive'
              : r.inCampfirePackPool
                ? 'campfire competing pool only (exclusive from rollRelic)'
                : 'named event only',
    });
  }
  rows.sort((a, b) => b.pPresentOneRun - a.pPresentOneRun);
  return rows;
}

async function main() {
  const phase = arg('phase', 'all');
  const climbN = Number(arg('climbs', '1000')) || 1000;
  const extraN = Number(arg('climbs2', '0')) || 0;
  const workers = Number(arg('workers', String(Math.max(1, Math.min(8, os.cpus().length - 1))))) || 1;

  console.log('— relic practical exposure audit —');
  armPackOn();
  console.log(`pack on=${isPackOn()} gate=${packStatus().gate}`);

  const staticReport = buildStaticReport();
  console.log(`catalog old=${staticReport.counts.definedOld} new=${staticReport.counts.definedNew}`);
  console.log(`ordinary rollRelic pool: ${staticReport.counts.inOrdinaryRoll} (new=${staticReport.counts.inOrdinaryRollNew})`);
  console.log(`exclusive-blocked new relics: ${staticReport.counts.exclusiveBlockedFromRoll}`);
  console.log(`campfire pack pool: ${staticReport.counts.campfirePool}`);

  const mcRelic = monteCarloRollRelic(100000);
  const mcShop = monteCarloShops(20000, [5, 12, 18, 25, 35, 45]);
  const mcCamp = await monteCarloCampfire(20000);

  if (mcRelic) {
    const newHits = Object.entries(mcRelic.counts).filter(([id]) => isNewRelic(id)).reduce((s, [, n]) => s + n, 0);
    console.log(`rollRelic ×100000: new hits=${newHits} nulls=${mcRelic.nulls}`);
  }
  if (mcShop) {
    console.log(`shops ×${mcShop.n}: relic listings=${mcShop.listings} new=${mcShop.newListings} p(relic in stock)=${mcShop.pVisitHasRelic.toFixed(3)}`);
  }
  if (mcCamp) {
    console.log(`campfire ×${mcCamp.n}: pack relic p=${mcCamp.pFind.toFixed(4)} consumable p=${mcCamp.pConsumable.toFixed(4)}`);
  }

  let climbSummary = null;
  let climbSummary10k = null;
  let perRelic = [];
  let perRelic10k = [];

  async function runClimbBatch(n, label) {
    const jobs = enumerateJobs(n);
    const agg = emptyAgg();
    const t0 = Date.now();
    if (workers <= 1 || n <= 8) {
      const rows = await runJobsInProcess(jobs);
      for (const row of rows) addRun(agg, row);
    } else {
      const shardSize = Math.max(8, Math.ceil(jobs.length / (workers * 3)));
      const shards = chunk(jobs, shardSize);
      let done = 0;
      for (let i = 0; i < shards.length; i += workers) {
        const batch = shards.slice(i, i + workers);
        const parts = await Promise.all(batch.map(async (shard, j) => {
          try {
            return await runWorker(shard);
          } catch (err) {
            console.error('  worker failed, in-process', err?.message || err);
            return runJobsInProcess(shard);
          } finally {
            done += shard.length;
            console.log(`  ${label} ${done}/${n}`);
          }
        }));
        for (const rows of parts) for (const row of rows) addRun(agg, row);
      }
    }
    console.log(`  ${label} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return agg;
  }

  if (phase !== 'static') {
    const n1 = climbN;
    console.log(`— climbs n=${n1} workers=${workers} —`);
    const agg1 = await runClimbBatch(n1, 'climbs');
    climbSummary = summarizeAgg(agg1);
    perRelic = perRelicTable(staticReport, agg1);
    console.log(`avg new presented/run=${climbSummary.perRun.avgNewPresented.toFixed(3)}  P(≥1)=${(climbSummary.perRun.pctRunsAtLeast1NewPresented * 100).toFixed(1)}%`);
    console.log(`P(zero new after 5 runs)=${(climbSummary.human.pZeroAfter5 * 100).toFixed(1)}%`);

    const n2 = extraN;
    if (n2 && n2 !== n1) {
      console.log(`— expansion climbs n=${n2} —`);
      const agg2 = await runClimbBatch(n2, 'climbs10k');
      climbSummary10k = summarizeAgg(agg2);
      perRelic10k = perRelicTable(staticReport, agg2);
      console.log(`10k avg new presented/run=${climbSummary10k.perRun.avgNewPresented.toFixed(3)}  P(≥1)=${(climbSummary10k.perRun.pctRunsAtLeast1NewPresented * 100).toFixed(1)}%`);
    } else if (n1 >= 10000) {
      climbSummary10k = climbSummary;
      perRelic10k = perRelic;
    }
  }

  const out = {
    title: 'DungeonTogether practical relic exposure audit',
    generatedAt: new Date().toISOString(),
    exposureBandThresholds: EXPOSURE_BANDS,
    static: {
      packStatus: staticReport.packStatus,
      counts: staticReport.counts,
      rarity: staticReport.rarity,
      pools: staticReport.pools,
      exclusiveDefault: staticReport.exclusiveDefault,
      newRelicSummary: staticReport.newRelicSummary,
      relicRollEvents: staticReport.relicRollEvents,
      wrldRelicEvents: staticReport.wrldRelicEvents,
    },
    catalog: staticReport.catalog,
    namedGrants: staticReport.namedGrants,
    monteCarlo: mcRelic ? {
      rollRelic: {
        n: mcRelic.n,
        nulls: mcRelic.nulls,
        newHits: Object.entries(mcRelic.counts).filter(([id]) => isNewRelic(id)).reduce((s, [, n]) => s + n, 0),
        top: Object.entries(mcRelic.counts).sort((a, b) => b[1] - a[1]).slice(0, 20)
          .map(([id, c]) => ({ id, name: itemById(id)?.name, n: c, p: c / mcRelic.n, era: isNewRelic(id) ? 'new' : 'old' })),
      },
      shops: {
        ...mcShop,
        top: Object.entries(mcShop.counts).sort((a, b) => b[1] - a[1]).slice(0, 15)
          .map(([id, c]) => ({ id, name: itemById(id)?.name, n: c, era: isNewRelic(id) ? 'new' : 'old' })),
      },
      campfire: {
        ...mcCamp,
        top: Object.entries(mcCamp.counts).sort((a, b) => b[1] - a[1]).slice(0, 15)
          .map(([id, c]) => ({ id, name: itemById(id)?.name, n: c, p: c / mcCamp.n })),
      },
    } : null,
    climbs1000: climbSummary,
    climbs10000: climbSummary10k,
    perRelic1000: perRelic,
    perRelic10000: perRelic10k.length ? perRelic10k : perRelic,
  };

  mkdirSync(reportDir, { recursive: true });
  const jsonPath = join(reportDir, 'relic_practical_exposure_20260825.json');
  writeFileSync(jsonPath, JSON.stringify(out, null, 2));
  console.log(`wrote ${jsonPath}`);
  return out;
}

if (!isMainThread) {
  armPackOn();
  const jobs = workerData.jobs || [];
  for (const job of jobs) {
    try {
      const row = await runInstrumentedClimb(job);
      parentPort.postMessage({ ok: true, row });
    } catch (err) {
      parentPort.postMessage({
        ok: false,
        error: String(err?.stack || err),
        job: { classId: job.classId, raceId: job.raceId, seed: job.seed },
      });
    }
  }
} else {
  await main();
}
