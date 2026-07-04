// Small shared helpers.

export function formatTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const cs = Math.floor((sec * 100) % 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// Split interleaved PCM into an array of per-channel Float32Array.
export function deinterleave(interleaved, channels, frames) {
  const out = [];
  for (let c = 0; c < channels; c++) out.push(new Float32Array(frames));
  for (let i = 0, f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) out[c][f] = interleaved[i++];
  }
  return out;
}

// Per-bucket peak (max abs of a mono mix) for waveform drawing.
export function computePeaks(channels, frames, buckets) {
  const peaks = new Float32Array(buckets);
  const per = frames / buckets;
  const nch = channels.length;
  for (let b = 0; b < buckets; b++) {
    const start = Math.floor(b * per);
    const end = Math.min(frames, Math.floor((b + 1) * per));
    let max = 0;
    for (let i = start; i < end; i++) {
      let m = 0;
      for (let c = 0; c < nch; c++) m += channels[c][i];
      m = Math.abs(m / nch);
      if (m > max) max = m;
    }
    peaks[b] = max;
  }
  return peaks;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
