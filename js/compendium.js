// Player Compendium: one representation per live catalog id.
// Pack-off omits pack rows. Legacy mirrors and internal records never appear.
// Undiscovered pack secrets render as ??? and must not leak names or ids.

import { isPackOn } from './content_pack/flags.js';
import {
  packEquipment, packRelicList, packConsumableList, packSkillMap, packEventList,
  liveEvents,
} from './content_pack/registry.js';
import { isCursedItem, isEvolvingItem, curseInfo, itemTraitTagsHtml } from './content_pack/curse.js';
import { ALL_EQUIPMENT, RELICS, CONSUMABLES } from './data/items.js';
import { SKILLS } from './data/skills.js';
import { EVENTS } from './data/events.js';
import { CLASSES } from './data/classes.js';
import { isDiscovered } from './compendium_seen.js';

export const SET_ID_PREFIX = 'set:';

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function rarityClass(r) { return `rarity-${r || 'common'}`; }

function catalogKind(item, fallback) {
  if (fallback) return fallback;
  if (item.slot) return 'equipment';
  if (item.heal != null || item.healPct != null || item.healPerFloor != null
    || item.bombDmg != null || item.mana != null || item.cure
    || item.shopMaxTier != null) {
    return 'consumable';
  }
  return 'relic';
}

function skillKind(sk) {
  if (sk.bloodline || sk.capability === 'bloodline_art') return 'art';
  return 'skill';
}

function itemTraits(item) {
  const acquisition = item.acquisition
    || (item.exclusive ? 'event' : 'ordinary');
  return {
    cursed: isCursedItem(item),
    evolving: isEvolvingItem(item),
    setId: item.setId || null,
    unique: !!(item.unique || item.rarity === 'unique'),
    wrld: !!(item.wrld || item.rarity === 'wrld'),
    eventLinked: acquisition === 'event' || !!item.quest,
    classBound: item.classBound || null,
    bloodline: item.resonance || item.bloodline || null,
    acquisition,
  };
}

function isInternalRecord(it) {
  if (!it) return true;
  if (it.legacyMirror || it.internal) return true;
  return false;
}

function pushUnique(out, seen, entry) {
  if (!entry?.id || seen.has(entry.id)) return;
  seen.add(entry.id);
  out.push(entry);
}

function equipmentEntry(item) {
  const traits = itemTraits(item);
  return {
    id: item.id,
    kind: 'equipment',
    name: item.name,
    desc: item.desc || '',
    rarity: item.rarity || 'common',
    slot: item.slot,
    wtype: item.wtype || null,
    pack: !!item.contentPack,
    secret: false,
    classId: traits.classBound,
    bloodline: traits.bloodline,
    ...traits,
    curse: item.curse || null,
    resolution: item.resolution || null,
    source: item,
  };
}

function relicEntry(item, kind) {
  const traits = itemTraits(item);
  return {
    id: item.id,
    kind,
    name: item.name,
    desc: item.desc || '',
    rarity: item.rarity || 'common',
    pack: !!item.contentPack,
    secret: false,
    classId: traits.classBound,
    bloodline: traits.bloodline,
    ...traits,
    curse: item.curse || null,
    resolution: item.resolution || null,
    source: item,
  };
}

function skillEntry(sk) {
  const kind = skillKind(sk);
  return {
    id: sk.id,
    kind,
    name: sk.name,
    desc: sk.desc || '',
    rarity: null,
    pack: !!sk.contentPack,
    secret: false,
    classId: sk.class && sk.class !== 'universal' ? sk.class : null,
    bloodline: sk.bloodline || null,
    cursed: false,
    evolving: false,
    setId: null,
    unique: false,
    wrld: false,
    eventLinked: false,
    classBound: sk.class && sk.class !== 'universal' ? sk.class : null,
    acquisition: kind === 'art' ? 'bloodline' : 'class',
    curse: null,
    resolution: null,
    source: sk,
  };
}

