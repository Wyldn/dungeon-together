// Centralized balance constants. Gameplay code reads from here — never
// hardcode these values in UI or engine code. (handoff §2, §38)

export const CONFIG = {
  /* ---- combat: Guard ----
     Reconciled with death.reviveHpPct: Guard blocks 30%; revival restores 30%.
     Do not retune one without the other — both are the same recovery fraction. */
  guard: {
    blockPct: 0.30,        // damage blocked while guarding (= revive fraction)
    chargeGain: 1,         // bonus Battle Charge for guarding
  },

  /* ---- combat: damage model ----
     Tuned so a basic attack takes 2-3 swings to fell a basic enemy, and an
     unprepared player loses roughly 40% of even-floor fights. Gear, training,
     and events are how you bend those odds. */
  combat: {
    playerStatWeight: 0.9,   // damage per point of governing stat
    playerAtkWeight: 1.5,    // damage per point of weapon atk
    playerLevelWeight: 0.8,
    playerFlat: 1,
    enemyAtkMult: 1.5,       // enemy atk → damage multiplier
    lifestealCapPct: 0.04,   // max heal per hit from any single lifesteal source
    hexTakenMult: 1.25,      // hexed targets take +25% damage
    floatMs: 1200,           // how long hit/heal numbers linger
    hitPauseMs: 340,         // pause after each skill hit so the number reads
    skillResolveMs: 950,     // pause after a full skill before the turn advances
  },

  /* ---- combat: Battle Charge ---- */
  charge: {
    displayName: 'Battle Charge', // working name — rename here, not in code
    max: 6,
    startAt: 0,
    resetAfterCombat: true,
    gainPerTurn: 1,        // passive gain per completed turn
    gainOnKill: 1,
    gainOnCrit: 1,
  },

  /* ---- defensive techniques (§6) ---- */
  // Non-basic wards/dodges last this many turns. Universal Guard is exempt
  // (it is a single-turn brace, refreshed every turn).
  defense: {
    wardTurns: 3,
    dodgeTurns: 3,
  },

  /* ---- boss discipline (§12) ---- */
  boss: {
    // Full shrug of afflictions every N of the boss's turns (not every swing).
    cleanseEvery: 4,
    // Spend this much Battle Charge to break freeze/stun early and still act.
    // Per-boss override via `cleanseCost` on the enemy def.
    cleanseCost: 2,
    chargeDamageScale: 0.14, // heavy telegraphed hits gain +14% damage per charge segment banked
  },

  /* ---- combat: initiative ---- */
  initiative: {
    die: 6,                          // + random roll 1..die
    beginnerFloors: 5,               // floors where players get a bonus
    beginnerPlayerBonus: 3,
  },

  /* ---- recovery (lean: the tower is not a spa; TDC tension dial) ---- */
  recovery: {
    levelUpMissingPct: 0.5,      // restore 50% of MISSING hp/resource on level up
    victoryHealPct: 0.05,        // % max hp after any combat win
    bossVictoryHealPct: 0.2,     // gate blessing after bosses
    floorHealPct: 0.04,          // catching your breath between floors
    floorManaPct: 0.06,          // class resource stays scarce between floors
  },

  /* ---- economy (§13: gold was too abundant; TDC tension dial) ---- */
  economy: {
    combatGoldMult: 0.7,   // combat purses trimmed — the tower is not an ATM
    merchantWeightBonus: 6, // shops appear a little more often (added to merchant event weight)
    merchantPriceMult: 1.05, // mild price pressure (used when shops price stock)
  },

  /* ---- death / revival (reconciled with guard.blockPct = 0.30) ---- */
  death: {
    reviveHpPct: 0.30,         // Phoenix Feather + co-op floor revive (shared)
    respawnHpPct: 0.30,        // co-op: rejoin next floor at this % max HP
    respawnResourcePct: 0.30,  // co-op: class resource on revive
    itemsLost: 2,              // lesser items lost on death (co-op)
    protectedRarities: ['epic', 'legendary', 'unique', 'wrld'], // never lost
  },

  /* ---- party-size (encounter budgets in js/data/balance.js own co-op threat) ----
     Legacy count/HP levers removed: stacking +enemies AND +HP double-dipped.
     Escort/minion decisions are budget leftovers, not a hard party-size gate. */
  partyScaling: {
    // kept as no-ops so older tools/scripts importing these keys don't explode
    hpMultPerExtra: 0,
    extraEnemyAt: 99,
    moreEnemyChance: 0,
    bossMinionAt: 99,
  },

  /* ---- Tower Difficulty Curve: see js/data/tdc.js ----
     Enemy/boss/party/soft-cap math lives there. Recovery & economy below
     are the primary tension dials when the climb feels too easy/hard. */

  /* ---- character generation ---- */
  chargen: {
    rerolls: 2,
    underdogPercentile: 0.32,   // bottom X of start-power rolls get comeback weighting
    comebackWeightMult: 3,
    // Monolith attunement awakening (flat bumps on top of the hidden roll)
    awakenHp: 3,
    awakenMp: 2,
    awakenStatPicks: 2,         // +1 to this many distinct combat stats
  },

  /* ---- fame ---- */
  fame: {
    start: 10,
    bribeDiscountPer10: 0.05,   // 5% cheaper bribes per 10 fame
    shopDiscountAt: 40,         // fame threshold for merchant discount
    shopDiscountPct: 0.1,
  },

  /* ---- events ---- */
  events: {
    cardsPerDraw: 3,
    // Rare alternate draws (~10% each); remainder uses cardsPerDraw
    cardsPerDrawTwoChance: 0.10,
    cardsPerDrawFourChance: 0.10,
    sparkleChance: 0.5,        // chance an affinity actually shows its shimmer
    encounterCategoryWeight: 34, // relative weight of Combat cards in draws
  },
};
