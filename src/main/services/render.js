'use strict';

// Offline render of the processed audio for export. Uses the SAME Rubber Band
// engine + options as the realtime AudioWorklet (R3 / formant-preserved), so the
// exported file sounds exactly like playback, with the current speed and pitch.

const fs = require('fs');
const { RubberBandInterface, RubberBandOption } = require('rubberband-wasm');

const SR = 44100;
const CH = 2;
const MAX_BLOCK = 4096;

// Mix separated stems into stereo [L,R] applying the current gains/mute/solo
// (mirrors the worklet's _audibleTracks + _feedMix). `sources` is the stem-name
// order; `stemState[i]` is { gain, mute, solo } for sources[i].
function mixStems(cache, sources, stemState) {
  const total = cache.total;
  const L = new Float32Array(total), R = new Float32Array(total);
  const anySolo = stemState.some((s) => s && s.solo);
  sources.forEach((name, i) => {
    const st = stemState[i] || { gain: 1, mute: false, solo: false };
    const audible = anySolo ? st.solo : !st.mute;
    if (!audible) return;
    const g = st.gain == null ? 1 : st.gain;
    const inter = cache.stems[name];
    for (let k = 0, j = 0; k < total; k++) { L[k] += inter[j++] * g; R[k] += inter[j++] * g; }
  });
  return { channels: [L, R], total };
}

// channels: [Float32Array L, Float32Array R]. Returns interleaved stereo f32.
async function renderProcessed({ channels, total, semitones, cents, speedPct, volume, wasmPath, onProgress }) {
  const vol = volume == null ? 1 : volume;
  const clip = (x) => (x > 1 ? 1 : x < -1 ? -1 : x);
  const timeRatio = 100 / (speedPct || 100);                       // output/input duration
  const pitchScale = Math.pow(2, ((semitones * 100) + (cents || 0)) / 1200);

  const module = await WebAssembly.compile(fs.readFileSync(wasmPath));
  const rb = await RubberBandInterface.initialize(module);
  const opts =
    RubberBandOption.RubberBandOptionProcessRealTime |
    RubberBandOption.RubberBandOptionEngineFiner |
    RubberBandOption.RubberBandOptionFormantPreserved |
    RubberBandOption.RubberBandOptionPitchHighConsistency;
  const state = rb.rubberband_new(SR, CH, opts, timeRatio, pitchScale);
  rb.rubberband_set_max_process_size(state, MAX_BLOCK);

  const inPtrs = rb.malloc(CH * 4), outPtrs = rb.malloc(CH * 4);
  const inBuf = [], outBuf = [];
  for (let c = 0; c < CH; c++) {
    const ib = rb.malloc(MAX_BLOCK * 4), ob = rb.malloc(MAX_BLOCK * 4);
    inBuf.push(ib); outBuf.push(ob);
    rb.memWritePtr(inPtrs + c * 4, ib);
    rb.memWritePtr(outPtrs + c * 4, ob);
  }

  const chunksL = [], chunksR = [];
  const scratch = new Float32Array(MAX_BLOCK);
  const drain = () => {
    let avail;
    while ((avail = rb.rubberband_available(state)) > 0) {
      const n = Math.min(avail, MAX_BLOCK);
      rb.rubberband_retrieve(state, outPtrs, n);
      chunksL.push(rb.memReadF32(outBuf[0], n).slice(0, n));
      chunksR.push(rb.memReadF32(outBuf[1], n).slice(0, n));
    }
  };

  let pos = 0;
  while (pos < total) {
    let req = rb.rubberband_get_samples_required(state);
    if (req <= 0) req = 1024;
    const block = Math.min(req, MAX_BLOCK, total - pos);
    for (let c = 0; c < CH; c++) {
      scratch.set(channels[c].subarray(pos, pos + block));
      rb.memWrite(inBuf[c], scratch.subarray(0, block));
    }
    const final = pos + block >= total ? 1 : 0;
    rb.rubberband_process(state, inPtrs, block, final);
    pos += block;
    drain();
    if (onProgress) onProgress(pos / total);
  }
  drain();

  let outTotal = 0;
  for (const c of chunksL) outTotal += c.length;
  const inter = new Float32Array(outTotal * 2);
  let w = 0;
  for (let bi = 0; bi < chunksL.length; bi++) {
    const Lc = chunksL[bi], Rc = chunksR[bi];
    for (let i = 0; i < Lc.length; i++) { inter[w++] = clip(Lc[i] * vol); inter[w++] = clip(Rc[i] * vol); }
  }
  return { interleaved: inter, frames: outTotal, sampleRate: SR };
}

module.exports = { mixStems, renderProcessed, SR };
