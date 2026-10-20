# Scaletta setup — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** calcolare in TypeScript lo stato dei sei passi della scaletta setup (condotti → bilanciamento freni → freno motore → pressioni → campanatura → differenziale) e far proporre al Livello 1 una sola leva, sul primo passo da correggere.

**Architecture:** i reader aggiungono tre canali di temperatura superficiale (`tti/ttc/tto`) e, su AMS2, lo slip calcolato da `mTyreRPS`. `LapRecorder` conta a fine giro, per zona, gli eventi che servono alla scaletta (bloccaggi, ABS, scalate, pattinamento, curve sotto/sovrasterzanti). Un modulo puro `setup-ladder.ts` somma i contatori dell'ultimo segmento-setup e decide i passi. `prompt-builder.ts` stampa il risultato nei Dati Calcolati, e i due system prompt obbligano a seguirlo.

**Tech Stack:** TypeScript strict, Electron main process, koffi SHM, selfcheck con `node:assert` (`npm run selfcheck`).

**Spec:** `docs/superpowers/specs/2026-10-20-scaletta-setup-design.md`

## Global Constraints

- Solo arrow function, nessuna `class`, `type` invece di `interface`, named export, import relativi con `.js`.
- Commenti in inglese; testo per UI e prompt in italiano, con gli accenti veri.
- Tutti i campi nuovi di `CompactFrame`, `ZoneData` e `SessionStats` sono opzionali o `| null`, quindi ogni task compila da solo.
- Un canale che il gioco non fornisce viene **omesso**, mai scritto come zero (regola già in `aggregateZones`).
- Gate dopo ogni task: `npm run typecheck && npm run lint && npm run format:check && npm run selfcheck && npm run fallow:check`, tutti e cinque a exit 0. `npm run format` è libero.
- **Commit solo dopo una conferma esplicita dell'utente.** Il messaggio si scrive su file e si passa con `git commit -F <file>`, e termina con:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e `Claude-Session: https://claude.ai/code/session_015dU74yHKEtV1SFRZQBSTyq`.
- Nessun nuovo titolo `##` nei system prompt: il vincolo è asserito in `prompt-builder.selfcheck.ts`.
- Le soglie di giudizio sono costanti nominate in cima a `setup-ladder.ts`, quelle per frame in cima a `ladder-counters.ts`. È uno scostamento dallo spec, che le voleva in un unico punto: quelle per frame vanno applicate in registrazione, perché `session-stats` vede solo le zone.

## Review Focus

1. **Sessione vecchia, senza i canali nuovi** (niente `tti`, contatori o `sr` AMS2): ogni passo interessato risulta `na` con il motivo, nessun `fix` costruito su zeri. → test in Task 5.
2. **Un solo giro o un segmento corto dopo un cambio setup:** la riga dice "completa ancora N giri" con N corretto, e nessun passo viene giudicato. → test in Task 5.
3. **Auto R3E senza temperature freni (`-1`):** il passo 1 è `na` e si passa al 2, senza dividere per zero. → test in Task 5.
4. **AMS2 nei primi chilometri, raggio non ancora stimato:** `sr` è assente, non `[0,0,0,0]`, e `channel-log` scrive "assente". → test in Task 3.
5. **Sessione ACE o AMS2 con i flag Leaderboard o Setup Fisso salvati a 1 nel DB** (default della colonna): la scaletta va calcolata lo stesso, perché i flag valgono solo per R3E. → test in Task 6.

---

### Task 1: canali `tti/ttc/tto` nei tipi, in `aggregateZones` e in `channel-log`

**Files:**
- Create: `src/main/tyre-temps.ts`, `src/main/tyre-temps.selfcheck.ts`
- Modify: `src/shared/types.ts` (`CompactFrame` riga ~67, `ZoneData` riga ~120), `src/main/lap-recorder.ts` (`quartetFrom`/`quartet`, `zones.push`), `src/main/channel-log.ts` (`formatChannels`), `src/shared/CLAUDE.md` (descrizione di `types.ts`: i tre canali nuovi), elenco dei self-check in `CLAUDE.md` (aggiungere `tyre-temps`; i Task 3, 4 e 5 aggiungono `ams2-slip`, `ladder-counters` e `setup-ladder`)
- Test: `src/main/tyre-temps.selfcheck.ts`, `src/main/lap-recorder.selfcheck.ts`, `src/main/channel-log.selfcheck.ts`

**Interfaces:**
- Produces:
  - `CompactFrame.tti?`, `CompactFrame.ttc?`, `CompactFrame.tto?`: `number[]`, °C `[FL, FR, RL, RR]`, cioè spalla interna, centro, spalla esterna;
  - `ZoneData.avgTyreTempInnerC?`, `ZoneData.avgTyreTempCenterC?`, `ZoneData.avgTyreTempOuterC?`: `[number, number, number, number]`;
  - `leftRightToInnerOuter(left: number[], right: number[]): [inner: number[], outer: number[]]`: ruote sinistre (indici 0, 2) interna = right ed esterna = left; ruote destre (1, 3) interna = left ed esterna = right;
  - `surfaceTemps(inner: number[], center: number[], outer: number[]): Pick<CompactFrame, "tti" | "ttc" | "tto">`: restituisce `{}` se anche un solo valore è `<= 0` (copre R3E `-1` e lo `0` UNSET di AMS2), altrimenti i tre quartetti arrotondati a 0,1 °C.

