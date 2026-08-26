// Authoritative Gate 7 acquisition graph: inventory, sources, static validators.
// A catalog definition is not a source. Every enabled entry needs ≥1 legal source.

import { rawPackCatalogs } from './registry.js';
import {
  CHANNEL, inOrdinaryLoot, classLootEligible, bloodlineLootEligible,
  biomeFindEligible, packRelicChannelEligible, packCampfireConsumableEligible,
  classIdsMatch, recipientRule, duplicatePolicy, isChaseIdentity,
} from './acquisition.js';
import { BIOME_FLOORS, floorRangeFor } from './rarity.js';
import { isCursedItem, isEvolvingItem } from './curse.js';
import { CANONICAL_CLASSES, CANONICAL_BLOODLINES } from './manifest.js';
import { CLASSES } from '../data/classes.js';
import { presentEntry } from '../compendium.js';

const BIOME_ORDER = ['forest', 'ruins', 'frost', 'swamp', 'hell', 'throne'];

export function biomeSpan(biome) {
  if (!biome || biome === 'any') return { minFloor: 1, maxFloor: 51 };
  const band = BIOME_FLOORS[biome];
  return band ? { minFloor: band[0], maxFloor: band[1] } : { minFloor: 1, maxFloor: 51 };
}

export function walkOutcome(o, visit) {
  if (!o || typeof o !== 'object') return;
  if (o.success) walkOutcome(o.success, visit);
  if (o.fail) walkOutcome(o.fail, visit);
  if (Array.isArray(o.randomOutcome)) o.randomOutcome.forEach(x => walkOutcome(x, visit));
  visit(o);
}

export function collectEventGraph(events) {
  const grants = [];
  const flagsSet = new Set();
  const flagsReq = new Map(); // flag -> [{eventId, kind}]
  const persistProducers = new Map();

  function reqFlag(flag, site) {
    if (!flag) return;
    if (!flagsReq.has(flag)) flagsReq.set(flag, []);
    flagsReq.get(flag).push(site);
  }

  function noteWhen(when, site) {
    if (!when || typeof when !== 'object') return;
    if (when.flag) reqFlag(when.flag, site);
    for (const f of [].concat(when.flags || [])) reqFlag(f, site);
    if (when.any) [].concat(when.any).forEach(w => noteWhen(w, site));
    if (when.all) [].concat(when.all).forEach(w => noteWhen(w, site));
    if (when.not) noteWhen(when.not, site);
  }

  for (const ev of events) {
    noteWhen(ev.when, { eventId: ev.id, kind: 'event.when' });
    for (const [i, c] of (ev.choices || []).entries()) {
      const site = { eventId: ev.id, choice: i, label: c.label, kind: 'choice' };
      if (c.req?.flag) reqFlag(c.req.flag, { ...site, kind: 'choice.req' });
      walkOutcome(c.outcome, (o) => {
        if (o.flag) flagsSet.add(o.flag);
        if (o.flag2) flagsSet.add(o.flag2);
        for (const k of ['item', 'consumable', 'consumable2', 'relic', 'skill', 'art']) {
          if (o[k]) {
            grants.push({
              id: o[k],
              kind: k,
              eventId: ev.id,
              family: ev.family || null,
              biome: ev.biome,
              choiceIndex: i,
              choiceLabel: c.label,
              identity: !!c.identity,
              req: c.req || null,
              classId: ev.when?.classId || c.req?.class || null,
              raceId: c.req?.race || ev.when?.race || null,
              coop: ev.when?.coop === true,
              flag: o.flag || null,
              resolveCurse: o.resolveCurse || null,
              pay: o.pay || null,
              receive: o.receive || null,
              recipient: recipientRule(o, ev),
            });
          }
        }
        if (o.resolveCurse) {
          for (const ref of [].concat(o.resolveCurse)) {
            grants.push({
              id: `curse:${ref}:resolved`,
              kind: 'resolveCurse',
              eventId: ev.id,
              choiceIndex: i,
              choiceLabel: c.label,
              curseRef: ref,
            });
          }
        }
      });
    }
  }
  return { grants, flagsSet, flagsReq, persistProducers };
}

