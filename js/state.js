// Run state + permanent meta progression (localStorage).

import { CLASSES } from './data/classes.js';
import { RACES } from './data/races.js';
import { CONFIG } from './data/config.js';
import { rollGrowthRank } from './data/ranks.js';
import { makeRng, randomSeed } from './rng.js';
import { defaultAppearanceId } from './data/appearances.js';

const META_KEY = 'dt_meta_v1';
const RUN_KEY = 'dt_run_v2'; // schema v2: fame, races, 8 equip slots, growth
const PREFS_KEY = 'dt_prefs_v1';

/* ------------------------- UI PREFS ------------------------- */
const defaultPrefs = () => ({
  combatLaneDivider: true, // vertical bar separating party from the field
});

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...defaultPrefs(), ...JSON.parse(raw) } : defaultPrefs();
  } catch { return defaultPrefs(); }
}

export function savePrefs(prefs) {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export function getCombatLaneDivider() {
  return loadPrefs().combatLaneDivider !== false;
}

export function setCombatLaneDivider(on) {
  const prefs = loadPrefs();
  prefs.combatLaneDivider = !!on;
  savePrefs(prefs);
  return prefs.combatLaneDivider;
}

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
  { id: 'foresight', name: 'Read the Stars', desc: '+1 starting-potential reroll per rank when building a climber.', max: 2, cost: r => 45 + r * 40 },
];

