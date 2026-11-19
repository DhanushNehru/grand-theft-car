// Grand Theft Car 3D — stylized coastal-city driving prototype.
// Low-poly Three.js scene: city blocks, palm highway, ocean, sunset,
// a helicopter overhead, delivery missions. Original geometry only.
import * as THREE from '../vendor/three.module.js';
import { rng } from './world.js';

const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');
const FAST = parseInt(params.get('fast') || '0', 10);

const rand = rng(4451);

// ------------------------------------------------------------ layout data
const BLOCK = 46, ROAD = 18, PITCH = BLOCK + ROAD;
const CITY_N = 9;                       // blocks per side
const CITY_W = CITY_N * PITCH + ROAD;   // full span including outer roads
const COAST_X = CITY_W / 2;             // x beyond this is beach/ocean
const BUILDINGS = [];                   // {x,z,w,d,h,color}
const PALMS = [];                       // {x,z,s}

const PALETTE = [0xd9a066, 0xb56b4c, 0x8fa3b8, 0x7c8db0, 0xc98d6b, 0x9a7fb8, 0x6f9e8a];

for (let bx = 0; bx < CITY_N; bx++) {
  for (let bz = 0; bz < CITY_N; bz++) {
    const cx = -CITY_W / 2 + ROAD + bx * PITCH + BLOCK / 2;
    const cz = -CITY_W / 2 + ROAD + bz * PITCH + BLOCK / 2;
    if (rand() < 0.16) { // plaza with palms instead of a tower
      for (let i = 0; i < 4; i++) PALMS.push({ x: cx - 12 + rand() * 24, z: cz - 12 + rand() * 24, s: 0.8 + rand() * 0.5 });
      continue;
    }
    const nearCoast = cx > CITY_W / 4;
    const h = nearCoast ? 26 + rand() * 46 : 8 + rand() * 26;
    BUILDINGS.push({
      x: cx, z: cz, w: BLOCK - 10 - rand() * 6, d: BLOCK - 10 - rand() * 6, h,
      color: PALETTE[Math.floor(rand() * PALETTE.length)],
    });
  }
}
// Palm-lined coastal highway along the beach.
for (let z = -CITY_W / 2; z < CITY_W / 2; z += 26) {
  PALMS.push({ x: COAST_X - ROAD / 2 - 3, z: z + rand() * 6, s: 0.9 + rand() * 0.5 });
  PALMS.push({ x: COAST_X + ROAD / 2 + 6, z: z + 13 + rand() * 6, s: 0.9 + rand() * 0.5 });
}

// ------------------------------------------------------------ three setup
const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xff9e6d);            // sunset haze
scene.fog = new THREE.Fog(0xff9e6d, 220, 900);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2000);

const sun = new THREE.DirectionalLight(0xffd2a0, 1.6);
sun.position.set(-180, 90, 60);
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xffc4a3, 0x3a4a6b, 0.75));

const mats = {
  road: new THREE.MeshLambertMaterial({ color: 0x33363f }),
  block: new THREE.MeshLambertMaterial({ color: 0x59616e }),
  sand: new THREE.MeshLambertMaterial({ color: 0xe0c489 }),
  ocean: new THREE.MeshLambertMaterial({ color: 0x2e6f8e }),
  trunk: new THREE.MeshLambertMaterial({ color: 0x8a6742 }),
  frond: new THREE.MeshLambertMaterial({ color: 0x3f7a3a }),
  glass: new THREE.MeshLambertMaterial({ color: 0x1c2733 }),
};

// Ground: city plate, beach strip, ocean.
function slab(mat, w, d, x, z, y = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1, d), mat);
  m.position.set(x, y - 0.5, z);
  scene.add(m);
}
slab(mats.block, CITY_W + 40, CITY_W + 40, 0, 0);
slab(mats.sand, 60, CITY_W + 300, COAST_X + 30 + 20, 0);
slab(mats.ocean, 1400, CITY_W + 1400, COAST_X + 60 + 700, 0, -0.4);