function eventEntry(ev) {
  const identity = (ev.choices || []).some(c => c.identity);
  return {
    id: ev.id,
    kind: 'event',
    name: ev.title,
    desc: ev.text || '',
    rarity: null,
    pack: !!ev.contentPack || !!ev.pack,
    secret: !!(ev.when?.classId && CLASSES[ev.when.classId]?.hidden),
    classId: ev.when?.classId || ev.affinity?.classes?.[0] || null,
    bloodline: ev.when?.raceId || ev.affinity?.races?.[0] || null,
    cursed: false,
    evolving: false,
    setId: null,
    unique: false,
    wrld: false,
    eventLinked: true,
    classBound: ev.when?.classId || null,
    acquisition: 'event',
    identity,
    curse: null,
    resolution: null,
    source: ev,
  };
}

function setTitle(setId, pieces) {
  const n = pieces[0]?.name || setId;
  return n.replace(/\s+(Helm|Cuirass|Greaves|Chest|Legs|Boots)$/i, '').trim() || setId;
}

function setEntries(equipment) {
  const bySet = new Map();
  for (const it of equipment) {
    if (!it.setId) continue;
    if (!bySet.has(it.setId)) bySet.set(it.setId, []);
    bySet.get(it.setId).push(it);
  }
  const out = [];
  for (const [setId, pieces] of bySet) {
    const classBound = pieces.find(p => p.classBound)?.classBound || null;
    out.push({
      id: SET_ID_PREFIX + setId,
      kind: 'set',
      name: setTitle(setId, pieces),
      desc: pieces[0]?.desc || `${pieces.length}-piece set.`,
      rarity: pieces[0]?.rarity || 'rare',
      pack: pieces.some(p => p.contentPack),
      secret: false,
      classId: classBound,
      bloodline: pieces.find(p => p.resonance)?.resonance || null,
      cursed: pieces.some(isCursedItem),
      evolving: pieces.some(isEvolvingItem),
      setId,
      unique: pieces.some(p => p.unique || p.rarity === 'unique'),
      wrld: false,
      eventLinked: pieces.some(p => p.acquisition === 'event' || p.quest),
      classBound,
      acquisition: 'class',
      pieceIds: pieces.map(p => p.id),
      curse: null,
      resolution: null,
      source: { setId, pieces },
    });
  }
  return out;
}

/**
 * Every enabled catalog row, plus one derived armor-set row per setId.
 * Legacy mirrors and internal records are omitted.
 */
export function catalogEntries({ packOn = isPackOn() } = {}) {
  const seen = new Set();
  const out = [];
  const equip = packOn ? ALL_EQUIPMENT.concat(packEquipment()) : ALL_EQUIPMENT.slice();
  const relics = packOn ? RELICS.concat(packRelicList()) : RELICS.slice();
  const cons = packOn ? CONSUMABLES.concat(packConsumableList()) : CONSUMABLES.slice();
  const skills = packOn
    ? { ...SKILLS, ...packSkillMap() }
    : { ...SKILLS };
  const events = packOn ? liveEvents(EVENTS) : EVENTS.slice();

  for (const it of equip) {
    if (isInternalRecord(it)) continue;
    pushUnique(out, seen, equipmentEntry(it));
  }
  for (const it of relics) {
    if (isInternalRecord(it)) continue;
    pushUnique(out, seen, relicEntry(it, catalogKind(it, 'relic')));
  }
  for (const it of cons) {
    if (isInternalRecord(it)) continue;
    pushUnique(out, seen, relicEntry(it, 'consumable'));
  }
  for (const sk of Object.values(skills)) {
    if (isInternalRecord(sk)) continue;
    pushUnique(out, seen, skillEntry(sk));
  }
  for (const ev of events) {
    if (isInternalRecord(ev)) continue;
    pushUnique(out, seen, eventEntry(ev));
  }
  for (const setEnt of setEntries(equip)) {
    pushUnique(out, seen, setEnt);
  }
  return out;
}

export function liveCatalogIds({ packOn = isPackOn() } = {}) {
  const ids = [];
  const add = list => {
    for (const it of list) if (it?.id) ids.push(it.id);
  };
  add(ALL_EQUIPMENT);
  add(RELICS);
  add(CONSUMABLES);
  add(Object.values(SKILLS));
  add(EVENTS);
  if (packOn) {
    add(packEquipment());
    add(packRelicList());
    add(packConsumableList());
    add(Object.values(packSkillMap()));
    add(packEventList());
  }
  return [...new Set(ids)];
}

