// Multiplayer run persistence — schema, climber snapshots, and the single
// local resume slot. The Oracle relay holds the authoritative checkpoint;
// this module never treats a client blob as party truth on its own.

export const CHECKPOINT_SCHEMA = 1;
export const GAME_CONTENT_VERSION = 'dt-mp-1';
export const COOP_RESUME_KEY = 'dt_coop_resume_v1';
export const MAX_CHECKPOINT_BYTES = 200_000;

export const SAFE_PHASES = Object.freeze(['floor-ready', 'floor-resolved', 'ended']);
export const PHASE_RANK = Object.freeze({
  'floor-ready': 1,
  'floor-resolved': 2,
  ended: 9,
});

/** Monotonic id: floor * 10 + phase rank. Same floor+phase is idempotent. */
export function checkpointRevision(floor, phase) {
  const rank = PHASE_RANK[phase];
  if (rank == null) return null;
  const f = Math.max(0, Math.floor(Number(floor) || 0));
  return f * 10 + rank;
}

export function isSafePhase(phase) {
  return SAFE_PHASES.includes(phase);
}

const CLIMBER_KEYS = Object.freeze([
  'schema', 'seed', 'rngState', 'floor', 'biomeId', 'name',
  'classId', 'appearanceId', 'className', 'subclassId',
  'raceId', 'raceName', 'promoted', 'originId',
  'level', 'xp', 'xpNext', 'growthRank', 'growthBoost', 'growthRevealed',
  'fateRace', 'fateClass', 'startPercentile', 'underdog', 'appraisal',
  'stats', 'maxHp', 'hp', 'maxMp', 'mp', 'fame', 'gold',
  'skills', 'knownSkills', 'equipment', 'inventory', 'gearBag',
  'claimedWrld', 'seenEventTags', 'relics', 'consumables', 'weaponBonus',
  'flags', 'world', 'bossPicks', 'seenEvents',
  'recentCategories', 'recentNarrative', 'recentEventIds', 'recentTakenEventIds',
  'recentEncounterIds', 'recentEncounterBodies', 'recentShopItemIds',
  'lastTrialMod', 'sigils', 'kills', 'guardCount', 'bribes', 'goldEarned',
  'goldSpent', 'goldEarnedBy', 'goldSpentBy',
  'usedRevive', 'down', 'over', 'metaStartCharge',
  'foodBuff', 'climb', 'combatTaunt', 'safeFloorStreak',
  'coopMode',
]);

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function hasCombatPending(run) {
  return run?.pending?.kind === 'combat' || run?.pending?.kind === 'boss';
}

/** Drop live DOM/timers/sockets/functions and mid-combat pending. */
export function serializeClimber(run) {
  if (!run || typeof run !== 'object') return { ok: false, why: 'no-run' };
  if (hasCombatPending(run)) return { ok: false, why: 'combat-pending' };
  const src = {};
  for (const k of CLIMBER_KEYS) {
    if (run[k] !== undefined) src[k] = run[k];
  }
  src.coopMode = true;
  delete src.pending;
  let cloned;
  try { cloned = jsonClone(src); }
  catch { return { ok: false, why: 'not-serializable' }; }
  const raw = JSON.stringify(cloned);
  if (raw.length > MAX_CHECKPOINT_BYTES) return { ok: false, why: 'too-large' };
  return { ok: true, climber: cloned, bytes: raw.length };
}

export function sanitizeClimber(input) {
  if (!input || typeof input !== 'object') return { ok: false, why: 'no-climber' };
  if (hasCombatPending(input)) return { ok: false, why: 'combat-pending' };
  return serializeClimber(input);
}

export function mapsToObject(map) {
  if (!map) return {};
  if (map instanceof Map) return Object.fromEntries(map);
  if (typeof map === 'object') return { ...map };
  return {};
}

export function objectToMap(obj) {
  return new Map(Object.entries(obj || {}).map(([k, v]) => {
    const n = Number(k);
    return [Number.isInteger(n) && String(n) === k ? n : k, v];
  }));
}

