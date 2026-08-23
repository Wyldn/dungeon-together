import { pickBossForFloor, SECRET_BOSS } from './data/enemies.js';
import { changeFame } from './character.js';
import { applyWorldPatch } from './data/world.js';

/** Pick F51 boss and apply clause_seven / freed_angel. Advances once. */
export function beginThrone(run, rng) {
  const boss = pickBossForFloor(51, rng, run);
  run.flags.throneBossId = boss.id;
  run.flags.throneBossName = boss.name;
  rng.advance();
  const lines = [];
  if (run.flags.clause_seven) {
    const cost = Math.round(run.maxHp * 0.25);
    run.hp = Math.max(1, run.hp - cost);
    lines.push({ text: `Clause seven collects ${cost} HP.`, cls: 'bad' });
  }
  if (run.flags.freed_angel) {
    run.hp = run.maxHp;
    run.mp = run.maxMp;
    lines.push({ text: 'The freed angel restores you. ANSWER HONESTLY.', cls: 'good' });
  }
  return {
    boss,
    hasSigils: (run.sigils || []).length >= 3,
    lines,
  };
}

/**
 * Policy throne choice → ending id or a fight spec.
 * 'sigils' → secret ending (no fight)
 * 'petition' → 0.85 HP fight vs throne boss
 * 'honesty' → SECRET_BOSS + corrupt_king
 * 'fight' → normal F51 boss
 * 'escape' → escape ending
 */
export function resolveThroneChoice(run, choice, throneBoss) {
  if (choice === 'sigils' || choice === 'secret') {
    return { kind: 'ending', ending: 'secret' };
  }
  if (choice === 'escape') {
    return { kind: 'ending', ending: 'escape' };
  }
  if (choice === 'petition' && run.flags.kings_petition) {
    run.flags.kings_petition = false;
    applyWorldPatch(run, { thread: { id: 'king', stage: 'delivered' }, char: { id: 'ghost_king', memory: 'filed' } });
    return { kind: 'fight', spec: throneBoss, hpMult: 0.85 };
  }
  if (choice === 'honesty') {
    changeFame(run, 5);
    run.flags.corrupt_king_ending = true;
    return { kind: 'fight', spec: SECRET_BOSS, hpMult: 1, endingHint: 'corrupt_king' };
  }
  return { kind: 'fight', spec: throneBoss, hpMult: 1 };
}

export function throneEndingId(choice, fightResult) {
  if (choice === 'sigils' || choice === 'secret') return 'secret';
  if (choice === 'escape') return 'escape';
  if (fightResult === 'dead') return 'dead';
  if (choice === 'honesty') return 'corrupt_king';
  return 'win';
}
