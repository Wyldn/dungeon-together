// Event Travel Map (handoff §6) — the node-based path chooser that REPLACES
// the face-down 3-card draw's presentation. It's a *view* over the same `cards`
// array generateCards() produces; picking a node calls the same resolveCard().
// Co-op vote/lock contract is preserved verbatim (picks / renderVotes / bind).

import { CATEGORY_META } from './data/events.js';

// module-persistent trail + layout across floors
const trail = { history: [], layout: 'A' };
export function resetTravelTrail() { trail.history = []; }

// game category → node visuals (real 11-category taxonomy, not the handoff's 8)
const NODE = {
  combat:      { color: '#e0564e', glow: 'rgba(224,86,78,.5)',  risk: 2 },
  dangerous:   { color: '#ff8a3c', glow: 'rgba(255,138,60,.5)', risk: 4 },
  mystery:     { color: '#a678ff', glow: 'rgba(166,120,255,.5)', risk: '?' },
  unknown:     { color: '#a678ff', glow: 'rgba(166,120,255,.5)', risk: '?' },
  merchant:    { color: '#5ba7ff', glow: 'rgba(91,167,255,.5)', risk: 0 },
  recovery:    { color: '#5fd6a0', glow: 'rgba(95,214,160,.5)', risk: 0 },
  equipment:   { color: '#ffd257', glow: 'rgba(255,210,87,.5)', risk: 0 },
  training:    { color: '#4fd6c0', glow: 'rgba(79,214,192,.5)', risk: 1 },
  appraisal:   { color: '#5ba7ff', glow: 'rgba(91,167,255,.5)', risk: 0 },
  social:      { color: '#8fd8cc', glow: 'rgba(143,216,204,.5)', risk: 1 },
  advancement: { color: '#ffd257', glow: 'rgba(255,210,87,.5)', risk: 1 },
};
const nodeMeta = cat => NODE[cat] || NODE.unknown;

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

// A choice node (compact ↔ hover-expanded). i = card index (kept 1:1 with cards).
function nodeHtml(card, i, cx, cy) {
  const m = CATEGORY_META[card.category] || CATEGORY_META.unknown;
  const nm = nodeMeta(card.category);
  const ri = riskInfo(nm.risk);
  return `
    <div class="tm-node ${card.sparkle ? 'tm-sparkle' : ''}" data-i="${i}" style="left:${cx}px;top:${cy}px;--nc:${nm.color};--ng:${nm.glow}">
      <div class="tm-card">
        <div class="tm-art"><span class="tm-icon">${m.glyph}</span></div>
        <div class="tm-foot">
          <div class="tm-tag">${m.label}</div>
          <div class="tm-name">${m.label}</div>
          <div class="tm-expand">
            <div class="tm-risk"><span class="tm-risk-label" style="color:${ri.color}">${ri.label}</span><span class="tm-pips">${riskPips(nm.risk)}</span></div>
            <div class="tm-flavor">${m.blurb}</div>
            <div class="tm-cta">▶ TRAVEL HERE</div>
          </div>
          <div class="tm-votes" id="tm-votes-${i}"></div>
        </div>
      </div>
    </div>`;
}

