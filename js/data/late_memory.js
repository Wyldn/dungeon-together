// Cheap late-climb stains — copy only, no scheduling.
// Used by the Scorch gate, throne antechamber, and win epitaph.

import { hasKnowledge, threadStage, SECRET_ROUTES, charIsDead } from './world.js';

const SECRET_STAINS = {
  doomsinger: {
    throne: 'A last note sits behind your teeth and refuses to become throne music.',
    epitaph: 'The verse she never performed walked out with you.',
  },
  lightbreaker: {
    throne: 'Leftover dawn has no form in this room. It stands in you like a clause nobody filed.',
    epitaph: 'Hell still does not have a form for the light you took.',
  },
  void_scholar: {
    throne: 'The tower is embarrassed. You are still annotating.',
    epitaph: 'The footnotes left with the climber. The main text had to live with it.',
  },
  lichling: {
    throne: 'Rent is paid. The basin is not in this room. The accounting is.',
    epitaph: 'A piece of you stayed somewhere safe. The rest finished the climb.',
  },
  phantom: {
    throne: 'The ledger already un-wrote you. The throne will have trouble introducing you.',
    epitaph: 'Officially, someone harder to name walked past the chair.',
  },
  doomguard: {
    throne: 'Colleague. The dark counted you in. It does not sit thrones.',
    epitaph: 'Death filed the win under STAFF, not FREELANCE.',
  },
  stormcaller: {
    throne: 'The sky\'s IOU is louder than the slag. Collecting can wait until after the question.',
    epitaph: 'The weather came down the stairs with you, still owed.',
  },
  heretic_saint: {
    throne: 'The wrong department loved you first. This room is not that department.',
    epitaph: 'The clergy will be furious. The light got there first, again.',
  },
  ashen_fist: {
    throne: 'What remains is the strike. The stone is not here. You are.',
    epitaph: 'Stillness walked out. The strike did too.',
  },
  void_edge: {
    throne: 'The gap between steel and spell does not care who sits.',
    epitaph: 'You stopped choosing. The empty air came home with you.',
  },
  einherjar: {
    throne: 'Halls upstairs notice. This is not those halls.',
    epitaph: 'A bench upstairs marked you seated, late, not absent.',
  },
};

/** Flags/knowledge/threads this module reads. Catalog walker imports this. */
export const LATE_MEMORY_READS = {
  flags: [
    'stole_rose', 'kings_petition', 'seen_throne', 'saved_climber', 'left_climber',
    'ate_v_dinner', 'v_lore', 'kings_bowed', 'kings_mocked', 'revenant_oath',
    'bard_friend', 'forest_peace', 'clause_seven', 'let_it_ride', 'pilgrim_lore',
    'freed_climber', 'freed_angel', 'evener_met', 'origin_arcane', 'guild_notes',
    'undercity_ties', 'lodge_mark', 'guard_trained', 'angered_forest', 'paid_toll',
    'statue_grudge', 'honored_shrine', 'witch_hint',
  ],
  knowledge: [
    'heard_own_verse', 'unsung_verse', 'v_network', 'forest_minutes', 'mira_named',
  ],
  threads: ['king', 'oathbound'],
  chars: ['mira'],
};

export function secretPathId(run) {
  return (run?.subclassId && SECRET_ROUTES[run.subclassId]) ? run.subclassId : null;
}

export function hellGateStain(run) {
  if (!run) return '';
  if (run.flags?.stole_rose) {
    return 'The mire sent its cold after you. A heart that is not yours ticks in the heat.';
  }
  if ((run.climb?.bossesCleared || []).some(b => b.floor === 40)) {
    return 'Behind you, something with too many mouths has gone quiet. The air does not congratulate you.';
  }
  if (run.flags?.kings_petition) {
    return 'The petition in your pack rustles, like paper that has waited longer than fire.';
  }
  if (run.flags?.clause_seven) {
    return 'Clause seven has already found the stair. It is not lost. It is early.';
  }
  if (run.flags?.forest_peace) {
    return 'Hive-smoke is long gone. The bees still filed you under SETTLED. The slag has not.';
  }
  if (run.flags?.saved_climber) {
    return 'Mira is not on this stair. The debt she closed still is.';
  }
  return '';
}

function ruinsStain(run) {
  if (run.flags?.angered_forest) {
    return 'Hive-smoke followed you out of the trees. The dust here does not know what to do with it.';
  }
  if (run.flags?.forest_peace) {
    return 'The forest filed you under SETTLED. The ruins have not been told.';
  }
  if (run.flags?.paid_toll) {
    return 'A hat in the woods took your coin. The fallen court will want a different currency.';
  }
  if (run.flags?.saved_climber) {
    return 'Someone patched is already ahead of you, or behind you. The dust does not specify.';
  }
  if (run.flags?.honored_shrine) {
    return 'A nameless shrine still has your name in a bowl it cannot read.';
  }
  if (run.flags?.origin_arcane || run.flags?.guild_notes) {
    return 'Classroom dust still on you. The ruins were a different school, and they failed it.';
  }
  return '';
}

