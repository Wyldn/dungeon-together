// Replays a recorded decision trace. Must not call climb RNG.

import { chooseAutoPlayAction } from '../../js/combat_policy.js';

export function scriptedPolicy(decisions = []) {
  const q = [...decisions];
  let combatAuto = false;
  const take = (type) => {
    const d = q.shift();
    if (!d) throw new Error(`scripted policy: no decision left (wanted ${type})`);
    if (type && d.t !== type) {
      throw new Error(`scripted policy: expected ${type}, got ${d.t}`);
    }
    return d;
  };
  return {
    name: 'scripted',
    remaining: () => q.length,
    chooseFloorCard(run, cards) {
      const d = take('card');
      const i = d.i ?? 0;
      if (i < 0 || i >= cards.length) throw new Error(`scripted card index ${i} out of range`);
      return cards[i];
    },
    chooseEncounterApproach() {
      return take('approach').act;
    },
    chooseEvent(run, ev, choices) {
      const d = take('event');
      if (d.i != null) return choices[d.i];
      const hit = choices.find(c => (c.id || c.label) === d.label);
      if (!hit) throw new Error(`scripted event choice not found: ${d.label}`);
      return hit;
    },
    chooseShopAction() {
      return take('shop');
    },
    chooseEquip() {
      return take('equip');
    },
    chooseSubclass(run, options) {
      const d = take('subclass');
      return options.find(s => s.id === d.id) || options[d.i || 0];
    },
    chooseDeepen() {
      if (q[0]?.t === 'deepen') return take('deepen').ok !== false;
      return true;
    },
    chooseSkillOffer(run, pool) {
      const d = take('skill');
      if (d.skip) return null;
      return pool.find(s => s.id === d.id) || pool[d.i || 0];
    },
    chooseSkillEquip() {
      if (q[0]?.t === 'skillEquip') return take('skillEquip');
      return {};
    },
    beginFight() {
      if (q[0]?.t === 'combatAuto') {
        take('combatAuto');
        combatAuto = true;
      } else {
        combatAuto = false;
      }
    },
    chooseCombatAction(f) {
      if (combatAuto) return chooseAutoPlayAction(f);
      const d = take('combat');
      return d.action;
    },
    chooseThrone() {
      return take('throne').choice;
    },
    chooseWaypoint() {
      return take('waypoint').category;
    },
    chooseRelic(choices) {
      const d = take('relic');
      return choices.find(r => r.id === d.id) || choices[d.i || 0];
    },
    chooseOption(options) {
      const d = take('option');
      return options.find(o => (o.id || o.kind) === d.id) || options[d.i || 0];
    },
  };
}
