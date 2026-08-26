# Gate 7 content pack — balance measurement

Measurement only. No classes, enemies, bosses, events, items, skills, shops, drop rates, or acquisition rules were changed for this report.

## Scope and evidence

- Starting commit: `cf607bcd3c941c7840fad42da5ed6253bbcc7d85`
- Working tree HEAD: `cf607bcd3c941c7840fad42da5ed6253bbcc7d85`
- Dirty paths: `M css/main.css`, ` M js/art.js`, ` M js/character.js`, ` M js/combat_core.js`, ` M js/compendium.js`, ` M js/content_pack/acquisition.js`, ` M js/content_pack/catalogs/armor.js`, ` M js/content_pack/catalogs/consumables.js`, ` M js/content_pack/catalogs/events_biomes.js`, ` M js/content_pack/catalogs/events_chains.js`, ` M js/content_pack/catalogs/events_class_coop.js`, ` M js/content_pack/catalogs/events_late.js`, ` M js/content_pack/catalogs/events_more.js`, ` M js/content_pack/catalogs/events_rest.js`, ` M js/content_pack/catalogs/helpers.js`, ` M js/content_pack/catalogs/relics.js`, ` M js/content_pack/catalogs/weapons.js`, ` M js/content_pack/catalogs/weapons_more.js`, ` M js/content_pack/combat_bind.js`, ` M js/content_pack/curse.js`, ` M js/content_pack/engine.js`, ` M js/content_pack/grants.js`, ` M js/content_pack/schema.js`, ` M js/data/items.js`, ` M js/data/world.js`, ` M js/game.js`, ` M js/outcomes.js`, ` M js/progression.js`, ` M js/requirements.js`, ` M js/rewards.js`, ` M js/shop.js`, ` M reports/content_pack_balance_packoff_vs_packon_20260825.json`, ` M reports/content_pack_status_20260825.json`, ` M tools/combat_headless.js`, ` M tools/policies/baseline.js`, ` M tools/run_climb_v2.js`, ` M tools/test.js`, ` M tools/test_content_pack.js`, `?? js/content_pack/path_graph.js`, `?? js/content_pack/path_pursuit.js`, `?? js/content_pack/rarity.js`, `?? reports/content_pack_balance_measurement.json`, `?? reports/content_pack_balance_measurement.md`, `?? reports/content_pack_balance_raw.ndjson`, `?? reports/content_pack_balance_seed_bank.json`, `?? reports/content_pack_balance_seed_bank.md`, `?? reports/content_pack_rarity_audit_20260825.json`, `?? reports/content_pack_rarity_summary_20260825.json`, `?? reports/content_path_acquisition_graph.json`, `?? reports/content_path_audit.json`, `?? reports/content_path_audit.md`, `?? reports/content_path_compendium_discovery.json`, `?? reports/content_path_curse_resolution.json`, `?? reports/content_path_event_chains.json`, `?? reports/content_path_evolution.json`, `?? reports/content_path_fixes.json`, `?? reports/content_path_impossible_requirements.json`, `?? reports/content_path_multiplayer_ownership.json`, `?? reports/content_path_orphaned.json`, `?? reports/content_path_set_completion.json`, `?? reports/content_path_unique_wrld.json`, `?? tools/audit_rarity.js`, `?? tools/content_pack_balance_lib.js`, `?? tools/content_pack_balance_mechanics.js`, `?? tools/content_pack_balance_party.js`, `?? tools/content_pack_balance_report.js`, `?? tools/content_pack_balance_tables.js`, `?? tools/content_pack_balance_worker.js`, `?? tools/content_path_audit.js`, `?? tools/run_content_pack_balance.js`, `?? tools/test_content_pack_balance.js`, `?? tools/test_content_path.js`
- Seed bank: `cp-balance-g7-20260825` base `202608251` formula `mix32(baseSeed, classIndex, bloodlineIndex, seedIndex) >>> 0`
- Pack-on: explicit `setPackEnabled(true)` + `setPackGate(GATE.MULTIPLAYER)` (Gate 7).
- Pack-off: explicit `setPackEnabled(false)`.
- Authoritative climb: `tools/run_climb_v2.js` + `js/combat_core.js`. Not `combat_sim`, `run_sim`, or `TDC.clearRate`.
- Characterization goldens were not regenerated.
- Baseline `node tools/test.js`: 4871 passed, 0 failed. Post-tooling node tools/test.js: 4871 passed, 0 failed. Combat-core characterization goldens ran and were not regenerated. TDC.clearRate is in the suite only; it was not used as pack-balance evidence.
- Climbs: 8544 (0 errors). Solo structure is 51 floors.

## Catalog at measurement time

Pack `design_council_2026` schema 2. Pack-on gate 7. Counts: 218 items, 37 relics, 64 consumables, 82 skills, 142 events, 19 sets, 11 ordinary-loot items.

| Bucket | C | U | R | E | L | Unique | WRLD |
| --- | --- | --- | --- | --- | --- | --- | --- |
| equipment | 16 | 76 | 63 | 50 | 10 | 3 | 0 |
| ordinaryLoot | 10 | 1 | 0 | 0 | 0 | 0 | 0 |
| relics | 4 | 10 | 12 | 6 | 2 | 2 | 1 |
| consumables | 22 | 22 | 11 | 6 | 3 | 0 | 0 |

## Pack-off vs pack-on (baseline policy, matched seeds)

| Metric | Pack-off | Pack-on |
| --- | --- | --- |
| n | 3552 | 3552 |
| Mean floor (95% CI) | 12.76 [12.52, 12.99] | 12.70 [12.43, 12.97] |
| Median floor | 10.0 | 10.0 |
| Win rate | 0.2% | 0.4% |
| F10 arrival | 79.8% [78.5%, 81.1%] | 76.3% [74.9%, 77.7%] |
| F10 win | arrival | 44.3% | 40.3% |
| Mean gold earned / spent / retained | 243.7 / 84.7 / 188.9 | 246.4 / 85.0 / 191.4 |
| Mean Fame | 18.84 | 18.05 |
| Mean Unique / WRLD / legendary grants | 0.057 / 0.000 / 0.024 | 0.070 / 0.000 / 0.028 |
| Mean climb ms | 43 | 98 |
| Mean checkpoint bytes | 4965 | 5164 |
| Mean dmg dealt / taken | 445.3 / 233.5 | 451.5 / 223.0 |
| Mean healed / lifesteal / shields | 5.1 / 5.03 / 0.16 | 4.3 / 4.25 / 0.14 |
| Mean revives / deathwards / pack wards | 0.001 / 0.006 / 0.000 | 0.002 / 0.003 / 0.000 |
| Mean MP-starve / overflow | 0.06 / 5.77 | 0.06 / 6.07 |
| Mean CD blocked / CD-active ticks | 0.00 / 0.00 | 0.00 / 0.00 |
| Mean shop visits / buys / skip / unaffordable | 0.43 / 0.62 / 0.07 / 0.94 | 0.35 / 0.44 / 0.08 / 0.83 |
| Mean shop heals / restocks | 0.10 / 0.02 | 0.08 / 0.01 |
| Mean curse offered / accept / resolve | 0.000 / 0.000 / 0.000 | 0.008 / 0.008 / 0.000 |
| Mean evolving offered / progress keys | 0.000 / 0.000 | 0.000 / 0.000 |
| Mean set 2pc / 3pc | 0.000 / 0.000 | 0.010 / 0.000 |
| Useful vs incompatible weapon offers | 0.71 / 0.15 | 0.64 / 0.23 |
| Boss-enter HP% / MP% / gold / heal pots | 0.76 / 0.73 / 192.8 / 2.31 | 0.76 / 0.73 / 205.6 / 2.09 |
| Mean event threads tracked / resolved | 0.68 / 0.01 | 0.53 / 0.01 |

Death-floor histogram (baseline):

