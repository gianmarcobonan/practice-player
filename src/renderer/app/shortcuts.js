// Declarative keyboard shortcut table — the single source of truth for the
// key handler, the help panel and the button tooltips, so they cannot drift
// apart. Entries hold metadata only: main.js maps `id` to the actual action.
//
// Each entry may list several key combos (e.g. "L" and "Ctrl+L" both toggle
// the loop). Combos match on `code` (layout independent, like the rest of the
// app) or on `key` when the character matters (e.g. "?").
//
//   needsSong: true  -> only fires with a song loaded
//   btn: '<element id>' -> the combo is appended to that button's tooltip
//   footer: { keys?, text } -> shown in the quick-reference bar at the bottom
//     (one chip may cover a pair, e.g. "Z/X tonalità −/+")

export const SHORTCUTS = [
  // --- File / progetto ---
  { id: 'newProject', group: 'File', label: 'Nuovo progetto', keys: [{ code: 'KeyN', ctrl: true }], btn: 'newProjectBtn' },
  { id: 'openFile', group: 'File', label: 'Apri brano', keys: [{ code: 'KeyO', ctrl: true }], btn: 'openBtn' },
  { id: 'openProject', group: 'File', label: 'Apri progetto', keys: [{ code: 'KeyO', ctrl: true, shift: true }], btn: 'openProjectBtn' },
  { id: 'saveProject', group: 'File', label: 'Salva progetto', keys: [{ code: 'KeyS', ctrl: true }], btn: 'saveProjectBtn' },
  { id: 'saveProjectAs', group: 'File', label: 'Salva con nome…', keys: [{ code: 'KeyS', ctrl: true, shift: true }], btn: 'saveProjectAsBtn' },

  // --- Esportazione ---
  { id: 'exportMp3', group: 'Esportazione', label: 'Esporta MP3', keys: [{ code: 'KeyE', ctrl: true }], btn: 'exportMp3Btn' },
  { id: 'exportMp4', group: 'Esportazione', label: 'Esporta MP4', keys: [{ code: 'KeyE', ctrl: true, shift: true }], btn: 'exportMp4Btn' },

  // --- Riproduzione ---
  { id: 'playPause', group: 'Riproduzione', label: 'Play / Pausa', keys: [{ code: 'Space' }], btn: 'playBtn', needsSong: true, footer: { text: 'play/pausa' } },
  { id: 'seekBack', group: 'Riproduzione', label: 'Indietro 5 s', keys: [{ code: 'ArrowLeft' }], needsSong: true, footer: { keys: '←/→', text: '±5 s' } },
  { id: 'seekFwd', group: 'Riproduzione', label: 'Avanti 5 s', keys: [{ code: 'ArrowRight' }], needsSong: true },
  { id: 'seekBack30', group: 'Riproduzione', label: 'Indietro 30 s', keys: [{ code: 'ArrowLeft', ctrl: true }], needsSong: true },
  { id: 'seekFwd30', group: 'Riproduzione', label: 'Avanti 30 s', keys: [{ code: 'ArrowRight', ctrl: true }], needsSong: true },

  // --- Loop e marker ---
  { id: 'loopA', group: 'Loop e marker', label: 'Imposta inizio loop (A)', keys: [{ code: 'KeyA' }], btn: 'setA', needsSong: true, footer: { keys: 'A/B', text: 'loop in/out' } },
  { id: 'loopB', group: 'Loop e marker', label: 'Imposta fine loop (B)', keys: [{ code: 'KeyB' }], btn: 'setB', needsSong: true },
  { id: 'loopToggle', group: 'Loop e marker', label: 'Attiva / disattiva loop', keys: [{ code: 'KeyL' }, { code: 'KeyL', ctrl: true }], btn: 'loopToggle', needsSong: true, footer: { keys: 'L', text: 'loop on/off' } },
  { id: 'addMarker', group: 'Loop e marker', label: 'Aggiungi marker', keys: [{ code: 'KeyM' }, { code: 'KeyK', ctrl: true }], btn: 'addMarker', needsSong: true, footer: { keys: 'M', text: 'marker' } },

  // --- Velocità e tonalità ---
  { id: 'pitchDown', group: 'Velocità e tonalità', label: 'Tonalità −1 semitono', keys: [{ code: 'KeyZ' }], needsSong: true, footer: { keys: 'Z/X', text: 'tonalità −/+' } },
  { id: 'pitchUp', group: 'Velocità e tonalità', label: 'Tonalità +1 semitono', keys: [{ code: 'KeyX' }], needsSong: true },
  { id: 'speedDown', group: 'Velocità e tonalità', label: 'Velocità −1%', keys: [{ code: 'Comma' }], needsSong: true, footer: { keys: ',/.', text: 'velocità −/+' } },
  { id: 'speedUp', group: 'Velocità e tonalità', label: 'Velocità +1%', keys: [{ code: 'Period' }], needsSong: true },
  { id: 'resetSpeedPitch', group: 'Velocità e tonalità', label: 'Ripristina velocità e tonalità', keys: [{ code: 'Digit0', ctrl: true }], needsSong: true },

  // --- Metronomo ---
  { id: 'metroToggle', group: 'Metronomo', label: 'Avvia / ferma il click', keys: [{ code: 'KeyM', ctrl: true }], btn: 'metroToggle', footer: { text: 'metronomo' } },
  { id: 'metroBpmDown', group: 'Metronomo', label: 'BPM −1', keys: [{ code: 'ArrowDown', ctrl: true }] },
  { id: 'metroBpmUp', group: 'Metronomo', label: 'BPM +1', keys: [{ code: 'ArrowUp', ctrl: true }] },
  { id: 'metroTap', group: 'Metronomo', label: 'Tap tempo', keys: [{ code: 'KeyT', ctrl: true }], btn: 'metroTap' },
  { id: 'metroVolDown', group: 'Metronomo', label: 'Volume click −5%', keys: [{ code: 'ArrowDown', ctrl: true, shift: true }] },
  { id: 'metroVolUp', group: 'Metronomo', label: 'Volume click +5%', keys: [{ code: 'ArrowUp', ctrl: true, shift: true }] },

  // --- Aiuto ---
  { id: 'help', group: 'Aiuto', label: 'Mostra le scorciatoie', keys: [{ code: 'F1' }, { key: '?' }], btn: 'helpBtn', footer: { text: 'tutte le scorciatoie' } }
];

