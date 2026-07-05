import { Player } from './engine.js';
import { Waveform } from './waveform.js';
import { computePeaks, formatTime, clamp } from './util.js';
import { estimateTuning } from './tuning.js';
import { Metronome } from './metronome.js';
import { Tuner } from './tuner.js';

const els = {
  status: document.getElementById('status'),
  openBtn: document.getElementById('openBtn'),
  openProjectBtn: document.getElementById('openProjectBtn'),
  saveProjectBtn: document.getElementById('saveProjectBtn'),
  exportMp3Btn: document.getElementById('exportMp3Btn'),
  exportMp4Btn: document.getElementById('exportMp4Btn'),
  ytUrl: document.getElementById('ytUrl'),
  ytBtn: document.getElementById('ytBtn'),
  ytResults: document.getElementById('ytResults'),
  ytProgress: document.getElementById('ytProgress'),
  ytBar: document.getElementById('ytBar'),
  ytProgressText: document.getElementById('ytProgressText'),
  playBtn: document.getElementById('playBtn'),
  volSlider: document.getElementById('volSlider'),
  volVal: document.getElementById('volVal'),
  volReset: document.getElementById('volReset'),
  normBtn: document.getElementById('normBtn'),
  autoNormBtn: document.getElementById('autoNormBtn'),
  songName: document.getElementById('songName'),
  curTime: document.getElementById('curTime'),
  durTime: document.getElementById('durTime'),
  waveCanvas: document.getElementById('waveform'),
  transport: document.getElementById('transport'),
  videoWrap: document.getElementById('videoWrap'),
  videoEl: document.getElementById('videoEl'),
  videoExpand: document.getElementById('videoExpand'),
  dropOverlay: document.getElementById('dropOverlay'),
  // download choice modal
  dlModal: document.getElementById('dlModal'),
  dlAudio: document.getElementById('dlAudio'),
  dlVideo: document.getElementById('dlVideo'),
  dlCancel: document.getElementById('dlCancel'),
  // pitch
  pitchDown: document.getElementById('pitchDown'),
  pitchUp: document.getElementById('pitchUp'),
  pitchReset: document.getElementById('pitchReset'),
  pitchVal: document.getElementById('pitchVal'),
  tuningVal: document.getElementById('tuningVal'),
  tuningApply: document.getElementById('tuningApply'),
  tuningAuto: document.getElementById('tuningAuto'),
  fineCents: document.getElementById('fineCents'),
  // speed
  speedPresets: document.getElementById('speedPresets'),
  speedDown: document.getElementById('speedDown'),
  speedUp: document.getElementById('speedUp'),
  speedSlider: document.getElementById('speedSlider'),
  speedVal: document.getElementById('speedVal'),
  // stems
  separateBtn: document.getElementById('separateBtn'),
  stemMixer: document.getElementById('stemMixer'),
  stemHint: document.getElementById('stemHint'),
  stemProgress: document.getElementById('stemProgress'),
  stemBar: document.getElementById('stemBar'),
  stemProgressText: document.getElementById('stemProgressText'),
  // loop + markers
  setA: document.getElementById('setA'),
  setB: document.getElementById('setB'),
  loopToggle: document.getElementById('loopToggle'),
  loopClear: document.getElementById('loopClear'),
  loopInfo: document.getElementById('loopInfo'),
  addMarker: document.getElementById('addMarker'),
  markerList: document.getElementById('markerList'),
  // auto-update
  updateInfo: document.getElementById('updateInfo'),
  updateBtn: document.getElementById('updateBtn'),
  // metronome
  metroToggle: document.getElementById('metroToggle'),
  metroDown: document.getElementById('metroDown'),
  metroUp: document.getElementById('metroUp'),
  metroBpm: document.getElementById('metroBpm'),
  metroTap: document.getElementById('metroTap'),
  metroHalf: document.getElementById('metroHalf'),
  metroDouble: document.getElementById('metroDouble'),
  metroSig: document.getElementById('metroSig'),
  countIn: document.getElementById('countIn'),
  // tuner
  tunerKeys: document.getElementById('tunerKeys'),
  octDown: document.getElementById('octDown'),
  octUp: document.getElementById('octUp'),
  octVal: document.getElementById('octVal'),
  tunerStop: document.getElementById('tunerStop'),
  tunerBeep: document.getElementById('tunerBeep'),
  tunerPiano: document.getElementById('tunerPiano'),
  // fine tuning manual
  fineDown: document.getElementById('fineDown'),
  fineUp: document.getElementById('fineUp'),
  fineSlider: document.getElementById('fineSlider')
};

const loop = { a: null, b: null, on: false };
let markers = [];
let applying = false;
let saveTimer = null;
let savedStemState = null;

const STEM_LABELS = { drums: 'Batteria', bass: 'Basso', other: 'Altro', vocals: 'Voce', guitar: 'Chitarra', piano: 'Piano' };
let currentFilePath = null;
let stemState = [];

const player = new Player();
const waveform = new Waveform(els.waveCanvas, {
  onSeek: (t) => { player.seek(t); render(); }
});

player.onended = () => { videoPause(); updatePlayBtn(); console.log('ENDED'); };
player.onready = () => console.log('ENGINE_READY');

// Standalone metronome: its tempo is absolute (NOT tied to the song or playback
// speed) and it clicks independently of the loaded track.
const metro = new Metronome(player.ctx);
function updateMetroBtn() {
  els.metroToggle.textContent = metro.on ? '⏸ Click' : '▶ Click';
  els.metroToggle.classList.toggle('active', metro.on);
}

// Simple reference-tone tuner.
const tuner = new Tuner(player.ctx);
let tunerOctave = 4;

const state = { semitones: 0, speedPct: 100, fineCents: 0, estimatedCents: null, volume: 1 };

