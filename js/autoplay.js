// Testing harness: per-device Auto-play pref (localStorage — never networked).
// In co-op it only drives this client's votes, loot picks, and combat turns.
// Combat actions are handled inside combat.js (see Fight.autoPlayAct).

import { getAutoPlay, setAutoPlayPref } from './state.js';

let timer = null;
let busyUntil = 0;

export function isAutoPlay() {
  return getAutoPlay();
}

export function setAutoPlay(on) {
  const v = setAutoPlayPref(on);
  syncAutoPlayLoop();
  return v;
}

export function syncAutoPlayLoop() {
  if (isAutoPlay()) startAutoPlayLoop();
  else stopAutoPlayLoop();
}

function startAutoPlayLoop() {
  if (timer) return;
  timer = setInterval(tickAutoPlay, 420);
}

function stopAutoPlayLoop() {
  if (timer) clearInterval(timer);
  timer = null;
  busyUntil = 0;
}

function clickEl(node) {
  if (!node || node.disabled || node.getAttribute('aria-disabled') === 'true') return false;
  if (node.classList?.contains('locked')) return false;
  busyUntil = Date.now() + 280;
  node.click();
  return true;
}

function pauseMenuOpen() {
  for (const m of document.querySelectorAll('.modal-backdrop .modal')) {
    const h = m.querySelector('h3');
    if (h && /pause/i.test(h.textContent || '')) return true;
  }
  return false;
}

function enabled(nodes) {
  return [...nodes].filter(n =>
    n && !n.disabled && n.getAttribute('aria-disabled') !== 'true' && !n.classList.contains('locked'));
}