export function exportSharedState(coop) {
  if (!coop) return {};
  return {
    decisionMode: coop.decisionMode || 'majority',
    floorContent: mapsToObject(coop.floorContent),
    cardResults: mapsToObject(coop.cardResults),
    eventResults: mapsToObject(coop.eventResults),
    claimedWrld: [...(coop.claimedWrld || [])],
    eliminated: [...(coop.eliminated || [])],
  };
}

export function applySharedState(coop, shared) {
  if (!coop || !shared) return;
  if (shared.decisionMode) coop.decisionMode = shared.decisionMode;
  if (shared.floorContent) {
    coop.floorContent = new Map();
    for (const [k, v] of Object.entries(shared.floorContent)) {
      const floor = Number(k);
      coop.floorContent.set(Number.isFinite(floor) ? floor : k, v);
    }
  }
  if (shared.cardResults) {
    coop.cardResults = new Map();
    for (const [k, v] of Object.entries(shared.cardResults)) {
      coop.cardResults.set(Number(k), v);
    }
  }
  if (shared.eventResults) {
    coop.eventResults = new Map(Object.entries(shared.eventResults || {}));
  }
  if (shared.claimedWrld) coop.claimedWrld = new Set(shared.claimedWrld);
  if (shared.eliminated) coop.eliminated = new Set(shared.eliminated);
}

export function applyLiveCatchup(coop, live) {
  if (!coop || !live) return;
  applySharedState(coop, live);
  if (live.picks) {
    coop.pickBuf = new Map();
    coop.pickOrder = new Map();
    for (const [floorKey, votes] of Object.entries(live.picks)) {
      const floor = Number(floorKey);
      const m = new Map(Object.entries(votes || {}));
      coop.pickBuf.set(floor, m);
      coop.pickOrder.set(floor, live.pickOrder?.[floorKey] || [...m.keys()]);
    }
  }
  if (live.evPicks) {
    coop.evPickBuf = new Map();
    coop.evPickOrder = new Map();
    for (const [key, votes] of Object.entries(live.evPicks)) {
      const m = new Map(Object.entries(votes || {}));
      coop.evPickBuf.set(key, m);
      coop.evPickOrder.set(key, live.evPickOrder?.[key] || [...m.keys()]);
    }
  }
  if (live.gates) {
    coop.gates = new Map();
    for (const [tag, ids] of Object.entries(live.gates)) {
      coop.gates.set(tag, new Set(ids || []));
    }
  }
  if (live.throne) coop.throneMsg = live.throne;
}

export function buildCheckpoint({
  runId, floor, phase, seed, shared, gameVersion = GAME_CONTENT_VERSION,
} = {}) {
  const revision = checkpointRevision(floor, phase);
  if (revision == null || !runId) return { ok: false, why: 'invalid' };
  const checkpoint = {
    schema: CHECKPOINT_SCHEMA,
    gameVersion,
    runId,
    revision,
    floor: Math.max(0, Math.floor(Number(floor) || 0)),
    phase,
    seed: seed >>> 0,
    shared: shared || {},
  };
  const raw = JSON.stringify(checkpoint);
  if (raw.length > MAX_CHECKPOINT_BYTES) return { ok: false, why: 'too-large' };
  return { ok: true, checkpoint };
}

export function validateCheckpoint(cp, { current = null, gameVersion = GAME_CONTENT_VERSION } = {}) {
  if (!cp || typeof cp !== 'object') return { ok: false, why: 'missing', code: 'unrecoverable' };
  if (cp.schema !== CHECKPOINT_SCHEMA) return { ok: false, why: 'schema', code: 'incompatible' };
  if (cp.gameVersion !== gameVersion) return { ok: false, why: 'version', code: 'incompatible' };
  if (!isSafePhase(cp.phase)) return { ok: false, why: 'unsafe-phase', code: 'unrecoverable' };
  if (!cp.runId || typeof cp.runId !== 'string') return { ok: false, why: 'runId', code: 'unrecoverable' };
  const revision = checkpointRevision(cp.floor, cp.phase);
  if (revision == null || cp.revision !== revision) return { ok: false, why: 'revision', code: 'unrecoverable' };
  if (current) {
    if (cp.runId !== current.runId) return { ok: false, why: 'run-mismatch', code: 'unrecoverable' };
    if (cp.revision < current.revision) return { ok: false, why: 'stale', code: 'stale' };
    if (cp.revision === current.revision
      && (cp.floor !== current.floor || cp.phase !== current.phase)) {
      return { ok: false, why: 'revision-conflict', code: 'stale' };
    }
  }
  return { ok: true, checkpoint: cp };
}

