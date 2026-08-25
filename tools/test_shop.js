// Focused shop-visit gold tests: sell proceeds must be spendable immediately.
//   node tools/test_shop.js

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { CONFIG } from '../js/data/config.js';
import { sellGold } from '../js/data/items.js';
import {
  shopPrice, shopGold, shopCanAfford, shopView, openShopVisit,
  applyShopBuy, applyShopSell, applyShopHeal, buildShopStock,
} from '../js/shop.js';
import { makeRng } from '../js/rng.js';

const root = dirname(fileURLToPath(import.meta.url));

function listing(price, extra = {}) {
  return {
    kind: extra.kind || 'consumable',
    item: { id: extra.id || 'potion_s', name: extra.name || 'Potion', desc: 'test', ...extra.item },
    price,
  };
}

function runState(gold, inventory = []) {
  return {
    gold,
    goldEarned: 0,
    hp: 40,
    maxHp: 50,
    inventory: [...inventory],
    gearBag: {},
    consumables: [],
    relics: [],
    fame: 0,
    flags: {},
    world: { characters: {} },
  };
}

function packItem(id, price) {
  return { id, name: id, price, rarity: 'common' };
}

export async function runShopTests(t) {
  console.log('— shop visit sale proceeds —');

  t('merchant markup is the live 1.05', (CONFIG.economy.merchantPriceMult || 1) === 1.05);
  // round(48 * 1.05) = 50 — the reproduction's displayed price.
  t('48 raw lists at 50g', shopPrice(48, 0) === 50);
  t('inventory sell of 80g item is 40g', sellGold(packItem('junk', 80), { from: 'inventory' }) === 40);

  {
    const run = runState(10, ['junk']);
    run.gearBag.junk = packItem('junk', 80);
    const stock = [listing(48)];
    const visit = openShopVisit(stock, 0);
    let view = shopView(run, visit.stock, visit.discount, visit);
    t('starts with 10 gold', view.gold === 10 && shopGold(run) === 10);
    t('50g listing is initially unaffordable', view.listings[0].disabled && !view.listings[0].canBuy);
    t('buy rejected at shop entry gold', !applyShopBuy(run, visit.stock, 0, 0, { claimedGold: 999 }).ok);
    t('rejected buy leaves gold and stock', run.gold === 10 && visit.stock.length === 1);

    const sold = applyShopSell(run, 0);
    t('sale credits 40g', sold.ok && sold.gold === 40);
    t('gold updated exactly once after sale', run.gold === 50);
    t('sold item removed exactly once', run.inventory.length === 0 && !run.gearBag.junk);
    t('double sell refused', !applyShopSell(run, 0).ok && run.gold === 50);

    view = shopView(run, visit.stock, visit.discount, visit);
    t('exact affordability after selling', view.gold === 50 && view.listings[0].canBuy && !view.listings[0].disabled);
    t('shop buttons rerender from current gold', view.listings[0].price === 50 && shopCanAfford(run, view.listings[0].price));

    const bought = applyShopBuy(run, visit.stock, 0, 0, { claimedGold: 10 });
    t('sale proceeds buy the 50g item', bought.ok && bought.price === 50);
    t('gold spent exactly once', run.gold === 0);
    t('listing removed exactly once', visit.stock.length === 0);
    t('duplicate purchase refused', !applyShopBuy(run, visit.stock, 0, 0).ok && run.gold === 0);
    t('item granted once', run.consumables.join() === 'potion_s');
  }

  {
    const run = runState(10, ['rich']);
    run.gearBag.rich = packItem('rich', 160);
    const stock = [listing(48)];
    applyShopSell(run, 0);
    const view = shopView(run, stock, 0);
    t('more-than-enough gold after selling', run.gold === 90 && view.listings[0].canBuy);
    const bought = applyShopBuy(run, stock, 0, 0);
    t('overfunded buy leaves the remainder', bought.ok && run.gold === 40 && stock.length === 0);
  }

  {
    const run = runState(10, ['chip']);
    run.gearBag.chip = packItem('chip', 20);
    const stock = [listing(48)];
    applyShopSell(run, 0);
    const view = shopView(run, stock, 0);
    t('still-insufficient gold after selling', run.gold === 20 && view.listings[0].disabled);
    t('buy still rejected', !applyShopBuy(run, stock, 0, 0).ok && run.gold === 20 && stock.length === 1);
  }

  {
    const run = runState(5, ['a', 'b']);
    run.gearBag.a = packItem('a', 40);
    run.gearBag.b = packItem('b', 50);
    const stock = [listing(48)];
    t('first sale not enough', !shopView(run, stock, 0).listings[0].canBuy);
    applyShopSell(run, 0);
    t('after first of two sales still short', run.gold === 25 && shopView(run, stock, 0).listings[0].disabled);
    applyShopSell(run, 0);
    t('multiple sales then purchase', run.gold === 50 && shopView(run, stock, 0).listings[0].canBuy);
    t('two sales removed both items', run.inventory.length === 0);
    t('buy after two sales', applyShopBuy(run, stock, 0, 0).ok && run.gold === 0);
  }

  {
    const run = runState(50, ['fuel']);
    run.gearBag.fuel = packItem('fuel', 100);
    const stock = [listing(48, { id: 'first' }), listing(48, { id: 'second' })];
    t('opening buy succeeds', applyShopBuy(run, stock, 0, 0).ok && run.gold === 0 && run.consumables[0] === 'first');
    t('cannot afford second yet', shopView(run, stock, 0).listings[0].disabled);
    applyShopSell(run, 0);
    t('purchase then sale then another purchase',
      run.gold === 50
      && shopView(run, stock, 0).listings[0].canBuy
      && applyShopBuy(run, stock, 0, 0).ok
      && run.gold === 0
      && run.consumables.join() === 'first,second'
      && stock.length === 0);
  }

  {
    const run = runState(10);
    const stock = [listing(48)];
    const before = shopView(run, stock, 0);
    run.gold = 999;
    const after = shopView(run, stock, 0);
    t('prices stay frozen when gold changes', before.listings[0].price === after.listings[0].price);
    t('affordability rereads gold', before.listings[0].disabled && after.listings[0].canBuy);
  }

  {
    const run = runState(0);
    run.gold = -5;
    t('negative gold cannot buy', !applyShopBuy(run, [listing(48)], 0, 0).ok);
    t('negative gold stays non-spendable', shopGold(run) === -5 && !shopCanAfford(run, 1));
  }

  {
    const run = runState(100);
    const heal = applyShopHeal(run, 0);
    t('heal spends current gold', heal.ok && run.hp === 50 && run.gold === 100 - heal.cost);
    t('heal refuses when full', !applyShopHeal(run, 0).ok);
  }

  {
    const run = runState(10, ['junk']);
    run.gearBag.junk = packItem('junk', 80);
    const stock = [listing(48)];
    const netRequest = { gold: 999, index: 0 };
    t('multiplayer client gold cannot buy unaffordable stock',
      !applyShopBuy(run, stock, netRequest.index, 0, { claimedGold: netRequest.gold }).ok
      && run.gold === 10);
    applyShopSell(run, 0);
    t('authoritative gold after sale, not stale client wallet',
      applyShopBuy(run, stock, 0, 0, { claimedGold: 10 }).ok && run.gold === 0);
  }

  {
    const run = runState(10);
    const visit = openShopVisit([listing(1)], 0);
    visit.busy = true;
    const view = shopView(run, visit.stock, visit.discount, visit);
    t('busy visit disables shop buttons', view.listings[0].disabled && view.heal.disabled);
  }

  {
    const shopRng = (seed) => {
      const r = makeRng(seed);
      r.advance = () => {};
      return r;
    };
    const a = { gold: 0, floor: 8, biomeId: 'forest', classId: 'warrior', relics: [], recentShopItemIds: [] };
    const b = { gold: 0, floor: 8, biomeId: 'forest', classId: 'warrior', relics: [], recentShopItemIds: [] };
    const stockA = buildShopStock(a, shopRng(77));
    const stockB = buildShopStock(b, shopRng(77));
    t('same seed shop stock is deterministic',
      JSON.stringify(stockA.map(s => [s.kind, s.item?.id, s.price]))
      === JSON.stringify(stockB.map(s => [s.kind, s.item?.id, s.price])));
  }

  {
    const gameSrc = readFileSync(join(root, '..', 'js', 'game.js'), 'utf8');
    t('live shop buys through applyShopBuy', /applyShopBuy\(run, visit\.stock/.test(gameSrc));
    t('live shop affordability uses shopView', /shopView\(run, visit\.stock/.test(gameSrc));
    t('pack sell goes through applyShopSell', /applyShopSell\(run, \+b\.dataset\.sellinv\)/.test(gameSrc));
    t('shop screen does not subtract gold locally',
      !/run\.gold -= p/.test(gameSrc) && !/run\.gold \+= sellGold\(it/.test(gameSrc));
  }
}

const standalone = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/test_shop.js');
if (standalone) {
  let pass = 0, fail = 0;
  function t(name, cond) {
    if (cond) pass++;
    else { fail++; console.error('  ✗ FAIL:', name); }
  }
  try {
    await runShopTests(t);
  } catch (err) {
    fail++;
    console.error('  ✗ FAIL: shop suite threw', err);
  }
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
