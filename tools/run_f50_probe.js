#!/usr/bin/env node
// Hell / F50 competence probe — measurement only.
// Expands real climb-v2 seeds, captures legitimate F41–F50 states, and
// replays F50 arrivals against Infernal Duke and Kryos. Does not retune.
//
//   node tools/run_f50_probe.js --seed 20260823 --runs 1002
//   node tools/run_f50_probe.js --seed 20260823 --runs 1002 --extra 9000 --out reports/f50_competence.json

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
import { enemyScale, TDC } from '../js/data/tdc.js';
import { CONDITIONS, parseCombatLogs } from './run_f20_probe.js';

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

export { CONDITIONS, parseCombatLogs };

export const BOSS_IDS = {
  infernal_duke: 'Duke Malgrimm, Gatekeeper of the Throne',
  kryos_demon_general: 'Kryos, the Demon General',
};

export const F50_BOSS_ORDER = ['infernal_duke', 'kryos_demon_general'];
const HELL_FLOORS = [41, 42, 43, 44, 45, 46, 47, 48, 49, 50];
const F50_FINISHER_RE = /GATEKEEPER'S TOLL|LEFT AT THE POST/;

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

export async function fightF50(run, choose) {
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

function policyFor(name) {
  return name === 'reasonable'
    ? import('./policies/reasonable.js').then(m => m.reasonablePolicy())
    : baselinePolicy();
}

export async function captureFullClimb({ seed, classId, policy = 'baseline' } = {}) {
  const climbPolicy = await Promise.resolve(policyFor(policy));
  const run = makeV2Run({ seed, classId, kitSeed: seed, name: 'F50Probe' });
  const climb = await simulateClimbV2(run, climbPolicy);
  return { seed, classId, subclassId: run.subclassId || null, climb, trace: climb.trace || [], run };
}

export async function captureF50Arrival({ seed, classId, policy = 'baseline' } = {}) {
  const climbPolicy = await Promise.resolve(policyFor(policy));
  const run = makeV2Run({ seed, classId, kitSeed: seed, name: 'F50Arrival' });
  const climb = await simulateClimbV2(run, climbPolicy, { stopAfterFloor: 49 });
  const trace = climb.trace || [];
  const f40 = traceFloor(trace, 40);
  const f45 = traceFloor(trace, 45);
  const f49 = traceFloor(trace, 49);

  if (climb.outcome === 'dead' || run.hp <= 0 || run.floor < 49 || !f49 || f49.outcome === 'dead') {
    return {
      reached: false,
      seed,
      classId,
      deathFloor: climb.deathFloor || run.floor,
      f40, f45, f49, trace,
    };
  }

  const f49Before = f49.enter || null;
  const f49After = {
    hp: run.hp, maxHp: run.maxHp, hpPct: run.hp / Math.max(1, run.maxHp),
    mp: run.mp, maxMp: run.maxMp, mpPct: run.maxMp ? run.mp / run.maxMp : 0,
    potions: healConsumableCount(run),
  };
  enterNextFloor(run);
  return {
    reached: true,
    seed,
    classId,
    subclassId: run.subclassId || null,
    run,
    bossId: run.bossPicks?.[50] || null,
    arrival: snapArrival(run),
    f40: f40 ? {
      outcome: f40.outcome,
      bossId: f40.meta?.bossId || null,
      enterHpPct: f40.enter?.hpPct ?? null,
      leaveHpPct: f40.leave?.hpPct ?? null,
      won: f40.outcome !== 'dead',
    } : null,
    f45: f45 ? {
      outcome: f45.outcome,
      trialId: f45.meta?.trialId || null,
      enterHpPct: f45.enter?.hpPct ?? null,
      leaveHpPct: f45.leave?.hpPct ?? null,
      enterPots: f45.enter?.healConsumables ?? null,
      leavePots: f45.leave?.healConsumables ?? null,
    } : null,
    f49: {
      choice: f49?.meta?.choice || null,
      enter: f49Before,
      leave: f49After,
      enterHpPct: f49Before?.hpPct ?? null,
      leaveHpPct: f49After.hpPct,
      enterMpPct: f49Before?.maxMp ? f49Before.mp / f49Before.maxMp : null,
      leaveMpPct: f49After.mpPct,
      enterPots: f49Before?.healConsumables ?? null,
      leavePots: f49After.potions,
    },
    flags: { ...(run.flags || {}) },
    trace,
  };
}

function applyHpMode(run, mode, observedHp) {
  if (mode === 'full') run.hp = run.maxHp;
  else run.hp = Math.max(1, Math.min(run.maxHp, observedHp));
}

export async function replayArrival(arrival, { policy, hp, bossId } = {}) {
  const run = cloneRunState(arrival.run);
  applyHpMode(run, hp, arrival.arrival.hp);
  if (bossId) {
    run.bossPicks = run.bossPicks || {};
    run.bossPicks[50] = bossId;
  }
  const hpEnter = run.hp;
  const fight = await fightF50(run, chooserFor(policy));
  return { policy, hpMode: hp, hpEnter, hpEnterPct: run.maxHp ? hpEnter / run.maxHp : 0, ...fight };
}

function emptyAgg() {
  return {
    n: 0, wins: 0, losses: 0, winRate: 0,
    turns: [], hpEnter: [], hpEnterAbs: [], hpLeftWin: [], bossHpLeftLoss: [],
    bossMaxHp: [], playerDmg: [], incoming: [],
    potionHeals: 0, skillHeals: 0, guards: 0, wards: 0, taunts: 0,
    freezeApplies: 0, freezeSkips: 0, regenHealed: 0, regenTicks: 0,
    headRegrows: 0, enrages: 0, kills: {},
    dmgBasic: 0, dmgBurn: 0, dmgPoison: 0, dmgTorment: 0, dmgSummon: 0, dmgEscort: 0,
    dmgSpecial: {}, byClass: {},
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
  agg.avgRegenHealed = agg.n ? agg.regenHealed / agg.n : 0;
  agg.avgBurnShare = 0;
  const avgTurns = agg.avgTurns || 1;
  agg.avgPlayerDpt = (agg.avgPlayerDmg || 0) / Math.max(1, avgTurns);
  agg.avgIncomingDpt = (agg.avgIncoming || 0) / Math.max(1, avgTurns);
  agg.practicalEhp = (agg.avgBossMaxHp || 0) + (agg.avgRegenHealed || 0);
  agg.expectedTtk = agg.avgPlayerDpt ? (agg.avgBossMaxHp || 0) / agg.avgPlayerDpt : null;
  agg.expectedTtkPractical = agg.avgPlayerDpt ? agg.practicalEhp / agg.avgPlayerDpt : null;
  agg.expectedTtl = agg.avgIncomingDpt ? (agg.avgHpEnterAbs || 0) / agg.avgIncomingDpt : null;
  const kills = Object.entries(agg.kills).sort((a, b) => b[1] - a[1]);
  agg.topKills = kills.slice(0, 10).map(([name, n]) => ({ name, n, rate: agg.losses ? n / agg.losses : 0 }));
  const specials = Object.entries(agg.dmgSpecial).sort((a, b) => b[1] - a[1]);
  const dmgTotal = agg.dmgBasic + agg.dmgBurn + agg.dmgPoison + agg.dmgTorment
    + agg.dmgSummon + agg.dmgEscort + specials.reduce((s, [, v]) => s + v, 0);
  const finisherShare = specials
    .filter(([name]) => F50_FINISHER_RE.test(name))
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

function emptyCondSet() {
  return {
    autoplay_observed: emptyAgg(),
    autoplay_full: emptyAgg(),
    bossaware_observed: emptyAgg(),
    bossaware_full: emptyAgg(),
  };
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
    n: 0, deaths: 0, combat: 0, event: 0, shop: 0, sneakBribe: 0, trial: 0, campfire: 0, boss: 0,
    enterHp: [], leaveHp: [], hpDelta: [],
    enterPots: [], leavePots: [], enterRelics: [], leaveRelics: [],
    enterSkills: [], leaveSkills: [], enterEquip: [], leaveEquip: [],
    enterGold: [], leaveGold: [],
  };
}

function noteSegmentFloor(band, rec) {
  if (!rec) return;
  band.n += 1;
  if (rec.outcome === 'dead') band.deaths += 1;
  const kind = rec.meta?.kind || rec.kind;
  const approach = rec.meta?.approach;
  if (kind === 'boss' || rec.kind === 'boss') band.boss += 1;
  if (kind === 'encounter' || rec.picked?.kind === 'encounter' || rec.meta?.combat) band.combat += 1;
  if (kind === 'event' || rec.picked?.kind === 'event') band.event += 1;
  if (kind === 'shop' || rec.meta?.kind === 'shop') band.shop += 1;
  if (kind === 'trial' || rec.kind === 'trial') band.trial += 1;
  if (kind === 'campfire' || rec.kind === 'campfire') band.campfire += 1;
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
  if (rec.enter?.gold != null) band.enterGold.push(rec.enter.gold);
  if (rec.leave?.gold != null) band.leaveGold.push(rec.leave.gold);
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
    boss: band.boss,
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
    avgEnterGold: mean(band.enterGold),
    avgLeaveGold: mean(band.leaveGold),
  };
}

function emptyFunnel() {
  const slot = () => ({ n: 0, byClass: {} });
  return {
    f30Arrive: slot(), f30Win: slot(),
    f40Arrive: slot(), f40Win: slot(),
    f45Arrive: slot(),
    f50Arrive: slot(), f50Win: slot(),
    throneArrive: slot(), throneWin: slot(),
  };
}

function bumpFunnel(slot, classId) {
  slot.n += 1;
  slot.byClass[classId] = (slot.byClass[classId] || 0) + 1;
}

function theoreticalPressure(bossId) {
  const floor = 50;
  const spec = bossId === 'kryos_demon_general' ? ALT_BOSSES[50] : BOSSES[50];
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
  const regenTick = spec.regen ? Math.round(ehp * spec.regen) : 0;
  return {
    bossId,
    name: spec.name,
    authoredHp: spec.hp,
    authoredAtk: spec.atk,
    authoredSpd: spec.spd,
    authoredDef: spec.def,
    authoredBurn: spec.burn || 0,
    authoredRegen: spec.regen || 0,
    bankChance: spec.bankChance || 0,
    chargeGain: spec.chargeGain || 1,
    heads: !!spec.heads,
    summons: !!spec.summon,
    regenTick,
    scaleHp: sc.hp,
    scaleAtk: sc.atk,
    ehp,
    eatk,
    specials: specials.map(s => ({
      at: s.at, name: s.name, mult: s.mult,
      aoe: !!s.aoe, weaken: s.weaken || null, frail: s.frail || null,
      burn: s.burn || null, burnSure: !!s.burnSure, tormented: s.tormented || null,
    })),
    basicRaw: Math.round(basicRaw),
    midSpecial: mid ? { name: mid.name, at: mid.at, mult: mid.mult } : null,
    finisher: finisher ? {
      name: finisher.name, at: finisher.at, mult: finisher.mult,
      burnSure: !!finisher.burnSure, tormented: finisher.tormented || null,
    } : null,
  };
}

function estimateHitVsArrival(pressure, arrival, special) {
  if (!pressure || !arrival) return null;
  const d = derived({
    classId: arrival.classId,
    stats: arrival.run?.stats || arrival.arrival?.stats || {},
    equipment: arrival.run?.equipment || arrival.arrival?.equipment || {},
    relics: arrival.run?.relics || arrival.arrival?.relics || [],
  });
  const mult = special?.mult || 1;
  let raw = pressure.eatk * (CONFIG.combat.enemyAtkMult ?? 1.35) * mult;
  raw = applyDefense(raw, d.def);
  return Math.max(1, Math.round(raw));
}

function classifyHell(hell, f45, f49, f41N) {
  const notes = [];
  const floors = hell?.floors || {};
  const f45e = floors[45]?.n || 0;
  const f45d = floors[45]?.deaths || 0;
  const travel = [41, 42, 43, 44, 46, 47, 48].map(fl => floors[fl] || { n: 0, deaths: 0, deathRate: 0 });
  const travelEntered = travel.reduce((s, b) => s + (b.n || 0), 0);
  const travelDeaths = travel.reduce((s, b) => s + (b.deaths || 0), 0);
  const travelRate = travelEntered ? travelDeaths / travelEntered : 0;
  const f45Rate = f45e ? f45d / f45e : 0;
  const hpDeltas = [41, 42, 43, 44, 46, 47, 48].map(fl => floors[fl]?.avgHpDelta).filter(v => v != null);
  const avgDelta = hpDeltas.length ? hpDeltas.reduce((a, b) => a + b, 0) / hpDeltas.length : 0;
  const f49Delta = floors[49]?.avgHpDelta;

  if ((f41N || 0) < 12) {
    notes.push(`Only ${f41N || 0} F41 arrivals — Hell slices are noisy`);
  }
  notes.push(`F41–44+46–48 travel deaths ${travelDeaths}/${travelEntered} (${pct(travelRate)})`);
  notes.push(`F45 trial deaths ${f45d}/${f45e} (${pct(f45Rate)})`);
  if (f49Delta != null) notes.push(`F49 HP Δ ${num(f49Delta * 100)}pp`);

  let label = 'UNCLEAR';
  if ((f41N || 0) < 8) label = 'UNCLEAR';
  else if (f45e >= 8 && f45Rate >= 0.40 && travelRate < 0.08) label = 'TRIAL ISSUE';
  else if (travelRate >= 0.12 || avgDelta < -0.08) label = 'ATTRITION ISSUE';
  else if (travelRate < 0.03 && f45Rate < 0.08 && avgDelta > 0.02) label = 'TOO FREE';
  else if (travelRate <= 0.10 && f45Rate <= 0.25) label = 'HEALTHY';
  else label = 'UNCLEAR';

  return { label, notes, travelRate, f45Rate, avgDelta, f49Delta };
}

function classifyF50(byBoss, arrivals, hell) {
  const notes = [];
  const votes = [];
  const n = arrivals?.n || 0;
  if (n < 8) {
    notes.push(`Only ${n} F50 arrivals`);
    votes.push('INSUFFICIENT SAMPLE');
  }
  if ((arrivals?.avgHpPct || 1) < 0.45) {
    notes.push(`F50 arrivals average ${pct(arrivals.avgHpPct)} HP`);
    votes.push('PRE-BOSS ATTRITION');
  } else if (n) {
    notes.push(`F50 arrivals HP ${pct(arrivals.avgHpPct)} (median ${pct(arrivals.medHpPct)})`);
  }
  if ((hell?.label === 'ATTRITION ISSUE' || hell?.label === 'TRIAL ISSUE') && n >= 8) {
    votes.push('PRE-BOSS ATTRITION');
  }

  const duke = byBoss.infernal_duke?.bossaware_full;
  const kryos = byBoss.kryos_demon_general?.bossaware_full;
  const dAuto = byBoss.infernal_duke?.autoplay_observed;
  const kAuto = byBoss.kryos_demon_general?.autoplay_observed;
  if (duke && kryos && duke.n >= 8 && kryos.n >= 8) {
    const dukeHard = duke.winRate < 0.25 && (duke.avgBossHpLeftLoss || 0) >= 0.35;
    const kryosHard = kryos.winRate < 0.25 && (kryos.avgBossHpLeftLoss || 0) >= 0.35;
    const hpNoop = Math.abs((dAuto?.winRate || 0) - (byBoss.infernal_duke?.autoplay_full?.winRate || 0)) < 0.04;
    const awareNoop = Math.abs((dAuto?.winRate || 0) - (byBoss.infernal_duke?.bossaware_observed?.winRate || 0)) < 0.08;
    if (dukeHard && kryosHard) {
      votes.push('BOSS BALANCE');
      if (hpNoop) notes.push('Full HP barely moves Duke autoplay');
      if (awareNoop) notes.push('Boss-aware barely moves Duke');
    } else if (dukeHard && !kryosHard) votes.push('DUKE-SPECIFIC');
    else if (kryosHard && !dukeHard) votes.push('KRYOS-SPECIFIC');
    else if (duke.winRate >= 0.35 && kryos.winRate >= 0.35) votes.push('HEALTHY');
    const spread = Math.abs((duke.winRate || 0) - (kryos.winRate || 0));
    if (spread >= 0.20) notes.push(`Duke vs Kryos aware-full spread ${pct(spread)}`);
  } else if (n >= 8) {
    votes.push('INSUFFICIENT SAMPLE');
    notes.push('One F50 boss is still rare in the matrix');
  }

  const unique = [...new Set(votes)];
  let primary = 'UNCLEAR';
  if (unique.length === 1) primary = unique[0];
  else if (unique.includes('INSUFFICIENT SAMPLE') && unique.length === 1) primary = 'INSUFFICIENT SAMPLE';
  else if (unique.includes('BOSS BALANCE') && unique.includes('PRE-BOSS ATTRITION')) primary = 'MIXED';
  else if (unique.includes('DUKE-SPECIFIC') && unique.includes('KRYOS-SPECIFIC')) primary = 'MIXED';
  else if (unique.includes('BOSS BALANCE')) primary = 'BOSS BALANCE';
  else if (unique.includes('DUKE-SPECIFIC')) primary = 'DUKE-SPECIFIC';
  else if (unique.includes('KRYOS-SPECIFIC')) primary = 'KRYOS-SPECIFIC';
  else if (unique.includes('PRE-BOSS ATTRITION')) primary = 'PRE-BOSS ATTRITION';
  else if (unique.includes('HEALTHY')) primary = 'HEALTHY';
  else if (unique.includes('INSUFFICIENT SAMPLE')) primary = 'INSUFFICIENT SAMPLE';

  const sampleOk = n >= 12;
  const healthyArrivals = (arrivals?.avgHpPct || 0) >= 0.55;
  const bothHard = !!(duke && kryos && duke.n >= 8 && kryos.n >= 8 && duke.winRate < 0.25 && kryos.winRate < 0.25);
  const justified = sampleOk && healthyArrivals && bothHard && hell?.label !== 'ATTRITION ISSUE' && hell?.label !== 'TRIAL ISSUE';
  notes.push(justified
    ? 'F50 live balance pass is justified: healthy arrivals still lose at full HP under competent play.'
    : 'F50 live tuning is not clearly justified from this sample.');

  return { label: primary, notes, evidence: unique, balancePassJustified: justified };
}

function pct(n) {
  return `${((n || 0) * 100).toFixed(1)}%`;
}

function num(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return (Math.round(v * 10) / 10).toFixed(1);
}

function formatProbeReport(rep) {
  const lines = [];
  lines.push(`DungeonTogether Hell / F50 competence — seed ${rep.meta.seed}  climbs ${rep.meta.climbs}`);
  lines.push(`Canonical ${rep.meta.canonicalClimbs} climbs / F41 ${rep.meta.canonicalF41} / F50 ${rep.meta.canonicalF50}; extra ${rep.meta.extraRuns || 0}`);
  lines.push('Capture policy: baseline  F50 arrivals replayed vs both bosses × 4 conditions');
  lines.push(`Frozen knobs: f30SoloHpMult ${TDC.enemy.f30SoloHpMult}  f40SoloHpMult ${TDC.enemy.f40SoloHpMult}`);
  lines.push('');

  const a = rep.arrivals || {};
  lines.push('=== F50 arrival health ===');
  lines.push(`  n=${a.n || 0}  HP ${num(a.avgHp)}/${num(a.avgMaxHp)} (${pct(a.avgHpPct)}, median ${pct(a.medHpPct)})  MP ${pct(a.avgMpPct)}  potions ${num(a.avgPotions)}  gold ${num(a.avgGold)}`);
  lines.push(`  level ${num(a.avgLevel)}  relics ${num(a.avgRelics)}  skills ${num(a.avgSkills)}  equipped ${num(a.avgEquipped)}`);
  lines.push(`  HP <50% ${pct(a.pctBelow50)}  HP <35% ${pct(a.pctBelow35)}  HP ≥80% ${pct(a.pctAtOrAbove80)}`);
  if (a.byLiveBoss) {
    for (const id of F50_BOSS_ORDER) {
      const g = a.byLiveBoss[id];
      if (!g?.n) continue;
      lines.push(`  bound for ${BOSS_IDS[id]}: n=${g.n}  HP ${pct(g.avgHpPct)}  potions ${num(g.avgPotions)}`);
    }
  }
  if (a.byClass) {
    lines.push('  by class:');
    for (const cid of Object.keys(a.byClass).sort()) {
      const c = a.byClass[cid];
      lines.push(`    ${cid.padEnd(12)} n=${c.n}  HP ${pct(c.avgHpPct)}  potions ${num(c.avgPotions)}  relics ${num(c.avgRelics)}`);
    }
  }
  lines.push('');

  if (rep.canonical) {
    const c = rep.canonical;
    lines.push('=== Canonical seed 20260823 (1002 climbs, kept separate) ===');
    lines.push(`  F41 ${c.f41}  F45 ${c.f45}  F45 deaths ${c.f45Deaths}  F50 ${c.f50}  F50 deaths ${c.f50Deaths}  throne ${c.throne}  wins ${c.wins}`);
    lines.push('');
  }

  if (rep.hell?.floors) {
    lines.push('=== F41–50 mortality (F40 winners, live climb) ===');
    lines.push(`  Hell classification: ${rep.hell.label}`);
    for (const fl of HELL_FLOORS) {
      const b = rep.hell.floors[fl];
      if (!b) continue;
      lines.push(`  F${fl} n=${b.n}  die ${pct(b.deathRate)} (${b.deaths})  `
        + `HP ${pct(b.avgEnterHp)} → ${pct(b.avgLeaveHp)} (Δ ${num((b.avgHpDelta || 0) * 100)}pp)`
        + `  pots ${num(b.avgEnterPots)}→${num(b.avgLeavePots)}  relics ${num(b.avgEnterRelics)}→${num(b.avgLeaveRelics)}`
        + `  skills ${num(b.avgEnterSkills)}  equip ${num(b.avgEnterEquip)}  gold ${num(b.avgEnterGold)}→${num(b.avgLeaveGold)}`);
    }
    lines.push('');
  }

  if (rep.f45) {
    const t = rep.f45;
    lines.push('=== F45 trial ===');
    lines.push(`  entered ${t.entered}  deaths ${t.deaths}  clear ${pct(t.clearRate)}  HP in ${pct(t.avgEnterHp)}  HP out wins ${pct(t.avgLeaveHpWin)}  pots ${num(t.avgEnterPots)}→${num(t.avgLeavePots)}`);
    if (t.modifiers) {
      for (const [id, m] of Object.entries(t.modifiers).sort((a, b) => b[1].n - a[1].n)) {
        lines.push(`    ${id.padEnd(16)} n=${m.n}  die ${pct(m.n ? m.deaths / m.n : 0)} (${m.deaths})`);
      }
    }
    if (t.byClass) {
      for (const cid of Object.keys(t.byClass).sort()) {
        const c = t.byClass[cid];
        lines.push(`    class ${cid.padEnd(10)} n=${c.n}  die ${pct(c.n ? c.deaths / c.n : 0)}`);
      }
    }
    lines.push('');
  }

  if (rep.f49) {
    const r = rep.f49;
    lines.push('=== F49 recovery (F50 arrivals) ===');
    lines.push(`  n=${r.n}  HP ${pct(r.avgEnterHp)} → ${pct(r.avgLeaveHp)} (Δ ${num((r.avgHpDelta || 0) * 100)}pp)`);
    lines.push(`  MP ${pct(r.avgEnterMp)} → ${pct(r.avgLeaveMp)}  potions ${num(r.avgEnterPots)} → ${num(r.avgLeavePots)}`);
    if (r.choices) lines.push(`  choices: ${Object.entries(r.choices).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}`);
    lines.push('');
  }

  if (rep.natural) {
    lines.push('=== Natural F50 (live climb assignment) ===');
    for (const id of F50_BOSS_ORDER) {
      const g = rep.natural[id];
      if (!g) continue;
      lines.push(`  ${(BOSS_IDS[id] || id).padEnd(42)} n=${g.n}  win ${g.wins}  lose ${g.losses}  survive ${pct(g.n ? g.wins / g.n : 0)}  HP in ${pct(g.avgEnterHp)}  HP out wins ${pct(g.avgLeaveHpWin)}`);
    }
    lines.push('');
  }

  for (const bossId of F50_BOSS_ORDER) {
    const c = (rep.byBoss || {})[bossId];
    if (!c) continue;
    lines.push(`=== ${BOSS_IDS[bossId]} (${bossId})  identical-kit n=${c.autoplay_observed?.n || 0} ===`);
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
        + `bossLeft ${pct(g.avgBossHpLeftLoss || 0)}`,
      );
      lines.push(`      TTK ${num(g.expectedTtk)}  practical ${num(g.expectedTtkPractical)}  TTL ${num(g.expectedTtl)}  dpt out ${num(g.avgPlayerDpt)}  dpt in ${num(g.avgIncomingDpt)}  eHP ${num(g.avgBossMaxHp)}`);
      if (g.topKills?.length) {
        lines.push(`      deaths: ${g.topKills.map(k => `${k.name} ${pct(k.rate)}`).join(' | ')}`);
      }
      if (g.dmgShare) {
        const spec = (g.dmgShare.specials || []).slice(0, 4).map(s => `${s.name} ${pct(s.share)}`).join('  ');
        lines.push(`      dmg: basic ${pct(g.dmgShare.basic)}  burn ${pct(g.dmgShare.burn)}  poison ${pct(g.dmgShare.poison)}  torment ${pct(g.dmgShare.torment)}  finisher ${pct(g.dmgShare.finisher)}  ${spec}`);
      }
    }
    lines.push('');
    lines.push('  by class (auto observed/full  |  aware observed/full):');
    const classes = new Set(Object.keys(c.autoplay_observed?.byClass || {}));
    for (const cid of [...classes].sort()) {
      const o = c.bossaware_observed?.byClass?.[cid];
      const f = c.bossaware_full?.byClass?.[cid];
      const ao = c.autoplay_observed?.byClass?.[cid];
      const af = c.autoplay_full?.byClass?.[cid];
      lines.push(
        `    ${cid.padEnd(12)}  auto ${pct(ao?.winRate || 0)}/${pct(af?.winRate || 0)}  `
        + `aware ${pct(o?.winRate || 0)}/${pct(f?.winRate || 0)}  n ${ao?.n || 0}`,
      );
    }
    lines.push('');
  }

  if (rep.pressure) {
    lines.push('=== Fight-length / pressure (authored F50 solo) ===');
    for (const bossId of F50_BOSS_ORDER) {
      const p = rep.pressure[bossId];
      if (!p) continue;
      lines.push(`  ${p.name}: eHP ${p.ehp}  ATK ${p.eatk}  SPD ${p.authoredSpd}  DEF ${p.authoredDef}  burn ${p.authoredBurn}  bank ${p.bankChance}`);
      lines.push(`    mid ${p.midSpecial ? `${p.midSpecial.name} x${p.midSpecial.mult}@${p.midSpecial.at}` : '—'}  `
        + `finisher ${p.finisher ? `${p.finisher.name} x${p.finisher.mult}@${p.finisher.at}` : '—'}`);
      if (p.sampleHit) {
        lines.push(`    vs median arrival DEF: basic ${p.sampleHit.basic}  mid ${p.sampleHit.mid}  finisher ${p.sampleHit.finisher}`);
      }
    }
    lines.push('');
  }

  if (rep.funnel) {
    lines.push('=== Per-class late-game funnel ===');
    const slots = [
      ['F30 arrive', 'f30Arrive'], ['F30 win', 'f30Win'],
      ['F40 arrive', 'f40Arrive'], ['F40 win', 'f40Win'],
      ['F45 arrive', 'f45Arrive'],
      ['F50 arrive', 'f50Arrive'], ['F50 win', 'f50Win'],
      ['Throne', 'throneArrive'], ['Win', 'throneWin'],
    ];
    const classes = new Set();
    for (const [, key] of slots) {
      for (const cid of Object.keys(rep.funnel[key]?.byClass || {})) classes.add(cid);
    }
    lines.push(`  ${'Class'.padEnd(12)}${slots.map(([lab]) => lab.padStart(12)).join('')}`);
    lines.push(`  ${'ALL'.padEnd(12)}${slots.map(([, key]) => String(rep.funnel[key]?.n || 0).padStart(12)).join('')}`);
    for (const cid of [...classes].sort()) {
      lines.push(`  ${cid.padEnd(12)}${slots.map(([, key]) => String(rep.funnel[key]?.byClass?.[cid] || 0).padStart(12)).join('')}`);
    }
    lines.push('');
  }

  if (rep.throne) {
    const t = rep.throne;
    lines.push('=== Throne ===');
    lines.push(`  arrivals ${t.n}  fought ${t.fought}  wins ${t.wins}  deaths ${t.deaths}  HP in ${pct(t.avgEnterHp)}`);
    if (t.n < 8) lines.push('  INSUFFICIENT SAMPLE');
    if (t.byClass) {
      for (const cid of Object.keys(t.byClass).sort()) {
        const c = t.byClass[cid];
        lines.push(`    ${cid.padEnd(12)} n=${c.n}  win ${c.wins}`);
      }
    }
    lines.push('');
  }

  lines.push('=== Classification ===');
  lines.push(`  Hell: ${rep.hell?.label || 'UNCLEAR'}`);
  lines.push(`  F50:  ${rep.classification?.label || 'UNCLEAR'}`);
  lines.push(`  F50 live tuning justified: ${rep.classification?.balancePassJustified ? 'YES' : 'NO'}`);
  for (const n of (rep.hell?.notes || [])) lines.push(`  - ${n}`);
  for (const n of (rep.classification?.notes || [])) lines.push(`  - ${n}`);
  return lines.join('\n');
}

