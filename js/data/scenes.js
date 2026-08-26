// Named pixel-art stills for cards, combat bleed, title, and travel.
// Pairing is story-first: floor bands change inside a biome; named events
// and origins can override. BIOME_BG in artmap.js stays the fallback.

const DIR = 'assets/img/bg/scenes';

function still(file, position = 'center 42%', scale = 1.12) {
  return { url: `${DIR}/${file}`, position, scale };
}

/** Curated stills. Crop/scale are for #combat-bleed and card-art cover. */
export const SCENES = {
  lamora_sunset: still('lamora_sunset.jpg', 'center 38%', 1.08),
  night_castle: still('night_castle.jpg', 'center 40%', 1.1),
  forest_path: still('forest_path.jpg', 'center 48%', 1.18),
  forest_garden: still('forest_garden.jpg', 'center 55%', 1.1),
  forest_bridge: still('forest_bridge.jpg', 'center 58%', 1.08),
  swamp_bayou: still('swamp_bayou.jpg', 'center 62%', 1.1),
  frost_range: still('frost_range.jpg', 'center 40%', 1.08),
  frost_road: still('frost_road.jpg', 'center 55%', 1.12),
  town_canal: still('town_canal.jpg', 'center 45%', 1.08),
  town_street: still('town_street.jpg', 'center 48%', 1.08),
  ocean_sunrise: still('ocean_sunrise.jpg', 'center 42%', 1.06),
  mountain_vista: still('mountain_vista.jpg', 'center 35%', 1.08),
  coastal_fortress: still('coastal_fortress.jpg', 'center 40%', 1.2),
  tower_overlook: still('tower_overlook.jpg', 'center 42%', 1.08),
  mountain_cabin: still('mountain_cabin.jpg', 'center 42%', 1.08),
  forest_farm: still('forest_farm.jpg', 'center 50%', 1.08),
  forest_pines: still('forest_pines.jpg', 'center 58%', 1.1),
  forest_meadow: still('forest_meadow.jpg', 'center 55%', 1.1),
  forest_hill: still('forest_hill.jpg', 'center 50%', 1.1),
  forest_tree: still('forest_tree.jpg', 'center 48%', 1.1),
  forest_valley: still('forest_valley.jpg', 'center 40%', 1.08),
  forest_skyfield: still('forest_skyfield.jpg', 'center 45%', 1.08),
  forest_canopy: still('forest_canopy.jpg', 'center 55%', 1.22),
  frost_woods: still('frost_woods.jpg', 'center 50%', 1.12),
  frost_birch: still('frost_birch.jpg', 'center 48%', 1.12),
  frost_pass: still('frost_pass.jpg', 'center 45%', 1.1),
  sunny_castle: still('sunny_castle.jpg', 'center 32%', 1.06),
  sunny_gate: still('sunny_gate.jpg', 'center 35%', 1.06),
  sunny_keep: still('sunny_keep.jpg', 'center 32%', 1.06),
  cloud_dusk: still('cloud_dusk.jpg', 'center 40%', 1.06),
  school_classroom: still('school_classroom.jpg', 'center 48%', 1.06),
  school_library: still('school_library.jpg', 'center 45%', 1.06),
  school_hall: still('school_hall.jpg', 'center 45%', 1.06),
  school_commons: still('school_commons.jpg', 'center 48%', 1.06),
  school_greenhouse: still('school_greenhouse.jpg', 'center 50%', 1.06),
  school_building: still('school_building.jpg', 'center 40%', 1.06),
  school_office: still('school_office.jpg', 'center 45%', 1.06),
  school_potions: still('school_potions.jpg', 'center 50%', 1.06),
  school_pool: still('school_pool.jpg', 'center 55%', 1.06),
  horiz_rocks: still('horiz_rocks.jpg', 'center 55%', 1.14),
  horiz_pines: still('horiz_pines.jpg', 'center 50%', 1.14),
  horiz_ground: still('horiz_ground.jpg', 'center 58%', 1.14),
  cave_ruins: still('cave_ruins.jpg', 'center 48%', 1.16),
  hill_layers: still('hill_layers.jpg', 'center 55%', 1.2),
};

export const TITLE_SCENE = 'lamora_sunset';
export const TRAVEL_SCENE = 'mountain_vista';

const BIOME_INTRO = {
  forest: 'forest_path',
  ruins: 'coastal_fortress',
  frost: 'frost_range',
  swamp: 'swamp_bayou',
  hell: 'night_castle',
  throne: 'lamora_sunset',
};

const BOSS_FLOOR = {
  10: 'forest_canopy',
  15: 'sunny_keep',
  20: 'coastal_fortress',
  30: 'frost_range',
  40: 'swamp_bayou',
  50: 'lamora_sunset',
  51: 'lamora_sunset',
};