function frostStain(run) {
  if (run.flags?.kings_petition) {
    return 'The petition does not like the cold. Six centuries of complaint prefers dust to ice.';
  }
  if (run.flags?.statue_grudge) {
    return 'A veiled head turned in the ruins. The court ahead turns heads for a living.';
  }
  if (hasKnowledge(run, 'mira_named') || run.flags?.saved_climber) {
    return 'Mira\'s name does not melt. It just waits in a warmer biome.';
  }
  if (run.flags?.kings_bowed && !run.flags?.kings_mocked) {
    return 'You already knelt for a ghost. Ice will ask you to do it again.';
  }
  if (run.flags?.lodge_mark || run.flags?.guard_trained) {
    return 'Someone drilled you to wait. The court ahead does not wait.';
  }
  return '';
}

function swampStain(run) {
  if (run.flags?.stole_rose || run.flags?.ate_v_dinner) {
    return 'Frost still clings to your kit. The mire notices cold that does not belong to it.';
  }
  if (hasKnowledge(run, 'forest_minutes')) {
    return 'The bees already took minutes. The water will want a second draft.';
  }
  if (hasKnowledge(run, 'v_network') || run.flags?.witch_hint) {
    return 'Someone told you to check under a bell. The mire is full of them.';
  }
  if (run.flags?.kings_petition) {
    return 'Nine pages of a dead king\'s complaint will not float. You carry them anyway.';
  }
  return '';
}

export function throneMemoryLines(run, boss) {
  if (!run) return [];
  const name = boss?.name || 'the figure on the throne';
  const secretId = secretPathId(run);
  const n = (run.sigils || []).length;
  const cleared = run.climb?.bossesCleared || [];
  const lyra = run.flags?.bard_friend || hasKnowledge(run, 'heard_own_verse') || hasKnowledge(run, 'unsung_verse');
  // Explicit late-importance order — first hit wins, never object-key order.
  const line = [
    run.flags?.kings_petition && 'The King Who Stayed is not in this room. His nine pages are. They smell like a person, not a quest.',
    secretId && SECRET_STAINS[secretId]?.throne,
    run.flags?.seen_throne && `You have seen this room before — in tea, one heartbeat of it. ${name} stands where the vision said. The book is where the vision said.`,
    run.flags?.saved_climber && !charIsDead(run, 'mira') && 'Mira is not here. Dinner on the surface is still a sentence you both said out loud.',
    (run.flags?.ate_v_dinner || run.flags?.v_lore) && 'A candle downstairs was labeled V. Someone like you already sat in a kinder room than this and still came up.',
    threadStage(run, 'oathbound') === 'gate' && 'The part that stays is still at the wrong gate. You finish the part that doesn\'t.',
    n > 0 && n < 3 && 'The keys you carry tick, incomplete. The room notices the missing one and does not help.',
    (run.flags?.revenant_oath || cleared.some(b => b.floor === 30 || b.floor === 40)) && 'The gates you already paid do not get a vote. The air takes a side anyway.',
    run.flags?.kings_bowed && !run.flags?.kings_petition && !run.flags?.kings_mocked && 'A court that is six centuries late still thinks you knelt. The air here does not.',
    lyra && secretId !== 'doomsinger' && 'A last note sits behind your teeth and refuses to become throne music.',
    run.flags?.let_it_ride && 'A book downstairs already took your whole purse on this room. The chair does not refund.',
    run.flags?.pilgrim_lore && 'The ash-walkers said he was fair. Fair is not kind. The air agrees.',
    run.flags?.freed_climber && 'Someone you thawed is not in this room. They asked you to finish it. This is the finishing.',
    hasKnowledge(run, 'v_network') && 'The witch and the cottage both left food out. This room does not.',
    run.flags?.evener_met && 'The masked evener said the tower deals from the bottom. This chair is the dealer.',
    run.flags?.freed_angel && 'The chained light told you the question. You still have to answer it.',
  ].find(Boolean);
  return line ? [line] : [];
}

export function throneEpitaphStain(run) {
  if (!run) return '';
  if (threadStage(run, 'king') === 'delivered') {
    return 'Six hundred years of complaint finally changed floors.';
  }
  if (run.flags?.saved_climber && !charIsDead(run, 'mira')) {
    return 'Somewhere below the slag, Mira is still keeping score.';
  }
  const secretId = secretPathId(run);
  if (secretId && SECRET_STAINS[secretId]) return SECRET_STAINS[secretId].epitaph;
  if (run.flags?.ate_v_dinner || run.flags?.v_lore) {
    return 'A cottage on a frozen floor has one less dinner to set.';
  }
  if (run.flags?.left_climber) {
    return 'A girl in the woods kept the worse version of you.';
  }
  if (run.flags?.let_it_ride) {
    return 'The book that took the whole purse has a new line: PAID.';
  }
  if (run.flags?.freed_angel) {
    return 'The chained light got its honest answer. The tower did not laugh.';
  }
  return '';
}

export function biomeIntroText(biome, run) {
  const base = biome?.flavor || '';
  if (!biome?.id || !run) return base;
  let extra = '';
  if (biome.id === 'ruins') extra = ruinsStain(run);
  else if (biome.id === 'frost') extra = frostStain(run);
  else if (biome.id === 'swamp') extra = swampStain(run);
  else if (biome.id === 'hell') extra = hellGateStain(run);
  return extra ? `${base} ${extra}` : base;
}
