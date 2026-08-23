// Replay committed combat goldens against Fight (presenter) and the shared core.
// Goldens in tools/fixtures/combat_parity/ are the oracle (captured from pre-extract Fight).
// Do not regenerate them to match this file.

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { makeRng } from '../js/rng.js';
import { SKILLS } from '../js/data/skills.js';
import { derived } from '../js/character.js';
import {
  buildEnemy, skillStatValue, createSilentFight, snapshotFightState,
  statusOutgoingMult, collectEnemyRiders, initiativePenaltyFromStatuses,
} from '../js/combat.js';
import { createCombatContext, snapshotCombat } from '../js/combat_core.js';
import { SCENARIOS, runScenario, fixtureRun, fixtureEnemy } from './combat_fixtures.js';
import { runHeadlessFight } from './combat_headless.js';

const root = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(root, 'fixtures', 'combat_parity');

function extrasFor(scenario, snap) {
  const extra = {};
  if (scenario.extras?.includes('skillStat')) {
    const run = fixtureRun(scenario.run);
    const d = derived(run);
    extra.skillStat = {
      slash: skillStatValue(SKILLS.slash, d),
      best: skillStatValue(SKILLS.basic_attack, d),
      dual: skillStatValue({ stat: 'str+int', power: 100 }, d),
    };
    extra.enemyScale = snap.enemies[0] && {
      hp: snap.enemies[0].hp,
      maxHp: snap.enemies[0].maxHp,
      atk: snap.enemies[0].atk,
      def: snap.enemies[0].def,
      spd: snap.enemies[0].spd,
    };
  }
  if (scenario.extras?.includes('helpers')) {
    const rng = makeRng(scenario.seed);
    const e = { poison: 1, burn: 1, turnCount: 1, statuses: {} };
    extra.outgoing = {
      none: statusOutgoingMult({}),
      weaken: statusOutgoingMult({ weaken: 2 }),
      burn: statusOutgoingMult({ burn: 2 }),
      both: statusOutgoingMult({ weaken: 2, burn: 2 }),
    };
    extra.riders = collectEnemyRiders(e, { stun: 1, frailSure: true }, rng);
    extra.paralyzePenalty = initiativePenaltyFromStatuses({ paralyzed: 2 });
    extra.frailTaken = snap.player;
  }
  return extra;
}

function loadGolden(id) {
  return JSON.parse(readFileSync(join(fixtureDir, `${id}.json`), 'utf8'));
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffHint(expected, actual) {
  const es = JSON.stringify(expected);
  const as = JSON.stringify(actual);
  if (es === as) return '';
  const n = Math.min(es.length, as.length);
  let i = 0;
  while (i < n && es[i] === as[i]) i++;
  return ` first mismatch @${i}: exp ${es.slice(Math.max(0, i - 40), i + 60)} vs act ${as.slice(Math.max(0, i - 40), i + 60)}`;
}

export async function runCombatCoreTests(t) {
  console.log('— combat core characterization goldens —');
  const files = readdirSync(fixtureDir).filter(f => f.endsWith('.json'));
  t('golden catalog is present', files.length >= SCENARIOS.length);

  for (const scenario of SCENARIOS) {
    const golden = loadGolden(scenario.id);
    t(`${scenario.id} golden exists`, !!golden?.expected);

    const fightSnap = await runScenario(scenario, {
      createFight: createSilentFight,
      buildEnemy,
      snapshot: snapshotFightState,
    });
    const fightExtra = extrasFor(scenario, fightSnap);
    t(`${scenario.id} silent Fight matches golden`, same(golden.expected, fightSnap)
      && same(golden.extra || {}, fightExtra));
    if (!same(golden.expected, fightSnap)) {
      console.error('    ', scenario.id, 'fight', diffHint(golden.expected, fightSnap));
    }

    const coreSnap = await runScenario(scenario, {
      createFight: (run, rng, enemies, mod) => createCombatContext(run, rng, enemies, mod),
      buildEnemy,
      snapshot: snapshotCombat,
    });
    const coreExtra = extrasFor(scenario, coreSnap);
    t(`${scenario.id} combat core matches golden`, same(golden.expected, coreSnap)
      && same(golden.extra || {}, coreExtra));
    if (!same(golden.expected, coreSnap)) {
      console.error('    ', scenario.id, 'core', diffHint(golden.expected, coreSnap));
    }

    t(`${scenario.id} Fight/core adapter identity`, same(fightSnap, coreSnap));
  }

  console.log('— combat headless driver —');
  {
    const scenario = SCENARIOS.find(s => s.id === 's5_warrior_sequence');
    const golden = loadGolden(scenario.id);
    const run = fixtureRun(scenario.run);
    const enemies = (scenario.enemies || []).map(spec => fixtureEnemy(spec.id || spec, spec, buildEnemy));
    const ctx = createCombatContext(run, makeRng(scenario.seed), enemies, scenario.mod || null);
    t('runHeadlessFight exports a function', typeof runHeadlessFight === 'function');
    t('headless context is node-safe', ctx.headless === true && !ctx.el);
    t('s5 golden still the oracle for the sequence', !!golden.expected.player);
  }
}
