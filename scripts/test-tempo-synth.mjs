import { detectTempo } from '../src/renderer/app/tempo.js';
const SR = 44100;
function clickTrack(bpm, secs) {
  const n = SR * secs;
  const L = new Float32Array(n);
  const period = (60 / bpm) * SR;
  for (let b = 0; ; b++) {
    const pos = Math.round(b * period);
    if (pos >= n) break;
    for (let i = 0; i < 800 && pos + i < n; i++) {
      L[pos + i] += Math.exp(-i / 200) * Math.sin((2 * Math.PI * 1500 * i) / SR) * 0.8;
    }
  }
  return [L, L];
}
for (const bpm of [100, 120, 134, 140]) {
  const t = detectTempo(clickTrack(bpm, 20), SR);
  const err = Math.abs(t.bpm - bpm);
  console.log(`true=${bpm} detected=${t.bpm.toFixed(1)} firstBeat=${t.firstBeat.toFixed(3)} ok=${err < 3}`);
}
