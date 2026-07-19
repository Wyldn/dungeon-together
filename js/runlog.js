// Mid-run power curve + climb summary helpers.
import { expectedPower } from './data/tdc.js';
import { estimatePlayerPower } from './data/balance.js';
import { derived, classTitle, equippedItems, relicItems, appraiseRun } from './character.js';
import { rankFor, RANK_THRESHOLDS } from './data/ranks.js';
import { BOSSES } from './data/enemies.js';

/** Outer ring of the summary radar = S-rank threshold; EX/WRLD can poke past. */
export const PENTAGON_S_CAP = RANK_THRESHOLDS.find(t => t.rank === 'S')?.min ?? 39;

const HISTORY_KEY = 'dt_run_history_v1';
const HISTORY_MAX = 5;
const CHRONICLE_MAX = 140;

export function ensureClimbStats(run) {
  if (!run.climb) {
    run.climb = {
      damageDealt: 0,
      damageTaken: 0,
      healed: 0,
      buffsApplied: 0,
      debuffsApplied: 0,
      bossesCleared: [], // { floor, name }
      powerLog: [],     // { floor, power, expected, deltaPct }
      chronicle: [],    // balance log: events / choices / outcomes / combats
    };
  }
  if (!run.climb.powerLog) run.climb.powerLog = [];
  if (!run.climb.bossesCleared) run.climb.bossesCleared = [];
  if (!run.climb.chronicle) run.climb.chronicle = [];
  return run.climb;
}

/** Live power vs expected curve (for chronicle / balance log). */
export function powerChronicleFields(run) {
  if (!run) return null;
  const row = samplePower(run, { log: false });
  return {
    power: row.power,
    expected: row.expected,
    deltaPct: row.deltaPct,
  };
}

function formatPowerLine(e) {
  if (e?.power == null || e?.expected == null) return '';
  const sign = e.deltaPct >= 0 ? '+' : '';
  const cls = e.deltaPct >= 5 ? 'good' : (e.deltaPct <= -10 ? 'bad' : '');
  return `<div class="cs-log-power ${cls}">Power ${e.power} vs curve ${e.expected} (${sign}${e.deltaPct}%)</div>`;
}

/** Append a balance-log entry (events, choices, outcomes, combats). Caps length for localStorage. */
export function appendChronicle(run, entry) {
  if (!run || !entry) return;
  const climb = ensureClimbStats(run);
  const row = {
    at: Date.now(),
    floor: entry.floor != null ? entry.floor : run.floor,
    ...entry,
  };
  if (Array.isArray(row.lines)) {
    row.lines = row.lines.slice(0, 24).map(l => ({
      text: String(l?.text ?? '').slice(0, 240),
      cls: l?.cls || '',
    }));
  }
  if (typeof row.title === 'string') row.title = row.title.slice(0, 80);
  if (typeof row.label === 'string') row.label = row.label.slice(0, 100);
  if (typeof row.choice === 'string') row.choice = row.choice.slice(0, 100);
  if (Array.isArray(row.enemies)) row.enemies = row.enemies.slice(0, 12).map(n => String(n).slice(0, 48));
  climb.chronicle.push(row);
  while (climb.chronicle.length > CHRONICLE_MAX) climb.chronicle.shift();
}

