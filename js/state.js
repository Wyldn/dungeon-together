// Run state + permanent meta progression (localStorage).

import { CLASSES } from './data/classes.js';
import { RACES } from './data/races.js';
import { CONFIG } from './data/config.js';
import { rollGrowthRank } from './data/ranks.js';
import { makeRng, randomSeed } from './rng.js';

const META_KEY = 'dt_meta_v1';
const RUN_KEY = 'dt_run_v2'; // schema v2: fame, races, 8 equip slots, growth

/* ------------------------- META (permanent) ------------------------- */

export const UPGRADES = [
  { id: 'vitality', name: 'Blood of Heroes', desc: '+8 starting max HP per rank.', max: 5, cost: r => 30 + r * 25 },
  { id: 'fortune', name: 'Inherited Fortune', desc: '+25 starting gold per rank.', max: 5, cost: r => 25 + r * 20 },
  { id: 'renown', name: 'Storied Lineage', desc: '+5 starting Fame per rank.', max: 3, cost: r => 40 + r * 30 },
  { id: 'arcana', name: 'Awakened Arcana', desc: '+6 starting max class resource per rank.', max: 3, cost: r => 35 + r * 25 },
  { id: 'prowess', name: 'Ancestral Prowess', desc: '+1 to all combat stats per rank.', max: 3, cost: r => 60 + r * 50 },
  { id: 'scholarship', name: 'Echoed Lessons', desc: '+10% experience gained per rank.', max: 3, cost: r => 50 + r * 40 },
  { id: 'first_aid', name: 'Field Medicine', desc: 'Start each run with a Healing Potion per rank.', max: 2, cost: r => 45 + r * 35 },
  { id: 'keen_eye', name: 'Keen Eye', desc: '+4% crit chance per rank.', max: 3, cost: r => 55 + r * 45 },
  { id: 'tempo', name: 'Veteran\'s Tempo', desc: 'Begin every battle with +1 Battle Charge per rank.', max: 2, cost: r => 70 + r * 60 },
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
  { id: 'famous', icon: '🌟', name: 'Local Legend', desc: 'Reach 50 Fame in a single run.' },
  { id: 'promoted', icon: '🧬', name: 'More Than Blood', desc: 'Achieve a race promotion.' },
  { id: 'secret_class', icon: '🎭', name: 'The Hidden Path', desc: 'Unlock a secret subclass.' },
  { id: 'all_classes', icon: '🎪', name: 'Full Party', desc: 'Reach floor 10 with four different classes.' },
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
  gateSeen: 0, // shorten the gate animation after repeated viewings
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

/* ------------------------- CHARACTER GENERATION ------------------------- */

// Roll hidden starting stats for a class+race. Returns {stats..., percentile}
export function rollStart(classId, raceId, seed = randomSeed()) {
  const cls = CLASSES[classId];
  const race = RACES[raceId] || {};
  const rng = makeRng(seed);
  const r = {};
  let rolled = 0, possible = 0;
  for (const k of ['hp', 'mp', 'str', 'dex', 'int', 'wis', 'lk']) {
    const roll = rng.int(0, cls.roll[k]);
    r[k] = cls.base[k] + roll;
    rolled += roll / Math.max(1, cls.roll[k]);
    possible += 1;
  }
  // race adjustments
  for (const k of ['str', 'dex', 'int', 'wis', 'lk']) if (race.stats?.[k]) r[k] = Math.max(1, r[k] + race.stats[k]);
  r.hp += race.hp || 0;
  r.mp += race.mp || 0;
  const percentile = rolled / possible; // 0..1 within this class's possible range
  const growthRank = rollGrowthRank(rng, percentile);
  return { stats: r, percentile, growthRank, seed };
}

// Vague, non-optimizable descriptor of the START only (growth stays hidden).
export function startDescriptor(percentile) {
  if (percentile < 0.25) return { word: 'Frail', flavor: 'This body has been through lean years. What it will become — who can say.' };
  if (percentile < 0.45) return { word: 'Unremarkable', flavor: 'Nothing about this climber turns heads. The tower has been wrong before.' };
  if (percentile < 0.7) return { word: 'Capable', flavor: 'A sound frame, a steady eye. A fine place to start.' };
  if (percentile < 0.9) return { word: 'Hardy', flavor: 'Strong stock. The first floors will underestimate you briefly.' };
  return { word: 'Exceptional', flavor: 'Even standing still, this one looks like trouble. Potential is another question.' };
}

/* ------------------------- RUN (per-climb) ------------------------- */

export function newRun(meta, { classId, raceId = 'human', originId = null, name, seed = randomSeed() }) {
  const cls = CLASSES[classId];
  const up = id => upgradeRank(meta, id);
  const gen = rollStart(classId, raceId, randomSeed());

  const maxHp = gen.stats.hp + up('vitality') * 8;
  const maxMp = gen.stats.mp + up('arcana') * 6;
  const prowess = up('prowess');

  const run = {
    schema: 2,
    seed,
    rngState: seed,
    floor: 0,
    biomeId: 'forest',
    name,
    classId,
    className: cls.name,
    subclassId: null,
    raceId,
    raceName: RACES[raceId]?.name || 'Human',
    promoted: false,
    originId,
    level: 1,
    xp: 0,
    xpNext: 32,
    // hidden values — never rendered directly (handoff §5)
    growthRank: gen.growthRank,
    startPercentile: gen.percentile,
    underdog: gen.percentile <= CONFIG.chargen.underdogPercentile,
    appraisal: null,
    stats: {
      str: gen.stats.str + prowess,
      dex: gen.stats.dex + prowess,
      int: gen.stats.int + prowess,
      wis: gen.stats.wis + prowess,
      lk: gen.stats.lk + prowess,
    },
    maxHp, hp: maxHp,
    maxMp, mp: maxMp,
    fame: CONFIG.fame.start + up('renown') * 5,
    gold: 30 + up('fortune') * 25,
    skills: [...cls.startSkills],
    knownSkills: [...cls.startSkills],
    equipment: {
      weapon: cls.startWeapon, helmet: null, chest: 'cloth_garb', legs: null, boots: null,
      accessory1: null, accessory2: null, accessory3: null,
    },
    inventory: [],
    relics: [],
    consumables: ['potion_s'],
    weaponBonus: 0,
    flags: {},
    seenEvents: [],
    sigils: [],
    kills: 0,
    guardCount: 0,
    goldEarned: 0,
    usedRevive: false,
    down: false,
    over: false,
    metaStartCharge: up('tempo'),
  };
  for (let i = 0; i < up('first_aid'); i++) run.consumables.push('potion_s');
  return run;
}

export function saveRun(run) {
  localStorage.setItem(RUN_KEY, JSON.stringify(run));
}

export function loadRun() {
  try {
    const raw = localStorage.getItem(RUN_KEY);
    if (!raw) { migrateV1(); return null; }
    const run = JSON.parse(raw);
    if (run.coopMode) return null; // co-op climbs live and die with the party
    return run.over ? null : migrateRun(run);
  } catch { return null; }
}

// v1 runs (sanity era) can't meaningfully continue — retire them gracefully
// but never crash. Meta (shards/achievements) is untouched.
function migrateV1() {
  try { localStorage.removeItem('dt_run_v1'); } catch {}
}

function migrateRun(run) {
  run.inventory = run.inventory || [];
  run.fame = run.fame ?? CONFIG.fame.start;
  run.growthRank = run.growthRank || 'C';
  run.guardCount = run.guardCount || 0;
  run.appraisal = run.appraisal || null;
  run.equipment = {
    weapon: null, helmet: null, chest: null, legs: null, boots: null,
    accessory1: null, accessory2: null, accessory3: null,
    ...run.equipment,
  };
  delete run.sanity; delete run.maxSanity; // sanity is gone (handoff §17)
  return run;
}

export function clearRun() { localStorage.removeItem(RUN_KEY); }

export function runRng(run) {
  const rng = makeRng(run.rngState);
  return {
    ...rng,
    advance() { run.rngState = Math.floor(rng.next() * 0xFFFFFFFF); },
  };
}
