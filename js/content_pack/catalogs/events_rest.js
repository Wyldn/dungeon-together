import { ev, ch } from './helpers.js';
import { PACK_EVENTS } from './events_chains.js';
import './events_more.js';

const w = (label, hint, o, extra) => ch(label, hint, { text: hint, ...o }, extra);
const idc = (req, label, hint, o) => ch(label, hint, { text: hint, ...o }, { req, identity: true });
const E = (p) => ev({ w: 3, category: 'mystery', type: 'story', tags: ['secret-flag'], ...p });

function chain(family, glyph, arr) {
  for (const [i, s] of arr.entries()) {
    PACK_EVENTS.push(ev({
      id: s.id, family, glyph, biome: s.biome, category: s.cat || 'mystery',
      title: s.title, text: s.text, once: true, w: 4, tags: ['secret-flag'],
      when: s.when || (i ? { flag: arr[i - 1].flag } : undefined),
      choices: s.choices,
    }));
  }
}

chain('cp_gate_beast_egg', '🥚', [
  { id: 'cp_hatched_before_laid', biome: 'forest', flag: 'cp_egg_held',
    title: 'Something Hatched Before It Was Laid', text: 'A warm egg occasionally displays a System tooltip.',
    choices: [
      w('Carry it', 'future event weight', { flag: 'cp_egg_carried' }),
      w('Sell it for 50 gold', 'sold', { gold: 50, flag: 'cp_egg_sold' }),
      w('Feed it a potion', 'it drinks', { useItem: 'potion_s', flag: 'cp_egg_fed' }, { req: { item: 'potion_s' } }),
      w('Crack it now', 'consumable or hostile', { randomOutcome: [
        { text: 'A tonic spills out.', consumable: 'cp_corpse_flower_nectar', flag: 'cp_egg_cracked' },
        { text: 'Something hungry answers.', combat: { enemies: ['spider'] }, flag: 'cp_egg_hostile' },
      ] }),
    ] },
  { id: 'cp_egg_chooses_class', biome: 'ruins', flag: 'cp_egg_trained',
    title: 'The Egg Chooses a Class', text: 'The egg responds differently to the party\'s classes.',
    when: { any: [{ flag: 'cp_egg_carried' }, { flag: 'cp_egg_fed' }, { flag: 'cp_egg_sold' }, { flag: 'cp_egg_cracked' }, { flag: 'cp_egg_hostile' }] },
    choices: [
      idc({ class: 'warrior' }, 'Harden its shell into armor', 'shell-plate', { item: 'cp_gate_parasite_carapace', flag: 'cp_egg_trained' }),
      idc({ class: 'archer' }, 'Teach it a scent', 'prey-memory', { flag: 'cp_egg_scent' }),
      idc({ class: 'mage' }, 'Expose it to elemental residue', 'hingefire', { flag: 'cp_egg_elem' }),
      idc({ class: 'rogue' }, 'Teach it to hide from the System', 'unregistered hatchling', { flag: 'cp_egg_hidden' }),
      idc({ class: 'priest' }, 'Bless it', 'a small miracle', { fame: 2, flag: 'cp_egg_blessed' }),
      idc({ class: 'monk' }, 'Listen to the heartbeat', 'rhythm', { flag: 'cp_egg_heart' }),
      w('Leave the lesson unfinished', 'it waits', { flag: 'cp_egg_trained' }),
    ] },
  { id: 'cp_hunger_without_mouth', biome: 'swamp', flag: 'cp_egg_fed2',
    title: 'Hunger Without a Mouth', text: 'It demands a chosen gear item, potion, 60 gold, or blood. The contribution determines its nature.',
    when: { any: [{ flag: 'cp_egg_trained' }, { flag: 'cp_egg_scent' }, { flag: 'cp_egg_elem' }, { flag: 'cp_egg_hidden' }, { flag: 'cp_egg_blessed' }, { flag: 'cp_egg_heart' }] },
    choices: [
      w('Feed it gear', 'greedy', { offering: { kinds: ['pack'] }, flag: 'cp_egg_greedy' }, { req: { offering: true } }),
      w('Feed it a potion', 'protective', { useItem: 'potion_s', flag: 'cp_egg_protective' }, { req: { item: 'potion_s' } }),
      w('Feed it 60 gold', 'intelligent', { gold: -60, flag: 'cp_egg_smart' }, { req: { gold: 60 } }),
      w('Feed it blood', 'predatory', { hp: -10, flag: 'cp_egg_predatory' }),
      w('Walk away', 'it remembers hunger', { flag: 'cp_egg_starved' }),
    ] },
  { id: 'cp_hatching_at_gate', biome: 'hell', flag: 'cp_egg_closed',
    title: 'Hatching at the Gate', text: 'The egg decides what it will be.',
    when: { any: [{ flag: 'cp_egg_greedy' }, { flag: 'cp_egg_protective' }, { flag: 'cp_egg_smart' }, { flag: 'cp_egg_predatory' }, { flag: 'cp_egg_starved' }] },
    choices: [
      w('Hatch it as a temporary combat companion', 'allowlisted summon', { flag: 'cp_egg_companion', item: 'cp_seventh_hero_phylactery' }),
      w('Convert its shell into unique gear', 'shell-gear', { item: 'cp_gate_beast_spinebow', flag: 'cp_egg_shell' }),
      w('Return it to its parent', 'Fame', { fame: 5, flag: 'cp_egg_returned' }),
      w('Sell it to a demon collector', 'gold', { gold: 90, fame: -2, flag: 'cp_egg_sold_hell' }),
      w('Kill the hostile hatchling', 'powerful consumable', { combat: { enemies: ['imp'] }, consumable: 'cp_dragon_soot_capsule', flag: 'cp_egg_killed' }),
    ] },
]);

