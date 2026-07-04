// Standalone test for the stem separation service (no Electron).
// Usage:
//   node scripts/test-separate.cjs download
//   node scripts/test-separate.cjs run <audiofile>
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sep = require('../src/main/services/separate');

const MODEL_DIR = process.env.PP_MODEL_DIR || path.resolve('data/models');
const FFMPEG = path.resolve('bin/ffmpeg.exe');

function decode(file) {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-i', file,
    '-ac', '2', '-ar', '44100', '-f', 'f32le', 'pipe:1'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('ffmpeg failed: ' + r.stderr);
  const buf = r.stdout;
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const inter = new Float32Array(ab);
  const total = Math.floor(inter.length / 2);
  const L = new Float32Array(total), R = new Float32Array(total);
  for (let i = 0, k = 0; k < total; k++) { L[k] = inter[i++]; R[k] = inter[i++]; }
  return { channels: [L, R], total };
}

function rms(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / a.length); }

(async () => {
  const mode = process.argv[2];
  if (mode === 'download') {
    let last = '';
    await sep.ensureModels(MODEL_DIR, (p) => {
      const msg = `${p.stem} ${(p.frac * 100).toFixed(0)}%`;
      if (msg !== last) { process.stdout.write('\r' + msg.padEnd(30)); last = msg; }
    });
    console.log('\nMODEL READY in ' + MODEL_DIR);
    const f = path.join(MODEL_DIR, 'htdemucs_6s_fp16weights.onnx');
    console.log(`  htdemucs_6s: ${(fs.statSync(f).size / 1e6).toFixed(1)} MB`);
    console.log('  sources: ' + sep.SOURCES.join(', '));
    return;
  }
  if (mode === 'run') {
    const file = process.argv[3];
    const { channels, total } = decode(file);
    console.log(`decoded ${total} frames (${(total / 44100).toFixed(1)}s)`);
    const t0 = Date.now();
    const stems = await sep.separateChannels(channels, total, MODEL_DIR, (p) => {
      if (p.phase === 'separate' && p.index === 0)
        process.stdout.write(`\rchunk ${p.chunk + 1}/${p.nChunks}`.padEnd(20));
    });
    const secs = (Date.now() - t0) / 1000;
    console.log(`\nseparated in ${secs.toFixed(1)}s (RTF ${(secs / (total / 44100)).toFixed(2)})`);

    // Per-stem RMS + reconstruction error (sum of stems vs original mix).
    let anyNaN = false;
    const sumL = new Float32Array(total), sumR = new Float32Array(total);
    for (const s of sep.SOURCES) {
      const [L, R] = stems[s];
      console.log(`  ${s}: rmsL=${rms(L).toFixed(4)} rmsR=${rms(R).toFixed(4)}`);
      for (let k = 0; k < total; k++) { sumL[k] += L[k]; sumR[k] += R[k]; if (Number.isNaN(L[k])) anyNaN = true; }
    }
    const errL = new Float32Array(total);
    for (let k = 0; k < total; k++) errL[k] = sumL[k] - channels[0][k];
    const recErr = rms(errL) / (rms(channels[0]) || 1);
    console.log(`reconstruction rel.error (L) = ${recErr.toFixed(3)}  NaN=${anyNaN}`);
    console.log(`RESULT ok=${!anyNaN && recErr < 0.5}`);
    return;
  }
  console.log('usage: node scripts/test-separate.cjs download | run <file>');
})().catch((e) => { console.error(e); process.exit(1); });
