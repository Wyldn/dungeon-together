// Tower Difficulty Curve (TDC) — one thin control sheet for climb scaling.
// Enemy bases stay hand-authored per biome; this curve scales them by floor
// depth, applies multiplicative biome flavor, boss/party multipliers, and
// player soft caps. Tune here before sprinkling magic numbers elsewhere.

export const TDC = {
  lastFloor: 51,

  /* ---- expected relative power (global floor benchmark spine) ---- */
  expected: {
    powerAt1: 1,
    powerAt51: 4.2,
  },

  /* ---- encounter outcome bands (P50 climber) ---- */
  benchmark: {
    combatRounds: [3, 5],
    bossRounds: [7, 12],
    combatHpLoss: [0.12, 0.38],
    bossHpLoss: [0.20, 0.55],
    // Floor-1 reference for estimatePlayerPower
    refHit: 12,
    refEhp: 45,
  },

  /* ---- encounter budgets (replaces stacked party HP + body count) ---- */
  budget: {
    base: 1.48,              // solo F1 pack ≈ this × expectedPower (padded with tankier commons)
    perExtraPlayer: 0.88,    // each ally adds nearly a full solo budget of threat
    residualHpCap: 0.16,     // unused/overspend budget → at most ±16% HP
    residualHpFactor: 0.55,  // conversion rate |remaining|/budget → HP
    fillThreshold: 0.55,     // add another body if ≥55% of its cost remains
    bossBudgetMult: 1.35,    // bosses claim a larger slice of party budget
    bossEscortMinFrac: 0.22, // leftover must clear this before an escort spawns
    refHp: 28,               // F1 wolf hp — threat cost denominator
    refAtk: 6,
    refDef: 2,
  },

  /* ---- per-boss RTK / HP-loss overrides (tune after sims) ---- */
  bossTargets: {
    10: { rounds: [6, 10], hpLoss: [0.15, 0.40] },
    20: { rounds: [6, 11], hpLoss: [0.18, 0.50] },
    30: { rounds: [8, 12], hpLoss: [0.20, 0.48] },
    40: { rounds: [8, 13], hpLoss: [0.22, 0.52] },
    50: { rounds: [8, 14], hpLoss: [0.25, 0.65] },
    51: { rounds: [10, 16], hpLoss: [0.30, 0.70] },
  },

  /* ---- enemy scaling (replaces ad-hoc depth * 0.045) ----
     Commons/elites also take absolute floor pressure so a biome reset
     (depth → 0) doesn't soft-reset toughness vs a geared climber.
     Bosses stay hand-tuned via RTK sims + mild bossFloor* only. */
  enemy: {
    depthHp: 0.052,
    depthAtk: 0.045,
    depthDef: 0.02,
    // Absolute floor HP for non-bosses — keeps free/low-cost hits at 2–3
    // swings on commons through mid-climb (verified vs combat_sim climbers).
    floorHp: 0.030,
    floorAtk: 0.006,
    bossFloorHp: 0.010,
    // Bosses must out-punch mimics; mild floor ATK was leaving late bosses
    // in the single digits after player DEF grew.
    bossFloorAtk: 0.014,
    // Commons sit a notch under forced mimic fights; bosses punch harder.
    boss: { hp: 1.08, atk: 1.35, def: 1.05 },
    common: { hp: 1.12, atk: 0.92, def: 1.0 },
    elite: { hp: 1.38, atk: 1.08, def: 1.05 },
  },

  /* ---- biome multipliers (multiplicative flavor, not additive piles) ---- */
  biome: {
    forest: { hp: 1.00, atk: 1.00, spd: 1.00, chargeGain: 1.00 },
    ruins:  { hp: 1.03, atk: 1.02, spd: 0.98, chargeGain: 1.00 },
    frost:  { hp: 1.05, atk: 1.03, spd: 0.92, chargeGain: 0.95 },
    swamp:  { hp: 1.07, atk: 1.04, spd: 0.95, chargeGain: 1.05 },
    hell:   { hp: 1.10, atk: 1.08, spd: 1.02, chargeGain: 1.08 },
    throne: { hp: 1.12, atk: 1.10, spd: 1.04, chargeGain: 1.12 },
  },

  /* ---- legacy party HP mult (deprecated — encounter budgets own co-op) ---- */
  party: {
    hpPerExtra: 0, // was 0.28; dual-scaling removed in favor of budgets
  },

  /* ---- player soft caps (breadth over runaway numbers) ---- */
  player: {
    hpSoftAfterLevel: 10,
    hpSoftFactor: 0.55,          // HP gains after L10 × this
    dmgSoftAfterLevel: 15,
    dmgLevelSoftFactor: 0.45,    // level→damage contribution beyond L15 × this
    mitigationCap: 0.65,         // max damage reduction from stacked dmgTakenMult
  },

  /* ---- resource economy targets ---- */
  resource: {
    baseRegen: 4,                // per-turn class resource (was 3)
    wisPerRegen: 8,              // +1 regen per this much WIS
  },

  /* ---- combat reward scaling vs floor ---- */
  rewards: {
    goldFloorFactor: 0.01,       // gold × (1 + floor × factor)
    xpFloorFactor: 0.008,
  },

  /* ---- event history (category anti-streak) ---- */
  events: {
    historyWindow: 6,
    historyRepeatPenalty: 0.55,
    historyMediumPenalty: 0.40,
    historyHeavyPenalty: 0.15,
  },

  /* ---- content validators (expand content only after these pass) ---- */
  validators: {
    itemSlack: 1.08,
    loadoutSlack: 1.12,
    loadoutScoreAt1: 35,
    loadoutScoreAt51: 220,
    maxDmgMult: 1.85,
    bossBandSlack: 0.22,
  },

  /* ---- equipment affixes (random loot only; exclusives/uniques skip) ---- */
  affix: {
    // How many affixes by rarity [min, max]
    counts: {
      common: [0, 1],
      uncommon: [1, 1],
      rare: [1, 2],
      epic: [2, 2],
      legendary: [2, 3],
      unique: [0, 0], // hand-authored — never randomly affixed
      wrld: [0, 0],
    },
    // Soft preference for leaving affix room inside the item power cap
    budgetFrac: {
      common: 0.55,
      uncommon: 0.65,
      rare: 0.75,
      epic: 0.85,
      legendary: 0.9,
      unique: 1,
      wrld: 1,
    },
    // Affix magnitude grows mildly with floor (props scale)
    floorScale: 0.012,
    // Extra affix-room fraction unlocked by late floors (0 → this)
    floorBudgetBonus: 0.15,
  },
};