chain('cp_seven_owners', '🗡️', [
  { id: 'cp_first_owner_coward', biome: 'ruins', flag: 'cp_blade_held',
    title: 'First Owner: The Coward', text: 'A sword offers high power but demands that its user never Guard.',
    choices: [
      w('Equip it under the restriction', 'the coward\'s blade', { item: 'cp_cowards_first_sword', flag: 'cp_blade_held' }),
      w('Sell it', 'gold', { gold: 40, flag: 'cp_blade_sold' }),
      w('Extract the coward\'s memory', 'boss information', { flag: 'cp_coward_memory', world: { knowledge: 'cp_coward_boss' } }),
      w('Refuse', 'leave', { flag: 'cp_blade_refused' }),
    ] },
  { id: 'cp_fourth_owner_betrayer', biome: 'frost', flag: 'cp_blade_betrayer',
    title: 'Fourth Owner: The Betrayer', text: 'The weapon asks the wielder to claim another player\'s reward.',
    when: { any: [{ flag: 'cp_blade_held' }, { flag: 'cp_coward_memory' }, { flag: 'cp_blade_sold' }, { flag: 'cp_blade_refused' }] },
    choices: [
      w('Accept only with that player\'s consent', 'co-op consent; solo: refuse self-betrayal', { fame: -2, flag: 'cp_false_betrayal' }),
      w('Feed the sword an unequipped item', 'offering', { offering: { kinds: ['pack'] }, flag: 'cp_blade_fed' }, { req: { offering: true } }),
      w('Lose Fame to satisfy it with a false betrayal', 'a lie it accepts', { fame: -4, flag: 'cp_false_betrayal' }),
      idc({ class: 'priest' }, 'Exorcise one owner', 'a grip falls away', { fame: 2, flag: 'cp_owner_exorcised' }),
    ] },
  { id: 'cp_sixth_owner_you', biome: 'swamp', flag: 'cp_blade_future',
    title: 'Sixth Owner: You', text: 'The sword shows a future where its current wielder already owned it.',
    when: { any: [{ flag: 'cp_false_betrayal' }, { flag: 'cp_blade_fed' }, { flag: 'cp_owner_exorcised' }] },
    choices: [
      w('Accept the future', 'lose max HP', { maxHp: -4, flag: 'cp_blade_accepted' }),
      w('Reject it', 'weaker, uncursed', { flag: 'cp_blade_rejected', resolveCurse: 'cannot_open_vs_full_hp' }),
      w('Give it to another consenting player', 'transfer', { flag: 'cp_blade_given' }),
      w('Break it into seven consumable fragments', 'fragments', { consumable: 'cp_echo_chalk', consumable2: 'cp_memory_thread', flag: 'cp_blade_broken' }),
    ] },
  { id: 'cp_seventh_owner', biome: 'hell', flag: 'cp_blade_closed',
    title: 'Seventh Owner', text: 'The last grip is empty, and waiting.',
    when: { any: [{ flag: 'cp_blade_accepted' }, { flag: 'cp_blade_rejected' }, { flag: 'cp_blade_given' }, { flag: 'cp_blade_broken' }] },
    choices: [
      w('Become the final owner', 'completed weapon', { item: 'cp_seventh_owner_sword', flag: 'cp_blade_complete' }),
      w('Swear the missing eighth oath instead', 'a cursed unfinished blade', { item: 'cp_missing_eighth_oath', flag: 'cp_eighth_sworn' }),
      w('Free all previous owners', 'defensive relic and the ring of seven', { item: 'cp_ring_seven_owners', flag: 'cp_owners_freed', resolveCurse: 'hidden_oath' }),
      w('Give the sword to the rival party', 'they take the curse', { fame: 2, flag: 'cp_blade_to_rivals' }),
      w('Offer it to a boss', 'kit and reward change (flag)', { flag: 'cp_blade_to_boss' }),
    ] },
]);

