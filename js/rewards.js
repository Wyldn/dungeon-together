// Live combat payout, victory aftermath, grantReward, boss hoard.
// Callers own UI. Do not invent extra loot (no grantCombatLoot).

import { SKILLS } from './data/skills.js';
import {
  CONSUMABLES, itemById, resolveItem, rollEquipment, rollRelic, rollUnique, rollWrld,
  npcDuelLoot, markWrldClaimed, sellGold,
} from './data/items.js';
import { CONFIG } from './data/config.js';
import { rewardMult } from './data/tdc.js';
import {
  derived, gainXp, heal, relicItems, changeFame, applySkillBreakpoints,
} from './character.js';
import { runRng } from './state.js';
import { biomeTier } from './biome_tier.js';
import { earnGold, spendGold } from './economy.js';

export function computeCombatPayout(run, rng, enemies, mod = {}) {
  const d = derived(run);
  let gold = 0, xp = 0;
  for (const e of enemies) {
    gold += rng.int(e.gold[0], e.gold[1]);
    xp += e.xp;
  }
  const rw = rewardMult(run.floor);
  gold = Math.round(gold * d.goldMult * d.combatGoldMult * (mod.goldMult || 1) * CONFIG.economy.combatGoldMult * rw.gold);
  xp = Math.round(xp * 1.45 * d.xpMult * rw.xp);
  return { gold, xp };
}

export function applyItemAct(run, item, act, slot = null) {
  if (!item) return { act: 'none' };
  if (act === 'equip' && slot) {
    const oldId = run.equipment[slot];
    if (oldId) run.inventory.push(oldId);
    run.equipment[slot] = item.id;
    if (item.instanceId && item.affixes) {
      if (!run.gearBag) run.gearBag = {};
      run.gearBag[item.id] = item;
    }
    return { act: 'equip', slot };
  }
  if (act === 'stash') {
    run.inventory.push(item.id);
    return { act: 'stash' };
  }
  if (act === 'sell') {
    const sellPrice = sellGold(item);
    earnGold(run, sellPrice, 'sell');
    if (run.gearBag && item.instanceId) delete run.gearBag[item.id];
    return { act: 'sell', gold: sellPrice };
  }
  return { act: 'none' };
}

async function applyRewardOption(run, opt, lines, hooks) {
  if (!opt) return;
  const itemId = opt.kind === 'item' ? opt.id : opt.item;
  const skillId = opt.kind === 'skill' ? opt.id : opt.skill;
  const relicId = opt.kind === 'relic' ? opt.id : opt.relic;
  if (itemId) {
    const it = itemById(itemId);
    if (it && it.slot) await hooks.onItem?.(it, lines);
    else if (it) {
      run.consumables.push(it.id);
      lines.push({ text: `Received: ${it.name}`, cls: 'item' });
    }
  }
  if (skillId && SKILLS[skillId]) {
    if (!run.knownSkills.includes(skillId)) run.knownSkills.push(skillId);
    lines.push({ text: `Technique learned: ${SKILLS[skillId].name} — ${SKILLS[skillId].desc}`, cls: 'item' });
    await hooks.onLearnSkill?.(SKILLS[skillId], lines);
  }
  if (relicId) {
    const r = itemById(relicId) || rollRelic(hooks.rng, run.relics);
    if (r && !run.relics.includes(r.id)) {
      run.relics.push(r.id);
      lines.push({ text: `Relic: ${r.name}`, cls: 'item' });
    }
  }
}

export async function grantWrldFind(run, lines, hooks, { kind = 'any', preferUseful = true } = {}) {
  const rng = hooks.runRng ? hooks.runRng(run) : runRng(run);
  const w = rollWrld(rng, run, { preferUseful, kind, coop: hooks.coop || null });
  if (!w) {
    lines.push({ text: 'The WRLD you sought has already been claimed — one of each exists in this climb.', cls: 'bad' });
    return null;
  }
  hooks.unlock?.('wrld_gear');
  hooks.unlock?.('legendary');
  if (!w.slot) {
    if (!run.relics.includes(w.id)) run.relics.push(w.id);
    lines.push({ text: `WRLD Relic: ${w.name} — ${w.desc}`, cls: 'item' });
    return w;
  }
  await hooks.onItem?.(w, lines);
  return w;
}

