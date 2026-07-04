import FFT from 'fft.js';

// Estimate a track's global tuning offset from A440, in cents [-50, 50].
// Approach (like librosa.estimate_tuning): collect spectral peaks across several
// windows, compute each peak's deviation from the nearest equal-tempered
// semitone, and take a magnitude-weighted circular mean over the 100-cent period.
export function estimateTuning(channels, sampleRate) {
  const SIZE = 16384;
  const mono = channels[0];
  const total = mono.length;
  if (total < SIZE) return 0;

  const fft = new FFT(SIZE);
  const spec = fft.createComplexArray();
  const inp = new Array(SIZE);
  const hann = new Float32Array(SIZE);
  for (let i = 0; i < SIZE; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (SIZE - 1));

  const minHz = 70, maxHz = 2500;
  const minBin = Math.max(1, Math.floor((minHz * SIZE) / sampleRate));
  const maxBin = Math.min(SIZE / 2 - 1, Math.ceil((maxHz * SIZE) / sampleRate));

  let sumSin = 0, sumCos = 0;

  // More windows across the track average out transients for a steadier estimate.
  const nWindows = Math.min(60, Math.max(1, Math.floor(total / SIZE)));
  const step = Math.max(SIZE, Math.floor((total - SIZE) / nWindows));

  const ch1 = channels[1] || channels[0];
  const mags = new Float32Array(maxBin + 2);
  for (let wstart = 0; wstart + SIZE <= total; wstart += step) {
    for (let i = 0; i < SIZE; i++) inp[i] = (mono[wstart + i] + ch1[wstart + i]) * 0.5 * hann[i];
    fft.realTransform(spec, inp);

    let maxMag = 0;
    for (let b = minBin; b <= maxBin; b++) {
      const re = spec[2 * b], im = spec[2 * b + 1];
      const m = Math.sqrt(re * re + im * im);
      mags[b] = m;
      if (m > maxMag) maxMag = m;
    }
    if (maxMag < 1e-6) continue;
    const thresh = maxMag * 0.1; // ignore weak/noisy peaks → much more precise

    // Local maxima with parabolic interpolation for sub-bin frequency.
    for (let b = minBin + 1; b < maxBin; b++) {
      const m = mags[b];
      if (m < thresh || m <= mags[b - 1] || m < mags[b + 1]) continue;
      const a = mags[b - 1], c = mags[b + 1];
      const denom = a - 2 * m + c;
      const delta = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
      const freq = ((b + delta) * sampleRate) / SIZE;
      if (freq <= 0) continue;
      const cents = 1200 * Math.log2(freq / 440);
      const residual = cents - 100 * Math.round(cents / 100); // [-50, 50]
      const angle = (2 * Math.PI * residual) / 100;
      // Weight by squared magnitude so dominant tonal peaks drive the estimate.
      const w = m * m;
      sumSin += w * Math.sin(angle);
      sumCos += w * Math.cos(angle);
    }
  }

  if (sumSin === 0 && sumCos === 0) return 0;
  const meanAngle = Math.atan2(sumSin, sumCos);
  return (100 * meanAngle) / (2 * Math.PI); // cents in [-50, 50]
}
