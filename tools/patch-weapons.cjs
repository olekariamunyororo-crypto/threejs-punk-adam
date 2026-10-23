const fs = require('fs');
const rw = (f, marker, fn) => { let s = fs.readFileSync(f, 'utf8'); if (s.includes(marker)) return console.log('skip (already patched):', f); s = fn(s); fs.writeFileSync(f, s); console.log('patched', f); };
const sub = (s, a, b) => { if (!s.includes(a)) throw new Error('pattern not found: ' + a.replace(/\n/g, '\\n').slice(0, 80)); return s.replace(a, b); };

rw('src/world/viewmodel/createViewmodel.js', '[weapons]', (s) => {
  s = sub(s, 'import { createAmmoHud } from "./createAmmoHud.js";', 'import { createAmmoHud } from "./createAmmoHud.js";\nimport { WEAPONS, ORDER, SWING_PIVOT, buildWeapons, pistolShot, katanaSwoosh, meleeStrike, swingPose } from "./weapons.js"; // [weapons]');
  s = sub(s, '  scene.add(root);\n', `  scene.add(root);

  // [weapons] pistol + katana ride on the rifle's animated bones (Body / Slider / Trigger)
  const rifleMeshes = [];
  const boneMap = {};
  model.traverse((o) => {
    if (o.isBone) boneMap[o.name] = o;
    if (o.isSkinnedMesh && o.material?.name !== ARMS_MATERIAL_NAME) rifleMeshes.push(o);
  });
  const wpn = buildWeapons(boneMap);
  let weapon = "rifle";
  const stash = { rifle: null, pistol: { ammo: WEAPONS.pistol.magSize, reserve: WEAPONS.pistol.reserve } };
  const magOf = () => (weapon === "rifle" ? p.magSize : WEAPONS[weapon].magSize);
`);
  s = sub(s, '    triggerHeld: false,\n    enabled: false,\n  };', '    triggerHeld: false,\n    triggerEdge: false,\n    swingT: -1,\n    swingKind: 0,\n    swingHit: false,\n    drawT: 0,\n    enabled: false,\n  };');
  s = sub(s, '    hud.set(state.ammo, state.reserve, state.reloading);\n  }\n  syncHud();\n', `    hud.set(state.ammo, state.reserve, state.reloading, WEAPONS[weapon].label, weapon === "katana");
  }
  syncHud();

  // [weapons] switching, katana swing, rig motion ---------------------------------
  function applyWeaponVisibility() {
    rifleMeshes.forEach((m) => (m.visible = weapon === "rifle"));
    wpn.pistol.visible = weapon === "pistol";
    wpn.katana.visible = weapon === "katana";
  }
  function selectWeapon(next) {
    if (!WEAPONS[next] || next === weapon) return;
    if (weapon !== "katana") stash[weapon] = { ammo: state.ammo, reserve: state.reserve };
    if (state.reloading) {
      state.reloadAction?.fadeOut(0.1);
      state.reloadAction = null;
      state.reloading = false;
    }
    if (state.fireActive) {
      actions.fire?.fadeOut(0.08);
      state.fireActive = false;
    }
    state.swingT = -1;
    state.triggerHeld = false;
    state.triggerEdge = false;
    weapon = next;
    if (next === "rifle") {
      const st = stash.rifle ?? { ammo: p.magSize, reserve: p.reserve };
      state.ammo = st.ammo;
      state.reserve = st.reserve;
    } else if (next === "pistol") {
      state.ammo = stash.pistol.ammo;
      state.reserve = stash.pistol.reserve;
    }
    applyWeaponVisibility();
    state.drawT = 0.24;
    audio.click(0.0);
    syncHud();
  }
  const cycleWeapon = () => selectWeapon(ORDER[(ORDER.indexOf(weapon) + 1) % ORDER.length]);
  function startSwing() {
    state.swingT = 0;
    state.swingKind ^= 1;
    state.swingHit = false;
    state.fireCooldown = WEAPONS.katana.cooldown;
    katanaSwoosh();
  }
  const _qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
  function applyRigMotion(delta, camera) {
    let dy = 0;
    if (state.drawT > 0) {
      state.drawT = Math.max(0, state.drawT - delta);
      const k = state.drawT / 0.24;
      dy = -0.22 * k * k;
    }
    if (state.swingT >= 0) {
      state.swingT += delta;
      if (!state.swingHit && state.swingT >= WEAPONS.katana.hitAt) {
        state.swingHit = true;
        meleeStrike(camera, world);
      }
      if (state.swingT >= WEAPONS.katana.duration) state.swingT = -1;
    }
    if (state.swingT >= 0) {
      const sp = swingPose(state.swingKind, state.swingT);
      _e.set(sp.r[0], sp.r[1], sp.r[2], "YXZ");
      _q.setFromEuler(_e);
      _v.copy(rig.position).sub(SWING_PIVOT).applyQuaternion(_q).add(SWING_PIVOT).add(_v2.set(sp.d[0], sp.d[1] + dy, sp.d[2]));
      rig.position.copy(_v);
      rig.quaternion.copy(_q).multiply(_qy);
    } else {
      rig.position.y += dy;
      rig.quaternion.copy(_qy);
    }
  }
`);
  s = sub(s, '      fire.reset();\n      fire.setEffectiveWeight(1);', '      fire.reset();\n      fire.setEffectiveTimeScale(weapon === "pistol" ? 2.4 : 1);\n      fire.setEffectiveWeight(1);');
  s = sub(s, '    state.fireCooldown = p.fireInterval;\n    state.fireHold = 0.28;', '    state.fireCooldown = weapon === "pistol" ? WEAPONS.pistol.fireInterval : p.fireInterval;\n    state.fireHold = weapon === "pistol" ? WEAPONS.pistol.fireHold : 0.28;');
  s = sub(s, '    audio.shot();\n    fireRay(camera);', '    if (weapon === "pistol") pistolShot();\n    else audio.shot();\n    fireRay(camera);');
  s = sub(s, 'if (state.reloading || state.reserve <= 0 || state.ammo >= p.magSize) {', 'if (weapon === "katana" || state.reloading || state.reserve <= 0 || state.ammo >= magOf()) {');
  s = sub(s, '    const need = p.magSize - state.ammo;', '    const need = magOf() - state.ammo;');
  s = sub(s, '    if (walkControlsRef?.isPointerLocked?.()) {\n      state.triggerHeld = true;\n    }', '    if (walkControlsRef?.isPointerLocked?.()) {\n      state.triggerHeld = true;\n      state.triggerEdge = true;\n    }');
  s = sub(s, '    onFireDown: () => {\n      if (state.enabled) {\n        state.triggerHeld = true;\n      }\n    },', '    onFireDown: () => {\n      if (state.enabled) {\n        state.triggerHeld = true;\n        state.triggerEdge = true;\n      }\n    },');
  s = sub(s, '    if (event.code === "KeyR" && state.enabled && !event.repeat) {\n      startReload();\n    }\n  }', `    if (event.code === "KeyR" && state.enabled && !event.repeat) {
      startReload();
    }
    if (state.enabled && !event.repeat) {
      if (event.code === "Digit1") selectWeapon("rifle");
      else if (event.code === "Digit2") selectWeapon("pistol");
      else if (event.code === "Digit3") selectWeapon("katana");
      else if (event.code === "KeyQ") cycleWeapon();
    }
  }`);
  s = sub(s, '    onReload: () => {\n      if (state.enabled) {\n        startReload();\n      }\n    },\n  });', '    onReload: () => {\n      if (state.enabled) {\n        startReload();\n      }\n    },\n    onSwap: () => {\n      if (state.enabled) {\n        cycleWeapon();\n      }\n    },\n  });');
  s = sub(s, '    rig.position.set(...(wide ? p.positionWide : p.position));\n    rigUniform.value.copy(rig.position);\n    flash.position.set(\n      rig.position.x + p.muzzle[0],\n      rig.position.y + p.muzzle[1],\n      rig.position.z + p.muzzle[2],\n    );',
    '    rig.position.set(...(wide ? p.positionWide : p.position));\n    applyRigMotion(delta, camera); // [weapons] draw animation + katana swing\n    rigUniform.value.copy(rig.position);\n    const mz = weapon === "pistol" ? WEAPONS.pistol.muzzle : p.muzzle;\n    flash.position.set(rig.position.x + mz[0], rig.position.y + mz[1], rig.position.z + mz[2]);');
  s = sub(s, '    if (\n      state.triggerHeld &&\n      !state.reloading &&\n      state.ammo > 0 &&\n      state.fireCooldown <= 0\n    ) {\n      shoot(camera);\n    }', `    if (weapon === "katana") {
      if (state.triggerHeld && state.fireCooldown <= 0 && state.swingT < 0) startSwing();
    } else if (
      state.triggerHeld &&
      !state.reloading &&
      state.ammo > 0 &&
      state.fireCooldown <= 0 &&
      (weapon === "rifle" || state.triggerEdge)
    ) {
      state.triggerEdge = false;
      shoot(camera);
    }`);
  s = sub(s, '    mixer.update(delta);\n\n    // Flash + impacts fade.', '    if (weapon === "pistol") {\n      const ra = state.reloadAction;\n      const pr = state.reloading && ra ? ra.time / (ra.getClip().duration || 1) : 0;\n      wpn.pistolMag.visible = !(pr > 0.18 && pr < 0.72); // mag out while reloading\n    }\n\n    mixer.update(delta);\n\n    // Flash + impacts fade.');
  s = sub(s, '    reload: startReload,\n    refill() {\n      state.ammo = p.magSize;\n      state.reserve = p.reserve;\n      state.reloading = false;\n      syncHud();\n    },',
    '    reload: startReload,\n    selectWeapon,\n    cycleWeapon,\n    get weapon() {\n      return weapon;\n    },\n    refill() {\n      stash.rifle = null;\n      stash.pistol = { ammo: WEAPONS.pistol.magSize, reserve: WEAPONS.pistol.reserve };\n      state.ammo = magOf();\n      state.reserve = weapon === "rifle" ? p.reserve : weapon === "pistol" ? WEAPONS.pistol.reserve : 0;\n      state.reloading = false;\n      syncHud();\n    },');
  return s;
});

