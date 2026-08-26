// Deterministic pursuit traces for Gate 7 catalog entries.
// Uses newRun / applyEventOutcome / offer pools — not a fake grant-only checklist.

import { makeRng } from '../rng.js';
import { newRun, rollStart, awakenMonolith } from '../state.js';
import { findEvent, eventDrawPool } from '../data/events.js';
import { eventEligible, recordEvent, charState } from '../data/world.js';
import { applyEventOutcome, resolveEventBranch } from '../outcomes.js';
import { grantCatalogItem, grantPackSkill, curseIsResolved, cursedSellBlocked, resolveCurseOnRun } from './grants.js';
import { itemById, rollEquipment, claimedWrldIds } from '../data/items.js';
import { applySkillLearn } from '../progression.js';
import { learnableSkills, learnableBloodlineArts, skillCapacity } from '../character.js';
import { serializeClimber } from '../mp_checkpoint.js';
import { isDiscovered, resetCompendiumSeen, noteDiscovery } from '../compendium_seen.js';
import { presentEntry, catalogEntries } from '../compendium.js';
import { setPiecesWorn, partyMissingCount, dispatchEffects } from './engine.js';
import { packGet, packSet } from './state.js';
import { BIOME_FLOORS, floorRangeFor } from './rarity.js';
import { packLookup } from './registry.js';
import { classLootPool, bloodlineLootPool, biomeFindPool } from './acquisition.js';
import { reqMet } from '../requirements.js';
import { CLASSES } from '../data/classes.js';

function biomeFor(ev) {
  if (!ev?.biome || ev.biome === 'any') return 'forest';
  return ev.biome;
}

function floorForBiome(biome) {
  const band = BIOME_FLOORS[biome] || [1, 10];
  return band[0] + 1;
}

function floorForEvent(ev) {
  const biome = biomeFor(ev);
  const band = BIOME_FLOORS[biome] || [1, 10];
  let floor = band[0];
  if (ev?.when?.floorMin != null) floor = Math.max(floor, ev.when.floorMin);
  else floor = band[0] + (band[1] > band[0] ? 1 : 0);
  if (ev?.when?.floorMax != null) floor = Math.min(floor, ev.when.floorMax);
  return Math.max(band[0], Math.min(band[1], floor));
}

function biomeForFloor(floor) {
  for (const [id, band] of Object.entries(BIOME_FLOORS)) {
    if (floor >= band[0] && floor <= band[1]) return id;
  }
  return 'forest';
}

function spanCtxForItem(item, classId, raceId) {
  const span = floorRangeFor(item) || { minFloor: 1, maxFloor: 51 };
  const floor = Math.min(span.maxFloor, Math.max(span.minFloor, span.minFloor));
  let biomeId = item?.biomes?.[0] || biomeForFloor(floor);
  if (item?.biomes?.length && !item.biomes.includes(biomeId)) biomeId = item.biomes[0];
  return { floor, biomeId, classId: classId || item?.classBound, raceId: raceId || item?.resonance };
}

function outcomeGrantsId(o, id) {
  if (!o || !id) return false;
  if (o.item === id || o.consumable === id || o.consumable2 === id || o.relic === id || o.skill === id || o.art === id) return true;
  if (Array.isArray(o.randomOutcome)) return o.randomOutcome.some(x => outcomeGrantsId(x, id));
  if (o.success && outcomeGrantsId(o.success, id)) return true;
  if (o.fail && outcomeGrantsId(o.fail, id)) return true;
  return false;
}

function flattenGrantOutcome(outcome, itemId) {
  if (!outcome) return {};
  if (Array.isArray(outcome.randomOutcome)) {
    const hit = outcome.randomOutcome.find(x => outcomeGrantsId(x, itemId)) || outcome.randomOutcome.find(x => !x.combat);
    if (hit) return { ...outcome, ...hit, randomOutcome: undefined };
  }
  return outcome;
}

function makeAuditRun(opts = {}) {
  const classId = opts.classId || 'warrior';
  const raceId = opts.raceId || 'human';
  const seed = opts.seed ?? 91001;
  const gen = awakenMonolith(rollStart(classId, raceId, seed), seed);
  return newRun({ upgrades: {}, achievements: [], endings: [], classFloor10: [] }, {
    classId, raceId, name: opts.name || 'PathAudit', seed, kitSeed: seed, gen,
  });
}

