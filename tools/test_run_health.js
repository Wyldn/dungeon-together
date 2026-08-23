// Fast run-health telemetry tests. Imported by tools/test.js.
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { makeRng } from '../js/rng.js';
import { newRun, rollStart, runRng } from '../js/state.js';
import { CONFIG } from '../js/data/config.js';
import { EVENTS } from '../js/data/events.js';
import { TDC, TDC_CLEAR_RATE_DISCLAIMER } from '../js/data/tdc.js';
import {
  generateFloorCards, dealLiveFloorCards, cardDealFingerprint, classifyFloor,
} from '../js/data/floorcards.js';
import {
  secretEligible, secretUnlocked, presentEvent, recordEvent, applyOutcomeWorld,
} from '../js/data/world.js';
import { applyTagOutcomeMods } from '../js/data/eventtags.js';
import { applyOutcomeHeadless, createSimRun } from './sim_run_state.js';
import { simulateHealthClimb } from './run_health_climb.js';
import {
  runHealthSuite, stripReportTimestamps, compareHealthReports, buildHealthReport,
  formatHealthReport, FAITHFUL, MODELED, REPORT_FIELD_TRUST,
} from './run_health.js';
import { formatClearReport, runClearRateSim } from './run_sim.js';

const here = dirname(fileURLToPath(import.meta.url));

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function freshRun(opts = {}) {
  const classId = opts.classId || 'necromancer';
  const raceId = opts.raceId || 'human';
  const seed = opts.seed ?? 20260823;
  const run = newRun({ upgrades: {}, achievements: [] }, {
    classId, raceId, name: opts.name || 'Parity',
    seed, kitSeed: opts.kitSeed ?? seed,
    gen: rollStart(classId, raceId, opts.genSeed ?? seed),
  });
  if (opts.floor) {
    run.floor = opts.floor;
    run.biomeId = opts.biomeId || undefined;
  }
  if (opts.patch) Object.assign(run, opts.patch);
  return run;
}

function worldSlice(run) {
  return clone({
    flags: run.flags,
    knowledge: [...(run.world?.knowledge || [])].sort(),
    threads: run.world?.threads || {},
    events: run.world?.events || {},
    characters: run.world?.characters || {},
    factions: run.world?.factions || {},
    usedItems: [...(run.world?.usedItems || [])].sort(),
    seenEvents: [...(run.seenEvents || [])],
  });
}

function applyLiveChosenWorld(run, ev, choice) {
  const shown = presentEvent(ev, run);
  if (!run.seenEvents) run.seenEvents = [];
  run.seenEvents.push(shown.id);
  recordEvent(run, shown);
  recordEvent(run, shown, { choice: choice.id || choice.label, variantId: shown.variantId || null });
  const o = applyTagOutcomeMods(choice.outcome, shown, run) || choice.outcome;
  applyOutcomeWorld(run, o);
  return shown;
}

function applyHeadlessChosenWorld(run, ev, choice, rng) {
  const shown = presentEvent(ev, run);
  if (!run.seenEvents) run.seenEvents = [];
  run.seenEvents.push(shown.id);
  recordEvent(run, shown);
  recordEvent(run, shown, { choice: choice.id || choice.label, variantId: shown.variantId || null });
  applyOutcomeHeadless(run, choice.outcome, rng, shown);
  return shown;
}

function eventById(id) {
  return EVENTS.find(e => e.id === id);
}

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function catalogSnapshot() {
  return {
    eventWeights: EVENTS.map(e => `${e.id}:${e.w ?? ''}`).join('|'),
    configEvents: JSON.stringify(CONFIG.events),
    clearRate: JSON.stringify(TDC.clearRate),
  };
}

