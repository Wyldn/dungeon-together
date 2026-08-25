import { CONFIG } from './data/config.js';
import { biomeForFloor, BOSSES, pickBossForFloor } from './data/enemies.js';
import { heal, restoreMana, relicItems } from './character.js';
import { runRng } from './state.js';
import { packOnFloorAdvance } from './content_pack/world_bind.js';

const BOSS_FLOORS = Object.keys(BOSSES).map(Number);

/** HP/MP floor breath. No RNG. */
export function applyFloorBreath(run) {
  heal(run, run.maxHp * CONFIG.recovery.floorHealPct);
  restoreMana(run, run.maxMp * CONFIG.recovery.floorManaPct);
}

export function tickFoodBuff(run) {
  if (run.foodBuff?.floorsLeft != null) {
    run.foodBuff.floorsLeft -= 1;
    if (run.foodBuff.floorsLeft <= 0) run.foodBuff = null;
  }
}

export function applyLowHpRelic(run) {
  const relics = relicItems(run);
  const lowHeal = relics.find(r => r.lowHpHeal);
  if (lowHeal && run.hp / run.maxHp < 0.3) {
    heal(run, run.maxHp * lowHeal.lowHpHeal);
  }
}

/** Live nextFloor boss preview — pickBossForFloor does not advance. */
export function previewUpcomingBoss(run) {
  const biome = biomeForFloor(run.floor);
  const upcomingBoss = BOSS_FLOORS.find(f => f >= run.floor && biomeForFloor(f).id === biome.id);
  if (upcomingBoss) pickBossForFloor(upcomingBoss, runRng(run), run);
}

export function enterNextFloor(run) {
  const prevBiome = run.biomeId;
  run.floor++;
  const biome = biomeForFloor(run.floor);
  run.biomeId = biome.id;
  if (run.down) {
    run.down = false;
    run.safeFloorStreak = 0;
    run.hp = Math.max(1, Math.round(run.maxHp * CONFIG.death.respawnHpPct));
    run.mp = Math.round(run.maxMp * CONFIG.death.respawnResourcePct);
  } else if (run.floor > 1) {
    run.safeFloorStreak = (run.safeFloorStreak || 0) + 1;
  }
  applyFloorBreath(run);
  tickFoodBuff(run);
  applyLowHpRelic(run);
  previewUpcomingBoss(run);
  packOnFloorAdvance(run, { prevBiome });
  return biome;
}
