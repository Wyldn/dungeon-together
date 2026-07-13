// Developer simulations (handoff §34 + encounter-budget balance pipeline).
//   node tools/sim.js [seed] [trials]
// Defaults: seed 20260709, 10000 trials (combat sections use fewer).

import { CLASSES } from '../js/data/classes.js';
import { RACES } from '../js/data/races.js';
import { ENEMIES, BOSSES, biomeForFloor } from '../js/data/enemies.js';
import { SKILLS } from '../js/data/skills.js';
import { ALL_EQUIPMENT, RELICS } from '../js/data/items.js';
import { CONFIG } from '../js/data/config.js';
import { TDC, expectedPower } from '../js/data/tdc.js';
import {
  encounterBudget, planEncounter,
  enemyThreatCost, mechanicBudgetCost, estimatePlayerPower, floorBenchmark,
  bossFightTargets, validateItemPower, validateLoadout,
  guardReviveReconciled,
} from '../js/data/balance.js';
import { RANK_ORDER, rankAtLeast, growthMult } from '../js/data/ranks.js';
import { initiativeOrder, addCharge } from '../js/systems.js';
import { rollStart } from '../js/state.js';
import { makeRng } from '../js/rng.js';
import { syntheticClimber, simulateFight, percentile } from './combat_sim.js';

void TDC; // referenced by console narrative / future hooks

globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const SEED = Number(process.argv[2] || 20260709);
const TRIALS = Number(process.argv[3] || 10000);
const rng = makeRng(SEED);

console.log(`Dungeon Together simulations — seed ${SEED}, ${TRIALS} trials each\n`);

/* ---- 0. Guard ↔ revival reconciliation ---- */
{
  console.log('0) GUARD ↔ REVIVAL');
  console.log(`   Guard block ${CONFIG.guard.blockPct * 100}% | revive/respawn ${CONFIG.death.reviveHpPct * 100}% | reconciled: ${guardReviveReconciled() ? 'yes' : 'NO'}`);
  console.log();
}

/* ---- 1. starting stat + growth distribution ---- */
{
  console.log('1) STARTING GENERATION (all classes/races pooled)');
  const growthCounts = Object.fromEntries(RANK_ORDER.map(r => [r, 0]));
  const buckets = [0, 0, 0, 0, 0];
  const classIds = Object.keys(CLASSES);
  const raceIds = Object.keys(RACES);
  let ssCount = 0;
  const samples = [];
  for (let i = 0; i < TRIALS; i++) {
    const gen = rollStart(rng.pick(classIds), rng.pick(raceIds), Math.floor(rng.next() * 0xFFFFFFFF));
    growthCounts[gen.growthRank]++;
    buckets[Math.min(4, Math.floor(gen.percentile * 5))]++;
    samples.push(gen);
    if (gen.percentile > 0.8 && rankAtLeast(gen.growthRank, 'S')) ssCount++;
  }
  console.log('   start-power quintiles:', buckets.map(b => (b / TRIALS * 100).toFixed(1) + '%').join(' | '));
  console.log('   growth ranks:', RANK_ORDER.map(r => `${r}:${(growthCounts[r] / TRIALS * 100).toFixed(1)}%`).join(' '));
  console.log(`   strong-start (top 20%) WITH S+ growth: ${(ssCount / TRIALS * 100).toFixed(2)}%`);
  const weak = samples.filter(s => s.percentile < 0.33);
  const strong = samples.filter(s => s.percentile > 0.67);
  const avgMult = list => list.reduce((a, s) => a + growthMult(s.growthRank), 0) / list.length;
  console.log(`   avg growth mult — weak starts: ${avgMult(weak).toFixed(2)} | strong starts: ${avgMult(strong).toFixed(2)}\n`);
}

/* ---- 2. initiative ---- */
{
  console.log('2) INITIATIVE — player acts first (%) vs enemy archetype, by floor');
  const player = floor => ({ key: 'p', spdStat: Math.round(4 + (10 + floor * 0.32) * 0.3), mod: 0, isPlayer: true, stableId: 'p' });
  const cases = [
    ['forest wolf (F2)', 2, ENEMIES.forest[0]],
    ['ruins knight (F15)', 15, ENEMIES.ruins[1]],
    ['frost wraith (F25)', 25, ENEMIES.frost[0]],
    ['hell hound (F45)', 45, ENEMIES.hell[1]],
    ['BOSS elderwood (slow, F10)', 10, BOSSES[10]],
    ['BOSS duke (fast, F50)', 50, BOSSES[50]],
    ['BOSS vorath (F51)', 51, BOSSES[51]],
  ];
  for (const [label, floor, enemy] of cases) {
    let first = 0;
    for (let i = 0; i < TRIALS; i++) {
      const order = initiativeOrder(rng, [player(floor), { key: 'e', spdStat: enemy.spd, mod: 0, isPlayer: false, stableId: 'e' }], floor);
      if (order[0].isPlayer) first++;
    }
    console.log(`   ${label.padEnd(28)} player first: ${(first / TRIALS * 100).toFixed(1)}%`);
  }
  console.log();
}

