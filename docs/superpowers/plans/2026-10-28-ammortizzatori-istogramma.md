# Ammortizzatori dall'istogramma della velocità — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** L'area 5 del quadro assetto (ammortizzatori) torna giudicabile su R3E e AMS2: per asse, la quota di campioni in rebound fra quelli sotto 50 mm/s, letta dalla velocità istantanea delle sospensioni del gioco.

**Architecture:** I reader R3E e AMS2 aggiungono a `CompactFrame` il canale grezzo `sv` (velocità sospensioni, unità e segno come li dà il gioco). `chassis-counters.ts` calibra segno e unità una volta per giro confrontando `sv` con la derivata di `sus`, poi conta per zona i campioni lenti/veloci in bump/rebound per asse (nuova famiglia `damperHist` in `zones_json`). `setup-overview.ts` somma la famiglia sui giri giudicati e giudica l'area 5.

**Tech Stack:** TypeScript strict, Electron main process, koffi (SHM), selfcheck assert-based (`npm run selfcheck`), nessun test runner.

**Spec:** `docs/superpowers/specs/2026-10-26-quadro-assetto-design.md`, §5 "Ammortizzatori" (riscritto il 2026-10-28) e la riga "Quota di rebound lento fuori banda" nella tabella "Sintomi e proprietari".

**Base:** commit `17aa74b` (area 5 "mai giudicata", molle sinistra≠destra solo mostrate). Il working tree contiene solo la spec aggiornata al §5 istogramma e questo piano: entrano nel commit del Task 1. I subagent lavorano in questo working tree, senza worktree.

## Global Constraints

- TypeScript strict; solo arrow function, mai `function` né `class`; `type` e mai `interface`; named exports; import relativi con estensione `.js`. Target ES2024+.
- Testo per il modello in italiano, tono da ingegnere, sempre con numeri; mai i nomi della procedura ("scaletta", "passo N", "area N", Frezza); mai parole tutte maiuscole. Commenti in inglese.
- Presenza per canale: canale assente o calibrazione fallita → nessuna famiglia `damperHist`, quindi `na` con motivo, mai uno zero.
- Soglie come costanti nominate in cima al modulo, con i valori della spec: ginocchio 50 mm/s, velocità minima 30 km/h, |k| 0,3-3 (m/s) e 300-3000 (mm/s), banda rebound 40-65 %, 1000 campioni lenti per asse.
- **Mai committare senza conferma esplicita dell'utente** (regola globale). Ogni passo "Commit" = proporre il messaggio e aspettare.
- Gate prima di ogni commit: `npm run typecheck && npm run lint && npm run format:check && npm run selfcheck && npm run fallow:check`.

## Review Focus

1. **Offset AMS2 sbagliato o unità ignota** (7356 non è mai stato verificato dal vivo): `sv` senza relazione con la derivata di `sus` → nessuna `damperHist`, area 5 `na`. Test nel Task 2.
2. **Velocità in mm/s invece di m/s** (il changelog di TelemetryTool cita un fattore 1000 su AMS2): i conteggi devono essere identici al caso m/s. Test nel Task 2.
3. **Convenzione di segno opposta** (corsa o velocità negative in compressione): bump e rebound non devono invertirsi. Test nel Task 2.
4. **Giro senza frenate forti** (out-lap a passo lento, giro interrotto): il verso della compressione non è determinabile → nessuna `damperHist`. Test nel Task 2.
5. **Registrazioni vecchie e ACE** (nessun `sv`): l'area 5 resta `na` "velocità ammortizzatori non disponibile" e mostra comunque i valori del setup se caricato. Test nel Task 3.

---

### Task 1: canale `sv` nei reader R3E e AMS2

**Files:**
- Modify: `src/shared/types.ts` (`CompactFrame`, dopo `sus`)
- Modify: `src/main/r3e/r3e-reader.ts` (`FrameExt`, lettura accanto a `suspDeflection` ~riga 174, `ext` ~riga 290)
- Modify: `src/main/ams2/ams2-struct.ts` (`OFF`, tra `suspensionTravel` e `airPressure`)
- Modify: `src/main/ams2/ams2-reader.ts` (lettura accanto a `suspTravel` ~riga 302, `lapFrames.push` ~riga 388)
- Modify: `src/main/channel-log.ts` (`formatChannels`)
- Test: `src/main/ams2/ams2-struct.selfcheck.ts`, `src/main/channel-log.selfcheck.ts`
- Docs: `src/main/CLAUDE.md`, tabella "Per-game channel coverage"