// --- Video (tutorial) sync ---
// The audio engine (rubberband) is the master clock; the <video> element is a
// muted, slaved picture. We match its playbackRate to the song speed and only
// reseek when it drifts past a tolerance (per-frame seeking would stutter).
let hasVideo = false;
const VIDEO_DRIFT = 0.12; // seconds

function setupVideo(decoded) {
  const v = els.videoEl;
  if (decoded.isVideo && decoded.fileUrl) {
    hasVideo = true;
    v.muted = true;
    v.playbackRate = state.speedPct / 100;
    v.src = decoded.fileUrl;
    els.videoWrap.style.display = '';
    try { v.load(); } catch {}
  } else {
    hasVideo = false;
    try { v.pause(); } catch {}
    v.removeAttribute('src');
    try { v.load(); } catch {}
    els.videoWrap.style.display = 'none';
  }
}

function syncVideoTime(force) {
  if (!hasVideo) return;
  const v = els.videoEl;
  const target = player.currentTime;
  if (force || Math.abs(v.currentTime - target) > VIDEO_DRIFT) {
    try { v.currentTime = target; } catch {}
  }
}

function videoPlay() {
  if (!hasVideo) return;
  els.videoEl.playbackRate = state.speedPct / 100;
  syncVideoTime(true);
  els.videoEl.play().catch(() => {});
}

function videoPause() {
  if (!hasVideo) return;
  els.videoEl.pause();
}

function setStatus(msg) { els.status.textContent = msg; }
function updatePlayBtn() { els.playBtn.textContent = player.isPlaying ? '⏸' : '▶'; }

function render() {
  waveform.setProgress(player.currentTime);
  els.curTime.textContent = formatTime(player.currentTime);
  // Force-align the still frame while paused/scrubbing; drift-correct while playing.
  if (hasVideo) syncVideoTime(!player.isPlaying);
}

// --- Pitch + fine tuning ---
function applyPitch() {
  state.semitones = clamp(state.semitones, -12, 12);
  state.fineCents = clamp(Math.round(state.fineCents), -50, 50);
  els.pitchVal.textContent = (state.semitones > 0 ? '+' : '') + state.semitones;
  els.fineCents.textContent = state.fineCents ? `${state.fineCents > 0 ? '+' : ''}${state.fineCents} cent` : '0 cent';
  if (els.fineSlider) els.fineSlider.value = String(state.fineCents);
  player.setPitch(state.semitones, state.fineCents);
  scheduleSave();
  console.log(`PITCH semitones=${state.semitones} fineCents=${state.fineCents}`);
}

function showTuning() {
  const c = state.estimatedCents;
  if (c == null) { els.tuningVal.textContent = '—'; els.tuningApply.disabled = true; return; }
  const r = Math.round(c);
  els.tuningVal.textContent = Math.abs(r) <= 2 ? '≈ intonato (440)' : `≈ ${r > 0 ? '+' : ''}${r} cent`;
  els.tuningApply.disabled = Math.abs(r) <= 2;
}

// --- Speed ---
function applySpeed() {
  state.speedPct = clamp(Math.round(state.speedPct), 50, 150);
  els.speedVal.textContent = state.speedPct;
  els.speedSlider.value = String(state.speedPct);
  player.setSpeed(state.speedPct / 100);
  if (hasVideo) els.videoEl.playbackRate = state.speedPct / 100;
  [...els.speedPresets.children].forEach((b) => {
    b.classList.toggle('active', Math.round(parseFloat(b.dataset.speed) * 100) === state.speedPct);
  });
  scheduleSave();
  console.log(`SPEED pct=${state.speedPct}`);
}

// --- Volume / normalization ---
function applyVolume() {
  state.volume = clamp(state.volume, 0, 3);
  player.setVolume(state.volume);
  const pct = Math.round(state.volume * 100);
  els.volSlider.value = String(pct);
  els.volVal.textContent = pct + '%';
  scheduleSave();
}

// Loudness normalization: bring every track to a consistent perceived level so
// you don't have to ride the volume. Uses RMS toward a target, with a peak ceiling
// that prevents clipping (a loud master is turned down, a quiet one is boosted).
const NORM_TARGET_RMS = 0.18; // ≈ -15 dBFS, a comfortable constant level
const NORM_PEAK_CEIL = 0.97;
function computeNormalizeGain() {
  if (!player.channelData) return 1;
  let sumSq = 0, n = 0, peak = 0;
  for (const ch of player.channelData) {
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i]; sumSq += x * x;
      const a = x < 0 ? -x : x; if (a > peak) peak = a;
    }
    n += ch.length;
  }
  if (n === 0) return 1;
  const rms = Math.sqrt(sumSq / n);
  if (rms < 1e-6) return 1;
  let gain = NORM_TARGET_RMS / rms;
  if (peak > 1e-6) gain = Math.min(gain, NORM_PEAK_CEIL / peak); // never clip
  return clamp(gain, 0.1, 4);
}

function normalizeVolume() {
  if (!player.loaded || !player.channelData) return;
  state.volume = computeNormalizeGain();
  applyVolume();
  setStatus(`volume normalizzato (${Math.round(state.volume * 100)}%)`);
}

// Global "auto-normalize" preference (persists across sessions).
let autoNorm = false;
try { autoNorm = localStorage.getItem('autoNormalize') === '1'; } catch {}
function updateAutoNormBtn() {
  els.autoNormBtn.classList.toggle('active', autoNorm);
}

// Global "auto-intonation" preference: correct each track's tuning toward A440
// automatically on load (the detection is precise; this applies it for you).
let autoTune = false;
try { autoTune = localStorage.getItem('autoTune') === '1'; } catch {}
function updateTuningAutoBtn() {
  els.tuningAuto.classList.toggle('active', autoTune);
}
// True only when the detected offset is meaningful (ignore ±2 cent noise).
function tuningCorrectionCents() {
  if (state.estimatedCents == null) return null;
  const r = Math.round(state.estimatedCents);
  return Math.abs(r) > 2 ? -r : 0;
}

