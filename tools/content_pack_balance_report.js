import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import {
  CANONICAL_CLASSES, CANONICAL_BLOODLINES, SEED_BANK,
  summarizeRuns, groupBy, mergeCounts, mean, rateCi,
} from './content_pack_balance_lib.js';
import { grantKind } from './content_pack_balance_tables.js';

function pct(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function num(v, d = 2) {
  if (v == null || !Number.isFinite(v)) return '—';
  return Number(v).toFixed(d);
}

function usageTable(list, n = 16) {
  if (!list?.length) return '_None recorded._';
  return mdTable(
    ['Id', 'Count', 'Per run'],
    list.slice(0, n).map(x => [x.id, x.count, num(x.perRun, 3)]),
  );
}

const REQUIRED_FAMILIES = [
  ['echo', 'Echo and copied-action chains'],
  ['delay', 'Delayed damage and delayed healing'],
  ['revive', 'Revives and deathwards'],
  ['redirect', 'Damage reflection and redirection'],
  ['summon', 'Summons and temporary allies'],
  ['intent', 'Intent manipulation'],
  ['currency_power', 'Fame- and gold-powered effects'],
  ['conversion', 'Resource substitution and conversion'],
  ['start_charge', 'Starting charge'],
  ['extra_skill_capacity', 'Extra skill capacity'],
  ['sets', 'Set bonuses'],
  ['resonance', 'Bloodline resonance'],
  ['curse', 'Cursed drawbacks and resolutions'],
  ['evolution', 'Equipment evolution'],
  ['event_relic', 'Event relic operations'],
  ['unique_wrld', 'Unique and WRLD effects'],
];

function mdTable(headers, rows) {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map(r => `| ${r.map(c => String(c ?? '—')).join(' | ')} |`).join('\n');
  return `${head}\n${sep}\n${body}`;
}

function slice(rows, packOn, policy, classId, raceId) {
  return rows.filter(r => !r.error
    && r.packOn === packOn
    && (!policy || r.policy === policy)
    && (!classId || r.classId === classId)
    && (!raceId || r.raceId === raceId));
}

function comboKey(r) {
  return `${r.classId}/${r.raceId}`;
}

function dominant(map, minShare = 0.35) {
  const entries = Object.entries(map || {}).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, n]) => s + n, 0);
  if (!total || !entries.length) return [];
  return entries.filter(([, n]) => n / total >= minShare).map(([id, n]) => ({ id, n, share: n / total }));
}

