// Shared combat rules — no DOM, audio, or timers.
// Browser Fight and headless simulation both execute these functions.
// Do not reorder RNG calls. Do not retune numbers to match combat_sim.js.

import { SKILLS } from './data/skills.js';
import { CONSUMABLES, consumableCombatValue } from './data/items.js';
import { CONFIG } from './data/config.js';
import {
  enemyScale, softLevelDamage, partyOutgoingDmgMult, soloBossChargeForScale,
  soloBossSpecialDmgMult, f30SoloGateMults, f40SoloGateMults,
  TDC, resourceRegen,
} from './data/tdc.js';
import { derived, gearHas, heal, restoreMana, changeFame } from './character.js';
import {
  initiativeOrder, addCharge, tickEnemyCharge, skillEffectivePower, pickEnemySpecial,
  specialChargeCost, spendEnemySpecialCharge, bossChargeDamageScale,
  applyGuard, applyDefense, enemySpecialPayoff, enemyPayoffLine,
  skillCooldownTurns, cooldownRemaining,
} from './systems.js';
import { biomeForFloor, ENEMIES } from './data/enemies.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function skillStatValue(sk, d) {
  const stat = sk.stat || 'str';
  if (stat === 'best') return Math.max(d.str, d.dex, d.int, d.wis);
  if (stat.includes('+')) {
    const [a, b] = stat.split('+');
    return ((d[a] || 0) + (d[b] || 0)) * 0.55;
  }
  return d[stat] || d.str;
}

const DEFAULT_SUMMONS = {
  skeleton: { id: 'skeleton', name: 'Risen Skeleton', glyph: '💀', hp: 30, atk: 9, def: 2, spd: 6, gold: [0, 0], xp: 5 },
  leech: { id: 'leech', name: 'Bound Leech', glyph: '🪱', hp: 28, atk: 10, def: 1, spd: 6, gold: [0, 0], xp: 5, lifesteal: 0.35 },
  imp: { id: 'imp', name: 'Cinder Imp', glyph: '👺', hp: 26, atk: 11, def: 2, spd: 11, gold: [0, 0], xp: 5, burn: 0.25 },
  slime: { id: 'slime', name: 'Spawn Slime', glyph: '🟢', hp: 24, atk: 8, def: 1, spd: 4, gold: [0, 0], xp: 5 },
  rat: { id: 'rat', name: 'Sewer Rat', glyph: '🐀', hp: 18, atk: 7, def: 0, spd: 10, gold: [0, 0], xp: 4 },
};

export function summonSpecFor(summonId) {
  if (!summonId) return DEFAULT_SUMMONS.skeleton;
  if (DEFAULT_SUMMONS[summonId]) return { ...DEFAULT_SUMMONS[summonId] };
  for (const pool of Object.values(ENEMIES)) {
    const found = pool.find(e => e.id === summonId);
    if (found) {
      return {
        id: found.id, name: found.name, glyph: found.glyph,
        hp: Math.round(found.hp * 0.55), atk: Math.round(found.atk * 0.7),
        def: Math.max(0, found.def - 1), spd: found.spd,
        gold: [0, 0], xp: 5,
        burn: found.burn, poison: found.poison, lifesteal: found.lifesteal, freeze: found.freeze,
      };
    }
  }
  return DEFAULT_SUMMONS.skeleton;
}

export function enemyHitFreezes(e, special, rng) {
  if (e.freezeEvery) {
    return e.turnCount > 0 && e.turnCount % e.freezeEvery === 0;
  }
  return (e.freeze && rng.chance(e.freeze))
    || !!special?.freezeSure
    || !!(special?.freeze && rng.chance(special.freeze));
}

export function statusOutgoingMult(statuses = {}) {
  const C = CONFIG.combat;
  let m = 1;
  if (statuses.weaken) m *= C.weakenDmgMult ?? 0.7;
  if (statuses.burn) m *= C.burnDmgMult ?? 0.85;
  return m;
}

export function collectEnemyRiders(e, special, rng) {
  const C = CONFIG.combat;
  const riders = {};
  if ((e.poison && rng.chance(e.poison)) || special?.poisonSure
    || (special?.poison && rng.chance(special.poison))) {
    riders.poison = C.poisonTurns ?? 3;
  }
  if ((e.burn && rng.chance(e.burn)) || special?.burnSure
    || (special?.burn && rng.chance(special.burn))) {
    riders.burn = C.burnTurns ?? 2;
  }
  if (enemyHitFreezes(e, special, rng)) riders.freeze = 1;
  if (special?.weakenSure || (special?.weaken && rng.chance(special.weaken))) riders.weaken = 3;
  if (special?.hexSure || (special?.hex && rng.chance(special.hex))) riders.hexed = 3;
  if (special?.frailSure || (special?.frail && rng.chance(special.frail)) || e._howlFrail) {
    riders.frail = 3;
    delete e._howlFrail;
  }
  if (special?.tormentedSure || (special?.tormented && rng.chance(special.tormented))) riders.tormented = 3;
  if (special?.confusedSure || (special?.confused && rng.chance(special.confused))) riders.confused = C.confuseTurns ?? 2;
  if (special?.lazySure || (special?.lazy && rng.chance(special.lazy))) riders.lazy = 2;
  if (special?.paralyzeSure || special?.stunSure
    || (special?.paralyze && rng.chance(special.paralyze))
    || (special?.stun && rng.chance(special.stun))) {
    riders.paralyze = C.paralyzeTurns ?? 2;
  }
  return riders;
}

export function initiativePenaltyFromStatuses(statuses = {}) {
  if (!statuses.paralyzed) return 0;
  return -(CONFIG.combat.paralyzeInitPenalty ?? 4);
}

export function buildEnemy(spec, floor, biomeStart, {
  boss = false, hpMult = 1, atkMult = 1, partySize = 1, uid = null, spawnIndex = 0,
} = {}) {
  const isBoss = boss || !!spec.boss;
  const biome = biomeForFloor(floor);
  const sc = enemyScale(floor, biomeStart, biome.id, {
    boss: isBoss, elite: !!spec.elite, partySize,
    eliteAtkRole: !!spec.eliteAtkRole,
  });
  let hpScale = sc.hp * (hpMult || 1);
  let atkScale = sc.atk * (atkMult || 1);
  if (isBoss && floor === 20 && (partySize || 1) <= 1 && spec.id === 'lich') {
    hpScale *= TDC.enemy.f20LichSoloHpMult ?? 1;
    atkScale *= TDC.enemy.f20LichSoloAtkMult ?? 1;
  }
  const f30Gate = f30SoloGateMults(floor, partySize, spec);
  hpScale *= f30Gate.hp;
  atkScale *= f30Gate.atk;
  const f40Gate = f40SoloGateMults(floor, partySize, spec);
  hpScale *= f40Gate.hp;
  atkScale *= f40Gate.atk;
  const spd = Math.max(1, Math.round((spec.spd || 5) * sc.spd));
  const liveAtk = Math.round(spec.atk * atkScale);
  return {
    ...spec,
    boss: isBoss,
    elite: !!spec.elite,
    maxHp: Math.round(spec.hp * hpScale),
    hp: Math.round(spec.hp * hpScale),
    atk: liveAtk,
    baseAtk: liveAtk,
    def: Math.round(spec.def * sc.def),
    spd,
    chargeGain: (spec.chargeGain || 1) * sc.chargeGain,
    charge: 0,
    statuses: {},
    phaseTriggers: [],
    turnCount: 0,
    _m: { hp: hpScale, atk: atkScale, def: sc.def, spd: sc.spd },
    uid: spec.uid || uid || `${spec.id || 'foe'}-${floor}-${spawnIndex}`,
  };
}

export function spawnSummon(f, bossEnemy) {
  const spec = summonSpecFor(bossEnemy.summons);
  const minion = buildEnemy(spec, f.run.floor, f.run.floor, { uid: `${spec.id || 'summon'}-${f.enemies.length}` });
  minion.summon = true;
  minion.spawnIn = true;
  f.enemies.push(minion);
  f.order.push({
    key: minion.uid, name: minion.name, glyph: minion.glyph,
    spdStat: minion.spd, isPlayer: false, stableId: minion.uid, init: 0,
  });
  return minion;
}

