// Cursed equipment is an orthogonal acquisition/trait, never a rarity.
// Rarity still drives power, economy, and drop weighting.

import { packGet } from './state.js';

export function isCursedItem(item) {
  return !!(item && (item.curse || item.acquisition === 'cursed'));
}

export function isEvolvingItem(item) {
  if (!item) return false;
  if (item.evolvesTo) return true;
  return (item.effects || []).some(ef => ef?.op === 'evolveItem' || ef?.op === 'crackItem');
}

export function curseDrawbackText(item) {
  if (!item) return '';
  if (item.curseDrawback) return String(item.curseDrawback);
  const desc = String(item.desc || '');
  const m = desc.match(/Cursed\s*·\s*(.+)/i);
  if (m) return m[1].trim();
  if (isCursedItem(item)) return desc || 'A lasting drawback rides this piece.';
  return '';
}

export function curseRuntime(run, item) {
  if (!item?.id) {
    return { evolutionProgress: 0, cracked: false, resolved: false };
  }
  const evo = Number(packGet(run, 'run', `evo:${item.id}`, 0) || 0);
  const cracked = !!packGet(run, 'run', `cracked:${item.id}`);
  const resolved = !!(
    packGet(run, 'run', `curseResolved:${item.id}`)
    || (item.curse && packGet(run, 'run', `curseResolved:${item.curse}`))
  );
  return { evolutionProgress: evo, cracked, resolved };
}

/** Standardized cursed metadata. `rarity` is the catalog rarity, never 'cursed'. */
export function curseInfo(item, run = null) {
  if (!isCursedItem(item) && !isEvolvingItem(item)) return null;
  const rt = curseRuntime(run, item);
  return {
    cursed: isCursedItem(item),
    curseId: item.curse || null,
    rarity: item.rarity || 'common',
    acquisition: item.acquisition || (isCursedItem(item) ? 'cursed' : null),
    drawback: curseDrawbackText(item),
    resolution: item.resolution || null,
    evolving: isEvolvingItem(item),
    evolvesTo: item.evolvesTo || null,
    evolutionProgress: rt.evolutionProgress,
    cracked: rt.cracked,
    resolved: rt.resolved,
  };
}

function esc(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function itemTraitTagsHtml(item) {
  if (!item) return '';
  const tags = [];
  if (isCursedItem(item)) tags.push('<span class="tag tag-cursed">CURSED</span>');
  if (isEvolvingItem(item)) tags.push('<span class="tag tag-evolving">EVOLVES</span>');
  if (item.setId) tags.push('<span class="tag tag-set">SET</span>');
  return tags.join('');
}

export function curseDisclosureHtml(item, run = null) {
  const info = curseInfo(item, run);
  if (!info || (!info.cursed && !info.evolving)) return '';
  const parts = ['<div class="curse-box">'];
  if (info.cursed) {
    parts.push('<span class="tag tag-cursed">CURSED</span>');
    if (info.drawback) {
      parts.push(`<div class="curse-drawback">Drawback: ${esc(info.drawback)}</div>`);
    }
    if (info.resolution) {
      parts.push(`<div class="curse-res">Resolution: ${esc(info.resolution)}</div>`);
    }
  }
  if (info.evolving) {
    const prog = info.evolutionProgress
      ? `Evolution progress ${info.evolutionProgress}`
      : 'Can evolve';
    const extra = [
      info.cracked ? 'cracked' : '',
      info.resolved ? 'curse resolved' : '',
    ].filter(Boolean);
    parts.push(`<div class="curse-evo">${esc(prog)}${extra.length ? ` · ${esc(extra.join(' · '))}` : ''}</div>`);
  } else if (info.resolved) {
    parts.push('<div class="curse-evo">Curse resolved</div>');
  }
  parts.push('</div>');
  return parts.join('');
}
