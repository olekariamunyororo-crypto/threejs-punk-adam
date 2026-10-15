import * as THREE from "three/webgpu";

/** Tunables (metres, seconds). Live-edit in the console: __hover.maxSpeed = 40 */
export const HOVER = {
  halfLength: 2.65, // collision half extents of the body
  halfWidth: 1.2,
  rideHeight: 1.0, // model origin above the ground
  midHeight: 1.0, // wall rays are cast this high above the ground
  maxSpeed: 24,
  boostSpeed: 34,
  reverseSpeed: 8,
  accel: 14,
  boostAccel: 26,
  brake: 30,
  drag: 0.55,
  sideGrip: 3.2, // lower = drifts more
  turnRate: 1.9, // rad/s at speed
  maxStepUp: 0.9, // curbs / ramps it hovers over; taller = wall
  bounce: 0.25,
  liftRate: 7, // m/s rise / descend
  maxAlt: 40, // max clearance above the surface below
  topHeight: 1.9, // body top above the hover reference (for ceilings)
  // world limits for the hovercar
  bounds: { minX: -262, maxX: 144, minZ: -74, maxZ: 103 },
};
if (typeof window !== "undefined") window.__hover = HOVER;

const DOWN = new THREE.Vector3(0, -1, 0);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * Arcade hover physics. No rendering: feed it the world raycast targets and
 * read back pos / yaw / pitch / roll. forward = (sin yaw, 0, cos yaw).
 */