- [ ] **Step 1: scrivi i test che falliscono**

`tyre-temps.selfcheck.ts`:
```ts
const [inner, outer] = leftRightToInnerOuter([10, 20, 30, 40], [11, 21, 31, 41]);
assert.deepEqual(inner, [11, 20, 31, 40]);
assert.deepEqual(outer, [10, 21, 30, 41]);
assert.deepEqual(surfaceTemps([84.04, 1, 1, 1], [81.06, 1, 1, 1], [81, 1, 1, 1]), {
  tti: [84, 1, 1, 1], ttc: [81.1, 1, 1, 1], tto: [81, 1, 1, 1],
});
assert.deepEqual(surfaceTemps([-1, 80, 80, 80], [80, 80, 80, 80], [80, 80, 80, 80]), {});
assert.deepEqual(surfaceTemps([80, 80, 80, 80], [0, 80, 80, 80], [80, 80, 80, 80]), {});
```
In `lap-recorder.selfcheck.ts`, due frame con `tti: [80,80,80,80]` e `[82,82,82,82]` nella stessa zona danno `avgTyreTempInnerC` `[81,81,81,81]`; frame senza `tti` danno `avgTyreTempInnerC === undefined`.
In `channel-log.selfcheck.ts`:
- il frame "bare" contiene `sup=assente`;
- il frame "full" con `tti:[85,80,72,74], ttc:[83,81,73,73], tto:[80,82,74,72]` contiene `sup(I-C-E)=85-83-80/80-81-82/72-73-74/74-73-72°C`.

- [ ] **Step 2: verifica che falliscano**

Run: `npm run selfcheck`
Expected: FAIL. `tsc` non trova `./tyre-temps.js` né i campi `tti/ttc/tto`.

- [ ] **Step 3: implementa**

- Aggiungi i tipi.
- Crea `tyre-temps.ts` con le due funzioni.
- In `lap-recorder.ts` estendi la chiave di `quartetFrom` a `"tti" | "ttc" | "tto"` ed emetti i tre campi `ZoneData` con lo stesso pattern di `avgTyreTempC`.
- In `formatChannels` aggiungi, dopo `temp=…°C`, il pezzo `sup(I-C-E)=…°C`: per ogni ruota `tti-ttc-tto` con `toFixed(0)`, ruote separate da `/`, oppure `sup=assente` se manca `tti`.

- [ ] **Step 4: verifica che passino**

Run: il gate completo.
Expected: tutti e cinque a exit 0, `tyre-temps self-check OK` nell'output.

- [ ] **Step 5: commit (dopo conferma)**: `feat(telemetry): canali temperatura superficiale interna/centro/esterna`

---

### Task 2: R3E e ACE leggono le temperature superficiali

**Files:**
- Modify: `src/main/r3e/r3e-reader.ts` (righe ~146-170 e il `return` del frame, riga ~263), `src/main/ace/ace-struct.ts` (`PHY`, riga ~150), `src/main/ace/ace-reader.ts` (righe ~395 e ~563), `src/main/CLAUDE.md` (tabella di copertura)

**Interfaces:**
- Consumes: `leftRightToInnerOuter`, `surfaceTemps` (Task 1).
- Produces: `PHY.tyreTempI = 368`, `PHY.tyreTempM = 384`, `PHY.tyreTempO = 400` (float[4]).

- [ ] **Step 1: R3E**

- Leggi `TireTemp_{FL,FR,RL,RR}_{Left,Center,Right}`: i nomi sono già mappati in `r3e-struct.ts`.
- `const [inner, outer] = leftRightToInnerOuter(left, right)`.
- Spalma `...surfaceTemps(inner, center, outer)` nel frame che va in `lapFrames`.
- Segui il percorso del campo `tt` per capire quale oggetto finisce nel `CompactFrame`.
- Il commento dice che l'orientamento è **assunto** (spec, "Dati nuovi"), da confermare in curva lunga.

- [ ] **Step 2: ACE**

- Aggiungi i tre offset a `PHY`, con il commento "not verified on a live sim".
- Leggi i tre `readFloatArray(physBuf, …, 4)` e spalma `...surfaceTemps(i, m, o)` nel `CompactFrame` (riga ~563).
- `tt` resta `tyreCoreTemperature`.

- [ ] **Step 3: documentazione**

In `src/main/CLAUDE.md`, sotto `tt` nella tabella "Per-game channel coverage", aggiungi la riga `tti` / `ttc` / `tto`:
- R3E: `TireTemp_*_Left/Center/Right` orientati ("left" = esterna sulle ruote sinistre, interna sulle destre; **assunto**);
- ACE: `tyreTempI/M/O` @368/384/400 (**non verificati**);
- AMS2: lasciare "Task 3".

- [ ] **Step 4: gate**

Run: il gate completo. Expected: exit 0.

- [ ] **Step 5: commit (dopo conferma)**: `feat(r3e,ace): temperature superficiali interna/centro/esterna`

---

