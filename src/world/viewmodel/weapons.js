import * as THREE from "three/webgpu";
import { getAudioVolume } from "../../audio/audioState.js";

/**
 * Extra player weapons for the first-person rig. They ride on the rifle's own animated bones
 * (Body / Slider / Trigger), so every existing rifle animation (idle, walk, run, sprint, recoil,
 * reload) drives them for free. Geometry is authored in camera space at the Idle pose
 * (x right, y up, -z forward); INV_* turns that into each bone's local space.
 */
const INV_BODY = [-0.996407, 0.002, 0.084665, 0, -0.084639, 0.010666, -0.996355, 0, -0.002896, -0.999941, -0.010458, 0, 0.009252, -0.816268, -0.258204, 1];
const INV_SLIDER = [-0.996407, 0.002, 0.084665, 0, -0.08464, 0.010666, -0.996355, 0, -0.002896, -0.999941, -0.010459, 0, 0.009252, -0.742844, -0.258204, 1];
const INV_TRIGGER = [-0.996408, 0.084662, -0.001997, 0, -0.084637, -0.996355, -0.010665, 0, -0.002893, -0.010458, 0.999941, 0, 0.009255, -0.278034, 0.701102, 1];

export const WEAPONS = {
  rifle: { label: "VSK-94", auto: true },
  pistol: { label: "PISTOL", magSize: 12, reserve: 60, fireInterval: 0.2, fireHold: 0.13, auto: false, muzzle: [0.035, 0.2, -0.4] },
  katana: { label: "KATANA", melee: true, reach: 3.1, cooldown: 0.62, hitAt: 0.2, duration: 0.62 },
};
export const ORDER = ["rifle", "pistol", "katana"];
/** Camera-space pivot the katana swing rotates around (about where the hands are). */
export const SWING_PIVOT = new THREE.Vector3(0.03, -0.3, -0.66);

const mats = {};
function mat(name, color, { metal = 0.2, rough = 0.7, emissive = 0, side } = {}) {
  if (!mats[name]) {
    const m = new THREE.MeshStandardMaterial({ color, metalness: metal, roughness: rough, emissive: emissive ? color : 0x000000, emissiveIntensity: emissive });
    if (side) m.side = side;
    m.userData.rgb = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
    mats[name] = m;
  }
  return mats[name];
}
function glowMat(name, color) {
  if (!mats[name]) {
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
    m.userData.rgb = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
    mats[name] = m;
  }
  return mats[name];
}
const steel = () => mat("steel", 0x2b2f36, { metal: 0.85, rough: 0.32, emissive: 0.12 });
const polymer = () => mat("polymer", 0x15161a, { metal: 0.1, rough: 0.8, emissive: 0.1 });
const cyan = () => glowMat("cyan", 0x22d3ee);

function box(parent, w, h, d, x, y, z, material, rx = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  m.position.set(x, y, z);
  m.rotation.x = rx;
  m.frustumCulled = false;
  m.renderOrder = 10;
  m.userData.rgb = material.userData.rgb;
  parent.add(m);
  return m;
}
function cyl(parent, r, len, x, y, z, material, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), material);
  m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  m.frustumCulled = false;
  m.renderOrder = 10;
  m.userData.rgb = material.userData.rgb;
  parent.add(m);
  return m;
}
function holder(invArr) {
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;
  g.matrix.fromArray(invArr);
  g.matrixWorldNeedsUpdate = true;
  return g;
}

function buildPistol() {
  const body = holder(INV_BODY), slide = holder(INV_SLIDER), trig = holder(INV_TRIGGER);
  const X = 0.035;
  // slide (rides the rifle's Slider bone, so it racks back on every shot)
  box(slide, 0.032, 0.042, 0.25, X, -0.243, -0.705, steel());
  box(slide, 0.034, 0.036, 0.034, X, -0.243, -0.605, steel()); // rear block
  for (let i = 0; i < 4; i++) box(slide, 0.0345, 0.034, 0.004, X, -0.243, -0.6 - i * 0.009, polymer()); // serrations
  box(slide, 0.005, 0.003, 0.17, X, -0.2215, -0.715, cyan()); // glowing top strip
  box(slide, 0.004, 0.008, 0.006, X, -0.218, -0.822, steel()); // front sight
  box(slide, 0.014, 0.007, 0.006, X, -0.218, -0.592, steel()); // rear sight
  cyl(slide, 0.0075, 0.04, X, -0.246, -0.848, steel());        // barrel tip
  // frame, grip, guard, foregrip (static on the Body bone)
  box(body, 0.028, 0.022, 0.215, X, -0.268, -0.68, steel());
  box(body, 0.03, 0.125, 0.07, X, -0.33, -0.617, polymer(), -0.2); // grip
  box(body, 0.026, 0.004, 0.066, X, -0.299, -0.693, steel());       // guard bottom
  box(body, 0.026, 0.028, 0.004, X, -0.286, -0.725, steel());       // guard front
  box(body, 0.03, 0.062, 0.04, X - 0.002, -0.305, -0.765, polymer()); // vertical foregrip for the left hand
  box(body, 0.032, 0.004, 0.042, X - 0.002, -0.338, -0.765, cyan()); // grip ring
  box(body, 0.012, 0.012, 0.012, X, -0.232, -0.585, steel());        // hammer
  box(trig, 0.006, 0.02, 0.006, X, -0.287, -0.686, steel());         // trigger
  const mag = new THREE.Group();
  box(mag, 0.034, 0.014, 0.076, X, -0.398, -0.598, steel(), -0.2);  // magazine base plate (hidden while reloading)
  body.add(mag);
  return { body, slide, trig, mag, all: [body, slide, trig] };
}

