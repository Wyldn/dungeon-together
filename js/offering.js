// Pack offering / transmutation. Events may let a climber risk an eligible
// belonging, gold, or health. Equipped, unique, WRLD, exclusive, and known
// quest tokens are never silently consumed. Cancel leaves the run untouched.

import { EQUIP_SLOTS, CONSUMABLES, itemById, resolveItem, sellGold, rollEquipment } from './data/items.js';
import { earnGold, spendGold, isHealConsumableId } from './economy.js';
import { biomeTier } from './biome_tier.js';

const QUEST_IDS = new Set([
  'encore_medallion', 'mire_totem', 'pilgrims_cudgel',
]);

const PROTECTED_RARITIES = new Set(['unique', 'wrld', 'legendary']);

export const OFFERING_KINDS = ['pack', 'consumable', 'gold', 'hp'];

export function offeringHint(spec = {}) {
  const risks = spec.hintRisks || ['remake', 'ruin', 'refuse'];
  return `risk a belonging (${risks.join(', ')})`;
}

function catalogId(id) {
  if (!id) return '';
  return String(id).split('__')[0];
}

export function isProtectedItem(run, item, id) {
  if (!item) return true;
  if (item.unique || item.wrld || item.exclusive || item.noAffix && item.rarity === 'unique') return true;
  if (PROTECTED_RARITIES.has(item.rarity)) return true;
  if (QUEST_IDS.has(item.id) || QUEST_IDS.has(catalogId(id || item.id))) return true;
  return false;
}

export function isEquippedId(run, id) {
  if (!id || !run?.equipment) return false;
  return EQUIP_SLOTS.some(slot => run.equipment[slot] === id);
}

export function listEligibleOfferings(run, spec = {}) {
  const kinds = new Set(spec.kinds || OFFERING_KINDS);
  const out = [];
  const goldCost = spec.gold ?? 35;
  const hpCost = spec.hp ?? 12;

  if (kinds.has('pack')) {
    for (let i = 0; i < (run.inventory || []).length; i++) {
      const id = run.inventory[i];
      const item = resolveItem(run, id);
      if (!item?.slot) continue;
      if (isEquippedId(run, id)) continue;
      if (isProtectedItem(run, item, id)) continue;
      out.push({
        kind: 'pack',
        id,
        index: i,
        item,
        label: item.name,
        category: item.slot === 'weapon' ? 'weapon' : 'armor',
        sell: sellGold(item, { from: 'inventory' }),
      });
    }
  }

  if (kinds.has('consumable')) {
    const seen = new Map();
    for (let i = 0; i < (run.consumables || []).length; i++) {
      const id = run.consumables[i];
      if (seen.has(id)) continue;
      const item = itemById(id);
      if (!item || item.slot) continue;
      if (isProtectedItem(run, item, id)) continue;
      seen.set(id, true);
      out.push({
        kind: 'consumable',
        id,
        index: i,
        item,
        label: item.name,
        category: isHealConsumableId(id) ? 'potion' : 'consumable',
        sell: sellGold(item, { from: 'inventory' }),
      });
    }
  }

  if (kinds.has('gold') && (run.gold || 0) >= goldCost) {
    out.push({
      kind: 'gold',
      amount: goldCost,
      label: `${goldCost} gold`,
      category: 'gold',
      sell: goldCost,
    });
  }

  if (kinds.has('hp') && (run.hp || 0) > hpCost) {
    out.push({
      kind: 'hp',
      amount: hpCost,
      label: `${hpCost} HP`,
      category: 'health',
      sell: 0,
    });
  }

  return out;
}

export function hasEligibleOffering(run, spec = {}) {
  return listEligibleOfferings(run, spec).length > 0;
}

/** Headless default: avoid the cheapest pack dump. Prefer a mid offering. */
export function defaultOfferingPick(run, spec = {}) {
  const list = listEligibleOfferings(run, spec);
  if (!list.length) return { kind: 'none' };
  const pack = list.filter(x => x.kind === 'pack');
  if (pack.length >= 2) {
    pack.sort((a, b) => a.sell - b.sell);
    return pack[Math.floor(pack.length / 2)];
  }
  if (pack.length === 1) return pack[0];
  const pots = list.filter(x => x.category === 'potion');
  if (pots.length) return pots[0];
  const gold = list.find(x => x.kind === 'gold');
  if (gold) return gold;
  return list[0];
}

function removeInventoryAt(run, id, index) {
  const inv = run.inventory || [];
  if (index != null && inv[index] === id) {
    inv.splice(index, 1);
  } else {
    const i = inv.indexOf(id);
    if (i > -1) inv.splice(i, 1);
  }
  if (run.gearBag && run.gearBag[id]) delete run.gearBag[id];
}

function removeConsumable(run, id) {
  const i = (run.consumables || []).indexOf(id);
  if (i > -1) run.consumables.splice(i, 1);
  return i > -1;
}

