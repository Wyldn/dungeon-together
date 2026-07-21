// Centralized balance constants. Gameplay code reads from here — never
// hardcode these values in UI or engine code. (handoff §2, §38)

export const CONFIG = {
  /* ---- combat: Guard ----
     Guard block % and revive HP % used to match; Guard is leaner now so chip
     sticks — revive stays a separate co-op recovery dial. */
  guard: {
    blockPct: 0.22,        // damage blocked while guarding
    chargeGain: 1,         // bonus Battle Charge for guarding
  },

  /* ---- combat: damage model ----
     Tuned so a basic attack takes 2-3 swings to fell a basic enemy, and an
     unprepared player loses roughly 40% of even-floor fights. Gear, training,
     and events are how you bend those odds. */
  combat: {
    playerStatWeight: 1.0,   // damage per point of governing stat
    playerAtkWeight: 1.45,   // damage per point of weapon atk (was 1.7)
    playerLevelWeight: 0.9,
    playerFlat: 0,           // was +2 — early basics slightly leaner
    critMult: 1.45,          // player crit damage mult (was hard-coded 1.6)
    enemyAtkMult: 1.35,      // enemy atk → damage (was 1.5; early packs overkilled)
    lifestealCapPct: 0.04,   // max heal per hit from any single lifesteal source
    hexTakenMult: 1.12,      // hexed targets take +12% damage (was +25%)
    frailTakenMult: 1.12,    // frail / tormented incoming damage
    weakenDmgMult: 0.70,     // weaken outgoing damage
    burnDmgMult: 0.85,       // burn also blunts outgoing damage (on top of DoT)
    poisonPctOnEnemy: 0.10,  // poison DoT vs enemies (% max HP / tick)
    poisonPctOnPlayer: 0.08, // poison DoT vs players
    burnPctOnEnemy: 0.055,   // burn DoT vs enemies
    burnPctOnPlayer: 0.06,   // burn DoT vs players
    poisonTurns: 3,
    burnTurns: 2,
    paralyzeTurns: 2,        // soft CC: lower initiative, still act
    paralyzeInitPenalty: 4,  // subtracted from initiative mod while paralyzed
    confuseTurns: 2,         // offensive actions risk friendly fire / whiffs
    confuseAllyHitChance: 0.55, // co-op: chance a confused attack hits an ally
    confuseSoloWhiffChance: 0.40, // solo: chance a confused attack misses entirely
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
    cleanseEvery: 3,
    // Spend this much Battle Charge to break freeze/stun early and still act.
    // Per-boss override via `cleanseCost` on the enemy def.
    cleanseCost: 1,
    // Heavy telegraphed hits gain this much damage per banked charge segment.
    // At 6 charge: 1 + 0.32×6 = 2.92× on top of special mult.
    chargeDamageScale: 0.32,
    // Chance a boss skips a light affordable special to bank toward a heavier one.
    bankChance: 0.72,
    // Bosses sometimes shrug taunt and pick freely (after taunt pool exists).
    ignoreTauntChance: 0.28,
    escortAtkMult: 1.05,     // boss-floor escorts contribute real chip in co-op
  },

  /* ---- combat: initiative ---- */
  initiative: {
    die: 6,                          // + random roll 1..die
    beginnerFloors: 3,               // mild early-climb bias only
    beginnerPlayerBonus: 1,          // bosses/fast foes can still outspeed players
  },

  /* ---- recovery (HP stays sticky; lean binds for brutal co-op) ---- */
  recovery: {
    victoryHealPct: 0.02,        // bind after wins — chip must stick
    bossVictoryHealPct: 0.08,    // gate blessing after bosses
    floorHealPct: 0.01,          // catching your breath between floors
    floorManaPct: 0.06,          // class resource stays scarce between floors
    // At fight start: restore this fraction of max class resource (capped at max).
    combatStartManaPct: 0.50,
    // Event `fullHeal` no longer tops off — restores this fraction of MISSING HP.
    eventFullHealMissingPct: 0.15,
    // Level-up: fraction of proportional fill when max HP grows.
    // 0 = keep absolute HP (no free mend from leveling).
    levelUpHpFill: 0,
  },

  /* ---- economy (§13: gold was too abundant; TDC tension dial) ---- */
  economy: {
    combatGoldMult: 0.7,   // combat purses trimmed — the tower is not an ATM
    merchantWeightBonus: 6, // shops appear a little more often (added to merchant event weight)
    merchantPriceMult: 1.05, // mild price pressure (used when shops price stock)
  },

  /* ---- death / revival (Guard block is leaner; revive is a separate dial) ---- */
  death: {
    reviveHpPct: 0.22,         // Phoenix Feather + co-op floor revive (shared)
    respawnHpPct: 0.15,        // co-op: rejoin next floor at this % max HP
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
    // ✦ star events: rare affinity shimmer (~10%). When taken, all choices are blessed.
    sparkleChance: 0.10,
    sparkle: {
      goldMult: 1.65,
      xpMult: 1.55,
      fameMult: 1.5,
      healMult: 1.3,
      // Flat blessing when a choice has little/no loot of its own
      bonusGold: 18,
      bonusXp: 14,
      bonusFame: 1,
      // Equipment / relic rolls lean harder into higher rarities
      rarityBumpChance: 0.7,
      luckBonus: 5,
    },
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
