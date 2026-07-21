// Game orchestrator: screens, floor flow, three-card draws, event resolution,
// character creation (race → class → origin), co-op decisions, endings.

import { CLASSES, SUBCLASSES, RANDOM_NAMES, subclassOptions } from './data/classes.js';
import { RACES, applyRacePromotion } from './data/races.js';
import { ORIGINS, originById } from './data/origins.js';
import { SKILLS } from './data/skills.js';
import { BIOMES, biomeForFloor, ENEMIES, BOSSES, ALT_BOSSES, MODIFIERS, pickBossForFloor, bossById, findEnemySpec, NPC_ENEMIES, WANDERING_ENEMIES, SECRET_BOSS, mimicSpec } from './data/enemies.js';
import { EVENTS, CATEGORY_META, drawEvent, NPC_EVENTS } from './data/events.js';
import { appearancesFor, defaultAppearanceId } from './data/appearances.js';
import { CONFIG } from './data/config.js';
import { planEncounter, planBossEncounter, pushEventHistory } from './data/balance.js';
import { rankFor } from './data/ranks.js';
import { CONSUMABLES, itemById, resolveItem, rollEquipment, rollRelic, rollUnique, rollWrld, npcDuelLoot, markWrldClaimed, EQUIP_SLOTS, RELICS, ALL_EQUIPMENT, WEAPONS, itemUsefulForClass, itemIncompatibleForClass } from './data/items.js';
import { applyTagOutcomeMods, applySparkleOutcomeMods } from './data/eventtags.js';
import { loadMeta, saveMeta, upgradeRank, award, UPGRADES, ACHIEVEMENTS, newRun, saveRun, loadRun, clearRun, runRng, rollStart, startDescriptor, awakenMonolith, fateGrowthBoost, fateGrowthPct, fateGrowthPctOne, randomRaceId, randomClassId, unlockedCosmetics, climberNameHtml, resetSanctumUpgrades } from './state.js';
import {
  derived, classTitle, skillTier, gainXp, learnableSkills, heal, restoreMana, relicItems,
  equippedItems, changeFame, resourceName, appraiseRun, revealLevel,
  applySubclass as applySubclassFn, APPRAISABLE, allowedWeaponTypes, weaponCompatible,
  skillCapacity, applySkillBreakpoints, grantClassWeightedStats, pickClassWeightedStat,
} from './character.js';
import { startCombat, buildEnemy, snapshotActiveCombat } from './combat.js';
import {
  partyBossAtkMult, partyBossHpMult, partyTrashAtkMult,
  eventFightHpMult, eventFightAtkMult,
} from './data/tdc.js';
import {
  ensureClimbStats, samplePower, noteBossCleared, buildClimbSummary, pushRunHistory,
  loadRunHistory, powerGraphSvg, statPentagonSvg,
  appendChronicle, chronicleHtml, powerChronicleFields,
} from './runlog.js';
import { ICONS } from './icons.js';
import { SFX, toggleMute, isMuted } from './audio.js';
import { setParticles, setBiomeGlow, flash, walkTransition } from './fx.js';
import { mountCrystal } from './crystal.js';
import { renderTravelMap, resetTravelTrail, pathNodeView } from './travelmap.js';
import { app, el, toast, modal, modalCustom, bar, rarityClass } from './ui.js';
import { makeRng, randomSeed } from './rng.js';
import { defaultServerUrl, isMixedContentBlocked, PUBLIC_GAME_URL } from './net.js';
import { CoopSession, connectCoop } from './coop.js';
import { Music } from './music.js';
import { heroSpriteHtml, itemIconHtml, biomeBgUrl, titleBgUrl, raceArtHtml, originArtHtml, raceIconUrl, originIconUrl, eventCatUrl, npcArtUrl, enemySpriteHtml } from './art.js';
import { isAutoPlay, setAutoPlay, syncAutoPlayLoop } from './autoplay.js';

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
const NPC_DUELS = new Set(['crimson_stranger', 'frost_revenant', ...NPC_EVENTS]);

/* ============================================================
   TITLE
   ============================================================ */
export function boot() {
  setParticles('dust');
  setBiomeGlow('#3f3a58');
  syncAutoPlayLoop();
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
  if (p === 'summary') {
    const mock = {
      outcome: 'win', name: 'Elba', raceName: 'Human', classId: 'archer',
      title: 'Archer', seed: 44718291, floor: 51, level: 48, kills: 26,
      fame: 93, gold: 1879, overall: 'A',
      stats: { str: 28, dex: 49, int: 20, wis: 15, lk: 42 },
      skills: ['steady_draw', 'lightning_arrow', 'evasive_roll', 'volley', 'one_shot'].filter(id => SKILLS[id]),
      relics: [
        { name: 'Eternal Whetstone', desc: '+12% damage dealt.' },
        { name: 'Moon Dial', desc: 'Restore +1 class resource each combat turn. Rare clockwork.' },
        { name: 'Coat of Thorns', desc: 'Attackers take 25% of the damage they deal to you, straight back.' },
      ],
      equipment: [
        { name: 'Precise Infernal Lash of Fortune', rarity: 'rare', desc: '+DEX · crit chance · lash', wtype: 'dagger', slot: 'weapon' },
        { name: "Titan Reinforced Dragonbone Helm", rarity: 'legendary', desc: '+HP · +DEF · titan', slot: 'helmet' },
        { name: "Tower Scholar's Robe", rarity: 'legendary', desc: '+INT · mana · scholar', slot: 'chest' },
        { name: "Reinforced Scout's Boots", rarity: 'uncommon', desc: '+DEX · move', slot: 'boots' },
        { name: 'Warlike Polished Bloodied Crown Seal', rarity: 'legendary', desc: '+STR · fame · seal', slot: 'accessory' },
        { name: "Polished Scholarly Phoenix Feather", rarity: 'epic', desc: '+WIS · revive spark', slot: 'accessory' },
      ],
      climb: {
        damageDealt: 8082, damageTaken: 839, healed: 120,
        buffsApplied: 4, debuffsApplied: 7,
        bossesCleared: [
          { floor: 10, name: 'The Thornbeast' },
          { floor: 20, name: 'Lich of the Fallen King' },
          { floor: 30, name: 'Jarl of the White Grave' },
          { floor: 40, name: 'The Putrid Prince' },
          { floor: 50, name: 'Arch-Cyclops Vex' },
        ],
        powerLog: Array.from({ length: 26 }, (_, i) => {
          const floor = 1 + i * 2;
          const expected = 2 + floor * 0.12;
          const power = expected * (0.95 + i * 0.035);
          return { floor, power: +power.toFixed(2), expected: +expected.toFixed(2), deltaPct: Math.round(((power / expected) - 1) * 100) };
        }),
      },
      power: { deltaPct: 48 },
    };
    // Fill technique ids from real skill list if mock ids missing.
    if (!mock.skills.length) mock.skills = Object.keys(SKILLS).slice(0, 5);
    showClimbSummary(mock, { shards: 12, wasCoop: false, myName: 'Elba', isWin: true }).then(() => titleScreen());
    return true;
  }
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

  // enemies by biome + wandering + bosses, with sprites (artId when present)
  // Thumb box is 72×72 — pass the same edge so sprites fit inside, not combat scale.
  const THUMB = 68;
  const enemyCard = (e, { elite = !!e.elite, boss = !!e.boss, note = '' } = {}) => {
    const key = e.artId || e.id;
    const spr = enemySpriteHtml(key, { elite, boss, target: THUMB })
      || (key !== e.id ? enemySpriteHtml(e.id, { elite, boss, target: THUMB }) : null)
      || `<span style="font-size:28px">${e.glyph || '◆'}</span>`;
    const tags = [
      elite ? 'elite' : '',
      boss ? 'boss' : '',
      e.band === 'knights' ? 'band' : '',
      e.intelligent ? 'bribable' : '',
      note,
    ].filter(Boolean).join(' · ');
    return `<div class="dbg-enemy">${spriteMini(spr)}<div><b>${e.name}</b><div class="dbg-dim">hp ${e.hp} · atk ${e.atk} · def ${e.def}${tags ? ` · ${tags}` : ''}</div></div></div>`;
  };
  const enemyHtml = Object.entries(ENEMIES).map(([biome, list]) => `<div class="dbg-group"><h4>${biome} <span class="dbg-dim">(${list.length})</span></h4>
    <div class="dbg-enemy-grid">${list.map(e => enemyCard(e)).join('')}</div>
  </div>`).join('');
  const wanderHtml = WANDERING_ENEMIES.length ? `<div class="dbg-group"><h4>Wandering <span class="dbg-dim">(${WANDERING_ENEMIES.length} · any biome)</span></h4>
    <div class="dbg-enemy-grid">${WANDERING_ENEMIES.map(e => enemyCard(e, { note: 'wandering' })).join('')}</div>
  </div>` : '';
  const bossHtml = `<div class="dbg-group"><h4>Bosses <span class="dbg-dim">(${Object.keys(BOSSES).length} + ${Object.keys(ALT_BOSSES).length} alts${SECRET_BOSS ? ' + secret' : ''})</span></h4>
    <div class="dbg-enemy-grid">${Object.entries(BOSSES).map(([f, b]) => enemyCard(b, { boss: true, note: `F${f}` })).join('')}
    ${Object.entries(ALT_BOSSES).map(([f, b]) => enemyCard(b, { boss: true, note: `F${f} ALT` })).join('')}
    ${SECRET_BOSS ? enemyCard(SECRET_BOSS, { boss: true, note: 'secret · honest path' }) : ''}</div>
  </div>`;

  // events / NPC encounters grouped by category
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
    if (o.fullHeal) parts.push('ease wounds');
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
      const foes = (o.combat.enemies || []).join(', ') || (o.combat.pickEnemies ? 'picked foes' : 'foes');
      let c = `combat vs ${foes}`;
      if (o.combat.reward?.npcDuelLoot) {
        const classes = Array.isArray(o.combat.reward.npcDuelLoot)
          ? o.combat.reward.npcDuelLoot
          : (o.combat.reward.npcDuelLoot.classes || []);
        c += ` → duel loot (epic/leg/unique/wrld${classes.length ? `; tilts ${classes.join('/')}` : ''})`;
      } else if (o.combat.reward?.options) {
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

  const npcHtml = NPC_EVENTS.map(id => {
    const e = EVENTS.find(x => x.id === id);
    if (!e) return '';
    const artId = e.npc?.art;
    const npcBoss = !!NPC_ENEMIES[artId]?.boss;
    const npcElite = !!NPC_ENEMIES[artId]?.elite || npcBoss;
    const spr = artId
      ? enemySpriteHtml(artId, { elite: npcElite, boss: npcBoss, target: THUMB })
      : null;
    return `<div class="dbg-card">
      <div class="dbg-head">${spriteMini(spr || `<span style="font-size:28px">${e.glyph}</span>`)}
        <div><b>${e.npc?.name || e.title}</b> <span class="tag" style="color:var(--gold)">NPC</span>
          <div class="dbg-dim">${e.title}</div></div></div>
      <div class="dbg-dim" style="margin:6px 0">${e.npc?.blurb || e.text.slice(0, 140)}…</div>
      ${formatChoices(e)}
    </div>`;
  }).join('');
  const farmerStrip = ['farmer_a', 'farmer_b', 'farmer_c', 'farmer_d', 'farmer_e', 'farmer_f']
    .map(id => `<div class="dbg-enemy">${spriteMini(enemySpriteHtml(id, { target: THUMB }))}<div><b>${NPC_ENEMIES[id]?.name || id}</b></div></div>`).join('');
  const oldmanStrip = ['oldman_gentle', 'oldman_wrath']
    .map(id => `<div class="dbg-enemy">${spriteMini(enemySpriteHtml(id, { elite: true, boss: !!NPC_ENEMIES[id]?.boss, target: THUMB }))}<div><b>${NPC_ENEMIES[id]?.name || id}</b></div></div>`).join('');

  app.innerHTML = '';
  const scr = el(`<div class="screen dbg-screen">
    <div class="select-header"><h2>Compendium / Debug</h2><p>Every class, technique, relic, item, enemy, boss, NPC, and event in the tower.</p></div>
    <div style="text-align:center;margin-bottom:12px"><button class="btn small" id="dbg-back">← Title</button></div>
    <div class="dbg-tabs">
      <button class="btn small primary" data-tab="classes">Classes</button>
      <button class="btn small" data-tab="skills">Techniques</button>
      <button class="btn small" data-tab="equip">Equipment</button>
      <button class="btn small" data-tab="relics">Relics &amp; Items</button>
      <button class="btn small" data-tab="enemies">Bestiary</button>
      <button class="btn small" data-tab="npcs">NPCs</button>
      <button class="btn small" data-tab="events">Events</button>
    </div>
    <div class="dbg-panel" id="dbg-classes"><div class="dbg-grid">${classCards}</div></div>
    <div class="dbg-panel" id="dbg-skills" style="display:none">${skillHtml}</div>
    <div class="dbg-panel" id="dbg-equip" style="display:none">${equipHtml}</div>
    <div class="dbg-panel" id="dbg-relics" style="display:none"><div class="dbg-group"><h4>Relics (${RELICS.length})</h4>${relicHtml}</div><div class="dbg-group"><h4>Consumables (${CONSUMABLES.length})</h4>${consHtml}</div></div>
    <div class="dbg-panel" id="dbg-enemies" style="display:none">${enemyHtml}${wanderHtml}${bossHtml}</div>
    <div class="dbg-panel" id="dbg-npcs" style="display:none">
      <div class="dbg-group"><h4>NPC Encounters</h4><div class="dbg-grid">${npcHtml}</div></div>
      <div class="dbg-group"><h4>Farmstead faces</h4><div class="dbg-enemy-grid">${farmerStrip}</div></div>
      <div class="dbg-group"><h4>The Old Man</h4><div class="dbg-enemy-grid">${oldmanStrip}</div></div>
    </div>
    <div class="dbg-panel" id="dbg-events" style="display:none">${eventHtml}</div>
  </div>`);
  app.appendChild(scr);
  const panels = { classes: 'dbg-classes', skills: 'dbg-skills', equip: 'dbg-equip', relics: 'dbg-relics', enemies: 'dbg-enemies', npcs: 'dbg-npcs', events: 'dbg-events' };
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

      <div class="title-corner-tools">
        <a class="btn ghost small" href="enemy-boxes.html" id="btn-box-editor" title="Open enemy sprite box editor">Sprite boxes</a>
      </div>

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
          <button class="btn ghost small" id="btn-history">Run History</button>
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
    flash(() => creationFlow(), { biomeId: 'title', partySize: 2 });
  };
  if (saved) document.getElementById('btn-continue').onclick = () => { SFX.click(); run = saved; resumeRun(); };
  document.getElementById('btn-coop').onclick = () => { SFX.click(); coopMenu(); };
  document.getElementById('btn-sanctum').onclick = () => { SFX.click(); sanctumScreen(); };
  document.getElementById('btn-history').onclick = () => { SFX.click(); showRunHistoryBrowser(); };
  document.getElementById('btn-mute').onclick = e => {
    const m = toggleMute();
    Music.syncMute();
    e.target.textContent = m ? 'Sound Off' : 'Sound On';
  };
  document.getElementById('btn-debug').onclick = () => { SFX.click(); debugScreen(); };
  wireVolumeSlider(document.getElementById('vol-slider'), document.getElementById('vol-val'));
  Music.play('title');
}

/** Pause / settings — shared by floor HUD, travel map, and combat. */
async function openPauseMenu() {
  SFX.click();
  const p = modal(`
    <h3>Pause</h3>
    <div class="audio-row pause-audio">
      <span>🎵 Music</span>
      <input type="range" id="pause-vol" class="vol-slider" min="0" max="100" value="${Math.round(Music.getVolume() * 100)}" aria-label="Music volume" />
      <span id="pause-vol-val" class="vol-val">${Math.round(Music.getVolume() * 100)}</span>
      <button class="btn small ghost" id="pause-mute">${isMuted() ? '🔇' : '🔊'}</button>
    </div>
    <label class="audio-row pause-audio pause-autoplay">
      <span>🧪 Auto-play</span>
      <input type="checkbox" id="pause-autoplay" ${isAutoPlay() ? 'checked' : ''} />
      <span class="pause-autoplay-hint">${coopS
        ? 'This device only — your turns &amp; votes (not a party setting)'
        : 'Testing — auto-pick cards &amp; combat'}</span>
    </label>
    <div class="pick-grid">
      <button class="pick-option" data-close="resume"><span class="po-name">Resume the climb</span></button>
      ${coopS ? '' : `<button class="pick-option" data-close="save"><span class="po-name">Save &amp; return to title</span><span class="po-desc">Your climb waits where you left it.</span></button>`}
      <button class="pick-option" data-close="abandon"><span class="po-name" style="color:var(--blood)">${coopS ? 'Leave the party & abandon run' : 'Abandon run'}</span><span class="po-desc">The tower claims another. Shards are still awarded.</span></button>
    </div>`, { dismissible: true });
  wireVolumeSlider(document.getElementById('pause-vol'), document.getElementById('pause-vol-val'));
  const mb = document.getElementById('pause-mute');
  if (mb) mb.onclick = () => { const m = toggleMute(); Music.syncMute(); mb.textContent = m ? '🔇' : '🔊'; };
  const ap = document.getElementById('pause-autoplay');
  if (ap) ap.onchange = () => setAutoPlay(ap.checked);
  const v = await p;
  if (v === 'save') { persistRunForLeave(); titleScreen(); }
  if (v === 'abandon') endRun('abandon');
}

/** Callbacks shared by combat / map chrome that covers the floor HUD. */
function runOverlayUi() {
  return {
    onCharacter: () => { SFX.click(); characterSheet({ locked: sheetCombatLock }); },
    onSettings: () => { openPauseMenu(); },
  };
}