export function hasDebuff(st) {
  return !!(st.poison || st.burn || st.frozen || st.stunned || st.hexed
    || st.frail || st.weaken || st.lazy || st.confused || st.paralyzed || st.marked);
}
export function hasHardCC(st) { return !!(st.frozen || st.stunned); }

export function applyPlayerFrail(f, dmg) {
  if (f.player.statuses.hexed) dmg = Math.max(1, Math.round(dmg * (CONFIG.combat.hexTakenMult ?? 1.12)));
  if (!f.player.statuses.frail) return dmg;
  return Math.max(1, Math.round(dmg * (CONFIG.combat.frailTakenMult ?? 1.12)));
}

export function buffValue(f, stat) {
  let mult = 1, add = 0;
  for (const b of f.player.buffs) {
    if (b.stat === stat) { if (b.mult) mult *= b.mult; if (b.add) add += b.add; }
  }
  return { mult, add };
}

export function partyBuffMult(f, kind) {
  let m = 1;
  for (const b of (f.player.partyBuffs || [])) {
    if (b.kind === kind) m *= b.mult;
  }
  return m;
}

export function gainCharge(f, n) {
  const before = f.charge;
  f.charge = addCharge(f.charge, n, f.mod.chargeMult || 1);
  if (f.charge > before) f.renderCharge?.();
}

export function startSkillCooldown(f, sk) {
  const turns = skillCooldownTurns(sk);
  if (turns <= 0 || !sk?.id) return;
  f.skillCDs = f.skillCDs || {};
  f.skillCDs[sk.id] = turns;
  f._cdUsedThisTurn = f._cdUsedThisTurn || {};
  f._cdUsedThisTurn[sk.id] = true;
}

export function tickPlayerCooldowns(f) {
  const cds = f.skillCDs || {};
  const used = f._cdUsedThisTurn || {};
  for (const id of Object.keys(cds)) {
    if (used[id]) continue;
    const n = (cds[id] | 0) - 1;
    if (n <= 0) delete cds[id];
    else cds[id] = n;
  }
  f._cdUsedThisTurn = {};
}

/** Grant start-of-turn Battle Charge once per player turn (reconnect-safe). */
export function preparePlayerTurnStart(f) {
  if (f._turnPrepared) return false;
  f._turnPrepared = true;
  f._cdUsedThisTurn = f._cdUsedThisTurn || {};
  gainCharge(f, CONFIG.charge.gainPerTurn);
  return true;
}

export function completePlayerTurn(f) {
  tickPlayerCooldowns(f);
  f._turnPrepared = false;
}

export function resetPlayerCooldowns(f) {
  f.skillCDs = {};
  f._cdUsedThisTurn = {};
  f._turnPrepared = false;
}

export function gainFury(f, amount) {
  if (f.run.classId !== 'viking' || !(amount > 0)) return 0;
  return restoreMana(f.run, amount);
}

export function classResourceTick(f) {
  const cls = f.run.classId;
  if (cls === 'archer' && f._rangerOffensive && !f._rangerCrit) {
    const gearOnly = (f.d().manaRegen || 0) - resourceRegen(f.run.stats.wis, 0, 'archer');
    restoreMana(f.run, Math.max(0, gearOnly));
  } else {
    restoreMana(f.run, f.d().manaRegen);
  }
  f._rangerOffensive = false;
  f._rangerCrit = false;
}

export function gainCorpse(f) {
  const cap = CONFIG.identity?.necro?.corpseCap ?? 1;
  if (f.run.classId !== 'necromancer') return;
  if ((f.corpses || 0) >= cap) return;
  f.corpses = (f.corpses || 0) + 1;
  f.log('A corpse is yours to spend.', 'log-ally');
}

export function consumeStanceIgnore(f) {
  if (f.player.ironStance?.strikes > 0) {
    f.player.ironStance.strikes--;
    if (f.player.ironStance.strikes <= 0) delete f.player.ironStance;
    return true;
  }
  if (f.player.scriptedEdge) {
    f.player.scriptedEdge = false;
    return true;
  }
  return false;
}

export function notePlayerHpLoss(f, dmg) {
  f.damageTaken = (f.damageTaken || 0) + dmg;
  f._taken?.(dmg);
  if (f.d().chargeOnHit) gainCharge(f, 1);
  const rate = CONFIG.identity?.viking?.furyPerDamage ?? 0.25;
  gainFury(f, Math.max(1, Math.round(dmg * rate)));
}

export function cleanseBoss(f, e) {
  if (e.statuses.tormented) {
    delete e.statuses.tormented;
    f.log(`${e.name} tries to slough the fight off — torment holds the spite back.`, 'log-ally');
    f.renderEnemies?.();
    return;
  }
  delete e.statuses.poison; delete e.statuses.burn; delete e.statuses.frozen;
  delete e.statuses.stunned; delete e.statuses.hexed;
  delete e.statuses.frail; delete e.statuses.weaken; delete e.statuses.lazy;
  delete e.statuses.confused; delete e.statuses.paralyzed; delete e.statuses.marked;
  f.log(`${e.name} draws a breath of pure spite — every affliction sloughs away.`, 'log-foe');
  f.renderEnemies?.();
}

export function resolveBossAntiCC(f, e, ops = null) {
  if (!e.boss) return null;
  const every = e.cleanseEvery ?? CONFIG.boss.cleanseEvery;
  const cost = e.cleanseCost ?? CONFIG.boss.cleanseCost;

  if (hasHardCC(e.statuses) && cost > 0 && (e.charge || 0) >= cost) {
    e.charge -= cost;
    delete e.statuses.frozen;
    delete e.statuses.stunned;
    f.log(`${e.name} burns ${cost} Battle Charge and tears free of the binding!`, 'log-foe');
    ops?.push({ type: 'echarge', uid: e.uid, charge: e.charge });
    ops?.push({ type: 'breakcc', uid: e.uid, cost });
    f.renderEnemies?.();
    return 'broke';
  }

  if (e.turnCount > 0 && e.turnCount % every === 0 && (hasDebuff(e.statuses) || e.statuses.tormented)) {
    const blocked = !!e.statuses.tormented;
    cleanseBoss(f, e);
    ops?.push({ type: 'cleanse', uid: e.uid, blocked });
    return 'cleansed';
  }
  return null;
}

export function resolveEnemySpecial(f, e, special) {
  if (special && !f.shared && f.run.combatTaunt && (CONFIG.boss?.tauntSuppressSpecial ?? true)
      && !(e.boss && f.rng.chance(CONFIG.boss?.ignoreTauntChance ?? 0))) {
    f.log(`${e.name} loses the wind-up to your taunt and swings wild.`, 'log-ally');
    special = null;
  }
  if (special) {
    if (/wolf/i.test(e.id || e.name || '')) {
      for (const ally of f.aliveEnemies()) {
        if (ally !== e && /wolf/i.test(ally.id || ally.name || '')) ally.packHowl = true;
      }
    }
    if (special.selfShield) {
      e.statuses.shield = { mult: special.selfShield, turns: CONFIG.defense.wardTurns };
      f.log(`${e.name} braces — a shield wall holds.`, 'log-foe');
    }
    if (special.selfDef) {
      e.def = Math.round(e.def + special.selfDef);
      f.log(`${e.name} hardens.`, 'log-foe');
    }
  }
  if (e.packHowl && !special) {
    e.packHowl = false;
    e._howlFrail = true;
    f.log(`${e.name} answers the pack howl — the next bite finds a weak spot!`, 'log-foe');
  }
  return special;
}

