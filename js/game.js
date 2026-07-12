// Game orchestrator: screens, floor flow, three-card draws, event resolution,
// character creation (race → class → origin), co-op decisions, endings.

import { CLASSES, SUBCLASSES, RANDOM_NAMES, subclassOptions } from './data/classes.js';
import { RACES, applyRacePromotion } from './data/races.js';
import { ORIGINS, originById } from './data/origins.js';
import { SKILLS } from './data/skills.js';
import { BIOMES, biomeForFloor, ENEMIES, BOSSES, MODIFIERS } from './data/enemies.js';
import { EVENTS, CATEGORY_META, drawEvent } from './data/events.js';
import { CONFIG } from './data/config.js';
import { rankFor } from './data/ranks.js';
import { CONSUMABLES, itemById, rollEquipment, rollRelic, EQUIP_SLOTS } from './data/items.js';
import { loadMeta, saveMeta, upgradeRank, award, UPGRADES, ACHIEVEMENTS, newRun, saveRun, loadRun, clearRun, runRng, rollStart, startDescriptor } from './state.js';
import { derived, classTitle, skillTier, gainXp, learnableSkills, heal, restoreMana, relicItems, equippedItems, changeFame, resourceName, appraiseRun, revealLevel, applySubclass as applySubclassFn, APPRAISABLE, allowedWeaponTypes, weaponCompatible } from './character.js';
import { startCombat, buildEnemy } from './combat.js';
import { ICONS } from './icons.js';
import { SFX, toggleMute, isMuted } from './audio.js';
import { setParticles, setBiomeGlow, flash } from './fx.js';
import { mountCrystal } from './crystal.js';
import { renderTravelMap, resetTravelTrail } from './travelmap.js';
import { app, el, toast, modal, modalCustom, bar, rarityClass } from './ui.js';
import { makeRng, randomSeed } from './rng.js';
import { defaultServerUrl, isMixedContentBlocked, PUBLIC_GAME_URL } from './net.js';
import { CoopSession, connectCoop } from './coop.js';
import { Music } from './music.js';
import { heroSpriteHtml, itemIconHtml, biomeBgUrl, titleBgUrl } from './art.js';

let meta = loadMeta();
let run = null;
let coopS = null; // CoopSession | null — null means solo

const sleep = ms => new Promise(r => setTimeout(r, ms));
const BOSS_FLOORS = Object.keys(BOSSES).map(Number);
const BIOME_MUSIC = { forest: 'forest', ruins: 'ruins', frost: 'frost', swamp: 'swamp', hell: 'hell', throne: 'boss' };

// pixel backdrop behind every card-art panel for the current biome
function applyCardBg(stage) {
  const elx = stage?.querySelector?.('.card-art');
  const bg = run && biomeBgUrl(run.biomeId);
  if (elx && bg) { elx.classList.add('has-bg'); elx.style.backgroundImage = `url('${bg}')`; }
}
const LAST_FLOOR = 51;

/* ============================================================
   TITLE
   ============================================================ */
export function boot() {
  setParticles('dust');
  setBiomeGlow('#3f3a58');
  if (devJump()) return;
  titleScreen();
}

// Local-only dev nav (?dev=combat|creation|sheet|map|appraisal) — never ships UI.
function devJump() {
  const p = new URLSearchParams(location.search).get('dev');
  if (!p) return false;
  meta = loadMeta();
  run = newRun(meta, { classId: 'archer', raceId: 'human', originId: ORIGINS[0]?.id, name: 'Elba' });
  run.floor = 1;
  setBiomeGlow('#3f7d4a'); setParticles('leaves');
  if (p === 'creation' || p === 'appraisal') { creationFlow(); return true; }
  if (p === 'sheet') { appraiseRun(runRng(run), run, { partial: false }); floorChrome(); characterSheet(); return true; }
  if (p === 'combat') {
    const biome = biomeForFloor(1);
    const stage = floorChrome();
    const specs = (ENEMIES[biome.id] || []).filter(e => !e.elite).slice(0, 1);
    fightGroup(stage, specs, { text: 'A wild foe erupts from the brush!' });
    return true;
  }
  if (p === 'map') { enterFloorScreen(true); return true; }
  return false;
}

function titleScreen() {
  const saved = loadRun();
  app.innerHTML = '';
  app.appendChild(el(`
    <div class="screen title-screen">
      ${titleBgUrl() ? `<img class="title-vista" src="${titleBgUrl()}" alt="" />` : '<div class="title-tower">🗼</div>'}
      <h1 class="game-title">DUNGEON<br/>TOGETHER</h1>
      <p class="game-subtitle">Fifty-one floors. One throne. Every choice is a card, and the tower always deals first.</p>
      <div class="title-menu">
        ${saved ? `<button class="btn primary" id="btn-continue">Continue — Floor ${saved.floor} · ${saved.name}</button>` : ''}
        <button class="btn ${saved ? '' : 'primary'}" id="btn-new">New Climb</button>
        <button class="btn" id="btn-coop">⚔ Play Together</button>
        <button class="btn" id="btn-sanctum">The Sanctum ◈ ${meta.shards}</button>
        <button class="btn ghost" id="btn-mute">${isMuted() ? '🔇 Sound Off' : '🔊 Sound On'}</button>
        <div class="audio-row">
          <span id="vol-icon">🎵</span>
          <input type="range" id="vol-slider" class="vol-slider" min="0" max="100" value="${Math.round(Music.getVolume() * 100)}" aria-label="Music volume" />
          <span id="vol-val" class="vol-val">${Math.round(Music.getVolume() * 100)}</span>
        </div>
      </div>
      <div class="title-stats">
        <span>Runs: <b>${meta.totalRuns}</b></span>
        <span>Victories: <b>${meta.wins}</b></span>
        <span>Best Floor: <b>${meta.bestFloor}</b></span>
      </div>
      <div class="title-footer">A CO-OP ROGUELIKE CARD-CRAWLER · MUSIC BY XDEVIRUCHI · ART: PIXELFLUSH + ORIGINAL</div>
    </div>`));

  document.getElementById('btn-new').onclick = () => {
    SFX.click();
    if (saved && !confirm('Abandon the current climb? Your climber will not be remembered kindly.')) return;
    clearRun(); run = null;
    flash(() => creationFlow());
  };
  if (saved) document.getElementById('btn-continue').onclick = () => { SFX.click(); run = saved; enterFloorScreen(); };
  document.getElementById('btn-coop').onclick = () => { SFX.click(); coopMenu(); };
  document.getElementById('btn-sanctum').onclick = () => { SFX.click(); sanctumScreen(); };
  document.getElementById('btn-mute').onclick = e => { const m = toggleMute(); Music.syncMute(); e.target.textContent = m ? '🔇 Sound Off' : '🔊 Sound On'; };
  wireVolumeSlider(document.getElementById('vol-slider'), document.getElementById('vol-val'));
  Music.play('title');
}

// Shared music-volume slider wiring (title + pause). Live-updates the playing
// track and persists via Music.setVolume.
function wireVolumeSlider(slider, valEl) {
  if (!slider) return;
  const paint = () => slider.style.setProperty('--vp', slider.value + '%');
  paint();
  slider.oninput = () => {
    const v = +slider.value;
    Music.setVolume(v / 100);
    if (valEl) valEl.textContent = v;
    paint();
  };
}

/* ============================================================
   SANCTUM — permanent upgrades + achievements
   ============================================================ */
function sanctumScreen() {
  app.innerHTML = '';
  const scr = el(`<div class="screen">
    <div class="sanctum-header">
      <div><h2>The Sanctum</h2><p style="color:var(--ink-dim);font-style:italic">Where dead climbers' experience becomes the next climber's edge.</p></div>
      <div style="display:flex;gap:14px;align-items:center">
        <span class="shard-count">◈ ${meta.shards} Soul Shards</span>
        <button class="btn small" id="btn-back">← Back</button>
      </div>
    </div>
    <div class="upgrade-grid" id="upgrades"></div>
    <div class="divider"></div>
    <h3 style="margin:10px 0">Deeds &amp; Records</h3>
    <div class="achievement-list" id="achs"></div>
  </div>`);
  app.appendChild(scr);

  const grid = scr.querySelector('#upgrades');
  for (const up of UPGRADES) {
    const rank = upgradeRank(meta, up.id);
    const maxed = rank >= up.max;
    const cost = up.cost(rank);
    const card = el(`<div class="panel upgrade-card ${maxed ? 'maxed' : ''}">
      <h4>${up.name}</h4>
      <div class="up-desc">${up.desc}</div>
      <div class="up-level">${'●'.repeat(rank)}${'○'.repeat(up.max - rank)} &nbsp; Rank ${rank}/${up.max}</div>
      <button class="btn small ${maxed ? '' : 'primary'}" ${maxed || meta.shards < cost ? 'disabled' : ''}>
        ${maxed ? 'Mastered' : `Empower — ◈ ${cost}`}
      </button>
    </div>`);
    card.querySelector('button').onclick = () => {
      if (meta.shards < cost) return;
      meta.shards -= cost;
      meta.upgrades[up.id] = rank + 1;
      saveMeta(meta);
      SFX.levelup();
      toast(`${up.name} → Rank ${rank + 1}`);
      sanctumScreen();
    };
    grid.appendChild(card);
  }

  const achList = scr.querySelector('#achs');
  for (const a of ACHIEVEMENTS) {
    const got = meta.achievements.includes(a.id);
    achList.appendChild(el(`<div class="achievement ${got ? '' : 'locked'}">
      <div class="ach-icon">${a.icon}</div>
      <div><div class="ach-name">${a.name}</div><div class="ach-desc">${got ? a.desc : '???'}</div></div>
    </div>`));
  }
  scr.querySelector('#btn-back').onclick = () => { SFX.click(); titleScreen(); };
}

/* ============================================================
   CHARACTER CREATION: race → class → origin → name (handoff §6, §22, §23)
   ============================================================ */
// Deliberately WIDE flavor band (NOT the real hidden rank) for the Monolith.
const RANK_ASC = ['F', 'E', 'D', 'C', 'B', 'A', 'S', 'EX', 'WRLD'];
function potentialBand(percentile) {
  const center = 3 + Math.round((percentile ?? 0.5) * 3); // C..S-ish center
  // width varies: sometimes tight (B–A), sometimes wide (C–EX)
  const loOff = Math.floor(Math.random() * 4); // 0..3
  const hiOff = Math.floor(Math.random() * 4); // 0..3
  let lo = Math.max(0, center - loOff);
  let hi = Math.min(RANK_ASC.length - 1, center + hiOff);
  if (hi <= lo) { if (hi < RANK_ASC.length - 1) hi = lo + 1; else lo = hi - 1; } // guarantee a span
  return { low: RANK_ASC[lo], high: RANK_ASC[hi] };
}

