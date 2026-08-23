// Shared combat characterization fixtures.
// Goldens in tools/fixtures/combat_parity/ were captured from the LIVE Fight
// methods before extraction. Do not regenerate them to match a new core.

import { SKILLS } from '../js/data/skills.js';
import { CONSUMABLES } from '../js/data/items.js';
import { findEnemySpec } from '../js/data/enemies.js';
import { newRun } from '../js/state.js';
import { makeRng } from '../js/rng.js';
import { CONFIG } from '../js/data/config.js';

export const META = { upgrades: {}, achievements: [] };

const GEN = {
  stats: { hp: 80, mp: 40, str: 14, dex: 10, int: 12, wis: 8, lk: 6 },
  growthRank: 'C',
  percentile: 50,
};

export function fixtureRun({
  classId = 'warrior',
  skills,
  floor = 5,
  level = 6,
  hp, maxHp = 80, mp, maxMp = 40,
  stats,
  relics = [],
  consumables = ['potion_s'],
  equipment,
  usedRevive = false,
} = {}) {
  const gen = {
    ...GEN,
    stats: { ...GEN.stats, hp: maxHp, mp: maxMp, ...(stats || {}) },
  };
  const run = newRun(META, {
    classId, raceId: 'human', name: 'Fixture', seed: 1, gen, kitSeed: 1,
  });
  run.floor = floor;
  run.level = level;
  run.biomeId = 'forest';
  if (skills) run.skills = [...skills];
  run.relics = [...relics];
  run.consumables = [...consumables];
  if (equipment) Object.assign(run.equipment, equipment);
  run.maxHp = maxHp;
  run.hp = hp != null ? hp : maxHp;
  run.maxMp = maxMp;
  run.mp = mp != null ? mp : maxMp;
  run.usedRevive = usedRevive;
  return run;
}

export function fixtureEnemy(idOrSpec, {
  floor = 5, uid = 'e1', biomeStart = 1, boss, hp, statuses, charge, turnCount, ...over
} = {}, buildEnemy) {
  let spec;
  if (typeof idOrSpec === 'string') {
    spec = findEnemySpec(idOrSpec);
    if (!spec) spec = { id: idOrSpec, name: idOrSpec, hp: 30, atk: 8, def: 1, spd: 5, gold: [0, 0], xp: 1 };
    spec = { ...spec };
  } else {
    spec = { ...idOrSpec };
  }
  if (!spec.id) throw new Error(`unknown enemy ${JSON.stringify(idOrSpec)}`);
  spec.uid = uid || spec.uid || 'e1';
  const e = buildEnemy(spec, floor, biomeStart, { boss: boss ?? !!spec.boss });
  if (hp != null) e.hp = hp;
  if (charge != null) e.charge = charge;
  if (turnCount != null) e.turnCount = turnCount;
  if (statuses) e.statuses = { ...statuses };
  Object.assign(e, over);
  return e;
}

function applyInit(fight, init = {}) {
  if (init.charge != null) fight.charge = init.charge;
  if (init.corpses != null) fight.corpses = init.corpses;
  if (init.round != null) fight.round = init.round;
  if (init.playerStatuses) fight.player.statuses = { ...init.playerStatuses };
  if (init.playerBuffs) fight.player.buffs = init.playerBuffs.map(b => ({ ...b }));
  if (init.guarding != null) fight.player.guarding = init.guarding;
  if (init.ironStance) fight.player.ironStance = { ...init.ironStance };
  if (init.scriptedEdge != null) fight.player.scriptedEdge = init.scriptedEdge;
  if (init.combatTaunt != null) fight.run.combatTaunt = init.combatTaunt;
  if (init.usedDeathward != null) fight.usedDeathward = init.usedDeathward;
}

