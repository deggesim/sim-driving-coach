# Scaletta più rapida — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** accorciare il percorso della scaletta con tre misure: avviso "Stint analizzabile" anticipato quando il verdetto è stabile, passo 1 (condotti freni) giudicato senza aspettare le gomme, promemoria vocale di ripresa all'apertura della sessione.

**Architecture:** tutto il giudizio resta in TypeScript puro in `setup-ladder.ts`: il passo 1 su giri propri, `verdictKey`, la nuova regola di `stintReadyMessage`, `resumeMessage`. `session-coach.ts` calcola le statistiche "prima dell'ultimo giro" e legge la sessione precedente. `main.ts` pronuncia le frasi. `prompt-builder.ts` adatta la riga della sequenza quando il passo 1 è corrente prima dei giri giudicati.

**Tech Stack:** Electron main process, TypeScript strict, better-sqlite3, selfcheck con `node:assert/strict`.

**Spec:** `docs/superpowers/specs/2026-10-27-scaletta-piu-rapida-design.md`

## Global Constraints

- Gate prima di ogni commit: `npm run typecheck && npm run lint && npm run format:check && npm run selfcheck && npm run fallow:check`, tutti a exit 0.
- Stile del codice: `type` e non `interface`, solo arrow function, niente `class`, export nominati, import relativi.
- Testi vocali e del prompt in italiano, tono da ingegnere. I commenti nel codice sono in inglese; l'italiano è ammesso per spiegare un testo vocale o del prompt.
- Nessuna dipendenza nuova e nessuna colonna DB nuova.
- L'avviso "Stint analizzabile" non arriva mai più tardi di oggi: con 3 giri contati parla sempre.
- `lapsMissing` mantiene il suo significato: i giri che mancano ai passi 2-6.
- Messaggi di commit su file con `git commit -F <file>`: in questo ambiente i here-string di PowerShell non funzionano.

## Review Focus

1. **Gomme che non si stabilizzano mai**, per esempio con la pista che si raffredda. Il passo 1 deve essere giudicato lo stesso, dai giri del segmento dopo il primo (Task 1, test "plateau assente").
2. **Setup Fisso (R3E)**: il passo 1 non è proponibile, quindi non deve diventare corrente prima dei giri giudicati (Task 1, test "fixedSetup").
3. **Ultimo giro non valido**: la stabilità confronta il verdetto prima e dopo l'ultimo giro *contato*, non l'ultimo giro registrato (Task 3: il taglio usa `lastJudgedLap`).
4. **Passo corrente 4 (pressioni)**: servono sempre 3 giri anche con verdetto stabile (Task 3, test dedicato).
5. **Sessione precedente senza setup acquisito**: la frase dice "setup non acquisito" e "usa lo stesso setup" (Task 4, test dedicato).

---

### Task 1: passo 1 sui giri dopo il primo, anche prima dei giri giudicati

**Files:**
- Modify: `src/main/coach/setup-ladder.ts` (tipo `SetupLadder`, `computeSetupLadder`: il passo `ducts` e il ritorno anticipato `if (lapsMissing > 0)`)
- Test: `src/main/coach/setup-ladder.selfcheck.ts`
- Docs: `src/main/CLAUDE.md` (voce `setup-ladder.ts`)

**Interfaces:**
- Produces: `SetupLadder.ductsLaps: number`, il numero di giri del segmento corrente dal secondo in poi, validi e non validi. Quando `lapsMissing > 0`, `steps` contiene il passo 1 se `ductsLaps ≥ 1`, altrimenti è `[]`. `current` vale `1` quando `lapsMissing > 0`, il passo 1 è `fix` e proponibile, e `ductsLaps ≥ 2`; altrimenti `current` vale `null`.

Approccio: calcolare `ducts` prima del ritorno anticipato, sugli zone dei giri `seg.slice(1)` invece che sui giri giudicati. Si applica la stessa regola di `proposable` di oggi: con Setup Fisso il passo 1 non è proponibile.

- [ ] **Step 1: scrivere i test che falliscono** in `setup-ladder.selfcheck.ts`. `stint`/`mkLap`/`okZone` esistono già; per gomme instabili usare zone diverse per giro.

