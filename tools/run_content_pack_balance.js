#!/usr/bin/env node
// Gate 7 content-pack balance measurement. Tooling only — does not retune content.
//
//   node tools/run_content_pack_balance.js
//   node tools/run_content_pack_balance.js --workers=6
//   node tools/run_content_pack_balance.js --phase=catalog
//   node tools/run_content_pack_balance.js --from-raw
//   node tools/run_content_pack_balance.js --quick

import { Worker } from 'node:worker_threads';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import readline from 'node:readline';
import { mkdirSync, appendFileSync, writeFileSync, existsSync, unlinkSync, createReadStream, readFileSync } from 'node:fs';
import {
  CANONICAL_CLASSES, CANONICAL_BLOODLINES, SEED_BANK, STARTING_COMMIT, LAST_FLOOR,
  climbSeed, seedsFor, enumerateClimbJobs, runMeasuredClimb,
  catalogSnapshot, workingTreeNote, armPack, summarizeRuns, groupBy, mergeCounts, mean,
} from './content_pack_balance_lib.js';
import { GATE } from '../js/content_pack/flags.js';
import { runMechanicBattery } from './content_pack_balance_mechanics.js';
import { runPartyMeasurements } from './content_pack_balance_party.js';
import { detectAnomalies, writeOutputs } from './content_pack_balance_report.js';
import { buildExtendedTables } from './content_pack_balance_tables.js';

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const reportDir = join(root, 'reports');
const workerPath = join(here, 'content_pack_balance_worker.js');

function arg(name, fallback = null) {
  const hit = process.argv.find(a => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  return hit.slice(name.length + 3);
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function runWorker(packOn, jobs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./content_pack_balance_worker.js', import.meta.url), {
      workerData: { packOn, jobs },
    });
    const rows = [];
    worker.on('message', (msg) => {
      if (msg.ok) rows.push(msg.row);
      else {
        console.error('  worker job failed', msg.job, msg.error);
        rows.push({ error: msg.error, ...msg.job, outcome: 'error', maxFloor: 0 });
      }
    });
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`worker exited ${code}`));
      else resolve(rows);
    });
  });
}

async function runJobsInProcess(packOn, jobs) {
  armPack(packOn, GATE.MULTIPLAYER);
  const local = [];
  for (const job of jobs) local.push(await runMeasuredClimb(job));
  return local;
}

async function runShard(packOn, shard) {
  if (shard.length <= 1) return runJobsInProcess(packOn, shard);
  try {
    return await runWorker(packOn, shard);
  } catch (err) {
    console.error('  worker shard failed, retrying in-process:', err?.message || err);
    return runJobsInProcess(packOn, shard);
  }
}

async function runJobs(jobs, workers, label) {
  if (!jobs.length) return [];
  const byPack = groupBy(jobs, j => String(!!j.packOn));
  const out = [];
  let done = 0;
  const total = jobs.length;
  const conc = Math.max(1, workers);
  console.log(`— ${label}: ${total} climbs, ${conc} workers —`);
  for (const [packKey, packJobs] of Object.entries(byPack)) {
    const packOn = packKey === 'true';
    const shardSize = Math.max(24, Math.ceil(packJobs.length / Math.max(conc * 3, 1)));
    const shards = chunk(packJobs, shardSize);
    for (let i = 0; i < shards.length; i += conc) {
      const batch = shards.slice(i, i + conc);
      const parts = await Promise.all(batch.map((shard, j) => runShard(packOn, shard).then((rows) => {
        done += shard.length;
        console.log(`  ${label} pack=${packOn ? 'on' : 'off'} shard ${i + j + 1}/${shards.length} (${done}/${total})`);
        return rows;
      })));
      for (const p of parts) out.push(...p);
    }
  }
  return out;
}

