#!/usr/bin/env bash
# apply-phase1-game-walk.sh
# Applies Phase 1 FPS "game walk" mode to threejs-conference in place.
# Usage:
#   cd /path/to/threejs-conference
#   chmod +x apply-phase1-game-walk.sh
#   ./apply-phase1-game-walk.sh

set -euo pipefail

ROOT="$(pwd)"

die() { echo "ERROR: $*" >&2; exit 1; }

[[ -f "$ROOT/package.json" ]] || die "Run from the threejs-conference repo root (package.json missing)."
[[ -f "$ROOT/src/world/features.js" ]] || die "src/world/features.js not found."
[[ -f "$ROOT/src/runtime/createCameraDirector.js" ]] || die "src/runtime/createCameraDirector.js not found."
[[ -f "$ROOT/src/app/createAppShell.js" ]] || die "src/app/createAppShell.js not found."

command -v python3 >/dev/null 2>&1 || die "python3 is required."

echo "[phase1] Patching repo at: $ROOT"

# ---------------------------------------------------------------------------
# 1. features.js — add gameWalk flag
# ---------------------------------------------------------------------------
python3 << 'PY'
from pathlib import Path
path = Path("src/world/features.js")
text = path.read_text(encoding="utf-8")
if "gameWalk" in text:
    print("[phase1] features.js: gameWalk already present — skip")
else:
    old = """  // Available in production too; setupInspector hides advanced panels outside DEV.
  inspector: true,
};"""
    new = """  // Available in production too; setupInspector hides advanced panels outside DEV.
  inspector: true,
  /** Phase 1 FPS: force walk-only, crosshair, no orbit */
  gameWalk: true,
};"""
    if old not in text:
        # fallback: insert before closing of FEATURES
        import re
        text2, n = re.subn(
            r"(inspector:\s*true,)\s*\n(\};)",
            r"\1\n  /** Phase 1 FPS: force walk-only, crosshair, no orbit */\n  gameWalk: true,\n\2",
            text,
            count=1,
        )
        if n != 1:
            raise SystemExit("Could not patch features.js — unexpected format")
        text = text2
    else:
        text = text.replace(old, new, 1)
    path.write_text(text, encoding="utf-8")
    print("[phase1] features.js: added gameWalk: true")
PY

# ---------------------------------------------------------------------------
# 2. createCrosshair.js + crosshair.css
# ---------------------------------------------------------------------------
mkdir -p src/ui/walk

cat > src/ui/walk/crosshair.css << 'EOF'
.fps-crosshair {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 50;
  display: none;
  align-items: center;
  justify-content: center;
}

.fps-crosshair.is-visible {
  display: flex;
}

.fps-crosshair__mark {
  position: relative;
  width: 18px;
  height: 18px;
}

.fps-crosshair__mark::before,
.fps-crosshair__mark::after {
  content: "";
  position: absolute;
  background: rgba(34, 211, 238, 0.9);
  box-shadow: 0 0 6px rgba(168, 85, 247, 0.55);
}

/* horizontal */
.fps-crosshair__mark::before {
  left: 0;
  top: 50%;
  width: 100%;
  height: 2px;
  transform: translateY(-50%);
}

/* vertical */
.fps-crosshair__mark::after {
  top: 0;
  left: 50%;
  width: 2px;
  height: 100%;
  transform: translateX(-50%);
}

.fps-crosshair__dot {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: #fff;
  transform: translate(-50%, -50%);
  box-shadow: 0 0 4px rgba(34, 211, 238, 0.8);
}
EOF

cat > src/ui/walk/createCrosshair.js << 'EOF'
import "./crosshair.css";

export function createCrosshair() {
  const root = document.createElement("div");
  root.className = "fps-crosshair";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `
    <div class="fps-crosshair__mark">
      <span class="fps-crosshair__dot"></span>
    </div>
  `;
  document.body.appendChild(root);

  function setVisible(visible) {
    root.classList.toggle("is-visible", Boolean(visible));
  }

  function destroy() {
    root.remove();
  }

  return { root, setVisible, destroy };
}
EOF

echo "[phase1] wrote src/ui/walk/createCrosshair.js + crosshair.css"

# ---------------------------------------------------------------------------
# 3. createCameraDirector.js — lock orbit + tighter walk settings
# ---------------------------------------------------------------------------
python3 << 'PY'
from pathlib import Path
path = Path("src/runtime/createCameraDirector.js")
text = path.read_text(encoding="utf-8")

if "FEATURES.gameWalk" in text and "Phase 1: game walk" in text:
    print("[phase1] createCameraDirector.js: already patched — skip")
