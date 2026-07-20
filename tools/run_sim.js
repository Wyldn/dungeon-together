// Full-climb Monte Carlo — solo / co-op clear-rate survival CDF.
// Uses real newRun progression: gainXp, equipment/relic rolls, headless events.
//   node tools/run_sim.js [seed] [trials] [partySize]
// partySize omitted → print 1p–4p. Measures brick / F30+ / F51 clear vs TDC.clearRate.

import { CONFIG } from '../js/data/config.js';
import {
  TDC, partyBossAtkMult, partyBossHpMult, partyTrashAtkMult,
  eventFightHpMult, eventFightAtkMult,
} from '../js/data/tdc.js';
import {
  ENEMIES, BOSSES, biomeForFloor, pickBossForFloor, MODIFIERS, NPC_ENEMIES,
} from '../js/data/enemies.js';
import { planEncounter, planBossEncounter } from '../js/data/balance.js';
import { makeRng } from '../js/rng.js';
import { simulateFight, percentile } from './combat_sim.js';
import {
  createSimRun,
  climberFromRun,
  applyFightToRun,
  grantCombatLoot,
  estimateCombatRewards,
  resolveSimEvent,
  applyCombatRewardHeadless,
} from './sim_run_state.js';
import { derived } from '../js/character.js';

const LAST = TDC.lastFloor;
const BOSS_FLOORS = setFromKeys(BOSSES);

function setFromKeys(obj) {
  return new Set(Object.keys(obj).map(Number));
}

/** Survival CDF targets (started runs) — authoritative copy on TDC.clearRate. */
export const CLEAR_RATE_TARGETS = TDC.clearRate;

function livingRuns(party) {
  return party.filter(r => r.hp > 0 && !r.down);
}

function healPartyRuns(party, pct) {
  for (const r of party) {
    if (r.hp <= 0) continue;
    r.hp = Math.min(r.maxHp, r.hp + Math.round(r.maxHp * pct));
  }
}

function applyFloorBreath(party) {
  healPartyRuns(party, CONFIG.recovery.floorHealPct);
}

function syncFloorMeta(party, floor) {
  const biome = biomeForFloor(floor);
  for (const r of party) {
    r.floor = floor;
    r.biomeId = biome.id;
  }
}

/**
 * Fight with climbers derived from real runs; write vitals/loot/XP back.
 */
function fightParty(rng, party, specs, opts) {
  const aliveIdx = [];
  const climbers = [];
  for (let i = 0; i < party.length; i++) {
    if (party[i].hp > 0 && !party[i].down) {
      aliveIdx.push(i);
      climbers.push(climberFromRun(party[i]));
    }
  }
  if (!climbers.length) {
    return { won: false, hpLeftAll: party.map(() => 0) };
  }

  const r = simulateFight(rng, climbers, specs, opts);
  const { gold, xp } = estimateCombatRewards(specs, opts.floor, rng, { boss: !!opts.boss });
  const goldEach = Math.round(gold / Math.max(1, climbers.length));
  const xpEach = Math.round(xp / Math.max(1, climbers.length));
  const elite = specs.some(s => s.elite);

  for (let j = 0; j < climbers.length; j++) {
    const run = party[aliveIdx[j]];
    const won = r.won && climbers[j].hp > 0;
    applyFightToRun(run, climbers[j], r, {
      won,
      xp: r.won ? xpEach : 0,
      gold: r.won ? Math.round(goldEach * (derived(run).goldMult || 1) * (derived(run).combatGoldMult || 1)) : 0,
      boss: !!opts.boss,
    });
    if (r.won && won) {
      grantCombatLoot(run, rng, { boss: !!opts.boss, elite });
    }
  }

  // Downed allies keep hp 0
  for (let i = 0; i < party.length; i++) {
    if (!aliveIdx.includes(i) && party[i].hp <= 0) party[i].down = true;
  }

  return r;
}

function isSpecialEventFoe(s) {
  if (!s?.id) return false;
  if (s.id === 'mimic') return true;
  return !!(NPC_ENEMIES[s.id] && !String(s.id).startsWith('farmer_'));
}

