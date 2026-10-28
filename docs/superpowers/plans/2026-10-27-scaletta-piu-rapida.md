# Scaletta più rapida — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** accorciare il percorso della scaletta e impedire che si blocchi su un passo senza leva o con la leva a fondo scala: avviso "Stint analizzabile" anticipato quando il verdetto è stabile, passo 1 (condotti freni) giudicato senza aspettare le gomme.

**Architecture:** tutto il giudizio resta in TypeScript puro in `setup-ladder.ts`: il passo 1 su giri propri, `verdictKey`, la nuova regola di `stintReadyMessage`, le leve del setup. `session-coach.ts` calcola le statistiche "prima dell'ultimo giro". `prompt-builder.ts` adatta la riga della sequenza quando il passo 1 è corrente prima dei giri giudicati.

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

### Task 4: passo senza leva nel setup caricato → NON VALUTABILE

**Files:**
- Modify: `src/main/coach/setup-ladder.ts`: opzione `setupParams` di `computeSetupLadder`, tabella `LEVERS`, post-elaborazione dei passi in entrambi i ritorni, quello anticipato del Task 1 e quello finale
- Modify: `src/main/coach/session-stats.ts`: passa `setupParams: setup?.setup.params ?? null`, dove `setup` è già il setup dell'ultimo segmento
- Modify: `src/main/ams2/ams2-setup-vision.ts`: `AMS2_CANONICAL_PARAMS`
- Test: `src/main/coach/setup-ladder.selfcheck.ts`, `src/main/coach/setup-levers.selfcheck.ts` se asserisce la lista canonica
- Docs: `CLAUDE.md` (punto "Setup ladder"), `src/main/CLAUDE.md`

**Interfaces:**
- Consumes: il ritorno anticipato del Task 1 (`lapsMissing > 0`, passo 1 corrente).
- Produces: `computeSetupLadder(laps, labels, opts: { …; setupParams?: SetupParam[] | null })`. Con `setupParams` assente o null il comportamento è quello di oggi.

Regola, dalla spec §3: un passo `fix` per cui nessun `param.parameter` soddisfa il pattern della sua leva diventa `{ ...step, status: "na", reason: "leva non presente nel setup caricato — " + step.reason }`. Poi `current` si ricalcola con la regola di sempre: primo passo `fix` e proponibile. Nel ritorno anticipato del Task 1 la stessa regola fa sì che il passo 1 senza leva non diventi corrente. Pattern, case-insensitive:

```ts
const LEVERS: Record<number, RegExp> = {
  1: /duct|condott/i,
  2: /brake bias|ripartizione frenata|bilanciamento fren/i,
  3: /coast|freno motore|engine brak/i,
  4: /tyre pressure|^pression/i,
  5: /camber|campanatura/i,
  6: /differential (power|preload)|power locking|power ramp|precarico|preload/i,
};
```

`AMS2_CANONICAL_PARAMS` riceve questi nomi, dopo quelli di molle e ammortizzatori:
- singoli: "Condotti freni", "Bilanciamento freni", "Pressione freni", "Freno motore", "Coast ramp", "Power ramp", "Precarico";
- per ruota, come gli altri: "Pressione FL/FR/RL/RR" e "Camber FL/FR/RL/RR".

- [ ] **Step 1: scrivere i test che falliscono** in `setup-ladder.selfcheck.ts`:

```ts
const P = (...names: string[]) => names.map((parameter) => ({ category: "x", parameter, value: "1" }));
const withParams = (laps: LapRow[], params: SetupParam[] | null) =>
  computeSetupLadder(laps, new Map(), { fixedSetup: false, setupParams: params });
const unbalanced = stint(5, okZone({ avgBrakeTempC: [720, 720, 400, 400] }));
// R3E Porsche (2026-10-27): no duct lever → step 1 na, the ladder moves on.
const noDucts = withParams(unbalanced, P("Brake Bias", "Tyre Pressure Front Left", "Camber Front Left", "Differential Preload"));
assert.equal(stepOf(noDucts, 1).status, "na");
assert.ok(stepOf(noDucts, 1).reason.startsWith("leva non presente nel setup caricato — "));
assert.equal(noDucts.current, null);
// ACE never exports ducts either.
assert.equal(withParams(unbalanced, P("Ripartizione Frenata Anteriore", "Pressione FL")).current, null);
// The lever exists → unchanged.
assert.equal(withParams(unbalanced, P("Condotti freni")).current, 1);
// No setup loaded → unchanged.
assert.equal(withParams(unbalanced, null).current, 1);
// Early step 1 (Task 1 `drifting`) without the lever: not current.
assert.equal(withParams(drifting(3, [720, 720, 400, 400]), P("Brake Bias")).current, null);
// An ok step without its lever stays ok.
assert.equal(stepOf(withParams(stint(5, okZone()), P()), 1).status, "ok");
```

