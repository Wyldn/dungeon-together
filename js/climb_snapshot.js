// Checkpoint snapshot for Simulation V2 vs live traces.
// Includes rngState. Do not omit fields from the Phase 2 assert list.

export function climbCheckpoint(run, extra = {}) {
  return {
    floor: run.floor || 0,
    rngState: run.rngState,
    hp: run.hp,
    maxHp: run.maxHp,
    mp: run.mp,
    maxMp: run.maxMp,
    gold: run.gold,
    xp: run.xp,
    xpNext: run.xpNext,
    level: run.level,
    skills: [...(run.skills || [])],
    knownSkills: [...(run.knownSkills || [])],
    equipment: { ...(run.equipment || {}) },
    relics: [...(run.relics || [])],
    consumables: [...(run.consumables || [])],
    flags: { ...(run.flags || {}) },
    knowledge: [...(run.world?.knowledge || [])],
    threads: { ...(run.world?.threads || {}) },
    seenEvents: [...(run.seenEvents || [])],
    bossPicks: { ...(run.bossPicks || {}) },
    sigils: [...(run.sigils || [])],
    subclassId: run.subclassId || null,
    combatTaunt: run.combatTaunt || 0,
    usedRevive: !!run.usedRevive,
    ...extra,
  };
}

export function climbSnapshot(run, { outcome = null, checkpoints = [] } = {}) {
  return {
    outcome,
    deathFloor: outcome === 'dead' ? run.floor : null,
    checkpoint: climbCheckpoint(run),
    checkpoints,
  };
}
