// Run-health telemetry — observe 51-floor climbs. Does not retune the game.
//   node tools/run_health.js run --name BASELINE --seed 20260823 --trials 400 --out reports/baseline.json
//   node tools/run_health.js compare reports/baseline.json reports/after.json

import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { makeRng } from '../js/rng.js';
import { CLASSES } from '../js/data/classes.js';
import { EVENTS } from '../js/data/events.js';
import { NARRATIVE_EVENTS } from '../js/data/narrative_events.js';
import { SECRET_ROUTES } from '../js/data/world.js';
import { LAST_FLOOR } from '../js/data/floorcards.js';
import { TDC_CLEAR_RATE_DISCLAIMER } from '../js/data/tdc.js';
import { percentile } from './combat_sim.js';
import { simulateHealthClimb, DEFAULT_POLICY } from './run_health_climb.js';

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

export const POLICY = DEFAULT_POLICY;

export const FAITHFUL = 'FAITHFUL / OFFER-SIDE';
export const MODELED = 'MODELED / AUTOPLAY';

/** Every published report metric, classified so modeled numbers cannot be read as offers. */
export const REPORT_FIELD_TRUST = {
  'meta': FAITHFUL,
  'honesty': FAITHFUL,
  'summary.n': FAITHFUL,
  'summary.cleared': MODELED,
  'summary.medianDeathFloor': MODELED,
  'summary.level6': MODELED,
  'summary.level13': MODELED,
  'summary.narrativeOfferPer10': FAITHFUL,
  'summary.shopsOffered': FAITHFUL,
  'pacing': MODELED,
  'cards.offerRates': FAITHFUL,
  'cards.offerTotal': FAITHFUL,
  'cards.takenRates': MODELED,
  'cards.takenTotal': MODELED,
  'narrative.offerPer10': FAITHFUL,
  'narrative.takenPer10': MODELED,
  'narrative.longestNarrativeStreak': MODELED,
  'narrative.longestTakenStreak': MODELED,
  'narrative.callbackOfferDelay': FAITHFUL,
  'narrative.callbackTakenDelay': MODELED,
  'narrative.prereqDelay': MODELED,
  'narrative.threadsOpened': MODELED,
  'narrative.threadsResolved': MODELED,
  'narrative.unresolvedActiveMean': MODELED,
  'secrets.*.eligibleFloor': FAITHFUL,
  'secrets.*.offeredFloor': FAITHFUL,
  'secrets.*.offerDelay': FAITHFUL,
  'secrets.*.outcomes': MODELED,
  'secrets.*.via': MODELED,
  'combat.encounterSize': FAITHFUL,
  'combat.eliteOfferRate': FAITHFUL,
  'combat.archetypes': FAITHFUL,
  'combat.hpLoss': MODELED,
  'combat.potionsUsed': MODELED,
  'economy.shopsOffered': FAITHFUL,
  'economy.goldHeld': MODELED,
  'economy.lateUnspent': MODELED,
  'economy.shopsVisited': MODELED,
  'economy.itemAcquire': MODELED,
  'economy.itemReplace': MODELED,
  'economy.goldByBiome': MODELED,
  'lateGame.reached40': MODELED,
  'lateGame.floorsWithPayoffOfferShare': MODELED,
  'lateGame.takenPayoffMean': MODELED,
  'lateGame.knowledgeAt40Mean': MODELED,
  'lateGame.liveThreadsAt40Mean': MODELED,
  'lateGame.liveSecretsAt40Mean': MODELED,
  'byGrowthRank': MODELED,
  'byClass': MODELED,
  'byOrigin': MODELED,
};

export function contentFingerprint() {
  const events = EVENTS.map(e => e.id).sort().join(',');
  const narrative = NARRATIVE_EVENTS.map(e => e.id).sort().join(',');
  const secrets = Object.keys(SECRET_ROUTES).sort().join(',');
  return `floors:${LAST_FLOOR}|events:${events.length}:${fnv(events)}|narr:${narrative.length}:${fnv(narrative)}|sec:${fnv(secrets)}`;
}