// Roads: dark strips on the grid + the coastal highway.
const roadGeoH = new THREE.BoxGeometry(CITY_W, 0.1, ROAD);
const roadGeoV = new THREE.BoxGeometry(ROAD, 0.1, CITY_W);
for (let i = 0; i <= CITY_N; i++) {
  const c = -CITY_W / 2 + i * PITCH + ROAD / 2 - ROAD / 2 + ROAD / 2; // road centers between blocks
  const rm1 = new THREE.Mesh(roadGeoH, mats.road); rm1.position.set(0, 0.06, -CITY_W / 2 + ROAD / 2 + i * PITCH - (i === 0 ? 0 : 0)); scene.add(rm1);
  const rm2 = new THREE.Mesh(roadGeoV, mats.road); rm2.position.set(-CITY_W / 2 + ROAD / 2 + i * PITCH, 0.06, 0); scene.add(rm2);
}
const highway = new THREE.Mesh(new THREE.BoxGeometry(ROAD + 8, 0.12, CITY_W + 300), mats.road);
highway.position.set(COAST_X + ROAD / 2 + 24, 0.06, 0);
scene.add(highway);
// Lane dashes down the highway centerline.
const dashGeo = new THREE.BoxGeometry(0.4, 0.04, 3);
const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8dde6 });
for (let z = -CITY_W / 2 - 140; z < CITY_W / 2 + 140; z += 9) {
  const d = new THREE.Mesh(dashGeo, dashMat);
  d.position.set(COAST_X + ROAD / 2 + 24, 0.14, z);
  scene.add(d);
}

// Buildings
for (const b of BUILDINGS) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), new THREE.MeshLambertMaterial({ color: b.color }));
  m.position.set(b.x, b.h / 2, b.z);
  scene.add(m);
  // rooftop box for silhouette variety
  const top = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.5, 3, b.d * 0.5), mats.glass);
  top.position.set(b.x, b.h + 1.5, b.z);
  scene.add(top);
}

// Palms: trunk + a crown of tilted cones.
function palm(x, z, s) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * s, 0.4 * s, 7 * s, 5), mats.trunk);
  trunk.position.y = 3.5 * s;
  g.add(trunk);
  for (let i = 0; i < 6; i++) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.5 * s, 3.4 * s, 4), mats.frond);
    const a = (i / 6) * Math.PI * 2;
    f.position.set(Math.cos(a) * 1.1 * s, 7 * s, Math.sin(a) * 1.1 * s);
    f.rotation.set(Math.sin(a) * 1.1, 0, Math.cos(a) * -1.1);
    g.add(f);
  }
  g.position.set(x, 0, z);
  scene.add(g);
}
for (const p of PALMS) palm(p.x, p.z, p.s);

// ------------------------------------------------------------ vehicles
function makeCarMesh(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.7, 4.4), new THREE.MeshLambertMaterial({ color }));
  body.position.y = 0.65;
  g.add(body);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.6, 2.1), mats.glass);
  cabin.position.set(0, 1.25, -0.2);
  g.add(cabin);
  const wg = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10);
  const wm = new THREE.MeshLambertMaterial({ color: 0x14161c });
  for (const [x, z] of [[-1, 1.45], [1, 1.45], [-1, -1.45], [1, -1.45]]) {
    const w = new THREE.Mesh(wg, wm);
    w.rotation.z = Math.PI / 2;
    w.position.set(x, 0.42, z);
    g.add(w);
  }
  return g;
}

const carColors = [0xe06c60, 0x61afef, 0x98c379, 0xe5c07b, 0xc678dd, 0x56b6c2];
const car = { x: COAST_X + ROAD / 2 + 24, z: 30, angle: 0, vx: 0, vz: 0, speed: 0, mesh: makeCarMesh(0xe06c60) };
scene.add(car.mesh);

// Simple traffic on the coastal highway, two lanes, up and down.
const traffic = [];
for (let i = 0; i < 10; i++) {
  const dir = i % 2 === 0 ? 1 : -1;
  const t = {
    x: COAST_X + ROAD / 2 + 24 + dir * 5,
    z: -CITY_W / 2 - 120 + rand() * (CITY_W + 240),
    dir, speed: 26 + rand() * 10,
    mesh: makeCarMesh(carColors[Math.floor(rand() * carColors.length)]),
  };
  scene.add(t.mesh);
  traffic.push(t);
}

