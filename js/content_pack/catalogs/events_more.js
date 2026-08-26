import { ev, ch } from './helpers.js';
import { PACK_EVENTS } from './events_chains.js';

const w = (label, hint, o, extra) => ch(label, hint, { text: hint, ...o }, extra);
const idc = (req, label, hint, o) => ch(label, hint, { text: hint, ...o }, { req, identity: true });

function steps(family, glyph, arr) {
  return arr.map((s, i) => ev({
    id: s.id, family, glyph, biome: s.biome, category: s.cat || 'mystery',
    title: s.title, text: s.text, once: true, w: s.w ?? 4,
    when: s.when || (i ? { flag: arr[i - 1].flag } : undefined),
    choices: s.choices, tags: ['secret-flag'],
  }));
}

PACK_EVENTS.push(...steps('cp_crimson_save', '🩸', [
  { id: 'cp_save_your_blood', biome: 'ruins', flag: 'cp_ward_taken',
    title: 'Save Your Blood', text: 'A red crystal offers to "remember your death." This is a diegetic bargain, not a save-file restore.',
    choices: [
      w('Permanently lose 4 max HP for a lethal ward', 'ward + cost', { maxHp: -4, item: 'cp_crimson_crystal_shard', flag: 'cp_ward_taken' }),
      w('Pay 80 gold for a weaker ward', 'gold ward', { gold: -80, flag: 'cp_ward_weak', item: 'cp_crimson_continuance' }, { req: { gold: 80 } }),
      w('Insert a potion', 'corrupted draught', { useItem: 'potion_s', consumable: 'cp_false_resurrection_draught', flag: 'cp_ward_corrupt' }, { req: { item: 'potion_s' } }),
      w('Refuse; mark it fraudulent', 'you saw through it', { flag: 'cp_crystal_fraud', fame: 2, item: 'cp_crimson_memory_mail' }),
      idc({ race: 'dragonkin' }, 'Recognize broken soul-storage', 'you know this machine', { flag: 'cp_crystal_fraud', world: { knowledge: 'cp_soul_storage' } }),
      idc({ race: 'tiefling' }, 'Renegotiate the death clause', 'smaller print', { maxHp: -2, flag: 'cp_ward_taken' }),
      idc({ class: 'necromancer' }, 'Extract a stored unlived death', 'a mark, not a save', { flag: 'cp_unlived_stored', item: 'cp_scythe_unlived_deaths' }),
      idc({ class: 'priest' }, 'Reject false resurrection', 'theology holds', { fame: 2, flag: 'cp_crystal_fraud' }),
      idc({ class: 'monk' }, 'Refuse continuity of the body', 'memory without the wound', { flag: 'cp_crystal_fraud', fame: 1 }),
    ] },
  { id: 'cp_load_unlived_injury', biome: 'swamp', flag: 'cp_injury_dealt',
    title: 'Load an Unlived Injury', text: 'The crystal presents wounds from a timeline that has not happened.',
    when: { any: [{ flag: 'cp_unlived_stored' }, { flag: 'cp_ward_taken' }, { flag: 'cp_ward_weak' }, { flag: 'cp_crystal_fraud' }, { flag: 'cp_ward_corrupt' }] },
    choices: [
      w('Accept the wounds now for a powerful item', 'pay HP, gain gear', { hp: -16, item: 'cp_previous_timeline_axe', flag: 'cp_injury_dealt' }),
      w('Pay gold to delete the recorded future', 'erased', { gold: -55, flag: 'cp_future_deleted' }, { req: { gold: 55 } }),
      w('Transfer the wound to a consenting teammate', 'co-op only; solo: you keep it', { hp: -8, flag: 'cp_injury_shared' }),
      w('Break the crystal', 'echo fight', { combat: { enemies: ['shade'] }, flag: 'cp_crystal_broken' }),
    ] },
  { id: 'cp_collector_continued_lives', biome: 'hell', flag: 'cp_crimson_closed',
    title: 'The Collector of Continued Lives', text: 'Every avoided death accumulated a debt.',
    when: { any: [{ flag: 'cp_injury_dealt' }, { flag: 'cp_future_deleted' }, { flag: 'cp_crystal_broken' }, { flag: 'cp_injury_shared' }] },
    choices: [
      w('Surrender the ward and settle', 'peace', { flag: 'cp_crimson_closed', resolveCurse: 'maxhp_ward' }),
      w('Fight the collector', 'combat', { combat: { enemies: ['wight'] }, item: 'cp_crimson_checkpoint_blade', flag: 'cp_crimson_closed' }),
      w('Sacrifice Fame so history says the deaths never happened', 'erasure', { fame: -6, flag: 'cp_crimson_closed' }),
      w('Admit it was never a save point', 'the interface fractures', { flag: 'cp_system_fracture', item: 'cp_administrator_error_scepter' }),
    ] },
]));

