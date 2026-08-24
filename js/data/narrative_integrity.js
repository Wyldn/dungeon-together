// Reusable narrative integrity validators.
// Catalog-level: no per-frame work. Tests and ?dev tooling import this.

import { EVENTS } from './events.js';
import { ORIGINS } from './origins.js';
import { BIOMES, BOSSES, ALT_BOSSES } from './enemies.js';
import {
  CHARACTERS, FLAG_BRIDGES, NPC_ART_TO_CHAR, charIsDead,
} from './world.js';
import { catalogNarrativeGraph, TERMINAL_STATE } from './narrative_graph.js';

export const EXCLUSIVE_FLAG_GROUPS = [
  ['saved_climber', 'left_climber'],
  ['angered_forest', 'forest_peace'],
];

export const FACE_EVENTS = {
  mira: ['wounded_adventurer', 'climber_returns', 'mira_grudge', 'mira_watch'],
  lyra: ['bard', 'bard_returns', 'bard_last_song'],
  bandit_chief: ['bandit_toll', 'bandit_gratitude', 'bandit_shop'],
  frost_climber: ['frozen_climber', 'thawed_debt'],
  channeler: ['dark_mage_meet', 'dark_mage_watch', 'scorch_colleague'],
  pathfinder: ['pathfinder_meet', 'pathfinder_watch', 'scorch_colleague'],
  northman: ['axe_northman_meet', 'axe_northman_watch', 'scorch_colleague'],
  vess: ['warm_hearth', 'v_hearth'],
  gravekeeper: ['gravekeeper_notice', 'gravekeeper_slag', 'pale_rite'],
  merchant: ['merchant', 'merchant_tab', 'bandit_shop'],
  witch: ['witch_hut', 'witch_remembers'],
  ghost_king: ['ghost_king', 'kings_favor', 'kings_usurper'],
  oathbound: ['blade_hero_meet', 'oathbound_watch', 'oathbound_gate'],
};

function asList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function biomeWindow(biome) {
  if (!biome || biome === 'any') return [1, 51];
  const spec = BIOMES.find(b => b.id === biome);
  if (!spec?.floors) return [1, 51];
  return spec.floors;
}

function whenWindow(when, base) {
  let [lo, hi] = base;
  if (!when || typeof when !== 'object') return [lo, hi];
  if (when.floorMin != null) lo = Math.max(lo, when.floorMin);
  if (when.floorMax != null) hi = Math.min(hi, when.floorMax);
  if (when.biome) {
    const [a, b] = biomeWindow(when.biome);
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
  }
  if (when.biomes?.length) {
    const lows = when.biomes.map(id => biomeWindow(id)[0]);
    const highs = when.biomes.map(id => biomeWindow(id)[1]);
    lo = Math.max(lo, Math.min(...lows));
    hi = Math.min(hi, Math.max(...highs));
  }
  return [lo, hi];
}

export function eventFloorWindow(ev) {
  return whenWindow(ev?.when, biomeWindow(ev?.biome));
}

function collectFlags(when, into = { need: [], forbid: [] }) {
  if (!when || typeof when !== 'object') return into;
  for (const id of asList(when.flag || when.flags)) into.need.push(id);
  for (const id of asList(when.notFlag || when.notFlags)) into.forbid.push(id);
  asList(when.all).forEach(w => collectFlags(w, into));
  asList(when.any).forEach(w => collectFlags(w, into));
  if (when.not) collectFlags(when.not, into);
  return into;
}

function collectKnowledge(when, into = []) {
  if (!when || typeof when !== 'object') return into;
  for (const id of asList(when.knowledge)) into.push(id);
  asList(when.all).forEach(w => collectKnowledge(w, into));
  asList(when.any).forEach(w => collectKnowledge(w, into));
  return into;
}

function collectChars(when, into = { met: [], alive: [], dead: [] }) {
  if (!when || typeof when !== 'object') return into;
  for (const id of asList(when.charMet)) into.met.push(id);
  for (const id of asList(when.charAlive)) into.alive.push(id);
  for (const id of asList(when.charDead)) into.dead.push(id);
  asList(when.all).forEach(w => collectChars(w, into));
  asList(when.any).forEach(w => collectChars(w, into));
  if (when.not) collectChars(when.not, into);
  return into;
}

function walkPatchChars(patch, ids) {
  if (patch?.char?.id) ids.add(patch.char.id);
}

