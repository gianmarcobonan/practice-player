'use strict';

// Encode/decode separated stems to/from Opus so they can be embedded in a .ppx
// (see services/project.js). Stems live in the cache as raw interleaved f32
// stereo at 44100 Hz; Opus shrinks them ~20x for a portable project file.
// Opus works internally at 48 kHz, so ffmpeg resamples 44100<->48000 on the way
// in/out — the caller pads/truncates the decoded result back to the exact frame
// count to keep the stems sample-aligned with the media.

const { spawn } = require('child_process');

function runCapture(bin, args, input) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    const out = [];
    const err = [];
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', reject);
    p.on('close', (code) => code === 0
      ? resolve(Buffer.concat(out))
      : reject(new Error('ffmpeg: ' + Buffer.concat(err).toString().slice(-300))));
    if (input) { p.stdin.on('error', () => {}); p.stdin.end(input); }
  });
}

// Raw interleaved f32 stereo file (44100 Hz) -> Opus/OGG buffer.
function encodeOpus(ffmpeg, f32Path, bitrate = '192k') {
  return runCapture(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'f32le', '-ar', '44100', '-ac', '2', '-i', f32Path,
    '-c:a', 'libopus', '-b:a', bitrate, '-f', 'ogg', 'pipe:1'
  ]);
}

// Opus/OGG buffer -> interleaved f32 stereo buffer (44100 Hz).
function decodeOpus(ffmpeg, opusBuf) {
  return runCapture(ffmpeg, [
    '-hide_banner', '-loglevel', 'error',
    '-f', 'ogg', '-i', 'pipe:0',
    '-f', 'f32le', '-ar', '44100', '-ac', '2', 'pipe:1'
  ], opusBuf);
}

module.exports = { encodeOpus, decodeOpus };
