// Economy ledger, offering protection, and assay chain tests.

import { EVENTS } from '../js/data/events.js';
import { eventEligible, evalWhen, presentEvent, applyOutcomeWorld, recordEvent, threadStage, FLAG_BRIDGES } from '../js/data/world.js';
import { newRun } from '../js/state.js';
import { reqMet } from '../js/requirements.js';
import { resolveEventBranch, applyEventOutcome } from '../js/outcomes.js';
import { makeRng } from '../js/rng.js';
import {
  listEligibleOfferings, consumeOffering, restoreOffering, isProtectedItem,
  resolveKiln, kilnSellCap, kilnGoldReturnCap, defaultOfferingPick, offeringConversionLegal,
  offeringHint,
} from '../js/offering.js';
import { earnGold, spendGold, healConsumableCount } from '../js/economy.js';
import { catalogEconomy } from './economy_catalog.js';
import { climbCheckpoint } from '../js/climb_snapshot.js';
import { buildShopStock, shopRestockCost, applyShopRestock, shopView } from '../js/shop.js';
import { CONFIG } from '../js/data/config.js';
import { eventDrawWeight } from '../js/data/eventpace.js';
import { sellGold } from '../js/data/items.js';
import { serializeClimber } from '../js/mp_checkpoint.js';
import { exclusiveFlagViolations } from '../js/data/narrative_integrity.js';

function blankRun(extra = {}) {
  const run = newRun({ upgrades: {}, achievements: [] }, {
    classId: extra.classId || 'warrior',
    raceId: extra.raceId || 'human',
    name: 'Econ',
    seed: extra.seed || 11,
  });
  Object.assign(run, extra);
  run.floor = extra.floor ?? 5;
  run.biomeId = extra.biomeId || 'forest';
  return run;
}