```ts
// Tyres never settle (+5 °C per lap): 0 judged laps, but brakes are judged on laps 2..n.
const drifting = (n: number, brakes: Quartet, extra: Partial<LapRow> = {}) =>
  Array.from({ length: n }, (_, i) =>
    mkLap(i + 1, [okZone({ avgBrakeTempC: brakes, avgTyreTempC: [70 + 5 * i, 70 + 5 * i, 70 + 5 * i, 70 + 5 * i] })], extra),
  );
const early = computeSetupLadder(drifting(3, [720, 720, 400, 400]), new Map(), { fixedSetup: false });
assert.ok(early.lapsMissing > 0);
assert.equal(early.ductsLaps, 2);
assert.equal(early.current, 1);
assert.deepEqual(early.steps.map((s) => s.n), [1]);
assert.equal(early.steps[0].status, "fix");
// Brakes in the window: step 1 shown, not current.
const earlyOk = computeSetupLadder(drifting(3, [600, 600, 560, 560]), new Map(), { fixedSetup: false });
assert.equal(earlyOk.current, null);
assert.equal(earlyOk.steps[0].status, "ok");
// Invalid laps still count for the brakes.
assert.equal(computeSetupLadder(drifting(3, [720, 720, 400, 400], { valid: false }), new Map(), { fixedSetup: false }).current, 1);
// One lap after the out-lap: step 1 shown, not yet current.
const oneLap = computeSetupLadder(drifting(2, [720, 720, 400, 400]), new Map(), { fixedSetup: false });
assert.equal(oneLap.ductsLaps, 1);
assert.equal(oneLap.current, null);
assert.equal(oneLap.steps[0].status, "fix");
// Only the out-lap: no step yet.
assert.deepEqual(computeSetupLadder(drifting(1, [720, 720, 400, 400]), new Map(), { fixedSetup: false }).steps, []);
// Fixed Setup: step 1 is not proposable, so never current before the judged laps.
assert.equal(computeSetupLadder(drifting(3, [720, 720, 400, 400]), new Map(), { fixedSetup: true }).current, null);
```

`Quartet` si importa dai tipi condivisi, se non è già importato.

- [ ] **Step 2: eseguire `npm run selfcheck` e verificare il fallimento**: `ductsLaps` non esiste.
- [ ] **Step 3: implementare** in `computeSetupLadder` come descritto in Interfaces. Aggiornare il commento del campo `lapsMissing` nel tipo: "> 0 ⇒ steps è `[]` oppure contiene solo il passo 1".
- [ ] **Step 4: eseguire `npm run selfcheck`**. Atteso: tutti passati, compresi i test esistenti. Con 5 giri uguali il passo 1 sui giri 2-5 dà lo stesso risultato. Se un test esistente asserisce `steps: []` con giri mancanti e un solo giro dopo il primo, aggiornarlo alla nuova regola.
- [ ] **Step 5: aggiornare `src/main/CLAUDE.md`**. Nella voce `setup-ladder.ts` aggiungere una frase: il passo 1 si giudica sui giri del segmento dal secondo in poi, senza il plateau delle gomme, e può diventare corrente prima dei giri giudicati.
- [ ] **Step 6: gate completo e commit.** Messaggio: `feat(coach): condotti freni giudicati senza attendere le gomme`.

### Task 2: prompt con il passo 1 corrente prima dei giri giudicati

**Files:**
- Modify: `src/main/coach/prompt-builder.ts` (`ladderLines`, le due regole sui giri mancanti nei system prompt di Livello 1 e 2)
- Test: `src/main/coach/prompt-builder.selfcheck.ts`

**Interfaces:**
- Consumes: `SetupLadder.ductsLaps`; il caso `lapsMissing > 0 && current === 1` dal Task 1.

- [ ] **Step 1: scrivere il test che fallisce.** Con un `SetupLadder` letterale `{ lapsMissing: 2, ductsLaps: 2, current: 1, steps: [<passo 1 fix>], setupLabel: "Gara B", … }` la prima riga della sequenza è esattamente:

```
- Sequenza setup: passo 1 giudicato su 2 giri dopo il primo; per i passi 2-6 completa ancora 2 giri con il setup "Gara B"
```

Subito dopo segue la riga del passo 1 con `← PASSO CORRENTE`. Il caso `lapsMissing > 0` con `current === null` resta invariato: il test esistente alla riga ~540 continua a passare.

