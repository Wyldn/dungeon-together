# Handoff: Ascension — UI / Design

## Overview
*Ascension* is an 8-bit dungeon-crawler RPG. This package documents the **complete front-end design** for the game's core screen flow:

**Gate → Character Creation → Appraisal (Awakening) → Combat ⇄ Event Travel Map** (plus a **Character Sheet** overlay reachable from Combat).

The game logic is described as largely built; this handoff is the **UI/design specification** — recreate these screens natively in the game's own codebase/engine using the exact visual values below.

## About the Design Files
The single file in this bundle (`Ascension.dc.html`) is a **design reference created in HTML** — a working prototype demonstrating the intended look, layout, and interactions. It is **not production code to lift directly**. The task is to **recreate this UI inside the game's existing environment** (Unity / Godot / a web front-end / etc.), using that project's established rendering, layout, and animation patterns. Treat the HTML/CSS values here as the source of truth for the *visual* spec and re-implement *behaviour* natively.

The prototype is one self-contained "Design Component" that swaps between screens via an internal `screen` state; a small dev nav (bottom-left: GATE / CREATE / AWAKEN / COMBAT / MAP) exists only for previewing and is **not** part of the shipping UI.

## Fidelity
**High-fidelity (hifi).** Final colours, typography, spacing, iconography, and interaction timing are specified — recreate to match. Intentional placeholders are the **art slots** (backgrounds, portal, character/monster/party sprites): the prototype shows empty drop-zones where the game supplies its own 8-bit art.

---

## Shared design system (applies to every screen)

### Canvas & scaling
- Fixed **1280 × 720** design frame, letterboxed and uniformly scaled to fit the viewport: `scale = min(vw/1280, vh/720)`, centred. All pixel values below are in this space.
- Global `image-rendering: pixelated` (crisp 8-bit scaling). **No border-radius anywhere** except deliberately circular elements (the Gate portal). Borders are 1–3px solid.
- Every screen is a full-bleed background **art slot** + a darkening scrim for legibility, with UI layered on top.

### Palette
- **Base bg:** `#0a0618`; ambient radial `#1a1236 → #0a0618`.
- **Panel gradient:** `linear-gradient(160deg, rgba(34,24,58,.9x), rgba(16,10,30,.9x))`.
- **Gold (primary accent / confirm buttons):** `#e8b64a`; button gradient `linear-gradient(180deg,#ffe6a8,#e8b64a)`; on-gold text `#2a1c0b`; glow `rgba(232,182,74,.5)`; borders `#6a5528` (mid) / `#4a3c2a` (dark).
- **Teal (secondary / "advance" buttons):** `#4fd6c0`, hi `#8fe6d8`; button gradient `linear-gradient(180deg,#8fe6d8,#4fd6c0)`; on-teal text `#04121e`; glow `rgba(79,214,192,.5)`; teal text `#8fd8cc`.
- **Text:** headings `#f7ecce`; body `#ece0c4`; muted `#b3a683`; dim `#a48f66`; faint/ghost `rgba(160,143,102,.55)`.
- **Purple (arcane/portal):** `#9b6cff`. **Monster/red:** `#e0564e / #ff3b52 / #ff8a9c`. **HP green:** `#2fd66f`. **MP blue:** `#2e6bff / #6ab6ff`. **Focus yellow:** `#ffcf4d`.
- **Rank colours** (used by Appraisal + Character Sheet): F `#9aa0ad`, E `#7fd07f`, D `#5fd6c0`, C `#5ba7ff`, B `#a678ff`, A `#ff6bbf`, S `#ffd257`, EX `#ff8a3c`, WRLD `#fff3d6`.
- **Event colours** (Map/Combat): see the Event Types table.

### Typography
- **"Press Start 2P"** — display, labels, buttons, tags, numerals-as-labels. Sizes in use: 7, 8, 9, 10, 11, 12, 13, 16, 20, 40px. Labels carry 1–8px letter-spacing.
- **"VT323"** — body copy, names, flavour, large numerals. Sizes in use: 13–72px.
- Import: `https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap`. Substitute the project's own pixel display + pixel body fonts if it already ships some.

### Motion
- Standard easing `cubic-bezier(.2,.8,.2,1)`.
- **Screen transitions** use a full-frame radial **flash** (`radial-gradient(circle,#fff5e0,#ffd782 40%,#9b6cff 82%)`): opacity 0→1 over ~0.4s, swap screen at peak, fade out ~0.08s later.
- Named keyframes: `pulse` (glow breathing, 3.6s), `blink` (CTA, step-end 1.6s), `float`, `rise` (content enter, 0.5s), `flick` (hint text), `shimmer`/`glowb` (brightness pulse).

