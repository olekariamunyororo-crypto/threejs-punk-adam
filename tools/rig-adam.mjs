// Adds Walk / Run / Attack / Die clips to adam_smasher_rigged.glb (procedural, baked @30fps)
// Usage (project root):  node tools/rig-adam.mjs   [FORCE=1 to rebuild]
import fs from 'node:fs';
import * as THREE from 'three';

const PATH = process.argv[2] || 'public/models/adam_smasher_rigged.glb';
const FPS = 30, WANT = ['Walk', 'Run', 'Attack', 'Die'];

const buf = fs.readFileSync(PATH);
if (buf.toString('latin1', 0, 4) !== 'glTF') throw new Error('Not a GLB: ' + PATH);
const chunks = [];
for (let o = 12; o < buf.length;) {
  const len = buf.readUInt32LE(o);
  chunks.push({ type: buf.readUInt32LE(o + 4), data: buf.subarray(o + 8, o + 8 + len) });
  o += 8 + len;
}
const jc = chunks.find((c) => c.type === 0x4e4f534a), bc = chunks.find((c) => c.type === 0x004e4942);
const g = JSON.parse(jc.data.toString('utf8'));

const have = (g.animations || []).filter((a) => WANT.includes(a.name)).map((a) => a.name);
if (have.length && process.env.FORCE !== '1') {
  console.log('Already rigged (' + have.join(', ') + '). Use FORCE=1 to rebuild.');
  process.exit(0);
}
g.animations = (g.animations || []).filter((a) => !WANT.includes(a.name));

// ---------- skeleton FK (for grounding feet) ----------
const id = {}; g.nodes.forEach((n, i) => (id[n.name] = i));
const objs = g.nodes.map((n) => {
  const o = new THREE.Object3D();
  if (n.translation) o.position.fromArray(n.translation);
  if (n.rotation) o.quaternion.fromArray(n.rotation);
  return o;
});
g.nodes.forEach((n, i) => (n.children || []).forEach((c) => objs[i].add(objs[c])));
const JOINTS = g.skins[0].joints.map((j) => g.nodes[j].name);
const rest = {}; JOINTS.forEach((n) => (rest[n] = objs[id[n]].quaternion.clone()));
const HIPS_Y = g.nodes[id.Hips].translation[1];
const FEET = ['LeftFoot', 'LeftToeBase', 'LeftToeEnd', 'RightFoot', 'RightToeBase', 'RightToeEnd'];
const eul = new THREE.Euler(), tq = new THREE.Quaternion(), wp = new THREE.Vector3();

function apply(pose, h) {
  for (const n of JOINTS) {
    const o = objs[id[n]], e = pose[n];
    if (e) { eul.set(e[0], e[1], e[2], 'XYZ'); tq.setFromEuler(eul); o.quaternion.copy(rest[n]).multiply(tq); }
    else o.quaternion.copy(rest[n]);
  }
  objs[id.Hips].position.set(h[0], h[1], h[2]);
  objs[0].updateMatrixWorld(true);
}
const minY = (names) => Math.min(...names.map((n) => objs[id[n]].getWorldPosition(wp).y));
apply({}, [0, HIPS_Y, 0]);
const REST_FOOT = minY(FEET);
const feetY = (pose, x, z) => { apply(pose, [x, HIPS_Y, z]); return HIPS_Y + REST_FOOT - minY(FEET); };
const bodyY = (pose, x, y, z, floor = 0.1) => { apply(pose, [x, y, z]); return y + Math.max(0, floor - minY(JOINTS)); };
const smooth = (a, b, t) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };

