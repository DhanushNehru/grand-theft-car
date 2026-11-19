// Metro Drift — core game loop, entities, physics, AI, missions, rendering.
import {
  TILE, GRID, T, buildWorld, tileAt, solidAt, collideCircle, isRoadTile, rng,
} from './world.js';

const CAR_COLORS = ['#e06c60', '#61afef', '#98c379', '#e5c07b', '#c678dd', '#56b6c2', '#be8f6e', '#d19a66'];
const PED_COLORS = ['#f0c674', '#8abeb7', '#b294bb', '#de935f', '#a3685a'];
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // E S W N

const MISSIONS = [
  { name: 'Pizza Sprint', brief: 'Pick up the order at the marker, then deliver it hot.', time: 40, reward: 150 },
  { name: 'Airport Dash', brief: 'A traveller is waiting. Get them across town, fast.', time: 55, reward: 260 },
  { name: 'Midnight Courier', brief: 'One package, other side of the city. No questions.', time: 70, reward: 420 },
];

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

// ---------------------------------------------------------------- audio
class Sfx {
  constructor() { this.ctx = null; this.muted = false; this.engine = null; }
  init() {
    if (this.ctx || this.muted) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth'; osc.frequency.value = 50; gain.gain.value = 0;
      osc.connect(gain).connect(this.ctx.destination);
      osc.start();
      this.engine = { osc, gain };
    } catch (e) { this.ctx = null; }
  }
  setEngine(speedKmh, driving) {
    if (!this.engine || this.muted) return;
    const { osc, gain } = this.engine;
    osc.frequency.value = 45 + speedKmh * 1.1;
    gain.gain.value = driving ? 0.035 : 0;
  }
  blip(freq = 660, dur = 0.12) {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = freq; g.gain.value = 0.06;
    o.connect(g).connect(this.ctx.destination);
    o.start(); o.stop(this.ctx.currentTime + dur);
  }
  crash() { this.blip(90, 0.2); }
  success() { this.blip(660, 0.1); setTimeout(() => this.blip(880, 0.14), 110); }
  toggleMute() { this.muted = !this.muted; if (this.engine && this.muted) this.engine.gain.gain.value = 0; return this.muted; }
}

// ---------------------------------------------------------------- input
class Input {
  constructor() {
    this.k = { up: 0, down: 0, left: 0, right: 0, action: 0, brake: 0 };
    this.actionPressed = false;
    const map = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', e: 'action', ' ': 'brake' };
    window.addEventListener('keydown', (ev) => {
      const key = ev.key.toLowerCase();
      if (key === 'm') { this.onMute && this.onMute(); return; }
      const k = map[key];
      if (k) { ev.preventDefault(); if (k === 'action' && !this.k.action) this.actionPressed = true; this.k[k] = 1; }
    });
    window.addEventListener('keyup', (ev) => { const k = map[ev.key.toLowerCase()]; if (k) this.k[k] = 0; });
    document.querySelectorAll('#touch button').forEach((btn) => {
      const k = btn.dataset.k === 'gas' ? 'up' : btn.dataset.k === 'brake' ? 'down' : btn.dataset.k;
      const on = (ev) => { ev.preventDefault(); if (k === 'action' && !this.k.action) this.actionPressed = true; this.k[k] = 1; };
      const off = (ev) => { ev.preventDefault(); this.k[k] = 0; };
      btn.addEventListener('pointerdown', on);
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointerleave', off);
    });
  }
}

// ---------------------------------------------------------------- game
export class Game {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.world = buildWorld();
    this.rand = rng(987654321);
    this.input = new Input();
    this.sfx = new Sfx();
    this.input.onMute = () => { const m = this.sfx.toggleMute(); this.toast(m ? 'Muted' : 'Sound on'); };
    this.shotMode = opts.shot || null; // screenshot/demo automation
    this.fastFrames = opts.fast || 0;
    if (this.shotMode) this.sfx.muted = true;

    this.cash = 0;
    this.heat = 0;
    this.lastCrime = -999;
    this.heatDecayAt = 0;
    this.bustedTimer = 0;
    this.bustedShow = 0;
    this.time = 0;
    this.skids = [];
    this.shake = 0;

    const s = this.world.spawn;
    this.player = { x: s.x, y: s.y, angle: 0, mode: 'foot', car: null, walkPhase: 0 };

    this.cars = [];
    for (const p of this.world.parkedSpawns) {
      this.cars.push(this.makeCar(p.x, p.y, p.angle, 'parked'));
    }
    // Traffic on avenues.
    for (let i = 0; i < 14; i++) {
      const c = this.spawnRoadCar('traffic');
      if (c) this.cars.push(c);
    }
    this.peds = [];
    for (let i = 0; i < 24; i++) this.peds.push(this.spawnPed());

