// Catalog registration only. Safe to import from items/events/skills.
// Must not import engine, character, combat, or vanilla catalogs.

import { registerPackCatalogs } from './registry.js';
import { PACK_WEAPONS } from './catalogs/weapons.js';
import { PACK_WEAPONS_RESONANT, PACK_WEAPONS_CURSED } from './catalogs/weapons_more.js';
import {
  PACK_ARMOR_SETS, PACK_ARMOR_BLOODLINE, PACK_ARMOR_FOUNDATION, PACK_ARMOR_CURSED,
} from './catalogs/armor.js';
import { PACK_RELICS } from './catalogs/relics.js';
import { PACK_CONSUMABLES } from './catalogs/consumables.js';
import { PACK_SKILLS } from './catalogs/skills.js';
import { PACK_EVENTS } from './catalogs/events_class_coop.js';

function effectsOps(it) {
  const ops = new Set();
  for (const ef of it.effects || []) if (ef.op) ops.add(ef.op);
  if (it.setBonus) {
    for (const list of Object.values(it.setBonus)) {
      for (const ef of list || []) if (ef.op) ops.add(ef.op);
    }
  }
  return ops;
}

export function inferItemCapability(it) {
  if (it.capability) return it.capability;
  if (it.curse) return 'curse';
  if (it.resonance) return 'bloodline_resonance';
  if (it.setId) return 'armor_set';
  if (it.classBound || it.acquisition === 'class') return 'class_gear';
  if (it.acquisition === 'bloodline') return 'bloodline_resonance';
  if (it.acquisition === 'cursed') return 'curse';
  if (it.packOrdinary || it.acquisition === 'ordinary') return 'simple_stat';
  const ops = effectsOps(it);
  if (ops.has('echoAction') || ops.has('copySupport')) return 'echo_copy';
  if (ops.has('summonAlly') || ops.has('storeArchetype')) return 'summon';
  if (ops.has('lethalWard') || ops.has('contestLethal')) return 'curse';
  if (ops.has('evolveItem') || ops.has('crackItem')) return 'evolution';
  if (ops.has('spendGoldPower') || ops.has('spendFamePower')) return 'fame_gold_power';
  if (ops.has('borrowTechnique')) return 'technique_borrow';
  if (it.rarity === 'common' || it.rarity === 'uncommon') return 'simple_hook';
  if (it.acquisition === 'event' || it.quest) return 'event_linked_acquire';
  return 'simple_hook';
}

function stamp(list) {
  for (const it of list) it.capability = inferItemCapability(it);
  return list;
}

registerPackCatalogs({
  items: stamp([
    ...PACK_WEAPONS,
    ...PACK_WEAPONS_RESONANT,
    ...PACK_WEAPONS_CURSED,
    ...PACK_ARMOR_SETS,
    ...PACK_ARMOR_BLOODLINE,
    ...PACK_ARMOR_FOUNDATION,
    ...PACK_ARMOR_CURSED,
  ]),
  relics: stamp(PACK_RELICS),
  consumables: stamp(PACK_CONSUMABLES),
  skills: PACK_SKILLS,
  events: PACK_EVENTS,
});
