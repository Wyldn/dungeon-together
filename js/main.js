import { boot } from './game.js';

// Unlock the WebAudio context on first interaction (browser autoplay policy).
document.addEventListener('pointerdown', function unlockAudio() {
  document.removeEventListener('pointerdown', unlockAudio);
}, { once: true });

boot();
