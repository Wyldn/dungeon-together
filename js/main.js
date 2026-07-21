import { boot } from './game.js';
import { loadEnemyBoxSettings } from './data/sprite_present.js';

// Unlock the WebAudio context on first interaction (browser autoplay policy).
document.addEventListener('pointerdown', function unlockAudio() {
  document.removeEventListener('pointerdown', unlockAudio);
}, { once: true });

// Load the same JSON the enemy-boxes editor Publishes, then boot.
// Falls back to baked ENEMY_PRESENT if fetch fails (file:// / offline).
loadEnemyBoxSettings().finally(() => boot());
