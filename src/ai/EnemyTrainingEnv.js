/**
 * IgnitionAI TrainingEnv for cyberpunk alley enemy agents.
 *
 * Reuses the same BVH collision approach as createWalkControls
 * (ground sampling + wall raycasts) so enemies respect the city geometry.
 *
 * Usage (after world + BVH are ready):
 *
 *   import { IgnitionEnvTFJS } from 'ignitionai';
 *   import { EnemyTrainingEnv } from './ai/EnemyTrainingEnv.js';
 *
 *   const trainingEnv = new EnemyTrainingEnv({ camera, colliders, ground, spawnPoints });
 *   const env = new IgnitionEnvTFJS(trainingEnv);
 *   env.train('dqn');   // or env.infer() for pure inference
 */

import * as THREE from "three/webgpu";

const DEFAULTS = {
  moveSpeed: 3.2,
  turnSpeed: 2.6,
  playerRadius: 0.5,
  eyeHeight: 1.55,
  maxStepUp: 0.4,
  maxStepDown: 1.75,
  groundProbeHeight: 200,
  groundProbeDistance: 400,
  wallProbeDistance: 0.08,
  maxEpisodeSteps: 600,
  preferredEngageDistance: 10,
  shootRange: 28,
  /** Seconds between shots (was 18 discrete 1/60 steps ≈ 0.3 s). */
  shootCooldownSeconds: 0.3,
};

const WALL_LATERAL_OFFSETS = [0, -0.85, 0.85];

/** Clamp frame delta for stability after tab switches / hitch. */
function clampDt(delta) {
  if (!Number.isFinite(delta) || delta <= 0) return 1 / 60;
  return Math.min(delta, 0.05);
}

export class EnemyTrainingEnv {
  /**
   * Discrete action set for DQN / tabular methods.
   * Index is what IgnitionAI passes to step(actionIndex).
   */
  actions = [
    "forward",
    "back",
    "strafe_left",
    "strafe_right",
    "turn_left",
    "turn_right",
    "shoot",
    "idle",
  ];

  constructor({
    camera,
    colliders = [],
    ground = null,
    model = null,
    spawnPoints = [],
    settings = {},
  } = {}) {
    this.settings = { ...DEFAULTS, ...settings };
    // Back-compat: old shootCooldownSteps → seconds
    if (settings.shootCooldownSteps != null && settings.shootCooldownSeconds == null) {
      this.settings.shootCooldownSeconds = settings.shootCooldownSteps / 60;
    }
    this.camera = camera;
    this.colliders = Array.isArray(colliders) ? colliders : [];
    this.walkTargets = [];
    if (model) this.walkTargets.push(model);
    if (ground) this.walkTargets.push(ground);
    if (this.walkTargets.length === 0 && this.colliders.length > 0) {
      this.walkTargets = this.colliders;
    }

    this.spawnPoints =
      spawnPoints.length > 0
        ? spawnPoints.map((p) => p.clone?.() ?? new THREE.Vector3().copy(p))
        : [
            new THREE.Vector3(5, 1.6, -15),
            new THREE.Vector3(-8, 1.6, -22),
            new THREE.Vector3(12, 1.6, -30),
            new THREE.Vector3(-3, 1.6, -8),
          ];

    this.enemy = {
      position: new THREE.Vector3(),
      yaw: 0,
      health: 100,
      alive: true,
      shootCooldown: 0,
      lastShotHit: false,
    };

    this.stepCount = 0;
    this.lastDistance = 0;
    this._lastAction = "idle";
    this._hitPlayerThisStep = false;
    this._lastDt = 1 / 60;

    this._raycaster = new THREE.Raycaster();
    this._probeOrigin = new THREE.Vector3();
    this._probeDirection = new THREE.Vector3();
    this._probeSide = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._moveDir = new THREE.Vector3();
    this._nextPos = new THREE.Vector3();
  }

  observe() {
    const p = this.camera.position;
    const e = this.enemy.position;
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const dist = Math.hypot(dx, dz) || 1e-6;

    const toPlayerAngle = Math.atan2(dx, dz);
    let relativeYaw = toPlayerAngle - this.enemy.yaw;
    while (relativeYaw > Math.PI) relativeYaw -= Math.PI * 2;
    while (relativeYaw < -Math.PI) relativeYaw += Math.PI * 2;

    const los = this._hasLineOfSight() ? 1 : 0;

    return [
      dx / 40,
      dz / 40,
      dist / 40,
      Math.sin(this.enemy.yaw),
      Math.cos(this.enemy.yaw),
      relativeYaw / Math.PI,
      this.enemy.health / 100,
      los,
      this.enemy.shootCooldown > 0 ? 1 : 0,
    ];
  }

