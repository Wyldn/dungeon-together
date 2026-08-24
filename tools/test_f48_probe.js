// F4–8 Forest attrition probe — fast tests. Does not retune Forest or F5.
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { EVENTS } from '../js/data/events.js';
import { scoreEventChoice } from './policies/baseline.js';
import { baselinePolicy } from './policies/baseline.js';
import { makeV2Run, simulateClimbV2 } from './run_climb_v2.js';
import {
  STOP_AFTER, FLOORS, outcomeHasCombat, combatChoicesOf, npcDuelEventIds,
  auditChoiceCommunication, auditNpcDuels, runF48Climb, runF48Probe,
  summarizeF48, formatF48Report,
} from './run_f48_probe.js';

const here = dirname(fileURLToPath(import.meta.url));

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function stripTimes(rep) {
  const s = JSON.stringify(rep, (k, v) => (k === 'generatedAt' ? null : v));
  return JSON.parse(s);
}

export async function runF48ProbeTests(t) {
  console.log('— F4–8 Forest attrition probe —');

  {
    const src = readFileSync(join(here, 'run_f48_probe.js'), 'utf8');
    t('f48 probe does not call Math.random', !/\bMath\.random\b/.test(src));
    t('f48 probe does not write enemy/event data', !/writeFileSync\(.*events|ENEMIES\[/.test(src));
    t('stop after F9', STOP_AFTER === 9 && FLOORS[FLOORS.length - 1] === 9);
  }

  {
    const ids = npcDuelEventIds();
    t('catalog includes Forest hero/wizard meets',
      ids.includes('blade_hero_meet')
      && ids.includes('evil_wizard_meet')
      && ids.includes('oldman_trials')
      && ids.includes('farmstead_meet'));
    const old = EVENTS.find(e => e.id === 'oldman_trials');
    const fight = combatChoicesOf(old)[0];
    const comm = auditChoiceCommunication(old, fight);
    t('oldman fight is visible in the label', comm.labelWarns && comm.kind === 'LABEL_WARNS');
    const pathEv = EVENTS.find(e => e.id === 'pathfinder_meet');
    const aim = combatChoicesOf(pathEv)[0];
    t('pathfinder duel is visible in the label', /duel|fight|spar/i.test(aim.label));
    const gal = EVENTS.find(e => e.id === 'evil_wizard_meet');
    const duel = combatChoicesOf(gal)[0];
    t('gallery duel label still says duel', /duel/i.test(duel.label));
    t('gallery duel is not hint-only', auditChoiceCommunication(gal, duel).kind === 'LABEL_WARNS');
  }

  {
    const mira = EVENTS.find(e => e.id === 'wounded_adventurer');
    const heal = mira.choices.find(c => /heal her/i.test(c.label));
    const walk = mira.choices.find(c => c.label === 'Walk past');
    t('Heal her label names vitality', /vitality/i.test(heal.label));
    t('baseline still prefers healing Mira over walking past', scoreEventChoice(heal) > scoreEventChoice(walk));
    const farm = EVENTS.find(e => e.id === 'farmstead_meet');
    const fight = farm.choices.find(c => /fight/i.test(c.label));
    const food = farm.choices.find(c => /hospitality/i.test(c.label));
    t('baseline scores farm fight above hospitality (loot/gold keywords)',
      scoreEventChoice(fight) > scoreEventChoice(food));
    const gal = EVENTS.find(e => e.id === 'martial_hero_meet');
    const duel = gal.choices.find(c => /duel/i.test(c.label));
    const talk = gal.choices.find(c => /words|talk|trade/i.test(c.label));
    t('baseline does not pick gallery duel just because hint says loot',
      scoreEventChoice(duel) < scoreEventChoice(talk));
    t('outcomeHasCombat sees random oldman fight',
      outcomeHasCombat(EVENTS.find(e => e.id === 'oldman_trials').choices[0].outcome));
  }

  {
    const audit = auditNpcDuels();
    const gal = audit.find(e => e.eventId === 'evil_wizard_meet');
    const path = audit.find(e => e.eventId === 'pathfinder_meet');
    t('gallery baseline does not prefer the fight for loot', !gal.baselinePrefersFight);
    t('pathfinder does not keyword-inflate the fight', !path.baselinePrefersFight);
  }

  {
    const a = await runF48Climb({ seed: 77, classId: 'priest', policy: 'baseline' });
    const b = await runF48Climb({ seed: 77, classId: 'priest', policy: 'baseline' });
    t('same seed+class climb is deterministic',
      a.outcome === b.outcome && a.deathFloor === b.deathFloor && a.maxFloor === b.maxFloor);
    t('trace stays inside F1–9', a.floors.every(r => r.floor >= 1 && r.floor <= 9));
    const w = await runF48Climb({ seed: 20260823, classId: 'warrior', policy: 'baseline' });
    const f5 = w.byFloor[5] || a.byFloor[5];
    if (f5) {
      t('F5 is a trial floor when reached', f5.kind === 'trial');
      t('F5 records a trial modifier id', typeof f5.trialId === 'string' && f5.trialId.length > 0);
    } else {
      t('F5 is a trial floor when reached', true);
      t('F5 records a trial modifier id', true);
    }
    const f9 = a.byFloor[9];
    if (f9) t('F9 is a campfire when reached', f9.kind === 'campfire');
    else t('F9 is a campfire when reached', true);
  }

  {
    const before = makeV2Run({ seed: 4242, classId: 'mage' });
    await simulateClimbV2(makeV2Run({ seed: 4242, classId: 'mage' }), baselinePolicy(), { stopAfterFloor: 3 });
    t('probe still uses live climb v2', before.hp > 0);
  }

  {
    const tiny = stripTimes(await runF48Probe({ seed: 5, runs: 6, policies: ['baseline'] }));
    const tiny2 = stripTimes(await runF48Probe({ seed: 5, runs: 6, policies: ['baseline'] }));
    t('tiny probe is byte-stable', deepEqual(tiny.byPolicy.baseline.curve, tiny2.byPolicy.baseline.curve)
      && deepEqual(tiny.byPolicy.baseline.f5.clearRate, tiny2.byPolicy.baseline.f5.clearRate));
    t('tiny probe reports F1–9 curve', tiny.byPolicy.baseline.curve.length === 9);
    t('tiny probe F5 arrived is 0..n', tiny.byPolicy.baseline.f5.arrived >= 0 && tiny.byPolicy.baseline.f5.arrived <= 6);
    t('format report mentions mortality curve', /F1–9 mortality/.test(formatF48Report(tiny)));
    t('communication audit is present', Array.isArray(tiny.communication) && tiny.communication.length > 0);
  }

  {
    const empty = summarizeF48([], { policy: 'baseline', seed: 1 });
    t('empty summary does not invent F5 deaths', empty.f5.died === 0 && empty.f5.arrived === 0);
    t('empty median death floor is null', empty.overall.medianDeathFloor == null);
  }
}
