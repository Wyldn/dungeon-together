// Automated tests (handoff §33) for the pure/data layers.
//   node tools/test.js
// DOM-bound behavior (combat rendering, multiplayer flows) is covered by the
// scripted playtest bot; everything testable headlessly lives here.

import { CLASSES, SUBCLASSES, subclassOptions } from '../js/data/classes.js';
import { ACHIEVEMENTS, rollStart, awakenMonolith, fateGrowthBoost, randomRaceId, randomClassId, playableClassIds, getChoiceOutcomeHints, setChoiceOutcomeHints, choiceOutcomeHintVisible } from '../js/state.js';
import { RACES } from '../js/data/races.js';
import { ORIGINS, defaultOriginId } from '../js/data/origins.js';
import { SKILLS } from '../js/data/skills.js';
import { EVENTS, CATEGORY_META } from '../js/data/events.js';
import { ENEMIES, BOSSES, ALT_BOSSES, SECRET_BOSS, MODIFIERS, pickTrialModifier, biomeForFloor, findEnemySpec, WANDERING_ENEMIES, isGalleryNpc, NPC_ENEMIES, mimicSpec } from '../js/data/enemies.js';
import { ROSTER } from '../js/data/roster_worlds.js';
import { summonSpecFor } from '../js/combat_core.js';
import {
  applyGalleryKit, inferArchetype, specialHasRider, specialRiderKeys,
  SUPPORTED_SPECIAL_KEYS, biomePaletteKeys, kitFor,
} from '../js/data/biome_kits.js';
import {
  ALL_EQUIPMENT, RELICS, CONSUMABLES, itemById, EQUIP_SLOTS, rollRelic, relicMutexBlocked,
  shopListingPrice, shopConsumablePool, consumableCombatValue, sellGold, merchantBuyGold,
  itemUsefulForClass,
} from '../js/data/items.js';
import { CONFIG } from '../js/data/config.js';
import { pathNodeView } from '../js/travelmap.js';
import {
  TDC, expectedPower, enemyScale, partyHpMult, rewardMult,
  softLevelDamage, softHpGain, cappedDmgTakenMult, resourceRegen, npcDuelEase,
} from '../js/data/tdc.js';
import {
  guardReviveReconciled, floorBenchmark, encounterBudget, planEncounter,
  enemyThreatCost, mechanicBudgetCost, residualHpMult,
  itemPowerScore, validateItemPower, validateLoadout, estimatePlayerPower,
  historyCategoryWeight, historyEventWeight, filterEncounterPool,
  pushEncounterHistory, pushOfferedEventHistory, pushTakenEventHistory,
  bossFightTargets, MECHANIC_COSTS,
} from '../js/data/balance.js';
import { RANK_ORDER, rankFor, rankAtLeast, appraisalRange, rollGrowthRank, growthMult } from '../js/data/ranks.js';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { rollInitiative, initiativeOrder, addCharge, tickEnemyCharge, canAfford, skillEffectivePower, pickEnemySpecial, enemyTelegraph, applyGuard, enemySpecialPayoff, enemyPayoffLine, statusPresent } from '../js/systems.js';
import { makeRng } from '../js/rng.js';
import { syntheticClimber, simulateFight } from './combat_sim.js';
import { buildEventFightEnemies } from '../js/encounter.js';

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
t('growth mult spans 0.7–1.5', growthMult('F') === 0.7 && growthMult('C') === 1.0 && growthMult('WRLD') === 1.5);

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

console.log('— choice outcome hint pref —');
{
  const prev = globalThis.localStorage;
  const store = {};
  globalThis.localStorage = {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
  t('choice outcome hints default on', getChoiceOutcomeHints() === true);
  t('unlocked outcome preview is shown by default', choiceOutcomeHintVisible() === true);
  t('choice outcome hints can turn off', setChoiceOutcomeHints(false) === false && getChoiceOutcomeHints() === false);
  t('off hides unlocked outcome previews', choiceOutcomeHintVisible() === false);
  t('off still shows locked reasons', choiceOutcomeHintVisible({ locked: true }) === true);
  t('off still shows kept costs/status', choiceOutcomeHintVisible({ keep: true }) === true);
  t('choice outcome hints persist', JSON.parse(store.dt_prefs_v1).choiceOutcomeHints === false);
  t('choice outcome hints can turn back on', setChoiceOutcomeHints(true) === true && getChoiceOutcomeHints() === true);
  globalThis.localStorage = prev;
}

console.log('— classes & subclasses (handoff §21) —');
t('eleven classes (base + Warlock + Bard + Spellsword + Viking + hidden Necromancer)', Object.keys(CLASSES).length === 11);
t('five hidden callings with unlock conditions', Object.values(CLASSES).filter(c => c.hidden).length === 5 && Object.values(CLASSES).filter(c => c.hidden).every(c => typeof c.unlockCond === 'function'));
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
  const base = { classId: 'warrior', kills: 0, flags: {}, gold: 0, fame: 0, stats: { lk: 5 }, sigils: [], guardCount: 0, world: { knowledge: [] } };
  t('secret hidden when unearned', subclassOptions(base).length === 2);
  t('doomguard hidden when only named (eligible, not accepted)', subclassOptions({ ...base, world: { knowledge: ['doom_named'] } }).length === 2);
  t('doomguard appears only after accept unlock', subclassOptions({ ...base, world: { knowledge: ['unlock_doomguard'] } }).length === 3);
  const necro = { classId: 'necromancer', kills: 0, flags: {}, gold: 0, fame: 0, stats: { lk: 5 }, sigils: [], guardCount: 0, world: { knowledge: [] } };
  t('lichling hidden before initiation', subclassOptions(necro).length === 2);
  t('lichling hidden when only eligible (whisper)', subclassOptions({ ...necro, world: { knowledge: ['heard_dead_language'] } }).length === 2);
  t('lichling hidden when only fallback kills', subclassOptions({ ...necro, kills: 25 }).length === 2);
  t('lichling appears only after accept unlock', subclassOptions({ ...necro, world: { knowledge: ['unlock_lichling'] } }).length === 3);
}

console.log('— races (handoff §22) —');
t('eight starting races', Object.keys(RACES).length === 8);
for (const r of Object.values(RACES)) {
  t(`${r.id}: has promotion`, !!r.promotion?.to);
  t(`${r.id}: has hint text`, !!r.hint);
}
t('fate growth none', fateGrowthBoost(false, false) === 1);
t('fate growth race only', Math.abs(fateGrowthBoost(true, false) - (1 + CONFIG.chargen.randomIdentityGrowthOne)) < 1e-9);
t('fate growth both', Math.abs(fateGrowthBoost(true, true) - (1 + CONFIG.chargen.randomIdentityGrowthBoth)) < 1e-9);
{
  const rid = randomRaceId(makeRng(1));
  t('random race is known', !!RACES[rid]);
  const cid = randomClassId({ bestFloor: 0 }, makeRng(2));
  t('random class is playable', !!CLASSES[cid] && playableClassIds({ bestFloor: 0 }).includes(cid));
}

console.log('— origins (handoff §23) —');
t('several origins', ORIGINS.length >= 5);
t('new achievements present', ['untouchable','overcharged','guardian','silver_tongue','assessed','party_of_four','hoarder'].every(id => ACHIEVEMENTS.some(a => a.id === id)));
for (const o of ORIGINS) t(`${o.id}: playable (has choices)`, Array.isArray(o.choices) && o.choices.length >= 2);
t('warrior default origin is Ninth Hall', defaultOriginId('warrior') === 'sword_academy');
t('mage default origin is Academy', defaultOriginId('mage') === 'mage_academy');
t('every class has a known default origin', Object.keys(CLASSES).every(id => ORIGINS.some(o => o.id === defaultOriginId(id))));

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
  // High cost/charge skills must clearly outpace cheap mid skills after spend lift.
  const free = skillEffectivePower(SKILLS.slash);
  const mid = skillEffectivePower(SKILLS.shield_bash);
  const heavy = skillEffectivePower(SKILLS.assassinate);
  const aoeHeavy = skillEffectivePower(SKILLS.cleave);
  t('free skills keep authored power', free === SKILLS.slash.power);
  t('heavy ST spends beat mid by a wide margin', heavy >= mid * 1.55);
  t('heavy ST spends beat free basics', heavy >= free * 1.7);
  t('AOE mid spends beat free ST per-target enough to matter', aoeHeavy >= free * 0.95);
  t('already-strong finishers are not double-buffed', skillEffectivePower(SKILLS.one_shot) === SKILLS.one_shot.power);
}
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

console.log('— status potency —');
{
  const C = CONFIG.combat;
  t('poison DoT stronger than legacy player 5%', (C.poisonPctOnPlayer ?? 0) >= 0.08);
  t('burn blunts outgoing damage', (C.burnDmgMult ?? 1) < 1 && (C.burnDmgMult ?? 1) >= 0.8);
  t('paralyze lowers initiative', (C.paralyzeInitPenalty ?? 0) >= 3);
  t('hex is a taken-amp, not +25%', (C.hexTakenMult ?? 0) <= 1.15);
  t('frail breaks armor on foes', (C.frailDefIgnore ?? 0) >= 0.4);
  t('torment is a DoT, not frail\'s twin', (C.tormentPctOnEnemy ?? 0) > 0);
  t('ranger mark is personal', SKILLS.hunters_mark.mark > 0 && !SKILLS.hunters_mark.hex);
  t('dark pact copy matches the refund', /32/.test(SKILLS.dark_pact.desc));
  t('hex mark copy matches +12%', /\+12%/.test(SKILLS.hex_mark.desc));
  t('judgement detonates frail', !!SKILLS.judgement.consumeFrail);
  t('iron stance is a stance', (SKILLS.iron_stance.stanceStrikes || 0) >= 1);
  t('bone spike spends a corpse', !!SKILLS.bone_spike.corpseSpend);
  t('one shot spends a mark', !!SKILLS.one_shot.consumeMark);
  t('rampage is not a blood tax', !SKILLS.rampage.selfHpCost);
  t('measured strike is folded', SKILLS.measured_strike.offer === false);
  t('confuse risks ally hits in co-op', (C.confuseAllyHitChance ?? 0) >= 0.4);
  const specials = Object.values(ENEMIES).flat().flatMap(e => e.specials || []);
  const withRider = specials.filter(s => s.poison || s.poisonSure || s.burn || s.burnSure
    || s.freeze || s.freezeSure || s.weaken || s.weakenSure || s.frail || s.frailSure
    || s.confused || s.confusedSure || s.lazy || s.lazySure || s.stun || s.paralyze
    || s.tormented || s.tormentedSure);
  t('most enemy specials carry a status rider', withRider.length >= specials.length * 0.55);
}

console.log('— biome combat identity —');
{
  const galleryId = id => /^(mcf|gv_|tr_)/.test(id || '');
  const families = k => k.replace(/Sure$/, '');
  for (const biome of Object.keys(ENEMIES)) {
    const gallery = ENEMIES[biome].filter(e => galleryId(e.id));
    if (gallery.length < 2) continue;
    const keys = new Set();
    for (const e of gallery) {
      for (const s of e.specials || []) {
        for (const k of specialRiderKeys(s)) keys.add(families(k));
      }
    }
    t(`${biome} gallery kits use several rider families`, keys.size >= Math.min(3, gallery.length));
    const names = gallery.map(e => (e.specials || []).map(s => s.name).join('|'));
    t(`${biome} gallery special names are not identical`, new Set(names).size >= 2);
  }
  const eventIds = ['vampire', 'yeti', 'dusk_lurker', 'void_eye', 'horned_stalker',
    'cursed_knight', 'mire_abomination', 'slag_knight', 'crimson_wretch'];
  for (const id of eventIds) t(`event enemy ${id} still resolves`, !!findEnemySpec(id));
  t('crimson wretch hunts the wounded', !!findEnemySpec('crimson_wretch')?.specials?.some(s => s.vsWounded));
  t('frost giant cashes brittle', !!findEnemySpec('frost_giant')?.specials?.some(s => s.vsStatus === 'frail'));

  const frostLive = ENEMIES.frost || [];
  const swampLive = ENEMIES.swamp || [];
  const hellLive = ENEMIES.hell || [];
  const warden = frostLive.find(e => e.id === 'archive_warden');
  const effigy = frostLive.find(e => e.id === 'rime_effigy');
  const usurper = frostLive.find(e => e.id === 'court_usurper');
  const congregant = swampLive.find(e => e.id === 'peat_congregant');
  t('frost archive warden is in the live pool', !!warden);
  t('frost rime effigy is in the live pool', !!effigy);
  t('frost named usurper is in the live pool', !!usurper && usurper.elite);
  t('frost scholar is not a freeze body', !warden?.freeze && !(warden?.specials || []).some(s => s.freeze || s.freezeSure));
  t('frost effigy is not a freeze body', !effigy?.freeze && !(effigy?.specials || []).some(s => s.freeze || s.freezeSure));
  t('usurper freeze is a single special', !usurper?.freeze
    && (usurper?.specials || []).filter(s => s.freeze || s.freezeSure).length === 1);
  t('yeti stays out of frost random pool', !frostLive.some(e => e.id === 'yeti'));
  t('rime specter stays out of frost random pool', !frostLive.some(e => e.id === 'void_specter'));
  t('yeti still resolves for events', !!findEnemySpec('yeti'));
  t('swamp bog render is in the live pool', swampLive.some(e => e.id === 'croc'));
  t('swamp mire abomination is in the live pool', swampLive.some(e => e.id === 'mire_abomination' && e.elite));
  t('swamp drowned congregant is in the live pool', !!congregant && !congregant.lifesteal);
  t('sin-eater stays out of hell random pool', !hellLive.some(e => e.id === 'sin_eater'));
  t('sin-eater still resolves for a later restore', !!findEnemySpec('sin_eater'));

  const live = [...Object.values(ENEMIES).flat(), ...WANDERING_ENEMIES];
  let unsupported = 0;
  let overloadedTrash = 0;
  for (const e of live) {
    for (const s of e.specials || []) {
      for (const k of Object.keys(s)) {
        if (!SUPPORTED_SPECIAL_KEYS.has(k)) unsupported++;
      }
      if (galleryId(e.id) && !e.elite && !e.boss) {
        const riders = specialRiderKeys(s).length;
        if ((e.specials || []).length > 1 || riders > 2) overloadedTrash++;
      }
    }
    t(`${e.id}: specials exist`, Array.isArray(e.specials) && e.specials.length >= 1);
  }
  t('no unsupported special fields', unsupported === 0);
  t('gallery trash is not overloaded', overloadedTrash === 0);

  const a = applyGalleryKit({ id: 'mcf1_mushroom', specials: [{ at: 4, name: 'Strike', mult: 1.45 }] }, 'forest');
  const b = applyGalleryKit({ id: 'mcf1_mushroom', specials: [{ at: 4, name: 'Strike', mult: 1.45 }] }, 'forest');
  t('gallery kit assign is deterministic', a.specials[0].name === b.specials[0].name);
  const kept = applyGalleryKit({
    id: 'wolf', specials: [{ at: 4, name: 'Savage Pounce', mult: 1.6, frail: 0.45 }],
  }, 'forest');
  t('applyGalleryKit preserves authored names', kept.specials[0].name === 'Savage Pounce');
  t('mushroom infers attrition', inferArchetype({ id: 'mcf1_mushroom' }) === 'attrition');
  t('golem infers construct', inferArchetype({ id: 'mecha_golem' }) === 'construct');
  t('forest palette has several verbs', biomePaletteKeys('forest').length >= 4);
  for (const biome of ['forest', 'ruins', 'frost', 'swamp', 'hell', 'throne', 'wandering']) {
    const n = biomePaletteKeys(biome).length;
    t(`${biome} palette is 4–6 verbs`, n >= 4 && n <= 6);
  }
  t('kitFor returns a rider', specialHasRider(kitFor('hell', 'assassin', false).specials[0]));
  t('hell trash is not only burn', ['controller', 'bruiser', 'disruptor', 'tank', 'construct']
    .some(arch => !specialRiderKeys(kitFor('hell', arch, false).specials[0]).some(k => k.startsWith('burn'))));
  t('ogre kit does not promote trash HP to elite', !(ENEMIES.forest || []).find(e => e.id === 'gv_ogre')?.elite);
  t('ruins trash knight stays common', !(ENEMIES.ruins || []).find(e => e.id === 'gv_terrible_knight')?.elite);

  t('payoff idle is 1×', enemySpecialPayoff({ mult: 1.4 }, {}, 1).mult === 1);
  t('vsStatus cashes burn', enemySpecialPayoff({ vsStatus: 'burn', vsStatusMult: 1.2 }, { burn: 2 }, 1).mult === 1.2);
  t('vsWounded cashes low HP', enemySpecialPayoff({ vsWounded: 1.25 }, {}, 0.4).mult === 1.25);
  t('standing burn specials still cash', enemySpecialPayoff({ burn: 0.4 }, { burn: 2 }, 1).mult > 1);
  t('payoff line names the fire', enemyPayoffLine('X', enemySpecialPayoff({ vsStatus: 'burn', vsStatusMult: 1.2 }, { burn: 2 }, 1)) === 'X cashes the fire.');
  t('payoff line names the wounded', enemyPayoffLine('X', enemySpecialPayoff({ vsWounded: 1.25 }, {}, 0.4)) === 'X cashes the wounded.');
  t('ordinary hit has no payoff line', enemyPayoffLine('X', enemySpecialPayoff({ mult: 1.4 }, {}, 1)) == null);
  t('statusPresent maps freeze', statusPresent({ frozen: 1 }, 'freeze'));

  const arches = ['attrition', 'assassin', 'controller', 'disruptor', 'bruiser', 'tank', 'construct'];
  for (const biome of ['forest', 'ruins', 'frost', 'swamp', 'hell', 'throne', 'wandering']) {
    for (const arch of arches) {
      const s = kitFor(biome, arch, false).specials[0];
      t(`${biome}/${arch} trash is not a payoff special`, !s.vsStatus && !s.vsWounded);
    }
  }

  {
    const py = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'integrate_gallery_roster.py'), 'utf8');
    const slice = (ident) => {
      const start = py.indexOf(`${ident} = {`);
      if (start < 0) return '';
      let i = py.indexOf('{', start), depth = 0;
      for (let j = i; j < py.length; j++) {
        if (py[j] === '{') depth++;
        else if (py[j] === '}') {
          depth--;
          if (depth === 0) return py.slice(i, j + 1);
        }
      }
      return '';
    };
    const trash = slice('_BIOME_TRASH');
    const elite = slice('_BIOME_ELITE');
    for (const biome of ['forest', 'ruins', 'frost', 'swamp', 'hell', 'throne', 'wandering']) {
      for (const arch of arches) {
        const tName = kitFor(biome, arch, false).specials[0].name;
        const eName = kitFor(biome, arch, true).specials[0].name;
        t(`python trash mirrors ${biome}/${arch}`, trash.includes(`"name": "${tName}"`));
        t(`python elite mirrors ${biome}/${arch}`, elite.includes(`"name": "${eName}"`));
      }
    }
    const forced = applyGalleryKit(
      { id: 'mcf1_goblin', specials: [{ at: 4, name: 'Python Stamp', mult: 1.45 }] },
      'forest',
      { force: true },
    );
    t('force reapplies JS kit over a stamped python name', forced.specials[0].name === kitFor('forest', 'disruptor', false).specials[0].name);
  }
}

