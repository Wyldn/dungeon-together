// Centralized balance constants. Gameplay code reads from here — never
// hardcode these values in UI or engine code. (handoff §2, §38)

export const CONFIG = {
  /* ---- combat: Guard ---- */
  guard: {
    blockPct: 0.30,        // damage blocked while guarding
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
    cleanseEvery: 3,        // a boss shrugs off all player statuses every N of its turns
    chargeDamageScale: 0.14, // heavy telegraphed hits gain +14% damage per charge segment banked
  },

  /* ---- combat: initiative ---- */
  initiative: {
    die: 6,                          // + random roll 1..die
    beginnerFloors: 5,               // floors where players get a bonus
    beginnerPlayerBonus: 3,
  },

  /* ---- recovery (lean: the tower is not a spa) ---- */
  recovery: {
    levelUpMissingPct: 0.5,      // restore 50% of MISSING hp/resource on level up
    victoryHealPct: 0.05,        // % max hp after any combat win
    bossVictoryHealPct: 0.2,     // gate blessing after bosses
    floorHealPct: 0.04,          // catching your breath between floors
    floorManaPct: 0.07,          // class resource is deliberately scarce (§5)
  },

  /* ---- economy (§13: gold was too abundant) ---- */
  economy: {
    combatGoldMult: 0.7,   // combat purses trimmed — the tower is not an ATM
    merchantWeightBonus: 6, // shops appear a little more often (added to merchant event weight)
  },

  /* ---- multiplayer death ---- */
  death: {
    respawnHpPct: 0.25,
    respawnResourcePct: 0.25,
    itemsLost: 2,                  // lesser items lost on death (co-op)
    protectedRarities: ['epic', 'legendary'], // never lost
  },

  /* ---- party-size scaling (independent from floor scaling) ---- */
  partyScaling: {
    hpMultPerExtra: 0.3,       // modest hp bump per extra player
    extraEnemyAt: 2,           // party size that guarantees +1 enemy
    moreEnemyChance: 0.35,     // per member beyond 2: chance of yet another enemy
    bossMinionAt: 3,           // parties this large face bosses with an escort
  },

  /* ---- character generation ---- */
  chargen: {
    rerolls: 2,
    underdogPercentile: 0.32,   // bottom X of start-power rolls get comeback weighting
    comebackWeightMult: 3,
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
    sparkleChance: 0.5,        // chance an affinity actually shows its shimmer
    encounterCategoryWeight: 34, // relative weight of Combat cards in draws
  },
};
