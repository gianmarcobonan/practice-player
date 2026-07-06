## 🎸 Practice Player %VERSION%

### 📥 Scarica per il tuo sistema

| Sistema | Architettura | Download | Auto-update |
| --- | --- | --- | :-: |
| 🪟 **Windows** 10/11 | x86-64 | [PracticePlayer-Setup-%VERSION%.exe](https://github.com/gianmarcobonan/practice-player/releases/download/v%VERSION%/PracticePlayer-Setup-%VERSION%.exe) | ✅ |
| 🍎 **macOS** 11+ | Apple Silicon (M1/M2/M3/M4) | [PracticePlayer-%VERSION%-arm64.dmg](https://github.com/gianmarcobonan/practice-player/releases/download/v%VERSION%/PracticePlayer-%VERSION%-arm64.dmg) | ❌ |
| 🍎 **macOS** 10.15+ | Intel (x86-64) | [PracticePlayer-%VERSION%-x64.dmg](https://github.com/gianmarcobonan/practice-player/releases/download/v%VERSION%/PracticePlayer-%VERSION%-x64.dmg) | ❌ |
| 🐧 **Linux** | x86-64 | [PracticePlayer-%VERSION%.AppImage](https://github.com/gianmarcobonan/practice-player/releases/download/v%VERSION%/PracticePlayer-%VERSION%.AppImage) | ✅ |

Se preferisci vedere tutti gli asset, scorri in fondo alla pagina.

### ▶️ Avvio

**Windows** — l'app non è firmata digitalmente (progetto personale), quindi Windows può mostrare la schermata blu **"Windows ha protetto il PC"**. È normale:

1. Clicca **Ulteriori informazioni**
2. Clicca **Esegui comunque**

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
