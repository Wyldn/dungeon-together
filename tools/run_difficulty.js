#!/usr/bin/env node
// Live climb-v2 difficulty distribution. Measure first — do not retune the game.
//   node tools/run_difficulty.js --seed 20260823 --runs 1000
//   node tools/run_difficulty.js --seed 20260823 --runs 1000 --compare
//   node tools/run_health.js --seed 20260823 --runs 1000

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { CLASSES } from '../js/data/classes.js';
import { LAST_FLOOR } from '../js/data/floorcards.js';
import { broadFamily } from '../js/data/floorcards.js';
import { encounterOptions } from '../js/encounter.js';
import { shopHealCost, shopPrice } from '../js/shop.js';
import { TDC, TDC_CLEAR_RATE_DISCLAIMER } from '../js/data/tdc.js';
import { simulateClimbV2, makeV2Run } from './run_climb_v2.js';
import { baselinePolicy } from './policies/baseline.js';
import { reasonablePolicy } from './policies/reasonable.js';

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

export const BASE_CLASSES = Object.values(CLASSES).filter(c => !c.hidden).map(c => c.id);
export const EARLY_BRICK_BEFORE = 6;
export const POLICY_NAMES = ['baseline', 'reasonable'];

export function isWin(outcome) {
  return outcome === 'win' || outcome === 'secret' || outcome === 'corrupt_king';
}

export function climbSeed(baseSeed, seedIndex) {
  return (Math.trunc(baseSeed) + seedIndex * 9973) >>> 0;
}

export function makePolicy(name = 'baseline') {
  if (name === 'reasonable') return reasonablePolicy();
  if (name === 'scripted') {
    throw new Error('scripted policy is for golden replay only, not win-rate estimates');
  }
  return baselinePolicy();
}

function emptyNotes() {
  return {
    ignoredRecoveryCard: 0,
    refusedShopHeal: 0,
    refusedAffordableGear: 0,
    boughtGear: 0,
    boughtConsumable: 0,
    shopHeals: 0,
    shopDecisions: 0,
    foughtWhileCritical: 0,
  };
}

export function instrumentPolicy(policy, notes) {
  return {
    ...policy,
    chooseFloorCard(run, cards) {
      const pick = policy.chooseFloorCard(run, cards);
      const hp = run.hp / Math.max(1, run.maxHp);
      const families = cards.map(c => broadFamily(c));
      if (hp < 0.35 && broadFamily(pick) === 'combat' && families.some(f => f === 'rest' || f === 'shop')) {
        notes.ignoredRecoveryCard += 1;
      }
      return pick;
    },
    chooseShopAction(run, stock, ctx) {
      const act = policy.chooseShopAction(run, stock, ctx);
      notes.shopDecisions += 1;
      if (!act || act.act === 'leave') {
        const cost = shopHealCost(run, ctx.discount);
        if (run.hp < run.maxHp * 0.5 && run.gold >= cost && run.hp < run.maxHp) {
          notes.refusedShopHeal += 1;
        }
        const affordableGear = (stock || []).some(s => (
          (s.kind === 'equip' || s.kind === 'relic')
          && run.gold >= shopPrice(s.price, ctx.discount)
        ));
        if (affordableGear) notes.refusedAffordableGear += 1;
      }
      if (act?.act === 'buy') {
        const s = stock[act.i];
        if (s?.kind === 'equip' || s?.kind === 'relic') notes.boughtGear += 1;
        if (s?.kind === 'consumable') notes.boughtConsumable += 1;
      }
      if (act?.act === 'heal') notes.shopHeals += 1;
      return act;
    },
    chooseEncounterApproach(run, group, opts) {
      const act = policy.chooseEncounterApproach(run, group, opts);
      const hp = run.hp / Math.max(1, run.maxHp);
      const o = encounterOptions(run, group);
      if (act === 'fight' && hp < 0.3 && (o.canBribe || true)) notes.foughtWhileCritical += 1;
      return act;
    },
  };
}