function buildKatana() {
  const body = holder(INV_BODY);
  const AX = 0.033, AY = -0.285;
  // tsuka: red / black wrap
  const n = 11, z0 = -0.535, z1 = -0.88, step = (z1 - z0) / n;
  for (let i = 0; i < n; i++) box(body, 0.034, 0.03, Math.abs(step) * 0.96, AX, AY, z0 + step * (i + 0.5), i % 2 ? mat("wrapB", 0x0b0b0e, { rough: 0.9 }) : mat("wrapR", 0x6b1020, { rough: 0.8, emissive: 0.15 }));
  box(body, 0.038, 0.034, 0.012, AX, AY, -0.53, steel());                            // kashira
  // tsuba: octagon guard with a neon rim
  const g8 = new THREE.CylinderGeometry(0.047, 0.047, 0.007, 8);
  const tsuba = new THREE.Mesh(g8, steel()); tsuba.rotation.x = Math.PI / 2; tsuba.position.set(AX, AY, -0.887); tsuba.frustumCulled = false; tsuba.renderOrder = 10; tsuba.userData.rgb = steel().userData.rgb; body.add(tsuba);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.0495, 0.0495, 0.0025, 8), cyan()); rim.rotation.x = Math.PI / 2; rim.position.set(AX, AY, -0.8915); rim.frustumCulled = false; rim.renderOrder = 10; rim.userData.rgb = cyan().userData.rgb; body.add(rim);
  box(body, 0.03, 0.026, 0.022, AX, AY, -0.903, mat("habaki", 0xb8923a, { metal: 0.9, rough: 0.35, emissive: 0.2 })); // habaki collar
  // blade: curved, spine on top, edge below
  const N = 16, L = 0.83, zs = -0.912, P = [];
  const sec = (t) => { const z = zs - L * t, yc = AY + 0.03 * t + 0.032 * t * t, h = 0.0155 * (1 - 0.35 * t), th = 0.0036 * (1 - 0.3 * t);
    return [[-th, yc + h, z], [th, yc + h, z], [th, yc - h * 0.2, z], [0, yc - h, z], [-th, yc - h * 0.2, z]]; };
  const tri = [], edge = [];
  for (let i = 0; i < N; i++) { const a = sec(i / N), b = sec((i + 1) / N); for (let k = 0; k < 5; k++) { const k2 = (k + 1) % 5; tri.push(a[k], b[k], b[k2], a[k], b[k2], a[k2]); } edge.push(a[3]); }
  const last = sec(1); edge.push(last[3]); const tip = [0, last[3][1] + 0.013, last[3][2] - 0.03];
  for (let k = 0; k < 5; k++) tri.push(last[k], tip, last[(k + 1) % 5]);
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(tri.flat(), 3)); geo.computeVertexNormals();
  const bladeMat = mat("blade", 0xc9d4de, { metal: 0.95, rough: 0.2, emissive: 0.28, side: THREE.DoubleSide });
  const blade = new THREE.Mesh(geo, bladeMat); blade.frustumCulled = false; blade.renderOrder = 10; blade.userData.rgb = [200, 212, 222]; body.add(blade);
  const ribbon = []; for (let i = 0; i < edge.length - 1; i++) { const a = edge[i], b = edge[i + 1]; ribbon.push([a[0] - 0.0028, a[1] - 0.001, a[2]], [a[0] + 0.0028, a[1] - 0.001, a[2]], [b[0] + 0.0028, b[1] - 0.001, b[2]], [a[0] - 0.0028, a[1] - 0.001, a[2]], [b[0] + 0.0028, b[1] - 0.001, b[2]], [b[0] - 0.0028, b[1] - 0.001, b[2]]); }
  const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.Float32BufferAttribute(ribbon.flat(), 3)); rg.computeVertexNormals();
  const glow = new THREE.Mesh(rg, cyan()); glow.frustumCulled = false; glow.renderOrder = 11; glow.userData.rgb = cyan().userData.rgb; body.add(glow);
  return { body, all: [body] };
}

/** Builds both weapons and parents them to the animated rifle bones. */
export function buildWeapons(bones) {
  const p = buildPistol(), k = buildKatana();
  const B = bones.Body_051, S = bones.Slider_052, T = bones.Trigger_053;
  if (!B || !S || !T) throw new Error("[weapons] Body/Slider/Trigger bones not found");
  B.add(p.body); S.add(p.slide); T.add(p.trig); B.add(k.body);
  const pistol = { set visible(v) { p.all.forEach((g) => (g.visible = v)); } };
  const katana = { set visible(v) { k.body.visible = v; } };
  pistol.visible = false; katana.visible = false;
  return { pistol, katana, pistolMag: p.mag };
}

