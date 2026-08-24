#!/usr/bin/env node
// F20 combat competence probe — measurement only.
// Compare current autoplay vs a boss-aware policy on identical F20 arrivals.
// Does not retune Lich, Gravesend, F15–19, classes, potions, or combat_core.
//
//   node tools/run_f20_probe.js --seed 20260823 --runs 1002
//   node tools/run_f20_probe.js --seed 20260823 --runs 1002 --out reports/f20_competence.json

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { SKILLS } from '../js/data/skills.js';
import { CONSUMABLES } from '../js/data/items.js';
import { CONFIG } from '../js/data/config.js';
import { biomeForFloor, ENEMIES, pickBossForFloor, ALT_BOSSES, BOSSES } from '../js/data/enemies.js';
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
import { derived } from '../js/character.js';
import { applyDefense } from '../js/systems.js';
import { enemyScale, soloBossChargeForScale } from '../js/data/tdc.js';

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

export const CONDITIONS = [
  { id: 'autoplay_observed', policy: 'autoplay', hp: 'observed' },
  { id: 'autoplay_full', policy: 'autoplay', hp: 'full' },
  { id: 'bossaware_observed', policy: 'boss-aware', hp: 'observed' },
  { id: 'bossaware_full', policy: 'boss-aware', hp: 'full' },
];

export const BOSS_IDS = {
  lich: 'Lich of the Fallen King',
  undead_executioner: 'Gravesend, the Undead Executioner',
};

const SUMMON_NAME_RE = /Risen Skeleton|Bound Leech|Cinder Imp|Spawn Slime|Sewer Rat/;
const FINISHER_RE = /DYNASTY'S END|THE NEXT NAME|FINISHER|FOREST'S VERDICT|ETERNAL WINTER|UNMELTING CHARGE|SORROW UNENDING|TWO SORROWS|GATEKEEPER'S TOLL|LEFT AT THE POST/;

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

export function parseCombatLogs(logs = [], { bossName } = {}) {
  const dmg = {
    basic: 0, special: {}, burn: 0, poison: 0, torment: 0, summon: 0, escort: 0,
  };
  let lastHit = null;
  let guards = 0;
  let summons = 0;
  let bossHealTicks = 0;
  let playerDmg = 0;
  let freezeApplies = 0;
  let freezeSkips = 0;
  let regenHealed = 0;
  let regenTicks = 0;
  let headRegrows = 0;
  let enrages = 0;
  for (const row of logs) {
    const msg = row?.msg || row || '';
    if (/You brace behind your guard/.test(msg)) guards += 1;
    if (/drags a servant up from the dust/.test(msg)) summons += 1;
    if (/drinks deep/.test(msg)) bossHealTicks += 1;
    if (/^You are frozen!/.test(msg)) freezeApplies += 1;
    if (/You are frozen solid — turn lost/.test(msg)) freezeSkips += 1;
    if (/A severed head regrows/.test(msg)) headRegrows += 1;
    if (/ enrages!$/.test(msg)) enrages += 1;
    const regen = msg.match(/regenerates (\d+)/);
    if (regen) {
      regenHealed += Number(regen[1]);
      regenTicks += 1;
    }

    let m = msg.match(/^(.+) \(([^)]+)\) hits you for (\d+)/);
    if (m) {
      const amt = Number(m[3]);
      const spec = m[2];
      const who = m[1];
      if (SUMMON_NAME_RE.test(who)) dmg.summon += amt;
      else {
        dmg.special[spec] = (dmg.special[spec] || 0) + amt;
      }
      lastHit = {
        kind: FINISHER_RE.test(spec) ? 'finisher' : (SUMMON_NAME_RE.test(who) ? 'summon' : 'special'),
        name: SUMMON_NAME_RE.test(who) ? who : spec,
        amt,
      };
      continue;
    }
    m = msg.match(/^(.+) hits you for (\d+)/);
    if (m) {
      const amt = Number(m[2]);
      const who = m[1];
      if (SUMMON_NAME_RE.test(who)) {
        dmg.summon += amt;
        lastHit = { kind: 'summon', name: who, amt };
      } else if (bossName && who !== bossName && !who.startsWith(bossName.split(',')[0])) {
        dmg.escort += amt;
        lastHit = { kind: 'escort', name: who, amt };
      } else {
        dmg.basic += amt;
        lastHit = { kind: 'basic', name: who, amt };
      }
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
      continue;
    }
    m = msg.match(/hits (?!you\b)(.+) for (\d+)/);
    if (m) playerDmg += Number(m[2]);
  }
  return {
    dmg, lastHit, logGuards: guards, summons, bossHealTicks, playerDmg,
    freezeApplies, freezeSkips, regenHealed, regenTicks, headRegrows, enrages,
  };
}

