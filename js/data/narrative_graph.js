// Static narrative connectivity catalog.
// Walks authored events/origins/bosses plus declared system reads.
// Cached after first build — never scan per frame.

import { EVENTS } from './events.js';
import { ORIGINS } from './origins.js';
import { BOSSES, ALT_BOSSES } from './enemies.js';
import {
  CHARACTERS, THREADS, FLAG_BRIDGES, SECRET_ROUTES,
  TENDENCY_FLAG_BRIDGES, CHOICE_BRIDGES, NPC_ART_TO_CHAR,
} from './world.js';
import { CLASSES } from './classes.js';
import { SHOP_NARRATIVE_READS } from '../shop.js';
import { LATE_MEMORY_READS } from './late_memory.js';
import { THRONE_READS } from '../throne.js';

/**
 * Catalog entries kept on purpose with no grant / stage writer.
 * Audit treats these as reserved, not accidentally dead.
 * Prefer item.retired / item.reserved on the catalog row when the
 * exclusion lives on an exclusive item.
 */
export const RESERVED_CONTENT = {
  items: {
    // none currently — retired exclusives use item.retired
  },
  threadStages: {
    // none currently — unused openers were removed, not reserved
  },
};

/** Flags/knowledge that are written on purpose with no story consumer. */
export const TERMINAL_STATE = {
  flags: {
    slots_f20: 'progression: extra skill slot after the ruins gate',
    slots_f40: 'progression: extra skill slot after the mire gate',
    throneBossId: 'persist the F51 figure across save/load',
    throneBossName: 'persist the F51 figure display name',
    corrupt_king_ending: 'ending id after the honesty fight',
  },
  knowledge: {
    pale_rite: 'companion stamp written with lichling unlock',
    doom_benefits: 'companion stamp written with doomguard unlock',
    void_annotation: 'companion stamp written with void scholar unlock',
    storm_collect: 'companion stamp written with stormcaller unlock',
    phantom_file: 'companion stamp written with phantom unlock',
    halo_vocation: 'companion stamp written with heretic saint unlock',
    ashen_strike: 'companion stamp written with ashen fist unlock',
    dawn_pact: 'companion stamp written with lightbreaker unlock',
    doomsong_taken: 'companion stamp written with doomsinger unlock',
    eclipse_accept: 'companion stamp written with void edge unlock',
    valhalla_notice: 'companion stamp written with einherjar unlock',
  },
};

function asList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function addSite(map, id, site) {
  if (!id) return;
  if (!map[id]) map[id] = [];
  if (!map[id].includes(site)) map[id].push(site);
}

function walkWhen(when, site, bag) {
  if (!when || typeof when !== 'object') return;
  if (typeof when === 'function') return;
  if (Array.isArray(when)) {
    when.forEach(w => walkWhen(w, site, bag));
    return;
  }
  for (const id of asList(when.flag || when.flags)) addSite(bag.flagReads, id, site);
  for (const id of asList(when.notFlag || when.notFlags)) addSite(bag.flagReads, id, site);
  for (const id of asList(when.knowledge)) addSite(bag.knowledgeReads, id, site);
  for (const id of asList(when.notKnowledge)) addSite(bag.knowledgeReads, id, site);
  for (const id of asList(when.charMet)) addSite(bag.charReads, id, site);
  for (const id of asList(when.charAlive)) addSite(bag.charReads, id, site);
  for (const id of asList(when.charDead)) addSite(bag.charReads, id, site);
  for (const id of asList(when.event || when.events)) addSite(bag.eventReads, id, site);
  for (const id of asList(when.notEvent || when.notEvents)) addSite(bag.eventReads, id, site);
  if (when.thread) {
    const id = typeof when.thread === 'string' ? when.thread : when.thread.id;
    addSite(bag.threadReads, id, site);
  }
  if (when.threadAtLeast?.id) addSite(bag.threadReads, when.threadAtLeast.id, site);
  if (when.eventChoice?.id) addSite(bag.eventReads, when.eventChoice.id, site);
  if (when.factionRelMin) Object.keys(when.factionRelMin).forEach(id => addSite(bag.factionReads, id, site));
  if (when.factionRelMax) Object.keys(when.factionRelMax).forEach(id => addSite(bag.factionReads, id, site));
  if (when.counterMin) Object.keys(when.counterMin).forEach(id => addSite(bag.counterReads, id, site));
  if (when.charRelMin) Object.keys(when.charRelMin).forEach(id => addSite(bag.charReads, id, site));
  if (when.charRelMax) Object.keys(when.charRelMax).forEach(id => addSite(bag.charReads, id, site));
  asList(when.all).forEach(w => walkWhen(w, site, bag));
  asList(when.any).forEach(w => walkWhen(w, site, bag));
  if (when.not) walkWhen(when.not, site, bag);
}

