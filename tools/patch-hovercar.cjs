const fs = require('fs');
const rw = (f, marker, fn) => { let s = fs.readFileSync(f, 'utf8'); if (s.includes(marker)) return console.log('skip (already patched):', f); s = fn(s); fs.writeFileSync(f, s); console.log('patched', f); };
const sub = (s, a, b) => { if (!s.includes(a)) throw new Error('pattern not found in file: ' + a.slice(0, 70)); return s.replace(a, b); };

rw('src/controls/createWalkControls.js', '[hovercar]', (s) =>
  sub(s, '    getHorizontalSpeed: () => currentVelocity.length(),',
    `    getHorizontalSpeed: () => currentVelocity.length(),
    /** Raw move intent (keys or joystick): x right, y back (-1 = forward). [hovercar] */
    getInput() {
      buildMoveInput();
      return { x: moveInput.x, y: moveInput.y, sprint: keys.sprint };
    },`));

rw('src/world/features.js', 'hovercar:', (s) => sub(s, '  trainEnemies: true,\n};', '  trainEnemies: true,\n  /** Walk-up hovercar you can enter, drive and fly. */\n  hovercar: true,\n};'));

rw('src/main.js', '[hovercar]', (s) => {
  s = sub(s, 'import { playerState } from "./game/playerCombat.js"; // [combat]',
    'import { playerState } from "./game/playerCombat.js"; // [combat]\nimport { createHovercar } from "./game/hovercar.js"; // [hovercar]\nimport { vehicleState } from "./game/vehicleState.js";');
  s = sub(s, '      !playerState.dead && (appShell?.isFinishedIntro?.() ?? false),',
    '      !playerState.dead &&\n      !vehicleState.driving &&\n      (appShell?.isFinishedIntro?.() ?? false),');
  s = sub(s, '        enabled: (appShell.isFinishedIntro?.() ?? false) && !playerState.dead,',
    '        enabled:\n          (appShell.isFinishedIntro?.() ?? false) &&\n          !playerState.dead &&\n          !vehicleState.driving,');
  s = sub(s, '  // 2 Adams: #1 now, #2 after ~4s (never blocks boot)', '  let hovercar = null;\n\n  // 2 Adams: #1 now, #2 after ~4s (never blocks boot)');
  s = sub(s, '        cameraDirector.resetCameraPose();\n        world.viewmodel?.refill?.();', '        hovercar?.reset?.();\n        cameraDirector.resetCameraPose();\n        world.viewmodel?.refill?.();');
  s = sub(s, '  const cameraLayout = createCameraLayoutSync({', `  if (FEATURES.hovercar ?? true) {
    try {
      hovercar = createHovercar({
        scene,
        renderer,
        world,
        camera,
        getWalkControls: () => cameraDirector.walkControls,
        isActive: () => (appShell?.isFinishedIntro?.() ?? false) && !playerState.dead,
      });
    } catch (err) {
      console.warn("[hovercar] setup failed:", err);
      hovercar = null;
    }
  }

  const cameraLayout = createCameraLayoutSync({`);
  s = sub(s, '      appShell.updateHud(delta);\n', '      appShell.updateHud(delta);\n      hovercar?.update(delta);\n');
  return s;
});