function resolveEventCombat(rng, run, combatSpecs, floor, biomeStart, fightReward = null, partySize = 1) {
  if (!combatSpecs?.length) return true;
  // Specs must already be full templates (hp/atk/specials) from resolveEventCombatPack.
  const climber = climberFromRun(run);
  const special = combatSpecs.some(isSpecialEventFoe);
  const hpMult = special ? eventFightHpMult(partySize) : 1;
  const atkMult = special
    ? eventFightAtkMult(partySize)
    : partyTrashAtkMult(partySize, floor);
  const r = simulateFight(rng, climber, combatSpecs, {
    floor, biomeStart, hpMult, atkMult, maxRounds: 35,
  });
  const { gold, xp } = estimateCombatRewards(combatSpecs, floor, rng);
  applyFightToRun(run, climber, r, {
    won: r.won,
    xp: r.won ? xp : 0,
    gold: r.won ? Math.round(gold * (derived(run).goldMult || 1)) : 0,
    boss: false,
  });
  if (r.won) {
    grantCombatLoot(run, rng, { elite: combatSpecs.some(s => s.elite) });
    // Event-specific spoils bag (techniques / guaranteed gear / farmer loot).
    applyCombatRewardHeadless(run, fightReward, rng, { paySkills: true });
  }
  return r.won;
}

/**
 * One climb for `partySize` real runs (1–4 independent kits).
 * Wipe = whole party down. Returns { cleared, deathFloor, maxFloor, partySize, sample? }.
 */
export function simulateRun(rng, { partySize = 1, trackProgress = false } = {}) {
  const n = Math.max(1, Math.min(4, partySize | 0));
  const party = [];
  for (let i = 0; i < n; i++) {
    party.push(createSimRun(rng));
  }

  const runMeta = { bossPicks: {} };
  // Share boss picks across party for consistent encounters
  for (const r of party) r.bossPicks = runMeta.bossPicks;

  let maxFloor = 0;
  const progress = trackProgress ? [] : null;

  for (let floor = 1; floor <= LAST; floor++) {
    maxFloor = floor;
    syncFloorMeta(party, floor);

    if (!livingRuns(party).length) {
      return {
        cleared: false, deathFloor: floor, maxFloor, partySize: n,
        sample: trackProgress ? snapshotParty(party, progress) : undefined,
      };
    }

    const biome = biomeForFloor(floor);
    const biomeStart = isBossFloor(floor) ? floor : biome.floors[0];

    if (isCampfireFloor(floor)) {
      if (n > 1) {
        for (const r of party) {
          if (r.hp <= 0 || r.down) {
            r.down = false;
            r.hp = Math.max(1, Math.round(r.maxHp * CONFIG.death.respawnHpPct));
          }
        }
      }
      healPartyRuns(party, 0.40);
      applyFloorBreath(party);
      if (trackProgress) progress.push(snapFloor(party, floor, 'camp'));
      continue;
    }

    if (isBossFloor(floor)) {
      const boss = pickBossForFloor(floor, rng, runMeta);
      const plan = planBossEncounter(rng, {
        floor, boss, pool: ENEMIES[biome.id] || [], partySize: n,
      });
      const r = fightParty(rng, party, plan.specs, {
        floor,
        biomeStart: floor,
        hpMult: plan.hpMult * partyBossHpMult(n, floor),
        escortHpMult: plan.hpMult,
        atkMult: partyBossAtkMult(n, floor),
        boss: true,
        maxRounds: 60,
      });
      if (!r.won || !livingRuns(party).length) {
        return {
          cleared: false, deathFloor: floor, maxFloor, partySize: n,
          sample: trackProgress ? snapshotParty(party, progress) : undefined,
        };
      }
      applyFloorBreath(livingRuns(party));
      if (trackProgress) progress.push(snapFloor(party, floor, 'boss'));
      if (floor === LAST) {
        return {
          cleared: true, deathFloor: null, maxFloor, partySize: n,
          sample: trackProgress ? snapshotParty(party, progress) : undefined,
        };
      }
      continue;
    }

    if (isTrialFloor(floor)) {
      const mod = rng.pick(MODIFIERS);
      const plan = planEncounter(rng, {
        floor, biomeStart, pool: ENEMIES[biome.id], partySize: n,
        allowElite: floor - biomeStart >= 3,
      });
      const r = fightParty(rng, party, plan.specs, {
        floor, biomeStart, hpMult: plan.hpMult * (mod.hpMult || 1), maxRounds: 40,
      });
      if (!r.won || !livingRuns(party).length) {
        return {
          cleared: false, deathFloor: floor, maxFloor, partySize: n,
          sample: trackProgress ? snapshotParty(party, progress) : undefined,
        };
      }
      applyFloorBreath(livingRuns(party));
      if (trackProgress) progress.push(snapFloor(party, floor, 'trial'));
      continue;
    }

    const roll = rng.next();
    if (roll < 0.48) {
      const plan = planEncounter(rng, {
        floor, biomeStart, pool: ENEMIES[biome.id], partySize: n,
        allowElite: floor - biomeStart >= 4,
      });
      const r = fightParty(rng, party, plan.specs, {
        floor, biomeStart, hpMult: plan.hpMult, maxRounds: 40,
      });
      if (!r.won || !livingRuns(party).length) {
        return {
          cleared: false, deathFloor: floor, maxFloor, partySize: n,
          sample: trackProgress ? snapshotParty(party, progress) : undefined,
        };
      }
    } else {
      // Real event draws + headless outcomes (incl. fight choices + combat.reward).
      for (const run of livingRuns(party)) {
        const result = resolveSimEvent(run, rng, { partySize: n });
        if (result.combatSpecs?.length) {
          // Headless events are fought per-climber (solo), not as a shared party pack.
          // Use partySize 1 pads here; live coopEventFight applies co-op pads correctly.
          const ok = resolveEventCombat(
            rng, run, result.combatSpecs, floor, biomeStart, result.fightReward, 1,
          );
          if (!ok && !livingRuns(party).length) {
            return {
              cleared: false, deathFloor: floor, maxFloor, partySize: n,
              sample: trackProgress ? snapshotParty(party, progress) : undefined,
            };
          }
        }
      }
      if (!livingRuns(party).length) {
        return {
          cleared: false, deathFloor: floor, maxFloor, partySize: n,
          sample: trackProgress ? snapshotParty(party, progress) : undefined,
        };
      }
    }
    applyFloorBreath(livingRuns(party));
    if (trackProgress && (floor % 5 === 0 || floor <= 3)) {
      progress.push(snapFloor(party, floor, 'floor'));
    }
  }

  return {
    cleared: true, deathFloor: null, maxFloor: LAST, partySize: n,
    sample: trackProgress ? snapshotParty(party, progress) : undefined,
  };
}