export function coverageReport({ packOn = isPackOn() } = {}) {
  const entries = catalogEntries({ packOn });
  const byId = new Map();
  const duplicates = [];
  for (const e of entries) {
    if (byId.has(e.id)) duplicates.push(e.id);
    else byId.set(e.id, e);
  }
  const live = liveCatalogIds({ packOn });
  const liveSet = new Set(live);
  const missing = [];
  const seenLive = new Set();
  for (const id of live) {
    if (seenLive.has(id)) continue;
    seenLive.add(id);
    if (!byId.has(id)) missing.push(id);
  }
  const extra = [];
  for (const e of entries) {
    if (e.kind === 'set') continue;
    if (!liveSet.has(e.id)) extra.push(e.id);
  }
  const leakedLegacy = entries.filter(e => e.source?.legacyMirror || String(e.id).startsWith('legacy:'));
  return {
    entryCount: entries.length,
    liveCount: seenLive.size,
    duplicates,
    missing,
    extra,
    leakedLegacy: leakedLegacy.map(e => e.id),
  };
}

export function defaultFilters() {
  return {
    q: '',
    kind: 'all',
    trait: 'all',
    rarity: 'all',
    discovered: 'all',
  };
}

export function entryMatchesFilters(entry, filters = defaultFilters(), ctx = {}) {
  if (!entry) return false;
  if (filters.kind && filters.kind !== 'all' && entry.kind !== filters.kind) {
    if (!(filters.kind === 'skill' && entry.kind === 'art')) return false;
  }
  if (filters.rarity && filters.rarity !== 'all' && entry.rarity !== filters.rarity) return false;
  const disc = ctx.debug || isDiscovered(entry.id) || (!entry.pack && entry.kind !== 'event');
  if (filters.discovered === 'yes' && !disc) return false;
  if (filters.discovered === 'no' && disc) return false;
  switch (filters.trait) {
    case 'cursed': if (!entry.cursed) return false; break;
    case 'evolving': if (!entry.evolving) return false; break;
    case 'set': if (entry.kind !== 'set' && !entry.setId) return false; break;
    case 'unique': if (!entry.unique) return false; break;
    case 'wrld': if (!entry.wrld) return false; break;
    case 'event': if (!entry.eventLinked && entry.kind !== 'event') return false; break;
    case 'class': if (!entry.classBound && !entry.classId) return false; break;
    case 'bloodline': if (!entry.bloodline) return false; break;
    case 'ordinary': if (entry.acquisition !== 'ordinary') return false; break;
    default: break;
  }
  const q = String(filters.q || '').trim().toLowerCase();
  if (q) {
    const hay = `${entry.name} ${entry.desc} ${entry.id} ${entry.slot || ''} ${entry.curse || ''}`.toLowerCase();
    const revealed = ctx.debug || disc;
    if (!revealed) return false;
    if (!hay.includes(q)) return false;
  }
  return true;
}

function classUnlocked(classId, ctx) {
  if (!classId) return true;
  const cls = CLASSES[classId];
  if (!cls?.hidden) return true;
  if (ctx.debug) return true;
  if (typeof ctx.callingUnlocked === 'function') return !!ctx.callingUnlocked(cls);
  return !!(ctx.unlockedClasses || []).includes(classId);
}

function secretSkillBlocked(entry, ctx) {
  if (!ctx.secretSkillIds) return false;
  return ctx.secretSkillIds.has(entry.id);
}

/**
 * Whether the player-facing Compendium may mention this entry at all.
 * Hidden class/bloodline secrets stay omitted until unlocked or discovered.
 */
export function entryListed(entry, ctx = {}) {
  if (!entry) return false;
  if (ctx.debug) return true;
  if (secretSkillBlocked(entry, ctx)) return false;
  if (entry.kind === 'art' && entry.bloodline) {
    if (isDiscovered(entry.id)) return true;
    if ((ctx.knownBloodlines || []).includes(entry.bloodline)) return true;
    return false;
  }
  if (entry.classId && CLASSES[entry.classId]?.hidden) {
    if (isDiscovered(entry.id)) return true;
    return classUnlocked(entry.classId, ctx);
  }
  if (entry.secret && !isDiscovered(entry.id) && !classUnlocked(entry.classId, ctx)) {
    return false;
  }
  return true;
}