PACK_EVENTS.push(...steps('cp_echo_party', '👥', [
  { id: 'cp_familiar_corpses', biome: 'forest', flag: 'cp_echo_seen',
    title: 'Familiar Corpses', text: 'The party finds bodies wearing exact copies of its equipment.',
    choices: [
      w('Take one copied item', 'hidden instability', { item: 'cp_mirror_splinter', flag: 'cp_echo_instability' }),
      w('Bury them', 'Fame', { fame: 3, flag: 'cp_echo_buried' }),
      w('Examine the cause of death', 'future boss move', { flag: 'cp_echo_telegraph', world: { knowledge: 'cp_future_boss_move' } }),
      w('Refuse to touch the bodies', 'leave', { flag: 'cp_echo_refused' }),
      idc({ race: 'elf' }, 'Remember something from the other timeline', 'a borrowed memory', { flag: 'cp_echo_seen', world: { knowledge: 'cp_other_timeline' } }),
      idc({ race: 'beastfolk' }, 'Scent: identical, fear different', 'prey-memory', { flag: 'cp_echo_seen' }),
      idc({ race: 'human' }, 'Temporarily use an echo\'s class technique', 'borrowed mastery flag', { flag: 'cp_echo_borrow' }),
    ] },
  { id: 'cp_messages_handwriting', biome: 'ruins', flag: 'cp_notes_read',
    title: 'Messages in Your Handwriting', text: 'Notes warn the party against decisions it has not made yet.',
    when: { any: [{ flag: 'cp_echo_instability' }, { flag: 'cp_echo_buried' }, { flag: 'cp_echo_telegraph' }, { flag: 'cp_echo_refused' }, { flag: 'cp_echo_seen' }] },
    choices: [
      w('Follow the warning', 'avoid the next worst outcome', { flag: 'cp_follow_warning' }),
      w('Burn the notes', 'System approval', { fame: 2, flag: 'cp_notes_burned' }),
      w('Sell them to a scholar', 'gold', { gold: 40, flag: 'cp_notes_sold' }),
      idc({ class: 'mage' }, 'Detect one message from a different party member', 'authorship', { flag: 'cp_notes_split' }),
      idc({ class: 'bard' }, 'Compare versions of the same party song', 'two choruses', { fame: -1, flag: 'cp_notes_truth' }),
      idc({ class: 'spellsword' }, 'Exchange weapons with the echo counterpart', 'mirror steel', { item: 'cp_mirror_exchange_saber', flag: 'cp_notes_read' }),
    ] },
  { id: 'cp_echo_party_frost', biome: 'frost', flag: 'cp_echo_duel',
    title: 'Echo Party', text: 'The dead party appears alive and claims the current group is the copy.',
    when: { any: [{ flag: 'cp_follow_warning' }, { flag: 'cp_notes_burned' }, { flag: 'cp_notes_sold' }, { flag: 'cp_notes_split' }, { flag: 'cp_notes_truth' }, { flag: 'cp_notes_read' }] },
    choices: [
      w('Duel counterpart against counterpart', 'fight', { combat: { enemies: ['frozen_soldier'] }, flag: 'cp_echo_duel' }),
      w('Exchange one chosen gear item', 'offering', { offering: { kinds: ['pack'] }, flag: 'cp_echo_swap' }, { req: { offering: true } }),
      w('Compare memories', 'lose Fame, gain truth', { fame: -3, flag: 'cp_echo_truth', world: { knowledge: 'cp_both_copies' } }),
      w('Co-op: vote which party continues', 'host-authoritative vote; solo: you choose to stay', { flag: 'cp_echo_voted' }),
    ] },
  { id: 'cp_one_timeline_throne', biome: 'hell', flag: 'cp_echo_closed',
    title: 'Only One Timeline Reaches the Throne', text: 'The remaining echo party returns.',
    when: { any: [{ flag: 'cp_echo_duel' }, { flag: 'cp_echo_swap' }, { flag: 'cp_echo_truth' }, { flag: 'cp_echo_voted' }] },
    choices: [
      w('Merge timelines', 'mixed blessing and curse', { item: 'cp_second_timeline_plate', flag: 'cp_echo_merged' }),
      w('Destroy the echoes', 'unstable gear', { item: 'cp_previous_timeline_axe', flag: 'cp_echo_destroyed' }),
      w('Let them proceed', 'consolation relic', { item: 'cp_portrait_previous_party', flag: 'cp_echo_yielded' }),
      w('Prove both parties are manipulated', 'joint assault flag', { flag: 'cp_system_joint', fame: 3, resolveCurse: ['echo_hit', 'echo_last_skill'] }),
    ] },
]));

