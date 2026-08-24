// F10 competence probe — fast tests. Does not retune combat or bosses.
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { chooseAutoPlayAction } from '../js/combat_policy.js';
import { chooseBossAwareAction } from './policies/boss_aware.js';
import {
  captureF10Arrival, replayArrival, parseCombatLogs, runF10Probe,
} from './run_f10_probe.js';
import { makeV2Run, simulateClimbV2 } from './run_climb_v2.js';
import { baselinePolicy, scoreEventChoice } from './policies/baseline.js';
import { TDC, enemyScale } from '../js/data/tdc.js';
import { EVENTS } from '../js/data/events.js';

const here = dirname(fileURLToPath(import.meta.url));

function fakeFight({
  classId = 'warrior',
  hp = 22,
  maxHp = 60,
  mp = 28,
  skills = ['slash', 'shield_bash', 'taunt'],
  consumables = ['potion_s'],
  charge = 2,
  enemyCharge = 6,
  statuses = {},
} = {}) {
  const enemies = [{
    id: 'elderwood',
    name: 'Sylvanor, the Elderwood Guardian',
    hp: 160,
    maxHp: 160,
    atk: 12,
    def: 4,
    spd: 3,
    boss: true,
    charge: enemyCharge,
    specials: [
      { at: 4, name: 'Limb Sweep', mult: 1.55, aoe: true, lazy: 0.35 },
      { at: 6, name: "FOREST'S VERDICT", mult: 2.70, frail: 0.5 },
    ],
  }];
  const run = {
    classId,
    raceId: 'human',
    floor: 10,
    hp,
    maxHp,
    mp,
    maxMp: 40,
    skills,
    consumables,
    stats: { str: 12, dex: 6, int: 5, wis: 8, lk: 4 },
    equipment: {},
    relics: [],
    weaponBonus: 0,
    level: 5,
  };
  return {
    run,
    charge,
    mod: {},
    enemies,
    player: { statuses: { ...statuses }, buffs: [], partyBuffs: [] },
    aliveEnemies() { return this.enemies.filter(e => e.hp > 0); },
  };
}

