# Practice Player

App per Windows per esercitarsi suonando: cambia **tonalità** e **velocità** in tempo reale
(indipendenti), separa le tracce in **stem**, riproduce **video tutorial** sincronizzati,
scarica **audio o audio+video** da **YouTube**, con **loop A/B**, **marker**,
**metronomo automatico**, suggerimento di **intonazione** e **memoria per brano**. Le sessioni
si possono salvare in un **file unico di progetto** (`.ppx`) che racchiude media + impostazioni.

## Installazione

Due modi:

- **Installer** `PracticePlayer-Setup-<versione>.exe` — installa per l'utente corrente (niente
  permessi admin), crea i collegamenti e **si aggiorna da solo** quando esce una nuova versione.
- **Portable** `PracticePlayer-<versione>-portable.exe` — nessuna installazione (anche da
  chiavetta), ma **non** si auto-aggiorna.

Entrambi si scaricano dalla pagina **Releases** del repository. L'exe non è firmato (uso
personale): Windows SmartScreen può avvisare al primo avvio → *Ulteriori informazioni → Esegui*.

## Uso (per chi usa l'app)

1. Avvia l'app (installer o portable).
2. **Apri brano** (mp3, m4a, wav, flac, ogg…) o **Apri progetto** (`.ppx`), oppure incolla un
   **link YouTube** e premi *Scarica* (chiede *solo audio* o *audio+video* per i video tutorial).
   Con *Salva progetto* esporti media + impostazioni in un unico file `.ppx`.
3. Controlli principali:
   - **Tonalità**: `− ½ tono` / `+ ½ tono` (la velocità non cambia).
   - **Velocità**: preset (−50%…+10%) o barra fine ±1% (la tonalità non cambia).
   - **Intonazione**: l'app stima di quanti cent il brano è stonato rispetto al LA 440 e lo
     suggerisce; premi *Applica* per correggere.
   - **Loop A/B**: imposta A e B, attiva *Loop* per ripetere una sezione.
   - **Marker**: aggiungi segnaposto e cliccali per saltare alle sezioni.
   - **Metronomo**: BPM con *TAP*, *count-in* prima del play (il click segue la velocità).
   - **Separa**: divide in voce/batteria/basso/altro; poi muto/solo/volume per ogni stem
     (es. muta la voce per il karaoke, o fai *solo* di uno strumento).
4. Le impostazioni (tonalità, velocità, loop, marker, ecc.) vengono **salvate per ogni brano**
   e i dati stanno nella cartella `data/` accanto all'eseguibile (funziona anche da chiavetta).

### Note importanti sulla separazione stem
- Al **primo uso** scarica il modello AI HT-Demucs (~630 MB) una sola volta in `data/models/`.
- Su **CPU** la separazione richiede **diversi minuti per brano** (es. ~5× la durata). Il
  risultato viene messo in **cache**, quindi la volta dopo è immediato.

### Scorciatoie
`Spazio` play/pausa · `Z`/`X` tonalità −/+ · `,`/`.` velocità −/+ · `A`/`B` loop in/out ·
`L` loop on/off · `M` marker · `←`/`→` ±5s

## Sviluppo

Richiede Node.js (testato con v24). Comandi:

```sh
npm install
npm run fetch-binaries   # scarica ffmpeg.exe + yt-dlp.exe in bin/ (non versionati)
npm start                # build del renderer + avvio in dev
npm run build            # crea installer NSIS + portable in dist/ (senza pubblicare)
```

I binari nativi `bin/ffmpeg.exe` e `bin/yt-dlp.exe` **non sono nel repo** (ffmpeg supera il
limite di 100 MB per file di GitHub): vengono scaricati da `scripts/fetch-binaries.mjs` (lo fa
anche la CI). Su un checkout pulito, esegui `npm run fetch-binaries` prima di `npm start`/`build`.

### Struttura
- `src/main/` — processo principale Electron: IPC, decodifica (`ffmpeg`), download
  (`yt-dlp`), separazione (`onnxruntime-node` + HT-Demucs ONNX), impostazioni.
- `src/renderer/app/` — UI + motore di riproduzione (sorgente, bundlata da esbuild).
- `src/renderer/worklet/engine-processor.js` — AudioWorklet con **rubberband-wasm**
  (time-stretch + pitch-shift real-time sul mix degli stem).
- `bin/` — `ffmpeg.exe`, `yt-dlp.exe` (inclusi nell'exe).
- `scripts/` — build del renderer e test (`test-rubberband.mjs`, `test-tuning.mjs`,
  `test-separate.cjs`).

### Test rapidi
```sh
node scripts/test-rubberband.mjs        # verifica pitch/tempo (FFT)
node scripts/test-tuning.mjs            # verifica stima intonazione
node scripts/test-separate.cjs run <f>  # verifica separazione (richiede i modelli)
```

## Rilascio e aggiornamenti automatici

Il rilascio è automatico tramite **GitHub Actions** (`.github/workflows/release.yml`): a ogni
**tag di versione** la CI scarica i binari, compila installer + portable e pubblica una
**GitHub Release** con i file e il feed di aggiornamento (`latest.yml`).

Per pubblicare una nuova versione:

```sh
# 1. aggiorna il numero di versione in package.json (es. 1.0.1)
# 2. crea e pusha il tag corrispondente (deve iniziare con "v")
git commit -am "Release 1.0.1"
git tag v1.0.1
git push origin main --tags
```

L'app installata controlla il feed all'avvio (e ogni 6 ore): se c'è una versione più recente la
**scarica in background** e mostra *Riavvia e aggiorna*; in ogni caso l'aggiornamento viene
applicato alla chiusura. Il numero del tag (`v1.0.1`) deve combaciare con la versione in
`package.json` (`1.0.1`). owner/repo del feed sono rilevati in automatico dal remote git.

## Note
- Il download da YouTube è pensato per uso personale; è tecnicamente contro i ToS di YouTube.
- L'exe non è firmato (uso personale): Windows SmartScreen potrebbe avvisare al primo avvio.
- Il portable **non** si auto-aggiorna; per gli aggiornamenti automatici usa l'installer.