function walkOutcomeChars(o, ids) {
  if (!o) return;
  walkPatchChars(o.world, ids);
  if (o.roll) {
    walkOutcomeChars(o.roll.success, ids);
    walkOutcomeChars(o.roll.fail, ids);
  }
}

/** Character ids written or required that are not in CHARACTERS. */
export function unknownCharacterIds() {
  const known = new Set(Object.keys(CHARACTERS));
  const found = new Set();
  const add = (id) => { if (id) found.add(id); };
  for (const ev of EVENTS) {
    walkPatchChars(ev.onSee, found);
    (ev.choices || []).forEach(c => walkOutcomeChars(c.outcome, found));
    (ev.variants || []).forEach(v => {
      (v.choices || []).forEach(c => walkOutcomeChars(c.outcome, found));
    });
    const chars = collectChars(ev.when);
    chars.met.concat(chars.alive, chars.dead).forEach(add);
    for (const v of ev.variants || []) {
      const vc = collectChars(v.when);
      vc.met.concat(vc.alive, vc.dead).forEach(add);
    }
  }
  for (const patch of Object.values(FLAG_BRIDGES)) walkPatchChars(patch, found);
  return [...found].filter(id => !known.has(id)).sort();
}

/**
 * Portrait art that uniquely maps to a catalog character must not stamp a different id.
 * `old_man` is shared and skipped.
 */
export function npcArtMismatches() {
  const bad = [];
  const stampIds = (ev) => {
    const ids = [];
    if (ev.onSee?.char?.id) ids.push({ id: ev.onSee.char.id, via: 'onSee' });
    for (const c of ev.choices || []) {
      if (c.outcome?.world?.char?.id) ids.push({ id: c.outcome.world.char.id, via: 'choice' });
    }
    return ids;
  };
  for (const ev of EVENTS) {
    if (!ev.npc) continue;
    const raw = typeof ev.npc === 'string' ? ev.npc : ev.npc.art;
    const expected = NPC_ART_TO_CHAR[raw];
    if (!expected) continue;
    for (const stamp of stampIds(ev)) {
      if (stamp.id !== expected) bad.push({ event: ev.id, art: raw, expected, stamped: stamp.id, via: stamp.via });
    }
  }
  return bad;
}

export function exclusiveFlagViolations(run) {
  const flags = run?.flags || {};
  return EXCLUSIVE_FLAG_GROUPS.filter(group => group.every(id => flags[id]));
}

/** Flags/knowledge a card reads that nothing in the catalog writes. */
export function danglingReaders() {
  const g = catalogNarrativeGraph();
  const originFlags = new Set(ORIGINS.flatMap(o => {
    const ids = [];
    if (o.flag) ids.push(o.flag);
    for (const c of o.choices || []) {
      if (c.outcome?.flag) ids.push(c.outcome.flag);
      for (const f of asList(c.outcome?.world?.flags)) ids.push(f);
      if (c.outcome?.world?.flag) ids.push(c.outcome.world.flag);
    }
    return ids;
  }));
  const dangling = [];
  for (const [id, sites] of Object.entries(g.flagReads)) {
    if (g.flagWrites[id] || originFlags.has(id) || FLAG_BRIDGES[id] || TERMINAL_STATE.flags[id]) continue;
    dangling.push({ id, kind: 'flag', readers: sites });
  }
  for (const [id, sites] of Object.entries(g.knowledgeReads)) {
    if (g.knowledgeWrites[id] || TERMINAL_STATE.knowledge[id]) continue;
    dangling.push({ id, kind: 'knowledge', readers: sites });
  }
  return dangling;
}

/**
 * Callbacks whose required flag cannot be obtained before the card's last legal floor.
 * `any` requirements are reachable if at least one alt has a writer in range.
 */