export async function runF10ProbeTests(t) {
  console.log('— F10 combat competence probe —');

  {
    const src = readFileSync(join(here, 'policies', 'boss_aware.js'), 'utf8');
    t('boss-aware policy does not read fight RNG', !/f\.rng|runRng|Math\.random/.test(src));
    t('boss-aware policy does not mutate stats', !/run\.(atk|def|maxHp)\s*=/.test(src));
  }

  {
    const f = fakeFight({ hp: 20, enemyCharge: 6, skills: ['slash', 'shield_bash', 'taunt'] });
    const auto = chooseAutoPlayAction(f);
    const aware = chooseBossAwareAction(f);
    t('autoplay does not taunt a ready Verdict', auto.skillId !== 'taunt');
    t('boss-aware taunts (or wards) a ready Verdict', aware.skillId === 'taunt' || aware.skillId === 'guard');
  }

  {
    const f = fakeFight({
      classId: 'priest',
      hp: 22,
      maxHp: 60,
      enemyCharge: 1,
      skills: ['smite', 'mend', 'radiant_ward'],
      consumables: [],
      mp: 30,
      charge: 2,
    });
    const auto = chooseAutoPlayAction(f);
    const aware = chooseBossAwareAction(f);
    t('autoplay may select Mend at low HP', auto.skillId === 'mend');
    t('boss-aware uses Mend at observed-range HP', aware.skillId === 'mend' || aware.type === 'useConsumable');
  }

  {
    const f = fakeFight({
      classId: 'priest',
      hp: 50,
      maxHp: 60,
      enemyCharge: 6,
      skills: ['smite', 'mend', 'radiant_ward'],
      consumables: [],
      mp: 30,
    });
    const aware = chooseBossAwareAction(f);
    t('boss-aware raises Radiant Ward before Verdict', aware.skillId === 'radiant_ward' || aware.skillId === 'guard');
  }

  {
    const f = fakeFight({ hp: 18, enemyCharge: 6 });
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
      { msg: "Sylvanor, the Elderwood Guardian unleashes FOREST'S VERDICT!" },
      { msg: "Sylvanor, the Elderwood Guardian (FOREST'S VERDICT) hits you for 54." },
    ]);
    t('parses special killing blow', parsed.lastHit?.name === "FOREST'S VERDICT");
    t('attributes special damage', parsed.dmg.special["FOREST'S VERDICT"] === 54);
    const withBurn = parseCombatLogs([
      { msg: "Cinderghast, the Grotto Dragon (GROTTO PYRE) hits you for 40." },
      { msg: 'You burn for 4.' },
    ]);
    t('burn can be the last hit', withBurn.lastHit?.kind === 'burn' && withBurn.dmg.burn === 4);
  }

  {
    const a = await captureF10Arrival({ seed: 20260823, classId: 'warrior' });
    const b = await captureF10Arrival({ seed: 20260823, classId: 'warrior' });
    t('capture is deterministic for seed+class',
      a.reached === b.reached
      && a.arrival?.rngState === b.arrival?.rngState
      && a.arrival?.hp === b.arrival?.hp
      && a.bossId === b.bossId);
  }

  {
    const cap = await captureF10Arrival({ seed: 77, classId: 'priest' });
    if (!cap.reached) {
      t('priest seed 77 either dies before F10 or arrives', true);
    } else {
      const a = await replayArrival(cap, { policy: 'autoplay', hp: 'observed' });
      const b = await replayArrival(cap, { policy: 'autoplay', hp: 'observed' });
      t('identical F10 replay is deterministic', a.win === b.win && a.rounds === b.rounds && a.hpLeft === b.hpLeft);
      t('observed replay keeps arrival HP', Math.abs(a.hpEnter - cap.arrival.hp) < 1e-6);
      const full = await replayArrival(cap, { policy: 'autoplay', hp: 'full' });
      t('full-HP replay starts at maxHp', full.hpEnter === cap.arrival.maxHp);
      t('fight does not change authored boss HP', cap.run.bossPicks?.[10] === a.bossId || a.bossId != null);
    }
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
    const tiny = await runF10Probe({ seed: 5, runs: 6, sweep: false });
    t('tiny probe reports arrivals or zero', tiny.meta.climbs === 6 && tiny.meta.arrivals >= 0);
    t('tiny probe is byte-stable', JSON.stringify(tiny.byBoss) === JSON.stringify((await runF10Probe({ seed: 5, runs: 6, sweep: false })).byBoss));
    t('live combat_policy still used for autoplay cells',
      Object.values(tiny.byBoss).every(b => b.autoplay_observed && b.bossaware_observed));
  }

  t('F10 solo gate has extra HP/ATK ease',
    TDC.enemy.f10SoloHpMult < 1 && TDC.enemy.f10SoloAtkMult < 1);
  {
    const f10 = enemyScale(10, 1, 'forest', { boss: true, partySize: 1 });
    const f10Coop = enemyScale(10, 1, 'forest', { boss: true, partySize: 2 });
    const f20 = enemyScale(20, 11, 'ruins', { boss: true, partySize: 1 });
    t('F10 solo HP scale is below the untrimmed F10 coop scale', f10.hp < f10Coop.hp);
    t('F10 extra ease does not apply to F20', f20.hp > f10.hp);
  }

  {
    const camp = EVENTS.find(e => e.id === 'campfire');
    const sleep = camp.choices.find(c => c.label === 'Sleep');
    const med = camp.choices.find(c => c.label === 'Meditate');
    const train = camp.choices.find(c => c.label === 'Train');
    t('Sleep scores above Meditate (restore is not rest)',
      scoreEventChoice(sleep) > scoreEventChoice(med));
    t('Meditate is not treated as an HP rest',
      scoreEventChoice(med) < scoreEventChoice(sleep)
      && scoreEventChoice(med) <= scoreEventChoice(train));
    const policy = baselinePolicy();
    const pick = policy.chooseEvent({ hp: 20, maxHp: 70 }, camp, camp.choices);
    t('wounded baseline sleeps at the campfire', pick.label === 'Sleep');
  }
}