PACK_EVENTS.push(...steps('cp_bell_companion', '🔔', [
  { id: 'cp_bell_beneath_roots', biome: 'forest', flag: 'cp_bell_seen',
    title: 'The Bell Beneath the Roots', text: 'The inscription says: "Ring only when willing to leave one behind." Irreversible options require unanimous confirmation in co-op; solo is unanimous.',
    choices: [
      w('Ignore it', 'walk on', { flag: 'cp_bell_ignored' }),
      w('Ring without naming anyone', 'everyone loses a little HP', { hp: -6, flag: 'cp_bell_rung' }),
      w('Volunteer', 'you become bell_bearer', { flag: 'cp_bell_bearer', fame: 2 }),
      w('Break the clapper', 'lesser material', { gold: 25, item: 'cp_bell_clapper_shard', flag: 'cp_bell_broken' }),
      w('Wield the clapper as a greatclub', 'it still wants a missing name', { item: 'cp_bell_clapper_greatclub', flag: 'cp_bell_broken' }),
      idc({ race: 'orc' }, 'Swear the abandonment burden personally', 'oath', { flag: 'cp_bell_bearer', fame: 1 }),
      idc({ race: 'halfling' }, 'Find an impossible path that leaves no one', 'a gap in the roots', { flag: 'cp_bell_skipped' }),
      idc({ class: 'bard' }, 'Keep a volunteer\'s presence alive through song', 'a name in the refrain', { flag: 'cp_bell_song' }),
    ] },
  { id: 'cp_door_counts_one_less', biome: 'ruins', flag: 'cp_door_paid',
    title: 'The Door That Counts One Less', text: 'The next sealed door opens only if one climber remains outside.',
    when: { any: [{ flag: 'cp_bell_rung' }, { flag: 'cp_bell_bearer' }, { flag: 'cp_bell_broken' }, { flag: 'cp_bell_song' }, { flag: 'cp_bell_skipped' }, { flag: 'cp_bell_ignored' }] },
    choices: [
      w('A volunteer sits out the next event', 'no reward next card (flag)', { flag: 'cp_volunteer_out' }),
      w('Everyone pays 35 gold', 'buy the count', { gold: -35, flag: 'cp_door_paid' }, { req: { gold: 35 } }),
      w('Sacrifice a potion from every player', 'one potion', { useItem: 'potion_s', flag: 'cp_door_paid' }, { req: { item: 'potion_s' } }),
      idc({ class: 'warrior' }, 'Hold the door', 'severe HP', { hp: -18, flag: 'cp_door_paid', fame: 3 }),
      idc({ class: 'monk' }, 'Remain behind without being spiritually separated', 'empty-hand passage', { hp: -8, flag: 'cp_door_paid' }),
    ] },
  { id: 'cp_empty_place_camp', biome: 'swamp', flag: 'cp_imitation',
    title: 'The Empty Place at Camp', text: 'The dungeon creates a flawless imitation of whoever previously volunteered.',
    when: { any: [{ flag: 'cp_volunteer_out' }, { flag: 'cp_door_paid' }, { flag: 'cp_bell_bearer' }] },
    choices: [
      w('Accept the imitation as temporary support', 'betrayal risk, an empty seat', { flag: 'cp_imitation_accepted', item: 'cp_the_empty_seat' }),
      w('Reject it', 'Fame', { fame: 3, flag: 'cp_imitation_rejected' }),
      w('Give it the volunteer\'s gear to stabilize it', 'offering', { offering: { kinds: ['pack'] }, flag: 'cp_imitation_fed' }, { req: { offering: true } }),
      w('Ask what happened in the abandoned timeline', 'a story', { flag: 'cp_imitation_asked', world: { knowledge: 'cp_abandoned_timeline' } }),
      idc({ race: 'beastfolk' }, 'The pack refuses to recognize the imitation', 'scent mismatch', { fame: 2, flag: 'cp_imitation_rejected' }),
    ] },
  { id: 'cp_bell_rings_again', biome: 'hell', flag: 'cp_bell_closed',
    title: 'When the Bell Rings Again', text: 'The original volunteer is trapped behind the gate. Permanent abandon requires explicit unanimous consent. Disconnect is never this condition.',
    when: { any: [{ flag: 'cp_imitation_accepted' }, { flag: 'cp_imitation_rejected' }, { flag: 'cp_imitation_fed' }, { flag: 'cp_imitation_asked' }] },
    choices: [
      w('Pay a large party-wide ransom', 'gold', { gold: -90, flag: 'cp_bell_ransomed', resolveCurse: ['needs_downed_ally', 'missing_allies'] }, { req: { gold: 90 } }),
      w('Surrender the imitation', 'it goes instead', { flag: 'cp_imitation_surrendered' }),
      w('Fight a rescue with reduced starting health', 'hard rescue', { hp: -12, combat: { enemies: ['hag'] }, flag: 'cp_bell_rescued' }),
      w('Permanently abandon them for a unique relic (unanimous)', 'Last Companion\'s Bell', { item: 'cp_last_companions_bell', flag: 'cp_bell_abandoned', fame: -5 }),
    ] },
]));

