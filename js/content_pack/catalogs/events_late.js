import { ev, ch } from './helpers.js';
import { PACK_EVENTS } from './events_chains.js';
import './events_rest.js';

const w = (label, hint, o, extra) => ch(label, hint, { text: hint, ...o }, extra);
const idc = (req, label, hint, o) => ch(label, hint, { text: hint, ...o }, { req, identity: true });
const stand = (id, biome, title, text, choices, extra = {}) => ev({
  id, biome, title, text, glyph: extra.glyph || '◆', category: extra.cat || 'mystery',
  w: extra.w ?? 3, tags: extra.tags || ['secret-flag'], once: extra.once, when: extra.when,
  family: extra.family, choices,
});

function chain(family, glyph, arr) {
  for (const [i, s] of arr.entries()) {
    PACK_EVENTS.push(ev({
      id: s.id, family, glyph, biome: s.biome, title: s.title, text: s.text,
      once: true, w: 4, tags: ['secret-flag'], category: s.cat || 'mystery',
      when: s.when || (i ? { flag: arr[i - 1].flag } : undefined), choices: s.choices,
    }));
  }
}

chain('cp_drowned_royals', '👑', [
  { id: 'cp_crown_shallow_water', biome: 'forest', flag: 'cp_crown_taken',
    title: 'A Crown in Shallow Water', text: 'A child-sized crown rests where the creek forgets how to flow.',
    choices: [
      w('Take it', 'marked as royal claimant', { item: 'cp_drowned_crown_fragment', flag: 'cp_crown_taken' }),
      w('Sell it', 'gold', { gold: 40, flag: 'cp_crown_sold' }),
      w('Leave it', 'leave', { flag: 'cp_crown_left' }),
      idc({ class: 'archer' }, 'Trace who carried it from the swamp', 'a scent trail', { flag: 'cp_crown_traced', world: { knowledge: 'cp_crown_path' } }),
    ] },
  { id: 'cp_crownless_statues', biome: 'ruins', flag: 'cp_statues',
    title: 'The Crownless Statues', text: 'Every royal statue has had its head removed.',
    when: { any: [{ flag: 'cp_crown_taken' }, { flag: 'cp_crown_sold' }, { flag: 'cp_crown_left' }, { flag: 'cp_crown_traced' }] },
    choices: [
      w('Restore one using the crown', 'a face returns', { flag: 'cp_statue_restored' }),
      w('Loot the royal crypt', 'gold, disgrace', { gold: 55, fame: -3, flag: 'cp_crypt_looted' }),
      w('Pay a historian', 'true genealogy', { gold: -40, flag: 'cp_genealogy', world: { knowledge: 'cp_dynasty_true' } }, { req: { gold: 40 } }),
      w('Fit the fragment to a headless statue', 'a name returns', { flag: 'cp_statue_restored' }, { req: { flag: 'crownFragment' } }),
      w('Speak as royal claimant', 'the court yields a fee', { gold: 20, flag: 'cp_claimant_paid' }, { req: { flag: 'royalClaimant' } }),
      idc({ class: 'rogue' }, 'Discover the royal bloodline was manufactured', 'a forge-mark on the crown', { flag: 'cp_bloodline_fake', world: { knowledge: 'cp_fake_royals' } }),
      idc({ race: 'dwarf' }, 'Recognize the crown as recently manufactured', 'new gold, old story', { flag: 'cp_bloodline_fake' }),
      idc({ race: 'elf' }, 'Remember the dynasty before this name', 'an older word', { world: { knowledge: 'cp_old_dynasty' }, flag: 'cp_statues' }),
      idc({ race: 'dragonkin' }, 'Claim older authority than the royal line', 'heat older than kings', { fame: 2, flag: 'cp_older_claim' }),
    ] },
  { id: 'cp_court_beneath_bog', biome: 'swamp', flag: 'cp_successor',
    title: 'Court Beneath the Bog', text: 'The drowned court asks the crown-bearer to choose a successor.',
    when: { any: [{ flag: 'cp_statue_restored' }, { flag: 'cp_crypt_looted' }, { flag: 'cp_genealogy' }, { flag: 'cp_bloodline_fake' }, { flag: 'cp_older_claim' }] },
    choices: [
      w('Choose the imprisoned princess', 'her claim', { flag: 'cp_chose_princess', fame: 2 }),
      w('Choose the swamp itself', 'the land rules', { flag: 'cp_chose_swamp' }),
      w('Claim the title', 'you', { flag: 'cp_chose_self', item: 'cp_royal_claimant_mantle' }),
      w('Present a royal wax seal', 'the court files it', { fame: 2, flag: 'cp_seal_filed' }, { req: { item: 'cp_royal_wax_seal' } }),
      w('Melt the crown for gear material', 'slag', { item: 'cp_kiln_memory_slag', flag: 'cp_crown_melted' }),
      w('Refuse monarchy', 'popular Fame', { fame: 5, flag: 'cp_refused_monarchy' }),
      idc({ race: 'orc' }, 'Challenge hereditary rule through trial', 'combat', { combat: { enemies: ['croc'] }, flag: 'cp_trial_rule' }),
      idc({ class: 'bard' }, 'Legitimize or destroy a claimant through narrative', 'a verse decides', { fame: 3, flag: 'cp_song_claim' }),
      idc({ class: 'priest' }, 'Determine whether coronation rites were valid', 'they were not', { flag: 'cp_rites_invalid', fame: 2 }),
    ] },
  { id: 'cp_king_waiting_hell', biome: 'hell', flag: 'cp_royal_closed',
    title: 'The King Waiting in Hell', text: 'The former king reacts to the successor choice.',
    when: { any: [{ flag: 'cp_chose_princess' }, { flag: 'cp_chose_swamp' }, { flag: 'cp_chose_self' }, { flag: 'cp_crown_melted' }, { flag: 'cp_refused_monarchy' }] },
    choices: [
      w('Defend the decision', 'stand by it', { fame: 2, flag: 'cp_decision_defended' }),
      w('Return the crown', 'abdication', { flag: 'cp_crown_returned' }),
      w('Trade the kingdom\'s legitimacy for a relic', 'power', { item: 'cp_crownless_kings_scepter', flag: 'cp_legitimacy_sold' }),
      w('Reveal that the king built one of the original gates', 'the hinge fits', { flag: 'cp_king_built_gate', world: { knowledge: 'cp_king_mason' } }),
      w('Present the drowned fragment as proof of claim', 'the court still knows this gold', { fame: 2, flag: 'cp_fragment_shown' }, { req: { flag: 'crownFragment' } }),
    ] },
]);