| Death floor | Pack-off n | Pack-on n |
| --- | --- | --- |
| 2 | 7 | 12 |
| 3 | 20 | 18 |
| 4 | 34 | 36 |
| 5 | 320 | 419 |
| 6 | 103 | 127 |
| 7 | 113 | 104 |
| 8 | 120 | 127 |
| 10 | 1580 | 1617 |
| 11 | 11 | 16 |
| 12 | 9 | 10 |
| 13 | 14 | 8 |
| 15 | 449 | 319 |
| 16 | 6 | 8 |
| 17 | 5 | 9 |
| 18 | 14 | 10 |
| 20 | 526 | 417 |
| 21 | 1 | 2 |
| 22 | 3 | 3 |
| 23 | 3 | 3 |
| 24 | 2 | 4 |
| 25 | 25 | 27 |
| 26 | 1 | 6 |
| 27 | 2 | 4 |
| 28 | 2 | 4 |
| 30 | 116 | 123 |
| 31 | 0 | 1 |
| 33 | 0 | 1 |
| 34 | 1 | 1 |
| 35 | 2 | 5 |
| 36 | 3 | 0 |
| 37 | 1 | 0 |
| 38 | 1 | 1 |
| 40 | 41 | 65 |
| 43 | 0 | 1 |
| 44 | 0 | 1 |
| 45 | 0 | 2 |
| 50 | 10 | 15 |
| 51 | 0 | 5 |

## Class tables (baseline, pack-off vs pack-on)

| Class | Off n | Off mean floor | On mean floor | Δ floor | Off F10 arr | On F10 arr | Off F10 win|arr | On F10 win|arr |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| warrior | 264 | 13.02 | 12.44 | -0.58 | 81.8% | 77.3% | 44.9% | 42.2% |
| mage | 336 | 10.40 | 10.31 | -0.09 | 70.2% | 63.7% | 33.1% | 32.2% |
| archer | 624 | 14.54 | 16.09 | 1.54 | 88.0% | 87.3% | 52.6% | 53.2% |
| rogue | 336 | 13.13 | 11.82 | -1.31 | 83.6% | 78.0% | 46.6% | 37.0% |
| priest | 264 | 10.11 | 9.54 | -0.57 | 78.0% | 69.7% | 16.0% | 14.1% |
| monk | 264 | 12.29 | 12.27 | -0.03 | 82.6% | 78.0% | 42.2% | 39.8% |
| warlock | 192 | 8.96 | 8.39 | -0.57 | 56.3% | 54.7% | 23.1% | 11.4% |
| bard | 192 | 11.66 | 10.32 | -1.33 | 77.6% | 74.5% | 34.2% | 23.1% |
| necromancer | 264 | 12.29 | 11.25 | -1.04 | 71.2% | 70.8% | 48.9% | 37.4% |
| spellsword | 192 | 10.46 | 10.09 | -0.37 | 76.0% | 68.2% | 26.0% | 28.2% |
| viking | 624 | 15.65 | 16.18 | 0.54 | 86.2% | 84.6% | 61.2% | 54.9% |

## Bloodline tables (baseline, all classes pooled)

| Bloodline | Off mean floor | On mean floor | Δ | On F10 arr | On Unique/run |
| --- | --- | --- | --- | --- | --- |
| human | 11.80 | 10.90 | -0.90 | 69.3% | 0.021 |
| elf | 11.89 | 11.14 | -0.76 | 72.3% | 0.033 |
| orc | 12.78 | 12.20 | -0.58 | 76.0% | 0.054 |
| dwarf | 13.28 | 13.53 | 0.25 | 83.6% | 0.074 |
| halfling | 12.14 | 12.63 | 0.49 | 71.7% | 0.075 |
| tiefling | 10.98 | 10.53 | -0.45 | 71.2% | 0.057 |
| beastfolk | 13.62 | 13.15 | -0.46 | 80.4% | 0.076 |
| dragonkin | 13.72 | 14.70 | 0.98 | 79.2% | 0.118 |

## Class × bloodline (baseline, all 88 combinations)

n is per pack state. Expansion combos have n=96; others n=24. Identical seeds pack-off vs pack-on.

