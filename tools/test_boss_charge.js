// Focused Battle Charge kit tests: earn, partial spend, eligibility, intent,
// payoff, and live-core resolution. Does not retune trash or player classes.

import { CONFIG } from '../js/data/config.js';
import { BOSSES, ALT_BOSSES, SECRET_BOSS } from '../js/data/enemies.js';
import { SUPPORTED_SPECIAL_KEYS } from '../js/data/biome_kits.js';
import {
  tickEnemyCharge, pickEnemySpecial, enemyTelegraph, formatEnemyTelegraph,
  spendEnemySpecialCharge, bossChargeDamageScale, enemySpecialPayoff,
} from '../js/systems.js';
import { makeRng } from '../js/rng.js';
import {
  buildEnemy, createCombatContext, resolveEnemyTurn,
} from '../js/combat_core.js';
import { fixtureRun } from './combat_fixtures.js';

export async function runBossChargeTests(t) {
  console.log('— boss battle-charge kit —');

  for (const b of [...Object.values(BOSSES), ...Object.values(ALT_BOSSES), SECRET_BOSS]) {
    t(`boss ${b.id}: kit has 3+ spends`, Array.isArray(b.specials) && b.specials.length >= 3);
    const ats = (b.specials || []).map(s => s.at);
    t(`boss ${b.id}: has a low spend`, Math.min(...ats) <= 2);
    t(`boss ${b.id}: has a signature`, Math.max(...ats) >= 5);
    for (const s of [...(b.specials || []), ...(b.phase2?.specials || [])]) {
      for (const k of Object.keys(s)) {
        t(`${b.id} ${s.name} field ${k} is supported`, SUPPORTED_SPECIAL_KEYS.has(k));
      }
    }
  }

  {
    const e = { charge: 0, chargeGain: 1, _chargeFrac: 0, boss: true };
    tickEnemyCharge(e);
    t('boss earns 1 charge per turn at rate 1', e.charge === 1);
    tickEnemyCharge(e);
    t('boss charge accumulates across turns', e.charge === 2);
  }

  {
    const alwaysSpend = { chance: () => false };
    const alwaysBank = { chance: () => true };
    const boss = {
      boss: true, charge: 4, bankChance: 0.7, midBankChance: 0.3,
      specials: [
        { at: 2, name: 'Low', mult: 1.2 },
        { at: 4, name: 'Mid', mult: 1.5 },
        { at: 6, name: 'High', mult: 2.4 },
      ],
    };
    t('ineligible below cheapest at', pickEnemySpecial({ ...boss, charge: 1 }) === null);
    t('low is eligible at 2', pickEnemySpecial({ ...boss, charge: 2 }, alwaysSpend)?.name === 'Low');
    t('mid wins over low when both affordable', pickEnemySpecial(boss, alwaysSpend)?.name === 'Mid');
    t('mid can still bank toward signature', pickEnemySpecial(boss, alwaysBank) === null);
    t('signature fires when afforded', pickEnemySpecial({ ...boss, charge: 6 }, alwaysBank)?.name === 'High');
  }

  {
    const pay = enemySpecialPayoff(
      { vsStatus: 'frail', vsStatusMult: 1.3, mult: 2.7 },
      { frail: 2 },
      1,
    );
    t('verdict-style payoff cashes frail', pay.mult > 1.2 && pay.reasons.includes('brittleness'));
    const freezePay = enemySpecialPayoff(
      { vsStatus: 'freeze', vsStatusMult: 1.3, freezeSure: true },
      { frozen: 1 },
      1,
    );
    t('winter-style payoff cashes freeze', freezePay.mult > 1.2);
  }

  {
    const tel = enemyTelegraph({
      boss: true, charge: 4,
      specials: [
        { at: 2, name: 'Low', desc: 'chip' },
        { at: 4, name: 'Mid', aoe: true, desc: 'the room leans' },
        { at: 6, name: 'High', desc: 'commits' },
      ],
    });
    t('ready intent shows cost and AOE', formatEnemyTelegraph(tel) === '⚠ 4⚡ Mid AOE!');
  }

  {
    const run = fixtureRun({ classId: 'warrior', skills: ['slash'], hp: 80, maxHp: 80, floor: 10 });
    const spec = {
      id: 'kit_probe', name: 'Kit Probe', glyph: '🌲',
      hp: 200, atk: 10, def: 2, spd: 3, gold: [0, 0], xp: 1,
      boss: true, bankChance: 0, midBankChance: 0,
      specials: [
        { at: 4, name: 'Mid Sweep', mult: 1.4, aoe: true, lazy: 1 },
      ],
    };
    const enemy = buildEnemy(spec, 10, 1, { boss: true, partySize: 1, uid: 'kit1' });
    enemy.charge = 4;
    enemy._chargeFrac = 0;
    const f = createCombatContext(run, makeRng(20260825), [enemy]);
    await resolveEnemyTurn(f, enemy);
    t('live core spends 4 and keeps leftover after the turn tick', enemy.charge === 1);
    t('mid kit applied a rider or dealt damage', run.hp < 80 || !!f.player.statuses.lazy || !!f.player.statuses.frail);
  }

  {
    const run = fixtureRun({ classId: 'warrior', skills: ['slash'], hp: 160, maxHp: 160, floor: 10 });
    const spec = {
      id: 'sig_probe', name: 'Sig Probe', glyph: '🌲',
      hp: 200, atk: 8, def: 2, spd: 3, gold: [0, 0], xp: 1,
      boss: true, bankChance: 0,
      specials: [{ at: 6, name: 'Big ST', mult: 2.5 }],
    };
    const enemy = buildEnemy(spec, 10, 1, { boss: true, partySize: 1, uid: 'sig1' });
    enemy.charge = 6;
    enemy._chargeFrac = 0;
    const f = createCombatContext(run, makeRng(7), [enemy]);
    const hpBefore = run.hp;
    await resolveEnemyTurn(f, enemy);
    t('full-HP climber survives a 6-cost ST from a modest probe boss', run.hp > 0);
    t('signature still took a real bite', run.hp < hpBefore);
    t('AOE scale is below ST scale at the same spend',
      bossChargeDamageScale(6, { aoe: true }) < bossChargeDamageScale(6, { aoe: false }));
  }

  t('aoe factor is authored not 1', (CONFIG.boss.aoeChargeFactor ?? 1) < 1);

  {
    const rng = makeRng(20260825);
    const e = {
      boss: true, charge: 0, _chargeFrac: 0, chargeGain: 1,
      bankChance: 0.62, midBankChance: 0.4,
      specials: [
        { at: 2, name: 'Low', mult: 1.2 },
        { at: 4, name: 'Mid', mult: 1.5 },
        { at: 6, name: 'High', mult: 2.4 },
      ],
    };
    let kit = 0, sig = 0, other = 0;
    for (let i = 0; i < 120; i++) {
      tickEnemyCharge(e);
      const s = pickEnemySpecial(e, rng);
      if (!s) other += 1;
      else if (s.name === 'High') { sig += 1; spendEnemySpecialCharge(e, s); }
      else { kit += 1; spendEnemySpecialCharge(e, s); }
    }
    t('long sample still spends the mid-kit', kit >= 20);
    t('long sample still reaches the signature', sig >= 3);
    t('long sample is not signature-only', kit > sig);
  }
}

const standalone = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('tools/test_boss_charge.js');
if (standalone) {
  let pass = 0, fail = 0;
  function t(name, cond) {
    if (cond) pass++;
    else { fail++; console.error('  ✗ FAIL:', name); }
  }
  try {
    await runBossChargeTests(t);
  } catch (err) {
    fail++;
    console.error('  ✗ FAIL: boss charge suite threw', err);
  }
  console.log(`${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