export function detectAnomalies({ climbs, mechanics, party, catalog, baselineTests }) {
  const list = [];
  const add = (row) => list.push(row);

  const baseOff = slice(climbs, false, 'baseline');
  const baseOn = slice(climbs, true, 'baseline');

  for (const classId of CANONICAL_CLASSES) {
    const off = summarizeRuns(slice(baseOff, false, 'baseline', classId));
    const on = summarizeRuns(slice(baseOn, true, 'baseline', classId));
    if (!off.n || !on.n) continue;
    const dFloor = (on.floor.avg.mean ?? 0) - (off.floor.avg.mean ?? 0);
    const dF10 = (on.f10.arrive.rate ?? 0) - (off.f10.arrive.rate ?? 0);
    if (Math.abs(dFloor) >= 4) {
      add({
        severity: Math.abs(dFloor) >= 8 ? 'high' : 'medium',
        kind: 'class_moved',
        id: classId,
        evidence: `${classId} mean floor pack-off ${num(off.floor.avg.mean)} → pack-on ${num(on.floor.avg.mean)} (Δ ${num(dFloor)})`,
        cause: 'Pack catalog/loot/events changed survival for this class versus the matched pack-off baseline.',
        bucket: Math.abs(dFloor) >= 8 ? 'confirmed' : 'likely_more_samples',
      });
    }
    if (Math.abs(dF10) >= 0.2) {
      add({
        severity: 'medium',
        kind: 'class_f10',
        id: classId,
        evidence: `${classId} F10 arrival ${pct(off.f10.arrive.rate)} → ${pct(on.f10.arrive.rate)}`,
        cause: 'Pack-on loot or techniques may be masking or amplifying the known F10 gate.',
        bucket: 'likely_more_samples',
      });
    }
  }

  const comboOff = groupBy(baseOff, comboKey);
  const comboOn = groupBy(baseOn, comboKey);
  const comboMeansOn = [];
  for (const key of Object.keys({ ...comboOff, ...comboOn })) {
    const off = summarizeRuns(comboOff[key] || []);
    const on = summarizeRuns(comboOn[key] || []);
    if (on.n) {
      comboMeansOn.push({
        key,
        mean: on.floor.avg.mean,
        stdev: on.floor.avg.stdev,
        n: on.n,
        f10: on.f10.arrive.rate,
        d: off.n ? (on.floor.avg.mean ?? 0) - (off.floor.avg.mean ?? 0) : null,
      });
    }
    if (off.n && on.n) {
      const d = (on.floor.avg.mean ?? 0) - (off.floor.avg.mean ?? 0);
      if (Math.abs(d) >= 5 || (Math.abs(d) >= 3.5 && on.n >= 96)) {
        add({
          severity: Math.abs(d) >= 5 ? 'high' : 'medium',
          kind: 'combo_moved',
          id: key,
          evidence: `${key} mean floor ${num(off.floor.avg.mean)} → ${num(on.floor.avg.mean)} (n=${on.n})`,
          cause: 'Class/bloodline interaction with pack gear, arts, or events.',
          bucket: on.n < 96 ? 'likely_more_samples' : (Math.abs(d) >= 5 ? 'confirmed' : 'likely_more_samples'),
        });
      }
    }
    if (on.n && on.floor.avg.stdev >= 10) {
      add({
        severity: 'low',
        kind: 'high_variance',
        id: key,
        evidence: `${key} floor stdev ${num(on.floor.avg.stdev)} on n=${on.n}`,
        cause: 'Seed-sensitive pathing or rare pack drops dominating outcomes.',
        bucket: 'likely_more_samples',
      });
    }
  }
  if (comboMeansOn.length) {
    const m = mean(comboMeansOn.map(x => x.mean));
    const s = Math.sqrt(comboMeansOn.reduce((a, x) => a + (x.mean - m) ** 2, 0) / Math.max(1, comboMeansOn.length - 1));
    for (const row of comboMeansOn) {
      const z = s ? (row.mean - m) / s : 0;
      if (Math.abs(z) >= 2.2) {
        const packShift = Math.abs(row.d || 0);
        const vanillaRank = packShift < 2.5;
        add({
          severity: z < 0 ? 'high' : 'medium',
          kind: z < 0 ? 'combo_low_survival' : 'combo_high_survival',
          id: row.key,
          evidence: `${row.key} mean floor ${num(row.mean)} (z=${num(z)}) vs pack-on combo mean ${num(m)}; pack Δ ${num(row.d)}`,
          cause: vanillaRank
            ? 'Ranking vs other combos is similar pack-off; this is class/bloodline strength, not a new pack failure.'
            : (z < 0 ? 'Abnormally low survival for this combination versus pack-off.' : 'Abnormally high survival with a material pack-on lift.'),
          bucket: vanillaRank ? 'vanilla' : (row.n < 96 || packShift < 3.5 ? 'likely_more_samples' : 'confirmed'),
        });
      }
    }
  }

  const onAll = baseOn;
  const itemUses = mergeCounts(onAll.map(r => r.skillUses || {}));
  const techPicked = mergeCounts(onAll.map(r => r.tech?.picked || {}));
  const relics = mergeCounts(onAll.map(r => {
    const m = {};
    for (const id of r.final?.relics || []) m[id] = (m[id] || 0) + 1;
    return m;
  }));
  for (const d of dominant(itemUses, 0.25)) {
    add({
      severity: 'medium',
      kind: 'dominant_technique',
      id: d.id,
      evidence: `${d.id} is ${pct(d.share)} of recorded skill uses`,
      cause: 'Autoplay + offer weighting may concentrate on one technique.',
      bucket: String(d.id).startsWith('cp_') ? 'expected_pack_on' : 'vanilla',
    });
  }
  for (const d of dominant(techPicked, 0.4)) {
    add({
      severity: 'low',
      kind: 'dominant_pack_tech_pick',
      id: d.id,
      evidence: `${d.id} is ${pct(d.share)} of pack technique picks`,
      cause: 'skillAutoScore prefers this pack technique when offered.',
      bucket: 'expected_pack_on',
    });
  }
  for (const d of dominant(relics, 0.35)) {
    add({
      severity: 'medium',
      kind: 'dominant_relic',
      id: d.id,
      evidence: `${d.id} appears in ${pct(d.share)} of pack-on finals`,
      cause: 'Relic offer or mutex funnel.',
      bucket: d.id.startsWith('cp_') ? 'likely_more_samples' : 'vanilla',
    });
  }

  const itemActs = {};
  for (const r of onAll) {
    for (const [id, a] of Object.entries(r.items || {})) {
      const row = itemActs[id] || (itemActs[id] = { n: 0, equip: 0, relic: 0 });
      row.n += a.n || 0;
      row.equip += a.equip || 0;
      row.relic += a.relic || 0;
    }
  }
  const itemKeys = Object.keys(itemActs);
  if (!itemKeys.length) {
    add({
      severity: 'low',
      kind: 'item_id_maps',
      id: 'grants',
      evidence: 'Compact per-item offer/equip maps were not in this raw dump; item never/always-equipped rates need the post-instrumentation climb pass.',
      cause: 'Earlier compact rows stored grant counts, not ids.',
      bucket: 'insufficient_mechanics',
    });
  } else {
    const always = [];
    for (const [id, a] of Object.entries(itemActs)) {
      const kind = grantKind(id);
      if (kind === 'consumable' || kind === 'unknown') continue;
      const equipped = (a.equip || 0) + (a.relic || 0);
      if (a.n >= 40 && equipped === 0) {
        add({
          severity: 'medium',
          kind: 'never_equipped',
          id,
          evidence: `${id} offered ${a.n} times, equipped/relic 0`,
          cause: 'Autoplay stashes or sells this slot, or the item is incompatible with sampled classes.',
          bucket: 'likely_more_samples',
        });
      }
      if (a.n >= 20 && equipped / a.n >= 0.98) {
        always.push({ id, equipped, n: a.n, pack: String(id).startsWith('cp_') });
      }
    }
    if (always.length) {
      const packAlways = always.filter(x => x.pack);
      add({
        severity: 'low',
        kind: 'always_equipped_policy',
        id: 'baseline_chooseEquip',
        evidence: `${always.length} gear/relic ids at ≥98% equip rate (${packAlways.length} pack ids). Examples: ${always.slice(0, 8).map(x => x.id).join(', ')}`,
        cause: 'Baseline chooseEquip takes upgrades and relics; this is policy, not a pack-only loop.',
        bucket: 'vanilla',
      });
      for (const x of packAlways.slice(0, 12)) {
        add({
          severity: 'low',
          kind: 'always_equipped',
          id: x.id,
          evidence: `${x.id} equipped ${x.equipped}/${x.n}`,
          cause: 'Pack offer almost always upgrades the current slot under baseline policy.',
          bucket: 'expected_pack_on',
        });
      }
    }
  }

  const uniqueMean = mean(onAll.map(r => r.grants?.unique || 0));
  const wrldMean = mean(onAll.map(r => r.grants?.wrld || 0));
  const legMean = mean(onAll.map(r => r.grants?.legendary || 0));
  if ((uniqueMean || 0) > 0.35) {
    add({
      severity: 'high',
      kind: 'unique_frequency',
      id: 'unique',
      evidence: `Mean Unique grants/run ${num(uniqueMean)}`,
      cause: 'Unique acquisition may be too common for the intended chase rate.',
      bucket: 'confirmed',
    });
  }
  if ((wrldMean || 0) > 0.15) {
    add({
      severity: 'high',
      kind: 'wrld_frequency',
      id: 'wrld',
      evidence: `Mean WRLD grants/run ${num(wrldMean)}`,
      cause: 'WRLD acquisition may be too common.',
      bucket: 'confirmed',
    });
  }
  if ((legMean || 0) > 1.5) {
    add({
      severity: 'medium',
      kind: 'legendary_frequency',
      id: 'legendary',
      evidence: `Mean legendary grants/run ${num(legMean)}`,
      cause: 'Legendary offers may be diluting or overpowering ordinary loot.',
      bucket: 'likely_more_samples',
    });
  }

  const starve = mean(onAll.map(r => r.combat?.mpStarve || 0));
  const overflow = mean(onAll.map(r => r.combat?.mpOverflow || 0));
  if ((starve || 0) > 8) {
    add({
      severity: 'medium',
      kind: 'resource_starvation',
      id: 'mp',
      evidence: `Mean MP-empty combat decisions ${num(starve)}`,
      cause: 'Pack skills may increase spend without matching regen.',
      bucket: 'likely_more_samples',
    });
  }
  if ((overflow || 0) > 20) {
    add({
      severity: 'low',
      kind: 'resource_overflow',
      id: 'mp',
      evidence: `Mean MP-full combat decisions ${num(overflow)}`,
      cause: 'Possible unlimited-resource loop or unused spend.',
      bucket: 'likely_more_samples',
    });
  }

  const goldEarned = mean(onAll.map(r => r.goldEarned || 0));
  const goldSpent = mean(onAll.map(r => r.goldSpent || 0));
  const goldOff = mean(baseOff.map(r => r.goldEarned || 0));
  if (goldEarned && goldOff && goldEarned > goldOff * 1.6) {
    add({
      severity: 'medium',
      kind: 'currency_generation',
      id: 'gold',
      evidence: `Pack-on gold earned ${num(goldEarned)} vs pack-off ${num(goldOff)}`,
      cause: 'Pack gold effects or shop/resale loops.',
      bucket: 'likely_more_samples',
    });
  }

  const healsOn = mean(onAll.map(r => r.shop?.heals || 0));
  const consOn = mean(onAll.map(r => (r.final?.consumables || []).length));
  const healsOff = mean(baseOff.map(r => r.shop?.heals || 0));
  if (consOn != null && healsOff != null && (healsOn || 0) + 0.2 < (healsOff || 0) - 0.4) {
    add({
      severity: 'medium',
      kind: 'heal_dilution',
      id: 'consumables',
      evidence: `Shop heals pack-on ${num(healsOn)} vs pack-off ${num(healsOff)}; bag size ${num(consOn)}`,
      cause: 'Pack consumables may dilute heal potions (shop pool is supposed to exclude pack potions).',
      bucket: 'likely_more_samples',
    });
  }

  const set3 = mean(onAll.map(r => r.sets?.three || 0));
  const set2 = mean(onAll.map(r => r.sets?.two || 0));
  if ((set3 || 0) < 0.02 && (set2 || 0) < 0.08) {
    add({
      severity: 'medium',
      kind: 'sets_incomplete',
      id: 'armor_sets',
      evidence: `Mean 2pc ${num(set2)}, 3pc ${num(set3)} completions per run`,
      cause: 'Class/bloodline sets may be practically impossible to complete on natural climbs.',
      bucket: 'insufficient_mechanics',
    });
  }

  const curseAcc = mean(onAll.map(r => r.curse?.cursedAccepted || 0));
  const curseRes = mean(onAll.map(r => r.curse?.curseResolved || 0));
  if ((curseAcc || 0) > 0.3 && (curseRes || 0) < 0.02) {
    add({
      severity: 'medium',
      kind: 'curse_unresolved',
      id: 'curses',
      evidence: `Curses accepted ${num(curseAcc)} / resolved ${num(curseRes)} per run`,
      cause: 'Drawbacks may be avoidable or resolution events never appear.',
      bucket: 'likely_more_samples',
    });
  }

  const f10Off = summarizeRuns(baseOff).f10;
  const f10On = summarizeRuns(baseOn).f10;
  add({
    severity: 'high',
    kind: 'f10_gate',
    id: 'f10',
    evidence: `F10 arrival pack-off ${pct(f10Off.arrive.rate)} (win|arrive ${pct(f10Off.winGivenArrive.rate)}); pack-on ${pct(f10On.arrive.rate)} (win|arrive ${pct(f10On.winGivenArrive.rate)})`,
    cause: 'Known vanilla F10 difficulty. Do not conceal with pack power. Measured, not retuned.',
    bucket: 'vanilla',
  });

  const echoOn = mean(onAll.map(r => (r.effectOps?.echoAction || 0)));
  if ((echoOn || 0) === 0) {
    add({
      severity: 'low',
      kind: 'under_exercised',
      id: 'echoAction',
      evidence: 'Zero echoAction ops on natural baseline pack-on climbs',
      cause: 'Echo items are rare or autoplay never hits their when: conditions.',
      bucket: 'insufficient_mechanics',
    });
  }

  const mechFail = (mechanics?.rows || []).filter(r => r.failed > 0);
  for (const r of mechFail) {
    add({
      severity: 'high',
      kind: 'mechanic_test_fail',
      id: r.family,
      evidence: `${r.title}: ${r.tests.filter(t => !t.pass).map(t => t.name).join('; ')}`,
      cause: 'Cap/mutex/recursion test failed against the live engine.',
      bucket: 'confirmed',
    });
  }

  const cpBytesOff = mean(baseOff.map(r => r.checkpointBytes || 0));
  const cpBytesOn = mean(baseOn.map(r => r.checkpointBytes || 0));
  if (cpBytesOn && cpBytesOff && cpBytesOn > cpBytesOff * 1.35) {
    add({
      severity: 'medium',
      kind: 'checkpoint_size',
      id: 'packState',
      evidence: `Mean climber JSON ${num(cpBytesOff, 0)} → ${num(cpBytesOn, 0)} bytes`,
      cause: 'Pack state / arts / extra IDs inflate checkpoints.',
      bucket: 'expected_pack_on',
    });
  }

  const msOff = mean(baseOff.map(r => r.ms || 0));
  const msOn = mean(baseOn.map(r => r.ms || 0));
  if (msOn && msOff && msOn > msOff * 1.5) {
    add({
      severity: 'medium',
      kind: 'performance',
      id: 'climb_ms',
      evidence: `Mean climb time ${num(msOff, 0)}ms → ${num(msOn, 0)}ms`,
      cause: 'Pack effect dispatch on every combat hook.',
      bucket: 'expected_pack_on',
    });
  }

  if (party && party.harness && !party.harness.fullMultiplayerClimb) {
    add({
      severity: 'low',
      kind: 'mp_harness',
      id: 'multiplayer',
      evidence: 'No full multiplayer climb harness exists. Party results are TDC pads + focused fights.',
      cause: 'Scope limit of climb_v2.',
      bucket: 'insufficient_mechanics',
    });
  }

  if (baselineTests && baselineTests.fail > 0) {
    const goldensOk = baselineTests.goldensPassed !== false;
    add({
      severity: goldensOk ? 'medium' : 'high',
      kind: 'test_suite',
      id: 'tools/test.js',
      evidence: baselineTests.note || `${baselineTests.fail} test(s) failed (${baselineTests.pass} passed)`,
      cause: goldensOk
        ? 'A working-tree test failed; characterization goldens still passed.'
        : 'Measurement tooling or working-tree schema must not break pack-off goldens.',
      bucket: goldensOk ? 'vanilla' : 'confirmed',
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  list.sort((a, b) => (order[a.severity] - order[b.severity]) || a.kind.localeCompare(b.kind));
  return list;
}

export function buildReportDoc(report) {
  const { meta, catalog, baselineTests, climbs, summaries, anomalies, mechanics, party, followUp } = report;
  const off = summaries.packOffBaseline;
  const on = summaries.packOnBaseline;
  const lines = [];
  lines.push('# Gate 7 content pack — balance measurement');
  lines.push('');
  lines.push('Measurement only. No classes, enemies, bosses, events, items, skills, shops, drop rates, or acquisition rules were changed for this report.');
  lines.push('');
  lines.push('## Scope and evidence');
  lines.push('');
  lines.push(`- Starting commit: \`${meta.startingCommit}\``);
  lines.push(`- Working tree HEAD: \`${meta.workingTree.sha}\``);
  lines.push(`- Dirty paths: ${meta.workingTree.dirty.length ? meta.workingTree.dirty.map(s => `\`${s}\``).join(', ') : '(clean)'}`);
  lines.push(`- Seed bank: \`${meta.seedBank.id}\` base \`${meta.seedBank.baseSeed}\` formula \`${meta.seedBank.formula}\``);
  lines.push('- Pack-on: explicit `setPackEnabled(true)` + `setPackGate(GATE.MULTIPLAYER)` (Gate 7).');
  lines.push('- Pack-off: explicit `setPackEnabled(false)`.');
  lines.push('- Authoritative climb: `tools/run_climb_v2.js` + `js/combat_core.js`. Not `combat_sim`, `run_sim`, or `TDC.clearRate`.');
  lines.push('- Characterization goldens were not regenerated.');
  lines.push(`- Baseline \`node tools/test.js\`: ${baselineTests?.pass} passed, ${baselineTests?.fail} failed.${baselineTests?.note ? ` ${baselineTests.note}` : ''}`);
  lines.push(`- Climbs: ${report.climbCount ?? '—'} (${report.errors ?? 0} errors). Solo structure is ${meta.lastFloor || 51} floors.`);
  lines.push('');
  if (catalog && catalog.packId) {
    lines.push('## Catalog at measurement time');
    lines.push('');
    lines.push(`Pack \`${catalog.packId}\` schema ${catalog.schema}. Pack-on gate ${catalog.flags.gate}. Counts: ${catalog.counts.items} items, ${catalog.counts.relics} relics, ${catalog.counts.consumables} consumables, ${catalog.counts.skills} skills, ${catalog.counts.events} events, ${catalog.counts.sets} sets, ${catalog.counts.ordinaryLoot} ordinary-loot items.`);
    lines.push('');
    lines.push(mdTable(
      ['Bucket', 'C', 'U', 'R', 'E', 'L', 'Unique', 'WRLD'],
      ['equipment', 'ordinaryLoot', 'relics', 'consumables'].map(k => {
        const r = catalog.rarity[k];
        const c = r?.counts || {};
        return [k, c.common || 0, c.uncommon || 0, c.rare || 0, c.epic || 0, c.legendary || 0, r?.unique || 0, r?.wrld || 0];
      }),
    ));
    lines.push('');
  }
  lines.push('## Pack-off vs pack-on (baseline policy, matched seeds)');
  lines.push('');
  if (off && on) {
    lines.push(mdTable(
      ['Metric', 'Pack-off', 'Pack-on'],
      [
        ['n', off.n, on.n],
        ['Mean floor (95% CI)', `${num(off.floor.avg.mean)} [${num(off.floor.avg.lo)}, ${num(off.floor.avg.hi)}]`, `${num(on.floor.avg.mean)} [${num(on.floor.avg.lo)}, ${num(on.floor.avg.hi)}]`],
        ['Median floor', num(off.floor.median, 1), num(on.floor.median, 1)],
        ['Win rate', pct(off.winRate.rate), pct(on.winRate.rate)],
        ['F10 arrival', `${pct(off.f10.arrive.rate)} [${pct(off.f10.arrive.lo)}, ${pct(off.f10.arrive.hi)}]`, `${pct(on.f10.arrive.rate)} [${pct(on.f10.arrive.lo)}, ${pct(on.f10.arrive.hi)}]`],
        ['F10 win | arrival', pct(off.f10.winGivenArrive.rate), pct(on.f10.winGivenArrive.rate)],
        ['Mean gold earned / spent / retained', `${num(off.gold.earned, 1)} / ${num(off.gold.spent, 1)} / ${num(off.gold.retained, 1)}`, `${num(on.gold.earned, 1)} / ${num(on.gold.spent, 1)} / ${num(on.gold.retained, 1)}`],
        ['Mean Fame', num(off.fame, 2), num(on.fame, 2)],
        ['Mean Unique / WRLD / legendary grants', `${num(off.unique, 3)} / ${num(off.wrld, 3)} / ${num(off.legendary, 3)}`, `${num(on.unique, 3)} / ${num(on.wrld, 3)} / ${num(on.legendary, 3)}`],
        ['Mean climb ms', num(off.ms, 0), num(on.ms, 0)],
        ['Mean checkpoint bytes', num(off.checkpointBytes, 0), num(on.checkpointBytes, 0)],
        ['Mean dmg dealt / taken', `${num(off.combat?.damageDealt, 1)} / ${num(off.combat?.damageTaken, 1)}`, `${num(on.combat?.damageDealt, 1)} / ${num(on.combat?.damageTaken, 1)}`],
        ['Mean healed / lifesteal / shields', `${num(off.combat?.healed, 1)} / ${num(off.combat?.lifesteal, 2)} / ${num(off.combat?.shields, 2)}`, `${num(on.combat?.healed, 1)} / ${num(on.combat?.lifesteal, 2)} / ${num(on.combat?.shields, 2)}`],
        ['Mean revives / deathwards / pack wards', `${num(off.combat?.revives, 3)} / ${num(off.combat?.deathwards, 3)} / ${num(off.combat?.packWards, 3)}`, `${num(on.combat?.revives, 3)} / ${num(on.combat?.deathwards, 3)} / ${num(on.combat?.packWards, 3)}`],
        ['Mean MP-starve / overflow', `${num(off.combat?.mpStarve, 2)} / ${num(off.combat?.mpOverflow, 2)}`, `${num(on.combat?.mpStarve, 2)} / ${num(on.combat?.mpOverflow, 2)}`],
        ['Mean CD blocked / CD-active ticks', `${num(off.combat?.cdBlocked, 2)} / ${num(off.combat?.cdActive, 2)}`, `${num(on.combat?.cdBlocked, 2)} / ${num(on.combat?.cdActive, 2)}`],
        ['Mean shop visits / buys / skip / unaffordable', `${num(off.shop.visits, 2)} / ${num(off.shop.purchases, 2)} / ${num(off.shop.skipped, 2)} / ${num(off.shop.unaffordable, 2)}`, `${num(on.shop.visits, 2)} / ${num(on.shop.purchases, 2)} / ${num(on.shop.skipped, 2)} / ${num(on.shop.unaffordable, 2)}`],
        ['Mean shop heals / restocks', `${num(off.shop.heals, 2)} / ${num(off.shop.restocks, 2)}`, `${num(on.shop.heals, 2)} / ${num(on.shop.restocks, 2)}`],
        ['Mean curse offered / accept / resolve', `${num(off.curse.offered, 3)} / ${num(off.curse.accepted, 3)} / ${num(off.curse.resolved, 3)}`, `${num(on.curse.offered, 3)} / ${num(on.curse.accepted, 3)} / ${num(on.curse.resolved, 3)}`],
        ['Mean evolving offered / progress keys', `${num(off.evolving?.offered, 3)} / ${num(off.evolving?.progress, 3)}`, `${num(on.evolving?.offered, 3)} / ${num(on.evolving?.progress, 3)}`],
        ['Mean set 2pc / 3pc', `${num(off.sets.two, 3)} / ${num(off.sets.three, 3)}`, `${num(on.sets.two, 3)} / ${num(on.sets.three, 3)}`],
        ['Useful vs incompatible weapon offers', `${num(off.equipment.usefulWeapon, 2)} / ${num(off.equipment.incompatibleWeapon, 2)}`, `${num(on.equipment.usefulWeapon, 2)} / ${num(on.equipment.incompatibleWeapon, 2)}`],
        ['Boss-enter HP% / MP% / gold / heal pots', `${num(off.bossEnterHpPct?.mean)} / ${num(off.bossEnterMpPct?.mean)} / ${num(off.bossEnterGold, 1)} / ${num(off.bossEnterHealConsumables, 2)}`, `${num(on.bossEnterHpPct?.mean)} / ${num(on.bossEnterMpPct?.mean)} / ${num(on.bossEnterGold, 1)} / ${num(on.bossEnterHealConsumables, 2)}`],
        ['Mean event threads tracked / resolved', `${num(off.threads?.tracked, 2)} / ${num(off.threads?.resolved, 2)}`, `${num(on.threads?.tracked, 2)} / ${num(on.threads?.resolved, 2)}`],
      ],
    ));
  }
  lines.push('');
  lines.push('Death-floor histogram (baseline):');
  lines.push('');
  const distKeys = [...new Set([
    ...Object.keys(off?.deathFloor?.dist || {}),
    ...Object.keys(on?.deathFloor?.dist || {}),
  ])].sort((a, b) => Number(a) - Number(b));
  if (distKeys.length) {
    lines.push(mdTable(
      ['Death floor', 'Pack-off n', 'Pack-on n'],
      distKeys.map(k => [k, off?.deathFloor?.dist?.[k] || 0, on?.deathFloor?.dist?.[k] || 0]),
    ));
  }
  lines.push('');
  lines.push('## Class tables (baseline, pack-off vs pack-on)');
  lines.push('');
  lines.push(mdTable(
    ['Class', 'Off n', 'Off mean floor', 'On mean floor', 'Δ floor', 'Off F10 arr', 'On F10 arr', 'Off F10 win|arr', 'On F10 win|arr'],
    CANONICAL_CLASSES.map(id => {
      const a = summaries.byClass?.[id]?.off;
      const b = summaries.byClass?.[id]?.on;
      return [
        id, a?.n ?? 0, num(a?.floor.avg.mean), num(b?.floor.avg.mean),
        num((b?.floor.avg.mean ?? 0) - (a?.floor.avg.mean ?? 0)),
        pct(a?.f10.arrive.rate), pct(b?.f10.arrive.rate),
        pct(a?.f10.winGivenArrive.rate), pct(b?.f10.winGivenArrive.rate),
      ];
    }),
  ));
  lines.push('');
  lines.push('## Bloodline tables (baseline, all classes pooled)');
  lines.push('');
  lines.push(mdTable(
    ['Bloodline', 'Off mean floor', 'On mean floor', 'Δ', 'On F10 arr', 'On Unique/run'],
    CANONICAL_BLOODLINES.map(id => {
      const a = summaries.byBloodline?.[id]?.off;
      const b = summaries.byBloodline?.[id]?.on;
      return [
        id, num(a?.floor.avg.mean), num(b?.floor.avg.mean),
        num((b?.floor.avg.mean ?? 0) - (a?.floor.avg.mean ?? 0)),
        pct(b?.f10.arrive.rate), num(b?.unique, 3),
      ];
    }),
  ));
  lines.push('');
  lines.push('## Class × bloodline (baseline, all 88 combinations)');
  lines.push('');
  lines.push('n is per pack state. Expansion combos have n=96; others n=24. Identical seeds pack-off vs pack-on.');
  lines.push('');
  lines.push(mdTable(
    ['Combo', 'Off n', 'On n', 'Off mean', 'On mean', 'Δ', 'Off F10 arr', 'On F10 arr', 'On F10 win|arr', 'On stdev'],
    CANONICAL_CLASSES.flatMap(classId => CANONICAL_BLOODLINES.map(raceId => {
      const key = `${classId}/${raceId}`;
      const a = summaries.byCombo?.[key]?.off;
      const b = summaries.byCombo?.[key]?.on;
      return [
        key, a?.n ?? 0, b?.n ?? 0,
        num(a?.floor.avg.mean), num(b?.floor.avg.mean),
        num((b?.floor.avg.mean ?? 0) - (a?.floor.avg.mean ?? 0)),
        pct(a?.f10.arrive.rate), pct(b?.f10.arrive.rate),
        pct(b?.f10.winGivenArrive.rate), num(b?.floor.avg.stdev),
      ];
    })),
  ));
  lines.push('');
  lines.push('## Boss-aware policy (matched seeds, every class on human + flagged combos)');
  lines.push('');
  const bo = summaries.bossAwareOff;
  const bn = summaries.bossAwareOn;
  if (bo && bn) {
    lines.push(mdTable(
      ['Metric', 'Pack-off', 'Pack-on'],
      [
        ['n', bo.n, bn.n],
        ['Mean floor (95% CI)', `${num(bo.floor.avg.mean)} [${num(bo.floor.avg.lo)}, ${num(bo.floor.avg.hi)}]`, `${num(bn.floor.avg.mean)} [${num(bn.floor.avg.lo)}, ${num(bn.floor.avg.hi)}]`],
        ['Median floor', num(bo.floor.median, 1), num(bn.floor.median, 1)],
        ['F10 arrival', pct(bo.f10.arrive.rate), pct(bn.f10.arrive.rate)],
        ['F10 win | arrival', pct(bo.f10.winGivenArrive.rate), pct(bn.f10.winGivenArrive.rate)],
        ['Win rate', pct(bo.winRate.rate), pct(bn.winRate.rate)],
      ],
    ));
  }
  if (summaries.bossAwareByClass) {
    lines.push('');
    lines.push(mdTable(
      ['Class (human + flagged)', 'Off mean', 'On mean', 'Δ', 'On F10 arr'],
      CANONICAL_CLASSES.map(id => {
        const a = summaries.bossAwareByClass[id]?.off;
        const b = summaries.bossAwareByClass[id]?.on;
        return [id, num(a?.floor.avg.mean), num(b?.floor.avg.mean), num((b?.floor.avg.mean ?? 0) - (a?.floor.avg.mean ?? 0)), pct(b?.f10.arrive.rate)];
      }),
    ));
  }
  lines.push('');
  lines.push('## Boss arrival / victory (baseline)');
  lines.push('');
  const bossOnRows = Object.entries(on?.bosses || {}).sort((a, b) => b[1].arrive - a[1].arrive);
  const bossOffRows = Object.entries(off?.bosses || {}).sort((a, b) => b[1].arrive - a[1].arrive);
  const bossIds = [...new Set([...bossOffRows.map(([id]) => id), ...bossOnRows.map(([id]) => id)])];
  if (bossIds.length) {
    const offB = Object.fromEntries(bossOffRows);
    const onB = Object.fromEntries(bossOnRows);
    lines.push(mdTable(
      ['Boss', 'Off arrive', 'Off win|arr', 'On arrive', 'On win|arr'],
      bossIds.map(id => {
        const a = offB[id] || { arrive: 0, win: 0 };
        const b = onB[id] || { arrive: 0, win: 0 };
        return [
          id, a.arrive, pct(a.arrive ? a.win / a.arrive : null),
          b.arrive, pct(b.arrive ? b.win / b.arrive : null),
        ];
      }),
    ));
  } else {
    lines.push('No boss arrivals recorded in the baseline sample.');
  }
  lines.push('');
  lines.push('## Rarity by channel and floor band (baseline)');
  lines.push('');
  const extOn = report.extended?.packOn;
  const extOff = report.extended?.packOff;
  const channels = [...new Set([
    ...Object.keys(extOff?.rarityByChannel || {}),
    ...Object.keys(extOn?.rarityByChannel || {}),
  ])].sort();
  if (channels.length) {
    lines.push(mdTable(
      ['Channel', 'Off C/U/R/E/L/Unique/WRLD', 'On C/U/R/E/L/Unique/WRLD'],
      channels.map(ch => {
        const fmt = (m) => {
          const c = m?.[ch] || {};
          return [c.common || 0, c.uncommon || 0, c.rare || 0, c.epic || 0, c.legendary || 0, c.unique || 0, c.wrld || 0].join('/');
        };
        return [ch, fmt(extOff?.rarityByChannel), fmt(extOn?.rarityByChannel)];
      }),
    ));
  }
  const bands = [...new Set([
    ...Object.keys(extOff?.rarityByBand || {}),
    ...Object.keys(extOn?.rarityByBand || {}),
  ])].sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  if (bands.length) {
    lines.push('');
    lines.push(mdTable(
      ['Floor band', 'Off C/U/R/E/L', 'On C/U/R/E/L'],
      bands.map(band => {
        const fmt = (m) => {
          const c = m?.[band] || {};
          return [c.common || 0, c.uncommon || 0, c.rare || 0, c.epic || 0, c.legendary || 0].join('/');
        };
        return [band, fmt(extOff?.rarityByBand), fmt(extOn?.rarityByBand)];
      }),
    ));
  }
  lines.push('');
  lines.push('## Item / equipment usage (pack-on baseline)');
  lines.push('');
  if (extOn?.items?.length) {
    lines.push(mdTable(
      ['Item', 'Offered', 'Equipped', 'Sold', 'Stash', 'Equip rate', 'Useful', 'Incompatible'],
      extOn.items.slice(0, 30).map(x => [
        x.id, x.offered, x.equipped, x.sold, x.stashed, pct(x.equipRate), x.useful, x.incompatible,
      ]),
    ));
    if (extOn.neverEquipped?.length) {
      lines.push('');
      lines.push(`Never equipped when offered (≥24 offers): ${extOn.neverEquipped.map(x => `\`${x.id}\``).join(', ') || '_none_'}`);
    }
    if (extOn.alwaysEquipped?.length) {
      lines.push('');
      lines.push(`Almost always equipped (≥16 offers, ≥95%): ${extOn.alwaysEquipped.map(x => `\`${x.id}\``).join(', ') || '_none_'}`);
    }
  } else {
    lines.push('Per-item offer/equip maps are not in this raw dump. Re-run the climb matrix after compact grant-id instrumentation to fill never/always-equipped tables. Grant *counts* (useful vs incompatible, equip vs sell) are in the pack-off vs pack-on table.');
  }
  lines.push('');
  lines.push('## Technique, art, consumable, and shop usage (pack-on baseline)');
  lines.push('');
  lines.push('Skill uses:');
  lines.push(usageTable(extOn?.skillUses));
  lines.push('');
  lines.push('Class technique offers:');
  lines.push(usageTable(extOn?.techOffered));
  lines.push('');
  lines.push('Class technique picks:');
  lines.push(usageTable(extOn?.techPicked));
  lines.push('');
  lines.push('Bloodline art offers:');
  lines.push(usageTable(extOn?.artOffered));
  lines.push('');
  lines.push('Bloodline art picks:');
  lines.push(usageTable(extOn?.artPicked));
  lines.push('');
  lines.push('Consumable uses:');
  lines.push(usageTable(extOn?.consumableUses));
  lines.push('');
  lines.push('Shop buys:');
  lines.push(usageTable(extOn?.shopBuys));
  lines.push('');
  lines.push('## Events and threads (pack-on baseline)');
  lines.push('');
  lines.push(usageTable(extOn?.events, 24));
  lines.push('');
  lines.push('Repeated events:');
  lines.push(usageTable(extOn?.repeatedEvents));
  lines.push('');
  lines.push('## Winning-build concentration (baseline)');
  lines.push('');
  const winsOn = extOn?.winning;
  const winsOff = extOff?.winning;
  lines.push(`Pack-off wins ${winsOff?.n ?? 0}; pack-on wins ${winsOn?.n ?? 0}. Full 51-floor clears remain rare; treat concentration on n<30 as descriptive, not a meta proof.`);
  lines.push('');
  if (winsOn?.list?.length || winsOff?.list?.length) {
    lines.push(mdTable(
      ['Pack', 'Class', 'Bloodline', 'Seed', 'Floor', 'Weapon', 'Skills', 'Relics'],
      [
        ...(winsOff?.list || []).map(w => ['off', w.classId, w.raceId, w.seed, w.maxFloor, w.weapon, (w.skills || []).join(','), (w.relics || []).join(',')]),
        ...(winsOn?.list || []).map(w => ['on', w.classId, w.raceId, w.seed, w.maxFloor, w.weapon, (w.skills || []).join(','), (w.relics || []).join(',')]),
      ],
    ));
    if (winsOn?.concentration?.length) {
      lines.push('');
      lines.push('Pack-on duplicate keys:');
      for (const c of winsOn.concentration.slice(0, 8)) {
        lines.push(`- ${c.n} (${pct(c.share)}): \`${c.key}\``);
      }
    }
  }
  lines.push('');
  lines.push('## Item / effect-family usage (pack-on baseline)');
  lines.push('');
  lines.push(mdTable(
    ['Family', 'Mean ops / run (pack-on)'],
    Object.entries(summaries.effectOpsOn || {}).sort((a, b) => b[1] - a[1]).slice(0, 24).map(([k, v]) => [k, num(v, 3)]),
  ));
  if (extOn?.effectCaps?.length) {
    lines.push('');
    lines.push('Capped ops (pack-on):');
    lines.push(usageTable(extOn.effectCaps, 12));
  }
  lines.push('');
  lines.push('## Ranked anomalies');
  lines.push('');
  const buckets = {
    confirmed: 'Confirmed balance failures',
    likely_more_samples: 'Likely problems requiring more samples',
    expected_pack_on: 'Expected pack-on differences',
    insufficient_mechanics: 'Insufficiently exercised mechanics',
    vanilla: 'Existing vanilla problems unrelated to the overhaul',
  };
  for (const [key, title] of Object.entries(buckets)) {
    const rows = anomalies.filter(a => a.bucket === key);
    lines.push(`### ${title}`);
    lines.push('');
    if (!rows.length) {
      lines.push('_None in this bucket._');
      lines.push('');
      continue;
    }
    for (const a of rows) {
      lines.push(`- **${a.severity}** \`${a.kind}\` / \`${a.id}\`: ${a.evidence} — ${a.cause}`);
    }
    lines.push('');
  }
  lines.push('## Focused mechanic tests');
  lines.push('');
  lines.push(`Engine battery: ${mechanics?.passed ?? 0} passed, ${mechanics?.failed ?? 0} failed. Families: ${(mechanics?.familiesCovered || []).join(', ')}.`);
  lines.push('');
  const covered = new Set(mechanics?.familiesCovered || []);
  lines.push(mdTable(
    ['Required family', 'Covered in battery', 'Notes'],
    REQUIRED_FAMILIES.map(([id, title]) => [
      title,
      covered.has(id) ? 'yes' : 'NO',
      (mechanics?.rows || []).filter(r => r.family === id).map(r => r.combo).filter(Boolean).join(', ') || '—',
    ]),
  ));
  lines.push('');
  const combos = { solo: 0, pair: 0, triple: 0 };
  for (const r of mechanics?.rows || []) {
    if (r.combo === 'pair') combos.pair += 1;
    else if (r.combo === 'triple') combos.triple += 1;
    else combos.solo += 1;
  }
  lines.push(`Battery rows: ${combos.solo} solo, ${combos.pair} pairwise, ${combos.triple} three-/four-way.`);
  lines.push('');
  if (mechanics?.insufficientOnNaturalClimbs?.length) {
    lines.push('Natural climbs will not exercise every rare mechanic. Focused grants covered those families. Remaining caveats:');
    for (const n of mechanics.insufficientOnNaturalClimbs) lines.push(`- ${n}`);
    lines.push('');
  }
  lines.push('## Multiplayer');
  lines.push('');
  lines.push(party?.harness?.note || 'No party harness note.');
  lines.push('');
  lines.push('These are not full multiplayer climbs. Climb V2 is solo.');
  lines.push('');
  if (party?.scaling) {
    lines.push(mdTable(
      ['n', 'budget F10', 'boss ATK F10', 'boss HP F10', 'trash ATK F10', 'AOE share'],
      party.scaling.map(s => [s.partySize, num(s.budgetF10, 2), num(s.bossAtkF10, 2), num(s.bossHpF10, 2), num(s.trashAtkF10, 2), num(s.aoe, 3)]),
    ));
    lines.push('');
  }
  if (party?.focusedCombat?.length) {
    lines.push('Focused 2/3/4-player trash fights:');
    lines.push(mdTable(
      ['P', 'Floor', 'Pack', 'Bodies', 'Outcome', 'Rounds', 'Dmg taken', 'Gold'],
      party.focusedCombat.map(f => [f.partySize, f.floor, f.packOn ? 'on' : 'off', f.bodies, f.outcome, f.rounds, f.damageTaken, f.gold]),
    ));
    lines.push('');
  }
  if (party?.focusedBosses?.length) {
    lines.push('Focused 2/3/4-player F10 bosses:');
    lines.push(mdTable(
      ['P', 'Pack', 'Boss', 'Bodies', 'Outcome', 'Rounds', 'Boss HP', 'Dmg taken'],
      party.focusedBosses.map(f => [f.partySize, f.packOn ? 'on' : 'off', f.bossId, f.bodies, f.outcome, f.rounds, f.bossHp, f.damageTaken]),
    ));
    lines.push('');
  }
  if (party?.focusedEconomy?.length) {
    lines.push('Focused shop/economy (stock is not party-scaled):');
    lines.push(mdTable(
      ['P', 'Floor', 'Pack', 'Listings', 'Unaffordable', 'Mean price', 'Gold'],
      party.focusedEconomy.map(f => [f.partySize, f.floor, f.packOn ? 'on' : 'off', f.listings, f.unaffordable, num(f.meanPrice, 1), f.gold]),
    ));
    lines.push('');
  }
  lines.push('## Proposed follow-up (not implemented)');
  lines.push('');
  for (const step of followUp || []) lines.push(`- ${step}`);
  lines.push('');
  lines.push('## Raw artifacts');
  lines.push('');
  lines.push('- `reports/content_pack_balance_measurement.json`');
  lines.push('- `reports/content_pack_balance_raw.ndjson`');
  lines.push('- `reports/content_pack_balance_seed_bank.json`');
  lines.push('- `reports/content_pack_balance_seed_bank.md`');
  lines.push('');
  return lines.join('\n');
}

