// Headless run state for Monte Carlo climbs — real newRun / loot / event rewards
// + merchant stock/auto-buy. No DOM or co-op UI. Used by tools/run_sim.js.

import { CONFIG } from '../js/data/config.js';
import { CLASSES, RANDOM_NAMES } from '../js/data/classes.js';
import { applyRacePromotion } from '../js/data/races.js';
import { ORIGINS } from '../js/data/origins.js';
import { SKILLS } from '../js/data/skills.js';
import {
  CONSUMABLES, itemById, resolveItem, rollEquipment, rollRelic, rollUnique, rollWrld,
  itemUsefulForClass, itemIncompatibleForClass,
} from '../js/data/items.js';
import { drawEvent } from '../js/data/events.js';
import { applyTagOutcomeMods } from '../js/data/eventtags.js';
import { biomeForFloor, ENEMIES, findEnemySpec, mimicSpec } from '../js/data/enemies.js';
import { rewardMult } from '../js/data/tdc.js';
import {
  derived, heal, restoreMana, gainXp, changeFame, grantClassWeightedStats,
  pickClassWeightedStat, applySubclass, APPRAISABLE, allowedWeaponTypes, relicItems,
} from '../js/character.js';
import {
  newRun, randomClassId, randomRaceId, rollStart,
} from '../js/state.js';
import { makeRng } from '../js/rng.js';

function skillAutoScore(sk) {
  if (!sk) return -1;
  return (sk.tier || 1) * 12 + (sk.power || 0) * 0.55 + (sk.charge ? 6 : 0)
    + (sk.healPct || 0) * 45 + (sk.target === 'all' ? 8 : 0);
}

/** Re-export shared mimic template (js/data/enemies.js). */
export { mimicSpec };

/**
 * Resolve event `combat` block → full enemy specs (findEnemySpec / pickEnemies)
 * plus a fightReward bag, matching game.js applyOutcome.
 */
export function resolveEventCombatPack(run, combat, rng, { partySize = 1 } = {}) {
  if (!combat) return null;
  const biome = biomeForFloor(run.floor);
  const fallback = ENEMIES[biome.id]?.[0] || { id: 'wolf', name: 'Wolf', hp: 28, atk: 6, def: 1, spd: 8, gold: [6, 14], xp: 10 };
  let enemyIds = [...(combat.enemies || [])];
  if (combat.pickEnemies) {
    const pe = combat.pickEnemies;
    const [cLo, cHi] = pe.count || [1, 1];
    let n = rng.int(cLo, cHi);
    if (pe.partyExtra) n += Math.max(0, (partySize - 1) * (pe.partyExtra || 0));
    enemyIds = [];
    for (let i = 0; i < n; i++) enemyIds.push(rng.pick(pe.pool));
  }
  if (!enemyIds.length) return null;
  const combatSpecs = enemyIds.map(id => {
    const spec = findEnemySpec(id) || fallback;
    return { ...spec };
  });
  let fightReward = null;
  if (combat.reward || combat.xp) {
    fightReward = { ...(combat.reward || {}) };
    if (combat.xp) fightReward.xp = (fightReward.xp || 0) + combat.xp;
  }
  return { combatSpecs, fightReward };
}

const blankMeta = () => ({
  shards: 0, totalRuns: 0, wins: 0, bestFloor: 0,
  upgrades: {}, achievements: [], endings: [], classFloor10: [],
  seenIntro: false, gateSeen: 0, equippedTitle: null, equippedNameStyle: null,
});

export function biomeTierFor(run) {
  return { forest: 1, ruins: 2, frost: 3, swamp: 4, hell: 5, throne: 5 }[run.biomeId] || 1;
}

/** Fresh solo climber with real chargen (no sanctum upgrades). */
export function createSimRun(rng, { classId = null, raceId = null } = {}) {
  const meta = blankMeta();
  const cls = classId || randomClassId(meta, rng);
  const race = raceId || randomRaceId(rng);
  const origin = rng.pick(ORIGINS)?.id || null;
  const gen = rollStart(cls, race, rng.int(1, 1e9));
  const run = newRun(meta, {
    classId: cls,
    raceId: race,
    originId: origin,
    name: rng.pick(RANDOM_NAMES) || 'Sim',
    seed: rng.int(1, 1e9),
    gen,
  });
  run.floor = 1;
  run.biomeId = biomeForFloor(1).id;
  return run;
}

/* ---------------- gear score + auto-equip (mirrors game auto-play) ---------------- */

