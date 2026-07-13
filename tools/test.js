// Automated tests (handoff §33) for the pure/data layers.
//   node tools/test.js
// DOM-bound behavior (combat rendering, multiplayer flows) is covered by the
// scripted playtest bot; everything testable headlessly lives here.

import { CLASSES, SUBCLASSES, subclassOptions } from '../js/data/classes.js';
import { ACHIEVEMENTS, rollStart, awakenMonolith } from '../js/state.js';
import { RACES } from '../js/data/races.js';
import { ORIGINS } from '../js/data/origins.js';
import { SKILLS } from '../js/data/skills.js';
import { EVENTS, CATEGORY_META } from '../js/data/events.js';
import { ENEMIES, BOSSES, MODIFIERS, biomeForFloor } from '../js/data/enemies.js';
import { ALL_EQUIPMENT, RELICS, CONSUMABLES, itemById, EQUIP_SLOTS } from '../js/data/items.js';
import { CONFIG } from '../js/data/config.js';
import {
  TDC, expectedPower, enemyScale, partyHpMult, rewardMult,
  softLevelDamage, softHpGain, cappedDmgTakenMult, resourceRegen,
} from '../js/data/tdc.js';
import {
  guardReviveReconciled, floorBenchmark, encounterBudget, planEncounter,
  enemyThreatCost, mechanicBudgetCost, residualHpMult,
  itemPowerScore, validateItemPower, validateLoadout, estimatePlayerPower,
  historyCategoryWeight, bossFightTargets, MECHANIC_COSTS,
} from '../js/data/balance.js';
import { RANK_ORDER, rankFor, rankAtLeast, appraisalRange, rollGrowthRank, growthMult } from '../js/data/ranks.js';
import { rollInitiative, initiativeOrder, addCharge, tickEnemyCharge, canAfford, pickEnemySpecial, enemyTelegraph, applyGuard } from '../js/systems.js';
import { makeRng } from '../js/rng.js';
import { syntheticClimber, simulateFight } from './combat_sim.js';

globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem: () => {}, removeItem: () => {} };

let pass = 0, fail = 0;
function t(name, cond) {
  if (cond) { pass++; }
  else { fail++; console.error('  ✗ FAIL:', name); }
}

console.log('— rank system —');
t('WRLD ranks above EX', rankAtLeast('WRLD', 'EX') && !rankAtLeast('EX', 'WRLD'));
t('rank order is WRLD..F', RANK_ORDER[0] === 'WRLD' && RANK_ORDER.at(-1) === 'F');
t('rankFor thresholds ascend', rankFor(3) === 'F' && rankFor(12) === 'D' && rankFor(45) === 'S' && rankFor(80) === 'WRLD');
{
  const rng = makeRng(42);
  const r = appraisalRange(rng, 30);
  t('appraisal range brackets the true value', r.lo <= 30 && r.hi >= 30 && r.rank === rankFor(30));
}
t('growth mult ordered by rank', growthMult('WRLD') > growthMult('S') && growthMult('S') > growthMult('C') && growthMult('C') > growthMult('F'));

console.log('— growth inverse correlation —');
{
  const rng = makeRng(1234);
  let weakHigh = 0, strongHigh = 0;
  const N = 4000;
  for (let i = 0; i < N; i++) {
    if (rankAtLeast(rollGrowthRank(rng, 0.1), 'A')) weakHigh++;
    if (rankAtLeast(rollGrowthRank(rng, 0.9), 'A')) strongHigh++;
  }
  t('weak starts roll high growth far more often', weakHigh > strongHigh * 2);
  // rare S/S-style miracles remain possible
  let miracles = 0;
  for (let i = 0; i < 20000; i++) if (rankAtLeast(rollGrowthRank(rng, 0.95), 'S')) miracles++;
  t('strong-start high-growth is possible but rare (<3%)', miracles > 0 && miracles / 20000 < 0.03);
}

