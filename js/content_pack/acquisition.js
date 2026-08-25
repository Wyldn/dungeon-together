// Acquisition channels. Ordinary loot never receives the full pack catalog.

export const CHANNEL = Object.freeze({
  ordinary: 'ordinary',
  class: 'class',
  bloodline: 'bloodline',
  event: 'event',
  cursed: 'cursed',
  boss: 'boss',
  unique: 'unique',
  wrld: 'wrld',
});

export function inOrdinaryLoot(item) {
  return !!(item && item.packOrdinary && (item.acquisition || 'ordinary') === 'ordinary' && !item.exclusive);
}

export function shopEligiblePack(item, tier = 1) {
  if (!item || item.exclusive || item.quest) return false;
  if (item.shopMaxTier != null && tier > item.shopMaxTier) return false;
  return item.packOrdinary && item.acquisition === 'ordinary';
}
