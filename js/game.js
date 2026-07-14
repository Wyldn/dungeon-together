// Game orchestrator: screens, floor flow, three-card draws, event resolution,
// character creation (race → class → origin), co-op decisions, endings.

import { CLASSES, SUBCLASSES, RANDOM_NAMES, subclassOptions } from './data/classes.js';
import { RACES, applyRacePromotion } from './data/races.js';
import { ORIGINS, originById } from './data/origins.js';
import { SKILLS } from './data/skills.js';
import { BIOMES, biomeForFloor, ENEMIES, BOSSES, ALT_BOSSES, MODIFIERS, pickBossForFloor, bossById } from './data/enemies.js';
import { EVENTS, CATEGORY_META, drawEvent } from './data/events.js';
import { CONFIG } from './data/config.js';
import { planEncounter, planBossEncounter, pushEventHistory } from './data/balance.js';
import { rankFor } from './data/ranks.js';
import { CONSUMABLES, itemById, resolveItem, rollEquipment, rollRelic, rollUnique, rollWrld, markWrldClaimed, EQUIP_SLOTS, RELICS, ALL_EQUIPMENT, WEAPONS, itemUsefulForClass, itemIncompatibleForClass } from './data/items.js';
import { applyTagOutcomeMods } from './data/eventtags.js';
import { loadMeta, saveMeta, upgradeRank, award, UPGRADES, ACHIEVEMENTS, newRun, saveRun, loadRun, clearRun, runRng, rollStart, startDescriptor, awakenMonolith, fateGrowthBoost, fateGrowthPct, fateGrowthPctOne, randomRaceId, randomClassId } from './state.js';
import { derived, classTitle, skillTier, gainXp, learnableSkills, heal, restoreMana, relicItems, equippedItems, changeFame, resourceName, appraiseRun, revealLevel, applySubclass as applySubclassFn, APPRAISABLE, allowedWeaponTypes, weaponCompatible, skillCapacity, applySkillBreakpoints } from './character.js';
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
import { heroSpriteHtml, itemIconHtml, biomeBgUrl, titleBgUrl, raceArtHtml, originArtHtml, raceIconUrl, originIconUrl, eventCatUrl, enemySpriteHtml } from './art.js';

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
  if (p === 'debug') { debugScreen(); return true; }
  return false;
}

/* ============================================================
   DEBUG / COMPENDIUM SCREEN (§17) — every class, subclass, skill,
   relic, equipment piece, enemy and boss, with their sprites.
   ============================================================ */
function debugScreen() {
  setBiomeGlow('#3f3a58'); setParticles('dust');
  const spriteMini = html => `<div class="dbg-sprite">${html || '—'}</div>`;

  // classes + their subclass trees
  const classCards = Object.values(CLASSES).map(c => {
    const subs = Object.values(SUBCLASSES).filter(s => s.parent === c.id || SUBCLASSES[s.parent]?.parent === c.id);
    const t1 = Object.values(SUBCLASSES).filter(s => s.parent === c.id);
    const subHtml = t1.map(s => {
      const deeper = s.next ? SUBCLASSES[s.next] : null;
      return `<div class="dbg-sub ${s.secret ? 'secret' : ''}">
        <b>${s.name}</b>${s.secret ? ' <span class="tag">hidden</span>' : ''} <span class="dbg-skill">↳ ${SKILLS[s.skill]?.name || s.skill}</span>
        ${deeper ? `<div class="dbg-sub2">→ ${deeper.name} <span class="dbg-skill">↳ ${SKILLS[deeper.skill]?.name || deeper.skill}</span></div>` : ''}
      </div>`;
    }).join('');
    return `<div class="dbg-card" style="--accent:${c.accent}">
      <div class="dbg-head">${spriteMini(heroSpriteHtml(c.id, 48) || ICONS[c.id])}<div><b>${c.name}</b>${c.hidden ? ' <span class="tag">hidden</span>' : ''}<div class="dbg-dim">${c.resource.name} · ${c.weapons.join(', ')}</div></div></div>
      <div class="dbg-subs">${subHtml}</div>
    </div>`;
  }).join('');

  // skills grouped by class
  const skillClasses = [...new Set(Object.values(SKILLS).map(s => s.class))];
  const skillHtml = skillClasses.map(cls => {
    const list = Object.values(SKILLS).filter(s => s.class === cls);
    const label = CLASSES[cls]?.name || (cls === 'universal' ? 'Universal' : cls === 'special' ? 'Exclusive / Drop' : cls);
    return `<div class="dbg-group"><h4>${label} <span class="dbg-dim">(${list.length})</span></h4>
      ${list.map(s => `<div class="dbg-row"><b>${s.name}</b> <span class="tag">${s.cost || 0}${s.charge ? ' +' + s.charge + '⚡' : ''}</span> <span class="tag">${s.target}</span>${s.power ? ` <span class="dbg-dim">${s.power}% ${s.stat}</span>` : ''}<div class="dbg-dim">${s.desc}</div></div>`).join('')}
    </div>`;
  }).join('');

  // equipment by slot (+ class/exclusive tags)
  const slots = ['weapon', 'helmet', 'chest', 'legs', 'boots', 'accessory'];
  const equipHtml = slots.map(sl => {
    const list = ALL_EQUIPMENT.filter(i => i.slot === sl);
    return `<div class="dbg-group"><h4>${sl} <span class="dbg-dim">(${list.length})</span></h4>
      ${list.map(i => `<div class="dbg-row">${itemIconHtml(i.id, 26)}<b class="${rarityClass(i.rarity)}">${i.name}</b> <span class="tag ${rarityClass(i.rarity)}">${i.rarity}</span>${i.wtype ? ` <span class="tag">${i.wtype}</span>` : ''}${i.exclusive ? ' <span class="tag" style="color:var(--gold)">exclusive</span>' : ''}${i.unique ? ' <span class="tag">unique</span>' : ''}${i.wrld ? ' <span class="tag">wrld</span>' : ''}<div class="dbg-dim">${i.desc}</div></div>`).join('')}
    </div>`;
  }).join('');

  const relicHtml = RELICS.map(r => `<div class="dbg-row"><b class="${rarityClass(r.rarity)}">${r.name}</b> <span class="tag ${rarityClass(r.rarity)}">${r.rarity}</span><div class="dbg-dim">${r.desc}</div></div>`).join('');
  const consHtml = CONSUMABLES.map(c => `<div class="dbg-row">${itemIconHtml(c.id, 24)}<b>${c.name}</b> <span class="tag ${rarityClass(c.rarity)}">${c.rarity}</span><div class="dbg-dim">${c.desc}</div></div>`).join('');

  // enemies by biome + bosses, with sprites
  const enemyHtml = Object.entries(ENEMIES).map(([biome, list]) => `<div class="dbg-group"><h4>${biome} <span class="dbg-dim">(${list.length})</span></h4>
    <div class="dbg-enemy-grid">${list.map(e => `<div class="dbg-enemy">${spriteMini(enemySpriteHtml(e.id, { elite: e.elite }) || `<span style="font-size:30px">${e.glyph}</span>`)}<div><b>${e.name}</b><div class="dbg-dim">hp ${e.hp} · atk ${e.atk} · def ${e.def}${e.elite ? ' · elite' : ''}${e.intelligent ? ' · bribable' : ''}</div></div></div>`).join('')}</div>
  </div>`).join('');
  const bossHtml = `<div class="dbg-group"><h4>Bosses <span class="dbg-dim">(${Object.keys(BOSSES).length} + ${Object.keys(ALT_BOSSES).length} alts)</span></h4>
    <div class="dbg-enemy-grid">${Object.entries(BOSSES).map(([f, b]) => `<div class="dbg-enemy">${spriteMini(enemySpriteHtml(b.id, { boss: true }) || `<span style="font-size:34px">${b.glyph}</span>`)}<div><b>${b.name}</b><div class="dbg-dim">F${f} · hp ${b.hp} · atk ${b.atk}</div></div></div>`).join('')}
    ${Object.entries(ALT_BOSSES).map(([f, b]) => `<div class="dbg-enemy">${spriteMini(enemySpriteHtml(b.id, { boss: true }) || `<span style="font-size:34px">${b.glyph}</span>`)}<div><b>${b.name}</b><div class="dbg-dim">F${f} ALT · hp ${b.hp} · atk ${b.atk}</div></div></div>`).join('')}</div>
  </div>`;

  // events / NPC encounters grouped by category
  const NPC_DUELS = new Set(['crimson_stranger', 'frost_revenant']);
  const STAT_L = { str: 'STR', dex: 'DEX', int: 'INT', wis: 'WIS', lk: 'LUK' };
  const signed = n => (n > 0 ? '+' : '') + n;
  const pct = n => signed(Math.round(n * 100)) + '%';
  const itemName = id => itemById(id)?.name || id;
  const skillName = id => SKILLS[id]?.name || id;

  const formatReq = req => {
    if (!req) return '';
    if (req.gold) return `needs ${req.gold}g`;
    if (req.fame) return `needs ${req.fame} Fame`;
    if (req.stat) return `needs ${STAT_L[req.stat] || req.stat} ${req.min}+`;
    if (req.class) return `${CLASSES[req.class]?.name || req.class} only`;
    if (req.flag) return `needs flag:${req.flag}`;
    if (req.notFlag) return `blocked by flag:${req.notFlag}`;
    if (req.item) return `needs ${itemName(req.item)}`;
    return 'requirement';
  };

  const summarizeEffects = o => {
    if (!o) return '—';
    if (o.roll) {
      const r = o.roll;
      const label = `roll ${STAT_L[r.stat] || r.stat} DC ${r.dc}`;
      return `${label} → Success: ${summarizeEffects(o.success)} · Fail: ${summarizeEffects(o.fail)}`;
    }
    if (o.randomOutcome) {
      return 'random: ' + o.randomOutcome.map((b, i) => `[${i + 1}] ${summarizeEffects(b)}`).join(' | ');
    }
    const parts = [];
    if (o.gold) parts.push(`${signed(o.gold)} gold`);
    if (o.goldPct) parts.push(`${pct(o.goldPct)} gold`);
    if (o.hp) parts.push(`${signed(o.hp)} HP`);
    if (o.hpPct) parts.push(`${pct(o.hpPct)} HP`);
    if (o.maxHp) parts.push(`${signed(o.maxHp)} max HP`);
    if (o.fullHeal) parts.push('full heal');
    if (o.mana) parts.push(`${signed(o.mana)} resource`);
    if (o.manaPct) parts.push(`${pct(o.manaPct)} resource`);
    if (o.fullMana) parts.push('full resource');
    if (o.fame) parts.push(`${signed(o.fame)} Fame`);
    if (o.xp) parts.push(`${signed(o.xp)} XP`);
    if (o.xpScaled) parts.push(`~${o.xpScaled}+floor XP`);
    if (o.statUp) parts.push(`${signed(o.statUp.amt)} ${STAT_L[o.statUp.stat] || o.statUp.stat}`);
    if (o.statUpRandom) parts.push(`+${o.statUpRandom} random stat${o.statUpRandom > 1 ? 's' : ''}`);
    if (o.statUpMain) parts.push(`+${o.statUpMain} main stat`);
    if (o.statUpScaled) parts.push(`+${o.statUpScaled}+floor/12 directed growth`);
    if (o.itemRoll) parts.push(typeof o.itemRoll === 'object' ? 'roll equipment (filtered)' : 'roll equipment');
    if (o.classGear) parts.push('class-flavored gear');
    if (o.relicRoll) parts.push('roll relic');
    if (o.uniqueItem) parts.push('UNIQUE gear');
    if (o.wrldItem) parts.push('WRLD gear');
    if (o.item) parts.push(`item: ${itemName(o.item)}`);
    if (o.consumable) parts.push(`consumable: ${itemName(o.consumable)}`);
    if (o.consumable2) parts.push(`consumable: ${itemName(o.consumable2)}`);
    if (o.useItem) parts.push(`consume ${itemName(o.useItem)}`);
    if (o.chest) parts.push(o.safeMimic ? 'open chest (safe check)' : 'open chest (mimic risk)');
    if (o.appraisal) parts.push(`${o.appraisal} appraisal`);
    if (o.fameReward) parts.push('fame-scaled gold + growth + heal');
    if (o.promoteRace) parts.push('race promotion');
    if (o.learnAoe) parts.push('learn class AoE technique');
    if (o.upgradeWeapon) parts.push(o.upgradeScaled ? 'weapon upgrade (scales with floor)' : 'weapon upgrade (+4 dmg)');
    if (o.flag) parts.push(`set flag:${o.flag}`);
    if (o.clearFlag) parts.push(`clear flag:${o.clearFlag}`);
    if (o.sigil) parts.push(`sigil: ${o.sigil}`);
    if (o.revealFloors) parts.push(`reveal next ${o.revealFloors} floors`);
    if (o.setFuture) parts.push('set next floor path category');
    if (o.escape) parts.push('escape the tower (victory)');
    if (o.subclassOffer) parts.push('subclass offer');
    if (o.combat) {
      const foes = (o.combat.enemies || []).join(', ');
      let c = `combat vs ${foes}`;
      if (o.combat.reward?.options) {
        const opts = o.combat.reward.options.map(op =>
          op.kind === 'skill' ? skillName(op.id) : itemName(op.id)
        ).join(' or ');
        c += ` → choose: ${opts}`;
      }
      parts.push(c);
    }
    return parts.length ? parts.join(', ') : 'flavor only';
  };

  const hasCombatOutcome = ev => (ev.choices || []).some(c => {
    const walk = o => {
      if (!o || typeof o !== 'object') return false;
      if (o.combat) return true;
      return Object.values(o).some(walk);
    };
    return walk(c.outcome);
  });

  const formatChoices = e => {
    if (e.shop && !(e.choices || []).length) {
      return `<div class="dbg-choice"><b>→</b> Opens the merchant shop</div>`;
    }
    if (!(e.choices || []).length) return `<div class="dbg-choice dbg-dim">No choices</div>`;
    return e.choices.map(c => {
      const req = formatReq(c.req);
      const hint = c.hint ? `<span class="dbg-dim">(${c.hint})</span>` : '';
      const need = req ? `<span class="tag">${req}</span>` : '';
      return `<div class="dbg-choice"><b>→ ${c.label}</b> ${need} ${hint}<div class="dbg-dim">${summarizeEffects(c.outcome)}</div></div>`;
    }).join('');
  };

  const eventHtml = Object.keys(CATEGORY_META).map(cat => {
    const list = EVENTS.filter(e => (e.category || 'unknown') === cat);
    if (!list.length) return '';
    const meta = CATEGORY_META[cat];
    return `<details class="dbg-group dbg-collapse">
      <summary class="dbg-collapse-sum">${meta.glyph} ${meta.label} <span class="dbg-dim">(${list.length})</span></summary>
      ${list.map(e => {
        const tags = [
          e.type ? `<span class="tag">${e.type}</span>` : '',
          `<span class="tag">${e.biome || 'any'}</span>`,
          e.once ? '<span class="tag">once</span>' : '',
          e.cond ? '<span class="tag">conditional</span>' : '',
          e.comeback ? '<span class="tag">comeback</span>' : '',
          e.shop ? '<span class="tag">shop</span>' : '',
          NPC_DUELS.has(e.id) ? '<span class="tag" style="color:var(--gold)">NPC duel</span>'
            : hasCombatOutcome(e) ? '<span class="tag" style="color:var(--gold)">combat</span>' : '',
        ].filter(Boolean).join(' ');
        const blurb = (e.text || '').length > 140 ? e.text.slice(0, 140) + '…' : (e.text || '');
        return `<div class="dbg-row">
          <span style="font-size:22px">${e.glyph || '❓'}</span>
          <b>${e.title}</b> <span class="dbg-dim">(${e.id})</span> ${tags}
          <div class="dbg-dim">${blurb}</div>
          ${formatChoices(e)}
        </div>`;
      }).join('')}
    </details>`;
  }).join('');

  app.innerHTML = '';
  const scr = el(`<div class="screen dbg-screen">
    <div class="select-header"><h2>Compendium / Debug</h2><p>Every class, technique, relic, item, enemy, boss, and event in the tower.</p></div>
    <div style="text-align:center;margin-bottom:12px"><button class="btn small" id="dbg-back">← Title</button></div>
    <div class="dbg-tabs">
      <button class="btn small primary" data-tab="classes">Classes</button>
      <button class="btn small" data-tab="skills">Techniques</button>
      <button class="btn small" data-tab="equip">Equipment</button>
      <button class="btn small" data-tab="relics">Relics &amp; Items</button>
      <button class="btn small" data-tab="enemies">Bestiary</button>
      <button class="btn small" data-tab="events">Events</button>
    </div>
    <div class="dbg-panel" id="dbg-classes"><div class="dbg-grid">${classCards}</div></div>
    <div class="dbg-panel" id="dbg-skills" style="display:none">${skillHtml}</div>
    <div class="dbg-panel" id="dbg-equip" style="display:none">${equipHtml}</div>
    <div class="dbg-panel" id="dbg-relics" style="display:none"><div class="dbg-group"><h4>Relics (${RELICS.length})</h4>${relicHtml}</div><div class="dbg-group"><h4>Consumables (${CONSUMABLES.length})</h4>${consHtml}</div></div>
    <div class="dbg-panel" id="dbg-enemies" style="display:none">${enemyHtml}${bossHtml}</div>
    <div class="dbg-panel" id="dbg-events" style="display:none">${eventHtml}</div>
  </div>`);
  app.appendChild(scr);
  const panels = { classes: 'dbg-classes', skills: 'dbg-skills', equip: 'dbg-equip', relics: 'dbg-relics', enemies: 'dbg-enemies', events: 'dbg-events' };
  scr.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    SFX.click();
    scr.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('primary', x === b));
    for (const [tab, id] of Object.entries(panels)) document.getElementById(id).style.display = tab === b.dataset.tab ? '' : 'none';
  });
  scr.querySelector('#dbg-back').onclick = () => { SFX.click(); titleScreen(); };
}

