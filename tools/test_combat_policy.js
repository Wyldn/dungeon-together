// Autoplay self-heal / ally-target legality. Does not retune classes or bosses.
import { SKILLS } from '../js/data/skills.js';
import {
  chooseAutoPlayAction, skillCanHealSelf, skillCanHealAlly, pickAutoplayHealTo,
} from '../js/combat_policy.js';

function fakeFight({
  classId = 'priest',
  hp = 18,
  maxHp = 60,
  mp = 36,
  maxMp = 36,
  skills = ['smite', 'mend', 'radiant_ward'],
  consumables = [],
  charge = 2,
  shared = false,
  allies = null,
} = {}) {
  const run = {
    classId,
    raceId: 'human',
    floor: 5,
    hp,
    maxHp,
    mp,
    maxMp,
    skills,
    consumables,
    stats: { str: 4, dex: 4, int: 6, wis: 10, lk: 4 },
    equipment: {},
    relics: [],
    weaponBonus: 0,
    level: 3,
  };
  const enemies = [{ hp: 20, maxHp: 20, atk: 6, name: 'Wolf', charge: 0, specials: [] }];
  return {
    run,
    charge,
    shared,
    allies: allies || new Map(),
    mod: {},
    enemies,
    player: { statuses: {}, buffs: [], partyBuffs: [] },
    skillCDs: {},
    aliveEnemies() { return this.enemies.filter(e => e.hp > 0); },
  };
}

export function runCombatPolicyTests(t) {
  console.log('— autoplay self-heal / ally-target legality —');

  t('Mend is self-legal despite allyTarget', skillCanHealSelf(SKILLS.mend) && skillCanHealAlly(SKILLS.mend));
  t('Mend target is self', SKILLS.mend.target === 'self' && SKILLS.mend.allyTarget === true);
  t('Radiant Ward is not a heal-legality case', !skillCanHealSelf(SKILLS.radiant_ward) && SKILLS.radiant_ward.target === 'self');
  t('Smite cannot heal self', !skillCanHealSelf(SKILLS.smite));
  t('Iron Stance self-heal is legal without allyTarget', skillCanHealSelf(SKILLS.iron_stance) && !skillCanHealAlly(SKILLS.iron_stance));
  t('Benediction and Minor Mend are self-legal', skillCanHealSelf(SKILLS.benediction) && skillCanHealSelf(SKILLS.minor_mend));
  t('Soothing Refrain is self-legal', skillCanHealSelf(SKILLS.soothing_refrain));

  {
    const f = fakeFight({ hp: 18, maxHp: 60, mp: 36, charge: 2, consumables: [] });
    const a = chooseAutoPlayAction(f);
    t('solo low HP may select Mend', a.skillId === 'mend');
    t('solo low HP Mend targets self', a.healTo === 'self');
    t('allyTarget does not reject Mend', a.skillId !== 'smite');
  }

  {
    const f = fakeFight({ hp: 55, maxHp: 60, mp: 36, charge: 2, consumables: [] });
    const a = chooseAutoPlayAction(f);
    t('solo healthy HP does not spam Mend', a.skillId !== 'mend');
    t('solo healthy HP prefers offense', a.skillId === 'smite');
  }

  {
    const f = fakeFight({ hp: 18, maxHp: 60, mp: 10, charge: 2, consumables: [] });
    const a = chooseAutoPlayAction(f);
    t('insufficient MP does not select Mend', a.skillId !== 'mend');
  }

  {
    const f = fakeFight({ hp: 18, maxHp: 60, mp: 36, charge: 0, consumables: [] });
    const a = chooseAutoPlayAction(f);
    t('insufficient charge does not select Mend', a.skillId !== 'mend');
  }

  {
    const allyOnly = {
      id: 'ally_only_test_heal', fx: 'heal', name: 'Ally Only',
      cost: 10, charge: 0, target: 'one', allyTarget: true, healPct: 0.3,
    };
    t('ally-only heal is not self-legal', !skillCanHealSelf(allyOnly) && skillCanHealAlly(allyOnly));
    const f = fakeFight({ hp: 18, maxHp: 60, mp: 36, charge: 2, skills: ['smite', allyOnly.id], consumables: [] });
    SKILLS[allyOnly.id] = allyOnly;
    try {
      const a = chooseAutoPlayAction(f);
      t('autoplay does not self-cast an ally-only heal', a.skillId !== allyOnly.id);
    } finally {
      delete SKILLS[allyOnly.id];
    }
  }

  {
    const allies = new Map([
      ['seat-b', { name: 'Wounded', hp: 8, maxHp: 60, down: false }],
    ]);
    const f = fakeFight({
      hp: 18, maxHp: 60, mp: 36, charge: 2, consumables: [], shared: true, allies,
    });
    const a = chooseAutoPlayAction(f);
    t('co-op low self HP still selects Mend', a.skillId === 'mend');
    t('co-op prefers the lower living ally', a.healTo === 'seat-b');
    t('dead ally is not selected', pickAutoplayHealTo(f, SKILLS.mend) === 'seat-b');
  }

  {
    const allies = new Map([
      ['seat-b', { name: 'Healthy', hp: 58, maxHp: 60, down: false }],
    ]);
    const f = fakeFight({
      hp: 18, maxHp: 60, mp: 36, charge: 2, consumables: [], shared: true, allies,
    });
    const a = chooseAutoPlayAction(f);
    t('co-op heals self when self is lower', a.skillId === 'mend' && a.healTo === 'self');
  }

  {
    const allies = new Map([
      ['seat-b', { name: 'Down', hp: 0, maxHp: 60, down: true }],
    ]);
    const f = fakeFight({
      hp: 18, maxHp: 60, mp: 36, charge: 2, consumables: [], shared: true, allies,
    });
    const a = chooseAutoPlayAction(f);
    t('co-op ignores downed allies', a.skillId === 'mend' && a.healTo === 'self');
  }

  {
    const f = fakeFight({ hp: 18, maxHp: 60, mp: 36, charge: 2, consumables: [] });
    const a = chooseAutoPlayAction(f);
    const b = chooseAutoPlayAction(f);
    t('same state yields the same action', a.skillId === b.skillId && a.healTo === b.healTo);
  }

  {
    const f = fakeFight({
      hp: 50, maxHp: 60, mp: 36, charge: 2, consumables: [],
      skills: ['smite', 'mend', 'radiant_ward'],
    });
    const a = chooseAutoPlayAction(f);
    t('Radiant Ward is not a targeting bug — offense still wins when healthy', a.skillId === 'smite');
  }

  {
    const f = fakeFight({
      hp: 50, maxHp: 60, mp: 36, charge: 6, consumables: [],
      skills: ['smite', 'judgement'],
    });
    f.skillCDs = { judgement: 2 };
    const a = chooseAutoPlayAction(f);
    t('autoplay will not pick a cooling charged skill', a.skillId !== 'judgement');
  }
}
