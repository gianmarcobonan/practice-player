// Headless validation of the Rubber Band engine usage (pointers, process/retrieve
// loop, pitch + time math) — mirrors what the AudioWorklet does, runnable in Node.
import { readFile } from 'node:fs/promises';
import { RubberBandInterface, RubberBandOption } from '../node_modules/rubberband-wasm/dist/index.esm.js';
import FFT from '../node_modules/fft.js/lib/fft.js';

const SR = 44100;
const CH = 2;
const MAX_BLOCK = 4096;

function tone(freq, seconds) {
  const n = Math.floor(SR * seconds);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = Math.sin((2 * Math.PI * freq * i) / SR) * 0.8;
  return a;
}

function dominantFreq(samples) {
  // Use a power-of-two window from the middle.
  let size = 1 << 14; // 16384
  while (size > samples.length) size >>= 1;
  const start = Math.floor((samples.length - size) / 2);
  const fft = new FFT(size);
  const out = fft.createComplexArray();
  const inp = new Array(size);
  for (let i = 0; i < size; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)); // Hann
    inp[i] = samples[start + i] * w;
  }
  fft.realTransform(out, inp);
  let maxMag = 0, maxBin = 0;
  for (let b = 1; b < size / 2; b++) {
    const re = out[2 * b], im = out[2 * b + 1];
    const mag = re * re + im * im;
    if (mag > maxMag) { maxMag = mag; maxBin = b; }
  }
  return (maxBin * SR) / size;
}

async function runEngine(input, { pitchScale, timeRatio }) {
  const bytes = await readFile(new URL('../node_modules/rubberband-wasm/dist/rubberband.wasm', import.meta.url));
  const module = await WebAssembly.compile(bytes);
  const rb = await RubberBandInterface.initialize(module);
  const opts = RubberBandOption.RubberBandOptionProcessRealTime |
               RubberBandOption.RubberBandOptionPitchHighConsistency;
  const state = rb.rubberband_new(SR, CH, opts, timeRatio, pitchScale);
  rb.rubberband_set_max_process_size(state, MAX_BLOCK);

  const inPtrs = rb.malloc(CH * 4);
  const outPtrs = rb.malloc(CH * 4);
  const inBuf = [], outBuf = [];
  for (let c = 0; c < CH; c++) {
    const ib = rb.malloc(MAX_BLOCK * 4), ob = rb.malloc(MAX_BLOCK * 4);
    inBuf.push(ib); outBuf.push(ob);
    rb.memWritePtr(inPtrs + c * 4, ib);
    rb.memWritePtr(outPtrs + c * 4, ob);
  }

  const out0 = [];
  let pos = 0;
  const frames = input.length;
  const scratch = new Float32Array(MAX_BLOCK);

  const drain = () => {
    let avail;
    while ((avail = rb.rubberband_available(state)) > 0) {
      const n = Math.min(avail, MAX_BLOCK);
      rb.rubberband_retrieve(state, outPtrs, n);
      const v = rb.memReadF32(outBuf[0], n);
      for (let i = 0; i < n; i++) out0.push(v[i]);
    }
  };

  while (pos < frames) {
    let req = rb.rubberband_get_samples_required(state);
    if (req <= 0) req = 1024;
    const block = Math.min(req, MAX_BLOCK, frames - pos);
    for (let c = 0; c < CH; c++) {
      scratch.set(input.subarray(pos, pos + block));
      rb.memWrite(inBuf[c], scratch.subarray(0, block));
    }
    const final = pos + block >= frames ? 1 : 0;
    rb.rubberband_process(state, inPtrs, block, final);
    pos += block;
    drain();
  }
  drain();
  return new Float32Array(out0);
}

(async () => {
  const input = tone(440, 2);

  // 1) Pitch up one octave (pitchScale = 2) -> ~880 Hz, same length.
  const pitched = await runEngine(input, { pitchScale: 2, timeRatio: 1 });
  const fIn = dominantFreq(input);
  const fOut = dominantFreq(pitched);
  console.log(`PITCH test: in=${fIn.toFixed(1)}Hz out=${fOut.toFixed(1)}Hz (expect ~880)`);

  // 2) Half speed (timeRatio = 2) -> ~2x length, same ~440 Hz.
  const slowed = await runEngine(input, { pitchScale: 1, timeRatio: 2 });
  const ratio = slowed.length / input.length;
  const fSlow = dominantFreq(slowed);
  console.log(`SPEED test: lenRatio=${ratio.toFixed(2)} (expect ~2.0) freq=${fSlow.toFixed(1)}Hz (expect ~440)`);

  const pitchOk = Math.abs(fOut - 880) < 25;
  const speedOk = Math.abs(ratio - 2) < 0.15 && Math.abs(fSlow - 440) < 25;
  console.log(`RESULT pitchOk=${pitchOk} speedOk=${speedOk}`);
  process.exit(pitchOk && speedOk ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
