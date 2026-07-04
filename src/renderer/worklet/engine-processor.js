import { RubberBandInterface, RubberBandOption } from 'rubberband-wasm';

const CHANNELS = 2;
const MAX_BLOCK = 4096;
const POS_REPORT_FRAMES = 2048;

// Real-time tempo/pitch engine. Holds one or more tracks (stems), mixes the
// audible ones, and runs the mix through Rubber Band with live time/pitch ratios.
class EngineProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.sr = sampleRate; // AudioWorkletGlobalScope global

    this.rb = null;
    this.state = null;
    this.ready = false;

    // Transport / params
    this.tracks = [];          // [{ data: Float32Array[CHANNELS], gain, mute, solo }]
    this.sourceFrames = 0;     // length of loaded material
    this.sourcePos = 0;        // next input frame to feed
    this.playing = false;
    this.finalSent = false;
    this.timeRatio = 1;        // output/input duration (1/speed)
    this.pitchScale = 1;       // frequency multiplier
    this.loop = null;          // { start, end } in frames
    this.posAcc = 0;

    // Scratch
    this.mixScratch = [new Float32Array(MAX_BLOCK), new Float32Array(MAX_BLOCK)];

    this.port.onmessage = (e) => this._onMessage(e.data);

    this._init(o.wasmModule);
  }

  async _init(wasmModule) {
    this.rb = await RubberBandInterface.initialize(wasmModule);
    // Quality settings for music practice (slow-down + transpose must sound clean):
    //  - EngineFiner (R3): the high-quality engine; removes the "watery/metallic"
    //    smearing the Faster engine produces at low speeds.
    //  - FormantPreserved: keeps the timbre natural when the pitch is lowered
    //    (vocals/instruments don't turn dark and unnatural).
    //  - PitchHighConsistency: smooth, glitch-free live pitch-scale changes.
    const opts =
      RubberBandOption.RubberBandOptionProcessRealTime |
      RubberBandOption.RubberBandOptionEngineFiner |
      RubberBandOption.RubberBandOptionFormantPreserved |
      RubberBandOption.RubberBandOptionPitchHighConsistency;
    this.state = this.rb.rubberband_new(this.sr, CHANNELS, opts, this.timeRatio, this.pitchScale);
    this.rb.rubberband_set_max_process_size(this.state, MAX_BLOCK);

    // Allocate WASM IO buffers and the channel-pointer arrays (float**).
    this.inBuf = [];
    this.outBuf = [];
    this.inPtrs = this.rb.malloc(CHANNELS * 4);
    this.outPtrs = this.rb.malloc(CHANNELS * 4);
    for (let c = 0; c < CHANNELS; c++) {
      const ib = this.rb.malloc(MAX_BLOCK * 4);
      const ob = this.rb.malloc(MAX_BLOCK * 4);
      this.inBuf.push(ib);
      this.outBuf.push(ob);
      this.rb.memWritePtr(this.inPtrs + c * 4, ib);
      this.rb.memWritePtr(this.outPtrs + c * 4, ob);
    }

    this.ready = true;
    this.port.postMessage({ type: 'ready' });
  }

  _onMessage(msg) {
    switch (msg.type) {
      case 'load':
        this.tracks = msg.tracks.map((t) => ({
          data: t.channels, gain: t.gain ?? 1, mute: !!t.mute, solo: !!t.solo
        }));
        this.sourceFrames = msg.frames;
        this.sourcePos = 0;
        this.finalSent = false;
        this.playing = false;
        if (this.ready) this.rb.rubberband_reset(this.state);
        break;
      case 'play':
        if (this.sourcePos >= this.sourceFrames) this._seek(0);
        this.playing = true;
        break;
      case 'pause':
        this.playing = false;
        break;
      case 'seek':
        this._seek(msg.frame);
        break;
      case 'speed':
        this.timeRatio = 1 / msg.ratio;
        if (this.ready) this.rb.rubberband_set_time_ratio(this.state, this.timeRatio);
        break;
      case 'pitch': {
        const totalCents = msg.semitones * 100 + (msg.cents || 0);
        this.pitchScale = Math.pow(2, totalCents / 1200);
        if (this.ready) this.rb.rubberband_set_pitch_scale(this.state, this.pitchScale);
        break;
      }
      case 'loop':
        this.loop = msg.loop ? { start: msg.loop.start, end: msg.loop.end } : null;
        break;
      case 'stemGains':
        msg.gains.forEach((g, i) => {
          if (this.tracks[i]) {
            this.tracks[i].gain = g.gain;
            this.tracks[i].mute = !!g.mute;
            this.tracks[i].solo = !!g.solo;
          }
        });
        break;
    }
  }

  _seek(frame) {
    this.sourcePos = Math.max(0, Math.min(frame | 0, this.sourceFrames));
    this.finalSent = false;
    if (this.ready) this.rb.rubberband_reset(this.state);
    this.port.postMessage({ type: 'pos', frame: this.sourcePos });
  }

  _audibleTracks() {
    const anySolo = this.tracks.some((t) => t.solo);
    return this.tracks.filter((t) => (anySolo ? t.solo : !t.mute));
  }

  // Mix audible tracks for [start, start+n) into the WASM input buffers.
  _feedMix(start, n) {
    const audible = this._audibleTracks();
    for (let c = 0; c < CHANNELS; c++) {
      const dst = this.mixScratch[c];
      dst.fill(0, 0, n);
      for (const t of audible) {
        const src = t.data[c] || t.data[0];
        const g = t.gain;
        for (let i = 0; i < n; i++) dst[i] += src[start + i] * g;
      }
      this.rb.memWrite(this.inBuf[c], dst.subarray(0, n));
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const need = out[0].length;

    if (!this.ready || !this.playing || this.sourceFrames === 0) {
      for (let c = 0; c < out.length; c++) out[c].fill(0);
      return true;
    }

    let produced = 0;
    let guard = 0;
    while (produced < need && guard++ < 64) {
      const avail = this.rb.rubberband_available(this.state);
      if (avail > 0) {
        const n = Math.min(avail, need - produced);
        this.rb.rubberband_retrieve(this.state, this.outPtrs, n);
        for (let c = 0; c < CHANNELS; c++) {
          const v = this.rb.memReadF32(this.outBuf[c], n);
          if (out[c]) out[c].set(v.subarray(0, n), produced);
        }
        produced += n;
        continue;
      }

      // Need more input.
      const loopEnd = this.loop ? this.loop.end : this.sourceFrames;
      if (this.sourcePos >= loopEnd) {
        if (this.loop) {
          this.sourcePos = this.loop.start;
          this.rb.rubberband_reset(this.state);
          continue;
        }
        if (!this.finalSent) {
          this.rb.rubberband_process(this.state, this.inPtrs, 0, 1);
          this.finalSent = true;
          continue;
        }
        break; // drained
      }

      let req = this.rb.rubberband_get_samples_required(this.state);
      if (req <= 0) req = 1024;
      const block = Math.min(req, MAX_BLOCK, loopEnd - this.sourcePos);
      this._feedMix(this.sourcePos, block);
      const isFinal = !this.loop && this.sourcePos + block >= this.sourceFrames ? 1 : 0;
      this.rb.rubberband_process(this.state, this.inPtrs, block, isFinal);
      if (isFinal) this.finalSent = true;
      this.sourcePos += block;
    }

    // Pad any shortfall with silence.
    if (produced < need) {
      for (let c = 0; c < out.length; c++) out[c].fill(0, produced);
    }

    // Track reached the end and Rubber Band is drained.
    if (this.finalSent && this.rb.rubberband_available(this.state) <= 0 &&
        this.sourcePos >= this.sourceFrames && !this.loop) {
      this.playing = false;
      this.port.postMessage({ type: 'ended' });
      this.port.postMessage({ type: 'pos', frame: this.sourceFrames });
    }

    // Throttled position reporting (source-frame domain).
    this.posAcc += produced;
    if (this.posAcc >= POS_REPORT_FRAMES) {
      this.posAcc = 0;
      this.port.postMessage({ type: 'pos', frame: this.sourcePos });
    }

    return true;
  }
}

registerProcessor('engine-processor', EngineProcessor);
