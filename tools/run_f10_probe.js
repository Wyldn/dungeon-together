#!/usr/bin/env node
// F10 combat competence probe — measurement only.
// Compare current autoplay vs a boss-aware policy on identical F10 arrivals.
// Does not retune bosses, classes, Forest, potions, or combat_core.
//
//   node tools/run_f10_probe.js --seed 20260823 --runs 1002
//   node tools/run_f10_probe.js --seed 20260823 --runs 1002 --out reports/f10_competence.json

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { SKILLS } from '../js/data/skills.js';
import { CONSUMABLES } from '../js/data/items.js';
import { CONFIG } from '../js/data/config.js';
import { biomeForFloor, ENEMIES, pickBossForFloor, ALT_BOSSES } from '../js/data/enemies.js';
import { planBossEncounter } from '../js/data/balance.js';
import { cloneRunState } from '../js/data/world.js';
import { enterNextFloor } from '../js/floor.js';
import { runRng } from '../js/state.js';
import { buildEnemy } from '../js/combat_core.js';
import { chooseAutoPlayAction } from '../js/combat_policy.js';
import { simulateClimbV2, makeV2Run } from './run_climb_v2.js';
import { baselinePolicy } from './policies/baseline.js';
import { chooseBossAwareAction } from './policies/boss_aware.js';
import { runHeadlessFight } from './combat_headless.js';
import { BASE_CLASSES, climbSeed, planDifficultyJobs } from './run_difficulty.js';

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

export const CONDITIONS = [
  { id: 'autoplay_observed', policy: 'autoplay', hp: 'observed' },
  { id: 'autoplay_full', policy: 'autoplay', hp: 'full' },
  { id: 'bossaware_observed', policy: 'boss-aware', hp: 'observed' },
  { id: 'bossaware_full', policy: 'boss-aware', hp: 'full' },
];

export const SWEEP_PCTS = [0.60, 0.75, 0.90];

const BOSS_IDS = {
  elderwood: 'Sylvanor',
  gv_grotto_escape_2_boss_dragon: 'Cinderghast',
};

function chooserFor(name) {
  if (name === 'boss-aware') return chooseBossAwareAction;
  return chooseAutoPlayAction;
}

function healConsumableCount(run) {
  return (run.consumables || []).filter(id => {
    const c = CONSUMABLES.find(x => x.id === id);
    return !!(c && (c.heal || c.healPct));
  }).length;
}

export function parseCombatLogs(logs = []) {
  const dmg = { basic: 0, special: {}, burn: 0, poison: 0, torment: 0 };
  let lastHit = null;
  let guards = 0;
  let heals = 0;
  for (const row of logs) {
    const msg = row?.msg || row || '';
    if (/You brace behind your guard/.test(msg)) guards += 1;
    if (/^Used |Close wounds|You raise a ward/.test(msg) && /potion|mend|ward|Used /i.test(msg)) {
      if (/Used /.test(msg) || /Mend|Benediction|Sanctuary|Iron Stance/.test(msg)) heals += 1;
    }
    let m = msg.match(/^(.+) \(([^)]+)\) hits you for (\d+)/);
    if (m) {
      const amt = Number(m[3]);
      const spec = m[2];
      dmg.special[spec] = (dmg.special[spec] || 0) + amt;
      lastHit = { kind: 'special', name: spec, amt };
      continue;
    }
    m = msg.match(/^(.+) hits you for (\d+)/);
    if (m) {
      const amt = Number(m[2]);
      dmg.basic += amt;
      lastHit = { kind: 'basic', name: m[1], amt };
      continue;
    }
    m = msg.match(/You burn for (\d+)/);
    if (m) {
      dmg.burn += Number(m[1]);
      lastHit = { kind: 'burn', name: 'burn', amt: Number(m[1]) };
      continue;
    }
    m = msg.match(/Poison courses through you for (\d+)/);
    if (m) {
      dmg.poison += Number(m[1]);
      lastHit = { kind: 'poison', name: 'poison', amt: Number(m[1]) };
      continue;
    }
    m = msg.match(/Torment claws you for (\d+)/);
    if (m) {
      dmg.torment += Number(m[1]);
      lastHit = { kind: 'torment', name: 'torment', amt: Number(m[1]) };
    }
  }
  return { dmg, lastHit, logGuards: guards };
}