function creationFlow(coopContext = null) {
  const pick = { raceId: 'human', classId: 'warrior', originId: ORIGINS[0].id };
  let step = 0; // 0 race, 1 class, 2 origin, 3 name
  let rerolls = 0;
  let gen = null;
  let appraised = false;      // has the Monolith crystal been charged?
  let crystalCtl = null;
  let apprBand = null;        // the revealed potential band (computed once per roll)

  function maxRerolls() { return CONFIG.chargen.rerolls + (RACES[pick.raceId].extraReroll || 0); }

  function render() {
    if (crystalCtl) { crystalCtl.destroy(); crystalCtl = null; }
    app.innerHTML = '';
    const steps = ['Bloodline', 'Calling', 'Origin', 'The Name'];
    const scr = el(`<div class="screen">
      <div class="select-header">
        <h2>${steps[step]}</h2>
        <p id="step-sub"></p>
        <div class="step-dots">${steps.map((_, i) => `<span class="fdot ${i === step ? 'on' : i < step ? 'done' : ''}"></span>`).join('')}</div>
      </div>
      <div id="step-body"></div>
      <div style="display:flex;justify-content:center;gap:10px;margin-top:18px">
        ${step > 0 ? '<button class="btn small" id="btn-prev">← Back</button>' : '<button class="btn ghost small" id="btn-title">← Title</button>'}
        <button class="btn primary" id="btn-next">${step === 3 ? 'Approach the Gate' : 'Continue →'}</button>
      </div>
    </div>`);
    app.appendChild(scr);
    const body = scr.querySelector('#step-body');
    const sub = scr.querySelector('#step-sub');

    if (step === 0 || step === 1 || step === 2) {
      // Handoff §2: sliding rail + centre showcase + side text box.
      const isClass = step === 1;
      const isOrigin = step === 2;
      sub.textContent = isClass
        ? 'Six callings. What you\'re truly made of, you\'ll discover on the way up.'
        : isOrigin
          ? 'Where were you, the day before the tower? Origins are lived, not listed — yours plays out at the gate.'
          : 'Four peoples climb. The tower does not care which — but the tower is often wrong about what matters.';
      const RACE_TAG = { human: 'ADAPTABLE', elf: 'ARCANE', orc: 'BRUTAL', dwarf: 'ENDURING' };
      const ORIGIN_TAG = { mage_academy: 'SCHOLAR', sword_academy: 'DUELIST', mercenary: 'SELLSWORD', guild: 'LICENSED', temple: 'DEVOUT', streets: 'OUTLAW' };
      const list = isOrigin ? ORIGINS : Object.values(isClass ? CLASSES : RACES);
      const key = isClass ? 'classId' : isOrigin ? 'originId' : 'raceId';
      const selectable = it => isClass ? !(it.hidden && !(it.unlockCond?.(meta))) : true;
      const accentOf = it => isClass ? it.accent : isOrigin ? '#8fd8cc' : '#e8b64a';
      const tagOf = it => isClass ? it.resource.name.toUpperCase() : isOrigin ? (ORIGIN_TAG[it.id] || 'ORIGIN') : (RACE_TAG[it.id] || 'CLIMBER');
      const blurbOf = it => isClass ? it.epithet : it.blurb;
      const emblemOf = it => isOrigin ? (it.name.replace(/^The\s+/i, '')[0] || it.name[0]) : it.name[0];
      const artOf = it => isClass
        ? (heroSpriteHtml(it.id, 220) || `<div class="class-icon" style="width:170px;height:170px">${ICONS[it.id]}</div>`)
        : isOrigin
          ? `<div style="font-size:130px;line-height:1">${it.glyph}</div>`
          : `<div class="showcase-ph">PLACEHOLDER</div>`;

      body.innerHTML = `
        <div class="creation-stage">
          <div class="showcase">
            <div class="showcase-art" id="sc-art"></div>
            <div class="showcase-name" id="sc-name"></div>
          </div>
          <div class="showcase-text" id="sc-text"></div>
          <div class="creation-rail">
            <div class="rail-arrow" id="rail-left">◄</div>
            <div class="rail-window"><div class="rail-track" id="rail-track"></div></div>
            <div class="rail-arrow" id="rail-right">►</div>
          </div>
        </div>`;

      const track = body.querySelector('#rail-track');
      for (const it of list) {
        const lock = !selectable(it);
        const acc = accentOf(it);
        const card = el(`<div class="rail-card ${lock ? 'locked' : ''}" data-id="${it.id}" style="--sel:${acc};--sel-glow:${acc}55">
          <div class="rail-emblem" style="background:linear-gradient(135deg,${acc},#ffffff40);border-color:${acc}">${lock ? '?' : emblemOf(it)}</div>
          <div class="rail-name">${lock ? '? ? ?' : it.name}</div>
          <div class="rail-tag" style="color:${lock ? 'var(--ink-faint)' : acc}">${lock ? 'LOCKED' : tagOf(it)}</div>
        </div>`);
        if (!lock) card.onclick = () => selectItem(it.id);
        track.appendChild(card);
      }

      const idxOf = id => list.findIndex(it => it.id === id);
      const art = body.querySelector('#sc-art'), nameEl = body.querySelector('#sc-name'), textEl = body.querySelector('#sc-text');
      function paint(it, fade) {
        const acc = accentOf(it);
        const write = () => {
          art.innerHTML = artOf(it);
          nameEl.textContent = it.name;
          textEl.style.borderLeftColor = acc;
          textEl.innerHTML = `<div class="showcase-tag" style="color:${acc}">${tagOf(it)}</div><div class="showcase-blurb">${blurbOf(it)}</div>`;
          art.style.opacity = nameEl.style.opacity = textEl.style.opacity = '1';
        };
        if (fade) { art.style.opacity = nameEl.style.opacity = textEl.style.opacity = '0'; clearTimeout(body._sc); body._sc = setTimeout(write, 150); }
        else write();
      }
      function center() {
        const selIdx = idxOf(pick[key]);
        track.style.transform = `translateX(${257 - 166 * selIdx}px)`;
        track.querySelectorAll('.rail-card').forEach(c => c.classList.toggle('active', c.dataset.id === pick[key]));
      }
      function selectItem(id) { if (id === pick[key]) return; pick[key] = id; SFX.click(); center(); paint(list[idxOf(id)], true); }
      function stepSel(dir) {
        let i = idxOf(pick[key]) + dir;
        while (i >= 0 && i < list.length) { if (selectable(list[i])) return selectItem(list[i].id); i += dir; }
      }
      body.querySelector('#rail-left').onclick = () => stepSel(-1);
      body.querySelector('#rail-right').onclick = () => stepSel(1);
      center();
      paint(list[idxOf(pick[key])], false);
    }
    if (step === 3) {
      if (!gen) gen = rollStart(pick.classId, pick.raceId);
      const desc = startDescriptor(gen.percentile);
      const band = apprBand || potentialBand(gen.percentile);
      sub.textContent = appraised ? 'Awakening sealed. This is your beginning.' : 'Attune to the Monolith — press & hold to gauge your potential.';
      const reveal = appraised ? `
        <div class="mono-reveal">
          <div class="mono-feel">"${desc.word}"</div>
          <div style="font-family:var(--font-mono);font-size:9px;letter-spacing:3px;color:var(--ink-faint);margin:14px 0 8px">POTENTIAL RANGE</div>
          <div class="mono-band">
            <span style="color:var(--rk-${band.low})">${band.low}</span>
            <span style="color:#6a5d44">—</span>
            <span style="color:var(--rk-${band.high})">${band.high}</span>
          </div>
          <div class="sf-flavor" style="margin-top:12px">Your true rank is not given — it is earned within.</div>
          <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:14px">
            <input class="name-input" id="name" maxlength="16" placeholder="Name your climber..." />
            <button class="btn small" id="btn-reroll" ${rerolls >= maxRerolls() ? 'disabled' : ''}>🎲 Tempt fate (${maxRerolls() - rerolls} left)</button>
          </div>
        </div>` : `<div class="mono-hint">press &amp; hold the crystal to measure your potential</div>`;
      body.innerHTML = `
        <div style="text-align:center">
          <div class="mono-title">THE MONOLITH OF MEASURE</div>
          <div style="display:flex;gap:14px;align-items:center;justify-content:center;flex-wrap:wrap;margin:6px 0 4px">
            <span style="font-size:28px">${RACES[pick.raceId].glyph}</span>
            <div style="font-family:var(--font-display);font-size:12px;color:var(--ink-dim)">${RACES[pick.raceId].name} ${CLASSES[pick.classId].name} · ${originById(pick.originId).name}</div>
          </div>
          <canvas id="crystal" style="width:320px;height:400px;cursor:pointer;touch-action:none;user-select:none"></canvas>
          <div id="mono-reveal" style="min-height:96px;margin-top:-40px">${reveal}</div>
        </div>`;
      const cv = body.querySelector('#crystal');
      if (!appraised) {
        crystalCtl = mountCrystal(cv, { onComplete: () => { appraised = true; apprBand = potentialBand(gen.percentile); SFX.unlock(); render(); } });
      } else {
        const nameInput = body.querySelector('#name');
        nameInput.value = body._name || RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
        body.querySelector('#btn-reroll').onclick = () => {
          if (rerolls >= maxRerolls()) return;
          rerolls++; gen = rollStart(pick.classId, pick.raceId); appraised = false; apprBand = null;
          SFX.cardDeal(); render();
        };
      }
    }

    scr.querySelector('#btn-prev')?.addEventListener('click', () => { step--; gen = null; rerolls = 0; appraised = false; apprBand = null; SFX.click(); render(); });
    scr.querySelector('#btn-title')?.addEventListener('click', () => { SFX.click(); titleScreen(); });
    const nextBtn = scr.querySelector('#btn-next');
    if (step === 3 && !appraised) { nextBtn.disabled = true; nextBtn.title = 'Charge the Monolith first'; }
    nextBtn.onclick = () => {
      if (step === 3 && !appraised) return;
      SFX.click();
      if (step < 3) { step++; render(); return; }
      const name = scr.querySelector('#name')?.value.trim() || 'The Nameless';
      if (coopContext) return coopContext.done({ ...pick, name, gen });
      run = newRun(meta, { classId: pick.classId, raceId: pick.raceId, originId: pick.originId, name });
      // creation already rolled; overwrite with the rolls the player "felt"
      applyGen(run, pick, gen);
      meta.totalRuns++;
      saveMeta(meta);
      SFX.unlock();
      gateEntry(() => beginRun());
    };
  }
  render();
}

function applyGen(run, pick, gen) {
  const up = id => upgradeRank(meta, id);
  const prowess = up('prowess');
  run.stats = {
    str: gen.stats.str + prowess, dex: gen.stats.dex + prowess,
    int: gen.stats.int + prowess, wis: gen.stats.wis + prowess, lk: gen.stats.lk + prowess,
  };
  run.maxHp = gen.stats.hp + up('vitality') * 8;
  run.hp = run.maxHp;
  run.maxMp = gen.stats.mp + up('arcana') * 6;
  run.mp = run.maxMp;
  run.growthRank = gen.growthRank;
  run.startPercentile = gen.percentile;
  run.underdog = gen.percentile <= CONFIG.chargen.underdogPercentile;
}

/* ---------- gate entry presentation (handoff §27) ---------- */
function gateEntry(then) {
  const quick = (meta.gateSeen || 0) >= 3;
  meta.gateSeen = (meta.gateSeen || 0) + 1;
  saveMeta(meta);
  const overlay = el(`
    <div class="gate-overlay ${quick ? 'quick' : ''}">
      <div class="gate-arch">
        <div class="gate-doors"><span>🌑</span></div>
      </div>
      <div class="gate-caption">THE GATE ACKNOWLEDGES YOU</div>
      <div class="gate-skip">click to enter</div>
    </div>`);
  (document.getElementById('frame') || document.body).appendChild(overlay);
  SFX.bossIntro();
  let doneCalled = false;
  const go = () => {
    if (doneCalled) return;
    doneCalled = true;
    overlay.classList.add('entering');
    setTimeout(() => { overlay.remove(); then(); }, quick ? 350 : 900);
  };
  overlay.onclick = go;
  setTimeout(go, quick ? 900 : 2600);
}

function beginRun() {
  // origins are briefly playable: the origin's card resolves before floor 1
  const origin = run.originId && originById(run.originId);
  if (origin && !run.flags.origin_done) {
    run.flags.origin_done = true;
    const stage = floorChrome();
    renderEventCard(stage, {
      id: 'origin_' + origin.id, category: 'unknown', type: 'story',
      glyph: origin.glyph, title: origin.title, text: origin.text, choices: origin.choices,
    }, { originIntro: true });
    return;
  }
  enterFloorScreen(true);
}

/* ============================================================
   CO-OP: menu, lobby, session plumbing
   ============================================================ */
function coopMenu() {
  if (isMixedContentBlocked()) {
    modal(`<h3>Multiplayer lives on the party server</h3>
      <p class="modal-sub">This page is served over https, which blocks game connections to the relay.
      Open the game from the party server instead — everything else is identical:</p>
      <p style="text-align:center;margin:14px 0"><a href="${PUBLIC_GAME_URL}" style="color:var(--gold-bright);font-family:var(--font-display);font-size:18px">${PUBLIC_GAME_URL}</a></p>
      <div class="pick-grid"><button class="pick-option" data-close="x" style="text-align:center"><span class="po-name">Got it</span></button></div>`, { dismissible: true });
    return;
  }

  app.innerHTML = '';
  const scr = el(`<div class="screen" style="max-width:560px">
    <div class="select-header">
      <h2>Climb Together</h2>
      <p>One tower, one fate, up to four climbers. Combat is fought side by side;<br/>every choice is still your own — unless the party votes otherwise.</p>
    </div>
    <div class="panel" style="padding:24px">
      <input class="name-input" id="coop-name" maxlength="16" placeholder="Your name..." style="width:100%;margin-bottom:14px" />
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn primary" id="btn-create" style="flex:1">Create a Party</button>
      </div>
      <div class="divider"></div>
      <div style="display:flex;gap:10px">
        <input class="name-input" id="coop-code" maxlength="4" placeholder="CODE" style="width:110px;text-transform:uppercase;text-align:center;letter-spacing:.3em" />
        <button class="btn" id="btn-join" style="flex:1">Join a Party</button>
      </div>
      <div id="coop-err" style="color:#f0a8a0;font-size:14px;margin-top:12px;min-height:20px"></div>
    </div>
    <div style="text-align:center;margin-top:16px"><button class="btn ghost small" id="btn-back">← Back</button></div>
  </div>`);
  app.appendChild(scr);
  const nameInput = scr.querySelector('#coop-name');
  nameInput.value = localStorage.getItem('dt_coop_name') || RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
  const errEl = scr.querySelector('#coop-err');

  async function go(mode) {
    const name = nameInput.value.trim() || 'Climber';
    localStorage.setItem('dt_coop_name', name);
    errEl.textContent = 'Connecting to the tower...';
    let net;
    try {
      net = await connectCoop(defaultServerUrl());
    } catch {
      errEl.textContent = 'Could not reach the party server. Is it awake?';
      return;
    }
    net.sys('err', m => { errEl.textContent = m.why; net.close(); });
    const roomPromise = new Promise(r => { const off = net.sys('room', m => { off(); r(m); }); });
    if (mode === 'create') net.create(name);
    else {
      const code = scr.querySelector('#coop-code').value.trim().toUpperCase();
      if (code.length !== 4) { errEl.textContent = 'Party codes are 4 letters.'; net.close(); return; }
      net.join(code, name);
    }
    await roomPromise;
    coopS = new CoopSession(net);
    coopLobby(name);
  }

  scr.querySelector('#btn-create').onclick = () => { SFX.click(); go('create'); };
  scr.querySelector('#btn-join').onclick = () => { SFX.click(); go('join'); };
  scr.querySelector('#btn-back').onclick = () => { SFX.click(); titleScreen(); };
}

function coopLobby(myName) {
  let myPick = { raceId: 'human', classId: 'warrior', originId: ORIGINS[0].id };
  let myReady = false;
  let decisionMode = 'majority'; // host-controlled (handoff §3)
  const lobbyState = new Map();

  // Remote updates touch ONLY the roster/mode sections — never the whole
  // screen, so nothing jumps while you are picking (patch).
  const offLobby = coopS.net.on('lobby', (d, from) => {
    lobbyState.set(from, d);
    const p = coopS.partners.get(from);
    if (p) p.classId = d.classId;
    updateRoster();
  });
  const offMode = coopS.net.on('mode', d => { decisionMode = d.mode; updateModeButtons(); });
  const offStart = coopS.net.on('start', d => beginCoopRun(d.mode));
  coopS.onPartnerUpdate = () => updateRoster();
  coopS.onPartnerLeft = () => updateRoster();

  function sendLobby() {
    coopS.net.send({ k: 'lobby', classId: myPick.classId, raceId: myPick.raceId, ready: myReady, name: myName });
  }

  function everyoneReady() {
    if (!myReady) return false;
    for (const id of coopS.partners.keys()) {
      if (!lobbyState.get(id)?.ready) return false;
    }
    return true;
  }

  function beginCoopRun(mode) {
    offLobby(); offStart(); offMode();
    clearRun();
    coopS.decisionMode = mode || decisionMode;
    run = newRun(meta, { classId: myPick.classId, raceId: myPick.raceId, originId: myPick.originId, name: myName, seed: coopS.seed });
    run.coopMode = true;
    if (coopS.partySize >= 4) unlock('party_of_four');
    meta.totalRuns++;
    saveMeta(meta);
    SFX.unlock();
    coopS.onPartnerLeft = () => {
      toast('A climber has left the party.', 'bad');
      if (coopS.isHost && run && run.floor > 0 && !coopS.floorContent.has(run.floor)) {
        hostPublishFloorContent();
      }
      refreshPartnerStrip();
    };
    gateEntry(() => beginRun());
  }

  // proper grid pickers instead of click-to-cycle (patch)
  function openPicker(kind) {
    if (myReady) return;
    const defs = {
      race: { title: 'Bloodline', items: Object.values(RACES).map(r => ({ id: r.id, glyph: r.glyph, name: r.name, desc: r.hint })) },
      class: {
        title: 'Calling',
        items: Object.values(CLASSES)
          .filter(c => !c.hidden || c.unlockCond?.(meta))
          .map(c => ({ id: c.id, glyph: null, icon: ICONS[c.id], accent: c.accent, name: c.name, desc: `${c.resource.name} · ${c.weapons.join(', ')}` })),
      },
      origin: { title: 'Origin', items: ORIGINS.map(o => ({ id: o.id, glyph: o.glyph, name: o.name, desc: o.blurb })) },
    };
    const def = defs[kind];
    modalCustom((m, close) => {
      m.innerHTML = `<h3>Choose your ${def.title}</h3>
        <div class="picker-grid">${def.items.map(it => `
          <button class="picker-card" data-id="${it.id}" ${it.accent ? `style="--accent:${it.accent}"` : ''}>
            <div class="pk-glyph">${it.icon || `<span style="font-size:34px">${it.glyph}</span>`}</div>
            <div class="pk-name">${it.name}</div>
            <div class="pk-desc">${it.desc}</div>
          </button>`).join('')}
        </div>`;
      m.querySelectorAll('.picker-card').forEach(b => b.onclick = () => {
        myPick[kind + 'Id'] = b.dataset.id;
        SFX.click();
        close();
        updatePickTiles();
        sendLobby();
      });
    });
  }

  function pickTilesHtml() {
    return `
      <div class="panel pick-tile" id="pick-race"><div style="font-size:32px">${RACES[myPick.raceId].glyph}</div><b>${RACES[myPick.raceId].name}</b><div class="pt-hint">change race</div></div>
      <div class="panel pick-tile" id="pick-class"><div class="class-icon" style="width:40px;height:40px;margin:0 auto;color:${CLASSES[myPick.classId].accent}">${ICONS[myPick.classId]}</div><b>${CLASSES[myPick.classId].name}</b><div class="pt-hint">change class</div></div>
      <div class="panel pick-tile" id="pick-origin"><div style="font-size:32px">${originById(myPick.originId).glyph}</div><b style="font-size:13px">${originById(myPick.originId).name}</b><div class="pt-hint">change origin</div></div>`;
  }

  function updatePickTiles() {
    const row = document.getElementById('pick-row');
    if (!row) return;
    row.innerHTML = pickTilesHtml();
    bindPickTiles();
  }

  function bindPickTiles() {
    document.getElementById('pick-race').onclick = () => openPicker('race');
    document.getElementById('pick-class').onclick = () => openPicker('class');
    document.getElementById('pick-origin').onclick = () => openPicker('origin');
  }

  function rosterHtml() {
    const partners = [...coopS.partners.entries()];
    const rows = [
      { name: myName + ' (you)', classId: myPick.classId, raceId: myPick.raceId, ready: myReady, host: coopS.isHost },
      ...partners.map(([id, p]) => ({ name: p.name, classId: lobbyState.get(id)?.classId, raceId: lobbyState.get(id)?.raceId, ready: lobbyState.get(id)?.ready, host: coopS.net.roster.find(r => r.id === id)?.host })),
    ];
    return rows.map(r => `
      <div class="inv-item">
        <div class="item-name">${r.host ? '👑 ' : ''}${r.name}</div>
        <div style="display:flex;gap:10px;align-items:center">
          <span class="tag">${r.raceId ? RACES[r.raceId]?.name || '' : ''} ${r.classId ? CLASSES[r.classId].name : 'choosing...'}</span>
          <span class="tag" style="${r.ready ? 'color:var(--luck);border-color:var(--luck)' : ''}">${r.ready ? 'READY' : 'not ready'}</span>
        </div>
      </div>`).join('');
  }

  function updateRoster() {
    const rEl = document.getElementById('roster');
    if (rEl) rEl.innerHTML = rosterHtml();
    const go = document.getElementById('btn-go');
    if (go) go.disabled = !everyoneReady();
  }

  function updateModeButtons() {
    document.querySelectorAll('[data-mode]').forEach(b =>
      b.classList.toggle('primary', b.dataset.mode === decisionMode));
  }

  function render() {
    app.innerHTML = '';
    const scr = el(`<div class="screen">
      <div class="select-header">
        <h2>The Party Gathers</h2>
        <p>Party code: <b style="color:var(--gold-bright);font-size:26px;letter-spacing:.25em;font-family:var(--font-mono)">${coopS.net.code}</b><br/>
        Share it with your friend${coopS.partySize > 2 ? 's' : ''} — up to 4 climbers.</p>
      </div>
      <div class="panel" style="padding:14px 18px;margin-bottom:14px">
        <div style="font-family:var(--font-display);font-size:13px;letter-spacing:.08em;color:var(--ink-dim);margin-bottom:8px">PARTY DECISIONS ${coopS.isHost ? '(you choose)' : '(host chooses)'}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn small ${decisionMode === 'majority' ? 'primary' : ''}" data-mode="majority" ${coopS.isHost ? '' : 'disabled'}>🗳 Majority Vote — ties roll randomly</button>
          <button class="btn small ${decisionMode === 'first' ? 'primary' : ''}" data-mode="first" ${coopS.isHost ? '' : 'disabled'}>⚡ First Pick — fastest hand decides</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px" id="pick-row">${pickTilesHtml()}</div>
      <div class="panel" style="padding:18px 22px">
        <div id="roster">${rosterHtml()}</div>
        <div class="divider"></div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn ${myReady ? '' : 'primary'}" id="btn-ready">${myReady ? '✔ Ready (click to unready)' : 'Ready Up'}</button>
          ${coopS.isHost ? `<button class="btn primary" id="btn-go" ${everyoneReady() ? '' : 'disabled'}>Enter the Tower</button>` : `<span style="align-self:center;color:var(--ink-dim);font-style:italic">The host opens the gate when all are ready.</span>`}
          <button class="btn ghost small" id="btn-leave">Leave</button>
        </div>
      </div>
    </div>`);
    app.appendChild(scr);

    scr.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => {
      if (!coopS.isHost) return;
      decisionMode = b.dataset.mode;
      coopS.net.send({ k: 'mode', mode: decisionMode });
      SFX.click();
      updateModeButtons();
    });
    bindPickTiles();

    scr.querySelector('#btn-ready').onclick = () => {
      myReady = !myReady;
      SFX.click(); sendLobby();
      const b = scr.querySelector('#btn-ready');
      b.textContent = myReady ? '✔ Ready (click to unready)' : 'Ready Up';
      b.classList.toggle('primary', !myReady);
      updateRoster();
    };
    scr.querySelector('#btn-go')?.addEventListener('click', () => {
      if (!everyoneReady()) return;
      coopS.net.send({ k: 'start', mode: decisionMode });
      beginCoopRun(decisionMode);
    });
    scr.querySelector('#btn-leave').onclick = () => {
      coopS.destroy(); coopS = null;
      titleScreen();
    };
  }

  sendLobby();
  render();
}