export function consumeOffering(run, pick) {
  if (!pick || pick.kind === 'none') return { ok: true, consumed: false };
  if (pick.kind === 'pack') {
    if (isEquippedId(run, pick.id)) return { ok: false, reason: 'equipped' };
    const item = resolveItem(run, pick.id);
    if (isProtectedItem(run, item, pick.id)) return { ok: false, reason: 'protected' };
    if (!(run.inventory || []).includes(pick.id)) return { ok: false, reason: 'missing' };
    removeInventoryAt(run, pick.id, pick.index);
    return { ok: true, consumed: true, item };
  }
  if (pick.kind === 'consumable') {
    const item = itemById(pick.id);
    if (isProtectedItem(run, item, pick.id)) return { ok: false, reason: 'protected' };
    if (!removeConsumable(run, pick.id)) return { ok: false, reason: 'missing' };
    return { ok: true, consumed: true, item };
  }
  if (pick.kind === 'gold') {
    const amt = pick.amount || 0;
    if ((run.gold || 0) < amt) return { ok: false, reason: 'gold' };
    spendGold(run, amt, 'offering');
    return { ok: true, consumed: true, amount: amt };
  }
  if (pick.kind === 'hp') {
    const amt = pick.amount || 0;
    if ((run.hp || 0) <= amt) return { ok: false, reason: 'hp' };
    run.hp = Math.max(1, run.hp - amt);
    return { ok: true, consumed: true, amount: amt };
  }
  return { ok: false, reason: 'unknown' };
}

export function restoreOffering(run, pick, consumed) {
  if (!consumed?.consumed || !pick) return;
  if (pick.kind === 'pack' && pick.id) {
    run.inventory = run.inventory || [];
    run.inventory.push(pick.id);
    if (pick.item?.instanceId && pick.item.affixes) {
      run.gearBag = run.gearBag || {};
      run.gearBag[pick.id] = pick.item;
    }
  }
  if (pick.kind === 'consumable' && pick.id) {
    run.consumables = run.consumables || [];
    run.consumables.push(pick.id);
  }
  if (pick.kind === 'gold' && consumed.amount) {
    earnGold(run, consumed.amount, 'offering_refund');
  }
  if (pick.kind === 'hp' && consumed.amount) {
    run.hp = Math.min(run.maxHp, run.hp + consumed.amount);
  }
}

const GOLD_RETURN_CAP = 0.7;
const ITEM_SELL_CAP = 0.75;

export function kilnSellCap(inputSell) {
  return Math.max(0, Math.round(inputSell * ITEM_SELL_CAP));
}

export function kilnGoldReturnCap(paid) {
  return Math.max(0, Math.round(paid * GOLD_RETURN_CAP));
}

function pushItem(run, item, lines) {
  if (!item) return;
  if (item.slot) {
    run.inventory = run.inventory || [];
    run.inventory.push(item.id);
    if (item.instanceId && item.affixes) {
      run.gearBag = run.gearBag || {};
      run.gearBag[item.id] = item;
    }
    lines.push({ text: `The kiln returns: ${item.name}.`, cls: 'item' });
  } else {
    run.consumables = run.consumables || [];
    run.consumables.push(item.id);
    lines.push({ text: `The kiln coughs up ${item.name}.`, cls: 'item' });
  }
}

function similarConsumablePick(offered, rng) {
  const cap = (offered?.price || 20) * 1.15;
  const pool = CONSUMABLES.filter(c =>
    c.id !== offered?.id
    && !c.appraisal
    && (c.price || 0) <= cap
    && !c.unique && !c.wrld,
  );
  if (!pool.length) return null;
  return rng.pick(pool);
}

/**
 * Seeded kiln table. Outcomes depend on category, not "cheapest sell value wins."
 * Cheap food is often treated as an insult. Gold never prints a profit.
 */
