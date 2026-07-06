'use strict';

// Chord strip UI: shows the current chord in the middle with the 2 previous and
// 2 next chord segments on the sides, plus the estimated song key.
//
// Data: array of { start, end, chord } segments (from services/chords.js).
// Called every animation frame via update(currentTime); pointer stays cheap by
// caching the segment index and only re-rendering when it changes.
//
// Transposition: when the user shifts the pitch with the semitone stepper, the
// displayed labels are transposed on the fly (root note rotated by N semitones)
// so what the strip shows matches what the user is actually hearing. Segment
// boundaries never change — only the displayed name.

const NEIGHBOURS = 2;

const PC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const ROOT_PC = {
  'C': 0, 'C#': 1, 'Db': 1,
  'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'F': 5, 'F#': 6, 'Gb': 6,
  'G': 7, 'G#': 8, 'Ab': 8,
  'A': 9, 'A#': 10, 'Bb': 10,
  'B': 11
};

// Transpose a chord label like "C", "C#m", "Gbmaj7" by `semis` semitones.
// Passes through "N" (no chord / silence) and anything unrecognised.
function transposeChord(label, semis) {
  if (!label || label === 'N' || label === '—') return label;
  const m = label.match(/^([A-G])([#b]?)(.*)$/);
  if (!m) return label;
  const rootStr = m[1] + m[2];
  const rootIdx = ROOT_PC[rootStr];
  if (rootIdx == null) return label;
  const shifted = ((rootIdx + semis) % 12 + 12) % 12;
  return PC[shifted] + m[3];
}

// Transpose the estimated key ({tonic, mode, label}). The Italian label
// ("C maggiore" / "A minore") is rebuilt from the transposed tonic.
function transposeKey(key, semis) {
  if (!key || !key.tonic) return key;
  const rootIdx = ROOT_PC[key.tonic];
  if (rootIdx == null) return key;
  const newTonic = PC[((rootIdx + semis) % 12 + 12) % 12];
  return {
    tonic: newTonic,
    mode: key.mode,
    label: `${newTonic} ${key.mode === 'minor' ? 'minore' : 'maggiore'}`
  };
}

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
    this._transpose = 0;
    this._lastTime = 0;
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
    this._lastTime = 0;
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
    this.statusEl.textContent = '';
    this._renderKey();
    this.lastIdx = -2;
    // Force one paint so the strip has content even before playback starts.
    this.update(this._lastTime || 0);
  }

  // Called by main.js whenever the semitone stepper changes. Only re-renders
  // when the value actually changes, and preserves the current playback position
  // so the paint stays in sync with what the user is hearing.
  setTranspose(semis) {
    const v = Math.trunc(Number(semis) || 0);
    if (v === this._transpose) return;
    this._transpose = v;
    this._renderKey();
    this.lastIdx = -2; // force chord repaint
    this.update(this._lastTime || 0);
  }

  _renderKey() {
    if (!this.key) { this.keyEl.textContent = '—'; return; }
    const t = transposeKey(this.key, this._transpose);
    this.keyEl.textContent = t.label;
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
    this._lastTime = currentTime;
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
    this.curEl.textContent = transposeChord(this.segments[idx].chord, this._transpose);

    const buildSide = (from, to, container) => {
      container.innerHTML = '';
      for (let i = from; i !== to; i += (from < to ? 1 : -1)) {
        if (i < 0 || i >= this.segments.length) continue;
        const el = document.createElement('span');
        el.className = 'chord-chip';
        el.textContent = transposeChord(this.segments[i].chord, this._transpose);
        container.appendChild(el);
      }
    };
    // Prev: reverse-order so the closest previous chord sits next to current.
    buildSide(idx - 1, Math.max(-1, idx - 1 - NEIGHBOURS), this.prevEl);
    buildSide(idx + 1, Math.min(this.segments.length, idx + 1 + NEIGHBOURS), this.nextEl);
  }
}