function wrapChooser(choose, stats) {
  let acts = 0;
  return (f) => {
    acts += 1;
    if (acts > 160) return { type: 'useSkill', skillId: 'basic_attack', enemy: 0 };
    const action = choose(f);
    stats.actions += 1;
    if (action?.type === 'useConsumable') stats.potionHeals += 1;
    const sk = action?.skillId ? SKILLS[action.skillId] : null;
    if (action?.skillId === 'guard') stats.guards += 1;
    if (sk?.healPct && (sk.target === 'self' || sk.allyTarget) && !sk.power) stats.skillHeals += 1;
    if (sk?.healPct && sk.power) stats.skillHeals += 1;
    if (sk?.shield || sk?.tauntTurns) stats.wards += 1;
    if (sk?.tauntTurns) stats.taunts += 1;
    return action;
  };
}

export async function fightF10(run, choose) {
  const rngPick = runRng(run);
  const boss = pickBossForFloor(run.floor, rngPick, run);
  rngPick.advance();
  const rng = runRng(run);
  const biome = biomeForFloor(run.floor);
  const plan = planBossEncounter(rng, {
    floor: run.floor,
    boss,
    pool: ENEMIES[biome.id] || ENEMIES.hell,
    partySize: 1,
  });
  rng.advance();
  const enemies = plan.specs.map((s, i) => buildEnemy(s, run.floor, biome.floors[0], {
    boss: !!s.boss || s.id === boss.id,
    hpMult: plan.hpMult,
    spawnIndex: i,
  }));
  const stats = { actions: 0, potionHeals: 0, skillHeals: 0, guards: 0, wards: 0, taunts: 0 };
  const result = await runHeadlessFight({
    run,
    rng,
    enemies,
    policy: wrapChooser(choose, stats),
    faithful: true,
  });
  const parsed = parseCombatLogs(result.logs || []);
  const win = result.result === 'win' || result.outcome === 'win';
  const dead = result.result === 'dead' || result.outcome === 'dead' || run.hp <= 0;
  return {
    win,
    dead,
    rounds: result.round || 0,
    hpLeft: run.hp,
    maxHp: run.maxHp,
    bossId: boss?.id || null,
    bossName: boss?.name || null,
    isAlt: !!(boss?.id && Object.values(ALT_BOSSES).some(b => b?.id === boss.id)),
    escort: enemies.filter(e => !e.boss).map(e => e.id),
    stats,
    parsed,
    kill: dead ? parsed.lastHit : null,
  };
}

export async function captureF10Arrival({ seed, classId, policy = 'baseline' } = {}) {
  const climbPolicy = policy === 'reasonable'
    ? (await import('./policies/reasonable.js')).reasonablePolicy()
    : baselinePolicy();
  const run = makeV2Run({ seed, classId, kitSeed: seed, name: 'F10Probe' });
  const climb = await simulateClimbV2(run, climbPolicy, { stopAfterFloor: 9 });
  if (climb.outcome === 'dead' || run.hp <= 0 || run.floor < 9) {
    return { reached: false, seed, classId, deathFloor: climb.deathFloor || run.floor };
  }
  const f9 = climb.trace?.find(r => r.floor === 9);
  const f9LeaveHp = run.hp;
  const f9LeaveMax = run.maxHp;
  const f9Choice = f9?.meta?.choice || null;
  enterNextFloor(run);
  return {
    reached: true,
    seed,
    classId,
    subclassId: run.subclassId || null,
    run,
    bossId: run.bossPicks?.[10] || null,
    arrival: {
      hp: run.hp,
      maxHp: run.maxHp,
      hpPct: run.hp / Math.max(1, run.maxHp),
      mp: run.mp,
      maxMp: run.maxMp,
      gold: run.gold,
      level: run.level,
      potions: healConsumableCount(run),
      consumables: [...(run.consumables || [])],
      skills: [...(run.skills || [])],
      rngState: run.rngState,
    },
    f9: {
      choice: f9Choice,
      leaveHp: f9LeaveHp,
      leaveMaxHp: f9LeaveMax,
      leaveHpPct: f9LeaveHp / Math.max(1, f9LeaveMax),
      enterHpPct: f9?.enter?.hpPct ?? null,
      breathGain: run.hp - f9LeaveHp,
    },
  };
}

