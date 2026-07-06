import { RubberBandInterface, RubberBandOption } from 'rubberband-wasm';

const CHANNELS = 2;
const MAX_BLOCK = 4096;
const POS_REPORT_FRAMES = 2048;

// Real-time tempo/pitch engine. Holds one or more tracks (stems), splits them
// into TWO groups — "pitched" (default) and "no-pitch" (drums, when the user
// blocks them from transposition) — and feeds each group into its own Rubber
// Band instance. Both instances share the same time ratio (speed) so they stay
// in lockstep; only the pitched instance follows the pitch stepper. Their
// outputs are summed for the final mix.
class EngineProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions || {};
    this.sr = sampleRate; // AudioWorkletGlobalScope global

    this.rb = null;
    this.subs = [null, null]; // [pitched, unpitched]
    this.ready = false;

    // Transport / params
    this.tracks = [];          // [{ data, gain, mute, solo, noPitch }]
    this.hasUnpitched = false; // any track flagged noPitch?
    this.sourceFrames = 0;     // length of loaded material
    this.sourcePos = 0;        // next input frame to feed (SHARED — both subs lock-step)
    this.playing = false;
    this.finalSent = false;
    this.timeRatio = 1;        // output/input duration (1/speed)
    this.pitchScale = 1;       // frequency multiplier (applies to pitched sub only)
    this.loop = null;          // { start, end } in frames
    this.posAcc = 0;

    // Scratch used to mix a group's tracks before feeding a sub.
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
    this.subs[0] = this._makeSub(opts);
    this.subs[1] = this._makeSub(opts);
    this.ready = true;
    this.port.postMessage({ type: 'ready' });
  }

  // Allocate WASM state + IO buffers + channel-pointer arrays (float**) for one
  // Rubber Band instance. Called twice at init; second one stays idle unless a
  // track is marked `noPitch`.
  _makeSub(opts) {
    const state = this.rb.rubberband_new(this.sr, CHANNELS, opts, this.timeRatio, this.pitchScale);
    this.rb.rubberband_set_max_process_size(state, MAX_BLOCK);
    const inPtrs = this.rb.malloc(CHANNELS * 4);
    const outPtrs = this.rb.malloc(CHANNELS * 4);
    const inBuf = [];
    const outBuf = [];
    for (let c = 0; c < CHANNELS; c++) {
      const ib = this.rb.malloc(MAX_BLOCK * 4);
      const ob = this.rb.malloc(MAX_BLOCK * 4);
      inBuf.push(ib);
      outBuf.push(ob);
      this.rb.memWritePtr(inPtrs + c * 4, ib);
      this.rb.memWritePtr(outPtrs + c * 4, ob);
    }
    return { state, inPtrs, outPtrs, inBuf, outBuf };
  }

  _resetBoth() {
    if (!this.ready) return;
    this.rb.rubberband_reset(this.subs[0].state);
    this.rb.rubberband_reset(this.subs[1].state);
  }

  _onMessage(msg) {
    switch (msg.type) {
      case 'load':
        this.tracks = msg.tracks.map((t) => ({
          data: t.channels,
          gain: t.gain ?? 1,
          mute: !!t.mute,
          solo: !!t.solo,
          noPitch: !!t.noPitch
        }));
        this.hasUnpitched = this.tracks.some((t) => t.noPitch);
        this.sourceFrames = msg.frames;
        this.sourcePos = 0;
        this.finalSent = false;
        this.playing = false;
        this._resetBoth();
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
        if (this.ready) {
          this.rb.rubberband_set_time_ratio(this.subs[0].state, this.timeRatio);
          this.rb.rubberband_set_time_ratio(this.subs[1].state, this.timeRatio);
        }
        break;
      case 'pitch': {
        const totalCents = msg.semitones * 100 + (msg.cents || 0);
        this.pitchScale = Math.pow(2, totalCents / 1200);
        if (this.ready) {
          // Only the pitched sub follows the stepper. The no-pitch sub stays at 1
          // so drums (or whatever the user locked) keep their original tuning.
          this.rb.rubberband_set_pitch_scale(this.subs[0].state, this.pitchScale);
        }
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
      case 'pitchLock': {
        // Update the noPitch flag per track (mask is a bool array). Keeps the
        // playback position; only resets rubber band internal buffers so the
        // next block reflects the new routing without stale samples.
        const mask = msg.mask || [];
        const wasUnpitched = this.hasUnpitched;
        for (let i = 0; i < this.tracks.length; i++) {
          this.tracks[i].noPitch = !!mask[i];
        }
        this.hasUnpitched = this.tracks.some((t) => t.noPitch);
        if (wasUnpitched !== this.hasUnpitched) this._resetBoth();
        break;
      }
    }
  }

  _seek(frame) {
    this.sourcePos = Math.max(0, Math.min(frame | 0, this.sourceFrames));
    this.finalSent = false;
    this._resetBoth();
    this.port.postMessage({ type: 'pos', frame: this.sourcePos });
  }

  _audibleTracks() {
    const anySolo = this.tracks.some((t) => t.solo);
    return this.tracks.filter((t) => (anySolo ? t.solo : !t.mute));
  }

  // Mix the audible tracks belonging to `group` (0 = pitched, 1 = no-pitch)
  // into the input buffers of the corresponding sub-engine.
  _feedGroup(group, start, n) {
    const audible = this._audibleTracks();
    const targetNoPitch = (group === 1);
    const sub = this.subs[group];
    for (let c = 0; c < CHANNELS; c++) {
      const dst = this.mixScratch[c];
      dst.fill(0, 0, n);
      for (const t of audible) {
        if ((!!t.noPitch) !== targetNoPitch) continue;
        const src = t.data[c] || t.data[0];
        const g = t.gain;
        for (let i = 0; i < n; i++) dst[i] += src[start + i] * g;
      }
      this.rb.memWrite(sub.inBuf[c], dst.subarray(0, n));
    }
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const need = out[0].length;

    if (!this.ready || !this.playing || this.sourceFrames === 0) {
      for (let c = 0; c < out.length; c++) out[c].fill(0);
      return true;
    }

    // Zero the output; both sub-engines accumulate their contribution.
    for (let c = 0; c < out.length; c++) out[c].fill(0);

    const s0 = this.subs[0];
    const s1 = this.subs[1];

    let produced = 0;
    let guard = 0;
    while (produced < need && guard++ < 64) {
      // Retrieve as many samples as BOTH subs can currently supply (locked step
      // so their outputs line up sample-by-sample).
      const avail0 = this.rb.rubberband_available(s0.state);
      const avail1 = this.hasUnpitched ? this.rb.rubberband_available(s1.state) : Infinity;
      const canProduce = Math.min(avail0, avail1, need - produced);
      if (canProduce > 0) {
        this.rb.rubberband_retrieve(s0.state, s0.outPtrs, canProduce);
        for (let c = 0; c < CHANNELS; c++) {
          const v = this.rb.memReadF32(s0.outBuf[c], canProduce);
          if (out[c]) {
            const dst = out[c];
            for (let i = 0; i < canProduce; i++) dst[produced + i] += v[i];
          }
        }
        if (this.hasUnpitched) {
          this.rb.rubberband_retrieve(s1.state, s1.outPtrs, canProduce);
          for (let c = 0; c < CHANNELS; c++) {
            const v = this.rb.memReadF32(s1.outBuf[c], canProduce);
            if (out[c]) {
              const dst = out[c];
              for (let i = 0; i < canProduce; i++) dst[produced + i] += v[i];
            }
          }
        }
        produced += canProduce;
        continue;
      }

      // At least one sub needs more input. Feed both with the SAME source range
      // so they process identical audio (only pitch differs).
      const loopEnd = this.loop ? this.loop.end : this.sourceFrames;
      if (this.sourcePos >= loopEnd) {
        if (this.loop) {
          this.sourcePos = this.loop.start;
          this._resetBoth();
          continue;
        }
        if (!this.finalSent) {
          this.rb.rubberband_process(s0.state, s0.inPtrs, 0, 1);
          if (this.hasUnpitched) this.rb.rubberband_process(s1.state, s1.inPtrs, 0, 1);
          this.finalSent = true;
          continue;
        }
        break; // drained
      }

      // Block size: honour whichever sub wants the most, capped by MAX_BLOCK
      // and the source remaining. Rubber Band accepts any input length ≤ max.
      let req = this.rb.rubberband_get_samples_required(s0.state);
      if (this.hasUnpitched) {
        const req1 = this.rb.rubberband_get_samples_required(s1.state);
        if (req1 > req) req = req1;
      }
      if (req <= 0) req = 1024;
      const block = Math.min(req, MAX_BLOCK, loopEnd - this.sourcePos);

      this._feedGroup(0, this.sourcePos, block);
      if (this.hasUnpitched) this._feedGroup(1, this.sourcePos, block);

      const isFinal = !this.loop && this.sourcePos + block >= this.sourceFrames ? 1 : 0;
      this.rb.rubberband_process(s0.state, s0.inPtrs, block, isFinal);
      if (this.hasUnpitched) this.rb.rubberband_process(s1.state, s1.inPtrs, block, isFinal);
      if (isFinal) this.finalSent = true;
      this.sourcePos += block;
    }

    // Pad any shortfall with silence (already zeroed above).

    // End-of-track detection: both subs drained and no loop.
    const drained0 = this.finalSent && this.rb.rubberband_available(s0.state) <= 0 &&
                     this.sourcePos >= this.sourceFrames;
    const drained1 = !this.hasUnpitched || this.rb.rubberband_available(s1.state) <= 0;
    if (drained0 && drained1 && !this.loop) {
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
