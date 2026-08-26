// Gate 7 content-path / acquisition-reachability tests.
import { setPackEnabled, setPackGate, resetPackFlags, GATE, isPackOn, packStatus } from '../js/content_pack/flags.js';
import { inOrdinaryLoot } from '../js/content_pack/acquisition.js';
import { partyMissingCount } from '../js/content_pack/engine.js';
import { presentEntry, catalogEntries } from '../js/compendium.js';
import { isDiscovered, resetCompendiumSeen } from '../js/compendium_seen.js';
import { cursedSellBlocked, grantCatalogItem } from '../js/content_pack/grants.js';
import { packLookup, rawPackCatalogs } from '../js/content_pack/registry.js';
import { ALL_EQUIPMENT } from '../js/data/items.js';
import { EVENTS, eventDrawPool } from '../js/data/events.js';
import { runContentPathAudit, STARTING_COMMIT_SHA } from './content_path_audit.js';

export async function runContentPathTests(t) {
  console.log('— content path / Gate 7 reachability —');
  resetPackFlags();
  setPackEnabled(true);
  setPackGate(GATE.MULTIPLAYER);
  t('audit starting SHA is recorded', /^[0-9a-f]{40}$/.test(STARTING_COMMIT_SHA));
  t('Gate 7 is explicitly enabled for the path audit', isPackOn() === true && packStatus().gate === GATE.MULTIPLAYER);

  const result = await runContentPathAudit({ writeReports: true, proveAll: true });
  t('authoritative inventory is non-empty', result.graph.entries.length > 400);
  t('every event and choice is inventoried',
    result.graph.events.every(ev => result.graph.entries.some(e => e.id === ev.id))
    && result.graph.events.every(ev => (ev.choices || []).every((_, i) => result.graph.entries.some(e => e.id === `${ev.id}::${i}`))));
  t('stable ids are unique in the graph',
    new Set(result.graph.entries.map(e => e.id)).size === result.graph.entries.length);
  t('zero UNRESOLVED enabled entries', result.counts.UNRESOLVED === 0);
  if (result.counts.UNRESOLVED) {
    console.error('  unresolved sample', result.audit.unresolved.slice(0, 24).map(u => `${u.id} ${u.proof?.reason || u.sources}`));
  }
  t('no enabled item/skill/event lacks a source',
    !result.statics.defects.some(d => d.code === 'NO_SOURCE' && !String(d.id).startsWith('curse:')));
  t('grants do not reference unknown ids', !result.statics.defects.some(d => d.code === 'UNKNOWN_GRANT_ID'));
  t('ranger content maps to archer', !result.statics.defects.some(d => d.code === 'RANGER_NOT_ARCHER'));
  t('warlock and viking content is present', !result.statics.defects.some(d => d.code === 'WARLOCK_VIKING_OMITTED'));
  t('Unique/WRLD stay out of ordinary loot', !result.statics.defects.some(d => d.code === 'UNIQUE_WRLD_IN_ORDINARY_LOOT'));
  t('WRLD uses the party claim ledger', !result.statics.defects.some(d => d.code === 'WRLD_BYPASSES_CLAIM_LEDGER'));
  t('compendium render is not a discovery trigger', !result.statics.defects.some(d => d.code === 'COMPENDIUM_DISCOVERY_ON_RENDER'));
  t('multiplayer pay/receive is defined', !result.statics.defects.some(d => d.code === 'MP_OWNERSHIP_UNDEFINED'));

  const cat = rawPackCatalogs();
  t('ordinary loot remains a small foundation subset',
    cat.items.filter(inOrdinaryLoot).length > 0 && cat.items.filter(inOrdinaryLoot).length <= 12);

  resetCompendiumSeen();
  const secret = catalogEntries({ packOn: true }).find(e => e.pack && e.id === 'cp_unwritten_achievement');
  const view = presentEntry(secret, {});
  t('undiscovered Unique/WRLD render as ??? without spoiling the name',
    view?.name === '???' && !isDiscovered('cp_unwritten_achievement') && !/Unwritten/.test(view?.desc || ''));

  const downed = partyMissingCount(null, [{ hp: 0, down: true, connected: true }, { hp: 20, connected: true }]);
  const disc = partyMissingCount(null, [{ hp: 20, disconnected: true, connected: false }, { hp: 20, connected: true }]);
  t('disconnect is never ally-fallen', downed === 1 && disc === 0);

  const cursed = packLookup('cp_cowards_first_sword');
  const run = { inventory: [], relics: [], consumables: [], equipment: {}, flags: {}, packState: {} };
  await grantCatalogItem(run, cursed, []);
  t('cursed grant communicates ownership and blocks sale',
    cursedSellBlocked(run, cursed) === true && (run.inventory || []).includes('cp_cowards_first_sword'));

  t('set bonuses dynamically proven',
    result.graph.entries.filter(e => e.category === 'armor_set_bonus').every(e => result.proofs[e.id]?.ok));
  t('curse resolution stages proven or sourced',
    result.graph.entries.filter(e => e.category === 'curse_resolution_stage').every(e => result.proofs[e.id]?.ok || e.sources?.length));
  t('every class technique is dynamically proven',
    result.graph.entries.filter(e => e.category === 'class_technique').every(e => result.proofs[e.id]?.ok));
  t('every bloodline art is dynamically proven',
    result.graph.entries.filter(e => e.category === 'bloodline_art').every(e => result.proofs[e.id]?.ok));
  t('evolution stages persist and isolate instance state',
    result.graph.entries.filter(e => e.category === 'evolution_stage').every(e => result.proofs[e.id]?.ok));
  t('multiplayer 2/3/4-player ownership, claims, and disconnect rules hold',
    (result.mp || []).length === 3
    && result.mp.every(r => r.disconnectIsNotAllyFallen
      && r.uniqueDuplicateBlocked
      && r.wrldPartyConsistent
      && r.cursedOwnershipBound
      && r.evolutionInstanceLocal
      && r.identityQualified));

  setPackEnabled(false);
  t('pack-off still has no cp_ in vanilla equipment', ALL_EQUIPMENT.every(i => !String(i.id).startsWith('cp_')));
  t('pack-off event draw has no cp_ events',
    eventDrawPool({ biomeId: 'forest', floor: 2, flags: {}, seenEvents: [] }).every(x => !String(x.id).startsWith('cp_')));
  t('pack-off vanilla EVENTS module is unpolluted', EVENTS.every(e => !e.contentPack));
}
