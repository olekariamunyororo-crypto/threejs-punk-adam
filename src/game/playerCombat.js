/**
 * Player life state, "YOU DIED" overlay and HUD vitals sync.
 * main.js sets  playerState.onRespawn = () => { ... }  to reset the world.
 */
let overlay = null;
let btn = null;
let armTimer = null;

function setVitals(pct) {
  const root = document.querySelector(".cyber-hud");
  if (!root) return;
  root.querySelectorAll(".hud-vitals .hud-value, .hud-compact-value").forEach((el) => {
    el.textContent = Math.round(pct) + "%";
  });
  const fill = root.querySelector(".hud-gauge-fill");
  if (fill) fill.style.width = pct + "%";
}

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement("div");
  overlay.id = "death-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:100000;display:none;flex-direction:column;align-items:center;justify-content:center;gap:34px;" +
    "background:radial-gradient(ellipse at center,rgba(120,0,20,.35) 0%,rgba(8,0,4,.93) 78%);" +
    "font-family:ui-monospace,Menlo,Consolas,monospace;opacity:0;transition:opacity .7s ease;touch-action:manipulation;-webkit-tap-highlight-color:transparent";
  overlay.innerHTML =
    '<div style="font-size:clamp(34px,12vw,76px);font-weight:700;letter-spacing:.3em;color:#ff3b5c;text-shadow:0 0 26px #ff0033,0 0 60px #800020;padding-left:.3em">YOU DIED</div>' +
    '<button type="button" style="font:inherit;font-size:clamp(16px,5vw,22px);letter-spacing:.35em;padding:16px 34px;color:#22d3ee;background:rgba(10,20,30,.7);' +
    'border:1px solid #22d3ee;box-shadow:0 0 18px rgba(34,211,238,.45);cursor:pointer;touch-action:manipulation">RESPAWN</button>';
  btn = overlay.querySelector("button");
  btn.addEventListener("click", () => playerState.respawn());
  document.body.appendChild(overlay);
  return overlay;
}

export const playerState = {
  dead: false,
  health: 100,
  onRespawn: null,

  /** Take damage; one default hit kills. */
  hit(damage = 100) {
    if (this.dead) return;
    this.health = Math.max(0, this.health - damage);
    setVitals(this.health);
    if (this.health > 0) return;
    this.dead = true;
    const el = ensureOverlay();
    el.style.display = "flex";
    btn.disabled = true; // ignore the finger that was still tapping FIRE
    btn.style.opacity = ".4";
    requestAnimationFrame(() => (el.style.opacity = "1"));
    clearTimeout(armTimer);
    armTimer = setTimeout(() => {
      btn.disabled = false;
      btn.style.opacity = "1";
    }, 900);
  },

  respawn() {
    if (!this.dead) return;
    this.dead = false;
    this.health = 100;
    setVitals(100);
    if (overlay) {
      overlay.style.opacity = "0";
      overlay.style.display = "none";
    }
    try {
      this.onRespawn?.();
    } catch (err) {
      console.warn("[playerState] respawn handler failed:", err);
    }
  },
};
if (typeof window !== "undefined") window.__player = playerState; // __player.hit() to test