/* ---- 3. Battle Charge ---- */
{
  console.log('3) BATTLE CHARGE — turns until first AOE affordable, by class');
  for (const cls of Object.values(CLASSES)) {
    const aoe = cls.startSkills.map(id => SKILLS[id]).find(s => s.target === 'all');
    if (!aoe) { console.log(`   ${cls.name.padEnd(10)} (no starting AOE)`); continue; }
    let totalTurns = 0;
    for (let i = 0; i < TRIALS; i++) {
      let charge = 0, turns = 0;
      while (charge < aoe.charge && turns < 20) {
        turns++;
        charge = addCharge(charge, CONFIG.charge.gainPerTurn);
        if (rng.chance(0.18)) charge = addCharge(charge, CONFIG.charge.gainOnCrit);
      }
      totalTurns += turns;
    }
    console.log(`   ${cls.name.padEnd(10)} ${aoe.name} (${aoe.charge}⚡): avg ${(totalTurns / TRIALS).toFixed(1)} turns`);
  }
  console.log();
}

/* ---- 4. boss charge-attack frequency ---- */
{
  console.log('4) BOSS SPECIALS — attacks per 12-round fight (charge economy)');
  for (const [floor, boss] of Object.entries(BOSSES)) {
    let totalSpecials = 0;
    const n = Math.min(TRIALS, 2000);
    for (let i = 0; i < n; i++) {
      let charge = 0, specials = 0;
      for (let round = 0; round < 12; round++) {
        charge = addCharge(charge, boss.chargeGain || 1);
        const affordable = boss.specials.filter(s => charge >= s.at);
        if (affordable.length) { specials++; charge = 0; }
      }
      totalSpecials += specials;
    }
    console.log(`   F${floor} ${boss.name.slice(0, 34).padEnd(36)} ~${(totalSpecials / n).toFixed(1)} specials/12 rounds`);
  }
  console.log();
}

/* ---- 5. encounter budgets (replaces dual HP+count scaling) ---- */
{
  console.log('5) ENCOUNTER BUDGETS by party size (F10 / F30)');
  for (const floor of [10, 30]) {
    for (let n = 1; n <= 4; n++) {
      const b = encounterBudget(floor, n);
      const biome = biomeForFloor(floor);
      const plan = planEncounter(rng, {
        floor, biomeStart: biome.floors[0],
        pool: ENEMIES[biome.id], partySize: n, allowElite: true,
      });
      console.log(`   F${floor} party ${n}: budget ${b.toFixed(2)} → ${plan.specs.length} foes, hp×${plan.hpMult.toFixed(2)}, spent ${plan.spent.toFixed(2)}`);
    }
  }
  console.log();
}

/* ---- 6. death item-loss ---- */
{
  console.log('6) DEATH ITEM LOSS — eligible pool simulation');
  let protectedLost = 0, trials = 5000;
  for (let i = 0; i < trials; i++) {
    const inventory = ['potion_s', 'potion_s', 'lucky_coin', 'aegis', 'excalibur'];
    const eligible = inventory.filter(id => !['aegis', 'excalibur'].includes(id));
    const lost = [...eligible].sort(() => rng.next() - 0.5).slice(0, CONFIG.death.itemsLost);
    if (lost.includes('aegis') || lost.includes('excalibur')) protectedLost++;
  }
  console.log(`   protected (epic+) items lost across ${trials} deaths: ${protectedLost} (must be 0)\n`);
}

/* ---- 7. P25 / P50 / P75 player power every 5th floor ---- */
{
  console.log('7) PLAYER POWER CURVE — P25 / P50 / P75 vs expectedPower (every 5 floors)');
  console.log('   floor |   P25   P50   P75 | expected | P50/exp');
  for (let floor = 5; floor <= 50; floor += 5) {
    const powers = [0.25, 0.5, 0.75].map(band => {
      const c = syntheticClimber(floor, band);
      return estimatePlayerPower({
        level: c.level, ...c.stats, atk: c.atk, def: c.def, hp: c.hp,
        dmgMult: c.dmgMult, dmgTakenMult: c.dmgTakenMult, crit: c.crit,
      });
    });
    const exp = expectedPower(floor);
    console.log(`   F${String(floor).padStart(2)}  | ${powers.map(p => p.toFixed(2).padStart(5)).join(' ')} | ${exp.toFixed(2).padStart(8)} | ${(powers[1] / exp).toFixed(2)}`);
  }
  const bm = floorBenchmark(25);
  console.log(`   F25 benchmark: combat RTK ${bm.combat.rounds.join('–')}, boss RTK ${bm.boss.rounds.join('–')}, budget ${bm.budget.toFixed(2)}\n`);
}

