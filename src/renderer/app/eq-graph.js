import { clamp } from './util.js';

// Parametric graphic equalizer on a canvas.
//  - Real-time filled-area spectrum behind the curve.
//  - A curve that is the TRUE combined magnitude response of the filters
//    (via responseFn), so bandwidth/Q are shown accurately.
//  - Each band is a draggable point: drag left/right = frequency, up/down =
//    gain; mouse wheel over a point = Q (width). Double-click = reset the band.
// Callbacks: onChange(index, {f,g,q}) fires live on any edit.
export class EqGraph {
  constructor(canvas, { bands, defaultFreqs, responseFn, gainRange = 12, onChange } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.responseFn = responseFn;
    this.defaultFreqs = (defaultFreqs || []).slice();
    this.onChange = onChange;
    this.gainRange = gainRange;         // ±dB the points can reach
    this.range = gainRange + 3;         // ±dB shown on the axis (headroom for peaks)
    this.fMin = 20; this.fMax = 20000;
    this.qMin = 0.3; this.qMax = 10;

    this.bands = (bands || []).map((b) => ({ f: b.f, g: b.g, q: b.q }));

    this._spec = null; this._specSr = 44100; this._specFft = 2048;
    this._drag = -1; this._hover = -1;
    this._gridF = null; this._gridX = null;  // frequency grid for the curve

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas);

    canvas.addEventListener('pointerdown', (e) => this._onDown(e));
    canvas.addEventListener('pointermove', (e) => this._onMove(e));
    canvas.addEventListener('pointerup', (e) => this._onUp(e));
    canvas.addEventListener('pointerleave', () => { this._hover = -1; if (this._drag < 0) this.draw(); });
    canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    canvas.addEventListener('dblclick', (e) => {
      const i = this._nearestPoint(this._pos(e));
      if (i >= 0) {
        this.bands[i].g = 0;
        this.bands[i].q = 1.4;
        if (this.defaultFreqs[i] != null) this.bands[i].f = this.defaultFreqs[i];
        this._emit(i); this.draw();
      }
    });