function titleScreen() {
  const saved = loadRun();
  const vol = Math.round(Music.getVolume() * 100);
  const vista = titleBgUrl();
  app.innerHTML = '';
  app.appendChild(el(`
    <div class="screen title-screen">
      ${vista
        ? `<img class="title-vista" src="${vista}" alt="" />`
        : '<div class="title-vista title-vista-fallback" aria-hidden="true"><span class="title-tower">🗼</span></div>'}
      <div class="title-veil" aria-hidden="true"></div>

      <div class="title-hero">
        <h1 class="game-title">DUNGEON<br/>TOGETHER</h1>
        <p class="game-subtitle">Fifty-one floors. One throne. The tower deals first.</p>
      </div>

      <div class="title-stack">
        <div class="title-actions">
          ${saved ? `<button class="btn primary" id="btn-continue">Continue — Fl.${saved.floor} · ${saved.name}</button>` : ''}
          <button class="btn ${saved ? '' : 'primary'}" id="btn-new">New Climb</button>
          <button class="btn" id="btn-coop">Play Together</button>
        </div>
        <div class="title-rail">
          <button class="btn ghost small" id="btn-sanctum">Sanctum ◈ ${meta.shards}</button>
          <button class="btn ghost small" id="btn-debug">Compendium</button>
          <div class="title-audio">
            <button class="btn ghost small" id="btn-mute">${isMuted() ? 'Sound Off' : 'Sound On'}</button>
            <div class="audio-row title-vol">
              <input type="range" id="vol-slider" class="vol-slider" min="0" max="100" value="${vol}" aria-label="Music volume" />
              <span id="vol-val" class="vol-val">${vol}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="title-meta">
        <div class="title-stats">
          <span>Runs <b>${meta.totalRuns}</b></span>
          <span>Wins <b>${meta.wins}</b></span>
          <span>Best <b>${meta.bestFloor}</b></span>
        </div>
        <div class="title-footer">CO-OP ROGUELIKE · MUSIC XDEVIRUCHI · ART PIXELFLUSH + ORIGINAL</div>
      </div>
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
  document.getElementById('btn-mute').onclick = e => {
    const m = toggleMute();
    Music.syncMute();
    e.target.textContent = m ? 'Sound Off' : 'Sound On';
  };
  document.getElementById('btn-debug').onclick = () => { SFX.click(); debugScreen(); };
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
  const pick = { raceId: 'human', classId: 'warrior', originId: ORIGINS[0].id, fateRace: false, fateClass: false };
  let step = 0; // 0 race, 1 class, 2 origin, 3 name
  let rerolls = 0;
  let gen = null;
  let appraised = false;      // has the Monolith crystal been charged?
  let crystalCtl = null;
  let apprBand = null;        // the revealed potential band (computed once per roll)

  function maxRerolls() { return CONFIG.chargen.rerolls + (RACES[pick.raceId].extraReroll || 0); }
  function fatePct() { return fateGrowthPct(pick.fateRace, pick.fateClass); }

  function render() {
    if (crystalCtl) { crystalCtl.destroy(); crystalCtl = null; }
    app.innerHTML = '';
    const steps = ['Bloodline', 'Calling', 'Origin', 'The Name'];
    const pickStep = step <= 2;
    const scr = el(`<div class="screen ${pickStep ? 'creation-screen' : (step === 3 ? 'creation-screen mono-screen' : '')}">
      <div class="select-header">
        <h2>${steps[step]}</h2>
        <p id="step-sub"></p>
        <div class="step-dots">${steps.map((_, i) => `<span class="fdot ${i === step ? 'on' : i < step ? 'done' : ''}"></span>`).join('')}</div>
      </div>
      <div id="step-body" class="creation-body"></div>
      <div class="creation-nav">
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
      const fateKey = isClass ? 'fateClass' : isOrigin ? null : 'fateRace';
      const boostEach = fateGrowthPctOne();
      const RACE_TAG = {
        human: 'ADAPTABLE', elf: 'ARCANE', orc: 'BRUTAL', dwarf: 'ENDURING',
        halfling: 'FORTUNATE', tiefling: 'INFERNAL', beastfolk: 'FERAL', dragonkin: 'SCALED',
      };
      const ORIGIN_TAG = {
        mage_academy: 'SCHOLAR', sword_academy: 'DUELIST', mercenary: 'SELLSWORD', guild: 'LICENSED',
        temple: 'DEVOUT', streets: 'OUTLAW', ranger_lodge: 'WARDEN', circus: 'PERFORMER',
        forge: 'SMITH', archive: 'SCRIBE',
      };
      const list = isOrigin ? ORIGINS : Object.values(isClass ? CLASSES : RACES);
      const key = isClass ? 'classId' : isOrigin ? 'originId' : 'raceId';
      const selectable = it => isClass ? !(it.hidden && !(it.unlockCond?.(meta))) : true;
      const playableCount = list.filter(selectable).length;
      sub.textContent = isClass
        ? `${playableCount} callings — use ◄ ► to see them all.`
        : isOrigin
          ? `${playableCount} origins — use ◄ ► to browse. Yours plays out at the gate.`
          : `${playableCount} peoples climb — use ◄ ► to see them all.`;
      const accentOf = it => isClass ? it.accent : isOrigin ? '#8fd8cc' : '#e8b64a';
      const tagOf = it => isClass ? it.resource.name.toUpperCase() : isOrigin ? (ORIGIN_TAG[it.id] || 'ORIGIN') : (RACE_TAG[it.id] || 'CLIMBER');
      const blurbOf = it => isClass ? it.epithet : it.blurb;
      const railArtOf = it => isClass
        ? heroSpriteHtml(it.id, 40)
        : isOrigin ? (originIconUrl(it.id) && `<img class="px-icon" src="${originIconUrl(it.id)}" style="width:40px;height:40px" alt="">`)
        : (raceIconUrl(it.id) && `<img class="px-icon" src="${raceIconUrl(it.id)}" style="width:40px;height:40px" alt="">`);
      const emblemOf = it => railArtOf(it) || (isOrigin ? (it.name.replace(/^The\s+/i, '')[0] || it.name[0]) : (it.glyph || it.name[0]));
      const artOf = it => isClass
        ? (heroSpriteHtml(it.id, 280) || `<div class="class-icon" style="width:220px;height:220px">${ICONS[it.id]}</div>`)
        : isOrigin
          ? (originArtHtml(it.id, 220) || `<div style="font-size:160px;line-height:1">${it.glyph}</div>`)
          : (raceArtHtml(it.id, 260) || `<div style="font-size:160px;line-height:1">${it.glyph}</div>`);

      if (fateKey && pick[fateKey]) {
        // Fate already locked this slot — never reveal the pick here (blocks reroll-shopping).
        const kindLabel = isClass ? 'calling' : 'bloodline';
        sub.textContent = `Fate has spoken. Your ${kindLabel} stays sealed until the climb begins.`;
        body.innerHTML = `
          <div class="creation-stage fate-sealed-stage">
            <div class="fate-sealed">
              <div class="fate-sealed-glyph">🎲</div>
              <div class="fate-sealed-title"><span class="fate-badge">FATE</span> ${isClass ? 'Calling' : 'Bloodline'} sealed</div>
              <div class="fate-sealed-blurb">A random ${kindLabel} is locked. You will not see it until you enter the tower.<br/>+${boostEach}% level-up growth.</div>
              <div class="fate-sealed-actions">
                <button class="btn primary" id="btn-fate-continue">Continue →</button>
                <button class="btn ghost small" id="btn-fate-break">Choose yourself instead</button>
              </div>
            </div>
          </div>`;
        body.querySelector('#btn-fate-continue').onclick = () => { SFX.click(); step++; render(); };
        body.querySelector('#btn-fate-break').onclick = () => {
          pick[fateKey] = false;
          SFX.click();
          toast(`The seal breaks. Choose your ${kindLabel}.`, 'sys');
          render();
        };
      } else {
      body.innerHTML = `
        <div class="creation-stage">
          <div class="creation-hero">
            <div class="showcase">
              <div class="showcase-art" id="sc-art"></div>
              <div class="showcase-name" id="sc-name"></div>
            </div>
            <div class="showcase-text" id="sc-text"></div>
          </div>
          <div class="creation-rail">
            <div class="rail-arrow" id="rail-left">◄</div>
            <div class="rail-window"><div class="rail-track" id="rail-track"></div></div>
            <div class="rail-arrow" id="rail-right">►</div>
          </div>
        </div>`;

      // Tuck Trust Fate into the bottom nav so the stage can give space to the portrait.
      if (fateKey) {
        const nav = scr.querySelector('.creation-nav');
        nav.classList.add('has-fate');
        const actions = document.createElement('div');
        actions.className = 'creation-nav-actions';
        [...nav.children].forEach(child => actions.appendChild(child));
        nav.appendChild(actions);
        nav.insertAdjacentHTML('afterbegin', `<div class="fate-nav">
          <button class="btn small" id="btn-fate">🎲 Trust fate</button>
          <div class="fate-hint">Hidden random ${isClass ? 'calling' : 'bloodline'} · +${boostEach}% growth · revealed on the climb</div>
        </div>`);
      }

      const track = body.querySelector('#rail-track');
      // Card pitch must match CSS (.rail-card width + gap) for centering.
      const CARD_PITCH = 136;
      const RAIL_CENTER = 272;
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
        track.style.transform = `translateX(${RAIL_CENTER - CARD_PITCH * selIdx}px)`;
        track.querySelectorAll('.rail-card').forEach(c => c.classList.toggle('active', c.dataset.id === pick[key]));
      }
      function selectItem(id) {
        if (id === pick[key]) return;
        pick[key] = id;
        if (fateKey) pick[fateKey] = false;
        SFX.click();
        center();
        paint(list[idxOf(id)], true);
      }
      function stepSel(dir) {
        let i = idxOf(pick[key]) + dir;
        while (i >= 0 && i < list.length) { if (selectable(list[i])) return selectItem(list[i].id); i += dir; }
      }
      body.querySelector('#rail-left').onclick = () => stepSel(-1);
      body.querySelector('#rail-right').onclick = () => stepSel(1);
      scr.querySelector('#btn-fate')?.addEventListener('click', () => {
        const pool = list.filter(selectable);
        const chosen = pool[Math.floor(Math.random() * pool.length)];
        pick[key] = chosen.id;
        pick[fateKey] = true;
        SFX.unlock();
        toast(isClass ? 'Fate seals your calling.' : 'Fate seals your bloodline.', 'good');
        step++;
        render();
      });
      center();
      paint(list[idxOf(pick[key])], false);
      }
    }
    if (step === 3) {
      if (!gen) gen = rollStart(pick.classId, pick.raceId);
      const desc = startDescriptor(gen.percentile);
      const band = apprBand || potentialBand(gen.percentile);
      const boost = fatePct();
      sub.textContent = appraised ? 'Potential felt. Name yourself — or tempt fate once more.' : 'Attune to the Monolith — press & hold to gauge your potential.';
      const fateLine = boost
        ? `<div class="mono-earned"><span class="fate-badge">FATE</span> Trusted chance on ${[pick.fateRace && 'bloodline', pick.fateClass && 'calling'].filter(Boolean).join(' & ')} · +${boost}% growth</div>`
        : '';
      const revealHtml = `
        <div class="mono-reveal">
          <div class="mono-feel">"${desc.word}"</div>
          <div class="mono-range-label">POTENTIAL RANGE</div>
          <div class="mono-band">
            <span style="color:var(--rk-${band.low})">${band.low}</span>
            <span class="mono-band-sep">—</span>
            <span style="color:var(--rk-${band.high})">${band.high}</span>
          </div>
          <div class="mono-earned">Your true rank is not given — it is earned within.</div>
          <div class="mono-earned" style="opacity:.75;margin-top:4px">Approach the Gate to seal this roll — the Monolith awakens you then.</div>
          ${fateLine}
        </div>`;
      const hintHtml = `<div class="mono-hint">press &amp; hold the crystal to measure your potential</div>${fateLine}`;
      const actionsHtml = `
          <div class="mono-actions" id="mono-actions">
            <input class="name-input" id="name" maxlength="16" placeholder="Name your climber..." />
            <button class="btn small" id="btn-reroll" ${rerolls >= maxRerolls() ? 'disabled' : ''}>🎲 Tempt fate (${maxRerolls() - rerolls} left)</button>
          </div>
          <div class="mono-reroll-hint">Tempt fate rerolls your hidden starting gifts — then attune again to feel the new roll.</div>`;
      const raceLabel = pick.fateRace ? '???' : RACES[pick.raceId].name;
      const classLabel = pick.fateClass ? '???' : CLASSES[pick.classId].name;
      const raceArt = pick.fateRace
        ? '<span style="font-size:28px">🎲</span>'
        : (raceIconUrl(pick.raceId) ? `<img class="px-icon" src="${raceIconUrl(pick.raceId)}" style="width:36px;height:36px" alt="">` : '');
      const classArt = pick.fateClass
        ? '<span style="font-size:28px">🎲</span>'
        : (heroSpriteHtml(pick.classId, 36) || `<span style="font-size:24px">${RACES[pick.raceId].glyph}</span>`);
      body.innerHTML = `
        <div class="mono-stage">
          <div class="mono-title">THE MONOLITH OF MEASURE</div>
          <div class="mono-identity">
            ${classArt}
            ${raceArt}
            <div class="mono-identity-text">${raceLabel} ${classLabel} · ${originById(pick.originId).name}</div>
          </div>
          <div class="mono-crystal-wrap ${appraised ? 'is-done' : ''}" id="mono-crystal-wrap">
            <canvas id="crystal" width="320" height="400"></canvas>
          </div>
          <div class="mono-caption" id="mono-caption">${appraised ? revealHtml : hintHtml}</div>
          ${appraised ? actionsHtml : '<div id="mono-post"></div>'}
        </div>`;
      const cv = body.querySelector('#crystal');
      const nextBtn = scr.querySelector('#btn-next');
      const showAppraisedUi = () => {
        const captionEl = body.querySelector('#mono-caption');
        const wrap = body.querySelector('#mono-crystal-wrap');
        wrap?.classList.add('is-done');
        if (captionEl) captionEl.innerHTML = (() => {
          const d = startDescriptor(gen.percentile);
          const b = apprBand || potentialBand(gen.percentile);
          return `
        <div class="mono-reveal">
          <div class="mono-feel">"${d.word}"</div>
          <div class="mono-range-label">POTENTIAL RANGE</div>
          <div class="mono-band">
            <span style="color:var(--rk-${b.low})">${b.low}</span>
            <span class="mono-band-sep">—</span>
            <span style="color:var(--rk-${b.high})">${b.high}</span>
          </div>
          <div class="mono-earned">Your true rank is not given — it is earned within.</div>
          <div class="mono-earned" style="opacity:.75;margin-top:4px">Approach the Gate to seal this roll — the Monolith awakens you then.</div>
          ${fateLine}
        </div>`;
        })();
        let post = body.querySelector('#mono-post');
        if (!post) {
          post = el('<div id="mono-post"></div>');
          body.querySelector('.mono-stage')?.appendChild(post);
        }
        if (!body.querySelector('#mono-actions')) {
          post.outerHTML = actionsHtml;
          const nameInput = body.querySelector('#name');
          nameInput.value = creationFlow._savedName || RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
          nameInput.addEventListener('input', () => { creationFlow._savedName = nameInput.value; });
          body.querySelector('#btn-reroll').onclick = () => {
            if (rerolls >= maxRerolls()) return;
            creationFlow._savedName = nameInput.value;
            rerolls++; gen = rollStart(pick.classId, pick.raceId); appraised = false; apprBand = null;
            SFX.cardDeal(); render();
          };
        }
        if (nextBtn) { nextBtn.disabled = false; nextBtn.title = ''; }
        sub.textContent = 'Potential felt. Name yourself — or tempt fate once more.';
      };
      if (!appraised) {
        crystalCtl = mountCrystal(cv, { onComplete: () => {
          appraised = true;
          apprBand = potentialBand(gen.percentile);
          SFX.unlock();
          // Keep the filled crystal on screen — reveal appraisal below it.
          showAppraisedUi();
        } });
      } else {
        crystalCtl = mountCrystal(cv, { filled: true });
        const nameInput = body.querySelector('#name');
        nameInput.value = creationFlow._savedName || RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
        nameInput.addEventListener('input', () => { creationFlow._savedName = nameInput.value; });
        body.querySelector('#btn-reroll').onclick = () => {
          if (rerolls >= maxRerolls()) return;
          creationFlow._savedName = nameInput.value;
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
      awakenMonolith(gen);
      if (coopContext) return coopContext.done({ ...pick, name, gen });
      run = newRun(meta, {
        classId: pick.classId, raceId: pick.raceId, originId: pick.originId, name,
        fateRace: pick.fateRace, fateClass: pick.fateClass,
      });
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
  // Awaken once on commit — never during measure/reroll previews.
  awakenMonolith(gen);
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
  run.growthBoost = fateGrowthBoost(pick.fateRace, pick.fateClass);
  run.fateRace = !!pick.fateRace;
  run.fateClass = !!pick.fateClass;
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
  let myPick = { raceId: 'human', classId: 'warrior', originId: ORIGINS[0].id, fateRace: false, fateClass: false };
  let myReady = false;
  let decisionMode = 'majority'; // host-controlled (handoff §3)
  const lobbyState = new Map();
  let gen = rollStart(myPick.classId, myPick.raceId);
  let rerolls = 0;
  function maxRerolls() { return CONFIG.chargen.rerolls + (RACES[myPick.raceId].extraReroll || 0); }
  function fateBoostPct() { return fateGrowthPct(myPick.fateRace, myPick.fateClass); }

  // Remote updates touch ONLY the roster/mode sections — never the whole
  // screen, so nothing jumps while you are picking (patch).
  const offLobby = coopS.net.on('lobby', (d, from) => {
    lobbyState.set(from, d);
    const p = coopS.partners.get(from);
    // Only cache a revealed calling — sealed fate stays hidden until the climb.
    if (p && d.classId && !d.fateClass) p.classId = d.classId;
    updateRoster();
  });
  const offMode = coopS.net.on('mode', d => { decisionMode = d.mode; updateModeButtons(); });
  const offStart = coopS.net.on('start', d => beginCoopRun(d.mode));
  coopS.onPartnerUpdate = () => updateRoster();
  coopS.onPartnerLeft = () => updateRoster();

  function sendLobby() {
    // When fate-sealed, omit the real ids so partners cannot peek the roll.
    coopS.net.send({
      k: 'lobby',
      classId: myPick.fateClass ? null : myPick.classId,
      raceId: myPick.fateRace ? null : myPick.raceId,
      fateRace: !!myPick.fateRace,
      fateClass: !!myPick.fateClass,
      ready: myReady,
      name: myName,
    });
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
    coopS.floorContent.clear();
    coopS.gates.clear();
    coopS.requeueVotes = new Set();
    run = newRun(meta, {
      classId: myPick.classId, raceId: myPick.raceId, originId: myPick.originId,
      name: myName, seed: coopS.seed, gen: awakenMonolith(gen),
      fateRace: myPick.fateRace, fateClass: myPick.fateClass,
    });
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
    if ((kind === 'race' && myPick.fateRace) || (kind === 'class' && myPick.fateClass)) {
      modalCustom((m, close) => {
        const label = kind === 'race' ? 'bloodline' : 'calling';
        m.innerHTML = `<h3>Fate sealed this ${label}</h3>
          <p class="modal-sub">The result stays hidden until the climb. Break the seal to choose yourself — you lose the growth boost for this pick.</p>
          <div class="pick-grid">
            <button class="pick-option" id="break-seal"><span class="po-name">Choose yourself</span></button>
            <button class="pick-option" data-close="x"><span class="po-name">Keep the seal</span></button>
          </div>`;
        m.querySelector('#break-seal').onclick = () => {
          if (kind === 'race') myPick.fateRace = false;
          else myPick.fateClass = false;
          SFX.click();
          close();
          updatePickTiles();
          updatePotential();
          sendLobby();
          openPicker(kind);
        };
      });
      return;
    }
    const defs = {
      race: { title: 'Bloodline', items: Object.values(RACES).map(r => ({ id: r.id, glyph: r.glyph, icon: raceIconUrl(r.id) && `<img class="px-icon" src="${raceIconUrl(r.id)}" style="width:40px;height:40px" alt="">`, name: r.name, desc: r.hint })) },
      class: {
        title: 'Calling',
        items: Object.values(CLASSES)
          .filter(c => !c.hidden || c.unlockCond?.(meta))
          .map(c => ({ id: c.id, glyph: null, icon: heroSpriteHtml(c.id, 40) || ICONS[c.id], accent: c.accent, name: c.name, desc: `${c.resource.name} · ${c.weapons.join(', ')}` })),
      },
      origin: { title: 'Origin', items: ORIGINS.map(o => ({ id: o.id, glyph: o.glyph, icon: originIconUrl(o.id) && `<img class="px-icon" src="${originIconUrl(o.id)}" style="width:40px;height:40px" alt="">`, name: o.name, desc: o.blurb })) },
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
        if (kind === 'race') myPick.fateRace = false;
        if (kind === 'class') myPick.fateClass = false;
        if (kind === 'race' || kind === 'class') {
          gen = rollStart(myPick.classId, myPick.raceId);
          rerolls = 0;
          updatePotential();
        }
        SFX.click();
        close();
        updatePickTiles();
        sendLobby();
      });
    });
  }

  function trustFate(kind) {
    if (myReady) return;
    if (kind === 'race') {
      myPick.raceId = randomRaceId();
      myPick.fateRace = true;
    } else if (kind === 'class') {
      myPick.classId = randomClassId(meta);
      myPick.fateClass = true;
    }
    gen = rollStart(myPick.classId, myPick.raceId);
    rerolls = 0;
    SFX.unlock();
    toast(kind === 'race' ? 'Fate seals your bloodline.' : 'Fate seals your calling.', 'good');
    updatePickTiles();
    updatePotential();
    sendLobby();
  }

  function pickTilesHtml() {
    const boost = fateGrowthPctOne();
    const raceSealed = myPick.fateRace;
    const classSealed = myPick.fateClass;
    const raceArt = raceSealed
      ? '<span style="font-size:32px">🎲</span>'
      : (raceIconUrl(myPick.raceId) ? `<img class="px-icon" src="${raceIconUrl(myPick.raceId)}" style="width:44px;height:44px" alt="">` : `<span style="font-size:32px">${RACES[myPick.raceId].glyph}</span>`);
    const classArt = classSealed
      ? '<span style="font-size:32px">🎲</span>'
      : (heroSpriteHtml(myPick.classId, 44) || `<div class="class-icon" style="width:40px;height:40px;margin:0 auto;color:${CLASSES[myPick.classId].accent}">${ICONS[myPick.classId]}</div>`);
    return `
      <div class="panel pick-tile" id="pick-race"><div class="pt-art">${raceArt}</div><b>${raceSealed ? '???' : RACES[myPick.raceId].name}${raceSealed ? ' <span class="fate-badge">FATE</span>' : ''}</b><div class="pt-hint">${raceSealed ? 'sealed until the climb' : 'change race'}</div>${raceSealed || myReady ? '' : `<button class="btn small fate-mini" id="fate-race" type="button">🎲 Trust fate (+${boost}%)</button>`}</div>
      <div class="panel pick-tile" id="pick-class"><div class="pt-art">${classArt}</div><b>${classSealed ? '???' : CLASSES[myPick.classId].name}${classSealed ? ' <span class="fate-badge">FATE</span>' : ''}</b><div class="pt-hint">${classSealed ? 'sealed until the climb' : 'change class'}</div>${classSealed || myReady ? '' : `<button class="btn small fate-mini" id="fate-class" type="button">🎲 Trust fate (+${boost}%)</button>`}</div>
      <div class="panel pick-tile" id="pick-origin"><div class="pt-art">${originIconUrl(myPick.originId) ? `<img class="px-icon" src="${originIconUrl(myPick.originId)}" style="width:44px;height:44px" alt="">` : `<span style="font-size:32px">${originById(myPick.originId).glyph}</span>`}</div><b style="font-size:13px">${originById(myPick.originId).name}</b><div class="pt-hint">change origin</div></div>`;
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
    document.getElementById('fate-race')?.addEventListener('click', e => { e.stopPropagation(); trustFate('race'); });
    document.getElementById('fate-class')?.addEventListener('click', e => { e.stopPropagation(); trustFate('class'); });
  }

  function potentialHtml() {
    const desc = startDescriptor(gen.percentile);
    const boost = fateBoostPct();
    const fateNote = boost
      ? `<div style="font-size:13px;color:var(--gold-bright);margin:0 0 10px;line-height:1.35"><span class="fate-badge">FATE</span> +${boost}% level-up growth from trusting chance.</div>`
      : '';
    return `
      <div style="font-family:var(--font-display);font-size:13px;letter-spacing:.08em;color:var(--ink-dim);margin-bottom:6px">STARTING POTENTIAL</div>
      <div style="font-size:18px;color:var(--gold-bright);font-family:var(--font-display)">${desc.word}</div>
      <div style="font-size:14px;color:var(--ink-dim);margin:6px 0 10px;line-height:1.4">${desc.flavor}</div>
      ${fateNote}
      <div style="font-size:13px;color:var(--ink-dim);margin:0 0 10px;line-height:1.35">Tempt fate to reroll. The Monolith awakens your gifts when the climb begins.</div>
      <button class="btn small" id="btn-reroll" ${myReady || rerolls >= maxRerolls() ? 'disabled' : ''}>🎲 Tempt fate (${Math.max(0, maxRerolls() - rerolls)} left)</button>`;
  }

  function updatePotential() {
    const elp = document.getElementById('potential-box');
    if (elp) elp.innerHTML = potentialHtml();
    document.getElementById('btn-reroll')?.addEventListener('click', () => {
      if (myReady || rerolls >= maxRerolls()) return;
      rerolls++;
      gen = rollStart(myPick.classId, myPick.raceId);
      SFX.click();
      updatePotential();
    });
  }

  function rosterHtml() {
    const partners = [...coopS.partners.entries()];
    const rows = [
      {
        name: myName + ' (you)',
        classId: myPick.classId, raceId: myPick.raceId,
        fateRace: myPick.fateRace, fateClass: myPick.fateClass,
        ready: myReady, host: coopS.isHost,
      },
      ...partners.map(([id, p]) => {
        const lob = lobbyState.get(id);
        return {
          name: p.name,
          classId: lob?.classId, raceId: lob?.raceId,
          fateRace: !!lob?.fateRace, fateClass: !!lob?.fateClass,
          ready: lob?.ready, host: coopS.net.roster.find(r => r.id === id)?.host,
        };
      }),
    ];
    return rows.map(r => `
      <div class="inv-item">
        <div class="item-name">${r.host ? '👑 ' : ''}${r.name}</div>
        <div style="display:flex;gap:10px;align-items:center">
          <span class="tag">${(() => {
            const race = r.fateRace ? '???' : (r.raceId ? RACES[r.raceId]?.name || '' : '');
            const cls = r.fateClass ? '???' : (r.classId ? CLASSES[r.classId]?.name : 'choosing...');
            return `${race} ${cls}`.trim();
          })()}</span>
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
      <div class="panel" style="padding:14px 18px;margin-bottom:14px" id="potential-box">${potentialHtml()}</div>
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
    updatePotential();

    scr.querySelector('#btn-ready').onclick = () => {
      myReady = !myReady;
      SFX.click(); sendLobby();
      const b = scr.querySelector('#btn-ready');
      b.textContent = myReady ? '✔ Ready (click to unready)' : 'Ready Up';
      b.classList.toggle('primary', !myReady);
      updateRoster();
      updatePotential();
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
  const gear = EQUIP_SLOTS.map(slot => {
    const id = run.equipment?.[slot];
    if (!id) return null;
    const it = resolveItem(run, id);
    return it ? { slot, id: it.id, name: it.name, rarity: it.rarity, desc: it.desc } : null;
  }).filter(Boolean);
  const pack = (run.inventory || []).slice(0, 12).map(id => {
    const it = resolveItem(run, id);
    return it ? { id: it.id, name: it.name, rarity: it.rarity, desc: it.desc } : { id, name: id, rarity: 'common', desc: '' };
  });
  return {
    ...run, def: d.def, dodge: Math.round(d.dodge), act,
    spdStat: Math.round(4 + d.dex * 0.3),
    initiative: d.initiative,
    sheetGear: gear,
    sheetPack: pack,
  };
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
/** When true, character sheet is read-only (no equip/sell/use). Set around combat. */
let sheetCombatLock = false;

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
  hud.querySelector('#hud-sheet').onclick = () => {
    SFX.click();
    characterSheet({ locked: sheetCombatLock });
  };
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
  const gear = equippedItems(run).map(it => it.name);
  return {
    run, coopS, resolveCard, flash, biome: biomeForFloor(run.floor),
    resourceName: resourceName(run),
    classTitle: classTitle(run),
    equippedSummary: gear,
    onCharacter: () => { SFX.click(); characterSheet(); },
    onPartnerPeek: (partnerId) => { SFX.click(); partnerSheetModal(partnerId); },
  };
}

function partnerSheetModal(partnerId) {
  if (!coopS) return;
  const p = coopS.partners.get(partnerId);
  if (!p) return;
  const s = p.status || {};
  const gear = s.gear || [];
  const pack = s.pack || [];
  const appr = s.appraisal;
  const resLabel = CLASSES[s.classId || p.classId]?.resource?.name || 'Resource';
  modalCustom((m, close) => {
    m.classList.add('sheet-modal');
    const statRows = appr?.results
      ? Object.entries(appr.results).map(([k, v]) => `<tr><td>${k.toUpperCase()}</td><td>${v}</td></tr>`).join('')
      : '<tr><td colspan="2" style="color:var(--ink-faint)">No appraisal shared yet</td></tr>';
    m.innerHTML = `
      <h3>${s.name || p.name} — Lv ${s.level || '?'} ${s.raceName || ''} ${s.className || p.classId || ''}</h3>
      <p class="modal-sub">Floor ${s.floor ?? '?'} · latest shared sheet (updates as they travel)</p>
      <div class="sheet-grid">
        <div class="sheet-section">
          <h4>Vitals</h4>
          <div class="tm-st-bars" style="margin:8px 0">
            <div class="tm-st-bar hp"><i style="width:${s.maxHp ? Math.max(0, Math.min(100, s.hp / s.maxHp * 100)) : 0}%"></i><span>HP ${Math.round(s.hp || 0)}/${Math.round(s.maxHp || 0)}</span></div>
            <div class="tm-st-bar mp"><i style="width:${s.maxMp ? Math.max(0, Math.min(100, (s.mp || 0) / s.maxMp * 100)) : 0}%"></i><span>${resLabel} ${Math.round(s.mp || 0)}/${Math.round(s.maxMp || 0)}</span></div>
          </div>
          <h4 style="margin-top:12px">Appraisal ${appr ? `<span class="tag">Floor ${appr.floor}</span>` : '<span class="tag">unappraised</span>'}</h4>
          <table class="stat-table">${statRows}
            ${appr?.overall ? `<tr><td>Overall</td><td><b>${appr.overall}</b></td></tr>` : ''}
          </table>
        </div>
        <div class="sheet-section">
          <h4>Equipped</h4>
          ${gear.length ? gear.map(g => `
            <div class="inv-item"><div><div class="item-name ${rarityClass(g.rarity)}">${g.name}</div>
            <div class="item-desc">${g.desc || ''}</div></div>
            <span class="tag slot-tag">${g.slot || ''}</span></div>`).join('') : '<div style="color:var(--ink-faint);font-size:14px">Nothing equipped.</div>'}
          <h4 style="margin-top:14px">Pack (preview)</h4>
          ${pack.length ? pack.map(g => `
            <div class="inv-item"><div><div class="item-name ${rarityClass(g.rarity)}">${g.name}</div>
            <div class="item-desc">${g.desc || ''}</div></div></div>`).join('') : '<div style="color:var(--ink-faint);font-size:14px">Empty pack.</div>'}
        </div>
      </div>
      <div class="divider"></div>
      <div style="text-align:right"><button class="btn small" id="sheet-close">Close</button></div>`;
    m.querySelector('#sheet-close').onclick = () => close();
  });
}

/* ---------- path-card generation ---------- */
function rollCardsPerDraw(rng) {
  const two = CONFIG.events.cardsPerDrawTwoChance ?? 0.1;
  const four = CONFIG.events.cardsPerDrawFourChance ?? 0.1;
  const r = rng.next();
  if (r < two) return 2;
  if (r < two + four) return 4;
  return CONFIG.events.cardsPerDraw || 3;
}

function generateCards(rng, forParty = null) {
  const biome = biomeForFloor(run.floor);
  const cards = [];
  const usedEvents = [];
  const n = rollCardsPerDraw(rng);
  // one slot is combat-weighted; others draw distinct events.
  // early floors lean toward events so a fresh climber can build tools before
  // the tower gets serious (combat stays deadly — you're meant to prepare for it)
  const combatChance = run.floor <= 3 ? 0.35 : run.floor <= 6 ? 0.6 : 0.75;
  const combatSlot = rng.chance(combatChance) ? rng.int(0, n - 1) : -1;
  for (let i = 0; i < n; i++) {
    if (i === combatSlot) {
      const plan = pickEnemyPlan(rng, biome, forParty?.partySize || 1);
      cards.push({
        kind: 'encounter', category: 'combat',
        enemies: forParty
          ? buildPartyEnemies(plan.specs, plan.hpMult)
          : plan.specs.map(g => ({ ...g })),
        hpMult: plan.hpMult,
        sparkle: false,
      });
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
  // §2: honor a waypoint (cartographer) or a map-path hint — force one choice
  // to that category. Cartographer waypoints win if both are set.
  const forceCat = run.forcedNextCategory || run.mapHintCategory || null;
  delete run.forcedNextCategory;
  delete run.mapHintCategory;
  if (forceCat) {
    if (forceCat === 'combat') {
      const plan = pickEnemyPlan(rng, biome, forParty?.partySize || 1);
      const enc = {
        kind: 'encounter', category: 'combat',
        enemies: forParty
          ? buildPartyEnemies(plan.specs, plan.hpMult)
          : plan.specs.map(g => ({ ...g })),
        hpMult: plan.hpMult,
        sparkle: true,
      };
      let slot = cards.findIndex(c => c.kind !== 'encounter');
      if (slot < 0) slot = 0;
      cards[slot] = enc;
    } else {
      const pool = EVENTS.filter(e => (e.biome === 'any' || e.biome === run.biomeId)
        && e.category === forceCat && !(e.once && run.seenEvents.includes(e.id))
        && (!e.cond || e.cond(run)) && !usedEvents.includes(e.id));
      if (pool.length) {
        const ev = rng.pick(pool);
        usedEvents.push(ev.id);
        let slot = cards.findIndex(c => c.kind === 'event' && c.category !== forceCat);
        if (slot < 0) slot = cards.findIndex(c => c.kind === 'event');
        if (slot < 0) slot = 0;
        cards[slot] = { kind: 'event', category: ev.category || forceCat, eventId: ev.id, sparkle: true };
      }
    }
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
    pushEventHistory(run, 'combat');
    if (coopS) {
      const enemies = rehydrateEnemies(card.enemies);
      return sharedFightCard(stage, { type: 'encounter', enemies });
    }
    return encounterFloor(stage, card.enemies, card.hpMult || 1);
  }
  const ev = EVENTS.find(e => e.id === card.eventId);
  run.seenEvents.push(ev.id);
  noteEventTags(ev);
  pushEventHistory(run, ev.category || 'unknown');
  saveRun(run);
  renderEventCard(stage, ev);
}

/* ---------- combat encounter card (Fight / Sneak / Bribe) ---------- */
/** Budget-aware encounter plan (bodies first; leftover → mild HP pad). */
function pickEnemyPlan(rng, biome, partySize = 1) {
  const depth = run.floor - biome.floors[0];
  let pool = ENEMIES[biome.id] || ENEMIES.hell;
  if (depth < 4) pool = pool.filter(e => !e.elite);
  return planEncounter(rng, {
    floor: run.floor,
    biomeStart: biome.floors[0],
    pool,
    partySize,
    allowElite: depth >= 4,
  });
}

/** Specs only — for call sites that still expect a plain group array. */
function pickEnemyGroup(rng, biome, partySize = 1) {
  return pickEnemyPlan(rng, biome, partySize).specs;
}

async function encounterFloor(stage, prebuiltGroup = null, hpMult = 1) {
  const rng = runRng(run);
  const biome = biomeForFloor(run.floor);
  let group, planHp = hpMult;
  if (prebuiltGroup) {
    group = prebuiltGroup;
  } else {
    const plan = pickEnemyPlan(rng, biome, 1);
    group = plan.specs;
    planHp = plan.hpMult;
  }
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
      return fightGroup(stage, group, { text: 'Steel answers steel.', hpMult: planHp });
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
      return fightGroup(stage, group, {
        text: 'They were waiting for the twig.',
        modifier: { name: 'Ambushed', desc: 'Enemies strike first.', enemyFirst: true },
        hpMult: planHp,
      });
    }
  });
}

async function fightGroup(stage, specs, { text = null, modifier = null, prebuilt = null, reward = null, hpMult = 1 } = {}) {
  Music.play('battle');
  const biome = biomeForFloor(run.floor);
  const rng = runRng(run);
  const mult = (modifier?.hpMult || 1) * (hpMult || 1);
  const enemies = prebuilt || specs.map(s => buildEnemy(s, run.floor, biome.floors[0], { hpMult: mult }));
  if (modifier?.extraEnemy) {
    enemies.push(buildEnemy(runRng(run).pick(ENEMIES[biome.id].filter(e => !e.elite)), run.floor, biome.floors[0], { hpMult: mult }));
  }
  sheetCombatLock = true; renderHud();
  const { result, gold = 0, xp = 0, noDamage, usedUltimate } = await startCombat({
    container: stage, run, rng, enemies, modifier,
    onHud: renderHud,
    onCharacter: () => characterSheet({ locked: true }),
  });
  sheetCombatLock = false; renderHud();
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

  await afterVictory(stage, enemies, gold, xp, { reward });
}

async function afterVictory(stage, enemies, gold, xp, { boss = null, reward = null } = {}) {
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
    for (const msg of applySkillBreakpoints(run)) lines.push({ text: msg.text, cls: msg.cls || 'good' });
  } else if (enemies.some(e => e.elite)) {
    // Tiny UNIQUE chance from elite packs on deep floors
    const rngE = runRng(run);
    const eliteChance = Math.min(0.06, 0.01 + Math.max(0, run.floor - 15) * 0.0015);
    if (rngE.chance(eliteChance)) {
      const u = rollUnique(rngE, run, { preferUseful: true });
      if (u) {
        lines.push({ text: 'Among the elite\'s effects, something older than the tower gleams.', cls: 'item' });
        await offerEquipment(u, lines);
      }
    }
    rngE.advance();
  }
  SFX.victory();
  const ups = gainXp(run, xp, runRng(run));
  // §16: exclusive spoils from an optional NPC duel
  if (reward) await grantReward(reward, lines);
  saveRun(run);
  await showOutcomePanel(stage, lines, ups, boss ? { continueLabel: 'Claim your prize', advance: false } : {});
  if (boss) await bossRelicPick(stage);
}

/* ---------- §16: exclusive rewards from optional encounters ---------- */
async function grantWrldFind(lines, { kind = 'any', preferUseful = true } = {}) {
  const w = rollWrld(runRng(run), run, { preferUseful, kind, coop: coopS });
  if (!w) {
    lines.push({ text: 'The WRLD you sought has already been claimed — one of each exists in this climb.', cls: 'bad' });
    return null;
  }
  unlock('wrld_gear');
  unlock('legendary');
  if (!w.slot) {
    if (!run.relics.includes(w.id)) run.relics.push(w.id);
    lines.push({ text: `WRLD Relic: ${w.name} — ${w.desc}`, cls: 'item' });
    SFX.unlock();
    return w;
  }
  await offerEquipment(w, lines);
  return w;
}

async function applyRewardOption(opt, lines) {
  if (!opt) return;
  const itemId = opt.kind === 'item' ? opt.id : opt.item;
  const skillId = opt.kind === 'skill' ? opt.id : opt.skill;
  const relicId = opt.kind === 'relic' ? opt.id : opt.relic;
  if (itemId) {
    const it = itemById(itemId);
    if (it && it.slot) await offerEquipment(it, lines);
    else if (it) { run.consumables.push(it.id); lines.push({ text: `Received: ${it.name}`, cls: 'item' }); }
  }
  if (skillId && SKILLS[skillId]) {
    if (!run.knownSkills.includes(skillId)) run.knownSkills.push(skillId);
    lines.push({ text: `Technique learned: ${SKILLS[skillId].name} — ${SKILLS[skillId].desc}`, cls: 'item' });
    await maybeEquipSkill(SKILLS[skillId]);
    SFX.evolve();
  }
  if (relicId) {
    const r = itemById(relicId) || rollRelic(runRng(run), run.relics);
    if (r && !run.relics.includes(r.id)) { run.relics.push(r.id); lines.push({ text: `Relic: ${r.name}`, cls: 'item' }); SFX.unlock(); }
  }
}

async function grantReward(reward, lines) {
  if (!reward) return;
  if (reward.gold) { run.gold += reward.gold; run.goldEarned += reward.gold; lines.push({ text: `+${reward.gold} gold`, cls: 'gold' }); }
  if (reward.fame) { const a = changeFame(run, reward.fame); lines.push({ text: `+${a} Fame`, cls: 'good' }); }
  if (reward.uniqueItem) {
    const u = rollUnique(runRng(run), run, { preferUseful: true });
    if (u) await offerEquipment(u, lines);
    else lines.push({ text: 'The UNIQUE prize has already been claimed by another climber.', cls: 'bad' });
  }
  if (reward.wrldItem) await grantWrldFind(lines, typeof reward.wrldItem === 'object' ? reward.wrldItem : {});
  if (reward.options?.length) {
    let chosen = reward.options[0];
    await modalCustom((m, close) => {
      m.innerHTML = `<h3>Spoils of the Duel</h3><p class="modal-sub">${reward.chooseLabel || 'Take one:'}</p>
        <div class="pick-grid">${reward.options.map((op, i) => {
          const nm = op.kind === 'skill' ? SKILLS[op.id]?.name : itemById(op.id)?.name;
          const desc = op.kind === 'skill' ? SKILLS[op.id]?.desc : itemById(op.id)?.desc;
          return `<button class="pick-option" data-i="${i}"><span class="po-tag tag">${op.kind}</span><div class="po-name">${nm || op.id}</div><div class="po-desc">${desc || ''}</div></button>`;
        }).join('')}</div>`;
      m.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { chosen = reward.options[+b.dataset.i]; close(); });
    });
    await applyRewardOption(chosen, lines);
  } else {
    await applyRewardOption(reward, lines);
  }
  renderHud();
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
  // §1: the hoard yields gear too — rolled a tier high, luck-weighted toward rarity
  {
    const rng3 = runRng(run);
    // Vanishingly rare WRLD from deep boss hoards (floor 40+)
    const wrldChance = run.floor >= 40
      ? Math.min(0.06, 0.015 + (run.floor - 40) * 0.002 + derived(run).lk * 0.0005)
      : 0;
    const uniqueChance = Math.min(0.14, 0.04 + run.floor * 0.0015 + derived(run).lk * 0.001);
    if (wrldChance && rng3.chance(wrldChance)) {
      const lines = [];
      await grantWrldFind(lines, { preferUseful: true });
      if (lines.length) toast(lines[0].text, 'info');
      rng3.advance(); saveRun(run);
    } else if (rng3.chance(uniqueChance)) {
      const u = rollUnique(rng3, run, { preferUseful: true });
      if (u) {
        const lines = [];
        await offerEquipment(u, lines);
        if (lines.length) toast(lines[0].text, 'info');
        rng3.advance(); saveRun(run);
      }
    } else {
      const item = rollEquipment(rng3, biomeTier() + 1, 4 + Math.floor(derived(run).lk / 2), { floor: run.floor, run });
      rng3.advance(); saveRun(run);
      if (item) {
        const lines = [];
        await offerEquipment(item, lines);
        if (lines.length) toast(lines[0].text, 'info');
      }
    }
  }
  // Relic + gear is the boss reward; techniques unlock on sparse level milestones.
  renderHud();
  nextFloorButton(document.getElementById('stage'));
}

/* ---------- trial + boss floors (fixed single cards) ---------- */
async function modifierFloor(stage) {
  const rng = runRng(run);
  const mod = rng.pick(MODIFIERS);
  const biome = biomeForFloor(run.floor);
  const plan = pickEnemyPlan(rng, biome, 1);
  rng.advance(); saveRun(run);
  pushEventHistory(run, 'combat');

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
    fightGroup(stage, plan.specs, {
      text: `Trial: ${mod.name}.`,
      modifier: { ...mod, goldMult: (mod.goldMult || 1) * 1.5 },
      hpMult: plan.hpMult,
    });
  };
}

async function bossFloor(stage) {
  const rngPick = runRng(run);
  const boss = pickBossForFloor(run.floor, rngPick, run);
  rngPick.advance(); saveRun(run);
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
    const rng = runRng(run);
    const biome = biomeForFloor(run.floor);
    const plan = planBossEncounter(rng, {
      floor: run.floor,
      boss,
      pool: ENEMIES[biome.id] || ENEMIES.hell,
      partySize: 1,
    });
    rng.advance(); saveRun(run);
    const enemies = plan.specs.map((s, i) => buildEnemy(
      s, run.floor, i === 0 ? run.floor : biome.floors[0],
      { boss: i === 0 || !!s.boss, hpMult: plan.hpMult },
    ));
    await fightGroupBoss(stage, enemies, boss);
  };
}

async function fightGroupBoss(stage, enemies, boss) {
  Music.play('boss');
  const rng = runRng(run);
  sheetCombatLock = true; renderHud();
  const { result, gold = 0, xp = 0, noDamage, usedUltimate } = await startCombat({
    container: stage, run, rng, enemies, introText: `${boss.name}: "${boss.taunt}"`, onHud: renderHud, onCharacter: () => characterSheet({ locked: true }),
  });
  sheetCombatLock = false; renderHud();
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
/** Build live enemies from specs + residual budget HP mult (not party-size HP). */
function buildPartyEnemies(specs, hpMult = 1) {
  const biome = biomeForFloor(run.floor);
  return specs.map(s => buildEnemy(s, run.floor, biome.floors[0], { hpMult }));
}

function buildSharedEnemies(specs, { boss = false, hpMult = 1 } = {}) {
  const biome = biomeForFloor(run.floor);
  return specs.map((s, i) => buildEnemy(
    s, run.floor,
    boss && i === 0 ? run.floor : biome.floors[0],
    { boss: boss && (i === 0 || !!s.boss), hpMult },
  ));
}

function hostPublishFloorContent() {
  const rng = runRng(run);
  const biome = biomeForFloor(run.floor);
  let content;
  if (run.floor === LAST_FLOOR) {
    const boss = pickBossForFloor(51, rng, run);
    content = { floor: run.floor, type: 'throne', bossId: boss.id };
  } else if (BOSS_FLOORS.includes(run.floor)) {
    const boss = pickBossForFloor(run.floor, rng, run);
    const plan = planBossEncounter(rng, {
      floor: run.floor,
      boss,
      pool: ENEMIES[biome.id] || ENEMIES.hell,
      partySize: coopS.partySize,
    });
    content = {
      floor: run.floor, type: 'boss', bossId: boss.id,
      enemies: buildSharedEnemies(plan.specs, { boss: true, hpMult: plan.hpMult }),
    };
  } else if (run.floor % 5 === 0) {
    const mod = rng.pick(MODIFIERS);
    const plan = pickEnemyPlan(rng, biome, coopS.partySize);
    content = { floor: run.floor, type: 'trial', modId: mod.id, enemies: buildSharedEnemies(plan.specs, { hpMult: plan.hpMult }) };
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

  if (content.type === 'throne') {
    if (content.bossId) {
      run.bossPicks = run.bossPicks || {};
      run.bossPicks[51] = content.bossId;
    }
    return throneRoomCoop(stage);
  }
  if (content.type === 'boss' || content.type === 'trial') {
    return sharedFightCard(stage, content);
  }
  if (content.type === 'cards') {
    return coopCardChoice(stage, content.cards);
  }
  const ev = EVENTS.find(e => e.id === content.eventId) || EVENTS.find(e => e.id === 'campfire');
  run.seenEvents.push(ev.id);
  noteEventTags(ev);
  pushEventHistory(run, ev.category || 'recovery');
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
  const boss = content.type === 'boss'
    ? (bossById(content.bossId) || bossById(enemies[0]?.id) || BOSSES[run.floor])
    : null;
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
  sheetCombatLock = true; renderHud();
  const { result, gold = 0, xp = 0, noDamage, usedUltimate } = await startCombat({
    container: stage, run, rng, enemies,
    modifier: mod ? { ...mod, goldMult: (mod.goldMult || 1) * 1.5 } : null,
    introText: boss ? `${boss.name}: "${boss.taunt}"` : 'Side by side, blades out.',
    onHud: renderHud, onCharacter: () => characterSheet({ locked: true }),
    coop: coopS,
  });
  sheetCombatLock = false; renderHud();

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
  const boss = bossById(run.bossPicks?.[51]) || BOSSES[51];
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

  const evArt = eventCatUrl(ev.category);
  stage.innerHTML = `
    <div class="card-stage"><div class="panel event-card">
      <div class="card-art">
        <div class="ev-center">${evArt
          ? `<img class="ev-emblem" src="${evArt}" alt=""><span class="ev-glyph-mini">${ev.glyph}</span>`
          : `<div class="card-glyph">${ev.glyph}</div>`}</div>
        <span class="tag card-type-tag">${originIntro ? 'ORIGIN' : TYPE_LABEL[ev.type] || 'EVENT'}</span>
        <span class="tag card-floor-tag">${originIntro ? 'THE DAY BEFORE' : `FLOOR ${run.floor}`}</span>
      </div>
      <div class="card-body">
        <h3>${ev.title}</h3>
        <div class="card-text">${ev.text}</div>
        <div class="card-choices" id="choices"></div>
      </div>
    </div></div>`;
  applyCardBg(stage);
  SFX.cardDeal();

  const box = document.getElementById('choices');
  const choices = [...ev.choices];
  // Safety net: never soft-lock a run behind gold/stat/item gates.
  if (choices.length && choices.every(c => !reqMet(c.req).ok)) {
    choices.push({
      label: 'Move on',
      hint: 'leave empty-handed',
      outcome: { text: 'Nothing here is for you today. The path continues whether the tower likes it or not.' },
    });
  }
  choices.forEach(choice => {
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
  let outcome = applyTagOutcomeMods(choice.outcome, ev, run);

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
    outcome = applyTagOutcomeMods(ok ? outcome.success : outcome.fail, ev, run);
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
      const item = rollEquipment(rng, biomeTier(), Math.floor(d.lk / 3), { floor: run.floor, run });
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
    // §15: a deep reading can shake a relic loose — better odds for a full workup
    const relicChance = (o.appraisal === 'full' ? 0.22 : 0.1) + Math.floor(run.floor / 15) * 0.05;
    if (rng.chance(relicChance)) {
      const r = rollRelic(rng, run.relics, Math.floor(d.lk / 3));
      if (r) { run.relics.push(r.id); lines.push({ text: `The reading stirs something loose in the tower — Relic: ${r.name} (${r.desc})`, cls: 'item' }); SFX.evolve(); }
    }
  }
  // §14: a reward scaled to how famous you are
  if (o.fameReward) {
    const goldR = Math.round((30 + Math.floor(run.fame / 10) * 22) * d.goldMult);
    run.gold += goldR; run.goldEarned += goldR;
    const statR = 1 + Math.floor(run.fame / 40);
    for (let i = 0; i < statR; i++) run.stats[rng.pick(APPRAISABLE)]++;
    heal(run, run.maxHp * 0.2);
    lines.push({ text: `Your renown pays out — +${goldR} gold, real growth, and a patron's care. The tower rewards a known name.`, cls: 'gold' });
    SFX.gold();
  }
  if (o.promoteRace) {
    const p = applyRacePromotion(run);
    if (p) {
      lines.push({ text: `🧬 ${p.blurb}\n\nYou are ${/^[aeiou]/i.test(run.raceName) ? 'an' : 'a'} ${run.raceName} now.`, cls: 'item' });
      unlock('promoted');
      SFX.evolve();
    }
  }

  if (o.itemRoll) {
    const spec = (o.itemRoll && typeof o.itemRoll === 'object') ? o.itemRoll : {};
    const preferUseful = !!(spec.requireUseful || spec.classGear);
    const item = rollEquipment(rng, Math.max(biomeTier(), spec.minTier || 1), Math.floor(d.lk / 3) + (spec.luck || 0), {
      floor: run.floor,
      run,
      classId: run.classId,
      usefulBias: preferUseful ? 8 : (spec.usefulBias ?? 4),
      requireUseful: preferUseful,
      slot: spec.slot || null,
      wtype: spec.wtype || null,
    });
    if (item) await offerEquipment(item, lines);
    else lines.push({ text: 'You rummage — and find only dust and almosts.', cls: 'bad' });
  }
  if (o.uniqueItem) {
    const u = rollUnique(rng, run, { preferUseful: true });
    if (u) await offerEquipment(u, lines);
    else lines.push({ text: 'The UNIQUE you were promised has already chosen another climber.', cls: 'bad' });
  }
  if (o.wrldItem) {
    await grantWrldFind(lines, typeof o.wrldItem === 'object' ? o.wrldItem : {});
  }
  if (o.classGear) {
    // Class-flavored find: usually a usable weapon, else any useful piece
    const wantWeapon = rng.chance(0.6);
    const item = rollEquipment(rng, Math.max(biomeTier(), 2), Math.floor(d.lk / 3) + 1, {
      floor: run.floor, run, classId: run.classId,
      requireUseful: true, usefulBias: 10,
      slot: wantWeapon ? 'weapon' : (rng.chance(0.5) ? 'accessory' : null),
    });
    if (item) await offerEquipment(item, lines);
  }
  if (o.item) {
    const item = resolveItem(run, o.item) || itemById(o.item);
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
  // §2: SET a future path instead of previewing it
  if (o.setFuture) {
    const chosen = await pickFutureCategory();
    if (chosen) {
      run.forcedNextCategory = chosen;
      lines.push({ text: `Waypoint marked — the next branching floor will offer a ${CATEGORY_META[chosen].label} path.`, cls: 'item' });
      SFX.unlock();
    }
  }

  let ups = [];
  if (o.xp) {
    const amt = Math.round(o.xp * d.xpMult);
    ups = gainXp(run, amt, rng);
    lines.push({ text: `+${amt} XP`, cls: 'good' });
  }
  // §5: scaling XP — the reward grows with how far you've climbed
  if (o.xpScaled) {
    const amt = Math.round((o.xpScaled + run.floor) * d.xpMult);
    ups.push(...gainXp(run, amt, rng));
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
      const boss = Object.values(BOSSES).find(e => e.id === id) || Object.values(ALT_BOSSES).find(e => e.id === id);
      if (boss) return boss;
      return ENEMIES[biome.id][0];
    });
    if (lines.length) await showOutcomePanel(stage, lines, ups, { continueLabel: 'Steel yourself', advance: false });
    return fightGroup(stage, specs, { text: o.combat.text, reward: o.combat.reward });
  }

  if (o.coopTrade) {
    if (lines.length) await showOutcomePanel(stage, lines, ups, { continueLabel: 'Open the exchange', advance: false });
    const tradeLines = await runCoopTrade();
    lines.push(...tradeLines);
    saveRun(run);
    renderHud();
    if (coopS) coopS.broadcastStatus(statusOf(run, 'choosing'), 'choosing');
    return showOutcomePanel(stage, lines, ups);
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

function noteEventTags(ev) {
  if (!ev?.tags?.length) return;
  run.seenEventTags = run.seenEventTags || [];
  for (const tag of ev.tags) {
    if (!run.seenEventTags.includes(tag)) run.seenEventTags.push(tag);
  }
}

/** List tradeable gear (equipped + pack) with rarity for equal-rarity swaps. */
function tradeableEntries() {
  const out = [];
  for (const slot of EQUIP_SLOTS) {
    const id = run.equipment[slot];
    if (!id) continue;
    const it = resolveItem(run, id);
    if (it) out.push({ where: 'equip', slot, id, item: it });
  }
  run.inventory.forEach((id, idx) => {
    const it = resolveItem(run, id);
    if (it) out.push({ where: 'pack', idx, id, item: it });
  });
  return out;
}

function detachTradeItem(entry) {
  const it = resolveItem(run, entry.id);
  if (!it) return null;
  const blob = {
    id: it.id,
    item: { ...it },
    gearBag: run.gearBag?.[it.id] ? { ...run.gearBag[it.id] } : null,
  };
  if (entry.where === 'equip') {
    run.equipment[entry.slot] = null;
  } else {
    const i = run.inventory.indexOf(entry.id);
    if (i > -1) run.inventory.splice(i, 1);
  }
  if (run.gearBag?.[entry.id]) delete run.gearBag[entry.id];
  return blob;
}

function receiveTradeBlob(blob) {
  if (!blob?.item) return;
  run.gearBag = run.gearBag || {};
  if (blob.gearBag) run.gearBag[blob.id] = blob.gearBag;
  else if (blob.item.instanceId) run.gearBag[blob.id] = blob.item;
  run.inventory.push(blob.id);
}

/**
 * Co-op equal-rarity barter. Both players must confirm matching rarities, or either may skip.
 * Returns outcome lines for the panel.
 */
async function runCoopTrade() {
  if (!coopS || coopS.alone) {
    return [{ text: 'The other stool stays empty. Trading alone is just rearranging pockets.', cls: 'bad' }];
  }

  const partners = [...coopS.partners.entries()];
  let partnerId = partners.length === 1 ? partners[0][0] : null;
  if (!partnerId) {
    partnerId = await new Promise(resolve => {
      modalCustom((m, close) => {
        m.innerHTML = `<h3>Who trades with you?</h3>
          <p class="modal-sub">Equal rarity. One item each. Both must agree — or skip.</p>
          <div class="pick-grid">${partners.map(([id, p]) => `
            <button class="pick-option" data-id="${id}"><div class="po-name">${p.name}</div>
            <div class="po-desc">${p.status?.className || p.classId || 'companion'}</div></button>`).join('')}
            <button class="pick-option" data-id=""><div class="po-name">Skip the exchange</div></button>
          </div>`;
        m.querySelectorAll('[data-id]').forEach(b => b.onclick = () => { close(); resolve(b.dataset.id || null); });
      });
    });
  }
  if (!partnerId) return [{ text: 'You leave the chalk circle untouched.', cls: '' }];

  const floor = run.floor;
  const tag = `trade-${floor}-${[coopS.you, partnerId].sort().join('-')}`;

  return await new Promise(resolve => {
    let myOffer = null; // { entry snapshot, rarity, name, id }
    let theirOffer = null;
    let myReady = false;
    let theirReady = false;
    let mySkip = false;
    let theirSkip = false;
    let done = false;
    let pendingTheirBlob = null;
    let awaitingSwap = false;
    let swapSent = false;
    const offs = [];

    const finish = (lines) => {
      if (done) return;
      done = true;
      for (const off of offs) off();
      resolve(lines);
    };

    const render = () => {
      const entries = tradeableEntries();
      const byRarity = theirOffer
        ? entries.filter(e => e.item.rarity === theirOffer.rarity)
        : entries;
      const list = (theirOffer ? byRarity : entries).map((e, i) => {
        const sel = myOffer?.id === e.id ? 'picked' : '';
        return `<button class="pick-option ${sel}" data-trade="${i}" ${myReady ? 'disabled' : ''}>
          <span class="po-tag tag ${rarityClass(e.item.rarity)}">${e.item.rarity}</span>
          <div class="po-name">${e.item.name}</div>
          <div class="po-desc">${e.where === 'equip' ? `equipped · ${e.slot}` : 'in pack'}</div>
        </button>`;
      }).join('');

      stage.innerHTML = `
        <div class="card-stage"><div class="panel event-card">
          <div class="card-art"><div class="card-glyph">🤝</div>
            <span class="tag card-type-tag">TRADE</span><span class="tag card-floor-tag">FLOOR ${floor}</span></div>
          <div class="card-body">
            <h3>Equal Exchange</h3>
            <div class="card-text">Trade <b>one</b> item of <b>equal rarity</b> with ${coopS.partners.get(partnerId)?.name || 'your companion'}. Both must confirm — or either may skip.</div>
            <div class="trade-status">
              <div>You: ${mySkip ? '⏭ skipped' : myOffer ? `${myOffer.name} (${myOffer.rarity})${myReady ? ' · locked in' : ''}` : '— choose an item —'}</div>
              <div>Them: ${theirSkip ? '⏭ skipped' : theirOffer ? `${theirOffer.name} (${theirOffer.rarity})${theirReady ? ' · locked in' : ''}` : '— waiting —'}</div>
            </div>
            <div class="pick-grid" style="max-height:220px;overflow:auto">${list || '<div style="color:var(--ink-faint);padding:12px">No matching-rarity gear to offer.</div>'}</div>
            <div class="card-choices" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
              <button class="choice-btn" id="trade-confirm" ${(!myOffer || myReady || mySkip) ? 'disabled' : ''}>
                <span class="choice-label">Confirm trade</span>
                <span class="choice-hint">${theirOffer && myOffer && theirOffer.rarity !== myOffer.rarity ? 'rarities must match' : 'both must agree'}</span>
              </button>
              <button class="choice-btn" id="trade-skip"><span class="choice-label">Skip</span><span class="choice-hint">walk away</span></button>
            </div>
          </div>
        </div></div>`;

      const pool = theirOffer ? byRarity : entries;
      stage.querySelectorAll('[data-trade]').forEach(b => {
        b.onclick = () => {
          if (myReady || mySkip) return;
          const e = pool[+b.dataset.trade];
          if (!e) return;
          myOffer = { id: e.id, name: e.item.name, rarity: e.item.rarity, where: e.where, slot: e.slot, idx: e.idx };
          coopS.net.send({
            k: 'trade', op: 'offer', floor, tag, to: partnerId,
            itemId: e.id, name: e.item.name, rarity: e.item.rarity,
          });
          SFX.click();
          render();
        };
      });
      stage.querySelector('#trade-skip').onclick = () => {
        mySkip = true;
        coopS.net.send({ k: 'trade', op: 'skip', floor, tag, to: partnerId });
        SFX.click();
        tryResolve();
        render();
      };
      const conf = stage.querySelector('#trade-confirm');
      if (conf) conf.onclick = () => {
        if (!myOffer || myReady) return;
        if (theirOffer && theirOffer.rarity !== myOffer.rarity) {
          toast('Rarities must match.', 'bad');
          return;
        }
        myReady = true;
        coopS.net.send({ k: 'trade', op: 'confirm', floor, tag, to: partnerId, rarity: myOffer.rarity, itemId: myOffer.id });
        SFX.click();
        tryResolve();
        render();
      };
    };

    const tryResolve = () => {
      if (mySkip || theirSkip) {
        finish([{ text: 'The exchange ends without a handshake. No hard feelings — the tower keeps the chalk.', cls: '' }]);
        return;
      }
      if (!(myReady && theirReady && myOffer && theirOffer)) return;
      if (myOffer.rarity !== theirOffer.rarity) {
        myReady = false;
        theirReady = false;
        toast('Rarities no longer match — reconfirm.', 'bad');
        render();
        return;
      }
      if (swapSent) {
        if (pendingTheirBlob) {
          receiveTradeBlob(pendingTheirBlob);
          pendingTheirBlob = null;
          saveRun(run);
          finish([
            { text: `Traded ${myOffer.name} for ${theirOffer.name}. Equal rarity. Fair is fair.`, cls: 'good' },
          ]);
        }
        return;
      }
      const entry = tradeableEntries().find(e => e.id === myOffer.id);
      if (!entry) {
        finish([{ text: 'Your offered item vanished before the trade closed.', cls: 'bad' }]);
        return;
      }
      swapSent = true;
      const blob = detachTradeItem(entry);
      coopS.net.send({
        k: 'trade', op: 'swap', floor, tag, to: partnerId,
        blob, rarity: myOffer.rarity,
      });
      if (pendingTheirBlob) {
        receiveTradeBlob(pendingTheirBlob);
        pendingTheirBlob = null;
        saveRun(run);
        finish([
          { text: `Traded ${myOffer.name} for ${theirOffer.name}. Equal rarity. Fair is fair.`, cls: 'good' },
        ]);
      } else {
        awaitingSwap = true;
        renderWaiting();
      }
    };

    const renderWaiting = () => {
      stage.innerHTML = `
        <div class="card-stage"><div class="panel event-card">
          <div class="card-body">
            <h3>Sealing the trade…</h3>
            <div class="card-text">Waiting for ${coopS.partners.get(partnerId)?.name || 'your companion'} to pass their item through.</div>
          </div>
        </div></div>`;
    };

    offs.push(coopS.net.on('trade', (d, from) => {
      if (d.floor !== floor || d.tag !== tag) return;
      if (d.to && d.to !== coopS.you && from !== partnerId) return;
      if (from !== partnerId && d.op !== 'swap') return;

      if (d.op === 'offer' && from === partnerId) {
        theirOffer = { id: d.itemId, name: d.name, rarity: d.rarity };
        theirReady = false;
        if (myOffer && myOffer.rarity !== theirOffer.rarity) myReady = false;
        render();
      } else if (d.op === 'confirm' && from === partnerId) {
        theirReady = true;
        if (d.rarity && theirOffer) theirOffer.rarity = d.rarity;
        tryResolve();
        render();
      } else if (d.op === 'skip' && from === partnerId) {
        theirSkip = true;
        tryResolve();
      } else if (d.op === 'swap' && from === partnerId) {
        if (awaitingSwap || swapSent) {
          receiveTradeBlob(d.blob);
          saveRun(run);
          finish([
            { text: `Traded ${myOffer?.name || 'your item'} for ${theirOffer?.name || d.blob?.item?.name || 'theirs'}. Equal rarity. Fair is fair.`, cls: 'good' },
          ]);
        } else {
          pendingTheirBlob = d.blob;
        }
      }
    }));

    // Announce presence so partner UI can pair
    coopS.net.send({ k: 'trade', op: 'hello', floor, tag, to: partnerId });
    render();
  });
}

function biomeTier() {
  return { forest: 1, ruins: 2, frost: 3, swamp: 4, hell: 5, throne: 5 }[run.biomeId] || 1;
}

// §2: let the player choose which kind of path to guarantee on the next floor.
function pickFutureCategory() {
  const cats = ['recovery', 'merchant', 'equipment', 'training', 'appraisal', 'mystery'];
  return new Promise(resolve => {
    modalCustom((m, close) => {
      m.innerHTML = `<h3>Write the Road Ahead</h3><p class="modal-sub">Choose the kind of path to bribe onto the next branching floor.</p>
        <div class="pick-grid">${cats.map(c => {
          const meta = CATEGORY_META[c];
          return `<button class="pick-option" data-c="${c}"><span class="po-tag tag">${meta.glyph}</span><div class="po-name">${meta.label}</div><div class="po-desc">${meta.blurb}</div></button>`;
        }).join('')}</div>`;
      m.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { const c = b.dataset.c; close(); resolve(c); });
    });
  });
}

/* ---------- co-op death penalty: lose a few lesser items (handoff §16) ---------- */
function deathItemLoss() {
  const lost = [];
  const rng = runRng(run);
  // eligible: consumables + low-rarity pack gear; protected: equipped, epic+
  const eligible = [];
  run.consumables.forEach((id, i) => eligible.push({ kind: 'consumable', i, id }));
  run.inventory.forEach((id, i) => {
    const it = resolveItem(run, id);
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
      if (idx > -1) {
        run.inventory.splice(idx, 1);
        lost.push(resolveItem(run, pick.id)?.name || pick.id);
        if (run.gearBag) delete run.gearBag[pick.id];
      }
    }
  }
  rng.advance();
  return lost;
}

/* ---------- equipment offer / compare ---------- */
function gearCard(item, label) {
  if (!item) return `<div class="gear-card empty"><div class="gc-label">${label}</div><div class="gc-name" style="color:var(--ink-faint)">— nothing —</div></div>`;
  const found = label === 'FOUND';
  return `<div class="gear-card ${found ? 'found' : ''}">
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
  for (const s of ['accessory1', 'accessory2', 'accessory3']) if (!run.equipment[s]) return s;
  return 'accessory1';
}

function slotLabel(slot) {
  if (!slot) return '';
  if (slot.startsWith('accessory')) return `RING ${slot.slice(-1)}`;
  return String(slot).toUpperCase();
}

function accessorySlots() {
  return ['accessory1', 'accessory2', 'accessory3'];
}

function equipItem(item, targetSlot = null) {
  const slot = targetSlot || slotFor(item);
  const oldId = run.equipment[slot];
  if (oldId) run.inventory.push(oldId);
  const bagIdx = run.inventory.indexOf(item.id);
  if (bagIdx > -1) run.inventory.splice(bagIdx, 1);
  run.equipment[slot] = item.id;
  if (item.rarity === 'legendary' || item.rarity === 'unique' || item.rarity === 'wrld') unlock('legendary');
  if (item.rarity === 'unique') unlock('unique_gear');
  if (item.rarity === 'wrld') unlock('wrld_gear');
}

function unequipSlot(slot) {
  const id = run.equipment[slot];
  if (!id) return;
  run.inventory.push(id);
  run.equipment[slot] = null;
}

/** Ask which slot to fill/replace. Returns slot id, or null if cancelled. */
async function chooseEquipSlot(item) {
  const isAcc = item.slot === 'accessory';
  const slots = isAcc ? accessorySlots() : [item.slot];
  // Empty non-accessory slot — no choice needed
  if (!isAcc && !run.equipment[item.slot]) return item.slot;

  return await new Promise(resolve => {
    modalCustom((m, close) => {
      const rows = slots.map(s => {
        const cur = run.equipment[s] ? resolveItem(run, run.equipment[s]) : null;
        return `<button class="pick-option" data-slot="${s}">
          <span class="po-name">${cur ? `Replace ${slotLabel(s)}` : `Equip to ${slotLabel(s)}`}</span>
          <span class="po-desc">${cur ? `${cur.name} → pack` : 'Empty slot'}</span>
        </button>`;
      }).join('');
      m.innerHTML = `<h3>Choose a slot</h3>
        <p class="modal-sub">${item.name}</p>
        <div class="pick-grid">
          ${rows}
          <button class="pick-option" data-cancel="1"><span class="po-name" style="color:var(--ink-dim)">Cancel</span></button>
        </div>`;
      m.querySelectorAll('[data-slot]').forEach(b => b.onclick = () => { close(); resolve(b.dataset.slot); });
      m.querySelector('[data-cancel]').onclick = () => { close(); resolve(null); };
    });
  });
}

async function offerEquipment(item, lines) {
  const sellPrice = Math.round(item.price * 0.6);
  const isAcc = item.slot === 'accessory';
  const slots = isAcc ? accessorySlots() : [item.slot];

  const v = await new Promise(resolve => {
    modalCustom((m, close) => {
      const finish = (act, slot = null) => { close(); resolve({ act, slot }); };
      let slotBtns = '';
      let compareRight = '';
      if (isAcc) {
        for (const s of slots) {
          const cur = run.equipment[s] ? resolveItem(run, run.equipment[s]) : null;
          slotBtns += `<button class="pick-option" data-act="equip" data-slot="${s}">
            <span class="po-name">${cur ? `Replace ${slotLabel(s)}` : `Equip to ${slotLabel(s)}`}</span>
            <span class="po-desc">${cur ? `${cur.name} → pack` : 'Empty slot'}</span>
          </button>`;
        }
        compareRight = `<div class="gear-card equipped"><div class="gc-label">RINGS</div>
          <div class="gc-desc" style="margin:0">Choose which ring slot to fill. Replaced gear goes into your pack.</div></div>`;
      } else {
        const s = item.slot;
        const cur = run.equipment[s] ? resolveItem(run, run.equipment[s]) : null;
        slotBtns = `<button class="pick-option" data-act="equip" data-slot="${s}">
          <span class="po-name">${cur ? 'Replace it' : 'Equip it'}</span>
          <span class="po-desc">${cur ? `${cur.name} → pack` : ''}</span>
        </button>`;
        compareRight = gearCard(cur, 'EQUIPPED');
      }
      m.innerHTML = `
        <h3>Loot!</h3>
        <div class="gear-compare">
          ${gearCard(item, 'FOUND')}
          <div class="gear-vs">vs</div>
          ${compareRight}
        </div>
        <div class="pick-grid">
          ${slotBtns}
          <button class="pick-option" data-act="stash"><span class="po-name">Stash it</span><span class="po-desc">Keep it in your pack — swap anytime from the Character screen.</span></button>
          <button class="pick-option" data-act="sell"><span class="po-name">Sell it — ${sellPrice}g</span></button>
        </div>`;
      m.querySelectorAll('[data-act]').forEach(b => b.onclick = () => finish(b.dataset.act, b.dataset.slot || null));
    });
  });

  if (v.act === 'equip' && v.slot) {
    equipItem(item, v.slot);
    lines.push({ text: `Equipped: ${item.name} (${slotLabel(v.slot)})`, cls: 'item' });
  } else if (v.act === 'stash') {
    run.inventory.push(item.id);
    lines.push({ text: `Stashed: ${item.name}`, cls: 'item' });
  } else if (v.act === 'sell') {
    run.gold += sellPrice;
    run.goldEarned += sellPrice;
    if (run.gearBag && item.instanceId) delete run.gearBag[item.id];
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

// Technique offers are sparse on purpose — bosses grant loot/relics, not a
// skill modal every gate. Levels below match early / mid / late climb beats.
const SKILL_OFFER_LEVELS = [5, 9, 13, 17, 21];

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
              ${subclassSkillGrantHtml(s)}
            </button>`).join('')}
        </div>`;
      m.querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
        const sub = up.evolutionChoice[+b.dataset.i];
        applySubclassFn(run, sub);
        if (sub.secret) { unlock('secret_class'); glitchScreen(1500); }
        SFX.evolve();
        close();
        modal(`
          <div class="levelup-burst">🌟</div>
          <h3 style="text-align:center">EVOLUTION — ${sub.name}!</h3>
          <p class="modal-sub" style="text-align:center">${sub.blurb}</p>
          ${sub.skill && SKILLS[sub.skill] ? `<div class="panel" style="padding:12px 14px;margin:12px 0;border:1px solid rgba(232,182,74,.35);text-align:left">${skillPickHtml(SKILLS[sub.skill])}</div>` : ''}
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
      ${up.deeper.skill && SKILLS[up.deeper.skill] ? `<div class="panel" style="padding:12px 14px;margin:12px 0;border:1px solid rgba(232,182,74,.35);text-align:left">${skillPickHtml(SKILLS[up.deeper.skill])}</div>` : ''}
      <div class="pick-grid"><button class="pick-option" data-close="x" style="text-align:center"><span class="po-name">Rise</span></button></div>`);
    if (up.deeper.skill) await maybeEquipSkill(SKILLS[up.deeper.skill]);
    saveRun(run);
    renderHud();
  }

  if (SKILL_OFFER_LEVELS.includes(up.level)) {
    await offerSkillChoice();
  }
}

function skillCostTip(s) {
  const res = resourceName(run);
  const bits = [];
  if (s.cost) bits.push(`${s.cost} ${res}`);
  if (s.charge) bits.push(`${s.charge}⚡`);
  return bits.length ? bits.join(' + ') : 'FREE';
}

function skillEffectTip(s) {
  if (s.power) {
    const stat = s.stat === 'best' ? 'best' : (s.stat || 'str').toUpperCase();
    const tgt = s.target === 'all' ? ' all' : '';
    let tip = `≈${s.power}% ${stat}${tgt} dmg`;
    if (s.lifesteal) tip += ` · ${Math.round(s.lifesteal * 100)}% lifesteal`;
    if (s.stun) tip += ` · ${Math.round(s.stun * 100)}% stun`;
    if (s.ignoreDef) tip += ' · ignores def';
    return tip;
  }
  if (s.guard) return 'block 30% until next turn · +1⚡';
  const bits = [];
  if (s.shield) bits.push(`block ${Math.round(s.shield * 100)}%`);
  if (s.healPct) bits.push(`heal ${Math.round(s.healPct * 100)}% HP`);
  if (s.heal) bits.push(`heal ${s.heal}`);
  if (s.buff) bits.push('self buff');
  if (bits.length) return bits.join(' · ');
  return 'utility';
}

function skillPickHtml(s) {
  return `<span class="po-tag tag">${skillCostTip(s)}</span>
    <div class="po-name">${s.name}</div>
    <div class="po-cost">${skillEffectTip(s)}</div>
    <div class="po-desc">${s.desc}</div>`;
}

function subclassSkillGrantHtml(sub) {
  const sk = sub.skill ? SKILLS[sub.skill] : null;
  if (!sk) return '';
  return `<div class="po-skill-grant">
    <div class="po-skill-label">Learns · ${sk.name}</div>
    <div class="po-cost">${skillCostTip(sk)} · ${skillEffectTip(sk)}</div>
    <div class="po-desc">${sk.desc}</div>
  </div>`;
}

// Sparse technique offers on milestone levels only (bosses grant relic/loot instead).
async function offerSkillChoice() {
  {
    const rng = runRng(run);
    const pool = rng.shuffle(learnableSkills(run)).slice(0, 3);
    rng.advance();
    if (!pool.length) return;
    await modalCustom((m, close) => {
      m.innerHTML = `<h3>New Technique</h3><p class="modal-sub">The climb teaches. Choose one skill to learn.</p>
        <div class="pick-grid">
          ${pool.map((s, i) => `<button class="pick-option" data-i="${i}">${skillPickHtml(s)}</button>`).join('')}
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