function walkReq(req, site, bag) {
  if (!req || typeof req !== 'object') return;
  if (req.flag) addSite(bag.flagReads, req.flag, site);
  for (const id of asList(req.notFlag)) addSite(bag.flagReads, id, site);
  if (req.knowledge) addSite(bag.knowledgeReads, req.knowledge, site);
}

function walkPatch(patch, site, bag, ev) {
  if (!patch || typeof patch !== 'object') return;
  if (patch.flag) addSite(bag.flagWrites, patch.flag, site);
  for (const id of asList(patch.flags)) addSite(bag.flagWrites, id, site);
  if (patch.clearFlag) addSite(bag.flagReads, patch.clearFlag, site);
  for (const id of asList(patch.knowledge)) addSite(bag.knowledgeWrites, id, site);
  if (patch.unlockSecret) addSite(bag.knowledgeWrites, `unlock_${patch.unlockSecret}`, site);
  if (patch.char?.id) {
    addSite(bag.charWrites, patch.char.id, site);
    if (ev) addSite(bag.npcEvents, patch.char.id, ev.id);
  }
  if (patch.thread?.id) addSite(bag.threadWrites, patch.thread.id, site);
  if (patch.faction?.id) addSite(bag.factionWrites, patch.faction.id, site);
  if (patch.counter?.id) addSite(bag.counterWrites, patch.counter.id, site);
}

function walkOutcome(o, site, bag, ev) {
  if (!o || typeof o !== 'object') return;
  if (o.flag) addSite(bag.flagWrites, o.flag, site);
  if (o.clearFlag) addSite(bag.flagReads, o.clearFlag, site);
  walkPatch(o.world, site, bag, ev);
  if (o.roll) {
    if (o.roll.bonusFlag?.flag) addSite(bag.flagReads, o.roll.bonusFlag.flag, site);
    if (o.roll.penaltyFlag?.flag) addSite(bag.flagReads, o.roll.penaltyFlag.flag, site);
    walkOutcome(o.success, `${site} / success`, bag, ev);
    walkOutcome(o.fail, `${site} / fail`, bag, ev);
  }
  if (o.combat?.world) walkPatch(o.combat.world, site, bag, ev);
  if (o.combat?.enemies) addSite(bag.combatSites, ev?.id || site, site);
}

function walkEvent(ev, bag) {
  if (!ev?.id) return;
  const site = `event ${ev.id}`;
  if (ev.thread) addSite(bag.threadWrites, ev.thread, site);
  if (ev.npc) {
    const raw = typeof ev.npc === 'string' ? ev.npc : (ev.npc.art || ev.npc.name);
    const mapped = NPC_ART_TO_CHAR[raw];
    if (mapped) addSite(bag.npcEvents, mapped, ev.id);
  }
  walkWhen(ev.when, site, bag);
  walkPatch(ev.onSee, `${site} onSee`, bag, ev);
  for (const v of ev.variants || []) {
    const vs = `${site} variant ${v.id || '?'}`;
    walkWhen(v.when, vs, bag);
    (v.choices || []).forEach((c, i) => {
      walkReq(c.req, `${vs} choice ${i}`, bag);
      walkOutcome(c.outcome, `${vs} choice ${i}`, bag, ev);
    });
  }
  (ev.choices || []).forEach((c, i) => {
    walkReq(c.req, `${site} choice ${i}`, bag);
    walkOutcome(c.outcome, `${site} choice ${i}`, bag, ev);
  });
}

function emptyBag() {
  return {
    flagWrites: {}, flagReads: {},
    knowledgeWrites: {}, knowledgeReads: {},
    charWrites: {}, charReads: {},
    threadWrites: {}, threadReads: {},
    factionWrites: {}, factionReads: {},
    counterWrites: {}, counterReads: {},
    eventReads: {},
    npcEvents: {},
    combatSites: {},
  };
}