function pickRandom(arr) {
  if (!arr?.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function textOf(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** True when a choice is basically a no-reward / walk-away option. */
function looksEmpty(t) {
  return /leave empty-handed|empty-handed|walk away|ignore it|refuse|safe\b|pass by|do nothing|nothing here|keep the seal|skip —|skip the exchange|keep in reserve|stay sharp with what you know|leave it for the next|leave a note and move on|kindness|honor\b/.test(t);
}

/** Prefer options that clearly grant something useful. */
function looksRewarding(t) {
  return /fight|face|battle|xp|gold|loot|gear|weapon|armor|relic|technique|skill|blessing|recover|heal|potion|claim|train|scavenge|class |accessory|trinket|charm|stat|fame|growth|boon|supplies|mend|equip|accept the trial|stand together|steel yourself/.test(t);
}

function scoreChoice(el) {
  const t = textOf(el);
  let s = 10;
  if (looksEmpty(t)) s -= 9;
  if (looksRewarding(t)) s += 6;
  if (/⚠|incompatible/.test(t)) s -= 20;
  if (/sneak|bribe|meditate|pray|offer|bet |knock|listen|commission/.test(t)) s += 2;
  return s;
}

/** Random among near-best scores; avoids empty options when anything better exists. */
function pickSmart(buttons) {
  const list = enabled(buttons);
  if (!list.length) return null;
  const scored = list.map(b => ({ b, s: scoreChoice(b) }));
  const best = Math.max(...scored.map(x => x.s));
  let pool = scored.filter(x => x.s >= best - 2);
  // If the best tier is still "empty", but something rewarding exists, use that.
  if (best < 8) {
    const rewarding = scored.filter(x => x.s >= 12 || looksRewarding(textOf(x.b)));
    if (rewarding.length) pool = rewarding;
    else {
      const nonEmpty = scored.filter(x => !looksEmpty(textOf(x.b)));
      if (nonEmpty.length) pool = nonEmpty;
    }
  }
  return pickRandom(pool).b;
}

function isIncompatibleEquip(btn) {
  return /⚠|incompatible with your training/.test(textOf(btn));
}

/**
 * Fallback if a loot modal still appears. Prefer equip; never equip ⚠ weapons.
 * Accessory/best-in-slot swaps are handled in game.js (autoPlayTakeEquipment).
 */
function tryLootAndGear() {
  const equips = enabled(document.querySelectorAll('.pick-option[data-act="equip"]'));
  const stash = enabled(document.querySelectorAll('.pick-option[data-act="stash"]'))[0];
  const sell = enabled(document.querySelectorAll('.pick-option[data-act="sell"]'))[0];
  const accSlots = enabled(document.querySelectorAll('.accessory-slot-pick[data-act="equip"]'));

  if (equips.length || stash || accSlots.length || sell) {
    const compatible = equips.filter(b => !isIncompatibleEquip(b));
    if (compatible.length) return clickEl(compatible[0]);
    if (equips.length && equips.every(isIncompatibleEquip)) {
      return clickEl(sell || stash);
    }
    if (accSlots.length) return clickEl(pickRandom(accSlots));
    if (stash) return clickEl(stash);
  }
  return false;
}

/** Techniques / relics / spoils / subclass — pick a random option, prefer learn/equip over skip. */
function tryRewardPicks() {
  const add = enabled(document.querySelectorAll('.pick-option[data-add]'))[0];
  if (add) return clickEl(add);

  const modal = document.querySelector('.modal-backdrop .modal');
  const heading = textOf(modal?.querySelector('h3'));
  const isRewardModal = /new technique|equip |the gate opens|spoils|relic|choose one|subclass|path of/.test(heading)
    || (modal && modal.querySelector('.pick-option[data-i], .pick-option[data-skip]'));

  if (isRewardModal || document.querySelector('.pick-option[data-i]')) {
    const picks = enabled(document.querySelectorAll('.modal-backdrop .pick-option[data-i], .pick-grid .pick-option[data-i]'));
    // Prefer real picks over Skip / Keep in reserve.
    if (picks.length) return clickEl(pickRandom(picks));
    const skip = enabled(document.querySelectorAll('.pick-option[data-skip]'))[0];
    if (skip) return clickEl(skip);
  }
  return false;
}

function tryPathCards() {
  // Travel map nodes
  if (!document.querySelector('.tm-node.tm-picked, .tm-node.tm-chosen')) {
    const nodes = enabled(document.querySelectorAll('.tm-node'));
    if (nodes.length) return clickEl(pickRandom(nodes));
  }
  // Legacy 3-card deal
  if (!document.querySelector('.pick-card.picked, .pick-card.chosen')) {
    const cards = enabled(document.querySelectorAll('.pick-card[data-i]'));
    if (cards.length) return clickEl(pickRandom(cards));
  }
  return false;
}

function tryEventChoices() {
  const choices = enabled(document.querySelectorAll('.choice-btn'))
    .filter(b => b.id !== 'continue' && b.id !== 'go');
  if (!choices.length) return false;
  return clickEl(pickSmart(choices));
}

function trySoftContinues() {
  for (const b of enabled(document.querySelectorAll('.pick-option[data-close]'))) {
    const v = (b.dataset.close || '').toLowerCase();
    if (v === 'abandon' || v === 'save' || v === 'resume') continue;
    const t = textOf(b);
    if (/abandon|sell it|leave the party/.test(t)) continue;
    if (clickEl(b)) return true;
  }
  return false;
}

function tryMiscPicks() {
  // Path / category / trade / slot choosers — random among enabled.
  for (const sel of [
    '.pick-option[data-c]:not([disabled])',
    '.pick-option[data-id]:not([disabled])',
    '.pick-option[data-trade]:not([disabled])',
    '.pick-option[data-slot]:not([disabled])',
  ]) {
    const opts = enabled(document.querySelectorAll(sel))
      .filter(b => !b.dataset.cancel && textOf(b) !== 'cancel');
    if (opts.length) return clickEl(pickRandom(opts));
  }
  return false;
}

function tickAutoPlay() {
  if (!isAutoPlay() || Date.now() < busyUntil) return;
  if (pauseMenuOpen()) return;
  // Stay off the title / sanctum / history browsers — only drive an active climb.
  if (document.querySelector('.title-screen, .sanctum-screen, .creation-screen')) return;

  // Flow continues first (gates, outcome panels).
  if (clickEl(document.querySelector('#continue:not([disabled])'))) return;
  if (clickEl(document.querySelector('#go:not([disabled])'))) return;

  if (tryLootAndGear()) return;
  if (tryRewardPicks()) return;
  if (trySoftContinues()) return;
  if (tryEventChoices()) return;
  if (tryPathCards()) return;
  if (tryMiscPicks()) return;

  if (clickEl(document.querySelector('#btn-fate-continue:not([disabled])'))) return;
  if (clickEl(document.querySelector('#btn-next:not([disabled])'))) return;
}