export function gearScore(item) {
  if (!item) return -1;
  const rarity = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, unique: 6, wrld: 7 };
  let s = (rarity[item.rarity] || 1) * 25 + (item.tier || 1) * 4;
  const weights = {
    atk: 3, def: 2.5, hp: 0.15, mp: 0.12, str: 2, dex: 2, int: 2, wis: 2,
    crit: 0.8, initiative: 2, dodge: 0.5,
  };
  for (const [k, w] of Object.entries(weights)) {
    if (typeof item[k] === 'number') s += item[k] * w;
  }
  for (const k of ['burn', 'freeze', 'poison', 'lifesteal', 'weaken', 'frail', 'tormented']) {
    if (typeof item[k] === 'number') s += item[k] * 30;
  }
  if (item.price) s += item.price * 0.01;
  return s;
}

function weaponFitsClass(run, item) {
  if (!item || item.slot !== 'weapon' || !item.wtype) return true;
  return allowedWeaponTypes(run).includes(item.wtype);
}

function accessorySlots() {
  return ['accessory1', 'accessory2', 'accessory3'];
}

function equipInto(run, item, slot) {
  const oldId = run.equipment[slot];
  if (oldId) run.inventory.push(oldId);
  run.equipment[slot] = item.id;
  if (item.instanceId && item.affixes) {
    if (!run.gearBag) run.gearBag = {};
    run.gearBag[item.id] = item;
  }
}

/** Equip upgrades; sell junk / incompatible weapons. Returns { act, slot? }. */
export function autoEquipItem(run, item) {
  if (!item) return { act: 'none' };
  const sellPrice = Math.round((item.price || 20) * 0.6);
  const sellIt = () => {
    run.gold += sellPrice;
    run.goldEarned = (run.goldEarned || 0) + sellPrice;
    if (run.gearBag && item.instanceId) delete run.gearBag[item.id];
    return { act: 'sell' };
  };

  if (item.slot === 'weapon' && !weaponFitsClass(run, item)) return sellIt();

  if (item.slot === 'accessory') {
    const slots = accessorySlots();
    const free = slots.find(s => !run.equipment[s]);
    if (free) {
      equipInto(run, item, free);
      return { act: 'equip', slot: free };
    }
    let worstSlot = slots[0];
    let worst = Infinity;
    for (const s of slots) {
      const cur = run.equipment[s] ? resolveItem(run, run.equipment[s]) : null;
      const sc = gearScore(cur);
      if (sc < worst) { worst = sc; worstSlot = s; }
    }
    if (gearScore(item) > worst) {
      equipInto(run, item, worstSlot);
      return { act: 'equip', slot: worstSlot };
    }
    return sellIt();
  }

  if (!item.slot) {
    run.inventory.push(item.id);
    return { act: 'stash' };
  }

  const cur = run.equipment[item.slot] ? resolveItem(run, run.equipment[item.slot]) : null;
  if (!cur || gearScore(item) >= gearScore(cur) - 0.5) {
    equipInto(run, item, item.slot);
    return { act: 'equip', slot: item.slot };
  }
  return sellIt();
}

function learnSkillAuto(run, skillId) {
  if (!skillId || !SKILLS[skillId]) return;
  if (!run.knownSkills.includes(skillId)) run.knownSkills.push(skillId);
  if (run.skills.includes(skillId)) return;
  const cap = 4; // base capacity; breakpoints ignored in sim for speed
  if (run.skills.length < cap) {
    run.skills.push(skillId);
    return;
  }
  // Replace weakest by power
  let worstI = 0;
  let worst = Infinity;
  run.skills.forEach((id, i) => {
    const sc = SKILLS[id]?.power || 0;
    if (sc < worst) { worst = sc; worstI = i; }
  });
  if ((SKILLS[skillId].power || 0) > worst) run.skills[worstI] = skillId;
}

/** Apply level-up side effects (subclass picks) for sim. */
export function resolveLevelUps(run, ups, rng) {
  for (const up of ups || []) {
    if (up.evolutionChoice?.length && !run.subclassId) {
      const sub = rng.pick(up.evolutionChoice);
      applySubclass(run, sub);
      if (sub.skill) learnSkillAuto(run, sub.skill);
    }
    if (up.deeper) {
      applySubclass(run, up.deeper);
      if (up.deeper.skill) learnSkillAuto(run, up.deeper.skill);
    }
  }
}

/* ---------------- event choice scoring (auto-play style) ---------------- */

function looksEmpty(t) {
  return /leave empty-handed|empty-handed|walk away|ignore it|refuse|safe\b|pass by|do nothing|nothing here|kindness|honor\b|leave it for the next|leave a note/.test(t);
}

function looksRewarding(t) {
  // Match js/autoplay.js — fight options count as rewarding.
  return /fight|face|battle|xp|gold|loot|gear|weapon|armor|relic|technique|skill|blessing|recover|heal|potion|claim|train|scavenge|class |accessory|trinket|charm|stat|fame|growth|boon|supplies|mend|equip|accept the trial|stand together|steel yourself/.test(t);
}

