// Event Travel Map (handoff §6) — the node-based path chooser that REPLACES
// the face-down 3-card draw's presentation. It's a *view* over the same `cards`
// array generateCards() produces; picking a node calls the same resolveCard().
// Co-op vote/lock contract is preserved verbatim (picks / renderVotes / bind).

import { CATEGORY_META, EVENTS } from './data/events.js';
import { travelMapBgUrl, eventCatUrl, enemySpriteHtml } from './art.js';
import { findEnemySpec } from './data/enemies.js';
import { makeRng } from './rng.js';

// module-persistent trail + layout across floors
const trail = { history: [], layout: 'A' };
export function resetTravelTrail() { trail.history = []; }

// Faint "further ahead" teasers — branch sideways off a path, always shooting
// further up the map (never back down toward you). ~20% of paths have no hint.
// A hinted pick forces that category into the next floor's choices.
const HINT_POOL = ['combat', 'merchant', 'mystery', 'recovery', 'dangerous', 'training', 'equipment', 'social'];
const HINT_NONE_CHANCE = 0.20;

function assignPathHints(run, cards) {
  // Seed from run identity + floor only — never advance run.rngState.
  const rng = makeRng(((run.seed >>> 0) ^ (run.floor * 2654435761) ^ 0xA11CE) >>> 0);
  return cards.map((c) => {
    if (rng.chance(HINT_NONE_CHANCE)) return null;
    // Veiled nodes read as mystery so hints don't leak the real category.
    const faceCat = c.hidden ? 'mystery' : c.category;
    const pool = HINT_POOL.filter(cat => cat !== faceCat);
    return {
      category: rng.pick(pool.length ? pool : HINT_POOL),
      // which way to branch (±1); slight angle jitter keeps siblings from stacking
      side: rng.chance(0.5) ? 1 : -1,
      angle: 0.55 + rng.next() * 0.45, // radians-ish blend weight toward sideways
    };
  });
}

/** Stem from the choice node, shoot mostly perpendicular — always upward/ahead, never back down. */
function hintBranch(origin, target, hint, dist = 124) {
  const dx = target.cx - origin.cx;
  const dy = target.cy - origin.cy;
  const len = Math.hypot(dx, dy) || 1;
  const fx = dx / len;
  const fy = dy / len;
  const sideways = hint.angle ?? 0.75;
  const side = hint.side || 1;

  // Build a branch dir for a given perpendicular side (blend sideways + a little forward)
  const dirFor = (s) => {
    const px = -fy * s;
    const py = fx * s;
    let bx = px * sideways + fx * (1 - sideways);
    let by = py * sideways + fy * (1 - sideways);
    const bl = Math.hypot(bx, by) || 1;
    return { bx: bx / bl, by: by / bl };
  };

  // Prefer the random side, but flip if the other shoots more upward (negative Y)
  let dir = dirFor(side);
  const alt = dirFor(-side);
  if (alt.by < dir.by) dir = alt;

  // Extra upward lean so teasers always read as "further ahead"
  let bx = dir.bx;
  let by = dir.by - 0.35;
  const bl = Math.hypot(bx, by) || 1;
  bx /= bl;
  by /= bl;

  const cx = Math.max(48, Math.min(1232, target.cx + bx * dist));
  // Keep hints above the choice node — never back toward the player
  const cy = Math.max(36, Math.min(target.cy - 12, target.cy + by * dist));
  return { cx, cy };
}

// game category → node visuals (real 11-category taxonomy, not the handoff's 8)
const NODE = {
  combat:      { color: '#e0564e', glow: 'rgba(224,86,78,.5)',  risk: 2 },
  dangerous:   { color: '#ff8a3c', glow: 'rgba(255,138,60,.5)', risk: 3 },
  mystery:     { color: '#a678ff', glow: 'rgba(166,120,255,.5)', risk: '?' },
  unknown:     { color: '#a678ff', glow: 'rgba(166,120,255,.5)', risk: '?' },
  merchant:    { color: '#5ba7ff', glow: 'rgba(91,167,255,.5)', risk: 0 },
  recovery:    { color: '#5fd6a0', glow: 'rgba(95,214,160,.5)', risk: 0 },
  equipment:   { color: '#ffd257', glow: 'rgba(255,210,87,.5)', risk: 1 },
  training:    { color: '#4fd6c0', glow: 'rgba(79,214,192,.5)', risk: 2 },
  appraisal:   { color: '#5ba7ff', glow: 'rgba(91,167,255,.5)', risk: 0 },
  social:      { color: '#8fd8cc', glow: 'rgba(143,216,204,.5)', risk: 1 },
  advancement: { color: '#ffd257', glow: 'rgba(255,210,87,.5)', risk: 1 },
};
const nodeMeta = cat => NODE[cat] || NODE.unknown;

