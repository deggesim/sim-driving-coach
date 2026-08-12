# Gestione setup unificata, editor manuale e multi-assegnazione ai giri

Data: 2026-08-11

## Obiettivo

Tre interventi indipendenti sull'area setup:

1. Portare AMS2 (e ACE) sullo stesso flusso di gestione setup di R3E, e permettere di
   creare un nuovo setup partendo da uno esistente modificandone i valori a mano —
   senza rifare la scansione degli screenshot.
2. Assegnare lo stesso setup a più giri in una sola operazione.
3. Mostrare il setup attualmente in uso nell'header della sessione.

## Stato attuale

- `SetupSelectionModal` è **già generico** sui tre giochi (storico setup per
  auto/circuito, eliminazione, riuso), ma `SessionPanel` lo apre solo per R3E:
  ACE e AMS2 vanno dritti al picker specifico del gioco.
- Il pulsante in fondo a `SetupSelectionModal` ha una label sbagliata per AMS2
  (`game === "ace" ? "Seleziona" : "Carica da JSON"` → AMS2 legge "Carica da JSON"
  mentre in realtà apre la selezione screenshot).
- `SetupDetailModal` offre solo "Usa questo setup".
- L'assegnazione del setup a un giro è una alla volta, dal badge nella riga.
- Il setup attivo (`currentSetupId`) esiste solo nel main process e non è mai
  esposto al renderer.

## Feature 1 — Gestione setup unificata + editor manuale

### 1.1 Apertura della gestione setup

`SessionPanel.onOpenPicker` apre `SetupSelectionModal` per tutti e tre i giochi
(eliminato il branch su `game === "r3e"`). Il picker specifico del gioco resta
raggiungibile dal pulsante in fondo al modal.

All'avvio di una nuova sessione la gestione setup **non si apre più
automaticamente per nessun gioco**: la riga `if (game === "r3e")
setShowSetupSelection(true)` in `handleGamePicked` viene rimossa.

### 1.2 Label del pulsante di acquisizione

In `SetupSelectionModal`, label e icona dipendono dal gioco:

| Gioco | Label | Icona |
| --- | --- | --- |
| R3E | Carica da JSON | `faFileCode` |
| ACE | Seleziona file | `faFileCode` |
| AMS2 | Acquisisci screenshot | `faCamera` |

### 1.3 "Crea setup da esistente"

`SetupDetailModal` riceve un nuovo prop opzionale `onDuplicate?: () => void`.
Quando presente, nel footer compare "Crea setup da esistente" accanto a
"Usa questo setup". Il pulsante è disponibile per tutti e tre i giochi:
`SetupParam` ha la stessa forma ovunque.

### 1.4 `SetupEditorModal` (nuovo componente)

