#!/usr/bin/env node
// Simulation V2 — faithful solo climb. Does not call grantCombatLoot, combat_sim, or run_sim.

import { newRun, runRng, loadMeta } from '../js/state.js';
import { EVENTS } from '../js/data/events.js';
import { presentEvent, recordEvent } from '../js/data/world.js';
import { classifyFloor, dealLiveFloorCards, LAST_FLOOR } from '../js/data/floorcards.js';
import { biomeForFloor, ENEMIES, MODIFIERS, pickBossForFloor } from '../js/data/enemies.js';
import { planBossEncounter, pushEventHistory } from '../js/data/balance.js';
import { gainXp } from '../js/character.js';
import { reqMet } from '../js/requirements.js';
import { resolveEventBranch, applyEventOutcome } from '../js/outcomes.js';
import {
  applyVictoryRewards, applyEliteVictoryFind,
  grantReward, rollBossHoard, applyItemAct,
} from '../js/rewards.js';
import { buildShopStock, shopDiscount, applyShopBuy, applyShopHeal, applyShopLeave } from '../js/shop.js';
import {
  planEncounterGroup, encounterOptions, resolveEncounterApproach,
} from '../js/encounter.js';
import { applyLevelProgression } from '../js/progression.js';
import { beginThrone, resolveThroneChoice, throneEndingId } from '../js/throne.js';
import { enterNextFloor } from '../js/floor.js';
import { climbCheckpoint, climbSnapshot } from '../js/climb_snapshot.js';
import { buildEnemy } from '../js/combat_core.js';
import { runHeadlessFight } from './combat_headless.js';
import { baselinePolicy } from './policies/baseline.js';
import { scriptedPolicy } from './policies/scripted.js';

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
  return specs.map(s => buildEnemy(s, run.floor, biome.floors[0], { hpMult }));
}

async function doFight(run, policy, enemies, { modifier = null, boss = null, reward = null } = {}) {
  policy.beginFight?.();
  const rng = runRng(run);
  const result = await runHeadlessFight({
    run, rng, enemies, modifier,
    policy: (f) => policy.chooseCombatAction(f),
    faithful: true,
  });
  if (result.result === 'dead' || run.hp <= 0) {
    return { outcome: 'dead' };
  }
  if (result.result !== 'win') return { outcome: result.result || 'ok' };
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
  return { outcome: 'cleared', gold, xp, lines };
}

async function resolveEvent(run, ev, policy) {
  const presented = presentEvent(ev, run);
  run.seenEvents.push(presented.id);
  recordEvent(run, presented);
  if (presented.shop) return resolveShop(run, presented, policy);

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
  if (result.kind === 'escape') return { outcome: 'escape' };
  if (result.kind === 'dead') return { outcome: 'dead' };
  if (result.kind === 'combat') {
    const fight = await doFight(run, policy, result.combat.prebuilt, {
      reward: result.combat.reward,
    });
    return fight;
  }
  return { outcome: 'ok', lines: result.lines };
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
  return { outcome: 'ok' };
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
  if (resolved.kind === 'bribe') return { outcome: 'ok', lines: resolved.lines };
  if (resolved.kind === 'sneak') {
    await applyUps(run, resolved.ups, policy);
    return { outcome: 'ok' };
  }
  const enemies = buildTrash(run, resolved.group, resolved.hpMult || planHp);
  return doFight(run, policy, enemies, {
    modifier: resolved.modifier || null,
  });
}

async function resolveTravelCard(run, card, policy) {
  if (card.kind === 'encounter') {
    pushEventHistory(run, 'combat');
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
  const mod = rng.pick(MODIFIERS);
  const biome = biomeForFloor(run.floor);
  const { pickEnemyPlan } = await import('../js/data/floorcards.js');
  const plan = pickEnemyPlan(rng, run, biome, 1);
  rng.advance();
  pushEventHistory(run, 'combat');
  const enemies = buildTrash(run, plan.specs, plan.hpMult);
  return doFight(run, policy, enemies, {
    modifier: { ...mod, goldMult: (mod.goldMult || 1) * 1.5 },
  });
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
  const enemies = plan.specs.map(s => buildEnemy(s, run.floor, biome.floors[0], {
    boss: !!s.boss || s.id === boss.id,
    hpMult: plan.hpMult,
  }));
  return doFight(run, policy, enemies, { boss });
}

async function resolveThroneFloor(run, policy) {
  const rngPick = runRng(run);
  const throne = beginThrone(run, rngPick);
  const choice = policy.chooseThrone(run, throne);
  const resolved = resolveThroneChoice(run, choice, throne.boss);
  if (resolved.kind === 'ending') {
    run.over = true;
    return { outcome: resolved.ending };
  }
  const enemies = [buildEnemy(resolved.spec, run.floor, run.floor, { boss: true, hpMult: resolved.hpMult })];
  const fight = await doFight(run, policy, enemies, { boss: resolved.spec });
  if (fight.outcome === 'dead') return fight;
  run.over = true;
  return { outcome: throneEndingId(choice, 'win') };
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

  let outcome = null;
  while (!run.over && run.hp > 0 && run.floor < maxFloors) {
    enterNextFloor(run);
    const kind = classifyFloor(run.floor);
    mark(`enter_${run.floor}_${kind}`);

    let step;
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
        return climbSnapshot(run, { outcome: 'deal', checkpoints: [...checkpoints, { ...climbCheckpoint(run), cards }] });
      }
      const card = policy.chooseFloorCard(run, cards);
      step = await resolveTravelCard(run, card, policy);
    }
    mark(`after_${run.floor}`);
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
  return climbSnapshot(run, { outcome, checkpoints });
}

export function makeV2Run(opts = {}) {
  const meta = opts.meta || { upgrades: {}, achievements: [], endings: [], classFloor10: [] };
  const run = newRun(meta, {
    classId: opts.classId || 'warrior',
    raceId: opts.raceId || 'human',
    originId: opts.originId || null,
    name: opts.name || 'V2',
    seed: opts.seed ?? 44718291,
    kitSeed: opts.kitSeed ?? opts.seed ?? 44718291,
    gen: opts.gen || null,
  });
  return run;
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
