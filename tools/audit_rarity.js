// Gate 7 rarity / power-budget / acquisition audit.
// node tools/audit_rarity.js
import { writeFileSync, readFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import '../js/content_pack/bootstrap.js';
import { rawPackCatalogs } from '../js/content_pack/registry.js';
import { ALL_EQUIPMENT, RELICS, CONSUMABLES, uniqueCatalog, wrldCatalog } from '../js/data/items.js';
import { setPackEnabled, resetPackFlags } from '../js/content_pack/flags.js';
import {
  VALID_RARITIES, itemCategory, equipmentSlot, fitsPowerBand,
  facetValues, duplicatePolicy, affixEligible, ordinaryLootEligible,
  floorRangeFor, distributionReport, authoredRarityMap, helperFallbackNote,
} from '../js/content_pack/rarity.js';
import { isCursedItem, isEvolvingItem } from '../js/content_pack/curse.js';
import { catalogEntries } from '../js/compendium.js';
import { inOrdinaryLoot } from '../js/content_pack/acquisition.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const CATALOG_FILES = [
  'js/content_pack/catalogs/weapons.js',
  'js/content_pack/catalogs/weapons_more.js',
  'js/content_pack/catalogs/armor.js',
  'js/content_pack/catalogs/relics.js',
  'js/content_pack/catalogs/consumables.js',
];

/** Authored-before rarities that this pass changed (not helper fallbacks). */
const AUTHORED_RARITY_FROM = {
  cp_many_banner_longsword: 'rare',
  cp_witness_spear: 'rare',
  cp_memory_branch_bow: 'rare',
  cp_tollbreaker_cleaver: 'rare',
  cp_clan_weight_maul: 'rare',
  cp_gate_mason_hammer: 'rare',
  cp_ledger_pick: 'rare',
  cp_pocket_gate_knife: 'rare',
  cp_second_breakfast_sling: 'rare',
  cp_toll_skipping_cane: 'rare',
  cp_appeal_denied_trident: 'rare',
  cp_ember_ink_dagger: 'rare',
  cp_scent_of_tomorrow_claws: 'rare',
  cp_moon_fang_shortbow: 'rare',
  cp_hoardscale_hammer: 'rare',
  cp_drowned_brides_rapier: 'rare',
  cp_seventh_owner_sword: 'legendary',
  cp_blade_lists_you: 'legendary',
  cp_the_empty_seat: 'epic',
};