function wrapChooser(choose, stats) {
  let acts = 0;
  return (f) => {
    acts += 1;
    if (acts > 200) return { type: 'useSkill', skillId: 'basic_attack', enemy: 0 };
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

export async function fightF20(run, choose) {
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
  const bossStart = enemies.find(e => e.boss || e.id === boss.id);
  const stats = { actions: 0, potionHeals: 0, skillHeals: 0, guards: 0, wards: 0, taunts: 0 };
  const result = await runHeadlessFight({
    run,
    rng,
    enemies,
    policy: wrapChooser(choose, stats),
    faithful: true,
  });
  const parsed = parseCombatLogs(result.logs || [], { bossName: boss?.name });
  const win = result.result === 'win' || result.outcome === 'win';
  const dead = result.result === 'dead' || result.outcome === 'dead' || run.hp <= 0;
  const bossEnd = (result.enemies || []).find(e => e.id === boss?.id || e.boss);
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
    bossMaxHp: bossStart?.maxHp || 0,
    bossHpLeft: bossEnd?.hp ?? 0,
    bossAtk: bossStart?.atk || 0,
    stats,
    parsed,
    kill: dead ? parsed.lastHit : null,
  };
}

function snapArrival(run) {
  return {
    hp: run.hp,
    maxHp: run.maxHp,
    hpPct: run.hp / Math.max(1, run.maxHp),
    mp: run.mp,
    maxMp: run.maxMp,
    mpPct: run.maxMp ? run.mp / run.maxMp : 0,
    gold: run.gold,
    level: run.level,
    potions: healConsumableCount(run),
    consumables: [...(run.consumables || [])],
    skills: [...(run.skills || [])],
    skillCount: (run.skills || []).length,
    relics: [...(run.relics || [])],
    relicCount: (run.relics || []).length,
    equipped: Object.values(run.equipment || {}).filter(Boolean).length,
    equipment: { ...(run.equipment || {}) },
    stats: { ...(run.stats || {}) },
    rngState: run.rngState,
  };
}

function traceFloor(trace, floor) {
  return (trace || []).find(r => r.floor === floor) || null;
}

export async function captureF20Arrival({ seed, classId, policy = 'baseline' } = {}) {
  const climbPolicy = policy === 'reasonable'
    ? (await import('./policies/reasonable.js')).reasonablePolicy()
    : baselinePolicy();
  const run = makeV2Run({ seed, classId, kitSeed: seed, name: 'F20Probe' });
  const climb = await simulateClimbV2(run, climbPolicy, { stopAfterFloor: 19 });
  const trace = climb.trace || [];
  const f10 = traceFloor(trace, 10);
  const f15 = traceFloor(trace, 15);
  const f19 = traceFloor(trace, 19);
  const segment = [16, 17, 18, 19].map(fl => traceFloor(trace, fl)).filter(Boolean);

  if (climb.outcome === 'dead' || run.hp <= 0 || run.floor < 19 || !f19 || f19.outcome === 'dead') {
    return {
      reached: false,
      seed,
      classId,
      deathFloor: climb.deathFloor || run.floor,
      f10Enter: f10?.enter || null,
      f15,
      segment,
      trace,
    };
  }

  const f19LeaveHp = run.hp;
  const f19LeaveMax = run.maxHp;
  const f19Choice = f19?.meta?.choice || null;
  enterNextFloor(run);
  return {
    reached: true,
    seed,
    classId,
    subclassId: run.subclassId || null,
    run,
    bossId: run.bossPicks?.[20] || null,
    arrival: snapArrival(run),
    f10Enter: f10?.enter || null,
    f15: f15 ? {
      outcome: f15.outcome,
      bossId: f15.meta?.bossId || null,
      enterHpPct: f15.enter?.hpPct ?? null,
      leaveHpPct: f15.leave?.hpPct ?? null,
      won: f15.outcome !== 'dead',
    } : null,
    f19: {
      choice: f19Choice,
      leaveHp: f19LeaveHp,
      leaveMaxHp: f19LeaveMax,
      leaveHpPct: f19LeaveHp / Math.max(1, f19LeaveMax),
      enterHpPct: f19?.enter?.hpPct ?? null,
      breathGain: run.hp - f19LeaveHp,
    },
    segment,
    trace,
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

export async function replayArrival(arrival, { policy, hp, bossId } = {}) {
  const run = cloneRunState(arrival.run);
  const observedHp = arrival.arrival.hp;
  applyHpMode(run, hp, observedHp);
  if (bossId) {
    run.bossPicks = run.bossPicks || {};
    run.bossPicks[20] = bossId;
  }
  const hpEnter = run.hp;
  const hpEnterPct = run.hp / Math.max(1, run.maxHp);
  const fight = await fightF20(run, chooserFor(policy));
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
    bossHpLeftLoss: [],
    bossMaxHp: [],
    playerDmg: [],
    incoming: [],
    potionHeals: 0,
    skillHeals: 0,
    guards: 0,
    wards: 0,
    taunts: 0,
    summons: 0,
    bossHealTicks: 0,
    kills: {},
    dmgBasic: 0,
    dmgBurn: 0,
    dmgPoison: 0,
    dmgTorment: 0,
    dmgSummon: 0,
    dmgEscort: 0,
    dmgSpecial: {},
    byClass: {},
  };
}

function bumpKill(map, kill) {
  const key = kill?.kind === 'special' || kill?.kind === 'finisher'
    ? kill.name
    : (kill?.kind || 'unknown');
  map[key] = (map[key] || 0) + 1;
}

function incomingTotal(dmg = {}) {
  const specials = Object.values(dmg.special || {}).reduce((s, v) => s + v, 0);
  return (dmg.basic || 0) + (dmg.burn || 0) + (dmg.poison || 0) + (dmg.torment || 0)
    + (dmg.summon || 0) + (dmg.escort || 0) + specials;
}

function applyRow(agg, row) {
  agg.n += 1;
  if (row.win) agg.wins += 1;
  else agg.losses += 1;
  agg.turns.push(row.rounds || 0);
  agg.hpEnter.push(row.hpEnterPct);
  agg.hpEnterAbs.push(row.hpEnter);
  if (row.win) agg.hpLeftWin.push(row.hpLeft / Math.max(1, row.maxHp));
  else agg.bossHpLeftLoss.push((row.bossHpLeft || 0) / Math.max(1, row.bossMaxHp || 1));
  agg.bossMaxHp.push(row.bossMaxHp || 0);
  agg.playerDmg.push(row.parsed?.playerDmg || 0);
  agg.incoming.push(incomingTotal(row.parsed?.dmg));
  agg.potionHeals += row.stats?.potionHeals || 0;
  agg.skillHeals += row.stats?.skillHeals || 0;
  agg.guards += row.stats?.guards || 0;
  agg.wards += row.stats?.wards || 0;
  agg.taunts += row.stats?.taunts || 0;
  agg.summons += row.parsed?.summons || 0;
  agg.bossHealTicks += row.parsed?.bossHealTicks || 0;
  if (!row.win) bumpKill(agg.kills, row.kill);
  const dmg = row.parsed?.dmg || {};
  agg.dmgBasic += dmg.basic || 0;
  agg.dmgBurn += dmg.burn || 0;
  agg.dmgPoison += dmg.poison || 0;
  agg.dmgTorment += dmg.torment || 0;
  agg.dmgSummon += dmg.summon || 0;
  agg.dmgEscort += dmg.escort || 0;
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

function median(arr) {
  const nums = (arr || []).filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function finishAgg(agg) {
  agg.winRate = agg.n ? agg.wins / agg.n : 0;
  agg.avgTurns = mean(agg.turns);
  agg.avgHpEnter = mean(agg.hpEnter);
  agg.avgHpEnterAbs = mean(agg.hpEnterAbs);
  agg.avgHpLeftWin = mean(agg.hpLeftWin);
  agg.avgBossHpLeftLoss = mean(agg.bossHpLeftLoss);
  agg.avgBossMaxHp = mean(agg.bossMaxHp);
  agg.avgPlayerDmg = mean(agg.playerDmg);
  agg.avgIncoming = mean(agg.incoming);
  agg.avgPotionHeals = agg.n ? agg.potionHeals / agg.n : 0;
  agg.avgSkillHeals = agg.n ? agg.skillHeals / agg.n : 0;
  agg.avgGuards = agg.n ? agg.guards / agg.n : 0;
  agg.avgWards = agg.n ? agg.wards / agg.n : 0;
  agg.avgTaunts = agg.n ? agg.taunts / agg.n : 0;
  agg.avgSummons = agg.n ? agg.summons / agg.n : 0;
  agg.avgBossHealTicks = agg.n ? agg.bossHealTicks / agg.n : 0;
  const avgTurns = agg.avgTurns || 1;
  agg.avgPlayerDpt = (agg.avgPlayerDmg || 0) / Math.max(1, avgTurns);
  agg.avgIncomingDpt = (agg.avgIncoming || 0) / Math.max(1, avgTurns);
  const ttk = agg.avgPlayerDpt ? (agg.avgBossMaxHp || 0) / agg.avgPlayerDpt : null;
  const ttl = agg.avgIncomingDpt ? (agg.avgHpEnterAbs || 0) / agg.avgIncomingDpt : null;
  agg.expectedTtk = ttk;
  agg.expectedTtl = ttl;
  const kills = Object.entries(agg.kills).sort((a, b) => b[1] - a[1]);
  agg.topKills = kills.slice(0, 10).map(([name, n]) => ({ name, n, rate: agg.losses ? n / agg.losses : 0 }));
  const specials = Object.entries(agg.dmgSpecial).sort((a, b) => b[1] - a[1]);
  const dmgTotal = agg.dmgBasic + agg.dmgBurn + agg.dmgPoison + agg.dmgTorment
    + agg.dmgSummon + agg.dmgEscort + specials.reduce((s, [, v]) => s + v, 0);
  agg.dmgShare = {
    basic: dmgTotal ? agg.dmgBasic / dmgTotal : 0,
    burn: dmgTotal ? agg.dmgBurn / dmgTotal : 0,
    poison: dmgTotal ? agg.dmgPoison / dmgTotal : 0,
    torment: dmgTotal ? agg.dmgTorment / dmgTotal : 0,
    summon: dmgTotal ? agg.dmgSummon / dmgTotal : 0,
    escort: dmgTotal ? agg.dmgEscort / dmgTotal : 0,
    specials: specials.map(([name, v]) => ({ name, v, share: dmgTotal ? v / dmgTotal : 0 })),
  };
  // Drop raw arrays so reports stay compact and byte-stable.
  delete agg.turns;
  delete agg.hpEnter;
  delete agg.hpEnterAbs;
  delete agg.hpLeftWin;
  delete agg.bossHpLeftLoss;
  delete agg.bossMaxHp;
  delete agg.playerDmg;
  delete agg.incoming;
  for (const cid of Object.keys(agg.byClass || {})) finishAgg(agg.byClass[cid]);
  return agg;
}

function classifyWall(byBoss, arrivals, attrition) {
  const notes = [];
  const votes = [];
  const arrivalN = arrivals?.n || 0;
  if (arrivalN < 12) {
    notes.push(`Only ${arrivalN} F20 arrivals — class/boss slices are noisy`);
    votes.push('INSUFFICIENT SAMPLE');
  }

  const avgHp = arrivals?.avgHpPct;
  if (avgHp != null && avgHp < 0.45) {
    notes.push(`F20 arrivals average ${pct(avgHp)} HP`);
    votes.push('PRE-BOSS ATTRITION');
  }
  if (attrition?.f15Winners && attrition.reachedF20 != null && attrition.f15Winners > 0) {
    const conv = attrition.reachedF20 / attrition.f15Winners;
    if (conv < 0.45) {
      notes.push(`F15 winners → F20 conversion ${pct(conv)} (${attrition.reachedF20}/${attrition.f15Winners})`);
      votes.push('PRE-BOSS ATTRITION');
    }
  }

  for (const [bossId, conds] of Object.entries(byBoss)) {
    const A = conds.autoplay_observed;
    const B = conds.autoplay_full;
    const C = conds.bossaware_observed;
    const D = conds.bossaware_full;
    if (!A || !D) continue;
    const name = BOSS_IDS[bossId] || bossId;
    if (A.n < 8) {
      notes.push(`${name}: n=${A.n} is thin`);
      votes.push('INSUFFICIENT SAMPLE');
      continue;
    }
    const policyLiftObs = C.winRate - A.winRate;
    const policyLiftFull = D.winRate - B.winRate;
    const classRates = Object.entries(D.byClass || {}).map(([id, g]) => ({ id, wr: g.winRate, n: g.n }));
    const extremeLow = classRates.filter(c => c.n >= 5 && c.wr < 0.12);
    const mid = classRates.filter(c => c.n >= 5 && c.wr >= 0.25);

    if (policyLiftObs >= 0.25 || (C.winRate >= 0.30 && A.winRate < 0.12)) {
      votes.push('COMBAT POLICY');
      notes.push(`${name}: boss-aware lifts observed ${pct(A.winRate)} → ${pct(C.winRate)}`);
    }
    if (D.winRate >= 0.35 && C.winRate < 0.18) {
      votes.push('PRE-BOSS ATTRITION');
      notes.push(`${name}: boss-aware ${pct(D.winRate)} full vs ${pct(C.winRate)} observed`);
    }
    if (D.winRate >= 0.30 && extremeLow.length && mid.length) {
      votes.push('CLASS INTERACTION');
      notes.push(`${name}: class outliers ${extremeLow.map(c => `${c.id} ${pct(c.wr)}`).join(', ')}`);
    }
    if (D.winRate < 0.20) {
      votes.push('BOSS BALANCE');
      notes.push(`${name}: boss-aware @ full HP still ${pct(D.winRate)} win (n=${D.n})`);
    }
    if (D.expectedTtk && D.expectedTtl && D.expectedTtk > D.expectedTtl * 1.6 && D.winRate < 0.35) {
      votes.push('BOSS BALANCE');
      notes.push(`${name}: TTK ${num(D.expectedTtk)} vs TTL ${num(D.expectedTtl)} at full HP + boss-aware`);
    }
    if (policyLiftFull >= 0.15) {
      notes.push(`${name}: even at full HP, policy lift ${pct(B.winRate)} → ${pct(D.winRate)}`);
    }
  }

  const unique = [...new Set(votes)];
  let primary = 'MIXED';
  if (unique.length === 1) primary = unique[0];
  else if (unique.length === 0) primary = 'MIXED';
  else if (unique.includes('BOSS BALANCE') && unique.includes('PRE-BOSS ATTRITION')) primary = 'MIXED';
  else if (unique.includes('BOSS BALANCE') && unique.includes('COMBAT POLICY')) primary = 'MIXED';
  else if (unique.includes('INSUFFICIENT SAMPLE') && unique.length > 1) {
    primary = unique.find(v => v !== 'INSUFFICIENT SAMPLE') || 'INSUFFICIENT SAMPLE';
  } else if (unique.includes('BOSS BALANCE')) primary = 'BOSS BALANCE';
  else if (unique.includes('PRE-BOSS ATTRITION')) primary = 'PRE-BOSS ATTRITION';
  else if (unique.includes('COMBAT POLICY')) primary = 'COMBAT POLICY';
  else if (unique.includes('CLASS INTERACTION')) primary = 'CLASS INTERACTION';

  return { labels: [primary], notes, evidence: unique };
}

function pct(n) {
  return `${((n || 0) * 100).toFixed(1)}%`;
}

function num(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (Math.round(v * 10) / 10).toFixed(1);
}

function emptyHealth() {
  return {
    n: 0, hp: [], maxHp: [], hpPct: [], mpPct: [], gold: [], potions: [],
    relics: [], skills: [], equipped: [], level: [],
    byClass: {},
  };
}

function pushHealth(h, snap, classId) {
  if (!snap) return;
  h.n += 1;
  h.hp.push(snap.hp);
  h.maxHp.push(snap.maxHp);
  h.hpPct.push(snap.hpPct);
  h.mpPct.push(snap.mpPct ?? (snap.maxMp ? snap.mp / snap.maxMp : null));
  h.gold.push(snap.gold);
  h.potions.push(snap.potions ?? snap.healConsumables);
  h.relics.push(snap.relicCount ?? snap.relics);
  h.skills.push(snap.skillCount ?? snap.skills);
  h.equipped.push(snap.equipped);
  h.level.push(snap.level);
  if (classId) {
    if (!h.byClass[classId]) h.byClass[classId] = emptyHealth();
    if (h.byClass[classId] !== h) pushHealth(h.byClass[classId], snap, null);
  }
}

function finishHealth(h) {
  const out = {
    n: h.n,
    avgHp: mean(h.hp),
    avgMaxHp: mean(h.maxHp),
    avgHpPct: mean(h.hpPct),
    medHpPct: median(h.hpPct),
    avgMpPct: mean(h.mpPct),
    avgGold: mean(h.gold),
    avgPotions: mean(h.potions),
    avgRelics: mean(h.relics),
    avgSkills: mean(h.skills),
    avgEquipped: mean(h.equipped),
    avgLevel: mean(h.level),
    pctBelow50: h.n ? h.hpPct.filter(v => v < 0.5).length / h.n : 0,
    pctBelow35: h.n ? h.hpPct.filter(v => v < 0.35).length / h.n : 0,
    pctAtOrAbove80: h.n ? h.hpPct.filter(v => v >= 0.8).length / h.n : 0,
    byClass: {},
  };
  for (const [cid, g] of Object.entries(h.byClass || {})) out.byClass[cid] = finishHealth(g);
  return out;
}

function emptyFloorBand() {
  return {
    n: 0, deaths: 0, combat: 0, event: 0, shop: 0, sneakBribe: 0,
    enterHp: [], leaveHp: [], hpDelta: [],
  };
}

function noteSegmentFloor(band, rec) {
  if (!rec) return;
  band.n += 1;
  if (rec.outcome === 'dead') band.deaths += 1;
  const kind = rec.meta?.kind || rec.kind;
  const approach = rec.meta?.approach;
  if (kind === 'encounter' || rec.picked?.kind === 'encounter' || rec.meta?.combat) band.combat += 1;
  if (kind === 'event' || rec.picked?.kind === 'event') band.event += 1;
  if (kind === 'shop' || rec.meta?.kind === 'shop') band.shop += 1;
  if (approach === 'sneak' || approach === 'bribe') band.sneakBribe += 1;
  if (rec.enter?.hpPct != null) band.enterHp.push(rec.enter.hpPct);
  if (rec.leave?.hpPct != null) band.leaveHp.push(rec.leave.hpPct);
  if (rec.enter?.hpPct != null && rec.leave?.hpPct != null) {
    band.hpDelta.push(rec.leave.hpPct - rec.enter.hpPct);
  }
}

function finishFloorBand(band) {
  return {
    n: band.n,
    deaths: band.deaths,
    deathRate: band.n ? band.deaths / band.n : 0,
    combat: band.combat,
    event: band.event,
    shop: band.shop,
    sneakBribe: band.sneakBribe,
    avgEnterHp: mean(band.enterHp),
    avgLeaveHp: mean(band.leaveHp),
    avgHpDelta: mean(band.hpDelta),
  };
}

function theoreticalPressure(bossId) {
  const floor = 20;
  const spec = bossId === 'undead_executioner' ? ALT_BOSSES[20] : BOSSES[20];
  if (!spec) return null;
  const biome = biomeForFloor(floor);
  const sc = enemyScale(floor, biome.floors[0], biome.id, { boss: true, partySize: 1 });
  const ehp = Math.round(spec.hp * sc.hp);
  const eatk = Math.round(spec.atk * sc.atk);
  const specials = spec.specials || [];
  const basicRaw = eatk * (CONFIG.combat.enemyAtkMult ?? 1.35);
  const finisher = specials.reduce((best, s) => (!best || (s.mult || 1) > (best.mult || 1) ? s : best), null);
  const mid = specials.filter(s => s !== finisher).sort((a, b) => (b.mult || 1) - (a.mult || 1))[0] || null;
  return {
    bossId,
    name: spec.name,
    authoredHp: spec.hp,
    authoredAtk: spec.atk,
    scaleHp: sc.hp,
    scaleAtk: sc.atk,
    ehp,
    eatk,
    specials: specials.map(s => ({ at: s.at, name: s.name, mult: s.mult })),
    basicRaw: Math.round(basicRaw),
    midSpecial: mid ? { name: mid.name, at: mid.at, mult: mid.mult } : null,
    finisher: finisher ? { name: finisher.name, at: finisher.at, mult: finisher.mult } : null,
    summons: spec.summons || null,
  };
}

function estimateHitVsArrival(pressure, arrival, special) {
  if (!pressure || !arrival) return null;
  const d = derived({
    ...arrival.run,
    hp: arrival.arrival.hp,
    maxHp: arrival.arrival.maxHp,
  });
  const mult = special?.mult || 1;
  const banked = special ? soloBossChargeForScale(20, special.at || 0) : 0;
  const chargeScale = special ? (1 + (CONFIG.boss?.chargeDamageScale ?? 0.32) * banked) : 1;
  let raw = pressure.eatk * (CONFIG.combat.enemyAtkMult ?? 1.35) * mult * chargeScale;
  raw = applyDefense(raw, d.def);
  raw *= d.dmgTakenMult || 1;
  return Math.max(1, Math.round(raw));
}

export function formatProbeReport(rep) {
  const lines = [];
  lines.push(`DungeonTogether F20 combat competence — seed ${rep.meta.seed}  climbs ${rep.meta.climbs}  arrivals ${rep.meta.arrivals}`);
  lines.push(`Capture policy: ${rep.meta.capturePolicy}  climb RNG isolated from combat policy`);
  lines.push('');

  if (rep.arrivals) {
    const a = rep.arrivals;
    lines.push('=== F20 arrival health ===');
    lines.push(`  n=${a.n}  HP ${num(a.avgHp)}/${num(a.avgMaxHp)} (${pct(a.avgHpPct)}, median ${pct(a.medHpPct)})  `
      + `MP ${pct(a.avgMpPct)}  potions ${num(a.avgPotions)}  gold ${num(a.avgGold)}`);
    lines.push(`  level ${num(a.avgLevel)}  relics ${num(a.avgRelics)}  skills ${num(a.avgSkills)}  equipped ${num(a.avgEquipped)}`);
    lines.push(`  HP <50% ${pct(a.pctBelow50)}  HP <35% ${pct(a.pctBelow35)}  HP ≥80% ${pct(a.pctAtOrAbove80)}`);
    if (a.f15Wins != null) lines.push(`  F15 wins among arrivals: ${a.f15Wins}/${a.n}`);
    if (a.f19Choices) {
      lines.push(`  F19 campfire: ${Object.entries(a.f19Choices).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
    }
    if (a.byClass) {
      lines.push('  by class:');
      for (const cid of Object.keys(a.byClass).sort()) {
        const g = a.byClass[cid];
        lines.push(`    ${cid.padEnd(12)} n=${g.n}  HP ${pct(g.avgHpPct)}  potions ${num(g.avgPotions)}  relics ${num(g.avgRelics)}  skills ${num(g.avgSkills)}`);
      }
    }
    lines.push('');
  }

  if (rep.compareF10) {
    const c = rep.compareF10;
    lines.push('=== F10 vs F20 arrival comparison (same climbs) ===');
    lines.push(`  All F10 arrivals     n=${c.f10All?.n || 0}  HP ${pct(c.f10All?.avgHpPct)}  potions ${num(c.f10All?.avgPotions)}  relics ${num(c.f10All?.avgRelics)}`);
    lines.push(`  F20-bound at F10     n=${c.f20AtF10?.n || 0}  HP ${pct(c.f20AtF10?.avgHpPct)}  potions ${num(c.f20AtF10?.avgPotions)}  relics ${num(c.f20AtF10?.avgRelics)}`);
    lines.push(`  F20 arrivals         n=${c.f20?.n || 0}  HP ${pct(c.f20?.avgHpPct)}  potions ${num(c.f20?.avgPotions)}  relics ${num(c.f20?.avgRelics)}`);
    lines.push('');
  }

  for (const bossId of Object.keys(rep.byBoss || {})) {
    const name = BOSS_IDS[bossId] || bossId;
    const c = rep.byBoss[bossId];
    lines.push(`=== ${name} (${bossId})  n=${c.autoplay_observed?.n || 0} ===`);
    const rows = [
      ['Observed + autoplay', c.autoplay_observed],
      ['Full HP + autoplay', c.autoplay_full],
      ['Observed + boss-aware', c.bossaware_observed],
      ['Full HP + boss-aware', c.bossaware_full],
    ];
    for (const [label, g] of rows) {
      if (!g) continue;
      lines.push(
        `  ${label.padEnd(28)}  win ${pct(g.winRate).padStart(6)}  turns ${num(g.avgTurns)}  `
        + `hpIn ${pct(g.avgHpEnter || 0)} (${num(g.avgHpEnterAbs)})  hpWin ${pct(g.avgHpLeftWin || 0)}  `
        + `bossLeft ${pct(g.avgBossHpLeftLoss || 0)}  `
        + `heal ${num(g.avgPotionHeals)}p/${num(g.avgSkillHeals)}s  guard ${num(g.avgGuards)}  ward ${num(g.avgWards)}`,
      );
      lines.push(`      TTK ${num(g.expectedTtk)}  TTL ${num(g.expectedTtl)}  dpt out ${num(g.avgPlayerDpt)}  dpt in ${num(g.avgIncomingDpt)}  eHP ${num(g.avgBossMaxHp)}`);
      if (g.topKills?.length) {
        lines.push(`      deaths: ${g.topKills.map(k => `${k.name} ${pct(k.rate)}`).join(' | ')}`);
      }
      if (g.dmgShare) {
        const spec = (g.dmgShare.specials || []).slice(0, 4).map(s => `${s.name} ${pct(s.share)}`).join('  ');
        lines.push(`      dmg: basic ${pct(g.dmgShare.basic)}  summon ${pct(g.dmgShare.summon)}  escort ${pct(g.dmgShare.escort)}  `
          + `torment ${pct(g.dmgShare.torment)}  burn ${pct(g.dmgShare.burn)}  ${spec}`);
      }
    }
    lines.push('');
    lines.push('  by class (auto observed/full  |  aware observed/full):');
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
        `    ${cid.padEnd(12)}  auto ${pct(a?.winRate || 0)}/${pct(b?.winRate || 0)}  `
        + `aware ${pct(o?.winRate || 0)}/${pct(f?.winRate || 0)}  n ${o?.n || 0}`,
      );
    }
    lines.push('');
  }

  if (rep.crossBoss) {
    lines.push('=== Same-kit cross-boss (observed autoplay / full HP boss-aware) ===');
    for (const bossId of Object.keys(rep.crossBoss)) {
      const g = rep.crossBoss[bossId];
      lines.push(
        `  ${(BOSS_IDS[bossId] || bossId).padEnd(36)}  auto@obs ${pct(g.autoplay_observed?.winRate || 0)} n=${g.autoplay_observed?.n || 0}  `
        + `aware@full ${pct(g.bossaware_full?.winRate || 0)} n=${g.bossaware_full?.n || 0}`,
      );
    }
    lines.push('');
  }

  if (rep.pressure) {
    lines.push('=== Fight-length / pressure (authored scale) ===');
    for (const [bossId, p] of Object.entries(rep.pressure)) {
      lines.push(`  ${p.name}: eHP ${p.ehp}  ATK ${p.eatk}  basic≈${p.basicRaw}  `
        + `mid ${p.midSpecial ? `${p.midSpecial.name} x${p.midSpecial.mult}@${p.midSpecial.at}` : '—'}  `
        + `finisher ${p.finisher ? `${p.finisher.name} x${p.finisher.mult}@${p.finisher.at}` : '—'}  `
        + `summons ${p.summons || 'none'}`);
      if (p.sampleHit) {
        lines.push(`    vs median arrival DEF: basic ${p.sampleHit.basic}  mid ${p.sampleHit.mid}  finisher ${p.sampleHit.finisher}`);
      }
    }
    lines.push('');
  }

  if (rep.attrition) {
    const a = rep.attrition;
    lines.push('=== F15 → F20 attrition ===');
    lines.push(`  reached F15 ${a.reachedF15}  F15 deaths ${a.f15Deaths}  F15 winners ${a.f15Winners}  F15 survival ${pct(a.f15Survival)}`);
    lines.push(`  F15 winners → F20 ${a.reachedF20} (${pct(a.f15Winners ? a.reachedF20 / a.f15Winners : 0)})`);
    if (a.deathFloors) {
      lines.push(`  deaths after F15 win: ${Object.entries(a.deathFloors).map(([f, n]) => `F${f} ${n}`).join('  ') || 'none'}`);
    }
    if (a.floors) {
      for (const fl of [16, 17, 18, 19]) {
        const b = a.floors[fl];
        if (!b) continue;
        lines.push(`  F${fl} n=${b.n}  die ${pct(b.deathRate)}  combat ${b.combat}  event ${b.event}  shop ${b.shop}  sneak/bribe ${b.sneakBribe}  `
          + `HP ${pct(b.avgEnterHp)} → ${pct(b.avgLeaveHp)} (Δ ${num((b.avgHpDelta || 0) * 100)}pp)`);
      }
    }
    if (a.f19Choices) {
      lines.push(`  F19 campfire (F15 winners who arrived): ${Object.entries(a.f19Choices).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
    }
    lines.push('');
  }

  if (rep.representatives?.length) {
    lines.push('=== Representative F20 arrivals (median HP% per class) ===');
    for (const r of rep.representatives) {
      lines.push(`  ${r.classId.padEnd(12)} seed ${r.seed}  ${BOSS_IDS[r.bossId] || r.bossId}  `
        + `HP ${r.hp}/${r.maxHp} (${pct(r.hpPct)})  potions ${r.potions}  relics ${r.relics}  skills ${r.skills}  F15 ${r.f15Boss || '—'}`);
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

export async function runF20Probe({
  seed = 20260823,
  runs = 1002,
  capturePolicy = 'baseline',
  classId = null,
  crossBoss = true,
} = {}) {
  const { jobs } = planDifficultyJobs({ seed, runs, classId, classes: BASE_CLASSES });
  const byBoss = {};
  const cross = {};
  const arrivalHealth = emptyHealth();
  const f10All = emptyHealth();
  const f20AtF10 = emptyHealth();
  const f19Choices = {};
  const arrivalF15Wins = { n: 0, wins: 0 };
  const attrition = {
    reachedF15: 0,
    f15Deaths: 0,
    f15Winners: 0,
    reachedF20: 0,
    deathFloors: {},
    floors: { 16: emptyFloorBand(), 17: emptyFloorBand(), 18: emptyFloorBand(), 19: emptyFloorBand() },
    f19Choices: {},
  };
  const liveArrivals = [];
  let climbs = 0;
  let arrivals = 0;

  for (const job of jobs) {
    climbs += 1;
    const cap = await captureF20Arrival({ seed: job.seed, classId: job.classId, policy: capturePolicy });
    if (cap.f10Enter) pushHealth(f10All, cap.f10Enter, cap.classId);

    const f15 = cap.f15 || (cap.trace && traceFloor(cap.trace, 15));
    const reachedF15 = !!(f15 || (cap.trace || []).some(r => r.floor === 15));
    if (reachedF15) {
      attrition.reachedF15 += 1;
      const rec15 = f15?.outcome != null ? f15 : traceFloor(cap.trace, 15);
      const won15 = rec15 && rec15.outcome !== 'dead';
      if (!won15) attrition.f15Deaths += 1;
      else {
        attrition.f15Winners += 1;
        for (const fl of [16, 17, 18, 19]) {
          const rec = (cap.segment || []).find(r => r.floor === fl) || traceFloor(cap.trace, fl);
          if (rec) noteSegmentFloor(attrition.floors[fl], rec);
        }
        if (!cap.reached) {
          const df = cap.deathFloor;
          if (df >= 16 && df <= 20) attrition.deathFloors[df] = (attrition.deathFloors[df] || 0) + 1;
        }
        const rec19 = traceFloor(cap.trace, 19);
        if (rec19?.meta?.choice) {
          attrition.f19Choices[rec19.meta.choice] = (attrition.f19Choices[rec19.meta.choice] || 0) + 1;
        }
      }
    }

    if (!cap.reached) continue;
    arrivals += 1;
    attrition.reachedF20 += 1;
    const bossId = cap.bossId || cap.run.bossPicks?.[20] || 'unknown';
    if (!byBoss[bossId]) {
      byBoss[bossId] = {
        autoplay_observed: emptyAgg(),
        autoplay_full: emptyAgg(),
        bossaware_observed: emptyAgg(),
        bossaware_full: emptyAgg(),
      };
    }
    pushHealth(arrivalHealth, cap.arrival, cap.classId);
    if (cap.f10Enter) pushHealth(f20AtF10, cap.f10Enter, cap.classId);
    if (cap.f19?.choice) f19Choices[cap.f19.choice] = (f19Choices[cap.f19.choice] || 0) + 1;
    if (cap.f15) {
      arrivalF15Wins.n += 1;
      if (cap.f15.won) arrivalF15Wins.wins += 1;
    }
    liveArrivals.push({
      seed: cap.seed,
      classId: cap.classId,
      bossId,
      hp: cap.arrival.hp,
      maxHp: cap.arrival.maxHp,
      hpPct: cap.arrival.hpPct,
      potions: cap.arrival.potions,
      relics: cap.arrival.relicCount,
      skills: cap.arrival.skillCount,
      f15Boss: cap.f15?.bossId || null,
    });

    for (const cond of CONDITIONS) {
      const row = await replayArrival(cap, cond);
      addFight(byBoss[bossId][cond.id], row, cap.classId);
    }

    if (crossBoss) {
      for (const otherId of Object.keys(BOSS_IDS)) {
        if (!cross[otherId]) {
          cross[otherId] = { autoplay_observed: emptyAgg(), bossaware_full: emptyAgg() };
        }
        const a = await replayArrival(cap, { policy: 'autoplay', hp: 'observed', bossId: otherId });
        addFight(cross[otherId].autoplay_observed, a, cap.classId);
        const d = await replayArrival(cap, { policy: 'boss-aware', hp: 'full', bossId: otherId });
        addFight(cross[otherId].bossaware_full, d, cap.classId);
      }
    }
  }

  for (const bossId of Object.keys(byBoss)) {
    for (const id of Object.keys(byBoss[bossId])) finishAgg(byBoss[bossId][id]);
  }
  if (crossBoss) {
    for (const bossId of Object.keys(cross)) {
      for (const id of Object.keys(cross[bossId])) finishAgg(cross[bossId][id]);
    }
  }

  const arrivalsOut = finishHealth(arrivalHealth);
  arrivalsOut.f19Choices = f19Choices;
  arrivalsOut.f15Wins = arrivalF15Wins.wins;

  const representatives = [];
  const byClassArr = {};
  for (const row of liveArrivals) {
    (byClassArr[row.classId] || (byClassArr[row.classId] = [])).push(row);
  }
  for (const cid of Object.keys(byClassArr).sort()) {
    const rows = byClassArr[cid].slice().sort((a, b) => a.hpPct - b.hpPct);
    representatives.push(rows[Math.floor(rows.length / 2)]);
  }

  const pressure = {};
  const medianArrival = liveArrivals.slice().sort((a, b) => a.hpPct - b.hpPct)[Math.floor(liveArrivals.length / 2)] || null;
  const medianCap = medianArrival
    ? await captureF20Arrival({ seed: medianArrival.seed, classId: medianArrival.classId, policy: capturePolicy })
    : null;
  for (const bossId of Object.keys(BOSS_IDS)) {
    const p = theoreticalPressure(bossId);
    if (medianCap?.reached) {
      const mid = p.midSpecial ? estimateHitVsArrival(p, medianCap, p.midSpecial) : null;
      p.sampleHit = {
        basic: estimateHitVsArrival(p, medianCap, null),
        mid,
        finisher: p.finisher ? estimateHitVsArrival(p, medianCap, p.finisher) : null,
      };
    }
    pressure[bossId] = p;
  }

  attrition.f15Survival = attrition.reachedF15 ? (attrition.f15Winners / attrition.reachedF15) : 0;
  for (const fl of Object.keys(attrition.floors)) {
    attrition.floors[fl] = finishFloorBand(attrition.floors[fl]);
  }

  const classification = classifyWall(byBoss, arrivalsOut, attrition);
  return {
    meta: {
      name: 'F20_COMPETENCE',
      seed,
      climbs,
      arrivals,
      capturePolicy,
      generatedAt: new Date().toISOString(),
    },
    arrivals: arrivalsOut,
    compareF10: {
      f10All: finishHealth(f10All),
      f20AtF10: finishHealth(f20AtF10),
      f20: arrivalsOut,
    },
    byBoss,
    crossBoss: crossBoss ? cross : null,
    pressure,
    attrition,
    representatives,
    classification,
  };
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const body = a.replace(/^--/, '');
    if (body.includes('=')) {
      const [k, v] = body.split('=');
      flags[k] = v;
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        flags[body] = next;
        i += 1;
      } else {
        flags[body] = true;
      }
    }
  }
  return flags;
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const seed = Number(flags.seed || 20260823);
  const runs = Number(flags.runs || 1002);
  const capturePolicy = String(flags.capture || 'baseline');
  const classId = flags.class || null;
  const out = flags.out || 'reports/f20_competence.json';
  const crossBoss = flags.nocross ? false : true;
  const rep = await runF20Probe({ seed, runs, capturePolicy, classId, crossBoss });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(rep, null, 2));
  console.log(formatProbeReport(rep));
  console.log(`\nWrote ${out}`);
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/run_f20_probe.js');
if (isMain) main();