export function applyStatusRiders(f, r) {
  if (!r || !Object.keys(r).length) return;
  const st = f.player.statuses;
  if (r.poison && !f.rng.chance(f.d().poisonResist)) { st.poison = r.poison; f.log('You are poisoned!', 'log-foe'); }
  if (r.burn) { st.burn = r.burn; f.log('You are set ablaze!', 'log-foe'); }
  if (r.freeze) { st.frozen = 1; f.log('You are frozen!', 'log-foe'); }
  if (r.weaken) { st.weaken = r.weaken; f.log('You feel weakened!', 'log-foe'); }
  if (r.hexed) { st.hexed = r.hexed; f.log('A hex settles on you!', 'log-foe'); }
  if (r.frail) { st.frail = r.frail; f.log('You feel frail!', 'log-foe'); }
  if (r.tormented) { st.tormented = r.tormented; f.log('Torment claws at you!', 'log-foe'); }
  if (r.confused) { st.confused = r.confused; f.log('Your thoughts tangle!', 'log-foe'); }
  if (r.lazy) { st.lazy = r.lazy; f.log('Your limbs grow heavy!', 'log-foe'); }
  if (r.paralyze) { st.paralyzed = r.paralyze; f.log('Your nerves seize — paralysis!', 'log-foe'); }
}

export function deathSaves(f) {
  if (gearHas(f.run, 'revive') && !f.run.usedRevive) {
    f.run.usedRevive = true;
    f.run.hp = Math.round(f.run.maxHp * CONFIG.death.reviveHpPct);
    f.log('The Phoenix Feather ignites — you rise from the ashes!', 'log-sys');
    return;
  }
  if (gearHas(f.run, 'deathward') && !f.usedDeathward) {
    f.usedDeathward = true;
    f.run.hp = 1;
    f.log('The Cracked Hourglass shatters — time stumbles, and you are spared. Barely.', 'log-sys');
  }
}

export function applyEnrage(f) {
  for (const e of f.aliveEnemies()) {
    if (e._enraged) continue;
    const at = e.enrageAtRound
      ?? (e.boss ? TDC.enrage?.bossAtRound : null)
      ?? ((e.elite && !e.boss) ? TDC.enrage?.eventAtRound : null);
    if (at == null || f.round < at) continue;
    const mult = e.boss
      ? (TDC.enrage?.bossAtkMult || 1.25)
      : (TDC.enrage?.eventAtkMult || 1.25);
    e.atk = Math.round((e.baseAtk || e.atk) * mult);
    e._enraged = true;
    f.log?.(`${e.name} enrages!`, 'log-bad');
  }
}

export function bossPhaseChecksSolo(f, e, ops = null) {
  if (e.heads) {
    const pct = e.hp / e.maxHp;
    for (const threshold of [0.6, 0.3]) {
      if (pct <= threshold && !e.phaseTriggers.includes(threshold)) {
        e.phaseTriggers.push(threshold);
        e.atk = Math.round(e.atk * 1.2);
        e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * 0.1));
        const text = 'A severed head regrows — angrier. The Hydra swells with grief.';
        f.log(text, 'log-foe');
        ops?.push({ type: 'phase', uid: e.uid, atk: e.atk, hpAfter: e.hp, text });
        f.renderEnemies?.();
      }
    }
  }
  if (e.phases && e.hp / e.maxHp <= 0.5 && !e.phaseTriggers.includes('enrage')) {
    e.phaseTriggers.push('enrage');
    e.atk = Math.round(e.atk * 1.3);
    e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * 0.12));
    if (e.chargeOnPhase) e.charge = addCharge(e.charge || 0, e.chargeOnPhase);
    if (e.phaseArt) e.artId = e.phaseArt;
    if (e.phaseName) e.name = e.phaseName;
    if (e.phaseGlyph) e.glyph = e.phaseGlyph;
    if (e.phaseSpecials) e.specials = e.phaseSpecials;
    const evolve = e.phaseArt ? (e.phaseText || `${e.name} evolves into something worse.`) : `${e.name}: "${e.taunt}"`;
    f.log(evolve, 'log-sys');
    if (!e.phaseArt) f.log('Stops holding back.', 'log-foe');
    ops?.push({
      type: 'phase', uid: e.uid, atk: e.atk, hpAfter: e.hp, charge: e.charge,
      artId: e.artId, name: e.name, glyph: e.glyph, specials: e.specials, text: evolve,
    });
    f.renderEnemies?.(); f.renderPlayers?.();
  }
}

export function transformBoss(f, e) {
  const p2 = e.phase2 || {};
  const m = e._m || { hp: 1, atk: 1, def: 1, spd: 1 };
  e.artId = p2.artId ?? e.artId;
  e.name = p2.name ?? e.name;
  e.glyph = p2.glyph ?? e.glyph;
  if (p2.atk != null) e.atk = Math.round(p2.atk * m.atk);
  if (p2.def != null) e.def = Math.round(p2.def * m.def);
  if (p2.spd != null) e.spd = Math.max(1, Math.round(p2.spd * m.spd));
  e.maxHp = p2.hp != null ? Math.round(p2.hp * m.hp) : e.maxHp;
  e.hp = e.maxHp;
  e.specials = p2.specials ?? e.specials;
  e.chargeGain = p2.chargeGain ?? e.chargeGain;
  e.chargeOnPhase = p2.chargeOnPhase;
  e.cleanseCost = p2.cleanseCost ?? e.cleanseCost;
  e.phases = !!p2.phases;
  e.taunt = p2.taunt ?? e.taunt;
  if (p2.bankChance != null) e.bankChance = p2.bankChance;
  e.charge = 0; e.statuses = {}; e.phaseTriggers = [];
  e.twoPhase = false; e.phase = 2;
  const oe = f.order.find(o => o.key === e.uid);
  if (oe) { oe.name = e.name; oe.glyph = e.glyph; oe.spdStat = e.spd; }
  return p2.transformText || `${e.name} rises!`;
}

export function maybeTransform(f) {
  const e = f.enemies.find(x => x.twoPhase && x.phase2 && x.hp <= 0);
  if (!e) return false;
  const text = transformBoss(f, e);
  f.log(text, 'log-sys');
  const idx = f.enemies.findIndex(x => x.hp > 0);
  if (idx >= 0) f.target = idx;
  f.renderEnemies?.();
  f.renderTurnOrder?.();
  return true;
}

export function combatantEntries(f) {
  const d = f.d();
  return [
    {
      key: 'player', name: f.run.name, glyph: null,
      spdStat: Math.round(4 + d.dex * 0.3),
      mod: d.initiative + (f.mod.enemyFirst ? -100 : 0)
        + initiativePenaltyFromStatuses(f.player.statuses),
      isPlayer: true, stableId: 'p-me',
    },
    ...f.aliveEnemies().map(e => ({
      key: e.uid, name: e.name, glyph: null, spdStat: e.spd,
      mod: initiativePenaltyFromStatuses(e.statuses),
      isPlayer: false, stableId: e.uid,
    })),
  ];
}

export function rollRoundInitiativeSolo(f) {
  f._actingKey = null;
  f.order = initiativeOrder(f.rng, combatantEntries(f), f.run.floor);
  f.renderTurnOrder?.();
}