// Helicopter circling the skyline.
const heli = new THREE.Group();
{
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 5), new THREE.MeshLambertMaterial({ color: 0x37414f }));
  heli.add(body);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 4), new THREE.MeshLambertMaterial({ color: 0x37414f }));
  tail.position.set(0, 0.4, 4); heli.add(tail);
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 0.5), new THREE.MeshLambertMaterial({ color: 0x1c2733 }));
  rotor.position.y = 1; heli.add(rotor);
  heli.userData.rotor = rotor;
}
scene.add(heli);

// Mission beacon
const beacon = new THREE.Mesh(
  new THREE.CylinderGeometry(2.6, 2.6, 90, 16, 1, true),
  new THREE.MeshBasicMaterial({ color: 0xffd76d, transparent: true, opacity: 0.28, side: THREE.DoubleSide })
);
beacon.position.set(COAST_X + ROAD / 2 + 24, 45, -80);
scene.add(beacon);
const beaconRing = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.3, 8, 24), new THREE.MeshBasicMaterial({ color: 0xffd76d }));
beaconRing.rotation.x = Math.PI / 2;
scene.add(beaconRing);

// ------------------------------------------------------------ game state
const el = {};
for (const id of ['cash', 'mission-title', 'mission-text', 'mission-timer', 'speed', 'hint', 'toast', 'minimap', 'overlay']) el[id] = document.getElementById(id);
const mm = el['minimap'].getContext('2d');

const MISSIONS3D = [
  { name: 'Beach Run', brief: 'Deliver into the downtown grid before time runs out.', reward: 150, time: 45, start: { x: COAST_X + ROAD / 2 + 24, z: -80 }, to: { x: -CITY_W / 4, z: CITY_W / 4 } },
  { name: 'Skyline Dash', brief: 'Back to the coast, fast as you can.', reward: 260, time: 55, start: { x: 32, z: -CITY_W / 4 }, to: { x: COAST_X + ROAD / 2 + 24, z: CITY_W / 3 } },
  { name: 'Palm Circuit', brief: 'One more across the city center.', reward: 420, time: 60, start: { x: COAST_X + ROAD / 2 + 24, z: CITY_W / 3 }, to: { x: -96, z: -96 } },
];

const state = { cash: 0, idx: 0, stage: 'drive', timer: 0, time: 0 };
beacon.position.set(MISSIONS3D[0].start.x, 45, MISSIONS3D[0].start.z);
const keys = { up: 0, down: 0, left: 0, right: 0, brake: 0 };
const keymap = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', ' ': 'brake' };
addEventListener('keydown', (e) => { const k = keymap[e.key.toLowerCase()]; if (k) { e.preventDefault(); keys[k] = 1; } });
addEventListener('keyup', (e) => { const k = keymap[e.key.toLowerCase()]; if (k) keys[k] = 0; });

// On-screen touch controls (shown on coarse-pointer devices by CSS).
{
  const touchUI = document.getElementById('touch');
  if (touchUI) {
    for (const btn of touchUI.querySelectorAll('button')) {
      const k = btn.dataset.k;
      const on = (e) => { e.preventDefault(); keys[k] = 1; };
      const off = (e) => { e.preventDefault(); keys[k] = 0; };
      btn.addEventListener('touchstart', on, { passive: false });
      btn.addEventListener('touchend', off, { passive: false });
      btn.addEventListener('touchcancel', off, { passive: false });
      btn.addEventListener('mousedown', on);
      btn.addEventListener('mouseup', off);
      btn.addEventListener('mouseleave', off);
    }
  }
}

function toast(text, ms = 2000) {
  el['toast'].textContent = text;
  el['toast'].classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el['toast'].classList.remove('show'), ms);
}

