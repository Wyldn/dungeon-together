#!/usr/bin/node
// Gate 7 content-path audit. Enables the pack explicitly. Does not deploy.
import { writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import '../js/content_pack/bootstrap.js';
import { setPackEnabled, setPackGate, resetPackFlags, GATE, isPackOn, packStatus } from '../js/content_pack/flags.js';
import { buildPathGraph, staticValidate, classifyStatic } from '../js/content_pack/path_graph.js';
import {
  proveEntry, measureEventFamilies, multiplayerOwnershipScenarios,
  compendiumRenderDoesNotDiscover,
} from '../js/content_pack/path_pursuit.js';
import { resetCompendiumSeen } from '../js/compendium_seen.js';
import { inOrdinaryLoot } from '../js/content_pack/acquisition.js';

export const STARTING_COMMIT_SHA = 'cf607bcd3c941c7840fad42da5ed6253bbcc7d85';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const REPORTS = join(ROOT, 'reports');

export const FIXES_MADE = [
  'Named Unique class signatures onto existing class events (Ranger javelin, Monk staff, Bard bell, Necromancer sickle).',
  'Named remaining cursed weapons/armor onto themed events (Fame Eater tooth, Coinmouth Maul, Eighth Oath, Funeral Receipt dagger, Bell-clapper Greatclub, Crimson Memory Mail, Mandatory Optionality, Furnace-Honest Plate, Drowned dress/rapier, Possessionless Robe, Final Gate Uniform).',
  'Named quest relics Ring of Seven Owners, Hoard\'s First Coin, Administrator\'s Bent Key, and Funeral Receipt consumable onto matching chains.',
  'Set royalClaimant and cp_seventh_met as produced flags; persistFlag producers (bentKey, crownFragment, paidGrave) counted as flag sources.',
  'Expanded chain when.any so identity/alternate first-event choices still unlock revisits (False System, Futures, Fame Eater, Seven Owners, Inward Gate, Bell, Crimson, Echo, Drowned Court).',
  'Wired resolveCurse outcomes onto resolution choices; campfire resolves remember_damage; resolveCurse accepts curse ids and arrays.',
  'Class/bloodline/biome-find competing loot channels; Unique/WRLD remain out of ordinary loot; WRLD grants use the party claim ledger.',
  'learnableSkills excludes bloodline arts; ART_OFFER_LEVELS grant into arts + knownSkills; ranger maps to archer via classIdsMatch.',
  'partyMissingCount ignores disconnect; cursed sell blocked until resolved; Unique duplicate refused per climber.',
  'Recipient pay/receive recorded on coop outcomes; lastOwnership stamped in applyEventOutcome.',
  'Acquisition graph, static validators, deterministic pursuit traces (floorMin/biome windows, preferred grant branches, instance-isolated evolution), and satellite reports.',
];

function writeJson(name, data) {
  mkdirSync(REPORTS, { recursive: true });
  const path = join(REPORTS, name);
  writeFileSync(path, JSON.stringify(data, null, 2));
  return path;
}

function mdEscape(s) {
  return String(s || '').replace(/\|/g, '\\|');
}

export async function runContentPathAudit({ writeReports = true, proveAll = true } = {}) {
  resetPackFlags();
  setPackEnabled(true);
  setPackGate(GATE.MULTIPLAYER);
  if (!isPackOn() || packStatus().gate !== GATE.MULTIPLAYER) {
    throw new Error('Gate 7 was not enabled for the content-path audit');
  }

  let headSha = STARTING_COMMIT_SHA;
  try { headSha = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(); } catch { /* */ }

  resetCompendiumSeen();
  const graph = buildPathGraph();
  const statics = staticValidate(graph);
  const proofs = {};
  if (proveAll) {
    for (const entry of graph.entries) {
      proofs[entry.id] = await proveEntry(entry, graph);
    }
  }

  const classifications = {};
  const counts = {
    STATICALLY_REACHABLE: 0,
    DYNAMICALLY_PROVEN: 0,
    REACHABLE_AFTER_FIX: 0,
    UNRESOLVED: 0,
  };
  for (const entry of graph.entries) {
    const proof = proofs[entry.id];
    const stat = classifyStatic(entry, statics.defects);
    let cls = stat;
    if (proof?.ok) cls = 'DYNAMICALLY_PROVEN';
    else if (stat === 'STATICALLY_REACHABLE' && proof && proof.ok === false) cls = 'UNRESOLVED';
    else if (stat === 'UNRESOLVED' && proof?.ok) cls = 'REACHABLE_AFTER_FIX';
    classifications[entry.id] = {
      classification: cls,
      category: entry.category,
      sources: (entry.sources || []).map(s => s.type),
      proof: proof ? { ok: proof.ok, reason: proof.reason || null, trace: proof.trace || null } : null,
    };
    counts[cls] = (counts[cls] || 0) + 1;
  }

  const families = proveAll ? await measureEventFamilies(graph, { trials: 24 }) : [];
  const mp = proveAll ? await multiplayerOwnershipScenarios() : [];
  const compendium = compendiumRenderDoesNotDiscover();

  const orphaned = graph.entries.filter(e => !e.sources?.length).map(e => ({
    id: e.id, category: e.category, classification: classifications[e.id]?.classification,
  }));
  const impossible = statics.defects.filter(d =>
    ['CONTRADICTORY_REQUIREMENTS', 'FLAG_NEVER_PRODUCED', 'EVENT_ORDER_IMPOSSIBLE',
      'FLOOR_WINDOW_CLOSES_BEFORE_REVISIT', 'CURSE_AFTER_RESOLUTION_EXPIRED',
      'EVOLUTION_CANNOT_FINISH'].includes(d.code));
  const setReport = graph.entries.filter(e => e.category === 'armor_set_bonus').map(e => ({
    id: e.id, ok: proofs[e.id]?.ok, worn: proofs[e.id]?.worn, pieces: e.pieces,
  }));
  const curseReport = graph.entries.filter(e => e.category === 'curse_resolution_stage').map(e => ({
    id: e.id, ok: proofs[e.id]?.ok, resolved: proofs[e.id]?.resolved, sources: e.sources,
  }));
  const evoReport = graph.entries.filter(e => e.category === 'evolution_stage').map(e => ({
    id: e.id, ok: proofs[e.id]?.ok, saved: proofs[e.id]?.saved,
  }));
  const uniqueWrld = graph.entries.filter(e => e.uniqueClaim || e.wrldClaim).map(e => ({
    id: e.id, unique: e.uniqueClaim, wrld: e.wrldClaim, ok: proofs[e.id]?.ok,
    duplicates: e.duplicates, inOrdinary: inOrdinaryLoot(graph.items.find(i => i.id === e.id) || {}),
  }));
  const discovery = {
    renderDoesNotDiscover: compendium,
    provenDiscoveries: Object.entries(proofs).filter(([, p]) => p?.discovered).length,
  };

  const audit = {
    startingCommitSha: STARTING_COMMIT_SHA,
    headSha,
    packOn: isPackOn(),
    gate: packStatus().gate,
    generatedAt: new Date().toISOString(),
    counts: {
      entries: graph.entries.length,
      events: graph.events.length,
      items: graph.items.length,
      skills: graph.skills.length,
      grants: graph.grants.length,
      defects: statics.defects.length,
      ...counts,
    },
    classifications,
    defects: statics.defects,
    fixes: FIXES_MADE,
    unresolved: Object.entries(classifications)
      .filter(([, v]) => v.classification === 'UNRESOLVED')
      .map(([id, v]) => ({ id, ...v })),
  };

  if (writeReports) {
    writeJson('content_path_audit.json', audit);
    writeJson('content_path_acquisition_graph.json', {
      startingCommitSha: STARTING_COMMIT_SHA,
      entries: graph.entries,
      grants: graph.grants,
      flagsSet: graph.flagsSet,
      persistFlags: graph.persistFlags,
    });
    writeJson('content_path_orphaned.json', { startingCommitSha: STARTING_COMMIT_SHA, orphaned });
    writeJson('content_path_impossible_requirements.json', { startingCommitSha: STARTING_COMMIT_SHA, impossible, allDefects: statics.defects });
    writeJson('content_path_event_chains.json', { startingCommitSha: STARTING_COMMIT_SHA, families });
    writeJson('content_path_set_completion.json', { startingCommitSha: STARTING_COMMIT_SHA, sets: setReport });
    writeJson('content_path_curse_resolution.json', { startingCommitSha: STARTING_COMMIT_SHA, curses: curseReport });
    writeJson('content_path_evolution.json', { startingCommitSha: STARTING_COMMIT_SHA, evolutions: evoReport });
    writeJson('content_path_unique_wrld.json', { startingCommitSha: STARTING_COMMIT_SHA, items: uniqueWrld });
    writeJson('content_path_multiplayer_ownership.json', { startingCommitSha: STARTING_COMMIT_SHA, scenarios: mp });
    writeJson('content_path_compendium_discovery.json', { startingCommitSha: STARTING_COMMIT_SHA, discovery });
    writeJson('content_path_fixes.json', { startingCommitSha: STARTING_COMMIT_SHA, fixes: FIXES_MADE });

    const lines = [
      '# Gate 7 content-path audit',
      '',
      `Starting commit: \`${STARTING_COMMIT_SHA}\``,
      `HEAD at report time: \`${headSha}\``,
      `Pack: **on**, gate **${packStatus().gate}** (MULTIPLAYER).`,
      '',
      'A catalog definition is not reachability. Every enabled entry was inventoried, sourced, statically validated, and pursued on the deterministic climb systems.',
      '',
      '## Counts',
      '',
      `| metric | n |`,
      `| --- | --- |`,
      `| entries | ${graph.entries.length} |`,
      `| DYNAMICALLY_PROVEN | ${counts.DYNAMICALLY_PROVEN} |`,
      `| STATICALLY_REACHABLE | ${counts.STATICALLY_REACHABLE} |`,
      `| REACHABLE_AFTER_FIX | ${counts.REACHABLE_AFTER_FIX} |`,
      `| UNRESOLVED | ${counts.UNRESOLVED} |`,
      `| static defects | ${statics.defects.length} |`,
      '',
      '## Satellite reports',
      '',
      '- `reports/content_path_acquisition_graph.json` — complete acquisition graph',
      '- `reports/content_path_orphaned.json` — orphaned-entry report',
      '- `reports/content_path_impossible_requirements.json` — impossible-requirement report',
      '- `reports/content_path_event_chains.json` — event-chain completion report',
      '- `reports/content_path_set_completion.json` — set-completion report',
      '- `reports/content_path_curse_resolution.json` — curse-resolution report',
      '- `reports/content_path_evolution.json` — evolution-path report',
      '- `reports/content_path_unique_wrld.json` — Unique/WRLD claim report',
      '- `reports/content_path_multiplayer_ownership.json` — multiplayer ownership report',
      '- `reports/content_path_compendium_discovery.json` — Compendium-discovery coverage report',
      '- `reports/content_path_fixes.json` — exact list of fixes',
      '',
      '## Fixes made',
      '',
      ...FIXES_MADE.map(f => `- ${mdEscape(f)}`),
      '',
      '## Unresolved',
      '',
    ];
    const unresolved = audit.unresolved;
    if (!unresolved.length) lines.push('None. Target of zero UNRESOLVED entries is met.');
    else {
      lines.push('| id | category | reason |');
      lines.push('| --- | --- | --- |');
      for (const u of unresolved.slice(0, 80)) {
        lines.push(`| ${u.id} | ${u.category} | ${mdEscape(u.proof?.reason || (u.sources || []).join(',') || 'no source')} |`);
      }
      if (unresolved.length > 80) lines.push(`| … | ${unresolved.length - 80} more | |`);
    }
    writeFileSync(join(REPORTS, 'content_path_audit.md'), lines.join('\n'));
  }

  return { graph, statics, classifications, counts, audit, proofs, families, mp, uniqueWrld };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  runContentPathAudit().then((r) => {
    console.log(JSON.stringify({
      startingCommitSha: STARTING_COMMIT_SHA,
      packOn: true,
      gate: GATE.MULTIPLAYER,
      counts: r.counts,
      defects: r.statics.defects.length,
      unresolved: r.audit.unresolved.length,
    }, null, 2));
    if (r.counts.UNRESOLVED) process.exitCode = 1;
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
