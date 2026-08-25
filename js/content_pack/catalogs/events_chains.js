import { ev, ch } from './helpers.js';

function walk(label, hint, outcome, extra) {
  return ch(label, hint, { text: hint, ...outcome }, extra);
}

function idChoice(req, label, hint, outcome) {
  return ch(label, hint, { text: hint, ...outcome }, { req, identity: true });
}

function chain(family, glyph, steps) {
  return steps.map((s, i) => ev({
    id: s.id,
    family,
    glyph: s.glyph || glyph,
    biome: s.biome,
    category: s.category || (i === steps.length - 1 ? 'dangerous' : 'mystery'),
    title: s.title,
    text: s.text,
    once: true,
    when: s.when || (i === 0 ? undefined : { flag: steps[i - 1].flag }),
    w: s.w ?? (i === 0 ? 4 : 6),
    tags: s.tags || ['secret-flag'],
    choices: s.choices,
    identityScope: s.identityScope || 'actor',
    sourceId: s.id,
  }));
}

export const PACK_EVENTS = [];

PACK_EVENTS.push(...chain('cp_gate_inward', '🚪', [
  {
    id: 'cp_backward_threshold', biome: 'forest', flag: 'cp_inward_touched',
    title: 'The Backward Threshold',
    text: 'A stone gate lies flat on the forest floor, yet leaves are falling upward through it.',
    choices: [
      walk('Touch the surface', '−8 HP, learn the far side', { hp: -8, flag: 'cp_inward_touched', world: { knowledge: 'cp_inward_seen' } }),
      walk('Pay a gate surveyor 40 gold', 'route prediction', { gold: -40, flag: 'cp_inward_gate_mapped' }, { req: { gold: 40 } }),
      walk('Pour in a potion', 'an altered draught returns', { useItem: 'potion_s', consumable: 'cp_unregistered_remedy', flag: 'cp_inward_touched' }, { req: { item: 'potion_s' } }),
      walk('Walk away', 'the gate remembers the refusal', { flag: 'cp_inward_refused' }),
      idChoice({ race: 'elf' }, 'Hear the roots name it a wound', 'memory, no HP', { fame: 1, flag: 'cp_inward_touched', world: { knowledge: 'cp_inward_wound' } }),
      idChoice({ race: 'dwarf' }, 'Read the masonry: installed backward', 'structural map', { flag: 'cp_inward_gate_mapped', world: { knowledge: 'cp_gate_installed_back' } }),
      idChoice({ race: 'tiefling' }, 'Trace the hidden contract', 'clause copied', { flag: 'cp_inward_touched', world: { knowledge: 'cp_inward_contract' } }),
      idChoice({ race: 'dragonkin' }, 'Recognize heat older than the kingdom', 'hingefire residue', { flag: 'cp_inward_touched', fame: 1 }),
      idChoice({ class: 'mage' }, 'Inspect destination geometry', 'safe reading', { flag: 'cp_inward_gate_mapped', world: { knowledge: 'cp_inward_geom' } }),
      idChoice({ class: 'spellsword' }, 'Place a weapon through the threshold', 'blade tastes the far side', { flag: 'cp_inward_touched', item: 'cp_gate_iron_sword' }),
    ],
  },
  {
    id: 'cp_missing_hinge', biome: 'ruins', flag: 'cp_hinge_held',
    title: 'The Missing Hinge',
    text: 'One of the gate\'s seven hinges is displayed in a ruined courthouse.',
    when: { any: [{ flag: 'cp_inward_touched' }, { flag: 'cp_inward_gate_mapped' }] },
    choices: [
      walk('Buy it legally for 70 gold', 'honest hinge', { gold: -70, flag: 'cp_hinge_held', item: 'cp_backward_gate_hinge' }, { req: { gold: 70 } }),
      walk('Substitute unequipped gear', 'offering', { offering: { kinds: ['pack'] }, flag: 'cp_hinge_held' }, { req: { offering: true } }),
      idChoice({ class: 'warrior' }, 'Wrench it free', 'HP for the hinge', { hp: -14, flag: 'cp_hinge_held', item: 'cp_backward_gate_hinge' }),
      idChoice({ class: 'rogue' }, 'Replace it with a forgery', 'hinge now, audit later', { flag: 'cp_hinge_held', flag2: 'cp_hinge_forged', item: 'cp_backward_gate_hinge' }),
      walk('Leave the exhibit', 'courthouse remembers', { fame: -1 }),
    ],
  },
  {
    id: 'cp_gate_parasites', biome: 'swamp', flag: 'cp_gate_stable',
    title: 'Gate Parasites',
    text: 'The assembled gate is covered in organisms feeding on its destination.',
    when: { flag: 'cp_hinge_held' },
    choices: [
      walk('Burn them away', '−HP, stabilize', { hp: -12, flag: 'cp_gate_stable' }),
      walk('Feed them a potion', 'parasitic charm', { useItem: 'potion_s', item: 'cp_gate_beast_eggshell', flag: 'cp_gate_stable' }, { req: { item: 'potion_s' } }),
      walk('Sell samples for 90 gold', 'contaminate the final gate', { gold: 90, flag: 'cp_gate_contaminated' }),
      idChoice({ class: 'priest' }, 'Cleanse them', 'Fame, stable gate', { fame: 3, flag: 'cp_gate_stable' }),
      idChoice({ class: 'mage' }, 'Classify the organisms', 'Fame, notes', { fame: 2, flag: 'cp_gate_stable', world: { knowledge: 'cp_parasite_class' } }),
    ],
  },
  {
    id: 'cp_choose_the_other_side', biome: 'hell', flag: 'cp_inward_closed',
    title: 'Choose the Other Side',
    text: 'The gate can be pointed toward home, deeper into the dungeon, or toward a prison full of strangers.',
    when: { any: [{ flag: 'cp_gate_stable' }, { flag: 'cp_gate_contaminated' }] },
    choices: [
      walk('Point it home', 'defensive relic, chain closes', { item: 'cp_world_shutting_door', flag: 'cp_inward_closed', fame: 2 }),
      walk('Point it deeper', 'dangerous shortcut (bounded boss modifier flag)', { flag: 'cp_endgame_shortcut', fame: -1 }, { playable: 'adapted' }),
      walk('Free the prisoners', 'Fame and allied support', { gold: -40, fame: 6, flag: 'cp_prisoners_freed' }),
      walk('Enter the contaminated gate', 'optional parasite fight', { combat: { enemies: ['leech', 'hag'] }, flag: 'cp_parasite_boss', item: 'cp_gate_parasite_bow' }),
    ],
  },
]));

