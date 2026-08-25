// Player Battle Charge timing + charged-ability cooldowns.
//   node tools/test.js  (wired) or node --input-type=module -e "..."
import { SKILLS } from '../js/data/skills.js';
import { SKILL_COOLDOWNS } from '../js/data/skill_cooldowns.js';
import { CONFIG } from '../js/data/config.js';
import {
  skillCooldownTurns, skillEligibility, canAfford,
} from '../js/systems.js';
import { makeRng } from '../js/rng.js';
import {
  buildEnemy, createCombatContext, beginPlayerTurn, applyAction, snapshotCombat,
  applyCombatSnapshot, stepSolo, resolveEnemyTurn, finishHeadlessSolo,
} from '../js/combat_core.js';
import { fixtureRun, fixtureEnemy } from './combat_fixtures.js';
import { chooseAutoPlayAction } from '../js/combat_policy.js';
import { serializeClimber } from '../js/mp_checkpoint.js';

function trash(over = {}) {
  return fixtureEnemy('wolf', { uid: 'e1', floor: 5, hp: 400, ...over }, buildEnemy);
}

function ctx({ classId = 'warrior', skills = ['slash', 'shield_bash', 'cleave'], charge = 0, mp, ...over } = {}) {
  const run = fixtureRun({ classId, skills, mp: mp ?? 80, maxMp: 80, hp: 80, maxHp: 80 });
  const f = createCombatContext(run, makeRng(11), [trash()], null);
  f.charge = charge;
  Object.assign(f, over);
  return f;
}