function teardownCoop() {
  if (coopS) { coopS.destroy(); coopS = null; }
}

function statusOf(run, act) {
  const d = derived(run);
  return { ...run, def: d.def, dodge: Math.round(d.dodge), act };
}

function partnerStrip() {
  if (!coopS || coopS.alone) return '';
  let html = '<div class="panel partner-strip">';
  for (const [, p] of coopS.partners) {
    const s = p.status;
    html += `<div class="partner-chip ${s?.down ? 'downed' : ''}">
      <span class="pc-name">${p.name}</span>
      <span class="tag">${s ? `Lv ${s.level} · F${s.floor}` : '...'}</span>
      <div class="bar" style="width:90px;height:9px"><div class="bar-fill hp" style="width:${s ? Math.max(0, s.hp / s.maxHp * 100) : 0}%"></div></div>
      <span class="pc-act">${s?.down ? '✖ down' : { choosing: '🃏 choosing', fighting: '⚔ fighting', waiting: '⏳ ready', shopping: '🪙 shopping' }[s?.act] || ''}</span>
    </div>`;
  }
  return html + '</div>';
}

function refreshPartnerStrip() {
  const elx = document.querySelector('.partner-strip');
  if (elx) {
    const fresh = el(partnerStrip() || '<div class="partner-strip" style="display:none"></div>');
    elx.replaceWith(fresh);
  }
}

/* ============================================================
   HUD + FLOOR CHROME
   ============================================================ */
function renderHud() {
  const hud = document.querySelector('.hud');
  if (!hud || !run) return;
  const resName = resourceName(run);
  hud.innerHTML = `
    <div class="hud-identity" style="--accent:${CLASSES[run.classId].accent}">
      <div class="hud-portrait">${heroSpriteHtml(run.classId, 46) || ICONS[run.classId] || '🥋'}</div>
      <div>
        <div class="hud-name">${run.name}</div>
        <div class="hud-class">Lv ${run.level} ${run.raceName} ${classTitle(run)}</div>
      </div>
    </div>
    <div class="hud-bars">
      ${bar('hp', run.hp, run.maxHp, '❤ HP')}
      ${bar('mp', run.mp, run.maxMp, `✦ ${resName}`)}
      ${bar('xp', run.xp, run.xpNext, `XP → Lv ${run.level + 1}`)}
    </div>
    <div class="hud-meta">
      <div class="hud-chip">🪙 <b>${run.gold}</b></div>
      <div class="hud-chip" title="Fame — always visible, always watching">🌟 <b>${run.fame}</b></div>
      <div class="hud-chip">🗼 <b>F${run.floor}</b></div>
      ${run.sigils.length ? `<div class="hud-chip">✦ <b>${run.sigils.length}/3</b></div>` : ''}
    </div>
    <div class="hud-buttons">
      <button class="btn small" id="hud-sheet">🎒 Character</button>
      <button class="btn small ghost" id="hud-quit">☰</button>
    </div>`;
  hud.querySelector('#hud-sheet').onclick = () => { SFX.click(); characterSheet(); };
  hud.querySelector('#hud-quit').onclick = async () => {
    SFX.click();
    const p = modal(`
      <h3>Pause</h3>
      <div class="audio-row pause-audio">
        <span>🎵 Music</span>
        <input type="range" id="pause-vol" class="vol-slider" min="0" max="100" value="${Math.round(Music.getVolume() * 100)}" aria-label="Music volume" />
        <span id="pause-vol-val" class="vol-val">${Math.round(Music.getVolume() * 100)}</span>
        <button class="btn small ghost" id="pause-mute">${isMuted() ? '🔇' : '🔊'}</button>
      </div>
      <div class="pick-grid">
        <button class="pick-option" data-close="resume"><span class="po-name">Resume the climb</span></button>
        ${coopS ? '' : `<button class="pick-option" data-close="save"><span class="po-name">Save &amp; return to title</span><span class="po-desc">Your climb waits where you left it.</span></button>`}
        <button class="pick-option" data-close="abandon"><span class="po-name" style="color:var(--blood)">${coopS ? 'Leave the party & abandon run' : 'Abandon run'}</span><span class="po-desc">The tower claims another. Shards are still awarded.</span></button>
      </div>`, { dismissible: true });
    // modal() appends synchronously — wire the audio controls before awaiting
    wireVolumeSlider(document.getElementById('pause-vol'), document.getElementById('pause-vol-val'));
    const mb = document.getElementById('pause-mute');
    if (mb) mb.onclick = () => { const m = toggleMute(); Music.syncMute(); mb.textContent = m ? '🔇' : '🔊'; };
    const v = await p;
    if (v === 'save') { saveRun(run); titleScreen(); }
    if (v === 'abandon') endRun('abandon');
  };
}

function floorStrip() {
  const biome = biomeForFloor(Math.max(1, run.floor));
  const [start, end] = biome.floors;
  let nodes = '';
  for (let f = start; f <= end; f++) {
    const isBoss = BOSS_FLOORS.includes(f);
    nodes += `<div class="floor-node ${isBoss ? 'boss' : ''} ${f < run.floor ? 'done' : ''} ${f === run.floor ? 'current' : ''}"></div>`;
  }
  return `<div class="panel floor-strip"><span class="biome-label">${biome.name}</span>${nodes}<span class="biome-label" style="margin-left:auto">${run.floor}/${LAST_FLOOR}</span></div>`;
}

function floorChrome() {
  app.innerHTML = `
    <div class="screen chrome" style="padding-top:0">
      <div class="hud panel"></div>
      ${partnerStrip()}
      ${run.floor > 0 ? floorStrip() : ''}
      <div id="stage"></div>
    </div>`;
  renderHud();
  if (coopS) coopS.onPartnerUpdate = refreshPartnerStrip;
  return document.getElementById('stage');
}

/* ============================================================
   FLOOR FLOW
   ============================================================ */
async function enterFloorScreen(fresh = false) {
  if (fresh) { run.floor = 0; resetTravelTrail(); }
  nextFloor();
}

async function nextFloor() {
  run.floor++;
  const biome = biomeForFloor(run.floor);
  run.biomeId = biome.id;
  setBiomeGlow(biome.glow);
  setParticles(biome.particle);

  // co-op mercy: the fallen rise at the next floor — at a price (handoff §16)
  if (run.down) {
    run.down = false;
    run.hp = Math.max(1, Math.round(run.maxHp * CONFIG.death.respawnHpPct));
    run.mp = Math.round(run.maxMp * CONFIG.death.respawnResourcePct);
    const lost = deathItemLoss();
    toast(`Your companions drag you to your feet.${lost.length ? ' Lost in the fall: ' + lost.join(', ') : ''}`, 'bad');
  }

  heal(run, run.maxHp * CONFIG.recovery.floorHealPct);
  restoreMana(run, run.maxMp * CONFIG.recovery.floorManaPct);

  const relics = relicItems(run);
  const lowHeal = relics.find(r => r.lowHpHeal);
  if (lowHeal && run.hp / run.maxHp < 0.3) {
    heal(run, run.maxHp * lowHeal.lowHpHeal);
    toast(`${lowHeal.name} stirs — you breathe easier.`, 'info');
  }

  if (run.fame >= 50) unlock('famous');
  if ((run.guardCount || 0) >= 15) unlock('guardian');
  if (run.gold >= 1000) unlock('hoarder');
  if (meta.bestFloor >= 20) unlock('grave_calling');
  if (run.floor >= 10 && !meta.classFloor10.includes(run.classId)) {
    meta.classFloor10.push(run.classId);
    if (meta.classFloor10.length >= 4) unlock('all_classes');
    saveMeta(meta);
  }
  if (run.floor > meta.bestFloor) { meta.bestFloor = run.floor; saveMeta(meta); }

  saveRun(run);
  Music.play(BIOME_MUSIC[run.biomeId] || 'forest');

  const stage = floorChrome();

  if (run.floor === biome.floors[0]) {
    stage.innerHTML = `
      <div class="card-stage"><div class="panel event-card">
        <div class="card-art"><div class="card-glyph">${{ forest: '🌲', ruins: '🏛️', frost: '🏰', swamp: '🌫️', hell: '🌋', throne: '🜏' }[biome.id] || '🗼'}</div>
          <span class="tag card-floor-tag">FLOOR ${run.floor}</span></div>
        <div class="card-body">
          <h3>${biome.name}</h3>
          <div class="card-text">${biome.flavor}</div>
          <div class="card-choices"><button class="choice-btn" id="go"><span class="choice-label">Step through the gate</span><span class="choice-hint">⟶</span></button></div>
        </div>
      </div></div>`;
    applyCardBg(stage);
    SFX.cardDeal();
    await new Promise(r => document.getElementById('go').onclick = () => { SFX.click(); r(); });
  }

  if (coopS) return coopFloor(stage);

  if (run.floor === LAST_FLOOR) return throneRoom(stage);
  if (BOSS_FLOORS.includes(run.floor)) return bossFloor(stage);
  if (run.floor % 5 === 0) return modifierFloor(stage);

  if (BOSS_FLOORS.includes(run.floor + 1)) {
    const campfire = EVENTS.find(e => e.id === 'campfire');
    saveRun(run);
    return renderEventCard(stage, campfire);
  }

  // THE TRAVEL MAP (handoff §6): most floors branch into a choice of paths
  const cards = generateCards(runRng(run));
  saveRun(run);
  renderTravelMap(stage, cards, null, travelCtx());
}

// context passed to the travel map — real run data + the resolution engine
function travelCtx() {
  return { run, coopS, resolveCard, flash, biome: biomeForFloor(run.floor) };
}

/* ---------- three-card generation ---------- */
function generateCards(rng, forParty = null) {
  const biome = biomeForFloor(run.floor);
  const cards = [];
  const usedEvents = [];
  const n = CONFIG.events.cardsPerDraw;
  // one slot is combat-weighted; others draw distinct events.
  // early floors lean toward events so a fresh climber can build tools before
  // the tower gets serious (combat stays deadly — you're meant to prepare for it)
  const combatChance = run.floor <= 3 ? 0.35 : run.floor <= 6 ? 0.6 : 0.75;
  const combatSlot = rng.chance(combatChance) ? rng.int(0, n - 1) : -1;
  for (let i = 0; i < n; i++) {
    if (i === combatSlot) {
      const group = pickEnemyGroup(rng, biome, forParty?.partySize || 1);
      cards.push({ kind: 'encounter', category: 'combat', enemies: forParty ? buildPartyEnemies(group, forParty.partySize) : group.map(g => ({ ...g })), sparkle: false });
      continue;
    }
    const ev = drawEvent(rng, run, { exclude: usedEvents });
    usedEvents.push(ev.id);
    // affinity sparkle: sometimes, never explained (handoff §4)
    let affine = false;
    if (ev.affinity) {
      const classes = forParty?.classes || [run.classId];
      if (ev.affinity.classes?.some(c => classes.includes(c))) affine = true;
      if (ev.affinity.races?.includes(run.raceId)) affine = true;
      if (ev.affinity.underdog && run.underdog) affine = true;
    }
    cards.push({ kind: 'event', category: ev.category || 'unknown', eventId: ev.id, sparkle: affine && rng.chance(CONFIG.events.sparkleChance) });
  }
  rng.advance();
  return cards;
}