| Combo | Off n | On n | Off mean | On mean | Δ | Off F10 arr | On F10 arr | On F10 win|arr | On stdev |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| warrior/human | 24 | 24 | 12.29 | 12.00 | -0.29 | 87.5% | 83.3% | 35.0% | 6.48 |
| warrior/elf | 24 | 24 | 12.00 | 11.00 | -1.00 | 83.3% | 70.8% | 47.1% | 5.37 |
| warrior/orc | 24 | 24 | 12.75 | 11.38 | -1.38 | 83.3% | 70.8% | 47.1% | 5.21 |
| warrior/dwarf | 24 | 24 | 12.92 | 10.25 | -2.67 | 87.5% | 79.2% | 21.1% | 3.98 |
| warrior/halfling | 24 | 24 | 10.21 | 9.63 | -0.58 | 75.0% | 70.8% | 23.5% | 4.13 |
| warrior/tiefling | 24 | 24 | 10.83 | 12.46 | 1.63 | 79.2% | 75.0% | 27.8% | 7.61 |
| warrior/beastfolk | 24 | 24 | 12.83 | 12.92 | 0.08 | 79.2% | 87.5% | 52.4% | 5.69 |
| warrior/dragonkin | 96 | 96 | 14.84 | 14.29 | -0.55 | 81.3% | 78.1% | 52.0% | 8.97 |
| mage/human | 24 | 24 | 10.67 | 9.38 | -1.29 | 79.2% | 66.7% | 25.0% | 3.29 |
| mage/elf | 24 | 24 | 8.58 | 8.08 | -0.50 | 45.8% | 45.8% | 27.3% | 4.24 |
| mage/orc | 96 | 96 | 11.16 | 9.47 | -1.69 | 75.0% | 62.5% | 26.7% | 4.11 |
| mage/dwarf | 24 | 24 | 9.21 | 10.67 | 1.46 | 70.8% | 70.8% | 35.3% | 4.24 |
| mage/halfling | 96 | 96 | 10.18 | 11.10 | 0.93 | 69.8% | 58.3% | 37.5% | 7.83 |
| mage/tiefling | 24 | 24 | 9.17 | 8.38 | -0.79 | 58.3% | 58.3% | 7.1% | 3.13 |
| mage/beastfolk | 24 | 24 | 10.13 | 12.92 | 2.79 | 62.5% | 83.3% | 45.0% | 6.16 |
| mage/dragonkin | 24 | 24 | 12.50 | 12.63 | 0.13 | 87.5% | 83.3% | 45.0% | 6.37 |
| archer/human | 96 | 96 | 13.58 | 13.79 | 0.21 | 85.4% | 81.3% | 47.4% | 8.03 |
| archer/elf | 24 | 24 | 17.38 | 15.58 | -1.79 | 87.5% | 100.0% | 58.3% | 6.52 |
| archer/orc | 96 | 96 | 13.29 | 14.55 | 1.26 | 94.8% | 87.5% | 50.0% | 8.44 |
| archer/dwarf | 96 | 96 | 15.00 | 16.82 | 1.82 | 88.5% | 90.6% | 54.0% | 10.28 |
| archer/halfling | 96 | 96 | 13.54 | 14.95 | 1.41 | 88.5% | 83.3% | 41.3% | 10.78 |
| archer/tiefling | 24 | 24 | 16.00 | 13.29 | -2.71 | 79.2% | 79.2% | 42.1% | 7.84 |
| archer/beastfolk | 96 | 96 | 15.63 | 18.07 | 2.45 | 86.5% | 90.6% | 65.5% | 10.77 |
| archer/dragonkin | 96 | 96 | 15.16 | 19.18 | 4.02 | 86.5% | 89.6% | 60.5% | 13.02 |
| rogue/human | 24 | 24 | 11.17 | 8.79 | -2.38 | 75.0% | 62.5% | 6.7% | 2.48 |
| rogue/elf | 24 | 24 | 9.88 | 11.29 | 1.42 | 54.2% | 87.5% | 33.3% | 3.22 |
| rogue/orc | 24 | 24 | 13.63 | 11.33 | -2.29 | 83.3% | 83.3% | 35.0% | 4.41 |
| rogue/dwarf | 24 | 24 | 13.21 | 10.67 | -2.54 | 83.3% | 66.7% | 37.5% | 4.84 |
| rogue/halfling | 24 | 24 | 12.33 | 10.63 | -1.71 | 79.2% | 75.0% | 22.2% | 5.80 |
| rogue/tiefling | 24 | 24 | 12.96 | 11.67 | -1.29 | 75.0% | 75.0% | 44.4% | 6.86 |
| rogue/beastfolk | 96 | 96 | 15.17 | 13.01 | -2.16 | 93.8% | 85.4% | 46.3% | 6.39 |
| rogue/dragonkin | 96 | 96 | 12.49 | 12.27 | -0.22 | 86.5% | 75.0% | 36.1% | 7.46 |
| priest/human | 24 | 24 | 9.46 | 7.88 | -1.58 | 70.8% | 50.0% | 8.3% | 2.89 |
| priest/elf | 24 | 24 | 10.21 | 9.33 | -0.88 | 87.5% | 54.2% | 30.8% | 4.56 |
| priest/orc | 24 | 24 | 10.46 | 10.71 | 0.25 | 83.3% | 87.5% | 19.0% | 3.58 |
| priest/dwarf | 24 | 24 | 10.88 | 10.67 | -0.21 | 83.3% | 87.5% | 14.3% | 4.78 |
| priest/halfling | 24 | 24 | 10.00 | 10.83 | 0.83 | 79.2% | 66.7% | 31.3% | 6.59 |
| priest/tiefling | 24 | 24 | 8.92 | 9.00 | 0.08 | 66.7% | 70.8% | 5.9% | 2.54 |
| priest/beastfolk | 96 | 96 | 10.40 | 9.35 | -1.04 | 79.2% | 70.8% | 8.8% | 3.26 |
| priest/dragonkin | 24 | 24 | 9.71 | 9.13 | -0.58 | 70.8% | 66.7% | 12.5% | 3.46 |
| monk/human | 24 | 24 | 10.25 | 10.71 | 0.46 | 79.2% | 75.0% | 33.3% | 4.10 |
| monk/elf | 24 | 24 | 11.25 | 12.04 | 0.79 | 83.3% | 79.2% | 36.8% | 5.45 |
| monk/orc | 24 | 24 | 12.29 | 11.29 | -1.00 | 75.0% | 79.2% | 42.1% | 4.46 |
| monk/dwarf | 24 | 24 | 12.00 | 11.13 | -0.88 | 83.3% | 87.5% | 28.6% | 3.60 |
| monk/halfling | 24 | 24 | 13.25 | 12.29 | -0.96 | 87.5% | 70.8% | 41.2% | 7.86 |
| monk/tiefling | 24 | 24 | 11.25 | 10.21 | -1.04 | 70.8% | 87.5% | 14.3% | 3.12 |
| monk/beastfolk | 24 | 24 | 13.79 | 12.29 | -1.50 | 87.5% | 79.2% | 36.8% | 6.03 |
| monk/dragonkin | 96 | 96 | 12.78 | 13.74 | 0.96 | 85.4% | 75.0% | 52.8% | 8.94 |
| warlock/human | 24 | 24 | 9.63 | 6.71 | -2.92 | 54.2% | 29.2% | 0.0% | 2.35 |
| warlock/elf | 24 | 24 | 7.92 | 7.88 | -0.04 | 33.3% | 50.0% | 8.3% | 3.10 |
| warlock/orc | 24 | 24 | 9.50 | 8.75 | -0.75 | 66.7% | 58.3% | 14.3% | 2.88 |
| warlock/dwarf | 24 | 24 | 8.88 | 8.75 | -0.13 | 62.5% | 62.5% | 13.3% | 2.49 |
| warlock/halfling | 24 | 24 | 10.13 | 7.83 | -2.29 | 62.5% | 41.7% | 10.0% | 3.48 |
| warlock/tiefling | 24 | 24 | 7.92 | 8.17 | 0.25 | 50.0% | 62.5% | 0.0% | 2.70 |
| warlock/beastfolk | 24 | 24 | 8.63 | 9.13 | 0.50 | 54.2% | 62.5% | 13.3% | 3.39 |
| warlock/dragonkin | 24 | 24 | 9.08 | 9.92 | 0.83 | 66.7% | 70.8% | 23.5% | 3.54 |
| bard/human | 24 | 24 | 10.71 | 9.58 | -1.13 | 70.8% | 70.8% | 17.6% | 3.32 |
| bard/elf | 24 | 24 | 13.17 | 10.58 | -2.58 | 83.3% | 70.8% | 23.5% | 4.09 |
| bard/orc | 24 | 24 | 11.67 | 10.13 | -1.54 | 87.5% | 79.2% | 21.1% | 3.49 |
| bard/dwarf | 24 | 24 | 10.71 | 10.42 | -0.29 | 62.5% | 87.5% | 19.0% | 2.41 |
| bard/halfling | 24 | 24 | 10.29 | 11.13 | 0.83 | 62.5% | 70.8% | 35.3% | 6.30 |
| bard/tiefling | 24 | 24 | 10.83 | 9.79 | -1.04 | 75.0% | 58.3% | 35.7% | 4.42 |
| bard/beastfolk | 24 | 24 | 12.83 | 10.42 | -2.42 | 87.5% | 79.2% | 15.8% | 4.09 |
| bard/dragonkin | 24 | 24 | 13.04 | 10.54 | -2.50 | 91.7% | 79.2% | 21.1% | 4.29 |
| necromancer/human | 24 | 24 | 12.88 | 10.71 | -2.17 | 75.0% | 66.7% | 37.5% | 7.01 |
| necromancer/elf | 24 | 24 | 10.67 | 8.21 | -2.46 | 62.5% | 58.3% | 28.6% | 3.13 |
| necromancer/orc | 24 | 24 | 9.75 | 11.04 | 1.29 | 58.3% | 70.8% | 29.4% | 6.02 |
| necromancer/dwarf | 24 | 24 | 14.33 | 11.50 | -2.83 | 79.2% | 83.3% | 35.0% | 4.20 |
| necromancer/halfling | 24 | 24 | 11.00 | 9.50 | -1.50 | 62.5% | 62.5% | 13.3% | 5.05 |
| necromancer/tiefling | 24 | 24 | 8.75 | 8.54 | -0.21 | 45.8% | 58.3% | 7.1% | 2.70 |
| necromancer/beastfolk | 24 | 24 | 13.92 | 10.50 | -3.42 | 75.0% | 70.8% | 41.2% | 5.20 |
| necromancer/dragonkin | 96 | 96 | 13.47 | 13.44 | -0.03 | 81.3% | 77.1% | 51.4% | 7.67 |
| spellsword/human | 24 | 24 | 9.58 | 9.13 | -0.46 | 70.8% | 58.3% | 28.6% | 4.10 |
| spellsword/elf | 24 | 24 | 11.79 | 9.58 | -2.21 | 75.0% | 66.7% | 18.8% | 4.13 |
| spellsword/orc | 24 | 24 | 9.54 | 9.00 | -0.54 | 75.0% | 54.2% | 30.8% | 4.09 |
| spellsword/dwarf | 24 | 24 | 12.50 | 11.21 | -1.29 | 83.3% | 79.2% | 31.6% | 4.93 |
| spellsword/halfling | 24 | 24 | 9.50 | 8.79 | -0.71 | 70.8% | 58.3% | 14.3% | 3.60 |
| spellsword/tiefling | 24 | 24 | 9.71 | 10.21 | 0.50 | 70.8% | 70.8% | 29.4% | 4.27 |
| spellsword/beastfolk | 24 | 24 | 11.46 | 11.21 | -0.25 | 87.5% | 75.0% | 33.3% | 5.12 |
| spellsword/dragonkin | 24 | 24 | 9.63 | 11.63 | 2.00 | 75.0% | 83.3% | 35.0% | 4.60 |
| viking/human | 24 | 24 | 14.29 | 12.54 | -1.75 | 83.3% | 83.3% | 45.0% | 5.88 |
| viking/elf | 96 | 96 | 13.42 | 13.08 | -0.33 | 78.1% | 82.3% | 43.0% | 7.49 |
| viking/orc | 96 | 96 | 17.07 | 16.09 | -0.98 | 89.6% | 84.4% | 63.0% | 10.24 |
| viking/dwarf | 96 | 96 | 15.28 | 16.85 | 1.57 | 92.7% | 88.5% | 54.1% | 10.66 |
| viking/halfling | 96 | 96 | 15.31 | 16.96 | 1.65 | 81.3% | 87.5% | 48.8% | 12.10 |
| viking/tiefling | 24 | 24 | 14.42 | 14.08 | -0.33 | 87.5% | 87.5% | 47.6% | 7.52 |
| viking/beastfolk | 96 | 96 | 16.22 | 15.35 | -0.86 | 85.4% | 81.3% | 60.3% | 9.42 |
| viking/dragonkin | 96 | 96 | 17.23 | 20.19 | 2.96 | 90.6% | 83.3% | 65.0% | 13.65 |