// --- Loop A/B ---
function applyLoop() {
  const ok = loop.on && loop.a != null && loop.b != null && loop.b > loop.a;
  player.setLoop(ok ? { start: loop.a, end: loop.b } : null);
  waveform.setLoop(loop.a != null && loop.b != null && loop.b > loop.a ? { start: loop.a, end: loop.b } : null);
  els.loopToggle.classList.toggle('active', ok);
  const fmt = (t) => (t == null ? '–' : formatTime(t));
  els.loopInfo.textContent = (loop.a != null || loop.b != null) ? `A ${fmt(loop.a)} · B ${fmt(loop.b)}` : '';
  scheduleSave();
}

// --- Markers ---
function renderMarkers() {
  markers.sort((a, b) => a.time - b.time);
  waveform.setMarkers(markers);
  els.markerList.innerHTML = '';
  markers.forEach((m, i) => {
    const chip = document.createElement('div');
    chip.className = 'marker-chip';
    chip.innerHTML = `<span class="m-go">${m.label} · ${formatTime(m.time)}</span><span class="m-del" title="Rimuovi">✕</span>`;
    chip.querySelector('.m-go').addEventListener('click', () => { player.seek(m.time); render(); });
    chip.querySelector('.m-del').addEventListener('click', () => { markers.splice(i, 1); renderMarkers(); });
    els.markerList.appendChild(chip);
  });
  scheduleSave();
}

function addMarker() {
  if (!player.loaded) return;
  markers.push({ time: player.currentTime, label: 'M' + (markers.length + 1) });
  renderMarkers();
}

// Animation frame loop while playing.
let rafId = null;
function frameTick() {
  render();
  if (player.isPlaying) {
    rafId = requestAnimationFrame(frameTick);
  } else {
    updatePlayBtn();
    rafId = null;
  }
}
function startLoop() { if (!rafId) rafId = requestAnimationFrame(frameTick); }

function resetMixer() {
  stemState = [];
  els.stemMixer.innerHTML = '';
  els.stemHint.style.display = '';
}

function buildMixer(sources) {
  const useSaved = savedStemState && savedStemState.length === sources.length;
  stemState = sources.map((_, i) => useSaved
    ? { gain: savedStemState[i].gain ?? 1, mute: !!savedStemState[i].mute, solo: !!savedStemState[i].solo }
    : { gain: 1, mute: false, solo: false });
  els.stemMixer.innerHTML = '';
  els.stemHint.style.display = 'none';
  sources.forEach((name, i) => {
    const row = document.createElement('div');
    row.className = 'mixer-row';
    row.innerHTML =
      `<span class="stem-name">${STEM_LABELS[name] || name}</span>` +
      `<button class="btn mini mute" title="Muto">M</button>` +
      `<button class="btn mini solo" title="Solo">S</button>` +
      `<input type="range" min="0" max="150" value="100" class="vol" />`;
    const mute = row.querySelector('.mute');
    const solo = row.querySelector('.solo');
    const vol = row.querySelector('.vol');
    mute.addEventListener('click', () => {
      stemState[i].mute = !stemState[i].mute;
      mute.classList.toggle('active', stemState[i].mute);
      applyStemGains();
    });
    solo.addEventListener('click', () => {
      stemState[i].solo = !stemState[i].solo;
      solo.classList.toggle('active', stemState[i].solo);
      applyStemGains();
    });
    vol.addEventListener('input', () => {
      stemState[i].gain = parseInt(vol.value, 10) / 100;
      applyStemGains();
    });
    // Reflect restored state on controls.
    mute.classList.toggle('active', stemState[i].mute);
    solo.classList.toggle('active', stemState[i].solo);
    vol.value = String(Math.round(stemState[i].gain * 100));
    els.stemMixer.appendChild(row);
  });
  if (useSaved) applyStemGains();
}

function applyStemGains() {
  player.setStemGains(stemState.map((s) => ({ gain: s.gain, mute: s.mute, solo: s.solo })));
  scheduleSave();
}

// --- Per-song memory ---
function gatherSettings() {
  return {
    semitones: state.semitones,
    fineCents: state.fineCents,
    speedPct: state.speedPct,
    volume: state.volume,
    loop: { a: loop.a, b: loop.b, on: loop.on },
    markers,
    stemState,
    metro: {
      bpm: metro.bpm,
      beatsPerBar: metro.beatsPerBar,
      countIn: parseInt(els.countIn.value, 10) || 0
    }
  };
}

function scheduleSave() {
  if (applying || !currentFilePath) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => window.api.saveSettings(currentFilePath, gatherSettings()), 500);
}

async function applySettings(s) {
  applying = true;
  try {
    state.semitones = s.semitones || 0;
    state.fineCents = s.fineCents || 0;
    applyPitch();
    state.speedPct = s.speedPct || 100;
    applySpeed();
    state.volume = s.volume != null ? s.volume : 1;
    applyVolume();
    loop.a = s.loop && s.loop.a != null ? s.loop.a : null;
    loop.b = s.loop && s.loop.b != null ? s.loop.b : null;
    loop.on = !!(s.loop && s.loop.on);
    applyLoop();
    markers = Array.isArray(s.markers) ? s.markers : [];
    renderMarkers();
    if (s.metro) {
      metro.setBpm(s.metro.bpm || 120);
      els.metroBpm.value = metro.bpm;
      metro.setBeatsPerBar(s.metro.beatsPerBar || 4);
      els.metroSig.value = String(metro.beatsPerBar);
      els.countIn.value = String(s.metro.countIn || 0);
    }
    savedStemState = Array.isArray(s.stemState) ? s.stemState : null;
  } finally {
    applying = false;
  }
}

