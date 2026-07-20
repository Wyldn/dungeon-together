// Skill component authoring layer.
// Skills remain flat declarative objects at runtime (combat.js reads props).
// Authors compose kits from COMP.* pieces via composeSkill() — balance stays
// consistent because every effect shape is shared.

/**
 * Component builders. Each returns a partial skill blob.
 * Combine with composeSkill(meta, ...parts).
 */
export const COMP = {
  /* ---- targeting / economy (usually in meta, but available as comps) ---- */
  cost: (n) => ({ cost: n }),
  charge: (n) => ({ charge: n }),
  target: (t) => ({ target: t }), // 'one' | 'all' | 'self'
  tier: (n) => ({ tier: n }),
  fx: (id) => ({ fx: id }),

  /* ---- damage ---- */
  dmg: (power, stat = 'best') => ({ power, stat }),
  flatPower: (power) => ({ power }),
  scaleStat: (stat) => ({ stat }),
  critBonus: (pct) => ({ critBonus: pct }),
  ignoreDef: () => ({ ignoreDef: true }),
  execute: (pct) => ({ execute: pct }),

  /* ---- status / DoT ---- */
  poison: (chance) => ({ poison: chance }),
  burn: (chance) => ({ burn: chance }),
  freeze: (chance) => ({ freeze: chance }),
  stun: (chance) => ({ stun: chance }),
  paralyze: (chance) => ({ paralyze: chance }), // soft CC — lower initiative
  hex: (chance) => ({ hex: chance }),
  weaken: (chance) => ({ weaken: chance }),   // less damage dealt
  frail: (chance) => ({ frail: chance }),     // more damage taken
  tormented: (chance) => ({ tormented: chance }), // frail-like taken mult
  confused: (chance) => ({ confused: chance }),   // offensive acts risk ally hits / whiffs
  lazy: (chance) => ({ lazy: chance }),           // delayed / skipped act

  /* ---- sustain ---- */
  lifesteal: (pct) => ({ lifesteal: pct }),
  healPct: (pct) => ({ healPct: pct }),
  shield: (pct) => ({ shield: pct }),
  selfHpCost: (pct) => ({ selfHpCost: pct }),

  /* ---- buffs / utility ---- */
  buff: (stat, mult, turns = 3) => ({ buff: { stat, mult, turns } }),
  buffAdd: (stat, add, turns = 3) => ({ buff: { stat, add, turns } }),
  buff2: (stat, spec, turns = 3) => (
    typeof spec === 'number' && spec > 2
      ? { buff2: { stat, add: spec, turns } }
      : { buff2: { stat, mult: spec, turns } }
  ),
  guard: () => ({ guard: true }),
  allyTarget: () => ({ allyTarget: true }),

  /* ---- charge / resource manipulation ---- */
  gainCharge: (n) => ({ gainCharge: n }),
  gainResource: (n) => ({ gainResource: n }),

  /* ---- initiative (combat reads buff.stat === 'initiative' if present) ---- */
  initiative: (add, turns = 2) => ({ buff: { stat: 'initiative', add, turns } }),
};

/**
 * Merge component partials onto a skill meta object.
 * Later components override earlier keys, except buff → buff2 when both set.
 */
export function composeSkill(meta, ...components) {
  const sk = { ...meta };
  for (const raw of components) {
    const c = typeof raw === 'function' ? raw() : raw;
    if (!c) continue;
    if (c.buff && sk.buff && !c.buff2 && !sk.buff2) {
      sk.buff2 = c.buff;
      const { buff, ...rest } = c;
      Object.assign(sk, rest);
      continue;
    }
    Object.assign(sk, c);
  }
  if (!sk.id && sk.name) {
    sk.id = String(sk.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  }
  return sk;
}

/** Example: Shadow Step = initiative + energy + next-hit damage + rogue stealth. */
export const EXAMPLE_SHADOW_STEP = composeSkill(
  {
    id: 'shadow_step_example',
    name: 'Shadow Step',
    class: 'rogue',
    cost: 18,
    charge: 1,
    target: 'self',
    tier: 2,
    fx: 'shadow',
    desc: 'Slip the tempo: +initiative, recover Energy, next strikes hit harder. Rogues fade further.',
  },
  COMP.buffAdd('dodge', 25, 2),
  COMP.buff2('str', 1.5, 2),
  COMP.gainResource(12),
  COMP.gainCharge(1),
);