/* ---------------------------------------------------------------- sounds (synth, no assets) */
let ac = null, noise = null;
function audio() {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext; if (!AC) return null;
  if (!ac) { ac = new AC(); noise = ac.createBuffer(1, Math.floor(ac.sampleRate * 0.4), ac.sampleRate); const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  if (ac.state === "suspended") ac.resume?.(); return ac;
}
const vol = () => getAudioVolume?.() ?? 1;
function burst(c, t, { hp = 0, bp = 0, q = 0.8, gain, decay, attack = 0.001 }) {
  const s = c.createBufferSource(); s.buffer = noise; let n = s;
  if (hp) { const f = c.createBiquadFilter(); f.type = "highpass"; f.frequency.value = hp; n = n.connect(f); }
  if (bp) { const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = bp; f.Q.value = q; n = n.connect(f); }
  const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
  n.connect(g).connect(c.destination); s.start(t, Math.random() * 0.2); s.stop(t + decay + 0.02);
}
export function pistolShot() { try { const c = audio(); if (!c) return; const t = c.currentTime + 0.001, v = vol() * 0.6;
  burst(c, t, { hp: 1300, bp: 2600, q: 0.7, gain: 0.9 * v, decay: 0.075 }); burst(c, t, { bp: 800, q: 0.9, gain: 0.55 * v, decay: 0.13 }); burst(c, t + 0.09, { bp: 2000, q: 0.7, gain: 0.2 * v, decay: 0.14, attack: 0.005 });
  const o = c.createOscillator(); o.type = "sine"; o.frequency.setValueAtTime(230, t); o.frequency.exponentialRampToValueAtTime(65, t + 0.09); const g = c.createGain(); g.gain.setValueAtTime(0.6 * v, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.11); o.connect(g).connect(c.destination); o.start(t); o.stop(t + 0.13); } catch { /* optional */ } }
export function katanaSwoosh() { try { const c = audio(); if (!c) return; const t = c.currentTime, v = vol() * 0.55;
  const s = c.createBufferSource(); s.buffer = noise; const f = c.createBiquadFilter(); f.type = "bandpass"; f.Q.value = 1.3; f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(3800, t + 0.22);
  const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.1); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); s.connect(f).connect(g).connect(c.destination); s.start(t); s.stop(t + 0.32); } catch { /* optional */ } }

/* ---------------------------------------------------------------- katana: melee + swing motion */
const fwd = new THREE.Vector3();
/** Hits every living enemy inside the cone in front of the camera. Returns how many were hit. */
export function meleeStrike(camera, world) {
  const agents = world?.enemyAI?.agents; if (!agents) return 0;
  fwd.set(0, 0, -1).applyQuaternion(camera.quaternion); fwd.y = 0; if (fwd.lengthSq() < 1e-6) return 0; fwd.normalize();
  let n = 0;
  for (const a of agents) {
    if (!a?.env?.isAlive?.()) continue;
    const p = a.env.getEnemyPosition(); const dx = p.x - camera.position.x, dz = p.z - camera.position.z, d = Math.hypot(dx, dz);
    if (d > WEAPONS.katana.reach) continue; if (d > 0.9 && (dx * fwd.x + dz * fwd.z) / d < 0.5) continue; if (Math.abs(p.y - camera.position.y) > 1.8) continue;
    a.registerHit({ point: new THREE.Vector3(p.x, p.y - 0.3, p.z), part: "melee" }); n++;
  }
  return n;
}
const sm = (a, b, t) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
const KEYS = [ // [time, [dx,dy,dz], [rx,ry,rz]] for the right-to-left cut; kind 1 mirrors x / yaw / roll
  [0.0, [0, 0, 0], [0, 0, 0]], [0.28, [0.1, 0.1, 0.1], [0.5, -0.22, -0.65]], [0.5, [-0.08, -0.1, -0.26], [-0.5, 0.4, 0.75]], [0.68, [-0.11, -0.13, -0.28], [-0.62, 0.5, 0.85]], [1.0, [0, 0, 0], [0, 0, 0]],
];
/** Rig offset for the katana swing at time t (seconds, 0..duration): { d:[x,y,z], r:[x,y,z] }. */
export function swingPose(kind, t) {
  const u = Math.min(1, Math.max(0, t / WEAPONS.katana.duration)); let i = 0; while (i < KEYS.length - 2 && u > KEYS[i + 1][0]) i++;
  const k = sm(KEYS[i][0], KEYS[i + 1][0], u); const d = lerp3(KEYS[i][1], KEYS[i + 1][1], k), r = lerp3(KEYS[i][2], KEYS[i + 1][2], k);
  if (kind) { d[0] = -d[0]; r[1] = -r[1]; r[2] = -r[2]; }
  return { d, r };
}
