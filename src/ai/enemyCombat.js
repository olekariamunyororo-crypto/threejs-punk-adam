import * as THREE from "three/webgpu";
import { playBerettaShot } from "../audio/berettaShot.js"; // [beretta]
import { getAudioVolume } from "../audio/audioState.js";

/**
 * Enemy pistol + shooting + hit detection.
 * Live-tune in the console:  __combat.hitBase = 1   (always hits)
 *
 * Hit/miss for AI shots is decided by EnemyTrainingEnv; pass forceHit when
 * calling fire() so combat does not roll a second independent RNG (THR-7).
 */
export const COMBAT = {
  fireInterval: [0.9, 1.5], // seconds between enemy shots (visual rate limit)
  hitBase: 0.5, // chance to hit at 0 m ... (only if forceHit omitted)
  hitPerMetre: 0.03, // ... minus this per metre
  hitMin: 0.12,
  hitMax: 0.5,
  movingSpeed: 2.0, // player faster than this (m/s) ...
  movingMult: 0.6, // ... is harder to hit
  missRadius: [0.7, 1.8], // how far a miss passes you (m)
  bulletSpeed: 160, // m/s (visual + hit delay)
  hitScale: 1.15, // generous hitboxes for touch aiming
};
if (typeof window !== "undefined") window.__combat = COMBAT;

// [bone A, bone B, radius, part]
const CAPSULES = [
  ["Head", "HeadTop", 0.2, "head"],
  ["Neck", "Head", 0.15, "head"],
  ["Hips", "Spine2", 0.3, "body"],
  ["Spine2", "Neck", 0.27, "body"],
  ["Spine2", "LeftArm", 0.16, "body"],
  ["LeftArm", "LeftForeArm", 0.13, "arm"],
  ["LeftForeArm", "LeftHand", 0.12, "arm"],
  ["Spine2", "RightArm", 0.16, "body"],
  ["RightArm", "RightForeArm", 0.13, "arm"],
  ["RightForeArm", "RightHand", 0.12, "arm"],
  ["LeftUpLeg", "LeftLeg", 0.18, "leg"],
  ["LeftLeg", "LeftFoot", 0.15, "leg"],
  ["LeftFoot", "LeftToeBase", 0.1, "leg"],
  ["RightUpLeg", "RightLeg", 0.18, "leg"],
  ["RightLeg", "RightFoot", 0.15, "leg"],
  ["RightFoot", "RightToeBase", 0.1, "leg"],
];

const A = new THREE.Vector3(), B = new THREE.Vector3(), P = new THREE.Vector3(), Q = new THREE.Vector3();
const S = new THREE.Vector3(), W = new THREE.Vector3();

/** Entry distance of ray (unit dir) vs capsule A-B radius r, or -1. */
function rayCapsule(o, d, a, b, r, maxD) {
  S.copy(b).sub(a);
  W.copy(o).sub(a);
  const bb = d.dot(S), c = S.lengthSq(), dd = d.dot(W), e = S.dot(W);
  const denom = c - bb * bb;
  let tc = denom > 1e-8 ? (e - bb * dd) / denom : 0;
  tc = Math.min(1, Math.max(0, tc));
  let sc = bb * tc - dd;
  if (sc < 0) {
    sc = 0;
    tc = c > 1e-8 ? Math.min(1, Math.max(0, e / c)) : 0;
  }
  P.copy(d).multiplyScalar(sc).add(o);
  Q.copy(S).multiplyScalar(tc).add(a);
  const dist = P.distanceTo(Q);
  if (dist > r) return -1;
  const t = Math.max(0, sc - Math.sqrt(r * r - dist * dist));
  return t <= maxD ? t : -1;
}

function glowTexture(inner, mid) {
  try {
    if (typeof document === "undefined") return null;
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, inner);
    g.addColorStop(0.3, mid);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  } catch {
    return null;
  }
}

function makeSprite(tex) {
  const s = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }),
  );
  s.frustumCulled = false;
  s.renderOrder = 12;
  return s;
}

