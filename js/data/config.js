// Centralized balance constants. Gameplay code reads from here — never
// hardcode these values in UI or engine code. (handoff §2, §38)

export const CONFIG = {
  /* ---- combat: Guard ---- */
  guard: {
    blockPct: 0.70,        // damage blocked while guarding
    chargeGain: 1,         // bonus Battle Charge for guarding
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

  /* ---- combat: initiative ---- */
  initiative: {
    die: 6,                          // + random roll 1..die
    beginnerFloors: 5,               // floors where players get a bonus
    beginnerPlayerBonus: 3,
  },

  /* ---- recovery ---- */
  recovery: {
    levelUpMissingPct: 0.5,      // restore 50% of MISSING hp/resource on level up
    victoryHealPct: 0.15,        // % max hp after any combat win
    bossVictoryHealPct: 0.35,    // extra gate blessing after bosses
    floorHealPct: 0.08,          // catching your breath between floors
    floorManaPct: 0.15,
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
    hpMultPerExtra: 0.35,     // modest hp bump per extra player
    extraEnemyAt: 2,          // party size that adds +1 enemy
    eliteChanceBonus: 0.1,    // per extra player
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
