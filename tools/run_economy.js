#!/usr/bin/env node
// Fixed-seed climb_v2 economy reporter.
//   node tools/run_economy.js --seed=20260825 --n=24 --classes=warrior,mage,priest

import { CLASSES } from '../js/data/classes.js';
import { playableClassIds } from '../js/state.js';
import { LAST_FLOOR } from '../js/data/floorcards.js';
import { percentile } from './combat_sim.js';
import { simulateClimbV2, makeV2Run, resourceSnap } from './run_climb_v2.js';
import { baselinePolicy } from './policies/baseline.js';
import { classHasStartHeal, healConsumableCount } from '../js/economy.js';
import { catalogEconomy, summarizeCatalog } from './economy_catalog.js';

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

const GATES = [10, 20, 30, 40, 50];

function dist(arr) {
  const nums = arr.filter(n => n != null && !Number.isNaN(n)).slice().sort((a, b) => a - b);
  if (!nums.length) return { n: 0 };
  return {
    n: nums.length,
    p10: percentile(nums, 0.10),
    p25: percentile(nums, 0.25),
    p50: percentile(nums, 0.50),
    p75: percentile(nums, 0.75),
    p90: percentile(nums, 0.90),
    mean: nums.reduce((a, b) => a + b, 0) / nums.length,
    min: nums[0],
    max: nums[nums.length - 1],
  };
}

function gateSnap(result, floor) {
  const after = result.checkpoints?.find(c => c.label === `after_${floor}`);
  if (after) return after;
  const rec = result.trace?.find(r => r.floor === floor);
  return rec?.leave || null;
}

function climbEconomy(result, classId) {
  const start = result.checkpoints?.find(c => c.label === 'start');
  const end = result.checkpoint || {};
  const healEnd = healConsumableCount({ consumables: end.consumables || [] });
  const unused = result.outcome === 'dead' || result.outcome === 'cleared' || result.deathFloor
    ? healEnd
    : healEnd;
  const gates = {};
  for (const f of GATES) {
    const g = gateSnap(result, f);
    if (!g) continue;
    gates[f] = {
      gold: g.gold,
      goldEarned: g.goldEarned,
      goldSpent: g.goldSpent,
      heal: g.healConsumables ?? healConsumableCount({ consumables: g.consumables || [] }),
      hpPct: g.maxHp ? g.hp / g.maxHp : null,
    };
  }
  let minHeal = start ? healConsumableCount({ consumables: start.consumables || [] }) : 1;
  let zeroStreak = 0;
  let maxZeroStreak = 0;
  let potionsGained = 0;
  let lastHeal = minHeal;
  for (const rec of result.trace || []) {
    const h = rec.leave?.healConsumables ?? 0;
    if (h > lastHeal) potionsGained += h - lastHeal;
    lastHeal = h;
    if (h <= 0) {
      zeroStreak++;
      maxZeroStreak = Math.max(maxZeroStreak, zeroStreak);
    } else zeroStreak = 0;
    minHeal = Math.min(minHeal, h);
  }
  return {
    classId,
    outcome: result.outcome,
    deathFloor: result.deathFloor || result.checkpoint?.floor,
    maxFloor: result.checkpoint?.floor || 0,
    goldHeld: end.gold || 0,
    goldEarned: end.goldEarned || 0,
    goldSpent: end.goldSpent || 0,
    healEnd,
    unusedEnd: unused,
    minHeal,
    maxZeroStreak,
    potionsGained,
    gates,
    startHeal: classHasStartHeal(classId),
  };
}

export async function runEconomyBatch({
  seed = 20260825,
  n = 20,
  classes = null,
  maxFloors = LAST_FLOOR,
} = {}) {
  const ids = classes || playableClassIds();
  const policy = baselinePolicy();
  const rows = [];
  for (const classId of ids) {
    for (let i = 0; i < n; i++) {
      const run = makeV2Run({ classId, seed: seed + i * 17 + classId.length * 101 });
      const result = await simulateClimbV2(run, policy, { maxFloors });
      rows.push(climbEconomy(result, classId));
    }
  }
  return rows;
}

function byClass(rows) {
  const out = {};
  for (const r of rows) {
    (out[r.classId] ||= []).push(r);
  }
  const report = {};
  for (const [id, list] of Object.entries(out)) {
    report[id] = {
      n: list.length,
      goldHeld: dist(list.map(r => r.goldHeld)),
      goldEarned: dist(list.map(r => r.goldEarned)),
      goldSpent: dist(list.map(r => r.goldSpent)),
      healEnd: dist(list.map(r => r.healEnd)),
      minHeal: dist(list.map(r => r.minHeal)),
      unusedEnd: dist(list.map(r => r.unusedEnd)),
      zeroPotionRuns: list.filter(r => r.minHeal === 0).length / list.length,
      excessPotionRuns: list.filter(r => r.healEnd >= 6).length / list.length,
      startHeal: classHasStartHeal(id),
    };
  }
  return report;
}

function gateReport(rows) {
  const out = {};
  for (const f of GATES) {
    const gold = [];
    const earned = [];
    const spent = [];
    const heal = [];
    for (const r of rows) {
      const g = r.gates[f];
      if (!g) continue;
      gold.push(g.gold);
      if (g.goldEarned != null) earned.push(g.goldEarned);
      if (g.goldSpent != null) spent.push(g.goldSpent);
      heal.push(g.heal);
    }
    out[f] = {
      n: gold.length,
      goldHeld: dist(gold),
      goldEarned: dist(earned),
      goldSpent: dist(spent),
      healConsumables: dist(heal),
      zeroHealShare: heal.length ? heal.filter(h => h === 0).length / heal.length : 0,
      excessHealShare: heal.length ? heal.filter(h => h >= 6).length / heal.length : 0,
    };
  }
  return out;
}

export async function buildEconomyReport(opts = {}) {
  const cat = catalogEconomy();
  const rows = await runEconomyBatch(opts);
  return {
    meta: {
      seed: opts.seed ?? 20260825,
      nPerClass: opts.n ?? 20,
      classes: opts.classes || playableClassIds(),
      generatedAt: new Date().toISOString(),
    },
    catalog: summarizeCatalog(cat),
    overall: {
      goldHeld: dist(rows.map(r => r.goldHeld)),
      goldEarned: dist(rows.map(r => r.goldEarned)),
      goldSpent: dist(rows.map(r => r.goldSpent)),
      healEnd: dist(rows.map(r => r.healEnd)),
      unusedEnd: dist(rows.map(r => r.unusedEnd)),
      minHeal: dist(rows.map(r => r.minHeal)),
      zeroPotionRuns: rows.filter(r => r.minHeal === 0).length,
      excessPotionRuns: rows.filter(r => r.healEnd >= 6).length,
      n: rows.length,
    },
    gates: gateReport(rows),
    byClass: byClass(rows),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const seed = Number(args.find(a => a.startsWith('--seed='))?.split('=')[1]) || 20260825;
  const n = Number(args.find(a => a.startsWith('--n='))?.split('=')[1]) || 12;
  const cls = args.find(a => a.startsWith('--classes='))?.split('=')[1];
  const classes = cls ? cls.split(',').filter(id => CLASSES[id]) : playableClassIds().slice(0, 6);
  const report = await buildEconomyReport({ seed, n, classes });
  console.log(JSON.stringify(report, null, 2));
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/run_economy.js');
if (isMain) main();
