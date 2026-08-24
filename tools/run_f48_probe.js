#!/usr/bin/env node
// F4–8 Forest attrition probe — measurement only.
// Does not retune F5, enemies, rewards, classes, events, potions, or F10.
//
//   node tools/run_f48_probe.js --seed 20260823 --runs 1002
//   node tools/run_f48_probe.js --seed 20260823 --runs 1002 --out reports/f48_attrition.json

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { EVENTS } from '../js/data/events.js';
import { EVENT_TAG_MAP } from '../js/data/eventtagmap.js';
import { CONSUMABLES } from '../js/data/items.js';
import { MODIFIERS } from '../js/data/enemies.js';
import { simulateClimbV2, makeV2Run, classifyDeathCause } from './run_climb_v2.js';
import { baselinePolicy, scoreEventChoice } from './policies/baseline.js';
import { reasonablePolicy } from './policies/reasonable.js';
import {
  BASE_CLASSES, climbSeed, planDifficultyJobs, instrumentPolicy, makePolicy,
} from './run_difficulty.js';

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

export const STOP_AFTER = 9;
export const FLOORS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
export const DEATH_KINDS = [
  'trial', 'normal_encounter', 'elite', 'event_combat',
  'special_encounter', 'event_attrition', 'other',
];

const HONESTY = [
  'LIVE climb v2: dealLiveFloorCards, live events, live shop, headless combat_core.',
  'Climbs stop after F9 (Forest campfire). F10 is out of scope.',
  'Policy path RNG is seed^floor^0xA11CE and does not consume climb rngState.',
  'Trace/measurement code does not call runRng or rng.advance.',
  'Baseline shop never buys equipment — compare reasonable before treating gold/HP collapse as balance.',
  'Climb v2 trial floors pass the modifier into combat but do not spawn extraEnemy bodies the way live fightGroup does. Horde/Swarm F5 lethality here is a lower bound vs live.',
  'TDC.clearRate is a survival-CDF target for tools/run_sim.js, not live encounter frequency.',
];

export function outcomeHasCombat(o) {
  if (!o) return false;
  if (o.combat) return true;
  if (Array.isArray(o.randomOutcome) && o.randomOutcome.some(outcomeHasCombat)) return true;
  if (o.roll) return outcomeHasCombat(o.roll.success) || outcomeHasCombat(o.roll.fail);
  return false;
}

export function combatChoicesOf(ev) {
  return (ev?.choices || []).filter(c => outcomeHasCombat(c.outcome));
}

export function npcDuelEventIds() {
  return Object.entries(EVENT_TAG_MAP)
    .filter(([, tags]) => tags.includes('npc-duel'))
    .map(([id]) => id);
}

function combatRewardBlurb(choice) {
  const o = choice?.outcome || {};
  const combat = o.combat
    || (Array.isArray(o.randomOutcome) ? o.randomOutcome.find(x => x.combat)?.combat : null);
  if (!combat) return '';
  const bits = [];
  if (combat.xp) bits.push(`xp ${combat.xp}`);
  const r = combat.reward || {};
  if (r.npcDuelLoot) bits.push('epic+ class loot');
  if (r.farmerLoot) bits.push('farm loot');
  if (Array.isArray(r.options)) bits.push(r.options.map(x => x.id || x.kind).join('/'));
  if (r.guaranteed) bits.push('guaranteed spoils');
  if (r.uniqueItem) bits.push('UNIQUE');
  if (r.wrldItem) bits.push('WRLD');
  return bits.join(', ');
}

const LABEL_DANGER = /\b(fight|duel|spar|challenge|depose|wake him|prove it|pick a fight|answer the axe|hex|vigil)\b/i;
const HINT_HARD = /\b(hard fight|brutal|deadly|boss-tier|secret fight|elite spoils)\b/i;
const HINT_SOFT = /\b(easy scrap|sport|little gold)\b/i;
const BODY_DANGER = /\b(duel|fight|spar|contest|steel|blows|challenge)\b/i;

export function auditChoiceCommunication(ev, choice) {
  const label = choice.label || '';
  const hint = choice.hint || '';
  const body = `${ev.title || ''} ${ev.text || ''}`;
  const labelWarns = LABEL_DANGER.test(label);
  const bodyWarns = BODY_DANGER.test(body);
  const hintHard = HINT_HARD.test(hint);
  const hintSoft = HINT_SOFT.test(hint) || /\bsport\b/i.test(label);
  let kind = 'UNCLEAR';
  if (hintHard && !labelWarns && !bodyWarns) kind = 'HINT_ONLY';
  else if (labelWarns) kind = 'LABEL_WARNS';
  else if (bodyWarns) kind = 'BODY_WARNS';
  else if (hintHard) kind = 'HINT_WARNS';
  return {
    eventId: ev.id,
    title: ev.title,
    label,
    hint,
    labelWarns,
    bodyWarns,
    hintHard,
    hintSoft,
    hintHiddenWhenOff: true,
    kind,
    reward: combatRewardBlurb(choice),
    baselineScore: scoreEventChoice(choice),
  };
}

export function auditNpcDuels() {
  const ids = npcDuelEventIds();
  return ids.map(id => {
    const ev = EVENTS.find(e => e.id === id);
    if (!ev) return { eventId: id, missing: true };
    const fights = combatChoicesOf(ev);
    const safe = (ev.choices || []).filter(c => !outcomeHasCombat(c.outcome));
    const comm = fights.map(c => auditChoiceCommunication(ev, c));
    const bestFight = fights.length ? Math.max(...fights.map(c => scoreEventChoice(c))) : -Infinity;
    const bestSafe = safe.length ? Math.max(...safe.map(c => scoreEventChoice(c))) : -Infinity;
    const firstIsFight = fights[0] && ev.choices[0] === fights[0];
    return {
      eventId: id,
      title: ev.title,
      floorGate: ev.cond ? String(ev.cond) : 'none',
      fights: comm,
      baselinePrefersFight: bestFight > bestSafe,
      baselineTiePicksFirstFight: bestFight === bestSafe && firstIsFight,
      safeLabels: safe.map(c => c.label),
    };
  }).filter(r => !r.missing);
}

