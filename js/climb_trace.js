// Live climb recorder. Enable with ?dev=trace. Decisions + checkpoints only.

import { climbCheckpoint } from './climb_snapshot.js';

export function createClimbRecorder(run) {
  const rec = {
    meta: {
      seed: run.seed,
      classId: run.classId,
      raceId: run.raceId,
      originId: run.originId,
      name: run.name,
      kitSeed: run.kitSeed ?? null,
    },
    decisions: [],
    checkpoints: [],
  };
  const push = (d) => { rec.decisions.push(d); };
  return {
    rec,
    card(i) { push({ t: 'card', i }); },
    approach(act) { push({ t: 'approach', act }); },
    event(choice, i) { push({ t: 'event', label: choice.id || choice.label, i }); },
    shop(act) { push({ t: 'shop', ...act }); },
    equip(act) { push({ t: 'equip', ...act }); },
    subclass(sub) { push({ t: 'subclass', id: sub.id }); },
    deepen(ok) { push({ t: 'deepen', ok }); },
    skill(sk) { push(sk ? { t: 'skill', id: sk.id } : { t: 'skill', skip: true }); },
    combatAuto() { push({ t: 'combatAuto' }); },
    throne(choice) { push({ t: 'throne', choice }); },
    waypoint(category) { push({ t: 'waypoint', category }); },
    relic(r, i) { push({ t: 'relic', id: r?.id, i }); },
    option(op, i) { push({ t: 'option', id: op?.id, i }); },
    checkpoint(runState, label) {
      rec.checkpoints.push(climbCheckpoint(runState, { label }));
    },
    dump() {
      return JSON.stringify(rec, null, 2);
    },
  };
}

export function traceEnabled() {
  if (typeof location === 'undefined') return false;
  try {
    return new URLSearchParams(location.search).get('dev') === 'trace';
  } catch {
    return false;
  }
}