/** Pistol in the hand bone's local frame: fingers = -Y, aiming-up = +Z. */
function buildPistol() {
  const g = new THREE.Group();
  g.name = "EnemyPistol";
  const metal = new THREE.MeshStandardMaterial({ color: 0x1b1d22, metalness: 0.85, roughness: 0.35 });
  const glow = new THREE.MeshBasicMaterial({ color: 0x22d3ee });
  const box = (w, l, h, x, y, z, mat = metal) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, l, h), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    g.add(m);
    return m;
  };
  box(0.036, 0.27, 0.05, 0, -0.15, 0.03); // slide
  box(0.018, 0.07, 0.018, 0, -0.32, 0.035); // barrel tip
  const grip = box(0.036, 0.055, 0.12, 0, -0.07, -0.03); // grip
  grip.rotation.x = 0.18;
  box(0.03, 0.09, 0.012, 0, -0.12, -0.012); // trigger guard
  box(0.038, 0.2, 0.006, 0, -0.15, 0.057, glow); // cyber strip
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, -0.36, 0.035);
  g.add(muzzle);
  // Solved against the Attack pose (bones have an A-pose rest, so hand axes are
  // not aligned with the forearm): level barrel, grip in the palm.
  g.quaternion.set(0.0004, 0.0302, -0.2556, 0.9663);
  g.position.set(0.0063, -0.0246, 0.0289);
  return { group: g, muzzle };
}