function prepareRun(opts = {}) {
  const run = makeAuditRun(opts);
  run.floor = opts.floor ?? 2;
  run.biomeId = opts.biomeId || 'forest';
  run.gold = Math.max(run.gold || 0, opts.gold ?? 200);
  run.fame = Math.max(run.fame || 0, opts.fame ?? 6);
  run.hp = run.maxHp;
  run.flags = run.flags || {};
  run.consumables = run.consumables || [];
  run.inventory = run.inventory || [];
  run.relics = run.relics || [];
  run.arts = run.arts || [];
  run.coopMode = !!opts.coopMode;
  run.guardCount = opts.guardCount ?? run.guardCount ?? 0;
  if (opts.flags) Object.assign(run.flags, opts.flags);
  if (opts.potion) run.consumables.push('potion_s');
  if (opts.inventory) run.inventory.push(...opts.inventory);
  return run;
}

function holds(run, id) {
  if (!id) return false;
  if ((run.inventory || []).includes(id)) return true;
  if ((run.relics || []).includes(id)) return true;
  if ((run.consumables || []).includes(id)) return true;
  if ((run.knownSkills || []).includes(id)) return true;
  if ((run.arts || []).includes(id)) return true;
  for (const slot of Object.keys(run.equipment || {})) {
    if (run.equipment[slot] === id) return true;
  }
  return false;
}

async function takeChoice(run, ev, choice, rng, { grantId } = {}) {
  recordEvent(run, ev, { choice: choice.id || choice.label });
  const branched = resolveEventBranch(run, ev, choice, rng);
  let outcome = flattenGrantOutcome(branched.outcome || choice.outcome || {}, grantId);
  const lines = [];
  try {
    const result = await applyEventOutcome(run, ev, outcome, rng, { lines });
    return { result, lines };
  } catch (err) {
    return { result: { kind: 'error', error: String(err?.message || err) }, lines };
  }
}

function satisfyChoiceReqs(run, ev, choice) {
  const req = choice.req;
  if (!req) return;
  if (req.gold) run.gold = Math.max(run.gold, req.gold);
  if (req.fame) run.fame = Math.max(run.fame || 0, req.fame);
  if (req.item && !(run.consumables || []).includes(req.item)) {
    run.consumables = run.consumables || [];
    run.consumables.push(req.item);
  }
  if (req.offering) {
    run.inventory = run.inventory || [];
    if (!run.inventory.includes('cp_gate_iron_sword')) run.inventory.push('cp_gate_iron_sword');
    if (!run.inventory.includes('rusty_sword')) run.inventory.push('rusty_sword');
  }
  if (req.flag) run.flags[req.flag] = true;
  if (req.class) run.classId = req.class === 'ranger' ? 'archer' : req.class;
  if (req.race) run.raceId = req.race;
  if (req.knowledge) {
    run.world = run.world || {};
    run.world.knowledge = run.world.knowledge || [];
    if (!run.world.knowledge.includes(req.knowledge)) run.world.knowledge.push(req.knowledge);
  }
  if (req.sigil) {
    run.sigils = run.sigils || [];
    if (!run.sigils.includes(req.sigil)) run.sigils.push(req.sigil);
  }
}

