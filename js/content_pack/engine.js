// Shared declarative effect dispatcher. Combat, items, skills, events,
// headless sim, and multiplayer all call into this. Pack-off is a no-op
// and must not consume RNG.

import { derived, equippedItems, relicItems, heal, restoreMana, changeFame } from '../character.js';
import { spendGold, earnGold } from '../economy.js';
import { CONFIG } from '../data/config.js';
import { isPackOn, capabilityEnabled } from './flags.js';
import { LIMITS, SAFE_ARCHETYPES, HOOKS } from './schema.js';
import { packGet, packSet, packAdd, cleanupAfterAction, cleanupAfterTurn, cleanupAfterCombat } from './state.js';
import { mutexBlocked } from './mutex.js';
import { packSkillById, packLookup } from './registry.js';

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function instId(src) {
  return src.instanceId || src.id || 'unknown';
}

export function setPiecesWorn(run, setId) {
  if (!setId) return 0;
  return equippedItems(run).filter(it => it.setId === setId).length;
}

function resonanceActive(run, item) {
  if (!item?.resonance) return false;
  return run.raceId === item.resonance;
}

function sources(run, extra = []) {
  const out = [];
  for (const it of equippedItems(run)) {
    if (it.effects?.length) out.push({ kind: 'item', item: it, effects: it.effects, instanceId: it.instanceId || it.id });
    if (it.setId && it.setBonus) {
      const n = setPiecesWorn(run, it.setId);
      const seen = out.some(s => s.kind === 'set' && s.setId === it.setId);
      if (!seen) {
        const two = n >= 2 ? (it.setBonus[2] || it.setBonus['2'] || []) : [];
        const three = n >= 3 ? (it.setBonus[3] || it.setBonus['3'] || []) : [];
        const fx = [...two, ...three];
        if (fx.length) out.push({ kind: 'set', setId: it.setId, effects: fx, instanceId: `set:${it.setId}` });
      }
    }
  }
  for (const it of relicItems(run)) {
    if (it.effects?.length) out.push({ kind: 'relic', item: it, effects: it.effects, instanceId: it.id });
  }
  for (const id of run.arts || []) {
    const sk = packSkillById(id);
    if (sk?.effects?.length) out.push({ kind: 'art', item: sk, effects: sk.effects, instanceId: id });
  }
  const seenCons = new Set();
  for (const id of run.consumables || []) {
    if (!id || seenCons.has(id)) continue;
    seenCons.add(id);
    const it = packLookup(id);
    if (it?.effects?.length) out.push({ kind: 'bag', item: it, effects: it.effects, instanceId: id });
  }
  for (const src of extra) if (src?.effects?.length) out.push(src);
  return out;
}

function flagPresent(run, key) {
  if (!key) return false;
  if (run.flags?.[key]) return true;
  const b = run.packState;
  if (!b) return false;
  for (const scope of ['action', 'turn', 'combat', 'floor', 'biome', 'run', 'permanent']) {
    if (b[scope] && b[scope][key]) return true;
  }
  return false;
}

