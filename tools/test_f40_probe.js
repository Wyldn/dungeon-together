// F40 competence probe — fast tests. Does not retune combat or bosses.
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chooseAutoPlayAction } from '../js/combat_policy.js';
import { chooseBossAwareAction } from './policies/boss_aware.js';
import {
  captureF40Arrival, replayArrival, parseCombatLogs, runF40Probe, BOSS_IDS,
} from './run_f40_probe.js';
import { makeV2Run, simulateClimbV2 } from './run_climb_v2.js';
import { baselinePolicy } from './policies/baseline.js';
import { TDC, enemyScale, soloBossChargeForScale, soloBossSpecialDmgMult, f30SoloGateMults, f40SoloGateMults, F40_SOLO_GATE_IDS } from '../js/data/tdc.js';
import { BOSSES, ALT_BOSSES, ENEMIES, NPC_ENEMIES, mimicSpec } from '../js/data/enemies.js';
import { buildEnemy } from '../js/combat_core.js';

const here = dirname(fileURLToPath(import.meta.url));

function fakeFight({
  classId = 'warrior',
  hp = 60,
  maxHp = 130,
  mp = 28,
  skills = ['slash', 'shield_bash', 'taunt'],
  consumables = ['potion_s'],
  charge = 2,
  enemies = null,
} = {}) {
  const hydra = {
    id: 'hydra',
    name: 'The Grieving Hydra',
    hp: 800,
    maxHp: 800,
    atk: 48,
    def: 12,
    spd: 4,
    boss: true,
    charge: 6,
    regen: 0.02,
    heads: true,
    specials: [
      { at: 3, name: 'Threefold Snap', mult: 1.55, poisonSure: true },
      { at: 6, name: 'SORROW UNENDING', mult: 3.05, aoe: true, tormentedSure: true, frail: 0.5 },
    ],
  };
  return {
    run: {
      classId,
      raceId: 'human',
      floor: 40,
      hp,
      maxHp,
      mp,
      maxMp: 40,
      skills,
      consumables,
      stats: { str: 14, dex: 8, int: 6, wis: 9, lk: 5 },
      equipment: {},
      relics: [],
      weaponBonus: 0,
      level: 14,
    },
    charge,
    mod: {},
    enemies: enemies || [hydra],
    player: { statuses: {}, buffs: [], partyBuffs: [] },
    aliveEnemies() { return this.enemies.filter(e => e.hp > 0); },
  };
}

function bograthFight(extra = {}) {
  return fakeFight({
    ...extra,
    enemies: [{
      id: 'tr_live_ogre',
      name: 'Bograth, the Twin-Headed Ogre',
      hp: 800,
      maxHp: 800,
      atk: 48,
      def: 12,
      spd: 4,
      boss: true,
      charge: extra.enemyCharge ?? 6,
      regen: 0.02,
      heads: true,
      specials: [
        { at: 3, name: 'Twin Bite', mult: 1.55, poisonSure: true },
        { at: 6, name: 'TWO SORROWS', mult: 3.0, aoe: true, tormentedSure: true, frail: 0.4 },
      ],
    }],
  });
}