else:
    # Import FEATURES
    if 'from "../world/features.js"' not in text:
        needle = 'import { createWalkControls } from "../controls/createWalkControls.js";\n'
        insert = needle + 'import { FEATURES } from "../world/features.js";\n'
        if needle not in text:
            raise SystemExit("createCameraDirector.js: cannot find createWalkControls import")
        text = text.replace(needle, insert, 1)

    # Disable orbit early when gameWalk
    if "if (FEATURES.gameWalk)" not in text.split("controls.update();")[0] if "controls.update();" in text else True:
        old_ctrl = """  controls.maxAzimuthAngle = Infinity;
  controls.update();

  const focusPoint = controls.target.clone();"""
        new_ctrl = """  controls.maxAzimuthAngle = Infinity;
  controls.update();

  if (FEATURES.gameWalk) {
    controls.enabled = false;
  }

  const focusPoint = controls.target.clone();"""
        if old_ctrl in text:
            text = text.replace(old_ctrl, new_ctrl, 1)
        else:
            # softer match
            if "if (FEATURES.gameWalk)" not in text:
                text = text.replace(
                    "  controls.update();\n\n  const focusPoint",
                    "  controls.update();\n\n  if (FEATURES.gameWalk) {\n    controls.enabled = false;\n  }\n\n  const focusPoint",
                    1,
                )

    # Patch walk settings block
    old_settings = """      settings: {
        moveSpeed: 3,
        sprintMultiplier: 3,
        eyeHeight: cameraParams.walkEyeHeight,
        acceleration: cameraParams.walkAcceleration,
        deceleration: cameraParams.walkDeceleration,
        walkFovBoost: cameraParams.walkFovBoost,
        sprintFovBoost: cameraParams.sprintFovBoost,
        walkFovBlendSpeed: cameraParams.walkFovBlendSpeed,
        sprintFovBlendSpeed: cameraParams.sprintFovBlendSpeed,
        playerRadius: 0.55,
      },"""
    new_settings = """      settings: {
        moveSpeed: FEATURES.gameWalk ? 4.2 : 3,
        sprintMultiplier: FEATURES.gameWalk ? 1.7 : 3,
        eyeHeight: cameraParams.walkEyeHeight,
        acceleration: cameraParams.walkAcceleration,
        deceleration: cameraParams.walkDeceleration,
        walkFovBoost: FEATURES.gameWalk ? 2 : cameraParams.walkFovBoost,
        sprintFovBoost: FEATURES.gameWalk ? 6 : cameraParams.sprintFovBoost,
        walkFovBlendSpeed: cameraParams.walkFovBlendSpeed,
        sprintFovBlendSpeed: cameraParams.sprintFovBlendSpeed,
        playerRadius: 0.55,
        ...(FEATURES.gameWalk ? { mouseSensitivity: 0.0022 } : {}),
      },"""
    if old_settings in text:
        text = text.replace(old_settings, new_settings, 1)
    elif "FEATURES.gameWalk ? 4.2" not in text:
        raise SystemExit("createCameraDirector.js: walk settings block not found")

    # Replace setCameraMode body
    old_fn = """  function setCameraMode(mode) {
    const walk = mode === "walk";
    cameraModeState.orbitEnabled = !walk;
    walkControls?.setActive(walk);
    controls.enabled = !walk && getFinishedIntro?.();
    onWalkModeChange?.(walk);

    if (walk) {
      walkControls?.setBaseFov(getBaseFovForLayout());
      walkControls?.syncEulerFromCamera();
      // Snap happens inside setActive when entering walk. Do not snap again
      // here — a second raycast at revealAppUi was causing a visible pop.
      syncWalkFocusPoint();
    } else {
      camera.getWorldDirection(orbitLookTarget);
      controls.target
        .copy(camera.position)
        .add(orbitLookTarget.multiplyScalar(WALK_FOCUS_DISTANCE));
      controls.update();
    }
  }"""
    new_fn = """  function setCameraMode(mode) {
    // Phase 1: game walk never leaves first-person
    if (FEATURES.gameWalk && mode !== "walk") {
      mode = "walk";
    }

    const walk = mode === "walk";
    cameraModeState.orbitEnabled = !walk;
    walkControls?.setActive(walk);
    // Never enable OrbitControls in game mode
    controls.enabled = !walk && !FEATURES.gameWalk && getFinishedIntro?.();
    onWalkModeChange?.(walk);

    if (walk) {
      walkControls?.setBaseFov(getBaseFovForLayout());
      walkControls?.syncEulerFromCamera();
      // Snap happens inside setActive when entering walk. Do not snap again
      // here — a second raycast at revealAppUi was causing a visible pop.
      syncWalkFocusPoint();
    } else {
      camera.getWorldDirection(orbitLookTarget);
      controls.target
        .copy(camera.position)
        .add(orbitLookTarget.multiplyScalar(WALK_FOCUS_DISTANCE));
      controls.update();
    }
  }"""
    if old_fn in text:
        text = text.replace(old_fn, new_fn, 1)
    elif "Phase 1: game walk never leaves" not in text:
        raise SystemExit("createCameraDirector.js: setCameraMode not found or already different")

    path.write_text(text, encoding="utf-8")
    print("[phase1] createCameraDirector.js: locked game walk + settings")