let sepStart = 0;
let sepStartChunk = 0;
function setStemBar(frac, text, indeterminate) {
  els.stemProgress.style.display = '';
  els.stemBar.classList.toggle('indeterminate', !!indeterminate);
  if (!indeterminate) els.stemBar.style.width = Math.max(0, Math.min(100, frac * 100)).toFixed(1) + '%';
  els.stemProgressText.textContent = text;
}
function hideStemBar() {
  els.stemProgress.style.display = 'none';
  els.stemBar.classList.remove('indeterminate');
}
function fmtEta(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `~${sec}s rimanenti`;
  return `~${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, '0')}s rimanenti`;
}

async function separateStems() {
  if (!currentFilePath) return;
  try {
    els.separateBtn.disabled = true;
    sepStart = 0;
    setStemBar(0, 'avvio separazione…', true);
    setStatus('separazione in corso…');
    const payload = await window.api.separateStems(currentFilePath);
    await player.loadStems(payload);
    buildMixer(payload.sources);
    updatePlayBtn();
    hideStemBar();
    setStatus('stem pronti');
    console.log('STEMS_LOADED sources=' + payload.sources.join(','));
  } catch (err) {
    hideStemBar();
    setStatus('errore separazione: ' + err.message);
    console.error('STEM_ERROR', err);
  } finally {
    els.separateBtn.disabled = false;
  }
}

window.api.onStemProgress((p) => {
  if (p.phase === 'models') {
    setStemBar(0, 'preparazione modello AI…', true);
    setStatus('preparazione separazione…');
  } else if (p.phase === 'download') {
    setStemBar(p.frac, `scarico modello AI… ${Math.round(p.frac * 100)}% (una sola volta)`, false);
    setStatus('scarico modello AI…');
  } else if (p.phase === 'separate') {
    if (!sepStart) { sepStart = performance.now(); sepStartChunk = p.chunk; }
    // A chunk is fully processed when its progress events fire, so chunk-based
    // fraction is accurate. (Each chunk emits one event per stem; same fraction.)
    const frac = (p.chunk + 1) / p.nChunks;
    let txt = `separazione ${Math.round(frac * 100)}% (parte ${p.chunk + 1}/${p.nChunks})`;
    const elapsed = (performance.now() - sepStart) / 1000;
    const chunksSince = p.chunk - sepStartChunk;        // chunks timed since the reference
    if (chunksSince >= 1 && elapsed > 1) {
      const remaining = (p.nChunks - 1 - p.chunk) * (elapsed / chunksSince);
      txt += ' · ' + fmtEta(remaining);
    }
    setStemBar(frac, txt, false);
    setStatus(`separazione ${Math.round(frac * 100)}%`);
  }
});

async function loadPath(filePath, presetSettings) {
  try {
    setStatus('decodifica in corso…');
    els.transport.classList.add('busy');
    els.saveProjectBtn.disabled = true;
    els.exportMp3Btn.disabled = true;
    els.exportMp4Btn.disabled = true;
    currentFilePath = filePath;
    resetMixer();
    loop.a = loop.b = null; loop.on = false; applyLoop();
    markers = []; renderMarkers();
    const decoded = await window.api.decodeFile(filePath);
    await player.load(decoded);
    setupVideo(decoded);

    const peaks = computePeaks(player.channelData, decoded.frames, 2000);
    waveform.setPeaks(peaks, decoded.duration);

    els.songName.textContent = decoded.name;
    els.durTime.textContent = formatTime(decoded.duration);
    els.curTime.textContent = formatTime(0);
    waveform.setProgress(0);
    updatePlayBtn();

    // Reset volume for the new track (saved settings, if any, override below).
    state.volume = 1; applyVolume();

    // Estimate tuning offset (suggestion only).
    state.fineCents = 0; applyPitch();
    try {
      state.estimatedCents = estimateTuning(player.channelData, decoded.sampleRate);
      console.log(`TUNING estimatedCents=${state.estimatedCents.toFixed(1)}`);
    } catch (e) { state.estimatedCents = null; console.error('TUNING_ERROR', e); }
    showTuning();

    // Restore settings: embedded project settings take precedence, otherwise the
    // per-song settings saved for this path.
    savedStemState = null;
    const saved = presetSettings || await window.api.getSettings(filePath);
    if (saved) { await applySettings(saved); console.log('SETTINGS_RESTORED'); }

    // Auto-normalize (if enabled) overrides any saved/default volume so every
    // track plays at a consistent level without manual adjustment.
    if (autoNorm) { state.volume = computeNormalizeGain(); applyVolume(); console.log(`AUTONORM vol=${state.volume.toFixed(2)}`); }

    // Auto-intonation (if enabled): correct toward A440 automatically, overriding
    // any saved fine offset (unless the user has a manual non-zero correction saved).
    if (autoTune) {
      const corr = tuningCorrectionCents();
      if (corr != null) { state.fineCents = corr; applyPitch(); console.log(`AUTOTUNE fineCents=${corr}`); }
    }

    els.saveProjectBtn.disabled = false;
    els.exportMp3Btn.disabled = false;
    els.exportMp4Btn.disabled = !hasVideo;
    setStatus('pronto');
    console.log(`LOADED name=${decoded.name} dur=${decoded.duration.toFixed(2)}s ` +
      `sr=${decoded.sampleRate} ch=${decoded.channels} frames=${decoded.frames}`);
  } catch (err) {
    setStatus('errore: ' + err.message);
    console.error('LOAD_ERROR', err);
  } finally {
    els.transport.classList.remove('busy');
  }
}

async function openFile() {
  const filePath = await window.api.openFileDialog();
  if (filePath) await loadPath(filePath);
}

// Save the current media (audio or audio+video) + all settings into one .ppx file.
async function saveProject() {
  if (!currentFilePath) { setStatus('nessun brano da salvare'); return; }
  const name = (els.songName.textContent || 'progetto').replace(/\.[^.]+$/, '');
  try {
    els.saveProjectBtn.disabled = true;
    setStatus('salvataggio progetto…');
    const saved = await window.api.saveProject(currentFilePath, gatherSettings(), name);
    setStatus(saved ? 'progetto salvato' : 'pronto');
  } catch (err) {
    setStatus('errore salvataggio: ' + err.message);
    console.error('PROJECT_SAVE_ERROR', err);
  } finally {
    els.saveProjectBtn.disabled = !currentFilePath;
  }
}