console.log('— monolith awakening —');
{
  const gen = rollStart('warrior', 'human', 42);
  const before = { ...gen.stats };
  awakenMonolith(gen, 99);
  t('awakening raises HP', gen.stats.hp === before.hp + CONFIG.chargen.awakenHp);
  t('awakening raises MP', gen.stats.mp === before.mp + CONFIG.chargen.awakenMp);
  const bumps = ['str', 'dex', 'int', 'wis', 'lk'].filter(k => gen.stats[k] > before[k]).length;
  t('awakening bumps distinct combat stats', bumps === CONFIG.chargen.awakenStatPicks);
  t('awakening is idempotent', (() => { const hp = gen.stats.hp; awakenMonolith(gen, 7); return gen.stats.hp === hp; })());
  t('awakening keeps percentile intact', gen.percentile === rollStart('warrior', 'human', 42).percentile);
}

console.log('— classes & subclasses (handoff §21) —');
t('nine classes (6 base + Warlock + Bard + hidden Necromancer)', Object.keys(CLASSES).length === 9);
t('exactly one hidden class with an unlock condition', Object.values(CLASSES).filter(c => c.hidden).length === 1 && typeof Object.values(CLASSES).find(c => c.hidden).unlockCond === 'function');
for (const cls of Object.values(CLASSES)) {
  const immediates = Object.values(SUBCLASSES).filter(s => s.parent === cls.id && s.tier === 1 && !s.secret);
  const secrets = Object.values(SUBCLASSES).filter(s => s.parent === cls.id && s.secret);
  t(`${cls.id}: two immediate subclasses`, immediates.length === 2);
  t(`${cls.id}: one secret subclass`, secrets.length === 1);
  for (const s of immediates) {
    t(`${s.id}: has a deeper branch`, !!s.next && !!SUBCLASSES[s.next] && SUBCLASSES[s.next].tier === 2);
    t(`${s.id}: signature skill exists`, !!SKILLS[s.skill]);
  }
  t(`${cls.id}: class resource defined`, !!cls.resource?.name);
  t(`${cls.id}: weapon types defined`, Array.isArray(cls.weapons) && cls.weapons.length > 0);
  t(`${cls.id}: kit is 3 fixed skills`, cls.startSkills.length === 3);
  t(`${cls.id}: no AOE in the fixed kit`, cls.startSkills.every(id => SKILLS[id].target !== 'all'));
  t(`${cls.id}: random pool valid`, !!SKILLS[cls.pool?.common] && !!SKILLS[cls.pool?.rare]);
  t(`${cls.id}: pool rare is the class AOE`, cls.pool?.rare === cls.aoeSkill && SKILLS[cls.aoeSkill]?.target === 'all');
  t(`${cls.id}: starting weapon exists & compatible`, (() => {
    const w = itemById(cls.startWeapon);
    return w && w.slot === 'weapon' && cls.weapons.includes(w.wtype);
  })());
  for (const id of cls.startSkills) t(`${cls.id}: start skill ${id} exists`, !!SKILLS[id]);
}
{
  // secret condition gating: fake runs
  const base = { classId: 'warrior', kills: 0, flags: {}, gold: 0, fame: 0, stats: { lk: 5 }, sigils: [], guardCount: 0 };
  t('secret hidden when unearned', subclassOptions(base).length === 2);
  t('secret appears when earned', subclassOptions({ ...base, kills: 20 }).length === 3);
}

console.log('— races (handoff §22) —');
t('four starting races', Object.keys(RACES).length === 4);
for (const r of Object.values(RACES)) {
  t(`${r.id}: has promotion`, !!r.promotion?.to);
  t(`${r.id}: has hint text`, !!r.hint);
}

console.log('— origins (handoff §23) —');
t('several origins', ORIGINS.length >= 5);
t('new achievements present', ['untouchable','overcharged','guardian','silver_tongue','assessed','party_of_four','hoarder'].every(id => ACHIEVEMENTS.some(a => a.id === id)));
for (const o of ORIGINS) t(`${o.id}: playable (has choices)`, Array.isArray(o.choices) && o.choices.length >= 2);

