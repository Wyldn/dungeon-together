// One seeded 51-floor health climb. Offer layer is generateFloorCards
// (does not call rng.advance() / runRng). Taken layer is named autoplay.
// Do not call dealLiveFloorCards here — that would consume live-style rngState.

import { CONFIG } from '../js/data/config.js';
import { EVENTS } from '../js/data/events.js';
import { ENEMIES, biomeForFloor, pickBossForFloor, MODIFIERS } from '../js/data/enemies.js';
import { planBossEncounter, pushEventHistory } from '../js/data/balance.js';
import {
  presentEvent, recordEvent, secretEligible, secretUnlocked, secretProgress,
  worldDebugSnapshot, SECRET_ROUTES,
} from '../js/data/world.js';
import { inferArchetype } from '../js/data/biome_kits.js';
import { derived, heal, restoreMana } from '../js/character.js';
import { EVOLUTION_LEVELS } from '../js/data/classes.js';
import {
  generateFloorCards, classifyFloor, broadFamily, eventById,
  cardLooksPayoff, LAST_FLOOR, pickEnemyPlan,
} from '../js/data/floorcards.js';
import {
  createSimRun, climberFromRun, applyFightToRun, grantCombatLoot,
  estimateCombatRewards, applyOutcomeHeadless, applyCombatRewardHeadless,
  pickEventChoice, reqMetHeadless, resolveSimMerchant,
} from './sim_run_state.js';
import { simulateFight } from './combat_sim.js';

export const DEFAULT_POLICY = 'autoplay-random-path';
export const LEVEL_MARKS = [EVOLUTION_LEVELS.first, 10, EVOLUTION_LEVELS.second, 16, 20];

const INITIATION_BY_EVENT = Object.fromEntries(
  Object.entries(SECRET_ROUTES).map(([id, spec]) => [spec.initiation, id]),
);

function emptyCounts() {
  return { combat: 0, narrative: 0, shop: 0, rest: 0, trial: 0, boss: 0, other: 0 };
}

function isTrueMerchant(ev) {
  return !!(ev && (ev.shop || ev.type === 'shop'));
}

function bandOf(floor) {
  if (floor <= 10) return '1-10';
  if (floor <= 20) return '11-20';
  if (floor <= 30) return '21-30';
  if (floor <= 40) return '31-40';
  return '41-51';
}

function stampWorld(run, stamps, floor) {
  for (const [flag, on] of Object.entries(run.flags || {})) {
    if (on && stamps.flags[flag] == null) stamps.flags[flag] = floor;
  }
  for (const k of run.world?.knowledge || []) {
    if (stamps.knowledge[k] == null) stamps.knowledge[k] = floor;
  }
  for (const id of run.seenEvents || []) {
    if (stamps.events[id] == null) stamps.events[id] = floor;
  }
  for (const [id, live] of Object.entries(run.world?.threads || {})) {
    if (live?.stage && stamps.threads[id] == null) stamps.threads[id] = floor;
  }
}

function prereqStampFloor(when, stamps) {
  if (!when || typeof when !== 'object') return null;
  const hits = [];
  const take = (map, key) => {
    if (key && map[key] != null) hits.push(map[key]);
  };
  if (when.flag) take(stamps.flags, when.flag);
  if (when.knowledge) {
    const list = Array.isArray(when.knowledge) ? when.knowledge : [when.knowledge];
    for (const k of list) take(stamps.knowledge, k);
  }
  if (when.event) take(stamps.events, when.event);
  if (when.thread) take(stamps.threads, when.thread.id || when.thread);
  if (when.all) {
    const inner = (Array.isArray(when.all) ? when.all : [when.all])
      .map(w => prereqStampFloor(w, stamps)).filter(x => x != null);
    if (inner.length) hits.push(Math.max(...inner));
  }
  if (when.any) {
    const inner = (Array.isArray(when.any) ? when.any : [when.any])
      .map(w => prereqStampFloor(w, stamps)).filter(x => x != null);
    if (inner.length) hits.push(Math.min(...inner));
  }
  return hits.length ? Math.max(...hits) : null;
}

