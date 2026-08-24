#!/usr/bin/env node
// Secret-route diagnostics — natural stumble vs pursuit.
//   node tools/run_secret_routes.js --seed 20260823 --trials 80
// Climb generation uses live draw rules. Policy decisions use a separate RNG
// and never consume climb RNG merely to inspect or choose a card/choice.

import { makeRng } from '../js/rng.js';
import { EVENTS, eventDrawPool } from '../js/data/events.js';
import { SECRET_ROUTES, secretEligible, eventEligible } from '../js/data/world.js';
import { newRun, rollStart } from '../js/state.js';
import { simulateHealthClimb } from './run_health_climb.js';
import { reqMetHeadless } from './sim_run_state.js';

const PRECURSORS = {
  doomguard: ['doom_named', 'doom_benefits', 'doom_benefits_return', 'axe_northman_watch'],
  void_scholar: ['void_annotation', 'void_annotation_return', 'ancient_tree', 'dark_mage_meet', 'buried_library'],
  stormcaller: ['storm_owed', 'pathfinder_meet', 'pathfinder_watch', 'storm_collect', 'storm_collect_return'],
  phantom: ['shadow_ledger', 'phantom_file', 'phantom_file_return', 'wounded_adventurer', 'old_shrine', 'ice_garden'],
  heretic_saint: ['cracked_halo', 'old_shrine', 'halo_vocation', 'halo_vocation_return'],
  ashen_fist: ['still_stone', 'ashen_strike', 'ashen_strike_return'],
  lightbreaker: ['dawn_pact', 'dawn_pact_return', 'heartbeat_story', 'chained_angel', 'devils_contract'],
  doomsinger: ['bard', 'doomsong_offer', 'doomsong_offer_return', 'unsung_verse'],
  lichling: ['pale_rite', 'pale_rite_return', 'pale_choir_cache', 'gravekeeper'],
  void_edge: ['eclipse_cut', 'eclipse_accept', 'eclipse_accept_return'],
  einherjar: ['axe_northman_meet', 'axe_northman_watch', 'doom_named', 'valhalla_notice', 'valhalla_notice_return'],
};

const COMBAT_FALLBACK = new Set(['doomguard', 'lichling', 'einherjar']);

const PURSUIT_CHOICE_LABELS = {
  storm_owed: ['Pocket the IOU'],
  pathfinder_watch: ['Ask about the sky\'s ledger'],
  doom_named: ['Nod back'],
  axe_northman_watch: ['Ask what he means by colleague'],
  eclipse_cut: ['Practice the gap'],
  still_stone: ['Guard the stone'],
  shadow_ledger: ['Sign the silhouette', 'Steal the book'],
  cracked_halo: ['Let it settle on you'],
  heartbeat_story: ['Remember the shape of it', 'Buy the next round for the story'],
  chained_angel: ['Unmake the chains with the pact', 'Break the chains', 'Ask what question it asked'],
  devils_contract: ['Sign it'],
  ancient_tree: ['What are you?', 'Ask it a question'],
  dark_mage_meet: ['Ask about the tower'],
  wounded_adventurer: ['Loot her pack while she sleeps'],
  old_shrine: ['Deface the shrine'],
  ice_garden: ['Pick the rose'],
  unsung_verse: ['Hum the missing bar'],
};

function arg(name, fallback) {
  const eq = process.argv.find(a => a.startsWith(`--${name}=`));
  if (eq) {
    const v = eq.slice(name.length + 3);
    const n = Number(v);
    return Number.isFinite(n) && String(n) === v ? n : v;
  }
  const idx = process.argv.findIndex(a => a === `--${name}`);
  if (idx >= 0 && process.argv[idx + 1] != null && !String(process.argv[idx + 1]).startsWith('--')) {
    const v = process.argv[idx + 1];
    const n = Number(v);
    return Number.isFinite(n) && String(n) === v ? n : v;
  }
  return fallback;
}

