// Origins (handoff §23): short PLAYABLE introductions. Each origin is an
// event card resolved before Floor 1 — a choice, not a static menu bonus.
// Effects use the same declarative outcome format as events.js.

export const ORIGINS = [
  {
    id: 'mage_academy',
    name: 'The Arcanum Academy',
    glyph: '🎓',
    blurb: 'Six years of theory, one night of practice.',
    title: 'Graduation Night',
    text: 'The Arcanum\'s spire hums above you. Tomorrow you climb the tower; tonight, the Academy offers a graduate one parting gift. Professor Immel waits with three doors open.',
    choices: [
      { label: 'The library — take the sealed grimoire', hint: 'arcane knowledge',
        outcome: { text: 'The grimoire\'s lock clicks open at your touch — it was waiting for you. Old power settles into your hands.', statUp: { stat: 'int', amt: 3 }, mana: 10, flag: 'origin_arcane' } },
      { label: 'The vault — take the focus crystal', hint: 'equipment',
        outcome: { text: 'The crystal drinks the lamplight. "Sell it if you must," Immel sighs, "but it would rather be used."', item: 'oak_staff', gold: 30, flag: 'origin_arcane' } },
      { label: 'The observatory — one reading of your stars', hint: 'appraisal',
        outcome: { text: 'Immel charts your constellation and hands you the reading face-down. "The tower will confirm it. Or make a liar of the sky."', appraisal: 'partial', fame: 5 } },
    ],
  },
  {
    id: 'sword_academy',
    name: 'The Ninth Hall',
    glyph: '⚔️',
    blurb: 'Where the kingdom sends its stubbornest children.',
    title: 'The Final Bout',
    text: 'Master Ollen circles you on the sparring sand — your last lesson before the tower. "Show me what you leave with," she says, and attacks.',
    choices: [
      { label: 'Overpower her', hint: 'strength',
        outcome: { text: 'You catch her blade on yours and PUSH. She lands on her back, laughing. "Good. The tower respects rude strength."', statUp: { stat: 'str', amt: 3 }, hp: 5 } },
      { label: 'Outlast her', hint: 'guard training',
        outcome: { text: 'You give ground, guard high, until her arms tire first. "Better," she pants. "Walls win wars." Your Guard is drilled into instinct.', statUp: { stat: 'wis', amt: 2 }, maxHp: 10, flag: 'guard_trained' } },
      { label: 'Trick her', hint: 'technique',
        outcome: { text: 'You drop your sword — and take hers while she watches yours fall. Silence. Then: "The tower deserves you." It is not entirely a compliment.', statUp: { stat: 'dex', amt: 3 }, fame: 3 } },
    ],
  },
  {
    id: 'mercenary',
    name: 'The Gray Banners',
    glyph: '🚩',
    blurb: 'Paid violence, honest wages.',
    title: 'Mustering Out',
    text: 'Captain Vosk counts out your final pay in the rain. "Tower money is better than war money," he shrugs. "Take your cut and one thing from the wagon."',
    choices: [
      { label: 'Double pay, no gear', hint: 'gold',
        outcome: { text: '"Smart. Steel breaks, coin doesn\'t." He pays you twice and keeps your name off the death-ledger, for luck.', gold: 90 } },
      { label: 'The wagon\'s best blade', hint: 'equipment',
        outcome: { text: 'Under the tarp: a sword that has outlived four owners. Vosk doesn\'t meet your eyes. "Fifth time\'s the charm."', item: 'steel_blade' } },
      { label: 'The company\'s letter of mark', hint: 'fame',
        outcome: { text: 'A letter naming you a Banner in good standing. Doors open for the Banners — the ones that don\'t get kicked in.', fame: 12, gold: 20 } },
    ],
  },
  {
    id: 'guild',
    name: 'The Adventurers\' Guild',
    glyph: '🏛️',
    blurb: 'Bureaucracy with sword privileges.',
    title: 'License Day',
    text: 'The Guild clerk stamps your climbing license without looking up. "Benefits package," she recites. "Pick one. No refunds. Next."',
    choices: [
      { label: 'The survival kit', hint: 'consumables',
        outcome: { text: 'Two potions, a rope, and a pamphlet titled SO YOU\'RE GOING TO DIE IN A TOWER. The pamphlet is surprisingly moving.', consumable: 'potion_s', consumable2: 'calming_tea' } },
      { label: 'The assessor\'s hour', hint: 'appraisal',
        outcome: { text: 'A bored Guild assessor reads your potential like a grocery list. The numbers are approximate. The boredom is exact.', appraisal: 'full' } },
      { label: 'The veteran\'s map notes', hint: 'knowledge',
        outcome: { text: 'Margin-scrawled wisdom from climbers who came back. Half of it is warnings. The other half is apologies.', xp: 30, fame: 4, flag: 'guild_notes' } },
    ],
  },
  {
    id: 'temple',
    name: 'The Quiet Temple',
    glyph: '🕍',
    blurb: 'They taught you to sit still. It was harder than swords.',
    title: 'The Last Vigil',
    text: 'Your final night of the novitiate. The abbot offers the traditional parting: one blessing, freely chosen, and the door unbarred at dawn.',
    choices: [
      { label: 'Blessing of the body', hint: 'vitality',
        outcome: { text: 'Warmth pours down your spine like sunrise. Your body will remember this kindness on cold floors.', maxHp: 15, hp: 15 } },
      { label: 'Blessing of the mind', hint: 'clarity',
        outcome: { text: 'The abbot touches your brow. The noise you have carried all your life goes quiet — not gone, just... seated.', statUp: { stat: 'wis', amt: 3 }, mana: 8 } },
      { label: 'No blessing — donate your savings', hint: 'faith, rewarded?',
        outcome: { roll: { stat: 'lk', dc: 10 },
          success: { text: 'You give everything. At the gate, a beggar presses something into your hand: a relic older than the temple. The abbot, watching, smiles like he arranged it. He didn\'t.', gold: -25, relicRoll: true, fame: 6 },
          fail: { text: 'You give everything and walk out lighter in every sense. Virtue, it turns out, pays in exposure.', gold: -25, fame: 8, xp: 20 } } },
    ],
  },
  {
    id: 'streets',
    name: 'The Undercity',
    glyph: '🕳️',
    blurb: 'You didn\'t choose the tunnels. The tunnels chose everyone cheap.',
    title: 'Buying Out',
    text: 'The Rat Queen of the Undercity turns your debt-marker over in her fingers. "The tower, is it? Climbers\' corpses pay well." She names your exit price — or a favor.',
    choices: [
      { label: 'Pay the debt', hint: 'clean break',
        outcome: { text: 'You slide your savings across the table. She burns the marker. "Die owing NOTHING," she says — the Undercity\'s only blessing.', gold: -20, fame: 2, statUpRandom: 1 } },
      { label: 'One last job', hint: 'risky',
        outcome: { roll: { stat: 'dex', dc: 11 },
          success: { text: 'One rooftop, one lockbox, no witnesses. She keeps the contents; you keep the skills and a bonus for style.', statUp: { stat: 'dex', amt: 3 }, gold: 40, flag: 'undercity_ties' },
          fail: { text: 'One rooftop, one loose tile, one very long fall into one very full canal. She laughs the debt away — the entertainment covered it.', hp: -10, statUp: { stat: 'dex', amt: 2 }, flag: 'undercity_ties' } } },
      { label: 'Steal your own marker', hint: 'audacious',
        outcome: { roll: { stat: 'lk', dc: 13 },
          success: { text: 'You lift it from her table while paying compliments. Halfway out, applause — she watched the whole time. "GO," she grins. "You\'re wasted down here."', fame: 8, statUp: { stat: 'lk', amt: 2 }, flag: 'undercity_ties' },
          fail: { text: 'Her hand closes on your wrist mid-reach. The good news: she admires the attempt. The bad news is your wrist.', hp: -12, statUp: { stat: 'lk', amt: 1 } } } },
    ],
  },
];

export function originById(id) {
  return ORIGINS.find(o => o.id === id);
}
