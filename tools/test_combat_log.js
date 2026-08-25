// Combat-log formatting: structured events, not string-dedup.
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  formatCombatEvent, formatCombatEvents, parseIncomingHit,
  actionClause, basicVerbFor, combatLogAriaAttrs, COMBAT_LOG_ARIA,
  beginActionLog, queueHitOutcome, endActionLog, emitCombatEvent,
} from '../js/combat_log.js';
import { formatEnemyTelegraph, enemyTelegraph } from '../js/systems.js';
import { makeRng } from '../js/rng.js';
import { SKILLS } from '../js/data/skills.js';
import {
  buildEnemy, createCombatContext, resolvePlayerHit, resolveUseSkill,
  resolveEnemyTurn,
} from '../js/combat_core.js';
import { fixtureRun, fixtureEnemy } from './combat_fixtures.js';
import { parseCombatLogs as parseF20 } from './run_f20_probe.js';
import { parseCombatLogs as parseF10 } from './run_f10_probe.js';

function msgs(lines) { return lines.map(l => l.msg); }

export async function runCombatLogTests(t) {
  console.log('— combat log formatting —');

  const view = { selfName: 'Fixture' };

  {
    const line = formatCombatEvent({
      type: 'hit', actor: 'Tunnel Rat', target: 'you', verb: 'nibbled', dmg: 4, side: 'foe', basic: true,
    }, view);
    t('ordinary single-target uses authored verb', msgs(line)[0] === 'Tunnel Rat nibbled you for 4 damage.');
  }
  {
    const line = formatCombatEvent({
      type: 'hit', actor: 'Forest Bandit', target: 'you', verb: 'stabbed', dmg: 7, side: 'foe', basic: true,
    }, view);
    t('bandit stab is one primary line', msgs(line)[0] === 'Forest Bandit stabbed you for 7 damage.');
  }
  {
    const line = formatCombatEvent({
      type: 'hit', actor: 'Widow Spider', target: 'you', verb: 'poisoned', dmg: 3, side: 'foe', basic: true,
    }, view);
    t('spider poison-attack is one primary line', msgs(line)[0] === 'Widow Spider poisoned you for 3 damage.');
  }
  t('rat id maps to nibbled', basicVerbFor({ id: 'rat' }) === 'nibbled');
  t('wolf id maps to bit', basicVerbFor({ id: 'wolf' }) === 'bit');
  t('unknown creature falls back to hit', basicVerbFor({ id: 'gilded_mystery' }) === 'hit');
  t('slash clause uses the move as a verb', actionClause({ move: 'Slash', target: 'Dire Wolf' }) === 'slashed Dire Wolf');
  t('named skill clause keeps the move name', actionClause({ move: 'Savage Pounce', target: 'you' }) === 'used Savage Pounce on you');

  {
    const line = formatCombatEvent({
      type: 'hit', actor: 'You', target: 'Dire Wolf', move: 'Slash', dmg: 22, side: 'ally',
    }, view);
    t('named skill slash is one line', msgs(line)[0] === 'You slashed Dire Wolf for 22 damage.');
  }
  {
    const line = formatCombatEvent({
      type: 'hit', actor: 'You', target: 'Dire Wolf', move: 'Shield Bash', dmg: 23, side: 'ally',
    }, view);
    t('multi-word skill uses the move name', msgs(line)[0] === 'You used Shield Bash on Dire Wolf for 23 damage.');
  }

  {
    const line = formatCombatEvent({
      type: 'aoe', actor: 'You', move: 'Cleave', side: 'ally',
      outcomes: [
        { target: 'Dire Wolf', dmg: 12 },
        { target: 'Ironback Boar', dmg: 9 },
        { target: 'Feral Sprite', miss: true },
      ],
    }, view);
    t('AOE is one header plus compact outcomes',
      msgs(line)[0] === 'You used Cleave — Dire Wolf 12, Ironback Boar 9, Feral Sprite dodged.');
    t('AOE does not hide a dodge among hits', msgs(line)[0].includes('dodged'));
  }
  {
    const line = formatCombatEvent({
      type: 'aoe', actor: 'You', move: 'Cleave', side: 'ally',
      outcomes: [
        { target: 'Dire Wolf', dmg: 12 },
        { target: 'Gilded Knight', dmg: 0, immune: true },
      ],
    }, view);
    t('AOE keeps an immune target visible', msgs(line)[0].includes('Gilded Knight 0 (immune)'));
  }

  {
    const line = formatCombatEvent({
      type: 'multihit', actor: 'You', target: 'Dire Wolf', move: 'Flurry', hits: [4, 3, 5], side: 'ally',
    }, view);
    t('multi-hit lists each tick on one line',
      msgs(line)[0] === 'You flurried Dire Wolf for 4, 3, 5 damage.');
  }

  {
    const ticks = formatCombatEvents([
      { type: 'dot', kind: 'poison', target: 'Dire Wolf', dmg: 5, note: 'the frail flesh drinks it' },
      { type: 'dot', kind: 'burn', target: 'you', dmg: 5 },
    ], view);
    t('DoT poison keeps the tick line', msgs(ticks)[0].includes('suffers 5 poison damage'));
    t('DoT burn on you stays a distinct tick', msgs(ticks)[1] === 'You burn for 5.');
  }

  {
    const applied = formatCombatEvent({ type: 'status', target: 'Dire Wolf', status: 'poison', side: 'ally' }, view);
    const resisted = formatCombatEvent({ type: 'status', target: 'Dire Wolf', status: 'freeze', resisted: true, side: 'ally' }, view);
    t('status-only applied is its own line', msgs(applied)[0] === 'Dire Wolf is poisoned.');
    t('status resisted stays visible', msgs(resisted)[0] === 'Dire Wolf resists freeze.');
  }

  {
    const miss = formatCombatEvent({ type: 'miss', actor: 'Dire Wolf', reason: 'evade' }, view);
    t('dodge/evade is a miss line, not a damage line', msgs(miss)[0] === 'Dire Wolf attacks — you evade!');
  }

  {
    const zero = formatCombatEvent({
      type: 'hit', actor: 'You', target: 'Gilded Knight', move: 'Slash', dmg: 0, immune: true, side: 'ally',
    }, view);
    t('immunity/zero damage is explicit', msgs(zero)[0].includes('0 damage') && msgs(zero)[0].includes('immune'));
  }

  {
    const guard = formatCombatEvent({
      type: 'hit', actor: 'Dire Wolf', target: 'you', move: 'Savage Pounce', dmg: 3, guarded: true, side: 'foe',
    }, view);
    t('guard folds into the primary hit', msgs(guard)[0] === 'Dire Wolf used Savage Pounce on you for 3 damage (guarded).');
    const shield = formatCombatEvent({
      type: 'hit', actor: 'Dire Wolf', target: 'you', verb: 'bit', dmg: 2, shielded: true, side: 'foe', basic: true,
    }, view);
    t('shield folds into the primary hit', msgs(shield)[0].includes('(shielded)'));
    const ward = formatCombatEvent({ type: 'shield', mult: 0.45, turns: 3 }, view);
    t('raising a ward stays a status-only action', msgs(ward)[0].includes('You raise a ward'));
  }

  {
    const heal = formatCombatEvent({
      type: 'heal', actor: 'Mira', target: 'you', move: 'Mend', amt: 12,
    }, view);
    t('ally heal names actor, move, and amount', msgs(heal)[0] === 'Mira mends you with Mend. (+12 HP)');
  }

  {
    const thorns = formatCombatEvent({ type: 'counter', target: 'Dire Wolf', dmg: 4 }, view);
    t('counter/reflect is a secondary line', msgs(thorns)[0] === 'Thorns bite back — Dire Wolf takes 4.');
  }

  {
    const summon = formatCombatEvent({ type: 'summon', actor: 'Lich of the Fallen King' }, view);
    t('summon stays its own line', msgs(summon)[0].includes('drags a servant'));
  }

  {
    const death = formatCombatEvent({ type: 'death', target: 'Dire Wolf' }, view);
    t('death stays a secondary result', msgs(death)[0] === 'Dire Wolf is defeated!');
  }

  {
    const phase = formatCombatEvent({
      type: 'phase', text: 'The crown splits. The man underneath is worse.',
    }, view);
    t('phase transition stays its own line', msgs(phase)[0].includes('crown splits'));
  }

  {
    const sig = formatCombatEvent({
      type: 'telegraph',
      text: "Sylvanor, the Elderwood Guardian unleashes FOREST'S VERDICT! The air screams with pent-up force.",
    }, view);
    const hit = formatCombatEvent({
      type: 'hit',
      actor: 'Sylvanor, the Elderwood Guardian',
      target: 'you',
      move: "FOREST'S VERDICT",
      dmg: 54,
      side: 'foe',
    }, view);
    const combined = formatCombatEvents([
      { type: 'telegraph', text: sig[0].msg },
      { type: 'hit', actor: 'Sylvanor, the Elderwood Guardian', target: 'you', move: "FOREST'S VERDICT", dmg: 54, side: 'foe' },
    ], view);
    t('boss signature telegraph stays separate from the resolved hit', combined.length === 2);
    t('boss signature telegraph keeps the scream', combined[0].msg.includes('unleashes') && combined[0].msg.includes('screams'));
    t('resolved signature still names the move and damage', combined[1].msg.includes("FOREST'S VERDICT") && combined[1].msg.includes('54 damage'));
    t('telegraph renderer used', msgs(sig)[0].includes('unleashes'));
    t('resolved hit renderer used', msgs(hit)[0].includes('54 damage'));
  }

  {
    const cd = formatCombatEvent({ type: 'cooldown', move: 'Cleave', turns: 2 }, view);
    t('player cooldown feedback names the skill and remaining turns',
      msgs(cd)[0] === 'Cleave on cooldown (2 turns).');
    const cd1 = formatCombatEvent({ type: 'cooldown', move: 'Shield Bash', turns: 1 }, view);
    t('one-turn cooldown uses singular', msgs(cd1)[0] === 'Shield Bash on cooldown (1 turn).');
  }

  {
    const crit = formatCombatEvent({
      type: 'hit', actor: 'You', target: 'Dire Wolf', move: 'One Shot', dmg: 165, crit: true, side: 'ally',
    }, view);
    t('critical folds onto the primary line', msgs(crit)[0].includes('CRITICAL') && !msgs(crit)[0].includes('CRITICAL!.'));
  }

  {
    const a = formatCombatEvent({ type: 'hit', actor: 'Tunnel Rat', target: 'you', verb: 'nibbled', dmg: 4, side: 'foe' }, view);
    const b = formatCombatEvent({ type: 'hit', actor: 'Forest Bandit', target: 'you', verb: 'stabbed', dmg: 7, side: 'foe' }, view);
    const both = formatCombatEvents([
      { type: 'hit', actor: 'Tunnel Rat', target: 'you', verb: 'nibbled', dmg: 4, side: 'foe' },
      { type: 'hit', actor: 'Forest Bandit', target: 'you', verb: 'stabbed', dmg: 7, side: 'foe' },
    ], view);
    t('separate actors are never merged', both.length === 2 && both[0].msg !== both[1].msg);
    t('first actor stays first', both[0].msg.startsWith('Tunnel Rat') && both[1].msg.startsWith('Forest Bandit'));
    t('single-actor format is unchanged when emitted alone', a[0].msg === both[0].msg && b[0].msg === both[1].msg);
  }

  {
    const events = [
      { type: 'telegraph', text: '⚠ 6⚡ FOREST\'S VERDICT!' },
      { type: 'hit', actor: 'You', target: 'Sylvanor, the Elderwood Guardian', move: 'Slash', dmg: 18, side: 'ally' },
      { type: 'hit', actor: 'Sylvanor, the Elderwood Guardian', target: 'you', move: "FOREST'S VERDICT", dmg: 54, side: 'foe' },
      { type: 'status', target: 'you', status: 'frail', side: 'foe' },
    ];
    const a = formatCombatEvents(events, view);
    const b = formatCombatEvents(events, view);
    t('replay of the same events is byte-identical', JSON.stringify(a) === JSON.stringify(b));
    t('event order is preserved', a[0].msg.includes('FOREST') && a[1].msg.startsWith('You') && a[2].msg.startsWith('Sylvanor'));
    t('multiplayer host and observer share a formatter', a[2].msg === b[2].msg);
  }

  {
    const tel = enemyTelegraph({
      charge: 4,
      specials: [
        { at: 4, name: 'Mid', aoe: true, desc: 'winds up' },
        { at: 6, name: 'High', desc: 'signature' },
      ],
      boss: true,
    });
    t('boss charge-cost telegraph still formats', formatEnemyTelegraph(tel).includes('4⚡') && formatEnemyTelegraph(tel).includes('AOE'));
    t('UI telegraph is not a resolved-hit line', !formatEnemyTelegraph(tel).includes('damage'));
  }

  {
    const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'combat.js'), 'utf8');
    t('combat log markup uses the live-region helper', html.includes('combatLogAriaAttrs()'));
    t('live region helper is polite additions-only',
      COMBAT_LOG_ARIA['aria-live'] === 'polite'
      && COMBAT_LOG_ARIA['aria-relevant'] === 'additions'
      && COMBAT_LOG_ARIA['aria-atomic'] === 'false'
      && COMBAT_LOG_ARIA.role === 'log');
    t('live region has an accessible name', COMBAT_LOG_ARIA['aria-label'] === 'Combat log');
    t('aria helper matches the markup', combatLogAriaAttrs().includes('aria-live="polite"'));
    t('each primary line is a complete sentence',
      formatCombatEvent({ type: 'hit', actor: 'You', target: 'Dire Wolf', move: 'Slash', dmg: 4 }, view)[0].msg.endsWith('.'));
  }

  {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'css', 'main.css'), 'utf8');
    t('combat log stays on the pixel mono face',
      /\.combat-log \{[^}]*font-family:\s*var\(--font-mono\)/.test(css));
    t('combat log is not switched to Alegreya',
      !/\.combat-log \{[^}]*font-family:\s*var\(--font-prose\)/.test(css)
      && !/\.combat-log \{[^}]*Alegreya/.test(css));
  }

  {
    const used = parseIncomingHit("Sylvanor, the Elderwood Guardian used FOREST'S VERDICT on you for 54 damage.");
    t('parser reads combined special lines', used?.move === "FOREST'S VERDICT" && used.dmg === 54);
    const basic = parseIncomingHit('Dire Wolf bit you for 3 damage.');
    t('parser reads authored-verb basics as basic hits', basic?.kind === 'basic' && basic.dmg === 3 && basic.actor === 'Dire Wolf');
    const legacy = parseIncomingHit('Dire Wolf (Savage Pounce) hits you for 3 (guarded).');
    t('parser still reads legacy special lines', legacy?.move === 'Savage Pounce' && legacy.guarded && legacy.dmg === 3);
    const f20 = parseF20([
      { msg: "Sylvanor, the Elderwood Guardian used FOREST'S VERDICT on you for 54 damage." },
    ], { bossName: 'Sylvanor, the Elderwood Guardian' });
    t('F20 probe attributes combined specials', f20.dmg.special["FOREST'S VERDICT"] === 54 && f20.lastHit?.kind === 'finisher');
    const f10 = parseF10([
      { msg: "Sylvanor, the Elderwood Guardian used FOREST'S VERDICT on you for 54 damage." },
    ]);
    t('F10 probe attributes combined specials', f10.dmg.special["FOREST'S VERDICT"] === 54);
  }

  {
    const f = createCombatContext(
      fixtureRun({ classId: 'warrior', skills: ['slash'] }),
      makeRng(1),
      [fixtureEnemy('wolf', { uid: 'e1', floor: 5, hp: 80 }, buildEnemy)],
      null,
    );
    const logs = [];
    f.log = (msg, cls) => logs.push({ msg, cls });
    resolvePlayerHit(f, f.enemies[0], SKILLS.slash, f.d());
    const hits = logs.filter(l => /damage/.test(l.msg));
    t('core player hit emits one damage line', hits.length === 1);
    t('core player hit uses You + verb + target + damage', /You slashed Dire Wolf for \d+ damage/.test(hits[0].msg));
    t('core player hit does not also announce the attack', !logs.some(l => /attacked/.test(l.msg)));
  }

  {
    const f = createCombatContext(
      fixtureRun({ classId: 'warrior', skills: ['slash'], hp: 80 }),
      makeRng(303),
      [fixtureEnemy('wolf', { uid: 'e1', floor: 5, charge: 4 }, buildEnemy)],
      null,
    );
    f.player.guarding = true;
    const logs = [];
    f.log = (msg, cls) => logs.push({ msg, cls });
    resolveEnemyTurn(f, f.enemies[0]);
    const dmgLines = logs.filter(l => /damage/.test(l.msg) && /Dire Wolf/.test(l.msg));
    t('enemy special is one resolved line, not unleash + hit', dmgLines.length === 1);
    t('enemy special names the move and the damage', /used Savage Pounce on you for \d+ damage/.test(dmgLines[0].msg));
    t('unleash announcement is omitted for ordinary specials', !logs.some(l => /unleashes/.test(l.msg)));
  }

  {
    const f = createCombatContext(
      fixtureRun({ classId: 'warrior', skills: ['cleave'], mp: 80 }),
      makeRng(9),
      [
        fixtureEnemy('wolf', { uid: 'e1', floor: 5, hp: 80 }, buildEnemy),
        fixtureEnemy('boar', { uid: 'e2', floor: 5, hp: 80 }, buildEnemy),
      ],
      null,
    );
    f.charge = 6;
    f.target = 0;
    const logs = [];
    f.log = (msg, cls) => logs.push({ msg, cls });
    resolveUseSkill(f, SKILLS.cleave, SKILLS.cleave.cost);
    const primary = logs.filter(l => /used Cleave/.test(l.msg) || /cleaved/.test(l.msg));
    t('AOE skill emits one ability header', primary.length === 1);
    t('AOE header names both creatures', /Dire Wolf/.test(primary[0].msg) && /Ironback Boar/.test(primary[0].msg));
    t('AOE cooldown is a secondary line', logs.some(l => /Cleave on cooldown/.test(l.msg)));
  }

  {
    const f = { logs: [] };
    f.log = (msg, cls) => f.logs.push({ msg, cls });
    beginActionLog(f, { actor: 'You', move: 'Cleave', aoe: true });
    queueHitOutcome(f, { target: 'Dire Wolf', dmg: 12 });
    queueHitOutcome(f, { target: 'Ironback Boar', dmg: 9 });
    f._actionLog.extras.push({ msg: 'Dire Wolf is stunned.', cls: 'log-ally' });
    endActionLog(f);
    t('buffered AOE extras follow the header', f.logs[0].msg.startsWith('You used Cleave') && f.logs[1].msg === 'Dire Wolf is stunned.');
  }

  {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'js', 'combat_core.js'), 'utf8');
    t('core does not announce every special before the hit',
      !/f\.log\(`\$\{e\.name\} unleashes \$\{special\.name\}!\$\{scream\}`/.test(src));
    t('emitters render structured events', /emitCombatEvent\(/.test(src));
  }

  t('aria constants stay complete', COMBAT_LOG_ARIA.role === 'log' && COMBAT_LOG_ARIA['aria-live'] === 'polite');
}

const standalone = process.argv[1] && /test_combat_log\.js/.test(process.argv[1].replace(/\\/g, '/'));
if (standalone) {
  let pass = 0, fail = 0;
  function t(name, cond) {
    if (cond) pass++;
    else { fail++; console.error('  ✗ FAIL:', name); }
  }
  await runCombatLogTests(t);
  console.log(`combat log: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