function scoreChoiceText(label, hint) {
  const t = `${label || ''} ${hint || ''}`.toLowerCase();
  let s = 10;
  if (looksEmpty(t)) s -= 9;
  if (looksRewarding(t)) s += 6;
  if (/sneak|bribe|meditate|pray|offer|bet |knock|listen|commission/.test(t)) s += 2;
  return s;
}

export function reqMetHeadless(run, req) {
  if (!req) return { ok: true };
  const d = derived(run);
  if (req.stat && d[req.stat] < req.min) return { ok: false };
  if (req.class && run.classId !== req.class) return { ok: false };
  if (req.gold && run.gold < req.gold) return { ok: false };
  if (req.fame && run.fame < req.fame) return { ok: false };
  if (req.flag && !run.flags?.[req.flag]) return { ok: false };
  if (req.notFlag && run.flags?.[req.notFlag]) return { ok: false };
  if (req.item && !run.consumables.includes(req.item)) return { ok: false };
  return { ok: true };
}

export function pickEventChoice(run, ev, rng) {
  // Same scoring as js/autoplay.js pickSmart — fight options are allowed.
  const choices = (ev.choices || []).filter(c => reqMetHeadless(run, c.req).ok);
  if (!choices.length) return null;
  const scored = choices.map(c => ({ c, s: scoreChoiceText(c.label, c.hint) }));
  const best = Math.max(...scored.map(x => x.s));
  let top = scored.filter(x => x.s >= best - 2);
  if (best < 8) {
    const rewarding = scored.filter(x => x.s >= 12 || looksRewarding(`${x.c.label} ${x.c.hint || ''}`));
    if (rewarding.length) top = rewarding;
    else {
      const nonEmpty = scored.filter(x => !looksEmpty(`${x.c.label} ${x.c.hint || ''}`));
      if (nonEmpty.length) top = nonEmpty;
    }
  }
  return rng.pick(top).c;
}

/* ---------------- headless outcome apply ---------------- */

/**
 * Apply a post-victory combat.reward bag (headless grantReward subset).
 */
export function applyCombatRewardHeadless(run, reward, rng, { paySkills = true } = {}) {
  if (!reward) return;
  if (reward.gold) { run.gold += reward.gold; run.goldEarned += reward.gold; }
  if (reward.fame) changeFame(run, reward.fame);
  if (reward.xp) {
    resolveLevelUps(run, gainXp(run, Math.round(reward.xp * (derived(run).xpMult || 1)), rng), rng);
  }
  if (reward.uniqueItem) {
    const u = rollUnique(rng, run, { preferUseful: true });
    if (u) autoEquipItem(run, u);
  }
  if (reward.wrldItem) {
    const w = rollWrld(rng, run, {
      preferUseful: true,
      claim: true,
      ...(typeof reward.wrldItem === 'object' ? reward.wrldItem : {}),
    });
    if (w) {
      if (w.slot) autoEquipItem(run, w);
      else if (!run.relics.includes(w.id)) run.relics.push(w.id);
    }
  }

  const applyOpt = (opt) => {
    if (!opt) return;
    const itemId = opt.kind === 'item' ? opt.id : opt.item;
    const skillId = opt.kind === 'skill' ? opt.id : opt.skill;
    const relicId = opt.kind === 'relic' ? opt.id : opt.relic;
    if (itemId) {
      const it = itemById(itemId);
      if (it?.slot) autoEquipItem(run, it);
      else if (it) run.consumables.push(it.id);
    }
    if (skillId) learnSkillAuto(run, skillId);
    if (relicId) {
      const r = itemById(relicId) || rollRelic(rng, run.relics);
      if (r && !run.relics.includes(r.id)) run.relics.push(r.id);
    }
  };

  if (reward.guaranteed?.length) {
    const total = reward.guaranteed.reduce((s, g) => s + (g.weight || 1), 0);
    let roll = rng.next() * total;
    let pick = reward.guaranteed[0];
    for (const g of reward.guaranteed) {
      roll -= (g.weight || 1);
      if (roll <= 0) { pick = g; break; }
    }
    applyOpt(pick);
  }
  if (reward.bonusChance && reward.bonus?.length && rng.chance(reward.bonusChance)) {
    const bonus = rng.pick(reward.bonus);
    if (bonus.kind === 'relic') {
      const r = rollRelic(rng, run.relics);
      if (r) run.relics.push(r.id);
    } else {
      applyOpt(bonus);
    }
  }
  if (reward.farmerLoot) {
    const gold = rng.int(3, 12);
    run.gold += gold;
    run.goldEarned += gold;
    const plain = ['farm_bread', 'farm_cheese', 'farm_stew'];
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) run.consumables.push(rng.pick(plain));
    if (rng.chance(0.4)) {
      const loot = rng.pick(['farmer_hat', 'farmer_tunic', 'farmer_pants', 'farmer_sickle', 'farmer_pitchfork', 'farmer_rake', 'harvest_swing']);
      if (SKILLS[loot]) applyOpt({ kind: 'skill', id: loot });
      else applyOpt({ kind: 'item', id: loot });
    }
  }
  if (reward.options?.length) {
    const skillCost = (op) => {
      if (!paySkills || (op.kind !== 'skill' && !op.skill)) return 0;
      const sk = SKILLS[op.kind === 'skill' ? op.id : op.skill];
      return sk ? (CONFIG.skillReward?.costByTier?.[sk.tier || 1] ?? 0) : 0;
    };
    const affordable = reward.options.filter(op => skillCost(op) <= run.gold);
    const pool = affordable.length ? affordable : reward.options;
    const chosen = pool.reduce((best, op) => {
      const score = op.kind === 'skill' || op.skill
        ? skillAutoScore(SKILLS[op.kind === 'skill' ? op.id : op.skill])
        : gearScore(itemById(op.id));
      const bestScore = best.kind === 'skill' || best.skill
        ? skillAutoScore(SKILLS[best.kind === 'skill' ? best.id : best.skill])
        : gearScore(itemById(best.id));
      return score > bestScore ? op : best;
    }, pool[0]);
    const fee = Math.min(skillCost(chosen), run.gold);
    if (fee > 0) run.gold -= fee;
    applyOpt(chosen);
  } else if (!reward.guaranteed && !reward.farmerLoot) {
    applyOpt(reward);
  }
}

