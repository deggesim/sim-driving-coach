# Quadro assetto Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sequenza setup completa, l'analisi mostra un quadro di otto aree dell'assetto (molle → aerodinamica) giudicate in TypeScript dalle regole delle guide Frezza, con nuovi canali di telemetria (altezza da terra, carico ruota) e la distribuzione dei pesi.

**Architecture:** I reader aggiungono canali a `CompactFrame`; due moduli puri di contatori (`ladder-counters.ts` esteso, nuovo `chassis-counters.ts`) li riducono per zona dentro `zones_json`; un nuovo modulo puro `setup-overview.ts` giudica le aree sui giri giudicati dell'ultimo segmento (gli stessi della sequenza), usando la distribuzione dei pesi (`weight-distribution.ts`), i valori del setup (`setup-levers.ts`) e la tabella auto AMS2 (`ams2-cars.ts`, generata). `session-stats.ts` espone il risultato, `prompt-builder.ts` lo stampa nei "Dati Calcolati" e i due system prompt lo usano.

**Tech Stack:** TypeScript strict, Electron main process, koffi (SHM), selfcheck assert-based (`npm run selfcheck`), nessun test runner.

**Spec:** `docs/superpowers/specs/2026-10-26-quadro-assetto-design.md` (estende `docs/superpowers/specs/2026-10-20-scaletta-setup-design.md`). Leggere entrambe prima di iniziare.

## Scelte del piano (non nella spec, da far confermare all'utente con il piano)

