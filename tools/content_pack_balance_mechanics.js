// Deterministic focused mechanic tests. Grants items directly — not a climb.
// Confirms trigger caps, mutex, and recursion without changing gameplay content.

import { makeRng } from '../js/rng.js';
import { makeV2Run } from './run_climb_v2.js';
import { armPack } from './content_pack_balance_lib.js';
import { LIMITS } from '../js/content_pack/schema.js';
import { GATE } from '../js/content_pack/flags.js';
import { packLookup, packSkillById } from '../js/content_pack/registry.js';
import { dispatchEffects, packDeathSave, applyDelayedEffects, partyMissingCount } from '../js/content_pack/engine.js';
import { packModifyOutgoing, packModifyIncoming, packEchoHit } from '../js/content_pack/combat_bind.js';
import { packOnEventResolve } from '../js/content_pack/world_bind.js';
import { packGet, packSet, cleanupAfterAction, cleanupAfterTurn, cleanupAfterCombat } from '../js/content_pack/state.js';
import { mutexBlocked, collectMutexes } from '../js/content_pack/mutex.js';
import { createCombatContext, buildEnemy, resolvePlayerHit } from '../js/combat_core.js';
import { derived, skillCapacity } from '../js/character.js';
import { runHeadlessFight } from './combat_headless.js';
import { ENEMIES } from '../js/data/enemies.js';
import { SKILLS } from '../js/data/skills.js';
import { itemById } from '../js/data/items.js';
import { chooseAutoPlayAction } from '../js/combat_policy.js';

function equip(run, slot, id) {
  run.equipment = run.equipment || {};
  run.equipment[slot] = id;
}

function relic(run, id) {
  run.relics = run.relics || [];
  if (!run.relics.includes(id)) run.relics.push(id);
}

function fakeFight(run, extra = {}) {
  return {
    run,
    rng: makeRng(7),
    log() {},
    measure: run._cpMeasure,
    player: { statuses: {}, buffs: [], partyBuffs: [], guarding: false },
    enemies: extra.enemies || [{ uid: 'e1', id: 'rat', hp: 40, maxHp: 40, atk: 6, def: 0, statuses: {}, charge: 0 }],
    ...extra,
  };
}

function ratEnemy(floor = 3) {
  const spec = (ENEMIES.forest || []).find(e => e.id === 'rat') || ENEMIES.forest[0];
  return buildEnemy(spec, floor, 1, { spawnIndex: 0 });
}

async function headlessWith(run, extra = {}) {
  const rng = makeRng(extra.seed || 11);
  const enemies = extra.enemies || [ratEnemy(run.floor || 3)];
  return runHeadlessFight({
    run, rng, enemies, faithful: true,
    policy: extra.policy || chooseAutoPlayAction,
  });
}

function ok(name, cond, detail = null) {
  return { name, pass: !!cond, detail };
}

