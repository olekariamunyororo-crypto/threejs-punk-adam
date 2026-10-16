/**
 * Synthesised Beretta 92-style 9mm shot: sharp crack, light body, slide click, alley slap-back.
 * Works on any AudioContext (also OfflineAudioContext). dist in metres.
 */
const bufCache = new WeakMap();
const noiseFor = (ctx) => {
  let b = bufCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.4), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    bufCache.set(ctx, b);
  }
  return b;
};

export function playBerettaShot(ctx, { dist = 8, volume = 1, when } = {}) {
  const t0 = (when ?? ctx.currentTime) + 0.002;
  const v = Math.min(1, 1.8 / (1 + dist / 6)) * volume * 0.6; // headroom for the rest of the mix
  const cutoff = 9500 - Math.min(1, dist / 45) * 7200; // distant shots lose the top end
  const buf = noiseFor(ctx);

  const burst = (start, { hp = 0, bp = 0, q = 0.8, lp = cutoff, gain, attack = 0.0008, decay }) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    let node = src;
    if (hp) {
      const f = ctx.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = hp;
      node = node.connect(f);
    }
    if (bp) {
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = bp;
      f.Q.value = q;
      node = node.connect(f);
    }
    const l = ctx.createBiquadFilter();
    l.type = "lowpass";
    l.frequency.value = lp;
    node = node.connect(l);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(gain * v, start + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, start + decay);
    node.connect(g).connect(ctx.destination);
    src.start(start, Math.random() * 0.2);
    src.stop(start + decay + 0.02);
  };

  burst(t0, { hp: 1400, bp: 3300, q: 0.7, gain: 0.95, decay: 0.07 }); // the crack
  burst(t0, { bp: 1100, q: 0.9, gain: 0.5, decay: 0.12 }); // body of the report
  burst(t0 + 0.05, { hp: 5500, gain: 0.16, attack: 0.001, decay: 0.014 }); // slide cycling click
  burst(t0 + 0.085, { bp: 2200, q: 0.7, lp: Math.min(cutoff, 2800), gain: 0.24, attack: 0.004, decay: 0.13 }); // alley slap
  burst(t0 + 0.17, { bp: 1800, q: 0.7, lp: Math.min(cutoff, 2200), gain: 0.1, attack: 0.006, decay: 0.16 }); // second slap

  // low thump
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(260, t0);
  o.frequency.exponentialRampToValueAtTime(75, t0 + 0.08);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.6 * v, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.11);
  o.connect(g).connect(ctx.destination);
  o.start(t0);
  o.stop(t0 + 0.13);
}
