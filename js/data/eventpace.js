// Narrative pacing — a thin weight layer on drawEvent.
// eventEligible / when still answer "can this happen?"
// This module answers "is this a good moment?" via named multipliers.
// Gameplay and ?dev=world must call the same function.
// Layer is frozen: no new scheduler, quests, or pace metadata unless a
// measured tools/pace_validate.js failure requires it.

import { CONFIG } from './config.js';
import { TDC } from './tdc.js';
import { historyCategoryWeight, historyEventWeight } from './balance.js';
import { tagWeightMult } from './eventtags.js';
import { SECRET_ROUTES, THREADS, secretEligible, secretUnlocked } from './world.js';

const STORY_ROLES = new Set(['initiation', 'callback', 'payoff', 'narrative']);

function paceCfg() {
  return TDC.events.pace || {};
}

function asList(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function npcKey(ev) {
  if (!ev?.npc) return null;
  if (typeof ev.npc === 'string') return ev.npc;
  return ev.npc.art || ev.npc.name || null;
}

function initiationSecretId(ev) {
  if (!ev?.id) return null;
  for (const [id, spec] of Object.entries(SECRET_ROUTES || {})) {
    if (spec.initiation === ev.id) return id;
  }
  return null;
}

function citesPrior(when) {
  if (!when || typeof when !== 'object' || typeof when === 'function') return false;
  if (when.event || when.events || when.flag || when.flags
      || when.knowledge || when.thread || when.charMet) return true;
  for (const inner of asList(when.any)) {
    if (citesPrior(inner)) return true;
  }
  for (const inner of asList(when.all)) {
    if (citesPrior(inner)) return true;
  }
  if (when.not && typeof when.not === 'object' && !Array.isArray(when.not)) {
    // a NOT wrapper is not itself a callback trigger
  }
  return false;
}

export function eventRole(ev) {
  if (!ev) return 'flavor';
  if (ev.pace?.role) return ev.pace.role;
  if (initiationSecretId(ev)) return 'initiation';
  const callback = /_return$/.test(ev.id || '') || citesPrior(ev.when);
  const late = (ev.when?.floorMin ?? 0) >= 40;
  if (callback && late) return 'payoff';
  if ((ev.family || ev.thread) && late) return 'payoff';
  if (callback) return 'callback';
  if (ev.family || ev.thread) return 'narrative';
  return 'flavor';
}

export function stampFloor(run, key) {
  if (!run || key == null || key === '') return null;
  const w = run.world || {};
  if (w.events?.[key]?.floor != null) return w.events[key].floor;
  if (w.since?.[key] != null) return w.since[key];
  if (w.threads?.[key]?.floor != null) return w.threads[key].floor;
  return null;
}

function walkWhenStamps(when, run, out) {
  if (!when || typeof when !== 'object') return;
  for (const id of asList(when.event || when.events)) {
    const fl = stampFloor(run, id);
    if (fl != null) out.push(fl);
  }
  for (const id of asList(when.flag || when.flags)) {
    const fl = stampFloor(run, id);
    if (fl != null) out.push(fl);
  }
  for (const id of asList(when.knowledge)) {
    const fl = stampFloor(run, id);
    if (fl != null) out.push(fl);
  }
  if (when.thread) {
    const id = typeof when.thread === 'string' ? when.thread : when.thread.id;
    const fl = stampFloor(run, id);
    if (fl != null) out.push(fl);
  }
  for (const inner of asList(when.any)) walkWhenStamps(inner, run, out);
  for (const inner of asList(when.all)) walkWhenStamps(inner, run, out);
}

export function resolveTriggerFloor(ev, run) {
  if (!ev || !run) return null;
  if (ev.pace?.after) {
    const fl = stampFloor(run, ev.pace.after);
    if (fl != null) return fl;
  }
  const found = [];
  walkWhenStamps(ev.when, run, found);
  if (ev.thread) {
    const fl = stampFloor(run, ev.thread);
    if (fl != null) found.push(fl);
  }
  if (!found.length) return null;
  return Math.max(...found);
}

export function callbackAge(ev, run) {
  const trigger = resolveTriggerFloor(ev, run);
  if (trigger == null) return null;
  return Math.max(0, (run.floor || 0) - trigger);
}

function remainingWindow(ev, run) {
  const floorMax = ev?.when?.floorMax;
  if (floorMax == null) return Infinity;
  return floorMax - (run.floor || 0);
}

function ageMult(ev, run, role) {
  if (role === 'flavor') return null;
  const age = callbackAge(ev, run);
  if (age == null) return null; // missing stamp — omit term (old saves behave as today)
  const cfg = paceCfg();
  const authored = ev.pace || {};
  const initiation = role === 'initiation';
  const minDelay = authored.minDelay ?? (initiation ? (cfg.initiationMinDelay ?? 1) : (cfg.minDelay ?? 3));
  const prefer = authored.preferDelay ?? (initiation ? (cfg.initiationPreferDelay ?? 2) : (cfg.preferDelay ?? 7));
  const early = initiation ? (cfg.initiationEarlyDelay ?? 0.55) : (cfg.earlyDelay ?? 0.25);
  const peak = initiation ? (cfg.initiationAgePeak ?? 1.15) : (cfg.agePeak ?? 1.5);
  const remain = remainingWindow(ev, run);
  if (remain <= 2) return 1;
  let mult;
  if (age < minDelay) {
    mult = early;
  } else if (age < prefer) {
    const span = Math.max(1, prefer - minDelay);
    const t = (age - minDelay) / span;
    mult = early + t * (1 - early);
  } else {
    const extra = Math.min(1, (age - prefer) / 6);
    mult = 1 + extra * (peak - 1);
  }
  if (remain <= 4) mult = 1 - (1 - mult) * 0.35;
  return mult;
}

function relevanceMult(ev, run, role) {
  if (!STORY_ROLES.has(role)) return null;
  const threadId = ev.thread;
  if (!threadId) return null;
  const stage = run.world?.threads?.[threadId]?.stage;
  if (!stage) return null;
  const stages = THREADS[threadId]?.stages || [];
  const idx = stages.indexOf(stage);
  if (idx < 0 || idx >= stages.length - 1) return null;
  return paceCfg().relevance ?? 1.25;
}

function recentWindow(run) {
  const cfg = paceCfg();
  const keep = cfg.narrativeWindow ?? 4;
  const floor = run.floor || 0;
  return (run.recentNarrative || []).filter(r => (floor - (r.floor || 0)) <= keep).slice(-keep);
}

function congestionMult(ev, run, role, ctx) {
  if (!STORY_ROLES.has(role)) return null;
  const cfg = paceCfg();
  const chain = !!ev.pace?.chain;
  const window = recentWindow(run);
  const story = window.filter(r => STORY_ROLES.has(r.role));
  let m = 1;
  if (story.length >= 2) m *= cfg.congestionTwo ?? 0.5;
  else if (story.length === 1) m *= cfg.congestionOne ?? 0.7;
  const last = window[window.length - 1];
  if (last && STORY_ROLES.has(last.role)) m *= cfg.congestionLast ?? 0.75;

  if (!chain) {
    if (ev.family && window.some(r => r.family === ev.family)) m *= cfg.sameFamily ?? 0.45;
    if (ev.thread && window.some(r => r.thread === ev.thread)) m *= cfg.sameThread ?? 0.4;
    const npc = npcKey(ev);
    if (npc && window.some(r => r.npc === npc)) m *= cfg.sameNpc ?? 0.45;
  }

  const offered = ctx.offered || [];
  const offeredStory = offered.filter(o => o && o.id !== ev.id && STORY_ROLES.has(eventRole(o)));
  if (offeredStory.length) {
    m *= role === 'initiation' ? (cfg.intraDrawInitiation ?? 0.8) : (cfg.intraDraw ?? 0.55);
    if (!chain) {
      if (ev.family && offered.some(o => o.family === ev.family)) m *= cfg.sameFamily ?? 0.45;
      if (ev.thread && offered.some(o => o.thread === ev.thread)) m *= cfg.sameThread ?? 0.4;
    }
  }

  if (role === 'initiation') m = Math.max(m, cfg.initiationCongestionFloor ?? 0.7);
  return m === 1 ? null : m;
}

function initiationMult(ev, run, role) {
  if (role !== 'initiation') return null;
  const id = initiationSecretId(ev);
  if (!id) return null;
  if (!secretEligible(run, id) || secretUnlocked(run, id)) return null;
  return paceCfg().initiationBoost ?? 1.6;
}

function priorityMult(ev) {
  const p = ev.pace?.priority;
  if (!p) return null;
  return 1 + Math.max(0, Math.min(3, p)) * (paceCfg().priorityStep ?? 0.12);
}

function lateMult(ev, run, role) {
  const cfg = paceCfg();
  if ((run.floor || 0) < (cfg.lateFloor ?? 40)) return null;
  if (role === 'payoff') return cfg.lateBoost ?? 1.25;
  if (role === 'callback' && ev.thread) {
    const stage = run.world?.threads?.[ev.thread]?.stage;
    const stages = THREADS[ev.thread]?.stages || [];
    const idx = stages.indexOf(stage);
    if (stage && idx >= 0 && idx < stages.length - 1) return cfg.lateBoost ?? 1.25;
  }
  return null;
}

function term(id, label, mult) {
  return { id, label, mult };
}

function product(terms) {
  return terms.reduce((s, t) => s * (t.mult || 1), 1);
}

/**
 * Shared draw weight. `ctx.offered` is event objects already in this floor's draw.
 */
export function eventDrawWeight(ev, state, ctx = {}) {
  if (!ev) return { w: 0, terms: [term('base', 'Base weight', 0)] };
  const role = eventRole(ev);
  const recent = state.recentCategories || [];
  const base = ev.w || 1;
  const comeback = ev.comeback && state.underdog ? (CONFIG.chargen.comebackWeightMult || 3) : 1;
  const category = historyCategoryWeight(ev.category, recent);
  const tags = tagWeightMult(ev, state);
  const eventId = historyEventWeight(ev.id, state.recentEventIds, state.recentTakenEventIds);

  const terms = [
    term('base', 'Base weight', base),
    term('comeback', 'Comeback', comeback),
    term('category', 'Category history', category),
    term('tags', 'Tags', tags),
  ];
  if (ev.shop && (CONFIG.economy?.merchantWeightBonus || 0)) {
    const bonus = CONFIG.economy.merchantWeightBonus;
    terms.push(term('merchantBonus', 'Merchant frequency', (base + bonus) / Math.max(1, base)));
  }
  if (eventId !== 1) terms.push(term('eventId', 'Recent event', eventId));

  if (ctx.skipPace) return { w: product(terms), terms, role };

  const paceTerms = [];
  const age = ageMult(ev, state, role);
  if (age != null) paceTerms.push(term('age', 'Callback age', age));
  const rel = relevanceMult(ev, state, role);
  if (rel != null) paceTerms.push(term('relevance', 'Thread relevance', rel));
  const cong = congestionMult(ev, state, role, ctx);
  if (cong != null) paceTerms.push(term('congestion', 'Recent narrative', cong));
  const ini = initiationMult(ev, state, role);
  if (ini != null) paceTerms.push(term('initiation', 'Initiation', ini));
  const pri = priorityMult(ev);
  if (pri != null) paceTerms.push(term('priority', 'Authored priority', pri));
  const late = lateMult(ev, state, role);
  if (late != null) paceTerms.push(term('late', 'Late-game payoff', late));

  const cfg = paceCfg();
  const paceRaw = product(paceTerms);
  const paceClamped = Math.max(cfg.paceMin ?? 0.2, Math.min(cfg.paceMax ?? 2.5, paceRaw || 1));
  if (paceTerms.length && Math.abs(paceClamped - paceRaw) > 1e-9) {
    paceTerms.push(term('paceCap', 'Pace cap', paceClamped / paceRaw));
  }
  terms.push(...paceTerms);
  return { w: product(terms), terms, role };
}

/** Alias so debug and gameplay cannot drift. */
export function explainDrawWeight(ev, state, ctx = {}) {
  return eventDrawWeight(ev, state, ctx);
}

export function noteNarrativeTake(run, ev) {
  if (!run || !ev?.id) return;
  if (!Array.isArray(run.recentNarrative)) run.recentNarrative = [];
  run.recentNarrative.push({
    id: ev.id,
    family: ev.family || null,
    thread: ev.thread || null,
    npc: npcKey(ev),
    role: eventRole(ev),
    floor: run.floor || 0,
  });
  const keep = (paceCfg().narrativeWindow ?? 4) * 2;
  if (run.recentNarrative.length > keep) {
    run.recentNarrative = run.recentNarrative.slice(-(paceCfg().narrativeWindow ?? 4));
  }
}