Se `SetupParam` non è già importato nel selfcheck, importarlo da `../../shared/types.js`.

- [ ] **Step 2: eseguire `npm run selfcheck` e verificare il fallimento.**
- [ ] **Step 3: implementare** come descritto sopra, con un helper unico usato in entrambi i ritorni.
- [ ] **Step 4: eseguire `npm run selfcheck`.** Atteso: tutti passati. I test esistenti non passano `setupParams`, quindi non cambiano.
- [ ] **Step 5: aggiornare la documentazione.**
  - `CLAUDE.md`, punto "Setup ladder": "Un passo DA CORREGGERE senza la sua leva nel setup caricato diventa NON VALUTABILE e si salta (R3E e ACE non hanno sempre i condotti freni)".
  - `src/main/CLAUDE.md`: la stessa regola nella voce `setup-ladder.ts`, e i nomi nuovi nella voce `ams2-setup-vision.ts`.
- [ ] **Step 6: gate completo e commit.** Messaggio: `feat(coach): passo senza leva nel setup saltato dalla scaletta`.

### Task 5: leva a fondo scala (solo R3E)

**Files:**
- Modify: `src/shared/types.ts`: `SetupParam.limit?: "min" | "max"`
- Modify: `src/shared/r3e-setup-parse.ts`: calcolo di `limit`
- Modify: `src/main/coach/setup-ladder.ts`: `LadderStep.moves?`, mosse dei passi 2, 4 e 5, opzione `game`, post-elaborazione dopo quella del Task 4
- Modify: `src/main/coach/session-stats.ts`: passa `game` a `computeSetupLadder`
- Test: `src/shared/r3e-setup-parse.selfcheck.ts`, `src/main/coach/setup-ladder.selfcheck.ts`
- Docs: `src/main/CLAUDE.md`

**Interfaces:**
- Consumes: `setupParams` e la post-elaborazione del Task 4.
- Produces:
  - `SetupParam.limit?: "min" | "max"`: il valore grezzo `minValue + currentStep * stepSize` è il più basso (`"min"`) o il più alto (`"max"`) raggiungibile. È assente se `maxStep === 0`, se `stepSize === 0` o se il valore è a metà corsa. Il valore più basso è al passo 0 quando `stepSize > 0`, al passo `maxStep` quando `stepSize < 0`.
  - `LadderStep.moves?: { param: string; dir: "up" | "down" }[]`, con `param` uguale al nome R3E del parametro (`idToLabel`).
  - `computeSetupLadder(…, opts: { …; game?: GameSource })`.

Mosse, dalla spec §3. Le ruote in ordine FL, FR, RL, RR corrispondono a "Front Left", "Front Right", "Rear Left", "Rear Right".
- **Passo 2:** verso il posteriore `{ param: "Brake Bias", dir: "up" }`, verso l'anteriore `"down"`. Con "ridurre la forza frenante" `{ param: "Brake Pressure", dir: "down" }`.
- **Passo 4:** per ogni ruota fuori soglia, `Tyre Pressure <ruota>` con `"down"` se la pressione è alta e `"up"` se è bassa.
- **Passo 5:** per ogni ruota indicata, `Camber <ruota>` con `"down"` se serve più campanatura negativa e `"up"` se ne serve meno.

Regola: con `game === "r3e"`, per un passo `fix` con `moves` non vuote, si considerano le mosse il cui `param` è presente in `setupParams`. Se ce n'è almeno una e tutte sono bloccate, il passo diventa `{ ...step, status: "ok", reason: step.reason + " — già a fondo scala" }`. Una mossa è bloccata quando `limit === "max"` con `dir: "up"`, oppure `limit === "min"` con `dir: "down"`. Poi `current` si ricalcola.

- [ ] **Step 1: scrivere i test che falliscono.**

