// Content-pack kill switch and capability-family gates.
// Production default ON at Gate 7. One emergency switch disables the whole
// pack without removing catalog files: ?pack=0, localStorage dt_content_pack=0,
// or env DT_CONTENT_PACK=0. Capabilities are sequencing, not omission.

export const CONTENT_PACK_ID = 'design_council_2026';
export const CONTENT_SCHEMA_VERSION = 2;
export const GAME_CONTENT_VERSION_WITH_PACK = 'dt-mp-2';

/**
 * Production default for the whole pack (Gate 7 when on).
 * Emergency off — one switch, content stays on disk:
 *   URL `?pack=0` · localStorage `dt_content_pack=0` · env `DT_CONTENT_PACK=0`
 */
export const PACK_DEFAULT_ON = true;

export const GATE = Object.freeze({
  BASELINE: 0,
  SCHEMA: 1,
  LEGACY_MIGRATE: 2,
  FOUNDATION: 3,
  CLASS_BLOODLINE: 4,
  ADVANCED: 5,
  EVENTS: 6,
  MULTIPLAYER: 7,
});

/** Capability families. Each maps to the earliest gate that may enable it. */
export const CAPABILITIES = Object.freeze({
  schema: { gate: GATE.SCHEMA, family: 'schema' },
  state_scopes: { gate: GATE.SCHEMA, family: 'state' },
  mutex: { gate: GATE.SCHEMA, family: 'mutex' },
  legacy_mirror: { gate: GATE.LEGACY_MIGRATE, family: 'legacy' },
  simple_stat: { gate: GATE.FOUNDATION, family: 'foundation' },
  simple_hook: { gate: GATE.FOUNDATION, family: 'foundation' },
  armor_set: { gate: GATE.CLASS_BLOODLINE, family: 'sets' },
  bloodline_resonance: { gate: GATE.CLASS_BLOODLINE, family: 'resonance' },
  class_technique: { gate: GATE.CLASS_BLOODLINE, family: 'techniques' },
  class_gear: { gate: GATE.CLASS_BLOODLINE, family: 'class_gear' },
  bloodline_art: { gate: GATE.CLASS_BLOODLINE, family: 'arts' },
  curse: { gate: GATE.ADVANCED, family: 'curses' },
  curse_resolution: { gate: GATE.ADVANCED, family: 'curses' },
  evolution: { gate: GATE.ADVANCED, family: 'evolution' },
  item_instance_state: { gate: GATE.ADVANCED, family: 'instance' },
  cross_combat_memory: { gate: GATE.ADVANCED, family: 'memory' },
  echo_copy: { gate: GATE.ADVANCED, family: 'echo' },
  summon: { gate: GATE.ADVANCED, family: 'summon' },
  delayed_consequence: { gate: GATE.ADVANCED, family: 'delay' },
  intent_manipulation: { gate: GATE.ADVANCED, family: 'intent' },
  fame_gold_power: { gate: GATE.ADVANCED, family: 'currency_power' },
  resource_conversion: { gate: GATE.ADVANCED, family: 'conversion' },
  technique_borrow: { gate: GATE.ADVANCED, family: 'borrow' },
  event_linked_acquire: { gate: GATE.EVENTS, family: 'events' },
  event_chain: { gate: GATE.EVENTS, family: 'events' },
  identity_route: { gate: GATE.EVENTS, family: 'events' },
  mp_aware: { gate: GATE.MULTIPLAYER, family: 'multiplayer' },
  companion: { gate: GATE.ADVANCED, family: 'summon' },
  turn_order: { gate: GATE.MULTIPLAYER, family: 'turn_order' },
});

let forcedPack = null;
let forcedGate = null;
const forcedCaps = new Map();

/** Device/local emergency key. Same family as `?pack=` and `DT_CONTENT_PACK`. */
export const PACK_STORAGE_KEY = 'dt_content_pack';
export const PACK_GATE_STORAGE_KEY = 'dt_content_gate';

