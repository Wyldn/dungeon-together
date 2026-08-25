// Scoped pack state. Temporary scopes clean up automatically.
// Persist only stable IDs and small normalized values.

import { SCOPES } from './schema.js';

export const STATE_KEYS_MAX = 48;
export const STATE_VALUE_MAX = 9999;

function bag(run) {
  if (!run.packState) {
    run.packState = {
      action: {},
      turn: {},
      combat: {},
      floor: {},
      biome: {},
      run: {},
      permanent: {},
    };
  }
  return run.packState;
}

function scopeBag(run, scope) {
  const b = bag(run);
  if (!b[scope]) b[scope] = {};
  return b[scope];
}

export function packGet(run, scope, key, fallback = undefined) {
  if (!run || !SCOPES.includes(scope)) return fallback;
  const v = run.packState?.[scope]?.[key];
  return v === undefined ? fallback : v;
}

export function packSet(run, scope, key, value) {
  if (!run || !SCOPES.includes(scope) || !key) return;
  const s = scopeBag(run, scope);
  if (value == null || value === false) {
    delete s[key];
    return;
  }
  if (typeof value === 'function') return;
  if (typeof value === 'object' && !isNormalized(value)) return;
  if (typeof value === 'number') value = Math.max(-STATE_VALUE_MAX, Math.min(STATE_VALUE_MAX, value));
  if (Object.keys(s).length >= STATE_KEYS_MAX && !(key in s)) return;
  s[key] = value;
}

export function packAdd(run, scope, key, delta) {
  const cur = Number(packGet(run, scope, key, 0)) || 0;
  packSet(run, scope, key, cur + (Number(delta) || 0));
  return packGet(run, scope, key, 0);
}

function isNormalized(v) {
  if (Array.isArray(v)) {
    return v.length <= 12 && v.every(x => typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean');
  }
  if (v && typeof v === 'object') {
    const keys = Object.keys(v);
    if (keys.length > 8) return false;
    return keys.every(k => {
      const x = v[k];
      return typeof x === 'string' || typeof x === 'number' || typeof x === 'boolean' || x == null;
    });
  }
  return true;
}

export function clearScope(run, scope) {
  if (!run?.packState) return;
  run.packState[scope] = {};
}

export function cleanupAfterAction(run) { clearScope(run, 'action'); }
export function cleanupAfterTurn(run) {
  clearScope(run, 'action');
  clearScope(run, 'turn');
}
export function cleanupAfterCombat(run) {
  clearScope(run, 'action');
  clearScope(run, 'turn');
  clearScope(run, 'combat');
}
export function cleanupAfterFloor(run) {
  cleanupAfterCombat(run);
  clearScope(run, 'floor');
}
export function cleanupAfterBiome(run) {
  cleanupAfterFloor(run);
  clearScope(run, 'biome');
}

export function persistablePackState(run) {
  const b = run?.packState;
  if (!b) return undefined;
  const out = {};
  for (const scope of ['run', 'permanent', 'biome', 'floor']) {
    const s = b[scope];
    if (s && Object.keys(s).length) out[scope] = { ...s };
  }
  return Object.keys(out).length ? out : undefined;
}

export function restorePackState(run, saved) {
  if (!run || !saved) return;
  const b = bag(run);
  for (const scope of ['run', 'permanent', 'biome', 'floor']) {
    if (saved[scope] && typeof saved[scope] === 'object') b[scope] = { ...saved[scope] };
  }
}

export function boundPackStateSize(state) {
  try {
    const raw = JSON.stringify(state || {});
    if (raw.length > 8000) return { ok: false, why: 'pack-state-too-large', bytes: raw.length };
    return { ok: true, bytes: raw.length };
  } catch {
    return { ok: false, why: 'pack-state-not-serializable' };
  }
}