- [ ] **Step 2: eseguire `npm run selfcheck` e verificare il fallimento.**
- [ ] **Step 3: implementare.** In `ladderLines` aggiungere il ramo `lapsMissing > 0 && current === 1` con la riga sopra; senza etichetta di setup usare "questo setup", come oggi. Nei system prompt:
  - Livello 1: "Se la sequenza chiede di completare dei giri, l'azione di setup è …" diventa "Se la sequenza chiede di completare dei giri e non ha un passo corrente, l'azione di setup è …".
  - Livello 2: "Con la richiesta "completa ancora N giri" nessuna proposta numerata." diventa "Con la richiesta "completa ancora N giri" e nessun passo corrente, nessuna proposta numerata.".

  Se `prompt-builder.selfcheck.ts` asserisce queste frasi alla lettera, aggiornare le asserzioni.
- [ ] **Step 4: eseguire `npm run selfcheck`.** Atteso: tutti passati.
- [ ] **Step 5: gate completo e commit.** Messaggio: `feat(coach): sequenza nel prompt con il passo 1 già giudicabile`.

### Task 3: prontezza con verdetto stabile

**Files:**
- Modify: `src/main/coach/setup-ladder.ts` (`stintReadyMessage`, nuovo `verdictKey`)
- Modify: `src/main/coach/setup-ladder.ts` (opzione `minJudgedLaps` di `computeSetupLadder`)
- Modify: `src/main/coach/session-stats.ts` (`ComputeStatsInput.minJudgedLaps`, inoltrata a `computeSetupLadder`)
- Modify: `src/main/coach/session-coach.ts` (`stintReady`)
- Test: `src/main/coach/setup-ladder.selfcheck.ts`
- Docs: `CLAUDE.md` (punto "Setup ladder" di Key Design Decisions), `src/main/CLAUDE.md`

**Interfaces:**
- Consumes: `SetupLadder.ductsLaps` e la regola di `current` dal Task 1.
- Produces:
  - `computeSetupLadder(laps, labels, opts: { …; minJudgedLaps?: number })`, default `MIN_JUDGED_LAPS` (2). Serve solo a calcolare il verdetto sul primo giro giudicato; `lapsMissing` usa il valore passato.
  - `ComputeStatsInput.minJudgedLaps?: number`, inoltrata a `computeSetupLadder`.
  - `verdictKey(ladder: SetupLadder, overview?: SetupOverview | null): string`;
  - `stintReadyMessage(ladder: SetupLadder, overview?: SetupOverview | null, prev?: { ladder: SetupLadder; overview?: SetupOverview | null } | null): string | null`.

Regole, dalla spec §1 e §2:
- **`verdictKey`:** una voce per ogni passo da 1 al passo corrente compreso, oppure per tutti i passi se `current` è null, nella forma `${n}:${status}:${reason}`. Nel motivo ogni numero (`/\d+(?:[.,]\d+)?/g`) diventa `#`; il segno resta, perché indica la direzione. Le voci si uniscono con `|`. Se `ladder.current == null && ladder.lapsMissing === 0` e c'è `overview`, si aggiungono nello stesso formato le aree da 1 all'area corrente compresa, oppure tutte se `overview.current` è null.
- **Giri contati:** `ladder.ductsLaps` se `lapsMissing > 0 && current === 1`, altrimenti `ladder.judgedLaps`.
- **Prontezza:** pronto se i giri contati sono ≥ 3 (`READY_JUDGED_LAPS`). Pronto anche con giri contati ≥ 2 quando `current !== 4`, c'è `prev` e `verdictKey(prev.ladder, prev.overview) === verdictKey(ladder, overview)`. Altrimenti `null`.
- **Frase:** invariata, con i giri contati al posto di `judgedLaps`.
- **In `session-coach.stintReady`:** si calcola il giro di taglio. È `laps.at(-1).lap_number` quando `lapsMissing > 0 && current === 1`, altrimenti `ladder.lastJudgedLap`. Poi `prev = computeSessionStats({ ...stessi input, laps: laps.filter((l) => l.lap_number < taglio), minJudgedLaps: 1 })` e si passa `{ ladder: prev.setupLadder, overview: prev.setupOverview }`. Se il taglio è null o `prev.setupLadder` è null, si passa `null`.

- [ ] **Step 1: scrivere i test che falliscono** in `setup-ladder.selfcheck.ts`. Con `okZone` il primo giro non è giudicato, quindi 3 giri danno 2 giudicati e 2 giri ne danno 1.

