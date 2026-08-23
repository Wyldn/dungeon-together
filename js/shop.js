// Live merchant stock, price, and heal. buildShopStock owns one advance().

import { CONFIG } from './data/config.js';
import { CONSUMABLES, rollEquipment, rollRelic, rollUnique, rollWrld, shopConsumablePool, shopListingPrice, itemUsefulForClass } from './data/items.js';
import { charRel } from './data/world.js';
import { biomeTier } from './biome_tier.js';
import { appraiseRun } from './character.js';
import { applyWorldPatch } from './data/world.js';

export function shopDiscount(run) {
  const fameDisc = run.fame >= CONFIG.fame.shopDiscountAt ? CONFIG.fame.shopDiscountPct : 0;
  const faceDisc = Math.max(0, Math.min(0.1, charRel(run, 'merchant') * 0.03));
  return {
    fameDisc,
    faceDisc,
    discount: Math.min(0.35, fameDisc + faceDisc),
  };
}

export function shopPrice(rawPrice, discount) {
  return Math.round(rawPrice * (CONFIG.economy.merchantPriceMult || 1) * (1 - discount));
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
  cons.forEach(c => stock.push({ kind: 'consumable', item: c, price: c.price }));
  if (rng.chance(0.4)) stock.push({ kind: 'consumable', item: CONSUMABLES.find(c => c.appraisal), price: 90 });
  const earlyOrMid = run.floor < 35;
  for (let i = 0; i < 2; i++) {
    const item = rollEquipment(rng, tier, 2, {
      floor: run.floor, run, classId: run.classId, usefulBias: 4,
      requireUseful: earlyOrMid && i === 0,
      slot: (tier === 1 && i === 0) ? 'weapon' : undefined,
    });
    if (item) stock.push({ kind: 'equip', item, price: item.price });
  }
  if (earlyOrMid) {
    const hasUseful = stock.some(s => s.kind === 'equip' && itemUsefulForClass(s.item, run.classId));
    if (!hasUseful) {
      const forced = rollEquipment(rng, Math.max(tier, 2), 3, {
        floor: run.floor, run, classId: run.classId, requireUseful: true, usefulBias: 8,
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
    const r = rollRelic(rng, run.relics);
    if (r) stock.push({ kind: 'relic', item: r, price: 120 + tier * 40 });
  }
  rng.advance();
  return stock;
}

export function applyShopHeal(run, discount) {
  const cost = shopHealCost(run, discount);
  if (run.gold < cost || run.hp >= run.maxHp) return { ok: false, cost };
  run.gold -= cost;
  run.hp = run.maxHp;
  return { ok: true, cost };
}

export function applyShopBuy(run, stock, index, discount, hooks = {}) {
  const s = stock[index];
  if (!s) return { ok: false };
  const p = shopPrice(s.price, discount);
  if (run.gold < p) return { ok: false, price: p };
  run.gold -= p;
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
  stock.splice(index, 1);
  return { ok: true, price: p, listing: s };
}

export function applyShopLeave(run, boughtHere) {
  if (boughtHere) applyWorldPatch(run, { char: { id: 'merchant', met: true, rel: 1, memory: 'bought' } });
}
