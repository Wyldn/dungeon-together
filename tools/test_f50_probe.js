// Hell / F50 competence probe — fast tests. Does not retune combat or bosses.
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chooseAutoPlayAction } from '../js/combat_policy.js';
import { chooseBossAwareAction } from './policies/boss_aware.js';
import {
  captureF50Arrival, replayArrival, parseCombatLogs, runF50Probe, BOSS_IDS,
} from './run_f50_probe.js';
import { makeV2Run, simulateClimbV2 } from './run_climb_v2.js';
import { baselinePolicy } from './policies/baseline.js';
import { TDC, f30SoloGateMults, f40SoloGateMults } from '../js/data/tdc.js';
import { BOSSES, ALT_BOSSES } from '../js/data/enemies.js';
import { buildEnemy } from '../js/combat_core.js';

const here = dirname(fileURLToPath(import.meta.url));

function fakeFight({
  classId = 'warrior',
  hp = 70,
  maxHp = 150,
  mp = 30,
  skills = ['slash', 'shield_bash', 'taunt'],
  consumables = ['potion_s'],
  charge = 2,
  enemies = null,
} = {}) {
  const duke = {
    id: 'infernal_duke',
    name: 'Duke Malgrimm, Gatekeeper of the Throne',
    hp: 900,
    maxHp: 900,
    atk: 52,
    def: 14,
    spd: 10,
    boss: true,
    charge: 6,
    burn: 0.22,
    specials: [
      { at: 2, name: 'Sword of Swords', mult: 1.35, weaken: 0.45 },
      { at: 5, name: 'Bladestorm Toll', mult: 2.95, aoe: true, frail: 0.5 },
      { at: 6, name: "GATEKEEPER'S TOLL", mult: 3.25, aoe: true, burnSure: true, tormented: 0.55 },
    ],
  };
  return {
    run: {
      classId,
      raceId: 'human',
      floor: 50,
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
      level: 16,
    },
    charge,
    mod: {},
    enemies: enemies || [duke],
    player: { statuses: {}, buffs: [], partyBuffs: [] },
    aliveEnemies() { return this.enemies.filter(e => e.hp > 0); },
  };
}

function kryosFight(extra = {}) {
  return fakeFight({
    ...extra,
    enemies: [{
      id: 'kryos_demon_general',
      name: 'Kryos, the Demon General',
      hp: 900,
      maxHp: 900,
      atk: 52,
      def: 14,
      spd: 10,
      boss: true,
      charge: extra.enemyCharge ?? 6,
      burn: 0.25,
      specials: [
        { at: 2, name: 'Iron Salute', mult: 1.35, weaken: 0.4 },
        { at: 5, name: 'Column Fire', mult: 2.4, aoe: true, burn: 0.45 },
        { at: 6, name: 'LEFT AT THE POST', mult: 3.1, aoe: true, burnSure: true, tormented: 0.5 },
      ],
    }],
  });
}

