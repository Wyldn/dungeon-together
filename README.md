# 🗼 Dungeon Together

A dark-fantasy **co-op roguelike card-crawler** for the browser. Climb a 51-floor tower one event card at a time, make Reigns-style tradeoff decisions, fight turn-based battles with a Pokemon-style skill loadout, and defy the Demon King — or escape, or uncover the tower's secret. **Solo, or with up to 4 friends.**

Gameplay inspiration: **An Average Campaign** (Roblox), **Reigns**, and **Baldur's Gate** — worlds inspired by Solo Leveling, Sword Art Online, and Shadow Slave.

**Zero build step.** Pure HTML/CSS/JS (ES modules) + a tiny Node relay for multiplayer.

## ▶️ Play

- **Multiplayer + solo:** http://132.226.66.6:3117/ (the party server — hosts the game *and* the relay)
- **Solo only:** https://wyldn.github.io/dungeon-together/ (GitHub Pages is https, which blocks the ws relay — play co-op from the party server URL)

### 🎭 Playing together

1. Title screen → **⚔ Play Together**
2. One player **creates a party** and shares the 4-letter code (or checks **🌐 Public party**); up to 3 more join
3. No friends online? **🌐 Quick Match** drops you into any open public party — or makes you the host of a fresh one. **Browse open parties** lists what's waiting.
4. Everyone picks a class (and a look), readies up; the host opens the gate

**How co-op works:** one shared tower (same seed, same cards, lock-step floors). Story/event cards are answered *individually* — your choices, your consequences. Encounters, trials, bosses, and the Throne are fought **together**, turn by turn. If you fall in a **shared** fight, you're *down*, not dead — your party's victory revives you at the next floor (30% HP). But a fight you picked **alone** (an event's duel, a mimic, an ambush) is yours alone: die there and the tower keeps you — the party climbs on without you. Idle climbers don't stall the party: after ~60s, votes resolve once half the party has spoken, and an AFK combat turn plays itself.

## 🖥️ Run locally

```bash
# static (solo):
python -m http.server 8000

# full stack (multiplayer):
cd server && npm install && npm start   # serves game + relay on :3117
```

### Server deployment (current setup)

The relay runs on Rishi's Oracle Cloud VM under pm2:

```bash
ssh opc@132.226.66.6
cd ~/dungeon-together && git pull        # update
pm2 restart dungeon-together             # apply
pm2 logs dungeon-together                # watch
```

Port 3117/tcp is open in firewalld + the OCI security list. `server/test-bot.js` is a scripted partner for protocol testing: `node test-bot.js <CODE> ws://host:3117`.

## 🎮 How to play

- **Build a climber**: pick a **bloodline** (Human/Elf/Orc/Dwarf), a **calling** (Warrior, Mage, Archer, Rogue, Priest, Monk — each with its own class resource: Vigor, Mana, Focus, Energy, Faith, Ki), and a **playable origin** (Academy, Mercenary Company, Temple, Undercity…). Your exact stats and growth potential stay **hidden** — you get a feeling and 2 rerolls, nothing more. Pay an **appraiser** mid-run for approximate ranks (F → E → D → C → B → A → S → EX → WRLD).
- **The tower deals three cards per floor** — you see only their nature (Combat, Mystery, Merchant, Appraisal, Dangerous…), never their contents. Watch for the occasional ✦ sparkle: something behind that card suits someone in your party. It won't say what, or who.
- **Combat is initiative-rolled and turn-based**: turn order on the left, your character on the right. Everyone always has **Strike** and **Guard** (30% block, builds charge). Big hits and AOE cost **Battle Charge** (6 segments) — and enemies charge up too, telegraphing their specials one segment early.
- **Weapon compatibility matters**: a Mage holding a sword keeps only Strike and Guard — unless they walk the Spellblade path.
- **At level 6 the path divides**: every class chooses between two subclasses — and if you've earned it, a **secret third option** appears. Level 13 deepens the branch. Rare events can even **promote your race** (Elf → High Elf, Human → Awakened…).
- **Fame is always visible** and always working: discounts bribes (only intelligent enemies take gold), unlocks merchant deals, opens doors.
- **Weak starts fight back**: underdog climbers encounter rare mentors, hidden trainers, and awakenings more often. Strong starts usually grow slower. The tower evens out — eventually.
- **Every 10th floor is a boss** with its own charge economy and initiative profile. Every 5th is a Trial. Biomes: Forest → Ruins → Frozen Citadel → Mire → the Scorch → the Throne (Floor 51).
- **Death is permanent** (solo). In co-op you fall, lose a couple of lesser items, and rejoin next floor at 30%. Soul Shards flow back to the **Sanctum** either way.
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

Everything is data-driven — most contributions never touch the engine. **Full authoring guide: [docs/CONTENT.md](docs/CONTENT.md).** Balance constants are centralized in `js/data/config.js`. Verify contributions with:

```bash
node tools/test.js   # 465+ data & logic assertions
node tools/sim.js    # seeded balance simulations (10k trials)
```

## 🗺️ Roadmap (from the design doc)

- [x] Co-op climbing (the "Together" part) — ws relay, shared combat, downed/revive
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