const NUMERICAL_CHANGES = [
  { id: 'cp_world_shutting_door', field: 'atk', from: 10, to: 12, why: 'Legendary intercept identity was under the class-capstone floor.' },
  { id: 'cp_world_shutting_door', field: 'interceptAoe.pct', from: 0.55, to: 0.70, why: 'Defining mechanic; engine clamp is 0.7.' },
  { id: 'cp_administrator_error_scepter', field: 'atk', from: 8, to: 10, why: 'Legendary floor after keeping Unique rarity off the class pile.' },
  { id: 'cp_administrator_error_scepter', field: 'weakenIntent', from: null, to: 0.85, why: 'Once-per-combat intent weaken is the signature, not extra INT.' },
  { id: 'cp_world_scent_javelin', field: 'atk', from: 9, to: 11, why: 'Legendary mark-hunter floor.' },
  { id: 'cp_world_scent_javelin', field: 'vsMarked', from: null, to: 1.18, why: 'Defining mark rider.' },
  { id: 'cp_black_ledger_stiletto', field: 'crit', from: 10, to: 14, why: 'Legendary crit identity.' },
  { id: 'cp_black_ledger_stiletto', field: 'modDamage.add', from: 2, to: 4, why: 'Ledger fee on hit.' },
  { id: 'cp_staff_seven_forgotten_names', field: 'atk', from: 7, to: 9, why: 'Legendary floor.' },
  { id: 'cp_staff_seven_forgotten_names', field: 'biomeAdd', from: 1, to: 2, why: 'Biome-name rider, not generic ATK.' },
  { id: 'cp_staff_no_possession', field: 'atk', from: 8, to: 10, why: 'Legendary floor.' },
  { id: 'cp_staff_no_possession', field: 'dmgMult', from: 1.15, to: 1.22, why: 'Empty-handed signature.' },
  { id: 'cp_bell_final_chorus', field: 'atk', from: 7, to: 9, why: 'Legendary floor.' },
  { id: 'cp_bell_final_chorus', field: 'crescendo', from: 1.2, to: 1.3, why: 'Chorus rider.' },
  { id: 'cp_corpse_flower_sickle', field: 'heal', from: 0.05, to: 0.08, why: 'Kill-bloom identity.' },
  { id: 'cp_corpse_flower_sickle', field: 'grantResource', from: 6, to: 10, why: 'Necromancer resource signature.' },
  { id: 'cp_seventh_signature_contract', field: 'atk', from: 8, to: 10, why: 'Legendary floor.' },
  { id: 'cp_valhalla_boarding_axe', field: 'heal', from: 0.08, to: 0.12, why: 'Boarding lifesteal identity.' },
  { id: 'cp_valhalla_boarding_axe', field: 'grantResource', from: 8, to: 12, why: 'Fury window.' },
  { id: 'cp_seventh_owner_sword', field: 'atk', from: 10, to: 14, why: 'Unique rarity promotion; still below vanilla Unique ATK on purpose.' },
  { id: 'cp_seventh_owner_sword', field: 'dmgMult', from: 1.1, to: 1.15, why: 'Owner-chain rider.' },
  { id: 'cp_blade_lists_you', field: 'atk', from: 9, to: 12, why: 'Unique cursed listing.' },
  { id: 'cp_blade_lists_you', field: 'contestLethal', from: 10, to: 14, why: 'Unequip-person is a lethal contest, not deletion.' },
  { id: 'cp_unwritten_achievement', field: 'allStats', from: 0, to: 2, why: 'WRLD identity; below World Seed (+5).' },
  { id: 'cp_unwritten_achievement', field: 'xpMult', from: 1, to: 1.2, why: 'WRLD ledger, not ordinary XP stick.' },
  { id: 'cp_unwritten_achievement', field: 'fameGainMult', from: 1, to: 1.25, why: 'Unusual-deed fame rider.' },
  { id: 'cp_last_companions_dose', field: 'rarity', from: 'uncommon', to: 'epic', why: 'Party-triage heal is run-shaping, not a bulk uncommon potion.' },
  { id: 'cp_crimson_continuance', field: 'rarity', from: 'uncommon', to: 'epic', why: '1-HP continuance is an epic consumable, not a shop uncommon.' },
  { id: 'cp_echo_chalk', field: 'echoMult', from: 0.4, to: 0.55, why: 'Epic echo consumable.' },
  { id: 'cp_false_resurrection_draught', field: 'echoMult', from: 0.45, to: 0.6, why: 'Epic false-revive echo.' },
  { id: 'cp_potion_too_much_healing', field: 'healPct', from: 0.55, to: 1, why: 'Legendary full heal with a max-HP wound.' },
  { id: 'cp_heroic_overdose', field: 'grantCharge', from: 1, to: 3, why: 'Legendary charge spike, not a second startCharge relic.' },
  { id: 'cp_crimson_save_ink', field: 'healPct', from: 0, to: 0.2, why: 'Legendary HP snapshot plus a heal rider; still not a save-file restore.' },
];

function grantIndex(events) {
  const map = new Map();
  const note = (id, ev) => {
    if (!id) return;
    if (!map.has(id)) map.set(id, { events: [], biomes: new Set() });
    const row = map.get(id);
    row.events.push(ev.id);
    if (ev.biome && ev.biome !== 'any') row.biomes.add(ev.biome);
  };
  for (const ev of events || []) {
    for (const c of ev.choices || []) {
      const o = c.outcome || {};
      note(o.item, ev);
      note(o.consumable, ev);
      note(o.consumable2, ev);
    }
  }
  for (const [id, row] of map) {
    map.set(id, { events: row.events, biomes: [...row.biomes] });
  }
  return map;
}

