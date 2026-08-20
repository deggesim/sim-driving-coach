# Comando vocale "Acquisisci setup"

Data: 2026-08-19

## Contesto e problema

Il caricamento del setup è oggi l'unica operazione di sessione che **non** ha una
strada vocale. Aprire e chiudere una sessione, chiedere un'analisi e porre una
domanda libera si fanno tutti a voce (`classifyVoiceIntent` → `coach:voiceQuery`);
il setup richiede invece mouse e tastiera in tutti e tre i giochi:

- **R3E** — `R3eSetupPicker`: incolla a mano il JSON esportato da RaceRoom
  (CTRL+C nella schermata setup) in una textarea, poi "Analizza JSON", poi digita
  il nome.
- **ACE** — `AceSetupPicker`: tre tendine (auto → tracciato → file) e conferma.
- **AMS2** — `Ams2SetupPicker`: selezione delle schermate dalla griglia dei
  thumbnail, invio a Claude Vision, poi il nome.

Il momento in cui serve caricare un setup è però esattamente quello in cui le
mani non sono libere: appena uscito dal box, con il sim in primo piano. La stessa
ragione per cui `InputManager` usa un hook `WH_KEYBOARD_LL` invece di
`globalShortcut` (Windows non consegna un hotkey mentre il sim tiene il
foreground) vale qui: il vocale è l'unica interfaccia raggiungibile in pista.

Un secondo problema, minore ma bloccante per l'implementazione: la logica delle
tre acquisizioni non è dove servirebbe.

- Il parsing del JSON R3E (`parseR3EJson`, `categorize`, `idToLabel`,
  `formatValue`) vive dentro il componente React `R3eSetupPicker.tsx`, quindi il
  main process non può usarlo.
- La decodifica Vision AMS2 (~130 righe, system prompt incluso) e la risoluzione
  della cartella screenshot Steam sono chiusure dentro
  `ipcMain.handle("setup:decodeSetup")` in `main.ts`.
- La INSERT del setup e il push `session:setupLoaded` sono chiusi dentro
  `ipcMain.handle("session:loadSetup")`.

## Requisiti

1. Quattro trigger vocali equivalenti avviano l'acquisizione: **"acquisisci
   setup"**, **"carica setup"**, **"preleva setup"**, **"nuovo setup"**. Sono
   quattro modi di attivare la stessa funzionalità, non quattro varianti.
2. Il gioco su cui acquisire è quello della sessione aperta. Senza sessione
   aperta il comando non fa nulla e lo dice: i setup sono righe
   `session_setups_*` con FK alla sessione, senza sessione non c'è dove
   scriverli.
3. **R3E** — legge la clipboard. Se contiene un setup valido lo acquisisce
   chiedendone il nome a voce; altrimenti: _"Nessun setup presente nella
   clipboard."_
4. **ACE** — decodifica l'ultimo setup salvato per la combinazione
   auto/tracciato della sessione, in ordine cronologico decrescente, e lo salva
   col nome del file annunciando _"Setup salvato con nome `<nome_file>`."_ Se la
   cartella non ha setup o la decodifica fallisce: _"Setup non presente per la
   combinazione auto tracciato, o errore nella decodifica."_
5. **AMS2** — prende i 3 screenshot più recenti in ordine cronologico
   decrescente, li acquisisce e chiede il nome a voce; altrimenti: _"Nessuno
   screenshot da acquisire o errore nella scansione."_
6. Il setup acquisito diventa quello attivo (`activate: true`): i giri successivi
   si taggano con esso, come già fa la UI.
7. Il nome viene chiesto e raccolto **solo a voce**, senza aprire alcuna finestra.
8. L'acquisizione è visibile nella UI senza ricaricare nulla.
9. Il riconoscimento dei trigger è verificabile senza simulatore né microfono
   (selfcheck).

## Design

### Flusso complessivo