// ---------- gaits (rotX<0 = swing forward for limbs, >0 = lean forward for spine) ----------
function gait(phi, p) {
  const s = Math.sin(phi), c = Math.cos(phi), L = p.lean;
  const lt = -p.thigh * s, rt = p.thigh * s;
  const lk = p.kneeBase + p.knee * Math.max(0, c), rk = p.kneeBase + p.knee * Math.max(0, -c);
  return {
    pose: {
      Hips: [0.3 * L, -p.twist * s, p.roll * s],
      Spine: [0.25 * L, 0.6 * p.twist * s, -0.5 * p.roll * s],
      Spine1: [0.25 * L, 0.9 * p.twist * s, 0],
      Spine2: [0.2 * L, 0.6 * p.twist * s, 0],
      Head: [-0.7 * L, 0.3 * p.twist * s, 0],
      LeftUpLeg: [lt, 0, 0], RightUpLeg: [rt, 0, 0],
      LeftLeg: [lk, 0, 0], RightLeg: [rk, 0, 0],
      LeftFoot: [-0.6 * (lt + lk), 0, 0], RightFoot: [-0.6 * (rt + rk), 0, 0],
      LeftArm: [p.arm * s, 0, 0], RightArm: [-p.arm * s, 0, 0],
      LeftForeArm: [-p.elbow + p.elbowSwing * s, 0, 0], RightForeArm: [-p.elbow - p.elbowSwing * s, 0, 0],
    },
    x: p.sway * s, z: 0,
  };
}
const WALK = { thigh: 0.55, kneeBase: 0.06, knee: 0.75, arm: 0.32, elbow: 0.3, elbowSwing: 0.12, lean: 0.06, twist: 0.1, roll: 0.03, sway: 0.015 };
const RUN = { thigh: 0.95, kneeBase: 0.25, knee: 1.15, arm: 0.85, elbow: 1.25, elbowSwing: 0.3, lean: 0.3, twist: 0.22, roll: 0.05, sway: 0.02 };

// aim + fire loop (0.6s): right arm levelled forward, recoil kick each cycle
const rec = (u) => (u < 0.12 ? Math.sin((u / 0.12) * Math.PI / 2) : Math.pow(1 - (u - 0.12) / 0.88, 2));
function attack(t) {
  const r = rec(Math.min(1, t / 0.6));
  return {
    pose: {
      Hips: [0.04, 0.2, 0], Spine: [-0.03 - 0.08 * r, -0.1, 0], Spine1: [-0.03 - 0.06 * r, -0.1, 0], Spine2: [-0.02 - 0.04 * r, 0, 0],
      Head: [-0.02 - 0.05 * r, 0, 0],
      RightArm: [-1.45 - 0.22 * r, 0, 0.52], RightForeArm: [-0.1 - 0.35 * r, 0, 0],
      LeftArm: [-1.2 - 0.1 * r, 0, -0.8], LeftForeArm: [-0.7, 0, 0],
      LeftUpLeg: [-0.25, 0, 0.06], LeftLeg: [0.35 + 0.05 * r, 0, 0], LeftFoot: [-0.1, 0, 0],
      RightUpLeg: [0.15, 0, -0.06], RightLeg: [0.25, 0, 0], RightFoot: [-0.1, 0, 0],
    }, x: 0, z: 0,
  };
}

