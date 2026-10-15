/**
 * Shows JS errors and WebGPU device loss on screen (a black canvas with a working HUD
 * usually means the GPU device was lost or a pipeline failed). Remove any time.
 */
export function installGpuWatch(renderer) {
  let box = null;
  const show = (msg) => {
    console.error("[gpu-watch]", msg);
    if (!box) {
      box = document.createElement("div");
      box.style.cssText =
        "position:fixed;left:6px;right:6px;bottom:6px;z-index:2147483000;max-height:34vh;overflow:auto;padding:8px;" +
        "font:11px/1.35 ui-monospace,Menlo,monospace;color:#ffb4b4;background:rgba(40,0,0,.82);border:1px solid #ff5a5a;white-space:pre-wrap;pointer-events:none";
      document.body.appendChild(box);
    }
    box.textContent += msg + "\n";
  };
  window.addEventListener("error", (e) => show("JS error: " + (e.message || e.error)));
  window.addEventListener("unhandledrejection", (e) => show("Promise error: " + (e.reason?.message || e.reason)));
  try {
    const dev = renderer?.backend?.device;
    if (dev) {
      dev.lost?.then((info) => show("GPU DEVICE LOST (" + info.reason + "): " + info.message));
      dev.addEventListener?.("uncapturederror", (e) => show("GPU error: " + String(e.error?.message || e.error).slice(0, 240)));
    }
  } catch {
    /* optional */
  }
}