function renderCardChoice(stage, cards, coopCtx = null) {
  const picks = new Map(); // playerId -> card index (co-op)
  let locked = false;

  function cardFace(c, i) {
    const m = CATEGORY_META[c.category] || CATEGORY_META.unknown;
    return `
      <div class="pick-card ${c.sparkle ? 'sparkle' : ''}" data-i="${i}">
        <div class="pc-glyph">${m.glyph}</div>
        <div class="pc-cat">${m.label}</div>
        <div class="pc-blurb">${m.blurb}</div>
        <div class="pc-votes" id="votes-${i}"></div>
      </div>`;
  }

  stage.innerHTML = `
    <div class="draw-header">
      <span class="tag">FLOOR ${run.floor}</span>
      <h3>The Tower Deals ${cards.length}</h3>
      <p>${coopCtx ? (coopCtx.mode === 'first' ? 'First pick decides — fastest hand wins.' : 'The party votes. Majority rules; ties spin the tower\'s coin.') : 'Choose your path. The cards show only their nature, never their contents.'}</p>
    </div>
    <div class="pick-row">${cards.map((c, i) => cardFace(c, i)).join('')}</div>`;
  SFX.cardDeal();

  function renderVotes() {
    if (!coopCtx) return;
    for (let i = 0; i < cards.length; i++) {
      const votes = [...picks.entries()].filter(([, v]) => v === i);
      const elv = document.getElementById(`votes-${i}`);
      if (elv) elv.innerHTML = votes.map(([id]) => {
        const name = id === coopS.you ? 'You' : (coopS.partners.get(id)?.name || '?');
        return `<span class="vote-chip">${name}</span>`;
      }).join('');
    }
    // waiting hint
    const missing = coopS.partySize - picks.size;
    const hdr = stage.querySelector('.draw-header p');
    if (hdr && coopCtx.mode === 'majority' && picks.size > 0) {
      hdr.textContent = missing > 0 ? `Waiting on ${missing} vote${missing > 1 ? 's' : ''}…` : 'Votes are in — the tower counts.';
    }
  }

  stage.querySelectorAll('.pick-card').forEach(cardEl => {
    cardEl.onclick = () => {
      if (locked) return;
      const i = +cardEl.dataset.i;
      SFX.click();
      if (!coopCtx) return resolveCard(stage, cards[i]);
      const prev = picks.get(coopS.you);
      if (prev === i) return; // same card, nothing to change
      if (prev != null && coopCtx.mode === 'first') return; // first-pick locks your hand
      picks.set(coopS.you, i);
      coopS.net.send({ k: 'pick', floor: run.floor, idx: i });
      stage.querySelectorAll('.pick-card').forEach(c => c.classList.toggle('picked', +c.dataset.i === i));
      renderVotes();
      coopCtx.onLocalPick(i, picks);
    };
  });

  if (coopCtx) {
    coopCtx.bind({ picks, renderVotes, lock: idx => {
      locked = true;
      stage.querySelectorAll('.pick-card').forEach(c => c.classList.toggle('chosen', +c.dataset.i === idx));
      setTimeout(() => resolveCard(stage, cards[idx]), 700);
    } });
  }
}

function resolveCard(stage, card) {
  if (card.kind === 'encounter') {
    if (coopS) {
      const enemies = rehydrateEnemies(card.enemies);
      return sharedFightCard(stage, { type: 'encounter', enemies });
    }
    return encounterFloor(stage, card.enemies);
  }
  const ev = EVENTS.find(e => e.id === card.eventId);
  run.seenEvents.push(ev.id);
  saveRun(run);
  renderEventCard(stage, ev);
}

/* ---------- combat encounter card (Fight / Sneak / Bribe) ---------- */
function pickEnemyGroup(rng, biome, partySize = 1) {
  const depth = run.floor - biome.floors[0];
  let pool = ENEMIES[biome.id] || ENEMIES.hell;
  if (depth < 4) pool = pool.filter(e => !e.elite);
  const lead = rng.pick(pool);
  const group = [lead];
  if (lead.pack) {
    const extra = depth < 3 ? 1 : rng.int(1, 2);
    for (let i = 0; i < extra; i++) group.push(rng.chance(0.7) ? lead : rng.pick(pool.filter(e => !e.elite)));
  } else if (!lead.elite && depth >= 2 && rng.chance(0.25)) {
    group.push(rng.pick(pool.filter(e => !e.elite)));
  }
  // party-size scaling: more bodies, not just bigger health bars (handoff §7)
  if (partySize >= CONFIG.partyScaling.extraEnemyAt) {
    group.push(rng.pick(pool.filter(e => !e.elite)));
  }
  // bigger parties court bigger crowds
  for (let m = 2; m < partySize; m++) {
    if (rng.chance(CONFIG.partyScaling.moreEnemyChance)) group.push(rng.pick(pool.filter(e => !e.elite)));
  }
  return group;
}

