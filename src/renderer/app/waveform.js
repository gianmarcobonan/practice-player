import { clamp } from './util.js';

// Canvas waveform with click-to-seek. Loop region + markers are layered on in
// later phases via setLoop()/setMarkers().
export class Waveform {
  constructor(canvas, { onSeek } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSeek = onSeek;
    this.peaks = null;
    this.duration = 0;
    this.progress = 0;
    this.loop = null;        // { start, end } seconds
    this.markers = [];       // [{ time, label }]
    this._wave = document.createElement('canvas'); // cached waveform layer

    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas);

    canvas.addEventListener('click', (e) => {
      if (!this.duration || !this.onSeek) return;
      const rect = canvas.getBoundingClientRect();
      const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
      this.onSeek(x * this.duration);
    });

    this._resize();
  }

  setPeaks(peaks, duration) {
    this.peaks = peaks;
    this.duration = duration;
    this._renderWave();
    this.draw();
  }

  setProgress(time) {
    this.progress = time;
    this.draw();
  }

  setLoop(loop) { this.loop = loop; this.draw(); }
  setMarkers(markers) { this.markers = markers || []; this.draw(); }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 140;
    for (const c of [this.canvas, this._wave]) {
      c.width = Math.floor(w * dpr);
      c.height = Math.floor(h * dpr);
    }
    this._dpr = dpr;
    this._renderWave();
    this.draw();
  }

  _renderWave() {
    const c = this._wave;
    const ctx = c.getContext('2d');
    const w = c.width, h = c.height;
    ctx.clearRect(0, 0, w, h);
    if (!this.peaks) return;
    const mid = h / 2;
    const n = this.peaks.length;
    const bw = w / n;
    ctx.fillStyle = '#3a4356';
    for (let i = 0; i < n; i++) {
      const amp = this.peaks[i] * (h * 0.46);
      const x = i * bw;
      ctx.fillRect(x, mid - amp, Math.max(1, bw - 0.5), amp * 2);
    }
  }

  draw() {
    const ctx = this.ctx;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Loop region
    if (this.loop && this.duration) {
      const x1 = (this.loop.start / this.duration) * w;
      const x2 = (this.loop.end / this.duration) * w;
      ctx.fillStyle = 'rgba(52, 211, 153, 0.14)';
      ctx.fillRect(x1, 0, x2 - x1, h);
      ctx.fillStyle = 'rgba(52, 211, 153, 0.6)';
      ctx.fillRect(x1, 0, 2, h);
      ctx.fillRect(x2 - 2, 0, 2, h);
    }

    // Cached waveform
    ctx.drawImage(this._wave, 0, 0);

    // Played portion overlay
    if (this.duration) {
      const px = (this.progress / this.duration) * w;
      ctx.save();
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = 'rgba(76, 139, 245, 0.55)';
      ctx.fillRect(0, 0, px, h);
      ctx.restore();

      // Markers
      ctx.fillStyle = '#f5b54c';
      for (const m of this.markers) {
        const mx = (m.time / this.duration) * w;
        ctx.fillRect(mx - 1, 0, 2, h);
      }

      // Playhead
      ctx.fillStyle = '#e7e9ee';
      ctx.fillRect(px - 1, 0, 2, h);
    }
  }
}