export function expectedPower(floor) {
  const f = Math.max(1, Math.min(TDC.lastFloor, floor));
  const t = (f - 1) / (TDC.lastFloor - 1);
  return TDC.expected.powerAt1 + (TDC.expected.powerAt51 - TDC.expected.powerAt1) * t;
}

function biomeMods(biomeId) {
  return TDC.biome[biomeId] || TDC.biome.forest;
}

/** Scale factors applied to a hand-authored enemy spec at a given floor. */
export function enemyScale(floor, biomeStart, biomeId, { boss = false, elite = false } = {}) {
  const depth = Math.max(0, floor - biomeStart);
  const bio = biomeMods(biomeId);
  const role = boss
    ? TDC.enemy.boss
    : elite
      ? TDC.enemy.elite
      : (TDC.enemy.common || { hp: 1, atk: 1, def: 1 });

  let hp = (1 + depth * TDC.enemy.depthHp) * bio.hp * role.hp;
  let atk = (1 + depth * TDC.enemy.depthAtk) * bio.atk * role.atk;
  let def = (1 + depth * TDC.enemy.depthDef) * role.def;
  const spd = bio.spd;
  const chargeGain = bio.chargeGain;

  if (boss) {
    hp *= 1 + (floor - 1) * TDC.enemy.bossFloorHp;
    atk *= 1 + (floor - 1) * TDC.enemy.bossFloorAtk;
  } else {
    // Absolute floor pressure — biome depth alone under-tanks mid-climb commons
    hp *= 1 + (floor - 1) * (TDC.enemy.floorHp || 0);
    if (TDC.enemy.floorAtk) atk *= 1 + (floor - 1) * TDC.enemy.floorAtk;
  }

  return { hp, atk, def, spd, chargeGain, depth };
}

export function partyHpMult(partySize = 1) {
  const extra = Math.max(0, (partySize || 1) - 1);
  return 1 + TDC.party.hpPerExtra * extra;
}

export function rewardMult(floor) {
  const f = Math.max(1, floor || 1);
  return {
    gold: 1 + f * TDC.rewards.goldFloorFactor,
    xp: 1 + f * TDC.rewards.xpFloorFactor,
  };
}

/** Soft-capped level contribution to player damage. */
export function softLevelDamage(level, weight) {
  const softAfter = TDC.player.dmgSoftAfterLevel;
  const lv = Math.max(1, level || 1);
  if (lv <= softAfter) return lv * weight;
  return softAfter * weight + (lv - softAfter) * weight * TDC.player.dmgLevelSoftFactor;
}

/** Soft-cap a raw level-up HP gain once past the midpoint climb. */
export function softHpGain(level, rawGain) {
  if (level <= TDC.player.hpSoftAfterLevel) return rawGain;
  return Math.max(2, Math.round(rawGain * TDC.player.hpSoftFactor));
}

/** Cap stacked damage-taken multipliers so mitigation ≤ mitigationCap. */
export function cappedDmgTakenMult(raw) {
  const minTaken = 1 - TDC.player.mitigationCap;
  if (raw == null || Number.isNaN(raw)) return 1;
  return Math.max(minTaken, raw);
}

export function resourceRegen(wis, gearRegen = 0) {
  return TDC.resource.baseRegen
    + Math.floor((wis || 0) / TDC.resource.wisPerRegen)
    + (gearRegen || 0);
}
