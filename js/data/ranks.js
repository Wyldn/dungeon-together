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
   Growth rank maps to a multiplier on level-up gains. */
export const GROWTH_RANKS = [
  { rank: 'WRLD', mult: 2.4 },
  { rank: 'EX', mult: 2.0 },
  { rank: 'S', mult: 1.7 },
  { rank: 'A', mult: 1.4 },
  { rank: 'B', mult: 1.2 },
  { rank: 'C', mult: 1.0 },
  { rank: 'D', mult: 0.85 },
  { rank: 'E', mult: 0.75 },
  { rank: 'F', mult: 0.65 },
];

export function growthMult(rank) {
  return GROWTH_RANKS.find(g => g.rank === rank)?.mult ?? 1.0;
}

// Roll a hidden growth rank, inversely correlated with starting power.
// startPercentile: 0 = weakest possible start, 1 = strongest.
// Bell-curve via 2 dice; strong starts shift the curve down, weak starts up.
// Rare exceptions (S start with S+ growth) remain possible but very unlikely.
export function rollGrowthRank(rng, startPercentile) {
  // triangular roll centered on C (index 5), shifted INVERSELY to start power:
  // weak starts drift toward A/S, strong starts toward D/E (handoff §6)
  const dice = rng.int(0, 2) + rng.int(0, 2); // 0..4, triangular around 2
  const inverse = Math.round((startPercentile - 0.5) * 4); // -2..+2
  let idx = 5 + (dice - 2) + inverse;
  // miracle rolls keep EX/WRLD (and strong-start S+) possible but very rare
  if (rng.chance(0.02)) idx -= 2;
  if (rng.chance(0.005)) idx -= 3;
  idx = Math.max(0, Math.min(RANK_ORDER.length - 1, idx));
  return RANK_ORDER[idx];
}
