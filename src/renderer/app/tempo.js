import FFT from 'fft.js';

// Estimate tempo (BPM) and beat grid from decoded audio.
// Method: spectral-flux onset envelope -> detrend -> autocorrelation for the
// dominant period -> phase search for the first beat. Returns
// { bpm, firstBeat (s), period (s) } or null.
export function detectTempo(channels, sampleRate) {
  const SIZE = 1024;
  const HOP = 512;
  const fps = sampleRate / HOP;
  const mono = channels[0];
  const ch1 = channels[1] || channels[0];
  const nFrames = Math.floor((mono.length - SIZE) / HOP);
  if (nFrames < 120) return null;

  const fft = new FFT(SIZE);
  const spec = fft.createComplexArray();
  const inp = new Array(SIZE);
  const hann = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SIZE - 1));

  const half = SIZE / 2;
  const env = new Float32Array(nFrames);
  let prev = new Float32Array(half);
  const cur = new Float32Array(half);

  for (let f = 0; f < nFrames; f++) {
    const off = f * HOP;
    for (let i = 0; i < SIZE; i++) inp[i] = (mono[off + i] + ch1[off + i]) * 0.5 * hann[i];
    fft.realTransform(spec, inp);
    let flux = 0;
    for (let k = 0; k < half; k++) {
      const re = spec[2 * k], im = spec[2 * k + 1];
      const m = Math.sqrt(re * re + im * im);
      cur[k] = m;
      const d = m - prev[k];
      if (d > 0) flux += d;
    }
    env[f] = flux;
    prev.set(cur);
  }

  // Detrend: subtract a slow moving average (only removes drift, not beat-level
  // periodicity), then half-wave rectify.
  const win = Math.max(4, Math.round(fps * 2.0));
  const det = new Float32Array(nFrames);
  let acc = 0;
  for (let i = 0; i < nFrames; i++) {
    acc += env[i];
    if (i >= win) acc -= env[i - win];
    const mean = acc / Math.min(i + 1, win);
    const v = env[i] - mean;
    det[i] = v > 0 ? v : 0;
  }

  // Light smoothing so onset peaks span a few frames — makes integer-lag
  // autocorrelation robust to sub-frame beat periods (avoids octave artifacts).
  const sm = new Float32Array(nFrames);
  const kernel = [0.12, 0.24, 0.28, 0.24, 0.12];
  for (let i = 0; i < nFrames; i++) {
    let s = 0;
    for (let j = -2; j <= 2; j++) {
      const idx = i + j;
      if (idx >= 0 && idx < nFrames) s += det[idx] * kernel[j + 2];
    }
    sm[i] = s;
  }
  det.set(sm);

  const bpmMin = 60, bpmMax = 200;
  const lagMin = Math.round((fps * 60) / bpmMax);
  const lagMax = Math.round((fps * 60) / bpmMin);

  const rawScore = (lag) => {
    if (lag <= 0 || lag >= nFrames) return 0;
    let s = 0;
    const n = nFrames - lag;
    for (let i = 0; i < n; i++) s += det[i] * det[i + lag];
    return s / n;
  };

  // Cache raw autocorrelation over the search range (+ harmonics up to 3x).
  const raw = new Float32Array(lagMax * 3 + 2);
  for (let lag = lagMin; lag <= lagMax * 3 + 1 && lag < nFrames; lag++) raw[lag] = rawScore(lag);

  // Perceptual bias toward ~120 BPM (Rayleigh) + harmonic comb to lock onto the
  // fundamental beat period rather than a subdivision.
  const prefPeriod = 0.5; // 120 BPM
  const sigma = 0.55;
  const rayleigh = (p) => (p / (sigma * sigma)) * Math.exp(-(p * p) / (2 * sigma * sigma));

  let bestLag = lagMin, best = -1;
  for (let lag = lagMin; lag <= lagMax; lag++) {
    const comb = raw[lag] + 0.5 * (raw[2 * lag] || 0) + 0.33 * (raw[3 * lag] || 0);
    const s = comb * rayleigh(lag / fps);
    if (s > best) { best = s; bestLag = lag; }
  }

  // Parabolic interpolation around the peak lag (on raw autocorrelation).
  let lagRef = bestLag;
  if (bestLag > lagMin && bestLag < lagMax) {
    const a = raw[bestLag - 1], b = raw[bestLag], c = raw[bestLag + 1];
    const denom = a - 2 * b + c;
    if (denom !== 0) lagRef = bestLag + (0.5 * (a - c)) / denom;
  }

  const period = lagRef / fps;
  const bpm = 60 / period;

  // Phase: best alignment of a pulse train of this period to the envelope.
  const P = bestLag;
  let bestPhase = 0, bestPhaseScore = -1;
  for (let ph = 0; ph < P; ph++) {
    let s = 0, c = 0;
    for (let n = ph; n < nFrames; n += P) { s += det[n]; c++; }
    if (c > 0) { s /= c; if (s > bestPhaseScore) { bestPhaseScore = s; bestPhase = ph; } }
  }
  const firstBeat = bestPhase / fps;

  return { bpm, firstBeat, period, confidence: best };
}