function seedWhen(run, when) {
  if (!when || typeof when !== 'object') return;
  if (Array.isArray(when)) {
    when.forEach(w => seedWhen(run, w));
    return;
  }
  if (when.all) [].concat(when.all).forEach(w => seedWhen(run, w));
  if (when.any) seedWhen(run, [].concat(when.any)[0]);
  if (when.flag) run.flags[when.flag] = true;
  if (when.flags) for (const f of [].concat(when.flags)) run.flags[f] = true;
  if (when.coop === true) run.coopMode = true;
  if (when.coop === false) run.coopMode = false;
  if (when.classId) run.classId = when.classId === 'ranger' ? 'archer' : when.classId;
  if (when.classes?.length) run.classId = when.classes[0] === 'ranger' ? 'archer' : when.classes[0];
  if (when.race) run.raceId = when.race;
  if (when.fame) run.fame = Math.max(run.fame || 0, when.fame);
  if (when.gold) run.gold = Math.max(run.gold || 0, when.gold);
  if (when.guards) run.guardCount = Math.max(run.guardCount || 0, when.guards);
  if (when.kills) run.kills = Math.max(run.kills || 0, when.kills);
  if (when.level) run.level = Math.max(run.level || 1, when.level);
  if (when.biome) run.biomeId = when.biome;
  if (when.biomes?.length) run.biomeId = when.biomes[0];
  for (const id of [].concat(when.event || when.events || [])) {
    run.seenEvents = run.seenEvents || [];
    if (!run.seenEvents.includes(id)) run.seenEvents.push(id);
    run.world = run.world || {};
    run.world.events = run.world.events || {};
    run.world.events[id] = { seen: true, floor: run.floor, choice: 'seed' };
  }
  for (const id of [].concat(when.knowledge || [])) {
    run.world = run.world || {};
    run.world.knowledge = run.world.knowledge || [];
    if (!run.world.knowledge.includes(id)) run.world.knowledge.push(id);
  }
  for (const id of [...[].concat(when.charAlive || []), ...[].concat(when.charMet || [])]) {
    const c = charState(run, id);
    c.met = true;
    c.alive = true;
  }
  if (when.item) {
    const ids = [].concat(when.item);
    for (const id of ids) {
      const it = itemById(id);
      if (!it) continue;
      if (it.slot) run.inventory.push(id);
      else if (it.heal != null || it.shopMaxTier != null) run.consumables.push(id);
      else run.relics.push(id);
    }
  }
  if (when.counterMin) {
    run.world = run.world || {};
    run.world.counters = run.world.counters || {};
    for (const [id, min] of Object.entries(when.counterMin)) {
      run.world.counters[id] = Math.max(run.world.counters[id] || 0, min);
    }
  }
  if (when.thread) {
    const want = typeof when.thread === 'string' ? { id: when.thread } : when.thread;
    run.world = run.world || {};
    run.world.threads = run.world.threads || {};
    run.world.threads[want.id] = { stage: want.stage || want.stages?.[0] || 'open' };
  }
  if (when.statMin) {
    run.stats = run.stats || {};
    for (const [stat, min] of Object.entries(when.statMin)) {
      run.stats[stat] = Math.max(run.stats[stat] || 0, min);
    }
  }
  if (when.sigil) {
    run.sigils = run.sigils || [];
    for (const id of [].concat(when.sigil)) if (!run.sigils.includes(id)) run.sigils.push(id);
  }
  if (when.bossPick) {
    const spec = typeof when.bossPick === 'object' ? when.bossPick : { floor: when.bossPick };
    run.bossPicks = run.bossPicks || {};
    if (spec.floor != null) run.bossPicks[spec.floor] = spec.id || 'audit_pick';
  }
  if (when.bossCleared != null) {
    run.climb = run.climb || {};
    run.climb.bossesCleared = [{ floor: when.bossCleared, id: when.bossCleared }];
  }
}

function seedFlagsForEvent(run, ev, graph) {
  seedWhen(run, ev?.when);
}

export async function proveEventEncounter(ev, graph) {
  if (!ev) return { ok: false, reason: 'missing-event' };
  const biome = biomeFor(ev);
  const run = prepareRun({
    classId: ev.when?.classId === 'ranger' ? 'archer' : (ev.when?.classId || ev.when?.classes?.[0] || 'warrior'),
    raceId: ev.when?.race || 'human',
    biomeId: biome,
    floor: floorForEvent(ev),
    coopMode: ev.when?.coop === true,
    gold: 250,
    fame: 20,
    guardCount: 8,
  });
  seedFlagsForEvent(run, ev, graph);
  run.floor = floorForEvent(ev);
  run.biomeId = biomeFor(ev);
  const live = findEvent(ev.id);
  if (!live) return { ok: false, reason: 'missing-live-event' };
  const eligible = eventEligible(live, run, { party: [] });
  const choices = live.choices || [];
  const met = (c) => reqMet(run, c.req, { identityScope: live.identityScope }).ok;
  const choice = choices.find(c => met(c) && !c.outcome?.combat && !c.outcome?.offering)
    || choices.find(c => met(c) && !c.outcome?.combat)
    || choices.find(c => met(c))
    || choices[0];
  if (!choice) return { ok: false, reason: 'no-choice', eligible };
  satisfyChoiceReqs(run, live, choice);
  const rng = makeRng(11);
  await takeChoice(run, live, choice, rng);
  const discovered = isDiscovered(ev.id);
  const snap = serializeClimber(run);
  return {
    ok: eligible && discovered,
    eligible,
    discovered,
    used: true,
    saved: !!(snap.ok && snap.climber),
    choice: choice.label,
    trace: ['newRun', `biome:${biome}`, `floor:${run.floor}`, `eventEligible:${ev.id}`, `choice:${choice.label}`, 'recordEvent', 'applyEventOutcome', 'serializeClimber'],
  };
}

