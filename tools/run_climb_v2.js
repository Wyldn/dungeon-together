#!/usr/bin/env node
// Simulation V2 — faithful solo climb. Does not call grantCombatLoot, combat_sim, or run_sim.

import { newRun, runRng, loadMeta, rollStart, awakenMonolith } from '../js/state.js';
import { EVENTS } from '../js/data/events.js';
import { presentEvent, recordEvent } from '../js/data/world.js';
import { classifyFloor, dealLiveFloorCards, LAST_FLOOR } from '../js/data/floorcards.js';
import { biomeForFloor, ENEMIES, pickBossForFloor, pickTrialModifier, ALT_BOSSES } from '../js/data/enemies.js';
import { CONSUMABLES } from '../js/data/items.js';
import { planBossEncounter, pushEventHistory, pushEncounterHistory, pushTakenEventHistory } from '../js/data/balance.js';
import { gainXp } from '../js/character.js';
import { reqMet } from '../js/requirements.js';
import { resolveEventBranch, applyEventOutcome } from '../js/outcomes.js';
import {
  applyVictoryRewards, applyEliteVictoryFind,
  grantReward, rollBossHoard, applyItemAct,
} from '../js/rewards.js';
import { buildShopStock, shopDiscount, applyShopBuy, applyShopHeal, applyShopLeave } from '../js/shop.js';
import {
  planEncounterGroup, encounterOptions, resolveEncounterApproach, isSpecialEventFoe,
} from '../js/encounter.js';
import { applyLevelProgression } from '../js/progression.js';
import { beginThrone, resolveThroneChoice, throneEndingId } from '../js/throne.js';
import { enterNextFloor } from '../js/floor.js';
import { climbCheckpoint, climbSnapshot } from '../js/climb_snapshot.js';
import { buildEnemy } from '../js/combat_core.js';
import { runHeadlessFight } from './combat_headless.js';
import { baselinePolicy } from './policies/baseline.js';
import { scriptedPolicy } from './policies/scripted.js';

function specMeta(specs) {
  return (specs || []).map(s => ({
    id: s.id,
    name: s.name || s.id,
    elite: !!s.elite,
    boss: !!s.boss,
  }));
}

export function resourceSnap(run) {
  const cons = run.consumables || [];
  return {
    hp: run.hp,
    maxHp: run.maxHp,
    hpPct: run.maxHp ? run.hp / run.maxHp : 0,
    gold: run.gold,
    mp: run.mp,
    maxMp: run.maxMp,
    level: run.level,
    consumables: cons.length,
    healConsumables: cons.filter(id => {
      const c = CONSUMABLES.find(x => x.id === id);
      return !!(c && (c.heal || c.healPct));
    }).length,
    relics: (run.relics || []).length,
    skills: (run.skills || []).length,
    equipped: Object.values(run.equipment || {}).filter(Boolean).length,
  };
}

export function isAltBossId(id) {
  return Object.values(ALT_BOSSES).some(b => b?.id === id);
}

export function classifyDeathCause(floorKind, meta, floor) {
  if (floorKind === 'throne') return 'throne';
  if (floorKind === 'boss') return floor === 50 ? 'f50_boss' : 'biome_boss';
  if (floorKind === 'trial') return 'trial';
  if (meta?.kind === 'event' && !meta.combat) return 'event_attrition';
  if (meta?.kind === 'event' && meta.combat) {
    return meta.special ? 'special_encounter' : 'event_combat';
  }
  if (meta?.elite) return 'elite';
  if (meta?.kind === 'encounter' || meta?.combat) return 'normal_encounter';
  return 'unknown';
}

function hooksFor(run, policy) {
  return {
    runRng,
    onItem: async (item, lines) => {
      const pick = policy.chooseEquip?.(run, item) || { act: 'stash' };
      const r = applyItemAct(run, item, pick.act, pick.slot);
      if (r.act === 'equip') lines.push({ text: `Equipped: ${item.name}`, cls: 'item' });
      else if (r.act === 'sell') lines.push({ text: `Sold ${item.name} for ${r.gold}g`, cls: 'gold' });
      else lines.push({ text: `Stashed: ${item.name}`, cls: 'item' });
    },
    onLearnSkill: async (sk) => {
      policy.chooseSkillEquip?.(run, sk);
    },
    chooseFuture: () => policy.chooseWaypoint?.(run) || 'recovery',
    chooseOption: (options, ctx) => policy.chooseOption?.(options, ctx),
    chooseRelic: (choices) => policy.chooseRelic?.(choices),
    unlock: () => {},
  };
}