export function renderTravelMap(stage, cards, coopCtx, ctx) {
  const { run, coopS, resolveCard, biome, flash } = ctx;
  const A = trail.layout === 'A';
  const CURX = 640, CURY = A ? 466 : 540;
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

  // hint teasers (2-3 faint nodes further ahead)
  const hintCount = 2 + (run.floor % 2);
  const hintPos = Array.from({ length: hintCount }, (_, i) => {
    if (A) return { cx: 300 + 680 * (hintCount === 1 ? .5 : i / (hintCount - 1)), cy: 100 };
    const R = 482, a = (hintCount === 1 ? -90 : (-124 + 68 * (i / (hintCount - 1)))) * Math.PI / 180;
    return { cx: CURX + R * Math.cos(a), cy: CURY + R * Math.sin(a) };
  });
  const hintGlyphs = ['⚔️', '🪙', '❓', '🌿', '☠️', '✦'];

  // connectors current → choices
  const lines = pos.map((p, i) => `<line x1="${CURX}" y1="${CURY - 6}" x2="${p.cx.toFixed(1)}" y2="${p.cy.toFixed(1)}" stroke="${nodeMeta(cards[i].category).color}" stroke-opacity="0.34" stroke-width="2" stroke-dasharray="2 8" stroke-linecap="round"></line>`).join('');
  const hintLines = hintPos.map((h, i) => `<line x1="${pos[i % n].cx.toFixed(1)}" y1="${pos[i % n].cy.toFixed(1)}" x2="${h.cx.toFixed(1)}" y2="${h.cy.toFixed(1)}" stroke="rgba(160,143,102,.22)" stroke-width="1.5" stroke-dasharray="3 7"></line>`).join('');

  const hintsHtml = hintPos.map((h, i) => `<div class="tm-hint" style="left:${(h.cx - 22).toFixed(0)}px;top:${(h.cy - 26).toFixed(0)}px">${hintGlyphs[(run.floor + i) % hintGlyphs.length]}</div>`).join('');

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

  const cm = CATEGORY_META;
  stage.innerHTML = `
    <div class="tm-root">
      <div class="tm-header">
        <div class="tm-biome">${biome.name.toUpperCase()}</div>
        <div class="tm-sub">Choose your path, Awakened — step ${run.floor}</div>
      </div>
      <div class="tm-toggle">
        <div class="tm-seg ${A ? 'on' : ''}" data-layout="A">CONSTELLATION</div>
        <div class="tm-seg ${!A ? 'on' : ''}" data-layout="B">ASCENT</div>
      </div>
      <svg class="tm-svg" viewBox="0 0 1280 720" preserveAspectRatio="none">${hintLines}${lines}</svg>
      ${hintsHtml}
      ${histHtml}
      <div class="tm-current" style="left:${CURX}px;top:${CURY}px">
        <div class="tm-here">◆ YOU ARE HERE ◆</div>
        <div class="tm-cur-art"><span>🧭</span></div>
        <div class="tm-cur-body">
          <div class="tm-cur-tag">FLOOR ${run.floor} / 51</div>
          <div class="tm-cur-name">${biome.name}</div>
          <div class="tm-cur-flavor">${coopCtx ? (coopCtx.mode === 'first' ? 'First pick decides the party\'s road.' : 'The party votes on the road ahead.') : 'The paths ahead show only their nature — never their contents. Choose.'}</div>
        </div>
      </div>
      <div class="tm-choice-layer">
        ${cards.map((c, i) => nodeHtml(c, i, pos[i].cx, pos[i].cy)).join('')}
      </div>
    </div>`;

  // layout toggle (LOCAL view state only — never networked)
  stage.querySelectorAll('.tm-seg').forEach(seg => seg.onclick = () => {
    const L = seg.dataset.layout;
    if (trail.layout === L) return;
    trail.layout = L;
    renderTravelMap(stage, cards, coopCtx, ctx);
  });

  function renderVotes() {
    if (!coopCtx) return;
    for (let i = 0; i < cards.length; i++) {
      const votes = [...picks.entries()].filter(([, v]) => v === i);
      const elv = stage.querySelector(`#tm-votes-${i}`);
      if (elv) elv.innerHTML = votes.map(([id]) => {
        const name = id === coopS.you ? 'You' : (coopS.partners.get(id)?.name || '?');
        return `<span class="vote-chip">${name}</span>`;
      }).join('');
    }
  }

  function commit(i) {
    // record the chosen node in the history trail, then resolve
    const nm = nodeMeta(cards[i].category);
    const m = CATEGORY_META[cards[i].category] || CATEGORY_META.unknown;
    trail.history.push({ glyph: m.glyph, color: nm.color });
    // battle nodes get the radial flash; others resolve in place
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
    coopCtx.bind({ picks, renderVotes, lock: idx => {
      locked = true;
      stage.querySelectorAll('.tm-node').forEach(c => c.classList.toggle('tm-chosen', +c.dataset.i === idx));
      setTimeout(() => commit(idx), 700);
    } });
  }
}
