#!/usr/bin/env node
// Measurement-only helpers for Gate 7 content-pack balance.
// Does not change classes, enemies, loot tables, or combat math.

import { execSync } from 'child_process';
import { CANONICAL_CLASSES, CANONICAL_BLOODLINES, buildManifest } from '../js/content_pack/manifest.js';
import {
  setPackEnabled, setPackGate, resetPackFlags, isPackOn, activeGate, packStatus,
  GATE, CONTENT_PACK_ID, CONTENT_SCHEMA_VERSION, PACK_DEFAULT_ON,
} from '../js/content_pack/flags.js';
import { rawPackCatalogs } from '../js/content_pack/registry.js';
import { distributionReport, VALID_RARITIES } from '../js/content_pack/rarity.js';
import { inOrdinaryLoot } from '../js/content_pack/acquisition.js';
import { boundPackStateSize } from '../js/content_pack/state.js';
import { serializeClimber } from '../js/mp_checkpoint.js';
import { THREADS } from '../js/data/world.js';
import { LAST_FLOOR } from '../js/data/floorcards.js';
import { simulateClimbV2, makeV2Run } from './run_climb_v2.js';
import { baselinePolicy } from './policies/baseline.js';
import { chooseBossAwareAction } from './policies/boss_aware.js';

export { CANONICAL_CLASSES, CANONICAL_BLOODLINES, LAST_FLOOR };

export const STARTING_COMMIT = 'cf607bcd3c941c7840fad42da5ed6253bbcc7d85';

export const SEED_BANK = Object.freeze({
  id: 'cp-balance-g7-20260825',
  startingCommit: STARTING_COMMIT,
  baseSeed: 202608251,
  initialN: 24,
  expansionN: 96,
  formula: 'mix32(baseSeed, classIndex, bloodlineIndex, seedIndex) >>> 0',
  note: 'Identical seeds for pack-off and pack-on. Expansion uses the same sequence, first 96 indices.',
});

export function mix32(a, b, c, d) {
  let x = (a >>> 0) ^ Math.imul((b + 0x9e3779b9) >>> 0, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 16), 0xc2b2ae35);
  x ^= Math.imul((c + 1) >>> 0, 0x27d4eb2f);
  x ^= Math.imul((d + 1) >>> 0, 0x165667b1);
  x = Math.imul(x ^ (x >>> 13), 0x5bd1e995) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

export function climbSeed(classId, raceId, seedIndex) {
  const ci = CANONICAL_CLASSES.indexOf(classId);
  const ri = CANONICAL_BLOODLINES.indexOf(raceId);
  if (ci < 0 || ri < 0) throw new Error(`unknown class/bloodline ${classId}/${raceId}`);
  return mix32(SEED_BANK.baseSeed, ci, ri, seedIndex);
}

export function seedsFor(classId, raceId, n = SEED_BANK.initialN) {
  return Array.from({ length: n }, (_, i) => climbSeed(classId, raceId, i));
}

export function workingTreeNote() {
  try {
    const sha = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    const dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim();
    return { sha, dirty: dirty ? dirty.split(/\r?\n/) : [] };
  } catch {
    return { sha: STARTING_COMMIT, dirty: ['git status unavailable'] };
  }
}

export function armPack(on, gate = GATE.MULTIPLAYER) {
  resetPackFlags();
  if (on) {
    setPackEnabled(true);
    setPackGate(gate);
  } else {
    setPackEnabled(false);
  }
  return {
    requestedOn: !!on,
    requestedGate: on ? gate : 0,
    on: isPackOn(),
    gate: activeGate(),
    status: packStatus(),
    defaultOn: PACK_DEFAULT_ON,
  };
}