export async function applyStep(fight, step) {
  const e = () => fight.enemies[step.enemy ?? 0];
  const sk = () => {
    const s = SKILLS[step.skillId];
    if (!s) throw new Error(`unknown skill ${step.skillId}`);
    return s;
  };
  switch (step.op) {
    case 'hitEnemy':
      fight.target = step.enemy ?? 0;
      fight.hitEnemy(e(), sk(), fight.d());
      return;
    case 'useSkill': {
      fight.target = step.enemy ?? 0;
      const skill = sk();
      const cost = Math.round((skill.cost || 0) * (fight.mod.costMult || 1));
      await fight.useSkill(skill, cost);
      return;
    }
    case 'useConsumable': {
      const c = CONSUMABLES.find(x => x.id === step.itemId);
      fight.useConsumable(c);
      return;
    }
    case 'applySelfSkill':
      fight.applySelfSkill(sk(), fight.d());
      return;
    case 'enemyTurn':
      await fight.enemyTurn(e());
      return;
    case 'upkeep':
      await fight.upkeep();
      return;
    case 'tickEnemyStatuses':
      await fight.tickEnemyStatuses();
      return;
    case 'deathSaves':
      fight.deathSaves();
      return;
    case 'classResourceTick':
      fight.classResourceTick();
      return;
    case 'gainFury':
      fight.gainFury(step.amount);
      return;
    case 'gainCorpse':
      fight.gainCorpse();
      return;
    case 'cleanseBoss':
      fight.cleanseBoss(e());
      return;
    case 'resolveBossAntiCC':
      fight.resolveBossAntiCC(e());
      return;
    case 'bossPhaseChecksSolo':
      fight.bossPhaseChecksSolo(e());
      return;
    case 'maybeTransform':
      fight.maybeTransform();
      return;
    case 'applyEnrage':
      fight.applyEnrage();
      return;
    case 'rollRoundInitiative':
      await fight.rollRoundInitiative();
      return;
    case 'advanceRound':
      fight.round++;
      fight.applyEnrage();
      await fight.rollRoundInitiative();
      return;
    case 'beginPlayerTurn':
      fight.player.guarding = false;
      {
        const st = fight.player.statuses;
        if (st.frozen || st.stunned || st.lazy) {
          delete st.frozen; delete st.stunned; delete st.lazy;
          fight.gainCharge(CONFIG.charge.gainPerTurn);
          fight.classResourceTick();
        }
      }
      return;
    case 'endPlayerAction':
      fight.endPlayerAction();
      return;
    case 'checkEndSolo':
      fight.checkEndSolo();
      return;
    default:
      throw new Error(`unknown step ${step.op}`);
  }
}

export async function runScenario(scenario, { createFight, buildEnemy, snapshot }) {
  const run = fixtureRun(scenario.run);
  const enemies = (scenario.enemies || []).map(spec => fixtureEnemy(
    (spec.specials && !findEnemySpec(spec.id)) ? spec : (spec.id || spec),
    spec,
    buildEnemy,
  ));
  const rng = makeRng(scenario.seed);
  const fight = createFight(run, rng, enemies, scenario.mod || null);
  applyInit(fight, scenario.init);
  for (const step of scenario.steps) await applyStep(fight, step);
  return snapshot(fight);
}

const trash = (over = {}) => ({ id: 'wolf', uid: 'e1', floor: 5, ...over });