function behavioralEffects(item) {
  const fx = [...(item.effects || [])];
  if (item.setBonus) {
    for (const [n, list] of Object.entries(item.setBonus)) {
      for (const ef of list || []) fx.push({ ...ef, setPieces: Number(n) });
    }
  }
  return fx.map(ef => ({
    hook: ef.hook, op: ef.op, once: ef.once || null,
    mult: ef.mult, add: ef.add, pct: ef.pct, chance: ef.chance,
    status: ef.status, mutex: ef.mutex, setPieces: ef.setPieces || null,
  }));
}

function baseStats(item) {
  const keys = [
    'atk', 'def', 'hp', 'mp', 'str', 'dex', 'int', 'wis', 'lk', 'crit', 'dodge',
    'initiative', 'burn', 'freeze', 'poison', 'weaken', 'frail', 'stun', 'lifesteal',
    'dmgMult', 'heal', 'healPct', 'bombDmg', 'allStats', 'xpMult', 'fameGainMult',
  ];
  const out = {};
  for (const k of keys) if (item[k] != null) out[k] = item[k];
  return out;
}

function curseDrawbackValue(item) {
  if (!isCursedItem(item)) return 0;
  let d = 8;
  const curse = String(item.curse || '');
  if (/eats_|self_|unequip|corrupt|gold_for|fame_/.test(curse)) d += 4;
  if (/lethal|maxhp|parasite|echo/.test(curse)) d += 3;
  return d;
}

function historicalRarity(item) {
  if (AUTHORED_RARITY_FROM[item.id]) return AUTHORED_RARITY_FROM[item.id];
  const cat = itemCategory(item);
  if (cat === 'relic') return 'rare';
  if (cat === 'consumable') return 'uncommon';
  if (item.setId) return 'rare';
  return item.rarity || null;
}

function historicalWhy(item, from, to) {
  if (from === to) return 'No rarity change; this pass only required an explicit catalog key.';
  if (item.setId && from === 'rare' && to === 'uncommon') {
    return 'Set helm/greaves were a group Rare default; 3pc bonus is the identity, so off-chest pieces drop to Uncommon.';
  }
  if (item.setId && from === 'rare' && to === 'rare') {
    return 'Chest remains Rare as the set anchor.';
  }
  if (itemCategory(item) === 'relic' && from === 'rare') {
    return `Relic helper defaulted every missing rarity to Rare. Reclassified to ${to} from actual power, exclusivity, and identity.`;
  }
  if (itemCategory(item) === 'consumable' && from === 'uncommon') {
    return `Consumable helper defaulted every missing rarity to Uncommon. Reclassified to ${to} from heal/combat significance.`;
  }
  if (to === 'unique') {
    return 'Named identity, exclusive grant, non-duplicable, non-affixable, and excluded from ordinary loot/shop.';
  }
  if (to === 'wrld') {
    return 'WRLD claim-ledger item. Event-granted, never ordinary drops or shop rotation.';
  }
  if (to === 'uncommon' && from === 'rare' && item.resonance) {
    return 'Bloodline tier-2 weapon was authored Rare in bulk. Identity kept; numbers were already Uncommon-band.';
  }
  if (to === 'epic' && from === 'rare') {
    return 'Defining cursed/class mechanic already sat in the Epic band.';
  }
  return `Reclassified ${from} → ${to} from power, acquisition, and identity.`;
}