async function maybeEquipSkill(sk) {
  if (!sk) return;
  if (!run.knownSkills.includes(sk.id)) run.knownSkills.push(sk.id);
  if (run.skills.includes(sk.id)) return; // never carry duplicates (§10)
  if (run.skills.length < skillCapacity(run)) {
    run.skills.push(sk.id);
    toast(`Learned ${sk.name}`, 'info');
  } else {
    await swapSkillModal(sk);
  }
}

async function swapSkillModal(newSkill) {
  await modalCustom((m, close) => {
    m.innerHTML = `<h3>Equip ${newSkill.name}?</h3>
      <p class="modal-sub">You can carry ${skillCapacity(run)} techniques into battle (plus Strike and Guard, always). Replace one, or keep it in reserve.</p>
      <div class="panel" style="padding:12px 14px;margin-bottom:12px;border:1px solid rgba(232,182,74,.35)">
        <div style="font-family:var(--font-display);font-size:12px;color:var(--gold-bright);margin-bottom:4px">NEW</div>
        ${skillPickHtml(newSkill)}
      </div>
      <div class="pick-grid">
        ${run.skills.map((id, i) => {
          const s = SKILLS[id];
          return `<button class="pick-option" data-i="${i}">
            <div class="po-name">Replace ${s.name}</div>
            <div class="po-cost">${skillCostTip(s)} · ${skillEffectTip(s)}</div>
            <div class="po-desc">${s.desc}</div>
          </button>`;
        }).join('')}
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
  // Bias toward class-useful gear (~78%). Early/mid climb always keeps ≥1 useful equip.
  const earlyOrMid = run.floor < 35;
  for (let i = 0; i < 2; i++) {
    const item = rollEquipment(rng, tier, 2, {
      floor: run.floor, run, classId: run.classId, usefulBias: 4,
      requireUseful: earlyOrMid && i === 0,
    });
    if (item) stock.push({ kind: 'equip', item, price: item.price });
  }
  if (earlyOrMid) {
    const hasUseful = stock.some(s => s.kind === 'equip' && itemUsefulForClass(s.item, run.classId));
    if (!hasUseful) {
      const forced = rollEquipment(rng, Math.max(tier, 2), 3, {
        floor: run.floor, run, classId: run.classId, requireUseful: true, usefulBias: 8,
      });
      if (forced) {
        const idx = stock.findIndex(s => s.kind === 'equip');
        if (idx >= 0) stock[idx] = { kind: 'equip', item: forced, price: forced.price };
        else stock.push({ kind: 'equip', item: forced, price: forced.price });
      }
    }
  }
  // Vanishingly rare UNIQUE listing on deep floors
  if (run.floor >= 18 && rng.chance(0.035 + Math.min(0.04, run.floor * 0.0008))) {
    const u = rollUnique(rng, run, { preferUseful: true });
    if (u) stock.push({ kind: 'equip', item: u, price: Math.round(u.price * 1.15) });
  }
  // Near-mythic WRLD listing — floor 35+, ~1%
  if (run.floor >= 35 && rng.chance(0.01 + Math.min(0.015, (run.floor - 35) * 0.0005))) {
    const w = rollWrld(rng, run, { preferUseful: true, kind: 'equip', coop: coopS, claim: false });
    if (w) stock.push({ kind: 'equip', item: w, price: Math.round(w.price * 1.25) });
  }
  if (rng.chance(0.5)) {
    const r = rollRelic(rng, run.relics);
    if (r) stock.push({ kind: 'relic', item: r, price: 120 + tier * 40 });
  }
  rng.advance(); saveRun(run);

  // fame opens wallets and lowers prices (handoff §18)
  const discount = run.fame >= CONFIG.fame.shopDiscountAt ? CONFIG.fame.shopDiscountPct : 0;

  function price(p) {
    return Math.round(p * (CONFIG.economy.merchantPriceMult || 1) * (1 - discount));
  }

  function shopTags(s) {
    if (s.kind !== 'equip') return '';
    if (!itemIncompatibleForClass(s.item, run.classId)) return '';
    return `<div class="si-tags"><span class="si-tag incompatible">⚠ incompatible</span></div>`;
  }

  function render() {
    const healCost = Math.max(10, Math.round((run.maxHp - run.hp) * 0.8 * (CONFIG.economy.merchantPriceMult || 1) * (1 - discount)));
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
                <div class="si-info"><div class="si-name ${rarityClass(s.item.rarity)}">${s.item.name}</div><div class="si-desc">${s.item.desc}</div>${shopTags(s)}</div>
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
      if (s.kind === 'equip') {
        if (s.item.rarity === 'wrld' || s.item.wrld) {
          markWrldClaimed(run, s.item.baseId || s.item.id, coopS);
          unlock('wrld_gear');
        }
        const lines = [];
        await offerEquipment(s.item, lines);
      }
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

function characterSheet({ locked = false } = {}) {
  modalCustom((m, close) => {
    m.classList.add('sheet-modal');
    function render() {
      const eq = run.equipment;
      const compatible = weaponCompatible(run);
      const appr = run.appraisal;
      const lockNote = locked
        ? `<p class="modal-sub" style="color:var(--crit)">In combat — gear, pack swaps, and consumables are locked. Use ITEMS on your turn to drink potions.</p>`
        : `<p class="modal-sub">Floor ${run.floor} · ${run.kills} kills · Origin: ${run.originId ? originById(run.originId)?.name : 'Unknown'}</p>`;
      m.innerHTML = `
        <h3>${run.name} — Lv ${run.level} ${run.raceName} ${classTitle(run)}</h3>
        ${lockNote}
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
              const it = eq[slot] ? resolveItem(run, eq[slot]) : null;
              const label = slotLabel(slot);
              const packBtn = (!locked && it)
                ? `<button class="btn small ghost" data-unequip="${slot}">To pack</button>`
                : '';
              return `<div class="inv-item">${it ? itemIconHtml(it.baseId || it.id, 30) : ''}<div><div class="item-name ${it ? rarityClass(it.rarity) : ''}">${it ? it.name : `<span style="color:var(--ink-faint)">— empty —</span>`}</div>
                ${it ? `<div class="item-desc">${it.desc}</div>` : ''}</div>
                <div class="inv-actions">${packBtn}<span class="tag slot-tag">${label}</span></div></div>`;
            }).join('')}
            ${run.weaponBonus ? `<div style="font-size:13px;color:var(--ink-dim)">Forge-honed: +${run.weaponBonus} weapon damage</div>` : ''}
          </div>
          <div class="sheet-section">
            <h4>Techniques (${skillCapacity(run)} + Strike &amp; Guard)</h4>
            <p class="modal-sub" style="margin-top:-4px;margin-bottom:8px">Use ↑↓ to rearrange battle order.</p>
            ${run.skills.map((id, idx) => {
              const s = SKILLS[id];
              const reorder = !locked ? `
                <div class="inv-actions skill-order">
                  <button class="btn small ghost" data-skill-up="${idx}" ${idx === 0 ? 'disabled' : ''} title="Move up">↑</button>
                  <button class="btn small ghost" data-skill-down="${idx}" ${idx >= run.skills.length - 1 ? 'disabled' : ''} title="Move down">↓</button>
                </div>` : '';
              return `<div class="inv-item"><div><div class="item-name">${s.name}${s.charge ? ` <span class="tag">${s.charge}⚡</span>` : ''}</div>
                <div class="po-cost" style="margin:2px 0">${skillCostTip(s)} · ${skillEffectTip(s)}</div>
                <div class="item-desc">${s.desc}</div></div>${reorder}</div>`;
            }).join('')}
            ${!locked && run.knownSkills.filter(id => !run.skills.includes(id)).length ? `
              <h4 style="margin-top:12px">Reserve</h4>
              ${run.knownSkills.filter(id => !run.skills.includes(id)).map(id => {
                const s = SKILLS[id];
                return `
                <div class="inv-item"><div><div class="item-name">${s.name}</div>
                <div class="po-cost" style="margin:2px 0">${skillCostTip(s)} · ${skillEffectTip(s)}</div>
                <div class="item-desc">${s.desc}</div></div>
                <button class="btn small" data-swap="${id}">Equip</button></div>`;
              }).join('')}` : ''}
            <h4 style="margin-top:14px">Pack</h4>
            ${run.inventory.length ? run.inventory.map((id, i) => {
              const it = resolveItem(run, id);
              const actions = locked
                ? ''
                : `<div class="inv-actions">
                  <button class="btn small" data-equip="${i}">Equip</button>
                  <button class="btn small ghost" data-sellinv="${i}">Sell ${Math.round(it.price * 0.5)}g</button>
                </div>`;
              return `<div class="inv-item">${itemIconHtml(it.baseId || it.id, 30)}<div><div class="item-name ${rarityClass(it.rarity)}">${it.name}</div><div class="item-desc">${it.desc}</div></div>
                ${actions}</div>`;
            }).join('') : '<div style="color:var(--ink-faint);font-size:14px">No spare gear.</div>'}
            <h4 style="margin-top:14px">Consumables</h4>
            ${run.consumables.length ? [...new Set(run.consumables)].map(id => {
              const c = itemById(id);
              const n = run.consumables.filter(x => x === id).length;
              const useBtn = locked ? '' : `<button class="btn small" data-use="${id}">Use</button>`;
              return `<div class="inv-item">${itemIconHtml(c.id, 28)}<div><div class="item-name">${c.name} ×${n}</div><div class="item-desc">${c.desc}</div></div>
                ${useBtn}</div>`;
            }).join('') : '<div style="color:var(--ink-faint);font-size:14px">Empty pockets.</div>'}
            <h4 style="margin-top:14px">Relics</h4>
            <div class="relic-row">${run.relics.length ? relicItems(run).map(r => `<span class="relic-chip" title="${r.desc}">${r.name}</span>`).join('') : '<span style="color:var(--ink-faint);font-size:14px">None yet.</span>'}</div>
            ${run.sigils.length ? `<h4 style="margin-top:14px">Sigils</h4><div class="relic-row">${run.sigils.map(s => `<span class="relic-chip" style="border-color:var(--gold)">✦ Sigil of ${s[0].toUpperCase() + s.slice(1)}</span>`).join('')}</div>` : ''}
          </div>
        </div>
        <div class="divider"></div>
        <div style="text-align:right"><button class="btn small" id="sheet-close">Close</button></div>`;

      m.querySelector('#sheet-close').onclick = () => close();
      if (locked) return;

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
      m.querySelectorAll('[data-skill-up]').forEach(b => b.onclick = () => {
        const i = +b.dataset.skillUp;
        if (i <= 0) return;
        const tmp = run.skills[i - 1];
        run.skills[i - 1] = run.skills[i];
        run.skills[i] = tmp;
        SFX.click(); saveRun(run); render();
      });
      m.querySelectorAll('[data-skill-down]').forEach(b => b.onclick = () => {
        const i = +b.dataset.skillDown;
        if (i >= run.skills.length - 1) return;
        const tmp = run.skills[i + 1];
        run.skills[i + 1] = run.skills[i];
        run.skills[i] = tmp;
        SFX.click(); saveRun(run); render();
      });
      m.querySelectorAll('[data-unequip]').forEach(b => b.onclick = () => {
        unequipSlot(b.dataset.unequip);
        SFX.click(); saveRun(run); renderHud(); render();
      });
      m.querySelectorAll('[data-equip]').forEach(b => b.onclick = async () => {
        const it = resolveItem(run, run.inventory[+b.dataset.equip]);
        if (!it) return;
        close();
        const slot = await chooseEquipSlot(it);
        if (!slot) { characterSheet(); return; }
        equipItem(it, slot);
        SFX.unlock(); saveRun(run); renderHud();
        characterSheet();
      });
      m.querySelectorAll('[data-sellinv]').forEach(b => b.onclick = () => {
        const idx = +b.dataset.sellinv;
        const id = run.inventory[idx];
        const it = resolveItem(run, id);
        run.inventory.splice(idx, 1);
        if (run.gearBag && run.gearBag[id]) delete run.gearBag[id];
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
  const rngPick = runRng(run);
  const boss = pickBossForFloor(51, rngPick, run);
  rngPick.advance(); saveRun(run);
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
  const wasCoop = !!coopS;
  const myName = run?.name || localStorage.getItem('dt_coop_name') || 'Climber';
  const snap = run ? { name: run.name, raceName: run.raceName, floor: run.floor, kills: run.kills, level: run.level, fame: run.fame, title: classTitle(run) } : null;
  if (!wasCoop) teardownCoop();
  else {
    coopS.floorContent.clear();
    coopS.gates.clear();
    // Keep requeueVotes — a partner may have voted before this client reached the end screen.
  }
  const shards = shardsFor(type === 'win' ? 'win' : 'escape');
  meta.shards += shards;
  if (type === 'win') { meta.wins++; unlock('win'); if (!meta.endings.includes('win')) meta.endings.push('win'); }
  if (type === 'escape') { unlock('escape'); if (!meta.endings.includes('escape')) meta.endings.push('escape'); }
  saveMeta(meta);
  clearRun();
  if (run) run.over = true;

  const isWin = type === 'win';
  setBiomeGlow(isWin ? '#d9a53f' : '#5a9ec9');
  setParticles(isWin ? 'embers' : 'leaves');
  app.innerHTML = '';
  app.appendChild(el(`
    <div class="screen end-screen">
      <div class="end-glyph">${isWin ? '👑' : '🌀'}</div>
      <h1 class="end-title victory">${isWin ? 'THE KING IS DEAD' : 'YOU WENT HOME'}</h1>
      <p class="end-epitaph">${isWin
        ? `Vorath falls to one knee, then both — and he is <i>smiling</i>. "The interesting kind after all." The tower shudders as its crown changes... no. You sheathe your weapon and walk past the throne without sitting down. Let the next century wonder why the top floor stands empty.<br/><br/>${snap?.name || 'A climber'} the ${snap?.raceName || ''} ${snap?.title || ''} conquered all fifty-one floors.`
        : `The portal closes behind you, and the world is suddenly, absurdly ordinary: weather, birdsong, a road. You are alive. Every scar came home with you, and so did every story.<br/><br/>The tower still stands on the horizon. You don't look at it. Mostly.<br/><br/>${snap?.name || 'A climber'} the ${snap?.title || ''} survived ${snap?.floor || '?'} floors — and chose to keep living.`}</p>
      <div class="end-stats">
        <div><b>${snap?.floor ?? '—'}</b>floors</div>
        <div><b>${snap?.kills ?? '—'}</b>slain</div>
        <div><b>${snap?.level ?? '—'}</b>level</div>
        <div><b>${snap?.fame ?? '—'}</b>fame</div>
      </div>
      <div class="shard-award">◈ <b>+${shards}</b> Soul Shards for the Sanctum</div>
      <div id="requeue-status" style="min-height:22px;color:var(--ink-dim);font-style:italic;margin:8px 0"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
        ${wasCoop ? '<button class="btn primary" id="btn-party-again">Propose Party Climb</button>' : '<button class="btn primary" id="btn-again">Climb Again</button>'}
        <button class="btn" id="btn-title">Title Screen</button>
      </div>
    </div>`));
  SFX.victory();
  wireEndButtons(wasCoop, myName);
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
  const wasCoop = !!coopS;
  const myName = run?.name || localStorage.getItem('dt_coop_name') || 'Climber';
  if (!wasCoop) teardownCoop();
  else {
    coopS.floorContent.clear();
    coopS.gates.clear();
    // Keep requeueVotes — a partner may have voted before this client reached the end screen.
  }
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
      <div id="requeue-status" style="min-height:22px;color:var(--ink-dim);font-style:italic;margin:8px 0"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
        ${wasCoop ? '<button class="btn primary" id="btn-party-again">Propose Party Climb</button>' : '<button class="btn primary" id="btn-again">Climb Again</button>'}
        <button class="btn" id="btn-title">Title Screen</button>
      </div>
    </div>`));
  wireEndButtons(wasCoop, myName);
}