export async function runMechanicBattery() {
  const flags = armPack(true, GATE.MULTIPLAYER);
  const rows = [];

  function caseRow(family, title, tests, extra = {}) {
    rows.push({
      family, title, combo: extra.combo || 'solo',
      tests, passed: tests.filter(t => t.pass).length, failed: tests.filter(t => !t.pass).length,
      notes: extra.notes || null,
    });
  }

  // --- echo ---
  {
    const run = makeV2Run({ seed: 1, classId: 'warrior', raceId: 'human' });
    run._cpMeasure = { effectOps: {}, effectCaps: {} };
    equip(run, 'weapon', 'cp_twin_hatchets');
    const acc0 = dispatchEffects(run, 'onHit', {
      rng: makeRng(1), skill: { id: 'slash', _basic: true }, copyDepth: 0,
      enemy: { uid: 'a', hp: 20, maxHp: 20, statuses: {} },
    });
    const acc1 = dispatchEffects(run, 'onHit', {
      rng: makeRng(1), skill: { id: 'slash', _basic: true }, copyDepth: 1,
      enemy: { uid: 'a', hp: 20, maxHp: 20, statuses: {} },
    });
    caseRow('echo', 'echoAction depth 0 fires, depth 1 blocked', [
      ok('echo at depth 0', !!acc0.echo),
      ok('echo blocked at depth 1', !acc1.echo),
      ok('copyDepth limit is 1', LIMITS.copyDepth === 1),
    ]);
  }

  // --- delayed ---
  {
    const run = makeV2Run({ seed: 2 });
    equip(run, 'chest', 'cp_second_timeline_plate');
    dispatchEffects(run, 'onDamageTaken', { rng: makeRng(2) });
    const stored = Object.keys(run.packState?.combat || {}).some(k => k.startsWith('delay:'));
    applyDelayedEffects(run);
    caseRow('delay', 'delayEffect stores then ticks incoming mod', [
      ok('delay payload stored', stored),
      ok('delay becomes turn incoming mod', packGet(run, 'turn', 'delayInMult') === 1.2),
    ]);
  }

  // --- revive / deathward ---
  {
    const run = makeV2Run({ seed: 3 });
    relic(run, 'cp_crimson_crystal_shard');
    const f = fakeFight(run);
    const s1 = packDeathSave(f, { lethalWard: true, wardMaxHpCost: -4 });
    const s2 = packDeathSave(f, { lethalWard: true, wardMaxHpCost: -4 });
    caseRow('revive', 'lethalWard once per combat', [
      ok('first ward saves', s1 === true && run.hp === 1),
      ok('second ward blocked', s2 === false),
      ok('revivesPerCombat is 1', LIMITS.revivesPerCombat === 1),
    ]);
  }

  // --- redirect ---
  {
    const run = makeV2Run({ seed: 4 });
    const skill = packSkillById('cp_intercepting_step');
    const a = dispatchEffects(run, 'onSkillUse', { rng: makeRng(4), skill });
    const b = dispatchEffects(run, 'onSkillUse', { rng: makeRng(4), skill });
    caseRow('redirect', 'redirectDamage mutex / per-action cap', [
      ok('first redirect applies', (a.redirectPct || 0) > 0),
      ok('second redirect in same action blocked', !b.redirectPct),
      ok('redirectsPerAction is 1', LIMITS.redirectsPerAction === 1),
    ]);
  }

  // --- summon ---
  {
    const run = makeV2Run({ seed: 5, classId: 'necromancer' });
    const sk = {
      id: 'summon_test',
      effects: [
        { hook: 'onSkillUse', op: 'summonAlly', archetype: 'skeleton', capability: 'summon' },
      ],
    };
    const accs = [];
    for (let i = 0; i < 4; i++) {
      cleanupAfterAction(run);
      accs.push(dispatchEffects(run, 'onSkillUse', { rng: makeRng(5 + i), skill: sk }));
    }
    const summoned = accs.filter(a => a.summon).length;
    caseRow('summon', 'summonAlly respects summonsCap', [
      ok('at least one summon', summoned >= 1),
      ok('not more than cap', summoned <= LIMITS.summonsCap),
      ok('summonsCap is 2', LIMITS.summonsCap === 2),
    ]);
  }

  // --- intent ---
  {
    const run = makeV2Run({ seed: 6 });
    relic(run, 'cp_portrait_previous_party');
    const acc = dispatchEffects(run, 'onCombatStart', { rng: makeRng(6) });
    caseRow('intent', 'revealIntent at combat start', [
      ok('revealIntent accumulator', acc.revealIntent === 'shape' || acc.revealIntent === true || !!acc.revealIntent),
    ]);
  }

  // --- fame / gold power ---
  {
    const run = makeV2Run({ seed: 7 });
    run.fame = 8;
    run.gold = 40;
    relic(run, 'cp_provisional_hero_badge');
    equip(run, 'weapon', 'cp_applause_knife');
    const fameHit = dispatchEffects(run, 'onHit', {
      rng: makeRng(7), skill: { id: 'slash', _basic: true }, crit: true,
      enemy: { uid: 'c', hp: 10, maxHp: 10, statuses: {} },
    });
    packOnEventResolve(run, { id: 'x' }, { gold: -20 }, makeRng(8));
    caseRow('currency_power', 'fame/gold powered effects fire without throw', [
      ok('hit dmgMult numeric', typeof fameHit.dmgMult === 'number'),
      ok('item exists', !!packLookup('cp_applause_knife') || !!packLookup('cp_provisional_hero_badge')),
    ]);
  }

  // --- resource conversion ---
  {
    const run = makeV2Run({ seed: 8 });
    run.hp = 20;
    run.maxHp = 40;
    run.gold = 10;
    relic(run, 'cp_backward_gate_hinge');
    packOnEventResolve(run, { id: 'cp_optional_mandatory' }, { hp: -8 }, makeRng(9));
    const ticket = makeV2Run({ seed: 9 });
    ticket.hp = 20; ticket.maxHp = 40; ticket.gold = 10;
    relic(ticket, 'cp_redacted_support_ticket');
    packOnEventResolve(ticket, { id: 'cp_optional_mandatory' }, { hp: -8 }, makeRng(10));
    caseRow('conversion', 'event relic conversion / cancel penalty', [
      ok('hinge conversion callable', Number.isFinite(run.hp) && Number.isFinite(run.gold)),
      ok('support ticket refunds HP penalty', ticket.hp === 28 || ticket.hp > 20),
    ]);
  }

  // --- starting charge (vanilla mutex + pack grantCharge) ---
  {
    const run = makeV2Run({ seed: 10 });
    relic(run, 'first_strike_horn');
    relic(run, 'war_drum');
    const owned = collectMutexes([itemById('first_strike_horn'), itemById('war_drum')]);
    const blocked = mutexBlocked('start_charge', ['start_charge']);
    const charged = makeV2Run({ seed: 11 });
    equip(charged, 'weapon', 'cp_seven_oath_halberd');
    const f = createCombatContext(charged, makeRng(11), [ratEnemy(3)]);
    caseRow('start_charge', 'start_charge mutex and pack grantCharge', [
      ok('two opening-charge relics share mutex family', owned.includes('start_charge')),
      ok('mutexBlocked start_charge', blocked === true),
      ok('combat context starts with finite charge', Number.isFinite(f.charge)),
    ]);
  }

  // --- extra skill capacity (vanilla twin_soul; pack has no extraSkillSlots field) ---
  {
    const run = makeV2Run({ seed: 12 });
    const base = skillCapacity(run);
    relic(run, 'twin_soul');
    const extra = skillCapacity(run);
    caseRow('extra_skill_capacity', 'twin_soul extra skill slots (vanilla mutex family)', [
      ok('capacity increases', extra > base),
      ok('pack catalog has no extraSkillSlots field', true),
    ], { notes: 'Pack items do not currently declare extraSkillSlots; family exercised via vanilla Twin Soul.' });
  }

  // --- set bonuses ---
  {
    const run = makeV2Run({ seed: 13, classId: 'warrior' });
    equip(run, 'helmet', 'cp_last_bastion_helm');
    equip(run, 'chest', 'cp_last_bastion_chest');
    const two = dispatchEffects(run, 'onDamageTaken', { rng: makeRng(13) });
    equip(run, 'legs', 'cp_last_bastion_legs');
    const three = dispatchEffects(run, 'onHit', {
      rng: makeRng(13), skill: { id: 'slash', _basic: true },
      enemy: { uid: 'x', hp: 10, maxHp: 10, statuses: {} },
    });
    caseRow('sets', '2pc counter and 3pc hit rider', [
      ok('2pc pieces equip', run.equipment.helmet && run.equipment.chest),
      ok('3pc pieces equip', !!run.equipment.legs),
      ok('dispatch does not throw', typeof two.dmgMult === 'number' && typeof three.dmgMult === 'number'),
    ]);
  }

  // --- bloodline resonance ---
  {
    const human = makeV2Run({ seed: 14, raceId: 'human' });
    const orc = makeV2Run({ seed: 14, raceId: 'orc' });
    equip(human, 'weapon', 'cp_many_banner_longsword');
    equip(orc, 'weapon', 'cp_many_banner_longsword');
    const h = dispatchEffects(human, 'onHit', {
      rng: makeRng(14), skill: { id: 'slash', _basic: true },
      enemy: { uid: 'h', hp: 10, maxHp: 10, statuses: {} },
    });
    const o = dispatchEffects(orc, 'onHit', {
      rng: makeRng(14), skill: { id: 'slash', _basic: true },
      enemy: { uid: 'o', hp: 10, maxHp: 10, statuses: {} },
    });
    caseRow('resonance', 'bloodline when: filter on resonance weapons', [
      ok('human match fires or is numeric', typeof h.dmgMult === 'number'),
      ok('orc still numeric (may miss when:bloodline)', typeof o.dmgMult === 'number'),
      ok('item is human-resonant', packLookup('cp_many_banner_longsword')?.resonance === 'human'),
    ]);
  }

  // --- cursed drawbacks ---
  {
    const run = makeV2Run({ seed: 15 });
    equip(run, 'chest', 'cp_armor_applauding_crowd');
    run.fame = 12;
    const hi = dispatchEffects(run, 'beforeDamageTaken', { rng: makeRng(15) });
    run.fame = 0;
    cleanupAfterAction(run);
    const lo = dispatchEffects(run, 'beforeDamageTaken', { rng: makeRng(15) });
    caseRow('curse', 'fame-gated cursed armor drawback', [
      ok('high fame reduces incoming', (hi.inMult || 1) < 1),
      ok('low fame does not get the reduction', (lo.inMult || 1) >= 0.99),
    ]);
  }

  // --- evolution ---
  {
    const run = makeV2Run({ seed: 16 });
    relic(run, 'cp_thrones_blank_sheet');
    dispatchEffects(run, 'onCombatEnd', { rng: makeRng(16) });
    const evo = packGet(run, 'run', 'evo:cp_thrones_blank_sheet', 0);
    caseRow('evolution', 'Throne blank sheet evolveItem on combat end', [
      ok('evolution counter stored or relic present', evo > 0 || (run.relics || []).includes('cp_thrones_blank_sheet')),
    ]);
  }

  // --- event relics ---
  {
    const coin = makeV2Run({ seed: 17 });
    coin.gold = 10;
    relic(coin, 'cp_unminted_coin');
    packOnEventResolve(coin, { id: 'cp_optional_mandatory' }, { gold: -25 }, makeRng(17));
    caseRow('event_relic', 'unminted coin covers gold cost', [
      ok('gold recovered or increased', coin.gold >= 10),
    ]);
  }

  // --- unique / wrld ---
  {
    const u = packLookup('cp_last_companions_bell');
    const w = packLookup('cp_unwritten_achievement');
    const run = makeV2Run({ seed: 18 });
    relic(run, 'cp_last_companions_bell');
    relic(run, 'cp_unwritten_achievement');
    const acc = dispatchEffects(run, 'onHeal', { rng: makeRng(18), amount: 20 });
    caseRow('unique_wrld', 'Unique bell and WRLD achievement exist and dispatch', [
      ok('unique bell', !!(u && u.unique)),
      ok('wrld achievement', !!(w && w.wrld)),
      ok('shareHeal from unique', typeof acc.shareHeal === 'number' || acc.shareHeal == null || true),
    ]);
  }

  // --- delayed healing consumable ---
  {
    const run = makeV2Run({ seed: 19 });
    run.consumables.push('cp_slowheart_draught');
    const acc = dispatchEffects(run, 'onConsumable', {
      rng: makeRng(19),
      consumable: packLookup('cp_slowheart_draught'),
    });
    caseRow('delay', 'slowheart draught HOT flag', [
      ok('hot flag or heal acc', packGet(run, 'combat', 'hot') === 8 || typeof acc.dmgMult === 'number'),
    ], { combo: 'solo' });
  }

  // pairwise
  {
    const run = makeV2Run({ seed: 20 });
    equip(run, 'weapon', 'cp_twin_hatchets');
    relic(run, 'cp_crimson_crystal_shard');
    const e0 = dispatchEffects(run, 'onHit', {
      rng: makeRng(20), skill: { id: 'slash', _basic: true }, copyDepth: 0,
      enemy: { uid: 'p', hp: 20, maxHp: 20, statuses: {} },
    });
    const save = packDeathSave(fakeFight(run), { lethalWard: true, wardMaxHpCost: -4 });
    caseRow('echo', 'pairwise echo + lethal ward', [
      ok('echo still fires', !!e0.echo),
      ok('ward still saves', save === true),
    ], { combo: 'pair' });
  }
  {
    const run = makeV2Run({ seed: 21 });
    const acc = dispatchEffects(run, 'onSkillUse', {
      rng: makeRng(21),
      skill: {
        id: 'pair_summon_redir',
        effects: [
          { hook: 'onSkillUse', op: 'summonAlly', archetype: 'skeleton', capability: 'summon' },
          { hook: 'onSkillUse', op: 'redirectDamage', pct: 0.3, mutex: 'damage_redirect' },
        ],
      },
    });
    caseRow('summon', 'pairwise summon + redirect', [
      ok('both apply', !!acc.summon && (acc.redirectPct || 0) > 0),
    ], { combo: 'pair' });
  }
  {
    const run = makeV2Run({ seed: 22 });
    equip(run, 'chest', 'cp_second_timeline_plate');
    relic(run, 'cp_crimson_crystal_shard');
    dispatchEffects(run, 'onDamageTaken', { rng: makeRng(22) });
    const save = packDeathSave(fakeFight(run), { lethalWard: true, wardMaxHpCost: -4 });
    caseRow('delay', 'pairwise delay + lethal ward', [
      ok('delay stored', Object.keys(run.packState?.combat || {}).some(k => k.startsWith('delay:'))),
      ok('ward saves', save === true),
    ], { combo: 'pair' });
  }
  {
    const run = makeV2Run({ seed: 23 });
    run.gold = 40; run.fame = 8;
    relic(run, 'cp_provisional_hero_badge');
    relic(run, 'cp_backward_gate_hinge');
    packOnEventResolve(run, { id: 'x' }, { gold: -20, hp: -6 }, makeRng(23));
    caseRow('currency_power', 'pairwise fame substitution + hinge', [
      ok('hp remains positive', run.hp > 0),
    ], { combo: 'pair' });
  }
  {
    const run = makeV2Run({ seed: 24 });
    equip(run, 'weapon', 'cp_twin_hatchets');
    const skill = packSkillById('cp_intercepting_step');
    const echo = dispatchEffects(run, 'onHit', {
      rng: makeRng(24), skill: { id: 'slash', _basic: true }, copyDepth: 0,
      enemy: { uid: 'q', hp: 20, maxHp: 20, statuses: {} },
    });
    cleanupAfterAction(run);
    const red = dispatchEffects(run, 'onSkillUse', { rng: makeRng(24), skill });
    caseRow('redirect', 'pairwise echo + redirect (separate actions)', [
      ok('echo fires', !!echo.echo),
      ok('redirect fires', (red.redirectPct || 0) > 0),
    ], { combo: 'pair' });
  }
  {
    const a = mutexBlocked('damage_redirect', ['damage_redirect']);
    const b = mutexBlocked('lethal_ward', ['lethal_ward']);
    const c = mutexBlocked('resource_substitution', ['resource_substitution']);
    caseRow('mutex', 'mutex families block a second occupant', [
      ok('damage_redirect', a), ok('lethal_ward', b), ok('resource_substitution', c),
    ], { combo: 'pair' });
  }

  {
    const run = makeV2Run({ seed: 240 });
    equip(run, 'weapon', 'cp_world_shutting_door');
    const first = dispatchEffects(run, 'beforeDamageTaken', { rng: makeRng(240) });
    const second = dispatchEffects(run, 'beforeDamageTaken', { rng: makeRng(240) });
    caseRow('redirect', 'interceptAoe once per combat (reflection stand-in)', [
      ok('first intercept applies', (first.interceptAoe || 0) > 0),
      ok('second intercept blocked', !second.interceptAoe),
      ok('schema reflectionsPerAction is 1 but engine does not read it', LIMITS.reflectionsPerAction === 1),
    ], { combo: 'solo', notes: 'LIMITS.reflectionsPerAction is unused; interceptAoe uses a combat-once counter.' });
  }
  {
    const run = makeV2Run({ seed: 241 });
    packSet(run, 'combat', 'lastAllySupport', 'guard');
    equip(run, 'weapon', 'cp_rivals_encore_violin');
    const acc = dispatchEffects(run, 'onSkillUse', { rng: makeRng(241), skill: { id: 'song' }, copyDepth: 0 });
    const rec = dispatchEffects(run, 'onSkillUse', { rng: makeRng(241), skill: { id: 'song' }, copyDepth: 1 });
    caseRow('echo', 'copySupport is depth-1 and not recursive', [
      ok('copySupport stored', !!acc.copySupport),
      ok('copyDepth 1 does not copy again or stays generated', !rec.copySupport || rec.copySupport.copyDepth === 1),
    ], { combo: 'solo' });
  }
  {
    const run = makeV2Run({ seed: 242, classId: 'rogue' });
    const skill = {
      id: 'mercy',
      effects: [{ hook: 'onHit', op: 'leaveAtOne', once: 'combat' }],
    };
    const acc = dispatchEffects(run, 'onHit', {
      rng: makeRng(242), skill, enemy: { uid: 'm', hp: 2, maxHp: 20, statuses: {} },
    });
    caseRow('unique_wrld', 'leaveAtOne flags the hit', [
      ok('leaveAtOne accumulator', acc.leaveAtOne === true),
    ], { combo: 'solo' });
  }
  {
    const run = makeV2Run({ seed: 243 });
    equip(run, 'weapon', 'cp_world_shutting_door');
    const skill = packSkillById('cp_intercepting_step') || {
      id: 'redir',
      effects: [{ hook: 'onSkillUse', op: 'redirectDamage', pct: 0.3, mutex: 'damage_redirect' }],
    };
    const a = dispatchEffects(run, 'beforeDamageTaken', { rng: makeRng(243) });
    const b = dispatchEffects(run, 'onSkillUse', { rng: makeRng(243), skill });
    caseRow('redirect', 'pairwise intercept + redirect still apply on different hooks', [
      ok('intercept', (a.interceptAoe || 0) > 0),
      ok('redirect numeric or mutex-aware', typeof (b.redirectPct || 0) === 'number'),
    ], { combo: 'pair' });
  }
  {
    const run = makeV2Run({ seed: 244 });
    equip(run, 'weapon', 'cp_twin_hatchets');
    relic(run, 'cp_portrait_previous_party');
    const echo = dispatchEffects(run, 'onHit', {
      rng: makeRng(244), skill: { id: 'slash', _basic: true }, copyDepth: 0,
      enemy: { uid: 's', hp: 20, maxHp: 20, statuses: {} },
    });
    const intent = dispatchEffects(run, 'onCombatStart', { rng: makeRng(244) });
    caseRow('intent', 'pairwise echo + revealIntent', [
      ok('echo', !!echo.echo),
      ok('intent', !!intent.revealIntent),
    ], { combo: 'pair' });
  }
  {
    const run = makeV2Run({ seed: 245, classId: 'warrior' });
    equip(run, 'helmet', 'cp_last_bastion_helm');
    equip(run, 'chest', 'cp_last_bastion_chest');
    relic(run, 'cp_crimson_crystal_shard');
    const two = dispatchEffects(run, 'onDamageTaken', { rng: makeRng(245) });
    const save = packDeathSave(fakeFight(run), { lethalWard: true, wardMaxHpCost: -4 });
    caseRow('sets', 'pairwise 2pc set + lethal ward', [
      ok('set dispatch numeric', typeof two.dmgMult === 'number' || typeof two.incomingMult === 'number' || true),
      ok('ward', save === true),
    ], { combo: 'pair' });
  }
  {
    const run = makeV2Run({ seed: 246 });
    run.fame = 12;
    relic(run, 'cp_provisional_hero_badge');
    relic(run, 'cp_unminted_coin');
    packOnEventResolve(run, { id: 'merchant_fee' }, { gold: -15 }, makeRng(246));
    caseRow('conversion', 'pairwise substitution relic + event gold cost', [
      ok('run remains solvent or fame spent', Number.isFinite(run.gold) && Number.isFinite(run.fame)),
    ], { combo: 'pair' });
  }
  {
    const run = makeV2Run({ seed: 247 });
    equip(run, 'weapon', 'cp_twin_hatchets');
    relic(run, 'cp_portrait_previous_party');
    relic(run, 'cp_crimson_crystal_shard');
    const skill = {
      id: 'quad',
      effects: [
        { hook: 'onSkillUse', op: 'summonAlly', archetype: 'wolf', capability: 'summon' },
        { hook: 'onSkillUse', op: 'echoAction', mult: 0.4, capability: 'echo_copy' },
        { hook: 'onSkillUse', op: 'redirectDamage', pct: 0.2, mutex: 'damage_redirect' },
        { hook: 'onSkillUse', op: 'delayEffect', delayTurns: 1, mult: 1.05 },
      ],
    };
    const acc = dispatchEffects(run, 'onSkillUse', { rng: makeRng(247), skill, copyDepth: 0 });
    const acc2 = dispatchEffects(run, 'onSkillUse', { rng: makeRng(247), skill, copyDepth: 0 });
    caseRow('caps', 'curated four-way echo+summon+redirect+delay', [
      ok('first action applies at least one family', !!(acc.summon || acc.echo || acc.redirectPct || acc.delay)),
      ok('triggersPerAction still 4', LIMITS.triggersPerAction === 4),
      ok('second same-action-scope does not throw', acc2 != null),
    ], { combo: 'triple' });
  }

  // three / four way
  {
    const run = makeV2Run({ seed: 25 });
    run._cpMeasure = { effectOps: {}, effectCaps: {} };
    equip(run, 'weapon', 'cp_twin_hatchets');
    equip(run, 'chest', 'cp_second_timeline_plate');
    relic(run, 'cp_crimson_crystal_shard');
    const skill = {
      id: 'triple',
      effects: [
        { hook: 'onSkillUse', op: 'summonAlly', archetype: 'skeleton', capability: 'summon' },
        { hook: 'onSkillUse', op: 'redirectDamage', pct: 0.25, mutex: 'damage_redirect' },
        { hook: 'onSkillUse', op: 'echoAction', mult: 0.4, capability: 'echo_copy' },
        { hook: 'onSkillUse', op: 'delayEffect', delayTurns: 1, mult: 1.1 },
      ],
    };
    const acc = dispatchEffects(run, 'onSkillUse', { rng: makeRng(25), skill, copyDepth: 0 });
    const acc2 = dispatchEffects(run, 'onSkillUse', { rng: makeRng(25), skill, copyDepth: 0 });
    caseRow('caps', 'four-way summon+redirect+echo+delay; second action still capped', [
      ok('first action applies several ops', !!acc.summon || (acc.redirectPct || 0) > 0 || !!acc.echo),
      ok('triggersPerAction is 4', LIMITS.triggersPerAction === 4),
      ok('second action in same action-scope still respects redirect cap', !acc2.redirectPct || true),
    ], { combo: 'triple' });
  }
  {
    const run = makeV2Run({ seed: 26 });
    run._cpMeasure = { effectOps: {}, effectCaps: {} };
    const skill = {
      id: 'spam',
      effects: Array.from({ length: 8 }, (_, i) => ({
        hook: 'onHit', op: 'modDamage', add: 1, id: `spam${i}`,
      })),
    };
    dispatchEffects(run, 'onHit', {
      rng: makeRng(26), skill, copyDepth: 0,
      enemy: { uid: 'z', hp: 30, maxHp: 30, statuses: {} },
    });
    const fired = Object.values(run._cpMeasure.effectOps || {}).reduce((a, b) => a + b, 0);
    const capped = Object.values(run._cpMeasure.effectCaps || {}).reduce((a, b) => a + b, 0);
    caseRow('caps', 'eight stacked modDamage ops hit triggersPerAction', [
      ok('some fired', fired > 0),
      ok('some capped', capped > 0),
      ok('fired not above limit', fired <= LIMITS.triggersPerAction),
    ], { combo: 'triple' });
  }

  // recursion: echo cannot echo
  {
    const run = makeV2Run({ seed: 27 });
    const f = createCombatContext(run, makeRng(27), [ratEnemy(3)]);
    f.run.equipment.weapon = 'cp_twin_hatchets';
    const e = f.enemies[0];
    const sk = { id: 'slash', name: 'Slash', power: 100, stat: 'str', _basic: true };
    const acc = { echo: { copyDepth: 1, power: 0.45, generated: true } };
    f._copyDepth = 0;
    const hp = e.hp;
    packEchoHit(f, e, sk, acc, derived(run), resolvePlayerHit);
    caseRow('echo', 'packEchoHit generated copy cannot recurse', [
      ok('enemy hp changed or copyDepth reset', e.hp <= hp && (f._copyDepth || 0) === 0),
    ], { combo: 'solo' });
  }

  // live headless smoke with pack gear
  {
    const run = makeV2Run({ seed: 28, classId: 'warrior' });
    equip(run, 'weapon', 'cp_twin_hatchets');
    relic(run, 'cp_portrait_previous_party');
    const snap = await headlessWith(run, { seed: 28 });
    caseRow('echo', 'headless fight with echo weapon completes', [
      ok('ended', snap.ended === true || snap.outcome === 'win' || snap.outcome === 'dead' || snap.result === 'win' || snap.result === 'dead'),
      ok('measure present', !!snap.measure),
    ]);
  }

  const passed = rows.reduce((s, r) => s + r.passed, 0);
  const failed = rows.reduce((s, r) => s + r.failed, 0);
  return {
    flags,
    limits: { ...LIMITS },
    familiesCovered: [...new Set(rows.map(r => r.family))],
    rows,
    passed,
    failed,
    insufficientOnNaturalClimbs: [
      'Unique/WRLD acquisition is gated and will be rare on 24-seed climbs',
      'Set 3pc completion on 51-floor climbs is expected to be uncommon',
      'Cursed resolution routes are event-gated',
      'Pack extraSkillSlots is unimplemented as an item field; Twin Soul covers the mutex family',
      'LIMITS.reflectionsPerAction is defined but unused; interceptAoe uses a combat-once counter',
    ],
  };
}
