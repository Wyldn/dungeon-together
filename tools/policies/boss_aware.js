// Measurement-only F10 combat policy. Not wired into live autoplay.
// Uses only information a competent player can see: HP, charge, telegraphs,
// skill text, statuses. Never inspects hidden combat rolls or future RNG.

import { SKILLS } from '../../js/data/skills.js';
import { CONSUMABLES, consumableCombatValue } from '../../js/data/items.js';
import { usableSkillIds, derived } from '../../js/character.js';
import {
  canAfford, skillEffectivePower, enemyTelegraph, applyDefense,
} from '../../js/systems.js';
import { CONFIG } from '../../js/data/config.js';
import { soloBossChargeForScale } from '../../js/data/tdc.js';

function hpRatio(run) {
  return run.hp / Math.max(1, run.maxHp);
}

function afford(f, sk) {
  const costMult = f.mod?.costMult || 1;
  return canAfford(
    { cost: Math.ceil((sk.cost || 0) * costMult), charge: sk.charge || 0 },
    f.run.mp, f.charge,
  );
}

function usableSkills(f) {
  const usable = usableSkillIds(f.run);
  return ['basic_attack', 'guard', ...(f.run.skills || [])]
    .map(id => SKILLS[id])
    .filter(sk => sk && usable.includes(sk.id) && afford(f, sk));
}

function isHealSkill(sk) {
  return !!(sk && sk.healPct && (sk.target === 'self' || sk.allyTarget) && !sk.power);
}

function isMixedHeal(sk) {
  return !!(sk && sk.healPct && sk.power);
}

function shieldAmt(sk) {
  if (!sk) return 0;
  if (sk.guard) return CONFIG.guard.blockPct || 0.22;
  return sk.shield || 0;
}

function isDodgeBuff(sk) {
  const buffs = [sk?.buff, sk?.buff2].filter(Boolean);
  return buffs.some(b => b.stat === 'dodge' && (b.add || 0) > 0) && !sk.power && !sk.shield && !sk.guard;
}

function hasTaunt(sk) {
  return !!(sk && sk.tauntTurns);
}

function specialMult(special) {
  return special?.mult || 1;
}

function estimateHit(f, enemy, special) {
  const d = typeof f.d === 'function' ? f.d() : derived(f.run);
  const mult = specialMult(special);
  let chargeScale = 1;
  if (special && enemy.boss) {
    const spent = special.at || 0;
    const banked = soloBossChargeForScale(f.run.floor, spent);
    const aoeFactor = special.aoe ? (CONFIG.boss?.aoeChargeFactor ?? 1) : 1;
    chargeScale = 1 + (CONFIG.boss?.chargeDamageScale ?? 0.32) * banked * aoeFactor;
  }
  let raw = (enemy.atk || 0)
    * (CONFIG.combat.enemyAtkMult ?? 1.35)
    * (f.mod?.dmgMult || 1)
    * mult
    * chargeScale;
  raw = applyDefense(raw, d.def);
  raw *= d.dmgTakenMult || 1;
  const st = f.player?.statuses || {};
  if (st.hexed) raw *= CONFIG.combat.hexTakenMult ?? 1.12;
  if (st.frail) raw *= CONFIG.combat.frailTakenMult ?? 1.12;
  if (special && (special.burn || special.burnSure) && st.burn) {
    raw *= CONFIG.identity?.burnStandingMult ?? 1.2;
  }
  if (st.shield) raw *= (1 - (st.shield.mult || 0));
  return Math.max(1, Math.round(raw));
}

function upcomingSpecial(enemy) {
  const t = enemyTelegraph(enemy);
  if (!t) return null;
  const charge = enemy.charge || 0;
  const specials = enemy.specials || [];
  const named = specials.find(s => s.name === t.name) || null;
  return {
    ready: !!t.ready,
    name: t.name,
    aoe: !!t.aoe,
    special: named,
    charge,
    gap: named ? Math.max(0, (named.at || 0) - charge) : (t.ready ? 0 : 1),
  };
}

function incomingThisTurn(f) {
  const foes = (f.aliveEnemies?.() || f.enemies || []).filter(e => e.hp > 0);
  let total = 0;
  let heavy = null;
  for (const e of foes) {
    const up = upcomingSpecial(e);
    if (up?.ready) {
      const dmg = estimateHit(f, e, up.special);
      total += dmg;
      if (!heavy || dmg > heavy.dmg) heavy = { enemy: e, ...up, dmg };
    } else {
      total += estimateHit(f, e, null);
    }
  }
  return { total, heavy };
}