function summarizeClimb(result, notes) {
  const trace = result.trace || [];
  const death = trace.find(r => r.outcome === 'dead');
  const marks = {};
  for (const f of [10, 20, 30, 40, 50]) {
    const rec = trace.find(r => r.floor === f);
    if (rec) marks[f] = rec.enter;
  }
  return {
    seed: result.seed,
    classId: result.classId,
    outcome: result.outcome,
    win: isWin(result.outcome),
    deathFloor: result.deathFloor,
    maxFloor: result.checkpoint?.floor || 0,
    growthRank: result.growthRank || null,
    finalHp: result.checkpoint?.hp ?? 0,
    finalMaxHp: result.checkpoint?.maxHp ?? 0,
    finalGold: result.checkpoint?.gold ?? 0,
    deathCause: death?.deathCause || null,
    deathEventId: death?.meta?.eventId || null,
    deathBossId: death?.meta?.bossId || null,
    starved: !!death?.starved,
    biomeAtDeath: death?.biome || null,
    marks,
    bosses: trace.filter(r => r.kind === 'boss' || r.kind === 'throne').map(r => ({
      floor: r.floor,
      kind: r.kind,
      bossId: r.meta?.bossId || null,
      isAlt: !!r.meta?.isAltBoss,
      outcome: r.outcome,
      hpEnter: r.enter?.hp ?? 0,
      hpEnterPct: r.enter?.hpPct ?? 0,
      hpLeave: r.leave?.hp ?? 0,
      hpLeavePct: r.leave?.hpPct ?? 0,
      fought: r.meta?.fought !== false && (r.kind === 'boss' || !!r.meta?.fought),
    })),
    encounters: trace.flatMap(r => (r.meta?.enemies || []).map(e => ({
      id: e.id,
      name: e.name || e.id,
      elite: !!e.elite,
      boss: !!e.boss,
      floor: r.floor,
      died: r.outcome === 'dead',
    }))),
    notes,
    floors: trace.map(r => ({
      floor: r.floor,
      kind: r.kind,
      biome: r.biome,
      outcome: r.outcome,
      deathCause: r.deathCause || null,
      enter: r.enter,
      leave: r.leave,
    })),
  };
}

export async function runDifficultyClimb({
  seed,
  classId = 'warrior',
  policy = 'baseline',
} = {}) {
  const notes = emptyNotes();
  const wrapped = instrumentPolicy(makePolicy(policy), notes);
  const run = makeV2Run({ seed, classId, kitSeed: seed, name: 'Difficulty' });
  const result = await simulateClimbV2(run, wrapped);
  return summarizeClimb(result, notes);
}

export function planDifficultyJobs({
  seed = 20260823,
  runs = 1000,
  classId = null,
  classes = BASE_CLASSES,
} = {}) {
  const roster = classId ? [classId] : [...classes];
  const nSeeds = Math.max(1, Math.ceil(runs / roster.length));
  const jobs = [];
  for (let i = 0; i < nSeeds; i++) {
    const climb = climbSeed(seed, i);
    for (const cid of roster) {
      jobs.push({ seed: climb, classId: cid, seedIndex: i });
    }
  }
  return { jobs, nSeeds, classes: roster };
}

export async function runDifficultySuite({
  seed = 20260823,
  runs = 1000,
  policy = 'baseline',
  classId = null,
  classes = BASE_CLASSES,
  name = null,
} = {}) {
  const { jobs, nSeeds } = planDifficultyJobs({ seed, runs, classId, classes });
  const climbs = [];
  for (const job of jobs) {
    climbs.push(await runDifficultyClimb({
      seed: job.seed,
      classId: job.classId,
      policy,
    }));
  }
  return buildDifficultyReport(climbs, {
    name: name || policy,
    seed,
    policy,
    nSeeds,
    generatedAt: new Date().toISOString(),
  });
}

