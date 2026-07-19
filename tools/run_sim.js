// Full-climb Monte Carlo — solo / co-op clear-rate survival CDF.
//   node tools/run_sim.js [seed] [trials] [partySize]
// partySize omitted → print 1p–4p. Measures brick / F30+ / F51 clear vs TDC.clearRate.

import { CONFIG } from '../js/data/config.js';
import { TDC, partyBossAtkMult, partyBossHpMult } from '../js/data/tdc.js';
import {
  ENEMIES, BOSSES, biomeForFloor, pickBossForFloor, MODIFIERS,
} from '../js/data/enemies.js';
import { planEncounter, planBossEncounter } from '../js/data/balance.js';
import { makeRng } from '../js/rng.js';
import { syntheticClimber, simulateFight, percentile } from './combat_sim.js';

const LAST = TDC.lastFloor;
const BOSS_FLOORS = new Set(Object.keys(BOSSES).map(Number));

/** Survival CDF targets (started runs) — authoritative copy on TDC.clearRate. */
export const CLEAR_RATE_TARGETS = TDC.clearRate;

function healPct(p, pct) {
  if (pct <= 0 || p.hp <= 0) return;
  p.hp = Math.min(p.maxHp, p.hp + Math.round(p.maxHp * pct));
}

function healParty(party, pct) {
  for (const p of party) healPct(p, pct);
}

function applyFloorBreath(party) {
  healParty(party, CONFIG.recovery.floorHealPct);
}

/** Roll start quality band — underdogs + mid + strong kits. */
function rollBand(rng) {
  const r = rng.next();
  if (r < 0.22) return 0.18 + rng.next() * 0.14;
  if (r < 0.72) return 0.38 + rng.next() * 0.24;
  return 0.62 + rng.next() * 0.28;
}

function syncClimber(p, floor, band) {
  const next = syntheticClimber(floor, band, p.classBias);
  const gained = Math.max(0, next.maxHp - p.maxHp);
  p.level = next.level;
  p.stats = next.stats;
  p.atk = next.atk;
  p.def = next.def;
  p.dmgMult = next.dmgMult;
  p.dmgTakenMult = next.dmgTakenMult;
  p.crit = next.crit;
  p.dodge = next.dodge;
  p.maxHp = next.maxHp;
  p.mp = next.mp;
  p.maxMp = next.maxMp;
  p.hp = Math.min(p.maxHp, p.hp + gained);
  p.floor = floor;
  p.band = band;
}

function syncParty(party, floor) {
  for (const p of party) syncClimber(p, floor, p.band);
}

function living(party) {
  return party.filter(p => p.hp > 0);
}

function applyFightResult(party, r) {
  if (r.hpLeftAll) {
    for (let i = 0; i < party.length; i++) party[i].hp = Math.max(0, r.hpLeftAll[i] ?? 0);
  } else if (r.won) {
    // solo fallback
    const survivor = party.find(p => p.hp > 0) || party[0];
    survivor.hp = Math.max(1, r.hpLeft);
  }
}

function isBossFloor(f) { return BOSS_FLOORS.has(f); }
function isCampfireFloor(f) { return isBossFloor(f + 1); }
function isTrialFloor(f) { return f % 5 === 0 && !isBossFloor(f); }

/**
 * One synthetic climb for `partySize` climbers (1–4).
 * Wipe = whole party down. Returns { cleared, deathFloor, maxFloor, partySize }.
 */
