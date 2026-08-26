// Light tests for the Gate 7 measurement harness. Does not run the full climb matrix.

import { itemById } from '../js/data/items.js';
import {
  SEED_BANK, STARTING_COMMIT, climbSeed, seedsFor, armPack, catalogSnapshot, makeCollector, compactGrantActs,
} from './content_pack_balance_lib.js';
import { CANONICAL_CLASSES, CANONICAL_BLOODLINES } from '../js/content_pack/manifest.js';
import { GATE } from '../js/content_pack/flags.js';
import { isPackOn, activeGate } from '../js/content_pack/flags.js';

export function runContentPackBalanceHarnessTests(t) {
  console.log('— content pack balance harness / seed bank —');
  t('starting commit is recorded', /^[0-9a-f]{40}$/.test(STARTING_COMMIT));
  t('seed bank initial is 24', SEED_BANK.initialN === 24 && SEED_BANK.expansionN === 96);
  const a = climbSeed('warrior', 'human', 0);
  const b = climbSeed('warrior', 'human', 0);
  const c = climbSeed('warrior', 'human', 1);
  const d = climbSeed('mage', 'human', 0);
  t('climb seeds are deterministic', a === b && a !== c);
  t('class changes the seed', a !== d);
  const bank = seedsFor('priest', 'elf', 24);
  t('24 unique initial seeds per combo', new Set(bank).size === 24);
  t('expansion continues the same sequence', seedsFor('priest', 'elf', 96)[0] === bank[0] && seedsFor('priest', 'elf', 96)[23] === bank[23]);

  const off = armPack(false);
  t('setPackEnabled(false) is pack-off', off.on === false && off.gate === 0 && isPackOn() === false);
  t('vanilla lookup still works pack-off', !!itemById('potion_s'));
  const on = armPack(true, GATE.MULTIPLAYER);
  t('setPackEnabled(true)+Gate 7 is pack-on', on.on === true && on.gate === GATE.MULTIPLAYER && activeGate() === GATE.MULTIPLAYER);
  t('pack item exists when armed', !!itemById('cp_gate_iron_sword') || !!itemById('cp_twin_hatchets'));

  const cat = catalogSnapshot();
  t('catalog snapshot is Gate 7', cat.flags.gate === 7 && cat.flags.on === true);
  t('eleven classes and eight bloodlines', CANONICAL_CLASSES.length === 11 && CANONICAL_BLOODLINES.length === 8);
  t('catalog has items and events', cat.counts.items > 0 && cat.counts.events >= 135);
  t('rarity report has ordinary denom', cat.rarity.equipment.ordinaryDenom >= 0);
  t('collector initializes shop + bosses', makeCollector().shop.visits === 0 && makeCollector().f10.arrive === 0);
  const compact = compactGrantActs([
    { id: 'a', act: 'equip', useful: true },
    { id: 'a', act: 'stash' },
    { id: 'b', act: 'sell', incompatible: true },
  ]);
  t('compact grant acts keep offer/equip/sell', compact.a.n === 2 && compact.a.equip === 1 && compact.b.sell === 1 && compact.b.incompatible === 1);

  armPack(false);
}
