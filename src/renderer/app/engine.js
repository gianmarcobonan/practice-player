import { deinterleave } from './util.js';

// Real-time player backed by the Rubber Band AudioWorklet.
// Same surface as the Phase 3 player (load/play/pause/seek/currentTime/…) so the
// UI code is unchanged.
export class Player {
  constructor() {
    this.ctx = new AudioContext({ sampleRate: 44100, latencyHint: 'playback' });
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);

    // 8-band parametric EQ inserted between the worklet output and the master
    // gain. Every band is a peaking filter with independently adjustable
    // frequency, gain (dB, ±12) and Q (width) — so a point can be dragged left/
    // right (freq) and up/down (gain), and the wheel changes Q.
    this.EQ_FREQS = [63, 125, 250, 500, 1000, 2000, 4000, 8000]; // default centres
    this.EQ_Q_DEFAULT = 1.4;
    this._eqGains = this.EQ_FREQS.map(() => 0);
    this.eqBands = this.EQ_FREQS.map((f) => {
      const b = this.ctx.createBiquadFilter();
      b.type = 'peaking';
      b.frequency.value = f;
      b.Q.value = this.EQ_Q_DEFAULT;
      b.gain.value = 0;
      return b;
    });
    for (let i = 0; i < this.eqBands.length - 1; i++) {
      this.eqBands[i].connect(this.eqBands[i + 1]);
    }
    const eqTail = this.eqBands[this.eqBands.length - 1];
    eqTail.connect(this.gain);
    this._eqHead = this.eqBands[0]; // worklet feeds into here (see _init)

    // Real-time spectrum analyser, tapped POST-EQ / pre-master-gain so the
    // displayed spectrum visibly reflects EQ changes (and isn't scaled by the
    // volume slider). It's a sink — not connected onward — so it doesn't
    // duplicate audio to the output.
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.8;
    this.analyser.minDecibels = -90;
    this.analyser.maxDecibels = -10;
    eqTail.connect(this.analyser);
    this._specBuf = new Uint8Array(this.analyser.frequencyBinCount);

    this.node = null;
    this._initPromise = null;

    this.channelData = null;  // Float32Array[] kept for waveform/analysis
    this.loaded = false;
    this._duration = 0;
    this._sr = 44100;

    this._playing = false;
    this._speed = 1;
    this._semitones = 0;
    this._cents = 0;

    this._posFrame = 0;
    this._posAtCtx = 0;

    // Per-stem "bypass the pitch shifter" mask. Aligned with stemNames after
    // loadStems. The renderer maintains this via setPitchLockMask(); the
    // worklet routes tracks flagged true to a second Rubber Band instance
    // whose pitch stays at 1.0 (drums stay in tune even at +/-N semitones).
    this._pitchLockMask = [];
    this.stemNames = null;

    // Engine quality ('quality' | 'performance'), chosen per-machine by the UI.
    this._quality = 'quality';

