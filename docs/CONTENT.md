# Content Authoring Guide

Everything gameplay-defining is data. Most contributions never touch the engine.
Balance constants live in one place: [`js/data/config.js`](../js/data/config.js).

## Add a class
`js/data/classes.js` → add to `CLASSES`:
```js
bard: {
  id: 'bard', name: 'Bard', epithet: '...', accent: '#hex',
  resource: { name: 'Verve', color: '#hex' },   // class resource identity
  weapons: ['sword', 'dagger'],                  // compatible weapon types
  startWeapon: 'runed_dagger_worn',              // must exist in items.js + match a type
  base: {...}, roll: {...},                      // hidden stat ranges
  startSkills: ['id×4'],                         // must exist in skills.js
  growthBias: ['lk', 'lk', 'dex', 'wis'],        // level-up stat weighting
}
```
Then give it: 2 immediate subclasses + 1 deeper branch each + 1 secret (see below),
an SVG icon in `js/icons.js` (optional — falls back to a glyph), and starting-weapon
compatibility. `tools/test.js` enforces all of this — run it.

## Add a subclass
`js/data/classes.js` → `SUBCLASSES`:
```js
skald: {
  id: 'skald', name: 'Skald', parent: 'bard', tier: 1,   // tier 1 = level-6 choice
  blurb: 'shown on evolution', hint: 'shown on the choice card',
  bonus: { str: 2, hp: 10 }, skill: 'battle_hymn',        // signature skill id
  next: 'saga_lord',                                      // its tier-2 deeper branch
}
```
Secret subclasses add `secret: true` and `secretCond: run => ...` — the condition
is **never shown to players**; the option simply appears at level 6 when earned.

## Add a race / race promotion
`js/data/races.js`. Races modify stats/hp/mp, initiative, fame gain, charge
triggers, resistances. Every race needs a `promotion` block; promotion is
triggered by events with the `promoteRace: true` outcome effect.

## Add an origin
`js/data/origins.js`. An origin is one playable event card (title, text,
choices) resolved before Floor 1, plus a menu blurb. Choices use the standard
outcome format.

## Add equipment
`js/data/items.js`. Slots: `weapon` (needs `wtype`), `helmet`, `chest`, `legs`,
`boots`, `accessory` (three ring slots exist). Passive props are picked up by
`character.js#derived` automatically (`str/dex/int/wis/lk, def, crit, dodge,
lifesteal, goldMult, xpMult, dmgMult, dmgTakenMult, initiative, fameGainMult,
startCharge, revive, deathward, reveal:'ranks'|'exact'`…).

**Affixes:** Random loot/shops roll affixes from `js/data/affixes.js` (weapon /
armor / accessory pools). Power is gated by `itemPowerCap` × TDC `itemSlack` —
affixes that would breach the budget are skipped. Named `exclusive` / `unique`
items never roll affixes. Affixed drops are stored as instances in
`run.gearBag` (ids look like `steel_blade__a1b2c3`).

## Add a skill
`js/data/skills.js`. Prefer the component layer in `js/data/skillcomponents.js`:
```js
import { COMP, composeSkill } from './skillcomponents.js';
my_skill: composeSkill(
  { id: 'my_skill', name: 'My Skill', class: 'rogue', fx: 'slash', desc: '…' },
  COMP.cost(16), COMP.charge(1), COMP.target('one'),
  COMP.dmg(110, 'dex'), COMP.poison(0.4),
),
```
`cost` (class resource) + `charge` (Battle Charge segments, 0–6). AOE
(`target:'all'`) must cost ≥3 charge — the test suite enforces it.
Effects: `power/stat` (or `stat:'best'`), `critBonus, ignoreDef, execute,
poison/burn/freeze/stun, lifesteal, healPct, shield, buff, selfHpCost, guard`.

## Add an event
`js/data/events.js`. Required: `id`, `biome` (`'any'` or a biome id),
`category` (drives the face-down card: combat/mystery/merchant/recovery/
training/appraisal/equipment/social/advancement/dangerous/unknown), `type`,
`glyph`, `title`, `text`, `w` (draw weight), `choices`.

Optional: `tags` (see below), `once`, `cond(state)`,
`affinity: {classes, races, underdog}` (sparkle eligibility), `comeback: true`
(weighted ×3 for underdog starts), `mimicChance`, `resolution: 'random'`.