function whenOk(ef, ctx) {
  const w = ef.when;
  if (!w) return true;
  const run = ctx.run;
  const f = ctx.fight;
  if (w.flag && !flagPresent(run, w.flag)) return false;
  if (w.notFlag && flagPresent(run, w.notFlag)) return false;
  if (w.guarding && !ctx.guarding && !f?.player?.guarding) return false;
  if (w.charged && !(ctx.enemy?.charge > 0 || ctx.intentCharged)) return false;
  if (w.skillId && ctx.skill?.id !== w.skillId) return false;
  if (w.basic && ctx.skill?.id !== 'basic_attack' && ctx.skill?.id !== 'slash' && !ctx.skill?._basic) return false;
  if (w.differentFromPrior) {
    const prior = packGet(run, 'combat', 'priorActionId');
    if (prior && ctx.skill?.id === prior) return false;
  }
  if (w.sameTarget) {
    const prior = packGet(run, 'combat', 'priorTargetUid');
    if (prior && ctx.enemy?.uid !== prior) return false;
  }
  if (w.hpBelow != null && (run.hp / run.maxHp) >= w.hpBelow) return false;
  if (w.hpAbove != null && (run.hp / run.maxHp) <= w.hpAbove) return false;
  if (w.fameBelow != null && (run.fame || 0) >= w.fameBelow) return false;
  if (w.fameAbove != null && (run.fame || 0) <= w.fameAbove) return false;
  if (w.goldAtLeast != null && (run.gold || 0) < w.goldAtLeast) return false;
  if (w.bloodline && run.raceId !== w.bloodline) return false;
  if (w.classId && run.classId !== w.classId) return false;
  if (w.resonance && ctx.item && !resonanceActive(run, ctx.item)) return false;
  if (w.setPieces != null && ctx.item?.setId && setPiecesWorn(run, ctx.item.setId) < w.setPieces) return false;
  if (w.oncePerCombat && packGet(run, 'combat', `fired:${ef.id || ctx.instanceId}`)) return false;
  if (w.oncePerTurn && packGet(run, 'turn', `fired:${ef.id || ctx.instanceId}`)) return false;
  if (w.copyDepthMax != null && (ctx.copyDepth || 0) > w.copyDepthMax) return false;
  if (w.allyDowned && !ctx.allyDowned) return false;
  if (w.isCrit && !ctx.crit) return false;
  if (w.killing && !ctx.killing) return false;
  if (w.targetMarked && !ctx.enemy?.statuses?.marked) return false;
  if (w.status && !ctx.enemy?.statuses?.[w.status]) return false;
  if (w.selfStatus && !f?.player?.statuses?.[w.selfStatus]) return false;
  if (w.intentAoe && !ctx.intentAoe) return false;
  if (w.intentCharged && !ctx.intentCharged) return false;
  if (w.biome && run.biomeId !== w.biome) return false;
  if (w.stance && packGet(run, 'combat', 'stance') !== w.stance) return false;
  if (w.oath && packGet(run, 'combat', 'oath') !== w.oath) return false;
  if (w.emptySlots != null) {
    const n = emptyEquipSlots(run);
    if (n < w.emptySlots) return false;
  }
  if (w.counter) {
    const n = packGet(run, 'combat', w.counter, 0) || packGet(run, 'run', w.counter, 0) || 0;
    if (w.counterAt != null) {
      if ((n % w.counterAt) !== 0 || n === 0) return false;
    } else if (!n) return false;
  }
  if (w.skillClass && ctx.skill) {
    const cls = ctx.skill.class || ctx.skill.fx;
    if (cls !== w.skillClass) return false;
  }
  return true;
}

function emptyEquipSlots(run) {
  const slots = ['weapon', 'helmet', 'chest', 'legs'];
  return slots.filter(s => !run.equipment?.[s]).length + ((run.relics || []).length === 0 ? 1 : 0);
}

function markFired(ef, ctx) {
  const id = ef.id || ctx.instanceId;
  if (ef.once === 'combat' || ef.when?.oncePerCombat) packSet(ctx.run, 'combat', `fired:${id}`, 1);
  if (ef.once === 'turn' || ef.when?.oncePerTurn) packSet(ctx.run, 'turn', `fired:${id}`, 1);
  if (ef.once === 'action') packSet(ctx.run, 'action', `fired:${id}`, 1);
  if (ef.once === 'run' || ef.once === 'floor') packSet(ctx.run, ef.once === 'floor' ? 'floor' : 'run', `fired:${id}`, 1);
  packAdd(ctx.run, 'action', 'triggers', 1);
  packAdd(ctx.run, 'combat', `srcTriggers:${ctx.instanceId}`, 1);
}

function overCap(ef, ctx) {
  const actionN = packGet(ctx.run, 'action', 'triggers', 0);
  if (actionN >= LIMITS.triggersPerAction) return true;
  const srcN = packGet(ctx.run, 'combat', `srcTriggers:${ctx.instanceId}`, 0);
  if (srcN >= LIMITS.triggersPerSourcePerCombat) return true;
  if (ef.once === 'run' && packGet(ctx.run, 'run', `fired:${ef.id || ctx.instanceId}`)) return true;
  if (ef.once === 'floor' && packGet(ctx.run, 'floor', `fired:${ef.id || ctx.instanceId}`)) return true;
  if (ef.mutex && mutexBlocked(ef.mutex, ctx.ownedMutex || [])) return true;
  if (ef.capability && !capabilityEnabled(ef.capability)) return true;
  if (ef.legacyMirror) return true;
  if ((ctx.copyDepth || 0) > 0 && !ef.generated) {
    if (['echoAction', 'copySupport', 'borrowTechnique'].includes(ef.op)) return true;
  }
  return false;
}