function flagCombos(climbs) {
  const off = groupBy(climbs.filter(r => !r.packOn && r.policy === 'baseline' && !r.error), r => `${r.classId}/${r.raceId}`);
  const on = groupBy(climbs.filter(r => r.packOn && r.policy === 'baseline' && !r.error), r => `${r.classId}/${r.raceId}`);
  const flagged = [];
  const means = [];
  for (const key of Object.keys(on)) {
    const sOn = summarizeRuns(on[key]);
    const sOff = summarizeRuns(off[key] || []);
    means.push({ key, mean: sOn.floor.avg.mean, stdev: sOn.floor.avg.stdev, n: sOn.n });
    const d = (sOn.floor.avg.mean ?? 0) - (sOff.floor.avg.mean ?? 0);
    if (Math.abs(d) >= 3.5) flagged.push({ key, reason: `pack delta ${d.toFixed(2)}` });
    if ((sOn.floor.avg.stdev || 0) >= 8) flagged.push({ key, reason: `stdev ${sOn.floor.avg.stdev.toFixed(2)}` });
    if ((sOn.f10.arrive.rate || 0) <= 0.08 && sOn.n >= 16) flagged.push({ key, reason: `F10 arrival ${sOn.f10.arrive.rate}` });
  }
  if (means.length > 4) {
    const m = mean(means.map(x => x.mean));
    const s = Math.sqrt(means.reduce((a, x) => a + (x.mean - m) ** 2, 0) / (means.length - 1));
    for (const row of means) {
      const z = s ? (row.mean - m) / s : 0;
      if (Math.abs(z) >= 1.8) flagged.push({ key: row.key, reason: `z=${z.toFixed(2)}` });
    }
  }
  const uniq = [];
  const seen = new Set();
  for (const f of flagged) {
    if (seen.has(f.key)) continue;
    seen.add(f.key);
    const [classId, raceId] = f.key.split('/');
    uniq.push({ classId, raceId, key: f.key, reason: flagged.filter(x => x.key === f.key).map(x => x.reason).join('; ') });
  }
  return uniq;
}

function classBloodlineTables(climbs, policy = 'baseline') {
  const byClass = {};
  for (const id of CANONICAL_CLASSES) {
    byClass[id] = {
      off: summarizeRuns(climbs.filter(r => !r.error && r.policy === policy && !r.packOn && r.classId === id)),
      on: summarizeRuns(climbs.filter(r => !r.error && r.policy === policy && r.packOn && r.classId === id)),
    };
  }
  const byBloodline = {};
  for (const id of CANONICAL_BLOODLINES) {
    byBloodline[id] = {
      off: summarizeRuns(climbs.filter(r => !r.error && r.policy === policy && !r.packOn && r.raceId === id)),
      on: summarizeRuns(climbs.filter(r => !r.error && r.policy === policy && r.packOn && r.raceId === id)),
    };
  }
  const byCombo = {};
  for (const classId of CANONICAL_CLASSES) {
    for (const raceId of CANONICAL_BLOODLINES) {
      const key = `${classId}/${raceId}`;
      byCombo[key] = {
        off: summarizeRuns(climbs.filter(r => !r.error && r.policy === policy && !r.packOn && r.classId === classId && r.raceId === raceId)),
        on: summarizeRuns(climbs.filter(r => !r.error && r.policy === policy && r.packOn && r.classId === classId && r.raceId === raceId)),
      };
      if (!byCombo[key].off.n && !byCombo[key].on.n) delete byCombo[key];
    }
  }
  return { byClass, byBloodline, byCombo };
}

function meanOps(rows) {
  const merged = mergeCounts(rows.map(r => r.effectOps || {}));
  const n = rows.length || 1;
  return Object.fromEntries(Object.entries(merged).map(([k, v]) => [k, v / n]));
}

async function loadRaw(path) {
  const rows = [];
  const rl = readline.createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    rows.push(JSON.parse(line));
  }
  return rows;
}

function buildSeedBankDump(tree) {
  return {
    ...SEED_BANK,
    startingCommit: STARTING_COMMIT,
    workingTree: tree,
    classes: CANONICAL_CLASSES,
    bloodlines: CANONICAL_BLOODLINES,
    lastFloor: LAST_FLOOR,
    initial: CANONICAL_CLASSES.map(classId => ({
      classId,
      bloodlines: CANONICAL_BLOODLINES.map(raceId => ({
        raceId,
        seeds: seedsFor(classId, raceId, SEED_BANK.initialN),
      })),
    })),
    expansionIndices: Array.from({ length: SEED_BANK.expansionN }, (_, i) => i),
    identicalAcrossPackStates: true,
  };
}

