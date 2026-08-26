// Live event rolls, sparkle, and outcome mutations. One terminal advance
// (non-combat) or combat/mimic advance — never both.

import { CLASSES } from './data/classes.js';
import { SKILLS } from './data/skills.js';
import { CONSUMABLES, itemById, resolveItem, rollEquipment, rollRelic, rollUnique } from './data/items.js';
import { CONFIG } from './data/config.js';
import { applyTagOutcomeMods, applySparkleOutcomeMods } from './data/eventtags.js';
import { applyOutcomeWorld, applyWorldPatch } from './data/world.js';
import { applyRacePromotion } from './data/races.js';
import { LAST_FLOOR, BOSS_FLOORS } from './data/floorcards.js';
import {
  derived, heal, restoreMana, gainXp, relicItems, resourceName, appraiseRun,
  grantClassWeightedStats, pickClassWeightedStat, APPRAISABLE, changeFame,
} from './character.js';
import { biomeTier } from './biome_tier.js';
import { grantReward, grantWrldFind } from './rewards.js';
import { mimicSpec } from './data/enemies.js';
import { pickEventEnemyIds, specsFromEnemyIds, maybeEscortNpcDuel, buildEventFightEnemies } from './encounter.js';
import { earnGold, spendGold, applyGoldDelta } from './economy.js';
import { applyOfferingOutcome, defaultOfferingPick } from './offering.js';
import { grantCatalogItem, grantPackSkill, maybeCampfirePackFind, resolveCurseOnRun } from './content_pack/grants.js';
import { recipientRule } from './content_pack/acquisition.js';
import { packOnEventResolve } from './content_pack/world_bind.js';

const STAT_ROLL = { str: 'Strength', dex: 'Agility', int: 'Intellect', wis: 'Wisdom', lk: 'Luck' };

export function rollEventCheck(run, spec, rng) {
  const d = derived(run);
  let bonus = Math.floor(d.lk / 4);
  if (spec.bonusFlag && run.flags[spec.bonusFlag.flag]) bonus += spec.bonusFlag.bonus;
  if (spec.penaltyFlag && run.flags[spec.penaltyFlag.flag]) bonus -= spec.penaltyFlag.penalty;
  const die = rng.int(1, 8);
  const total = d[spec.stat] + die + bonus;
  const ok = total >= spec.dc;
  return { ok, die, total, bonus, line: {
    text: `${STAT_ROLL[spec.stat] || spec.stat} is tested… ${ok ? 'and holds. SUCCESS.' : 'and falters. FAILURE.'}`,
    cls: ok ? 'good' : 'bad',
  } };
}

export function resolveEventBranch(run, ev, choice, rng, { sparkle = false } = {}) {
  let outcome = applyTagOutcomeMods(choice.outcome, ev, run);
  if (sparkle) outcome = applySparkleOutcomeMods(outcome, { floor: run.floor, rng });
  let roll = null;
  if (outcome.roll) {
    roll = rollEventCheck(run, outcome.roll, rng);
    outcome = applyTagOutcomeMods(roll.ok ? outcome.success : outcome.fail, ev, run);
    if (sparkle) outcome = applySparkleOutcomeMods(outcome, { floor: run.floor, rng });
  }
  return { outcome, roll };
}

async function defaultOnItem(run, item, lines) {
  if (!item) return;
  if (item.slot) {
    run.inventory.push(item.id);
    if (item.instanceId && item.affixes) {
      if (!run.gearBag) run.gearBag = {};
      run.gearBag[item.id] = item;
    }
    lines.push({ text: `Found: ${item.name}`, cls: 'item' });
  } else {
    run.consumables.push(item.id);
    lines.push({ text: `Received: ${item.name}`, cls: 'item' });
  }
}

/**
 * Apply a resolved outcome. Terminal: one advance, unless combat/mimic
 * (those advance then return combat).
 */
