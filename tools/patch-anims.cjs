const fs = require('fs');
const rw = (f, fn) => { let s = fs.readFileSync(f, 'utf8'); if (s.includes('[anims]')) return console.log('skip (already patched):', f); s = fn(s); fs.writeFileSync(f, s); console.log('patched', f); };
const must = (s, a) => { if (!s.includes(a)) throw new Error('pattern not found: ' + a.slice(0, 50)); return s; };
rw('src/ai/setupEnemyAI.js', (s) => {
  s = must(s, '  let boxHelper = null;').replace('  let boxHelper = null;', '  let boxHelper = null;\n  let deadFor = 0; // [anims]\n  let movingFor = 0; // brief turns must not interrupt walk/run');
  s = must(s, '    enemyRoot.visible = alive;').replace('    enemyRoot.visible = alive;',
    '    if (alive) deadFor = 0; else deadFor += delta;\n    enemyRoot.visible = alive || deadFor < 4; // keep body for the Die clip');
  const i = must(s, '    const walkClip =').indexOf('    const walkClip ='), endTok = '    else if (!moving && idleClip) playClip(idleClip);';
  const j = must(s, endTok).indexOf(endTok) + endTok.length;
  s = s.slice(0, i) + `    const A = (n) => actions[n] || actions[n.toLowerCase()];
    const idleClip = A("Idle") || actions.TPose || actions.Stand;
    const walkClip = A("Walk") || actions.Walking || A("Run") || actions.locomotion;
    const runClip = A("Run") || walkClip;
    const attackClip = A("Attack");
    const dieClip = A("Die");
    const state = ignition ? undefined : brain?.state;

    movingFor = moving ? 0.25 : Math.max(0, movingFor - delta);
    const moved = movingFor > 0;

    let want = idleClip;
    if (!alive) want = dieClip || idleClip;
    else if (state === "attack" && attackClip) want = attackClip;
    else if (moved) want = state === "chase" ? runClip : walkClip;
    if (dieClip && want === dieClip) { dieClip.setLoop(THREE.LoopOnce, 1); dieClip.clampWhenFinished = true; }
    if (want) playClip(want);` + s.slice(j);
  const k = '    const idx = trainingEnv.actions.indexOf(actionName);';
  s = must(s, k).replace(k, '    // match speed to the baked clips (walk ~1.8 m/s, run ~3.9 m/s)\n    trainingEnv.settings.moveSpeed = brain.state === "chase" ? 3.9 : 1.8;\n' + k);
  const t = '    if (Math.abs(yawErr) > TURN_THRESH) {';
  s = must(s, t).replace(t, '    if (state !== "patrol" && Math.abs(yawErr) > TURN_THRESH) { // patrol steers to its waypoint below');
  return s;
});
rw('src/main.js', (s) => {
  const a = 'console.info("[EnemyAI] Adam Smasher setup complete (spawn next to car)");';
  return must(s, a).replace(a, a + '\n      window.enemyAI = enemyAI; // [anims] console: enemyAI.applyDamage(100)');
});