    this._resize();
  }

  setBands(bands) {
    this.bands = (bands || []).map((b) => ({
      f: clamp(b.f, this.fMin, this.fMax),
      g: clamp(b.g, -this.gainRange, this.gainRange),
      q: clamp(b.q, this.qMin, this.qMax)
    }));
    this.draw();
  }

  pushSpectrum(data, sampleRate, fftSize) {
    this._spec = data;
    if (sampleRate) this._specSr = sampleRate;
    if (fftSize) this._specFft = fftSize;
    this.draw();
  }
  clearSpectrum() { this._spec = null; this.draw(); }

  _emit(i) { this.onChange && this.onChange(i, { f: this.bands[i].f, g: this.bands[i].g, q: this.bands[i].q }); }

  // --- geometry ---
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || 600;
    const h = this.canvas.clientHeight || 220;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this._dpr = dpr; this._w = w; this._h = h;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Build the log-spaced frequency grid used to sample the response curve.
    const lo = Math.log10(this.fMin), hi = Math.log10(this.fMax);
    const n = Math.max(64, Math.floor(w / 2));
    this._gridF = new Float32Array(n);
    this._gridX = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      const x = (k / (n - 1)) * w;
      this._gridX[k] = x;
      this._gridF[k] = Math.pow(10, lo + (x / w) * (hi - lo));
    }
    this.draw();
  }

  _fx(f) {
    const lo = Math.log10(this.fMin), hi = Math.log10(this.fMax);
    return (Math.log10(clamp(f, this.fMin, this.fMax)) - lo) / (hi - lo) * this._w;
  }
  _xf(x) {
    const lo = Math.log10(this.fMin), hi = Math.log10(this.fMax);
    return Math.pow(10, lo + clamp(x / this._w, 0, 1) * (hi - lo));
  }
  _gy(db) {
    const pad = 12, mid = this._h / 2;
    return mid - (db / this.range) * (mid - pad);
  }
  _yg(y) {
    const pad = 12, mid = this._h / 2;
    return clamp((mid - y) / (mid - pad) * this.range, -this.gainRange, this.gainRange);
  }

  _pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  _nearestPoint(p) {
    let best = -1, bestD = 24 * 24;
    this.bands.forEach((b, i) => {
      const dx = this._fx(b.f) - p.x, dy = this._gy(b.g) - p.y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  // --- interaction ---
  _onDown(e) {
    const i = this._nearestPoint(this._pos(e));
    if (i < 0) return;
    this._drag = i;
    try { this.canvas.setPointerCapture(e.pointerId); } catch {}
    this._applyDrag(e);
  }
  _onMove(e) {
    if (this._drag >= 0) { this._applyDrag(e); return; }
    const i = this._nearestPoint(this._pos(e));
    if (i !== this._hover) { this._hover = i; this.draw(); }
    this.canvas.style.cursor = i >= 0 ? 'move' : 'default';
  }
  _onUp(e) {
    if (this._drag < 0) return;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch {}
    this._drag = -1; this.draw();
  }
  _applyDrag(e) {
    const p = this._pos(e);
    const b = this.bands[this._drag];
    b.f = Math.round(clamp(this._xf(p.x), this.fMin, this.fMax));
    b.g = Math.round(this._yg(p.y));
    this._emit(this._drag);
    this.draw();
  }
  _onWheel(e) {
    const i = this._drag >= 0 ? this._drag : this._nearestPoint(this._pos(e));
    if (i < 0) return;
    e.preventDefault();
    const b = this.bands[i];
    // Wheel up (deltaY<0) → narrower (higher Q); down → wider (lower Q).
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    b.q = clamp(+(b.q * factor).toFixed(2), this.qMin, this.qMax);
    this._hover = i;
    this._emit(i);
    this.draw();
  }

  // --- drawing ---
  draw() {
    const ctx = this.ctx, w = this._w, h = this._h;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    this._drawGrid(ctx, w, h);
    if (this._spec) this._drawSpectrum(ctx, w, h);
    this._drawCurve(ctx, w, h);
    this._drawPoints(ctx, w, h);
    this._drawReadout(ctx, w, h);
  }

  _drawGrid(ctx, w, h) {
    ctx.save();
    ctx.fillStyle = 'rgba(154,163,178,0.7)';
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.lineWidth = 1;
    for (let db = -this.gainRange; db <= this.gainRange; db += this.gainRange / 2) {
      const y = Math.round(this._gy(db)) + 0.5;
      ctx.strokeStyle = db === 0 ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      if (db !== 0) ctx.fillText((db > 0 ? '+' : '') + db, 3, y - 2);
    }
    const marks = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
    const label = (f) => f >= 1000 ? (f / 1000) + 'k' : String(f);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    for (const f of marks) {
      const x = Math.round(this._fx(f)) + 0.5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      ctx.fillText(label(f), x + 2, h - 4);
    }
    ctx.restore();
  }

  _drawSpectrum(ctx, w, h) {
    const data = this._spec, n = data.length;
    const binHz = this._specSr / this._specFft;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(0, h);
    let started = false;
    for (let i = 1; i < n; i++) {
      const f = i * binHz;
      if (f < this.fMin) continue;
      if (f > this.fMax) break;
      const x = this._fx(f);
      const y = h - (data[i] / 255) * h;
      if (!started) { ctx.lineTo(x, h); started = true; }
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(76,139,245,0.50)');
    grad.addColorStop(1, 'rgba(52,211,153,0.08)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  _drawCurve(ctx, w, h) {
    if (!this.responseFn || !this._gridF) return;
    const db = this.responseFn(this._gridF); // Float32Array, true response
    ctx.save();
    ctx.beginPath();
    for (let k = 0; k < this._gridX.length; k++) {
      const y = this._gy(clamp(db[k], -this.range, this.range));
      if (k === 0) ctx.moveTo(this._gridX[k], y); else ctx.lineTo(this._gridX[k], y);
    }
    ctx.strokeStyle = '#4c8bf5';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(76,139,245,0.5)';
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.restore();
  }

  _drawPoints(ctx, w, h) {
    ctx.save();
    this.bands.forEach((b, i) => {
      const x = this._fx(b.f), y = this._gy(b.g);
      const active = i === this._drag || i === this._hover;
      ctx.beginPath();
      ctx.arc(x, y, active ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = active ? '#7db0ff' : '#4c8bf5';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#0d1017';
      ctx.stroke();
    });
    ctx.restore();
  }

  _drawReadout(ctx, w, h) {
    const i = this._drag >= 0 ? this._drag : this._hover;
    if (i < 0) return;
    const b = this.bands[i];
    const fTxt = b.f >= 1000 ? (b.f / 1000).toFixed(b.f % 1000 ? 1 : 0) + 'k' : Math.round(b.f) + '';
    // While hovering (not dragging) remind the user the wheel controls width.
    const hint = this._drag < 0 ? '   ⇅ rotella = Q' : '';
    const txt = `${fTxt}Hz · ${b.g > 0 ? '+' : ''}${b.g}dB · Q${b.q.toFixed(1)}${hint}`;
    ctx.save();
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    const tw = ctx.measureText(txt).width + 12;
    let x = this._fx(b.f) + 10, y = this._gy(b.g) - 26;
    if (x + tw > w) x = w - tw - 2;
    if (y < 2) y = this._gy(b.g) + 14;
    ctx.fillStyle = 'rgba(13,16,23,0.9)';
    ctx.strokeStyle = 'rgba(76,139,245,0.6)';
    ctx.lineWidth = 1;
    if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, tw, 20, 5); ctx.fill(); ctx.stroke(); }
    else { ctx.fillRect(x, y, tw, 20); }
    ctx.fillStyle = '#e7e9ee';
    ctx.fillText(txt, x + 6, y + 14);
    ctx.restore();
  }

  destroy() { try { this._ro.disconnect(); } catch {} }
}
