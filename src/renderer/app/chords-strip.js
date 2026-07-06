'use strict';

// Chord strip UI: shows the current chord in the middle with the 2 previous and
// 2 next chord segments on the sides, plus the estimated song key.
//
// Data: array of { start, end, chord } segments (from services/chords.js).
// Called every animation frame via update(currentTime); pointer stays cheap by
// caching the segment index and only re-rendering when it changes.

const NEIGHBOURS = 2;

export class ChordsStrip {
  constructor(els) {
    this.root      = els.root;
    this.keyEl     = els.key;
    this.statusEl  = els.status;
    this.prevEl    = els.prev;
    this.curEl     = els.current;
    this.nextEl    = els.next;

    this.segments = [];
    this.key = null;
    this.lastIdx = -2; // sentinel so the first update always renders
  }

  // Show/hide the whole strip. Called when a track loads / unloads.
  show(visible) {
    this.root.style.display = visible ? '' : 'none';
  }

  // Discard any previous analysis (e.g. when a new track is loaded).
  clear() {
    this.segments = [];
    this.key = null;
    this.lastIdx = -2;
    this.keyEl.textContent = '—';
    this.statusEl.textContent = '';
    this.prevEl.innerHTML = '';
    this.nextEl.innerHTML = '';
    this.curEl.textContent = '—';
  }

  // Show an in-progress hint while the worker runs. Frac in [0,1] or null.
  setStatus(text, frac) {
    if (frac != null && frac >= 0 && frac <= 1) {
      this.statusEl.textContent = `${text} ${Math.round(frac * 100)}%`;
    } else {
      this.statusEl.textContent = text || '';
    }
  }

  // Apply a completed analysis result.
  setResult(result) {
    if (!result) { this.clear(); return; }
    this.segments = Array.isArray(result.chords) ? result.chords : [];
    this.key = result.key || null;
    this.keyEl.textContent = this.key ? this.key.label : '—';
    this.statusEl.textContent = '';
    this.lastIdx = -2;
    // Force one paint so the strip has content even before playback starts.
    this.update(0);
  }

  // Binary-search the segment covering `t`. Returns -1 if before first / after
  // last (both treated as "no segment"). Segments are sorted by start.
  _indexAt(t) {
    const s = this.segments;
    if (s.length === 0) return -1;
    if (t < s[0].start) return -1;
    if (t >= s[s.length - 1].end) return -1;
    let lo = 0, hi = s.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (t < s[mid].start) hi = mid - 1;
      else if (t >= s[mid].end) lo = mid + 1;
      else return mid;
    }
    return -1;
  }

  update(currentTime) {
    if (this.segments.length === 0) return;
    const idx = this._indexAt(currentTime);
    if (idx === this.lastIdx) return;
    this.lastIdx = idx;

    if (idx < 0) {
      this.curEl.textContent = '—';
      this.prevEl.innerHTML = '';
      this.nextEl.innerHTML = '';
      return;
    }
    this.curEl.textContent = this.segments[idx].chord;

    const buildSide = (from, to, container) => {
      container.innerHTML = '';
      for (let i = from; i !== to; i += (from < to ? 1 : -1)) {
        if (i < 0 || i >= this.segments.length) continue;
        const el = document.createElement('span');
        el.className = 'chord-chip';
        el.textContent = this.segments[i].chord;
        container.appendChild(el);
      }
    };
    // Prev: reverse-order so the closest previous chord sits next to current.
    buildSide(idx - 1, Math.max(-1, idx - 1 - NEIGHBOURS), this.prevEl);
    buildSide(idx + 1, Math.min(this.segments.length, idx + 1 + NEIGHBOURS), this.nextEl);
  }
}
