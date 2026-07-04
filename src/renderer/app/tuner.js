// Reference-tone tuner with two instruments:
//  - 'beep': a clean sustained triangle tone until you stop it.
//  - 'piano': a piano-like note that RE-STRIKES every ~1.2 s (a repeating note),
//    so you can keep tuning against a natural, decaying reference.
// Equal temperament, A4 = 440 Hz. Not a pitch detector — just reference pitches.
export class Tuner {
  constructor(ctx) {
    this.ctx = ctx;
    this.mode = 'beep';     // 'beep' | 'piano'
    this.osc = null;        // sustained beep oscillator
    this.gain = null;       // beep envelope
    this.timer = null;      // piano re-strike interval
    this.pianoGain = null;  // current piano strike output (for clean stop)
    this.pianoOscs = [];    // current piano strike partials
    this.current = null;    // e.g. "A4"
    this.curFreq = 0;
  }

  freq(name, octave) {
    const i = Tuner.NOTES.indexOf(name);
    const midi = 12 * (octave + 1) + i; // C4 -> MIDI 60
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  setMode(mode) {
    if (mode !== 'beep' && mode !== 'piano') return;
    if (mode === this.mode) return;
    this.mode = mode;
    // Restart a sounding note with the new instrument.
    if (this.current) {
      const name = this.current.replace(/\d+$/, '');
      const octave = parseInt(this.current.match(/\d+$/)[0], 10);
      this.play(name, octave);
    }
  }

  play(name, octave) {
    this.stop();
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.curFreq = this.freq(name, octave);
    this.current = name + octave;
    if (this.mode === 'piano') {
      this._strike();
      this.timer = setInterval(() => this._strike(), 1200);
    } else {
      this._beep();
    }
  }

  _beep() {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'triangle';
    o.frequency.value = this.curFreq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.02);
    o.connect(g).connect(this.ctx.destination);
    o.start();
    this.osc = o; this.gain = g;
  }

  // One piano-like note: a few partials with a percussive attack + long decay.
  _strike() {
    const t = this.ctx.currentTime;
    const g = this.ctx.createGain();
    g.connect(this.ctx.destination);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.006); // fast attack
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8); // long decay
    const partials = [[1, 1], [2, 0.45], [3, 0.22], [4, 0.12], [5, 0.06], [6, 0.03]];
    const oscs = [];
    for (const [mult, amp] of partials) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = this.curFreq * mult;
      const pg = this.ctx.createGain();
      pg.gain.value = amp;
      o.connect(pg).connect(g);
      o.start(t);
      o.stop(t + 2);
      oscs.push(o);
    }
    this.pianoGain = g;
    this.pianoOscs = oscs;
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    const t = this.ctx.currentTime;
    if (this.osc) { // beep
      try {
        this.gain.gain.cancelScheduledValues(t);
        this.gain.gain.setValueAtTime(this.gain.gain.value, t);
        this.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
        this.osc.stop(t + 0.06);
      } catch {}
      this.osc = null; this.gain = null;
    }
    if (this.pianoGain) { // fade the ringing piano note out cleanly
      try {
        this.pianoGain.gain.cancelScheduledValues(t);
        this.pianoGain.gain.setValueAtTime(this.pianoGain.gain.value, t);
        this.pianoGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
        this.pianoOscs.forEach((o) => { try { o.stop(t + 0.1); } catch {} });
      } catch {}
      this.pianoGain = null; this.pianoOscs = [];
    }
    this.current = null; this.curFreq = 0;
  }

  // Toggle a note on/off; returns true if now playing.
  toggle(name, octave) {
    if (this.current === name + octave) { this.stop(); return false; }
    this.play(name, octave);
    return true;
  }
}

Tuner.NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