export function newResumeToken() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function defaultResumeMeta() {
  return {
    schema: CHECKPOINT_SCHEMA,
    gameVersion: GAME_CONTENT_VERSION,
    token: null,
    code: null,
    playerId: null,
    runId: null,
    name: null,
    floor: 0,
    revision: 0,
    status: 'empty',
    savedAt: 0,
  };
}

export function classifyResumeMeta(meta, { gameVersion = GAME_CONTENT_VERSION } = {}) {
  if (!meta) return { kind: 'none' };
  if (meta.schema !== CHECKPOINT_SCHEMA || meta.gameVersion !== gameVersion) {
    return { kind: 'incompatible', meta };
  }
  if (!meta.token || !meta.code || meta.status === 'empty') return { kind: 'none' };
  if (meta.status === 'ended' || meta.status === 'discarded') return { kind: 'none', meta };
  if (meta.status === 'unrecoverable') return { kind: 'unrecoverable', meta };
  return { kind: 'active', meta };
}

function storage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function loadCoopResume() {
  try {
    const raw = storage()?.getItem(COOP_RESUME_KEY);
    if (!raw) return null;
    const meta = { ...defaultResumeMeta(), ...JSON.parse(raw) };
    return meta;
  } catch { return null; }
}

export function saveCoopResume(meta) {
  const slot = { ...defaultResumeMeta(), ...meta, schema: CHECKPOINT_SCHEMA, savedAt: Date.now() };
  storage()?.setItem(COOP_RESUME_KEY, JSON.stringify(slot));
  return slot;
}

export function clearCoopResume() {
  try { storage()?.removeItem(COOP_RESUME_KEY); } catch {}
}

export function noteCoopResumeProgress({ floor, revision, playerId, runId, name, code, status = 'active' } = {}) {
  const prev = loadCoopResume() || defaultResumeMeta();
  if (!prev.token) return prev;
  return saveCoopResume({
    ...prev,
    floor: floor ?? prev.floor,
    revision: revision ?? prev.revision,
    playerId: playerId ?? prev.playerId,
    runId: runId ?? prev.runId,
    name: name ?? prev.name,
    code: code ?? prev.code,
    status,
  });
}

/** Fast-forward rule: keep last-safe personal state; never replay rewards. */
export function catchUpFloors(climberFloor, checkpointFloor) {
  const from = Math.max(0, Math.floor(Number(climberFloor) || 0));
  const to = Math.max(0, Math.floor(Number(checkpointFloor) || 0));
  return Math.max(0, to - from);
}

export function resumeErrorCopy(code) {
  const table = {
    expired: {
      title: 'The party is gone',
      body: 'The tower no longer holds this climb. Party memory lives on the relay process — it is forgotten if that process restarts, and it is not a permanent account save.',
    },
    incompatible: {
      title: 'Incompatible save',
      body: 'This climb was recorded with a different game version and cannot be restored safely.',
    },
    unrecoverable: {
      title: 'Unrecoverable climb',
      body: 'The saved party state is missing or corrupt. Starting again is the only safe path.',
    },
    stale: {
      title: 'Out of date',
      body: 'A newer floor of this climb already exists. The older snapshot was rejected so rewards cannot fire twice.',
    },
    taken: {
      title: 'Already climbing',
      body: 'Another tab took over this climber. Close the extra tab — only one live instance is allowed.',
    },
    'has-save': {
      title: 'A party climb is already saved',
      body: 'This browser holds one multiplayer run. Resume it, or discard it before starting another.',
    },
    combat: {
      title: 'The party is fighting',
      body: 'You cannot restore a mid-combat snapshot. Wait for the encounter to finish, then rejoin at the next safe floor.',
    },
  };
  return table[code] || table.unrecoverable;
}