### Task 3: AMS2, temperature superficiali e slip ratio calcolato

**Files:**
- Create: `src/main/ams2/ams2-slip.ts`, `src/main/ams2/ams2-slip.selfcheck.ts`
- Modify: `src/main/ams2/ams2-struct.ts` (`OFF`), `src/main/ams2/ams2-struct.selfcheck.ts`, `src/main/ams2/ams2-reader.ts` (lettura ~285, frame ~361, `start` ~436), `src/main/CLAUDE.md` (riga `sr`, riga `tti/ttc/tto`, voce `ams2-reader.ts`)

**Interfaces:**
- Consumes: `leftRightToInnerOuter`, `surfaceTemps` (Task 1).
- Produces:
  - `OFF.tyreRPS = 7040` (float[4], in **rad/s** nonostante il nome; `mTyreSlipSpeed` @7056 sta in mezzo a 7040 e `mTyreTemp` @7072);
  - `OFF.tyreTempLeft = 20328`, `OFF.tyreTempCenter = 20344`, `OFF.tyreTempRight = 20360`;
  - `type SlipSample = { speedMps: number; wheelRadS: number[]; brake: number; throttle: number; steering: number; gLat: number }`;
  - `createSlipEstimator(): { slip: (s: SlipSample) => number[] | undefined; reset: () => void }`.

Comportamento di `slip`:
- Un campione è "rotolamento puro" quando:
  - `speedMps > 50 / 3.6`;
  - `brake === 0`;
  - `throttle < 0.05`;
  - `|steering| < 0.02`;
  - `|gLat| < 0.05`.
- Per ogni ruota si accumulano i primi **100** campioni di questo tipo di `speedMps / |ω|`, poi il raggio si congela alla loro mediana (`// ponytail: radius frozen after 100 samples, rolling median if tyre wear/pressure drift matters`).
- Finché il raggio non è congelato, `slip` restituisce `undefined`.
- Dopo: `speedMps < 1` → `[0,0,0,0]`; altrimenti `(r·|ω| − v) / v` per ruota.
- `// ponytail:` sul bias di circa l'1% delle motrici in rilascio (spec).

- [ ] **Step 1: scrivi i test che falliscono**

`ams2-slip.selfcheck.ts`:
```ts
const est = createSlipEstimator();
const roll = (v: number, w: number): SlipSample =>
  ({ speedMps: v, wheelRadS: [w, w, w, w], brake: 0, throttle: 0, steering: 0, gLat: 0 });
for (let i = 0; i < 99; i++) assert.equal(est.slip(roll(50, 50 / 0.33)), undefined);
est.slip(roll(50, 50 / 0.33)); // 100th sample freezes r = 0.33
const locked = est.slip({ ...roll(40, (40 * 0.8) / 0.33), brake: 1 })!;
assert.ok(Math.abs(locked[0] - -0.2) < 1e-6);
assert.deepEqual(est.slip({ ...roll(0.5, 1), brake: 1 }), [0, 0, 0, 0]);
est.reset();
assert.equal(est.slip({ ...roll(40, 100), brake: 1 }), undefined);
// a braking sample never calibrates
const est2 = createSlipEstimator();
for (let i = 0; i < 200; i++) est2.slip({ ...roll(50, 50 / 0.33), brake: 0.5 });
assert.equal(est2.slip(roll(50, 50 / 0.33)), undefined);
```
In `ams2-struct.selfcheck.ts`:
- `OFF.tyreRPS === 7040`, `OFF.tyreRPS + 32 === OFF.tyreTemp`;
- `OFF.tyreTempCenter - OFF.tyreTempLeft === 16`, `OFF.tyreTempRight - OFF.tyreTempCenter === 16`;
- `OFF.tyreTempRight + 16 <= AMS2_STRUCT_SIZE`.

- [ ] **Step 2: verifica che falliscano**

Run: `npm run selfcheck`
Expected: FAIL. Mancano il modulo e gli offset.

- [ ] **Step 3: implementa**

- Gli offset e `ams2-slip.ts`.
- Nel reader:
  - un `createSlipEstimator()` per istanza del reader, `reset()` dentro `start`;
  - a ogni frame `est.slip({ speedMps: speed, wheelRadS: readFloatArray(buf, OFF.tyreRPS, 4), brake, throttle, steering, gLat: localAcc[0] / G })`;
  - se il risultato non è `undefined`, scrivi `sr` nel `CompactFrame`;
  - spalma `...surfaceTemps(...leftRightToInnerOuter(left, right) …)` con l'ordine `inner, center, outer`;
  - sostituisci il commento "No `sr`…" con uno che descrive la stima.
- Il commento ponytail sul TC euristico (~307) resta.

- [ ] **Step 4: documentazione**

In `src/main/CLAUDE.md`:
- riga `sr`, colonna AMS2: "derivato da `mTyreRPS` (rad/s) con raggio stimato in rotolamento puro (mediana di 100 campioni, rifatta a ogni avvio del reader); assente finché non stimato";
- riga `tti/ttc/tto`, colonna AMS2: `mTyreTempLeft/Center/Right` @20328/20344/20360, stessa orientazione di R3E, **non verificati**;
- nella frase "R3E's slip ratio is derived" aggiungi AMS2.