/** Render chronicle entries for the climb-summary log page. */
export function chronicleHtml(entries = []) {
  if (!entries.length) {
    return '<div class="cs-muted">No chronicle yet — play a run to fill the balance log.</div>';
  }
  return entries.map(e => {
    const f = e.floor != null ? `F${e.floor}` : 'F?';
    if (e.t === 'event') {
      return `<div class="cs-log-entry">
        <span class="cs-log-f">${f}</span>
        <div><div class="cs-log-kind">EVENT · ${(e.category || e.type || 'event').toUpperCase()}</div>
        <div class="cs-log-title">${esc(e.title || e.id || 'Unknown')}</div>
        ${e.id ? `<div class="cs-log-meta">${esc(e.id)}</div>` : ''}</div></div>`;
    }
    if (e.t === 'choice') {
      return `<div class="cs-log-entry">
        <span class="cs-log-f">${f}</span>
        <div><div class="cs-log-kind">CHOICE</div>
        <div class="cs-log-title">${esc(e.label || e.choice || '—')}</div>
        ${e.eventId || e.title ? `<div class="cs-log-meta">${esc(e.title || e.eventId)}</div>` : ''}</div></div>`;
    }
    if (e.t === 'outcome') {
      const lines = (e.lines || []).map(l =>
        `<div class="cs-log-line ${l.cls || ''}">${esc(l.text)}</div>`
      ).join('');
      return `<div class="cs-log-entry">
        <span class="cs-log-f">${f}</span>
        <div><div class="cs-log-kind">OUTCOME${e.choice ? ` · ${esc(e.choice)}` : ''}</div>
        ${e.title ? `<div class="cs-log-meta">${esc(e.title)}</div>` : ''}
        <div class="cs-log-lines">${lines || '<div class="cs-muted">—</div>'}</div></div></div>`;
    }
    if (e.t === 'combat') {
      return `<div class="cs-log-entry">
        <span class="cs-log-f">${f}</span>
        <div><div class="cs-log-kind">${e.boss ? 'BOSS FIGHT' : 'COMBAT'}</div>
        <div class="cs-log-title">${esc((e.enemies || []).join(', ') || 'Hostiles')}</div>
        ${e.intro ? `<div class="cs-log-meta">${esc(e.intro)}</div>` : ''}
        ${formatPowerLine(e)}</div></div>`;
    }
    if (e.t === 'combatEnd') {
      const sign = e.result === 'win' ? 'good' : (e.result === 'fled' ? '' : 'bad');
      return `<div class="cs-log-entry">
        <span class="cs-log-f">${f}</span>
        <div><div class="cs-log-kind">COMBAT END</div>
        <div class="cs-log-title ${sign}">${esc(String(e.result || '?').toUpperCase())}
          ${(e.gold != null || e.xp != null) ? ` · +${e.gold || 0}g / +${e.xp || 0}xp` : ''}</div>
        ${e.enemies?.length ? `<div class="cs-log-meta">${esc(e.enemies.join(', '))}</div>` : ''}
        ${formatPowerLine(e)}</div></div>`;
    }
    if (e.t === 'power') {
      return `<div class="cs-log-entry">
        <span class="cs-log-f">${f}</span>
        <div><div class="cs-log-kind">POWER CHECK${e.gate ? ' · GATE' : ''}</div>
        <div class="cs-log-title">${esc(e.title || 'Curve checkpoint')}</div>
        ${formatPowerLine(e)}</div></div>`;
    }
    return `<div class="cs-log-entry">
      <span class="cs-log-f">${f}</span>
      <div><div class="cs-log-kind">${esc(e.t || 'NOTE')}</div>
      <div class="cs-log-title">${esc(e.title || e.label || JSON.stringify(e).slice(0, 120))}</div></div></div>`;
  }).join('');
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function samplePower(run, { log = true } = {}) {
  const climb = ensureClimbStats(run);
  const d = derived(run);
  const power = estimatePlayerPower({
    level: run.level,
    str: d.str, dex: d.dex, int: d.int, wis: d.wis, lk: d.lk,
    atk: d.atk, def: d.def, hp: d.maxHp || run.maxHp,
    dmgMult: d.dmgMult, dmgTakenMult: d.dmgTakenMult, crit: d.crit,
  });
  const expected = expectedPower(run.floor);
  const deltaPct = expected > 0 ? ((power - expected) / expected) * 100 : 0;
  const row = {
    floor: run.floor,
    power: Math.round(power * 100) / 100,
    expected: Math.round(expected * 100) / 100,
    deltaPct: Math.round(deltaPct * 10) / 10,
    // Snapshot for balance tooling — what fed estimatePlayerPower.
    level: run.level,
    atk: d.atk, def: d.def, hp: d.maxHp || run.maxHp,
    dmgMult: Math.round((d.dmgMult || 1) * 1000) / 1000,
    dmgTakenMult: Math.round((d.dmgTakenMult || 1) * 1000) / 1000,
    crit: Math.round((d.crit || 0) * 10) / 10,
    stats: { str: d.str, dex: d.dex, int: d.int, wis: d.wis, lk: d.lk },
  };
  // One sample per floor (overwrite if re-sampled).
  const idx = climb.powerLog.findIndex(r => r.floor === run.floor);
  if (idx >= 0) climb.powerLog[idx] = row;
  else climb.powerLog.push(row);
  if (log && typeof console !== 'undefined') {
    const sign = row.deltaPct >= 0 ? '+' : '';
    console.log(
      `[power] F${row.floor}: ${row.power} vs expected ${row.expected} (${sign}${row.deltaPct}%)`,
      asciiPowerSpark(climb.powerLog),
      row,
    );
  }
  return row;
}

/** Compact sparkline of delta% across floors for the console. */
export function asciiPowerSpark(log) {
  if (!log?.length) return '';
  const chars = '▁▂▃▄▅▆▇█';
  const vals = log.map(r => r.deltaPct);
  const lo = Math.min(-20, ...vals);
  const hi = Math.max(20, ...vals);
  const span = hi - lo || 1;
  return vals.map(v => chars[Math.max(0, Math.min(7, Math.floor(((v - lo) / span) * 7)))]).join('');
}

export function powerGraphSvg(log, { w = 400, h = 140 } = {}) {
  if (!log?.length) {
    return `<svg class="power-graph" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><text x="12" y="72" fill="var(--ink-faint)" font-size="12">No power samples</text></svg>`;
  }
  const pad = 16;
  const maxF = Math.max(51, ...log.map(r => r.floor));
  const ys = log.flatMap(r => [r.power, r.expected]);
  const lo = Math.min(...ys) * 0.9;
  const hi = Math.max(...ys) * 1.1;
  const x = f => pad + ((f - 1) / (maxF - 1)) * (w - pad * 2);
  const y = v => h - pad - ((v - lo) / (hi - lo || 1)) * (h - pad * 2);
  const expLine = log.map((r, i) => `${i ? 'L' : 'M'}${x(r.floor).toFixed(1)},${y(r.expected).toFixed(1)}`).join(' ');
  const powLine = log.map((r, i) => `${i ? 'L' : 'M'}${x(r.floor).toFixed(1)},${y(r.power).toFixed(1)}`).join(' ');
  const last = log[log.length - 1];
  const sign = last.deltaPct >= 0 ? '+' : '';
  return `<svg class="power-graph" width="100%" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Power vs expected">
    <path d="${expLine}" fill="none" stroke="rgba(232,182,74,.45)" stroke-width="1.5" stroke-dasharray="5 4"/>
    <path d="${powLine}" fill="none" stroke="#9fd4ff" stroke-width="2"/>
    <text x="${pad}" y="14" fill="var(--ink-dim)" font-size="11">expected</text>
    <text x="${pad + 64}" y="14" fill="#9fd4ff" font-size="11">you</text>
    <text x="${w - pad}" y="14" text-anchor="end" fill="var(--gold-bright)" font-size="11" font-family="var(--font-display)">${sign}${last.deltaPct}% @ F${last.floor}</text>
  </svg>`;
}

export function noteBossCleared(run, floor, name) {
  const climb = ensureClimbStats(run);
  if (!climb.bossesCleared.some(b => b.floor === floor)) {
    climb.bossesCleared.push({ floor, name: name || BOSSES[floor]?.name || `Floor ${floor} boss` });
  }
}

export function trackDamageDealt(run, n) {
  if (!run || !(n > 0)) return;
  ensureClimbStats(run).damageDealt += Math.round(n);
}
export function trackDamageTaken(run, n) {
  if (!run || !(n > 0)) return;
  ensureClimbStats(run).damageTaken += Math.round(n);
}
export function trackHealed(run, n) {
  if (!run || !(n > 0)) return;
  ensureClimbStats(run).healed += Math.round(n);
}
export function trackBuff(run) {
  if (!run) return;
  ensureClimbStats(run).buffsApplied += 1;
}
export function trackDebuff(run) {
  if (!run) return;
  ensureClimbStats(run).debuffsApplied += 1;
}

/** Final appraisal + snapshot for the climb summary / history. */
export function buildClimbSummary(run, outcome, rng) {
  ensureClimbStats(run);
  // Fresh full appraisal for the summary screen.
  if (rng) {
    try { appraiseRun(rng, run, { partial: false, location: 'the climb\'s end' }); }
    catch { /* appraisal helpers may need a live run — ignore */ }
  }
  const d = derived(run);
  const appr = run.appraisal;
  const power = samplePower(run, { log: false });
  return {
    at: Date.now(),
    outcome, // win | escape | dead | abandon
    name: run.name,
    raceName: run.raceName,
    classId: run.classId,
    title: classTitle(run),
    seed: run.seed,
    floor: run.floor,
    level: run.level,
    kills: run.kills,
    fame: run.fame,
    gold: run.gold,
    growthRank: run.growthRank || '?',
    overall: appr?.overall || rankFor(Math.round((d.str + d.dex + d.int + d.wis + d.lk) / 5)) || '?',
    stats: { str: d.str, dex: d.dex, int: d.int, wis: d.wis, lk: d.lk },
    climb: {
      ...run.climb,
      powerLog: [...(run.climb.powerLog || [])],
      bossesCleared: [...(run.climb.bossesCleared || [])],
      chronicle: [...(run.climb.chronicle || [])],
    },
    equipment: equippedItems(run).map(it => ({
      slot: it.slot, name: it.name, rarity: it.rarity, desc: it.desc, wtype: it.wtype,
    })),
    relics: relicItems(run).map(r => ({ name: r.name, desc: r.desc || '' })),
    skills: [...(run.skills || [])],
    power,
  };
}

export function loadRunHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function pushRunHistory(summary) {
  const list = loadRunHistory();
  list.unshift(summary);
  while (list.length > HISTORY_MAX) list.pop();
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
  return list;
}

/** Radar for 5 combat stats. Outer ring = S-rank cutoff; stronger stats clamp to the rim. */
export function statPentagonSvg(stats, { size = 280 } = {}) {
  const keys = ['str', 'dex', 'int', 'wis', 'lk'];
  const labels = ['STR', 'DEX', 'INT', 'WIS', 'LK'];
  const cx = size / 2, cy = size / 2;
  const R = size * 0.36;
  const fracOf = (v) => Math.min(1, Math.max(0, (v || 0) / PENTAGON_S_CAP));
  const pt = (i, r) => {
    const a = (-Math.PI / 2) + (i * 2 * Math.PI) / 5;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  };
  const ring = (frac) => keys.map((_, i) => pt(i, R * frac).map(n => n.toFixed(1)).join(',')).join(' ');
  const poly = keys.map((k, i) => pt(i, R * fracOf(stats[k])).map(n => n.toFixed(1)).join(',')).join(' ');
  const dots = keys.map((k, i) => {
    const [x, y] = pt(i, R * fracOf(stats[k]));
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#9fd4ff"/>`;
  }).join('');
  const spokes = keys.map((_, i) => {
    const [x, y] = pt(i, R);
    return `<line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="rgba(159,212,255,.14)" stroke-width="1"/>`;
  }).join('');
  const labelNodes = labels.map((lb, i) => {
    const [x, y] = pt(i, R + 16);
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="var(--ink-dim)" font-size="12" font-family="var(--font-display)">${lb}</text>`;
  }).join('');
  return `<svg class="stat-pentagon" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Stats radar, outer ring S">
    ${spokes}
    <polygon points="${ring(1)}" fill="none" stroke="rgba(232,182,74,.28)" stroke-width="1"/>
    <polygon points="${ring(0.66)}" fill="none" stroke="rgba(159,212,255,.16)" stroke-width="1"/>
    <polygon points="${ring(0.33)}" fill="none" stroke="rgba(159,212,255,.12)" stroke-width="1"/>
    <polygon points="${poly}" fill="rgba(159,212,255,.22)" stroke="#9fd4ff" stroke-width="2"/>
    ${dots}
    ${labelNodes}
  </svg>`;
}