function fnv(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function dist(values) {
  const nums = values.filter(v => v != null && Number.isFinite(v));
  const missing = values.length - nums.length;
  const sorted = [...nums].sort((a, b) => a - b);
  return {
    n: nums.length,
    missing,
    p25: nums.length ? percentile(sorted, 0.25) : null,
    p50: nums.length ? percentile(sorted, 0.5) : null,
    p75: nums.length ? percentile(sorted, 0.75) : null,
    mean: nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null,
  };
}

function mean(values) {
  const nums = values.filter(v => v != null && Number.isFinite(v));
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function sumCounts(rows, key) {
  const out = { combat: 0, narrative: 0, shop: 0, rest: 0, trial: 0, boss: 0, other: 0 };
  for (const r of rows) {
    const c = r[key] || {};
    for (const k of Object.keys(out)) out[k] += c[k] || 0;
  }
  const total = Object.values(out).reduce((a, b) => a + b, 0) || 1;
  const rate = {};
  for (const k of Object.keys(out)) rate[k] = out[k] / total;
  return { counts: out, rate, total };
}

function secretRows(climbs) {
  const byId = {};
  for (const c of climbs) {
    for (const [id, row] of Object.entries(c.secrets || {})) {
      if (!byId[id]) byId[id] = [];
      byId[id].push(row);
    }
  }
  const out = {};
  for (const [id, rows] of Object.entries(byId)) {
    const outcomes = {};
    for (const r of rows) {
      const o = r.outcome || 'never-seen';
      outcomes[o] = (outcomes[o] || 0) + 1;
    }
    const via = { route: 0, fallback: 0, unknown: 0 };
    for (const r of rows) {
      if (r.via) via[r.via] = (via[r.via] || 0) + 1;
    }
    out[id] = {
      n: rows.length,
      eligibleFloor: dist(rows.map(r => r.eligibleFloor)),
      offeredFloor: dist(rows.map(r => r.offeredFloor)),
      offerDelay: dist(rows.map(r => r.offerDelay)),
      outcomes,
      via,
    };
  }
  return out;
}

function groupBy(climbs, key) {
  const map = {};
  for (const c of climbs) {
    const k = c[key] || 'unknown';
    if (!map[k]) map[k] = [];
    map[k].push(c);
  }
  return map;
}

function lateSummary(climbs) {
  const reached = climbs.filter(c => c.maxFloor >= 40);
  const offerShare = reached.length
    ? reached.filter(c => (c.lateOfferPayoff || []).length).length / reached.length
    : 0;
  const takenMean = mean(reached.map(c => (c.lateTakenPayoff || []).length));
  const knowledgeAt40 = mean(reached.map(c => (c.keysAt40?.knowledge || []).length));
  const threadsAt40 = mean(reached.map(c => (c.keysAt40?.threads || []).length));
  const secretsLive40 = mean(reached.map(c => (c.keysAt40?.secrets || []).length));
  return {
    reached40: reached.length,
    floorsWithPayoffOfferShare: offerShare,
    takenPayoffMean: takenMean,
    knowledgeAt40Mean: knowledgeAt40,
    liveThreadsAt40Mean: threadsAt40,
    liveSecretsAt40Mean: secretsLive40,
  };
}

export function aggregateClimbs(climbs) {
  const cleared = climbs.filter(c => c.cleared).length;
  const offer = sumCounts(climbs, 'offerCounts');
  const taken = sumCounts(climbs, 'takenCounts');
  return {
    n: climbs.length,
    cleared: cleared / (climbs.length || 1),
    medianDeathFloor: dist(climbs.map(c => c.deathFloor ?? LAST_FLOOR + 1)).p50,
    maxFloor: dist(climbs.map(c => c.maxFloor)),
    finalLevel: dist(climbs.map(c => c.finalLevel)),
    finalGold: dist(climbs.map(c => c.finalGold)),
    pacing: {
      level6: dist(climbs.map(c => c.levelFloors?.[6])),
      level10: dist(climbs.map(c => c.levelFloors?.[10])),
      level13: dist(climbs.map(c => c.levelFloors?.[13])),
      level16: dist(climbs.map(c => c.levelFloors?.[16])),
      level20: dist(climbs.map(c => c.levelFloors?.[20])),
    },
    cards: {
      offerRates: offer.rate,
      takenRates: taken.rate,
      offerTotal: offer.total,
      takenTotal: taken.total,
    },
    narrative: {
      offerPer10: dist(climbs.map(c => c.narrativeOfferPer10)),
      takenPer10: dist(climbs.map(c => c.narrativeTakenPer10)),
      longestNarrativeStreak: dist(climbs.map(c => c.longestNarrativeStreak)),
      longestTakenStreak: dist(climbs.map(c => c.longestTakenStreak)),
      callbackOfferDelay: dist(climbs.flatMap(c => c.callbackOffer || [])),
      callbackTakenDelay: dist(climbs.flatMap(c => c.callbackTaken || [])),
      prereqDelay: dist(climbs.flatMap(c => c.prereqDelays || [])),
      threadsOpened: dist(climbs.map(c => c.threadsOpened)),
      threadsResolved: dist(climbs.map(c => c.threadsResolved)),
      unresolvedActiveMean: mean(climbs.flatMap(c => (c.unresolvedByFloor || []).map(x => x.active))),
    },
    secrets: secretRows(climbs),
    combat: {
      encounterSize: dist(climbs.flatMap(c => c.encounterSizes || [])),
      eliteOfferRate: (() => {
        const of = climbs.reduce((s, c) => s + (c.eliteOffered?.of || 0), 0);
        const n = climbs.reduce((s, c) => s + (c.eliteOffered?.n || 0), 0);
        return of ? n / of : 0;
      })(),
      hpLoss: dist(climbs.flatMap(c => c.hpLoss || [])),
      potionsUsed: dist(climbs.map(c => c.potionsUsed)),
      archetypes: climbs.reduce((acc, c) => {
        for (const [k, v] of Object.entries(c.archetypes || {})) acc[k] = (acc[k] || 0) + v;
        return acc;
      }, {}),
    },
    economy: {
      goldHeld: dist(climbs.flatMap(c => (c.goldHeld || []).map(x => x.gold))),
      lateUnspent: dist(climbs.filter(c => c.maxFloor >= 40).map(c => c.finalGold)),
      shopsOffered: dist(climbs.map(c => c.shopsOffered)),
      shopsVisited: dist(climbs.map(c => c.shopsVisited)),
      itemAcquire: dist(climbs.map(c => c.itemAcquire)),
      itemReplace: dist(climbs.map(c => c.itemReplace)),
      goldByBiome: biomeGold(climbs),
    },
    lateGame: lateSummary(climbs),
  };
}

function biomeGold(climbs) {
  const out = {};
  for (const c of climbs) {
    for (const [biome, row] of Object.entries(c.goldByBiome || {})) {
      if (!out[biome]) out[biome] = { earned: [], spent: [] };
      out[biome].earned.push(row.earned);
      out[biome].spent.push(row.spent);
    }
  }
  const report = {};
  for (const [biome, row] of Object.entries(out)) {
    report[biome] = { earned: dist(row.earned), spent: dist(row.spent) };
  }
  return report;
}

function sliceReport(climbs) {
  const agg = aggregateClimbs(climbs);
  return {
    n: agg.n,
    pacing: agg.pacing,
    cards: agg.cards,
    narrative: {
      offerPer10: agg.narrative.offerPer10,
      takenPer10: agg.narrative.takenPer10,
    },
    secrets: agg.secrets,
  };
}

export function buildHealthReport(climbs, meta) {
  const core = aggregateClimbs(climbs);
  const byGrowthRank = {};
  for (const [k, rows] of Object.entries(groupBy(climbs, 'growthRank'))) {
    byGrowthRank[k] = sliceReport(rows);
  }
  const byClass = {};
  for (const [k, rows] of Object.entries(groupBy(climbs, 'classId'))) {
    byClass[k] = sliceReport(rows);
  }
  const byOrigin = {};
  for (const [k, rows] of Object.entries(groupBy(climbs, 'originId'))) {
    byOrigin[k] = sliceReport(rows);
  }
  return {
    meta: {
      name: meta.name || 'run-health',
      seed: meta.seed,
      trials: climbs.length,
      policy: meta.policy || DEFAULT_POLICY,
      partySize: 1,
      classId: meta.classId || null,
      git: meta.git || null,
      contentFingerprint: contentFingerprint(),
      generatedAt: meta.generatedAt || new Date().toISOString(),
    },
    honesty: {
      offer: ['generateFloorCards', 'special floors (boss/trial/campfire/throne)'],
      taken: 'autoplay-random-path + pickEventChoice + simulateFight',
      fields: REPORT_FIELD_TRUST,
      tdcClearRate: TDC_CLEAR_RATE_DISCLAIMER,
      notes: [
        'FAITHFUL / OFFER-SIDE fields come from live generation and eligibility rules.',
        'MODELED / AUTOPLAY fields depend on synthetic path pick, event choice, combat autoplay, or shop spend.',
        'Taken mix is not human path preference.',
        'Combat always fights (no sneak/bribe).',
        'Headless fights omit full status-DoT loops.',
        'Shop spend is greedy auto-buy.',
        'L6/L13 subclass pick is random among options.',
        TDC_CLEAR_RATE_DISCLAIMER,
      ],
    },
    summary: {
      n: core.n,
      cleared: core.cleared,
      medianDeathFloor: core.medianDeathFloor,
      level6: core.pacing.level6,
      level13: core.pacing.level13,
      narrativeOfferPer10: core.narrative.offerPer10,
      shopsOffered: core.economy.shopsOffered,
    },
    pacing: core.pacing,
    cards: core.cards,
    narrative: core.narrative,
    secrets: core.secrets,
    combat: core.combat,
    economy: core.economy,
    lateGame: core.lateGame,
    byGrowthRank,
    byClass,
    byOrigin,
  };
}

export function runHealthSuite({
  name = 'run-health',
  seed = 20260823,
  trials = 400,
  policy = DEFAULT_POLICY,
  classId = null,
  originId = null,
  stratify = null,
} = {}) {
  const climbs = [];
  const classIds = Object.keys(CLASSES);
  for (let i = 0; i < trials; i++) {
    const rng = makeRng((seed + i * 9973) >>> 0);
    const lockedClass = stratify === 'class'
      ? classIds[i % classIds.length]
      : classId;
    climbs.push(simulateHealthClimb(rng, { policy, classId: lockedClass, originId }));
  }
  return buildHealthReport(climbs, { name, seed, policy, classId, generatedAt: new Date().toISOString() });
}

/**
 * True-merchant ACCESS using generateFloorCards offers, independent of death.
 * survive:true so late gates are generated; taken/visit stays autoplay.
 */
export function runMerchantAccess({ seed = 20260823, trials = 300 } = {}) {
  const climbs = [];
  for (let i = 0; i < trials; i++) {
    const rng = makeRng((seed + i * 9973) >>> 0);
    climbs.push(simulateHealthClimb(rng, { survive: true }));
  }
  const offerFloor = climbs.map(c => c.firstTrueMerchantOfferFloor);
  const visitFloor = climbs.map(c => c.firstTrueMerchantVisitFloor);
  const offeredBy = (f) => climbs.filter(c => c.firstTrueMerchantOfferFloor != null && c.firstTrueMerchantOfferFloor <= f).length / trials;
  const visitedBy = (f) => climbs.filter(c => c.firstTrueMerchantVisitFloor != null && c.firstTrueMerchantVisitFloor <= f).length / trials;
  const offerCountsBy = (f) => dist(climbs.map(c => c.trueMerchantOffersBy?.[f] ?? 0));
  const visitCountsBy = (f) => dist(climbs.map(c => c.trueMerchantVisitsBy?.[f] ?? 0));
  return {
    trials,
    seed,
    honesty: {
      offered: 'generateFloorCards on every travel floor (survive:true, death does not stop the deal)',
      visited: 'autoplay-random-path chose the merchant card',
    },
    offered: {
      byF10: offeredBy(10),
      byF15: offeredBy(15),
      beforeLeavingForest: offeredBy(10),
      firstFloor: dist(offerFloor),
      any: climbs.filter(c => c.trueMerchantOffers > 0).length / trials,
    },
    visited: {
      byF10: visitedBy(10),
      byF15: visitedBy(15),
      firstFloor: dist(visitFloor),
      any: climbs.filter(c => c.trueMerchantVisits > 0).length / trials,
    },
    offerCounts: { f30: offerCountsBy(30), f45: offerCountsBy(45) },
    visitCounts: { f30: visitCountsBy(30), f45: visitCountsBy(45) },
    offersFullRun: dist(climbs.map(c => c.trueMerchantOffers || 0)),
    visitsFullRun: dist(climbs.map(c => c.trueMerchantVisits || 0)),
  };
}

export function formatMerchantAccess(rep) {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const fmt = (d) => (!d || d.n === 0)
    ? 'n=0'
    : `n=${d.n}  P25=${d.p25}  med=${d.p50}  P75=${d.p75}  miss=${d.missing}`;
  return [
    `True-merchant ACCESS — seed ${rep.seed}, ${rep.trials} generated climbs (survive:true)`,
    `  offered (card dealt):  by F10 ${pct(rep.offered.byF10)}  by F15 ${pct(rep.offered.byF15)}  before leaving Forest ${pct(rep.offered.beforeLeavingForest)}  any ${pct(rep.offered.any)}`,
    `  first offer floor     ${fmt(rep.offered.firstFloor)}`,
    `  visited (autoplay):    by F10 ${pct(rep.visited.byF10)}  by F15 ${pct(rep.visited.byF15)}  any ${pct(rep.visited.any)}`,
    `  first visit floor     ${fmt(rep.visited.firstFloor)}`,
    `  offers by F30         ${fmt(rep.offerCounts.f30)}`,
    `  offers by F45         ${fmt(rep.offerCounts.f45)}`,
    `  visits by F30         ${fmt(rep.visitCounts.f30)}`,
    `  visits by F45         ${fmt(rep.visitCounts.f45)}`,
    `  offers / full 51F     ${fmt(rep.offersFullRun)}`,
    `  visits / full 51F     ${fmt(rep.visitsFullRun)}`,
    `  ${rep.honesty.offered}`,
    `  ${rep.honesty.visited}`,
  ].join('\n');
}

function pct(x) {
  if (x == null || !Number.isFinite(x)) return '—';
  return `${(x * 100).toFixed(1)}%`;
}

function fmtDist(d, digits = 1) {
  if (!d || d.n === 0) return `n=0 missing=${d?.missing ?? 0}`;
  const n = (v) => (v == null ? '—' : Number(v).toFixed(digits));
  return `p25 ${n(d.p25)} / p50 ${n(d.p50)} / p75 ${n(d.p75)} (n=${d.n} miss=${d.missing})`;
}

export function formatHealthReport(rep) {
  const lines = [
    `Run-health — ${rep.meta.name}  seed ${rep.meta.seed}  trials ${rep.meta.trials}  policy ${rep.meta.policy}`,
    `fingerprint ${rep.meta.contentFingerprint}`,
    `honesty: offer=${rep.honesty.offer.join(', ')}`,
    `         taken=${rep.honesty.taken}`,
    `NOTE: ${rep.honesty.tdcClearRate || TDC_CLEAR_RATE_DISCLAIMER}`,
    '',
    `${FAITHFUL}`,
    `  offer mix  ${Object.entries(rep.cards.offerRates).map(([k, v]) => `${k} ${pct(v)}`).join('  ')}`,
    `  narrative /10 floors  offer ${fmtDist(rep.narrative.offerPer10)}`,
    `  callback delay offer ${fmtDist(rep.narrative.callbackOfferDelay)}`,
    `  shops offered ${fmtDist(rep.economy.shopsOffered)}`,
    `  combat size ${fmtDist(rep.combat.encounterSize)}  elite offer ${pct(rep.combat.eliteOfferRate)}`,
    '',
    `${MODELED} — synthetic path/choice/combat/spend; not player behavior`,
    `  cleared ${pct(rep.summary.cleared)}  median death/finish floor ${rep.summary.medianDeathFloor}`,
    `  level 6  ${fmtDist(rep.pacing.level6)}`,
    `  level 13 ${fmtDist(rep.pacing.level13)}`,
    `  taken mix  ${Object.entries(rep.cards.takenRates).map(([k, v]) => `${k} ${pct(v)}`).join('  ')}`,
    `  narrative /10 floors  taken ${fmtDist(rep.narrative.takenPer10)}`,
    `  taken narrative streak p50 ${rep.narrative.longestNarrativeStreak.p50}  threads open/resolve p50 ${rep.narrative.threadsOpened.p50}/${rep.narrative.threadsResolved.p50}`,
    `  HP loss ${fmtDist(rep.combat.hpLoss, 2)}  late unspent gold ${fmtDist(rep.economy.lateUnspent, 0)}`,
    `  late-game F40+ payoff-offer share (survivors) ${pct(rep.lateGame.floorsWithPayoffOfferShare)}  taken payoff mean ${Number(rep.lateGame.takenPayoffMean || 0).toFixed(2)}`,
  ];
  const secretBits = Object.entries(rep.secrets).slice(0, 6).map(([id, s]) => {
    const never = s.outcomes['never-seen'] || 0;
    return `${id} elig p50 ${s.eligibleFloor.p50 ?? '—'} offer p50 ${s.offeredFloor.p50 ?? '—'} never(modeled) ${never}/${s.n}`;
  });
  if (secretBits.length) {
    lines.push(`  secrets  ${secretBits.join(' · ')}`);
  }
  return lines.join('\n');
}

function delta(a, b) {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return b - a;
}

export function compareHealthReports(a, b) {
  const keys = [
    ['cleared', a.summary.cleared, b.summary.cleared],
    ['medianDeathFloor', a.summary.medianDeathFloor, b.summary.medianDeathFloor],
    ['level6.p50', a.pacing.level6.p50, b.pacing.level6.p50],
    ['level13.p50', a.pacing.level13.p50, b.pacing.level13.p50],
    ['narrativeOfferPer10.p50', a.narrative.offerPer10.p50, b.narrative.offerPer10.p50],
    ['narrativeTakenPer10.p50', a.narrative.takenPer10.p50, b.narrative.takenPer10.p50],
    ['threadsOpened.p50', a.narrative.threadsOpened.p50, b.narrative.threadsOpened.p50],
    ['latePayoffOfferShare', a.lateGame.floorsWithPayoffOfferShare, b.lateGame.floorsWithPayoffOfferShare],
  ];
  const cardKeys = Object.keys(a.cards.offerRates || {});
  const cardDeltas = {};
  for (const k of cardKeys) {
    cardDeltas[k] = {
      offer: delta(a.cards.offerRates[k], b.cards.offerRates[k]),
      taken: delta(a.cards.takenRates[k], b.cards.takenRates[k]),
    };
  }
  return {
    a: a.meta.name,
    b: b.meta.name,
    fingerprintMatch: a.meta.contentFingerprint === b.meta.contentFingerprint,
    sameSeed: a.meta.seed === b.meta.seed && a.meta.trials === b.meta.trials,
    deltas: Object.fromEntries(keys.map(([k, av, bv]) => [k, {
      a: av, b: bv, delta: delta(av, bv),
      kind: k === 'narrativeOfferPer10.p50' ? FAITHFUL : MODELED,
    }])),
    cardDeltas,
    tdcClearRate: TDC_CLEAR_RATE_DISCLAIMER,
  };
}

export function formatCompare(cmp) {
  const lines = [
    `Compare ${cmp.a} → ${cmp.b}`,
    `fingerprint ${cmp.fingerprintMatch ? 'match' : 'MISMATCH — content drifted'}  paired ${cmp.sameSeed ? 'yes' : 'no'}`,
    `NOTE: ${cmp.tdcClearRate || TDC_CLEAR_RATE_DISCLAIMER}`,
  ];
  for (const [k, row] of Object.entries(cmp.deltas)) {
    const d = row.delta == null ? '—' : (row.delta >= 0 ? `+${row.delta.toFixed(3)}` : row.delta.toFixed(3));
    const kind = row.kind === FAITHFUL ? 'offer' : 'modeled';
    lines.push(`  [${kind}] ${k.padEnd(28)} ${row.a ?? '—'} → ${row.b ?? '—'}  (${d})`);
  }
  const notable = Object.entries(cmp.cardDeltas)
    .filter(([, v]) => Math.abs(v.offer || 0) >= 0.02 || Math.abs(v.taken || 0) >= 0.02);
  if (notable.length) {
    lines.push('  card-mix shifts (≥2pts):');
    for (const [k, v] of notable) {
      lines.push(`    ${k} offer(faithful) ${(v.offer * 100).toFixed(1)}pts  taken(modeled) ${(v.taken * 100).toFixed(1)}pts`);
    }
  }
  return lines.join('\n');
}

export function stripReportTimestamps(rep) {
  const copy = JSON.parse(JSON.stringify(rep));
  if (copy.meta) delete copy.meta.generatedAt;
  return copy;
}

function parseArgs(argv) {
  const out = { cmd: argv[2] || 'run', flags: {} };
  const rest = argv.slice(3);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const nxt = rest[i + 1];
      if (!nxt || nxt.startsWith('--')) out.flags[key] = true;
      else { out.flags[key] = nxt; i += 1; }
    } else {
      if (!out.flags._) out.flags._ = [];
      out.flags._.push(a);
    }
  }
  return out;
}