chain('cp_false_system', '💻', [
  { id: 'cp_optional_mandatory', biome: 'forest', flag: 'cp_quest_window',
    title: 'Optional Mandatory Quest', text: 'A clearly corrupted window announces: "OPTIONAL QUEST — FAILURE IS MANDATORY." The chrome is wrong on purpose. This is not a game error.',
    choices: [
      w('Obey and surrender 25 gold', 'paid', { gold: -25, flag: 'cp_obeyed_false' }, { req: { gold: 25 } }),
      w('Refuse', 'system_dissident', { flag: 'cp_system_dissident' }),
      idc({ class: 'mage' }, 'Inspect its underlying script', 'corruption mapped', { flag: 'cp_script_read', world: { knowledge: 'cp_false_script' }, item: 'cp_administrators_bent_key' }),
      w('Wear the overlay as armor', 'the System picks your stance', { item: 'cp_armor_mandatory_optionality', flag: 'cp_obeyed_false' }),
      idc({ class: 'rogue' }, 'Redirect the quest to another dungeon entity', 'not your problem', { flag: 'cp_quest_redirected' }),
      idc({ race: 'human' }, 'Receive conflicting class classifications', 'none of them fit', { flag: 'cp_class_conflict' }),
      idc({ race: 'tiefling' }, 'Read the terms', 'you can see the trap', { flag: 'cp_terms_read' }),
      idc({ race: 'dwarf' }, 'See the physical mechanism producing the window', 'a projector, not a god', { flag: 'cp_script_read' }),
      idc({ class: 'bard' }, 'Notice the wrong heroic title', 'they misspelled you', { fame: 1, flag: 'cp_wrong_title' }),
      idc({ class: 'spellsword' }, 'Cut the window without closing it', 'a slit in the overlay', { flag: 'cp_window_cut' }),
    ] },
  { id: 'cp_terms_have_changed', biome: 'swamp', flag: 'cp_terms',
    title: 'Terms Have Changed', text: 'The false System offers a powerful reward hidden behind predatory terms.',
    when: { any: [{ flag: 'cp_obeyed_false' }, { flag: 'cp_system_dissident' }, { flag: 'cp_script_read' }, { flag: 'cp_quest_redirected' }, { flag: 'cp_terms_read' }, { flag: 'cp_class_conflict' }, { flag: 'cp_wrong_title' }, { flag: 'cp_window_cut' }] },
    choices: [
      w('Pay HP now for gear', 'blood price', { hp: -14, item: 'cp_false_system_staff', flag: 'cp_terms_hp' }),
      w('Pay Fame for a potion bundle', 'reputation', { fame: -4, consumable: 'cp_stitchleaf_tonic', consumable2: 'cp_unregistered_remedy', flag: 'cp_terms_fame' }),
      w('Accept an unknown future obligation', 'debt', { flag: 'cp_future_obligation' }),
      w('Reveal the terms publicly', 'Fame, enforcer', { fame: 4, combat: { enemies: ['acolyte'] }, flag: 'cp_terms_public' }),
      w('Stamp a blank permit over the clause', 'paperwork wins once', { flag: 'cp_permit_used', gold: 15 }, { req: { item: 'cp_blank_gate_permit' } }),
    ] },
  { id: 'cp_customer_support_boss', biome: 'hell', flag: 'cp_support_closed',
    title: 'Customer Support Is the Final Boss', text: 'The party reaches a desk staffed by an exhausted minor administrator.',
    when: { any: [{ flag: 'cp_terms_hp' }, { flag: 'cp_terms_fame' }, { flag: 'cp_future_obligation' }, { flag: 'cp_terms_public' }, { flag: 'cp_permit_used' }] },
    choices: [
      w('File an appeal using accumulated evidence', 'if you gathered flags, it works', { flag: 'cp_appeal_filed', item: 'cp_redacted_support_ticket', resolveCurse: ['system_stance', 'corrupt_preview'] }),
      w('Bribe the administrator', 'gold', { gold: -70, flag: 'cp_admin_bribed' }, { req: { gold: 70 } }),
      w('Attack the support construct', 'fight', { combat: { enemies: ['golem'] }, flag: 'cp_support_attacked' }),
      w('Help it escape', 'anti-System information at the throne', { fame: 3, flag: 'cp_admin_freed', world: { knowledge: 'cp_anti_system' } }),
      w('Force the overlay with a bent key', 'a back-office door', { gold: 20, flag: 'cp_key_forced', flag2: 'cp_audit_risk' }, { req: { flag: 'bentKey' } }),
    ] },
]);

