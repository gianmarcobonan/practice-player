'use strict';

const { spawn } = require('child_process');

// Decode any common audio format to raw interleaved 32-bit float PCM via ffmpeg.
// Returns { sampleRate, channels, frames, interleaved: Float32Array }.
// opts.ffmpegPath lets callers (e.g. the separation worker, which has no electron
// `app`) pass the binary path explicitly; otherwise it's resolved lazily.
function decodeToPcm(filePath, opts = {}) {
  const sampleRate = opts.sampleRate || 44100;
  const channels = opts.channels || 2;
  const ffmpeg = opts.ffmpegPath || require('../paths').ffmpegPath();

  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner', '-loglevel', 'error',
      '-i', filePath,
      '-ac', String(channels),
      '-ar', String(sampleRate),
      '-f', 'f32le',
      '-acodec', 'pcm_f32le',
      'pipe:1'
    ];

    const ff = spawn(ffmpeg, args, { windowsHide: true });
    const chunks = [];
    let stderr = '';

    ff.stdout.on('data', (d) => chunks.push(d));
    ff.stderr.on('data', (d) => { stderr += d.toString(); });
    ff.on('error', (err) => reject(new Error(`Impossibile avviare ffmpeg: ${err.message}`)));
    ff.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffmpeg ha fallito (codice ${code}): ${stderr.trim()}`));
      }
      const buf = Buffer.concat(chunks);
      // Copy into a fresh, 4-byte-aligned ArrayBuffer for the Float32Array view.
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      const interleaved = new Float32Array(ab);
      const frames = Math.floor(interleaved.length / channels);
      resolve({ sampleRate, channels, frames, interleaved });
    });
  });
}

// True if the file has a REAL video stream (not just album-art / "attached pic").
// Used to decide whether to show the video panel — an audio-only YouTube download
// can be a .webm container, so extension alone is unreliable.
function hasVideoStream(filePath, opts = {}) {
  const ffmpeg = opts.ffmpegPath || require('../paths').ffmpegPath();
  return new Promise((resolve) => {
    const ff = spawn(ffmpeg, ['-hide_banner', '-i', filePath], { windowsHide: true });
    let err = '';
    ff.stderr.on('data', (d) => { err += d.toString(); });
    ff.on('error', () => resolve(false));
    ff.on('close', () => {
      const videoLines = err.split('\n').filter((l) => /Stream.*Video:/.test(l));
      resolve(videoLines.some((l) => !/attached pic/i.test(l) && /\bfps\b/.test(l)));
    });
  });
}

module.exports = { decodeToPcm, hasVideoStream };
