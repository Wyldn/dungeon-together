// Rank ladder (handoff §5): WRLD > EX > S > A > B > C > D > E > F.
// Thresholds are centralized and configurable.

export const RANK_ORDER = ['WRLD', 'EX', 'S', 'A', 'B', 'C', 'D', 'E', 'F'];

// min stat value for each rank (checked top-down)
export const RANK_THRESHOLDS = [
  { rank: 'WRLD', min: 71 },
  { rank: 'EX', min: 51 },
  { rank: 'S', min: 39 },
  { rank: 'A', min: 29 },
  { rank: 'B', min: 21 },
  { rank: 'C', min: 15 },
  { rank: 'D', min: 10 },
  { rank: 'E', min: 6 },
  { rank: 'F', min: 0 },
];

export function rankFor(value) {
  for (const t of RANK_THRESHOLDS) if (value >= t.min) return t.rank;
  return 'F';
}

export function rankIndex(rank) {
  return RANK_ORDER.indexOf(rank); // lower index = higher rank
}

export function rankAtLeast(rank, atLeast) {
  return rankIndex(rank) <= rankIndex(atLeast);
}

// Approximate range an appraiser reports for a stat: the true value sits
// inside a fuzzed window so exact numbers stay hidden.
export function appraisalRange(rng, value) {
  const spread = Math.max(3, Math.round(value * 0.18));
  const lo = Math.max(1, value - rng.int(1, spread));
  const hi = value + rng.int(1, spread);
  return { lo, hi, rank: rankFor(value) };
}

/* ---- growth ranks (hidden) ----
   Hidden growth potential (0.7–1.5). Mostly scales XP gained; a mild
   residue still touches level-up HP/MP/stat gains. Revealed as a rank
   only after a full (non-partial) appraisal. Common band is ~0.9–1.1
   (D–B); WRLD (1.5) is rare and tends to finish climbs at WRLD power. */
export const GROWTH_RANKS = [
  { rank: 'WRLD', mult: 1.5 },
  { rank: 'EX', mult: 1.4 },
  { rank: 'S', mult: 1.3 },
  { rank: 'A', mult: 1.2 },
  { rank: 'B', mult: 1.1 },
  { rank: 'C', mult: 1.0 },
  { rank: 'D', mult: 0.9 },
  { rank: 'E', mult: 0.8 },
  { rank: 'F', mult: 0.7 },
];

export function growthMult(rank) {
  return GROWTH_RANKS.find(g => g.rank === rank)?.mult ?? 1.0;
}

/** Mild residue of growth on level-up body gains (XP is the main lever). */
export function growthGainMult(rank, boost = 1) {
  const g = growthMult(rank) * (boost || 1);
  return 1 + (g - 1) * 0.35;
}

// Mid-start base weights (WRLD→F). Tuned so ~1% WRLD and ~70% land in
// D–B (0.9–1.1). Weak starts shift mass upward; strong starts downward.
const GROWTH_WEIGHTS = [1.0, 2.0, 4.0, 10, 22, 32, 18, 8, 3];

// Roll a hidden growth rank, inversely correlated with starting power.
// startPercentile: 0 = weakest possible start, 1 = strongest.
export function rollGrowthRank(rng, startPercentile) {
  const p = Math.max(0, Math.min(1, Number(startPercentile) || 0.5));
  // >0 for strong starts → favor worse growth (higher index)
  const shift = (p - 0.5) * 2;
  const center = 5; // C
  const items = GROWTH_WEIGHTS.map((w, i) => ({
    rank: RANK_ORDER[i],
    w: Math.max(0.01, w * Math.exp(shift * (i - center) * 0.55)),
  }));
  return rng.weighted(items).rank;
}