  /**
   * @param {number} actionIndex
   * @param {number} [delta=1/60] wall-clock frame delta in seconds
   */
  step(actionIndex, delta = 1 / 60) {
    const dt = clampDt(delta);
    this._lastDt = dt;

    const action = this.actions[actionIndex] ?? "idle";
    this._lastAction = action;
    this._hitPlayerThisStep = false;
    this.enemy.lastShotHit = false;

    if (this.enemy.shootCooldown > 0) {
      this.enemy.shootCooldown = Math.max(0, this.enemy.shootCooldown - dt);
    }

    this._applyAction(action, dt);
    this._updatePhysics(dt);
    this.stepCount++;
  }

  reward() {
    if (!this.enemy.alive) return -25;

    const dist = this.enemy.position.distanceTo(this.camera.position);
    const progress = this.lastDistance - dist;
    this.lastDistance = dist;

    let r = progress * 0.8;

    const ideal = this.settings.preferredEngageDistance;
    r -= Math.abs(dist - ideal) * 0.02;

    if (this._hasLineOfSight()) r += 0.15;

    if (this._lastAction === "shoot") {
      if (this.enemy.lastShotHit) r += 8;
      else r -= 0.3;
    }

    r -= 0.015;

    return r;
  }

  done() {
    return (
      !this.enemy.alive ||
      this.stepCount >= this.settings.maxEpisodeSteps
    );
  }

  reset() {
    this.stepCount = 0;
    this.enemy.health = 100;
    this.enemy.alive = true;
    this.enemy.shootCooldown = 0;
    this.enemy.lastShotHit = false;
    this._lastAction = "idle";
    this._hitPlayerThisStep = false;

    const spawn =
      this.spawnPoints[Math.floor(Math.random() * this.spawnPoints.length)];
    this.enemy.position.copy(spawn);
    this.enemy.yaw = Math.random() * Math.PI * 2;

    const groundY = this._sampleGroundY(
      this.enemy.position.x,
      this.enemy.position.z,
      this.enemy.position.y,
      { allowLongDrop: true },
    );
    this.enemy.position.y = groundY + this.settings.eyeHeight;

    this.lastDistance = this.enemy.position.distanceTo(this.camera.position);
  }

  _applyAction(action, dt = 1 / 60) {
    const s = this.settings;
    this._moveDir.set(0, 0, 0);

    switch (action) {
      case "forward":
        this._moveDir.z = -1;
        break;
      case "back":
        this._moveDir.z = 0.65;
        break;
      case "strafe_left":
        this._moveDir.x = -1;
        break;
      case "strafe_right":
        this._moveDir.x = 1;
        break;
      case "turn_left":
        this.enemy.yaw += s.turnSpeed * dt;
        break;
      case "turn_right":
        this.enemy.yaw -= s.turnSpeed * dt;
        break;
      case "shoot":
        this._tryShoot();
        break;
      case "idle":
      default:
        break;
    }

    if (this._moveDir.lengthSq() > 0) {
      this._moveDir.normalize();
    }
  }

  _updatePhysics(dt) {
    const s = this.settings;
    if (this._moveDir.lengthSq() < 1e-8) return;

    const sin = Math.sin(this.enemy.yaw);
    const cos = Math.cos(this.enemy.yaw);
    const worldDx = this._moveDir.x * cos - this._moveDir.z * sin;
    const worldDz = this._moveDir.x * sin + this._moveDir.z * cos;

    const moveDistance = s.moveSpeed * dt;
    this._moveDir.set(worldDx, 0, worldDz).normalize();

    this._nextPos.copy(this.enemy.position);
    this._nextPos.x += this._moveDir.x * moveDistance;
    this._nextPos.z += this._moveDir.z * moveDistance;

    if (!this._hitsWall(this.enemy.position, this._moveDir, moveDistance)) {
      this.enemy.position.x = this._nextPos.x;
      this.enemy.position.z = this._nextPos.z;
    }

    const groundY = this._sampleGroundY(
      this.enemy.position.x,
      this.enemy.position.z,
      this.enemy.position.y,
    );
    this.enemy.position.y = groundY + s.eyeHeight;
  }