function isBossFloor(f) { return BOSS_FLOORS.has(f); }
function isCampfireFloor(f) { return isBossFloor(f + 1); }
function isTrialFloor(f) { return f % 5 === 0 && !isBossFloor(f); }

function snapFloor(party, floor, kind) {
  const r = party[0];
  const d = derived(r);
  const eq = Object.values(r.equipment || {}).filter(Boolean);
  return {
    floor, kind,
    level: r.level,
    atk: d.atk,
    def: d.def,
    maxHp: r.maxHp,
    gold: r.gold,
    relics: (r.relics || []).length,
    equipped: eq.length,
    inventory: (r.inventory || []).length,
    skills: (r.skills || []).length,
    fame: r.fame || 0,
    uniques: countUniques(r),
  };
}

function countUniques(run) {
  let n = 0;
  const ids = [
    ...Object.values(run.equipment || {}).filter(Boolean),
    ...(run.inventory || []),
  ];
  for (const id of ids) {
    const it = run.gearBag?.[id];
    if (it?.rarity === 'unique' || it?.rarity === 'wrld') n++;
    else if (typeof id === 'string' && (id.includes('unique') || id.startsWith('u_'))) n++;
  }
  return n;
}

function snapshotParty(party, progress) {
  return {
    progress,
    final: party.map(r => ({
      classId: r.classId,
      raceId: r.raceId,
      level: r.level,
      floor: r.floor,
      atk: derived(r).atk,
      def: derived(r).def,
      maxHp: r.maxHp,
      gold: r.gold,
      relics: [...(r.relics || [])],
      equipment: { ...r.equipment },
      skills: [...(r.skills || [])],
      fame: r.fame,
    })),
  };
}

/**
 * Aggregate many climbs into a survival report for one party size.
 */
