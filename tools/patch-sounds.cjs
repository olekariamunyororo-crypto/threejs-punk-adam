const fs = require('fs');
const rw = (f, marker, fn) => { let s = fs.readFileSync(f, 'utf8'); if (s.includes(marker)) return console.log('skip (already patched):', f); s = fn(s); fs.writeFileSync(f, s); console.log('patched', f); };
const sub = (s, a, b) => { if (!s.includes(a)) throw new Error('pattern not found: ' + a.slice(0, 70)); return s.replace(a, b); };

// hovercar: Ferrari-style engine
rw('src/game/hovercar.js', '[ferrari]', (s) => {
  s = sub(s, 'import { getAudioVolume } from "../audio/audioState.js";', 'import { getAudioVolume } from "../audio/audioState.js";\nimport { createFerrariEngine } from "../audio/ferrariEngine.js"; // [ferrari]');
  s = sub(s, '  const engine = createEngineAudio();', '  const engine = createFerrariEngine({ getVolume: () => getAudioVolume?.() ?? 0.5 });');
  return sub(s, '    engine.update(speedN, boost && inp.y < 0, clamp(ps.alt / 20, 0, 1));',
    '    engine.update({ speed: Math.abs(ps.forwardSpeed), throttle: clamp(Math.abs(throttle), 0, 1), boost, alt: ps.alt }, dt);');
});

// enemy: Beretta shot
rw('src/ai/enemyCombat.js', '[beretta]', (s) => {
  s = sub(s, 'import * as THREE from "three/webgpu";', 'import * as THREE from "three/webgpu";\nimport { playBerettaShot } from "../audio/berettaShot.js"; // [beretta]\nimport { getAudioVolume } from "../audio/audioState.js";');
  const a = s.indexOf('  let audioCtx = null, noise = null;\n  function shotSound(dist) {');
  const b = s.indexOf('  const rand = ([a, b]) => a + Math.random() * (b - a);');
  if (a < 0 || b < a) throw new Error('shotSound block not found');
  return s.slice(0, a) + `  let audioCtx = null;
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

` + s.slice(b);
});