## Boss-aware policy (matched seeds, every class on human + flagged combos)

| Metric | Pack-off | Pack-on |
| --- | --- | --- |
| n | 720 | 720 |
| Mean floor (95% CI) | 12.03 [11.56, 12.51] | 11.53 [10.98, 12.09] |
| Median floor | 10.0 | 10.0 |
| F10 arrival | 74.4% | 68.5% |
| F10 win | arrival | 40.5% | 34.5% |
| Win rate | 0.0% | 0.3% |

| Class (human + flagged) | Off mean | On mean | Δ | On F10 arr |
| --- | --- | --- | --- | --- |
| warrior | 15.29 | 14.33 | -0.96 | 70.8% |
| mage | 9.54 | 9.68 | 0.14 | 59.7% |
| archer | 12.59 | 13.31 | 0.72 | 80.6% |
| rogue | 11.22 | 9.60 | -1.63 | 68.1% |
| priest | 10.23 | 9.42 | -0.81 | 56.3% |
| monk | 12.83 | 13.69 | 0.85 | 77.1% |
| warlock | 6.79 | 6.79 | 0.00 | 37.5% |
| bard | 8.96 | 8.46 | -0.50 | 66.7% |
| necromancer | 10.56 | 10.33 | -0.23 | 56.3% |
| spellsword | 9.63 | 8.54 | -1.08 | 37.5% |
| viking | 14.28 | 12.72 | -1.56 | 75.0% |

## Boss arrival / victory (baseline)

| Boss | Off arrive | Off win|arr | On arrive | On win|arr |
| --- | --- | --- | --- | --- |
| elderwood | 1491 | 49.9% | 1428 | 44.7% |
| gv_grotto_escape_2_boss_dragon | 1344 | 38.0% | 1281 | 35.4% |
| crowned_revenant | 1221 | 63.2% | 1058 | 69.8% |
| undead_executioner | 388 | 33.0% | 342 | 47.1% |
| lich | 359 | 25.9% | 370 | 36.2% |
| frost_queen | 103 | 33.0% | 118 | 50.0% |
| tr_mon_centaur | 79 | 40.5% | 124 | 48.4% |
| hydra | 32 | 25.0% | 61 | 39.3% |
| tr_live_ogre | 26 | 34.6% | 49 | 42.9% |
| infernal_duke | 12 | 33.3% | 22 | 45.5% |
| kryos_demon_general | 5 | 60.0% | 11 | 72.7% |
| tr_mon_demon | 5 | 100.0% | 6 | 83.3% |
| boss_demon_slime | 2 | 100.0% | 12 | 66.7% |

## Rarity by channel and floor band (baseline)

| Channel | Off C/U/R/E/L/Unique/WRLD | On C/U/R/E/L/Unique/WRLD |
| --- | --- | --- |
| boss | 371/2136/1556/357/85/185/0 | 304/2144/1502/382/91/218/1 |
| combat | 0/193/0/0/0/4/0 | 0/147/3/0/0/5/0 |
| elite | 0/0/0/0/0/10/0 | 0/0/0/0/0/13/0 |
| event | 3565/2519/974/121/2/5/0 | 2520/1845/1388/213/7/13/0 |
| shop | 5328/3901/1812/54/8/7/0 | 3994/3257/1545/70/8/9/0 |

| Floor band | Off C/U/R/E/L | On C/U/R/E/L |
| --- | --- | --- |
| 1-9 | 4117/2410/717/30/0 | 3049/1782/706/47/0 |
| 10 | 351/1233/607/189/42 | 251/1122/528/146/42 |
| 11-19 | 449/1594/948/149/21 | 246/1314/1102/139/25 |
| 20 | 2/210/171/30/12 | 18/256/224/42/10 |
| 21-29 | 19/231/176/17/0 | 12/179/216/69/0 |
| 30 | 3/22/81/14/0 | 0/65/127/34/3 |
| 31-39 | 0/26/95/11/0 | 8/26/97/40/0 |
| 40 | 0/4/10/15/2 | 0/22/35/27/3 |
| 41-50 | 1/12/10/19/5 | 1/11/20/38/13 |
| 51 | 0/2/3/4/5 | 1/6/3/13/2 |

## Item / equipment usage (pack-on baseline)

| Item | Offered | Equipped | Sold | Stash | Equip rate | Useful | Incompatible |
| --- | --- | --- | --- | --- | --- | --- | --- |
| iron_ring | 620 | 620 | 0 | 0 | 100.0% | 620 | 0 |
| lucky_coin | 608 | 608 | 0 | 0 | 100.0% | 608 | 0 |
| encore_medallion | 442 | 442 | 0 | 0 | 100.0% | 442 | 0 |
| veteran_cuirass | 226 | 221 | 5 | 0 | 97.8% | 226 | 0 |
| ember_heart | 220 | 220 | 0 | 0 | 100.0% | 220 | 0 |
| gamblers_die | 184 | 184 | 0 | 0 | 100.0% | 184 | 0 |
| pathfinder_hood | 183 | 183 | 0 | 0 | 100.0% | 183 | 0 |
| first_strike_horn | 177 | 177 | 0 | 0 | 100.0% | 177 | 0 |
| frozen_tear | 177 | 177 | 0 | 0 | 100.0% | 177 | 0 |
| cp_crowned_deer_antlerbow | 169 | 154 | 15 | 0 | 91.1% | 72 | 97 |
| gluttons_chalice | 156 | 156 | 0 | 0 | 100.0% | 156 | 0 |
| xp_tome | 156 | 156 | 0 | 0 | 100.0% | 156 | 0 |
| second_wind | 154 | 154 | 0 | 0 | 100.0% | 154 | 0 |
| whisper_knife | 147 | 143 | 4 | 0 | 97.3% | 140 | 7 |
| scholar_robe | 145 | 133 | 12 | 0 | 91.7% | 145 | 0 |
| moon_dial | 142 | 142 | 0 | 0 | 100.0% | 142 | 0 |
| axe_pack_mail | 133 | 133 | 0 | 0 | 100.0% | 133 | 0 |
| thornmail | 127 | 127 | 0 | 0 | 100.0% | 127 | 0 |
| cp_three_trails_longbow | 119 | 117 | 2 | 0 | 98.3% | 119 | 0 |
| mimic_tooth | 107 | 107 | 0 | 0 | 100.0% | 107 | 0 |
| greenwood_rod | 106 | 103 | 3 | 0 | 97.2% | 95 | 11 |
| runed_dagger | 104 | 95 | 9 | 0 | 91.3% | 101 | 3 |
| golden_idol | 99 | 99 | 0 | 0 | 100.0% | 99 | 0 |
| blood_chalice | 91 | 91 | 0 | 0 | 100.0% | 91 | 0 |
| cp_raid_wake_helm | 85 | 80 | 5 | 0 | 94.1% | 85 | 0 |
| chaos_prism | 84 | 84 | 0 | 0 | 100.0% | 84 | 0 |
| war_drum | 84 | 84 | 0 | 0 | 100.0% | 84 | 0 |
| leather_cap | 82 | 80 | 2 | 0 | 97.6% | 82 | 0 |
| grove_shortsword | 82 | 76 | 6 | 0 | 92.7% | 71 | 11 |
| renown_lantern | 82 | 82 | 0 | 0 | 100.0% | 82 | 0 |

