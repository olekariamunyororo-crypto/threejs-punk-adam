const fs = require('fs');
const rw = (f, marker, fn) => { let s = fs.readFileSync(f, 'utf8'); if (s.includes(marker)) return console.log('skip (already patched):', f); s = fn(s); fs.writeFileSync(f, s); console.log('patched', f); };
const must = (s, a) => { if (!s.includes(a)) throw new Error('pattern not found: ' + a.slice(0, 70)); return s; };
const sub = (s, a, b) => must(s, a).replace(a, b);

// ---- enemy: pistol, shooting, hit test, respawn ----
rw('src/ai/setupEnemyAI.js', '[combat]', (s) => {
  if (!s.includes('[anims]')) throw new Error('Run rig-adam.sh (animation patch) first, then this script.');
  // real cache-buster on the actual URL constant (not the header comment)
  s = s.replace(/(Loads \/models\/adam_smasher_rigged\.glb)\?v=\d+/, '$1');
  s = must(s, 'const ADAM_SMASHER_URL').replace(/const ADAM_SMASHER_URL = "[^"]*";/, 'const ADAM_SMASHER_URL = "/models/adam_smasher_rigged.glb?v=' + Date.now() + '";');
  s = sub(s, 'import { EnemyTrainingEnv } from "./EnemyTrainingEnv.js";',
    'import { EnemyTrainingEnv } from "./EnemyTrainingEnv.js";\nimport { createEnemyCombat } from "./enemyCombat.js"; // [combat]\n\nconst RESPAWN_AFTER_S = 8; // enemy comes back this long after dying\nconst PLAYER_DAMAGE = 100; // one hit kills him');
  s = sub(s, '  enableBrain = true,\n} = {}) {', '  enableBrain = true,\n  onPlayerHit = () => {},\n  getPlayerSpeed = () => 0,\n} = {}) {');
  s = sub(s, '  trainingEnv.reset();\n', `  trainingEnv.reset();

  // Shots: env validates range / line of sight / aim; combat adds fire rate, tracer, sound and the hit roll.
  const combat = createEnemyCombat({ scene, camera, getPlayerSpeed, onPlayerHit });
  const tryShootOrig = trainingEnv._tryShoot.bind(trainingEnv);
  trainingEnv._tryShoot = function () {
    const ready = this.enemy.shootCooldown <= 0;
    tryShootOrig();
    if (ready && this._hitPlayerThisStep) combat.fire();
  };
`);
  s = sub(s, '      if (scene) scene.add(root);\n      enemyRoot = root;', '      if (scene) scene.add(root);\n      enemyRoot = root;\n      combat.attach(root);');
  s = sub(s, '      syncFallback();\n    },', `      syncFallback();
      combat.update(delta);
      if (enemyRoot && !trainingEnv.isAlive() && deadFor > RESPAWN_AFTER_S) trainingEnv.reset();
    },
    /** Player bullet vs his bones: {distance, part, point} or null. */
    shootRay(ray, maxDist) {
      return enemyRoot && trainingEnv.isAlive() ? combat.shootRay(ray, maxDist) : null;
    },
    registerHit(hit) {
      combat.spark(hit.point);
      trainingEnv.applyDamage(PLAYER_DAMAGE);
    },
    respawn() {
      trainingEnv.reset();
    },`);
  return s;
});

// ---- player gun: bullets can hit him ----
rw('src/world/viewmodel/createViewmodel.js', '[combat]', (s) => {
  s = sub(s, '    const targets = world?.focusTargets ?? [];\n    if (!targets.length) {', '    const targets = world?.focusTargets ?? [];\n    if (!targets.length && !world?.enemyAI) {');
  s = sub(s, '    const hit = hits[0];\n    if (!hit?.face) {', `    const hit = hits[0];
    const eHit = world?.enemyAI?.shootRay?.(raycaster.ray, p.maxRange); // [combat]
    if (eHit && (!hit || eHit.distance < hit.distance)) {
      world.enemyAI.registerHit(eHit);
      return;
    }
    if (!hit?.face) {`);
  s = sub(s, '    reload: startReload,\n    dispose,', `    reload: startReload,
    refill() {
      state.ammo = p.magSize;
      state.reserve = p.reserve;
      state.reloading = false;
      syncHud();
    },
    dispose,`);
  return s;
});

// ---- main: player death, respawn, wiring ----
rw('src/main.js', '[combat]', (s) => {
  s = sub(s, 'import { createViewmodel } from "./world/viewmodel/createViewmodel.js";', 'import { createViewmodel } from "./world/viewmodel/createViewmodel.js";\nimport { playerState } from "./game/playerCombat.js"; // [combat]');
  s = sub(s, 'getFinishedIntro: () => appShell?.isFinishedIntro?.() ?? false,', 'getFinishedIntro: () => !playerState.dead && (appShell?.isFinishedIntro?.() ?? false), // dead = frozen');
  s = sub(s, '        enabled: appShell.isFinishedIntro?.() ?? false,\n      });', '        enabled: (appShell.isFinishedIntro?.() ?? false) && !playerState.dead,\n      });');
  const patched = 'enemyAI?.update(delta, appShell.isFinishedIntro?.() ?? false);', orig = 'enemyAI?.update(delta);';
  const alive = '(appShell.isFinishedIntro?.() ?? false) && !playerState.dead';
  s = s.includes(patched) ? s.replace(patched, 'enemyAI?.update(delta, ' + alive + ');') : sub(s, orig, 'enemyAI?.update(delta, ' + alive + ');');
  s = sub(s, '        modelScale: 1,\n      });', `        modelScale: 1,
        onPlayerHit: () => playerState.hit(100),
        getPlayerSpeed: () => cameraDirector.walkControls?.getHorizontalSpeed?.() ?? 0,
      });
      world.enemyAI = enemyAI;
      playerState.onRespawn = () => {
        cameraDirector.resetCameraPose();
        world.viewmodel?.refill?.();
        enemyAI?.respawn?.();
      };`);
  return s;
});