chain('cp_gate_mason', '🧱', [
  { id: 'cp_worker_not_wizard', biome: 'forest', flag: 'cp_mason_met',
    title: 'A Worker, Not a Wizard', text: 'A mason insists gates are infrastructure, not magic.',
    choices: [
      w('Pay 30 gold for a structural map', 'map', { gold: -30, item: 'cp_gate_mason_plumb', flag: 'cp_mason_map' }, { req: { gold: 30 } }),
      w('Help carry stone', 'HP for Fame', { hp: -8, fame: 3, flag: 'cp_mason_helped' }),
      w('Buy a repair token', 'token', { gold: -25, consumable: 'cp_masons_chalk', flag: 'cp_repair_token' }, { req: { gold: 25 } }),
      w('Mock the claim', 'later: unstable gate', { fame: -1, flag: 'cp_mocked_mason' }),
      idc({ race: 'dwarf' }, 'Receive a full structural route', 'you speak masonry', { flag: 'cp_mason_map', world: { knowledge: 'cp_full_structure' } }),
      idc({ race: 'orc' }, 'Provide labor through HP', 'a day\'s work', { hp: -10, fame: 3, flag: 'cp_mason_helped' }),
      idc({ race: 'halfling' }, 'Find maintenance tunnels', 'a smaller door', { flag: 'cp_mason_tunnels' }),
      idc({ class: 'mage' }, 'Understand the portal but not the masonry', 'half a map', { flag: 'cp_portal_only' }),
      idc({ class: 'spellsword' }, 'Learn why both are necessary', 'hinge and spell', { flag: 'cp_both_necessary' }),
    ] },
  { id: 'cp_bridge_from_doors', biome: 'frost', flag: 'cp_bridge',
    title: 'The Bridge Built from Doors', text: 'The mason needs help finishing a crossing.',
    when: { any: [{ flag: 'cp_mason_map' }, { flag: 'cp_mason_helped' }, { flag: 'cp_repair_token' }, { flag: 'cp_mocked_mason' }, { flag: 'cp_mason_tunnels' }] },
    choices: [
      w('Contribute unequipped gear as material', 'offering', { offering: { kinds: ['pack'] }, flag: 'cp_bridge_geared' }, { req: { offering: true } }),
      w('Spend 60 gold', 'labor hired', { gold: -60, flag: 'cp_bridge_paid' }, { req: { gold: 60 } }),
      w('Cross the unfinished bridge', 'HP risk', { hp: -12, flag: 'cp_bridge_rushed' }),
      idc({ class: 'archer' }, 'Ranger: find a safer natural path', 'ice that holds', { flag: 'cp_bridge_path' }),
      idc({ class: 'monk' }, 'Monk: find a safer natural path', 'weightless steps', { flag: 'cp_bridge_path' }),
      idc({ race: 'dragonkin' }, 'Fuse gate material', 'heat welds the doors', { hp: -6, flag: 'cp_bridge_fused' }),
    ] },
  { id: 'cp_last_gate_inspection', biome: 'hell', flag: 'cp_mason_closed',
    title: 'The Last Gate Inspection', text: 'The mason is certifying something that should not be certified.',
    when: { any: [{ flag: 'cp_bridge_geared' }, { flag: 'cp_bridge_paid' }, { flag: 'cp_bridge_rushed' }, { flag: 'cp_bridge_path' }, { flag: 'cp_bridge_fused' }] },
    choices: [
      w('Help certify a safe escape gate', 'honest work', { fame: 4, flag: 'cp_safe_cert' }),
      w('Bribe the mason to certify an unsafe shortcut', 'gold for danger', { gold: -50, flag: 'cp_unsafe_cert' }, { req: { gold: 50 } }),
      w('Expose the employer that weakened the gates', 'Fame', { fame: 5, flag: 'cp_employer_exposed' }),
      w('Let the mason collapse the gate behind you', 'no retreat, major reward', { flag: 'cp_no_retreat', item: 'cp_gatebreaker_greatsword' }),
    ] },
]);

