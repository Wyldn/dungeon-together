import { SKILLS, skillById } from './data/skills.js';
import { learnableSkills, learnableBloodlineArts, applySubclass, skillCapacity } from './character.js';
import { runRng } from './state.js';
import { noteDiscovery } from './compendium_seen.js';

export const SKILL_OFFER_LEVELS = [5, 9, 13, 17, 21, 25];
export const ART_OFFER_LEVELS = [5, 13];

/** Shuffle learnable skills, take 3, advance once. */
export function offerSkillPool(run, rng) {
  const pool = rng.shuffle(learnableSkills(run)).slice(0, 3);
  rng.advance();
  return pool;
}

export function applySkillLearn(run, skillId, { replaceId = null } = {}) {
  if (!skillId || !skillById(skillId)) return { learned: false };
  noteDiscovery(skillId);
  if (!run.knownSkills.includes(skillId)) run.knownSkills.push(skillId);
  const cap = skillCapacity(run);
  if (run.skills.includes(skillId)) return { learned: true, equipped: true };
  if (run.skills.length < cap) {
    run.skills.push(skillId);
    return { learned: true, equipped: true };
  }
  if (replaceId && run.skills.includes(replaceId)) {
    const i = run.skills.indexOf(replaceId);
    run.skills[i] = skillId;
    return { learned: true, equipped: true, replaced: replaceId };
  }
  return { learned: true, equipped: false };
}

export function applyLevelProgression(run, ups, policy, hooks = {}) {
  const results = [];
  for (const up of ups || []) {
    if (up.evolutionChoice?.length) {
      const pick = policy.chooseSubclass?.(run, up.evolutionChoice) || up.evolutionChoice.find(s => !s.secret) || up.evolutionChoice[0];
      if (pick) {
        applySubclass(run, pick);
        if (pick.skill) {
          const eq = policy.chooseSkillEquip?.(run, skillById(pick.skill) || SKILLS[pick.skill]);
          applySkillLearn(run, pick.skill, eq || {});
        }
        results.push({ kind: 'subclass', id: pick.id });
      }
    }
    if (up.deeper) {
      const ok = policy.chooseDeepen ? policy.chooseDeepen(run, up.deeper) !== false : true;
      if (ok) {
        applySubclass(run, up.deeper);
        if (up.deeper.skill) {
          const eq = policy.chooseSkillEquip?.(run, skillById(up.deeper.skill) || SKILLS[up.deeper.skill]);
          applySkillLearn(run, up.deeper.skill, eq || {});
        }
        results.push({ kind: 'deepen', id: up.deeper.id });
      }
    }
    if (SKILL_OFFER_LEVELS.includes(up.level)) {
      const rng = hooks.runRng ? hooks.runRng(run) : runRng(run);
      const pool = offerSkillPool(run, rng);
      if (pool.length) {
        const pick = policy.chooseSkillOffer?.(run, pool);
        if (pick?.id) {
          const eq = policy.chooseSkillEquip?.(run, pick);
          applySkillLearn(run, pick.id, eq || {});
          results.push({ kind: 'skill', id: pick.id });
        }
      }
    }
    if (ART_OFFER_LEVELS.includes(up.level)) {
      const arts = learnableBloodlineArts(run);
      if (arts.length) {
        const pick = policy.chooseArtOffer?.(run, arts) || policy.chooseSkillOffer?.(run, arts) || arts[0];
        if (pick?.id) {
          applySkillLearn(run, pick.id, {});
          run.arts = run.arts || [];
          if (!run.arts.includes(pick.id)) run.arts.push(pick.id);
          results.push({ kind: 'art', id: pick.id });
        }
      }
    }
  }
  return results;
}