export function resolvePlayerHit(f, e, sk, d) {
  const statVal = skillStatValue(sk, d);
  const buff = buffValue(f, 'str');
  const C = CONFIG.combat;
  let base = (statVal * C.playerStatWeight + d.atk * C.playerAtkWeight + softLevelDamage(f.run.level, C.playerLevelWeight) + C.playerFlat)
    * (skillEffectivePower(sk) / 100) * buff.mult;
  let critChance = d.crit + (sk.critBonus || 0);
  const isCrit = f.rng.chance(clamp(critChance, 0, 85) / 100);
  let dmg = base * (0.85 + f.rng.next() * 0.3);
  if (isCrit) {
    dmg *= (C.critMult ?? 1.45);
    gainCharge(f, CONFIG.charge.gainOnCrit);
    if (f.run.classId === 'archer') {
      f._rangerCrit = true;
      const refund = Math.round((sk.cost || 0) * (CONFIG.identity?.archer?.critRefund ?? 0.4));
      if (refund > 0) restoreMana(f.run, refund);
    }
  }
  dmg *= d.dmgMult * (f.mod.dmgMult || 1) * partyBuffMult(f, 'dmg');
  dmg *= statusOutgoingMult(f.player.statuses);
  dmg *= partyOutgoingDmgMult(f.partySize());
  if (e.boss) dmg *= d.bossDmgMult;
  if (e.statuses.hexed) dmg *= C.hexTakenMult;
  if (f.run.classId === 'archer' && e.statuses.marked) dmg *= (C.markTakenMult ?? 1.2);
  const notes = [];
  if (sk.consumeFrail && e.statuses.frail) {
    dmg *= (C.frailDetonateMult ?? 1.4);
    delete e.statuses.frail;
    const line = `${sk.name} detonates the frail mark on ${e.name}!`;
    notes.push(line);
    f.log(line, 'log-ally');
  }
  if (f._corpseSpent && sk.corpsePower) dmg *= sk.corpsePower;
  if (d.doubleDmgRound && f.round === d.doubleDmgRound) dmg *= 2;
  const stanceIgnore = !!f._stanceIgnore;
  const corpseIgnore = f._corpseSpent && !!sk.corpseIgnoreDef;
  const def = e.statuses.frail
    ? Math.round(e.def * (1 - (C.frailDefIgnore ?? 0.5)))
    : e.def;
  if (e.statuses.shield) dmg *= (1 - (e.statuses.shield.mult || 0));
  dmg = applyDefense(dmg, def, { ignoreDef: !!sk.ignoreDef || stanceIgnore || corpseIgnore });

  let exec = sk.execute || 0;
  if (e.statuses.frail) exec += (C.frailExecuteBonus ?? 0);
  if (sk.consumeMark && e.statuses.marked) {
    exec += (C.markExecuteBonus ?? 0.1);
    delete e.statuses.marked;
    notes.push('The mark is spent.');
    f.log('The mark is spent.', 'log-ally');
  }
  if (sk.consumeBurn && e.statuses.burn) {
    dmg *= 1.25;
    delete e.statuses.burn;
    const line = `${sk.name} drinks the fire off ${e.name}.`;
    notes.push(line);
    f.log(line, 'log-ally');
  }
  if (exec && !e.boss && e.hp / e.maxHp <= exec) {
    dmg = e.hp;
    const line = `${sk.name.toUpperCase()} — ${e.name} is slain outright!`;
    notes.push(line);
    f.log(line, 'log-ally');
  }

  const hpBefore = e.hp;
  e.hp = Math.max(0, e.hp - dmg);
  f._dealt?.(hpBefore - e.hp);
  f.log(`${sk.name} hits ${e.name} for ${dmg}${isCrit ? ' — CRITICAL!' : ''}`, isCrit ? 'log-ally' : 'log-ally');

  if (sk.healPct) {
    const amt = heal(f.run, f.run.maxHp * sk.healPct);
    if (amt > 0) f._healed?.(amt);
  }

  const newStatuses = {};
  const Cstat = CONFIG.combat;
  const burnCh = (sk.burn || 0) + d.burn;
  const freezeCh = (sk.freeze || 0) + d.freeze;
  const poisonCh = (sk.poison || 0) + (d.poison || 0);
  const weakenCh = (sk.weaken || 0) + (d.weaken || 0);
  const frailCh = (sk.frail || 0) + (d.frail || 0);
  if (e.hp > 0) {
    if (poisonCh && f.rng.chance(poisonCh)) {
      e.statuses.poison = Cstat.poisonTurns ?? 3; newStatuses.poison = e.statuses.poison;
      f.log(`${e.name} is poisoned.`, 'log-ally');
    }
    if (burnCh && f.rng.chance(burnCh)) {
      e.statuses.burn = Cstat.burnTurns ?? 2; newStatuses.burn = e.statuses.burn;
      f.log(`${e.name} catches fire.`, 'log-ally');
    }
    if (freezeCh && f.rng.chance(freezeCh)) { e.statuses.frozen = 1; newStatuses.frozen = 1; f.log(`${e.name} is frozen solid.`, 'log-ally'); }
    const stunCh = (sk.stun || 0) + (d.stun || 0);
    if (stunCh && f.rng.chance(stunCh)) {
      e.statuses.stunned = 1; newStatuses.stunned = 1; f.log(`${e.name} is stunned.`, 'log-ally');
      e.statuses.paralyzed = Cstat.paralyzeTurns ?? 2; newStatuses.paralyzed = e.statuses.paralyzed;
    }
    const paraCh = (sk.paralyze || 0) + (d.paralyze || 0);
    if (paraCh && f.rng.chance(paraCh)) {
      e.statuses.paralyzed = Cstat.paralyzeTurns ?? 2; newStatuses.paralyzed = e.statuses.paralyzed;
      f.log(`${e.name} is paralyzed.`, 'log-ally');
    }
    if (sk.hex && f.rng.chance(sk.hex)) { e.statuses.hexed = 3; newStatuses.hexed = 3; f.log(`${e.name} is hexed — it will suffer more.`, 'log-ally'); }
    if (sk.mark && f.rng.chance(sk.mark)) { e.statuses.marked = 3; newStatuses.marked = 3; f.log(`${e.name} is marked as quarry.`, 'log-ally'); }
    if (f._corpseSpent && sk.corpsePoisonSure) {
      e.statuses.poison = Cstat.poisonTurns ?? 3; newStatuses.poison = e.statuses.poison;
      f.log(`${e.name} is poisoned by the opened grave.`, 'log-ally');
    }
    if (weakenCh && f.rng.chance(Math.min(1, weakenCh))) { e.statuses.weaken = 3; newStatuses.weaken = 3; f.log(`${e.name} is weakened.`, 'log-ally'); }
    if (frailCh && f.rng.chance(Math.min(1, frailCh))) { e.statuses.frail = 3; newStatuses.frail = 3; f.log(`${e.name} is frail.`, 'log-ally'); }
    const tormentCh = (sk.tormented || 0) + (d.tormented || 0);
    if (tormentCh && f.rng.chance(Math.min(1, tormentCh))) { e.statuses.tormented = 3; newStatuses.tormented = 3; f.log(`${e.name} is tormented.`, 'log-ally'); }
    const confuseCh = (sk.confused || 0) + (d.confused || 0);
    if (confuseCh && f.rng.chance(confuseCh)) {
      e.statuses.confused = Cstat.confuseTurns ?? 2; newStatuses.confused = e.statuses.confused;
      f.log(`${e.name} is confused.`, 'log-ally');
    }
    const lazyCh = (sk.lazy || 0) + (d.lazy || 0);
    if (lazyCh && f.rng.chance(lazyCh)) { e.statuses.lazy = 2; newStatuses.lazy = 2; f.log(`${e.name} grows lazy.`, 'log-ally'); }
  } else {
    gainCharge(f, CONFIG.charge.gainOnKill);
    gainCorpse(f);
  }
  if (f.run.classId === 'warlock' && e.statuses.hexed && e.hp > 0) {
    const refund = CONFIG.identity?.warlock?.hexRefund ?? 4;
    if (refund) restoreMana(f.run, refund);
  }
  const ls = (sk.lifesteal || 0) + d.lifesteal;
  if (ls > 0) {
    const capped = Math.min(dmg * ls, f.run.maxHp * CONFIG.combat.lifestealCapPct * (d.lifestealCapMult || 1));
    heal(f.run, capped);
  }
  if (e.hp <= 0) f.log(`${e.name} is defeated!`, 'log-ally');

  return { uid: e.uid, dmg, crit: isCrit, hpAfter: e.hp, statuses: newStatuses, fx: sk.fx, notes };
}