chain('cp_ashen_rivals', '🔥', [
  { id: 'cp_campfire_across_path', biome: 'forest', flag: 'cp_rival_met',
    title: 'Campfire Across the Path', text: 'A rival party offers food and information. They are built from normalized class and bloodline mirrors, not an exponential cast list.',
    choices: [
      w('Share a potion', 'trust', { useItem: 'potion_s', flag: 'cp_rival_trust' }, { req: { item: 'potion_s' } }),
      w('Gamble 25 gold', 'dice', { gold: -25, flag: 'cp_rival_gambled' }, { req: { gold: 25 } }),
      w('Boast for Fame', 'noise', { fame: 3, flag: 'cp_rival_boast' }),
      w('Steal their map', 'map, distrust', { item: 'cp_gate_surveyor_last_report', flag: 'cp_rival_stolen', fame: -2 }),
      w('Challenge their leader', 'duel', { combat: { enemies: ['orc'] }, flag: 'cp_rival_duel' }),
      idc({ class: 'bard' }, 'Propose a public contest', 'songs, not swords', { fame: 3, flag: 'cp_rival_contest' }),
      idc({ class: 'warrior' }, 'Offer a formal duel', 'rules', { combat: { enemies: ['orc'] }, fame: 2, flag: 'cp_rival_duel' }),
      idc({ class: 'rogue' }, 'Arrange a secret exchange', 'quiet trade', { gold: 20, flag: 'cp_rival_secret' }),
      idc({ class: 'priest' }, 'Open an ideological dispute', 'what is a hero', { fame: 2, flag: 'cp_rival_ideology' }),
    ] },
  { id: 'cp_rivals_missing_member', biome: 'ruins', flag: 'cp_rival_missing',
    title: "The Rival's Missing Member", text: 'The party finds the rival\'s abandoned support character.',
    when: { any: [{ flag: 'cp_rival_trust' }, { flag: 'cp_rival_gambled' }, { flag: 'cp_rival_boast' }, { flag: 'cp_rival_stolen' }, { flag: 'cp_rival_duel' }, { flag: 'cp_rival_contest' }] },
    choices: [
      w('Rescue them', 'Fame', { fame: 4, flag: 'cp_rival_rescued' }),
      w('Recruit them temporarily', 'allowlisted companion flag', { flag: 'cp_rival_recruited' }),
      w('Demand payment', 'gold', { gold: 30, flag: 'cp_rival_ransomed' }),
      w('Conceal the discovery', 'later betrayal flag', { flag: 'cp_rival_concealed' }),
      idc({ class: 'necromancer' }, 'Argue over whether they are still a member', 'the dead keep roster spots', { flag: 'cp_rival_dead_member' }),
    ] },
  { id: 'cp_rankings_split_us', biome: 'frost', flag: 'cp_rival_split',
    title: 'The Rankings Split Us', text: 'The System offers a bounty to whichever party defeats the other.',
    when: { any: [{ flag: 'cp_rival_rescued' }, { flag: 'cp_rival_recruited' }, { flag: 'cp_rival_ransomed' }, { flag: 'cp_rival_concealed' }] },
    choices: [
      w('Refuse together', 'solidarity', { fame: 3, flag: 'cp_rival_allied' }),
      w('Compete nonlethally for Fame', 'contest', { fame: 4, flag: 'cp_rival_contest2' }),
      w('Ambush them', 'gold, disgrace', { gold: 40, fame: -4, flag: 'cp_rival_ambush' }),
      w('Secretly accept the bounty', 'later betrayal', { gold: 25, flag: 'cp_rival_secret_bounty' }),
    ] },
  { id: 'cp_two_parties_one_gate', biome: 'hell', flag: 'cp_rival_closed',
    title: 'Two Parties, One Gate', text: 'The last door is only wide enough for one story.',
    when: { any: [{ flag: 'cp_rival_allied' }, { flag: 'cp_rival_contest2' }, { flag: 'cp_rival_ambush' }, { flag: 'cp_rival_secret_bounty' }] },
    choices: [
      w('Unite for a harder shared encounter', 'together', { combat: { enemies: ['void_eye', 'horned_stalker'] }, fame: 4, flag: 'cp_rival_united' }),
      w('Duel for access', 'one door', { combat: { enemies: ['court_usurper'] }, flag: 'cp_rival_duel_gate' }),
      w('Give them the gate and take their supplies', 'yield', { gold: 50, item: 'cp_ashen_rival_ember', flag: 'cp_rival_yielded' }),
      w('Sacrifice Fame so both pass', 'shared cost', { fame: -6, flag: 'cp_both_pass' }),
    ] },
]);