/** Inclusive floor bands. First match wins. */
const FLOOR_BANDS = [
  { lo: 1, hi: 1, id: 'forest_path' },
  { lo: 2, hi: 2, id: 'forest_garden' },
  { lo: 3, hi: 3, id: 'forest_meadow' },
  { lo: 4, hi: 4, id: 'forest_bridge' },
  { lo: 5, hi: 5, id: 'forest_pines' },
  { lo: 6, hi: 6, id: 'forest_farm' },
  { lo: 7, hi: 8, id: 'night_castle' },
  { lo: 9, hi: 9, id: 'forest_tree' },
  { lo: 10, hi: 10, id: 'forest_canopy' },
  { lo: 11, hi: 12, id: 'coastal_fortress' },
  { lo: 13, hi: 14, id: 'cave_ruins' },
  { lo: 15, hi: 15, id: 'sunny_keep' },
  { lo: 16, hi: 17, id: 'school_hall' },
  { lo: 18, hi: 19, id: 'cave_ruins' },
  { lo: 20, hi: 20, id: 'sunny_castle' },
  { lo: 21, hi: 23, id: 'frost_range' },
  { lo: 24, hi: 26, id: 'frost_road' },
  { lo: 27, hi: 28, id: 'frost_woods' },
  { lo: 29, hi: 29, id: 'frost_birch' },
  { lo: 30, hi: 30, id: 'frost_range' },
  { lo: 31, hi: 32, id: 'forest_bridge' },
  { lo: 33, hi: 40, id: 'swamp_bayou' },
  { lo: 41, hi: 44, id: 'night_castle' },
  { lo: 45, hi: 47, id: 'cave_ruins' },
  { lo: 48, hi: 49, id: 'cloud_dusk' },
  { lo: 50, hi: 50, id: 'lamora_sunset' },
  { lo: 51, hi: 51, id: 'lamora_sunset' },
];

const BIOME_DEFAULT = {
  forest: 'forest_path',
  ruins: 'coastal_fortress',
  frost: 'frost_range',
  swamp: 'swamp_bayou',
  hell: 'night_castle',
  throne: 'lamora_sunset',
  title: 'lamora_sunset',
  travelmap: 'mountain_vista',
};

export const ORIGIN_SCENES = {
  mage_academy: 'school_classroom',
  sword_academy: 'sunny_gate',
  mercenary: 'town_street',
  guild: 'town_canal',
  temple: 'school_commons',
  streets: 'town_street',
  ranger_lodge: 'mountain_cabin',
  circus: 'town_canal',
  forge: 'school_potions',
  archive: 'school_library',
};

export const EVENT_SCENES = {
  wounded_adventurer: 'forest_path',
  fey_bargain: 'forest_garden',
  bandit_toll: 'forest_bridge',
  beehive: 'forest_tree',
  ancient_tree: 'forest_canopy',
  wolf_ambush: 'forest_pines',
  slime_crown: 'forest_meadow',
  orc_logging_camp: 'forest_farm',
  campfire: 'mountain_cabin',
  merchant: 'town_street',
  void_stare: 'cave_ruins',
  buried_library: 'school_library',
  royal_crypt: 'cave_ruins',
  trapped_corridor: 'cave_ruins',
  ghost_king: 'coastal_fortress',
  cursed_statue: 'sunny_keep',
  old_battlefield: 'horiz_ground',
  forgotten_forge: 'school_potions',
  frozen_library: 'frost_woods',
  frozen_climber: 'frost_road',
  ice_garden: 'frost_birch',
  warm_hearth: 'mountain_cabin',
  avalanche: 'frost_range',
  witch_hut: 'swamp_bayou',
  sunken_bell: 'swamp_bayou',
  bog_barter: 'swamp_bayou',
  cowards_gate: 'ocean_sunrise',
  last_rest: 'school_hall',
  slag_patrol: 'horiz_rocks',
  chained_angel: 'cloud_dusk',
  river_of_fire: 'cloud_dusk',
  ash_pilgrims: 'night_castle',
  academy_recruiter: 'school_building',
  proving_hall: 'sunny_gate',
  training_grounds: 'school_classroom',
  crimson_stranger: 'night_castle',
};

function sceneOf(id) {
  if (!id) return null;
  return SCENES[id] || null;
}

function bandForFloor(floor) {
  const n = Number(floor) || 0;
  for (const b of FLOOR_BANDS) {
    if (n >= b.lo && n <= b.hi) return b.id;
  }
  return null;
}

/**
 * @param {object} ctx
 * @param {'title'|'origin'|'biome_intro'|'travel'|'event'|'combat'|'rest'|'shop'|'boss'|'victory'} [ctx.kind]
 * @param {string} [ctx.biomeId]
 * @param {number} [ctx.floor]
 * @param {string} [ctx.eventId]
 * @param {string} [ctx.originId]
 * @param {string} [ctx.bossId]
 * @param {string} [ctx.bg] explicit scene id (event.bg / origin.bg)
 */
export function resolveScene(ctx = {}) {
  const kind = ctx.kind || 'combat';
  const explicit = ctx.bg || (ctx.eventId && EVENT_SCENES[ctx.eventId]) || null;

  if (kind === 'title') return sceneOf(TITLE_SCENE);
  if (kind === 'travel') return sceneOf(TRAVEL_SCENE);
  if (kind === 'victory') return sceneOf('lamora_sunset');

  if (kind === 'origin') {
    return sceneOf(ctx.bg || ORIGIN_SCENES[ctx.originId] || 'town_canal');
  }

  if (kind === 'shop') {
    return sceneOf(explicit || 'town_street');
  }

  if (kind === 'rest') {
    return sceneOf(explicit || EVENT_SCENES.campfire || 'mountain_cabin');
  }

  if (kind === 'biome_intro') {
    return sceneOf(BIOME_INTRO[ctx.biomeId] || bandForFloor(ctx.floor) || BIOME_DEFAULT[ctx.biomeId]);
  }

  if (kind === 'boss') {
    const floorId = BOSS_FLOOR[ctx.floor];
    return sceneOf(explicit || floorId || bandForFloor(ctx.floor) || BIOME_DEFAULT[ctx.biomeId]);
  }

  if (kind === 'event' && explicit) return sceneOf(explicit);

  const band = bandForFloor(ctx.floor);
  if (band) return sceneOf(band);
  return sceneOf(BIOME_DEFAULT[ctx.biomeId] || 'forest_path');
}

export function listedScenes() {
  return Object.entries(SCENES).map(([id, rec]) => ({ id, ...rec }));
}