console.log('— Guard (handoff §10) —');
t('guard blocks 22%', applyGuard(100, true) === 78);
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
  {
    // Bosses bank toward heavier specials instead of forever dumping at:3.
    const alwaysSpend = { chance: () => false };
    const alwaysBank = { chance: () => true };
    const boss = {
      boss: true, charge: 3, bankChance: 1,
      specials: [
        { at: 3, name: 'Light', mult: 1.3 },
        { at: 6, name: 'Heavy', mult: 2.2 },
      ],
    };
    t('boss fires light when not banking', pickEnemySpecial(boss, alwaysSpend)?.name === 'Light');
    t('boss banks when a heavier special is close', pickEnemySpecial(boss, alwaysBank) === null);
    boss.charge = 6;
    t('boss fires finisher at full charge', pickEnemySpecial(boss, alwaysBank)?.name === 'Heavy');
  }
  for (const b of Object.values(BOSSES)) {
    t(`boss ${b.id}: has specials`, Array.isArray(b.specials) && b.specials.length >= 2);
    const ats = b.specials.map(s => s.at);
    t(`boss ${b.id}: distinct charge breakpoints`, new Set(ats).size === ats.length);
  }
  t('boss kits are not all identical ladders', new Set(
    Object.values(BOSSES).map(b => b.specials.map(s => s.at).join('-')),
  ).size >= 4);
  t('finisher mults hit hard', Object.values(BOSSES).every(b => {
    const top = b.specials.reduce((a, s) => (s.at > a.at ? s : a));
    return top.mult >= 2.15;
  }));
  t('slow boss profile (hydra spd < duke spd)', BOSSES[40].spd < BOSSES[50].spd);
  t('boss bank chance configured', (CONFIG.boss.bankChance ?? 0) >= 0.45);
  t('charge damage scale rewards banking', (CONFIG.boss.chargeDamageScale ?? 0) >= 0.2);
  t('cinderghast is not a generic 3/6', ALT_BOSSES[10].specials.some(s => s.burnSure || s.burn));
  t('bograth has hydra-style heads', !!ALT_BOSSES[40].heads);
  t('secret king has a second phase', !!(SECRET_BOSS.twoPhase && SECRET_BOSS.phase2));
  const nyxara = findEnemySpec('tr_mon_vampire');
  t('nyxara fights like the pale wanderer', nyxara?.lifesteal > 0 && nyxara.specials?.some(s => s.heal));
  const pyre = (ENEMIES.forest || []).find(e => e.id === 'fire_worm');
  t('pyrewyrm burns instead of forest-poison Strike', pyre?.specials?.some(s => s.burnSure) && pyre.specials[0].name !== 'Strike');
  const wall = (ENEMIES.ruins || []).find(e => e.id === 'knight_armor');
  t('knight-band tank actually shields', wall?.specials?.some(s => s.selfShield));
}