function applyHpMode(run, mode, observedHp) {
  if (mode === 'full') run.hp = run.maxHp;
  else if (typeof mode === 'number') {
    run.hp = Math.max(1, Math.min(run.maxHp, Math.round(run.maxHp * mode)));
  } else {
    run.hp = Math.max(1, Math.min(run.maxHp, observedHp));
  }
}

export async function replayArrival(arrival, { policy, hp } = {}) {
  const run = cloneRunState(arrival.run);
  const observedHp = arrival.arrival.hp;
  applyHpMode(run, hp, observedHp);
  const hpEnter = run.hp;
  const hpEnterPct = run.hp / Math.max(1, run.maxHp);
  const fight = await fightF10(run, chooserFor(policy));
  return {
    policy,
    hpMode: hp,
    hpEnter,
    hpEnterPct,
    ...fight,
  };
}

function emptyAgg() {
  return {
    n: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    turns: [],
    hpEnter: [],
    hpEnterAbs: [],
    hpLeftWin: [],
    potionHeals: 0,
    skillHeals: 0,
    guards: 0,
    wards: 0,
    taunts: 0,
    kills: {},
    dmgBasic: 0,
    dmgBurn: 0,
    dmgSpecial: {},
    byClass: {},
  };
}

function bumpKill(map, kill) {
  const key = kill?.kind === 'special' ? kill.name : (kill?.kind || 'unknown');
  map[key] = (map[key] || 0) + 1;
}

function applyRow(agg, row) {
  agg.n += 1;
  if (row.win) agg.wins += 1;
  else agg.losses += 1;
  agg.turns.push(row.rounds || 0);
  agg.hpEnter.push(row.hpEnterPct);
  agg.hpEnterAbs.push(row.hpEnter);
  if (row.win) agg.hpLeftWin.push(row.hpLeft / Math.max(1, row.maxHp));
  agg.potionHeals += row.stats?.potionHeals || 0;
  agg.skillHeals += row.stats?.skillHeals || 0;
  agg.guards += row.stats?.guards || 0;
  agg.wards += row.stats?.wards || 0;
  agg.taunts += row.stats?.taunts || 0;
  if (!row.win) bumpKill(agg.kills, row.kill);
  const dmg = row.parsed?.dmg || {};
  agg.dmgBasic += dmg.basic || 0;
  agg.dmgBurn += dmg.burn || 0;
  for (const [name, v] of Object.entries(dmg.special || {})) {
    agg.dmgSpecial[name] = (agg.dmgSpecial[name] || 0) + v;
  }
}

function addFight(agg, row, classId) {
  applyRow(agg, row);
  if (classId) {
    if (!agg.byClass[classId]) agg.byClass[classId] = emptyAgg();
    applyRow(agg.byClass[classId], row);
  }
}