export function applySelfSkill(f, sk, d) {
  if (sk.shield) {
    f.player.statuses.shield = { mult: sk.shield, turns: CONFIG.defense.wardTurns };
    f.log(`You raise a ward — ${Math.round(sk.shield * 100)}% damage blocked for ${CONFIG.defense.wardTurns} turns.`, 'log-ally');
    if (f.run.classId === 'spellsword') {
      f.player.scriptedEdge = true;
      f.log('The ward edges the next blade.', 'log-ally');
    }
  }
  if (sk.stanceStrikes) {
    f.player.ironStance = { strikes: sk.stanceStrikes };
    f.log(`Iron Stance: the next ${sk.stanceStrikes === 1 ? 'strike ignores' : `${sk.stanceStrikes} strikes ignore`} armor. You cannot Guard.`, 'log-ally');
  }
  if (sk.healPct) {
    heal(f.run, f.run.maxHp * sk.healPct);
  }
  for (const b of [sk.buff, sk.buff2].filter(Boolean)) {
    f.player.buffs.push({ ...b, turns: b.turns, label: b.stat === 'dodge' ? 'DODGE' : 'PWR' });
    f.log(`${sk.name}: you feel ${b.stat === 'dodge' ? 'untouchable' : 'stronger'}.`, 'log-ally');
  }
  if (sk.gainResource) restoreMana(f.run, sk.gainResource);
  if (sk.gainCharge) gainCharge(f, sk.gainCharge);
  if (sk.tauntTurns) {
    f.run.combatTaunt = sk.tauntTurns;
    f.log(`You make yourself impossible to ignore — enemies fix on YOU for ${sk.tauntTurns} turns.`, 'log-ally');
  }
  if (sk.partyBuff) {
    f.player.partyBuffs = f.player.partyBuffs || [];
    f.player.partyBuffs.push({ ...sk.partyBuff, turns: sk.partyBuff.turns });
    f.log(`${sk.name}: the party feels the ${sk.partyBuff.label || 'boost'}.`, 'log-ally');
  }
}

export function endPlayerAction(f) {
  classResourceTick(f);
  completePlayerTurn(f);
  f.onHud?.();
  if (f.shared) f._sharedTurnDone?.();
  else f._turnDone?.();
}

export async function resolveUseSkill(f, sk, cost) {
  if (skillCooldownTurns(sk) > 0 && cooldownRemaining(f.skillCDs, sk.id) > 0) {
    f.locked = false;
    return { kind: 'blocked', reason: 'cooldown' };
  }
  f.locked = true;
  f.run.mp -= cost;
  if (sk.charge) {
    f.charge = Math.max(0, f.charge - sk.charge);
    f.renderCharge?.();
    if (sk.charge >= 6) f.usedUltimate = true;
  }
  startSkillCooldown(f, sk);
  f._skillUseLog = f._skillUseLog || [];
  f._skillUseLog.push(sk.id);
  if (sk.selfHpCost) {
    const paid = Math.round(f.run.maxHp * sk.selfHpCost);
    f.run.hp = Math.max(1, f.run.hp - paid);
    const rate = CONFIG.identity?.viking?.furyPerSelfCost ?? 0.5;
    gainFury(f, Math.max(2, Math.round(paid * rate)));
  }
  f._corpseSpent = false;
  if (sk.corpseSpend && (f.corpses || 0) > 0) {
    f.corpses--;
    f._corpseSpent = true;
    f.log('A corpse answers you.', 'log-ally');
  }
  if (sk.power && sk.target !== 'self' && f.run.classId === 'archer') {
    f._rangerOffensive = true;
  }
  const d = f.d();

  if (sk.guard) {
    if (f.player.ironStance) {
      f.log('Iron Stance holds you rooted — you cannot Guard.', 'log-sys');
      f.run.mp += cost;
      f.locked = false;
      f.renderActions?.(true);
      return { kind: 'guard-blocked' };
    }
    f.player.guarding = true;
    f.run.guardCount = (f.run.guardCount || 0) + 1;
    gainCharge(f, CONFIG.guard.chargeGain);
    f.log('You brace behind your guard.', 'log-ally');
    f.renderPlayers?.(f._actingKey);
    endPlayerAction(f);
    return { kind: 'guard' };
  }

  if (f.player.statuses.confused && sk.power && sk.target !== 'self' && !sk.guard) {
    const C = CONFIG.combat;
    if (!f.shared && f.rng.chance(C.confuseSoloWhiffChance ?? 0.4)) {
      f.log('Confusion takes the wheel — you swing at phantoms and hit nothing!', 'log-foe');
      f.renderPlayers?.();
      endPlayerAction(f);
      return { kind: 'whiff' };
    }
  }

  const targets = sk.target === 'all' ? f.aliveEnemies()
    : sk.target === 'self' ? []
    : [f.enemies[f.target]].filter(e => e && e.hp > 0);

  f._stanceIgnore = (sk.power && sk.target !== 'self') ? consumeStanceIgnore(f) : false;
  const hits = [];
  if (sk.target === 'self') {
    applySelfSkill(f, sk, d);
  } else {
    for (const e of targets) {
      hits.push(resolvePlayerHit(f, e, sk, d));
    }
  }
  f.renderEnemies?.();
  f.renderPlayers?.(f._actingKey);
  endPlayerAction(f);
  return { kind: 'skill', hits };
}

export function resolveUseConsumable(f, c) {
  f.locked = true;
  const idx = f.run.consumables.indexOf(c.id);
  if (idx === -1) return;
  f.run.consumables.splice(idx, 1);
  const cv = consumableCombatValue(c, f.run.floor);
  if (cv.heal) heal(f.run, cv.heal);
  if (cv.healPct) heal(f.run, Math.round(f.run.maxHp * cv.healPct));
  if (c.mana) restoreMana(f.run, c.mana);
  if (c.fame) changeFame(f.run, c.fame);
  if (c.foodBuff) f.run.foodBuff = { ...c.foodBuff, floorsLeft: c.foodBuff.floors || 3 };
  if (c.cure) { f.player.statuses = {}; f.log('Ailments cured.', 'log-ally'); }
  if (cv.bombDmg) {
    for (const e of f.aliveEnemies()) {
      e.hp = Math.max(0, e.hp - cv.bombDmg);
    }
    f.log('The bomb detonates!', 'log-sys');
  }
  f.log(`Used ${c.name}.`, 'log-ally');
  f.renderEnemies?.();
  f.renderPlayers?.(f._actingKey);
}

export function resolveEnemyConfusedStrike(f, e) {
  const others = f.aliveEnemies().filter(x => x.uid !== e.uid);
  if (!others.length) return false;
  const victim = f.rng.pick(others);
  f.log(`${e.name} is bewildered and turns on ${victim.name}!`, 'log-ally');
  let dmg = applyDefense(
    e.atk * CONFIG.combat.enemyAtkMult * (0.85 + f.rng.next() * 0.3),
    victim.def,
  );
  victim.hp = Math.max(0, victim.hp - dmg);
  if (victim.hp <= 0) f.log(`${victim.name} is cut down by its own ally!`, 'log-foe');
  return true;
}