- **Velocità delle sospensioni derivata dalla corsa** (`sus`, Δ/Δt tra frame) per tutti e tre i giochi, invece di leggere `Player_SuspensionVelocity` (R3E) e `mSuspensionVelocity` (AMS2): un solo metodo, due offset in meno da verificare dal vivo; ACE andava derivata comunque.
- **Estrattore del setup ristretto a molle e ammortizzatori.** Con i proprietari fissi (correzione dell'utente del 2026-10-26) sono gli unici due giudizi che usano numeri del setup; altezze, barre, convergenze, ali e terze molle si propongono come "attuale ± un passo", che il modello legge dal testo del setup come oggi.
- **Uniformità degli ammortizzatori**: dispersione relativa `(max − min) / max` > 5 % sulle quattro ruote, al posto di "oltre un click" (il passo del setup non è conservato).
- **Aggregati in `zones_json`**, come i contatori della sequenza: nessuna modifica allo schema DB.
- **Bumpstop**: "più del 10 % dei giri giudicati" diventa "eventi che scompongono l'auto / giri giudicati > 0,1", perché i contatori sono per zona e non per giro.
- **Carburante**: nuovo canale `fuel` solo su R3E e ACE (gli unici dove la distribuzione si misura).

## Global Constraints

- TypeScript strict; `.ts` per main/shared, `.tsx` per React. Solo arrow function, mai `function` né `class`; `type` e mai `interface` (anche nei file generati nuovi); named exports; import relativi con estensione `.js`.
- Target ES2024+: `toSorted`, `at()`, `Object.groupBy`, `??=` dove servono.
- Testo per il modello, voce e UI in italiano, tono da ingegnere, sempre con numeri. Commenti in inglese, italiano accettato per il copy; accenti veri (`è`, `più`, `perché`).
- Ogni giudizio e ogni numero nasce in TS; il modello cita. Unica eccezione ammessa: "valore attuale ± un passo minimo" (spec, anti-obiettivi).
- Presenza per canale: un canale o un parametro assente produce `na` con motivo, mai uno zero.
- Soglie come costanti nominate in cima al modulo, con i valori della spec.
- Titoli dell'analisi: solo `## Analisi sintetica` e `## Analisi approfondita` sono radici; tutto il resto `###` o più profondo.
- Gate prima di ogni commit: `npm run typecheck && npm run lint && npm run format:check && npm run selfcheck && npm run fallow:check`, tutti a exit 0. `npm run format` è libero.
- **Commit solo dopo conferma esplicita dell'utente** (regola globale dell'utente). Messaggio in italiano scritto in un file temporaneo e passato con `git commit -F <file>`, chiuso da `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Selfcheck: un file `*.selfcheck.ts` sotto `src/` viene raccolto da `scripts/run-selfchecks.mjs`; asserisce all'import.

## Review Focus

1. **ACE ha l'altezza da terra per asse, non per ruota** (`[F, F, R, R]`): un tocco del fondo deve contare un evento per asse, non due. Test in Task 3.
2. **Sessioni registrate prima di questo lavoro** (`zones_json` senza i nuovi campi): ogni area è `na` con motivo, nessuna eccezione, nessuno zero. Test in Task 7.
3. **Regressione del carico degenere** (tutti i campioni alla stessa velocità, meno di 300 campioni, carichi a 0 o −1): distribuzione sconosciuta con motivo, mai `NaN`. Test in Task 5.
4. **Nome auto AMS2 con varianti** (maiuscole, parentesi, spazi doppi) o assente dalla tabella: lookup tollerante, `null` quando manca, molle `na` con motivo. Test in Task 4.
5. **Setup parziale o con formati misti** (solo le molle anteriori, decimali con virgola, "N/m" contro "N/mm"): rapporto molle corretto o `na`, mai un valore inventato. Test in Task 6.

---

### Task 1: Canali `rh`, `wl`, `fuel` nei tre reader

**Files:**
- Modify: `src/shared/types.ts` (`CompactFrame`)
- Modify: `src/main/ams2/ams2-struct.ts` (`OFF`), `src/main/ams2/ams2-struct.selfcheck.ts`, `src/main/ams2/ams2-reader.ts:368-400`
- Modify: `src/main/ace/ace-struct.ts` (`PHY`), `src/main/ace/ace-reader.ts:396` e `:557-585`
- Modify: `src/main/r3e/r3e-reader.ts:165-180`, `:270-282`
- Modify: `src/main/channel-log.ts`, `src/main/channel-log.selfcheck.ts`

**Interfaces:**
- Produces: in `CompactFrame`
  - `rh?: number[]` altezza da terra in metri `[FL, FR, RL, RR]`; ACE `[F, F, R, R]` dal valore per asse;
  - `wl?: number[]` carico ruota in N `[FL, FR, RL, RR]` (R3E, ACE; omesso su AMS2);
  - `fuel?: number` carburante in litri (R3E, ACE).
- Produces: `formatChannels(f)` stampa `alt=` (mm, 1 decimale) e `carico=` (N, 0 decimali) con le stesse parole `assente`/`zeri` degli altri canali.

- [ ] **Step 1: Test che falliscono**

In `src/main/ams2/ams2-struct.selfcheck.ts`:

```ts
// mRideHeight follows mTyreTempRight[4] and mDrsState (uint) in AMS2Page.cs.
assert.equal(OFF.rideHeight, OFF.tyreTempRight + 16 + 4, "mRideHeight");
assert.ok(OFF.rideHeight + 16 <= AMS2_STRUCT_SIZE);
```

In `src/main/channel-log.selfcheck.ts`, su una frame di prova esistente:

```ts
assert.ok(
  formatChannels({ ...frame, rh: [0.052, 0.051, 0.061, 0.06] }).includes(
    "alt=52.0/51.0/61.0/60.0mm",
  ),
);
assert.ok(formatChannels(frame).includes("alt=assente"));
assert.ok(
  formatChannels({ ...frame, wl: [3000, 3100, 3900, 4000] }).includes(
    "carico=3000/3100/3900/4000N",
  ),
);
assert.ok(formatChannels(frame).includes("carico=assente"));
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npm run selfcheck`
Expected: FAIL, `AssertionError` su `mRideHeight` (proprietà inesistente → errore di tipo in `tsc`) o su `alt=`.

- [ ] **Step 3: Implementazione**

- `OFF.rideHeight: 20380` in `ams2-struct.ts` (`float[4] mRideHeight`, **cm**; commento: AMS2 addition, absent from pCARS2 `SharedMemory.h`, source `AMS2Page.cs` of AMS2SharedMemoryNet, not yet verified live).
- `PHY.wheelLoad: 72` in `ace-struct.ts` (`float[4]`, N) e `PHY.fuel: 12` se non già usato con questo nome.
- AMS2: `rh` = `readFloatArray(buf, OFF.rideHeight, 4)` / 100. Niente `wl`, niente `fuel`.
- ACE: `rh` = `[f, f, r, r]` da `readFloatArray(physBuf, PHY.rideHeight, 2)`; `wl` da `PHY.wheelLoad`; `fuel` da `PHY.fuel`.
- R3E: `rh` da `readDoubleArray(buf, "Player_RideHeight", 4)` (unità attesa: metri, da verificare dal vivo in Task 10); `wl` dai `float` di `TireLoad` (aggiungere un `readFloatArray` in `r3e-struct.ts` se manca); `fuel` = `frame.fuelLeft`. Un quartetto con un valore < 0 (−1 = non disponibile) si omette intero, come `tp`.
- `channel-log.ts`: `alt=${quartet(f.rh, 1000, 1)}mm carico=${quartet(f.wl, 1, 0)}N` in coda a `formatChannels`.

- [ ] **Step 4: Verifica**

Run: `npm run typecheck && npm run selfcheck`
Expected: PASS, stesso numero di self-check di prima (nessun file nuovo in questo task).

- [ ] **Step 5: Commit (dopo conferma dell'utente)**

```bash
git add src/shared/types.ts src/main/ams2 src/main/ace src/main/r3e src/main/channel-log.ts src/main/channel-log.selfcheck.ts
git commit -F <file>   # "feat(telemetria): altezza da terra, carico ruota e carburante nei tre reader"
```

---

### Task 2: Contatori di curva per classe di velocità (`ladder-counters.ts`)

**Files:**
- Modify: `src/shared/types.ts` (`ZoneData`)
- Modify: `src/main/ladder-counters.ts`
- Test: `src/main/ladder-counters.selfcheck.ts`

**Interfaces:**
- Produces in `ZoneData` (famiglia "curve", stessa presenza di `cornersEntry`: solo dove una curva comincia e solo se il giro ha `gLat`):
  - `cornersSlow?: number` curve con fase centrale valida e velocità media della fase < 120 km/h;
  - `cornersSlowUnder?: number`, `cornersSlowOver?: number` di quelle, sottosterzo/sovrasterzo a centro curva;
  - `kSlowSum?: number` somma del `k` medio di centro curva delle curve lente;
  - `cornersFast?: number`, `kFastSum?: number` lo stesso per velocità media della fase > 160 km/h.

Costanti (spec, aree 6 e 8): `SLOW_CORNER_KMH = 120`, `FAST_CORNER_KMH = 160`, `MID_OVER_SHARE = 0.15`, `MID_UNDER_MS = 300`, `MID_UNDER_STEER_GAIN = 0.2`, `MID_UNDER_GLAT_FLAT = 0.02`.

- [ ] **Step 1: Test che falliscono**

In `ladder-counters.selfcheck.ts`, con l'helper di frame già presente nel file, costruire curve sintetiche a 60 Hz (`ts` ogni 16 ms) e asserire:

```ts
// Slow corner (90 km/h mid phase), steady: counted, neither under nor over.
assert.equal(slowSteady.cornersSlow, 1);
assert.equal(slowSteady.cornersSlowUnder, 0);
assert.equal(slowSteady.cornersSlowOver, 0);
assert.ok(Math.abs(slowSteady.kSlowSum! - expectedK) < 1e-6);
// Countersteer: 20 % of the mid frames with str·gLat of opposite sign to the corner's majority.
assert.equal(slowCounter.cornersSlowOver, 1);
// Push: for 400 ms |str| rises 30 % while |gLat| stays within 1 %.
assert.equal(slowPush.cornersSlowUnder, 1);
// Fast corner (180 km/h): counted in the fast family only.
assert.equal(fast.cornersFast, 1);
assert.equal(fast.cornersSlow, 0);
// Between 120 and 160 km/h: in neither class.
assert.equal(medium.cornersSlow ?? 0, 0);
assert.equal(medium.cornersFast ?? 0, 0);
// No gLat on the lap: the corner family is absent, not zero.
assert.equal(noGLat.cornersSlow, undefined);
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npm run selfcheck`
Expected: FAIL in `ladder-counters.selfcheck`.

- [ ] **Step 3: Implementazione nel ciclo `for (const corner of corners(frames))`**

- Aggiungere le nuove chiavi a `CORNER_KEYS` (inizializzazione a 0 come oggi) e a `LadderCounters`.
- Classe di velocità = media di `spd` dei frame della fase centrale (quelli già usati per `mid`).
- Sovrasterzo, indipendente dalle convenzioni di segno dei giochi: il segno di maggioranza di `str·gLat` sui frame della fase centrale definisce il verso "normale"; quota di frame con segno opposto > `MID_OVER_SHARE` → `cornersSlowOver`.
- Sottosterzo: esiste una finestra di frame centrali consecutivi lunga ≥ `MID_UNDER_MS` in cui `|str|` finale ≥ `|str|` iniziale × (1 + `MID_UNDER_STEER_GAIN`) e `max|gLat| − min|gLat|` ≤ `MID_UNDER_GLAT_FLAT` × `max|gLat|` → `cornersSlowUnder`.
- `k` della curva = il `mid` già calcolato.

- [ ] **Step 4: Verifica**

Run: `npm run selfcheck`
Expected: PASS.

- [ ] **Step 5: Commit (dopo conferma dell'utente)** — `feat(coach): bilanciamento a centro curva e k per classe di velocità`

---

### Task 3: Contatori del telaio (`chassis-counters.ts`)

**Files:**
- Create: `src/main/chassis-counters.ts`
- Modify: `src/shared/types.ts` (`ZoneData` + tipi sotto), `src/main/lap-recorder.ts` (`aggregateZones`, accanto a `ladderCounters`)
- Test: `src/main/chassis-counters.selfcheck.ts`

**Interfaces:**
- Produces in `src/shared/types.ts`:

```ts
export type RideHeightSums = {
  minF: number; minR: number; // m, minimum over the zone
  straightF: number; straightR: number; straightN: number; // fast-straight sums
  midF: number; midR: number; midN: number; // mid-corner sums
};
export type BottomingCounts = {
  straight: number; brake: number; other: number; // events by phase
  upset: number; // brake/other events followed by an upset
  front: number; rear: number; // events by axle
};
export type LoadFitSums = {
  n: number; sx: number; sxx: number; // x = v² (m²/s²)
  syF: number; syR: number; sxyF: number; sxyR: number; // y = axle load (N)
  fuelSum: number; fuelN: number;
};
export type SuspOscCounts = { peaks: number; oscillating: number };
export type StraightSteer = { metres: number; reversals: number };
```

  e in `ZoneData`: `rideHeight?: RideHeightSums; bottoming?: BottomingCounts; loadFit?: LoadFitSums; suspOsc?: SuspOscCounts; straightSteer?: StraightSteer;`.
- Produces: `export const chassisCounters = (frames: CompactFrame[], zoneOf: (d: number) => number): Map<number, ChassisCounters>` con `ChassisCounters = Pick<ZoneData, "rideHeight" | "bottoming" | "loadFit" | "suspOsc" | "straightSteer">`. Ogni famiglia è presente solo se il giro ha il canale sorgente: `rh` per `rideHeight`/`bottoming`, `wl` per `loadFit`, `sus` per `suspOsc`, `gLat` per `straightSteer`.

Costanti (spec): `BOTTOM_M = 0.003`, `BOTTOM_MIN_FRAMES = 3`, `FAST_STRAIGHT_SHARE = 0.7` (della velocità massima del giro), `STRAIGHT_GLAT = 0.3`, `HARD_BRAKE = 0.3`, `UPSET_WINDOW_MS = 500`, `UPSET_GLAT = 0.3`, `LOAD_GLAT = 0.05`, `LOAD_GLON = 0.05`, `LOAD_STEER = 0.02`, `LOAD_MIN_KMH = 30`, `SV_PEAK = 0.1` (m/s, da tarare per gioco), `OSC_WINDOW_MS = 1000`, `OSC_REL = 0.3`, `OSC_HALF_CYCLES = 3`, `STEER_STRAIGHT_KMH = 150`, `STEER_STRAIGHT_GLAT = 0.2`, `STEER_REVERSAL = 0.01`.

- [ ] **Step 1: Test che falliscono**

```ts
// Bottoming on a fast straight: one event per axle touching, front only.
assert.deepEqual(z(straightTouch).bottoming, { straight: 1, brake: 0, other: 0, upset: 0, front: 1, rear: 0 });
// ACE-style [F, F, R, R]: both front wheels below 3 mm → still ONE front event.
assert.equal(z(aceTouch).bottoming!.front, 1);
// 2 frames below 3 mm: not an event.
assert.equal(z(shortTouch).bottoming!.front, 0);
// Under braking, followed within 500 ms by a steer sign flip and |ΔgLat| 0.4 g → upset.
assert.equal(z(brakeUpset).bottoming!.upset, 1);
// No `rh` on the lap: families absent.
assert.equal(z(noRh).rideHeight, undefined);
assert.equal(z(noRh).bottoming, undefined);
// Load fit: only straight, steady, ≥ 30 km/h frames; sums exact.
assert.equal(z(loadLap).loadFit!.n, expectedN);
assert.ok(Math.abs(z(loadLap).loadFit!.sxyF - expectedSxyF) < 1e-3);
// Oscillation: a 0.2 m/s peak followed by 4 half-cycles above 30 % within 1 s.
assert.deepEqual(z(oscLap).suspOsc, { peaks: 1, oscillating: 1 });
// Straight steering: 3 reversals of 0.02 over 1000 m at 200 km/h, |gLat| 0.05.
assert.deepEqual(z(weaveLap).straightSteer, { metres: 1000, reversals: 3 }); // metres within ±1 %
```

- [ ] **Step 2: Verifica che falliscano**

Run: `npm run selfcheck`
Expected: FAIL (modulo inesistente).

- [ ] **Step 3: Implementazione**

- Assi da `rh`: anteriore = `min(rh[0], rh[1])`, posteriore = `min(rh[2], rh[3])`. Un evento per asse: ≥ `BOTTOM_MIN_FRAMES` frame consecutivi sotto `BOTTOM_M`; fase dal primo frame (rettilineo veloce: `spd > FAST_STRAIGHT_SHARE × max spd del giro` e `|gLat| < STRAIGHT_GLAT` e `brk ≤ HARD_BRAKE`; frenata: `brk > HARD_BRAKE`; altro: il resto); `upset` solo per frenata/altro: entro `UPSET_WINDOW_MS` cambio di segno di `str` e `max gLat − min gLat > UPSET_GLAT`. L'evento va nella zona del primo frame.
- `rideHeight`: `minF/minR` per zona; somme "rettilineo veloce" con la stessa definizione; somme "centro curva" con `|str| > 0.05`, `brk ≤ 0.05`, `thr ≤ 0.2`.
- `loadFit`: frame con `|gLat| < LOAD_GLAT`, `|gLon| < LOAD_GLON`, `|str| < LOAD_STEER`, `spd ≥ LOAD_MIN_KMH`, `wl` tutto > 0; `x = (spd/3.6)²`, `y` = somma dei due carichi dell'asse; `fuel` sommato solo se presente.
- `suspOsc`: velocità per ruota `Δsus/Δt` tra frame consecutivi; picco = `|v| > SV_PEAK` e massimo locale; nella finestra successiva di `OSC_WINDOW_MS` contare i cambi di segno con `|v| > OSC_REL × picco`; ≥ `OSC_HALF_CYCLES` → `oscillating`. La ricerca del picco successivo riparte dopo la finestra.
- `straightSteer`: frame con `spd > STEER_STRAIGHT_KMH` e `|gLat| < STEER_STRAIGHT_GLAT`; `metres += spd/3.6 × Δt`; inversione = cambio di verso di `str` con ampiezza dall'ultimo estremo > `STEER_REVERSAL`.
- `aggregateZones`: `...chassis.get(z)` accanto a `...counters.get(z)`, stessa forma.

- [ ] **Step 4: Verifica**

Run: `npm run selfcheck`
Expected: PASS.

- [ ] **Step 5: Commit (dopo conferma dell'utente)** — `feat(coach): contatori del telaio per zona (fondo, altezze, carichi, oscillazioni, rettilineo)`

---

### Task 4: Tabella auto AMS2

**Files:**
- Create: `scripts/update-ams2-cars.mjs`
- Create (generato): `src/main/ams2/ams2-cars.ts`
- Create: `src/main/ams2/ams2-car-lookup.ts`
- Test: `src/main/ams2/ams2-car-lookup.selfcheck.ts`
- Modify: `.prettierignore`, `.fallowrc.json` (`ignorePatterns`), come per `src/main/db/r3e-corners.ts`

**Interfaces:**
- Produces in `ams2-cars.ts`:

```ts
export type Ams2Car = {
  name: string; weightKg: number; frontPct: number; // 43.8 for "43.8 / 56.2"
  driveline: string; differential: string; tankL: number | null;
};
export const AMS2_CARS: Ams2Car[] = [/* generated */];
```

- Produces: `export const findAms2Car = (name: string): Ams2Car | null` in `ams2-car-lookup.ts`.

- [ ] **Step 1: Test che fallisce**

```ts
assert.equal(findAms2Car("Porsche 992 GT3 R")?.frontPct, 43.8);
assert.equal(findAms2Car("porsche  992 gt3 r")?.frontPct, 43.8, "case and spaces");
assert.equal(findAms2Car("Porsche 992 GT3 R ")?.weightKg, 1390);
assert.equal(findAms2Car("Mercedes-AMG GT3")?.frontPct, 48);
assert.equal(findAms2Car("Auto Inesistente"), null);
assert.equal(findAms2Car(""), null);
```

- [ ] **Step 2: Verifica che fallisca**

Run: `npm run selfcheck`
Expected: FAIL (modulo inesistente).

- [ ] **Step 3: Script e lookup**

- `scripts/update-ams2-cars.mjs` (Node, `fetch`): scarica `https://docs.google.com/spreadsheets/d/1tJ899Wf-ElgVdhXFcQOG8ofQDYKTf8J6Lg8IXavCRxA/export?format=csv&gid=2095352073`, usa la **seconda** riga come intestazioni (`name`, `weight`, `weight_distribution`, `driveline`, `differential`, `tank_size`), tiene le righe con `weight` valorizzato, converte `"1,390"` → 1390 e `"43.8 / 56.2"` → 43.8, scrive `src/main/ams2/ams2-cars.ts` con l'intestazione `// Auto-generated from the community sheet "Cars of AMS2" (ams2cars.info) by scripts/update-ams2-cars.mjs - do not edit manually`. Aggiungere `"update:ams2-cars": "node scripts/update-ams2-cars.mjs"` a `package.json`.
- Eseguirlo una volta e versionare il file generato (208 auto attese).
- `findAms2Car`: confronto per nome normalizzato (`toLowerCase`, spazi multipli → uno, `trim`); nessun fuzzy oltre questo (l'associazione vera si verifica dal vivo in Task 10).

- [ ] **Step 4: Verifica**

Run: `npm run update:ams2-cars && npm run selfcheck && npm run fallow:check && npm run format:check`
Expected: PASS; `ams2-cars.ts` con 208 voci.

- [ ] **Step 5: Commit (dopo conferma dell'utente)** — `feat(ams2): tabella auto dal foglio "Cars of AMS2" (peso, distribuzione, trazione, differenziale)`

---

### Task 5: Distribuzione dei pesi (`weight-distribution.ts`)

**Files:**
- Create: `src/main/coach/weight-distribution.ts`
- Test: `src/main/coach/weight-distribution.selfcheck.ts`

**Interfaces:**
- Consumes: `LoadFitSums` (Task 3), `Ams2Car` (Task 4).
- Produces:

```ts
export type WeightDistribution =
  | { known: true; frontPct: number; source: "misurata" | "tabella AMS2"; aeroFrontPct: number | null; fuelL: number | null }
  | { known: false; reason: string };
export const weightDistribution = (
  game: GameSource, zones: ZoneData[], car: Ams2Car | null,
): WeightDistribution;
```

Costante: `MIN_LOAD_SAMPLES = 300`.

- [ ] **Step 1: Test che falliscono**

Somme sintetiche generate da carichi noti: statico 6000 N ant / 7600 N post, aerodinamico 0,10 e 0,16 N per m²/s², velocità da 10 a 60 m/s.

```ts
const m = weightDistribution("r3e", synthZones, null);
assert.ok(m.known && Math.abs(m.frontPct - 44.12) < 0.05); // 6000 / 13600
assert.ok(m.known && Math.abs(m.aeroFrontPct! - 38.46) < 0.05); // 0.10 / 0.26
assert.deepEqual(weightDistribution("ace", fewSamples, null), { known: false, reason: "meno di 300 campioni in linea retta" });
assert.deepEqual(weightDistribution("r3e", sameSpeed, null), { known: false, reason: "campioni tutti alla stessa velocità" });
assert.deepEqual(weightDistribution("r3e", noLoad, null), { known: false, reason: "carico ruota non disponibile" });
assert.deepEqual(weightDistribution("ams2", [], findAms2Car("Porsche 992 GT3 R")), { known: true, frontPct: 43.8, source: "tabella AMS2", aeroFrontPct: null, fuelL: null });
assert.deepEqual(weightDistribution("ams2", [], null), { known: false, reason: "auto non presente nella tabella AMS2" });
```

- [ ] **Step 2: Verifica che falliscano** — `npm run selfcheck`, FAIL (modulo inesistente).

- [ ] **Step 3: Implementazione**

Sommare i `loadFit` di tutte le zone; per asse, regressione lineare `y = a + b·x`: `b = (n·Σxy − Σx·Σy) / (n·Σxx − Σx²)`, `a = (Σy − b·Σx) / n`. Denominatore ≤ `1e-9 × n·Σxx` → "campioni tutti alla stessa velocità". `frontPct = aF / (aF + aR) × 100`; `aeroFrontPct = bF / (bF + bR) × 100` se `bF + bR > 0`, altrimenti `null`; `fuelL = fuelSum / fuelN` o `null`. AMS2 non misura mai: solo tabella.

- [ ] **Step 4: Verifica** — `npm run selfcheck`, PASS.

- [ ] **Step 5: Commit (dopo conferma dell'utente)** — `feat(coach): distribuzione dei pesi misurata (R3E, ACE) o da tabella (AMS2)`

---

### Task 6: Valori del setup (`setup-levers.ts`) e nomi canonici AMS2

**Files:**
- Create: `src/main/coach/setup-levers.ts`
- Modify: `src/main/ams2/ams2-setup-vision.ts:97-121` (system prompt)
- Test: `src/main/coach/setup-levers.selfcheck.ts`

**Interfaces:**
- Produces:

```ts
type Quartet = [number, number, number, number];
export type SetupLevers = {
  springs?: { values: Quartet; unit: string }; // unit as in the setup ("N/mm", "N/m")
  slowBump?: Quartet; slowRebound?: Quartet; fastBump?: Quartet; fastRebound?: Quartet;
};
export const extractSetupLevers = (params: SetupParam[], game: GameSource): SetupLevers;
```

Una famiglia è presente solo con tutte e quattro le ruote trovate.

Etichette per gioco:
- R3E (`parameter` prodotto da `idToLabel`): `Springs (Front|Rear) (Left|Right)`, `Bump …`, `Rebound …`, `Fast Bump …`, `Fast Rebound …`. Da confermare su un JSON vero in Task 10.
- ACE: `Rigidità Molla FL…RR` (N/m), `Lento Compressione`, `Lento Estensione`, `Veloce Compressione`, `Veloce Estensione` + ` FL|FR|RL|RR`.
- AMS2 (nomi canonici imposti dal prompt): `Molla FL…RR`, `Slow Bump`, `Slow Rebound`, `Fast Bump`, `Fast Rebound` + ` FL|FR|RL|RR`.

- [ ] **Step 1: Test che falliscono**

```ts
const r3e = extractSetupLevers([
  p("Springs Front Left", "120 N/mm"), p("Springs Front Right", "120 N/mm"),
  p("Springs Rear Left", "150 N/mm"), p("Springs Rear Right", "150 N/mm"),
], "r3e");
assert.deepEqual(r3e.springs, { values: [120, 120, 150, 150], unit: "N/mm" });
const ace = extractSetupLevers([
  p("Rigidità Molla FL", "95000 N/m"), p("Rigidità Molla FR", "95000 N/m"),
  p("Rigidità Molla RL", "110000 N/m"), p("Rigidità Molla RR", "110000 N/m"),
], "ace");
assert.deepEqual(ace.springs, { values: [95000, 95000, 110000, 110000], unit: "N/m" });
assert.deepEqual(extractSetupLevers([p("Molla FL", "225,5 N/mm"), /* … */], "ams2").springs?.values[0], 225.5);
assert.equal(extractSetupLevers([p("Molla FL", "225 N/mm"), p("Molla FR", "225 N/mm")], "ams2").springs, undefined, "front only");
assert.deepEqual(extractSetupLevers(aceDampers, "ace").slowRebound, [5000, 5000, 6000, 6000]);
const prompt = buildAms2SetupSystemPrompt("Porsche 992 GT3 R");
assert.ok(AMS2_CANONICAL_PARAMS.every((name) => prompt.includes(name)));
assert.equal(AMS2_CANONICAL_PARAMS.length, 20);
```

- [ ] **Step 2: Verifica che falliscano** — `npm run selfcheck`, FAIL.

- [ ] **Step 3: Implementazione**

- Valore: primo numero del testo, virgola → punto; unità = resto del testo dopo il numero, `trim`.
- `ams2-setup-vision.ts`: estrarre il system prompt oggi costruito dentro `decodeAms2Setup` in `export const buildAms2SetupSystemPrompt = (expectedCar: string): string` (stesso testo, `decodeAms2Setup` lo chiama), esportare `AMS2_CANONICAL_PARAMS` (i 20 nomi sopra) e aggiungere al prompt, dopo la riga sui codici ruota: `Per questi parametri usa ESATTAMENTE questi nomi: ${AMS2_CANONICAL_PARAMS.join(", ")}. Riporta le molle con l'unità mostrata nel gioco (es. "220 N/mm").`

- [ ] **Step 4: Verifica** — `npm run typecheck && npm run selfcheck`, PASS.

- [ ] **Step 5: Commit (dopo conferma dell'utente)** — `feat(coach): valori di molle e ammortizzatori dal setup, nomi canonici AMS2`

---

### Task 7: Il quadro (`setup-overview.ts`)

**Files:**
- Create: `src/main/coach/setup-overview.ts`
- Modify: `src/main/coach/setup-ladder.ts` (esportare la selezione dei giri giudicati)
- Test: `src/main/coach/setup-overview.selfcheck.ts`

**Interfaces:**
- Consumes: `SetupLadder` e `LadderStatus` (`setup-ladder.ts`), `WeightDistribution` (Task 5), `SetupLevers` (Task 6), i campi `ZoneData` di Task 2 e 3.
- Produces in `setup-ladder.ts`: `export const judgedLapsOfLastSegment = (laps: LapRow[], opts: { leaderboardMode?: boolean }): (LapRow & { zones: ZoneData[] })[]`, ricavata dall'attuale `judgedOf` (`computeSetupLadder` la riusa; comportamento invariato, il selfcheck della sequenza deve passare senza modifiche).
- Produces in `setup-overview.ts`:

```ts
export type OverviewArea = {
  n: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  label: string; // "molle", "altezze e rake", "bumpstop", "terze molle", "ammortizzatori", "barre antirollio", "convergenze", "aerodinamica"
  status: LadderStatus;
  reason: string; // Italian: numbers + direction (fix) or why (na)
  proposable: boolean; // false under fixedSetup
};
export type SetupOverview = {
  areas: OverviewArea[];
  current: number | null; // first "fix" && proposable, only when ladder.current == null && ladder.lapsMissing === 0
  afterLadder: boolean; // true when the ladder still has a current step: every area "da rivedere dopo la sequenza"
  weight: WeightDistribution;
  tyreLine: string | null; // null in Leaderboard
};
export const computeSetupOverview = (input: {
  zones: ZoneData[]; judgedLaps: number; ladder: SetupLadder;
  weight: WeightDistribution; levers: SetupLevers | null;
  fixedSetup: boolean; leaderboardMode: boolean;
}): SetupOverview;
```

Costanti (spec): `SPRING_RATIO_TOL = 0.03`, `DAMPER_SPREAD = 0.05`, `RH_HIGH_M = 0.015`, `BUMP_UPSET_PER_LAP = 0.1`, `THIRD_HIGH_M = 0.01`, `OSC_SHARE = 0.2`, `MIN_CLASS_CORNERS = 3`, `AERO_UNDER = 0.9`, `AERO_OVER = 1.1`, `WEAVE_PER_KM = 6`, `WEAVE_MIN_M = 2000`, `TYRE_CONFIRM_C = 5`.

Regole per area (spec, sezioni 1-8; testo delle direzioni in italiano):

| n | `fix` quando | direzione nel `reason` | `na` quando |
|---|---|---|---|
| 1 molle | `|rapporto molle pesante/leggero ÷ rapporto pesi − 1| > SPRING_RATIO_TOL`, oppure sinistra ≠ destra su un asse | `molle ${asse pesante} ${round(media leggero × rapporto pesi)} ${unit}` / `uguagliare sinistra e destra` | pesi sconosciuti (motivo di `WeightDistribution`), `levers.springs` assente ("parametro non presente nel setup caricato"), nessun setup |
| 2 altezze e rake | nessun evento fondo e `min(minF, minR) > RH_HIGH_M` → "abbassare di un click, stessi mm sui due assi"; oppure `cornersEntryUnder > cornersEntry/2` → "più rake (posteriore più alto o anteriore più basso)" | come a sinistra | senza `rideHeight` e senza curve |
| 3 bumpstop | `upset / judgedLaps > BUMP_UPSET_PER_LAP` | `avvicinare il bumpstop ${asse}; se l'auto non ha bumpstop regolabili, o sono già al massimo, alzare le quattro altezze di 2 mm` | senza `bottoming` |
| 4 terze molle | `bottoming.straight > 0` → `irrigidire la terza molla ${asse}; se non basta, +1 mm alle altezze mantenendo il rake; se l'auto non ha terze molle, avvicinare i bumpstop ${asse}`; oppure media rettilineo − media centro curva > `THIRD_HIGH_M` → "ammorbidire le terze molle" | come a sinistra | senza `rideHeight` |
| 5 ammortizzatori | `(max−min)/max > DAMPER_SPREAD` su una delle quattro famiglie → "uniformare ${famiglia}"; oppure `oscillating/peaks > OSC_SHARE` → "più slow rebound sulle quattro ruote; se non basta, più slow bump" | come a sinistra | né `levers` ammortizzatori né `suspOsc` |
| 6 barre | `cornersSlow ≥ MIN_CLASS_CORNERS` e under (o over) > metà | under: "barra anteriore più morbida o posteriore più rigida"; over: il contrario | meno di 3 curve lente o senza famiglia |
| 7 convergenze | `straightSteer.metres ≥ WEAVE_MIN_M` e `reversals / km > WEAVE_PER_KM` | "più convergenza anteriore (o meno divergenza)" | sotto `WEAVE_MIN_M` o senza famiglia |
| 8 aerodinamica | lente e veloci ≥ 3: `(kFastSum/cornersFast) / (kSlowSum/cornersSlow) < AERO_UNDER` / `> AERO_OVER` | "più carico anteriore (o meno posteriore)" / "più carico posteriore (o meno anteriore)" | meno di 3 curve per classe |

- `asse` = quello con più eventi (`front`/`rear`), parità → anteriore.
- Ogni `reason` comincia con il dato che lo sostiene, altezze in mm (es. `altezza minima ant 18 mm, post 22 mm, nessun tocco del fondo → abbassare…`, `2 tocchi del fondo che scompongono l'auto in 5 giri, asse anteriore → avvicinare…`).
- Rimandi (un sintomo, un'area): quando il sintomo del proprietario c'è, l'area che lo cita aggiunge `· vedi area N (${label})` al suo `reason`, senza cambiare stato. Mappa: sottosterzo in inserimento 2 → 6; fondo frenata/altro 3 → 2; fondo rettilineo 4 → 3, 2, 8; oscillazioni 5 → 1; centro curva lente 6 → 7; bilanciamento con la velocità 8 → 6.
- Molle `na` → le aree 2-5 aggiungono `· molle non verificate`.
- `tyreLine`: dalla media di `avgTyreTempC` (altrimenti `avgTyreTempCenterC`) sulle zone: `ant−post ${signed} °C, sx−dx ${signed} °C`; se l'area 6 è `fix` per sottosterzo e anteriori più calde di ≥ `TYRE_CONFIRM_C` (o sovrasterzo e posteriori più calde), il `reason` dell'area 6 aggiunge `· conferma: ${asse} più calde di X °C`. `null` in Leaderboard o senza temperature.

- [ ] **Step 1: Test che falliscono**

Un `ladder` finto con `current: null, lapsMissing: 0` e zone costruite con i soli campi necessari:

```ts
// Old session: no new fields at all → eight areas, all na, no throw.
const old = computeSetupOverview({ ...base, zones: [legacyZone], levers: null, weight: { known: false, reason: "carico ruota non disponibile" } });
assert.equal(old.areas.length, 8);
assert.ok(old.areas.every((a) => a.status === "na" && a.reason.length > 0));
assert.equal(old.current, null);
// Springs: 43.8 / 56.2, springs 225/225/225/225 N/mm → fix, target 288.
const springs = computeSetupOverview({ ...base, weight: w438, levers: { springs: { values: [225, 225, 225, 225], unit: "N/mm" } } });
assert.equal(area(springs, 1).status, "fix");
assert.ok(area(springs, 1).reason.includes("molle posteriori 288 N/mm"));
assert.equal(springs.current, 1);
// Springs within 3 %: ok.
assert.equal(area(computeSetupOverview({ ...base, weight: w438, levers: { springs: { values: [225, 225, 286, 286], unit: "N/mm" } } }), 1).status, "ok");
// Springs na → areas 2-5 say "molle non verificate".
assert.ok(area(old, 3).reason.includes("molle non verificate"));
// Bumpstop: 2 upsetting events in 5 judged laps (0.4 > 0.1), front → fix with the conditional fallback.
assert.ok(area(bump, 3).reason.includes("se l'auto non ha bumpstop regolabili"));
assert.ok(area(bump, 2).reason.includes("vedi area 3"));
// One symptom, one owner: entry understeer fixes area 2 only; area 6 cites it.
assert.equal(area(entryUnder, 2).status, "fix");
assert.ok(area(entryUnder, 6).reason.includes("vedi area 2"));
// Ladder with a current step: areas computed, no current area.
const pending = computeSetupOverview({ ...base, ladder: { ...ladderOk, current: 4 }, weight: w438, levers: springsOff });
assert.equal(pending.current, null);
assert.equal(pending.afterLadder, true);
// Fixed setup: nothing proposable.
assert.ok(computeSetupOverview({ ...base, fixedSetup: true, weight: w438, levers: springsOff }).areas.every((a) => !a.proposable));
// Aero: k fast / k slow = 0.8 with 3+3 corners → more front downforce.
assert.ok(area(aeroUnder, 8).reason.includes("più carico anteriore"));
// Leaderboard: no tyre line.
assert.equal(computeSetupOverview({ ...base, leaderboardMode: true }).tyreLine, null);
```

Più un caso `fix` e un caso `ok` per ognuna delle aree 4, 5, 7 con le soglie della tabella. Infine in `setup-ladder.selfcheck.ts`: `judgedLapsOfLastSegment(stint(5, okZone()), {}).length === 4`.

- [ ] **Step 2: Verifica che falliscano** — `npm run selfcheck`, FAIL.

- [ ] **Step 3: Implementazione** secondo la tabella e le regole sopra; aree costruite con lo stesso helper `step(...)` di `setup-ladder.ts` (copiato localmente con `n` 1-8).

- [ ] **Step 4: Verifica** — `npm run selfcheck`, PASS; il selfcheck della sequenza passa senza modifiche oltre all'asserzione nuova.

- [ ] **Step 5: Commit (dopo conferma dell'utente)** — `feat(coach): quadro assetto in otto aree dalle guide Frezza`

---

### Task 8: Tabella AMS2 nella sequenza (trazione e differenziale)

**Files:**
- Modify: `src/main/coach/setup-ladder.ts` (`computeSetupLadder` opts, passi 3 e 6)
- Test: `src/main/coach/setup-ladder.selfcheck.ts`

**Interfaces:**
- Consumes: `Ams2Car` (Task 4).
- Produces: `computeSetupLadder(laps, setupLabelById, opts)` accetta `opts.car?: Ams2Car | null`.

- [ ] **Step 1: Test che falliscono**

```ts
const car = (over: Partial<Ams2Car>): Ams2Car => ({ name: "x", weightKg: 1000, frontPct: 45, driveline: "RWD", differential: "C-LSD", tankL: null, ...over });
// Driveline from the table beats the slip heuristic: FWD → step 3 na even with rear-biased slip.
assert.equal(stepOf(computeSetupLadder(stint(5, okZone({ nervousDownshifts: 3 })), new Map(), { fixedSetup: false, car: car({ driveline: "FWD" }) }), 3).reason, "trazione anteriore");
// Non-adjustable differential → step 6 na.
for (const differential of ["FIXED", "SPOOL", "OPEN"])
  assert.equal(stepOf(computeSetupLadder(stint(5, okZone({ spinFramesRear: 30 })), new Map(), { fixedSetup: false, car: car({ differential }) }), 6).reason, "differenziale non regolabile");
// Geared LSD → bias ratio wording.
assert.ok(stepOf(computeSetupLadder(stint(5, okZone({ spinFramesRear: 30 })), new Map(), { fixedSetup: false, car: car({ differential: "G-LSD" }) }), 6).reason.includes("bias ratio power"));
```

- [ ] **Step 2: Verifica che falliscano** — `npm run selfcheck`, FAIL.

- [ ] **Step 3: Implementazione**: `fwd = car ? car.driveline === "FWD" : <stima attuale>`; differenziale in `["FIXED", "SPOOL", "OPEN"]` → `step(6, L, "na", "differenziale non regolabile")` prima di ogni altro controllo; `G-LSD`/`GC-LSD`: nelle tre direzioni del passo 6 "power ramp" → "bias ratio power" e "coast ramp" → "bias ratio coast", con "chiudere" → "alzare" e "aprire" → "abbassare"; il ripiego sul precarico si omette (il geared LSD non lo ha).

- [ ] **Step 4: Verifica** — `npm run selfcheck`, PASS.

- [ ] **Step 5: Commit (dopo conferma dell'utente)** — `feat(coach): trazione e differenziale dalla tabella AMS2 nella sequenza`

---

### Task 9: Collegamento a statistiche, prompt e voce

**Files:**
- Modify: `src/main/coach/session-stats.ts` (`ComputeStatsInput`, `SessionStats`, `computeSessionStats`)
- Modify: `src/main/coach/session-coach.ts:248-290`, `:395-410`, `:530-545` (i tre `computeSessionStats` e `stintReady`)
- Modify: `src/main/coach/prompt-builder.ts` (`buildStatsBlock`, `SESSION_SYSTEM_PROMPT`, `SYNTHESIS_SYSTEM_PROMPT`)
- Modify: `src/main/coach/setup-ladder.ts` (`stintReadyMessage`)
- Test: `src/main/coach/prompt-builder.selfcheck.ts`, `src/main/coach/session-stats.selfcheck.ts`, `src/main/coach/setup-ladder.selfcheck.ts`

**Interfaces:**
- Consumes: tutto quanto sopra.
- Produces: `ComputeStatsInput` + `game?: GameSource; car?: string | null` (nome auto della sessione, `session.car`); `SessionStats.setupOverview: SetupOverview | null`; `stintReadyMessage(ladder: SetupLadder, overview?: SetupOverview | null): string | null`.

`computeSessionStats`: zone = `judgedLapsOfLastSegment(laps, { leaderboardMode }).flatMap((l) => l.zones)`, `judgedLaps` = la lunghezza di quella lista; leve dal setup del segmento giudicato (`setups.find((s) => s.id === lastLap.setup_id)?.setup.params` → `extractSetupLevers`); `car` = `game === "ams2" && input.car ? findAms2Car(input.car) : null` (con `console.warn("[AMS2] auto non trovata nella tabella: …")` quando `null`); `weightDistribution(game, zones, car)`; `computeSetupLadder(..., { ..., car })`; `computeSetupOverview(...)`.

Righe nei Dati Calcolati, subito dopo la sequenza (copia esatta del formato):

```
- Quadro assetto (pesi ant 43.8 % da tabella AMS2):
  1 molle: DA CORREGGERE ← AREA CORRENTE — rapporto molle 1.00, pesi 1.28 → molle posteriori 288 N/mm
  2 altezze e rake: ok — …
  …
  Calore gomme: ant−post +6.2 °C, sx−dx −1.0 °C
```

- intestazione: `(pesi ant ${frontPct} % ${source === "misurata" ? `misurata${fuel}` : "da tabella AMS2"}${aero})` con `fuel` = `, carburante medio ${fuelL} L` e `aero` = `, carico aerodinamico ant ${aeroFrontPct} %` quando presenti; pesi sconosciuti → `(pesi sconosciuti: ${reason})`;
- con `afterLadder`: ogni riga termina con ` (da rivedere dopo la sequenza)`;
- con `!proposable`: ` (non modificabile con Setup Fisso)`.

Testo dei prompt (copia esatta da inserire):

- `SESSION_SYSTEM_PROMPT`, dopo il blocco `### Setup attuale vs proposto`:

```
### Quadro assetto
Se nei Dati Calcolati c'è la riga "Quadro assetto", questa sottosezione è OBBLIGATORIA. Tabella "Area | Stato | Dato | Direzione" con tutte le otto aree nell'ordine della riga, poi la riga "Calore gomme" se presente. Se le aree sono "da rivedere dopo la sequenza", nessuna proposta: scrivilo in una riga. Altrimenti, con un setup caricato, una proposta numerata per ogni area DA CORREGGERE, nell'ordine del quadro, nel formato "N. Area — Parametro: ValoreAttuale → ValoreNuovo": usa il valore della riga quando lo dà (molle), altrimenti valore attuale ± il passo minimo nella direzione della riga. Chiudi con: "Applica una proposta alla volta, nell'ordine, e ripeti uno stint dopo ciascuna: le aree successive cambiano." Senza setup caricato, solo le direzioni. Le aree NON VALUTABILI si elencano con il motivo, senza proposte.
```

- nella stessa costante, sostituire la frase che oggi inizia con `Se la sequenza NON ha un passo corrente (ogni passo ok o non valutabile, …) puoi dare proposte numerate anche sulle altre aree` con: `Se la sequenza NON ha un passo corrente, le proposte sulle altre aree stanno nella sottosezione "Quadro assetto", non qui.`, e nell'ultima riga aggiungere `"Quadro assetto"` alle sottosezioni omissibili: `…tranne "Setup attuale vs proposto", omissibile SOLO se manca la riga "Sequenza setup" e nessun setup è caricato, e "Quadro assetto", omissibile SOLO se manca la riga "Quadro assetto".`
- `SYNTHESIS_SYSTEM_PROMPT`: sostituire `Senza passo corrente, o senza riga "Sequenza setup", nessuna azione di setup.` con `Senza passo corrente, l'unica azione di setup è l'AREA CORRENTE del "Quadro assetto", nella direzione della sua riga e citandone il dato (stesse regole su A → B e sul passo minimo). Senza passo corrente né area corrente, o senza riga "Sequenza setup", nessuna azione di setup.`
- `stintReadyMessage`: con `ladder.current == null` e `overview?.current != null`, `verdict` = `Sequenza completa, prima area dell'assetto: ${label}.`

- [ ] **Step 1: Test che falliscono**

In `prompt-builder.selfcheck.ts`:

```ts
assert.ok(SESSION_SYSTEM_PROMPT.includes("### Quadro assetto"));
assert.deepEqual(roots(SESSION_SYSTEM_PROMPT), ["Analisi approfondita"]); // unchanged: no new root
assert.ok(SYNTHESIS_SYSTEM_PROMPT.includes("AREA CORRENTE"));
assert.ok(!SESSION_SYSTEM_PROMPT.includes("puoi dare proposte numerate anche sulle altre aree"));
const block = buildStatsBlock(statsWithOverview, "ams2");
assert.ok(block.includes("- Quadro assetto (pesi ant 43.8 % da tabella AMS2):"));
assert.ok(block.includes("1 molle: DA CORREGGERE ← AREA CORRENTE — "));
assert.ok(buildStatsBlock(statsWithOverviewAfterLadder, "ams2").includes("(da rivedere dopo la sequenza)"));
assert.ok(!buildStatsBlock(statsWithoutOverview, "r3e").includes("Quadro assetto"));
```

Aggiornare le asserzioni esistenti alle righe ~322-342 che citano la frase sostituita (`ogni passo ok o non valutabile`, `anche sulle altre aree`) al nuovo testo; la lista delle sottosezioni obbligatorie (riga ~209) include `Quadro assetto`.

In `session-stats.selfcheck.ts`: `computeSessionStats({ ...ladderIn, game: "ams2", car: "Porsche 992 GT3 R" }).setupOverview?.weight` è `{ known: true, frontPct: 43.8, … }`; senza `game` il default è `"r3e"` e `setupOverview` non è `null`.

In `setup-ladder.selfcheck.ts`: `stintReadyMessage(ladderComplete, overviewWithCurrent6)` contiene `"prima area dell'assetto: barre antirollio"`; con `overview` assente la frase resta `"Nessun passo da correggere."`.

- [ ] **Step 2: Verifica che falliscano** — `npm run selfcheck`, FAIL.

- [ ] **Step 3: Implementazione** come sopra; `session-coach.ts` passa `game` e `car: bundle.session.car` alle tre chiamate di `computeSessionStats`; `stintReady` usa `computeSessionStats` per avere `setupLadder` e `setupOverview` insieme.

- [ ] **Step 4: Verifica** — gate completo, tutti PASS.

- [ ] **Step 5: Commit (dopo conferma dell'utente)** — `feat(coach): quadro assetto nei Dati Calcolati, nei prompt e nel cue vocale`

---

### Task 10: Documentazione e verifica dal vivo

**Files:**
- Modify: `src/main/CLAUDE.md` (tabella "Per-game channel coverage": righe `rh`, `wl`, `fuel`; bullet per `chassis-counters.ts`, `setup-overview.ts`, `weight-distribution.ts`, `setup-levers.ts`, `ams2-car-lookup.ts`, `ams2-cars.ts`)
- Modify: `CLAUDE.md` (Key Design Decisions: il bullet "Setup ladder" nomina il quadro e la regola "un sintomo, un'area"; elenco dei self-check aggiornato; `npm run update:ams2-cars` tra i comandi)
- Modify: `docs/superpowers/specs/2026-10-26-quadro-assetto-design.md` (`Stato: approvato`; nota con le "Scelte del piano" di questo documento)

- [ ] **Step 1: Documentazione** come sopra; `npm run format:check` PASS (i `docs/` e `CLAUDE.md` sono esclusi da Prettier).

- [ ] **Step 2: Verifica dal vivo (con l'utente, un gioco alla volta)** — `$env:SDC_CHANNEL_LOG=1; npm run dev`, sessione nel gioco, leggere le righe `[R3E]`/`[ACE]`/`[AMS2] canali`:
  - `alt=` decine di mm, che scendono in frenata e ad alta velocità; mai `zeri` (offset sbagliato) né valori in centinaia (unità sbagliata: R3E `Player_RideHeight` è atteso in metri, AMS2 `mRideHeight` in cm);
  - `carico=` (R3E, ACE): somma delle quattro ruote ≈ massa × 9,81 a bassa velocità;
  - distribuzione dei pesi misurata di un'auto R3E o ACE confrontata con il dato pubblicato;
  - AMS2: il nome auto di almeno tre sessioni trovato da `findAms2Car` (nessuna riga `[AMS2] auto non trovata`); se i nomi non coincidono, aggiungere la normalizzazione necessaria in `ams2-car-lookup.ts` con un caso di test per ciascuna variante;
  - R3E: incollare un JSON di setup vero e verificare che `extractSetupLevers` trovi molle e ammortizzatori; correggere le etichette in `setup-levers.ts` e il test di Task 6 se diverse.

- [ ] **Step 3: Gate completo** — `npm run typecheck && npm run lint && npm run format:check && npm run selfcheck && npm run fallow:check`, tutti a exit 0.

- [ ] **Step 4: Commit (dopo conferma dell'utente)** — `docs: quadro assetto in CLAUDE.md e spec approvata`