export async function applyEventOutcome(run, ev, o, rng, hooks = {}) {
  const d = derived(run);
  const sparkle = !!(hooks.sparkle || run.eventSparkle);
  const lines = hooks.lines || [];
  const onItem = hooks.onItem || ((item, ls) => defaultOnItem(run, item, ls));
  const partySize = hooks.partySize || 1;
  const rewardHooks = {
    ...hooks,
    runRng: hooks.runRng,
    onItem,
    coop: hooks.coop || null,
  };

  if (o.randomOutcome) {
    o = rng.pick(o.randomOutcome);
    if (sparkle) o = applySparkleOutcomeMods(o, { floor: run.floor, rng });
    lines.push({ text: 'The tower decides…', cls: 'item' });
  }

  if (o.escape) {
    packOnEventResolve(run, ev, o, rng);
    return { kind: 'escape', lines };
  }

  if (sparkle) {
    lines.push({ text: '✦ The path shimmered — fortune leans your way.', cls: 'item' });
  }
  if (o.text) lines.push({ text: o.text, cls: '' });

  if (o.offering) {
    let spec = o.offering;
    if (!spec.picked) {
      const pick = hooks.chooseOffering
        ? hooks.chooseOffering(run, spec)
        : defaultOfferingPick(run, spec);
      spec = { ...spec, picked: pick || { kind: 'none' } };
    }
    const off = applyOfferingOutcome(run, spec, rng, lines, hooks);
    if (off.kiln) {
      if (off.kiln.fame) o.fame = (o.fame || 0) + off.kiln.fame;
      if (off.kiln.hpPct) o.hpPct = (o.hpPct || 0) + off.kiln.hpPct;
      if (off.kiln.statUpRandom) o.statUpRandom = (o.statUpRandom || 0) + off.kiln.statUpRandom;
      if (off.kiln.maxHp) o.maxHp = (o.maxHp || 0) + off.kiln.maxHp;
      if (off.kiln.upgradeWeapon) o.upgradeWeapon = true;
    }
  }

  if (o.chest) {
    let isMimic = false;
    if (!o.safeMimic && !relicItems(run).some(r => r.noMimic)) {
      isMimic = rng.chance(ev.mimicChance || 0.25);
    }
    if (isMimic) {
      rng.advance();
      packOnEventResolve(run, ev, o, rng);
      const mimic = mimicSpec(run.floor);
      const foes = buildEventFightEnemies(run, [mimic], { partySize: 1 });
      return {
        kind: 'combat',
        lines,
        combat: { specs: [mimic], text: 'The chest grows TEETH. Of course it does.', prebuilt: foes },
      };
    }
    const sparkleGold = sparkle ? (CONFIG.events.sparkle?.goldMult || 1.65) : 1;
    const gold = Math.round((30 + run.floor * 4 + rng.int(0, 25)) * d.goldMult * sparkleGold);
    earnGold(run, gold, 'chest');
    lines.push({ text: `The chest is honest for once. +${gold} gold`, cls: 'gold' });
    const chestFindChance = sparkle ? 0.55 : 0.35;
    if (rng.chance(chestFindChance)) {
      const luck = Math.floor(d.lk / 3) + (sparkle ? (o._sparkleLuck || 5) : 0);
      const item = rollEquipment(rng, biomeTier(run.biomeId), luck, {
        floor: run.floor, run,
        rarityBump: sparkle && !!o._sparkleRarityBump,
      });
      if (item) await onItem(item, lines);
    } else if (rng.chance(sparkle ? 0.45 : 0.3)) {
      const c = rng.pick(CONSUMABLES);
      run.consumables.push(c.id);
      lines.push({ text: `Tucked in the corner: ${c.name}.`, cls: 'item' });
    }
  }

  if (o.gold) {
    const amt = o.gold > 0 ? Math.round(o.gold * d.goldMult) : o.gold;
    applyGoldDelta(run, amt, { earnReason: 'event', spendReason: 'event' });
    lines.push({ text: `${amt > 0 ? '+' : ''}${amt} gold`, cls: 'gold' });
  }
  if (o.goldPct) {
    const amt = Math.round(run.gold * o.goldPct);
    applyGoldDelta(run, amt, { earnReason: 'event', spendReason: 'event' });
    lines.push({ text: `${amt} gold`, cls: amt >= 0 ? 'gold' : 'bad' });
  }
  if (o.hp) {
    if (o.hp > 0) heal(run, o.hp); else run.hp = Math.max(0, run.hp + o.hp);
    lines.push({ text: `${o.hp > 0 ? '+' : ''}${o.hp} HP`, cls: o.hp > 0 ? 'good' : 'bad' });
  }
  if (o.hpPct) {
    const amt = Math.round(run.maxHp * o.hpPct);
    if (amt > 0) heal(run, amt); else run.hp = Math.max(0, run.hp + amt);
    lines.push({ text: `${amt > 0 ? '+' : ''}${amt} HP`, cls: amt > 0 ? 'good' : 'bad' });
  }
  if (o.maxHp) {
    run.maxHp = Math.max(8, run.maxHp + o.maxHp);
    run.hp = Math.max(1, Math.min(run.maxHp, run.hp + o.maxHp));
    lines.push({
      text: o.maxHp > 0 ? 'You feel your endurance deepen.' : 'Something in you is slightly less infinite.',
      cls: o.maxHp > 0 ? 'good' : 'bad',
    });
  }
  if (o.fullHeal) {
    const miss = Math.max(0, run.maxHp - run.hp);
    const amt = heal(run, Math.round(miss * (CONFIG.recovery.eventFullHealMissingPct ?? 0.4)));
    lines.push({ text: amt ? `Wounds ease (+${amt} HP).` : 'You are already whole.', cls: 'good' });
  }
  if (o.mana) restoreMana(run, o.mana);
  if (o.manaPct) { restoreMana(run, run.maxMp * o.manaPct); lines.push({ text: `${resourceName(run)} restored.`, cls: 'good' }); }
  if (o.fullMana) { run.mp = run.maxMp; lines.push({ text: `${resourceName(run)} restored.`, cls: 'good' }); }
  if (o.fame) {
    const amt = changeFame(run, o.fame);
    lines.push({ text: `${amt > 0 ? '+' : ''}${amt} Fame`, cls: amt >= 0 ? 'good' : 'bad' });
  }
  if (o.statUp) {
    run.stats[o.statUp.stat] = Math.max(1, run.stats[o.statUp.stat] + o.statUp.amt);
    lines.push(o.statUp.amt > 0
      ? { text: 'Something in you grows stronger.', cls: 'good' }
      : { text: 'Something in you is... lessened. You can\'t name what.', cls: 'bad' });
  }
  if (o.statUpRandom) {
    grantClassWeightedStats(run, rng, o.statUpRandom, { biasChance: 0.7 });
    lines.push({ text: 'Power settles into you — you couldn\'t say where.', cls: 'good' });
  }
  if (o.statUpMain) {
    const main = CLASSES[run.classId].growthBias[0];
    run.stats[main] += o.statUpMain;
    lines.push({ text: 'You lean into what you already are — and it answers.', cls: 'good' });
  }
  if (o.statUpScaled) {
    const amt = o.statUpScaled + Math.floor(run.floor / 12);
    const stat = pickClassWeightedStat(run, rng, { biasChance: 0.85 });
    run.stats[stat] += amt;
    lines.push({ text: 'A surge of growth takes root — stronger for how far you\'ve climbed.', cls: 'good' });
  }
  const hadStatGrant = !!(o.statUp || o.statUpRandom || o.statUpMain || o.statUpScaled);
  if (!hadStatGrant && (o.fame || 0) > 0) {
    const n = (o.fame >= 5 || (o.fame >= 3 && run.floor <= 12)) ? 2 : 1;
    grantClassWeightedStats(run, rng, n, { biasChance: 0.75 });
    lines.push({
      text: n > 1
        ? 'Your name carries weight — and so do your limbs.'
        : 'Something in you grows stronger.',
      cls: 'good',
    });
  }

  if (o.appraisal) {
    const wasHidden = !run.growthRevealed;
    appraiseRun(rng, run, { partial: o.appraisal === 'partial', location: ev.title });
    hooks.unlock?.('assessed');
    lines.push({ text: '📜 The reading is complete. Your character page now carries the appraisal.', cls: 'item' });
    if (wasHidden && run.growthRevealed) {
      lines.push({ text: `✦ Growth potential revealed: ${run.growthRank}`, cls: 'good' });
    }
    const relicChance = (o.appraisal === 'full' ? 0.22 : 0.1) + Math.floor(run.floor / 15) * 0.05;
    if (rng.chance(relicChance)) {
      const r = rollRelic(rng, run.relics, Math.floor(d.lk / 3));
      if (r) { run.relics.push(r.id); lines.push({ text: `The reading stirs something loose in the tower — Relic: ${r.name} (${r.desc})`, cls: 'item' }); }
    }
  }
  if (o.fameReward) {
    const goldR = Math.round((30 + Math.floor(run.fame / 10) * 22) * d.goldMult);
    earnGold(run, goldR, 'event');
    const statR = 1 + Math.floor(run.fame / 40);
    for (let i = 0; i < statR; i++) run.stats[rng.pick(APPRAISABLE)]++;
    heal(run, run.maxHp * 0.2);
    lines.push({ text: `Your renown pays out — +${goldR} gold, real growth, and a patron's care. The tower rewards a known name.`, cls: 'gold' });
  }
  if (o.promoteRace) {
    const p = applyRacePromotion(run);
    if (p) {
      lines.push({ text: `🧬 ${p.blurb}\n\nYou are ${/^[aeiou]/i.test(run.raceName) ? 'an' : 'a'} ${run.raceName} now.`, cls: 'item' });
      hooks.unlock?.('promoted');
    }
  }

  if (o.itemRoll) {
    const spec = (o.itemRoll && typeof o.itemRoll === 'object') ? o.itemRoll : {};
    const preferUseful = !!(spec.requireUseful || spec.classGear);
    const item = rollEquipment(rng, Math.max(biomeTier(run.biomeId), spec.minTier || 1), Math.floor(d.lk / 3) + (spec.luck || 0), {
      floor: run.floor,
      run,
      classId: run.classId,
      usefulBias: preferUseful ? 8 : (spec.usefulBias ?? 4),
      requireUseful: preferUseful,
      slot: spec.slot || null,
      wtype: spec.wtype || null,
      rarityBump: !!(spec.rarityBump || (sparkle && o._sparkleRarityBump)),
    });
    if (item) await onItem(item, lines);
    else lines.push({ text: 'You rummage — and find only dust and almosts.', cls: 'bad' });
  }
  if (o.uniqueItem) {
    const u = rollUnique(rng, run, { preferUseful: true });
    if (u) await onItem(u, lines);
    else lines.push({ text: 'The UNIQUE you were promised has already chosen another climber.', cls: 'bad' });
  }
  if (o.wrldItem) {
    await grantWrldFind(run, lines, rewardHooks, typeof o.wrldItem === 'object' ? o.wrldItem : {});
  }
  if (o.classGear) {
    const wantWeapon = rng.chance(0.6);
    const luck = Math.floor(d.lk / 3) + 1 + (sparkle ? (o._sparkleLuck || 5) : 0);
    const item = rollEquipment(rng, Math.max(biomeTier(run.biomeId), 2), luck, {
      floor: run.floor, run, classId: run.classId,
      requireUseful: true, usefulBias: 10,
      slot: wantWeapon ? 'weapon' : (rng.chance(0.5) ? 'accessory' : null),
      rarityBump: sparkle && !!o._sparkleRarityBump,
      channel: 'class',
    }) || rollEquipment(rng, Math.max(biomeTier(run.biomeId), 2), luck, {
      floor: run.floor, run, classId: run.classId,
      requireUseful: true, usefulBias: 10,
      slot: wantWeapon ? 'weapon' : (rng.chance(0.5) ? 'accessory' : null),
      rarityBump: sparkle && !!o._sparkleRarityBump,
      channel: 'ordinary',
    });
    if (item) await onItem(item, lines);
  }
  if (o.item) {
    const item = resolveItem(run, o.item) || itemById(o.item);
    if (!item) lines.push({ text: 'The promised object is missing from this timeline.', cls: 'bad' });
    else await grantCatalogItem(run, item, lines, { onEquip: (it, ls) => onItem(it, ls), coop: hooks.coop || null });
  }
  if (o.relicRoll) {
    const r = rollRelic(rng, run.relics, Math.floor(d.lk / 3) + (sparkle ? (o._sparkleLuck || 5) : 0));
    if (r) { run.relics.push(r.id); lines.push({ text: `Relic: ${r.name} — ${r.desc}`, cls: 'item' }); }
  }
  if (o.consumable) {
    const it = itemById(o.consumable);
    if (it) await grantCatalogItem(run, it, lines, { onEquip: (item, ls) => onItem(item, ls), coop: hooks.coop });
    else {
      run.consumables.push(o.consumable);
      lines.push({ text: `Received: ${o.consumable}`, cls: 'item' });
    }
  }
  if (o.consumable2) {
    const it2 = itemById(o.consumable2);
    if (it2) await grantCatalogItem(run, it2, lines, { onEquip: (item, ls) => onItem(item, ls), coop: hooks.coop });
    else {
      run.consumables.push(o.consumable2);
      lines.push({ text: `Received: ${o.consumable2}`, cls: 'item' });
    }
  }
  if (o.skill) grantPackSkill(run, o.skill, lines);
  if (o.art) grantPackSkill(run, o.art, lines);
  if (o.resolveCurse) {
    for (const ref of [].concat(o.resolveCurse)) resolveCurseOnRun(run, ref, lines);
  }
  if (o.useItem) {
    const i = run.consumables.indexOf(o.useItem);
    if (i > -1) run.consumables.splice(i, 1);
  }
  if (o.learnAoe) {
    const aoeId = CLASSES[run.classId].aoeSkill;
    if (aoeId && !run.knownSkills.includes(aoeId)) {
      lines.push({ text: `The technique takes root: ${SKILLS[aoeId].name}.`, cls: 'item' });
      await hooks.onLearnSkill?.(SKILLS[aoeId], lines);
    } else {
      lines.push({ text: 'The lesson sharpens what you already know.', cls: 'good' });
      run.xp += 20;
    }
  }
  if (o.upgradeWeapon) {
    const bonus = o.upgradeScaled ? 4 + Math.floor(run.floor / 8) : 4;
    run.weaponBonus += bonus;
    lines.push({ text: `Your weapon sings a new, sharper note. (+${bonus} damage, permanent)`, cls: 'item' });
  }

  applyOutcomeWorld(run, o);
  if (o.sigil && !run.sigils.includes(o.sigil)) {
    run.sigils.push(o.sigil);
    lines.push({ text: `✦ Sigil acquired (${run.sigils.length}/3). Something in the tower shifts.`, cls: 'item' });
  }
  hooks.announceCallings?.();
  if (o.revealFloors) {
    const upcoming = [];
    for (let f = run.floor + 1; f <= Math.min(run.floor + o.revealFloors, LAST_FLOOR); f++) {
      upcoming.push(`F${f}: ${f === LAST_FLOOR ? 'THE THRONE' : BOSS_FLOORS.includes(f) ? 'BOSS' : f % 5 === 0 ? 'Trial' : 'Unknown cards'}`);
    }
    lines.push({ text: `The map shows: ${upcoming.join(' · ')}`, cls: 'item' });
  }
  if (o.setFuture) {
    const chosen = hooks.chooseFuture ? await hooks.chooseFuture() : null;
    if (chosen) {
      run.forcedNextCategory = chosen;
      lines.push({ text: `Waypoint marked — the next branching floor will offer a ${chosen} path.`, cls: 'item' });
    }
  }

  let ups = [];
  if (o.xp) {
    const amt = Math.round(o.xp * d.xpMult);
    ups = gainXp(run, amt, rng);
    lines.push({ text: `+${amt} XP`, cls: 'good' });
  }
  if (o.xpScaled) {
    const amt = Math.round((o.xpScaled + run.floor) * d.xpMult);
    ups.push(...gainXp(run, amt, rng));
    lines.push({ text: `+${amt} XP`, cls: 'good' });
  }

  if (o.reward) {
    const rewardUps = (await grantReward(run, o.reward, lines, rewardHooks)) || [];
    ups.push(...rewardUps);
  }

  if (o.enchantedFood) {
    const [lo, hi] = Array.isArray(o.enchantedFood) ? o.enchantedFood : [1, 3];
    const n = rng.int(lo, hi);
    const foods = CONSUMABLES.filter(c => c.foodBuff);
    for (let i = 0; i < n; i++) {
      const c = rng.pick(foods);
      run.consumables.push(c.id);
      lines.push({ text: `Received: ${c.name}`, cls: 'item' });
    }
  }

  if (o.combat) {
    run.lastOwnership = recipientRule(o, ev);
    return finalizeCombat(run, ev, o, rng, lines, ups, partySize, { alreadyAdvanced: false });
  }

  return finishOutcome(run, ev, o, lines, ups, { alreadyAdvanced: false, rng });
}

