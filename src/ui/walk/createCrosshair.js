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