function outcomeUnlocksSecret(o) {
  return !!(o?.world?.unlockSecret);
}

function outcomeDefersSecret(o) {
  const k = o?.world?.knowledge;
  const list = Array.isArray(k) ? k : (k ? [k] : []);
  return list.some(x => String(x).includes('deferred'));
}

function pickChoice(run, ev, rng, policy) {
  const secretId = ev?.id ? INITIATION_BY_EVENT[ev.id] : null;
  if (secretId && (policy === 'always-accept-secret' || policy === 'always-defer-secret')) {
    const choices = (ev.choices || []).filter(c => reqMetHeadless(run, c.req).ok);
    const unlocker = choices.find(c => outcomeUnlocksSecret(c.outcome));
    const deferrer = choices.find(c => outcomeDefersSecret(c.outcome));
    if (policy === 'always-accept-secret' && unlocker) return unlocker;
    if (policy === 'always-defer-secret' && deferrer) return deferrer;
  }
  return pickEventChoice(run, ev, rng);
}

function fightRun(rng, run, specs, opts) {
  const climber = climberFromRun(run);
  const potionsBefore = climber.potions || 0;
  const r = simulateFight(rng, climber, specs, opts);
  const { gold, xp } = estimateCombatRewards(specs, opts.floor, rng, { boss: !!opts.boss });
  const goldGain = r.won ? Math.round(gold * (derived(run).goldMult || 1) * (derived(run).combatGoldMult || 1)) : 0;
  applyFightToRun(run, climber, r, {
    won: r.won,
    xp: r.won ? xp : 0,
    gold: goldGain,
    boss: !!opts.boss,
  });
  if (r.won) grantCombatLoot(run, rng, { boss: !!opts.boss, elite: specs.some(s => s.elite) });
  return {
    won: r.won,
    rounds: r.rounds,
    hpLossPct: r.hpLossPct,
    gold: goldGain,
    xp: r.won ? xp : 0,
    potionsUsed: Math.max(0, potionsBefore - (climber.potions || 0)),
    groupSize: specs.length,
    elite: specs.some(s => s.elite),
    archetypes: specs.map(s => inferArchetype(s)),
  };
}

function resolveFixedEvent(run, rng, eventId, policy) {
  const raw = EVENTS.find(e => e.id === eventId);
  if (!raw) return {};
  const ev = presentEvent(raw, run);
  if (!run.seenEvents) run.seenEvents = [];
  run.seenEvents.push(ev.id);
  recordEvent(run, ev);
  pushEventHistory(run, ev.category || 'unknown');
  if (ev.shop && !(ev.choices || []).length) {
    const goldBefore = run.gold;
    resolveSimMerchant(run, rng);
    return { event: ev, shop: true, goldSpent: Math.max(0, goldBefore - run.gold) };
  }
  const choice = pickChoice(run, ev, rng, policy);
  if (!choice) return { event: ev };
  recordEvent(run, ev, { choice: choice.id || choice.label, variantId: ev.variantId || null });
  const goldBefore = run.gold;
  const result = applyOutcomeHeadless(run, choice.outcome, rng, ev);
  return { ...result, event: ev, choice, goldSpent: Math.max(0, goldBefore - run.gold) };
}

function resolveTravelEvent(run, rng, card, policy) {
  const raw = eventById(card.eventId);
  if (!raw) return {};
  const ev = presentEvent(raw, run);
  if (!run.seenEvents) run.seenEvents = [];
  run.seenEvents.push(ev.id);
  recordEvent(run, ev);
  pushEventHistory(run, ev.category || 'unknown');
  if (ev.shop && !(ev.choices || []).length) {
    const goldBefore = run.gold;
    resolveSimMerchant(run, rng);
    return { event: ev, shop: true, goldSpent: Math.max(0, goldBefore - run.gold) };
  }
  const choice = pickChoice(run, ev, rng, policy);
  if (!choice) return { event: ev };
  recordEvent(run, ev, { choice: choice.id || choice.label, variantId: ev.variantId || null });
  const goldBefore = run.gold;
  const result = applyOutcomeHeadless(run, choice.outcome, rng, ev);
  return { ...result, event: ev, choice, goldSpent: Math.max(0, goldBefore - run.gold) };
}