function finishOutcome(run, ev, o, lines, ups, { alreadyAdvanced, rng }) {
  packOnEventResolve(run, ev, o, rng);
  run.lastOwnership = recipientRule(o, ev);
  if (ev?.id === 'campfire' || ev?.type === 'rest') {
    maybeCampfirePackFind(run, rng, lines);
  }
  if (!alreadyAdvanced && rng) rng.advance();
  if (run.hp <= 0) return { kind: 'dead', lines, ups };
  return { kind: 'done', lines, ups, coopTrade: !!o.coopTrade, originIntro: false };
}

function finalizeCombat(run, ev, o, rng, lines, ups, partySize, { alreadyAdvanced }) {
  let enemyIds = o.combat.enemies || [];
  if (o.combat.pickEnemies) {
    enemyIds = pickEventEnemyIds(rng, o.combat.pickEnemies, partySize);
  }
  let specs = specsFromEnemyIds(run, enemyIds);
  specs = maybeEscortNpcDuel(run, specs, partySize);
  const fightReward = o.combat.reward || o.combat.xp ? { ...(o.combat.reward || {}) } : null;
  if (fightReward && o.combat.xp) fightReward.xp = (fightReward.xp || 0) + o.combat.xp;
  if (!alreadyAdvanced) rng.advance();
  packOnEventResolve(run, ev, o, rng);
  const foes = buildEventFightEnemies(run, specs, { partySize: 1 });
  return {
    kind: 'combat',
    lines,
    ups,
    combat: { specs, text: o.combat.text, reward: fightReward, prebuilt: foes },
  };
}

export { applyWorldPatch };
