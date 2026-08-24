#!/usr/bin/env node
// Run-variety telemetry — measure what climbs actually offer and take.
//   node tools/run_variety.js --seed 20260823 --trials 200
// Does not retune the game. Policy RNG is unused here: health climbs pick
// travel cards from the trial stream (modeled takes). Encounter/event
// generation uses the same live draw as generateFloorCards.

import { makeRng } from '../js/rng.js';
import { EVENTS, eventDrawPool } from '../js/data/events.js';
import { ENEMIES, WANDERING_ENEMIES, BOSSES, ALT_BOSSES, MODIFIERS, biomeForFloor } from '../js/data/enemies.js';
import { SECRET_ROUTES } from '../js/data/world.js';
import { CLASSES } from '../js/data/classes.js';
import { pushEncounterHistory } from '../js/data/balance.js';
import { pickEnemyPlan, generateFloorCards, LAST_FLOOR } from '../js/data/floorcards.js';
import { newRun, rollStart } from '../js/state.js';
import { simulateHealthClimb } from './run_health_climb.js';

const WANDER_IDS = new Set((WANDERING_ENEMIES || []).map(e => e.id));
const ALL_EVENT_IDS = EVENTS.map(e => e.id);
const START_CLASSES = Object.values(CLASSES).filter(c => !c.hidden).map(c => c.id);