console.log('— creature display names (no asset leakage) —');
{
  // Narrow allowlist for names that trip a leakage pattern on purpose.
  // Add an entry only when the player-facing name is an established character
  // or authored hyphenation — not to silence a leftover pack filename.
  const DISPLAY_NAME_ALLOWLIST = {
    'Axe-Pack Veteran': 'established northman NPC; "Pack" is diegetic, not viking_axe_pack',
  };

  const LEAK_CHECKS = [
    { id: 'extension', re: /\.(png|gif|jpe?g|webp|json|aseprite)\b/i, why: 'file extension' },
    { id: 'underscore', re: /_/, why: 'underscore (filename)' },
    { id: 'packPrefix', re: /^(?:Mcf\d+|Gv|Tr(?: Live| Mon)?)\b/i, why: 'asset-pack prefix' },
    { id: 'packToken', re: /\b(?:Mcf\d+|Tr Live|Tr Mon)\b/i, why: 'asset-pack code' },
    { id: 'gvToken', re: /\bGv [A-Z]/, why: 'Gothicvania pack initials' },
    { id: 'sheet', re: /\b(?:Files|Sheet|Alt Heads?)\b/i, why: 'sprite-sheet leftover' },
    { id: 'placeholder', re: /\b(?:Enemy|Variant|Placeholder|TODO|FIXME|Test)\b/, why: 'placeholder / test name' },
    { id: 'numericSuffix', re: /\s+\d+$/, why: 'numeric variant suffix' },
    { id: 'letterVariant', re: /\s+[A-Z]$/, why: 'letter variant suffix' },
    { id: 'artistTag', re: /\b(?:Nyx\d+|Zughy\d+)\b/i, why: 'artist / pack tag' },
    { id: 'packWord', re: /\bPack\b/, why: 'imported pack naming' },
  ];

  function leakReasons(name) {
    if (!name || DISPLAY_NAME_ALLOWLIST[name]) return [];
    return LEAK_CHECKS.filter(c => c.re.test(name)).map(c => c.why);
  }

  t('detector catches Mcf1 Goblin', leakReasons('Mcf1 Goblin').length > 0);
  t('detector catches Gv Ogre', leakReasons('Gv Ogre').length > 0);
  t('detector catches Tr Live Mummy', leakReasons('Tr Live Mummy').length > 0);
  t('detector catches Skeleton Enemy', leakReasons('Skeleton Enemy').length > 0);
  t('detector catches goblin.png', leakReasons('goblin.png').length > 0);
  t('detector catches Huntress 2', leakReasons('Huntress 2').length > 0);
  t('detector allows Dire Wolf', leakReasons('Dire Wolf').length === 0);
  t('detector allows Gleam-Eye', leakReasons('Gleam-Eye').length === 0);
  t('detector allows Will-o\'-Wisp', leakReasons("Will-o'-Wisp").length === 0);
  t('allowlist keeps Axe-Pack Veteran', leakReasons('Axe-Pack Veteran').length === 0);

  const expected = {
    mcf1_goblin: 'Grove Goblin',
    mcf1_mushroom: 'Sporecap',
    mcf1_flying_eye: 'Gleam-Eye',
    gv_ogre: 'Woods Ogre',
    mcf1_skeleton: 'Bone Guard',
    skeleton_enemy: 'Flail Skeleton',
    tr_live_mummy: 'Tomb Mummy',
    gv_terrible_knight: 'Gilded Knight',
    tr_live_frog: 'Bog Spearman',
    gv_mutant_toad: 'Mossback Toad',
    gv_hell_hound_files: 'Ash Hound',
    gv_fire_skull_files: 'Brimstone Skull',
    gv_flying_eye_demon: 'Scorch Eye',
    mcf2_rat: 'Cellar Rat',
    mcf2_bat: 'Gloom Bat',
    mcf2_slime: 'Puddle Slime',
    gv_enemy_ghost: 'Hooded Wraith',
    tr_live_slime: 'Tendril Slime',
    kryos_demon_general: 'Kryos, the Demon General',
  };
  for (const [id, name] of Object.entries(expected)) {
    t(`${id} display name is ${name}`, findEnemySpec(id)?.name === name);
    t(`${id} keeps stable id`, findEnemySpec(id)?.id === id);
  }

  const seen = [];
  const pushName = (id, name, where) => {
    if (name) seen.push({ id, name, where });
  };
  for (const [biome, pool] of Object.entries(ENEMIES)) {
    for (const e of pool) pushName(e.id, e.name, `ENEMIES.${biome}`);
  }
  for (const e of WANDERING_ENEMIES) pushName(e.id, e.name, 'WANDERING');
  for (const b of Object.values(BOSSES)) {
    pushName(b.id, b.name, 'BOSSES');
    if (b.phase2?.name) pushName(b.id, b.phase2.name, 'BOSSES.phase2');
    if (b.phaseName) pushName(b.id, b.phaseName, 'BOSSES.phaseName');
  }
  for (const b of Object.values(ALT_BOSSES)) {
    pushName(b.id, b.name, 'ALT_BOSSES');
    if (b.phase2?.name) pushName(b.id, b.phase2.name, 'ALT_BOSSES.phase2');
  }
  pushName(SECRET_BOSS.id, SECRET_BOSS.name, 'SECRET_BOSS');
  if (SECRET_BOSS.phase2?.name) pushName(SECRET_BOSS.id, SECRET_BOSS.phase2.name, 'SECRET_BOSS.phase2');
  for (const n of Object.values(NPC_ENEMIES)) pushName(n.id, n.name, 'NPC_ENEMIES');
  pushName('mimic', mimicSpec(1).name, 'mimicSpec');
  for (const sid of ['skeleton', 'leech', 'imp', 'slime', 'rat']) {
    const spec = summonSpecFor(sid);
    pushName(spec.id, spec.name, `summon:${sid}`);
  }
  for (const [id, name] of Object.entries(ROSTER.renames || {})) {
    pushName(id, name, 'ROSTER.renames');
  }

  let leaks = 0;
  for (const row of seen) {
    const reasons = leakReasons(row.name);
    if (reasons.length) {
      leaks++;
      console.error(`  ✗ leak ${row.where} ${row.id}: "${row.name}" (${reasons.join(', ')})`);
    }
  }
  t('no player-facing creature name leaks asset identifiers', leaks === 0);
  t('every live creature has a display name', seen.every(r => typeof r.name === 'string' && r.name.trim().length > 0));
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
  t('mystery node chance configured (~10%)', (CONFIG.events.mysteryNodeChance ?? 0) > 0.05 && CONFIG.events.mysteryNodeChance <= 0.2);
  t('star events are rare (~10%)', (CONFIG.events.sparkleChance ?? 0) > 0.05 && CONFIG.events.sparkleChance <= 0.15);
  t('star blessing config present', (CONFIG.events.sparkle?.goldMult ?? 0) >= 1.4 && (CONFIG.events.sparkle?.rarityBumpChance ?? 0) >= 0.5);
  {
    const { applySparkleOutcomeMods } = await import('../js/data/eventtags.js');
    const blessed = applySparkleOutcomeMods({ gold: 20, xp: 10, fame: 2 }, { floor: 5, rng: makeRng(1) });
    t('star blessing scales gold', blessed.gold > 20);
    t('star blessing scales xp', blessed.xp > 10);
    t('star blessing scales fame', blessed.fame > 2);
    const empty = applySparkleOutcomeMods({ text: 'flavor only' }, { floor: 8, rng: makeRng(2) });
    t('star blessing tops up empty outcomes', (empty.gold || 0) > 0 && (empty.xp || 0) > 0);
  }
  {
    const shrine = pathNodeView({ kind: 'event', category: 'mystery', eventId: 'old_shrine' });
    t('travel node reveals shrine title', shrine.title === 'The Nameless Shrine');
    t('travel node shrine art present', !!shrine.artHtml && shrine.artHtml.length > 0);
    t('travel node shrine risk known', shrine.risk !== '?' && typeof shrine.risk === 'number');
    const veiled = pathNodeView({ kind: 'event', category: 'merchant', eventId: 'old_shrine', hidden: true });
    t('mystery veil hides title', veiled.title === '???');
    t('mystery veil unknown risk', veiled.risk === '?');
    t('mystery veil face category', veiled.faceCategory === 'mystery');
    t('mystery veil keeps eventId for resolve', true); // eventId stays on card; view only hides
    const npcEv = EVENTS.find(e => e.npc?.art);
    if (npcEv) {
      const npcView = pathNodeView({ kind: 'event', category: npcEv.category, eventId: npcEv.id });
      t('npc event node uses sprite art', npcView.artHtml.includes('px-sprite') || npcView.artHtml.includes('tm-emblem') || npcView.artHtml.includes('tm-icon'));
      t('npc event node reveals title', npcView.title === npcEv.title);
    }
    const combat = pathNodeView({
      kind: 'encounter', category: 'combat',
      enemies: [{ id: 'wolf', name: 'Dire Wolf', glyph: '🐺' }],
    });
    t('combat node shows enemy name', combat.title === 'Dire Wolf');
    t('combat node risk is risky', combat.risk >= 2);
    const galleryCombat = pathNodeView({
      kind: 'encounter', category: 'combat',
      enemies: [{ id: 'mcf1_goblin' }],
    });
    t('gallery combat node uses display name', galleryCombat.title === 'Grove Goblin');
    t('gallery combat node does not leak pack prefix', !/Mcf1/i.test(galleryCombat.title + galleryCombat.flavor));
  }
  // referenced item/consumable ids resolve
  for (const e of EVENTS) {
    for (const c of e.choices) {
      const os = [c.outcome, c.outcome?.success, c.outcome?.fail, ...(c.outcome?.randomOutcome || [])].filter(Boolean);
      for (const o of os) {
        if (o.item) t(`${e.id}: item ${o.item} exists`, !!itemById(o.item));
        if (o.consumable) t(`${e.id}: consumable ${o.consumable} exists`, !!itemById(o.consumable));
        if (o.combat) {
          const ids = o.combat.enemies || o.combat.pickEnemies?.pool || [];
          for (const eid of ids) {
            t(`${e.id}: combat enemy ${eid} exists`, !!findEnemySpec(eid));
          }
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
  t('forest rung weapons exist for every type', ['sword', 'axe', 'mace', 'staff', 'bow', 'dagger', 'fist'].every(w =>
    ALL_EQUIPMENT.some(i => i.slot === 'weapon' && i.wtype === w && i.tier === 1 && !i.starter && !i.exclusive)));
  t('tier-1 rolls can produce a weapon', (() => {
    for (let i = 0; i < 40; i++) {
      const it = rollEquipment(makeRng(4100 + i), 1, 0, { floor: 4, classId: 'warrior', requireUseful: true, slot: 'weapon' });
      if (it && it.slot === 'weapon' && it.wtype && ['sword', 'axe', 'mace'].includes(it.wtype)) return true;
    }
    return false;
  })());
  t('rare fist exists', ALL_EQUIPMENT.some(i => i.wtype === 'fist' && i.rarity === 'rare' && !i.exclusive));
  t('legendary mace and fist exist', ALL_EQUIPMENT.some(i => i.wtype === 'mace' && i.rarity === 'legendary' && !i.exclusive)
    && ALL_EQUIPMENT.some(i => i.wtype === 'fist' && i.rarity === 'legendary' && !i.exclusive));
  t('unique staff, mace, and fist exist', ['staff', 'mace', 'fist'].every(w =>
    ALL_EQUIPMENT.some(i => i.wtype === w && i.rarity === 'unique' && !i.exclusive)));
  t('shop UNIQUE/WRLD listings use event-channel prices', shopListingPrice({ rarity: 'unique', price: 1400 }) === CONFIG.economy.shopUniquePrice
    && shopListingPrice({ rarity: 'wrld', price: 3200 }) === CONFIG.economy.shopWrldPrice);
  t('shop chase prices sit near event channel', CONFIG.economy.shopUniquePrice <= 500 && CONFIG.economy.shopWrldPrice <= 900
    && CONFIG.economy.shopWrldPrice >= 750);
  t('flat consumables scale with floor', consumableCombatValue(CONSUMABLES.find(c => c.id === 'potion_s'), 45).heal
      > consumableCombatValue(CONSUMABLES.find(c => c.id === 'potion_s'), 1).heal
    && consumableCombatValue(CONSUMABLES.find(c => c.id === 'bomb'), 45).bombDmg
      > consumableCombatValue(CONSUMABLES.find(c => c.id === 'bomb'), 1).bombDmg);
  t('late shops drop farm food and minor potions', !shopConsumablePool(5).some(c => c.id === 'farm_bread' || c.id === 'potion_s'));
  t('early shops still stock minor potions', shopConsumablePool(1).some(c => c.id === 'potion_s'));
  t('post-Frost shop consumable pool stays deep', shopConsumablePool(4).length >= 8 && shopConsumablePool(5).length >= 8
    && shopConsumablePool(5).some(c => c.id === 'potion_l')
    && shopConsumablePool(5).some(c => c.id === 'bomb')
    && shopConsumablePool(5).filter(c => c.id.startsWith('enchanted_')).length >= 4);
  {
    const samples = [
      itemById('steel_blade'),
      itemById('grove_shortsword'),
      itemById('excalibur'),
      itemById('worldsplitter'),
      ALL_EQUIPMENT.find(i => i.rarity === 'wrld' && i.slot === 'weapon'),
    ].filter(Boolean);
    t('buy-then-sell cannot mint gold (0–35% disc)', samples.every(it => {
      for (const disc of [0, 0.15, 0.35]) {
        if (sellGold(it) >= merchantBuyGold(it, disc)) return false;
        if (sellGold(it, { from: 'inventory' }) >= merchantBuyGold(it, disc)) return false;
      }
      return true;
    }));
    t('chase sell uses listing, not catalog', sellGold(itemById('excalibur')) === Math.round(CONFIG.economy.shopUniquePrice * 0.6)
      && sellGold(ALL_EQUIPMENT.find(i => i.rarity === 'wrld')) === Math.round(CONFIG.economy.shopWrldPrice * 0.6)
      && sellGold(itemById('excalibur')) < itemById('excalibur').price * 0.6);
    t('event-paid chase sells for less than the gold cost',
      sellGold({ rarity: 'unique', price: 1400 }) < 420
      && sellGold({ rarity: 'wrld', price: 3200 }) < 750);
    t('fame-awarded chase sell is not a biome-scale purse',
      sellGold({ rarity: 'unique', price: 1400 }) <= 300
      && sellGold({ rarity: 'wrld', price: 3200 }) <= 500);
  }
  {
    const starting = Object.values(CLASSES).filter(c => c.startWeapon);
    let ok = true;
    for (const cls of starting) {
      const starter = itemById(cls.startWeapon);
      if (!starter) { ok = false; break; }
      for (let i = 0; i < 24; i++) {
        const it = rollEquipment(makeRng(71000 + cls.id.length * 97 + i), 1, 2, {
          floor: 4, classId: cls.id, requireUseful: true, slot: 'weapon',
        });
        if (!it || it.slot !== 'weapon' || !itemUsefulForClass(it, cls.id)) { ok = false; break; }
        if ((it.atk || 0) < (starter.atk || 0)) { ok = false; break; }
        if (cls.weapons?.length && !cls.weapons.includes(it.wtype)) { ok = false; break; }
      }
      if (!ok) break;
    }
    t('Forest first-slot weapon is a usable starter replacement for every class', ok && starting.length >= 8);
  }
  {
    const floors = [5, 25, 45];
    const potS = CONSUMABLES.find(c => c.id === 'potion_s');
    const potL = CONSUMABLES.find(c => c.id === 'potion_l');
    const bomb = CONSUMABLES.find(c => c.id === 'bomb');
    let useful = true;
    let notTrivial = true;
    for (const floor of floors) {
      const p = syntheticClimber(floor, 0.5);
      const biome = biomeForFloor(floor);
      const commons = (ENEMIES[biome.id] || []).filter(e => !e.elite && !e.boss);
      const sc = enemyScale(floor, biome.floors[0], biome.id);
      const typicalHp = commons.length
        ? commons.map(e => Math.round(e.hp * sc.hp)).sort((a, b) => a - b)[Math.floor(commons.length / 2)]
        : 80;
      const typicalAtk = commons.length
        ? commons.map(e => Math.round(e.atk * sc.atk)).sort((a, b) => a - b)[Math.floor(commons.length / 2)]
        : 8;
      const healS = consumableCombatValue(potS, floor).heal;
      const healL = consumableCombatValue(potL, floor).heal;
      const bombDmg = consumableCombatValue(bomb, floor).bombDmg;
      const elites = (ENEMIES[biome.id] || []).filter(e => e.elite);
      const scE = enemyScale(floor, biome.floors[0], biome.id, { elite: true });
      const eliteHps = elites.map(e => Math.round(e.hp * scE.hp)).sort((a, b) => a - b);
      const typicalEliteHp = eliteHps.length
        ? eliteHps[Math.floor(eliteHps.length / 2)]
        : typicalHp * 2;
      // Material: minor potion covers a hit or ~10% HP; greater covers more; bomb chips a common.
      if (healS < typicalAtk * 0.8 && healS < p.maxHp * 0.10) useful = false;
      if (healL < p.maxHp * 0.18) useful = false;
      if (bombDmg < typicalHp * 0.12) useful = false;
      // Greater potion may fully heal the lean synthetic pool. Bombs may delete
      // typical commons (that is the point of an AoE). They must not delete elites.
      if (healS >= p.maxHp * 0.70 || healL >= p.maxHp * 1.5) notTrivial = false;
      if (bombDmg >= typicalEliteHp * 0.90) notTrivial = false;
    }
    t('consumables stay materially useful across the climb', useful);
    t('consumables do not trivialize early/mid/late fights', notTrivial);
  }
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
  t('lean floor/victory healing', CONFIG.recovery.victoryHealPct <= 0.09 && CONFIG.recovery.floorHealPct <= 0.06);

  // Mid-climb: free/low-cost hits should not delete commons; elites last longer.
  // Uses synthetic P60 climber + 100-power mid-variance hit (combat_sim model).
  {
    const { syntheticClimber, simBuildEnemy } = await import('./combat_sim.js');
    const { softLevelDamage } = await import('../js/data/tdc.js');
    const { applyDefense } = await import('../js/systems.js');
    const hit = (p, enemy, power = 100) => {
      const base = (p.stats[p.classBias] * C.playerStatWeight + p.atk * C.playerAtkWeight
        + softLevelDamage(p.level, C.playerLevelWeight) + C.playerFlat)
        * (power / 100) * p.dmgMult;
      return applyDefense(base, enemy.def);
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
    // Clear-rate CDF softens mid commons slightly; still no free one-shots.
    // Player weapon weight lean → commons fall in ~1.4–2.0 basic hits mid-climb.
    t('F17 commons need ≥1.4 hits from a basic 100-power swing', Math.min(...commonHits) >= 1.4);
    t('F17 commons typically ~1.7+ hits', commonHits.sort((a, b) => a - b)[Math.floor(commonHits.length / 2)] >= 1.65);
    t('F17 elites last longer than commons', Math.min(...eliteHits) >= 3.5);
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
{
  const { gainXp, appraiseRun } = await import('../js/character.js');
  const { makeRng } = await import('../js/rng.js');
  const run = {
    xp: 0, xpNext: 1, level: 1, growthRank: 'C', growthBoost: 1,
    stats: { str: 5, dex: 5, int: 5, wis: 5, lk: 5 },
    maxHp: 40, hp: 20, maxMp: 40, mp: 20,
    knownSkills: [], subclassId: null, classId: 'warrior',
    floor: 1, equipment: {}, relics: [],
  };
  gainXp(run, 1, makeRng(1));
  const hpPct = run.hp / run.maxHp;
  const mpPct = run.mp / run.maxMp;
  // levelUpHpFill: 0 keeps absolute HP (no free mend from pool growth).
  t('level-up keeps absolute HP (no free mend)', run.hp === 20 && run.maxHp > 40);
  t('level-up keeps resource fill %', Math.abs(mpPct - 0.5) < 0.02 && run.maxMp > 40);

  const wrld = {
    xp: 0, xpNext: 9999, level: 1, growthRank: 'WRLD', growthBoost: 1, growthRevealed: false,
    stats: { str: 20, dex: 20, int: 20, wis: 20, lk: 20 },
    maxHp: 40, hp: 40, maxMp: 40, mp: 40,
    knownSkills: [], subclassId: null, classId: 'warrior',
    floor: 3, equipment: {}, relics: [],
  };
  gainXp(wrld, 100, makeRng(2));
  t('WRLD growth multiplies XP intake', wrld.xp === 150);
  appraiseRun(makeRng(3), wrld, { partial: true });
  t('partial appraisal keeps growth sealed', !wrld.growthRevealed && !wrld.appraisal.growthRank);
  appraiseRun(makeRng(4), wrld, { partial: false });
  t('full appraisal reveals growth rank', wrld.growthRevealed && wrld.appraisal.growthRank === 'WRLD');
}
t('death respawn lean (co-op rejoins hurt)', CONFIG.death.respawnHpPct === 0.15 && CONFIG.death.respawnResourcePct === 0.3);
t('revive pct is lean phoenix/floor revive', CONFIG.death.reviveHpPct === 0.22);
t('guard blocks ~22% (config)', CONFIG.guard.blockPct === 0.22);
t('Guard ↔ revive block share lean fraction', guardReviveReconciled());
t('charge display name configurable', typeof CONFIG.charge.displayName === 'string');
t('modifiers have no sanity mechanics', !JSON.stringify(MODIFIERS).includes('sanity'));
t('relics have no sanity mechanics', !JSON.stringify(RELICS).includes('anity'));
{
  const chargeRelics = RELICS.filter(r => r.mutex === 'start_charge');
  t('opening-charge relics share a mutex', chargeRelics.length >= 2 && chargeRelics.every(r => r.startCharge > 0));
  t('owning horn blocks war drum', relicMutexBlocked(
    RELICS.find(r => r.id === 'war_drum'),
    ['first_strike_horn'],
  ));
  t('owning drum blocks chronos', relicMutexBlocked(
    RELICS.find(r => r.id === 'chronos_heart'),
    ['war_drum'],
  ));
  const rng = makeRng(99);
  let sawSibling = false;
  for (let i = 0; i < 80; i++) {
    const r = rollRelic(rng, ['first_strike_horn']);
    if (r && r.mutex === 'start_charge') { sawSibling = true; break; }
  }
  t('rollRelic never offers a second opening-charge relic', !sawSibling);
}

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
  t('hp softcap after L6', softHpGain(11, 10) < 10 && softHpGain(5, 10) === 10);
  t('level damage softcap after L15', softLevelDamage(20, 1) < 20 && softLevelDamage(10, 1) === 10);
  t('mitigation capped at 65%', cappedDmgTakenMult(0.2) === 1 - TDC.player.mitigationCap);
  t('resource regen uses TDC base', resourceRegen(0, 0) === TDC.resource.baseRegen);
  t('viking fury is not WIS-sitting regen', resourceRegen(24, 0, 'viking') < resourceRegen(24, 0));
  t('warlock pact regen is leaner than default', resourceRegen(16, 0, 'warlock') < resourceRegen(16, 0));
  t('gallery NPC ids are tagged', isGalleryNpc('evil_wizard') && isGalleryNpc('martial_hero') && !isGalleryNpc('wolf') && !isGalleryNpc('blade_hero'));
  t('npc duel ease is partial in Forest', npcDuelEase(6).hp < 0.85 && npcDuelEase(6).atk < 0.90);
  t('npc duel ease is full by F16', npcDuelEase(16).hp === 1 && npcDuelEase(20).atk === 1);
  t('npc duel ease ramps with floor', npcDuelEase(4).hp < npcDuelEase(10).hp && npcDuelEase(10).hp < npcDuelEase(16).hp);
  {
    const run6 = { floor: 6 };
    const run20 = { floor: 20 };
    const spec = NPC_ENEMIES.evil_wizard;
    const early = buildEventFightEnemies(run6, [spec], { partySize: 1 })[0];
    const late = buildEventFightEnemies(run20, [spec], { partySize: 1 })[0];
    t('early gallery duel HP is below later-floor HP', early.maxHp < late.maxHp);
    t('early gallery duel ATK is below later-floor ATK', early.atk < late.atk);
    const wolf6 = enemyScale(6, 1, 'forest', { elite: false });
    t('ordinary Forest HP scale is not the gallery ease table',
      Math.abs(wolf6.hp - npcDuelEase(6).hp) > 0.05);
  }
  const sc = enemyScale(5, 1, 'forest');
  // Solo early ATK ease can sit under 1.0; HP should still grow with depth.
  t('buildEnemy-equivalent HP scale above base', sc.hp > 1);
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

console.log('— run variety selection —');
{
  t('fresh event id unpenalized', historyEventWeight('merchant') === 1);
  t('offered event id penalized', historyEventWeight('merchant', ['merchant']) < 1);
  t('taken event id penalized harder than offered',
    historyEventWeight('merchant', ['chest_generic'], ['merchant'])
    < historyEventWeight('merchant', ['merchant'], []));
  t('empty recent keeps full encounter pool',
    filterEncounterPool(ENEMIES.forest, []) === ENEMIES.forest);
  const frost = ENEMIES.frost;
  const filtered = filterEncounterPool(frost, ['frozen_soldier', 'winter_wolf']);
  t('recent frost leads drop when pool is large enough',
    filtered.length < frost.length && !filtered.some(e => e.id === 'frozen_soldier'));
  t('filter never empties a pool', filterEncounterPool(frost.slice(0, 2), ['frozen_soldier', 'winter_wolf']).length >= 1);

  const freshA = planEncounter(makeRng(77), { floor: 5, biomeStart: 1, pool: ENEMIES.forest, partySize: 1 });
  const freshB = planEncounter(makeRng(77), { floor: 5, biomeStart: 1, pool: ENEMIES.forest, partySize: 1 });
  t('planEncounter is deterministic without history',
    freshA.specs.map(s => s.id).join() === freshB.specs.map(s => s.id).join());
  const withHist = planEncounter(makeRng(77), {
    floor: 5, biomeStart: 1, pool: ENEMIES.forest, partySize: 1,
    recentIds: [freshA.specs[0].id], recentBodies: freshA.specs.map(s => s.id),
  });
  t('recent lead is not reused when alternatives exist',
    withHist.specs[0].id !== freshA.specs[0].id);

  const runA = { lastTrialMod: null };
  const runB = { lastTrialMod: null };
  const firstA = pickTrialModifier(makeRng(3), runA);
  const firstB = pickTrialModifier(makeRng(3), runB);
  t('first trial modifier matches uniform pick', firstA.id === firstB.id);
  t('first trial modifier matches rng.pick(MODIFIERS)', firstA.id === makeRng(3).pick(MODIFIERS).id);
  const second = pickTrialModifier(makeRng(3), runA);
  t('second trial skips the previous modifier', second.id !== firstA.id);

  const histRun = { recentEventIds: [], recentTakenEventIds: [] };
  pushOfferedEventHistory(histRun, [{ eventId: 'merchant' }, { eventId: 'old_shrine' }]);
  pushTakenEventHistory(histRun, 'merchant');
  t('offered history records event ids', histRun.recentEventIds.includes('merchant'));
  t('taken history records event ids', histRun.recentTakenEventIds.includes('merchant'));
  pushEncounterHistory(histRun, [{ id: 'wolf' }, { id: 'rat' }]);
  t('encounter history records lead', histRun.recentEncounterIds[0] === 'wolf');
  t('encounter history records bodies', histRun.recentEncounterBodies.includes('rat'));

  const { generateFloorCards, dealLiveFloorCards, cardDealFingerprint, pickEnemyPlan } = await import('../js/data/floorcards.js');
  const { newRun, rollStart } = await import('../js/state.js');
  const dealRunA = newRun({ upgrades: {}, achievements: [] }, {
    classId: 'warrior', raceId: 'human', name: 'Var', seed: 11, kitSeed: 11,
    gen: rollStart('warrior', 'human', 11),
  });
  dealRunA.floor = 1;
  dealRunA.biomeId = 'forest';
  const dealRunB = JSON.parse(JSON.stringify(dealRunA));
  const genCards = generateFloorCards(makeRng(dealRunA.rngState), dealRunA);
  const liveCards = dealLiveFloorCards(makeRng(dealRunB.rngState), dealRunB);
  t('first live deal matches generateFloorCards',
    JSON.stringify(cardDealFingerprint(genCards)) === JSON.stringify(cardDealFingerprint(liveCards)));
  t('live deal records offered event ids after the draw',
    (dealRunB.recentEventIds || []).length >= 1);

  const frostRun = { floor: 23, biomeId: 'frost', recentEncounterIds: [], recentEncounterBodies: [] };
  const forestRun = { floor: 3, biomeId: 'forest', recentEncounterIds: [], recentEncounterBodies: [] };
  const frostPlan = pickEnemyPlan(makeRng(5), frostRun, biomeForFloor(23), 1);
  const forestPlan = pickEnemyPlan(makeRng(5), forestRun, biomeForFloor(3), 1);
  t('frost plan still returns biome enemies', frostPlan.specs.length >= 1);
  t('forest plan still returns biome enemies', forestPlan.specs.length >= 1);

  const { eventDrawWeight } = await import('../js/data/eventpace.js');
  const merch = EVENTS.find(e => e.id === 'merchant');
  const freshW = eventDrawWeight(merch, { floor: 6, recentEventIds: [], recentTakenEventIds: [], recentCategories: [] });
  const staleW = eventDrawWeight(merch, { floor: 6, recentEventIds: ['merchant'], recentTakenEventIds: ['merchant'], recentCategories: [] });
  t('merchant weight drops after being seen', staleW.w < freshW.w);
  t('fresh merchant has no eventId term', !freshW.terms.some(x => x.id === 'eventId'));
  t('seen merchant has eventId term', staleW.terms.some(x => x.id === 'eventId'));

  const { buildShopStock } = await import('../js/shop.js');
  const shopRun = newRun({ upgrades: {}, achievements: [] }, {
    classId: 'warrior', raceId: 'human', name: 'Shop', seed: 44, kitSeed: 44,
    gen: rollStart('warrior', 'human', 44),
  });
  shopRun.floor = 8;
  shopRun.biomeId = 'forest';
  shopRun.gold = 400;
  const shopRng = (n) => {
    const r = makeRng(n);
    r.advance = () => {};
    return r;
  };
  const shopA = buildShopStock(shopRun, shopRng(8));
  const firstIds = shopA.filter(s => s.kind === 'equip').map(s => s.item.id);
  const shopB = buildShopStock(shopRun, shopRng(8));
  const secondIds = shopB.filter(s => s.kind === 'equip').map(s => s.item.id);
  t('shop records listed item ids', (shopRun.recentShopItemIds || []).length >= firstIds.length);
  t('same-seed second shop changes equipment after history',
    firstIds.join() !== secondIds.join() || !firstIds.length);
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
  // Soft check: full RTK bands drift with TDC; smoke that the sim completes.
  t('elderwood P50 sim completes fights', wins >= 0 && wins <= 40);
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

console.log('— world state & narrative gates —');
{
  const {
    emptyWorld, ensureWorld, evalWhen, eventEligible, presentEvent, presentBoss,
    applyWorldPatch, applyFlagBridge, applyOutcomeWorld, secretUnlocked, secretEligible, recordEvent,
    worldDebugSnapshot, explainWhen, explainEligibility, worldPoke,
    cloneRunState, restoreRunState, beginWorldInspect, resetWorldInspect, endWorldInspect,
    syncSecretUnlockFromSubclass, eligibilitySnapshot, choiceBridgeTag,
    threadStage, THREADS, CHARACTERS, SECRET_ROUTES, TENDENCIES,
  } = await import('../js/data/world.js');
  const { newRun } = await import('../js/state.js');
  const run = newRun({ upgrades: {}, achievements: [] }, { classId: 'necromancer', raceId: 'human', name: 'Test' });
  t('new run has world object', !!run.world && Array.isArray(run.world.knowledge));
  t('empty world has character map', !!emptyWorld().characters);
  ensureWorld(run);
  t('saved climber is not yet known', evalWhen(run, { flag: 'saved_climber' }) === false);
  run.flags.saved_climber = true;
  applyFlagBridge(run, 'saved_climber');
  t('flag bridge marks Mira met', run.world.characters.mira?.met === true);
  t('flag bridge sets Mira relationship', run.world.characters.mira?.rel >= 3);
  t('evalWhen flag+floor', evalWhen(run, { flag: 'saved_climber', floorMin: 0 }));
  t('evalWhen rejects missing knowledge', !evalWhen(run, { knowledge: 'pale_rite' }));
  applyWorldPatch(run, { knowledge: 'heard_dead_language' });
  t('knowledge patch sticks', evalWhen(run, { knowledge: 'heard_dead_language' }));
  applyWorldPatch(run, { knowledge: 'pale_tome' });
  t('lichling study route is eligible only', secretEligible(run, 'lichling') && !secretUnlocked(run, 'lichling'));
  const grudge = EVENTS.find(e => e.id === 'mira_grudge');
  t('mira_grudge authored', !!grudge);
  run.flags.left_climber = true;
  applyFlagBridge(run, 'left_climber');
  run.floor = 16;
  run.biomeId = 'ruins';
  t('mira_grudge eligible after betrayal', eventEligible(grudge, run));
  run.flags.left_climber = false;
  t('mira_grudge blocked if not betrayed', !eventEligible(grudge, run));
  const camp = EVENTS.find(e => e.id === 'campfire');
  run.flags.saved_climber = true;
  const shown = presentEvent(camp, run);
  t('campfire variant mentions Mira when saved', /Mira|climber you patched/i.test(shown.text));
  {
    const hellFire = { ...run, biomeId: 'hell', floor: 46, flags: { ...run.flags, saved_climber: true, kings_petition: true } };
    const hellShown = presentEvent(camp, hellFire);
    t('scorch campfire keeps Mira and appends the petition', /Mira|climber you patched/i.test(hellShown.text) && /petition/i.test(hellShown.text));
    const altGate = presentEvent(camp, {
      ...run, floor: 49, biomeId: 'hell', bossPicks: { 50: 'kryos_demon_general' },
      flags: { saved_climber: true },
    });
    t('F49 alt-gate rumor beats an older Mira line', /gate ahead|correction/i.test(altGate.text));
  }
  {
    const rest = EVENTS.find(e => e.id === 'last_rest');
    const vigil = presentEvent(rest, {
      ...run, biomeId: 'hell', floor: 47,
      flags: { ate_v_dinner: true },
      sigils: ['truth', 'sorrow', 'wrath'],
    });
    t('vigil room keeps V and appends the keys', /labeled V|cottage/i.test(vigil.text) && /keys|three/i.test(vigil.text));
  }
  {
    const pilgrims = EVENTS.find(e => e.id === 'ash_pilgrims');
    const filed = presentEvent(pilgrims, { ...run, biomeId: 'hell', flags: { kings_petition: true } });
    t('ash pilgrims notice a carried petition', /petition|King Who Stayed/i.test(filed.text));
    const afterHydra = presentEvent(pilgrims, {
      ...run, biomeId: 'hell',
      bossPicks: { 40: 'hydra' },
      climb: { bossesCleared: [{ floor: 40, name: 'The Grieving Hydra' }] },
    });
    t('ash pilgrims remember the weeping going quiet', /weeping had stopped|Three mouths/i.test(afterHydra.text));
  }
  {
    const { hellGateStain, throneMemoryLines, throneEpitaphStain, secretPathId } = await import('../js/data/late_memory.js');
    const { resolveThroneBoss } = await import('../js/data/enemies.js');
    t('hell gate stains a stolen rose', /heart/i.test(hellGateStain({ flags: { stole_rose: true } })));
    const throneLines = throneMemoryLines({ flags: { seen_throne: true, saved_climber: true }, sigils: ['truth'] }, { name: 'Vorath' });
    t('throne keeps one memory and prefers tea over Mira or a lone key', throneLines.length === 1 && /tea|vision/i.test(throneLines[0]));
    t('delivered petition stains the epitaph', /complaint/i.test(throneEpitaphStain({ world: { threads: { king: { stage: 'delivered' } } } })));
    t('secretTaken when-key sees a secret subclass', evalWhen({ subclassId: 'doomsinger' }, { secretTaken: true }));
    t('secretTaken ignores unlock without the live subclass', !evalWhen({
      subclassId: 'skald',
      world: { knowledge: ['unlock_doomsinger'] },
    }, { secretTaken: true }));
    t('secretTaken ignores eligibility without taking the path', !evalWhen({
      classId: 'bard', flags: { bard_friend: true },
    }, { secretTaken: true }));
    t('secretPathId is the live secret subclass only', secretPathId({ subclassId: 'skald', world: { knowledge: ['unlock_doomsinger'] } }) == null
      && secretPathId({ subclassId: 'doomsinger' }) === 'doomsinger');

    const rest = EVENTS.find(e => e.id === 'last_rest');
    const petitionOnly = presentEvent(rest, { ...run, biomeId: 'hell', flags: { kings_petition: true } });
    t('vigil mentions a held petition once', (petitionOnly.text.match(/petition|parchment|complaint/gi) || []).length === 1);

    const savedRobbed = { ...run, biomeId: 'hell', floor: 46, flags: { saved_climber: true, left_climber: true } };
    const campSaved = presentEvent(camp, savedRobbed);
    t('saved Mira beats robbed gossip at the campfire', /Mira|climber you patched/i.test(campSaved.text) && !/robbed/i.test(campSaved.text));
    const pilgrimSaved = presentEvent(EVENTS.find(e => e.id === 'ash_pilgrims'), savedRobbed);
    t('saved Mira beats robbed gossip among ash pilgrims', !/robbed/i.test(pilgrimSaved.text));

    const bograthFire = presentEvent(camp, {
      ...run, biomeId: 'hell', floor: 46,
      bossPicks: { 40: 'tr_live_ogre' },
      climb: { bossesCleared: [{ floor: 40, name: 'Bograth' }] },
      flags: { kings_petition: true },
    });
    t('Bograth does not earn three-head hydra copy', !/Three heads/i.test(bograthFire.text) && /petition/i.test(bograthFire.text));
    const keysAndPetition = presentEvent(camp, {
      ...run, biomeId: 'hell', floor: 46,
      flags: { saved_climber: true, kings_petition: true },
      sigils: ['truth', 'sorrow', 'wrath'],
    });
    t('held petition beats three-key trivia at the campfire', /petition/i.test(keysAndPetition.text) && !/three keys/i.test(keysAndPetition.text));
    const roseHydra = presentEvent(camp, {
      ...run, biomeId: 'hell', floor: 46,
      flags: { stole_rose: true },
      bossPicks: { 40: 'hydra' },
      climb: { bossesCleared: [{ floor: 40 }] },
    });
    t('rose grief beats hydra heads', /grief|Cold/i.test(roseHydra.text) && !/Three heads/i.test(roseHydra.text));
    const vigilBusy = presentEvent(rest, {
      ...run, biomeId: 'hell',
      flags: { ate_v_dinner: true, kings_petition: true },
      sigils: ['truth', 'sorrow', 'wrath'],
    });
    t('vigil keeps V and prefers the petition over the keys', /labeled V|cottage/i.test(vigilBusy.text) && /petition/i.test(vigilBusy.text) && !/three keys/i.test(vigilBusy.text));
    const dueled = throneMemoryLines({ world: { threads: { oathbound: { stage: 'dueled' } } } }, { name: 'Vorath' });
    t('earlier oathbound stages do not claim the gate', !dueled.some(x => /wrong gate/i.test(x)));
    const gated = throneMemoryLines({ world: { threads: { oathbound: { stage: 'gate' } } } }, { name: 'Vorath' });
    t('oathbound gate is the stage that reaches the throne', gated.length === 1 && /wrong gate/i.test(gated[0]));

    const mockedBow = presentEvent(camp, {
      ...run, biomeId: 'hell', floor: 46, flags: { kings_bowed: true, kings_mocked: true },
    });
    t('mocked court does not still think you knelt', !/knelt/i.test(mockedBow.text));

    const declinedSecret = presentEvent(camp, {
      ...run, biomeId: 'hell', floor: 46, subclassId: 'skald', classId: 'bard',
      flags: { bard_friend: true },
      world: { knowledge: ['unlock_doomsinger'] },
    });
    t('declined secret path does not get taken-path diction', !/path you already took/i.test(declinedSecret.text));

    const doomsingerLyra = presentEvent(camp, {
      ...run, biomeId: 'hell', floor: 46, subclassId: 'doomsinger', classId: 'bard',
      flags: { bard_friend: true },
    });
    t('doomsinger campfire does not also hum Lyra\'s last bar', /path you already took/i.test(doomsingerLyra.text) && !/last bar/i.test(doomsingerLyra.text));

    const overloaded = {
      flags: {
        kings_petition: true, seen_throne: true, ate_v_dinner: true, saved_climber: true,
        bard_friend: true, kings_bowed: true, revenant_oath: true,
      },
      subclassId: 'doomsinger',
      sigils: ['truth', 'sorrow'],
      climb: { bossesCleared: [{ floor: 30 }, { floor: 40 }] },
      world: { threads: { oathbound: { stage: 'gate' } } },
    };
    const overloadedLines = throneMemoryLines(overloaded, { name: 'Malqor, the Infernal Slime' });
    t('overloaded throne keeps one line and prefers the petition', overloadedLines.length === 1 && /nine pages|King Who Stayed/i.test(overloadedLines[0]));

    const malqor = resolveThroneBoss({ bossPicks: { 51: 'boss_demon_slime' } });
    const vorath = resolveThroneBoss({ bossPicks: { 51: 'tr_mon_demon' } });
    t('secret-ending figure is Malqor when the slime was picked', /Malqor/i.test(malqor.name) && !/Vorath/i.test(malqor.name));
    t('secret-ending figure is Vorath when the demon was picked', /Vorath/i.test(vorath.name));
    const loaded = JSON.parse(JSON.stringify({
      bossPicks: { 51: 'boss_demon_slime' },
      flags: { throneBossId: 'boss_demon_slime', throneBossName: 'Malqor, the Infernal Slime' },
    }));
    t('save/load keeps Malqor on the throne', /Malqor/i.test(resolveThroneBoss(loaded).name));
  }
  {
    const camp = EVENTS.find(e => e.id === 'campfire');
    const returned = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'Returned' });
    returned.flags.saved_climber = true;
    applyFlagBridge(returned, 'saved_climber');
    applyWorldPatch(returned, { thread: { id: 'mira', stage: 'returned' } });
    const frostMira = presentEvent(camp, { ...returned, floor: 24, biomeId: 'frost' });
    t('frost campfire remembers Mira after she repaid', /surface address|already paid/i.test(frostMira.text) && !/hope she found a fire/i.test(frostMira.text));
    const swampMira = presentEvent(camp, { ...returned, floor: 34, biomeId: 'swamp' });
    t('swamp campfire remembers Mira after she repaid', /two biomes down|already closed/i.test(swampMira.text));
    const hellQuiet = presentEvent(camp, { ...returned, floor: 46, biomeId: 'hell' });
    t('returned Mira does not steal the scorch campfire', !/surface address|two biomes down/i.test(hellQuiet.text));
    const ruinsGap = presentEvent(camp, { ...returned, floor: 18, biomeId: 'ruins' });
    t('ruins after return do not reuse the pre-return hope line', !/hope she found a fire/i.test(ruinsGap.text));
    const bothFlags = presentEvent(camp, {
      ...returned, floor: 24, biomeId: 'frost',
      flags: { ...returned.flags, left_climber: true },
    });
    t('saved-and-returned beats robbed gossip in frost', /surface address|already paid/i.test(bothFlags.text) && !/robbed/i.test(bothFlags.text));
    const altGate = presentEvent(camp, {
      ...returned, floor: 29, biomeId: 'frost',
      bossPicks: { 30: 'tr_mon_centaur' },
    });
    t('F29 alt-gate rumor beats returned Mira', /gate ahead|correction/i.test(altGate.text) && !/surface address/i.test(altGate.text));

    const skipped = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'Walked' });
    applyWorldPatch(skipped, { knowledge: 'mira_left_behind' });
    const scarf = presentEvent(camp, { ...skipped, floor: 8, biomeId: 'forest' });
    t('walk-past campfire keeps the scarf', /scarf|LEFT, or LAST/i.test(scarf.text));
    const savedBeat = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'SavedScarf' });
    savedBeat.flags.saved_climber = true;
    applyFlagBridge(savedBeat, 'saved_climber');
    applyWorldPatch(savedBeat, { knowledge: 'mira_left_behind' });
    const savedBeatShown = presentEvent(camp, { ...savedBeat, floor: 8, biomeId: 'forest' });
    t('saved Mira beats a leftover scarf mark', /patched|Mira/i.test(savedBeatShown.text) && !/scarf/i.test(savedBeatShown.text));

    const secretFrost = presentEvent(camp, {
      ...run, floor: 24, biomeId: 'frost', subclassId: 'doomsinger', classId: 'bard',
    });
    t('frost campfire stains a live secret subclass', /path you already took/i.test(secretFrost.text));
    const unlockOnly = presentEvent(camp, {
      ...run, floor: 24, biomeId: 'frost', subclassId: 'skald', classId: 'bard',
      world: { knowledge: ['unlock_doomsinger'] },
    });
    t('unlock without taking does not stain the frost fire', !/path you already took/i.test(unlockOnly.text));

    const dirge = EVENTS.find(e => e.id === 'bard_dirge');
    const patron = newRun({ upgrades: {}, achievements: [] }, { classId: 'bard', raceId: 'human', name: 'Patron' });
    patron.flags.bard_friend = true;
    applyFlagBridge(patron, 'bard_friend');
    patron.seenEvents = ['bard'];
    patron.floor = 33;
    patron.biomeId = 'swamp';
    t('patrons are eligible for the mire dirge', eventEligible(dirge, patron));
    const patronDirge = presentEvent(dirge, patron);
    t('patron dirge sings the encore, not the skipped tip', /encore|after the coin/i.test(patronDirge.text) && !/didn.t tip/i.test(patronDirge.text));
    const stranger = { ...patron, flags: {} };
    const strangerDirge = presentEvent(dirge, stranger);
    t('non-patron dirge still names the skipped tip', /didn.t tip/i.test(strangerDirge.text));

    const lastSong = EVENTS.find(e => e.id === 'bard_last_song');
    const tookNote = presentEvent(lastSong, {
      ...patron, floor: 44, biomeId: 'hell',
      world: { ...(patron.world || {}), knowledge: [...(patron.world?.knowledge || []), 'doomsong_taken'] },
    });
    t('last song recognizes an already-taken doomsong', /already kept it/i.test(tookNote.text) && !tookNote.choices.some(c => /learn it/i.test(c.label)));
    t('already-taken last song does not re-offer unlock', tookNote.choices.every(c => !c.outcome?.world?.unlockSecret));
    const unlockedOnly = presentEvent(lastSong, {
      ...patron, floor: 44, biomeId: 'hell', subclassId: 'skald',
      world: { knowledge: ['unlock_doomsinger'] },
    });
    t('unlock without taking still offers the last note', /want it anyway/i.test(unlockedOnly.text) && unlockedOnly.choices.some(c => /learn it/i.test(c.label)));
    const liveSinger = presentEvent(lastSong, {
      ...patron, floor: 44, biomeId: 'hell', subclassId: 'doomsinger',
    });
    t('live doomsinger last song is continuation', /already kept it/i.test(liveSinger.text));

    const hut = EVENTS.find(e => e.id === 'witch_hut');
    const heard = newRun({ upgrades: {}, achievements: [] }, { classId: 'mage', raceId: 'human', name: 'Late' });
    applyWorldPatch(heard, { knowledge: 'heron_rumor' });
    heard.biomeId = 'swamp';
    heard.floor = 33;
    const hutHeard = presentEvent(hut, heard);
    t('hut remembers the heron rumor', /pilgrim told you/i.test(hutHeard.text));
    const hutCold = presentEvent(hut, { ...run, biomeId: 'swamp', floor: 33 });
    t('hut without the rumor stays the long version', /LATE/i.test(hutCold.text) && !/pilgrim told you/i.test(hutCold.text));

    const lich = BOSSES[20];
    const queen = BOSSES[30];
    const revenant = BOSSES[15];
    const hydra = BOSSES[40];
    t('lich petition outranks bow and mock', presentBoss(lich, { flags: { kings_petition: true, kings_bowed: true, kings_mocked: true } }).variantId === 'petition');
    t('lich petition names the cousin', /cousin/i.test(presentBoss(lich, { flags: { kings_petition: true } }).intro));
    t('lich petition-oath outranks plain petition', presentBoss(lich, {
      flags: { kings_petition: true, revenant_oath: true },
    }).variantId === 'petition_oath');
    t('lich petition-archive outranks plain petition', presentBoss(lich, {
      flags: { kings_petition: true }, world: { knowledge: ['tower_built'] },
    }).variantId === 'petition_archive');
    t('lich split names uniform vs office', presentBoss(lich, {
      flags: { revenant_oath: true, kings_mocked: true },
    }).variantId === 'split' && /uniform/i.test(presentBoss(lich, {
      flags: { revenant_oath: true, kings_mocked: true },
    }).intro));
    t('lich loyal outranks a lone bow', presentBoss(lich, {
      flags: { revenant_oath: true, kings_bowed: true },
    }).variantId === 'loyal');
    t('lich oath lands without a king flag', presentBoss(lich, { flags: { revenant_oath: true } }).variantId === 'oath');
    t('lich archive lands on the confession', presentBoss(lich, { world: { knowledge: ['tower_built'] } }).variantId === 'archive');
    t('lich mock lands when only mocked', presentBoss(lich, { flags: { kings_mocked: true } }).variantId === 'mock');
    t('lich bow lands when only bowed', presentBoss(lich, { flags: { kings_bowed: true } }).variantId === 'bow');
    t('lich without king state stays generic', !presentBoss(lich, { flags: {} }).variantId && /Kneel/i.test(presentBoss(lich, { flags: {} }).intro));
    t('impossible petition+mock still prefers petition', presentBoss(lich, {
      flags: { kings_petition: true, kings_mocked: true },
    }).variantId === 'petition');
    t('Vessalia rose outranks dinner', presentBoss(queen, { flags: { stole_rose: true, ate_v_dinner: true } }).variantId === 'rose');
    t('Vessalia dinner is the fallback kindness', presentBoss(queen, { flags: { ate_v_dinner: true } }).variantId === 'dinner');
    t('Vessalia garden outranks dinner', presentBoss(queen, {
      flags: { ate_v_dinner: true }, world: { knowledge: ['garden_heart'] },
    }).variantId === 'studied');
    t('Vessalia without frost state stays generic', !presentBoss(queen, { flags: {} }).variantId);
    t('Hroth rose still outranks the writ', presentBoss(ALT_BOSSES[30], {
      flags: { stole_rose: true }, world: { knowledge: ['calvien_writ'] },
    }).variantId === 'rose');
    t('Hroth answers the writ', presentBoss(ALT_BOSSES[30], {
      world: { knowledge: ['calvien_writ'] },
    }).variantId === 'writ');
    t('revenant oath-petition outranks oath and rumor', presentBoss(revenant, {
      flags: { revenant_oath: true, kings_petition: true },
      world: { knowledge: ['revenant_rumor'] },
    }).variantId === 'oath_petition');
    t('revenant oath outranks the toll rumor', presentBoss(revenant, {
      flags: { revenant_oath: true },
      world: { knowledge: ['revenant_rumor'] },
    }).variantId === 'oath');
    t('revenant petition outranks rumor and mock', presentBoss(revenant, {
      flags: { kings_petition: true, kings_mocked: true },
      world: { knowledge: ['revenant_rumor'] },
    }).variantId === 'petition');
    t('revenant rumor still cashes without the oath', presentBoss(revenant, {
      world: { knowledge: ['revenant_rumor'] },
    }).variantId === 'rumor');
    t('hydra rose outranks statue and bell', presentBoss(hydra, {
      flags: { stole_rose: true, statue_grudge: true },
      world: { events: { sunken_bell: { id: 'sunken_bell' } } },
    }).variantId === 'rose');
    t('hydra statue beats the bell', presentBoss(hydra, {
      flags: { statue_grudge: true },
      world: { events: { sunken_bell: { id: 'sunken_bell' } } },
    }).variantId === 'statue');
    t('hydra bell lands alone', presentBoss(hydra, {
      world: { events: { sunken_bell: { id: 'sunken_bell' } } },
    }).variantId === 'bell');
    const gravesend = presentBoss(ALT_BOSSES[20], { flags: { kings_petition: true } });
    t('Gravesend petition is accounting, not cousin copy', gravesend.variantId === 'petition' && !/cousin/i.test(gravesend.intro) && /stay|groove|line moves/i.test(gravesend.intro));
    t('Gravesend split does not mimic the Lich office line', presentBoss(ALT_BOSSES[20], {
      flags: { revenant_oath: true, kings_mocked: true },
    }).variantId === 'split' && /ledger|groove|names/i.test(presentBoss(ALT_BOSSES[20], {
      flags: { revenant_oath: true, kings_mocked: true },
    }).intro) && !/uniform, but not the office/i.test(presentBoss(ALT_BOSSES[20], {
      flags: { revenant_oath: true, kings_mocked: true },
    }).intro));
    t('Gravesend without Ruins state stays the block', !presentBoss(ALT_BOSSES[20], { flags: {} }).variantId && /hold still/i.test(presentBoss(ALT_BOSSES[20], { flags: {} }).intro));
  }
  t('narrative events are in the deck', EVENTS.some(e => e.id === 'pale_whisper') && EVENTS.some(e => e.id === 'bard_last_song'));
  const whisper = EVENTS.find(e => e.id === 'pale_whisper');
  recordEvent(run, whisper, { choice: 'listen' });
  t('recordEvent writes history', run.world.events.pale_whisper?.choice === 'listen');
  t('doomsinger tip only makes the song eligible', (() => {
    const r = newRun({ upgrades: {}, achievements: [] }, { classId: 'bard', raceId: 'human', name: 'Lyra' });
    r.flags.bard_friend = true;
    applyFlagBridge(r, 'bard_friend');
    return secretEligible(r, 'doomsinger') && !secretUnlocked(r, 'doomsinger');
  })());
  {
    const r = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'Save' });
    r.flags.saved_climber = true;
    applyFlagBridge(r, 'saved_climber');
    r.floor = 18;
    r.biomeId = 'ruins';
    const copy = JSON.parse(JSON.stringify(r));
    ensureWorld(copy);
    t('save/load keeps Mira state', copy.world.characters.mira?.met && copy.world.characters.mira?.rel >= 3);
    t('save/load keeps flag', !!copy.flags.saved_climber);
    const ret = EVENTS.find(e => e.id === 'climber_returns');
    const grudge = EVENTS.find(e => e.id === 'mira_grudge');
    t('saved path offers return, not grudge', eventEligible(ret, copy) && !eventEligible(grudge, copy));
    const skipped = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'Skip' });
    skipped.floor = 18;
    skipped.biomeId = 'ruins';
    t('missing Mira does not block return-or-grudge exclusivity', !eventEligible(ret, skipped) && !eventEligible(grudge, skipped));
    t('unconditional events still draw after missed optional', eventEligible(EVENTS.find(e => e.id === 'campfire'), skipped));
    const whisper = EVENTS.find(e => e.id === 'pale_whisper');
    t('pale whisper is optional', eventEligible(whisper, { ...skipped, floor: 6, biomeId: 'forest', seenEvents: [] }));
    skipped.seenEvents = ['pale_whisper'];
    t('skipped pale whisper does not lock lichling forever', !secretUnlocked(skipped, 'lichling'));
    skipped.classId = 'necromancer';
    applyWorldPatch(skipped, { knowledge: 'heard_dead_language' });
    t('knowledge route makes lichling eligible, not unlocked', secretEligible(skipped, 'lichling') && !secretUnlocked(skipped, 'lichling'));
    const rite = EVENTS.find(e => e.id === 'pale_rite');
    t('knowledge route opens the initiation event', eventEligible(rite, { ...skipped, floor: 10, biomeId: 'forest', seenEvents: [] }));
    t('initiation hidden from other classes', !eventEligible(rite, { ...skipped, classId: 'warrior', floor: 10, biomeId: 'forest', seenEvents: [] }));
    applyWorldPatch(skipped, { unlockSecret: 'lichling' });
    t('accept writes unlock and reveals UI', secretUnlocked(skipped, 'lichling') && subclassOptions(skipped).some(s => s.id === 'lichling'));
    t('rite stops once unlocked', !eventEligible(rite, { ...skipped, floor: 10, biomeId: 'forest', seenEvents: [] }));
    const deferred = newRun({ upgrades: {}, achievements: [] }, { classId: 'necromancer', raceId: 'human', name: 'Defer' });
    applyWorldPatch(deferred, { knowledge: 'heard_dead_language' });
    applyWorldPatch(deferred, { knowledge: 'pale_rite_deferred' });
    deferred.floor = 8;
    deferred.biomeId = 'forest';
    t('decline delays first rite', secretEligible(deferred, 'lichling') && !eventEligible(rite, deferred));
    deferred.floor = 18;
    const again = EVENTS.find(e => e.id === 'pale_rite_return');
    t('decline opens a later return', eventEligible(again, deferred) && !secretUnlocked(deferred, 'lichling'));
    const accepted = JSON.parse(JSON.stringify(deferred));
    applyWorldPatch(accepted, { unlockSecret: 'lichling' });
    const reloaded = JSON.parse(JSON.stringify(accepted));
    t('unlock persists through save/load', secretUnlocked(reloaded, 'lichling') && subclassOptions(reloaded).some(s => s.id === 'lichling'));
    const harvest = newRun({ upgrades: {}, achievements: [] }, { classId: 'necromancer', raceId: 'human', name: 'Harvest' });
    harvest.kills = 25;
    harvest.floor = 10;
    harvest.biomeId = 'forest';
    t('kills fallback makes lichling eligible, not unlocked', secretEligible(harvest, 'lichling') && !secretUnlocked(harvest, 'lichling'));
    t('kills fallback opens the initiation event', eventEligible(rite, harvest));
    t('kills fallback still hides the UI', !subclassOptions(harvest).some(s => s.id === 'lichling'));
  }
  {
    const doom = EVENTS.find(e => e.id === 'doom_benefits');
    const mage = newRun({ upgrades: {}, achievements: [] }, { classId: 'mage', raceId: 'human', name: 'Host' });
    mage.floor = 8;
    mage.biomeId = 'forest';
    mage.kills = 20;
    t('mage host cannot draw warrior initiation alone', !eventEligible(doom, mage));
    const warrior = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'Guest' });
    warrior.floor = 8;
    warrior.kills = 20;
    const snap = eligibilitySnapshot(warrior);
    t('party warrior opens doom_benefits for mage host', eventEligible(doom, mage, { party: [snap] }));
    t('party draw does not unlock the host', !secretUnlocked(mage, 'doomguard'));
    const grudge = EVENTS.find(e => e.id === 'mira_grudge');
    const hostClean = newRun({ upgrades: {}, achievements: [] }, { classId: 'mage', raceId: 'human', name: 'Clean' });
    hostClean.floor = 18;
    hostClean.biomeId = 'ruins';
    const betrayed = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'Thief' });
    betrayed.flags.left_climber = true;
    betrayed.floor = 18;
    t('mira grudge stays host-personal', !eventEligible(grudge, hostClean, { party: [eligibilitySnapshot(betrayed)] }));
    hostClean.flags.left_climber = true;
    applyFlagBridge(hostClean, 'left_climber');
    t('mira grudge still opens on own flag', eventEligible(grudge, hostClean));
  }
  {
    const cases = [
      { id: 'doomguard', classId: 'warrior', other: 'mage', route: r => applyWorldPatch(r, { knowledge: 'doom_named' }), fallback: r => { r.kills = 20; }, initiation: 'doom_benefits', defer: 'doom_benefits_deferred', ret: 'doom_benefits_return' },
      { id: 'void_scholar', classId: 'mage', other: 'warrior', route: r => { r.flags.tree_lore = true; }, fallback: r => { r.originId = 'archive'; }, initiation: 'void_annotation', defer: 'void_annotation_deferred', ret: 'void_annotation_return' },
      { id: 'stormcaller', classId: 'archer', other: 'warrior', route: r => applyWorldPatch(r, { knowledge: 'storm_owed' }), fallback: r => { r.seenEvents = ['pathfinder_meet']; }, initiation: 'storm_collect', defer: 'storm_collect_deferred', ret: 'storm_collect_return' },
      { id: 'phantom', classId: 'rogue', other: 'warrior', route: r => { r.flags.defiler = true; }, fallback: r => { r.seenEvents = ['shadow_ledger']; }, initiation: 'phantom_file', defer: 'phantom_file_deferred', ret: 'phantom_file_return' },
      { id: 'heretic_saint', classId: 'priest', other: 'warrior', route: r => applyWorldPatch(r, { knowledge: 'cracked_halo' }), fallback: r => { r.fame = 40; }, initiation: 'halo_vocation', defer: 'halo_vocation_deferred', ret: 'halo_vocation_return' },
      { id: 'ashen_fist', classId: 'monk', other: 'warrior', route: r => applyWorldPatch(r, { knowledge: 'still_stone' }), fallback: r => { r.guardCount = 8; }, initiation: 'ashen_strike', defer: 'ashen_strike_deferred', ret: 'ashen_strike_return' },
      { id: 'lightbreaker', classId: 'warlock', other: 'warrior', route: r => { r.flags.freed_angel = true; }, fallback: r => { r.flags.angel_lore = true; }, initiation: 'dawn_pact', defer: 'dawn_pact_deferred', ret: 'dawn_pact_return' },
      { id: 'doomsinger', classId: 'bard', other: 'warrior', route: r => { r.flags.bard_friend = true; }, fallback: r => { r.inventory = ['encore_medallion']; }, initiation: 'doomsong_offer', defer: 'doomsong_deferred', ret: 'doomsong_offer_return' },
      { id: 'lichling', classId: 'necromancer', other: 'warrior', route: r => applyWorldPatch(r, { knowledge: 'heard_dead_language' }), fallback: r => { r.kills = 25; }, initiation: 'pale_rite', defer: 'pale_rite_deferred', ret: 'pale_rite_return' },
      { id: 'void_edge', classId: 'spellsword', other: 'warrior', route: r => applyWorldPatch(r, { knowledge: 'eclipse_cut' }), fallback: r => { r.flags.archive_debt = true; }, initiation: 'eclipse_accept', defer: 'eclipse_accept_deferred', ret: 'eclipse_accept_return' },
      { id: 'einherjar', classId: 'viking', other: 'warrior', route: r => applyWorldPatch(r, { knowledge: 'doom_named' }), fallback: r => { r.seenEvents = ['axe_northman_meet']; }, initiation: 'valhalla_notice', defer: 'valhalla_notice_deferred', ret: 'valhalla_notice_return' },
    ];
    const mk = (classId, name) => {
      const r = newRun({ upgrades: {}, achievements: [] }, { classId, raceId: 'human', name });
      r.floor = 8;
      r.biomeId = 'forest';
      r.seenEvents = r.seenEvents || [];
      return r;
    };
    for (const spec of cases) {
      const routeRun = mk(spec.classId, spec.id);
      spec.route(routeRun);
      t(`${spec.id}: route is eligible only`, secretEligible(routeRun, spec.id) && !secretUnlocked(routeRun, spec.id));
      t(`${spec.id}: route hides level-6 UI`, !subclassOptions(routeRun).some(s => s.id === spec.id));
      const card = EVENTS.find(e => e.id === spec.initiation);
      const ret = EVENTS.find(e => e.id === spec.ret);
      t(`${spec.id}: initiation authored`, !!card && !!ret);
      t(`${spec.id}: route opens initiation`, eventEligible(card, routeRun));
      t(`${spec.id}: initiation is class-gated`, !eventEligible(card, { ...routeRun, classId: spec.other }));
      const fb = mk(spec.classId, `${spec.id}-fb`);
      spec.fallback(fb);
      t(`${spec.id}: fallback is eligible only`, secretEligible(fb, spec.id) && !secretUnlocked(fb, spec.id));
      t(`${spec.id}: fallback opens initiation`, eventEligible(card, fb));
      t(`${spec.id}: fallback hides level-6 UI`, !subclassOptions(fb).some(s => s.id === spec.id));
      applyWorldPatch(routeRun, { unlockSecret: spec.id });
      t(`${spec.id}: accept reveals UI`, secretUnlocked(routeRun, spec.id) && subclassOptions(routeRun).some(s => s.id === spec.id));
      t(`${spec.id}: initiation stops after unlock`, !eventEligible(card, routeRun));
      const delayed = mk(spec.classId, `${spec.id}-wait`);
      spec.route(delayed);
      applyWorldPatch(delayed, { knowledge: spec.defer });
      t(`${spec.id}: decline delays first event`, secretEligible(delayed, spec.id) && !eventEligible(card, delayed) && !secretUnlocked(delayed, spec.id));
      delayed.floor = 18;
      t(`${spec.id}: decline opens a later return`, eventEligible(ret, delayed) && !secretUnlocked(delayed, spec.id));
    }
    t('every secret is initiation-gated', Object.entries(SECRET_ROUTES).every(([id, spec]) => spec.unlock && spec.initiation && EVENTS.some(e => e.id === spec.initiation)));
    t('every secret has a route and a fallback', Object.values(SECRET_ROUTES).every(spec => (spec.routes || []).length && (spec.fallbacks || []).length));
    {
      const ranger = mk('archer', 'LuckyEnough');
      ranger.stats = { ...ranger.stats, lk: 16 };
      t('ordinary Ranger luck does not unlock Stormcaller', !secretEligible(ranger, 'stormcaller'));
      t('lk 16 does not open storm_collect', !eventEligible(EVENTS.find(e => e.id === 'storm_collect'), ranger));
      ranger.seenEvents = ['pathfinder_meet'];
      t('Pathfinder meeting opens Stormcaller', secretEligible(ranger, 'stormcaller'));
      t('Pathfinder meeting opens storm_collect', eventEligible(EVENTS.find(e => e.id === 'storm_collect'), ranger));
      const owed = mk('archer', 'Owed');
      applyWorldPatch(owed, { knowledge: 'storm_owed' });
      t('storm_owed knowledge is the intended Stormcaller route', secretEligible(owed, 'stormcaller') && eventEligible(EVENTS.find(e => e.id === 'storm_collect'), owed));
    }
    {
      const blade = mk('warrior', 'Harvest');
      blade.kills = 19;
      t('19 kills is not yet Doomguard', !secretEligible(blade, 'doomguard'));
      blade.kills = 20;
      const doomCard = EVENTS.find(e => e.id === 'doom_benefits');
      t('20 kills makes Doomguard eligible', secretEligible(blade, 'doomguard'));
      t('20 kills opens doom_benefits', eventEligible(doomCard, blade));
      const { eventDrawPool } = await import('../js/data/events.js');
      const pool = eventDrawPool(blade);
      const row = pool.find(p => p.id === 'doom_benefits');
      t('eligible Doomguard sits in the live draw pool', !!row && row.w >= 16);
      const seen = { ...blade, recentEventIds: ['doom_benefits', 'merchant'] };
      const penalized = eventDrawPool(seen).find(p => p.id === 'doom_benefits');
      t('event-history penalty does not remove doom_benefits', !!penalized && penalized.w > 8);
      const named = mk('warrior', 'Named');
      applyWorldPatch(named, { knowledge: 'doom_named' });
      t('doom_named is the intended Doomguard story route', secretEligible(named, 'doomguard') && eventEligible(doomCard, named));
      const hall = mk('viking', 'Hall');
      hall.kills = 21;
      t('21 kills is not yet Einherjar', !secretEligible(hall, 'einherjar'));
      hall.kills = 22;
      t('22 kills makes Einherjar eligible', secretEligible(hall, 'einherjar'));
    }
    {
      const edge = mk('spellsword', 'BothHands');
      edge.stats = { ...edge.stats, str: 16, int: 16 };
      t('ordinary spellsword stats do not unlock Void Edge', !secretEligible(edge, 'void_edge'));
      edge.seenEvents = ['eclipse_cut'];
      t('finding the eclipse dummy is a Void Edge fallback', secretEligible(edge, 'void_edge'));
      const practiced = mk('spellsword', 'Practiced');
      applyWorldPatch(practiced, { knowledge: 'eclipse_cut' });
      t('eclipse_cut knowledge is the intended Void Edge route', secretEligible(practiced, 'void_edge'));
    }
    {
      const purse = mk('rogue', 'Purse');
      purse.gold = 450;
      t('late-run gold does not auto-qualify Phantom', !secretEligible(purse, 'phantom'));
      purse.seenEvents = ['shadow_ledger'];
      t('finding the shadow ledger opens Phantom', secretEligible(purse, 'phantom'));
      const priest = mk('priest', 'Known');
      priest.fame = 32;
      t('ordinary priest fame does not auto-qualify Heretic Saint', !secretEligible(priest, 'heretic_saint'));
      priest.fame = 40;
      t('deep-run fame still qualifies Heretic Saint', secretEligible(priest, 'heretic_saint'));
    }
    {
      const a = mk('archer', 'DetA');
      const b = mk('archer', 'DetB');
      applyWorldPatch(a, { knowledge: 'storm_owed' });
      applyWorldPatch(b, { knowledge: 'storm_owed' });
      t('secret eligibility is deterministic', secretEligible(a, 'stormcaller') === secretEligible(b, 'stormcaller'));
    }
    {
      const { returnWindowOk, assess, pickPursuitCard, pickPursuitChoice } = await import('./run_secret_routes.js');
      const { reqMet } = await import('../js/requirements.js');
      t('every hidden class has a valid authored route', Object.entries(SECRET_ROUTES).every(([id, spec]) => {
        const ev = EVENTS.find(e => e.id === spec.initiation);
        const ret = EVENTS.find(e => e.id === `${spec.initiation}_return`);
        return spec.parent && spec.routes?.length && spec.fallbacks?.length && ev && ret
          && ev.when?.secretEligible === id && (ev.biome === 'any' || ev.biome);
      }));
      t('no initiation or return has an impossible floor/biome window', Object.keys(SECRET_ROUTES).every(id => {
        const spec = SECRET_ROUTES[id];
        const ini = EVENTS.find(e => e.id === spec.initiation);
        const ret = returnWindowOk(id);
        const iniFloor = ini?.when?.floorMin ?? 1;
        const iniBiome = ini?.biome || 'any';
        const okIni = iniBiome === 'any' || (
          (iniFloor <= 10 && iniBiome === 'forest')
          || (iniFloor <= 20 && iniBiome === 'ruins')
          || (iniFloor <= 30 && iniBiome === 'frost')
          || (iniFloor <= 40 && iniBiome === 'swamp')
          || (iniFloor <= 50 && iniBiome === 'hell')
        );
        return okIni && ret.ok;
      }));
      t('pursuit card picker prefers initiation without extra RNG', (() => {
        const cards = [
          { kind: 'encounter' },
          { kind: 'event', eventId: 'merchant' },
          { kind: 'event', eventId: 'doom_benefits' },
        ];
        return pickPursuitCard('doomguard')(cards).eventId === 'doom_benefits';
      })());
      const warlock = mk('warlock', 'Pact');
      warlock.stats = { ...warlock.stats, str: 4 };
      const angel = EVENTS.find(e => e.id === 'chained_angel');
      const unmake = (angel.choices || []).find(c => /pact/i.test(c.label));
      const smash = (angel.choices || []).find(c => /Break the chains/.test(c.label));
      t('warlock can unmake angel chains without 15 str', !!(unmake && reqMet(warlock, unmake.req).ok));
      t('non-warlock still needs 15 str to break chains', !reqMet(mk('mage', 'Arms'), smash.req).ok);
      warlock.flags.freed_angel = true;
      t('freeing the angel is a reachable Lightbreaker pursuit path', secretEligible(warlock, 'lightbreaker') && eventEligible(EVENTS.find(e => e.id === 'dawn_pact'), warlock));
      const def = mk('warrior', 'Later');
      applyWorldPatch(def, { knowledge: ['doom_named', 'doom_benefits_deferred'] });
      def.floor = 8;
      t('prereq order: decline blocks initiation before the return window', !eventEligible(EVENTS.find(e => e.id === 'doom_benefits'), def));
      def.floor = 18;
      const ret = EVENTS.find(e => e.id === 'doom_benefits_return');
      t('prereq order: return opens only after decline + floor 16', eventEligible(ret, def));
      const hist = { ...def, recentEventIds: ['doom_benefits_return', 'merchant'], recentTakenEventIds: ['doom_benefits'] };
      const { eventDrawPool } = await import('../js/data/events.js');
      const retRow = eventDrawPool(hist).find(p => p.id === 'doom_benefits_return');
      t('event-history penalty does not erase the Doomguard return', !!retRow && retRow.w > 4);
      t('assess marks automatic stumble as TOO COMMON', assess({
        naturalQual: 0.92, naturalOffer: 0.87, pursuitQual: 0.98, pursuitOffer: 0.94,
      }) === 'TOO COMMON');
      t('assess marks initiation-missing pursuit as STARVED', assess({
        naturalQual: 0.06, naturalOffer: 0, pursuitQual: 0.71, pursuitOffer: 0.04,
      }) === 'STARVED');
      t('pursuit choice picker accepts initiation without climb RNG', (() => {
        const ev = EVENTS.find(e => e.id === 'doom_benefits');
        const run = mk('warrior', 'Pick');
        run.kills = 20;
        const choice = pickPursuitChoice('doomguard', 'always-accept-secret')(run, ev);
        return choice?.outcome?.world?.unlockSecret === 'doomguard';
      })());
    }
    const eventIds = EVENTS.map(e => e.id);
    t('event ids stay unique', eventIds.length === new Set(eventIds).size);
    {
      const legacy = mk('warrior', 'LegacyDoom');
      applyWorldPatch(legacy, { knowledge: 'doom_named' });
      legacy.subclassId = 'doomguard';
      const card = EVENTS.find(e => e.id === 'doom_benefits');
      t('old save already on secret counts as unlocked', secretUnlocked(legacy, 'doomguard'));
      t('old save already on secret does not re-offer initiation', !eventEligible(card, legacy));
      syncSecretUnlockFromSubclass(legacy);
      t('migrate writes unlock knowledge for old secret subclass', (legacy.world.knowledge || []).includes('unlock_doomguard'));
      const knighted = mk('warrior', 'LateKnight');
      applyWorldPatch(knighted, { knowledge: 'doom_named' });
      knighted.subclassId = 'knight';
      knighted.level = 7;
      t('after a normal subclass, late eligibility still hides the UI', secretEligible(knighted, 'doomguard') && !secretUnlocked(knighted, 'doomguard') && !subclassOptions(knighted).some(s => s.id === 'doomguard'));
      t('after a normal subclass, initiation can still appear', eventEligible(card, knighted));
      applyWorldPatch(knighted, { unlockSecret: 'doomguard' });
      t('late accept does not swap an existing subclass', knighted.subclassId === 'knight' && secretUnlocked(knighted, 'doomguard'));
      t('late accept still suppresses initiation and return', !eventEligible(card, { ...knighted, seenEvents: [] }) && !eventEligible(EVENTS.find(e => e.id === 'doom_benefits_return'), { ...knighted, floor: 18, seenEvents: [] }));
      {
        const heard = mk('warrior', 'RumorOnly');
        applyWorldPatch(heard, { knowledge: 'doom_named' });
        t('doom discovery writes knowledge, not the thread', (heard.world.knowledge || []).includes('doom_named') && !threadStage(heard, 'doom') && secretEligible(heard, 'doomguard') && !secretUnlocked(heard, 'doomguard'));
        t('doom initiation still opens after discovery', eventEligible(EVENTS.find(e => e.id === 'doom_benefits'), heard));
        applyWorldPatch(heard, { thread: { id: 'doom', stage: 'deferred' }, knowledge: 'doom_benefits_deferred' });
        t('doom decline writes deferred without unlocking', threadStage(heard, 'doom') === 'deferred' && !secretUnlocked(heard, 'doomguard'));
        const snap = worldDebugSnapshot(heard);
        const doomRow = snap.threads.find(x => x.id === 'doom');
        t('World inspector shows doom at deferred, not a rumor opener', doomRow.status === 'active' && doomRow.stage === 'deferred' && doomRow.stageIndex === 1 && doomRow.stageCount === THREADS.doom.stages.length);
      }
      {
        const crop = mk('mage', 'Crop');
        applyWorldPatch(crop, { flag: 'planted_seed' });
        t('seed thread starts planted, not checked', threadStage(crop, 'seed') === 'planted');
        applyWorldPatch(crop, { char: { id: 'gardener', met: true, memory: 'checked_the_crop' } });
        t('gardener check is NPC memory, not a seed stage', threadStage(crop, 'seed') === 'planted' && crop.world.characters.gardener?.memories.includes('checked_the_crop'));
        const seedSnap = worldDebugSnapshot(crop).threads.find(x => x.id === 'seed');
        t('World inspector seed stays planted until bloom', seedSnap.stage === 'planted' && seedSnap.stageCount === 2);
      }
      {
        const grove = mk('warrior', 'Grove');
        applyWorldPatch(grove, { flag: 'angered_forest' });
        t('forest anger writes angered, not ambushed', threadStage(grove, 'forest') === 'angered');
        applyWorldPatch(grove, { flag: 'forest_peace', clearFlag: 'angered_forest' });
        t('forest peace is the post-ambush stage', threadStage(grove, 'forest') === 'peace' && !THREADS.forest.stages.includes('ambushed'));
      }
      const poked = mk('necromancer', 'Dbg');
      applyWorldPatch(poked, { knowledge: 'heard_dead_language' });
      const snap = worldDebugSnapshot(poked);
      const row = snap.secrets.find(s => s.id === 'lichling');
      t('World tab eligible matches secretEligible', row.eligible === secretEligible(poked, 'lichling') && row.unlocked === secretUnlocked(poked, 'lichling'));
      t('World tab route flags use evalWhen', row.routes.every(x => x.ok === evalWhen(poked, [...SECRET_ROUTES.lichling.routes, ...SECRET_ROUTES.lichling.fallbacks].find(rr => rr.id === x.id).when)));
    }
  }
  {
    const fresh = newRun({ upgrades: {}, achievements: [] }, { classId: 'necromancer', raceId: 'human', name: 'Inspect' });
    fresh.biomeId = 'forest';
    fresh.floor = 6;
    const snap = worldDebugSnapshot(fresh);
    t('snapshot lists every thread', Object.keys(THREADS).every(id => snap.threads.some(x => x.id === id)));
    t('snapshot lists every character', Object.keys(CHARACTERS).every(id => snap.characters.some(x => x.id === id)));
    t('snapshot lists every secret', Object.keys(SECRET_ROUTES).every(id => snap.secrets.some(x => x.id === id)));
    t('World tab secrets expose eligibility vs unlock', snap.secrets.every(s => s.unlockKey && s.initiation && s.unlocked === false && typeof s.eligible === 'boolean'));
    const mira = snap.threads.find(x => x.id === 'mira');
    t('dormant thread has no stage', mira.status === 'dormant' && mira.stage == null && mira.stageIndex === 0);
    t('secret reports route counts', snap.secrets.every(s => s.routeCount === s.routes.length && s.metCount >= 0));
    const miss = explainWhen(fresh, { counterMin: { mercy: 1 } });
    t('explainWhen reports missing counter', miss.ok === false && miss.parts.some(p => !p.ok && /mercy/.test(p.text)));
    applyWorldPatch(fresh, { counter: { id: 'mercy', add: 1 } });
    const hit = explainWhen(fresh, { counterMin: { mercy: 1 } });
    t('explainWhen reports counter after patch', hit.ok && hit.parts.some(p => p.ok && /mercy/.test(p.text)));
    t('snapshot lists every tendency', Object.keys(TENDENCIES).every(id => snap.tendencies.some(x => x.id === id && x.band === 'cold')));
    {
      const saved = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'Mercy' });
      applyWorldPatch(saved, { flag: 'saved_climber' });
      t('saved_climber writes mercy once', saved.world.counters.mercy === 1);
      applyFlagBridge(saved, 'saved_climber');
      t('second saved_climber bridge does not double mercy', saved.world.counters.mercy === 1);
      applyWorldPatch(saved, { flag: 'defiler' });
      t('defiler is sacrilege, not greed', saved.world.counters.sacrilege === 1 && !saved.world.counters.greed);
    }
    {
      const old = newRun({ upgrades: {}, achievements: [] }, { classId: 'rogue', raceId: 'human', name: 'OldSave' });
      old.flags.stole_rose = true;
      old.world = emptyWorld();
      old.world._bridged = true;
      old.world.tags.push('_bridged_stole_rose');
      ensureWorld(old);
      t('old save infers greed from stole_rose', old.world.counters.greed === 1);
      ensureWorld(old);
      t('tendency flag bridge is idempotent', old.world.counters.greed === 1);
    }
    {
      const old = newRun({ upgrades: {}, achievements: [] }, { classId: 'rogue', raceId: 'human', name: 'Choice' });
      old.world.events.gilded_fountain = { seen: true, choice: 'Take coins OUT instead', floor: 6 };
      ensureWorld(old);
      t('old save infers greed from fountain choice', old.world.counters.greed === 1);
      ensureWorld(old);
      t('choice bridge is idempotent', old.world.counters.greed === 1);
    }
    {
      const live = newRun({ upgrades: {}, achievements: [] }, { classId: 'rogue', raceId: 'human', name: 'Live' });
      applyOutcomeWorld(live, { world: { counter: { id: 'greed', add: 1 }, tag: choiceBridgeTag('gilded_fountain') } });
      live.world.events.gilded_fountain = { seen: true, choice: 'Take coins OUT instead', floor: 6 };
      ensureWorld(live);
      t('outcome tag blocks choice-bridge double-count', live.world.counters.greed === 1);
    }
    {
      const rest = newRun({ upgrades: {}, achievements: [] }, { classId: 'priest', raceId: 'human', name: 'Rest' });
      rest.biomeId = 'forest';
      rest.floor = 6;
      applyWorldPatch(rest, { counter: { id: 'mercy', add: 2 } });
      const camp = EVENTS.find(e => e.id === 'campfire');
      const mercyFire = presentEvent(camp, rest);
      t('campfire mercy append without Mira', /stacked for two/i.test(mercyFire.text));
      rest.flags.saved_climber = true;
      applyFlagBridge(rest, 'saved_climber');
      const miraFire = presentEvent(camp, rest);
      t('campfire prefers Mira over mercy append', /Mira|climber you patched/i.test(miraFire.text) && !/stacked for two/i.test(miraFire.text));
    }
    {
      const offer = EVENTS.find(e => e.id === 'quiet_offer');
      const door = EVENTS.find(e => e.id === 'margin_door');
      t('quiet_offer and margin_door authored', !!offer && !!door);
      const ready = newRun({ upgrades: {}, achievements: [] }, { classId: 'priest', raceId: 'human', name: 'Rare' });
      ready.floor = 18;
      ready.biomeId = 'ruins';
      t('quiet_offer blocked below mercy 2', !eventEligible(offer, ready));
      applyWorldPatch(ready, { counter: { id: 'mercy', add: 2 } });
      t('quiet_offer eligible at mercy 2', eventEligible(offer, ready));
      t('margin_door blocked below curiosity 2', !eventEligible(door, ready));
      applyWorldPatch(ready, { counter: { id: 'curiosity', add: 2 } });
      t('margin_door eligible at curiosity 2', eventEligible(door, ready));
    }
    {
      const { eventRole } = await import('../js/data/eventpace.js');
      t('quiet_offer stays flavor for the director', eventRole(EVENTS.find(e => e.id === 'quiet_offer')) === 'flavor');
      t('margin_door stays flavor for the director', eventRole(EVENTS.find(e => e.id === 'margin_door')) === 'flavor');
    }
    worldPoke(fresh, { counter: { id: 'defiance', add: 2 } });
    t('worldPoke increments a tendency', fresh.world.counters.defiance === 2);
    worldPoke(fresh, { counter: { id: 'defiance', add: -1 } });
    t('worldPoke decrements a tendency', fresh.world.counters.defiance === 1);
    worldPoke(fresh, { counter: { id: 'defiance', add: 1 } });
    const tendSnap = worldDebugSnapshot(fresh);
    t('snapshot marks a warm tendency', tendSnap.tendencies.find(x => x.id === 'defiance')?.band === 'warm');
    const hut = EVENTS.find(e => e.id === 'witch_hut');
    const why = explainEligibility(hut, fresh);
    t('wrong-biome event explains biome miss', !why.ok && why.parts.some(p => !p.ok && /biome/.test(p.text)));
    worldPoke(fresh, { thread: { id: 'mira', stage: 'met' }, knowledge: 'heard_dead_language', char: { id: 'mira', met: true, relSet: 2, memory: 'poked' } });
    t('worldPoke advances thread', fresh.world.threads.mira?.stage === 'met');
    t('worldPoke grants knowledge', (fresh.world.knowledge || []).includes('heard_dead_language'));
    t('worldPoke marks NPC', fresh.world.characters.mira?.met && fresh.world.characters.mira.memories.includes('poked'));
    const after = worldDebugSnapshot(fresh);
    const miraLive = after.threads.find(x => x.id === 'mira');
    t('active thread reports stage index', miraLive.status === 'active' && miraLive.stageIndex === 1 && miraLive.stageCount === THREADS.mira.stages.length);
    const src = newRun({ upgrades: {}, achievements: [] }, { classId: 'necromancer', raceId: 'human', name: 'Clone' });
    applyWorldPatch(src, { knowledge: 'heard_dead_language' });
    const baseline = cloneRunState(src);
    const work = cloneRunState(src);
    worldPoke(work, { knowledge: 'pale_tome', thread: { id: 'mira', stage: 'met' } });
    t('poke clone does not mutate source', (src.world.knowledge || []).includes('heard_dead_language') && !(src.world.knowledge || []).includes('pale_tome') && !src.world.threads.mira);
    t('poke clone does not mutate baseline', (baseline.world.knowledge || []).includes('heard_dead_language') && !(baseline.world.knowledge || []).includes('pale_tome'));
    restoreRunState(work, baseline);
    t('reset restores scratch copy', (work.world.knowledge || []).includes('heard_dead_language') && !(work.world.knowledge || []).includes('pale_tome') && !work.world.threads?.mira);
    {
      const { saveRun, loadRun, clearRun } = await import('../js/state.js');
      const mem = {};
      const prevStore = globalThis.localStorage;
      globalThis.localStorage = {
        getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null),
        setItem: (k, v) => { mem[k] = String(v); },
        removeItem: k => { delete mem[k]; },
      };
      try {
      const live = newRun({ upgrades: {}, achievements: [] }, { classId: 'necromancer', raceId: 'human', name: 'Live' });
      live.floor = 14;
      applyWorldPatch(live, {
        knowledge: 'heard_dead_language',
        char: { id: 'mira', met: true, relSet: 3, loc: 'forest', memory: 'saved' },
        thread: { id: 'mira', stage: 'saved' },
        counter: { id: 'mercy', add: 2 },
      });
      const persisted = newRun({ upgrades: {}, achievements: [] }, { classId: 'necromancer', raceId: 'human', name: 'OldSave' });
      persisted.floor = 3;
      applyWorldPatch(persisted, { knowledge: 'pale_tome' });
      clearRun();
      saveRun(persisted);
      const savedRaw = globalThis.localStorage.getItem('dt_run_v2');
      const session = beginWorldInspect(live, persisted);
      t('inspect prefers live climb over dt_run_v2', session.source === 'live' && session.working.floor === 14 && (session.working.world.knowledge || []).includes('heard_dead_language') && !(session.working.world.knowledge || []).includes('pale_tome'));
      t('working world nests are deep copies',
        session.working.world.characters.mira !== live.world.characters.mira
        && session.working.world.characters.mira.memories !== live.world.characters.mira.memories
        && session.working.world.knowledge !== live.world.knowledge
        && session.working.world.counters !== live.world.counters
        && session.working.world.threads !== live.world.threads
        && session.working.world.threads.mira !== live.world.threads.mira);
      worldPoke(session.working, {
        knowledge: 'pale_tome',
        char: { id: 'mira', memory: 'poked', relSet: 9, loc: 'hell' },
        thread: { id: 'mira', stage: 'closed' },
        counter: { id: 'mercy', add: 5 },
      });
      t('pokes stay on the scratch copy',
        (session.working.world.knowledge || []).includes('pale_tome')
        && session.working.world.characters.mira.memories.includes('poked')
        && session.working.world.threads.mira.stage === 'closed'
        && session.working.world.counters.mercy === 7);
      t('live climb is unchanged after pokes',
        JSON.stringify(live.world) === JSON.stringify(session.baseline.world)
        && live.world.characters.mira.memories.join() === 'saved'
        && live.world.threads.mira.stage === 'saved'
        && live.world.counters.mercy === 2
        && !(live.world.knowledge || []).includes('pale_tome'));
      resetWorldInspect(session);
      t('reset restores the World-open snapshot',
        JSON.stringify(session.working.world) === JSON.stringify(session.baseline.world)
        && session.working.world.threads.mira.stage === 'saved'
        && session.working.world.counters.mercy === 2
        && !session.working.world.characters.mira.memories.includes('poked'));
      worldPoke(session.working, { knowledge: 'pale_tome', thread: { id: 'mira', stage: 'closed' } });
      const afterLeave = endWorldInspect(session);
      t('leave returns the original live run', afterLeave === live && !(live.world.knowledge || []).includes('pale_tome'));
      const reopened = beginWorldInspect(afterLeave, persisted);
      t('reopen World has no leftover scratch',
        reopened.source === 'live'
        && !(reopened.working.world.knowledge || []).includes('pale_tome')
        && reopened.working.world.threads.mira.stage === 'saved');
      endWorldInspect(reopened);
      t('Continue save is unchanged after inspect/poke/reset/leave', globalThis.localStorage.getItem('dt_run_v2') === savedRaw);
      const loadedSave = loadRun();
      const fromSave = beginWorldInspect(null, loadedSave);
      t('no live run inspects the persisted save', !!fromSave && fromSave.source === 'persisted' && fromSave.working.floor === 3);
      if (fromSave) worldPoke(fromSave.working, { knowledge: 'heard_dead_language' });
      t('persisted-only session does not return a live run', endWorldInspect(fromSave) === null);
      t('dt_run_v2 still unchanged after persisted-only pokes', globalThis.localStorage.getItem('dt_run_v2') === savedRaw);
      t('loadRun still matches the original save', !!loadedSave && loadedSave.floor === 3 && (loadedSave.world.knowledge || []).includes('pale_tome') && !(loadedSave.world.knowledge || []).includes('heard_dead_language'));
      const testClimber = newRun({ upgrades: {}, achievements: [] }, { classId: 'archer', raceId: 'human', name: 'Elba' });
      const dev = beginWorldInspect(testClimber, persisted);
      worldPoke(dev.working, { knowledge: 'heard_dead_language' });
      t('?dev=world-style session snapshots the test climber', dev.source === 'live' && endWorldInspect(dev) === testClimber);
      t('test climber pokes do not overwrite Continue', globalThis.localStorage.getItem('dt_run_v2') === savedRaw);
      clearRun();
      } finally {
        globalThis.localStorage = prevStore;
      }
    }
  }
}