Almost always equipped (≥16 offers, ≥95%): `iron_ring`, `lucky_coin`, `encore_medallion`, `veteran_cuirass`, `ember_heart`, `gamblers_die`, `pathfinder_hood`, `first_strike_horn`, `frozen_tear`, `gluttons_chalice`, `xp_tome`, `second_wind`, `whisper_knife`, `moon_dial`, `axe_pack_mail`, `thornmail`, `cp_three_trails_longbow`, `mimic_tooth`, `greenwood_rod`, `golden_idol`, `blood_chalice`, `chaos_prism`, `war_drum`, `leather_cap`, `renown_lantern`, `fletcher_ring`, `demon_pact`, `ashwood_staff`, `ruins_keyring`, `boss_bane`, `vanguard_buckle`, `prayer_beads`, `mire_totem`, `hawk_charm`, `riverstone_club`, `worn_boots`, `cp_raid_wake_legs`, `focus_ring`, `cp_three_trails_legs`, `cp_rootwoven_vest`

## Technique, art, consumable, and shop usage (pack-on baseline)

Skill uses:
| Id | Count | Per run |
| --- | --- | --- |
| basic_attack | 5914 | 1.665 |
| guard | 5464 | 1.538 |
| axe_chop | 4726 | 1.331 |
| aimed_shot | 4495 | 1.265 |
| raiders_hook | 4300 | 1.211 |
| smite | 3693 | 1.040 |
| quick_shot | 3630 | 1.022 |
| shield_splitter | 3198 | 0.900 |
| double_nock | 2571 | 0.724 |
| shield_bash | 2426 | 0.683 |
| frost_lance | 2143 | 0.603 |
| throat_jab | 2068 | 0.582 |
| slash | 2048 | 0.577 |
| bone_spike | 1787 | 0.503 |
| flurry | 1676 | 0.472 |
| mana_dart | 1632 | 0.459 |

Class technique offers:
| Id | Count | Per run |
| --- | --- | --- |
| cp_raid_mark | 98 | 0.028 |
| cp_shield_wall_step | 91 | 0.026 |
| cp_longship_break | 90 | 0.025 |
| cp_fury_hook | 82 | 0.023 |
| cp_blood_price | 76 | 0.021 |
| cp_valhalla_echo | 72 | 0.020 |
| cp_horizon_gate | 55 | 0.015 |
| cp_scent_tomorrow | 55 | 0.015 |
| cp_spinebow_volley | 52 | 0.015 |
| cp_avalanche_calculation | 51 | 0.014 |
| cp_mark_the_uncounted | 46 | 0.013 |
| cp_three_trails | 36 | 0.010 |
| cp_silence_the_system | 13 | 0.004 |
| cp_listen_to_the_floor | 13 | 0.004 |
| cp_gather_remains | 13 | 0.004 |
| cp_false_receipt | 12 | 0.003 |

Class technique picks:
| Id | Count | Per run |
| --- | --- | --- |
| cp_valhalla_echo | 62 | 0.017 |
| cp_longship_break | 48 | 0.014 |
| cp_horizon_gate | 37 | 0.010 |
| cp_fury_hook | 26 | 0.007 |
| cp_avalanche_calculation | 19 | 0.005 |
| cp_raid_mark | 11 | 0.003 |
| cp_scent_tomorrow | 10 | 0.003 |
| cp_final_audit | 7 | 0.002 |
| cp_seven_breaths | 6 | 0.002 |
| cp_echo_feint | 5 | 0.001 |
| cp_unlived_injury | 5 | 0.001 |
| cp_sevenfold_verdict | 4 | 0.001 |
| cp_blood_price | 4 | 0.001 |
| cp_spinebow_volley | 4 | 0.001 |
| cp_steal_intent | 3 | 0.001 |
| cp_gatebreaker_charge | 2 | 0.001 |

Bloodline art offers:
| Id | Count | Per run |
| --- | --- | --- |
| cp_art_hoard_authority | 314 | 0.088 |
| cp_art_ancestral_breath | 279 | 0.079 |
| cp_art_instinct_before_intent | 217 | 0.061 |
| cp_art_pack_scent | 203 | 0.057 |
| cp_art_scar_oath | 167 | 0.047 |
| cp_art_clan_before_self | 157 | 0.044 |
| cp_art_field_reforge | 155 | 0.044 |
| cp_art_improbably_prepared | 150 | 0.042 |
| cp_art_structural_weakness | 142 | 0.040 |
| cp_art_one_more_meal | 127 | 0.036 |
| cp_art_long_memory | 108 | 0.030 |
| cp_art_root_communion | 106 | 0.030 |
| cp_art_refuse_classification | 91 | 0.026 |
| cp_art_borrowed_mastery | 86 | 0.024 |
| cp_art_fine_print_clause | 54 | 0.015 |
| cp_art_appeal_from_damnation | 52 | 0.015 |

Bloodline art picks:
| Id | Count | Per run |
| --- | --- | --- |
| cp_art_ancestral_breath | 279 | 0.079 |
| cp_art_pack_scent | 203 | 0.057 |
| cp_art_clan_before_self | 157 | 0.044 |
| cp_art_structural_weakness | 142 | 0.040 |
| cp_art_one_more_meal | 127 | 0.036 |
| cp_art_root_communion | 106 | 0.030 |
| cp_art_borrowed_mastery | 86 | 0.024 |
| cp_art_appeal_from_damnation | 52 | 0.015 |
| cp_art_hoard_authority | 35 | 0.010 |
| cp_art_improbably_prepared | 23 | 0.006 |
| cp_art_instinct_before_intent | 14 | 0.004 |
| cp_art_field_reforge | 13 | 0.004 |
| cp_art_scar_oath | 10 | 0.003 |
| cp_art_refuse_classification | 5 | 0.001 |
| cp_art_fine_print_clause | 2 | 0.001 |
| cp_art_long_memory | 2 | 0.001 |

Consumable uses:
| Id | Count | Per run |
| --- | --- | --- |
| potion_s | 7457 | 2.099 |
| farm_cheese | 418 | 0.118 |
| farm_stew | 417 | 0.117 |
| farm_bread | 406 | 0.114 |
| enchanted_honey | 115 | 0.032 |
| calming_tea | 104 | 0.029 |
| enchanted_loaf | 90 | 0.025 |
| enchanted_root | 90 | 0.025 |
| potion_l | 88 | 0.025 |
| enchanted_berry | 83 | 0.023 |
| enchanted_cider | 82 | 0.023 |
| smelling_salts | 57 | 0.016 |

Shop buys:
| Id | Count | Per run |
| --- | --- | --- |
| farm_bread | 201 | 0.057 |
| farm_stew | 198 | 0.056 |
| farm_cheese | 191 | 0.054 |
| potion_s | 172 | 0.048 |
| enchanted_honey | 130 | 0.037 |
| calming_tea | 121 | 0.034 |
| enchanted_root | 104 | 0.029 |
| enchanted_loaf | 100 | 0.028 |
| enchanted_berry | 98 | 0.028 |
| potion_l | 94 | 0.026 |
| enchanted_cider | 92 | 0.026 |
| smelling_salts | 73 | 0.021 |

## Events and threads (pack-on baseline)

| Id | Count | Per run |
| --- | --- | --- |
| campfire | 5452 | 1.535 |
| merchant | 1236 | 0.348 |
| chest_generic | 678 | 0.191 |
| discarded_kit | 595 | 0.168 |
| roadside_climbers | 595 | 0.168 |
| old_shrine | 591 | 0.166 |
| wounded_adventurer | 520 | 0.146 |
| abandoned_armory | 487 | 0.137 |
| wandering_appraiser | 482 | 0.136 |
| farmstead_meet | 477 | 0.134 |
| blood_altar | 452 | 0.127 |
| gambler | 427 | 0.120 |
| bard | 408 | 0.115 |
| fey_bargain | 398 | 0.112 |
| bandit_toll | 378 | 0.106 |
| wheel_of_the_tower | 367 | 0.103 |
| slime_crown | 364 | 0.102 |
| training_grounds | 360 | 0.101 |
| orc_logging_camp | 356 | 0.100 |
| seed_of_power | 330 | 0.093 |
| beehive | 323 | 0.091 |
| trial_stones | 316 | 0.089 |
| assay_clerk | 305 | 0.086 |
| mysterious_door | 303 | 0.085 |

