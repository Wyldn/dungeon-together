// Static gold / potion catalog for economy audits. Does not simulate climbs.

import { EVENTS } from '../js/data/events.js';
import { ORIGINS } from '../js/data/origins.js';
import { ENEMIES, BOSSES } from '../js/data/enemies.js';
import { CONSUMABLES } from '../js/data/items.js';
import { CONFIG } from '../js/data/config.js';
import { TDC } from '../js/data/tdc.js';
import { HEAL_CONSUMABLE_IDS } from '../js/economy.js';

function walkOutcomes(node, visit, trail = []) {
  if (!node || typeof node !== 'object') return;
  visit(node, trail);
  if (node.success) walkOutcomes(node.success, visit, trail.concat('success'));
  if (node.fail) walkOutcomes(node.fail, visit, trail.concat('fail'));
  if (Array.isArray(node.randomOutcome)) {
    node.randomOutcome.forEach((o, i) => walkOutcomes(o, visit, trail.concat(`rand${i}`)));
  }
  if (node.roll) {
    walkOutcomes(node.roll.success, visit, trail.concat('roll.success'));
    walkOutcomes(node.roll.fail, visit, trail.concat('roll.fail'));
  }
}

function eventGoldPotionRows(ev) {
  const goldGain = [];
  const goldSink = [];
  const potions = [];
  const potionSink = [];
  const choices = ev.choices || [];
  const variants = ev.variants || [];
  const allChoices = [
    ...choices.map(c => ({ ...c, via: 'base' })),
    ...variants.flatMap(v => (v.choices || []).map(c => ({ ...c, via: v.id }))),
  ];
  for (const c of allChoices) {
    walkOutcomes(c.outcome, (o) => {
      if (typeof o.gold === 'number' && o.gold > 0) goldGain.push({ choice: c.label, gold: o.gold, via: c.via });
      if (typeof o.gold === 'number' && o.gold < 0) goldSink.push({ choice: c.label, gold: o.gold, via: c.via, req: c.req?.gold });
      if (typeof o.goldPct === 'number' && o.goldPct < 0) goldSink.push({ choice: c.label, goldPct: o.goldPct, via: c.via });
      for (const key of ['consumable', 'consumable2']) {
        if (o[key] && HEAL_CONSUMABLE_IDS.has(o[key])) potions.push({ choice: c.label, id: o[key], via: c.via });
      }
      if (o.useItem && HEAL_CONSUMABLE_IDS.has(o.useItem)) potionSink.push({ choice: c.label, id: o.useItem, via: c.via });
      if (o.chest) goldGain.push({ choice: c.label, gold: 'chest(30+4f+0-25)', via: c.via });
      if (o.offering) goldSink.push({ choice: c.label, offering: true, via: c.via });
    });
  }
  return { goldGain, goldSink, potions, potionSink };
}

export function catalogEconomy() {
  const events = EVENTS.map(ev => ({
    id: ev.id,
    biome: ev.biome,
    category: ev.category,
    w: ev.w,
    once: !!ev.once,
    family: ev.family || null,
    thread: ev.thread || null,
    when: ev.when || null,
    ...eventGoldPotionRows(ev),
  }));
  const origins = ORIGINS.map(o => ({ id: o.id, ...eventGoldPotionRows(o) }));
  const enemies = {};
  for (const [biome, list] of Object.entries(ENEMIES)) {
    enemies[biome] = (list || []).map(e => ({
      id: e.id, gold: e.gold, elite: !!e.elite, pack: !!e.pack,
    }));
  }
  const bosses = Object.entries(BOSSES).map(([floor, b]) => ({
    floor: Number(floor), id: b.id, gold: b.gold,
  }));
  return {
    combatGoldMult: CONFIG.economy.combatGoldMult,
    goldFloorFactor: TDC.rewards.goldFloorFactor,
    merchantWeightBonus: CONFIG.economy.merchantWeightBonus,
    merchantPriceMult: CONFIG.economy.merchantPriceMult,
    shopRestockCost: CONFIG.economy.shopRestockCost,
    startGold: 30,
    startPotion: 'potion_s',
    healConsumables: [...HEAL_CONSUMABLE_IDS],
    consumablePrices: CONSUMABLES.map(c => ({ id: c.id, price: c.price, heal: !!(c.heal || c.healPct) })),
    events,
    origins,
    enemies,
    bosses,
    eventGoldGains: events.filter(e => e.goldGain.length),
    eventGoldSinks: events.filter(e => e.goldSink.length),
    eventPotionGains: events.filter(e => e.potions.length),
    eventPotionSinks: events.filter(e => e.potionSink.length),
  };
}

export function summarizeCatalog(cat = catalogEconomy()) {
  const sinkGold = cat.eventGoldSinks.flatMap(e => e.goldSink.map(s => s.gold).filter(g => typeof g === 'number'));
  const gainGold = cat.eventGoldGains.flatMap(e => e.goldGain.map(s => s.gold).filter(g => typeof g === 'number'));
  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  return {
    events: cat.events.length,
    eventGoldGainCards: cat.eventGoldGains.length,
    eventGoldSinkCards: cat.eventGoldSinks.length,
    eventPotionGainCards: cat.eventPotionGains.length,
    meanAuthoredGoldGain: Math.round(avg(gainGold)),
    meanAuthoredGoldSink: Math.round(avg(sinkGold.map(Math.abs))),
    combatGoldMult: cat.combatGoldMult,
    goldFloorFactor: cat.goldFloorFactor,
  };
}
