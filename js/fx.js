// Ambient particle canvas — biome-themed weather (embers, snow, leaves,
// spores, dust). Cheap: one rAF loop, ~60 particles, pauses when hidden.

const canvas = document.getElementById('fx-canvas');
const g = canvas.getContext('2d');
let particles = [];
let mode = 'leaves';
let running = false;

const MODES = {
  leaves: { count: 40, color: ['#4a7d3f', '#6d9c4a', '#8a7d3f'], size: [2, 4], vy: [0.25, 0.7], vx: [-0.4, 0.4], sway: true },
  dust:   { count: 50, color: ['#8a7d5f', '#a89c72', '#6b6250'], size: [1, 2.4], vy: [0.06, 0.22], vx: [-0.12, 0.12], twinkle: true },
  snow:   { count: 70, color: ['#cfe4f0', '#ffffff', '#9ec4d9'], size: [1.4, 3.2], vy: [0.35, 0.95], vx: [-0.3, 0.3], sway: true },
  spores: { count: 45, color: ['#7fd95a', '#5f8a3f', '#c9f062'], size: [1.2, 2.6], vy: [-0.28, -0.07], vx: [-0.18, 0.18], twinkle: true },
  embers: { count: 55, color: ['#ff8a3f', '#ffb347', '#c9503a'], size: [1.2, 3], vy: [-1.0, -0.35], vx: [-0.25, 0.25], twinkle: true },
};

function rand(a, b) { return a + Math.random() * (b - a); }

function spawn(cfg, randomY = true) {
  return {
    x: Math.random() * canvas.width,
    y: randomY ? Math.random() * canvas.height : (cfg.vy[0] < 0 ? canvas.height + 6 : -6),
    vy: rand(...cfg.vy), vx: rand(...cfg.vx),
    size: rand(...cfg.size),
    color: cfg.color[Math.floor(Math.random() * cfg.color.length)],
    phase: Math.random() * Math.PI * 2,
    alpha: rand(0.25, 0.8),
  };
}

// Fixed design frame — the canvas lives inside the scaled 1280x720 #frame.
const FRAME_W = 1280, FRAME_H = 720;
function resize() {
  canvas.width = FRAME_W;
  canvas.height = FRAME_H;
}
resize();

// Scale the fixed frame to fit the viewport (letterboxed), centred.
export function fitFrame() {
  const s = Math.min(window.innerWidth / FRAME_W, window.innerHeight / FRAME_H);
  document.documentElement.style.setProperty('--frame-scale', s);
}
window.addEventListener('resize', fitFrame);
fitFrame();

function loop() {
  if (!running) return;
  g.clearRect(0, 0, canvas.width, canvas.height);
  const cfg = MODES[mode];
  const t = performance.now() / 1000;
  for (const p of particles) {
    p.y += p.vy;
    p.x += p.vx + (cfg.sway ? Math.sin(t * 1.4 + p.phase) * 0.35 : 0);
    const a = cfg.twinkle ? p.alpha * (0.55 + 0.45 * Math.sin(t * 2.2 + p.phase)) : p.alpha;
    g.globalAlpha = Math.max(0, a);
    g.fillStyle = p.color;
    g.beginPath();
    g.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    g.fill();
    if (p.y > canvas.height + 8 || p.y < -8 || p.x < -8 || p.x > canvas.width + 8) {
      Object.assign(p, spawn(cfg, false));
    }
  }
  g.globalAlpha = 1;
  requestAnimationFrame(loop);
}

export function setParticles(newMode) {
  if (!MODES[newMode]) newMode = 'dust';
  mode = newMode;
  const cfg = MODES[mode];
  particles = Array.from({ length: cfg.count }, () => spawn(cfg, true));
  if (!running) { running = true; requestAnimationFrame(loop); }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) running = false;
  else if (!running) { running = true; requestAnimationFrame(loop); }
});

export function setBiomeGlow(color) {
  document.documentElement.style.setProperty('--biome-glow', color);
}

export function screenShake() {
  document.getElementById('app').classList.remove('shake');
  void document.getElementById('app').offsetWidth; // restart animation
  document.getElementById('app').classList.add('shake');
}

// Full-frame radial screen-transition flash. Calls swap() at the peak, then
// fades out. Purely local/cosmetic — never gate network sync behind it.
export function flash(swap) {
  const frame = document.getElementById('frame') || document.body;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) { swap && swap(); return; }
  const el = document.createElement('div');
  el.className = 'screen-flash';
  frame.appendChild(el);
  // opacity 0 -> 1 (~0.4s), swap at peak, fade out ~0.08s later, then remove.
  requestAnimationFrame(() => { el.style.opacity = '1'; });
  setTimeout(() => {
    swap && swap();
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 200);
    }, 80);
  }, 400);
}