    this.onended = null;
    this.onready = null;
    // Fired when the worklet detects sustained underruns and asks to drop to the
    // lighter engine; and on every periodic audio-load stats report.
    this.onQualityAuto = null;
    this.onPerfStats = null;
  }

  async _init() {
    if (this._initPromise) return this._initPromise;
    this._initPromise = (async () => {
      const wasmBytes = await window.api.engineWasm();      // Uint8Array
      const module = await WebAssembly.compile(wasmBytes);
      await this.ctx.audioWorklet.addModule('dist/engine-processor.js');
      this.node = new AudioWorkletNode(this.ctx, 'engine-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        processorOptions: { wasmModule: module, quality: this._quality }
      });
      this.node.connect(this._eqHead);
      this.node.port.onmessage = (e) => this._onMessage(e.data);
    })();
    return this._initPromise;
  }

  _onMessage(msg) {
    switch (msg.type) {
      case 'pos':
        this._posFrame = msg.frame;
        this._posAtCtx = this.ctx.currentTime;
        break;
      case 'ended':
        this._playing = false;
        if (this.onended) this.onended();
        break;
      case 'ready':
        if (this.onready) this.onready();
        break;
      case 'underrun':
        if (this.onQualityAuto) this.onQualityAuto();
        break;
      case 'perf':
        if (this.onPerfStats) this.onPerfStats(msg);
        break;
    }
  }

  async load(decoded) {
    await this._init();
    const { interleaved, channels, frames, sampleRate, duration } = decoded;
    this._sr = sampleRate;
    this._duration = duration;
    this.channelData = deinterleave(interleaved, channels, frames);

    // Stereo-normalize: duplicate mono to 2 channels for the engine.
    const ch = this.channelData.length >= 2
      ? [this.channelData[0], this.channelData[1]]
      : [this.channelData[0], this.channelData[0]];

    this.stemNames = null;
    this.node.port.postMessage({
      type: 'load',
      tracks: [{ channels: ch, gain: 1 }],
      frames
    });
    // Re-apply current params after (re)load.
    this._postSpeed();
    this._postPitch();
    this._postQuality();
    this._playing = false;
    this._posFrame = 0;
    this._posAtCtx = this.ctx.currentTime;
    this.loaded = true;
  }

  // Replace playback with N separated stems (keeps the original waveform/peaks).
  async loadStems(payload) {
    await this._init();
    const total = payload.total;
    this._sr = payload.sampleRate;
    this._duration = total / this._sr;
    const keepPos = this._posFrame;

    const tracks = payload.sources.map((name, i) => {
      const inter = payload.stems[name];
      const L = new Float32Array(total), R = new Float32Array(total);
      for (let i2 = 0, k = 0; k < total; k++) { L[k] = inter[i2++]; R[k] = inter[i2++]; }
      return {
        channels: [L, R],
        gain: 1,
        // Route to the no-pitch sub-engine when the renderer has flagged this
        // stem in the pitch-lock mask (per-stem toggle in the mixer).
        noPitch: !!this._pitchLockMask[i]
      };
    });
    this.stemNames = payload.sources;

    this.node.port.postMessage({ type: 'load', tracks, frames: total });
    this._postSpeed();
    this._postPitch();
    this._postQuality();
    this._playing = false;
    this._posAtCtx = this.ctx.currentTime;
    this.loaded = true;
    this.seek(keepPos / this._sr); // preserve position
  }

  get duration() { return this._duration; }
  get isPlaying() { return this._playing; }

  get currentTime() {
    let t = this._posFrame / this._sr;
    if (this._playing) t += (this.ctx.currentTime - this._posAtCtx) * this._speed;
    return Math.max(0, Math.min(t, this._duration));
  }

  async play() {
    if (!this.loaded || this._playing) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this._playing = true;
    this._posAtCtx = this.ctx.currentTime;
    this.node.port.postMessage({ type: 'play' });
  }

  pause() {
    if (!this._playing) return;
    // Freeze interpolated position before stopping.
    this._posFrame = Math.round(this.currentTime * this._sr);
    this._playing = false;
    this.node.port.postMessage({ type: 'pause' });
  }

  async toggle() { return this._playing ? this.pause() : this.play(); }

  seek(seconds) {
    const t = Math.max(0, Math.min(seconds, this._duration));
    this._posFrame = Math.round(t * this._sr);
    this._posAtCtx = this.ctx.currentTime;
    if (this.node) this.node.port.postMessage({ type: 'seek', frame: this._posFrame });
  }

  stop() {
    this._playing = false;
    this.seek(0);
    if (this.node) this.node.port.postMessage({ type: 'pause' });
  }

  setSpeed(ratio) { this._speed = ratio; this._postSpeed(); }
  setPitch(semitones, cents = 0) { this._semitones = semitones; this._cents = cents; this._postPitch(); }
  setVolume(v) { this.gain.gain.value = v; }

  // --- 8-band parametric EQ (live monitoring only; does not affect export) ---
  get eqDefaultFreqs() { return this.EQ_FREQS.slice(); }
  get eqBandCount() { return this.eqBands.length; }
  // Current per-band state, e.g. for persistence.
  get eqBandState() {
    return this.eqBands.map((b) => ({ f: b.frequency.value, g: b.gain.value, q: b.Q.value }));
  }

  // Real-time spectrum: fills and returns a shared Uint8Array (0..255 per bin).
  getSpectrum() { this.analyser.getByteFrequencyData(this._specBuf); return this._specBuf; }
  get analyserSampleRate() { return this.ctx.sampleRate; }
  get fftSize() { return this.analyser.fftSize; }

  setEqGain(index, db) {
    if (index < 0 || index >= this.eqBands.length) return;
    const v = Math.max(-12, Math.min(12, Number(db) || 0));
    this._eqGains[index] = v;
    // Ramp slightly to avoid zipper noise while dragging.
    this.eqBands[index].gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }

  setEqFreq(index, hz) {
    if (index < 0 || index >= this.eqBands.length) return;
    const v = Math.max(20, Math.min(20000, Number(hz) || 1000));
    this.eqBands[index].frequency.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }

  setEqQ(index, q) {
    if (index < 0 || index >= this.eqBands.length) return;
    const v = Math.max(0.3, Math.min(10, Number(q) || this.EQ_Q_DEFAULT));
    this.eqBands[index].Q.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  }

  // Apply a full band from a {f, g, q} descriptor.
  setEqBand(index, band) {
    if (!band) return;
    if (band.f != null) this.setEqFreq(index, band.f);
    if (band.g != null) this.setEqGain(index, band.g);
    if (band.q != null) this.setEqQ(index, band.q);
  }

  setEqBands(bands) { (bands || []).forEach((b, i) => this.setEqBand(i, b)); }

  resetEq() {
    this.eqBands.forEach((b, i) => {
      this.setEqBand(i, { f: this.EQ_FREQS[i], g: 0, q: this.EQ_Q_DEFAULT });
    });
  }

  // True combined magnitude response of the whole EQ chain, in dB, sampled at
  // the given frequencies (Float32Array). Drives the on-screen curve so it shows
  // the ACTUAL filter shape (bandwidth included), not an approximation.
  getEqResponseDb(freqHz) {
    const n = freqHz.length;
    const total = new Float32Array(n).fill(1);
    const mag = new Float32Array(n), phase = new Float32Array(n);
    for (const b of this.eqBands) {
      b.getFrequencyResponse(freqHz, mag, phase);
      for (let i = 0; i < n; i++) total[i] *= mag[i];
    }
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = 20 * Math.log10(total[i] > 1e-6 ? total[i] : 1e-6);
    return out;
  }

  // Switch the time/pitch engine: 'quality' (R3, best) or 'performance' (R2,
  // lighter — for weak machines). No-op on the node until it exists; the mode is
  // still carried into processorOptions at init, and re-posted on every (re)load.
  setQuality(mode) {
    this._quality = (mode === 'performance') ? 'performance' : 'quality';
    this._postQuality();
  }

  setLoop(loop) {
    if (!this.node) return;
    const f = loop ? { start: Math.round(loop.start * this._sr), end: Math.round(loop.end * this._sr) } : null;
    this.node.port.postMessage({ type: 'loop', loop: f });
  }

  setStemGains(gains) {
    if (this.node) this.node.port.postMessage({ type: 'stemGains', gains });
  }

  // Set which stems bypass the pitch shifter. `mask` is a boolean array aligned
  // with stemNames. Applied live — no reload. Used by the mixer's per-stem lock
  // buttons and by the global "Batteria fissa" preset.
  setPitchLockMask(mask) {
    this._pitchLockMask = Array.isArray(mask) ? mask.map(Boolean) : [];
    if (!this.node) return;
    this.node.port.postMessage({ type: 'pitchLock', mask: this._pitchLockMask });
  }

  // Whether the currently loaded stem pack includes a "drums" track.
  hasDrumsStem() {
    return Array.isArray(this.stemNames) && this.stemNames.includes('drums');
  }

  _postSpeed() { if (this.node) this.node.port.postMessage({ type: 'speed', ratio: this._speed }); }
  _postPitch() { if (this.node) this.node.port.postMessage({ type: 'pitch', semitones: this._semitones, cents: this._cents }); }
  _postQuality() { if (this.node) this.node.port.postMessage({ type: 'quality', mode: this._quality }); }
}