rw('src/world/viewmodel/createAmmoHud.js', '[weapons]', (s) => {
  s = sub(s, '.vm-touch--reload{right:120px;bottom:150px;width:56px;height:56px}', '.vm-touch--reload{right:120px;bottom:150px;width:56px;height:56px}\n.vm-touch--swap{right:120px;bottom:226px;width:56px;height:56px}');
  s = sub(s, '  reloadBtn.textContent = "R";\n', '  reloadBtn.textContent = "R";\n  const swapBtn = document.createElement("button"); // [weapons]\n  swapBtn.className = "vm-touch vm-touch--swap";\n  swapBtn.textContent = "⇄";\n');
  s = sub(s, 'document.body.append(fireBtn, reloadBtn);', 'document.body.append(fireBtn, reloadBtn, swapBtn);');
  s = sub(s, '  function set(ammo, reserve, reloading) {', '  function set(ammo, reserve, reloading, label = "VSK-94", melee = false) {\n    if (melee) {\n      root.innerHTML = \'<span class="vm-ammo__res" style="font-size:20px">KATANA</span><small>TAP FIRE TO SLASH</small>\';\n      return;\n    }');
  s = sub(s, ': "VSK-94"', ': label');
  s = sub(s, '    reloadBtn.classList.toggle("is-visible", visible && coarse);', '    reloadBtn.classList.toggle("is-visible", visible && coarse);\n    swapBtn.classList.toggle("is-visible", visible && coarse);');
  s = sub(s, 'function bindTouch({ onFireDown, onFireUp, onReload }) {', 'function bindTouch({ onFireDown, onFireUp, onReload, onSwap }) {\n    swapBtn.addEventListener("pointerdown", (e) => {\n      e.preventDefault();\n      onSwap?.();\n    });');
  s = sub(s, '    reloadBtn.remove();', '    reloadBtn.remove();\n    swapBtn.remove();');
  return s;
});