function mean(values) {
  const nums = values.filter(v => v != null && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function median(values) {
  const nums = values.filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function pct(n, d) {
  return d ? n / d : 0;
}

function reachRate(climbs, floor) {
  return pct(climbs.filter(c => c.maxFloor >= floor).length, climbs.length);
}

const DEATH_BANDS = [
  { id: 'F1-5', label: 'Died F1–5', test: c => c.outcome === 'dead' && c.deathFloor >= 1 && c.deathFloor <= 5 },
  { id: 'F6-10', label: 'Died F6–10', test: c => c.outcome === 'dead' && c.deathFloor >= 6 && c.deathFloor <= 10 },
  { id: 'F11-20', label: 'Died F11–20', test: c => c.outcome === 'dead' && c.deathFloor >= 11 && c.deathFloor <= 20 },
  { id: 'F21-30', label: 'Died F21–30', test: c => c.outcome === 'dead' && c.deathFloor >= 21 && c.deathFloor <= 30 },
  { id: 'F31-40', label: 'Died F31–40', test: c => c.outcome === 'dead' && c.deathFloor >= 31 && c.deathFloor <= 40 },
  { id: 'F41-49', label: 'Died F41–49', test: c => c.outcome === 'dead' && c.deathFloor >= 41 && c.deathFloor <= 49 },
  { id: 'F50', label: 'Died F50', test: c => c.outcome === 'dead' && c.deathFloor === 50 },
  { id: 'throne_loss', label: 'Throne loss', test: c => c.outcome === 'dead' && c.deathFloor >= 51 },
  { id: 'escape', label: 'Escape', test: c => c.outcome === 'escape' },
  { id: 'won', label: 'Won', test: c => c.win },
];

function markMeans(climbs, floor) {
  const rows = climbs.map(c => c.marks?.[floor]).filter(Boolean);
  return {
    n: rows.length,
    hp: mean(rows.map(r => r.hp)),
    maxHp: mean(rows.map(r => r.maxHp)),
    hpPct: mean(rows.map(r => r.hpPct)),
    gold: mean(rows.map(r => r.gold)),
    consumables: mean(rows.map(r => r.consumables)),
    healConsumables: mean(rows.map(r => r.healConsumables)),
    relics: mean(rows.map(r => r.relics)),
    skills: mean(rows.map(r => r.skills)),
    equipped: mean(rows.map(r => r.equipped)),
  };
}

function classSlice(climbs) {
  const n = climbs.length || 1;
  const wins = climbs.filter(c => c.win).length;
  const deaths = climbs.filter(c => c.outcome === 'dead');
  const brick = climbs.filter(c => c.outcome === 'dead' && c.deathFloor != null && c.deathFloor < EARLY_BRICK_BEFORE);
  const reached40 = climbs.filter(c => c.maxFloor >= 40);
  const reached50 = climbs.filter(c => c.maxFloor >= 50);
  const reachedThrone = climbs.filter(c => c.maxFloor >= LAST_FLOOR);
  return {
    n: climbs.length,
    wins,
    winRate: wins / n,
    avgFloor: mean(climbs.map(c => c.maxFloor)),
    medianFloor: median(climbs.map(c => c.maxFloor)),
    medianDeathFloor: median(deaths.map(c => c.deathFloor)),
    earlyBrickRate: brick.length / n,
    reach: {
      10: reachRate(climbs, 10),
      20: reachRate(climbs, 20),
      30: reachRate(climbs, 30),
      40: reachRate(climbs, 40),
      50: reachRate(climbs, 50),
      throne: reachRate(climbs, LAST_FLOOR),
    },
    winGiven40: pct(reached40.filter(c => c.win).length, reached40.length),
    winGiven50: pct(reached50.filter(c => c.win).length, reached50.length),
    winGivenThrone: pct(reachedThrone.filter(c => c.win).length, reachedThrone.length),
  };
}

function mortalityCurve(climbs) {
  const byFloor = [];
  let spike = { floor: null, rate: -1, died: 0, entered: 0 };
  for (let f = 1; f <= LAST_FLOOR; f++) {
    const entered = climbs.filter(c => c.maxFloor >= f).length;
    const died = climbs.filter(c => c.outcome === 'dead' && c.deathFloor === f).length;
    const rate = pct(died, entered);
    byFloor.push({ floor: f, entered, died, rate });
    if (entered >= 8 && rate > spike.rate) spike = { floor: f, rate, died, entered };
  }
  const bands = [
    [1, 8], [9, 20], [21, 24], [25, 30], [31, 40], [41, 49], [50, 50], [51, 51],
  ].map(([lo, hi]) => {
    const entered = climbs.filter(c => c.maxFloor >= lo).length;
    const died = climbs.filter(c => c.outcome === 'dead' && c.deathFloor >= lo && c.deathFloor <= hi).length;
    return { lo, hi, entered, died, rate: pct(died, entered) };
  });
  return { byFloor, bands, spike };
}

function bossTable(climbs) {
  const map = {};
  for (const c of climbs) {
    for (const b of c.bosses || []) {
      if (!b.bossId && b.kind !== 'throne') continue;
      const key = b.bossId || (b.kind === 'throne' ? 'throne' : 'unknown');
      if (!map[key]) {
        map[key] = {
          id: key,
          floor: b.floor,
          kind: b.kind,
          isAlt: !!b.isAlt,
          reached: 0,
          fights: 0,
          wins: 0,
          losses: 0,
          hpEnter: [],
          hpLeaveWin: [],
          byClass: {},
        };
      }
      const row = map[key];
      row.reached += 1;
      if (!row.byClass[c.classId]) row.byClass[c.classId] = { reached: 0, wins: 0, losses: 0 };
      row.byClass[c.classId].reached += 1;
      row.hpEnter.push(b.hpEnterPct);
      const survived = b.outcome !== 'dead';
      if (b.fought) {
        row.fights += 1;
        if (survived) {
          row.wins += 1;
          row.hpLeaveWin.push(b.hpLeavePct);
          row.byClass[c.classId].wins += 1;
        } else {
          row.losses += 1;
          row.byClass[c.classId].losses += 1;
        }
      } else if (isWin(b.outcome) || b.outcome === 'secret') {
        row.wins += 1;
        row.byClass[c.classId].wins += 1;
      }
    }
  }
  return Object.values(map).map(row => ({
    ...row,
    survival: pct(row.wins, row.fights || row.reached),
    avgHpEnter: mean(row.hpEnter),
    avgHpLeaveWin: mean(row.hpLeaveWin),
  })).sort((a, b) => a.floor - b.floor || a.id.localeCompare(b.id));
}

function encounterTable(climbs) {
  const map = {};
  for (const c of climbs) {
    for (const e of c.encounters || []) {
      if (!e.id) continue;
      if (!map[e.id]) {
        map[e.id] = { id: e.id, name: e.name || e.id, seen: 0, deaths: 0, elite: !!e.elite, boss: !!e.boss };
      }
      map[e.id].seen += 1;
      if (e.died) map[e.id].deaths += 1;
    }
  }
  return Object.values(map)
    .map(row => ({ ...row, deathRate: pct(row.deaths, row.seen) }))
    .sort((a, b) => b.deaths - a.deaths || b.deathRate - a.deathRate);
}

function deathCauses(climbs) {
  const map = {};
  const deaths = climbs.filter(c => c.outcome === 'dead');
  for (const c of deaths) {
    const k = c.deathCause || 'unknown';
    map[k] = (map[k] || 0) + 1;
  }
  return Object.entries(map)
    .map(([cause, n]) => ({ cause, n, rate: pct(n, deaths.length) }))
    .sort((a, b) => b.n - a.n);
}

function seedVariance(climbs) {
  const bySeed = {};
  for (const c of climbs) {
    if (!bySeed[c.seed]) bySeed[c.seed] = [];
    bySeed[c.seed].push(c);
  }
  const multi = Object.entries(bySeed).filter(([, rows]) => rows.length >= 3);
  const allEarly = [];
  const allWin = [];
  const spreads = [];
  for (const [seed, rows] of multi) {
    const floors = rows.map(r => r.maxFloor);
    const lo = Math.min(...floors);
    const hi = Math.max(...floors);
    spreads.push({ seed: Number(seed), n: rows.length, lo, hi, spread: hi - lo, wins: rows.filter(r => r.win).length });
    if (rows.every(r => r.outcome === 'dead' && r.deathFloor != null && r.deathFloor < EARLY_BRICK_BEFORE)) {
      allEarly.push(Number(seed));
    }
    if (rows.filter(r => r.win).length >= Math.max(3, rows.length - 1)) {
      allWin.push(Number(seed));
    }
  }
  spreads.sort((a, b) => b.spread - a.spread);
  return {
    pairedSeeds: multi.length,
    allClassEarlyBrick: allEarly,
    nearlyAllWin: allWin,
    widest: spreads.slice(0, 8),
  };
}

function noteTotals(climbs) {
  const sum = emptyNotes();
  for (const c of climbs) {
    for (const k of Object.keys(sum)) sum[k] += c.notes?.[k] || 0;
  }
  const n = climbs.length || 1;
  return { ...sum, perRun: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, v / n])) };
}