Repeated events:
| Id | Count | Per run |
| --- | --- | --- |
| campfire | 2684 | 0.756 |
| merchant | 144 | 0.041 |
| discarded_kit | 37 | 0.010 |
| chest_generic | 32 | 0.009 |
| roadside_climbers | 31 | 0.009 |
| old_shrine | 25 | 0.007 |
| abandoned_armory | 23 | 0.006 |
| gambler | 20 | 0.006 |
| blood_altar | 18 | 0.005 |
| farmstead_meet | 18 | 0.005 |
| training_grounds | 16 | 0.005 |
| bard | 15 | 0.004 |
| wheel_of_the_tower | 12 | 0.003 |
| cursed_mirror | 11 | 0.003 |
| reforge_altar | 10 | 0.003 |
| prodigys_gambit | 10 | 0.003 |

## Winning-build concentration (baseline)

Pack-off wins 7; pack-on wins 13. Full 51-floor clears remain rare; treat concentration on n<30 as descriptive, not a meta proof.

| Pack | Class | Bloodline | Seed | Floor | Weapon | Skills | Relics |
| --- | --- | --- | --- | --- | --- | --- | --- |
| off | viking | dwarf | 1646402971 | 51 | titan_maul__6b8105 | axe_chop,bite_the_shield,blood_howl,longship_charge,shield_splitter,spinning_axes | berserkers_heart,demon_pact,frozen_tear,gamblers_die,gluttons_chalice,golden_idol,thornmail,tortoise_shell |
| off | viking | dragonkin | 1349179758 | 51 | heavenbreaker_wraps__e8bae1 | axe_chop,bite_the_shield,blood_howl,raiders_hook,shield_splitter,valhalla_calls | boss_bane,demon_pact,ember_heart,frozen_tear,gluttons_chalice,mimic_tooth,moon_dial,thornmail,war_drum |
| off | archer | beastfolk | 1697651208 | 51 | skyfall_bow__46d17c | aimed_shot,arrow_tempest,double_nock,evasive_roll,one_shot,quick_shot | berserkers_heart,chaos_prism,frozen_tear,moon_dial,second_wind,thornmail,whetstone,xp_tome |
| off | archer | dragonkin | 3375333392 | 51 | assassins_kiss__b57d34 | aimed_shot,arrow_tempest,double_nock,evasive_roll,field_shot,quick_shot | berserkers_heart,chaos_prism,demon_pact,gamblers_die,mimic_tooth,renown_lantern,tortoise_shell,war_drum,whetstone |
| off | viking | dwarf | 2508309350 | 51 | heavenbreaker_wraps__00dadf | axe_chop,bite_the_shield,blood_howl,raiders_hook,shield_splitter,valhalla_calls | boss_bane,demon_pact,frozen_tear,gamblers_die,moon_dial,thornmail,xp_tome |
| off | viking | beastfolk | 1151772147 | 51 | executioner_axe__3b6bf4 | axe_chop,bite_the_shield,blood_howl,shield_splitter,spinning_axes,valhalla_calls | demon_pact,ember_heart,frozen_tear,mimic_tooth,moon_dial,thornmail,war_drum,xp_tome |
| off | viking | dragonkin | 4038744465 | 51 | skyfall_bow__7c7ee8 | axe_chop,bite_the_shield,blood_howl,raiders_hook,shield_splitter,valhalla_calls | blood_chalice,boss_bane,chaos_prism,demon_pact,ember_heart,first_strike_horn,gluttons_chalice,golden_idol,second_wind,xp_tome |
| on | archer | beastfolk | 1628682396 | 51 | cp_avalanche_repeater__65742a | aimed_shot,cp_avalanche_calculation,double_nock,evasive_roll,lightning_arrow,quick_shot | cp_frogs_hero_license,cp_unminted_coin,echo_stone,ember_heart,frozen_tear,gamblers_die,gluttons_chalice,second_wind,tortoise_shell,xp_tome |
| on | archer | dragonkin | 2806552339 | 51 | infernal_lash__eca7dc | aimed_shot,double_nock,evasive_roll,lightning_arrow,one_shot,quick_shot | blood_chalice,chaos_prism,cp_gate_surveyor_last_report,cp_mirror_splinter,cp_moss_chapel_candle,cp_unminted_coin,demon_pact,ember_heart,gamblers_die,renown_lantern,war_drum,whetstone,xp_tome |
| on | archer | dragonkin | 2266326982 | 51 | cp_gate_beast_spinebow__8679f7 | aimed_shot,cp_scent_tomorrow,double_nock,evasive_roll,field_shot,quick_shot | cp_empty_saint_icon,cp_gate_surveyor_last_report,cp_mirror_splinter,demon_pact,echo_stone,ember_heart,gluttons_chalice,golden_idol,war_drum,xp_tome |
| on | rogue | dragonkin | 3547299162 | 51 | skyfall_bow__25c8e8 | backstab,caltrops,poison_blade,smoke_bomb,thousand_cuts,throat_jab | boss_bane,cp_invisible_toll_receipt,frozen_tear,gluttons_chalice,golden_idol,mimic_tooth,second_wind,thornmail,tortoise_shell,war_drum |
| on | monk | dragonkin | 1069001606 | 51 | necro_rod | flurry,iron_stance,low_sweep,open_palm,palm_strike,pressure_point | blood_chalice,demon_pact,ember_heart,first_strike_horn,frozen_tear,golden_idol,moon_dial,renown_lantern,xp_tome |
| on | viking | dragonkin | 2319634713 | 51 | cp_shield_biters_maul__1dad3c | axe_chop,blood_howl,cp_longship_break,cp_valhalla_echo,longship_charge,pillage,shield_splitter,spinning_axes | cp_refugee_camp_banner,echo_stone,ember_heart,frozen_tear,golden_idol,hourglass,mimic_tooth,twin_soul,xp_tome |
| on | viking | dragonkin | 1042924754 | 51 | first_verdict__277b1b | axe_chop,blood_howl,cp_raid_mark,raiders_hook,shield_splitter,valhalla_calls | blood_chalice,chaos_prism,cp_unminted_coin,ember_heart,first_strike_horn,frozen_tear,gamblers_die,renown_lantern,thornmail |
| on | archer | dragonkin | 128481931 | 51 | cp_gate_beast_spinebow__f69986 | aimed_shot,double_nock,evasive_roll,one_shot,piercing_arrow,quick_shot | boss_bane,ember_heart,first_strike_horn,gamblers_die,golden_idol,renown_lantern,second_wind,whetstone |
| on | archer | dragonkin | 2657075197 | 51 | cp_avalanche_repeater__f86e41 | aimed_shot,cp_horizon_gate,double_nock,evasive_roll,piercing_arrow,quick_shot | chaos_prism,cp_gate_surveyor_last_report,first_strike_horn,gamblers_die,mimic_tooth,moon_dial,renown_lantern,second_wind,thornmail |
| on | archer | dragonkin | 2685661615 | 51 | infernal_lash__93b64d | aimed_shot,double_nock,evasive_roll,hunters_mark,lightning_arrow,quick_shot | first_strike_horn,frozen_tear,gamblers_die,gluttons_chalice,moon_dial,renown_lantern,xp_tome |
| on | viking | dwarf | 3290660751 | 51 | cp_frost_wake_cleaver__31bff6 | axe_chop,blood_howl,cp_valhalla_echo,raiders_hook,shield_splitter | blood_chalice,boss_bane,ember_heart,first_strike_horn,gluttons_chalice,golden_idol,second_wind,thornmail,xp_tome |
| on | viking | halfling | 4144891968 | 51 | infernal_lash__fd10a2 | axe_chop,blood_howl,cp_fury_hook,cp_longship_break,raiders_hook,shield_splitter | blood_chalice,boss_bane,cp_gate_surveyor_last_report,demon_pact,ember_heart,moon_dial,second_wind,war_drum |
| on | viking | beastfolk | 3652653303 | 51 | first_verdict__25d6e9 | axe_chop,blood_howl,cp_raid_mark,cp_valhalla_echo,raiders_hook,shield_splitter | boss_bane,ember_heart,first_strike_horn,frozen_tear,gamblers_die,gluttons_chalice,moon_dial,xp_tome |