async function encounterFloor(stage, prebuiltGroup = null) {
  const rng = runRng(run);
  const biome = biomeForFloor(run.floor);
  const group = prebuiltGroup || pickEnemyGroup(rng, biome);
  rng.advance(); saveRun(run);

  const names = [...new Set(group.map(g => g.name))].join(', ');
  const bribable = group.every(g => g.intelligent);
  // fame lowers the price of being left alone (handoff §25)
  const fameDiscount = Math.min(0.5, Math.floor(run.fame / 10) * CONFIG.fame.bribeDiscountPer10);
  const bribe = Math.round(group.reduce((s, g) => s + g.gold[1], 0) * 0.8 * (1 - fameDiscount));

  stage.innerHTML = `
    <div class="card-stage"><div class="panel event-card">
      <div class="card-art"><div class="card-glyph">${group[0].glyph}</div>
        <span class="tag card-type-tag">ENCOUNTER</span><span class="tag card-floor-tag">FLOOR ${run.floor}</span></div>
      <div class="card-body">
        <h3>Hostiles Ahead</h3>
        <div class="card-text">The floor narrows, and the dark produces: ${names}${group.length > 1 ? ` — ${group.length} of them` : ''}. They have already noticed you. The only question is what happens next.</div>
        <div class="card-choices">
          <button class="choice-btn" data-act="fight"><span class="choice-label">⚔ Fight</span><span class="choice-hint">XP + gold</span></button>
          <button class="choice-btn" data-act="sneak"><span class="choice-label">🕶 Sneak past</span><span class="choice-hint">a test of agility</span></button>
          ${bribable
            ? `<button class="choice-btn" data-act="bribe" ${run.gold < bribe ? 'disabled' : ''}><span class="choice-label">🪙 Bribe them</span><span class="choice-hint ${run.gold < bribe ? 'choice-req' : ''}">-${bribe}g${fameDiscount > 0 ? ' (your name precedes you)' : ''}</span></button>`
            : `<button class="choice-btn locked" disabled><span class="choice-label">🪙 Bribe them</span><span class="choice-hint choice-req">🔒 they can't be reasoned with</span></button>`}
        </div>
      </div>
    </div></div>`;
  applyCardBg(stage);
  SFX.cardDeal();

  stage.querySelectorAll('[data-act]').forEach(btn => btn.onclick = async () => {
    SFX.click();
    const act = btn.dataset.act;
    const rng2 = runRng(run);
    if (act === 'fight') {
      rng2.advance();
      return fightGroup(stage, group, { text: 'Steel answers steel.' });
    }
    if (act === 'bribe') {
      run.gold -= bribe;
      run.bribes = (run.bribes || 0) + 1;
      if (run.bribes >= 3) unlock('silver_tongue');
      rng2.advance(); saveRun(run);
      return showOutcomePanel(stage, [
        { text: `You toss the purse. They count it — twice, insultingly — and melt back into the dark. (-${bribe} gold)`, cls: 'gold' },
      ]);
    }
    // sneak: a hidden check — no numbers shown (handoff §5)
    const d = derived(run);
    const sneakDc = 10 + Math.floor(run.floor / 8);
    const roll = rng2.int(1, 8);
    const total = d.dex + roll + Math.floor(d.lk / 4);
    rng2.advance(); saveRun(run);
    if (total >= sneakDc) {
      const xp = 10 + Math.floor(run.floor * 1.2);
      const ups = gainXp(run, xp, runRng(run));
      await showOutcomePanel(stage, [
        { text: `You move like a rumor — they never knew you were there. +${xp} XP`, cls: 'good' },
      ], ups);
    } else {
      await modal(`<h3>Spotted!</h3><p class="modal-sub">A twig. It's always a twig.</p>
        <div class="pick-grid"><button class="pick-option" data-close="x"><span class="po-name">They ambush you</span></button></div>`);
      return fightGroup(stage, group, { text: 'They were waiting for the twig.', modifier: { name: 'Ambushed', desc: 'Enemies strike first.', enemyFirst: true } });
    }
  });
}

async function fightGroup(stage, specs, { text = null, modifier = null, prebuilt = null } = {}) {
  Music.play('battle');
  const biome = biomeForFloor(run.floor);
  const rng = runRng(run);
  const enemies = prebuilt || specs.map(s => buildEnemy(s, run.floor, biome.floors[0], { hpMult: modifier?.hpMult || 1 }));
  if (modifier?.extraEnemy) {
    enemies.push(buildEnemy(runRng(run).pick(ENEMIES[biome.id].filter(e => !e.elite)), run.floor, biome.floors[0]));
  }
  const { result, gold = 0, xp = 0, noDamage, usedUltimate } = await startCombat({
    container: stage, run, rng, enemies, modifier,
    introText: text, onHud: renderHud, onCharacter: () => characterSheet(),
  });
  if (result === 'win') { if (noDamage) unlock('untouchable'); if (usedUltimate) unlock('overcharged'); }

  if (result === 'dead') {
    if (coopS && !coopS.alone) {
      run.down = true;
      saveRun(run);
      coopS.broadcastStatus(statusOf(run, 'waiting'), 'waiting');
      return showOutcomePanel(stage, [
        { text: 'You fall — but you are not alone in this tower. Your companions find you and carry you to the stairs.', cls: 'bad' },
      ]);
    }
    return endRun('dead');
  }
  if (result === 'fled') {
    saveRun(run);
    return showOutcomePanel(stage, [{ text: 'You live to climb another floor. The tower notes your pragmatism.', cls: 'good' }]);
  }

  await afterVictory(stage, enemies, gold, xp);
}

async function afterVictory(stage, enemies, gold, xp, { boss = null } = {}) {
  run.kills += enemies.length;
  run.gold += gold;
  run.goldEarned += gold;
  unlock('first_blood');
  if (run.gold >= 500) unlock('rich');
  if (enemies.some(e => e.id === 'mimic')) unlock('mimic');

  const lines = [{ text: `Victory! +${gold} gold, +${xp} XP`, cls: 'gold' }];

  // victory recovery (handoff §15) — more generous than the old build
  const vh = heal(run, run.maxHp * CONFIG.recovery.victoryHealPct);
  if (vh > 0) lines.push({ text: `You bind your wounds in the quiet after. (+${vh} HP)`, cls: 'good' });
  const victoryHeal = relicItems(run).find(r => r.victoryHeal);
  if (victoryHeal) {
    const amt = heal(run, run.maxHp * victoryHeal.victoryHeal);
    if (amt) lines.push({ text: `${victoryHeal.name} hums — you recover ${amt} HP.`, cls: 'good' });
  }
  const fameRelic = relicItems(run).find(r => r.fameOnVictory);
  if (fameRelic) { changeFame(run, fameRelic.fameOnVictory); lines.push({ text: 'Your lantern carries the tale. (+Fame)', cls: 'good' }); }
  if (boss) {
    heal(run, run.maxHp * CONFIG.recovery.bossVictoryHealPct);
    run.mp = run.maxMp;
    changeFame(run, 6);
    lines.push({ text: 'The gate\'s blessing washes over you — wounds knit, strength returns, and the tower learns your name. (+Fame)', cls: 'good' });
  }
  SFX.victory();
  const ups = gainXp(run, xp, runRng(run));
  saveRun(run);
  await showOutcomePanel(stage, lines, ups, boss ? { continueLabel: 'Claim your prize', advance: false } : {});
  if (boss) await bossRelicPick(stage);
}

async function bossRelicPick(stage) {
  const rng2 = runRng(run);
  const choices = [rollRelic(rng2, run.relics), rollRelic(rng2, run.relics), rollRelic(rng2, run.relics)]
    .filter((r, i, a) => r && a.findIndex(x => x && x.id === r.id) === i);
  rng2.advance();
  saveRun(run);
  if (choices.length) {
    await modalCustom((m, close) => {
      m.innerHTML = `<h3>The Gate Opens</h3><p class="modal-sub">Something glitters in the hoard. Choose one relic.</p>
        <div class="pick-grid">${choices.map((r, i) => `
          <button class="pick-option" data-i="${i}">
            <span class="po-tag tag ${rarityClass(r.rarity)}">${r.rarity}</span>
            <div class="po-name">${r.name}</div><div class="po-desc">${r.desc}</div>
          </button>`).join('')}
        </div>`;
      m.querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
        const r = choices[+b.dataset.i];
        run.relics.push(r.id);
        SFX.unlock();
        toast(`Relic claimed: ${r.name}`, 'info');
        saveRun(run);
        close();
      });
    });
  }
  // bosses teach: claim a technique from your class pool (AOE often lives here)
  await offerSkillChoice();
  renderHud();
  nextFloorButton(document.getElementById('stage'));
}

/* ---------- trial + boss floors (fixed single cards) ---------- */
async function modifierFloor(stage) {
  const rng = runRng(run);
  const mod = rng.pick(MODIFIERS);
  const biome = biomeForFloor(run.floor);
  const group = pickEnemyGroup(rng, biome);
  rng.advance(); saveRun(run);

  stage.innerHTML = `
    <div class="card-stage"><div class="panel event-card">
      <div class="card-art"><div class="card-glyph">⚠️</div>
        <span class="tag card-type-tag">TRIAL</span><span class="tag card-floor-tag">FLOOR ${run.floor}</span></div>
      <div class="card-body">
        <h3>Trial Floor: ${mod.name}</h3>
        <div class="card-text">The tower posts terms for this floor, burned into the wall in letters that smoke slightly:\n\n"${mod.desc}"\n\nThere is no way around a trial floor. There is only through.</div>
        <div class="card-choices">
          <button class="choice-btn" id="go"><span class="choice-label">⚔ Accept the trial</span><span class="choice-hint">bonus loot</span></button>
        </div>
      </div>
    </div></div>`;
  applyCardBg(stage);
  SFX.cardDeal();
  document.getElementById('go').onclick = () => {
    SFX.click();
    fightGroup(stage, group, { text: `Trial: ${mod.name}.`, modifier: { ...mod, goldMult: (mod.goldMult || 1) * 1.5 } });
  };
}

async function bossFloor(stage) {
  const boss = BOSSES[run.floor];
  stage.innerHTML = `
    <div class="card-stage"><div class="panel event-card">
      <div class="card-art"><div class="card-glyph">${boss.glyph}</div>
        <span class="tag card-type-tag" style="border-color:var(--blood);color:#f0a8a0">BOSS</span>
        <span class="tag card-floor-tag">FLOOR ${run.floor}</span></div>
      <div class="card-body">
        <h3>${boss.name}</h3>
        <div class="card-text">${boss.intro}</div>
        <div class="card-choices">
          <button class="choice-btn" id="go"><span class="choice-label">⚔ Face it</span><span class="choice-hint">no retreat</span></button>
        </div>
      </div>
    </div></div>`;
  applyCardBg(stage);
  SFX.bossIntro();
  document.getElementById('go').onclick = async () => {
    SFX.click();
    const enemies = [buildEnemy(boss, run.floor, run.floor, { boss: true })];
    await fightGroupBoss(stage, enemies, boss);
  };
}

async function fightGroupBoss(stage, enemies, boss) {
  Music.play('boss');
  const rng = runRng(run);
  const { result, gold = 0, xp = 0, noDamage, usedUltimate } = await startCombat({
    container: stage, run, rng, enemies, introText: `${boss.name}: "${boss.taunt}"`, onHud: renderHud, onCharacter: () => characterSheet(),
  });
  if (result === 'dead') return endRun('dead');
  if (noDamage) unlock('untouchable');
  if (usedUltimate) unlock('overcharged');

  const achMap = { 10: 'floor_10', 20: 'floor_20', 30: 'floor_30', 40: 'floor_40', 50: 'floor_50' };
  if (achMap[run.floor]) unlock(achMap[run.floor]);
  if (run.floor === LAST_FLOOR) return victoryScreen('win');

  await afterVictory(stage, enemies, gold, xp, { boss });
}

/* ============================================================
   CO-OP FLOOR FLOW
   ============================================================ */
function buildPartyEnemies(specs, partySize) {
  const biome = biomeForFloor(run.floor);
  const hpMult = 1 + CONFIG.partyScaling.hpMultPerExtra * (partySize - 1);
  return specs.map(s => buildEnemy(s, run.floor, biome.floors[0], { hpMult }));
}

function buildSharedEnemies(specs, { boss = false } = {}) {
  const biome = biomeForFloor(run.floor);
  const hpMult = 1 + CONFIG.partyScaling.hpMultPerExtra * (coopS.partySize - 1);
  return specs.map(s => buildEnemy(s, run.floor, boss ? run.floor : biome.floors[0], { boss, hpMult }));
}

function hostPublishFloorContent() {
  const rng = runRng(run);
  const biome = biomeForFloor(run.floor);
  let content;
  if (run.floor === LAST_FLOOR) {
    content = { floor: run.floor, type: 'throne' };
  } else if (BOSS_FLOORS.includes(run.floor)) {
    const bossEnemies = buildSharedEnemies([BOSSES[run.floor]], { boss: true });
    if (coopS.partySize >= CONFIG.partyScaling.bossMinionAt) {
      const pool = (ENEMIES[biome.id] || ENEMIES.hell).filter(e => !e.elite);
      bossEnemies.push(...buildSharedEnemies([rng.pick(pool)]));
    }
    content = { floor: run.floor, type: 'boss', enemies: bossEnemies };
  } else if (run.floor % 5 === 0) {
    const mod = rng.pick(MODIFIERS);
    const group = pickEnemyGroup(rng, biome, coopS.partySize);
    content = { floor: run.floor, type: 'trial', modId: mod.id, enemies: buildSharedEnemies(group) };
  } else if (BOSS_FLOORS.includes(run.floor + 1)) {
    content = { floor: run.floor, type: 'event', eventId: 'campfire' };
  } else {
    const partyClasses = [run.classId, ...[...coopS.partners.values()].map(p => p.classId).filter(Boolean)];
    const cards = generateCards(rng, { partySize: coopS.partySize, classes: partyClasses });
    content = { floor: run.floor, type: 'cards', cards };
  }
  rng.advance();
  coopS.publishFloor(content);
}

async function coopFloor(stage) {
  coopS.broadcastStatus(statusOf(run, 'choosing'), 'choosing');

  if (coopS.isHost && !coopS.floorContent.has(run.floor)) {
    hostPublishFloorContent();
  }

  const content = await coopS.waitFloor(run.floor);
  saveRun(run);

  if (content.type === 'throne') return throneRoomCoop(stage);
  if (content.type === 'boss' || content.type === 'trial') {
    return sharedFightCard(stage, content);
  }
  if (content.type === 'cards') {
    return coopCardChoice(stage, content.cards);
  }
  const ev = EVENTS.find(e => e.id === content.eventId) || EVENTS.find(e => e.id === 'campfire');
  run.seenEvents.push(ev.id);
  saveRun(run);
  renderEventCard(stage, ev);
}

// Party card selection with decision modes (handoff §3, §4)
function coopCardChoice(stage, cards) {
  const mode = coopS.decisionMode || 'majority';
  const floor = run.floor;
  let api = null;
  const remotePicks = new Map();
  let resolved = false;
  const offs = [];

  // the party may have already decided while we were loading in
  if (coopS.cardResults.has(floor)) {
    const idx = coopS.cardResults.get(floor);
    renderTravelMap(stage, cards, { mode, bind(a) { a.lock(idx); }, onLocalPick() {} }, travelCtx());
    return;
  }

  const finish = idx => {
    if (resolved) return;
    resolved = true;
    for (const off of offs) off();
    api?.lock(idx);
  };

  offs.push(coopS.net.on('pick', (d, from) => {
    if (d.floor !== floor || resolved) return;
    remotePicks.set(from, d.idx);
    api?.picks.set(from, d.idx);
    api?.renderVotes();
    if (mode === 'first' && coopS.isHost) {
      // host arbitrates first-selection: first pick it learns about wins
      coopS.net.send({ k: 'cardresult', floor, idx: d.idx });
      finish(d.idx);
    } else if (mode === 'majority' && coopS.isHost) {
      hostTallyIfComplete();
    }
  }));
  offs.push(coopS.net.on('cardresult', d => {
    if (d.floor !== floor) return;
    finish(d.idx);
  }));

  function hostTallyIfComplete() {
    const all = new Map([...remotePicks, ...(api?.picks.has(coopS.you) ? [[coopS.you, api.picks.get(coopS.you)]] : [])]);
    if (all.size < coopS.partySize) return;
    // tally; ties resolved randomly, synchronized via broadcast (handoff §3)
    const counts = {};
    for (const idx of all.values()) counts[idx] = (counts[idx] || 0) + 1;
    const max = Math.max(...Object.values(counts));
    const tied = Object.keys(counts).filter(k => counts[k] === max).map(Number);
    const rng = runRng(run);
    const winner = tied.length === 1 ? tied[0] : rng.pick(tied);
    rng.advance();
    coopS.net.send({ k: 'cardresult', floor, idx: winner });
    finish(winner);
  }

  renderTravelMap(stage, cards, {
    mode,
    bind(a) { api = a; },
    onLocalPick(idx) {
      if (mode === 'first') {
        if (coopS.isHost) {
          coopS.net.send({ k: 'cardresult', floor, idx });
          finish(idx);
        }
        // guests wait for the host's cardresult (their pick may still win the race)
      } else if (coopS.isHost) {
        hostTallyIfComplete();
      }
    },
  }, travelCtx());
}

async function sharedFightCard(stage, content) {
  const enemies = rehydrateEnemies(content.enemies);
  const boss = content.type === 'boss' ? BOSSES[run.floor] : null;
  const mod = content.modId ? MODIFIERS.find(m => m.id === content.modId) : null;
  const names = [...new Set(enemies.map(g => g.name))].join(', ');

  const title = boss ? boss.name : mod ? `Trial Floor: ${mod.name}` : 'Hostiles Ahead';
  const text = boss ? boss.intro
    : mod ? `The tower posts terms for this floor:\n\n"${mod.desc}"\n\nThere is no way around a trial floor. There is only through — together.`
    : `The floor narrows, and the dark produces: ${names}. They have noticed all of you. Your party stands together — there is no sneaking in numbers.`;

  stage.innerHTML = `
    <div class="card-stage"><div class="panel event-card">
      <div class="card-art"><div class="card-glyph">${boss ? boss.glyph : mod ? '⚠️' : enemies[0].glyph}</div>
        <span class="tag card-type-tag" ${boss ? 'style="border-color:var(--blood);color:#f0a8a0"' : ''}>${boss ? 'BOSS' : mod ? 'TRIAL' : 'ENCOUNTER'}</span>
        <span class="tag card-floor-tag">FLOOR ${run.floor}</span></div>
      <div class="card-body">
        <h3>${title}</h3>
        <div class="card-text">${text}</div>
        <div class="card-choices">
          <button class="choice-btn" id="go"><span class="choice-label">⚔ Stand together</span><span class="choice-hint" id="gate-hint">waiting for the party…</span></button>
        </div>
      </div>
    </div></div>`;
  if (boss) SFX.bossIntro(); else SFX.cardDeal();

  document.getElementById('go').onclick = async () => {
    SFX.click();
    const btn = document.getElementById('go');
    btn.disabled = true;
    btn.querySelector('#gate-hint').textContent = 'the party gathers…';
    coopS.onGateProgress = () => {
      const g = coopS.gateProgress(`fight-${run.floor}`);
      const hint = document.getElementById('gate-hint');
      if (hint) hint.textContent = `${g.have}/${g.need} ready…`;
    };
    await coopS.gate(`fight-${run.floor}`);
    coopS.onGateProgress = null;
    coopFightShared(stage, enemies, { boss, mod });
  };
}

async function coopFightShared(stage, enemies, { boss = null, mod = null } = {}) {
  Music.play(boss ? 'boss' : 'battle');
  coopS.broadcastStatus(statusOf(run, 'fighting'), 'fighting');
  const rng = runRng(run);
  const { result, gold = 0, xp = 0, noDamage, usedUltimate } = await startCombat({
    container: stage, run, rng, enemies,
    modifier: mod ? { ...mod, goldMult: (mod.goldMult || 1) * 1.5 } : null,
    introText: boss ? `${boss.name}: "${boss.taunt}"` : 'Side by side, blades out.',
    onHud: renderHud, onCharacter: () => characterSheet(),
    coop: coopS,
  });

  if (result === 'wipe') return endRun('dead');
  if (noDamage) unlock('untouchable');
  if (usedUltimate) unlock('overcharged');

  const d = derived(run);
  const goldGain = Math.round(gold * d.goldMult * d.combatGoldMult);
  const xpGain = Math.round(xp * d.xpMult);

  if (boss) {
    const achMap = { 10: 'floor_10', 20: 'floor_20', 30: 'floor_30', 40: 'floor_40', 50: 'floor_50' };
    if (achMap[run.floor]) unlock(achMap[run.floor]);
    if (run.floor === LAST_FLOOR) return victoryScreen('win');
  }
  await afterVictory(stage, enemies, goldGain, xpGain, { boss });
}

/* ---------- co-op throne room ---------- */
async function throneRoomCoop(stage) {
  const boss = BOSSES[51];
  if (coopS.isHost) return throneRoom(stage);
  stage.innerHTML = `
    <div class="card-stage"><div class="panel event-card">
      <div class="card-art"><div class="card-glyph">${boss.glyph}</div>
        <span class="tag card-type-tag" style="border-color:var(--blood);color:#f0a8a0">THE THRONE</span>
        <span class="tag card-floor-tag">FLOOR 51</span></div>
      <div class="card-body">
        <h3>${boss.name}</h3>
        <div class="card-text">${boss.intro}\n\nThe King's gaze settles on your party's leader. Whatever is said next is said for all of you.</div>
        <div class="card-choices"><div class="modifier-banner" style="border-color:var(--panel-edge);color:var(--ink-dim)">⏳ The party leader answers the King…</div></div>
      </div>
    </div></div>`;
  applyCardBg(stage);
  SFX.bossIntro();
  const handleThrone = async d => {
    if (d.ending === 'secret') return secretEnding(stage);
    const enemies = rehydrateEnemies(d.enemies);
    await coopS.gate('fight-51');
    coopFightShared(stage, enemies, { boss });
  };
  if (coopS.throneMsg) return handleThrone(coopS.throneMsg);
  const off = coopS.net.on('throne', d => { off(); handleThrone(d); });
}

function rehydrateEnemies(list) {
  return list.map(e => ({ ...e, statuses: e.statuses || {}, phaseTriggers: e.phaseTriggers || [], charge: e.charge || 0 }));
}

/* ============================================================
   EVENT CARDS
   ============================================================ */
function reqMet(req) {
  if (!req) return { ok: true };
  const d = derived(run);
  // requirement hints never reveal your numbers (handoff §5)
  if (req.stat && d[req.stat] < req.min) return { ok: false, why: 'you lack the ' + ({ str: 'strength', dex: 'deftness', int: 'learning', wis: 'insight', lk: 'fortune' }[req.stat] || 'gift') };
  if (req.class && run.classId !== req.class) return { ok: false, why: `${CLASSES[req.class].name} only` };
  if (req.gold && run.gold < req.gold) return { ok: false, why: `${req.gold}g needed` };
  if (req.fame && run.fame < req.fame) return { ok: false, why: 'your name is not yet known' };
  if (req.flag && !run.flags[req.flag]) return { ok: false, why: '???' };
  if (req.notFlag && run.flags[req.notFlag]) return { ok: false, why: 'unavailable' };
  if (req.item && !run.consumables.includes(req.item)) return { ok: false, why: 'item needed' };
  return { ok: true };
}

const TYPE_LABEL = { story: 'STORY', risk: 'RISK', blessing: 'BLESSING', treasure: 'TREASURE', rest: 'RESPITE', shop: 'MERCHANT' };

const MINIGAME_EVENTS = ['gambler', 'demon_gambler', 'wheel_of_the_tower', 'sparring_ring'];

function renderEventCard(stage, ev, { originIntro = false } = {}) {
  if (ev.shop) return shopScreen(stage, ev);
  if (ev.type === 'rest') Music.play('rest');
  else if (MINIGAME_EVENTS.includes(ev.id)) Music.play('minigame');

  stage.innerHTML = `
    <div class="card-stage"><div class="panel event-card">
      <div class="card-art"><div class="card-glyph">${ev.glyph}</div>
        <span class="tag card-type-tag">${originIntro ? 'ORIGIN' : TYPE_LABEL[ev.type] || 'EVENT'}</span>
        <span class="tag card-floor-tag">${originIntro ? 'THE DAY BEFORE' : `FLOOR ${run.floor}`}</span></div>
      <div class="card-body">
        <h3>${ev.title}</h3>
        <div class="card-text">${ev.text}</div>
        <div class="card-choices" id="choices"></div>
      </div>
    </div></div>`;
  applyCardBg(stage);
  SFX.cardDeal();

  const box = document.getElementById('choices');
  ev.choices.forEach(choice => {
    const r = reqMet(choice.req);
    const btn = el(`<button class="choice-btn ${r.ok ? '' : 'locked'}" ${r.ok ? '' : 'disabled'}>
      <span class="choice-label">${choice.label}</span>
      <span class="choice-hint ${choice.req ? 'choice-req' : ''}">${r.ok ? (choice.hint || '') : `🔒 ${r.why}`}</span>
    </button>`);
    btn.onclick = () => { SFX.click(); resolveChoice(stage, ev, choice, { originIntro }); };
    box.appendChild(btn);
  });
}

async function resolveChoice(stage, ev, choice, opts = {}) {
  const rng = runRng(run);
  let outcome = choice.outcome;

  if (outcome.roll) {
    const d = derived(run);
    const spec = outcome.roll;
    let bonus = Math.floor(d.lk / 4);
    if (spec.bonusFlag && run.flags[spec.bonusFlag.flag]) bonus += spec.bonusFlag.bonus;
    if (spec.penaltyFlag && run.flags[spec.penaltyFlag.flag]) bonus -= spec.penaltyFlag.penalty;
    const die = rng.int(1, 8);
    const total = d[spec.stat] + die + bonus;
    const ok = total >= spec.dc;
    // the roll's drama, without the actuarial tables (handoff §5)
    const rollLine = { text: `${({ str: 'Strength', dex: 'Agility', int: 'Intellect', wis: 'Wisdom', lk: 'Luck' }[spec.stat])} is tested… ${ok ? 'and holds. SUCCESS.' : 'and falters. FAILURE.'}`, cls: ok ? 'good' : 'bad' };
    outcome = ok ? outcome.success : outcome.fail;
    await applyOutcome(stage, ev, outcome, rng, [rollLine], opts);
  } else {
    await applyOutcome(stage, ev, outcome, rng, [], opts);
  }
}

async function applyOutcome(stage, ev, o, rng, lines, opts = {}) {
  const d = derived(run);

  if (o.randomOutcome) {
    // random-roll resolution: the tower picks (handoff §3)
    o = rng.pick(o.randomOutcome);
    lines.push({ text: 'The tower decides…', cls: 'item' });
  }

  if (o.escape) return victoryScreen('escape');

  if (o.text) lines.push({ text: o.text, cls: '' });

  if (o.chest) {
    const isMimic = !o.safeMimic && !relicItems(run).some(r => r.noMimic) && rng.chance(ev.mimicChance || 0.25);
    if (isMimic) {
      rng.advance(); saveRun(run);
      const mimic = { id: 'mimic', name: 'Mimic', glyph: '🦷', hp: 30 + run.floor * 4, atk: 6 + run.floor, def: 2, spd: 7, gold: [40 + run.floor * 3, 60 + run.floor * 4], xp: 15 + run.floor * 2 };
      return fightGroup(stage, [mimic], { text: 'The chest grows TEETH. Of course it does.' });
    }
    const gold = Math.round((30 + run.floor * 4 + rng.int(0, 25)) * d.goldMult);
    run.gold += gold; run.goldEarned += gold;
    lines.push({ text: `The chest is honest for once. +${gold} gold`, cls: 'gold' });
    SFX.gold();
    if (rng.chance(0.35)) {
      const item = rollEquipment(rng, biomeTier(), Math.floor(d.lk / 3));
      await offerEquipment(item, lines);
    } else if (rng.chance(0.3)) {
      const c = rng.pick(CONSUMABLES);
      run.consumables.push(c.id);
      lines.push({ text: `Tucked in the corner: ${c.name}.`, cls: 'item' });
    }
  }

  if (o.gold) {
    const amt = o.gold > 0 ? Math.round(o.gold * d.goldMult) : o.gold;
    run.gold = Math.max(0, run.gold + amt);
    if (amt > 0) { run.goldEarned += amt; SFX.gold(); }
    lines.push({ text: `${amt > 0 ? '+' : ''}${amt} gold`, cls: 'gold' });
  }
  if (o.goldPct) {
    const amt = Math.round(run.gold * o.goldPct);
    run.gold = Math.max(0, run.gold + amt);
    lines.push({ text: `${amt} gold`, cls: 'bad' });
  }
  if (o.hp) {
    if (o.hp > 0) heal(run, o.hp); else run.hp = Math.max(0, run.hp + o.hp);
    lines.push({ text: `${o.hp > 0 ? '+' : ''}${o.hp} HP`, cls: o.hp > 0 ? 'good' : 'bad' });
    if (o.hp < 0) SFX.bad();
  }
  if (o.hpPct) {
    const amt = Math.round(run.maxHp * o.hpPct);
    if (amt > 0) heal(run, amt); else run.hp = Math.max(0, run.hp + amt);
    lines.push({ text: `${amt > 0 ? '+' : ''}${amt} HP`, cls: amt > 0 ? 'good' : 'bad' });
  }
  if (o.maxHp) { run.maxHp += o.maxHp; run.hp += o.maxHp; lines.push({ text: 'You feel your endurance deepen.', cls: 'good' }); }
  if (o.fullHeal) { run.hp = run.maxHp; lines.push({ text: 'Fully healed.', cls: 'good' }); SFX.heal(); }
  if (o.mana) restoreMana(run, o.mana);
  if (o.manaPct) { restoreMana(run, run.maxMp * o.manaPct); lines.push({ text: `${resourceName(run)} restored.`, cls: 'good' }); }
  if (o.fullMana) { run.mp = run.maxMp; lines.push({ text: `${resourceName(run)} restored.`, cls: 'good' }); }
  if (o.fame) {
    const amt = changeFame(run, o.fame);
    lines.push({ text: `${amt > 0 ? '+' : ''}${amt} Fame`, cls: amt >= 0 ? 'good' : 'bad' });
  }
  if (o.statUp) {
    run.stats[o.statUp.stat] = Math.max(1, run.stats[o.statUp.stat] + o.statUp.amt);
    lines.push(o.statUp.amt > 0
      ? { text: 'Something in you grows stronger.', cls: 'good' }
      : { text: 'Something in you is... lessened. You can\'t name what.', cls: 'bad' });
  }
  if (o.statUpRandom) {
    for (let i = 0; i < o.statUpRandom; i++) {
      run.stats[rng.pick(APPRAISABLE)]++;
    }
    lines.push({ text: 'Power settles into you — you couldn\'t say where.', cls: 'good' });
    SFX.levelup();
  }
  // directed growth: train the class's own governing stat (build-enabling)
  if (o.statUpMain) {
    const main = CLASSES[run.classId].growthBias[0];
    run.stats[main] += o.statUpMain;
    lines.push({ text: 'You lean into what you already are — and it answers.', cls: 'good' });
    SFX.levelup();
  }
  // scaling growth: deeper floors give a bigger permanent gain (build-directed)
  if (o.statUpScaled) {
    const amt = o.statUpScaled + Math.floor(run.floor / 12);
    const stat = rng.pick(CLASSES[run.classId].growthBias.slice(0, 2));
    run.stats[stat] += amt;
    lines.push({ text: 'A surge of growth takes root — stronger for how far you\'ve climbed.', cls: 'good' });
    SFX.levelup();
  }

  if (o.appraisal) {
    appraiseRun(rng, run, { partial: o.appraisal === 'partial', location: ev.title });
    unlock('assessed');
    lines.push({ text: '📜 The reading is complete. Your character page now carries the appraisal.', cls: 'item' });
    SFX.unlock();
  }
  if (o.promoteRace) {
    const p = applyRacePromotion(run);
    if (p) {
      lines.push({ text: `🧬 ${p.blurb}\n\nYou are ${run.raceName === 'Awakened Human' ? 'an' : 'a'} ${run.raceName} now.`, cls: 'item' });
      unlock('promoted');
      SFX.evolve();
    }
  }

  if (o.itemRoll) {
    const item = rollEquipment(rng, biomeTier(), Math.floor(d.lk / 3));
    await offerEquipment(item, lines);
  }
  if (o.item) {
    const item = itemById(o.item);
    if (item.slot) await offerEquipment(item, lines);
    else { run.consumables.push(item.id); lines.push({ text: `Received: ${item.name}`, cls: 'item' }); }
  }
  if (o.relicRoll) {
    const r = rollRelic(rng, run.relics, Math.floor(d.lk / 3));
    if (r) { run.relics.push(r.id); lines.push({ text: `Relic: ${r.name} — ${r.desc}`, cls: 'item' }); SFX.unlock(); }
  }
  if (o.consumable) {
    run.consumables.push(o.consumable);
    lines.push({ text: `Received: ${itemById(o.consumable).name}`, cls: 'item' });
  }
  if (o.consumable2) {
    run.consumables.push(o.consumable2);
    lines.push({ text: `Received: ${itemById(o.consumable2).name}`, cls: 'item' });
  }
  if (o.useItem) {
    const i = run.consumables.indexOf(o.useItem);
    if (i > -1) run.consumables.splice(i, 1);
  }
  if (o.learnAoe) {
    const aoeId = CLASSES[run.classId].aoeSkill;
    if (aoeId && !run.knownSkills.includes(aoeId)) {
      lines.push({ text: `The technique takes root: ${SKILLS[aoeId].name}.`, cls: 'item' });
      await maybeEquipSkill(SKILLS[aoeId]);
    } else {
      lines.push({ text: 'The lesson sharpens what you already know.', cls: 'good' });
      run.xp += 20;
    }
  }
  if (o.upgradeWeapon) {
    const bonus = o.upgradeScaled ? 4 + Math.floor(run.floor / 8) : 4;
    run.weaponBonus += bonus;
    lines.push({ text: `Your weapon sings a new, sharper note. (+${bonus} damage, permanent)`, cls: 'item' });
    SFX.unlock();
  }

  if (o.flag) run.flags[o.flag] = true;
  if (o.clearFlag) delete run.flags[o.clearFlag];
  if (o.sigil && !run.sigils.includes(o.sigil)) {
    run.sigils.push(o.sigil);
    lines.push({ text: `✦ Sigil acquired (${run.sigils.length}/3). Something in the tower shifts.`, cls: 'item' });
    SFX.evolve();
  }
  if (o.revealFloors) {
    const upcoming = [];
    for (let f = run.floor + 1; f <= Math.min(run.floor + o.revealFloors, LAST_FLOOR); f++) {
      upcoming.push(`F${f}: ${f === LAST_FLOOR ? 'THE THRONE' : BOSS_FLOORS.includes(f) ? 'BOSS' : f % 5 === 0 ? 'Trial' : 'Unknown cards'}`);
    }
    lines.push({ text: `The map shows: ${upcoming.join(' · ')}`, cls: 'item' });
  }

  let ups = [];
  if (o.xp) {
    const amt = Math.round(o.xp * d.xpMult);
    ups = gainXp(run, amt, rng);
    lines.push({ text: `+${amt} XP`, cls: 'good' });
  }

  rng.advance();
  saveRun(run);
  renderHud();
  if (coopS) coopS.broadcastStatus(statusOf(run, 'choosing'), 'choosing');

  if (o.combat) {
    const biome = biomeForFloor(run.floor);
    const specs = o.combat.enemies.map(id => {
      for (const pool of Object.values(ENEMIES)) {
        const found = pool.find(e => e.id === id);
        if (found) return found;
      }
      return ENEMIES[biome.id][0];
    });
    if (lines.length) await showOutcomePanel(stage, lines, ups, { continueLabel: 'Steel yourself', advance: false });
    return fightGroup(stage, specs, { text: o.combat.text });
  }

  if (run.hp <= 0) {
    if (coopS && !coopS.alone) {
      run.down = true;
      saveRun(run);
      coopS.broadcastStatus(statusOf(run, 'waiting'), 'waiting');
      lines.push({ text: 'The tower takes you — almost. Your companions refuse to let it finish the job.', cls: 'bad' });
      return showOutcomePanel(stage, lines, ups);
    }
    return endRun('dead');
  }

  // origin intros lead into floor 1 instead of "the next floor"
  if (opts.originIntro) {
    await showOutcomePanel(stage, lines, ups, { continueLabel: 'The tower awaits — Floor 1', advance: false });
    return enterFloorScreen(true);
  }

  await showOutcomePanel(stage, lines, ups);
}

function biomeTier() {
  return { forest: 1, ruins: 2, frost: 3, swamp: 4, hell: 5, throne: 5 }[run.biomeId] || 1;
}

/* ---------- co-op death penalty: lose a few lesser items (handoff §16) ---------- */
function deathItemLoss() {
  const lost = [];
  const rng = runRng(run);
  // eligible: consumables + low-rarity pack gear; protected: equipped, epic+
  const eligible = [];
  run.consumables.forEach((id, i) => eligible.push({ kind: 'consumable', i, id }));
  run.inventory.forEach((id, i) => {
    const it = itemById(id);
    if (it && !CONFIG.death.protectedRarities.includes(it.rarity)) eligible.push({ kind: 'inventory', i, id });
  });
  const shuffled = rng.shuffle(eligible).slice(0, CONFIG.death.itemsLost);
  // remove by id (indexes shift as we splice)
  for (const pick of shuffled) {
    if (pick.kind === 'consumable') {
      const idx = run.consumables.indexOf(pick.id);
      if (idx > -1) { run.consumables.splice(idx, 1); lost.push(itemById(pick.id)?.name || pick.id); }
    } else {
      const idx = run.inventory.indexOf(pick.id);
      if (idx > -1) { run.inventory.splice(idx, 1); lost.push(itemById(pick.id)?.name || pick.id); }
    }
  }
  rng.advance();
  return lost;
}

/* ---------- equipment offer / compare ---------- */
function gearCard(item, label) {
  if (!item) return `<div class="gear-card empty"><div class="gc-label">${label}</div><div class="gc-name" style="color:var(--ink-faint)">— nothing —</div></div>`;
  return `<div class="gear-card">
    <div class="gc-label">${label}</div>
    ${itemIconHtml(item.id, 44)}
    <div class="gc-name ${rarityClass(item.rarity)}">${item.name}</div>
    <div class="gc-rarity tag ${rarityClass(item.rarity)}">${item.rarity} ${item.slot}${item.wtype ? ' · ' + item.wtype : ''}</div>
    <div class="gc-desc">${item.desc}</div>
    ${item.wtype && !allowedWeaponTypes(run).includes(item.wtype) ? '<div class="gc-warn">⚠ Incompatible with your class — equipping it disables all techniques except Strike and Guard.</div>' : ''}
  </div>`;
}

function slotFor(item) {
  if (item.slot !== 'accessory') return item.slot;
  // accessories fill the first open ring, else replace accessory1
  for (const s of ['accessory1', 'accessory2', 'accessory3']) if (!run.equipment[s]) return s;
  return 'accessory1';
}

function equipItem(item, targetSlot = null) {
  const slot = targetSlot || slotFor(item);
  const oldId = run.equipment[slot];
  if (oldId) run.inventory.push(oldId);
  const bagIdx = run.inventory.indexOf(item.id);
  if (bagIdx > -1) run.inventory.splice(bagIdx, 1);
  run.equipment[slot] = item.id;
  if (item.rarity === 'legendary') unlock('legendary');
}

async function offerEquipment(item, lines) {
  const compareSlot = slotFor(item);
  const current = run.equipment[compareSlot] ? itemById(run.equipment[compareSlot]) : null;
  const sellPrice = Math.round(item.price * 0.6);
  const v = await modal(`
    <h3>Loot!</h3>
    <div class="gear-compare">
      ${gearCard(item, 'FOUND')}
      <div class="gear-vs">vs</div>
      ${gearCard(current, 'EQUIPPED')}
    </div>
    <div class="pick-grid">
      <button class="pick-option" data-close="equip"><span class="po-name">Equip it</span><span class="po-desc">${current ? `${current.name} goes into your pack.` : ''}</span></button>
      <button class="pick-option" data-close="stash"><span class="po-name">Stash it</span><span class="po-desc">Keep it in your pack — swap anytime from the Character screen.</span></button>
      <button class="pick-option" data-close="sell"><span class="po-name">Sell it — ${sellPrice}g</span></button>
    </div>`);
  if (v === 'equip') {
    equipItem(item);
    lines.push({ text: `Equipped: ${item.name}`, cls: 'item' });
  } else if (v === 'stash') {
    run.inventory.push(item.id);
    lines.push({ text: `Stashed: ${item.name}`, cls: 'item' });
  } else {
    run.gold += sellPrice;
    run.goldEarned += sellPrice;
    lines.push({ text: `Sold ${item.name} for ${sellPrice}g`, cls: 'gold' });
    SFX.gold();
  }
  renderHud();
}

/* ---------- outcome panel + level-ups ---------- */
async function showOutcomePanel(stage, lines, ups = [], { continueLabel = 'Ascend to the next floor', advance = true } = {}) {
  for (const up of ups) await levelUpModal(up);

  const panel = el(`
    <div class="card-stage"><div class="panel event-card card-outcome">
      <div class="card-body">
        <div class="outcome-lines">${lines.map(l => `<div class="outcome-line ${l.cls}">${l.text}</div>`).join('')}</div>
        <div class="card-choices"><button class="choice-btn" id="continue"><span class="choice-label">${continueLabel}</span><span class="choice-hint">⟶</span></button></div>
      </div>
    </div></div>`);
  stage.innerHTML = '';
  stage.appendChild(panel);
  renderHud();
  Music.play(BIOME_MUSIC[run.biomeId] || 'forest');
  await new Promise(r => document.getElementById('continue').onclick = () => { SFX.click(); r(); });
  if (advance) {
    if (coopS) await coopAdvance(document.getElementById('continue'));
    nextFloor();
  }
}

async function coopAdvance(btnEl) {
  coopS.broadcastStatus(statusOf(run, 'waiting'), 'waiting');
  if (btnEl) {
    btnEl.disabled = true;
    const hint = btnEl.querySelector('.choice-hint');
    if (hint) hint.textContent = 'waiting for the party…';
    coopS.onGateProgress = () => {
      const g = coopS.gateProgress(`adv-${run.floor}`);
      if (hint) hint.textContent = `${g.have}/${g.need} at the stairs…`;
    };
  }
  await coopS.gate(`adv-${run.floor}`);
  coopS.onGateProgress = null;
}

function nextFloorButton(stage) {
  const panel = el(`
    <div class="card-stage"><div class="panel event-card card-outcome">
      <div class="card-body">
        <div class="card-choices"><button class="choice-btn" id="continue"><span class="choice-label">Ascend to the next floor</span><span class="choice-hint">⟶</span></button></div>
      </div>
    </div></div>`);
  stage.innerHTML = '';
  stage.appendChild(panel);
  document.getElementById('continue').onclick = async () => {
    SFX.click();
    if (coopS) await coopAdvance(document.getElementById('continue'));
    nextFloor();
  };
}

/* ---------- level-ups, subclass advancement (handoff §21) ---------- */
const LEVEL_FLAVOR = [
  'Your wounds knit. The tower feels a fraction smaller.',
  'Something settles into your bones — you are more than you were a floor ago.',
  'The climb is carving you into something the climb should worry about.',
  'Strength arrives quietly, like it was always yours and just got lost in the mail.',
];

const SKILL_OFFER_LEVELS = [3, 5, 8, 11, 14, 17, 20, 24];

async function levelUpModal(up) {
  SFX.levelup();
  await modal(`
    <div class="levelup-burst">✨</div>
    <h3 style="text-align:center">Level ${up.level}!</h3>
    <p class="modal-sub" style="text-align:center">${LEVEL_FLAVOR[up.level % LEVEL_FLAVOR.length]}</p>
    <div class="pick-grid"><button class="pick-option" data-close="x" style="text-align:center"><span class="po-name">Continue</span></button></div>`);

  // level 6: the subclass choice — secret options appear unannounced
  if (up.evolutionChoice?.length) {
    await modalCustom((m, close) => {
      m.innerHTML = `<h3>The Path Divides</h3>
        <p class="modal-sub">The tower recognizes what you are becoming — and offers a choice it will hold you to. This cannot be undone this climb.</p>
        <div class="pick-grid">
          ${up.evolutionChoice.map((s, i) => `
            <button class="pick-option ${s.secret ? 'secret-path' : ''}" data-i="${i}">
              ${s.secret ? '<span class="po-tag tag" style="border-color:var(--gold);color:var(--gold-bright)">✦ hidden path</span>' : ''}
              <div class="po-name">${s.name}</div>
              <div class="po-desc">${s.hint}</div>
            </button>`).join('')}
        </div>`;
      m.querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
        const sub = up.evolutionChoice[+b.dataset.i];
        applySubclassFn(run, sub);
        if (sub.secret) unlock('secret_class');
        SFX.evolve();
        close();
        modal(`
          <div class="levelup-burst">🌟</div>
          <h3 style="text-align:center">EVOLUTION — ${sub.name}!</h3>
          <p class="modal-sub" style="text-align:center">${sub.blurb}</p>
          <div class="pick-grid"><button class="pick-option" data-close="x" style="text-align:center"><span class="po-name">Rise</span></button></div>`).then(async () => {
          if (sub.skill) await maybeEquipSkill(SKILLS[sub.skill]);
          saveRun(run);
          renderHud();
        });
      });
    });
  }

  // level 13: the deeper branch arrives on its own
  if (up.deeper) {
    applySubclassFn(run, up.deeper);
    SFX.evolve();
    await modal(`
      <div class="levelup-burst">🌟</div>
      <h3 style="text-align:center">EVOLUTION — ${up.deeper.name}!</h3>
      <p class="modal-sub" style="text-align:center">${up.deeper.blurb}</p>
      <div class="pick-grid"><button class="pick-option" data-close="x" style="text-align:center"><span class="po-name">Rise</span></button></div>`);
    if (up.deeper.skill) await maybeEquipSkill(SKILLS[up.deeper.skill]);
    saveRun(run);
    renderHud();
  }

  if (SKILL_OFFER_LEVELS.includes(up.level)) {
    await offerSkillChoice();
  }
}

// The climb teaches: pick one technique from your class pool (level-ups and
// boss victories both call this — bosses are where AOE usually arrives).
async function offerSkillChoice() {
  {
    const rng = runRng(run);
    const pool = rng.shuffle(learnableSkills(run)).slice(0, 3);
    rng.advance();
    if (pool.length) {
      await modalCustom((m, close) => {
        m.innerHTML = `<h3>New Technique</h3><p class="modal-sub">The climb teaches. Choose one skill to learn.</p>
          <div class="pick-grid">
            ${pool.map((s, i) => `<button class="pick-option" data-i="${i}">
              <span class="po-tag tag">${s.cost ? s.cost + ' ' + resourceName(run) : ''}${s.charge ? ' +' + s.charge + '⚡' : ''}${!s.cost && !s.charge ? 'FREE' : ''}</span>
              <div class="po-name">${s.name}</div><div class="po-desc">${s.desc}</div>
            </button>`).join('')}
            <button class="pick-option" data-skip="1"><div class="po-name" style="color:var(--ink-dim)">Skip — stay sharp with what you know</div></button>
          </div>`;
        m.querySelectorAll('[data-i]').forEach(b => b.onclick = async () => {
          const sk = pool[+b.dataset.i];
          run.knownSkills.push(sk.id);
          close();
          await maybeEquipSkill(sk);
          saveRun(run);
        });
        m.querySelector('[data-skip]').onclick = () => close();
      });
    }
  }
}

async function maybeEquipSkill(sk) {
  if (!sk) return;
  if (!run.knownSkills.includes(sk.id)) run.knownSkills.push(sk.id);
  if (run.skills.length < 4) {
    run.skills.push(sk.id);
    toast(`Learned ${sk.name}`, 'info');
  } else {
    await swapSkillModal(sk);
  }
}

async function swapSkillModal(newSkill) {
  await modalCustom((m, close) => {
    m.innerHTML = `<h3>Equip ${newSkill.name}?</h3><p class="modal-sub">You can carry four techniques into battle (plus Strike and Guard, always). Replace one, or keep it in reserve.</p>
      <div class="pick-grid">
        ${run.skills.map((id, i) => `<button class="pick-option" data-i="${i}">
          <div class="po-name">Replace ${SKILLS[id].name}</div><div class="po-desc">${SKILLS[id].desc}</div>
        </button>`).join('')}
        <button class="pick-option" data-skip="1"><div class="po-name" style="color:var(--ink-dim)">Keep in reserve</div></button>
      </div>`;
    m.querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
      run.skills[+b.dataset.i] = newSkill.id;
      toast(`${newSkill.name} equipped`, 'info');
      close();
    });
    m.querySelector('[data-skip]').onclick = () => close();
  });
}

/* ============================================================
   SHOP
   ============================================================ */
async function shopScreen(stage, ev) {
  Music.play('rest');
  const rng = runRng(run);
  const tier = biomeTier();
  const stock = [];
  const cons = rng.shuffle(CONSUMABLES.filter(c => !c.appraisal)).slice(0, 3);
  cons.forEach(c => stock.push({ kind: 'consumable', item: c, price: c.price }));
  if (rng.chance(0.4)) stock.push({ kind: 'consumable', item: CONSUMABLES.find(c => c.appraisal), price: 90 });
  for (let i = 0; i < 2; i++) {
    const item = rollEquipment(rng, tier, 2);
    if (!stock.some(s => s.item.id === item.id)) stock.push({ kind: 'equip', item, price: item.price });
  }
  if (rng.chance(0.5)) {
    const r = rollRelic(rng, run.relics);
    if (r) stock.push({ kind: 'relic', item: r, price: 120 + tier * 40 });
  }
  rng.advance(); saveRun(run);

  // fame opens wallets and lowers prices (handoff §18)
  const discount = run.fame >= CONFIG.fame.shopDiscountAt ? CONFIG.fame.shopDiscountPct : 0;

  function price(p) { return Math.round(p * (1 - discount)); }

  function render() {
    const healCost = Math.max(10, Math.round((run.maxHp - run.hp) * 0.8 * (1 - discount)));
    stage.innerHTML = `
      <div class="card-stage"><div class="panel event-card">
        <div class="card-art"><div class="card-glyph">🧳</div>
          <span class="tag card-type-tag">MERCHANT</span><span class="tag card-floor-tag">FLOOR ${run.floor}</span></div>
        <div class="card-body">
          <h3>${ev.title}</h3>
          <div class="card-text">"Browse, browse! Prices reflect the difficulty of my supply chain, which is <i>vertical</i>."${discount ? '<br/><i>"Wait — I know that face! For a climber of your reputation, a consideration."</i> (fame discount)' : ''}</div>
          <div class="shop-list">
            ${stock.map((s, i) => `
              <div class="shop-item">
                ${itemIconHtml(s.item.id, 32)}
                <div class="si-info"><div class="si-name ${rarityClass(s.item.rarity)}">${s.item.name}</div><div class="si-desc">${s.item.desc}</div></div>
                <span class="si-price">🪙 ${price(s.price)}</span>
                <button class="btn small ${run.gold >= price(s.price) ? 'primary' : ''}" data-i="${i}" ${run.gold < price(s.price) ? 'disabled' : ''}>Buy</button>
              </div>`).join('')}
            <div class="shop-item">
              <div class="si-info"><div class="si-name">Patch you up</div><div class="si-desc">Full heal. "I studied medicine for a week."</div></div>
              <span class="si-price">🪙 ${healCost}</span>
              <button class="btn small" id="buy-heal" ${run.gold < healCost || run.hp >= run.maxHp ? 'disabled' : ''}>Buy</button>
            </div>
          </div>
          <div class="card-choices"><button class="choice-btn" id="leave"><span class="choice-label">Take your leave</span><span class="choice-hint">⟶</span></button></div>
        </div>
      </div></div>`;

    stage.querySelectorAll('[data-i]').forEach(btn => btn.onclick = async () => {
      const s = stock[+btn.dataset.i];
      const p = price(s.price);
      if (run.gold < p) return;
      run.gold -= p;
      SFX.gold();
      if (s.kind === 'consumable') {
        if (s.item.appraisal) {
          const rng2 = runRng(run);
          appraiseRun(rng2, run, { partial: false, location: 'a merchant\'s scroll' });
          rng2.advance();
          toast('The scroll reads you. Check your Character page.', 'info');
        } else {
          run.consumables.push(s.item.id);
          toast(`Bought ${s.item.name}`);
        }
      }
      if (s.kind === 'relic') { run.relics.push(s.item.id); toast(`Relic: ${s.item.name}`, 'info'); SFX.unlock(); }
      if (s.kind === 'equip') { const lines = []; await offerEquipment(s.item, lines); }
      stock.splice(+btn.dataset.i, 1);
      saveRun(run); renderHud(); render();
    });
    stage.querySelector('#buy-heal').onclick = () => {
      const cost = Math.max(10, Math.round((run.maxHp - run.hp) * 0.8 * (1 - discount)));
      if (run.gold < cost) return;
      run.gold -= cost; run.hp = run.maxHp;
      SFX.heal(); toast('Fully healed');
      saveRun(run); renderHud(); render();
    };
    stage.querySelector('#leave').onclick = async () => {
      SFX.click();
      if (coopS) {
        const btn = stage.querySelector('#leave');
        btn.disabled = true;
        btn.querySelector('.choice-label').textContent = 'Waiting for the party…';
        coopS.broadcastStatus(statusOf(run, 'waiting'), 'waiting');
        await coopS.gate(`adv-${run.floor}`);
      }
      nextFloor();
    };
  }
  render();
}

/* ============================================================
   CHARACTER SHEET — hidden stats, appraisal, fame, 8 slots
   ============================================================ */
function statDisplay(stat) {
  const reveal = revealLevel(run);
  const d = derived(run);
  if (reveal === 'exact') return `<b>${d[stat]}</b>`;
  if (reveal === 'ranks') return `<b>${rankFor(d[stat])}</b> <span style="color:var(--ink-faint)">(live)</span>`;
  const app = run.appraisal?.results?.[stat];
  if (app) return `<span class="stat-appr" title="as of floor ${run.appraisal.floor}">${app.rank} · ~${app.lo}–${app.hi}</span>`;
  return '<span style="color:var(--ink-faint)">?</span>';
}

function characterSheet() {
  modalCustom((m, close) => {
    function render() {
      const eq = run.equipment;
      const compatible = weaponCompatible(run);
      const appr = run.appraisal;
      m.innerHTML = `
        <h3>${run.name} — Lv ${run.level} ${run.raceName} ${classTitle(run)}</h3>
        <p class="modal-sub">Floor ${run.floor} · ${run.kills} kills · Origin: ${run.originId ? originById(run.originId)?.name : 'Unknown'}</p>
        <div class="sheet-grid">
          <div class="sheet-section">
            <h4>Fame</h4>
            <div class="fame-line">🌟 <b>${run.fame}</b> <span style="color:var(--ink-dim);font-size:13px">— the tower talks. Fame opens doors, discounts bribes, and impresses merchants.</span></div>
            <h4 style="margin-top:14px">Stats ${appr ? `<span class="tag" style="margin-left:6px" title="Appraisals age — you have grown since.">last appraised · Floor ${appr.floor}</span>` : '<span class="tag" style="margin-left:6px">unappraised</span>'}</h4>
            ${appr && appr.floor < run.floor ? '<div style="font-size:12px;color:var(--crit);margin-bottom:6px">⚠ This reading is from an earlier floor — you have changed since.</div>' : ''}
            <table class="stat-table">
              <tr><td>Strength</td><td>${statDisplay('str')}</td></tr>
              <tr><td>Dexterity</td><td>${statDisplay('dex')}</td></tr>
              <tr><td>Intelligence</td><td>${statDisplay('int')}</td></tr>
              <tr><td>Wisdom</td><td>${statDisplay('wis')}</td></tr>
              <tr><td>Luck</td><td>${statDisplay('lk')}</td></tr>
              <tr><td>Growth potential</td><td><span style="color:var(--ink-faint)">?</span></td></tr>
              ${appr ? `<tr><td>Overall (appraised)</td><td><b>${appr.overall}</b></td></tr>` : ''}
            </table>
            <h4 style="margin-top:14px">Equipped ${!compatible ? '<span class="tag" style="color:var(--crit);border-color:var(--crit)">⚠ weapon incompatible</span>' : ''}</h4>
            ${EQUIP_SLOTS.map(slot => {
              const it = eq[slot] ? itemById(eq[slot]) : null;
              const label = slot.startsWith('accessory') ? 'ring ' + slot.slice(-1) : slot;
              return `<div class="inv-item">${it ? itemIconHtml(it.id, 30) : ''}<div><div class="item-name ${it ? rarityClass(it.rarity) : ''}">${it ? it.name : `<span style="color:var(--ink-faint)">— empty —</span>`}</div>
                ${it ? `<div class="item-desc">${it.desc}</div>` : ''}</div>
                <span class="tag">${label}</span></div>`;
            }).join('')}
            ${run.weaponBonus ? `<div style="font-size:13px;color:var(--ink-dim)">Forge-honed: +${run.weaponBonus} weapon damage</div>` : ''}
          </div>
          <div class="sheet-section">
            <h4>Techniques (4 + Strike &amp; Guard)</h4>
            ${run.skills.map(id => `<div class="inv-item"><div><div class="item-name">${SKILLS[id].name}${SKILLS[id].charge ? ` <span class="tag">${SKILLS[id].charge}⚡</span>` : ''}</div><div class="item-desc">${SKILLS[id].desc}</div></div></div>`).join('')}
            ${run.knownSkills.filter(id => !run.skills.includes(id)).length ? `
              <h4 style="margin-top:12px">Reserve</h4>
              ${run.knownSkills.filter(id => !run.skills.includes(id)).map(id => `
                <div class="inv-item"><div><div class="item-name">${SKILLS[id].name}</div><div class="item-desc">${SKILLS[id].desc}</div></div>
                <button class="btn small" data-swap="${id}">Equip</button></div>`).join('')}` : ''}
            <h4 style="margin-top:14px">Pack</h4>
            ${run.inventory.length ? run.inventory.map((id, i) => {
              const it = itemById(id);
              return `<div class="inv-item">${itemIconHtml(it.id, 30)}<div><div class="item-name ${rarityClass(it.rarity)}">${it.name}</div><div class="item-desc">${it.desc}</div></div>
                <div style="display:flex;gap:6px">
                  <button class="btn small" data-equip="${i}">Equip</button>
                  <button class="btn small ghost" data-sellinv="${i}">Sell ${Math.round(it.price * 0.5)}g</button>
                </div></div>`;
            }).join('') : '<div style="color:var(--ink-faint);font-size:14px">No spare gear.</div>'}
            <h4 style="margin-top:14px">Consumables</h4>
            ${run.consumables.length ? [...new Set(run.consumables)].map(id => {
              const c = itemById(id);
              const n = run.consumables.filter(x => x === id).length;
              return `<div class="inv-item">${itemIconHtml(c.id, 28)}<div><div class="item-name">${c.name} ×${n}</div><div class="item-desc">${c.desc}</div></div>
                <button class="btn small" data-use="${id}">Use</button></div>`;
            }).join('') : '<div style="color:var(--ink-faint);font-size:14px">Empty pockets.</div>'}
            <h4 style="margin-top:14px">Relics</h4>
            <div class="relic-row">${run.relics.length ? relicItems(run).map(r => `<span class="relic-chip" title="${r.desc}">${r.name}</span>`).join('') : '<span style="color:var(--ink-faint);font-size:14px">None yet.</span>'}</div>
            ${run.sigils.length ? `<h4 style="margin-top:14px">Sigils</h4><div class="relic-row">${run.sigils.map(s => `<span class="relic-chip" style="border-color:var(--gold)">✦ Sigil of ${s[0].toUpperCase() + s.slice(1)}</span>`).join('')}</div>` : ''}
          </div>
        </div>
        <div class="divider"></div>
        <div style="text-align:right"><button class="btn small" id="sheet-close">Close</button></div>`;

      m.querySelector('#sheet-close').onclick = () => close();
      m.querySelectorAll('[data-use]').forEach(b => b.onclick = () => {
        const c = itemById(b.dataset.use);
        const i = run.consumables.indexOf(c.id);
        if (i === -1) return;
        run.consumables.splice(i, 1);
        if (c.appraisal) {
          const rng2 = runRng(run);
          appraiseRun(rng2, run, { partial: false, location: 'a scroll of appraisal' });
          rng2.advance();
        }
        if (c.heal) heal(run, c.heal);
        if (c.mana) restoreMana(run, c.mana);
        if (c.fame) changeFame(run, c.fame);
        SFX.heal(); saveRun(run); renderHud(); render();
      });
      m.querySelectorAll('[data-swap]').forEach(b => b.onclick = async () => {
        close();
        await swapSkillModal(SKILLS[b.dataset.swap]);
        saveRun(run);
      });
      m.querySelectorAll('[data-equip]').forEach(b => b.onclick = () => {
        const it = itemById(run.inventory[+b.dataset.equip]);
        equipItem(it);
        SFX.unlock(); saveRun(run); renderHud(); render();
      });
      m.querySelectorAll('[data-sellinv]').forEach(b => b.onclick = () => {
        const idx = +b.dataset.sellinv;
        const it = itemById(run.inventory[idx]);
        run.inventory.splice(idx, 1);
        run.gold += Math.round(it.price * 0.5);
        SFX.gold(); saveRun(run); renderHud(); render();
      });
    }
    render();
  });
}

/* ============================================================
   THE THRONE — floor 51
   ============================================================ */
async function throneRoom(stage) {
  const boss = BOSSES[51];
  const hasSigils = run.sigils.length >= 3;

  let clauseLine = '';
  if (run.flags.clause_seven) {
    const cost = Math.round(run.maxHp * 0.25);
    run.hp = Math.max(1, run.hp - cost);
    clauseLine = `<div class="outcome-line bad">A polite cough. The devil materializes, collects ${cost} HP per clause seven, stamps your contract PAID, and vanishes. "Pleasure doing business."</div>`;
    saveRun(run); renderHud();
  }
  let angelLine = '';
  if (run.flags.freed_angel) {
    run.hp = run.maxHp; run.mp = run.maxMp;
    angelLine = `<div class="outcome-line good">Light floods the antechamber — six wings, briefly, like a blessing that refuses to be witnessed. Your wounds close. Your ${resourceName(run)} sings. A voice: "ANSWER HONESTLY."</div>`;
    saveRun(run); renderHud();
  }

  stage.innerHTML = `
    <div class="card-stage"><div class="panel event-card">
      <div class="card-art"><div class="card-glyph">${boss.glyph}</div>
        <span class="tag card-type-tag" style="border-color:var(--blood);color:#f0a8a0">THE THRONE</span>
        <span class="tag card-floor-tag">FLOOR 51</span></div>
      <div class="card-body">
        <h3>${boss.name}</h3>
        <div class="card-text">${boss.intro}</div>
        <div class="outcome-lines">${clauseLine}${angelLine}</div>
        <div class="card-choices" id="choices"></div>
      </div>
    </div></div>`;
  applyCardBg(stage);
  SFX.bossIntro();

  const box = document.getElementById('choices');
  const addChoice = (html, fn) => {
    const b = el(html);
    b.onclick = () => { SFX.click(); fn(); };
    box.appendChild(b);
  };

  const throneFight = async (hpMult) => {
    if (coopS) {
      const enemies = buildSharedEnemies([boss], { boss: true });
      enemies.forEach(e => { e.maxHp = Math.round(e.maxHp * hpMult); e.hp = e.maxHp; });
      coopS.net.send({ k: 'throne', enemies });
      await coopS.gate('fight-51');
      return coopFightShared(stage, rehydrateEnemies(enemies), { boss });
    }
    const enemies = [buildEnemy(boss, run.floor, run.floor, { boss: true, hpMult })];
    fightGroupBoss(stage, enemies, boss);
  };

  if (hasSigils) {
    addChoice(`<button class="choice-btn" style="border-color:var(--gold)">
      <span class="choice-label">✦ Present the three Sigils — speak the tower's truth</span>
      <span class="choice-hint choice-req">SECRET</span></button>`, () => {
        if (coopS) coopS.net.send({ k: 'throne', ending: 'secret' });
        secretEnding(stage);
      });
  }
  if (run.flags.kings_petition) {
    addChoice(`<button class="choice-btn"><span class="choice-label">📜 Deliver the Ghost King's petition</span><span class="choice-hint">six hundred years overdue</span></button>`, async () => {
      run.flags.kings_petition = false;
      await modal(`<h3>Filed at Last</h3><p class="modal-sub">Vorath reads all nine pages. Twice. "He wants his kingdom back, an apology, and — " he squints, " — 'reasonable compensation for emotional distress.'" He laughs so hard the throne cracks, and he's still wiping his eyes when he picks up his blade. He starts the duel visibly winded.</p>
        <div class="pick-grid"><button class="pick-option" data-close="x"><span class="po-name">Draw your weapon</span></button></div>`);
      throneFight(0.85);
    });
  }
  addChoice(`<button class="choice-btn"><span class="choice-label">⚔ "I'm the interesting kind." — Fight</span><span class="choice-hint">the classic ending</span></button>`, () => throneFight(1));
  addChoice(`<button class="choice-btn"><span class="choice-label">🗣 Answer honestly: "I don't know yet."</span><span class="choice-hint">${run.flags.angel_lore || run.flags.tree_lore ? 'you know what he asks' : 'risky honesty'}</span></button>`, async () => {
    await modal(`<h3>The Question</h3><p class="modal-sub">"Would you take this throne," Vorath asks, "if it were offered?"<br/><br/>"I don't know yet," you say. The Demon King smiles — the first true smile in a century. "Honest. FINALLY." He offers a duelist's salute. "Then let us find out what you are."</p>
      <div class="pick-grid"><button class="pick-option" data-close="x"><span class="po-name">Begin</span></button></div>`);
    changeFame(run, 5);
    renderHud();
    throneFight(0.92);
  });
}

