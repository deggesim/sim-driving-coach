# Comandi vocali: gioco nell'apertura sessione + richiamo per nome

Data: 2026-08-04

## Contesto e problema

Il coach vocale è push-to-talk one-shot: `InputManager` (main) registra una
`globalShortcut`, `useVoiceCoach` (renderer) apre il microfono per max 5 s, manda
l'audio ad Azure STT e passa la trascrizione a `coach:voiceQuery`. Il main
classifica l'intento con regex inline (`classifyVoiceIntent`, `main.ts:1829`) e
instrada su comando di sessione o domanda libera.

Due limiti:

1. **L'apertura sessione a voce apre sempre RaceRoom.** L'intent `newSession`
   chiama `startSession(activeGame)`, e `activeGame` vale `"r3e"` all'avvio
   (`main.ts:391`), perché a riposo tiene "l'ultimo gioco scelto" e senza sessioni
   precedenti quel valore è il default. La voce non ha modo di dire quale
   simulatore aprire: il commento nel codice rimanda al picker della UI.
2. **L'ingegnere non risponde al richiamo per nome.** Il nome configurato
   (`assistantName`, impostazioni) è usato solo per il messaggio di benvenuto e
   per il test voce. Dire "Ciao Robert" produce una risposta libera di Claude,
   non un aggancio conversazionale.

## Requisiti

1. Un comando vocale di apertura sessione può indicare il gioco. Forme
   riconosciute: `raceroom`, `raceroom racing experience`, `r3e`, `rre` per R3E;
   `assetto corsa evo`, `ac evo`, `ace`, `evo` per ACE; `automobilista due`,
   `ams2` per AMS2.
2. Se il comando non indica il gioco ed esiste **esattamente un** simulatore live,
   l'app apre quello senza chiedere.
3. Altrimenti l'app chiede a voce quale gioco e resta in ascolto per la risposta.
4. Chiamando l'ingegnere per nome ("Ciao Robert") l'app risponde con un saluto e
   riapre il microfono, così la domanda successiva non richiede di ripremere il
   tasto.