function pct(n, d) {
  if (!d) return '0%';
  return `${Math.round((n / d) * 100)}%`;
}

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function assess({ naturalQual, naturalOffer, pursuitQual, pursuitOffer }) {
  if (pursuitQual < 0.15 && naturalQual < 0.05) return 'UNREACHABLE';
  if (pursuitQual >= 0.45 && pursuitOffer < 0.12) return 'STARVED';
  if (naturalQual >= 0.80 && naturalOffer >= 0.70) return 'TOO COMMON';
  if (naturalQual < 0.22 && pursuitQual >= 0.50 && pursuitOffer >= 0.35) return 'RARE BUT FUNCTIONAL';
  return 'HEALTHY';
}

function pickPursuitCard(secretId) {
  const prefer = new Set(PRECURSORS[secretId] || []);
  const wantCombat = COMBAT_FALLBACK.has(secretId);
  const initiation = SECRET_ROUTES[secretId]?.initiation;
  const ret = initiation ? `${initiation}_return` : null;
  return (cards) => {
    const ini = cards.find(c => c.eventId && c.eventId === initiation);
    if (ini) return ini;
    const back = ret ? cards.find(c => c.eventId === ret) : null;
    if (back) return back;
    const precursor = cards.find(c => prefer.has(c.eventId));
    if (precursor) return precursor;
    if (wantCombat) {
      const fight = cards.find(c => c.kind === 'encounter');
      if (fight) return fight;
    }
    return cards[0];
  };
}

function outcomeWritesUseful(outcome, secretId) {
  if (!outcome) return false;
  if (outcome.world?.unlockSecret === secretId) return true;
  const spec = SECRET_ROUTES[secretId];
  if (!spec) return false;
  const knowledge = [].concat(outcome.world?.knowledge || []);
  const flags = [outcome.flag, outcome.world?.flag].filter(Boolean);
  const blob = JSON.stringify(spec);
  return knowledge.some(k => blob.includes(`'${k}'`) || blob.includes(`"${k}"`))
    || flags.some(f => blob.includes(`'${f}'`) || blob.includes(`"${f}"`));
}

function pickPursuitChoice(secretId, policy = 'always-accept-secret') {
  return (run, ev) => {
    const choices = (ev.choices || []).filter(c => reqMetHeadless(run, c.req).ok);
    if (!choices.length) return null;
    const isInitiation = SECRET_ROUTES[secretId]?.initiation === ev.id;
    const isReturn = `${SECRET_ROUTES[secretId]?.initiation}_return` === ev.id;
    if (isInitiation || isReturn) {
      const unlocker = choices.find(c => c.outcome?.world?.unlockSecret === secretId);
      const deferrer = choices.find(c => {
        const k = c.outcome?.world?.knowledge;
        const list = Array.isArray(k) ? k : (k ? [k] : []);
        return list.some(x => String(x).includes('deferred'));
      });
      if (policy === 'always-defer-secret' && deferrer) return deferrer;
      if (unlocker) return unlocker;
    }
    const labels = PURSUIT_CHOICE_LABELS[ev.id] || [];
    for (const label of labels) {
      const hit = choices.find(c => c.label === label);
      if (hit) return hit;
    }
    const useful = choices.find(c => outcomeWritesUseful(c.outcome, secretId));
    if (useful) return useful;
    return choices[0];
  };
}

function qualified(s) {
  return s.eligibleFloor != null || s.finalEligible || s.unlocked || s.outcome === 'accepted';
}

