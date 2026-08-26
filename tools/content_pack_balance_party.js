// Authoritative party-scaling measurements and focused 2/3/4-player
// combat + economy scenarios. Not a full multiplayer climb harness.

import { makeRng } from '../js/rng.js';
import { ENEMIES, BOSSES } from '../js/data/enemies.js';
import {
  partyHpMult, partyBossAtkMult, partyBossHpMult, partyTrashAtkMult,
  partyBossAoeMult, partyOutgoingDmgMult, eventFightHpMult, eventFightAtkMult,
  rewardMult,
} from '../js/data/tdc.js';
import { planEncounter, planBossEncounter, encounterBudget } from '../js/data/balance.js';
import { buildEnemy, createCombatContext } from '../js/combat_core.js';
import { runHeadlessFight } from './combat_headless.js';
import { makeV2Run } from './run_climb_v2.js';
import { armPack } from './content_pack_balance_lib.js';
import { GATE } from '../js/content_pack/flags.js';
import { chooseAutoPlayAction } from '../js/combat_policy.js';
import { shopPrice, buildShopStock, shopDiscount } from '../js/shop.js';
import { computeCombatPayout } from '../js/rewards.js';
import { partyMissingCount } from '../js/content_pack/engine.js';

export const MP_CLIMB_HARNESS = false;

function wolf(floor, partySize) {
  const spec = ENEMIES.forest.find(e => e.id === 'wolf') || ENEMIES.forest[0];
  return buildEnemy(spec, floor, 1, { partySize, spawnIndex: 0 });
}

async function focusedFight(partySize, floor, packOn) {
  armPack(packOn, GATE.MULTIPLAYER);
  const run = makeV2Run({ seed: 1000 + partySize * 17 + floor, classId: 'warrior', raceId: 'human' });
  run.floor = floor;
  const rng = makeRng(2000 + partySize * 31 + floor);
  const plan = planEncounter(rng, {
    floor, biomeStart: 1, pool: ENEMIES.forest, partySize,
  });
  const enemies = plan.specs.map((s, i) => buildEnemy(s, floor, 1, {
    hpMult: plan.hpMult, partySize, spawnIndex: i,
  }));
  const ctx = createCombatContext(run, rng, enemies);
  ctx.partySize = () => partySize;
  const snap = await runHeadlessFight({
    run, rng, enemies, faithful: true, policy: chooseAutoPlayAction,
  });
  const payout = computeCombatPayout(run, makeRng(9), enemies, {});
  return {
    partySize, floor, packOn,
    bodies: enemies.length,
    hpMult: plan.hpMult,
    enemyHp: enemies.reduce((s, e) => s + e.maxHp, 0),
    enemyAtk: enemies.reduce((s, e) => s + e.atk, 0),
    outcome: snap.result || snap.outcome,
    rounds: snap.round || 0,
    damageTaken: snap.measure?.damageTaken || snap.damageTaken || 0,
    damageDealt: snap.measure?.damageDealt || 0,
    gold: payout.gold,
    xp: payout.xp,
    missing: partyMissingCount(ctx, Array.from({ length: partySize }, (_, i) => ({ hp: i === 0 ? 0 : 10, down: i === 0 }))),
  };
}

async function focusedBoss(partySize, floor, packOn) {
  armPack(packOn, GATE.MULTIPLAYER);
  const run = makeV2Run({ seed: 4000 + partySize * 19 + floor, classId: 'warrior', raceId: 'human' });
  run.floor = floor;
  const rng = makeRng(5000 + partySize * 23 + floor);
  const boss = BOSSES[floor] || Object.values(BOSSES)[0];
  const plan = planBossEncounter(rng, {
    floor, boss, pool: ENEMIES.forest, partySize,
  });
  const enemies = plan.specs.map((s, i) => buildEnemy(s, floor, 1, {
    boss: !!s.boss || s.id === boss.id,
    hpMult: plan.hpMult,
    partySize,
    spawnIndex: i,
  }));
  const snap = await runHeadlessFight({
    run, rng, enemies, faithful: true, policy: chooseAutoPlayAction,
  });
  return {
    partySize, floor, packOn, bossId: boss.id,
    bodies: enemies.length,
    bossHp: enemies.find(e => e.boss)?.maxHp || enemies[0]?.maxHp,
    outcome: snap.result || snap.outcome,
    rounds: snap.round || 0,
    damageTaken: snap.measure?.damageTaken || snap.damageTaken || 0,
  };
}

function economyAt(partySize, floor, packOn) {
  armPack(packOn, GATE.MULTIPLAYER);
  const run = makeV2Run({ seed: 9000 + partySize * 13 + floor, classId: 'warrior', raceId: 'human' });
  run.floor = floor;
  run.gold = 80 + partySize * 20;
  const rng = makeRng(9100 + partySize * 11 + floor);
  const stock = buildShopStock(run, rng);
  const { discount } = shopDiscount(run);
  const prices = stock.map(s => ({
    kind: s.kind, id: s.item?.id, rarity: s.item?.rarity, price: shopPrice(s.price, discount),
  }));
  const rw = rewardMult(floor);
  return {
    partySize, floor, packOn,
    gold: run.gold,
    listings: prices.length,
    unaffordable: prices.filter(p => p.price > run.gold).length,
    meanPrice: prices.length ? prices.reduce((s, p) => s + p.price, 0) / prices.length : 0,
    rewardGoldMult: rw.gold,
    note: 'Shop stock and rewardMult are per-climber / per-floor, not per-party-size. Party size changes encounter budgets, not merchant price tables.',
  };
}

export async function runPartyMeasurements() {
  const scaling = [1, 2, 3, 4].map(n => ({
    partySize: n,
    partyHpMult: partyHpMult(n),
    bossAtkF10: partyBossAtkMult(n, 10),
    bossAtkF40: partyBossAtkMult(n, 40),
    bossHpF10: partyBossHpMult(n, 10),
    bossHpF40: partyBossHpMult(n, 40),
    trashAtkF10: partyTrashAtkMult(n, 10),
    aoe: partyBossAoeMult(n),
    outgoing: partyOutgoingDmgMult(n),
    eventHp: eventFightHpMult(n),
    eventAtk: eventFightAtkMult(n),
    budgetF10: encounterBudget(10, n),
    wolfF10: (() => {
      const e = wolf(10, n);
      return { hp: e.maxHp, atk: e.atk };
    })(),
  }));

  const plans = [1, 2, 3, 4].map(n => {
    const p = planEncounter(makeRng(99), { floor: 5, biomeStart: 1, pool: ENEMIES.forest, partySize: n });
    return { partySize: n, bodies: p.specs.length, hpMult: p.hpMult, ids: p.specs.map(s => s.id) };
  });

  const combat = [];
  const bosses = [];
  const shops = [];
  for (const packOn of [false, true]) {
    for (const n of [2, 3, 4]) {
      combat.push(await focusedFight(n, 6, packOn));
      combat.push(await focusedFight(n, 20, packOn));
      bosses.push(await focusedBoss(n, 10, packOn));
      shops.push(economyAt(n, 12, packOn));
    }
  }

  return {
    harness: {
      fullMultiplayerClimb: MP_CLIMB_HARNESS,
      note: 'Climb V2 is solo. These scenarios use live combat_core + planEncounter/planBossEncounter partySize and TDC pads. They are not 51-floor co-op climbs.',
    },
    scaling,
    encounterPlans: plans,
    focusedCombat: combat,
    focusedBosses: bosses,
    focusedEconomy: shops,
  };
}
