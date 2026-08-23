// Capture characterization goldens from the CURRENT Fight implementation.
// Usage: node tools/combat_characterize.js
// Overwrites tools/fixtures/combat_parity/*.json — only do this before an
// extract, never to "fix" a core mismatch.

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { makeRng } from '../js/rng.js';
import { SKILLS } from '../js/data/skills.js';
import {
  buildEnemy, skillStatValue, createSilentFight, snapshotFightState,
  statusOutgoingMult, collectEnemyRiders, initiativePenaltyFromStatuses,
} from '../js/combat.js';
import { derived } from '../js/character.js';
import { SCENARIOS, runScenario, fixtureRun } from './combat_fixtures.js';

const root = dirname(fileURLToPath(import.meta.url));
const outDir = join(root, 'fixtures', 'combat_parity');
mkdirSync(outDir, { recursive: true });

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
    extra.frailTaken = snap.player; // hex+frail bag present
  }
  return extra;
}

const written = [];
for (const scenario of SCENARIOS) {
  const expected = await runScenario(scenario, {
    createFight: createSilentFight,
    buildEnemy,
    snapshot: snapshotFightState,
  });
  const extra = extrasFor(scenario, expected);
  const golden = {
    id: scenario.id,
    stage: scenario.stage,
    method: scenario.method,
    seed: scenario.seed,
    capturedFrom: 'js/combat.js Fight (pre-extract characterization)',
    extra,
    expected,
  };
  const path = join(outDir, `${scenario.id}.json`);
  writeFileSync(path, JSON.stringify(golden, null, 2) + '\n');
  written.push(scenario.id);
  console.log('wrote', scenario.id);
}

console.log(`captured ${written.length} goldens → ${outDir}`);