export const ACHIEVEMENTS = [
  { id: 'first_blood', icon: '⚔️', name: 'First Blood', desc: 'Win your first battle.' },
  { id: 'floor_10', icon: '🌲', name: 'Out of the Woods', desc: 'Defeat the Elderwood Guardian.', title: 'the Verdant Wake', titleStyle: 'ts-forest', nameStyle: 'ns-uncommon' },
  { id: 'floor_15', icon: '🗡️', name: 'Ashen Crown', desc: 'Defeat the Crowned Revenant.', title: 'Crownsworn', titleStyle: 'ts-ash', nameStyle: 'ns-rare' },
  { id: 'floor_20', icon: '👑', name: 'Regicide (Retroactive)', desc: 'Defeat the Lich of the Fallen King.', title: "Dynasty's End", titleStyle: 'ts-royal', nameStyle: 'ns-epic' },
  { id: 'floor_30', icon: '❄️', name: 'Spring, Eventually', desc: 'Defeat Queen Vessalia.', title: "Winter's Heresy", titleStyle: 'ts-frost', nameStyle: 'ns-frost' },
  { id: 'floor_40', icon: '🐉', name: 'Grief Counselor', desc: 'Defeat the Grieving Hydra.', title: 'Sorrow Unending', titleStyle: 'ts-grief', nameStyle: 'ns-epic' },
  { id: 'floor_50', icon: '😈', name: 'The Doorman Tips You', desc: 'Defeat Duke Malgrimm.', title: 'the Toll Untaken', titleStyle: 'ts-hell', nameStyle: 'ns-crimson' },
  { id: 'win', icon: '🏆', name: 'Kingslayer', desc: 'Defeat Vorath, the Demon King.', title: "Throne's Last Breath", titleStyle: 'ts-throne', nameStyle: 'ns-legendary' },
  { id: 'escape', icon: '🌀', name: 'Survivor', desc: 'Take the Coward\'s Gate. The tower counts survivors too.', title: 'Who Walked Away', titleStyle: 'ts-escape' },
  { id: 'secret', icon: '🜏', name: 'The Interesting Kind', desc: 'Discover the tower\'s truth.', title: 'Spirewise', titleStyle: 'ts-void', nameStyle: 'ns-wrld' },
  { id: 'rich', icon: '💰', name: 'Dragon Hoard', desc: 'Hold 500 gold at once.' },
  { id: 'legendary', icon: '✨', name: 'One of One', desc: 'Wield a legendary or UNIQUE item.', nameStyle: 'ns-legendary' },
  { id: 'unique_gear', icon: '💠', name: 'Above Legend', desc: 'Claim a UNIQUE — rarer than legendary.', title: 'Once and Never Again', titleStyle: 'ts-unique', nameStyle: 'ns-unique' },
  { id: 'wrld_gear', icon: '🌍', name: 'World\'s Only', desc: 'Claim a WRLD item — one of each in the climb.', title: "the World's Only", titleStyle: 'ts-void', nameStyle: 'ns-wrld' },
  { id: 'mimic', icon: '🦷', name: 'It Bit First', desc: 'Slay a mimic.' },
  { id: 'mimic_survivor', icon: '📦', name: 'Chest Trauma', desc: 'Win a mimic fight while below 30% HP.', title: 'Lidbitten', titleStyle: 'ts-mimic', nameStyle: 'ns-rare' },
  { id: 'npc_duelist', icon: '⚔️', name: 'Honor Duel', desc: 'Win an optional NPC duel.', title: 'Honorbound', titleStyle: 'ts-steel', nameStyle: 'ns-gold' },
  { id: 'party_of_three', icon: '🧑‍🤝‍🧑', name: 'Three\'s Company', desc: 'Enter the tower with a party of three.' },
  { id: 'party_clear_3', icon: '🚩', name: 'Banner Raised', desc: 'Clear a floor with a party of three or more.', title: 'Bannerborn', titleStyle: 'ts-banner', nameStyle: 'ns-rare' },
  { id: 'no_death_5', icon: '💚', name: 'Unbroken Ascent', desc: 'Clear 5 floors in a row without going down.', title: 'the Unfallen', titleStyle: 'ts-vital', nameStyle: 'ns-uncommon' },
  { id: 'famous', icon: '🌟', name: 'Local Legend', desc: 'Reach 50 Fame in a single run.', title: 'Name-Sung', titleStyle: 'ts-fame', nameStyle: 'ns-gold' },
  { id: 'promoted', icon: '🧬', name: 'More Than Blood', desc: 'Achieve a race promotion.' },
  { id: 'secret_class', icon: '🎭', name: 'The Hidden Path', desc: 'Unlock a secret subclass.', title: 'of the Hidden Stair', titleStyle: 'ts-shadow', nameStyle: 'ns-epic' },
  { id: 'all_classes', icon: '🎪', name: 'Full Party', desc: 'Reach floor 10 with four different classes.' },
  { id: 'untouchable', icon: '🌬️', name: 'Untouchable', desc: 'Win a battle without taking a single point of damage.', title: 'Untouched by Steel', titleStyle: 'ts-frost', nameStyle: 'ns-frost' },
  { id: 'overcharged', icon: '⚡', name: 'Overcharged', desc: 'Unleash a 6-charge ultimate technique.' },
  { id: 'guardian', icon: '🛡️', name: 'The Wall', desc: 'Guard 15 times in a single run.', title: 'Living Bastion', titleStyle: 'ts-ward' },
  { id: 'silver_tongue', icon: '👅', name: 'Silver Tongue', desc: 'Bribe your way past 3 encounters in one run.', title: 'Gildtongue', titleStyle: 'ts-tongue', nameStyle: 'ns-gold' },
  { id: 'assessed', icon: '🔍', name: 'Know Thyself (Approximately)', desc: 'Get appraised for the first time.' },
  { id: 'grave_calling', icon: '🦴', name: 'The Tower Shows Its Basement', desc: 'Unlock the hidden Necromancer calling.' },
  { id: 'party_of_four', icon: '👥', name: 'Full Banner', desc: 'Enter the tower with a party of four.', title: 'Fourfold Shadow', titleStyle: 'ts-banner', nameStyle: 'ns-epic' },
  { id: 'hoarder', icon: '🏦', name: 'Economically Unkillable', desc: 'Hold 1,000 gold at once.', title: 'Goldswollen', titleStyle: 'ts-hoard', nameStyle: 'ns-gold' },
];

