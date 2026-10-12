/**
 * Player gun audio — loads /sounds/ak-74.mp3 and plays it on each shot.
 * Falls back to a short procedural burst if the sample fails to load.
 * AudioContext / Audio elements are only started after a user gesture (first shot).
 */

const SHOT_URL = "/sounds/ak-74.mp3";
const POOL_SIZE = 6; // overlapping shots while holding fire

export function createGunAudio() {
  let ctx = null;
  let noiseBuffer = null;
  /** @type {HTMLAudioElement[]} */
  const pool = [];
  let poolIndex = 0;
  let sampleReady = false;
  let loadStarted = false;

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

  function ensureSample() {
    if (loadStarted) return;
    loadStarted = true;
    for (let i = 0; i < POOL_SIZE; i += 1) {
      const a = new Audio(SHOT_URL);
      a.preload = "auto";
      a.volume = 0.85;
      pool.push(a);
    }
    // Warm the first element so the first shot is less likely to hitch
    pool[0].addEventListener(
      "canplaythrough",
      () => {
        sampleReady = true;
      },
      { once: true },
    );
    pool[0].load();
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
    ng.gain.setValueAtTime(0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    noise.connect(lp).connect(ng).connect(c.destination);
    noise.start(t);
    noise.stop(t + 0.2);

    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.09);
    const og = c.createGain();
    og.gain.setValueAtTime(0.55, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc.connect(og).connect(c.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  function shot() {
    ensureSample();
    ensureCtx();

    if (pool.length > 0) {
      const a = pool[poolIndex % pool.length];
      poolIndex += 1;
      try {
        a.currentTime = 0;
        const p = a.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => {
            if (!sampleReady) proceduralShot();
          });
        }
        return;
      } catch {
        /* fall through */
      }
    }
    proceduralShot();
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
    for (const a of pool) {
      a.pause();
      a.src = "";
    }
    pool.length = 0;
    ctx?.close?.();
    ctx = null;
  }

  return { shot, click, dispose };
}