function applyOp(ef, ctx) {
  const run = ctx.run;
  const f = ctx.fight;
  const acc = ctx.acc;
  switch (ef.op) {
    case 'modDamage': {
      let m = ef.mult || 1;
      if (ef.vsCharging && (ctx.enemy?.charge > 0 || ctx.intentCharged)) m *= ef.vsCharging;
      if (ef.vsShielded && ctx.enemy?.statuses?.shield) m *= ef.vsShielded;
      if (ef.vsStatus && ctx.enemy?.statuses?.[ef.vsStatus]) m *= (ef.mult || 1.15);
      if (ef.vsBoss && ctx.enemy?.boss) m *= ef.vsBoss;
      if (ef.vsSummon && ctx.enemy?.summon) m *= (ef.vsSummon || 1.2);
      if (ef.vsFamily && ctx.enemy?.id === ef.vsFamily) m *= (ef.mult || 1.12);
      if (ef.firstHit) {
        const key = `firstHit:${ctx.enemy?.uid || 'x'}`;
        if (packGet(run, 'combat', key)) break;
        packSet(run, 'combat', key, 1);
      }
      if (ef.emptySlots) acc.dmgAdd = (acc.dmgAdd || 0) + emptyEquipSlots(run) * (ef.add || 1);
      acc.dmgMult = (acc.dmgMult || 1) * m;
      if (ef.add && !ef.emptySlots) acc.dmgAdd = (acc.dmgAdd || 0) + ef.add;
      break;
    }
    case 'flatDamage':
      acc.dmgAdd = (acc.dmgAdd || 0) + (ef.flat || ef.amount || 0);
      break;
    case 'modIncoming': {
      let m = ef.mult || 1;
      if (ef.missingAllies) {
        const missing = ctx.missingAllies || 0;
        m *= 1 + missing * (ef.add || 0.08);
        if (missing === 0 && ef.when?.allyDowned === false) m *= (ef.multHealthy || 0.85);
      }
      acc.inMult = (acc.inMult || 1) * m;
      break;
    }
    case 'statusChance': {
      const ch = ef.chance || 0;
      if (ch > 0 && ctx.rng?.chance?.(ch)) {
        acc.statuses = acc.statuses || {};
        acc.statuses[ef.status] = ef.turns || 2;
      }
      break;
    }
    case 'applyStatus':
      acc.statuses = acc.statuses || {};
      acc.statuses[ef.status] = ef.turns || 2;
      break;
    case 'removeStatus':
      if (ctx.enemy?.statuses) delete ctx.enemy.statuses[ef.status];
      if (ef.status && f?.player?.statuses) delete f.player.statuses[ef.status];
      break;
    case 'convertStatus': {
      const n = packGet(run, 'action', 'statusConvert', 0);
      if (n >= LIMITS.statusConversionsPerAction) break;
      const st = ctx.enemy?.statuses;
      if (st && st[ef.status] && ef.statusTo) {
        delete st[ef.status];
        st[ef.statusTo] = ef.turns || 2;
        packAdd(run, 'action', 'statusConvert', 1);
      }
      break;
    }
    case 'extendStatus': {
      const st = ctx.enemy?.statuses || f?.player?.statuses;
      if (st && st[ef.status]) st[ef.status] = (st[ef.status] || 0) + (ef.turns || 1);
      if (ef.selfHarm && f?.player?.statuses) {
        const neg = Object.keys(f.player.statuses).find(k => ['poison', 'burn', 'weaken', 'hexed', 'frail'].includes(k));
        if (neg) f.player.statuses[neg] = (f.player.statuses[neg] || 0) + 1;
      }
      break;
    }
    case 'heal': {
      const amt = ef.pct ? Math.round(run.maxHp * ef.pct) : (ef.amount || 0);
      if (amt) heal(run, amt);
      break;
    }
    case 'overhealWard': {
      const extra = ctx.overheal || 0;
      if (extra > 0 && f) {
        f.player.statuses.shield = { mult: Math.min(0.35, extra / run.maxHp), turns: 2 };
      }
      break;
    }
    case 'shareHeal': {
      acc.shareHeal = (acc.shareHeal || 0) + (ef.pct || 0.25);
      break;
    }
    case 'grantCharge':
      acc.grantCharge = (acc.grantCharge || 0) + (ef.amount || 1);
      break;
    case 'grantResource':
      restoreMana(run, ef.amount || 0);
      break;
    case 'spendResource':
      run.mp = Math.max(0, (run.mp || 0) - (ef.amount || 0));
      break;
    case 'setFlag':
      packSet(run, ef.scope || 'combat', ef.key, ef.value == null ? 1 : ef.value);
      if (ef.persistFlag) {
        run.flags = run.flags || {};
        run.flags[ef.key] = true;
      }
      break;
    case 'clearFlag':
      packSet(run, ef.scope || 'combat', ef.key, null);
      break;
    case 'addCounter':
      packAdd(run, ef.scope || 'combat', ef.key, ef.amount || 1);
      break;
    case 'lethalWard': {
      const used = packGet(run, 'combat', 'lethalWard', 0);
      if (used >= LIMITS.revivesPerCombat) break;
      acc.lethalWard = true;
      acc.lethalMutex = ef.mutex || 'lethal_ward';
      if (ef.maxHp) acc.wardMaxHpCost = ef.maxHp;
      break;
    }
    case 'redirectDamage': {
      const n = packGet(run, 'action', 'redirects', 0);
      if (n >= LIMITS.redirectsPerAction) break;
      acc.redirectPct = clamp(ef.pct || 0.4, 0, 0.6);
      packAdd(run, 'action', 'redirects', 1);
      break;
    }
    case 'interceptAoe': {
      const n = packGet(run, 'combat', 'interceptAoe', 0);
      if (n >= 1) break;
      acc.interceptAoe = clamp(ef.pct || 0.5, 0, 0.7);
      packSet(run, 'combat', 'interceptAoe', 1);
      break;
    }
    case 'echoAction': {
      if ((ctx.copyDepth || 0) >= LIMITS.copyDepth) break;
      if (packGet(run, 'turn', 'echoed', 0)) break;
      acc.echo = {
        skillId: ctx.skill?.id,
        originActionId: ctx.actionId || ctx.skill?.id,
        generated: true,
        copyDepth: (ctx.copyDepth || 0) + 1,
        power: ef.mult || 0.5,
      };
      packSet(run, 'turn', 'echoed', 1);
      break;
    }
    case 'copySupport': {
      const last = packGet(run, 'combat', 'lastAllySupport');
      if (last && (ctx.copyDepth || 0) < LIMITS.copyDepth) {
        acc.copySupport = { skillId: last, copyDepth: 1, generated: true, power: ef.mult || 0.6 };
      }
      break;
    }
    case 'summonAlly': {
      const n = packGet(run, 'combat', 'summons', 0);
      if (n >= LIMITS.summonsCap) break;
      const id = SAFE_ARCHETYPES.includes(ef.archetype) ? ef.archetype : 'skeleton';
      acc.summon = { id, generated: true };
      packAdd(run, 'combat', 'summons', 1);
      break;
    }
    case 'storeArchetype': {
      const id = ctx.enemy?.id;
      if (id && SAFE_ARCHETYPES.includes(id) && !ctx.enemy?.boss && !ctx.enemy?.elite) {
        packSet(run, 'run', 'storedArchetype', id);
      }
      break;
    }
    case 'revealIntent':
      acc.revealIntent = ef.value || 'shape';
      break;
    case 'weakenIntent':
      acc.intentMult = (acc.intentMult || 1) * (ef.mult || 0.85);
      break;
    case 'chooseStance': {
      let st = ef.stance || ctx.stance || 'hunt';
      if (st === 'cycle') {
        const order = ['hunt', 'rescue', 'escape'];
        const cur = packGet(run, 'combat', 'stance') || 'escape';
        st = order[(order.indexOf(cur) + 1) % order.length];
      }
      if (st === 'system') st = ((run.seed || 0) & 1) ? 'hunt' : 'escape';
      if (run.flags?.cp_trail_rescue) st = 'rescue';
      else if (run.flags?.cp_trail_escape) st = 'escape';
      else if (run.flags?.cp_trail_hunt) st = 'hunt';
      packSet(run, 'combat', 'stance', st);
      break;
    }
    case 'armNextHit':
      packSet(run, ef.scope || 'combat', 'armHitAdd', ef.add || 0);
      packSet(run, ef.scope || 'combat', 'armHitMult', ef.mult || 1);
      break;
    case 'armNextIncoming':
      packSet(run, ef.scope || 'combat', 'armInMult', ef.mult || 1);
      packSet(run, ef.scope || 'combat', 'armInAdd', ef.add || 0);
      break;
    case 'cancelEventPenalty': {
      const o = ctx.outcome;
      if (!o || packGet(run, 'run', 'ticketSpent')) break;
      if ((o.hp || 0) < 0) {
        run.hp = Math.min(run.maxHp, (run.hp || 0) + Math.abs(o.hp));
        packSet(run, 'run', 'ticketSpent', 1);
      } else if ((o.gold || 0) < 0) {
        earnGold(run, Math.abs(o.gold), 'pack_ticket');
        packSet(run, 'run', 'ticketSpent', 1);
      }
      break;
    }
    case 'setOath':
      packSet(run, 'combat', 'oath', ef.oath || ctx.oath || 'endure');
      break;
    case 'markTarget':
      if (ctx.enemy) {
        ctx.enemy.statuses = ctx.enemy.statuses || {};
        ctx.enemy.statuses.marked = ef.turns || 3;
        packSet(run, 'run', 'preyFamily', ctx.enemy.id);
      }
      break;
    case 'recordName':
      packSet(run, 'combat', `named:${ctx.healTarget || 'self'}`, 1);
      break;
    case 'spendGoldPower': {
      const cost = ef.gold || 5;
      if ((run.gold || 0) >= cost) {
        spendGold(run, cost, 'pack_power');
        acc.dmgMult = (acc.dmgMult || 1) * (ef.mult || 1.2);
        if (ctx.hook !== 'onHit') {
          packSet(run, ef.scope || 'combat', 'armHitMult', ef.mult || 1.2);
          if (ef.add) packSet(run, ef.scope || 'combat', 'armHitAdd', ef.add);
        }
      } else if (ef.selfHarm) {
        run.hp = Math.max(1, run.hp - (ef.amount || 4));
      }
      break;
    }
    case 'spendFamePower': {
      const cost = ef.fame || 2;
      if ((run.fame || 0) >= cost) {
        changeFame(run, -cost);
        acc.dmgMult = (acc.dmgMult || 1) * (ef.mult || 1.15);
        if (ctx.hook !== 'onHit') {
          packSet(run, f ? 'combat' : 'run', 'armHitMult', ef.mult || 1.15);
          if (ef.add) packSet(run, f ? 'combat' : 'run', 'armHitAdd', ef.add);
        }
      } else if (ef.selfHarm) {
        run.hp = Math.max(1, run.hp - (ef.amount || 3));
      }
      break;
    }
    case 'convertResource': {
      const o = ctx.outcome;
      if (!o) break;
      if (ef.key === 'unminted' && (o.gold || 0) < 0 && !packGet(run, 'floor', 'unmintedUsed')) {
        earnGold(run, Math.abs(o.gold), 'pack_unminted');
        packSet(run, 'floor', 'unmintedUsed', 1);
        break;
      }
      if (ef.key === 'kiln' && !packGet(run, 'floor', 'kilnBonus')) {
        earnGold(run, 8, 'pack_kiln');
        packSet(run, 'floor', 'kilnBonus', 1);
        break;
      }
      if (ef.key === 'halo' && (o.fame || 0) > 0) {
        changeFame(run, -1);
        break;
      }
      if (packGet(run, 'biome', 'hingeSwap')) break;
      if (ef.stat === 'hp' && ef.target === 'gold' && (o.hp || 0) < 0) {
        const cost = Math.abs(o.hp);
        run.hp = Math.min(run.maxHp, (run.hp || 0) + cost);
        spendGold(run, Math.min(run.gold || 0, Math.max(8, cost * 4)), 'pack_hinge');
        packSet(run, 'biome', 'hingeSwap', 1);
      } else if ((o.gold || 0) < 0 && ef.stat === 'hp') {
        const refund = Math.abs(o.gold);
        earnGold(run, refund, 'pack_hinge');
        run.hp = Math.max(1, (run.hp || 1) - Math.min(12, 8));
        packSet(run, 'biome', 'hingeSwap', 1);
      } else if (ef.amount && (o.gold || 0) < 0) {
        heal(run, 4);
      }
      break;
    }
    case 'delayEffect':
      packSet(run, 'combat', `delay:${ef.id || instId(ctx)}`, {
        turns: ef.delayTurns || 1, applyOp: 'modIncoming', mult: ef.mult || 1, add: ef.add || 0,
      });
      break;
    case 'evolveItem':
      packAdd(run, 'run', `evo:${ef.itemId || ctx.item?.id}`, 1);
      break;
    case 'crackItem':
      packSet(run, 'run', `cracked:${ef.itemId || ctx.item?.id}`, 1);
      break;
    case 'contestLethal':
      acc.contestLethal = { cost: ef.amount || 8, fame: ef.fame || 0 };
      break;
    case 'borrowTechnique': {
      const cat = packGet(run, 'combat', 'borrowedCat');
      acc.borrow = cat || ef.skillId || null;
      break;
    }
    case 'storeMemory': {
      const stored = ef.value != null
        ? ef.value
        : ef.stat === 'hp' ? (run.hp || 0)
        : (ctx.price != null ? ctx.price : (ctx.skill?.id || 1));
      packSet(run, ef.scope || 'run', ef.key, stored);
      break;
    }
    case 'restoreMemory': {
      const v = packGet(run, ef.scope || 'combat', ef.key);
      if (ef.stat === 'hp' && typeof v === 'number') {
        run.hp = Math.max(1, Math.min(run.maxHp, v));
      }
      break;
    }
    case 'modAccuracy':
      acc.accAdd = (acc.accAdd || 0) + (ef.add || 0);
      break;
    case 'gainFame':
      changeFame(run, ef.amount || 1);
      break;
    case 'gainGold':
      earnGold(run, ef.amount || 0, 'pack_effect');
      break;
    case 'reduceCharge':
      if (ctx.enemy && ctx.enemy.charge > 0) {
        ctx.enemy.charge = Math.max(0, ctx.enemy.charge - (ef.amount || 1));
      }
      break;
    case 'altTargetShot':
      acc.altShot = true;
      break;
    case 'leaveAtOne':
      acc.leaveAtOne = true;
      break;
    case 'noOp':
    default:
      break;
  }
}

