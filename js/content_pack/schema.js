// Allowlisted declarative effect schema. Unknown keys/hooks/ops are errors.

export const SCOPES = Object.freeze([
  'action', 'turn', 'combat', 'floor', 'biome', 'run', 'permanent',
]);

export const HOOKS = Object.freeze([
  'onCombatStart', 'onTurnStart', 'onTurnEnd', 'onCombatEnd',
  'onGuard', 'beforeHit', 'onHit', 'onKill', 'onMiss',
  'beforeDamageTaken', 'onDamageTaken', 'onAllyDowned',
  'onStatusApplied', 'onHeal', 'onSkillUse', 'onConsumable',
  'onIntentRevealed', 'onPhaseChange',
  'onFloorStart', 'onFloorEnd', 'onBiomeEnter',
  'onEventResolve', 'onShopAction', 'onCampfire',
]);

export const OPS = Object.freeze([
  'modDamage', 'flatDamage', 'statusChance', 'applyStatus', 'removeStatus',
  'convertStatus', 'extendStatus',
  'heal', 'overhealWard', 'shareHeal',
  'grantCharge', 'grantResource', 'spendResource',
  'setFlag', 'clearFlag', 'addCounter',
  'lethalWard', 'redirectDamage', 'interceptAoe',
  'echoAction', 'copySupport',
  'summonAlly', 'storeArchetype',
  'revealIntent', 'weakenIntent',
  'chooseStance', 'setOath',
  'markTarget', 'recordName',
  'spendGoldPower', 'spendFamePower',
  'convertResource',
  'delayEffect',
  'evolveItem', 'crackItem',
  'contestLethal',
  'borrowTechnique',
  'storeMemory',
  'modIncoming', 'modAccuracy',
  'gainFame', 'gainGold',
  'reduceCharge',
  'altTargetShot',
  'leaveAtOne',
  'armNextHit', 'armNextIncoming',
  'cancelEventPenalty',
  'restoreMemory',
  'noOp',
]);

export const STACKING = Object.freeze([
  'additive', 'multiplicative', 'highest', 'diminishing', 'exclusive', 'mutex',
]);

export const MUTEX_FAMILIES = Object.freeze([
  'revive_ward', 'start_charge', 'action_copy', 'damage_redirect',
  'resource_substitution', 'extra_skill_capacity', 'echo_turn',
  'lethal_ward', 'deathward',
]);

export const ACQUISITION = Object.freeze([
  'ordinary', 'class', 'bloodline', 'event', 'cursed', 'boss', 'unique', 'wrld',
]);

export const LIMITS = Object.freeze({
  copyDepth: 1,
  redirectsPerAction: 1,
  reflectionsPerAction: 1,
  statusConversionsPerAction: 2,
  summonsCap: 2,
  extraActionsPerTurn: 1,
  extraTurnsPerCombat: 1,
  revivesPerCombat: 1,
  triggersPerAction: 4,
  triggersPerSourcePerCombat: 8,
});

export const SAFE_ARCHETYPES = Object.freeze([
  'skeleton', 'leech', 'imp', 'slime', 'rat', 'wolf', 'spider', 'bandit',
]);

const EFFECT_KEYS = new Set([
  'id', 'hook', 'op', 'priority', 'scope', 'stacking', 'mutex', 'family',
  'cap', 'once', 'limit', 'when', 'mult', 'add', 'flat', 'pct', 'chance',
  'status', 'statusTo', 'turns', 'amount', 'key', 'value', 'target',
  'copyDepth', 'generated', 'originActionId', 'stance', 'oath',
  'archetype', 'element', 'stat', 'gold', 'fame', 'hp', 'maxHp',
  'skillId', 'itemId', 'channel', 'legacyMirror', 'capability',
  'vsCharging', 'vsShielded', 'vsStatus', 'vsFamily', 'vsBoss',
  'vsSummon', 'lowestAlly', 'selfHarm', 'preview', 'note',
  'minFame', 'minGold', 'requireResonance', 'bloodline',
  'classId', 'emptySlots', 'missingAllies', 'firstHit',
  'alternate', 'consecutive', 'overheal', 'delayTurns',
  'safeAllowlist', 'bounded', 'persistFlag', 'multHealthy', 'lowestAlly',
]);