console.log('— skills & Battle Charge (handoff §11) —');
t('universal Strike exists', SKILLS.basic_attack && SKILLS.basic_attack.charge === 0 && SKILLS.basic_attack.cost === 0);
t('universal Guard exists', SKILLS.guard && SKILLS.guard.guard === true);
for (const sk of Object.values(SKILLS)) {
  if (sk.target === 'all') t(`AOE ${sk.id} is charge-gated (≥3)`, (sk.charge || 0) >= 3);
  t(`${sk.id}: charge within 0..6`, (sk.charge || 0) >= 0 && (sk.charge || 0) <= CONFIG.charge.max);
}
t('charge caps at six segments', addCharge(5, 4) === 6 && CONFIG.charge.max === 6);
t('charge floors at zero', addCharge(1, -5) === 0);
t('canAfford checks both pools', canAfford({ cost: 10, charge: 3 }, 10, 3) && !canAfford({ cost: 10, charge: 3 }, 9, 3) && !canAfford({ cost: 10, charge: 3 }, 10, 2));
{
  const starters = {
    warrior: 'slash', mage: 'firebolt', archer: 'quick_shot', rogue: 'backstab',
    priest: 'smite', monk: 'palm_strike', warlock: 'eldritch_bolt', bard: 'cutting_quip',
    necromancer: 'soul_bolt',
  };
  const freeUpgrades = {
    warrior: 'tempered_cut', mage: 'spark_lance', archer: 'steady_draw', rogue: 'quiet_cut',
    priest: 'blessed_strike', monk: 'knuckle', warlock: 'pact_sting', bard: 'wry_note',
    necromancer: 'chill_bolt',
  };
  for (const [cls, id] of Object.entries(freeUpgrades)) {
    const sk = SKILLS[id];
    const start = SKILLS[starters[cls]];
    t(`${id}: free learnable`, sk && sk.cost === 0 && sk.charge === 0 && sk.class === cls);
    t(`${id}: beats starter free hit`, sk.power > start.power);
    t(`${id}: below high-cost finishers`, sk.power < 150);
  }
  const resourceOnly = ['bracing_blow', 'prism_shard', 'bodkin', 'shiv', 'lucent_bolt', 'jab_chain', 'bleak_dart', 'sting_verse', 'rib_shot'];
  for (const id of resourceOnly) {
    const sk = SKILLS[id];
    t(`${id}: resource-only (no charge)`, sk && sk.cost > 0 && (sk.charge || 0) === 0 && sk.power > 0);
  }
  t('AOE skills still charge-gated', Object.values(SKILLS).filter(s => s.target === 'all' && (s.charge || 0) < 3 && s.class !== 'special').length === 0);
}

console.log('— Guard (handoff §10) —');
t('guard blocks 30%', applyGuard(100, true) === 70);
t('guard-piercing ignores guard', applyGuard(100, true, true) === 100);
t('no guard, no reduction', applyGuard(100, false) === 100);
t('bosses cleanse on a slow cadence', CONFIG.boss.cleanseEvery >= 3);
t('bosses can burn charge to break hard CC', CONFIG.boss.cleanseCost >= 1);

console.log('— enemy charge profiles (handoff §12) —');
{
  const withSpecials = Object.values(ENEMIES).flat().filter(e => e.specials);
  t('most enemies have charge specials', withSpecials.length >= 15);
  const e = { specials: [{ at: 3, name: 'X', mult: 1.5 }], charge: 2 };
  t('special unavailable below threshold', pickEnemySpecial(e) === null);
  t('telegraph fires one segment early', enemyTelegraph(e)?.ready === false);
  e.charge = 3;
  t('special available at threshold', pickEnemySpecial(e)?.name === 'X');
  t('telegraph marks ready', enemyTelegraph(e)?.ready === true);
  for (const b of Object.values(BOSSES)) {
    t(`boss ${b.id}: has specials`, Array.isArray(b.specials) && b.specials.length >= 2);
  }
  t('slow boss profile (hydra spd < duke spd)', BOSSES[40].spd < BOSSES[50].spd);
}

console.log('— initiative (handoff §14) —');
{
  const rng = makeRng(777);
  let playerFirst = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    const order = initiativeOrder(rng, [
      { key: 'p', spdStat: 6, mod: 0, isPlayer: true, stableId: 'p1' },
      { key: 'e', spdStat: 6, mod: 0, isPlayer: false, stableId: 'e1' },
    ], 2);
    if (order[0].isPlayer) playerFirst++;
  }
  t('beginner floors favor the player (>75%)', playerFirst / N > 0.75);
  let lateFirst = 0;
  for (let i = 0; i < N; i++) {
    const order = initiativeOrder(rng, [
      { key: 'p', spdStat: 6, mod: 0, isPlayer: true, stableId: 'p1' },
      { key: 'e', spdStat: 6, mod: 0, isPlayer: false, stableId: 'e1' },
    ], 30);
    if (order[0].isPlayer) lateFirst++;
  }
  t('no beginner bonus on later floors (~50%)', lateFirst / N > 0.35 && lateFirst / N < 0.65);
}