/**
 * Dispatch all matching effects for a hook. Returns an accumulator the
 * caller applies (damage mults, wards, summons). Never throws on pack-off.
 */
export function dispatchEffects(fightOrRun, hook, ctx = {}) {
  const acc = { dmgMult: 1, inMult: 1, dmgAdd: 0, statuses: {}, logs: [] };
  if (!isPackOn()) return acc;
  if (!HOOKS.includes(hook)) return acc;
  const fight = fightOrRun?.run ? fightOrRun : null;
  const run = fight?.run || fightOrRun;
  if (!run) return acc;
  const extra = [];
  if (ctx.skill?.effects) extra.push({ kind: 'skill', item: ctx.skill, effects: ctx.skill.effects, instanceId: ctx.skill.id });
  if (ctx.consumable?.effects) extra.push({ kind: 'consumable', item: ctx.consumable, effects: ctx.consumable.effects, instanceId: ctx.consumable.id });
  const list = [];
  for (const src of sources(run, extra)) {
    for (const ef of src.effects || []) {
      if (ef.hook !== hook) continue;
      if (ef.legacyMirror) continue;
      list.push({ ef, src, instanceId: src.instanceId, item: src.item });
    }
  }
  list.sort((a, b) => {
    const pd = (b.ef.priority || 0) - (a.ef.priority || 0);
    if (pd) return pd;
    return String(a.instanceId).localeCompare(String(b.instanceId));
  });
  const env = {
    run, fight, rng: ctx.rng || fight?.rng, acc,
    skill: ctx.skill, enemy: ctx.enemy, consumable: ctx.consumable,
    copyDepth: ctx.copyDepth || 0, actionId: ctx.actionId,
    guarding: ctx.guarding, crit: ctx.crit, killing: ctx.killing,
    allyDowned: ctx.allyDowned, missingAllies: ctx.missingAllies || 0,
    intentAoe: ctx.intentAoe, intentCharged: ctx.intentCharged,
    overheal: ctx.overheal, healTarget: ctx.healTarget,
    stance: ctx.stance, oath: ctx.oath,
    ownedMutex: ctx.ownedMutex || [],
    outcome: ctx.outcome, event: ctx.event, shopKind: ctx.shopKind,
    price: ctx.price, amount: ctx.amount, status: ctx.status,
    hook,
  };
  for (const row of list) {
    env.instanceId = row.instanceId;
    env.item = row.item;
    if (!whenOk(row.ef, env)) continue;
    if (overCap(row.ef, env)) continue;
    applyOp(row.ef, env);
    markFired(row.ef, env);
  }
  return acc;
}

