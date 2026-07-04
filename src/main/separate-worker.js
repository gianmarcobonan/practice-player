'use strict';

// Runs HT-Demucs stem separation in a separate process (Electron utilityProcess)
// so the heavy ONNX inference never blocks the main process or the UI/audio.
// It receives one job message with the paths it needs (it has no electron `app`),
// streams progress back, and writes the result to the disk cache; the main process
// then reads the cache and returns it to the renderer.

const { decodeToPcm } = require('./services/decode');
const separate = require('./services/separate');

const post = (msg) => { try { process.parentPort.postMessage(msg); } catch {} };

process.parentPort.on('message', async (e) => {
  const job = e.data || {};
  const { filePath, ffmpegPath, modelDir, cacheDir } = job;
  try {
    if (!separate.readCache(cacheDir)) {
      post({ type: 'progress', payload: { phase: 'models' } });
      await separate.ensureModels(modelDir, (p) => post({ type: 'progress', payload: p }));

      const dec = await decodeToPcm(filePath, { ffmpegPath });
      const total = dec.frames;
      const L = new Float32Array(total), R = new Float32Array(total);
      for (let i = 0, k = 0; k < total; k++) { L[k] = dec.interleaved[i++]; R[k] = dec.interleaved[i++]; }

      const stems = await separate.separateChannels([L, R], total, modelDir,
        (p) => post({ type: 'progress', payload: p }));
      separate.writeCache(cacheDir, stems, total);
    }
    post({ type: 'done' });
  } catch (err) {
    post({ type: 'error', message: String((err && err.message) || err) });
  }
});