- [ ] **Step 5: gate**

Run: il gate completo. Expected: exit 0, con `ams2-slip self-check OK` e `ams2-struct self-check OK`.

- [ ] **Step 6: commit (dopo conferma)**: `feat(ams2): slip ratio da mTyreRPS e temperature superficiali`

---

### Task 4: contatori per zona della scaletta (`ladder-counters.ts`)

**Files:**
- Create: `src/main/ladder-counters.ts`, `src/main/ladder-counters.selfcheck.ts`
- Modify: `src/shared/types.ts` (`ZoneData`), `src/main/lap-recorder.ts` (`aggregateZones`: una chiamata e lo spread per zona)

**Interfaces:**
- Produces: campi opzionali di `ZoneData`, tutti conteggi interi.
  - Sempre presenti:
    - `hardBrakeFrames`: frame con `brk > 0.30`;
    - `absHardBrakeFrames`: di questi, quelli con `abs > 0`.
  - Solo se i frame della zona hanno `sr`:
    - `lockFramesFront` / `lockFramesRear`: frame di frenata forte con almeno una ruota dell'asse a `sr < -0.25` (decisione utente, da tarare);
    - `downshifts`: `gear` scende, `prev.gear > 0`, `brk > 0 || thr <= 0.05`;
    - `nervousDownshifts`: scalate che entro **500 ms** (`ts`) hanno una posteriore a `sr < -0.10` (decisione utente, da tarare);
    - `exitFrames`: `thr > 0.5 && |str| > 0.05`;
    - `spinFramesFront` / `spinFramesRear`: frame di uscita con `|sr[0]−sr[1]| > 0.15` (o `|sr[2]−sr[3]|`).
  - Solo se i frame hanno `gLat`: `cornersEntry`, `cornersEntryUnder`, `cornersEntryOver`, `cornersExit`, `cornersExitOver`.
  - Ogni scalata o curva si attribuisce alla zona del suo primo frame.
- `export type LadderCounters = Pick<ZoneData, …i campi sopra…>`
- `export const ladderCounters = (frames: CompactFrame[], zoneOf: (d: number) => number): Map<number, LadderCounters>`

Algoritmo delle curve (spec, passo 2), non determinato dalla firma:
- Una curva è una sequenza contigua di frame con `|str| > 0.05`. Due sequenze separate da meno di **300 ms** si uniscono. Le curve che durano meno di **1000 ms** si scartano.
- Per ogni frame di curva con `v = spd/3.6 > 10`: `k = |gLat| / (v² · |str|)`.
- Fasi: entrata `brk > 0.05`; centro `brk <= 0.05 && thr <= 0.20`; uscita `thr > 0.50`. Una fase vale con almeno **3** frame, `kPhase` è la sua media.
- `cornersEntry` +1 se entrata e centro valgono. Poi `kEntry < 0.85·kMid` → `cornersEntryUnder` +1; `kEntry > 1.15·kMid` → `cornersEntryOver` +1.
- Lo stesso per l'uscita: `cornersExit` +1 se uscita e centro valgono, `kExit > 1.15·kMid` → `cornersExitOver` +1.

- [ ] **Step 1: scrivi i test che falliscono**

`ladder-counters.selfcheck.ts`, frame sintetici a 16 ms con `ts` crescente, `zoneOf = (d) => Math.floor(d / 50)`:
- 10 frame `brk: 0.8`, `sr: [-0.2, -0.2, 0, 0]`, `abs: 0` in zona 0 → `hardBrakeFrames 10`, `lockFramesFront 10`, `lockFramesRear 0`, `absHardBrakeFrames 0`.
- Gli stessi frame senza `sr` → `lockFramesFront === undefined`, `hardBrakeFrames 10`.
- Scalata 4→3 con `brk: 0.5`, seguita entro 200 ms da un frame con `sr[2] = -0.08` → `downshifts 1`, `nervousDownshifts 1`. La stessa con lo slip a 600 ms → `nervousDownshifts 0`.
- Curva di 2 s con `str: 0.2`, `spd: 108` (30 m/s):
  - 40 frame entrata, `brk 0.3`, `gLat 0.6`;
  - 40 frame centro, `brk 0`, `thr 0`, `gLat 1.0`;
  - 40 frame uscita, `thr 0.8`, `gLat 1.0`.

  Risultato: `cornersEntry 1`, `cornersEntryUnder 1`, `cornersExit 1`, `cornersExitOver 0`.
- La stessa curva con l'uscita a `gLat 1.3` → `cornersExitOver 1`.
- Curva di 0,5 s → nessun conteggio di curve.
- Uscita con `sr: [0, 0, 0.25, 0.02]` → `spinFramesRear` uguale al numero di frame di uscita.

Questi conteggi sono raccolti in un'unica curva e attribuiti alla zona del primo frame: costruisci la curva dentro zona 0 o somma i valori di tutte le zone nel test.

In `lap-recorder.selfcheck.ts`: `aggregateZones` su frame di frenata forte espone `hardBrakeFrames` sulla zona.

- [ ] **Step 2: verifica che falliscano**

Run: `npm run selfcheck`. Expected: FAIL, il modulo non esiste.

- [ ] **Step 3: implementa `ladderCounters`**

