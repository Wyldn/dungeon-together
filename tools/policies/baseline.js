// Default climb policy: pickSmart-style events, greedy gear, autoplay combat.
// Path cards use a separate RNG stream (seed ^ floor ^ 0xA11CE). Never the climb rng.

import { makeRng } from '../../js/rng.js';
import { reqMet } from '../../js/requirements.js';
import { gearScore, skillAutoScore } from '../../js/loot_score.js';
import { chooseAutoPlayAction } from '../../js/combat_policy.js';
import { itemById } from '../../js/data/items.js';
import { SKILLS } from '../../js/data/skills.js';
import { encounterOptions } from '../../js/encounter.js';
import { shopHealCost, shopPrice } from '../../js/shop.js';

function pathRng(run) {
  return makeRng((run.seed ^ run.floor ^ 0xA11CE) >>> 0);
}

function scoreEventChoice(choice) {
  const t = `${choice.label || ''} ${choice.hint || ''}`.toLowerCase();
  let s = 10;
  if (/leave|move on|walk away|nothing/.test(t)) s -= 9;
  const hardFight = /\b(hard fight|brutal fight|deadly|secret fight|boss-tier)\b/.test(t);
  // \brest\b so "restore resource" is not treated as an HP rest.
  // Do not let "loot" in a hard-fight hint outrank a safe alternative.
  if (!hardFight && /gold|relic|\bheal\b|\brest\b|sleep|train|loot|reward|potion/.test(t)) s += 6;
  if (hardFight) s -= 7;
  if (/sneak|bribe|meditate|pray|offer/.test(t)) s += 2;
  return s;
}

export { scoreEventChoice };

export function baselinePolicy(opts = {}) {
  return {
    name: 'baseline',
    chooseFloorCard(run, cards) {
      const rng = pathRng(run);
      return rng.pick(cards);
    },
    chooseEncounterApproach(run, group) {
      const o = encounterOptions(run, group);
      if (o.canBribe && run.hp / run.maxHp < 0.4) return 'bribe';
      if (run.hp / run.maxHp < 0.55) return 'sneak';
      return 'fight';
    },
    chooseEvent(run, ev, choices) {
      const ok = choices.filter(c => reqMet(run, c.req).ok);
      const pool = ok.length ? ok : choices;
      return pool.reduce((best, c) => scoreEventChoice(c) > scoreEventChoice(best) ? c : best, pool[0]);
    },
    chooseShopAction(run, stock, { discount }) {
      if (run.hp < run.maxHp * 0.55) {
        const cost = shopHealCost(run, discount);
        if (run.gold >= cost) return { act: 'heal' };
      }
      for (let i = 0; i < stock.length; i++) {
        const s = stock[i];
        const p = shopPrice(s.price, discount);
        if (run.gold < p) continue;
        if (s.kind === 'consumable' && (s.item.heal || s.item.healPct) && run.consumables.length < 4) {
          return { act: 'buy', i };
        }
      }
      return { act: 'leave' };
    },
    chooseEquip(run, item) {
      if (!item?.slot) return { act: 'stash' };
      const cur = item.slot === 'accessory'
        ? null
        : (run.equipment[item.slot] ? itemById(run.equipment[item.slot]) : null);
      if (!cur || gearScore(item) >= gearScore(cur) - 0.5) {
        const slot = item.slot === 'accessory'
          ? (['accessory1', 'accessory2', 'accessory3'].find(s => !run.equipment[s]) || 'accessory1')
          : item.slot;
        return { act: 'equip', slot };
      }
      return { act: 'sell' };
    },
    chooseSubclass(run, options) {
      return options.find(s => !s.secret) || options[0];
    },
    chooseDeepen() { return true; },
    chooseSkillOffer(run, pool) {
      return pool.reduce((a, b) => skillAutoScore(b) > skillAutoScore(a) ? b : a, pool[0]);
    },
    chooseSkillEquip() { return {}; },
    chooseCombatAction: chooseAutoPlayAction,
    chooseThrone(run) {
      if ((run.sigils || []).length >= 3) return 'sigils';
      return 'fight';
    },
    chooseWaypoint() { return 'recovery'; },
    chooseRelic(choices) {
      return choices.reduce((a, b) => gearScore(b) > gearScore(a) ? b : a, choices[0]);
    },
    chooseOption(options, { skillCost } = {}) {
      const affordable = skillCost ? options.filter(op => skillCost(op) <= 1e12) : options;
      const pool = affordable.length ? affordable : options;
      return pool.reduce((best, op) => {
        const score = op.kind === 'skill' || op.skill
          ? skillAutoScore(SKILLS[op.kind === 'skill' ? op.id : op.skill])
          : gearScore(itemById(op.id));
        const bestScore = best.kind === 'skill' || best.skill
          ? skillAutoScore(SKILLS[best.kind === 'skill' ? best.id : best.skill])
          : gearScore(itemById(best.id));
        return score > bestScore ? op : best;
      }, pool[0]);
    },
    ...opts,
  };
}