chain('cp_futures_merchant', '🔮', [
  { id: 'cp_buy_something_you_might_need', biome: 'forest', flag: 'cp_future_bought',
    title: 'Buy Something You Might Need', text: 'A merchant sells sealed predictions.',
    choices: [
      w('35 gold: next-biome danger', 'warning', { gold: -35, flag: 'cp_pred_danger' }, { req: { gold: 35 } }),
      w('50 gold: potion-access guarantee', 'a future tonic', { gold: -50, flag: 'cp_pred_potion' }, { req: { gold: 50 } }),
      w('65 gold: a future gear reservation', 'receipt', { gold: -65, item: 'cp_receipt_from_tomorrow', flag: 'cp_pred_gear' }, { req: { gold: 65 } }),
      w('Refuse; take a free suspicious prediction', 'it smiles too much', { flag: 'cp_pred_free' }),
      idc({ race: 'elf' }, 'Purchase a memory rather than a prediction', 'something already happened', { gold: -40, flag: 'cp_pred_memory' }),
      idc({ race: 'halfling' }, 'Accept an absurdly favorable contract', 'with an absurd trigger', { flag: 'cp_pred_absurd' }),
      idc({ race: 'dragonkin' }, 'Collateralize part of the hoard', 'gold pledged', { gold: -25, flag: 'cp_pred_hoard', item: 'cp_hoards_first_coin' }),
    ] },
  { id: 'cp_futures_market', biome: 'frost', flag: 'cp_future_sold',
    title: 'Futures Market', text: 'The merchant allows the party to sell a future reward now.',
    when: { any: [{ flag: 'cp_pred_danger' }, { flag: 'cp_pred_potion' }, { flag: 'cp_pred_gear' }, { flag: 'cp_pred_free' }, { flag: 'cp_pred_memory' }, { flag: 'cp_pred_absurd' }, { flag: 'cp_pred_hoard' }] },
    choices: [
      w('Gold now, lose the next chest', 'sold', { gold: 50, flag: 'cp_sold_chest' }),
      w('Potion now, forfeit future Fame', 'drink', { consumable: 'cp_stitchleaf_tonic', flag: 'cp_sold_fame' }),
      w('Lock in an equipment category', 'reservation', { flag: 'cp_locked_slot' }),
      w('Buy back the contract at a premium', 'expensive', { gold: -70, flag: 'cp_bought_back' }, { req: { gold: 70 } }),
      idc({ class: 'rogue' }, 'Short a future reward', 'you bet against yourself', { gold: 35, flag: 'cp_shorted' }),
      idc({ class: 'bard' }, 'Sell future Fame', 'applause, prepaid', { gold: 40, flag: 'cp_sold_fame' }),
      idc({ class: 'necromancer' }, 'Buy a death that has not happened', 'unlived', { flag: 'cp_bought_death' }),
    ] },
  { id: 'cp_settlement_day', biome: 'hell', flag: 'cp_future_closed',
    title: 'Settlement Day', text: 'The merchant resolves every prediction accurately but maliciously.',
    when: { any: [{ flag: 'cp_sold_chest' }, { flag: 'cp_sold_fame' }, { flag: 'cp_locked_slot' }, { flag: 'cp_bought_back' }, { flag: 'cp_shorted' }, { flag: 'cp_bought_death' }] },
    choices: [
      w('Honor the contract', 'paid in full', { flag: 'cp_honored', item: 'cp_coinmouth_maul' }),
      w('Pay Fame to renegotiate', 'new terms', { fame: -5, flag: 'cp_renegotiated' }),
      w('Fight over the confiscated reward', 'combat', { combat: { enemies: ['court_usurper'] }, flag: 'cp_fought_merchant' }),
      w('Prove the merchant manipulated events', 'reclaim part', { gold: 40, fame: 2, flag: 'cp_merchant_exposed' }),
    ] },
]);