In `aggregateZones`:
- `const counters = ladderCounters(frames, (d) => Math.min(Math.floor(d / ZONE_SIZE_M), numZones - 1))`;
- `...counters.get(z)` in `zones.push`;
- se la zona ha frame, emetti sempre `hardBrakeFrames` e `absHardBrakeFrames`, anche a 0.

- [ ] **Step 4: gate**

Run: il gate completo. Expected: exit 0, con `ladder-counters self-check OK`.

- [ ] **Step 5: commit (dopo conferma)**: `feat(lap-recorder): contatori per zona della scaletta setup`

---

### Task 5: giudizio della scaletta (`setup-ladder.ts`) e `SessionStats.setupLadder`

**Files:**
- Create: `src/main/coach/setup-ladder.ts`, `src/main/coach/setup-ladder.selfcheck.ts`
- Modify: `src/main/coach/session-stats.ts` (`SessionStats`, `ComputeStatsInput`, `return`), `src/main/coach/session-stats.selfcheck.ts`, `src/main/coach/prompt-builder.selfcheck.ts` (fixture `SessionStats`: `setupLadder: null`)

**Interfaces:**
- Consumes: i campi di `ZoneData` dei Task 1 e 4, `LapRow` (`setup_id`, `valid`, `lap_number`, `zones_json`).
- Produces:
```ts
export type LadderStatus = "ok" | "fix" | "na";
export type LadderStep = {
  n: 1 | 2 | 3 | 4 | 5 | 6;
  label: string;          // "condotti freni" | "bilanciamento freni" | "freno motore" | "pressioni" | "campanatura" | "differenziale"
  status: LadderStatus;
  reason: string;         // Italian, numbers + direction (fix) or why (na); built here
  proposable: boolean;    // false only for step 1 under fixedSetup
};
export type TyreSummary = {
  setupLabel: string | null;
  judgedLaps: number;
  hotPressurePsi: Quartet | null;
  deltaC: Quartet;              // centre − mean(shoulders), mean of per-lap values
  innerMinusOuterC: Quartet;
  pressureState: ("alta" | "ok" | "bassa")[]; // majority of judged laps
  driftPsi: Quartet | null;     // last − first judged lap, only with ≥ 3 judged laps
};
export type SetupLadder = {
  setupLabel: string | null;
  firstJudgedLap: number | null;
  lastJudgedLap: number | null;
  judgedLaps: number;
  lapsMissing: number;          // > 0 ⇒ steps is []
  steps: LadderStep[];
  current: number | null;       // n of the first step with status "fix" && proposable
  tyres: TyreSummary[];         // one per setup segment with ≥ 2 judged laps, chronological; the last is the judged one when lapsMissing = 0
};
export const computeSetupLadder = (
  laps: LapRow[],
  setupLabelById: Map<number, string>,
  opts: { fixedSetup: boolean },
): SetupLadder;
```
- `SessionStats.setupLadder: SetupLadder | null`. È `null` quando `ComputeStatsInput.leaderboardMode` è vero.
- `ComputeStatsInput` guadagna `leaderboardMode?: boolean; fixedSetup?: boolean`.

Costanti, con nomi e valori dallo spec:
- `WARMUP_LAPS = 3`, `MIN_JUDGED_LAPS = 2`;
- `DUCT_FRONT_MAX_C = 700`, `DUCT_IMBALANCE = 0.20`;
- `LOCK_SHARE = 0.05`, `LOCK_RATIO = 2`, `ABS_SHARE = 0.20`;
- `NERVOUS_SHARE = 0.20`;
- `TYRE_BALANCE_TOL_C = 1.25`, `CAMBER_MIN_C = 2`, `CAMBER_MAX_C = 10`;
- `DIFF_SPIN_SHARE = 0.20`;
- `DRIVEN_SLIP_EPS = 0.01`.

Regole, non determinate dalla firma:
- **Segmento:** i giri finali consecutivi con lo stesso `setup_id` dell'ultimo giro (`null` compreso). Giudicati: i giri del segmento in posizione ≥ 4 (posizione contata su tutti i giri, validi o no) e `valid`.
  - `lapsMissing = max(0, WARMUP_LAPS − lunghezzaSegmento) + max(0, MIN_JUDGED_LAPS − giudicati)` quando `giudicati < MIN_JUDGED_LAPS`, altrimenti 0.
  - Le somme dei contatori usano solo le zone dei giri giudicati. Un campo assente in tutte le zone significa "manca il dato" e porta a `na`.
- **Trazione:**
  - dalla media di `avgSlipRatioThrottle` sui giri giudicati, `rear − front > DRIVEN_SLIP_EPS` → `"rwd"`, `front − rear > DRIVEN_SLIP_EPS` → `"fwd"`, altrimenti `"awd"`;
  - senza slip → `"unknown"`;
  - asse motore per il passo 6: anteriore se `"fwd"`, altrimenti posteriore.
- **Passo 1:**
  - media per asse di `avgBrakeTempC` (scarta i `-1`), `sbil = |ant−post| / max(ant, post)`;
  - `fix` se `ant > 700` ("→ aprire i condotti anteriori") oppure `sbil > 0.20` ("→ aprire i condotti dell'asse più caldo, o chiudere quelli dell'asse più freddo");
  - `na` "temperature freni non disponibili".
  - `reason` d'esempio: `ant 612 °C, post 548 °C, sbil. 10 %`.