function collideBuildings(c) {
  for (const b of BUILDINGS) {
    const hw = b.w / 2 + 1.2, hd = b.d / 2 + 1.2;
    const dx = c.x - b.x, dz = c.z - b.z;
    if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
      const px = hw - Math.abs(dx), pz = hd - Math.abs(dz);
      if (px < pz) { c.x += Math.sign(dx) * px; c.vx *= -0.3; }
      else { c.z += Math.sign(dz) * pz; c.vz *= -0.3; }
      c.speed *= 0.5;
    }
  }
  // Keep the car on land.
  c.x = Math.min(c.x, COAST_X + ROAD + 30);
  c.x = Math.max(c.x, -CITY_W / 2 - 10);
  c.z = Math.max(-CITY_W / 2 - 130, Math.min(CITY_W / 2 + 130, c.z));
}

function update(dt) {
  state.time += dt;
  // car physics (same arcade model as the 2D build, on the XZ plane)
  if (keys.up) car.speed += 34 * dt * 0.45;
  else if (keys.down) car.speed -= (car.speed > 0 ? 60 * 0.8 : 26 * 0.5) * dt;
  else car.speed -= car.speed * 1.4 * dt;
  car.speed = Math.max(-12, Math.min(34, car.speed));
  const steer = (keys.right - keys.left);
  if (Math.abs(car.speed) > 1.5) {
    const grip = Math.min(1, Math.abs(car.speed) / 16);
    car.angle -= steer * 1.5 * grip * dt * Math.sign(car.speed) * (keys.brake ? 1.8 : 1);
  }
  if (keys.brake) car.speed -= car.speed * 0.9 * dt;
  const gripT = keys.brake ? 2.4 : 9;
  const tvx = Math.sin(car.angle) * car.speed, tvz = Math.cos(car.angle) * car.speed;
  car.vx += (tvx - car.vx) * Math.min(1, gripT * dt);
  car.vz += (tvz - car.vz) * Math.min(1, gripT * dt);
  car.x += car.vx * dt; car.z += car.vz * dt;
  collideBuildings(car);

  // traffic
  for (const t of traffic) {
    t.z += t.dir * t.speed * dt;
    if (t.z > CITY_W / 2 + 140) t.z = -CITY_W / 2 - 140;
    if (t.z < -CITY_W / 2 - 140) t.z = CITY_W / 2 + 140;
    // gentle brake if player is ahead in the same lane
    if (Math.abs(t.x - car.x) < 4 && (car.z - t.z) * t.dir > 0 && (car.z - t.z) * t.dir < 12) t.z -= t.dir * t.speed * dt * 0.7;
    t.mesh.position.set(t.x, 0, t.z);
    t.mesh.rotation.y = t.dir > 0 ? 0 : Math.PI;
  }

  // helicopter
  const ha = state.time * 0.16;
  heli.position.set(Math.cos(ha) * 160 - 40, 62 + Math.sin(state.time * 0.5) * 4, Math.sin(ha) * 160);
  heli.rotation.y = -ha - Math.PI / 2;
  heli.userData.rotor.rotation.y += dt * 30;

  // mission
  const m = MISSIONS3D[state.idx % MISSIONS3D.length];
  if (state.stage === 'timed') {
    state.timer -= dt;
    if (state.timer <= 0) {
      state.stage = 'drive';
      beacon.position.set(m.start.x, 45, m.start.z);
      beacon.material.color.set(0xffd76d); beaconRing.material.color.set(0xffd76d);
      toast('Too slow — job failed, find the marker to retry');
    }
  }
  const dx = car.x - beacon.position.x, dz = car.z - beacon.position.z;
  if (Math.hypot(dx, dz) < 5) {
    if (state.stage === 'drive') {
      state.stage = 'timed'; state.timer = m.time;
      beacon.position.set(m.to.x, 45, m.to.z);
      beacon.material.color.set(0x7ee787); beaconRing.material.color.set(0x7ee787);
      toast(`${m.name}: ${m.brief}`, 2600);
    } else {
      state.cash += m.reward; state.idx++;
      const nm = MISSIONS3D[state.idx % MISSIONS3D.length];
      beacon.position.set(nm.start.x, 45, nm.start.z);
      beacon.material.color.set(0xffd76d); beaconRing.material.color.set(0xffd76d);
      state.stage = 'drive';
      toast(`Delivered! +$${m.reward}`, 2400);
    }
  }
  beaconRing.position.set(beacon.position.x, 1 + Math.sin(state.time * 3) * 0.4, beacon.position.z);
  beaconRing.scale.setScalar(1 + Math.sin(state.time * 3) * 0.12);
}