/** Shared solo/host prelude. Returns { done } or { special, chargeScale }. */
export function resolveEnemyTurnStart(f, e, ops = null) {
  f.setActing?.(e.uid);
  e.turnCount++;
  e.charge = tickEnemyCharge(e, f.mod.chargeMult || 1);
  f.renderEnemies?.();
  ops?.push({ type: 'echarge', uid: e.uid, charge: e.charge });

  resolveBossAntiCC(f, e, ops);

  if (e.summons && e.turnCount % 3 === 0 && f.enemies.filter(x => x.hp > 0).length < 3) {
    const minion = spawnSummon(f, e);
    f.log(`${e.name} drags a servant up from the dust!`, 'log-foe');
    f.renderEnemies?.();
    f.renderTurnOrder?.();
    ops?.push({ type: 'summon', spec: { ...minion, statuses: {}, spawnIn: true, summon: true } });
    return { done: true, reason: 'summon' };
  }
  bossPhaseChecksSolo(f, e, ops);

  if (e.statuses.frozen || e.statuses.stunned || e.statuses.lazy) {
    const why = e.statuses.frozen ? 'frozen' : e.statuses.stunned ? 'stunned' : 'lazy';
    f.log(`${e.name} is ${why} — it cannot act.`, 'log-foe');
    delete e.statuses.frozen; delete e.statuses.stunned;
    delete e.statuses.lazy;
    f.renderEnemies?.();
    ops?.push({ type: 'skip', uid: e.uid, why });
    return { done: true, reason: 'cc' };
  }

  if (e.statuses.confused) {
    delete e.statuses.confused;
    if (f.aliveEnemies().length > 1) {
      if (resolveEnemyConfusedStrike(f, e)) {
        ops?.push({ type: 'confused', uid: e.uid });
        return { done: true, reason: 'confused' };
      }
    }
    f.log(`${e.name} is confused — it flails and hits nothing.`, 'log-foe');
    f.renderEnemies?.();
    ops?.push({ type: 'skip', uid: e.uid, why: 'confused' });
    return { done: true, reason: 'confused-whiff' };
  }

  const special = resolveEnemySpecial(f, e, pickEnemySpecial(e, f.rng));
  let chargeScale = 1;
  if (special) {
    if (e.boss) {
      const spent = specialChargeCost(special);
      const banked = f.shared
        ? spent
        : soloBossChargeForScale(f.run.floor, spent);
      chargeScale = bossChargeDamageScale(banked, special);
      if (!f.shared) chargeScale *= soloBossSpecialDmgMult(f.run.floor, special);
    }
    spendEnemySpecialCharge(e, special);
    const maxAt = (e.specials || []).reduce((m, s) => Math.max(m, s.at || 0), 0);
    const signature = special.at >= maxAt && maxAt > 0;
    const scream = !f.shared && e.boss && signature && chargeScale > 1.2
      ? ' The air screams with pent-up force.' : '';
    f.log(`${e.name} unleashes ${special.name}!${scream}`, 'log-foe');
    ops?.push({ type: 'echarge', uid: e.uid, charge: e.charge || 0 });
  }
  return { done: false, special, chargeScale };
}

export function resolveEnemyTurn(f, e) {
  const start = resolveEnemyTurnStart(f, e);
  if (start.done) return;

  const dConf = f.d();
  if (dConf.confuseChance && f.aliveEnemies().length > 1 && f.rng.chance(dConf.confuseChance)) {
    if (resolveEnemyConfusedStrike(f, e)) return;
  }

  const { special, chargeScale } = start;

  const d = f.d();
  const dodgeBuff = buffValue(f, 'dodge');
  const dodgeCh = clamp(d.dodge + dodgeBuff.add, 0, 80);
  if (!special && f.rng.chance(dodgeCh / 100)) {
    f.log(`${e.name} attacks — you evade!`, 'log-ally');
    return;
  }

  let dmg = e.atk * CONFIG.combat.enemyAtkMult * (0.85 + f.rng.next() * 0.3) * (f.mod.dmgMult || 1) * (special?.mult || 1) * chargeScale;
  dmg *= statusOutgoingMult(e.statuses);
  if (f.rng.chance(d.enemyCrit / 100)) dmg *= 1.5;
  {
    const pay = enemySpecialPayoff(special, f.player.statuses, f.run.hp / f.run.maxHp);
    dmg *= pay.mult;
    if (pay.consume) delete f.player.statuses[pay.consume];
    const line = enemyPayoffLine(e.name, pay);
    if (line) f.log(line, 'log-foe');
  }
  dmg = applyDefense(dmg, d.def);
  if (e.caster && !special && e.turnCount % 2 === 0) { dmg *= 1.4; f.log(`${e.name} channels a darker spell!`, 'log-foe'); }
  const shield = f.player.statuses.shield;
  if (shield) dmg *= (1 - shield.mult);
  dmg = applyGuard(Math.max(1, Math.round(dmg * d.dmgTakenMult * partyBuffMult(f, 'dr'))), f.player.guarding);
  dmg = applyPlayerFrail(f, dmg);

  f.run.hp = Math.max(0, f.run.hp - dmg);
  notePlayerHpLoss(f, dmg);
  f.log(`${e.name}${special ? ` (${special.name})` : ''} hits you for ${dmg}${f.player.guarding ? ' (guarded)' : ''}.`, 'log-foe');

  if (d.thorns && e.hp > 0 && dmg > 0) {
    const back = Math.max(1, Math.round(dmg * d.thorns));
    e.hp = Math.max(0, e.hp - back);
    f.log(`Thorns bite back — ${e.name} takes ${back}.`, 'log-ally');
    if (e.hp <= 0) f.log(`${e.name} is defeated by its own violence!`, 'log-ally');
  }

  if (e.lifesteal || special?.heal) {
    e.hp = Math.min(e.maxHp, e.hp + Math.round(dmg * (e.lifesteal || 0)) + Math.round(e.maxHp * (special?.heal || 0)));
    f.log(`${e.name} drinks deep.`, 'log-foe');
  }
  applyStatusRiders(f, collectEnemyRiders(e, special, f.rng));

  if (f.run.hp <= 0) deathSaves(f);

  f.renderPlayers?.();
  f.renderEnemies?.();
}

export function tickEnemyStatuses(f, ops = null) {
  const C = CONFIG.combat;
  for (const e of f.aliveEnemies()) {
    if (e.statuses.poison) {
      const frailExtra = e.statuses.frail ? (CONFIG.identity?.packPoisonFrailMult ?? 1.5) : 1;
      const dmg = Math.max(2, Math.round(e.maxHp * (C.poisonPctOnEnemy ?? 0.1) * frailExtra));
      e.hp = Math.max(0, e.hp - dmg);
      f.float?.(f.sprite?.(e.uid)?.parentElement, `${dmg}`, 'dmg');
      f.log(`${e.name} suffers ${dmg} poison damage${frailExtra > 1 ? ' (the frail flesh drinks it)' : ''}.`);
      e.statuses.poison--;
      if (e.statuses.poison <= 0) delete e.statuses.poison;
      ops?.push({ type: 'edot', uid: e.uid, dmg, hpAfter: e.hp, kind: 'poison' });
    }
    if (e.statuses.tormented) {
      const dmg = Math.max(2, Math.round(e.maxHp * (C.tormentPctOnEnemy ?? 0.04)));
      e.hp = Math.max(0, e.hp - dmg);
      f.float?.(f.sprite?.(e.uid)?.parentElement, `${dmg}`, 'dmg');
      f.log(`${e.name} writhes for ${dmg} torment.`);
      ops?.push({ type: 'edot', uid: e.uid, dmg, hpAfter: e.hp, kind: 'torment' });
    }
    if (e.statuses.burn) {
      const dmg = Math.max(2, Math.round(e.maxHp * (C.burnPctOnEnemy ?? 0.055)));
      e.hp = Math.max(0, e.hp - dmg);
      f.float?.(f.sprite?.(e.uid)?.parentElement, `${dmg}`, 'dmg');
      f.log(`${e.name} burns for ${dmg}.`);
      e.statuses.burn--;
      if (e.statuses.burn <= 0) delete e.statuses.burn;
      ops?.push({ type: 'edot', uid: e.uid, dmg, hpAfter: e.hp, kind: 'burn' });
    }
    if (e.statuses.hexed) { e.statuses.hexed--; if (e.statuses.hexed <= 0) delete e.statuses.hexed; }
    if (e.statuses.marked) { e.statuses.marked--; if (e.statuses.marked <= 0) delete e.statuses.marked; }
    if (e.statuses.shield) { e.statuses.shield.turns--; if (e.statuses.shield.turns <= 0) delete e.statuses.shield; }
    for (const k of ['weaken', 'frail', 'tormented', 'lazy', 'paralyzed', 'confused']) {
      if (e.statuses[k]) { e.statuses[k]--; if (e.statuses[k] <= 0) delete e.statuses[k]; }
    }
    if (e.regen && e.hp > 0 && e.hp < e.maxHp) {
      const amt = Math.round(e.maxHp * e.regen);
      e.hp = Math.min(e.maxHp, e.hp + amt);
      f.log(`${e.name} regenerates ${amt}.`, 'log-foe');
      ops?.push({ type: 'eregen', uid: e.uid, amt, hpAfter: e.hp });
    }
  }
  f.renderEnemies?.();
}

