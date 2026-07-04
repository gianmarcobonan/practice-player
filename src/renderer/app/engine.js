import { deinterleave } from './util.js';

// Real-time player backed by the Rubber Band AudioWorklet.
// Same surface as the Phase 3 player (load/play/pause/seek/currentTime/…) so the
// UI code is unchanged.
export class Player {
  constructor() {
    this.ctx = new AudioContext({ sampleRate: 44100, latencyHint: 'playback' });
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);

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

    this.onended = null;
    this.onready = null;
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
        processorOptions: { wasmModule: module }
      });
      this.node.connect(this.gain);
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

    this.node.port.postMessage({
      type: 'load',
      tracks: [{ channels: ch, gain: 1 }],
      frames
    });
    // Re-apply current params after (re)load.
    this._postSpeed();
    this._postPitch();
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

    const tracks = payload.sources.map((name) => {
      const inter = payload.stems[name];
      const L = new Float32Array(total), R = new Float32Array(total);
      for (let i = 0, k = 0; k < total; k++) { L[k] = inter[i++]; R[k] = inter[i++]; }
      return { channels: [L, R], gain: 1 };
    });
    this.stemNames = payload.sources;

    this.node.port.postMessage({ type: 'load', tracks, frames: total });
    this._postSpeed();
    this._postPitch();
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

  setLoop(loop) {
    if (!this.node) return;
    const f = loop ? { start: Math.round(loop.start * this._sr), end: Math.round(loop.end * this._sr) } : null;
    this.node.port.postMessage({ type: 'loop', loop: f });
  }

  setStemGains(gains) {
    if (this.node) this.node.port.postMessage({ type: 'stemGains', gains });
  }

  _postSpeed() { if (this.node) this.node.port.postMessage({ type: 'speed', ratio: this._speed }); }
  _postPitch() { if (this.node) this.node.port.postMessage({ type: 'pitch', semitones: this._semitones, cents: this._cents }); }
}