/**
 * Apply reward fields from an event outcome. Skips shops/UI.
 * Returns { combatSpecs?, fightReward? } when a fight should run next.
 */
export function applyOutcomeHeadless(run, outcome, rng, ev = null, { partySize = 1 } = {}) {
  let o = outcome ? { ...outcome } : {};
  if (ev) o = applyTagOutcomeMods(o, ev, run) || o;

  if (o.randomOutcome) o = { ...rng.pick(o.randomOutcome) };
  if (o.escape) { run._simEscaped = true; return {}; }

  // Resolve rolls / success-fail trees
  if (o.roll) {
    const d = derived(run);
    const spec = o.roll;
    const stat = spec.stat || 'lk';
    const roll = rng.int(1, 20) + Math.floor((d[stat] || 0) * 0.5);
    const ok = roll >= (spec.dc || 10);
    o = applyTagOutcomeMods(ok ? (outcome.success || {}) : (outcome.fail || {}), ev, run) || {};
    if (o.randomOutcome) o = { ...rng.pick(o.randomOutcome) };
  }

  const d = derived(run);
  let combatSpecs = null;
  let fightReward = null;

  if (o.combat) {
    const pack = resolveEventCombatPack(run, o.combat, rng, { partySize });
    if (pack) {
      combatSpecs = pack.combatSpecs;
      fightReward = pack.fightReward;
    }
  }

  if (o.chest) {
    const isMimic = !o.safeMimic && !relicItems(run).some(r => r.noMimic) && rng.chance(ev?.mimicChance || 0.25);
    if (isMimic) {
      combatSpecs = [mimicSpec(run.floor)];
    } else {
      const gold = Math.round((30 + run.floor * 4 + rng.int(0, 25)) * d.goldMult);
      run.gold += gold;
      run.goldEarned += gold;
      if (rng.chance(0.35)) {
        const item = rollEquipment(rng, biomeTierFor(run), Math.floor(d.lk / 3), {
          floor: run.floor, run, classId: run.classId,
        });
        if (item) autoEquipItem(run, item);
      } else if (rng.chance(0.3)) {
        const c = rng.pick(CONSUMABLES);
        if (c) run.consumables.push(c.id);
      }
    }
  }

  if (o.gold) {
    const amt = o.gold > 0 ? Math.round(o.gold * d.goldMult) : o.gold;
    run.gold = Math.max(0, run.gold + amt);
    if (amt > 0) run.goldEarned += amt;
  }
  if (o.goldPct) {
    const amt = Math.round(run.gold * o.goldPct);
    run.gold = Math.max(0, run.gold + amt);
  }
  if (o.hp) {
    if (o.hp > 0) heal(run, o.hp);
    else run.hp = Math.max(0, run.hp + o.hp);
  }
  if (o.hpPct) {
    const amt = Math.round(run.maxHp * o.hpPct);
    if (amt > 0) heal(run, amt);
    else run.hp = Math.max(0, run.hp + amt);
  }
  if (o.maxHp) { run.maxHp += o.maxHp; run.hp += o.maxHp; }
  if (o.fullHeal) {
    const miss = Math.max(0, run.maxHp - run.hp);
    heal(run, Math.round(miss * (CONFIG.recovery.eventFullHealMissingPct ?? 0.4)));
  }
  if (o.mana) restoreMana(run, o.mana);
  if (o.manaPct) restoreMana(run, run.maxMp * o.manaPct);
  if (o.fullMana) run.mp = run.maxMp;
  if (o.fame) changeFame(run, o.fame);

  if (o.statUp) {
    run.stats[o.statUp.stat] = Math.max(1, (run.stats[o.statUp.stat] || 0) + o.statUp.amt);
  }
  if (o.statUpRandom) grantClassWeightedStats(run, rng, o.statUpRandom, { biasChance: 0.7 });
  if (o.statUpMain) {
    const main = CLASSES[run.classId].growthBias[0];
    run.stats[main] += o.statUpMain;
  }
  if (o.statUpScaled) {
    const amt = o.statUpScaled + Math.floor(run.floor / 12);
    const stat = pickClassWeightedStat(run, rng, { biasChance: 0.85 });
    run.stats[stat] += amt;
  }
  const hadStatGrant = !!(o.statUp || o.statUpRandom || o.statUpMain || o.statUpScaled);
  if (!hadStatGrant && (o.fame || 0) > 0) {
    const n = (o.fame >= 5 || (o.fame >= 3 && run.floor <= 12)) ? 2 : 1;
    grantClassWeightedStats(run, rng, n, { biasChance: 0.75 });
  }

  if (o.appraisal) {
    const relicChance = (o.appraisal === 'full' ? 0.22 : 0.1) + Math.floor(run.floor / 15) * 0.05;
    if (rng.chance(relicChance)) {
      const r = rollRelic(rng, run.relics, Math.floor(d.lk / 3));
      if (r) run.relics.push(r.id);
    }
  }
  if (o.fameReward) {
    const goldR = Math.round((30 + Math.floor(run.fame / 10) * 22) * d.goldMult);
    run.gold += goldR;
    run.goldEarned += goldR;
    const statR = 1 + Math.floor(run.fame / 40);
    for (let i = 0; i < statR; i++) run.stats[rng.pick(APPRAISABLE)]++;
    heal(run, run.maxHp * 0.2);
  }
  if (o.promoteRace) applyRacePromotion(run);

  if (o.itemRoll) {
    const spec = (o.itemRoll && typeof o.itemRoll === 'object') ? o.itemRoll : {};
    const preferUseful = !!(spec.requireUseful || spec.classGear);
    const item = rollEquipment(rng, Math.max(biomeTierFor(run), spec.minTier || 1), Math.floor(d.lk / 3) + (spec.luck || 0), {
      floor: run.floor, run, classId: run.classId,
      usefulBias: preferUseful ? 8 : (spec.usefulBias ?? 4),
      requireUseful: preferUseful,
      slot: spec.slot || null,
      wtype: spec.wtype || null,
    });
    if (item) autoEquipItem(run, item);
  }
  if (o.uniqueItem) {
    const u = rollUnique(rng, run, { preferUseful: true });
    if (u) autoEquipItem(run, u);
  }
  if (o.wrldItem) {
    const w = rollWrld(rng, run, { preferUseful: true, claim: true });
    if (w) autoEquipItem(run, w);
  }
  if (o.classGear) {
    const wantWeapon = rng.chance(0.6);
    const item = rollEquipment(rng, Math.max(biomeTierFor(run), 2), Math.floor(d.lk / 3) + 1, {
      floor: run.floor, run, classId: run.classId,
      requireUseful: true, usefulBias: 10,
      slot: wantWeapon ? 'weapon' : (rng.chance(0.5) ? 'accessory' : null),
    });
    if (item) autoEquipItem(run, item);
  }
  if (o.item) {
    const item = resolveItem(run, o.item) || itemById(o.item);
    if (item?.slot) autoEquipItem(run, item);
    else if (item) run.consumables.push(item.id);
  }
  if (o.relicRoll) {
    const r = rollRelic(rng, run.relics, Math.floor(d.lk / 3));
    if (r) run.relics.push(r.id);
  }
  if (o.consumable) run.consumables.push(o.consumable);
  if (o.consumable2) run.consumables.push(o.consumable2);
  if (o.useItem) {
    const i = run.consumables.indexOf(o.useItem);
    if (i > -1) run.consumables.splice(i, 1);
  }
  if (o.learnAoe) {
    const aoeId = CLASSES[run.classId].aoeSkill;
    if (aoeId && !run.knownSkills.includes(aoeId)) learnSkillAuto(run, aoeId);
    else run.xp += 20;
  }
  if (o.upgradeWeapon) {
    run.weaponBonus += o.upgradeScaled ? 4 + Math.floor(run.floor / 8) : 4;
  }
  if (o.flag) { if (!run.flags) run.flags = {}; run.flags[o.flag] = true; }
  if (o.clearFlag) delete run.flags?.[o.clearFlag];
  if (o.sigil && !run.sigils.includes(o.sigil)) run.sigils.push(o.sigil);
  if (o.setFuture) {
    const cats = ['recovery', 'merchant', 'equipment', 'training', 'appraisal', 'mystery'];
    run.forcedNextCategory = rng.pick(cats);
  }

  if (o.enchantedFood) {
    const [lo, hi] = Array.isArray(o.enchantedFood) ? o.enchantedFood : [1, 3];
    const n = rng.int(lo, hi);
    const foods = CONSUMABLES.filter(c => c.foodBuff);
    for (let i = 0; i < n; i++) {
      if (foods.length) run.consumables.push(rng.pick(foods).id);
    }
  }

  if (o.xp) {
    const amt = Math.round(o.xp * d.xpMult);
    resolveLevelUps(run, gainXp(run, amt, rng), rng);
  }
  if (o.xpScaled) {
    const amt = Math.round((o.xpScaled + run.floor) * d.xpMult);
    resolveLevelUps(run, gainXp(run, amt, rng), rng);
  }

  // Nested reward bags (simplified): gold/xp/item only
  if (o.reward) {
    const rw = o.reward;
    if (rw.gold) { run.gold += rw.gold; run.goldEarned += rw.gold; }
    if (rw.xp) resolveLevelUps(run, gainXp(run, Math.round(rw.xp * d.xpMult), rng), rng);
    if (rw.item) {
      const it = itemById(rw.item);
      if (it?.slot) autoEquipItem(run, it);
      else if (it) run.consumables.push(it.id);
    }
  }

  if (combatSpecs?.length) return { combatSpecs, fightReward };
  return {};
}

