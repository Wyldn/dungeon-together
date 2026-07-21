// Pixel-art helpers: sprite/icon HTML builders with graceful fallbacks to the
// original glyph/SVG look when a piece has no art (see js/data/artmap.js).

import { ENEMY_ART, HERO_ART, ITEM_ART, BIOME_BG, RACE_ART, ORIGIN_ART, EVENT_CAT_ART, NPC_ART } from './data/artmap.js';
import { buildHeroSkinArt, defaultAppearanceId } from './data/appearances.js';

const HERO_SKINS = buildHeroSkinArt();

/** Resolve art for a class (+ optional cosmetic skin). */
export function resolveHeroArt(classId, appearanceId = null) {
  const skin = appearanceId || defaultAppearanceId(classId);
  return HERO_SKINS[skin] || HERO_ART[skin] || HERO_ART[classId] || null;
}

export function heroArtKey(classId, appearanceId = null) {
  return appearanceId || defaultAppearanceId(classId) || classId;
}

// Integer scale toward a target display height keeps pixels crisp.
function scaleFor(fh, target) {
  return Math.max(1, Math.round(target / fh));
}

/** Scale from idle height so FX-taller attack strips don't shrink the body. */
function heroAnimScale(pack, animArt, target) {
  const refH = pack?.anims?.idle?.h || pack?.h || animArt.h;
  return scaleFor(refH, target);
}

// Visible ink height inside the frame (many boss sheets are heavily padded).
// Used so bosses fill the ~200px combat box instead of looking tiny in empty canvas.
const BOSS_INK_H = {
  bogmother: 11,
  elderwood: 45,
  lich: 22,
  frost_queen: 59,
  hydra: 23,
  infernal_duke: 75,
  ashen_sovereign: 76,
  heartwood: 82,
  ossuary_king: 78,
  jarl_whitegrave: 72,
  arch_tormentor: 77,
  demon_king: 22, // static fallback sheet; anim path uses animmap inkH
};

const BOSS_CONTENT_TARGET = 176; // aim for this many CSS px of visible character
const BOSS_BOX = 200;            // combat boss sprite box (~min-height)
const BOSS_SCALE_CAP = 14;

function bossScale(a, id) {
  const inkH = a.inkH || BOSS_INK_H[id] || a.h;
  const target = a.bossContent || BOSS_CONTENT_TARGET;
  // Padded sheets: size by ink. Full-frame sheets: grow to fill the box.
  const fromInk = Math.round(target / inkH);
  const fromBox = Math.max(1, Math.ceil(BOSS_BOX / a.h));
  return Math.max(1, Math.min(a.bossScaleCap || BOSS_SCALE_CAP, Math.max(fromInk, fromBox)));
}

// Two-frame (or N-frame) idle strips animate via background-position (CSS .px-sprite).
// Bosses read large on the field; elites mid-size; summons/commons stay compact.
export function enemySpriteHtml(id, { boss = false, elite = false, summon = false, target = null } = {}) {
  // `artId` (set on phase evolve) is looked up the same way as the enemy id.
  const a = ENEMY_ART[id];
  if (!a) return null;
  const frames = a.frames || 2;
  // `target` = max box edge for thumbs (compendium). Fit BOTH width and height
  // inside the box so large gallery/boss sheets don't blow past the viewport.
  let s;
  if (target != null) {
    const box = Math.max(16, +target || 64);
    const fit = Math.min(box / a.w, box / a.h);
    const intS = Math.floor(fit);
    s = intS >= 1 ? intS : Math.max(0.12, fit);
  } else if (boss) {
    s = bossScale(a, id);
  } else {
    s = scaleFor(a.h, summon ? 64 : elite ? 84 : 68);
  }
  const fw = a.w * s, fh = a.h * s;
  const anim = frames > 1 ? '' : 'animation:none;';
  // Thumbs skip combat center-anchor class — it fights the thumb viewport.
  const anchor = (target == null && a.anchor === 'center') ? ' sprite-anchor-center' : '';
  return `<div class="px-sprite${anchor}" style="width:${fw}px;height:${fh}px;--fw:${fw}px;--frames:${frames};background-image:url('${a.f}');background-size:${fw * frames}px ${fh}px;${anim}"></div>`;
}

export function heroSpriteHtml(classId, target = 68, { anim = 'idle', holdLast = false, faceLeft = null, appearanceId = null } = {}) {
  const base = resolveHeroArt(classId, appearanceId) || HERO_ART[classId];
  if (!base) return null;
  // Full anim packs (legacy archer strips) still live on HERO_ART[classId] if present.
  const pack = HERO_ART[classId];
  const a = (anim && pack?.anims?.[anim]) || base;
  const frames = a.frames || 2;
  const s = heroAnimScale(pack || base, a, target);
  const fw = a.w * s, fh = a.h * s;
  const isLoop = anim === 'idle' || anim === 'run' || !pack?.anims?.[anim];
  const flip = faceLeft == null ? !!pack?.faceLeft : !!faceLeft;
  const flipCss = flip ? 'transform:scaleX(-1);' : '';
  const key = heroArtKey(classId, appearanceId);
  if (holdLast && !isLoop) {
    const pos = `calc(-1 * ${fw}px * ${frames - 1})`;
    return `<div class="px-sprite" data-hero="${key}" data-anim="${anim}" style="width:${fw}px;height:${fh}px;--fw:${fw}px;--frames:${frames};background-image:url('${a.f}');background-size:${fw * frames}px ${fh}px;background-position:${pos} 0;animation:none;${flipCss}"></div>`;
  }
  const animCss = isLoop ? '' : 'animation:none;';
  return `<div class="px-sprite" data-hero="${key}" data-anim="${anim || 'idle'}" style="width:${fw}px;height:${fh}px;--fw:${fw}px;--frames:${frames};background-image:url('${a.f}');background-size:${fw * frames}px ${fh}px;${animCss}${flipCss}"></div>`;
}

