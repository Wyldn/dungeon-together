import { capabilityEnabled } from '../flags.js';

export function wpn(p) {
  const exclusive = p.exclusive !== false && !p.packOrdinary;
  return {
    slot: 'weapon',
    rarity: p.rarity || 'uncommon',
    tier: p.tier || 2,
    price: p.price || (36 + (p.tier || 2) * 42),
    exclusive,
    contentPack: true,
    acquisition: p.acquisition || (p.packOrdinary ? 'ordinary' : 'event'),
    sourceId: p.sourceId || p.id,
    playable: p.playable || 'as_proposed',
    noAffix: !!p.unique || !!p.wrld,
    ...p,
    exclusive,
  };
}

export function gear(p) {
  const exclusive = p.exclusive !== false && !p.packOrdinary;
  return {
    rarity: p.rarity || 'uncommon',
    tier: p.tier || 2,
    price: p.price || (30 + (p.tier || 2) * 38),
    exclusive,
    contentPack: true,
    acquisition: p.acquisition || (p.packOrdinary ? 'ordinary' : 'event'),
    sourceId: p.sourceId || p.id,
    playable: p.playable || 'as_proposed',
    noAffix: !!p.unique || !!p.wrld,
    ...p,
    exclusive,
  };
}

export function relic(p) {
  return {
    rarity: p.rarity || 'rare',
    exclusive: p.exclusive !== false,
    contentPack: true,
    acquisition: p.acquisition || 'event',
    sourceId: p.sourceId || p.id,
    playable: p.playable || 'as_proposed',
    quest: !!p.quest,
    ...p,
  };
}

export function potion(p) {
  return {
    rarity: p.rarity || 'uncommon',
    exclusive: p.exclusive !== false,
    contentPack: true,
    acquisition: p.acquisition || 'event',
    sourceId: p.sourceId || p.id,
    playable: p.playable || 'as_proposed',
    price: p.price || 40,
    shopMaxTier: p.shopMaxTier ?? 0,
    ...p,
  };
}

export function technique(p) {
  const charge = p.charge || 0;
  const sk = {
    fx: p.fx || 'slash',
    target: p.target || 'one',
    cost: p.cost ?? (charge ? 10 + charge * 6 : 0),
    charge,
    class: p.class,
    tier: p.tier || (p.class === 'universal' ? 2 : 2),
    contentPack: true,
    sourceId: p.sourceId || p.id,
    playable: p.playable || 'as_proposed',
    capability: p.capability || (p.class === 'universal' ? 'bloodline_art' : 'class_technique'),
    ...p,
  };
  if (charge >= 1) sk.cooldown = p.cooldown ?? Math.min(3, charge);
  else delete sk.cooldown;
  return sk;
}

export function ev(p) {
  return {
    pack: true,
    contentPack: true,
    w: p.w ?? 3,
    category: p.category || 'mystery',
    type: p.type || 'story',
    glyph: p.glyph || '📜',
    once: p.once ?? !!p.family,
    capability: p.capability || 'event_chain',
    sourceId: p.sourceId || p.id,
    playable: p.playable || 'as_proposed',
    ...p,
  };
}

export function ch(label, hint, outcome, extra = {}) {
  return { label, hint, outcome, ...extra };
}

export function ef(hook, op, extra = {}) {
  return { hook, op, ...extra };
}

export function cap(id) {
  return capabilityEnabled(id);
}