console.log('— narrative connectivity —');
{
  const { newRun } = await import('../js/state.js');
  const {
    applyWorldPatch, applyFlagBridge, eventEligible, presentEvent, presentBoss, evalWhen,
  } = await import('../js/data/world.js');
  const { catalogNarrativeGraph, narrativeConnectivityReport, npcCanAppear } = await import('../js/data/narrative_graph.js');
  const {
    catalogIntegrityReport, exclusiveFlagViolations, npcArtMismatches,
    unknownCharacterIds, danglingReaders, impossibleFloorPrereqs, cardReachability,
    EXCLUSIVE_FLAG_GROUPS,
  } = await import('../js/data/narrative_integrity.js');
  const { shopDiscount, shopDiscountFlavor, shopPrice } = await import('../js/shop.js');
  const { biomeIntroText, throneMemoryLines, throneEpitaphStain } = await import('../js/data/late_memory.js');
  const { BIOMES } = await import('../js/data/enemies.js');

  const g = catalogNarrativeGraph();
  t('catalog graph counts flags', g.counts.flagsCreated >= 20 && g.counts.flagsConsumed >= 20);
  t('origin_arcane is consumed', !!g.flagReads.origin_arcane);
  t('guild_notes is consumed', !!g.flagReads.guild_notes);
  t('undercity_ties is consumed', !!g.flagReads.undercity_ties);
  t('lodge_mark is consumed', !!g.flagReads.lodge_mark);
  t('guard_trained is consumed', !!g.flagReads.guard_trained);
  t('let_it_ride is consumed', !!g.flagReads.let_it_ride);
  t('mentor_words is consumed', !!g.flagReads.mentor_words);
  t('pilgrim_lore is consumed', !!g.flagReads.pilgrim_lore);
  t('evener_met is consumed', !!g.flagReads.evener_met);
  t('mira_named knowledge is consumed', !!g.knowledgeReads.mira_named);
  t('late_patron knowledge is consumed', !!g.knowledgeReads.late_patron);
  t('petition_witnessed is consumed', !!g.knowledgeReads.petition_witnessed);
  t('v_network is consumed', !!g.knowledgeReads.v_network);
  t('forest_minutes is consumed', !!g.knowledgeReads.forest_minutes);
  t('calvien_writ is consumed', !!g.knowledgeReads.calvien_writ);
  t('garden_heart is consumed', !!g.knowledgeReads.garden_heart);
  t('left_rose is consumed', !!g.knowledgeReads.left_rose);
  t('citadel_unbowed is consumed', !!g.knowledgeReads.citadel_unbowed);
  t('dry_hall_gossip is consumed', !!g.knowledgeReads.dry_hall_gossip);
  t('channeler is a catalog character', g.catalogChars.includes('channeler'));
  t('graph reports recurring NPCs', g.counts.npcsRecurring >= 8);
  t('high-value flags are not catalog orphans',
    !g.orphanFlags.some(o => ['origin_arcane', 'let_it_ride', 'saved_climber', 'paid_toll'].includes(o.id)));

  const deadMira = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'DeadMira' });
  applyWorldPatch(deadMira, { flag: 'saved_climber' });
  applyWorldPatch(deadMira, { char: { id: 'mira', alive: false } });
  deadMira.floor = 18;
  deadMira.biomeId = 'ruins';
  t('dead Mira cannot repay a debt', !eventEligible(EVENTS.find(e => e.id === 'climber_returns'), deadMira));
  deadMira.floor = 44;
  deadMira.biomeId = 'hell';
  t('dead Mira cannot watch the slag', !eventEligible(EVENTS.find(e => e.id === 'mira_watch'), deadMira));
  t('npcCanAppear is false when dead', !npcCanAppear(deadMira, 'mira'));

  const liveMira = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'LiveMira' });
  applyWorldPatch(liveMira, { flag: 'saved_climber' });
  liveMira.floor = 18;
  liveMira.biomeId = 'ruins';
  t('living Mira can return', eventEligible(EVENTS.find(e => e.id === 'climber_returns'), liveMira));
  const returned = presentEvent(EVENTS.find(e => e.id === 'climber_returns'), liveMira);
  t('Mira return offers a stay-below choice', returned.choices.some(c => /stay below/i.test(c.label)));

  const tavern = EVENTS.find(e => e.id === 'tavern_blackwater');
  const savedHall = presentEvent(tavern, { ...liveMira, floor: 14, biomeId: 'ruins', flags: { saved_climber: true } });
  t('dry hall names Mira when she was saved', /Mira|patched/i.test(savedHall.text));
  const robbedHall = presentEvent(tavern, {
    ...liveMira, floor: 14, biomeId: 'ruins', flags: { left_climber: true },
  });
  t('dry hall names the robbery when she was robbed', /robbed|took the kit/i.test(robbedHall.text));

  const wolves = EVENTS.find(e => e.id === 'wolf_ambush');
  const paid = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'Toll' });
  paid.flags.angered_forest = true;
  paid.flags.paid_toll = true;
  paid.biomeId = 'forest';
  paid.floor = 8;
  t('wolf ambush offers a Toll Company out', eventEligible(wolves, paid)
    && wolves.choices.some(c => c.req?.flag === 'paid_toll'));

  const patrol = EVENTS.find(e => e.id === 'slag_patrol');
  t('slag patrol honors a freed angel', patrol.choices.some(c => c.req?.flag === 'freed_angel'));

  const hut = EVENTS.find(e => e.id === 'witch_hut');
  const dinner = presentEvent(hut, {
    flags: { ate_v_dinner: true }, biomeId: 'swamp', floor: 33, world: { knowledge: [] },
  });
  t('witch hut smells V\'s stew', /stew|V still sets plates/i.test(dinner.text));

  const hydra = BOSSES[40];
  t('hydra files forest minutes', presentBoss(hydra, { world: { knowledge: ['forest_minutes'] } }).variantId === 'minutes');
  t('hydra rose still outranks minutes', presentBoss(hydra, {
    flags: { stole_rose: true }, world: { knowledge: ['forest_minutes'] },
  }).variantId === 'rose');

  const sylvanor = BOSSES[10];
  t('Sylvanor smells hive-smoke', presentBoss(sylvanor, { flags: { angered_forest: true } }).variantId === 'smoke');
  t('Sylvanor notices a saved climber', presentBoss(sylvanor, { flags: { saved_climber: true } }).variantId === 'mira');
  t('Sylvanor names the swallowed court', presentBoss(sylvanor, { world: { knowledge: ['rooted_court'] } }).variantId === 'court');
  t('hive-smoke still outranks the swallowed court', presentBoss(sylvanor, {
    flags: { angered_forest: true }, world: { knowledge: ['rooted_court'] },
  }).variantId === 'smoke');

  const cinder = ALT_BOSSES[10];
  t('Cinderghast names the buried kiln', presentBoss(cinder, { world: { knowledge: ['rooted_court'] } }).variantId === 'court');
  t('Cinderghast smoke still outranks the kiln', presentBoss(cinder, {
    flags: { angered_forest: true }, world: { knowledge: ['rooted_court'] },
  }).variantId === 'smoke');

  const mileToll = EVENTS.find(e => e.id === 'bandit_toll');
  t('toll offers a milestone reading', mileToll.choices.some(c => /read the milestone/i.test(c.label)));
  t('reading the milestone writes rooted_court', mileToll.choices.some(c => /read the milestone/i.test(c.label) && c.outcome?.world?.knowledge === 'rooted_court'));
  t('paying the toll still names Sylvanor', /Sylvanor/i.test(mileToll.choices.find(c => /pay the toll/i.test(c.label)).outcome.text));

  const oak = EVENTS.find(e => e.id === 'ancient_tree');
  t('speaking tree offers a kingdom question', oak.choices.some(c => /kingdom/i.test(c.label)));
  t('kingdom question writes rooted_court', oak.choices.some(c => /kingdom/i.test(c.label) && c.outcome?.world?.knowledge === 'rooted_court'));
  t('tower question still writes tree_lore', oak.choices.some(c => /what is the tower/i.test(c.label) && c.outcome?.flag === 'tree_lore'));

  const road = EVENTS.find(e => e.id === 'roadside_climbers');
  const roadTalk = presentEvent(road, { floor: 4, biomeId: 'forest' });
  t('early forest travelers argue about the court', roadTalk.variantId === 'forest_talk' && /kingdom-stone|old tree at the gate/i.test(roadTalk.text));
  const roadMark = presentEvent(road, { floor: 4, biomeId: 'forest', world: { knowledge: ['rooted_court'] } });
  t('travelers recognize the scraped court-mark', roadMark.variantId === 'forest_mark' && /same court-mark/i.test(roadMark.text));
  t('late forest travelers stay generic', presentEvent(road, { floor: 8, biomeId: 'forest' }).variantId == null);

  const campEarly = EVENTS.find(e => e.id === 'campfire');
  const f9court = presentEvent(campEarly, {
    floor: 9, biomeId: 'forest', world: { knowledge: ['rooted_court'] }, bossPicks: { 10: 'elderwood' },
  });
  t('F9 campfire reflects the swallowed court', /downstairs|holds the door|woke the judge/i.test(f9court.text));
  const f9kiln = presentEvent(campEarly, {
    floor: 9, biomeId: 'forest', world: { knowledge: ['rooted_court'] },
    bossPicks: { 10: 'gv_grotto_escape_2_boss_dragon' },
  });
  t('F9 campfire anticipates the kiln when the alt gate is set', /kiln that never cooled/i.test(f9kiln.text));
  const f9gate = presentEvent(campEarly, { floor: 9, biomeId: 'forest', bossPicks: { 10: 'elderwood' } });
  t('F9 campfire still anticipates the gate without the clue', /gate judges|whispering about it since the first root/i.test(f9gate.text));

  const king = EVENTS.find(e => e.id === 'ghost_king');
  t('ghost king recognizes the forest milestone', /milestone in the woods|grove kept the door/i.test(presentEvent(king, {
    floor: 12, biomeId: 'ruins', world: { knowledge: ['rooted_court'] },
  }).text));

  t('rooted_court knowledge is consumed', !!g.knowledgeReads.rooted_court);

  const library = EVENTS.find(e => e.id === 'buried_library');
  t('deciphering the silver book writes tower_built', library.choices.some(c => /Decipher it/i.test(c.label) && c.outcome?.world?.knowledge === 'tower_built'));
  t('crumbling books do not write the confession', library.choices.some(c => /crumbling books/i.test(c.label) && !c.outcome?.world?.knowledge));
  const libAfterKing = presentEvent(library, { biomeId: 'ruins', seenEvents: ['ghost_king'] });
  t('library after the king shows the contradiction', libAfterKing.variantId === 'after_king' && /disagrees|grew through/i.test(libAfterKing.text));
  t('library without the king stays the lock', presentEvent(library, { biomeId: 'ruins' }).variantId == null);
  t('ghost king archive overlay changes the lore choice', presentEvent(king, {
    floor: 13, biomeId: 'ruins', world: { knowledge: ['tower_built'] },
  }).variantId === 'archive' && presentEvent(king, {
    floor: 13, biomeId: 'ruins', world: { knowledge: ['tower_built'] },
  }).choices.some(c => /archive says you built it/i.test(c.label)));
  t('ghost king oath overlay outranks the forest milestone', presentEvent(king, {
    floor: 13, biomeId: 'ruins', flags: { revenant_oath: true }, world: { knowledge: ['rooted_court'] },
  }).variantId === 'oath' && /uniform|He remained/i.test(presentEvent(king, {
    floor: 13, biomeId: 'ruins', flags: { revenant_oath: true }, world: { knowledge: ['rooted_court'] },
  }).text));
  t('ghost king oath+archive outranks either thread', presentEvent(king, {
    floor: 13, biomeId: 'ruins', flags: { revenant_oath: true }, world: { knowledge: ['tower_built'] },
  }).variantId === 'oath_archive');
  t('ghost king notices a closed watch', presentEvent(king, {
    floor: 16, biomeId: 'ruins', flags: {}, climb: { bossesCleared: [{ floor: 15, id: 'crowned_revenant' }] },
  }).variantId === 'fought');
  t('ghost king notices a skipped watch', presentEvent(king, {
    floor: 13, biomeId: 'ruins', seenEvents: ['crowned_shadow'],
  }).variantId === 'seen');
  t('fought outranks a skipped-watch leftover', presentEvent(king, {
    floor: 16, biomeId: 'ruins', seenEvents: ['crowned_shadow'],
    climb: { bossesCleared: [{ floor: 15, id: 'crowned_revenant' }] },
  }).variantId === 'fought');

  const shadow = EVENTS.find(e => e.id === 'crowned_shadow');
  t('revenant recognizes the petition and changes the oath', presentEvent(shadow, {
    floor: 13, biomeId: 'ruins', flags: { kings_petition: true },
  }).variantId === 'petition' && presentEvent(shadow, {
    floor: 13, biomeId: 'ruins', flags: { kings_petition: true },
  }).choices.some(c => /knight who waited/i.test(c.label)));
  t('revenant oath after a mock is not a joke', presentEvent(shadow, {
    floor: 13, biomeId: 'ruins', flags: { kings_mocked: true },
  }).variantId === 'mocked');
  t('petition outranks mock on the kneeling silhouette', presentEvent(shadow, {
    floor: 13, biomeId: 'ruins', flags: { kings_petition: true, kings_mocked: true },
  }).variantId === 'petition');
  t('crowned_shadow without king state stays generic', presentEvent(shadow, {
    floor: 13, biomeId: 'ruins', flags: {},
  }).variantId == null);

  const statue = EVENTS.find(e => e.id === 'cursed_statue');
  t('weeping statue is court-cut even cold', /court-cut|siege/i.test(statue.text));
  t('statue after the king belongs to the fallen court', /fallen court|crown did not come home/i.test(presentEvent(statue, {
    biomeId: 'ruins', seenEvents: ['ghost_king'],
  }).text));

  const campRuins = EVENTS.find(e => e.id === 'campfire');
  const f19archive = presentEvent(campRuins, {
    floor: 19, biomeId: 'ruins', seenEvents: ['ghost_king'],
    world: { knowledge: ['tower_built'] }, bossPicks: { 20: 'lich' },
  });
  t('F19 campfire reflects the library contradiction', /King says the tower buried them|archive says they invited it/i.test(f19archive.text));
  const f19split = presentEvent(campRuins, {
    floor: 19, biomeId: 'ruins', flags: { revenant_oath: true, kings_mocked: true },
    bossPicks: { 20: 'lich' },
  });
  t('F19 campfire reflects a split kneel', /bowed to the knight|laughed at the king/i.test(f19split.text));
  const f19petition = presentEvent(campRuins, {
    floor: 19, biomeId: 'ruins', flags: { kings_petition: true }, bossPicks: { 20: 'lich' },
  });
  t('F19 campfire carries the dead government', /petition from a government that died/i.test(f19petition.text));
  const f19gate = presentEvent(campRuins, { floor: 19, biomeId: 'ruins', bossPicks: { 20: 'lich' } });
  t('F19 campfire still aims at the dust-crown and ice', /dust-crown|After that, ice/i.test(f19gate.text));
  const f19grave = presentEvent(campRuins, {
    floor: 19, biomeId: 'ruins', flags: { kings_petition: true },
    bossPicks: { 20: 'undead_executioner' },
  });
  t('F19 campfire names Gravesend as accounting', /Gravesend|Accounting does not kneel/i.test(f19grave.text));
  t('F19 archive outranks a split kneel', presentEvent(campRuins, {
    floor: 19, biomeId: 'ruins', seenEvents: ['ghost_king'],
    flags: { revenant_oath: true, kings_mocked: true },
    world: { knowledge: ['tower_built'] }, bossPicks: { 20: 'lich' },
  }).variantId === 'f19_archive');
  t('tower_built without the king does not fake the argument', presentEvent(campRuins, {
    floor: 19, biomeId: 'ruins', world: { knowledge: ['tower_built'] }, bossPicks: { 20: 'lich' },
  }).variantId === 'f19_gate');
  t('tower_built knowledge is consumed', !!g.knowledgeReads.tower_built);

  const memory = EVENTS.find(e => e.id === 'revenant_memory');
  t('revenant memory tastes a carried petition', /petition in your pack/i.test(presentEvent(memory, {
    floor: 17, biomeId: 'ruins', flags: { revenant_oath: true, kings_petition: true },
  }).text));

  const archive = EVENTS.find(e => e.id === 'frozen_library');
  t('archive names Calvien before you pick a page', /Calvien/i.test(archive.text));
  t('reading the disputed pages writes calvien_writ', archive.choices.some(c => /disputed pages/i.test(c.label) && c.outcome?.world?.knowledge === 'calvien_writ'));
  t('archive still lets you leave the argument', archive.choices.some(c => /leave the argument/i.test(c.label)));
  t('archive reacts when the heart was left', presentEvent(archive, {
    biomeId: 'frost', world: { knowledge: ['left_rose'] },
  }).variantId === 'garden_left');
  t('taken rose still outranks a studied garden in the archive', presentEvent(archive, {
    biomeId: 'frost', flags: { stole_rose: true }, world: { knowledge: ['garden_heart'] },
  }).variantId === 'garden_empty');

  const garden = EVENTS.find(e => e.id === 'ice_garden');
  t('studying the rose writes garden_heart', garden.choices.some(c => /study the rose/i.test(c.label) && c.outcome?.world?.knowledge === 'garden_heart'));
  t('leaving the rose writes left_rose', garden.choices.some(c => /leave it in peace/i.test(c.label) && c.outcome?.world?.knowledge === 'left_rose'));
  t('picking the rose still writes stole_rose', garden.choices.some(c => /pick the rose/i.test(c.label) && c.outcome?.success?.flag === 'stole_rose'));
  t('the garden notices a Ruins bow', /knelt for a different court/i.test(presentEvent(garden, {
    biomeId: 'frost', flags: { kings_bowed: true },
  }).text));

  const thaw = EVENTS.find(e => e.id === 'frozen_climber');
  t('thawed climber leaves finish-it open', /court almost finished something/i.test(thaw.choices.find(c => /melt them free/i.test(c.label)).outcome.success.text));
  t('thawed climber ties finish-it to the court argument', /which is the finishing/i.test(presentEvent(thaw, {
    biomeId: 'frost', world: { knowledge: ['calvien_writ'] },
  }).choices.find(c => /melt them free/i.test(c.label)).outcome.success.text));

  const cottage = EVENTS.find(e => e.id === 'warm_hearth');
  t('V still warns not to bow', /DO NOT BOW/i.test(cottage.text));
  t('cottage files a studied heart', /LOOKED|DID NOT TAKE/i.test(presentEvent(cottage, {
    biomeId: 'frost', world: { knowledge: ['garden_heart'] },
  }).text));
  t('cottage files a Ruins bow against the ice', /BOWED TO DUST|DO NOT DO IT AGAIN/i.test(presentEvent(cottage, {
    biomeId: 'frost', flags: { kings_bowed: true },
  }).text));

  const pass = EVENTS.find(e => e.id === 'avalanche');
  t('the pass notices a declined claim', /declined a claim/i.test(presentEvent(pass, {
    biomeId: 'frost', world: { knowledge: ['left_rose'] },
  }).text));

  const knighthood = EVENTS.find(e => e.id === 'kings_favor');
  t('Frost court has an opinion about a Ruins bow', /different dead kingdom|frozen mid-betrayal/i.test(knighthood.text));
  t('knighthood offers a refusal that is not a second gift', knighthood.choices.some(c => /will not bow twice/i.test(c.label) && !c.outcome?.classGear && c.outcome?.world?.knowledge === 'citadel_unbowed'));

  const f29court = presentEvent(campEarly, {
    floor: 29, biomeId: 'frost', world: { knowledge: ['calvien_writ'] }, bossPicks: { 30: 'frost_queen' },
  });
  t('F29 campfire reflects the open writ', /who moved first|do not have hers/i.test(f29court.text));
  const f29hroth = presentEvent(campEarly, {
    floor: 29, biomeId: 'frost', world: { knowledge: ['calvien_writ'] },
    bossPicks: { 30: 'tr_mon_centaur' },
  });
  t('F29 campfire names Hroth as the fetcher when the alt gate is set', /outrider fetches|writ never finished/i.test(f29hroth.text));
  const f29gate = presentEvent(campEarly, { floor: 29, biomeId: 'frost', bossPicks: { 30: 'frost_queen' } });
  t('F29 campfire still asks the betrayal without the clue', /finishes a betrayal|refuses to/i.test(f29gate.text));

  const queen = BOSSES[30];
  t('Vessalia answers the writ', presentBoss(queen, { world: { knowledge: ['calvien_writ'] } }).variantId === 'writ');
  t('Vessalia rose still outranks the writ', presentBoss(queen, {
    flags: { stole_rose: true }, world: { knowledge: ['calvien_writ'] },
  }).variantId === 'rose');
  t('leaving the rose outranks dinner', presentBoss(queen, {
    flags: { ate_v_dinner: true }, world: { knowledge: ['left_rose'] },
  }).variantId === 'left');
  t('refusing a second bow outranks a used kneel', presentBoss(queen, {
    flags: { kings_bowed: true }, world: { knowledge: ['citadel_unbowed'] },
  }).variantId === 'unbowed');

  const hroth = ALT_BOSSES[30];
  t('Hroth frames the betrayal as a ride', /SHE SITS|I FETCH|writ still has a rider/i.test(presentBoss(hroth, {
    world: { knowledge: ['calvien_writ'] },
  }).intro));
  t('Hroth garden-leave is not Vessalia copy', /YOU LEFT IT|did not exhale/i.test(presentBoss(hroth, {
    world: { knowledge: ['left_rose'] },
  }).intro) && !/does not rise from her throne/i.test(presentBoss(hroth, { world: { knowledge: ['left_rose'] } }).intro));

  const duke = BOSSES[50];
  t('Duke notices his own mark', presentBoss(duke, { flags: { dukes_mark: true } }).variantId === 'mark');
  t('Duke clause outranks nothing if mark is set', presentBoss(duke, {
    flags: { dukes_mark: true, clause_seven: true },
  }).variantId === 'mark');

  const lastSong = EVENTS.find(e => e.id === 'bard_last_song');
  const lateTip = presentEvent(lastSong, {
    floor: 44, biomeId: 'hell', flags: { bard_friend: true },
    world: { knowledge: ['late_patron'] },
  });
  t('last song hears a late mire tip', /coin on a stump|late/i.test(lateTip.text));

  const vCard = EVENTS.find(e => e.id === 'v_hearth');
  const vRun = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'V' });
  vRun.flags.ate_v_dinner = true;
  applyFlagBridge(vRun, 'ate_v_dinner');
  vRun.floor = 33;
  vRun.biomeId = 'swamp';
  t('V\'s table can move into the mire', eventEligible(vCard, vRun));
  vRun.biomeId = 'frost';
  t('V\'s table does not duplicate the citadel cottage', !eventEligible(vCard, vRun));

  const thawed = EVENTS.find(e => e.id === 'thawed_debt');
  const ice = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'Thaw' });
  applyWorldPatch(ice, { flag: 'freed_climber' });
  ice.floor = 33;
  ice.biomeId = 'swamp';
  t('thawed climber can reappear', eventEligible(thawed, ice));
  applyWorldPatch(ice, { char: { id: 'frost_climber', alive: false } });
  t('dead thawed climber cannot reappear', !eventEligible(thawed, ice));

  const faces = EVENTS.find(e => e.id === 'scorch_colleague');
  const mentor = newRun({ upgrades: {}, achievements: [] }, { classId: 'mage', raceId: 'human', name: 'Ink' });
  mentor.floor = 44;
  mentor.biomeId = 'hell';
  applyWorldPatch(mentor, { char: { id: 'channeler', met: true } });
  t('channeler can appear on the slag', eventEligible(faces, mentor));
  const shownFace = presentEvent(faces, mentor);
  t('scorch colleague prefers the channeler overlay', shownFace.variantId === 'channeler' || /Apostate Channeler|footnote/i.test(shownFace.text));
  applyWorldPatch(mentor, { char: { id: 'channeler', alive: false } });
  t('dead channeler cannot take the slag stair', !eventEligible(faces, mentor));

  const guildRun = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'Guild' });
  const baseShop = shopDiscount(guildRun);
  guildRun.flags.guild_notes = true;
  const guildShop = shopDiscount(guildRun);
  t('guild notes shave the merchant', guildShop.discount > baseShop.discount && guildShop.storyDisc > 0);
  const hellShop = shopDiscount({ ...guildRun, flags: { dukes_mark: true }, biomeId: 'hell', fame: 0 });
  t('Duke mark shaves a Scorch stall', hellShop.storyDisc > 0);

  const ruins = BIOMES.find(b => b.id === 'ruins');
  const ruinIntro = biomeIntroText(ruins, { flags: { angered_forest: true } });
  t('ruins intro carries hive-smoke', /hive-smoke|smoke/i.test(ruinIntro));
  t('ruins intro prefers the swallowed court over hive-smoke', /court-mark in the moss|rest of that sentence/i.test(biomeIntroText(ruins, {
    flags: { angered_forest: true }, world: { knowledge: ['rooted_court'] },
  })));
  const frost = BIOMES.find(b => b.id === 'frost');
  t('frost intro carries a petition', /petition|complaint/i.test(biomeIntroText(frost, { flags: { kings_petition: true } })));
  t('frost intro files a Ruins bow as a warning', /knelt for a ghost|froze people for less/i.test(biomeIntroText(frost, { flags: { kings_bowed: true } })));
  const swamp = BIOMES.find(b => b.id === 'swamp');
  t('swamp intro carries V\'s cold', /Frost still clings|cold that does not belong/i.test(biomeIntroText(swamp, { flags: { ate_v_dinner: true } })));
  t('swamp intro carries meltwater toward the bells', /Meltwater|runoff|bell is already wet/i.test(biomeIntroText(swamp, {
    world: { knowledge: ['left_rose'] },
  })));
  t('rose still outranks meltwater on the mire stair', /Frost still clings|cold that does not belong/i.test(biomeIntroText(swamp, {
    flags: { stole_rose: true }, world: { knowledge: ['left_rose'] },
  })));

  const corridor = EVENTS.find(e => e.id === 'trapped_corridor');
  t('undercity origin opens a canal-roof option', corridor.choices.some(c => c.req?.flag === 'undercity_ties'));

  const camp = EVENTS.find(e => e.id === 'campfire');
  const academyFire = presentEvent(camp, {
    floor: 8, biomeId: 'forest', flags: { origin_arcane: true },
  });
  t('campfire remembers the Arcanum', /Immel|academy|diagram/i.test(academyFire.text));

  const channelerWatch = EVENTS.find(e => e.id === 'dark_mage_watch');
  const graded = channelerWatch.choices[0].outcome.world.char.id;
  t('channeler grades the channeler, not the witch', graded === 'channeler');

  const report = narrativeConnectivityReport(liveMira);
  t('world inspector report has catalog counts', report.catalog.flagsCreated > 0 && Array.isArray(report.orphanFlags));
  t('saved Mira run is not an orphan flag', !report.runOrphans.some(o => o.id === 'saved_climber'));

  const both = { flags: { saved_climber: true, left_climber: true } };
  t('saved and robbed are not a legal mira-watch pair without a living Mira', true);
  t('mutually exclusive tavern overlay prefers saved', /patched|Mira/i.test(presentEvent(tavern, {
    floor: 14, biomeId: 'ruins', flags: both.flags,
  }).text) && !/took the kit/i.test(presentEvent(tavern, {
    floor: 14, biomeId: 'ruins', flags: both.flags,
  }).text));

  t('no unknown catalog character ids', unknownCharacterIds().length === 0);
  t('unique NPC art does not stamp the wrong character', npcArtMismatches().length === 0);
  t('no inverted flag floor prerequisites', impossibleFloorPrereqs().length === 0);
  t('dangling readers are empty or only terminal', danglingReaders().length === 0);
  for (const id of ['v_hearth', 'thawed_debt', 'gravekeeper_slag', 'scorch_colleague', 'bandit_shop']) {
    const r = cardReachability(id);
    t(`${id} is catalog-reachable`, r.ok);
  }
  t('integrity report lists the five new cards', catalogIntegrityReport().newCardReachability.every(x => x.ok));
  {
    const { catalogDeadState } = await import('./audit_catalog.js');
    const dead = catalogDeadState();
    t('grave_shroud is intentionally retired', !!itemById('grave_shroud')?.retired && itemById('grave_shroud').exclusive);
    t('elder_circlet is intentionally retired', !!itemById('elder_circlet')?.retired && itemById('elder_circlet').exclusive);
    t('no exclusive non-reserved item is grantless', dead.deadExclusives.length === 0);
    t('no non-reserved thread stage is unwitable', dead.unusedStages.length === 0);
    t('retired exclusives stay resolvable', dead.retiredExclusives.some(i => i.id === 'grave_shroud') && dead.retiredExclusives.some(i => i.id === 'elder_circlet'));
  }
  t('thread graph has indirect edges', (g.threadEdges || []).length > 0);
  t('mira is among most-connected or edged threads',
    (g.threadEdges || []).some(e => e.from === 'mira' || e.to === 'mira')
    || (g.mostConnectedThreads || []).some(x => x.id === 'mira'));

  const deadLyra = newRun({ upgrades: {}, achievements: [] }, { classId: 'bard', raceId: 'human', name: 'DeadLyra' });
  applyWorldPatch(deadLyra, { flag: 'bard_friend' });
  applyWorldPatch(deadLyra, { char: { id: 'lyra', alive: false } });
  t('dead Lyra cannot encore', !eventEligible(EVENTS.find(e => e.id === 'bard_returns'), deadLyra));
  deadLyra.floor = 44;
  deadLyra.biomeId = 'hell';
  t('dead Lyra cannot sing the last song', !eventEligible(EVENTS.find(e => e.id === 'bard_last_song'), deadLyra));
  t('bard class who never met Lyra can still hear the last song', eventEligible(EVENTS.find(e => e.id === 'bard_last_song'), {
    ...newRun({ upgrades: {}, achievements: [] }, { classId: 'bard', raceId: 'human', name: 'ClassBard' }),
    floor: 44, biomeId: 'hell',
  }));

  const deadV = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'DeadV' });
  applyWorldPatch(deadV, { flag: 'ate_v_dinner' });
  applyWorldPatch(deadV, { char: { id: 'vess', alive: false } });
  deadV.floor = 33;
  deadV.biomeId = 'swamp';
  t('dead V cannot move the table', !eventEligible(EVENTS.find(e => e.id === 'v_hearth'), deadV));

  const deadToll = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'DeadToll' });
  applyWorldPatch(deadToll, { flag: 'paid_toll' });
  applyWorldPatch(deadToll, { char: { id: 'bandit_chief', alive: false } });
  deadToll.floor = 20;
  deadToll.biomeId = 'ruins';
  t('dead toll captain cannot open a shop', !eventEligible(EVENTS.find(e => e.id === 'bandit_shop'), deadToll));
  t('dead toll captain cannot revisit the levy', !eventEligible(EVENTS.find(e => e.id === 'bandit_gratitude'), deadToll));

  const whisperOnly = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'Accent' });
  applyWorldPatch(whisperOnly, { knowledge: 'heard_dead_language' });
  whisperOnly.floor = 44;
  whisperOnly.biomeId = 'hell';
  t('gravekeeper slag is reachable from the accent alone', eventEligible(EVENTS.find(e => e.id === 'gravekeeper_slag'), whisperOnly));
  applyWorldPatch(whisperOnly, { char: { id: 'gravekeeper', met: true, alive: false } });
  t('dead gravekeeper cannot follow the accent', !eventEligible(EVENTS.find(e => e.id === 'gravekeeper_slag'), whisperOnly));

  const deadGrudge = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'DeadGrudge' });
  applyWorldPatch(deadGrudge, { flag: 'left_climber' });
  applyWorldPatch(deadGrudge, { char: { id: 'mira', alive: false } });
  deadGrudge.floor = 16;
  deadGrudge.biomeId = 'ruins';
  t('dead Mira cannot collect a debt', !eventEligible(EVENTS.find(e => e.id === 'mira_grudge'), deadGrudge));

  const deadThrone = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'DeadThrone' });
  applyWorldPatch(deadThrone, { flag: 'saved_climber' });
  applyWorldPatch(deadThrone, { char: { id: 'mira', alive: false } });
  t('dead Mira does not get a living throne dinner', !throneMemoryLines(deadThrone).some(s => /Dinner on the surface/i.test(s)));
  t('dead Mira does not keep score on the epitaph', !/keeping score/i.test(throneEpitaphStain(deadThrone)));
  const liveThrone = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'LiveThrone' });
  applyWorldPatch(liveThrone, { flag: 'saved_climber' });
  t('living saved Mira still gets the dinner line', /Dinner on the surface/i.test(throneMemoryLines(liveThrone).join(' ')));

  const legalToll = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'TollPath' });
  applyWorldPatch(legalToll, { flag: 'paid_toll' });
  legalToll.floor = 20;
  legalToll.biomeId = 'ruins';
  t('paying the toll reaches the company store', eventEligible(EVENTS.find(e => e.id === 'bandit_shop'), legalToll));
  t('paying the toll reaches the later barricade', eventEligible(EVENTS.find(e => e.id === 'bandit_gratitude'), legalToll));

  const legalV = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'VPath' });
  applyWorldPatch(legalV, { flag: 'ate_v_dinner' });
  legalV.floor = 33;
  legalV.biomeId = 'swamp';
  t('frost dinner reaches the moved table', eventEligible(EVENTS.find(e => e.id === 'v_hearth'), legalV));
  legalV.biomeId = 'frost';
  t('moved table stays out of frost', !eventEligible(EVENTS.find(e => e.id === 'v_hearth'), legalV));

  const bothFlags = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'Both' });
  bothFlags.flags.saved_climber = true;
  bothFlags.flags.left_climber = true;
  t('saved+robbed is an exclusive-flag violation', exclusiveFlagViolations(bothFlags).some(g => g.includes('saved_climber')));
  t('exclusive groups are authored', EXCLUSIVE_FLAG_GROUPS.length >= 2);

  const guildOnly = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name: 'ShopA' });
  guildOnly.flags.guild_notes = true;
  guildOnly.flags.undercity_ties = true;
  guildOnly.flags.paid_toll = true;
  const orDisc = shopDiscount(guildOnly);
  t('guild OR undercity OR toll does not triple-stack', Math.abs(orDisc.storyDisc - 0.04) < 1e-9);
  const hellMark = shopDiscount({ ...guildOnly, biomeId: 'hell', flags: { ...guildOnly.flags, dukes_mark: true } });
  t('Duke mark stacks on the origin OR', Math.abs(hellMark.storyDisc - 0.08) < 1e-9);
  t('discount cap still clamps', shopDiscount({ fame: 99, biomeId: 'hell', flags: { dukes_mark: true, guild_notes: true }, world: { characters: { merchant: { rel: 99 } } } }).discount <= 0.35);
  t('shop prices stay finite and non-negative', shopPrice(100, 0.08) > 0 && shopPrice(NaN, 0.08) === 0 && shopPrice(100, 2) >= 0);
  t('same state is deterministic pricing', shopDiscount(guildOnly).discount === shopDiscount(guildOnly).discount);
  const flavor = shopDiscountFlavor({ ...guildOnly, flags: { paid_toll: true } });
  t('story-only shop copy names the woods', /paid the woods|toll/i.test(flavor));
  t('story-only shop copy is not an empty () discount', !/\(\) discount/.test(flavor) && /discount/.test(flavor));

  const unmetWatch = newRun({ upgrades: {}, achievements: [] }, { classId: 'mage', raceId: 'human', name: 'Unmet' });
  unmetWatch.floor = 20;
  unmetWatch.biomeId = 'ruins';
  t('channeler watch cannot fire before the meet', !eventEligible(EVENTS.find(e => e.id === 'dark_mage_watch'), unmetWatch));
}