// death: stagger -> knees buckle -> topple backwards -> settle (one-shot 2.0s)
const D = (o) => o;
const DIE_KEYS = [
  { t: 0,   h: [0, 1, 0],        p: D({}) },
  { t: 0.25, h: [0, 0.97, 0],    p: D({ Hips: [-0.08, 0, 0], Spine: [-0.25, 0, 0.05], Spine1: [-0.2, 0, 0], Spine2: [-0.15, 0, 0], Head: [-0.35, 0, 0], LeftArm: [0.5, 0, 0.5], RightArm: [0.5, 0, -0.5], LeftForeArm: [-0.2, 0, 0], RightForeArm: [-0.2, 0, 0], LeftUpLeg: [-0.1, 0, 0], RightUpLeg: [0.1, 0, 0], LeftLeg: [0.15, 0, 0], RightLeg: [0.15, 0, 0] }) },
  { t: 0.7,  h: [0, 0.62, -0.1], p: D({ Hips: [-0.2, 0, 0], Spine: [-0.15, 0, 0], Spine1: [-0.1, 0, 0], Head: [-0.2, 0.2, 0], LeftArm: [0.3, 0, 0.4], RightArm: [0.2, 0, -0.4], LeftForeArm: [-0.3, 0, 0], RightForeArm: [-0.3, 0, 0], LeftUpLeg: [-1.1, 0, 0.1], LeftLeg: [1.6, 0, 0], LeftFoot: [0.6, 0, 0], RightUpLeg: [-0.7, 0, -0.1], RightLeg: [1.2, 0, 0], RightFoot: [0.5, 0, 0] }) },
  { t: 1.1,  h: [0, 0.45, -0.3], p: D({ Hips: [-0.9, 0, 0], Spine: [-0.2, 0, 0], Spine1: [-0.1, 0, 0], Head: [-0.4, 0.3, 0], LeftArm: [0.8, 0, 0.7], RightArm: [0.6, 0, -0.7], LeftForeArm: [-0.3, 0, 0], RightForeArm: [-0.3, 0, 0], LeftUpLeg: [-0.6, 0, 0.1], LeftLeg: [0.9, 0, 0], RightUpLeg: [-0.4, 0, -0.1], RightLeg: [0.7, 0, 0] }) },
  { t: 1.5,  h: [0, 0.2, -0.55], p: D({ Hips: [-1.5, 0, 0], Spine: [-0.1, 0, 0], Head: [-0.1, 0.35, 0], LeftArm: [0.2, 0, 0.8], RightArm: [0.2, 0, -0.8], LeftForeArm: [-0.2, 0, 0], RightForeArm: [-0.2, 0, 0], LeftUpLeg: [-0.1, 0, 0.15], LeftLeg: [0.2, 0, 0], LeftFoot: [0.2, 0, 0], RightUpLeg: [-0.1, 0, -0.15], RightLeg: [0.2, 0, 0], RightFoot: [0.2, 0, 0] }) },
  { t: 2.0,  h: [0, 0.2, -0.6],  p: D({ Hips: [-1.5, 0, 0], Spine: [-0.1, 0, 0], Head: [0, 0.45, 0], LeftArm: [0.2, 0, 0.9], RightArm: [0.2, 0, -0.9], LeftForeArm: [-0.15, 0, 0], RightForeArm: [-0.15, 0, 0], LeftUpLeg: [-0.1, 0, 0.2], LeftLeg: [0.2, 0, 0], LeftFoot: [0.25, 0, 0], RightUpLeg: [-0.1, 0, -0.2], RightLeg: [0.2, 0, 0], RightFoot: [0.25, 0, 0] }) },
];
function spline(ts, vs, t) {
  const n = ts.length; if (t <= ts[0]) return vs[0]; if (t >= ts[n - 1]) return vs[n - 1];
  let i = 0; while (t > ts[i + 1]) i++;
  const h = ts[i + 1] - ts[i], u = (t - ts[i]) / h, u2 = u * u, u3 = u2 * u;
  const m = (k) => (k <= 0 || k >= n - 1 ? 0 : (vs[k + 1] - vs[k - 1]) / (ts[k + 1] - ts[k - 1]));
  return (2 * u3 - 3 * u2 + 1) * vs[i] + (u3 - 2 * u2 + u) * m(i) * h + (-2 * u3 + 3 * u2) * vs[i + 1] + (u3 - u2) * m(i + 1) * h;
}
const DIE_BONES = [...new Set(DIE_KEYS.flatMap((k) => Object.keys(k.p)))];
function die(t) {
  const ts = DIE_KEYS.map((k) => k.t), pose = {};
  for (const b of DIE_BONES) pose[b] = [0, 1, 2].map((a) => spline(ts, DIE_KEYS.map((k) => (k.p[b] || [0, 0, 0])[a]), t));
  const hx = spline(ts, DIE_KEYS.map((k) => k.h[0]), t), hz = spline(ts, DIE_KEYS.map((k) => k.h[2]), t);
  const ya = spline(ts, DIE_KEYS.map((k) => k.h[1]), t);
  const w = smooth(0.55, 1.1, t);
  const y = (1 - w) * feetY(pose, hx, hz) + w * ya;
  return { pose, x: hx, z: hz, y: bodyY(pose, hx, y, hz, (1 - w) * REST_FOOT + w * 0.1) };
}

