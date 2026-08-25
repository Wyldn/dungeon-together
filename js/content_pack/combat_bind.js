// Isolated combat application of pack accumulators.
// combat_core calls these; it must not branch on item or skill IDs.

import { isPackOn } from './flags.js';
import { LIMITS, SAFE_ARCHETYPES } from './schema.js';
import {
  dispatchEffects, applyOutgoingMods, applyIncomingMods, packDeathSave,
  noteActionMemory, packCombatCleanup, partyMissingCount, applyDelayedEffects,
  consumeArmedOutgoing, consumeArmedIncoming, applyHotTick, applySavedHpRestore,
} from './engine.js';
import { packGet, packSet } from './state.js';

const PACK_SUMMONS = {
  skeleton: { id: 'skeleton', name: 'Risen Skeleton', hp: 30, atk: 9 },
  leech: { id: 'leech', name: 'Bound Leech', hp: 28, atk: 10 },
  imp: { id: 'imp', name: 'Cinder Imp', hp: 26, atk: 11 },
  slime: { id: 'slime', name: 'Spawn Slime', hp: 24, atk: 8 },
  rat: { id: 'rat', name: 'Sewer Rat', hp: 18, atk: 7 },
  wolf: { id: 'wolf', name: 'Bound Wolf', hp: 22, atk: 9 },
  spider: { id: 'spider', name: 'Bound Spider', hp: 20, atk: 8 },
  bandit: { id: 'bandit', name: 'Shade Bandit', hp: 24, atk: 9 },
};

function summonSpec(id) {
  return PACK_SUMMONS[id] || PACK_SUMMONS.skeleton;
}

function applyStatuses(target, statuses) {
  if (!target || !statuses) return;
  target.statuses = target.statuses || {};
  for (const [k, v] of Object.entries(statuses)) {
    if (v) target.statuses[k] = v;
  }
}

export function packOnCombatStart(f) {
  if (!isPackOn() || !f) return;
  dispatchEffects(f, 'onCombatStart', { rng: f.rng });
}

export function packOnCombatEnd(f) {
  if (!f || f._packCombatEnded) return;
  f._packCombatEnded = true;
  if (isPackOn()) {
    dispatchEffects(f, 'onCombatEnd', { rng: f.rng });
    applySavedHpRestore(f.run);
  }
  if (f.run) packCombatCleanup(f.run, 'combat');
}

export function packOnTurnStart(f) {
  if (!isPackOn() || !f) return;
  applyDelayedEffects(f.run);
  applyHotTick(f.run);
  const acc = dispatchEffects(f, 'onTurnStart', { rng: f.rng });
  if (acc.grantCharge) f.charge = Math.min(6, (f.charge || 0) + acc.grantCharge);
}

export function packOnTurnEnd(f) {
  if (!f?.run) return;
  if (isPackOn()) dispatchEffects(f, 'onTurnEnd', { rng: f.rng });
  packCombatCleanup(f.run, 'turn');
}

export function packOnGuard(f, sk) {
  if (!isPackOn()) return;
  dispatchEffects(f, 'onGuard', { rng: f.rng, skill: sk, guarding: true });
}

export function packOnMiss(f, sk) {
  if (!isPackOn() || !f) return {};
  const acc = dispatchEffects(f, 'onMiss', { rng: f.rng, skill: sk });
  if (acc.grantCharge) f.charge = Math.min(6, (f.charge || 0) + acc.grantCharge);
  return acc;
}

export function packOnStatusApplied(f, status) {
  if (!isPackOn() || !f || !status) return;
  dispatchEffects(f, 'onStatusApplied', { rng: f.rng, status });
}

export function packOnPhaseChange(f, e) {
  if (!isPackOn() || !f) return;
  dispatchEffects(f, 'onPhaseChange', { rng: f.rng, enemy: e });
}