export function createEnemyCombat({ scene, camera, getPlayerSpeed = () => 0, onPlayerHit = () => {} }) {
  const bones = {};
  let hand = null, pistol = null, muzzle = null;
  let clock = 0; // in-game seconds (pause safe)
  let nextFire = 1.2; // small grace before his first shot

  const flash = makeSprite(glowTexture("rgba(255,245,210,1)", "rgba(255,170,70,0.8)"));
  flash.scale.setScalar(0.5);
  let flashLife = 0;

  const sparks = Array.from({ length: 4 }, () => makeSprite(glowTexture("rgba(255,90,60,1)", "rgba(255,40,30,0.7)")));
  let sparkCursor = 0;
  const sparkLife = [0, 0, 0, 0];
  if (scene) sparks.forEach((s) => scene.add(s));

  // tracers: a short bright streak travelling muzzle -> end
  const tracers = Array.from({ length: 3 }, () => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.05, 1),
      new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    m.frustumCulled = false;
    m.visible = false;
    if (scene) scene.add(m);
    return { mesh: m, active: false, o: new THREE.Vector3(), d: new THREE.Vector3(), len: 0, t: 0, hit: false };
  });

  let audioCtx = null;
  function shotSound(dist) {
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === "suspended") audioCtx.resume?.();
      playBerettaShot(audioCtx, { dist, volume: getAudioVolume?.() ?? 1 });
    } catch {
      /* audio is optional */
    }
  }

  const rand = ([a, b]) => a + Math.random() * (b - a);
  const origin = new THREE.Vector3(), end = new THREE.Vector3(), dir = new THREE.Vector3();
  const u = new THREE.Vector3(), v = new THREE.Vector3();

  function attach(root) {
    root.traverse((o) => {
      if (o.isBone) bones[o.name] = o;
    });
    hand = bones.RightHand ?? null;
    if (!hand) {
      console.warn("[EnemyCombat] RightHand bone not found — no pistol");
      return;
    }
    const p = buildPistol();
    pistol = p.group;
    muzzle = p.muzzle;
    hand.add(pistol);
    muzzle.add(flash);
    flash.position.set(0, 0, 0);
  }

  function spawnTracer(from, to, hit) {
    const tr = tracers.find((t) => !t.active) ?? tracers[0];
    tr.o.copy(from);
    tr.d.copy(to).sub(from);
    tr.len = tr.d.length();
    tr.d.normalize();
    tr.t = 0;
    tr.hit = hit;
    tr.active = true;
    tr.mesh.visible = true;
  }

  /**
   * Play muzzle flash + tracer. Hit decision:
   * - `{ forceHit: true|false }` — env already decided (preferred for AI shots)
   * - omitted — legacy RNG (distance / movement falloff)
   */
  function fire(opts = {}) {
    if (clock < nextFire || !muzzle) return false;
    nextFire = clock + rand(COMBAT.fireInterval);

    muzzle.getWorldPosition(origin);
    const eye = camera.position;
    const dist = origin.distanceTo(eye);

    let hit;
    if (typeof opts.forceHit === "boolean") {
      hit = opts.forceHit;
    } else {
      let p = Math.min(COMBAT.hitMax, Math.max(COMBAT.hitMin, COMBAT.hitBase - COMBAT.hitPerMetre * dist));
      if (getPlayerSpeed() > COMBAT.movingSpeed) p *= COMBAT.movingMult;
      hit = Math.random() < p;
    }

    end.copy(eye);
    end.y -= 0.2; // chest-ish
    if (!hit) {
      dir.copy(end).sub(origin).normalize();
      u.set(0, 1, 0).cross(dir).normalize();
      v.copy(dir).cross(u).normalize();
      const ang = Math.random() * Math.PI * 2, r = rand(COMBAT.missRadius);
      end.addScaledVector(u, Math.cos(ang) * r).addScaledVector(v, Math.sin(ang) * r);
      dir.copy(end).sub(origin).normalize();
      end.copy(origin).addScaledVector(dir, dist + 8); // sails past
    }
    spawnTracer(origin, end, hit);

    flash.material.opacity = 1;
    flash.material.rotation = Math.random() * Math.PI * 2;
    flash.scale.setScalar(0.4 + Math.random() * 0.25);
    flashLife = 0.06;
    shotSound(dist);
    return hit;
  }

  /** Pure test: first body part hit by a world-space ray, or null. */
  function shootRay(ray, maxDist = 150) {
    if (!hand) return null;
    let best = null;
    for (const [a, b, r, part] of CAPSULES) {
      const ba = bones[a], bb = bones[b];
      if (!ba || !bb) continue;
      ba.getWorldPosition(A);
      bb.getWorldPosition(B);
      const t = rayCapsule(ray.origin, ray.direction, A, B, r * COMBAT.hitScale, maxDist);
      if (t >= 0 && (!best || t < best.distance)) {
        best = { distance: t, part, point: ray.origin.clone().addScaledVector(ray.direction, t) };
      }
    }
    return best;
  }

  function spark(point) {
    const i = sparkCursor++ % sparks.length;
    sparks[i].position.copy(point);
    sparks[i].material.opacity = 1;
    sparks[i].scale.setScalar(0.6);
    sparkLife[i] = 0.18;
  }

  function update(delta) {
    clock += delta;
    if (flashLife > 0) {
      flashLife -= delta;
      if (flashLife <= 0) flash.material.opacity = 0;
    }
    sparks.forEach((s, i) => {
      if (sparkLife[i] > 0) {
        sparkLife[i] -= delta;
        s.material.opacity = Math.max(0, sparkLife[i] / 0.18);
      }
    });
    for (const tr of tracers) {
      if (!tr.active) continue;
      tr.t += COMBAT.bulletSpeed * delta;
      const head = Math.min(tr.t, tr.len), tail = Math.max(0, tr.t - 5);
      const seg = Math.max(0.01, head - tail);
      tr.mesh.position.copy(tr.o).addScaledVector(tr.d, (head + tail) / 2);
      tr.mesh.scale.set(1, 1, seg);
      tr.mesh.lookAt(tr.mesh.position.x + tr.d.x, tr.mesh.position.y + tr.d.y, tr.mesh.position.z + tr.d.z);
      if (tr.t >= tr.len) {
        if (tr.hit) onPlayerHit();
        tr.active = false;
        tr.mesh.visible = false;
      }
    }
  }

  return { attach, fire, shootRay, spark, update, get armed() { return Boolean(muzzle); } };
}