export function resolveKiln(rng, run, pick, consumed) {
  const lines = [];
  if (!pick || pick.kind === 'none') {
    lines.push({ text: 'The kiln is already warm. It wants a belonging, a coin, or a little blood. You have none of those to spare, and it does not take IOUs from empty hands.', cls: '' });
    return { lines, result: 'empty' };
  }

  const roll = rng.next();

  if (pick.kind === 'gold') {
    const paid = consumed.amount || pick.amount || 0;
    if (roll < 0.42) {
      lines.push({ text: 'The coin goes in. Ash comes out. The kiln keeps no receipts for cowards who feed it money.', cls: 'bad' });
      return { lines, result: 'ruin' };
    }
    if (roll < 0.78) {
      lines.push({ text: 'The gold burns clean. Something in you sits up straighter, as if the kiln filed a compliment.', cls: 'good' });
      return { lines, result: 'blessing', fame: 2, hpPct: 0.08 };
    }
    const back = Math.min(kilnGoldReturnCap(paid), Math.round(paid * (0.45 + rng.next() * 0.25)));
    if (back > 0) earnGold(run, back, 'offering');
    lines.push({ text: `The kiln spits a few coins back, smaller and hotter. +${back} gold`, cls: 'gold' });
    return { lines, result: 'remake', gold: back };
  }

  if (pick.kind === 'hp') {
    if (roll < 0.35) {
      lines.push({ text: 'The kiln takes the blood and gives nothing back but a cleaner scar. You are lighter. The stair is not.', cls: 'bad' });
      return { lines, result: 'ruin' };
    }
    if (roll < 0.7) {
      lines.push({ text: 'Heat walks up your arm and stays. A small, ugly blessing.', cls: 'good' });
      return { lines, result: 'blessing', statUpRandom: 1, hpPct: 0.06 };
    }
    lines.push({ text: 'The kiln drinks, then hums like a forge that remembers your name. Endurance, paid in advance.', cls: 'good' });
    return { lines, result: 'remake', maxHp: 4 };
  }

  const item = consumed.item || pick.item;
  const cheapFood = item && /^farm_/.test(item.id);
  if (cheapFood) {
    if (roll < 0.7) {
      lines.push({ text: `The kiln sniffs ${item.name} and is offended. Lunch is not a sacrifice. It keeps the offering anyway.`, cls: 'bad' });
      return { lines, result: 'ruin', fame: -1 };
    }
    const gold = Math.min(kilnSellCap(sellGold(item, { from: 'inventory' })), rng.int(2, 8));
    if (gold) earnGold(run, gold, 'offering');
    lines.push({ text: `It eats the meal and flicks a few coins at your feet, like a tip for a bad joke. +${gold} gold`, cls: 'gold' });
    return { lines, result: 'refuse', gold };
  }

  if (pick.kind === 'consumable') {
    if (roll < 0.38) {
      lines.push({ text: `${item.name} cracks. The kiln drinks the spill and does not apologize.`, cls: 'bad' });
      return { lines, result: 'ruin' };
    }
    if (roll < 0.78) {
      const next = similarConsumablePick(item, rng);
      if (next) {
        pushItem(run, next, lines);
        return { lines, result: 'remake', item: next };
      }
    }
    lines.push({ text: 'The kiln heats the stopper and returns the same weight in luck. You feel briefly insured.', cls: 'good' });
    return { lines, result: 'blessing', fame: 1, hpPct: 0.05 };
  }

  // pack gear
  if (roll < 0.34) {
    const slag = Math.min(kilnSellCap(sellGold(item, { from: 'inventory' })), Math.round(sellGold(item, { from: 'inventory' }) * 0.4));
    if (slag) earnGold(run, slag, 'offering');
    lines.push({ text: `${item.name} slumps into slag. A few coins survive the melt. +${slag} gold`, cls: 'gold' });
    return { lines, result: 'ruin', gold: slag };
  }
  if (roll < 0.82) {
    const slot = item.slot;
    const next = rollEquipment(rng, biomeTier(run.biomeId), 2, {
      floor: run.floor, run, slot, requireUseful: false,
    });
    if (next && !isProtectedItem(run, next, next.id)) {
      const cap = kilnSellCap(sellGold(item, { from: 'inventory' })) + 12;
      if (sellGold(next, { from: 'loot' }) <= cap) {
        pushItem(run, next, lines);
        return { lines, result: 'remake', item: next };
      }
    }
    const slag = Math.min(kilnSellCap(sellGold(item, { from: 'inventory' })), 12);
    if (slag) earnGold(run, slag, 'offering');
    lines.push({ text: 'The kiln tries a remake, fails the fit, and pays you in cooling coins.', cls: 'gold' });
    return { lines, result: 'refuse', gold: slag };
  }
  lines.push({ text: `${item.name} comes out meaner in the places that count, even if the kiln will not say how.`, cls: 'good' });
  return { lines, result: 'blessing', upgradeWeapon: slotIsWeapon(item), statUpRandom: 1 };
}

function slotIsWeapon(item) {
  return item?.slot === 'weapon';
}

export function applyOfferingOutcome(run, spec, rng, lines = [], hooks = {}) {
  if (!spec) return { ok: true, skipped: true };
  const pick = spec.picked || spec.pick || null;
  if (!pick || pick.kind === 'none') {
    const kiln = resolveKiln(rng, run, { kind: 'none' }, {});
    lines.push(...kiln.lines);
    return { ok: true, empty: true, kiln };
  }
  const livePick = { ...pick };
  if (livePick.kind === 'pack' && livePick.id) {
    livePick.item = livePick.item || resolveItem(run, livePick.id);
  }
  const consumed = consumeOffering(run, livePick);
  if (!consumed.ok) {
    lines.push({ text: 'The kiln does not take what is worn, unique, or already promised elsewhere.', cls: 'bad' });
    return { ok: false, reason: consumed.reason };
  }
  const table = spec.table || 'kiln';
  let kiln = { lines: [], result: 'refuse' };
  if (table === 'kiln') kiln = resolveKiln(rng, run, livePick, consumed);
  lines.push(...(kiln.lines || []));
  return { ok: true, kiln, consumed };
}

export function offeringConversionLegal(inputSell, outputGold, paidGold = 0) {
  if (paidGold > 0) return outputGold <= kilnGoldReturnCap(paidGold);
  return outputGold <= kilnSellCap(inputSell);
}