**Event tags** (modifiers, not story generators): defaults live in
`js/data/eventtagmap.js`; rules in `js/data/eventtags.js`. Tags nudge draw
weight and lightly tint outcomes (e.g. `gamble` softens DCs for underdogs,
`recovery` boosts heal % slightly). Author the card text by hand; attach tags
like `mentor`, `curse`, `fame-test`, `class-specific`, `sigil`, `spark-for-player`.

**Milestones:** reuse `js/data/milestones.js` (`Milestone.fame(25)`,
`Milestone.flag('defiler')`, `Milestone.all(...)`) for secret gates and
`secretCond` helpers.

Outcome effects (composable): `text, gold, goldPct, hp, hpPct, maxHp, mana,
manaPct, fullHeal, fullMana, fame, xp, statUp, statUpRandom, itemRoll,
relicRoll, consumable, item, useItem, upgradeWeapon, flag, clearFlag, sigil,
escape, combat:{enemies:[ids]}, chest, revealFloors, appraisal:'partial'|'full',
promoteRace, randomOutcome:[...]`. Stat checks: `roll: {stat, dc, bonusFlag?,
penaltyFlag?}` with `success`/`fail` outcomes. Requirements on choices:
`req: {stat/min, class, gold, fame, flag, notFlag, item}`.

**House rules:** never reveal exact stat gains in text ("Something in you grows
stronger"), never leak the player's numbers in hints, and sanity does not exist.

## Add an enemy
`js/data/enemies.js`. Fields: stats (`hp, atk, def, spd` — spd is the initiative
stat), `gold: [lo,hi]`, `xp`, traits (`pack, elite, caster, regen, lifesteal,
poison/burn/freeze` chances), `intelligent: true` for bribery eligibility, and
`specials` for Battle Charge behavior:
```js
specials: [{ at: 3, name: 'Skull Rattle', mult: 1.5, aoe: false, desc: 'telegraph text' }]
```
`at` = charge threshold (auto-telegraphed one segment early), `mult` = damage
multiplier, plus `aoe`, `stun`, `poisonSure`, `burnSure`, `freezeSure`, `heal`.

## Add a boss
Same shape in `BOSSES`, keyed by floor. Give it ≥2 specials (mid + max charge),
`chargeGain` for its charge economy, an identity-appropriate `spd` (slow golems,
fast dukes), and `intro`/`taunt` lines. Mechanics: `summons`, `heads`, `phases`,
`chargeOnPhase`.

**Phase evolve (optional):** with `phases: true`, set `phaseArt` (an `ENEMY_ART`
key), plus optional `phaseName` / `phaseGlyph` / `phaseSpecials` / `phaseText`.
At ≤50% HP the sprite (and optional identity) swap — used by the Putrid Prince
slime → demon-slime fight. See `docs/ASSET_USAGE.md`.

## Free asset packs
Drop packs in `assets/img/NEW_ASSETS/`, then run
`python tools/integrate_new_assets.py` to build idle strips. Usage ledger:
[`docs/ASSET_USAGE.md`](ASSET_USAGE.md).

## Balance — encounter-first

Do **not** tune HP, enemy count, Guard, or revival independently. Balance complete
encounters around action economy, expected rounds, damage taken, and resource spend.

| Layer | File | Role |
|-------|------|------|
| Tension dials | [`js/data/config.js`](../js/data/config.js) | Guard (=30%), revival (=30%), recovery, economy |
| Climb curve | [`js/data/tdc.js`](../js/data/tdc.js) | Floor power, biome scale, soft caps, budget knobs, boss RTK bands |
| Encounter math | [`js/data/balance.js`](../js/data/balance.js) | Threat budgets, mechanic costs, item power, validators, event history weights |

**Co-op:** party size increases an *encounter budget*. Bodies are bought first;
leftover budget becomes a capped HP pad — never both large HP mults *and*
guaranteed extras.

**Validators** (in `tools/test.js`) reject over-budget items and stacked loadouts.
Expand content only after `node tools/test.js` is green.

## Verify
```bash
node tools/test.js   # data/logic + balance validators
node tools/sim.js    # combat sims, P25/P50/P75 power, boss RTK
```
