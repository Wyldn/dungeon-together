// Live merchant stock, price, and heal. buildShopStock owns one advance().

import { CONFIG } from './data/config.js';
import { CONSUMABLES, rollEquipment, rollRelic, rollUnique, rollWrld, shopConsumablePool, shopListingPrice, itemUsefulForClass, resolveItem, sellGold, markWrldClaimed } from './data/items.js';
import { charRel } from './data/world.js';
import { biomeTier } from './biome_tier.js';
import { appraiseRun } from './character.js';
import { applyWorldPatch } from './data/world.js';
import { earnGold, spendGold, healConsumableCount } from './economy.js';
import { packOnShopAction } from './content_pack/world_bind.js';
import { cursedSellBlocked } from './content_pack/grants.js';
import { packGet, packSet } from './content_pack/state.js';
import { noteDiscovery } from './compendium_seen.js';

/** Flags this module reads. Catalog walker imports this — do not duplicate lists. */
export const SHOP_NARRATIVE_READS = {
  flags: ['guild_notes', 'undercity_ties', 'paid_toll', 'dukes_mark'],
  chars: ['merchant'],
};

export function shopDiscount(run) {
  const fameDisc = run.fame >= CONFIG.fame.shopDiscountAt ? CONFIG.fame.shopDiscountPct : 0;
  const faceDisc = Math.max(0, Math.min(0.1, charRel(run, 'merchant') * 0.03));
  let storyDisc = 0;
  if (run.flags?.guild_notes) storyDisc += 0.04;
  else if (run.flags?.undercity_ties) storyDisc += 0.04;
  else if (run.flags?.paid_toll) storyDisc += 0.03;
  if (run.flags?.dukes_mark && run.biomeId === 'hell') storyDisc += 0.04;
  const packDisc = (packGet(run, 'run', 'reservedShop') && !packGet(run, 'run', 'receiptSpent')) ? 0.2 : 0;
  return {
    fameDisc,
    faceDisc,
    storyDisc,
    packDisc,
    discount: Math.min(0.35, fameDisc + faceDisc + storyDisc + packDisc),
  };
}

/** Player-facing discount line. Must mention every component that actually shaved the price. */
export function shopDiscountFlavor(run) {
  const d = shopDiscount(run);
  if (!d.discount) return '';
  let quote;
  if (d.packDisc && !d.fameDisc && !d.faceDisc && !d.storyDisc) {
    quote = '"I have yesterday\'s receipt for this. Original price."';
  } else if (d.storyDisc && !d.fameDisc && !d.faceDisc) {
    if (run.flags?.dukes_mark && run.biomeId === 'hell') {
      quote = '"The Duke\'s stamp is in the ledger. A consideration."';
    } else if (run.flags?.paid_toll && !run.flags?.guild_notes && !run.flags?.undercity_ties) {
      quote = '"You paid the woods. A consideration."';
    } else {
      quote = '"Someone downstairs vouched. A consideration."';
    }
  } else if (d.faceDisc && !d.fameDisc) {
    quote = '"For a familiar face, a consideration."';
  } else {
    quote = '"Wait — I know that face! For a climber of your reputation, a consideration."';
  }
  const tags = [];
  if (d.fameDisc) tags.push('fame');
  if (d.faceDisc) tags.push('familiar');
  if (d.storyDisc) {
    if (run.flags?.guild_notes) tags.push('guild');
    else if (run.flags?.undercity_ties) tags.push('undercity');
    else if (run.flags?.paid_toll) tags.push('toll');
    if (run.flags?.dukes_mark && run.biomeId === 'hell') tags.push("Duke's mark");
  }
  if (d.packDisc) tags.push('receipt');
  return `${quote} (${tags.join(' + ')} discount)`;
}

export function shopPrice(rawPrice, discount) {
  const disc = Math.max(0, Math.min(0.35, Number(discount) || 0));
  const raw = Number(rawPrice);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, Math.round(raw * (CONFIG.economy.merchantPriceMult || 1) * (1 - disc)));
}

export function shopHealCost(run, discount) {
  return Math.max(10, Math.round((run.maxHp - run.hp) * 0.8 * (CONFIG.economy.merchantPriceMult || 1) * (1 - discount)));
}

