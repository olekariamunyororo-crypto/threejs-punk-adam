const fs = require('fs');
const rw = (f, marker, fn) => { let s = fs.readFileSync(f, 'utf8'); if (s.includes(marker)) return console.log('skip (already patched):', f); s = fn(s); fs.writeFileSync(f, s); console.log('patched', f); };
const sub = (s, a, b) => { if (!s.includes(a)) throw new Error('pattern not found: ' + a.slice(0, 70)); return s.replace(a, b); };

// 1) enemies stay dead for 15 s
rw('src/ai/setupEnemyAI.js', 'RESPAWN_AFTER_S = 15', (s) => {
  if (!/const RESPAWN_AFTER_S = \d+;/.test(s)) throw new Error('RESPAWN_AFTER_S not found');
  return s.replace(/const RESPAWN_AFTER_S = \d+;/, 'const RESPAWN_AFTER_S = 15;');
});

// 2) the hovercar is bulletproof (hits only spark on the hull)
rw('src/main.js', '[roadkill]', (s) =>
  sub(s, '        onPlayerHit: () => playerState.hit(100),',
`        onPlayerHit: () => {
          // [roadkill] bulletproof hovercar: shots just spark on the hull
          if (vehicleState.driving) {
            hovercar?.bulletImpact?.();
            return;
          }
          playerState.hit(100);
        },`));

// 3) ramming an enemy with the hovercar kills him
rw('src/game/hovercar.js', '[roadkill]', (s) => {
  s = sub(s, '  const api = {\n    get ready() {', `  // [roadkill] ramming an enemy at speed kills him (not while flying over his head)
  function runOverEnemies() {
    const agents = world.enemyAI?.agents;
    if (!agents || !agents.length) return;
    if (Math.hypot(ps.vx, ps.vz) < 3) return;
    const fx = Math.sin(ps.yaw), fz = Math.cos(ps.yaw);
    for (const a of agents) {
      const env = a.env;
      if (!env || !env.isAlive || !env.isAlive()) continue;
      const p = env.getEnemyPosition();
      const feet = p.y - (env.settings?.eyeHeight ?? 1.55);
      const dx = p.x - ps.pos.x, dz = p.z - ps.pos.z;
      if (Math.abs(dx * fx + dz * fz) > HOVER.halfLength + 0.45) continue; // along the car
      if (Math.abs(-dx * fz + dz * fx) > HOVER.halfWidth + 0.45) continue; // across the car
      if (feet > ps.pos.y + 1.4 || feet + 2.0 < ps.pos.y - 0.7) continue; // above / below
      a.registerHit({ point: new THREE.Vector3(p.x, feet + 1.1, p.z) });
      ui?.toast("ENEMY DOWN");
    }
  }

  // [roadkill] spark on the hull when a bullet hits
  let impactSpark = null;
  let impactLife = 0;
  function bulletImpact() {
    if (!ready) return;
    if (!impactSpark) {
      impactSpark = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: glowTexture([[0, "rgba(255,255,255,1)"], [0.3, "rgba(160,240,255,0.9)"], [1, "rgba(0,120,255,0)"]]),
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          opacity: 0,
        }),
      );
      impactSpark.renderOrder = 12;
      root.add(impactSpark);
    }
    impactSpark.position.set((Math.random() - 0.5) * 2.2, 0.2 + Math.random() * 1.3, (Math.random() - 0.5) * 5);
    impactSpark.scale.setScalar(0.7 + Math.random() * 0.5);
    impactSpark.material.opacity = 1;
    impactLife = 0.14;
  }

  const api = {
    bulletImpact,
    get ready() {`);
  s = sub(s, '  function updateVisuals(dt) {\n    time += dt;\n', `  function updateVisuals(dt) {
    time += dt;
    if (impactLife > 0) {
      impactLife -= dt;
      if (impactSpark) impactSpark.material.opacity = Math.max(0, impactLife / 0.14);
    }
`);
  return sub(s, '    physics.update(dt, { throttle, steer, lift, boost });\n    syncRoot();\n', '    physics.update(dt, { throttle, steer, lift, boost });\n    syncRoot();\n    runOverEnemies();\n');
});