chain('cp_fame_eater', '⭐', [
  { id: 'cp_creature_applauding', biome: 'ruins', flag: 'cp_eater_fed',
    title: 'The Creature Applauding Alone', text: 'A small creature feeds on recognition.',
    choices: [
      w('Give it 5 Fame for a potion', 'trade', { fame: -5, consumable: 'cp_stitchleaf_tonic', flag: 'cp_eater_potion' }, { req: { fame: 5 } }),
      w('Give it 10 Fame for identification', 'reforge hint', { fame: -10, flag: 'cp_eater_id' }, { req: { fame: 10 } }),
      w('Feed it 40 gold instead', 'gold is also applause', { gold: -40, flag: 'cp_eater_gold' }, { req: { gold: 40 } }),
      w('Capture it', 'a tooth for later', { item: 'cp_fame_eater_tooth_relic', flag: 'cp_eater_caught' }),
      w('Pull the tooth and keep the bite', 'a cursed dagger', { item: 'cp_fame_eater_tooth', flag: 'cp_eater_caught' }),
      idc({ class: 'bard' }, 'Tame it through a controlled performance', 'it learns your tempo', { fame: -2, flag: 'cp_eater_tamed' }),
      idc({ race: 'halfling' }, 'Hide Fame in an insignificant story', 'it eats a footnote', { flag: 'cp_eater_hidden' }),
      idc({ race: 'orc' }, 'Replace Fame with witnessed honor', 'it does not know the difference', { flag: 'cp_eater_honor' }),
      idc({ class: 'priest' }, 'Redirect worship', 'it eats a prayer instead', { fame: -3, flag: 'cp_eater_prayer' }),
      idc({ class: 'rogue' }, 'Feed it counterfeit notoriety', 'a fake name', { flag: 'cp_eater_fake' }),
      idc({ class: 'necromancer' }, 'Offer the reputation of the dead', 'they are not using it', { flag: 'cp_eater_dead' }),
    ] },
  { id: 'cp_nobody_remembers', biome: 'swamp', flag: 'cp_obscure',
    title: 'Nobody Remembers You', text: 'If fed, NPCs temporarily stop recognizing the party.',
    when: { any: [{ flag: 'cp_eater_potion' }, { flag: 'cp_eater_id' }, { flag: 'cp_eater_gold' }, { flag: 'cp_eater_tamed' }, { flag: 'cp_eater_caught' }, { flag: 'cp_eater_hidden' }, { flag: 'cp_eater_honor' }, { flag: 'cp_eater_prayer' }, { flag: 'cp_eater_fake' }, { flag: 'cp_eater_dead' }] },
    choices: [
      w('Exploit anonymity to rob a cache', 'gold, wanted', { gold: 60, flag: 'cp_anonymous_theft', fame: -3 }),
      w('Spend gold restoring the record', 'you exist again', { gold: -40, flag: 'cp_record_restored' }, { req: { gold: 40 } }),
      w('Accept obscurity', 'stealth boon', { item: 'cp_invisible_toll_garrote', flag: 'cp_obscure' }),
      w('Release the creature', 'it applauds someone else', { fame: 2, flag: 'cp_eater_released' }),
    ] },
  { id: 'cp_most_famous_meal', biome: 'hell', flag: 'cp_eater_closed',
    title: 'The Most Famous Meal', text: 'The creature is still hungry.',
    when: { any: [{ flag: 'cp_anonymous_theft' }, { flag: 'cp_record_restored' }, { flag: 'cp_obscure' }, { flag: 'cp_eater_released' }] },
    choices: [
      w('Feed it all current Fame', 'powerful relic', { fame: -99, item: 'cp_applause_eater_lute', flag: 'cp_eater_gorged' }),
      w('Kill it and recover part of the Fame', 'partial refund', { fame: 4, combat: { enemies: ['shade'] }, flag: 'cp_eater_killed', resolveCurse: ['fame_feed', 'eats_fame'] }),
      w('Make it consume a boss\'s legend', 'weaken one signature (flag)', { flag: 'cp_boss_legend_eaten' }),
      w('Become its agent', 'rotating Fame services', { flag: 'cp_eater_agent', item: 'cp_bottle_of_applause' }),
    ] },
]);

