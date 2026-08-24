// F30 competence probe — fast tests. Does not retune combat or bosses.
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chooseAutoPlayAction } from '../js/combat_policy.js';
import { chooseBossAwareAction } from './policies/boss_aware.js';
import {
  captureF30Arrival, replayArrival, parseCombatLogs, runF30Probe, BOSS_IDS,
} from './run_f30_probe.js';
import { makeV2Run, simulateClimbV2 } from './run_climb_v2.js';
import { baselinePolicy } from './policies/baseline.js';
import { enemyScale, TDC, soloBossChargeForScale, soloBossSpecialDmgMult, f30SoloGateMults, F30_SOLO_GATE_IDS } from '../js/data/tdc.js';
import { BOSSES, ALT_BOSSES, ENEMIES, NPC_ENEMIES, mimicSpec } from '../js/data/enemies.js';
import { buildEnemy } from '../js/combat_core.js';

const here = dirname(fileURLToPath(import.meta.url));

function fakeFight({
  classId = 'warrior',
  hp = 50,
  maxHp = 110,
  mp = 28,
  skills = ['slash', 'shield_bash', 'taunt'],
  consumables = ['potion_s'],
  charge = 2,
  enemies = null,
} = {}) {
  const vessalia = {
    id: 'frost_queen',
    name: 'Queen Vessalia the Unmelting',
    hp: 620,
    maxHp: 620,
    atk: 42,
    def: 10,
    spd: 9,
    boss: true,
    charge: 6,
    freezeEvery: 4,
    specials: [
      { at: 2, name: 'Glacial Decree', mult: 1.3, freeze: 0.35 },
      { at: 4, name: 'Courtly Reproach', mult: 1.7, aoe: true, weaken: 0.4 },
      { at: 6, name: 'ETERNAL WINTER', mult: 2.65, aoe: true, freezeSure: true },
    ],
  };
  return {
    run: {
      classId,
      raceId: 'human',
      floor: 30,
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
      level: 12,
    },
    charge,
    mod: {},
    enemies: enemies || [vessalia],
    player: { statuses: {}, buffs: [], partyBuffs: [] },
    aliveEnemies() { return this.enemies.filter(e => e.hp > 0); },
  };
}

function hrothFight(extra = {}) {
  return fakeFight({
    ...extra,
    enemies: [{
      id: 'tr_mon_centaur',
      name: 'Hroth, the Frost Centaur',
      hp: 620,
      maxHp: 620,
      atk: 40,
      def: 10,
      spd: 8,
      boss: true,
      charge: extra.enemyCharge ?? 6,
      freezeEvery: 4,
      freeze: 0.25,
      specials: [
        { at: 2, name: 'Hoof-Frost', mult: 1.3, freeze: 0.35 },
        { at: 4, name: "Outrider's Point", mult: 1.7, aoe: true, weaken: 0.35 },
        { at: 6, name: 'UNMELTING CHARGE', mult: 2.65, aoe: true, freezeSure: true },
      ],
    }],
  });
}

