'use strict';

// Chord + key detection via chromagram + template matching. Pure JS, no ML.
// Given a mono Float32Array PCM signal and its sample rate, returns:
//   {
//     key:    { tonic: "C", mode: "major" | "minor", label: "C major" },
//     chords: [ { start, end, chord } ]    // seconds; "chord" like "C" or "Am"
//   }
//
// Pipeline:
//   1) STFT (Hann window, N_FFT=8192, hop=2048).
//   2) Chromagram: fold each FFT bin into 12 pitch classes (log-freq).
//   3) Median smoothing over ~1 s to damp transients/percussion.
//   4) Chord classification per frame: argmax over 24 templates (major + minor
//      triads for each root), scored as cosine similarity.
//   5) Segmentation: contiguous frames with same label -> {start,end,chord};
//      segments shorter than MIN_SEG_SEC are merged into the longer neighbour.
//   6) Key: aggregate chromagram, correlate with Krumhansl-Schmuckler major/minor
//      profiles at all 12 rotations, pick the highest.
//
// Accuracy is around what you'd expect for classic chromagram+template chord
// detection on pop/rock: good on triad-heavy material, weaker on extended chords
// and dense arrangements. For a proper upgrade later, swap this file's `analyze`
// with an ML model call; the shape of the output is stable.

const FFT = require('fft.js');

const N_FFT = 8192;
const HOP   = 2048;
const F_MIN = 55;   // A1 - below here mostly noise/rumble
const F_MAX = 5500; // above here mostly percussive noise
const SMOOTH_SEC = 1.0;
const MIN_SEG_SEC = 0.35; // shorter than this -> absorbed into a neighbour

const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Triad profiles at root C. Rotate for other roots.
const TPL_MAJOR = [1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0]; // C E G
const TPL_MINOR = [1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0]; // C Eb G

// Krumhansl-Schmuckler key profiles (Kessler & Krumhansl 1982).
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function hannWindow(n) {
  const w = new Float32Array(n);
  const a = 2 * Math.PI / (n - 1);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos(a * i));
  return w;
}

// Build a lookup table: for each FFT bin in [fmin..fmax], which pitch class it
// contributes to (or -1 if outside the range). Also precomputes the fractional
// weight — bin's contribution is split between the nearest PC and its neighbour
// when the note is between two semitones, which helps with slightly detuned
// tracks (before auto-tuning kicks in).
function buildBinToChroma(sampleRate) {
  const nBins = N_FFT / 2;
  const primary = new Int8Array(nBins).fill(-1);
  const secondary = new Int8Array(nBins).fill(-1);
  const wPrimary = new Float32Array(nBins);
  for (let k = 1; k < nBins; k++) {
    const f = (k * sampleRate) / N_FFT;
    if (f < F_MIN || f > F_MAX) continue;
    const midi = 69 + 12 * Math.log2(f / 440);
    const lo = Math.floor(midi);
    const frac = midi - lo;
    primary[k]   = ((lo % 12) + 12) % 12;
    secondary[k] = (((lo + 1) % 12) + 12) % 12;
    wPrimary[k]  = 1 - frac;
  }
  return { primary, secondary, wPrimary };
}

