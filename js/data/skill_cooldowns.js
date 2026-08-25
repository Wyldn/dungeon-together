// Player Battle Charge ability cooldowns, keyed by stable skill id.
// Remaining is measured in that player's own completed turns (see combat_core
// beginPlayerTurn / completePlayerTurn). Zero-charge skills are never listed
// and never cool down, even if a stray entry appears here.
//
// Semantics: use on your turn T with cooldown C → the next C of your turns
// cannot use it; it is selectable again at the start of turn T+C+1.
//   C=1: T use, T+1 blocked, T+2 available
//   C=2: T use, T+1 and T+2 blocked, T+3 available
//   C=3: T use, T+1..T+3 blocked, T+4 available
//
// Class kits are rotations, not one global charge→CD curve:
//   1⚡ setup / poke / stun     → 1 (weave every other turn)
//   1⚡ / 2⚡ duration buffs    → 2 (do not recast over the buff)
//   2⚡ payoffs you wait on     → 1 (available when the setup lands)
//   3⚡ AOE / heavy            → 2
//   execute windows            → 1 (or 2 if the hit is also a spam finisher)
//   5–6⚡ ultimates            → 3

export const SKILL_COOLDOWNS = {
  /* ---- warrior ---- */
  shield_bash: 1,
  war_cry: 2,
  taunt: 1,
  cleave: 2,
  bulwark_call: 2,
  iron_will: 1,
  heavy_swing: 1,
  sunder: 2,
  bulwark: 2,
  rampage: 2,
  holy_strike: 2,
  reapers_toll: 1,
  whirlwind: 3,

  /* ---- viking ---- */
  shield_splitter: 1,
  blood_howl: 2,
  raiders_hook: 1,
  spinning_axes: 2,
  pillage: 1,
  bite_the_shield: 2,
  longship_charge: 2,
  thunder_of_shields: 2,
  valhalla_calls: 1,

  /* ---- mage ---- */
  frost_lance: 1,
  mana_storm: 2,
  soul_siphon: 1,
  scorch: 1,
  time_slip: 2,
  rune_slash: 2,
  chain_lightning: 2,
  unmake: 2,
  blade_storm: 3,
  meteor: 3,

  /* ---- archer ---- */
  aimed_shot: 1,
  double_nock: 1,
  hunters_mark: 1,
  serpent_arrow: 1,
  pinning_shot: 1,
  volley: 2,
  piercing_arrow: 2,
  lightning_arrow: 2,
  one_shot: 2,
  arrow_tempest: 3,

  /* ---- rogue ---- */
  poison_blade: 1,
  throat_jab: 1,
  shadow_step: 1,
  loaded_dice: 1,
  shadow_dance: 2,
  ghost_step: 2,
  fan_of_knives: 2,
  caltrops: 2,
  assassinate: 1,
  twist_of_fate: 3,
  thousand_cuts: 3,

  /* ---- priest ---- */
  mend: 1,
  rebuke: 1,
  crusaders_mark: 1,
  censure: 1,
  aegis_hymn: 2,
  sanctuary: 2,
  benediction: 2,
  judgement: 2,
  profane_mercy: 2,
  final_verdict: 2,
  last_rites: 3,

  /* ---- monk ---- */
  flurry: 1,
  low_sweep: 1,
  gale_palm: 1,
  hurricane_kick: 2,
  pressure_point: 2,
  immovable: 2,
  flowing_form: 2,
  phoenix_palm: 2,
  earthbreaker: 3,
  hundred_fists: 3,

  /* ---- warlock ---- */
  hex_mark: 1,
  soul_rend: 1,
  void_grasp: 1,
  rain_of_ruin: 2,
  fiend_whip: 2,
  null_wave: 2,
  dawnbreak: 2,
  oblivion: 3,

  /* ---- bard ---- */
  discord: 1,
  soothing_refrain: 1,
  rallying_chord: 2,
  iron_ballad: 2,
  saga_of_steel: 2,
  inspire_greatness: 2,
  cacophony: 2,
  crescendo: 2,
  showstopper: 2,
  last_ballad: 2,
  grand_finale: 3,

  /* ---- necromancer ---- */
  bone_spike: 1,
  siphon_life: 1,
  marrow_curse: 1,
  wither: 1,
  grave_bloom: 2,
  raise_anguish: 2,
  plague_wind: 2,
  phylactery_pulse: 2,
  black_rain: 3,
  final_word: 2,
  mass_grave: 3,

  /* ---- spellsword ---- */
  mana_lunge: 1,
  sigil_thrust: 1,
  glyph_parry: 1,
  spark_riposte: 1,
  hex_rend: 1,
  aegis_cut: 2,
  blade_tempest: 2,
  eclipse_cut: 2,
  sanctum_blade: 3,
  living_script: 3,

  /* ---- special / drop-only ---- */
  vampire_bite: 1,
  scholar_hex: 1,
  militia_press: 1,
  pathfinder_mark: 1,
  axe_pack_cleave: 2,
  frost_nova: 2,
  dragon_breath: 2,
  elder_lesson: 3,
};

/** Fallback if a charged skill is missing from the table (tests fail on that). */
export function defaultCooldownForCharge(charge) {
  const n = charge || 0;
  if (n < 1) return 0;
  if (n <= 1) return 1;
  if (n <= 4) return 2;
  return 3;
}