async function openProject(ppxPath) {
  try {
    setStatus('apertura progetto…');
    const res = await window.api.openProject(ppxPath);
    if (!res) { setStatus('pronto'); return; }
    await loadPath(res.mediaPath, res.settings);
  } catch (err) {
    setStatus('errore apertura progetto: ' + err.message);
    console.error('PROJECT_OPEN_ERROR', err);
  }
}

// --- Export (audio MP3 / audio+video MP4) with current speed, pitch, stem volumes ---
let exporting = false;
async function exportMedia(mode) {
  if (!currentFilePath || exporting) return;
  exporting = true;
  const label = mode === 'video' ? 'MP4' : 'MP3';
  els.exportMp3Btn.disabled = true; els.exportMp4Btn.disabled = true;
  try {
    setStatus(`esporto ${label}…`);
    const name = (els.songName.textContent || 'export').replace(/\.[^.]+$/, '');
    const out = await window.api.exportMedia({
      filePath: currentFilePath,
      mode,
      settings: gatherSettings(),
      useStems: stemState.length > 0,
      suggestedName: name
    });
    setStatus(out ? `esportato: ${out.split(/[\\/]/).pop()}` : 'pronto');
  } catch (err) {
    setStatus('errore export: ' + err.message);
    console.error('EXPORT_ERROR', err);
  } finally {
    exporting = false;
    els.exportMp3Btn.disabled = !currentFilePath;
    els.exportMp4Btn.disabled = !hasVideo;
  }
}

// --- Tuner (reference tones) ---
function refreshTunerKeys() {
  [...els.tunerKeys.children].forEach((b) => {
    b.classList.toggle('active', tuner.current === b.dataset.note + tunerOctave);
  });
}
function buildTuner() {
  els.tunerKeys.innerHTML = '';
  Tuner.NOTES.forEach((note) => {
    const b = document.createElement('button');
    b.className = 'btn' + (note.includes('#') ? ' sharp' : '');
    b.textContent = note;
    b.dataset.note = note;
    b.addEventListener('click', () => { tuner.toggle(note, tunerOctave); refreshTunerKeys(); });
    els.tunerKeys.appendChild(b);
  });
}
function setOctave(o) {
  tunerOctave = Math.max(1, Math.min(7, o));
  els.octVal.textContent = String(tunerOctave);
  if (tuner.current) tuner.play(tuner.current.replace(/\d+$/, ''), tunerOctave); // re-pitch a sounding note
  refreshTunerKeys();
}
function setTunerMode(mode) {
  tuner.setMode(mode);
  try { localStorage.setItem('tunerMode', mode); } catch {}
  els.tunerBeep.classList.toggle('active', mode === 'beep');
  els.tunerPiano.classList.toggle('active', mode === 'piano');
}

// Ask whether to download audio only or audio+video. Resolves to
// 'audio' | 'video' | null (cancelled).
function askDownloadMode() {
  return new Promise((resolve) => {
    els.dlModal.style.display = '';
    const done = (mode) => {
      els.dlModal.style.display = 'none';
      els.dlAudio.onclick = els.dlVideo.onclick = els.dlCancel.onclick = null;
      window.removeEventListener('keydown', onKey, true);
      resolve(mode);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(null); } };
    els.dlAudio.onclick = () => done('audio');
    els.dlVideo.onclick = () => done('video');
    els.dlCancel.onclick = () => done(null);
    window.addEventListener('keydown', onKey, true);
  });
}