export function catalogSnapshot() {
  const onFlags = armPack(true, GATE.MULTIPLAYER);
  const man = buildManifest();
  const cat = rawPackCatalogs();
  const items = cat.items || [];
  const relics = cat.relics || [];
  const consumables = cat.consumables || [];
  const skills = Object.values(cat.skills || {});
  const events = cat.events || [];
  const ordinary = items.filter(inOrdinaryLoot);
  return {
    packId: CONTENT_PACK_ID,
    schema: CONTENT_SCHEMA_VERSION,
    flags: onFlags,
    counts: man.counts,
    classCoverage: man.classCoverage,
    bloodlineCoverage: man.bloodlineCoverage,
    rarity: {
      equipment: distributionReport(items, 'ordinaryEquipment'),
      ordinaryLoot: distributionReport(ordinary, 'ordinaryEquipment'),
      relics: distributionReport(relics, 'relics'),
      consumables: distributionReport(consumables, 'consumables'),
    },
    identity: man.identity,
    validRarities: [...VALID_RARITIES],
    skillCounts: {
      classTechniques: skills.filter(s => s.class && s.class !== 'universal').length,
      bloodlineArts: skills.filter(s => s.bloodline).length,
      total: skills.length,
    },
    eventCount: events.length,
    cursed: [...items, ...relics].filter(i => i.curse).length,
    evolving: [...items, ...relics].filter(i => i.evolvesTo).length,
    unique: [...items, ...relics].filter(i => i.unique || i.rarity === 'unique').length,
    wrld: [...items, ...relics].filter(i => i.wrld || i.rarity === 'wrld').length,
    sets: man.counts.sets,
  };
}

export function makeCollector() {
  return {
    effectOps: {},
    effectCaps: {},
    grants: [],
    rarityByChannel: {},
    rarityByFloor: {},
    skillUses: {},
    consumableUses: {},
    skillOffered: {},
    skillPicked: {},
    techOffered: {},
    techPicked: {},
    techLearned: {},
    artOffered: {},
    artPicked: {},
    artLearned: {},
    shopOffers: {},
    shopBuys: {},
    events: {},
    repeatedEvents: {},
    bosses: {},
    bossEnter: {},
    f10: { arrive: 0, win: 0 },
    combat: {
      n: 0, damageDealt: 0, damageTaken: 0, healed: 0, lifesteal: 0,
      shields: 0, revives: 0, deathwards: 0, packWards: 0, rounds: 0,
      mpStarve: 0, mpOverflow: 0, cdBlocked: 0, cdActive: 0, chargeStarve: 0,
    },
    shop: { visits: 0, purchases: 0, skipped: 0, unaffordable: 0, heals: 0, restocks: 0 },
  };
}

export function makePolicy(name = 'baseline') {
  if (name === 'boss-aware' || name === 'boss_aware') {
    return baselinePolicy({ name: 'boss-aware', chooseCombatAction: chooseBossAwareAction });
  }
  return baselinePolicy();
}

function isWin(outcome) {
  return outcome === 'win' || outcome === 'secret' || outcome === 'corrupt_king';
}

function countBy(list, keyFn) {
  const out = {};
  for (const x of list || []) bump(out, keyFn(x));
  return out;
}

function bump(map, key, n = 1) {
  if (!map || key == null || key === '') return;
  map[key] = (map[key] || 0) + n;
}

export function compactGrantActs(grants) {
  const out = {};
  for (const g of grants || []) {
    if (!g?.id) continue;
    const row = out[g.id] || (out[g.id] = {
      n: 0, equip: 0, sell: 0, stash: 0, buy: 0, relic: 0, useful: 0, incompatible: 0, slot: g.slot || null,
    });
    row.n += 1;
    const act = g.act || 'stash';
    row[act] = (row[act] || 0) + 1;
    if (g.useful) row.useful += 1;
    if (g.incompatible) row.incompatible += 1;
  }
  return out;
}

function setProgress(run) {
  const worn = {};
  for (const id of Object.values(run.equipment || {})) {
    if (!id) continue;
    const it = run.gearBag?.[id];
    const setId = it?.setId;
    if (setId) worn[setId] = (worn[setId] || 0) + 1;
  }
  let two = 0, three = 0;
  for (const n of Object.values(worn)) {
    if (n >= 2) two += 1;
    if (n >= 3) three += 1;
  }
  return { worn, two, three };
}

function curseStats(run, grants) {
  const cursed = grants.filter(g => g.cursed);
  const accepted = cursed.filter(g => g.act === 'equip' || g.act === 'relic' || g.act === 'buy');
  const resolved = Object.keys(run.packState?.run || {}).filter(k => k.startsWith('curseResolved:')).length;
  const evoGot = grants.filter(g => g.evolving).length;
  const evoDone = Object.keys(run.packState?.run || {}).filter(k => k.startsWith('evo:') || k.startsWith('cracked:')).length;
  return {
    cursedOffered: cursed.length,
    cursedAccepted: accepted.length,
    curseResolved: resolved,
    evolvingOffered: evoGot,
    evolvingProgressKeys: evoDone,
  };
}

