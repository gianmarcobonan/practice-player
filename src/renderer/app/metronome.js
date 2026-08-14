import { clamp } from './util.js';
import { DEFAULT_SOUND, isMetroSound, renderClick } from './metro-sounds.js';

// Web Audio metronome with look-ahead scheduling, tap tempo and count-in.
// Beats scale with playback speed (getSpeed) so clicks stay aligned with the
// music when the song is slowed down or sped up.
export class Metronome {
  constructor(ctx, getSpeed) {
    this.ctx = ctx;
    this.dest = ctx.destination;
    this.getSpeed = getSpeed || (() => 1);
    this.bpm = 120;
    this.beatsPerBar = 4;
    this.on = false;
    this.volume = 0.5;   // with the preset trims this matches the old fixed level
    this.sound = DEFAULT_SOUND;
    this._next = 0;
    this._beat = 0;
    this._timer = null;
    this._taps = [];
    // Sync mode: follow the song's detected beat grid.
    this.syncMode = false;
    this.grid = null;            // { firstBeat, period } in seconds
    this.getSongTime = null;     // () => seconds
    this.isPlaying = null;       // () => bool
    this._lastBeat = null;
    this._syncLastSong = null;
  }

  setBpm(b) { this.bpm = clamp(Math.round(b), 30, 300); return this.bpm; }

  // Click timbre (see metro-sounds.js); unknown ids fall back to the default.
  setSound(id) { this.sound = isMetroSound(id) ? id : DEFAULT_SOUND; return this.sound; }

  // Click level, 0..1. Independent from the song volume: the click bypasses
  // the player's gain/EQ chain and goes straight to the output.
  setVolume(v) { this.volume = clamp(v, 0, 1); return this.volume; }

  // Beats per bar = numerator of the time signature (accent on beat 1).
  setBeatsPerBar(n) { this.beatsPerBar = clamp(Math.round(n), 1, 12); this._beat = 0; return this.beatsPerBar; }

  // Set the detected beat grid (keeps bpm in sync for display/count-in).
  setBeatGrid(grid) {
    this.grid = grid ? { firstBeat: grid.firstBeat, period: grid.period } : null;
    if (this.grid) this.bpm = clamp(Math.round(60 / this.grid.period), 30, 300);
    return this.bpm;
  }

  setSync(on) { this.syncMode = on; this._lastBeat = null; this._syncLastSong = null; }

  // Halve/double the grid tempo (fix octave/level mismatches).
  scaleGrid(factor) {
    if (!this.grid) return this.setBpm(this.bpm * factor);
    this.grid.period /= factor;
    this.bpm = clamp(Math.round(60 / this.grid.period), 30, 300);
    this._lastBeat = null;
    return this.bpm;
  }

  _interval() { return (60 / this.bpm) / (this.getSpeed() || 1); }

  _click(t, accent) {
    renderClick(this.ctx, this.sound, t, accent, this.volume, this.dest);
    if (this.onClick) this.onClick(t, accent);
  }

  start() {
    if (this.on) return;
    this.on = true;
    this._next = this.ctx.currentTime + 0.06;
    this._beat = 0;
    this._lastBeat = null;
    this._syncLastSong = null;
    this._schedule();
  }

  stop() {
    this.on = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  toggle() { this.on ? this.stop() : this.start(); return this.on; }

  _schedule() {
    if (!this.on) return;
    if (this.syncMode && this.grid && this.getSongTime) {
      this._scheduleSync();
    } else {
      const ahead = 0.12;
      while (this._next < this.ctx.currentTime + ahead) {
        this._click(this._next, this._beat % this.beatsPerBar === 0);
        this._next += this._interval();
        this._beat++;
      }
    }
    this._timer = setTimeout(() => this._schedule(), 25);
  }

  // Position-driven scheduling: clicks land on the song's beats and follow
  // seeks, loops and speed changes. Only clicks while the song is playing.
  _scheduleSync() {
    const playing = this.isPlaying ? this.isPlaying() : true;
    if (!playing) { this._lastBeat = null; this._syncLastSong = null; return; }
    const speed = this.getSpeed() || 1;
    const song = this.getSongTime();
    const { firstBeat, period } = this.grid;

    // Reset beat counter on backward jumps (seek/loop).
    if (this._syncLastSong != null && song < this._syncLastSong - 0.05) this._lastBeat = null;
    this._syncLastSong = song;

    let k = Math.max(0, Math.ceil((song - firstBeat) / period - 1e-6));
    if (this._lastBeat == null) this._lastBeat = k - 1;

    const songAhead = song + 0.15 * speed;
    for (; ; k++) {
      const tb = firstBeat + k * period;
      if (tb > songAhead) break;
      if (k > this._lastBeat) {
        const delay = (tb - song) / speed;
        this._click(this.ctx.currentTime + Math.max(0, delay), k % this.beatsPerBar === 0);
        this._lastBeat = k;
      }
    }
  }

  // Play `beats` lead-in clicks starting now; returns the lead-in duration (s).
  countIn(beats) {
    let t = this.ctx.currentTime + 0.06;
    const dur = this._interval();
    for (let i = 0; i < beats; i++) {
      this._click(t, i % this.beatsPerBar === 0);
      t += dur;
    }
    return beats * dur;
  }

  // Tap tempo: call on each tap; returns the current estimated BPM.
  tap(now) {
    const t = now != null ? now : this.ctx.currentTime;
    this._taps.push(t);
    if (this._taps.length > 5) this._taps.shift();
    // Reset if the gap is too long.
    if (this._taps.length >= 2 && t - this._taps[this._taps.length - 2] > 2) {
      this._taps = [t];
      return this.bpm;
    }
    if (this._taps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < this._taps.length; i++) intervals.push(this._taps[i] - this._taps[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avg > 0) this.setBpm(60 / avg);
    }
    return this.bpm;
  }
}