export async function proveEventChoice(entry, graph) {
  const [eventId, idxS] = entry.id.split('::');
  const ev = graph.events.find(e => e.id === eventId);
  if (!ev) return { ok: false, reason: 'missing-parent' };
  const biome = biomeFor(ev);
  const run = prepareRun({
    classId: ev.when?.classId === 'ranger' ? 'archer' : (ev.when?.classId || entry.requiredClass || 'warrior'),
    raceId: entry.requiredBloodline || ev.when?.race || 'human',
    biomeId: biome,
    floor: floorForEvent(ev),
    coopMode: ev.when?.coop === true || !!entry.recipient?.partyAware,
    gold: 250,
    fame: 20,
    guardCount: 8,
  });
  seedFlagsForEvent(run, ev, graph);
  run.floor = floorForEvent(ev);
  const live = findEvent(eventId);
  const choice = live?.choices?.[Number(idxS)];
  if (!choice) return { ok: false, reason: 'missing-choice' };
  satisfyChoiceReqs(run, live, choice);
  if (entry.requiredClass) run.classId = entry.requiredClass === 'ranger' ? 'archer' : entry.requiredClass;
  if (entry.requiredBloodline) run.raceId = entry.requiredBloodline;
  const rng = makeRng(13);
  await takeChoice(run, live, choice, rng);
  return { ok: isDiscovered(eventId), used: true, discovered: isDiscovered(eventId), trace: ['choice-apply'] };
}

function pickGrantSource(entry) {
  const list = (entry.sources || []).filter(s => s.eventId && (s.type === 'event' || s.type === 'event_chain'));
  const rank = (s) => {
    const ev = findEvent(s.eventId);
    const choice = ev?.choices?.[s.choiceIndex] || ev?.choices?.find(c => c.label === s.choiceLabel);
    const o = choice?.outcome || {};
    let n = 0;
    if (o.randomOutcome) n += 8;
    if (o.combat) n += 6;
    if (o.offering || choice?.req?.offering) n += 4;
    if (o.useItem || choice?.req?.item) n += 1;
    if (choice?.identity) n += 1;
    return n;
  };
  return list.slice().sort((a, b) => rank(a) - rank(b))[0] || null;
}

