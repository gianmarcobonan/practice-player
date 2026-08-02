'use strict';

// Renders the processed audio (current speed + pitch + stem volumes) offline and
// encodes it to a file, in a separate process so the UI never blocks.
//   mode 'mp3'   -> audio only (libmp3lame)
//   mode 'video' -> original video retimed to the new tempo + the processed audio,
//                   muxed to mp4 (h264/aac). Pitch shift doesn't affect the picture.

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { decodeToPcm } = require('./services/decode');
const separate = require('./services/separate');
const render = require('./services/render');

const post = (msg) => { try { process.parentPort.postMessage(msg); } catch {} };
const progress = (phase, frac) => post({ type: 'progress', payload: { phase, frac } });

function ffmpegEncode(args, ffmpegPath, outDurationSec) {
  return new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    ff.stderr.on('data', (d) => {
      stderr += d.toString();
      const m = /time=(\d+):(\d+):(\d+\.\d+)/.exec(d.toString());
      if (m && outDurationSec > 0) {
        const sec = (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
        progress('encode', Math.min(1, sec / outDurationSec));
      }
    });
    ff.on('error', reject);
    ff.on('close', (code) => code === 0 ? resolve()
      : reject(new Error(`ffmpeg ha fallito (codice ${code}): ${stderr.trim().split('\n').slice(-3).join(' ')}`)));
  });
}

process.parentPort.on('message', async (e) => {
  const job = e.data || {};
  const { filePath, ffmpegPath, wasmPath, cacheDir, useStems, settings, mode, outPath, tmpDir } = job;
  try {
    // 1) Build the source mix (stems with their gains, or the original audio).
    progress('prepare', 0);
    let channels, total;
    const cache = useStems && cacheDir ? separate.readCache(cacheDir) : null;
    if (cache) {
      const mixed = render.mixStems(cache, cache.sources, settings.stemState || []);
      channels = mixed.channels; total = mixed.total;
    } else {
      const dec = await decodeToPcm(filePath, { ffmpegPath });
      total = dec.frames;
      const L = new Float32Array(total), R = new Float32Array(total);
      for (let i = 0, k = 0; k < total; k++) { L[k] = dec.interleaved[i++]; R[k] = dec.interleaved[i++]; }
      channels = [L, R];
    }

    // 2) Offline render with current speed + pitch.
    const rendered = await render.renderProcessed({
      channels, total,
      semitones: settings.semitones || 0,
      cents: settings.fineCents || 0,
      speedPct: settings.speedPct || 100,
      volume: settings.volume == null ? 1 : settings.volume,
      wasmPath,
      onProgress: (f) => progress('render', f)
    });

    // 3) Write raw interleaved f32 for ffmpeg, then encode.
    fs.mkdirSync(tmpDir, { recursive: true });
    const raw = path.join(tmpDir, 'export-audio.f32');
    fs.writeFileSync(raw, Buffer.from(rendered.interleaved.buffer, rendered.interleaved.byteOffset, rendered.interleaved.byteLength));
    const outDur = rendered.frames / rendered.sampleRate;

    // EQ: mirror the live 8-band parametric EQ with a chain of ffmpeg `equalizer`
    // peaking filters (t=q → w is the Q, g is dB), so the export sounds like
    // playback. Flat bands (g=0) are skipped. Empty chain → no -af added.
    const eqBands = Array.isArray(settings.eq) ? settings.eq : [];
    const eqChain = eqBands
      .filter((b) => b && b.g)
      .map((b) => `equalizer=f=${Math.round(b.f)}:t=q:w=${(b.q || 1.4).toFixed(2)}:g=${b.g}`)
      .join(',');
    const afArgs = eqChain ? ['-af', eqChain] : [];

    let args;
    if (mode === 'video') {
      const speed = (settings.speedPct || 100) / 100;
      const ptsFactor = (1 / speed).toFixed(6);
      // A/V sync shift: the live offset is in source-seconds and means "video
      // ahead of audio". Advancing the video = shifting its input timestamps
      // earlier, i.e. -itsoffset. Only applied when the user set a non-zero
      // offset (default 0 → no change).
      const vOff = Number(settings.videoOffset) || 0;
      const videoInput = vOff ? ['-itsoffset', (-vOff).toFixed(3), '-i', filePath] : ['-i', filePath];
      args = [
        '-y',
        ...videoInput,
        '-f', 'f32le', '-ar', '44100', '-ac', '2', '-i', raw,
        '-filter:v', `setpts=${ptsFactor}*PTS`,
        ...afArgs,
        '-map', '0:v:0', '-map', '1:a:0',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k',
        '-shortest',
        outPath
      ];
    } else {
      args = [
        '-y',
        '-f', 'f32le', '-ar', '44100', '-ac', '2', '-i', raw,
        ...afArgs,
        '-c:a', 'libmp3lame', '-q:a', '2',
        outPath
      ];
    }
    progress('encode', 0);
    await ffmpegEncode(args, ffmpegPath, outDur);

    try { fs.unlinkSync(raw); } catch {}
    post({ type: 'done', outPath });
  } catch (err) {
    post({ type: 'error', message: String((err && err.message) || err) });
  }
});