function earlyBrickDetail(climbs) {
  const bricks = climbs.filter(c => c.outcome === 'dead' && c.deathFloor != null && c.deathFloor < EARLY_BRICK_BEFORE);
  const byClass = {};
  const byCause = {};
  const byEnemy = {};
  const byEvent = {};
  const byBiome = {};
  let policyTainted = 0;
  for (const c of bricks) {
    byClass[c.classId] = (byClass[c.classId] || 0) + 1;
    byCause[c.deathCause || 'unknown'] = (byCause[c.deathCause || 'unknown'] || 0) + 1;
    if (c.biomeAtDeath) byBiome[c.biomeAtDeath] = (byBiome[c.biomeAtDeath] || 0) + 1;
    if (c.deathEventId) byEvent[c.deathEventId] = (byEvent[c.deathEventId] || 0) + 1;
    for (const e of (c.encounters || []).filter(x => x.died && x.floor === c.deathFloor)) {
      byEnemy[e.id] = (byEnemy[e.id] || 0) + 1;
    }
    if ((c.notes?.ignoredRecoveryCard || 0) + (c.notes?.refusedShopHeal || 0) + (c.notes?.foughtWhileCritical || 0) > 0) {
      policyTainted += 1;
    }
  }
  return {
    n: bricks.length,
    rate: pct(bricks.length, climbs.length),
    byClass,
    byCause,
    byEnemy,
    byEvent,
    byBiome,
    policyTainted,
    policyTaintedRate: pct(policyTainted, bricks.length),
    avgGold: mean(bricks.map(c => c.finalGold)),
    avgHpPct: mean(bricks.map(c => c.finalMaxHp ? c.finalHp / c.finalMaxHp : 0)),
  };
}