function ingestSystemReads(reads, site, bag) {
  if (!reads) return;
  for (const id of reads.flags || []) addSite(bag.flagReads, id, site);
  for (const id of reads.knowledge || []) addSite(bag.knowledgeReads, id, site);
  for (const id of reads.threads || []) addSite(bag.threadReads, id, site);
  for (const id of reads.chars || []) addSite(bag.charReads, id, site);
}

function buildGraph() {
  const bag = emptyBag();

  for (const ev of EVENTS) walkEvent(ev, bag);
  for (const origin of ORIGINS) walkEvent({ ...origin, id: `origin:${origin.id}` }, bag);

  for (const [floor, boss] of Object.entries(BOSSES)) {
    const site = `boss F${floor} ${boss.id || boss.name}`;
    for (const v of boss.variants || []) walkWhen(v.when, `${site} variant ${v.id}`, bag);
  }
  for (const [floor, boss] of Object.entries(ALT_BOSSES)) {
    const site = `alt-boss F${floor} ${boss.id || boss.name}`;
    for (const v of boss.variants || []) walkWhen(v.when, `${site} variant ${v.id}`, bag);
  }

  for (const [flag, patch] of Object.entries(FLAG_BRIDGES)) {
    addSite(bag.flagReads, flag, `FLAG_BRIDGES.${flag}`);
    walkPatch(patch, `FLAG_BRIDGES.${flag}`, bag, null);
  }
  for (const [flag, spec] of Object.entries(TENDENCY_FLAG_BRIDGES)) {
    addSite(bag.flagReads, flag, `TENDENCY_FLAG_BRIDGES.${flag}`);
    if (spec?.id) addSite(bag.counterWrites, spec.id, `TENDENCY_FLAG_BRIDGES.${flag}`);
  }
  for (const [eventId, spec] of Object.entries(CHOICE_BRIDGES)) {
    addSite(bag.eventReads, eventId, `CHOICE_BRIDGES.${eventId}`);
    if (spec?.counter?.id) addSite(bag.counterWrites, spec.counter.id, `CHOICE_BRIDGES.${eventId}`);
  }

  for (const [id, spec] of Object.entries(SECRET_ROUTES)) {
    const site = `SECRET_ROUTES.${id}`;
    if (spec.unlock) addSite(bag.knowledgeReads, spec.unlock, site);
    for (const r of [...(spec.routes || []), ...(spec.fallbacks || [])]) {
      walkWhen(r.when, `${site} ${r.id}`, bag);
    }
  }

  for (const [id, cls] of Object.entries(CLASSES)) {
    const keys = cls.unlockKeys;
    if (!keys) continue;
    const site = `CLASSES.${id}.unlockKeys`;
    for (const f of keys.flags || []) addSite(bag.flagReads, f, site);
    for (const k of keys.knowledge || []) addSite(bag.knowledgeReads, k, site);
    for (const e of keys.events || []) addSite(bag.eventReads, e, site);
  }

  ingestSystemReads(SHOP_NARRATIVE_READS, 'shop', bag);
  ingestSystemReads(LATE_MEMORY_READS, 'late_memory', bag);
  ingestSystemReads(THRONE_READS, 'throne', bag);

  const flagIds = new Set([...Object.keys(bag.flagWrites), ...Object.keys(bag.flagReads)]);
  const knowledgeIds = new Set([...Object.keys(bag.knowledgeWrites), ...Object.keys(bag.knowledgeReads)]);

  const orphanFlags = [...flagIds].filter(id =>
    bag.flagWrites[id] && !bag.flagReads[id] && !TERMINAL_STATE.flags[id]);
  const orphanKnowledge = [...knowledgeIds].filter(id => {
    if (!bag.knowledgeWrites[id] || bag.knowledgeReads[id] || TERMINAL_STATE.knowledge[id]) return false;
    const writes = bag.knowledgeWrites[id] || [];
    const mirror = writes.length && writes.every(s => s.startsWith(`FLAG_BRIDGES.${id}`)) && bag.flagReads[id];
    return !mirror;
  });

  const npcRecurring = Object.entries(bag.npcEvents)
    .filter(([, events]) => events.length >= 2)
    .map(([id, events]) => ({ id, events }));

  const intersecting = [];
  for (const ev of EVENTS) {
    const threads = new Set();
    if (ev.thread) threads.add(ev.thread);
    const when = ev.when;
    const collect = (w) => {
      if (!w || typeof w !== 'object') return;
      if (w.thread) threads.add(typeof w.thread === 'string' ? w.thread : w.thread.id);
      if (w.threadAtLeast?.id) threads.add(w.threadAtLeast.id);
      asList(w.any).forEach(collect);
      asList(w.all).forEach(collect);
    };
    collect(when);
    if (threads.size >= 2) intersecting.push({ id: ev.id, threads: [...threads] });
  }

  const threadNet = deriveThreadNetwork(bag, intersecting);

  return {
    flagWrites: bag.flagWrites,
    flagReads: bag.flagReads,
    knowledgeWrites: bag.knowledgeWrites,
    knowledgeReads: bag.knowledgeReads,
    charWrites: bag.charWrites,
    charReads: bag.charReads,
    threadWrites: bag.threadWrites,
    threadReads: bag.threadReads,
    npcEvents: bag.npcEvents,
    counts: {
      flagsCreated: Object.keys(bag.flagWrites).length,
      flagsConsumed: Object.keys(bag.flagReads).length,
      orphanFlags: orphanFlags.length,
      knowledgeCreated: Object.keys(bag.knowledgeWrites).length,
      knowledgeConsumed: Object.keys(bag.knowledgeReads).length,
      orphanKnowledge: orphanKnowledge.length,
      npcsEncountered: Object.keys(bag.npcEvents).length,
      npcsRecurring: npcRecurring.length,
      threadsStarted: Object.keys(THREADS).length,
      threadsWithReaders: Object.keys(bag.threadReads).length,
      threadsIntersecting: threadNet.pairCount,
      threadsIndirect: threadNet.edges.length,
      threadsIsolated: threadNet.isolated.length,
    },
    orphanFlags: orphanFlags.sort().map(id => ({
      id,
      kind: 'flag',
      setBy: bag.flagWrites[id] || [],
      consumers: [],
    })),
    orphanKnowledge: orphanKnowledge.sort().map(id => ({
      id,
      kind: 'knowledge',
      setBy: bag.knowledgeWrites[id] || [],
      consumers: [],
    })),
    npcRecurring,
    intersecting,
    threadEdges: threadNet.edges,
    mostConnectedThreads: threadNet.mostConnected,
    isolatedThreads: threadNet.isolated,
    catalogChars: Object.keys(CHARACTERS),
  };
}

