#!/usr/bin/env node
// Class progression funnel audit — measurement only.
// Does not retune classes, skills, bosses, gates, shops, or combat.
//
//   node tools/run_class_funnel.js --seed 20260823 --runs 10002
//   node tools/run_class_funnel.js --seed 20260823 --runs 1002 --policy reasonable
//   node tools/run_class_funnel.js --seed 20260823 --runs 1002 --combat boss-aware

import { writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { SKILLS } from '../js/data/skills.js';
import { CONSUMABLES } from '../js/data/items.js';
import { CONFIG } from '../js/data/config.js';
import { LAST_FLOOR } from '../js/data/floorcards.js';
import { TDC, softLevelDamage } from '../js/data/tdc.js';
import { derived } from '../js/character.js';
import { canAfford, skillEffectivePower } from '../js/systems.js';
import { simulateClimbV2, makeV2Run } from './run_climb_v2.js';
import { chooseAutoPlayAction } from '../js/combat_policy.js';
import { baselinePolicy } from './policies/baseline.js';
import { chooseBossAwareAction } from './policies/boss_aware.js';
import {
  BASE_CLASSES, planDifficultyJobs, makePolicy, isWin, EARLY_BRICK_BEFORE,
} from './run_difficulty.js';

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

export const CHECKPOINTS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 51];
export const GATES = [10, 15, 20, 30, 40, 50];
export const CLASS_LABEL = {
  warrior: 'Warrior', mage: 'Mage', archer: 'Ranger',
  rogue: 'Rogue', priest: 'Priest', monk: 'Monk',
};
const CLASS_ORDER = ['archer', 'warrior', 'mage', 'monk', 'rogue', 'priest'];
const FREE_SKILL = {
  warrior: 'slash', mage: 'firebolt', archer: 'quick_shot',
  rogue: 'backstab', priest: 'smite', monk: 'palm_strike',
};
function pct(n, d) {
  return d ? n / d : 0;
}
function mean(xs) {
  const nums = xs.filter(v => v != null && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function healPotionCount(run) {
  return (run.consumables || []).filter(id => {
    const c = CONSUMABLES.find(x => x.id === id);
    return !!(c && (c.heal || c.healPct));
  }).length;
}

function estimateFreeDpt(run) {
  const d = derived(run);
  const sk = SKILLS[FREE_SKILL[run.classId] || 'basic_attack'] || SKILLS.basic_attack;
  const C = CONFIG.combat;
  const statVal = d[sk.stat] || 0;
  const power = skillEffectivePower(sk) || sk.power || 100;
  return (statVal * C.playerStatWeight + d.atk * C.playerAtkWeight
    + softLevelDamage(run.level, C.playerLevelWeight) + C.playerFlat)
    * (power / 100);
}

function snapKit(run) {
  const d = derived(run);
  const sk = SKILLS[FREE_SKILL[run.classId]] || SKILLS.basic_attack;
  return {
    hp: run.hp,
    maxHp: run.maxHp,
    hpPct: run.maxHp ? run.hp / run.maxHp : 0,
    mp: run.mp,
    maxMp: run.maxMp,
    mpPct: run.maxMp ? run.mp / run.maxMp : 0,
    gold: run.gold,
    level: run.level,
    potions: healPotionCount(run),
    relics: (run.relics || []).length,
    skills: (run.skills || []).length,
    skillIds: [...(run.skills || [])],
    equipped: Object.values(run.equipment || {}).filter(Boolean).length,
    def: d.def,
    atk: d.atk,
    str: d.str,
    dex: d.dex,
    int: d.int,
    wis: d.wis,
    lk: d.lk,
    crit: d.crit,
    dodge: d.dodge,
    manaRegen: d.manaRegen,
    freeDpt: estimateFreeDpt(run),
    primary: sk.stat || 'str',
    primaryVal: d[sk.stat] || 0,
    hasMend: (run.skills || []).includes('mend'),
    hasWard: (run.skills || []).includes('radiant_ward'),
    hasAimed: (run.skills || []).includes('aimed_shot'),
  };
}

function emptyAcc() {
  return {
    n: 0, hp: 0, maxHp: 0, hpPct: 0, mp: 0, maxMp: 0, mpPct: 0,
    gold: 0, level: 0, potions: 0, relics: 0, skills: 0, equipped: 0,
    def: 0, atk: 0, str: 0, dex: 0, int: 0, wis: 0, lk: 0,
    crit: 0, dodge: 0, manaRegen: 0, freeDpt: 0, primaryVal: 0,
    lowHp: 0, lowMp: 0, noPots: 0, hasMend: 0, hasWard: 0, hasAimed: 0,
  };
}
function pushAcc(a, k) {
  if (!k) return;
  a.n += 1;
  for (const key of [
    'hp', 'maxHp', 'hpPct', 'mp', 'maxMp', 'mpPct', 'gold', 'level',
    'potions', 'relics', 'skills', 'equipped', 'def', 'atk', 'str', 'dex',
    'int', 'wis', 'lk', 'crit', 'dodge', 'manaRegen', 'freeDpt', 'primaryVal',
  ]) a[key] += k[key] || 0;
  if ((k.hpPct || 0) < 0.5) a.lowHp += 1;
  if ((k.mpPct || 0) < 0.25) a.lowMp += 1;
  if ((k.potions || 0) === 0) a.noPots += 1;
  if (k.hasMend) a.hasMend += 1;
  if (k.hasWard) a.hasWard += 1;
  if (k.hasAimed) a.hasAimed += 1;
}
function finishAcc(a) {
  const n = a.n || 1;
  const avg = {};
  for (const key of [
    'hp', 'maxHp', 'hpPct', 'mp', 'maxMp', 'mpPct', 'gold', 'level',
    'potions', 'relics', 'skills', 'equipped', 'def', 'atk', 'str', 'dex',
    'int', 'wis', 'lk', 'crit', 'dodge', 'manaRegen', 'freeDpt', 'primaryVal',
  ]) avg[key] = a.n ? a[key] / n : null;
  return {
    n: a.n,
    ...avg,
    pctLowHp: pct(a.lowHp, a.n),
    pctLowMp: pct(a.lowMp, a.n),
    pctNoPots: pct(a.noPots, a.n),
    pctHasMend: pct(a.hasMend, a.n),
    pctHasWard: pct(a.hasWard, a.n),
    pctHasAimed: pct(a.hasAimed, a.n),
  };
}

function emptyCombat() {
  return {
    actions: 0, potions: 0, skillHeals: 0, guards: 0, wards: 0,
    mendUsed: 0, mendSkipped: 0, mendAffordableLowHp: 0,
    radiantUsed: 0, smiteUsed: 0, quickShotUsed: 0, aimedUsed: 0,
    mpStarvedPaid: 0, fights: 0,
  };
}

function wrapCombat(choose, stats) {
  let acts = 0;
  return (f) => {
    acts += 1;
    if (acts > 220) return { type: 'useSkill', skillId: 'basic_attack', enemy: 0 };
    const run = f.run;
    const hpR = run.hp / Math.max(1, run.maxHp);
    const skills = run.skills || [];
    const costMult = f.mod?.costMult || 1;
    const afford = (sk) => canAfford(
      { cost: Math.ceil((sk.cost || 0) * costMult), charge: sk.charge || 0 },
      run.mp, f.charge,
    );
    if (skills.includes('mend') && hpR < 0.4) {
      const mend = SKILLS.mend;
      if (mend && afford(mend)) stats.mendAffordableLowHp += 1;
    }
    const action = choose(f);
    stats.actions += 1;
    if (action?.type === 'useConsumable') stats.potions += 1;
    const sk = action?.skillId ? SKILLS[action.skillId] : null;
    if (action?.skillId === 'guard') stats.guards += 1;
    if (action?.skillId === 'mend') stats.mendUsed += 1;
    if (action?.skillId === 'radiant_ward') stats.radiantUsed += 1;
    if (action?.skillId === 'smite') stats.smiteUsed += 1;
    if (action?.skillId === 'quick_shot') stats.quickShotUsed += 1;
    if (action?.skillId === 'aimed_shot') stats.aimedUsed += 1;
    if (sk?.healPct && (sk.target === 'self' || sk.allyTarget) && !sk.power) stats.skillHeals += 1;
    if (sk?.shield && !sk.power) stats.wards += 1;
    if (skills.includes('mend') && hpR < 0.4 && afford(SKILLS.mend)
      && action?.skillId !== 'mend' && action?.type !== 'useConsumable') {
      stats.mendSkipped += 1;
    }
    if (sk && (sk.cost || 0) > 0 && run.mp < (sk.cost || 0)) stats.mpStarvedPaid += 1;
    const paid = (run.skills || []).map(id => SKILLS[id]).find(s => s && (s.cost || 0) > 0 && (s.power || 0) > 0);
    if (paid && !afford(paid) && (run.mp < (paid.cost || 0)) && (sk?.cost || 0) === 0) {
      stats.mpStarvedPaid += 1;
    }
    return action;
  };
}

// Measurement-only: autoplay heal path that accepts self/allyTarget heals (Mend).
// Not wired into live combat_policy.js.
export function chooseMendAwareAction(f) {
  const run = f.run;
  const hpRatio = run.hp / Math.max(1, run.maxHp);
  if (hpRatio < 0.35) {
    const healId = (run.consumables || []).find(id => {
      const c = CONSUMABLES.find(x => x.id === id);
      return c && (c.heal || c.healPct);
    });
    if (healId) return { type: 'useConsumable', itemId: healId };
  }
  const costMult = f.mod?.costMult || 1;
  const usable = ['basic_attack', 'guard', ...(run.skills || [])];
  const afford = sk => canAfford(
    { cost: Math.ceil((sk.cost || 0) * costMult), charge: sk.charge || 0 },
    run.mp, f.charge,
  );
  if (hpRatio < 0.4) {
    const healSk = ['basic_attack', ...run.skills]
      .map(id => SKILLS[id])
      .find(sk => sk && usable.includes(sk.id) && sk.healPct && !sk.power
        && (sk.target === 'self' || sk.allyTarget) && afford(sk));
    if (healSk) return { type: 'useSkill', skillId: healSk.id };
  }
  return chooseAutoPlayAction(f);
}

function policyFor(name, combatName) {
  const base = name === 'reasonable' ? makePolicy('reasonable') : baselinePolicy();
  let choose = base.chooseCombatAction;
  if (combatName === 'boss-aware') choose = chooseBossAwareAction;
  else if (combatName === 'mend-aware') choose = chooseMendAwareAction;
  return { ...base, name: `${base.name}/${combatName || 'autoplay'}`, chooseCombatAction: choose };
}

function emptyClass() {
  const gates = {};
  for (const f of CHECKPOINTS) {
    gates[f] = { arrive: 0, win: 0 };
  }
  return {
    start: 0,
    gates,
    brick: 0,
    f5Arrive: 0, f5Win: 0,
    f9Arrive: 0, f9Win: 0,
    f10Arrive: 0, f10Win: 0,
    deaths: {},
    deathFloors: {},
    deathBoss: {},
    deathEnemy: {},
    deathBand: { f1_5: 0, f6_10: 0, f11_20: 0, f21_30: 0, f31_40: 0, f41_49: 0, f50: 0, throne: 0 },
    starvedDeaths: 0,
    wins: 0,
    maxFloorSum: 0,
    combat: emptyCombat(),
    arriveKit: Object.fromEntries(CHECKPOINTS.map(f => [f, emptyAcc()])),
    deathKit: emptyAcc(),
    deathKitByFloor: {
      5: emptyAcc(), 10: emptyAcc(), 15: emptyAcc(), 20: emptyAcc(), 30: emptyAcc(), 40: emptyAcc(),
    },
    priestDeaths: [],
  };
}

function bump(map, key, n = 1) {
  map[key] = (map[key] || 0) + n;
}

function bossKey(rec) {
  if (!rec) return null;
  const id = rec.meta?.bossId;
  if (!id) return rec.kind === 'throne' ? 'throne' : null;
  return `${rec.floor}:${id}${rec.meta?.isAltBoss ? ':alt' : ''}`;
}

export function autoplayIgnoresAllyHeals() {
  const fake = {
    run: {
      classId: 'priest', hp: 10, maxHp: 40, mp: 36, maxMp: 36,
      skills: ['smite', 'mend', 'radiant_ward'],
      consumables: [],
      stats: { str: 4, dex: 4, int: 6, wis: 10, lk: 4 },
      equipment: {}, relics: [], weaponBonus: 0, level: 1,
    },
    charge: 2,
    mod: {},
    enemies: [{ hp: 20, maxHp: 20, atk: 6, name: 'Wolf' }],
    player: { statuses: {}, buffs: [], partyBuffs: [] },
    aliveEnemies() { return this.enemies.filter(e => e.hp > 0); },
  };
  const auto = baselinePolicy().chooseCombatAction(fake);
  const aware = chooseBossAwareAction(fake);
  const mend = chooseMendAwareAction(fake);
  return {
    autoplayPicksMend: auto?.skillId === 'mend',
    autoplayPick: auto?.skillId || auto?.type,
    bossAwarePicksMend: aware?.skillId === 'mend',
    bossAwarePick: aware?.skillId || aware?.type,
    mendAwarePicksMend: mend?.skillId === 'mend',
    mendAwarePick: mend?.skillId || mend?.type,
    mendHasAllyTarget: !!SKILLS.mend?.allyTarget,
    autoplayHealRequiresNoAllyTarget: true,
  };
}

function kitAtArrival(rec, prevLeave, startKit) {
  const base = prevLeave || startKit;
  return {
    ...base,
    hp: rec.enter?.hp ?? base.hp,
    maxHp: rec.enter?.maxHp ?? base.maxHp,
    hpPct: rec.enter?.hpPct ?? base.hpPct,
    mp: rec.enter?.mp ?? base.mp,
    maxMp: rec.enter?.maxMp ?? base.maxMp,
    mpPct: rec.enter?.maxMp ? rec.enter.mp / rec.enter.maxMp : base.mpPct,
    gold: rec.enter?.gold ?? base.gold,
    potions: rec.enter?.healConsumables ?? base.potions,
    relics: rec.enter?.relics ?? base.relics,
    skills: rec.enter?.skills ?? base.skills,
    equipped: rec.enter?.equipped ?? base.equipped,
    level: rec.enter?.level ?? base.level,
  };
}

function analyzeOne(job, climb, startKit, leaveKits, combat, classRow, bosses) {
  const cid = job.classId;
  const trace = climb.trace || [];
  classRow.start += 1;
  classRow.maxFloorSum += climb.deathFloor || climb.checkpoint?.floor || 0;

  for (const rec of trace) {
    const f = rec.floor;
    const survived = rec.outcome !== 'dead';
    const prevLeave = f > 1 ? leaveKits[f - 1] : startKit;
    if (CHECKPOINTS.includes(f)) {
      classRow.gates[f].arrive += 1;
      if (survived) classRow.gates[f].win += 1;
      pushAcc(classRow.arriveKit[f], kitAtArrival(rec, prevLeave, startKit));
    }
    if (f === 5) {
      classRow.f5Arrive += 1;
      if (survived) classRow.f5Win += 1;
    }
    if (f === 9) {
      classRow.f9Arrive += 1;
      if (survived) classRow.f9Win += 1;
    }
    if (f === 10) {
      classRow.f10Arrive += 1;
      if (survived) classRow.f10Win += 1;
    }

    if (rec.kind === 'boss' || rec.kind === 'throne' || rec.kind === 'trial') {
      const key = rec.kind === 'trial'
        ? `${f}:trial:${rec.meta?.trialId || rec.meta?.modifier || 'unknown'}`
        : (bossKey(rec) || `${f}:${rec.kind}`);
      if (!bosses[key]) {
        bosses[key] = {
          key, floor: f, kind: rec.kind,
          bossId: rec.meta?.bossId || rec.meta?.trialId || rec.kind,
          isAlt: !!rec.meta?.isAltBoss,
          arrive: 0, win: 0, byClass: {},
        };
      }
      const row = bosses[key];
      row.arrive += 1;
      if (survived) row.win += 1;
      if (!row.byClass[cid]) row.byClass[cid] = { arrive: 0, win: 0 };
      row.byClass[cid].arrive += 1;
      if (survived) row.byClass[cid].win += 1;
    }

    if (rec.outcome === 'dead') {
      bump(classRow.deaths, rec.deathCause || 'unknown');
      bump(classRow.deathFloors, String(f));
      if (rec.starved) classRow.starvedDeaths += 1;
      if (f <= 5) classRow.deathBand.f1_5 += 1;
      else if (f <= 10) classRow.deathBand.f6_10 += 1;
      else if (f <= 20) classRow.deathBand.f11_20 += 1;
      else if (f <= 30) classRow.deathBand.f21_30 += 1;
      else if (f <= 40) classRow.deathBand.f31_40 += 1;
      else if (f <= 49) classRow.deathBand.f41_49 += 1;
      else if (f === 50) classRow.deathBand.f50 += 1;
      else classRow.deathBand.throne += 1;
      if (rec.meta?.bossId) bump(classRow.deathBoss, rec.meta.bossId);
      const killer = (rec.meta?.enemies || []).find(e => e.boss) || (rec.meta?.enemies || [])[0];
      if (killer?.id) bump(classRow.deathEnemy, killer.id);
      const deathKit = kitAtArrival(rec, prevLeave, startKit);
      pushAcc(classRow.deathKit, deathKit);
      if (classRow.deathKitByFloor[f]) pushAcc(classRow.deathKitByFloor[f], deathKit);
      if (cid === 'priest' && classRow.priestDeaths.length < 48) {
        classRow.priestDeaths.push({
          seed: job.seed,
          floor: f,
          kind: rec.kind,
          cause: rec.deathCause || null,
          bossId: rec.meta?.bossId || null,
          enemy: killer?.id || rec.meta?.eventId || null,
          eventId: rec.meta?.eventId || null,
          starved: !!rec.starved,
          enter: rec.enter || null,
          skills: (prevLeave || startKit).skillIds || [],
          hasMend: !!(prevLeave || startKit).hasMend,
          hasWard: !!(prevLeave || startKit).hasWard,
        });
      }
    }
  }

  if (isWin(climb.outcome)) classRow.wins += 1;
  if (climb.outcome === 'dead' && climb.deathFloor != null && climb.deathFloor < EARLY_BRICK_BEFORE) {
    classRow.brick += 1;
  }

  for (const k of Object.keys(combat)) {
    classRow.combat[k] += combat[k] || 0;
  }
  classRow.combat.fights += 1;
}

function conversion(winA, arriveB) {
  return { from: winA, to: arriveB, rate: pct(arriveB, winA) };
}

function firstDivergence(classRow, overall, nClass, nAll) {
  const notes = [];
  let first = null;
  for (const f of CHECKPOINTS) {
    const cReach = pct(classRow.gates[f].arrive, nClass);
    const aReach = pct(overall.gates[f].arrive, nAll);
    const cClear = pct(classRow.gates[f].win, classRow.gates[f].arrive);
    const aClear = pct(overall.gates[f].win, overall.gates[f].arrive);
    const reachGap = cReach - aReach;
    const clearGap = cClear - aClear;
    const meaningful = (Math.abs(reachGap) >= 0.04 && classRow.gates[f].arrive >= 20)
      || (Math.abs(clearGap) >= 0.08 && classRow.gates[f].arrive >= 20);
    if (meaningful && !first) {
      first = {
        floor: f,
        reach: cReach,
        popReach: aReach,
        reachGap,
        clear: cClear,
        popClear: aClear,
        clearGap,
        arrive: classRow.gates[f].arrive,
        win: classRow.gates[f].win,
      };
    }
    notes.push({
      floor: f, arrive: classRow.gates[f].arrive, win: classRow.gates[f].win,
      reach: cReach, popReach: aReach, reachGap,
      clear: cClear, popClear: aClear, clearGap,
    });
  }
  return { first, notes };
}

function classifyClass(id, row, overall, nClass, nAll, combatStatic) {
  const div = firstDivergence(row, overall, nClass, nAll);
  const brickGap = pct(row.brick, nClass) - pct(overall.brick, nAll);
  const f5Clear = pct(row.f5Win, row.f5Arrive);
  const f10Clear = pct(row.f10Win, row.f10Arrive);
  const labels = [];
  if (id === 'priest' && combatStatic && !combatStatic.autoplayPicksMend && combatStatic.mendHasAllyTarget) {
    labels.push('AUTOPLAY / POLICY ISSUE');
  }
  if (brickGap >= 0.06 || (div.first && div.first.floor <= 5)) {
    labels.push('EARLY-GAME SURVIVAL ISSUE');
  }
  const f10Gap = f10Clear - pct(overall.gates[10].win, overall.gates[10].arrive);
  if (row.f10Arrive >= 20 && Math.abs(f10Gap) >= 0.10) labels.push('BOSS MATCHUP ISSUE');
  const lateArrive = row.gates[30].arrive;
  const earlyFilter = nClass - row.gates[10].arrive;
  if (id === 'priest' && earlyFilter > lateArrive * 3) {
    // disappearance is accumulated early, not a late wall
  }
  if (labels.length === 0 && Math.abs((div.first?.reachGap) || 0) < 0.08) {
    labels.push('HEALTHY CLASS DIFFERENTIATION');
  }
  if (labels.length > 1) return { label: 'MIXED', labels, divergence: div };
  return { label: labels[0] || 'SELECTION / SMALL-SAMPLE ARTIFACT', labels, divergence: div };
}

export async function runClassFunnel({
  seed = 20260823,
  runs = 10002,
  policy = 'baseline',
  combat = 'autoplay',
  classId = null,
} = {}) {
  const { jobs, nSeeds, classes } = planDifficultyJobs({
    seed, runs, classId, classes: BASE_CLASSES,
  });
  const byClass = {};
  for (const cid of classes) byClass[cid] = emptyClass();
  const bosses = {};
  const staticAutoplay = autoplayIgnoresAllyHeals();
  const t0 = Date.now();

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const combatStats = emptyCombat();
    const pol = policyFor(policy, combat);
    pol.chooseCombatAction = wrapCombat(pol.chooseCombatAction, combatStats);
    const run = makeV2Run({ seed: job.seed, classId: job.classId, kitSeed: job.seed, name: 'Funnel' });
    const startKit = snapKit(run);
    const leaveKits = {};
    const climb = await simulateClimbV2(run, pol, {
      onFloor(rec, live) { leaveKits[rec.floor] = snapKit(live); },
    });
    analyzeOne(job, climb, startKit, leaveKits, combatStats, byClass[job.classId], bosses);
    if ((i + 1) % 200 === 0 || i === jobs.length - 1) {
      const elapsed = (Date.now() - t0) / 1000;
      const rate = (i + 1) / Math.max(0.001, elapsed);
      const eta = (jobs.length - i - 1) / Math.max(0.001, rate);
      console.error(`funnel ${i + 1}/${jobs.length}  ${elapsed.toFixed(0)}s  eta ${eta.toFixed(0)}s`);
    }
  }

  const finished = {};
  for (const cid of classes) {
    const row = byClass[cid];
    const n = row.start;
    const gates = {};
    for (const f of CHECKPOINTS) {
      gates[f] = {
        arrive: row.gates[f].arrive,
        win: row.gates[f].win,
        reachPct: pct(row.gates[f].arrive, n),
        clearPct: pct(row.gates[f].win, row.gates[f].arrive),
        kit: finishAcc(row.arriveKit[f]),
      };
    }
    finished[cid] = {
      n,
      wins: row.wins,
      winRate: pct(row.wins, n),
      brick: row.brick,
      brickRate: pct(row.brick, n),
      early: {
        brickRate: pct(row.brick, n),
        f5Arrive: row.f5Arrive,
        f5Win: row.f5Win,
        f5Clear: pct(row.f5Win, row.f5Arrive),
        f9Arrive: row.f9Arrive,
        f9Reach: pct(row.f9Arrive, n),
        f10Arrive: row.f10Arrive,
        f10Win: row.f10Win,
        f10Clear: pct(row.f10Win, row.f10Arrive),
        f10Reach: pct(row.f10Arrive, n),
      },
      mid: {
        f10to20: conversion(row.gates[10].win, row.gates[20].arrive),
        f20to30: conversion(row.gates[20].win, row.gates[30].arrive),
        f30to40: conversion(row.gates[30].win, row.gates[40].arrive),
        f10winTo20win: conversion(row.gates[10].win, row.gates[20].win),
        f20winTo30win: conversion(row.gates[20].win, row.gates[30].win),
        f30winTo40win: conversion(row.gates[30].win, row.gates[40].win),
      },
      gates,
      deaths: row.deaths,
      deathFloors: row.deathFloors,
      deathBoss: row.deathBoss,
      deathEnemy: row.deathEnemy,
      deathBand: row.deathBand,
      starvedDeaths: row.starvedDeaths,
      combat: row.combat,
      deathKit: finishAcc(row.deathKit),
      deathKitByFloor: Object.fromEntries(
        Object.entries(row.deathKitByFloor).map(([k, v]) => [k, finishAcc(v)]),
      ),
      priestDeaths: row.priestDeaths,
    };
  }

  const nAll = Object.values(finished).reduce((s, r) => s + r.n, 0);
  const overallGates = {};
  for (const f of CHECKPOINTS) {
    const arrive = Object.values(finished).reduce((s, r) => s + r.gates[f].arrive, 0);
    const win = Object.values(finished).reduce((s, r) => s + r.gates[f].win, 0);
    overallGates[f] = {
      arrive, win,
      reachPct: pct(arrive, nAll),
      clearPct: pct(win, arrive),
    };
  }
  const overallOut = {
    n: nAll,
    wins: Object.values(finished).reduce((s, r) => s + r.wins, 0),
    brick: Object.values(finished).reduce((s, r) => s + r.brick, 0),
    gates: overallGates,
  };
  overallOut.brickRate = pct(overallOut.brick, nAll);
  overallOut.winRate = pct(overallOut.wins, nAll);

  const overallForDiv = {
    brick: overallOut.brick,
    gates: Object.fromEntries(CHECKPOINTS.map(f => [f, {
      arrive: overallGates[f].arrive,
      win: overallGates[f].win,
    }])),
  };
  const classification = {};
  for (const cid of classes) {
    classification[cid] = classifyClass(
      cid, byClass[cid], overallForDiv, finished[cid].n, nAll, staticAutoplay,
    );
  }

  const bossOut = Object.values(bosses)
    .map(b => ({
      ...b,
      clearPct: pct(b.win, b.arrive),
      byClass: Object.fromEntries(Object.entries(b.byClass).map(([cid, r]) => [cid, {
        ...r, clearPct: pct(r.win, r.arrive),
      }])),
    }))
    .sort((a, b) => a.floor - b.floor || a.key.localeCompare(b.key));

  return {
    meta: {
      name: 'CLASS_FUNNEL',
      seed,
      climbs: jobs.length,
      nSeeds,
      policy,
      combat,
      classes,
      generatedAt: new Date().toISOString(),
      f30SoloHpMult: TDC.enemy.f30SoloHpMult,
      f40SoloHpMult: TDC.enemy.f40SoloHpMult,
      lastFloor: LAST_FLOOR,
    },
    staticAutoplay,
    overall: overallOut,
    byClass: finished,
    bosses: bossOut,
    classification,
  };
}

function pctText(x, digits = 1) {
  if (x == null || !Number.isFinite(x)) return '  —  ';
  return `${(x * 100).toFixed(digits)}%`;
}
function nText(n) {
  return String(n ?? 0);
}

export function formatFunnelReport(rep) {
  const lines = [];
  const classes = CLASS_ORDER.filter(id => rep.byClass[id]);
  lines.push('=== Class progression funnel (measurement only) ===');
  lines.push(`seed ${rep.meta.seed}  climbs ${rep.meta.climbs}  policy ${rep.meta.policy}/${rep.meta.combat}`);
  lines.push(`frozen f30SoloHpMult ${rep.meta.f30SoloHpMult}  f40SoloHpMult ${rep.meta.f40SoloHpMult}`);
  lines.push('');

  lines.push('--- Autoplay heal static check ---');
  const s = rep.staticAutoplay;
  lines.push(`  mend.allyTarget=${s.mendHasAllyTarget}  autoplay pick=${s.autoplayPick}  (uses mend: ${s.autoplayPicksMend})`);
  lines.push(`  boss-aware pick=${s.bossAwarePick}  (uses mend: ${s.bossAwarePicksMend})`);
  lines.push('');

  lines.push('--- Reach % of starting runs ---');
  const slots = ['Start', ...CHECKPOINTS.map(f => (f === 51 ? 'Throne' : `F${f}`)), 'Win'];
  lines.push(['Class'.padEnd(10), ...slots.map(x => x.padStart(8))].join(''));
  const allStart = rep.overall.n;
  const allRow = ['ALL'.padEnd(10), nText(allStart).padStart(8)];
  for (const f of CHECKPOINTS) allRow.push(pctText(rep.overall.gates[f].reachPct).padStart(8));
  allRow.push(pctText(rep.overall.winRate).padStart(8));
  lines.push(allRow.join(''));
  for (const cid of classes) {
    const r = rep.byClass[cid];
    const row = [CLASS_LABEL[cid].padEnd(10), nText(r.n).padStart(8)];
    for (const f of CHECKPOINTS) row.push(pctText(r.gates[f].reachPct).padStart(8));
    row.push(pctText(r.winRate).padStart(8));
    lines.push(row.join(''));
  }
  lines.push('');

  lines.push('--- Counts reaching each checkpoint ---');
  lines.push(['Class'.padEnd(10), ...slots.map(x => x.padStart(8))].join(''));
  const allC = ['ALL'.padEnd(10), nText(allStart).padStart(8)];
  for (const f of CHECKPOINTS) allC.push(nText(rep.overall.gates[f].arrive).padStart(8));
  allC.push(nText(rep.overall.wins).padStart(8));
  lines.push(allC.join(''));
  for (const cid of classes) {
    const r = rep.byClass[cid];
    const row = [CLASS_LABEL[cid].padEnd(10), nText(r.n).padStart(8)];
    for (const f of CHECKPOINTS) row.push(nText(r.gates[f].arrive).padStart(8));
    row.push(nText(r.wins).padStart(8));
    lines.push(row.join(''));
  }
  lines.push('');

  lines.push('--- Conditional clear % of arrivals (gate survival) ---');
  lines.push(['Class'.padEnd(10), ...CHECKPOINTS.map(f => (f === 51 ? 'Throne' : `F${f}`).padStart(8))].join(''));
  const allCl = ['ALL'.padEnd(10)];
  for (const f of CHECKPOINTS) allCl.push(pctText(rep.overall.gates[f].clearPct).padStart(8));
  lines.push(allCl.join(''));
  for (const cid of classes) {
    const r = rep.byClass[cid];
    const row = [CLASS_LABEL[cid].padEnd(10)];
    for (const f of CHECKPOINTS) row.push(pctText(r.gates[f].clearPct).padStart(8));
    lines.push(row.join(''));
  }
  lines.push('');

  lines.push('--- Early game ---');
  lines.push(['Class'.padEnd(10), 'Brick'.padStart(8), 'F5 clr'.padStart(8), 'F9 rch'.padStart(8), 'F10 rch'.padStart(8), 'F10 clr'.padStart(8)].join(''));
  for (const cid of classes) {
    const e = rep.byClass[cid].early;
    lines.push([
      CLASS_LABEL[cid].padEnd(10),
      pctText(e.brickRate).padStart(8),
      pctText(e.f5Clear).padStart(8),
      pctText(e.f9Reach).padStart(8),
      pctText(e.f10Reach).padStart(8),
      pctText(e.f10Clear).padStart(8),
    ].join(''));
  }
  lines.push('');

  lines.push('--- Midgame conversion (winners → next gate arrival / next gate win) ---');
  lines.push(['Class'.padEnd(10), '10→20a'.padStart(8), '10→20w'.padStart(8), '20→30a'.padStart(8), '20→30w'.padStart(8), '30→40a'.padStart(8), '30→40w'.padStart(8)].join(''));
  for (const cid of classes) {
    const m = rep.byClass[cid].mid;
    lines.push([
      CLASS_LABEL[cid].padEnd(10),
      pctText(m.f10to20.rate).padStart(8),
      pctText(m.f10winTo20win.rate).padStart(8),
      pctText(m.f20to30.rate).padStart(8),
      pctText(m.f20winTo30win.rate).padStart(8),
      pctText(m.f30to40.rate).padStart(8),
      pctText(m.f30winTo40win.rate).padStart(8),
    ].join(''));
  }
  lines.push('');

  lines.push('--- First divergence vs population ---');
  for (const cid of classes) {
    const c = rep.classification[cid];
    const d = c.divergence.first;
    if (!d) {
      lines.push(`  ${CLASS_LABEL[cid].padEnd(10)} none ≥4pp reach / ≥8pp clear (n≥20)  label=${c.label}`);
    } else {
      lines.push(`  ${CLASS_LABEL[cid].padEnd(10)} first F${d.floor}  reach ${pctText(d.reach)} vs pop ${pctText(d.popReach)} (${(d.reachGap * 100).toFixed(1)}pp)  clear ${pctText(d.clear)} vs pop ${pctText(d.popClear)} (${(d.clearGap * 100).toFixed(1)}pp)  label=${c.label}`);
    }
  }
  lines.push('');

  lines.push('--- Combat / autoplay counters (per class, all fights in the climb) ---');
  for (const cid of classes) {
    const x = rep.byClass[cid].combat;
    lines.push(`  ${CLASS_LABEL[cid].padEnd(10)} acts ${x.actions}  pots ${x.potions}  skillHeals ${x.skillHeals}  wards ${x.wards}  guard ${x.guards}`);
    if (cid === 'priest') {
      lines.push(`             mend used ${x.mendUsed}  skipped-at-low-HP ${x.mendSkipped}  affordable-low-HP windows ${x.mendAffordableLowHp}  smite ${x.smiteUsed}  radiant ${x.radiantUsed}`);
    }
    if (cid === 'archer') {
      lines.push(`             quick_shot ${x.quickShotUsed}  aimed ${x.aimedUsed}`);
    }
  }
  lines.push('');

  lines.push('--- Arrival kit at major gates (mean) ---');
  for (const f of GATES) {
    lines.push(`  F${f}`);
    lines.push(['    Class'.padEnd(12), 'n'.padStart(6), 'HP'.padStart(7), 'HPpct'.padStart(7), 'DEF'.padStart(6), 'DPT'.padStart(7), 'MP%'.padStart(7), 'pots'.padStart(6), 'relic'.padStart(6), 'sk'.padStart(5)].join(''));
    for (const cid of classes) {
      const k = rep.byClass[cid].gates[f].kit;
      if (!k.n) continue;
      lines.push([
        `    ${CLASS_LABEL[cid].padEnd(8)}`,
        nText(k.n).padStart(6),
        (k.hp || 0).toFixed(0).padStart(7),
        pctText(k.hpPct).padStart(7),
        (k.def || 0).toFixed(1).padStart(6),
        (k.freeDpt || 0).toFixed(1).padStart(7),
        pctText(k.mpPct).padStart(7),
        (k.potions || 0).toFixed(1).padStart(6),
        (k.relics || 0).toFixed(1).padStart(6),
        (k.skills || 0).toFixed(1).padStart(5),
      ].join(''));
    }
  }
  lines.push('');

  lines.push('--- Gate bosses (n≥10 overall, class n≥8 shown) ---');
  for (const b of rep.bosses.filter(x => GATES.includes(x.floor) || x.floor === 51)) {
    if (b.arrive < 10 && b.floor !== 51) continue;
    lines.push(`  F${b.floor} ${b.bossId}${b.isAlt ? ' (alt)' : ''}  arrive ${b.arrive}  clear ${pctText(b.clearPct)}`);
    for (const cid of classes) {
      const r = b.byClass[cid];
      if (!r || r.arrive < 8) continue;
      lines.push(`      ${CLASS_LABEL[cid].padEnd(10)} ${r.arrive} arrive  ${r.win} win  ${pctText(r.clearPct)}`);
    }
  }
  lines.push('');

  lines.push('--- Priest death sample ---');
  const pd = rep.byClass.priest?.priestDeaths || [];
  const byCause = {};
  for (const d of pd) bump(byCause, `${d.floor}:${d.cause}:${d.enemy || d.bossId || d.eventId || '?'}`);
  const top = Object.entries(byCause).sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [k, n] of top) lines.push(`  ${n}× ${k}`);
  if (rep.byClass.priest) {
    const dk = rep.byClass.priest.deathKit;
    lines.push(`  all priest deaths n=${dk.n}  enter HP% ${pctText(dk.hpPct)}  MP% ${pctText(dk.mpPct)}  pots ${dk.potions?.toFixed?.(2)}  noPots ${pctText(dk.pctNoPots)}`);
    for (const f of [5, 10]) {
      const k = rep.byClass.priest.deathKitByFloor[f];
      if (k?.n) lines.push(`  F${f} priest deaths n=${k.n}  enter HP% ${pctText(k.hpPct)}  MP% ${pctText(k.mpPct)}  pots ${k.potions?.toFixed?.(2)}`);
    }
  }
  lines.push('');

  lines.push('--- Death bands ---');
  for (const cid of classes) {
    const b = rep.byClass[cid].deathBand;
    lines.push(`  ${CLASS_LABEL[cid].padEnd(10)} F1-5 ${b.f1_5}  F6-10 ${b.f6_10}  F11-20 ${b.f11_20}  F21-30 ${b.f21_30}  F31-40 ${b.f31_40}  F41-49 ${b.f41_49}  F50 ${b.f50}`);
  }

  return lines.join('\n');
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
  const runs = Number(flags.runs || 10002);
  const policy = String(flags.policy || 'baseline');
  const combat = String(flags.combat || 'autoplay');
  const classId = flags.class || null;
  const out = flags.out || 'reports/class_funnel.json';
  const rep = await runClassFunnel({ seed, runs, policy, combat, classId });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(rep, null, 2));
  console.log(formatFunnelReport(rep));
  console.log(`\nWrote ${out}`);
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/run_class_funnel.js');
if (isMain) main();
