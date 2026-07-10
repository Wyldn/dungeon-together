// Automated tests (handoff §33) for the pure/data layers.
//   node tools/test.js
// DOM-bound behavior (combat rendering, multiplayer flows) is covered by the
// scripted playtest bot; everything testable headlessly lives here.

import { CLASSES, SUBCLASSES, subclassOptions } from '../js/data/classes.js';
import { RACES } from '../js/data/races.js';
import { ORIGINS } from '../js/data/origins.js';
import { SKILLS } from '../js/data/skills.js';
import { EVENTS, CATEGORY_META } from '../js/data/events.js';
import { ENEMIES, BOSSES, MODIFIERS } from '../js/data/enemies.js';
import { ALL_EQUIPMENT, RELICS, CONSUMABLES, itemById, EQUIP_SLOTS } from '../js/data/items.js';
import { CONFIG } from '../js/data/config.js';
import { RANK_ORDER, rankFor, rankAtLeast, appraisalRange, rollGrowthRank, growthMult } from '../js/data/ranks.js';
import { rollInitiative, initiativeOrder, addCharge, canAfford, pickEnemySpecial, enemyTelegraph, applyGuard } from '../js/systems.js';
import { makeRng } from '../js/rng.js';

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

console.log('— classes & subclasses (handoff §21) —');
t('six starting classes', Object.keys(CLASSES).length === 6);
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

console.log('— Guard (handoff §10) —');
t('guard blocks 70%', applyGuard(100, true) === 30);
t('guard-piercing ignores guard', applyGuard(100, true, true) === 100);
t('no guard, no reduction', applyGuard(100, false) === 100);

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
          t(`${e.id}: combat enemy ${eid} exists`, Object.values(ENEMIES).flat().some(x => x.id === eid));
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
}

console.log('— bribery (handoff §25) —');
{
  const all = Object.values(ENEMIES).flat();
  t('intelligent enemies exist', all.some(e => e.intelligent));
  t('mindless enemies exist', all.some(e => !e.intelligent));
  t('skeletons cannot be bribed', !all.find(e => e.id === 'skeleton').intelligent);
  t('bandits can be bribed', !!all.find(e => e.id === 'bandit').intelligent);
}

console.log('— config sanity —');
t('level-up restores 50% of missing', CONFIG.recovery.levelUpMissingPct === 0.5);
t('death respawn at 25%', CONFIG.death.respawnHpPct === 0.25 && CONFIG.death.respawnResourcePct === 0.25);
t('guard blocks 70% (config)', CONFIG.guard.blockPct === 0.7);
t('charge display name configurable', typeof CONFIG.charge.displayName === 'string');
t('modifiers have no sanity mechanics', !JSON.stringify(MODIFIERS).includes('sanity'));
t('relics have no sanity mechanics', !JSON.stringify(RELICS).includes('anity'));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
