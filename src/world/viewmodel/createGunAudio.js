/**
 * Player gun audio — Web Audio buffer from /sounds/ak-74.mp3.
 * More reliable than HTMLAudioElement on mobile / Termux browsers.
 * Procedural fallback if the file is missing or decode fails.
 */

const SHOT_URLS = [
  "/sounds/ak-74.mp3",
  "/sounds/Ak-74.mp3", // case-sensitive FS (Linux) / historical asset name
  "/sounds/ak74-shot.mp3", // tiny legacy fallback in repo
];

export function createGunAudio() {
  let ctx = null;
  let noiseBuffer = null;
  /** @type {AudioBuffer | null} */
  let shotBuffer = null;
  let loadPromise = null;
  let loadFailed = false;

  function ensureCtx() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const length = Math.floor(ctx.sampleRate * 0.3);
      noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    if (ctx.state === "suspended") {
      ctx.resume?.();
    }
    return ctx;
  }

  async function loadShotBuffer() {
    if (shotBuffer || loadFailed) return shotBuffer;
    if (loadPromise) return loadPromise;

    loadPromise = (async () => {
      const c = ensureCtx();
      if (!c) {
        loadFailed = true;
        return null;
      }

      for (const url of SHOT_URLS) {
        try {
          const res = await fetch(url, { cache: "force-cache" });
          if (!res.ok) {
            console.warn("[GunAudio] HTTP", res.status, url);
            continue;
          }
          const arr = await res.arrayBuffer();
          shotBuffer = await c.decodeAudioData(arr.slice(0));
          console.info(
            "[GunAudio] loaded",
            url,
            `${shotBuffer.duration.toFixed(2)}s`,
          );
          return shotBuffer;
        } catch (err) {
          console.warn("[GunAudio] decode failed", url, err?.message || err);
        }
      }

      loadFailed = true;
      console.warn("[GunAudio] no sample — procedural only");
      return null;
    })();

    return loadPromise;
  }

  // Kick off fetch early (decode still needs a live AudioContext)
  if (typeof window !== "undefined") {
    // Don't create AudioContext until gesture; just warm the HTTP cache
    fetch(SHOT_URLS[0], { cache: "force-cache" }).catch(() => {});
  }

  function playBuffer(buffer, volume = 1) {
    const c = ensureCtx();
    if (!c || !buffer) return false;
    const src = c.createBufferSource();
    src.buffer = buffer;
    const g = c.createGain();
    g.gain.value = volume;
    src.connect(g).connect(c.destination);
    src.start(0);
    return true;
  }

  function proceduralShot() {
    const c = ensureCtx();
    if (!c) return;
    const t = c.currentTime;

    const noise = c.createBufferSource();
    noise.buffer = noiseBuffer;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(500, t + 0.14);
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.55, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    noise.connect(lp).connect(ng).connect(c.destination);
    noise.start(t);
    noise.stop(t + 0.2);

    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const og = c.createGain();
    og.gain.setValueAtTime(0.6, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc.connect(og).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  function shot() {
    ensureCtx();

    if (shotBuffer) {
      playBuffer(shotBuffer, 1.0);
      return;
    }

    // First shots may arrive before decode finishes
    loadShotBuffer().then((buf) => {
      if (buf) playBuffer(buf, 1.0);
      else proceduralShot();
    });

    // Immediate feedback if still loading
    if (!shotBuffer) proceduralShot();
  }

  function click(delay = 0) {
    const c = ensureCtx();
    if (!c) return;
    const t = c.currentTime + delay;
    const noise = c.createBufferSource();
    noise.buffer = noiseBuffer;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800;
    const g = c.createGain();
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    noise.connect(hp).connect(g).connect(c.destination);
    noise.start(t);
    noise.stop(t + 0.05);
  }

  function dispose() {
    shotBuffer = null;
    loadPromise = null;
    ctx?.close?.();
    ctx = null;
  }

  return { shot, click, dispose, preload: loadShotBuffer };
}