/** Live grantReward. Advances runRng once at the end. */
export async function grantReward(run, reward, lines, hooks = {}) {
  if (!reward) return [];
  const rng = hooks.rng || (hooks.runRng ? hooks.runRng(run) : runRng(run));
  const h = { ...hooks, rng };
  if (reward.gold) {
    earnGold(run, reward.gold, 'reward');
    lines.push({ text: `+${reward.gold} gold`, cls: 'gold' });
  }
  if (reward.fame) {
    const a = changeFame(run, reward.fame);
    lines.push({ text: `+${a} Fame`, cls: 'good' });
  }
  let ups = [];
  if (reward.xp) {
    ups = gainXp(run, reward.xp, rng);
    lines.push({ text: `+${reward.xp} XP`, cls: 'good' });
  }
  if (reward.uniqueItem) {
    const u = rollUnique(rng, run, { preferUseful: true });
    if (u) await h.onItem?.(u, lines);
    else lines.push({ text: 'The UNIQUE prize has already been claimed by another climber.', cls: 'bad' });
  }
  if (reward.wrldItem) {
    await grantWrldFind(run, lines, h, typeof reward.wrldItem === 'object' ? reward.wrldItem : {});
  }
  if (reward.guaranteed?.length) {
    const total = reward.guaranteed.reduce((s, g) => s + (g.weight || 1), 0);
    let roll = rng.next() * total;
    let pick = reward.guaranteed[0];
    for (const g of reward.guaranteed) {
      roll -= (g.weight || 1);
      if (roll <= 0) { pick = g; break; }
    }
    await applyRewardOption(run, pick, lines, h);
    if (pick.kind === 'item' && itemById(pick.id)?.rarity === 'unique') h.unlock?.('unique_gear');
    if (pick.kind === 'item' && ['legendary', 'unique', 'wrld'].includes(itemById(pick.id)?.rarity)) h.unlock?.('legendary');
  }
  if (reward.bonusChance && reward.bonus?.length && rng.chance(reward.bonusChance)) {
    const bonus = rng.pick(reward.bonus);
    if (bonus.kind === 'relic') {
      const r = rollRelic(rng, run.relics);
      if (r) { run.relics.push(r.id); lines.push({ text: `Bonus relic: ${r.name}`, cls: 'item' }); }
    } else {
      lines.push({ text: 'Something extra loosens from the fight…', cls: 'item' });
      await applyRewardOption(run, bonus, lines, h);
    }
  }
  if (reward.farmerLoot) {
    const gold = rng.int(3, 12);
    earnGold(run, gold, 'farmer');
    lines.push({ text: `A few coins from the trough: +${gold} gold`, cls: 'gold' });
    const plain = ['farm_bread', 'farm_cheese', 'farm_stew'];
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const id = rng.pick(plain);
      run.consumables.push(id);
      lines.push({ text: `Received: ${itemById(id).name}`, cls: 'item' });
    }
    if (rng.chance(0.4)) {
      const loot = rng.pick(['farmer_hat', 'farmer_tunic', 'farmer_pants', 'farmer_sickle', 'farmer_pitchfork', 'farmer_rake', 'harvest_swing']);
      if (SKILLS[loot]) await applyRewardOption(run, { kind: 'skill', id: loot }, lines, h);
      else await applyRewardOption(run, { kind: 'item', id: loot }, lines, h);
    }
  }
  if (reward.npcDuelLoot) {
    const classes = Array.isArray(reward.npcDuelLoot)
      ? reward.npcDuelLoot
      : (reward.npcDuelLoot.classes || []);
    const item = npcDuelLoot(rng, run, {
      classes,
      coop: h.coop || null,
      floor: run.floor,
    });
    if (item) {
      lines.push({ text: 'A climber\'s spoils — hard-won.', cls: 'item' });
      await h.onItem?.(item, lines);
      if (item.rarity === 'unique') h.unlock?.('unique_gear');
      if (['legendary', 'unique', 'wrld'].includes(item.rarity)) h.unlock?.('legendary');
    } else {
      lines.push({ text: 'Their pack is empty — the tower already claimed the prize.', cls: 'bad' });
    }
  }
  if (reward.options?.length) {
    const paySkills = !!h.paySkills;
    const skillCost = op => {
      if (!paySkills || (op.kind !== 'skill' && !op.skill)) return 0;
      const sk = SKILLS[op.kind === 'skill' ? op.id : op.skill];
      return sk ? (CONFIG.skillReward?.costByTier?.[sk.tier || 1] ?? 0) : 0;
    };
    let chosen = reward.options[0];
    if (h.chooseOption) {
      chosen = await h.chooseOption(reward.options, { skillCost }) || chosen;
    }
    const fee = Math.min(skillCost(chosen), run.gold);
    if (fee > 0) {
      spendGold(run, fee, 'skill');
      lines.push({ text: `Technique learning fee: -${fee} gold`, cls: 'bad' });
    }
    await applyRewardOption(run, chosen, lines, h);
  } else if (!reward.guaranteed && !reward.farmerLoot && !reward.npcDuelLoot) {
    await applyRewardOption(run, reward, lines, h);
  }
  rng.advance();
  return ups;
}

const NPC_DUEL_IDS = new Set([
  'crimson_stranger', 'frost_revenant',
]);

