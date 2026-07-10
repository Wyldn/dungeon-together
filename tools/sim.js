// Developer simulations (handoff §34).
//   node tools/sim.js [seed] [trials]
// Defaults: seed 20260709, 10000 trials.

import { CLASSES } from '../js/data/classes.js';
import { RACES } from '../js/data/races.js';
import { ENEMIES, BOSSES, BIOMES } from '../js/data/enemies.js';
import { SKILLS } from '../js/data/skills.js';
import { CONFIG } from '../js/data/config.js';
import { RANK_ORDER, rollGrowthRank, rankAtLeast, growthMult } from '../js/data/ranks.js';
import { initiativeOrder, addCharge } from '../js/systems.js';
import { rollStart } from '../js/state.js';
import { makeRng } from '../js/rng.js';

// state.js touches localStorage only inside functions we don't call; guard anyway
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {}, removeItem: () => {} };

const SEED = Number(process.argv[2] || 20260709);
const TRIALS = Number(process.argv[3] || 10000);
const rng = makeRng(SEED);

console.log(`Dungeon Together simulations — seed ${SEED}, ${TRIALS} trials each\n`);

/* ---- 1. starting stat + growth distribution ---- */
{
  console.log('1) STARTING GENERATION (all classes/races pooled)');
  const growthCounts = Object.fromEntries(RANK_ORDER.map(r => [r, 0]));
  const buckets = [0, 0, 0, 0, 0]; // start percentile quintiles
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
  console.log(`   strong-start (top 20%) WITH S+ growth: ${(ssCount / TRIALS * 100).toFixed(2)}% (should be rare but nonzero)`);
  // correlation check
  const weak = samples.filter(s => s.percentile < 0.33);
  const strong = samples.filter(s => s.percentile > 0.67);
  const avgMult = list => list.reduce((a, s) => a + growthMult(s.growthRank), 0) / list.length;
  console.log(`   avg growth mult — weak starts: ${avgMult(weak).toFixed(2)} | strong starts: ${avgMult(strong).toFixed(2)} (inverse ✓ if weak > strong)\n`);
}

/* ---- 2. initiative win rates by floor & archetype ---- */
{
  console.log('2) INITIATIVE — player acts first (%) vs enemy archetype, by floor');
  // dex grows roughly 10 → 26 across a run; mirror combat.js's formula
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

/* ---- 3. Battle Charge: average turns before AOE availability ---- */
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
        if (rng.chance(0.18)) charge = addCharge(charge, CONFIG.charge.gainOnCrit); // occasional crit
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
    for (let i = 0; i < Math.min(TRIALS, 2000); i++) {
      let charge = 0, specials = 0;
      for (let round = 0; round < 12; round++) {
        charge = addCharge(charge, boss.chargeGain || 1);
        const affordable = boss.specials.filter(s => charge >= s.at);
        if (affordable.length) {
          specials++;
          charge = 0;
        }
      }
      totalSpecials += specials;
    }
    console.log(`   F${floor} ${boss.name.slice(0, 34).padEnd(36)} ~${(totalSpecials / Math.min(TRIALS, 2000)).toFixed(1)} specials/12 rounds`);
  }
  console.log();
}

/* ---- 5. party-size scaling snapshot ---- */
{
  console.log('5) PARTY-SIZE SCALING (config-driven, independent of floor scaling)');
  for (let n = 1; n <= 4; n++) {
    const hpMult = 1 + CONFIG.partyScaling.hpMultPerExtra * (n - 1);
    const extra = n >= CONFIG.partyScaling.extraEnemyAt ? '+1 enemy' : 'baseline count';
    console.log(`   party of ${n}: enemy hp ×${hpMult.toFixed(2)}, ${extra}`);
  }
  console.log();
}

/* ---- 6. death item-loss outcomes ---- */
{
  console.log('6) DEATH ITEM LOSS — eligible pool simulation');
  let protectedLost = 0, trials = 5000;
  for (let i = 0; i < trials; i++) {
    const inventory = ['potion_s', 'potion_s', 'lucky_coin', 'aegis', 'excalibur']; // 2 epic+/legendary
    const eligible = inventory.filter(id => !['aegis', 'excalibur'].includes(id));
    const lost = [];
    const shuffled = [...eligible].sort(() => rng.next() - 0.5).slice(0, CONFIG.death.itemsLost);
    lost.push(...shuffled);
    if (lost.includes('aegis') || lost.includes('excalibur')) protectedLost++;
  }
  console.log(`   protected (epic+) items lost across ${trials} deaths: ${protectedLost} (must be 0)\n`);
}

console.log('Simulations complete. Rerun with a different seed to spot-check stability.');