function incomingSoon(f) {
  const foes = (f.aliveEnemies?.() || f.enemies || []).filter(e => e.hp > 0);
  let heavy = null;
  for (const e of foes) {
    const up = upcomingSpecial(e);
    if (!up || up.ready) continue;
    if (up.gap > 2) continue;
    const dmg = estimateHit(f, e, up.special);
    if (!heavy || dmg > heavy.dmg) heavy = { enemy: e, ...up, dmg };
  }
  return heavy;
}

function healAmount(f, skOrItem, kind) {
  if (kind === 'skill') {
    return Math.round(f.run.maxHp * (skOrItem.healPct || 0));
  }
  const cv = consumableCombatValue(skOrItem, f.run.floor);
  return (cv.heal || 0) + Math.round(f.run.maxHp * (cv.healPct || 0));
}

function findHealConsumable(f) {
  const ids = f.run.consumables || [];
  let best = null;
  for (const id of ids) {
    const c = CONSUMABLES.find(x => x.id === id);
    if (!c || !(c.heal || c.healPct)) continue;
    const amt = healAmount(f, c, 'item');
    if (!best || amt > best.amt) best = { c, amt, action: { type: 'useConsumable', itemId: c.id } };
  }
  return best;
}

function findHealSkill(f) {
  const skills = usableSkills(f).filter(sk => isHealSkill(sk) || (isMixedHeal(sk) && sk.target === 'self'));
  let best = null;
  for (const sk of skills) {
    const amt = healAmount(f, sk, 'skill');
    if (!best || amt > best.amt) best = { sk, amt, action: { type: 'useSkill', skillId: sk.id } };
  }
  return best;
}

function pickHeal(f, { minHeal = 0, preferSkill = false } = {}) {
  const potion = findHealConsumable(f);
  const skill = findHealSkill(f);
  const opts = [potion, skill].filter(x => x && x.amt >= minHeal);
  if (!opts.length) {
    const any = preferSkill ? (skill || potion) : (potion || skill);
    return any || null;
  }
  if (preferSkill && skill && skill.amt >= minHeal) return skill;
  return opts.sort((a, b) => b.amt - a.amt)[0];
}

function defenseScore(sk, vsSpecial) {
  if (!sk) return 0;
  if (hasTaunt(sk)) return 100 + shieldAmt(sk) * 20;
  const sh = shieldAmt(sk);
  if (sh > 0) return 40 + sh * 80 + (sk.healPct || 0) * 20;
  if (sk.guard) return 35;
  if (sk.partyBuff?.kind === 'dr') return 55;
  if (isDodgeBuff(sk)) return vsSpecial ? 4 : 45;
  return 0;
}

function pickDefense(f, vsSpecial) {
  if (f.player?.statuses?.shield && (f.player.statuses.shield.mult || 0) >= 0.45) return null;
  const skills = usableSkills(f);
  let best = null;
  let bestScore = 0;
  for (const sk of skills) {
    if (sk.guard && f.player?.ironStance) continue;
    const s = defenseScore(sk, vsSpecial);
    if (s > bestScore) {
      bestScore = s;
      best = sk;
    }
  }
  if (!best || bestScore < 30) return null;
  return { type: 'useSkill', skillId: best.id };
}

function pickTarget(f) {
  const enemies = f.enemies || [];
  let best = -1;
  let bestKey = null;
  for (let i = 0; i < enemies.length; i++) {
    const e = enemies[i];
    if (!e || e.hp <= 0) continue;
    // Competent play: cut summons, then escorts, then the boss.
    // Index is a deterministic tie-break — never RNG.
    const tier = e.boss ? 2 : (e.summon ? 0 : 1);
    const key = tier * 1e9 + e.hp * 1e3 + i;
    if (best < 0 || key < bestKey) {
      best = i;
      bestKey = key;
    }
  }
  return best >= 0 ? best : 0;
}

