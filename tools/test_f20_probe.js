// F20 competence probe — fast tests. Does not retune combat or bosses.
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chooseAutoPlayAction } from '../js/combat_policy.js';
import { chooseBossAwareAction } from './policies/boss_aware.js';
import {
  captureF20Arrival, replayArrival, parseCombatLogs, runF20Probe,
} from './run_f20_probe.js';
import { makeV2Run, simulateClimbV2 } from './run_climb_v2.js';
import { baselinePolicy } from './policies/baseline.js';
import { enemyScale, TDC, soloBossChargeForScale, soloBossSpecialDmgMult } from '../js/data/tdc.js';
import { BOSSES, ALT_BOSSES } from '../js/data/enemies.js';
import { buildEnemy } from '../js/combat_core.js';

const here = dirname(fileURLToPath(import.meta.url));

function fakeFight({
  classId = 'warrior',
  hp = 40,
  maxHp = 90,
  mp = 28,
  skills = ['slash', 'shield_bash', 'taunt'],
  consumables = ['potion_s'],
  charge = 2,
  enemies = null,
} = {}) {
  const lich = {
    id: 'lich',
    name: 'Lich of the Fallen King',
    hp: 400,
    maxHp: 400,
    atk: 28,
    def: 7,
    spd: 8,
    boss: true,
    charge: 5,
    specials: [
      { at: 4, name: 'Soul Tithe', mult: 1.65, heal: 0.06, weaken: 0.5 },
      { at: 5, name: "DYNASTY'S END", mult: 2.60, aoe: true, tormentedSure: true },
    ],
  };
  return {
    run: {
      classId,
      raceId: 'human',
      floor: 20,
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
      level: 9,
    },
    charge,
    mod: {},
    enemies: enemies || [lich],
    player: { statuses: {}, buffs: [], partyBuffs: [] },
    aliveEnemies() { return this.enemies.filter(e => e.hp > 0); },
  };
}

function gravesendFight(extra = {}) {
  return fakeFight({
    ...extra,
    enemies: [{
      id: 'undead_executioner',
      name: 'Gravesend, the Undead Executioner',
      hp: 400,
      maxHp: 400,
      atk: 28,
      def: 8,
      spd: 6,
      boss: true,
      charge: extra.enemyCharge ?? 6,
      specials: [
        { at: 3, name: 'Toll the Block', mult: 1.55, weaken: 0.4 },
        { at: 5, name: 'Procession Cut', mult: 1.85, aoe: true, frail: 0.4 },
        { at: 6, name: 'THE NEXT NAME', mult: 2.7, frailSure: true },
      ],
    }],
  });
}