---

## Screens / Views

### 1. Gate (title / entry)
**Purpose:** Title screen; the player steps through the Gate to begin.
- Full-bleed background art slot + gold radial glow `radial-gradient(ellipse 60% 50% at 50% 46%, rgba(232,182,74,.12), transparent 72%)`.
- **Stone-arch portal**, centred (region 500×540): a blurred glow circle (380px, `radial-gradient(circle, rgba(155,108,255,.4), rgba(79,214,192,.18) 55%, transparent 74%)`, `blur(8px)`, `pulse` 3.6s) behind a **circular portal art slot** 340px, `border:3px solid #e8b64a`, `box-shadow:0 0 28px rgba(232,182,74,.4)`.
- **Title** "ASCENSION" — Press Start 2P **40px**, letter-spacing 4px, `#f7ecce`, `text-shadow: 0 4px 0 #2a1c0b, 0 0 26px rgba(232,182,74,.7)`. Subtitle "THE GATE AWAITS" — Press Start 2P 12px, letter-spacing 8px, `#d8b06a`.
- **CTA** "▶ CLICK TO ENTER" — Press Start 2P 16px, `#2a1c0b` on gold gradient, padding `16px 34px`, `blink` animation. Below: "step through and be Awakened" — VT323 20px, `#a48f66`.
- **Interaction:** click CTA → flash → Character Creation.

### 2. Character Creation (Race then Class)
**Purpose:** Two-step selection — pick a Race, then a Class.
- Background art slot + vertical scrim `linear-gradient(180deg, rgba(10,6,24,.5), rgba(10,6,24,.82))`.
- **System header** (top:24, width 640, centred): border `2px solid #e8b64a`, panel bg, glow. "[ SYSTEM ]" Press Start 2P 11px `#e8b64a`; prompt VT323 24px `#f7ecce` — race step "Choose your Race, Awakened.", class step "Choose your Class."
- **Step dots** (top:118): Press Start 2P 9px — "RACE › CLASS". Active `#e8b64a` w/ glow, inactive `#4a3c2a`.
- **Centre showcase** (top:150, height 330): a 300×300 framed **art slot** (border `3px solid #e8b64a`, `box-shadow 0 0 24px`, glow radial `pulse` behind) with a name plate below (Press Start 2P 13px `#f7ecce`, bg `#1a1030`, border `2px #e8b64a`). To its right a text box (width 250, `border-left:3px solid {accent}`, bg `rgba(28,20,48,.72)`): tag (Press Start 2P 10px `{accent}`) + blurb (VT323 21px `#e0d3b4`). Switching selection cross-fades this block (opacity/translateY, ~165ms).
- **Sliding option rail** (bottom:96): ◄ / ► arrows (46×46, border `2px #6a5528`) flank a 664px window; the rail translates so the selected card is centred. Each **card** is 150px: a 56×56 emblem (first letter, Press Start 2P 22px on a `linear-gradient(135deg,{color},#ffffff40)` chip bordered `{color}`), name (Press Start 2P 11px), tag (VT323 16px `{color}`). **Active card:** border `{color}`, bg `rgba(40,28,66,.92)`, `translateY(-8px) scale(1.04)`, glow; **inactive:** dim `opacity .55`, `scale(.94)`. Transition `.3s cubic-bezier(.2,.8,.2,1)`.
- **Confirm bar** (bottom:24): "◄ BACK" (shown on Class step, dim bordered) + primary gold button — race step "CONFIRM {RACE}", class step "ENTER THE MONOLITH ▶".
- **Content:**
  - Races: **Human** — ADAPTABLE `#e8b64a` — "Boundless adaptability. No innate weakness, no ceiling to growth. The Gate favors the unwritten." · **Elf** — ARCANE `#5fd6a0` — "Born attuned to mana. Swift, perceptive and long-lived — the current of magic runs through their blood." · **Dwarf** — ENDURING `#d98a4a` — "Stone-forged and unbreakable. Masters of the forge whose bodies endure what would shatter others."
  - Classes: **Warrior** — VANGUARD `#e0564e` · **Archer** — HUNTER `#5fd6a0` · **Mage** — ARCANIST `#9b6cff` · **Rogue** — SHADOW `#c060d0` (blurbs in file).
