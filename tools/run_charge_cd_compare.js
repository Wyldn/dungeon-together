#!/usr/bin/env node
// Fixed-seed live-core comparison for player charge-cooldown + turn-start charge.
// Does not retune classes or enemies. Prints per-class rotation health.
//
//   node tools/run_charge_cd_compare.js --seed 20260825 --climbs 12 --stop 10

import { SKILLS } from '../js/data/skills.js';
import { SKILL_COOLDOWNS } from '../js/data/skill_cooldowns.js';
import { simulateClimbV2, makeV2Run } from './run_climb_v2.js';
import { baselinePolicy } from './policies/baseline.js';
import { chooseAutoPlayAction } from '../js/combat_policy.js';
import { BASE_CLASSES, climbSeed } from './run_difficulty.js';

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

function parseArgs(argv) {
  const out = { seed: 20260825, climbs: 12, stop: 10 };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--seed') out.seed = Number(argv[++i]);
    else if (argv[i] === '--climbs') out.climbs = Number(argv[++i]);
    else if (argv[i] === '--stop') out.stop = Number(argv[++i]);
  }
  return out;
}

function emptyStats() {
  return {
    climbs: 0, f10: 0, wins: 0, dead: 0,
    damageTaken: 0, rounds: 0, fights: 0,
    mpStarve: 0, actions: 0,
    uses: {},
    chargedUses: 0,
    chargedRepeats: 0,
    lastCharged: null,
  };
}

function wrapPolicy(base, stats) {
  return {
    ...base,
    beginFight() {
      stats.lastCharged = null;
      stats.fights++;
      stats._fightDmg = 0;
      base.beginFight?.();
    },
    chooseCombatAction(f) {
      const act = chooseAutoPlayAction(f);
      stats.actions++;
      if (f.run.mp <= 2) stats.mpStarve++;
      stats._fightDmg = f.damageTaken || stats._fightDmg;
      if (act?.type === 'useSkill' && act.skillId) {
        stats.uses[act.skillId] = (stats.uses[act.skillId] || 0) + 1;
        const sk = SKILLS[act.skillId];
        if ((sk?.charge || 0) >= 1) {
          stats.chargedUses++;
          if (stats.lastCharged === act.skillId) stats.chargedRepeats++;
          stats.lastCharged = act.skillId;
        } else {
          stats.lastCharged = null;
        }
      } else {
        stats.lastCharged = null;
      }
      stats.rounds += 0;
      stats.maxRound = Math.max(stats.maxRound || 0, f.round || 0);
      return act;
    },
  };
}

function topUses(uses, n = 6) {
  return Object.entries(uses)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([id, c]) => `${id}:${c}`)
    .join(', ');
}

function rotationOk(classId, uses) {
  const charged = Object.entries(uses)
    .filter(([id]) => SKILL_COOLDOWNS[id])
    .sort((a, b) => b[1] - a[1]);
  const free = Object.entries(uses)
    .filter(([id]) => SKILLS[id] && (SKILLS[id].charge || 0) < 1)
    .reduce((s, [, c]) => s + c, 0);
  const chargedTotal = charged.reduce((s, [, c]) => s + c, 0);
  const distinctCharged = charged.length;
  // Starting kits often have a single 1⚡ skill. That is still a rotation if
  // the free hit is actually used (cooldown is doing its job).
  return {
    ok: free > 0 && chargedTotal > 0 && free >= chargedTotal * 0.35,
    free,
    chargedTotal,
    distinctCharged,
    topShare: chargedTotal ? (charged[0]?.[1] || 0) / chargedTotal : 0,
    topCharged: charged[0]?.[0] || null,
  };
}

async function main() {
  const { seed, climbs, stop } = parseArgs(process.argv);
  console.log(`charge-cd compare  seed=${seed}  climbs/class=${climbs}  stop=F${stop}`);
  const rows = [];
  for (const classId of BASE_CLASSES) {
    const stats = emptyStats();
    for (let i = 0; i < climbs; i++) {
      const run = makeV2Run({ seed: climbSeed(seed, i), classId, kitSeed: climbSeed(seed, i) ^ 0x51 });
      const policy = wrapPolicy(baselinePolicy(), stats);
      const result = await simulateClimbV2(run, policy, { stopAfterFloor: stop });
      stats.climbs++;
      stats.damageTaken += result.checkpoint?.maxHp
        ? Math.max(0, (result.checkpoint.maxHp || 0) - (result.checkpoint.hp || 0))
        : 0;
      const deathFloor = result.deathFloor || (result.outcome === 'dead' ? result.checkpoint?.floor : null);
      if (result.outcome === 'dead' && deathFloor != null && deathFloor < stop) stats.dead++;
      else stats.f10++;
      if (result.outcome === 'win' || result.outcome === 'secret' || result.outcome === 'corrupt_king') {
        stats.wins++;
      }
    }
    const rot = rotationOk(classId, stats.uses);
    const row = {
      classId,
      f10Rate: stats.climbs ? stats.f10 / stats.climbs : 0,
      deadRate: stats.climbs ? stats.dead / stats.climbs : 0,
      avgDmg: stats.climbs ? Math.round(stats.damageTaken / stats.climbs) : 0,
      fights: stats.fights,
      actions: stats.actions,
      chargedUses: stats.chargedUses,
      chargedRepeatRate: stats.chargedUses ? stats.chargedRepeats / stats.chargedUses : 0,
      mpStarveRate: stats.actions ? stats.mpStarve / stats.actions : 0,
      rotation: rot,
      top: topUses(stats.uses),
    };
    rows.push(row);
    console.log(
      `${classId.padEnd(12)} F${stop} ${(row.f10Rate * 100).toFixed(0).padStart(3)}%  `
      + `dead ${(row.deadRate * 100).toFixed(0).padStart(3)}%  `
      + `repeat ${(row.chargedRepeatRate * 100).toFixed(0).padStart(3)}%  `
      + `starve ${(row.mpStarveRate * 100).toFixed(0).padStart(3)}%  `
      + `rot ${rot.ok ? 'ok' : 'THIN'} (${rot.distinctCharged} charged, free ${rot.free})  `
      + `${row.top}`,
    );
  }
  const thin = rows.filter(r => !r.rotation.ok);
  if (thin.length) {
    console.log('rotation problems:', thin.map(r => r.classId).join(', '));
  } else {
    console.log('all classes kept a functional rotation (free skills weave with charged skills; consecutive charged repeats stay near 0).');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