export function buildDifficultyReport(climbs, meta = {}) {
  const overall = classSlice(climbs);
  const byClass = {};
  for (const cid of BASE_CLASSES) {
    const rows = climbs.filter(c => c.classId === cid);
    if (rows.length) byClass[cid] = classSlice(rows);
  }
  const deathDist = DEATH_BANDS.map(b => ({
    id: b.id,
    label: b.label,
    n: climbs.filter(b.test).length,
    rate: pct(climbs.filter(b.test).length, climbs.length),
  }));
  const resources = {};
  for (const f of [10, 20, 30, 40, 50]) resources[f] = markMeans(climbs, f);
  const curve = mortalityCurve(climbs);
  const bosses = bossTable(climbs);
  const encounters = encounterTable(climbs);
  const lethalEncounters = [...encounters].filter(e => e.seen >= 8).sort((a, b) => b.deathRate - a.deathRate);
  const notes = noteTotals(climbs);
  const winning = climbs.filter(c => c.win);
  return {
    meta: {
      name: meta.name || 'difficulty',
      seed: meta.seed,
      runs: climbs.length,
      policy: meta.policy || 'baseline',
      nSeeds: meta.nSeeds ?? null,
      architecture: 'simulateClimbV2 + headless combat_core',
      generatedAt: meta.generatedAt || new Date().toISOString(),
      honesty: [
        'LIVE climb v2: dealLiveFloorCards, live events, live shop, live throne.',
        'Combat is faithful headless combat_core, not tools/combat_sim.js.',
        'Policy path RNG is seed^floor^0xA11CE and does not consume climb rngState.',
        'Trace/measurement code does not call runRng or rng.advance.',
        'Scripted policy is excluded from win-rate estimates.',
        'Baseline shop never buys equipment — compare --policy reasonable before treating gold/HP collapse as balance.',
        TDC_CLEAR_RATE_DISCLAIMER,
      ],
    },
    overall,
    deathDist,
    byClass,
    curve,
    bosses,
    encounters: encounters.slice(0, 24),
    lethalEncounters: lethalEncounters.slice(0, 12),
    deathCauses: deathCauses(climbs),
    earlyBrick: earlyBrickDetail(climbs),
    resources,
    seedVariance: seedVariance(climbs),
    notes,
    late: {
      enter40: resources[40],
      enter50: resources[50],
      winGiven40: overall.winGiven40,
      winGiven50: overall.winGiven50,
      winGivenThrone: overall.winGivenThrone,
      medianWinningHp: median(winning.map(c => c.finalHp)),
      medianWinningHpPct: median(winning.map(c => c.finalMaxHp ? c.finalHp / c.finalMaxHp : null)),
    },
    scorecard: {
      earlyBrickRate: overall.earlyBrickRate,
      reach20: overall.reach[20],
      reach30: overall.reach[30],
      reach40: overall.reach[40],
      reach50: overall.reach[50],
      reachThrone: overall.reach.throne,
      winRate: overall.winRate,
      medianDeathFloor: overall.medianDeathFloor,
      medianFloor: overall.medianFloor,
      medianWinningHp: median(winning.map(c => c.finalHp)),
    },
  };
}