/** Draw + resolve one real event for this climber. */
export function resolveSimEvent(run, rng, { partySize = 1 } = {}) {
  const ev = drawEvent(rng, run);
  if (!ev) return {};
  run.seenEvents.push(ev.id);
  if (!run.recentCategories) run.recentCategories = [];
  run.recentCategories.push(ev.category || 'unknown');
  if (run.recentCategories.length > 8) run.recentCategories.shift();

  // Shop / pure merchant — real stock + auto-buy (mirrors shopScreen).
  if (ev.shop && !(ev.choices || []).length) {
    resolveSimMerchant(run, rng);
    return {};
  }

  const choice = pickEventChoice(run, ev, rng);
  if (!choice) return {};
  return applyOutcomeHeadless(run, choice.outcome, rng, ev, { partySize });
}

/**
 * Headless merchant: build stock like game.js shopScreen, then auto-buy
 * upgrades / potions / heal with fame discount.
 */
export function resolveSimMerchant(run, rng) {
  const tier = biomeTierFor(run);
  const stock = [];
  const cons = rng.shuffle(CONSUMABLES.filter(c => !c.appraisal)).slice(0, 3);
  for (const c of cons) stock.push({ kind: 'consumable', item: c, price: c.price });
  if (rng.chance(0.4)) {
    const appr = CONSUMABLES.find(c => c.appraisal);
    if (appr) stock.push({ kind: 'consumable', item: appr, price: 90 });
  }

  const earlyOrMid = run.floor < 35;
  for (let i = 0; i < 2; i++) {
    const item = rollEquipment(rng, tier, 2, {
      floor: run.floor, run, classId: run.classId, usefulBias: 4,
      requireUseful: earlyOrMid && i === 0,
    });
    if (item) stock.push({ kind: 'equip', item, price: item.price });
  }
  if (earlyOrMid) {
    const hasUseful = stock.some(s => s.kind === 'equip' && itemUsefulForClass(s.item, run.classId));
    if (!hasUseful) {
      const forced = rollEquipment(rng, Math.max(tier, 2), 3, {
        floor: run.floor, run, classId: run.classId, requireUseful: true, usefulBias: 8,
      });
      if (forced) {
        const idx = stock.findIndex(s => s.kind === 'equip');
        if (idx >= 0) stock[idx] = { kind: 'equip', item: forced, price: forced.price };
        else stock.push({ kind: 'equip', item: forced, price: forced.price });
      }
    }
  }
  if (run.floor >= 18 && rng.chance(0.035 + Math.min(0.04, run.floor * 0.0008))) {
    const u = rollUnique(rng, run, { preferUseful: true });
    if (u) stock.push({ kind: 'equip', item: u, price: Math.round(u.price * 1.15) });
  }
  if (run.floor >= 35 && rng.chance(0.01 + Math.min(0.015, (run.floor - 35) * 0.0005))) {
    const w = rollWrld(rng, run, { preferUseful: true, kind: 'equip', claim: true });
    if (w) stock.push({ kind: 'equip', item: w, price: Math.round(w.price * 1.25) });
  }
  if (rng.chance(0.5)) {
    const r = rollRelic(rng, run.relics);
    if (r) stock.push({ kind: 'relic', item: r, price: 120 + tier * 40 });
  }

  const discount = run.fame >= CONFIG.fame.shopDiscountAt ? CONFIG.fame.shopDiscountPct : 0;
  const priceOf = (p) => Math.round(p * (CONFIG.economy.merchantPriceMult || 1) * (1 - discount));

  const isUpgrade = (item) => {
    if (!item?.slot) return false;
    if (itemIncompatibleForClass(item, run.classId)) return false;
    if (item.slot === 'accessory') {
      const slots = accessorySlots();
      if (slots.some(s => !run.equipment[s])) return true;
      const worst = Math.min(...slots.map(s => {
        const cur = run.equipment[s] ? resolveItem(run, run.equipment[s]) : null;
        return gearScore(cur);
      }));
      return gearScore(item) > worst;
    }
    const cur = run.equipment[item.slot] ? resolveItem(run, run.equipment[item.slot]) : null;
    return !cur || gearScore(item) >= gearScore(cur) - 0.5;
  };

  // Buy gear upgrades (best delta first), then potions if low, then heal, then relic.
  let bought = true;
  while (bought) {
    bought = false;
    const equips = stock
      .map((s, i) => ({ s, i, p: priceOf(s.price) }))
      .filter(({ s, p }) => s.kind === 'equip' && run.gold >= p && isUpgrade(s.item))
      .sort((a, b) => (gearScore(b.s.item) - gearScore(a.s.item)));
    if (equips.length) {
      const { s, i, p } = equips[0];
      run.gold -= p;
      autoEquipItem(run, s.item);
      stock.splice(i, 1);
      bought = true;
      continue;
    }

    const potions = (run.consumables || []).filter(id => {
      const c = CONSUMABLES.find(x => x.id === id);
      return c && (c.heal || c.healPct);
    }).length;
    if (potions < 2 && run.hp / run.maxHp < 0.75) {
      const pot = stock
        .map((s, i) => ({ s, i, p: priceOf(s.price) }))
        .find(({ s, p }) => s.kind === 'consumable' && (s.item.heal || s.item.healPct) && run.gold >= p);
      if (pot) {
        run.gold -= pot.p;
        run.consumables.push(pot.s.item.id);
        stock.splice(pot.i, 1);
        bought = true;
        continue;
      }
    }

    if (run.hp / run.maxHp < 0.6) {
      const healCost = Math.max(10, Math.round((run.maxHp - run.hp) * 0.8
        * (CONFIG.economy.merchantPriceMult || 1) * (1 - discount)));
      if (run.gold >= healCost && run.hp < run.maxHp) {
        run.gold -= healCost;
        run.hp = run.maxHp;
        // one heal purchase per visit
        break;
      }
    }

    const relic = stock
      .map((s, i) => ({ s, i, p: priceOf(s.price) }))
      .find(({ s, p }) => s.kind === 'relic' && run.gold >= p && !run.relics.includes(s.item.id));
    if (relic && run.gold >= relic.p + 40) {
      run.gold -= relic.p;
      run.relics.push(relic.s.item.id);
      stock.splice(relic.i, 1);
      bought = true;
    }
  }
}

