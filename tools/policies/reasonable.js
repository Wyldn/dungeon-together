// Stronger climb policy for comparison against baseline.
// Same isolated path RNG (seed ^ floor ^ 0xA11CE). Never the climb rng.
// Buys useful gear, heals earlier, and avoids fights when already dying.

import { makeRng } from '../../js/rng.js';
import { reqMet } from '../../js/requirements.js';
import { gearScore } from '../../js/loot_score.js';
import { itemById, itemUsefulForClass } from '../../js/data/items.js';
import { encounterOptions } from '../../js/encounter.js';
import { shopHealCost, shopPrice } from '../../js/shop.js';
import { broadFamily } from '../../js/data/floorcards.js';
import { baselinePolicy } from './baseline.js';

function pathRng(run) {
  return makeRng((run.seed ^ run.floor ^ 0xA11CE) >>> 0);
}

function hpRatio(run) {
  return run.hp / Math.max(1, run.maxHp);
}

function scoreEventChoice(run, choice) {
  const t = `${choice.label || ''} ${choice.hint || ''}`.toLowerCase();
  const hp = hpRatio(run);
  let s = 10;
  if (/leave|move on|walk away|nothing/.test(t)) s -= hp < 0.45 ? 2 : 9;
  if (/gold|relic|heal|rest|sleep|train|loot|reward|potion/.test(t)) s += 6;
  if (/sneak|bribe|meditate|pray|offer/.test(t)) s += 2;
  if (hp < 0.45) {
    if (/heal|rest|sleep|mend|bandage|potion/.test(t)) s += 14;
    if (/fight|attack|challenge|ambush|blood|gamble|risk/.test(t)) s -= 12;
  }
  return s;
}

function cardScore(run, card) {
  const hp = hpRatio(run);
  const family = broadFamily(card);
  let s = 0;
  if (hp < 0.4) {
    if (family === 'rest' || family === 'shop') s += 40;
    if (family === 'combat') s -= 25;
  } else if (hp < 0.6) {
    if (family === 'rest' || family === 'shop') s += 16;
    if (family === 'combat') s -= 6;
  } else {
    if (family === 'combat') s += 8;
    if (family === 'shop' && run.gold >= 80) s += 10;
  }
  if (family === 'narrative') s += 3;
  if (family === 'rest' && hp < 0.85) s += 4;
  return s;
}

function currentGear(run, item) {
  if (!item?.slot) return null;
  if (item.slot === 'accessory') return null;
  const id = run.equipment?.[item.slot];
  return id ? itemById(id) : null;
}

export function reasonablePolicy(opts = {}) {
  const base = baselinePolicy();
  return {
    ...base,
    name: 'reasonable',
    chooseFloorCard(run, cards) {
      const scored = cards.map(c => ({ c, s: cardScore(run, c) }));
      const best = Math.max(...scored.map(x => x.s));
      const top = scored.filter(x => x.s === best).map(x => x.c);
      if (top.length === 1) return top[0];
      return pathRng(run).pick(top);
    },
    chooseEncounterApproach(run, group) {
      const o = encounterOptions(run, group);
      const hp = hpRatio(run);
      if (o.canBribe && hp < 0.5) return 'bribe';
      if (hp < 0.65) return 'sneak';
      if ((group || []).length >= 3 && hp < 0.8) return 'sneak';
      return 'fight';
    },
    chooseEvent(run, ev, choices) {
      const ok = choices.filter(c => reqMet(run, c.req).ok);
      const pool = ok.length ? ok : choices;
      return pool.reduce((best, c) => (
        scoreEventChoice(run, c) > scoreEventChoice(run, best) ? c : best
      ), pool[0]);
    },
    chooseShopAction(run, stock, { discount }) {
      const hp = hpRatio(run);
      if (hp < 0.72 && run.hp < run.maxHp) {
        const cost = shopHealCost(run, discount);
        if (run.gold >= cost) return { act: 'heal' };
      }
      for (let i = 0; i < stock.length; i++) {
        const s = stock[i];
        if (s.kind !== 'consumable') continue;
        const p = shopPrice(s.price, discount);
        if (run.gold < p) continue;
        if ((s.item.heal || s.item.healPct) && (run.consumables || []).length < 4) {
          return { act: 'buy', i };
        }
      }
      let bestI = -1;
      let bestDelta = 2;
      for (let i = 0; i < stock.length; i++) {
        const s = stock[i];
        const p = shopPrice(s.price, discount);
        if (run.gold < p) continue;
        if (s.kind === 'relic') {
          if (8 > bestDelta) { bestDelta = 8; bestI = i; }
          continue;
        }
        if (s.kind !== 'equip' || !s.item) continue;
        const useful = itemUsefulForClass(s.item, run.classId);
        const cur = currentGear(run, s.item);
        const delta = gearScore(s.item) - (cur ? gearScore(cur) : 0) + (useful ? 4 : -6);
        if (delta > bestDelta) { bestDelta = delta; bestI = i; }
      }
      if (bestI >= 0) return { act: 'buy', i: bestI };
      return { act: 'leave' };
    },
    ...opts,
  };
}