function showRunHistoryBrowser() {
  const list = loadRunHistory();
  modalCustom((m, close) => {
    m.innerHTML = `<h3>Run History</h3>
      <p class="modal-sub">Last ${list.length || 0} climbs kept on this device.</p>
      <div class="pick-grid">
        ${list.length ? list.map((s, i) => `
          <button class="pick-option" data-i="${i}">
            <span class="po-tag tag">${s.outcome || '?'}</span>
            <div class="po-name">${s.name || 'Climber'} — F${s.floor} · ${s.overall || '?'}</div>
            <div class="po-desc">${s.raceName || ''} ${s.title || ''} · Lv ${s.level} · ${s.kills || 0} slain
              ${s.at ? ` · ${new Date(s.at).toLocaleDateString()}` : ''}</div>
          </button>`).join('') : '<div style="color:var(--ink-faint);padding:12px">No climbs recorded yet.</div>'}
        <button class="pick-option" data-close="1"><span class="po-name" style="color:var(--ink-dim)">Close</span></button>
      </div>`;
    m.querySelector('[data-close]')?.addEventListener('click', () => close());
    m.querySelectorAll('[data-i]').forEach(b => b.onclick = async () => {
      close();
      const s = list[+b.dataset.i];
      if (!s) return;
      await showClimbSummary(s, {
        shards: 0, wasCoop: false, myName: s.name,
        isWin: s.outcome === 'win', fromHistory: true,
      });
      titleScreen();
    });
  });
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
  const cos = unlockedCosmetics(meta);
  const preview = climberNameHtml('Climber', { title: meta.equippedTitle, nameStyle: meta.equippedNameStyle });
  app.innerHTML = '';
  const scr = el(`<div class="screen">
    <div class="sanctum-header">
      <div><h2>The Sanctum</h2><p style="color:var(--ink-dim);font-style:italic">Where dead climbers' experience becomes the next climber's edge.</p></div>
      <div style="display:flex;gap:14px;align-items:center">
        <span class="shard-count">◈ ${meta.shards} Soul Shards</span>
        <button class="btn small danger" id="btn-reset-sanctum">Reset Sanctum</button>
        <button class="btn small" id="btn-back">← Back</button>
      </div>
    </div>
    <div class="upgrade-grid" id="upgrades"></div>
    <div class="divider"></div>
    <h3 style="margin:10px 0">Name &amp; Titles</h3>
    <div class="panel sanctum-cosmetics">
      <div class="cosmo-preview">Preview: ${preview}</div>
      <label class="cosmo-row">Title
        <select id="cosmo-title">
          ${cos.titles.map(t => `<option value="${t.title === 'None' ? '' : t.title}" ${(!meta.equippedTitle && t.title === 'None') || meta.equippedTitle === t.title ? 'selected' : ''}>${t.title}</option>`).join('')}
        </select>
      </label>
      <label class="cosmo-row">Name style
        <select id="cosmo-style">
          ${cos.styles.map(s => `<option value="${s.style}" ${(!meta.equippedNameStyle && !s.style) || meta.equippedNameStyle === s.style ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
      </label>
    </div>
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

  const syncCosmetics = () => {
    meta.equippedTitle = scr.querySelector('#cosmo-title').value || null;
    meta.equippedNameStyle = scr.querySelector('#cosmo-style').value || null;
    saveMeta(meta);
    scr.querySelector('.cosmo-preview').innerHTML = `Preview: ${climberNameHtml('Climber', { title: meta.equippedTitle, nameStyle: meta.equippedNameStyle })}`;
  };
  scr.querySelector('#cosmo-title').onchange = () => { SFX.click(); syncCosmetics(); };
  scr.querySelector('#cosmo-style').onchange = () => { SFX.click(); syncCosmetics(); };

  scr.querySelector('#btn-reset-sanctum').onclick = () => {
    SFX.click();
    modalCustom((m, close) => {
      m.innerHTML = `<h3>Reset Sanctum?</h3>
        <p class="modal-sub">All Sanctum upgrades return to rank 0. Soul shards stay. Achievements and cosmetics are kept.</p>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
          <button class="btn small" id="rs-cancel">Cancel</button>
          <button class="btn small danger" id="rs-ok">Reset upgrades</button>
        </div>`;
      m.querySelector('#rs-cancel').onclick = () => close();
      m.querySelector('#rs-ok').onclick = () => {
        resetSanctumUpgrades(meta);
        SFX.bad();
        toast('Sanctum upgrades wiped. Deeds remain.', 'sys');
        close();
        sanctumScreen();
      };
    });
  };

  const achList = scr.querySelector('#achs');
  for (const a of ACHIEVEMENTS) {
    const got = meta.achievements.includes(a.id);
    const badge = got && (a.title || a.nameStyle)
      ? `<div class="ach-reward">${a.title ? `Title: <span class="climber-title ${a.titleStyle || ''}">${a.title}</span>` : ''}${a.title && a.nameStyle ? ' · ' : ''}${a.nameStyle ? 'Name style' : ''}</div>`
      : '';
    achList.appendChild(el(`<div class="achievement ${got ? '' : 'locked'}">
      <div class="ach-icon">${a.icon}</div>
      <div><div class="ach-name">${a.name}</div><div class="ach-desc">${got ? a.desc : '???'}</div>${badge}</div>
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
  const pick = { raceId: 'human', classId: 'warrior', originId: ORIGINS[0].id, appearanceId: defaultAppearanceId('warrior'), fateRace: false, fateClass: false };
  let step = 0; // 0 race, 1 class, 2 origin, 3 name
  let rerolls = 0;
  let gen = null;
  let appraised = false;      // has the Monolith crystal been charged?
  let crystalCtl = null;
  let apprBand = null;        // the revealed potential band (computed once per roll)

  function maxRerolls() { return CONFIG.chargen.rerolls + (RACES[pick.raceId].extraReroll || 0) + upgradeRank(meta, 'foresight'); }
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
      const skinFor = it => (isClass && it.id === pick.classId) ? pick.appearanceId : defaultAppearanceId(it.id);
      const railArtOf = it => isClass
        ? heroSpriteHtml(it.id, 40, { appearanceId: skinFor(it) })
        : isOrigin ? (originIconUrl(it.id) && `<img class="px-icon" src="${originIconUrl(it.id)}" style="width:40px;height:40px" alt="">`)
        : (raceIconUrl(it.id) && `<img class="px-icon" src="${raceIconUrl(it.id)}" style="width:40px;height:40px" alt="">`);
      const emblemOf = it => railArtOf(it) || (isOrigin ? (it.name.replace(/^The\s+/i, '')[0] || it.name[0]) : (it.glyph || it.name[0]));
      const artOf = it => isClass
        ? (heroSpriteHtml(it.id, 280, { appearanceId: skinFor(it) }) || `<div class="class-icon" style="width:220px;height:220px">${ICONS[it.id]}</div>`)
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
        const skins = isClass ? appearancesFor(it.id) : [];
        const write = () => {
          art.innerHTML = artOf(it);
          nameEl.textContent = it.name;
          textEl.style.borderLeftColor = acc;
          const look = skins.length > 1
            ? `<div class="look-row"><button type="button" class="btn small ghost" id="look-prev">◀</button>
                <span class="look-label">${skins.find(s => s.id === pick.appearanceId)?.name || 'Look'} · ${skins.findIndex(s => s.id === pick.appearanceId) + 1}/${skins.length}</span>
                <button type="button" class="btn small ghost" id="look-next">▶</button></div>`
            : '';
          textEl.innerHTML = `<div class="showcase-tag" style="color:${acc}">${tagOf(it)}</div><div class="showcase-blurb">${blurbOf(it)}</div>${look}`;
          art.style.opacity = nameEl.style.opacity = textEl.style.opacity = '1';
          if (skins.length > 1) {
            const cycle = dir => {
              const i = Math.max(0, skins.findIndex(s => s.id === pick.appearanceId));
              pick.appearanceId = skins[(i + dir + skins.length) % skins.length].id;
              SFX.click();
              paint(it, false);
            };
            textEl.querySelector('#look-prev')?.addEventListener('click', () => cycle(-1));
            textEl.querySelector('#look-next')?.addEventListener('click', () => cycle(1));
          }
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
        if (isClass) pick.appearanceId = defaultAppearanceId(id);
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
        if (isClass) pick.appearanceId = defaultAppearanceId(chosen.id);
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
        appearanceId: pick.appearanceId || defaultAppearanceId(pick.classId),
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
  run.appearanceId = pick.appearanceId || defaultAppearanceId(run.classId);
  run.startPercentile = gen.percentile;
  run.underdog = gen.percentile <= CONFIG.chargen.underdogPercentile;
}

/* ---------- gate entry presentation (handoff §27) ---------- */
function gateEntry(then) {
  const quick = (meta.gateSeen || 0) >= 3;
  meta.gateSeen = (meta.gateSeen || 0) + 1;
  saveMeta(meta);
  SFX.bossIntro();
  const partySize = Math.max(1, 1 + (coopS?.partners?.size || 0));
  walkTransition(then, {
    biomeId: run?.biomeId || 'forest',
    partySize,
    caption: 'THE CLIMB BEGINS',
    durationMs: quick ? 900 : 2200,
    skippable: true,
  });
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
      <label style="display:flex;gap:8px;align-items:center;margin-top:10px;font-size:14px;color:var(--ink-dim);cursor:pointer">
        <input type="checkbox" id="coop-public" /> Public party — strangers can find and join it
      </label>
      <div class="divider"></div>
      <div style="display:flex;gap:10px">
        <input class="name-input" id="coop-code" maxlength="4" placeholder="CODE" style="width:110px;text-transform:uppercase;text-align:center;letter-spacing:.3em" />
        <button class="btn" id="btn-join" style="flex:1">Join a Party</button>
      </div>
      <div class="divider"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn" id="btn-quick" style="flex:1">Quick Match</button>
        <button class="btn ghost" id="btn-browse">Browse open parties</button>
      </div>
      <div id="coop-publist" style="margin-top:10px"></div>
      <div id="coop-err" style="color:#f0a8a0;font-size:14px;margin-top:12px;min-height:20px"></div>
    </div>
    <div style="text-align:center;margin-top:16px"><button class="btn ghost small" id="btn-back">← Back</button></div>
  </div>`);
  app.appendChild(scr);
  const nameInput = scr.querySelector('#coop-name');
  nameInput.value = localStorage.getItem('dt_coop_name') || RANDOM_NAMES[Math.floor(Math.random() * RANDOM_NAMES.length)];
  const errEl = scr.querySelector('#coop-err');

  async function go(mode, joinCode = null) {
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
    if (mode === 'create') net.create(name, scr.querySelector('#coop-public')?.checked || false);
    else if (mode === 'quick') net.quickjoin(name);
    else {
      const code = (joinCode || scr.querySelector('#coop-code').value.trim()).toUpperCase();
      if (code.length !== 4) { errEl.textContent = 'Party codes are 4 letters.'; net.close(); return; }
      net.join(code, name);
    }
    const roomMsg = await roomPromise;
    coopS = new CoopSession(net);
    if (mode === 'quick' && roomMsg.host) {
      toast('No open parties right now — you host a public one. Climbers can find you.', 'info');
    }
    coopLobby(name);
  }

  // one-shot browser for open public parties
  async function browsePublic() {
    const listEl = scr.querySelector('#coop-publist');
    listEl.innerHTML = '<span style="color:var(--ink-dim);font-style:italic">Looking for open parties…</span>';
    let net;
    try {
      net = await connectCoop(defaultServerUrl());
    } catch {
      listEl.innerHTML = '';
      errEl.textContent = 'Could not reach the party server. Is it awake?';
      return;
    }
    const listPromise = new Promise(r => { const off = net.sys('publist', m => { off(); r(m); }); });
    net.listPublic();
    const timeout = new Promise(r => setTimeout(() => r(null), 5000));
    const m = await Promise.race([listPromise, timeout]);
    net.close();
    if (!m) { listEl.innerHTML = ''; errEl.textContent = 'The server did not answer the lobby list.'; return; }
    if (!m.rooms.length) {
      listEl.innerHTML = '<span style="color:var(--ink-dim);font-style:italic">No open public parties. Quick Match will make you the host.</span>';
      return;
    }
    listEl.innerHTML = m.rooms.map(r => `
      <div class="inv-item">
        <div><div class="item-name">${String(r.host).replace(/[<>&"]/g, '')}'s party</div>
        <div class="item-desc">${r.count}/4 climbers · code ${r.code}</div></div>
        <button class="btn small" data-pubjoin="${r.code}">Join</button>
      </div>`).join('');
    listEl.querySelectorAll('[data-pubjoin]').forEach(b => b.onclick = () => { SFX.click(); go('join', b.dataset.pubjoin); });
  }

  scr.querySelector('#btn-create').onclick = () => { SFX.click(); go('create'); };
  scr.querySelector('#btn-join').onclick = () => { SFX.click(); go('join'); };
  scr.querySelector('#btn-quick').onclick = () => { SFX.click(); go('quick'); };
  scr.querySelector('#btn-browse').onclick = () => { SFX.click(); browsePublic(); };
  scr.querySelector('#btn-back').onclick = () => { SFX.click(); titleScreen(); };
}

function coopLobby(myName) {
  // Requeue / return: restore partners and reopen the public listing.
  coopS.eliminated.clear();
  coopS._syncRoster?.();
  coopS.net.send({ k: 'reopen' });

  let myPick = { raceId: 'human', classId: 'warrior', originId: ORIGINS[0].id, appearanceId: defaultAppearanceId('warrior'), fateRace: false, fateClass: false };
  let myReady = false;
  let decisionMode = 'majority'; // host-controlled (handoff §3)
  const lobbyState = new Map();
  let gen = rollStart(myPick.classId, myPick.raceId);
  let rerolls = 0;
  function maxRerolls() { return CONFIG.chargen.rerolls + (RACES[myPick.raceId].extraReroll || 0) + upgradeRank(meta, 'foresight'); }
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
      title: meta.equippedTitle || null,
      nameStyle: meta.equippedNameStyle || null,
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
    coopS.resetRunBuffers();
    coopS.requeueVotes = new Set();
    coopS.eliminated.clear();
    coopS._syncRoster?.(); // eliminated climbers from a past run rejoin the roster
    run = newRun(meta, {
      classId: myPick.classId, raceId: myPick.raceId, originId: myPick.originId,
      appearanceId: myPick.appearanceId || defaultAppearanceId(myPick.classId),
      name: myName, seed: coopS.seed, gen: awakenMonolith(gen),
      fateRace: myPick.fateRace, fateClass: myPick.fateClass,
    });
    run.coopMode = true;
    if (coopS.partySize >= 3) unlock('party_of_three');
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
    coopS.onPartnerEliminated = (name) => {
      toast(`${name} has fallen — the tower keeps them.`, 'bad');
      // if host duty just migrated to this client, keep the floors flowing
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
    const boost = fateGrowthPctOne();
    const fateLabel = kind === 'origin'
      ? '🎲 Tempt fate'
      : `🎲 Tempt fate (+${boost}%)`;
    const fateHint = kind === 'origin'
      ? 'Lock in a random origin.'
      : 'Seal a random pick for +growth — revealed on the climb.';
    modalCustom((m, close) => {
      m.classList.add('sheet-modal', 'picker-modal');
      m.innerHTML = `
        <button type="button" class="sheet-close-x" id="picker-x" title="Close" aria-label="Close">✕</button>
        <h3>Choose your ${def.title}</h3>
        <div class="picker-grid">${def.items.map(it => `
          <button class="picker-card" data-id="${it.id}" ${it.accent ? `style="--accent:${it.accent}"` : ''}>
            <div class="pk-glyph">${it.icon || `<span style="font-size:34px">${it.glyph}</span>`}</div>
            <div class="pk-name">${it.name}</div>
            <div class="pk-desc">${it.desc}</div>
          </button>`).join('')}
        </div>
        <div class="picker-fate-bar">
          <button type="button" class="btn small" id="picker-fate">${fateLabel}</button>
          <span class="picker-fate-hint">${fateHint}</span>
        </div>`;
      m.querySelector('#picker-x').onclick = () => { SFX.click(); close(); };
      m.querySelector('#picker-fate').onclick = () => {
        if (kind === 'origin') {
          myPick.originId = ORIGINS[Math.floor(Math.random() * ORIGINS.length)].id;
          SFX.unlock();
          toast('Fate chooses your origin.', 'good');
          close();
          updatePickTiles();
          sendLobby();
          return;
        }
        close();
        trustFate(kind);
      };
      m.querySelectorAll('.picker-card').forEach(b => b.onclick = () => {
        myPick[kind + 'Id'] = b.dataset.id;
        if (kind === 'race') myPick.fateRace = false;
        if (kind === 'class') {
          myPick.fateClass = false;
          myPick.appearanceId = defaultAppearanceId(myPick.classId);
        }
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
      myPick.appearanceId = defaultAppearanceId(myPick.classId);
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
    const looks = classSealed ? [] : (appearancesFor(myPick.classId) || []);
    const lookName = looks.find(s => s.id === myPick.appearanceId)?.name || 'Look';
    const lookRow = (!classSealed && !myReady && looks.length > 1)
      ? `<div class="pt-hint" style="display:flex;gap:6px;align-items:center;justify-content:center;margin-top:4px">
          <button class="btn small ghost" id="look-prev" type="button">◀</button>
          <span>${lookName}</span>
          <button class="btn small ghost" id="look-next" type="button">▶</button></div>`
      : '';
    const raceArt = raceSealed
      ? '<span style="font-size:32px">🎲</span>'
      : (raceIconUrl(myPick.raceId) ? `<img class="px-icon" src="${raceIconUrl(myPick.raceId)}" style="width:44px;height:44px" alt="">` : `<span style="font-size:32px">${RACES[myPick.raceId].glyph}</span>`);
    const classArt = classSealed
      ? '<span style="font-size:32px">🎲</span>'
      : (heroSpriteHtml(myPick.classId, 44, { appearanceId: myPick.appearanceId }) || `<div class="class-icon" style="width:40px;height:40px;margin:0 auto;color:${CLASSES[myPick.classId].accent}">${ICONS[myPick.classId]}</div>`);
    return `
      <div class="panel pick-tile" id="pick-race"><div class="pt-art">${raceArt}</div><b>${raceSealed ? '???' : RACES[myPick.raceId].name}${raceSealed ? ' <span class="fate-badge">FATE</span>' : ''}</b><div class="pt-hint">${raceSealed ? 'sealed until the climb' : 'change race'}</div>${raceSealed || myReady ? '' : `<button class="btn small fate-mini" id="fate-race" type="button">🎲 Trust fate (+${boost}%)</button>`}</div>
      <div class="panel pick-tile" id="pick-class"><div class="pt-art">${classArt}</div><b>${classSealed ? '???' : CLASSES[myPick.classId].name}${classSealed ? ' <span class="fate-badge">FATE</span>' : ''}</b><div class="pt-hint">${classSealed ? 'sealed until the climb' : 'change class'}</div>${lookRow}${classSealed || myReady ? '' : `<button class="btn small fate-mini" id="fate-class" type="button">🎲 Trust fate (+${boost}%)</button>`}</div>
      <div class="panel pick-tile" id="pick-origin"><div class="pt-art">${originIconUrl(myPick.originId) ? `<img class="px-icon" src="${originIconUrl(myPick.originId)}" style="width:44px;height:44px" alt="">` : `<span style="font-size:32px">${originById(myPick.originId).glyph}</span>`}</div><b style="font-size:13px">${originById(myPick.originId).name}</b><div class="pt-hint">change origin</div>${myReady ? '' : `<button class="btn small fate-mini" id="fate-origin" type="button">🎲 Tempt fate</button>`}</div>`;
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
    document.getElementById('fate-origin')?.addEventListener('click', e => {
      e.stopPropagation();
      if (myReady) return;
      myPick.originId = ORIGINS[Math.floor(Math.random() * ORIGINS.length)].id;
      SFX.unlock();
      toast('Fate chooses your origin.', 'good');
      updatePickTiles();
      sendLobby();
    });
    const cycleLook = dir => {
      const skins = appearancesFor(myPick.classId) || [];
      if (skins.length < 2) return;
      const i = Math.max(0, skins.findIndex(s => s.id === myPick.appearanceId));
      myPick.appearanceId = skins[(i + dir + skins.length) % skins.length].id;
      SFX.click();
      updatePickTiles();
    };
    document.getElementById('look-prev')?.addEventListener('click', e => { e.stopPropagation(); cycleLook(-1); });
    document.getElementById('look-next')?.addEventListener('click', e => { e.stopPropagation(); cycleLook(1); });
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
        title: meta.equippedTitle, nameStyle: meta.equippedNameStyle,
      },
      ...partners.map(([id, p]) => {
        const lob = lobbyState.get(id);
        return {
          name: p.name,
          classId: lob?.classId, raceId: lob?.raceId,
          fateRace: !!lob?.fateRace, fateClass: !!lob?.fateClass,
          ready: lob?.ready, host: coopS.net.roster.find(r => r.id === id)?.host,
          title: lob?.title || null, nameStyle: lob?.nameStyle || null,
        };
      }),
    ];
    return rows.map(r => `
      <div class="inv-item">
        <div class="item-name">${r.host ? '👑 ' : ''}${climberNameHtml(r.name, { title: r.title, nameStyle: r.nameStyle })}</div>
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
          <button class="btn small ${decisionMode === 'majority' ? 'primary' : ''}" data-mode="majority" ${coopS.isHost ? '' : 'disabled'}>Majority Vote — ties roll randomly</button>
          <button class="btn small ${decisionMode === 'first' ? 'primary' : ''}" data-mode="first" ${coopS.isHost ? '' : 'disabled'}>First Pick — fastest hand decides</button>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-bottom:14px" id="pick-row">${pickTilesHtml()}</div>
      <div class="panel" style="padding:14px 18px;margin-bottom:14px" id="potential-box">${potentialHtml()}</div>
      <div class="panel" style="padding:18px 22px">
        <div id="roster">${rosterHtml()}</div>
        <div class="divider"></div>
        <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
          <button class="btn ${myReady ? '' : 'primary'}" id="btn-ready">${myReady ? 'UNREADY' : 'READY'}</button>
          ${coopS.isHost ? `<button class="btn primary" id="btn-go" ${everyoneReady() ? '' : 'disabled'}>Enter the Tower</button>` : `<span style="align-self:center;color:var(--ink-dim);font-style:italic">The host opens the gate when all are ready.</span>`}
          <button class="btn danger small" id="btn-leave">Leave</button>
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
      b.textContent = myReady ? 'UNREADY' : 'READY';
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
    appraisal: run.appraisal || null,
    title: meta.equippedTitle || null,
    nameStyle: meta.equippedNameStyle || null,
  };
}

function bindPartnerStrip(root = document) {
  root.querySelectorAll('.partner-chip[data-pid]').forEach(chip => {
    chip.onclick = () => {
      SFX.click();
      partnerSheetModal(chip.dataset.pid);
    };
  });
}

function partnerStrip() {
  if (!coopS || coopS.alone) return '';
  let html = '<div class="panel partner-strip">';
  for (const [id, p] of coopS.partners) {
    const s = p.status;
    const nm = climberNameHtml(s?.name || p.name, { title: s?.title, nameStyle: s?.nameStyle });
    html += `<div class="partner-chip ${s?.down ? 'downed' : ''}" data-pid="${id}" title="Peek sheet & appraisal">
      <span class="pc-name">${nm}</span>
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
    bindPartnerStrip();
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
      <div class="hud-portrait">${heroSpriteHtml(run.classId, 46, { appearanceId: run.appearanceId }) || ICONS[run.classId] || '🥋'}</div>
      <div>
        <div class="hud-name">${climberNameHtml(run.name, { title: meta.equippedTitle, nameStyle: meta.equippedNameStyle })}</div>
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
      <button class="btn small ghost" id="hud-quit" title="Settings" aria-label="Settings">☰</button>
    </div>`;
  hud.querySelector('#hud-sheet').onclick = () => {
    SFX.click();
    characterSheet({ locked: sheetCombatLock });
  };
  hud.querySelector('#hud-quit').onclick = () => openPauseMenu();
}

/* ---- solo mid-floor persistence (no free event rerolls / combat flees) ---- */
function setPending(kind, data = {}) {
  if (!run || coopS) return;
  run.pending = { kind, floor: run.floor, ...data };
  saveRun(run);
}

function clearPending() {
  if (run?.pending) delete run.pending;
}

/** Snapshot live combat into pending, then save — used on Save & leave. */
function persistRunForLeave() {
  if (!run || coopS) return;
  const snap = snapshotActiveCombat();
  if (snap) {
    run.pending = {
      kind: 'combat',
      floor: run.floor,
      ...snap,
      reward: run.pending?.reward || null,
      text: snap.introText || run.pending?.text || null,
    };
  }
  saveRun(run);
}

async function resumeRun() {
  if (!run) return titleScreen();
  ensureClimbStats(run);
  const biome = biomeForFloor(Math.max(1, run.floor));
  run.biomeId = biome.id;
  setBiomeGlow(biome.glow);
  setParticles(biome.particle);
  Music.play(BIOME_MUSIC[run.biomeId] || 'forest');
  const stage = floorChrome();
  const p = run.pending;
  if (p && p.floor === run.floor) {
    toast('Resuming where you left off…', 'info');
    return resumePending(stage, p);
  }
  // Old saves with no pending: re-enter this floor without advancing.
  if (run.floor >= 1) {
    toast('No mid-floor save found — redrawing this floor.', 'sys');
    return reenterCurrentFloor(stage);
  }
  return enterFloorScreen(true);
}

async function resumePending(stage, p) {
  if (p.kind === 'travel' && p.cards?.length) {
    return renderTravelMap(stage, p.cards, null, travelCtx());
  }
  if (p.kind === 'event' && p.eventId) {
    const ev = EVENTS.find(e => e.id === p.eventId);
    if (ev) {
      run.eventSparkle = !!p.sparkle;
      return renderEventCard(stage, ev);
    }
  }
  if (p.kind === 'shop' && p.eventId) {
    const ev = EVENTS.find(e => e.id === p.eventId) || { id: p.eventId, title: 'Merchant', shop: true };
    return shopScreen(stage, ev, { resumeStock: p.stock || null });
  }
  if (p.kind === 'combat' && p.enemies?.length) {
    if (p.bossId) {
      const boss = bossById(p.bossId) || pickBossForFloor(run.floor, runRng(run), run);
      return fightGroupBoss(stage, p.enemies, boss, { resume: p });
    }
    return fightGroup(stage, p.enemies, {
      text: p.text || null,
      modifier: p.modifier || null,
      prebuilt: p.enemies,
      reward: p.reward || null,
      resume: p,
    });
  }
  if (p.kind === 'boss') return bossFloor(stage, { resume: p });
  if (p.kind === 'modifier') return modifierFloor(stage);
  if (p.kind === 'throne') return throneRoom(stage);
  return reenterCurrentFloor(stage);
}

/** Replay current floor content without floor++ (solo only). */
async function reenterCurrentFloor(stage) {
  if (run.floor === LAST_FLOOR) return throneRoom(stage);
  if (BOSS_FLOORS.includes(run.floor)) return bossFloor(stage);
  if (run.floor % 5 === 0) return modifierFloor(stage);
  if (BOSS_FLOORS.includes(run.floor + 1)) {
    const campfire = EVENTS.find(e => e.id === 'campfire');
    setPending('event', { eventId: 'campfire' });
    return renderEventCard(stage, campfire);
  }
  const cards = generateCards(runRng(run));
  setPending('travel', { cards });
  return renderTravelMap(stage, cards, null, travelCtx());
}

// Auto-save mid-run if the tab closes (solo).
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (run && !run.over && !coopS) persistRunForLeave();
  });
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
  bindPartnerStrip();
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
  clearPending();
  run.floor++;
  ensureClimbStats(run);
  const biome = biomeForFloor(run.floor);
  run.biomeId = biome.id;
  setBiomeGlow(biome.glow);
  setParticles(biome.particle);
  samplePower(run);

  // co-op mercy: the fallen rise at the next floor — at a price (handoff §16)
  if (run.down) {
    run.down = false;
    run.safeFloorStreak = 0;
    run.hp = Math.max(1, Math.round(run.maxHp * CONFIG.death.respawnHpPct));
    run.mp = Math.round(run.maxMp * CONFIG.death.respawnResourcePct);
    const lost = deathItemLoss();
    toast(`Your companions drag you to your feet.${lost.length ? ' Lost in the fall: ' + lost.join(', ') : ''}`, 'bad');
  } else if (run.floor > 1) {
    run.safeFloorStreak = (run.safeFloorStreak || 0) + 1;
    if (run.safeFloorStreak >= 5) unlock('no_death_5');
  }

  heal(run, run.maxHp * CONFIG.recovery.floorHealPct);
  restoreMana(run, run.maxMp * CONFIG.recovery.floorManaPct);

  if (run.foodBuff?.floorsLeft != null) {
    run.foodBuff.floorsLeft -= 1;
    if (run.foodBuff.floorsLeft <= 0) {
      run.foodBuff = null;
      toast('The farm meal\'s warmth fades.', 'sys');
    }
  }

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
    setPending('event', { eventId: 'campfire' });
    saveRun(run);
    return renderEventCard(stage, campfire);
  }

  // THE TRAVEL MAP (handoff §6): most floors branch into a choice of paths
  const cards = generateCards(runRng(run));
  setPending('travel', { cards });
  saveRun(run);
  renderTravelMap(stage, cards, null, travelCtx());
}

// context passed to the travel map — real run data + the resolution engine
function travelCtx() {
  const gear = equippedItems(run).map(it => it.name);
  const partySize = Math.max(1, 1 + (coopS?.partners?.size || 0));
  return {
    run, coopS, resolveCard,
    flash: (swap) => flash(swap, {
      biomeId: run.biomeId || biomeForFloor(run.floor).id,
      partySize,
    }),
    biome: biomeForFloor(run.floor),
    resourceName: resourceName(run),
    classTitle: classTitle(run),
    equippedSummary: gear,
    onCharacter: () => { SFX.click(); characterSheet(); },
    onSettings: () => { openPauseMenu(); },
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
      ? Object.entries(appr.results).map(([k, v]) => {
          const cell = typeof v === 'object' && v
            ? `${v.rank || '?'}${v.lo != null ? ` · ~${v.lo}–${v.hi}` : ''}`
            : String(v);
          return `<tr><td>${k.toUpperCase()}</td><td>${cell}</td></tr>`;
        }).join('')
      : '<tr><td colspan="2" style="color:var(--ink-faint)">No appraisal shared yet</td></tr>';
    m.innerHTML = `
      <h3>${climberNameHtml(s.name || p.name, { title: s.title, nameStyle: s.nameStyle })} — Lv ${s.level || '?'} ${s.raceName || ''} ${s.className || p.classId || ''}</h3>
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
            ${appr?.growthRank ? `<tr><td>Growth potential</td><td><b>${appr.growthRank}</b></td></tr>` : ''}
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
    // ✦ star events: rare affinity shimmer (~10%). Blessed rewards when taken.
    let affine = false;
    if (ev.affinity) {
      const classes = forParty?.classes || [run.classId];
      if (ev.affinity.classes?.some(c => classes.includes(c))) affine = true;
      if (ev.affinity.races?.includes(run.raceId)) affine = true;
      if (ev.affinity.underdog && run.underdog) affine = true;
    }
    const card = {
      kind: 'event',
      category: ev.category || 'unknown',
      eventId: ev.id,
      sparkle: affine && rng.chance(CONFIG.events.sparkleChance ?? 0.1),
    };
    // ~10%: veil the identity. drawEvent already picks from the full eligible
    // pool — mystery is a UI flag, not a separate category filter.
    if (rng.chance(CONFIG.events.mysteryNodeChance ?? 0.10)) card.hidden = true;
    cards.push(card);
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
        sparkle: false,
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
        // Waypoints are marked paths, not ✦ star blessings — only affinity can star.
        let affine = false;
        if (ev.affinity) {
          const classes = forParty?.classes || [run.classId];
          if (ev.affinity.classes?.some(c => classes.includes(c))) affine = true;
          if (ev.affinity.races?.includes(run.raceId)) affine = true;
          if (ev.affinity.underdog && run.underdog) affine = true;
        }
        cards[slot] = {
          kind: 'event', category: ev.category || forceCat, eventId: ev.id,
          sparkle: affine && rng.chance(CONFIG.events.sparkleChance ?? 0.1),
        };
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
    // Legacy 3-card draw — keep in sync with travel-map reveals.
    const v = pathNodeView(c);
    return `
      <div class="pick-card ${c.sparkle ? 'sparkle' : ''}${c.hidden ? ' mystery' : ''}" data-i="${i}">
        <div class="pc-glyph">${v.glyph}</div>
        <div class="pc-cat">${v.title}</div>
        <div class="pc-votes" id="votes-${i}"></div>
      </div>`;
  }

  stage.innerHTML = `
    <div class="draw-header">
      <span class="tag">FLOOR ${run.floor}</span>
      <h3>The Tower Deals ${cards.length}</h3>
      <p>${coopCtx ? (coopCtx.mode === 'first' ? 'First pick decides — fastest hand wins.' : 'The party votes. Majority rules; ties spin the tower\'s coin.') : 'Choose your path. Most cards name their destination; a rare fog still hides a few.'}</p>
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
      if (coopS.emitPick) coopS.emitPick(run.floor, i);
      else coopS.net.send({ k: 'pick', floor: run.floor, idx: i });
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
    clearPending();
    if (coopS) {
      const enemies = rehydrateEnemies(card.enemies);
      return sharedFightCard(stage, { type: 'encounter', enemies });
    }
    return encounterFloor(stage, card.enemies, card.hpMult || 1);
  }
  const ev = EVENTS.find(e => e.id === card.eventId);
  run.seenEvents.push(ev.id);
  run.eventSparkle = !!card.sparkle;
  noteEventTags(ev);
  pushEventHistory(run, ev.category || 'unknown');
  setPending(ev.shop ? 'shop' : 'event', { eventId: ev.id, sparkle: !!card.sparkle });
  saveRun(run);
  renderEventCard(stage, ev);
}

function logCombatStart(enemies, { boss = false, intro = null } = {}) {
  const entry = {
    t: 'combat',
    boss: !!boss,
    enemies: (enemies || []).map(e => e.name || e.id || '?'),
    intro: intro || null,
  };
  if (boss) Object.assign(entry, powerChronicleFields(run) || {});
  appendChronicle(run, entry);
}

function logCombatEnd(enemies, { result, gold = 0, xp = 0, boss = false } = {}) {
  const entry = {
    t: 'combatEnd',
    boss: !!boss,
    result,
    gold,
    xp,
    enemies: (enemies || []).map(e => e.name || e.id || '?'),
  };
  if (boss) Object.assign(entry, powerChronicleFields(run) || {});
  appendChronicle(run, entry);
}

/** Midboss / boss gate checkpoint for the balance log. */
function logBossPowerCheck(boss, { gate = true } = {}) {
  const fields = powerChronicleFields(run);
  if (!fields) return;
  appendChronicle(run, {
    t: 'power',
    gate: !!gate,
    title: boss?.name || `Floor ${run.floor} boss`,
    ...fields,
  });
}

/* ---------- combat encounter card (Fight / Sneak / Bribe) ---------- */
/** Budget-aware encounter plan (bodies first; leftover → mild HP pad). */
function pickEnemyPlan(rng, biome, partySize = 1) {
  const depth = run.floor - biome.floors[0];
  let pool = [...(ENEMIES[biome.id] || ENEMIES.hell)];
  // Wandering trash can appear in any biome.
  if (WANDERING_ENEMIES?.length && rng.chance(0.38)) {
    const wander = depth < 4
      ? WANDERING_ENEMIES.filter(e => !e.elite)
      : WANDERING_ENEMIES;
    if (wander.length) pool = pool.concat(wander);
  }
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

  appendChronicle(run, {
    t: 'event', id: 'encounter', title: 'Hostiles Ahead',
    category: 'combat', type: 'encounter',
    enemies: group.map(g => g.name),
  });

  stage.querySelectorAll('[data-act]').forEach(btn => btn.onclick = async () => {
    SFX.click();
    const act = btn.dataset.act;
    const rng2 = runRng(run);
    appendChronicle(run, {
      t: 'choice', eventId: 'encounter', title: 'Hostiles Ahead',
      label: act === 'fight' ? 'Fight' : act === 'bribe' ? 'Bribe them' : 'Sneak past',
    });
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
      ], [], { title: 'Hostiles Ahead', choice: 'Bribe them', source: 'encounter' });
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
      ], ups, { title: 'Hostiles Ahead', choice: 'Sneak past', source: 'encounter' });
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

async function fightGroup(stage, specs, {
  text = null, modifier = null, prebuilt = null, reward = null, hpMult = 1, resume = null,
} = {}) {
  Music.play('battle');
  const biome = biomeForFloor(run.floor);
  const rng = runRng(run);
  const mult = (modifier?.hpMult || 1) * (hpMult || 1);
  let enemies = prebuilt || specs.map(s => buildEnemy(s, run.floor, biome.floors[0], { hpMult: mult }));
  if (!resume && modifier?.extraEnemy) {
    const extra = modifier.extraEnemy === true ? 1 : modifier.extraEnemy;
    for (let i = 0; i < extra; i++) {
      enemies.push(buildEnemy(runRng(run).pick(ENEMIES[biome.id].filter(e => !e.elite)), run.floor, biome.floors[0], { hpMult: mult }));
    }
  }
  // Resume mid-fight: restore HP/status onto the same enemy list.
  if (resume?.enemies?.length && prebuilt) {
    enemies = resume.enemies.map(e => ({ ...e, statuses: { ...(e.statuses || {}) } }));
  }
  if (!coopS) {
    setPending('combat', {
      enemies: enemies.map(e => ({ ...e, statuses: { ...(e.statuses || {}) } })),
      modifier, text, reward, hpMult,
    });
  }
  sheetCombatLock = true; renderHud();
  logCombatStart(enemies, { intro: text });
  const { result, gold = 0, xp = 0, noDamage, usedUltimate } = await startCombat({
    container: stage, run, rng, enemies, modifier, introText: text,
    onHud: renderHud,
    ...runOverlayUi(),
    resume,
  });
  logCombatEnd(enemies, { result, gold, xp });
  clearPending();
  sheetCombatLock = false; renderHud();
  if (result === 'win') { if (noDamage) unlock('untouchable'); if (usedUltimate) unlock('overcharged'); }

  if (result === 'dead') {
    // Co-op: fall down and revive next floor (~30% HP/resource). Solo still ends.
    if (coopS && !coopS.alone) {
      run.down = true;
      saveRun(run);
      coopS.broadcastStatus(statusOf(run, 'waiting'), 'waiting');
      return showOutcomePanel(stage, [{
        text: 'The tower takes you — almost. Your companions refuse to let it finish the job. You will rise on the next floor, battered.',
        cls: 'bad',
      }], [], { source: 'combat', title: 'Defeat' });
    }
    return endRun('dead');
  }
  if (result === 'fled') {
    saveRun(run);
    return showOutcomePanel(stage, [{ text: 'You live to climb another floor. The tower notes your pragmatism.', cls: 'good' }], [], {
      source: 'combat', title: 'Fled', choice: 'Flee',
    });
  }

  await afterVictory(stage, enemies, gold, xp, { reward });
}

async function afterVictory(stage, enemies, gold, xp, { boss = null, reward = null } = {}) {
  run.kills += enemies.length;
  run.gold += gold;
  run.goldEarned += gold;
  unlock('first_blood');
  if (run.gold >= 500) unlock('rich');
  if (enemies.some(e => e.id === 'mimic')) {
    unlock('mimic');
    if (run.hp / run.maxHp < 0.3) unlock('mimic_survivor');
  }
  if (enemies.some(e => NPC_DUELS.has(e.id))) unlock('npc_duelist');
  if (coopS && !coopS.alone && coopS.partySize >= 3) unlock('party_clear_3');

  const lines = [{ text: `Victory! +${gold} gold, +${xp} XP`, cls: 'gold' }];

  // No free victory heal — HP stays a resource (relics / potions / skills only).
  const vh = CONFIG.recovery.victoryHealPct
    ? heal(run, run.maxHp * CONFIG.recovery.victoryHealPct)
    : 0;
  if (vh > 0) lines.push({ text: `You bind your wounds in the quiet after. (+${vh} HP)`, cls: 'good' });
  const victoryHeal = relicItems(run).find(r => r.victoryHeal);
  if (victoryHeal) {
    const amt = heal(run, run.maxHp * victoryHeal.victoryHeal);
    if (amt) lines.push({ text: `${victoryHeal.name} hums — you recover ${amt} HP.`, cls: 'good' });
  }
  const fameRelic = relicItems(run).find(r => r.fameOnVictory);
  if (fameRelic) { changeFame(run, fameRelic.fameOnVictory); lines.push({ text: 'Your lantern carries the tale. (+Fame)', cls: 'good' }); }
  if (boss) {
    noteBossCleared(run, run.floor, boss.name);
    heal(run, run.maxHp * CONFIG.recovery.bossVictoryHealPct);
    run.mp = run.maxMp;
    changeFame(run, 6);
    lines.push({ text: 'The gate\'s blessing washes over you — wounds knit, strength returns, and the tower learns your name. (+Fame)', cls: 'good' });
    for (const msg of applySkillBreakpoints(run)) lines.push({ text: msg.text, cls: msg.cls || 'good' });
    logBossPowerCheck(boss, { gate: false });
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
  // §16: exclusive spoils from an optional NPC duel — techniques cost gold here
  const rewardUps = reward ? (await grantReward(reward, lines, { paySkills: true })) || [] : [];
  saveRun(run);
  await showOutcomePanel(stage, lines, [...ups, ...rewardUps], {
    ...(boss ? { continueLabel: 'Claim your prize', advance: false } : {}),
    source: 'combat',
    title: boss ? boss.name : 'Victory',
    choice: boss ? 'Boss cleared' : 'Victory',
  });
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

async function grantReward(reward, lines, { paySkills = false } = {}) {
  if (!reward) return;
  const rng = runRng(run);
  if (reward.gold) { run.gold += reward.gold; run.goldEarned += reward.gold; lines.push({ text: `+${reward.gold} gold`, cls: 'gold' }); }
  if (reward.fame) { const a = changeFame(run, reward.fame); lines.push({ text: `+${a} Fame`, cls: 'good' }); }
  let ups = [];
  if (reward.xp) {
    ups = gainXp(run, reward.xp, rng);
    lines.push({ text: `+${reward.xp} XP`, cls: 'good' });
  }
  if (reward.uniqueItem) {
    const u = rollUnique(rng, run, { preferUseful: true });
    if (u) await offerEquipment(u, lines);
    else lines.push({ text: 'The UNIQUE prize has already been claimed by another climber.', cls: 'bad' });
  }
  if (reward.wrldItem) await grantWrldFind(lines, typeof reward.wrldItem === 'object' ? reward.wrldItem : {});
  if (reward.guaranteed?.length) {
    const total = reward.guaranteed.reduce((s, g) => s + (g.weight || 1), 0);
    let roll = rng.next() * total;
    let pick = reward.guaranteed[0];
    for (const g of reward.guaranteed) { roll -= (g.weight || 1); if (roll <= 0) { pick = g; break; } }
    await applyRewardOption(pick, lines);
    if (pick.kind === 'item' && itemById(pick.id)?.rarity === 'unique') unlock('unique_gear');
    if (pick.kind === 'item' && ['legendary', 'unique', 'wrld'].includes(itemById(pick.id)?.rarity)) unlock('legendary');
  }
  if (reward.bonusChance && reward.bonus?.length && rng.chance(reward.bonusChance)) {
    const bonus = rng.pick(reward.bonus);
    if (bonus.kind === 'relic') {
      const r = rollRelic(rng, run.relics);
      if (r) { run.relics.push(r.id); lines.push({ text: `Bonus relic: ${r.name}`, cls: 'item' }); SFX.unlock(); }
    } else {
      lines.push({ text: 'Something extra loosens from the fight…', cls: 'item' });
      await applyRewardOption(bonus, lines);
    }
  }
  if (reward.farmerLoot) {
    const gold = rng.int(3, 12);
    run.gold += gold; run.goldEarned += gold;
    lines.push({ text: `A few coins from the trough: +${gold} gold`, cls: 'gold' });
    const plain = ['farm_bread', 'farm_cheese', 'farm_stew'];
    const n = rng.int(1, 3);
    for (let i = 0; i < n; i++) {
      const id = rng.pick(plain);
      run.consumables.push(id);
      lines.push({ text: `Received: ${itemById(id).name}`, cls: 'item' });
    }
    if (rng.chance(0.4)) {
      const loot = rng.pick(['farmer_hat', 'farmer_tunic', 'farmer_pants', 'farmer_sickle', 'farmer_pitchfork', 'farmer_rake', 'harvest_swing']);
      if (SKILLS[loot]) await applyRewardOption({ kind: 'skill', id: loot }, lines);
      else await applyRewardOption({ kind: 'item', id: loot }, lines);
    }
  }
  if (reward.npcDuelLoot) {
    const classes = Array.isArray(reward.npcDuelLoot)
      ? reward.npcDuelLoot
      : (reward.npcDuelLoot.classes || []);
    const item = npcDuelLoot(rng, run, {
      classes,
      coop: coopS,
      floor: run.floor,
    });
    if (item) {
      lines.push({ text: 'A climber\'s spoils — hard-won.', cls: 'item' });
      await offerEquipment(item, lines);
      if (item.rarity === 'unique') unlock('unique_gear');
      if (['legendary', 'unique', 'wrld'].includes(item.rarity)) unlock('legendary');
    } else {
      lines.push({ text: 'Their pack is empty — the tower already claimed the prize.', cls: 'bad' });
    }
  }
  if (reward.options?.length) {
    let chosen = reward.options[0];
    // Combat spoils: techniques carry an acquisition fee by tier — the tower
    // teaches nothing for free. Items and relics stay plain spoils.
    const skillCost = op => {
      if (!paySkills || (op.kind !== 'skill' && !op.skill)) return 0;
      const sk = SKILLS[op.kind === 'skill' ? op.id : op.skill];
      return sk ? (CONFIG.skillReward?.costByTier?.[sk.tier || 1] ?? 0) : 0;
    };
    const anyAffordable = reward.options.some(op => skillCost(op) <= run.gold);
    const affordable = reward.options.filter(op => skillCost(op) <= run.gold);
    if (isAutoPlay() && (affordable.length || reward.options.length)) {
      const pool = affordable.length ? affordable : reward.options;
      chosen = pool.reduce((best, op) => {
        const score = op.kind === 'skill' || op.skill
          ? skillAutoScore(SKILLS[op.kind === 'skill' ? op.id : op.skill])
          : gearScore(itemById(op.id));
        const bestScore = best.kind === 'skill' || best.skill
          ? skillAutoScore(SKILLS[best.kind === 'skill' ? best.id : best.skill])
          : gearScore(itemById(best.id));
        return score > bestScore ? op : best;
      }, pool[0]);
    } else {
      await modalCustom((m, close) => {
        m.innerHTML = `<h3>Spoils</h3><p class="modal-sub">${reward.chooseLabel || 'Take one:'}</p>
          <div class="pick-grid">${reward.options.map((op, i) => {
            const nm = op.kind === 'skill' ? SKILLS[op.id]?.name : itemById(op.id)?.name;
            const desc = op.kind === 'skill' ? SKILLS[op.id]?.desc : itemById(op.id)?.desc;
            const cost = skillCost(op);
            const short = anyAffordable && cost > run.gold;
            return `<button class="pick-option" data-i="${i}" ${short ? 'disabled' : ''}>
              <span class="po-tag tag">${rewardOptionTag(op)}${cost ? ` · ${cost}g` : ''}</span>
              <div class="po-name">${nm || op.id}</div>
              <div class="po-desc">${desc || ''}${cost ? `<br/><span style="color:var(--gold-bright)">Learning fee: ${cost} gold${short ? ' — beyond your purse' : ''}.</span>` : ''}</div></button>`;
          }).join('')}</div>`;
        m.querySelectorAll('[data-i]:not([disabled])').forEach(b => b.onclick = () => { chosen = reward.options[+b.dataset.i]; close(); });
      });
    }
    const fee = Math.min(skillCost(chosen), run.gold);
    if (fee > 0) {
      run.gold -= fee;
      lines.push({ text: `Technique learning fee: -${fee} gold`, cls: 'bad' });
    }
    await applyRewardOption(chosen, lines);
  } else if (!reward.guaranteed && !reward.farmerLoot && !reward.npcDuelLoot) {
    await applyRewardOption(reward, lines);
  }
  rng.advance();
  renderHud();
  return ups;
}

async function bossRelicPick(stage) {
  const rng2 = runRng(run);
  const choices = [rollRelic(rng2, run.relics), rollRelic(rng2, run.relics), rollRelic(rng2, run.relics)]
    .filter((r, i, a) => r && a.findIndex(x => x && x.id === r.id) === i);
  rng2.advance();
  saveRun(run);
  if (choices.length) {
    const takeRelic = (r) => {
      run.relics.push(r.id);
      SFX.unlock();
      toast(`Relic claimed: ${r.name}`, 'info');
      saveRun(run);
    };
    if (isAutoPlay()) {
      takeRelic(choices.reduce((a, b) => (gearScore(b) > gearScore(a) ? b : a), choices[0]));
    } else {
      await modalCustom((m, close) => {
        m.innerHTML = `<h3>The Gate Opens</h3><p class="modal-sub">Something glitters in the hoard. Choose one relic.</p>
          <div class="pick-grid">${choices.map((r, i) => `
            <button class="pick-option" data-i="${i}">
              <span class="po-tag tag ${rarityClass(r.rarity)}">${r.rarity}</span>
              <div class="po-name">${r.name}</div><div class="po-desc">${r.desc}</div>
            </button>`).join('')}
          </div>`;
        m.querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
          takeRelic(choices[+b.dataset.i]);
          close();
        });
      });
    }
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

async function bossFloor(stage, { resume = null } = {}) {
  const rngPick = runRng(run);
  const boss = resume?.bossId ? (bossById(resume.bossId) || pickBossForFloor(run.floor, rngPick, run))
    : pickBossForFloor(run.floor, rngPick, run);
  if (!resume) rngPick.advance();
  if (!resume?.enemies?.length) {
    setPending('boss', { bossId: boss.id });
    saveRun(run);
    logBossPowerCheck(boss, { gate: true });
  } else {
    return fightGroupBoss(stage, resume.enemies, boss, { resume });
  }
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
    const escortAtk = CONFIG.boss.escortAtkMult ?? 0.55;
    const enemies = plan.specs.map((s, i) => {
      const isBoss = i === 0 || !!s.boss;
      return buildEnemy(
        // Escorts share the boss floor (depth 0); hit softer than open-floor trash.
        s, run.floor, run.floor,
        { boss: isBoss, hpMult: plan.hpMult, atkMult: isBoss ? 1 : escortAtk },
      );
    });
    await fightGroupBoss(stage, enemies, boss);
  };
}

async function fightGroupBoss(stage, enemies, boss, { resume = null } = {}) {
  Music.play('boss');
  const rng = runRng(run);
  let foes = enemies;
  if (resume?.enemies?.length) {
    foes = resume.enemies.map(e => ({ ...e, statuses: { ...(e.statuses || {}) } }));
  }
  if (!coopS) {
    setPending('combat', {
      enemies: foes.map(e => ({ ...e, statuses: { ...(e.statuses || {}) } })),
      bossId: boss.id,
      text: `${boss.name}: "${boss.taunt}"`,
      modifier: null,
    });
  }
  sheetCombatLock = true; renderHud();
  logCombatStart(foes, { boss: true, intro: `${boss.name}: "${boss.taunt}"` });
  const { result, gold = 0, xp = 0, noDamage, usedUltimate } = await startCombat({
    container: stage, run, rng, enemies: foes,
    introText: `${boss.name}: "${boss.taunt}"`,
    onHud: renderHud,
    ...runOverlayUi(),
    resume,
  });
  logCombatEnd(foes, { result, gold, xp, boss: true });
  clearPending();
  sheetCombatLock = false; renderHud();
  if (result === 'dead') return endRun('dead');
  if (noDamage) unlock('untouchable');
  if (usedUltimate) unlock('overcharged');

  const achMap = { 10: 'floor_10', 15: 'floor_15', 20: 'floor_20', 30: 'floor_30', 40: 'floor_40', 50: 'floor_50' };
  if (achMap[run.floor]) unlock(achMap[run.floor]);
  if (run.floor === LAST_FLOOR) return victoryScreen('win');

  await afterVictory(stage, foes, gold, xp, { boss });
}

/* ============================================================
   CO-OP FLOOR FLOW
   ============================================================ */
/** Build live enemies from specs + residual budget HP mult (not party-size HP). */
function buildPartyEnemies(specs, hpMult = 1) {
  const biome = biomeForFloor(run.floor);
  const partySize = coopS?.partySize || 1;
  const trashAtk = partyTrashAtkMult(partySize, run.floor);
  return specs.map(s => buildEnemy(s, run.floor, biome.floors[0], {
    hpMult, atkMult: trashAtk, partySize,
  }));
}

function buildSharedEnemies(specs, { boss = false, hpMult = 1, partySize = coopS?.partySize || 1 } = {}) {
  const biome = biomeForFloor(run.floor);
  const bossAtk = boss ? partyBossAtkMult(partySize, run.floor) : 1;
  const bossHp = boss ? partyBossHpMult(partySize, run.floor) : 1;
  const trashAtk = partyTrashAtkMult(partySize, run.floor);
  // Escorts use escortAtkMult only — trashAtk pad already hits open-floor packs.
  const escortAtk = CONFIG.boss.escortAtkMult ?? 0.55;
  return specs.map((s, i) => {
    const isBoss = boss && (i === 0 || !!s.boss);
    return buildEnemy(
      s, run.floor,
      // Boss escorts: depth 0 at this floor (same as solo bossFloor builder).
      boss ? run.floor : biome.floors[0],
      {
        boss: isBoss,
        hpMult: hpMult * (isBoss ? bossHp : 1),
        atkMult: isBoss ? bossAtk : (boss ? escortAtk : trashAtk),
        partySize,
      },
    );
  });
}

function isSpecialEventFoe(s) {
  if (!s?.id) return false;
  if (s.id === 'mimic') return true;
  return !!(NPC_ENEMIES[s.id] && !String(s.id).startsWith('farmer_'));
}

/** Mimic / non-farmer NPC duel enemies — TDC.eventFight pads (farmers stay weak). */
function buildEventFightEnemies(specs, { partySize = 1, hpMult = 1 } = {}) {
  const biome = biomeForFloor(run.floor);
  const special = specs.some(isSpecialEventFoe);
  const evHp = special ? eventFightHpMult(partySize) : 1;
  const evAtk = special ? eventFightAtkMult(partySize) : 1;
  const trashAtk = special ? 1 : partyTrashAtkMult(partySize, run.floor);
  return specs.map(s => {
    const isBoss = !!s.boss;
    return buildEnemy(s, run.floor, biome.floors[0], {
      boss: isBoss,
      hpMult: (hpMult || 1) * evHp * (isBoss ? partyBossHpMult(partySize, run.floor) : 1),
      atkMult: (special ? evAtk : trashAtk)
        * (isBoss && !s.eliteAtkRole ? partyBossAtkMult(partySize, run.floor) : 1),
      partySize,
    });
  });
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
      enemies: buildSharedEnemies(plan.specs, { boss: true, hpMult: plan.hpMult, partySize: coopS.partySize }),
    };
  } else if (run.floor % 5 === 0) {
    const mod = rng.pick(MODIFIERS);
    const plan = pickEnemyPlan(rng, biome, coopS.partySize);
    const specs = [...plan.specs];
    if (mod.extraEnemy) {
      const extra = mod.extraEnemy === true ? 1 : mod.extraEnemy;
      const pool = (ENEMIES[biome.id] || ENEMIES.hell).filter(e => !e.elite);
      for (let i = 0; i < extra; i++) specs.push(rng.pick(pool));
    }
    content = { floor: run.floor, type: 'trial', modId: mod.id, enemies: buildSharedEnemies(specs, { hpMult: plan.hpMult * (mod.hpMult || 1) }) };
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

  // Seed picks that arrived before this UI mounted (dual auto race).
  for (const [id, idx] of coopS.picksFor?.(floor) || []) {
    if (id === coopS.you) continue;
    remotePicks.set(id, idx);
  }

  let afkTimer = null;
  const finish = (idx, spinFrom = null) => {
    if (resolved) return;
    resolved = true;
    clearTimeout(afkTimer);
    for (const off of offs) off();
    api?.lock(idx, spinFrom?.length > 1 ? { spinFrom } : {});
  };

  offs.push(coopS.net.on('pick', (d, from) => {
    if (d.floor !== floor || resolved) return;
    remotePicks.set(from, d.idx);
    api?.picks.set(from, d.idx);
    api?.renderVotes();
    if (mode === 'first' && coopS.isHost) {
      // host arbitrates first-selection: first pick it learns about wins
      if (coopS.publishCardResult(floor, d.idx)) finish(d.idx);
    } else if (mode === 'majority' && coopS.isHost) {
      hostTallyIfComplete();
    }
  }));
  offs.push(coopS.net.on('cardresult', d => {
    if (d.floor !== floor) return;
    finish(d.idx, Array.isArray(d.tied) ? d.tied : null);
  }));

  const collectVotes = () =>
    new Map([...remotePicks, ...(api?.picks.has(coopS.you) ? [[coopS.you, api.picks.get(coopS.you)]] : [])]);

  // tally; ties resolved randomly, synchronized via broadcast (handoff §3)
  function hostTally(all) {
    if (!all.size || resolved) return;
    const counts = {};
    for (const idx of all.values()) counts[idx] = (counts[idx] || 0) + 1;
    const max = Math.max(...Object.values(counts));
    const tied = Object.keys(counts).filter(k => counts[k] === max).map(Number);
    const rng = runRng(run);
    const winner = tied.length === 1 ? tied[0] : rng.pick(tied);
    rng.advance();
    const extra = tied.length > 1 ? { tied } : {};
    if (coopS.publishCardResult(floor, winner, extra)) finish(winner, tied.length > 1 ? tied : null);
  }

  function hostTallyIfComplete() {
    const all = collectVotes();
    if (all.size < coopS.partySize) return;
    hostTally(all);
  }

  // AFK guard (host): once the timer runs out, resolve with whatever votes are
  // in — as long as at least half the active party has spoken.
  const armAfk = ms => {
    clearTimeout(afkTimer);
    afkTimer = setTimeout(() => {
      if (resolved) return;
      const all = collectVotes();
      if (all.size >= Math.max(1, Math.ceil(coopS.partySize / 2))) hostTally(all);
      else armAfk(CONFIG.afk?.voteRecheckMs || 15000);
    }, ms);
  };
  if (coopS.isHost && mode === 'majority') armAfk(CONFIG.afk?.voteMs || 60000);

  renderTravelMap(stage, cards, {
    mode,
    bind(a) {
      api = a;
      // Paint buffered remote votes into the live UI.
      for (const [id, idx] of remotePicks) api.picks.set(id, idx);
      api.renderVotes();
    },
    onLocalPick(idx) {
      if (resolved) return;
      if (mode === 'first') {
        if (coopS.isHost) {
          if (coopS.publishCardResult(floor, idx)) finish(idx);
        }
        // guests wait for the host's cardresult (their pick may still win the race)
      } else if (coopS.isHost) {
        hostTallyIfComplete();
      }
    },
  }, travelCtx());

  // Host: if picks were already buffered before UI mounted, resolve now.
  if (coopS.isHost && !resolved) {
    if (mode === 'first') {
      const first = coopS.firstBufferedPick?.(floor);
      if (first && coopS.publishCardResult(floor, first.idx)) finish(first.idx);
    } else {
      hostTallyIfComplete();
    }
  }
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
  if (boss) {
    SFX.bossIntro();
    logBossPowerCheck(boss, { gate: true });
  } else {
    SFX.cardDeal();
  }

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

async function coopFightShared(stage, enemies, { boss = null, mod = null, reward = null, introText = null } = {}) {
  Music.play(boss ? 'boss' : 'battle');
  coopS.broadcastStatus(statusOf(run, 'fighting'), 'fighting');
  const rng = runRng(run);
  sheetCombatLock = true; renderHud();
  const intro = introText || (boss ? `${boss.name}: "${boss.taunt}"` : 'Side by side, blades out.');
  logCombatStart(enemies, { boss: !!boss, intro });
  const { result, gold = 0, xp = 0, noDamage, usedUltimate } = await startCombat({
    container: stage, run, rng, enemies,
    modifier: mod ? { ...mod, goldMult: (mod.goldMult || 1) * 1.5 } : null,
    introText: intro,
    onHud: renderHud, ...runOverlayUi(),
    coop: coopS,
  });
  logCombatEnd(enemies, { result, gold, xp, boss: !!boss });
  sheetCombatLock = false; renderHud();

  if (result === 'wipe') return endRun('dead');
  if (noDamage) unlock('untouchable');
  if (usedUltimate) unlock('overcharged');

  const d = derived(run);
  const goldGain = Math.round(gold * d.goldMult * d.combatGoldMult);
  const xpGain = Math.round(xp * d.xpMult);

  if (boss) {
    const achMap = { 10: 'floor_10', 15: 'floor_15', 20: 'floor_20', 30: 'floor_30', 40: 'floor_40', 50: 'floor_50' };
    if (achMap[run.floor]) unlock(achMap[run.floor]);
    if (run.floor === LAST_FLOOR) return victoryScreen('win');
  }
  await afterVictory(stage, enemies, goldGain, xpGain, { boss, reward });
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

/** Walk an outcome tree for combat / mimic-risk chests. */
function outcomeHasCombat(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 8) return false;
  if (o.combat) return true;
  if (o.chest && !o.safeMimic) return true;
  if (o.success && outcomeHasCombat(o.success, depth + 1)) return true;
  if (o.fail && outcomeHasCombat(o.fail, depth + 1)) return true;
  if (Array.isArray(o.randomOutcome) && o.randomOutcome.some(x => outcomeHasCombat(x, depth + 1))) return true;
  if (o.roll && (outcomeHasCombat(o.success, depth + 1) || outcomeHasCombat(o.fail, depth + 1))) return true;
  return false;
}

function eventHasCombatPath(ev) {
  if (!ev) return false;
  return (ev.choices || []).some(c => outcomeHasCombat(c.outcome));
}

function eventChoicesForRender(ev) {
  const choices = [...(ev.choices || [])];
  if (choices.length && choices.every(c => !reqMet(c.req).ok)) {
    choices.push({
      label: 'Move on',
      hint: 'leave empty-handed',
      outcome: { text: 'Nothing here is for you today. The path continues whether the tower likes it or not.' },
    });
  }
  return choices;
}

function renderEventCard(stage, ev, { originIntro = false } = {}) {
  if (ev.shop) return shopScreen(stage, ev);
  if (ev.type === 'rest') Music.play('rest');
  else if (MINIGAME_EVENTS.includes(ev.id)) Music.play('minigame');

  appendChronicle(run, {
    t: 'event',
    id: ev.id,
    title: ev.title,
    category: ev.category,
    type: originIntro ? 'origin' : (ev.type || 'event'),
  });

  // Combat-capable events in co-op: party votes on the choice (majority / first-pick).
  if (coopS && !coopS.alone && !originIntro && eventHasCombatPath(ev)) {
    return coopEventChoice(stage, ev);
  }

  // An event with a face shows the face; everything else keeps the category emblem.
  const npcArt = npcArtUrl(ev.npc);
  const evArt = npcArt || eventCatUrl(ev.category);
  stage.innerHTML = `
    <div class="card-stage"><div class="panel event-card">
      <div class="card-art">
        <div class="ev-center">${evArt
          ? `<img class="ev-emblem${npcArt ? ' ev-npc' : ''}" src="${evArt}" alt=""><span class="ev-glyph-mini">${ev.glyph}</span>`
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
  const choices = eventChoicesForRender(ev);
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

/** Party vote on a combat-capable event's choices (mirrors coopCardChoice). */
function coopEventChoice(stage, ev) {
  const mode = coopS.decisionMode || 'majority';
  const floor = run.floor;
  const eventId = ev.id;
  const resultKey = `${floor}:${eventId}`;
  const choices = eventChoicesForRender(ev);
  const remotePicks = new Map();
  let localIdx = null;
  let resolved = false;
  const offs = [];
  let afkTimer = null;

  // Seed picks that arrived before this UI mounted (dual auto race).
  for (const [id, idx] of coopS.evPicksFor?.(floor, eventId) || []) {
    if (id === coopS.you) continue;
    remotePicks.set(id, idx);
  }
  const bufferedLocal = coopS.evPicksFor?.(floor, eventId)?.get(coopS.you);
  if (bufferedLocal != null) localIdx = bufferedLocal;

  const npcArt = npcArtUrl(ev.npc);
  const evArt = npcArt || eventCatUrl(ev.category);
  stage.innerHTML = `
    <div class="card-stage"><div class="panel event-card">
      <div class="card-art">
        <div class="ev-center">${evArt
          ? `<img class="ev-emblem${npcArt ? ' ev-npc' : ''}" src="${evArt}" alt=""><span class="ev-glyph-mini">${ev.glyph}</span>`
          : `<div class="card-glyph">${ev.glyph}</div>`}</div>
        <span class="tag card-type-tag">${TYPE_LABEL[ev.type] || 'EVENT'}</span>
        <span class="tag card-floor-tag">FLOOR ${run.floor}</span>
      </div>
      <div class="card-body">
        <h3>${ev.title}</h3>
        <div class="card-text">${ev.text}</div>
        <div class="modifier-banner" style="margin-bottom:10px;border-color:var(--teal);color:var(--teal)">Party vote — ${mode === 'first' ? 'first pick wins' : 'majority decides'}</div>
        <div class="card-choices" id="choices"></div>
        <div id="ev-vote-status" class="dbg-dim" style="margin-top:8px;text-align:center"></div>
      </div>
    </div></div>`;
  applyCardBg(stage);
  SFX.cardDeal();

  const box = document.getElementById('choices');
  const statusEl = () => document.getElementById('ev-vote-status');
  const voteChips = (idx) => {
    const names = [];
    if (localIdx === idx) names.push('You');
    for (const [id, v] of remotePicks) {
      if (v === idx) names.push(coopS.partners.get(id)?.name || 'ally');
    }
    return names.length
      ? `<div class="ev-vote-chips">${names.map(n => `<span class="tag" style="color:var(--teal)">${n}</span>`).join(' ')}</div>`
      : '';
  };

  const renderVotes = () => {
    box.querySelectorAll('[data-ev-idx]').forEach(btn => {
      const idx = +btn.dataset.evIdx;
      let chip = btn.querySelector('.ev-vote-chips');
      if (chip) chip.remove();
      const html = voteChips(idx);
      if (html) btn.insertAdjacentHTML('beforeend', html);
    });
    const n = (localIdx != null ? 1 : 0) + remotePicks.size;
    if (statusEl()) statusEl().textContent = resolved ? '' : `Votes ${n}/${coopS.partySize}`;
  };

  const finish = (idx) => {
    if (resolved) return;
    resolved = true;
    clearTimeout(afkTimer);
    for (const off of offs) off();
    box.querySelectorAll('button').forEach(b => { b.disabled = true; });
    if (statusEl()) statusEl().textContent = 'The party has chosen…';
    const choice = choices[idx];
    setTimeout(() => resolveChoice(stage, ev, choice, { partyVoted: true }), 450);
  };

  // Already decided while loading
  if (coopS.eventResults?.has(resultKey)) {
    finish(coopS.eventResults.get(resultKey));
    return;
  }

  const collectVotes = () => {
    const all = new Map(remotePicks);
    if (localIdx != null) all.set(coopS.you, localIdx);
    return all;
  };

  function hostTally(all) {
    if (!all.size || resolved) return;
    const counts = {};
    for (const idx of all.values()) counts[idx] = (counts[idx] || 0) + 1;
    const max = Math.max(...Object.values(counts));
    const tied = Object.keys(counts).filter(k => counts[k] === max).map(Number);
    const rng = runRng(run);
    const winner = tied.length === 1 ? tied[0] : rng.pick(tied);
    rng.advance();
    const extra = tied.length > 1 ? { tied } : {};
    if (coopS.publishEvResult(floor, eventId, winner, extra)) finish(winner);
  }

  function hostTallyIfComplete() {
    const all = collectVotes();
    if (all.size < coopS.partySize) return;
    hostTally(all);
  }

  const armAfk = ms => {
    clearTimeout(afkTimer);
    afkTimer = setTimeout(() => {
      if (resolved) return;
      const all = collectVotes();
      if (all.size >= Math.max(1, Math.ceil(coopS.partySize / 2))) hostTally(all);
      else armAfk(CONFIG.afk?.voteRecheckMs || 15000);
    }, ms);
  };
  if (coopS.isHost && mode === 'majority') armAfk(CONFIG.afk?.voteMs || 60000);

  offs.push(coopS.net.on('evpick', (d, from) => {
    if (d.floor !== floor || d.eventId !== eventId || resolved) return;
    remotePicks.set(from, d.idx);
    renderVotes();
    if (mode === 'first' && coopS.isHost) {
      if (coopS.publishEvResult(floor, eventId, d.idx)) finish(d.idx);
    } else if (mode === 'majority' && coopS.isHost) {
      hostTallyIfComplete();
    }
  }));
  offs.push(coopS.net.on('evresult', d => {
    if (d.floor !== floor || d.eventId !== eventId) return;
    finish(d.idx);
  }));

  choices.forEach((choice, idx) => {
    const r = reqMet(choice.req);
    const btn = el(`<button class="choice-btn ${r.ok ? '' : 'locked'}" data-ev-idx="${idx}" ${r.ok ? '' : 'disabled'}>
      <span class="choice-label">${choice.label}</span>
      <span class="choice-hint ${choice.req ? 'choice-req' : ''}">${r.ok ? (choice.hint || '') : `🔒 ${r.why}`}</span>
    </button>`);
    btn.onclick = () => {
      if (resolved || localIdx != null || !r.ok) return;
      SFX.click();
      localIdx = idx;
      if (coopS.emitEvPick) coopS.emitEvPick(floor, eventId, idx);
      else coopS.net.send({ k: 'evpick', floor, eventId, idx });
      renderVotes();
      if (mode === 'first') {
        if (coopS.isHost) {
          if (coopS.publishEvResult(floor, eventId, idx)) finish(idx);
        }
      } else if (coopS.isHost) {
        hostTallyIfComplete();
      }
    };
    box.appendChild(btn);
  });
  renderVotes();

  // Host: if picks were already buffered before UI mounted, resolve now.
  if (coopS.isHost && !resolved) {
    if (mode === 'first') {
      const first = coopS.firstBufferedEvPick?.(floor, eventId);
      if (first && coopS.publishEvResult(floor, eventId, first.idx)) finish(first.idx);
    } else {
      hostTallyIfComplete();
    }
  }
}

/** Shared co-op fight for event/mimic combat (host publishes enemy package). */
async function coopEventFight(stage, ev, specs, { text = null, reward = null, hpMult = 1 } = {}) {
  const floor = run.floor;
  const eventId = ev?.id || 'event';
  const gateTag = `evfight-${floor}-${eventId}`;
  const partySize = coopS.partySize;

  const runShared = async (enemies, fightReward) => {
    await coopS.gate(gateTag);
    return coopFightShared(stage, rehydrateEnemies(enemies), {
      reward: fightReward || reward,
      introText: text || 'Side by side, blades out.',
    });
  };

  if (coopS.isHost) {
    const enemies = buildEventFightEnemies(specs, { partySize, hpMult });
    coopS.net.send({ k: 'evfight', floor, eventId, enemies, text, reward });
    if (text) toast(text, 'sys');
    return runShared(enemies, reward);
  }

  const data = await coopS.waitEvFight(floor, eventId);
  return runShared(data.enemies, data.reward);
}

async function resolveChoice(stage, ev, choice, opts = {}) {
  const rng = runRng(run);
  const sparkle = !!run.eventSparkle;
  let outcome = applyTagOutcomeMods(choice.outcome, ev, run);
  if (sparkle) outcome = applySparkleOutcomeMods(outcome, { floor: run.floor, rng });
  appendChronicle(run, {
    t: 'choice',
    eventId: ev?.id,
    title: ev?.title,
    label: choice.label,
    sparkle,
  });
  const nextOpts = { ...opts, choiceLabel: choice.label, sparkle };

  if (outcome.roll) {
    const d = derived(run);
    const spec = outcome.roll;
    let bonus = Math.floor(d.lk / 4);
    if (spec.bonusFlag && run.flags[spec.bonusFlag.flag]) bonus += spec.bonusFlag.bonus;
    if (spec.penaltyFlag && run.flags[spec.penaltyFlag.flag]) bonus -= spec.penaltyFlag.penalty;
    let die;
    let total;
    let ok;
    // Party-voted events: host rolls once so both clients share success/fail.
    if (opts.partyVoted && coopS && !coopS.alone) {
      if (coopS.isHost) {
        die = rng.int(1, 8);
        total = d[spec.stat] + die + bonus;
        ok = total >= spec.dc;
        coopS.net.send({
          k: 'evresolve', floor: run.floor, eventId: ev.id,
          kind: 'roll', ok, die, total,
        });
      } else {
        const data = await coopS.waitEvResolve(run.floor, ev.id);
        ok = !!data?.ok;
        die = data?.die;
        total = data?.total;
        rng.advance(); // keep runRng aligned with host's int(1,8)
      }
    } else {
      die = rng.int(1, 8);
      total = d[spec.stat] + die + bonus;
      ok = total >= spec.dc;
    }
    // the roll's drama, without the actuarial tables (handoff §5)
    const rollLine = { text: `${({ str: 'Strength', dex: 'Agility', int: 'Intellect', wis: 'Wisdom', lk: 'Luck' }[spec.stat])} is tested… ${ok ? 'and holds. SUCCESS.' : 'and falters. FAILURE.'}`, cls: ok ? 'good' : 'bad' };
    outcome = applyTagOutcomeMods(ok ? outcome.success : outcome.fail, ev, run);
    if (sparkle) outcome = applySparkleOutcomeMods(outcome, { floor: run.floor, rng });
    await applyOutcome(stage, ev, outcome, rng, [rollLine], nextOpts);
  } else {
    await applyOutcome(stage, ev, outcome, rng, [], nextOpts);
  }
}

async function applyOutcome(stage, ev, o, rng, lines, opts = {}) {
  const d = derived(run);
  const sparkle = !!(opts.sparkle || run.eventSparkle);
  const panelOpts = {
    eventId: ev?.id,
    title: ev?.title,
    choice: opts.choiceLabel,
    source: 'event',
  };

  if (o.randomOutcome) {
    // random-roll resolution: the tower picks (handoff §3)
    // Party-voted: host picks the wedge once so both clients share the branch.
    if (opts.partyVoted && coopS && !coopS.alone) {
      if (coopS.isHost) {
        const idx = rng.int(0, o.randomOutcome.length - 1);
        o = o.randomOutcome[idx];
        coopS.net.send({
          k: 'evresolve', floor: run.floor, eventId: ev.id,
          kind: 'random', idx,
        });
      } else {
        const data = await coopS.waitEvResolve(run.floor, ev.id);
        const idx = data?.idx ?? 0;
        o = o.randomOutcome[Math.max(0, Math.min(o.randomOutcome.length - 1, idx))];
        rng.advance(); // match host's int
      }
    } else {
      o = rng.pick(o.randomOutcome);
    }
    if (sparkle) o = applySparkleOutcomeMods(o, { floor: run.floor, rng });
    lines.push({ text: 'The tower decides…', cls: 'item' });
  }

  if (o.escape) return victoryScreen('escape');

  if (sparkle) {
    lines.push({ text: '✦ The path shimmered — fortune leans your way.', cls: 'item' });
  }
  if (o.text) lines.push({ text: o.text, cls: '' });

  if (o.chest) {
    let isMimic = false;
    if (!o.safeMimic && !relicItems(run).some(r => r.noMimic)) {
      if (coopS && !coopS.alone) {
        // Host rolls mimic once so the party shares the same chest fate.
        // Guests use a buffered wait — a bare once() races and freezes the climb.
        if (coopS.isHost) {
          isMimic = rng.chance(ev.mimicChance || 0.25);
          coopS.net.send({ k: 'chestroll', floor: run.floor, eventId: ev.id, mimic: isMimic });
        } else {
          const data = await coopS.waitChestRoll(run.floor, ev.id);
          isMimic = !!data?.mimic;
        }
      } else {
        isMimic = rng.chance(ev.mimicChance || 0.25);
      }
    }
    if (isMimic) {
      rng.advance(); saveRun(run);
      const mimic = mimicSpec(run.floor);
      if (coopS && !coopS.alone) {
        if (lines.length) {
          await showOutcomePanel(stage, lines, [], {
            ...panelOpts, continueLabel: 'Steel yourself', advance: false,
          });
        }
        return coopEventFight(stage, ev, [mimic], { text: 'The chest grows TEETH. Of course it does.' });
      }
      const foes = buildEventFightEnemies([mimic], { partySize: 1 });
      return fightGroup(stage, [mimic], {
        text: 'The chest grows TEETH. Of course it does.',
        prebuilt: foes,
      });
    }
    const sparkleGold = sparkle ? (CONFIG.events.sparkle?.goldMult || 1.65) : 1;
    const gold = Math.round((30 + run.floor * 4 + rng.int(0, 25)) * d.goldMult * sparkleGold);
    run.gold += gold; run.goldEarned += gold;
    lines.push({ text: `The chest is honest for once. +${gold} gold`, cls: 'gold' });
    SFX.gold();
    const chestFindChance = sparkle ? 0.55 : 0.35;
    if (rng.chance(chestFindChance)) {
      const luck = Math.floor(d.lk / 3) + (sparkle ? (o._sparkleLuck || 5) : 0);
      const item = rollEquipment(rng, biomeTier(), luck, {
        floor: run.floor, run,
        rarityBump: sparkle && !!o._sparkleRarityBump,
      });
      await offerEquipment(item, lines);
    } else if (rng.chance(sparkle ? 0.45 : 0.3)) {
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
  if (o.fullHeal) {
    const miss = Math.max(0, run.maxHp - run.hp);
    const amt = heal(run, Math.round(miss * (CONFIG.recovery.eventFullHealMissingPct ?? 0.4)));
    lines.push({ text: amt ? `Wounds ease (+${amt} HP).` : 'You are already whole.', cls: 'good' });
    if (amt) SFX.heal();
  }
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
    grantClassWeightedStats(run, rng, o.statUpRandom, { biasChance: 0.7 });
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
    const stat = pickClassWeightedStat(run, rng, { biasChance: 0.85 });
    run.stats[stat] += amt;
    lines.push({ text: 'A surge of growth takes root — stronger for how far you\'ve climbed.', cls: 'good' });
    SFX.levelup();
  }
  // Fame events that don't already grant stats: +1 class-weighted point
  // (bigger fame moments can grant 2). Keeps early climbs from stalling on gear alone.
  const hadStatGrant = !!(o.statUp || o.statUpRandom || o.statUpMain || o.statUpScaled);
  if (!hadStatGrant && (o.fame || 0) > 0) {
    const n = (o.fame >= 5 || (o.fame >= 3 && run.floor <= 12)) ? 2 : 1;
    grantClassWeightedStats(run, rng, n, { biasChance: 0.75 });
    lines.push({
      text: n > 1
        ? 'Your name carries weight — and so do your limbs.'
        : 'Something in you grows stronger.',
      cls: 'good',
    });
    SFX.levelup();
  }

  if (o.appraisal) {
    const wasHidden = !run.growthRevealed;
    appraiseRun(rng, run, { partial: o.appraisal === 'partial', location: ev.title });
    unlock('assessed');
    lines.push({ text: '📜 The reading is complete. Your character page now carries the appraisal.', cls: 'item' });
    if (wasHidden && run.growthRevealed) {
      lines.push({ text: `✦ Growth potential revealed: ${run.growthRank}`, cls: 'good' });
    }
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
      rarityBump: !!(spec.rarityBump || (sparkle && o._sparkleRarityBump)),
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
    const luck = Math.floor(d.lk / 3) + 1 + (sparkle ? (o._sparkleLuck || 5) : 0);
    const item = rollEquipment(rng, Math.max(biomeTier(), 2), luck, {
      floor: run.floor, run, classId: run.classId,
      requireUseful: true, usefulBias: 10,
      slot: wantWeapon ? 'weapon' : (rng.chance(0.5) ? 'accessory' : null),
      rarityBump: sparkle && !!o._sparkleRarityBump,
    });
    if (item) await offerEquipment(item, lines);
  }
  if (o.item) {
    const item = resolveItem(run, o.item) || itemById(o.item);
    if (item.slot) await offerEquipment(item, lines);
    else { run.consumables.push(item.id); lines.push({ text: `Received: ${item.name}`, cls: 'item' }); }
  }
  if (o.relicRoll) {
    const r = rollRelic(rng, run.relics, Math.floor(d.lk / 3) + (sparkle ? (o._sparkleLuck || 5) : 0));
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

  if (o.reward) {
    const rewardUps = (await grantReward(o.reward, lines)) || [];
    ups.push(...rewardUps);
  }

  if (o.enchantedFood) {
    const [lo, hi] = Array.isArray(o.enchantedFood) ? o.enchantedFood : [1, 3];
    const n = rng.int(lo, hi);
    const foods = CONSUMABLES.filter(c => c.foodBuff);
    for (let i = 0; i < n; i++) {
      const c = rng.pick(foods);
      run.consumables.push(c.id);
      lines.push({ text: `Received: ${c.name}`, cls: 'item' });
    }
  }

  if (o.combat) {
    const biome = biomeForFloor(run.floor);
    let enemyIds = o.combat.enemies || [];
    if (o.combat.pickEnemies) {
      const pe = o.combat.pickEnemies;
      const [cLo, cHi] = pe.count || [1, 1];
      // Co-op: host picks the pack (party-scaled count) and everyone fights it.
      if (coopS && !coopS.alone) {
        if (coopS.isHost) {
          let n = rng.int(cLo, cHi);
          if (pe.partyExtra) n += Math.max(0, (coopS.partySize - 1) * (pe.partyExtra || 0));
          enemyIds = [];
          for (let i = 0; i < n; i++) enemyIds.push(rng.pick(pe.pool));
          coopS.net.send({ k: 'evenemies', floor: run.floor, eventId: ev.id, enemyIds });
        } else {
          const data = await coopS.waitEvEnemies(run.floor, ev.id);
          enemyIds = data?.enemyIds || [];
        }
      } else {
        const n = rng.int(cLo, cHi);
        enemyIds = [];
        for (let i = 0; i < n; i++) enemyIds.push(rng.pick(pe.pool));
      }
    }
    let specs = enemyIds.map(id => findEnemySpec(id) || ENEMIES[biome.id][0]);
    const partySize = (coopS && !coopS.alone) ? coopS.partySize : 1;
    // Duo+: soft escort on solo NPC duels after the first gate (roadside already packs two).
    if (partySize >= 2 && specs.length === 1 && (run.floor || 1) >= 12) {
      const id = specs[0]?.id || '';
      if (/^(blade_hero|dark_mage|pathfinder_veteran|axe_northman|oldman_gentle|oldman_wrath|evil_wizard|evil_wizard_3|archer_hero|samurai|rogue_hero|tr_live_wizard|fantasy_warrior|huntress|huntress_2|martial_hero|martial_hero_2|martial_hero_3)$/.test(id)) {
        const escort = NPC_ENEMIES.roadside_npc2 || ENEMIES[biome.id]?.[0];
        if (escort) specs = [specs[0], { ...escort, hp: Math.round((escort.hp || 40) * 0.7), atk: Math.round((escort.atk || 10) * 0.85) }];
      }
    }
    const fightReward = o.combat.reward || o.combat.xp ? { ...(o.combat.reward || {}) } : null;
    if (fightReward && o.combat.xp) fightReward.xp = (fightReward.xp || 0) + o.combat.xp;
    rng.advance();
    saveRun(run);
    if (lines.length) {
      await showOutcomePanel(stage, lines, ups, {
        ...panelOpts, continueLabel: 'Steel yourself', advance: false,
      });
    }
    if (coopS && !coopS.alone) {
      return coopEventFight(stage, ev, specs, { text: o.combat.text, reward: fightReward });
    }
    const foes = buildEventFightEnemies(specs, { partySize: 1 });
    return fightGroup(stage, specs, { text: o.combat.text, reward: fightReward, prebuilt: foes });
  }

  rng.advance();
  saveRun(run);
  renderHud();
  if (coopS) coopS.broadcastStatus(statusOf(run, 'choosing'), 'choosing');

  if (o.coopTrade) {
    if (lines.length) {
      await showOutcomePanel(stage, lines, ups, {
        ...panelOpts, continueLabel: 'Open the exchange', advance: false,
      });
    }
    const tradeLines = await runCoopTrade();
    lines.push(...tradeLines);
    saveRun(run);
    renderHud();
    if (coopS) coopS.broadcastStatus(statusOf(run, 'choosing'), 'choosing');
    return showOutcomePanel(stage, lines, ups, panelOpts);
  }

  if (run.hp <= 0) {
    if (coopS && !coopS.alone) {
      run.down = true;
      saveRun(run);
      coopS.broadcastStatus(statusOf(run, 'waiting'), 'waiting');
      lines.push({ text: 'The tower takes you — almost. Your companions refuse to let it finish the job.', cls: 'bad' });
      return showOutcomePanel(stage, lines, ups, panelOpts);
    }
    return endRun('dead');
  }

  // origin intros lead into floor 1 instead of "the next floor"
  if (opts.originIntro) {
    await showOutcomePanel(stage, lines, ups, {
      ...panelOpts, continueLabel: 'The tower awaits — Floor 1', advance: false,
    });
    return enterFloorScreen(true);
  }

  await showOutcomePanel(stage, lines, ups, panelOpts);
  run.eventSparkle = false;
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
  if (slot.startsWith('accessory')) return `ACCESSORY ${slot.slice(-1)}`;
  return String(slot).toUpperCase();
}

/** Short type tag for spoils / choice UI (mace, chestplate, accessory…). */
function itemKindLabel(item) {
  if (!item) return 'item';
  if (item.slot === 'weapon' && item.wtype) return item.wtype;
  if (item.slot === 'chest') return 'chestplate';
  if (item.slot === 'helmet') return 'helmet';
  if (item.slot === 'legs') return 'leggings';
  if (item.slot === 'boots') return 'boots';
  if (item.slot === 'accessory') return 'accessory';
  return item.slot || 'item';
}

function rewardOptionTag(op) {
  if (op.kind === 'skill' || op.skill) return 'technique';
  if (op.kind === 'relic' || op.relic) return 'relic';
  if (op.kind === 'item' || op.id) {
    const it = itemById(op.id);
    return itemKindLabel(it);
  }
  return op.kind || 'item';
}

function accessorySlots() {
  return ['accessory1', 'accessory2', 'accessory3'];
}

/** Weapon-compatibility check for a candidate item (handoff §20). */
function weaponFitsClass(item) {
  if (!item || item.slot !== 'weapon' || !item.wtype) return true;
  return allowedWeaponTypes(run).includes(item.wtype);
}

function equipItem(item, targetSlot = null) {
  const slot = targetSlot || slotFor(item);
  const oldId = run.equipment[slot];
  if (oldId) run.inventory.push(oldId);
  const bagIdx = run.inventory.indexOf(item.id);
  if (bagIdx > -1) run.inventory.splice(bagIdx, 1);
  run.equipment[slot] = item.id;
  if (slot === 'weapon' && !weaponFitsClass(item)) {
    toast(`⚠ ${item.name} fights your training — only Strike and Guard until you swap weapons.`, 'bad');
  }
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

/** Rough power score for auto-play loot decisions (testing). */
function gearScore(item) {
  if (!item) return -1;
  const rarity = { common: 1, uncommon: 2, rare: 3, epic: 4, legendary: 5, unique: 6, wrld: 7 };
  let s = (rarity[item.rarity] || 1) * 25 + (item.tier || 1) * 4;
  const weights = {
    atk: 3, def: 2.5, hp: 0.15, mp: 0.12, str: 2, dex: 2, int: 2, wis: 2,
    crit: 0.8, initiative: 2, dodge: 0.5,
  };
  for (const [k, w] of Object.entries(weights)) {
    if (typeof item[k] === 'number') s += item[k] * w;
  }
  for (const k of ['burn', 'freeze', 'poison', 'lifesteal', 'weaken', 'frail', 'tormented']) {
    if (typeof item[k] === 'number') s += item[k] * 30;
  }
  if (item.price) s += item.price * 0.01;
  return s;
}

function skillAutoScore(sk) {
  if (!sk) return -1;
  return (sk.tier || 1) * 12 + (sk.power || 0) * 0.55 + (sk.charge ? 6 : 0)
    + (sk.healPct || 0) * 45 + (sk.target === 'all' ? 8 : 0);
}

/** Auto-play: equip upgrades (incl. best accessory swap), sell junk. */
function autoPlayTakeEquipment(item, lines) {
  const sellPrice = Math.round((item.price || 20) * 0.6);
  const sellIt = () => {
    run.gold += sellPrice;
    run.goldEarned += sellPrice;
    if (run.gearBag && item.instanceId) delete run.gearBag[item.id];
    lines.push({ text: `Sold ${item.name} for ${sellPrice}g`, cls: 'gold' });
    SFX.gold();
  };

  if (item.slot === 'weapon' && !weaponFitsClass(item)) {
    sellIt();
    renderHud();
    return;
  }

  if (item.slot === 'accessory') {
    const slots = accessorySlots();
    const free = slots.find(s => !run.equipment[s]);
    if (free) {
      equipItem(item, free);
      lines.push({ text: `Equipped: ${item.name} (${slotLabel(free)})`, cls: 'item' });
    } else {
      let worstSlot = slots[0];
      let worst = Infinity;
      for (const s of slots) {
        const cur = run.equipment[s] ? resolveItem(run, run.equipment[s]) : null;
        const sc = gearScore(cur);
        if (sc < worst) { worst = sc; worstSlot = s; }
      }
      if (gearScore(item) > worst) {
        equipItem(item, worstSlot);
        lines.push({ text: `Equipped: ${item.name} (replaced ${slotLabel(worstSlot)})`, cls: 'item' });
      } else {
        sellIt();
      }
    }
    renderHud();
    return;
  }

  if (!item.slot) {
    run.inventory.push(item.id);
    lines.push({ text: `Stashed: ${item.name}`, cls: 'item' });
    renderHud();
    return;
  }

  const cur = run.equipment[item.slot] ? resolveItem(run, run.equipment[item.slot]) : null;
  if (!cur || gearScore(item) >= gearScore(cur) - 0.5) {
    equipItem(item, item.slot);
    lines.push({ text: `Equipped: ${item.name} (${slotLabel(item.slot)})`, cls: 'item' });
  } else {
    sellIt();
  }
  renderHud();
}

/** Ask which slot to fill/replace. Returns slot id, or null if cancelled. */
async function chooseEquipSlot(item) {
  const isAcc = item.slot === 'accessory';
  const slots = isAcc ? accessorySlots() : [item.slot];
  // Empty non-accessory slot — no choice needed
  if (!isAcc && !run.equipment[item.slot]) return item.slot;

  if (isAutoPlay()) {
    if (isAcc) {
      const free = slots.find(s => !run.equipment[s]);
      if (free) return free;
      let worstSlot = slots[0];
      let worst = Infinity;
      for (const s of slots) {
        const cur = run.equipment[s] ? resolveItem(run, run.equipment[s]) : null;
        const sc = gearScore(cur);
        if (sc < worst) { worst = sc; worstSlot = s; }
      }
      return gearScore(item) > worst ? worstSlot : null;
    }
    const cur = run.equipment[item.slot] ? resolveItem(run, run.equipment[item.slot]) : null;
    if (!cur || gearScore(item) >= gearScore(cur) - 0.5) return item.slot;
    return null;
  }

  return await new Promise(resolve => {
    modalCustom((m, close) => {
      const rows = slots.map(s => {
        const cur = run.equipment[s] ? resolveItem(run, run.equipment[s]) : null;
        return `<button class="pick-option" data-slot="${s}">
          <span class="po-name">${cur ? `Replace ${slotLabel(s)}` : `Equip to ${slotLabel(s)}`}</span>
          <span class="po-desc">${cur ? `${cur.name} → pack` : 'Empty slot'}</span>
          ${cur ? `<div class="po-desc" style="margin-top:4px;color:var(--ink)">${cur.desc}</div>` : ''}
        </button>`;
      }).join('');
      m.innerHTML = `<h3>Choose an ${isAcc ? 'accessory' : 'equip'} slot</h3>
        <p class="modal-sub">${item.name}${item.desc ? ` — ${item.desc}` : ''}</p>
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
  if (isAutoPlay()) {
    autoPlayTakeEquipment(item, lines);
    return;
  }
  const sellPrice = Math.round(item.price * 0.6);
  const isAcc = item.slot === 'accessory';
  const slots = isAcc ? accessorySlots() : [item.slot];

  const v = await new Promise(resolve => {
    modalCustom((m, close) => {
      const finish = (act, slot = null) => { close(); resolve({ act, slot }); };
      let slotBtns = '';
      let compareRight = '';
      if (isAcc) {
        // Clickable equipped cards on the right — replace any slot; Equip uses a free one.
        const freeSlot = slots.find(s => !run.equipment[s]) || null;
        const worn = slots.map(s => {
          const cur = run.equipment[s] ? resolveItem(run, run.equipment[s]) : null;
          const card = gearCard(cur, slotLabel(s));
          return `<button type="button" class="accessory-slot-pick" data-act="equip" data-slot="${s}" title="${cur ? `Replace ${cur.name}` : 'Equip here'}">${card}</button>`;
        }).join('');
        compareRight = `<div class="gear-card equipped accessory-compare">
          <div class="gc-label">ACCESSORIES</div>
          <div class="gc-desc" style="margin:0 0 8px">Click a worn piece to replace it. Replaced gear goes into your pack.</div>
          <div class="accessory-worn">${worn}</div>
        </div>`;
        slotBtns = freeSlot
          ? `<button class="pick-option loot-equip" data-act="equip" data-slot="${freeSlot}">
              <span class="po-name">Equip it</span>
              <span class="po-desc">Wear in empty ${slotLabel(freeSlot)}.</span>
            </button>`
          : `<button class="pick-option loot-equip" disabled aria-disabled="true">
              <span class="po-name">Equip it</span>
              <span class="po-desc">No free accessory slot — click a worn piece to replace, or stash it.</span>
            </button>`;
      } else {
        const s = item.slot;
        const cur = run.equipment[s] ? resolveItem(run, run.equipment[s]) : null;
        const misfit = !weaponFitsClass(item);
        slotBtns = `<button class="pick-option loot-equip" data-act="equip" data-slot="${s}">
          <span class="po-name">${cur ? 'Replace it' : 'Equip it'}${misfit ? ' ⚠' : ''}</span>
          <span class="po-desc">${misfit ? 'Incompatible with your training — only Strike and Guard while wielded.' : (cur ? `${cur.name} → pack` : '')}</span>
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
        <div class="pick-grid loot-actions">
          ${slotBtns}
          <button class="pick-option loot-stash" data-act="stash"><span class="po-name">Stash it</span><span class="po-desc">Keep it in your pack — swap anytime from the Character screen.</span></button>
          <button class="pick-option loot-sell" data-act="sell"><span class="po-name">Sell it — ${sellPrice}g</span></button>
        </div>`;
      m.querySelectorAll('[data-act]').forEach(b => {
        b.onclick = () => {
          if (b.disabled || b.getAttribute('aria-disabled') === 'true') return;
          finish(b.dataset.act, b.dataset.slot || null);
        };
      });
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
async function showOutcomePanel(stage, lines, ups = [], {
  continueLabel = 'Ascend to the next floor', advance = true,
  eventId = null, title = null, choice = null, source = 'event', chronicle = true,
} = {}) {
  if (chronicle && run && lines?.length) {
    appendChronicle(run, {
      t: 'outcome',
      eventId,
      title,
      choice,
      source,
      lines,
    });
  }
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
  await new Promise(r => {
    const btn = document.getElementById('continue');
    btn.onclick = () => {
      if (btn.disabled) return;
      btn.disabled = true; // sync — dual auto must not double-fire
      SFX.click();
      r();
    };
  });
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
  let advancing = false;
  document.getElementById('continue').onclick = async () => {
    if (advancing) return;
    advancing = true;
    const btn = document.getElementById('continue');
    btn.disabled = true;
    SFX.click();
    if (coopS) await coopAdvance(btn);
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
  if (!isAutoPlay()) {
    await modal(`
      <div class="levelup-burst">✨</div>
      <h3 style="text-align:center">Level ${up.level}!</h3>
      <p class="modal-sub" style="text-align:center">${LEVEL_FLAVOR[up.level % LEVEL_FLAVOR.length]}</p>
      <div class="pick-grid"><button class="pick-option" data-close="x" style="text-align:center"><span class="po-name">Continue</span></button></div>`);
  }

  // level 6: the subclass choice — secret options appear unannounced
  if (up.evolutionChoice?.length) {
    const applyEvo = async (sub) => {
      applySubclassFn(run, sub);
      if (sub.secret) { unlock('secret_class'); glitchScreen(1500); }
      SFX.evolve();
      if (isAutoPlay()) {
        if (sub.skill) await maybeEquipSkill(SKILLS[sub.skill]);
        saveRun(run);
        renderHud();
        return;
      }
      await modal(`
        <div class="levelup-burst">🌟</div>
        <h3 style="text-align:center">EVOLUTION — ${sub.name}!</h3>
        <p class="modal-sub" style="text-align:center">${sub.blurb}</p>
        ${sub.skill && SKILLS[sub.skill] ? `<div class="panel" style="padding:12px 14px;margin:12px 0;border:1px solid rgba(232,182,74,.35);text-align:left">${skillPickHtml(SKILLS[sub.skill])}</div>` : ''}
        <div class="pick-grid"><button class="pick-option" data-close="x" style="text-align:center"><span class="po-name">Rise</span></button></div>`);
      if (sub.skill) await maybeEquipSkill(SKILLS[sub.skill]);
      saveRun(run);
      renderHud();
    };
    if (isAutoPlay()) {
      const pool = up.evolutionChoice;
      await applyEvo(pool[Math.floor(Math.random() * pool.length)]);
    } else {
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
        m.querySelectorAll('[data-i]').forEach(b => b.onclick = async () => {
          close();
          await applyEvo(up.evolutionChoice[+b.dataset.i]);
        });
      });
    }
  }

  // level 13: the deeper branch arrives on its own
  if (up.deeper) {
    applySubclassFn(run, up.deeper);
    SFX.evolve();
    if (!isAutoPlay()) {
      await modal(`
        <div class="levelup-burst">🌟</div>
        <h3 style="text-align:center">EVOLUTION — ${up.deeper.name}!</h3>
        <p class="modal-sub" style="text-align:center">${up.deeper.blurb}</p>
        ${up.deeper.skill && SKILLS[up.deeper.skill] ? `<div class="panel" style="padding:12px 14px;margin:12px 0;border:1px solid rgba(232,182,74,.35);text-align:left">${skillPickHtml(SKILLS[up.deeper.skill])}</div>` : ''}
        <div class="pick-grid"><button class="pick-option" data-close="x" style="text-align:center"><span class="po-name">Rise</span></button></div>`);
    }
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
    if (isAutoPlay()) {
      const sk = pool.reduce((a, b) => (skillAutoScore(b) > skillAutoScore(a) ? b : a), pool[0]);
      run.knownSkills.push(sk.id);
      await maybeEquipSkill(sk);
      saveRun(run);
      return;
    }
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
  const cap = skillCapacity(run);
  if (run.skills.length < cap) {
    run.skills.push(sk.id);
    toast(`Learned ${sk.name} (${run.skills.length}/${cap} equipped)`, 'info');
  } else {
    await swapSkillModal(sk);
  }
}

async function swapSkillModal(newSkill) {
  const cap = skillCapacity(run);
  const openSlots = Math.max(0, cap - run.skills.length);
  if (isAutoPlay()) {
    if (openSlots > 0 && !run.skills.includes(newSkill.id)) {
      run.skills.push(newSkill.id);
      toast(`${newSkill.name} equipped`, 'info');
      return;
    }
    let worstI = 0;
    let worst = Infinity;
    run.skills.forEach((id, i) => {
      const sc = skillAutoScore(SKILLS[id]);
      if (sc < worst) { worst = sc; worstI = i; }
    });
    if (skillAutoScore(newSkill) > worst) {
      run.skills[worstI] = newSkill.id;
      toast(`${newSkill.name} equipped`, 'info');
    }
    return;
  }
  await modalCustom((m, close) => {
    m.innerHTML = `<h3>Equip ${newSkill.name}?</h3>
      <p class="modal-sub">You can carry ${cap} techniques into battle (plus Strike and Guard, always).
        ${openSlots ? ` You have <b>${openSlots}</b> open slot${openSlots > 1 ? 's' : ''}.` : ' Replace one, or keep it in reserve.'}</p>
      <div class="panel" style="padding:12px 14px;margin-bottom:12px;border:1px solid rgba(232,182,74,.35)">
        <div style="font-family:var(--font-display);font-size:12px;color:var(--gold-bright);margin-bottom:4px">NEW</div>
        ${skillPickHtml(newSkill)}
      </div>
      <div class="pick-grid">
        ${openSlots ? `<button class="pick-option" data-add="1">
          <div class="po-name">Add as new technique</div>
          <div class="po-desc">Fill an open slot (${run.skills.length + 1}/${cap}).</div>
        </button>` : ''}
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
    m.querySelector('[data-add]')?.addEventListener('click', () => {
      if (run.skills.length < skillCapacity(run) && !run.skills.includes(newSkill.id)) {
        run.skills.push(newSkill.id);
        toast(`${newSkill.name} equipped`, 'info');
      }
      close();
    });
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
async function shopScreen(stage, ev, { resumeStock = null } = {}) {
  Music.play('rest');
  const rng = runRng(run);
  const tier = biomeTier();
  let stock = [];
  if (resumeStock?.length) {
    stock = resumeStock;
  } else {
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
    rng.advance();
  }
  setPending('shop', { eventId: ev.id, stock });
  saveRun(run);

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

  shopRefreshHook = () => render();
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
          const wasHidden = !run.growthRevealed;
          appraiseRun(rng2, run, { partial: false, location: 'a merchant\'s scroll' });
          rng2.advance();
          toast(wasHidden
            ? `Growth potential: ${run.growthRank}. Check your Character page.`
            : 'The scroll reads you. Check your Character page.', 'info');
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
      setPending('shop', { eventId: ev.id, stock });
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
      shopRefreshHook = null;
      clearPending();
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

/** Optional hook so the shop can re-render after a pack sell (gold updates). */
let shopRefreshHook = null;

function characterSheet({ locked = false } = {}) {
  modalCustom((m, close) => {
    m.classList.add('sheet-modal');
    const prevClose = close;
    close = () => {
      prevClose();
      shopRefreshHook?.();
    };
    function render() {
      const eq = run.equipment;
      const compatible = weaponCompatible(run);
      const appr = run.appraisal;
      const lockNote = locked
        ? `<p class="modal-sub" style="color:var(--crit)">In combat — gear, pack swaps, and consumables are locked. Use ITEMS on your turn to drink potions.</p>`
        : `<p class="modal-sub">Floor ${run.floor} · ${run.kills} kills · Origin: ${run.originId ? originById(run.originId)?.name : 'Unknown'}</p>`;
      m.innerHTML = `
        <button type="button" class="sheet-close-x" id="sheet-close-x" title="Close" aria-label="Close">✕</button>
        <h3>${climberNameHtml(run.name, { title: meta.equippedTitle, nameStyle: meta.equippedNameStyle })} — Lv ${run.level} ${run.raceName} ${classTitle(run)}
          <button class="btn small ghost" id="sheet-look" title="Cycle your look — companions see it too">🎭 Look</button></h3>
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
              <tr><td>Growth potential</td><td>${run.growthRevealed ? `<b>${run.growthRank || appr?.growthRank || '?'}</b>` : '<span style="color:var(--ink-faint)">?</span>'}</td></tr>
              <tr><td>Overall (appraised)</td><td>${appr ? `<b>${appr.overall}</b>` : '<span style="color:var(--ink-faint)">?</span>'}</td></tr>
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
            <h4>Techniques (${run.skills.length}/${skillCapacity(run)} + Strike &amp; Guard)</h4>
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
            ${Array.from({ length: Math.max(0, skillCapacity(run) - run.skills.length) }, (_, i) => `
              <div class="inv-item empty-skill-slot"><div><div class="item-name" style="color:var(--ink-faint)">— open technique slot —</div>
                <div class="item-desc">Equip a technique from Reserve to fill this slot.</div></div>
                <span class="tag slot-tag">SLOT ${run.skills.length + i + 1}</span></div>`).join('')}
            ${!locked && run.knownSkills.filter(id => !run.skills.includes(id)).length ? `
              <h4 style="margin-top:12px">Reserve</h4>
              ${run.knownSkills.filter(id => !run.skills.includes(id)).map(id => {
                const s = SKILLS[id];
                const canAdd = run.skills.length < skillCapacity(run);
                return `
                <div class="inv-item"><div><div class="item-name">${s.name}</div>
                <div class="po-cost" style="margin:2px 0">${skillCostTip(s)} · ${skillEffectTip(s)}</div>
                <div class="item-desc">${s.desc}</div></div>
                <button class="btn small" data-swap="${id}">${canAdd ? 'Add' : 'Equip'}</button></div>`;
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
      m.querySelector('#sheet-close-x')?.addEventListener('click', () => close());
      // Cosmetic — allowed any time, mid-run and mid-party. Partners see the
      // new look through the regular status broadcast.
      m.querySelector('#sheet-look')?.addEventListener('click', () => {
        const skins = appearancesFor(run.classId) || [];
        if (skins.length < 2) { toast('Your calling has only one look.', 'sys'); return; }
        const i = Math.max(0, skins.findIndex(s => s.id === run.appearanceId));
        const next = skins[(i + 1) % skins.length];
        run.appearanceId = next.id;
        SFX.click(); saveRun(run); renderHud();
        if (coopS) {
          const act = sheetCombatLock ? 'fighting' : 'choosing';
          coopS.broadcastStatus(statusOf(run, act), act);
        }
        toast(`Look: ${next.name}`, 'info');
        render();
      });
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
        if (c.healPct) heal(run, Math.round(run.maxHp * c.healPct));
        if (c.mana) restoreMana(run, c.mana);
        if (c.fame) changeFame(run, c.fame);
        if (c.foodBuff) {
          run.foodBuff = { ...c.foodBuff, floorsLeft: c.foodBuff.floors || 3 };
          toast(`${c.name} fortifies you for ${run.foodBuff.floorsLeft} floors.`, 'good');
        }
        SFX.heal(); saveRun(run); renderHud(); render();
      });
      m.querySelectorAll('[data-swap]').forEach(b => b.onclick = async () => {
        const sk = SKILLS[b.dataset.swap];
        if (!sk) return;
        if (run.skills.length < skillCapacity(run) && !run.skills.includes(sk.id)) {
          run.skills.push(sk.id);
          toast(`${sk.name} equipped`, 'info');
          SFX.unlock?.();
          saveRun(run); renderHud(); render();
          return;
        }
        close();
        await swapSkillModal(sk);
        saveRun(run);
        characterSheet({ locked });
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
        shopRefreshHook?.();
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

  const throneFight = async (spec, hpMult) => {
    run.flags.throneBossId = spec.id;
    run.flags.throneBossName = spec.name;
    saveRun(run);
    if (coopS) {
      const enemies = buildSharedEnemies([spec], { boss: true, partySize: coopS.partySize });
      enemies.forEach(e => { e.maxHp = Math.round(e.maxHp * hpMult); e.hp = e.maxHp; });
      coopS.net.send({ k: 'throne', enemies, bossId: spec.id });
      await coopS.gate('fight-51');
      return coopFightShared(stage, rehydrateEnemies(enemies), { boss: spec });
    }
    const enemies = [buildEnemy(spec, run.floor, run.floor, { boss: true, hpMult })];
    fightGroupBoss(stage, enemies, spec);
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
      await modal(`<h3>Filed at Last</h3><p class="modal-sub">${boss.name} reads all nine pages. Twice. "He wants his kingdom back, an apology, and — " a squint, " — 'reasonable compensation for emotional distress.'" Laughter cracks the throne. The duel starts with them still winded.</p>
        <div class="pick-grid"><button class="pick-option" data-close="x"><span class="po-name">Draw your weapon</span></button></div>`);
      throneFight(boss, 0.85);
    });
  }
  addChoice(`<button class="choice-btn"><span class="choice-label">⚔ "I'm the interesting kind." — Fight</span><span class="choice-hint">the classic ending</span></button>`, () => throneFight(boss, 1));
  addChoice(`<button class="choice-btn"><span class="choice-label">🗣 Answer honestly: "I don't know yet."</span><span class="choice-hint">${run.flags.angel_lore || run.flags.tree_lore ? 'the crown slips' : 'risky honesty'}</span></button>`, async () => {
    await modal(`<h3>The Question</h3><p class="modal-sub">"Would you take this throne," ${boss.name} asks, "if it were offered?"<br/><br/>"I don't know yet," you say.<br/><br/>The figure on the throne <i>changes</i> — horns melt into a crooked crown, molten flesh into royal plate. Aldric, the Corrupt King, steps forward smiling wrong.<br/><br/>"Honest. Good. The Demon King was always a story we sold climbers. I am the kingdom. Let us settle the paperwork in blood."</p>
      <div class="pick-grid"><button class="pick-option" data-close="x"><span class="po-name">Face the true king</span></button></div>`);
    changeFame(run, 5);
    run.flags.corrupt_king_ending = true;
    renderHud();
    throneFight(SECRET_BOSS, 1);
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
  const corruptKing = !!run?.flags?.corrupt_king_ending;
  const throneName = run?.flags?.throneBossName || (corruptKing ? 'Aldric, the Corrupt King' : 'the throne\'s champion');
  const summary = run ? buildClimbSummary(run, type === 'win' ? 'win' : 'escape', runRng(run)) : null;
  if (summary) pushRunHistory(summary);
  const snap = summary || (run ? {
    name: run.name, raceName: run.raceName, floor: run.floor, kills: run.kills,
    level: run.level, fame: run.fame, title: classTitle(run),
  } : null);
  if (!wasCoop) teardownCoop();
  else {
    coopS.resetRunBuffers();
  }
  const shards = shardsFor(type === 'win' ? 'win' : 'escape');
  meta.shards += shards;
  if (type === 'win') {
    meta.wins++;
    unlock('win');
    if (!meta.endings.includes('win')) meta.endings.push('win');
    if (corruptKing && !meta.endings.includes('corrupt_king')) meta.endings.push('corrupt_king');
  }
  if (type === 'escape') { unlock('escape'); if (!meta.endings.includes('escape')) meta.endings.push('escape'); }
  saveMeta(meta);
  clearRun();
  if (run) run.over = true;

  const isWin = type === 'win';
  setBiomeGlow(isWin ? '#d9a53f' : '#5a9ec9');
  setParticles(isWin ? 'embers' : 'leaves');
  SFX.victory();
  if (summary) {
    await showClimbSummary(summary, { shards, wasCoop, myName, isWin });
  }
  const winEpitaph = corruptKing
    ? `${throneName} dies laughing — crown cracked, kingdom exposed. The "Demon King" was a mask sold to climbers; the throne was always a man\'s lie stacked fifty-one floors high.<br/><br/>You leave the crown on the stones. Outside, the realm learns it was never ruled by a demon — only by appetite in a nicer hat.<br/><br/>${snap?.name || 'A climber'} the ${snap?.raceName || ''} ${snap?.title || ''} ended the corrupt kingdom.`
    : `${throneName} falls to one knee, then both — and they are <i>smiling</i>. "The interesting kind after all." The tower shudders as its crown changes... no. You sheathe your weapon and walk past the throne without sitting down. Let the next century wonder why the top floor stands empty.<br/><br/>${snap?.name || 'A climber'} the ${snap?.raceName || ''} ${snap?.title || ''} conquered all fifty-one floors.`;
  showFinalEndScreen({
    wasCoop, myName, shards, isWin, snap,
    title: isWin ? (corruptKing ? 'THE MASK FALLS' : 'THE KING IS DEAD') : 'YOU WENT HOME',
    glyph: isWin ? '👑' : '🌀',
    epitaph: isWin
      ? winEpitaph
      : `The portal closes behind you, and the world is suddenly, absurdly ordinary: weather, birdsong, a road. You are alive. Every scar came home with you, and so did every story.<br/><br/>The tower still stands on the horizon. You don't look at it. Mostly.<br/><br/>${snap?.name || 'A climber'} the ${snap?.title || ''} survived ${snap?.floor || '?'} floors — and chose to keep living.`,
  });
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
  const deadRun = run;
  const summary = deadRun ? buildClimbSummary(deadRun, cause, runRng(deadRun)) : null;
  if (summary) pushRunHistory(summary);
  if (!wasCoop) teardownCoop();
  else {
    coopS.resetRunBuffers();
  }
  Music.stop(1.2);
  SFX.death();
  const shards = shardsFor(cause);
  meta.shards += shards;
  saveMeta(meta);
  clearRun();
  run = null;

  setBiomeGlow('#8a2f2f');
  const epitaph = EPITAPHS[cause] ? EPITAPHS[cause][Math.floor(Math.random() * EPITAPHS[cause].length)] : EPITAPHS.dead[0];
  if (summary) {
    await showClimbSummary(summary, { shards, wasCoop, myName, isWin: false });
  }
  showFinalEndScreen({
    wasCoop, myName, shards, isWin: false,
    snap: summary || deadRun,
    title: cause === 'abandon' ? 'THE CLIMB ENDS' : 'YOU DIED',
    glyph: '💀',
    epitaph: `${deadRun.name} the ${deadRun.raceName} ${deadRun.subclassId ? SUBCLASSES[deadRun.subclassId].name : CLASSES[deadRun.classId].name} — Floor ${deadRun.floor}, ${biomeForFloor(deadRun.floor).name}.<br/><br/>${epitaph}`,
    defeat: true,
  });
}

function showClimbSummary(summary, { shards, wasCoop, myName, isWin, fromHistory = false }) {
  const c = summary.climb || {};
  const st = summary.stats || {};
  const resultLabel = isWin ? 'VICTORY' : (summary.outcome === 'escape' ? 'ESCAPED' : 'DEFEAT');
  const resultClass = isWin ? 'victory' : 'defeat';
  const seedTxt = summary.seed != null ? ` · Seed ${String(summary.seed).slice(0, 8)}` : '';
  const classLabel = (summary.title || CLASSES[summary.classId]?.name || 'Climber').toUpperCase();
  const heroName = climberNameHtml(summary.name || 'Climber', {
    title: meta?.equippedTitle,
    nameStyle: meta?.equippedNameStyle,
  });
  const heroLine = summary.raceName
    ? `${heroName} <span class="cs-hero-race">the ${summary.raceName}</span>`
    : heroName;

  const bosses = (c.bossesCleared || []).map(b =>
    `<div class="cs-boss"><span class="cs-boss-f">F${b.floor}</span><span class="cs-boss-dot">·</span><span>${b.name}</span></div>`
  ).join('') || '<div class="cs-muted">No gatekeepers felled.</div>';

  const gear = (summary.equipment || []).map(it =>
    `<div class="cs-gear-card rarity-${it.rarity || 'common'}">
      <div class="cs-gear-main">
        <div class="item-name ${rarityClass(it.rarity)}">${it.name}</div>
        <div class="item-desc">${it.desc || ''}</div>
      </div>
      <span class="cs-slot-tag">${(it.wtype || it.slot || '').toUpperCase()}</span>
    </div>`
  ).join('') || '<div class="cs-muted">Traveling light.</div>';

  const tipEsc = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const tipCard = (name, desc, chipClass) => {
    const n = tipEsc(name);
    const d = tipEsc(desc);
    if (!desc) return `<span class="${chipClass}">${n}</span>`;
    return `<span class="cs-tip ${chipClass}" tabindex="0">
      <span class="cs-tip-label">${n}</span>
      <span class="cs-tip-card" role="tooltip">
        <span class="cs-tip-name">${n}</span>
        <span class="cs-tip-desc">${d}</span>
      </span>
    </span>`;
  };

  const techChips = (summary.skills || []).map(id => {
    const sk = SKILLS[id];
    return tipCard(sk?.name || id, sk?.desc || '', 'cs-tech-chip');
  }).join('') || '<span class="cs-muted">—</span>';

  const relicEntries = (summary.relics || []).map(r => {
    if (r && typeof r === 'object') return { name: r.name, desc: r.desc || '' };
    const found = RELICS.find(x => x.name === r || x.id === r);
    return { name: found?.name || r, desc: found?.desc || '' };
  });
  const relics = relicEntries.length
    ? relicEntries.map(r => tipCard(r.name, r.desc, 'relic-chip')).join('')
    : '<span class="cs-muted">None carried.</span>';

  const logEntries = c.chronicle || [];
  const logHtml = chronicleHtml(logEntries);

  return new Promise(resolve => {
    let page = 1;
    const pageCount = 3;
    app.innerHTML = '';
    app.appendChild(el(`
      <div class="screen climb-summary${fromHistory ? ' from-history' : ''}" id="climb-summary">
        ${fromHistory ? '<button type="button" class="btn small ghost cs-back" id="cs-back">← Title</button>' : ''}
        <header class="cs-header">
          <div class="cs-h-left">
            <div class="cs-class">${classLabel}</div>
            <div class="cs-meta">Lv ${summary.level}${seedTxt}</div>
          </div>
          <div class="cs-h-center">
            <div class="cs-banner ${resultClass}">${resultLabel}</div>
            <div class="cs-hero">${heroLine}</div>
            <div class="cs-sub" id="cs-sub">Floor ${summary.floor} · Overview</div>
          </div>
          <div class="cs-h-right">
            <div class="summary-rank-badge">${summary.overall || '?'} <span>class</span></div>
          </div>
        </header>

        <div class="cs-body">
          <div class="cs-page" id="cs-page-1">
            <div class="cs-overview">
              <div class="cs-col-left">
                ${statPentagonSvg(st, { size: 260 })}
                <div class="cs-stat-row">
                  <div><b>${st.str ?? '?'}</b>STR</div>
                  <div><b>${st.dex ?? '?'}</b>DEX</div>
                  <div><b>${st.int ?? '?'}</b>INT</div>
                  <div><b>${st.wis ?? '?'}</b>WIS</div>
                  <div><b>${st.lk ?? '?'}</b>LK</div>
                </div>
                <h4 class="cs-h4">Techniques</h4>
                <div class="cs-tech-row">${techChips}</div>
              </div>
              <div class="cs-col-right">
                <div class="cs-combat-row">
                  <div class="cs-stat dealt"><b>${c.damageDealt || 0}</b>dealt</div>
                  <div class="cs-stat taken"><b>${c.damageTaken || 0}</b>taken</div>
                  <div class="cs-stat healed"><b>${c.healed || 0}</b>healed</div>
                  <div class="cs-stat slain"><b>${summary.kills || 0}</b>slain</div>
                </div>
                <div class="cs-meta-line">
                  Buffs applied: ${c.buffsApplied || 0} · Debuffs applied: ${c.debuffsApplied || 0}<br/>
                  Fame ${summary.fame ?? 0} · Gold ${summary.gold ?? 0}
                </div>
                <h4 class="cs-h4">Bosses conquered</h4>
                <div class="cs-boss-list">${bosses}</div>
                <h4 class="cs-h4">Power curve</h4>
                <div class="cs-power-wrap">${powerGraphSvg(c.powerLog || [], { w: 420, h: 120 })}</div>
              </div>
            </div>
          </div>

          <div class="cs-page" id="cs-page-2" hidden>
            <h4 class="cs-h4">Gear</h4>
            <div class="cs-gear-grid">${gear}</div>
            <h4 class="cs-h4">Relics</h4>
            <div class="relic-row">${relics}</div>
            <div class="cs-shard-note">◈ <b>+${shards}</b> Soul Shards await on the next screen</div>
          </div>

          <div class="cs-page" id="cs-page-3" hidden>
            <h4 class="cs-h4">Balance log <span class="cs-log-count">${logEntries.length} entries</span></h4>
            <p class="cs-log-blurb">Event choices, gains/losses, and combat results for tuning.</p>
            <div class="cs-log-list">${logHtml}</div>
          </div>
        </div>

        <footer class="cs-footer">
          <div class="cs-f-left">
            <button class="btn" id="cs-left" type="button">Skip to ending</button>
          </div>
          <div class="cs-pager" aria-label="Pages">
            <span class="cs-dot active" data-p="1"></span>
            <span class="cs-dot" data-p="2"></span>
            <span class="cs-dot" data-p="3"></span>
          </div>
          <div class="cs-f-right">
            <button class="btn primary" id="cs-right" type="button">Gear ▸</button>
          </div>
        </footer>
      </div>`));

    const subEl = document.getElementById('cs-sub');
    const pages = [1, 2, 3].map(n => document.getElementById(`cs-page-${n}`));
    const leftBtn = document.getElementById('cs-left');
    const rightBtn = document.getElementById('cs-right');
    const dots = [...document.querySelectorAll('.cs-dot')];
    const done = () => { SFX.click(); resolve(); };
    const subs = {
      1: `Floor ${summary.floor} · Overview`,
      2: 'Gear & Relics',
      3: 'Balance log',
    };
    const rightLabels = {
      1: 'Gear ▸',
      2: 'Log ▸',
      3: fromHistory ? '← Title' : 'Continue ▸',
    };

    document.getElementById('cs-back')?.addEventListener('click', done);

    const paint = () => {
      pages.forEach((el, i) => { if (el) el.hidden = page !== i + 1; });
      subEl.textContent = subs[page] || '';
      leftBtn.textContent = page === 1
        ? (fromHistory ? '← Title' : 'Skip to ending')
        : '◂ Back';
      rightBtn.textContent = rightLabels[page] || 'Continue ▸';
      dots.forEach(d => d.classList.toggle('active', Number(d.dataset.p) === page));
    };

    leftBtn.onclick = () => {
      SFX.click();
      if (page === 1) resolve();
      else { page -= 1; paint(); }
    };
    rightBtn.onclick = () => {
      SFX.click();
      if (page < pageCount) { page += 1; paint(); }
      else resolve();
    };
    dots.forEach(d => {
      d.onclick = () => {
        const p = Number(d.dataset.p);
        if (p === page) return;
        SFX.click();
        page = p;
        paint();
      };
    });
    paint();
  });
}

function showFinalEndScreen({ wasCoop, myName, shards, isWin, snap, title, glyph, epitaph, defeat = false }) {
  app.innerHTML = '';
  app.appendChild(el(`
    <div class="screen end-screen">
      <div class="end-glyph">${glyph}</div>
      <h1 class="end-title ${defeat ? 'defeat' : 'victory'}">${title}</h1>
      <p class="end-epitaph">${epitaph}</p>
      <div class="end-stats">
        <div><b>${snap?.floor ?? '—'}</b>floors</div>
        <div><b>${snap?.kills ?? '—'}</b>slain</div>
        <div><b>${snap?.level ?? '—'}</b>level</div>
        <div><b>${snap?.fame ?? '—'}</b>fame</div>
      </div>
      <div class="shard-award">◈ <b>+${shards}</b> Soul Shards${defeat ? ' carried back to the Sanctum' : ' for the Sanctum'}</div>
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
  // Count every connected climber (roster), not partySize — eliminated players
  // are out of `partners` but still get a requeue vote from the end screen.
  const requeueNeeded = () => coopS?.net?.roster?.length || coopS?.partySize || 1;
  const updateStatus = () => {
    if (!coopS) return;
    const n = coopS.requeueVotes.size;
    const voted = coopS.requeueVotes.has(coopS.you);
    statusEl.textContent = n
      ? `Party climb votes: ${n}/${requeueNeeded()}${voted ? ' (you voted yes)' : ''} — everyone must agree.`
      : 'Propose a party climb — all climbers must accept.';
    if (voted) {
      partyBtn.disabled = true;
      partyBtn.textContent = 'Waiting for the party…';
    }
  };

  const tryEnterLobby = () => {
    if (!coopS || coopS.requeueVotes.size < requeueNeeded()) return false;
    coopS.onRequeue = null;
    toast('The party climbs again.', 'info');
    // Clear elim state + reopen public searchability on the relay.
    coopS.eliminated.clear();
    coopS._syncRoster?.();
    coopS.requeueVotes = new Set();
    coopS.net.send({ k: 'reopen' });
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
    const extra = a.title
      ? ` — title <span class="climber-title ${a.titleStyle || ''}">${a.title}</span>`
      : (a.nameStyle ? ' — name style unlocked' : '');
    toast(`${a.icon} Achievement: ${a.name}${extra}`, 'info');
    SFX.unlock();
  }
}