**Interfaces:**
- Produces: `CompactFrame.sv?: number[]` — velocità sospensioni grezza `[FL, FR, RL, RR]`, unità e segno come li dà il gioco (R3E, AMS2; assente su ACE). `OFF.suspensionVelocity = 7356`.

- [ ] **Step 1: test che falliscono**

In `ams2-struct.selfcheck.ts`:
```ts
assert.equal(OFF.suspensionVelocity, 7356, "mSuspensionVelocity offset");
assert.equal(OFF.suspensionVelocity, OFF.suspensionTravel + 16);
assert.equal(OFF.airPressure, OFF.suspensionVelocity + 16);
```
In `channel-log.selfcheck.ts`, sul frame completo esistente aggiungere `sv: [0.0421, -0.0105, 0.1, 0]` e:
```ts
assert.ok(full.includes("vsosp=42/-11/100/0mm/s"), full);
```
e su un frame senza `sv` la stringa contiene `vsosp=assente`.

- [ ] **Step 2:** `npm run selfcheck` → FAIL (`suspensionVelocity` undefined / stringa mancante).

- [ ] **Step 3: implementazione**
- `types.ts`: `sv?: number[]; // suspension velocity [FL, FR, RL, RR], raw game units and sign (R3E, AMS2); calibrated per lap in chassis-counters`.
- `ams2-struct.ts`: `suspensionVelocity: 7356, // float[4] mSuspensionVelocity, between mSuspensionTravel and mAirPressure; unit not verified live`.
- R3E: `readDoubleArray(buf, "Player_SuspensionVelocity", 4)` in `FrameExt.sv`; AMS2: `readFloatArray(buf, OFF.suspensionVelocity, 4)` → `sv: [...suspVelocity]`. Nessuna conversione: la calibrazione è nel Task 2.
- `formatChannels`: dopo `sosp=…mm` aggiungere ` vsosp=${quartet(f.sv, 1000, 0)}mm/s` (mostra il grezzo ×1000: in m/s si leggono decine/centinaia, in mm/s decine di migliaia — è il controllo dal vivo).
- `CLAUDE.md` (src/main): riga `sv` nella tabella (R3E `Player_SuspensionVelocity` double[4]; ACE —; AMS2 `mSuspensionVelocity` @7356, **non verificato**), nota che segno e unità si calibrano per giro in `chassis-counters.ts`.

- [ ] **Step 4:** `npm run selfcheck` → PASS; `npm run typecheck` → 0 errori.