Pack-on duplicate keys:
- 1 (7.7%): `archer/beastfolk|cp_avalanche_repeater__65742a|aimed_shot,cp_avalanche_calculation,double_nock,evasive_roll,lightning_arrow,quick_shot|cp_frogs_hero_license,cp_unminted_coin,echo_stone,ember_heart,frozen_tear,gamblers_die,gluttons_chalice,second_wind,tortoise_shell,xp_tome`
- 1 (7.7%): `archer/dragonkin|infernal_lash__eca7dc|aimed_shot,double_nock,evasive_roll,lightning_arrow,one_shot,quick_shot|blood_chalice,chaos_prism,cp_gate_surveyor_last_report,cp_mirror_splinter,cp_moss_chapel_candle,cp_unminted_coin,demon_pact,ember_heart,gamblers_die,renown_lantern,war_drum,whetstone,xp_tome`
- 1 (7.7%): `archer/dragonkin|cp_gate_beast_spinebow__8679f7|aimed_shot,cp_scent_tomorrow,double_nock,evasive_roll,field_shot,quick_shot|cp_empty_saint_icon,cp_gate_surveyor_last_report,cp_mirror_splinter,demon_pact,echo_stone,ember_heart,gluttons_chalice,golden_idol,war_drum,xp_tome`
- 1 (7.7%): `rogue/dragonkin|skyfall_bow__25c8e8|backstab,caltrops,poison_blade,smoke_bomb,thousand_cuts,throat_jab|boss_bane,cp_invisible_toll_receipt,frozen_tear,gluttons_chalice,golden_idol,mimic_tooth,second_wind,thornmail,tortoise_shell,war_drum`
- 1 (7.7%): `monk/dragonkin|necro_rod|flurry,iron_stance,low_sweep,open_palm,palm_strike,pressure_point|blood_chalice,demon_pact,ember_heart,first_strike_horn,frozen_tear,golden_idol,moon_dial,renown_lantern,xp_tome`
- 1 (7.7%): `viking/dragonkin|cp_shield_biters_maul__1dad3c|axe_chop,blood_howl,cp_longship_break,cp_valhalla_echo,longship_charge,pillage,shield_splitter,spinning_axes|cp_refugee_camp_banner,echo_stone,ember_heart,frozen_tear,golden_idol,hourglass,mimic_tooth,twin_soul,xp_tome`
- 1 (7.7%): `viking/dragonkin|first_verdict__277b1b|axe_chop,blood_howl,cp_raid_mark,raiders_hook,shield_splitter,valhalla_calls|blood_chalice,chaos_prism,cp_unminted_coin,ember_heart,first_strike_horn,frozen_tear,gamblers_die,renown_lantern,thornmail`
- 1 (7.7%): `archer/dragonkin|cp_gate_beast_spinebow__f69986|aimed_shot,double_nock,evasive_roll,one_shot,piercing_arrow,quick_shot|boss_bane,ember_heart,first_strike_horn,gamblers_die,golden_idol,renown_lantern,second_wind,whetstone`

## Item / effect-family usage (pack-on baseline)

| Family | Mean ops / run (pack-on) |
| --- | --- |
| modDamage | 3.320 |
| heal | 1.508 |
| statusChance | 1.495 |
| markTarget | 0.918 |
| redirectDamage | 0.748 |
| armNextIncoming | 0.686 |
| revealIntent | 0.599 |
| delayEffect | 0.445 |
| setFlag | 0.399 |
| modIncoming | 0.359 |
| borrowTechnique | 0.355 |
| applyStatus | 0.334 |
| removeStatus | 0.242 |
| convertResource | 0.225 |
| contestLethal | 0.222 |
| spendGoldPower | 0.197 |
| addCounter | 0.178 |
| storeMemory | 0.176 |
| gainGold | 0.158 |
| grantResource | 0.130 |
| setOath | 0.128 |
| armNextHit | 0.113 |
| shareHeal | 0.083 |
| weakenIntent | 0.077 |

Capped ops (pack-on):
| Id | Count | Per run |
| --- | --- | --- |
| modDamage | 732 | 0.206 |
| heal | 445 | 0.125 |
| addCounter | 184 | 0.052 |
| modIncoming | 173 | 0.049 |
| statusChance | 166 | 0.047 |
| redirectDamage | 162 | 0.046 |
| gainGold | 158 | 0.044 |
| leaveAtOne | 124 | 0.035 |
| markTarget | 111 | 0.031 |
| echoAction | 104 | 0.029 |
| applyStatus | 100 | 0.028 |
| borrowTechnique | 83 | 0.023 |

## Ranked anomalies

### Confirmed balance failures

- **medium** `combo_high_survival` / `archer/dragonkin`: archer/dragonkin mean floor 19.18 (z=2.93) vs pack-on combo mean 11.39; pack Δ 4.02 — Abnormally high survival with a material pack-on lift.

### Likely problems requiring more samples

- **medium** `combo_high_survival` / `viking/dragonkin`: viking/dragonkin mean floor 20.19 (z=3.31) vs pack-on combo mean 11.39; pack Δ 2.96 — Abnormally high survival with a material pack-on lift.
- **medium** `combo_moved` / `archer/dragonkin`: archer/dragonkin mean floor 15.16 → 19.18 (n=96) — Class/bloodline interaction with pack gear, arts, or events.
- **low** `high_variance` / `archer/dwarf`: archer/dwarf floor stdev 10.28 on n=96 — Seed-sensitive pathing or rare pack drops dominating outcomes.
- **low** `high_variance` / `archer/halfling`: archer/halfling floor stdev 10.78 on n=96 — Seed-sensitive pathing or rare pack drops dominating outcomes.
- **low** `high_variance` / `archer/beastfolk`: archer/beastfolk floor stdev 10.77 on n=96 — Seed-sensitive pathing or rare pack drops dominating outcomes.
- **low** `high_variance` / `archer/dragonkin`: archer/dragonkin floor stdev 13.02 on n=96 — Seed-sensitive pathing or rare pack drops dominating outcomes.
- **low** `high_variance` / `viking/orc`: viking/orc floor stdev 10.24 on n=96 — Seed-sensitive pathing or rare pack drops dominating outcomes.
- **low** `high_variance` / `viking/dwarf`: viking/dwarf floor stdev 10.66 on n=96 — Seed-sensitive pathing or rare pack drops dominating outcomes.
- **low** `high_variance` / `viking/halfling`: viking/halfling floor stdev 12.10 on n=96 — Seed-sensitive pathing or rare pack drops dominating outcomes.
- **low** `high_variance` / `viking/dragonkin`: viking/dragonkin floor stdev 13.65 on n=96 — Seed-sensitive pathing or rare pack drops dominating outcomes.

### Expected pack-on differences

- **medium** `performance` / `climb_ms`: Mean climb time 43ms → 98ms — Pack effect dispatch on every combat hook.
- **low** `always_equipped` / `cp_last_bastion_legs`: cp_last_bastion_legs equipped 26/26 — Pack offer almost always upgrades the current slot under baseline policy.
- **low** `always_equipped` / `cp_quiet_step_greaves`: cp_quiet_step_greaves equipped 41/41 — Pack offer almost always upgrades the current slot under baseline policy.
- **low** `always_equipped` / `cp_bog_wader_boots`: cp_bog_wader_boots equipped 31/31 — Pack offer almost always upgrades the current slot under baseline policy.
- **low** `always_equipped` / `cp_moon_fang_shortbow`: cp_moon_fang_shortbow equipped 21/21 — Pack offer almost always upgrades the current slot under baseline policy.
- **low** `always_equipped` / `cp_three_trails_longbow`: cp_three_trails_longbow equipped 117/119 — Pack offer almost always upgrades the current slot under baseline policy.
- **low** `always_equipped` / `cp_three_trails_legs`: cp_three_trails_legs equipped 67/67 — Pack offer almost always upgrades the current slot under baseline policy.
- **low** `always_equipped` / `cp_hingescale_legs`: cp_hingescale_legs equipped 23/23 — Pack offer almost always upgrades the current slot under baseline policy.
- **low** `always_equipped` / `cp_unseen_auditor_legs`: cp_unseen_auditor_legs equipped 22/22 — Pack offer almost always upgrades the current slot under baseline policy.
- **low** `always_equipped` / `cp_heretics_bell`: cp_heretics_bell equipped 30/30 — Pack offer almost always upgrades the current slot under baseline policy.
- **low** `always_equipped` / `cp_seventh_funeral_helm`: cp_seventh_funeral_helm equipped 21/21 — Pack offer almost always upgrades the current slot under baseline policy.
- **low** `always_equipped` / `cp_raid_wake_legs`: cp_raid_wake_legs equipped 69/69 — Pack offer almost always upgrades the current slot under baseline policy.