function assembleReport({
  tree, started, catalog, mechanics, party, climbs,
  initialN, expandN, workers, quick, baselineTests,
}) {
  const baseline = climbs.filter(r => r.policy === 'baseline' && !r.error);
  const tables = classBloodlineTables(baseline);
  const bossTables = classBloodlineTables(
    climbs.filter(r => r.policy === 'boss-aware' && !r.error),
    'boss-aware',
  );
  const packOffBaseline = summarizeRuns(baseline.filter(r => !r.packOn));
  const packOnBaseline = summarizeRuns(baseline.filter(r => r.packOn));
  const bossOff = summarizeRuns(climbs.filter(r => r.policy === 'boss-aware' && !r.packOn && !r.error));
  const bossOn = summarizeRuns(climbs.filter(r => r.policy === 'boss-aware' && r.packOn && !r.error));
  const extended = buildExtendedTables(climbs);

  const report = {
    meta: {
      startingCommit: STARTING_COMMIT,
      workingTree: tree,
      measuredAt: started,
      finishedAt: new Date().toISOString(),
      seedBank: SEED_BANK,
      lastFloor: LAST_FLOOR,
      initialN,
      expandN,
      workers,
      quick,
      packOnArming: 'setPackEnabled(true) + setPackGate(GATE.MULTIPLAYER)',
      packOffArming: 'setPackEnabled(false)',
      authoritative: [
        'js/combat_core.js', 'tools/run_climb_v2.js', 'live floor cards',
        'shared item/skill/event/shop/boss/outcome modules', 'deterministic RNG + climb snapshots',
      ],
      notUsedAsEvidence: ['tools/combat_sim.js', 'tools/run_sim.js', 'TDC.clearRate'],
      goldensRegenerated: false,
    },
    catalog: catalog || 'omitted this phase',
    baselineTests: baselineTests || { pass: null, fail: null, goldensPassed: null, note: 'Recorded after the post-tooling tools/test.js rerun.' },
    mechanics,
    party,
    summaries: {
      packOffBaseline,
      packOnBaseline,
      bossAwareOff: bossOff,
      bossAwareOn: bossOn,
      ...tables,
      bossAwareByClass: bossTables.byClass,
      bossAwareByBloodline: bossTables.byBloodline,
      bossAwareByCombo: bossTables.byCombo,
      effectOpsOn: meanOps(baseline.filter(r => r.packOn)),
      effectOpsOff: meanOps(baseline.filter(r => !r.packOn)),
      flaggedCombos: flagCombos(climbs),
    },
    extended,
    anomalies: [],
    followUp: [
      'Do not buff, nerf, or reclassify content from this report. Treat it as a baseline for later rarity/acquisition changes against the same seed bank.',
      'If F10 arrival stays low pack-on and pack-off, keep treating F10 as a vanilla gate — do not hide it with pack power.',
      'Expand any remaining high-variance combos to 96+ if this run used --quick or flagged fewer than the real outliers.',
      'Add a real multiplayer climb harness before claiming 2/3/4-player climb balance.',
      'If Unique/WRLD or set completion is flagged, change acquisition later in a dedicated task, then re-run this seed bank.',
      'If a mechanic test failed, inspect mutex/cap wiring in js/content_pack/engine.js before any catalog edits.',
      'LIMITS.reflectionsPerAction is currently unused by the engine (interceptAoe uses a combat-once counter). Do not silently wire it in a measurement task.',
      'The working-tree content-path UNRESOLVED gate is separate from this measurement; do not retune F10 or classes to green it.',
    ],
    climbCount: climbs.length,
    errors: climbs.filter(r => r.error).length,
  };
  report.anomalies = detectAnomalies({
    climbs, mechanics, party, catalog, baselineTests: report.baselineTests,
  });
  return report;
}

