// Mutex families and stacking policy. One winner per family unless additive.

import { MUTEX_FAMILIES } from './schema.js';

export const FAMILY_POLICY = Object.freeze({
  revive_ward: 'mutex',
  start_charge: 'mutex',
  action_copy: 'mutex',
  damage_redirect: 'mutex',
  resource_substitution: 'mutex',
  extra_skill_capacity: 'mutex',
  echo_turn: 'highest',
  lethal_ward: 'mutex',
  deathward: 'mutex',
  dmg_add: 'additive',
  dmg_mult: 'multiplicative',
  status_chance: 'diminishing',
  heal_power: 'additive',
  fame_power: 'diminishing',
  gold_power: 'diminishing',
});

const DIMINISH = [1, 0.5, 0.25, 0.12];

export function mutexBlocked(family, ownedFamilies = []) {
  if (!family || !MUTEX_FAMILIES.includes(family)) return false;
  return ownedFamilies.includes(family);
}

export function stackValues(policy, values) {
  const nums = (values || []).map(Number).filter(n => Number.isFinite(n));
  if (!nums.length) return 0;
  switch (policy) {
    case 'highest': return Math.max(...nums);
    case 'mutex':
    case 'exclusive': return nums[0];
    case 'multiplicative': return nums.reduce((m, n) => m * n, 1);
    case 'diminishing':
      return nums
        .sort((a, b) => Math.abs(b) - Math.abs(a))
        .reduce((s, n, i) => s + n * (DIMINISH[i] ?? 0.06), 0);
    case 'additive':
    default: return nums.reduce((s, n) => s + n, 0);
  }
}

export function collectMutexes(items = []) {
  const out = [];
  for (const it of items) {
    if (it?.mutex && !out.includes(it.mutex)) out.push(it.mutex);
    for (const ef of it?.effects || []) {
      if (ef.mutex && !out.includes(ef.mutex)) out.push(ef.mutex);
    }
  }
  return out;
}