function wireEndButtons(wasCoop, myName) {
  document.getElementById('btn-again')?.addEventListener('click', () => { meta = loadMeta(); creationFlow(); });
  document.getElementById('btn-title')?.addEventListener('click', () => {
    if (coopS) teardownCoop();
    meta = loadMeta();
    titleScreen();
  });
  const partyBtn = document.getElementById('btn-party-again');
  if (!partyBtn || !wasCoop || !coopS) return;

  if (!coopS.requeueVotes) coopS.requeueVotes = new Set();
  const statusEl = document.getElementById('requeue-status');
  const updateStatus = () => {
    if (!coopS) return;
    const n = coopS.requeueVotes.size;
    const voted = coopS.requeueVotes.has(coopS.you);
    statusEl.textContent = n
      ? `Party climb votes: ${n}/${coopS.partySize}${voted ? ' (you voted yes)' : ''} — everyone must agree.`
      : 'Propose a party climb — all climbers must accept.';
    if (voted) {
      partyBtn.disabled = true;
      partyBtn.textContent = 'Waiting for the party…';
    }
  };

  const tryEnterLobby = () => {
    if (!coopS || coopS.requeueVotes.size < coopS.partySize) return false;
    coopS.onRequeue = null;
    toast('The party climbs again.', 'info');
    coopLobby(myName);
    return true;
  };

  coopS.onRequeue = () => {
    updateStatus();
    tryEnterLobby();
  };

  partyBtn.onclick = () => {
    coopS.requeueVotes.add(coopS.you);
    coopS.net.send({ k: 'requeue', yes: true });
    updateStatus();
    tryEnterLobby();
  };
  updateStatus();
  tryEnterLobby();
}

/* ---------- §11: hidden-path screen glitch ---------- */
function glitchScreen(ms = 1400) {
  const host = document.getElementById('frame') || document.body;
  const g = el('<div class="glitch-overlay"><div class="glitch-bars"></div><div class="glitch-scan"></div></div>');
  host.appendChild(g);
  host.classList.add('glitching');
  SFX.bad?.();
  setTimeout(() => { g.remove(); host.classList.remove('glitching'); }, ms);
}

/* ---------- achievements ---------- */
function unlock(id) {
  const a = award(meta, id);
  if (a) {
    toast(`${a.icon} Achievement: ${a.name}`, 'info');
    SFX.unlock();
  }
}