async function secretEnding(stage) {
  Music.play('victory');
  teardownCoop();
  unlock('secret');
  meta.wins++;
  if (!meta.endings.includes('secret')) meta.endings.push('secret');
  const shards = run.floor + 40 + Math.floor(run.goldEarned / 50);
  meta.shards += shards;
  saveMeta(meta);
  clearRun();
  run.over = true;

  setBiomeGlow('#d9a53f');
  app.innerHTML = '';
  app.appendChild(el(`
    <div class="screen end-screen">
      <div class="end-glyph">🜏</div>
      <h1 class="end-title victory">THE TRUTH</h1>
      <p class="end-epitaph">
        You raise the three Sigils — Truth, Sorrow, Wrath — and speak what the tower has hidden on every floor:
        <br/><br/>
        <i>"You were a climber. The tower doesn't have a Demon King. It MAKES one — out of whoever wins."</i>
        <br/><br/>
        Vorath goes very still. The sword of burning air gutters out. "Every century," he says quietly, "one of you reaches this room. You are the first to arrive knowing what it costs to sit down."
        <br/><br/>
        He steps aside from the throne. You look at it — the power, the permanence, the price. And you do what no winner has ever done.
        <br/><br/>
        <b>You break it.</b>
        <br/><br/>
        The tower exhales fifty-one floors of held breath. Somewhere below, every gate opens at once. Vorath — just a tired climber now, blinking in unfamiliar sunlight — shakes your hand once, and walks down.
      </p>
      <div class="shard-award">◈ <b>+${shards}</b> Soul Shards — and the tower's gratitude</div>
      <div style="display:flex;gap:10px"><button class="btn primary" id="btn-title">Return to Title</button></div>
    </div>`));
  SFX.victory();
  document.getElementById('btn-title').onclick = () => { meta = loadMeta(); titleScreen(); };
}