function pctText(x) {
  if (x == null || !Number.isFinite(x)) return '  —  ';
  return `${(x * 100).toFixed(1)}%`;
}

function numText(x, digits = 1) {
  if (x == null || !Number.isFinite(x)) return '—';
  return Number(x).toFixed(digits);
}

function className(id) {
  return CLASSES[id]?.name || id;
}

function pad(s, n) {
  return String(s).padEnd(n);
}

export function formatDifficultyReport(rep) {
  const o = rep.overall;
  const lines = [
    `DungeonTogether difficulty — ${rep.meta.name}  seed ${rep.meta.seed}  runs ${rep.meta.runs}  policy ${rep.meta.policy}`,
    `architecture: ${rep.meta.architecture}   paired seeds ${rep.meta.nSeeds ?? '—'}`,
    ...rep.meta.honesty.map(h => `  note: ${h}`),
    '',
    'RUN HEALTH',
    `  Early brick (<F${EARLY_BRICK_BEFORE}):  ${pctText(rep.scorecard.earlyBrickRate)}`,
    `  Reach F20:                ${pctText(rep.scorecard.reach20)}`,
    `  Reach F30:                ${pctText(rep.scorecard.reach30)}`,
    `  Reach F40:                ${pctText(rep.scorecard.reach40)}`,
    `  Reach F50:                ${pctText(rep.scorecard.reach50)}`,
    `  Reach throne:             ${pctText(rep.scorecard.reachThrone)}`,
    `  Win rate:                 ${pctText(rep.scorecard.winRate)}  (${o.wins}/${o.n})`,
    `  Median floor reached:     ${numText(rep.scorecard.medianFloor, 0)}`,
    `  Median death floor:       ${numText(rep.scorecard.medianDeathFloor, 0)}`,
    `  Median winning HP:        ${numText(rep.scorecard.medianWinningHp, 0)}`,
    `  Win | F40:                ${pctText(o.winGiven40)}`,
    `  Win | F50:                ${pctText(o.winGiven50)}`,
    `  Win | throne:             ${pctText(o.winGivenThrone)}`,
    '',
    'FLOOR REACH / DEATH DISTRIBUTION',
    ...rep.deathDist.map(d => `  ${pad(d.label + ':', 16)} ${pctText(d.rate)}  (${d.n})`),
    '',
    'PER CLASS',
    `  ${pad('Class', 12)} ${pad('n', 5)} ${pad('Win', 8)} ${pad('MedF', 6)} ${pad('Brick', 8)} ${pad('F20', 8)} ${pad('F40', 8)} ${pad('F50', 8)} ${pad('Throne', 8)}`,
  ];
  for (const cid of Object.keys(rep.byClass)) {
    const r = rep.byClass[cid];
    lines.push(
      `  ${pad(className(cid), 12)} ${pad(r.n, 5)} ${pad(pctText(r.winRate), 8)} ${pad(numText(r.medianFloor, 0), 6)} ${pad(pctText(r.earlyBrickRate), 8)} ${pad(pctText(r.reach[20]), 8)} ${pad(pctText(r.reach[40]), 8)} ${pad(pctText(r.reach[50]), 8)} ${pad(pctText(r.reach.throne), 8)}`,
    );
  }

  lines.push('', 'MORTALITY CURVE (died / entered that floor)');
  const notable = rep.curve.byFloor.filter(f => f.died > 0 || f.floor % 5 === 0);
  for (const f of notable) {
    lines.push(`  F${String(f.floor).padStart(2)}  entered ${String(f.entered).padStart(4)}  died ${String(f.died).padStart(3)}  ${pctText(f.rate)}`);
  }
  lines.push(`  Largest spike: F${rep.curve.spike.floor}  ${pctText(rep.curve.spike.rate)}  (${rep.curve.spike.died}/${rep.curve.spike.entered} entered)`);
  lines.push('  Bands (died in band / reached band start):');
  for (const b of rep.curve.bands) {
    lines.push(`    F${b.lo}–${b.hi}: ${pctText(b.rate)}  (${b.died}/${b.entered})`);
  }

  lines.push('', 'DEATH CAUSES');
  for (const d of rep.deathCauses) {
    lines.push(`  ${pad(d.cause, 22)} ${pctText(d.rate)}  (${d.n})`);
  }

  lines.push('', 'BOSSES');
  lines.push(`  ${pad('Boss', 28)} ${pad('Fl', 4)} ${pad('Alt', 4)} ${pad('n', 5)} ${pad('Fight', 6)} ${pad('Win', 6)} ${pad('Lose', 6)} ${pad('Survive', 8)} ${pad('HP in', 8)} ${pad('HP out', 8)}`);
  for (const b of rep.bosses) {
    lines.push(
      `  ${pad(b.id, 28)} ${pad(b.floor, 4)} ${pad(b.isAlt ? 'alt' : '', 4)} ${pad(b.reached, 5)} ${pad(b.fights, 6)} ${pad(b.wins, 6)} ${pad(b.losses, 6)} ${pad(pctText(b.survival), 8)} ${pad(pctText(b.avgHpEnter), 8)} ${pad(pctText(b.avgHpLeaveWin), 8)}`,
    );
  }

  lines.push('', 'MOST LETHAL ENCOUNTERS (death rate when present, min 8 seen)');
  for (const e of rep.lethalEncounters.slice(0, 8)) {
    lines.push(`  ${pad(e.id, 22)} seen ${String(e.seen).padStart(4)}  deaths ${String(e.deaths).padStart(3)}  ${pctText(e.deathRate)}${e.elite ? '  elite' : ''}${e.boss ? '  boss' : ''}`);
  }

  const eb = rep.earlyBrick;
  lines.push('', `EARLY BRICKS (death before F${EARLY_BRICK_BEFORE})`);
  lines.push(`  count ${eb.n}  rate ${pctText(eb.rate)}  policy-tainted ${pctText(eb.policyTaintedRate)}`);
  lines.push(`  causes ${JSON.stringify(eb.byCause)}`);
  lines.push(`  classes ${JSON.stringify(eb.byClass)}`);
  lines.push(`  enemies ${JSON.stringify(eb.byEnemy)}`);
  lines.push(`  events ${JSON.stringify(eb.byEvent)}`);

  lines.push('', 'LATE-GAME ARRIVAL');
  for (const f of [10, 20, 30, 40, 50]) {
    const r = rep.resources[f];
    lines.push(
      `  F${f} n=${r.n}  HP ${numText(r.hp, 0)}/${numText(r.maxHp, 0)} (${pctText(r.hpPct)})  gold ${numText(r.gold, 0)}  heals ${numText(r.healConsumables, 1)}  relics ${numText(r.relics, 1)}  skills ${numText(r.skills, 1)}`,
    );
  }

  lines.push('', 'POLICY SIGNALS (not climb RNG)');
  const p = rep.notes.perRun;
  lines.push(`  refused shop heal / run     ${numText(p.refusedShopHeal, 2)}`);
  lines.push(`  refused affordable gear     ${numText(p.refusedAffordableGear, 2)}`);
  lines.push(`  bought gear / run           ${numText(p.boughtGear, 2)}`);
  lines.push(`  shop heals / run            ${numText(p.shopHeals, 2)}`);
  lines.push(`  ignored recovery card       ${numText(p.ignoredRecoveryCard, 2)}`);
  lines.push(`  fought while critical       ${numText(p.foughtWhileCritical, 2)}`);

  const sv = rep.seedVariance;
  lines.push('', 'SEED VARIANCE (same seed, multiple classes)');
  lines.push(`  paired seeds ${sv.pairedSeeds}  all-class early bricks ${sv.allClassEarlyBrick.length}  nearly-all-win ${sv.nearlyAllWin.length}`);
  for (const w of sv.widest.slice(0, 5)) {
    lines.push(`  seed ${w.seed}  floors ${w.lo}–${w.hi} (spread ${w.spread})  wins ${w.wins}/${w.n}`);
  }

  const classRates = Object.entries(rep.byClass).map(([id, r]) => ({ id, win: r.winRate }));
  classRates.sort((a, b) => a.win - b.win);
  if (classRates.length) {
    lines.push('', `  Worst class: ${className(classRates[0].id)} ${pctText(classRates[0].win)}`);
    lines.push(`  Best class:  ${className(classRates[classRates.length - 1].id)} ${pctText(classRates[classRates.length - 1].win)}`);
  }
  const mostLethal = rep.lethalEncounters[0];
  const mostLethalBoss = [...rep.bosses].filter(b => b.fights >= 3).sort((a, b) => (1 - b.survival) - (1 - a.survival))[0];
  lines.push(`  Largest mortality spike: F${rep.curve.spike.floor} (${pctText(rep.curve.spike.rate)})`);
  lines.push(`  Most lethal encounter:   ${mostLethal ? `${mostLethal.id} ${pctText(mostLethal.deathRate)} when seen` : '—'}`);
  lines.push(`  Most lethal boss:        ${mostLethalBoss ? `${mostLethalBoss.id} survive ${pctText(mostLethalBoss.survival)}` : '—'}`);
  lines.push('');
  lines.push(`  Design-intent reference only (NOT this sim): TDC.clearRate brickBy10 ${JSON.stringify(TDC.clearRate.brickBy10)} reach30 ${JSON.stringify(TDC.clearRate.reach30)} clear51 ${JSON.stringify(TDC.clearRate.clear51)}`);
  return lines.join('\n');
}