function isYtUrl(s) { return /^https?:\/\//i.test(s) || /(youtube\.com|youtu\.be)\//i.test(s); }

function fmtDur(s) {
  s = Math.round(s || 0);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
// Audio preview (stream the bestaudio URL without downloading). A seek bar lets
// you scrub forward/back through the streamed audio.
const previewAudio = new Audio();
previewAudio.preload = 'none';
let previewId = null;
let previewSeeking = false;
function previewRowEl() {
  return previewId ? els.ytResults.querySelector(`.yt-result[data-id="${CSS.escape(previewId)}"]`) : null;
}
function refreshPreviewButtons() {
  els.ytResults.querySelectorAll('.yt-result').forEach((row) => {
    const b = row.querySelector('.yt-prev');
    if (b) b.textContent = (row.dataset.id === previewId && !previewAudio.paused) ? '⏸' : '▶';
    const seek = row.querySelector('.yt-seek');
    if (seek) seek.style.display = (row.dataset.id === previewId) ? '' : 'none';
  });
}
function updatePreviewSeek() {
  const row = previewRowEl();
  if (!row) return;
  const range = row.querySelector('.yt-seek-range');
  const time = row.querySelector('.yt-seek-time');
  const dur = previewAudio.duration || 0;
  const cur = previewAudio.currentTime || 0;
  if (!previewSeeking && dur > 0) range.value = String(Math.round((cur / dur) * 1000));
  time.textContent = `${fmtDur(cur)} / ${dur ? fmtDur(dur) : '—'}`;
}
previewAudio.addEventListener('play', refreshPreviewButtons);
previewAudio.addEventListener('pause', refreshPreviewButtons);
previewAudio.addEventListener('timeupdate', updatePreviewSeek);
previewAudio.addEventListener('loadedmetadata', updatePreviewSeek);
previewAudio.addEventListener('ended', () => { previewId = null; refreshPreviewButtons(); });
function stopPreview() {
  try { previewAudio.pause(); previewAudio.removeAttribute('src'); } catch {}
  previewId = null;
  previewSeeking = false;
  refreshPreviewButtons();
}
async function togglePreview(r, btn) {
  if (previewId === r.id) { stopPreview(); return; }
  if (player.isPlaying) { player.pause(); videoPause(); updatePlayBtn(); } // avoid overlap
  previewId = r.id;
  btn.textContent = '…';
  refreshPreviewButtons(); // reveal this row's seek bar
  try {
    const url = await window.api.youtubeStreamUrl(r.url);
    if (previewId !== r.id) return; // switched/cancelled while loading
    previewAudio.src = url;
    await previewAudio.play();
  } catch (err) {
    if (previewId === r.id) previewId = null;
    setStatus('anteprima non disponibile: ' + err.message);
    console.error('YT_PREVIEW_ERROR', err);
  }
  refreshPreviewButtons();
}

function hideYtResults() { stopPreview(); els.ytResults.style.display = 'none'; els.ytResults.innerHTML = ''; }
function renderYtResults(results) {
  stopPreview();
  els.ytResults.innerHTML = '';
  if (!results.length) { hideYtResults(); return; }
  results.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'yt-result';
    row.dataset.id = r.id;
    row.innerHTML =
      '<div class="yt-r-main">' +
        '<img class="yt-thumb" alt="" />' +
        '<div class="yt-r-info"><span class="yt-r-title"></span><span class="yt-r-meta"></span></div>' +
        '<button class="btn yt-prev" title="Ascolta anteprima">▶</button>' +
        '<button class="btn yt-dl" title="Scarica">⬇</button>' +
      '</div>' +
      '<div class="yt-seek" style="display:none">' +
        '<input class="yt-seek-range" type="range" min="0" max="1000" value="0" title="Vai avanti/indietro" />' +
        '<span class="yt-seek-time">0:00 / —</span>' +
      '</div>';
    row.querySelector('.yt-thumb').src = `https://i.ytimg.com/vi/${r.id}/mqdefault.jpg`;
    row.querySelector('.yt-r-title').textContent = r.title;
    row.querySelector('.yt-r-meta').textContent = [r.channel, fmtDur(r.duration)].filter(Boolean).join(' · ');
    const prevBtn = row.querySelector('.yt-prev');
    prevBtn.addEventListener('click', () => togglePreview(r, prevBtn));
    row.querySelector('.yt-dl').addEventListener('click', () => downloadUrl(r.url));
    const range = row.querySelector('.yt-seek-range');
    range.addEventListener('pointerdown', () => { previewSeeking = true; });
    const commitSeek = () => {
      if (previewId === r.id && previewAudio.duration) {
        previewAudio.currentTime = (parseInt(range.value, 10) / 1000) * previewAudio.duration;
      }
      previewSeeking = false;
    };
    range.addEventListener('change', commitSeek);
    range.addEventListener('input', () => {
      const time = row.querySelector('.yt-seek-time');
      if (previewAudio.duration) {
        time.textContent = `${fmtDur((parseInt(range.value, 10) / 1000) * previewAudio.duration)} / ${fmtDur(previewAudio.duration)}`;
      }
    });
    els.ytResults.appendChild(row);
  });
  els.ytResults.style.display = '';
}

function setYtBar(frac, text, indeterminate) {
  els.ytProgress.style.display = '';
  els.ytBar.classList.toggle('indeterminate', !!indeterminate);
  if (!indeterminate) els.ytBar.style.width = Math.max(0, Math.min(100, frac * 100)).toFixed(1) + '%';
  els.ytProgressText.textContent = text;
}
function hideYtBar() { els.ytProgress.style.display = 'none'; els.ytBar.classList.remove('indeterminate'); }

// Download a specific URL (asks audio vs audio+video).
async function downloadUrl(url) {
  const mode = await askDownloadMode();
  if (!mode) return;
  const label = mode === 'video' ? 'audio+video' : 'solo audio';
  try {
    els.ytBtn.disabled = true;
    hideYtResults();
    ytLastPct = -1; ytPass = 0;
    setYtBar(0, `download YouTube (${label})… avvio…`, true);
    setStatus(`download YouTube (${label})…`);
    const { filePath } = await window.api.downloadYoutube(url, { video: mode === 'video' });
    setYtBar(1, 'download completato, decodifica…', false);
    setStatus('download completato, decodifica…');
    els.ytUrl.value = '';
    await loadPath(filePath);
    hideYtBar();
  } catch (err) {
    hideYtBar();
    setStatus('errore download: ' + err.message);
    console.error('YT_ERROR', err);
  } finally {
    els.ytBtn.disabled = false;
  }
}

async function searchYoutube(query) {
  try {
    els.ytBtn.disabled = true;
    setStatus('cerco su YouTube…');
    const results = await window.api.searchYoutube(query);
    renderYtResults(results);
    setStatus(results.length ? `${results.length} risultati — scegli un brano` : 'nessun risultato');
  } catch (err) {
    setStatus('errore ricerca: ' + err.message);
    console.error('YT_SEARCH_ERROR', err);
  } finally {
    els.ytBtn.disabled = false;
  }
}

// Toolbar action: a pasted URL downloads directly, anything else is a search.
async function downloadYoutube() {
  const q = els.ytUrl.value.trim();
  if (!q) return;
  if (isYtUrl(q)) await downloadUrl(q);
  else await searchYoutube(q);
}

// yt-dlp reports 0–100 per stream; for video it downloads two streams (video then
// audio) so the bar fills, resets, and fills again before the final merge.
let ytLastPct = -1, ytPass = 0;
window.api.onYoutubeProgress((p) => {
  const pct = (p && typeof p === 'object') ? p.percent : p; // back-compat with plain number
  if (isNaN(pct)) return;
  if (ytLastPct < 0) ytPass = 1;
  else if (pct < ytLastPct - 15) ytPass++;
  ytLastPct = pct;
  const tag = ytPass > 1 ? ` · flusso ${ytPass}` : '';
  const eta = p && p.eta && !/unknown|^00:00$/i.test(p.eta) ? ` · ${p.eta} rimanenti` : '';
  const spd = p && p.speed && !/unknown/i.test(p.speed) ? ` · ${p.speed}` : '';
  setYtBar(pct / 100, `scarico… ${pct.toFixed(0)}%${tag}${eta}${spd}`, false);
});

