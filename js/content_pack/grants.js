// Classify and grant catalog entries (equipment / relic / consumable / skill).
// Used by authoritative event outcomes so relics are not stuffed into potions.

import { noteDiscovery } from '../compendium_seen.js';
import {
  claimedWrldIds, markWrldClaimed, ownedGearIds, itemById,
} from '../data/items.js';
import { skillById } from '../data/skills.js';
import { isCursedItem } from './curse.js';
import { packGet, packSet } from './state.js';
import {
  packCampfireConsumablePool, packRelicChannelPool, pickWeighted,
} from './acquisition.js';
import { isPackOn } from './flags.js';
import { packEquipment, packRelicList } from './registry.js';

export function classifyGrant(item) {
  if (!item) return null;
  if (item.slot) return 'equip';
  if (item.heal != null || item.healPct != null || item.healPerFloor != null
    || item.bombDmg != null || item.mana != null || item.cure
    || item.shopMaxTier != null) {
    return 'consumable';
  }
  return 'relic';
}

function isWrld(item) {
  return !!(item && (item.rarity === 'wrld' || item.wrld));
}

function isUnique(item) {
  return !!(item && (item.rarity === 'unique' || item.unique));
}

function alreadyHolds(run, item) {
  if (!run || !item?.id) return false;
  if ((run.relics || []).includes(item.id)) return true;
  if (ownedGearIds(run).has(item.id)) return true;
  if ((run.consumables || []).includes(item.id) && (isUnique(item) || isWrld(item))) return true;
  return false;
}

export function bindCurseOwnership(run, item) {
  if (!run || !isCursedItem(item) || !item.id) return;
  packSet(run, 'run', `curseHeld:${item.id}`, 1);
  run.flags = run.flags || {};
  run.flags[`curseHeld:${item.id}`] = true;
}

export function curseIsResolved(run, item) {
  if (!item) return false;
  return !!(
    packGet(run, 'run', `curseResolved:${item.id}`)
    || (item.curse && packGet(run, 'run', `curseResolved:${item.curse}`))
  );
}

function itemsMatchingCurseRef(itemOrId) {
  if (!itemOrId) return [];
  if (typeof itemOrId !== 'string') return itemOrId.id ? [itemOrId] : [];
  const direct = itemById(itemOrId);
  if (direct) return [direct];
  const out = [];
  for (const it of [...packEquipment(), ...packRelicList()]) {
    if (it.curse === itemOrId) out.push(it);
  }
  return out;
}

export function resolveCurseOnRun(run, itemOrId, lines = []) {
  if (!run) return false;
  const items = itemsMatchingCurseRef(itemOrId);
  if (!items.length) return false;
  let any = false;
  for (const item of items) {
    packSet(run, 'run', `curseResolved:${item.id}`, 1);
    if (item.curse) packSet(run, 'run', `curseResolved:${item.curse}`, 1);
    noteDiscovery(item.id);
    lines.push({ text: `The curse on ${item.name} lifts.`, cls: 'good' });
    any = true;
  }
  return any;
}

export function resolveCampfireCurses(run, lines = []) {
  if (!run) return false;
  let any = false;
  const held = [...Object.values(run.equipment || {}), ...(run.inventory || [])];
  for (const id of held) {
    const item = itemById(id, run.gearBag);
    if (item?.curse === 'remember_damage') {
      if (resolveCurseOnRun(run, item, lines)) any = true;
    }
  }
  return any;
}

export function cursedSellBlocked(run, item) {
  return !!(isCursedItem(item) && !curseIsResolved(run, item));
}

export async function grantCatalogItem(run, item, lines = [], { onEquip, coop } = {}) {
  if (!run || !item) return null;
  if (isWrld(item)) {
    const claimed = claimedWrldIds(run, coop);
    if (claimed.has(item.id) || alreadyHolds(run, item)) {
      lines.push({ text: 'The WRLD you sought has already been claimed — one of each exists in this climb.', cls: 'bad' });
      return null;
    }
    markWrldClaimed(run, item.id, coop);
  } else if (isUnique(item) && alreadyHolds(run, item)) {
    lines.push({ text: `${item.name} refuses a second owner on this climber.`, cls: 'bad' });
    return null;
  }
  if (item.id) noteDiscovery(item.id);
  bindCurseOwnership(run, item);
  const kind = classifyGrant(item);
  if (kind === 'equip') {
    if (onEquip) await onEquip(item, lines);
    else {
      run.inventory = run.inventory || [];
      run.inventory.push(item.id);
      if (item.instanceId && item.affixes) {
        if (!run.gearBag) run.gearBag = {};
        run.gearBag[item.id] = item;
      }
      lines.push({ text: `Found: ${item.name}`, cls: 'item' });
    }
    return kind;
  }
  if (kind === 'consumable') {
    run.consumables = run.consumables || [];
    if ((isUnique(item) || isWrld(item)) && run.consumables.includes(item.id)) {
      lines.push({ text: `${item.name} cannot be stacked.`, cls: 'bad' });
      return null;
    }
    run.consumables.push(item.id);
    lines.push({ text: `Received: ${item.name}`, cls: 'item' });
    return kind;
  }
  run.relics = run.relics || [];
  if (!run.relics.includes(item.id)) run.relics.push(item.id);
  lines.push({ text: `Relic: ${item.name} — ${item.desc}`, cls: 'item' });
  return kind;
}

export function grantPackSkill(run, skillId, lines = []) {
  const sk = skillById(skillId);
  if (!run || !sk) return false;
  noteDiscovery(skillId);
  if (sk.bloodline || sk.capability === 'bloodline_art') {
    run.arts = run.arts || [];
    if (!run.arts.includes(skillId)) run.arts.push(skillId);
  }
  if (!run.knownSkills.includes(skillId)) run.knownSkills.push(skillId);
  lines.push({ text: `Technique learned: ${sk.name} — ${sk.desc}`, cls: 'item' });
  return true;
}

export async function maybeCampfirePackFind(run, rng, lines, onItem) {
  if (!isPackOn() || !run) return null;
  resolveCampfireCurses(run, lines);
  if (!rng) return null;
  if (rng.chance(0.38)) {
    const c = pickWeighted(rng, packCampfireConsumablePool());
    if (c) {
      run.consumables = run.consumables || [];
      run.consumables.push(c.id);
      noteDiscovery(c.id);
      lines.push({ text: `By the fire: ${c.name}.`, cls: 'item' });
      return c;
    }
  }
  if (rng.chance(0.16)) {
    const r = pickWeighted(rng, packRelicChannelPool().filter(x => !(run.relics || []).includes(x.id)));
    if (r) {
      run.relics = run.relics || [];
      run.relics.push(r.id);
      noteDiscovery(r.id);
      lines.push({ text: `Relic in the embers: ${r.name}.`, cls: 'item' });
      return r;
    }
  }
  return null;
}