export function packOnSkillUse(f, sk) {
  if (!isPackOn()) return {};
  const acc = dispatchEffects(f, 'onSkillUse', { rng: f.rng, skill: sk, actionId: sk?.id });
  if (acc.grantCharge) f.charge = Math.min(6, (f.charge || 0) + acc.grantCharge);
  if (acc.contestLethal || acc.lethalWard) f._packIncoming = { ...(f._packIncoming || {}), ...acc };
  if (acc.revealIntent) {
    f._packIntentPreview = acc.revealIntent;
    f.log?.('A corrupted preview sketches the next intent.', 'log-sys');
  }
  return acc;
}

export function packOnConsumable(f, c) {
  if (!isPackOn() || !c) return {};
  const acc = dispatchEffects(f, 'onConsumable', { rng: f.rng, consumable: c, skill: c });
  if (acc.grantCharge) f.charge = Math.min(6, (f.charge || 0) + acc.grantCharge);
  if (acc.lethalWard) f._packIncoming = { ...(f._packIncoming || {}), ...acc };
  applyStatuses(f.enemies[f.target], acc.statuses);
  maybeSummon(f, acc);
  return acc;
}

export function packModifyOutgoing(f, e, sk, dmg, { crit = false, copyDepth = 0 } = {}) {
  if (!isPackOn()) return { dmg, acc: { dmgMult: 1, dmgAdd: 0, statuses: {} } };
  const acc = dispatchEffects(f, 'onHit', {
    rng: f.rng, skill: sk, enemy: e, crit, copyDepth,
    actionId: sk?.id,
    intentCharged: (e?.charge || 0) > 0,
    killing: e && e.hp <= dmg,
  });
  dmg = applyOutgoingMods(dmg, acc);
  const armed = consumeArmedOutgoing(f.run);
  if (armed.mult !== 1 || armed.add) dmg = Math.max(0, dmg * armed.mult + armed.add);
  if (acc.leaveAtOne && e && e.hp - dmg < 1) dmg = Math.max(0, e.hp - 1);
  return { dmg, acc };
}

export function packAfterHit(f, e, sk, acc, { copyDepth = 0 } = {}) {
  if (!isPackOn() || !acc) return;
  applyStatuses(e, acc.statuses);
  if (e?.hp <= 0) {
    dispatchEffects(f, 'onKill', { rng: f.rng, skill: sk, enemy: e, killing: true, copyDepth });
    packSet(f.run, 'combat', 'behaveExec', 1);
  }
  noteActionMemory(f.run, sk, e);
  maybeSummon(f, acc);
}

export function packEchoHit(f, e, sk, acc, d, resolveHit) {
  if (!isPackOn() || !acc?.echo || (f._copyDepth || 0) > 0) return;
  if (!e || e.hp <= 0 || !sk) return;
  const depth = acc.echo.copyDepth || 1;
  if (depth > LIMITS.copyDepth) return;
  f._copyDepth = depth;
  const echoSk = {
    ...sk,
    id: sk.id,
    name: sk.name,
    power: Math.round((sk.power || 100) * (acc.echo.power || 0.5)),
    _generated: true,
    _basic: true,
  };
  try {
    resolveHit(f, e, echoSk, d);
  } finally {
    f._copyDepth = 0;
  }
}