function emptyNotes() {
  return {
    ignoredRecoveryCard: 0,
    refusedShopHeal: 0,
    refusedAffordableGear: 0,
    boughtGear: 0,
    boughtConsumable: 0,
    shopHeals: 0,
    shopDecisions: 0,
    foughtWhileCritical: 0,
  };
}

function mean(values) {
  const nums = (values || []).filter(v => v != null && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function median(values) {
  const nums = (values || []).filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function pct(n, d) {
  return d ? n / d : 0;
}

function deathKind(rec) {
  if (!rec || rec.outcome !== 'dead') return null;
  const cause = rec.deathCause || classifyDeathCause(rec.kind, rec.meta, rec.floor);
  if (DEATH_KINDS.includes(cause)) return cause;
  return 'other';
}

function packKey(enemies) {
  return (enemies || []).map(e => e.id || e.name || '?').sort().join('+') || '(empty)';
}

function isHealChoice(label) {
  return /\b(heal|sleep|rest|bandage|potion|hospitality|mend)\b/i.test(label || '');
}

export async function runF48Climb({
  seed,
  classId = 'warrior',
  policy = 'baseline',
} = {}) {
  const notes = emptyNotes();
  const wrapped = instrumentPolicy(makePolicy(policy), notes);
  const run = makeV2Run({ seed, classId, kitSeed: seed, name: 'F48' });
  const startPotions = (run.consumables || []).filter(id => {
    const c = CONSUMABLES.find(x => x.id === id);
    return !!(c && (c.heal || c.healPct));
  }).length;
  const start = {
    hp: run.hp,
    maxHp: run.maxHp,
    hpPct: run.maxHp ? run.hp / run.maxHp : 0,
    gold: run.gold,
    potions: startPotions,
    healConsumables: startPotions,
    consumables: (run.consumables || []).length,
  };
  const result = await simulateClimbV2(run, wrapped, { stopAfterFloor: STOP_AFTER });
  const trace = result.trace || [];
  const death = trace.find(r => r.outcome === 'dead');
  const floors = trace.map(rec => ({
    floor: rec.floor,
    kind: rec.kind,
    biome: rec.biome,
    outcome: rec.outcome,
    deathCause: rec.outcome === 'dead' ? deathKind(rec) : null,
    eventId: rec.meta?.eventId || rec.picked?.eventId || null,
    choice: rec.meta?.choice || null,
    trialId: rec.meta?.trialId || null,
    combat: !!rec.meta?.combat,
    special: !!rec.meta?.special,
    elite: !!rec.meta?.elite,
    approach: rec.meta?.approach || null,
    enemies: rec.meta?.enemies || [],
    offered: rec.offered || null,
    picked: rec.picked || null,
    enter: rec.enter,
    leave: rec.leave,
  }));
  const byFloor = {};
  for (const rec of floors) byFloor[rec.floor] = rec;
  return {
    seed: result.seed,
    classId: result.classId,
    policy,
    outcome: result.outcome,
    deathFloor: result.deathFloor,
    maxFloor: result.checkpoint?.floor || 0,
    deathCause: death?.deathCause || null,
    deathEventId: death?.meta?.eventId || null,
    deathChoice: death?.meta?.choice || null,
    deathTrialId: death?.meta?.trialId || null,
    deathEnemies: (death?.meta?.enemies || []).map(e => e.id),
    start,
    notes,
    floors,
    byFloor,
  };
}

function bump(map, key, field, amt = 1) {
  if (!map[key]) map[key] = { id: key, n: 0, deaths: 0, hpEnter: [], hpLeaveWin: [] };
  map[key][field] = (map[key][field] || 0) + amt;
}

function pushHp(map, key, field, v) {
  if (!map[key]) map[key] = { id: key, n: 0, deaths: 0, hpEnter: [], hpLeaveWin: [] };
  if (v != null && Number.isFinite(v)) map[key][field].push(v);
}

function finishHpMap(map) {
  return Object.values(map).map(row => ({
    ...row,
    deathRate: pct(row.deaths, row.n),
    avgHpEnter: mean(row.hpEnter),
    avgHpLeaveWin: mean(row.hpLeaveWin),
    hpEnter: undefined,
    hpLeaveWin: undefined,
  })).sort((a, b) => b.deaths - a.deaths || b.deathRate - a.deathRate);
}

export function summarizeF48(climbs, { policy = 'baseline', seed = 0, nSeeds = 0 } = {}) {
  const n = climbs.length;
  const deaths = climbs.filter(c => c.outcome === 'dead');
  const curve = FLOORS.map(floor => {
    const entered = climbs.filter(c => (c.byFloor[floor] || c.maxFloor >= floor)).length;
    const rows = climbs.map(c => c.byFloor[floor]).filter(Boolean);
    const diedRows = rows.filter(r => r.outcome === 'dead');
    const byKind = {};
    for (const k of DEATH_KINDS) byKind[k] = { entered: 0, died: 0, rate: 0 };
    for (const r of rows) {
      let k = 'other';
      if (r.kind === 'trial') k = 'trial';
      else if (r.deathCause) k = r.deathCause;
      else if (r.kind === 'campfire') k = 'event_attrition';
      else if (r.special && r.combat) k = 'special_encounter';
      else if (r.eventId && r.combat) k = 'event_combat';
      else if (r.elite && r.combat) k = 'elite';
      else if (r.combat || r.kind === 'travel' && r.picked?.kind === 'encounter') k = 'normal_encounter';
      if (!byKind[k]) byKind[k] = { entered: 0, died: 0, rate: 0 };
      byKind[k].entered += 1;
      if (r.outcome === 'dead') byKind[k].died += 1;
    }
    for (const k of Object.keys(byKind)) byKind[k].rate = pct(byKind[k].died, byKind[k].entered);
    const byClass = {};
    for (const cid of BASE_CLASSES) {
      const clsRows = climbs.filter(c => c.classId === cid && c.byFloor[floor]);
      const clsDied = clsRows.filter(c => c.byFloor[floor].outcome === 'dead').length;
      byClass[cid] = { entered: clsRows.length, died: clsDied, rate: pct(clsDied, clsRows.length) };
    }
    return {
      floor,
      entered,
      died: diedRows.length,
      rate: pct(diedRows.length, entered),
      byKind,
      byClass,
    };
  });

  const f5Rows = climbs.map(c => c.byFloor[5]).filter(Boolean);
  const f5Clears = f5Rows.filter(r => r.outcome !== 'dead');
  const f5Deaths = f5Rows.filter(r => r.outcome === 'dead');
  const f5ByMod = {};
  const f5ByClass = {};
  const f5ByEnemy = {};
  for (const c of climbs) {
    const r = c.byFloor[5];
    if (!r) continue;
    const mod = r.trialId || 'unknown';
    bump(f5ByMod, mod, 'n');
    pushHp(f5ByMod, mod, 'hpEnter', r.enter?.hpPct);
    if (r.outcome === 'dead') bump(f5ByMod, mod, 'deaths');
    else pushHp(f5ByMod, mod, 'hpLeaveWin', r.leave?.hpPct);
    bump(f5ByClass, c.classId, 'n');
    pushHp(f5ByClass, c.classId, 'hpEnter', r.enter?.hpPct);
    if (r.outcome === 'dead') bump(f5ByClass, c.classId, 'deaths');
    else pushHp(f5ByClass, c.classId, 'hpLeaveWin', r.leave?.hpPct);
    const key = packKey(r.enemies);
    bump(f5ByEnemy, key, 'n');
    pushHp(f5ByEnemy, key, 'hpEnter', r.enter?.hpPct);
    if (r.outcome === 'dead') bump(f5ByEnemy, key, 'deaths');
  }

  const duelIds = new Set(npcDuelEventIds());
  const duels = {};
  for (const id of duelIds) {
    duels[id] = {
      eventId: id,
      offered: 0,
      takenCard: 0,
      fightTaken: 0,
      deaths: 0,
      hpEnterFight: [],
      hpLeaveWin: [],
      floors: [],
      choices: {},
    };
  }
  const eventCombat = {};
  const normalPacks = {};
  const attrition = {};
  for (const c of climbs) {
    for (const r of c.floors) {
      if (r.floor > STOP_AFTER) continue;
      for (const card of r.offered || []) {
        if (card.eventId && duels[card.eventId]) duels[card.eventId].offered += 1;
      }
      const eid = r.eventId;
      if (eid && duels[eid]) {
        duels[eid].takenCard += 1;
        duels[eid].floors.push(r.floor);
        const ch = r.choice || '(none)';
        duels[eid].choices[ch] = (duels[eid].choices[ch] || 0) + 1;
        if (r.combat) {
          duels[eid].fightTaken += 1;
          if (r.enter?.hpPct != null) duels[eid].hpEnterFight.push(r.enter.hpPct);
          if (r.outcome === 'dead') duels[eid].deaths += 1;
          else if (r.leave?.hpPct != null) duels[eid].hpLeaveWin.push(r.leave.hpPct);
        }
      }
      if (r.combat && eid && r.kind !== 'trial') {
        if (!eventCombat[eid]) eventCombat[eid] = { eventId: eid, n: 0, deaths: 0, hpEnter: [], special: 0 };
        eventCombat[eid].n += 1;
        eventCombat[eid].hpEnter.push(r.enter?.hpPct);
        if (r.special) eventCombat[eid].special += 1;
        if (r.outcome === 'dead') eventCombat[eid].deaths += 1;
      }
      if (r.kind !== 'trial' && r.picked?.kind === 'encounter' && r.approach === 'fight') {
        const key = packKey(r.enemies);
        bump(normalPacks, key, 'n');
        pushHp(normalPacks, key, 'hpEnter', r.enter?.hpPct);
        if (r.outcome === 'dead') bump(normalPacks, key, 'deaths');
        normalPacks[key].floors = normalPacks[key].floors || {};
        normalPacks[key].floors[r.floor] = (normalPacks[key].floors[r.floor] || 0) + 1;
      }
      if (r.eventId && !r.combat && r.kind !== 'trial') {
        if (!attrition[eid]) attrition[eid] = { eventId: eid, n: 0, deaths: 0, choices: {}, hpDelta: [] };
        attrition[eid].n += 1;
        attrition[eid].choices[r.choice || '(none)'] = (attrition[eid].choices[r.choice || '(none)'] || 0) + 1;
        if (r.enter && r.leave && r.enter.hp != null && r.leave.hp != null) {
          attrition[eid].hpDelta.push(r.leave.hp - r.enter.hp);
        }
        if (r.outcome === 'dead') attrition[eid].deaths += 1;
      }
    }
  }

  const duelTable = Object.values(duels).map(d => ({
    eventId: d.eventId,
    offered: d.offered,
    takenCard: d.takenCard,
    fightTaken: d.fightTaken,
    deaths: d.deaths,
    takeRateGivenOffer: pct(d.takenCard, d.offered),
    fightRateGivenTaken: pct(d.fightTaken, d.takenCard),
    deathRateWhenFought: pct(d.deaths, d.fightTaken),
    avgHpEnterFight: mean(d.hpEnterFight),
    avgHpLeaveWin: mean(d.hpLeaveWin),
    avgFloor: mean(d.floors),
    choices: d.choices,
  })).filter(d => d.offered || d.takenCard).sort((a, b) => b.deaths - a.deaths || b.fightTaken - a.fightTaken);

  const eventCombatTable = Object.values(eventCombat).map(e => ({
    ...e,
    deathRate: pct(e.deaths, e.n),
    avgHpEnter: mean(e.hpEnter),
    hpEnter: undefined,
  })).sort((a, b) => b.deathRate - a.deathRate || b.n - a.n);

  const attritionTable = Object.values(attrition).map(e => ({
    eventId: e.eventId,
    n: e.n,
    deaths: e.deaths,
    deathRate: pct(e.deaths, e.n),
    avgHpDelta: mean(e.hpDelta),
    choices: e.choices,
  })).filter(e => e.deaths > 0 || (e.avgHpDelta != null && e.avgHpDelta < -5))
    .sort((a, b) => b.deaths - a.deaths || (a.avgHpDelta || 0) - (b.avgHpDelta || 0));

  const normalTable = finishHpMap(normalPacks).map(row => ({
    pack: row.id,
    n: row.n,
    deaths: row.deaths,
    deathRate: row.deathRate,
    avgHpEnter: row.avgHpEnter,
    floors: normalPacks[row.id]?.floors || {},
  }));

  function markAt(climbs, floor, when) {
    const rows = [];
    for (const c of climbs) {
      if (floor === 0) {
        rows.push(c.start);
        continue;
      }
      const rec = c.byFloor[floor];
      if (!rec) continue;
      rows.push(when === 'leave' ? rec.leave : rec.enter);
    }
    return {
      n: rows.length,
      hp: mean(rows.map(r => r?.hp)),
      maxHp: mean(rows.map(r => r?.maxHp)),
      hpPct: mean(rows.map(r => r?.hpPct)),
      gold: mean(rows.map(r => r?.gold)),
      potions: mean(rows.map(r => r?.healConsumables ?? r?.potions)),
      consumables: mean(rows.map(r => r?.consumables)),
    };
  }

  const f5Survivors = climbs.filter(c => c.byFloor[5] && c.byFloor[5].outcome !== 'dead');
  const f5Low = f5Survivors.filter(c => (c.byFloor[5].leave?.hpPct || 0) < 0.40);
  const f5LowDeadBy9 = f5Low.filter(c => c.outcome === 'dead' && c.deathFloor != null && c.deathFloor <= 8);
  const f5LowReach9 = f5Low.filter(c => !!c.byFloor[9]);
  const recovered = f5Low.filter(c => {
    const f7 = c.byFloor[7]?.enter?.hpPct;
    const f9 = c.byFloor[9]?.enter?.hpPct;
    return (f7 != null && f7 >= 0.55) || (f9 != null && f9 >= 0.55);
  });

  let shops = 0, shopHeals = 0, healChoices = 0, campfires = 0, potionsBought = 0;
  let potionDelta = [];
  for (const c of climbs) {
    shopHeals += c.notes?.shopHeals || 0;
    potionsBought += c.notes?.boughtConsumable || 0;
    for (const r of c.floors) {
      if (r.floor > STOP_AFTER) continue;
      if (r.picked?.kind === 'event' && /merchant|shop/.test(r.picked.category || '')) shops += 1;
      if (r.eventId === 'merchant' || r.eventId === 'bog_barter') shops += 1;
      if (r.kind === 'campfire') campfires += 1;
      if (isHealChoice(r.choice)) healChoices += 1;
      if (r.enter && r.leave && r.enter.healConsumables != null && r.leave.healConsumables != null) {
        const d = r.leave.healConsumables - r.enter.healConsumables;
        if (d < 0) potionDelta.push(-d);
      }
    }
  }

  const byClass = {};
  for (const cid of BASE_CLASSES) {
    const slice = climbs.filter(c => c.classId === cid);
    const f5 = slice.filter(c => c.byFloor[5]);
    const f5Live = f5.filter(c => c.byFloor[5].outcome !== 'dead');
    const causes = {};
    const events = {};
    for (const c of slice) {
      if (c.outcome !== 'dead' || c.deathFloor == null || c.deathFloor > 8) continue;
      const k = c.deathCause || 'unknown';
      causes[k] = (causes[k] || 0) + 1;
      if (c.deathEventId) events[c.deathEventId] = (events[c.deathEventId] || 0) + 1;
    }
    byClass[cid] = {
      n: slice.length,
      f5Arrived: f5.length,
      f5Survival: pct(f5Live.length, f5.length),
      f6Reach: pct(slice.filter(c => c.byFloor[6]).length, slice.length),
      f8Reach: pct(slice.filter(c => c.byFloor[8]).length, slice.length),
      f9Reach: pct(slice.filter(c => c.byFloor[9]).length, slice.length),
      earlyBrick: pct(slice.filter(c => c.outcome === 'dead' && c.deathFloor != null && c.deathFloor < 6).length, slice.length),
      medianDeathFloor: median(slice.filter(x => x.outcome === 'dead').map(x => x.deathFloor)),
      deathCauses: Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([cause, n]) => ({ cause, n })),
      deathEvents: Object.entries(events).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([eventId, n]) => ({ eventId, n })),
      f5HpEnter: mean(f5.map(c => c.byFloor[5].enter?.hpPct)),
      f5HpLeaveWin: mean(f5Live.map(c => c.byFloor[5].leave?.hpPct)),
    };
  }

  const notesSum = climbs.reduce((acc, c) => {
    for (const [k, v] of Object.entries(c.notes || {})) acc[k] = (acc[k] || 0) + v;
    return acc;
  }, {});

  const f5Verdict = classifyF5({
    arrived: f5Rows.length,
    died: f5Deaths.length,
    clearRate: pct(f5Clears.length, f5Rows.length),
    byClass: finishHpMap(f5ByClass),
    byMod: finishHpMap(f5ByMod),
    curve,
  });

  return {
    meta: {
      name: `F48_${policy}`,
      seed,
      policy,
      n,
      nSeeds,
      stopAfter: STOP_AFTER,
      generatedAt: new Date().toISOString(),
      honesty: HONESTY,
    },
    overall: {
      n,
      deaths: deaths.length,
      medianDeathFloor: median(deaths.map(c => c.deathFloor)),
      earlyBrickRate: pct(climbs.filter(c => c.outcome === 'dead' && c.deathFloor != null && c.deathFloor < 6).length, n),
      reachF6: pct(climbs.filter(c => c.byFloor[6]).length, n),
      reachF8: pct(climbs.filter(c => c.byFloor[8]).length, n),
      reachF9: pct(climbs.filter(c => c.byFloor[9]).length, n),
      diedByF8: deaths.filter(c => c.deathFloor != null && c.deathFloor <= 8).length,
      f48Causes: (() => {
        const counts = {};
        for (const c of climbs) {
          for (const rec of c.floors) {
            if (rec.floor < 4 || rec.floor > 8 || rec.outcome !== 'dead') continue;
            const k = rec.kind === 'trial' ? 'trial' : (rec.deathCause || 'other');
            counts[k] = (counts[k] || 0) + 1;
          }
        }
        return counts;
      })(),
    },
    curve,
    f5: {
      arrived: f5Rows.length,
      died: f5Deaths.length,
      clearRate: pct(f5Clears.length, f5Rows.length),
      avgHpEnter: mean(f5Rows.map(r => r.enter?.hpPct)),
      avgHpEnterAbs: mean(f5Rows.map(r => r.enter?.hp)),
      avgHpLeaveWin: mean(f5Clears.map(r => r.leave?.hpPct)),
      avgPotionsEnter: mean(f5Rows.map(r => r.enter?.healConsumables)),
      byMod: finishHpMap(f5ByMod),
      byClass: finishHpMap(f5ByClass),
      byEnemy: finishHpMap(f5ByEnemy).slice(0, 12),
      verdict: f5Verdict,
    },
    duels: duelTable,
    eventCombat: eventCombatTable.slice(0, 20),
    attrition: attritionTable.slice(0, 15),
    normalEncounters: normalTable.slice(0, 20),
    recovery: {
      start: markAt(climbs, 0),
      beforeF4: markAt(climbs, 4, 'enter'),
      beforeF5: markAt(climbs, 5, 'enter'),
      afterF5: markAt(f5Survivors, 5, 'leave'),
      beforeF7: markAt(climbs, 7, 'enter'),
      beforeF9: markAt(climbs, 9, 'enter'),
      f5LowHpSurvivors: f5Low.length,
      f5LowDiedByF8: f5LowDeadBy9.length,
      f5LowReachedF9: f5LowReach9.length,
      f5LowRecovered: recovered.length,
      spiralRate: pct(f5LowDeadBy9.length, f5Low.length),
      shops,
      shopHeals,
      potionsBought,
      healChoices,
      campfires,
      potionsUsedApprox: potionDelta.reduce((a, b) => a + b, 0),
    },
    byClass,
    policyNotes: notesSum,
  };
}

function classifyF5({ arrived, died, clearRate, byClass, byMod, curve }) {
  const f4 = curve.find(r => r.floor === 4);
  const f6 = curve.find(r => r.floor === 6);
  const classRates = (byClass || []).map(r => r.deathRate);
  const spread = classRates.length ? Math.max(...classRates) - Math.min(...classRates) : 0;
  const worstMod = [...(byMod || [])].sort((a, b) => b.deathRate - a.deathRate)[0];
  const labels = [];
  if (clearRate >= 0.88) labels.push('healthy first gate');
  else if (clearRate >= 0.75) labels.push('spicy but acceptable');
  else labels.push('clear outlier');
  if (spread >= 0.18) labels.push('class-specific problem');
  return {
    labels,
    arrived,
    died,
    clearRate,
    f4Rate: f4?.rate || 0,
    f6Rate: f6?.rate || 0,
    classSpread: spread,
    worstMod: worstMod ? { id: worstMod.id, deathRate: worstMod.deathRate, n: worstMod.n } : null,
  };
}

export function classifySources(rep, other = null) {
  const out = [];
  const f5 = rep.f5;
  const f5Label = f5.verdict.labels.includes('class-specific problem')
    ? 'CLASS-SPECIFIC'
    : (f5.verdict.labels.includes('clear outlier') ? 'LIKELY BALANCE ISSUE' : 'LIKELY HEALTHY DIFFICULTY');
  out.push({
    source: 'F5 trial',
    label: f5Label,
    note: `clear ${pctLabel(f5.clearRate)} of ${f5.arrived} arrivals; F4 ${pctLabel(f5.verdict.f4Rate)} → F5 ${pctLabel(1 - f5.clearRate)} → F6 ${pctLabel(f5.verdict.f6Rate)}. ${f5.verdict.labels.join('; ')}.`,
  });

  const lethalDuels = (rep.duels || []).filter(d => d.fightTaken >= 8 && d.deathRateWhenFought >= 0.45);
  const staticDuels = auditNpcDuels();
  const galleryLethal = lethalDuels.filter(d => /_meet$/.test(d.eventId) && d.eventId !== 'farmstead_meet' && d.eventId !== 'pathfinder_meet' && d.eventId !== 'blade_hero_meet');
  if (galleryLethal.length) {
    const fights = galleryLethal.reduce((a, d) => a + d.fightTaken, 0);
    const deaths = galleryLethal.reduce((a, d) => a + d.deaths, 0);
    out.push({
      source: 'gallery NPC duels (F4–8)',
      label: 'LIKELY BALANCE ISSUE',
      note: `${galleryLethal.length} hero/wizard meets, ${deaths}/${fights} deaths when fought (${pctLabel(pct(deaths, fights))}). Labels say "duel"; default policies no longer take them for hidden loot.`,
    });
  }
  for (const d of lethalDuels.filter(x => !galleryLethal.includes(x)).slice(0, 4)) {
    const st = staticDuels.find(s => s.eventId === d.eventId);
    const hintOnly = st?.fights?.some(f => f.kind === 'HINT_ONLY');
    const prefers = st?.baselinePrefersFight || st?.baselineTiePicksFirstFight;
    let label = 'LIKELY BALANCE ISSUE';
    if (hintOnly) label = 'LIKELY COMMUNICATION ISSUE';
    else if (prefers && d.deathRateWhenFought < 0.5) label = 'LIKELY POLICY ISSUE';
    out.push({
      source: `optional duel ${d.eventId}`,
      label,
      note: `fought ${d.fightTaken}/${d.offered} offers, death ${pctLabel(d.deathRateWhenFought)} when taken`
        + (prefers ? '; baseline keyword/tiebreak prefers the fight' : '')
        + (hintOnly ? '; danger lives in the outcome hint' : ''),
    });
  }

  const frequentPacks = (rep.normalEncounters || []).filter(p => p.n >= 20);
  const hotPacks = frequentPacks.filter(p => p.deathRate >= 0.12);
  if (hotPacks.length) {
    out.push({
      source: 'normal encounters (conditional)',
      label: 'LIKELY BALANCE ISSUE',
      note: hotPacks.slice(0, 3).map(p => `${p.pack} ${p.deaths}/${p.n} (${pctLabel(p.deathRate)})`).join('; '),
    });
  } else {
    const top = [...frequentPacks].sort((a, b) => b.deathRate - a.deathRate)[0];
    out.push({
      source: 'normal encounters',
      label: 'LIKELY HEALTHY DIFFICULTY',
      note: top
        ? `among n≥20 packs, highest ${top.pack} ${top.deaths}/${top.n} (${pctLabel(top.deathRate)}); most F4–8 deaths are not ordinary trash.`
        : 'no n≥20 ordinary packs in this sample.',
    });
  }

  const mira = (rep.attrition || []).find(e => e.eventId === 'wounded_adventurer');
  const miraEv = EVENTS.find(e => e.id === 'wounded_adventurer');
  const miraHeal = miraEv?.choices?.find(c => /heal her/i.test(c.label || ''));
  const miraWarns = /vitality|own life|your (?:own )?health/i.test(`${miraHeal?.label || ''} ${miraEv?.text || ''}`);
  if (mira && (mira.deaths > 0 || (mira.avgHpDelta || 0) < -10) && !miraWarns) {
    out.push({
      source: 'wounded_adventurer Heal her',
      label: 'LIKELY COMMUNICATION ISSUE',
      note: `n=${mira.n} deaths=${mira.deaths} avg HP Δ ${mira.avgHpDelta?.toFixed?.(1) ?? mira.avgHpDelta}. Label hides the vitality cost behind the outcome hint.`,
    });
  }

  const classSpread = Object.values(rep.byClass || {}).map(r => r.f5Survival);
  if (classSpread.length && Math.max(...classSpread) - Math.min(...classSpread) >= 0.18) {
    const rows = Object.entries(rep.byClass).sort((a, b) => a[1].f5Survival - b[1].f5Survival);
    out.push({
      source: 'class F5 survival spread',
      label: 'CLASS-SPECIFIC',
      note: rows.map(([id, r]) => `${id} ${pctLabel(r.f5Survival)}`).join(', '),
    });
  }

  if (other) {
    const brickDrop = (rep.overall.earlyBrickRate || 0) - (other.overall.earlyBrickRate || 0);
    const f8Lift = (other.overall.reachF8 || 0) - (rep.overall.reachF8 || 0);
    out.push({
      source: 'policy vs game (baseline → reasonable)',
      label: Math.abs(brickDrop) >= 0.04 || f8Lift >= 0.08 ? 'LIKELY POLICY ISSUE' : 'UNCLEAR',
      note: `early brick ${pctLabel(rep.overall.earlyBrickRate)} → ${pctLabel(other.overall.earlyBrickRate)}; F8 reach ${pctLabel(rep.overall.reachF8)} → ${pctLabel(other.overall.reachF8)}.`,
    });
  }

  const hintOnly = staticDuels.filter(s => {
    const late = /world_witness|frost_revenant|memory_of_a_king|crowned_shadow|cursed_knight/.test(s.eventId);
    return !late && s.fights?.some(f => f.kind === 'HINT_ONLY');
  });
  if (hintOnly.length) {
    out.push({
      source: 'risk communication with hints OFF',
      label: 'LIKELY COMMUNICATION ISSUE',
      note: hintOnly.map(s => s.eventId).join(', '),
    });
  }

  return out;
}

export function pickIssues(sources) {
  const rank = {
    'LIKELY COMMUNICATION ISSUE': 3,
    'LIKELY POLICY ISSUE': 2,
    'LIKELY BALANCE ISSUE': 2,
    'CLASS-SPECIFIC': 1,
    'UNCLEAR': 0,
    'LIKELY HEALTHY DIFFICULTY': -1,
  };
  const prefer = ['gallery NPC duels', 'wounded_adventurer', 'risk communication'];
  return [...sources]
    .filter(s => (rank[s.label] || 0) > 0 && s.source !== 'F5 trial')
    .sort((a, b) => {
      const pa = prefer.findIndex(p => a.source.includes(p));
      const pb = prefer.findIndex(p => b.source.includes(p));
      const pref = (pa === -1 ? 9 : pa) - (pb === -1 ? 9 : pb);
      if (pref) return pref;
      return (rank[b.label] || 0) - (rank[a.label] || 0);
    })
    .slice(0, 3);
}

function pctLabel(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

export async function runF48Probe({
  seed = 20260823,
  runs = 1002,
  policies = ['baseline', 'reasonable'],
  classId = null,
  classes = BASE_CLASSES,
} = {}) {
  const { jobs, nSeeds } = planDifficultyJobs({ seed, runs, classId, classes });
  const byPolicy = {};
  for (const policy of policies) {
    const climbs = [];
    for (const job of jobs) {
      climbs.push(await runF48Climb({ seed: job.seed, classId: job.classId, policy }));
    }
    byPolicy[policy] = summarizeF48(climbs, { policy, seed, nSeeds });
  }
  const sample = byPolicy.baseline || Object.values(byPolicy)[0] || null;
  const reasonable = byPolicy.reasonable || null;
  const communication = auditNpcDuels();
  const sources = sample ? classifySources(sample, reasonable) : [];
  const issues = pickIssues(sources);
  return {
    meta: {
      name: 'F48_ATTRITION',
      seed,
      runs: jobs.length,
      nSeeds,
      policies,
      stopAfter: STOP_AFTER,
      generatedAt: new Date().toISOString(),
      honesty: HONESTY,
    },
    byPolicy,
    communication,
    sources,
    issues,
    verdict: medianVerdict(byPolicy.baseline || null, reasonable, sources),
  };
}

function medianVerdict(baseline, reasonable, sources) {
  if (!baseline) return { label: 'UNCLEAR', note: 'no baseline sample' };
  const med = baseline.overall.medianDeathFloor;
  const brick = baseline.overall.earlyBrickRate;
  const f5 = 1 - (baseline.f5?.clearRate || 0);
  const policyBrick = reasonable ? reasonable.overall.earlyBrickRate : null;
  const policyMed = reasonable ? reasonable.overall.medianDeathFloor : null;
  const policyLift = policyBrick != null ? brick - policyBrick : 0;
  const f8 = baseline.overall.reachF8;
  const f8R = reasonable?.overall.reachF8;
  const optionalShare = sources.filter(s => /optional duel|wounded_adventurer|policy vs game/.test(s.source) && s.label === 'LIKELY POLICY ISSUE').length;
  if (policyLift >= 0.06 && optionalShare) {
    return {
      label: 'avoidable early-game problem (policy-heavy)',
      note: `Median death floor ${med} with ${pctLabel(brick)} early brick. Reasonable policy moves brick to ${pctLabel(policyBrick)} and median to ${policyMed}. A large slice of F4–8 deaths is optional fights / keyword scoring, not ordinary Forest trash.`,
    };
  }
  if (f5 >= 0.20 && f8 < 0.55) {
    return {
      label: 'spicy gate plus attrition, not only F10',
      note: `F5 kills ${pctLabel(f5)} of arrivals and F8 reach is ${pctLabel(f8)}. Median ${med} is a Forest problem, not just the F10 wall.`,
    };
  }
  return {
    label: 'mixed: some healthy danger, some avoidable',
    note: `Median death floor ${med}, early brick ${pctLabel(brick)}, F5 death ${pctLabel(f5)}, F8 reach ${pctLabel(f8)}`
      + (f8R != null ? ` (reasonable F8 ${pctLabel(f8R)})` : '')
      + '. Treat optional-duel and hint-off communication separately from ordinary encounter tuning.',
  };
}

export function formatF48Report(rep) {
  const policyKeys = Object.keys(rep.byPolicy || {});
  const b = rep.byPolicy?.baseline || (policyKeys[0] ? rep.byPolicy[policyKeys[0]] : null);
  const r = rep.byPolicy?.reasonable;
  const primary = b?.meta?.policy || 'baseline';
  const lines = [];
  lines.push(`DungeonTogether F4–8 attrition — seed ${rep.meta.seed}  climbs/policy ${rep.meta.runs}  stop F${rep.meta.stopAfter}`);
  lines.push(rep.meta.honesty[5]);
  lines.push('');
  if (b) {
    lines.push(`1. F1–9 mortality curve (${primary})`);
    lines.push(`   among F1–8 deaths: ${b.overall.diedByF8}/${b.overall.n}  median of those deaths ${b.overall.medianDeathFloor}   early brick ${pctLabel(b.overall.earlyBrickRate)}   F8 reach ${pctLabel(b.overall.reachF8)}   F9 reach ${pctLabel(b.overall.reachF9)}`);
    lines.push(`   F4–8 death mix: ${Object.entries(b.overall.f48Causes || {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
    lines.push('   (Full-run median 8 includes F10 harvesting the F9 survivors. This probe stops at F9.)');
    for (const row of b.curve) {
      const kinds = Object.entries(row.byKind)
        .filter(([, v]) => v.died)
        .map(([k, v]) => `${k} ${v.died}`)
        .join(', ') || 'none';
      lines.push(`   F${row.floor}  entered ${String(row.entered).padStart(4)}  died ${String(row.died).padStart(3)}  ${pctLabel(row.rate).padStart(6)}  [${kinds}]`);
    }
    lines.push('');
    lines.push('2. F5 trial');
    const f = b.f5;
    lines.push(`   arrived ${f.arrived}  died ${f.died}  clear ${pctLabel(f.clearRate)}  hp in ${pctLabel(f.avgHpEnter)} (${f.avgHpEnterAbs?.toFixed?.(1)})  hp out (win) ${pctLabel(f.avgHpLeaveWin)}  potions ${f.avgPotionsEnter?.toFixed?.(2)}`);
    lines.push(`   verdict: ${f.verdict.labels.join('; ')}`);
    for (const m of f.byMod) {
      lines.push(`     mod ${String(m.id).padEnd(18)} n ${m.n}  die ${pctLabel(m.deathRate)}  hpIn ${pctLabel(m.avgHpEnter)}  hpOut ${pctLabel(m.avgHpLeaveWin)}`);
    }
    for (const c of f.byClass) {
      lines.push(`     class ${String(c.id).padEnd(10)} n ${c.n}  die ${pctLabel(c.deathRate)}  hpIn ${pctLabel(c.avgHpEnter)}  hpOut ${pctLabel(c.avgHpLeaveWin)}`);
    }
    lines.push('');
    lines.push(`3. Optional duels (${primary})`);
    for (const d of (b.duels || []).slice(0, 16)) {
      lines.push(`   ${d.eventId.padEnd(24)} offer ${d.offered}  take ${d.takenCard}  fight ${d.fightTaken}  die ${d.deaths}  when-fought ${pctLabel(d.deathRateWhenFought)}  hpIn ${pctLabel(d.avgHpEnterFight)}  hpOut ${pctLabel(d.avgHpLeaveWin)}`);
    }
    if (r) {
      lines.push('   reasonable fights/deaths:');
      for (const d of (r.duels || []).filter(x => x.fightTaken || x.deaths).slice(0, 16)) {
        lines.push(`     ${d.eventId.padEnd(24)} fight ${d.fightTaken}  die ${d.deaths}  when-fought ${pctLabel(d.deathRateWhenFought)}`);
      }
    }
    lines.push('');
    lines.push('4. Normal encounters (fight approach, conditional, n≥15)');
    const packs = (b.normalEncounters || []).filter(p => p.n >= 15).sort((a, b) => b.deathRate - a.deathRate || b.n - a.n);
    for (const p of packs.slice(0, 10)) {
      lines.push(`   ${p.pack.padEnd(28)} n ${String(p.n).padStart(4)}  die ${p.deaths}  ${pctLabel(p.deathRate)}  hpIn ${pctLabel(p.avgHpEnter)}`);
    }
    if (!packs.length) lines.push('   no ordinary packs with n≥15 deaths/fights');
    lines.push('');
    lines.push('5. HP / recovery');
    const rec = b.recovery;
    const mark = (name, m) => `   ${name.padEnd(12)} n ${m.n}  hp ${pctLabel(m.hpPct)} (${m.hp?.toFixed?.(1)})  gold ${m.gold?.toFixed?.(0)}  pots ${m.potions?.toFixed?.(2)}`;
    lines.push(mark('start', rec.start));
    lines.push(mark('before F4', rec.beforeF4));
    lines.push(mark('before F5', rec.beforeF5));
    lines.push(mark('after F5', rec.afterF5));
    lines.push(mark('before F7', rec.beforeF7));
    lines.push(mark('before F9', rec.beforeF9));
    lines.push(`   F5 leave <40% HP: ${rec.f5LowHpSurvivors}  of whom died by F8: ${rec.f5LowDiedByF8} (${pctLabel(rec.spiralRate)})  recovered: ${rec.f5LowRecovered}`);
    lines.push(`   shops ${rec.shops}  shop heals ${rec.shopHeals}  potions bought ${rec.potionsBought}  heal-choices ${rec.healChoices}  campfires ${rec.campfires}  potions used~ ${rec.potionsUsedApprox}`);
    lines.push('   event attrition (HP loss / deaths):');
    for (const e of (b.attrition || []).slice(0, 8)) {
      lines.push(`     ${e.eventId.padEnd(24)} n ${e.n}  die ${e.deaths}  avgΔHP ${e.avgHpDelta?.toFixed?.(1)}`);
    }
    lines.push('');
    lines.push(`6. Per-class early survival (${primary})`);
    for (const [cid, row] of Object.entries(b.byClass)) {
      const causes = (row.deathCauses || []).slice(0, 3).map(x => `${x.cause} ${x.n}`).join(', ');
      lines.push(`   ${cid.padEnd(10)} F5 ${pctLabel(row.f5Survival)}  F6 ${pctLabel(row.f6Reach)}  F8 ${pctLabel(row.f8Reach)}  brick ${pctLabel(row.earlyBrick)}  [${causes}]`);
    }
    lines.push('');
    lines.push('7. Policy vs game');
    if (r) {
      lines.push(`   ${primary.padEnd(10)} brick ${pctLabel(b.overall.earlyBrickRate)}  F8 ${pctLabel(b.overall.reachF8)}  median ${b.overall.medianDeathFloor}  F5 clear ${pctLabel(b.f5.clearRate)}`);
      lines.push(`   reasonable brick ${pctLabel(r.overall.earlyBrickRate)}  F8 ${pctLabel(r.overall.reachF8)}  median ${r.overall.medianDeathFloor}  F5 clear ${pctLabel(r.f5.clearRate)}`);
      lines.push(`   baseline notes: ignored recovery ${b.policyNotes.ignoredRecoveryCard || 0}  refused shop heal ${b.policyNotes.refusedShopHeal || 0}  fought critical ${b.policyNotes.foughtWhileCritical || 0}  shop heals ${b.policyNotes.shopHeals || 0}`);
      lines.push(`   reasonable notes: ignored recovery ${r.policyNotes.ignoredRecoveryCard || 0}  refused shop heal ${r.policyNotes.refusedShopHeal || 0}  fought critical ${r.policyNotes.foughtWhileCritical || 0}  shop heals ${r.policyNotes.shopHeals || 0}  bought pots ${r.policyNotes.boughtConsumable || 0}  bought gear ${r.policyNotes.boughtGear || 0}`);
    }
    lines.push('');
  }
  lines.push('8. Risk communication (hints OFF)');
  const miraEv = EVENTS.find(e => e.id === 'wounded_adventurer');
  const miraHeal = miraEv?.choices?.find(c => /heal her/i.test(c.label));
  if (miraHeal) {
    lines.push(`   wounded_adventurer: "${miraHeal.label}"  hint="${miraHeal.hint}"`);
  }
  const forestHintOnly = (rep.communication || []).filter(ev => {
    const late = /world_witness|frost_revenant|memory_of_a_king|crowned_shadow|cursed_knight/.test(ev.eventId);
    return !late && ev.fights?.some(f => f.kind === 'HINT_ONLY' || f.hintSoft);
  });
  for (const ev of forestHintOnly) {
    for (const f of ev.fights || []) {
      if (f.kind === 'HINT_ONLY' || f.hintSoft) {
        lines.push(`   ${ev.eventId}: "${f.label}"  kind=${f.kind}  hint="${f.hint}"  baselineScore=${f.baselineScore}`
          + (ev.baselinePrefersFight ? '  BASELINE PREFERS FIGHT' : '')
          + (ev.baselineTiePicksFirstFight ? '  TIE → first (fight)' : ''));
      }
    }
  }
  const shown = new Set();
  for (const ev of rep.communication || []) {
    if (ev.baselinePrefersFight || ev.baselineTiePicksFirstFight) {
      const f = ev.fights?.[0];
      const key = ev.eventId;
      if (shown.has(key)) continue;
      shown.add(key);
      lines.push(`   ${ev.eventId}: baseline ${ev.baselinePrefersFight ? 'keyword-picks fight' : 'tiebreak first=fight'}  label="${f?.label}" hint="${f?.hint}"`);
    }
  }
  lines.push('');
  lines.push('9. At most 3 issues worth fixing (no live changes this pass)');
  for (const issue of (rep.issues || []).slice(0, 3)) {
    lines.push(`   [${issue.label}] ${issue.source}: ${issue.note}`);
  }
  if (!rep.issues?.length) lines.push('   none above the measurement bar');
  lines.push('');
  lines.push('10. Classification + median-floor verdict');
  for (const s of rep.sources || []) lines.push(`   [${s.label}] ${s.source} — ${s.note}`);
  lines.push(`   VERDICT: ${rep.verdict?.label}`);
  lines.push(`   ${rep.verdict?.note}`);
  return lines.join('\n');
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const body = a.replace(/^--/, '');
    if (body.includes('=')) {
      const [k, v] = body.split('=');
      flags[k] = v;
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      flags[body] = next;
      i += 1;
    } else {
      flags[body] = true;
    }
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const seed = Number(flags.seed || 20260823);
  const runs = Number(flags.runs || 1002);
  const classId = flags.class || null;
  const policies = String(flags.policies || 'baseline,reasonable').split(',').map(s => s.trim()).filter(Boolean);
  const out = flags.out || 'reports/f48_attrition.json';
  const rep = await runF48Probe({ seed, runs, policies, classId });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(rep, null, 2));
  console.log(formatF48Report(rep));
  console.log(`\nwrote ${out}`);
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/run_f48_probe.js');
if (isMain) main();