function summarize(rows, secretId) {
  const n = rows.length || 1;
  let qual = 0;
  let offer = 0;
  let accepted = 0;
  let viaRoute = 0;
  let viaFallback = 0;
  let retOffer = 0;
  for (const r of rows) {
    const s = r.secrets?.[secretId] || {};
    if (qualified(s)) qual += 1;
    if (s.offeredFloor != null) offer += 1;
    if (s.outcome === 'accepted' || s.unlocked) accepted += 1;
    if (s.via === 'route') viaRoute += 1;
    if (s.via === 'fallback') viaFallback += 1;
    if (s.returnOfferedFloor != null) retOffer += 1;
  }
  return {
    n: rows.length,
    qual: qual / n,
    offer: offer / n,
    accepted: accepted / n,
    viaRoute: viaRoute / n,
    viaFallback: viaFallback / n,
    returnOffer: retOffer / n,
    meanKills: mean(rows.map(r => r.finalKills || 0)),
    meanLk: mean(rows.map(r => r.finalStats?.lk || 0)),
    meanFame: mean(rows.map(r => r.finalFame || 0)),
    meanGold: mean(rows.map(r => r.finalGold || 0)),
  };
}

function probeInitiationOffer(secretId, prep, floors = 12) {
  const spec = SECRET_ROUTES[secretId];
  const ev = EVENTS.find(e => e.id === spec.initiation);
  let inPool = 0;
  const weights = [];
  for (let i = 0; i < 40; i++) {
    const run = newRun({ upgrades: {}, achievements: [] }, {
      classId: spec.parent, raceId: 'human', name: 'Probe',
      seed: 9000 + i, kitSeed: 9000 + i,
      gen: rollStart(spec.parent, 'human', 9000 + i),
    });
    run.floor = 10;
    run.biomeId = 'forest';
    prep(run);
    if (!secretEligible(run, secretId) || !eventEligible(ev, run)) continue;
    for (let f = 0; f < floors; f++) {
      run.floor = 10 + f;
      const pool = eventDrawPool(run);
      const row = pool.find(p => p.id === spec.initiation);
      if (row) {
        inPool += 1;
        weights.push(row.w);
      }
    }
  }
  return { inPool, meanW: mean(weights), samples: 40 * floors };
}

function biomeForFloorNum(floor) {
  if (floor <= 10) return 'forest';
  if (floor <= 20) return 'ruins';
  if (floor <= 30) return 'frost';
  if (floor <= 40) return 'swamp';
  if (floor <= 50) return 'hell';
  return 'throne';
}

function returnWindowOk(secretId) {
  const spec = SECRET_ROUTES[secretId];
  const ev = EVENTS.find(e => e.id === `${spec.initiation}_return`);
  if (!ev) return { ok: false, reason: 'no return event' };
  if (ev.biome && ev.biome !== 'any') {
    const min = ev.when?.floorMin ?? 16;
    const biome = biomeForFloorNum(min);
    if (ev.biome !== biome && ev.biome !== 'any') {
      return { ok: false, reason: `biome ${ev.biome} vs floor ${min} (${biome})` };
    }
  }
  return { ok: true, event: ev };
}