export function applyVictoryRewards(run, enemies, gold, xp, {
  boss = null,
  reward = null,
  hooks = {},
} = {}) {
  run.kills += enemies.length;
  earnGold(run, gold, 'combat');
  hooks.unlock?.('first_blood');
  if (run.gold >= 500) hooks.unlock?.('rich');
  if (enemies.some(e => e.id === 'mimic')) {
    hooks.unlock?.('mimic');
    if (run.hp / run.maxHp < 0.3) hooks.unlock?.('mimic_survivor');
  }
  if (enemies.some(e => NPC_DUEL_IDS.has(e.id) || hooks.npcDuels?.has?.(e.id))) {
    hooks.unlock?.('npc_duelist');
  }

  const lines = [{ text: `Victory! +${gold} gold, +${xp} XP`, cls: 'gold' }];
  const vh = CONFIG.recovery.victoryHealPct
    ? heal(run, run.maxHp * CONFIG.recovery.victoryHealPct)
    : 0;
  if (vh > 0) lines.push({ text: `You bind your wounds in the quiet after. (+${vh} HP)`, cls: 'good' });
  const victoryHeal = relicItems(run).find(r => r.victoryHeal);
  if (victoryHeal) {
    const amt = heal(run, run.maxHp * victoryHeal.victoryHeal);
    if (amt) lines.push({ text: `${victoryHeal.name} hums — you recover ${amt} HP.`, cls: 'good' });
  }
  const fameRelic = relicItems(run).find(r => r.fameOnVictory);
  if (fameRelic) {
    changeFame(run, fameRelic.fameOnVictory);
    lines.push({ text: 'Your lantern carries the tale. (+Fame)', cls: 'good' });
  }

  let elitePending = null;
  if (boss) {
    hooks.noteBossCleared?.(run.floor, boss.name);
    heal(run, run.maxHp * CONFIG.recovery.bossVictoryHealPct);
    run.mp = run.maxMp;
    changeFame(run, 6);
    lines.push({ text: 'The gate\'s blessing washes over you — wounds knit, strength returns, and the tower learns your name. (+Fame)', cls: 'good' });
    for (const msg of applySkillBreakpoints(run)) lines.push({ text: msg.text, cls: msg.cls || 'good' });
  } else if (enemies.some(e => e.elite)) {
    elitePending = true;
  }

  return { lines, elitePending, reward, xp, boss };
}

/** Elite UNIQUE roll after victory. Uses a fresh runRng; advances once. */
export async function applyEliteVictoryFind(run, lines, hooks = {}) {
  const rngE = hooks.runRng ? hooks.runRng(run) : runRng(run);
  const eliteChance = Math.min(0.06, 0.01 + Math.max(0, run.floor - 15) * 0.0015);
  if (rngE.chance(eliteChance)) {
    const u = rollUnique(rngE, run, { preferUseful: true });
    if (u) {
      lines.push({ text: 'Among the elite\'s effects, something older than the tower gleams.', cls: 'item' });
      await hooks.onItem?.(u, lines);
    }
  }
  rngE.advance();
}

export async function rollBossHoard(run, hooks = {}) {
  const rng2 = hooks.runRng ? hooks.runRng(run) : runRng(run);
  const choices = [rollRelic(rng2, run.relics), rollRelic(rng2, run.relics), rollRelic(rng2, run.relics)]
    .filter((r, i, a) => r && a.findIndex(x => x && x.id === r.id) === i);
  rng2.advance();
  if (choices.length) {
    const pick = hooks.chooseRelic
      ? await hooks.chooseRelic(choices)
      : choices[0];
    if (pick && !run.relics.includes(pick.id)) run.relics.push(pick.id);
  }
  const rng3 = hooks.runRng ? hooks.runRng(run) : runRng(run);
  const d = derived(run);
  const wrldChance = run.floor >= 40
    ? Math.min(0.06, 0.015 + (run.floor - 40) * 0.002 + d.lk * 0.0005)
    : 0;
  const uniqueChance = Math.min(0.14, 0.04 + run.floor * 0.0015 + d.lk * 0.001);
  const lines = [];
  if (wrldChance && rng3.chance(wrldChance)) {
    await grantWrldFind(run, lines, hooks, { preferUseful: true });
    rng3.advance();
  } else if (rng3.chance(uniqueChance)) {
    const u = rollUnique(rng3, run, { preferUseful: true });
    if (u) {
      await hooks.onItem?.(u, lines);
      rng3.advance();
    }
  } else {
    const item = rollEquipment(rng3, biomeTier(run.biomeId) + 1, 4 + Math.floor(d.lk / 2), { floor: run.floor, run });
    rng3.advance();
    if (item) await hooks.onItem?.(item, lines);
  }
  return lines;
}