```ts
const L = (laps: LapRow[]) => computeSetupLadder(laps, new Map(), { fixedSetup: false });
// The verdict before the last counted lap is judged on a single lap.
const L1 = (laps: LapRow[]) =>
  computeSetupLadder(laps, new Map(), { fixedSetup: false, minJudgedLaps: 1 });
assert.equal(L1(stint(2, okZone())).lapsMissing, 0);
// Stable at 2 judged laps: speaks one lap earlier than today.
assert.equal(
  stintReadyMessage(L(stint(3, okZone())), null, { ladder: L1(stint(2, okZone())) }),
  "Stint analizzabile: 2 giri giudicati. Nessun passo da correggere. Puoi metterti in pausa ed eseguire l'analisi.",
);
// Numbers alone differ: still stable.
const hot = (t: number) => okZone({ avgBrakeTempC: [t, t, 400, 400] });
assert.equal(verdictKey(L(stint(3, hot(720)))), verdictKey(L(stint(3, hot(730)))));
// The verdict flips with the second judged lap: wait for the third.
assert.equal(stintReadyMessage(L(stint(3, okZone())), null, { ladder: L1(stint(2, hot(720))) }), null);
// Without prev: today's rule (3 judged laps).
assert.equal(stintReadyMessage(L(stint(3, okZone()))), null);
// Current step 4 (pressures): 3 laps even when stable.
const lowPress = okZone({ avgTyreTempCenterC: [83, 83, 83, 83] }); // Δ centre − shoulders −2 °C: "bassa"
assert.equal(L(stint(3, lowPress)).current, 4);
assert.equal(stintReadyMessage(L(stint(3, lowPress)), null, { ladder: L1(stint(2, lowPress)) }), null);
// Early step 1 (Task 1 `drifting`): 2 brake laps, stable against 1 → ready.
assert.equal(
  stintReadyMessage(L(drifting(3, [720, 720, 400, 400])), null, { ladder: L(drifting(2, [720, 720, 400, 400])) }),
  "Stint analizzabile: 2 giri giudicati. Primo passo da correggere: condotti freni. Puoi metterti in pausa ed eseguire l'analisi.",
);
```

- [ ] **Step 2: eseguire `npm run selfcheck` e verificare il fallimento**: `verdictKey` non esiste.
- [ ] **Step 3: implementare** `verdictKey` e la nuova `stintReadyMessage` in `setup-ladder.ts`, poi il taglio e `prev` in `session-coach.stintReady`. Il chiamante in `main.ts` (`announceStintReady`) non cambia.
- [ ] **Step 4: eseguire `npm run selfcheck`.** Atteso: tutti passati, compresi i test esistenti di `stintReadyMessage`, che non passano `prev`.
- [ ] **Step 5: aggiornare la documentazione.**
  - `CLAUDE.md`, punto "Setup ladder": "L'avviso vocale "Stint analizzabile" arriva con 3 giri contati, o con 2 se il verdetto (stato e direzione dei passi fino al corrente, e delle aree fino alla corrente) non cambia aggiungendo l'ultimo giro; con il passo corrente 4 sempre 3".
  - `src/main/CLAUDE.md`: stessa regola nella voce `setup-ladder.ts`; nella voce `session-coach.ts`, il calcolo di `prev`.
- [ ] **Step 6: gate completo e commit.** Messaggio: `feat(coach): avviso stint anticipato quando il verdetto è stabile`.

### Task 4: promemoria di ripresa all'apertura della sessione