export async function runRunHealthTests(t) {
  console.log('— run-health telemetry —');

  t('classifyFloor schedule',
    classifyFloor(1) === 'travel'
    && classifyFloor(5) === 'trial'
    && classifyFloor(9) === 'campfire'
    && classifyFloor(10) === 'boss'
    && classifyFloor(15) === 'boss'
    && classifyFloor(51) === 'throne');

  const golden = JSON.parse(readFileSync(join(here, 'fixtures', 'run_health_cards_golden.json'), 'utf8'));
  const gen = rollStart(golden.classId, golden.raceId, golden.genSeed);
  const run = newRun({ upgrades: {}, achievements: [] }, {
    classId: golden.classId,
    raceId: golden.raceId,
    name: golden.name,
    seed: golden.seed,
    kitSeed: golden.kitSeed,
    gen,
  });
  run.floor = golden.floor;
  run.biomeId = golden.biomeId;
  const cards = generateFloorCards(makeRng(golden.rngSeed), run);
  t('golden generateFloorCards length', cards.length === golden.cards.length);
  t('golden generateFloorCards sequence',
    cards.every((c, i) => c.kind === golden.cards[i].kind
      && c.category === golden.cards[i].category
      && (c.eventId || null) === (golden.cards[i].eventId || null)));

  {
    const necro = newRun({ upgrades: {}, achievements: [] }, {
      classId: 'necromancer', raceId: 'human', name: 'Patch',
      seed: 11, kitSeed: 11, gen: rollStart('necromancer', 'human', 11),
    });
    applyOutcomeHeadless(necro, { world: { knowledge: 'heard_dead_language' } }, makeRng(12));
    t('headless world patch grants knowledge', (necro.world.knowledge || []).includes('heard_dead_language'));
    t('headless knowledge opens lichling eligibility', secretEligible(necro, 'lichling') && !secretUnlocked(necro, 'lichling'));
    applyOutcomeHeadless(necro, { flag: 'saved_climber' }, makeRng(13));
    t('headless flag applies world bridge', necro.world.characters.mira?.met === true);
  }

  {
    const climb = simulateHealthClimb(makeRng(20260823), { classId: 'necromancer' });
    t('secret collector includes class secret', !!climb.secrets.lichling);
    t('secret collector skips off-class secrets', !climb.secrets.doomguard);
    t('secret outcome is labeled',
      ['never-seen', 'offered-not-taken', 'accepted', 'deferred', 'seen-but-locked'].includes(climb.secrets.lichling.outcome));
    t('offer and taken counts are present',
      typeof climb.offerCounts.combat === 'number' && typeof climb.takenCounts.combat === 'number');
    t('true-merchant offer is distinct from category-merchant shop family',
      typeof climb.trueMerchantOffers === 'number' && climb.trueMerchantOffers <= (climb.shopsOffered || 0));
  }

  {
    const a = stripReportTimestamps(runHealthSuite({ name: 'SAME', seed: 99, trials: 8 }));
    const b = stripReportTimestamps(runHealthSuite({ name: 'SAME', seed: 99, trials: 8 }));
    t('same seed+policy reports match', deepEqual(a, b));
  }

  {
    const base = buildHealthReport([], { name: 'BASE', seed: 1, policy: 'autoplay-random-path' });
    const after = JSON.parse(JSON.stringify(base));
    after.meta.name = 'AFTER';
    after.summary.cleared = 0.2;
    after.pacing.level6.p50 = 12;
    after.narrative.offerPer10.p50 = 4;
    after.cards.offerRates.narrative = 0.25;
    after.lateGame.floorsWithPayoffOfferShare = 0.5;
    const cmp = compareHealthReports(base, after);
    t('compare detects cleared delta', Math.abs((cmp.deltas.cleared.delta || 0) - 0.2) < 1e-9);
    t('compare detects narrative offer shift', cmp.cardDeltas.narrative.offer !== 0);
    t('compare same-seed flag when trials match', cmp.sameSeed === true);
  }

  {
    const src = readFileSync(join(here, 'run_health.js'), 'utf8')
      + readFileSync(join(here, 'run_health_climb.js'), 'utf8')
      + readFileSync(join(here, '..', 'js', 'data', 'floorcards.js'), 'utf8');
    t('health path does not call Math.random', !/\bMath\.random\b/.test(src));
  }

  {
    const mem = {};
    const prev = globalThis.localStorage;
    let wrote = false;
    globalThis.localStorage = {
      getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
      setItem: (k, v) => { wrote = true; mem[k] = String(v); },
      removeItem: k => { delete mem[k]; },
    };
    try {
      createSimRun(makeRng(3), { classId: 'warrior' });
      simulateHealthClimb(makeRng(4), { classId: 'warrior' });
      t('health climb does not write localStorage', wrote === false);
    } finally {
      globalThis.localStorage = prev;
    }
  }

  /* ---- 1. live generation parity ---- */
  {
    const gameSrc = readFileSync(join(here, '..', 'js', 'game.js'), 'utf8');
    const wrapper = gameSrc.match(/function generateCards\([\s\S]*?\n\}/);
    t('game.js generateCards is dealLiveFloorCards wrapper',
      !!wrapper
      && /return dealLiveFloorCards\(/.test(wrapper[0])
      && !/generateFloorCards\(/.test(wrapper[0])
      && !/\.advance\s*\(/.test(wrapper[0]));

    const fcSrc = stripComments(readFileSync(join(here, '..', 'js', 'data', 'floorcards.js'), 'utf8'));
    const genBody = fcSrc.split('export function generateFloorCards')[1]?.split('export function dealLiveFloorCards')[0] || '';
    const dealBody = fcSrc.split('export function dealLiveFloorCards')[1]?.split('export function cardDealFingerprint')[0] || '';
    t('generateFloorCards does not call advance', !/\.advance\s*\(/.test(genBody));
    t('dealLiveFloorCards calls rng.advance', /\.advance\s*\(/.test(dealBody));
  }

  {
    const cases = [
      { floor: 1, seed: 101 },
      { floor: 3, seed: 202, patch: { seenEvents: ['wounded_adventurer'] } },
      { floor: 8, seed: 303 },
      { floor: 16, seed: 404 },
      { floor: 21, seed: 505, patch: { forcedNextCategory: 'combat' } },
      { floor: 31, seed: 606, patch: { mapHintCategory: 'mystery' } },
    ];
    let allMatch = true;
    let advanceMatch = true;
    let wrapperMatch = true;
    for (const c of cases) {
      const a = freshRun({ floor: c.floor, seed: c.seed, patch: c.patch });
      const b = freshRun({ floor: c.floor, seed: c.seed, patch: c.patch });
      const d = freshRun({ floor: c.floor, seed: c.seed, patch: c.patch });
      const startState = a.rngState;
      const cardsA = generateFloorCards(runRng(a), a);
      const cardsB = dealLiveFloorCards(runRng(b), b);
      const rngD = runRng(d);
      generateFloorCards(rngD, d);
      rngD.advance();
      if (!deepEqual(cardDealFingerprint(cardsA), cardDealFingerprint(cardsB))) allMatch = false;
      if (a.rngState !== startState) allMatch = false;
      if (b.rngState === startState) advanceMatch = false;
      if (d.rngState !== b.rngState) advanceMatch = false;
      const e = freshRun({ floor: c.floor, seed: c.seed, patch: c.patch });
      const cardsE = generateFloorCards(makeRng(e.rngState), e);
      if (!deepEqual(cardDealFingerprint(cardsA), cardDealFingerprint(cardsE))) wrapperMatch = false;
    }
    t('live deal vs generateFloorCards: families/ids/plans/order match', allMatch);
    t('dealLiveFloorCards advances rngState the same as generate+advance', advanceMatch);
    t('plain makeRng(run.rngState) matches runRng deal fingerprint', wrapperMatch);
  }

  /* ---- 2. RNG ownership ---- */
  {
    const climbSrc = stripComments(readFileSync(join(here, 'run_health_climb.js'), 'utf8'));
    t('health climb uses generateFloorCards only',
      /generateFloorCards\(/.test(climbSrc)
      && !/dealLiveFloorCards/.test(climbSrc)
      && !/\brunRng\b/.test(climbSrc));
    const live = freshRun({ floor: 4, seed: 77 });
    const before = live.rngState;
    simulateHealthClimb(makeRng(77), { classId: 'necromancer' });
    t('health climb does not mutate a separate live run.rngState', live.rngState === before);
  }

  /* ---- 3. faithful vs modeled ---- */
  {
    const empty = buildHealthReport([], { name: 'HONEST', seed: 1, policy: 'autoplay-random-path' });
    t('honesty.fields classifies offerRates as faithful',
      empty.honesty.fields['cards.offerRates'] === FAITHFUL);
    t('honesty.fields classifies takenRates as modeled',
      empty.honesty.fields['cards.takenRates'] === MODELED);
    t('honesty.fields classifies cleared as modeled',
      empty.honesty.fields['summary.cleared'] === MODELED);
    const text = formatHealthReport(empty);
    t('human summary splits FAITHFUL vs MODELED sections',
      text.includes(FAITHFUL) && text.includes(MODELED) && text.indexOf(FAITHFUL) < text.indexOf(MODELED));
    t('modeled cleared is not presented as an unlabeled headline',
      !/^cleared /m.test(text) && /MODELED[\s\S]*cleared/.test(text));
    t('every published trust key is labeled',
      Object.values(REPORT_FIELD_TRUST).every(v => v === FAITHFUL || v === MODELED));
  }

  /* ---- 4. TDC.clearRate warning ---- */
  {
    const smoke = runClearRateSim({ seed: 1, trials: 2, partySize: 1 });
    const clearText = formatClearReport(smoke);
    t('run_sim JSON carries TDC.clearRate disclaimer',
      smoke.disclaimer === TDC_CLEAR_RATE_DISCLAIMER
      && /48%/.test(smoke.loop)
      && /not generateFloorCards/.test(smoke.loop));
    t('formatClearReport cannot be read as live encounter frequency',
      clearText.includes(TDC_CLEAR_RATE_DISCLAIMER)
      && /not live DungeonTogether encounter frequency/i.test(clearText)
      && /not observed player behavior/i.test(clearText));
    const healthText = formatHealthReport(buildHealthReport([], { name: 'TDC', seed: 1 }));
    t('health report repeats TDC.clearRate disclaimer',
      healthText.includes(TDC_CLEAR_RATE_DISCLAIMER));
    const docs = readFileSync(join(here, '..', 'docs', 'CONTENT.md'), 'utf8');
    t('CONTENT.md warns TDC.clearRate is not live frequency',
      /not live DungeonTogether encounter frequency/i.test(docs));
  }

  /* ---- 5. world-state parity ---- */
  {
    const spots = [
      { id: 'wounded_adventurer', label: 'Heal her', floor: 2 },
      { id: 'wounded_adventurer', label: 'Loot her pack while she sleeps', floor: 2 },
      { id: 'pale_whisper', label: 'Lean in and listen', floor: 6 },
      { id: 'mira_rumor', label: 'Ask which version they believe', floor: 14, patch: { flags: { saved_climber: true } } },
      { id: 'pale_rite', label: 'Pay the rent. Store a piece', floor: 8, classId: 'necromancer' },
      { id: 'pale_rite', label: 'Watch. Do not pay', floor: 8, classId: 'necromancer' },
    ];
    let ok = true;
    for (const spot of spots) {
      const ev = eventById(spot.id);
      const choice = ev?.choices?.find(c => c.label === spot.label);
      if (!ev || !choice) { ok = false; break; }
      const live = freshRun({ classId: spot.classId || 'necromancer', floor: spot.floor, seed: 88, patch: spot.patch });
      const head = freshRun({ classId: spot.classId || 'necromancer', floor: spot.floor, seed: 88, patch: spot.patch });
      if (spot.id === 'mira_rumor') {
        applyLiveChosenWorld(live, eventById('wounded_adventurer'), eventById('wounded_adventurer').choices[0]);
        applyHeadlessChosenWorld(head, eventById('wounded_adventurer'), eventById('wounded_adventurer').choices[0], makeRng(1));
      }
      applyLiveChosenWorld(live, ev, choice);
      applyHeadlessChosenWorld(head, ev, choice, makeRng(2));
      if (!deepEqual(worldSlice(live), worldSlice(head))) ok = false;
    }
    t('headless observer matches live world pipeline for chosen outcomes', ok);
  }

  /* ---- 6. determinism ---- */
  {
    const a = stripReportTimestamps(runHealthSuite({ name: 'DET', seed: 42, trials: 8 }));
    const b = stripReportTimestamps(runHealthSuite({ name: 'DET', seed: 42, trials: 8 }));
    t('full report is byte-stable for same seed+trials+config', JSON.stringify(a) === JSON.stringify(b));
  }

  /* ---- 7. no observer effect ---- */
  {
    const before = catalogSnapshot();
    const prevEvents = EVENTS.map(e => e);
    runHealthSuite({ name: 'OBS', seed: 7, trials: 8 });
    const after = catalogSnapshot();
    t('telemetry does not mutate event weights', before.eventWeights === after.eventWeights);
    t('telemetry does not mutate CONFIG.events', before.configEvents === after.configEvents);
    t('telemetry does not mutate TDC.clearRate', before.clearRate === after.clearRate);
    t('telemetry does not replace EVENTS object identities', EVENTS.every((e, i) => e === prevEvents[i]));
    const again = generateFloorCards(makeRng(golden.rngSeed), (() => {
      const r = newRun({ upgrades: {}, achievements: [] }, {
        classId: golden.classId, raceId: golden.raceId, name: golden.name,
        seed: golden.seed, kitSeed: golden.kitSeed, gen: rollStart(golden.classId, golden.raceId, golden.genSeed),
      });
      r.floor = golden.floor;
      r.biomeId = golden.biomeId;
      return r;
    })());
    t('later golden deal is unchanged after telemetry',
      again.every((c, i) => c.kind === golden.cards[i].kind
        && c.category === golden.cards[i].category
        && (c.eventId || null) === (golden.cards[i].eventId || null)));
  }
}