export function runClearRateSim({ seed = 20260719, trials = 2000, partySize = 1 } = {}) {
  const n = Math.max(1, Math.min(4, partySize | 0));
  const deaths = [];
  let clears = 0;
  let brick = 0;
  let reach30 = 0;
  let reach51 = 0;
  const maxFloors = [];

  for (let i = 0; i < trials; i++) {
    const rng = makeRng((seed + i * 9973 + (n - 1) * 100003) >>> 0);
    const r = simulateRun(rng, { partySize: n });
    maxFloors.push(r.maxFloor);
    if (r.maxFloor >= 30) reach30++;
    if (r.maxFloor >= 51) reach51++;
    if (r.cleared) {
      clears++;
      deaths.push(LAST + 1);
    } else {
      deaths.push(r.deathFloor);
      if (r.deathFloor <= 10) brick++;
    }
  }

  deaths.sort((a, b) => a - b);
  maxFloors.sort((a, b) => a - b);

  const reach = (f) => maxFloors.filter(m => m >= f).length / trials;
  const cdf = {};
  for (const f of [5, 10, 15, 20, 30, 40, 50, 51]) cdf[f] = reach(f);

  return {
    trials,
    seed,
    partySize: n,
    clearRate: clears / trials,
    brickRate: brick / trials,
    reach30: reach30 / trials,
    reach51: reach51 / trials,
    medianDeathFloor: percentile(deaths.filter(d => d <= LAST), 0.5) || LAST,
    medianMaxFloor: percentile(maxFloors, 0.5),
    cdf,
    targets: CLEAR_RATE_TARGETS,
  };
}

export function formatClearReport(rep) {
  const pct = (x) => `${(x * 100).toFixed(1)}%`;
  const band = (v, [lo, hi]) => {
    const ok = v >= lo && v <= hi;
    return `${pct(v)} (want ${pct(lo)}–${pct(hi)})${ok ? ' ✓' : ' ✗'}`;
  };
  const t = rep.targets;
  const label = rep.partySize === 1 ? 'Solo' : `${rep.partySize}p`;
  return [
    `${label} clear-rate sim — seed ${rep.seed}, ${rep.trials} runs`,
    `  brick ≤F10:  ${band(rep.brickRate, t.brickBy10)}`,
    `  reach F30+:  ${band(rep.reach30, t.reach30)}`,
    `  clear F51:   ${band(rep.clearRate, t.clear51)}`,
    `  reach F51:   ${pct(rep.reach51)} | median max floor ${rep.medianMaxFloor.toFixed(0)}`,
    `  CDF reach:   ${Object.entries(rep.cdf).map(([f, v]) => `F${f}=${pct(v)}`).join('  ')}`,
  ].join('\n');
}

/** Run 1p–4p and return reports. */
export function runClearRateSuite({ seed = 20260719, trials = 2000 } = {}) {
  return [1, 2, 3, 4].map(partySize => runClearRateSim({ seed, trials, partySize }));
}

/** Smoke: few tracked climbs to verify gear/relics grow with floor. */
export function smokeProgress({ seed = 42, partySize = 1, trials = 3 } = {}) {
  const out = [];
  for (let i = 0; i < trials; i++) {
    const rng = makeRng((seed + i * 9137 + partySize * 1009) >>> 0);
    out.push(simulateRun(rng, { partySize, trackProgress: true }));
  }
  return out;
}

// CLI
const isMain = process.argv[1] && /run_sim\.js/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const seed = Number(process.argv[2] || 20260719);
  const trials = Number(process.argv[3] || 2000);
  const only = process.argv[4] != null ? Number(process.argv[4]) : null;
  if (process.argv[2] === 'smoke') {
    const ps = Number(process.argv[3] || 1);
    const n = Number(process.argv[4] || 3);
    for (const r of smokeProgress({ seed: 42, partySize: ps, trials: n })) {
      console.log(JSON.stringify({
        cleared: r.cleared,
        maxFloor: r.maxFloor,
        deathFloor: r.deathFloor,
        progress: r.sample?.progress,
        final: r.sample?.final?.[0],
      }, null, 2));
    }
  } else if (only != null && only >= 1 && only <= 4) {
    console.log(formatClearReport(runClearRateSim({ seed, trials, partySize: only })));
  } else {
    for (const rep of runClearRateSuite({ seed, trials })) {
      console.log(formatClearReport(rep));
      console.log();
    }
  }
}