function auditEntry(item, { origin, authored, grants }) {
  const cat = itemCategory(item);
  const slot = equipmentSlot(item);
  const facets = facetValues(item);
  const fit = fitsPowerBand(item);
  const floors = floorRangeFor(item, grants);
  const grant = grants.get(item.id);
  const previous = origin === 'pack' ? historicalRarity(item) : item.rarity;
  const nums = NUMERICAL_CHANGES.filter(n => n.id === item.id);
  return {
    id: item.id,
    name: item.name,
    origin,
    category: cat,
    slot,
    wtype: item.wtype || null,
    currentRarity: item.rarity || null,
    previousRarity: previous,
    sourceRarityAuthored: authored.get(item.id) != null || !!item.setId,
    sourceRarityLiteral: authored.get(item.id) || null,
    acquisition: item.acquisition || null,
    packOrdinary: !!item.packOrdinary,
    ordinaryLoot: ordinaryLootEligible(item),
    shopEligible: ordinaryLootEligible(item) && (item.shopMaxTier == null || item.shopMaxTier > 0),
    floorRange: floors,
    biomes: item.biomes || grant?.biomes || [],
    grantEvents: grant?.events || [],
    classBound: item.classBound || null,
    bloodline: item.resonance || item.bloodline || null,
    cursed: isCursedItem(item),
    curse: item.curse || null,
    evolving: isEvolvingItem(item),
    setId: item.setId || null,
    eventLinked: item.acquisition === 'event' || !!item.quest,
    unique: !!(item.unique || item.rarity === 'unique'),
    wrld: !!(item.wrld || item.rarity === 'wrld'),
    noAffix: !!item.noAffix || !affixEligible(item),
    affixEligible: affixEligible(item),
    mutex: item.mutex || null,
    stackFamily: item.mutex || item.setId || null,
    duplicatePolicy: duplicatePolicy(item),
    exclusive: !!item.exclusive,
    quest: !!item.quest,
    price: item.price ?? null,
    lootWeight: item.lootWeight ?? null,
    shopMaxTier: item.shopMaxTier ?? null,
    baseStats: baseStats(item),
    behavioralEffects: behavioralEffects(item),
    expectedValue: facets,
    drawbackValue: curseDrawbackValue(item),
    powerScore: fit.score,
    powerBand: fit.band,
    powerFit: fit.ok,
    proposedRarity: item.rarity,
    proposedNumericalChanges: nums,
    explanation: origin === 'pack'
      ? historicalWhy(item, previous, item.rarity)
      : 'Vanilla catalog; unchanged by the pack audit.',
  };
}

function groupBy(list, keyFn) {
  const out = {};
  for (const it of list) {
    const k = keyFn(it) || 'none';
    if (!out[k]) out[k] = [];
    out[k].push(it);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, distributionReport(v)]));
}

function slotOpportunities(entries) {
  const slots = ['weapon', 'helmet', 'chest', 'legs', 'boots', 'accessory', 'relic', 'consumable'];
  return Object.fromEntries(slots.map(slot => {
    const list = entries.filter(e => e.slot === slot || (slot === 'accessory' && String(e.slot).startsWith('accessory')));
    return [slot, {
      total: list.length,
      unique: list.filter(e => e.currentRarity === 'unique').length,
      wrld: list.filter(e => e.currentRarity === 'wrld').length,
      legendary: list.filter(e => e.currentRarity === 'legendary').length,
      uniqueFlagNotRarity: list.filter(e => e.unique && e.currentRarity !== 'unique' && e.currentRarity !== 'wrld').length,
    }];
  }));
}

function floorBandKey(range) {
  const min = range?.minFloor ?? 1;
  if (min <= 10) return '1-10 forest';
  if (min <= 20) return '11-20 ruins';
  if (min <= 30) return '21-30 frost';
  if (min <= 40) return '31-40 swamp';
  if (min <= 50) return '41-50 hell';
  return '51 throne';
}

