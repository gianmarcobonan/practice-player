// Validate tempo detection on real audio files (decode via ffmpeg).
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { detectTempo } from '../src/renderer/app/tempo.js';

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
  return [L, R];
}

for (const f of process.argv.slice(2)) {
  const ch = decode(f);
  const t = detectTempo(ch, 44100);
  console.log(`${path.basename(f)} -> bpm=${t.bpm.toFixed(1)} firstBeat=${t.firstBeat.toFixed(3)}s period=${t.period.toFixed(3)}s`);
}
