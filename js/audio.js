// Procedural audio — no asset files. Every sound is synthesized on the fly,
// so the repo stays tiny and load time stays instant.

let ctx = null;
let muted = JSON.parse(localStorage.getItem('dt_muted') || 'false');

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function toggleMute() {
  muted = !muted;
  localStorage.setItem('dt_muted', JSON.stringify(muted));
  return muted;
}
export function isMuted() { return muted; }

function env(gainNode, t, attack, decay, peak = 0.2) {
  gainNode.gain.setValueAtTime(0, t);
  gainNode.gain.linearRampToValueAtTime(peak, t + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone({ freq = 440, type = 'sine', attack = 0.005, decay = 0.15, peak = 0.15, slideTo = null, delay = 0 }) {
  if (muted) return;
  try {
    const a = ac(), t = a.currentTime + delay;
    const osc = a.createOscillator(), g = a.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + attack + decay);
    env(g, t, attack, decay, peak);
    osc.connect(g).connect(a.destination);
    osc.start(t); osc.stop(t + attack + decay + 0.05);
  } catch { /* audio is decorative */ }
}

function noise({ decay = 0.2, peak = 0.12, freq = 1000, delay = 0 }) {
  if (muted) return;
  try {
    const a = ac(), t = a.currentTime + delay;
    const len = a.sampleRate * (decay + 0.05);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf;
    const filter = a.createBiquadFilter(); filter.type = 'bandpass'; filter.frequency.value = freq;
    const g = a.createGain();
    env(g, t, 0.005, decay, peak);
    src.connect(filter).connect(g).connect(a.destination);
    src.start(t);
  } catch { /* decorative */ }
}

export const SFX = {
  click: () => tone({ freq: 620, type: 'triangle', decay: 0.06, peak: 0.07 }),
  cardDeal: () => { noise({ decay: 0.12, freq: 2400, peak: 0.06 }); tone({ freq: 300, type: 'sine', decay: 0.1, peak: 0.05, delay: 0.03 }); },
  hit: () => { noise({ decay: 0.12, freq: 700, peak: 0.16 }); tone({ freq: 160, type: 'sawtooth', decay: 0.12, peak: 0.1 }); },
  crit: () => { noise({ decay: 0.2, freq: 500, peak: 0.2 }); tone({ freq: 90, type: 'sawtooth', decay: 0.25, peak: 0.16 }); tone({ freq: 1200, type: 'square', decay: 0.08, peak: 0.06, delay: 0.02 }); },
  miss: () => noise({ decay: 0.15, freq: 3000, peak: 0.05 }),
  heal: () => { tone({ freq: 520, decay: 0.2, peak: 0.09 }); tone({ freq: 780, decay: 0.25, peak: 0.09, delay: 0.08 }); },
  gold: () => { tone({ freq: 1320, type: 'triangle', decay: 0.1, peak: 0.08 }); tone({ freq: 1760, type: 'triangle', decay: 0.15, peak: 0.07, delay: 0.06 }); },
  levelup: () => [392, 494, 587, 784].forEach((f, i) => tone({ freq: f, type: 'triangle', decay: 0.3, peak: 0.1, delay: i * 0.09 })),
  evolve: () => [262, 330, 392, 523, 659, 784].forEach((f, i) => tone({ freq: f, type: 'triangle', decay: 0.4, peak: 0.09, delay: i * 0.1 })),
  death: () => { tone({ freq: 220, type: 'sawtooth', decay: 0.8, peak: 0.12, slideTo: 55 }); noise({ decay: 0.6, freq: 300, peak: 0.08 }); },
  victory: () => [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', decay: 0.5, peak: 0.1, delay: i * 0.12 })),
  bad: () => tone({ freq: 200, type: 'sawtooth', decay: 0.3, peak: 0.09, slideTo: 120 }),
  sanity: () => tone({ freq: 880, type: 'sine', decay: 0.6, peak: 0.05, slideTo: 440 }),
  bossIntro: () => { tone({ freq: 65, type: 'sawtooth', decay: 1.2, peak: 0.16 }); tone({ freq: 98, type: 'sawtooth', decay: 1.2, peak: 0.12, delay: 0.15 }); noise({ decay: 1, freq: 150, peak: 0.06 }); },
  freeze: () => tone({ freq: 1800, type: 'sine', decay: 0.3, peak: 0.06, slideTo: 2400 }),
  fire: () => noise({ decay: 0.3, freq: 900, peak: 0.1 }),
  unlock: () => [660, 880].forEach((f, i) => tone({ freq: f, type: 'square', decay: 0.12, peak: 0.05, delay: i * 0.08 })),
};