function breath(run) {
  heal(run, run.maxHp * (CONFIG.recovery.floorHealPct || 0));
  restoreMana(run, run.maxMp * (CONFIG.recovery.floorManaPct || 0));
}

function secretState(run) {
  const out = {};
  for (const id of Object.keys(SECRET_ROUTES)) {
    if (SECRET_ROUTES[id].parent && run.classId !== SECRET_ROUTES[id].parent) continue;
    const prog = secretProgress(run, id);
    out[id] = {
      eligible: secretEligible(run, id),
      unlocked: secretUnlocked(run, id),
      via: (prog.routes || []).filter(r => r.ok).map(r => ({ id: r.id, kind: r.kind })),
    };
  }
  return out;
}

function threadSnap(run) {
  return worldDebugSnapshot(run).threads.map(t => ({
    id: t.id, status: t.status, stage: t.stage,
  }));
}

function longestStreak(arr) {
  let best = 0, cur = 0, prev = null;
  for (const x of arr) {
    if (x === prev) cur += 1;
    else cur = 1;
    prev = x;
    if (cur > best) best = cur;
  }
  return best;
}

function longestValueStreak(arr, value) {
  let best = 0, cur = 0;
  for (const x of arr) {
    if (x === value) {
      cur += 1;
      if (cur > best) best = cur;
    } else cur = 0;
  }
  return best;
}

function kitSnapshot(run) {
  return {
    equipment: { ...run.equipment },
    inventory: [...(run.inventory || [])],
    relics: [...(run.relics || [])],
  };
}

function kitDelta(before, after) {
  let acquire = 0;
  let replace = 0;
  for (const slot of Object.keys(after.equipment || {})) {
    const a = after.equipment[slot];
    const b = before.equipment[slot];
    if (a && a !== b) {
      acquire += 1;
      if (b) replace += 1;
    }
  }
  const beforeInv = new Set(before.inventory || []);
  for (const id of after.inventory || []) {
    if (!beforeInv.has(id)) acquire += 1;
  }
  const beforeRel = new Set(before.relics || []);
  for (const id of after.relics || []) {
    if (!beforeRel.has(id)) acquire += 1;
  }
  return { acquire, replace };
}

/**
 * @returns compact per-climb telemetry
 */