if (window.api.onExportProgress) {
  window.api.onExportProgress((p) => {
    const pct = p.frac != null ? ` ${Math.round(p.frac * 100)}%` : '';
    const ph = { prepare: 'preparazione', render: 'elaborazione audio', encode: 'codifica video/audio' }[p.phase] || p.phase;
    setStatus(`export · ${ph}${pct}`);
  });
}

// --- Auto-update status ---
if (window.api.onUpdateStatus) {
  window.api.onUpdateStatus((s) => {
    if (!s) return;
    if (s.state === 'downloading') {
      els.updateInfo.style.display = '';
      els.updateInfo.textContent = `scarico aggiornamento… ${s.percent || 0}%`;
    } else if (s.state === 'downloaded') {
      els.updateInfo.style.display = '';
      els.updateInfo.textContent = `aggiornamento ${s.version} pronto`;
      els.updateBtn.style.display = '';
    } else if (s.state === 'available') {
      els.updateInfo.style.display = '';
      els.updateInfo.textContent = `nuova versione ${s.version} disponibile…`;
    } else if (s.state === 'error') {
      console.error('UPDATE_ERROR', s.message);
    }
  });
  els.updateBtn.addEventListener('click', () => window.api.installUpdate());
}

async function togglePlay() {
  if (!player.loaded) return;
  if (player.isPlaying) { player.pause(); videoPause(); updatePlayBtn(); return; }
  if (player.ctx.state === 'suspended') await player.ctx.resume();
  const bars = parseInt(els.countIn.value, 10) || 0;
  const beats = bars * metro.beatsPerBar;
  if (beats > 0) {
    const delay = metro.countIn(beats);
    els.playBtn.disabled = true;
    setTimeout(async () => {
      els.playBtn.disabled = false;
      await player.play();
      videoPlay();
      updatePlayBtn();
      startLoop();
    }, delay * 1000);
  } else {
    await player.play();
    videoPlay();
    updatePlayBtn();
    startLoop();
  }
}

// --- Wiring ---
els.openBtn.addEventListener('click', openFile);
els.openProjectBtn.addEventListener('click', () => openProject());
els.saveProjectBtn.addEventListener('click', saveProject);
els.exportMp3Btn.addEventListener('click', () => exportMedia('mp3'));
els.exportMp4Btn.addEventListener('click', () => exportMedia('video'));
els.volSlider.addEventListener('input', () => { state.volume = parseInt(els.volSlider.value, 10) / 100; applyVolume(); });
els.volReset.addEventListener('click', () => { state.volume = 1; applyVolume(); setStatus('volume a 100%'); });
els.normBtn.addEventListener('click', normalizeVolume);
els.autoNormBtn.addEventListener('click', () => {
  autoNorm = !autoNorm;
  try { localStorage.setItem('autoNormalize', autoNorm ? '1' : '0'); } catch {}
  updateAutoNormBtn();
  if (autoNorm && player.loaded) normalizeVolume();   // apply right away
  setStatus(autoNorm ? 'auto-normalizzazione attiva' : 'auto-normalizzazione disattivata');
});
els.octDown.addEventListener('click', () => setOctave(tunerOctave - 1));
els.octUp.addEventListener('click', () => setOctave(tunerOctave + 1));
els.tunerStop.addEventListener('click', () => { tuner.stop(); refreshTunerKeys(); });
els.tunerBeep.addEventListener('click', () => setTunerMode('beep'));
els.tunerPiano.addEventListener('click', () => setTunerMode('piano'));

// Enlarge the video to fullscreen (Esc or the button again exits).
els.videoExpand.addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else els.videoWrap.requestFullscreen().catch(() => {});
});
document.addEventListener('fullscreenchange', () => {
  const fs = document.fullscreenElement === els.videoWrap;
  els.videoExpand.textContent = fs ? '🗗' : '⛶';
  els.videoExpand.title = fs ? 'Riduci video' : 'Ingrandisci video (schermo intero)';
});
els.ytBtn.addEventListener('click', downloadYoutube);
els.separateBtn.addEventListener('click', separateStems);

els.setA.addEventListener('click', () => { loop.a = player.currentTime; if (loop.b != null && loop.b <= loop.a) loop.b = null; applyLoop(); });
els.setB.addEventListener('click', () => { loop.b = player.currentTime; if (loop.a != null && loop.a >= loop.b) loop.a = null; applyLoop(); });
els.loopToggle.addEventListener('click', () => { loop.on = !loop.on; applyLoop(); });
els.loopClear.addEventListener('click', () => { loop.a = loop.b = null; loop.on = false; applyLoop(); });
els.addMarker.addEventListener('click', addMarker);

els.metroToggle.addEventListener('click', async () => {
  if (player.ctx.state === 'suspended') await player.ctx.resume();
  metro.toggle();
  updateMetroBtn();
});
els.metroDown.addEventListener('click', () => { els.metroBpm.value = metro.setBpm(metro.bpm - 1); scheduleSave(); });
els.metroUp.addEventListener('click', () => { els.metroBpm.value = metro.setBpm(metro.bpm + 1); scheduleSave(); });
els.metroBpm.addEventListener('change', () => {
  els.metroBpm.value = metro.setBpm(parseInt(els.metroBpm.value, 10) || 120);
  scheduleSave();
});
els.metroTap.addEventListener('click', () => { els.metroBpm.value = Math.round(metro.tap()); scheduleSave(); });
els.metroSig.addEventListener('change', () => { metro.setBeatsPerBar(parseInt(els.metroSig.value, 10) || 4); scheduleSave(); });
els.countIn.addEventListener('change', scheduleSave);
els.metroHalf.addEventListener('click', () => { els.metroBpm.value = metro.setBpm(metro.bpm / 2); scheduleSave(); });
els.metroDouble.addEventListener('click', () => { els.metroBpm.value = metro.setBpm(metro.bpm * 2); scheduleSave(); });

