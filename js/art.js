// Pixel-art helpers: sprite/icon HTML builders with graceful fallbacks to the
// original glyph/SVG look when a piece has no art (see js/data/artmap.js).

import { ENEMY_ART, HERO_ART, ITEM_ART, BIOME_BG, RACE_ART, ORIGIN_ART, EVENT_CAT_ART, NPC_ART } from './data/artmap.js';

// Integer scale toward a target display height keeps pixels crisp.
function scaleFor(fh, target) {
  return Math.max(1, Math.round(target / fh));
}

// Two-frame (or N-frame) idle strips animate via background-position (CSS .px-sprite).
// Bosses read large on the field; elites mid-size; summons/commons stay compact.
export function enemySpriteHtml(id, { boss = false, elite = false, summon = false } = {}) {
  // `artId` (set on phase evolve) is looked up the same way as the enemy id.
  const a = ENEMY_ART[id];
  if (!a) return null;
  const frames = a.frames || 2;
  const target = boss ? 168 : summon ? 64 : elite ? 84 : 68;
  const s = scaleFor(a.h, target);
  const fw = a.w * s, fh = a.h * s;
  const anim = frames > 1 ? '' : 'animation:none;';
  return `<div class="px-sprite" style="width:${fw}px;height:${fh}px;--fw:${fw}px;--frames:${frames};background-image:url('${a.f}');background-size:${fw * frames}px ${fh}px;${anim}"></div>`;
}

export function heroSpriteHtml(classId, target = 68) {
  const a = HERO_ART[classId];
  if (!a) return null;
  const frames = a.frames || 2;
  const s = scaleFor(a.h, target);
  const fw = a.w * s, fh = a.h * s;
  return `<div class="px-sprite" style="width:${fw}px;height:${fh}px;--fw:${fw}px;--frames:${frames};background-image:url('${a.f}');background-size:${fw * frames}px ${fh}px"></div>`;
}

export function itemIconHtml(id, size = 34) {
  // Affixed instances use `${baseId}__hex` — art is keyed by catalog id.
  const base = typeof id === 'string' && id.includes('__') ? id.split('__')[0] : id;
  const f = ITEM_ART[base] || ITEM_ART[id];
  if (!f) return '';
  return `<img class="px-icon" src="${f}" style="width:${size}px;height:${size}px" alt="" />`;
}

export function biomeBgUrl(biomeId) {
  return BIOME_BG[biomeId] || null;
}

export function travelMapBgUrl() {
  return BIOME_BG.travelmap || null;
}

// pixel-scaled <img> for a race portrait / origin emblem (creation showcase)
export function raceArtHtml(raceId, size = 150) {
  const f = RACE_ART[raceId];
  if (!f) return null;
  return `<img class="px-portrait" src="${f}" style="width:${size}px;height:${size}px" alt="" />`;
}

export function originArtHtml(originId, size = 130) {
  const f = ORIGIN_ART[originId];
  if (!f) return null;
  return `<img class="px-portrait" src="${f}" style="width:${size}px;height:${size}px" alt="" />`;
}

export function raceIconUrl(raceId) { return RACE_ART[raceId] || null; }
export function originIconUrl(originId) { return ORIGIN_ART[originId] || null; }

// event-category emblem (shown on event card-art instead of the emoji)
export function eventCatIconHtml(category, size = 56) {
  const f = EVENT_CAT_ART[category];
  if (!f) return null;
  return `<img class="px-evicon" src="${f}" style="width:${size}px;height:${size}px" alt="" />`;
}
export function eventCatUrl(category) { return EVENT_CAT_ART[category] || null; }

// Portrait for an event's `npc` — the face you're actually dealing with, shown
// instead of the generic category emblem. Null for events without one.
export function npcArtUrl(npcId) { return (npcId && NPC_ART[npcId]) || null; }

export function titleBgUrl() {
  return BIOME_BG.title || null;
}
