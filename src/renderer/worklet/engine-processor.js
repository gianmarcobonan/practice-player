import { RubberBandInterface, RubberBandOption } from 'rubberband-wasm';

const CHANNELS = 2;
const MAX_BLOCK = 4096;
const POS_REPORT_FRAMES = 2048;

// Underrun-based auto-fallback: if the pitched engine can't keep up (block left
// unfilled while there is still material to render) UR_THRESHOLD times within
// UR_WINDOW seconds, tell the renderer to drop to the lighter "performance"
// engine. WARMUP_BLOCKS suppresses the false underruns that follow any reset
// (seek, loop-wrap, engine recreate, bypass<->RB transition) while Rubber Band
// re-primes its internal buffers.
const UR_WINDOW = 2.0, UR_THRESHOLD = 3, WARMUP_BLOCKS = 8;
// How often to report the audio-load stats to the renderer (~0.5 s = 2 reports/s).
const PERF_REPORT_FRAMES = 22050;

// performance.now() is not guaranteed inside AudioWorkletGlobalScope. Feature-
// detect once: when present we measure true DSP time per block; otherwise the
// audio-load indicator falls back to the underrun count only.
const perfNow = (typeof performance !== 'undefined' && performance.now)
  ? () => performance.now()
  : null;

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

    // Engine quality: 'quality' (R3 Finer + formant, heavy) or 'performance'
    // (R2 Faster, light). Chosen by the renderer per-machine; also flipped
    // automatically by the underrun fallback below.
    this.quality = (o.quality === 'performance') ? 'performance' : 'quality';

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

    // Bypass + underrun-fallback + perf-report state.
    this._bypass = null;       // current bypass predicate (null = force a transition)
    this._warmup = 0;          // blocks in which underruns are NOT counted (post-reset priming)
    this._urCount = 0;         // underruns in the current fallback window
    this._urWindowStart = 0;   // currentTime at window start
    this._fallbackSent = false; // 'underrun' already emitted (avoid spamming)
    this._perfAcc = 0;         // frames accumulated for perf-report throttling
    this._perfUnder = 0;       // underruns since the last perf report
    this._perfLoadEma = 0;     // EMA of DSP-time / block-budget (0 if no perfNow)

    // Scratch used to mix a group's tracks before feeding a sub.
    this.mixScratch = [new Float32Array(MAX_BLOCK), new Float32Array(MAX_BLOCK)];

    this.port.onmessage = (e) => this._onMessage(e.data);

    this._init(o.wasmModule);
  }

  async _init(wasmModule) {
    this.rb = await RubberBandInterface.initialize(wasmModule);
    const opts = this._optsFor(this.quality);
    // subs[1] (no-pitch) always starts at pitch 1; subs[0] follows the stepper.
    this.subs[0] = this._makeSub(opts, this.pitchScale);
    this.subs[1] = this._makeSub(opts, 1);
    this.ready = true;
    this.port.postMessage({ type: 'ready' });
  }

  // Rubber Band option flags for a given quality mode. The ENGINE (Faster/Finer)
  // is fixed at construction, so switching modes requires recreating the subs.
  //  - quality (default): EngineFiner (R3) high-quality engine (no "watery/metallic"
  //    smearing at low speeds) + FormantPreserved (natural timbre when pitched down)
  //    + PitchHighConsistency (glitch-free live pitch changes).
  //  - performance: EngineFaster (R2), no formant preservation — much lighter on
  //    the CPU so weak machines stay glitch-free, at a small quality cost.
  _optsFor(mode) {
    const O = RubberBandOption;
    if (mode === 'performance') {
      return O.RubberBandOptionProcessRealTime |
             O.RubberBandOptionEngineFaster |
             O.RubberBandOptionPitchHighConsistency;
    }
    return O.RubberBandOptionProcessRealTime |
           O.RubberBandOptionEngineFiner |
           O.RubberBandOptionFormantPreserved |
           O.RubberBandOptionPitchHighConsistency;
  }

  // Allocate WASM state + IO buffers + channel-pointer arrays (float**) for one
  // Rubber Band instance. Called at init and on every quality switch; the
  // pitchScale is explicit because a mid-song recreate must restore the current
  // pitch on subs[0] while subs[1] (no-pitch) always stays at 1.
  _makeSub(opts, pitchScale = this.pitchScale) {
    const state = this.rb.rubberband_new(this.sr, CHANNELS, opts, this.timeRatio, pitchScale);
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

  // Free a sub's Rubber Band state and every buffer it owns (no leak on switch).
  _destroySub(sub) {
    if (!sub) return;
    this.rb.rubberband_delete(sub.state);
    this.rb.free(sub.inPtrs);
    this.rb.free(sub.outPtrs);
    for (let c = 0; c < CHANNELS; c++) { this.rb.free(sub.inBuf[c]); this.rb.free(sub.outBuf[c]); }
  }

  // Switch the time/pitch engine live (quality <-> performance). The engine flag
  // is fixed at rubberband_new, so we destroy and recreate both subs. Runs inside
  // an onmessage handler, i.e. between two process() calls, so there is no race.
  // Playback position (sourcePos) is preserved; the ~1-block gap from allocating
  // a fresh Rubber Band is absorbed by the warmup window.
  _setQuality(mode) {
    mode = (mode === 'performance') ? 'performance' : 'quality';
    if (mode === this.quality && this.ready) return;
    this.quality = mode;
    if (!this.ready) return; // _init() will use this.quality
    const savedPos = this.sourcePos;
    this._destroySub(this.subs[0]);
    this._destroySub(this.subs[1]);
    const opts = this._optsFor(mode);
    this.subs[0] = this._makeSub(opts, this.pitchScale); // restore current pitch
    this.subs[1] = this._makeSub(opts, 1);               // no-pitch stays at 1
    this.rb.rubberband_set_time_ratio(this.subs[0].state, this.timeRatio);
    this.rb.rubberband_set_time_ratio(this.subs[1].state, this.timeRatio);
    this.sourcePos = savedPos;
    this.finalSent = false;       // re-prime from savedPos
    this._bypass = null;          // force a clean bypass/RB transition next block
    this._warmup = WARMUP_BLOCKS; // suppress false underruns during re-priming
    this._fallbackSent = false;   // re-arm the detector (e.g. when back to quality)
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
        this._bypass = null;          // re-evaluate bypass on the new material
        this._warmup = WARMUP_BLOCKS; // don't count underruns while priming
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
      case 'quality':
        this._setQuality(msg.mode);
        break;
    }
  }

  _seek(frame) {
    this.sourcePos = Math.max(0, Math.min(frame | 0, this.sourceFrames));
    this.finalSent = false;
    this._warmup = WARMUP_BLOCKS; // priming after a jump — don't count as underrun
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

  // Direct passthrough used when neither time-stretch nor pitch-shift is active
  // (speed 100%, pitch 0, no per-stem pitch lock). At ratio 1 one input frame
  // equals one output frame, so we skip Rubber Band entirely and just mix the
  // audible tracks into the output. Replicates the RB path's loop/ended/pos
  // semantics exactly. `out` is already zeroed by the caller.
  _processBypass(out, need) {
    const audible = this._audibleTracks();
    let produced = 0;
    let ended = false;
    while (produced < need) {
      const loopEnd = this.loop ? this.loop.end : this.sourceFrames;
      if (this.sourcePos >= loopEnd) {
        if (this.loop) { this.sourcePos = this.loop.start; continue; }
        ended = true; break; // end of track — leave the rest as silence
      }
      const chunk = Math.min(need - produced, loopEnd - this.sourcePos);
      const base = this.sourcePos;
      for (const t of audible) {
        const g = t.gain;
        for (let c = 0; c < CHANNELS; c++) {
          const dst = out[c]; if (!dst) continue;
          const src = t.data[c] || t.data[0]; // same mono fallback as _feedGroup
          for (let i = 0; i < chunk; i++) dst[produced + i] += src[base + i] * g;
        }
      }
      produced += chunk;
      this.sourcePos += chunk;
    }
    if (ended && !this.loop) {
      this.playing = false;
      this.port.postMessage({ type: 'ended' });
      this.port.postMessage({ type: 'pos', frame: this.sourceFrames });
    }
    this.posAcc += produced;
    if (this.posAcc >= POS_REPORT_FRAMES) {
      this.posAcc = 0;
      this.port.postMessage({ type: 'pos', frame: this.sourcePos });
    }
    // Bypass never underruns (pure copy) — treat as a clean, fully-loaded block.
    this._perfReport(produced, 0);
  }

  process(_inputs, outputs) {
    const out = outputs[0];
    const need = out[0].length;

    if (!this.ready || !this.playing || this.sourceFrames === 0) {
      for (let c = 0; c < out.length; c++) out[c].fill(0);
      return true;
    }

    const t0 = perfNow ? perfNow() : 0;

    // Zero the output; both sub-engines accumulate their contribution.
    for (let c = 0; c < out.length; c++) out[c].fill(0);

    // Bypass Rubber Band entirely when there is nothing to stretch/pitch. A
    // change of predicate resets RB so re-entry starts clean (no stale buffered
    // samples) and primes without counting false underruns.
    const wantBypass = (this.timeRatio === 1 && this.pitchScale === 1 && !this.hasUnpitched);
    if (wantBypass !== this._bypass) {
      this._resetBoth();
      this.finalSent = false;
      this._warmup = WARMUP_BLOCKS;
      this._bypass = wantBypass;
    }
    if (wantBypass) { this._processBypass(out, need); return true; }

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
          this._warmup = WARMUP_BLOCKS; // priming after loop wrap — not an underrun
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

    // Underrun detection: the block was left short WHILE there was still material
    // to render (not the end-of-track drain) and we're past the post-reset warmup.
    // Genuine underruns feed both the audio-load indicator and the auto-fallback.
    const loopEndF = this.loop ? this.loop.end : this.sourceFrames;
    const moreToPlay = this.sourcePos < loopEndF ||
                       (this.finalSent && this.rb.rubberband_available(s0.state) > 0);
    let underran = 0;
    if (produced < need && moreToPlay && this._warmup <= 0) {
      underran = 1;
      if (this.quality !== 'performance') {
        if (currentTime - this._urWindowStart > UR_WINDOW) { this._urWindowStart = currentTime; this._urCount = 0; }
        if (++this._urCount >= UR_THRESHOLD && !this._fallbackSent) {
          this._fallbackSent = true;
          this.port.postMessage({ type: 'underrun' });
        }
      }
    }
    if (this._warmup > 0) this._warmup--;

    this._perfReport(produced, underran, perfNow ? perfNow() - t0 : -1);
    return true;
  }

  // Accumulate audio-load stats and post them to the renderer ~2x/second. `dtMs`
  // is the measured DSP time for this block (-1 when performance.now is absent);
  // load is that time as a fraction of the block's real-time budget.
  _perfReport(produced, underran, dtMs = 0) {
    if (underran) this._perfUnder++;
    if (dtMs >= 0) {
      const budgetMs = (produced > 0 ? produced : 128) / this.sr * 1000;
      const load = budgetMs > 0 ? dtMs / budgetMs : 0;
      this._perfLoadEma = this._perfLoadEma * 0.9 + load * 0.1;
    }
    this._perfAcc += produced;
    if (this._perfAcc >= PERF_REPORT_FRAMES) {
      this._perfAcc = 0;
      this.port.postMessage({
        type: 'perf',
        load: this._perfLoadEma,
        underruns: this._perfUnder,
        hasTiming: !!perfNow
      });
      this._perfUnder = 0;
    }
  }
}

registerProcessor('engine-processor', EngineProcessor);