export function setPackEnabled(on) {
  forcedPack = on == null ? null : !!on;
}

export function setPackGate(n) {
  forcedGate = n == null ? null : (n | 0);
}

function parseOnOff(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === '0' || s === 'false' || s === 'off' || s === 'no') return false;
  if (s === '1' || s === 'true' || s === 'on' || s === 'yes' || s === '') return true;
  return null;
}

function urlParam(name) {
  try {
    const loc = globalThis.location;
    if (!loc || loc.search == null || loc.search === undefined) return null;
    const p = new URLSearchParams(String(loc.search));
    if (!p.has(name)) return null;
    return p.get(name);
  } catch {
    return null;
  }
}

function storageGet(key) {
  try {
    return globalThis.localStorage?.getItem(key);
  } catch {
    return null;
  }
}

export function setCapability(id, on) {
  if (on == null) forcedCaps.delete(id);
  else forcedCaps.set(id, !!on);
}

export function resetPackFlags() {
  forcedPack = null;
  forcedGate = null;
  forcedCaps.clear();
}

function envFlag(name) {
  try {
    const v = globalThis.process?.env?.[name];
    if (v === '1' || v === 'true') return true;
    if (v === '0' || v === 'false') return false;
  } catch { /* non-node */ }
  return null;
}

/**
 * Master kill switch. Default on at Gate 7.
 * Precedence: setPackEnabled() → ?pack= → localStorage dt_content_pack → DT_CONTENT_PACK → default.
 * `?pack=0` / localStorage `dt_content_pack=0` / env `DT_CONTENT_PACK=0` is the emergency off.
 */
export function isPackOn() {
  if (forcedPack != null) return forcedPack;
  const url = parseOnOff(urlParam('pack'));
  if (url != null) return url;
  const stored = parseOnOff(storageGet(PACK_STORAGE_KEY));
  if (stored != null) return stored;
  const env = envFlag('DT_CONTENT_PACK');
  if (env != null) return env;
  return PACK_DEFAULT_ON;
}

function readGatePin() {
  if (forcedGate != null) return forcedGate;
  const urlGate = urlParam('gate');
  if (urlGate != null && urlGate !== '') {
    const n = Number(urlGate);
    if (Number.isFinite(n)) return n | 0;
  }
  const stored = storageGet(PACK_GATE_STORAGE_KEY);
  if (stored != null && stored !== '') {
    const n = Number(stored);
    if (Number.isFinite(n)) return n | 0;
  }
  try {
    const env = globalThis.process?.env?.DT_CONTENT_GATE;
    if (env != null && env !== '') {
      const n = Number(env);
      if (Number.isFinite(n)) return n | 0;
    }
  } catch { /* non-node */ }
  return null;
}

/** Highest implemented gate currently armed. Pack-off → 0. Pack-on with no pin → 7. */
export function activeGate() {
  if (!isPackOn()) return GATE.BASELINE;
  const pin = readGatePin();
  if (pin != null) return pin;
  return GATE.MULTIPLAYER;
}

export function capabilityEnabled(id) {
  if (!isPackOn()) return false;
  if (forcedCaps.has(id)) return forcedCaps.get(id);
  const spec = CAPABILITIES[id];
  if (!spec) return false;
  return activeGate() >= spec.gate;
}

export function familyEnabled(family) {
  if (!isPackOn()) return false;
  return Object.entries(CAPABILITIES).some(([, spec]) => spec.family === family && activeGate() >= spec.gate);
}

export function packStatus() {
  return {
    packId: CONTENT_PACK_ID,
    schema: CONTENT_SCHEMA_VERSION,
    on: isPackOn(),
    gate: activeGate(),
    capabilities: Object.fromEntries(
      Object.keys(CAPABILITIES).map(id => [id, capabilityEnabled(id)]),
    ),
  };
}
