#!/usr/bin/env node
// F40 combat competence probe — measurement harness for the F40 gate.
// Replays legitimate F40 arrivals against Hydra and Bograth under four
// conditions. Capture/replay must not perturb climb RNG.
//
//   node tools/run_f40_probe.js --seed 20260823 --runs 1002
//   node tools/run_f40_probe.js --seed 20260823 --runs 1002 --extra 2004 --out reports/f40_competence.json

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
import { BASE_CLASSES, planDifficultyJobs } from './run_difficulty.js';
import { derived } from '../js/character.js';
import { applyDefense } from '../js/systems.js';
import { enemyScale, soloBossChargeForScale } from '../js/data/tdc.js';
import { CONDITIONS, parseCombatLogs } from './run_f20_probe.js';

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

export { CONDITIONS, parseCombatLogs };

export const BOSS_IDS = {
  hydra: 'The Grieving Hydra',
  tr_live_ogre: 'Bograth, the Twin-Headed Ogre',
};

export const F40_BOSS_ORDER = ['hydra', 'tr_live_ogre'];

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

export async function fightF40(run, choose) {
  const rngPick = runRng(run);
  const boss = pickBossForFloor(run.floor, rngPick, run);
  rngPick.advance();
  const rng = runRng(run);
  const biome = biomeForFloor(run.floor);
  const plan = planBossEncounter(rng, {
    floor: run.floor,
    boss,
    pool: ENEMIES[biome.id] || ENEMIES.swamp,
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

export async function captureF40Arrival({ seed, classId, policy = 'baseline' } = {}) {
  const climbPolicy = policy === 'reasonable'
    ? (await import('./policies/reasonable.js')).reasonablePolicy()
    : baselinePolicy();
  const run = makeV2Run({ seed, classId, kitSeed: seed, name: 'F40Probe' });
  const climb = await simulateClimbV2(run, climbPolicy, { stopAfterFloor: 39 });
  const trace = climb.trace || [];
  const f30 = traceFloor(trace, 30);
  const f35 = traceFloor(trace, 35);
  const f39 = traceFloor(trace, 39);
  const segment = [31, 32, 33, 34, 35, 36, 37, 38, 39].map(fl => traceFloor(trace, fl)).filter(Boolean);

  if (climb.outcome === 'dead' || run.hp <= 0 || run.floor < 39 || !f39 || f39.outcome === 'dead') {
    return {
      reached: false,
      seed,
      classId,
      deathFloor: climb.deathFloor || run.floor,
      f30,
      f35,
      segment,
      trace,
    };
  }

  const f39LeaveHp = run.hp;
  const f39LeaveMax = run.maxHp;
  const f39Choice = f39?.meta?.choice || null;
  enterNextFloor(run);
  return {
    reached: true,
    seed,
    classId,
    subclassId: run.subclassId || null,
    run,
    bossId: run.bossPicks?.[40] || null,
    arrival: snapArrival(run),
    f30: f30 ? {
      outcome: f30.outcome,
      bossId: f30.meta?.bossId || null,
      enterHpPct: f30.enter?.hpPct ?? null,
      leaveHpPct: f30.leave?.hpPct ?? null,
      won: f30.outcome !== 'dead',
    } : null,
    f35: f35 ? {
      outcome: f35.outcome,
      enterHpPct: f35.enter?.hpPct ?? null,
      leaveHpPct: f35.leave?.hpPct ?? null,
    } : null,
    f39: {
      choice: f39Choice,
      leaveHp: f39LeaveHp,
      leaveMaxHp: f39LeaveMax,
      leaveHpPct: f39LeaveHp / Math.max(1, f39LeaveMax),
      enterHpPct: f39?.enter?.hpPct ?? null,
      breathGain: run.hp - f39LeaveHp,
    },
    flags: { ...(run.flags || {}) },
    knowledge: [...(run.world?.knowledge || [])],
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
    run.bossPicks[40] = bossId;
  }
  const hpEnter = run.hp;
  const hpEnterPct = run.hp / Math.max(1, run.maxHp);
  const fight = await fightF40(run, chooserFor(policy));
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
    freezeApplies: 0,
    freezeSkips: 0,
    regenHealed: 0,
    regenTicks: 0,
    headRegrows: 0,
    enrages: 0,
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
  agg.freezeApplies += row.parsed?.freezeApplies || 0;
  agg.freezeSkips += row.parsed?.freezeSkips || 0;
  agg.regenHealed += row.parsed?.regenHealed || 0;
  agg.regenTicks += row.parsed?.regenTicks || 0;
  agg.headRegrows += row.parsed?.headRegrows || 0;
  agg.enrages += row.parsed?.enrages || 0;
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
  agg.avgFreezeApplies = agg.n ? agg.freezeApplies / agg.n : 0;
  agg.avgFreezeSkips = agg.n ? agg.freezeSkips / agg.n : 0;
  agg.avgRegenHealed = agg.n ? agg.regenHealed / agg.n : 0;
  agg.avgRegenTicks = agg.n ? agg.regenTicks / agg.n : 0;
  agg.avgHeadRegrows = agg.n ? agg.headRegrows / agg.n : 0;
  agg.avgEnrages = agg.n ? agg.enrages / agg.n : 0;
  agg.avgHeadHeal = (agg.avgHeadRegrows || 0) * 0.10 * (agg.avgBossMaxHp || 0);
  const avgTurns = agg.avgTurns || 1;
  agg.avgPlayerDpt = (agg.avgPlayerDmg || 0) / Math.max(1, avgTurns);
  agg.avgIncomingDpt = (agg.avgIncoming || 0) / Math.max(1, avgTurns);
  const practicalEhp = (agg.avgBossMaxHp || 0) + (agg.avgRegenHealed || 0) + (agg.avgHeadHeal || 0);
  agg.practicalEhp = practicalEhp;
  const ttk = agg.avgPlayerDpt ? (agg.avgBossMaxHp || 0) / agg.avgPlayerDpt : null;
  const ttkPractical = agg.avgPlayerDpt ? practicalEhp / agg.avgPlayerDpt : null;
  const ttl = agg.avgIncomingDpt ? (agg.avgHpEnterAbs || 0) / agg.avgIncomingDpt : null;
  agg.expectedTtk = ttk;
  agg.expectedTtkPractical = ttkPractical;
  agg.expectedTtl = ttl;
  const kills = Object.entries(agg.kills).sort((a, b) => b[1] - a[1]);
  agg.topKills = kills.slice(0, 10).map(([name, n]) => ({ name, n, rate: agg.losses ? n / agg.losses : 0 }));
  const specials = Object.entries(agg.dmgSpecial).sort((a, b) => b[1] - a[1]);
  const dmgTotal = agg.dmgBasic + agg.dmgBurn + agg.dmgPoison + agg.dmgTorment
    + agg.dmgSummon + agg.dmgEscort + specials.reduce((s, [, v]) => s + v, 0);
  const finisherShare = specials
    .filter(([name]) => /SORROW UNENDING|TWO SORROWS/.test(name))
    .reduce((s, [, v]) => s + v, 0);
  agg.dmgShare = {
    basic: dmgTotal ? agg.dmgBasic / dmgTotal : 0,
    burn: dmgTotal ? agg.dmgBurn / dmgTotal : 0,
    poison: dmgTotal ? agg.dmgPoison / dmgTotal : 0,
    torment: dmgTotal ? agg.dmgTorment / dmgTotal : 0,
    summon: dmgTotal ? agg.dmgSummon / dmgTotal : 0,
    escort: dmgTotal ? agg.dmgEscort / dmgTotal : 0,
    finisher: dmgTotal ? finisherShare / dmgTotal : 0,
    specials: specials.map(([name, v]) => ({ name, v, share: dmgTotal ? v / dmgTotal : 0 })),
  };
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

function finisherKillRate(g) {
  if (!g?.topKills?.length || !g.losses) return 0;
  return g.topKills
    .filter(k => /SORROW UNENDING|TWO SORROWS/.test(k.name))
    .reduce((s, k) => s + (k.rate || 0), 0);
}

function classifyWall(byBoss, arrivals, attrition) {
  const notes = [];
  const votes = [];
  const arrivalN = arrivals?.n || 0;
  if (arrivalN < 12) {
    notes.push(`Only ${arrivalN} F40 arrivals — class/boss slices are noisy`);
    votes.push('INSUFFICIENT SAMPLE');
  }

  const avgHp = arrivals?.avgHpPct;
  if (avgHp != null && avgHp < 0.45) {
    notes.push(`F40 arrivals average ${pct(avgHp)} HP`);
    votes.push('PRE-BOSS ATTRITION');
  }
  if (attrition?.f30Winners && attrition.reachedF40 != null && attrition.f30Winners > 0) {
    const conv = attrition.reachedF40 / attrition.f30Winners;
    if (conv < 0.45) {
      notes.push(`F30 winners → F40 conversion ${pct(conv)} (${attrition.reachedF40}/${attrition.f30Winners})`);
      votes.push('PRE-BOSS ATTRITION');
    } else {
      notes.push(`F30 winners → F40 conversion ${pct(conv)} (${attrition.reachedF40}/${attrition.f30Winners})`);
    }
  }

  const hydra = byBoss.hydra;
  const bograth = byBoss.tr_live_ogre;
  const vD = hydra?.bossaware_full;
  const hD = bograth?.bossaware_full;
  if (vD && hD && vD.n >= 8 && hD.n >= 8) {
    if (vD.winRate < 0.12 && hD.winRate >= 0.25) {
      votes.push('HYDRA-SPECIFIC');
      notes.push(`Hydra full+aware ${pct(vD.winRate)} vs Bograth ${pct(hD.winRate)} on identical kits`);
    } else if (hD.winRate < 0.12 && vD.winRate >= 0.25) {
      votes.push('BOGRATH-SPECIFIC');
      notes.push(`Bograth full+aware ${pct(hD.winRate)} vs Hydra ${pct(vD.winRate)} on identical kits`);
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
    if (D.expectedTtkPractical && D.expectedTtl && D.expectedTtkPractical > D.expectedTtl * 1.6 && D.winRate < 0.35) {
      votes.push('BOSS BALANCE');
      notes.push(`${name}: practical TTK ${num(D.expectedTtkPractical)} vs TTL ${num(D.expectedTtl)} at full HP + boss-aware`);
    } else if (D.expectedTtk && D.expectedTtl && D.expectedTtk > D.expectedTtl * 1.6 && D.winRate < 0.35) {
      votes.push('BOSS BALANCE');
      notes.push(`${name}: TTK ${num(D.expectedTtk)} vs TTL ${num(D.expectedTtl)} at full HP + boss-aware`);
    }
    if ((D.avgBossHpLeftLoss || 0) >= 0.40 && D.winRate < 0.25) {
      notes.push(`${name}: deaths leave boss at ${pct(D.avgBossHpLeftLoss)} HP — durability / incoming mismatch`);
    }
    if ((D.dmgShare?.basic || 0) >= 0.40 && D.winRate < 0.35) {
      notes.push(`${name}: basics are ${pct(D.dmgShare.basic)} of incoming — not just the finisher`);
    }
    if ((D.dmgShare?.poison || 0) >= 0.12) {
      notes.push(`${name}: poison is ${pct(D.dmgShare.poison)} of incoming`);
    }
    if ((D.dmgShare?.finisher || 0) >= 0.28 || finisherKillRate(D) >= 0.40) {
      notes.push(`${name}: finisher share ${pct(D.dmgShare?.finisher || 0)} / kill rate ${pct(finisherKillRate(D))}`);
    }
    if ((D.avgRegenHealed || 0) >= 20) {
      notes.push(`${name}: regen restores ${num(D.avgRegenHealed)} HP/fight (${num(D.avgRegenTicks)} ticks)`);
    }
    if ((D.avgHeadRegrows || 0) >= 0.5) {
      notes.push(`${name}: head-regrow ${num(D.avgHeadRegrows)}/fight (~${num(D.avgHeadHeal)} extra HP)`);
    }
    if (Math.abs((B.winRate || 0) - (A.winRate || 0)) < 0.08 && D.winRate < 0.25) {
      notes.push(`${name}: full HP barely moves autoplay (${pct(A.winRate)} → ${pct(B.winRate)})`);
    }
    if (policyLiftFull >= 0.15) {
      notes.push(`${name}: even at full HP, policy lift ${pct(B.winRate)} → ${pct(D.winRate)}`);
    } else if (Math.abs(policyLiftFull) < 0.08 && D.winRate < 0.25) {
      notes.push(`${name}: policy does not save the fight (aware ${pct(D.winRate)} vs auto ${pct(B.winRate)})`);
    }
  }

  const unique = [...new Set(votes)];
  let primary = 'MIXED';
  if (unique.length === 1) primary = unique[0];
  else if (unique.length === 0) primary = 'MIXED';
  else if (unique.includes('INSUFFICIENT SAMPLE') && unique.length > 1) {
    primary = unique.find(v => v !== 'INSUFFICIENT SAMPLE') || 'INSUFFICIENT SAMPLE';
  }   else if (unique.includes('HYDRA-SPECIFIC') && unique.includes('BOSS BALANCE')) {
    primary = 'HYDRA-SPECIFIC';
  } else if (unique.includes('BOGRATH-SPECIFIC') && unique.includes('BOSS BALANCE')) {
    primary = 'BOGRATH-SPECIFIC';
  } else if (unique.includes('BOSS BALANCE') && unique.includes('PRE-BOSS ATTRITION')) primary = 'MIXED';
  else if (unique.includes('BOSS BALANCE') && unique.includes('COMBAT POLICY')) primary = 'MIXED';
  else if (unique.includes('BOSS BALANCE')) primary = 'BOSS BALANCE';
  else if (unique.includes('HYDRA-SPECIFIC')) primary = 'HYDRA-SPECIFIC';
  else if (unique.includes('BOGRATH-SPECIFIC')) primary = 'BOGRATH-SPECIFIC';
  else if (unique.includes('PRE-BOSS ATTRITION')) primary = 'PRE-BOSS ATTRITION';
  else if (unique.includes('COMBAT POLICY')) primary = 'COMBAT POLICY';
  else if (unique.includes('CLASS INTERACTION')) primary = 'CLASS INTERACTION';

  const healthyArrivals = (arrivals?.avgHpPct || 0) >= 0.45
    && (attrition?.f30Winners ? (attrition.reachedF40 / attrition.f30Winners) >= 0.45 : arrivalN >= 8);
  const bothHard = !!(vD && hD && vD.n >= 8 && hD.n >= 8 && vD.winRate < 0.25 && hD.winRate < 0.25);
  const oneHard = !!(vD && hD && ((vD.winRate < 0.15 && hD.winRate >= 0.25) || (hD.winRate < 0.15 && vD.winRate >= 0.25)));
  const policySaves = Object.values(byBoss).some((conds) => {
    const A = conds.autoplay_observed;
    const C = conds.bossaware_observed;
    return A && C && (C.winRate - A.winRate) >= 0.25 && C.winRate >= 0.30;
  });
  const sampleOk = arrivalN >= 8;
  const justified = sampleOk && healthyArrivals && (bothHard || oneHard) && !policySaves;
  notes.push(justified
    ? 'F40 balance pass is justified: healthy arrivals still lose at full HP under competent play.'
    : 'F40 balance pass is not clearly justified from this matrix (sample, attrition, policy, or a viable boss remains).');

  return {
    labels: [primary],
    notes,
    evidence: unique,
    balancePassJustified: justified,
  };
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
    n: 0, deaths: 0, combat: 0, event: 0, shop: 0, sneakBribe: 0, trial: 0, campfire: 0,
    enterHp: [], leaveHp: [], hpDelta: [],
    enterPots: [], leavePots: [], enterRelics: [], leaveRelics: [],
    enterSkills: [], leaveSkills: [], enterEquip: [], leaveEquip: [],
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
  if (kind === 'trial') band.trial += 1;
  if (kind === 'campfire') band.campfire += 1;
  if (approach === 'sneak' || approach === 'bribe') band.sneakBribe += 1;
  if (rec.enter?.hpPct != null) band.enterHp.push(rec.enter.hpPct);
  if (rec.leave?.hpPct != null) band.leaveHp.push(rec.leave.hpPct);
  if (rec.enter?.hpPct != null && rec.leave?.hpPct != null) {
    band.hpDelta.push(rec.leave.hpPct - rec.enter.hpPct);
  }
  if (rec.enter?.healConsumables != null) band.enterPots.push(rec.enter.healConsumables);
  if (rec.leave?.healConsumables != null) band.leavePots.push(rec.leave.healConsumables);
  if (rec.enter?.relics != null) band.enterRelics.push(rec.enter.relics);
  if (rec.leave?.relics != null) band.leaveRelics.push(rec.leave.relics);
  if (rec.enter?.skills != null) band.enterSkills.push(rec.enter.skills);
  if (rec.leave?.skills != null) band.leaveSkills.push(rec.leave.skills);
  if (rec.enter?.equipped != null) band.enterEquip.push(rec.enter.equipped);
  if (rec.leave?.equipped != null) band.leaveEquip.push(rec.leave.equipped);
}

function finishFloorBand(band) {
  return {
    n: band.n,
    deaths: band.deaths,
    deathRate: band.n ? band.deaths / band.n : 0,
    combat: band.combat,
    event: band.event,
    shop: band.shop,
    trial: band.trial,
    campfire: band.campfire,
    sneakBribe: band.sneakBribe,
    avgEnterHp: mean(band.enterHp),
    avgLeaveHp: mean(band.leaveHp),
    avgHpDelta: mean(band.hpDelta),
    avgEnterPots: mean(band.enterPots),
    avgLeavePots: mean(band.leavePots),
    avgEnterRelics: mean(band.enterRelics),
    avgLeaveRelics: mean(band.leaveRelics),
    avgEnterSkills: mean(band.enterSkills),
    avgLeaveSkills: mean(band.leaveSkills),
    avgEnterEquip: mean(band.enterEquip),
    avgLeaveEquip: mean(band.leaveEquip),
  };
}

function theoreticalPressure(bossId) {
  const floor = 40;
  const spec = bossId === 'tr_live_ogre' ? ALT_BOSSES[40] : BOSSES[40];
  if (!spec) return null;
  const biome = biomeForFloor(floor);
  const built = buildEnemy(spec, floor, biome.floors[0], { boss: true, partySize: 1 });
  const sc = enemyScale(floor, biome.floors[0], biome.id, { boss: true, partySize: 1 });
  const ehp = built.maxHp;
  const eatk = built.atk;
  const specials = spec.specials || [];
  const basicRaw = eatk * (CONFIG.combat.enemyAtkMult ?? 1.35);
  const finisher = specials.reduce((best, s) => (!best || (s.mult || 1) > (best.mult || 1) ? s : best), null);
  const mid = specials.filter(s => s !== finisher).sort((a, b) => (b.mult || 1) - (a.mult || 1))[0] || null;
  const headHeal = spec.heads ? Math.round(ehp * 0.10) * 2 : 0;
  const regenTick = spec.regen ? Math.round(ehp * spec.regen) : 0;
  return {
    bossId,
    name: spec.name,
    authoredHp: spec.hp,
    authoredAtk: spec.atk,
    authoredSpd: spec.spd,
    authoredRegen: spec.regen || 0,
    heads: !!spec.heads,
    headTriggers: spec.heads ? [0.6, 0.3] : [],
    headHealEach: spec.heads ? Math.round(ehp * 0.10) : 0,
    headAtkMultEach: spec.heads ? 1.2 : 1,
    regenTick,
    scaleHp: sc.hp,
    scaleAtk: sc.atk,
    liveHpMult: built._m?.hp ?? sc.hp,
    ehp,
    eatk,
    practicalEhpIfBothHeads: ehp + headHeal,
    specials: specials.map(s => ({
      at: s.at, name: s.name, mult: s.mult,
      poisonSure: !!s.poisonSure, tormentedSure: !!s.tormentedSure,
      frail: s.frail || null, aoe: !!s.aoe,
    })),
    basicRaw: Math.round(basicRaw),
    midSpecial: mid ? { name: mid.name, at: mid.at, mult: mid.mult } : null,
    finisher: finisher ? {
      name: finisher.name, at: finisher.at, mult: finisher.mult,
      tormentedSure: !!finisher.tormentedSure, frail: finisher.frail || null,
    } : null,
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
  const banked = special ? soloBossChargeForScale(40, special.at || 0) : 0;
  const chargeScale = special ? (1 + (CONFIG.boss?.chargeDamageScale ?? 0.32) * banked) : 1;
  let raw = pressure.eatk * (CONFIG.combat.enemyAtkMult ?? 1.35) * mult * chargeScale;
  raw = applyDefense(raw, d.def);
  raw *= d.dmgTakenMult || 1;
  return Math.max(1, Math.round(raw));
}

function emptyCondSet() {
  return {
    autoplay_observed: emptyAgg(),
    autoplay_full: emptyAgg(),
    bossaware_observed: emptyAgg(),
    bossaware_full: emptyAgg(),
  };
}

export function formatProbeReport(rep) {
  const lines = [];
  lines.push(`DungeonTogether F40 combat competence — seed ${rep.meta.seed}  climbs ${rep.meta.climbs}  arrivals ${rep.meta.arrivals}`);
  if (rep.meta.extraRuns) {
    lines.push(`Canonical ${rep.meta.canonicalClimbs} climbs / ${rep.meta.canonicalArrivals} arrivals; extra ${rep.meta.extraRuns} climbs thicken the identical-kit matrix`);
  }
  lines.push(`Capture policy: ${rep.meta.capturePolicy}  each arrival replayed vs both bosses × 4 conditions`);
  lines.push(`Climb RNG isolated from combat policy; F40 authored kits unchanged`);
  lines.push('');

  if (rep.arrivals) {
    const a = rep.arrivals;
    lines.push('=== F40 arrival health ===');
    lines.push(`  n=${a.n}  HP ${num(a.avgHp)}/${num(a.avgMaxHp)} (${pct(a.avgHpPct)}, median ${pct(a.medHpPct)})  `
      + `MP ${pct(a.avgMpPct)}  potions ${num(a.avgPotions)}  gold ${num(a.avgGold)}`);
    lines.push(`  level ${num(a.avgLevel)}  relics ${num(a.avgRelics)}  skills ${num(a.avgSkills)}  equipped ${num(a.avgEquipped)}`);
    lines.push(`  HP <50% ${pct(a.pctBelow50)}  HP <35% ${pct(a.pctBelow35)}  HP ≥80% ${pct(a.pctAtOrAbove80)}`);
    if (a.f30Wins != null) lines.push(`  F30 wins among arrivals: ${a.f30Wins}/${a.n}`);
    if (a.f39Choices) {
      lines.push(`  F39 campfire: ${Object.entries(a.f39Choices).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
    }
    if (a.liveBoss) {
      lines.push(`  live assignment: ${Object.entries(a.liveBoss).map(([id, n]) => `${BOSS_IDS[id] || id} ${n}`).join(', ')}`);
    }
    if (a.byLiveBoss) {
      for (const id of F40_BOSS_ORDER) {
        const g = a.byLiveBoss[id];
        if (!g?.n) continue;
        lines.push(`  bound for ${BOSS_IDS[id] || id}: n=${g.n}  HP ${pct(g.avgHpPct)}  potions ${num(g.avgPotions)}  relics ${num(g.avgRelics)}  skills ${num(g.avgSkills)}  equipped ${num(g.avgEquipped)}`);
      }
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

  if (rep.compareF30) {
    const c = rep.compareF30;
    lines.push('=== F30 vs F40 arrival comparison (same climbs) ===');
    lines.push(`  F30 winners          n=${c.f30Winners?.n || 0}  HP ${pct(c.f30Winners?.avgHpPct)}  potions ${num(c.f30Winners?.avgPotions)}  relics ${num(c.f30Winners?.avgRelics)}`);
    lines.push(`  F40-bound at F30     n=${c.f40AtF30?.n || 0}  HP ${pct(c.f40AtF30?.avgHpPct)}  potions ${num(c.f40AtF30?.avgPotions)}  relics ${num(c.f40AtF30?.avgRelics)}`);
    lines.push(`  F40 arrivals         n=${c.f40?.n || 0}  HP ${pct(c.f40?.avgHpPct)}  potions ${num(c.f40?.avgPotions)}  relics ${num(c.f40?.avgRelics)}`);
    lines.push('');
  }

  for (const bossId of F40_BOSS_ORDER) {
    const c = (rep.byBoss || {})[bossId];
    if (!c) continue;
    const name = BOSS_IDS[bossId] || bossId;
    lines.push(`=== ${name} (${bossId})  identical-kit n=${c.autoplay_observed?.n || 0} ===`);
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
        + `heal ${num(g.avgPotionHeals)}p/${num(g.avgSkillHeals)}s  guard ${num(g.avgGuards)}  ward ${num(g.avgWards)}  taunt ${num(g.avgTaunts)}`,
      );
      lines.push(`      TTK ${num(g.expectedTtk)}  practical ${num(g.expectedTtkPractical)}  TTL ${num(g.expectedTtl)}  dpt out ${num(g.avgPlayerDpt)}  dpt in ${num(g.avgIncomingDpt)}  eHP ${num(g.avgBossMaxHp)}  practical eHP ${num(g.practicalEhp)}`);
      lines.push(`      regen ${num(g.avgRegenHealed)} HP / ${num(g.avgRegenTicks)} ticks  heads ${num(g.avgHeadRegrows)}  enrage ${num(g.avgEnrages)}`);
      if (g.topKills?.length) {
        lines.push(`      deaths: ${g.topKills.map(k => `${k.name} ${pct(k.rate)}`).join(' | ')}`);
      }
      if (g.dmgShare) {
        const spec = (g.dmgShare.specials || []).slice(0, 4).map(s => `${s.name} ${pct(s.share)}`).join('  ');
        lines.push(`      dmg: basic ${pct(g.dmgShare.basic)}  poison ${pct(g.dmgShare.poison)}  torment ${pct(g.dmgShare.torment)}  finisher ${pct(g.dmgShare.finisher)}  ${spec}`);
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

  if (rep.liveByBoss) {
    lines.push('=== Live assignment (natural F40 pick, not cross-replay) ===');
    for (const bossId of F40_BOSS_ORDER) {
      const g = rep.liveByBoss[bossId];
      if (!g) continue;
      lines.push(
        `  ${(BOSS_IDS[bossId] || bossId).padEnd(36)}  auto@obs ${pct(g.autoplay_observed?.winRate || 0)} n=${g.autoplay_observed?.n || 0}  `
        + `aware@full ${pct(g.bossaware_full?.winRate || 0)} n=${g.bossaware_full?.n || 0}`,
      );
    }
    lines.push('');
  }

  if (rep.pressure) {
    lines.push('=== Fight-length / pressure (authored scale, F40 solo) ===');
    for (const bossId of F40_BOSS_ORDER) {
      const p = rep.pressure[bossId];
      if (!p) continue;
      lines.push(`  ${p.name}: eHP ${p.ehp}  ATK ${p.eatk}  SPD ${p.authoredSpd}  regen ${p.authoredRegen} (${p.regenTick}/tick)  heads ${p.heads}  `
        + `mid ${p.midSpecial ? `${p.midSpecial.name} x${p.midSpecial.mult}@${p.midSpecial.at}` : '—'}  `
        + `finisher ${p.finisher ? `${p.finisher.name} x${p.finisher.mult}@${p.finisher.at}` : '—'}`);
      lines.push(`    head regrow +${p.headHealEach} HP and ×${p.headAtkMultEach} ATK at 60%/30%; both heads → practical eHP ${p.practicalEhpIfBothHeads}`);
      if (p.sampleHit) {
        lines.push(`    vs median arrival DEF: basic ${p.sampleHit.basic}  mid ${p.sampleHit.mid}  finisher ${p.sampleHit.finisher}`);
      }
    }
    lines.push('');
  }

  if (rep.attrition) {
    const a = rep.attrition;
    lines.push('=== F30 → F40 attrition ===');
    lines.push(`  reached F30 ${a.reachedF30}  F30 deaths ${a.f30Deaths}  F30 winners ${a.f30Winners}  F30 survival ${pct(a.f30Survival)}`);
    lines.push(`  F30 winners → F40 ${a.reachedF40} (${pct(a.f30Winners ? a.reachedF40 / a.f30Winners : 0)})`);
    if (a.deathFloors) {
      lines.push(`  deaths after F30 win: ${Object.entries(a.deathFloors).map(([f, n]) => `F${f} ${n}`).join('  ') || 'none'}`);
    }
    if (a.floors) {
      for (const fl of [31, 32, 33, 34, 35, 36, 37, 38, 39]) {
        const b = a.floors[fl];
        if (!b) continue;
        lines.push(`  F${fl} n=${b.n}  die ${pct(b.deathRate)}  combat ${b.combat}  event ${b.event}  shop ${b.shop}  trial ${b.trial}  `
          + `HP ${pct(b.avgEnterHp)} → ${pct(b.avgLeaveHp)} (Δ ${num((b.avgHpDelta || 0) * 100)}pp)`
          + `  pots ${num(b.avgEnterPots)}→${num(b.avgLeavePots)}  relics ${num(b.avgEnterRelics)}→${num(b.avgLeaveRelics)}  skills ${num(b.avgEnterSkills)}→${num(b.avgLeaveSkills)}`);
      }
    }
    if (a.f39Choices) {
      lines.push(`  F39 campfire (F30 winners who arrived): ${Object.entries(a.f39Choices).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
    }
    lines.push('');
  }

  if (rep.representatives?.length) {
    lines.push('=== Representative F40 arrivals (median HP% per class) ===');
    for (const r of rep.representatives) {
      lines.push(`  ${r.classId.padEnd(12)} seed ${r.seed}  live ${BOSS_IDS[r.bossId] || r.bossId}  `
        + `HP ${r.hp}/${r.maxHp} (${pct(r.hpPct)})  potions ${r.potions}  relics ${r.relics}  skills ${r.skills}  F30 ${r.f30Boss || '—'}`);
    }
    lines.push('');
  }

  lines.push('=== Classification ===');
  lines.push(`  ${rep.classification.labels.join(' + ')}`);
  lines.push(`  F40 balance pass justified: ${rep.classification.balancePassJustified ? 'YES' : 'NO'}`);
  for (const n of rep.classification.notes) lines.push(`  - ${n}`);
  lines.push('');
  lines.push(`Campfire Sleep restores +20% HP + potion_s; floor breath is ${Math.round((CONFIG.recovery.floorHealPct || 0) * 100)}% HP.`);
  return lines.join('\n');
}

export async function runF40Probe({
  seed = 20260823,
  runs = 1002,
  extraRuns = 0,
  capturePolicy = 'baseline',
  classId = null,
} = {}) {
  const canonical = planDifficultyJobs({ seed, runs, classId, classes: BASE_CLASSES });
  const expanded = extraRuns > 0
    ? planDifficultyJobs({ seed, runs: runs + extraRuns, classId, classes: BASE_CLASSES })
    : canonical;
  const jobs = expanded.jobs;
  const canonicalN = canonical.jobs.length;
  const byBoss = {
    hydra: emptyCondSet(),
    tr_live_ogre: emptyCondSet(),
  };
  const liveByBoss = {};
  const arrivalHealth = emptyHealth();
  const arrivalByLiveBoss = {
    hydra: emptyHealth(),
    tr_live_ogre: emptyHealth(),
  };
  const f30WinnersHealth = emptyHealth();
  const f40AtF30 = emptyHealth();
  const f39Choices = {};
  const liveBossCounts = {};
  const arrivalF30Wins = { n: 0, wins: 0 };
  const attrition = {
    reachedF30: 0,
    f30Deaths: 0,
    f30Winners: 0,
    reachedF40: 0,
    deathFloors: {},
    floors: {
      31: emptyFloorBand(), 32: emptyFloorBand(), 33: emptyFloorBand(), 34: emptyFloorBand(),
      35: emptyFloorBand(), 36: emptyFloorBand(), 37: emptyFloorBand(), 38: emptyFloorBand(),
      39: emptyFloorBand(),
    },
    f39Choices: {},
  };
  const liveArrivals = [];
  const canonicalArrivals = [];
  let climbs = 0;
  let arrivals = 0;
  let canonicalClimbs = 0;
  let canonicalArrivalN = 0;

  for (const job of jobs) {
    climbs += 1;
    const isCanonical = climbs <= canonicalN;
    if (isCanonical) canonicalClimbs += 1;
    const cap = await captureF40Arrival({ seed: job.seed, classId: job.classId, policy: capturePolicy });

    const rec30 = traceFloor(cap.trace, 30);
    const reachedF30 = !!rec30;
    if (reachedF30) {
      attrition.reachedF30 += 1;
      const won30 = rec30.outcome !== 'dead';
      if (!won30) attrition.f30Deaths += 1;
      else {
        attrition.f30Winners += 1;
        if (rec30.leave) pushHealth(f30WinnersHealth, rec30.leave, cap.classId);
        for (const fl of [31, 32, 33, 34, 35, 36, 37, 38, 39]) {
          const rec = (cap.segment || []).find(r => r.floor === fl) || traceFloor(cap.trace, fl);
          if (rec) noteSegmentFloor(attrition.floors[fl], rec);
        }
        if (!cap.reached) {
          const df = cap.deathFloor;
          if (df >= 31 && df <= 40) attrition.deathFloors[df] = (attrition.deathFloors[df] || 0) + 1;
        }
        const rec39 = traceFloor(cap.trace, 39);
        if (rec39?.meta?.choice) {
          attrition.f39Choices[rec39.meta.choice] = (attrition.f39Choices[rec39.meta.choice] || 0) + 1;
        }
      }
    }

    if (!cap.reached) continue;
    arrivals += 1;
    if (isCanonical) canonicalArrivalN += 1;
    attrition.reachedF40 += 1;
    const liveId = cap.bossId || cap.run.bossPicks?.[40] || 'unknown';
    liveBossCounts[liveId] = (liveBossCounts[liveId] || 0) + 1;
    if (!liveByBoss[liveId]) liveByBoss[liveId] = emptyCondSet();

    pushHealth(arrivalHealth, cap.arrival, cap.classId);
    if (arrivalByLiveBoss[liveId]) pushHealth(arrivalByLiveBoss[liveId], cap.arrival, cap.classId);
    if (cap.f30?.won) {
      const rec30Leave = traceFloor(cap.trace, 30);
      if (rec30Leave?.leave) pushHealth(f40AtF30, rec30Leave.leave, cap.classId);
    }
    if (cap.f39?.choice) f39Choices[cap.f39.choice] = (f39Choices[cap.f39.choice] || 0) + 1;
    if (cap.f30) {
      arrivalF30Wins.n += 1;
      if (cap.f30.won) arrivalF30Wins.wins += 1;
    }
    liveArrivals.push({
      seed: cap.seed,
      classId: cap.classId,
      bossId: liveId,
      hp: cap.arrival.hp,
      maxHp: cap.arrival.maxHp,
      hpPct: cap.arrival.hpPct,
      potions: cap.arrival.potions,
      relics: cap.arrival.relicCount,
      skills: cap.arrival.skillCount,
      f30Boss: cap.f30?.bossId || null,
      canonical: isCanonical,
    });
    if (isCanonical) {
      canonicalArrivals.push(liveArrivals[liveArrivals.length - 1]);
    }

    for (const cond of CONDITIONS) {
      for (const otherId of F40_BOSS_ORDER) {
        const row = await replayArrival(cap, { ...cond, bossId: otherId });
        addFight(byBoss[otherId][cond.id], row, cap.classId);
        if (otherId === liveId) addFight(liveByBoss[liveId][cond.id], row, cap.classId);
      }
    }
  }

  for (const bossId of Object.keys(byBoss)) {
    for (const id of Object.keys(byBoss[bossId])) finishAgg(byBoss[bossId][id]);
  }
  for (const bossId of Object.keys(liveByBoss)) {
    for (const id of Object.keys(liveByBoss[bossId])) finishAgg(liveByBoss[bossId][id]);
  }

  const arrivalsOut = finishHealth(arrivalHealth);
  arrivalsOut.f39Choices = f39Choices;
  arrivalsOut.f30Wins = arrivalF30Wins.wins;
  arrivalsOut.liveBoss = liveBossCounts;
  arrivalsOut.byLiveBoss = {
    hydra: finishHealth(arrivalByLiveBoss.hydra),
    tr_live_ogre: finishHealth(arrivalByLiveBoss.tr_live_ogre),
  };

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
    ? await captureF40Arrival({ seed: medianArrival.seed, classId: medianArrival.classId, policy: capturePolicy })
    : null;
  for (const bossId of F40_BOSS_ORDER) {
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

  attrition.f30Survival = attrition.reachedF30 ? (attrition.f30Winners / attrition.reachedF30) : 0;
  for (const fl of Object.keys(attrition.floors)) {
    attrition.floors[fl] = finishFloorBand(attrition.floors[fl]);
  }

  const classification = classifyWall(byBoss, arrivalsOut, attrition);
  return {
    meta: {
      name: 'F40_COMPETENCE',
      seed,
      climbs,
      arrivals,
      canonicalClimbs,
      canonicalArrivals: canonicalArrivalN,
      extraRuns,
      capturePolicy,
      generatedAt: new Date().toISOString(),
    },
    arrivals: arrivalsOut,
    compareF30: {
      f30Winners: finishHealth(f30WinnersHealth),
      f40AtF30: finishHealth(f40AtF30),
      f40: arrivalsOut,
    },
    byBoss,
    liveByBoss,
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
  const extraRuns = Number(flags.extra || flags.extraRuns || 0);
  const capturePolicy = String(flags.capture || 'baseline');
  const classId = flags.class || null;
  const out = flags.out || 'reports/f40_competence.json';
  const rep = await runF40Probe({ seed, runs, extraRuns, capturePolicy, classId });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(rep, null, 2));
  console.log(formatProbeReport(rep));
  console.log(`\nWrote ${out}`);
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/run_f40_probe.js');
if (isMain) main();