export function formatCompareDifficulty(a, b) {
  const keys = [
    ['winRate', a.overall.winRate, b.overall.winRate],
    ['earlyBrick', a.overall.earlyBrickRate, b.overall.earlyBrickRate],
    ['reach20', a.overall.reach[20], b.overall.reach[20]],
    ['reach40', a.overall.reach[40], b.overall.reach[40]],
    ['reach50', a.overall.reach[50], b.overall.reach[50]],
    ['throne', a.overall.reach.throne, b.overall.reach.throne],
    ['medianFloor', a.overall.medianFloor, b.overall.medianFloor],
    ['boughtGear/run', a.notes.perRun.boughtGear, b.notes.perRun.boughtGear],
    ['refusedHeal/run', a.notes.perRun.refusedShopHeal, b.notes.perRun.refusedShopHeal],
  ];
  const lines = [
    `Compare ${a.meta.policy} → ${b.meta.policy}  (seed ${a.meta.seed}, ${a.meta.runs} vs ${b.meta.runs} runs)`,
    '  If reasonable lifts survival a lot, treat baseline deaths as policy-limited until proven otherwise.',
  ];
  for (const [k, av, bv] of keys) {
    const d = (av == null || bv == null) ? null : bv - av;
    const dt = d == null ? '—' : `${d >= 0 ? '+' : ''}${d.toFixed(3)}`;
    lines.push(`  ${pad(k, 20)} ${numText(av, 3)} → ${numText(bv, 3)}  (${dt})`);
  }
  return lines.join('\n');
}