export function simulateHealthClimb(rng, {
  policy = DEFAULT_POLICY,
  classId = null,
  raceId = null,
  originId = null,
  skipPace = false,
  survive = false,
} = {}) {
  const run = createSimRun(rng, { classId, raceId, originId });
  if (!run.climb) run.climb = { bossesCleared: [], bossesSpared: [] };

  const offerCounts = emptyCounts();
  const takenCounts = emptyCounts();
  const offerByBand = {};
  const takenByBand = {};
  const takenFamilies = [];
  const narrativeOfferByBand = {};
  const narrativeTakenByBand = {};
  const encounterSizes = [];
  const eliteOffered = { n: 0, of: 0 };
  const eliteTaken = { n: 0, of: 0 };
  const archetypes = {};
  const hpLoss = [];
  const goldHeld = [];
  const goldByBiome = {};
  const npcSeen = {};
  const callbackOffer = [];
  const callbackTaken = [];
  const prereqDelays = [];
  const unresolvedByFloor = [];
  const secrets = {};
  const lateOfferPayoff = [];
  const lateTakenPayoff = [];
  const offeredEventIds = [];
  const takenEventIds = [];
  let potionsUsed = 0;
  let shopsOffered = 0;
  let shopsVisited = 0;
  let trueMerchantOffers = 0;
  let trueMerchantVisits = 0;
  let firstTrueMerchantOfferFloor = null;
  let firstTrueMerchantVisitFloor = null;
  const trueMerchantOffersBy = {};
  const trueMerchantVisitsBy = {};
  let itemAcquire = 0;
  let itemReplace = 0;
  let threadsOpened = 0;
  let threadsResolved = 0;
  const threadFirst = {};
  const familyFirstOffer = {};
  const familyFirstTaken = {};
  const stamps = { flags: {}, knowledge: {}, events: {}, threads: {} };
  const levelFloors = {};
  for (const lv of LEVEL_MARKS) levelFloors[lv] = null;

  let prevSecrets = secretState(run);
  let prevThreads = threadSnap(run);
  stampWorld(run, stamps, 1);

  let deathFloor = null;
  let maxFloor = 0;
  let keysAt40 = null;
  let keysAt51 = null;

  function bump(map, key, family) {
    if (!map[key]) map[key] = emptyCounts();
    map[key][family] = (map[key][family] || 0) + 1;
  }

  function noteOffer(floor, family, extra = {}) {
    offerCounts[family] = (offerCounts[family] || 0) + 1;
    bump(offerByBand, bandOf(floor), family);
    if (family === 'narrative') {
      narrativeOfferByBand[bandOf(floor)] = (narrativeOfferByBand[bandOf(floor)] || 0) + 1;
    }
    if (family === 'shop') shopsOffered += 1;
    if (isTrueMerchant(extra.event)) {
      trueMerchantOffers += 1;
      if (firstTrueMerchantOfferFloor == null) firstTrueMerchantOfferFloor = floor;
    }
    if (extra.event && extra.event.npc) {
      const npc = extra.event.npc?.id || extra.event.npc;
      if (npc) npcSeen[npc] = (npcSeen[npc] || 0) + 1;
    }
    if (extra.event?.family) {
      if (familyFirstOffer[extra.event.family] == null) familyFirstOffer[extra.event.family] = floor;
      else callbackOffer.push(floor - familyFirstOffer[extra.event.family]);
    }
    if (extra.event && cardLooksPayoff(extra.event) && familyFirstOffer[extra.event.family || extra.event.id] != null) {
      const pf = prereqStampFloor(extra.event.when, stamps);
      if (pf != null) prereqDelays.push(floor - pf);
    }
    if (floor >= 40 && extra.event && cardLooksPayoff(extra.event)) lateOfferPayoff.push(extra.event.id);
    if (extra.event?.id) offeredEventIds.push(extra.event.id);
    const sid = extra.event?.id ? INITIATION_BY_EVENT[extra.event.id] : null;
    if (sid) {
      if (!secrets[sid]) secrets[sid] = {};
      if (secrets[sid].offeredFloor == null) secrets[sid].offeredFloor = floor;
    }
  }

  function noteTaken(floor, family, extra = {}) {
    takenCounts[family] = (takenCounts[family] || 0) + 1;
    bump(takenByBand, bandOf(floor), family);
    takenFamilies.push(family);
    if (family === 'narrative') {
      narrativeTakenByBand[bandOf(floor)] = (narrativeTakenByBand[bandOf(floor)] || 0) + 1;
    }
    if (family === 'shop') shopsVisited += 1;
    if (isTrueMerchant(extra.event)) {
      trueMerchantVisits += 1;
      if (firstTrueMerchantVisitFloor == null) firstTrueMerchantVisitFloor = floor;
    }
    if (extra.event?.family) {
      if (familyFirstTaken[extra.event.family] == null) familyFirstTaken[extra.event.family] = floor;
      else callbackTaken.push(floor - familyFirstTaken[extra.event.family]);
    }
    if (floor >= 40 && extra.event && cardLooksPayoff(extra.event)) lateTakenPayoff.push(extra.event.id);
    if (extra.event?.id) takenEventIds.push(extra.event.id);
  }

  function afterState(floor) {
    for (const lv of LEVEL_MARKS) {
      if (levelFloors[lv] == null && run.level >= lv) levelFloors[lv] = floor;
    }
    const nowSec = secretState(run);
    for (const [id, cur] of Object.entries(nowSec)) {
      if (!secrets[id]) secrets[id] = {};
      const prev = prevSecrets[id];
      if (cur.eligible && !prev?.eligible && secrets[id].eligibleFloor == null) {
        secrets[id].eligibleFloor = floor;
        secrets[id].via = cur.via?.[0]?.kind || 'unknown';
        secrets[id].viaId = cur.via?.[0]?.id || null;
      }
      if (cur.unlocked) secrets[id].unlocked = true;
    }
    prevSecrets = nowSec;

    const nowTh = threadSnap(run);
    for (const t of nowTh) {
      const prev = prevThreads.find(x => x.id === t.id);
      if (t.status !== 'dormant' && prev?.status === 'dormant') {
        threadsOpened += 1;
        threadFirst[t.id] = floor;
      }
      if (t.status === 'resolved' && prev?.status !== 'resolved') threadsResolved += 1;
    }
    prevThreads = nowTh;
    unresolvedByFloor.push({
      floor,
      biome: run.biomeId,
      active: nowTh.filter(t => t.status === 'active').length,
      resolved: nowTh.filter(t => t.status === 'resolved').length,
    });
    stampWorld(run, stamps, floor);
    goldHeld.push({ floor, gold: run.gold });
    if (floor === 10 || floor === 15 || floor === 30 || floor === 45) {
      trueMerchantOffersBy[floor] = trueMerchantOffers;
      trueMerchantVisitsBy[floor] = trueMerchantVisits;
    }
    if (floor === 40) keysAt40 = worldKeys(run);
    if (floor === LAST_FLOOR) keysAt51 = worldKeys(run);
  }

  function worldKeys(r) {
    const snap = worldDebugSnapshot(r);
    return {
      knowledge: [...snap.knowledge],
      flags: Object.keys(snap.flags || {}).filter(k => snap.flags[k]),
      threads: snap.threads.filter(t => t.status !== 'dormant').map(t => `${t.id}:${t.stage}`),
      secrets: snap.secrets.filter(s => s.eligible || s.unlocked).map(s => ({
        id: s.id, eligible: s.eligible, unlocked: s.unlocked,
      })),
    };
  }

  function trackGold(biome, goldBefore, earnedBefore) {
    const earned = (run.goldEarned || 0) - earnedBefore;
    const spent = goldBefore + earned - run.gold;
    if (!goldByBiome[biome]) goldByBiome[biome] = { earned: 0, spent: 0 };
    goldByBiome[biome].earned += Math.max(0, earned);
    goldByBiome[biome].spent += Math.max(0, spent);
  }

  for (let floor = 1; floor <= LAST_FLOOR; floor++) {
    maxFloor = floor;
    run.floor = floor;
    const biome = biomeForFloor(floor);
    run.biomeId = biome.id;
    const kind = classifyFloor(floor);
    const goldBefore = run.gold;
    const earnedBefore = run.goldEarned || 0;
    const kitBefore = kitSnapshot(run);

    if (kind === 'campfire') {
      noteOffer(floor, 'rest', { event: EVENTS.find(e => e.id === 'campfire') });
      const result = resolveFixedEvent(run, rng, 'campfire', policy);
      noteTaken(floor, 'rest', result);
      breath(run);
      trackGold(biome.id, goldBefore, earnedBefore);
      const kd = kitDelta(kitBefore, kitSnapshot(run));
      itemAcquire += kd.acquire;
      itemReplace += kd.replace;
      afterState(floor);
      continue;
    }

    if (kind === 'boss' || kind === 'throne') {
      noteOffer(floor, 'boss');
      const boss = pickBossForFloor(floor, rng, run);
      const plan = planBossEncounter(rng, {
        floor, boss, pool: ENEMIES[biome.id] || [], partySize: 1,
      });
      const fight = fightRun(rng, run, plan.specs, {
        floor,
        biomeStart: floor,
        hpMult: plan.hpMult,
        boss: true,
        maxRounds: 60,
      });
      noteTaken(floor, 'boss');
      hpLoss.push(fight.hpLossPct);
      potionsUsed += fight.potionsUsed;
      if (fight.won) {
        run.climb.bossesCleared.push({ floor, id: boss.id, name: boss.name });
      }
      breath(run);
      trackGold(biome.id, goldBefore, earnedBefore);
      const kd = kitDelta(kitBefore, kitSnapshot(run));
      itemAcquire += kd.acquire;
      itemReplace += kd.replace;
      afterState(floor);
      if (!fight.won || run.hp <= 0) {
        if (survive) {
          run.hp = Math.max(1, run.maxHp || 1);
        } else {
          deathFloor = floor;
          break;
        }
      }
      continue;
    }

    if (kind === 'trial') {
      noteOffer(floor, 'trial');
      const mod = rng.pick(MODIFIERS);
      const plan = pickEnemyPlan(rng, run, biome, 1);
      eliteOffered.of += 1;
      if (plan.specs.some(s => s.elite)) eliteOffered.n += 1;
      encounterSizes.push(plan.specs.length);
      for (const s of plan.specs) archetypes[inferArchetype(s)] = (archetypes[inferArchetype(s)] || 0) + 1;
      const fight = fightRun(rng, run, plan.specs, {
        floor, biomeStart: biome.floors[0], hpMult: plan.hpMult * (mod.hpMult || 1), maxRounds: 40,
      });
      noteTaken(floor, 'trial');
      eliteTaken.of += 1;
      if (fight.elite) eliteTaken.n += 1;
      hpLoss.push(fight.hpLossPct);
      potionsUsed += fight.potionsUsed;
      breath(run);
      trackGold(biome.id, goldBefore, earnedBefore);
      const kd = kitDelta(kitBefore, kitSnapshot(run));
      itemAcquire += kd.acquire;
      itemReplace += kd.replace;
      afterState(floor);
      if (!fight.won || run.hp <= 0) {
        if (survive) {
          run.hp = Math.max(1, run.maxHp || 1);
        } else {
          deathFloor = floor;
          break;
        }
      }
      continue;
    }

    const cards = generateFloorCards(rng, run, { partySize: 1, skipPace });
    for (const card of cards) {
      const ev = card.eventId ? eventById(card.eventId) : null;
      const family = broadFamily(card, ev);
      noteOffer(floor, family, { event: ev, card });
      if (card.kind === 'encounter') {
        encounterSizes.push((card.enemies || []).length);
        eliteOffered.of += 1;
        if ((card.enemies || []).some(e => e.elite)) eliteOffered.n += 1;
        for (const e of card.enemies || []) {
          archetypes[inferArchetype(e)] = (archetypes[inferArchetype(e)] || 0) + 1;
        }
      }
    }

    const picked = rng.pick(cards);
    const ev = picked.eventId ? eventById(picked.eventId) : null;
    const family = broadFamily(picked, ev);
    let died = false;

    if (picked.kind === 'encounter') {
      pushEventHistory(run, 'combat');
      const fight = fightRun(rng, run, picked.enemies || [], {
        floor, biomeStart: biome.floors[0], hpMult: picked.hpMult || 1, maxRounds: 40,
      });
      noteTaken(floor, 'combat');
      eliteTaken.of += 1;
      if (fight.elite) eliteTaken.n += 1;
      hpLoss.push(fight.hpLossPct);
      potionsUsed += fight.potionsUsed;
      if (!fight.won || run.hp <= 0) died = true;
    } else {
      const result = resolveTravelEvent(run, rng, picked, policy);
      noteTaken(floor, family, result);
      if (result.combatSpecs?.length) {
        const fight = fightRun(rng, run, result.combatSpecs, {
          floor, biomeStart: biome.floors[0], maxRounds: 35,
        });
        if (result.fightReward && fight.won) {
          applyCombatRewardHeadless(run, result.fightReward, rng, { paySkills: true });
        }
        hpLoss.push(fight.hpLossPct);
        potionsUsed += fight.potionsUsed;
        if (!fight.won || run.hp <= 0) died = true;
      }
      const sid = ev?.id ? INITIATION_BY_EVENT[ev.id] : null;
      if (sid) {
        if (!secrets[sid]) secrets[sid] = {};
        secrets[sid].takenFloor = floor;
        if (secretUnlocked(run, sid)) secrets[sid].outcome = 'accepted';
        else if ((run.world?.knowledge || []).some(k => String(k).includes('deferred'))) {
          secrets[sid].outcome = 'deferred';
        } else {
          secrets[sid].outcome = 'seen-but-locked';
        }
      }
    }

    breath(run);
    trackGold(biome.id, goldBefore, earnedBefore);
    const kd = kitDelta(kitBefore, kitSnapshot(run));
    itemAcquire += kd.acquire;
    itemReplace += kd.replace;
    afterState(floor);
    if (died) {
      if (survive) {
        run.hp = Math.max(1, run.maxHp || 1);
      } else {
        deathFloor = floor;
        break;
      }
    }
  }

  for (const id of Object.keys(SECRET_ROUTES)) {
    if (SECRET_ROUTES[id].parent && run.classId !== SECRET_ROUTES[id].parent) continue;
    if (!secrets[id]) secrets[id] = {};
    const row = secrets[id];
    if (row.eligibleFloor != null && row.offeredFloor != null) {
      row.offerDelay = row.offeredFloor - row.eligibleFloor;
    }
    if (!row.outcome) {
      if (row.offeredFloor != null && row.takenFloor == null) row.outcome = 'offered-not-taken';
      else if (row.offeredFloor == null) row.outcome = 'never-seen';
    }
  }

  const narrativeOfferTotal = offerCounts.narrative || 0;
  const narrativeTakenTotal = takenCounts.narrative || 0;
  const floorsLived = maxFloor;

  return {
    classId: run.classId,
    raceId: run.raceId,
    originId: run.originId,
    growthRank: run.growthRank,
    seed: run.seed,
    policy,
    cleared: deathFloor == null && maxFloor >= LAST_FLOOR && run.hp > 0,
    deathFloor,
    maxFloor,
    finalLevel: run.level,
    finalGold: run.gold,
    goldEarned: run.goldEarned || 0,
    levelFloors,
    offerCounts,
    takenCounts,
    offerByBand,
    takenByBand,
    takenFamilies,
    longestTakenStreak: longestStreak(takenFamilies),
    longestNarrativeStreak: longestValueStreak(takenFamilies, 'narrative'),
    narrativeOfferTotal,
    narrativeTakenTotal,
    narrativeOfferPer10: floorsLived ? (narrativeOfferTotal / floorsLived) * 10 : 0,
    narrativeTakenPer10: floorsLived ? (narrativeTakenTotal / floorsLived) * 10 : 0,
    narrativeOfferByBand,
    narrativeTakenByBand,
    threadsOpened,
    threadsResolved,
    callbackOffer,
    callbackTaken,
    prereqDelays,
    unresolvedByFloor,
    npcSeen,
    secrets,
    encounterSizes,
    eliteOffered,
    eliteTaken,
    archetypes,
    hpLoss,
    potionsUsed,
    goldByBiome,
    goldHeld,
    shopsOffered,
    shopsVisited,
    trueMerchantOffers,
    trueMerchantVisits,
    firstTrueMerchantOfferFloor,
    firstTrueMerchantVisitFloor,
    trueMerchantOffersBy,
    trueMerchantVisitsBy,
    itemAcquire,
    itemReplace,
    lateOfferPayoff,
    lateTakenPayoff,
    offeredEventIds,
    takenEventIds,
    familyFirstTaken,
    familyFirstOffer,
    keysAt40,
    keysAt51,
    finalFlags: Object.keys(run.flags || {}).filter(k => run.flags[k]),
    finalKnowledge: [...(run.world?.knowledge || [])],
    finalSeen: [...(run.seenEvents || [])],
  };
}
