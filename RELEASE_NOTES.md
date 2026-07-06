## 🎸 Practice Player — come scaricare e installare

Scarica il file per il tuo sistema dalla sezione **Assets** ⬇️

| Sistema | File | Cos'è | Si auto-aggiorna? |
|---------|------|-------|:-----------------:|
| **Windows** | **`PracticePlayer-Setup-*.exe`** | Installer per l'utente corrente (nessun permesso admin), crea i collegamenti nel menu Start e sul desktop | ✅ Sì |
| **Linux** | **`PracticePlayer-*.AppImage`** | Applicazione portatile: un singolo file, nessuna installazione | ✅ Sì |
| **macOS Apple Silicon** (M1/M2/M3/M4) | **`PracticePlayer-*-arm64.dmg`** | Immagine disco: apri, trascina l'app in *Applicazioni* | ❌ No |
| **macOS Intel** | **`PracticePlayer-*-x64.dmg`** | Immagine disco per Mac Intel | ❌ No |

### 💻 Requisiti
- **Windows** 10 o 11 (64-bit), **Linux** a 64-bit (x86-64), o **macOS 10.12+**

### ▶️ Avvio

**Windows** — l'app non è firmata digitalmente (progetto personale), quindi Windows può mostrare la schermata blu **"Windows ha protetto il PC"**. È normale:
1. Clicca **Ulteriori informazioni** → 2. Clicca **Esegui comunque**

**Linux** — rendi eseguibile l'AppImage e lancialo:
```bash
chmod +x PracticePlayer-*.AppImage
./PracticePlayer-*.AppImage
```
(oppure: tasto destro → *Proprietà* → *Permessi* → spunta *Consenti esecuzione*)

**macOS** — nemmeno il DMG è firmato, quindi al primo avvio Gatekeeper mostrerà *«L'app non può essere aperta perché lo sviluppatore non può essere verificato»*. Per aprirla:
1. **Trascina l'app in Applicazioni** (dalla finestra del DMG)
2. Nel Finder → *Applicazioni*, **tasto destro sull'app → Apri** → conferma **Apri**
3. Da lì in avanti si apre normalmente col doppio click

### 🔄 Aggiornamenti automatici
Le versioni **Windows** e **Linux** controllano gli aggiornamenti all'avvio e ogni 6 ore: quando esce una versione nuova la scaricano in background e mostrano il pulsante **"Riavvia e aggiorna"**.
Su **macOS** l'aggiornamento è manuale: scarica il DMG della nuova versione da questa pagina.
