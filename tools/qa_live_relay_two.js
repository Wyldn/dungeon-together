// Live two-player smoke against the local relay (ws://127.0.0.1:3119).
// Not part of node tools/test.js — needs the relay process.

import { newRun } from '../js/state.js';
import { serializeClimber, buildCheckpoint, newResumeToken } from '../js/mp_checkpoint.js';
import { setPackEnabled, resetPackFlags } from '../js/content_pack/flags.js';
import { curseInfo } from '../js/content_pack/curse.js';
import { itemById } from '../js/data/items.js';
import { catalogEntries, presentEntry, renderEquipmentPanel, defaultFilters } from '../js/compendium.js';
import { COMPENDIUM_SEEN_KEY } from '../js/compendium_seen.js';

const RELAY = process.env.DT_RELAY || 'ws://127.0.0.1:3119';

function climber(name, extra = {}) {
  const run = newRun({ upgrades: {}, achievements: [] }, { classId: 'warrior', raceId: 'human', name, seed: 7 });
  run.coopMode = true;
  run.floor = extra.floor ?? 3;
  Object.assign(run, extra);
  return run;
}

function openWs(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => reject(new Error('ws timeout')), 8000);
    ws.addEventListener('open', () => { clearTimeout(timer); resolve(ws); });
    ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('ws error')); });
  });
}

function waitMsg(ws, pred, ms = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('msg timeout')), ms);
    const on = ev => {
      const msg = JSON.parse(ev.data);
      if (!pred(msg)) return;
      clearTimeout(timer);
      ws.removeEventListener('message', on);
      resolve(msg);
    };
    ws.addEventListener('message', on);
  });
}

function send(ws, obj) {
  ws.send(JSON.stringify(obj));
}

async function main() {
  const fails = [];
  const t = (name, ok) => {
    if (ok) console.log('  ok', name);
    else { console.error('  FAIL', name); fails.push(name); }
  };

  resetPackFlags();
  setPackEnabled(false);
  const offEntries = catalogEntries({ packOn: false });
  t('pack-off Compendium has no cp_ ids', offEntries.every(e => !String(e.id).startsWith('cp_')));
  t('pack-off player HTML has no CURSED pack sword',
    !renderEquipmentPanel({ debug: false, packOn: false, secretSkillIds: new Set(), callingUnlocked: () => true }, defaultFilters(), () => '')
      .includes('Coward'));

  setPackEnabled(true);
  const cursed = catalogEntries({ packOn: true }).find(e => e.id === 'cp_cowards_first_sword');
  t('pack-on cursed item keeps rarity rare', cursed?.rarity === 'rare' && curseInfo(cursed.source).cursed);
  t('pack-on undiscovered HTML hides the cursed name',
    presentEntry(cursed, { debug: false, packOn: true }).name === '???');
  t('itemById pack-on resolves cursed sword', itemById('cp_cowards_first_sword')?.name?.includes('Coward'));

  const tokenA = newResumeToken();
  const tokenB = newResumeToken();
  const a = await openWs(RELAY);
  send(a, { t: 'create', name: 'Ava', token: tokenA });
  const roomA = await waitMsg(a, m => m.t === 'room');
  t('host created a 4-letter room', typeof roomA.code === 'string' && roomA.code.length === 4);

  const b = await openWs(RELAY);
  send(b, { t: 'join', code: roomA.code, name: 'Bo', token: tokenB });
  const roomB = await waitMsg(b, m => m.t === 'room');
  t('guest joined the same room', roomB.code === roomA.code && roomB.you !== roomA.you);

  const errsA = [];
  a.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.t === 'err') errsA.push(msg);
  });

  const runP = waitMsg(a, m => m.t === 'run');
  send(a, { t: 'msg', data: { k: 'start', mode: 'majority' } });
  const runMsg = await runP;
  t('party start issued a runId', !!runMsg.runId);

  const packed = climber('Ava', {
    floor: 3,
    gold: 90,
    inventory: ['cp_cowards_first_sword', 'cp_last_bastion_chest'],
    relics: ['cp_receipt_from_tomorrow', 'cp_thrones_blank_sheet'],
    arts: ['cp_art_borrowed_mastery'],
    knownSkills: ['slash', 'cp_gatebreaker_charge'],
    skills: ['slash'],
    seenEvents: ['cp_backward_threshold'],
    packState: {
      run: { 'evo:cp_thrones_blank_sheet': 1, storedArchetype: 'skeleton', reservedShop: 30 },
      combat: { summons: 1 },
    },
  });
  packed.compendiumSeen = ['leak'];
  const ser = serializeClimber(packed);
  t('serialize pack climber', ser.ok && !JSON.stringify(ser.climber).includes(COMPENDIUM_SEEN_KEY));
  const built = buildCheckpoint({ runId: runMsg.runId, floor: 3, phase: 'floor-ready', seed: roomA.seed, shared: {} });
  t('build floor-ready checkpoint', built.ok);

  const cpAck = waitMsg(a, m => m.t === 'checkpoint' || m.t === 'err');
  send(a, { t: 'checkpoint', checkpoint: built.checkpoint, climber: ser.climber, revision: built.checkpoint.revision });
  const ack = await cpAck;
  t('host checkpoint accepted', ack.t === 'checkpoint');
  if (ack.t === 'err') console.error('host checkpoint err', ack);

  const serB = serializeClimber(climber('Bo', { floor: 3, gold: 40, relics: ['cp_unminted_coin'] }));
  send(b, { t: 'checkpoint', climber: serB.climber, revision: built.checkpoint.revision });
  await new Promise(r => setTimeout(r, 80));

  b.close();
  const b2 = await openWs(RELAY);
  send(b2, { t: 'resume', code: roomA.code, token: roomB.token || tokenB, name: 'Bo' });
  const resumedB = await waitMsg(b2, m => m.t === 'resume-ok' || m.t === 'err');
  t('guest reconnect restores climber', resumedB.t === 'resume-ok' && resumedB.climber?.relics?.includes('cp_unminted_coin'));
  t('guest reconnect is not waiting on combat', resumedB.wait == null);

  a.close();
  await new Promise(r => setTimeout(r, 80));
  const a2 = await openWs(RELAY);
  send(a2, { t: 'resume', code: roomA.code, token: roomA.token || tokenA, name: 'Ava' });
  const resumedA = await waitMsg(a2, m => m.t === 'resume-ok' || m.t === 'err');
  if (resumedA.t !== 'resume-ok') console.error('host resume', resumedA, 'errs', errsA);
  t('host reconnect restores cursed inventory and evolution',
    resumedA.t === 'resume-ok'
    && resumedA.climber?.inventory?.includes('cp_cowards_first_sword')
    && resumedA.climber?.packState?.run?.['evo:cp_thrones_blank_sheet'] === 1);
  t('host reconnect does not carry Compendium discovery',
    resumedA.climber && resumedA.climber.compendiumSeen == null);

  send(a2, { t: 'discard', token: tokenA });
  send(b2, { t: 'discard', token: tokenB });
  a2.close();
  b2.close();
  resetPackFlags();

  if (fails.length) {
    console.error(`${fails.length} live relay checks failed`);
    process.exit(1);
  }
  console.log('live relay two-player pack smoke passed');
}

main().catch(err => {
  console.error('live relay smoke threw', err);
  process.exit(1);
});