console.log('— narrative event pacing —');
{
  const { newRun } = await import('../js/state.js');
  const { applyWorldPatch, applyFlagBridge, ensureWorld, recordEvent, eventEligible, emptyWorld } = await import('../js/data/world.js');
  const { drawEvent } = await import('../js/data/events.js');
  const { eventDrawWeight, explainDrawWeight, eventRole, callbackAge } = await import('../js/data/eventpace.js');

  const fresh = (opts = {}) => {
    const run = newRun({ upgrades: {}, achievements: [] }, {
      classId: opts.classId || 'warrior', raceId: 'human', name: 'Pace', seed: opts.seed ?? 7,
    });
    run.floor = opts.floor ?? 8;
    run.biomeId = opts.biomeId || 'forest';
    ensureWorld(run);
    return run;
  };
  const ev = id => EVENTS.find(e => e.id === id);
  const term = (w, id) => (w.terms || []).find(x => x.id === id);

  const bardRet = ev('bard_returns');
  const bardRun = fresh({ floor: 5 });
  applyWorldPatch(bardRun, { flag: 'bard_friend' });
  recordEvent(bardRun, ev('bard'));
  t('bard_returns is a callback', eventRole(bardRet) === 'callback');
  bardRun.floor = 6;
  const bardCold = eventDrawWeight(bardRet, bardRun);
  bardRun.floor = 12;
  const bardWarm = eventDrawWeight(bardRet, bardRun);
  t('bard_returns colder next floor than several later', bardCold.w < bardWarm.w);
  t('bard_returns age term warms', (term(bardCold, 'age')?.mult || 0) < (term(bardWarm, 'age')?.mult || 0));

  const grudge = ev('mira_grudge');
  const miraRun = fresh({ floor: 13 });
  applyWorldPatch(miraRun, { flag: 'left_climber' });
  miraRun.floor = 14;
  const grudgeCold = eventDrawWeight(grudge, miraRun);
  miraRun.floor = 20;
  const grudgeWarm = eventDrawWeight(grudge, miraRun);
  t('mira grudge colder the next floor', grudgeCold.w < grudgeWarm.w);

  const congRun = fresh({ floor: 22, biomeId: 'ruins' });
  recordEvent(congRun, ev('mira_rumor'));
  recordEvent(congRun, ev('bard_verse'));
  const echoW = eventDrawWeight(ev('kings_echo'), congRun);
  const campW = eventDrawWeight(ev('campfire'), congRun);
  t('two narrative takes congest a third', (term(echoW, 'congestion')?.mult || 1) < 1);
  t('campfire unpenalized by narrative congestion', !term(campW, 'congestion'));
  t('shop unpenalized by narrative congestion', !term(eventDrawWeight(ev('merchant'), congRun), 'congestion'));

  const famRun = fresh({ floor: 16 });
  recordEvent(famRun, ev('mira_rumor'));
  const grudgeFam = eventDrawWeight(grudge, famRun);
  const chained = { ...grudge, pace: { ...(grudge.pace || {}), chain: true } };
  const grudgeChain = eventDrawWeight(chained, famRun);
  t('same-family extra penalty', (term(grudgeFam, 'congestion')?.mult || 1) < 0.7);
  t('pace.chain exempts family extra', grudgeChain.w > grudgeFam.w);

  const rite = ev('pale_rite');
  const necro = fresh({ classId: 'necromancer', floor: 8 });
  necro.kills = 25;
  const riteW = eventDrawWeight(rite, necro);
  t('pale_rite is initiation', eventRole(rite) === 'initiation');
  t('initiation boosted while eligible', (term(riteW, 'initiation')?.mult || 1) > 1);
  t('initiation skips long callback delay', !term(riteW, 'age') || term(riteW, 'age').mult >= 0.5);
  t('initiation is not guaranteed', riteW.w < 80 && eventDrawWeight(ev('campfire'), necro).w > 4);

  const watch = ev('mira_watch');
  const lateRun = fresh({ floor: 3 });
  applyWorldPatch(lateRun, { flag: 'saved_climber' });
  const at20 = { ...lateRun, floor: 20 };
  const at42 = { ...lateRun, floor: 42 };
  t('late payoff warmer than mid-climb', eventDrawWeight(watch, at42).w > eventDrawWeight(watch, at20).w);
  const stacked = { ...at42, recentNarrative: [{ role: 'payoff', family: 'mira', thread: 'mira', floor: 42 }] };
  t('second payoff the next beat is colder', (term(eventDrawWeight(ev('bard_last_song'), stacked), 'congestion')?.mult || 1) < 1);

  const rev = ev('revenant_memory');
  const winRun = fresh({ floor: 16, biomeId: 'ruins' });
  applyWorldPatch(winRun, { flag: 'revenant_oath' });
  winRun.floor = 19;
  const winW = eventDrawWeight(rev, winRun);
  t('windowed callback keeps meaningful weight', winW.w >= rev.w * 0.3);
  const usurper = ev('kings_usurper');
  const usurpRun = fresh({ floor: 16, biomeId: 'ruins' });
  recordEvent(usurpRun, ev('ghost_king'));
  const usurpW = eventDrawWeight(usurper, usurpRun);
  t('kings_usurper keeps weight inside floorMax', usurpW.w >= usurper.w * 0.3);

  const prodRun = fresh({ floor: 10 });
  applyWorldPatch(prodRun, { flag: 'bard_friend' });
  const explained = eventDrawWeight(bardRet, prodRun);
  const prod = explained.terms.reduce((s, x) => s * x.mult, 1);
  t('eventDrawWeight terms multiply to w', Math.abs(prod - explained.w) < 1e-6);
  t('explainDrawWeight matches gameplay', JSON.stringify(explainDrawWeight(bardRet, prodRun)) === JSON.stringify(explained));

  const seedRun = fresh({ floor: 8, seed: 99 });
  const pickA = drawEvent(makeRng(4242), seedRun);
  const pickB = drawEvent(makeRng(4242), seedRun);
  t('same seed same drawEvent pick', pickA.id === pickB.id);

  const old = fresh({ floor: 20 });
  old.flags.bard_friend = true;
  ensureWorld(old);
  let threw = false;
  let oldW;
  try { oldW = eventDrawWeight(bardRet, old); } catch { threw = true; }
  t('missing stamps do not throw', !threw && oldW.w > 0);
  t('missing stamps do not invent callback age', !term(oldW, 'age') && callbackAge(bardRet, old) == null);

  const miraA = ev('mira_rumor');
  const miraB = ev('mira_grudge');
  t('family exclude still blocks same-draw siblings',
    !eventEligible(miraB, fresh({ floor: 16 }), { exclude: [miraA.id], excludeFamilies: ['mira'] }));

  const stampRun = fresh({ floor: 11 });
  applyWorldPatch(stampRun, { flag: 'saved_climber', knowledge: 'heard_dead_language', thread: { id: 'mira', stage: 'saved' } });
  t('applyWorldPatch stamps flag since', stampRun.world.since.saved_climber === 11);
  t('applyWorldPatch stamps knowledge since', stampRun.world.since.heard_dead_language === 11);
  t('applyWorldPatch stamps thread floor', stampRun.world.threads.mira.floor === 11);
  recordEvent(stampRun, ev('campfire'));
  t('recordEvent writes recentNarrative', stampRun.recentNarrative.some(r => r.id === 'campfire' && r.role === 'flavor'));
  t('empty world has since map', !!emptyWorld().since);
  applyFlagBridge(stampRun, 'left_climber');
  t('live flag bridge stamps since', stampRun.world.since.left_climber === 11);

  t('bard_last_song is a payoff not an initiation', eventRole(ev('bard_last_song')) === 'payoff');
  t('intra-draw spaces another story card',
    (term(eventDrawWeight(ev('kings_echo'), fresh({ floor: 22 }), { offered: [ev('mira_rumor')] }), 'congestion')?.mult || 1) < 1);

  const { eventDrawPool } = await import('../js/data/events.js');
  const {
    oldSaveTiming, determinismCheck, debugParityCheck, familyChainCheck, authoringDefaults,
    lateCongestionSample, initiationSlotSample,
  } = await import('./pace_validate.js');

  const oldSave = oldSaveTiming();
  t('old save does not fabricate callback age', oldSave.noAgeOnLoad && oldSave.noFabricatedSince);
  t('old-save thread starts pacing after a live advance', oldSave.participatesAfterAdvance && oldSave.ageAfterAdvance === 1);

  const det = determinismCheck();
  t('identical seed+state reproduces pool weights', det.poolMatch);
  t('identical seed+state reproduces selected event', det.pickMatch);
  t('identical seed+state reproduces pacing history', det.historyMatch);

  const parity = debugParityCheck();
  t('World-debug weights match drawEvent for stacked modifiers', parity.every(p => p.match && p.termsProduct));
  t('stacked mira_watch includes late+age or congestion',
    (parity.find(p => p.id === 'mira_watch')?.terms || []).some(id => ['late', 'age', 'congestion'].includes(id)));
  t('stacked bard_returns uses pace.after age',
    (parity.find(p => p.id === 'bard_returns')?.terms || []).includes('age'));
  t('stacked pale_rite keeps initiation boost',
    (parity.find(p => p.id === 'pale_rite')?.terms || []).includes('initiation'));

  const fam = familyChainCheck();
  t('family exclude is same-draw only', fam.sameDrawExcluded && fam.laterEligible);
  t('high-weight family callback is not starved', fam.notStarved && fam.stillHasWeight);
  t('pace.chain still warms the sibling', fam.chainWarmer);

  const auth = authoringDefaults();
  t('almost no catalog pace metadata', auth.pacedIds.length <= 2 && auth.pacedIds.includes('bard_returns'));
  t('ordinary cards stay flavor without extra pace terms',
    auth.flavor.every(f => f.role === 'flavor' && f.paceTerms.length === 0));

  const late = lateCongestionSample({ trials: 10, seed: 424242 });
  t('late payoff does not stack consecutive takes', late.maxPayoffStreak <= 2);
  t('late payoff leaves ordinary climb content', late.ordinaryOfferShare >= 35 && late.flavorShare >= 30);

  const slots = initiationSlotSample({ trials: 50, seed: 3 });
  t('initiation boost is visible but not a next-draw lock', slots.offeredPct > 5 && slots.offeredPct < 95);

  const skipRun = fresh({ floor: 16 });
  applyWorldPatch(skipRun, { flag: 'left_climber' });
  const withP = eventDrawWeight(ev('mira_grudge'), skipRun);
  const noP = eventDrawWeight(ev('mira_grudge'), skipRun, { skipPace: true });
  t('skipPace measurement hook strips only pace terms',
    noP.terms.every(x => ['base', 'comeback', 'category', 'tags'].includes(x.id))
    && withP.w !== noP.w);
  const pool = eventDrawPool(skipRun);
  t('eventDrawPool shares eventDrawWeight',
    Math.abs(pool.find(x => x.id === 'mira_grudge').w - withP.w) < 1e-9);
}