function mean(arr) {
  const nums = (arr || []).filter(v => v != null && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function finishAgg(agg) {
  agg.winRate = agg.n ? agg.wins / agg.n : 0;
  agg.avgTurns = mean(agg.turns);
  agg.avgHpEnter = mean(agg.hpEnter);
  agg.avgHpEnterAbs = mean(agg.hpEnterAbs);
  agg.avgHpLeftWin = mean(agg.hpLeftWin);
  agg.avgPotionHeals = agg.n ? agg.potionHeals / agg.n : 0;
  agg.avgSkillHeals = agg.n ? agg.skillHeals / agg.n : 0;
  agg.avgGuards = agg.n ? agg.guards / agg.n : 0;
  agg.avgWards = agg.n ? agg.wards / agg.n : 0;
  agg.avgTaunts = agg.n ? agg.taunts / agg.n : 0;
  const kills = Object.entries(agg.kills).sort((a, b) => b[1] - a[1]);
  agg.topKills = kills.slice(0, 8).map(([name, n]) => ({ name, n, rate: agg.losses ? n / agg.losses : 0 }));
  const specials = Object.entries(agg.dmgSpecial).sort((a, b) => b[1] - a[1]);
  const dmgTotal = agg.dmgBasic + agg.dmgBurn + specials.reduce((s, [, v]) => s + v, 0);
  agg.dmgShare = {
    basic: dmgTotal ? agg.dmgBasic / dmgTotal : 0,
    burn: dmgTotal ? agg.dmgBurn / dmgTotal : 0,
    specials: specials.map(([name, v]) => ({ name, v, share: dmgTotal ? v / dmgTotal : 0 })),
  };
  for (const cid of Object.keys(agg.byClass || {})) finishAgg(agg.byClass[cid]);
  return agg;
}

function classifyWall(byBoss) {
  const notes = [];
  const labels = new Set();
  for (const [bossId, conds] of Object.entries(byBoss)) {
    const A = conds.autoplay_observed;
    const B = conds.autoplay_full;
    const C = conds.bossaware_observed;
    const D = conds.bossaware_full;
    if (!A || !D) continue;
    const name = BOSS_IDS[bossId] || bossId;
    const policyLiftObs = C.winRate - A.winRate;
    const policyLiftFull = D.winRate - B.winRate;
    const classRates = Object.entries(D.byClass || {}).map(([id, g]) => ({ id, wr: g.winRate, n: g.n }));
    const outliers = classRates.filter(c => c.n >= 8 && (c.wr < 0.12 || c.wr > 0.75));
    const extremeLow = classRates.filter(c => c.n >= 8 && c.wr < 0.12);
    const mid = classRates.filter(c => c.n >= 8 && c.wr >= 0.25);

    if (D.winRate < 0.20) {
      labels.add('BOSS BALANCE');
      notes.push(`${name}: boss-aware @ full HP still ${pct(D.winRate)} win`);
    }
    if (D.winRate >= 0.35 && C.winRate < 0.18) {
      labels.add('PRE-BOSS ATTRITION');
      notes.push(`${name}: boss-aware ${pct(D.winRate)} full vs ${pct(C.winRate)} observed`);
    }
    if (policyLiftObs >= 0.25 || (C.winRate >= 0.30 && A.winRate < 0.12)) {
      labels.add('POLICY FAILURE');
      notes.push(`${name}: boss-aware lifts observed ${pct(A.winRate)} → ${pct(C.winRate)}`);
    }
    if (D.winRate >= 0.30 && extremeLow.length && mid.length) {
      labels.add('CLASS INTERACTION');
      notes.push(`${name}: class outliers ${extremeLow.map(c => `${c.id} ${pct(c.wr)}`).join(', ')}`);
    }
    if (policyLiftFull >= 0.15) {
      notes.push(`${name}: even at full HP, policy lift ${pct(B.winRate)} → ${pct(D.winRate)}`);
    }
  }
  if (labels.size === 0) labels.add('MIXED');
  if (labels.size > 1) labels.add('MIXED');
  return { labels: [...labels], notes };
}

function pct(n) {
  return `${(n * 100).toFixed(1)}%`;
}

export function formatProbeReport(rep) {
  const lines = [];
  lines.push(`DungeonTogether F10 combat competence — seed ${rep.meta.seed}  climbs ${rep.meta.climbs}  arrivals ${rep.meta.arrivals}`);
  lines.push(`Capture policy: ${rep.meta.capturePolicy}  climb RNG isolated from combat policy`);
  lines.push('');
  for (const bossId of Object.keys(rep.byBoss)) {
    const name = BOSS_IDS[bossId] || bossId;
    const c = rep.byBoss[bossId];
    lines.push(`=== ${name} (${bossId})  n=${c.autoplay_observed?.n || 0} ===`);
    const rows = [
      ['Current autoplay @ observed HP', c.autoplay_observed],
      ['Current autoplay @ full HP', c.autoplay_full],
      ['Boss-aware @ observed HP', c.bossaware_observed],
      ['Boss-aware @ full HP', c.bossaware_full],
    ];
    for (const [label, g] of rows) {
      if (!g) continue;
      lines.push(
        `  ${label.padEnd(34)}  win ${pct(g.winRate).padStart(6)}  turns ${num(g.avgTurns)}  `
        + `hpIn ${pct(g.avgHpEnter || 0)} (${num(g.avgHpEnterAbs)})  hpWin ${pct(g.avgHpLeftWin || 0)}  `
        + `heal ${num(g.avgPotionHeals)}p/${num(g.avgSkillHeals)}s  guard ${num(g.avgGuards)}  ward ${num(g.avgWards)}`,
      );
      if (g.topKills?.length) {
        lines.push(`      deaths: ${g.topKills.map(k => `${k.name} ${pct(k.rate)}`).join(' | ')}`);
      }
      if (g.dmgShare?.specials?.length) {
        lines.push(`      dmg: basic ${pct(g.dmgShare.basic)}  burn ${pct(g.dmgShare.burn)}  `
          + g.dmgShare.specials.slice(0, 4).map(s => `${s.name} ${pct(s.share)}`).join('  '));
      }
    }
    lines.push('');
    lines.push('  by class (boss-aware @ observed / full):');
    const classes = new Set([
      ...Object.keys(c.bossaware_observed?.byClass || {}),
      ...Object.keys(c.bossaware_full?.byClass || {}),
    ]);
    for (const cid of [...classes].sort()) {
      const o = c.bossaware_observed?.byClass?.[cid];
      const f = c.bossaware_full?.byClass?.[cid];
      const a = c.autoplay_observed?.byClass?.[cid];
      const b = c.autoplay_full?.byClass?.[cid];
      lines.push(
        `    ${cid.padEnd(10)}  auto ${pct(a?.winRate || 0)}/${pct(b?.winRate || 0)}  `
        + `aware ${pct(o?.winRate || 0)}/${pct(f?.winRate || 0)}  n ${o?.n || 0}`,
      );
    }
    lines.push('');
  }
  if (rep.handoff) {
    const h = rep.handoff;
    lines.push('=== F9 → F10 handoff ===');
    lines.push(`  F9 campfire choices: ${Object.entries(h.f9Choices).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
    lines.push(`  avg HP leave F9 ${pct(h.avgF9LeaveHpPct || 0)}  enter F10 ${pct(h.avgF10EnterHpPct || 0)}  breath +${h.avgBreathAbs?.toFixed?.(1) ?? h.avgBreathAbs} HP`);
    lines.push(`  avg potions at F10 ${num(h.avgPotions)}  avg MP ${pct(h.avgMpPct || 0)}`);
    if (h.sweep) {
      lines.push('  boss-aware survival by starting HP:');
      for (const row of h.sweep) {
        lines.push(`    ${String(row.label).padEnd(10)}  ${nameSweep(row)}`);
      }
    }
    lines.push('');
  }
  lines.push('=== Classification ===');
  lines.push(`  ${rep.classification.labels.join(' + ')}`);
  for (const n of rep.classification.notes) lines.push(`  - ${n}`);
  lines.push('');
  lines.push(`Campfire Sleep restores +20% HP + potion_s; floor breath is ${Math.round((CONFIG.recovery.floorHealPct || 0) * 100)}% HP.`);
  return lines.join('\n');
}

function nameSweep(row) {
  const parts = Object.entries(row.byBoss || {}).map(([id, g]) => `${BOSS_IDS[id] || id} ${pct(g.winRate)} n=${g.n}`);
  return parts.join('  ') || pct(row.winRate || 0);
}

function num(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (Math.round(v * 10) / 10).toFixed(1);
}

export async function runF10Probe({
  seed = 20260823,
  runs = 1002,
  capturePolicy = 'baseline',
  classId = null,
  sweep = true,
} = {}) {
  const { jobs } = planDifficultyJobs({ seed, runs, classId, classes: BASE_CLASSES });
  const byBoss = {};
  const handoff = {
    f9Choices: {},
    f9Leave: [],
    f10Enter: [],
    breath: [],
    potions: [],
    mpPct: [],
    sweep: sweep ? SWEEP_PCTS.map(p => ({ label: `${Math.round(p * 100)}%`, pct: p, byBoss: {}, winRate: 0, n: 0, wins: 0 })) : null,
  };
  let climbs = 0;
  let arrivals = 0;

  for (const job of jobs) {
    climbs += 1;
    const cap = await captureF10Arrival({ seed: job.seed, classId: job.classId, policy: capturePolicy });
    if (!cap.reached) continue;
    arrivals += 1;
    const bossId = cap.bossId || cap.run.bossPicks?.[10] || 'unknown';
    if (!byBoss[bossId]) {
      byBoss[bossId] = {
        autoplay_observed: emptyAgg(),
        autoplay_full: emptyAgg(),
        bossaware_observed: emptyAgg(),
        bossaware_full: emptyAgg(),
      };
    }
    if (cap.f9?.choice) handoff.f9Choices[cap.f9.choice] = (handoff.f9Choices[cap.f9.choice] || 0) + 1;
    if (cap.f9?.leaveHpPct != null) handoff.f9Leave.push(cap.f9.leaveHpPct);
    handoff.f10Enter.push(cap.arrival.hpPct);
    handoff.breath.push(cap.f9?.breathGain ?? 0);
    handoff.potions.push(cap.arrival.potions);
    handoff.mpPct.push(cap.arrival.maxMp ? cap.arrival.mp / cap.arrival.maxMp : 0);

    for (const cond of CONDITIONS) {
      const row = await replayArrival(cap, cond);
      addFight(byBoss[bossId][cond.id], row, cap.classId);
    }
    if (handoff.sweep) {
      for (const band of handoff.sweep) {
        const row = await replayArrival(cap, { policy: 'boss-aware', hp: band.pct });
        if (!band.byBoss[bossId]) band.byBoss[bossId] = emptyAgg();
        addFight(band.byBoss[bossId], row, null);
        band.n += 1;
        if (row.win) band.wins += 1;
      }
    }
  }

  for (const bossId of Object.keys(byBoss)) {
    for (const id of Object.keys(byBoss[bossId])) finishAgg(byBoss[bossId][id]);
  }
  if (handoff.sweep) {
    for (const band of handoff.sweep) {
      band.winRate = band.n ? band.wins / band.n : 0;
      for (const bossId of Object.keys(band.byBoss)) finishAgg(band.byBoss[bossId]);
    }
  }
  handoff.avgF9LeaveHpPct = mean(handoff.f9Leave);
  handoff.avgF10EnterHpPct = mean(handoff.f10Enter);
  handoff.avgBreathAbs = mean(handoff.breath);
  handoff.avgPotions = mean(handoff.potions);
  handoff.avgMpPct = mean(handoff.mpPct);

  const classification = classifyWall(byBoss);
  return {
    meta: {
      name: 'F10_COMPETENCE',
      seed,
      climbs,
      arrivals,
      capturePolicy,
      generatedAt: new Date().toISOString(),
    },
    byBoss,
    handoff,
    classification,
  };
}

function parseArgs(argv) {
  const flags = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, v] = a.replace(/^--/, '').split('=');
    flags[k] = v === undefined ? true : v;
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const seed = Number(flags.seed || 20260823);
  const runs = Number(flags.runs || 1002);
  const capturePolicy = String(flags.capture || 'baseline');
  const classId = flags.class || null;
  const out = flags.out || 'reports/f10_competence.json';
  const rep = await runF10Probe({ seed, runs, capturePolicy, classId });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(rep, null, 2));
  console.log(formatProbeReport(rep));
  console.log(`\nWrote ${out}`);
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/run_f10_probe.js');
if (isMain) main();
