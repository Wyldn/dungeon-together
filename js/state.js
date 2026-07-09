// Run state + permanent meta progression (localStorage).

import { CLASSES } from './data/classes.js';
import { makeRng, randomSeed } from './rng.js';

const META_KEY = 'dt_meta_v1';
const RUN_KEY = 'dt_run_v1';

/* ------------------------- META (permanent) ------------------------- */

export const UPGRADES = [
  { id: 'vitality', name: 'Blood of Heroes', desc: '+8 starting max HP per rank.', max: 5, cost: r => 30 + r * 25 },
  { id: 'fortune', name: 'Inherited Fortune', desc: '+25 starting gold per rank.', max: 5, cost: r => 25 + r * 20 },
  { id: 'clarity', name: 'Tempered Mind', desc: '+8 starting max Sanity per rank.', max: 3, cost: r => 40 + r * 30 },
  { id: 'arcana', name: 'Awakened Arcana', desc: '+6 starting max Mana per rank.', max: 3, cost: r => 35 + r * 25 },
  { id: 'prowess', name: 'Ancestral Prowess', desc: '+1 to all combat stats per rank.', max: 3, cost: r => 60 + r * 50 },
  { id: 'scholarship', name: 'Echoed Lessons', desc: '+10% experience gained per rank.', max: 3, cost: r => 50 + r * 40 },
  { id: 'first_aid', name: 'Field Medicine', desc: 'Start each run with a Healing Potion per rank.', max: 2, cost: r => 45 + r * 35 },
  { id: 'keen_eye', name: 'Keen Eye', desc: '+4% crit chance per rank.', max: 3, cost: r => 55 + r * 45 },
];

export const ACHIEVEMENTS = [
  { id: 'first_blood', icon: '⚔️', name: 'First Blood', desc: 'Win your first battle.' },
  { id: 'floor_10', icon: '🌲', name: 'Out of the Woods', desc: 'Defeat the Elderwood Guardian.' },
  { id: 'floor_20', icon: '👑', name: 'Regicide (Retroactive)', desc: 'Defeat the Lich of the Fallen King.' },
  { id: 'floor_30', icon: '❄️', name: 'Spring, Eventually', desc: 'Defeat Queen Vessalia.' },
  { id: 'floor_40', icon: '🐉', name: 'Grief Counselor', desc: 'Defeat the Grieving Hydra.' },
  { id: 'floor_50', icon: '😈', name: 'The Doorman Tips You', desc: 'Defeat Duke Malgrimm.' },
  { id: 'win', icon: '🏆', name: 'Kingslayer', desc: 'Defeat Vorath, the Demon King.' },
  { id: 'escape', icon: '🌀', name: 'Survivor', desc: 'Take the Coward\'s Gate. The tower counts survivors too.' },
  { id: 'secret', icon: '🜏', name: 'The Interesting Kind', desc: 'Discover the tower\'s truth.' },
  { id: 'rich', icon: '💰', name: 'Dragon Hoard', desc: 'Hold 500 gold at once.' },
  { id: 'legendary', icon: '✨', name: 'One of One', desc: 'Wield a legendary item.' },
  { id: 'mimic', icon: '🦷', name: 'It Bit First', desc: 'Slay a mimic.' },
  { id: 'broke_sane', icon: '🫥', name: 'Held Together by Habit', desc: 'Survive a floor with 5 or less Sanity.' },
  { id: 'all_classes', icon: '🎭', name: 'Full Party', desc: 'Reach floor 10 with all four classes.' },
];

const defaultMeta = () => ({
  shards: 0,
  totalRuns: 0,
  wins: 0,
  bestFloor: 0,
  upgrades: {},
  achievements: [],
  endings: [],
  classFloor10: [],
  seenIntro: false,
});

export function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? { ...defaultMeta(), ...JSON.parse(raw) } : defaultMeta();
  } catch { return defaultMeta(); }
}

export function saveMeta(meta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

export function upgradeRank(meta, id) { return meta.upgrades[id] || 0; }

export function award(meta, achId) {
  if (!meta.achievements.includes(achId)) {
    meta.achievements.push(achId);
    saveMeta(meta);
    return ACHIEVEMENTS.find(a => a.id === achId);
  }
  return null;
}

/* ------------------------- RUN (per-climb) ------------------------- */

export function newRun(meta, classId, name, rolled, seed = randomSeed()) {
  const cls = CLASSES[classId];
  const up = id => upgradeRank(meta, id);

  const maxHp = rolled.hp + up('vitality') * 8;
  const maxMp = rolled.mp + up('arcana') * 6;
  const maxSanity = 60 + up('clarity') * 8;
  const prowess = up('prowess');

  const run = {
    seed,
    rngState: seed,
    floor: 0,
    biomeId: 'forest',
    name,
    classId,
    className: cls.name,
    level: 1,
    xp: 0,
    xpNext: 32,
    skillPoints: 0,
    stats: {
      str: rolled.str + prowess,
      dex: rolled.dex + prowess,
      int: rolled.int + prowess,
      wis: rolled.wis + prowess,
      lk: rolled.lk + prowess,
    },
    maxHp, hp: maxHp,
    maxMp, mp: maxMp,
    maxSanity, sanity: maxSanity,
    gold: 30 + up('fortune') * 25,
    skills: [...cls.startSkills],
    knownSkills: [...cls.startSkills],
    equipment: { weapon: null, armor: 'cloth_garb', accessory: null },
    inventory: [], // unequipped gear (item ids)
    relics: [],
    consumables: ['potion_s'],
    weaponBonus: 0, // from Forgotten Forge upgrades
    flags: {},
    seenEvents: [],
    sigils: [],
    kills: 0,
    goldEarned: 0,
    usedRevive: false,
    revealedFloors: 0,
    over: false,
  };
  for (let i = 0; i < up('first_aid'); i++) run.consumables.push('potion_s');
  return run;
}

export function saveRun(run) {
  // functions never live in run state, so plain JSON is safe
  localStorage.setItem(RUN_KEY, JSON.stringify(run));
}

export function loadRun() {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    if (!raw) return null;
    const run = JSON.parse(raw);
    run.inventory = run.inventory || []; // saves from before the gear bag existed
    if (run.coopMode) return null; // co-op climbs live and die with the party
    return run.over ? null : run;
  } catch { return null; }
}

export function clearRun() { localStorage.removeItem(RUN_KEY); }

// RNG that persists across saves: consume + store position.
export function runRng(run) {
  const rng = makeRng(run.rngState);
  return {
    ...rng,
    // call after a batch of rolls to advance the saved stream
    advance() { run.rngState = Math.floor(rng.next() * 0xFFFFFFFF); },
  };
}