// Manual fine tuning (cents) — coexists with the automatic suggestion.
els.fineDown.addEventListener('click', () => { state.fineCents--; applyPitch(); });
els.fineUp.addEventListener('click', () => { state.fineCents++; applyPitch(); });
els.fineSlider.addEventListener('input', () => { state.fineCents = parseInt(els.fineSlider.value, 10); applyPitch(); });
els.ytUrl.addEventListener('keydown', (e) => { if (e.key === 'Enter') downloadYoutube(); });
els.playBtn.addEventListener('click', togglePlay);

els.pitchDown.addEventListener('click', () => { state.semitones--; applyPitch(); });
els.pitchUp.addEventListener('click', () => { state.semitones++; applyPitch(); });
// Restore the original key: no transposition and no fine correction.
els.pitchReset.addEventListener('click', () => {
  state.semitones = 0; state.fineCents = 0; applyPitch();
  setStatus('tonalità originale ripristinata');
});
// One-shot: apply the detected tuning correction now.
els.tuningApply.addEventListener('click', () => {
  const corr = tuningCorrectionCents();
  if (corr == null) return;
  state.fineCents = corr; // bring toward A440
  applyPitch();
});
// Toggle automatic intonation correction on every loaded track.
els.tuningAuto.addEventListener('click', () => {
  autoTune = !autoTune;
  try { localStorage.setItem('autoTune', autoTune ? '1' : '0'); } catch {}
  updateTuningAutoBtn();
  if (autoTune) {
    const corr = tuningCorrectionCents();
    if (corr != null) { state.fineCents = corr; applyPitch(); }
  }
  setStatus(autoTune ? 'auto-intonazione attiva' : 'auto-intonazione disattivata');
});

els.speedDown.addEventListener('click', () => { state.speedPct--; applySpeed(); });
els.speedUp.addEventListener('click', () => { state.speedPct++; applySpeed(); });
els.speedSlider.addEventListener('input', () => { state.speedPct = parseInt(els.speedSlider.value, 10); applySpeed(); });
els.speedPresets.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-speed]');
  if (!b) return;
  state.speedPct = Math.round(parseFloat(b.dataset.speed) * 100);
  applySpeed();
});

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (!player.loaded) return;
  switch (e.code) {
    case 'Space': e.preventDefault(); togglePlay(); break;
    case 'KeyA': loop.a = player.currentTime; if (loop.b != null && loop.b <= loop.a) loop.b = null; applyLoop(); break;
    case 'KeyB': loop.b = player.currentTime; if (loop.a != null && loop.a >= loop.b) loop.a = null; applyLoop(); break;
    case 'KeyL': loop.on = !loop.on; applyLoop(); break;
    case 'KeyM': addMarker(); break;
    case 'ArrowLeft': player.seek(player.currentTime - 5); render(); break;
    case 'ArrowRight': player.seek(player.currentTime + 5); render(); break;
    case 'KeyZ': state.semitones--; applyPitch(); break;
    case 'KeyX': state.semitones++; applyPitch(); break;
    case 'Comma': state.speedPct--; applySpeed(); break;
    case 'Period': state.speedPct++; applySpeed(); break;
  }
});

// --- Drag & drop: drop an audio/video file for a new project, or a .ppx to open it ---
let dragDepth = 0;
function showDrop(on) { els.dropOverlay.style.display = on ? 'flex' : 'none'; }
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; showDrop(true); });
window.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
window.addEventListener('dragleave', (e) => { e.preventDefault(); dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) showDrop(false); });
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0; showDrop(false);
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (!file) return;
  let p = '';
  try { p = window.api.getPathForFile(file); } catch (err) { console.error('DROP_PATH_ERROR', err); }
  if (!p) { setStatus('impossibile leggere il file trascinato'); return; }
  if (/\.ppx$/i.test(p)) await openProject(p);
  else await loadPath(p);
});

// Dev/test: auto-load a file passed on the command line.
if (window.api.onAutoload) {
  window.api.onAutoload(async ({ filePath, autoplay, separate, looptest, metrotest }) => {
    window.__PP_LOOP = looptest;
    window.__PP_METRO = metrotest;
    console.log(`AUTOLOAD autoplay=${autoplay} separate=${separate} looptest=${looptest}`);
    if (/\.ppx$/i.test(filePath)) await openProject(filePath);
    else await loadPath(filePath);
    if (separate) await separateStems();
    if (autoplay) {
      state.semitones = 2; applyPitch();
      state.speedPct = 90; applySpeed();
      if (window.__PP_LOOP) { loop.a = 1.0; loop.b = 2.0; loop.on = true; applyLoop(); player.seek(1.0); }
      if (window.__PP_METRO) { metro.onClick = (t, acc) => console.log(`METROCLICK song=${player.currentTime.toFixed(3)} acc=${acc}`); metro.start(); }
      await togglePlay();
      let n = 0;
      const iv = setInterval(() => {
        console.log(`POS t=${player.currentTime.toFixed(2)} playing=${player.isPlaying}`);
        if (++n >= 10 || !player.isPlaying) clearInterval(iv);
      }, 350);
    }
  });
}

(async function init() {
  applyPitch();
  applySpeed();
  applyVolume();
  updateAutoNormBtn();
  updateTuningAutoBtn();
  els.metroBpm.value = metro.bpm;
  buildTuner();
  let savedTunerMode = 'beep';
  try { savedTunerMode = localStorage.getItem('tunerMode') || 'beep'; } catch {}
  setTunerMode(savedTunerMode);
  try {
    const v = await window.api.version();
    setStatus(`pronto · Electron ${v.electron}`);
  } catch {
    setStatus('pronto');
  }
})();