- **Passo 2:**
  - `hasAbs = Σ absHardBrakeFrames > 0`; `Σ hardBrakeFrames === 0` → `na` "nessuna frenata forte".
  - Con ABS:
    - `absShare = Σ absHard / Σ hard`;
    - `entryUnder = cornersEntryUnder > cornersEntry / 2` (`na` "manca l'accelerazione laterale" se `cornersEntry` è assente o 0);
    - `fix` se `absShare > 0.20 && entryUnder` → "bilanciamento verso il posteriore".
  - Senza ABS:
    - quote `lockFront/hard` e `lockRear/hard` (`na` "manca lo slip" se `lockFramesFront` è assente);
    - `fix` se un asse ha quota > 0.05 e ≥ 2× l'altro. Con l'altro a 0 basta la prima condizione;
    - anteriore → "verso il posteriore", posteriore → "verso l'anteriore".
- **Passo 3:**
  - `"fwd"` → `na` "trazione anteriore";
  - `downshifts` assente → `na` "manca lo slip";
  - 0 scalate → `na` "nessuna scalata";
  - `fix` se `nervous/downshifts > 0.20` → "coast ramp più aperta; se è già al minimo, meno freno motore (su AMS2 engine braking più alto = meno freno motore)".
- **Passo 4:** per giro e per ruota, media sulle zone di `Δ = center − (inner + outer)/2`; stato del giro `> +1.25` alta, `< −1.25` bassa.
  - Lo stato della ruota è quello della maggioranza stretta dei giri giudicati, altrimenti `ok`.
  - `fix` se almeno una ruota non è ok. `reason`: Δ delle ruote fuori soglia e direzione per ruota.
  - `na` "mancano le temperature interna/centro/esterna".
  - `hotPressurePsi` dalla media di `avgTyrePressure`.
- **Passo 5:** solo per le ruote con pressione `ok`.
  - `d = inner − outer`, per giro e poi a maggioranza come al passo 4.
  - `d < 2` → "più campanatura negativa", `d > 10` → "meno campanatura negativa".
  - Nessuna ruota con pressione ok → `na` "nessuna ruota con pressione a posto". Mancano le temperature → `na` come al passo 4.
- **Passo 6:**
  - `exitFrames` assente → `na` "manca lo slip";
  - `cornersEntry` assente → `na` "manca l'accelerazione laterale";
  - in ordine: quota `spinFrames(asse motore)/exitFrames > 0.20` → `fix` "chiudere la power ramp (più bloccaggio)";
  - altrimenti `cornersExitOver > cornersExit/2` → `fix` "aprire la power ramp";
  - altrimenti `cornersEntryOver > cornersEntry/2` → `fix` "chiudere la coast ramp; se è già al minimo, più precarico";
  - altrimenti `ok`.
- **`fixedSetup`:** solo i passi 1 e 2, il passo 1 con `proposable: false`.
- **`current`:** il primo passo con `status === "fix" && proposable`.

- [ ] **Step 1: scrivi i test che falliscono**

`setup-ladder.selfcheck.ts`, con un `mkLap` come quello di `session-stats.selfcheck.ts` e `zone()` con i campi della scaletta:
- **Selezione dei giri:**
  - segmento di 2 giri → `lapsMissing 3` (1 di riscaldamento + 2 giudicati), `steps.length 0`;
  - 4 giri con `setup_id 3`, poi 5 giri validi con `setup_id 7` (lap_number 5-9) → `judgedLaps 2`, `firstJudgedLap 8`, `lastJudgedLap 9`;
  - 6 giri di cui il quarto non valido → `judgedLaps 2`.
- **Passo 1:**
  - zone con `avgBrakeTempC [720,720,400,400]` → `status "fix"`;
  - `[450,450,250,250]` → `fix` (sbil. 44 %);
  - `[600,600,560,560]` → `ok`;
  - `[-1,-1,-1,-1]` → `na`, e `current` non è 1.
- **Passo 2 senza ABS:**
  - `hardBrakeFrames 100, lockFramesFront 8, lockFramesRear 2` → `fix`, `reason` contiene "posteriore";
  - `lockFramesFront 8, lockFramesRear 6` → `ok`.
- **Passo 2 con ABS:**
  - `absHardBrakeFrames 30/100`, `cornersEntry 4`, `cornersEntryUnder 3` → `fix`;
  - con `cornersEntryUnder 1` → `ok`.
- **Passo 3:** `downshifts 10, nervousDownshifts 3` → `fix`; con `avgSlipRatioThrottle [0.08,0.08,0.01,0.01]` (fwd) → `na`.
- **Passo 4, i quattro punti di calibrazione** (inner/center/outer per ruota):
  - `84/81/81` → `bassa`;
  - `73/73/70` → `alta`;
  - `89/88/87` → `ok`;
  - `85/83/79` → `ok`.
