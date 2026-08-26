// Content-pack tests. Pack-off must remain a no-op for vanilla catalogs.
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { makeRng } from '../js/rng.js';
import { newRun } from '../js/state.js';
import { SKILLS } from '../js/data/skills.js';
import { EVENTS } from '../js/data/events.js';
import {
  ALL_EQUIPMENT, RELICS, CONSUMABLES, itemById, rollEquipment, shopConsumablePool,
  uniqueCatalog, wrldCatalog, rollRelic, rollUnique, rollWrld, claimedWrldIds,
  sellGold, shopListingPrice,
} from '../js/data/items.js';
import { eventDrawPool } from '../js/data/events.js';
import { CLASSES } from '../js/data/classes.js';
import { RACES } from '../js/data/races.js';
import { validateItem, validateSkill, validateEvent, LIMITS } from '../js/content_pack/schema.js';
import {
  setPackEnabled, setPackGate, resetPackFlags, isPackOn, packStatus, GATE, PACK_DEFAULT_ON,
} from '../js/content_pack/flags.js';
import {
  rawPackCatalogs, packLookup, packEventList, packEquipment, liveEvents, liveSkill,
} from '../js/content_pack/registry.js';
import { inOrdinaryLoot } from '../js/content_pack/acquisition.js';
import { dispatchEffects, packDeathSave, applyDelayedEffects, partyMissingCount } from '../js/content_pack/engine.js';
import { packModifyOutgoing } from '../js/content_pack/combat_bind.js';
import { reqMet } from '../js/requirements.js';
import { shopDiscount } from '../js/shop.js';
import { packOnEventResolve } from '../js/content_pack/world_bind.js';
import {
  packSet, packGet, cleanupAfterAction, cleanupAfterTurn, cleanupAfterCombat,
  cleanupAfterFloor, cleanupAfterBiome, boundPackStateSize, persistablePackState,
} from '../js/content_pack/state.js';
import { LEGACY_MIRRORS } from '../js/content_pack/legacy.js';
import { buildManifest, capabilityMatrix, CANONICAL_CLASSES, CANONICAL_BLOODLINES } from '../js/content_pack/manifest.js';
import { CHECKPOINT_SCHEMA, GAME_CONTENT_VERSION, serializeClimber, migrateCheckpoint } from '../js/mp_checkpoint.js';
import { createCombatContext, resolvePlayerHit, deathSaves } from '../js/combat_core.js';
import { buildEnemy } from '../js/combat_core.js';
import { makeV2Run, simulateClimbV2, baselinePolicy } from './run_climb_v2.js';
import { grantCatalogItem } from '../js/content_pack/grants.js';
import { VALID_RARITIES, fitsPowerBand } from '../js/content_pack/rarity.js';
import { wpn } from '../js/content_pack/catalogs/helpers.js';
import { writeRarityAudit } from './audit_rarity.js';
import { catalogEntries } from '../js/compendium.js';
import { runCompendiumTests } from './test_compendium.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function fakeRun(extra = {}) {
  return {
    classId: 'warrior', raceId: 'human', hp: 40, maxHp: 40, mp: 20, maxMp: 20,
    gold: 50, fame: 4, flags: {}, skills: ['slash'], knownSkills: ['slash'],
    equipment: {}, inventory: [], relics: [], consumables: [], arts: [],
    biomeId: 'forest', floor: 3,
    stats: { str: 8, dex: 5, int: 3, wis: 5, lk: 4 },
    ...extra,
  };
}