export function buildSeedBankDoc(dump) {
  const lines = [];
  lines.push('# Content-pack balance seed bank');
  lines.push('');
  lines.push(`- Id: \`${dump.id}\``);
  lines.push(`- Starting commit: \`${dump.startingCommit}\``);
  lines.push(`- Base seed: \`${dump.baseSeed}\``);
  lines.push(`- Formula: \`${dump.formula}\``);
  lines.push(`- Initial n: ${dump.initialN || 24} per class×bloodline`);
  lines.push(`- Expansion n: ${dump.expansionN || 96} (same sequence, indices 0–95)`);
  lines.push(`- Identical seeds across pack-off and pack-on: ${dump.identicalAcrossPackStates !== false}`);
  lines.push('');
  lines.push('Classes: ' + (dump.classes || []).join(', '));
  lines.push('');
  lines.push('Bloodlines: ' + (dump.bloodlines || []).join(', '));
  lines.push('');
  lines.push('First seed per class (human, index 0) is in the JSON dump. Do not regenerate this bank if later rarity work needs a matched comparison.');
  lines.push('');
  return lines.join('\n');
}

export function writeOutputs(dir, report, rawLines, seedBankDump) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'content_pack_balance_measurement.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(dir, 'content_pack_balance_measurement.md'), buildReportDoc(report));
  if (rawLines) {
    writeFileSync(join(dir, 'content_pack_balance_raw.ndjson'), rawLines.join('\n') + (rawLines.length ? '\n' : ''));
  }
  writeFileSync(join(dir, 'content_pack_balance_seed_bank.json'), JSON.stringify(seedBankDump, null, 2));
  writeFileSync(join(dir, 'content_pack_balance_seed_bank.md'), buildSeedBankDoc(seedBankDump));
}