// Compute chromagram: 12 x nFrames. Uses fft.js' real FFT.
function chromagram(pcm, sampleRate, onProgress) {
  const win = hannWindow(N_FFT);
  const fft = new FFT(N_FFT);
  const inBuf = fft.createComplexArray();
  const outBuf = fft.createComplexArray();
  const lut = buildBinToChroma(sampleRate);
  const nBins = N_FFT / 2;

  const nFrames = Math.max(0, Math.floor((pcm.length - N_FFT) / HOP) + 1);
  const chroma = new Float32Array(12 * nFrames);

  let lastPct = -1;
  for (let f = 0; f < nFrames; f++) {
    const off = f * HOP;
    // Real input into interleaved complex buffer (imag = 0).
    for (let i = 0; i < N_FFT; i++) {
      inBuf[2 * i]     = pcm[off + i] * win[i];
      inBuf[2 * i + 1] = 0;
    }
    fft.transform(outBuf, inBuf);

    for (let k = 1; k < nBins; k++) {
      const pc1 = lut.primary[k];
      if (pc1 < 0) continue;
      const re = outBuf[2 * k], im = outBuf[2 * k + 1];
      const mag = Math.sqrt(re * re + im * im);
      const w1 = lut.wPrimary[k];
      chroma[f * 12 + pc1] += mag * w1;
      chroma[f * 12 + lut.secondary[k]] += mag * (1 - w1);
    }

    // Normalize the frame (L1) so loudness doesn't skew classification.
    let s = 0;
    for (let i = 0; i < 12; i++) s += chroma[f * 12 + i];
    if (s > 0) for (let i = 0; i < 12; i++) chroma[f * 12 + i] /= s;

    if (onProgress) {
      const pct = Math.floor((f / nFrames) * 100);
      if (pct !== lastPct) { onProgress(pct / 100); lastPct = pct; }
    }
  }
  return { chroma, nFrames };
}

// Median filter each of the 12 pitch classes independently, over a window of
// ~SMOOTH_SEC. Attenuates percussive spikes and stabilises the classification.
function medianSmooth(chroma, nFrames, sampleRate) {
  const winFrames = Math.max(3, Math.round((SMOOTH_SEC * sampleRate) / HOP) | 1); // odd
  const half = winFrames >> 1;
  const buf = new Float32Array(winFrames);
  const out = new Float32Array(chroma.length);
  for (let pc = 0; pc < 12; pc++) {
    for (let f = 0; f < nFrames; f++) {
      let n = 0;
      for (let j = -half; j <= half; j++) {
        const idx = f + j;
        if (idx >= 0 && idx < nFrames) buf[n++] = chroma[idx * 12 + pc];
      }
      // Partial sort (nth-element) would be faster; for our sizes .sort is fine.
      const slice = buf.subarray(0, n);
      Array.prototype.sort.call(slice, (a, b) => a - b);
      out[f * 12 + pc] = slice[n >> 1];
    }
  }
  return out;
}

// Rotate a length-12 template by r positions (so root C -> root r).
function rotated(tpl, r) {
  const out = new Float32Array(12);
  for (let i = 0; i < 12; i++) out[i] = tpl[(i - r + 12) % 12];
  return out;
}

function dot12(a, b, aOff = 0) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += a[aOff + i] * b[i];
  return s;
}

function norm12(a, off = 0) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += a[off + i] * a[off + i];
  return Math.sqrt(s);
}

// Classify each chroma frame as one of 24 triads (12 major + 12 minor). Returns
// an Int32Array of labels: 0..11 = C..B major, 12..23 = Cm..Bm.
function classify(chroma, nFrames) {
  const templates = [];
  for (let r = 0; r < 12; r++) templates.push({ label: r, tpl: rotated(TPL_MAJOR, r), norm: Math.sqrt(3) });
  for (let r = 0; r < 12; r++) templates.push({ label: 12 + r, tpl: rotated(TPL_MINOR, r), norm: Math.sqrt(3) });

  const labels = new Int32Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const cNorm = norm12(chroma, f * 12);
    if (cNorm < 1e-9) { labels[f] = -1; continue; } // silence -> "no chord"
    let bestScore = -Infinity;
    let bestLabel = 0;
    for (let t = 0; t < 24; t++) {
      const tpl = templates[t];
      const s = dot12(chroma, tpl.tpl, f * 12) / (cNorm * tpl.norm);
      if (s > bestScore) { bestScore = s; bestLabel = tpl.label; }
    }
    labels[f] = bestLabel;
  }
  return labels;
}

