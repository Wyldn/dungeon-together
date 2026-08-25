import { ALL_EQUIPMENT, RELICS, CONSUMABLES } from '../js/data/items.js';
import { SKILLS } from '../js/data/skills.js';
import { EVENTS } from '../js/data/events.js';
import { CLASSES, SUBCLASSES } from '../js/data/classes.js';
import {
  setPackEnabled, resetPackFlags, isPackOn, PACK_STORAGE_KEY, PACK_GATE_STORAGE_KEY,
  PACK_DEFAULT_ON, GATE, activeGate,
} from '../js/content_pack/flags.js';
import { rawPackCatalogs } from '../js/content_pack/registry.js';
import { curseInfo, isCursedItem } from '../js/content_pack/curse.js';
import {
  catalogEntries, liveCatalogIds, coverageReport, presentEntry, visibleEntries,
  renderEquipmentPanel, renderSkillsPanel, renderEventsPanel, defaultFilters,
  entryMatchesFilters, SET_ID_PREFIX,
} from '../js/compendium.js';
import {
  noteDiscovery, isDiscovered, resetCompendiumSeen, reloadCompendiumSeenFromStorage,
  COMPENDIUM_SEEN_KEY, noteDiscoveryFromRun, persistCompendiumSeen,
} from '../js/compendium_seen.js';
import { serializeClimber } from '../js/mp_checkpoint.js';
import { newRun } from '../js/state.js';

function withStore(fn) {
  const mem = {};
  const prev = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; },
  };
  resetCompendiumSeen();
  try { return fn(mem); }
  finally {
    resetCompendiumSeen();
    globalThis.localStorage = prev;
  }
}

function playerCtx(extra = {}) {
  const secretSkillIds = new Set(
    Object.values(SUBCLASSES).filter(s => s.secret && s.skill).map(s => s.skill)
  );
  return {
    debug: false,
    packOn: isPackOn(),
    secretSkillIds,
    callingUnlocked: c => !c.hidden,
    unlockedClasses: [],
    knownBloodlines: [],
    ...extra,
  };
}