function markDown(f) {
  if (f.goDown) f.goDown();
  else f.run.down = true;
}

export function upkeep(f) {
  if (!f.shared) tickEnemyStatuses(f);
  const st = f.player.statuses;
  const C = CONFIG.combat;
  if (st.poison && f.run.hp > 0) {
    const dmg = Math.max(2, Math.round(f.run.maxHp * (C.poisonPctOnPlayer ?? 0.08)));
    f.run.hp = Math.max(0, f.run.hp - dmg);
    f._taken?.(dmg);
    f.float?.(f.playerFloatHost?.(), `-${dmg}`, 'incoming');
    f.log(`Poison courses through you for ${dmg}.`, 'log-foe');
    st.poison--; if (st.poison <= 0) delete st.poison;
    if (f.run.hp <= 0) { deathSaves(f); if (f.shared && f.run.hp <= 0) markDown(f); }
  }
  if (st.burn && f.run.hp > 0) {
    const dmg = Math.max(3, Math.round(f.run.maxHp * (C.burnPctOnPlayer ?? 0.06)));
    f.run.hp = Math.max(0, f.run.hp - dmg);
    f._taken?.(dmg);
    f.float?.(f.playerFloatHost?.(), `-${dmg}`, 'incoming');
    f.log(`You burn for ${dmg}.`, 'log-foe');
    st.burn--; if (st.burn <= 0) delete st.burn;
    if (f.run.hp <= 0) { deathSaves(f); if (f.shared && f.run.hp <= 0) markDown(f); }
  }
  if (st.tormented && f.run.hp > 0) {
    const dmg = Math.max(2, Math.round(f.run.maxHp * (C.tormentPctOnPlayer ?? 0.04)));
    f.run.hp = Math.max(0, f.run.hp - dmg);
    f._taken?.(dmg);
    f.float?.(f.playerFloatHost?.(), `-${dmg}`, 'incoming');
    f.log(`Torment claws you for ${dmg}.`, 'log-foe');
    if (f.run.hp <= 0) { deathSaves(f); if (f.shared && f.run.hp <= 0) markDown(f); }
  }
  if (st.shield) { st.shield.turns--; if (st.shield.turns <= 0) delete st.shield; }
  if (st.hexed) { st.hexed--; if (st.hexed <= 0) delete st.hexed; }
  for (const k of ['weaken', 'frail', 'tormented', 'lazy', 'confused', 'paralyzed']) {
    if (st[k]) { st[k]--; if (st[k] <= 0) delete st[k]; }
  }
  if (f.run.combatTaunt) {
    f.run.combatTaunt--;
    if (f.run.combatTaunt <= 0) {
      delete f.run.combatTaunt;
      f.log('Enemies stop rising to your bait.', 'log-sys');
    }
  }
  f.player.buffs = f.player.buffs.filter(b => --b.turns > 0);
  f.player.partyBuffs = (f.player.partyBuffs || []).filter(b => --b.turns > 0);
  if (f.mod.hpDrainPct && !f.run.down && f.run.hp > 0) {
    const drain = Math.max(1, Math.round(f.run.maxHp * f.mod.hpDrainPct));
    f.run.hp = Math.max(0, f.run.hp - drain);
    f.log(`The floor drinks ${drain} of your blood.`, 'log-foe');
    if (f.run.hp <= 0) { deathSaves(f); if (f.shared && f.run.hp <= 0) markDown(f); }
  }
  f.renderPlayers?.(f._actingKey);
}

export function beginPlayerTurn(f) {
  f.player.guarding = false;
  preparePlayerTurnStart(f);
  const st = f.player.statuses;
  if (st.frozen || st.stunned || st.lazy) {
    const why = st.frozen ? 'frozen solid' : st.stunned ? 'stunned' : 'too lazy to act';
    f.log(`You are ${why} — turn lost!`, 'log-foe');
    delete st.frozen; delete st.stunned; delete st.lazy;
    classResourceTick(f);
    completePlayerTurn(f);
    f.renderPlayers?.();
    return { skipped: true, why };
  }
  if (st.confused) f.log('Your thoughts tangle — choose carefully. Attacks may go astray.', 'log-foe');
  if (st.paralyzed) f.log('Paralysis weighs on you — you will act later in the round.', 'log-foe');
  return { skipped: false };
}

export function snapshotCombat(f) {
  return {
    round: f.round || 0,
    ended: !!f.ended,
    outcome: f._outcome || null,
    charge: f.charge,
    skillCDs: { ...(f.skillCDs || {}) },
    turnPrepared: !!f._turnPrepared,
    corpses: f.corpses || 0,
    usedDeathward: !!f.usedDeathward,
    usedUltimate: !!f.usedUltimate,
    damageTaken: f.damageTaken || 0,
    target: f.target,
    actingKey: f._actingKey || null,
    order: (f.order || []).map(o => ({
      key: o.key, isPlayer: !!o.isPlayer, stableId: o.stableId, init: o.init ?? null, spdStat: o.spdStat,
    })),
    player: {
      hp: f.run.hp,
      maxHp: f.run.maxHp,
      mp: f.run.mp,
      maxMp: f.run.maxMp,
      down: !!f.run.down,
      combatTaunt: f.run.combatTaunt || 0,
      usedRevive: !!f.run.usedRevive,
      guardCount: f.run.guardCount || 0,
      statuses: { ...(f.player?.statuses || {}) },
      buffs: (f.player?.buffs || []).map(b => ({ ...b })),
      partyBuffs: (f.player?.partyBuffs || []).map(b => ({ ...b })),
      guarding: !!f.player?.guarding,
      ironStance: f.player?.ironStance ? { ...f.player.ironStance } : null,
      scriptedEdge: !!f.player?.scriptedEdge,
    },
    enemies: f.enemies.map(e => ({
      uid: e.uid, id: e.id, name: e.name, hp: e.hp, maxHp: e.maxHp, atk: e.atk, def: e.def,
      spd: e.spd, charge: e.charge || 0, turnCount: e.turnCount || 0,
      statuses: { ...(e.statuses || {}) },
      phaseTriggers: [...(e.phaseTriggers || [])],
      phase: e.phase || 1,
      twoPhase: !!e.twoPhase,
      _enraged: !!e._enraged,
      summon: !!e.summon,
    })),
    logs: [...(f.logs || [])],
  };
}

export function applyCombatSnapshot(f, snap) {
  if (!f || !snap) return f;
  if (snap.charge != null) f.charge = snap.charge;
  if (snap.skillCDs && typeof snap.skillCDs === 'object') f.skillCDs = { ...snap.skillCDs };
  if (snap.turnPrepared != null) f._turnPrepared = !!snap.turnPrepared;
  if (snap.corpses != null) f.corpses = snap.corpses;
  if (snap.round != null) f.round = snap.round;
  if (snap.usedDeathward != null) f.usedDeathward = !!snap.usedDeathward;
  if (snap.usedUltimate != null) f.usedUltimate = !!snap.usedUltimate;
  if (snap.damageTaken != null) f.damageTaken = snap.damageTaken;
  if (snap.target != null) f.target = snap.target;
  if (snap.actingKey != null) f._actingKey = snap.actingKey;
  if (snap.player) {
    const p = snap.player;
    if (p.hp != null) f.run.hp = p.hp;
    if (p.mp != null) f.run.mp = p.mp;
    if (p.down != null) f.run.down = !!p.down;
    if (p.combatTaunt != null) f.run.combatTaunt = p.combatTaunt;
    if (p.usedRevive != null) f.run.usedRevive = !!p.usedRevive;
    if (p.guardCount != null) f.run.guardCount = p.guardCount;
    if (p.statuses) f.player.statuses = { ...p.statuses };
    if (p.buffs) f.player.buffs = p.buffs.map(b => ({ ...b }));
    if (p.partyBuffs) f.player.partyBuffs = p.partyBuffs.map(b => ({ ...b }));
    if (p.guarding != null) f.player.guarding = !!p.guarding;
    if (p.ironStance) f.player.ironStance = { ...p.ironStance };
    else if (p.ironStance === null) delete f.player.ironStance;
    if (p.scriptedEdge != null) f.player.scriptedEdge = !!p.scriptedEdge;
  }
  if (Array.isArray(snap.enemies)) {
    for (const s of snap.enemies) {
      const e = f.enemies.find(x => x.uid === s.uid);
      if (!e) continue;
      if (s.hp != null) e.hp = s.hp;
      if (s.charge != null) e.charge = s.charge;
      if (s.turnCount != null) e.turnCount = s.turnCount;
      if (s.statuses) e.statuses = { ...s.statuses };
      if (s.phaseTriggers) e.phaseTriggers = [...s.phaseTriggers];
      if (s.phase != null) e.phase = s.phase;
      if (s._enraged != null) e._enraged = !!s._enraged;
    }
  }
  return f;
}