/* ---------------- combat bridge ---------------- */

export function climberFromRun(run) {
  const d = derived(run);
  const bias = CLASSES[run.classId]?.growthBias?.[0] || 'str';
  const skills = [
    { id: 'basic_attack', power: 100, cost: 0, charge: 0, target: 'one' },
    ...(run.skills || []).map(id => {
      const sk = SKILLS[id];
      if (!sk || sk.allyTarget || sk.id === 'guard' || sk.id === 'basic_attack') return null;
      // Pure self-heals for auto-play mend; hybrid skills (power + healPct) stay offensive.
      const isHeal = !!sk.healPct && (sk.target === 'self' || !sk.power);
      return {
        id: sk.id,
        power: isHeal ? 0 : (sk.power || 0),
        cost: sk.cost || 0,
        charge: sk.charge || 0,
        healPct: isHeal ? sk.healPct : 0,
        target: isHeal ? 'self' : (sk.target || 'one'),
      };
    }).filter(Boolean),
  ];
  const potions = (run.consumables || []).filter(id => {
    const c = CONSUMABLES.find(x => x.id === id);
    return c && (c.heal || c.healPct);
  }).length;

  return {
    level: run.level,
    stats: { ...run.stats },
    atk: d.atk,
    def: d.def,
    hp: run.hp,
    maxHp: run.maxHp,
    mp: run.mp,
    maxMp: run.maxMp,
    dmgMult: d.dmgMult,
    dmgTakenMult: d.dmgTakenMult,
    crit: d.crit,
    dodge: d.dodge,
    classBias: bias,
    skills,
    potions,
    manaRegen: d.manaRegen,
    _run: run,
  };
}

