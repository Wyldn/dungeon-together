// Multi-state sprite player. Enemies AND player classes with an animation entry
// render an animated sprite whose state follows combat events: idle loops, an
// attack/hurt plays once and falls back to idle, death plays once and holds the
// last frame.
//
// State lives here (keyed by combatant uid), NOT in the DOM — the combat screen
// rebuilds .enemy-row / .player-row innerHTML constantly, so we re-bind to the
// fresh element on every attach() and keep animating without a hitch.
//
// Monsters and heroes are authored in separate maps (different packs, different
// pipelines) but play identically, so they share one lookup here. Keys are
// unique across both — a hero set is keyed by class id.

import { ENEMY_ANIM, HERO_ANIM } from './data/animmap.js';

const SETS = { ...ENEMY_ANIM, ...HERO_ANIM };

export function hasAnim(mon) { return !!SETS[mon]; }

function scaleFor(set) { return Math.max(1, Math.round((set.disp || set.fh) / set.fh)); }

// HTML for an animated sprite. `uid` ties it to a combatant; `mon` is the sprite
// set key (an enemy's `sprite` override or its `id`). Falls back to null so the
// caller can use the old glyph/px-sprite path.
export function animSpriteHtml(uid, mon, { boss = false, dead = false } = {}) {
  const set = SETS[mon];
  if (!set) return null;
  const s = scaleFor(set);
  // `ox` is how far the idle body sits from its canvas centre (the canvas is
  // sized to fit the widest attack, so it's lopsided). Shift it back so the
  // character stays centred under its own name/HP bar.
  // `flip` mirrors player-facing packs (left) for the enemy side (right).
  const xf = [];
  if (set.flip) xf.push('scaleX(-1)');
  if (set.ox) xf.push(`translateX(${-(set.flip ? -set.ox : set.ox) * s}px)`);
  const shift = xf.length ? ` transform:${xf.join(' ')};` : '';
  return `<div class="anim-sprite${boss ? ' anim-boss' : ''}" data-uid="${uid}" data-mon="${mon}"`
    + `${dead ? ' data-dead="1"' : ''} style="width:${set.fw * s}px;height:${set.fh * s}px;${shift}"></div>`;
}

const recs = new Map();   // uid -> record
let rafId = 0;

function ensureLoop() {
  if (rafId) return;
  let last = performance.now();
  const step = (now) => {
    const dt = Math.min(100, now - last); last = now;
    for (const rec of recs.values()) advance(rec, dt);
    rafId = recs.size ? requestAnimationFrame(step) : 0;
  };
  rafId = requestAnimationFrame(step);
}

function stateOf(rec, name) { return SETS[rec.mon]?.states[name] || null; }
function role(rec, r) { return SETS[rec.mon]?.roles[r] || null; }

// mode: 'loop' (idle) | 'idle' (once, then back to idle) | 'hold' (once, freeze last)
function setState(rec, name, mode) {
  const st = stateOf(rec, name);
  if (!st) return;
  rec.state = name; rec.st = st; rec.mode = mode; rec.frame = 0; rec.acc = 0;
  paint(rec, true);
}

function paint(rec, full) {
  const el = rec.el;
  if (!el || !el.isConnected) return;
  const set = SETS[rec.mon]; const s = rec.scale;
  if (full) {
    el.style.backgroundImage = `url('${rec.st.f}')`;
    el.style.backgroundSize = `${set.fw * s * rec.st.n}px ${set.fh * s}px`;
  }
  el.style.backgroundPositionX = `-${rec.frame * set.fw * s}px`;
}

function advance(rec, dt) {
  if (!rec.st) return;
  rec.acc += dt;
  const frameMs = 1000 / (rec.st.fps || 12);
  let moved = false;
  while (rec.acc >= frameMs) {
    rec.acc -= frameMs;
    if (rec.frame + 1 >= rec.st.n) {
      if (rec.mode === 'loop') { rec.frame = 0; moved = true; }
      else if (rec.mode === 'hold') { rec.frame = rec.st.n - 1; moved = true; rec.st = null; break; }
      else { // once -> return to idle
        setState(rec, role(rec, 'idle') || 'idle', 'loop');
        return;
      }
    } else { rec.frame++; moved = true; }
  }
  if (moved) paint(rec, false);
}

// Play a semantic role for a combatant: 'attack' | 'special' | 'hurt'.
// idle/death/intro are driven by attach(); dead sprites ignore everything.
export function play(uid, r) {
  const rec = recs.get(uid);
  if (!rec || rec.dead) return;
  const name = role(rec, r);
  if (!name) return;
  setState(rec, name, 'idle');
}

// (Re)bind every .anim-sprite under `root` to its record and keep it animating.
// data-dead="1" on the node triggers the death state (played once, then held).
export function attach(root) {
  if (!root) return;
  for (const el of root.querySelectorAll('.anim-sprite')) {
    const uid = el.dataset.uid, mon = el.dataset.mon;
    if (!uid || !SETS[mon]) continue;
    let rec = recs.get(uid);
    if (!rec || rec.mon !== mon) {
      // brand-new combatant (or a sprite swap, e.g. slime -> king): fresh record
      rec = { uid, mon, el, scale: scaleFor(SETS[mon]), frame: 0, acc: 0,
        introDone: false, dead: false, st: null };
      recs.set(uid, rec);
      const intro = role(rec, 'intro');
      if (intro && !el.dataset.dead) { rec.introDone = true; setState(rec, intro, 'idle'); }
      else setState(rec, role(rec, 'idle') || 'idle', 'loop');
    } else {
      rec.el = el; rec.scale = scaleFor(SETS[mon]);
      paint(rec, true); // rebind to the fresh DOM node
    }
    if (el.dataset.dead && !rec.dead) { rec.dead = true; setState(rec, role(rec, 'death') || 'death', 'hold'); }
  }
  ensureLoop();
}

// New fight — drop all state. (A live sprite swap, e.g. Demon King phase 1 -> 2,
// needs no special call: changing data-mon makes the next attach() rebuild it.)
export function reset() {
  recs.clear();
  if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
}
