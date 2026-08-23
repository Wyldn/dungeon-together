/** Rough power score for loot / autoplay decisions. Shared by live game and V2 policy. */
export function gearScore(item) {
  if (!item) return -1;
  const rarity = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, unique: 6, wrld: 7 };
  let s = (rarity[item.rarity] || 1) * 25 + (item.tier || 1) * 4;
  const weights = {
    atk: 3, def: 2.5, hp: 0.15, mp: 0.12, str: 2, dex: 2, int: 2, wis: 2,
    crit: 0.8, initiative: 2, dodge: 0.5,
  };
  for (const [k, w] of Object.entries(weights)) {
    if (typeof item[k] === 'number') s += item[k] * w;
  }
  for (const k of ['burn', 'freeze', 'poison', 'lifesteal', 'weaken', 'frail', 'tormented']) {
    if (typeof item[k] === 'number') s += item[k] * 30;
  }
  if (item.price) s += item.price * 0.01;
  return s;
}

export function skillAutoScore(sk) {
  if (!sk) return -1;
  return (sk.tier || 1) * 12 + (sk.power || 0) * 0.55 + (sk.charge ? 6 : 0)
    + (sk.healPct || 0) * 45 + (sk.target === 'all' ? 8 : 0);
}