function eventOwner(ev) {
  return ev.thread || ev.onSee?.thread?.id || ev.family || null;
}

function siteBelongsToEvent(site, evId) {
  const prefix = `event ${evId}`;
  return site === prefix || site.startsWith(`${prefix} `);
}

function statesOnEvent(map, evId) {
  const ids = [];
  for (const [id, sites] of Object.entries(map)) {
    if ((sites || []).some(s => siteBelongsToEvent(s, evId))) ids.push(id);
  }
  return ids;
}

const GENERIC_INTERSECTION_SKIP = new Set([
  ...Object.keys(TERMINAL_STATE.flags),
  ...Object.keys(TERMINAL_STATE.knowledge),
]);

function deriveThreadNetwork(bag, directCards) {
  const ownerOf = {};
  for (const ev of EVENTS) {
    const owner = eventOwner(ev);
    if (owner) ownerOf[ev.id] = owner;
  }

  const edgeKey = {};
  const addEdge = (from, to, via, kind, writer, reader) => {
    if (!from || !to || from === to) return;
    if (GENERIC_INTERSECTION_SKIP.has(via)) return;
    const key = `${from}|${to}|${kind}|${via}`;
    if (edgeKey[key]) return;
    edgeKey[key] = { from, to, via, kind, writer, reader };
  };

  const maps = [
    ['flag', bag.flagWrites, bag.flagReads],
    ['knowledge', bag.knowledgeWrites, bag.knowledgeReads],
    ['char', bag.charWrites, bag.charReads],
  ];

  for (const writerEv of EVENTS) {
    const from = ownerOf[writerEv.id];
    if (!from) continue;
    for (const [kind, writes, reads] of maps) {
      const produced = statesOnEvent(writes, writerEv.id);
      for (const stateId of produced) {
        const readerSites = reads[stateId] || [];
        for (const readerEv of EVENTS) {
          if (readerEv.id === writerEv.id) continue;
          const to = ownerOf[readerEv.id];
          if (!to || to === from) continue;
          if (!readerSites.some(s => siteBelongsToEvent(s, readerEv.id))) continue;
          addEdge(from, to, stateId, kind, writerEv.id, readerEv.id);
        }
      }
    }
  }

  const edges = Object.values(edgeKey);
  const degree = {};
  const pairs = new Set();
  for (const e of edges) {
    degree[e.from] = (degree[e.from] || 0) + 1;
    degree[e.to] = (degree[e.to] || 0) + 1;
    pairs.add([e.from, e.to].sort().join('|'));
  }
  for (const card of directCards) {
    const ts = [...(card.threads || [])].sort();
    for (let i = 0; i < ts.length; i++) {
      for (let j = i + 1; j < ts.length; j++) pairs.add(`${ts[i]}|${ts[j]}`);
    }
  }

  const mostConnected = Object.entries(degree)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 8)
    .map(([id, n]) => ({ id, edges: n }));

  const isolated = Object.keys(THREADS).filter(id => !degree[id]);

  return { edges, mostConnected, isolated, pairCount: pairs.size };
}