export function createHovercarPhysics({ groundTargets, wallRoots, config = HOVER }) {
  const cfg = config;
  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const dir = new THREE.Vector3();
  const nrm = new THREE.Vector3();

  const s = {
    pos: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    roll: 0,
    steer: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    forwardSpeed: 0,
    impact: 0,
    grounded: true,
    alt: 0,
  };

  function sampleGround(x, z, refY) {
    origin.set(x, refY + 3, z);
    raycaster.set(origin, DOWN);
    raycaster.near = 0;
    raycaster.far = 16;
    raycaster.firstHitOnly = false;
    const hits = raycaster.intersectObjects(groundTargets, true);
    let best = null;
    for (const h of hits) {
      const y = h.point.y;
      if (y > refY + cfg.maxStepUp) continue;
      if (best === null || y > best) best = y;
    }
    return best;
  }

  function castWall(ox, oy, oz, dx, dz, far) {
    origin.set(ox, oy, oz);
    dir.set(dx, 0, dz);
    raycaster.set(origin, dir);
    raycaster.near = 0;
    raycaster.far = far;
    raycaster.firstHitOnly = true;
    const hits = raycaster.intersectObjects(wallRoots, true);
    return hits[0] ?? null;
  }

  /** Null if the move is free, else { nx, nz, penetration }. */
  function checkMove(mx, mz, groundY) {
    const len = Math.hypot(mx, mz);
    if (len < 1e-6) return null;
    const dx = mx / len, dz = mz / len;
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    const extent =
      Math.abs(dx * fx + dz * fz) * cfg.halfLength +
      Math.abs(dx * -fz + dz * fx) * cfg.halfWidth;
    const px = -dz, pz = dx; // perpendicular to motion
    let best = null;
    for (const h of [cfg.midHeight, cfg.midHeight + 0.9]) {
      const y = groundY + h;
      for (const lat of [0, -0.8, 0.8]) {
        const ox = s.pos.x + px * cfg.halfWidth * lat;
        const oz = s.pos.z + pz * cfg.halfWidth * lat;
        const hit = castWall(ox, y, oz, dx, dz, len + extent + 0.3);
        if (hit && (!best || hit.distance < best.distance)) best = hit;
      }
    }
    if (best) {
      const gap = best.distance - extent;
      if (gap < len) {
        if (best.face) {
          nrm.copy(best.face.normal).transformDirection(best.object.matrixWorld);
        } else {
          nrm.set(-dx, 0, -dz);
        }
        let nx = nrm.x, nz = nrm.z;
        const nl = Math.hypot(nx, nz);
        if (nl < 0.25) {
          nx = -dx;
          nz = -dz;
        } else {
          nx /= nl;
          nz /= nl;
        }
        if (nx * dx + nz * dz > 0) {
          nx = -nx;
          nz = -nz;
        }
        return { nx, nz, penetration: clamp(0.03 - gap, 0, 0.35) };
      }
    }
    return null;
  }

  /** Highest y the car's origin may reach so its top stays under any ceiling. */
  function ceilingLimit(x, z, fromY) {
    let limit = Infinity;
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    for (const [ox, oz] of [[0, 0], [fx * 1.6, fz * 1.6], [-fx * 1.6, -fz * 1.6]]) {
      origin.set(x + ox, fromY - cfg.rideHeight + 0.9, z + oz);
      dir.set(0, 1, 0);
      raycaster.set(origin, dir);
      raycaster.near = 0;
      raycaster.far = cfg.maxAlt + 4;
      raycaster.firstHitOnly = true;
      const h = raycaster.intersectObjects(wallRoots, true)[0];
      if (h) limit = Math.min(limit, h.point.y - cfg.topHeight - 0.15 + cfg.rideHeight);
    }
    return limit;
  }

  function reset(x, z, yaw) {
    s.yaw = yaw;
    s.pitch = s.roll = s.steer = 0;
    s.vx = s.vz = s.vy = 0;
    s.forwardSpeed = 0;
    s.alt = 0;
    const g = sampleGround(x, z, 20) ?? sampleGround(x, z, 0) ?? -5.4;
    s.pos.set(x, g + cfg.rideHeight, z);
  }

  /** input: { throttle: -1..1 (fwd +), steer: -1..1 (right +), lift: -1..1, boost: bool } */
  function update(dt, input) {
    dt = Math.min(dt, 0.05);
    s.impact = 0;

    s.steer += (input.steer - s.steer) * (1 - Math.exp(-10 * dt));

    // facing
    let fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    let vf = s.vx * fx + s.vz * fz;
    const turnFactor = 0.3 + 0.7 * clamp(Math.abs(vf) / 6, 0, 1);
    s.yaw -= s.steer * cfg.turnRate * turnFactor * (vf < -1 ? -1 : 1) * dt;
    fx = Math.sin(s.yaw);
    fz = Math.cos(s.yaw);
    const rx = -fz, rz = fx; // right = forward x up

    vf = s.vx * fx + s.vz * fz;
    let vs = s.vx * rx + s.vz * rz;

    const maxF = input.boost ? cfg.boostSpeed : cfg.maxSpeed;
    if (input.throttle > 0.05) {
      vf += (vf < 0 ? cfg.brake : input.boost ? cfg.boostAccel : cfg.accel) * input.throttle * dt;
      if (vf > maxF) vf = Math.max(maxF, vf - cfg.brake * 0.5 * dt);
    } else if (input.throttle < -0.05) {
      vf -= (vf > 0 ? cfg.brake : cfg.accel * 0.6) * -input.throttle * dt;
      vf = Math.max(vf, -cfg.reverseSpeed);
    } else {
      vf *= Math.exp(-cfg.drag * dt);
    }
    vs *= Math.exp(-cfg.sideGrip * dt);
    s.vx = fx * vf + rx * vs;
    s.vz = fz * vf + rz * vs;

    // reference = hover underside (includes altitude), ground = surface right below
    const under = s.pos.y - cfg.rideHeight;
    const gNow = sampleGround(s.pos.x, s.pos.z, under);
    const groundY = under; // wall rays follow the car, not the terrain

    // move + slide along walls
    let mx = s.vx * dt, mz = s.vz * dt;
    for (let i = 0; i < 2; i++) {
      if (Math.hypot(mx, mz) < 1e-6) break;
      const hit = checkMove(mx, mz, groundY);
      if (!hit) {
        s.pos.x += mx;
        s.pos.z += mz;
        break;
      }
      const vn = s.vx * hit.nx + s.vz * hit.nz;
      if (vn < 0) {
        s.impact = Math.max(s.impact, -vn);
        s.vx -= hit.nx * vn * (1 + cfg.bounce);
        s.vz -= hit.nz * vn * (1 + cfg.bounce);
      }
      s.pos.x += hit.nx * hit.penetration;
      s.pos.z += hit.nz * hit.penetration;
      mx = s.vx * dt;
      mz = s.vz * dt;
    }

    const b = cfg.bounds;
    const cx = clamp(s.pos.x, b.minX, b.maxX), cz = clamp(s.pos.z, b.minZ, b.maxZ);
    if (cx !== s.pos.x || cz !== s.pos.z) {
      s.pos.x = cx;
      s.pos.z = cz;
      s.vx *= 0.5;
      s.vz *= 0.5;
    }
    s.forwardSpeed = s.vx * Math.sin(s.yaw) + s.vz * Math.cos(s.yaw);

    // hover: follow the terrain (+ altitude), tilt to it
    fx = Math.sin(s.yaw);
    fz = Math.cos(s.yaw);
    const PL = 2.0, PW = 1.0;
    const u2 = s.pos.y - cfg.rideHeight;
    const g0 = sampleGround(s.pos.x, s.pos.z, u2);
    s.grounded = g0 !== null;
    s.alt = clamp(s.alt + (input.lift || 0) * cfg.liftRate * dt, 0, cfg.maxAlt);
    if (s.grounded) {
      const at = (ox, oz) => sampleGround(s.pos.x + ox, s.pos.z + oz, u2) ?? g0;
      const hF = at(fx * PL, fz * PL), hB = at(-fx * PL, -fz * PL);
      const hL = at(fz * PW, -fx * PW), hR = at(-fz * PW, fx * PW); // car-left = +X when facing +Z
      const flat = 1 / (1 + s.alt / 2.5); // less terrain tilt when flying
      const avg = (g0 + (hF + hB + hL + hR) / 4) / 2;
      let targetY = avg + cfg.rideHeight + s.alt;
      // ceilings (viaduct decks, signs): never rise into them
      const topY = ceilingLimit(s.pos.x, s.pos.z, Math.max(s.pos.y, targetY));
      if (targetY > topY) {
        targetY = topY;
        s.alt = Math.min(s.alt, Math.max(0, targetY - cfg.rideHeight - avg));
      }
      const k = targetY > s.pos.y ? 14 : 9;
      s.pos.y += (targetY - s.pos.y) * (1 - Math.exp(-k * dt));
      if (s.pos.y > topY) s.pos.y = topY;
      s.vy = 0;
      const tp = -Math.atan2(hF - hB, 2 * PL) * flat;
      const tr = Math.atan2(hL - hR, 2 * PW) * flat - s.steer * clamp(Math.abs(s.forwardSpeed) / cfg.maxSpeed, 0, 1) * 0.16;
      const sm = 1 - Math.exp(-7 * dt);
      s.pitch += (tp - s.pitch) * sm;
      s.roll += (tr - s.roll) * sm;
    } else {
      s.vy -= 25 * dt;
      s.pos.y += s.vy * dt;
    }
    return s;
  }

  return { state: s, update, reset, sampleGround };
}