PY

# ---------------------------------------------------------------------------
# 4. createAppShell.js — crosshair wiring
# ---------------------------------------------------------------------------
python3 << 'PY'
from pathlib import Path
path = Path("src/app/createAppShell.js")
text = path.read_text(encoding="utf-8")

if "createCrosshair" in text and "crosshair?.setVisible" in text:
    print("[phase1] createAppShell.js: already patched — skip")
else:
    # Import
    if "createCrosshair" not in text:
        needle = 'import { createWalkInputFacade } from "../ui/walk/createWalkInputFacade.js";\n'
        insert = needle + 'import { createCrosshair } from "../ui/walk/createCrosshair.js";\n'
        if needle not in text:
            raise SystemExit("createAppShell.js: cannot find createWalkInputFacade import")
        text = text.replace(needle, insert, 1)

    # Create crosshair after walk UI block — insert after virtualJoystick assignment area
    if "const crosshair =" not in text:
        marker = """    header?.bindWalkControls?.(cameraDirector.walkControls);
  }

  const settingsPanel = FEATURES.chromeUi"""
        replacement = """    header?.bindWalkControls?.(cameraDirector.walkControls);
  }

  const crosshair =
    FEATURES.gameWalk && FEATURES.walkUi ? createCrosshair() : null;

  const settingsPanel = FEATURES.chromeUi"""
        if marker not in text:
            raise SystemExit("createAppShell.js: cannot find walk UI bind marker")
        text = text.replace(marker, replacement, 1)

    # revealAppUi
    old_reveal = """  function revealAppUi() {
    finishedIntro = true;
    cameraDirector.setCameraMode("walk");
    uiVisibilityCoordinator?.refresh();
    header?.show();
    audioButton?.setVisible(true);
    walkPrompt?.setEnabled(true);
    moveHint?.setEnabled(true);
    virtualJoystick?.setEnabled(true);
    inspectorSession.revealInspector?.();
  }"""
    new_reveal = """  function revealAppUi() {
    finishedIntro = true;
    cameraDirector.setCameraMode("walk");
    if (FEATURES.gameWalk) {
      cameraDirector.setCameraMode("walk");
    }
    uiVisibilityCoordinator?.refresh();
    header?.show();
    audioButton?.setVisible(true);
    walkPrompt?.setEnabled(true);
    moveHint?.setEnabled(true);
    virtualJoystick?.setEnabled(true);
    crosshair?.setVisible(true);
    inspectorSession.revealInspector?.();
  }"""
    if old_reveal in text:
        text = text.replace(old_reveal, new_reveal, 1)
    elif "crosshair?.setVisible(true)" not in text:
        raise SystemExit("createAppShell.js: revealAppUi not found")

    # onWalkModeChange
    old_walk = """  function onWalkModeChange(walk) {
    walkControlsHint?.setVisible(walk && finishedIntro);
    virtualJoystick?.setVisible(walk && finishedIntro);
  }"""
    new_walk = """  function onWalkModeChange(walk) {
    walkControlsHint?.setVisible(walk && finishedIntro);
    virtualJoystick?.setVisible(walk && finishedIntro);
    if (FEATURES.gameWalk) {
      crosshair?.setVisible(walk && finishedIntro);
    }
  }"""
    if old_walk in text:
        text = text.replace(old_walk, new_walk, 1)
    elif "crosshair?.setVisible(walk && finishedIntro)" not in text:
        raise SystemExit("createAppShell.js: onWalkModeChange not found")

    path.write_text(text, encoding="utf-8")
    print("[phase1] createAppShell.js: crosshair wired")
PY

echo
echo "[phase1] Done."
echo "  Review: git diff"
echo "  Run:    npm run dev"
echo "  Toggle: FEATURES.gameWalk in src/world/features.js"
