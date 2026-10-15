const fs = require('fs');
const rw = (f, fn) => { let s = fs.readFileSync(f, 'utf8'); if (s.includes('[gpu]')) return console.log('skip (already patched):', f); s = fn(s); fs.writeFileSync(f, s); console.log('patched', f); };
const sub = (s, a, b) => { if (!s.includes(a)) throw new Error('pattern not found in ' + a.slice(0, 60)); return s.replace(a, b); };

rw('src/ai/setupEnemyAI.js', (s) => {
  s = sub(s, 'import { createEnemyCombat } from "./enemyCombat.js"; // [combat]', 'import { createEnemyCombat } from "./enemyCombat.js"; // [combat]\nimport { capTextureSize } from "../world/textureBudget.js"; // [gpu]');
  return sub(s, '      if (scene) scene.add(root);\n      enemyRoot = root;', '      capTextureSize(root, 1024); // [gpu] 2048px maps -> 1024px (4x less VRAM per Adam)\n      if (scene) scene.add(root);\n      enemyRoot = root;');
});
rw('src/game/hovercar.js', (s) => {
  s = sub(s, 'import { vehicleState } from "./vehicleState.js";', 'import { vehicleState } from "./vehicleState.js";\nimport { capTextureSize } from "../world/textureBudget.js"; // [gpu]');
  return sub(s, '    root.add(model);\n', '    capTextureSize(model, 512); // [gpu]\n    root.add(model);\n');
});
rw('src/main.js', (s) => {
  s = sub(s, 'import { FEATURES } from "./world/features.js";', 'import { FEATURES } from "./world/features.js";\nimport { installGpuWatch } from "./debug/gpuWatch.js"; // [gpu]');
  s = sub(s, '  const { renderer } = await createRenderer();\n', '  const { renderer } = await createRenderer();\n  installGpuWatch(renderer); // [gpu]\n');
  if (s.includes('      hovercar?.update(delta);\n')) s = s.replace('      hovercar?.update(delta);\n', '      try {\n        hovercar?.update(delta);\n      } catch (err) {\n        console.warn("[hovercar] update failed:", err);\n      }\n');
  return s;
});