function emptyTrial() {
  return {
    entered: 0, deaths: 0, enterHp: [], leaveHpWin: [], enterPots: [], leavePots: [],
    modifiers: {}, byClass: {},
  };
}

export async function runF50Probe({
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
    infernal_duke: emptyCondSet(),
    kryos_demon_general: emptyCondSet(),
  };
  const liveByBoss = {};
  const arrivalHealth = emptyHealth();
  const arrivalByLiveBoss = {
    infernal_duke: emptyHealth(),
    kryos_demon_general: emptyHealth(),
  };
  const hellFloors = {};
  for (const fl of HELL_FLOORS) hellFloors[fl] = emptyFloorBand();
  const f45 = emptyTrial();
  const f49 = {
    n: 0, enterHp: [], leaveHp: [], hpDelta: [], enterMp: [], leaveMp: [],
    enterPots: [], leavePots: [], choices: {},
  };
  const natural = {
    infernal_duke: { n: 0, wins: 0, losses: 0, enterHp: [], leaveHpWin: [] },
    kryos_demon_general: { n: 0, wins: 0, losses: 0, enterHp: [], leaveHpWin: [] },
  };
  const funnel = emptyFunnel();
  const throne = { n: 0, fought: 0, wins: 0, deaths: 0, enterHp: [], byClass: {} };
  const canonicalCounts = {
    f41: 0, f45: 0, f45Deaths: 0, f50: 0, f50Deaths: 0, throne: 0, wins: 0,
  };

  let climbs = 0;
  let f41N = 0;
  let f50N = 0;
  let canonicalClimbs = 0;
  let canonicalF41 = 0;
  let canonicalF50 = 0;
  const f50Jobs = [];

  for (const job of jobs) {
    climbs += 1;
    const isCanonical = climbs <= canonicalN;
    if (isCanonical) canonicalClimbs += 1;
    const full = await captureFullClimb({ seed: job.seed, classId: job.classId, policy: capturePolicy });
    const trace = full.trace || [];
    const rec30 = traceFloor(trace, 30);
    const rec40 = traceFloor(trace, 40);
    const rec45 = traceFloor(trace, 45);
    const rec49 = traceFloor(trace, 49);
    const rec50 = traceFloor(trace, 50);
    const rec51 = traceFloor(trace, 51);

    if (rec30) {
      bumpFunnel(funnel.f30Arrive, job.classId);
      if (rec30.outcome !== 'dead') bumpFunnel(funnel.f30Win, job.classId);
    }
    if (rec40) {
      bumpFunnel(funnel.f40Arrive, job.classId);
      if (rec40.outcome !== 'dead') bumpFunnel(funnel.f40Win, job.classId);
    }
    if (rec45) bumpFunnel(funnel.f45Arrive, job.classId);
    if (rec50) {
      bumpFunnel(funnel.f50Arrive, job.classId);
      if (rec50.outcome !== 'dead') bumpFunnel(funnel.f50Win, job.classId);
    }
    if (rec51) {
      bumpFunnel(funnel.throneArrive, job.classId);
      const won = rec51.outcome !== 'dead' && rec51.outcome !== 'escape';
      if (won) bumpFunnel(funnel.throneWin, job.classId);
    }

    const won40 = rec40 && rec40.outcome !== 'dead';
    if (won40) {
      const rec41 = traceFloor(trace, 41);
      if (rec41) {
        f41N += 1;
        if (isCanonical) {
          canonicalF41 += 1;
          canonicalCounts.f41 += 1;
        }
      }
      for (const fl of HELL_FLOORS) {
        const rec = traceFloor(trace, fl);
        if (rec) noteSegmentFloor(hellFloors[fl], rec);
      }
    }

    if (rec45) {
      f45.entered += 1;
      if (isCanonical) canonicalCounts.f45 += 1;
      if (rec45.outcome === 'dead') {
        f45.deaths += 1;
        if (isCanonical) canonicalCounts.f45Deaths += 1;
      }
      if (rec45.enter?.hpPct != null) f45.enterHp.push(rec45.enter.hpPct);
      if (rec45.outcome !== 'dead' && rec45.leave?.hpPct != null) f45.leaveHpWin.push(rec45.leave.hpPct);
      if (rec45.enter?.healConsumables != null) f45.enterPots.push(rec45.enter.healConsumables);
      if (rec45.leave?.healConsumables != null) f45.leavePots.push(rec45.leave.healConsumables);
      const mod = rec45.meta?.trialId || 'unknown';
      if (!f45.modifiers[mod]) f45.modifiers[mod] = { n: 0, deaths: 0 };
      f45.modifiers[mod].n += 1;
      if (rec45.outcome === 'dead') f45.modifiers[mod].deaths += 1;
      if (!f45.byClass[job.classId]) f45.byClass[job.classId] = { n: 0, deaths: 0 };
      f45.byClass[job.classId].n += 1;
      if (rec45.outcome === 'dead') f45.byClass[job.classId].deaths += 1;
    }

    if (rec50) {
      f50N += 1;
      if (isCanonical) {
        canonicalF50 += 1;
        canonicalCounts.f50 += 1;
        if (rec50.outcome === 'dead') canonicalCounts.f50Deaths += 1;
      }
      const liveId = rec50.meta?.bossId || 'unknown';
      if (natural[liveId]) {
        natural[liveId].n += 1;
        if (rec50.outcome === 'dead') natural[liveId].losses += 1;
        else natural[liveId].wins += 1;
        if (rec50.enter?.hpPct != null) natural[liveId].enterHp.push(rec50.enter.hpPct);
        if (rec50.outcome !== 'dead' && rec50.leave?.hpPct != null) {
          natural[liveId].leaveHpWin.push(rec50.leave.hpPct);
        }
      }
      f50Jobs.push({ seed: job.seed, classId: job.classId, liveId, canonical: isCanonical });
    }

    if (rec51) {
      throne.n += 1;
      if (isCanonical) canonicalCounts.throne += 1;
      if (rec51.meta?.fought) throne.fought += 1;
      const won = rec51.outcome !== 'dead' && rec51.outcome !== 'escape';
      if (won) {
        throne.wins += 1;
        if (isCanonical) canonicalCounts.wins += 1;
      } else if (rec51.outcome === 'dead') throne.deaths += 1;
      if (rec51.enter?.hpPct != null) throne.enterHp.push(rec51.enter.hpPct);
      if (!throne.byClass[job.classId]) throne.byClass[job.classId] = { n: 0, wins: 0 };
      throne.byClass[job.classId].n += 1;
      if (won) throne.byClass[job.classId].wins += 1;
    }
  }

  for (const job of f50Jobs) {
    const cap = await captureF50Arrival({ seed: job.seed, classId: job.classId, policy: capturePolicy });
    if (!cap.reached) continue;
    const liveId = cap.bossId || job.liveId || 'unknown';
    if (!liveByBoss[liveId]) liveByBoss[liveId] = emptyCondSet();
    pushHealth(arrivalHealth, cap.arrival, cap.classId);
    if (arrivalByLiveBoss[liveId]) pushHealth(arrivalByLiveBoss[liveId], cap.arrival, cap.classId);

    if (cap.f49) {
      f49.n += 1;
      if (cap.f49.enterHpPct != null) f49.enterHp.push(cap.f49.enterHpPct);
      if (cap.f49.leaveHpPct != null) f49.leaveHp.push(cap.f49.leaveHpPct);
      if (cap.f49.enterHpPct != null && cap.f49.leaveHpPct != null) {
        f49.hpDelta.push(cap.f49.leaveHpPct - cap.f49.enterHpPct);
      }
      if (cap.f49.enterMpPct != null) f49.enterMp.push(cap.f49.enterMpPct);
      if (cap.f49.leaveMpPct != null) f49.leaveMp.push(cap.f49.leaveMpPct);
      if (cap.f49.enterPots != null) f49.enterPots.push(cap.f49.enterPots);
      if (cap.f49.leavePots != null) f49.leavePots.push(cap.f49.leavePots);
      if (cap.f49.choice) f49.choices[cap.f49.choice] = (f49.choices[cap.f49.choice] || 0) + 1;
    }

    for (const cond of CONDITIONS) {
      for (const otherId of F50_BOSS_ORDER) {
        const row = await replayArrival(cap, { ...cond, bossId: otherId });
        addFight(byBoss[otherId][cond.id], row, cap.classId);
        if (otherId === liveId && liveByBoss[liveId]) addFight(liveByBoss[liveId][cond.id], row, cap.classId);
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
  arrivalsOut.byLiveBoss = {
    infernal_duke: finishHealth(arrivalByLiveBoss.infernal_duke),
    kryos_demon_general: finishHealth(arrivalByLiveBoss.kryos_demon_general),
  };

  const hellFinished = {};
  for (const fl of HELL_FLOORS) hellFinished[fl] = finishFloorBand(hellFloors[fl]);
  const hell = classifyHell({ floors: hellFinished }, f45, f49, f41N);
  hell.floors = hellFinished;

  const f45Out = {
    entered: f45.entered,
    deaths: f45.deaths,
    clearRate: f45.entered ? 1 - f45.deaths / f45.entered : 0,
    avgEnterHp: mean(f45.enterHp),
    avgLeaveHpWin: mean(f45.leaveHpWin),
    avgEnterPots: mean(f45.enterPots),
    avgLeavePots: mean(f45.leavePots),
    modifiers: f45.modifiers,
    byClass: f45.byClass,
  };

  const f49Out = {
    n: f49.n,
    avgEnterHp: mean(f49.enterHp),
    avgLeaveHp: mean(f49.leaveHp),
    avgHpDelta: mean(f49.hpDelta),
    avgEnterMp: mean(f49.enterMp),
    avgLeaveMp: mean(f49.leaveMp),
    avgEnterPots: mean(f49.enterPots),
    avgLeavePots: mean(f49.leavePots),
    choices: f49.choices,
  };

  const naturalOut = {};
  for (const id of F50_BOSS_ORDER) {
    const g = natural[id];
    naturalOut[id] = {
      n: g.n, wins: g.wins, losses: g.losses,
      avgEnterHp: mean(g.enterHp),
      avgLeaveHpWin: mean(g.leaveHpWin),
    };
  }

  const pressure = {};
  const medianArrival = f50Jobs[0]
    ? await captureF50Arrival({ seed: f50Jobs[0].seed, classId: f50Jobs[0].classId, policy: capturePolicy })
    : null;
  for (const bossId of F50_BOSS_ORDER) {
    const p = theoreticalPressure(bossId);
    if (medianArrival?.reached) {
      p.sampleHit = {
        basic: estimateHitVsArrival(p, medianArrival, null),
        mid: p.midSpecial ? estimateHitVsArrival(p, medianArrival, p.midSpecial) : null,
        finisher: p.finisher ? estimateHitVsArrival(p, medianArrival, p.finisher) : null,
      };
    }
    pressure[bossId] = p;
  }

  const classification = classifyF50(byBoss, arrivalsOut, hell);
  return {
    meta: {
      name: 'F50_COMPETENCE',
      seed,
      climbs,
      extraRuns,
      canonicalClimbs,
      canonicalF41,
      canonicalF50,
      f41: f41N,
      f50: f50N,
      capturePolicy,
      generatedAt: new Date().toISOString(),
      f30SoloHpMult: TDC.enemy.f30SoloHpMult,
      f40SoloHpMult: TDC.enemy.f40SoloHpMult,
    },
    canonical: canonicalCounts,
    arrivals: arrivalsOut,
    byBoss,
    liveByBoss,
    pressure,
    hell,
    f45: f45Out,
    f49: f49Out,
    natural: naturalOut,
    funnel,
    throne: {
      n: throne.n,
      fought: throne.fought,
      wins: throne.wins,
      deaths: throne.deaths,
      avgEnterHp: mean(throne.enterHp),
      byClass: throne.byClass,
    },
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
  const out = flags.out || 'reports/f50_competence.json';
  const rep = await runF50Probe({ seed, runs, extraRuns, capturePolicy, classId });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(rep, null, 2));
  console.log(formatProbeReport(rep));
  console.log(`\nWrote ${out}`);
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/run_f50_probe.js');
if (isMain) main();