5. Nome e domanda nella stessa frase ("Ciao Robert, a quanti metri devo frenare
   in curva 1?") non consumano un turno: il prefisso viene rimosso e la domanda
   processata subito.
6. Il richiamo per nome resta **opzionale**: premere il tasto e porre la domanda
   diretta continua a funzionare.
7. Il riconoscimento è verificabile senza simulatore né microfono (selfcheck).

## Design

### 1. `src/main/coach/voice-intent.ts` — modulo puro

La classificazione esce da `main.ts` (~2000 righe, nessun test sulle regex) e
diventa un modulo senza dipendenze: né DB, né IPC, né SDK. Selfcheckabile per lo
stesso motivo di `voice-summary.ts`.

```ts
export type VoiceIntent =
  | { kind: "newSession"; game: GameSource | null }
  | { kind: "closeSession" }
  | { kind: "analyze" }
  | { kind: "greeting" }                     // solo richiamo, nessuna domanda
  | { kind: "freeform"; question: string };  // prefisso col nome già rimosso

export const classifyVoiceIntent: (
  text: string,
  assistantName: string,
) => VoiceIntent;

/** Gioco citato nel testo, null se assente o ambiguo (due giochi diversi). */
export const matchGame: (text: string) => GameSource | null;
```

**Normalizzazione** applicata prima di ogni match: minuscole, rimozione della
punteggiatura, spazi compressi. Serve perché lo STT italiano punteggia e spazia
le sigle in modo imprevedibile.

**Pattern per gioco** (le forme lunghe valutate prima delle sigle):

| Gioco  | Pattern                                                     |
| ------ | ----------------------------------------------------------- |
| `r3e`  | `race ?room`, `\br ?3 ?e\b`, `\brre\b`, `\berre ?(tre\|3) ?e\b` |
| `ace`  | `assetto corsa evo`, `\bac ?evo\b`, `\bace\b`, `\bevo\b`    |
| `ams2` | `automobilista ?(2\|due)`, `\bams ?(2\|due)\b`               |

Se il testo cita due giochi diversi il risultato è `null`: l'app chiede invece di
indovinare.

**Richiamo per nome.** Il nome arriva da `assistantName` e viene confrontato
sul testo normalizzato (case-insensitive). Rimossi i saluti d'apertura
(`ciao`, `ehi`, `hey`, `senti`, `ok`, `ehilà`) e il nome, se resta **al massimo
una parola** l'intent è `greeting`; altrimenti il resto viene classificato
normalmente e, se è una domanda libera, `question` contiene la frase senza il
prefisso.

Gli intent esistenti (`newSession` / `closeSession` / `analyze`) mantengono le
regex attuali, con l'unica aggiunta di `game` su `newSession`.

### 2. Apertura sessione con gioco (`main.ts`)

In `coach:voiceQuery`, ramo `newSession`:

1. `game` riconosciuto → `startSession(game)`. I messaggi di errore esistenti
   (`non è connesso`, `auto/circuito non rilevati`) restano validi e vengono già
   letti dal TTS.
2. `game` assente → conta quanti dei tre giochi sono live con `isLive(g)` (già in
   main, basata sulla freschezza dei frame). Esattamente uno → `startSession` su
   quello.
3. Zero o più di uno → l'app dice _«Quale gioco? Raceroom, Assetto Corsa Evo o
   Automobilista 2»_, alza `pendingGame = true` e riapre l'ascolto.

Con `pendingGame` attivo la query successiva passa **solo** per `matchGame`:
riconosciuto → apre la sessione; non riconosciuto → _«Non ho capito quale
gioco.»_ e reset. Il flag è consumato in ogni caso dalla prima query successiva,
quindi non esiste stato zombie né loop di domande.

Ceiling accettato (da annotare con un commento `ponytail:` nel codice): durante
l'attesa della risposta un comando diverso ("chiudi sessione") viene letto come
gioco non riconosciuto e va ripetuto. Se dà fastidio, la via d'uscita è ricadere
sul classificatore completo quando `matchGame` torna `null`.

### 3. Richiamo per nome e riascolto automatico

Intent `greeting` → l'app pronuncia una delle due frasi, a rotazione
deterministica (contatore modulo, non `Math.random`, così il selfcheck può
asserirla):

1. «Ciao, come posso essere utile?»
2. «Ciao, chiedi e ti darò suggerimenti di guida.»

e riapre l'ascolto. Nessuno stato pendente: la query successiva è una query
normale, quindi dopo il saluto funzionano sia le domande sia i comandi.

**Meccanismo di riascolto** (condiviso con il punto 2, unica implementazione):

- main: `speakText(text, { listenAgain: true })` aggiunge il flag al payload di
  `coach:voiceDone` — nessun canale IPC nuovo, solo il tipo del payload in
  `shared/types.ts`.
- renderer (`useVoiceCoach`): il flag viene messo in un ref da `handleDone`; alla
  fine della riproduzione (`source.onended` per Azure, `utterance.onend` per il
  fallback Web Speech) se è alzato si passa per `setState("idle")` e si richiama
  `triggerListening()` — beep di attivazione e finestra da 5 s già esistenti;
  altrimenti resta il `resetToIdle()` attuale.
- il ref viene azzerato **prima** di riascoltare, così una risposta non può
  innescare un ciclo di riaperture.

## File toccati

| File                                          | Modifica                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| `src/main/coach/voice-intent.ts`              | nuovo — classificazione, matching gioco, richiamo per nome              |
| `src/main/coach/voice-intent.selfcheck.ts`    | nuovo — tabella frasi → intent atteso                                   |
| `src/main/main.ts`                            | usa il modulo; gioco/`pendingGame`/`greeting`; `speakText` con opzioni   |
| `src/shared/types.ts`                         | payload `onVoiceDone` con `listenAgain?: boolean`                       |
| `src/renderer/hooks/useVoiceCoach.ts`         | riascolto automatico alla fine della riproduzione                       |
| `CLAUDE.md`, `src/main/CLAUDE.md`, `src/renderer/CLAUDE.md` | documentazione (elenco selfcheck, catalogo file, comportamento) |

## Testing

`voice-intent.selfcheck.ts`, tabella frasi → intent atteso:

- tutte le varianti di gioco elencate nei requisiti, incluse le forme sillabate
  dallo STT (`"r 3 e"`, `"ams 2"`, `"automobilista due"`);
- apertura senza gioco → `{ kind: "newSession", game: null }`;
- frase ambigua ("apri sessione su raceroom o evo") → `game: null`;
- richiamo puro col nome configurato → `greeting`, con nome diverso da "Aria";
- richiamo + domanda → `freeform` con `question` priva del prefisso;
- falsi positivi: `"analizza la sessione"` resta `analyze`, `"chiudi la
  sessione"` resta `closeSession`, una domanda che contiene "evo" senza comando
  di apertura resta `freeform`.

Verifica manuale (richiede simulatore + microfono, non automatizzabile):
richiamo per nome con riascolto, apertura sessione dettando il gioco, apertura
senza gioco con un solo simulatore live.

## Fuori scope

- Ascolto continuo / hot mic: il trigger resta la shortcut o il pulsante gamepad.
- Rilevamento del silenzio: la finestra di registrazione resta fissa a 5 s.
- Chiusura e analisi sessione per gioco: `closeSession` e `analyze` agiscono
  sulla sessione corrente, non hanno bisogno del gioco.
