// Game orchestrator: screens, floor flow, event resolution, endings.

import { CLASSES, RANDOM_NAMES } from './data/classes.js';
import { SKILLS } from './data/skills.js';
import { BIOMES, biomeForFloor, ENEMIES, BOSSES, MODIFIERS } from './data/enemies.js';
import { EVENTS, drawEvent } from './data/events.js';
import { WEAPONS, ARMORS, ACCESSORIES, RELICS, CONSUMABLES, itemById, rollEquipment, rollRelic } from './data/items.js';
import { loadMeta, saveMeta, upgradeRank, award, UPGRADES, ACHIEVEMENTS, newRun, saveRun, loadRun, clearRun, runRng } from './state.js';
import { derived, classTitle, skillTier, gainXp, learnableSkills, changeSanity, heal, restoreMana, relicItems, equippedItems } from './character.js';
import { startCombat, buildEnemy } from './combat.js';
import { ICONS } from './icons.js';
import { SFX, toggleMute, isMuted } from './audio.js';
import { setParticles, setBiomeGlow } from './fx.js';
import { app, el, toast, modal, modalCustom, bar, rarityClass } from './ui.js';
import { makeRng, randomSeed } from './rng.js';

let meta = loadMeta();
let run = null;

const sleep = ms => new Promise(r => setTimeout(r, ms));
const BOSS_FLOORS = Object.keys(BOSSES).map(Number);
const LAST_FLOOR = 51;

/* ============================================================
   TITLE
   ============================================================ */
export function boot() {
  setParticles('dust');
  setBiomeGlow('#3f3a58');
  const saved = loadRun();
  if (saved) { run = saved; }
  titleScreen();
}

function titleScreen() {
  const saved = loadRun();
  app.innerHTML = '';
  app.appendChild(el(`
    <div class="screen title-screen">
      <div class="title-tower">🗼</div>
      <h1 class="game-title">DUNGEON<br/>TOGETHER</h1>
      <p class="game-subtitle">Fifty-one floors. One throne. Every choice is a card, and the tower always deals first.</p>
      <div class="title-menu">
        ${saved ? `<button class="btn primary" id="btn-continue">Continue — Floor ${saved.floor} · ${saved.name}</button>` : ''}
        <button class="btn ${saved ? '' : 'primary'}" id="btn-new">New Climb</button>
        <button class="btn" id="btn-sanctum">The Sanctum ◈ ${meta.shards}</button>
        <button class="btn ghost" id="btn-mute">${isMuted() ? '🔇 Sound Off' : '🔊 Sound On'}</button>
      </div>
      <div class="title-stats">
        <span>Runs: <b>${meta.totalRuns}</b></span>
        <span>Victories: <b>${meta.wins}</b></span>
        <span>Best Floor: <b>${meta.bestFloor}</b></span>
      </div>
      <div class="title-footer">A ROGUELIKE CARD-CRAWLER · EVERY RUN IS A NEW TOWER</div>
    </div>`));

  document.getElementById('btn-new').onclick = () => {
    SFX.click();
    if (saved && !confirm('Abandon the current climb? Your climber will not be remembered kindly.')) return;
    clearRun(); run = null;
    classSelect();
  };
  if (saved) document.getElementById('btn-continue').onclick = () => { SFX.click(); run = saved; enterFloorScreen(); };
  document.getElementById('btn-sanctum').onclick = () => { SFX.click(); sanctumScreen(); };
  document.getElementById('btn-mute').onclick = e => { const m = toggleMute(); e.target.textContent = m ? '🔇 Sound Off' : '🔊 Sound On'; };
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
   CLASS SELECT + STAT ROLL
   ============================================================ */
function rollStats(cls) {
  const rng = makeRng(randomSeed());
  const r = {};
  for (const k of ['hp', 'mp', 'str', 'dex', 'int', 'wis', 'lk']) {
    r[k] = cls.base[k] + rng.int(0, cls.roll[k]);
  }
  return r;
}

function classSelect() {
  let selected = 'warrior';
  let rolled = null;
  let rerolls = 3;

  app.innerHTML = '';
  const scr = el(`<div class="screen">
    <div class="select-header">
      <h2>Choose Your Climber</h2>
      <p>The tower accepts all classes. The tower keeps all classes.</p>
    </div>
    <div class="class-grid" id="classes"></div>
    <div class="panel roll-panel">
      <div class="roll-stats" id="stats"></div>
      <div class="roll-actions">
        <input class="name-input" id="name" maxlength="16" placeholder="Name your climber..." />
        <button class="btn small" id="btn-reroll">🎲 Reroll (3)</button>
        <button class="btn primary" id="btn-start">Begin the Climb</button>
      </div>
    </div>
    <div style="text-align:center;margin-top:16px"><button class="btn ghost small" id="btn-back">← Back</button></div>
  </div>`);
  app.appendChild(scr);

  const grid = scr.querySelector('#classes');
  for (const cls of Object.values(CLASSES)) {
    const card = el(`<div class="panel class-card" style="--accent:${cls.accent}" data-id="${cls.id}">
      <div class="class-icon">${ICONS[cls.id]}</div>
      <h3>${cls.name}</h3>
      <div class="class-epithet">${cls.epithet}</div>
      <div class="class-evo">${cls.name} → ${cls.evolutions.map(e => e.name).join(' → ')}</div>
    </div>`);
    card.onclick = () => { selected = cls.id; SFX.click(); update(true); };
    grid.appendChild(card);
  }

  const statsEl = scr.querySelector('#stats');
  const rerollBtn = scr.querySelector('#btn-reroll');
  const nameInput = scr.querySelector('#name');
  nameInput.value = RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];

  const STAT_LABELS = { hp: 'HP', mp: 'MANA', str: 'STR', dex: 'DEX', int: 'INT', wis: 'WIS', lk: 'LUCK' };

  function renderStats(animating = false) {
    const cls = CLASSES[selected];
    statsEl.innerHTML = Object.keys(STAT_LABELS).map(k => {
      const max = cls.base[k] + cls.roll[k];
      const high = rolled && rolled[k] >= max - Math.ceil(cls.roll[k] * 0.2);
      return `<div class="roll-stat ${high ? 'high' : ''} ${animating ? 'rolling' : ''}">
        <div class="rs-label">${STAT_LABELS[k]}</div>
        <div class="rs-value">${rolled ? rolled[k] : '–'}</div>
      </div>`;
    }).join('');
  }

  async function doRoll() {
    const cls = CLASSES[selected];
    for (let i = 0; i < 6; i++) { rolled = rollStats(cls); renderStats(true); await sleep(55); }
    rolled = rollStats(cls);
    renderStats(false);
    SFX.cardDeal();
  }

  function update(reroll = false) {
    grid.querySelectorAll('.class-card').forEach(c => c.classList.toggle('selected', c.dataset.id === selected));
    if (reroll) doRoll();
  }

  rerollBtn.onclick = async () => {
    if (rerolls <= 0) return;
    rerolls--;
    rerollBtn.textContent = `🎲 Reroll (${rerolls})`;
    rerollBtn.disabled = rerolls <= 0;
    await doRoll();
  };

  scr.querySelector('#btn-start').onclick = () => {
    const name = nameInput.value.trim() || 'The Nameless';
    run = newRun(meta, selected, name, rolled);
    meta.totalRuns++;
    saveMeta(meta);
    SFX.unlock();
    enterFloorScreen(true);
  };
  scr.querySelector('#btn-back').onclick = () => { SFX.click(); titleScreen(); };

  update(true);
}

