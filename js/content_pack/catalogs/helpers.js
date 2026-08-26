import { capabilityEnabled } from '../flags.js';
import { catalogPrice, dropWeightFor } from '../rarity.js';

function chaseIdentity(p) {
  return !!(p.unique || p.wrld || p.rarity === 'unique' || p.rarity === 'wrld');
}

function defaultAcquisition(p) {
  if (p.acquisition) return p.acquisition;
  if (p.wrld || p.rarity === 'wrld') return 'wrld';
  if (p.unique || p.rarity === 'unique') return 'unique';
  if (p.packOrdinary) return 'ordinary';
  return 'event';
}

/** Exclusive = not ordinary loot. Unique/WRLD are always exclusive. */
function defaultExclusive(p) {
  if (p.exclusive != null) return !!p.exclusive;
  if (p.packOrdinary) return false;
  if (p.wrld || p.rarity === 'wrld' || p.unique || p.rarity === 'unique') return true;
  return true;
}

export function wpn(p) {
  const exclusive = defaultExclusive(p);
  const chase = chaseIdentity(p);
  const rarity = p.rarity;
  const tier = p.tier || 2;
  return {
    slot: 'weapon',
    tier,
    price: p.price ?? (rarity ? catalogPrice('equipment', rarity, tier) : undefined),
    lootWeight: p.lootWeight ?? (p.packOrdinary && rarity ? Math.max(1, Math.round(dropWeightFor(rarity) * 0.4)) : undefined),
    exclusive,
    contentPack: true,
    acquisition: defaultAcquisition(p),
    sourceId: p.sourceId || p.id,
    playable: p.playable || 'as_proposed',
    noAffix: chase || !!p.noAffix,
    ...p,
    exclusive,
    noAffix: chase || !!p.noAffix,
  };
}

export function gear(p) {
  const exclusive = defaultExclusive(p);
  const chase = chaseIdentity(p);
  const rarity = p.rarity;
  const tier = p.tier || 2;
  return {
    tier,
    price: p.price ?? (rarity ? catalogPrice('equipment', rarity, tier) : undefined),
    lootWeight: p.lootWeight ?? (p.packOrdinary && rarity ? Math.max(1, Math.round(dropWeightFor(rarity) * 0.4)) : undefined),
    exclusive,
    contentPack: true,
    acquisition: defaultAcquisition(p),
    sourceId: p.sourceId || p.id,
    playable: p.playable || 'as_proposed',
    noAffix: chase || !!p.noAffix,
    ...p,
    exclusive,
    noAffix: chase || !!p.noAffix,
  };
}

export function relic(p) {
  const chase = chaseIdentity(p);
  const rarity = p.rarity;
  return {
    exclusive: defaultExclusive({ ...p, acquisition: p.acquisition || defaultAcquisition(p) }),
    contentPack: true,
    acquisition: defaultAcquisition(p),
    sourceId: p.sourceId || p.id,
    playable: p.playable || 'as_proposed',
    quest: !!p.quest,
    unique: !!p.unique || rarity === 'unique',
    wrld: !!p.wrld || rarity === 'wrld',
    noAffix: chase,
    price: p.price ?? (rarity ? catalogPrice('relic', rarity, p.tier || 3) : undefined),
    ...p,
    unique: !!p.unique || rarity === 'unique' || p.rarity === 'unique',
    wrld: !!p.wrld || rarity === 'wrld' || p.rarity === 'wrld',
    noAffix: chase || p.rarity === 'unique' || p.rarity === 'wrld' || !!p.unique || !!p.wrld,
  };
}

export function potion(p) {
  const rarity = p.rarity;
  return {
    exclusive: p.exclusive !== false,
    contentPack: true,
    acquisition: defaultAcquisition(p),
    sourceId: p.sourceId || p.id,
    playable: p.playable || 'as_proposed',
    price: p.price ?? (rarity ? catalogPrice('consumable', rarity, p.tier || 1) : undefined),
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
