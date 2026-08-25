// Classify and grant catalog entries (equipment / relic / consumable / skill).
// Used by authoritative event outcomes so relics are not stuffed into potions.

import { noteDiscovery } from '../compendium_seen.js';

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

export async function grantCatalogItem(run, item, lines = [], { onEquip } = {}) {
  if (!run || !item) return null;
  if (item.id) noteDiscovery(item.id);
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
    run.consumables.push(item.id);
    lines.push({ text: `Received: ${item.name}`, cls: 'item' });
    return kind;
  }
  run.relics = run.relics || [];
  if (!run.relics.includes(item.id)) run.relics.push(item.id);
  lines.push({ text: `Relic: ${item.name} — ${item.desc}`, cls: 'item' });
  return kind;
}