/* ============================================================
   HUD + FLOOR CHROME
   ============================================================ */
function renderHud() {
  const hud = document.querySelector('.hud');
  if (!hud || !run) return;
  const d = derived(run);
  hud.innerHTML = `
    <div class="hud-identity" style="--accent:${CLASSES[run.classId].accent}">
      <div class="hud-portrait">${ICONS[run.classId]}</div>
      <div>
        <div class="hud-name">${run.name}</div>
        <div class="hud-class">Lv ${run.level} ${classTitle(run)}</div>
      </div>
    </div>
    <div class="hud-bars">
      ${bar('hp', run.hp, run.maxHp, '❤ HP')}
      ${bar('mp', run.mp, run.maxMp, '✦ Mana')}
      ${bar('sanity', run.sanity, run.maxSanity, '☯ Sanity')}
      ${bar('xp', run.xp, run.xpNext, `XP → Lv ${run.level + 1}`)}
    </div>
    <div class="hud-meta">
      <div class="hud-chip">🪙 <b>${run.gold}</b></div>
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
    const v = await modal(`
      <h3>Pause</h3>
      <div class="pick-grid">
        <button class="pick-option" data-close="resume"><span class="po-name">Resume the climb</span></button>
        <button class="pick-option" data-close="save"><span class="po-name">Save &amp; return to title</span><span class="po-desc">Your climb waits where you left it.</span></button>
        <button class="pick-option" data-close="abandon"><span class="po-name" style="color:var(--blood)">Abandon run</span><span class="po-desc">The tower claims another. Shards are still awarded.</span></button>
      </div>`, { dismissible: true });
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
    <div class="screen" style="padding-top:0">
      <div class="hud panel"></div>
      ${floorStrip()}
      <div id="stage"></div>
    </div>`;
  renderHud();
  return document.getElementById('stage');
}

/* ============================================================
   FLOOR FLOW
   ============================================================ */
async function enterFloorScreen(fresh = false) {
  if (fresh) run.floor = 0;
  nextFloor();
}

async function nextFloor() {
  run.floor++;
  const biome = biomeForFloor(run.floor);
  run.biomeId = biome.id;
  setBiomeGlow(biome.glow);
  setParticles(biome.particle);

  // catching your breath between floors
  heal(run, run.maxHp * 0.08);
  restoreMana(run, run.maxMp * 0.15);

  // relic: second wind
  const relics = relicItems(run);
  const lowHeal = relics.find(r => r.lowHpHeal);
  if (lowHeal && run.hp / run.maxHp < 0.3) {
    heal(run, run.maxHp * lowHeal.lowHpHeal);
    toast(`${lowHeal.name} stirs — you breathe easier.`, 'info');
  }

  // sanity achievement
  if (run.sanity > 0 && run.sanity <= 5) unlock('broke_sane');
  if (run.floor >= 10 && !meta.classFloor10.includes(run.classId)) {
    meta.classFloor10.push(run.classId);
    if (meta.classFloor10.length === 4) unlock('all_classes');
    saveMeta(meta);
  }
  if (run.floor > meta.bestFloor) { meta.bestFloor = run.floor; saveMeta(meta); }

  saveRun(run);

  const stage = floorChrome();

  // biome intro splash on first floor of each biome
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
    SFX.cardDeal();
    await new Promise(r => document.getElementById('go').onclick = () => { SFX.click(); r(); });
  }

  if (run.floor === LAST_FLOOR) return throneRoom(stage);
  if (BOSS_FLOORS.includes(run.floor)) return bossFloor(stage);
  if (run.floor % 5 === 0) return modifierFloor(stage);

  // regular floor: 42% combat encounter, else event card
  const rng = runRng(run);
  if (rng.chance(0.42)) { rng.advance(); saveRun(run); return encounterFloor(stage); }
  rng.advance();

  const ev = drawEvent(runRng(run), run);
  run.seenEvents.push(ev.id);
  saveRun(run);
  renderEventCard(stage, ev);
}

