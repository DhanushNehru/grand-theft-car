# Architecture Overview

Grand Theft Car is plain HTML, CSS and JavaScript modules with no build step and no npm dependencies (see [CONTRIBUTING.md](../CONTRIBUTING.md)). The project has two separate game builds that share the same idea (drive around a city, take delivery jobs against a timer) but not the same code:

| | 2D arcade | 3D |
| --- | --- | --- |
| Entry point | `js/main.js` | `js/main3d.js` |
| Game code | `js/game.js` | `js/main3d.js` (single file) |
| City | `js/world.js`, a tile grid | `BUILDINGS` array of boxes, plus a coastal highway |
| Rendering | 2D canvas | Three.js (`vendor/three.module.js`) |
| Missions | `MISSIONS` in `js/game.js` | `MISSIONS3D` in `js/main3d.js` |

## 3D mode (js/main3d.js)

Everything for the 3D build lives in `js/main3d.js`. It uses the bundled Three.js module in `vendor/`.

- **World.** The city is a list of `BUILDINGS`, each `{ x, z, w, d, h, color }`. Buildings near the coast (`cx > CITY_W / 4`) are taller than inland ones. A palm-lined coastal highway runs along the beach. World layout is driven by constants such as `CITY_W`, `CITY_N`, `PITCH`, `ROAD` and `COAST_X`.
- **Game state.** A single `state` object holds `{ cash, idx, stage, timer, time }`.
  - `idx` is the current mission index.
  - `stage` is `'drive'` (heading to the pickup marker) or `'timed'` (delivering against the clock).
  - `timer` is the time left on the current delivery.
  - `time` is total elapsed time, used for animation.
- **Loop.** `update(dt)` advances car physics, the ambient helicopter and the mission logic. `render()` positions the car mesh, moves the chase camera behind the car, draws the scene, then updates the HUD and the minimap.
- **Input.** `W/A/S/D` or the arrow keys steer and accelerate, and `Space` brakes. On-screen touch buttons are wired up if a `#touch` element exists.
- **Collisions.** `collideBuildings(c)` pushes the car out of any building and slows it, and it clamps the car to the land area so it can't drive into the sea.
- **Beacon.** A glowing marker (`beacon` and `beaconRing`) shows where to go next. It is yellow at a pickup and green at a drop-off.
- **HUD.** DOM elements are looked up by id (`cash`, `mission-title`, `mission-text`, `mission-timer`, `speed`, `hint`, `toast`, `minimap`, `overlay`). The minimap is a 168x168 canvas showing a street grid and dots for the car and beacon.

## 2D arcade mode (js/game.js, js/world.js)

- **`js/main.js`** is the entry point. It creates a `Game` from `js/game.js` on the `#game` canvas and starts it when `#start-btn` is clicked. Opening the page with `?shot=foot`, `?shot=drive` or `?shot=mission` starts a demo mode (used for the screenshots in this folder), and `?fast=N` is passed through to the game. The game object is exposed as `window.__game` for debugging in dev tools.
- **`js/game.js`** holds the core game loop, entities, physics, AI, missions, rendering and a small Web Audio sound class (`Sfx`).
- **`js/world.js`** generates the city as a deterministic tile grid: `GRID` x `GRID` tiles of `TILE` pixels, with a street every `ROAD_EVERY` tiles. Tile types are listed in `T` (`ROAD`, `WALK`, `BUILDING`, `GRASS`, `TREE`, `LOT`). `buildWorld(seed)` uses a small seeded random number generator (`rng`), so every player gets the same city. It also produces parking-lot centers that the 2D missions use as pickup points.

## Differences between the modes

- **Coordinates.** 2D uses `x`/`y` on a tile grid. 3D uses `x`/`z` on the ground plane in world units.
- **City.** 2D generates a seeded grid of roads, parks and lots. 3D places box buildings and a coastal highway.
- **Missions.** 2D missions are `{ name, brief, time, reward }` only, and their pickup and drop-off points come from the generated world. 3D missions also carry explicit `start` and `to` coordinates.
- **Physics.** The 3D car uses the same arcade-style model as the 2D build, applied on the XZ plane.
- **Code layout.** 2D is split across `main.js`, `game.js` and `world.js`. 3D is one file.

