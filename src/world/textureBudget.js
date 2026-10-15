/**
 * Caps decoded texture size before the GPU ever sees it (phones run out of VRAM
 * with two Adams + city + hovercar). Call on a freshly loaded model, before scene.add().
 */
export function capTextureSize(root, maxSize = 1024) {
  if (typeof document === "undefined") return 0;
  const seen = new Set();
  let savedMB = 0;
  root.traverse((o) => {
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      for (const key in m) {
        const t = m[key];
        if (!t || !t.isTexture || seen.has(t)) continue;
        seen.add(t);
        if (t.isCompressedTexture || t.isCubeTexture || t.isDataTexture) continue;
        const img = t.image;
        const w = img && img.width, h = img && img.height;
        if (!w || !h || Math.max(w, h) <= maxSize) continue;
        try {
          const k = maxSize / Math.max(w, h);
          const c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(w * k));
          c.height = Math.max(1, Math.round(h * k));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          t.image = c;
          t.needsUpdate = true;
          savedMB += ((w * h - c.width * c.height) * 4 * 1.33) / 1e6;
        } catch {
          /* keep the original texture */
        }
      }
    }
  });
  if (savedMB > 0) console.info("[gpu] textures capped to " + maxSize + "px, saved ~" + Math.round(savedMB) + " MB of GPU memory");
  return savedMB;
}
