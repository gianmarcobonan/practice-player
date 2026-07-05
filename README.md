# Practice Player

[![Ultima release](https://img.shields.io/github/v/release/gianmarcobonan/practice-player?label=scarica&style=for-the-badge)](https://github.com/gianmarcobonan/practice-player/releases/latest)
![Windows](https://img.shields.io/badge/Windows-10%2F11%2064--bit-blue?style=for-the-badge&logo=windows)
![Linux](https://img.shields.io/badge/Linux-x86--64-333?style=for-the-badge&logo=linux&logoColor=white)

App per esercitarsi suonando: cambia **tonalità** e **velocità** in tempo reale
(indipendenti), separa le tracce in **stem**, riproduce **video tutorial** sincronizzati,
scarica **audio o audio+video** da **YouTube**, con **loop A/B**, **marker**,
**metronomo automatico**, suggerimento di **intonazione** e **memoria per brano**. Le sessioni
si possono salvare in un **file unico di progetto** (`.ppx`) che racchiude media + impostazioni.

> ### 📥 [**Scarica l'ultima versione**](https://github.com/gianmarcobonan/practice-player/releases/latest)
> **Windows** (installer `.exe`) o **Linux** (`.AppImage`) — 64-bit. Entrambe si auto-aggiornano.

## Installazione

Scarica dalla pagina **[Releases](https://github.com/gianmarcobonan/practice-player/releases/latest)**:

- **Windows** — `PracticePlayer-Setup-<versione>.exe`: installer per l'utente corrente (niente
  permessi admin), crea i collegamenti e **si aggiorna da solo**. L'exe non è firmato (uso
  personale): SmartScreen può avvisare al primo avvio → *Ulteriori informazioni → Esegui comunque*.
- **Linux** — `PracticePlayer-<versione>.AppImage`: singolo file, nessuna installazione, **si
  aggiorna da solo**. Rendilo eseguibile e lancialo:
  `chmod +x PracticePlayer-*.AppImage && ./PracticePlayer-*.AppImage`.

## Uso (per chi usa l'app)

1. Avvia l'app (installer Windows o AppImage Linux).
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
   - **Separa**: divide in 6 stem (voce/batteria/basso/chitarra/piano/altro); poi muto/solo/volume
     per ogni stem (es. muta la voce per il karaoke, o fai *solo* di uno strumento).
4. Le impostazioni (tonalità, velocità, loop, marker, ecc.) vengono **salvate per ogni brano**;
   i dati (impostazioni, cache degli stem e modello AI) stanno nel profilo utente
   (`%APPDATA%\Practice Player` su Windows, `~/.config/Practice Player` su Linux) e **restano
   anche dopo un aggiornamento** (il modello si scarica una sola volta).

### Note importanti sulla separazione stem
- Al **primo uso** scarica il modello AI HT-Demucs 6 stem (~136 MB) una sola volta; resta nel
  profilo utente (vedi sopra), quindi non viene più riscaricato nemmeno dopo un aggiornamento.
- Su **CPU** la separazione richiede **diversi minuti per brano** (es. ~5× la durata). Il
  risultato viene messo in **cache**, quindi la volta dopo è immediato.

### Scorciatoie
`Spazio` play/pausa · `Z`/`X` tonalità −/+ · `,`/`.` velocità −/+ · `A`/`B` loop in/out ·
`L` loop on/off · `M` marker · `←`/`→` ±5s

## Sviluppo

Richiede Node.js (testato con v24). Comandi:

```sh
npm install
npm run fetch-binaries   # scarica ffmpeg + yt-dlp in bin/ (per il tuo OS; non versionati)
npm start                # build del renderer + avvio in dev
npm run build            # crea l'installer/AppImage per il tuo sistema in dist/ (senza pubblicare)
```

I binari nativi `ffmpeg` e `yt-dlp` **non sono nel repo** (ffmpeg supera il limite di 100 MB
per file di GitHub): vengono scaricati da `scripts/fetch-binaries.mjs` — la versione giusta per
il sistema (`.exe` su Windows, static build su Linux), lo fa anche la CI. Su un checkout pulito,
esegui `npm run fetch-binaries` prima di `npm start`/`build`.

### Struttura
- `src/main/` — processo principale Electron: IPC, decodifica (`ffmpeg`), download
  (`yt-dlp`), separazione (`onnxruntime-node` + HT-Demucs ONNX), impostazioni.
- `src/renderer/app/` — UI + motore di riproduzione (sorgente, bundlata da esbuild).
- `src/renderer/worklet/engine-processor.js` — AudioWorklet con **rubberband-wasm**
  (time-stretch + pitch-shift real-time sul mix degli stem).
- `bin/` — `ffmpeg` + `yt-dlp` (inclusi nell'app; `.exe` su Windows, static build su Linux).
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
**tag di versione** la CI (Windows + Ubuntu in parallelo) scarica i binari, compila l'installer
Windows e l'AppImage Linux e li pubblica in un'unica **GitHub Release** con i feed di
aggiornamento (`latest.yml` per Windows, `latest-linux.yml` per Linux).

Per pubblicare una nuova versione:

```sh
# 1. aggiorna il numero di versione in package.json (es. 1.0.2)
# 2. crea e pusha il tag corrispondente (deve iniziare con "v")
git commit -am "Release 1.0.2"
git tag v1.0.2
git push origin main --tags
```

L'app installata controlla il feed all'avvio (e ogni 6 ore): se c'è una versione più recente la
**scarica in background** e mostra *Riavvia e aggiorna*; in ogni caso l'aggiornamento viene
applicato alla chiusura. Il numero del tag (`v1.0.2`) deve combaciare con la versione in
`package.json` (`1.0.2`). owner/repo del feed sono rilevati in automatico dal remote git.

## Note
- Il download da YouTube è pensato per uso personale; è tecnicamente contro i ToS di YouTube.
- L'app non è firmata (uso personale): su Windows SmartScreen potrebbe avvisare al primo avvio.
- Su Linux l'`.AppImage` va reso eseguibile (`chmod +x`) prima del primo avvio.