/** Old title strings → new (saved meta may still hold the previous epithet). */
const TITLE_MIGRATIONS = {
  Woodwalker: 'the Verdant Wake',
  Oathkeeper: 'Crownsworn',
  Kingbreaker: "Dynasty's End",
  Thawbringer: "Winter's Heresy",
  Headcounter: 'Sorrow Unending',
  Gatecrasher: 'the Toll Untaken',
  Kingslayer: "Throne's Last Breath",
  Survivor: 'Who Walked Away',
  Truthseeker: 'Spirewise',
  Singular: 'Once and Never Again',
  Worldbearer: "the World's Only",
  'Mimic-Scarred': 'Lidbitten',
  Duelist: 'Honorbound',
  'Banner-Bearer': 'Bannerborn',
  Unbroken: 'the Unfallen',
  'Local Legend': 'Name-Sung',
  Pathfinder: 'of the Hidden Stair',
  Untouchable: 'Untouched by Steel',
  'The Wall': 'Living Bastion',
  'Silver Tongue': 'Gildtongue',
  'Full Banner': 'Fourfold Shadow',
  Hoarder: 'Goldswollen',
};

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
  equippedTitle: null,
  equippedNameStyle: null,
});

export function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    const meta = raw ? { ...defaultMeta(), ...JSON.parse(raw) } : defaultMeta();
    if (meta.equippedTitle && TITLE_MIGRATIONS[meta.equippedTitle]) {
      meta.equippedTitle = TITLE_MIGRATIONS[meta.equippedTitle];
    }
    return meta;
  } catch { return defaultMeta(); }
}

/** CSS class for a title epithet, if any. */
export function titleStyleFor(title) {
  if (!title) return '';
  return ACHIEVEMENTS.find(a => a.title === title)?.titleStyle || '';
}