const WHEN_KEYS = new Set([
  'flag', 'notFlag', 'status', 'selfStatus', 'guarding', 'charged',
  'skillId', 'skillClass', 'basic', 'differentFromPrior', 'sameTarget',
  'hpBelow', 'hpAbove', 'fameBelow', 'fameAbove', 'goldAtLeast',
  'bloodline', 'classId', 'resonance', 'setPieces', 'oncePerCombat',
  'oncePerTurn', 'copyDepthMax', 'allyDowned', 'isCrit', 'killing',
  'targetMarked', 'intentAoe', 'intentCharged', 'biome',
  'stance', 'oath', 'emptySlots', 'counter', 'counterAt',
]);

export function validateEffect(effect, path = 'effect') {
  const errors = [];
  if (!effect || typeof effect !== 'object') {
    return [`${path}: effect must be an object`];
  }
  for (const k of Object.keys(effect)) {
    if (!EFFECT_KEYS.has(k)) errors.push(`${path}: unknown key '${k}'`);
  }
  if (!HOOKS.includes(effect.hook)) errors.push(`${path}: unknown hook '${effect.hook}'`);
  if (!OPS.includes(effect.op)) errors.push(`${path}: unknown op '${effect.op}'`);
  if (effect.scope && !SCOPES.includes(effect.scope)) errors.push(`${path}: unknown scope '${effect.scope}'`);
  if (effect.stacking && !STACKING.includes(effect.stacking)) errors.push(`${path}: unknown stacking '${effect.stacking}'`);
  if (effect.mutex && !MUTEX_FAMILIES.includes(effect.mutex)) errors.push(`${path}: unknown mutex '${effect.mutex}'`);
  if (effect.when && typeof effect.when === 'object') {
    for (const k of Object.keys(effect.when)) {
      if (!WHEN_KEYS.has(k)) errors.push(`${path}.when: unknown key '${k}'`);
    }
  }
  if (effect.archetype && !SAFE_ARCHETYPES.includes(effect.archetype)) {
    errors.push(`${path}: archetype '${effect.archetype}' is not on the safe allowlist`);
  }
  if (effect.copyDepth != null && (effect.copyDepth | 0) > LIMITS.copyDepth) {
    errors.push(`${path}: copyDepth exceeds hard limit ${LIMITS.copyDepth}`);
  }
  return errors;
}

export function validateEffects(effects, path = 'effects') {
  if (effects == null) return [];
  if (!Array.isArray(effects)) return [`${path}: must be an array`];
  const errors = [];
  const ids = new Set();
  effects.forEach((ef, i) => {
    errors.push(...validateEffect(ef, `${path}[${i}]`));
    if (ef?.id) {
      if (ids.has(ef.id)) errors.push(`${path}: duplicate effect id '${ef.id}'`);
      ids.add(ef.id);
    }
  });
  return errors;
}

export const ITEM_KEYS_ALLOWED = new Set([
  'id', 'name', 'slot', 'wtype', 'rarity', 'tier', 'atk', 'def', 'hp', 'mp',
  'str', 'dex', 'int', 'wis', 'lk', 'crit', 'dodge', 'initiative',
  'burn', 'freeze', 'poison', 'weaken', 'frail', 'stun', 'lifesteal',
  'tormented', 'confused', 'lazy', 'dmgMult', 'manaRegen', 'fameGainMult',
  'desc', 'price', 'exclusive', 'unique', 'wrld', 'noAffix', 'starter',
  'retired', 'mutex', 'effects', 'setId', 'setPieces', 'setBonus',
  'resonance', 'curse', 'resolution', 'quest', 'contentPack',
  'acquisition', 'capability', 'sourceId', 'packOrdinary', 'lootWeight',
  'classBound', 'evolvesTo', 'instanceKeys', 'status', 'playable',
  'curseDrawback',
  'adaptation', 'heal', 'healPct', 'healPerFloor', 'mana', 'fame',
  'bombDmg', 'bombPerFloor', 'cure', 'foodBuff', 'shopMaxTier', 'appraisal',
  'reveal', 'extraSkillSlots', 'startCharge', 'deathward', 'revive',
  'thorns', 'echoChance', 'combatGoldMult', 'goldMult', 'xpMult',
  'bossDmgMult', 'maxHpMult', 'allStats', 'victoryHeal', 'lowHpHeal',
  'fameOnVictory', 'doubleDmgRound', 'confuseChance', 'lifestealCapMult',
  'noMimic', 'enemyCrit',
]);