/** Play a one-shot hero animation on an existing sprite host (fighter-sprite or .px-sprite). */
export function playHeroAnim(hostEl, classId, anim, { target = 68, holdLast = false, faceLeft = null, appearanceId = null } = {}) {
  const pack = HERO_ART[classId];
  if (!pack?.anims?.[anim] || !hostEl) return Promise.resolve();
  const a = pack.anims[anim];
  let spr = hostEl.classList?.contains('px-sprite') ? hostEl : hostEl.querySelector?.('.px-sprite');
  if (!spr) return Promise.resolve();

  const frames = a.frames || 2;
  const s = heroAnimScale(pack, a, target);
  const fw = a.w * s, fh = a.h * s;
  const ms = Math.max(280, Math.round(frames * 70));
  const flip = faceLeft == null ? !!pack.faceLeft : !!faceLeft;

  spr.dataset.anim = anim;
  spr.style.width = `${fw}px`;
  spr.style.height = `${fh}px`;
  spr.style.setProperty('--fw', `${fw}px`);
  spr.style.setProperty('--frames', String(frames));
  spr.style.backgroundImage = `url('${a.f}')`;
  spr.style.backgroundSize = `${fw * frames}px ${fh}px`;
  spr.style.transform = flip ? 'scaleX(-1)' : '';
  spr.style.animation = `px-once ${ms}ms steps(${frames}) forwards`;

  return new Promise(resolve => {
    setTimeout(() => {
      if (holdLast) {
        spr.style.animation = 'none';
        spr.style.backgroundPosition = `calc(-1 * ${fw}px * ${frames - 1}) 0`;
        resolve();
        return;
      }
      // restore idle (prefer cosmetic skin)
      const idle = resolveHeroArt(classId, appearanceId) || pack.anims?.idle || pack;
      const idFrames = idle.frames || 2;
      const is = heroAnimScale(pack, idle, target);
      const ifw = idle.w * is, ifh = idle.h * is;
      spr.dataset.anim = 'idle';
      spr.style.width = `${ifw}px`;
      spr.style.height = `${ifh}px`;
      spr.style.setProperty('--fw', `${ifw}px`);
      spr.style.setProperty('--frames', String(idFrames));
      spr.style.backgroundImage = `url('${idle.f}')`;
      spr.style.backgroundSize = `${ifw * idFrames}px ${ifh}px`;
      spr.style.backgroundPosition = '0 0';
      spr.style.transform = flip ? 'scaleX(-1)' : '';
      spr.style.animation = '';
      resolve();
    }, ms);
  });
}

export function heroHasAnim(classId, anim) {
  return !!HERO_ART[classId]?.anims?.[anim];
}

/** Preferred on-battlefield display height for a hero class. */
export function heroCombatSize(classId, fallback = 68) {
  return HERO_ART[classId]?.combatSize || fallback;
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

export function titleBgUrl() {
  return BIOME_BG.title || null;
}

// pixel-scaled <img> for a race portrait / origin emblem (creation showcase)
export function raceArtHtml(id, target = 220) {
  const f = RACE_ART[id];
  if (!f) return null;
  return `<img class="px-portrait" src="${f}" alt="" style="width:${target}px;height:${target}px;image-rendering:pixelated" />`;
}

export function originArtHtml(id, target = 220) {
  const f = ORIGIN_ART[id];
  if (!f) return null;
  return `<img class="px-portrait" src="${f}" alt="" style="width:${target}px;height:${target}px;image-rendering:pixelated" />`;
}

export function raceIconUrl(id) { return RACE_ART[id] || null; }
export function originIconUrl(id) { return ORIGIN_ART[id] || null; }

// event-category emblem (shown on event card-art instead of the emoji)
export function eventCatIconHtml(category, size = 56) {
  const f = EVENT_CAT_ART[category];
  if (!f) return null;
  return `<img class="px-evicon" src="${f}" style="width:${size}px;height:${size}px" alt="" />`;
}
export function eventCatUrl(category) { return EVENT_CAT_ART[category] || null; }

// Portrait for an event's `npc`. Accepts a string id (merchant portraits) or
// an object `{ art }` from bob-NPC social meets (no portrait URL — return null).
export function npcArtUrl(npc) {
  if (!npc) return null;
  if (typeof npc === 'string') return NPC_ART[npc] || null;
  return null;
}