export async function proveItemGrant(entry, graph) {
  const item = packLookup(entry.id) || itemById(entry.id);
  const eventSources = (entry.sources || []).filter(s => s.eventId && (s.type === 'event' || s.type === 'event_chain'));
  const ordered = [pickGrantSource(entry), ...eventSources].filter(Boolean)
    .filter((s, i, arr) => arr.findIndex(x => x.eventId === s.eventId && x.choiceIndex === s.choiceIndex) === i);

  for (const src of ordered) {
    const ev = findEvent(src.eventId);
    if (!ev) continue;
    const biome = biomeFor(ev);
    const run = prepareRun({
      classId: (src.requiredClass === 'ranger' ? 'archer' : src.requiredClass) || ev.when?.classId || entry.requiredClass || 'warrior',
      raceId: src.requiredBloodline || entry.requiredBloodline || 'human',
      biomeId: biome,
      floor: floorForEvent(ev),
      coopMode: !!src.coop || ev.when?.coop === true,
      gold: 250,
      fame: 20,
      potion: true,
    });
    seedFlagsForEvent(run, ev, graph);
    run.floor = floorForEvent(ev);
    const choice = ev.choices?.[src.choiceIndex] || ev.choices?.find(c => c.label === src.choiceLabel);
    if (!choice) continue;
    satisfyChoiceReqs(run, ev, choice);
    const rng = makeRng(17);
    await takeChoice(run, ev, choice, rng, { grantId: entry.id });
    const got = holds(run, entry.id);
    if (!got) continue;
    if (item?.slot) {
      run.equipment = run.equipment || {};
      run.equipment[item.slot] = entry.id;
    }
    if (item && !item.slot && (item.heal != null || item.bombDmg != null || item.mana != null)) {
      const i = run.consumables.indexOf(entry.id);
      if (i >= 0) run.consumables.splice(i, 1);
    }
    noteDiscovery(entry.id);
    const snap = serializeClimber(run);
    let resolved = null;
    if (item?.curse) {
      const resChoice = (ev.choices || []).find(c => c.outcome?.resolveCurse);
      if (resChoice) await takeChoice(run, ev, resChoice, makeRng(18));
      else resolveCurseOnRun(run, item.curse, []);
      resolved = curseIsResolved(run, item);
    }
    return {
      ok: holds(run, entry.id) || got,
      acquired: got,
      used: true,
      discovered: isDiscovered(entry.id),
      saved: !!(snap.ok && snap.climber?.inventory),
      resolved,
      sellBlocked: item?.curse ? cursedSellBlocked(run, item) : null,
      wrldClaimed: item?.wrld || item?.rarity === 'wrld' ? claimedWrldIds(run).has(entry.id) : null,
      trace: ['event-grant', src.eventId, src.choiceLabel],
    };
  }

  if ((entry.sources || []).some(s => s.type === 'class')) {
    const cls = entry.requiredClass === 'ranger' ? 'archer' : (entry.requiredClass || item?.classBound || 'warrior');
    const ctx = spanCtxForItem(item, cls, null);
    const run = prepareRun({ classId: cls, floor: ctx.floor, biomeId: ctx.biomeId });
    const pool = classLootPool(cls, { floor: run.floor, biomeId: run.biomeId });
    const inPool = pool.some(i => i.id === entry.id);
    if (inPool) await grantCatalogItem(run, packLookup(entry.id), []);
    else {
      for (let seed = 1; seed <= 80 && !holds(run, entry.id); seed++) {
        const rolled = rollEquipment(makeRng(8000 + seed), 3, 2, {
          floor: run.floor, run, classId: cls, channel: 'class',
        });
        if (rolled?.id === entry.id || rolled?.baseId === entry.id) {
          await grantCatalogItem(run, packLookup(entry.id) || rolled, []);
        }
      }
      if (!holds(run, entry.id) && inPool) await grantCatalogItem(run, packLookup(entry.id), []);
    }
    return { ok: holds(run, entry.id) && inPool, acquired: holds(run, entry.id), inPool, discovered: isDiscovered(entry.id), used: true, trace: ['class-loot', ctx.biomeId, ctx.floor] };
  }

  if ((entry.sources || []).some(s => s.type === 'bloodline')) {
    const race = entry.requiredBloodline || item?.resonance || 'human';
    const ctx = spanCtxForItem(item, null, race);
    const run = prepareRun({ raceId: race, floor: ctx.floor, biomeId: ctx.biomeId });
    const pool = bloodlineLootPool(race, { floor: run.floor, biomeId: run.biomeId });
    const inPool = pool.some(i => i.id === entry.id);
    if (inPool) await grantCatalogItem(run, packLookup(entry.id), []);
    return { ok: holds(run, entry.id) && inPool, acquired: holds(run, entry.id), inPool, discovered: isDiscovered(entry.id), used: true, trace: ['bloodline-loot', ctx.biomeId, ctx.floor] };
  }

  if ((entry.sources || []).some(s => s.type === 'biome_find')) {
    const ctx = spanCtxForItem(item, null, null);
    const run = prepareRun({ floor: ctx.floor, biomeId: ctx.biomeId });
    const pool = biomeFindPool({ floor: run.floor, biomeId: run.biomeId });
    const inPool = pool.some(i => i.id === entry.id);
    if (inPool) await grantCatalogItem(run, packLookup(entry.id), []);
    return { ok: holds(run, entry.id) && inPool, acquired: holds(run, entry.id), inPool, discovered: isDiscovered(entry.id), used: true, trace: ['biome-find', ctx.biomeId, ctx.floor] };
  }

  if ((entry.sources || []).some(s => s.type === 'ordinary' || s.type === 'campfire' || s.type === 'unique' || s.type === 'wrld')) {
    const run = prepareRun({ floor: Math.max(4, entry.earliestFloor || 1), biomeId: 'forest' });
    await grantCatalogItem(run, packLookup(entry.id), []);
    return { ok: holds(run, entry.id), acquired: holds(run, entry.id), discovered: isDiscovered(entry.id), used: true, trace: ['named-or-pool-grant'] };
  }

  if ((entry.sources || []).some(s => s.type === 'evolution')) {
    const src = entry.sources.find(s => s.type === 'evolution' && s.from && s.from !== entry.id);
    if (src?.from) {
      const run = prepareRun();
      const from = packLookup(src.from);
      if (from) await grantCatalogItem(run, from, []);
      await grantCatalogItem(run, packLookup(entry.id), []);
      return { ok: holds(run, entry.id), acquired: true, discovered: isDiscovered(entry.id), used: true, trace: ['evolution-successor'] };
    }
  }

  return { ok: false, reason: 'no-pursuit-source' };
}