export function validateItem(item, path = 'item') {
  const errors = [];
  if (!item?.id) errors.push(`${path}: missing id`);
  if (!item?.name) errors.push(`${path}: missing name`);
  if (!item?.desc) errors.push(`${path}: missing desc`);
  for (const k of Object.keys(item || {})) {
    if (!ITEM_KEYS_ALLOWED.has(k)) errors.push(`${path} (${item.id}): unknown key '${k}'`);
  }
  if (item.effects) errors.push(...validateEffects(item.effects, `${path}.effects`));
  if (item.acquisition && !ACQUISITION.includes(item.acquisition)) {
    errors.push(`${path}: unknown acquisition '${item.acquisition}'`);
  }
  if (item.rarity === 'cursed') {
    errors.push(`${path}: 'cursed' is a trait, not a rarity`);
  }
  if (item.curse && !item.resolution) {
    errors.push(`${path}: cursed item must declare a resolution route`);
  }
  if ((item.acquisition === 'cursed' || item.curse) && !item.curse) {
    errors.push(`${path}: cursed acquisition needs a curse id`);
  }
  if (item.setBonus) {
    for (const n of Object.keys(item.setBonus)) {
      errors.push(...validateEffects(item.setBonus[n], `${path}.setBonus.${n}`));
    }
  }
  return errors;
}

export const SKILL_REQUIRED = ['id', 'name', 'class', 'desc'];

export function validateSkill(sk, path = 'skill') {
  const errors = [];
  if (!sk) return [`${path}: missing`];
  for (const k of SKILL_REQUIRED) if (!sk[k]) errors.push(`${path}: missing ${k}`);
  const charge = sk.charge || 0;
  if (charge < 0 || charge > 6) errors.push(`${path}: charge out of range`);
  if (charge >= 1 && (sk.cooldown == null || sk.cooldown < 1)) {
    errors.push(`${path}: charged skill must declare an explicit cooldown ≥ 1`);
  }
  if (charge < 1 && sk.cooldown) {
    errors.push(`${path}: zero-charge skills must not enter cooldown`);
  }
  if (sk.target === 'all' && charge < 3) {
    errors.push(`${path}: AOE must be charge-gated (≥3)`);
  }
  if (sk.effects) errors.push(...validateEffects(sk.effects, `${path}.effects`));
  return errors;
}

export function validateEvent(ev, path = 'event') {
  const errors = [];
  if (!ev?.id) errors.push(`${path}: missing id`);
  if (!ev?.title) errors.push(`${path}: missing title`);
  if (!ev?.text) errors.push(`${path}: missing text`);
  if (!ev?.biome) errors.push(`${path}: missing biome`);
  if (!Array.isArray(ev?.choices) || ev.choices.length < 2) {
    errors.push(`${path}: need at least two choices`);
  }
  const labels = new Set();
  for (const [i, c] of (ev.choices || []).entries()) {
    if (!c.label) errors.push(`${path}.choices[${i}]: missing label`);
    if (labels.has(c.label)) errors.push(`${path}: duplicate choice label '${c.label}'`);
    labels.add(c.label);
    if (!c.outcome && !c.outcome?.roll) errors.push(`${path}.choices[${i}]: missing outcome`);
  }
  return errors;
}