function render() {
  car.mesh.position.set(car.x, 0, car.z);
  car.mesh.rotation.y = car.angle;
  // chase camera
  const back = 10.5, up = 4.4;
  const tx = car.x - Math.sin(car.angle) * back, tz = car.z - Math.cos(car.angle) * back;
  camera.position.lerp(new THREE.Vector3(tx, up, tz), 0.35);
  camera.lookAt(car.x + Math.sin(car.angle) * 8, 1.6, car.z + Math.cos(car.angle) * 8);
  renderer.render(scene, camera);

  // HUD
  el['cash'].textContent = `$${state.cash}`;
  el['speed'].innerHTML = `${Math.round(Math.hypot(car.vx, car.vz) * 3.6)} <small>km/h</small>`;
  const m = MISSIONS3D[state.idx % MISSIONS3D.length];
  el['mission-title'].textContent = m.name;
  el['mission-text'].textContent = state.stage === 'drive' ? 'Follow the beacon to take the job' : m.brief;
  if (state.stage === 'timed') {
    el['mission-timer'].textContent = `${Math.max(0, state.timer).toFixed(1)}s`;
    el['mission-timer'].classList.toggle('low', state.timer < 10);
  } else el['mission-timer'].textContent = '';

  // minimap: dots over a simple grid; the view spans the whole city
  // plus the coastal highway and beach strip so player and beacon stay visible
  mm.clearRect(0, 0, 168, 168);
  mm.fillStyle = '#14181f'; mm.fillRect(0, 0, 168, 168);
  const MAP_MIN = -CITY_W / 2 - 10, MAP_MAX = COAST_X + ROAD + 60;
  const s = 168 / (MAP_MAX - MAP_MIN);
  const px = (x) => (x - MAP_MIN) * s;
  mm.fillStyle = '#4a5160';
  for (let i = 0; i <= CITY_N; i++) {
    mm.fillRect(0, px(-CITY_W / 2 + ROAD / 2 + i * PITCH) - 1, 168, 2);
    mm.fillRect(px(-CITY_W / 2 + ROAD / 2 + i * PITCH) - 1, 0, 2, 168);
  }
  mm.fillStyle = '#2e6f8e'; mm.fillRect(px(COAST_X + ROAD + 34), 0, 168, 168);
  const blip = (x, z, c, r = 3) => { mm.fillStyle = c; mm.beginPath(); mm.arc(px(x), px(z), r, 0, 7); mm.fill(); };
  blip(beacon.position.x, beacon.position.z, state.stage === 'timed' ? '#7ee787' : '#ffd76d', 4);
  blip(car.x, car.z, '#ffffff', 3.4);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function start() {
  el['overlay'].classList.add('hidden');
  camera.position.set(car.x - Math.sin(car.angle) * 10.5, 4.4, car.z - Math.cos(car.angle) * 10.5);
  requestAnimationFrame((t) => { last = t; frame(t); });
}

document.getElementById('start-btn').addEventListener('click', start);

// Headless/demo mode: skip menu, drive scripted frames, expose state.
window.__g3 = { car, state, keys, update, render, camera };
if (SHOT) {
  el['overlay'].classList.add('hidden');
  if (SHOT === 'drive') { keys.up = 1; }
  if (SHOT === 'mission') { car.angle = Math.PI; keys.up = 1; } // south toward the beacon
  for (let i = 0; i < FAST; i++) update(1 / 60);
  // Snap the chase cam behind the car after the scripted run.
  camera.position.set(car.x - Math.sin(car.angle) * 10.5, 4.4, car.z - Math.cos(car.angle) * 10.5);
  render();
  requestAnimationFrame((t) => { last = t; frame(t); });
}