async function main() {
  const seed = Number(arg('seed', 20260823)) || 20260823;
  const trials = Number(arg('trials', 36)) || 36;
  const ids = Object.keys(SECRET_ROUTES);
  const lines = [];
  lines.push('SECRET ROUTE REPORT');
  lines.push(`seed ${seed}  trials/class ${trials}  survive=true`);
  lines.push('');

  const rangerLk = { 10: [], 20: [], 30: [], 40: [] };
  const table = [];

  for (const id of ids) {
    const spec = SECRET_ROUTES[id];
    const natural = [];
    const pursuit = [];
    const declined = [];
    for (let i = 0; i < trials; i++) {
      const rngN = makeRng((seed + i * 9973 + id.length * 13) >>> 0);
      const rngP = makeRng((seed + i * 7919 + id.length * 29) >>> 0);
      const rngD = makeRng((seed + i * 6733 + id.length * 17) >>> 0);
      const nat = simulateHealthClimb(rngN, {
        classId: spec.parent, survive: true,
      });
      const pur = simulateHealthClimb(rngP, {
        classId: spec.parent, survive: true,
        policy: 'always-accept-secret',
        pickCard: pickPursuitCard(id),
        pickTravelChoice: pickPursuitChoice(id, 'always-accept-secret'),
      });
      const def = simulateHealthClimb(rngD, {
        classId: spec.parent, survive: true,
        policy: 'always-defer-secret',
        pickCard: pickPursuitCard(id),
        pickTravelChoice: pickPursuitChoice(id, 'always-defer-secret'),
      });
      natural.push(nat);
      pursuit.push(pur);
      declined.push(def);
      if (id === 'stormcaller') {
        for (const row of nat.lkHeld || []) {
          if (rangerLk[row.floor]) rangerLk[row.floor].push(row.lk);
        }
      }
    }
    const nS = summarize(natural, id);
    const pS = summarize(pursuit, id);
    const dS = summarize(declined, id);
    const grade = assess({
      naturalQual: nS.qual, naturalOffer: nS.offer,
      pursuitQual: pS.qual, pursuitOffer: pS.offer,
    });
    table.push({ id, name: spec.name, parent: spec.parent, nS, pS, dS, grade });
    lines.push(spec.name);
    lines.push(`  parent ${spec.parent}  initiation ${spec.initiation}`);
    lines.push(`  Natural qualification: ${pct(nS.qual, 1)}   offer: ${pct(nS.offer, 1)}   accept: ${pct(nS.accepted, 1)}`);
    lines.push(`  Pursuit qualification: ${pct(pS.qual, 1)}   offer: ${pct(pS.offer, 1)}   accept: ${pct(pS.accepted, 1)}`);
    lines.push(`  Decline→return offer: ${pct(dS.returnOffer, 1)}   (deferred climbs)`);
    lines.push(`  via route/fallback (natural): ${pct(nS.viaRoute, 1)} / ${pct(nS.viaFallback, 1)}`);
    lines.push(`  mean kills/lk/fame/gold natural: ${nS.meanKills.toFixed(1)} / ${nS.meanLk.toFixed(1)} / ${nS.meanFame.toFixed(1)} / ${nS.meanGold.toFixed(0)}`);
    lines.push(`  Assessment: ${grade}`);
    lines.push('');
  }

  lines.push('Ranger luck (natural Stormcaller climbs):');
  for (const floor of [10, 20, 30, 40]) {
    const vals = rangerLk[floor];
    const ge12 = vals.filter(v => v >= 12).length;
    const ge14 = vals.filter(v => v >= 14).length;
    const ge16 = vals.filter(v => v >= 16).length;
    lines.push(`  F${floor}: mean ${mean(vals).toFixed(1)}  >=12 ${pct(ge12, vals.length)}  >=14 ${pct(ge14, vals.length)}  >=16 ${pct(ge16, vals.length)}  n=${vals.length}`);
  }
  lines.push('');

  const doomPrep = (run) => { run.kills = 20; };
  const stormPrep = (run) => { run.stats = { ...run.stats, lk: 8 }; };
  const doomProbe = probeInitiationOffer('doomguard', doomPrep);
  const stormFresh = probeInitiationOffer('stormcaller', stormPrep);
  lines.push('Eligible-pool probes (synthetic, 40 runs × 12 floors):');
  lines.push(`  doom_benefits when kills=20: in-pool ${doomProbe.inPool}/${doomProbe.samples}  mean w ${doomProbe.meanW.toFixed(1)}`);
  lines.push(`  storm_collect when lk=8 (no owed): in-pool ${stormFresh.inPool}/${stormFresh.samples}  mean w ${stormFresh.meanW.toFixed(1)}`);
  lines.push('');
  lines.push('Return windows:');
  for (const id of ids) {
    const win = returnWindowOk(id);
    lines.push(`  ${SECRET_ROUTES[id].name}: ${win.ok ? 'ok' : win.reason}`);
  }

  console.log(lines.join('\n'));
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/run_secret_routes.js');
if (isMain) main();

export {
  assess, pickPursuitCard, pickPursuitChoice, PRECURSORS, PURSUIT_CHOICE_LABELS,
  returnWindowOk,
};