const stand = (id, biome, title, text, choices, extra = {}) => E({
  id, biome, title, text, glyph: extra.glyph || '🍂', category: extra.cat || 'mystery',
  family: extra.family, once: extra.once, when: extra.when, w: extra.w ?? 3,
  choices,
});

/* Standalone Forest 54–63 */
PACK_EVENTS.push(
  stand('cp_wolfs_trial', 'forest', "The Wolf's Trial", 'A wolf pack places stolen weapons in a circle.', [
    w('Return the gear for Fame', 'honest', { fame: 3, flag: 'cp_wolves_honored' }),
    w('Fight for it', 'combat', { combat: { enemies: ['wolf', 'wolf'] }, item: 'cp_root_cutter_axe' }),
    w('Offer food or a potion', 'peace', { useItem: 'potion_s', fame: 2 }, { req: { item: 'potion_s' } }),
    idc({ class: 'archer' }, 'Settle the dispute without combat', 'scent and patience', { fame: 3, flag: 'cp_wolves_settled' }),
  ], { glyph: '🐺' }),
  stand('cp_tree_knows_inventory', 'forest', 'The Tree That Knows Inventory', 'A tree recites the history of every carried item.', [
    w('Pay 20 gold to reveal upgrade potential', 'appraisal', { gold: -20, flag: 'cp_tree_told' }, { req: { gold: 20 } }),
    w('Sacrifice a chosen item to reforge another', 'offering', { offering: { kinds: ['pack'] } }, { req: { offering: true } }),
    w('Let it reveal an embarrassing owner', 'Fame loss, truth', { fame: -2, world: { knowledge: 'cp_item_truth' } }),
    w('Leave', 'the tree keeps talking anyway', { flag: 'cp_tree_left' }),
  ], { glyph: '🌳' }),
  stand('cp_hive_smoke_refugees', 'forest', 'Hive-Smoke Refugees', 'Refugees displaced by the forest conflict ask for supplies.', [
    w('Donate gold', 'kindness', { gold: -25, fame: 3 }, { req: { gold: 25 } }),
    w('Donate a potion', 'medicine', { useItem: 'potion_s', fame: 3 }, { req: { item: 'potion_s' } }),
    w('Escort them', 'dangerous encounter', { combat: { enemies: ['boar'] }, fame: 4 }),
    w('Demand information about Sylvanor or Cinderghast', 'rumors', { world: { knowledge: 'cp_refugee_rumor' }, fame: -1 }),
    w('Rob their abandoned wagon', 'Fame loss', { gold: 35, fame: -4 }),
  ], { glyph: '🏕️', cat: 'social' }),
  stand('cp_crowned_deer', 'forest', 'Crowned Deer', 'A deer wears a child-sized crown and refuses to move.', [
    w('Bow', 'Fame', { fame: 3, flag: 'cp_deer_honored' }),
    w('Take the crown', 'pursuit', { combat: { enemies: ['boar'] }, item: 'cp_drowned_crown_fragment', fame: -2 }),
    w('Feed it a potion', 'true form', { useItem: 'potion_s', item: 'cp_crowned_deer_antlerbow' }, { req: { item: 'potion_s' } }),
    idc({ class: 'warrior' }, 'Challenge it', 'a duel of courtesy', { combat: { enemies: ['treant'] }, fame: 2 }),
    idc({ class: 'priest' }, 'Recognize a funeral symbol', 'you bow correctly', { fame: 3, flag: 'cp_deer_funeral' }),
  ], { glyph: '🦌' }),
  stand('cp_moss_chapel', 'forest', 'Moss Chapel', 'The chapel converts one resource into another.', [
    w('30 gold → heal', 'sink', { gold: -30, hpPct: 0.2 }, { req: { gold: 30 } }),
    w('8 HP → Fame', 'blood tithe', { hp: -8, fame: 3 }),
    w('5 Fame → potion', 'exchange', { fame: -5, consumable: 'cp_stitchleaf_tonic' }, { req: { fame: 5 } }),
    w('Potion → cleanse or gear blessing', 'trade', { useItem: 'potion_s', flag: 'cp_chapel_bless' }, { req: { item: 'potion_s' } }),
    w('Deface the chapel', 'cursed item', { item: 'cp_armor_applauding_crowd', fame: -3, flag: 'cp_chapel_defiled' }),
  ], { glyph: '🕯️', cat: 'recovery' }),
  stand('cp_honest_bandit', 'forest', 'The Honest Bandit', 'A bandit presents a precise written breakdown of the robbery.', [
    w('Pay the 15% purse toll', 'honest crime', { goldPct: -0.15, flag: 'cp_toll_paid' }),
    w('Argue the valuation', 'maybe less', { gold: -8, fame: 1 }),
    w('Hire them to attack the next merchant\'s prices', 'discount flag', { gold: -20, flag: 'cp_hired_bandit' }, { req: { gold: 20 } }),
    idc({ class: 'rogue' }, 'Find the hidden surcharge', 'you know this form', { gold: 12, flag: 'cp_surcharge_found' }),
    w('Fight', 'combat', { combat: { enemies: ['bandit'] } }),
  ], { glyph: '🗡️', cat: 'social' }),
  stand('cp_childs_map', 'forest', "Child's Map of Impossible Floors", 'A child\'s drawing accurately depicts a later biome.', [
    w('Buy it for 25 gold', 'map', { gold: -25, item: 'cp_gate_surveyor_last_report' }, { req: { gold: 25 } }),
    w('Trade a potion', 'swap', { useItem: 'potion_s', item: 'cp_gate_surveyor_last_report' }, { req: { item: 'potion_s' } }),
    w('Correct the map', 'Fame', { fame: 2, flag: 'cp_map_corrected' }),
    w('Follow a shortcut with HP risk', 'cut', { hp: -10, flag: 'cp_map_shortcut' }),
    w('Ask why the child has drawn the party dead', 'a silence', { flag: 'cp_map_omen' }),
  ], { glyph: '🗺️' }),
  stand('cp_roots_treasure', 'forest', 'Roots Around a Treasure Chest', 'The roots tighten whenever someone lies.', [
    w('Tell the truth about why you climb', 'modest Fame', { fame: 2, chest: true }),
    w('Claim noble motives', 'risk damage', { hp: -8, gold: 20 }),
    w('Cut the roots and fight', 'combat', { combat: { enemies: ['treant'] }, chest: true }),
    w('Offer gold to the buried kingdom', 'sink', { gold: -30, fame: 2 }, { req: { gold: 30 } }),
    w('Leave the chest sealed', 'leave', { flag: 'cp_chest_sealed' }),
  ], { glyph: '🧰', cat: 'equipment' }),
  stand('cp_campfire_breathing', 'forest', 'The Campfire That Is Breathing', 'The "campfire" is a sleeping mimic-like creature.', [
    w('Warm yourself', 'ambush risk', { combat: { enemies: ['slime'] }, hpPct: 0.08 }),
    w('Feed it an item', 'offering', { offering: { kinds: ['pack'] } }, { req: { offering: true } }),
    w('Harvest its coals', 'combat consumable', { consumable: 'cp_kilnfire_ampoule' }),
    idc({ class: 'priest' }, 'Soothe it', 'it sleeps deeper', { fame: 2, hpPct: 0.1 }),
    idc({ class: 'mage' }, 'Extract elemental residue', 'a spark', { consumable: 'cp_dragon_soot_capsule' }),
  ], { glyph: '🔥', cat: 'recovery' }),
  stand('cp_gate_survey_corpse', 'forest', 'The Gate Survey Corpse', 'A dead surveyor grips half a gate report.', [
    w('Pay funeral respects', 'Fame', { fame: 3, flag: 'cp_surveyor_honored' }),
    w('Take their 35 gold', 'theft', { gold: 35, fame: -2 }),
    w('Take their gear', 'marked by the survey guild', { item: 'cp_gate_surveyor_coat', flag: 'cp_survey_marked' }),
    w('Use a potion to revive them', 'they gasp a warning', { useItem: 'potion_s', flag: 'cp_surveyor_revived', world: { knowledge: 'cp_survey_warning' } }, { req: { item: 'potion_s' } }),
    w('Study the report', 'boss information', { world: { knowledge: 'cp_survey_boss' }, flag: 'cp_survey_studied' }),
  ], { glyph: '📜' }),
);

export { PACK_EVENTS as PACK_EVENTS_ALL };