// Per-event difficulty when we know the type; category NODE.risk is the fallback.
const TYPE_RISK = {
  rest: 0, shop: 0, blessing: 0,
  story: 1, treasure: 2,
  risk: 3,
};

// Explicit overrides for events whose danger doesn't match category/type.
const EVENT_RISK = {
  campfire: 0, merchant: 0, wandering_appraiser: 0, guild_assessor: 0,
  discarded_kit: 1, abandoned_armory: 1, chest_generic: 2,
  training_grounds: 2, sparring_ring: 3, proving_hall: 2, academy_recruiter: 1,
  gambler: 3, blood_altar: 4, mysterious_door: 3, cursed_mirror: 3,
  prodigys_gambit: 4, crimson_stranger: 4, frost_revenant: 4,
  demon_gambler: 4, old_man_wrath: 4,
};

function riskInfo(risk) {
  if (risk === '?') return { label: 'UNKNOWN', color: '#a678ff', pips: 0 };
  if (risk === 0) return { label: 'SAFE', color: '#5fd6a0', pips: 0 };
  if (risk >= 4) return { label: 'DEADLY', color: '#ff6b5a', pips: risk };
  if (risk >= 2) return { label: 'RISKY', color: '#ffb46b', pips: risk };
  return { label: 'MINOR', color: '#ffd257', pips: risk };
}

function riskPips(risk) {
  const n = typeof risk === 'number' ? risk : 0;
  let out = '';
  for (let i = 0; i < 5; i++) {
    const on = i < n;
    out += `<span style="width:9px;height:9px;background:${on ? '#ff6b5a' : 'rgba(70,60,40,.55)'};border:1px solid ${on ? '#8a3a2e' : '#3a3320'}"></span>`;
  }
  return out;
}

function shortFlavor(text, max = 90) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  return cut.replace(/\s+\S*$/, '') + '…';
}

function artFromCategory(category, glyph) {
  const url = eventCatUrl(category);
  if (url) return `<img class="tm-emblem" src="${url}" alt="" />`;
  return `<span class="tm-icon">${glyph || '❓'}</span>`;
}

/**
 * Resolve what a path node should show. Reveals event title/art/risk unless
 * `card.hidden` (mystery veil). Exported for tests.
 */
export function pathNodeView(card) {
  if (card?.hidden) {
    const m = CATEGORY_META.mystery;
    const nm = nodeMeta('mystery');
    return {
      faceCategory: 'mystery',
      tag: m.label.toUpperCase(),
      title: '???',
      flavor: m.blurb,
      glyph: m.glyph,
      color: nm.color,
      glow: nm.glow,
      risk: nm.risk,
      artHtml: artFromCategory('mystery', m.glyph),
    };
  }

  if (card?.kind === 'encounter' || card?.category === 'combat') {
    const m = CATEGORY_META.combat;
    const nm = nodeMeta('combat');
    const foes = card.enemies || [];
    const first = foes[0];
    const id = first?.id || first?.artId;
    const spec = id ? findEnemySpec(id) : null;
    const name = first?.name || spec?.name;
    const names = [...new Set(foes.map(e => e.name || findEnemySpec(e.id)?.name).filter(Boolean))];
    const title = names.length === 1 ? names[0] : (names.length ? 'Hostiles Ahead' : m.label);
    const elite = foes.some(e => e.elite || findEnemySpec(e.id)?.elite);
    const spr = id ? enemySpriteHtml(id, { elite: !!(first?.elite || spec?.elite) }) : null;
    const glyph = first?.glyph || spec?.glyph || m.glyph;
    return {
      faceCategory: 'combat',
      tag: m.label.toUpperCase(),
      title,
      flavor: names.length > 1
        ? `${names.join(', ')}${foes.length > names.length ? ` ×${foes.length}` : ''}.`
        : (name ? `${name} bars the path.` : m.blurb),
      glyph,
      color: nm.color,
      glow: nm.glow,
      risk: elite ? 3 : nm.risk,
      artHtml: spr || `<span class="tm-icon">${glyph}</span>`,
    };
  }

  const ev = EVENTS.find(e => e.id === card?.eventId);
  if (!ev) {
    const cat = card?.category || 'unknown';
    const m = CATEGORY_META[cat] || CATEGORY_META.unknown;
    const nm = nodeMeta(cat);
    return {
      faceCategory: cat,
      tag: m.label.toUpperCase(),
      title: m.label,
      flavor: m.blurb,
      glyph: m.glyph,
      color: nm.color,
      glow: nm.glow,
      risk: nm.risk,
      artHtml: artFromCategory(cat, m.glyph),
    };
  }

  const cat = ev.category || card.category || 'unknown';
  const m = CATEGORY_META[cat] || CATEGORY_META.unknown;
  const nm = nodeMeta(cat);
  const risk = ev.risk != null ? ev.risk
    : (EVENT_RISK[ev.id] != null ? EVENT_RISK[ev.id]
      : ((ev.type && TYPE_RISK[ev.type] != null) ? TYPE_RISK[ev.type] : nm.risk));
  let artHtml;
  if (ev.npc?.art) {
    const spr = enemySpriteHtml(ev.npc.art, { elite: true });
    artHtml = spr || `<span class="tm-icon">${ev.glyph || m.glyph}</span>`;
  } else {
    artHtml = artFromCategory(cat, ev.glyph || m.glyph);
  }

  return {
    faceCategory: cat,
    tag: m.label.toUpperCase(),
    title: ev.title,
    flavor: shortFlavor(ev.text) || m.blurb,
    glyph: ev.glyph || m.glyph,
    color: nm.color,
    glow: nm.glow,
    risk: cat === 'dangerous' ? Math.max(risk, 4) : risk,
    artHtml,
  };
}

