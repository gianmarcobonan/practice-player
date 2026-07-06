'use strict';

// Runs chord + key detection in a separate process (Electron utilityProcess)
// so the main process and the UI stay responsive during the ~5-10s analysis.
// Same shape as separate-worker.js: one job message in, progress + done/error out.

const { decodeToPcm } = require('./services/decode');
const chords = require('./services/chords');

const SR = 22050; // detection works fine at 22.05 kHz mono - halves compute vs 44.1

const post = (msg) => { try { process.parentPort.postMessage(msg); } catch {} };

process.parentPort.on('message', async (e) => {
  const job = e.data || {};
  const { filePath, ffmpegPath } = job;
  try {
    post({ type: 'progress', payload: { phase: 'decode' } });
    const dec = await decodeToPcm(filePath, { ffmpegPath, sampleRate: SR, channels: 1 });

    post({ type: 'progress', payload: { phase: 'analyze', frac: 0 } });
    const result = chords.analyze(dec.interleaved, dec.sampleRate,
      (frac) => post({ type: 'progress', payload: { phase: 'analyze', frac } }));

    post({ type: 'done', result });
  } catch (err) {
    post({ type: 'error', message: String((err && err.message) || err) });
  }
});
