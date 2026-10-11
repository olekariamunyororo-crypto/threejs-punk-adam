/**
 * Tiny procedural gun audio (no sample files): suppressed shot + mechanical click.
 * The AudioContext is created lazily on the first shot/click, which always
 * happens inside a user gesture.
 */
export function createGunAudio() {
  let ctx = null;
  let noiseBuffer = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        return null;
      }
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

  function shot() {
    const c = ensure();
    if (!c) {
      return;
    }
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

  function click(delay = 0) {
    const c = ensure();
    if (!c) {
      return;
    }
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
    ctx?.close?.();
    ctx = null;
  }

  return { shot, click, dispose };
}
