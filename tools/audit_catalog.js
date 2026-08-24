#!/usr/bin/env node
// Read-only catalog coverage audit. Deterministic. Does not consume climb RNG.
//   node tools/audit_catalog.js

import { readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

import { EVENTS, NPC_EVENTS } from '../js/data/events.js';
import { NARRATIVE_EVENTS } from '../js/data/narrative_events.js';
import { catalogNarrativeGraph, RESERVED_CONTENT } from '../js/data/narrative_graph.js';
import { ORIGINS } from '../js/data/origins.js';
import {
  ENEMIES, BOSSES, ALT_BOSSES, SECRET_BOSS, MODIFIERS, BIOMES,
  WANDERING_ENEMIES, NPC_ENEMIES, findEnemySpec,
} from '../js/data/enemies.js';
import {
  CHARACTERS, THREADS, FACTIONS, FLAG_BRIDGES, SECRET_ROUTES,
  TENDENCIES, CHOICE_BRIDGES,
} from '../js/data/world.js';
import { CLASSES, SUBCLASSES } from '../js/data/classes.js';
import { RACES } from '../js/data/races.js';
import { SKILLS } from '../js/data/skills.js';
import {
  ALL_EQUIPMENT, RELICS, CONSUMABLES, itemById, uniqueCatalog, wrldCatalog,
} from '../js/data/items.js';
import { GALLERY_NPCS } from '../js/data/gallery_units.js';
import { isBossFloor, isTrialFloor, isCampfireFloor, isThroneFloor } from '../js/data/floorcards.js';
import { SHOP_NARRATIVE_READS } from '../js/shop.js';
import { LATE_MEMORY_READS } from '../js/data/late_memory.js';
import { THRONE_READS, THRONE_WRITES } from '../js/throne.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEST_SRC = readFileSync(join(ROOT, 'tools', 'test.js'), 'utf8');

const BOSS_FLOORS = Object.keys(BOSSES).map(Number);
const NARRATIVE_IDS = new Set((NARRATIVE_EVENTS || []).map(e => e.id));
const EVENT_BY_ID = new Map(EVENTS.map(e => [e.id, e]));
const CLASS_IDS = new Set(Object.keys(CLASSES));
const SUBCLASS_IDS = new Set(Object.keys(SUBCLASSES));
const ORIGIN_IDS = new Set(ORIGINS.map(o => o.id));
const RACE_IDS = new Set(Object.keys(RACES));
const SKILL_IDS = new Set(Object.keys(SKILLS));
const FACTION_IDS = new Set(Object.keys(FACTIONS));
const THREAD_IDS = new Set(Object.keys(THREADS));
const CHAR_IDS = new Set(Object.keys(CHARACTERS));
const TENDENCY_IDS = new Set(Object.keys(TENDENCIES));
const BIOME_IDS = new Set(BIOMES.map(b => b.id));
const SIGILS = new Set(['truth', 'sorrow', 'wrath']);

function asList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function isTravelFloor(floor) {
  return !isBossFloor(floor) && !isTrialFloor(floor) && !isCampfireFloor(floor) && !isThroneFloor(floor);
}

function biomeFloors(id) {
  const b = BIOMES.find(x => x.id === id);
  return b ? { min: b.floors[0], max: b.floors[1] } : null;
}

function parseCond(fn) {
  if (typeof fn !== 'function') return { parsed: true };
  const src = Function.prototype.toString.call(fn);
  const out = { src: src.replace(/\s+/g, ' ').trim(), parsed: true };
  const ge = src.match(/\.floor\s*>=\s*(\d+)/);
  const gt = src.match(/\.floor\s*>\s*(\d+)/);
  const le = src.match(/\.floor\s*<=\s*(\d+)/);
  const lt = src.match(/\.floor\s*<\s*(\d+)/);
  if (ge) out.floorMin = Number(ge[1]);
  if (gt) out.floorMin = Number(gt[1]) + 1;
  if (le) out.floorMax = Number(le[1]);
  if (lt) out.floorMax = Number(lt[1]) - 1;
  const fame = src.match(/\.fame\s*>=\s*(\d+)/);
  if (fame) out.fame = Number(fame[1]);
  const level = src.match(/\.level\s*>=\s*(\d+)/);
  if (level) out.level = Number(level[1]);
  if (/\.coopMode/.test(src)) out.coop = !(/!\s*\w+\.coopMode/.test(src));
  if (/\.promoted/.test(src)) out.promoted = true;
  const races = src.match(/\[([^\]]+)\]\.includes\(\w+\.raceId\)/);
  if (races) {
    out.races = races[1].split(',').map(s => s.replace(/['"\s]/g, '')).filter(Boolean);
  }
  const leftover = src
    .replace(/^\s*\w+\s*=>/, '')
    .replace(/\.floor\s*[<>=]+\s*\d+/g, '')
    .replace(/\.fame\s*[<>=]+\s*\d+/g, '')
    .replace(/\.level\s*[<>=]+\s*\d+/g, '')
    .replace(/!?\s*\w+\.coopMode/g, '')
    .replace(/!\s*\w+\.promoted/g, '')
    .replace(/\[[^\]]+\]\.includes\(\w+\.raceId\)/g, '')
    .replace(/4\s*\+\s*\(\s*i\s*%\s*3\s*\)/g, '')
    .replace(/[()&|!\s?:]/g, '');
  if (leftover) out.parsed = false;
  return out;
}

function walkWhen(when, visit) {
  if (!when || typeof when !== 'object') return;
  if (typeof when === 'function') {
    visit({ kind: 'fn' });
    return;
  }
  if (Array.isArray(when)) {
    when.forEach(w => walkWhen(w, visit));
    return;
  }
  visit({ kind: 'node', when });
  asList(when.all).forEach(w => walkWhen(w, visit));
  asList(when.any).forEach(w => walkWhen(w, visit));
  if (when.not) walkWhen(when.not, visit);
}

function collectWhenKeys(when) {
  const bag = {
    flags: new Set(), notFlags: new Set(), knowledge: new Set(), notKnowledge: new Set(),
    events: new Set(), notEvents: new Set(), chars: new Set(), threads: new Set(),
    threadStages: [], items: new Set(), classes: new Set(), subclasses: new Set(),
    origins: new Set(), races: new Set(), factions: new Set(), counters: new Set(),
    biomes: new Set(), floorMin: null, floorMax: null, fame: null, gold: null,
    kills: null, guards: null, sigilCount: null, sigils: new Set(),
    coop: null, secretEligible: new Set(), anyBranches: 0, allLeaves: 0, fn: false,
  };
  walkWhen(when, node => {
    if (node.kind === 'fn') { bag.fn = true; return; }
    const w = node.when;
    for (const id of asList(w.flag || w.flags)) bag.flags.add(id);
    for (const id of asList(w.notFlag || w.notFlags)) bag.notFlags.add(id);
    for (const id of asList(w.knowledge)) bag.knowledge.add(id);
    for (const id of asList(w.notKnowledge)) bag.notKnowledge.add(id);
    for (const id of asList(w.event || w.events)) bag.events.add(id);
    for (const id of asList(w.notEvent || w.notEvents)) bag.notEvents.add(id);
    for (const id of asList(w.charMet)) bag.chars.add(id);
    for (const id of asList(w.charAlive)) bag.chars.add(id);
    for (const id of asList(w.charDead)) bag.chars.add(id);
    if (w.charRelMin) Object.keys(w.charRelMin).forEach(id => bag.chars.add(id));
    if (w.charRelMax) Object.keys(w.charRelMax).forEach(id => bag.chars.add(id));
    if (w.factionRelMin) Object.keys(w.factionRelMin).forEach(id => bag.factions.add(id));
    if (w.factionRelMax) Object.keys(w.factionRelMax).forEach(id => bag.factions.add(id));
    if (w.counterMin) Object.keys(w.counterMin).forEach(id => bag.counters.add(id));
    if (w.thread) {
      const id = typeof w.thread === 'string' ? w.thread : w.thread.id;
      if (id) {
        bag.threads.add(id);
        const stage = typeof w.thread === 'object' ? (w.thread.stage || (w.thread.stages || [])[0]) : null;
        if (stage) bag.threadStages.push({ id, stage });
      }
    }
    if (w.threadAtLeast?.id) {
      bag.threads.add(w.threadAtLeast.id);
      if (w.threadAtLeast.stage) bag.threadStages.push({ id: w.threadAtLeast.id, stage: w.threadAtLeast.stage });
    }
    for (const id of asList(w.item)) bag.items.add(id);
    for (const id of asList(w.sigil)) bag.sigils.add(id);
    if (w.classId) bag.classes.add(w.classId);
    for (const id of asList(w.classes)) bag.classes.add(id);
    if (w.subclassId) bag.subclasses.add(w.subclassId);
    if (w.origin) bag.origins.add(w.origin);
    if (w.race) bag.races.add(w.race);
    if (w.biome) bag.biomes.add(w.biome);
    for (const id of asList(w.biomes)) bag.biomes.add(id);
    if (w.floorMin != null) bag.floorMin = bag.floorMin == null ? w.floorMin : Math.max(bag.floorMin, w.floorMin);
    if (w.floorMax != null) bag.floorMax = bag.floorMax == null ? w.floorMax : Math.min(bag.floorMax, w.floorMax);
    if (w.fame != null) bag.fame = Math.max(bag.fame || 0, w.fame);
    if (w.gold != null) bag.gold = Math.max(bag.gold || 0, w.gold);
    if (w.kills != null) bag.kills = Math.max(bag.kills || 0, w.kills);
    if (w.guards != null) bag.guards = Math.max(bag.guards || 0, w.guards);
    if (w.sigilCount != null) bag.sigilCount = Math.max(bag.sigilCount || 0, w.sigilCount);
    if (w.coop === true || w.coop === false) bag.coop = w.coop;
    for (const id of asList(w.secretEligible)) bag.secretEligible.add(id);
    if (w.any) bag.anyBranches += 1;
    const leafKeys = Object.keys(w).filter(k => !['all', 'any', 'not'].includes(k));
    if (leafKeys.length && !w.any) bag.allLeaves += leafKeys.length;
  });
  return bag;
}

function walkReward(reward, visit) {
  if (!reward || typeof reward !== 'object') return;
  visit(reward);
  for (const opt of reward.options || []) visit(opt);
  for (const g of reward.guaranteed || []) visit(g);
  for (const b of reward.bonus || []) visit(b);
}

function walkOutcome(o, visit) {
  if (!o || typeof o !== 'object') return;
  visit(o);
  if (o.world) visit(o.world);
  if (o.reward) walkReward(o.reward, visit);
  if (o.roll) {
    walkOutcome(o.success, visit);
    walkOutcome(o.fail, visit);
  }
  for (const ro of o.randomOutcome || []) walkOutcome(ro, visit);
  if (o.combat) {
    visit(o.combat);
    if (o.combat.world) visit(o.combat.world);
    walkReward(o.combat.reward, visit);
  }
}

function walkEventRefs(ev, visit) {
  walkWhen(ev.when, node => visit({ site: 'when', node }));
  walkOutcome(ev.onSee, o => visit({ site: 'onSee', o }));
  for (const c of ev.choices || []) {
    if (c.req) visit({ site: 'req', req: c.req });
    walkOutcome(c.outcome, o => visit({ site: 'outcome', o }));
  }
  for (const v of ev.variants || []) {
    walkWhen(v.when, node => visit({ site: `variant ${v.id || '?'}`, node }));
    for (const c of v.choices || []) {
      if (c.req) visit({ site: `variant ${v.id} req`, req: c.req });
      walkOutcome(c.outcome, o => visit({ site: `variant ${v.id}`, o }));
    }
  }
}

function condFloor(ev) {
  return parseCond(ev.cond);
}

function eventWindow(ev) {
  const cond = condFloor(ev);
  const when = collectWhenKeys(ev.when);
  let biomes = ev.biome && ev.biome !== 'any' ? [ev.biome] : [...when.biomes];
  if (!biomes.length) biomes = BIOMES.map(b => b.id);
  let min = 1;
  let max = 51;
  if (ev.biome && ev.biome !== 'any') {
    const bf = biomeFloors(ev.biome);
    if (bf) { min = bf.min; max = bf.max; }
  }
  if (when.biomes.size === 1 && ev.biome === 'any') {
    const bf = biomeFloors([...when.biomes][0]);
    if (bf) { min = Math.max(min, bf.min); max = Math.min(max, bf.max); }
  }
  if (when.floorMin != null) min = Math.max(min, when.floorMin);
  if (when.floorMax != null) max = Math.min(max, when.floorMax);
  if (cond.floorMin != null) min = Math.max(min, cond.floorMin);
  if (cond.floorMax != null) max = Math.min(max, cond.floorMax);
  const travel = [];
  for (let f = min; f <= max; f++) if (isTravelFloor(f)) travel.push(f);
  return { min, max, travel, biomes, cond, when };
}

function collectWriters() {
  const flags = {};
  const knowledge = {};
  const items = {};
  const chars = {};
  const threads = {};
  const events = {};
  const add = (map, id, site) => {
    if (!id) return;
    if (!map[id]) map[id] = [];
    if (!map[id].includes(site)) map[id].push(site);
  };
  const ingestPatch = (o, site, ev) => {
    if (!o) return;
    if (o.flag) add(flags, o.flag, site);
    for (const id of asList(o.flags)) add(flags, id, site);
    for (const id of asList(o.knowledge)) add(knowledge, id, site);
    if (o.unlockSecret) add(knowledge, `unlock_${o.unlockSecret}`, site);
    if (o.item) add(items, o.item, site);
    if (o.kind === 'item' && o.id) add(items, o.id, site);
    if (o.uniqueItem && typeof o.uniqueItem === 'string') add(items, o.uniqueItem, site);
    if (o.consumable) add(items, o.consumable, site);
    if (o.consumable2) add(items, o.consumable2, site);
    if (o.farmerLoot) {
      for (const id of ['farmer_hat', 'farmer_tunic', 'farmer_pants', 'farmer_sickle', 'farmer_pitchfork', 'farmer_rake']) {
        add(items, id, `${site} farmerLoot`);
      }
    }
    if (o.npcDuelLoot) add(items, '*npcDuelLoot', site);
    if (o.sigil) add(items, `sigil:${o.sigil}`, site);
    if (o.char?.id) add(chars, o.char.id, site);
    if (o.thread?.id) {
      if (!threads[o.thread.id]) threads[o.thread.id] = [];
      threads[o.thread.id].push({ site, stage: o.thread.stage || null });
    }
    if (ev?.id) add(events, ev.id, site);
  };
  for (const ev of EVENTS) {
    walkEventRefs(ev, hit => {
      if (hit.o) ingestPatch(hit.o, `event ${ev.id}`, ev);
    });
    add(events, ev.id, `event ${ev.id}`);
  }
  for (const origin of ORIGINS) {
    walkEventRefs(origin, hit => {
      if (hit.o) ingestPatch(hit.o, `origin ${origin.id}`, origin);
    });
  }
  for (const [flag, patch] of Object.entries(FLAG_BRIDGES)) {
    ingestPatch(patch, `FLAG_BRIDGES.${flag}`);
    add(flags, flag, `FLAG_BRIDGES.${flag}`);
  }
  for (const row of THRONE_WRITES.threads || []) {
    ingestPatch({ thread: row }, 'throne');
  }
  for (const id of THRONE_WRITES.chars || []) add(chars, id, 'throne');
  return { flags, knowledge, items, chars, threads, events };
}

function gateCount(whenBag, cond) {
  let n = whenBag.allLeaves;
  if (whenBag.anyBranches) n += whenBag.anyBranches;
  if (cond.fame) n++;
  if (cond.coop != null) n++;
  if (cond.promoted) n++;
  return n;
}

function classifyEvent(ev, writers) {
  const win = eventWindow(ev);
  const when = win.when;
  const cond = win.cond;
  const reasons = [];
  const type = NARRATIVE_IDS.has(ev.id) ? 'narrative-event' : 'event';
  const initiation = Object.entries(SECRET_ROUTES).find(([, spec]) => spec.initiation === ev.id);
  const isReturn = /_return$/.test(ev.id);
  const isSecret = !!initiation || isReturn || when.secretEligible.size > 0;

  if (win.min > win.max) {
    return { id: ev.id, type, bucket: 'UNREACHABLE', biome: ev.biome, floor: `${win.min}-${win.max}`,
      reasons: ['floorMin > floorMax after biome/cond intersect'], win, gates: gateCount(when, cond) };
  }
  if (!win.travel.length) {
    return { id: ev.id, type, bucket: 'UNREACHABLE', biome: ev.biome, floor: `${win.min}-${win.max}`,
      reasons: ['no travel floors in window (boss/trial/campfire only)'], win, gates: gateCount(when, cond) };
  }
  if (ev.biome && ev.biome !== 'any' && !BIOME_IDS.has(ev.biome)) {
    return { id: ev.id, type, bucket: 'UNREACHABLE', biome: ev.biome, floor: `${win.min}-${win.max}`,
      reasons: [`unknown biome ${ev.biome}`], win, gates: gateCount(when, cond) };
  }
  for (const b of when.biomes) {
    if (!BIOME_IDS.has(b)) reasons.push(`unknown when.biome ${b}`);
    if (ev.biome && ev.biome !== 'any' && b !== ev.biome) reasons.push(`when.biome ${b} ≠ event biome ${ev.biome}`);
    const bf = biomeFloors(b);
    if (bf && (win.min > bf.max || win.max < bf.min)) reasons.push(`biome ${b} incompatible with floors ${win.min}-${win.max}`);
  }
  for (const id of when.flags) {
    if (!writers.flags[id]) reasons.push(`flag ${id} has no writer`);
  }
  for (const id of when.knowledge) {
    if (!writers.knowledge[id] && !id.startsWith('unlock_')) reasons.push(`knowledge ${id} has no writer`);
  }
  for (const id of when.events) {
    if (!EVENT_BY_ID.has(id)) reasons.push(`required event ${id} is not in catalog`);
  }
  for (const id of when.chars) {
    if (!CHAR_IDS.has(id)) reasons.push(`char ${id} not in CHARACTERS`);
    else if (!writers.chars[id]) reasons.push(`char ${id} has no introduction writer`);
  }
  for (const id of when.threads) {
    if (!THREAD_IDS.has(id)) reasons.push(`thread ${id} not in THREADS`);
  }
  for (const { id, stage } of when.threadStages) {
    const stages = THREADS[id]?.stages || [];
    if (stage && !stages.includes(stage)) reasons.push(`thread ${id} has no stage ${stage}`);
    else if (stage && writers.threads[id] && !writers.threads[id].some(w => w.stage === stage)) {
      reasons.push(`thread ${id} stage ${stage} has no writer`);
    }
  }
  for (const id of when.items) {
    if (!itemById(id)) reasons.push(`item ${id} missing from catalog`);
    else if (!writers.items[id] && !CONSUMABLES.some(c => c.id === id)) reasons.push(`item ${id} has no authored grant`);
  }
  for (const id of when.classes) if (!CLASS_IDS.has(id)) reasons.push(`unknown class ${id}`);
  for (const id of when.subclasses) if (!SUBCLASS_IDS.has(id)) reasons.push(`unknown subclass ${id}`);
  for (const id of when.origins) if (!ORIGIN_IDS.has(id)) reasons.push(`unknown origin ${id}`);
  for (const id of when.races) if (!RACE_IDS.has(id)) reasons.push(`unknown race ${id}`);
  for (const id of when.factions) if (!FACTION_IDS.has(id)) reasons.push(`unknown faction ${id}`);
  for (const id of when.sigils) if (!SIGILS.has(id)) reasons.push(`unknown sigil ${id}`);

  const impossible = reasons.some(r => /no writer|not in catalog|missing from catalog|unknown |incompatible|no stage|no introduction/.test(r));
  if (impossible) {
    return { id: ev.id, type, bucket: 'UNREACHABLE', biome: ev.biome, floor: `${win.min}-${win.max} travel ${win.travel.length}`,
      reasons, win, gates: gateCount(when, cond) };
  }
  if (when.fn || (ev.cond && !cond.parsed && !cond.floorMin && !cond.floorMax && !cond.fame && cond.coop == null)) {
    return { id: ev.id, type, bucket: 'UNKNOWN', biome: ev.biome, floor: `${win.min}-${win.max}`,
      reasons: ev.cond ? [`opaque cond() ${cond.src}`] : ['function when()'], win, gates: gateCount(when, cond) };
  }

  const gates = gateCount(when, cond);
  const windowSize = win.travel.length;
  const late = win.min >= 40;
  const narrowWindow = windowSize <= 3;
  const veryNarrow = windowSize <= 2 && gates >= 2;
  const stacked = gates >= 4 || (gates >= 3 && narrowWindow);
  const lowWeightOnce = (ev.w || 0) <= 2 && ev.once && gates >= 1;

  if (veryNarrow || stacked) {
    reasons.push(veryNarrow
      ? `tiny travel window (${windowSize} floors) + ${gates} gates`
      : `${gates} stacked gates${narrowWindow ? ` in ${windowSize}-floor window` : ''}`);
    return { id: ev.id, type, bucket: 'SUSPICIOUSLY RARE', biome: ev.biome, floor: `${win.min}-${win.max} travel ${windowSize}`,
      reasons, win, gates };
  }

  if (isSecret || ev.comeback || when.coop === true || cond.coop === true
      || (when.fame || cond.fame || 0) >= 20 || (ev.w || 0) <= 2 || when.sigilCount
      || when.secretEligible.size || initiation || isReturn || late && ev.once) {
    if (!reasons.length) {
      if (isSecret) reasons.push('hidden-class / initiation path');
      else if (ev.comeback) reasons.push('underdog comeback');
      else if (when.coop === true || cond.coop === true) reasons.push('coop-only');
      else if ((when.fame || cond.fame || 0) >= 20) reasons.push('high fame gate');
      else if ((ev.w || 0) <= 2) reasons.push(`authored weight ${ev.w}`);
      else if (late) reasons.push('late-game once');
    }
    return { id: ev.id, type, bucket: 'RARE BY DESIGN', biome: ev.biome, floor: `${win.min}-${win.max}`,
      reasons, win, gates };
  }

  if (lowWeightOnce && gates >= 2) {
    return { id: ev.id, type, bucket: 'SUSPICIOUSLY RARE', biome: ev.biome, floor: `${win.min}-${win.max}`,
      reasons: [`once + w=${ev.w} + ${gates} gates`], win, gates };
  }

  return { id: ev.id, type, bucket: 'HEALTHY', biome: ev.biome, floor: `${win.min}-${win.max} travel ${windowSize}`,
    reasons, win, gates };
}

function duplicateIds(list, label) {
  const seen = new Map();
  const dups = [];
  for (const row of list) {
    const id = row.id;
    if (!id) continue;
    if (seen.has(id)) dups.push({ id, type: label, sites: [seen.get(id), row.name || row.title || id] });
    else seen.set(id, row.name || row.title || id);
  }
  return dups;
}

function similarTitles() {
  const byTitle = new Map();
  for (const ev of EVENTS) {
    const key = (ev.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!key) continue;
    if (!byTitle.has(key)) byTitle.set(key, []);
    byTitle.get(key).push(ev.id);
  }
  return [...byTitle.entries()].filter(([, ids]) => ids.length > 1).map(([title, ids]) => ({ title, ids }));
}

function gatherDangling(writers) {
  const dangling = [];
  const add = (row) => dangling.push(row);

  for (const ev of EVENTS) {
    walkEventRefs(ev, hit => {
      if (hit.node?.kind === 'node') {
        const w = hit.node.when;
        for (const id of asList(w.event || w.events)) {
          if (!EVENT_BY_ID.has(id)) add({ from: ev.id, kind: 'event', id, site: hit.site });
        }
        for (const id of asList(w.item)) {
          if (!itemById(id)) add({ from: ev.id, kind: 'item', id, site: hit.site });
        }
        for (const id of asList(w.classId ? [w.classId] : w.classes)) {
          if (id && !CLASS_IDS.has(id)) add({ from: ev.id, kind: 'class', id, site: hit.site });
        }
        for (const id of asList(w.origin)) {
          if (!ORIGIN_IDS.has(id)) add({ from: ev.id, kind: 'origin', id, site: hit.site });
        }
        if (w.thread) {
          const id = typeof w.thread === 'string' ? w.thread : w.thread.id;
          if (id && !THREAD_IDS.has(id)) add({ from: ev.id, kind: 'thread', id, site: hit.site });
        }
        if (w.threadAtLeast?.id && !THREAD_IDS.has(w.threadAtLeast.id)) {
          add({ from: ev.id, kind: 'thread', id: w.threadAtLeast.id, site: hit.site });
        }
        for (const id of asList(w.charMet).concat(asList(w.charAlive), asList(w.charDead))) {
          if (!CHAR_IDS.has(id)) add({ from: ev.id, kind: 'char', id, site: hit.site });
        }
      }
      if (hit.req) {
        if (hit.req.item && !itemById(hit.req.item)) add({ from: ev.id, kind: 'item', id: hit.req.item, site: hit.site });
        if (hit.req.class && !CLASS_IDS.has(hit.req.class)) add({ from: ev.id, kind: 'class', id: hit.req.class, site: hit.site });
        if (hit.req.sigil && !SIGILS.has(hit.req.sigil)) add({ from: ev.id, kind: 'sigil', id: hit.req.sigil, site: hit.site });
      }
      if (hit.o) {
        if (hit.o.item && !itemById(hit.o.item)) add({ from: ev.id, kind: 'item', id: hit.o.item, site: hit.site });
        if (hit.o.consumable && !itemById(hit.o.consumable)) add({ from: ev.id, kind: 'consumable', id: hit.o.consumable, site: hit.site });
        if (hit.o.consumable2 && !itemById(hit.o.consumable2)) add({ from: ev.id, kind: 'consumable', id: hit.o.consumable2, site: hit.site });
        if (hit.o.learnSkill && !SKILL_IDS.has(hit.o.learnSkill)) add({ from: ev.id, kind: 'skill', id: hit.o.learnSkill, site: hit.site });
        if (hit.o.kind === 'item' && hit.o.id && !itemById(hit.o.id)) add({ from: ev.id, kind: 'item', id: hit.o.id, site: hit.site });
        if (hit.o.kind === 'skill' && hit.o.id && !SKILL_IDS.has(hit.o.id)) add({ from: ev.id, kind: 'skill', id: hit.o.id, site: hit.site });
        for (const eid of hit.o.enemies || hit.o.combat?.enemies || hit.o.pickEnemies?.pool || []) {
          if (!findEnemySpec(eid)) add({ from: ev.id, kind: 'enemy', id: eid, site: hit.site });
        }
        if (hit.o.char?.id && !CHAR_IDS.has(hit.o.char.id)) add({ from: ev.id, kind: 'char', id: hit.o.char.id, site: hit.site });
        if (hit.o.thread?.id && !THREAD_IDS.has(hit.o.thread.id)) add({ from: ev.id, kind: 'thread', id: hit.o.thread.id, site: hit.site });
        if (hit.o.faction?.id && !FACTION_IDS.has(hit.o.faction.id)) add({ from: ev.id, kind: 'faction', id: hit.o.faction.id, site: hit.site });
        if (hit.o.unlockSecret && !SECRET_ROUTES[hit.o.unlockSecret]) add({ from: ev.id, kind: 'secret', id: hit.o.unlockSecret, site: hit.site });
      }
    });
  }

  for (const [eventId] of Object.entries(CHOICE_BRIDGES)) {
    if (!EVENT_BY_ID.has(eventId)) add({ from: `CHOICE_BRIDGES.${eventId}`, kind: 'event', id: eventId, site: 'choice bridge' });
  }
  for (const [id, spec] of Object.entries(SECRET_ROUTES)) {
    if (!EVENT_BY_ID.has(spec.initiation)) add({ from: `SECRET_ROUTES.${id}`, kind: 'event', id: spec.initiation, site: 'initiation' });
  }
  for (const cls of Object.values(CLASSES)) {
    if (cls.startWeapon && !itemById(cls.startWeapon)) add({ from: `CLASSES.${cls.id}`, kind: 'item', id: cls.startWeapon, site: 'startWeapon' });
    for (const sid of cls.startSkills || []) {
      if (!SKILL_IDS.has(sid)) add({ from: `CLASSES.${cls.id}`, kind: 'skill', id: sid, site: 'startSkills' });
    }
  }
  for (const sub of Object.values(SUBCLASSES)) {
    if (sub.skill && !SKILL_IDS.has(sub.skill)) add({ from: `SUBCLASSES.${sub.id}`, kind: 'skill', id: sub.skill, site: 'skill' });
    if (sub.parent && !CLASS_IDS.has(sub.parent) && !SUBCLASS_IDS.has(sub.parent)) {
      add({ from: `SUBCLASSES.${sub.id}`, kind: 'class', id: sub.parent, site: 'parent' });
    }
  }

  return dangling;
}

function overBroadEvents() {
  return EVENTS.filter(ev => {
    if (ev.biome !== 'any') return false;
    if (ev.when || ev.cond) return false;
    if (ev.once) return false;
    if (NARRATIVE_IDS.has(ev.id)) return false;
    return (ev.w || 0) >= 6;
  }).map(ev => ({ id: ev.id, w: ev.w, category: ev.category }));
}

function overNarrowEvents(classified) {
  return classified.filter(c => {
    if (c.bucket === 'UNREACHABLE') return false;
    const travel = c.win?.travel?.length || 0;
    return (travel <= 3 && c.gates >= 2) || c.gates >= 4;
  });
}

function contentByBiome() {
  const rows = {};
  for (const b of BIOMES) {
    rows[b.id] = {
      floors: `${b.floors[0]}–${b.floors[1]}`,
      events: 0, narrative: 0, rare: 0, npcBeats: 0, enemies: (ENEMIES[b.id] || []).length,
      bosses: 0, travelFloors: 0,
    };
    for (let f = b.floors[0]; f <= b.floors[1]; f++) if (isTravelFloor(f)) rows[b.id].travelFloors++;
  }
  rows.any = { floors: '1–51', events: 0, narrative: 0, rare: 0, npcBeats: 0, enemies: WANDERING_ENEMIES.length, bosses: 0, travelFloors: 0 };
  for (const ev of EVENTS) {
    const key = ev.biome && ev.biome !== 'any' ? ev.biome : 'any';
    if (!rows[key]) continue;
    rows[key].events++;
    if (NARRATIVE_IDS.has(ev.id)) rows[key].narrative++;
    if ((ev.w || 0) <= 3 || ev.once) rows[key].rare++;
    if (ev.npc || ev.family) rows[key].npcBeats++;
  }
  for (const [floor, boss] of Object.entries(BOSSES)) {
    const b = BIOMES.find(x => Number(floor) >= x.floors[0] && Number(floor) <= x.floors[1]);
    if (b) rows[b.id].bosses++;
    void boss;
  }
  return rows;
}

function contentByFloorBand(classified) {
  const bands = [
    { id: 'F1–10', min: 1, max: 10 },
    { id: 'F11–20', min: 11, max: 20 },
    { id: 'F21–30', min: 21, max: 30 },
    { id: 'F31–40', min: 31, max: 40 },
    { id: 'F41–51', min: 41, max: 51 },
  ];
  return bands.map(band => {
    const hits = classified.filter(c => {
      const a = c.win?.min ?? 1;
      const b = c.win?.max ?? 51;
      return a <= band.max && b >= band.min;
    });
    const travel = [];
    for (let f = band.min; f <= band.max; f++) if (isTravelFloor(f)) travel.push(f);
    return {
      id: band.id,
      events: hits.length,
      healthy: hits.filter(c => c.bucket === 'HEALTHY').length,
      rare: hits.filter(c => c.bucket === 'RARE BY DESIGN').length,
      suspicious: hits.filter(c => c.bucket === 'SUSPICIOUSLY RARE').length,
      unreachable: hits.filter(c => c.bucket === 'UNREACHABLE').length,
      travelFloors: travel.length,
    };
  });
}

function npcCoverage(writers, graph) {
  const rows = [];
  for (const [id, cat] of Object.entries(CHARACTERS)) {
    const writes = writers.chars[id] || [];
    const events = (graph.npcEvents[id] || []).filter(e => EVENT_BY_ID.has(e));
    const intro = writes.filter(s => /onSee|event /.test(s));
    const late = writes.filter(s => /hell|floorMin: 4|F4|F5|watch|gate|last/.test(s) || events.some(e => {
      const ev = EVENT_BY_ID.get(e);
      return ev && ((ev.when && (ev.when.floorMin || 0) >= 40) || ev.biome === 'hell');
    }));
    const tested = TEST_SRC.includes(`'${id}'`) || TEST_SRC.includes(`"${id}"`) || TEST_SRC.includes(cat.name);
    rows.push({
      id,
      name: cat.name,
      introductions: intro.length,
      appearances: new Set([...writes, ...events.map(e => `event ${e}`)]).size,
      events,
      lateCallbacks: late.length,
      catalogued: true,
      tested,
    });
  }
  const danglingChars = Object.keys(writers.chars).filter(id => !CHAR_IDS.has(id));
  return { rows, danglingChars };
}

function secretCoverage(writers) {
  return Object.entries(SECRET_ROUTES).map(([id, spec]) => {
    const routes = spec.routes || [];
    const fallbacks = spec.fallbacks || [];
    const routeNotes = [...routes, ...fallbacks].map(r => {
      const bag = collectWhenKeys(r.when);
      const missing = [];
      for (const f of bag.flags) if (!writers.flags[f]) missing.push(`flag ${f}`);
      for (const k of bag.knowledge) if (!writers.knowledge[k]) missing.push(`knowledge ${k}`);
      for (const e of bag.events) if (!EVENT_BY_ID.has(e)) missing.push(`event ${e}`);
      for (const it of bag.items) if (!itemById(it)) missing.push(`item ${it}`);
      return { id: r.id, kind: routes.includes(r) ? 'route' : 'fallback', missing, when: bag };
    });
    return {
      id,
      name: spec.name,
      parent: spec.parent,
      routes: routes.length,
      fallbacks: fallbacks.length,
      initiation: spec.initiation,
      initiationExists: EVENT_BY_ID.has(spec.initiation),
      notes: routeNotes,
    };
  });
}

function bossCoverage() {
  const rows = [];
  const add = (floor, boss, kind) => {
    rows.push({
      floor: Number(floor),
      id: boss.id,
      name: boss.name,
      kind,
      biome: boss.biome || biomeFloorsOf(Number(floor)),
      variants: (boss.variants || []).map(v => v.id),
      tested: TEST_SRC.includes(boss.id) || TEST_SRC.includes(boss.name),
    });
  };
  for (const [floor, boss] of Object.entries(BOSSES)) add(floor, boss, 'primary');
  for (const [floor, boss] of Object.entries(ALT_BOSSES)) add(floor, boss, 'alt');
  if (SECRET_BOSS) add(51, SECRET_BOSS, 'secret');
  return rows;
}

function biomeFloorsOf(floor) {
  return BIOMES.find(b => floor >= b.floors[0] && floor <= b.floors[1])?.id || '?';
}

function itemIsReserved(item) {
  return !!(item?.reserved || RESERVED_CONTENT.items?.[item?.id]);
}

function itemIsRetired(item) {
  return !!item?.retired;
}

function stageIsReserved(thread, stage) {
  const key = `${thread}.${stage}`;
  return !!(RESERVED_CONTENT.threadStages?.[key] || THREADS[thread]?.reservedStages?.includes(stage));
}

function exclusiveItems(writers) {
  return ALL_EQUIPMENT.filter(i => i.exclusive).map(i => ({
    id: i.id,
    name: i.name,
    granted: !!(writers.items[i.id]),
    reserved: itemIsReserved(i),
    retired: itemIsRetired(i),
    writers: writers.items[i.id] || [],
  }));
}

function unusedThreadStages(writers) {
  const rows = [];
  for (const [id, spec] of Object.entries(THREADS)) {
    const written = new Set((writers.threads[id] || []).map(w => w.stage).filter(Boolean));
    for (const stage of spec.stages || []) {
      if (!written.has(stage)) {
        rows.push({ thread: id, stage, reserved: stageIsReserved(id, stage) });
      }
    }
  }
  return rows;
}

/** Shared by the CLI and tools/test.js — do not treat reserved/retired as accidental dead. */
export function catalogDeadState(writers = collectWriters()) {
  const exclusive = exclusiveItems(writers);
  const stages = unusedThreadStages(writers);
  return {
    deadExclusives: exclusive.filter(i => !i.granted && !i.reserved && !i.retired),
    reservedExclusives: exclusive.filter(i => !i.granted && i.reserved),
    retiredExclusives: exclusive.filter(i => i.retired),
    unusedStages: stages.filter(s => !s.reserved),
    reservedStages: stages.filter(s => s.reserved),
  };
}

function testMentions() {
  const mentioned = new Set();
  const re = /['"`]([a-z][a-z0-9_]{2,})['"`]/g;
  let m;
  while ((m = re.exec(TEST_SRC))) mentioned.add(m[1]);
  const classify = (id) => {
    const hits = (TEST_SRC.match(new RegExp(`['"\`]${id}['"\`]`, 'g')) || []).length;
    if (hits >= 3) return 'Strong coverage';
    if (hits >= 1) return 'Partial coverage';
    return 'No obvious direct coverage';
  };
  return { mentioned, classify };
}

function printSection(title) {
  console.log('');
  console.log(title);
  console.log('-'.repeat(title.length));
}

function main() {
  const graph = catalogNarrativeGraph();
  const writers = collectWriters();
  const classified = EVENTS.map(ev => classifyEvent(ev, writers));
  const buckets = { HEALTHY: 0, 'RARE BY DESIGN': 0, 'SUSPICIOUSLY RARE': 0, UNREACHABLE: 0, UNKNOWN: 0 };
  for (const c of classified) buckets[c.bucket] = (buckets[c.bucket] || 0) + 1;

  const dups = [
    ...duplicateIds(EVENTS, 'event'),
    ...duplicateIds(ALL_EQUIPMENT, 'item'),
    ...duplicateIds(RELICS, 'relic'),
    ...duplicateIds(CONSUMABLES, 'consumable'),
    ...duplicateIds(Object.values(CLASSES), 'class'),
    ...duplicateIds(Object.values(SUBCLASSES), 'subclass'),
    ...duplicateIds(ORIGINS, 'origin'),
    ...duplicateIds(Object.values(BOSSES).concat(Object.values(ALT_BOSSES), SECRET_BOSS ? [SECRET_BOSS] : []), 'boss'),
    ...duplicateIds(MODIFIERS, 'trial-mod'),
  ];
  const enemyIds = [];
  for (const pool of Object.values(ENEMIES)) for (const e of pool) enemyIds.push(e);
  for (const e of WANDERING_ENEMIES) enemyIds.push(e);
  for (const e of Object.values(NPC_ENEMIES)) enemyIds.push(e);
  dups.push(...duplicateIds(enemyIds, 'enemy'));

  const dangling = gatherDangling(writers);
  const titles = similarTitles();
  const broad = overBroadEvents();
  const narrow = overNarrowEvents(classified);
  const biomes = contentByBiome();
  const bands = contentByFloorBand(classified);
  const npcs = npcCoverage(writers, graph);
  const secrets = secretCoverage(writers);
  const bosses = bossCoverage();
  const { classify } = testMentions();

  console.log('CATALOG COVERAGE');
  console.log('================');
  console.log(`Events: ${EVENTS.length}`);
  console.log(`  healthy: ${buckets.HEALTHY}`);
  console.log(`  rare-by-design: ${buckets['RARE BY DESIGN']}`);
  console.log(`  suspicious: ${buckets['SUSPICIOUSLY RARE']}`);
  console.log(`  unreachable: ${buckets.UNREACHABLE}`);
  console.log(`  unknown: ${buckets.UNKNOWN}`);
  console.log(`Narrative events: ${NARRATIVE_IDS.size}`);
  console.log(`Origins: ${ORIGINS.length}`);
  console.log(`Classes: ${Object.keys(CLASSES).length} (${Object.values(CLASSES).filter(c => c.hidden).length} hidden)`);
  console.log(`Hidden subclasses: ${Object.keys(SECRET_ROUTES).length}`);
  console.log(`Characters: ${Object.keys(CHARACTERS).length}`);
  console.log(`Threads: ${Object.keys(THREADS).length}`);
  console.log(`Enemies (biome pools): ${Object.values(ENEMIES).reduce((n, p) => n + p.length, 0)}`);
  console.log(`Wandering: ${WANDERING_ENEMIES.length}`);
  console.log(`Gallery NPC meet cards: ${Object.keys(GALLERY_NPCS).length}`);
  console.log(`Bosses: ${Object.keys(BOSSES).length} primary + ${Object.keys(ALT_BOSSES).length} alt + 1 secret`);
  console.log(`Trial modifiers: ${MODIFIERS.length}`);
  console.log(`Equipment: ${ALL_EQUIPMENT.length}  Relics: ${RELICS.length}  Consumables: ${CONSUMABLES.length}`);
  console.log(`UNIQUE: ${uniqueCatalog().length}  WRLD: ${wrldCatalog().length}`);

  printSection('UNREACHABLE / IMPOSSIBLE');
  const bad = classified.filter(c => c.bucket === 'UNREACHABLE');
  if (!bad.length) console.log('None.');
  for (const c of bad) {
    console.log(`- ${c.id} [${c.type}] biome=${c.biome} floors=${c.floor}`);
    for (const r of c.reasons) console.log(`    ${r}`);
  }

  printSection('UNKNOWN');
  const unk = classified.filter(c => c.bucket === 'UNKNOWN');
  if (!unk.length) console.log('None.');
  for (const c of unk) console.log(`- ${c.id}: ${c.reasons.join('; ')}`);

  printSection('SUSPICIOUSLY RARE');
  const sus = classified.filter(c => c.bucket === 'SUSPICIOUSLY RARE');
  if (!sus.length) console.log('None.');
  for (const c of sus) {
    console.log(`- ${c.id} biome=${c.biome} ${c.floor} gates=${c.gates}`);
    for (const r of c.reasons) console.log(`    ${r}`);
  }

  printSection('OVER-BROAD (any biome, no gates, w>=6, repeatable)');
  if (!broad.length) console.log('None.');
  for (const e of broad) console.log(`- ${e.id} w=${e.w} ${e.category}`);

  printSection('OVER-NARROW CANDIDATES');
  if (!narrow.length) console.log('None.');
  for (const c of narrow.slice(0, 40)) {
    console.log(`- ${c.id} biome=${c.biome} ${c.floor} gates=${c.gates} [${c.bucket}]`);
  }

  printSection('DUPLICATE IDS');
  if (!dups.length) console.log('None.');
  for (const d of dups) console.log(`- ${d.type} ${d.id}`);

  printSection('DUPLICATE TITLES');
  if (!titles.length) console.log('None.');
  for (const t of titles) console.log(`- "${t.title}": ${t.ids.join(', ')}`);

  printSection('DANGLING REFERENCES');
  if (!dangling.length) console.log('None.');
  for (const d of dangling) console.log(`- ${d.from} → ${d.kind} ${d.id} (${d.site})`);

  printSection('GRAPH ORPHANS (writers, no readers)');
  console.log(`flags: ${graph.orphanFlags.length}  knowledge: ${graph.orphanKnowledge.length}`);
  for (const o of graph.orphanFlags) console.log(`- flag ${o.id} setBy ${o.setBy.join('; ')}`);
  for (const o of graph.orphanKnowledge) console.log(`- knowledge ${o.id} setBy ${o.setBy.join('; ')}`);

  printSection('CONTENT BY BIOME');
  for (const [id, row] of Object.entries(biomes)) {
    console.log(`${id.padEnd(8)} floors ${row.floors}  events ${row.events}  narrative ${row.narrative}  rareish ${row.rare}  npcBeats ${row.npcBeats}  enemies ${row.enemies}  bosses ${row.bosses}  travel ${row.travelFloors}`);
  }

  printSection('CONTENT BY FLOOR BAND (events whose window overlaps)');
  for (const b of bands) {
    console.log(`${b.id}  events ${b.events}  healthy ${b.healthy}  rare ${b.rare}  suspicious ${b.suspicious}  unreachable ${b.unreachable}  travel ${b.travelFloors}`);
  }

  printSection('NPC COVERAGE');
  for (const n of npcs.rows) {
    console.log(`- ${n.id} (${n.name}) intros ${n.introductions} appearances ${n.appearances} events [${n.events.join(', ') || '—'}] late ${n.lateCallbacks} test ${n.tested ? 'yes' : 'no'}`);
  }
  if (npcs.danglingChars.length) console.log(`dangling char writes: ${npcs.danglingChars.join(', ')}`);

  printSection('HIDDEN-CLASS ROUTES');
  for (const s of secrets) {
    const miss = s.notes.filter(n => n.missing.length);
    console.log(`- ${s.id} parent=${s.parent} routes=${s.routes} fallbacks=${s.fallbacks} initiation=${s.initiation}${s.initiationExists ? '' : ' MISSING'}`);
    for (const n of miss) console.log(`    ${n.kind} ${n.id} missing ${n.missing.join(', ')}`);
  }

  printSection('BOSS / TRIAL');
  for (const b of bosses) {
    console.log(`- F${b.floor} ${b.kind} ${b.id} (${b.name}) biome=${b.biome} variants=${b.variants.join(',') || '—'} test=${b.tested ? 'yes' : 'no'}`);
  }
  console.log(`trial floors: ${[5, 25, 35, 45].join(', ')}  modifiers: ${MODIFIERS.map(m => m.id).join(', ')}`);

  const dead = catalogDeadState(writers);

  printSection('DEAD EXCLUSIVES (ungranted, not reserved/retired)');
  if (!dead.deadExclusives.length) console.log('None.');
  for (const i of dead.deadExclusives) console.log(`- ${i.id} (${i.name})`);

  printSection('RESERVED EXCLUSIVES');
  if (!dead.reservedExclusives.length) console.log('None.');
  for (const i of dead.reservedExclusives) console.log(`- ${i.id} (${i.name})`);

  printSection('RETIRED EXCLUSIVES');
  if (!dead.retiredExclusives.length) console.log('None.');
  for (const i of dead.retiredExclusives) console.log(`- ${i.id} (${i.name})`);

  printSection('UNUSED THREAD STAGES (no writer, not reserved)');
  if (!dead.unusedStages.length) console.log('None.');
  for (const s of dead.unusedStages) console.log(`- ${s.thread}.${s.stage}`);

  printSection('RESERVED THREAD STAGES');
  if (!dead.reservedStages.length) console.log('None.');
  for (const s of dead.reservedStages) console.log(`- ${s.thread}.${s.stage}`);

  printSection('TEST COVERAGE GAPS (behavior-bearing)');
  const watch = [
    ...classified.filter(c => c.bucket === 'UNREACHABLE' || c.bucket === 'SUSPICIOUSLY RARE').map(c => c.id),
    ...Object.keys(SECRET_ROUTES),
    ...bosses.map(b => b.id),
    ...Object.keys(CHARACTERS),
    'beginThrone', 'resolveThroneChoice', 'shopDiscount', 'buildShopStock',
    'quiet_offer', 'margin_door', 'cowards_gate', 'crowned_shadow',
    'witch_remembers', 'mira_watch', 'bard_last_song',
  ];
  const seenGap = new Set();
  for (const id of watch) {
    if (seenGap.has(id)) continue;
    seenGap.add(id);
    const cov = classify(id);
    if (cov !== 'Strong coverage') console.log(`- ${id}: ${cov}`);
  }

  printSection('SHOP / THRONE / LATE READS');
  console.log(`shop flags: ${(SHOP_NARRATIVE_READS.flags || []).join(', ')}`);
  console.log(`throne flags: ${(THRONE_READS.flags || []).join(', ')}`);
  console.log(`late_memory flags: ${(LATE_MEMORY_READS.flags || []).length}  knowledge: ${(LATE_MEMORY_READS.knowledge || []).length}`);

  printSection('NPC_EVENTS COMPENDIUM GAPS');
  const missingNpcEvents = NPC_EVENTS.filter(id => !EVENT_BY_ID.has(id));
  if (!missingNpcEvents.length) console.log('None.');
  for (const id of missingNpcEvents) console.log(`- ${id}`);
}

function invokedAsCli() {
  const self = fileURLToPath(import.meta.url).replace(/\\/g, '/').toLowerCase();
  const arg = resolve(process.argv[1] || '').replace(/\\/g, '/').toLowerCase();
  return !!arg && self === arg;
}

if (invokedAsCli()) main();