    // Missions
    this.missionIndex = 0;
    this.mission = null;         // active mission state
    this.missionMarker = null;   // {x,y,kind:'start'|'pickup'|'drop'}
    this.missionCooldown = 0;
    this.setNextMissionStart();

    // DOM
    this.el = {};
    for (const id of ['cash', 'heat', 'mission-box', 'mission-title', 'mission-text', 'mission-timer', 'speed', 'hint', 'toast', 'minimap', 'busted', 'busted-sub', 'overlay', 'touch']) {
      this.el[id] = document.getElementById(id);
    }
    this.mmCtx = this.el['minimap'].getContext('2d');
    this.mmBase = this.renderMinimapBase();

    if ('ontouchstart' in window) this.el['touch'].classList.remove('hidden');

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.last = performance.now();
  }

  makeCar(x, y, angle, type) {
    return {
      x, y, angle, type,
      vx: 0, vy: 0, speed: 0,
      w: 26, l: 46,
      color: CAR_COLORS[Math.floor(this.rand() * CAR_COLORS.length)],
      dir: Math.floor(this.rand() * 4), wp: null, // traffic waypoint
      stuck: 0,
    };
  }

  spawnRoadCar(type) {
    for (let tries = 0; tries < 60; tries++) {
      const tx = Math.floor(this.rand() * GRID), ty = Math.floor(this.rand() * GRID);
      if (tileAt(this.world, tx * TILE + 32, ty * TILE + 32) !== T.ROAD) continue;
      const x = tx * TILE + 32, y = ty * TILE + 32;
      if (dist({ x, y }, this.player) < 500) continue;
      const c = this.makeCar(x, y, 0, type);
      if (type === 'cop') { c.color = '#2f81f7'; c.speed = 0; }
      c.dir = Math.floor(this.rand() * 4);
      c.angle = Math.atan2(DIRS[c.dir][1], DIRS[c.dir][0]);
      return c;
    }
    return null;
  }

  spawnPed() {
    for (let tries = 0; tries < 60; tries++) {
      const tx = Math.floor(this.rand() * GRID), ty = Math.floor(this.rand() * GRID);
      const t = this.world.tiles[ty * GRID + tx];
      if (t !== T.WALK && t !== T.GRASS && t !== T.LOT) continue;
      return {
        x: tx * TILE + 20 + this.rand() * 24, y: ty * TILE + 20 + this.rand() * 24,
        angle: this.rand() * Math.PI * 2, speed: 34 + this.rand() * 22,
        turnAt: this.rand() * 2, color: PED_COLORS[Math.floor(this.rand() * PED_COLORS.length)],
      };
    }
    return null;
  }

  farSpot(minDist = 700) {
    const spots = [...this.world.lotCenters, ...this.world.parkCenters];
    const from = this.player;
    const ok = spots.filter((s) => dist(s, from) > minDist);
    const list = ok.length ? ok : spots;
    return list[Math.floor(this.rand() * list.length)];
  }

  setNextMissionStart() {
    const def = MISSIONS[this.missionIndex % MISSIONS.length];
    const generated = this.missionIndex >= MISSIONS.length;
    const start = generated ? this.farSpot(350) : (this.world.parkCenters[0] || this.world.lotCenters[0] || this.farSpot(0));
    this.mission = {
      def: generated
        ? { name: 'Rush Job', brief: 'A client needs a fast pair of wheels.', time: 45 + this.missionIndex * 5, reward: 200 + this.missionIndex * 60 }
        : def,
      stage: 'toStart', start, pickup: null, drop: null, timer: 0,
    };
    this.missionMarker = { x: start.x, y: start.y, kind: 'start' };
  }

  crime(n) {
    const now = this.time;
    if (now - this.lastCrime < 1.5) return;
    this.lastCrime = now;
    this.heat = clamp(this.heat + n, 0, 5);
  }

  toast(text, ms = 1800) {
    const t = this.el['toast'];
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), ms);
  }

  resize() {
    this.canvas.width = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  // ------------------------------------------------------------- update
  update(dt) {
    this.time += dt;
    const p = this.player;

    // Demo autopilot for screenshot mode.
    if (this.shotMode === 'drive') {
      if (p.mode === 'foot') this.tryEnterCar();
      else this.demoSteer(p.car);
    } else if (this.shotMode === 'mission') {
      this.input.k.up = 1; // stroll toward the marker
    }

    if (this.bustedShow > 0) {
      this.bustedShow -= dt;
      if (this.bustedShow <= 0) {
        this.el['busted'].classList.add('hidden');
        p.mode = 'foot'; p.car = null;
        p.x = this.world.spawn.x; p.y = this.world.spawn.y;
        this.cars = this.cars.filter((c) => c.type !== 'cop');
      }
      return;
    }

    // Heat decay
    if (this.heat > 0 && this.time - this.lastCrime > 16) {
      this.heatDecayAt += dt;
      if (this.heatDecayAt > 6) { this.heat--; this.heatDecayAt = 0; }
    }

    // Police presence follows heat.
    const cops = this.cars.filter((c) => c.type === 'cop');
    const wantCops = Math.min(this.heat, 3);
    if (cops.length < wantCops && this.rand() < dt * 0.8) {
      const c = this.spawnRoadCar('cop');
      if (c) this.cars.push(c);
    }
    if (wantCops === 0 && cops.length) this.cars = this.cars.filter((c) => c.type !== 'cop');

    if (p.mode === 'foot') this.updateFoot(dt); else this.updateDrive(dt);

    for (const c of this.cars) {
      if (c === p.car) continue;
      if (c.type === 'traffic') this.updateTraffic(c, dt);
      else if (c.type === 'cop') this.updateCop(c, dt);
    }

    this.updatePeds(dt);
    this.updateCarCollisions(dt);
    this.updateBust(dt);
    this.updateMission(dt);
    this.updateCamera(dt);

    // Skid marks fade
    for (const s of this.skids) s.life -= dt * 0.25;
    this.skids = this.skids.filter((s) => s.life > 0);

    this.shake = Math.max(0, this.shake - dt * 30);
    this.input.actionPressed = false;
  }

  // Screenshot-mode driver: follows the mission marker, steers around buildings.
  demoSteer(c) {
    let desired = c.angle;
    if (this.shotMode === 'mission' && this.missionMarker) {
      desired = Math.atan2(this.missionMarker.y - c.y, this.missionMarker.x - c.x);
    }
    const ahead = 80;
    if (solidAt(this.world, c.x + Math.cos(c.angle) * ahead, c.y + Math.sin(c.angle) * ahead)) {
      for (const turn of [Math.PI / 2, -Math.PI / 2]) {
        const a = c.angle + turn;
        if (!solidAt(this.world, c.x + Math.cos(a) * ahead, c.y + Math.sin(a) * ahead)) { desired = a; break; }
      }
    }
    let d = desired - c.angle;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    this.input.k.left = d < -0.06 ? 1 : 0;
    this.input.k.right = d > 0.06 ? 1 : 0;
    this.input.k.up = 1;
    // Don't rear-end traffic during the demo.
    for (const o of this.cars) {
      if (o === c) continue;
      if (Math.hypot(o.x - (c.x + Math.cos(c.angle) * 60), o.y - (c.y + Math.sin(c.angle) * 60)) < 34) {
        this.input.k.up = 0;
        break;
      }
    }
  }

  updateFoot(dt) {
    const p = this.player, k = this.input.k;
    let mx = (k.right - k.left), my = (k.down - k.up);
    if (mx || my) {
      const len = Math.hypot(mx, my);
      mx /= len; my /= len;
      const sp = 170;
      p.x += mx * sp * dt; p.y += my * sp * dt;
      p.angle = Math.atan2(my, mx);
      p.walkPhase += dt * 10;
    }
    const fixed = collideCircle(this.world, p.x, p.y, 10);
    p.x = clamp(fixed.x, 8, this.world.pxWidth - 8);
    p.y = clamp(fixed.y, 8, this.world.pxHeight - 8);

    if (this.input.actionPressed) this.tryEnterCar();
  }

  tryEnterCar() {
    const p = this.player;
    let best = null, bd = 60;
    for (const c of this.cars) {
      if (c.type === 'cop') continue;
      const d = dist(p, c);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) {
      if (best.type === 'traffic') { this.crime(1); this.toast('You took a moving car! Heat +1'); }
      best.type = 'player';
      best.stopped = false;
      p.mode = 'drive'; p.car = best;
      this.sfx.init();
    }
  }

  updateDrive(dt) {
    const p = this.player, c = p.car, k = this.input.k;
    const accel = 320, maxF = 430, maxR = -140;

    if (k.up) c.speed += accel * dt;
    else if (k.down) c.speed -= (c.speed > 0 ? 560 : 240) * dt;
    else c.speed -= c.speed * 1.4 * dt;
    c.speed = clamp(c.speed, maxR, maxF);

    const steer = (k.left - k.right) * -1; // left key = turn left
    if (Math.abs(c.speed) > 12) {
      const grip = clamp(Math.abs(c.speed) / 160, 0, 1);
      c.angle += steer * 2.4 * grip * dt * Math.sign(c.speed) * (k.brake ? 1.7 : 1);
    }
    if (k.brake) c.speed -= c.speed * 2.2 * dt;

    // Velocity approaches heading*speed; low grip while handbraking = drift.
    const gripT = k.brake ? 2.4 : 9;
    const tvx = Math.cos(c.angle) * c.speed, tvy = Math.sin(c.angle) * c.speed;
    c.vx = lerp(c.vx, tvx, clamp(gripT * dt, 0, 1));
    c.vy = lerp(c.vy, tvy, clamp(gripT * dt, 0, 1));

    if (k.brake && Math.abs(c.speed) > 160 && this.skids.length < 400) {
      this.skids.push({ x: c.x, y: c.y, angle: c.angle, life: 1 });
    }

    c.x += c.vx * dt; c.y += c.vy * dt;

    // Building collision (3 sample circles along the body).
    let hit = false;
    for (const off of [-14, 0, 14]) {
      const sx = c.x + Math.cos(c.angle) * off, sy = c.y + Math.sin(c.angle) * off;
      const fixed = collideCircle(this.world, sx, sy, 12);
      if (Math.abs(fixed.x - sx) > 0.01 || Math.abs(fixed.y - sy) > 0.01) {
        c.x += fixed.x - sx; c.y += fixed.y - sy;
        hit = true;
      }
    }
    if (hit) {
      const impact = Math.hypot(c.vx, c.vy);
      if (impact > 220) { this.sfx.crash(); this.shake = Math.min(14, impact / 40); }
      c.vx *= -0.25; c.vy *= -0.25; c.speed *= 0.45;
    }
    c.x = clamp(c.x, 20, this.world.pxWidth - 20);
    c.y = clamp(c.y, 20, this.world.pxHeight - 20);

    p.x = c.x; p.y = c.y; p.angle = c.angle;

    if (this.input.actionPressed && Math.abs(c.speed) < 60) {
      p.mode = 'foot';
      p.x = c.x + Math.cos(c.angle + Math.PI / 2) * 30;
      p.y = c.y + Math.sin(c.angle + Math.PI / 2) * 30;
      c.type = 'parked';
      p.car = null;
    }

    this.sfx.setEngine(Math.abs(c.speed) * 0.22, true);
  }

  updateTraffic(c, dt) {
    const sp = 125;
    // Waypoint steering toward the center of the next road tile.
    if (!c.wp || dist(c, c.wp) < 10) {
      const tx = Math.floor(c.x / TILE), ty = Math.floor(c.y / TILE);
      const options = [];
      for (let d = 0; d < 4; d++) {
        if (d === (c.dir + 2) % 4) continue; // no U-turns
        const nx = tx + DIRS[d][0], ny = ty + DIRS[d][1];
        if (tileAt(this.world, nx * TILE + 32, ny * TILE + 32) === T.ROAD) options.push(d);
      }
      if (!options.length) options.push((c.dir + 2) % 4); // dead end: reverse
      const straight = options.filter((d) => d === c.dir);
      c.dir = (straight.length && this.rand() < 0.7) ? c.dir : options[Math.floor(this.rand() * options.length)];
      // Drive on the right-hand side of the road so opposing traffic can pass.
      const [dx, dy] = DIRS[c.dir];
      c.wp = {
        x: (tx + dx) * TILE + 32 - dy * 14,
        y: (ty + dy) * TILE + 32 + dx * 14,
      };
    }
    const want = Math.atan2(c.wp.y - c.y, c.wp.x - c.x);
    c.angle = angleLerp(c.angle, want, clamp(6 * dt, 0, 1));
    // Slow for cars ahead.
    let slow = 1;
    for (const o of this.cars) {
      if (o === c) continue;
      const aheadX = c.x + Math.cos(c.angle) * 46, aheadY = c.y + Math.sin(c.angle) * 46;
      if (Math.hypot(o.x - aheadX, o.y - aheadY) < 30) { slow = 0; break; }
    }
    const target = sp * slow;
    c.speed = lerp(c.speed, target, clamp(3 * dt, 0, 1));
    c.vx = Math.cos(c.angle) * c.speed; c.vy = Math.sin(c.angle) * c.speed;
    c.x += c.vx * dt; c.y += c.vy * dt;
  }

  updateCop(c, dt) {
    const p = this.player;
    const want = Math.atan2(p.y - c.y, p.x - c.x);
    let steerAway = 0;
    const aheadX = c.x + Math.cos(c.angle) * 52, aheadY = c.y + Math.sin(c.angle) * 52;
    if (solidAt(this.world, aheadX, aheadY)) steerAway = 1.4;
    c.angle = angleLerp(c.angle, want + steerAway * (Math.sin(this.time * 2 + c.x) > 0 ? 1 : -1), clamp(2.6 * dt, 0, 1));
    const target = 310;
    // Brake on arrival so contact holds long enough for a bust.
    const closing = dist(c, p) < 44 ? 0 : target;
    c.speed = lerp(c.speed, closing, clamp(2.5 * dt, 0, 1));
    c.vx = Math.cos(c.angle) * c.speed; c.vy = Math.sin(c.angle) * c.speed;
    c.x += c.vx * dt; c.y += c.vy * dt;
    for (const off of [-12, 0, 12]) {
      const sx = c.x + Math.cos(c.angle) * off, sy = c.y + Math.sin(c.angle) * off;
      const fixed = collideCircle(this.world, sx, sy, 12);
      c.x += fixed.x - sx; c.y += fixed.y - sy;
    }
  }

  updateBust(dt) {
    const p = this.player;
    const caught = this.cars.some((c) => c.type === 'cop' && dist(c, p) < 36);
    if (caught) {
      this.bustedTimer += dt;
      if (this.bustedTimer > 1.4) this.bust();
    } else {
      this.bustedTimer = Math.max(0, this.bustedTimer - dt * 2);
    }
  }

  bust() {
    this.bustedTimer = 0;
    this.heat = 0;
    const fine = Math.floor(this.cash * 0.2);
    this.cash -= fine;
    this.el['busted-sub'].textContent = fine > 0 ? `The city took $${fine} from your pocket.` : 'Lucky — your pockets were empty.';
    this.el['busted'].classList.remove('hidden');
    this.bustedShow = 2.6;
    this.sfx.blip(140, 0.5);
  }

  updatePeds(dt) {
    const p = this.player;
    for (let i = 0; i < this.peds.length; i++) {
      const ped = this.peds[i];
      if (!ped) continue;
      ped.turnAt -= dt;
      if (ped.turnAt <= 0) {
        ped.turnAt = 1 + this.rand() * 2.5;
        ped.angle = this.rand() * Math.PI * 2;
      }
      const nx = ped.x + Math.cos(ped.angle) * ped.speed * dt;
      const ny = ped.y + Math.sin(ped.angle) * ped.speed * dt;
      const t = tileAt(this.world, nx, ny);
      if (t === T.WALK || t === T.GRASS || t === T.LOT) { ped.x = nx; ped.y = ny; }
      else ped.angle += Math.PI / 2;

      // Run over by the player's car.
      if (p.mode === 'drive') {
        const spd = Math.hypot(p.car.vx, p.car.vy);
        if (spd > 130 && dist(ped, p.car) < 26) {
          this.crime(1);
          this.shake = 8;
          this.toast('You hit a pedestrian! Heat +1');
          this.sfx.crash();
          this.peds[i] = this.spawnPed();
        }
      }
    }
  }

  updateCarCollisions(dt) {
    const p = this.player;
    if (p.mode !== 'drive') return;
    const c = p.car;
    for (const o of this.cars) {
      if (o === c || o.type === 'cop') continue;
      const d = dist(c, o);
      if (d < 34 && d > 0.01) {
        const nx = (o.x - c.x) / d, ny = (o.y - c.y) / d;
        const overlap = 34 - d;
        c.x -= nx * overlap / 2; c.y -= ny * overlap / 2;
        o.x += nx * overlap / 2; o.y += ny * overlap / 2;
        const impact = Math.hypot(c.vx - o.vx, c.vy - o.vy);
        if (impact > 200) {
          this.crime(1);
          this.shake = 9;
          this.sfx.crash();
          this.toast('Reckless driving! Heat +1');
        }
        c.speed *= 0.55; c.vx *= 0.4; c.vy *= 0.4;
      }
    }
  }

  updateMission(dt) {
    const m = this.mission;
    if (!m) return;
    if (this.missionCooldown > 0) {
      this.missionCooldown -= dt;
      if (this.missionCooldown <= 0) this.setNextMissionStart();
      return;
    }
    const p = this.player;
    if (m.stage === 'toDrop') {
      m.timer -= dt;
      if (m.timer <= 0) {
        this.toast('Delivery failed — too slow. Try the job again.', 2400);
        this.sfx.blip(180, 0.3);
        this.missionCooldown = 3;
        this.mission = null;
        this.missionMarker = null;
        return;
      }
    }
    const mk = this.missionMarker;
    if (mk && dist(p, mk) < 42) {
      if (m.stage === 'toStart') {
        m.stage = 'toPickup';
        m.pickup = this.farSpot(500);
        this.missionMarker = { x: m.pickup.x, y: m.pickup.y, kind: 'pickup' };
        this.toast(`${m.def.name}: ${m.def.brief}`, 2600);
        this.sfx.blip(520, 0.12);
      } else if (m.stage === 'toPickup') {
        m.stage = 'toDrop';
        m.drop = this.farSpot(600);
        m.timer = m.def.time;
        this.missionMarker = { x: m.drop.x, y: m.drop.y, kind: 'drop' };
        this.toast('Got it — now deliver before the clock runs out!', 2200);
        this.sfx.blip(620, 0.12);
      } else if (m.stage === 'toDrop') {
        this.cash += m.def.reward;
        this.toast(`Delivered! +$${m.def.reward}`, 2400);
        this.sfx.success();
        this.missionIndex++;
        this.mission = null;
        this.missionMarker = null;
        this.missionCooldown = 4;
      }
    }
  }

  updateCamera(dt) {
    const p = this.player;
    if (!this.cam) this.cam = { x: p.x, y: p.y };
    this.cam.x = lerp(this.cam.x, p.x, clamp(6 * dt, 0, 1));
    this.cam.y = lerp(this.cam.y, p.y, clamp(6 * dt, 0, 1));
  }

  // ------------------------------------------------------------- render
  render() {
    const { ctx, canvas, world } = this;
    const w = canvas.width, h = canvas.height;
    const camX = clamp(this.cam.x - w / 2, 0, Math.max(0, world.pxWidth - w));
    const camY = clamp(this.cam.y - h / 2, 0, Math.max(0, world.pxHeight - h));
    const sx = (this.rand() - 0.5) * this.shake, sy = (this.rand() - 0.5) * this.shake;
    ctx.save();
    ctx.translate(-camX + sx, -camY + sy);

    const tx0 = Math.max(0, Math.floor(camX / TILE)), tx1 = Math.min(GRID - 1, Math.ceil((camX + w) / TILE));
    const ty0 = Math.max(0, Math.floor(camY / TILE)), ty1 = Math.min(GRID - 1, Math.ceil((camY + h) / TILE));

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = world.tiles[ty * GRID + tx];
        const x = tx * TILE, y = ty * TILE;
        if (t === T.ROAD) {
          ctx.fillStyle = '#2b2f38';
          ctx.fillRect(x, y, TILE, TILE);
          // Lane dashes along the axis that continues.
          ctx.fillStyle = 'rgba(232,236,243,.25)';
          const hRoad = isRoadTile(tx - 1, ty) || isRoadTile(tx + 1, ty);
          const vRoad = isRoadTile(tx, ty - 1) || isRoadTile(tx, ty + 1);
          if (vRoad && !hRoad) ctx.fillRect(x + TILE / 2 - 2, y + 8, 4, 22);
          else if (hRoad && !vRoad) ctx.fillRect(x + 8, y + TILE / 2 - 2, 22, 4);
        } else if (t === T.WALK) {
          ctx.fillStyle = '#3d4350'; ctx.fillRect(x, y, TILE, TILE);
        } else if (t === T.GRASS) {
          ctx.fillStyle = '#274a30'; ctx.fillRect(x, y, TILE, TILE);
        } else if (t === T.LOT) {
          ctx.fillStyle = '#333a45'; ctx.fillRect(x, y, TILE, TILE);
          ctx.strokeStyle = 'rgba(255,255,255,.12)';
          ctx.strokeRect(x + 6, y + 6, TILE - 12, TILE - 12);
        } else {
          ctx.fillStyle = '#3d4350'; ctx.fillRect(x, y, TILE, TILE); // sidewalk under buildings
        }
      }
    }

    // Buildings
    for (const b of world.buildings) {
      if (b.x > camX + w || b.y > camY + h || b.x + b.w < camX || b.y + b.h < camY) continue;
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(b.x + 6, b.y + 8, b.w, b.h);
      ctx.fillStyle = b.body;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = b.roof;
      ctx.fillRect(b.x + 10, b.y + 10, b.w - 20, b.h - 20);
      // windows
      ctx.fillStyle = 'rgba(255,255,220,.16)';
      const r = rng(b.seed);
      for (let i = 0; i < 12; i++) {
        ctx.fillRect(b.x + 16 + r() * (b.w - 40), b.y + 16 + r() * (b.h - 40), 10, 7);
      }
    }

    // Trees
    for (const t of world.trees) {
      if (t.x > camX + w || t.y > camY + h || t.x < camX || t.y < camY) continue;
      ctx.fillStyle = '#1d3a24';
      ctx.beginPath(); ctx.arc(t.x + 3, t.y + 4, t.r, 0, 7); ctx.fill();
      ctx.fillStyle = '#2f6b3a';
      ctx.beginPath(); ctx.arc(t.x, t.y, t.r, 0, 7); ctx.fill();
    }

    // Skid marks
    ctx.strokeStyle = 'rgba(20,20,24,.5)';
    ctx.lineWidth = 4;
    for (const s of this.skids) {
      ctx.globalAlpha = s.life * 0.5;
      ctx.beginPath();
      ctx.moveTo(s.x - Math.cos(s.angle) * 12, s.y - Math.sin(s.angle) * 12);
      ctx.lineTo(s.x + Math.cos(s.angle) * 12, s.y + Math.sin(s.angle) * 12);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Mission marker
    if (this.missionMarker) {
      const mk = this.missionMarker;
      const pulse = 26 + Math.sin(this.time * 5) * 7;
      ctx.strokeStyle = mk.kind === 'drop' ? '#7ee787' : '#ffd76d';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(mk.x, mk.y, pulse, 0, 7); ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = mk.kind === 'drop' ? '#7ee787' : '#ffd76d';
      ctx.beginPath(); ctx.arc(mk.x, mk.y, 12, 0, 7); ctx.fill();
      ctx.globalAlpha = 0.25;
      ctx.fillRect(mk.x - 2, mk.y - 260, 4, 260);
      ctx.globalAlpha = 1;
    }

    // Pedestrians
    for (const ped of this.peds) {
      if (!ped) continue;
      ctx.fillStyle = ped.color;
      ctx.beginPath(); ctx.arc(ped.x, ped.y, 6, 0, 7); ctx.fill();
      ctx.fillStyle = '#e8c39e';
      ctx.beginPath(); ctx.arc(ped.x, ped.y - 7, 3.4, 0, 7); ctx.fill();
    }

    // Cars
    const p = this.player;
    for (const c of this.cars) this.drawCar(c);

    // Marker above the player's own car so it stands out in traffic.
    if (p.mode === 'drive') {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 34);
      ctx.lineTo(p.x - 7, p.y - 46);
      ctx.lineTo(p.x + 7, p.y - 46);
      ctx.closePath(); ctx.fill();
    }

    // Player on foot
    if (p.mode === 'foot') {
      const bob = Math.sin(p.walkPhase) * 1.5;
      ctx.fillStyle = '#f2f5fa';
      ctx.beginPath(); ctx.arc(p.x, p.y + bob * 0.2, 7, 0, 7); ctx.fill();
      ctx.fillStyle = '#e8c39e';
      ctx.beginPath(); ctx.arc(p.x + Math.cos(p.angle) * 2, p.y - 8 + bob * 0.2, 4, 0, 7); ctx.fill();
      // direction tick
      ctx.strokeStyle = '#f2f5fa'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(p.angle) * 12, p.y + Math.sin(p.angle) * 12); ctx.stroke();
    }

    ctx.restore();
    this.renderHud();
    this.renderMinimap();
  }

  drawCar(c) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(c.angle);
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(-c.l / 2 + 3, -c.w / 2 + 4, c.l, c.w);
    ctx.fillStyle = c.color;
    ctx.beginPath();
    ctx.roundRect(-c.l / 2, -c.w / 2, c.l, c.w, 6);
    ctx.fill();
    // windshield + roof
    ctx.fillStyle = 'rgba(20,26,36,.85)';
    ctx.fillRect(2, -c.w / 2 + 4, 12, c.w - 8);
    ctx.fillStyle = 'rgba(255,255,255,.18)';
    ctx.fillRect(-12, -c.w / 2 + 5, 11, c.w - 10);
    if (c.type === 'cop') {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText('PD', -8, 3);
      const flash = Math.sin(this.time * 12) > 0;
      ctx.fillStyle = flash ? '#ff4444' : '#4488ff';
      ctx.fillRect(-4, -c.w / 2 - 3, 8, 4);
    }
    ctx.restore();
  }

  renderHud() {
    const p = this.player;
    this.el['cash'].textContent = `$${this.cash}`;
    let stars = '';
    for (let i = 0; i < 5; i++) stars += i < this.heat ? '★' : '☆';
    this.el['heat'].textContent = stars;

    const spd = p.mode === 'drive' ? Math.round(Math.hypot(p.car.vx, p.car.vy) * 0.22) : 0;
    this.el['speed'].innerHTML = p.mode === 'drive' ? `${spd} <small>km/h</small>` : '';
    if (p.mode !== 'drive') this.sfx.setEngine(0, false);

    // Mission box
    const m = this.mission, mk = this.missionMarker;
    if (m && mk) {
      this.el['mission-title'].textContent = m.def.name;
      this.el['mission-text'].textContent =
        m.stage === 'toStart' ? 'Reach the glowing marker to take the job'
        : m.stage === 'toPickup' ? 'Head to the pickup marker'
        : 'Deliver to the green marker';
      if (m.stage === 'toDrop') {
        const t = Math.max(0, m.timer);
        this.el['mission-timer'].textContent = `${t.toFixed(1)}s`;
        this.el['mission-timer'].classList.toggle('low', t < 10);
      } else this.el['mission-timer'].textContent = '';
    } else {
      this.el['mission-title'].textContent = '';
      this.el['mission-text'].textContent = this.missionCooldown > 0 ? 'Next job incoming…' : 'Explore the city';
      this.el['mission-timer'].textContent = '';
    }

    // Contextual hint
    let hint = '';
    if (p.mode === 'foot') {
      for (const c of this.cars) {
        if (c.type !== 'cop' && dist(p, c) < 60) { hint = 'Press E to enter the car'; break; }
      }
    } else if (Math.abs(p.car.speed) < 60) hint = 'E to get out · Space to drift';
    this.el['hint'].textContent = hint;
  }

  renderMinimapBase() {
    const off = document.createElement('canvas');
    off.width = off.height = 168;
    const c = off.getContext('2d');
    const s = 168 / (GRID * TILE);
    c.fillStyle = '#14181f';
    c.fillRect(0, 0, 168, 168);
    for (let ty = 0; ty < GRID; ty++) {
      for (let tx = 0; tx < GRID; tx++) {
        const t = this.world.tiles[ty * GRID + tx];
        if (t === T.ROAD) c.fillStyle = '#4a5160';
        else if (t === T.BUILDING) c.fillStyle = '#232833';
        else if (t === T.GRASS || t === T.TREE) c.fillStyle = '#1f3a28';
        else c.fillStyle = '#2c323e';
        c.fillRect(tx * TILE * s, ty * TILE * s, TILE * s + 0.5, TILE * s + 0.5);
      }
    }
    return { off, s };
  }

  renderMinimap() {
    const c = this.mmCtx, { off, s } = this.mmBase;
    c.clearRect(0, 0, 168, 168);
    c.drawImage(off, 0, 0);
    const blip = (x, y, color, r = 3) => {
      c.fillStyle = color;
      c.beginPath(); c.arc(x * s, y * s, r, 0, 7); c.fill();
    };
    for (const car of this.cars) if (car.type === 'cop') blip(car.x, car.y, '#ff7b72', 2.5);
    if (this.missionMarker) {
      const mk = this.missionMarker;
      const pulse = 3 + Math.sin(this.time * 5) * 1.2;
      blip(mk.x, mk.y, mk.kind === 'drop' ? '#7ee787' : '#ffd76d', pulse);
    }
    blip(this.player.x, this.player.y, '#ffffff', 3.2);
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    this.render();
    requestAnimationFrame((t) => this.frame(t));
  }

  start() {
    this.sfx.init();
    this.el['overlay'].classList.add('hidden');
    requestAnimationFrame((t) => { this.last = t; this.frame(t); });
  }

  // Screenshot/demo mode: skip the menu and stage a scene.
  startDemo() {
    this.el['overlay'].classList.add('hidden');
    if (this.shotMode === 'drive') {
      // Hand the player a car on the avenue just north of spawn, heading north.
      const s = this.world.spawn;
      const c = this.makeCar(s.x, s.y - TILE, -Math.PI / 2, 'player');
      c.speed = 150;
      this.cars.push(c);
      this.player.x = c.x; this.player.y = c.y;
      this.player.mode = 'drive'; this.player.car = c;
    }
    if (this.shotMode === 'mission' && this.mission) {
      // Show the job marker on foot: a short walk up the avenue, beacon in view.
      const s = this.world.spawn;
      this.missionMarker = { x: s.x, y: s.y - 3.5 * TILE, kind: 'start' };
      this.mission.start = { x: this.missionMarker.x, y: this.missionMarker.y };
    }
    // Run a fixed number of deterministic steps so headless captures a real scene.
    const fast = this.fastFrames || 0;
    for (let i = 0; i < fast; i++) this.update(1 / 60);
    requestAnimationFrame((t) => { this.last = t; this.frame(t); });
  }
}
