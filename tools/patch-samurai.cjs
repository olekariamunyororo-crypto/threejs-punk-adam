const fs = require('fs');
const F = 'src/main.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('[samurai]')) { console.log('skip (already patched):', F); process.exit(0); }
const sub = (a, b) => { if (!s.includes(a)) throw new Error('pattern not found in main.js: ' + a.slice(0, 70)); s = s.replace(a, b); };

sub('import { setupEnemyPair } from "./ai/setupEnemyPair.js";', 'import { setupEnemyPair } from "./ai/setupEnemyPair.js";\nimport { setupSamurai } from "./ai/setupSamurai.js"; // [samurai]');
sub('      world.enemyAI = enemyAI;\n', `      world.enemyAI = enemyAI;
      // [samurai] melee enemy joins ~9 s after start; he shares the enemy list, so your bullets,
      // hovercar roadkill and respawns work on him automatically
      if (FEATURES.samurai ?? true) {
        setTimeout(() => {
          try {
            enemyAI.agents.push(
              setupSamurai({
                camera,
                scene,
                colliders,
                ground: groundMesh,
                model: world.city ?? null,
                spawnPoints: [new THREE.Vector3(-100, -5.4, 30), new THREE.Vector3(-70, -5.4, 33), new THREE.Vector3(-110, -5.4, 38)],
                onPlayerHit: () => {
                  if (typeof vehicleState !== "undefined" && vehicleState.driving) {
                    hovercar?.bulletImpact?.(); // bulletproof hovercar
                    return;
                  }
                  playerState.hit(100);
                },
              }),
            );
          } catch (err) {
            console.warn("[Samurai] setup failed:", err);
          }
        }, 9000);
      }
`);
fs.writeFileSync(F, s);
console.log('patched', F);