- Props: `show`, `base: SetupData | null`, `onClose`, `onConfirm(setup: SetupData)`.
- Corpo: un campo "Nome setup" (obbligatorio, **vuoto all'apertura** — il nome lo
  fornisce l'utente, nessun prefill dal setup di origine) e un `Form.Control`
  di testo per ogni parametro, raggruppati per `category` in ordine di apparizione.
- I valori sono stringhe libere (`SetupParam.value` è `string`: "24.5 kPa",
  "58/42%", "Soft"): nessuna validazione, nessun parsing di unità.
- Alla conferma produce un nuovo `SetupData`:
  `{ name, carVerified: true, carFound: base.carFound, setupText: base.setupText,
  params: <modificati>, screenshots: [] }`.
  `screenshots: []` è deliberato: il setup manuale non deve marcare come "già
  scansionati" gli screenshot del setup di origine.
- Salvataggio: passa per `useSetupPicker.handleSetupConfirm`, quindi il nuovo
  setup viene inserito in `session_setups_*` e **diventa il setup attivo**,
  esattamente come un setup appena caricato.

`useSetupPicker` guadagna lo stato `editorBase: SetupData | null` (apertura/chiusura
dell'editor). `SetupSelectionModal` inoltra `onDuplicate` al `SetupDetailModal`
che monta già, e lo propaga verso l'alto con un nuovo prop `onDuplicateSetup(setup:
SetupData)`. `SetupEditorModal` è montato in `SessionPanel`, accanto agli altri
modali, e riceve `editorBase` da `useSetupPicker`.

## Feature 2 — Multi-assegnazione del setup ai giri

### 2.1 Selezione in `LapsTable`

- Nuova colonna checkbox come prima colonna della tabella.
- Checkbox "seleziona tutti" nel `thead`, che agisce sui **giri visibili**
  (dopo il filtro validi/non validi), non solo su quelli della pagina corrente.
  Stato indeterminato quando la selezione è parziale.
- La selezione **persiste al cambio pagina** (serve proprio ad assegnare in blocco
  giri che stanno su pagine diverse). Non serve azzerarla su filtro/sessione/
  eliminazione: la selezione effettiva è derivata intersecando gli id selezionati
  con i giri visibili, quindi si ripulisce da sé.
- La selezione si azzera quando si preme "Assegna setup", per non lasciare uno
  stato stantio dopo l'assegnazione.
- Il click sulla checkbox non deve espandere la riga (`stopPropagation`).

### 2.2 Pulsante "Assegna setup"

Nell'header della sezione Giri, accanto a "Mostra/Nascondi non validi", compare
`Assegna setup (N)` solo quando `N > 0`. Chiama `onAssignSetup?.(lapIds)`.

### 2.3 Generalizzazione del picker

`useSetupPicker.pickerLap: LapRow | null` diventa `pickerLapIds: number[] | null`,
e `pendingLapId: number | null` diventa `pendingLapIds: number[] | null`. Così il
`SetupSelectionModal` già montato per il singolo giro serve anche il caso bulk,
senza aggiungerne un terzo:

- badge setup di una riga → `setPickerLapIds([lap.id])`
- pulsante bulk → `setPickerLapIds([...selezione])`

`handleLapReuseSetup` e il ramo `pendingLapIds` di `handleSetupConfirm` ciclano
sugli id chiamando `assignLapSetup` una volta per giro (nessuna IPC di massa: il
numero di giri di una sessione è nell'ordine delle decine).

Il flash di conferma riporta il numero di giri assegnati.

Funziona sia in modalità `live` sia `historical`, senza restrizioni.

## Feature 3 — Setup in uso nell'header della sessione

### 3.1 Esposizione di `currentSetupId`

- `SessionDetail` guadagna `activeSetupId?: number | null` in `src/shared/types.ts`.
- L'handler `session:getCurrent` in `main.ts` ritorna
  `{ ...loadSessionDetail(...), activeSetupId: currentSetupId }`.
  `session:getDetail` (sessioni storiche) resta invariato: per una sessione
  storica non esiste un "setup in uso".

### 3.2 Tracciamento nel renderer

`sessionStore` guadagna il campo `activeSetupId: number | null`, aggiornato:

- da `setDetail` (dal payload di `getCurrent`; `null` in modalità historical);
- da `_applySetupLoaded` quando il push riguarda la sessione corrente;
- da un nuovo metodo `setActiveSetup(id)` chiamato da
  `useSetupPicker.handleReuseSetup` dopo `sessionReuseSetup`;
- azzerato da `reset()` e da un cambio di sessione in `_applySessionStarted`.

Nessun nuovo canale push: dopo il caricamento iniziale il renderer è l'unico
attore che cambia il setup attivo, quindi può tenerne traccia da sé.

### 3.3 Visualizzazione

In `AnalysisHeader`, dopo il conteggio giri/best lap, compare
`· setup: <nome>` quando `activeSetupId` è valorizzato e risolvibile in `setups`.
Solo in modalità live con sessione attiva.

## Fuori scope

- Nessuna validazione o parsing delle unità di misura nell'editor.
- Nessuna modifica in-place di un setup esistente: l'editor crea sempre una nuova riga.
- Nessuna IPC di assegnazione di massa: il loop lato renderer è sufficiente.
- Nessun selfcheck: le tre feature sono interamente UI, senza logica di calcolo.

## File toccati

| File | Feature |
| --- | --- |
| `src/renderer/components/SessionPanel.tsx` | 1, 2 |
| `src/renderer/components/SetupSelectionModal.tsx` | 1 |
| `src/renderer/components/SetupDetailModal.tsx` | 1 |
| `src/renderer/components/SetupEditorModal.tsx` *(nuovo)* | 1 |
| `src/renderer/hooks/useSetupPicker.ts` | 1, 2, 3 |
| `src/renderer/components/LapsTable.tsx` | 2 |
| `src/renderer/store/sessionStore.ts` | 3 |
| `src/renderer/components/AnalysisHeader.tsx` | 3 |
| `src/main/main.ts` | 3 |
| `src/shared/types.ts` | 3 |
| `src/renderer/CLAUDE.md` | doc dei componenti |
