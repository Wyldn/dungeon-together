// Extra aggregations for the Gate 7 balance report. Measurement only.

import { CANONICAL_CLASSES, CANONICAL_BLOODLINES, mergeCounts, mean } from './content_pack_balance_lib.js';
import { itemById, CONSUMABLES, RELICS } from '../js/data/items.js';
import { packLookup, rawPackCatalogs } from '../js/content_pack/registry.js';

function bump(map, key, n = 1) {
  if (!map || key == null || key === '') return;
  map[key] = (map[key] || 0) + n;
}

function topEntries(map, n = 20) {
  return Object.entries(map || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
}

function nestBump(root, a, b, n = 1) {
  root[a] = root[a] || {};
  bump(root[a], b, n);
}

function floorBand(floor) {
  const f = Number(floor);
  if (!Number.isFinite(f)) return 'unknown';
  if (f <= 9) return '1-9';
  if (f === 10) return '10';
  if (f <= 19) return '11-19';
  if (f === 20) return '20';
  if (f <= 29) return '21-29';
  if (f === 30) return '30';
  if (f <= 39) return '31-39';
  if (f === 40) return '40';
  if (f <= 50) return '41-50';
  return String(f);
}

const CONSUMABLE_IDS = new Set(CONSUMABLES.map(c => c.id));
const RELIC_IDS = new Set(RELICS.map(c => c.id));

export function grantKind(id) {
  if (!id) return 'unknown';
  if (CONSUMABLE_IDS.has(id)) return 'consumable';
  if (RELIC_IDS.has(id)) return 'relic';
  const cat = rawPackCatalogs();
  const it = itemById(id)
    || packLookup(id)
    || [...(cat.items || []), ...(cat.relics || []), ...(cat.consumables || [])].find(i => i.id === id);
  if (!it) return 'unknown';
  if ((cat.consumables || []).some(c => c.id === id) || it.heal || it.healPct || it.kind === 'consumable') return 'consumable';
  if ((cat.relics || []).some(c => c.id === id) || it.relic || it.kind === 'relic') return 'relic';
  if (it.slot) return 'equipment';
  return 'unknown';
}

function mergeItemActs(rows) {
  const out = {};
  for (const r of rows) {
    for (const [id, a] of Object.entries(r.items || {})) {
      const row = out[id] || (out[id] = {
        n: 0, equip: 0, sell: 0, stash: 0, buy: 0, relic: 0, useful: 0, incompatible: 0,
      });
      for (const k of Object.keys(row)) row[k] += a[k] || 0;
    }
  }
  return out;
}

function itemRates(acts) {
  return Object.entries(acts).map(([id, a]) => {
    const offered = a.n || 0;
    const equipped = (a.equip || 0) + (a.relic || 0);
    return {
      id,
      offered,
      equipped,
      sold: a.sell || 0,
      stashed: a.stash || 0,
      bought: a.buy || 0,
      useful: a.useful || 0,
      incompatible: a.incompatible || 0,
      equipRate: offered ? equipped / offered : null,
    };
  }).sort((a, b) => b.offered - a.offered);
}

function winningBuilds(rows) {
  const wins = rows.filter(r => r.win);
  const conc = {};
  const list = wins.map(r => {
    const skills = [...(r.final?.skills || [])].sort();
    const relics = [...(r.final?.relics || [])].sort();
    const arts = [...(r.final?.arts || [])].sort();
    const weapon = r.final?.equipment?.weapon || null;
    const key = `${r.classId}/${r.raceId}|${weapon || '-'}|${skills.join(',')}|${relics.join(',')}`;
    bump(conc, key);
    return {
      classId: r.classId,
      raceId: r.raceId,
      packOn: r.packOn,
      policy: r.policy,
      seed: r.seed,
      maxFloor: r.maxFloor,
      outcome: r.outcome,
      weapon,
      skills,
      relics,
      arts,
    };
  });
  const total = wins.length || 1;
  const concentration = topEntries(conc, 12).map(([key, n]) => ({ key, n, share: n / total }));
  return { n: wins.length, list, concentration };
}

export function buildExtendedTables(climbs) {
  const baseline = climbs.filter(r => r.policy === 'baseline' && !r.error);
  const off = baseline.filter(r => !r.packOn);
  const on = baseline.filter(r => r.packOn);
  const bossOff = climbs.filter(r => r.policy === 'boss-aware' && !r.error && !r.packOn);
  const bossOn = climbs.filter(r => r.policy === 'boss-aware' && !r.error && r.packOn);

  function packSlice(rows) {
    const rarityByChannel = {};
    const rarityByFloor = {};
    const rarityByBand = {};
    for (const r of rows) {
      for (const [ch, dist] of Object.entries(r.rarityByChannel || {})) {
        rarityByChannel[ch] = rarityByChannel[ch] || {};
        for (const [rar, n] of Object.entries(dist || {})) bump(rarityByChannel[ch], rar, n);
      }
      for (const [fl, dist] of Object.entries(r.rarityByFloor || {})) {
        rarityByFloor[fl] = rarityByFloor[fl] || {};
        const band = floorBand(fl);
        rarityByBand[band] = rarityByBand[band] || {};
        for (const [rar, n] of Object.entries(dist || {})) {
          bump(rarityByFloor[fl], rar, n);
          bump(rarityByBand[band], rar, n);
        }
      }
    }
    const items = itemRates(mergeItemActs(rows));
    const gear = items.filter(x => grantKind(x.id) === 'equipment' || grantKind(x.id) === 'relic');
    const events = mergeCounts(rows.map(r => r.events || {}));
    const repeated = mergeCounts(rows.map(r => r.repeatedEvents || {}));
    const skillUses = mergeCounts(rows.map(r => r.skillUses || {}));
    const skillOffered = mergeCounts(rows.map(r => r.skillOffered || {}));
    const skillPicked = mergeCounts(rows.map(r => r.skillPicked || {}));
    const techOffered = mergeCounts(rows.map(r => r.tech?.offered || {}));
    const techPicked = mergeCounts(rows.map(r => r.tech?.picked || {}));
    const artOffered = mergeCounts(rows.map(r => r.arts?.offered || {}));
    const artPicked = mergeCounts(rows.map(r => r.arts?.picked || {}));
    const consumableUses = mergeCounts(rows.map(r => r.consumableUses || {}));
    const shopBuys = mergeCounts(rows.map(r => r.shopBuys || {}));
    const shopOffers = mergeCounts(rows.map(r => r.shopOffers || {}));
    const effectOps = mergeCounts(rows.map(r => r.effectOps || {}));
    const effectCaps = mergeCounts(rows.map(r => r.effectCaps || {}));
    const n = rows.length || 1;
    return {
      n: rows.length,
      rarityByChannel,
      rarityByFloor,
      rarityByBand,
      items: gear,
      neverEquipped: gear.filter(x => x.offered >= 24 && x.equipped === 0).slice(0, 40),
      alwaysEquipped: gear.filter(x => x.offered >= 16 && x.equipRate >= 0.95).slice(0, 40),
      usefulVsIncompatible: {
        useful: mean(rows.map(r => r.grants?.usefulWeapon || 0)),
        incompatible: mean(rows.map(r => r.grants?.incompatibleWeapon || 0)),
      },
      events: topEntries(events, 30).map(([id, count]) => ({ id, count, perRun: count / n })),
      repeatedEvents: topEntries(repeated, 20).map(([id, count]) => ({ id, count, perRun: count / n })),
      skillUses: topEntries(skillUses, 24).map(([id, count]) => ({ id, count, perRun: count / n })),
      skillOffered: topEntries(skillOffered, 20).map(([id, count]) => ({ id, count, perRun: count / n })),
      skillPicked: topEntries(skillPicked, 20).map(([id, count]) => ({ id, count, perRun: count / n })),
      techOffered: topEntries(techOffered, 20).map(([id, count]) => ({ id, count, perRun: count / n })),
      techPicked: topEntries(techPicked, 20).map(([id, count]) => ({ id, count, perRun: count / n })),
      artOffered: topEntries(artOffered, 20).map(([id, count]) => ({ id, count, perRun: count / n })),
      artPicked: topEntries(artPicked, 20).map(([id, count]) => ({ id, count, perRun: count / n })),
      consumableUses: topEntries(consumableUses, 20).map(([id, count]) => ({ id, count, perRun: count / n })),
      shopBuys: topEntries(shopBuys, 20).map(([id, count]) => ({ id, count, perRun: count / n })),
      shopOffers: topEntries(shopOffers, 20).map(([id, count]) => ({ id, count, perRun: count / n })),
      effectOps: topEntries(effectOps, 24).map(([id, count]) => ({ id, count, perRun: count / n })),
      effectCaps: topEntries(effectCaps, 16).map(([id, count]) => ({ id, count, perRun: count / n })),
      winning: winningBuilds(rows),
    };
  }

  const comboRows = [];
  for (const classId of CANONICAL_CLASSES) {
    for (const raceId of CANONICAL_BLOODLINES) {
      comboRows.push({ classId, raceId, key: `${classId}/${raceId}` });
    }
  }

  return {
    packOff: packSlice(off),
    packOn: packSlice(on),
    bossAwareOff: packSlice(bossOff),
    bossAwareOn: packSlice(bossOn),
    comboKeys: comboRows.map(c => c.key),
    itemMapsPresent: baseline.some(r => r.items && Object.keys(r.items).length),
  };
}

export { topEntries, mergeItemActs, itemRates, winningBuilds, floorBand };
void nestBump;
void bump;