async function applyUps(run, ups, policy) {
  applyLevelProgression(run, ups, policy, { runRng });
}

function buildTrash(run, specs, hpMult = 1) {
  const biome = biomeForFloor(run.floor);
  return specs.map((s, i) => buildEnemy(s, run.floor, biome.floors[0], { hpMult, spawnIndex: i }));
}

async function doFight(run, policy, enemies, { modifier = null, boss = null, reward = null } = {}) {
  policy.beginFight?.();
  const rng = runRng(run);
  const result = await runHeadlessFight({
    run, rng, enemies, modifier,
    policy: (f) => policy.chooseCombatAction(f),
    faithful: true,
  });
  const fightMeta = {
    combat: true,
    enemies: specMeta(enemies),
    elite: (enemies || []).some(e => e.elite),
    special: (enemies || []).some(e => isSpecialEventFoe(e)),
    bossId: boss?.id || null,
    isAltBoss: !!(boss?.id && isAltBossId(boss.id)),
  };
  if (result.result === 'dead' || run.hp <= 0) {
    return { outcome: 'dead', meta: fightMeta };
  }
  if (result.result !== 'win') return { outcome: result.result || 'ok', meta: fightMeta };
  const gold = result.gold || 0;
  const xp = result.xp || 0;
  const { lines, elitePending } = applyVictoryRewards(run, enemies, gold, xp, { boss, reward });
  const h = hooksFor(run, policy);
  if (elitePending) await applyEliteVictoryFind(run, lines, h);
  const ups = gainXp(run, xp, runRng(run));
  await applyUps(run, ups, policy);
  if (reward) {
    const rewardUps = await grantReward(run, reward, lines, { ...h, paySkills: true });
    await applyUps(run, rewardUps, policy);
  }
  if (boss) await rollBossHoard(run, h);
  return { outcome: 'cleared', gold, xp, lines, meta: fightMeta };
}

async function resolveEvent(run, ev, policy) {
  const presented = presentEvent(ev, run);
  run.seenEvents.push(presented.id);
  recordEvent(run, presented);
  pushTakenEventHistory(run, presented.id);
  const eventMeta = { kind: 'event', eventId: presented.id, eventCategory: presented.category || null };
  if (presented.shop) {
    const shop = await resolveShop(run, presented, policy);
    return { ...shop, meta: { ...eventMeta, kind: 'shop' } };
  }

  let choices = [...(presented.choices || [])];
  if (choices.length && choices.every(c => !reqMet(run, c.req).ok)) {
    choices.push({ label: 'Move on', hint: 'leave empty-handed', outcome: { text: 'Nothing here is for you today.' } });
  }
  const choice = policy.chooseEvent(run, presented, choices);
  const rng = runRng(run);
  const sparkle = !!run.eventSparkle;
  const { outcome, roll } = resolveEventBranch(run, presented, choice, rng, { sparkle });
  const lines = roll ? [roll.line] : [];
  const result = await applyEventOutcome(run, presented, outcome, rng, {
    ...hooksFor(run, policy),
    sparkle,
    lines,
  });
  await applyUps(run, result.ups, policy);
  eventMeta.choice = choice?.label || choice?.id || null;
  if (result.kind === 'escape') return { outcome: 'escape', meta: eventMeta };
  if (result.kind === 'dead') return { outcome: 'dead', meta: eventMeta };
  if (result.kind === 'combat') {
    const fight = await doFight(run, policy, result.combat.prebuilt, {
      reward: result.combat.reward,
    });
    return { ...fight, meta: { ...eventMeta, ...(fight.meta || {}), kind: 'event', combat: true } };
  }
  return { outcome: 'ok', lines: result.lines, meta: eventMeta };
}

async function resolveShop(run, ev, policy) {
  const rng = runRng(run);
  const stock = buildShopStock(run, rng);
  const { discount } = shopDiscount(run);
  let boughtHere = false;
  for (let guard = 0; guard < 24; guard++) {
    const act = policy.chooseShopAction(run, stock, { discount, ev });
    if (!act || act.act === 'leave') break;
    if (act.act === 'heal') {
      const r = applyShopHeal(run, discount);
      if (r.ok) boughtHere = true;
      else break;
      continue;
    }
    if (act.act === 'buy') {
      const r = applyShopBuy(run, stock, act.i, discount, { runRng });
      if (!r.ok) break;
      boughtHere = true;
      if (r.listing?.kind === 'equip') {
        await hooksFor(run, policy).onItem(r.listing.item, []);
      }
    }
  }
  applyShopLeave(run, boughtHere);
  return { outcome: 'ok', meta: { kind: 'shop' } };
}