export async function runEconomyEventTests(t) {
  console.log('— economy ledger —');
  {
    const run = blankRun({ gold: 40 });
    spendGold(run, 15, 'shop');
    t('spendGold deducts', run.gold === 25 && run.goldSpent === 15);
    earnGold(run, 10, 'combat');
    t('earnGold credits earned', run.gold === 35 && run.goldEarned === 10);
    t('spend reason bucket', run.goldSpentBy.shop === 15);
    t('earn reason bucket', run.goldEarnedBy.combat === 10);
    const cp = climbCheckpoint(run);
    t('checkpoint stores goldSpent', cp.goldSpent === 15 && cp.goldEarned === 10);
    t('checkpoint healConsumables', cp.healConsumables >= 1);
  }

  console.log('— catalog —');
  {
    const cat = catalogEconomy();
    t('catalog lists events', cat.events.length > 80);
    t('combat gold mult is 0.7', cat.combatGoldMult === 0.7);
    t('assay clerk is a gold sink', cat.eventGoldSinks.some(e => e.id === 'assay_clerk'));
    t('kiln is catalogued', cat.events.some(e => e.id === 'remembering_kiln'));
    t('campfire grants a potion', cat.eventPotionGains.some(e => e.id === 'campfire'));
  }

  console.log('— merchant weight bonus is wired —');
  {
    const run = blankRun();
    const merch = EVENTS.find(e => e.id === 'merchant');
    const wt = eventDrawWeight(merch, run);
    t('merchant bonus term exists', wt.terms.some(x => x.id === 'merchantBonus'));
    t('merchant bonus raises weight', wt.w > (merch.w || 1));
  }

  console.log('— shop pity + restock —');
  {
    const run = blankRun({ floor: 4, biomeId: 'forest', consumables: [], gold: 200 });
    const rng = makeRng(99);
    const stock = buildShopStock(run, rng);
    t('starved shop stocks a heal', stock.some(s => s.kind === 'consumable' && (s.item.heal || s.item.healPct)));
    const view = shopView(run, stock, 0);
    t('shop view has restock', view.restock?.cost > 0);
    t('restock costs gold', shopRestockCost(run, 0) >= CONFIG.economy.shopRestockCost);
    const before = stock.map(s => s.item?.id).join(',');
    const rng2 = makeRng(100);
    const r = applyShopRestock(run, stock, rng2, 0);
    t('restock spends gold', r.ok && run.goldSpentBy.shop_restock > 0);
    t('restock replaces stock', stock.length > 0 && stock.map(s => s.item?.id).join(',') !== before);
  }

  console.log('— offering eligibility —');
  {
    const run = blankRun({ gold: 80, hp: 40, maxHp: 46, inventory: ['rusty_sword'], consumables: ['potion_s'] });
    run.equipment.weapon = 'rusty_sword';
    const list = listEligibleOfferings(run, {});
    t('equipped weapon is not offered', !list.some(x => x.id === 'rusty_sword' && x.kind === 'pack'));
    t('pack potion is offered', list.some(x => x.id === 'potion_s'));
    t('gold offering exists', list.some(x => x.kind === 'gold'));
    t('hp offering exists', list.some(x => x.kind === 'hp'));
    run.inventory.push('steel_blade');
    const still = listEligibleOfferings(run, { kinds: ['pack'] });
    t('unequipped pack gear is eligible', still.some(x => x.id === 'steel_blade'));
    t('consume refuses equipped weapon', consumeOffering(run, { kind: 'pack', id: 'rusty_sword' }).reason === 'equipped');
    const unique = { id: 'quietus', rarity: 'unique', unique: true, slot: 'weapon', name: 'Quietus' };
    t('unique is protected', isProtectedItem(run, unique, 'quietus'));
    const med = { id: 'encore_medallion', rarity: 'uncommon', slot: 'accessory', name: 'Encore' };
    t('quest token is protected', isProtectedItem(run, med, 'encore_medallion'));
  }

  console.log('— offering consume / cancel restore —');
  {
    const run = blankRun({ gold: 80, inventory: ['cloth_garb'], consumables: ['potion_s'] });
    const pick = { kind: 'consumable', id: 'potion_s' };
    const snap = run.consumables.slice();
    const consumed = consumeOffering(run, pick);
    t('potion consumed', consumed.ok && !run.consumables.includes('potion_s'));
    restoreOffering(run, pick, consumed);
    t('cancel restore returns potion', run.consumables.includes('potion_s') && run.consumables.length === snap.length);
    const goldPick = { kind: 'gold', amount: 35 };
    const g0 = run.gold;
    const gCons = consumeOffering(run, goldPick);
    t('gold offering spends', gCons.ok && run.gold === g0 - 35);
    restoreOffering(run, goldPick, gCons);
    t('gold offering restore', run.gold === g0);
  }

  console.log('— kiln loop protection —');
  {
    t('gold return cap is 70%', kilnGoldReturnCap(100) === 70);
    t('item slag cap is 75%', kilnSellCap(40) === 30);
    t('conversion helper rejects profit gold', !offeringConversionLegal(20, 40));
    t('conversion helper allows capped gold', offeringConversionLegal(40, 30));
    const run = blankRun({ gold: 80, floor: 12, biomeId: 'ruins', inventory: ['cloth_garb'] });
    const rng = makeRng(7);
    for (let i = 0; i < 40; i++) {
      const r = makeRng(7 + i);
      const pick = { kind: 'gold', amount: 35, category: 'gold' };
      const paid = consumeOffering(run, pick);
      const kiln = resolveKiln(r, run, pick, paid);
      if (kiln.gold) t(`gold kiln never profits ${i}`, kiln.gold <= kilnGoldReturnCap(35));
      restoreOffering(run, pick, paid);
      run.gold = 80;
    }
    t('loop battery ran', true);
  }

  console.log('— kiln cheapest-item is not dominant —');
  {
    const run = blankRun({ floor: 12, biomeId: 'ruins', consumables: ['farm_bread', 'potion_s'] });
    let foodRuin = 0, potRuin = 0;
    for (let i = 0; i < 80; i++) {
      const food = resolveKiln(makeRng(200 + i), run, { kind: 'consumable', category: 'potion', item: { id: 'farm_bread', name: 'Bread', price: 12 } }, { item: { id: 'farm_bread', name: 'Bread', price: 12 } });
      if (food.result === 'ruin') foodRuin++;
      const pot = resolveKiln(makeRng(400 + i), run, { kind: 'consumable', category: 'potion', item: { id: 'potion_s', name: 'Pot', price: 25 } }, { item: { id: 'potion_s', name: 'Pot', price: 25 } });
      if (pot.result === 'ruin') potRuin++;
    }
    t('cheap food is punished more often than a potion', foodRuin > potRuin);
  }

  console.log('— assay chain prerequisites —');
  {
    const clerk = EVENTS.find(e => e.id === 'assay_clerk');
    const collect = EVENTS.find(e => e.id === 'assay_collection');
    const settle = EVENTS.find(e => e.id === 'assay_settlement');
    const kiln = EVENTS.find(e => e.id === 'remembering_kiln');
    t('assay events authored', !!(clerk && collect && settle && kiln));
    const fresh = blankRun({ floor: 5, biomeId: 'forest' });
    t('clerk eligible in forest', eventEligible(clerk, fresh));
    t('collection blocked before clerk', !eventEligible(collect, { ...fresh, floor: 16, biomeId: 'ruins' }));
    t('settlement blocked before collection', !eventEligible(settle, { ...fresh, floor: 34, biomeId: 'swamp' }));
    const paid = blankRun({ floor: 16, biomeId: 'ruins', flags: { assay_paid: true } });
    t('paid flag opens collection', eventEligible(collect, paid));
    const shown = presentEvent(collect, paid);
    t('paid variant acknowledges stamp', /stamp|paid upstairs|coin/i.test(shown.text));
    t('paid variant has reforge choice', (shown.choices || []).some(c => c.id === 'refine'));
    const potion = blankRun({ floor: 16, biomeId: 'ruins', flags: { assay_potion: true } });
    const pShown = presentEvent(collect, potion);
    t('potion variant mentions vial', /vial|collateral/i.test(pShown.text));
    t('potion variant is not the paid reforge card', !(pShown.choices || []).some(c => c.id === 'refine'));
    const refused = blankRun({ floor: 16, biomeId: 'ruins', flags: { assay_refused: true } });
    const rShown = presentEvent(collect, refused);
    t('refused variant is late-fee', /WALKED|late fee|description/i.test(rShown.text));
    t('mutually exclusive variants', shown.variantId === 'paid' && pShown.variantId === 'potion' && rShown.variantId === 'refused');
    t('opening flags are exclusive', exclusiveFlagViolations({
      flags: { assay_paid: true, assay_refused: true },
    }).some(g => g.includes('assay_paid')));
    t('collection not eligible without ruins biome', !eventEligible(collect, blankRun({ floor: 16, biomeId: 'forest', flags: { assay_paid: true } })));
    t('FLAG_BRIDGES include assay_paid', !!FLAG_BRIDGES.assay_paid);
  }

  console.log('— assay later stage acknowledges specific prior choice —');
  {
    const settle = EVENTS.find(e => e.id === 'assay_settlement');
    const honored = presentEvent(settle, blankRun({
      floor: 34, biomeId: 'swamp', flags: { assay_collected_paid: true },
      seenEvents: ['assay_collection'],
    }));
    t('settlement honored text mentions paying twice', /paid in the woods|paid again/i.test(honored.text));
    const vial = presentEvent(settle, blankRun({
      floor: 34, biomeId: 'swamp', flags: { assay_collected_vial: true },
      seenEvents: ['assay_collection'],
    }));
    t('vial settlement mentions darker glass', /darker glass|collateral came back/i.test(vial.text));
    t('honored and vial are different cards', honored.variantId !== vial.variantId);
    const early = blankRun({ floor: 20, biomeId: 'swamp', flags: { assay_collected_paid: true }, seenEvents: ['assay_collection'] });
    t('no settlement before floor window', !eventEligible(settle, early));
  }

  console.log('— chain flags in snapshots —');
  {
    const run = blankRun({ floor: 8, biomeId: 'forest' });
    applyOutcomeWorld(run, { flag: 'assay_paid' });
    t('assay thread opened', threadStage(run, 'assay') === 'opened');
    t('stamp knowledge written', (run.world.knowledge || []).includes('assay_stamp'));
    const cp = climbCheckpoint(run);
    t('snapshot keeps assay flag', !!cp.flags.assay_paid);
    t('snapshot keeps knowledge', cp.knowledge.includes('assay_stamp'));
    t('snapshot keeps thread', cp.threads.assay?.stage === 'opened');
    const ser = serializeClimber(run);
    t('mp climber keeps assay flag', ser.ok && ser.climber.flags.assay_paid);
    t('mp climber keeps goldSpent key', ser.ok && 'goldSpent' in ser.climber);
  }

  console.log('— kiln event empty-handed —');
  {
    const kiln = EVENTS.find(e => e.id === 'remembering_kiln');
    const broke = blankRun({
      floor: 14, biomeId: 'ruins', gold: 0, hp: 8, maxHp: 40,
      consumables: [], inventory: [],
    });
    const offer = kiln.choices.find(c => c.id === 'offer');
    t('offer locked with nothing eligible', !reqMet(broke, offer.req).ok);
    t('watch choice stays open', reqMet(broke, kiln.choices.find(c => c.id === 'watch').req).ok);
    t('outcome hints name risk categories', /remake, ruin, refuse/.test(offeringHint(offer.outcome.offering)));
    const rich = blankRun({ floor: 14, biomeId: 'ruins', gold: 80, hp: 40, maxHp: 46, consumables: ['potion_s'] });
    t('offer open when a potion exists', reqMet(rich, offer.req).ok);
  }

  console.log('— seeded kiln is deterministic —');
  {
    const runA = blankRun({ gold: 80 });
    const runB = blankRun({ gold: 80 });
    const pick = { kind: 'gold', amount: 35, category: 'gold' };
    const a = resolveKiln(makeRng(12345), runA, pick, { amount: 35, consumed: true });
    const b = resolveKiln(makeRng(12345), runB, pick, { amount: 35, consumed: true });
    t('same seed same kiln result', a.result === b.result && JSON.stringify(a.lines) === JSON.stringify(b.lines));
  }

  console.log('— applyEventOutcome offering does not consume on empty pick —');
  {
    const run = blankRun({ floor: 14, biomeId: 'ruins', gold: 80, consumables: ['potion_s'] });
    const kiln = EVENTS.find(e => e.id === 'remembering_kiln');
    const offer = kiln.choices.find(c => c.id === 'offer');
    const rng = makeRng(5);
    await applyEventOutcome(run, kiln, { ...offer.outcome, offering: { ...offer.outcome.offering, picked: { kind: 'none' } } }, rng, { lines: [] });
    t('empty kiln pick keeps potion', run.consumables.includes('potion_s'));
    t('empty kiln pick keeps gold', run.gold === 80);
  }

  console.log('— default offering pick is not the cheapest dump —');
  {
    const run = blankRun({
      inventory: ['farm_bread', 'steel_blade', 'iron_helm'],
      consumables: [],
      gold: 10,
    });
    // farm_bread is a consumable id wrongly in inventory — use real pack ids
    run.inventory = ['leather_cap', 'leather_jerkin', 'steel_blade'];
    const list = listEligibleOfferings(run, { kinds: ['pack'] }).slice().sort((a, b) => a.sell - b.sell);
    const pick = defaultOfferingPick(run, { kinds: ['pack'] });
    t('mid pack pick when several exist', pick.kind === 'pack' && list.length >= 3 && pick.id === list[Math.floor(list.length / 2)].id);
  }
}