export async function runPlayerChargeCdTests(t) {
  console.log('— player charge cooldowns & turn-start Battle Charge —');

  const byId = Object.fromEntries(Object.values(SKILLS).map(sk => [sk.id, sk]));
  const charged = Object.values(SKILLS).filter(sk => (sk.charge || 0) >= 1);
  const free = Object.values(SKILLS).filter(sk => (sk.charge || 0) < 1);
  t('charged catalog is non-empty', charged.length >= 80);
  for (const sk of charged) {
    t(`${sk.id}: table has a cooldown`, SKILL_COOLDOWNS[sk.id] >= 1 && SKILL_COOLDOWNS[sk.id] <= 3);
    t(`${sk.id}: runtime CD matches table`, skillCooldownTurns(sk) === SKILL_COOLDOWNS[sk.id]);
  }
  for (const id of Object.keys(SKILL_COOLDOWNS)) {
    t(`table ${id} exists as a skill`, !!byId[id]);
    t(`table ${id} is charge-gated`, (byId[id]?.charge || 0) >= 1);
  }
  for (const sk of free) {
    t(`${sk.id}: free skill never cools down`, skillCooldownTurns(sk) === 0);
  }
  t('Strike is free', skillCooldownTurns(SKILLS.basic_attack) === 0);
  t('Guard is free', skillCooldownTurns(SKILLS.guard) === 0);
  t('Dark Pact is free (resource engine)', skillCooldownTurns(SKILLS.dark_pact) === 0);
  t('classes do not share one CD for 1⚡',
    SKILL_COOLDOWNS.shield_bash === 1 && SKILL_COOLDOWNS.war_cry === 2
    && SKILL_COOLDOWNS.frost_lance === 1 && SKILL_COOLDOWNS.rallying_chord === 2);

  {
    const f = ctx({ charge: 0 });
    t('combat opens at authored start charge (0 here)', f.charge === 0);
    const began = beginPlayerTurn(f);
    t('turn start is not skipped', began.skipped === false);
    t('charge is granted before selection', f.charge === CONFIG.charge.gainPerTurn);
    t('start-of-turn charge is immediately usable', canAfford(SKILLS.shield_bash, f.run.mp, f.charge));
    beginPlayerTurn(f);
    t('reconnect/idempotent begin does not double-grant', f.charge === CONFIG.charge.gainPerTurn);
  }

  {
    const f = ctx({ charge: 2 });
    beginPlayerTurn(f);
    const afterStart = f.charge;
    await applyAction(f, { type: 'useSkill', skillId: 'slash' });
    t('acting turn does not also grant end-of-turn charge', f.charge === afterStart);
  }

  {
    const f = ctx({ charge: 0, skills: ['slash', 'shield_bash'] });
    // CD 1: use T1, blocked T2, available T3
    beginPlayerTurn(f);
    await applyAction(f, { type: 'useSkill', skillId: 'shield_bash' });
    t('CD 1 remaining after use is 1', f.skillCDs.shield_bash === 1);
    const t2 = beginPlayerTurn(f);
    t('CD 1 still blocked at start of next turn', t2.skipped === false && f.skillCDs.shield_bash === 1);
    t('CD 1 not selectable on T+1', skillEligibility(SKILLS.shield_bash, {
      mp: 80, charge: f.charge, cds: f.skillCDs,
    }).reasons.includes('cooldown'));
    await applyAction(f, { type: 'useSkill', skillId: 'slash' });
    t('CD 1 ticks after the blocked turn completes', f.skillCDs.shield_bash == null);
    beginPlayerTurn(f);
    t('CD 1 available at start of T+2', !f.skillCDs.shield_bash);
  }

  {
    const f = ctx({ charge: 5, skills: ['slash', 'cleave'] });
    // CD 2: use T1, blocked T2 T3, available T4
    beginPlayerTurn(f);
    await applyAction(f, { type: 'useSkill', skillId: 'cleave' });
    t('CD 2 remaining after use is 2', f.skillCDs.cleave === 2);
    beginPlayerTurn(f);
    t('CD 2 blocked on T+1', f.skillCDs.cleave === 2);
    await applyAction(f, { type: 'useSkill', skillId: 'slash' });
    t('CD 2 remaining 1 after first skipped turn', f.skillCDs.cleave === 1);
    beginPlayerTurn(f);
    t('CD 2 blocked on T+2', f.skillCDs.cleave === 1);
    await applyAction(f, { type: 'useSkill', skillId: 'slash' });
    t('CD 2 clears after second skipped turn', f.skillCDs.cleave == null);
    beginPlayerTurn(f);
    t('CD 2 available at start of T+3', !f.skillCDs.cleave);
  }

  {
    const f = ctx({ classId: 'mage', skills: ['firebolt', 'meteor'], charge: 6, mp: 80 });
    // CD 3: use T1, blocked T2 T3 T4, available T5
    beginPlayerTurn(f);
    await applyAction(f, { type: 'useSkill', skillId: 'meteor' });
    t('CD 3 remaining after use is 3', f.skillCDs.meteor === 3);
    for (let i = 0; i < 3; i++) {
      beginPlayerTurn(f);
      t(`CD 3 blocked on wait turn ${i + 1}`, (f.skillCDs.meteor || 0) === 3 - i);
      await applyAction(f, { type: 'useSkill', skillId: 'firebolt' });
    }
    t('CD 3 clears after three completed turns', f.skillCDs.meteor == null);
    beginPlayerTurn(f);
    t('CD 3 available at start of T+4', !f.skillCDs.meteor);
  }

  {
    const f = ctx({ charge: 3, skills: ['slash', 'shield_bash'] });
    beginPlayerTurn(f);
    await applyAction(f, { type: 'useSkill', skillId: 'slash' });
    t('free Slash never writes a cooldown', !f.skillCDs?.slash);
    beginPlayerTurn(f);
    await applyAction(f, { type: 'useSkill', skillId: 'guard' });
    t('Guard never writes a cooldown', !f.skillCDs?.guard);
  }

  {
    const f = ctx({ charge: 0, mp: 4, skills: ['slash', 'shield_bash'] });
    beginPlayerTurn(f); // +1 charge
    const lowMp = skillEligibility(SKILLS.shield_bash, {
      mp: 4, charge: f.charge, cds: f.skillCDs, hasTarget: true,
    });
    t('insufficient class resource is distinct', lowMp.reasons.includes('resource') && !lowMp.ok);
    const lowCh = skillEligibility(SKILLS.cleave, {
      mp: 80, charge: 1, cds: {}, hasTarget: true,
    });
    t('insufficient Battle Charge is distinct', lowCh.reasons.includes('charge') && !lowCh.reasons.includes('resource'));
    f.skillCDs = { shield_bash: 1 };
    f.charge = 6;
    f.run.mp = 80;
    const onCd = skillEligibility(SKILLS.shield_bash, {
      mp: 80, charge: 6, cds: f.skillCDs, hasTarget: true,
    });
    t('cooldown remaining is distinct', onCd.reasons[0] === 'cooldown' && onCd.remaining === 1);
    const noTgt = skillEligibility(SKILLS.slash, {
      mp: 80, charge: 6, cds: {}, hasTarget: false,
    });
    t('invalid target is distinct', noTgt.reasons.includes('target'));
  }

  {
    const f = ctx({ charge: 2, skills: ['slash', 'shield_bash'] });
    beginPlayerTurn(f);
    await applyAction(f, { type: 'useSkill', skillId: 'shield_bash' });
    f.player.statuses.stunned = 1;
    const skipped = beginPlayerTurn(f);
    t('stun skips the action', skipped.skipped === true);
    t('stunned turn still grants start-of-turn charge', f.charge >= 1);
    t('stunned turn still ticks cooldowns', f.skillCDs.shield_bash == null);
  }

  {
    const f = ctx({ charge: 2, skills: ['slash', 'shield_bash'] });
    beginPlayerTurn(f);
    await applyAction(f, { type: 'useSkill', skillId: 'shield_bash' });
    // Extra turn: another begin+act, like Echoing Stone
    const echo = beginPlayerTurn(f);
    t('extra turn grants another start charge', echo.skipped === false);
    t('CD 1 still blocked on the extra turn', f.skillCDs.shield_bash === 1);
    await applyAction(f, { type: 'useSkill', skillId: 'slash' });
    t('extra turn counts as a completed turn for CD 1', f.skillCDs.shield_bash == null);
  }

  {
    const a = ctx({ charge: 3, skills: ['slash', 'shield_bash'] });
    beginPlayerTurn(a);
    await applyAction(a, { type: 'useSkill', skillId: 'shield_bash' });
    const snap = snapshotCombat(a);
    t('snapshot stores CDs by skill id', snap.skillCDs.shield_bash === 1);
    t('snapshot stores turnPrepared after complete as false', snap.turnPrepared === false);
    const b = ctx({ charge: 0, skills: ['slash', 'shield_bash'] });
    applyCombatSnapshot(b, snap);
    t('restore copies cooldown state', b.skillCDs.shield_bash === 1);
    const before = b.charge;
    beginPlayerTurn(b);
    t('restored mid-prep does not double-grant if turnPrepared', snap.turnPrepared || b.charge === before + CONFIG.charge.gainPerTurn);
  }

  {
    const f = ctx({ charge: 2, skills: ['slash', 'shield_bash'] });
    f._turnPrepared = true;
    const before = f.charge;
    beginPlayerTurn(f);
    t('prepared flag blocks a second start-turn grant', f.charge === before);
  }

  {
    const a = ctx({ charge: 4, skills: ['slash', 'shield_bash'] });
    beginPlayerTurn(a);
    await applyAction(a, { type: 'useSkill', skillId: 'shield_bash' });
    const snap = snapshotCombat(a);
    const b = ctx({ charge: 0 });
    applyCombatSnapshot(b, snap);
    beginPlayerTurn(b);
    await applyAction(b, { type: 'useSkill', skillId: 'slash' });
    t('restored CD does not tick twice vs a live twin', b.skillCDs.shield_bash == null);
  }

  {
    const f = ctx({ charge: 3, skills: ['slash', 'shield_bash'] });
    beginPlayerTurn(f);
    await applyAction(f, { type: 'useSkill', skillId: 'shield_bash' });
    t('CDs live on the fight, not the run', f.run.skillCDs == null);
    finishHeadlessSolo(f, 'win');
    t('combat end clears player CDs', !f.skillCDs.shield_bash);
    const g = ctx({ charge: 0, skills: ['slash', 'shield_bash'] });
    t('a new fight starts with empty CDs', Object.keys(g.skillCDs).length === 0);
  }

  {
    const f = ctx({ charge: 6, skills: ['slash', 'shield_bash', 'cleave'] });
    beginPlayerTurn(f);
    const act = chooseAutoPlayAction(f);
    t('autoplay may pick a charged skill when eligible', act.skillId === 'cleave' || act.skillId === 'shield_bash' || act.skillId === 'slash');
    await applyAction(f, act);
    beginPlayerTurn(f);
    const act2 = chooseAutoPlayAction(f);
    if (act.skillId !== 'slash' && act.skillId !== 'guard') {
      t('autoplay does not repeat a cooling charged skill', act2.skillId !== act.skillId);
    } else {
      t('autoplay still returns an action after a free skill', !!act2.skillId);
    }
  }

  {
    const run = fixtureRun({ classId: 'warrior', skills: ['slash'] });
    run.pending = { kind: 'combat', skillCDs: { shield_bash: 2 }, enemies: [{ id: 'wolf' }] };
    const ser = serializeClimber(run);
    t('MP checkpoint rejects mid-combat (CDs do not leak onto climber)', ser.ok === false && ser.why === 'combat-pending');
  }

  {
    const run = fixtureRun({ classId: 'warrior', skills: ['slash'] });
    const ser = serializeClimber(run);
    t('shop/event climber snapshot has no skillCDs field', ser.ok && ser.climber.skillCDs == null);
  }

  {
    const f = ctx({ charge: 0 });
    const enemy = f.enemies[0];
    enemy.charge = 0;
    enemy.chargeGain = 1;
    enemy._chargeFrac = 0;
    resolveEnemyTurn(f, enemy);
    t('enemy charge still ticks on the enemy turn, not the player start', enemy.charge === 1);
    beginPlayerTurn(f);
    t('player start-turn charge does not tick the enemy bar again', enemy.charge === 1);
  }

  {
    const f = ctx({ charge: 2, skills: ['slash', 'shield_bash'] });
    const seed = 99;
    const runA = fixtureRun({ classId: 'warrior', skills: ['slash', 'shield_bash'], hp: 80, maxHp: 80, mp: 80, maxMp: 80 });
    const runB = fixtureRun({ classId: 'warrior', skills: ['slash', 'shield_bash'], hp: 80, maxHp: 80, mp: 80, maxMp: 80 });
    const a = createCombatContext(runA, makeRng(seed), [trash({ hp: 200 })], null);
    const b = createCombatContext(runB, makeRng(seed), [trash({ hp: 200 })], null);
    const policy = async (fight) => chooseAutoPlayAction(fight);
    const snapA = await stepSolo(a, policy);
    const snapB = await stepSolo(b, policy);
    t('deterministic replay: two seeded fights match', JSON.stringify(snapA) === JSON.stringify(snapB));
  }

  {
    const f = ctx({ charge: 0, skills: ['slash', 'shield_bash'] });
    f.player.statuses.frozen = 1;
    const skipped = beginPlayerTurn(f);
    t('skipped-turn charge arrives at start, not an extra end grant', skipped.skipped && f.charge === CONFIG.charge.gainPerTurn);
  }
}

const standalone = process.argv[1] && /test_player_charge_cd\.js/.test(process.argv[1].replace(/\\/g, '/'));
if (standalone) {
  let pass = 0, fail = 0;
  function t(name, cond) {
    if (cond) pass++;
    else { fail++; console.error('  ✗ FAIL:', name); }
  }
  await runPlayerChargeCdTests(t);
  console.log(`player charge cd: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
