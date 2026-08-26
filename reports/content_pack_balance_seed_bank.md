# Content-pack balance seed bank

- Id: `cp-balance-g7-20260825`
- Starting commit: `cf607bcd3c941c7840fad42da5ed6253bbcc7d85`
- Base seed: `202608251`
- Formula: `mix32(baseSeed, classIndex, bloodlineIndex, seedIndex) >>> 0`
- Initial n: 24 per class×bloodline
- Expansion n: 96 (same sequence, indices 0–95)
- Identical seeds across pack-off and pack-on: true

Classes: warrior, mage, archer, rogue, priest, monk, warlock, bard, necromancer, spellsword, viking

Bloodlines: human, elf, orc, dwarf, halfling, tiefling, beastfolk, dragonkin

First seed per class (human, index 0) is in the JSON dump. Do not regenerate this bank if later rarity work needs a matched comparison.