export function saveMeta(meta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

export function upgradeRank(meta, id) { return meta.upgrades[id] || 0; }

export function award(meta, achId) {
  if (!meta.achievements.includes(achId)) {
    meta.achievements.push(achId);
    const a = ACHIEVEMENTS.find(x => x.id === achId);
    // Newest cosmetic unlock becomes the equipped default.
    if (a?.title) meta.equippedTitle = a.title;
    if (a?.nameStyle) meta.equippedNameStyle = a.nameStyle;
    saveMeta(meta);
    return a;
  }
  return null;
}

/** Titles / name styles granted by unlocked achievements. */
export function unlockedCosmetics(meta) {
  const titles = [{ id: '', title: 'None' }];
  const styles = [{ id: '', style: '', label: 'Default' }];
  const seenT = new Set();
  const seenS = new Set();
  for (const a of ACHIEVEMENTS) {
    if (!meta.achievements.includes(a.id)) continue;
    if (a.title && !seenT.has(a.title)) {
      seenT.add(a.title);
      titles.push({ id: a.id, title: a.title });
    }
    if (a.nameStyle && !seenS.has(a.nameStyle)) {
      seenS.add(a.nameStyle);
      styles.push({ id: a.id, style: a.nameStyle, label: a.name });
    }
  }
  return { titles, styles };
}

/** HTML for a climber name with optional title + rarity-style color. */
export function climberNameHtml(name, { title = null, nameStyle = null, titleStyle = null } = {}) {
  const esc = s => String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const ts = titleStyle || titleStyleFor(title) || '';
  const t = title
    ? `<span class="climber-title${ts ? ` ${ts}` : ''}">${esc(title)}</span> `
    : '';
  const cls = nameStyle ? `climber-name ${nameStyle}` : 'climber-name';
  return `${t}<span class="${cls}">${esc(name)}</span>`;
}

export function resetSanctumUpgrades(meta) {
  meta.upgrades = {};
  saveMeta(meta);
  return meta;
}

/* ------------------------- CHARACTER GENERATION ------------------------- */

/** Level-up growth multiplier from fate-picked race/class (1.0 = none). */
export function fateGrowthBoost(fateRace, fateClass) {
  const n = (fateRace ? 1 : 0) + (fateClass ? 1 : 0);
  if (n <= 0) return 1;
  if (n === 1) return 1 + (CONFIG.chargen.randomIdentityGrowthOne || 0.03);
  return 1 + (CONFIG.chargen.randomIdentityGrowthBoth || 0.05);
}

/** Display percent for a single fate pick (race or class). */
export function fateGrowthPctOne() {
  return Math.round((CONFIG.chargen.randomIdentityGrowthOne || 0.03) * 100);
}

/** Display percent for the current fate selection. */
export function fateGrowthPct(fateRace, fateClass) {
  return Math.round((fateGrowthBoost(fateRace, fateClass) - 1) * 100);
}

/** Unlocked class ids for the current meta (chargen / lobby randomize). */
export function playableClassIds(meta) {
  return Object.values(CLASSES)
    .filter(c => !c.hidden || c.unlockCond?.(meta))
    .map(c => c.id);
}

export function randomRaceId(rng = makeRng(randomSeed())) {
  return rng.pick(Object.keys(RACES));
}

export function randomClassId(meta, rng = makeRng(randomSeed())) {
  return rng.pick(playableClassIds(meta));
}

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

/** Flat awakening applied once when the player commits to a roll (enter gate / start run).
 *  Idempotent — safe to call from applyGen after an earlier commit-site call. */
export function awakenMonolith(gen, seed = randomSeed()) {
  if (!gen || gen.monolithAwakened) return gen;
  const cfg = CONFIG.chargen;
  const rng = makeRng(seed);
  gen.stats.hp += cfg.awakenHp || 0;
  gen.stats.mp += cfg.awakenMp || 0;
  const pool = rng.shuffle(['str', 'dex', 'int', 'wis', 'lk']);
  const n = Math.min(cfg.awakenStatPicks || 0, pool.length);
  for (let i = 0; i < n; i++) gen.stats[pool[i]] += 1;
  gen.monolithAwakened = true;
  return gen;
}

/* ------------------------- RUN (per-climb) ------------------------- */

export function newRun(meta, { classId, raceId = 'human', originId = null, name, seed = randomSeed(), gen: providedGen = null, fateRace = false, fateClass = false, appearanceId = null } = {}) {
  const opts = { fateRace, fateClass };
  const cls = CLASSES[classId];
  const up = id => upgradeRank(meta, id);
  const gen = providedGen || rollStart(classId, raceId, randomSeed());
  // 3 fixed skills + 1 random from the class pool — rarely (15%), it's the AOE
  const kitRng = makeRng(randomSeed());
  const bonusSkill = cls.pool ? (kitRng.chance(0.15) ? cls.pool.rare : cls.pool.common) : cls.startSkills[0];

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
    appearanceId: appearanceId || defaultAppearanceId(classId),
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
    growthBoost: fateGrowthBoost(opts.fateRace, opts.fateClass),
    fateRace: !!opts.fateRace,
    fateClass: !!opts.fateClass,
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
    skills: [...cls.startSkills, bonusSkill],
    knownSkills: [...cls.startSkills, bonusSkill],
    equipment: {
      weapon: cls.startWeapon, helmet: null, chest: 'cloth_garb', legs: null, boots: null,
      accessory1: null, accessory2: null, accessory3: null,
    },
    inventory: [],
    gearBag: {},
    claimedWrld: [],
    seenEventTags: [],
    relics: [],
    consumables: ['potion_s'],
    weaponBonus: 0,
    flags: {},
    bossPicks: {},
    seenEvents: [],
    recentCategories: [],
    sigils: [],
    kills: 0,
    guardCount: 0,
    bribes: 0,
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
  run.gearBag = run.gearBag || {};
  run.seenEventTags = run.seenEventTags || [];
  run.fame = run.fame ?? CONFIG.fame.start;
  run.growthRank = run.growthRank || 'C';
  run.growthBoost = run.growthBoost || 1;
  run.guardCount = run.guardCount || 0;
  run.appraisal = run.appraisal || null;
  run.recentCategories = run.recentCategories || [];
  run.flags = run.flags || {};
  run.bossPicks = run.bossPicks || {};
  run.appearanceId = run.appearanceId || defaultAppearanceId(run.classId);
  run.foodBuff = run.foodBuff || null;
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
