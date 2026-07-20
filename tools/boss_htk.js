// Boss HTK + HP-loss report for 1p–4p (P50 climbers, party pads applied).
//   node tools/boss_htk.js [seed] [trials]
import { BOSSES, ALT_BOSSES, BIOMES } from '../js/data/enemies.js';
import { partyBossAtkMult, partyBossHpMult } from '../js/data/tdc.js';
import { makeRng } from '../js/rng.js';
import { syntheticClimber, simulateFight, percentile } from './combat_sim.js';

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

const SEED = Number(process.argv[2] || 20260720);
const N = Number(process.argv[3] || 300);
const sizes = [1, 2, 3, 4];
const biomeName = (id) => BIOMES.find(b => b.id === id)?.name || id;

const entries = [];
for (const [fk, boss] of Object.entries(BOSSES)) entries.push({ floor: +fk, boss, alt: false });
for (const [fk, boss] of Object.entries(ALT_BOSSES)) entries.push({ floor: +fk, boss, alt: true });
entries.sort((a, b) => a.floor - b.floor || (a.alt - b.alt));

console.log(`Boss HTK + HP-loss p50 (win-conditioned) — trials/cell ${N}, seed ${SEED}`);
console.log(
  'Floor'.padEnd(6)
  + 'World'.padEnd(18)
  + 'Boss'.padEnd(26)
  + '1p HTK/HPl'.padStart(12)
  + '2p HTK/HPl'.padStart(12)
  + '3p HTK/HPl'.padStart(12)
  + '4p HTK/HPl'.padStart(12),
);

/** Collect duo (2p) HP-loss p50 per gate for the summary strip. */
const duoHpLoss = [];

for (const { floor, boss, alt } of entries) {
  const cells = [];
  for (const n of sizes) {
    const rounds = [];
    const losses = [];
    for (let i = 0; i < N; i++) {
      const party = Array.from({ length: n }, () => syntheticClimber(floor, 0.5));
      const r = simulateFight(makeRng(SEED + floor * 1000 + n * 100 + i + (alt ? 17 : 0)), party, [boss], {
        floor,
        biomeStart: floor,
        boss: true,
        hpMult: partyBossHpMult(n, floor),
        atkMult: partyBossAtkMult(n, floor),
        maxRounds: 60,
      });
      if (r.won) {
        rounds.push(r.rounds);
        losses.push(r.hpLossPct);
      }
    }
    rounds.sort((a, b) => a - b);
    losses.sort((a, b) => a - b);
    if (!rounds.length) cells.push('—/—'.padStart(12));
    else {
      const htk = percentile(rounds, 0.5).toFixed(1);
      const hpl = percentile(losses, 0.5);
      cells.push(`${htk}/${Math.round(hpl * 100)}%`.padStart(12));
      if (n === 2 && !alt) duoHpLoss.push({ floor, name: boss.name, hpl });
    }
  }
  const label = ((alt ? '(alt) ' : '') + boss.name).slice(0, 25);
  console.log(
    String(floor).padEnd(6)
    + biomeName(boss.biome).slice(0, 17).padEnd(18)
    + label.padEnd(26)
    + cells.join(''),
  );
}

if (duoHpLoss.length) {
  const avg = duoHpLoss.reduce((s, d) => s + d.hpl, 0) / duoHpLoss.length;
  console.log('\nDuo HP-loss p50 (primary bosses, fresh P50 kits):');
  console.log(
    duoHpLoss.map(d => `F${d.floor}=${Math.round(d.hpl * 100)}%`).join('  ')
    + `  | mean ${Math.round(avg * 100)}%`,
  );
}