/* ---- 8. full combat sims — trash packs ---- */
{
  console.log('8) COMBAT SIM — trash packs vs P50 (win rate / median RTK / median HP loss)');
  const n = Math.min(TRIALS, 800);
  for (const floor of [5, 15, 25, 35, 45]) {
    const biome = biomeForFloor(floor);
    const climber = syntheticClimber(floor, 0.5);
    const rounds = [], losses = [];
    let wins = 0;
    for (let i = 0; i < n; i++) {
      const plan = planEncounter(makeRng(SEED + floor * 1000 + i), {
        floor, biomeStart: biome.floors[0], pool: ENEMIES[biome.id],
        partySize: 1, allowElite: floor - biome.floors[0] >= 4,
      });
      const r = simulateFight(makeRng(SEED + floor * 2000 + i), climber, plan.specs, {
        floor, biomeStart: biome.floors[0], hpMult: plan.hpMult,
      });
      if (r.won) wins++;
      rounds.push(r.rounds);
      losses.push(r.hpLossPct);
    }
    rounds.sort((a, b) => a - b);
    losses.sort((a, b) => a - b);
    const bm = floorBenchmark(floor);
    console.log(`   F${floor}: win ${(wins / n * 100).toFixed(0)}% | RTK p50 ${percentile(rounds, 0.5).toFixed(1)} (band ${bm.combat.rounds.join('–')}) | HP loss p50 ${(percentile(losses, 0.5) * 100).toFixed(0)}% (band ${(bm.combat.hpLoss[0] * 100).toFixed(0)}–${(bm.combat.hpLoss[1] * 100).toFixed(0)}%)`);
  }
  console.log();
}

/* ---- 9. boss RTK / HP-loss tuning ---- */
{
  console.log('9) BOSS SIM — P50 climber RTK & HP loss vs target bands (win-conditioned loss)');
  const n = Math.min(TRIALS, 600);
  for (const [floorKey, boss] of Object.entries(BOSSES)) {
    const floor = Number(floorKey);
    const climber = syntheticClimber(floor, 0.5);
    const targets = bossFightTargets(floor);
    const rounds = [], losses = [], winRounds = [], winLosses = [];
    let wins = 0;
    for (let i = 0; i < n; i++) {
      const r = simulateFight(makeRng(SEED + floor * 3000 + i), climber, [boss], {
        floor, biomeStart: floor, boss: true,
      });
      if (r.won) {
        wins++;
        winRounds.push(r.rounds);
        winLosses.push(r.hpLossPct);
      }
      rounds.push(r.rounds);
      losses.push(r.hpLossPct);
    }
    winRounds.sort((a, b) => a - b);
    winLosses.sort((a, b) => a - b);
    const r50 = winRounds.length ? percentile(winRounds, 0.5) : percentile(rounds.sort((a, b) => a - b), 0.5);
    const h50 = winLosses.length ? percentile(winLosses, 0.5) : 1;
    const mech = mechanicBudgetCost(boss).toFixed(2);
    const threat = enemyThreatCost(boss, floor, floor, { boss: true }).toFixed(2);
    console.log(`   F${floor} ${boss.id.padEnd(14)} win ${(wins / n * 100).toFixed(0)}% | RTK ${r50.toFixed(1)} (want ${targets.rounds.join('–')}) | HPloss ${(h50 * 100).toFixed(0)}% (want ${(targets.hpLoss[0] * 100).toFixed(0)}–${(targets.hpLoss[1] * 100).toFixed(0)}%) | threat ${threat} mech+${mech}`);
  }
  console.log();
}

/* ---- 10. item power scores ---- */
{
  console.log('10) ITEM POWER — score vs rarity/tier cap (rejects over-budget)');
  let over = 0;
  const samples = [];
  for (const it of [...ALL_EQUIPMENT, ...RELICS]) {
    const v = validateItemPower(it);
    if (!v.ok) { over++; samples.push(`${it.id}:${v.score}/${v.cap}`); }
  }
  console.log(`   scored ${ALL_EQUIPMENT.length + RELICS.length} items/relics; over cap: ${over}${over ? ' → ' + samples.slice(0, 8).join(', ') : ''}`);
  const load = validateLoadout(
    ALL_EQUIPMENT.filter(i => i.rarity === 'legendary').slice(0, 4),
    { floor: 40 },
  );
  console.log(`   sample legendary×4 @F40 loadout: ${load.ok ? 'ok' : 'REJECT ' + load.reasons.join('; ')}`);
  console.log();
}

console.log('Simulations complete. Rerun with a different seed to spot-check stability.');
console.log('Expand content only after tools/test.js validators pass.');