let _graph = null;
export function catalogNarrativeGraph() {
  if (!_graph) _graph = buildGraph();
  return _graph;
}

function echoBucket(consumers) {
  const text = (consumers || []).join(' ');
  if (!consumers?.length) return 'none';
  if (/late_memory|throne|hell|floorMin: 4[0-9]|F4[0-9]|F5/.test(text)) return 'lateGame';
  if (/campfire|variant|same event|choice/.test(text) && consumers.length <= 2) return 'immediate';
  return 'delayed';
}

/** Run-aware connectivity snapshot for ?dev=world. Catalog work is cached. */
export function narrativeConnectivityReport(run) {
  const g = catalogNarrativeGraph();
  const flagsSet = Object.keys(run?.flags || {}).filter(k => run.flags[k] && !k.startsWith('_'));
  const knowledge = [...(run?.world?.knowledge || [])];
  const chars = run?.world?.characters || {};
  const threads = run?.world?.threads || {};

  const echo = { immediate: 0, delayed: 0, lateGame: 0, none: 0 };
  for (const id of Object.keys(g.flagWrites)) {
    const bucket = echoBucket(g.flagReads[id]);
    echo[bucket] += 1;
  }

  const runOrphans = [];
  for (const id of flagsSet) {
    if (TERMINAL_STATE.flags[id]) continue;
    if (g.flagWrites[id] && !g.flagReads[id]) {
      runOrphans.push({
        id,
        kind: 'flag',
        setBy: g.flagWrites[id] || ['unknown'],
        consumers: [],
      });
    }
  }
  for (const id of knowledge) {
    if (TERMINAL_STATE.knowledge[id]) continue;
    if (g.knowledgeWrites[id] && !g.knowledgeReads[id]) {
      runOrphans.push({
        id,
        kind: 'knowledge',
        setBy: g.knowledgeWrites[id] || ['unknown'],
        consumers: [],
      });
    }
  }

  const met = Object.entries(chars).filter(([, c]) => c?.met).map(([id]) => id);
  const recurringMet = met.filter(id => (g.npcEvents[id] || []).length >= 2);
  const started = Object.keys(threads).filter(id => threads[id]?.stage);
  const resolved = started.filter(id => {
    const stages = THREADS[id]?.stages || [];
    return stages.length && threads[id].stage === stages[stages.length - 1];
  });

  return {
    catalog: g.counts,
    echoes: echo,
    run: {
      flagsSet: flagsSet.length,
      knowledge: knowledge.length,
      npcsEncountered: met.length,
      npcsRecurring: recurringMet.length,
      threadsStarted: started.length,
      threadsResolved: resolved.length,
    },
    orphanFlags: g.orphanFlags,
    orphanKnowledge: g.orphanKnowledge,
    runOrphans,
    npcRecurring: g.npcRecurring,
    intersecting: g.intersecting,
    threadEdges: g.threadEdges,
    mostConnectedThreads: g.mostConnectedThreads,
    isolatedThreads: g.isolatedThreads,
  };
}

export function npcCanAppear(run, charId) {
  const c = run?.world?.characters?.[charId];
  if (!c?.met) return false;
  return c.alive !== false;
}