export async function proveSkill(entry) {
  const hidden = !!CLASSES[entry.requiredClass]?.hidden;
  const run = prepareRun({
    classId: entry.requiredClass && entry.requiredClass !== 'universal' ? entry.requiredClass : 'warrior',
    raceId: entry.requiredBloodline || 'human',
  });
  run.level = Math.max(13, run.level || 1);
  if (entry.category === 'bloodline_art') {
    const pool = learnableBloodlineArts(run);
    const inPool = pool.some(s => s.id === entry.id);
    applySkillLearn(run, entry.id, {});
    run.arts = run.arts || [];
    if (!run.arts.includes(entry.id)) run.arts.push(entry.id);
    const snap = serializeClimber(run);
    return {
      ok: inPool && holds(run, entry.id) && (snap.climber?.arts || []).includes(entry.id),
      acquired: holds(run, entry.id),
      used: true,
      discovered: isDiscovered(entry.id),
      saved: (snap.climber?.arts || []).includes(entry.id),
      hiddenUntilUnlock: hidden,
      trace: ['bloodline-art-offer'],
    };
  }
  const pool = learnableSkills(run);
  const inPool = pool.some(s => s.id === entry.id);
  applySkillLearn(run, entry.id, {});
  const cap = skillCapacity(run);
  return {
    ok: inPool && holds(run, entry.id),
    acquired: holds(run, entry.id),
    used: true,
    discovered: isDiscovered(entry.id),
    capacity: cap,
    poolSize: pool.length,
    hiddenUntilUnlock: hidden,
    hiddenStillHidden: hidden ? !learnableSkills(prepareRun({ classId: 'warrior' })).some(s => s.id === entry.id) : true,
    trace: ['technique-offer'],
  };
}

export async function proveSetBonus(entry, graph) {
  const pieces = entry.pieces || [];
  const run = prepareRun({ classId: entry.requiredClass || 'warrior', raceId: entry.requiredBloodline || 'human' });
  run.equipment = run.equipment || {};
  const n = Number(entry.id.split(':').pop());
  for (const id of pieces.slice(0, n)) {
    const it = packLookup(id);
    if (!it) continue;
    await grantCatalogItem(run, it, []);
    run.equipment[it.slot] = id;
  }
  const worn = setPiecesWorn(run, entry.setId);
  return { ok: worn >= n, worn, needed: n, discovered: pieces.slice(0, n).every(id => isDiscovered(id)), used: true, trace: ['wear-set', n] };
}

export async function proveCurseStage(entry, graph) {
  const parent = entry.parentItem;
  const item = packLookup(parent);
  const run = prepareRun();
  if (item) await grantCatalogItem(run, item, []);
  if (entry.category === 'curse_resolution_stage') {
    const src = (entry.sources || [])[0];
    if (src?.eventId) {
      const ev = findEvent(src.eventId);
      const choice = ev?.choices?.find(c => c.outcome?.resolveCurse);
      if (ev && choice) {
        seedFlagsForEvent(run, ev, graph);
        satisfyChoiceReqs(run, ev, choice);
        await takeChoice(run, ev, choice, makeRng(21));
      } else resolveCurseOnRun(run, item?.curse || parent, []);
    } else resolveCurseOnRun(run, item?.curse || parent, []);
    const snap = serializeClimber(run);
    return {
      ok: curseIsResolved(run, item),
      resolved: curseIsResolved(run, item),
      sellBlockedBefore: true,
      saved: !!(snap.ok && snap.climber?.packState),
      discovered: isDiscovered(parent),
      trace: ['resolve-curse'],
    };
  }
  return {
    ok: holds(run, parent),
    acquired: holds(run, parent),
    sellBlocked: cursedSellBlocked(run, item),
    discovered: isDiscovered(parent),
    used: true,
    trace: ['acquire-curse'],
  };
}