PACK_EVENTS.push(...chain('cp_returned_extra', '👤', [
  {
    id: 'cp_seventh_summoned', biome: 'forest', flag: 'cp_seventh_met',
    title: 'The Seventh Summoned Hero',
    text: 'A confused traveler insists they were summoned alongside six heroes, but erased from the official story.',
    choices: [
      walk('Give them a potion and let them follow', 'companion flag', { useItem: 'potion_s', flag: 'cp_seventh_followed' }, { req: { item: 'potion_s' } }),
      walk('Demand payment', '+30g, their resentment', { gold: 30, flag: 'cp_seventh_resented' }),
      walk('Ask the System to identify them', '[UNREGISTERED PROTAGONIST]', { flag: 'cp_seventh_unregistered', world: { knowledge: 'cp_unregistered_protagonist' } }),
      walk('Leave them behind', 'abandonment', { flag: 'cp_seventh_abandoned', fame: -2 }),
      idChoice({ race: 'human' }, 'Recognize adaptability in their selection', 'kinship', { flag: 'cp_seventh_followed', fame: 1 }),
      idChoice({ class: 'bard' }, 'Recover a verse that named seven', 'the hymn had a seventh line', { flag: 'cp_seventh_unregistered', fame: 2 }),
      idChoice({ class: 'necromancer' }, 'Test whether they are fully alive', 'neither, and both', { flag: 'cp_seventh_unregistered', world: { knowledge: 'cp_seventh_liminal' } }),
      idChoice({ class: 'priest' }, 'Restore their ceremonial name', 'a name returns', { fame: -2, flag: 'cp_seventh_named' }),
      idChoice({ class: 'rogue' }, 'Find the receipt for six purchased rankings', 'evidence', { flag: 'cp_seventh_unregistered', gold: 15 }),
    ],
  },
  {
    id: 'cp_heros_footnote', biome: 'frost', flag: 'cp_seventh_rescued',
    title: "A Hero's Footnote",
    text: 'The traveler appears frozen inside a monument celebrating the "Six Heroes."',
    when: { any: [{ flag: 'cp_seventh_met' }, { flag: 'cp_seventh_followed' }, { flag: 'cp_seventh_abandoned' }, { flag: 'cp_seventh_unregistered' }, { flag: 'cp_seventh_resented' }, { flag: 'cp_seventh_named' }] },
    choices: [
      walk('Break the monument', 'HP, rescue', { hp: -10, flag: 'cp_seventh_rescued' }),
      walk('Preserve the official history', 'Fame with gate authorities', { fame: 4, flag: 'cp_seventh_erased' }),
      walk('Examine the missing seventh name', 'they may be the only real hero', { flag: 'cp_seventh_true', world: { knowledge: 'cp_only_real_hero' } }),
      walk('Steal the heroes\' offerings', 'gold, disgrace', { gold: 55, fame: -3, flag: 'cp_seventh_robbed' }),
    ],
  },
  {
    id: 'cp_person_story_rejected', biome: 'hell', flag: 'cp_seventh_closed',
    title: 'The Person the Story Rejected',
    text: 'The returned hero confronts the entity that erased them.',
    when: { any: [{ flag: 'cp_seventh_rescued' }, { flag: 'cp_seventh_erased' }, { flag: 'cp_seventh_true' }, { flag: 'cp_seventh_abandoned' }] },
    choices: [
      walk('Restore their name', 'trade Fame for a party blessing', { fame: -5, flag: 'cp_seventh_restored', item: 'cp_seventh_nameplate' }),
      walk('Let them take revenge', 'harder fight, their weapon', { combat: { enemies: ['void_eye'] }, item: 'cp_unregistered_hero_weapon', flag: 'cp_seventh_revenge' }),
      walk('Sell their identity to the System', 'gold and a rare item', { gold: 80, item: 'cp_false_system_staff', flag: 'cp_seventh_sold', fame: -4 }),
      walk('If you abandoned them, they are hostile', 'elite fight', { combat: { enemies: ['dusk_lurker'] }, flag: 'cp_seventh_hostile' }),
    ],
  },
]));