export function presentEntry(entry, ctx = {}) {
  if (!entry) return null;
  const debug = !!ctx.debug;
  const discovered = debug
    || isDiscovered(entry.id)
    || (!entry.pack && entry.kind !== 'event');
  if (!discovered) {
    return {
      id: entry.id,
      kind: entry.kind,
      discovered: false,
      name: '???',
      desc: 'Not yet encountered.',
      rarity: entry.kind === 'equipment' || entry.kind === 'relic' || entry.kind === 'consumable'
        ? entry.rarity
        : null,
      tags: [],
    };
  }
  const tags = [];
  if (entry.rarity) tags.push(entry.rarity);
  if (entry.cursed) tags.push('CURSED');
  if (entry.evolving) tags.push('EVOLVES');
  if (entry.setId && entry.kind !== 'set') tags.push('SET');
  if (entry.unique && entry.rarity !== 'unique') tags.push('unique');
  if (entry.wrld && entry.rarity !== 'wrld') tags.push('wrld');
  if (entry.kind === 'art') tags.push('bloodline art');
  if (entry.acquisition && entry.acquisition !== 'ordinary') tags.push(entry.acquisition);
  const info = entry.cursed || entry.evolving ? curseInfo(entry.source, ctx.run) : null;
  return {
    id: entry.id,
    kind: entry.kind,
    discovered: true,
    name: entry.name,
    desc: entry.desc,
    rarity: entry.rarity,
    tags,
    curse: info,
    source: entry.source,
    pieceIds: entry.pieceIds || null,
    identity: !!entry.identity,
  };
}

export function visibleEntries(ctx = {}, filters = defaultFilters()) {
  return catalogEntries({ packOn: ctx.packOn ?? isPackOn() })
    .filter(e => entryListed(e, ctx))
    .filter(e => entryMatchesFilters(e, filters, ctx));
}

function rowHtml(entry, ctx, iconHtml) {
  const view = presentEntry(entry, ctx);
  if (!view) return '';
  const icon = (view.discovered && iconHtml && entry.kind !== 'event' && entry.kind !== 'set' && entry.kind !== 'skill' && entry.kind !== 'art')
    ? iconHtml(entry.id)
    : '';
  const rarityTag = view.rarity
    ? `<span class="tag ${rarityClass(view.rarity)}">${esc(view.rarity)}</span>`
    : '';
  const extra = view.discovered
    ? `${itemTraitTagsHtml(entry.source || entry)}`
    : '';
  const curseBlock = view.discovered && view.curse?.cursed
    ? `<div class="dbg-dim">Drawback: ${esc(view.curse.drawback)}</div>
       ${view.curse.resolution ? `<div class="dbg-dim">Resolution: ${esc(view.curse.resolution)}</div>` : ''}
       ${view.curse.evolving ? `<div class="dbg-dim">Evolution ${view.curse.evolutionProgress || 0}${view.curse.resolved ? ' · resolved' : ''}</div>` : ''}`
    : (view.discovered && view.curse?.evolving
      ? `<div class="dbg-dim">Evolution ${view.curse.evolutionProgress || 0}</div>`
      : '');
  const pieces = view.discovered && view.pieceIds
    ? `<div class="dbg-dim">Pieces: ${view.pieceIds.map(esc).join(', ')}</div>`
    : '';
  const identityNote = view.discovered && view.identity && !ctx.debug
    ? '<div class="dbg-dim">Some paths depend on calling or bloodline.</div>'
    : '';
  const idChip = ctx.debug && view.discovered
    ? `<span class="dbg-dim">(${esc(entry.id)})</span>`
    : '';
  return `<div class="dbg-row" data-comp-id="${view.discovered ? esc(entry.id) : ''}" data-comp-kind="${esc(entry.kind)}">
    ${icon}<b class="${view.rarity ? rarityClass(view.rarity) : ''}">${esc(view.name)}</b>
    ${rarityTag}${extra}${idChip}
    <div class="dbg-dim">${esc(view.desc)}</div>
    ${curseBlock}${pieces}${identityNote}
  </div>`;
}

