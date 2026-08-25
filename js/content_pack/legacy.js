// Gate 2: existing items expressed through the declarative schema.
// Effects are tagged legacyMirror so the dispatcher never double-applies.
// Live freeze/burn/etc. still come from the original item fields.

import { ef } from './catalogs/helpers.js';

export const LEGACY_MIRRORS = Object.freeze({
  frost_brand: [
    ef('onHit', 'statusChance', { status: 'frozen', chance: 0.15, turns: 1, legacyMirror: true, id: 'legacy:frost_brand' }),
  ],
  sun_mace: [
    ef('onHit', 'statusChance', { status: 'frail', chance: 0.15, turns: 3, legacyMirror: true, id: 'legacy:sun_mace' }),
  ],
  storm_bow: [
    ef('onHit', 'statusChance', { status: 'weaken', chance: 0.12, turns: 3, legacyMirror: true, id: 'legacy:storm_bow' }),
  ],
  cracked_hourglass: [
    ef('beforeDamageTaken', 'lethalWard', { mutex: 'deathward', once: 'combat', legacyMirror: true, id: 'legacy:hourglass' }),
  ],
  phoenix_feather: [
    ef('beforeDamageTaken', 'lethalWard', { mutex: 'revive_ward', once: 'run', legacyMirror: true, id: 'legacy:phoenix' }),
  ],
});