/** Write fight results + potion spend back onto the real run. */
export function applyFightToRun(run, climber, fightResult, { won, xp = 0, gold = 0, boss = false } = {}) {
  run.hp = Math.max(0, climber.hp);
  run.mp = Math.max(0, Math.min(run.maxMp, climber.mp ?? run.mp));

  // Sync potion count: remove heal consumables until count matches
  let have = (run.consumables || []).filter(id => {
    const c = CONSUMABLES.find(x => x.id === id);
    return c && (c.heal || c.healPct);
  }).length;
  const want = climber.potions || 0;
  while (have > want) {
    const idx = run.consumables.findIndex(id => {
      const c = CONSUMABLES.find(x => x.id === id);
      return c && (c.heal || c.healPct);
    });
    if (idx < 0) break;
    run.consumables.splice(idx, 1);
    have--;
  }

  if (!won) {
    if (run.hp <= 0) run.down = true;
    return;
  }

  run.down = false;
  run.kills = (run.kills || 0) + 1;
  run.gold += gold;
  run.goldEarned += gold;
  heal(run, run.maxHp * CONFIG.recovery.victoryHealPct);
  const victoryHeal = relicItems(run).find(r => r.victoryHeal);
  if (victoryHeal) heal(run, run.maxHp * victoryHeal.victoryHeal);
  if (boss) {
    heal(run, run.maxHp * CONFIG.recovery.bossVictoryHealPct);
    run.mp = run.maxMp;
    changeFame(run, 6);
  }
  if (xp > 0) {
    const rng = makeRng(run.seed ^ (run.floor * 9973) ^ (run.xp || 0));
    resolveLevelUps(run, gainXp(run, xp, rng), rng);
  }
}