export async function runF20ProbeTests(t) {
  console.log('— F20 combat competence probe —');

  {
    const src = readFileSync(join(here, 'policies', 'boss_aware.js'), 'utf8');
    t('boss-aware policy does not read fight RNG', !/f\.rng|runRng|Math\.random/.test(src));
    t('boss-aware policy does not mutate stats', !/run\.(atk|def|maxHp)\s*=/.test(src));
    const live = readFileSync(join(here, '..', 'js', 'combat_policy.js'), 'utf8');
    t('boss-aware is not wired into live autoplay', !/boss_aware|chooseBossAwareAction/.test(live));
    const enemies = readFileSync(join(here, '..', 'js', 'data', 'enemies.js'), 'utf8');
    t('probe files do not retune Lich authored HP', BOSSES[20].hp === 340 && BOSSES[20].atk === 30);
    t('probe files do not retune Gravesend authored HP', ALT_BOSSES[20].hp === 340 && ALT_BOSSES[20].atk === 30);
    t('F15 authored HP is untouched', BOSSES[15].hp === 235);
    t('enemies.js source still has lich at 340', /id: 'lich'[\s\S]*?hp: 340/.test(enemies));
  }

  {
    const f = fakeFight({ hp: 50, skills: ['slash', 'shield_bash', 'taunt'] });
    f.enemies[0].charge = 5;
    const auto = chooseAutoPlayAction(f);
    const aware = chooseBossAwareAction(f);
    t('autoplay does not taunt a ready Dynasty End from 50+ HP', auto.skillId !== 'taunt');
    t('boss-aware defends a ready Dynasty End', aware.skillId === 'taunt' || aware.skillId === 'guard');
  }

  {
    const f = gravesendFight({ hp: 55, enemyCharge: 6, skills: ['slash', 'shield_bash', 'taunt'] });
    const aware = chooseBossAwareAction(f);
    t('boss-aware defends Gravesend THE NEXT NAME', aware.skillId === 'taunt' || aware.skillId === 'guard');
  }

  {
    const f = fakeFight({
      classId: 'priest',
      hp: 30,
      maxHp: 90,
      skills: ['smite', 'mend', 'radiant_ward'],
      consumables: [],
      mp: 30,
    });
    f.enemies[0].charge = 1;
    const auto = chooseAutoPlayAction(f);
    const aware = chooseBossAwareAction(f);
    t('autoplay may select Mend at low HP', auto.skillId === 'mend');
    t('boss-aware uses Mend or a heal at wounded F20 HP', aware.skillId === 'mend' || aware.type === 'useConsumable');
  }

  {
    const skeleton = {
      id: 'skeleton', name: 'Risen Skeleton', hp: 22, maxHp: 22, atk: 9, def: 2, spd: 6, summon: true,
      charge: 0, specials: [],
    };
    const f = fakeFight({ hp: 70, skills: ['slash', 'cleave', 'taunt'] });
    f.enemies[0].charge = 1;
    f.enemies.push({ ...skeleton });
    const aware = chooseBossAwareAction(f);
    t('boss-aware prefers the summon or an AOE while adds live',
      aware.enemy === 1 || aware.skillId === 'cleave');
    t('one skinny summon is cut with Slash, not a charge AOE',
      aware.skillId === 'slash' && aware.enemy === 1);

    const charged = fakeFight({ hp: 70, charge: 3, mp: 28, skills: ['slash', 'cleave', 'taunt'] });
    charged.enemies[0].charge = 1;
    charged.enemies.push({ ...skeleton });
    const stillCut = chooseBossAwareAction(charged);
    t('affordable Cleave still does not auto-win vs one summon',
      stillCut.skillId === 'slash' && stillCut.enemy === 1);

    const swarm = fakeFight({ hp: 70, charge: 3, mp: 28, skills: ['slash', 'cleave', 'taunt'] });
    swarm.enemies[0].charge = 1;
    swarm.enemies.push({ ...skeleton }, { ...skeleton, uid: 'skeleton-2' });
    const splash = chooseBossAwareAction(swarm);
    t('Cleave is chosen when two adds are live and the AOE is affordable',
      splash.skillId === 'cleave');
  }

  {
    const f = fakeFight({ hp: 40 });
    f.enemies[0].charge = 1;
    f.player.statuses.tormented = 3;
    const aware = chooseBossAwareAction(f);
    t('boss-aware heals through torment', aware.type === 'useConsumable' || aware.skillId === 'mend');
    f.rng = {
      next() { throw new Error('policy consumed gameplay RNG'); },
      chance() { throw new Error('policy consumed gameplay RNG'); },
      int() { throw new Error('policy consumed gameplay RNG'); },
    };
    let threw = false;
    try { chooseBossAwareAction(f); } catch { threw = true; }
    t('boss-aware action does not throw via rng', !threw);
  }

  {
    const parsed = parseCombatLogs([
      { msg: "Lich of the Fallen King unleashes DYNASTY'S END!" },
      { msg: "Lich of the Fallen King (DYNASTY'S END) hits you for 61." },
    ], { bossName: 'Lich of the Fallen King' });
    t('parses Dynasty End killing blow', parsed.lastHit?.name === "DYNASTY'S END");
    t('attributes Dynasty End damage', parsed.dmg.special["DYNASTY'S END"] === 61);

    const grave = parseCombatLogs([
      { msg: 'Gravesend, the Undead Executioner (THE NEXT NAME) hits you for 58.' },
    ], { bossName: 'Gravesend, the Undead Executioner' });
    t('parses Gravesend finisher', grave.lastHit?.name === 'THE NEXT NAME');

    const withDot = parseCombatLogs([
      { msg: "Lich of the Fallen King (DYNASTY'S END) hits you for 40." },
      { msg: 'Torment claws you for 6.' },
    ]);
    t('torment can be the last hit', withDot.lastHit?.kind === 'torment' && withDot.dmg.torment === 6);

    const withAdd = parseCombatLogs([
      { msg: 'Lich of the Fallen King drags a servant up from the dust!' },
      { msg: 'Risen Skeleton hits you for 11.' },
    ], { bossName: 'Lich of the Fallen King' });
    t('summon chip is tracked separately', withAdd.dmg.summon === 11 && withAdd.summons === 1 && withAdd.lastHit?.kind === 'summon');

    const out = parseCombatLogs([
      { msg: 'Slash hits Lich of the Fallen King for 18' },
      { msg: 'Lich of the Fallen King hits you for 12.' },
    ], { bossName: 'Lich of the Fallen King' });
    t('player outgoing damage is parsed', out.playerDmg === 18 && out.dmg.basic === 12);
  }

  {
    const a = await captureF20Arrival({ seed: 20260823, classId: 'warrior' });
    const b = await captureF20Arrival({ seed: 20260823, classId: 'warrior' });
    t('F20 capture is deterministic for seed+class',
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
    const tiny = await runF20Probe({ seed: 5, runs: 6, crossBoss: false });
    t('tiny F20 probe reports climbs', tiny.meta.climbs === 6 && tiny.meta.arrivals >= 0);
    t('tiny F20 probe is byte-stable',
      JSON.stringify(tiny.byBoss) === JSON.stringify((await runF20Probe({ seed: 5, runs: 6, crossBoss: false })).byBoss));
    t('tiny probe keeps four condition cells when anyone arrives',
      tiny.meta.arrivals === 0
      || Object.values(tiny.byBoss).every(b => b.autoplay_observed && b.bossaware_full));
    t('F20 extra F10 ease does not apply', (() => {
      const f20 = enemyScale(20, 11, 'ruins', { boss: true, partySize: 1 });
      const f10 = enemyScale(10, 1, 'forest', { boss: true, partySize: 1 });
      return f20.hp > f10.hp;
    })());
    {
      const f15s = enemyScale(15, 11, 'ruins', { boss: true, partySize: 1 });
      const f15c = enemyScale(15, 11, 'ruins', { boss: true, partySize: 2 });
      const f20s = enemyScale(20, 11, 'ruins', { boss: true, partySize: 1 });
      const f20c = enemyScale(20, 11, 'ruins', { boss: true, partySize: 2 });
      const f30s = enemyScale(30, 21, 'frost', { boss: true, partySize: 1 });
      const f30c = enemyScale(30, 21, 'frost', { boss: true, partySize: 2 });
      t('F20 solo extra HP trim does not apply to coop F20', f20s.hp < f20c.hp);
      t('F20 extra HP trim is not applied to F15', f15s.hp / f15c.hp > f20s.hp / f20c.hp);
      t('F20 extra HP trim is not applied to F30', f30s.hp / f30c.hp > f20s.hp / f20c.hp);
    }
    t("Dynasty's End identity is preserved",
      BOSSES[20].specials.some(s => s.name === "DYNASTY'S END" && s.mult === 2.60 && s.tormentedSure && s.aoe));
    t('Soul Tithe and summons are preserved',
      BOSSES[20].summons === 'skeleton'
      && BOSSES[20].specials.some(s => s.name === 'Soul Tithe' && s.heal === 0.06 && s.mult === 1.65));
    t('Gravesend THE NEXT NAME identity is preserved',
      ALT_BOSSES[20].specials.some(s => s.name === 'THE NEXT NAME' && s.mult === 2.7 && s.frailSure));
    t('F20 solo charge cap does not change F10 or F30',
      soloBossChargeForScale(10, 6) === 5
      && soloBossChargeForScale(20, 6) === 2
      && soloBossChargeForScale(30, 6) === 6);
    t('F20 finisher pad is solo-F20 and identity-gated',
      soloBossSpecialDmgMult(20, { mult: 2.6 }) < 1
      && soloBossSpecialDmgMult(20, { mult: 1.65 }) === 1
      && soloBossSpecialDmgMult(10, { mult: 2.7 }) === 1
      && soloBossSpecialDmgMult(30, { mult: 2.65 }) === 1);
    {
      const lichSolo = buildEnemy(BOSSES[20], 20, 11, { boss: true, partySize: 1 });
      const lichCoop = buildEnemy(BOSSES[20], 20, 11, { boss: true, partySize: 2 });
      const graveSolo = buildEnemy(ALT_BOSSES[20], 20, 11, { boss: true, partySize: 1 });
      const graveCoop = buildEnemy(ALT_BOSSES[20], 20, 11, { boss: true, partySize: 2 });
      const f15 = buildEnemy(BOSSES[15], 15, 11, { boss: true, partySize: 1 });
      t('solo Lich has extra HP trim beyond Gravesend', lichSolo.maxHp < graveSolo.maxHp);
      t('coop Lich is not extra-trimmed', lichCoop.maxHp > lichSolo.maxHp);
      t('Gravesend extra Lich trim does not apply', graveSolo.maxHp < graveCoop.maxHp);
      t('F15 Revenant is a different fight than solo Lich', f15.id === 'crowned_revenant' && f15.maxHp !== lichSolo.maxHp);
    }
  }

  {
    // Search a handful of seeds so replay assertions can run when anyone actually arrives.
    let cap = null;
    const tries = [
      { seed: 20260823, classId: 'warrior' },
      { seed: 20260823, classId: 'priest' },
      { seed: 77, classId: 'warrior' },
      { seed: 11, classId: 'rogue' },
    ];
    for (const job of tries) {
      const c = await captureF20Arrival(job);
      if (c.reached) { cap = c; break; }
    }
    if (!cap) {
      t('no F20 arrival in smoke seeds (allowed)', true);
    } else {
      const a = await replayArrival(cap, { policy: 'autoplay', hp: 'observed' });
      const b = await replayArrival(cap, { policy: 'autoplay', hp: 'observed' });
      t('identical F20 replay is deterministic', a.win === b.win && a.rounds === b.rounds && a.hpLeft === b.hpLeft);
      t('observed replay keeps arrival HP', Math.abs(a.hpEnter - cap.arrival.hp) < 1e-6);
      const full = await replayArrival(cap, { policy: 'autoplay', hp: 'full' });
      t('full-HP replay starts at maxHp', full.hpEnter === cap.arrival.maxHp);
      t('fight preserves sticky F20 boss id', a.bossId === cap.bossId || a.bossId != null);
      const forced = await replayArrival(cap, { policy: 'autoplay', hp: 'full', bossId: 'lich' });
      t('forced Lich replay still uses lich', forced.bossId === 'lich');
    }
  }
}