// A choice node (compact ↔ hover-expanded). i = card index (kept 1:1 with cards).
function nodeHtml(card, i, cx, cy, { coop = false } = {}) {
  const v = pathNodeView(card);
  const ri = riskInfo(v.risk);
  return `
    <div class="tm-node ${card.sparkle ? 'tm-sparkle' : ''}${card.hidden ? ' tm-mystery' : ''}" data-i="${i}" style="left:${cx}px;top:${cy}px;--nc:${v.color};--ng:${v.glow}">
      <div class="tm-card">
        <div class="tm-art">${v.artHtml}</div>
        <div class="tm-foot">
          <div class="tm-tag">${v.tag}</div>
          <div class="tm-name">${v.title}</div>
          <div class="tm-expand">
            <div class="tm-risk"><span class="tm-risk-label" style="color:${ri.color}">${ri.label}</span><span class="tm-pips">${riskPips(v.risk)}</span></div>
            <div class="tm-cta">▶ TRAVEL HERE</div>
          </div>
          ${coop ? `<div class="tm-votes" id="tm-votes-${i}"></div>` : ''}
        </div>
      </div>
    </div>`;
}

/** Majority-tie roulette: cycle highlights across candidates, slow down, land on winner. */
function playTieSpin(stage, candidates, winner) {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (reduce || !candidates?.length) return Promise.resolve();

  const opts = [...new Set(candidates.map(Number))];
  if (opts.length < 2 || !opts.includes(winner)) return Promise.resolve();

  const root = stage.querySelector('.tm-root');
  root?.classList.add('tm-rolling');

  // Deterministic reel (same on every client) that rattles the tied options
  // and always ends on the host-chosen winner.
  let seed = ((winner + 1) * 2654435761 ^ (opts.length * 9973)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
  const seq = [];
  const loops = 3 + Math.floor(rnd() * 2);
  for (let L = 0; L < loops; L++) {
    // mild shuffle each loop so it doesn't feel strictly left-to-right
    const order = [...opts].sort(() => rnd() - 0.5);
    for (const idx of order) seq.push(idx);
  }
  let guard = 0;
  while (seq[seq.length - 1] !== winner || seq.length < loops * opts.length + opts.length) {
    seq.push(opts[seq.length % opts.length]);
    if (++guard > 48) { seq.push(winner); break; }
  }
  seq[seq.length - 1] = winner;

  return new Promise(resolve => {
    let step = 0;
    let delay = 70;
    const tick = () => {
      const idx = seq[step];
      stage.querySelectorAll('.tm-node').forEach(n => {
        n.classList.toggle('tm-spin', +n.dataset.i === idx);
      });
      step++;
      if (step >= seq.length) {
        setTimeout(() => {
          stage.querySelectorAll('.tm-node').forEach(n => n.classList.remove('tm-spin'));
          root?.classList.remove('tm-rolling');
          resolve();
        }, 220);
        return;
      }
      // Ease out: each tick a bit slower, sharper near the end.
      const t = step / seq.length;
      delay = 70 + Math.floor(220 * (t * t));
      setTimeout(tick, delay);
    };
    tick();
  });
}

export function renderTravelMap(stage, cards, coopCtx, ctx) {
  const { run, coopS, resolveCard, biome, flash } = ctx;
  const A = trail.layout === 'A';
  const CURX = 640, CURY = A ? 520 : 580;
  const n = cards.length;
  const picks = new Map();
  let locked = false;

  // choice node positions
  const pos = cards.map((c, i) => {
    let cx, cy;
    if (A) {
      cx = (n === 1 ? 640 : 220 + 840 * (i / (n - 1)));
      cy = 196 + ((i % 2) ? 34 : 0); // clears the header/toggle above and the current card below
    } else {
      const R = 340;
      const a = (n === 1 ? -90 : (-140 + 100 * (i / (n - 1)))) * Math.PI / 180;
      cx = CURX + R * Math.cos(a); cy = CURY + R * Math.sin(a);
    }
    return { cx, cy };
  });

  // Hints branch sideways off each path (skip paths with no hint)
  const pathHints = assignPathHints(run, cards);
  const hintPos = pos.map((p, i) => {
    const h = pathHints[i];
    return h ? hintBranch({ cx: CURX, cy: CURY }, p, h, A ? 118 : 130) : null;
  });

  // connectors: you → choices, then each choice → its hint (when present)
  const lines = pos.map((p, i) => {
    const col = pathNodeView(cards[i]).color;
    return `<line x1="${CURX}" y1="${CURY - 6}" x2="${p.cx.toFixed(1)}" y2="${p.cy.toFixed(1)}" stroke="${col}" stroke-opacity="0.34" stroke-width="2" stroke-dasharray="2 8" stroke-linecap="round"></line>`;
  }).join('');
  const hintLines = hintPos.map((h, i) => {
    if (!h || !pathHints[i]) return '';
    const p = pos[i];
    const col = nodeMeta(pathHints[i].category).color;
    return `<line x1="${p.cx.toFixed(1)}" y1="${p.cy.toFixed(1)}" x2="${h.cx.toFixed(1)}" y2="${h.cy.toFixed(1)}" stroke="${col}" stroke-opacity="0.28" stroke-width="1.5" stroke-dasharray="3 7" stroke-linecap="round"></line>`;
  }).join('');

  const hintsHtml = hintPos.map((h, i) => {
    if (!h || !pathHints[i]) return '';
    const cat = pathHints[i].category;
    const m = CATEGORY_META[cat] || CATEGORY_META.unknown;
    const nm = nodeMeta(cat);
    return `<div class="tm-hint" title="If you take this path, something like this may wait ahead" style="left:${(h.cx - 22).toFixed(0)}px;top:${(h.cy - 26).toFixed(0)}px;border-color:${nm.color}66;color:${nm.color}99">${m.glyph}</div>`;
  }).join('');

  // history trail (last 7)
  const hist = trail.history.slice(-7);
  const histHtml = hist.map((h, idx) => {
    const total = hist.length;
    const op = (0.34 + 0.52 * (idx + 1) / total).toFixed(2);
    let style;
    if (A) { const cw = 48, gap = 12, tw = total * cw + (total - 1) * gap, sx = 640 - tw / 2, x = sx + idx * (cw + gap); style = `left:${x.toFixed(0)}px;top:612px;width:${cw}px;height:58px`; }
    else { const y = 520 - idx * 74; style = `left:42px;top:${y}px;width:56px;height:64px`; }
    return `<div class="tm-hcard" style="${style};opacity:${op};border-color:${h.color}66"><span style="color:${h.color};font-size:${A ? 20 : 22}px">${h.glyph}</span></div>`;
  }).join('');

  const r = ctx.run;
  const resLabel = ctx.resourceName || 'Resource';
  const gearBits = (ctx.equippedSummary || []).slice(0, 4);
  const partyHtml = (() => {
    if (!coopS || coopS.alone) return '';
    const chips = [...coopS.partners.entries()].map(([id, p]) => {
      const s = p.status || {};
      const resName = ({ fighter: 'Vigor', mage: 'Mana', ranger: 'Focus', rogue: 'Energy', priest: 'Faith', monk: 'Ki', warlock: 'Pact', bard: 'Verve', druid: 'Essence' })[s.classId || p.classId] || 'RES';
      const hpPct = s.maxHp ? Math.max(0, Math.min(100, (s.hp / s.maxHp) * 100)) : 0;
      const mpPct = s.maxMp ? Math.max(0, Math.min(100, ((s.mp || 0) / s.maxMp) * 100)) : 0;
      return `<button type="button" class="tm-party-chip ${s.down ? 'downed' : ''}" data-partner="${id}" title="View ${p.name}'s appraisal &amp; gear">
        <div class="tm-st-head">
          <div class="tm-st-name">${p.name}</div>
          <div class="tm-st-open">◈ VIEW</div>
        </div>
        <div class="tm-st-meta">Lv.${s.level || '?'} ${s.className || p.classId || ''}</div>
        <div class="tm-st-bars">
          <div class="tm-st-bar hp"><i style="width:${hpPct}%"></i><span>HP ${Math.round(s.hp || 0)}/${Math.round(s.maxHp || 0)}</span></div>
          <div class="tm-st-bar mp"><i style="width:${mpPct}%"></i><span>${resName} ${Math.round(s.mp || 0)}/${Math.round(s.maxMp || 0)}</span></div>
        </div>
      </button>`;
    }).join('');
    return `<div class="tm-party" id="tm-party">${chips}</div>`;
  })();
  stage.innerHTML = `
    <div class="tm-root" ${travelMapBgUrl() ? `style="background-image:linear-gradient(rgba(8,5,20,.55),rgba(6,4,14,.82)),url('${travelMapBgUrl()}');background-size:cover;background-position:center"` : ''}>
      <div class="tm-header">
        <div class="tm-biome">${biome.name.toUpperCase()}</div>
        <div class="tm-sub">Choose your path, Awakened — step ${r.floor}</div>
      </div>
      ${partyHtml}
      <div class="tm-status" id="tm-status" role="button" tabindex="0" title="Open character sheet" aria-label="Open character sheet">
        <div class="tm-st-head">
          <div class="tm-st-name">${r.name}</div>
          <div class="tm-st-open">◈ CHARACTER</div>
        </div>
        <div class="tm-st-meta">Lv.${r.level} ${r.raceName || ''} ${ctx.classTitle || r.className || ''} · 🪙 ${r.gold} · ★ ${r.fame}</div>
        <div class="tm-st-bars">
          <div class="tm-st-bar hp"><i style="width:${Math.max(0, Math.min(100, r.hp / r.maxHp * 100))}%"></i><span>HP ${Math.round(r.hp)}/${Math.round(r.maxHp)}</span></div>
          <div class="tm-st-bar mp"><i style="width:${Math.max(0, Math.min(100, r.mp / Math.max(1, r.maxMp) * 100))}%"></i><span>${resLabel} ${Math.round(r.mp)}/${Math.round(r.maxMp)}</span></div>
        </div>
        <div class="tm-st-gear">${gearBits.length ? gearBits.map(g => g).join(' · ') : 'No gear equipped yet'}</div>
      </div>
      <svg class="tm-svg" viewBox="0 0 1280 720" preserveAspectRatio="none">${hintLines}${lines}</svg>
      ${hintsHtml}
      ${histHtml}
      <div class="tm-current" style="left:${CURX}px;top:${CURY}px">
        <div class="tm-cur-art"><span>🧭</span></div>
        <div class="tm-cur-body">
          <div class="tm-cur-tag">FLOOR ${r.floor} / 51</div>
          <div class="tm-cur-name">${biome.name}</div>
          <div class="tm-cur-flavor">${coopCtx ? (coopCtx.mode === 'first' ? 'First pick decides the party\'s road.' : 'The party votes on the road ahead.') : 'The paths ahead name their destinations. A rare fog still hides a few.'}</div>
        </div>
        <div class="tm-here">◆ YOU ARE HERE ◆</div>
      </div>
      <div class="tm-choice-layer">
        ${cards.map((c, i) => nodeHtml(c, i, pos[i].cx, pos[i].cy, { coop: !!coopCtx })).join('')}
      </div>
    </div>`;

  const openSheet = (ev) => {
    ev?.preventDefault?.();
    ev?.stopPropagation?.();
    ctx.onCharacter?.();
  };
  const statusEl = stage.querySelector('#tm-status');
  statusEl?.addEventListener('click', openSheet);
  statusEl?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openSheet(ev); }
  });
  stage.querySelectorAll('[data-partner]').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      ctx.onPartnerPeek?.(btn.dataset.partner);
    });
  });
  // Live-refresh party vitals when partners broadcast status
  if (coopS && !coopS.alone) {
    const prev = coopS.onPartnerUpdate;
    coopS.onPartnerUpdate = () => {
      prev?.();
      const root = stage.querySelector('#tm-party');
      if (!root) return;
      for (const [id, p] of coopS.partners) {
        const chip = root.querySelector(`[data-partner="${id}"]`);
        if (!chip) continue;
        const s = p.status || {};
        const resName = ({ fighter: 'Vigor', mage: 'Mana', ranger: 'Focus', rogue: 'Energy', priest: 'Faith', monk: 'Ki', warlock: 'Pact', bard: 'Verve', druid: 'Essence' })[s.classId || p.classId] || 'RES';
        const hpPct = s.maxHp ? Math.max(0, Math.min(100, (s.hp / s.maxHp) * 100)) : 0;
        const mpPct = s.maxMp ? Math.max(0, Math.min(100, ((s.mp || 0) / s.maxMp) * 100)) : 0;
        chip.classList.toggle('downed', !!s.down);
        const bars = chip.querySelector('.tm-st-bars');
        if (bars) {
          bars.innerHTML = `
            <div class="tm-st-bar hp"><i style="width:${hpPct}%"></i><span>HP ${Math.round(s.hp || 0)}/${Math.round(s.maxHp || 0)}</span></div>
            <div class="tm-st-bar mp"><i style="width:${mpPct}%"></i><span>${resName} ${Math.round(s.mp || 0)}/${Math.round(s.maxMp || 0)}</span></div>`;
        }
        const meta = chip.querySelector('.tm-st-meta');
        if (meta) meta.textContent = `Lv.${s.level || '?'} ${s.className || p.classId || ''}`;
      }
    };
  }

  // Keep both map layouts available via keyboard only (hidden from the busy HUD).
  // Default stays constellation; press "L" to flip ascent if someone wants it.
  stage.querySelector('.tm-root')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'l' || ev.key === 'L') {
      trail.layout = trail.layout === 'A' ? 'B' : 'A';
      renderTravelMap(stage, cards, coopCtx, ctx);
    }
  });

  function renderVotes() {
    if (!coopCtx) return;
    for (let i = 0; i < cards.length; i++) {
      const votes = [...picks.entries()].filter(([, v]) => v === i);
      const elv = stage.querySelector(`#tm-votes-${i}`);
      if (elv) {
        elv.innerHTML = votes.map(([id]) => {
          const name = id === coopS.you ? 'You' : (coopS.partners.get(id)?.name || '?');
          return `<span class="vote-chip">${name}</span>`;
        }).join('');
      }
      stage.querySelector(`.tm-node[data-i="${i}"]`)
        ?.classList.toggle('tm-has-votes', votes.length > 0);
    }
  }

  function commit(i) {
    // record the chosen node in the history trail, then resolve
    const v = pathNodeView(cards[i]);
    trail.history.push({ glyph: v.glyph, color: v.color });
    // The hint branching off this path becomes a promised category next floor
    if (pathHints[i]?.category) run.mapHintCategory = pathHints[i].category;
    // battle nodes get the walk-across transition; others resolve in place
    const isBattle = cards[i].category === 'combat' || cards[i].category === 'dangerous';
    if (isBattle && flash) flash(() => resolveCard(stage, cards[i]));
    else resolveCard(stage, cards[i]);
  }

  stage.querySelectorAll('.tm-node').forEach(nodeEl => {
    nodeEl.onclick = () => {
      if (locked) return;
      const i = +nodeEl.dataset.i;
      if (!coopCtx) { locked = true; return commit(i); }
      const prev = picks.get(coopS.you);
      if (prev === i) return;
      if (prev != null && coopCtx.mode === 'first') return;
      picks.set(coopS.you, i);
      coopS.net.send({ k: 'pick', floor: run.floor, idx: i });
      stage.querySelectorAll('.tm-node').forEach(c => c.classList.toggle('tm-picked', +c.dataset.i === i));
      renderVotes();
      coopCtx.onLocalPick(i, picks);
    };
  });

  if (coopCtx) {
    coopCtx.bind({
      picks,
      renderVotes,
      lock: (idx, opts = {}) => {
        locked = true;
        const spinFrom = opts.spinFrom;
        const after = () => {
          stage.querySelectorAll('.tm-node').forEach(c => c.classList.toggle('tm-chosen', +c.dataset.i === idx));
          setTimeout(() => commit(idx), 700);
        };
        if (spinFrom?.length > 1) playTieSpin(stage, spinFrom, idx).then(after);
        else after();
      },
    });
  }
}