function arg(name, fallback) {
  const raw = process.argv.find(a => a.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const v = raw.slice(name.length + 3);
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && !Number.isNaN(n) && String(n) === v ? n : v;
}

function bump(map, key, n = 1) {
  map[key] = (map[key] || 0) + n;
}

function topEntries(map, n = 12) {
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function pct(n, d) {
  if (!d) return '0.0%';
  return `${((n / d) * 100).toFixed(1)}%`;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function compositionKey(specs) {
  return (specs || []).map(s => s.id).sort().join('+') || '(empty)';
}

function leadId(specs) {
  return specs?.[0]?.id || null;
}

function eventGateKind(ev) {
  const gated = !!(ev.cond || ev.when);
  if (ev.once && gated) return 'once+gated';
  if (ev.once) return 'once';
  if (gated) return 'gated';
  return 'open';
}

function sampleEncounters(trials, seed) {
  const byBiome = {};
  const byLead = {};
  const byComp = {};
  const byEnemy = {};
  const wanderLeads = { n: 0, of: 0 };
  const packLeads = { n: 0, of: 0 };
  const eliteLeads = { n: 0, of: 0 };
  const consecutiveLead = [];
  const biomeNativeShare = {};

  const floors = [3, 8, 13, 18, 23, 28, 33, 38, 43, 48];
  for (let i = 0; i < trials; i++) {
    const rng = makeRng((seed + i * 9973) >>> 0);
    let prevLead = null;
    const run = { recentEncounterIds: [], recentEncounterBodies: [] };
    for (const floor of floors) {
      const biome = biomeForFloor(floor);
      run.floor = floor;
      run.biomeId = biome.id;
      const plan = pickEnemyPlan(rng, run, biome, 1);
      pushEncounterHistory(run, plan.specs);
      const specs = plan.specs || [];
      const lead = leadId(specs);
      const biomeId = biome.id;
      if (!byBiome[biomeId]) {
        byBiome[biomeId] = { leads: {}, comps: {}, enemies: {}, n: 0, wanderLead: 0, packLead: 0 };
      }
      const row = byBiome[biomeId];
      row.n += 1;
      bump(row.leads, lead);
      bump(row.comps, compositionKey(specs));
      bump(byLead, lead);
      bump(byComp, compositionKey(specs));
      const native = new Set((ENEMIES[biomeId] || []).map(e => e.id));
      let nativeBodies = 0;
      for (const s of specs) {
        bump(row.enemies, s.id);
        bump(byEnemy, s.id);
        if (native.has(s.id)) nativeBodies += 1;
      }
      if (!biomeNativeShare[biomeId]) biomeNativeShare[biomeId] = { native: 0, total: 0 };
      biomeNativeShare[biomeId].native += nativeBodies;
      biomeNativeShare[biomeId].total += specs.length;
      wanderLeads.of += 1;
      packLeads.of += 1;
      eliteLeads.of += 1;
      if (WANDER_IDS.has(lead)) {
        wanderLeads.n += 1;
        row.wanderLead += 1;
      }
      if (specs[0]?.pack) {
        packLeads.n += 1;
        row.packLead += 1;
      }
      if (specs[0]?.elite) eliteLeads.n += 1;
      if (prevLead != null) consecutiveLead.push(lead === prevLead ? 1 : 0);
      prevLead = lead;
    }
  }
  return {
    byBiome, byLead, byComp, byEnemy, wanderLeads, packLeads, eliteLeads,
    consecutiveLeadRate: mean(consecutiveLead),
    biomeNativeShare,
    samples: trials * floors.length,
  };
}

function analyzeClimbs(climbs) {
  const offered = {};
  const taken = {};
  const offeredPerRun = [];
  const takenPerRun = [];
  const runRepeatEvents = [];
  const runRepeatEncounters = [];
  const bosses = {};
  const secrets = {};
  const goldByFloorBand = { '1-10': [], '11-20': [], '21-30': [], '31-40': [], '41-51': [] };
  const skills = {};
  const relics = {};
  const shopsOffered = [];
  const shopsVisited = [];
  const eventDupWithinRun = [];
  const unseen = new Set(ALL_EVENT_IDS);

  for (const c of climbs) {
    const seenOffer = new Set();
    const seenTake = new Set();
    let offerDup = 0;
    let takeDup = 0;
    for (const id of c.offeredEventIds || []) {
      bump(offered, id);
      unseen.delete(id);
      if (seenOffer.has(id)) offerDup += 1;
      seenOffer.add(id);
    }
    for (const id of c.takenEventIds || []) {
      bump(taken, id);
      if (seenTake.has(id)) takeDup += 1;
      seenTake.add(id);
    }
    offeredPerRun.push((c.offeredEventIds || []).length);
    takenPerRun.push((c.takenEventIds || []).length);
    runRepeatEvents.push(offerDup);
    eventDupWithinRun.push(takeDup);
    shopsOffered.push(c.shopsOffered || 0);
    shopsVisited.push(c.shopsVisited || 0);
    for (const b of c.climbBosses || []) bump(bosses, b);
    for (const [id, row] of Object.entries(c.secrets || {})) {
      if (!secrets[id]) secrets[id] = { eligible: 0, offered: 0, accepted: 0, n: 0 };
      secrets[id].n += 1;
      if (row.eligibleFloor != null) secrets[id].eligible += 1;
      if (row.offeredFloor != null) secrets[id].offered += 1;
      if (row.outcome === 'accepted' || row.unlocked) secrets[id].accepted += 1;
    }
    for (const g of c.goldHeld || []) {
      const f = g.floor;
      const band = f <= 10 ? '1-10' : f <= 20 ? '11-20' : f <= 30 ? '21-30' : f <= 40 ? '31-40' : '41-51';
      goldByFloorBand[band].push(g.gold);
    }
  }

  const catalog = {};
  for (const ev of EVENTS) {
    catalog[ev.id] = {
      w: ev.w || 1,
      once: !!ev.once,
      biome: ev.biome,
      category: ev.category,
      gate: eventGateKind(ev),
      offered: offered[ev.id] || 0,
      taken: taken[ev.id] || 0,
    };
  }

  return {
    offered, taken, offeredPerRun, takenPerRun, runRepeatEvents, eventDupWithinRun,
    bosses, secrets, goldByFloorBand, skills, relics, shopsOffered, shopsVisited,
    unseen: [...unseen],
    catalog,
  };
}

function formatReport({ climbs, encounter, eventPools, climbStats, trials, seed }) {
  const lines = [];
  const n = climbs.length;
  lines.push('RUN VARIETY REPORT');
  lines.push(`Runs simulated: ${n}   seed: ${seed}   floors: 1–${LAST_FLOOR} (survive)`);
  lines.push('');

  const uniqueOffered = Object.keys(climbStats.offered).length;
  const uniqueTaken = Object.keys(climbStats.taken).length;
  lines.push(`Unique events offered:   ${uniqueOffered}/${ALL_EVENT_IDS.length}`);
  lines.push(`Unique events taken:     ${uniqueTaken}/${ALL_EVENT_IDS.length}`);
  lines.push(`Avg offered events/run:  ${mean(climbStats.offeredPerRun).toFixed(1)}`);
  lines.push(`Avg taken events/run:    ${mean(climbStats.takenPerRun).toFixed(1)}`);
  lines.push(`Avg repeated event offers/run: ${mean(climbStats.runRepeatEvents).toFixed(2)}`);
  lines.push(`Avg shops offered/run:   ${mean(climbStats.shopsOffered).toFixed(2)}`);
  lines.push(`Avg shops visited/run:   ${mean(climbStats.shopsVisited).toFixed(2)}`);
  lines.push('');

  lines.push('Event coverage (offer share of all event-offers):');
  const offerTotal = Object.values(climbStats.offered).reduce((a, b) => a + b, 0) || 1;
  for (const [id, c] of topEntries(climbStats.offered, 15)) {
    const ev = climbStats.catalog[id];
    lines.push(`  ${id.padEnd(22)} ${pct(c, offerTotal).padStart(6)}  w=${ev?.w ?? '?'}  ${ev?.gate || ''}  ${ev?.biome || ''}`);
  }
  lines.push('');
  lines.push('Effectively unseen events (0 offers in this batch):');
  const unseen = climbStats.unseen
    .map(id => climbStats.catalog[id])
    .filter(Boolean)
    .sort((a, b) => (b.w || 0) - (a.w || 0));
  const byGate = { open: [], gated: [], once: [], 'once+gated': [] };
  for (const id of climbStats.unseen) {
    const ev = EVENTS.find(e => e.id === id);
    if (!ev) continue;
    byGate[eventGateKind(ev)].push(`${id} (w=${ev.w || 1}, ${ev.biome})`);
  }
  for (const [g, list] of Object.entries(byGate)) {
    lines.push(`  ${g}: ${list.length}${list.length && list.length <= 12 ? ' — ' + list.join(', ') : list.length > 12 ? ' — ' + list.slice(0, 8).join(', ') + '…' : ''}`);
  }
  lines.push('');

  lines.push('Encounter sampling (pickEnemyPlan with live encounter history):');
  lines.push(`  samples: ${encounter.samples}`);
  lines.push(`  consecutive same-lead rate (across listed floors in one trial): ${pct(encounter.consecutiveLeadRate, 1)}`);
  lines.push(`  pack leads: ${pct(encounter.packLeads.n, encounter.packLeads.of)}`);
  lines.push(`  wanderer leads: ${pct(encounter.wanderLeads.n, encounter.wanderLeads.of)}`);
  lines.push(`  elite leads: ${pct(encounter.eliteLeads.n, encounter.eliteLeads.of)}`);
  lines.push('  top leads overall:');
  for (const [id, c] of topEntries(encounter.byLead, 12)) {
    lines.push(`    ${String(id).padEnd(22)} ${pct(c, encounter.samples)}`);
  }
  lines.push('  biome identity (native bodies / all bodies) + pack-lead + wander-lead:');
  for (const [biome, row] of Object.entries(encounter.byBiome)) {
    const nat = encounter.biomeNativeShare[biome] || { native: 0, total: 1 };
    lines.push(`    ${biome.padEnd(8)} native ${pct(nat.native, nat.total)}  packLead ${pct(row.packLead, row.n)}  wanderLead ${pct(row.wanderLead, row.n)}  uniqueLeads ${Object.keys(row.leads).length}`);
    const top = topEntries(row.leads, 4).map(([id, c]) => `${id} ${pct(c, row.n)}`).join(', ');
    lines.push(`             tops: ${top}`);
  }
  lines.push('  most repeated compositions:');
  for (const [k, c] of topEntries(encounter.byComp, 8)) {
    lines.push(`    ${pct(c, encounter.samples)}  ${k}`);
  }
  lines.push('');

  lines.push('Eligible pool sizes (fresh run, generateFloorCards):');
  const byFloor = {};
  for (const row of eventPools) {
    if (!byFloor[row.floor]) byFloor[row.floor] = [];
    byFloor[row.floor].push(row.poolSize);
  }
  for (const floor of Object.keys(byFloor).map(Number).sort((a, b) => a - b)) {
    lines.push(`  F${floor}: mean pool ${mean(byFloor[floor]).toFixed(1)}  (n=${byFloor[floor].length})`);
  }
  const topFirst = eventPools.filter(r => r.floor === 2);
  const firstTop = {};
  for (const row of topFirst) {
    for (const t of row.top) bump(firstTop, t.id);
  }
  lines.push('  most frequent top-weight events on F2:');
  for (const [id, c] of topEntries(firstTop, 8)) {
    lines.push(`    ${id.padEnd(22)} in ${c}/${topFirst.length} class-floor samples`);
  }
  lines.push('');

  lines.push('Hidden-class / secret routes (parent-class climbs only):');
  for (const [id, row] of Object.entries(climbStats.secrets)) {
    lines.push(`  ${id.padEnd(16)} eligible ${pct(row.eligible, row.n)}  offered ${pct(row.offered, row.n)}  accepted ${pct(row.accepted, row.n)}  n=${row.n}`);
  }
  lines.push('');

  lines.push('Economy (gold held, survive climbs):');
  for (const [band, vals] of Object.entries(climbStats.goldByFloorBand)) {
    lines.push(`  ${band}: mean ${mean(vals).toFixed(0)}g  n=${vals.length}`);
  }
  lines.push('');

  lines.push('Boss picks reached:');
  for (const [id, c] of topEntries(climbStats.bosses, 16)) {
    lines.push(`  ${id.padEnd(28)} ${c}`);
  }

  return lines.join('\n');
}

async function main() {
  const seed = Number(arg('seed', 20260823)) || 20260823;
  const trials = Number(arg('trials', 180)) || 180;
  const encTrials = Math.max(80, Math.min(160, Math.floor(trials * 0.6)));

  const encounter = sampleEncounters(encTrials, seed ^ 0xE11C0);
  const eventPools = [];
  const floors = [2, 5, 8, 12, 16, 22, 27, 34, 42, 48];
  let pi = 0;
  for (const classId of START_CLASSES) {
    for (const floor of floors) {
      const rng = makeRng((seed + (++pi) * 7919) >>> 0);
      const run = newRun({ upgrades: {}, achievements: [] }, {
        classId, raceId: 'human', name: 'Var',
        seed: seed + pi, kitSeed: seed + pi,
        gen: rollStart(classId, 'human', seed + pi),
      });
      run.floor = floor;
      run.biomeId = biomeForFloor(floor).id;
      const cards = generateFloorCards(rng, run, { partySize: 1 });
      const events = cards.filter(c => c.kind === 'event').map(c => c.eventId);
      const pool = eventDrawPool(run);
      eventPools.push({
        classId, floor, biome: run.biomeId,
        poolSize: pool.length,
        offered: events,
        top: pool.slice().sort((a, b) => b.w - a.w).slice(0, 8).map(p => ({ id: p.id, w: +p.w.toFixed(2) })),
      });
    }
  }

  const climbs = [];
  const classCycle = START_CLASSES;
  for (let i = 0; i < trials; i++) {
    const rng = makeRng((seed + i * 9973) >>> 0);
    const classId = classCycle[i % classCycle.length];
    const row = simulateHealthClimb(rng, { classId, survive: true });
    climbs.push(row);
  }

  const climbStats = analyzeClimbs(climbs);
  const text = formatReport({ climbs, encounter, eventPools, climbStats, trials, seed });
  console.log(text);
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/run_variety.js');
if (isMain) main();

export { sampleEncounters, analyzeClimbs };