/** Builds stock and advances rng once unless resumeStock is provided. */
export function buildShopStock(run, rng, { resumeStock = null, coop = null } = {}) {
  if (resumeStock?.length) return resumeStock;
  const tier = biomeTier(run.biomeId);
  const stock = [];
  const cons = rng.shuffle(shopConsumablePool(tier)).slice(0, 3);
  if (healConsumableCount(run) === 0 && !cons.some(c => c.heal || c.healPct)) {
    const pity = CONSUMABLES.find(c => c.id === (tier >= 4 ? 'potion_l' : 'potion_s'));
    if (pity) cons[0] = pity;
  }
  cons.forEach(c => stock.push({ kind: 'consumable', item: c, price: c.price }));
  if (rng.chance(0.4)) stock.push({ kind: 'consumable', item: CONSUMABLES.find(c => c.appraisal), price: 90 });
  const earlyOrMid = run.floor < 35;
  const excludeIds = run.recentShopItemIds || [];
  for (let i = 0; i < 2; i++) {
    const item = rollEquipment(rng, tier, 2, {
      floor: run.floor, run, classId: run.classId, usefulBias: 4,
      requireUseful: earlyOrMid && i === 0,
      slot: (tier === 1 && i === 0) ? 'weapon' : undefined,
      excludeIds,
      channel: i === 0 ? 'class' : undefined,
    }) || (i === 0 ? rollEquipment(rng, tier, 2, {
      floor: run.floor, run, classId: run.classId, usefulBias: 4,
      requireUseful: earlyOrMid,
      slot: (tier === 1) ? 'weapon' : undefined,
      excludeIds,
      channel: 'ordinary',
    }) : null);
    if (item) stock.push({ kind: 'equip', item, price: item.price });
  }
  if (earlyOrMid) {
    const hasUseful = stock.some(s => s.kind === 'equip' && itemUsefulForClass(s.item, run.classId));
    if (!hasUseful) {
      const forced = rollEquipment(rng, Math.max(tier, 2), 3, {
        floor: run.floor, run, classId: run.classId, requireUseful: true, usefulBias: 8,
        excludeIds,
      });
      if (forced) {
        const idx = stock.findIndex(s => s.kind === 'equip');
        if (idx >= 0) stock[idx] = { kind: 'equip', item: forced, price: forced.price };
        else stock.push({ kind: 'equip', item: forced, price: forced.price });
      }
    }
  }
  if (run.floor >= 18 && rng.chance(0.035 + Math.min(0.04, run.floor * 0.0008))) {
    const u = rollUnique(rng, run, { preferUseful: true });
    if (u) stock.push({ kind: 'equip', item: u, price: shopListingPrice(u) });
  }
  if (run.floor >= 35 && rng.chance(0.01 + Math.min(0.015, (run.floor - 35) * 0.0005))) {
    const w = rollWrld(rng, run, { preferUseful: true, kind: 'equip', coop, claim: false });
    if (w) stock.push({ kind: 'equip', item: w, price: shopListingPrice(w) });
  }
  if (rng.chance(0.5)) {
    const r = rollRelic(rng, [...(run.relics || []), ...excludeIds]);
    if (r) stock.push({ kind: 'relic', item: r, price: 120 + tier * 40 });
  }
  if (!Array.isArray(run.recentShopItemIds)) run.recentShopItemIds = [];
  for (const s of stock) {
    const catalogId = s.item?.baseId || (s.item?.id || '').split('__')[0];
    if (catalogId) run.recentShopItemIds.push(catalogId);
  }
  if (run.recentShopItemIds.length > 12) {
    run.recentShopItemIds = run.recentShopItemIds.slice(-8);
  }
  rng.advance();
  return stock;
}

/** Live wallet. Never snapshot this at shop entry — sale proceeds must spend in-visit. */
export function shopGold(run) {
  const n = Number(run?.gold);
  return Number.isFinite(n) ? n : 0;
}

export function shopCanAfford(run, cost) {
  return shopGold(run) >= cost;
}

/** Visit handle. Freezes stock + discount (pricing), not gold. */
export function openShopVisit(stock, discount) {
  return { stock, discount, boughtHere: false, busy: false };
}

