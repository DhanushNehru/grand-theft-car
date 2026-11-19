// Grand Theft Car Arcade — city generation.
// The city is a deterministic tile grid: streets every few blocks,
// buildings, parks and parking lots generated from a fixed seed so
// every player drives the same city.

export const TILE = 64;          // pixels per tile
export const GRID = 42;          // city is GRID x GRID tiles
export const ROAD_EVERY = 6;     // a street every 6 tiles

export const T = { ROAD: 0, WALK: 1, BUILDING: 2, GRASS: 3, TREE: 4, LOT: 5 };

const BUILDING_COLORS = [
  ['#8d6e63', '#6d4c41'], ['#78909c', '#546e7a'], ['#90a4ae', '#607d8b'],
  ['#a1887f', '#7b5e57'], ['#7e8aa2', '#5b6783'], ['#9575a8', '#6f5280'],
  ['#6b8e7f', '#4f6b5f'], ['#b0855b', '#8a6742'],
];

// mulberry32 — tiny seeded RNG so the map is reproducible.
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function isRoadTile(tx, ty) {
  return tx % ROAD_EVERY === 0 || ty % ROAD_EVERY === 0;
}

export function buildWorld(seed = 20261119) {
  const rand = rng(seed);
  const tiles = new Uint8Array(GRID * GRID);
  const buildings = [];   // {x,y,w,h,body,roof} in pixels
  const trees = [];       // {x,y,r}
  const parkedSpawns = [];// {x,y,angle}
  const lotCenters = [];  // parking-lot centers (mission pickup points)
  const parkCenters = [];

  for (let ty = 0; ty < GRID; ty++) {
    for (let tx = 0; tx < GRID; tx++) {
      const i = ty * GRID + tx;
      if (isRoadTile(tx, ty)) { tiles[i] = T.ROAD; continue; }

      const bx = Math.floor(tx / ROAD_EVERY), by = Math.floor(ty / ROAD_EVERY);
      const lx = tx % ROAD_EVERY, ly = ty % ROAD_EVERY; // 1..5 inside block
      const edge = lx === 1 || lx === 5 || ly === 1 || ly === 5;

      // Decide block type once per block from coords.
      const bRand = rng(seed + bx * 7919 + by * 104729);
      const roll = bRand();
      const blockType = roll < 0.14 ? 'park' : roll < 0.24 ? 'lot' : 'building';

      if (blockType === 'park') {
        tiles[i] = T.GRASS;
        if (!edge && bRand() < 0.45) {
          tiles[i] = T.TREE;
          trees.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, r: 14 + bRand() * 10 });
        }
        if (lx === 3 && ly === 3) parkCenters.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
      } else if (blockType === 'lot') {
        tiles[i] = T.LOT;
        if (lx === 3 && ly === 3) lotCenters.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });
        // Parked cars along the lot rows.
        if (ly === 2 && lx >= 2 && lx <= 4 && bRand() < 0.55) {
          parkedSpawns.push({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, angle: Math.PI / 2 });
        }
      } else {
        if (edge) { tiles[i] = T.WALK; continue; }
        tiles[i] = T.BUILDING;
        if (lx === 2 && ly === 2) {
          // One building rect covers the 3x3 interior of the block.
          const c = BUILDING_COLORS[Math.floor(bRand() * BUILDING_COLORS.length)];
          buildings.push({
            x: tx * TILE, y: ty * TILE, w: 3 * TILE, h: 3 * TILE,
            body: c[0], roof: c[1], seed: Math.floor(bRand() * 1e9),
          });
        }
      }
    }
  }

  const center = Math.floor(GRID / 2 / ROAD_EVERY) * ROAD_EVERY; // nearest central avenue
  const spawn = { x: center * TILE + TILE / 2, y: center * TILE + TILE / 2 };

  return {
    tiles, buildings, trees, parkedSpawns, lotCenters, parkCenters, spawn,
    pxWidth: GRID * TILE, pxHeight: GRID * TILE,
  };
}

export function tileAt(world, px, py) {
  const tx = Math.floor(px / TILE), ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= GRID || ty >= GRID) return T.BUILDING; // city edge = wall
  return world.tiles[ty * GRID + tx];
}

export function solidAt(world, px, py) {
  const t = tileAt(world, px, py);
  return t === T.BUILDING || t === T.TREE;
}

// Circle vs solid tiles: returns corrected position after push-out.
export function collideCircle(world, x, y, r) {
  const minTx = Math.floor((x - r) / TILE), maxTx = Math.floor((x + r) / TILE);
  const minTy = Math.floor((y - r) / TILE), maxTy = Math.floor((y + r) / TILE);
  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (tx < 0 || ty < 0 || tx >= GRID || ty >= GRID) continue;
      const t = world.tiles[ty * GRID + tx];
      if (t !== T.BUILDING && t !== T.TREE) continue;
      // Closest point on tile rect to circle center.
      const rx = tx * TILE, ry = ty * TILE;
      const cx = Math.max(rx, Math.min(x, rx + TILE));
      const cy = Math.max(ry, Math.min(y, ry + TILE));
      const dx = x - cx, dy = y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        const push = (r - d) / d;
        x += dx * push; y += dy * push;
      }
    }
  }
  return { x, y };
}