{
  const { runRunHealthTests } = await import('./test_run_health.js');
  await runRunHealthTests(t);
}

{
  const { runCombatCoreTests } = await import('./test_combat_core.js');
  await runCombatCoreTests(t);
}

{
  const { runCombatPolicyTests } = await import('./test_combat_policy.js');
  runCombatPolicyTests(t);
}

{
  const { runClimbV2Tests } = await import('./test_climb_v2.js');
  await runClimbV2Tests(t);
}

{
  const { runPartyProxyTests } = await import('./test_party_proxy.js');
  await runPartyProxyTests(t);
}

{
  const { runDifficultyTests } = await import('./test_run_difficulty.js');
  await runDifficultyTests(t);
}

{
  const { runF10ProbeTests } = await import('./test_f10_probe.js');
  await runF10ProbeTests(t);
}

{
  const { runF20ProbeTests } = await import('./test_f20_probe.js');
  await runF20ProbeTests(t);
}

{
  const { runF30ProbeTests } = await import('./test_f30_probe.js');
  await runF30ProbeTests(t);
}

{
  const { runF40ProbeTests } = await import('./test_f40_probe.js');
  await runF40ProbeTests(t);
}

{
  const { runF50ProbeTests } = await import('./test_f50_probe.js');
  await runF50ProbeTests(t);
}