// ---------- bake ----------
let cur = bc.data.length + ((4 - (bc.data.length % 4)) % 4);
const pending = [Buffer.alloc((4 - (bc.data.length % 4)) % 4)];
function accessor(arr, type, comps, withMinMax) {
  const bytes = Buffer.from(new Float32Array(arr).buffer);
  g.bufferViews.push({ buffer: 0, byteOffset: cur, byteLength: bytes.length });
  pending.push(bytes); cur += bytes.length;
  const a = { bufferView: g.bufferViews.length - 1, componentType: 5126, count: arr.length / comps, type };
  if (withMinMax) { a.min = [Math.min(...arr)]; a.max = [Math.max(...arr)]; }
  g.accessors.push(a); return g.accessors.length - 1;
}
function bake(name, dur, frameFn) {
  const n = Math.round(dur * FPS), times = [], qs = {}, hp = [];
  for (let k = 0; k <= n; k++) {
    const t = Math.min(dur, k / FPS), f = frameFn(t);
    const y = f.y ?? feetY(f.pose, f.x, f.z);
    apply(f.pose, [f.x, y, f.z]);
    times.push(t); hp.push(f.x, y, f.z);
    for (const b of Object.keys(f.pose)) (qs[b] ||= []).push(objs[id[b]].quaternion.clone());
  }
  const input = accessor(times, 'SCALAR', 1, true);
  const samplers = [], channels = [];
  const add = (node, path, out) => { samplers.push({ input, output: out, interpolation: 'LINEAR' }); channels.push({ sampler: samplers.length - 1, target: { node, path } }); };
  for (const [b, list] of Object.entries(qs)) {
    const flat = [];
    list.forEach((q, i) => { if (i && q.dot(list[i - 1]) < 0) { q.x = -q.x; q.y = -q.y; q.z = -q.z; q.w = -q.w; } flat.push(q.x, q.y, q.z, q.w); });
    add(id[b], 'rotation', accessor(flat, 'VEC4', 4));
  }
  add(id.Hips, 'translation', accessor(hp, 'VEC3', 3));
  g.animations.push({ name, samplers, channels });
  console.log(`+ ${name}: ${dur}s, ${n + 1} frames, ${channels.length} tracks`);
}
bake('Walk', 1.0, (t) => gait((t / 1.0) * Math.PI * 2, WALK));
bake('Run', 0.7, (t) => gait((t / 0.7) * Math.PI * 2, RUN));
bake('Attack', 0.6, attack);
bake('Die', 2.0, die);

// ---------- write GLB ----------
const bin = Buffer.concat(pending.length ? [bc.data, ...pending] : [bc.data]);
g.buffers[0].byteLength = bin.length;
let js = Buffer.from(JSON.stringify(g), 'utf8');
js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
const head = Buffer.alloc(12); head.write('glTF', 0, 'latin1'); head.writeUInt32LE(2, 4);
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
head.writeUInt32LE(12 + 8 + js.length + 8 + bin.length, 8);
if (!fs.existsSync(PATH + '.bak')) fs.copyFileSync(PATH, PATH + '.bak');
fs.writeFileSync(PATH, Buffer.concat([head, ch(js.length, 0x4e4f534a), js, ch(bin.length, 0x004e4942), bin]));
console.log('Rigged ->', PATH, '(' + (fs.statSync(PATH).size / 1e6).toFixed(1) + ' MB, backup: ' + PATH + '.bak)');