export function buildRarityAudit() {
  resetPackFlags();
  setPackEnabled(true);
  const authored = new Map();
  for (const rel of CATALOG_FILES) {
    const text = readFileSync(join(ROOT, rel), 'utf8');
    for (const [id, r] of authoredRarityMap(text)) authored.set(id, r);
  }
  const cat = rawPackCatalogs();
  const grants = grantIndex(cat.events);
  const packItems = [...cat.items, ...cat.relics, ...cat.consumables];
  const vanillaItems = [...ALL_EQUIPMENT, ...RELICS, ...CONSUMABLES];
  const packEntries = packItems.map(it => auditEntry(it, { origin: 'pack', authored, grants }));
  const vanillaEntries = vanillaItems.map(it => auditEntry(it, { origin: 'vanilla', authored: new Map(), grants: new Map() }));

  const packEquip = cat.items.filter(i => i.slot);
  const packOrdinary = packEquip.filter(inOrdinaryLoot);
  const packRelics = cat.relics;
  const packCons = cat.consumables;

  const rarityChanges = packEntries
    .filter(e => e.previousRarity && e.currentRarity && e.previousRarity !== e.currentRarity)
    .map(e => ({
      id: e.id,
      name: e.name,
      from: e.previousRarity,
      to: e.currentRarity,
      category: e.category,
      slot: e.slot,
      explanation: e.explanation,
    }));

  const powerMiss = packEntries.filter(e => !e.powerFit);
  const missingRarity = packEntries.filter(e => !e.currentRarity || !VALID_RARITIES.includes(e.currentRarity));
  const liveComp = catalogEntries({ packOn: true });
  const compMismatch = packEntries.filter(e => {
    const row = liveComp.find(c => c.id === e.id);
    return !row || row.rarity !== e.currentRarity;
  }).map(e => e.id);

  const uniqueRarity = packEntries.filter(e => e.currentRarity === 'unique');
  const wrldRarity = packEntries.filter(e => e.currentRarity === 'wrld');
  const uniqueRules = uniqueRarity.map(e => ({
    id: e.id,
    rarity: e.currentRarity,
    ordinaryLoot: e.ordinaryLoot,
    shopEligible: e.shopEligible,
    affixEligible: e.affixEligible,
    duplicatePolicy: e.duplicatePolicy,
    named: !!e.name && e.name !== '???',
    specialAcquisition: ['unique', 'event', 'cursed', 'class', 'wrld'].includes(e.acquisition),
    grantEvents: e.grantEvents,
  }));
  const wrldRules = wrldRarity.map(e => ({
    id: e.id,
    rarity: e.currentRarity,
    ordinaryLoot: e.ordinaryLoot,
    shopEligible: e.shopEligible,
    affixEligible: e.affixEligible,
    duplicatePolicy: e.duplicatePolicy,
    grantEvents: e.grantEvents,
  }));

  return {
    generatedAt: new Date().toISOString(),
    packId: 'design_council_2026',
    gate: 7,
    deployed: false,
    fallbackAnalysis: {
      ...helperFallbackNote(),
      currentSource: {
        packEntries: packEntries.length,
        authoredExplicit: packEntries.filter(e => e.sourceRarityAuthored).length,
        missingLiteral: packEntries.filter(e => !e.sourceRarityAuthored).map(e => e.id),
      },
      priorCompendium: {
        note: 'Before this pass, helper defaults assigned Rare to every relic without a rarity key and Uncommon to every consumable without a rarity key. Class setPieces defaulted to Rare. Those helpers no longer assign rarity.',
        relicsWereAllRare: 37,
        consumablesWereAllUncommon: 64,
        setPiecesWereRare: 57,
      },
    },
    vanilla: {
      equipment: distributionReport(ALL_EQUIPMENT, 'ordinaryEquipment'),
      relics: distributionReport(RELICS, 'relics'),
      consumables: distributionReport(CONSUMABLES, 'consumables'),
      ordinaryLoot: distributionReport(
        ALL_EQUIPMENT.filter(i => !i.exclusive && !i.starter && i.rarity !== 'unique' && i.rarity !== 'wrld'),
        'ordinaryEquipment',
      ),
    },
    pack: {
      equipment: distributionReport(packEquip, 'ordinaryEquipment'),
      ordinaryEquipment: distributionReport(packOrdinary, 'ordinaryEquipment'),
      relics: distributionReport(packRelics, 'relics'),
      consumables: distributionReport(packCons, 'consumables'),
      bySlot: groupBy(packEquip, i => i.slot),
      byAcquisition: groupBy(packItems, i => i.acquisition || 'event'),
      byClass: groupBy(packEquip.filter(i => i.classBound), i => i.classBound),
      byBloodline: groupBy(packEquip.filter(i => i.resonance), i => i.resonance),
      byFloorBand: groupBy(packEntries, e => floorBandKey(e.floorRange)),
      byBiome: groupBy(packEntries.filter(e => (e.biomes || []).length), e => (e.biomes || [])[0]),
      slotOpportunities: slotOpportunities(packEntries),
    },
    combinedOrdinaryLoot: distributionReport(
      ALL_EQUIPMENT.filter(i => !i.exclusive && !i.starter && i.rarity !== 'unique' && i.rarity !== 'wrld')
        .concat(packOrdinary),
      'ordinaryEquipment',
    ),
    uniqueCatalogSize: uniqueCatalog().length,
    wrldCatalogSize: wrldCatalog().length,
    rarityChanges,
    numericalChanges: NUMERICAL_CHANGES,
    uniqueRules,
    wrldRules,
    uniqueRuleFailures: uniqueRules.filter(u => u.ordinaryLoot || u.shopEligible || u.affixEligible || !u.specialAcquisition || !u.named),
    wrldRuleFailures: wrldRules.filter(w => w.ordinaryLoot || w.shopEligible || w.affixEligible || w.duplicatePolicy !== 'party_claim'),
    missingRarity: missingRarity.map(e => e.id),
    powerMisses: powerMiss.map(e => ({
      id: e.id, score: e.powerScore, band: e.powerBand, rarity: e.currentRarity, category: e.category,
    })),
    compendiumMismatch: compMismatch,
    cursedAsRarity: packEntries.filter(e => e.currentRarity === 'cursed').map(e => e.id),
    entries: [...vanillaEntries, ...packEntries],
    remainingConcerns: [
      'Do not deploy. Kill switch remains ?pack=0 / DT_CONTENT_PACK=0.',
      'No Unique/WRLD consumables: single-use claim semantics were judged too easy to hoard or duplicate across reconnect/checkpoint.',
      'Helmet, legs, boots, and accessory still have no pack Unique or WRLD pieces — class set greaves stay Uncommon on purpose.',
      'Pack Unique items are exclusive event grants and do not enter rollUnique; vanilla Unique chase tables are unchanged.',
      'Pack WRLD relic (The Unwritten Achievement) is event-granted and claim-ledgered; it is excluded from shops, ordinary relic rolls, and the 1% duel WRLD table.',
      'Class signature weapons remain Legendary with unique:true rather than Unique rarity so Unique stays scarce.',
      'Healing pack consumables stay shopMaxTier 0 so vanilla potion_s is not diluted.',
      'Pack relics remain event-exclusive; rarity now drives price and identity, not random relic-table flooding.',
      'Consumable outcome grants (o.consumable) still push IDs directly; Unique/WRLD consumables were not added.',
    ],
  };
}