/* ---------- combat encounter card (Fight / Sneak / Bribe) ---------- */
function pickEnemyGroup(rng, biome) {
  const depth = run.floor - biome.floors[0]; // 0..9 within the biome
  let pool = ENEMIES[biome.id] || ENEMIES.hell;
  if (depth < 4) pool = pool.filter(e => !e.elite); // elites guard the deeper halves
  const lead = rng.pick(pool);
  const group = [lead];
  if (lead.pack) {
    const extra = depth < 3 ? 1 : rng.int(1, 2);
    for (let i = 0; i < extra; i++) group.push(rng.chance(0.7) ? lead : rng.pick(pool.filter(e => !e.elite)));
  } else if (!lead.elite && depth >= 2 && rng.chance(0.25)) {
    group.push(rng.pick(pool.filter(e => !e.elite)));
  }
  return group;
}

async function encounterFloor(stage) {
  const rng = runRng(run);
  const biome = biomeForFloor(run.floor);
  const group = pickEnemyGroup(rng, biome);
  rng.advance(); saveRun(run);

  const names = [...new Set(group.map(g => g.name))].join(', ');
  const bribe = Math.round(group.reduce((s, g) => s + g.gold[1], 0) * 0.8);
  const d = derived(run);
  const sneakDc = 10 + Math.floor(run.floor / 8);

  stage.innerHTML = `
    <div class="card-stage"><div class="panel event-card">
      <div class="card-art"><div class="card-glyph">${group[0].glyph}</div>
        <span class="tag card-type-tag">ENCOUNTER</span><span class="tag card-floor-tag">FLOOR ${run.floor}</span></div>
      <div class="card-body">
        <h3>Hostiles Ahead</h3>
        <div class="card-text">The floor narrows, and the dark produces: ${names}${group.length > 1 ? ` — ${group.length} of them` : ''}. They have already noticed you. The only question is what happens next.</div>
        <div class="card-choices">
          <button class="choice-btn" data-act="fight"><span class="choice-label">⚔ Fight</span><span class="choice-hint">XP + gold</span></button>
          <button class="choice-btn" data-act="sneak"><span class="choice-label">🕶 Sneak past</span><span class="choice-hint">DEX check (${sneakDc}) · you have ${d.dex}</span></button>
          <button class="choice-btn" data-act="bribe" ${run.gold < bribe ? 'disabled' : ''}><span class="choice-label">🪙 Bribe them</span><span class="choice-hint ${run.gold < bribe ? 'choice-req' : ''}">-${bribe}g</span></button>
        </div>
      </div>
    </div></div>`;
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
      rng2.advance(); saveRun(run);
      return showOutcomePanel(stage, [
        { text: `You toss the purse. They count it — twice, insultingly — and melt back into the dark. (-${bribe} gold)`, cls: 'gold' },
      ]);
    }
    // sneak
    const roll = rng2.int(1, 8);
    const total = d.dex + roll + Math.floor(d.lk / 4);
    rng2.advance(); saveRun(run);
    if (total >= sneakDc) {
      const xp = 10 + Math.floor(run.floor * 1.2);
      const ups = gainXp(run, xp, runRng(run));
      await showOutcomePanel(stage, [
        { text: `You move like a rumor. (DEX ${d.dex} + roll ${roll} = ${total} vs ${sneakDc}) — they never knew you were there. +${xp} XP`, cls: 'good' },
      ], ups);
    } else {
      await modal(`<h3>Spotted!</h3><p class="modal-sub">DEX ${d.dex} + roll ${roll} = ${total} vs ${sneakDc}. A twig. It's always a twig.</p>
        <div class="pick-grid"><button class="pick-option" data-close="x"><span class="po-name">They ambush you</span></button></div>`);
      return fightGroup(stage, group, { text: 'They were waiting for the twig.', modifier: { name: 'Ambushed', desc: 'Enemies strike first.', enemyFirst: true } });
    }
  });
}

async function fightGroup(stage, specs, { text = null, modifier = null, boss = false, prebuilt = null } = {}) {
  const biome = biomeForFloor(run.floor);
  const rng = runRng(run);
  const enemies = prebuilt || specs.map(s => buildEnemy(s, run.floor, biome.floors[0], { hpMult: modifier?.hpMult || 1 }));
  if (modifier?.extraEnemy && !boss) {
    enemies.push(buildEnemy(runRng(run).pick(ENEMIES[biome.id].filter(e => !e.elite)), run.floor, biome.floors[0]));
  }
  const { result, gold = 0, xp = 0 } = await startCombat({
    container: stage, run, rng, enemies, modifier,
    introText: text, onHud: renderHud,
  });

  if (result === 'dead') return endRun('dead');
  if (result === 'madness') return endRun('madness');
  if (result === 'fled') {
    saveRun(run);
    return showOutcomePanel(stage, [{ text: 'You live to climb another floor. The tower notes your pragmatism.', cls: 'good' }]);
  }

  // victory
  run.kills += enemies.length;
  run.gold += gold;
  run.goldEarned += gold;
  unlock('first_blood');
  if (run.gold >= 500) unlock('rich');
  if (enemies.some(e => e.id === 'mimic')) unlock('mimic');

  const victoryHeal = relicItems(run).find(r => r.victoryHeal);
  const lines = [
    { text: `Victory! +${gold} gold, +${xp} XP`, cls: 'gold' },
  ];
  if (victoryHeal) {
    const amt = heal(run, run.maxHp * victoryHeal.victoryHeal);
    if (amt) lines.push({ text: `${victoryHeal.name} hums — you recover ${amt} HP.`, cls: 'good' });
  }
  SFX.victory();
  const ups = gainXp(run, xp, runRng(run));
  saveRun(run);
  await showOutcomePanel(stage, lines, ups);
}