In `r3e-setup-parse.selfcheck.ts`, con le voci del JSON reale del 2026-10-27:

```ts
const lim = (item: object) => parseR3eSetupJson(JSON.stringify({ values: [item] }))[0].limit;
assert.equal(lim({ id: "BrakePressure", currentStep: 21, minValue: 80, stepSize: 1, maxStep: 21, suffix: "%", disabled: false }), "max");
assert.equal(lim({ id: "BrakePressure", currentStep: 20, minValue: 80, stepSize: 1, maxStep: 21, suffix: "%", disabled: false }), undefined);
// Negative step: step 51 is the most negative camber, i.e. the lowest value.
assert.equal(lim({ id: "CamberFrontLeft", currentStep: 51, minValue: 0, stepSize: -0.1, maxStep: 51, suffix: "deg", disabled: false }), "min");
assert.equal(lim({ id: "CamberFrontLeft", currentStep: 0, minValue: 0, stepSize: -0.1, maxStep: 51, suffix: "deg", disabled: false }), "max");
```

In `setup-ladder.selfcheck.ts`, usando `stepOf` e i fixture esistenti:

```ts
const lp = (parameter: string, limit?: "min" | "max") => ({ category: "x", parameter, value: "1", limit });
const camberLaps = stint(5, okZone({ avgTyreTempInnerC: [84, 84, 84, 84], avgTyreTempOuterC: [83, 83, 83, 83] })); // inner−outer +1 °C: more negative camber
const r3e = (params: SetupParam[]) =>
  computeSetupLadder(camberLaps, new Map(), { fixedSetup: false, setupParams: params, game: "r3e" });
const wheels = ["Front Left", "Front Right", "Rear Left", "Rear Right"];
assert.equal(stepOf(r3e(wheels.map((w) => lp(`Camber ${w}`))), 5).status, "fix");
const maxed = r3e(wheels.map((w) => lp(`Camber ${w}`, "min")));
assert.equal(stepOf(maxed, 5).status, "ok");
assert.ok(stepOf(maxed, 5).reason.endsWith(" — già a fondo scala"));
// One wheel can still move → still fix.
assert.equal(stepOf(r3e([...wheels.slice(1).map((w) => lp(`Camber ${w}`, "min")), lp("Camber Front Left")]), 5).status, "fix");
// Same params on ACE: limits are R3E-only, unchanged.
assert.equal(
  stepOf(computeSetupLadder(camberLaps, new Map(), { fixedSetup: false, setupParams: wheels.map((w) => lp(`Camber ${w}`, "min")), game: "ace" }), 5).status,
  "fix",
);
```

Prima delle altre asserzioni, verificare che con `camberLaps` il passo 5 sia `fix` e che i passi 1-4 siano ok. Se `okZone` non lo garantisce, scegliere temperature interne ed esterne che lo garantiscano. Con `setupParams` non vuoti si applica anche il Task 4: le liste dei parametri devono includere le leve dei passi che si vogliono lasciare valutabili.

- [ ] **Step 2: eseguire `npm run selfcheck` e verificare il fallimento.**
- [ ] **Step 3: implementare** come descritto sopra. Le mosse nascono nei passi 2, 4 e 5, dove la decisione per ruota esiste già.
- [ ] **Step 4: eseguire `npm run selfcheck`.** Atteso: tutti passati.
- [ ] **Step 5: aggiornare `src/main/CLAUDE.md`.**
  - Voce `setup-ladder.ts`: "su R3E un passo con tutte le mosse a fondo scala diventa ok con nota".
  - Voce `r3e-setup-parse` o `shared`: il nuovo campo `limit`.
- [ ] **Step 6: gate completo e commit.** Messaggio: `feat(coach): leva R3E a fondo scala non blocca la scaletta`.

### Verifica finale con il simulatore (utente)

- Al primo stint con un setup che ha i freni sbilanciati, l'avviso "condotti freni" deve arrivare dopo il giro 3, anche quando le gomme non sono ancora stabili.
- Con un verdetto netto, l'avviso "Stint analizzabile" deve arrivare con 2 giri giudicati invece di 3.
- R3E con la Porsche 911 GT3 R, oppure ACE: con i freni sbilanciati il passo 1 deve risultare "leva non presente nel setup caricato", e la scaletta deve proseguire.