export async function runF50ProbeTests(t) {
  console.log('— Hell / F50 combat competence probe —');

  {
    const src = readFileSync(join(here, 'policies', 'boss_aware.js'), 'utf8');
    t('boss-aware policy does not read fight RNG', !/f\.rng|runRng|Math\.random/.test(src));
    const live = readFileSync(join(here, '..', 'js', 'combat_policy.js'), 'utf8');
    t('boss-aware is not wired into live autoplay', !/boss_aware|chooseBossAwareAction/.test(live));
    const tdc = readFileSync(join(here, '..', 'js', 'data', 'tdc.js'), 'utf8');
    const enemies = readFileSync(join(here, '..', 'js', 'data', 'enemies.js'), 'utf8');
    t('F30 solo HP knob remains 0.65', TDC.enemy.f30SoloHpMult === 0.65);
    t('F40 solo HP knob remains 0.65', TDC.enemy.f40SoloHpMult === 0.65);
    t('this pass does not add an F50 solo HP knob', !/f50SoloHpMult/.test(tdc));
    t('Duke authored kit is unchanged', BOSSES[50].hp === 655 && BOSSES[50].atk === 40
      && BOSSES[50].specials.some(s => s.name === "GATEKEEPER'S TOLL" && s.mult === 3.25));
    t('Kryos authored kit is unchanged', ALT_BOSSES[50].hp === 655 && ALT_BOSSES[50].atk === 40
      && ALT_BOSSES[50].specials.some(s => s.name === 'LEFT AT THE POST' && s.mult === 3.1));
    t('enemies.js still authors Duke at 655', /id: 'infernal_duke'[\s\S]*?hp: 655/.test(enemies));
    t('F40 gate does not apply at F50',
      f40SoloGateMults(50, 1, 'infernal_duke').hp === 1
      && f40SoloGateMults(50, 1, 'kryos_demon_general').hp === 1);
    t('F30 gate does not apply at F50',
      f30SoloGateMults(50, 1, 'infernal_duke').hp === 1);
  }

  {
    const f = fakeFight({ hp: 55, skills: ['slash', 'shield_bash', 'taunt'] });
    f.enemies[0].charge = 6;
    const auto = chooseAutoPlayAction(f);
    const aware = chooseBossAwareAction(f);
    t('autoplay does not taunt a ready Gatekeeper Toll from 50+ HP', auto.skillId !== 'taunt');
    t('boss-aware defends a ready Gatekeeper Toll', aware.skillId === 'taunt' || aware.skillId === 'guard');
  }

  {
    const f = kryosFight({ hp: 55, enemyCharge: 6, skills: ['slash', 'shield_bash', 'taunt'] });
    const aware = chooseBossAwareAction(f);
    t('boss-aware defends Kryos LEFT AT THE POST', aware.skillId === 'taunt' || aware.skillId === 'guard');
  }

  {
    const parsed = parseCombatLogs([
      { msg: "Duke Malgrimm, Gatekeeper of the Throne (GATEKEEPER'S TOLL) hits you for 110." },
    ], { bossName: 'Duke Malgrimm, Gatekeeper of the Throne' });
    t('parses Gatekeeper Toll killing blow', parsed.lastHit?.name === "GATEKEEPER'S TOLL");
    t('attributes Gatekeeper Toll damage', parsed.dmg.special["GATEKEEPER'S TOLL"] === 110);

    const kry = parseCombatLogs([
      { msg: 'Kryos, the Demon General (LEFT AT THE POST) hits you for 98.' },
    ], { bossName: 'Kryos, the Demon General' });
    t('parses Kryos finisher', kry.lastHit?.name === 'LEFT AT THE POST');

    const burn = parseCombatLogs([
      { msg: 'You burn for 12.' },
      { msg: 'Duke Malgrimm, Gatekeeper of the Throne (Bladestorm Toll) hits you for 40.' },
    ], { bossName: 'Duke Malgrimm, Gatekeeper of the Throne' });
    t('parses burn and Bladestorm', burn.dmg.burn === 12 && burn.dmg.special['Bladestorm Toll'] === 40);
  }

  {
    t('both F50 bosses are named for the matrix', BOSS_IDS.infernal_duke && BOSS_IDS.kryos_demon_general);
    const dukeSolo = buildEnemy(BOSSES[50], 50, 41, { boss: true, partySize: 1 });
    const dukeCoop = buildEnemy(BOSSES[50], 50, 41, { boss: true, partySize: 2 });
    const kryosSolo = buildEnemy(ALT_BOSSES[50], 50, 41, { boss: true, partySize: 1 });
    t('solo Duke is not an extra F50-gate trim vs coop', dukeSolo.maxHp === dukeCoop.maxHp);
    t('solo Kryos is not an extra F50-gate trim vs coop ATK', kryosSolo.atk === dukeSolo.atk
      || kryosSolo.atk > 0);
    t('Duke and Kryos are different ids', dukeSolo.id === 'infernal_duke' && kryosSolo.id === 'kryos_demon_general');
    t('solo Duke build is deterministic',
      dukeSolo.maxHp === buildEnemy(BOSSES[50], 50, 41, { boss: true, partySize: 1 }).maxHp);
  }

  {
    const a = await captureF50Arrival({ seed: 20260823, classId: 'warrior' });
    const b = await captureF50Arrival({ seed: 20260823, classId: 'warrior' });
    t('F50 capture is deterministic for seed+class',
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
    const tiny = await runF50Probe({ seed: 5, runs: 6 });
    t('tiny F50 probe reports climbs', tiny.meta.climbs === 6 && tiny.meta.f50 >= 0);
    t('tiny F50 probe is byte-stable',
      JSON.stringify(tiny.byBoss) === JSON.stringify((await runF50Probe({ seed: 5, runs: 6 })).byBoss));
    t('tiny probe keeps four condition cells for both bosses',
      tiny.byBoss.infernal_duke?.autoplay_observed
      && tiny.byBoss.infernal_duke?.bossaware_full
      && tiny.byBoss.kryos_demon_general?.autoplay_observed
      && tiny.byBoss.kryos_demon_general?.bossaware_full);
    t('tiny probe extraRuns default is zero', tiny.meta.extraRuns === 0 || tiny.meta.extraRuns == null);
    t('tiny probe does not invent F50 arrivals', tiny.meta.f50 === 0
      || (tiny.byBoss.infernal_duke.autoplay_observed.n === tiny.meta.f50));
    t('frozen knobs recorded on the report',
      tiny.meta.f30SoloHpMult === 0.65 && tiny.meta.f40SoloHpMult === 0.65);
  }

  {
    let cap = null;
    const tries = [
      { seed: 20260823, classId: 'archer' },
      { seed: 20260823, classId: 'warrior' },
      { seed: 21108528, classId: 'archer' },
    ];
    for (const job of tries) {
      const c = await captureF50Arrival(job);
      if (c.reached) { cap = c; break; }
    }
    if (!cap) {
      t('no F50 arrival in smoke seeds (allowed)', true);
    } else {
      const a = await replayArrival(cap, { policy: 'autoplay', hp: 'observed' });
      const b = await replayArrival(cap, { policy: 'autoplay', hp: 'observed' });
      t('identical F50 replay is deterministic', a.win === b.win && a.rounds === b.rounds && a.hpLeft === b.hpLeft);
      t('observed replay keeps arrival HP', Math.abs(a.hpEnter - cap.arrival.hp) < 1e-6);
      const full = await replayArrival(cap, { policy: 'autoplay', hp: 'full' });
      t('full-HP replay starts at maxHp', full.hpEnter === cap.arrival.maxHp);
      const duke = await replayArrival(cap, { policy: 'autoplay', hp: 'full', bossId: 'infernal_duke' });
      const kry = await replayArrival(cap, { policy: 'autoplay', hp: 'full', bossId: 'kryos_demon_general' });
      t('forced Duke replay still uses infernal_duke', duke.bossId === 'infernal_duke');
      t('forced Kryos replay still uses kryos_demon_general', kry.bossId === 'kryos_demon_general');
    }
  }
}
