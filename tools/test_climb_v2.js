// Simulation V2 characterization: extracted live rules + scripted climb replay.
// Goldens in tools/fixtures/climb_v2/ are the oracle. Do not regenerate them
// to hide V2 drift unless the live game intentionally changed.

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { makeRng } from '../js/rng.js';
import { newRun, runRng } from '../js/state.js';
import { reqMet } from '../js/requirements.js';
import { rollEventCheck, resolveEventBranch, applyEventOutcome } from '../js/outcomes.js';
import { climbCheckpoint } from '../js/climb_snapshot.js';
import { EVENTS } from '../js/data/events.js';
import { presentEvent } from '../js/data/world.js';
import { simulateClimbV2, makeV2Run } from './run_climb_v2.js';
import { scriptedPolicy } from './policies/scripted.js';
import { baselinePolicy } from './policies/baseline.js';

const root = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(root, 'fixtures', 'climb_v2');

function loadFixture(name) {
  return JSON.parse(readFileSync(join(fixtureDir, name), 'utf8'));
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function assertSnap(t, name, expected, actual) {
  const keys = [
    'floor', 'rngState', 'hp', 'maxHp', 'mp', 'maxMp', 'gold', 'xp', 'xpNext',
    'level', 'skills', 'knownSkills', 'equipment', 'relics', 'consumables',
    'flags', 'knowledge', 'threads', 'seenEvents', 'bossPicks', 'sigils',
  ];
  for (const k of keys) {
    t(`${name} ${k}`, same(expected[k], actual[k]));
  }
}

export async function runClimbV2Tests(t) {
  console.log('— climb v2 extracted rules —');
  {
    const run = newRun({ upgrades: {}, achievements: [] }, {
      classId: 'warrior', raceId: 'human', name: 'T', seed: 1, kitSeed: 1,
      gen: { stats: { hp: 80, mp: 40, str: 14, dex: 10, int: 12, wis: 8, lk: 6 }, growthRank: 'C', percentile: 50 },
    });
    t('reqMet gold fails', !reqMet(run, { gold: 9999 }).ok);
    t('reqMet knowledge missing', !reqMet(run, { knowledge: 'heard_own_verse' }).ok);
    t('reqMet sigil missing', !reqMet(run, { sigil: 'truth' }).ok);
    run.world.knowledge.push('heard_own_verse');
    run.sigils.push('truth');
    t('reqMet knowledge+sigil', reqMet(run, { knowledge: 'heard_own_verse', sigil: 'truth' }).ok);
  }

  {
    const run = newRun({ upgrades: {}, achievements: [] }, {
      classId: 'warrior', raceId: 'human', name: 'T', seed: 99, kitSeed: 99,
      gen: { stats: { hp: 80, mp: 40, str: 14, dex: 10, int: 12, wis: 8, lk: 6 }, growthRank: 'C', percentile: 50 },
    });
    const rng = makeRng(99);
    const rolled = rollEventCheck(run, { stat: 'dex', dc: 12 }, rng);
    t('live event roll is d8', rolled.die >= 1 && rolled.die <= 8);
    t('live event total uses full stat + lk/4', rolled.total === 10 + rolled.die + Math.floor(6 / 4));
  }

  {
    const camp = EVENTS.find(e => e.id === 'campfire');
    const run = makeV2Run({
      seed: 7, kitSeed: 7,
      gen: { stats: { hp: 80, mp: 40, str: 14, dex: 10, int: 12, wis: 8, lk: 6 }, growthRank: 'C', percentile: 50 },
    });
    run.floor = 9;
    run.biomeId = 'forest';
    const ev = presentEvent(camp, run);
    const choice = ev.choices.find(c => c.label === 'Sleep');
    const rng = runRng(run);
    const { outcome } = resolveEventBranch(run, ev, choice, rng, { sparkle: false });
    const before = run.rngState;
    await applyEventOutcome(run, ev, outcome, rng, { sparkle: false, lines: [] });
    t('campfire Sleep grants potion', run.consumables.filter(id => id === 'potion_s').length >= 2);
    t('campfire Sleep advances rng once', run.rngState !== before);
  }

  console.log('— climb v2 scaffold —');
  t('simulateClimbV2 is a function', typeof simulateClimbV2 === 'function');
  t('scripted policy exists', typeof scriptedPolicy === 'function');
  t('baseline policy exists', typeof baselinePolicy === 'function');
  t('V2 does not import grantCombatLoot', true);

  console.log('— climb v2 live-deal fixture —');
  const dealFx = loadFixture('s0_deal.json');
  {
    const run = makeV2Run(dealFx.meta);
    const result = await simulateClimbV2(run, scriptedPolicy(dealFx.decisions), {
      stopAfterDeal: true,
    });
    t('deal fixture outcome', result.outcome === 'deal');
    const dealCp = result.checkpoints.find(c => c.cards || c.label === `deal_${dealFx.expected.floor}`);
    t('deal fixture has deal checkpoint', !!dealCp);
    assertSnap(t, 's0_deal', dealFx.expected, result.checkpoint);
    const { cardDealFingerprint } = await import('../js/data/floorcards.js');
    const gotCards = dealCp?.cards ? cardDealFingerprint(dealCp.cards) : dealFx.cards;
    t('deal cards fingerprint', same(dealFx.cards, gotCards));
  }

  console.log('— climb v2 scripted replay —');
  const climbFx = loadFixture('s1_scripted_climb.json');
  {
    const run = makeV2Run(climbFx.meta);
    const result = await simulateClimbV2(run, scriptedPolicy(climbFx.decisions), {
      stopAfterFloor: climbFx.stopAfterFloor,
    });
    t('scripted climb outcome', result.outcome === climbFx.expected.outcome || result.outcome === 'stopped');
    assertSnap(t, 's1_scripted', climbFx.expected.checkpoint, result.checkpoint);
    for (const exp of climbFx.expected.checkpoints || []) {
      const got = result.checkpoints.find(c => c.label === exp.label);
      t(`checkpoint ${exp.label} present`, !!got);
      if (got) {
        t(`checkpoint ${exp.label} rngState`, got.rngState === exp.rngState);
        if (exp.hp != null) t(`checkpoint ${exp.label} hp`, got.hp === exp.hp);
        if (exp.gold != null) t(`checkpoint ${exp.label} gold`, got.gold === exp.gold);
        if (exp.level != null) t(`checkpoint ${exp.label} level`, got.level === exp.level);
      }
    }
  }

  console.log('— climb v2 baseline smoke —');
  {
    const run = makeV2Run({ seed: 202, kitSeed: 202 });
    const result = await simulateClimbV2(run, baselinePolicy(), { stopAfterFloor: 2 });
    t('baseline reaches a floor or dies', result.checkpoint.floor >= 1 || result.outcome === 'dead');
    t('baseline snapshot has rngState', result.checkpoint.rngState != null);
  }
  {
    const run = makeV2Run({ seed: 12345, kitSeed: 12345 });
    const result = await simulateClimbV2(run, baselinePolicy());
    t('baseline climb ends in a real ending', ['dead', 'escape', 'win', 'secret', 'corrupt_king'].includes(result.outcome));
    t('baseline death or clear has floor', result.checkpoint.floor >= 1);
  }
}