/** Button / affordability snapshot from current gold. Recompute after every tx. */
export function shopView(run, stock, discount, visit = null) {
  const gold = shopGold(run);
  const busy = !!visit?.busy;
  const listings = (stock || []).map((s, i) => {
    const price = shopPrice(s.price, discount);
    const canBuy = !busy && gold >= price;
    return { i, price, canBuy, disabled: !canBuy };
  });
  const healCost = shopHealCost(run, discount);
  const canHeal = !busy && gold >= healCost && run.hp < run.maxHp;
  const restockCost = shopRestockCost(run, discount);
  const canRestock = !busy && gold >= restockCost;
  return {
    gold,
    listings,
    heal: { cost: healCost, canBuy: canHeal, disabled: !canHeal },
    restock: { cost: restockCost, canBuy: canRestock, disabled: !canRestock },
  };
}

export function applyShopHeal(run, discount) {
  const cost = shopHealCost(run, discount);
  const gold = shopGold(run);
  if (gold < cost || run.hp >= run.maxHp) {
    return { ok: false, cost, reason: gold < cost ? 'gold' : 'full' };
  }
  spendGold(run, cost, 'shop_heal');
  run.hp = run.maxHp;
  return { ok: true, cost };
}

export function applyShopBuy(run, stock, index, discount, hooks = {}) {
  // hooks.claimedGold is intentionally ignored. Purchases read shopGold(run) only.
  if (!Array.isArray(stock) || index < 0 || index >= stock.length) {
    return { ok: false, reason: 'missing' };
  }
  const s = stock[index];
  if (!s) return { ok: false, reason: 'missing' };
  const p = shopPrice(s.price, discount);
  const gold = shopGold(run);
  if (gold < p) return { ok: false, price: p, reason: 'gold' };
  const hadReserve = packGet(run, 'run', 'reservedShop') && !packGet(run, 'run', 'receiptSpent');
  spendGold(run, p, 'shop');
  if (s.kind === 'consumable') {
    if (s.item.appraisal) {
      const rng2 = hooks.runRng ? hooks.runRng(run) : null;
      if (rng2) {
        appraiseRun(rng2, run, { partial: false, location: 'a merchant\'s scroll' });
        rng2.advance();
      }
    } else {
      run.consumables.push(s.item.id);
    }
  }
  if (s.kind === 'relic') run.relics.push(s.item.id);
  if (s.item && (s.item.rarity === 'wrld' || s.item.wrld)) {
    markWrldClaimed(run, s.item.baseId || s.item.id, hooks.coop || null);
  }
  stock.splice(index, 1);
  packOnShopAction(run, 'buy', { price: p });
  if (hadReserve) packSet(run, 'run', 'receiptSpent', 1);
  const catalogId = s.item?.baseId || s.item?.id;
  if (catalogId) noteDiscovery(catalogId);
  return { ok: true, price: p, listing: s };
}

/** Pack sell. Credits current gold so the same visit can spend the proceeds. */
export function applyShopSell(run, index, { from = 'inventory' } = {}) {
  const inv = run?.inventory;
  if (!Array.isArray(inv) || index < 0 || index >= inv.length) {
    return { ok: false, reason: 'missing' };
  }
  const id = inv[index];
  const item = resolveItem(run, id);
  if (cursedSellBlocked(run, item)) {
    return { ok: false, reason: 'curse', item, id };
  }
  const gold = sellGold(item, { from });
  inv.splice(index, 1);
  if (run.gearBag && id && run.gearBag[id]) delete run.gearBag[id];
  earnGold(run, gold, 'sell');
  return { ok: true, gold, item, id };
}

export function applyShopLeave(run, boughtHere) {
  if (boughtHere) applyWorldPatch(run, { char: { id: 'merchant', met: true, rel: 1, memory: 'bought' } });
}

export function shopRestockCost(run, discount) {
  const tier = biomeTier(run.biomeId);
  const base = CONFIG.economy.shopRestockCost ?? 40;
  const per = CONFIG.economy.shopRestockPerTier ?? 12;
  return shopPrice(base + tier * per, discount);
}

/** Optional restock. Rebuilds `stock` in place. One rng.advance via buildShopStock. */
export function applyShopRestock(run, stock, rng, discount, { coop = null } = {}) {
  const cost = shopRestockCost(run, discount);
  if (shopGold(run) < cost) return { ok: false, cost, reason: 'gold' };
  if (!Array.isArray(stock)) return { ok: false, cost, reason: 'missing' };
  spendGold(run, cost, 'shop_restock');
  const fresh = buildShopStock(run, rng, { coop });
  stock.length = 0;
  for (const s of fresh) stock.push(s);
  return { ok: true, cost };
}