- **Interaction:** confirm on Race → advance to Class; confirm on Class → flash → Appraisal.

### 3. Appraisal / Awakening ("The Monolith of Measure")
**Purpose:** A press-and-hold ritual that reveals the hero's potential rank range.
- Background art slot + scrim.
- **Title** "THE MONOLITH OF MEASURE" — Press Start 2P 20px, letter-spacing 4px, `#f7ecce`, teal text-shadow. Subtitle VT323 22px `#8fd8cc` — before: "Attune to gauge your potential"; after: "Awakening sealed. This is your beginning."
- **Crystal** — a 320×400 `<canvas>` (top:150) rendered live: a faceted diamond that **fills as you press-and-hold** (charge 0→100). Fill gradient bottom→top `#4fd6c0 → #9b6cff → white`, animated rising sparkles, pulsing teal outline glow. Release before full drains it; reaching 100 completes.
- **Hold hint** (before completion): "press & hold the crystal to measure your potential" — VT323 20px `#8fd8cc`, `flick` animation.
- **Reveal** (on completion): "POTENTIAL RANGE" (Press Start 2P 9px `#a48f66`) above two rank glyphs (Press Start 2P **44px**, coloured by rank, `text-shadow 0 0 18px currentColor`) joined by an em-dash; `shimmer`. Then an italic line "Your true rank is not given — it is earned within." (VT323 19px `#a48f66`) and a teal button "DESCEND INTO THE FOREST ►".
- **Interaction:** hold crystal → reveal potential → button → flash → Combat.

### 4. Combat
**Purpose:** Turn-based battle screen (party vs. monster).
- Background art slot (`combat-bg`) + radial vignette `radial-gradient(ellipse 85% 85% at 50% 45%, transparent 55%, rgba(6,4,14,.55))` and a bottom fade.
- **Top bar** (top:14): centre **floor plate** (border `2px #7a6a94`, panel bg) — "VERDANT FOREST" Press Start 2P 9px `#c6b3e6`, "FLOOR 1 / 50" Press Start 2P 13px `#f7ecce` (slash `#7a6a94`). Right column: **hero plate** (border `2px #e8b64a`) — hero name Press Start 2P 13px, hero title VT323 18px `#d8b06a`; below it "◈ CHARACTER" (gold button → opens Character Sheet) and "◈ TRAVEL ON ▶" (teal button → Event Map).
- **Monster** (top-left, x:70 top:118): 260×200 sprite slot with red drop-shadow + ground shadow. Name Press Start 2P 14px `#ffd7dd`; "Lv.N" VT323 18px `#ff8a9c`. Then **HP / MP / FOC** bars — labels Press Start 2P 8px (width 28), **bar track height 8px** (thin) with 1px themed border + 1px inner pad: HP `linear-gradient(90deg,#ff3b52,#ff7a5a)`, MP `#2e6bff→#7fbfff`, FOC = 6 pips (filled `#ffcf4d` w/ glow, empty dim).
- **Party** (bottom-right, bottom:180 right:48): up to 3 members, each 150px wide — 118×150 sprite slot, name Press Start 2P 9px centred, then HP/MP/FOC bars (labels 7px width 22, tighter gaps, **track height 8px**; party HP green `#2fd66f→#9ff4a0`).
- **Combat log** (bottom:150 left:30): VT323 21px `#f2e6cc` with heavy text-shadow, floating (no box).
- **Action menu** (bottom:30, centred, floating — no dock):
  - Root: three large buttons **FIGHT** (`#e0564e`), **ITEMS** (`#5fd6a0`), **FLEE** (`#e8b64a`) — Press Start 2P 13px, coloured border, panel bg, padding `18px 34px`.
  - Skills (from FIGHT): 2-col grid, each ≥230px — skill name VT323 20px + MP cost Press Start 2P 8px `#6ab6ff`, border `#6a5528`.
  - Items (from ITEMS): 2-col grid, green-bordered — item name VT323 20px + "×qty" `#7fe6a0`.
  - Flee: warning line "The Gate does not release its guests so easily…" (VT323 22px `#ffb46b`) + "STAND & FIGHT" / "ATTEMPT FLEE" buttons.
  - A "◄ BACK" chip returns from any submenu to root.