- **Passo 5:** ruota ok con `80/80/79` → `fix` "più"; `92/85/80` → `fix` "meno"; ruota con pressione alta → ignorata.
- **Passo 6:** `exitFrames 100, spinFramesRear 30` → `fix` "chiudere la power ramp".
- **Sessione vecchia** (zone con soli campi base) → tutti i passi `na`, `current null`.
- **`fixedSetup`** con il passo 1 `fix` e il 2 `fix` → `steps.length 2`, `current 2`.
- **`tyres`:** due segmenti, ciascuno con ≥ 2 giri giudicati → `tyres.length 2`, l'ultimo con `setupLabel` del segmento finale.

In `session-stats.selfcheck.ts`: `leaderboardMode: true` → `setupLadder === null`; senza flag → oggetto non nullo.

- [ ] **Step 2: verifica che falliscano**

Run: `npm run selfcheck`. Expected: FAIL, il modulo non esiste.

- [ ] **Step 3: implementa**

- `computeSetupLadder`;
- in `computeSessionStats`: `setupLadder: input.leaderboardMode ? null : computeSetupLadder(laps, setupLabelById, { fixedSetup: !!input.fixedSetup })`;
- i campi `suspAsym*` e `slipAsym*` restano.

- [ ] **Step 4: gate**

Run: il gate completo. Expected: exit 0, con `setup-ladder self-check OK`.

- [ ] **Step 5: commit (dopo conferma)**: `feat(coach): scaletta setup calcolata in session-stats`

---

### Task 6: prompt e chiamanti

**Files:**
- Modify:
  - `src/main/coach/prompt-builder.ts`: `SESSION_SYSTEM_PROMPT` righe ~53-100, `SYNTHESIS_SYSTEM_PROMPT` righe ~102-128, `buildStatsBlock` righe ~241-370, testo Setup Fisso riga ~433;
  - `src/main/coach/session-coach.ts`: tre chiamate a `computeSessionStats`, righe ~249, ~376, ~511;
  - `src/main/coach/prompt-builder.selfcheck.ts`.

**Interfaces:**
- Consumes: `SetupLadder`, `LadderStep`, `TyreSummary` (Task 5); `pressureUnit`, `wheelQuartet`, `WHEEL_ORDER` (già in `prompt-builder.ts`).

- [ ] **Step 1: scrivi i test che falliscono**

In `prompt-builder.selfcheck.ts`, `buildStatsBlock` con `setupLadder`:
```ts
{ setupLabel: "Gara B", firstJudgedLap: 4, lastJudgedLap: 9, judgedLaps: 6, lapsMissing: 0, current: 4,
  steps: [
    { n: 1, label: "condotti freni", status: "ok", reason: "ant 612 °C, post 548 °C, sbil. 10 %", proposable: true },
    { n: 2, label: "bilanciamento freni", status: "na", reason: "manca lo slip", proposable: true },
    { n: 4, label: "pressioni", status: "fix", reason: "Δ ANT-SX +2.1 °C → abbassare", proposable: true },
    { n: 5, label: "campanatura", status: "ok", reason: "…", proposable: true } ],
  tyres: [{ setupLabel: "Gara B", judgedLaps: 6, hotPressurePsi: [29.6, 29.4, 28.3, 28.1],
            deltaC: [2.1, 1.8, 0.3, -0.2], innerMinusOuterC: [5, 6, 4, 4],
            pressureState: ["alta", "alta", "ok", "ok"], driftPsi: null }] }
```
Asserzioni:
- con `game "ams2"` il blocco contiene:
  - `Scaletta setup (setup "Gara B", giri 4-9, 6 giudicati)`;
  - `2 bilanciamento freni: NON VALUTABILE — manca lo slip`;
  - `4 pressioni: DA CORREGGERE ← PASSO CORRENTE — Δ ANT-SX +2.1 °C → abbassare`;
  - `5 campanatura: ok (da rivedere dopo il passo 4)`;
  - `press. a caldo 2.04/2.03/1.95/1.94 bar`;
  - `stato alta/alta/ok/ok`;
- con `lapsMissing: 3, steps: []` → `Scaletta setup: completa ancora 3 giri con il setup "Gara B"`;
- `proposable: false` → la riga contiene `(non modificabile con Setup Fisso)`;
- `setupLadder: null` → nessun `Scaletta setup`;
- il blocco non contiene più `verifica camber`, `verifica differenziale`;
- `SYNTHESIS_SYSTEM_PROMPT` contiene `PASSO CORRENTE`;
- `SESSION_SYSTEM_PROMPT` non contiene `Copri ogni area`;
- le asserzioni esistenti sui titoli `##` passano invariate.

- [ ] **Step 2: verifica che falliscano**

Run: `npm run selfcheck`. Expected: FAIL sulle nuove asserzioni.

- [ ] **Step 3: `buildStatsBlock`**

Dopo le condizioni ambientali stampa la scaletta nel formato dei test:
- una riga per passo (`  ${n} ${label}: ${STATO} — ${reason}`, con `ok` / `DA CORREGGERE` / `NON VALUTABILE`);
- `← PASSO CORRENTE` sul corrente;
- `(da rivedere dopo il passo N)` dopo i passi successivi al corrente;
- poi la riga gomme per ogni `TyreSummary`: `    Gomme setup "X" (N giri giudicati) (${WHEEL_ORDER}) press. a caldo … ${unità} | Δ centro-spalle … °C | interna-esterna … °C | stato … | deriva …`, con `wheelQuartet` e `pressureUnit` come le righe esistenti; la deriva solo se non nulla.

