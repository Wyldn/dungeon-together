// Default tags for every authored event. Cards may also set `tags: [...]`
// inline; inline wins. Keep stories hand-written — tags only modify rules.

export const EVENT_TAG_MAP = {
  /* ---- generic ---- */
  old_shrine: ['blessing', 'curse', 'stat-test', 'class-specific', 'secret-flag', 'resource-test'],
  campfire: ['recovery', 'blessing'],
  merchant: ['merchant'],
  abandoned_armory: ['equipment', 'class-specific', 'blessing'],
  pale_choir_cache: ['equipment', 'class-specific', 'secret-flag', 'blessing'],
  discarded_kit: ['equipment', 'class-specific', 'recovery'],
  gambler: ['gamble', 'stat-test', 'resource-test', 'class-specific', 'curse'],
  blood_altar: ['curse', 'resource-test', 'gamble'],
  soul_broker: ['resource-test', 'merchant', 'curse'],
  mysterious_door: ['stat-test', 'equipment', 'class-specific', 'gamble'],
  bard: ['blessing', 'class-specific', 'secret-flag', 'mentor'],
  bard_returns: ['blessing', 'secret-flag', 'class-specific'],
  cartographer: ['mentor', 'advancement'],
  chest_generic: ['equipment', 'combat-threat', 'gamble'],
  wandering_appraiser: ['appraisal'],
  guild_assessor: ['appraisal', 'fame-test'],
  training_grounds: ['mentor', 'advancement', 'stat-test'],
  proving_hall: ['advancement', 'stat-test', 'fame-test'],
  academy_recruiter: ['mentor', 'advancement', 'class-specific'],
  sparring_ring: ['stat-test', 'combat-threat', 'advancement'],
  cursed_mirror: ['curse', 'stat-test', 'gamble'],
  tax_collector: ['resource-test', 'fame-test', 'curse'],
  stray_companion: ['blessing', 'secret-flag'],

  /* ---- biome flavor generics ---- */
  old_battlefield: ['equipment', 'stat-test', 'curse'],
  frozen_library: ['mentor', 'stat-test', 'class-specific'],
  bog_barter: ['merchant', 'resource-test', 'equipment'],
  ash_pilgrims: ['blessing', 'curse', 'stat-test'],
  street_performer: ['blessing', 'fame-test', 'class-specific'],
  trial_stones: ['stat-test', 'advancement', 'mentor'],
  true_calling: ['class-specific', 'advancement', 'mentor'],
  seed_of_power: ['secret-flag', 'blessing', 'gamble'],
  seed_bloom: ['secret-flag', 'blessing', 'advancement'],
  reforge_altar: ['equipment', 'resource-test'],
  prodigys_gambit: ['gamble', 'comeback', 'stat-test', 'curse'],
  font_of_focus: ['recovery', 'blessing'],
  crimson_stranger: ['npc-duel', 'combat-threat', 'gamble', 'equipment'],
  one_of_one_peddler: ['merchant', 'equipment', 'resource-test', 'fame-test'],
  archive_of_one: ['equipment', 'resource-test', 'fame-test', 'blessing'],
  frost_revenant: ['npc-duel', 'combat-threat', 'equipment'],
  memory_of_a_king: ['npc-duel', 'combat-threat', 'equipment', 'gamble'],
  world_witness: ['npc-duel', 'combat-threat', 'equipment', 'gamble'],
  famed_patron: ['fame-test', 'equipment', 'merchant', 'blessing'],
  renown_court: ['fame-test', 'merchant', 'blessing'],
  under_market: ['merchant', 'equipment', 'resource-test'],
  gilded_fountain: ['gamble', 'blessing', 'curse', 'resource-test'],
  rare_mentor: ['mentor', 'comeback', 'advancement', 'blessing'],
  emergency_awakening: ['comeback', 'advancement', 'secret-flag'],
  underdog_purse: ['comeback', 'blessing', 'resource-test'],
  hidden_trainer: ['mentor', 'comeback', 'secret-flag', 'advancement'],
  awakening_shrine: ['race-evolve', 'race-specific', 'secret-flag'],
  ancestral_echo: ['race-evolve', 'race-specific', 'secret-flag'],
  awakening_return: ['race-evolve', 'secret-flag', 'blessing'],
  wheel_of_the_tower: ['gamble', 'curse', 'blessing'],
  oath_candle: ['spark-for-player', 'secret-flag', 'sigil'],
  oath_payoff: ['spark-for-player', 'secret-flag', 'blessing'],
  forked_galleries: ['spark-for-player', 'equipment', 'gamble'],

  /* ---- forest ---- */
  wounded_adventurer: ['blessing', 'secret-flag', 'resource-test', 'curse'],
  climber_returns: ['secret-flag', 'blessing', 'equipment'],
  fey_bargain: ['curse', 'gamble', 'resource-test', 'stat-test'],
  bandit_toll: ['resource-test', 'combat-threat', 'fame-test'],
  beehive: ['combat-threat', 'gamble', 'resource-test'],
  ancient_tree: ['sigil', 'secret-flag', 'race-evolve', 'blessing'],
  wolf_ambush: ['combat-threat', 'secret-flag', 'curse'],

  /* ---- ruins ---- */
  buried_library: ['mentor', 'class-specific', 'secret-flag', 'sigil'],
  royal_crypt: ['equipment', 'curse', 'gamble', 'combat-threat'],
  cursed_statue: ['curse', 'stat-test', 'secret-flag'],
  forgotten_forge: ['equipment', 'stat-test', 'advancement'],
  ghost_king: ['sigil', 'secret-flag', 'fame-test', 'npc-duel'],
  trapped_corridor: ['stat-test', 'combat-threat', 'curse'],

  /* ---- frost ---- */
  frozen_climber: ['blessing', 'curse', 'equipment', 'secret-flag'],
  ice_garden: ['sigil', 'secret-flag', 'blessing', 'curse'],
  warm_hearth: ['recovery', 'blessing'],
  avalanche: ['combat-threat', 'stat-test', 'curse'],

  /* ---- swamp ---- */
  witch_hut: ['curse', 'blessing', 'gamble', 'class-specific'],
  sunken_bell: ['sigil', 'secret-flag', 'equipment', 'stat-test'],
  lantern_ghost: ['combat-threat', 'curse', 'stat-test'],
  toad_prince: ['blessing', 'fame-test', 'secret-flag'],
  quicksand_cache: ['equipment', 'stat-test', 'gamble'],

  /* ---- hell ---- */
  devils_contract: ['curse', 'gamble', 'secret-flag', 'resource-test'],
  chained_angel: ['sigil', 'secret-flag', 'blessing', 'curse'],
  demon_gambler: ['gamble', 'stat-test', 'class-specific', 'resource-test'],
  river_of_fire: ['stat-test', 'secret-flag', 'resource-test', 'curse'],
  cowards_gate: ['secret-flag', 'gamble'],
  last_rest: ['recovery', 'secret-flag', 'blessing'],
};

export function tagsForEvent(event) {
  if (event?.tags?.length) return event.tags;
  return EVENT_TAG_MAP[event?.id] || [];
}