function threadStats(run) {
  const threads = run.world?.threads || {};
  let active = 0, resolved = 0;
  for (const [id, live] of Object.entries(threads)) {
    const stages = THREADS[id]?.stages || [];
    const stage = live?.stage;
    if (!stage) continue;
    const idx = stages.indexOf(stage);
    if (idx === stages.length - 1 && stages.length) resolved += 1;
    else active += 1;
  }
  return { active, resolved, tracked: Object.keys(threads).length };
}

export async function runMeasuredClimb({
  classId, raceId, seed, packOn, gate = GATE.MULTIPLAYER, policyName = 'baseline', pass = 'initial',
} = {}) {
  const flags = armPack(!!packOn, gate);
  const policy = makePolicy(policyName);
  const run = makeV2Run({ classId, raceId, seed, name: 'CP-BAL' });
  const bag = makeCollector();
  run._cpMeasure = bag;
  const t0 = Date.now();
  const result = await simulateClimbV2(run, policy, {
    skipCheckpoints: true,
    dropTrace: true,
  });
  const ms = Date.now() - t0;
  const death = (result.trace || []).find(r => r.outcome === 'dead');
  const sets = setProgress(run);
  const climber = (() => {
    try { return serializeClimber(run); } catch { return { climber: { error: true } }; }
  })();
  const packed = JSON.stringify(climber.climber || climber);
  const packBound = boundPackStateSize(run.packState);
  const grants = bag.grants || [];
  const useful = grants.filter(g => g.slot === 'weapon');
  return {
    bankId: SEED_BANK.id,
    packOn: flags.on,
    gate: flags.gate,
    policy: policyName,
    pass,
    classId,
    raceId,
    seed,
    outcome: result.outcome,
    win: isWin(result.outcome),
    deathFloor: result.deathFloor,
    maxFloor: result.checkpoint?.floor || 0,
    deathCause: death?.deathCause || null,
    deathKind: death?.kind || null,
    starved: !!death?.starved,
    gold: result.checkpoint?.gold || 0,
    goldEarned: result.checkpoint?.goldEarned || 0,
    goldSpent: result.checkpoint?.goldSpent || 0,
    fame: run.fame || 0,
    hp: result.checkpoint?.hp || 0,
    maxHp: result.checkpoint?.maxHp || 0,
    mp: result.checkpoint?.mp || 0,
    maxMp: result.checkpoint?.maxMp || 0,
    level: result.checkpoint?.level || 1,
    f10: { ...bag.f10 },
    bosses: bag.bosses,
    bossEnter: bag.bossEnter,
    combat: bag.combat,
    shop: bag.shop,
    events: bag.events,
    repeatedEvents: bag.repeatedEvents,
    effectOps: bag.effectOps,
    effectCaps: bag.effectCaps,
    skillUses: bag.skillUses,
    consumableUses: bag.consumableUses,
    tech: { offered: bag.techOffered, picked: bag.techPicked, learned: bag.techLearned },
    arts: { offered: bag.artOffered, picked: bag.artPicked, learned: bag.artLearned },
    rarityByChannel: bag.rarityByChannel,
    rarityByFloor: bag.rarityByFloor,
    items: compactGrantActs(grants),
    shopOffers: bag.shopOffers,
    shopBuys: bag.shopBuys,
    skillOffered: bag.skillOffered,
    skillPicked: bag.skillPicked,
    grants: {
      n: grants.length,
      byAct: countBy(grants, g => g.act),
      byChannel: countBy(grants, g => g.channel),
      byRarity: countBy(grants, g => g.rarity),
      legendary: grants.filter(g => g.rarity === 'legendary').length,
      unique: grants.filter(g => g.unique).length,
      wrld: grants.filter(g => g.wrld).length,
      pack: grants.filter(g => g.pack).length,
      usefulWeapon: useful.filter(g => g.useful).length,
      incompatibleWeapon: useful.filter(g => g.incompatible).length,
      equipped: grants.filter(g => g.act === 'equip').length,
      sold: grants.filter(g => g.act === 'sell').length,
      neverEquipped: grants.filter(g => g.slot && g.act !== 'equip' && g.act !== 'relic').length,
    },
    curse: curseStats(run, grants),
    sets,
    threads: threadStats(run),
    final: {
      skills: [...(run.skills || [])],
      knownSkills: [...(run.knownSkills || [])],
      arts: [...(run.arts || [])],
      relics: [...(run.relics || [])],
      equipment: { ...(run.equipment || {}) },
      consumables: [...(run.consumables || [])],
    },
    checkpointBytes: packed.length,
    packStateOk: packBound.ok,
    packStateKeys: packBound.keys,
    ms,
  };
}