PACK_EVENTS.push(...chain('cp_hero_bureau', '📋', [
  {
    id: 'cp_provisional_rank', biome: 'forest', flag: 'cp_registered',
    title: 'Provisional Rank',
    text: 'A portable guild office demands that the party register its climb.',
    choices: [
      walk('Pay 25 gold for legitimate papers', 'clean papers', { gold: -25, flag: 'cp_registered' }, { req: { gold: 25 } }),
      walk('Exaggerate achievements', 'Fame, audit risk', { fame: 4, flag: 'cp_audit_risk' }),
      walk('Register under false names', 'aliases', { flag: 'cp_false_names' }),
      walk('Refuse the System\'s ranking', 'dissident', { flag: 'cp_system_dissident', fame: -1 }),
      idChoice({ race: 'human' }, 'Register a provisional hybrid role', 'paperwork that does not fit', { flag: 'cp_registered', fame: 1 }),
      idChoice({ race: 'orc' }, 'Replace rank with a witnessed oath', 'honor, not a stamp', { flag: 'cp_registered', fame: 2 }),
      idChoice({ race: 'dwarf' }, 'Challenge the office\'s valuation of equipment', 'ledger correction', { gold: -10, flag: 'cp_registered' }),
      idChoice({ race: 'halfling' }, 'Notice the clerk stamped the wrong form', 'already approved, somehow', { flag: 'cp_registered' }),
      idChoice({ race: 'tiefling' }, 'Exploit contradictory clauses', 'two ranks, one fee', { gold: -15, flag: 'cp_registered', flag2: 'cp_audit_risk' }),
      idChoice({ class: 'bard' }, 'Trade Fame directly for rank', 'a song as a seal', { fame: -3, flag: 'cp_registered' }),
      idChoice({ class: 'rogue' }, 'Create a counterfeit classification', 'works until it doesn\'t', { flag: 'cp_false_names', flag2: 'cp_audit_risk' }),
    ],
  },
  {
    id: 'cp_performance_review', biome: 'ruins', flag: 'cp_reviewed',
    title: 'Performance Review',
    text: 'The bureau compares the party\'s real decisions with its declared identity.',
    when: { any: [{ flag: 'cp_registered' }, { flag: 'cp_audit_risk' }, { flag: 'cp_false_names' }, { flag: 'cp_system_dissident' }] },
    choices: [
      walk('Pay a 50-gold correction fee', 'discrepancies filed', { gold: -50, flag: 'cp_reviewed' }, { req: { gold: 50 } }),
      walk('Accept a rank-up examination', 'combat trial', { combat: { enemies: ['acolyte'] }, flag: 'cp_reviewed', fame: 3 }),
      walk('Lose Fame to make discrepancies disappear', 'quiet record', { fame: -4, flag: 'cp_reviewed' }),
      idChoice({ class: 'rogue' }, 'Alter the ledger', 'the numbers agree now', { flag: 'cp_reviewed', flag2: 'cp_ledger_forged' }),
      idChoice({ class: 'priest' }, 'Confess and take the honorable trial', 'harder, cleaner', { combat: { enemies: ['cursed_knight'] }, fame: 4, flag: 'cp_reviewed' }),
    ],
  },
  {
    id: 'cp_rank_promotion', biome: 'swamp', flag: 'cp_promoted_title',
    title: 'Rank Promotion Ceremony',
    text: 'A ceremony is being held on a raft while monsters circle beneath it.',
    when: { flag: 'cp_reviewed' },
    choices: [
      walk('Pay for a prestigious title', 'merchant treatment', { gold: -40, flag: 'cp_promoted_title' }, { req: { gold: 40 } }),
      walk('Fight publicly for Fame', 'spectacle', { combat: { enemies: ['croc'] }, fame: 5, flag: 'cp_promoted_title' }),
      walk('Save another candidate', 'surrender the promotion', { fame: 4, flag: 'cp_saved_candidate' }),
      walk('Sabotage and steal the prize gear', 'contraband', { item: 'cp_counterfeit_halo_chakram', fame: -3, flag: 'cp_ceremony_stolen' }),
    ],
  },
  {
    id: 'cp_final_classification', biome: 'hell', flag: 'cp_classified',
    title: 'Your Final Classification',
    text: 'The bureau attempts to permanently classify the party as Heroes, Mercenaries, Criminals, Martyrs, or Anomalies.',
    when: { any: [{ flag: 'cp_promoted_title' }, { flag: 'cp_saved_candidate' }, { flag: 'cp_ceremony_stolen' }] },
    choices: [
      walk('Accept: Heroes', 'Fame and ally support', { fame: 5, flag: 'cp_class_heroes' }),
      walk('Accept: Mercenaries', 'gold and shop access', { gold: 70, flag: 'cp_class_mercenaries' }),
      walk('Accept: Criminals', 'contraband gear', { item: 'cp_black_ledger_stiletto', flag: 'cp_class_criminals' }),
      walk('Accept: Martyrs', 'max-HP blessing', { maxHp: 6, hp: 6, flag: 'cp_class_martyrs' }),
      walk('Accept: Anomalies', 'resist System manipulation (bounded)', { flag: 'cp_class_anomalies', item: 'cp_redacted_support_ticket' }),
    ],
  },
]));
