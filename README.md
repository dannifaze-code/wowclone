# Ember & Iron — WoW Clone Web Prototype

[![Deploy to GitHub Pages](https://github.com/dannifaze-code/wowclone/actions/workflows/deploy.yml/badge.svg)](https://github.com/dannifaze-code/wowclone/actions/workflows/deploy.yml)
[![CI](https://github.com/dannifaze-code/wowclone/actions/workflows/ci.yml/badge.svg)](https://github.com/dannifaze-code/wowclone/actions/workflows/ci.yml)

A browser-based 3D action-survival game inspired by World of Warcraft. Built with **Three.js** — no build tools, no frameworks, just open `index.html` and play.

---

## Play Now

[![Play Ember & Iron](https://img.shields.io/badge/PLAY_NOW-Ember_%26_Iron-ff6a00?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0id2hpdGUiPjxwYXRoIGQ9Ik04IDV2MTRsMTEtN3oiLz48L3N2Zz4=&logoColor=white)](https://dannifaze-code.github.io/wowclone/)

> After merging to `main`, GitHub Pages will auto-deploy. Click the badge above to play.

### Run Locally

Because the game loads JSON via `fetch()`, you need a local server (not `file://`):

```bash
# Option A: Python
python3 -m http.server 8000
# then open http://localhost:8000

# Option B: Node.js
npx serve .

# Option C: VS Code
# Install "Live Server" extension, right-click index.html → Open with Live Server
```

---

## Controls

| Key | Action |
|-----|--------|
| `WASD` | Move |
| `Shift` | Sprint |
| `Space` | Attack target |
| `Tab` | Cycle targets |
| `E` | Interact / Talk to NPC |
| `C` | Set up camp (requires Camp Kit) |
| `1` | Eat Smoked Jerky |
| `2` | Drink Waterskin |
| `R` | Respawn (when dead) |
| `Esc` | Clear target / close dialogue |

---

## Features

- **3D World** — Three.js rendered environment with trees, rocks, outpost walls, campfire with flickering light
- **Combat System** — Attack enemies with `Space`, auto-target nearest hostile, damage numbers float in 3D, XP and leveling
- **NPC System** — Friendly NPCs with dialogue (`E` to interact), hostile enemies that chase and attack, name labels and health bars
- **Survival Mechanics** — Fatigue, hunger, thirst meters that drain over time. Eat, drink, and camp to stay alive
- **Inventory & Encumbrance** — Pick up glowing loot cubes, manage weight and slots, encumbrance affects movement speed
- **XP & Leveling** — Kill enemies to earn XP, level up for +HP and +DMG
- **Loot Drops** — Defeated enemies drop random items from their loot table
- **Enemy Respawns** — Killed enemies respawn after 15 seconds
- **Autosave** — Game state saved to localStorage every 4 seconds
- **Death & Respawn** — Die and press `R` to respawn at the outpost with full health

---

## Project Structure

```
wowclone/
├── .github/workflows/     # CI + GitHub Pages deploy
│   ├── deploy.yml         # Auto-deploy to Pages on push to main
│   └── ci.yml             # Validate files on PR
├── src/                   # Game source code
│   ├── app.js             # Main game loop, Three.js scene, input, HUD
│   └── Systems/
│       ├── Inventory.logic.js   # Slots, stacks, weight, encumbrance
│       ├── Survival.logic.js    # Fatigue, hunger, thirst, rest states
│       ├── NPC.logic.js         # NPC spawning, AI patrol, dialogue
│       └── Combat.logic.js      # Player combat, attacks, damage, XP
├── assets/                # Raw assets (models, textures, audio)
│   ├── models/
│   ├── textures/
│   └── audio/
├── config/
│   └── settings.json      # Game tuning (meter rates, inventory limits, etc.)
├── data/
│   └── Registry/
│       ├── Items.json     # Item definitions (food, drink, ammo, materials)
│       ├── NPCs.json      # NPC definitions (merchants, guards, enemies)
│       └── Zones.json     # Zone definitions (outpost, wilderness)
├── addons/                # User-generated content (future)
├── build/                 # Output folder for builds (future)
├── index.html             # Entry point — open this to play
└── README.md
```

---

## Game Data

### Items
| Item | Type | Weight | Stack | Effect |
|------|------|--------|-------|--------|
| Smoked Jerky | Food | 0.2 | 20 | +25 Hunger |
| Hardtack | Food | 0.25 | 20 | +20 Hunger, -5 Thirst |
| Waterskin | Drink | 1.0 | 5 | +35 Thirst |
| Camp Kit | Camp | 2.0 | 3 | Set up camp to rest |
| Basic Pellets | Ammo | 0.01 | 200 | — |
| Scrap Iron | Material | 0.5 | 50 | — |

### NPCs
| NPC | Type | Zone | Hostile |
|-----|------|------|---------|
| Galen the Trader | Merchant | Outpost | No |
| Sentry Renn | Guard | Outpost | No |
| Dust Walker | Wanderer | Outpost | No |
| Ashen Raider | Enemy | Outpost | Yes |

---

## GitHub Actions

Two workflows are included:

1. **`deploy.yml`** — Validates all game files, then deploys to GitHub Pages on push to `main`/`master`
2. **`ci.yml`** — Runs on PRs: checks file existence, JSON validity, JS syntax, file sizes

### Setup GitHub Pages

1. Go to **Settings → Pages** in your repo
2. Set **Source** to "GitHub Actions"
3. Push to `main` — the game will deploy automatically
4. Your game will be live at `https://dannifaze-code.github.io/wowclone/`

---

## Tuning

Edit `config/settings.json` to adjust:
- Hunger/thirst drain rates
- Fatigue thresholds and recovery
- Inventory slot count and carry weight
- Encumbrance soft/hard caps
- Combat penalties for low food/water

Edit `data/Registry/Items.json` to add new items, adjust weights, stack sizes, and restore values.

Edit `data/Registry/NPCs.json` to add new NPCs, change positions, dialogue, stats, and loot tables.

---

## Tech Stack

- **Three.js** (r160) — 3D rendering via CDN, no install needed
- **Vanilla JavaScript** — ES modules, no bundler
- **HTML5 Canvas** — WebGL rendering
- **localStorage** — Client-side save/load
- **GitHub Pages** — Zero-config static hosting
