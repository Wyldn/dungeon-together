// Shared milestone predicates for secret subclasses, events, relics, etc.
// Prefer these over ad-hoc lambdas when adding new unlock gates.

export const Milestone = {
  level: (n) => (run) => (run.level || 1) >= n,
  fame: (n) => (run) => (run.fame || 0) >= n,
  floor: (n) => (run) => (run.floor || 1) >= n,
  flag: (id) => (run) => !!run.flags?.[id],
  notFlag: (id) => (run) => !run.flags?.[id],
  sigil: (id) => (run) => (run.sigils || []).includes(id),
  sigilCount: (n) => (run) => (run.sigils || []).length >= n,
  race: (id) => (run) => run.raceId === id,
  classId: (id) => (run) => run.classId === id,
  hasItem: (id) => (run) => {
    const bag = [...Object.values(run.equipment || {}), ...(run.inventory || [])];
    return bag.some(x => x === id || (typeof x === 'string' && x.startsWith(id + '__')));
  },
  hasRelic: (id) => (run) => (run.relics || []).includes(id),
  eventTagSeen: (tag) => (run) => (run.seenEventTags || []).includes(tag),
  kills: (n) => (run) => (run.kills || 0) >= n,
  partySize: (n) => (run) => (run.partySize || 1) >= n,
  coop: () => (run) => !!run.coopMode,
  underdog: () => (run) => !!run.underdog,
  all: (...preds) => (run) => preds.every(p => p(run)),
  any: (...preds) => (run) => preds.some(p => p(run)),
};

/** Evaluate a milestone predicate or array of predicates (AND). */
export function checkMilestone(run, cond) {
  if (!cond) return true;
  if (typeof cond === 'function') return !!cond(run);
  if (Array.isArray(cond)) return cond.every(c => checkMilestone(run, c));
  return false;
}