- [ ] **Step 5: Commit** (solo dopo conferma dell'utente) — `feat(telemetry): velocità sospensioni grezza da R3E e AMS2`

---

### Task 2: famiglia `damperHist` in `chassis-counters.ts`

**Files:**
- Modify: `src/shared/types.ts` (`ZoneData`, nuovo `DamperHist`)
- Modify: `src/main/chassis-counters.ts`
- Test: `src/main/chassis-counters.selfcheck.ts`
- Docs: `src/main/CLAUDE.md` (voce `chassis-counters.ts`)

**Interfaces:**
- Consumes: `CompactFrame.sv`, `CompactFrame.sus` (Task 1).
- Produces:
```ts
export type DamperHist = {
  lowBumpF: number; lowRebF: number; highBumpF: number; highRebF: number;
  lowBumpR: number; lowRebR: number; highBumpR: number; highRebR: number;
}; // samples (wheel × frame), both wheels of an axle pooled
// ZoneData: damperHist?: DamperHist;
// ChassisCounters: Pick<…, … | "damperHist">
```
Campi piatti apposta: `sumFamily` in `setup-overview.ts` somma solo record di numeri.

- [ ] **Step 1: test che falliscono** in `chassis-counters.selfcheck.ts`

Fixture: `make(600, …)` con frenata forte (`brk: 0.8`) nei frame 100-149, l'anteriore che affonda (`sus` anteriore che sale fino a +20 mm in frenata, poi torna), e una corsa sinusoidale lenta su tutte e quattro le ruote; `sv` = derivata analitica della stessa sinusoide (m/s), con una parte in estensione più lunga e lenta della compressione (rebound share noto, per esempio 60 %). Asserzioni:
```ts
const h = zone0(damped).damperHist!;
// shares per axle as built by the fixture
assert.ok(Math.abs(h.lowRebF / (h.lowRebF + h.lowBumpF) - 0.6) < 0.05);
// mm/s: same counts
assert.deepEqual(zone0(scaleSv(damped, 1000)).damperHist, h);
// both sus and sv negated (compression negative): same counts
assert.deepEqual(zone0(negate(damped)).damperHist, h);
// sv unrelated to sus (constant, or ×50): no family
assert.equal(zone0(withSv(damped, () => [0.2, 0.2, 0.2, 0.2])).damperHist, undefined);
assert.equal(zone0(scaleSv(damped, 50)).damperHist, undefined);
// no hard braking: no family
assert.equal(zone0(noBrake(damped)).damperHist, undefined);
// frames under 30 km/h and pit frames are not counted
// no sv at all (ACE, old recordings): no family
assert.equal(zone0(make(600)).damperHist, undefined);
```
(`scaleSv`, `negate`, `withSv`, `noBrake` sono helper locali del selfcheck che rimappano i frame.)

- [ ] **Step 2:** `npm run selfcheck` → FAIL.

- [ ] **Step 3: implementazione** in `chassis-counters.ts`

Costanti: `DAMPER_KNEE_MPS = 0.05`, `DAMPER_MIN_KMH = 30`, `SV_K_MS = [0.3, 3]`, `SV_K_MMS = [300, 3000]`, `SV_MIN_PAIRS = 200`, `SV_MAX_DT_MS = 100`; riusa `HARD_BRAKE`.

Calibrazione (l'algoritmo che la firma non determina):
```ts
// Multiplier turning raw `sv` into m/s, positive = compression; null = unusable.
const svScale = (frames: CompactFrame[]): number | null => {
  // 1) k = Σ v·d / Σ d² over consecutive frames carrying sus and sv,
  //    0 < Δt ≤ SV_MAX_DT_MS, every wheel; d = Δsus / Δt (m/s), v = mean sv of the pair.
  //    Fewer than SV_MIN_PAIRS pairs with d ≠ 0 → null.
  // 2) |k| in SV_K_MS → unit 1; in SV_K_MMS → 0.001; else null. velSign = sign(k).
  // 3) compression sign of sus: mean front sus on frames with brk > HARD_BRAKE
  //    minus mean front sus over all frames; no hard-brake frame or 0 → null.
  // return unit × velSign × compSign
};
```
Conteggio: chiamato una volta in `chassisCounters` sui frame del giro (non sui `pitFrames`); per ogni frame con `sv` e `spd ≥ DAMPER_MIN_KMH`, per ogni ruota `u = scale × sv[w]`; `u === 0` scartato; lento se `|u| < DAMPER_KNEE_MPS`; bump se `u > 0`; asse F per `w < 2`. Famiglia creata con `??=` a zeri solo sulle zone che ricevono un campione.

`CLAUDE.md`: nella voce `chassis-counters.ts` aggiungere la famiglia `damperHist` e la calibrazione; lasciare la frase sul contatore di oscillazioni rimosso.

- [ ] **Step 4:** `npm run selfcheck` → PASS; `npm run typecheck` → 0 errori.

- [ ] **Step 5: Commit** (solo dopo conferma) — `feat(coach): istogramma velocità ammortizzatori per zona`

---

### Task 3: area 5 giudicata in `setup-overview.ts`

**Files:**
- Modify: `src/main/coach/setup-overview.ts` (blocco `dampers`, costanti in cima)
- Test: `src/main/coach/setup-overview.selfcheck.ts` (sezione "Ammortizzatori (5)")
- Docs: `src/main/CLAUDE.md` (voce `setup-overview.ts`)

**Interfaces:**
- Consumes: `ZoneData.damperHist?: DamperHist` (Task 2); `levers` dampers, `judge`, `step`, `all4`, `sumFamily` già nel file.
- Produces: nessuna nuova API; `OverviewArea` n=5 con `status` `ok` / `fix` / `na`.

- [ ] **Step 1: test che falliscono** (sostituiscono le asserzioni attuali dell'area 5)

Helper `hist(over: Partial<DamperHist>)` con default bilanciato (`lowBumpF: 1000, lowRebF: 1100, highBumpF: 100, highRebF: 80`, idem `R`).
```ts
// No velocity (ACE, old recordings): na, setup values still shown.
const noVel = area(computeSetupOverview({ ...base, levers: { slowBump: [12, 12, 8, 8] } }), 5);
assert.equal(noVel.status, "na");
assert.ok(noVel.reason.startsWith("slow bump ant 12/12 post 8/8; velocità ammortizzatori non disponibile"), noVel.reason);
assert.ok(area(withZones(z({})), 5).reason.startsWith("velocità ammortizzatori non disponibile"));
// Balanced (52 % / 52 %): ok, figures cited.
const bal = area(withZones(z({ damperHist: hist() })), 5);
assert.equal(bal.status, "ok");
assert.ok(bal.reason.includes("rebound nel 52 % dei campioni sotto 50 mm/s"), bal.reason);
// Front 75 % (10.0 points out), rear 30.1 % (9.9 out): only the farther axle, the front, gets the fix.
const out = area(withZones(z({ damperHist: hist({ lowRebF: 3000, lowRebR: 430 }) })), 5);
assert.equal(out.status, "fix");
assert.ok(out.reason.includes("→ meno slow rebound anteriore"), out.reason);
assert.ok(!out.reason.includes("più slow rebound posteriore"), out.reason);
// Rear 25 %: più slow rebound posteriore.
assert.ok(area(withZones(z({ damperHist: hist({ lowRebR: 333 }) })), 5).reason.includes("→ più slow rebound posteriore"));
// Fewer than 1000 slow samples on an axle: na with the count.
const thin = area(withZones(z({ damperHist: hist({ lowBumpR: 300, lowRebR: 300 }) })), 5);
assert.equal(thin.status, "na");
assert.ok(thin.reason.includes("600 campioni lenti"), thin.reason);
// R3E with Rebound at its limit: datum "già a fondo scala" (blockedAtLimit).
```
Il quarto caso R3E: `game: "r3e"`, `setupParams` con `Rebound Front Left/Right` al minimo del range, fixture "front 75 %" → `status` `ok` e reason con `già a fondo scala`.

- [ ] **Step 2:** `npm run selfcheck` → FAIL.

- [ ] **Step 3: implementazione**

Costanti: `DAMPER_REB_MIN = 0.4`, `DAMPER_REB_MAX = 0.65`, `DAMPER_MIN_SAMPLES = 1000`, `DAMPER_KNEE_MMS = 50` (solo per il testo, coerente con `DAMPER_KNEE_MPS` del Task 2).

Flusso del blocco `dampers`:
1. `setupData` = la stringa dei valori del setup già costruita oggi (`slow bump ant a/b post c/d, …`), o niente se `levers` è null o senza famiglie.
2. `h = sumFamily(zones.flatMap(z => z.damperHist ? [z.damperHist] : []))`. Se null → `na`, reason `[setupData, "velocità ammortizzatori non disponibile"]` filtrato e unito con `"; "`.
3. Per asse: `low = lowBump + lowReb`; se un asse ha `low < DAMPER_MIN_SAMPLES` → `na` "`ant N, post M campioni lenti, ne servono almeno 1000`" (più `setupData`).
4. `share = lowReb / low`, `hiShare = (highBump + highReb) / (low + highBump + highReb)`. Dato per asse: `ant: rebound nel ${pct(share)} % dei campioni sotto 50 mm/s, ${pct(hiShare)} % dei campioni oltre 50 mm/s`.
5. Distanza dalla banda `max(DAMPER_REB_MIN − share, share − DAMPER_REB_MAX, 0)`; il `fix` va solo all'asse con distanza maggiore (parità → anteriore): `share > MAX` → `meno slow rebound ${anteriore|posteriore}`, moves `[all4("Rebound", "down", axleWheels)]`; `share < MIN` → `più slow rebound …`, moves `up`.
6. `setupData` come ultima `Part` senza fix; `return judge(5, parts)`.

Commento del blocco: sostituire "shown, never judged" con il criterio (istogramma, perché il decadimento non si misura a 33 Hz e la distribuzione sì).

`CLAUDE.md`: voce `setup-overview.ts`, sostituire "Dampers are **never judged**…" con il criterio; voce "Quadro assetto" del CLAUDE.md radice da non toccare (non nomina gli ammortizzatori nel dettaglio).

- [ ] **Step 4:** gate completo → tutti e cinque a exit 0.

- [ ] **Step 5: Commit** (solo dopo conferma) — `feat(coach): ammortizzatori giudicati dall'istogramma della velocità`

---

## Verifica dal vivo (dopo il merge, a carico dell'utente)

- R3E e AMS2: riga `[R3E]/[AMS2] canali` con `vsosp` in decine/centinaia (m/s ×1000). Su AMS2 un valore tutto a zero o in migliaia indica offset/unità da rivedere (la calibrazione lo scarterebbe comunque).
- R3E Monza: setup di partenza, poi +3 click di slow rebound sulle quattro ruote: la quota di rebound lento deve salire. Se non si sposta, il criterio va tolto come le oscillazioni (spec §5).
