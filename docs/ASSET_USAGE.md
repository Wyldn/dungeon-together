# NEW_ASSETS Usage Map

Reference for which free packs under `assets/img/NEW_ASSETS/` are wired into
the game, and which files remain unused (kept as source / future work).

Pipeline: `python tools/integrate_new_assets.py` converts idle strips into
`assets/img/enemies/{id}.png` and merges entries into `js/data/artmap.js`.
Gameplay lives in `js/data/enemies.js` and `js/data/events.js`.

---

## Animated packs (`tools/build_anim.py`)

A second pipeline stages **multi-state** packs (not just idle strips) from
`tools/spritestage/` into `assets/img/anim/` + `js/data/animmap.js`. The staging
dir is disposable — unzip the packs into it and re-run. It also cuts each hero's
flat menu strip into `assets/img/heroes/` and the NPC portraits into
`assets/img/npc/`, merging `HERO_ART` / `NPC_ART` into `artmap.js`.

| Sprite | Pack | Role mapping | Death? |
|--------|------|--------------|--------|
| `imp`, `demon_slime` | Tiny RPG Pack 02 | idle/attack01/attack02/hurt/death | yes |
| `demon_king` | boss_demon_slime FREE | idle/cleave/take_hit/death | yes |
| `mimic` | Mimic Animation Pack | idle/bite/tongue/hit/death + `reveal` intro | yes |
| `warrior` (HERO) | Knight Hero Platfomer | idle/attack01/attack02/hurt/**guard** | **no** — CSS fade |
| `viking` (HERO) | viking_axe_pack | idle/attack01/attack02/hurt/death | yes |
| `mage` (HERO) | blue-mage-free | idle only | **no** — pack has no attack/death |
| `cursed_knight` | FREE SAMPLE RPG Characters | idle(=walk)/attack01/attack02/hurt/death | yes |
| `crowned_revenant` | Hooded Knight Sprites | idle/attack/**powerup** (special) | **no** — CSS fade |

A role left unmapped simply doesn't play — the existing `.combatant.dying`
fade/sink covers sprites with no death frames, so a missing role is never fatal.

### Why `aligned_set()` exists

These packs draw each animation on its **own canvas** (the Knight idles at 22×24
but attacks at 40×30; the Hooded Knight idles at 100×100, attacks at 180×100 and
powers up at 100×180). `js/anim.js` plays one `fw × fh` per sprite, so states are
re-packed onto a single canvas: lined up by the first frame's alpha-bbox
centre-x + bottom-y, then cropped to the tight union of every frame.

Two gotchas the build handles, and which any new pack will hit:

- **`disp` scales off the idle BODY, not the canvas.** Canvases carry headroom
  for big attacks, so scaling by canvas height renders packs at wildly different
  body sizes.
- **`ox`** records how far the idle body sits from its canvas centre (the union
  grows toward the attack side — the Revenant's lands 40px left). `js/anim.js`
  translates it back so the sprite stays centred under its own HP bar.

Facing: combat draws enemies on the **left facing right** and the player on the
**right facing left**. Hero packs here already face left; `cursed_knight` is a
player-facing pack reused as an enemy, so `aligned_set(..., flip=True)` mirrors it.

### NPC portraits (MikAnimus NPC Pack)

Busts are trimmed and padded to a centred square, then shown on an event card in
place of the category emblem when the event carries an `npc:` field. Matched to
each event's own text:

| Event | NPC | Why |
|-------|-----|-----|
| `merchant` | `old_man` | "a figure in a patchwork cloak" |
| `street_performer` | `jester` | "**he** juggles skulls, chalices…" |
| `bard`, `bard_returns` | `woman` | "'I came here for material,' **she** says" |
| `wounded_adventurer` | `girl` | "A young climber… **Her** party left her" |
| `ghost_king` | `soldier` | armoured revenant in the ruins |

---

## Used — by enemy / location

| Enemy / art id | Role | Biome / floor | Source pack | Source file(s) |
|----------------|------|---------------|-------------|----------------|
| `rat` | Regular (pack) | Forest encounters; `wolf_ambush` event | Rat | `NoneOutlinedRat/rat-idle.png` |
| `slime` | Regular (pack) | Forest; summons for Putrid Prince; `slime_crown` event | FreeCharacters… | `Monster_Slime/.../Monster_Slime_Idle-Sheet.png` |
| `orc` | Regular | Forest; `orc_logging_camp`, `slime_crown` fail | Tiny RPG… Soldier&Orc | `Orc/Orc_Idle.png` |
| `dusk_lurker` | Elite | Forest; `orc_logging_camp` | Monster Creature… | `pixel-0078-*.png` |
| `vampire` | Elite (art fill) | Forest; `crimson_stranger` event | Monster Creature… | `pixel-0087-*.png` |
| `golem` | Elite (art refresh) | Ruins | Golems Free | `Golem_1/Blue/.../Golem_1_idle.png` |
| `wight` | Regular (art fill) | Ruins | Monster Creature… | `pixel-0071-*.png` |
| `horned_stalker` | Regular | Ruins; `void_stare` event | Monster Creature… | `pixel-0063-*.png` |
| `void_eye` | Elite | Ruins; `void_stare` event | Monster Creature… | `pixel-0077-*.png` |
| `frozen_soldier` | Regular (art refresh) | Frost | FreeCharacters… | `Human_Soldier_..._Idle-Sheet.png` |
| `yeti` | Elite (art fill) | Frost; `frost_revenant` event; also **Jarl** alt-boss art | Monster Creature… | `pixel-0069-*.png` |
| `void_specter` | Regular | Frost | Monster Creature… | `pixel-0098-*.png` |
| `mire_abomination` | Elite | Swamp; `sunken_bell` fail combat | Monster Creature… | `pixel-0064-*.png` |
| `magma_golem` | Elite | Hell | Golems Free | `Golem_1/Orange/.../Golem_1_idle.png` |
| `eye_horror` | Elite | Hell | Monster Creature… | `pixel-0056-*.png` |
| `crimson_wretch` | Regular (pack) | Hell; `slag_patrol` event | Monster Creature… | `pixel-0088-*.png` |
| `slag_knight` | Elite | Hell; `slag_patrol` event | Monster Creature… | `pixel-0092-*.png` |
| `sin_eater` | Regular (art fill) | Hell | Monster Creature… | `pixel-0091-*.png` |
| `mimic` | Special (art refresh) | Chest mimic fights | Mimic Animation Pack | `Sprites/Idle.png` |
| `demon_slime` | Phase-2 art only | Swamp **alt boss** evolve | boss_demon_slime FREE | `01_demon_idle/demon_idle_*.png` |
| `heartwood` (Thornbeast) | Alt boss F10 | Forest gate | Monster Creature… | `pixel-0102-*.png` (`thornbeast.png`) |
| `ossuary_king` (Void Oracle) | Alt boss F20 | Ruins gate | Monster Creature… | `pixel-0077-*.png` (shared sheet w/ void_eye) |
| `jarl_whitegrave` | Alt boss F30 | Frost gate | Monster Creature… | `pixel-0069-*.png` (shared sheet w/ yeti) |
| `bogmother` (Putrid Prince) | Alt boss F40 | Swamp gate — **multi-phase** slime → demon_slime | FreeCharacters slime + boss_demon_slime | idle sheets above |
| `arch_tormentor` (Arch-Cyclops Vex) | Alt boss F50 | Hell gate | Monster Creature… | `pixel-0096-*.png` (`flame_cyclops.png`) |
| `ashen_sovereign` (Spike Sovereign) | Alt boss F51 | Throne | Monster Creature… | `pixel-0101-*.png` (`spike_sovereign.png`) |
| Forest biome BG | Backdrop | Floors 1–10 | parallax_forest_pack web | `v2/layers/{back,middle,front}.png` composited → `assets/img/bg/forest.png` |

### New events that reference these enemies

| Event id | Biome | Combat |
|----------|-------|--------|
| `slime_crown` | forest | `slime`×3 / fail: `slime`+`orc` |
| `orc_logging_camp` | forest | `orc`×2+`bandit` or `dusk_lurker`+`orc` |
| `void_stare` | ruins | `void_eye`+`horned_stalker` |
| `slag_patrol` | hell | `slag_knight`+`crimson_wretch`×2 |
| `wolf_ambush` (updated) | forest | `wolf`×2+`rat`×2 |
| `sunken_bell` fail (updated) | swamp | `leech`×2+`mire_abomination` |

### Multi-phase note

`bogmother` / Putrid Prince uses `phases: true` plus:
`phaseArt: 'demon_slime'`, `phaseName`, `phaseGlyph`, `phaseSpecials`, `phaseText`.
At ≤50% HP the combat sprite swaps from the baby slime strip to the demon-slime idle strip (`js/combat.js`).

---

## Art prepared but not assigned to a live enemy

These sheets exist under `assets/img/enemies/` and in `ENEMY_ART`, but have
**no** `ENEMIES` / boss entry yet (easy to wire later):

| Art id | Source | Notes |
|--------|--------|-------|
| `void_cultist` | `pixel-0067-*.png` | Purple cultist-like aberration |
| `blood_fiend` | `pixel-0074-*.png` | Red/black fiend |
| `ash_beast` | `pixel-0081-*.png` | Ashy beast |
| `ember_maw` | `pixel-0082-*.png` | Ember-mouthed beast |
| `throne_guard` | `pixel-0094-*.png` | Good throne escort candidate |

---

## Unused — still only in `NEW_ASSETS/`

### Entire packs / categories not consumed by gameplay

| Pack | Why unused |
|------|------------|
| Most **non-idle** animations (walk, attack, hurt, death, block, jump, hide, reveal, cleave, …) | Engine only plays **horizontal idle strips** in combat |
| **With_Shadows / Only_Shadows** variants (FreeCharacters, Orc) | No_Shadows / plain versions used instead |
| **White_Swoosh_VFX** golem variants | No_Swoosh idle used |
| **OutlinedRat** | NoneOutlined idle used |
| Demon slime **walk / cleave / take_hit / death** frames + GIFs + full spritesheet | Only idle frames stitched for phase-2 |
| FreeCharacters / Tiny RPG **Aseprite** sources | Source only |
| parallax_forest **v1** layers, PSD, ASE, PDFs | v2 layers used for forest BG |
| `__MACOSX` junk from zip extraction | Ignore / safe to delete |

### Still missing combat art

| Enemy id | Status |
|----------|--------|
| `myconid` | No fitting sprite in NEW_ASSETS — still emoji glyph fallback |

### Duplicate staging

`assets/img/Monster Creature sprites (pack 1 by batareya)/` may also exist at the
`img/` root (copy of the pack). Canonical source for the pipeline is
`assets/img/NEW_ASSETS/Monster Creature sprites (pack 1 by batareya)/`.

---

## Re-running the pipeline

```bash
python tools/integrate_new_assets.py
node tools/test.js
```

Do **not** hand-edit frame metadata in `artmap.js` for these ids unless you
also change the PNGs — the integrator overwrites the matching `ENEMY_ART` keys.