**Files:**
- Modify: `src/main/coach/setup-ladder.ts` (nuovo `resumeMessage`)
- Modify: `src/main/coach/session-coach.ts` (nuovo metodo `resumeHint` nel tipo e nell'oggetto restituito)
- Modify: `src/main/main.ts` (`openSessionByVoice`, handler `session:start`)
- Test: `src/main/coach/setup-ladder.selfcheck.ts`
- Docs: `CLAUDE.md`, `src/main/CLAUDE.md`

**Interfaces:**
- Produces:
  - `resumeMessage(startedAt: string, setupName: string | null, ladder: SetupLadder | null, overview?: SetupOverview | null): string`;
  - `SessionCoach.resumeHint(game: GameSource, sessionId: number): string | null`.

Testo, dalla spec §3: `Ultima sessione con questa combinazione: ${data}, ${setup}, ${stato}. ${chiusura}`.
- **`data`:** `new Date(startedAt).toLocaleDateString("it-IT", { day: "numeric", month: "long" })`, per esempio "27 ottobre".
- **`setup`:** `setup ${setupName}`, oppure "setup non acquisito".
- **`stato`:**
  - "giri insufficienti per un giudizio" se `ladder` è null, oppure se `lapsMissing > 0` e `current` è null;
  - `passo ${n}, ${label}, da correggere` se c'è un passo corrente;
  - `sequenza completa, area ${n}, ${label}` se c'è un'area corrente del quadro;
  - "nessun passo da correggere" negli altri casi.
- **`chiusura`:** "Per riprendere carica quel setup." se c'è un nome, altrimenti "Per riprendere usa lo stesso setup.".

`resumeHint`:
1. Legge auto, circuito e layout della sessione `sessionId`.
2. Cerca la sessione precedente: `SELECT id, started_at FROM ${tableFor(game, "sessions")} WHERE car = ? AND track = ? AND layout IS ? AND id < ? AND lap_count > 0 ORDER BY id DESC LIMIT 1`.
3. Ne carica il bundle con `loadSessionBundle` e calcola `computeSessionStats` con gli stessi input di `stintReady`.
4. Prende come setup quello dell'ultimo giro (`bundle.setups.find((s) => s.id === bundle.laps.at(-1)?.setup_id)?.setup.name ?? null`).
5. Restituisce `null` se non c'è una sessione precedente.

In `main.ts`, un helper `speakResumeHint` legge `currentSessionId`/`currentSessionGame` e pronuncia il promemoria se non è null. Si chiama in due punti:
- in `openSessionByVoice`, dopo `await speakText("Sessione aperta su …")`;
- nell'handler `session:start`, dopo un avvio con `ok: true`. L'handler diventa `async` e restituisce comunque il risultato di `startSession`.

- [ ] **Step 1: scrivere i test che falliscono** in `setup-ladder.selfcheck.ts`:

```ts
const at = "2026-10-27T15:18:00.000Z";
assert.equal(
  resumeMessage(at, "Monza v2", L(stint(4, okZone({ avgBrakeTempC: [720, 720, 400, 400] })))),
  "Ultima sessione con questa combinazione: 27 ottobre, setup Monza v2, passo 1, condotti freni, da correggere. Per riprendere carica quel setup.",
);
assert.equal(
  resumeMessage(at, null, L(stint(4, okZone()))),
  "Ultima sessione con questa combinazione: 27 ottobre, setup non acquisito, nessun passo da correggere. Per riprendere usa lo stesso setup.",
);
assert.ok(resumeMessage(at, "A", L(stint(1, okZone()))).includes("giri insufficienti per un giudizio"));
assert.ok(resumeMessage(at, "A", ladderComplete, overviewCurrent6).includes("sequenza completa, area 6, barre antirollio"));
assert.ok(resumeMessage(at, "A", null).includes("giri insufficienti per un giudizio"));
```

`ladderComplete` e `overviewCurrent6` esistono già nel selfcheck. Se sono dichiarati più avanti nel file, mettere questi test dopo di loro.

- [ ] **Step 2: eseguire `npm run selfcheck` e verificare il fallimento.**
- [ ] **Step 3: implementare** `resumeMessage`, `resumeHint` e il collegamento in `main.ts`, come descritto sopra.
- [ ] **Step 4: eseguire `npm run selfcheck`.** Atteso: tutti passati.
- [ ] **Step 5: aggiornare la documentazione.**
  - `CLAUDE.md`, punto "Setup ladder": "All'apertura della sessione (voce o interfaccia) un promemoria dice data, setup e stato dell'ultima sessione con la stessa auto, circuito e layout".
  - `src/main/CLAUDE.md`: le voci `setup-ladder.ts` e `session-coach.ts`.
- [ ] **Step 6: gate completo e commit.** Messaggio: `feat(coach): promemoria di ripresa all'apertura della sessione`.

### Verifica finale con il simulatore (utente)

- R3E o ACE: aprire una sessione nuova con la stessa combinazione di una sessione precedente. Il promemoria deve dire data, setup e passo corretti.
- Al primo stint con un setup che ha i freni sbilanciati, l'avviso "condotti freni" deve arrivare dopo il giro 3, anche quando le gomme non sono ancora stabili.
- Con un verdetto netto, l'avviso "Stint analizzabile" deve arrivare con 2 giri giudicati invece di 3.