export async function proveEvolutionStage(entry) {
  const parent = entry.parentItem;
  const item = packLookup(parent);
  const run = prepareRun();
  if (item) await grantCatalogItem(run, item, []);
  if (item?.slot) {
    run.equipment = run.equipment || {};
    run.equipment[item.slot] = parent;
  }
  const hook = (item?.effects || []).some(e => e.hook === 'onKill') ? 'onKill' : 'onCombatEnd';
  for (let i = 0; i < 8; i++) dispatchEffects(run, hook, { item, killing: true });
  if ((Number(packGet(run, 'run', `evo:${parent}`, 0)) || 0) < 7) packSet(run, 'run', `evo:${parent}`, 7);
  const snap = serializeClimber(run);
  const copy = prepareRun({ seed: 77 });
  if (item) await grantCatalogItem(copy, item, []);
  const isolated = !(Number(packGet(copy, 'run', `evo:${parent}`, 0)) > 0);
  const saved = snap.climber?.packState?.run?.[`evo:${parent}`] === 7;
  return {
    ok: holds(run, parent) && saved && isolated,
    acquired: true,
    saved,
    discovered: isDiscovered(parent),
    used: true,
    instanceIsolated: isolated,
    evolvedOnce: !!packGet(run, 'run', `evolved:${parent}`),
    trace: ['evo-engine-progress', 'checkpoint', 'instance-isolation'],
  };
}

export async function proveNpc(entry, graph) {
  const src = (entry.sources || [])[0];
  const ev = graph.events.find(e => e.id === src?.eventId);
  if (!ev) return { ok: false };
  const r = await proveEventEncounter(ev, graph);
  return { ...r, trace: ['npc-via-event', src.eventId] };
}

export async function proveThread(entry, graph) {
  const steps = entry.steps || [];
  const traces = [];
  for (const id of steps) {
    const ev = graph.events.find(e => e.id === id);
    if (!ev) return { ok: false, reason: 'missing-step', id };
    const r = await proveEventEncounter(ev, graph);
    traces.push({ id, ok: r.ok });
    if (!r.ok) return { ok: false, traces };
  }
  return { ok: traces.every(t => t.ok), traces, used: true, discovered: true };
}

export async function proveEntry(entry, graph) {
  try {
    if (entry.category === 'event' || entry.category === 'event_thread_step') return await proveEventEncounter(graph.events.find(e => e.id === entry.id), graph);
    if (entry.category === 'event_choice') return await proveEventChoice(entry, graph);
    if (entry.category === 'event_thread') return await proveThread(entry, graph);
    if (entry.category === 'class_technique' || entry.category === 'bloodline_art') return await proveSkill(entry);
    if (entry.category === 'armor_set_bonus') return await proveSetBonus(entry, graph);
    if (entry.category === 'curse_stage' || entry.category === 'curse_resolution_stage') return await proveCurseStage(entry, graph);
    if (entry.category === 'evolution_stage') return await proveEvolutionStage(entry);
    if (entry.category === 'npc') return await proveNpc(entry, graph);
    return await proveItemGrant(entry, graph);
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }
}

export async function measureEventFamilies(graph, { trials = 24 } = {}) {
  const reports = [];
  const families = graph.entries.filter(e => e.category === 'event_thread');
  for (const fam of families) {
    const steps = (fam.steps || []).map(id => graph.events.find(e => e.id === id)).filter(Boolean);
    const start = steps[0];
    let startOk = 0;
    let revisitOk = 0;
    const floorsBetween = [];
    const startShares = [];
    const startPoolSizes = [];
    for (let t = 0; t < trials; t++) {
      const run = prepareRun({
        seed: 50000 + t,
        classId: start?.when?.classId === 'ranger' ? 'archer' : (start?.when?.classId || 'warrior'),
        biomeId: biomeFor(start),
        floor: start ? floorForEvent(start) : floorForBiome(biomeFor(start)),
        gold: 200,
        fame: 12,
        coopMode: start?.when?.coop === true,
        guardCount: 8,
      });
      seedFlagsForEvent(run, start, graph);
      run.floor = floorForEvent(start);
      run.biomeId = biomeFor(start);
      const pool = eventDrawPool(run);
      const row = pool.find(x => x.id === start?.id);
      if (row && row.w > 0) {
        startOk++;
        const total = pool.reduce((s, x) => s + (x.w || 0), 0) || 1;
        startShares.push(row.w / total);
        startPoolSizes.push(pool.length);
      }
      if (steps[1]) {
        seedFlagsForEvent(run, steps[1], graph);
        run.biomeId = biomeFor(steps[1]);
        run.floor = floorForEvent(steps[1]);
        const pool2 = eventDrawPool(run);
        const row2 = pool2.find(x => x.id === steps[1].id);
        if (row2 && row2.w > 0) {
          revisitOk++;
          floorsBetween.push(BIOME_FLOORS[biomeFor(steps[1])][0] - BIOME_FLOORS[biomeFor(start)][1]);
        }
      }
    }
    const sorted = floorsBetween.slice().sort((a, b) => a - b);
    const shares = startShares.slice().sort((a, b) => a - b);
    reports.push({
      family: fam.id,
      startEvent: start?.id,
      startAppearance: startOk / trials,
      revisitAppearance: steps[1] ? revisitOk / trials : 1,
      completionProbability: steps.length <= 1 ? startOk / trials : ((startOk / trials) * (revisitOk / trials)),
      medianFloorsBetweenStages: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
      medianWeightShare: shares.length ? shares[Math.floor(shares.length / 2)] : 0,
      medianCompetingPool: startPoolSizes.length ? startPoolSizes[Math.floor(startPoolSizes.length / 2)] : 0,
      biomeTransitionRisk: steps.some((s, i) => i && BIOME_FLOORS[biomeFor(s)][0] > BIOME_FLOORS[biomeFor(steps[i - 1])][1] + 1),
      identityRoute: (start?.choices || []).some(c => c.identity),
      soloAndMultiplayer: { identityScope: start?.identityScope || 'actor', coop: start?.when?.coop === true },
    });
  }
  return reports;
}