console.log('— events (handoff §4) —');
{
  const ids = new Set();
  for (const e of EVENTS) {
    t(`event ${e.id}: unique id`, !ids.has(e.id)); ids.add(e.id);
    t(`event ${e.id}: valid category`, !!CATEGORY_META[e.category]);
    t(`event ${e.id}: no sanity effects remain`, !JSON.stringify(e.choices).includes('"sanity"'));
    // Shops use their own leave UI; every card event needs an ungated exit.
    if (!e.shop) t(`event ${e.id}: has a free (no-req) choice`, e.choices.some(c => !c.req));
  }
  t('appraisal events exist (≥2)', EVENTS.filter(e => e.category === 'appraisal').length >= 2);
  t('comeback events exist (≥3)', EVENTS.filter(e => e.comeback).length >= 3);
  t('race promotion events exist (≥2)', EVENTS.filter(e => JSON.stringify(e).includes('promoteRace')).length >= 2);
  t('random-roll card event exists', EVENTS.some(e => JSON.stringify(e.choices).includes('randomOutcome')));
  t('shared secret quest exists', EVENTS.some(e => e.id === 'oath_candle') && EVENTS.some(e => e.id === 'oath_payoff'));
  t('party split event exists', EVENTS.some(e => e.id === 'forked_galleries'));
  // referenced item/consumable ids resolve
  for (const e of EVENTS) {
    for (const c of e.choices) {
      const os = [c.outcome, c.outcome?.success, c.outcome?.fail, ...(c.outcome?.randomOutcome || [])].filter(Boolean);
      for (const o of os) {
        if (o.item) t(`${e.id}: item ${o.item} exists`, !!itemById(o.item));
        if (o.consumable) t(`${e.id}: consumable ${o.consumable} exists`, !!itemById(o.consumable));
        if (o.combat) for (const eid of o.combat.enemies) {
          const inTrash = Object.values(ENEMIES).flat().some(x => x.id === eid);
          const inBoss = Object.values(BOSSES).some(x => x.id === eid);
          t(`${e.id}: combat enemy ${eid} exists`, inTrash || inBoss);
        }
      }
    }
  }
}