export function writeRarityAudit(path = join(ROOT, 'reports', 'content_pack_rarity_audit_20260825.json')) {
  const audit = buildRarityAudit();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(audit, null, 2));
  const summaryPath = join(ROOT, 'reports', 'content_pack_rarity_summary_20260825.json');
  const { entries, ...summary } = audit;
  writeFileSync(summaryPath, JSON.stringify({
    ...summary,
    entryCount: entries.length,
    packEntryCount: entries.filter(e => e.origin === 'pack').length,
    vanillaEntryCount: entries.filter(e => e.origin === 'vanilla').length,
  }, null, 2));
  return { path, summaryPath, audit };
}

if (process.argv[1] && String(process.argv[1]).replace(/\\/g, '/').includes('audit_rarity')) {
  const { path, summaryPath, audit } = writeRarityAudit();
  console.log('wrote', path);
  console.log('wrote', summaryPath);
  console.log('pack equipment', audit.pack.equipment.counts);
  console.log('pack ordinary', audit.pack.ordinaryEquipment.counts);
  console.log('pack relics', audit.pack.relics.counts);
  console.log('pack consumables', audit.pack.consumables.counts);
  console.log('rarity changes', audit.rarityChanges.length);
  console.log('missing rarity', audit.missingRarity.length);
  console.log('power misses', audit.powerMisses.length);
  console.log('unique failures', audit.uniqueRuleFailures.length);
  console.log('wrld failures', audit.wrldRuleFailures.length);
  console.log('compendium mismatch', audit.compendiumMismatch.length);
  if (audit.powerMisses.length) {
    console.log('power miss sample', audit.powerMisses.slice(0, 20));
  }
}