export function enumerateClimbJobs({
  packStates = [false, true],
  policyName = 'baseline',
  n = SEED_BANK.initialN,
  pass = 'initial',
  classes = CANONICAL_CLASSES,
  races = CANONICAL_BLOODLINES,
  combos = null,
} = {}) {
  const jobs = [];
  const pairs = combos || classes.flatMap(classId => races.map(raceId => ({ classId, raceId })));
  for (const packOn of packStates) {
    for (const { classId, raceId } of pairs) {
      for (let i = 0; i < n; i++) {
        jobs.push({
          classId, raceId, seed: climbSeed(classId, raceId, i),
          seedIndex: i, packOn, policyName, pass,
        });
      }
    }
  }
  return jobs;
}

export function mean(xs) {
  const n = xs.filter(v => v != null && Number.isFinite(v));
  if (!n.length) return null;
  return n.reduce((a, b) => a + b, 0) / n.length;
}

export function median(xs) {
  const n = xs.filter(v => v != null && Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!n.length) return null;
  const m = Math.floor(n.length / 2);
  return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2;
}

export function stdev(xs) {
  const n = xs.filter(v => v != null && Number.isFinite(v));
  if (n.length < 2) return 0;
  const m = mean(n);
  return Math.sqrt(n.reduce((s, v) => s + (v - m) ** 2, 0) / (n.length - 1));
}

