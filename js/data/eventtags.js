// Event tags — modifiers on authored cards, not procedural story generators.
// Each event keeps its title/text/choices; tags only nudge draw weight (and
// light outcome hooks) via TAG_RULES. Compose freely; unknown tags are ignored.

/**
 * Canonical tag ids (authoring vocabulary).
 * mentor | gamble | curse | blessing | stat-test | resource-test | fame-test |
 * class-specific | origin-specific | race-specific | secret-flag | spark-for-player |
 * merchant | recovery | combat-threat | equipment | appraisal | advancement |
 * npc-duel | race-evolve | sigil | comeback
 */
export const KNOWN_EVENT_TAGS = [
  'mentor', 'gamble', 'curse', 'blessing', 'stat-test', 'resource-test', 'fame-test',
  'class-specific', 'origin-specific', 'race-specific', 'secret-flag', 'spark-for-player',
  'merchant', 'recovery', 'combat-threat', 'equipment', 'appraisal', 'advancement',
  'npc-duel', 'race-evolve', 'sigil', 'comeback',
];

/**
 * Per-tag draw-weight modifiers. Return a multiplier (1 = unchanged).
 * Rules multiply together when an event has several tags.
 */
export const TAG_RULES = {
  mentor: {
    weight(state) {
      return state.underdog ? 1.45 : 1.05;
    },
  },
  gamble: {
    weight(state) {
      const lk = state.stats?.lk || 0;
      return 1 + Math.min(0.25, lk * 0.012);
    },
  },
  curse: {
    weight(state) {
      return state.flags?.defiler ? 1.35 : 1.0;
    },
  },
  blessing: {
    weight(state) {
      return state.flags?.defiler ? 0.8 : 1.08;
    },
  },
  'stat-test': {
    weight() { return 1.0; },
  },
  'resource-test': {
    weight(state) {
      // Hungry for gold/HP events when broke or wounded
      const broke = (state.gold || 0) < 40 ? 1.15 : 1.0;
      const hurt = state.hp < state.maxHp * 0.5 ? 1.1 : 1.0;
      return broke * hurt;
    },
  },
  'fame-test': {
    weight(state) {
      const f = state.fame || 0;
      if (f >= 40) return 1.35;
      if (f >= 25) return 1.2;
      if (f < 10) return 0.75;
      return 1.0;
    },
  },
  'class-specific': {
    weight(state, event) {
      const classes = event.affinity?.classes;
      if (classes?.includes(state.classId)) return 1.45;
      if (classes?.length) return 0.82;
      return 1.0;
    },
  },
  'race-specific': {
    weight(state, event) {
      const races = event.affinity?.races;
      if (races?.includes(state.raceId)) return 1.4;
      return 1.0;
    },
  },
  'origin-specific': {
    weight(state, event) {
      if (event.affinity?.origins?.includes(state.originId)) return 1.35;
      return 1.0;
    },
  },
  'secret-flag': {
    weight() { return 1.1; },
  },
  'spark-for-player': {
    weight(state) {
      return state.coopMode ? 1.3 : 0.95;
    },
  },
  merchant: {
    weight(state) {
      return (state.gold || 0) >= 80 ? 1.12 : 0.95;
    },
  },
  recovery: {
    weight(state) {
      if (!state.maxHp) return 1;
      const ratio = state.hp / state.maxHp;
      if (ratio < 0.4) return 1.4;
      if (ratio < 0.65) return 1.15;
      return 0.9;
    },
  },
  'combat-threat': {
    weight() { return 1.0; },
  },
  equipment: {
    weight() { return 1.0; },
  },
  appraisal: {
    weight(state) {
      return state.appraisal ? 0.85 : 1.15;
    },
  },
  advancement: {
    weight(state) {
      return (state.level || 1) >= 4 ? 1.15 : 0.9;
    },
  },
  'npc-duel': {
    weight() { return 1.0; },
  },
  'race-evolve': {
    weight(state) {
      return state.flags?.race_ready || state.raceId === 'human' ? 1.2 : 1.0;
    },
  },
  sigil: {
    weight(state) {
      const n = (state.sigils || []).length;
      if (n >= 3) return 0.5;
      if (n >= 1) return 1.15;
      return 1.0;
    },
  },
  comeback: {
    weight(state) {
      return state.underdog ? 1.0 : 0.85; // comeback:true already ×3; mild damp when not underdog
    },
  },
};

/** Combined weight multiplier from an event's tags. */
export function tagWeightMult(event, state) {
  const tags = event.tags || [];
  let m = 1;
  for (const tag of tags) {
    const rule = TAG_RULES[tag];
    if (rule?.weight) m *= rule.weight(state, event) || 1;
  }
  return m;
}

/**
 * Optional light outcome nudge after a choice resolves.
 * Tags never invent new rewards — they only tint numbers already present.
 */
export function applyTagOutcomeMods(outcome, event, state) {
  if (!outcome || !event?.tags?.length) return outcome;
  const o = { ...outcome };
  const tags = event.tags;

  if (tags.includes('blessing') && typeof o.fame === 'number' && o.fame > 0) {
    o.fame += 1;
  }
  if (tags.includes('curse') && typeof o.fame === 'number' && o.fame < 0) {
    o.fame -= 1;
  }
  if (tags.includes('gamble') && o.roll && state.underdog) {
    o.roll = { ...o.roll, dc: Math.max(5, (o.roll.dc || 10) - 1) };
  }
  if (tags.includes('recovery') && typeof o.hpPct === 'number' && o.hpPct > 0) {
    o.hpPct = Math.round(o.hpPct * 1.08 * 100) / 100;
  }
  if (tags.includes('fame-test') && (state.fame || 0) >= 40 && typeof o.gold === 'number' && o.gold > 0) {
    o.gold = Math.round(o.gold * 1.1);
  }
  return o;
}