export function stripDifficultyTimestamps(rep) {
  const copy = JSON.parse(JSON.stringify(rep));
  if (copy.meta) delete copy.meta.generatedAt;
  return copy;
}

function parseArgs(argv) {
  const raw = argv.slice(2);
  const flags = {};
  const positional = [];
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const nxt = raw[i + 1];
      if (!nxt || nxt.startsWith('--')) flags[key] = true;
      else { flags[key] = nxt; i += 1; }
    } else positional.push(a);
  }
  return { flags, positional };
}

async function main() {
  const { flags } = parseArgs(process.argv);
  const seed = Number(flags.seed || 20260823);
  const runs = Number(flags.runs || flags.trials || 1000);
  const policy = String(flags.policy || 'baseline');
  const classId = flags.class || null;
  const compare = !!flags.compare;
  const a = await runDifficultySuite({ seed, runs, policy, classId });
  console.log(formatDifficultyReport(a));
  let b = null;
  if (compare) {
    const other = policy === 'reasonable' ? 'baseline' : 'reasonable';
    b = await runDifficultySuite({ seed, runs, policy: other, classId });
    console.log('\n' + formatDifficultyReport(b));
    console.log('\n' + formatCompareDifficulty(a, b));
  }
  if (flags.out) {
    mkdirSync(dirname(flags.out), { recursive: true });
    writeFileSync(flags.out, JSON.stringify({ a, b }, null, 2));
    console.log(`\nwrote ${flags.out}`);
  }
}

const isMain = process.argv[1] && /run_difficulty\.js/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain) main();
