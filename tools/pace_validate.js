// Distribution-level check for the narrative pacing layer.
// Compares seeded climbs with vs without pace terms. Does not retune.

import { makeRng } from '../js/rng.js';
import { EVENTS, eventDrawPool, drawEvent } from '../js/data/events.js';
import { eventDrawWeight, explainDrawWeight, eventRole, callbackAge } from '../js/data/eventpace.js';
import {
  applyWorldPatch, applyFlagBridge, ensureWorld, recordEvent, eventEligible,
  cloneRunState, SECRET_ROUTES,
} from '../js/data/world.js';
import { newRun } from '../js/state.js';
import { biomeForFloor } from '../js/data/enemies.js';
import { generateFloorCards, classifyFloor, eventById, isNarrativeEvent } from '../js/data/floorcards.js';
import { simulateHealthClimb } from './run_health_climb.js';
import { createSimRun } from './sim_run_state.js';

const IMPORTANT_CALLBACKS = [
  { id: 'bard_returns', flag: 'bard_friend', floorMin: 1 },
  { id: 'mira_grudge', flag: 'left_climber', floorMin: 14 },
  { id: 'mira_watch', flag: 'saved_climber', floorMin: 42 },
  { id: 'climber_returns', flag: 'saved_climber', floorMin: 16 },
  { id: 'kings_echo', flag: 'kings_petition', floorMin: 22 },
  { id: 'kings_favor', flag: 'kings_bowed', floorMin: 21 },
  { id: 'witch_remembers', event: 'witch_hut', floorMin: 34 },
  { id: 'oathbound_watch', event: 'blade_hero_meet', floorMin: 18 },
  { id: 'oathbound_gate', event: 'blade_hero_meet', floorMin: 44 },
  { id: 'bard_last_song', flag: 'bard_friend', knowledge: 'heard_own_verse', classId: 'bard', floorMin: 43 },
];