/* ---------- modifier floor (every 5th) ---------- */
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
  SFX.cardDeal();
  document.getElementById('go').onclick = () => {
    SFX.click();
    fightGroup(stage, group, { text: `Trial: ${mod.name}.`, modifier: { ...mod, goldMult: (mod.goldMult || 1) * 1.5 } });
  };
}

/* ---------- boss floor ---------- */
async function bossFloor(stage) {
  const boss = BOSSES[run.floor];
  const biome = biomeForFloor(run.floor);
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
  SFX.bossIntro();
  document.getElementById('go').onclick = async () => {
    SFX.click();
    const enemies = [buildEnemy(boss, run.floor, biome.floors[0], { boss: true })];
    await fightGroupBoss(stage, enemies, boss);
  };
}

async function fightGroupBoss(stage, enemies, boss) {
  const rng = runRng(run);
  const { result, gold = 0, xp = 0 } = await startCombat({
    container: stage, run, rng, enemies, introText: `${boss.name}: "${boss.taunt}"`, onHud: renderHud,
  });
  if (result === 'dead') return endRun('dead');
  if (result === 'madness') return endRun('madness');

  run.kills++;
  run.gold += gold;
  run.goldEarned += gold;
  const achMap = { 10: 'floor_10', 20: 'floor_20', 30: 'floor_30', 40: 'floor_40', 50: 'floor_50' };
  if (achMap[run.floor]) unlock(achMap[run.floor]);

  if (run.floor === LAST_FLOOR) return victoryScreen('win');

  // boss reward: relic choice
  SFX.victory();
  const lines = [{ text: `${boss.name} falls. +${gold} gold, +${xp} XP`, cls: 'gold' }];
  const ups = gainXp(run, xp, runRng(run));
  const rng2 = runRng(run);
  const choices = [rollRelic(rng2, run.relics), rollRelic(rng2, run.relics), rollRelic(rng2, run.relics)]
    .filter((r, i, a) => r && a.findIndex(x => x && x.id === r.id) === i);
  rng2.advance();
  saveRun(run);

  await showOutcomePanel(stage, lines, ups, { continueLabel: 'Claim your prize' });

  if (choices.length) {
    await modalCustom((m, close) => {
      m.innerHTML = `<h3>The Gate Opens</h3><p class="modal-sub">Something glitters in the boss's hoard. Choose one relic.</p>
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
  renderHud();
  nextFloorButton(document.getElementById('stage'));
}

/* ============================================================
   EVENT CARDS
   ============================================================ */
function reqMet(req) {
  if (!req) return { ok: true };
  const d = derived(run);
  if (req.stat && d[req.stat] < req.min) return { ok: false, why: `${req.stat.toUpperCase()} ${req.min}+ (you: ${d[req.stat]})` };
  if (req.class && run.classId !== req.class) return { ok: false, why: `${CLASSES[req.class].name} only` };
  if (req.gold && run.gold < req.gold) return { ok: false, why: `${req.gold}g needed` };
  if (req.flag && !run.flags[req.flag]) return { ok: false, why: '???' };
  if (req.notFlag && run.flags[req.notFlag]) return { ok: false, why: 'unavailable' };
  if (req.item && !run.consumables.includes(req.item)) return { ok: false, why: 'item needed' };
  return { ok: true };
}

const TYPE_LABEL = { story: 'STORY', risk: 'RISK', blessing: 'BLESSING', treasure: 'TREASURE', rest: 'RESPITE', shop: 'MERCHANT' };

function renderEventCard(stage, ev) {
  if (ev.shop) return shopScreen(stage, ev);

  stage.innerHTML = `
    <div class="card-stage"><div class="panel event-card">
      <div class="card-art"><div class="card-glyph">${ev.glyph}</div>
        <span class="tag card-type-tag">${TYPE_LABEL[ev.type] || 'EVENT'}</span>
        <span class="tag card-floor-tag">FLOOR ${run.floor}</span></div>
      <div class="card-body">
        <h3>${ev.title}</h3>
        <div class="card-text">${ev.text}</div>
        <div class="card-choices" id="choices"></div>
      </div>
    </div></div>`;
  SFX.cardDeal();

  const box = document.getElementById('choices');
  ev.choices.forEach(choice => {
    const r = reqMet(choice.req);
    const btn = el(`<button class="choice-btn ${r.ok ? '' : 'locked'}" ${r.ok ? '' : 'disabled'}>
      <span class="choice-label">${choice.label}</span>
      <span class="choice-hint ${choice.req ? 'choice-req' : ''}">${r.ok ? (choice.hint || '') : `🔒 ${r.why}`}</span>
    </button>`);
    btn.onclick = () => { SFX.click(); resolveChoice(stage, ev, choice); };
    box.appendChild(btn);
  });
}

async function resolveChoice(stage, ev, choice) {
  const rng = runRng(run);
  let outcome = choice.outcome;

  // stat-check roll
  if (outcome.roll) {
    const d = derived(run);
    const spec = outcome.roll;
    let bonus = Math.floor(d.lk / 4);
    if (spec.bonusFlag && run.flags[spec.bonusFlag.flag]) bonus += spec.bonusFlag.bonus;
    if (spec.penaltyFlag && run.flags[spec.penaltyFlag.flag]) bonus -= spec.penaltyFlag.penalty;
    const die = rng.int(1, 8);
    const total = d[spec.stat] + die + bonus;
    const ok = total >= spec.dc;
    const rollLine = { text: `${spec.stat.toUpperCase()} check: ${d[spec.stat]} + 🎲${die}${bonus ? (bonus > 0 ? ` +${bonus}` : ` ${bonus}`) : ''} = ${total} vs DC ${spec.dc} — ${ok ? 'SUCCESS' : 'FAILURE'}`, cls: ok ? 'good' : 'bad' };
    outcome = ok ? outcome.success : outcome.fail;
    await applyOutcome(stage, ev, outcome, rng, [rollLine]);
  } else {
    await applyOutcome(stage, ev, outcome, rng, []);
  }
}

async function applyOutcome(stage, ev, o, rng, lines) {
  const d = derived(run);

  if (o.escape) return victoryScreen('escape');

  if (o.text) lines.push({ text: o.text, cls: '' });

  // chest / mimic
  if (o.chest) {
    const isMimic = !o.safeMimic && !relicItems(run).some(r => r.noMimic) && rng.chance(ev.mimicChance || 0.25);
    if (isMimic) {
      rng.advance(); saveRun(run);
      const mimic = { id: 'mimic', name: 'Mimic', glyph: '🦷', hp: 30 + run.floor * 4, atk: 6 + run.floor, def: 2, spd: 8, gold: [40 + run.floor * 3, 60 + run.floor * 4], xp: 15 + run.floor * 2 };
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

  // resources
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
  if (o.fullHeal) { run.hp = run.maxHp; lines.push({ text: 'Fully healed.', cls: 'good' }); SFX.heal(); }
  if (o.mana) restoreMana(run, o.mana);
  if (o.manaPct) { restoreMana(run, run.maxMp * o.manaPct); lines.push({ text: `+${Math.round(run.maxMp * o.manaPct)} Mana`, cls: 'good' }); }
  if (o.fullMana) { run.mp = run.maxMp; lines.push({ text: 'Mana restored.', cls: 'good' }); }
  if (o.sanity) {
    const applied = changeSanity(run, o.sanity);
    lines.push({ text: `${applied > 0 ? '+' : ''}${applied} Sanity`, cls: applied >= 0 ? 'good' : 'bad' });
    if (applied < 0) SFX.sanity();
  }
  if (o.statUp) {
    run.stats[o.statUp.stat] = Math.max(1, run.stats[o.statUp.stat] + o.statUp.amt);
    lines.push({ text: `${o.statUp.amt > 0 ? '+' : ''}${o.statUp.amt} ${o.statUp.stat.toUpperCase()}`, cls: o.statUp.amt > 0 ? 'good' : 'bad' });
  }
  if (o.statUpRandom) {
    for (let i = 0; i < o.statUpRandom; i++) {
      const st = rng.pick(['str', 'dex', 'int', 'wis', 'lk']);
      run.stats[st]++;
      lines.push({ text: `+1 ${st.toUpperCase()}`, cls: 'good' });
    }
    SFX.levelup();
  }

  // items
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
  if (o.useItem) {
    const i = run.consumables.indexOf(o.useItem);
    if (i > -1) run.consumables.splice(i, 1);
  }
  if (o.upgradeWeapon) {
    run.weaponBonus += 4;
    lines.push({ text: 'Your weapon sings a new, sharper note. (+4 damage, permanent)', cls: 'item' });
    SFX.unlock();
  }

  // meta / flags
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
      upcoming.push(`F${f}: ${f === LAST_FLOOR ? 'THE THRONE' : BOSS_FLOORS.includes(f) ? 'BOSS' : f % 5 === 0 ? 'Trial' : 'Unknown card'}`);
    }
    lines.push({ text: `The map shows: ${upcoming.join(' · ')}`, cls: 'item' });
  }

  // XP last (may trigger level-ups)
  let ups = [];
  if (o.xp) {
    const amt = Math.round(o.xp * d.xpMult);
    ups = gainXp(run, amt, rng);
    lines.push({ text: `+${amt} XP`, cls: 'good' });
  }

  rng.advance();
  saveRun(run);
  renderHud();

  // combat outcome from an event
  if (o.combat) {
    const biome = biomeForFloor(run.floor);
    const specs = o.combat.enemies.map(id => {
      for (const pool of Object.values(ENEMIES)) {
        const found = pool.find(e => e.id === id);
        if (found) return found;
      }
      return ENEMIES[biome.id][0];
    });
    if (lines.length) await showOutcomePanel(stage, lines, ups, { continueLabel: 'Steel yourself' });
    return fightGroup(stage, specs, { text: o.combat.text });
  }

  // death by event
  if (run.hp <= 0) return endRun('dead');
  if (run.sanity <= 0) return endRun('madness');

  await showOutcomePanel(stage, lines, ups);
}

function biomeTier() {
  return { forest: 1, ruins: 2, frost: 3, swamp: 4, hell: 5, throne: 5 }[run.biomeId] || 1;
}

/* ---------- equipment offer / compare ---------- */
async function offerEquipment(item, lines) {
  const current = run.equipment[item.slot] ? itemById(run.equipment[item.slot]) : null;
  const sellPrice = Math.round(item.price * 0.6);
  const v = await modal(`
    <h3>Found: <span class="${rarityClass(item.rarity)}">${item.name}</span></h3>
    <p class="modal-sub">${item.desc}</p>
    ${current ? `<p style="color:var(--ink-dim);font-size:14px;margin-bottom:12px">Currently equipped: <b>${current.name}</b> — ${current.desc}<br/>Replacing sells it for ${Math.round(current.price * 0.4)}g.</p>` : ''}
    <div class="pick-grid">
      <button class="pick-option" data-close="equip"><span class="po-name">Equip it</span></button>
      <button class="pick-option" data-close="sell"><span class="po-name">Sell it — ${sellPrice}g</span></button>
    </div>`);
  if (v === 'equip') {
    if (current) run.gold += Math.round(current.price * 0.4);
    run.equipment[item.slot] = item.id;
    lines.push({ text: `Equipped: ${item.name}`, cls: 'item' });
    if (item.rarity === 'legendary') unlock('legendary');
  } else {
    run.gold += sellPrice;
    run.goldEarned += sellPrice;
    lines.push({ text: `Sold ${item.name} for ${sellPrice}g`, cls: 'gold' });
    SFX.gold();
  }
  renderHud();
}

/* ---------- outcome panel + level-ups ---------- */
async function showOutcomePanel(stage, lines, ups = [], { continueLabel = 'Ascend to the next floor' } = {}) {
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
  await new Promise(r => document.getElementById('continue').onclick = () => { SFX.click(); r(); });
  nextFloor();
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
  document.getElementById('continue').onclick = () => { SFX.click(); nextFloor(); };
}

const SKILL_OFFER_LEVELS = [3, 5, 8, 11, 14, 17, 20, 24];

async function levelUpModal(up) {
  SFX.levelup();
  const gainsHtml = Object.entries(up.gains)
    .map(([k, v]) => `<span class="statgain">+${v} ${k.toUpperCase()}</span>`).join('');

  await modal(`
    <div class="levelup-burst">${up.evolution ? '🌟' : '✨'}</div>
    <h3 style="text-align:center">${up.evolution ? `EVOLUTION — ${up.evolution.name}!` : `Level ${up.level}!`}</h3>
    ${up.evolution ? `<p class="modal-sub" style="text-align:center">${up.evolution.blurb}</p>` : ''}
    <div class="statgain-row">${gainsHtml}</div>
    <div class="pick-grid"><button class="pick-option" data-close="x" style="text-align:center"><span class="po-name">${up.evolution ? 'Rise' : 'Continue'}</span></button></div>`);
  if (up.evolution) SFX.evolve();

  // skill offer
  if (SKILL_OFFER_LEVELS.includes(up.level) || up.evolution) {
    const rng = runRng(run);
    const pool = rng.shuffle(learnableSkills(run)).slice(0, 3);
    rng.advance();
    if (pool.length) {
      await modalCustom((m, close) => {
        m.innerHTML = `<h3>New Technique</h3><p class="modal-sub">The climb teaches. Choose one skill to learn.</p>
          <div class="pick-grid">
            ${pool.map((s, i) => `<button class="pick-option" data-i="${i}">
              <span class="po-tag tag">${s.cost ? s.cost + ' MP' : 'FREE'}</span>
              <div class="po-name">${s.name}</div><div class="po-desc">${s.desc}</div>
            </button>`).join('')}
            <button class="pick-option" data-skip="1"><div class="po-name" style="color:var(--ink-dim)">Skip — stay sharp with what you know</div></button>
          </div>`;
        m.querySelectorAll('[data-i]').forEach(b => b.onclick = async () => {
          const sk = pool[+b.dataset.i];
          run.knownSkills.push(sk.id);
          close();
          if (run.skills.length < 4) {
            run.skills.push(sk.id);
            toast(`Learned ${sk.name}`, 'info');
          } else {
            await swapSkillModal(sk);
          }
          saveRun(run);
        });
        m.querySelector('[data-skip]').onclick = () => close();
      });
    }
  }
}

async function swapSkillModal(newSkill) {
  await modalCustom((m, close) => {
    m.innerHTML = `<h3>Equip ${newSkill.name}?</h3><p class="modal-sub">You can carry four techniques into battle. Replace one, or keep it in reserve (swap anytime from the Character screen).</p>
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
  const rng = runRng(run);
  const tier = biomeTier();
  const stock = [];
  // consumables
  const cons = rng.shuffle(CONSUMABLES).slice(0, 3);
  cons.forEach(c => stock.push({ kind: 'consumable', item: c, price: c.price }));
  // equipment
  for (let i = 0; i < 2; i++) {
    const item = rollEquipment(rng, tier, 2);
    if (!stock.some(s => s.item.id === item.id)) stock.push({ kind: 'equip', item, price: item.price });
  }
  // maybe a relic
  if (rng.chance(0.5)) {
    const r = rollRelic(rng, run.relics);
    if (r) stock.push({ kind: 'relic', item: r, price: 120 + tier * 40 });
  }
  rng.advance(); saveRun(run);

  function render() {
    const healCost = Math.max(10, Math.round((run.maxHp - run.hp) * 0.8));
    stage.innerHTML = `
      <div class="card-stage"><div class="panel event-card">
        <div class="card-art"><div class="card-glyph">🧳</div>
          <span class="tag card-type-tag">MERCHANT</span><span class="tag card-floor-tag">FLOOR ${run.floor}</span></div>
        <div class="card-body">
          <h3>${ev.title}</h3>
          <div class="card-text">"Browse, browse! Prices reflect the difficulty of my supply chain, which is <i>vertical</i>."</div>
          <div class="shop-list">
            ${stock.map((s, i) => `
              <div class="shop-item">
                <div class="si-info"><div class="si-name ${rarityClass(s.item.rarity)}">${s.item.name}</div><div class="si-desc">${s.item.desc}</div></div>
                <span class="si-price">🪙 ${s.price}</span>
                <button class="btn small ${run.gold >= s.price ? 'primary' : ''}" data-i="${i}" ${run.gold < s.price ? 'disabled' : ''}>Buy</button>
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
      if (run.gold < s.price) return;
      run.gold -= s.price;
      SFX.gold();
      if (s.kind === 'consumable') { run.consumables.push(s.item.id); toast(`Bought ${s.item.name}`); }
      if (s.kind === 'relic') { run.relics.push(s.item.id); toast(`Relic: ${s.item.name}`, 'info'); SFX.unlock(); }
      if (s.kind === 'equip') { const lines = []; await offerEquipment(s.item, lines); }
      stock.splice(+btn.dataset.i, 1);
      saveRun(run); renderHud(); render();
    });
    stage.querySelector('#buy-heal').onclick = () => {
      const cost = Math.max(10, Math.round((run.maxHp - run.hp) * 0.8));
      if (run.gold < cost) return;
      run.gold -= cost; run.hp = run.maxHp;
      SFX.heal(); toast('Fully healed');
      saveRun(run); renderHud(); render();
    };
    stage.querySelector('#leave').onclick = () => { SFX.click(); nextFloor(); };
  }
  render();
}

/* ============================================================
   CHARACTER SHEET
   ============================================================ */
function characterSheet() {
  const d = derived(run);
  modalCustom((m, close) => {
    function render() {
      const eq = run.equipment;
      m.innerHTML = `
        <h3>${run.name} — Lv ${run.level} ${classTitle(run)}</h3>
        <p class="modal-sub">Seed ${run.seed.toString(16)} · Floor ${run.floor} · ${run.kills} kills</p>
        <div class="sheet-grid">
          <div class="sheet-section">
            <h4>Stats</h4>
            <table class="stat-table">
              <tr><td>Strength</td><td>${d.str}</td></tr>
              <tr><td>Dexterity</td><td>${d.dex}</td></tr>
              <tr><td>Intelligence</td><td>${d.int}</td></tr>
              <tr><td>Wisdom</td><td>${d.wis}</td></tr>
              <tr><td>Luck</td><td>${d.lk}</td></tr>
              <tr><td>Weapon damage</td><td>+${d.atk}</td></tr>
              <tr><td>Defense</td><td>${d.def}</td></tr>
              <tr><td>Crit chance</td><td>${d.crit.toFixed(0)}%</td></tr>
              <tr><td>Dodge</td><td>${d.dodge.toFixed(0)}%</td></tr>
            </table>
            <h4 style="margin-top:14px">Equipment</h4>
            ${['weapon', 'armor', 'accessory'].map(slot => {
              const it = eq[slot] ? itemById(eq[slot]) : null;
              return `<div class="inv-item"><div><div class="item-name ${it ? rarityClass(it.rarity) : ''}">${it ? it.name : `<span style="color:var(--ink-faint)">— no ${slot} —</span>`}</div>
                ${it ? `<div class="item-desc">${it.desc}</div>` : ''}</div></div>`;
            }).join('')}
            ${run.weaponBonus ? `<div style="font-size:13px;color:var(--ink-dim)">Forge-honed: +${run.weaponBonus} weapon damage</div>` : ''}
          </div>
          <div class="sheet-section">
            <h4>Techniques (4 equipped)</h4>
            ${run.skills.map(id => `<div class="inv-item"><div><div class="item-name">${SKILLS[id].name}</div><div class="item-desc">${SKILLS[id].desc}</div></div></div>`).join('')}
            ${run.knownSkills.filter(id => !run.skills.includes(id)).length ? `
              <h4 style="margin-top:12px">Reserve</h4>
              ${run.knownSkills.filter(id => !run.skills.includes(id)).map(id => `
                <div class="inv-item"><div><div class="item-name">${SKILLS[id].name}</div><div class="item-desc">${SKILLS[id].desc}</div></div>
                <button class="btn small" data-swap="${id}">Equip</button></div>`).join('')}` : ''}
            <h4 style="margin-top:14px">Consumables</h4>
            ${run.consumables.length ? [...new Set(run.consumables)].map(id => {
              const c = itemById(id);
              const n = run.consumables.filter(x => x === id).length;
              return `<div class="inv-item"><div><div class="item-name">${c.name} ×${n}</div><div class="item-desc">${c.desc}</div></div>
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
        if (c.heal) heal(run, c.heal);
        if (c.mana) restoreMana(run, c.mana);
        if (c.sanity) changeSanity(run, c.sanity);
        SFX.heal(); saveRun(run); renderHud(); render();
      });
      m.querySelectorAll('[data-swap]').forEach(b => b.onclick = async () => {
        close();
        await swapSkillModal(SKILLS[b.dataset.swap]);
        saveRun(run);
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

  // clause seven collects first
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
    angelLine = `<div class="outcome-line good">Light floods the antechamber — six wings, briefly, like a blessing that refuses to be witnessed. Your wounds close. Your mana sings. A voice: "ANSWER HONESTLY."</div>`;
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
  SFX.bossIntro();

  const box = document.getElementById('choices');
  const addChoice = (html, fn, disabled = false) => {
    const b = el(html);
    if (disabled) b.disabled = true;
    b.onclick = () => { SFX.click(); fn(); };
    box.appendChild(b);
  };

  if (hasSigils) {
    addChoice(`<button class="choice-btn" style="border-color:var(--gold)">
      <span class="choice-label">✦ Present the three Sigils — speak the tower's truth</span>
      <span class="choice-hint choice-req">SECRET</span></button>`, () => secretEnding(stage));
  }
  if (run.flags.kings_petition) {
    addChoice(`<button class="choice-btn"><span class="choice-label">📜 Deliver the Ghost King's petition</span><span class="choice-hint">six hundred years overdue</span></button>`, async () => {
      run.flags.kings_petition = false;
      await modal(`<h3>Filed at Last</h3><p class="modal-sub">Vorath reads all nine pages. Twice. "He wants his kingdom back, an apology, and — " he squints, " — 'reasonable compensation for emotional distress.'" He laughs so hard the throne cracks, and he's still wiping his eyes when he picks up his blade. He starts the duel visibly winded.</p>
        <div class="pick-grid"><button class="pick-option" data-close="x"><span class="po-name">Draw your weapon</span></button></div>`);
      const biome = biomeForFloor(run.floor);
      const enemies = [buildEnemy(boss, run.floor, biome.floors[0], { boss: true, hpMult: 0.85 })];
      fightGroupBoss(stage, enemies, boss);
    });
  }
  addChoice(`<button class="choice-btn"><span class="choice-label">⚔ "I'm the interesting kind." — Fight</span><span class="choice-hint">the classic ending</span></button>`, () => {
    const biome = biomeForFloor(run.floor);
    const enemies = [buildEnemy(boss, run.floor, biome.floors[0], { boss: true })];
    fightGroupBoss(stage, enemies, boss);
  });
  addChoice(`<button class="choice-btn"><span class="choice-label">🗣 Answer honestly: "I don't know yet."</span><span class="choice-hint">${run.flags.angel_lore || run.flags.tree_lore ? 'you know what he asks' : 'risky honesty'}</span></button>`, async () => {
    await modal(`<h3>The Question</h3><p class="modal-sub">"Would you take this throne," Vorath asks, "if it were offered?"<br/><br/>"I don't know yet," you say. The Demon King smiles — the first true smile in a century. "Honest. FINALLY." He offers a duelist's salute. "Then let us find out what you are."</p>
      <div class="pick-grid"><button class="pick-option" data-close="x"><span class="po-name">Begin</span></button></div>`);
    changeSanity(run, 15);
    renderHud();
    const biome = biomeForFloor(run.floor);
    const enemies = [buildEnemy(boss, run.floor, biome.floors[0], { boss: true, hpMult: 0.92 })];
    fightGroupBoss(stage, enemies, boss);
  });
}

async function secretEnding(stage) {
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
        ? `Vorath falls to one knee, then both — and he is <i>smiling</i>. "The interesting kind after all." The tower shudders as its crown changes... no. You sheathe your weapon and walk past the throne without sitting down. Let the next century wonder why the top floor stands empty.<br/><br/>${run.name} the ${classTitle(run)} conquered all fifty-one floors.`
        : `The portal closes behind you, and the world is suddenly, absurdly ordinary: weather, birdsong, a road. You are alive. Every scar came home with you, and so did every story.<br/><br/>The tower still stands on the horizon. You don't look at it. Mostly.<br/><br/>${run.name} the ${classTitle(run)} survived ${run.floor} floors — and chose to keep living.`}</p>
      <div class="end-stats">
        <div><b>${run.floor}</b>floors</div>
        <div><b>${run.kills}</b>slain</div>
        <div><b>${run.level}</b>level</div>
        <div><b>${run.goldEarned}</b>gold earned</div>
      </div>
      <div class="shard-award">◈ <b>+${shards}</b> Soul Shards for the Sanctum</div>
      <div style="display:flex;gap:10px">
        <button class="btn primary" id="btn-again">Climb Again</button>
        <button class="btn" id="btn-title">Title Screen</button>
      </div>
    </div>`));
  SFX.victory();
  document.getElementById('btn-again').onclick = () => { meta = loadMeta(); classSelect(); };
  document.getElementById('btn-title').onclick = () => { meta = loadMeta(); titleScreen(); };
}

const EPITAPHS = {
  dead: [
    'The tower keeps what it kills. It kept you somewhere nice, at least.',
    'Your candle in the Vigil Room is still lit. Somebody will climb past it tomorrow.',
    'The Bone Gambler pours one out for you. He waters it down, but it\'s the thought.',
  ],
  madness: [
    'You are still in the tower. You are always in the tower. The tower is very happy to have you.',
    'They found your journal. The last forty pages are one word, beautifully calligraphed.',
    'Your mind went home without you. Parts of it send postcards.',
  ],
  abandon: [
    'Some climbs end with a decision instead of a death. The tower respects the paperwork.',
  ],
};

async function endRun(cause) {
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
      <div class="end-glyph">${cause === 'madness' ? '🫥' : '💀'}</div>
      <h1 class="end-title defeat">${cause === 'madness' ? 'MIND, UNMADE' : cause === 'abandon' ? 'THE CLIMB ENDS' : 'YOU DIED'}</h1>
      <p class="end-epitaph">${deadRun.name} the ${classTitle(deadRun)} — Floor ${deadRun.floor}, ${biomeForFloor(deadRun.floor).name}.<br/><br/>${epitaph}</p>
      <div class="end-stats">
        <div><b>${deadRun.floor}</b>floors</div>
        <div><b>${deadRun.kills}</b>slain</div>
        <div><b>${deadRun.level}</b>level</div>
        <div><b>${deadRun.goldEarned}</b>gold earned</div>
      </div>
      <div class="shard-award">◈ <b>+${shards}</b> Soul Shards carried back to the Sanctum</div>
      <div style="display:flex;gap:10px">
        <button class="btn primary" id="btn-again">Climb Again</button>
        <button class="btn" id="btn-title">Title Screen</button>
      </div>
    </div>`));
  document.getElementById('btn-again').onclick = () => { meta = loadMeta(); classSelect(); };
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