async function main() {
  const quick = flag('quick');
  const phase = arg('phase', 'all');
  const workers = Math.max(1, Math.min(Number(arg('workers', 4)) || 4, 6));
  const initialN = quick ? 2 : Number(arg('initial', SEED_BANK.initialN)) || SEED_BANK.initialN;
  const expandN = quick ? 4 : Number(arg('expand', SEED_BANK.expansionN)) || SEED_BANK.expansionN;
  const classes = quick ? ['warrior', 'mage'] : CANONICAL_CLASSES;
  const races = quick ? ['human', 'orc'] : CANONICAL_BLOODLINES;

  mkdirSync(reportDir, { recursive: true });
  const started = new Date().toISOString();
  const tree = workingTreeNote();
  console.log(`starting commit (task): ${STARTING_COMMIT}`);
  console.log(`working tree HEAD: ${tree.sha}`);
  console.log(`dirty: ${tree.dirty.length} paths`);

  const fromRaw = flag('from-raw');
  const catalog = phase === 'climbs' && !fromRaw ? null : catalogSnapshot();
  if (catalog) {
    console.log(`catalog: ${catalog.counts.items} items, ${catalog.counts.skills} skills, ${catalog.counts.events} events, gate ${catalog.flags.gate}`);
  }

  let mechanics = null;
  if (phase === 'all' || phase === 'mechanics') {
    console.log('— focused mechanic battery —');
    mechanics = await runMechanicBattery();
    console.log(`  mechanics ${mechanics.passed} passed, ${mechanics.failed} failed`);
  }

  let party = null;
  if (phase === 'all' || phase === 'party') {
    console.log('— party scaling + focused 2/3/4p —');
    party = await runPartyMeasurements();
    console.log(`  plans ${party.encounterPlans.map(p => `${p.partySize}p:${p.bodies}`).join(' ')}`);
  }

  let climbs = [];
  if (fromRaw) {
    const rawPath = join(reportDir, 'content_pack_balance_raw.ndjson');
    console.log(`— rebuild from ${rawPath} —`);
    climbs = await loadRaw(rawPath);
    console.log(`  loaded ${climbs.length} raw climbs`);
  } else if (phase === 'all' || phase === 'climbs') {
    const initialJobs = enumerateClimbJobs({
      packStates: [false, true],
      policyName: 'baseline',
      n: initialN,
      pass: 'initial',
      classes,
      races,
    });
    climbs = climbs.concat(await runJobs(initialJobs, workers, 'initial baseline'));
    writeFileSync(join(reportDir, 'content_pack_balance_raw.partial.ndjson'), climbs.map(r => JSON.stringify(r)).join('\n') + '\n');

    const flagged = flagCombos(climbs);
    console.log(`  flagged combos for expansion: ${flagged.length}`);
    flagged.forEach(f => console.log(`    ${f.key} — ${f.reason}`));

    if (flagged.length) {
      const extra = [];
      for (const packOn of [false, true]) {
        for (const f of flagged) {
          for (let i = initialN; i < expandN; i++) {
            extra.push({
              classId: f.classId, raceId: f.raceId, seed: climbSeed(f.classId, f.raceId, i),
              seedIndex: i, packOn, policyName: 'baseline', pass: 'expansion',
            });
          }
        }
      }
      climbs = climbs.concat(await runJobs(extra, workers, 'expansion baseline'));
    }

    const bossCombos = [
      ...classes.map(classId => ({ classId, raceId: 'human' })),
      ...flagged.map(f => ({ classId: f.classId, raceId: f.raceId })),
    ];
    const seenB = new Set();
    const bossJobs = [];
    for (const packOn of [false, true]) {
      for (const c of bossCombos) {
        const key = `${packOn}:${c.classId}/${c.raceId}`;
        if (seenB.has(key)) continue;
        seenB.add(key);
        for (let i = 0; i < initialN; i++) {
          bossJobs.push({
            classId: c.classId, raceId: c.raceId, seed: climbSeed(c.classId, c.raceId, i),
            seedIndex: i, packOn, policyName: 'boss-aware', pass: 'boss-aware',
          });
        }
      }
    }
    climbs = climbs.concat(await runJobs(bossJobs, workers, 'boss-aware'));
  }

  const report = assembleReport({
    tree, started, catalog, mechanics, party, climbs,
    initialN, expandN, workers, quick,
    baselineTests: undefined,
  });

  const seedBankDump = buildSeedBankDump(tree);
  const rawLines = fromRaw ? null : climbs.map(r => JSON.stringify(r));
  writeOutputs(reportDir, report, rawLines, seedBankDump);
  const partial = join(reportDir, 'content_pack_balance_raw.partial.ndjson');
  if (existsSync(partial) && !fromRaw) {
    try { unlinkSync(partial); } catch { /* keep */ }
  }
  console.log(`wrote reports/content_pack_balance_measurement.md (${climbs.length} climbs, ${report.anomalies.length} anomalies)`);
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/run_content_pack_balance.js');
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { main, flagCombos };
void workerPath;
void existsSync;
void unlinkSync;
void appendFileSync;
void writeFileSync;