function persistFlagsFromItems(items) {
  const map = new Map();
  for (const it of items) {
    for (const ef of it.effects || []) {
      if (ef.op === 'setFlag' && ef.persistFlag && ef.key) {
        if (!map.has(ef.key)) map.set(ef.key, []);
        map.get(ef.key).push(it.id);
      }
    }
  }
  return map;
}

function catalogKind(it, cat) {
  if (it.slot) return it.slot;
  if (cat.consumables.includes(it)) return 'consumable';
  if (cat.relics.includes(it)) return 'relic';
  return 'item';
}

function traitsOf(it) {
  const t = [];
  if (it.packOrdinary) t.push('packOrdinary');
  if (it.exclusive) t.push('exclusive');
  if (it.quest) t.push('quest');
  if (it.unique || it.rarity === 'unique') t.push('unique');
  if (it.wrld || it.rarity === 'wrld') t.push('wrld');
  if (isCursedItem(it)) t.push('cursed');
  if (isEvolvingItem(it)) t.push('evolving');
  if (it.setId) t.push('set-piece');
  if (it.classBound) t.push('class-bound');
  if (it.resonance) t.push('bloodline-resonant');
  if (it.hidden || CLASSES[it.classBound || it.class]?.hidden) t.push('hidden-class');
  return t;
}

function sourceRecord(type, extra = {}) {
  return { type, competes: [
    CHANNEL.ordinary, CHANNEL.class, CHANNEL.bloodline, CHANNEL.biome_find,
    CHANNEL.shop, CHANNEL.campfire,
  ].includes(type), ...extra };
}

function itemSources(it, grantsById, cat) {
  const sources = [];
  const granted = grantsById.get(it.id) || [];
  for (const g of granted) {
    sources.push(sourceRecord(g.family ? CHANNEL.event_chain : CHANNEL.event, {
      eventId: g.eventId,
      choiceIndex: g.choiceIndex,
      choiceLabel: g.choiceLabel,
      requiredClass: g.classId || null,
      requiredBloodline: g.raceId || null,
      requiredBiome: g.biome,
      requiredFlags: g.req?.flag ? [g.req.flag] : [],
      requiredGold: g.req?.gold || null,
      requiredFame: g.req?.fame || null,
      requiredInventory: g.req?.item ? [g.req.item] : [],
      identity: g.identity,
      coop: g.coop,
      recipient: g.recipient,
    }));
  }
  if (inOrdinaryLoot(it)) sources.push(sourceRecord(CHANNEL.ordinary, { pool: 'lootEquipmentPool' }));
  if (classLootEligible(it, it.classBound || null)) {
    sources.push(sourceRecord(CHANNEL.class, { requiredClass: it.classBound }));
  }
  if (bloodlineLootEligible(it, it.resonance || null)) {
    sources.push(sourceRecord(CHANNEL.bloodline, { requiredBloodline: it.resonance }));
  }
  if (biomeFindEligible(it)) sources.push(sourceRecord(CHANNEL.biome_find));
  if (packRelicChannelEligible(it)) {
    sources.push(sourceRecord(CHANNEL.campfire, { pool: 'packRelicChannel' }));
  }
  if (packCampfireConsumableEligible(it) && !it.slot) {
    sources.push(sourceRecord(CHANNEL.campfire, { pool: 'packCampfireConsumable' }));
  }
  if (it.evolvesTo && it.evolvesTo !== it.id) {
    sources.push(sourceRecord(CHANNEL.evolution, { from: it.id, to: it.evolvesTo }));
  }
  for (const other of [...cat.items, ...cat.relics, ...cat.consumables]) {
    if (other.evolvesTo === it.id && other.id !== it.id) {
      sources.push(sourceRecord(CHANNEL.evolution, { from: other.id, to: it.id }));
    }
    for (const ef of other.effects || []) {
      if ((ef.op === 'evolveItem' || ef.op === 'crackItem') && ef.itemId === it.id && other.id !== it.id) {
        sources.push(sourceRecord(CHANNEL.evolution, { from: other.id, to: it.id }));
      }
    }
  }
  if (it.rarity === 'unique' || it.unique) {
    if (!it.exclusive && !it.quest) sources.push(sourceRecord(CHANNEL.unique, { pool: 'rollUnique' }));
  }
  if (it.rarity === 'wrld' || it.wrld) {
    if (!it.exclusive && !it.quest) sources.push(sourceRecord(CHANNEL.wrld, { pool: 'rollWrld' }));
    if (granted.length) sources.push(sourceRecord(CHANNEL.wrld, { via: 'named-grant-claim' }));
  }
  return sources;
}