```
"Acquisisci setup"  →  classifyVoiceIntent → { kind: "acquireSetup" }
                             │
                    currentSessionId? ─── no ──→ "Non c'è nessuna sessione aperta."
                             │ sì
              ┌──────────────┼───────────────────┐
             R3E            ACE                 AMS2
   clipboard.readText()  ultimo .carsetup   3 screenshot più
   → parseR3eSetupJson   per mtime desc     recenti per mtime
              │          → decodeCarSetup   → decodeAms2Setup (Vision)
       chiedi nome ◄─┐         │                    │
       (listenAgain) │    nome = filename      chiedi nome ─┘
              └──────┴─────────┼───────────────────┘
                          insertSetup(activate: true)
                          → session:setupLoaded → UI aggiornata
                          → "Setup salvato con nome <nome>."
```

I tre percorsi divergono solo nel **procurarsi** un `SetupData`; da lì in poi
condividono un unico punto di scrittura. Nessuna delle tre strade duplica la
INSERT, quindi non c'è una seconda scrittura del setup da tenere in sincronia con
`session:loadSetup`.

### 1. `voice-intent.ts` — nuovo intent `acquireSetup`

```ts
export type VoiceIntent =
  | { kind: "newSession"; game: GameSource | null }
  | { kind: "closeSession" }
  | { kind: "analyze" }
  | { kind: "acquireSetup" }        // nuovo
  | { kind: "greeting" }
  | { kind: "freeform"; question: string };
```

Il ramo entra in `classifyCommand`, che riceve già il testo normalizzato
(minuscolo, senza punteggiatura, spazi collassati):

```ts
const hasSetup = /\bset ?up\b/.test(s);
if (
  hasSetup &&
  /\b(acquisisci|acquisire|acquisisce|carica|caricare|caricami|preleva|prelevare|nuovo|nuova)\b/.test(s)
)
  return { kind: "acquireSetup" };
```

Due dettagli non ovvi:

- `set ?up` e non `setup`: Azure STT scrive il prestito inglese in entrambi i
  modi, imprevedibilmente, esattamente come già fa con gli acronimi ("R.3.E.",
  "ams 2") — è il motivo per cui `normalize` esiste.
- Le varianti coniugate (`acquisire`/`acquisisce`, `caricare`/`caricami`,
  `prelevare`) costano una parola di regex a testa e coprono le riformulazioni
  spontanee. `nuovo|nuova` copre "nuovo setup" con l'articolo o senza.

Nessuna collisione con gli intent esistenti: `newSession` e `closeSession`
richiedono entrambi `/\bsession/`, e `analyze` cerca `analizza|analisi|valuta…`.
Il ramo va **dopo** quelli di sessione, così "nuova sessione" non viene mai letto
come "nuovo setup" nemmeno se una frase nominasse entrambi.

L'intent non porta il gioco (a differenza di `newSession`): il gioco è quello
della sessione aperta, e senza sessione il comando non ha senso.

### 2. `src/shared/r3e-setup-parse.ts` — estrazione dal componente React

Il parsing esce da `R3eSetupPicker.tsx` e va in `shared/` perché ha due
consumatori su lati opposti dell'IPC: il renderer (JSON incollato a mano) e il
main (JSON dalla clipboard). Stesso criterio di `preprocessTTSText` in
`shared/format.ts`, condiviso fra Azure TTS nel main e il fallback Web Speech nel
renderer.

```ts
export type R3ESetupItem = { … };                     // era locale al componente
export const parseR3eSetupJson = (text: string): SetupParam[] => { … };
```

Sposta senza modificare: `R3ESetupItem`, `categorize`, `idToLabel`,
`TYRE_COMPOUNDS`, `formatValue`, `parseR3EJson` (rinominata
`parseR3eSetupJson`, coerente con la convenzione `r3e` minuscolo del resto del
codebase). Il componente perde ~80 righe e importa la funzione. La `throw` su
`values` mancante resta: è il modo in cui entrambi i chiamanti distinguono un
JSON di setup da un qualunque altro testo nella clipboard.

Nuovo `r3e-setup-parse.selfcheck.ts`: il brake bias formattato `front/rear%`, il
filtro sugli item `disabled`, la mappa dei compound, e il throw su JSON senza
`values`. Oggi questa aritmetica non ha alcun test.

### 3. `src/main/ams2/ams2-setup-vision.ts` — estrazione da `main.ts`

Tre funzioni, tutte già scritte come chiusure dentro `main.ts`:

```ts
export const resolveAms2ScreenshotsDir = (): string | null => { … };
export const listAms2Screenshots = (dir: string): Array<{ name: string; mtimeMs: number }> => { … };
export const decodeAms2Setup = (params: {
  filenames: string[];
  expectedCar: string;
  apiKey: string;
}): Promise<SetupData> => { … };
```

`decodeAms2Setup` porta con sé il system prompt Vision e la validazione della
risposta (blocco `text` esplicito, match del JSON, parse guardato) senza
modifiche: è la parte del codice che non si vuole duplicare per il percorso
vocale. Mantiene anche il controllo `path.basename(name) !== name`, che impedisce
a un nome file di uscire dalla cartella screenshot.

`listAms2Screenshots` restituisce nome + `mtimeMs` e **niente thumbnail**: il
percorso vocale ha bisogno dei 3 nomi più recenti, non di ~50 immagini in base64.
L'handler `setup:listScreenshots` continua a costruire thumbnail e annotazioni
`alreadyUsed` sopra questo elenco, quindi la UI non cambia comportamento.

L'ordinamento è per `mtimeMs` decrescente, non per nome: il requisito parla di
ordine cronologico, e i due coincidono solo finché Steam mantiene i nomi
timestampati.

### 4. `main.ts` — `insertSetup()` e `listAceSetupFiles()`

**`insertSetup({ setup, sessionId, game, activate })`** — la INSERT in
`session_setups_*`, l'avanzamento di `currentSetupId` e il push
`session:setupLoaded` estratti dall'handler `session:loadSetup`, che diventa un
wrapper con la sola validazione "nessuna sessione attiva". Il requisito 8 (UI
aggiornata) si soddisfa da sé: il push esisteva già, cambia solo chi lo chiama.

**`listAceSetupFiles(car, track)`** — la lettura della directory
`{aceSetupsBase}\{car}\{track}` estratta da `ace:listSetupFiles`, che la delega.
Restituisce `AceSetupFileInfo[]` con `modifiedAt` come oggi. La UI continua a
ordinare per nome; il percorso vocale prende `toSorted` per `modifiedAt`
decrescente e ne usa il primo. Un helper, due ordinamenti — nessuno dei due
tocca il comportamento dell'altro.

### 5. `main.ts` — `acquireSetupByVoice(game)` e la domanda sul nome

Il nome viene chiesto con il meccanismo che già serve la domanda "Quale gioco?":
`speakText(…, { listenAgain: true })` fa riarmare il microfono a `useVoiceCoach`
alla fine della riproduzione, e il transcript successivo va consumato come
risposta invece di essere riclassificato.

```ts
let pendingSetup: SetupData | null = null;
let pendingSetupAt = 0;
```

`PENDING_GAME_TTL_MS` viene rinominata `PENDING_ANSWER_TTL_MS` (60 s, valore
invariato, due usi) e governa entrambe le attese, per la stessa ragione: una
risposta che non arriva entro il TTL va trattata come assente, invece di divorare
un comando successivo e slegato. Il nome vecchio, applicato all'attesa del nome
di un setup, mentirebbe.

In testa a `coach:voiceQuery`, prima della classificazione e in simmetria col
blocco `pendingGame` già presente:

```ts
if (pendingSetup && Date.now() - pendingSetupAt < PENDING_ANSWER_TTL_MS) {
  const setup = pendingSetup;
  pendingSetup = null;
  const name = question.trim();
  if (!name || isCancelWord(name)) {
    await speakText("Acquisizione annullata.");
    return;
  }
  insertSetup({ setup: { ...setup, name }, activate: true });
  await speakText(confirmMessage(setup, name));
  return;
}
pendingSetup = null;
```

La parola di annullamento (`annulla`, `lascia stare`, `niente`) è l'unica
aggiunta rispetto alla specifica: senza di essa uno STT confuso persiste una riga
`session_setups_*` con un nome-spazzatura, e la sola via d'uscita diventa
cancellare il setup dalla UI. Costa tre parole di regex.

I tre acquirer, ognuno con il messaggio d'errore della specifica:

```ts
const acquireSetupByVoice = async (game: GameSource): Promise<void> => {
  if (game === "r3e") {
    // clipboard.readText() → parseR3eSetupJson, throw → messaggio clipboard
  } else if (game === "ace") {
    // listAceSetupFiles(currentCar, currentTrack) → più recente per mtime
    // → decodeCarSetup → nome = filename senza .carsetup → salva subito
  } else {
    // resolveAms2ScreenshotsDir + listAms2Screenshots → i 3 più recenti
    // → decodeAms2Setup → chiedi nome
  }
};
```

Per ACE i nomi di cartella sono gli id stringa che l'auto e il tracciato hanno
nella SHM (`ks_porsche_718_gt4`, `monza`): `AceSetupPicker` usa già
`expectedCar`/`expectedTrack` per preselezionare le tendine, quindi
`currentCar`/`currentTrack` sono direttamente utilizzabili come path.

`carFound` prende il nome risolto dell'auto della sessione (`resolveNames`, come
in `openSessionByVoice`) e `carVerified` vale `true` per R3E e ACE: il setup
viene dalla macchina in uso, non c'è nulla da verificare. Per AMS2 arriva da
Vision, e quando torna `carVerified: false` la conferma diventa _"Setup salvato
con nome X. Attenzione, l'auto rilevata è `<carFound>`."_ — il dato esiste già,
scartarlo silenziosamente sarebbe peggio che dirlo.

### Messaggi vocali

| Caso | Messaggio |
| --- | --- |
| Nessuna sessione aperta | "Non c'è nessuna sessione aperta." |
| R3E, clipboard vuota o JSON non valido | "Nessun setup presente nella clipboard." |
| ACE, nessun file o decodifica fallita | "Setup non presente per la combinazione auto tracciato, o errore nella decodifica." |
| AMS2, nessuno screenshot o scansione fallita | "Nessuno screenshot da acquisire o errore nella scansione." |
| AMS2 senza API key | "API Key Anthropic non configurata." |
| Richiesta del nome (R3E, AMS2) | "Come vuoi chiamare il setup?" — con `listenAgain: true` |
| Nome non pronunciato o annullato | "Acquisizione annullata." |
| Successo | "Setup salvato con nome `<nome>`." |

## Gestione errori

Ogni acquirer avvolge la propria I/O e collassa qualunque fallimento nel
messaggio della specifica per quel gioco: clipboard illeggibile e JSON malformato
danno la stessa frase, perché per chi guida sono lo stesso problema ("non c'è un
setup da prendere"). Il dettaglio tecnico va su `console.error`, come fa già il
resto di `coach:voiceQuery`.

La latenza AMS2 è l'unica notevole: Claude Vision su 3 schermate richiede
~10-20 s, durante i quali il renderer resta in `processing` in attesa della
promise IPC. Nessun annuncio intermedio: un secondo `speakText` prima della
chiamata Vision spingerebbe un `coach:voiceDone` in più, e la macchina a stati di
`useVoiceCoach` tornerebbe in idle a metà operazione.

## Testing

Verificabile senza sim né microfono:

- `voice-intent.selfcheck.ts` esteso — i 4 trigger, le varianti coniugate, la
  forma "set up" separata, e i non-trigger che devono restare quello che sono
  ("nuova sessione" → `newSession`, "fai un'analisi" → `analyze`, "com'è il
  setup?" → `freeform`).
- `r3e-setup-parse.selfcheck.ts` nuovo — brake bias, filtro `disabled`,
  compound, throw su JSON senza `values`.
- `npm run typecheck`, `npm run lint`, `npm run format:check`.

Da provare a mano, perché nessuna è raggiungibile senza clipboard e filesystem
reali: le tre acquisizioni end-to-end, una per gioco, con sessione aperta e sim in
esecuzione.

## Fuori scope

- Nessun cambiamento ai tre picker della UI oltre l'import spostato in
  `R3eSetupPicker`.
- Nessun comando vocale per **scegliere** fra più setup: il vocale prende
  l'ultimo (ACE) o quello che gli si porge (clipboard, screenshot). La selezione
  fra alternative resta un'operazione da UI.
- Nessuna modifica allo schema DB: `session_setups_*` ha già tutte le colonne
  necessarie.