function mean(xs) {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
function pct(n, d) {
  return d ? (100 * n) / d : 0;
}
function quantile(xs, q) {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const i = Math.min(a.length - 1, Math.max(0, Math.floor((a.length - 1) * q)));
  return a[i];
}
function fmt(n, d = 2) {
  return Number.isFinite(n) ? n.toFixed(d) : '—';
}

function climbHasPrereq(r, spec) {
  const flags = r.finalFlags || r.keysAt51?.flags || r.keysAt40?.flags || [];
  const knowledge = r.finalKnowledge || r.keysAt51?.knowledge || [];
  const seen = r.finalSeen || r.takenEventIds || [];
  if (spec.flag && flags.includes(spec.flag)) return true;
  if (spec.knowledge && knowledge.includes(spec.knowledge)) return true;
  if (spec.event && seen.includes(spec.event)) return true;
  if (spec.classId && r.classId === spec.classId) return true;
  return false;
}

function summarizeImportant(rows) {
  const out = {};
  for (const spec of IMPORTANT_CALLBACKS) {
    const eligible = rows.filter(r => (r.maxFloor || 0) >= spec.floorMin && climbHasPrereq(r, spec));
    const offered = eligible.filter(r => (r.offeredEventIds || []).includes(spec.id)
      || (r.lateOfferPayoff || []).includes(spec.id));
    const taken = eligible.filter(r => (r.takenEventIds || []).includes(spec.id)
      || (r.lateTakenPayoff || []).includes(spec.id));
    out[spec.id] = {
      eligible: eligible.length,
      offered: offered.length,
      taken: taken.length,
      neverPct: pct(eligible.length - offered.length, eligible.length),
    };
  }
  return out;
}

function summarizeRepeats(rows) {
  const npcRepeats = rows.map(r => Math.max(0, ...Object.values(r.npcSeen || {}), 0));
  const familyCounts = {};
  let familyRepeats = 0;
  let familyOpens = 0;
  for (const r of rows) {
    for (const [fam, fl] of Object.entries(r.familyFirstTaken || {})) {
      familyCounts[fam] = (familyCounts[fam] || 0) + 1;
      familyOpens += 1;
    }
    familyRepeats += (r.callbackTaken || []).length;
  }
  return {
    meanMaxNpcOffers: mean(npcRepeats),
    climbsWithNpc3: rows.filter(r => Object.values(r.npcSeen || {}).some(n => n >= 3)).length,
    familyOpens,
    familyCallbackTakes: familyRepeats,
    topFamilies: Object.entries(familyCounts).sort((a, b) => b[1] - a[1]).slice(0, 6),
  };
}

function summarizeClimbs(rows) {
  const delays = rows.flatMap(r => r.prereqDelays || []);
  const early = delays.filter(d => d <= 1).length;
  const secrets = rows.flatMap(r => Object.values(r.secrets || {}));
  const became = secrets.filter(s => s.eligibleFloor != null);
  const offered = became.filter(s => s.offeredFloor != null);
  const nextFloor = offered.filter(s => (s.offerDelay ?? 99) <= 1).length;
  const never = became.filter(s => s.offeredFloor == null).length;
  const lateOffer = rows.reduce((s, r) => s + (r.lateOfferPayoff || []).length, 0);
  const lateTaken = rows.reduce((s, r) => s + (r.lateTakenPayoff || []).length, 0);
  const lateFloors = rows.reduce((s, r) => s + Math.max(0, (r.maxFloor || 0) - 39), 0);
  const reached40 = rows.filter(r => (r.maxFloor || 0) >= 40);
  return {
    n: rows.length,
    nReached40: reached40.length,
    nCleared: rows.filter(r => r.cleared).length,
    narrativePer10: mean(rows.map(r => r.narrativeTakenPer10 || 0)),
    narrativeOfferPer10: mean(rows.map(r => r.narrativeOfferPer10 || 0)),
    longestNarrative: mean(rows.map(r => r.longestNarrativeStreak || 0)),
    maxNarrative: Math.max(0, ...rows.map(r => r.longestNarrativeStreak || 0)),
    prereqDelay: mean(delays),
    prereqDelayP50: quantile(delays, 0.5),
    earlyCallbackPct: pct(early, delays.length),
    veryEarlyCallbackPct: pct(delays.filter(d => d <= 0).length, delays.length),
    initiationBecame: became.length,
    initiationOffered: offered.length,
    initiationNeverPct: pct(never, became.length),
    initiationNextFloorPct: pct(nextFloor, offered.length),
    initiationDelay: mean(offered.map(s => s.offerDelay || 0)),
    lateOfferPerClimb: lateOffer / Math.max(1, reached40.length),
    lateTakenPerClimb: lateTaken / Math.max(1, reached40.length),
    lateTakenPerFloor: lateFloors ? lateTaken / lateFloors : 0,
    shopTaken: mean(rows.map(r => r.takenCounts?.shop || 0)),
    restTaken: mean(rows.map(r => r.takenCounts?.rest || 0)),
    combatTaken: mean(rows.map(r => r.takenCounts?.combat || 0)),
    otherTaken: mean(rows.map(r => r.takenCounts?.other || 0)),
    important: summarizeImportant(rows),
    repeats: summarizeRepeats(rows),
    delays,
  };
}

export function runPairedClimbs({ trials = 20, seed = 20260823 } = {}) {
  const withPace = [];
  const noPace = [];
  for (let i = 0; i < trials; i++) {
    const s = (seed + i * 9973) >>> 0;
    withPace.push(simulateHealthClimb(makeRng(s), { skipPace: false, survive: true }));
    noPace.push(simulateHealthClimb(makeRng(s), { skipPace: true, survive: true }));
  }
  return { withPace, noPace, after: summarizeClimbs(withPace), before: summarizeClimbs(noPace) };
}

const LATE_FLAGS = [
  'saved_climber', 'bard_friend', 'kings_petition', 'kings_bowed',
  'witch_hint', 'planted_seed', 'revenant_oath', 'angered_forest',
  'clause_seven', 'freed_angel', 'paid_toll', 'statue_grudge',
];
const LATE_KNOWLEDGE = ['heard_dead_language', 'pale_tome', 'heard_own_verse'];
const LATE_THREADS = [
  ['mira', 'returned'], ['bard', 'encore'], ['king', 'echoed'],
  ['witch', 'hinted'], ['pale', 'noticed'], ['oathbound', 'watch'],
  ['forest', 'angered'], ['seed', 'planted'],
];

export function lateCongestionSample({ trials = 24, seed = 424242 } = {}) {
  const streaks = [];
  const payoffStreaks = [];
  const offerPayoffStreaks = [];
  const roleCounts = { narrative: 0, payoff: 0, callback: 0, flavor: 0, combat: 0, other: 0 };
  const offerRoles = { payoff: 0, callback: 0, narrative: 0, flavor: 0, combat: 0 };
  let travelFloors = 0;
  let totalCards = 0;
  let offerPayoffCards = 0;
  let consecutiveSameId = 0;
  let prevOfferPayoffs = [];
  for (let t = 0; t < trials; t++) {
    const rng = makeRng((seed + t * 131) >>> 0);
    const run = createSimRun(rng, { classId: rng.pick(['warrior', 'mage', 'necromancer', 'bard', 'priest']) });
    run.floor = 40;
    run.biomeId = 'hell';
    run.kills = 30;
    run.level = 18;
    for (const flag of LATE_FLAGS) applyWorldPatch(run, { flag });
    for (const k of LATE_KNOWLEDGE) applyWorldPatch(run, { knowledge: k });
    for (const [id, stage] of LATE_THREADS) applyWorldPatch(run, { thread: { id, stage } });
    let narrRun = 0, payRun = 0, maxNarr = 0, maxPay = 0;
    let offerPayRun = 0, maxOfferPay = 0;
    prevOfferPayoffs = [];
    for (let floor = 41; floor <= 49; floor++) {
      if (classifyFloor(floor) !== 'travel') continue;
      travelFloors += 1;
      run.floor = floor;
      run.biomeId = biomeForFloor(floor).id;
      const cards = generateFloorCards(rng, run, { partySize: 1 });
      const floorPayoffs = [];
      for (const card of cards) {
        totalCards += 1;
        if (card.kind === 'encounter') {
          offerRoles.combat += 1;
          continue;
        }
        const ev = eventById(card.eventId);
        if (!ev) continue;
        const role = eventRole(ev);
        if (role === 'payoff' || role === 'callback') {
          offerRoles[role] += 1;
          offerPayoffCards += 1;
          floorPayoffs.push(ev.id);
        } else if (role === 'narrative' || isNarrativeEvent(ev, card)) {
          offerRoles.narrative += 1;
        } else {
          offerRoles.flavor += 1;
        }
      }
      if (floorPayoffs.length) {
        offerPayRun += 1;
        maxOfferPay = Math.max(maxOfferPay, offerPayRun);
        consecutiveSameId += floorPayoffs.filter(id => prevOfferPayoffs.includes(id)).length;
      } else {
        offerPayRun = 0;
      }
      prevOfferPayoffs = floorPayoffs;
      const picked = rng.pick(cards);
      if (picked.kind === 'encounter') {
        roleCounts.combat += 1;
        narrRun = 0;
        payRun = 0;
        continue;
      }
      const ev = eventById(picked.eventId);
      if (!ev) {
        roleCounts.other += 1;
        continue;
      }
      recordEvent(run, ev);
      const role = eventRole(ev);
      if (role === 'payoff' || role === 'callback') {
        roleCounts[role] += 1;
        payRun += 1;
        narrRun += 1;
        maxPay = Math.max(maxPay, payRun);
        maxNarr = Math.max(maxNarr, narrRun);
      } else if (role === 'narrative' || isNarrativeEvent(ev, picked)) {
        roleCounts.narrative += 1;
        narrRun += 1;
        payRun = 0;
        maxNarr = Math.max(maxNarr, narrRun);
      } else {
        roleCounts.flavor += 1;
        narrRun = 0;
        payRun = 0;
      }
    }
    streaks.push(maxNarr);
    payoffStreaks.push(maxPay);
    offerPayoffStreaks.push(maxOfferPay);
  }
  return {
    trials,
    travelFloors,
    roleCounts,
    offerRoles,
    meanNarrStreak: mean(streaks),
    maxNarrStreak: Math.max(0, ...streaks),
    meanPayoffStreak: mean(payoffStreaks),
    maxPayoffStreak: Math.max(0, ...payoffStreaks),
    meanOfferPayoffStreak: mean(offerPayoffStreaks),
    maxOfferPayoffStreak: Math.max(0, ...offerPayoffStreaks),
    payoffCardsPerFloor: travelFloors ? offerPayoffCards / travelFloors : 0,
    sameIdOfferedNextFloor: consecutiveSameId,
    flavorShare: pct(roleCounts.flavor + roleCounts.combat, travelFloors),
    storyShare: pct(roleCounts.narrative + roleCounts.payoff + roleCounts.callback, travelFloors),
    ordinaryOfferShare: pct(offerRoles.flavor + offerRoles.combat, totalCards),
  };
}

function freshRun(opts = {}) {
  const run = newRun({ upgrades: {}, achievements: [] }, {
    classId: opts.classId || 'warrior',
    raceId: 'human',
    name: 'Validate',
    seed: opts.seed ?? 11,
  });
  run.floor = opts.floor ?? 8;
  run.biomeId = opts.biomeId || biomeForFloor(run.floor).id;
  ensureWorld(run);
  return run;
}

export function oldSaveTiming() {
  const run = freshRun({ floor: 20 });
  run.flags.bard_friend = true;
  run.flags.saved_climber = true;
  ensureWorld(run);
  const bard = EVENTS.find(e => e.id === 'bard_returns');
  const before = eventDrawWeight(bard, run);
  const ageBefore = callbackAge(bard, run);
  const sinceBefore = { ...(run.world.since || {}) };
  const threadFloorBefore = run.world.threads.bard?.floor ?? null;

  applyWorldPatch(run, { thread: { id: 'bard', stage: 'encore' } });
  run.floor = 21;
  const afterAdvance = eventDrawWeight(bard, run);
  const ageAfter = callbackAge(bard, run);

  return {
    noAgeOnLoad: ageBefore == null && !before.terms.some(x => x.id === 'age'),
    noFabricatedSince: sinceBefore.bard_friend == null,
    threadFloorOnLoad: threadFloorBefore,
    participatesAfterAdvance: ageAfter != null && afterAdvance.terms.some(x => x.id === 'age'),
    ageAfterAdvance: ageAfter,
  };
}

export function determinismCheck() {
  const run = freshRun({ floor: 12, seed: 99, biomeId: 'ruins' });
  applyWorldPatch(run, { flag: 'saved_climber' });
  applyWorldPatch(run, { flag: 'bard_friend' });
  const a = cloneRunState(run);
  const b = cloneRunState(run);
  const poolA = eventDrawPool(a).map(x => ({ id: x.id, w: x.w })).sort((x, y) => x.id.localeCompare(y.id));
  const poolB = eventDrawPool(b).map(x => ({ id: x.id, w: x.w })).sort((x, y) => x.id.localeCompare(y.id));
  const pickA = drawEvent(makeRng(777), a);
  const pickB = drawEvent(makeRng(777), b);
  recordEvent(a, pickA);
  recordEvent(b, pickB);
  return {
    poolMatch: JSON.stringify(poolA) === JSON.stringify(poolB),
    pickMatch: pickA.id === pickB.id,
    historyMatch: JSON.stringify(a.recentNarrative) === JSON.stringify(b.recentNarrative),
    poolSize: poolA.length,
    pick: pickA.id,
  };
}

export function debugParityCheck() {
  const run = freshRun({ classId: 'necromancer', floor: 42, biomeId: 'hell' });
  applyWorldPatch(run, { flag: 'saved_climber' });
  applyWorldPatch(run, { flag: 'bard_friend' });
  run.kills = 25;
  run.world.since.saved_climber = 8;
  run.world.since.bard_friend = 6;
  run.recentNarrative = [
    { id: 'mira_rumor', family: 'mira', thread: 'mira', role: 'callback', floor: 41 },
  ];
  const cases = [
    EVENTS.find(e => e.id === 'mira_watch'),
    EVENTS.find(e => e.id === 'bard_returns'),
    EVENTS.find(e => e.id === 'pale_rite'),
    EVENTS.find(e => e.id === 'bard_last_song'),
    EVENTS.find(e => e.id === 'campfire'),
  ];
  return cases.filter(Boolean).map(ev => {
    const play = eventDrawWeight(ev, run);
    const debug = explainDrawWeight(ev, run);
    const prod = play.terms.reduce((s, x) => s * x.mult, 1);
    return {
      id: ev.id,
      role: play.role,
      terms: play.terms.map(x => x.id),
      match: play.w === debug.w && JSON.stringify(play.terms) === JSON.stringify(debug.terms),
      termsProduct: Math.abs(prod - play.w) < 1e-9,
      w: play.w,
    };
  });
}

export function familyChainCheck() {
  const run = freshRun({ floor: 12, biomeId: 'ruins' });
  applyWorldPatch(run, { flag: 'left_climber' });
  const rumor = EVENTS.find(e => e.id === 'mira_rumor');
  const grudge = EVENTS.find(e => e.id === 'mira_grudge');
  const excluded = !eventEligible(grudge, run, { exclude: [rumor.id], excludeFamilies: ['mira'] });
  const later = eventEligible(grudge, { ...run, floor: 18, biomeId: 'ruins', seenEvents: ['mira_rumor'] });
  recordEvent(run, rumor);
  run.floor = 19;
  recordEvent(run, rumor);
  run.floor = 20;
  const afterTake = eventDrawWeight(grudge, run);
  const chained = eventDrawWeight({ ...grudge, pace: { ...(grudge.pace || {}), chain: true } }, run);
  const pool = eventDrawPool(run);
  const inPool = pool.find(x => x.id === 'mira_grudge');
  const poolShare = inPool ? inPool.w / pool.reduce((s, x) => s + x.w, 0) : 0;
  return {
    sameDrawExcluded: excluded,
    laterEligible: later,
    stillHasWeight: afterTake.w > 0,
    notStarved: !!inPool && afterTake.w >= grudge.w * 0.15,
    chainWarmer: chained.w > afterTake.w,
    poolShare,
    afterW: afterTake.w,
    chainW: chained.w,
  };
}

export function authoringDefaults() {
  const paced = EVENTS.filter(e => e.pace);
  const run = freshRun({ floor: 4 });
  const flavor = ['campfire', 'merchant', 'chest_generic', 'old_shrine']
    .map(id => EVENTS.find(e => e.id === id))
    .filter(Boolean)
    .map(ev => {
      const wt = eventDrawWeight(ev, run);
      return {
        id: ev.id,
        role: wt.role,
        paceTerms: wt.terms.filter(x => !['base', 'comeback', 'category', 'tags', 'merchantBonus'].includes(x.id)).map(x => x.id),
      };
    });
  return { pacedIds: paced.map(e => e.id), flavor };
}

export function initiationSlotSample({ trials = 60, seed = 3 } = {}) {
  let offered = 0;
  for (let i = 0; i < trials; i++) {
    const rng = makeRng((seed + i * 41) >>> 0);
    const run = freshRun({ classId: 'necromancer', floor: 8, seed: seed + i });
    run.kills = 25;
    const cards = generateFloorCards(rng, run, { partySize: 1 });
    if (cards.some(c => c.eventId === 'pale_rite')) offered += 1;
  }
  return { trials, offeredPct: pct(offered, trials) };
}

export function initiationVisibility({ trials = 36, seed = 9001 } = {}) {
  const classes = Object.entries(SECRET_ROUTES).map(([id, spec]) => ({ id, classId: spec.parent }));
  const rows = { with: [], without: [] };
  for (const mode of ['with', 'without']) {
    for (let i = 0; i < trials; i++) {
      const spec = classes[i % classes.length];
      const s = (seed + i * 17) >>> 0;
      const climb = simulateHealthClimb(makeRng(s), {
        classId: spec.classId,
        skipPace: mode === 'without',
        survive: true,
        policy: 'always-accept-secret',
      });
      const secret = climb.secrets?.[spec.id] || {};
      rows[mode].push({
        id: spec.id,
        eligible: secret.eligibleFloor != null,
        delay: secret.offerDelay,
        offered: secret.offeredFloor != null,
        nextFloor: secret.offerDelay != null && secret.offerDelay <= 1,
      });
    }
  }
  const tally = list => {
    const elig = list.filter(x => x.eligible);
    const off = elig.filter(x => x.offered);
    return {
      eligible: elig.length,
      offeredPct: pct(off.length, elig.length),
      neverPct: pct(elig.length - off.length, elig.length),
      nextFloorPct: pct(off.filter(x => x.nextFloor).length, off.length),
      meanDelay: mean(off.map(x => x.delay || 0)),
    };
  };
  return { withPace: tally(rows.with), noPace: tally(rows.without) };
}

export function runPaceValidation({ trials = 20, lateTrials = 24, initTrials = 24 } = {}) {
  const paired = runPairedClimbs({ trials });
  const late = lateCongestionSample({ trials: lateTrials });
  const old = oldSaveTiming();
  const det = determinismCheck();
  const parity = debugParityCheck();
  const family = familyChainCheck();
  const auth = authoringDefaults();
  const init = initiationVisibility({ trials: initTrials });
  return { paired, late, old, det, parity, family, auth, init };
}

function printReport(rep) {
  const { before, after } = rep.paired;
  const line = (label, b, a, unit = '') => {
    console.log(`  ${label.padEnd(36)} before ${fmt(b)}${unit}   after ${fmt(a)}${unit}`);
  };
  console.log('— before vs after (seeded survive-to-51 climbs) —');
  console.log(`  trials ${after.n}`);
  line('narrative taken / 10 floors', before.narrativePer10, after.narrativePer10);
  line('narrative offered / 10 floors', before.narrativeOfferPer10, after.narrativeOfferPer10);
  line('mean longest narrative streak', before.longestNarrative, after.longestNarrative);
  line('max narrative streak', before.maxNarrative, after.maxNarrative, '');
  line('mean prereq → callback delay', before.prereqDelay, after.prereqDelay, ' fl');
  line('callbacks delay ≤1 floor %', before.earlyCallbackPct, after.earlyCallbackPct, '%');
  line('initiation never-offered %', before.initiationNeverPct, after.initiationNeverPct, '%');
  line('initiation next-floor offer %', before.initiationNextFloorPct, after.initiationNextFloorPct, '%');
  line('initiation mean offer delay', before.initiationDelay, after.initiationDelay, ' fl');
  line('late payoff taken / climb', before.lateTakenPerClimb, after.lateTakenPerClimb);
  line('shop takes / climb', before.shopTaken, after.shopTaken);
  line('rest takes / climb', before.restTaken, after.restTaken);
  line('combat takes / climb', before.combatTaken, after.combatTaken);
  line('other/flavor takes / climb', before.otherTaken, after.otherTaken);
  console.log(`  reached 40 / cleared          before ${before.nReached40}/${before.nCleared}   after ${after.nReached40}/${after.nCleared}`);
  console.log('  important callbacks (eligible → never offered %)');
  for (const id of Object.keys(after.important)) {
    const b = before.important[id];
    const a = after.important[id];
    console.log(`    ${id.padEnd(18)} elig ${String(b.eligible).padStart(2)}/${String(a.eligible).padStart(2)}  never ${fmt(b.neverPct)}% → ${fmt(a.neverPct)}%  offered ${b.offered}→${a.offered}`);
  }
  console.log(`  family callback takes         before ${before.repeats.familyCallbackTakes}   after ${after.repeats.familyCallbackTakes}`);
  console.log(`  mean max NPC offers           before ${fmt(before.repeats.meanMaxNpcOffers)}   after ${fmt(after.repeats.meanMaxNpcOffers)}`);
  console.log(`  climbs with NPC offered ≥3    before ${before.repeats.climbsWithNpc3}   after ${after.repeats.climbsWithNpc3}`);

  console.log('\n— secret initiation (class-matched climbs) —');
  console.log(`  with    offered ${fmt(rep.init.withPace.offeredPct)}%  never ${fmt(rep.init.withPace.neverPct)}%  next-floor ${fmt(rep.init.withPace.nextFloorPct)}%  delay ${fmt(rep.init.withPace.meanDelay)}`);
  console.log(`  without offered ${fmt(rep.init.noPace.offeredPct)}%  never ${fmt(rep.init.noPace.neverPct)}%  next-floor ${fmt(rep.init.noPace.nextFloorPct)}%  delay ${fmt(rep.init.noPace.meanDelay)}`);

  console.log('\n— late-game congestion (forced unresolved threads F41–49) —');
  console.log(`  taken story share ${fmt(rep.late.storyShare)}%   taken ordinary share ${fmt(rep.late.flavorShare)}%`);
  console.log(`  offered ordinary share ${fmt(rep.late.ordinaryOfferShare)}%   payoff/callback cards per floor ${fmt(rep.late.payoffCardsPerFloor)}`);
  console.log(`  mean/max narrative streak ${fmt(rep.late.meanNarrStreak)} / ${rep.late.maxNarrStreak}`);
  console.log(`  mean/max payoff+callback taken streak ${fmt(rep.late.meanPayoffStreak)} / ${rep.late.maxPayoffStreak}`);
  console.log(`  mean/max payoff+callback offer streak ${fmt(rep.late.meanOfferPayoffStreak)} / ${rep.late.maxOfferPayoffStreak}`);
  console.log(`  same payoff id offered on consecutive floors ${rep.late.sameIdOfferedNextFloor}`);
  console.log(`  taken roles`, JSON.stringify(rep.late.roleCounts));

  console.log('\n— family / chain —');
  console.log(`  same-draw exclude ${rep.family.sameDrawExcluded}  later eligible ${rep.family.laterEligible}  not starved ${rep.family.notStarved}  chain warmer ${rep.family.chainWarmer}  poolShare ${fmt(rep.family.poolShare * 100)}%`);

  console.log('\n— old-save timing —');
  console.log(`  no fabricated age ${rep.old.noAgeOnLoad}  no since stamp ${rep.old.noFabricatedSince}  participates after advance ${rep.old.participatesAfterAdvance} (age ${rep.old.ageAfterAdvance})`);

  console.log('\n— determinism —');
  console.log(`  pool ${rep.det.poolMatch}  pick ${rep.det.pickMatch} (${rep.det.pick})  history ${rep.det.historyMatch}  poolSize ${rep.det.poolSize}`);

  console.log('\n— world debug parity —');
  for (const row of rep.parity) {
    console.log(`  ${row.id.padEnd(18)} role=${row.role.padEnd(10)} match=${row.match}  terms=${row.terms.join(',')}  w=${fmt(row.w)}`);
  }

  console.log('\n— authoring defaults —');
  console.log(`  cards with pace {} : ${rep.auth.pacedIds.join(', ') || '(none)'}`);
  for (const f of rep.auth.flavor) {
    console.log(`  ${f.id.padEnd(16)} role=${f.role} extraTerms=${f.paceTerms.join(',') || 'none'}`);
  }
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/pace_validate.js')) {
  const trials = Number(process.env.PACE_TRIALS || 16);
  const rep = runPaceValidation({ trials, lateTrials: 20, initTrials: 24 });
  printReport(rep);
}