export function applyOutgoingMods(baseDmg, acc) {
  let dmg = baseDmg * (acc.dmgMult || 1) + (acc.dmgAdd || 0);
  return Math.max(0, dmg);
}

export function applyIncomingMods(baseDmg, acc) {
  return Math.max(0, baseDmg * (acc.inMult || 1));
}

function consumeArmed(run, addKey, multKey) {
  if (!run) return { add: 0, mult: 1 };
  for (const scope of ['combat', 'turn', 'floor', 'run']) {
    const add = packGet(run, scope, addKey);
    const mult = packGet(run, scope, multKey);
    const hasAdd = add != null && add !== 0;
    const hasMult = mult != null && Number(mult) !== 1;
    if (hasAdd || hasMult) {
      packSet(run, scope, addKey, null);
      packSet(run, scope, multKey, null);
      return { add: Number(add) || 0, mult: hasMult ? Number(mult) : 1 };
    }
  }
  return { add: 0, mult: 1 };
}

export function consumeArmedOutgoing(run) {
  return consumeArmed(run, 'armHitAdd', 'armHitMult');
}

export function consumeArmedIncoming(run) {
  return consumeArmed(run, 'armInAdd', 'armInMult');
}

export function applyHotTick(run) {
  if (!isPackOn() || !run) return;
  const hot = packGet(run, 'combat', 'hot');
  if (hot) heal(run, Number(hot) || 0);
}

