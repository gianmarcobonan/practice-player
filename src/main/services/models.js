'use strict';

// Registry of selectable stem-separation models. They all share the HT-Demucs
// ONNX I/O contract (input "mix" [1,2,343980] f32, output "stems" [1,S,2,343980]),
// so the chunked overlap-add pipeline in separate.js is the same for every one —
// only the sources, the model file(s) and single-vs-bag inference differ.
//
//   type: 'single' — one model whose output already has all S sources.
//   type: 'bag'    — several specialist models; from file i take its `pick` row.

const HF = 'https://huggingface.co/StemSplitio/';

const MODELS = [
  {
    id: 'htdemucs_6s',
    label: '6 stem — voce/batteria/basso/chitarra/piano/altro',
    note: 'Buona qualità, veloce. Include chitarra e piano.',
    sizeMB: 136,
    type: 'single',
    sources: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'],
    files: [{
      name: 'htdemucs_6s_fp16weights.onnx',
      url: HF + 'htdemucs-6s-onnx/resolve/main/htdemucs_6s_fp16weights.onnx',
      pick: null
    }]
  },
  {
    id: 'htdemucs_ft',
    label: '4 stem alta qualità — voce/batteria/basso/altro',
    note: 'Separazione migliore (modelli fine-tuned), ma più lento (~4×) e senza chitarra/piano. Scarica ~660 MB al primo uso.',
    sizeMB: 664,
    type: 'bag',
    sources: ['drums', 'bass', 'other', 'vocals'],
    files: [
      { name: 'htdemucs_ft_drums_fp16weights.onnx',  url: HF + 'htdemucs-ft-drums-onnx/resolve/main/htdemucs_ft_drums_fp16weights.onnx',   pick: 0 },
      { name: 'htdemucs_ft_bass_fp16weights.onnx',   url: HF + 'htdemucs-ft-bass-onnx/resolve/main/htdemucs_ft_bass_fp16weights.onnx',     pick: 1 },
      { name: 'htdemucs_ft_other_fp16weights.onnx',  url: HF + 'htdemucs-ft-other-onnx/resolve/main/htdemucs_ft_other_fp16weights.onnx',   pick: 2 },
      { name: 'htdemucs_ft_vocals_fp16weights.onnx', url: HF + 'htdemucs-ft-vocals-onnx/resolve/main/htdemucs_ft_vocals_fp16weights.onnx', pick: 3 }
    ]
  },
  {
    id: 'karaoke',
    label: 'Karaoke — voce / strumentale',
    note: 'Rimozione voce dedicata (specialista fine-tuned): solo 2 tracce (voce e strumentale) ma pulita e veloce. Scarica ~166 MB al primo uso.',
    sizeMB: 166,
    type: 'vocals-split',
    sources: ['vocals', 'instrumental'],
    files: [
      // The vocals specialist outputs [1,4,2,N]; take its vocals row (3). The
      // instrumental is derived as (mix - vocals) in separate.js.
      { name: 'htdemucs_ft_vocals_fp16weights.onnx', url: HF + 'htdemucs-ft-vocals-onnx/resolve/main/htdemucs_ft_vocals_fp16weights.onnx', pick: 3 }
    ]
  }
];

const DEFAULT_MODEL = 'htdemucs_6s';

function getModel(id) {
  return MODELS.find((m) => m.id === id) || MODELS.find((m) => m.id === DEFAULT_MODEL);
}

// Lightweight list for the renderer's model picker (no URLs).
function publicList() {
  return MODELS.map((m) => ({ id: m.id, label: m.label, note: m.note, sizeMB: m.sizeMB, sources: m.sources }));
}

module.exports = { MODELS, DEFAULT_MODEL, getModel, publicList };