### Insufficiently exercised mechanics

- **medium** `sets_incomplete` / `armor_sets`: Mean 2pc 0.01, 3pc 0.00 completions per run — Class/bloodline sets may be practically impossible to complete on natural climbs.
- **low** `mp_harness` / `multiplayer`: No full multiplayer climb harness exists. Party results are TDC pads + focused fights. — Scope limit of climb_v2.

### Existing vanilla problems unrelated to the overhaul

- **high** `f10_gate` / `f10`: F10 arrival pack-off 79.8% (win|arrive 44.3%); pack-on 76.3% (win|arrive 40.3%) — Known vanilla F10 difficulty. Do not conceal with pack power. Measured, not retuned.
- **medium** `combo_high_survival` / `archer/beastfolk`: archer/beastfolk mean floor 18.07 (z=2.52) vs pack-on combo mean 11.39; pack Δ 2.45 — Ranking vs other combos is similar pack-off; this is class/bloodline strength, not a new pack failure.
- **low** `always_equipped_policy` / `baseline_chooseEquip`: 65 gear/relic ids at ≥98% equip rate (11 pack ids). Examples: prayer_beads, axe_pack_mail, golden_idol, pathfinder_hood, ember_heart, gluttons_chalice, first_verdict, thornmail — Baseline chooseEquip takes upgrades and relics; this is policy, not a pack-only loop.

## Focused mechanic tests

Engine battery: 74 passed, 0 failed. Families: echo, delay, revive, redirect, summon, intent, currency_power, conversion, start_charge, extra_skill_capacity, sets, resonance, curse, evolution, event_relic, unique_wrld, mutex, caps.

| Required family | Covered in battery | Notes |
| --- | --- | --- |
| Echo and copied-action chains | yes | solo, pair, solo, solo, solo |
| Delayed damage and delayed healing | yes | solo, solo, pair |
| Revives and deathwards | yes | solo |
| Damage reflection and redirection | yes | solo, pair, solo, pair |
| Summons and temporary allies | yes | solo, pair |
| Intent manipulation | yes | solo, pair |
| Fame- and gold-powered effects | yes | solo, pair |
| Resource substitution and conversion | yes | solo, pair |
| Starting charge | yes | solo |
| Extra skill capacity | yes | solo |
| Set bonuses | yes | solo, pair |
| Bloodline resonance | yes | solo |
| Cursed drawbacks and resolutions | yes | solo |
| Equipment evolution | yes | solo |
| Event relic operations | yes | solo |
| Unique and WRLD effects | yes | solo, solo |

Battery rows: 22 solo, 10 pairwise, 3 three-/four-way.

Natural climbs will not exercise every rare mechanic. Focused grants covered those families. Remaining caveats:
- Unique/WRLD acquisition is gated and will be rare on 24-seed climbs
- Set 3pc completion on 51-floor climbs is expected to be uncommon
- Cursed resolution routes are event-gated
- Pack extraSkillSlots is unimplemented as an item field; Twin Soul covers the mutex family
- LIMITS.reflectionsPerAction is defined but unused; interceptAoe uses a combat-once counter

## Multiplayer

Climb V2 is solo. These scenarios use live combat_core + planEncounter/planBossEncounter partySize and TDC pads. They are not 51-floor co-op climbs.

These are not full multiplayer climbs. Climb V2 is solo.

| n | budget F10 | boss ATK F10 | boss HP F10 | trash ATK F10 | AOE share |
| --- | --- | --- | --- | --- | --- |
| 1 | 3.84 | 1.00 | 1.00 | 1.00 | 1.000 |
| 2 | 8.07 | 2.05 | 1.76 | 1.65 | 0.812 |
| 3 | 12.29 | 2.55 | 2.60 | 2.00 | 0.719 |
| 4 | 16.14 | 3.15 | 3.50 | 2.35 | 0.660 |

Focused 2/3/4-player trash fights:
| P | Floor | Pack | Bodies | Outcome | Rounds | Dmg taken | Gold |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | 6 | off | 4 | dead | 2 | 52 | 32 |
| 2 | 20 | off | 4 | dead | 2 | 65 | 28 |
| 3 | 6 | off | 5 | dead | 4 | 96 | 49 |
| 3 | 20 | off | 5 | dead | 1 | 68 | 49 |
| 4 | 6 | off | 6 | dead | 3 | 91 | 45 |
| 4 | 20 | off | 6 | dead | 1 | 66 | 106 |
| 2 | 6 | on | 4 | dead | 2 | 52 | 32 |
| 2 | 20 | on | 4 | dead | 2 | 65 | 28 |
| 3 | 6 | on | 5 | dead | 4 | 96 | 49 |
| 3 | 20 | on | 5 | dead | 1 | 68 | 49 |
| 4 | 6 | on | 6 | dead | 3 | 91 | 45 |
| 4 | 20 | on | 6 | dead | 1 | 66 | 106 |

Focused 2/3/4-player F10 bosses:
| P | Pack | Boss | Bodies | Outcome | Rounds | Boss HP | Dmg taken |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2 | off | elderwood | 2 | dead | 3 | 259 | 53 |
| 3 | off | elderwood | 2 | dead | 3 | 259 | 64 |
| 4 | off | elderwood | 2 | dead | 4 | 259 | 83 |
| 2 | on | elderwood | 2 | dead | 3 | 259 | 53 |
| 3 | on | elderwood | 2 | dead | 3 | 259 | 64 |
| 4 | on | elderwood | 2 | dead | 4 | 259 | 83 |

Focused shop/economy (stock is not party-scaled):
| P | Floor | Pack | Listings | Unaffordable | Mean price | Gold |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | 12 | off | 5 | 0 | 40.0 | 120 |
| 3 | 12 | off | 6 | 0 | 48.2 | 140 |
| 4 | 12 | off | 6 | 1 | 66.5 | 160 |
| 2 | 12 | on | 6 | 2 | 88.7 | 120 |
| 3 | 12 | on | 6 | 1 | 75.2 | 140 |
| 4 | 12 | on | 6 | 2 | 106.2 | 160 |

## Proposed follow-up (not implemented)

- Do not buff, nerf, or reclassify content from this report. Treat it as a baseline for later rarity/acquisition changes against the same seed bank.
- If F10 arrival stays low pack-on and pack-off, keep treating F10 as a vanilla gate — do not hide it with pack power.
- Expand any remaining high-variance combos to 96+ if this run used --quick or flagged fewer than the real outliers.
- Add a real multiplayer climb harness before claiming 2/3/4-player climb balance.
- If Unique/WRLD or set completion is flagged, change acquisition later in a dedicated task, then re-run this seed bank.
- If a mechanic test failed, inspect mutex/cap wiring in js/content_pack/engine.js before any catalog edits.
- LIMITS.reflectionsPerAction is currently unused by the engine (interceptAoe uses a combat-once counter). Do not silently wire it in a measurement task.
- The working-tree content-path UNRESOLVED gate is separate from this measurement; do not retune F10 or classes to green it.

## Raw artifacts

- `reports/content_pack_balance_measurement.json`
- `reports/content_pack_balance_raw.ndjson`
- `reports/content_pack_balance_seed_bank.json`
- `reports/content_pack_balance_seed_bank.md`
