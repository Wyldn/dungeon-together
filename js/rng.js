// Seeded RNG (mulberry32) — every run generates a shareable seed so friends
// can race the exact same tower.

export function makeRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    // integer in [min, max] inclusive
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    // true with probability p (0..1)
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    shuffle(arr) {
      const a2 = [...arr];
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    },
    // weighted pick from [{w: number, ...}, ...]
    weighted(items) {
      const total = items.reduce((s, it) => s + it.w, 0);
      let r = next() * total;
      for (const it of items) { r -= it.w; if (r <= 0) return it; }
      return items[items.length - 1];
    },
  };
}

export function randomSeed() {
  return Math.floor(Math.random() * 0xFFFFFFFF);
}