const isMain = process.argv[1] && /run_health\.js/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const { cmd, flags } = parseArgs(process.argv);
  if (cmd === 'merchants') {
    const seed = Number(flags.seed || 20260823);
    const trials = Number(flags.trials || 300);
    const rep = runMerchantAccess({ seed, trials });
    console.log(formatMerchantAccess(rep));
    if (flags.out) {
      mkdirSync(dirname(flags.out), { recursive: true });
      writeFileSync(flags.out, JSON.stringify(rep, null, 2));
      console.log(`\nwrote ${flags.out}`);
    }
  } else if (cmd === 'compare') {
    const aPath = flags._?.[0];
    const bPath = flags._?.[1];
    if (!aPath || !bPath) {
      console.error('usage: node tools/run_health.js compare <a.json> <b.json>');
      process.exit(1);
    }
    const a = JSON.parse(readFileSync(aPath, 'utf8'));
    const b = JSON.parse(readFileSync(bPath, 'utf8'));
    console.log(formatCompare(compareHealthReports(a, b)));
  } else {
    const seed = Number(flags.seed || 20260823);
    const trials = Number(flags.trials || 400);
    const name = String(flags.name || 'BASELINE');
    const policy = String(flags.policy || DEFAULT_POLICY);
    const classId = flags.class || null;
    const stratify = flags.stratify || null;
    const rep = runHealthSuite({ name, seed, trials, policy, classId, stratify });
    console.log(formatHealthReport(rep));
    if (flags.out) {
      mkdirSync(dirname(flags.out), { recursive: true });
      writeFileSync(flags.out, JSON.stringify(rep, null, 2));
      console.log(`\nwrote ${flags.out}`);
    }
  }
}
