// Metronome click timbres, all synthesized with Web Audio (no sample files).
// Each preset renders one-shot nodes scheduled at an absolute context time, so
// they work with the metronome's look-ahead scheduler.
//
// `trim` normalizes the level across presets so the volume slider stays
// meaningful when switching sounds. Values are peak-matched against the
// original click (measured offline), with a small discount for the timbres
// centred above ~2 kHz, where the ear is more sensitive. They also leave
// headroom: at volume 1 an accented click peaks just under full scale.

const MIN = 0.0001; // exponentialRampToValueAtTime cannot reach 0

// One shared white-noise buffer per AudioContext (cowbell/rimshot/woodblock
// would otherwise regenerate it on every click — 5/s at 300 BPM).
const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    const len = Math.floor(ctx.sampleRate * 0.25);
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

function noiseSource(ctx, t, dur) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuffer(ctx);
  s.loop = true;
  s.start(t);
  s.stop(t + dur);
  return s;
}

// Percussive envelope: near-instant attack to `peak`, exponential decay.
function env(ctx, t, peak, attack, decay) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(MIN, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, MIN), t + attack);
  g.gain.exponentialRampToValueAtTime(MIN, t + decay);
  return g;
}

function tone(ctx, type, freq, t, stop) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.start(t);
  o.stop(t + stop);
  return o;
}

export const METRO_SOUNDS = [
  {
    id: 'click',
    label: 'Click',
    trim: 0.8,
    // The original click: plain sine, 1 ms attack, 50 ms decay.
    render(ctx, t, accent, peak, dest) {
      const g = env(ctx, t, peak, 0.001, 0.05);
      tone(ctx, 'sine', accent ? 1600 : 1000, t, 0.06).connect(g).connect(dest);
    }
  },
  {
    id: 'beep',
    label: 'Beep',
    trim: 0.81,
    // Softer, rounder: triangle with a longer tail.
    render(ctx, t, accent, peak, dest) {
      const g = env(ctx, t, peak, 0.004, 0.08);
      tone(ctx, 'triangle', accent ? 1320 : 880, t, 0.1).connect(g).connect(dest);
    }
  },
  {
    id: 'woodblock',
    label: 'Legnetto',
    trim: 0.63,
    // Wooden knock: a fast downward pitch sweep plus a bright noise transient.
    render(ctx, t, accent, peak, dest) {
      const f = accent ? 2100 : 1400;
      const g = env(ctx, t, peak, 0.001, 0.035);
      g.connect(dest);
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.65, t + 0.015);
      o.connect(g);
      o.start(t);
      o.stop(t + 0.05);
      // Click transient: very short highpassed noise.
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 3000;
      const ng = env(ctx, t, peak * 0.5, 0.001, 0.008);
      noiseSource(ctx, t, 0.02).connect(hp).connect(ng).connect(dest);
    }
  },
  {
    id: 'cowbell',
    label: 'Cowbell',
    trim: 0.56,
    // TR-808 style: two detuned squares through a narrow bandpass, two-stage decay.
    render(ctx, t, accent, peak, dest) {
      const m = accent ? 1.15 : 1;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2600;
      bp.Q.value = 1.2;
      const g = ctx.createGain();
      g.gain.setValueAtTime(MIN, t);
      g.gain.exponentialRampToValueAtTime(Math.max(peak, MIN), t + 0.002);
      g.gain.exponentialRampToValueAtTime(Math.max(peak * 0.35, MIN), t + 0.01);
      g.gain.exponentialRampToValueAtTime(MIN, t + 0.25);
      bp.connect(g).connect(dest);
      tone(ctx, 'square', 540 * m, t, 0.28).connect(bp);
      tone(ctx, 'square', 800 * m, t, 0.28).connect(bp);
    }
  },
  {
    id: 'rimshot',
    label: 'Rimshot',
    trim: 1.33,
    // Side-stick: tight bandpassed noise burst over a short resonant body tone.
    render(ctx, t, accent, peak, dest) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = accent ? 2200 : 1700;
      bp.Q.value = 6;
      const g = env(ctx, t, peak, 0.001, 0.04);
      noiseSource(ctx, t, 0.06).connect(bp).connect(g).connect(dest);
      const bg = env(ctx, t, peak * 0.6, 0.001, 0.03);
      tone(ctx, 'sine', accent ? 500 : 400, t, 0.05).connect(bg).connect(dest);
    }
  },
  {
    id: 'clave',
    label: 'Clave',
    trim: 0.68,
    // Pure high sine with a very short decay: cuts through a dense mix.
    render(ctx, t, accent, peak, dest) {
      const g = env(ctx, t, peak, 0.001, 0.03);
      tone(ctx, 'sine', accent ? 3300 : 2500, t, 0.04).connect(g).connect(dest);
    }
  }
];

export const DEFAULT_SOUND = 'click';

const BY_ID = new Map(METRO_SOUNDS.map((s) => [s.id, s]));

export function isMetroSound(id) { return BY_ID.has(id); }

// Schedule one click of the given preset at context time `t`.
// `volume` is 0..1; silent volumes skip scheduling entirely.
export function renderClick(ctx, id, t, accent, volume, dest) {
  if (!(volume > 0)) return;
  const s = BY_ID.get(id) || BY_ID.get(DEFAULT_SOUND);
  const peak = volume * s.trim * (accent ? 1.25 : 1);
  s.render(ctx, t, accent, peak, dest);
}