export function simulateRun(rng, { band = null, partySize = 1 } = {}) {
  const n = Math.max(1, Math.min(4, partySize | 0));
  const party = [];
  for (let i = 0; i < n; i++) {
    const q = band ?? rollBand(rng);
    const classBias = rng.pick(['str', 'dex', 'int']);
    const snap = syntheticClimber(1, q, classBias);
    party.push({ ...snap, hp: snap.maxHp, classBias, band: q });
  }
  const runMeta = { bossPicks: {} };
  let maxFloor = 0;

  for (let floor = 1; floor <= LAST; floor++) {
    maxFloor = floor;
    syncParty(party, floor);
    // Wipe only if everyone is down (co-op carry). Downed stay out until campfire.
    if (!living(party).length) {
      return { cleared: false, deathFloor: floor, maxFloor, partySize: n };
    }

    const biome = biomeForFloor(floor);
    const biomeStart = isBossFloor(floor) ? floor : biome.floors[0];

    if (isCampfireFloor(floor)) {
      // Campfire: revive downed allies, then Sleep heal.
      if (n > 1) {
        for (const p of party) {
          if (p.hp <= 0) p.hp = Math.max(1, Math.round(p.maxHp * CONFIG.death.respawnHpPct));
        }
      }
      healParty(party, 0.40);
      applyFloorBreath(party);
      continue;
    }

    if (isBossFloor(floor)) {
      const boss = pickBossForFloor(floor, rng, runMeta);
      const plan = planBossEncounter(rng, {
        floor, boss, pool: ENEMIES[biome.id] || [], partySize: n,
      });
      const r = simulateFight(rng, party, plan.specs, {
        // Escorts use the boss floor as biomeStart (depth 0) — absolute floorHp
        // still applies; avoids double-dipping biome depth on gatekeepers.
        floor,
        biomeStart: floor,
        hpMult: plan.hpMult * partyBossHpMult(n, floor),
        escortHpMult: plan.hpMult,
        atkMult: partyBossAtkMult(n, floor),
        boss: true,
        maxRounds: 60,
      });
      applyFightResult(party, r);
      if (!r.won || !living(party).length) {
        return { cleared: false, deathFloor: floor, maxFloor, partySize: n };
      }
      healParty(living(party), CONFIG.recovery.bossVictoryHealPct);
      applyFloorBreath(party);
      if (floor === LAST) return { cleared: true, deathFloor: null, maxFloor, partySize: n };
      continue;
    }

    if (isTrialFloor(floor)) {
      const mod = rng.pick(MODIFIERS);
      const plan = planEncounter(rng, {
        floor, biomeStart, pool: ENEMIES[biome.id], partySize: n,
        allowElite: floor - biomeStart >= 3,
      });
      const r = simulateFight(rng, party, plan.specs, {
        floor, biomeStart, hpMult: plan.hpMult * (mod.hpMult || 1), maxRounds: 40,
      });
      applyFightResult(party, r);
      if (!r.won || !living(party).length) {
        return { cleared: false, deathFloor: floor, maxFloor, partySize: n };
      }
      healParty(living(party), CONFIG.recovery.victoryHealPct);
      applyFloorBreath(party);
      continue;
    }

    const roll = rng.next();
    if (roll < 0.48) {
      const plan = planEncounter(rng, {
        floor, biomeStart, pool: ENEMIES[biome.id], partySize: n,
        allowElite: floor - biomeStart >= 4,
      });
      const r = simulateFight(rng, party, plan.specs, {
        floor, biomeStart, hpMult: plan.hpMult, maxRounds: 40,
      });
      applyFightResult(party, r);
      if (!r.won || !living(party).length) {
        return { cleared: false, deathFloor: floor, maxFloor, partySize: n };
      }
      healParty(living(party), CONFIG.recovery.victoryHealPct);
    } else if (roll < 0.66) {
      // Risky event — tax one random climber (others can carry).
      const victim = rng.pick(living(party));
      const drain = 0.08 + rng.next() * 0.14;
      victim.hp = Math.max(0, victim.hp - Math.round(victim.maxHp * drain));
      if (!living(party).length) {
        return { cleared: false, deathFloor: floor, maxFloor, partySize: n };
      }
    } else if (rng.chance(0.55)) {
      healParty(living(party), 0.10 + rng.next() * 0.12);
    }
    applyFloorBreath(party);
  }

  return { cleared: true, deathFloor: null, maxFloor: LAST, partySize: n };
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
    // Keep 1p stream stable; offset co-op sizes so they don't share the same rolls.
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

// CLI
const isMain = process.argv[1] && /run_sim\.js/.test(process.argv[1].replace(/\\/g, '/'));
if (isMain) {
  const seed = Number(process.argv[2] || 20260719);
  const trials = Number(process.argv[3] || 2000);
  const only = process.argv[4] != null ? Number(process.argv[4]) : null;
  if (only != null && only >= 1 && only <= 4) {
    console.log(formatClearReport(runClearRateSim({ seed, trials, partySize: only })));
  } else {
    for (const rep of runClearRateSuite({ seed, trials })) {
      console.log(formatClearReport(rep));
      console.log();
    }
  }
}
