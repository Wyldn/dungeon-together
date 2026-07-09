# 🗼 Dungeon Together

A dark-fantasy **roguelike card-crawler** for the browser. Climb a 51-floor tower one event card at a time, make Reigns-style tradeoff decisions, fight turn-based battles with a Pokemon-style skill loadout, and defy the Demon King — or escape, or uncover the tower's secret.

Gameplay inspiration: **An Average Campaign** (Roblox), **Reigns**, and **Baldur's Gate** — worlds inspired by Solo Leveling, Sword Art Online, and Shadow Slave.

**Zero dependencies. Zero build step.** Pure HTML/CSS/JS (ES modules). Open it and play.

## ▶️ Play locally

Because the game uses ES modules, it needs to be served over HTTP (not opened as a `file://`):

```bash
# any of these, from the repo root:
npx serve .
python -m http.server 8000
```

Then open `http://localhost:8000` (or whatever port your server prints).

## 🎮 How to play

- **Pick a class** — Warrior, Mage, Archer, or Rogue — and roll your RNG stats (3 rerolls).
- **Each floor deals one card**: an encounter, a story event, a treasure (👀 mimics), a risk, a blessing, a merchant, or a rest.
- **Every choice is a tradeoff** — gold vs. HP, XP vs. Sanity. Stat requirements (DEX 12+, INT 13+…) gate the good options; Luck sweetens every roll.
- **Combat is turn-based** with a 4-skill loadout you customize as you learn new techniques. Enemies come in packs; bosses have phases.
- **Lose conditions:** HP = 0 (death) or Sanity = 0 (the tower keeps your mind).
- **Every 10th floor is a boss.** Every 5th is a Trial floor with battle modifiers.
- **Biomes:** Whispering Forest → Sunken Ruins → Frozen Citadel → Weeping Mire → The Scorch → the Throne (Floor 51).
- **Death is permanent** — but Soul Shards flow back to the **Sanctum** for permanent upgrades, and your next climber starts stronger.
- **Three endings.** Slay the Demon King, take the Coward's Gate... or find the three hidden Sigils and learn what the tower actually is.

## 🗂️ Project structure

```
index.html            entry point
css/main.css          all styling (dark-fantasy UI, animations)
js/
  main.js             bootstrap
  game.js             screens, floor flow, event resolution, endings
  combat.js           turn-based combat engine
  character.js        derived stats, leveling, evolutions
  state.js            run state + meta progression (localStorage)
  rng.js              seeded RNG (shareable run seeds)
  audio.js            procedural WebAudio SFX (no asset files)
  fx.js               biome particle canvas + screen shake
  icons.js            inline SVG class icons
  ui.js               DOM helpers (modals, toasts, bars)
  data/
    classes.js        the Basic Four + evolution paths
    skills.js         skill library (declarative effects)
    enemies.js        bestiary, bosses, biomes, trial modifiers
    events.js         ~45 event cards (the Reigns half)
    items.js          weapons, armor, accessories, relics, consumables
```

## 🛠️ Adding content (contributor cheatsheet)

Everything is data-driven — most contributions never touch the engine:

- **New event card** → add an object to `js/data/events.js`. Effects are declarative (`{ gold: 50, sanity: -5, flag: 'x' }`); flags let later events remember earlier choices.
- **New skill** → `js/data/skills.js`. Fields like `power`, `stun`, `poison`, `shield`, `buff` are resolved by the engine automatically.
- **New enemy/boss** → `js/data/enemies.js`. Traits: `pack`, `elite`, `caster`, `regen`, `sanityHit`, `summons`, `heads`, `phases`.
- **New relic/item** → `js/data/items.js`. Passive props (`dmgMult`, `sanityGuard`, `noMimic`, `revive`…) are picked up by `character.js#derived`.

## 🗺️ Roadmap (from the design doc)

- [ ] Co-op climbing (the "Together" part) — WebRTC or a small relay server
- [ ] More classes + subclass branches (Rogue → Assassin already stubbed via evolutions)
- [ ] 100-floor tower with theme rotation every 10 floors
- [ ] Daily tower (seeded) & weekly challenge modifiers
- [ ] NPCs that persist across runs / tower "history" generation
- [ ] Recruit defeated enemies; adaptive Demon King
- [ ] More endings, hidden bosses, rare one-of-one items

## 📦 Deploy

The repo is GitHub Pages-ready: Settings → Pages → deploy from `main` branch root. No build needed.

---

*The tower always deals first.* 🃏