export function packModifyIncoming(f, e, special, dmg) {
  if (!isPackOn()) return { dmg, acc: { inMult: 1 } };
  const missing = partyMissingCount(f, f._partyRuns);
  const acc = dispatchEffects(f, 'beforeDamageTaken', {
    rng: f.rng, enemy: e, guarding: !!f.player?.guarding,
    intentAoe: !!(special && (special.target === 'all' || special.aoe)),
    intentCharged: !!special,
    allyDowned: missing > 0,
    missingAllies: missing,
  });
  f._packIncoming = acc;
  dmg = applyIncomingMods(dmg, acc);
  const armedIn = consumeArmedIncoming(f.run);
  if (armedIn.mult !== 1 || armedIn.add) dmg = Math.max(0, dmg * armedIn.mult + armedIn.add);
  const delayMult = packGet(f.run, 'turn', 'delayInMult');
  if (delayMult) {
    dmg *= delayMult;
    packSet(f.run, 'turn', 'delayInMult', null);
  }
  const delayAdd = packGet(f.run, 'turn', 'delayInAdd');
  if (delayAdd) {
    dmg += delayAdd;
    packSet(f.run, 'turn', 'delayInAdd', null);
  }
  if (acc.intentMult && special) dmg *= acc.intentMult;
  if (acc.interceptAoe && special && (special.target === 'all' || special.aoe)) {
    dmg *= (1 - acc.interceptAoe);
  }
  if (acc.redirectPct) dmg *= (1 - acc.redirectPct);
  if (acc.contestLethal && f.run.hp - dmg <= 0) {
    const cost = acc.contestLethal.cost || 8;
    f.run.hp = Math.max(1, f.run.hp - cost);
    dmg = 0;
    f.log?.(`You contest the killing blow and pay ${cost} HP.`, 'log-sys');
  }
  absorbWithSummon(f, dmg);
  return { dmg, acc };
}

export function packOnDamageTaken(f, dmg) {
  if (!isPackOn() || !f || !(dmg > 0)) return;
  dispatchEffects(f, 'onDamageTaken', { rng: f.rng, amount: dmg });
}

export function packOnHeal(f, amount) {
  if (!isPackOn() || !f || !(amount > 0)) return;
  const acc = dispatchEffects(f, 'onHeal', { rng: f.rng, overheal: 0, healTarget: 'self', amount });
  if (acc.shareHeal && f.run) {
    const extra = Math.max(1, Math.round(amount * acc.shareHeal * 0.35));
    f.run.hp = Math.min(f.run.maxHp, (f.run.hp || 0) + extra);
  }
}

export function packOnIntentRevealed(f, e, special) {
  if (!isPackOn() || !f || !special) return;
  const acc = dispatchEffects(f, 'onIntentRevealed', {
    rng: f.rng, enemy: e,
    intentAoe: !!(special.target === 'all' || special.aoe),
    intentCharged: true,
  });
  if (acc.revealIntent) {
    const shape = (special.target === 'all' || special.aoe) ? 'wide' : 'focused';
    f.log?.(`Intent shape: ${shape}.`, 'log-sys');
  }
}

export function packTryDeathSave(f) {
  if (!isPackOn()) return false;
  return packDeathSave(f, f._packIncoming);
}

function maybeSummon(f, acc) {
  if (!acc?.summon || !f) return;
  f.packAllies = f.packAllies || [];
  if (f.packAllies.length >= LIMITS.summonsCap) return;
  const id = SAFE_ARCHETYPES.includes(acc.summon.id) ? acc.summon.id : 'skeleton';
  const spec = summonSpec(id);
  f.packAllies.push({
    id: spec.id, name: spec.name, hp: spec.hp, maxHp: spec.hp,
    atk: Math.max(1, Math.round((spec.atk || 8) * 0.45)), generated: true,
  });
  f.log?.(`${spec.name} answers the call.`, 'log-ally');
}

function absorbWithSummon(f, dmg) {
  const ally = f.packAllies?.find(a => a.hp > 0);
  if (!ally || !(dmg > 0)) return dmg;
  const take = Math.min(ally.hp, Math.round(dmg * 0.35));
  ally.hp -= take;
  return dmg;
}

export function packAllyStrikes(f) {
  if (!isPackOn() || !f?.packAllies?.length) return;
  const e = f.enemies[f.target];
  if (!e || e.hp <= 0) return;
  for (const ally of f.packAllies) {
    if (ally.hp <= 0) continue;
    const dmg = Math.max(1, ally.atk);
    e.hp = Math.max(0, e.hp - dmg);
    f.log?.(`${ally.name} strikes ${e.name} for ${dmg}.`, 'log-ally');
  }
}

export { packGet };