export async function runF40ProbeTests(t) {
  console.log('— F40 combat competence probe —');

  {
    const src = readFileSync(join(here, 'policies', 'boss_aware.js'), 'utf8');
    t('boss-aware policy does not read fight RNG', !/f\.rng|runRng|Math\.random/.test(src));
    const live = readFileSync(join(here, '..', 'js', 'combat_policy.js'), 'utf8');
    t('boss-aware is not wired into live autoplay', !/boss_aware|chooseBossAwareAction/.test(live));
    const tdc = readFileSync(join(here, '..', 'js', 'data', 'tdc.js'), 'utf8');
    const enemies = readFileSync(join(here, '..', 'js', 'data', 'enemies.js'), 'utf8');
    t('F40 solo HP knob exists and stays F40-prefixed', /f40SoloHpMult/.test(tdc));
    t('F40 solo HP is duration-only 0.65', TDC.enemy.f40SoloHpMult === 0.65);
    t('F40 does not add a shared ATK knob in this pass', !/f40SoloAtkMult/.test(tdc) && !/f40SoloRegenMult/.test(tdc) && !/f40SoloHeadHealMult/.test(tdc));
    t('F30 solo HP knob is unchanged', TDC.enemy.f30SoloHpMult === 0.65 && TDC.enemy.f30SoloAtkMult === 1);
    t('F40 gate IDs are Hydra and Bograth only',
      F40_SOLO_GATE_IDS.length === 2
      && F40_SOLO_GATE_IDS.includes('hydra')
      && F40_SOLO_GATE_IDS.includes('tr_live_ogre'));
    t('Hydra authored HP is unchanged', BOSSES[40].hp === 550 && BOSSES[40].atk === 38 && BOSSES[40].regen === 0.02 && BOSSES[40].heads);
    t('Bograth authored HP is unchanged', ALT_BOSSES[40].hp === 550 && ALT_BOSSES[40].atk === 38);
    t('enemies.js still authors Hydra at 550', /id: 'hydra'[\s\S]*?hp: 550/.test(enemies));
  }

  {
    const f = fakeFight({ hp: 55, skills: ['slash', 'shield_bash', 'taunt'] });
    f.enemies[0].charge = 6;
    const auto = chooseAutoPlayAction(f);
    const aware = chooseBossAwareAction(f);
    t('autoplay does not taunt a ready Sorrow Unending from 50+ HP', auto.skillId !== 'taunt');
    t('boss-aware defends a ready Sorrow Unending', aware.skillId === 'taunt' || aware.skillId === 'guard');
  }

  {
    const f = bograthFight({ hp: 55, enemyCharge: 6, skills: ['slash', 'shield_bash', 'taunt'] });
    const aware = chooseBossAwareAction(f);
    t('boss-aware defends Bograth TWO SORROWS', aware.skillId === 'taunt' || aware.skillId === 'guard');
  }

  {
    const parsed = parseCombatLogs([
      { msg: 'The Grieving Hydra (SORROW UNENDING) hits you for 91.' },
    ], { bossName: 'The Grieving Hydra' });
    t('parses Sorrow Unending killing blow', parsed.lastHit?.name === 'SORROW UNENDING');
    t('attributes Sorrow Unending damage', parsed.dmg.special['SORROW UNENDING'] === 91);

    const bog = parseCombatLogs([
      { msg: 'Bograth, the Twin-Headed Ogre (TWO SORROWS) hits you for 88.' },
    ], { bossName: 'Bograth, the Twin-Headed Ogre' });
    t('parses Bograth finisher', bog.lastHit?.name === 'TWO SORROWS');

    const mech = parseCombatLogs([
      { msg: 'A severed head regrows — angrier. The Hydra swells with grief.' },
      { msg: 'The Grieving Hydra regenerates 16.' },
      { msg: 'The Grieving Hydra regenerates 16.' },
      { msg: 'Poison courses through you for 10.' },
      { msg: 'The Grieving Hydra enrages!' },
    ], { bossName: 'The Grieving Hydra' });
    t('parses head regrow, regen, poison, enrage',
      mech.headRegrows === 1 && mech.regenHealed === 32 && mech.regenTicks === 2
      && mech.dmg.poison === 10 && mech.enrages === 1);
  }

  {
    t('both F40 bosses are named for the matrix', BOSS_IDS.hydra && BOSS_IDS.tr_live_ogre);
    t('Hydra SORROW UNENDING identity is preserved',
      BOSSES[40].specials.some(s => s.name === 'SORROW UNENDING' && s.mult === 3.05 && s.tormentedSure && s.aoe));
    t('Hydra Threefold Snap poisons',
      BOSSES[40].specials.some(s => s.name === 'Threefold Snap' && s.poisonSure && s.mult === 1.55));
    t('Bograth TWO SORROWS identity is preserved',
      ALT_BOSSES[40].specials.some(s => s.name === 'TWO SORROWS' && s.mult === 3.0 && s.tormentedSure));
    t('Bograth also has heads and regen', ALT_BOSSES[40].heads && ALT_BOSSES[40].regen === 0.02);
    t('F40 charge is not F20-capped',
      soloBossChargeForScale(40, 6) === 6
      && soloBossChargeForScale(20, 6) === 2);
    t('F40 finishers are not F20-padded',
      soloBossSpecialDmgMult(40, { mult: 3.05 }) === 1
      && soloBossSpecialDmgMult(20, { mult: 2.6 }) < 1);
    t('F30 gate does not apply to Hydra', f30SoloGateMults(40, 1, 'hydra').hp === 1);
    {
      const hSolo = buildEnemy(BOSSES[40], 40, 31, { boss: true, partySize: 1 });
      const hSolo2 = buildEnemy(BOSSES[40], 40, 31, { boss: true, partySize: 1 });
      const hCoop = buildEnemy(BOSSES[40], 40, 31, { boss: true, partySize: 2 });
      const bSolo = buildEnemy(ALT_BOSSES[40], 40, 31, { boss: true, partySize: 1 });
      const bCoop = buildEnemy(ALT_BOSSES[40], 40, 31, { boss: true, partySize: 2 });
      const vSolo = buildEnemy(BOSSES[30], 30, 21, { boss: true, partySize: 1 });
      const hrothSolo = buildEnemy(ALT_BOSSES[30], 30, 21, { boss: true, partySize: 1 });
      const dukeSolo = buildEnemy(BOSSES[50], 50, 41, { boss: true, partySize: 1 });
      const scBoss = enemyScale(40, 31, 'swamp', { boss: true, partySize: 1 });
      const scBossCoop = enemyScale(40, 31, 'swamp', { boss: true, partySize: 2 });
      const scF50 = enemyScale(50, 41, 'hell', { boss: true, partySize: 1 });
      const scF30 = enemyScale(30, 21, 'frost', { boss: true, partySize: 1 });
      const hag = ENEMIES.swamp.find(e => e.id === 'hag');
      const troll = ENEMIES.swamp.find(e => e.id === 'troll');
      const scTrash = enemyScale(40, 31, 'swamp', { boss: false, partySize: 1 });
      const trashSolo = buildEnemy(hag, 40, 31, { partySize: 1 });
      const trashCoop = buildEnemy(hag, 40, 31, { partySize: 2 });
      const eliteSolo = buildEnemy(troll, 40, 31, { partySize: 1 });
      const eliteCoop = buildEnemy(troll, 40, 31, { partySize: 2 });
      const gateH = f40SoloGateMults(40, 1, 'hydra');
      const gateB = f40SoloGateMults(40, 1, 'tr_live_ogre');
      const gateTrash = f40SoloGateMults(40, 1, 'hag');
      const gateElite = f40SoloGateMults(40, 1, 'troll');
      const gateCoop = f40SoloGateMults(40, 2, 'hydra');
      const gateF30 = f40SoloGateMults(30, 1, 'hydra');
      const gateF50 = f40SoloGateMults(50, 1, 'hydra');
      t('solo Hydra receives f40SoloHpMult',
        hSolo.maxHp === Math.round(BOSSES[40].hp * scBoss.hp * TDC.enemy.f40SoloHpMult)
        && gateH.hp === TDC.enemy.f40SoloHpMult);
      t('solo Bograth receives f40SoloHpMult',
        bSolo.maxHp === Math.round(ALT_BOSSES[40].hp * scBoss.hp * TDC.enemy.f40SoloHpMult)
        && gateB.hp === TDC.enemy.f40SoloHpMult);
      t('coop Hydra is not F40-gate-trimmed',
        gateCoop.hp === 1 && hCoop.maxHp === Math.round(BOSSES[40].hp * scBossCoop.hp));
      t('coop Bograth is not F40-gate-trimmed',
        f40SoloGateMults(40, 2, 'tr_live_ogre').hp === 1
        && bCoop.maxHp === Math.round(ALT_BOSSES[40].hp * scBossCoop.hp));
      t('solo Hydra ATK is uncut vs coop', hSolo.atk === hCoop.atk);
      t('solo Hydra build is deterministic',
        hSolo.maxHp === hSolo2.maxHp && hSolo.atk === hSolo2.atk);
      t('F30 Vessalia trim does not apply at F40', hSolo.maxHp !== vSolo.maxHp);
      t('F30 Vessalia/Hroth are unchanged by F40 gate',
        f40SoloGateMults(30, 1, 'frost_queen').hp === 1
        && f40SoloGateMults(30, 1, 'tr_mon_centaur').hp === 1
        && vSolo.maxHp === Math.round(BOSSES[30].hp * scF30.hp * TDC.enemy.f30SoloHpMult)
        && hrothSolo.maxHp === Math.round(ALT_BOSSES[30].hp * scF30.hp * TDC.enemy.f30SoloHpMult));
      t('F50 Duke is not F40-gate-trimmed',
        f40SoloGateMults(50, 1, 'infernal_duke').hp === 1
        && f40SoloGateMults(50, 1, dukeSolo.id).hp === 1
        && dukeSolo.maxHp === Math.round(BOSSES[50].hp * scF50.hp)
        && gateF50.hp === 1);
      t('F50 Kryos is not F40-gate-trimmed',
        f40SoloGateMults(50, 1, 'kryos_demon_general').hp === 1
        && f40SoloGateMults(50, 1, ALT_BOSSES[50].id).hp === 1
        && buildEnemy(ALT_BOSSES[50], 50, 41, { boss: true, partySize: 1 }).maxHp
          === Math.round(ALT_BOSSES[50].hp * scF50.hp));
      t('F40 enemyScale is not ID-gated or floor-knobbed',
        scBoss.hp === scBossCoop.hp);
      t('ordinary F40 trash is not F40-gate-trimmed',
        gateTrash.hp === 1
        && trashSolo.maxHp === Math.round(hag.hp * scTrash.hp)
        && trashSolo.maxHp === trashCoop.maxHp);
      t('F40 elite is not F40-gate-trimmed',
        gateElite.hp === 1 && eliteSolo.maxHp === eliteCoop.maxHp);
      t('gate helper is id-scoped', gateH.hp === TDC.enemy.f40SoloHpMult && gateTrash.hp === 1
        && gateCoop.hp === 1 && gateF30.hp === 1 && gateF50.hp === 1);
      {
        const fakeGate = {
          id: 'swamp_tyrant', name: 'Swamp Tyrant', hp: 550, atk: 38, def: 12, spd: 4, boss: true,
        };
        const fakeBuilt = buildEnemy(fakeGate, 40, 31, { boss: true, partySize: 1 });
        const fakeCoop = buildEnemy(fakeGate, 40, 31, { boss: true, partySize: 2 });
        t('non-gate F40 boss identity is not trimmed',
          fakeBuilt.maxHp === fakeCoop.maxHp
          && f40SoloGateMults(40, 1, 'swamp_tyrant').hp === 1);
        t('F40 event mimic is not F40-gate-trimmed',
          f40SoloGateMults(40, 1, mimicSpec(40).id).hp === 1
          && f40SoloGateMults(40, 1, 'mimic').atk === 1);
        t('F40 event NPC helper is identity 1', f40SoloGateMults(40, 1, NPC_ENEMIES.blade_hero.id).hp === 1
          && f40SoloGateMults(40, 1, 'blade_hero').atk === 1);
        const escort = buildEnemy(hag, 40, 31, { boss: false, partySize: 1, atkMult: 0.55 });
        t('F40 escort trash is not F40-gate-trimmed',
          escort.maxHp === trashSolo.maxHp
          && f40SoloGateMults(40, 1, hag.id).hp === 1);
      }
    }
  }

  {
    const a = await captureF40Arrival({ seed: 20260823, classId: 'warrior' });
    const b = await captureF40Arrival({ seed: 20260823, classId: 'warrior' });
    t('F40 capture is deterministic for seed+class',
      a.reached === b.reached
      && a.deathFloor === b.deathFloor
      && a.arrival?.rngState === b.arrival?.rngState
      && a.arrival?.hp === b.arrival?.hp
      && a.bossId === b.bossId);
  }

  {
    const run = makeV2Run({ seed: 4242, classId: 'mage' });
    const before = run.rngState;
    chooseBossAwareAction(fakeFight({ classId: 'mage', skills: ['firebolt', 'frost_lance', 'arcane_ward'] }));
    t('policy call does not advance climb rngState', run.rngState === before);
    const climb = await simulateClimbV2(makeV2Run({ seed: 4242, classId: 'mage' }), baselinePolicy(), { stopAfterFloor: 3 });
    t('probe still uses live climb v2', Array.isArray(climb.trace) && climb.trace.length >= 1);
  }

  {
    const tiny = await runF40Probe({ seed: 5, runs: 6 });
    t('tiny F40 probe reports climbs', tiny.meta.climbs === 6 && tiny.meta.arrivals >= 0);
    t('tiny F40 probe is byte-stable',
      JSON.stringify(tiny.byBoss) === JSON.stringify((await runF40Probe({ seed: 5, runs: 6 })).byBoss));
    t('tiny probe keeps four condition cells for both bosses',
      tiny.byBoss.hydra?.autoplay_observed
      && tiny.byBoss.hydra?.bossaware_full
      && tiny.byBoss.tr_live_ogre?.autoplay_observed
      && tiny.byBoss.tr_live_ogre?.bossaware_full);
    t('tiny probe does not invent F40 arrivals', tiny.meta.arrivals === 0
      || (tiny.byBoss.hydra.autoplay_observed.n === tiny.meta.arrivals
        && tiny.byBoss.tr_live_ogre.autoplay_observed.n === tiny.meta.arrivals));
    t('tiny probe extraRuns default is zero', tiny.meta.extraRuns === 0 || tiny.meta.extraRuns == null);
  }

  {
    let cap = null;
    const tries = [
      { seed: 20260823, classId: 'warrior' },
      { seed: 20260823, classId: 'archer' },
      { seed: 77, classId: 'warrior' },
    ];
    for (const job of tries) {
      const c = await captureF40Arrival(job);
      if (c.reached) { cap = c; break; }
    }
    if (!cap) {
      t('no F40 arrival in smoke seeds (allowed)', true);
    } else {
      const a = await replayArrival(cap, { policy: 'autoplay', hp: 'observed' });
      const b = await replayArrival(cap, { policy: 'autoplay', hp: 'observed' });
      t('identical F40 replay is deterministic', a.win === b.win && a.rounds === b.rounds && a.hpLeft === b.hpLeft);
      t('observed replay keeps arrival HP', Math.abs(a.hpEnter - cap.arrival.hp) < 1e-6);
      const full = await replayArrival(cap, { policy: 'autoplay', hp: 'full' });
      t('full-HP replay starts at maxHp', full.hpEnter === cap.arrival.maxHp);
      const hydra = await replayArrival(cap, { policy: 'autoplay', hp: 'full', bossId: 'hydra' });
      const bog = await replayArrival(cap, { policy: 'autoplay', hp: 'full', bossId: 'tr_live_ogre' });
      t('forced Hydra replay still uses hydra', hydra.bossId === 'hydra');
      t('forced Bograth replay still uses tr_live_ogre', bog.bossId === 'tr_live_ogre');
    }
  }
}