function offensivePool(f) {
  const alive = (f.aliveEnemies?.() || f.enemies || []).filter(e => e.hp > 0);
  const adds = alive.filter(e => !e.boss);
  const fatAdds = adds.filter(e => e.hp > 40);
  return usableSkills(f)
    .filter(sk => sk.id !== 'guard' && !isHealSkill(sk) && !sk.allyTarget)
    .filter(sk => sk.target !== 'self' || sk.power)
    .filter(sk => !(sk.selfHpCost && hpRatio(f.run) < 0.55))
    .map(sk => {
      let score = skillEffectivePower(sk) || (sk.power || 0);
      if (sk.target === 'all') {
        if (!adds.length) score *= 0.72;
        // Two or more adds, or one bulky escort: splash is worth the spend.
        // One skinny summon: a free ST cut is the actual play — do not dump
        // a charge-gated AOE just because the board is "multi."
        else if (adds.length >= 2 || fatAdds.length >= 1) score *= 1.35;
        else score *= 0.7;
      }
      if (sk.stun && incomingThisTurn(f).heavy?.ready) score += 8;
      if (sk.execute && alive.some(e => !e.boss && e.hp / Math.max(1, e.maxHp) < (sk.execute || 0))) {
        score += 80;
      }
      const missing = f.run.maxHp - f.run.hp;
      if (sk.healPct && missing > f.run.maxHp * 0.12) score += sk.healPct * 40;
      if (sk.lifesteal && missing > f.run.maxHp * 0.2) score += 12;
      return { sk, score };
    })
    .sort((a, b) => b.score - a.score
      || (b.sk.charge || 0) - (a.sk.charge || 0)
      || String(a.sk.id).localeCompare(String(b.sk.id)));
}

function pickOffense(f) {
  const pool = offensivePool(f);
  const sk = pool[0]?.sk || SKILLS.basic_attack;
  return { type: 'useSkill', skillId: sk.id, enemy: pickTarget(f) };
}

function isFinisher(special) {
  return specialMult(special) >= 2.0
    || !!(special?.tormentedSure)
    || !!(special?.freezeSure)
    || !!(special?.frailSure && specialMult(special) >= 1.8);
}

export function chooseBossAwareAction(f) {
  const run = f.run;
  const hp = hpRatio(run);
  const now = incomingThisTurn(f);
  const soon = incomingSoon(f);
  const st = f.player?.statuses || {};
  const dotted = !!(st.burn || st.poison || st.tormented);
  const lethalNow = now.total >= run.hp;
  const finisherReady = !!(now.heavy?.ready && isFinisher(now.heavy.special));
  const scaryNow = now.heavy && (now.heavy.dmg >= run.maxHp * 0.28 || specialMult(now.heavy.special) >= 1.7);
  const vsSpecial = !!(now.heavy?.ready);
  const heavyIsBoss = !now.heavy || now.heavy.enemy?.boss || !now.heavy.enemy?.summon;

  if (lethalNow || finisherReady || (scaryNow && hp < 0.85)) {
    const def = pickDefense(f, vsSpecial);
    const need = Math.max(0, now.total - run.hp + 1);
    const heal = pickHeal(f, { minHeal: 1 });
    if (def && hasTaunt(SKILLS[def.skillId]) && heavyIsBoss) return def;
    if (def && shieldAmt(SKILLS[def.skillId]) >= 0.45) return def;
    if (heal && heal.amt >= need * 0.7 && !scaryNow) return heal.action;
    if (heal && heal.amt >= now.total * 0.35 && hp < 0.4) return heal.action;
    if (def) return def;
    if (heal) return heal.action;
  }

  if (dotted && hp < 0.62) {
    const heal = pickHeal(f, { preferSkill: true });
    if (heal) return heal.action;
  }

  const healLine = scaryNow ? 0.58 : (soon && soon.dmg >= run.maxHp * 0.35 ? 0.52 : 0.48);
  if (hp < healLine) {
    const preferSkill = hp > 0.32;
    const heal = pickHeal(f, { preferSkill });
    if (heal) return heal.action;
  }

  const soonFinisher = !!(soon && isFinisher(soon.special));
  if (soon && soon.gap <= 1 && (hp < 0.7 || soonFinisher)) {
    const def = pickDefense(f, true);
    if (def && ((hasTaunt(SKILLS[def.skillId]) && (!soon.enemy || soon.enemy.boss))
      || shieldAmt(SKILLS[def.skillId]) >= 0.45)) {
      return def;
    }
    if (hp < 0.58) {
      const heal = pickHeal(f, { preferSkill: true });
      if (heal) return heal.action;
    }
  }

  return pickOffense(f);
}

export function bossAwarePolicy(opts = {}) {
  return {
    name: 'boss-aware',
    chooseCombatAction: chooseBossAwareAction,
    ...opts,
  };
}