function skillSources(sk) {
  const sources = [];
  if (sk.bloodline || sk.capability === 'bloodline_art') {
    sources.push(sourceRecord(CHANNEL.bloodline_art, {
      requiredBloodline: sk.bloodline,
      offerLevels: [5, 13],
    }));
  } else {
    sources.push(sourceRecord(CHANNEL.technique, {
      requiredClass: sk.class,
      offerLevels: [5, 9, 13, 17, 21, 25],
    }));
  }
  return sources;
}

function pushEntry(entries, seen, row) {
  if (!row?.id) return;
  if (seen.has(row.id)) return;
  seen.add(row.id);
  entries.push(row);
}

export function buildPathGraph() {
  const cat = rawPackCatalogs();
  const events = cat.events || [];
  const items = [];
  const seenItem = new Set();
  for (const it of [...cat.items, ...cat.relics, ...cat.consumables]) {
    if (!it?.id || seenItem.has(it.id)) continue;
    seenItem.add(it.id);
    items.push(it);
  }
  const skills = Object.values(cat.skills || {});
  const collected = collectEventGraph(events);
  const persist = persistFlagsFromItems(items);
  const grantsById = new Map();
  for (const g of collected.grants) {
    if (!grantsById.has(g.id)) grantsById.set(g.id, []);
    grantsById.get(g.id).push(g);
  }

  const entries = [];
  const seen = new Set();

  for (const ev of events) {
    const span = biomeSpan(ev.biome);
    const preceding = [];
    if (ev.when?.flag) preceding.push(ev.when.flag);
    if (ev.when?.any) {
      for (const w of ev.when.any) if (w?.flag) preceding.push(w.flag);
    }
    pushEntry(entries, seen, {
      id: ev.id,
      category: ev.family ? 'event_thread_step' : 'event',
      traits: [
        ev.family ? 'thread' : 'standalone',
        ev.when ? 'revisit-or-gated' : 'start',
        ev.when?.coop ? 'coop' : 'solo-ok',
        ev.when?.classId ? 'class-gated' : null,
      ].filter(Boolean),
      sources: [sourceRecord(CHANNEL.event, {
        biome: ev.biome,
        family: ev.family || null,
        weight: ev.w,
        once: !!ev.once,
      })],
      requiredFloor: null,
      requiredBiome: ev.biome === 'any' ? null : ev.biome,
      requiredClass: ev.when?.classId || null,
      requiredBloodline: ev.when?.race || null,
      requiredPartySize: ev.when?.coop ? 2 : 1,
      requiredPartyIdentity: ev.identityScope || 'actor',
      requiredThread: ev.family || null,
      requiredFlags: preceding,
      requiredFame: ev.when?.fame || null,
      requiredGold: ev.when?.gold || null,
      requiredInventory: [].concat(ev.when?.item || []),
      preceding,
      earliestFloor: span.minFloor,
      latestFloor: span.maxFloor,
      competes: true,
      recipient: { pay: 'actor', receive: 'actor', identityScope: ev.identityScope || 'actor' },
      duplicates: ev.once ? 'once-per-climb' : 'repeatable',
      saveState: 'seenEvents + flags',
      compendiumTrigger: 'recordEvent',
      successor: null,
      uniqueClaim: false,
      wrldClaim: false,
    });

    for (const [i, c] of (ev.choices || []).entries()) {
      const cid = `${ev.id}::${i}`;
      pushEntry(entries, seen, {
        id: cid,
        category: 'event_choice',
        traits: [c.identity ? 'identity' : 'shared', c.req ? 'gated' : 'open'],
        sources: [sourceRecord(CHANNEL.event, { eventId: ev.id, choiceIndex: i })],
        requiredClass: c.req?.class || ev.when?.classId || null,
        requiredBloodline: c.req?.race || null,
        requiredFlags: c.req?.flag ? [c.req.flag] : [],
        requiredGold: c.req?.gold || null,
        requiredFame: c.req?.fame || null,
        requiredInventory: c.req?.item ? [c.req.item] : [],
        preceding: [ev.id],
        earliestFloor: span.minFloor,
        latestFloor: span.maxFloor,
        competes: false,
        recipient: recipientRule(c.outcome || {}, ev),
        duplicates: 'n/a',
        saveState: 'world.events choice label',
        compendiumTrigger: 'recordEvent(choice)',
        label: c.label,
        parentEvent: ev.id,
      });
    }
  }

  const families = [...new Set(events.map(e => e.family).filter(Boolean))];
  for (const fam of families) {
    const steps = events.filter(e => e.family === fam);
    pushEntry(entries, seen, {
      id: `thread:${fam}`,
      category: 'event_thread',
      traits: ['chain'],
      sources: steps.map(s => sourceRecord(CHANNEL.event_chain, { eventId: s.id, biome: s.biome })),
      preceding: steps.map(s => s.id),
      earliestFloor: Math.min(...steps.map(s => biomeSpan(s.biome).minFloor)),
      latestFloor: Math.max(...steps.map(s => biomeSpan(s.biome).maxFloor)),
      competes: true,
      saveState: 'family flags',
      compendiumTrigger: 'step recordEvent',
      steps: steps.map(s => s.id),
    });
  }

  for (const it of items) {
    const kind = catalogKind(it, cat);
    const grant = (grantsById.get(it.id) || [])[0];
    const grantSpan = grant?.biome ? biomeSpan(grant.biome) : null;
    const lootSpan = floorRangeFor(it) || { minFloor: 1, maxFloor: 51 };
    const span = grantSpan || lootSpan;
    const sources = itemSources(it, grantsById, cat);
    pushEntry(entries, seen, {
      id: it.id,
      category: kind,
      name: it.name,
      traits: traitsOf(it),
      sources,
      requiredFloor: it.minFloor || null,
      requiredBiome: it.biomes?.[0] || grant?.biome || null,
      requiredClass: it.classBound || grant?.classId || null,
      requiredBloodline: it.resonance || grant?.raceId || null,
      requiredPartySize: grant?.coop ? 2 : 1,
      requiredPartyIdentity: grant?.recipient?.identityScope || 'actor',
      requiredThread: grant?.family || null,
      requiredFlags: grant?.req?.flag ? [grant.req.flag] : [],
      requiredFame: grant?.req?.fame || null,
      requiredGold: grant?.req?.gold || null,
      requiredInventory: grant?.req?.item ? [grant.req.item] : [],
      preceding: grant ? [grant.eventId] : [],
      earliestFloor: span.minFloor,
      latestFloor: span.maxFloor,
      competes: sources.some(s => s.competes),
      recipient: grant?.recipient || { pay: 'actor', receive: 'actor' },
      duplicates: duplicatePolicy(it),
      saveState: it.slot ? 'equipment/inventory/gearBag' : (kind === 'relic' ? 'relics' : 'consumables'),
      compendiumTrigger: 'noteDiscovery on grant',
      successor: it.evolvesTo && it.evolvesTo !== it.id ? it.evolvesTo : (it.curse ? `curse:${it.id}:resolved` : null),
      uniqueClaim: !!(it.unique || it.rarity === 'unique'),
      wrldClaim: !!(it.wrld || it.rarity === 'wrld'),
      curse: it.curse || null,
      setId: it.setId || null,
      acquisition: it.acquisition || null,
      rarity: it.rarity,
    });

    if (isCursedItem(it)) {
      pushEntry(entries, seen, {
        id: `curse:${it.id}:acquired`,
        category: 'curse_stage',
        traits: ['curse', 'acquired'],
        sources: sources.map(s => ({ ...s, stage: 'acquire' })),
        preceding: [it.id],
        successor: `curse:${it.id}:resolved`,
        curse: it.curse,
        parentItem: it.id,
        resolution: it.resolution || null,
        earliestFloor: span.minFloor,
        latestFloor: span.maxFloor,
        duplicates: 'instance_bound',
        saveState: `packState.run curseHeld:${it.id}`,
        compendiumTrigger: 'noteDiscovery parent',
      });
      const resGrants = collected.grants.filter(g =>
        g.kind === 'resolveCurse' && (g.curseRef === it.curse || g.curseRef === it.id));
      pushEntry(entries, seen, {
        id: `curse:${it.id}:resolved`,
        category: 'curse_resolution_stage',
        traits: ['curse', 'resolved'],
        sources: resGrants.length
          ? resGrants.map(g => sourceRecord(CHANNEL.event, { eventId: g.eventId, choiceLabel: g.choiceLabel }))
          : (it.curse === 'remember_damage'
            ? [sourceRecord(CHANNEL.campfire, { note: 'campfire cleanse' })]
            : []),
        preceding: [`curse:${it.id}:acquired`],
        parentItem: it.id,
        curse: it.curse,
        saveState: `packState.run curseResolved:${it.id}`,
        compendiumTrigger: 'noteDiscovery on resolve',
        earliestFloor: span.minFloor,
        latestFloor: 51,
      });
    }

    if (isEvolvingItem(it)) {
      pushEntry(entries, seen, {
        id: `evo:${it.id}:progress`,
        category: 'evolution_stage',
        traits: ['evolving'],
        sources: [sourceRecord(CHANNEL.evolution, { parent: it.id, threshold: 7 })],
        preceding: [it.id],
        successor: it.evolvesTo && it.evolvesTo !== it.id ? it.evolvesTo : null,
        parentItem: it.id,
        saveState: `packState.run evo:${it.id} (instance-keyed)`,
        earliestFloor: span.minFloor,
        latestFloor: 51,
        duplicates: 'instance-isolated',
      });
    }
  }

  const setIds = [...new Set(cat.items.filter(i => i.setId).map(i => i.setId))];
  for (const setId of setIds) {
    const pieces = cat.items.filter(i => i.setId === setId);
    const bonus = pieces[0]?.setBonus || {};
    for (const n of [2, 3]) {
      if (!bonus[n]?.length) continue;
      pushEntry(entries, seen, {
        id: `set:${setId}:${n}`,
        category: 'armor_set_bonus',
        traits: [`${n}-piece`],
        sources: pieces.map(p => sourceRecord('set-wear', { pieceId: p.id })),
        preceding: pieces.map(p => p.id),
        requiredClass: pieces[0].classBound || null,
        requiredBloodline: pieces[0].resonance || null,
        saveState: 'equipped setPiecesWorn',
        compendiumTrigger: 'piece discovery',
        setId,
        pieces: pieces.map(p => p.id),
      });
    }
  }

  for (const sk of skills) {
    const hidden = !!(CLASSES[sk.class]?.hidden);
    pushEntry(entries, seen, {
      id: sk.id,
      category: sk.bloodline || sk.capability === 'bloodline_art' ? 'bloodline_art' : 'class_technique',
      name: sk.name,
      traits: [hidden ? 'hidden-class' : 'starting-class', sk.bloodline ? 'art' : 'technique'],
      sources: skillSources(sk),
      requiredClass: sk.class || null,
      requiredBloodline: sk.bloodline || null,
      earliestFloor: 1,
      latestFloor: 51,
      competes: true,
      recipient: { pay: 'actor', receive: 'actor' },
      duplicates: 'character',
      saveState: sk.bloodline ? 'knownSkills + arts' : 'knownSkills',
      compendiumTrigger: 'noteDiscovery on learn',
      hiddenClass: hidden,
    });
  }

  const npcSites = [
    { id: 'npc:seventh_summoned', eventId: 'cp_seventh_summoned', name: 'The Seventh Summoned Hero' },
    { id: 'npc:gate_mason', eventId: 'cp_worker_not_wizard', name: 'Gate Mason' },
    { id: 'npc:fame_eater', eventId: 'cp_creature_applauding', name: 'Fame Eater' },
    { id: 'npc:ashen_rivals', eventId: 'cp_campfire_across_path', name: 'Ashen Rival Party' },
    { id: 'npc:futures_merchant', eventId: 'cp_buy_something_you_might_need', name: 'Futures Merchant' },
    { id: 'npc:false_system', eventId: 'cp_optional_mandatory', name: 'False System overlay' },
    { id: 'npc:grave_tax', eventId: 'cp_grave_tax', name: 'Grave-Tax Collector' },
    { id: 'npc:drowned_court', eventId: 'cp_court_beneath_bog', name: 'Drowned Court' },
    { id: 'npc:echo_party', eventId: 'cp_echo_party_frost', name: 'Echo Party' },
    { id: 'npc:bell_companion', eventId: 'cp_bell_beneath_roots', name: 'Bell Companion' },
    { id: 'npc:administrator', eventId: 'cp_customer_support_boss', name: 'Exhausted administrator' },
  ];
  for (const n of npcSites) {
    pushEntry(entries, seen, {
      id: n.id,
      category: 'npc',
      name: n.name,
      traits: ['acquisition-path'],
      sources: [sourceRecord(CHANNEL.event, { eventId: n.eventId })],
      preceding: [n.eventId],
      saveState: 'flags / knowledge',
      compendiumTrigger: 'recordEvent',
    });
  }

  return {
    entries,
    events,
    items,
    skills,
    grants: collected.grants,
    flagsSet: [...collected.flagsSet],
    flagsReq: [...collected.flagsReq.entries()].map(([flag, sites]) => ({ flag, sites })),
    persistFlags: [...persist.entries()].map(([flag, ids]) => ({ flag, items: ids })),
    grantsById: Object.fromEntries([...grantsById.entries()]),
  };
}

