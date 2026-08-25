// Device-local Compendium discovery. Never part of a climber checkpoint
// or party snapshot — other players' finds must not leak onto this device.

export const COMPENDIUM_SEEN_KEY = 'dt_compendium_seen_v1';
const MAX_IDS = 4000;

let cache = null;

function read() {
  if (cache) return cache;
  try {
    const raw = globalThis.localStorage?.getItem(COMPENDIUM_SEEN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    cache = new Set(Array.isArray(arr) ? arr.filter(id => typeof id === 'string') : []);
  } catch {
    cache = new Set();
  }
  return cache;
}

function write() {
  try {
    const ids = [...read()];
    const trimmed = ids.length > MAX_IDS ? ids.slice(-MAX_IDS) : ids;
    globalThis.localStorage?.setItem(COMPENDIUM_SEEN_KEY, JSON.stringify(trimmed));
  } catch { /* private mode / node mock */ }
}

export function reloadCompendiumSeenFromStorage() {
  cache = null;
  return read();
}

export function resetCompendiumSeen() {
  cache = new Set();
  try { globalThis.localStorage?.removeItem(COMPENDIUM_SEEN_KEY); } catch { /* */ }
}

export function noteDiscovery(id) {
  if (!id || typeof id !== 'string') return false;
  const s = read();
  if (s.has(id)) return false;
  s.add(id);
  if (typeof document !== 'undefined') write();
  return true;
}

export function persistCompendiumSeen() {
  write();
}

export function isDiscovered(id) {
  return !!id && read().has(id);
}

export function discoveredSet() {
  return new Set(read());
}

export function noteDiscoveryFromRun(run) {
  if (!run) return;
  const ids = [];
  for (const slot of Object.keys(run.equipment || {})) {
    const v = run.equipment[slot];
    if (v) ids.push(String(v).split('__')[0]);
  }
  for (const id of run.inventory || []) ids.push(String(id).split('__')[0]);
  for (const id of run.relics || []) ids.push(id);
  for (const id of run.consumables || []) ids.push(id);
  for (const id of run.knownSkills || []) ids.push(id);
  for (const id of run.skills || []) ids.push(id);
  for (const id of run.arts || []) ids.push(id);
  for (const id of run.seenEvents || []) ids.push(id);
  for (const id of ids) noteDiscovery(id);
}
