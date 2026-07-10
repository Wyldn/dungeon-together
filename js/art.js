// Pixel-art helpers: sprite/icon HTML builders with graceful fallbacks to the
// original glyph/SVG look when a piece has no art (see js/data/artmap.js).

import { ENEMY_ART, HERO_ART, ITEM_ART, BIOME_BG } from './data/artmap.js';

// Integer scale toward a target display height keeps pixels crisp.
function scaleFor(fh, target) {
  return Math.max(1, Math.round(target / fh));
}

// Two-frame idle strips animate via background-position (CSS .px-sprite).
export function enemySpriteHtml(id, { boss = false, elite = false } = {}) {
  const a = ENEMY_ART[id];
  if (!a) return null;
  const s = scaleFor(a.h, boss ? 108 : elite ? 84 : 68);
  return `<div class="px-sprite" style="width:${a.w * s}px;height:${a.h * s}px;background-image:url('${a.f}')"></div>`;
}

export function heroSpriteHtml(classId, target = 68) {
  const a = HERO_ART[classId];
  if (!a) return null;
  const s = scaleFor(a.h, target);
  return `<div class="px-sprite" style="width:${a.w * s}px;height:${a.h * s}px;background-image:url('${a.f}')"></div>`;
}

export function itemIconHtml(id, size = 34) {
  const f = ITEM_ART[id];
  if (!f) return '';
  return `<img class="px-icon" src="${f}" style="width:${size}px;height:${size}px" alt="" />`;
}

export function biomeBgUrl(biomeId) {
  return BIOME_BG[biomeId] || null;
}

export function titleBgUrl() {
  return BIOME_BG.title || null;
}