console.log('— equipment (handoff §19/§20) —');
t('eight equip slots', EQUIP_SLOTS.length === 8 && EQUIP_SLOTS.filter(s => s.startsWith('accessory')).length === 3);
{
  const slots = new Set(['weapon', 'helmet', 'chest', 'legs', 'boots', 'accessory']);
  for (const it of ALL_EQUIPMENT) {
    t(`${it.id}: valid slot`, slots.has(it.slot));
    if (it.slot === 'weapon') t(`${it.id}: has weapon type`, !!it.wtype);
  }
  t('gear exists for every armor slot', ['helmet', 'chest', 'legs', 'boots'].every(s => ALL_EQUIPMENT.some(i => i.slot === s)));
  t('stat-reading items exist', ALL_EQUIPMENT.some(i => i.reveal === 'ranks') && ALL_EQUIPMENT.some(i => i.reveal === 'exact'));
  t('UNIQUE rarity exists above legendary', ALL_EQUIPMENT.some(i => i.rarity === 'unique'));
  t('legendary gear still exists', ALL_EQUIPMENT.some(i => i.rarity === 'legendary'));
  t('UNIQUE catalog has several pieces', ALL_EQUIPMENT.filter(i => i.rarity === 'unique').length >= 5);
  t('WRLD rarity exists above UNIQUE', ALL_EQUIPMENT.some(i => i.rarity === 'wrld') && RELICS.some(r => r.rarity === 'wrld'));
  t('WRLD covers multiple weapon types', new Set(ALL_EQUIPMENT.filter(i => i.rarity === 'wrld' && i.slot === 'weapon').map(i => i.wtype)).size >= 5);
  const { rollEquipment, rollUnique, rollWrld, claimedWrldIds, markWrldClaimed, wrldCatalog } = await import('../js/data/items.js');
  t('rollUnique returns a unique', (() => {
    const u = rollUnique(makeRng(42), null);
    return !!u && u.rarity === 'unique';
  })());
  t('ordinary rolls never return UNIQUE or WRLD', (() => {
    for (let i = 0; i < 80; i++) {
      const it = rollEquipment(makeRng(9000 + i), 5, 8, { floor: 30 });
      if (it && (it.rarity === 'unique' || it.unique || it.rarity === 'wrld' || it.wrld)) return false;
    }
    return true;
  })());
  t('rollWrld returns wrld and claims it', (() => {
    const fakeRun = { claimedWrld: [], equipment: {}, inventory: [], relics: [], classId: 'warrior', gearBag: {} };
    const w = rollWrld(makeRng(7), fakeRun, { claim: true });
    return !!w && w.rarity === 'wrld' && claimedWrldIds(fakeRun).has(w.baseId || w.id);
  })());
  t('WRLD one-of-each excludes claimed ids', (() => {
    const fakeRun = { claimedWrld: ['caladbolg'], equipment: {}, inventory: [], relics: [], classId: 'warrior', gearBag: {} };
    for (let i = 0; i < 30; i++) {
      const w = rollWrld(makeRng(100 + i), fakeRun, { kind: 'weapon', claim: true });
      if (w && (w.baseId || w.id) === 'caladbolg') return false;
    }
    return true;
  })());
  t('WRLD catalog is sizable', wrldCatalog().length >= 10);
  const regenLow = ALL_EQUIPMENT.filter(i => (i.manaRegen || 0) > 0 && !['epic', 'legendary', 'unique', 'wrld'].includes(i.rarity) && !i.exclusive);
  t('manaRegen (resource regen) absent on low rarities', regenLow.length === 0);
  const { ACCESSORY_AFFIXES, WEAPON_AFFIXES, ARMOR_AFFIXES } = await import('../js/data/affixes.js');
  const regenAff = [...WEAPON_AFFIXES, ...ARMOR_AFFIXES, ...ACCESSORY_AFFIXES].filter(a => a.props?.manaRegen);
  t('resource-regen affixes gated to epic+', regenAff.every(a => a.minRarity === 'epic' || a.minRarity === 'legendary' || a.minRarity === 'unique' || a.minRarity === 'wrld'));
  t('unique earn event exists', EVENTS.some(e => JSON.stringify(e).includes('uniqueItem')));
  t('wrld earn event exists', EVENTS.some(e => JSON.stringify(e).includes('wrldItem')));
  t('unique achievement registered', ACHIEVEMENTS.some(a => a.id === 'unique_gear'));
  t('wrld achievement registered', ACHIEVEMENTS.some(a => a.id === 'wrld_gear'));
}

console.log('— bribery (handoff §25) —');
{
  const all = Object.values(ENEMIES).flat();
  t('intelligent enemies exist', all.some(e => e.intelligent));
  t('mindless enemies exist', all.some(e => !e.intelligent));
  t('skeletons cannot be bribed', !all.find(e => e.id === 'skeleton').intelligent);
  t('bandits can be bribed', !!all.find(e => e.id === 'bandit').intelligent);
}

console.log('— combat pacing (patch) —');
{
  // a level-1 basic attack must NOT one-shot a basic enemy (2-3 hits minimum)
  const C = CONFIG.combat;
  const strongStart = 14; // near-max level-1 governing stat
  const maxHit = (strongStart * C.playerStatWeight + 2 * C.playerAtkWeight + 1 * C.playerLevelWeight + C.playerFlat) * 1.15; // 100-power skill, max variance
  const weakestEnemy = Math.min(...Object.values(ENEMIES).flat().filter(e => !e.elite && !e.boss).map(e => {
    const sc = enemyScale(1, 1, 'forest', { elite: !!e.elite });
    return Math.round(e.hp * sc.hp);
  }));
  t('no one-shots with free attacks', maxHit < weakestEnemy);
  t('basic enemies take 2-3 basic hits', weakestEnemy / (maxHit * 0.9) >= 1.3);
  t('lifesteal capped at a sliver', C.lifestealCapPct <= 0.05 && C.lifestealCapPct >= 0.01);
  t('victory healing is lean', CONFIG.recovery.victoryHealPct <= 0.06 && CONFIG.recovery.floorHealPct <= 0.04);

  // Mid-climb: free/low-cost hits should not delete commons; elites last longer.
  // Uses synthetic P60 climber + 100-power mid-variance hit (combat_sim model).
  {
    const { syntheticClimber, simBuildEnemy } = await import('./combat_sim.js');
    const { softLevelDamage } = await import('../js/data/tdc.js');
    const hit = (p, enemy, power = 100) => {
      const base = (p.stats[p.classBias] * C.playerStatWeight + p.atk * C.playerAtkWeight
        + softLevelDamage(p.level, C.playerLevelWeight) + C.playerFlat)
        * (power / 100) * p.dmgMult;
      return Math.max(1, Math.round(base - enemy.def));
    };
    const floor = 17;
    const biome = biomeForFloor(floor);
    const p = syntheticClimber(floor, 0.6);
    const commons = ENEMIES[biome.id].filter(e => !e.elite);
    const elites = ENEMIES[biome.id].filter(e => e.elite);
    const commonHits = commons.map(s => {
      const e = simBuildEnemy(s, floor, biome.floors[0]);
      return e.hp / hit(p, e, 100);
    });
    const eliteHits = elites.map(s => {
      const e = simBuildEnemy(s, floor, biome.floors[0]);
      return e.hp / hit(p, e, 100);
    });
    t('F17 commons need ≥2 hits from a basic 100-power swing', Math.min(...commonHits) >= 2.0);
    t('F17 commons typically 2–3+ hits', commonHits.sort((a, b) => a - b)[Math.floor(commonHits.length / 2)] >= 2.3);
    t('F17 elites last longer than commons', Math.min(...eliteHits) >= 4.0);
  }
}

