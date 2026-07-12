// Background music manager. WebAudio so the pack's official loop points play
// seamlessly (intro once, then loop region forever — see xDeviruchi's manual).
// Music: Marllon Silva (xDeviruchi), CC-BY-SA 4.0. See CREDITS.md.

import { MUSIC_TRACKS } from './data/artmap.js';

let ctx = null;
let master = null;
const buffers = new Map();
let current = { key: null, node: null, gain: null };
let pendingKey = null;
let unlocked = false;
let muted = JSON.parse(localStorage.getItem('dt_muted') || 'false');

// user-adjustable music volume (0..1), persisted
let volume = (() => {
  const v = parseFloat(localStorage.getItem('dt_music_vol'));
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.32;
})();

function ensureCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
  }
  return ctx;
}

// browsers block audio until a gesture — queue the request and honor it then
document.addEventListener('pointerdown', () => {
  unlocked = true;
  if (ctx?.state === 'suspended') ctx.resume();
  if (pendingKey) { const k = pendingKey; pendingKey = null; play(k); }
  preloadAll();
}, { capture: true });

async function loadBuffer(key) {
  if (buffers.has(key)) return buffers.get(key);
  const track = MUSIC_TRACKS[key];
  if (!track) return null;
  const promise = fetch(track.f)
    .then(r => r.arrayBuffer())
    .then(ab => ensureCtx().decodeAudioData(ab))
    .catch(() => null);
  buffers.set(key, promise);
  return promise;
}

export async function play(key) {
  if (!MUSIC_TRACKS[key]) return;
  if (current.key === key) return;
  if (!unlocked) { pendingKey = key; return; }
  ensureCtx();
  if (ctx.state === 'suspended') { try { await ctx.resume(); } catch { pendingKey = key; return; } }

  const buf = await loadBuffer(key);
  if (!buf) return;
  if (current.key === key) return; // a faster call won the race
  stop(0.6);

  const track = MUSIC_TRACKS[key];
  const node = ctx.createBufferSource();
  node.buffer = buf;
  node.loop = true;
  if (track.le > track.ls) {
    node.loopStart = track.ls;
    node.loopEnd = Math.min(track.le, buf.duration);
  }
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.8);
  node.connect(gain).connect(master);
  node.start();
  current = { key, node, gain };
}

export function stop(fade = 0.6) {
  if (!current.node) { current.key = null; return; }
  const { node, gain } = current;
  try {
    gain.gain.cancelScheduledValues(ctx.currentTime);
    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
    node.stop(ctx.currentTime + fade + 0.05);
  } catch { /* already stopped */ }
  current = { key: null, node: null, gain: null };
}

// follows the same persisted flag as SFX (audio.js toggleMute writes it)
export function syncMute() {
  muted = JSON.parse(localStorage.getItem('dt_muted') || 'false');
  if (master) master.gain.value = muted ? 0 : 1;
}

export function setVolume(v) {
  volume = Math.max(0, Math.min(1, v));
  localStorage.setItem('dt_music_vol', String(volume));
  if (current.gain && ctx) {
    current.gain.gain.cancelScheduledValues(ctx.currentTime);
    current.gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.15);
  }
}

export function getVolume() { return volume; }

// warm every track in the background so scene changes never hitch on
// fetch + decode (the source of load-stutter on the live server)
let preloaded = false;
export function preloadAll() {
  if (preloaded || !unlocked) return;
  preloaded = true;
  const keys = [...new Set(Object.keys(MUSIC_TRACKS))];
  let i = 0;
  const next = () => {
    if (i >= keys.length) return;
    loadBuffer(keys[i++]).finally(() => setTimeout(next, 400));
  };
  setTimeout(next, 1500); // let the first requested track win the race
}

export const Music = { play, stop, syncMute, setVolume, getVolume, preloadAll };