  _collectGroundHits(x, z, referenceY) {
    if (this.walkTargets.length === 0) return [];

    this._probeOrigin.set(x, referenceY + this.settings.groundProbeHeight, z);
    this._probeDirection.set(0, -1, 0);
    this._raycaster.set(this._probeOrigin, this._probeDirection);
    this._raycaster.far = this.settings.groundProbeDistance;
    this._raycaster.firstHitOnly = false;

    return this._raycaster.intersectObjects(this.walkTargets, true);
  }

  _pickWalkableGroundY(hits, feetY, { allowLongDrop = false } = {}) {
    if (hits.length === 0) return feetY;

    const maxStepUp = this.settings.maxStepUp;
    const maxStepDown = allowLongDrop
      ? this.settings.groundProbeDistance
      : this.settings.maxStepDown;

    let bestY = null;
    let bestDistance = Infinity;

    for (const hit of hits) {
      const y = hit.point.y;
      if (y > feetY + maxStepUp) continue;
      if (y < feetY - maxStepDown) continue;

      const distance = Math.abs(y - feetY);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestY = y;
      }
    }

    if (bestY !== null) return bestY;

    if (allowLongDrop) {
      let lowestValidY = null;
      for (const hit of hits) {
        const y = hit.point.y;
        if (y > feetY + maxStepUp) continue;
        if (lowestValidY === null || y > lowestValidY) lowestValidY = y;
      }
      if (lowestValidY !== null) return lowestValidY;
    }

    return feetY;
  }

  _sampleGroundY(x, z, referenceY, opts = {}) {
    const feetY = referenceY - this.settings.eyeHeight;
    const hits = this._collectGroundHits(x, z, referenceY);
    return this._pickWalkableGroundY(hits, feetY, opts);
  }

  _hitsWall(from, moveDir, moveDistance) {
    if (this.colliders.length === 0) return false;

    const radius = this.settings.playerRadius;
    const blockDistance = moveDistance + radius;
    const far = blockDistance + this.settings.wallProbeDistance;
    const chestY = from.y - this.settings.eyeHeight * 0.35;

    this._probeSide.set(-moveDir.z, 0, moveDir.x);
    if (this._probeSide.lengthSq() < 1e-8) {
      this._probeSide.set(1, 0, 0);
    } else {
      this._probeSide.normalize();
    }

    this._raycaster.firstHitOnly = true;

    for (let i = 0; i < WALL_LATERAL_OFFSETS.length; i++) {
      this._probeOrigin.copy(from);
      this._probeOrigin.y = chestY;
      this._probeOrigin.addScaledVector(
        this._probeSide,
        WALL_LATERAL_OFFSETS[i] * radius,
      );

      this._raycaster.set(this._probeOrigin, moveDir);
      this._raycaster.far = far;

      const hits = this._raycaster.intersectObjects(this.colliders, true);
      if (hits.length > 0 && hits[0].distance < blockDistance) {
        return true;
      }
    }

    return false;
  }

  _hasLineOfSight() {
    const from = this.enemy.position;
    const to = this.camera.position;
    this._tmp.copy(to).sub(from);
    const dist = this._tmp.length();
    if (dist < 0.1) return true;
    this._tmp.normalize();

    this._raycaster.set(from, this._tmp);
    this._raycaster.far = dist - 0.3;
    this._raycaster.firstHitOnly = true;

    const hits = this._raycaster.intersectObjects(this.colliders, true);
    return hits.length === 0;
  }

  /**
   * Env owns eligibility + hit decision (range, LOS, aim).
   * Combat layer only plays VFX and applies damage when lastShotHit is true.
   */
  _tryShoot() {
    if (this.enemy.shootCooldown > 0) return;

    this.enemy.shootCooldown = this.settings.shootCooldownSeconds;

    const dist = this.enemy.position.distanceTo(this.camera.position);
    if (dist > this.settings.shootRange) return;
    if (!this._hasLineOfSight()) return;

    const toPlayer = this._tmp.copy(this.camera.position).sub(this.enemy.position);
    const facing = new THREE.Vector3();
    facing.set(Math.sin(this.enemy.yaw), 0, -Math.cos(this.enemy.yaw));

    toPlayer.y = 0;
    toPlayer.normalize();
    const align = facing.dot(toPlayer);

    if (align > 0.75) {
      this.enemy.lastShotHit = true;
      this._hitPlayerThisStep = true;
    }
  }

  getEnemyPosition() {
    return this.enemy.position;
  }

  getEnemyYaw() {
    return this.enemy.yaw;
  }

  isAlive() {
    return this.enemy.alive;
  }

  applyDamage(amount) {
    this.enemy.health = Math.max(0, this.enemy.health - amount);
    if (this.enemy.health <= 0) this.enemy.alive = false;
  }
}