function labelToChord(label) {
  if (label < 0) return 'N';         // no chord / silence
  if (label < 12) return PC_NAMES[label];
  return PC_NAMES[label - 12] + 'm';
}

// Compact consecutive frames with the same label into segments; then absorb
// segments shorter than MIN_SEG_SEC into the longer neighbouring segment (this
// smooths out spurious 1-2 frame flips between adjacent chords).
function segment(labels, nFrames, sampleRate) {
  const frameSec = HOP / sampleRate;
  const segs = [];
  let start = 0;
  for (let f = 1; f <= nFrames; f++) {
    if (f === nFrames || labels[f] !== labels[start]) {
      segs.push({
        start: start * frameSec,
        end: f * frameSec,
        label: labels[start]
      });
      start = f;
    }
  }
  // Absorb short segments (except leading/trailing silence — keep those as-is
  // so the strip shows a natural "no chord" at song start/end if applicable).
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if ((s.end - s.start) >= MIN_SEG_SEC) continue;
      const prev = segs[i - 1];
      const next = segs[i + 1];
      const target = (prev && next)
        ? ((prev.end - prev.start) >= (next.end - next.start) ? prev : next)
        : (prev || next);
      if (!target) continue;
      if (target === prev) prev.end = s.end;
      else next.start = s.start;
      segs.splice(i, 1);
      changed = true;
      break;
    }
  }
  // Merge consecutive segments that ended up with the same label after absorption.
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && last.label === s.label) last.end = s.end;
    else merged.push({ ...s });
  }
  return merged.map((s) => ({ start: +s.start.toFixed(3), end: +s.end.toFixed(3), chord: labelToChord(s.label) }));
}

// Krumhansl-Schmuckler key estimation on the aggregated chroma.
function estimateKey(chroma, nFrames) {
  const agg = new Float32Array(12);
  for (let f = 0; f < nFrames; f++)
    for (let i = 0; i < 12; i++) agg[i] += chroma[f * 12 + i];
  // Zero-mean centre both vectors -> Pearson correlation (KS's convention).
  const centre = (v) => {
    const arr = v.slice();
    let m = 0;
    for (let i = 0; i < 12; i++) m += arr[i];
    m /= 12;
    for (let i = 0; i < 12; i++) arr[i] -= m;
    return arr;
  };
  const cAgg = centre(agg);
  const cMaj = centre(KS_MAJOR);
  const cMin = centre(KS_MINOR);

  let best = { score: -Infinity, tonic: 0, mode: 'major' };
  for (let r = 0; r < 12; r++) {
    // Rotate the aggregate so that pitch class `r` sits at index 0 - equivalent
    // to correlating the profile at root r with the fixed chroma.
    const rot = new Float32Array(12);
    for (let i = 0; i < 12; i++) rot[i] = cAgg[(i + r) % 12];
    const sMaj = dot12(rot, cMaj);
    const sMin = dot12(rot, cMin);
    if (sMaj > best.score) best = { score: sMaj, tonic: r, mode: 'major' };
    if (sMin > best.score) best = { score: sMin, tonic: r, mode: 'minor' };
  }
  const tonic = PC_NAMES[best.tonic];
  return { tonic, mode: best.mode, label: `${tonic} ${best.mode === 'major' ? 'maggiore' : 'minore'}` };
}

// Public entry point. `pcm` is a mono Float32Array, `sampleRate` in Hz.
// `onProgress(fraction)` is called with values in [0,1] during the STFT pass.
function analyze(pcm, sampleRate, onProgress) {
  const { chroma, nFrames } = chromagram(pcm, sampleRate, onProgress);
  if (nFrames === 0) return { key: null, chords: [] };
  const smoothed = medianSmooth(chroma, nFrames, sampleRate);
  const labels = classify(smoothed, nFrames);
  const chords = segment(labels, nFrames, sampleRate);
  const key = estimateKey(smoothed, nFrames);
  return { key, chords };
}

module.exports = { analyze };
