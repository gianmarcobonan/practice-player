'use strict';

// HT-Demucs stem separation via onnxruntime-node, driven by a model config
// (see services/models.js). Every supported model shares the same ONNX contract
// (input "mix" [1,2,N], output "stems" [1,S,2,N]) and chunk size, so this file is
// model-agnostic: it downloads the model file(s), runs inference per chunk
// (single model, or a "bag" of specialists), and reconstructs full-length stems
// with a windowed overlap-add. Results are cached to disk.

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const ort = require('onnxruntime-node');

// Leave a couple of CPU cores free so playback/UI stay smooth while separating.
const INFER_THREADS = Math.max(1, (os.cpus()?.length || 4) - 2);

const SR = 44100;
const CH = 2;
const N = 343980;            // 7.8s segment (fixed by the models)
const OVERLAP = (N / 4) | 0; // 85995
const STRIDE = N - OVERLAP;  // 257985
const IN_NAME = 'mix';
const OUT_NAME = 'stems';

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
        // Integrity guard: never promote a truncated download to the final path.
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

// Download every file the model needs into modelDir (skipped if already present
// and plausibly sized). Reports { phase:'download', frac, fileIndex, nFiles }.
async function ensureModels(modelDir, model, onProgress) {
  fs.mkdirSync(modelDir, { recursive: true });
  const nFiles = model.files.length;
  for (let i = 0; i < nFiles; i++) {
    const f = model.files[i];
    const dest = path.join(modelDir, f.name);
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1_000_000) continue;
    await download(f.url, dest, (frac) => {
      if (onProgress) onProgress({ phase: 'download', frac, fileIndex: i, nFiles });
    });
  }
}

const sessionCache = new Map(); // key: modelDir|id -> InferenceSession[]
async function loadSessions(modelDir, model) {
  const key = modelDir + '|' + model.id;
  if (sessionCache.has(key)) return sessionCache.get(key);
  const opts = {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    intraOpNumThreads: INFER_THREADS,
    interOpNumThreads: 1
  };
  const sessions = [];
  for (const f of model.files) {
    sessions.push(await ort.InferenceSession.create(path.join(modelDir, f.name), opts));
  }
  sessionCache.set(key, sessions);
  return sessions;
}

// Run one chunk through the model and return the S sources as a single
// Float32Array laid out [src0 ch0 N | src0 ch1 N | src1 ch0 N | ...].
async function runChunkStems(sessions, model, input) {
  const tensor = new ort.Tensor('float32', input, [1, CH, N]);
  if (model.type === 'single') {
    const res = await sessions[0].run({ [IN_NAME]: tensor });
    return res[OUT_NAME].data; // already [1, S, 2, N] flattened = S*CH*N
  }
  if (model.type === 'vocals-split') {
    // 2 sources: vocals (the specialist's `pick` row) and instrumental (mix - vocals).
    const res = await sessions[0].run({ [IN_NAME]: tensor });
    const d = res[OUT_NAME].data;
    const vOff = model.files[0].pick * CH * N;
    const out = new Float32Array(2 * CH * N);
    out.set(d.subarray(vOff, vOff + CH * N), 0);           // slot 0: vocals
    for (let c = 0; c < CH * N; c++) out[CH * N + c] = input[c] - d[vOff + c]; // slot 1: instrumental
    return out;
  }
  // bag: each specialist outputs [1, 4, 2, N]; take its `pick` row.
  const S = model.sources.length;
  const out = new Float32Array(S * CH * N);
  for (let i = 0; i < sessions.length; i++) {
    const res = await sessions[i].run({ [IN_NAME]: tensor });
    const d = res[OUT_NAME].data;
    const srcOff = model.files[i].pick * CH * N;
    out.set(d.subarray(srcOff, srcOff + CH * N), i * CH * N);
  }
  return out;
}

// channels: [Float32Array L, Float32Array R], total = sample count.
// Returns { <source>: [L, R] } for every source in model.sources.
async function separateChannels(channels, total, modelDir, model, onProgress) {
  const sessions = await loadSessions(modelDir, model);
  const sources = model.sources;
  const window = makeWindow();

  const out = {};
  for (const stem of sources) out[stem] = [new Float32Array(total), new Float32Array(total)];
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

    const data = await runChunkStems(sessions, model, input); // Float32Array (S*CH*N)
    for (let si = 0; si < sources.length; si++) {
      const stem = sources[si];
      const base = (si * CH) * N; // source si, channel 0 offset
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
    for (const stem of sources) {
      out[stem][0][k] /= wv;
      out[stem][1][k] /= wv;
    }
  }
  return out;
}

// --- disk cache (raw interleaved f32 per stem + meta with the source list) ---
function writeCache(cacheDir, stems, total, sr, sources) {
  fs.mkdirSync(cacheDir, { recursive: true });
  for (const stem of sources) {
    const inter = new Float32Array(total * 2);
    const [L, R] = stems[stem];
    for (let i = 0, k = 0; k < total; k++) { inter[i++] = L[k]; inter[i++] = R[k]; }
    fs.writeFileSync(path.join(cacheDir, `${stem}.f32`), Buffer.from(inter.buffer));
  }
  fs.writeFileSync(path.join(cacheDir, 'meta.json'), JSON.stringify({ total, sr: sr || SR, sources }));
}

function readCache(cacheDir) {
  const metaPath = path.join(cacheDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const sources = meta.sources || ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'];
  const stems = {};
  for (const stem of sources) {
    const p = path.join(cacheDir, `${stem}.f32`);
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    stems[stem] = new Float32Array(ab); // interleaved
  }
  return { stems, total: meta.total, sources, sr: meta.sr || SR };
}

module.exports = { SR, ensureModels, separateChannels, writeCache, readCache, makeWindow, N, STRIDE };