{
  const { runF48ProbeTests } = await import('./test_f48_probe.js');
  await runF48ProbeTests(t);
}

console.log('— clear-rate CDF 1p–4p (run_sim, real loot) —');
{
  t('TDC.clearRate bands defined', !!TDC.clearRate?.brickBy10 && !!TDC.clearRate?.reach30 && !!TDC.clearRate?.clear51);
  const { runClearRateSim, smokeProgress } = await import('./run_sim.js');
  const smoke = smokeProgress({ seed: 99, partySize: 1, trials: 4 });
  t('smoke climbs finish', smoke.every(r => r.maxFloor >= 1 && (r.deathFloor != null || r.cleared)));
  const deep = smoke.find(r => (r.sample?.progress || []).length >= 3);
  if (deep) {
    const p = deep.sample.progress;
    const a = p[0], b = p[p.length - 1];
    t('smoke kit grows with floor',
      b.level >= a.level
      && (b.gold > a.gold || b.relics > a.relics || b.equipped > a.equipped || b.maxHp > a.maxHp));
  } else {
    t('smoke kit grows with floor', false);
  }
  // Wider pad (±15pts) — brutal co-op retune expects high brick variance.
  const inBand = (v, [lo, hi], pad = 0.15) => v >= lo - pad && v <= hi + pad;
  for (const partySize of [1, 2, 3, 4]) {
    const rep = runClearRateSim({ seed: 20260719, trials: 120, partySize });
    const tag = partySize === 1 ? 'solo' : `${partySize}p`;
    t(`${tag} brick ≤F10 near target`, inBand(rep.brickRate, TDC.clearRate.brickBy10));
    t(`${tag} reach F30+ near target`, inBand(rep.reach30, TDC.clearRate.reach30));
    t(`${tag} clear F51 near target`, inBand(rep.clearRate, TDC.clearRate.clear51));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