- **Content:** skills are class-specific (Warrior: Cleave, Shield Wall, Reckless Blow, Bloodrush; Archer: Piercing Shot, Hawk Eye, Rapid Volley, Arrow Rain; Mage: Firebolt, Frost Nova, Arc Lightning, Mana Shield; Rogue: Backstab, Envenom, Vanish, Fan of Knives — each with MP cost + description in file). Items: Minor HP Potion ×3, Mana Draught ×2, Antidote ×1, Smoke Bomb ×1.

### 5. Character Sheet (overlay)
**Purpose:** Full character detail; opened by "◈ CHARACTER" in Combat, dismissed by clicking the backdrop or ✕.
- Backdrop `rgba(4,2,10,.84)`; modal 680px wide, max-height 90% (scrollable), border `2px #e8b64a`, panel bg, `box-shadow 0 0 40px rgba(232,182,74,.35)`, padding `24px 28px`, `rise` in.
- **Header:** "{Hero} — {Title}" Press Start 2P 16px `#f7ecce`; "Floor 0 · 0 kills · Origin: The Gate" VT323 19px `#a48f66` italic; ✕ close.
- **Two-column grid (30px gap):**
  - Left: **STATS** heading + appraisal pill (APPRAISED/UNAPPRAISED). Stat rows (name VT323 21px `#d8cbae`, value Press Start 2P 12px coloured by rank), divider `1px #2a2140`. Stat names: HP→Vitality, STR→Strength, DEX→Dexterity, INT→Intelligence, WIS→Wisdom, LK→Luck. "Growth potential" row shows the low—high rank range. Then **EQUIPPED** — 8 slots (Weapon, Helmet, Chestplate, Leggings, Boots, Accessory I–III), each a dashed-icon + "— empty —" + a slot pill.
  - Right: **TECHNIQUES (n)** — the class skills as cards (name VT323 20px + MP-cost pill + description). **CONSUMABLES** — items with qty + description + "USE" pill. **RELICS** — "None yet." (italic).

### 6. Event Travel Map  *(the newest screen)*
**Purpose:** Between-events navigation. The player's current location sits centre ("YOU ARE HERE"); 2–4 event choices branch off along dotted paths; picking one recentres it, branches fresh choices, and drops the prior stop into a history trail. Faint hint nodes tease what's further ahead.

Two live-switchable layouts (top-right toggle):
- **Constellation** — organic scattered choices; history as a horizontal breadcrumb below the current card.
- **Ascent** — choices in a symmetric fan arc above; history as a vertical timeline on the left.

**Shared elements:**
- Background art slot (`map-bg`, **the game supplies forest/biome art here**) + scrim `radial-gradient(ellipse 92% 82% at 50% 46%, rgba(10,6,24,.34), rgba(6,4,14,.84))`.
- **Header** (x:24 y:18): "VERDANT FOREST" Press Start 2P 13px `#f7ecce` (text-shadow `0 2px 0 #2a1c0b`); "Choose your path, Awakened — step N" VT323 20px `#8fd8cc`.
- **Layout toggle** (top-right): two segments (CONSTELLATION / ASCENT) in a `2px #6a5528` border; active `#e8b64a`/`#2a1c0b`, inactive `rgba(20,13,38,.7)`/`#c9b58a`; Press Start 2P 9px.
- **Connector SVG** (full-frame, `pointer-events:none`, z 4, behind cards): choice paths = dashed line current→choice, `stroke={eventColor}`, opacity 0.34, width 2, dasharray "2 8", round caps; hint paths = `rgba(160,143,102,.22)`, width 1.5, dasharray "3 7".

**Geometry:**
- *Constellation (A):* current centre `(640,466)`. Choice `i/n`: `cx=200+880*(i/(n-1))+jitterX`, `cy=128+(i%2?66:0)+jitterY*0.5`. Hints: row at `cy=44`, `cx=300+680*(i/(h-1))`. History: 48×58 cards, breadcrumb at `y:612`, gap 12, oldest→newest L→R.
- *Ascent (B):* current centre `(640,540)`. Choices on arc `R=340`, angle `-140°→-40°`: `cx=640+R·cos a`, `cy=540+R·sin a`. Hints: arc `R=482`, `-124°→-56°`. History: 56×64 cards, vertical column `x:42`, newest `y:520`, each older +74px up.

**Choice Card — compact vs expanded (hover):**