## How to add a mission

This guide covers the 3D build, where a mission is a plain object in the `MISSIONS3D` array in `js/main3d.js`.

### Step-by-step

1. Open `js/main3d.js` and find `const MISSIONS3D = [`.
2. Add a new object to the array with these fields:

   | Field | Meaning |
   | --- | --- |
   | `name` | Title shown in the HUD |
   | `brief` | One-line description, shown when the delivery starts |
   | `reward` | Cash paid on delivery |
   | `time` | Seconds allowed to reach the drop-off |
   | `start` | `{ x, z }` of the pickup marker |
   | `to` | `{ x, z }` of the drop-off marker |

3. Choose `start` and `to` positions the car can actually reach:
   - Stay on land. The car is clamped to roughly `x` between `-CITY_W / 2 - 10` and `COAST_X + ROAD + 30`, and `z` within `CITY_W / 2 + 130` of the center.
   - Don't place a marker inside a building. Buildings block the car, and a mission is completed by driving within 5 units of the marker on the ground, so a marker inside a building can never be reached.
   - Reusing coordinates already in the array (for example `COAST_X + ROAD / 2 + 24` on the highway) is a safe way to stay in bounds.
4. Pick a `time` that is fair for the distance. Missions get harder as you go, so existing ones use rewards of 150, 260 and 420 with 45 to 60 seconds.
5. Save and play the mission in a browser (see below).

No other code needs to change. Missions are played in array order and wrap around with `state.idx % MISSIONS3D.length`, so the new mission runs after the last one and the list then loops.

### How a mission runs

1. In the `'drive'` stage the beacon sits at `start`. Driving within 5 units of it switches to `'timed'`, sets `timer` to `time` and moves the beacon to `to`.
2. In the `'timed'` stage the timer counts down. Reaching `to` in time pays `reward`, advances `idx` and moves the beacon to the next mission's `start`.
3. If the timer reaches 0, the job fails. The stage goes back to `'drive'`, the beacon returns to `start`, and a "too slow" message appears.

### Worked example (MISSIONS3D)

This adds a fourth mission that starts downtown and ends on the coastal highway. Add a comma after the last existing mission and insert:

```js
{
  name: 'Downtown Loop',
  brief: 'Get from the city center out to the coast.',
  reward: 520,
  time: 50,
  start: { x: -96, z: -96 },
  to: { x: COAST_X + ROAD / 2 + 24, z: -80 },
},
```

The full array then looks like this:

```js
const MISSIONS3D = [
  { name: 'Beach Run', brief: 'Deliver into the downtown grid before time runs out.', reward: 150, time: 45, start: { x: COAST_X + ROAD / 2 + 24, z: -80 }, to: { x: -CITY_W / 4, z: CITY_W / 4 } },
  { name: 'Skyline Dash', brief: 'Back to the coast, fast as you can.', reward: 260, time: 55, start: { x: 32, z: -CITY_W / 4 }, to: { x: COAST_X + ROAD / 2 + 24, z: CITY_W / 3 } },
  { name: 'Palm Circuit', brief: 'One more across the city center.', reward: 420, time: 60, start: { x: COAST_X + ROAD / 2 + 24, z: CITY_W / 3 }, to: { x: -96, z: -96 } },
  { name: 'Downtown Loop', brief: 'Get from the city center out to the coast.', reward: 520, time: 50, start: { x: -96, z: -96 }, to: { x: COAST_X + ROAD / 2 + 24, z: -80 } },
];
```

Because `Palm Circuit` ends at `{ x: -96, z: -96 }`, the new mission's pickup starts exactly where the previous delivery finished, so the jobs chain naturally.

### Testing your change

Serve the folder and play it in a real browser (this is what `CONTRIBUTING.md` asks for):

```bash
python3 -m http.server
```

Then open the 3D page, finish the previous missions, and check that your marker appears, is reachable, and pays out. On Windows, `python -m http.server` also works.

### 2D mode

The 2D `MISSIONS` array in `js/game.js` uses the same `name`, `brief`, `time` and `reward` fields. Its pickup and drop-off positions come from the generated world in `js/world.js`, not from the mission entry itself.