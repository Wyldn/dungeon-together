// Cheap late-climb stains — copy only, no scheduling.
// Used by the Scorch gate, throne antechamber, and win epitaph.

import { hasKnowledge, threadStage, SECRET_ROUTES } from './world.js';

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
    run.flags?.saved_climber && 'Mira is not here. Dinner on the surface is still a sentence you both said out loud.',
    (run.flags?.ate_v_dinner || run.flags?.v_lore) && 'A candle downstairs was labeled V. Someone like you already sat in a kinder room than this and still came up.',
    threadStage(run, 'oathbound') === 'gate' && 'The part that stays is still at the wrong gate. You finish the part that doesn\'t.',
    n > 0 && n < 3 && 'The keys you carry tick, incomplete. The room notices the missing one and does not help.',
    (run.flags?.revenant_oath || cleared.some(b => b.floor === 30 || b.floor === 40)) && 'The gates you already paid do not get a vote. The air takes a side anyway.',
    run.flags?.kings_bowed && !run.flags?.kings_petition && !run.flags?.kings_mocked && 'A court that is six centuries late still thinks you knelt. The air here does not.',
    lyra && secretId !== 'doomsinger' && 'A last note sits behind your teeth and refuses to become throne music.',
  ].find(Boolean);
  return line ? [line] : [];
}

export function throneEpitaphStain(run) {
  if (!run) return '';
  if (threadStage(run, 'king') === 'delivered') {
    return 'Six hundred years of complaint finally changed floors.';
  }
  if (run.flags?.saved_climber) {
    return 'Somewhere below the slag, Mira is still keeping score.';
  }
  const secretId = secretPathId(run);
  if (secretId && SECRET_STAINS[secretId]) return SECRET_STAINS[secretId].epitaph;
  if (run.flags?.ate_v_dinner || run.flags?.v_lore) {
    return 'A cottage on a frozen floor has one less dinner to set.';
  }
  return '';
}

export function biomeIntroText(biome, run) {
  const base = biome?.flavor || '';
  if (biome?.id !== 'hell') return base;
  const extra = hellGateStain(run);
  return extra ? `${base} ${extra}` : base;
}