| | Compact | Expanded (hover) |
|---|---|---|
| Size | 134 × 170 | **232 × 350** |
| Border | `2px solid #4a3c2a` | `2px solid {eventColor}` |
| Shadow | `0 6px 18px rgba(0,0,0,.5)` | `0 14px 44px rgba(0,0,0,.6), 0 0 28px {eventGlow}` |
| Icon | 40px | 64px |
| Name | VT323 18px | VT323 27px |
| Extra | — | risk row + flavour + "▶ TRAVEL HERE" |

- Body bg `linear-gradient(165deg, rgba(34,24,58,.96), rgba(16,10,30,.97))`, `overflow:hidden`.
- Art zone: event-tinted radial + diagonal pixel hatch `radial-gradient(circle at 50% 42%,{eventGlow},rgba(10,6,24,.15) 70%), repeating-linear-gradient(45deg,rgba(0,0,0,.18) 0 6px,transparent 6px 12px)`; centred type icon (VT323, `{eventColor}`, glow).
- Footer: tag (Press Start 2P 8px `{eventColor}`) + name (VT323 `#f7ecce`).
- Expanded adds: **risk row** (label + 5-pip meter; filled `#ff6b5a`/`#8a3a2e`, empty `rgba(70,60,40,.55)`/`#3a3320`; filled count = risk 0–5, `?`=0), **flavour** (VT323 16px `#b3a683`), **CTA** "▶ TRAVEL HERE" (gold).
- **z-index:** compact 12 / hovered 40, **and the entire choice layer lifts to z 60 (above the current card at z 20) whenever any card is hovered**, so an overlapping expanded card always renders in front; it drops back to z 12 on mouse-out.
- Transition: `left/top/width/height` all `0.3s cubic-bezier(.2,.8,.2,1)` (grow-in-place on hover; re-flow on layout switch).
- **Risk mapping:** 0→"SAFE" `#5fd6a0` · 1→"MINOR" `#ffd257` · 2–3→"RISKY" `#ffb46b` · 4–5→"DEADLY" `#ff6b5a` · `?`→"UNKNOWN" `#a678ff`.

**Current Card ("YOU ARE HERE"):** width 212, positioned by centre with `transform:translate(-50%,-50%)`, z 20, `transition:top .42s`. Label "◆ YOU ARE HERE ◆" (Press Start 2P 8px `#a48f66`). 150px framed art (border `2px {eventColor}`, `box-shadow 0 0 30px {eventGlow}`, icon 72px). Info panel: tag + name (VT323 26px) + flavour, then a **contextual action button** — battle events (combat/elite/boss) show a gold "⚔ ENTER BATTLE / FACE THE ELITE / CHALLENGE BOSS ▶" → Combat; non-battle events show a teal button ("⌂ REST & RECOVER", "◈ CLAIM LOOT", "⚖ BROWSE WARES", "✦ RECEIVE BOON", "? INVESTIGATE") → sets an in-place italic resolution note.

**Hint Node:** 44×52, `1px dashed rgba(160,143,102,.4)`, bg `rgba(20,13,38,.4)`, dim icon (VT323 22px `rgba(160,143,102,.55)`), z 6, non-interactive.

**History Card:** border `1px {eventColor}66`, panel bg, centred icon (VT323 ~20–22px `{eventColor}`), opacity ramps `~0.34→~0.86` by recency, non-interactive; last 7 shown (state keeps 8).

---

## Event Types (Map & Combat content)
Icons are unicode glyphs in the prototype — swap for real 8-bit sprites in-engine.

| Type | Tag | Icon | Colour | Glow | Risk | Example names |
|---|---|---|---|---|---|---|
| combat | COMBAT | ⚔ | `#e0564e` | `rgba(224,86,78,.5)` | 2 | Boar Pack, Goblin Ambush, Feral Wolves, Bandit Scouts |
| elite | ELITE | ☠ | `#ff8a3c` | `rgba(255,138,60,.5)` | 4 | Dire Alpha, Corrupted Knight, Stone Sentinel |
| treasure | TREASURE | ◈ | `#ffd257` | `rgba(255,210,87,.5)` | 0 | Hidden Cache, Fallen Adventurer, Gilded Chest |
| mystery | UNKNOWN | ? | `#a678ff` | `rgba(166,120,255,.5)` | `?` | Strange Signal, Veiled Door, ??? |
| rest | REST | ⌂ | `#5fd6a0` | `rgba(95,214,160,.5)` | 0 | Safe Hollow, Old Campfire, Quiet Spring |
| merchant | MERCHANT | ⚖ | `#5ba7ff` | `rgba(91,167,255,.5)` | 0 | Wandering Pedlar, Gate Broker, Masked Trader |
| blessing | SHRINE | ✦ | `#8fd8cc` | `rgba(143,216,204,.5)` | 1 | Forgotten Shrine, Mana Font, Ancestor Stone |
| boss | BOSS | ✷ | `#ff4b6b` | `rgba(255,75,107,.55)` | 5 | Warden of Floor I, The Root Tyrant, Elder of the Grove |