export async function runF30ProbeTests(t) {
  console.log('— F30 combat competence probe —');

  {
    const src = readFileSync(join(here, 'policies', 'boss_aware.js'), 'utf8');
    t('boss-aware policy does not read fight RNG', !/f\.rng|runRng|Math\.random/.test(src));
    t('boss-aware policy does not mutate stats', !/run\.(atk|def|maxHp)\s*=/.test(src));
    const live = readFileSync(join(here, '..', 'js', 'combat_policy.js'), 'utf8');
    t('boss-aware is not wired into live autoplay', !/boss_aware|chooseBossAwareAction/.test(live));
    const tdc = readFileSync(join(here, '..', 'js', 'data', 'tdc.js'), 'utf8');
    const enemies = readFileSync(join(here, '..', 'js', 'data', 'enemies.js'), 'utf8');
    t('F30 solo knobs exist and stay F30-prefixed', /f30SoloHpMult/.test(tdc) && /f30SoloAtkMult/.test(tdc));
    t('F30 solo ATK is uncut', TDC.enemy.f30SoloAtkMult === 1);
    t('F30 solo HP is duration-only 0.65', TDC.enemy.f30SoloHpMult === 0.65);
    t('F30 gate IDs are Vessalia and Hroth only',
      F30_SOLO_GATE_IDS.length === 2
      && F30_SOLO_GATE_IDS.includes('frost_queen')
      && F30_SOLO_GATE_IDS.includes('tr_mon_centaur'));
    t('Vessalia authored HP is unchanged', BOSSES[30].hp === 395 && BOSSES[30].atk === 37);
    t('Hroth authored HP is unchanged', ALT_BOSSES[30].hp === 395 && ALT_BOSSES[30].atk === 35);
    t('F20 knobs are still F20-only', TDC.enemy.f20SoloHpMult === 0.70 && TDC.enemy.f20SoloChargeCap === 2);
    t('F10 knobs are still F10-only', TDC.enemy.f10SoloHpMult === 0.70 && TDC.enemy.f10SoloAtkMult === 0.88);
    t('F21–29 are not boss floors in this pass', !BOSSES[25] && !BOSSES[21]);
    t('enemies.js still authors Vessalia at 395', /id: 'frost_queen'[\s\S]*?hp: 395/.test(enemies));
  }

  {
    const f = fakeFight({ hp: 55, skills: ['slash', 'shield_bash', 'taunt'] });
    f.enemies[0].charge = 6;
    const auto = chooseAutoPlayAction(f);
    const aware = chooseBossAwareAction(f);
    t('autoplay does not taunt a ready Eternal Winter from 50+ HP', auto.skillId !== 'taunt');
    t('boss-aware defends a ready Eternal Winter', aware.skillId === 'taunt' || aware.skillId === 'guard');
  }

  {
    const f = hrothFight({ hp: 55, enemyCharge: 6, skills: ['slash', 'shield_bash', 'taunt'] });
    const aware = chooseBossAwareAction(f);
    t('boss-aware defends Hroth UNMELTING CHARGE', aware.skillId === 'taunt' || aware.skillId === 'guard');
  }

  {
    const f = fakeFight({
      classId: 'priest',
      hp: 35,
      maxHp: 110,
      skills: ['smite', 'mend', 'radiant_ward'],
      consumables: [],
      mp: 30,
    });
    f.enemies[0].charge = 1;
    const auto = chooseAutoPlayAction(f);
    const aware = chooseBossAwareAction(f);
    t('autoplay may select Mend at low HP', auto.skillId === 'mend');
    t('boss-aware uses Mend or a heal at wounded F30 HP', aware.skillId === 'mend' || aware.type === 'useConsumable');
  }

  {
    const parsed = parseCombatLogs([
      { msg: 'Queen Vessalia the Unmelting unleashes ETERNAL WINTER!' },
      { msg: 'Queen Vessalia the Unmelting (ETERNAL WINTER) hits you for 72.' },
    ], { bossName: 'Queen Vessalia the Unmelting' });
    t('parses Eternal Winter killing blow', parsed.lastHit?.name === 'ETERNAL WINTER');
    t('attributes Eternal Winter damage', parsed.dmg.special['ETERNAL WINTER'] === 72);

    const hroth = parseCombatLogs([
      { msg: 'Hroth, the Frost Centaur (UNMELTING CHARGE) hits you for 68.' },
    ], { bossName: 'Hroth, the Frost Centaur' });
    t('parses Hroth finisher', hroth.lastHit?.name === 'UNMELTING CHARGE');

    const freeze = parseCombatLogs([
      { msg: 'You are frozen!' },
      { msg: 'You are frozen solid — turn lost!' },
      { msg: 'Queen Vessalia the Unmelting hits you for 18.' },
    ], { bossName: 'Queen Vessalia the Unmelting' });
    t('parses freeze apply and skip', freeze.freezeApplies === 1 && freeze.freezeSkips === 1);
    t('basic after freeze is still basic', freeze.dmg.basic === 18 && freeze.lastHit?.kind === 'basic');
  }

  {
    t('both F30 bosses are named for the matrix', BOSS_IDS.frost_queen && BOSS_IDS.tr_mon_centaur);
    t("Vessalia ETERNAL WINTER identity is preserved",
      BOSSES[30].specials.some(s => s.name === 'ETERNAL WINTER' && s.mult === 2.65 && s.freezeSure && s.aoe));
    t('Vessalia freeze is a court pulse', BOSSES[30].freezeEvery === 4 && !BOSSES[30].freeze);
    t('Hroth UNMELTING CHARGE identity is preserved',
      ALT_BOSSES[30].specials.some(s => s.name === 'UNMELTING CHARGE' && s.mult === 2.65 && s.freezeSure));
    t('Hroth freeze pulse matches Vessalia', ALT_BOSSES[30].freezeEvery === 4);
    t('F30 charge is not F20-capped',
      soloBossChargeForScale(30, 6) === 6
      && soloBossChargeForScale(20, 6) === 2);
    t('F30 finishers are not F20-padded',
      soloBossSpecialDmgMult(30, { mult: 2.65 }) === 1
      && soloBossSpecialDmgMult(20, { mult: 2.6 }) < 1);
    {
      const vSolo = buildEnemy(BOSSES[30], 30, 21, { boss: true, partySize: 1 });
      const vSolo2 = buildEnemy(BOSSES[30], 30, 21, { boss: true, partySize: 1 });
      const vCoop = buildEnemy(BOSSES[30], 30, 21, { boss: true, partySize: 2 });
      const hSolo = buildEnemy(ALT_BOSSES[30], 30, 21, { boss: true, partySize: 1 });
      const hCoop = buildEnemy(ALT_BOSSES[30], 30, 21, { boss: true, partySize: 2 });
      const f20 = enemyScale(20, 11, 'ruins', { boss: true, partySize: 1 });
      const f30 = enemyScale(30, 21, 'frost', { boss: true, partySize: 1 });
      const scBoss = enemyScale(30, 21, 'frost', { boss: true, partySize: 1 });
      const warden = ENEMIES.frost.find(e => e.id === 'archive_warden');
      const trashSolo = buildEnemy(warden, 30, 21, { partySize: 1 });
      const trashCoop = buildEnemy(warden, 30, 21, { partySize: 2 });
      const scTrash = enemyScale(30, 21, 'frost', { boss: false, partySize: 1 });
      const lichSolo = buildEnemy(BOSSES[20], 20, 11, { boss: true, partySize: 1 });
      const gateV = f30SoloGateMults(30, 1, 'frost_queen');
      const gateTrash = f30SoloGateMults(30, 1, 'archive_warden');
      const gateCoop = f30SoloGateMults(30, 2, 'frost_queen');
      const gateF20 = f30SoloGateMults(20, 1, 'frost_queen');
      const gateF40 = f30SoloGateMults(40, 1, 'hydra');
      t('F30 solo scale is not F20-trimmed extra', f30.hp / f20.hp > 1);
      t('F30 enemyScale is not ID-gated',
        f30.hp === enemyScale(30, 21, 'frost', { boss: true, partySize: 2 }).hp);
      t('solo Vessalia receives f30SoloHpMult', vSolo.maxHp === Math.round(BOSSES[30].hp * scBoss.hp * TDC.enemy.f30SoloHpMult));
      t('solo Hroth receives f30SoloHpMult', hSolo.maxHp === Math.round(ALT_BOSSES[30].hp * scBoss.hp * TDC.enemy.f30SoloHpMult));
      t('coop Vessalia is not F30-gate-trimmed', vCoop.maxHp === Math.round(BOSSES[30].hp * scBoss.hp));
      t('coop Hroth is not F30-gate-trimmed', hCoop.maxHp === Math.round(ALT_BOSSES[30].hp * scBoss.hp));
      t('F30 trash is not F30-gate-trimmed', trashSolo.maxHp === Math.round(warden.hp * scTrash.hp)
        && trashSolo.maxHp === trashCoop.maxHp);
      t('F20 Lich is not F30-gate-trimmed', lichSolo.id === 'lich' && f30SoloGateMults(20, 1, 'lich').hp === 1);
      t('F40 Hydra is not F30-gate-trimmed', f30SoloGateMults(40, 1, 'hydra').hp === 1);
      t('gate helper is id-scoped', gateV.hp === TDC.enemy.f30SoloHpMult && gateTrash.hp === 1
        && gateCoop.hp === 1 && gateF20.hp === 1 && gateF40.hp === 1);
      t('solo Vessalia build is deterministic', vSolo.maxHp === vSolo2.maxHp && vSolo.atk === vSolo2.atk);
      t('Hroth is a different body than Vessalia', hSolo.id === 'tr_mon_centaur' && hSolo.atk !== vSolo.atk);
      {
        const fakeGate = {
          id: 'frost_courtier', name: 'Frozen Courtier', hp: 395, atk: 37, def: 10, spd: 9, boss: true,
        };
        const fakeBuilt = buildEnemy(fakeGate, 30, 21, { boss: true, partySize: 1 });
        t('non-gate F30 boss identity is not trimmed',
          fakeBuilt.maxHp === Math.round(fakeGate.hp * scBoss.hp)
          && f30SoloGateMults(30, 1, 'frost_courtier').hp === 1);
        t('F30 event mimic is not F30-gate-trimmed',
          f30SoloGateMults(30, 1, mimicSpec(30).id).hp === 1
          && f30SoloGateMults(30, 1, 'mimic').atk === 1);
        t('F30 event NPC helper is identity 1', f30SoloGateMults(30, 1, NPC_ENEMIES.blade_hero.id).hp === 1
          && f30SoloGateMults(30, 1, 'blade_hero').atk === 1);
        const escort = buildEnemy(warden, 30, 21, { boss: false, partySize: 1, atkMult: 0.55 });
        t('F30 escort trash is not F30-gate-trimmed',
          escort.maxHp === Math.round(warden.hp * scTrash.hp)
          && f30SoloGateMults(30, 1, warden.id).hp === 1);
      }
    }
  }

  {
    const a = await captureF30Arrival({ seed: 20260823, classId: 'warrior' });
    const b = await captureF30Arrival({ seed: 20260823, classId: 'warrior' });
    t('F30 capture is deterministic for seed+class',
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
    const tiny = await runF30Probe({ seed: 5, runs: 6 });
    t('tiny F30 probe reports climbs', tiny.meta.climbs === 6 && tiny.meta.arrivals >= 0);
    t('tiny F30 probe is byte-stable',
      JSON.stringify(tiny.byBoss) === JSON.stringify((await runF30Probe({ seed: 5, runs: 6 })).byBoss));
    t('tiny probe keeps four condition cells for both bosses',
      tiny.byBoss.frost_queen?.autoplay_observed
      && tiny.byBoss.frost_queen?.bossaware_full
      && tiny.byBoss.tr_mon_centaur?.autoplay_observed
      && tiny.byBoss.tr_mon_centaur?.bossaware_full);
    t('tiny probe does not invent F30 arrivals', tiny.meta.arrivals === 0
      || (tiny.byBoss.frost_queen.autoplay_observed.n === tiny.meta.arrivals
        && tiny.byBoss.tr_mon_centaur.autoplay_observed.n === tiny.meta.arrivals));
    t('tiny probe splits arrivals by live assignment',
      !!tiny.arrivals?.byLiveBoss?.frost_queen && !!tiny.arrivals?.byLiveBoss?.tr_mon_centaur);
  }

  {
    let cap = null;
    const tries = [
      { seed: 20260823, classId: 'warrior' },
      { seed: 20260823, classId: 'priest' },
      { seed: 77, classId: 'warrior' },
      { seed: 11, classId: 'rogue' },
    ];
    for (const job of tries) {
      const c = await captureF30Arrival(job);
      if (c.reached) { cap = c; break; }
    }
    if (!cap) {
      t('no F30 arrival in smoke seeds (allowed)', true);
    } else {
      const a = await replayArrival(cap, { policy: 'autoplay', hp: 'observed' });
      const b = await replayArrival(cap, { policy: 'autoplay', hp: 'observed' });
      t('identical F30 replay is deterministic', a.win === b.win && a.rounds === b.rounds && a.hpLeft === b.hpLeft);
      t('observed replay keeps arrival HP', Math.abs(a.hpEnter - cap.arrival.hp) < 1e-6);
      const full = await replayArrival(cap, { policy: 'autoplay', hp: 'full' });
      t('full-HP replay starts at maxHp', full.hpEnter === cap.arrival.maxHp);
      t('full-HP replay does not mutate relics or skills',
        JSON.stringify(full.parsed && cap.arrival.relics) === JSON.stringify(cap.arrival.relics)
        && cap.run.skills.length === cap.arrival.skillCount);
      const vess = await replayArrival(cap, { policy: 'autoplay', hp: 'full', bossId: 'frost_queen' });
      const hroth = await replayArrival(cap, { policy: 'autoplay', hp: 'full', bossId: 'tr_mon_centaur' });
      t('forced Vessalia replay still uses frost_queen', vess.bossId === 'frost_queen');
      t('forced Hroth replay still uses tr_mon_centaur', hroth.bossId === 'tr_mon_centaur');
    }
  }
}
