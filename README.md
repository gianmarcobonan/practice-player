# Practice Player

[![Ultima release](https://img.shields.io/github/v/release/gianmarcobonan/practice-player?label=scarica&style=for-the-badge)](https://github.com/gianmarcobonan/practice-player/releases/latest)
[![Download totali](https://img.shields.io/github/downloads/gianmarcobonan/practice-player/total?label=download&style=for-the-badge&color=blueviolet)](https://github.com/gianmarcobonan/practice-player/releases)
[![Licenza GPL v3](https://img.shields.io/badge/licenza-GPL_v3-blue?style=for-the-badge)](LICENSE)
![Windows](https://img.shields.io/badge/Windows-10%2F11%2064--bit-blue?style=for-the-badge&logo=windows)
![macOS](https://img.shields.io/badge/macOS-Intel_%2B_Apple_Silicon-000?style=for-the-badge&logo=apple)
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
   *Salva progetto* racchiude media (+ eventuali **stem** separati) + impostazioni in un unico file
   `.ppx`: se il progetto è già stato salvato (o aperto da `.ppx`) **sovrascrive** quel file senza
   chiedere, mentre *Salva con nome…* crea sempre un nuovo `.ppx` e ci si sposta sopra.
3. Controlli principali:
   - **Tonalità**: `− ½ tono` / `+ ½ tono` (la velocità non cambia).
   - **Velocità**: preset (−50%…+10%) o barra fine ±1% (la tonalità non cambia).
   - **Intonazione**: l'app stima di quanti cent il brano è stonato rispetto al LA 440 e lo
     suggerisce; premi *Applica* per correggere.
   - **Loop A/B**: imposta A e B, attiva *Loop* per ripetere una sezione.
   - **Marker**: aggiungi segnaposto e cliccali per saltare alle sezioni.
   - **Metronomo**: BPM con *TAP*, **metrica** selezionabile (2/4, 3/4, 4/4, 5/4, 6/8, 7/8 — con
     accento sul primo battito) e *count-in* in battute prima del play (il click segue la velocità).
   - **Separa**: scegli il **Modello** dal menu e dividi il brano in stem; poi muto/solo/volume
     per ogni stem (es. muta la voce per il karaoke, o fai *solo* di uno strumento). Modelli:
     **6 stem** (voce/batteria/basso/chitarra/piano/altro — veloce), **4 stem alta qualità**
     (htdemucs_ft — separazione migliore, più lento, senza chitarra/piano), o **Karaoke**
     (voce/strumentale — rimozione voce dedicata, veloce, 2 tracce). Puoi **cambiare modello e
     ripremere Separa** quando vuoi: ogni modello ha la sua cache, quindi tornare a uno già usato
     è immediato.
4. Le impostazioni (tonalità, velocità, loop, marker, ecc.) vengono **salvate per ogni brano**;
   i dati (impostazioni, cache degli stem e modello AI) stanno nel profilo utente
   (`%APPDATA%\Practice Player` su Windows, `~/.config/Practice Player` su Linux) e **restano
   anche dopo un aggiornamento** (il modello si scarica una sola volta).

### Note importanti sulla separazione stem
- Al **primo uso di ciascun modello** ne scarica i pesi una sola volta (6 stem ~136 MB; 4 stem
  alta qualità ~660 MB) — restano nel profilo utente (vedi sopra), quindi non vengono più
  riscaricati nemmeno dopo un aggiornamento. Ogni modello ha la sua cache separata.
- Su **CPU** la separazione richiede **diversi minuti per brano** (es. ~5× la durata). Il
  risultato viene messo in **cache** (indicizzata sul contenuto del brano), quindi la volta dopo
  è immediato.
- Se **salvi un progetto** con gli stem separati (es. voce mutata), gli stem vengono **inclusi nel
  file `.ppx`** (compressi in Opus ~192 kbps, pochi MB). Il progetto è così **completamente
  portable**: riaprendolo — anche su un altro PC — gli stem e il loro stato tornano **subito**,
  senza doverli riseparare. (Per un progetto video, il `.ppx` contiene già anche il video.)

### Scorciatoie
`Spazio` play/pausa · `Z`/`X` tonalità −/+ · `,`/`.` velocità −/+ · `A`/`B` loop in/out ·
`L` loop on/off · `M` marker · `←`/`→` ±5s

## Note
- I progetti `.ppx` si aprono con **doppio click**: l'installer Windows registra l'estensione
  (su Linux dipende dall'integrazione dell'AppImage nel sistema). Se l'app è già aperta, il file
  viene caricato nella finestra esistente.
- Il download da YouTube è pensato per **uso personale** (materiale di cui hai i diritti, contenuti in pubblico dominio o Creative Commons). È **tuo il responsabile** del rispetto dei ToS di YouTube e delle leggi sul copyright del tuo paese — vedi [DISCLAIMER.md](DISCLAIMER.md).
- L'app non è firmata (uso personale): su Windows SmartScreen potrebbe avvisare al primo avvio.
- Su Linux l'`.AppImage` va reso eseguibile (`chmod +x`) prima del primo avvio.

## Contribuire

Per compilare da sorgente, modificare il codice o proporre PR vedi **[DEVELOPMENT.md](DEVELOPMENT.md)** (setup, struttura, test, procedura di release).

## Licenza

Practice Player è rilasciato sotto la **[GNU General Public License v3.0 o successiva](LICENSE)** (GPL-3.0-or-later). In sostanza: puoi usarlo, studiarlo, modificarlo e ridistribuirlo (anche commercialmente), a patto di rilasciare le versioni derivate sotto la stessa licenza e mantenere il codice sorgente disponibile.

Copyright © 2026 Gianmarco Bonan.

L'app include (o si integra con) le seguenti librerie/tool di terze parti, ciascuno con la propria licenza:

| Componente | Licenza | Uso |
| --- | --- | --- |
| [Rubber Band Library](https://breakfastquay.com/rubberband/) (via `rubberband-wasm`) | GPL v2+ | pitch/tempo real-time |
| [FFmpeg](https://ffmpeg.org/) (build "essentials" con x264) | GPL v2+ | decodifica media, export MP3/MP4 |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Unlicense (dominio pubblico) | download da YouTube |
| [Demucs / HT-Demucs](https://github.com/facebookresearch/demucs) (modelli ONNX) | MIT | separazione stem |
| [ONNX Runtime](https://onnxruntime.ai/) | MIT | esecuzione modelli AI |
| [Electron](https://www.electronjs.org/) | MIT | runtime desktop |
| [fft.js](https://github.com/indutny/fft.js) | MIT | analisi accordi/tuning |
| [esbuild](https://esbuild.github.io/) | MIT | build del renderer |

La scelta della GPL v3 è dovuta principalmente a Rubber Band e FFmpeg (entrambi GPL): la licenza dell'app deve essere compatibile con quella delle dipendenze.