Flavour lines (prototype copy) are in the file, one per type.

---

## Interactions & Behavior (flow-wide)
- **Screen flow:** Gate → Creation (Race→Class) → Appraisal → Combat. From Combat: "◈ TRAVEL ON ▶" → Event Map; "◈ CHARACTER" → Character Sheet overlay. From the Map: battle events → Combat (passing the event name as the foe, uppercased, seeding the log "<NAME> bars your way!"); non-battle events resolve in place. All screen changes use the radial **flash** transition (~0.4s).
- **Creation:** arrow/rail selection cross-fades the centre showcase; confirm advances the step.
- **Appraisal:** press-and-hold charges the crystal; full charge reveals the potential range.
- **Map hover:** choice grows 134×170 → 232×350 from its centre (clamped ≥14px inside frame), info fades in, choice layer lifts above the current card.
- **Map pick:** chosen → new current; previous current → history (keep 8 / show 7); `step++`; regenerate 2–4 choices + 2–3 hints; clear hover/note.
- **Map entrance animation** (on entering map + every step change): current card `opacity0+scale.55 → 1`, 460ms; choice cards staggered `opacity0+translateY(26)+scale.85 → 1`, 440ms, delay `90+i*95`ms, `fill:backwards`.
- **Map progression:** a `boss` event is forced into the choice set once `step ≥ 3`.
- **Combat menu:** FIGHT/ITEMS/FLEE swap the floating action cluster; BACK returns to root.
- **Character Sheet:** click backdrop or ✕ to dismiss.

---

## State Management
Screen-level: `screen` (`gate|creation|appraisal|combat|map`), `step` (`race|class`), `selRace`, `selClass`, `potential`, `statVals`, `statsRevealed`, `actionMode` (`root|skills|items|flee`), `showStats`, `combatLog`, `combatFrom`.

Map object:
```
map = {
  current, choices[], hints[], history[],   // EventNodes
  step,            // 0-based; shown as step+1
  hoverId,         // hovered choice id | null
  layout,          // 'A' (Constellation) | 'B' (Ascent)
  note             // in-place resolution note | null
}
EventNode = { id, type, name, tag, icon, color, glow, risk, flavor, jx, jy }
```
No data fetching in the prototype — content is generated locally; in-engine it should come from the real run/map generator and character data.

---

## Assets
- **Art slots (game supplies):** Gate background + circular portal; Creation background + per-race/per-class showcase art; Appraisal background; Combat background + monster sprite + up to 3 party sprites; Map background. All are empty drop-zones in the prototype.
- **Icons:** unicode glyphs stand in for event/type sprites (⚔ ☠ ◈ ? ⌂ ⚖ ✦ ✷) and equipment slots — replace with the game's sprite set.
- **Crystal:** procedurally drawn on a canvas (no asset needed) — can be reproduced in-engine or swapped for a sprite/shader.
- **Fonts:** Press Start 2P + VT323 (Google Fonts, open licence) — or the project's equivalent pixel fonts.

## Screenshots
Reference renders of each screen are in `screenshots/` (1280×720). The small bottom-left nav bar in these captures is the **dev preview switcher only** — not part of the shipping UI.
- `01-gate.png` — Gate / title
- `02-creation-race.png` — Character Creation, Race step
- `03-creation-class.png` — Character Creation, Class step
- `04-appraisal.png` — Appraisal / Awakening (crystal, pre-hold)
- `05-combat.png` — Combat
- `06-character-sheet.png` — Character Sheet overlay
- `07-map-constellation.png` — Event Travel Map, Constellation layout
- `08-map-ascent.png` — Event Travel Map, Ascent layout

## Files
- `Ascension.dc.html` — the full prototype containing all six screens. Screen blocks are marked with `<!-- ===================== GATE / CREATION / APPRAISAL / COMBAT / CHARACTER SHEET / MAP ===================== -->`. The design tokens (fonts, palette, frame scaling, keyframes) live in the `<helmet>`/`<style>` at the top; screen logic + generated content live in the component class (`renderVals()` plus the map/combat/creation/appraisal methods).
