// Fast difficulty-audit tests. Imported by tools/test.js.
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { CLASSES } from '../js/data/classes.js';
import { simulateClimbV2, makeV2Run } from './run_climb_v2.js';
import { baselinePolicy } from './policies/baseline.js';
import {
  BASE_CLASSES, EARLY_BRICK_BEFORE, climbSeed, makePolicy,
  runDifficultyClimb, runDifficultySuite, planDifficultyJobs,
  buildDifficultyReport, stripDifficultyTimestamps, isWin,
} from './run_difficulty.js';

const here = dirname(fileURLToPath(import.meta.url));

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export async function runDifficultyTests(t) {
  console.log('— difficulty distribution audit —');

  t('six base classes, no hidden callings',
    BASE_CLASSES.length === 6
    && BASE_CLASSES.every(id => CLASSES[id] && !CLASSES[id].hidden));
  t('early brick is death before F6', EARLY_BRICK_BEFORE === 6);
  t('climbSeed is deterministic', climbSeed(20260823, 2) === climbSeed(20260823, 2));
  t('scripted policy is rejected for win-rate estimates', (() => {
    try { makePolicy('scripted'); return false; } catch { return true; }
  })());

  {
    const a = makeV2Run({ seed: 20260823, classId: 'warrior' });
    const b = makeV2Run({ seed: 20260823, classId: 'warrior' });
    t('makeV2Run same seed matches starting hp', a.hp === b.hp && a.maxHp === b.maxHp);
    t('makeV2Run same seed matches growth rank', a.growthRank === b.growthRank);
    t('makeV2Run same seed matches rngState', a.rngState === b.rngState);
  }

  {
    const a = await simulateClimbV2(makeV2Run({ seed: 4242, classId: 'mage' }), baselinePolicy(), { stopAfterFloor: 3 });
    const b = await simulateClimbV2(makeV2Run({ seed: 4242, classId: 'mage' }), baselinePolicy(), { stopAfterFloor: 3 });
    t('traced climb is deterministic', a.outcome === b.outcome && a.checkpoint.rngState === b.checkpoint.rngState);
    t('trace is present and does not omit floors', Array.isArray(a.trace) && a.trace.length >= 1);
    t('trace records enter resources without extra rng', a.trace.every(r => r.enter && typeof r.enter.gold === 'number'));
  }

  {
    const a = await runDifficultyClimb({ seed: 77, classId: 'priest', policy: 'baseline' });
    const b = await runDifficultyClimb({ seed: 77, classId: 'priest', policy: 'baseline' });
    t('same seed+class+policy climb summary matches', deepEqual(a, b));
    t('summary names the class', a.classId === 'priest');
    t('win flag matches outcome', a.win === isWin(a.outcome));
  }

  {
    const jobs = planDifficultyJobs({ seed: 1, runs: 12, classes: BASE_CLASSES });
    t('jobs stratify across all base classes', new Set(jobs.jobs.map(j => j.classId)).size === 6);
    t('same seed index is reused across classes', jobs.jobs.filter(j => j.seedIndex === 0).length === 6);
  }

  {
    const a = stripDifficultyTimestamps(await runDifficultySuite({ seed: 5, runs: 6, policy: 'baseline' }));
    const b = stripDifficultyTimestamps(await runDifficultySuite({ seed: 5, runs: 6, policy: 'baseline' }));
    t('suite report is byte-stable for same seed+runs+policy', JSON.stringify(a) === JSON.stringify(b));
    t('report has per-class rows', Object.keys(a.byClass).length >= 1);
    t('report has mortality curve', Array.isArray(a.curve.byFloor) && a.curve.byFloor.length === 51);
    t('report has scorecard win rate', typeof a.scorecard.winRate === 'number');
    t('early brick rate is a fraction', a.scorecard.earlyBrickRate >= 0 && a.scorecard.earlyBrickRate <= 1);
  }

  {
    const empty = buildDifficultyReport([], { name: 'EMPTY', seed: 1, policy: 'baseline' });
    t('empty report does not invent wins', empty.overall.wins === 0 && empty.overall.winRate === 0);
  }

  {
    const src = [
      readFileSync(join(here, 'run_difficulty.js'), 'utf8'),
      readFileSync(join(here, 'policies', 'reasonable.js'), 'utf8'),
    ].join('\n');
    t('difficulty tools do not call Math.random', !/\bMath\.random\b/.test(src));
    t('reasonable policy uses isolated pathRng', /seed \^ run\.floor \^ 0xA11CE/.test(src));
  }

  {
    const climbSrc = readFileSync(join(here, 'run_climb_v2.js'), 'utf8');
    t('makeV2Run seeds chargen', /rollStart\(classId, raceId, seed\)/.test(climbSrc));
    t('makeV2Run no longer falls through to null gen', !/gen: opts\.gen \|\| null/.test(climbSrc));
  }

  {
    const core = readFileSync(join(here, '..', 'js', 'combat_core.js'), 'utf8');
    t('buildEnemy uid is not Math.random', !/uid: spec\.uid \|\| Math\.random/.test(core));
    await simulateClimbV2(makeV2Run({ seed: 4242, classId: 'mage' }), baselinePolicy(), { stopAfterFloor: 3 });
    const rows = [];
    for (let i = 0; i < 3; i++) {
      rows.push(await runDifficultyClimb({ seed: 77, classId: 'priest', policy: 'baseline' }));
    }
    t('same seed stays stable after another class climb',
      rows.every(r => r.maxFloor === rows[0].maxFloor && r.outcome === rows[0].outcome && r.finalGold === rows[0].finalGold));
  }
}