/* Ruins 64-73 */
PACK_EVENTS.push(
  stand('cp_auction_curses', 'ruins', 'Auction of Unwanted Curses', 'A ghost auctions cursed equipment.', [
    w('Bid gold', 'a curse with a blade', { gold: -40, item: 'cp_applause_knife' }, { req: { gold: 40 } }),
    w('Offer a potion', 'they drink', { useItem: 'potion_s', item: 'cp_cowards_first_sword' }, { req: { item: 'potion_s' } }),
    w('Trade an existing cursed item', 'swap', { offering: { kinds: ['pack'] } }, { req: { offering: true } }),
    w('Buy the curse without the gear', 'large reward, future complication', { gold: 70, flag: 'cp_curse_unbound' }),
  ], { glyph: '👻', cat: 'equipment' }),
  stand('cp_amphitheater_one', 'ruins', 'The Amphitheater of One Spectator', 'An invisible audience demands entertainment.', [
    w('Perform', 'Fame', { fame: 4 }),
    w('Fight a summoned champion', 'combat', { combat: { enemies: ['cursed_knight'] }, fame: 3 }),
    w('Pay 40 gold to skip', 'sink', { gold: -40 }, { req: { gold: 40 } }),
    idc({ class: 'rogue' }, 'Fake the applause', 'they buy it', { fame: 2, flag: 'cp_fake_applause' }),
    idc({ class: 'monk' }, 'Perform a discipline demonstration', 'unique blessing', { item: 'cp_empty_hand_seal', fame: 2 }),
  ], { glyph: '🎭', cat: 'social' }),
  stand('cp_library_borrowed', 'ruins', 'Library of Borrowed Memories', 'Books can be read only by surrendering memories.', [
    w('Lose 2 max HP for boss knowledge', 'costly reading', { maxHp: -2, world: { knowledge: 'cp_library_boss' } }),
    w('Lose Fame to learn a secret route', 'a quieter stair', { fame: -3, flag: 'cp_secret_route' }),
    w('Pay 60 gold for a sanitized copy', 'safe text', { gold: -60, world: { knowledge: 'cp_library_safe' } }, { req: { gold: 60 } }),
    w('Tear out a page', 'guardian', { combat: { enemies: ['archive_warden'] } }),
  ], { glyph: '📚' }),
  stand('cp_ghost_smith', 'ruins', 'The Ghost Smith', 'A smith can reforge one chosen unequipped item.', [
    w('Pay 60 gold', 'reforge', { gold: -60, offering: { kinds: ['pack'] } }, { req: { gold: 60 } }),
    w('Pay 6 HP', 'blood quench', { hp: -6, offering: { kinds: ['pack'] } }),
    w('Offer another item as fuel', 'double offering', { offering: { kinds: ['pack'] } }, { req: { offering: true } }),
    w('Give the smith\'s name back with Fame', 'superior reforge', { fame: -4, flag: 'cp_smith_named' }),
  ], { glyph: '⚒️', cat: 'equipment' }),
  stand('cp_grave_tax', 'ruins', 'Grave-Tax Collector', 'The dead claim every living person owes interest.', [
    w('Pay 10% of current gold', 'interest', { goldPct: -0.1 }),
    w('Surrender a potion', 'tithe', { useItem: 'potion_s' }, { req: { item: 'potion_s' } }),
    w('Challenge the legal basis', 'maybe you win', { fame: 2, combat: { enemies: ['skeleton'] } }),
    idc({ class: 'priest' }, 'Invoke burial law', 'the collector blinks', { fame: 2, flag: 'cp_burial_law' }),
    idc({ class: 'rogue' }, 'Produce a receipt from someone else\'s grave', 'already paid', { flag: 'cp_grave_receipt' }),
    w('Present a funeral receipt', 'already paid this cycle', { flag: 'cp_grave_receipt' }, { req: { flag: 'paidGrave' } }),
  ], { glyph: '💀' }),
  stand('cp_collapsing_archive', 'ruins', 'Collapsing Archive', 'There is time to save only one collection.', [
    w('Save military records', 'boss information', { world: { knowledge: 'cp_military_records' } }),
    w('Save medical records', 'potion access', { consumable: 'cp_stitchleaf_tonic', flag: 'cp_med_records' }),
    w('Save financial records', 'gold and discount', { gold: 40, flag: 'cp_fin_records' }),
    w('Save forbidden records', 'System flag', { flag: 'cp_forbidden_records' }),
    w('Save the trapped archivist', 'Fame', { fame: 4, flag: 'cp_saved_archivist' }),
  ], { glyph: '📂', cat: 'dangerous' }),
  stand('cp_empty_armory', 'ruins', 'The Empty Armory', 'Every weapon has been carefully removed except one terrible-looking item.', [
    w('Take it', 'secretly powerful', { item: 'cp_towerbreaker_maul' }),
    w('Search behind the racks', 'trap', { hp: -10, gold: 20 }),
    w('Pay a spectral quartermaster', 'fair issue', { gold: -35, item: 'cp_gate_iron_sword' }, { req: { gold: 35 } }),
    w('Leave your own item to preserve balance', 'offering', { offering: { kinds: ['pack'] } }, { req: { offering: true } }),
  ], { glyph: '🛡️', cat: 'equipment' }),
  stand('cp_unproven_crime', 'ruins', 'Trial of the Unproven Crime', 'A court charges the party with something it will supposedly do later.', [
    w('Pay bail', 'gold', { gold: -40 }, { req: { gold: 40 } }),
    w('Accept a combat trial', 'fight', { combat: { enemies: ['cursed_knight'] }, fame: 2 }),
    w('Sacrifice Fame and plead guilty', 'record', { fame: -4, flag: 'cp_pled_guilty' }),
    w('Present evidence from a previous chain', 'if you have flags', { fame: 2, flag: 'cp_presented_evidence' }),
    w('Escape and become wanted', 'wanted', { flag: 'cp_wanted', fame: -2 }),
  ], { glyph: '⚖️' }),
  stand('cp_coins_your_face', 'ruins', 'Coins Minted with Your Face', 'A pouch contains currency depicting the active character as ruler.', [
    w('Spend it', 'false timeline risk', { gold: 40, flag: 'cp_false_timeline' }),
    w('Melt it into 50 gold', 'honest metal', { gold: 50 }),
    w('Keep it for a throne callback', 'pocketed', { flag: 'cp_face_coins' }),
    w('Donate it', 'Fame', { fame: 3 }),
    idc({ class: 'mage' }, 'Detect the coins are older than the ruins', 'a paradox', { flag: 'cp_old_coins', world: { knowledge: 'cp_coins_older' } }),
  ], { glyph: '🪙' }),
  stand('cp_statue_changes_class', 'ruins', 'The Statue That Changes Class', 'A statue depicts whichever class examines it.', [
    w('Pray for a class-flavored blessing', 'temporary', { flag: 'cp_class_blessing', fame: 1 }),
    w('Break off a class-specific gear component', 'piece', { item: 'cp_last_bastion_helm' }),
    w('Spend Fame to restore the original figure', 'honesty', { fame: -3, flag: 'cp_statue_restored_true' }),
    w('Hidden class: reveal a redacted inscription', 'if you qualify', { world: { knowledge: 'cp_redacted_inscription' } }),
  ], { glyph: '🗿' }),
);

export { PACK_EVENTS };