export function applySavedHpRestore(run) {
  if (!isPackOn() || !run) return;
  const v = packGet(run, 'combat', 'savedHp');
  if (typeof v === 'number') {
    run.hp = Math.max(1, Math.min(run.maxHp, v));
    packSet(run, 'combat', 'savedHp', null);
  }
}

export function noteActionMemory(run, skill, enemy) {
  if (!isPackOn() || !run) return;
  if (skill?.id) packSet(run, 'combat', 'priorActionId', skill.id);
  if (enemy?.uid) packSet(run, 'combat', 'priorTargetUid', enemy.uid);
  if (skill?.id) packSet(run, 'run', 'lastCombatSkill', skill.id);
  if (skill?.guard) packSet(run, 'combat', 'behaveGuard', 1);
  if (skill?._basic || skill?.id === 'slash' || skill?.id === 'basic_attack') packSet(run, 'combat', 'behaveBasic', 1);
  if (skill && !skill.guard && skill.target === 'self') packSet(run, 'combat', 'behaveIntercept', 1);
}

/** Tick combat-scoped delayed payloads. Due entries become turn-scoped incoming mods. */
export function applyDelayedEffects(run) {
  if (!isPackOn() || !run?.packState?.combat) return;
  const bag = run.packState.combat;
  for (const key of Object.keys(bag)) {
    if (!key.startsWith('delay:')) continue;
    const v = bag[key];
    if (!v || typeof v !== 'object') continue;
    const turns = (v.turns | 0) - 1;
    if (turns > 0) {
      packSet(run, 'combat', key, { ...v, turns });
      continue;
    }
    packSet(run, 'combat', key, null);
    packSet(run, 'turn', 'delayInMult', v.mult || 1);
    packSet(run, 'turn', 'delayInAdd', v.add || 0);
  }
}

export function packCombatCleanup(run, kind) {
  if (kind === 'action') cleanupAfterAction(run);
  else if (kind === 'turn') cleanupAfterTurn(run);
  else if (kind === 'combat') cleanupAfterCombat(run);
}

export function partyMissingCount(fight, party = []) {
  if (party.length) return party.filter(p => p.down || p.over || p.hp <= 0).length;
  if (!fight) return 0;
  return fight.run?.down ? 1 : 0;
}

export function packDeathSave(fight, acc) {
  if (!acc?.lethalWard || !fight) return false;
  if (packGet(fight.run, 'combat', 'lethalWard', 0)) return false;
  packSet(fight.run, 'combat', 'lethalWard', 1);
  fight.run.hp = 1;
  fight.usedDeathward = true;
  if (acc.wardMaxHpCost) {
    fight.run.maxHp = Math.max(8, fight.run.maxHp + acc.wardMaxHpCost);
    fight.run.hp = Math.min(fight.run.hp, fight.run.maxHp);
  }
  fight.log?.('A recorded death stumbles — you remain at 1 HP.', 'log-sys');
  return true;
}

export { LIMITS, CONFIG };
