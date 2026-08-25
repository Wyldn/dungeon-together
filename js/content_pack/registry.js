// Pack catalog holders. Does not import vanilla items/skills/events
// (those modules call into this file).

import { isPackOn, capabilityEnabled } from './flags.js';

let packItems = [];
let packRelics = [];
let packConsumables = [];
let packSkills = {};
let packEvents = [];

export function registerPackCatalogs({ items = [], relics = [], consumables = [], skills = {}, events = [] } = {}) {
  packItems = items;
  packRelics = relics;
  packConsumables = consumables;
  packSkills = skills;
  packEvents = events;
}

function gated(list) {
  if (!isPackOn()) return [];
  return list.filter(it => !it.capability || capabilityEnabled(it.capability));
}

export function packEquipment() { return gated(packItems).filter(i => i.slot); }
export function packRelicList() { return gated(packRelics); }
export function packConsumableList() { return gated(packConsumables); }
export function packSkillMap() {
  if (!isPackOn()) return {};
  const out = {};
  for (const [id, sk] of Object.entries(packSkills)) {
    if (!sk.capability || capabilityEnabled(sk.capability)) out[id] = sk;
  }
  return out;
}
export function packEventList() {
  if (!isPackOn()) return [];
  return packEvents.filter(ev => !ev.capability || capabilityEnabled(ev.capability));
}

export function packLookup(id) {
  if (!isPackOn() || !id) return null;
  return gated(packItems).find(i => i.id === id)
    || gated(packRelics).find(i => i.id === id)
    || gated(packConsumables).find(i => i.id === id)
    || null;
}

export function packSkillById(id) {
  return packSkillMap()[id] || null;
}

export function rawPackCatalogs() {
  return { items: packItems, relics: packRelics, consumables: packConsumables, skills: packSkills, events: packEvents };
}

export function liveSkill(id, vanilla = null) {
  if (vanilla && vanilla[id]) return vanilla[id];
  return packSkillById(id);
}

export function liveEvents(baseEvents) {
  if (!isPackOn()) return baseEvents;
  return baseEvents.concat(packEventList());
}

export function liveEquipment(base) {
  if (!isPackOn()) return base;
  return base.concat(packEquipment());
}

export function liveRelics(base) {
  if (!isPackOn()) return base;
  return base.concat(packRelicList());
}

export function liveConsumables(base) {
  if (!isPackOn()) return base;
  return base.concat(packConsumableList());
}

export function packItemPool(channel = null) {
  const items = gated(packItems);
  if (!channel) return items;
  return items.filter(i => (i.acquisition || 'event') === channel);
}

export { packItems, packRelics, packConsumables, packSkills, packEvents };