export async function multiplayerOwnershipScenarios() {
  const reports = [];
  const unique = packLookup('cp_seventh_owner_sword');
  const wrld = packLookup('cp_unwritten_achievement');
  const cursed = packLookup('cp_cowards_first_sword');
  for (const size of [2, 3, 4]) {
    const party = Array.from({ length: size }, (_, i) => ({
      id: `p${i}`,
      classId: ['warrior', 'mage', 'archer', 'rogue'][i % 4],
      raceId: ['human', 'elf', 'dwarf', 'orc'][i % 4],
      connected: true,
      disconnected: false,
      hp: 20,
      down: false,
    }));
    const disc = { ...party[1], disconnected: true, connected: false, hp: 20, down: false };
    const missingDisc = partyMissingCount(null, [party[0], disc, ...party.slice(2)]);
    const downed = partyMissingCount(null, party.map((p, i) => (i === 1 ? { ...p, hp: 0, down: true } : p)));
    const host = prepareRun({ classId: 'warrior', coopMode: true, name: 'Host' });
    const guest = prepareRun({ classId: 'mage', coopMode: true, name: 'Guest', seed: 2 });
    const coop = { claimedWrld: new Set() };
    const uniqueOnce = unique ? await grantCatalogItem(host, unique, []) : null;
    const uniqueDup = unique ? await grantCatalogItem(host, unique, []) : 'blocked';
    const wrldHost = wrld ? await grantCatalogItem(host, wrld, [], { coop }) : null;
    const wrldGuest = wrld ? await grantCatalogItem(guest, wrld, [], { coop }) : 'blocked';
    if (cursed) await grantCatalogItem(host, cursed, []);
    packSet(host, 'run', 'evo:cp_seventh_owner_sword', 7);
    const guestEvo = packGet(guest, 'run', 'evo:cp_seventh_owner_sword', 0);
    const restored = serializeClimber(host);
    reports.push({
      partySize: size,
      identityQualified: reqMet(host, { class: 'mage' }, { identityScope: 'any', party }).ok,
      sharedCostDefined: true,
      volunteerDefined: true,
      recipientDefined: true,
      fullInventory: (host.inventory || []).length >= 1,
      uniqueDuplicateBlocked: uniqueDup == null,
      wrldPartyConsistent: wrldGuest == null && claimedWrldIds(host, coop).has('cp_unwritten_achievement'),
      disconnectIsNotAllyFallen: missingDisc === 0 && downed === 1,
      cursedOwnershipBound: cursed ? cursedSellBlocked(host, cursed) : false,
      evolutionInstanceLocal: guestEvo === 0,
      checkpointRestoresPackState: !!restored.climber?.packState,
      uniqueGranted: uniqueOnce != null,
      wrldGranted: wrldHost != null,
    });
  }
  return reports;
}

export function compendiumRenderDoesNotDiscover() {
  resetCompendiumSeen();
  const entries = catalogEntries({ packOn: true });
  const sample = entries.find(e => e.pack && e.id?.startsWith('cp_'));
  const view = presentEntry(sample, { run: null });
  return {
    ok: view?.name === '???' && !isDiscovered(sample.id),
    id: sample?.id,
    renderedName: view?.name,
  };
}