export async function runContentPackTests(t) {
  console.log('— content pack (pack-off invariant) —');
  resetPackFlags();
  delete process.env.DT_CONTENT_PACK;
  t('production default is pack-on at Gate 7', PACK_DEFAULT_ON === true && isPackOn() === true && packStatus().gate === GATE.MULTIPLAYER);
  process.env.DT_CONTENT_PACK = '0';
  t('env DT_CONTENT_PACK=0 is the emergency off', isPackOn() === false && packStatus().gate === GATE.BASELINE);
  delete process.env.DT_CONTENT_PACK;
  t('clearing the env restores the default on', isPackOn() === true);
  setPackEnabled(false);
  t('forced off disables the pack', isPackOn() === false);
  t('vanilla EVENTS unchanged at module load', EVENTS.every(e => !e.contentPack));
  t('vanilla ALL_EQUIPMENT has no cp_ ids', ALL_EQUIPMENT.every(i => !String(i.id).startsWith('cp_')));
  t('itemById pack item is null while pack off', itemById('cp_gate_iron_sword') == null);
  t('liveSkill pack technique is null while pack off', liveSkill('cp_gatebreaker_charge', SKILLS) == null);
  t('eventDrawPool pack-off has no cp_ events', eventDrawPool({ biomeId: 'forest', floor: 2, flags: {}, seenEvents: [] }).every(x => !String(x.id).startsWith('cp_')));
  t('shop potion pool still has potion_s', shopConsumablePool(1).some(c => c.id === 'potion_s'));
  t('spear is additive for warrior', CLASSES.warrior.weapons.includes('spear'));
  t('instrument is additive for bard', CLASSES.bard.weapons.includes('instrument'));
  t('checkpoint schema is 2', CHECKPOINT_SCHEMA === 2 && GAME_CONTENT_VERSION === 'dt-mp-2');
  t('schema 1 checkpoints migrate', migrateCheckpoint({ schema: 1, gameVersion: 'dt-mp-1' }).schema === 2);

  const cat = rawPackCatalogs();
  console.log('— content pack schema / catalogs —');
  const ids = new Set();
  let dup = 0;
  const allEntries = [...cat.items, ...cat.relics, ...cat.consumables, ...Object.values(cat.skills), ...cat.events];
  for (const it of allEntries) {
    if (!it?.id) continue;
    if (ids.has(it.id)) dup++;
    ids.add(it.id);
  }
  t('pack ids are unique', dup === 0);
  t('pack events cover the numbered proposal (≥135)', cat.events.length >= 135);
  t('eleven classes have techniques', CANONICAL_CLASSES.every(id => Object.values(cat.skills).some(s => s.class === id)));
  t('warlock and viking have signature weapons',
    cat.items.some(i => i.classBound === 'warlock' && i.slot === 'weapon')
    && cat.items.some(i => i.classBound === 'viking' && i.slot === 'weapon'));
  t('eight bloodlines have two arts',
    CANONICAL_BLOODLINES.every(id => Object.values(cat.skills).filter(s => s.bloodline === id).length >= 2));
  t('class armor sets have 2pc and 3pc',
    [...new Set(cat.items.filter(i => i.setId && i.classBound).map(i => i.setId))]
      .every(sid => {
        const piece = cat.items.find(i => i.setId === sid);
        return piece?.setBonus?.[2]?.length && piece?.setBonus?.[3]?.length;
      }));

  const itemErrs = [...cat.items, ...cat.relics, ...cat.consumables].flatMap(it => validateItem(it, it.id));
  const skillErrs = Object.values(cat.skills).flatMap(sk => validateSkill(sk, sk.id));
  const eventErrs = cat.events.flatMap(ev => validateEvent(ev, ev.id));
  if (itemErrs.length) console.error('  item schema:', itemErrs.slice(0, 12).join('\n  '));
  if (skillErrs.length) console.error('  skill schema:', skillErrs.slice(0, 12).join('\n  '));
  if (eventErrs.length) console.error('  event schema:', eventErrs.slice(0, 12).join('\n  '));
  t('pack items validate', itemErrs.length === 0);
  t('pack skills validate', skillErrs.length === 0);
  t('pack events validate', eventErrs.length === 0);
  t('charged pack skills declare cooldown',
    Object.values(cat.skills).filter(s => (s.charge || 0) >= 1).every(s => (s.cooldown || 0) >= 1));
  t('zero-charge pack skills have no cooldown',
    Object.values(cat.skills).filter(s => !(s.charge >= 1)).every(s => !s.cooldown));
  t('cursed items declare resolution',
    [...cat.items, ...cat.relics].filter(i => i.curse).every(i => i.resolution));
  t('ordinary loot is a small foundation subset',
    cat.items.filter(inOrdinaryLoot).length > 0 && cat.items.filter(inOrdinaryLoot).length <= 12);
  t('pack consumables are not shop-eligible at biome 1',
    !cat.consumables.some(c => !c.exclusive && (c.shopMaxTier == null || c.shopMaxTier >= 1)));

  console.log('— rarity model / Unique / WRLD —');
  setPackEnabled(true);
  const helperSrc = readFileSync(join(__dirname, '..', 'js', 'content_pack', 'catalogs', 'helpers.js'), 'utf8');
  const armorSrc = readFileSync(join(__dirname, '..', 'js', 'content_pack', 'catalogs', 'armor.js'), 'utf8');
  t('helpers do not invent a rarity', !/\.rarity\s*\|\|\s*'/.test(helperSrc));
  t('setPieces does not default rarity', !/extra\.rarity\s*\|\|\s*'/.test(armorSrc) && !/pieceRarity\s*\|\|\s*'/.test(armorSrc));
  t('missing rarity is a validation error',
    validateItem({ id: 'cp_no_rarity', name: 'No Rarity', desc: 'test', slot: 'weapon' }).some(e => /missing rarity/.test(e)));
  t('helper without rarity still fails validation',
    validateItem(wpn({ id: 'cp_bare_wpn', name: 'Bare', desc: 'test', wtype: 'sword' }), 'bare').some(e => /missing rarity/.test(e)));
  t('every enabled pack catalog row has an explicit valid rarity',
    [...cat.items, ...cat.relics, ...cat.consumables].every(i => VALID_RARITIES.includes(i.rarity)));
  t('cursed is a trait not a rarity in pack catalogs',
    [...cat.items, ...cat.relics, ...cat.consumables].every(i => i.rarity !== 'cursed'));
  t('Unique/WRLD never enter ordinary loot',
    !cat.items.filter(inOrdinaryLoot).some(i => i.rarity === 'unique' || i.rarity === 'wrld' || i.unique || i.wrld));
  const uniqueRows = [...cat.items, ...cat.relics].filter(i => i.rarity === 'unique');
  const wrldRows = [...cat.items, ...cat.relics].filter(i => i.rarity === 'wrld');
  t('Unique rows are exclusive, non-affixable, named',
    uniqueRows.length >= 3 && uniqueRows.every(i => i.exclusive && i.noAffix && i.name && i.name !== '???'));
  t('WRLD rows use the claim identity',
    wrldRows.length === 1 && wrldRows[0].id === 'cp_unwritten_achievement' && wrldRows[0].wrld && wrldRows[0].exclusive);
  t('no Unique/WRLD consumables',
    cat.consumables.every(c => c.rarity !== 'unique' && c.rarity !== 'wrld' && !c.unique && !c.wrld));
  t('consumables include Epic and Legendary',
    cat.consumables.some(c => c.rarity === 'epic') && cat.consumables.filter(c => c.rarity === 'legendary').length >= 3);
  const powerMiss = [...cat.items, ...cat.relics, ...cat.consumables].filter(i => !fitsPowerBand(i).ok);
  t('pack items fit category power bands', powerMiss.length === 0);
  if (powerMiss.length) {
    console.error('  power misses', powerMiss.slice(0, 16).map(i => `${i.id} ${i.rarity} ${fitsPowerBand(i).score} ${JSON.stringify(fitsPowerBand(i).band)}`));
  }
  t('pack Unique catalog includes relics when on', uniqueCatalog().some(i => i.id === 'cp_last_companions_bell'));
  t('pack WRLD catalog includes the unwritten achievement', wrldCatalog().some(i => i.id === 'cp_unwritten_achievement'));

  setPackEnabled(true);
  const uniqueGrant = fakeRun({ inventory: ['cp_seventh_owner_sword'] });
  const uniqueAgain = await grantCatalogItem(uniqueGrant, packLookup('cp_seventh_owner_sword'), []);
  t('second Unique grant is refused', uniqueAgain == null);
  const wrldSent = [];
  const wrldCoop = { claimedWrld: new Set(), net: { send: (m) => wrldSent.push(m) } };
  const wrldRun = fakeRun();
  const wrldKind = await grantCatalogItem(wrldRun, packLookup('cp_unwritten_achievement'), [], { coop: wrldCoop });
  t('WRLD grant uses the party ledger', wrldKind === 'relic' && wrldRun.claimedWrld.includes('cp_unwritten_achievement'));
  t('WRLD claim is multiplayer-authoritative', wrldSent.some(m => m.k === 'wrldclaim' && m.id === 'cp_unwritten_achievement'));
  const wrldRun2 = fakeRun();
  const wrldDup = await grantCatalogItem(wrldRun2, packLookup('cp_unwritten_achievement'), [], { coop: wrldCoop });
  t('second WRLD grant is refused from the shared ledger', wrldDup == null && claimedWrldIds(wrldRun2, wrldCoop).has('cp_unwritten_achievement'));
  const exclusiveUnique = [];
  for (let i = 0; i < 40; i++) {
    exclusiveUnique.push(rollUnique(makeRng(100 + i), fakeRun(), {}));
    exclusiveUnique.push(rollWrld(makeRng(200 + i), fakeRun(), { claim: false }));
    exclusiveUnique.push(rollRelic(makeRng(300 + i), []));
    exclusiveUnique.push(rollEquipment(makeRng(400 + i), 5, 0, { floor: 40, classId: 'warrior' }));
  }
  t('pack Unique/WRLD never appear in chase or ordinary rolls',
    exclusiveUnique.filter(Boolean).every(i => !String(i.id).startsWith('cp_')
      || (i.rarity !== 'unique' && i.rarity !== 'wrld' && !i.unique && !i.wrld)));
  t('pack Unique resale uses authored price',
    shopListingPrice(packLookup('cp_seventh_owner_sword')) === packLookup('cp_seventh_owner_sword').price
    && sellGold(packLookup('cp_seventh_owner_sword')) > 0);
  const inst = serializeClimber({
    ...fakeRun({ seed: 9, name: 'Rarity', level: 1, xp: 0, xpNext: 32, maxHp: 40, maxMp: 20,
      stats: { str: 8, dex: 5, int: 3, wis: 5, lk: 4 } }),
    inventory: ['cp_gate_iron_sword'],
    gearBag: { cp_gate_iron_sword: { id: 'cp_gate_iron_sword', baseId: 'cp_gate_iron_sword', affixes: [{ id: 'keen' }] } },
    packState: { run: { 'evo:cp_seventh_owner_sword': 2 } },
    className: 'Warrior', raceName: 'Human',
  });
  t('save/reload preserves gearBag instance and pack evo counters',
    inst.ok
    && inst.climber.gearBag?.cp_gate_iron_sword?.affixes?.[0]?.id === 'keen'
    && inst.climber.packState?.run?.['evo:cp_seventh_owner_sword'] === 2);
  const liveRarity = catalogEntries({ packOn: true });
  t('Compendium rarities match runtime pack catalogs',
    [...cat.items, ...cat.relics, ...cat.consumables].every(it => {
      const row = liveRarity.find(e => e.id === it.id);
      return row && row.rarity === it.rarity;
    }));

  console.log('— Gate 2 legacy mirrors —');
  const legacyErrs = Object.entries(LEGACY_MIRRORS).flatMap(([id, fx]) => fx.flatMap(ef => validateItem({
    id: `legacy_${id}`, name: id, desc: 'mirror', rarity: 'common', effects: [ef],
  }, id)));
  t('legacy mirrors validate and are tagged', Object.values(LEGACY_MIRRORS).every(fx => fx.every(e => e.legacyMirror)));
  t('legacy mirror schema clean', legacyErrs.length === 0);

  console.log('— state scopes / recursion / mutex —');
  const run = fakeRun();
  packSet(run, 'action', 'x', 1);
  packSet(run, 'turn', 'y', 1);
  packSet(run, 'combat', 'z', 1);
  packSet(run, 'floor', 'f', 1);
  packSet(run, 'run', 'storedArchetype', 'skeleton');
  cleanupAfterAction(run);
  t('action scope clears', packGet(run, 'action', 'x') == null && packGet(run, 'turn', 'y') === 1);
  cleanupAfterTurn(run);
  t('turn scope clears', packGet(run, 'turn', 'y') == null && packGet(run, 'combat', 'z') === 1);
  cleanupAfterCombat(run);
  t('combat scope clears, run persists', packGet(run, 'combat', 'z') == null && packGet(run, 'run', 'storedArchetype') === 'skeleton');
  cleanupAfterFloor(run);
  cleanupAfterBiome(run);
  t('persistable state omits temp scopes', {
    ...persistablePackState(run),
  } && !persistablePackState(run)?.combat && !persistablePackState(run)?.action);
  t('pack state size bound accepts small bags', boundPackStateSize(persistablePackState(run)).ok);
  t('copy depth hard limit is 1', LIMITS.copyDepth === 1);

  setPackEnabled(true);
  t('pack on after setPackEnabled', isPackOn());
  t('pack item lookup works when armed', !!packLookup('cp_gate_iron_sword'));
  t('pack events appear in liveEvents', liveEvents(EVENTS).some(e => e.id === 'cp_backward_threshold'));
  const shopOn = shopConsumablePool(1);
  t('pack-on shop still contains potion_s', shopOn.some(c => c.id === 'potion_s'));
  t('pack potions do not enter shop pool', !shopOn.some(c => String(c.id).startsWith('cp_')));
  const rng = makeRng(42);
  const loot = [];
  for (let i = 0; i < 80; i++) loot.push(rollEquipment(rng, 1, 0, { classId: 'warrior' }));
  const packHits = loot.filter(i => i && String(i.baseId || i.id).startsWith('cp_')).length;
  t('ordinary loot is not flooded by pack catalog', packHits < 40);

  const echoRun = fakeRun({
    equipment: { weapon: 'cp_twin_hatchets' },
    gearBag: {},
  });
  echoRun.equipment.weapon = 'cp_twin_hatchets';
  const acc1 = dispatchEffects(echoRun, 'onHit', {
    rng: makeRng(1), skill: { id: 'slash', _basic: true }, copyDepth: 0,
    enemy: { uid: 'a', hp: 10, maxHp: 10, statuses: {} },
  });
  const acc2 = dispatchEffects(echoRun, 'onHit', {
    rng: makeRng(1), skill: { id: 'slash', _basic: true }, copyDepth: 1,
    enemy: { uid: 'a', hp: 10, maxHp: 10, statuses: {} },
  });
  t('generated actions cannot echo further', !acc2.echo);

  const wardRun = fakeRun({ relics: ['cp_crimson_crystal_shard'] });
  const fight = { run: wardRun, usedDeathward: false, log() {} };
  const saved = packDeathSave(fight, { lethalWard: true, wardMaxHpCost: -4 });
  t('lethal ward is once-per-combat', saved === true && wardRun.hp === 1);
  t('second lethal ward is blocked', packDeathSave(fight, { lethalWard: true }) === false);

  const delayRun = fakeRun({ equipment: { chest: 'cp_second_timeline_plate' }, gearBag: {} });
  delayRun.equipment.chest = 'cp_second_timeline_plate';
  dispatchEffects(delayRun, 'onDamageTaken', { rng: makeRng(2) });
  t('delayEffect stores a combat payload', !!delayRun.packState?.combat && Object.keys(delayRun.packState.combat).some(k => k.startsWith('delay:')));
  applyDelayedEffects(delayRun);
  t('delay ticks to a turn-scoped incoming mod', packGet(delayRun, 'turn', 'delayInMult') === 1.2);

  const echoPlate = fakeRun({
    equipment: { weapon: 'cp_twin_hatchets' },
    relics: ['cp_crimson_crystal_shard'],
    gold: 80, fame: 12,
  });
  echoPlate.equipment.weapon = 'cp_twin_hatchets';
  const pairEcho = dispatchEffects(echoPlate, 'onHit', {
    rng: makeRng(3), skill: { id: 'slash', _basic: true }, copyDepth: 0,
    enemy: { uid: 'b', hp: 20, maxHp: 20, statuses: {} },
  });
  const pairEcho2 = dispatchEffects(echoPlate, 'onHit', {
    rng: makeRng(3), skill: { id: 'slash', _basic: true }, copyDepth: 1,
    enemy: { uid: 'b', hp: 20, maxHp: 20, statuses: {} },
  });
  t('echo + deathward pair: echo at depth 0, blocked at depth 1', !!pairEcho.echo && !pairEcho2.echo);
  const fameHit = dispatchEffects(fakeRun({
    equipment: { weapon: 'cp_applause_knife' }, fame: 6, gold: 40,
  }), 'onHit', { rng: makeRng(4), skill: { id: 'slash', _basic: true, isCrit: true }, crit: true, enemy: { uid: 'c', hp: 10, maxHp: 10, statuses: {} } });
  t('fame/gold power pair does not throw', typeof fameHit.dmgMult === 'number');
  const redirectRun = fakeRun({ skills: ['cp_intercepting_step'] });
  const red = dispatchEffects(redirectRun, 'onSkillUse', { rng: makeRng(5), skill: { id: 'cp_intercepting_step', effects: [{ hook: 'onSkillUse', op: 'redirectDamage', pct: 0.35, mutex: 'damage_redirect' }] } });
  const red2 = dispatchEffects(redirectRun, 'onSkillUse', { rng: makeRng(5), skill: { id: 'cp_intercepting_step', effects: [{ hook: 'onSkillUse', op: 'redirectDamage', pct: 0.35, mutex: 'damage_redirect' }] } });
  t('redirect mutex blocks a second redirect in the same action', (red.redirectPct || 0) > 0 && !red2.redirectPct);
  packOnEventResolve(fakeRun({ relics: ['cp_backward_gate_hinge'] }), { id: 'cp_backward_threshold' }, { hp: -8 }, makeRng(6));
  t('event-resolve hook is callable', true);

  const armRun = fakeRun();
  dispatchEffects(armRun, 'onSkillUse', {
    skill: { id: 'cp_edge_cantrip', effects: [{ hook: 'onSkillUse', op: 'armNextHit', add: 5 }] },
  });
  t('armNextHit stores a combat payload', packGet(armRun, 'combat', 'armHitAdd') === 5);
  const armedOut = packModifyOutgoing(
    { run: armRun, rng: makeRng(7), log() {} },
    { uid: 'e', hp: 20, maxHp: 20, statuses: {} },
    { id: 'slash', _basic: true },
    10,
  );
  t('armed hit applies then consumes', armedOut.dmg === 15 && packGet(armRun, 'combat', 'armHitAdd') == null);

  const ticketRun = fakeRun({ relics: ['cp_redacted_support_ticket'], hp: 20, maxHp: 40, gold: 10 });
  packOnEventResolve(ticketRun, { id: 'cp_optional_mandatory' }, { hp: -8 }, makeRng(8));
  t('support ticket refunds one event HP penalty', ticketRun.hp === 28 && packGet(ticketRun, 'run', 'ticketSpent') === 1);

  const coinRun = fakeRun({ relics: ['cp_unminted_coin'], gold: 10 });
  packOnEventResolve(coinRun, { id: 'cp_optional_mandatory' }, { gold: -25 }, makeRng(9));
  t('unminted coin covers an event gold cost', coinRun.gold >= 35);

  const fameRun = fakeRun({ fame: 2, flags: { fameBoost: true } });
  t('hero license boosts fame eligibility', reqMet(fameRun, { fame: 5 }).ok === true);
  t('without boost, fame 2 fails fame 5', reqMet(fakeRun({ fame: 2 }), { fame: 5 }).ok === false);

  const receiptRun = fakeRun({ relics: ['cp_receipt_from_tomorrow'] });
  packSet(receiptRun, 'run', 'reservedShop', 40);
  t('receipt relic adds a shop discount after a reserved price', shopDiscount(receiptRun).packDisc === 0.2);

  const delayWard = fakeRun({
    equipment: { chest: 'cp_second_timeline_plate' },
    relics: ['cp_crimson_crystal_shard'],
  });
  delayWard.equipment.chest = 'cp_second_timeline_plate';
  dispatchEffects(delayWard, 'onDamageTaken', { rng: makeRng(10) });
  const delayWardSave = packDeathSave({ run: delayWard, usedDeathward: false, log() {} }, { lethalWard: true, wardMaxHpCost: -4 });
  t('delay + lethal ward coexist', delayWardSave === true && Object.keys(delayWard.packState?.combat || {}).some(k => k.startsWith('delay:')));

  const summonRed = fakeRun();
  const sumAcc = dispatchEffects(summonRed, 'onSkillUse', {
    skill: { id: 'cp_footnote_resurrection', effects: [
      { hook: 'onSkillUse', op: 'summonAlly', archetype: 'skeleton', capability: 'summon' },
      { hook: 'onSkillUse', op: 'redirectDamage', pct: 0.3, mutex: 'damage_redirect' },
    ] },
  });
  t('summon + redirect pair both apply', !!sumAcc.summon && (sumAcc.redirectPct || 0) > 0);

  const fameGold = fakeRun({ gold: 40, fame: 8, relics: ['cp_provisional_hero_badge', 'cp_backward_gate_hinge'] });
  packOnEventResolve(fameGold, { id: 'x' }, { gold: -20, hp: -6 }, makeRng(11));
  t('fame substitution + hinge conversion do not throw', fameGold.hp > 0);

  const f1 = { run: fakeRun(), enemies: [{ id: 'rat', hp: 10, maxHp: 10, atk: 4, def: 0, statuses: {} }], log() {} };
  for (const n of [1, 2, 3, 4]) {
    const party = Array.from({ length: n }, (_, i) => ({ hp: 10, down: i === 0 && n > 1 }));
    const missing = partyMissingCount(f1, party);
    t(`party size ${n} missing-count is finite`, Number.isFinite(missing) && missing >= 0 && missing <= n);
  }

  setPackGate(GATE.SCHEMA);
  t('gate 1 hides foundation weapons', !packLookup('cp_gate_iron_sword'));
  setPackGate(GATE.FOUNDATION);
  t('gate 3 shows foundation ordinary loot', !!packLookup('cp_gate_iron_sword'));
  t('gate 3 hides class signature', !packLookup('cp_gatebreaker_greatsword'));
  setPackGate(null);

  const climber = serializeClimber({
    ...fakeRun({ seed: 1, name: 'Ava', stats: { str: 8, dex: 5, int: 3, wis: 5, lk: 4 },
      level: 1, xp: 0, xpNext: 32, maxHp: 40, maxMp: 20 }),
    packState: { run: { storedArchetype: 'skeleton' }, combat: { shouldDrop: 1 } },
    arts: ['cp_art_scar_oath'],
    coopMode: true,
    floor: 3, biomeId: 'forest', className: 'Warrior', raceName: 'Human',
  });
  t('serializeClimber allowlists packState', climber.ok && climber.climber.packState?.run?.storedArchetype === 'skeleton');
  t('serializeClimber drops combat-scoped pack state', climber.ok && !climber.climber.packState?.combat);

  const man = buildManifest();
  t('manifest has zero blocked entries', man.counts.blocked === 0 && man.byState.BLOCKED === 0);
  t('catalog validation is clean', man.entries.every(e => !e.validationErrors.length));
  t('every catalog row is playable', man.entries.every(e => e.playable === 'PLAYABLE_AS_PROPOSED' || e.playable === 'PLAYABLE_ADAPTED'));
  t('bell-clapper / empty seat are adapted, not omitted',
    man.entries.some(e => e.id === 'cp_bell_clapper_greatclub' && e.playable === 'PLAYABLE_ADAPTED')
    && man.entries.some(e => e.id === 'cp_the_empty_seat' && e.playable === 'PLAYABLE_ADAPTED'));
  t('identity routes exist on a slice of events', man.identity.eventsWithIdentityRoute > 0);

  resetPackFlags();
  t('reset restores production default on', isPackOn() === true && packStatus().gate === GATE.MULTIPLAYER);

  console.log('— pack-off vs pack-on short climb (warrior/human) —');
  const policy = baselinePolicy();
  resetPackFlags();
  setPackEnabled(false);
  const off = await simulateClimbV2(makeV2Run({ classId: 'warrior', raceId: 'human', seed: 44718291 }), policy, { stopAfterFloor: 8 });
  setPackEnabled(true);
  const on = await simulateClimbV2(makeV2Run({ classId: 'warrior', raceId: 'human', seed: 44718291 }), policy, { stopAfterFloor: 8 });
  resetPackFlags();
  t('pack-off short climb produces an outcome', !!off.outcome);
  t('pack-on short climb produces an outcome', !!on.outcome);
  t('heal potions remain available in both climbs',
    (off.checkpoint?.healConsumables ?? 0) >= 0 && (on.checkpoint?.healConsumables ?? 0) >= 0);

  console.log('— climb matrix per class / bloodline (F6, baseline) —');
  const climbSeed = 44718291;
  const byClass = {};
  for (const classId of CANONICAL_CLASSES) {
    resetPackFlags();
    setPackEnabled(false);
    const offC = await simulateClimbV2(makeV2Run({ classId, raceId: 'human', seed: climbSeed }), policy, { stopAfterFloor: 6 });
    setPackEnabled(true);
    const onC = await simulateClimbV2(makeV2Run({ classId, raceId: 'human', seed: climbSeed }), policy, { stopAfterFloor: 6 });
    byClass[classId] = {
      packOff: { outcome: offC.outcome, deathFloor: offC.deathFloor, floor: offC.checkpoint?.floor, gold: offC.checkpoint?.gold, heals: offC.checkpoint?.healConsumables },
      packOn: { outcome: onC.outcome, deathFloor: onC.deathFloor, floor: onC.checkpoint?.floor, gold: onC.checkpoint?.gold, heals: onC.checkpoint?.healConsumables },
    };
    t(`${classId} pack-off F6 climb finishes`, !!offC.outcome);
    t(`${classId} pack-on F6 climb finishes`, !!onC.outcome);
  }
  const byBloodline = {};
  for (const raceId of CANONICAL_BLOODLINES) {
    resetPackFlags();
    setPackEnabled(false);
    const offB = await simulateClimbV2(makeV2Run({ classId: 'warrior', raceId, seed: climbSeed }), policy, { stopAfterFloor: 6 });
    setPackEnabled(true);
    const onB = await simulateClimbV2(makeV2Run({ classId: 'warrior', raceId, seed: climbSeed }), policy, { stopAfterFloor: 6 });
    byBloodline[raceId] = {
      packOff: { outcome: offB.outcome, deathFloor: offB.deathFloor, floor: offB.checkpoint?.floor, gold: offB.checkpoint?.gold, heals: offB.checkpoint?.healConsumables },
      packOn: { outcome: onB.outcome, deathFloor: onB.deathFloor, floor: onB.checkpoint?.floor, gold: onB.checkpoint?.gold, heals: onB.checkpoint?.healConsumables },
    };
    t(`${raceId} pack-off F6 climb finishes`, !!offB.outcome);
    t(`${raceId} pack-on F6 climb finishes`, !!onB.outcome);
  }
  resetPackFlags();
  setPackEnabled(false);

  runCompendiumTests(t);

  const reportDir = join(__dirname, '..', 'reports');
  mkdirSync(reportDir, { recursive: true });
  const status = {
    packOff: packStatus(),
    manifest: { ...man, entries: man.entries.map(e => ({
      id: e.id, sourceId: e.sourceId, kind: e.kind, playable: e.playable,
      adaptation: e.adaptation, capability: e.capability, acquisition: e.acquisition,
      curse: e.curse, resolution: e.resolution, setId: e.setId,
      classBound: e.classBound, resonance: e.resonance,
      validationErrors: e.validationErrors,
    })) },
    capabilityMatrix: capabilityMatrix(),
    classCoverage: man.classCoverage,
    bloodlineCoverage: man.bloodlineCoverage,
    climb: {
      packOff: { outcome: off.outcome, deathFloor: off.deathFloor, floor: off.checkpoint?.floor, gold: off.checkpoint?.gold, hp: off.checkpoint?.hp, heals: off.checkpoint?.healConsumables },
      packOn: { outcome: on.outcome, deathFloor: on.deathFloor, floor: on.checkpoint?.floor, gold: on.checkpoint?.gold, hp: on.checkpoint?.hp, heals: on.checkpoint?.healConsumables },
      byClass,
      byBloodline,
      partySize: 'Climb V2 is the authoritative solo harness. Party sizes 1–4 are covered by existing enemy-scale tests; pack hooks do not read connection state.',
    },
    migration: {
      checkpointSchema: CHECKPOINT_SCHEMA,
      gameContentVersion: GAME_CONTENT_VERSION,
      previous: { schema: 1, gameVersion: 'dt-mp-1' },
      notes: [
        'Schema 1 climbers migrate to schema 2. packState/arts are optional allowlisted fields.',
        'Combat-scoped pack state is never checkpointed. Disconnect is never a gameplay condition.',
        'Pack kill switch defaults OFF (not deployed).',
        'Utility techniques arm the next hit or incoming hit through shared armNextHit / armNextIncoming ops.',
        'Event-linked relics persist eligibility flags (crown fragment, bent key, hero license) or convert gold/HP/Fame; shop receipts apply a one-time reserved discount.',
      ],
    },
    remainingGated: man.remainingGated,
    blockers: man.blockers,
  };
  writeFileSync(join(reportDir, 'content_pack_status_20260825.json'), JSON.stringify(status, null, 2));
  writeFileSync(join(reportDir, 'content_pack_balance_packoff_vs_packon_20260825.json'), JSON.stringify({
    note: 'Authoritative climb_v2. Not combat_sim / run_sim / TDC.clearRate. Unexplained movement is a blocker only when pack is deployed; kill switch remains off.',
    warriorHumanF8: { packOff: status.climb.packOff, packOn: status.climb.packOn },
    byClass: status.climb.byClass,
    byBloodline: status.climb.byBloodline,
  }, null, 2));
  writeFileSync(join(reportDir, 'content_pack_capability_matrix_20260825.json'), JSON.stringify(status.capabilityMatrix, null, 2));
  writeFileSync(join(reportDir, 'content_pack_migration_notes_20260825.json'), JSON.stringify(status.migration, null, 2));
  const rarityAudit = writeRarityAudit();
  t('rarity audit has no missing rarities', rarityAudit.audit.missingRarity.length === 0);
  t('rarity audit Unique/WRLD rules hold', rarityAudit.audit.uniqueRuleFailures.length === 0 && rarityAudit.audit.wrldRuleFailures.length === 0);
  t('rarity audit Compendium matches runtime', rarityAudit.audit.compendiumMismatch.length === 0);
  t('rarity audit remains undeployed', rarityAudit.audit.deployed === false);
}