/* ============================================================
   ENDINGS
   ============================================================ */
function shardsFor(outcome) {
  const bossKills = BOSS_FLOORS.filter(f => f < run.floor || (f === run.floor && outcome === 'win')).length;
  let s = run.floor + bossKills * 5 + Math.floor(run.goldEarned / 60);
  if (outcome === 'win') s += 30;
  if (outcome === 'escape') s += 12;
  return s;
}

async function victoryScreen(type) {
  Music.play('victory');
  teardownCoop();
  const shards = shardsFor(type === 'win' ? 'win' : 'escape');
  meta.shards += shards;
  if (type === 'win') { meta.wins++; unlock('win'); if (!meta.endings.includes('win')) meta.endings.push('win'); }
  if (type === 'escape') { unlock('escape'); if (!meta.endings.includes('escape')) meta.endings.push('escape'); }
  saveMeta(meta);
  clearRun();
  run.over = true;

  const isWin = type === 'win';
  setBiomeGlow(isWin ? '#d9a53f' : '#5a9ec9');
  setParticles(isWin ? 'embers' : 'leaves');
  app.innerHTML = '';
  app.appendChild(el(`
    <div class="screen end-screen">
      <div class="end-glyph">${isWin ? '👑' : '🌀'}</div>
      <h1 class="end-title victory">${isWin ? 'THE KING IS DEAD' : 'YOU WENT HOME'}</h1>
      <p class="end-epitaph">${isWin
        ? `Vorath falls to one knee, then both — and he is <i>smiling</i>. "The interesting kind after all." The tower shudders as its crown changes... no. You sheathe your weapon and walk past the throne without sitting down. Let the next century wonder why the top floor stands empty.<br/><br/>${run.name} the ${run.raceName} ${classTitle(run)} conquered all fifty-one floors.`
        : `The portal closes behind you, and the world is suddenly, absurdly ordinary: weather, birdsong, a road. You are alive. Every scar came home with you, and so did every story.<br/><br/>The tower still stands on the horizon. You don't look at it. Mostly.<br/><br/>${run.name} the ${classTitle(run)} survived ${run.floor} floors — and chose to keep living.`}</p>
      <div class="end-stats">
        <div><b>${run.floor}</b>floors</div>
        <div><b>${run.kills}</b>slain</div>
        <div><b>${run.level}</b>level</div>
        <div><b>${run.fame}</b>fame</div>
      </div>
      <div class="shard-award">◈ <b>+${shards}</b> Soul Shards for the Sanctum</div>
      <div style="display:flex;gap:10px">
        <button class="btn primary" id="btn-again">Climb Again</button>
        <button class="btn" id="btn-title">Title Screen</button>
      </div>
    </div>`));
  SFX.victory();
  document.getElementById('btn-again').onclick = () => { meta = loadMeta(); creationFlow(); };
  document.getElementById('btn-title').onclick = () => { meta = loadMeta(); titleScreen(); };
}

const EPITAPHS = {
  dead: [
    'The tower keeps what it kills. It kept you somewhere nice, at least.',
    'Your candle in the Vigil Room is still lit. Somebody will climb past it tomorrow.',
    'The Bone Gambler pours one out for you. He waters it down, but it\'s the thought.',
  ],
  abandon: [
    'Some climbs end with a decision instead of a death. The tower respects the paperwork.',
  ],
};

async function endRun(cause) {
  teardownCoop();
  Music.stop(1.2);
  SFX.death();
  const shards = shardsFor(cause);
  meta.shards += shards;
  saveMeta(meta);
  clearRun();
  const deadRun = run;
  run = null;

  setBiomeGlow('#8a2f2f');
  app.innerHTML = '';
  const epitaph = EPITAPHS[cause] ? EPITAPHS[cause][Math.floor(Math.random() * EPITAPHS[cause].length)] : EPITAPHS.dead[0];
  app.appendChild(el(`
    <div class="screen end-screen">
      <div class="end-glyph">💀</div>
      <h1 class="end-title defeat">${cause === 'abandon' ? 'THE CLIMB ENDS' : 'YOU DIED'}</h1>
      <p class="end-epitaph">${deadRun.name} the ${deadRun.raceName} ${deadRun.subclassId ? SUBCLASSES[deadRun.subclassId].name : CLASSES[deadRun.classId].name} — Floor ${deadRun.floor}, ${biomeForFloor(deadRun.floor).name}.<br/><br/>${epitaph}</p>
      <div class="end-stats">
        <div><b>${deadRun.floor}</b>floors</div>
        <div><b>${deadRun.kills}</b>slain</div>
        <div><b>${deadRun.level}</b>level</div>
        <div><b>${deadRun.fame}</b>fame</div>
      </div>
      <div class="shard-award">◈ <b>+${shards}</b> Soul Shards carried back to the Sanctum</div>
      <div style="display:flex;gap:10px">
        <button class="btn primary" id="btn-again">Climb Again</button>
        <button class="btn" id="btn-title">Title Screen</button>
      </div>
    </div>`));
  document.getElementById('btn-again').onclick = () => { meta = loadMeta(); creationFlow(); };
  document.getElementById('btn-title').onclick = () => { meta = loadMeta(); titleScreen(); };
}

/* ---------- achievements ---------- */
function unlock(id) {
  const a = award(meta, id);
  if (a) {
    toast(`${a.icon} Achievement: ${a.name}`, 'info');
    SFX.unlock();
  }
}
