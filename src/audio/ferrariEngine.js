/**
 * Synthesised Ferrari-style flat-plane V8: 6 gears, shift cuts, a rev limiter and
 * exhaust crackle on lift-off. No samples needed. Tune: __ferrari.redline = 9000
 */
export const FERRARI = {
  idle: 1100, // rpm
  redline: 8600,
  gearTop: [9, 15, 21, 27, 34, 44], // m/s at redline in each gear
  firingPerRev: 4, // V8: 4 power strokes per crankshaft turn
  level: 0.9,
};
if (typeof window !== "undefined") window.__ferrari = FERRARI;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function createFerrariEngine({ getVolume = () => 1, ctx: given = null } = {}) {
  let ctx = given;
  let n = null; // audio nodes
  const S = { gear: 0, rpm: FERRARI.idle, shift: 0, thr: 0, lastThr: 0, limiter: 0, age: 0 };

  function noiseBuffer(c) {
    const b = c.createBuffer(1, Math.floor(c.sampleRate * 2), c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  function build() {
    const c = ctx;
    const osc = (type, gain) => {
      const o = c.createOscillator();
      o.type = type;
      const g = c.createGain();
      g.gain.value = gain;
      o.connect(g);
      o.start();
      return { o, g };
    };
    const a = osc("sawtooth", 0.5);
    const b = osc("sawtooth", 0.4);
    b.o.detune.value = 9;
    const sq = osc("square", 0.16); // 2x firing: the "metallic" scream
    const sub = osc("triangle", 0.4); // half firing: body
    const bus = c.createGain();
    bus.gain.value = 1;
    [a, b, sq].forEach((x) => x.g.connect(bus));
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * 2.4);
    }
    shaper.curve = curve;
    shaper.oversample = "2x";
    bus.connect(shaper);
    const scream = c.createBiquadFilter();
    scream.type = "peaking";
    scream.frequency.value = 2100;
    scream.Q.value = 1.1;
    scream.gain.value = 7;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.Q.value = 0.9;
    lp.frequency.value = 2000;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 50;
    shaper.connect(scream).connect(lp).connect(hp);
    const master = c.createGain();
    master.gain.value = 0;
    hp.connect(master);
    sub.g.connect(master);
    // intake / exhaust hiss
    const noise = c.createBufferSource();
    noise.buffer = noiseBuffer(c);
    noise.loop = true;
    const nbp = c.createBiquadFilter();
    nbp.type = "bandpass";
    nbp.Q.value = 0.8;
    nbp.frequency.value = 3000;
    const ng = c.createGain();
    ng.gain.value = 0;
    noise.connect(nbp).connect(ng).connect(master);
    noise.start();
    // growl: amplitude wobble at half the firing rate
    const lfo = c.createOscillator();
    lfo.type = "sine";
    const lg = c.createGain();
    lg.gain.value = 0.1;
    lfo.connect(lg).connect(bus.gain);
    lfo.start();
    master.connect(c.destination);
    n = { a, b, sq, sub, lp, scream, nbp, ng, master, lfo, noiseBuf: noise.buffer };
  }

  function pop(t, level) {
    const src = ctx.createBufferSource();
    src.buffer = n.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 900 + Math.random() * 1600;
    bp.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.045);
    src.connect(bp).connect(g).connect(n.master);
    src.start(t, Math.random());
    src.stop(t + 0.06);
  }

  return {
    /** Call from a user gesture (enter the car). */
    start() {
      try {
        if (!ctx) {
          const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
          if (!AC) return;
          ctx = new AC();
        }
        if (!n) build();
        ctx.resume?.();
      } catch {
        /* audio is optional */
      }
    },
    /** state: { speed (m/s, >=0), throttle 0..1, boost, alt }; dt in seconds; time optional (offline). */
    update({ speed = 0, throttle = 0, boost = false, alt = 0 }, dt = 1 / 60, time) {
      if (!ctx || !n) return;
      const t = time ?? ctx.currentTime;
      const F = FERRARI;
      S.age += dt;
      // gear logic with hysteresis
      let gearRpm = (g) => F.idle + clamp(speed / F.gearTop[g], 0, 1.2) * (F.redline - F.idle);
      let shifted = 0;
      if (S.gear < F.gearTop.length - 1 && gearRpm(S.gear) > F.redline * 0.985 && throttle > 0.3) {
        S.gear++;
        shifted = 1;
        S.shift = 0.14;
      } else if (S.gear > 0 && speed / F.gearTop[S.gear - 1] < 0.66) {
        S.gear--;
        shifted = -1;
        S.rpm = Math.min(F.redline, gearRpm(S.gear) + 600); // blip on the way down
      }
      // clutch slip when launching from a standstill
      const slip = clamp(1 - speed / 5, 0, 1);
      let target = Math.max(gearRpm(S.gear), F.idle + throttle * 5200 * slip);
      if (throttle < 0.05 && slip > 0.9) target = F.idle;
      // limiter bounce at the top of the last gear
      S.limiter = 0;
      if (target > F.redline) {
        S.limiter = Math.sin(S.age * 48) > 0 ? 1 : 0;
        target = F.redline - 350 * S.limiter;
      }
      S.rpm += (target - S.rpm) * Math.min(1, dt * (throttle > 0.2 ? 9 : 5));
      S.rpm = clamp(S.rpm, F.idle * 0.9, F.redline);
      if (S.shift > 0) S.shift -= dt;

      const rpmN = clamp((S.rpm - F.idle) / (F.redline - F.idle), 0, 1);
      const f = (S.rpm / 60) * F.firingPerRev;
      const tc = 0.025;
      n.a.o.frequency.setTargetAtTime(f, t, tc);
      n.b.o.frequency.setTargetAtTime(f, t, tc);
      n.sq.o.frequency.setTargetAtTime(f * 2, t, tc);
      n.sub.o.frequency.setTargetAtTime(f * 0.5, t, tc);
      n.lfo.frequency.setTargetAtTime(f * 0.5, t, tc);
      n.lp.frequency.setTargetAtTime(1300 + rpmN * 5200 + throttle * 1800, t, 0.05);
      n.scream.frequency.setTargetAtTime(1500 + rpmN * 1800, t, 0.08);
      n.nbp.frequency.setTargetAtTime(2200 + rpmN * 3500, t, 0.08);
      n.ng.gain.setTargetAtTime((0.015 + throttle * 0.06 + rpmN * 0.03) * (boost ? 1.3 : 1), t, 0.05);

      let level = (0.07 + 0.15 * throttle + 0.08 * rpmN + (boost ? 0.03 : 0)) * F.level * getVolume();
      if (S.shift > 0) level *= 0.22; // shift cut
      if (S.limiter) level *= 0.55; // limiter chop
      level *= 1 - clamp(alt / 60, 0, 0.25); // a little quieter when high up
      n.master.gain.setTargetAtTime(level, t, S.shift > 0 ? 0.01 : 0.04);

      // exhaust crackle: on lift-off at high revs, and on shifts
      if (S.lastThr > 0.5 && throttle < 0.2 && S.rpm > 4500) {
        const k = 3 + Math.floor(Math.random() * 4);
        for (let i = 0; i < k; i++) pop(t + 0.03 + Math.random() * 0.55, 0.18 + Math.random() * 0.2);
      }
      if (shifted > 0) for (let i = 0; i < 2; i++) pop(t + 0.02 + i * 0.05, 0.28);
      if (shifted < 0) pop(t + 0.01, 0.22);
      S.lastThr = throttle;
    },
    stop() {
      if (ctx && n) n.master.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    },
    get state() {
      return S;
    },
  };
}
