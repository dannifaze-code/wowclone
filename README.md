# Ember & Iron — Web Prototype (Phase 1)

This is a **no-build**, GitHub-pages friendly HTML prototype of Phase 1.

## Run locally
Because the game loads JSON files, you need a local web server (not `file://`).

### Option A: Python
```bash
python -m http.server 8000
```
Then open: http://localhost:8000/

### Option B: VS Code
Use the “Live Server” extension.

## Controls
- WASD: move
- Shift: sprint
- 1: eat Jerky
- 2: drink Waterskin
- C: make camp (requires Camp Kit)

## Files
- `config/settings.json` — tuning knobs
- `data/Registry/Items.json` — item weights/stats
- `src/Systems/Inventory.logic.js`
- `src/Systems/Survival.logic.js`
- `src/app.js` — three.js scene + gameplay loop

## Notes
This prototype is meant to prove the **grounded friction loop**: carry weight → fatigue → rations → camp.