export function percentile(xs, p) {
  const n = xs.filter(v => v != null && Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (!n.length) return null;
  const i = Math.min(n.length - 1, Math.max(0, Math.round((p / 100) * (n.length - 1))));
  return n[i];
}

export function meanCi(xs, z = 1.96) {
  const n = xs.filter(v => v != null && Number.isFinite(v));
  if (!n.length) return { mean: null, lo: null, hi: null, n: 0, stdev: 0 };
  const m = mean(n);
  const s = stdev(n);
  const se = s / Math.sqrt(n.length);
  return { mean: m, lo: m - z * se, hi: m + z * se, n: n.length, stdev: s };
}

export function rateCi(k, n, z = 1.96) {
  if (!n) return { rate: null, lo: null, hi: null, k: 0, n: 0 };
  const p = k / n;
  const se = Math.sqrt(p * (1 - p) / n);
  return { rate: p, lo: Math.max(0, p - z * se), hi: Math.min(1, p + z * se), k, n };
}

export function summarizeRuns(rows) {
  const floors = rows.map(r => r.maxFloor);
  const deaths = rows.filter(r => r.outcome === 'dead').map(r => r.deathFloor);
  const deathDist = {};
  for (const r of rows) {
    if (r.outcome === 'dead') bump(deathDist, String(r.deathFloor));
  }
  const f10a = rows.reduce((s, r) => s + (r.f10?.arrive || 0), 0);
  const f10w = rows.reduce((s, r) => s + (r.f10?.win || 0), 0);
  const bosses = {};
  for (const r of rows) {
    for (const [id, b] of Object.entries(r.bosses || {})) {
      bosses[id] = bosses[id] || { arrive: 0, win: 0, lose: 0 };
      bosses[id].arrive += b.arrive || 0;
      bosses[id].win += b.win || 0;
      bosses[id].lose += b.lose || 0;
    }
  }
  const enterHp = rows.flatMap(r => Object.values(r.bossEnter || {}).map(e => e.hpPct)).filter(Number.isFinite);
  const enterMp = rows.flatMap(r => Object.values(r.bossEnter || {}).map(e => {
    if (!e || !e.maxMp) return null;
    return e.mp / Math.max(1, e.maxMp);
  })).filter(Number.isFinite);
  const enterGold = rows.flatMap(r => Object.values(r.bossEnter || {}).map(e => e.gold)).filter(Number.isFinite);
  const enterHeals = rows.flatMap(r => Object.values(r.bossEnter || {}).map(e => e.healConsumables)).filter(Number.isFinite);
  return {
    n: rows.length,
    wins: rows.filter(r => r.win).length,
    winRate: rateCi(rows.filter(r => r.win).length, rows.length),
    floor: {
      avg: meanCi(floors),
      median: median(floors),
      p25: percentile(floors, 25),
      p75: percentile(floors, 75),
      min: floors.length ? Math.min(...floors) : null,
      max: floors.length ? Math.max(...floors) : null,
    },
    deathFloor: {
      avg: meanCi(deaths),
      median: median(deaths),
      dist: deathDist,
    },
    f10: {
      arrive: rateCi(f10a, rows.length),
      winGivenArrive: rateCi(f10w, f10a),
    },
    bosses,
    bossEnterHpPct: meanCi(enterHp),
    bossEnterMpPct: meanCi(enterMp),
    bossEnterGold: mean(enterGold),
    bossEnterHealConsumables: mean(enterHeals),
    combat: {
      damageDealt: mean(rows.map(r => r.combat?.damageDealt || 0)),
      damageTaken: mean(rows.map(r => r.combat?.damageTaken || 0)),
      healed: mean(rows.map(r => r.combat?.healed || 0)),
      lifesteal: mean(rows.map(r => r.combat?.lifesteal || 0)),
      shields: mean(rows.map(r => r.combat?.shields || 0)),
      revives: mean(rows.map(r => r.combat?.revives || 0)),
      deathwards: mean(rows.map(r => r.combat?.deathwards || 0)),
      packWards: mean(rows.map(r => r.combat?.packWards || 0)),
      rounds: mean(rows.map(r => r.combat?.rounds || 0)),
      mpStarve: mean(rows.map(r => r.combat?.mpStarve || 0)),
      mpOverflow: mean(rows.map(r => r.combat?.mpOverflow || 0)),
      cdBlocked: mean(rows.map(r => r.combat?.cdBlocked || 0)),
      cdActive: mean(rows.map(r => r.combat?.cdActive || 0)),
      chargeStarve: mean(rows.map(r => r.combat?.chargeStarve || 0)),
    },
    gold: {
      earned: mean(rows.map(r => r.goldEarned || 0)),
      spent: mean(rows.map(r => r.goldSpent || 0)),
      retained: mean(rows.map(r => r.gold || 0)),
    },
    fame: mean(rows.map(r => r.fame || 0)),
    shop: {
      visits: mean(rows.map(r => r.shop?.visits || 0)),
      purchases: mean(rows.map(r => r.shop?.purchases || 0)),
      skipped: mean(rows.map(r => r.shop?.skipped || 0)),
      unaffordable: mean(rows.map(r => r.shop?.unaffordable || 0)),
      heals: mean(rows.map(r => r.shop?.heals || 0)),
      restocks: mean(rows.map(r => r.shop?.restocks || 0)),
    },
    rarity: mergeCounts(rows.map(r => r.grants?.byRarity || {})),
    legendary: mean(rows.map(r => r.grants?.legendary || 0)),
    unique: mean(rows.map(r => r.grants?.unique || 0)),
    wrld: mean(rows.map(r => r.grants?.wrld || 0)),
    curse: {
      offered: mean(rows.map(r => r.curse?.cursedOffered || 0)),
      accepted: mean(rows.map(r => r.curse?.cursedAccepted || 0)),
      resolved: mean(rows.map(r => r.curse?.curseResolved || 0)),
    },
    evolving: {
      offered: mean(rows.map(r => r.curse?.evolvingOffered || 0)),
      progress: mean(rows.map(r => r.curse?.evolvingProgressKeys || 0)),
    },
    sets: {
      two: mean(rows.map(r => r.sets?.two || 0)),
      three: mean(rows.map(r => r.sets?.three || 0)),
    },
    equipment: {
      usefulWeapon: mean(rows.map(r => r.grants?.usefulWeapon || 0)),
      incompatibleWeapon: mean(rows.map(r => r.grants?.incompatibleWeapon || 0)),
      equipped: mean(rows.map(r => r.grants?.equipped || 0)),
      sold: mean(rows.map(r => r.grants?.sold || 0)),
    },
    threads: {
      active: mean(rows.map(r => r.threads?.active || 0)),
      resolved: mean(rows.map(r => r.threads?.resolved || 0)),
      tracked: mean(rows.map(r => r.threads?.tracked || 0)),
    },
    ms: mean(rows.map(r => r.ms || 0)),
    checkpointBytes: mean(rows.map(r => r.checkpointBytes || 0)),
  };
}

export function mergeCounts(maps) {
  const out = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m || {})) bump(out, k, v);
  }
  return out;
}

export function groupBy(rows, keyFn) {
  const out = {};
  for (const r of rows) {
    const k = keyFn(r);
    (out[k] || (out[k] = [])).push(r);
  }
  return out;
}
