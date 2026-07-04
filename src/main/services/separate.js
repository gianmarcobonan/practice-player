'use strict';

// HT-Demucs 6-stem separation via onnxruntime-node.
// Uses StemSplitio/htdemucs-6s-onnx: a SINGLE model that outputs all 6 sources
// (drums, bass, other, vocals, guitar, piano) in one pass — faster than the old
// 4-specialist bag and adds a dedicated guitar (and piano) stem. Chunked
// overlap-add with a fade window. The model is lazily downloaded (fp16 weights,
// ~136MB) and stems are cached to disk.

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const ort = require('onnxruntime-node');

// Leave a couple of CPU cores free so playback/UI stay smooth while separating
// (otherwise inference pegs every core and audio can stutter even off-thread).
const INFER_THREADS = Math.max(1, (os.cpus()?.length || 4) - 2);

const SR = 44100;
const CH = 2;
const N = 343980;            // 7.8s segment
const OVERLAP = (N / 4) | 0; // 85995
const STRIDE = N - OVERLAP;  // 257985
// Output source order of htdemucs_6s (fixed by the model).
const SOURCES = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'];
const BASE = 'https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/main/';
const MODEL_FILE = 'htdemucs_6s_fp16weights.onnx';

function makeWindow() {
  const w = new Float32Array(N).fill(1);
  for (let i = 0; i < OVERLAP; i++) {
    const f = i / (OVERLAP - 1);
    w[i] = f;
    w[N - 1 - i] = f;
  }
  return w;
}

function download(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'PracticePlayer' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return download(res.headers.location, dest, onProgress).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} su ${url}`));
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let done = 0;
      const tmp = dest + '.part';
      const file = fs.createWriteStream(tmp);
      res.on('data', (c) => {
        done += c.length;
        if (onProgress && total) onProgress(done / total);
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => {
        // Integrity guard: a truncated download must NOT be promoted to the final
        // path, otherwise existsSync() would later skip re-downloading a corrupt model.
        if (total && done !== total) {
          try { fs.unlinkSync(tmp); } catch {}
          return reject(new Error(`Download incompleto (${done}/${total} byte) per ${path.basename(dest)}`));
        }
        fs.renameSync(tmp, dest);
        resolve();
      }));
      file.on('error', (e) => { try { fs.unlinkSync(tmp); } catch {} reject(e); });
    });
    req.on('error', reject);
  });
}

async function ensureModels(modelDir, onProgress) {
  fs.mkdirSync(modelDir, { recursive: true });
  const dest = path.join(modelDir, MODEL_FILE);
  // Keep a previously downloaded model; only re-fetch if it's missing or
  // implausibly small (the fp16 weights are >>1MB — a tiny file means a
  // corrupt/partial leftover from an interrupted run).
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) return;
  await download(BASE + MODEL_FILE, dest, (frac) => {
    if (onProgress) onProgress({ phase: 'download', stem: '6 stem', index: 0, frac });
  });
}

let session = null;
let sessionDir = null;
async function loadSession(modelDir) {
  if (session && sessionDir === modelDir) return session;
  session = await ort.InferenceSession.create(
    path.join(modelDir, MODEL_FILE),
    {
      executionProviders: ['cpu'],
      graphOptimizationLevel: 'all',
      intraOpNumThreads: INFER_THREADS,
      interOpNumThreads: 1
    }
  );
  sessionDir = modelDir;
  return session;
}

// channels: [Float32Array L, Float32Array R], total = sample count.
// Returns { drums:[L,R], bass:[L,R], other:[L,R], vocals:[L,R], guitar:[L,R], piano:[L,R] }.
async function separateChannels(channels, total, modelDir, onProgress) {
  const sess = await loadSession(modelDir);
  const window = makeWindow();

  const out = {};
  for (const stem of SOURCES) out[stem] = [new Float32Array(total), new Float32Array(total)];
  const weight = new Float32Array(total);

  const nChunks = Math.max(1, Math.ceil(total / STRIDE));
  const input = new Float32Array(CH * N); // [ch0 N | ch1 N]

  for (let i = 0; i < nChunks; i++) {
    const start = i * STRIDE;
    const end = Math.min(start + N, total);
    const len = end - start;

    input.fill(0);
    input.set(channels[0].subarray(start, end), 0);
    input.set(channels[1].subarray(start, end), N);
    const tensor = new ort.Tensor('float32', input, [1, CH, N]);

    // Single model run -> all 6 sources. Output 'stems' is [1, 6, 2, N].
    const res = await sess.run({ mix: tensor });
    const data = res.stems.data; // Float32Array (6*2*N)
    for (let si = 0; si < SOURCES.length; si++) {
      const stem = SOURCES[si];
      const base = (si * CH) * N; // source si, channel 0 offset (batch dim = 1)
      const o0 = out[stem][0], o1 = out[stem][1];
      for (let k = 0; k < len; k++) {
        const w = window[k];
        o0[start + k] += data[base + k] * w;
        o1[start + k] += data[base + N + k] * w;
      }
      if (onProgress) onProgress({ phase: 'separate', chunk: i, nChunks, stem, index: si });
    }
    for (let k = 0; k < len; k++) weight[start + k] += window[k];
  }

  for (let k = 0; k < total; k++) {
    const wv = weight[k] > 1e-8 ? weight[k] : 1e-8;
    for (const stem of SOURCES) {
      out[stem][0][k] /= wv;
      out[stem][1][k] /= wv;
    }
  }
  return out;
}

// --- disk cache (raw interleaved f32 per stem) ---
function writeCache(cacheDir, stems, total) {
  fs.mkdirSync(cacheDir, { recursive: true });
  for (const stem of SOURCES) {
    const inter = new Float32Array(total * 2);
    const [L, R] = stems[stem];
    for (let i = 0, k = 0; k < total; k++) { inter[i++] = L[k]; inter[i++] = R[k]; }
    fs.writeFileSync(path.join(cacheDir, `${stem}.f32`), Buffer.from(inter.buffer));
  }
  fs.writeFileSync(path.join(cacheDir, 'meta.json'), JSON.stringify({ total, sr: SR }));
}

function readCache(cacheDir) {
  const metaPath = path.join(cacheDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const stems = {};
  for (const stem of SOURCES) {
    const p = path.join(cacheDir, `${stem}.f32`);
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    stems[stem] = new Float32Array(ab); // interleaved
  }
  return { stems, total: meta.total };
}

module.exports = { SOURCES, SR, ensureModels, separateChannels, writeCache, readCache, makeWindow, N, STRIDE };