console.log('— kits & AOE access (patch) —');
{
  const { EVENTS: EVS } = await import('../js/data/events.js');
  t('an academy event teaches the AOE', EVS.some(e => JSON.stringify(e.choices).includes('learnAoe')));
  const { ORIGINS: ORS } = await import('../js/data/origins.js');
  t('academy origins can teach the AOE', JSON.stringify(ORS).includes('learnAoe'));
}

console.log('— config sanity —');
t('level-up restores 50% of missing', CONFIG.recovery.levelUpMissingPct === 0.5);
t('death respawn at 30% (reconciled with Guard)', CONFIG.death.respawnHpPct === 0.3 && CONFIG.death.respawnResourcePct === 0.3);
t('revive pct matches respawn', CONFIG.death.reviveHpPct === CONFIG.death.respawnHpPct);
t('guard blocks 30% (config)', CONFIG.guard.blockPct === 0.3);
t('Guard ↔ revival reconciled', guardReviveReconciled());
t('charge display name configurable', typeof CONFIG.charge.displayName === 'string');
t('modifiers have no sanity mechanics', !JSON.stringify(MODIFIERS).includes('sanity'));
t('relics have no sanity mechanics', !JSON.stringify(RELICS).includes('anity'));

console.log('— tower difficulty curve —');
{
  t('expected power rises with floor', expectedPower(1) < expectedPower(26) && expectedPower(26) < expectedPower(51));
  const early = enemyScale(1, 1, 'forest');
  const lateForest = enemyScale(10, 1, 'forest');
  t('depth scales hp within biome', lateForest.hp > early.hp);
  const hell = enemyScale(41, 41, 'hell');
  t('hell biome hp mult above forest', hell.hp > early.hp);
  t('legacy partyHpMult is flat (budgets own co-op)', partyHpMult(1) === 1 && partyHpMult(4) === 1);
  t('reward mult grows with floor', rewardMult(40).gold > rewardMult(5).gold);
  t('hp softcap after L10', softHpGain(11, 10) < 10 && softHpGain(5, 10) === 10);
  t('level damage softcap after L15', softLevelDamage(20, 1) < 20 && softLevelDamage(10, 1) === 10);
  t('mitigation capped at 65%', cappedDmgTakenMult(0.2) === 1 - TDC.player.mitigationCap);
  t('resource regen uses TDC base', resourceRegen(0, 0) === TDC.resource.baseRegen);
  const sc = enemyScale(5, 1, 'forest');
  t('buildEnemy-equivalent scale above base', sc.hp > 1 && sc.atk > 1);
  const e = { charge: 0, chargeGain: 1.5, _chargeFrac: 0 };
  tickEnemyCharge(e);
  t('fractional charge banks then grants', e.charge === 1 && e._chargeFrac > 0);
  tickEnemyCharge(e);
  t('fractional charge grants again', e.charge === 3);
}

