# Sviluppo di Practice Player

Documento per chi vuole compilare, modificare o contribuire al codice. Per l'uso normale dell'app vedi il [README](README.md).

## Requisiti

- **Node.js** — testato con v24. Su Windows: [nodejs.org](https://nodejs.org/); su Linux/macOS: nvm / package manager di sistema.
- Sistema operativo qualsiasi supportato da Electron 33 (Windows 10/11 64-bit, macOS 11+, Linux x86-64).

## Setup e comandi

```sh
npm install
npm run fetch-binaries   # scarica ffmpeg + yt-dlp in bin/ (per il tuo OS; non versionati)
npm start                # build del renderer + avvio in dev
npm run build            # crea l'installer/AppImage/DMG per il tuo sistema in dist/ (senza pubblicare)
```

I binari nativi `ffmpeg` e `yt-dlp` **non sono nel repo** (ffmpeg supera il limite di 100 MB per file di GitHub): vengono scaricati da `scripts/fetch-binaries.mjs` — la versione giusta per il sistema (`.exe` su Windows, static build su Linux, universal su macOS), lo fa anche la CI. Su un checkout pulito, esegui `npm run fetch-binaries` prima di `npm start`/`build`.

Su Windows lo script scarica anche `vc_redist.x64.exe` in `build/`: `build/installer.nsh` lo bundla nell'installer NSIS e lo esegue in silent (solo se il runtime VC++ 2015-2022 x64 non è già presente) — serve a `onnxruntime-node`, che senza `vcruntime140.dll`/`msvcp140.dll` fallisce all'avvio su un Windows appena installato.

## Struttura

- `src/main/` — processo principale Electron: IPC, decodifica (`ffmpeg`), download (`yt-dlp`), separazione (`onnxruntime-node` + HT-Demucs ONNX), impostazioni.
- `src/renderer/app/` — UI + motore di riproduzione (sorgente, bundlata da esbuild).
- `src/renderer/worklet/engine-processor.js` — AudioWorklet con **rubberband-wasm** (time-stretch + pitch-shift real-time; usa due istanze Rubber Band in lockstep per bypassare il pitch sulla batteria).
- `bin/` — `ffmpeg` + `yt-dlp` (inclusi nell'app; `.exe` su Windows, static build su Linux, `bin/mac-{x64,arm64}/` su macOS).
- `scripts/` — build del renderer, fetch binari e test (`test-rubberband.mjs`, `test-tuning.mjs`, `test-separate.cjs`, `smoke-test-mac.sh`).

## Test rapidi

```sh
node scripts/test-rubberband.mjs        # verifica pitch/tempo (FFT)
node scripts/test-tuning.mjs            # verifica stima intonazione
node scripts/test-separate.cjs run <f>  # verifica separazione (richiede i modelli)
```

## Rilascio e aggiornamenti automatici

Il rilascio è automatico tramite **GitHub Actions** (`.github/workflows/release.yml`): a ogni **tag di versione** la CI (Windows + Ubuntu + macOS in parallelo) scarica i binari, compila l'installer Windows, l'AppImage Linux e i DMG macOS (Intel + Apple Silicon), e li pubblica in un'unica **GitHub Release** con i feed di aggiornamento (`latest.yml` per Windows, `latest-linux.yml` per Linux, `latest-mac.yml` per macOS).

Per pubblicare una nuova versione:

```sh
# 1. aggiorna il numero di versione in package.json (es. X.Y.Z)
# 2. crea e pusha il tag corrispondente (deve iniziare con "v")
git commit -am "Release X.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

L'app installata controlla il feed all'avvio (e ogni 6 ore): se c'è una versione più recente la **scarica in background** e mostra *Riavvia e aggiorna*; in ogni caso l'aggiornamento viene applicato alla chiusura. C'è anche un badge **v1.0.X** nella topbar che apre un popover con la versione installata, lo stato e i tasti **Controlla** / **Aggiorna e riavvia**. Il numero del tag (`vX.Y.Z`) deve combaciare con la versione in `package.json` (`X.Y.Z`). owner/repo del feed sono rilevati in automatico dal remote git.

## Licenza

Contribuendo al progetto accetti che il tuo codice venga rilasciato sotto la stessa licenza dell'app: **[GNU General Public License v3.0 o successiva](LICENSE)**.