export function impossibleFloorPrereqs() {
  const g = catalogNarrativeGraph();
  const writerWindow = {};
  const noteWrite = (id, lo, hi) => {
    if (!writerWindow[id]) writerWindow[id] = [lo, hi];
    else {
      writerWindow[id][0] = Math.min(writerWindow[id][0], lo);
      writerWindow[id][1] = Math.max(writerWindow[id][1], hi);
    }
  };
  for (const ev of EVENTS) {
    const [lo, hi] = eventFloorWindow(ev);
    const sites = g.flagWrites;
    for (const [flag, writers] of Object.entries(sites)) {
      if (writers.some(s => s === `event ${ev.id}` || s.startsWith(`event ${ev.id} `))) {
        noteWrite(flag, lo, hi);
      }
    }
  }
  for (const origin of ORIGINS) noteWrite(origin.flag || origin.id, 0, 0);
  for (const flag of Object.keys(FLAG_BRIDGES)) {
    if (!writerWindow[flag]) noteWrite(flag, 0, 51);
  }

  const bad = [];
  for (const ev of EVENTS) {
    const [lo, hi] = eventFloorWindow(ev);
    const needed = collectFlags(ev.when).need;
    // AND flags on the top-level when (not inside any) must each be obtainable before hi
    const top = ev.when || {};
    for (const flag of asList(top.flag || top.flags)) {
      const win = writerWindow[flag];
      if (!win) {
        bad.push({ event: ev.id, flag, reason: 'no writer' });
        continue;
      }
      if (win[0] > hi) {
        bad.push({ event: ev.id, flag, reason: `writer starts F${win[0]} after reader ends F${hi}` });
      }
    }
    if (top.any) {
      const alts = asList(top.any).map(w => w.flag || w.flags).flat().filter(Boolean);
      if (alts.length && alts.every(flag => {
        const win = writerWindow[flag];
        return !win || win[0] > hi;
      })) {
        bad.push({ event: ev.id, flag: alts.join('|'), reason: 'every any-flag writer is after this card' });
      }
    }
    void needed;
    void lo;
  }

  const checkBoss = (table, label) => {
    for (const [floor, boss] of Object.entries(table || {})) {
      const f = Number(floor);
      if (!Number.isFinite(f) || !boss?.variants) continue;
      for (const v of boss.variants) {
        for (const flag of asList(v.when?.flag || v.when?.flags)) {
          const win = writerWindow[flag];
          if (win && win[0] > f) {
            bad.push({ event: `${label} F${f} ${v.id}`, flag, reason: `writer starts F${win[0]} after fight F${f}` });
          }
        }
      }
    }
  };
  checkBoss(BOSSES, 'boss');
  checkBoss(ALT_BOSSES, 'alt');
  return bad;
}

export function deadNpcFaceViolations(run) {
  const bad = [];
  for (const [charId, eventIds] of Object.entries(FACE_EVENTS)) {
    if (!charIsDead(run, charId)) continue;
    for (const id of eventIds) {
      const ev = EVENTS.find(e => e.id === id);
      if (!ev) continue;
      const chars = collectChars(ev.when);
      const gated = chars.alive.includes(charId)
        || (ev.when?.not && collectChars(ev.when.not).dead.includes(charId));
      // eligible if evalWhen would still pass death — checked by callers via eventEligible
      if (!gated && chars.met.includes(charId)) {
        bad.push({ charId, event: id, reason: 'met-only gate allows a dead face' });
      }
    }
  }
  return bad;
}

/** Legal writer exists for a card's primary flag/knowledge, and the floor window does not invert. */
export function cardReachability(evId) {
  const ev = EVENTS.find(e => e.id === evId);
  if (!ev) return { id: evId, ok: false, reason: 'missing' };
  const [lo, hi] = eventFloorWindow(ev);
  if (lo > hi) return { id: evId, ok: false, reason: `empty floor window ${lo}-${hi}` };
  const flags = collectFlags(ev.when);
  const g = catalogNarrativeGraph();
  for (const flag of asList(ev.when?.flag || ev.when?.flags)) {
    if (!g.flagWrites[flag] && !FLAG_BRIDGES[flag]) {
      return { id: evId, ok: false, reason: `flag ${flag} has no writer` };
    }
  }
  for (const k of asList(ev.when?.knowledge)) {
    if (!g.knowledgeWrites[k]) {
      return { id: evId, ok: false, reason: `knowledge ${k} has no writer` };
    }
  }
  return { id: evId, ok: true, window: [lo, hi], flags: flags.need, knowledge: collectKnowledge(ev.when) };
}

export function catalogIntegrityReport() {
  return {
    unknownCharacterIds: unknownCharacterIds(),
    npcArtMismatches: npcArtMismatches(),
    danglingReaders: danglingReaders(),
    impossibleFloorPrereqs: impossibleFloorPrereqs(),
    newCardReachability: ['v_hearth', 'thawed_debt', 'gravekeeper_slag', 'scorch_colleague', 'bandit_shop']
      .map(cardReachability),
  };
}