PACK_EVENTS.push(...steps('cp_nameless_saint', '🕊️', [
  { id: 'cp_shrine_without_idol', biome: 'forest', flag: 'cp_shrine_gift',
    title: 'Shrine Without an Idol', text: 'A shrine asks for aid but displays no god.',
    choices: [
      w('Donate a potion', 'empty bowl drinks', { useItem: 'potion_s', flag: 'cp_shrine_potion' }, { req: { item: 'potion_s' } }),
      w('Donate 30 gold', 'coins vanish', { gold: -30, flag: 'cp_shrine_gold' }, { req: { gold: 30 } }),
      w('Donate blood', 'HP', { hp: -8, flag: 'cp_shrine_blood' }),
      w('Write a party member\'s name on the altar', 'a name sticks', { flag: 'cp_saint_named' }),
      idc({ class: 'priest' }, 'Ask whether worship creates divinity or merely power', 'a theological pause', { flag: 'cp_shrine_question', fame: 1 }),
      idc({ race: 'tiefling' }, 'Find infernal ownership in the prayers', 'a clause', { flag: 'cp_shrine_infernal' }),
      idc({ race: 'human' }, 'Become the provisional face of the nameless saint', 'a borrowed halo', { flag: 'cp_saint_named', fame: 2 }),
      idc({ class: 'bard' }, 'Preserve every donor\'s name', 'a list', { flag: 'cp_shrine_list', fame: 1 }),
      idc({ class: 'necromancer' }, 'Speak with those whose miracles were reassigned', 'the dead still file paperwork', { flag: 'cp_shrine_dead' }),
    ] },
  { id: 'cp_miracles_wrong_name', biome: 'frost', flag: 'cp_worship',
    title: 'Miracles in the Wrong Name', text: 'Travelers now worship the named party member.',
    when: { any: [{ flag: 'cp_saint_named' }, { flag: 'cp_shrine_potion' }, { flag: 'cp_shrine_gold' }, { flag: 'cp_shrine_blood' }, { flag: 'cp_shrine_question' }, { flag: 'cp_shrine_infernal' }, { flag: 'cp_shrine_list' }, { flag: 'cp_shrine_dead' }] },
    choices: [
      w('Accept the worship', 'Fame', { fame: 5, flag: 'cp_worship_accepted' }),
      w('Correct the story', 'smaller honest blessing', { fame: 2, item: 'cp_empty_saint_icon', flag: 'cp_worship_corrected' }),
      w('Charge the pilgrims for healing', 'gold, disgrace', { gold: 45, fame: -2, flag: 'cp_worship_sold' }),
      idc({ class: 'priest' }, 'Redirect the faith to the nameless dead', 'the empty altar fills', { fame: 3, flag: 'cp_worship_dead' }),
    ] },
  { id: 'cp_canonization', biome: 'hell', flag: 'cp_saint_closed',
    title: 'Canonization', text: 'The dungeon offers to turn the chosen character into an immortal saint.',
    when: { any: [{ flag: 'cp_worship_accepted' }, { flag: 'cp_worship_corrected' }, { flag: 'cp_worship_sold' }, { flag: 'cp_worship_dead' }] },
    choices: [
      w('Accept: party boon, personal max-HP cost', 'canonized', { maxHp: -6, fame: 4, item: 'cp_nameless_reliquary', flag: 'cp_canonized' }),
      w('Refuse: receive the saint\'s relic', 'icon', { item: 'cp_empty_saint_icon', flag: 'cp_saint_refused' }),
      w('Expose the miracle as a System function', 'fracture', { flag: 'cp_miracle_system', fame: 2 }),
      w('Sacrifice Fame to canonize forgotten NPCs', 'their names, not yours', { fame: -8, flag: 'cp_npc_saints' }),
    ] },
]));

export { PACK_EVENTS as PACK_EVENTS_A };
