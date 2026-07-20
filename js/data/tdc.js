// Tower Difficulty Curve (TDC) — one thin control sheet for climb scaling.
// Enemy bases stay hand-authored per biome; this curve scales them by floor
// depth, applies multiplicative biome flavor, boss/party multipliers, and
// player soft caps. Tune here before sprinkling magic numbers elsewhere.

export const TDC = {
  lastFloor: 51,

  /* ---- expected relative power (global floor benchmark spine) ----
     Anchored to estimatePlayerPower(synthetic mid climber). The climb
     summary graph compares live power to this — not a win-rate promise.
     curvePow > 1 = slow early gear ramp, steeper late (shops/boss drops). */
  expected: {
    // Mild bump so “on curve” tracks fatter specials + trash ATK pads.
    powerAt1: 1.85,
    powerAt51: 9.8,
    curvePow: 1.30,
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
    base: 1.42,              // solo F1 pack ≈ this × expectedPower
    // Co-op trash threat — per-size table (linear perExtra overpunished 3p/4p AOE).
    // Fallback: solo * (1 + perExtraPlayer * (n-1)) if a size is missing.
    // Sized for body bands (2p 2–3 / 3p 3–4 / 4p 4–5), not old 4–5 swarms.
    budgetBySize: { 1: 1, 2: 1.80, 3: 2.70, 4: 3.50 },
    perExtraPlayer: 1.05,
    residualHpCap: 0.10,     // unused/overspend budget → at most ±10% HP
    residualHpFactor: 0.40,  // conversion rate |remaining|/budget → HP
    coopResidualHpScale: 0.55, // leftover→HP in co-op
    fillThreshold: 0.55,     // add another body if ≥55% of its cost remains
    swarmChance: 0.20,       // slight swarm bump (duo overhaul #23)
    swarmMaxBodies: 5,       // hard ceiling on swarm size (UI + turn-length sanity)
    bossBudgetMult: 1.35,    // bosses claim a larger slice of party budget
    bossEscortMinFrac: 0.28, // leftover must clear this before an escort spawns
    refHp: 28,               // F1 wolf hp — threat cost denominator
    refAtk: 6,
    refDef: 2,
  },

  /* ---- per-boss RTK / HP-loss overrides (tune after sims) ---- */
  bossTargets: {
    // On-curve solo: leave ~40–60% HP (hpLoss 0.40–0.60). Under-curve costs more.
    10: { rounds: [6, 11], hpLoss: [0.35, 0.60] },
    15: { rounds: [6, 11], hpLoss: [0.35, 0.60] },
    20: { rounds: [8, 13], hpLoss: [0.35, 0.58] },
    30: { rounds: [9, 14], hpLoss: [0.35, 0.58] },
    40: { rounds: [10, 15], hpLoss: [0.38, 0.62] },
    50: { rounds: [10, 16], hpLoss: [0.40, 0.65] },
    51: { rounds: [11, 16], hpLoss: [0.40, 0.70] },
  },

  /* ---- full-run survival CDF for 1p–4p (tools/run_sim.js) ----
     Same bands for every party size — co-op pads/eases keep the curve aligned.
     Re-check with `node tools/run_sim.js` after changing recovery, budgets, or boss pads. */
  clearRate: {
    // Exclusive-ish buckets: ~15% brick, ~25% medium-only, ~20% long-only, ~40% win
    // → cum: 85% medium (pass F10), 60% long (F30+), 40% clear F51.
    // Bands include ~±3pts sim noise; tools/test.js allows an extra soft pad.
    brickBy10: [0.10, 0.20],
    reach30: [0.52, 0.68],
    clear51: [0.30, 0.48],
  },

  /* ---- enemy scaling (replaces ad-hoc depth * 0.045) ----
     Commons/elites also take absolute floor pressure so a biome reset
     (depth → 0) doesn't soft-reset toughness vs a geared climber.
     Bosses stay hand-tuned via RTK sims + mild bossFloor* only. */
  enemy: {
    depthHp: 0.043,
    depthAtk: 0.0375,
    depthDef: 0.018,
    floorHp: 0.0145,
    floorAtk: 0.0065,
    // Soft late ramp (solo ~40% win); F10 brick from soloBoss* early.
    bossFloorHp: 0.0043,
    bossFloorAtk: 0.0038,
    bossAtkFullFloor: 36,
    bossAtkEarly: 0.58,
    soloBossHpFullFloor: 22,
    soloBossHpEarly: 0.51,
    soloBossAtkFullFloor: 22,
    soloBossAtkEarly: 0.57,
    soloBossChargeCap: 3,
    soloBossChargeCapFullFloor: 20,
    trashAtkFullFloor: 16,
    trashAtkEarly: 0.52,
    soloTrashAtkFullFloor: 22,
    soloTrashAtkEarly: 0.60,
    // Near pre-overhaul roles; duo feel from party pads + eventFight.
    boss: { hp: 0.86, atk: 0.54, def: 0.93 },
    common: { hp: 0.92, atk: 0.94, def: 1.0 },
    elite: { hp: 1.14, atk: 1.06, def: 1.03 },
  },

  /* ---- biome multipliers (multiplicative flavor, not additive piles) ---- */
  biome: {
    forest: { hp: 1.00, atk: 1.00, spd: 1.00, chargeGain: 1.00 },
    ruins:  { hp: 1.02, atk: 1.02, spd: 0.98, chargeGain: 1.00 },
    frost:  { hp: 1.045, atk: 1.025, spd: 0.92, chargeGain: 0.95 },
    swamp:  { hp: 1.05, atk: 1.025, spd: 0.95, chargeGain: 1.03 },
    hell:   { hp: 1.04, atk: 1.02, spd: 1.02, chargeGain: 1.03 },
    throne: { hp: 1.08, atk: 1.06, spd: 1.04, chargeGain: 1.08 },
  },

  /* ---- party levers ----
     Encounter budgets own co-op body-count / residual HP.
     Boss ATK still needs a party bump: single-target damage is diluted
     across random allies, so solo-tuned ATK feels soft in co-op. */
  party: {
    hpPerExtra: 0, // trash co-op HP lives in encounter budgets
    // Per-size boss pads so 2p–4p clear-rate CDF ≈ solo (tools/run_sim.js).
    // Mild duo ATK bump vs old 1.28/1.48/1.72 (no floor heal → keep early soft).
    // Soft early F10/F15; full pad by easeFullFloor (clear-rate CDF).
    easeFullFloor: 22,
    easeAtStart: 0.18,
    easePow: 1.15,
    aoeExp: 0.48,
    // Near pre-overhaul pads; trashAtk + eventFight carry live duo bite.
    bossAtkBySize: { 1: 1, 2: 1.26, 3: 1.46, 4: 1.66 },
    bossHpBySize: { 1: 1, 2: 1.76, 3: 2.60, 4: 3.50 },
    bossHpEaseAtStart: 0.52,
    // Co-op trash swing damage (budgets own body count).
    trashAtkBySize: { 1: 1, 2: 1.05, 3: 1.10, 4: 1.14 },
    trashAtkPerExtra: 0.05,
    // Fallbacks if a size is missing
    bossAtkPerExtra: 0.55,
    bossHpPerExtra: 1.10,
  },

  /* ---- event / mimic / NPC duel pads (off encounter budget) ---- */
  eventFight: {
    // Live co-op shared fights; headless sim uses size-1 pads per climber.
    hpBySize: { 1: 1, 2: 1.45, 3: 1.90, 4: 2.40 },
    atkBySize: { 1: 1, 2: 1.22, 3: 1.38, 4: 1.52 },
    hpPerExtra: 0.40,
    atkPerExtra: 0.18,
  },

  /* ---- stall enrage (bosses + event elites) ---- */
  enrage: {
    // Late stall check — early enrage crushed 3p/4p clear-rate CDF.
    bossAtRound: 12,
    bossAtkMult: 1.15,
    // Event elites: only if authored `enrageAtRound` (global default off — CDF).
    eventAtRound: null,
    eventAtkMult: 1.15,
  },

  /* ---- player soft caps (breadth over runaway numbers) ---- */
  // Leaner HP; DEF soak mildly nerfed so chip lands harder without F10 bricks.
  player: {
    hpSoftAfterLevel: 8,
    hpSoftFactor: 0.42,          // HP gains after L8 × this
    dmgSoftAfterLevel: 15,
    dmgLevelSoftFactor: 0.45,    // level→damage contribution beyond L15 × this
    mitigationCap: 0.65,         // max damage reduction from stacked dmgTakenMult
    // Passive DEF from level (before gear). Softens after softAfter so late
    // levels don't race the mitigation asymptote alone.
    levelDefPerLevel: 1.05,
    levelDefSoftAfter: 14,
    levelDefSoftFactor: 0.45,
  },

  /* ---- resource economy targets ---- */
  resource: {
    baseRegen: 4,                // per-turn class resource (was 3)
    wisPerRegen: 8,              // +1 regen per this much WIS
  },

  /* ---- combat reward scaling vs floor ---- */
  rewards: {
    // Higher floor scaling so real kits catch shops/XP into late climb.
    goldFloorFactor: 0.016,
    xpFloorFactor: 0.018,
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
    loadoutScoreAt1: 28,
    loadoutScoreAt51: 260,
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

/** 0..1 climb progress with late-weighted gear cadence (see TDC.expected.curvePow). */
export function expectedCurveT(floor) {
  const f = Math.max(1, Math.min(TDC.lastFloor, floor));
  const linear = (f - 1) / (TDC.lastFloor - 1);
  const pow = TDC.expected.curvePow ?? 1;
  return pow === 1 ? linear : Math.pow(linear, pow);
}

export function expectedPower(floor) {
  const t = expectedCurveT(floor);
  return TDC.expected.powerAt1 + (TDC.expected.powerAt51 - TDC.expected.powerAt1) * t;
}

function biomeMods(biomeId) {
  return TDC.biome[biomeId] || TDC.biome.forest;
}

function easeRamp(floor, fullFloor, early) {
  if (early >= 1) return 1;
  const full = fullFloor || 28;
  const t = full <= 1 ? 1 : Math.min(1, Math.max(0, (floor - 1) / (full - 1)));
  return early + (1 - early) * t;
}

/** Solo trash ATK ease (1 = no extra softener). Co-op / budgets skip this. */
export function soloTrashAtkEase(floor) {
  return easeRamp(floor, TDC.enemy.soloTrashAtkFullFloor || 22, TDC.enemy.soloTrashAtkEarly ?? 1);
}

/** Solo boss HP ease — F10 ~0.78 → full by soloBossHpFullFloor. */
export function soloBossHpEase(floor) {
  return easeRamp(floor, TDC.enemy.soloBossHpFullFloor || 28, TDC.enemy.soloBossHpEarly ?? 1);
}

/** Solo boss ATK ease — F10 ~0.74 → full by soloBossAtkFullFloor. */
export function soloBossAtkEase(floor) {
  return easeRamp(floor, TDC.enemy.soloBossAtkFullFloor || 28, TDC.enemy.soloBossAtkEarly ?? 1);
}

/**
 * How much banked charge feeds solo boss special damage.
 * Early gates were one-shotting with at:6 specials (1 + 0.14×6 = 1.84×).
 */
export function soloBossChargeForScale(floor, charge) {
  const cap = TDC.enemy.soloBossChargeCap;
  if (cap == null) return charge || 0;
  const full = TDC.enemy.soloBossChargeCapFullFloor || 22;
  if ((floor || 1) >= full) return charge || 0;
  return Math.min(charge || 0, cap);
}

/** Scale factors applied to a hand-authored enemy spec at a given floor. */
export function enemyScale(floor, biomeStart, biomeId, {
  boss = false, elite = false, partySize = 1, soloEase = true,
  /** Use elite ATK role while keeping boss HP pads (e.g. oldman_wrath). */
  eliteAtkRole = false,
} = {}) {
  const depth = Math.max(0, floor - biomeStart);
  const bio = biomeMods(biomeId);
  const role = boss
    ? TDC.enemy.boss
    : elite
      ? TDC.enemy.elite
      : (TDC.enemy.common || { hp: 1, atk: 1, def: 1 });
  const atkRole = (boss && eliteAtkRole) ? (TDC.enemy.elite || role) : role;

  let hp = (1 + depth * TDC.enemy.depthHp) * bio.hp * role.hp;
  let atk = (1 + depth * TDC.enemy.depthAtk) * bio.atk * atkRole.atk;
  let def = (1 + depth * TDC.enemy.depthDef) * role.def;
  const spd = bio.spd;
  const chargeGain = bio.chargeGain;

  if (boss) {
    hp *= 1 + (floor - 1) * TDC.enemy.bossFloorHp;
    atk *= 1 + (floor - 1) * TDC.enemy.bossFloorAtk;
    // Soften early gatekeepers; full bite by bossAtkFullFloor.
    const full = TDC.enemy.bossAtkFullFloor || 28;
    const early = TDC.enemy.bossAtkEarly ?? 0.75;
    const t = full <= 1 ? 1 : Math.min(1, Math.max(0, (floor - 1) / (full - 1)));
    atk *= early + (1 - early) * t;
    // Solo gates were overtuned vs on-curve climbers (F10 Thornbeast wipes).
    if (soloEase && (partySize || 1) <= 1) {
      hp *= soloBossHpEase(floor);
      atk *= soloBossAtkEase(floor);
    }
  } else {
    // Absolute floor pressure — biome depth alone under-tanks mid-climb commons
    hp *= 1 + (floor - 1) * (TDC.enemy.floorHp || 0);
    if (TDC.enemy.floorAtk) atk *= 1 + (floor - 1) * TDC.enemy.floorAtk;
    // Soft early trash — naked climbers have almost no DEF to soak packs.
    const full = TDC.enemy.trashAtkFullFloor || 16;
    const early = TDC.enemy.trashAtkEarly ?? 0.7;
    const t = full <= 1 ? 1 : Math.min(1, Math.max(0, (floor - 1) / (full - 1)));
    atk *= early + (1 - early) * t;
    // Solo packs focus one climber — extra early softener (co-op unchanged).
    if (soloEase && (partySize || 1) <= 1) atk *= soloTrashAtkEase(floor);
  }

  return { hp, atk, def, spd, chargeGain, depth };
}

export function partyHpMult(partySize = 1) {
  const extra = Math.max(0, (partySize || 1) - 1);
  return 1 + TDC.party.hpPerExtra * extra;
}

/** Fraction of co-op ATK/budget pad applied at this floor (ramps to 1 by easeFullFloor). */
export function partyPadEase(floor = 1) {
  const full = TDC.party.easeFullFloor || 30;
  const start = TDC.party.easeAtStart ?? 0.5;
  if (full <= 1) return 1;
  const t = Math.min(1, Math.max(0, (Math.max(1, floor) - 1) / (full - 1)));
  const pow = TDC.party.easePow ?? 1;
  return start + (1 - start) * (t ** pow);
}

function partySizePad(table, fallbackPerExtra, partySize = 1) {
  const n = Math.max(1, Math.min(4, partySize | 0));
  if (table && table[n] != null) return table[n];
  return 1 + (fallbackPerExtra || 0) * (n - 1);
}

/** Co-op boss outgoing damage mult — offsets random single-target dilution. */
export function partyBossAtkMult(partySize = 1, floor = 51) {
  const full = partySizePad(TDC.party.bossAtkBySize, TDC.party.bossAtkPerExtra, partySize);
  if (partySize <= 1 || full <= 1) return 1;
  return 1 + (full - 1) * partyPadEase(floor);
}

/** Co-op boss HP mult — keeps focus-fire fights ≥5 turns as party size grows. */
export function partyBossHpMult(partySize = 1, floor = 51) {
  const full = partySizePad(TDC.party.bossHpBySize, TDC.party.bossHpPerExtra, partySize);
  if (partySize <= 1 || full <= 1) return 1;
  // Soft early: full 2.2× at F10 felt unwinnable; still multi-turn by F28.
  const start = TDC.party.bossHpEaseAtStart ?? 0.7;
  const t = start + (1 - start) * partyPadEase(floor);
  return 1 + (full - 1) * t;
}

/** Co-op trash/elite swing damage (bodies still come from encounter budgets). */
export function partyTrashAtkMult(partySize = 1, floor = 51) {
  const full = partySizePad(TDC.party.trashAtkBySize, TDC.party.trashAtkPerExtra, partySize);
  if (partySize <= 1 || full <= 1) return 1;
  return 1 + (full - 1) * partyPadEase(floor);
}

/** Event/mimic/NPC duel HP pad by party size (off floor budget). */
export function eventFightHpMult(partySize = 1) {
  return partySizePad(TDC.eventFight?.hpBySize, TDC.eventFight?.hpPerExtra, partySize);
}

/** Event/mimic/NPC duel ATK pad by party size. */
export function eventFightAtkMult(partySize = 1) {
  return partySizePad(TDC.eventFight?.atkBySize, TDC.eventFight?.atkPerExtra, partySize);
}

/** Per-target AOE damage share in co-op — n^(-aoeExp); tuned with clearRate CDF. */
export function partyBossAoeMult(partySize = 1) {
  const n = Math.max(1, partySize | 0);
  const exp = TDC.party.aoeExp ?? 0.5;
  return n ** (-exp);
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
  return Math.max(1, Math.round(rawGain * TDC.player.hpSoftFactor));
}

/** Innate DEF from climber level (gear stacks on top; both feed applyDefense). */
export function levelDefBonus(level) {
  const lv = Math.max(1, level || 1);
  const per = TDC.player.levelDefPerLevel ?? 0.95;
  const softAfter = TDC.player.levelDefSoftAfter ?? 14;
  const softFactor = TDC.player.levelDefSoftFactor ?? 0.4;
  if (lv <= 1) return 0;
  if (lv <= softAfter) return (lv - 1) * per;
  return (softAfter - 1) * per + (lv - softAfter) * per * softFactor;
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
