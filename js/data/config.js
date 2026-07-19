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
    playerStatWeight: 1.0,   // damage per point of governing stat
    playerAtkWeight: 1.7,    // damage per point of weapon atk
    playerLevelWeight: 0.9,
    playerFlat: 2,
    enemyAtkMult: 1.35,      // enemy atk → damage (was 1.5; early packs overkilled)
    lifestealCapPct: 0.04,   // max heal per hit from any single lifesteal source
    hexTakenMult: 1.25,      // hexed targets take +25% damage
    floatMs: 1200,           // how long hit/heal numbers linger
    hitPauseMs: 340,         // pause after each skill hit so the number reads
    skillResolveMs: 950,     // pause after a full skill before the turn advances
    /* Defense: diminishing-returns % mitigation (not flat subtract).
       mit = softCap * def / (def + k). Extra DEF past ~k softens hard. */
    defMitigationK: 10,      // inflection — half of softCap at def == k
    defMitigationCap: 0.88,  // max fraction of a hit DEF can erase
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
    beginnerFloors: 3,               // mild early-climb bias only
    beginnerPlayerBonus: 1,          // bosses/fast foes can still outspeed players
  },

  /* ---- recovery (lean: the tower is not a spa; see TDC.clearRate) ---- */
  recovery: {
    levelUpMissingPct: 0.5,      // restore 50% of MISSING hp/resource on level up
    victoryHealPct: 0.09,        // % max hp after any combat win
    bossVictoryHealPct: 0.26,    // gate blessing after bosses
    floorHealPct: 0.05,          // catching your breath between floors
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
    // Trusting fate on race/class: slight hidden level-up growth (1.03 one / 1.05 both)
    randomIdentityGrowthOne: 0.03,
    randomIdentityGrowthBoth: 0.05,
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
    // Face-down "mystery" path: hides identity; underlying draw is any eligible event
    mysteryNodeChance: 0.10,
  },

  /* ---- co-op AFK handling ----
     After this long without input, votes auto-resolve (if ≥ half the party
     already voted) and an idle climber's combat turn plays a random valid
     action. Each client polices its own turn; the host polices votes. */
  afk: {
    turnMs: 60000,
    voteMs: 60000,
    voteRecheckMs: 15000,   // if under 50% voted at the deadline, re-check this often
  },

  /* ---- skills offered as combat spoils are bought, not gifted ----
     The tower teaches nothing for free: picking a technique from a post-fight
     "take one" offer costs gold by tier. Guaranteed drops stay free. */
  skillReward: {
    costByTier: { 1: 40, 2: 85, 3: 150 },
  },

  /* ---- technique slots unlocked by clearing boss floors ----
     Wired via applySkillBreakpoints() after boss victories. */
  skillBreakpoints: [
    { floor: 30, flag: 'slots_f30', slots: 2, label: 'The Frozen Citadel falls' },
  ],
};
