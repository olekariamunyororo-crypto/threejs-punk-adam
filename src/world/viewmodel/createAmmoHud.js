const CSS = `
.vm-ammo{position:fixed;right:max(20px,env(safe-area-inset-right));bottom:max(20px,env(safe-area-inset-bottom));z-index:30;
  font:600 28px/1 "Orbitron",system-ui,sans-serif;letter-spacing:.06em;color:#e8fbff;text-shadow:0 0 12px rgba(0,229,255,.6);
  pointer-events:none;opacity:0;transition:opacity .25s}
.vm-ammo.is-visible{opacity:1}
.vm-ammo small{display:block;margin-top:6px;font-size:12px;letter-spacing:.2em;opacity:.7}
.vm-ammo.is-empty{color:#ff5577;text-shadow:0 0 12px rgba(255,60,100,.7)}
.vm-ammo__res{font-size:16px;opacity:.65}
.vm-touch{position:fixed;z-index:31;display:none;border:1px solid rgba(0,229,255,.6);background:rgba(8,20,30,.45);color:#e8fbff;
  font:600 13px "Orbitron",system-ui,sans-serif;letter-spacing:.12em;border-radius:50%;touch-action:none;user-select:none;-webkit-user-select:none}
.vm-touch.is-visible{display:flex;align-items:center;justify-content:center}
.vm-touch--fire{right:max(24px,env(safe-area-inset-right));bottom:120px;width:84px;height:84px}
.vm-touch--reload{right:120px;bottom:150px;width:56px;height:56px}
`;

export function createAmmoHud() {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.className = "vm-ammo";
  root.setAttribute("aria-hidden", "true");
  document.body.appendChild(root);

  const fireBtn = document.createElement("button");
  fireBtn.className = "vm-touch vm-touch--fire";
  fireBtn.textContent = "FIRE";
  const reloadBtn = document.createElement("button");
  reloadBtn.className = "vm-touch vm-touch--reload";
  reloadBtn.textContent = "R";

  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  if (coarse) {
    document.body.append(fireBtn, reloadBtn);
  }

  function set(ammo, reserve, reloading) {
    root.classList.toggle("is-empty", ammo === 0 && !reloading);
    root.innerHTML = `${ammo}<span class="vm-ammo__res"> / ${reserve}</span><small>${
      reloading ? "RELOADING" : ammo === 0 ? "PRESS R" : "VSK-94"
    }</small>`;
  }

  function setVisible(visible) {
    root.classList.toggle("is-visible", visible);
    fireBtn.classList.toggle("is-visible", visible && coarse);
    reloadBtn.classList.toggle("is-visible", visible && coarse);
  }

  function bindTouch({ onFireDown, onFireUp, onReload }) {
    fireBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      fireBtn.setPointerCapture?.(e.pointerId);
      onFireDown();
    });
    for (const type of ["pointerup", "pointercancel"]) {
      fireBtn.addEventListener(type, onFireUp);
    }
    reloadBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      onReload();
    });
  }

  function destroy() {
    root.remove();
    fireBtn.remove();
    reloadBtn.remove();
    style.remove();
  }

  return { set, setVisible, bindTouch, destroy };
}