// Human-readable key names for the help panel and tooltips.
const KEY_NAMES = {
  Space: 'Spazio',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
  Comma: ',', Period: '.'
};

function keyName(combo) {
  if (combo.key) return combo.key;
  const c = combo.code;
  if (KEY_NAMES[c]) return KEY_NAMES[c];
  if (c.startsWith('Key')) return c.slice(3);
  if (c.startsWith('Digit')) return c.slice(5);
  return c;
}

function oneCombo(combo) {
  const parts = [];
  if (combo.ctrl) parts.push('Ctrl');
  if (combo.shift) parts.push('Shift');
  if (combo.alt) parts.push('Alt');
  parts.push(keyName(combo));
  return parts.join('+');
}

// "Ctrl+Shift+S", or "L / Ctrl+L" when an entry has alternatives.
export function comboLabel(entry) {
  return entry.keys.map(oneCombo).join(' / ');
}

// Entries shown in the quick-reference bar, as { keys, text }.
export function footerItems(list = SHORTCUTS) {
  return list.filter((s) => s.footer)
    .map((s) => ({ keys: s.footer.keys || comboLabel(s), text: s.footer.text }));
}

function comboMatches(e, combo) {
  if (combo.key) {
    // Character combos already carry the shift state ("?" is Shift+' on an
    // Italian layout), so shift is not checked for them.
    if (e.key !== combo.key) return false;
  } else {
    if (e.code !== combo.code) return false;
    if (!!e.shiftKey !== !!combo.shift) return false;
  }
  // Treat Cmd as Ctrl so the shortcuts behave on macOS too.
  if (!!(e.ctrlKey || e.metaKey) !== !!combo.ctrl) return false;
  if (!!e.altKey !== !!combo.alt) return false;
  return true;
}

// Returns { entry, combo } for the first matching shortcut, or null.
export function matchShortcut(e, list = SHORTCUTS) {
  for (const entry of list) {
    for (const combo of entry.keys) {
      if (comboMatches(e, combo)) return { entry, combo };
    }
  }
  return null;
}