/** Characterization catalog. Each names the Fight method it was captured from. */
export const SCENARIOS = [
  {
    id: 's0_build_skillstat',
    stage: 0,
    method: 'buildEnemy+skillStatValue',
    seed: 101,
    run: { classId: 'warrior', skills: ['slash', 'guard'] },
    enemies: [trash()],
    steps: [],
    extras: ['skillStat'],
  },
  {
    id: 's1_helpers_riders',
    stage: 1,
    method: 'collectEnemyRiders+statusOutgoing+applyPlayerFrail',
    seed: 202,
    run: { classId: 'warrior', skills: ['slash'] },
    enemies: [{
      id: 'wolf', uid: 'e1', floor: 5,
      poison: 1, burn: 1,
    }],
    init: { playerStatuses: { hexed: 2, frail: 2, weaken: 2, burn: 2 } },
    steps: [],
    extras: ['helpers'],
  },
  {
    id: 's2_warrior_hits',
    stage: 2,
    method: 'hitEnemy',
    seed: 303,
    run: { classId: 'warrior', skills: ['slash', 'shield_bash', 'guard'], floor: 5, level: 6 },
    enemies: [trash({ hp: 200 })],
    init: { charge: 2 },
    steps: [
      { op: 'hitEnemy', skillId: 'slash' },
      { op: 'hitEnemy', skillId: 'shield_bash' },
    ],
  },
  {
    id: 's2_enemy_hit',
    stage: 2,
    method: 'enemyTurn',
    seed: 304,
    run: { classId: 'warrior', skills: ['slash'], hp: 80, maxHp: 80 },
    enemies: [trash({ charge: 5 })],
    init: { guarding: true },
    steps: [{ op: 'enemyTurn' }],
  },
  {
    id: 's2_frail_execute',
    stage: 2,
    method: 'hitEnemy',
    seed: 305,
    run: { classId: 'priest', skills: ['judgement'], stats: { str: 8, dex: 8, int: 8, wis: 16, lk: 6 } },
    enemies: [trash({ hp: 12 })],
    init: {},
    steps: [
      { op: 'hitEnemy', skillId: 'judgement' },
    ],
    // judgement consumes frail if present — seed frail first via init on enemy
    enemiesInit: true,
  },
  {
    id: 's2_frail_detonate',
    stage: 2,
    method: 'hitEnemy',
    seed: 306,
    run: { classId: 'priest', skills: ['judgement'], stats: { wis: 16 } },
    enemies: [trash({ hp: 80, statuses: { frail: 3 } })],
    steps: [{ op: 'hitEnemy', skillId: 'judgement' }],
  },
  {
    id: 's2_mark_oneshot',
    stage: 2,
    method: 'hitEnemy',
    seed: 307,
    run: {
      classId: 'archer',
      skills: ['hunters_mark', 'one_shot'],
      stats: { str: 8, dex: 18, int: 8, wis: 8, lk: 8 },
    },
    enemies: [trash({ hp: 90, statuses: { marked: 3 } })],
    init: { charge: 6 },
    steps: [{ op: 'hitEnemy', skillId: 'one_shot' }],
  },
  {
    id: 's2_burn_consume',
    stage: 2,
    method: 'hitEnemy',
    seed: 308,
    run: { classId: 'mage', skills: ['soul_siphon'], stats: { int: 16 } },
    enemies: [trash({ hp: 80, statuses: { burn: 2 } })],
    init: { charge: 3 },
    steps: [{ op: 'hitEnemy', skillId: 'soul_siphon' }],
  },
  {
    id: 's3_viking_fury',
    stage: 3,
    method: 'notePlayerHpLoss+gainFury+blood_howl',
    seed: 401,
    run: { classId: 'viking', skills: ['axe_chop', 'blood_howl'], hp: 60, maxHp: 80, mp: 8, maxMp: 40 },
    enemies: [trash({ charge: 0 })],
    init: { charge: 2 },
    steps: [
      { op: 'enemyTurn' },
      { op: 'useSkill', skillId: 'blood_howl' },
    ],
  },
  {
    id: 's3_warlock_pact_hex',
    stage: 3,
    method: 'useSkill+hitEnemy hex refund',
    seed: 402,
    run: { classId: 'warlock', skills: ['dark_pact', 'hex_mark', 'eldritch_bolt'], hp: 80, mp: 10, maxMp: 40 },
    enemies: [trash({ hp: 80 })],
    init: { charge: 2 },
    steps: [
      { op: 'useSkill', skillId: 'dark_pact' },
      { op: 'useSkill', skillId: 'hex_mark' },
      { op: 'useSkill', skillId: 'eldritch_bolt' },
    ],
  },
  {
    id: 's3_ranger_focus',
    stage: 3,
    method: 'useSkill ranger crit/regen',
    seed: 403,
    run: {
      classId: 'archer',
      skills: ['hunters_mark', 'basic_attack'],
      stats: { dex: 16 },
    },
    enemies: [trash({ hp: 80 })],
    init: { charge: 3 },
    steps: [
      { op: 'useSkill', skillId: 'hunters_mark' },
      { op: 'useSkill', skillId: 'basic_attack' },
    ],
  },
  {
    id: 's3_necro_corpse',
    stage: 3,
    method: 'gainCorpse+corpseSpend',
    seed: 404,
    run: { classId: 'necromancer', skills: ['soul_bolt', 'bone_spike'], stats: { int: 16 } },
    enemies: [trash({ hp: 4 }), { id: 'wolf', uid: 'e2', floor: 5, hp: 80 }],
    init: { charge: 2 },
    steps: [
      { op: 'useSkill', skillId: 'soul_bolt', enemy: 0 },
      { op: 'useSkill', skillId: 'bone_spike', enemy: 1 },
    ],
  },
  {
    id: 's3_monk_stance',
    stage: 3,
    method: 'applySelfSkill+useSkill Guard refuse',
    seed: 405,
    run: { classId: 'monk', skills: ['iron_stance', 'palm_strike', 'guard'] },
    enemies: [trash({ hp: 80 })],
    init: { charge: 1 },
    steps: [
      { op: 'useSkill', skillId: 'iron_stance' },
      { op: 'useSkill', skillId: 'guard' },
      { op: 'useSkill', skillId: 'palm_strike' },
    ],
  },
  {
    id: 's3_upkeep_dots',
    stage: 3,
    method: 'upkeep+tickEnemyStatuses',
    seed: 406,
    run: { classId: 'warrior', skills: ['slash'], hp: 80 },
    enemies: [trash({ hp: 80, statuses: { poison: 3, burn: 2, frail: 2, hexed: 2 } })],
    init: { playerStatuses: { poison: 2, burn: 2, tormented: 2 } },
    steps: [{ op: 'upkeep' }],
  },
  {
    id: 's3_torment_cleanse',
    stage: 3,
    method: 'resolveBossAntiCC+cleanseBoss',
    seed: 407,
    run: { classId: 'warlock', skills: ['eldritch_bolt'] },
    enemies: [{
      id: 'orc', uid: 'boss1', floor: 20, boss: true,
      statuses: { poison: 3, burn: 2, tormented: 2, frail: 2 },
      turnCount: 3, charge: 0,
    }],
    steps: [{ op: 'resolveBossAntiCC' }],
  },
  {
    id: 's3_deathward',
    stage: 3,
    method: 'deathSaves',
    seed: 408,
    run: {
      classId: 'warrior', skills: ['slash'], hp: 0, maxHp: 80,
      relics: ['hourglass'],
    },
    enemies: [trash()],
    steps: [{ op: 'deathSaves' }],
  },
  {
    id: 's3_phoenix',
    stage: 3,
    method: 'deathSaves',
    seed: 409,
    run: {
      classId: 'warrior', skills: ['slash'], hp: 0, maxHp: 80,
      equipment: { accessory1: 'phoenix_feather' },
    },
    enemies: [trash()],
    steps: [{ op: 'deathSaves' }],
  },
  {
    id: 's4_burn_payoff',
    stage: 4,
    method: 'enemyTurn payoff',
    seed: 501,
    run: { classId: 'mage', skills: ['scorch'], hp: 80 },
    enemies: [{
      id: 'cinder_test',
      name: 'Cinder Test',
      glyph: '🔥',
      hp: 50, atk: 12, def: 2, spd: 6, gold: [0, 0], xp: 1,
      uid: 'e1', floor: 5,
      specials: [{ at: 0, name: 'Pyre Surge', mult: 1.5, burnSure: true, vsStatus: 'burn', vsStatusMult: 1.2, desc: 'cashes the heat' }],
    }],
    init: { playerStatuses: { burn: 2 } },
    steps: [{ op: 'enemyTurn' }],
  },
  {
    id: 's4_freeze_skip',
    stage: 4,
    method: 'enemyTurn skip CC',
    seed: 502,
    run: { classId: 'warrior', skills: ['slash'] },
    enemies: [trash({ statuses: { frozen: 1 } })],
    steps: [{ op: 'enemyTurn' }],
  },
  {
    id: 's4_hydra_heads',
    stage: 4,
    method: 'bossPhaseChecksSolo',
    seed: 503,
    run: { classId: 'warrior', skills: ['slash'], floor: 40 },
    enemies: [{ id: 'hydra', uid: 'hydra1', floor: 40, boss: true, hp: 1 }],
    steps: [{ op: 'bossPhaseChecksSolo' }],
  },
  {
    id: 's4_two_phase',
    stage: 4,
    method: 'maybeTransform',
    seed: 504,
    run: { classId: 'warrior', skills: ['slash'], floor: 51 },
    enemies: [{ id: 'medieval_king', uid: 'king1', floor: 51, boss: true, hp: 0 }],
    steps: [{ op: 'maybeTransform' }],
  },
  {
    id: 's4_consumable_bomb_salts',
    stage: 4,
    method: 'useConsumable',
    seed: 505,
    run: {
      classId: 'warrior', skills: ['slash'],
      consumables: ['bomb', 'smelling_salts'],
    },
    enemies: [trash({ hp: 80 }), { id: 'wolf', uid: 'e2', floor: 5, hp: 80 }],
    init: { playerStatuses: { poison: 3, burn: 2, confused: 2 } },
    steps: [
      { op: 'useConsumable', itemId: 'bomb' },
      { op: 'useConsumable', itemId: 'smelling_salts' },
    ],
  },
  {
    id: 's5_initiative_paralyze',
    stage: 5,
    method: 'rollRoundInitiative+beginPlayerTurn',
    seed: 601,
    run: { classId: 'warrior', skills: ['slash', 'guard'], floor: 2 },
    enemies: [trash({ statuses: { paralyzed: 2 } })],
    init: { playerStatuses: { paralyzed: 2, frozen: 1 }, guarding: true, charge: 1 },
    steps: [
      { op: 'advanceRound' },
      { op: 'beginPlayerTurn' },
    ],
  },
  {
    id: 's5_warrior_sequence',
    stage: 5,
    method: 'useSkill+enemyTurn+upkeep',
    seed: 602,
    run: { classId: 'warrior', skills: ['slash', 'guard', 'shield_bash'] },
    enemies: [trash({ hp: 60 })],
    init: { charge: 2 },
    steps: [
      { op: 'advanceRound' },
      { op: 'useSkill', skillId: 'slash' },
      { op: 'enemyTurn' },
      { op: 'useSkill', skillId: 'guard' },
      { op: 'upkeep' },
    ],
  },
];
