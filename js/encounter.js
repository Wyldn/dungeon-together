// Hostiles Ahead: fight / sneak / bribe. Encounter floor advances once, then the
// chosen approach advances again. Callers must not add extra advances.

import { CONFIG } from './data/config.js';
import { biomeForFloor, ENEMIES, NPC_ENEMIES, mimicSpec, findEnemySpec, isGalleryNpc } from './data/enemies.js';
import {
  partyBossAtkMult, partyBossHpMult, partyTrashAtkMult,
  eventFightHpMult, eventFightAtkMult, npcDuelEase,
} from './data/tdc.js';
import { derived, gainXp } from './character.js';
import { buildEnemy } from './combat_core.js';
import { pickEnemyPlan } from './data/floorcards.js';

export function isSpecialEventFoe(s) {
  if (!s?.id) return false;
  if (s.id === 'mimic') return true;
  return !!(NPC_ENEMIES[s.id] && !String(s.id).startsWith('farmer_'));
}

export function buildEventFightEnemies(run, specs, { partySize = 1, hpMult = 1 } = {}) {
  const biome = biomeForFloor(run.floor);
  const special = specs.some(isSpecialEventFoe);
  const evHp = special ? eventFightHpMult(partySize) : 1;
  const evAtk = special ? eventFightAtkMult(partySize) : 1;
  const trashAtk = special ? 1 : partyTrashAtkMult(partySize, run.floor);
  return specs.map((s, i) => {
    const isBoss = !!s.boss;
    const duel = (!isBoss && isGalleryNpc(s.id)) ? npcDuelEase(run.floor) : { hp: 1, atk: 1 };
    return buildEnemy(s, run.floor, biome.floors[0], {
      boss: isBoss,
      hpMult: (hpMult || 1) * evHp * duel.hp * (isBoss ? partyBossHpMult(partySize, run.floor) : 1),
      atkMult: (special ? evAtk : trashAtk) * duel.atk
        * (isBoss && !s.eliteAtkRole ? partyBossAtkMult(partySize, run.floor) : 1),
      partySize,
      spawnIndex: i,
    });
  });
}

export function planEncounterGroup(run, rng, prebuiltGroup = null, hpMult = 1) {
  const biome = biomeForFloor(run.floor);
  if (prebuiltGroup) return { group: prebuiltGroup, planHp: hpMult };
  const plan = pickEnemyPlan(rng, run, biome, 1);
  return { group: plan.specs, planHp: plan.hpMult };
}

export function encounterBribeCost(run, group) {
  const fameDiscount = Math.min(0.5, Math.floor(run.fame / 10) * CONFIG.fame.bribeDiscountPer10);
  return Math.round(group.reduce((s, g) => s + g.gold[1], 0) * 0.8 * (1 - fameDiscount));
}

export function encounterOptions(run, group) {
  const bribable = group.every(g => g.intelligent);
  const bribe = encounterBribeCost(run, group);
  return {
    bribable,
    bribe,
    canBribe: bribable && run.gold >= bribe,
    sneakDc: 10 + Math.floor(run.floor / 8),
  };
}

/**
 * Resolve fight / sneak / bribe. Caller already advanced once for the encounter
 * floor deal. This function advances once more (live fight/sneak/bribe).
 */
export function resolveEncounterApproach(run, rng, group, act, { planHp = 1, hooks = {} } = {}) {
  if (act === 'fight') {
    rng.advance();
    return { kind: 'fight', group, hpMult: planHp, text: 'Steel answers steel.' };
  }
  if (act === 'bribe') {
    const { bribe, canBribe } = encounterOptions(run, group);
    if (!canBribe) {
      rng.advance();
      return { kind: 'fight', group, hpMult: planHp, text: 'Steel answers steel.' };
    }
    run.gold -= bribe;
    run.bribes = (run.bribes || 0) + 1;
    rng.advance();
    return {
      kind: 'bribe',
      gold: bribe,
      lines: [{ text: `You toss the purse. They count it — twice, insultingly — and melt back into the dark. (-${bribe} gold)`, cls: 'gold' }],
    };
  }
  const d = derived(run);
  const sneakDc = 10 + Math.floor(run.floor / 8);
  const roll = rng.int(1, 8);
  const total = d.dex + roll + Math.floor(d.lk / 4);
  rng.advance();
  if (total >= sneakDc) {
    const xp = 10 + Math.floor(run.floor * 1.2);
    const gainRng = hooks.runRng?.(run) || null;
    const ups = gainRng ? gainXp(run, xp, gainRng) : [];
    return { kind: 'sneak', ok: true, xp, ups, sneakDc, roll, total };
  }
  return {
    kind: 'ambush',
    sneakDc, roll, total,
    group,
    hpMult: planHp,
    modifier: { name: 'Ambushed', desc: 'Enemies strike first.', enemyFirst: true },
    text: 'They were waiting for the twig.',
  };
}

export function resolveSneakXp(run, gainXpRng) {
  const xp = 10 + Math.floor(run.floor * 1.2);
  return { xp, ups: gainXp(run, xp, gainXpRng) };
}

export function pickEventEnemyIds(rng, pickEnemies, partySize = 1) {
  const [cLo, cHi] = pickEnemies.count || [1, 1];
  let n = rng.int(cLo, cHi);
  if (pickEnemies.partyExtra) n += Math.max(0, (partySize - 1) * (pickEnemies.partyExtra || 0));
  const enemyIds = [];
  for (let i = 0; i < n; i++) enemyIds.push(rng.pick(pickEnemies.pool));
  return enemyIds;
}

export function specsFromEnemyIds(run, enemyIds) {
  const biome = biomeForFloor(run.floor);
  return enemyIds.map(id => findEnemySpec(id) || ENEMIES[biome.id][0]);
}

export function maybeEscortNpcDuel(run, specs, partySize) {
  if (partySize < 2 || specs.length !== 1 || (run.floor || 1) < 12) return specs;
  const id = specs[0]?.id || '';
  if (!/^(blade_hero|dark_mage|pathfinder_veteran|axe_northman|oldman_gentle|oldman_wrath|evil_wizard|evil_wizard_3|archer_hero|samurai|rogue_hero|tr_live_wizard|fantasy_warrior|huntress|huntress_2|martial_hero|martial_hero_2|martial_hero_3)$/.test(id)) {
    return specs;
  }
  const biome = biomeForFloor(run.floor);
  const escort = NPC_ENEMIES.roadside_npc2 || ENEMIES[biome.id]?.[0];
  if (!escort) return specs;
  return [specs[0], { ...escort, hp: Math.round((escort.hp || 40) * 0.7), atk: Math.round((escort.atk || 10) * 0.85) }];
}

export { mimicSpec };
