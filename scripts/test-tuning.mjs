// Validate the tuning estimator: build a detuned major triad and check the
// estimate matches the applied offset.
import { estimateTuning } from '../src/renderer/app/tuning.js';

const SR = 44100;
const DUR = 3;

function detunedTriad(offsetCents) {
  const n = SR * DUR;
  const L = new Float32Array(n);
  const k = Math.pow(2, offsetCents / 1200);
  const notes = [440, 554.365, 659.255]; // A4, C#5, E5
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (const f of notes) {
      const ff = f * k;
      s += Math.sin((2 * Math.PI * ff * i) / SR);
      s += 0.4 * Math.sin((2 * Math.PI * 2 * ff * i) / SR); // a harmonic
    }
    L[i] = (s / notes.length) * 0.3;
  }
  return [L, L];
}

let allOk = true;
for (const off of [-20, 0, 15, -35]) {
  const ch = detunedTriad(off);
  const est = estimateTuning(ch, SR);
  const ok = Math.abs(est - off) < 6;
  allOk = allOk && ok;
  console.log(`applied=${off} estimated=${est.toFixed(1)} ok=${ok}`);
}
console.log('RESULT ok=' + allOk);
process.exit(allOk ? 0 : 1);
