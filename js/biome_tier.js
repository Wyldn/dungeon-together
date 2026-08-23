export function biomeTier(biomeId) {
  return { forest: 1, ruins: 2, frost: 3, swamp: 4, hell: 5, throne: 5 }[biomeId] || 1;
}