console.log('— encounter budgets & floor benchmark —');
{
  const bm1 = floorBenchmark(1);
  const bm51 = floorBenchmark(51);
  t('floor benchmark power rises', bm1.power < bm51.power);
  t('floor benchmark has combat RTK band', bm1.combat.rounds[0] < bm1.combat.rounds[1]);
  t('encounter budget grows with party', encounterBudget(10, 1) < encounterBudget(10, 3));
  t('encounter budget grows with floor', encounterBudget(5, 1) < encounterBudget(40, 1));
  const rng = makeRng(99);
  const plan1 = planEncounter(rng, { floor: 5, biomeStart: 1, pool: ENEMIES.forest, partySize: 1 });
  const plan4 = planEncounter(makeRng(99), { floor: 5, biomeStart: 1, pool: ENEMIES.forest, partySize: 4 });
  t('larger party spends more bodies or HP', plan4.specs.length > plan1.specs.length || plan4.hpMult >= plan1.hpMult);
  t('residual HP capped', residualHpMult(1, 1) <= 1 + TDC.budget.residualHpCap + 1e-9);
  t('overspend trims HP', residualHpMult(-1, 1) < 1 && residualHpMult(-1, 1) >= 1 - TDC.budget.residualHpCap - 1e-9);
  t('wolf has positive threat', enemyThreatCost(ENEMIES.forest[0], 1, 1) > 0.5);
  t('elite costs more than trash', mechanicBudgetCost({ elite: true }) > mechanicBudgetCost({}));
  t('aoe special has mechanic cost', MECHANIC_COSTS.aoeSpecial > 0);
  t('boss targets defined for all bosses', Object.keys(BOSSES).every(f => bossFightTargets(Number(f)).rounds.length === 2));
}

console.log('— item power + loadout validators —');
{
  let over = 0;
  for (const it of ALL_EQUIPMENT) {
    const v = validateItemPower(it);
    if (!v.ok) { over++; console.error('  over-budget item:', it.id, v.score, '/', v.cap); }
  }
  t('no equipment exceeds power cap', over === 0);
  t('item scores are positive for weapons', itemPowerScore(ALL_EQUIPMENT.find(i => i.slot === 'weapon')) > 0);
  const stacked = validateLoadout([
    { id: 'a', dmgMult: 1.5 },
    { id: 'b', dmgMult: 1.5 },
    { id: 'c', dmgTakenMult: 0.5 },
  ], { floor: 1 });
  t('validator rejects overpowered dmg stack', !stacked.ok);
  const fair = validateLoadout([
    ALL_EQUIPMENT.find(i => i.rarity === 'common'),
  ], { floor: 1 });
  t('validator accepts modest loadout', fair.ok);
}

console.log('— history-aware events —');
{
  t('repeat category penalized', historyCategoryWeight('merchant', ['merchant']) < 1);
  t('triple streak heavily penalized', historyCategoryWeight('combat', ['combat', 'combat', 'combat']) <= 0.2);
  t('fresh category unpenalized', historyCategoryWeight('appraisal', ['merchant', 'combat']) === 1);
}

console.log('— combat sim smoke + power percentiles —');
{
  const rng = makeRng(2026);
  const climber = syntheticClimber(5, 0.5);
  const r = simulateFight(rng, climber, [ENEMIES.forest[0]], { floor: 5, biomeStart: 1 });
  t('sim produces finite rounds', r.rounds >= 1 && r.rounds < 40);
  t('sim hp loss in 0..1', r.hpLossPct >= 0 && r.hpLossPct <= 1);
  const p25 = estimatePlayerPower(syntheticClimber(20, 0.25));
  const p50 = estimatePlayerPower(syntheticClimber(20, 0.5));
  const p75 = estimatePlayerPower(syntheticClimber(20, 0.75));
  t('P25 < P50 < P75 at floor 20', p25 < p50 && p50 < p75);
  t('P50 tracks expectedPower order of magnitude', p50 > expectedPower(20) * 0.4 && p50 < expectedPower(20) * 2.5);
  // Boss sim: P50 should usually clear elderwood under the RTK band
  let wins = 0;
  for (let i = 0; i < 40; i++) {
    const br = simulateFight(makeRng(5000 + i), syntheticClimber(10, 0.5), [BOSSES[10]], {
      floor: 10, biomeStart: 10, boss: true,
    });
    if (br.won) wins++;
  }
  t('P50 beats elderwood most of the time', wins >= 22);
}