export function bindCoreMethods(f) {
  f.d = f.d || (() => derived(f.run));
  f.partySize = f.partySize || (() => 1);
  f.aliveEnemies = f.aliveEnemies || (() => f.enemies.filter(e => e.hp > 0));
  f.enemyByUid = f.enemyByUid || (uid => f.enemies.find(e => e.uid === uid));
  f.log = f.log || ((msg, cls = '') => { f.logs = f.logs || []; f.logs.push({ msg, cls }); });
  f.setActing = f.setActing || (key => { f._actingKey = key ?? null; });
  f.renderEnemies = f.renderEnemies || (() => {
    if (f.enemies[f.target]?.hp <= 0) {
      const next = f.enemies.findIndex(e => e.hp > 0);
      if (next >= 0) f.target = next;
    }
  });
  f.hitEnemy = (e, sk, d) => resolvePlayerHit(f, e, sk, d);
  f.useSkill = (sk, cost) => resolveUseSkill(f, sk, cost);
  f.useConsumable = (c) => resolveUseConsumable(f, c);
  f.applySelfSkill = (sk, d) => applySelfSkill(f, sk, d);
  f.enemyTurn = async (e) => resolveEnemyTurn(f, e);
  f.upkeep = async () => upkeep(f);
  f.tickEnemyStatuses = async (ops) => tickEnemyStatuses(f, ops);
  f.deathSaves = () => deathSaves(f);
  f.classResourceTick = () => classResourceTick(f);
  f.gainFury = (n) => gainFury(f, n);
  f.gainCorpse = () => gainCorpse(f);
  f.gainCharge = (n) => gainCharge(f, n);
  f.cleanseBoss = (e) => cleanseBoss(f, e);
  f.resolveBossAntiCC = (e, ops) => resolveBossAntiCC(f, e, ops);
  f.bossPhaseChecksSolo = (e) => bossPhaseChecksSolo(f, e);
  f.maybeTransform = () => maybeTransform(f);
  f.applyEnrage = () => applyEnrage(f);
  f.rollRoundInitiative = async () => rollRoundInitiativeSolo(f);
  f.endPlayerAction = () => endPlayerAction(f);
  f.beginPlayerTurn = () => beginPlayerTurn(f);
  f.preparePlayerTurnStart = () => preparePlayerTurnStart(f);
  f.completePlayerTurn = () => completePlayerTurn(f);
  f.startSkillCooldown = (sk) => startSkillCooldown(f, sk);
  f.resetPlayerCooldowns = () => resetPlayerCooldowns(f);
  f.checkEndSolo = () => {
    if (f.run.hp <= 0) { f.ended = true; f._outcome = 'dead'; return true; }
    if (f.aliveEnemies().length === 0) {
      if (maybeTransform(f)) return false;
      f.ended = true; f._outcome = 'win'; return true;
    }
    return false;
  };
  return f;
}

export function applyCombatStartMana(run, { resume = false } = {}) {
  if (resume) return;
  const pct = CONFIG.recovery?.combatStartManaPct ?? 0;
  if (pct > 0) restoreMana(run, (run.maxMp || 0) * pct);
}

export function finishHeadlessSolo(f, result, extra = {}) {
  f.ended = true;
  f._outcome = result;
  delete f.run.combatTaunt;
  if (CONFIG.charge.resetAfterCombat) f.charge = 0;
  resetPlayerCooldowns(f);
  f.rng.advance?.();
  return {
    result,
    noDamage: !f.damageTaken,
    usedUltimate: !!f.usedUltimate,
    ...extra,
  };
}

export function createCombatContext(run, rng, enemies, modifier = null, opts = {}) {
  if (opts.startMana) applyCombatStartMana(run, { resume: opts.resume });
  const startCharge = clamp((run.metaStartCharge || 0) + derived(run).startCharge, 0, CONFIG.charge.max);
  const f = bindCoreMethods({
    headless: true,
    run,
    rng,
    enemies,
    mod: modifier || {},
    player: { statuses: {}, buffs: [], partyBuffs: [], guarding: false },
    charge: startCharge,
    skillCDs: {},
    _cdUsedThisTurn: {},
    _turnPrepared: false,
    corpses: 0,
    round: 0,
    target: 0,
    order: [],
    logs: [],
    ended: false,
    usedDeathward: false,
    usedUltimate: false,
    damageTaken: 0,
    _actingKey: null,
    shared: false,
    locked: false,
  });
  if (opts.snapshot) applyCombatSnapshot(f, opts.snapshot);
  return f;
}

export async function applyAction(f, action) {
  switch (action.type) {
    case 'hitEnemy': {
      const sk = SKILLS[action.skillId];
      if (action.enemy != null) f.target = action.enemy;
      const e = f.enemies[f.target];
      return resolvePlayerHit(f, e, sk, f.d());
    }
    case 'useSkill': {
      const sk = SKILLS[action.skillId];
      if (action.targetUid) {
        const i = f.enemies.findIndex(e => e.uid === action.targetUid);
        if (i >= 0) f.target = i;
      } else if (action.enemy != null) f.target = action.enemy;
      const cost = Math.round((sk.cost || 0) * (f.mod.costMult || 1));
      return resolveUseSkill(f, sk, cost);
    }
    case 'useConsumable': {
      const c = CONSUMABLES.find(x => x.id === action.itemId);
      return resolveUseConsumable(f, c);
    }
    case 'enemyTurn':
      return resolveEnemyTurn(f, f.enemies[action.enemy ?? 0]);
    case 'upkeep':
      return upkeep(f);
    case 'advanceRound':
      f.round++;
      applyEnrage(f);
      rollRoundInitiativeSolo(f);
      return;
    case 'beginTurn':
      return beginPlayerTurn(f);
    default:
      throw new Error(`unknown action ${action.type}`);
  }
}

export async function stepSolo(f, getPlayerAction) {
  while (!f.ended) {
    f.round++;
    applyEnrage(f);
    rollRoundInitiativeSolo(f);
    for (const entry of f.order) {
      if (f.ended) return snapshotCombat(f);
      if (entry.isPlayer) {
        f._actingKey = 'player';
        const began = beginPlayerTurn(f);
        if (!began.skipped) {
          const action = await getPlayerAction(f);
          if (action) await applyAction(f, action);
        }
        f.checkEndSolo();
        const de = derived(f.run);
        if (de.echoChance && !f.ended && f.aliveEnemies().length && f.rng.chance(de.echoChance)) {
          f._actingKey = 'player';
          const echoBegan = beginPlayerTurn(f);
          if (!echoBegan.skipped) {
            const echoAct = await getPlayerAction(f);
            if (echoAct) await applyAction(f, echoAct);
          }
          f.checkEndSolo();
        }
      } else {
        const e = f.enemyByUid(entry.key);
        if (!e || e.hp <= 0) continue;
        resolveEnemyTurn(f, e);
        f.checkEndSolo();
      }
    }
    f._actingKey = null;
    upkeep(f);
    f.checkEndSolo();
  }
  return snapshotCombat(f);
}