function contradictoryRequirements(entry) {
  if (entry.earliestFloor != null && entry.latestFloor != null && entry.earliestFloor > entry.latestFloor) {
    return 'earliestFloor > latestFloor';
  }
  if (entry.requiredBiome && entry.requiredBiome !== 'any' && (entry.sources || []).every(s => s.type !== 'event' && s.type !== 'event_chain')) {
    const span = biomeSpan(entry.requiredBiome);
    if (entry.latestFloor != null && entry.latestFloor < span.minFloor) return 'biome window vs latestFloor';
    if (entry.earliestFloor != null && entry.earliestFloor > span.maxFloor) return 'biome window vs earliestFloor';
  }
  return null;
}

export function staticValidate(graph) {
  const defects = [];
  const ids = new Set(graph.entries.map(e => e.id));
  const itemIds = new Set(graph.items.map(i => i.id));
  const skillIds = new Set(graph.skills.map(s => s.id));
  const eventIds = new Set(graph.events.map(e => e.id));
  const produced = new Set(graph.flagsSet);
  for (const p of graph.persistFlags) produced.add(p.flag);

  const inventoryKinds = new Set([
    'weapon', 'helmet', 'chest', 'legs', 'boots', 'accessory',
    'relic', 'consumable', 'class_technique', 'bloodline_art',
    'event', 'event_thread_step', 'event_choice', 'event_thread',
    'armor_set_bonus', 'curse_stage', 'curse_resolution_stage',
    'evolution_stage', 'npc',
  ]);

  for (const e of graph.entries) {
    if (!inventoryKinds.has(e.category) && e.category !== 'item') {
      /* still count */
    }
    const needsSource = ![].includes(e.category);
    if (needsSource && (!e.sources || !e.sources.length)) {
      defects.push({ code: 'NO_SOURCE', id: e.id, category: e.category });
    }
    const contra = contradictoryRequirements(e);
    if (contra) defects.push({ code: 'CONTRADICTORY_REQUIREMENTS', id: e.id, detail: contra });
    if (e.requiredClass === 'ranger') {
      defects.push({ code: 'RANGER_NOT_ARCHER', id: e.id });
    }
    if (e.requiredClass && e.requiredClass !== 'universal' && !CANONICAL_CLASSES.includes(e.requiredClass)
      && e.requiredClass !== 'ranger') {
      defects.push({ code: 'WRONG_CLASS_ID', id: e.id, classId: e.requiredClass });
    }
    if (e.requiredBloodline && !CANONICAL_BLOODLINES.includes(e.requiredBloodline)) {
      defects.push({ code: 'WRONG_BLOODLINE_ID', id: e.id, bloodline: e.requiredBloodline });
    }
  }

  for (const g of graph.grants) {
    if (g.kind === 'useItem' || g.kind === 'resolveCurse') continue;
    if (!String(g.id).startsWith('cp_')) continue;
    if (!itemIds.has(g.id) && !skillIds.has(g.id)) {
      defects.push({ code: 'UNKNOWN_GRANT_ID', id: g.id, eventId: g.eventId });
    }
  }

  for (const { flag, sites } of graph.flagsReq) {
    if (flag.startsWith('item:')) continue;
    if (!produced.has(flag)) {
      defects.push({ code: 'FLAG_NEVER_PRODUCED', flag, sites: sites.slice(0, 6) });
    }
  }

  const byFamily = new Map();
  for (const ev of graph.events) {
    if (!ev.family) continue;
    if (!byFamily.has(ev.family)) byFamily.set(ev.family, []);
    byFamily.get(ev.family).push(ev);
  }
  for (const [fam, steps] of byFamily) {
    const order = steps.map(s => ({
      id: s.id,
      biome: s.biome,
      idx: BIOME_ORDER.indexOf(s.biome === 'any' ? 'forest' : s.biome),
    }));
    for (let i = 1; i < order.length; i++) {
      if (order[i].idx >= 0 && order[i - 1].idx >= 0 && order[i].idx < order[i - 1].idx) {
        defects.push({
          code: 'EVENT_ORDER_IMPOSSIBLE',
          family: fam,
          earlier: order[i].id,
          later: order[i - 1].id,
        });
      }
      const prevSpan = biomeSpan(steps[i - 1].biome);
      const nextSpan = biomeSpan(steps[i].biome);
      if (nextSpan.minFloor > prevSpan.maxFloor + 0 && nextSpan.minFloor > prevSpan.maxFloor) {
        /* biome jump forward is OK */
      }
      if (nextSpan.maxFloor < prevSpan.minFloor) {
        defects.push({
          code: 'FLOOR_WINDOW_CLOSES_BEFORE_REVISIT',
          family: fam,
          start: steps[i - 1].id,
          revisit: steps[i].id,
        });
      }
    }
    const startFlags = new Set();
    walkOutcome(steps[0]?.choices?.[0]?.outcome, () => {});
    for (const c of steps[0]?.choices || []) {
      walkOutcome(c.outcome, (o) => {
        if (o.flag) startFlags.add(o.flag);
        if (o.flag2) startFlags.add(o.flag2);
      });
    }
    for (let i = 1; i < steps.length; i++) {
      const when = steps[i].when;
      if (!when) continue;
      const needed = [];
      if (when.flag) needed.push(when.flag);
      if (when.any) {
        const any = when.any.map(w => w.flag).filter(Boolean);
        if (any.length && !any.some(f => produced.has(f))) {
          defects.push({ code: 'FLAG_NEVER_PRODUCED', flag: any.join('|'), family: fam, eventId: steps[i].id });
        }
        continue;
      }
      for (const f of needed) {
        if (!produced.has(f)) {
          defects.push({ code: 'FLAG_NEVER_PRODUCED', flag: f, family: fam, eventId: steps[i].id });
        }
      }
    }
  }

  const cursed = graph.items.filter(isCursedItem);
  for (const it of cursed) {
    const acquire = graph.entries.find(e => e.id === it.id);
    const resolve = graph.entries.find(e => e.id === `curse:${it.id}:resolved`);
    const acqFloor = acquire?.earliestFloor ?? 1;
    const resLatest = resolve?.latestFloor ?? 51;
    if (acqFloor > resLatest) {
      defects.push({ code: 'CURSE_AFTER_RESOLUTION_EXPIRED', id: it.id });
    }
    if (!resolve?.sources?.length) {
      defects.push({ code: 'NO_SOURCE', id: `curse:${it.id}:resolved`, category: 'curse_resolution_stage' });
    }
  }

  for (const it of graph.items.filter(isEvolvingItem)) {
    const span = floorRangeFor(it) || { minFloor: 1, maxFloor: 51 };
    if (span.minFloor + 7 > 51) {
      defects.push({ code: 'EVOLUTION_CANNOT_FINISH', id: it.id });
    }
  }

  const setIds = [...new Set(graph.items.filter(i => i.setId).map(i => i.setId))];
  for (const setId of setIds) {
    const pieces = graph.items.filter(i => i.setId === setId);
    const slots = pieces.map(p => p.slot);
    if (new Set(slots).size !== slots.length) {
      defects.push({ code: 'SET_DUPLICATE_SLOT', setId, slots });
    }
    if (pieces.length < 3) defects.push({ code: 'SET_MISSING_PIECES', setId, count: pieces.length });
    for (const p of pieces) {
      const row = graph.entries.find(e => e.id === p.id);
      if (!row?.sources?.length) defects.push({ code: 'SET_UNOBTAINABLE_PIECE', id: p.id, setId });
    }
    const sample = pieces[0];
    if (!sample.setBonus?.[2]?.length || !sample.setBonus?.[3]?.length) {
      defects.push({ code: 'SET_MISSING_BONUS', setId });
    }
  }

  const classBound = graph.items.filter(i => i.classBound);
  for (const it of classBound) {
    if (it.classBound === 'ranger') defects.push({ code: 'RANGER_NOT_ARCHER', id: it.id });
    else if (!CANONICAL_CLASSES.includes(it.classBound)) {
      defects.push({ code: 'WRONG_CLASS_ID', id: it.id, classId: it.classBound });
    }
  }

  for (const cls of ['warlock', 'viking']) {
    const hasWpn = graph.items.some(i => i.classBound === cls && i.slot === 'weapon');
    const hasSet = graph.items.some(i => i.setId && i.classBound === cls);
    const hasTech = graph.skills.some(s => s.class === cls);
    const hasEv = graph.events.some(e => e.when?.classId === cls);
    if (!hasWpn || !hasSet || !hasTech || !hasEv) {
      defects.push({ code: 'WARLOCK_VIKING_OMITTED', classId: cls, hasWpn, hasSet, hasTech, hasEv });
    }
  }

  for (const it of graph.items) {
    if (isChaseIdentity(it) && inOrdinaryLoot(it)) {
      defects.push({ code: 'UNIQUE_WRLD_IN_ORDINARY_LOOT', id: it.id });
    }
  }

  const wrld = graph.items.filter(i => i.wrld || i.rarity === 'wrld');
  for (const it of wrld) {
    const row = graph.entries.find(e => e.id === it.id);
    const usesLedger = (row?.duplicates === 'party_claim')
      || (row?.sources || []).some(s => s.type === CHANNEL.wrld || s.via === 'named-grant-claim');
    if (!usesLedger) defects.push({ code: 'WRLD_BYPASSES_CLAIM_LEDGER', id: it.id });
  }

  const presentSrc = String(presentEntry);
  if (/noteDiscovery/.test(presentSrc)) {
    defects.push({ code: 'COMPENDIUM_DISCOVERY_ON_RENDER' });
  }

  const coopEvents = graph.events.filter(e => e.when?.coop === true || e.identityScope === 'any' || e.identityScope === 'party');
  for (const ev of coopEvents) {
    for (const [i, c] of (ev.choices || []).entries()) {
      const rule = recipientRule(c.outcome || {}, ev);
      if (!rule || !rule.pay || !rule.receive) {
        defects.push({ code: 'MP_OWNERSHIP_UNDEFINED', eventId: ev.id, choice: i });
      }
    }
  }

  const orphanItems = graph.entries.filter(e =>
    ['weapon', 'helmet', 'chest', 'legs', 'boots', 'accessory', 'relic', 'consumable'].includes(e.category)
    && (!e.sources || !e.sources.length));

  return { defects, orphanItems };
}

export function classifyStatic(entry, defects) {
  const hits = defects.filter(d => d.id === entry.id || d.eventId === entry.id);
  if (hits.some(d => d.code === 'NO_SOURCE' || d.code === 'UNKNOWN_GRANT_ID')) return 'UNRESOLVED';
  if (hits.length) return 'UNRESOLVED';
  if (entry.sources?.length) return 'STATICALLY_REACHABLE';
  return 'UNRESOLVED';
}