console.log('— affixes (TDC-gated) —');
{
  const { applyAffixes, WEAPON_AFFIXES, ARMOR_AFFIXES, ACCESSORY_AFFIXES } = await import('../js/data/affixes.js');
  const { rollEquipment } = await import('../js/data/items.js');
  t('weapon affix pool non-empty', WEAPON_AFFIXES.length >= 10);
  t('armor affix pool non-empty', ARMOR_AFFIXES.length >= 10);
  t('accessory affix pool non-empty', ACCESSORY_AFFIXES.length >= 5);
  t('TDC affix counts defined', !!TDC.affix?.counts?.rare);
  const rng = makeRng(77);
  const base = ALL_EQUIPMENT.find(i => i.id === 'steel_blade');
  let over = 0;
  for (let i = 0; i < 80; i++) {
    const affixed = applyAffixes(base, makeRng(1000 + i), { floor: 20 });
    const v = validateItemPower(affixed);
    if (!v.ok) { over++; console.error('  over-budget affixed:', affixed.name, v.score, '/', v.cap); }
  }
  t('affixed steel blades stay under TDC power cap', over === 0);
  const exclusive = applyAffixes(ALL_EQUIPMENT.find(i => i.exclusive), rng, { floor: 30 });
  t('exclusive gear skips affixes', (exclusive.affixes || []).length === 0);
  const rolled = rollEquipment(makeRng(9), 3, 5, { floor: 12 });
  t('rollEquipment mints instance id', !!rolled.instanceId && rolled.id.includes('__'));
  t('rollEquipment keeps baseId', !!rolled.baseId);
}

console.log('— event tags —');
{
  const { EVENT_TAG_MAP } = await import('../js/data/eventtagmap.js');
  const { tagWeightMult, applyTagOutcomeMods, KNOWN_EVENT_TAGS } = await import('../js/data/eventtags.js');
  const missing = EVENTS.filter(e => !(e.tags?.length) && !EVENT_TAG_MAP[e.id]);
  t('every event has tags', missing.length === 0);
  t('every event stamped with tags array', EVENTS.every(e => Array.isArray(e.tags) && e.tags.length > 0));
  const unknown = [];
  for (const e of EVENTS) {
    for (const tag of e.tags) if (!KNOWN_EVENT_TAGS.includes(tag)) unknown.push(`${e.id}:${tag}`);
  }
  t('all event tags are known', unknown.length === 0);
  const state = { underdog: true, fame: 50, gold: 100, hp: 20, maxHp: 100, stats: { lk: 14 }, classId: 'rogue', flags: {} };
  const gambler = EVENTS.find(e => e.id === 'gambler');
  t('tag weight mult is positive', tagWeightMult(gambler, state) > 0);
  const mod = applyTagOutcomeMods({ fame: 2, roll: { stat: 'lk', dc: 12 } }, { tags: ['blessing', 'gamble'] }, state);
  t('blessing bumps positive fame', mod.fame === 3);
  t('gamble softens DC for underdog', mod.roll.dc === 11);
}

console.log('— skill components —');
{
  const { COMP, composeSkill } = await import('../js/data/skillcomponents.js');
  const sk = composeSkill(
    { id: 'test_combo', name: 'Test', class: 'rogue', desc: 'x' },
    COMP.cost(10), COMP.charge(1), COMP.target('one'), COMP.dmg(100, 'dex'), COMP.poison(0.5),
  );
  t('composeSkill merges damage + status', sk.power === 100 && sk.poison === 0.5 && sk.cost === 10);
  t('composed slash exists', SKILLS.slash?.power === 100 && SKILLS.slash?.stat === 'str');
  t('shadow_step composed skill exists', !!SKILLS.shadow_step && SKILLS.shadow_step.gainCharge === 1);
}

console.log('— milestones —');
{
  const { Milestone, checkMilestone } = await import('../js/data/milestones.js');
  const run = { level: 6, fame: 30, flags: { defiler: true }, sigils: ['truth'], raceId: 'human' };
  t('milestone level', checkMilestone(run, Milestone.level(6)));
  t('milestone all', checkMilestone(run, Milestone.all(Milestone.fame(25), Milestone.flag('defiler'))));
  t('milestone rejects', !checkMilestone(run, Milestone.fame(99)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