async function resolveEncounter(run, policy, prebuilt, hpMult) {
  const rng = runRng(run);
  const { group, planHp } = planEncounterGroup(run, rng, prebuilt, hpMult);
  rng.advance();
  const opts = encounterOptions(run, group);
  const act = policy.chooseEncounterApproach(run, group, opts);
  const resolved = resolveEncounterApproach(run, runRng(run), group, act, {
    planHp, hooks: { runRng },
  });
  const approachMeta = {
    kind: 'encounter',
    approach: resolved.kind,
    enemies: specMeta(group),
    elite: (group || []).some(e => e.elite),
  };
  if (resolved.kind === 'bribe') return { outcome: 'ok', lines: resolved.lines, meta: approachMeta };
  if (resolved.kind === 'sneak') {
    await applyUps(run, resolved.ups, policy);
    return { outcome: 'ok', meta: approachMeta };
  }
  const enemies = buildTrash(run, resolved.group, resolved.hpMult || planHp);
  const fight = await doFight(run, policy, enemies, {
    modifier: resolved.modifier || null,
  });
  return { ...fight, meta: { ...approachMeta, ...(fight.meta || {}), kind: 'encounter' } };
}

async function resolveTravelCard(run, card, policy) {
  if (card.kind === 'encounter') {
    pushEventHistory(run, 'combat');
    pushEncounterHistory(run, card.enemies);
    return resolveEncounter(run, policy, card.enemies, card.hpMult || 1);
  }
  const ev = presentEvent(EVENTS.find(e => e.id === card.eventId), run);
  run.eventSparkle = !!card.sparkle;
  pushEventHistory(run, ev.category || 'unknown');
  recordEvent(run, ev);
  return resolveEvent(run, ev, policy);
}

async function resolveTrial(run, policy) {
  const rng = runRng(run);
  const mod = pickTrialModifier(rng, run);
  const biome = biomeForFloor(run.floor);
  const { pickEnemyPlan } = await import('../js/data/floorcards.js');
  const plan = pickEnemyPlan(rng, run, biome, 1);
  rng.advance();
  pushEventHistory(run, 'combat');
  pushEncounterHistory(run, plan.specs);
  const enemies = buildTrash(run, plan.specs, plan.hpMult);
  const fight = await doFight(run, policy, enemies, {
    modifier: { ...mod, goldMult: (mod.goldMult || 1) * 1.5 },
  });
  return {
    ...fight,
    meta: { ...(fight.meta || {}), kind: 'trial', trialId: mod?.id || mod?.name || null },
  };
}

async function resolveBoss(run, policy) {
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
  const fight = await doFight(run, policy, enemies, { boss });
  return {
    ...fight,
    meta: {
      ...(fight.meta || {}),
      kind: 'boss',
      bossId: boss?.id || null,
      bossName: boss?.name || boss?.id || null,
      isAltBoss: !!(boss?.id && isAltBossId(boss.id)),
      bossFloor: run.floor,
    },
  };
}

async function resolveThroneFloor(run, policy) {
  const rngPick = runRng(run);
  const throne = beginThrone(run, rngPick);
  const choice = policy.chooseThrone(run, throne);
  const resolved = resolveThroneChoice(run, choice, throne.boss);
  const throneMeta = {
    kind: 'throne',
    throneChoice: choice,
    bossId: resolved.spec?.id || throne.boss?.id || null,
    isAltBoss: !!((resolved.spec?.id || throne.boss?.id) && isAltBossId(resolved.spec?.id || throne.boss?.id)),
  };
  if (resolved.kind === 'ending') {
    run.over = true;
    return { outcome: resolved.ending, meta: { ...throneMeta, fought: false } };
  }
  const enemies = [buildEnemy(resolved.spec, run.floor, run.floor, { boss: true, hpMult: resolved.hpMult })];
  const fight = await doFight(run, policy, enemies, { boss: resolved.spec });
  if (fight.outcome === 'dead') return { ...fight, meta: { ...throneMeta, ...(fight.meta || {}), fought: true } };
  run.over = true;
  return {
    outcome: throneEndingId(choice, 'win'),
    meta: { ...throneMeta, ...(fight.meta || {}), fought: true },
  };
}