Togli i suffissi `— verifica camber/altezza da terra`, `— verifica differenziale power` e `— verifica differenziale coast` dalle righe di asimmetria.

- [ ] **Step 4: system prompt**

**`SYNTHESIS_SYSTEM_PROMPT`**: sostituisci il paragrafo "NON concentrare tutte le azioni…" (la riga "Canali di telemetria" resta) con:

> Azioni di setup: segui la "Scaletta setup" dei Dati Calcolati. Proponi AL MASSIMO UNA azione di setup, SOLO sul PASSO CORRENTE, nella direzione indicata dalla sua riga e citandone il dato. Scegli il parametro dal setup caricato (es. rampe oppure bias del geared LSD, a seconda di cosa espone). B = valore a freddo attuale nel setup ± il passo minimo (un click; per le pressioni 0,05 bar su AMS2, 0,7 PSI su ACE, 5 kPa su R3E). Per le pressioni l'azione riguarda l'asse con il |Δ| maggiore, solo le sue ruote fuori soglia, ciascuna nella propria direzione. Senza setup caricato indica solo la direzione, senza "A → B". Se il setup caricato non ha la leva del passo corrente, dillo e usa il passo DA CORREGGERE successivo. Nomina in una riga i passi NON VALUTABILI saltati, con il motivo. Se la scaletta chiede di completare dei giri, l'azione di setup è "completa ancora N giri con questo setup". Senza passo corrente, o senza riga "Scaletta setup", nessuna azione di setup. Le azioni di guida restano libere.

**`SESSION_SYSTEM_PROMPT`**:
- In "### Setup attuale vs proposto" sostituisci "Copri ogni area che i dati sostengono…" con:

  > Prima una tabella "Passo | Stato | Dato" con tutti i passi della riga "Scaletta setup"; i passi dopo il corrente sono "da rivedere dopo", perché cambiano quando cambia il passo corrente. Le proposte numerate riguardano SOLO la leva del passo corrente, con le stesse regole della sintesi (un passo minimo, valori a freddo). Le altre aree (sospensioni, ammortizzatori, barre, altezze, aerodinamica) solo come osservazioni, senza proposte.
- In "### Analisi telemetria", "Osservazioni pressioni gomme" diventa:

  > Osservazioni pressioni gomme: tabella per ruota dalle righe "Gomme setup" (Δ, stato, deriva, per setup se più di uno), con l'avvertenza che ritmo e temperatura asfalto spostano le pressioni (ometti se non disponibili).
- Nella regola "Temperatura freni ideale" aggiungi: `(informativa: il giudizio sui condotti è nella scaletta)`.

**Setup Fisso** (riga ~433): sostituisci "Tutte le altre raccomandazioni… nelle proposte di setup." con:

> La scaletta setup mostra solo i passi 1-2; i condotti (passo 1) non sono modificabili.

- [ ] **Step 5: chiamanti**

Nelle tre chiamate a `computeSessionStats` di `session-coach.ts` passa:
- `leaderboardMode: game === "r3e" && flags.leaderboardMode`;
- `fixedSetup: game === "r3e" && flags.fixedSetup`.

Il commento sopra spiega che le due colonne valgono 1 di default per ogni gioco e che i flag hanno senso solo su R3E, come in `buildSessionContext`.
- Se una chiamata non ha `flags` nello scope, usa il bundle di `loadSessionBundle`.
- Estrai la condizione in un helper locale solo se si ripete identica tre volte.

Test (Review Focus 5): una funzione pura con quella condizione, ad esempio `statsFlags(game, flags)` esportata da `session-coach.ts` o messa in `setup-ladder.ts`, con un'asserzione `ace` + `{leaderboardMode: true}` → `leaderboardMode false`. Se non c'è modo di testarla senza DB, mettila in `setup-ladder.ts` e testala lì.

- [ ] **Step 6: gate**

Run: il gate completo. Expected: exit 0.

- [ ] **Step 7: commit (dopo conferma)**: `feat(coach): Livello 1 e 2 seguono la scaletta setup`

---

## Verifica finale (fuori dal gate, con i sim accesi: la fa l'utente)

1. `npm run dev`, una sessione per gioco: la riga `canali` mostra `sup(I-C-E)=` con decine di °C (non `zeri`). Su AMS2, dopo qualche rettilineo a gas chiuso, `slip=` passa da `assente` a valori vicini a 0.
2. In una curva lunga a destra, la spalla **esterna** delle ruote sinistre (`tto` di FL/RL) dev'essere la più calda. Se è il contrario, inverti `leftRightToInnerOuter` per R3E/AMS2.
3. ACE: in una frenata con bloccaggio `slip` deve andare **negativo**. Se resta positivo o è solo modulo, segnalarlo: i passi 2, 3 e 6 di ACE vanno resi `na`.
4. Una sessione vera di almeno 6 giri con lo stesso setup, poi "Esegui analisi": il Livello 1 propone una sola leva, sul passo corrente.