function groupHtml(title, entries, ctx, iconHtml) {
  if (!entries.length) return '';
  return `<div class="dbg-group"><h4>${esc(title)} <span class="dbg-dim">(${entries.length})</span></h4>
    ${entries.map(e => rowHtml(e, ctx, iconHtml)).join('')}</div>`;
}

export function renderFilterBar(filters = defaultFilters()) {
  const chip = (name, value, label) => {
    const on = filters[name] === value;
    return `<button type="button" class="btn small ${on ? 'primary' : ''}" data-comp-filter="${name}" data-comp-value="${value}">${label}</button>`;
  };
  return `<div class="dbg-filters">
    <input class="dbg-search" data-comp-search type="search" placeholder="Search discovered entries" value="${esc(filters.q)}" />
    <div class="dbg-filter-row">
      ${chip('trait', 'all', 'All traits')}
      ${chip('trait', 'cursed', 'Cursed')}
      ${chip('trait', 'evolving', 'Evolving')}
      ${chip('trait', 'set', 'Sets')}
      ${chip('trait', 'unique', 'Unique')}
      ${chip('trait', 'wrld', 'WRLD')}
      ${chip('trait', 'event', 'Event-linked')}
      ${chip('trait', 'class', 'Class')}
      ${chip('trait', 'bloodline', 'Bloodline')}
    </div>
    <div class="dbg-filter-row">
      ${chip('discovered', 'all', 'All')}
      ${chip('discovered', 'yes', 'Discovered')}
      ${chip('discovered', 'no', 'Undiscovered')}
    </div>
  </div>`;
}

export function renderEquipmentPanel(ctx, filters, iconHtml) {
  const entries = visibleEntries(ctx, { ...filters, kind: filters.kind === 'all' ? 'all' : filters.kind });
  const slots = ['weapon', 'helmet', 'chest', 'legs', 'boots', 'accessory'];
  const equip = entries.filter(e => e.kind === 'equipment');
  const sets = entries.filter(e => e.kind === 'set');
  const bySlot = slots.map(sl => groupHtml(sl, equip.filter(e => e.slot === sl), ctx, iconHtml)).join('');
  return `${groupHtml('Armor sets', sets, ctx, iconHtml)}${bySlot}`;
}

export function renderSkillsPanel(ctx, filters) {
  const entries = visibleEntries(ctx, filters).filter(e => e.kind === 'skill' || e.kind === 'art');
  const classes = [...new Set(entries.filter(e => e.kind === 'skill').map(e => e.classId || 'universal'))];
  const skills = classes.map(cls => {
    const list = entries.filter(e => e.kind === 'skill' && (e.classId || 'universal') === cls);
    const label = CLASSES[cls]?.name || (cls === 'universal' ? 'Universal' : cls === 'special' ? 'Exclusive / Drop' : cls);
    return groupHtml(label, list, ctx, null);
  }).join('');
  const arts = entries.filter(e => e.kind === 'art');
  return `${skills}${groupHtml('Bloodline arts', arts, ctx, null)}`;
}

export function renderRelicsPanel(ctx, filters, iconHtml) {
  const entries = visibleEntries(ctx, filters);
  return `${groupHtml('Relics', entries.filter(e => e.kind === 'relic'), ctx, iconHtml)}
    ${groupHtml('Consumables', entries.filter(e => e.kind === 'consumable'), ctx, iconHtml)}`;
}

export function renderEventsPanel(ctx, filters) {
  const entries = visibleEntries(ctx, { ...filters, kind: 'event' });
  return groupHtml('Events', entries, ctx, null);
}

export function playerFacingHtmlContains(html, needle) {
  return String(html || '').includes(needle);
}

export function bindCompendiumFilters(root, getCtx, redraw) {
  if (!root) return defaultFilters();
  const state = defaultFilters();
  const apply = () => redraw(state);
  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-comp-filter]');
    if (!btn) return;
    state[btn.dataset.compFilter] = btn.dataset.compValue;
    apply();
  });
  root.addEventListener('input', e => {
    if (e.target?.matches?.('[data-comp-search]')) {
      state.q = e.target.value;
      apply();
    }
  });
  return state;
}