export async function simulateClimbV2(run, policy, opts = {}) {
  const maxFloors = opts.maxFloors ?? LAST_FLOOR;
  const checkpoints = opts.checkpoints || [];
  const mark = (label) => {
    const cp = climbCheckpoint(run, { label });
    checkpoints.push(cp);
    if (opts.onCheckpoint) opts.onCheckpoint(cp);
    return cp;
  };
  mark('start');

  const trace = [];
  let outcome = null;
  while (!run.over && run.hp > 0 && run.floor < maxFloors) {
    enterNextFloor(run);
    const kind = classifyFloor(run.floor);
    mark(`enter_${run.floor}_${kind}`);
    const enter = resourceSnap(run);
    const biome = biomeForFloor(run.floor);

    let step;
    let offered = null;
    let picked = null;
    if (kind === 'throne') step = await resolveThroneFloor(run, policy);
    else if (kind === 'boss') step = await resolveBoss(run, policy);
    else if (kind === 'trial') step = await resolveTrial(run, policy);
    else if (kind === 'campfire') {
      const ev = EVENTS.find(e => e.id === 'campfire');
      run.eventSparkle = false;
      step = await resolveEvent(run, ev, policy);
    } else {
      const cards = dealLiveFloorCards(runRng(run), run);
      mark(`deal_${run.floor}`);
      if (opts.stopAfterDeal) {
        const snap = climbSnapshot(run, { outcome: 'deal', checkpoints: [...checkpoints, { ...climbCheckpoint(run), cards }] });
        snap.trace = trace;
        return snap;
      }
      const card = policy.chooseFloorCard(run, cards);
      offered = cards.map(c => ({ kind: c.kind, category: c.category || null, eventId: c.eventId || null }));
      picked = { kind: card.kind, category: card.category || null, eventId: card.eventId || null };
      step = await resolveTravelCard(run, card, policy);
    }
    mark(`after_${run.floor}`);
    const rec = {
      floor: run.floor,
      kind,
      biome: biome.id,
      enter,
      leave: resourceSnap(run),
      outcome: step?.outcome || 'ok',
      meta: step?.meta || {},
      offered,
      picked,
    };
    if (step?.outcome === 'dead') {
      rec.deathCause = classifyDeathCause(kind, step?.meta, run.floor);
      rec.starved = enter.gold < 15 && enter.healConsumables === 0 && enter.hpPct < 0.35;
    }
    trace.push(rec);
    if (opts.onFloor) opts.onFloor(rec, run);
    if (step?.outcome === 'dead') { outcome = 'dead'; break; }
    if (step?.outcome === 'escape') { outcome = 'escape'; break; }
    if (step?.outcome && ['secret', 'win', 'corrupt_king'].includes(step.outcome)) {
      outcome = step.outcome;
      break;
    }
    if (opts.stopAfterFloor && run.floor >= opts.stopAfterFloor) {
      outcome = 'stopped';
      break;
    }
  }
  if (!outcome) {
    if (run.hp <= 0) outcome = 'dead';
    else if (run.over) outcome = 'win';
    else outcome = 'stopped';
  }
  const snap = climbSnapshot(run, { outcome, checkpoints });
  snap.trace = trace;
  snap.classId = run.classId;
  snap.seed = run.seed;
  snap.growthRank = run.growthRank || null;
  return snap;
}

export function makeV2Run(opts = {}) {
  const classId = opts.classId || 'warrior';
  const raceId = opts.raceId || 'human';
  const seed = opts.seed ?? 44718291;
  const kitSeed = opts.kitSeed ?? seed;
  // Seeded chargen. Unseeded rollStart() would invalidate same-seed batches.
  const gen = opts.gen || awakenMonolith(rollStart(classId, raceId, seed), seed);
  return newRun(opts.meta || { upgrades: {}, achievements: [], endings: [], classFloor10: [] }, {
    classId,
    raceId,
    originId: opts.originId || null,
    name: opts.name || 'V2',
    seed,
    kitSeed,
    gen,
  });
}

async function main() {
  const args = process.argv.slice(2);
  const seed = Number(args.find(a => a.startsWith('--seed='))?.split('=')[1]) || 44718291;
  const policyName = args.find(a => a.startsWith('--policy='))?.split('=')[1] || 'baseline';
  const policy = policyName === 'scripted' ? scriptedPolicy([]) : baselinePolicy();
  const run = makeV2Run({ seed });
  const result = await simulateClimbV2(run, policy);
  console.log(JSON.stringify({
    outcome: result.outcome,
    deathFloor: result.deathFloor,
    floor: result.checkpoint.floor,
    rngState: result.checkpoint.rngState,
    hp: result.checkpoint.hp,
    gold: result.checkpoint.gold,
    level: result.checkpoint.level,
  }, null, 2));
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/run_climb_v2.js');
if (isMain) main();

export { baselinePolicy, scriptedPolicy };