/** Combat loot after a win (equipment / boss relic / unique chance). */
export function grantCombatLoot(run, rng, { boss = false, elite = false } = {}) {
  const d = derived(run);
  const tier = biomeTierFor(run) + (boss ? 1 : 0);
  const luck = Math.floor(d.lk / 3) + (boss ? 2 : 0);

  if (boss) {
    const relic = rollRelic(rng, run.relics, luck);
    if (relic) run.relics.push(relic.id);
    const item = rollEquipment(rng, tier, luck + 2, {
      floor: run.floor, run, classId: run.classId, usefulBias: 4,
    });
    if (item) autoEquipItem(run, item);
    const uniqueChance = Math.min(0.14, 0.04 + run.floor * 0.0015 + d.lk * 0.001);
    if (rng.chance(uniqueChance)) {
      const u = rollUnique(rng, run, { preferUseful: true });
      if (u) autoEquipItem(run, u);
    }
    return;
  }

  if (rng.chance(0.55)) {
    const item = rollEquipment(rng, tier, luck, {
      floor: run.floor, run, classId: run.classId, usefulBias: 3.5,
    });
    if (item) autoEquipItem(run, item);
  } else if (rng.chance(0.35)) {
    const c = rng.pick(CONSUMABLES.filter(x => !x.appraisal));
    if (c) run.consumables.push(c.id);
  }

  if (elite) {
    const eliteChance = Math.min(0.06, 0.01 + Math.max(0, run.floor - 15) * 0.0015);
    if (rng.chance(eliteChance)) {
      const u = rollUnique(rng, run, { preferUseful: true });
      if (u) autoEquipItem(run, u);
    }
  }
}

export function estimateCombatRewards(specs, floor, rng, { boss = false } = {}) {
  let gold = 0;
  let xp = 0;
  for (const e of specs) {
    gold += rng.int(e.gold?.[0] ?? 0, e.gold?.[1] ?? 0);
    xp += e.xp || 0;
  }
  const rw = rewardMult(floor);
  gold = Math.round(gold * CONFIG.economy.combatGoldMult * rw.gold);
  xp = Math.round(xp * (boss ? 1.45 : 1.45) * rw.xp);
  return { gold, xp };
}

export { blankMeta };