export function runCompendiumTests(t) {
  console.log('— compendium coverage / curses / discovery —');

  resetPackFlags();
  resetCompendiumSeen();
  t('production default is pack-on at Gate 7', PACK_DEFAULT_ON === true && isPackOn() === true);
  setPackEnabled(false);
  t('forced off still omits pack rows', isPackOn() === false);

  const offCov = coverageReport({ packOn: false });
  t('pack-off coverage has no missing live ids', offCov.missing.length === 0);
  t('pack-off coverage has no extras', offCov.extra.length === 0);
  t('pack-off coverage has no duplicate ids', offCov.duplicates.length === 0);
  t('pack-off catalog has no cp_ rows', catalogEntries({ packOn: false }).every(e => !String(e.id).startsWith('cp_')));
  t('pack-off live ids are vanilla only', liveCatalogIds({ packOn: false }).every(id => !String(id).startsWith('cp_')));

  setPackEnabled(true);
  const onCov = coverageReport({ packOn: true });
  t('pack-on coverage has no missing live ids', onCov.missing.length === 0);
  t('pack-on coverage has no extras', onCov.extra.length === 0);
  t('pack-on coverage has no duplicate ids', onCov.duplicates.length === 0);
  t('legacy mirror records do not leak', onCov.leakedLegacy.length === 0);

  const entries = catalogEntries({ packOn: true });
  const byId = new Map(entries.map(e => [e.id, e]));
  const live = [...new Set(liveCatalogIds({ packOn: true }))];
  t('every live catalog id has exactly one entry', live.every(id => byId.get(id) && entries.filter(e => e.id === id).length === 1));

  const cat = rawPackCatalogs();
  t('stable pack weapon id still present', byId.has('cp_gate_iron_sword'));
  t('stable cursed weapon id still present', byId.has('cp_cowards_first_sword'));
  t('every pack item/relic/consumable/skill/event is represented',
    [...cat.items, ...cat.relics, ...cat.consumables, ...Object.values(cat.skills), ...cat.events]
      .every(it => it?.id && byId.has(it.id)));

  const sets = entries.filter(e => e.kind === 'set');
  const setPieces = entries.filter(e => e.kind === 'equipment' && e.setId);
  t('armor sets are derived entries', sets.length >= 11);
  t('every set piece belongs to a set entry', setPieces.every(p => {
    const set = byId.get(SET_ID_PREFIX + p.setId);
    return set && set.pieceIds.includes(p.id);
  }));
  t('set ids do not collide with catalog ids', sets.every(s => !live.includes(s.id)));

  const cursed = entries.filter(e => e.cursed);
  t('cursed items exist in the pack', cursed.length >= 20);
  t('cursed is never a rarity', cursed.every(e => e.rarity && e.rarity !== 'cursed'));
  t('vanilla rarity list unchanged', ['common', 'uncommon', 'rare', 'epic', 'legendary', 'unique', 'wrld'].every(r =>
    ALL_EQUIPMENT.some(i => i.rarity === r) || r === 'wrld' || RELICS.some(i => i.rarity === r)));
  t('cursed metadata includes drawback and resolution', cursed.filter(e => e.kind === 'equipment').every(e => {
    const info = curseInfo(e.source);
    return info && info.cursed && info.drawback && info.resolution && info.rarity !== 'cursed';
  }));
  t('isCursedItem is orthogonal to rarity', cursed.every(e => isCursedItem(e.source) && e.source.rarity !== 'cursed'));

  t('evolving items are flagged', entries.some(e => e.evolving && (e.id === 'cp_thrones_blank_sheet' || e.id === 'cp_seventh_owner_sword')));
  t('unique pack items keep unique flag without a unique rarity requirement',
    entries.some(e => e.id === 'cp_seventh_owner_sword' && e.unique));
  t('vanilla WRLD items still appear', entries.some(e => e.wrld || e.rarity === 'wrld'));
  t('event-linked pack relics appear', entries.some(e => e.id === 'cp_receipt_from_tomorrow' && e.kind === 'relic'));
  t('consumables appear', entries.some(e => e.kind === 'consumable' && e.id === 'cp_stitchleaf_tonic'));
  t('class techniques appear', entries.some(e => e.kind === 'skill' && e.id === 'cp_gatebreaker_charge'));
  t('bloodline arts appear', entries.some(e => e.kind === 'art' && e.id === 'cp_art_ancestral_breath'));
  t('pack events appear', entries.some(e => e.kind === 'event' && e.id === 'cp_backward_threshold'));
  t('every represented row has a description', entries.every(e => e.name && e.desc));

  const ctx = playerCtx({ packOn: true });
  const hiddenClass = Object.values(CLASSES).find(c => c.hidden);
  const hiddenSkill = entries.find(e => e.kind === 'skill' && e.classId === hiddenClass?.id && e.pack);
  t('hidden class techniques are omitted for locked players', !hiddenSkill || !visibleEntries(ctx).some(e => e.id === hiddenSkill.id));
  t('hidden class techniques appear once unlocked', !hiddenSkill || visibleEntries(playerCtx({
    packOn: true,
    callingUnlocked: () => true,
    unlockedClasses: [hiddenClass.id],
  })).some(e => e.id === hiddenSkill.id));

  const art = entries.find(e => e.id === 'cp_art_ancestral_breath');
  t('undiscovered bloodline arts do not list', !visibleEntries(ctx).some(e => e.id === art.id));
  t('bloodline arts list after discovery or known bloodline',
    visibleEntries(playerCtx({ packOn: true, knownBloodlines: ['dragonkin'] })).some(e => e.id === art.id));

  const cursedSword = entries.find(e => e.id === 'cp_cowards_first_sword');
  const hiddenView = presentEntry(cursedSword, ctx);
  t('undiscovered pack gear is spoilered', hiddenView.discovered === false && hiddenView.name === '???');
  const equipHtml = renderEquipmentPanel(ctx, defaultFilters(), () => '');
  t('undiscovered cursed name does not leak in player HTML', !equipHtml.includes("The Coward's First Sword"));
  t('undiscovered cursed id does not leak in player HTML', !equipHtml.includes('cp_cowards_first_sword'));
  t('CURSED filter matches cursed trait, not rarity',
    entryMatchesFilters(cursedSword, { ...defaultFilters(), trait: 'cursed' }, { debug: true, packOn: true }));

  const debugHtml = renderEquipmentPanel({ ...ctx, debug: true }, { ...defaultFilters(), trait: 'cursed' }, () => '');
  t('debug cursed filter shows CURSED tag', debugHtml.includes('CURSED') && debugHtml.includes('Coward'));

  const secretSkill = Object.values(SUBCLASSES).find(s => s.secret)?.skill;
  if (secretSkill) {
    t('secret subclass skills stay hidden', !visibleEntries(ctx).some(e => e.id === secretSkill));
    t('secret subclass skills appear in debug', visibleEntries({ ...ctx, debug: true }).some(e => e.id === secretSkill));
  }

  const evHtml = renderEventsPanel(ctx, defaultFilters());
  t('undiscovered pack event title does not leak', !evHtml.includes('The Backward Threshold'));
  const skillsHtml = renderSkillsPanel(ctx, defaultFilters());
  t('undiscovered pack technique name does not leak', !skillsHtml.includes('Gatebreaker Charge'));

  withStore(() => {
    t('discovery starts empty', isDiscovered('cp_cowards_first_sword') === false);
    noteDiscovery('cp_cowards_first_sword');
    persistCompendiumSeen();
    t('noteDiscovery marks the id', isDiscovered('cp_cowards_first_sword'));
    reloadCompendiumSeenFromStorage();
    t('discovery survives reload', isDiscovered('cp_cowards_first_sword'));
    const after = presentEntry(cursedSword, playerCtx({ packOn: true }));
    t('discovered pack gear reveals name and drawback',
      after.discovered && after.name.includes('Coward') && after.curse?.drawback);
  });

  withStore(() => {
    const meta = { shards: 0, upgrades: {}, achievements: [], unlockedClasses: [] };
    const run = newRun(meta, { classId: 'warrior', raceId: 'human', name: 'QA' });
    run.inventory = ['cp_cowards_first_sword'];
    run.relics = ['cp_receipt_from_tomorrow'];
    noteDiscoveryFromRun(run);
    persistCompendiumSeen();
    t('run contents discover inventory and relics',
      isDiscovered('cp_cowards_first_sword') && isDiscovered('cp_receipt_from_tomorrow'));
    const snap = serializeClimber(run);
    t('checkpoint serializes', snap.ok === true);
    t('checkpoint does not carry the seen key', !('compendiumSeen' in snap.climber));
    const raw = JSON.stringify(snap.climber);
    t('checkpoint omits the device seen store', !raw.includes(COMPENDIUM_SEEN_KEY));
  });

  withStore(() => {
    noteDiscovery('cp_art_ancestral_breath');
    const snap = serializeClimber({
      schema: 2, seed: 1, floor: 2, name: 'A', classId: 'warrior', raceId: 'human',
      stats: {}, skills: ['slash'], knownSkills: ['slash'], equipment: {}, inventory: [],
      relics: [], consumables: [], flags: {},
    });
    t('other-player discovery is not in climber blob',
      snap.ok && !JSON.stringify(snap.climber).includes('cp_art_ancestral_breath'));
    resetCompendiumSeen();
    t('a second device starts without the first player\'s finds', isDiscovered('cp_art_ancestral_breath') === false);
  });

  withStore(mem => {
    const prevLoc = globalThis.location;
    resetPackFlags();
    globalThis.location = { search: '?pack=1' };
    t('URL ?pack=1 enables the pack at Gate 7', isPackOn() === true && activeGate() === GATE.MULTIPLAYER);
    globalThis.location = { search: '?pack=0' };
    t('URL ?pack=0 is the emergency off', isPackOn() === false && activeGate() === GATE.BASELINE);
    globalThis.location = { search: '' };
    mem[PACK_STORAGE_KEY] = '1';
    t('localStorage dt_content_pack=1 enables Gate 7', isPackOn() === true && activeGate() === GATE.MULTIPLAYER);
    mem[PACK_STORAGE_KEY] = '0';
    t('localStorage dt_content_pack=0 is emergency off', isPackOn() === false);
    mem[PACK_GATE_STORAGE_KEY] = '4';
    mem[PACK_STORAGE_KEY] = '1';
    t('localStorage dt_content_gate pins the gate', isPackOn() && activeGate() === 4);
    globalThis.location = { search: '' };
    delete mem[PACK_STORAGE_KEY];
    delete mem[PACK_GATE_STORAGE_KEY];
    resetPackFlags();
    t('with empty URL/storage, default is on', isPackOn() === true && activeGate() === GATE.MULTIPLAYER);
    globalThis.location = prevLoc;
    resetPackFlags();
  });

  resetPackFlags();
  resetCompendiumSeen();
  setPackEnabled(false);
  t('vanilla catalogs still have descriptions after pack-off',
    ALL_EQUIPMENT.every(i => i.desc) && RELICS.every(r => r.desc) && CONSUMABLES.every(c => c.desc)
    && Object.values(SKILLS).every(s => s.desc) && EVENTS.every(e => e.text));
}
