# Analisi telemetria a due livelli — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Stato implementazione (2026-07-29): PIANO COMPLETATO.** Tutti i 14 task (Fasi 1-7) sono implementati e committati sul branch `feat/analisi-telemetria-due-livelli`; `npm run typecheck` e `npm run lint` sono puliti (il warning preesistente in `SetupSelectionModal.tsx` è stato risolto dopo, nel giro di pulizia dei debiti tecnici). `CLAUDE.md` aggiornato alla forma a due livelli.
>
> **Task 14 (`cache_control`) rimosso il 2026-07-29, dopo l'implementazione.** Misurato: il blocco `system` del Livello 2 è ~1039 token, sotto il minimo di 4096 di `claude-haiku-4-5` (default) → non ha mai scritto una entry, silenziosamente. E il `system` è l'unica parte che i due livelli **non** condividono (i due system prompt divergono il prefisso prima di arrivare al contesto comune), quindi anche su un modello con soglia più bassa l'unico hit possibile era una ri-espansione entro il TTL, che la UI non permette (a `detail` non nullo il pulsante scompare). Con la cadenza reale d'uso (~10 min tra un'analisi e la successiva) anche il TTL di 5 minuti scadeva sempre. Il prefisso davvero riusabile è `buildSessionContext`, condiviso dai due livelli e byte-identico (stesso builder, stesso insieme di `priorAnalyses` grazie a `beforeVersion`, nessun timestamp generato a runtime): cacharlo richiede spostare le regole di formato per-livello fuori dai due system prompt in un blocco utente finale — ~0.003 USD di risparmio per analisi, non vale il rischio sul formato dell'output che UI e PDF parsano. Resta il `console.log` dell'usage (`in`/`out`) in `expandAnalysis`.
>
> **Resta da fare (richiede sim in esecuzione / GUI, non verificabile da typecheck):** gli smoke test manuali di Task 12 Step 4 e Task 13 Step 6 — "Esegui analisi" produce solo le due sezioni di Livello 1 in ~15-25s senza `<sintesi-vocale>` visibile nel testo; "Mostra analisi approfondita" streamma il Livello 2 nello stesso item; mock mode mostra 3 analisi (una col pulsante non espanso); il PDF rende l'approfondita quando c'è; cambiare il modello di dettaglio ha effetto senza riavvio.
>
> **Fix applicate al Task 8 oltre allo snippet del piano** (il piano non le prevedeva):
>
> 1. `expandAnalysis` accetta `alerts?: Alert[]` (5° param, prima di `modelOverride`). Senza, il Livello 2 — la sezione che deve ordinare le "curve critiche per volume di alert" — girerebbe su `criticalCorners` vuoto, perché `sessionAlerts` vive solo in memoria in `main.ts` e non è mai persistito.
> 2. `loadSessionBundle` restituisce anche `flags: { leaderboardMode, fixedSetup }`, ricavati dalla riga di sessione che carica già (colonne `leaderboard_mode`/`fixed_setup`, `NOT NULL DEFAULT 1`). Nessun parametro nuovo. Senza, il livello che propone modifiche di setup non saprebbe che in Fixed Setup sono toccabili solo bias e pressioni freni.
> 3. Il path di errore di `expandAnalysis` emette `onDone({ analysis: null })` per rilasciare il pannello di streaming, come il Livello 1.
>
> **Note per i task rimanenti:**
>
> - **Task 9:** `expandAnalysis` prende `analysisId`, non `sessionId`, quindi l'handler deve risolvere `session_id` (un `SELECT session_id FROM session_analyses_<game> WHERE id = ?`) prima di decidere se passare `[...sessionAlerts]` — cioè solo quando `session_id === currentSessionId`.
> - **Task 11:** il genitore di `AnalysisList` è **`SessionPanel.tsx`**, non `RealtimeAnalysis`/`SessionDetail` come scrivono il piano e `CLAUDE.md`. Inoltre `AnalysisList` ha già un item di accordion "in corso" separato, agganciato a `streamingVersion`: durante l'expand di una versione già completata quell'item **duplicherebbe** la riga esistente. Va riconciliato lì.

**Goal:** Rendere l'analisi di sessione più veloce (default = solo sintesi breve, approfondimento on-demand) e più precisa (fatti numerici precalcolati in TypeScript), riorganizzando il prompt in sezioni semantiche.

**Architecture:** Ogni analisi resta una riga in `session_analyses_<game>`. Le colonne `template_v3`/`section5_summary` diventano `synthesis`/`summary`; si aggiunge `detail` (nullable). `analyzeSession` genera solo il Livello 1 (Analisi sintetica + Azioni suggerite + blocco `<sintesi-vocale>`); il nuovo `expandAnalysis` genera on-demand il Livello 2 (Analisi approfondita) e lo salva in `detail`. Un modulo puro `session-stats.ts` calcola i fatti numerici esatti, iniettati come blocco "Dati Calcolati" in entrambi i prompt.

**Tech Stack:** Electron + React 19 + TypeScript strict; better-sqlite3; Zustand; Anthropic SDK streaming; IPC handle/push.

## Global Constraints

- Codice e commenti in **inglese**; output vocale/UI in **italiano**.
- **TypeScript strict**, `type` non `interface`, **arrow functions** ovunque, **no `class`**, named export, import relativi con estensione `.js`.
- Nessun framework di test nel repo: verifica = `npm run typecheck` + `npm run lint`; logica non banale ⇒ un self-check `assert`-based `.selfcheck.ts` (pattern in `src/main/ams2/ams2-struct.selfcheck.ts`).
- `npm run typecheck` = `tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit`; `npm run lint` = `eslint .`.
- Modello: `anthropicModel` (default `claude-haiku-4-5-20251001`) per Livello 1 + voce; nuova chiave config nullable `anthropicModelDetail` come override del **solo Livello 2** (vuota → base). L'override è risolto **live** nell'handler IPC `session:expandAnalysis` e passato come `modelOverride` a `expandAnalysis` (nessuno stato mutabile nell'engine). `anthropicModelDetail` sta in `app_config` (nessuna migrazione schema).
- Non committare senza conferma esplicita dell'utente.
- `RENAME COLUMN` richiede SQLite ≥ 3.25 (incluso in better-sqlite3): ok.
- Spec di riferimento: `docs/superpowers/specs/2026-07-26-analisi-telemetria-due-livelli-design.md`.

## File Structure

**Nuovi file:**
- `src/main/coach/session-stats.ts` — modulo puro `computeSessionStats(input): SessionStats`. Nessun import runtime (solo `import type` da `shared/types`).
- `src/main/coach/session-stats.selfcheck.ts` — self-check `assert`-based.
- `src/main/coach/voice-summary.ts` — helper puri `extractVoiceSummary` / `stripVoiceTag` (regex sul tag `<sintesi-vocale>`). Modulo separato **per renderli self-checkable senza trascinare l'SDK Anthropic/better-sqlite3** che `session-coach.ts` importa (deviazione consapevole dalla spec, che li colloca in `session-coach.ts`).
- `src/main/coach/voice-summary.selfcheck.ts` — self-check `assert`-based.

**File modificati:** `src/main/db/db.ts`, `src/shared/types.ts`, `src/main/main.ts`, `src/main/coach/session-coach.ts`, `src/main/coach/prompt-builder.ts`, `src/main/coach/voice-coach.ts`, `src/main/pdf-generator.ts`, `src/preload/index.ts`, `src/renderer/store/sessionStore.ts`, `src/renderer/components/AnalysisList.tsx`, `src/renderer/global.css`, `src/renderer/mocks/mockData.ts`, `src/renderer/store/settingsStore.ts`, `src/renderer/loaders/settingsLoader.ts`, `src/renderer/components/SettingsPanel.tsx`.

---

## Fase 1 — Rename colonne + propagazione (app invariata nel comportamento)

### Task 1: Rename `template_v3`→`synthesis`, `section5_summary`→`summary`, ADD `detail`

Rename puramente meccanico su tutta la catena. Il comportamento resta identico (il prompt vecchio con marcatori `[1]…[5]` è ancora in vigore fino alla Fase 3): `synthesis` riceve il report pieno, `summary` l'estratto TTS, `detail` resta `NULL`.

**Files:**
- Modify: `src/main/db/db.ts:139-148` (`session_analyses_r3e`), `187-196` (`_ace`), `257-263` (`_ams2`), `273-292` (`migrateSchema`)
- Modify: `src/shared/types.ts:240-248` (`SessionAnalysisRow`)
- Modify: `src/main/coach/session-coach.ts` (raw row type + priorAnalyses mapping + INSERT + return + `commentAnalysis`)
- Modify: `src/main/main.ts:561-582` (`loadSessionDetail` mapping)
- Modify: `src/main/coach/prompt-builder.ts:370-374` (fallback analisi precedenti)
- Modify: `src/main/coach/voice-coach.ts:148-149`
- Modify: `src/main/pdf-generator.ts:115`
- Modify: `src/renderer/components/AnalysisList.tsx:88`
- Modify: `src/renderer/mocks/mockData.ts` (3 analisi mock)

**Interfaces:**
- Produces: `SessionAnalysisRow` con campi `synthesis: string; detail: string | null; summary: string | null; comments: AnalysisComment[]` — consumato da Fasi 4/5/6.

- [ ] **Step 1: `db.ts` — CREATE TABLE ai nomi nuovi (3 tabelle)**

In `src/main/db/db.ts`, per `session_analyses_r3e` (139-148) e `session_analyses_ace` (187-196) sostituisci le due righe colonna:

```sql
      synthesis         TEXT NOT NULL,
      summary           TEXT,
      detail            TEXT,
```
(al posto di `template_v3 TEXT NOT NULL,` e `section5_summary TEXT,`).

Per `session_analyses_ams2` (257-263) sostituisci `version INTEGER NOT NULL, template_v3 TEXT NOT NULL, section5_summary TEXT,` con:

```sql
      version INTEGER NOT NULL, synthesis TEXT NOT NULL, summary TEXT, detail TEXT,
```

- [ ] **Step 2: `db.ts` — migrazione guarded (RENAME×2 + ADD detail per gioco)**

In `migrateSchema` (`src/main/db/db.ts:274-284`) aggiungi in coda all'array `migrations`:

```ts
    // Two-tier analysis: rename columns + add on-demand detail (guarded, per game)
    `ALTER TABLE session_analyses_r3e RENAME COLUMN template_v3 TO synthesis`,
    `ALTER TABLE session_analyses_r3e RENAME COLUMN section5_summary TO summary`,
    `ALTER TABLE session_analyses_r3e ADD COLUMN detail TEXT`,
    `ALTER TABLE session_analyses_ace RENAME COLUMN template_v3 TO synthesis`,
    `ALTER TABLE session_analyses_ace RENAME COLUMN section5_summary TO summary`,
    `ALTER TABLE session_analyses_ace ADD COLUMN detail TEXT`,
    `ALTER TABLE session_analyses_ams2 RENAME COLUMN template_v3 TO synthesis`,
    `ALTER TABLE session_analyses_ams2 RENAME COLUMN section5_summary TO summary`,
    `ALTER TABLE session_analyses_ams2 ADD COLUMN detail TEXT`,
```

DB nuovo: la CREATE usa già i nomi nuovi → le ALTER falliscono e il try/catch le ignora. DB esistente: la CREATE è no-op → le ALTER applicano.

- [ ] **Step 3: `types.ts` — `SessionAnalysisRow`**

In `src/shared/types.ts:240-248` sostituisci:

```ts
export type SessionAnalysisRow = {
  id: number;
  session_id: number;
  version: number;
  synthesis: string; // ex template_v3 — Analisi sintetica (Livello 1)
  detail: string | null; // Analisi approfondita (Livello 2, on-demand)
  summary: string | null; // ex section5_summary — estratto TTS
  created_at: string;
  comments: AnalysisComment[];
};
```

- [ ] **Step 4: `session-coach.ts` — raw row types + mapping + INSERT + return**

In `src/main/coach/session-coach.ts`:

`priorAnalysesRaw` (179-187) — cambia i campi del tipo raw:
```ts
      }>;
        id: number;
        session_id: number;
        version: number;
        synthesis: string;
        summary: string | null;
        detail: string | null;
        created_at: string;
        comments_json: string | null;
```
(sostituendo `template_v3: string; section5_summary: string | null;`).

`priorAnalyses` mapping (188-196):
```ts
      const priorAnalyses: SessionAnalysisRow[] = priorAnalysesRaw.map((r) => ({
        id: r.id,
        session_id: r.session_id,
        version: r.version,
        synthesis: r.synthesis,
        detail: r.detail,
        summary: r.summary,
        created_at: r.created_at,
        comments: parseAnalysisComments(r.comments_json),
      }));
```

INSERT + return (258-273):
```ts
      const result = db
        .prepare(
          `INSERT INTO ${analysesTable} (session_id, version, synthesis, summary, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(sessionId, nextVersion, fullText, section5, createdAt);

      const analysis: SessionAnalysisRow = {
        id: Number(result.lastInsertRowid),
        session_id: sessionId,
        version: nextVersion,
        synthesis: fullText,
        detail: null,
        summary: section5,
        created_at: createdAt,
        comments: [],
      };
```

`commentAnalysis` raw row type (284-292) + prompt input (298) + return (335-343):
```ts
        | {
            id: number;
            session_id: number;
            version: number;
            synthesis: string;
            summary: string | null;
            detail: string | null;
            created_at: string;
            comments_json: string | null;
          }
```
```ts
        analysisText: row.synthesis,
```
```ts
      return {
        id: row.id,
        session_id: row.session_id,
        version: row.version,
        synthesis: row.synthesis,
        detail: row.detail,
        summary: row.summary,
        created_at: row.created_at,
        comments,
      };
```

- [ ] **Step 5: `main.ts` — `loadSessionDetail` mapping**

In `src/main/main.ts:565-582` cambia il tipo raw e il mapping:
```ts
    }>;
      id: number;
      session_id: number;
      version: number;
      synthesis: string;
      summary: string | null;
      detail: string | null;
      created_at: string;
      comments_json: string | null;
    }>;
    const analyses: SessionAnalysisRow[] = analysesRaw.map((r) => ({
      id: r.id,
      session_id: r.session_id,
      version: r.version,
      synthesis: r.synthesis,
      detail: r.detail,
      summary: r.summary,
      created_at: r.created_at,
      comments: parseAnalysisComments(r.comments_json),
    }));
```

- [ ] **Step 6: `main.ts` — TTS post-analisi**

In `src/main/main.ts:1896-1897` sostituisci `analysis.section5_summary` con `analysis.summary`:
```ts
      if (analysis?.summary) {
        await speakText(analysis.summary);
```

- [ ] **Step 7: `prompt-builder.ts` — fallback analisi precedenti**

In `src/main/coach/prompt-builder.ts:370-374`:
```ts
      if (a.summary) {
        parts.push(`Sintesi: ${a.summary}`);
      } else {
        // Fallback: first ~500 chars of the synthesis
        parts.push(a.synthesis.slice(0, 500));
      }
```

- [ ] **Step 8: `voice-coach.ts` — contesto analisi**

In `src/main/coach/voice-coach.ts:148-149`:
```ts
      if (a.summary) parts.push(a.summary);
      else parts.push(a.synthesis.slice(0, 600));
```

- [ ] **Step 9: `pdf-generator.ts` — corpo analisi**

In `src/main/pdf-generator.ts:115` sostituisci `a.template_v3` con `a.synthesis`:
```ts
        <div class="analysis-body">${postProcess(marked.parse(a.synthesis, { async: false }) as string)}</div>
```

- [ ] **Step 10: `AnalysisList.tsx` — render sintesi**

In `src/renderer/components/AnalysisList.tsx:88`:
```ts
    () => analyses.map((a) => ({ id: a.id, html: renderMd(a.synthesis) })),
```

- [ ] **Step 11: `mockData.ts` — 3 analisi mock alla nuova forma**

In `src/renderer/mocks/mockData.ts`, per ciascuna delle tre costanti (`ANALYSIS_R3E`, `ANALYSIS_ACE`, `ANALYSIS_AMS2`) rinomina `template_v3:` → `synthesis:`, `section5_summary:` → `summary:`, e aggiungi `detail: null,`. In Fase 6 (Task 12) i contenuti verranno rifatti nella forma "Analisi sintetica/approfondita"; qui **solo il rename dei campi** per far compilare.

Esempio per `ANALYSIS_R3E` (id -1): la property block diventa
```ts
  synthesis: `## [1] Dati sessione
...tutto il contenuto invariato...
mantienilo.`,
  detail: null,
  summary:
    "Buon ritmo, BMW. Stai perdendo tre decimi in frenata alla Mercedes e alla Ford Kurve. Anticipa la staccata di dieci metri e apri il gas prima in uscita.",
```
Applica lo stesso rename ad `ANALYSIS_ACE` e `ANALYSIS_AMS2`.

- [ ] **Step 12: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS (nessun riferimento residuo a `template_v3`/`section5_summary`).

- [ ] **Step 13: verifica assenza riferimenti residui**

Run: `git grep -n "template_v3\|section5_summary"`
Expected: nessun risultato in `src/` (solo eventualmente in `docs/` e nei commenti "ex …").

- [ ] **Step 14: Commit**

```bash
git add src/ docs/superpowers/plans/2026-07-26-analisi-telemetria-due-livelli.md
git commit -m "refactor(analyses): rename template_v3/section5_summary to synthesis/summary, add detail column"
```

---

## Fase 2 — Precisione: `session-stats.ts` + blocco Dati Calcolati

### Task 2: Modulo puro `computeSessionStats` + self-check

**Files:**
- Create: `src/main/coach/session-stats.ts`
- Create: `src/main/coach/session-stats.selfcheck.ts`

**Interfaces:**
- Produces: `computeSessionStats(input: ComputeStatsInput): SessionStats`; tipi esportati `SessionStats`, `LapStat`, `CornerStat`, `ComputeStatsInput`. Consumati da Task 3 (blocco prompt), Task 4/7/8 (call site).

- [ ] **Step 1: Scrivi `session-stats.ts`**

```ts
/**
 * Pure, deterministic session-stat precompute.
 *
 * The model narrates/judges but must NOT calculate: exact numeric facts
 * (lap deltas, convergence, alert counts, aid durations) are computed here from
 * the same ZoneData[] the prompt-builder consumes and passed as authoritative.
 * "Estimated impact per lap" is deliberately NOT computed (it stays a model judgment).
 */

import type {
  Alert,
  LapRow,
  SessionSetupRow,
  ZoneData,
} from "../../shared/types.js";

const FRAME_MS = 16;
const FLAT_EPS = 0.05; // seconds: |lastThird - firstThird| below this ⇒ "flat"

export type LapStat = {
  lapNumber: number;
  lapTime: number;
  deltaPrevSec: number | null; // lapTime[n] - lapTime[n-1]
  deltaBestSec: number; // lapTime[n] - bestLap
  gapToBestPct: number; // deltaBestSec / bestLap * 100
  valid: boolean;
  setupLabel: string | null;
};

export type CornerStat = {
  zone: number;
  dist: number;
  cornerName: string | null;
  alertCount: number;
  alertsByType: Record<string, number>;
  minSpeedKmh: number;
  maxBrakePct: number;
  tcEvents: number;
  tcMs: number;
  absEvents: number;
  absMs: number;
  overlapMs: number;
  brakeTempsC: [number, number, number, number] | null;
};

export type SessionStats = {
  lapCount: number;
  analyzableLapCount: number;
  bestLap: number | null;
  trend: "improving" | "worsening" | "mixed" | "flat";
  laps: LapStat[];
  criticalCorners: CornerStat[]; // sorted desc by alertCount
  setupCount: number;
};

export type ComputeStatsInput = {
  laps: LapRow[]; // ordered by lap_number asc
  bestLap: number | null;
  setups: SessionSetupRow[];
  alerts?: Alert[];
  cornerNames: Map<number, string>;
};

const avg = (arr: number[]): number =>
  arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

const parseZones = (json: string | null): ZoneData[] => {
  if (!json) return [];
  try {
    return JSON.parse(json) as ZoneData[];
  } catch {
    return [];
  }
};

export const computeSessionStats = (input: ComputeStatsInput): SessionStats => {
  const { laps, setups, alerts, cornerNames } = input;

  const times = laps.map((l) => l.lap_time);
  const bestLap = input.bestLap ?? (times.length ? Math.min(...times) : null);

  const setupLabelById = new Map<number, string>(
    setups.map((s) => [s.id, s.setup.name ?? s.setup.carFound]),
  );

  const lapStats: LapStat[] = laps.map((l, i) => {
    const deltaBestSec = bestLap != null ? l.lap_time - bestLap : 0;
    return {
      lapNumber: l.lap_number,
      lapTime: l.lap_time,
      deltaPrevSec: i > 0 ? l.lap_time - laps[i - 1].lap_time : null,
      deltaBestSec,
      gapToBestPct: bestLap ? (deltaBestSec / bestLap) * 100 : 0,
      valid: l.valid,
      setupLabel:
        l.setup_id != null ? (setupLabelById.get(l.setup_id) ?? null) : null,
    };
  });

  const analyzableLapCount = laps.filter(
    (l) => l.sector1 != null && l.sector2 != null && l.sector3 != null,
  ).length;

  // Trend heuristic: last-third vs first-third average lap time.
  // ponytail: 3-band heuristic; swap for linear regression if finer signal needed.
  let trend: SessionStats["trend"] = "flat";
  if (times.length >= 2) {
    const third = Math.max(1, Math.floor(times.length / 3));
    const diff = avg(times.slice(-third)) - avg(times.slice(0, third));
    const deltas = times.slice(1).map((t, i) => t - times[i]);
    const worseningCount = deltas.filter((d) => d > 0).length;
    const improvingCount = deltas.filter((d) => d < 0).length;
    if (Math.abs(diff) < FLAT_EPS) trend = "flat";
    else if (diff < 0) trend = worseningCount === 0 ? "improving" : "mixed";
    else trend = improvingCount === 0 ? "worsening" : "mixed";
  }

  // Critical corners: aggregate alerts by zone, then enrich from zones_json.
  const byZone = new Map<number, CornerStat>();
  for (const a of alerts ?? []) {
    let c = byZone.get(a.zone);
    if (!c) {
      c = {
        zone: a.zone,
        dist: a.dist,
        cornerName: cornerNames.get(a.zone) ?? null,
        alertCount: 0,
        alertsByType: {},
        minSpeedKmh: Infinity,
        maxBrakePct: 0,
        tcEvents: 0,
        tcMs: 0,
        absEvents: 0,
        absMs: 0,
        overlapMs: 0,
        brakeTempsC: null,
      };
      byZone.set(a.zone, c);
    }
    c.alertCount += 1;
    c.alertsByType[a.type] = (c.alertsByType[a.type] ?? 0) + 1;
  }

  for (const lap of laps) {
    for (const z of parseZones(lap.zones_json)) {
      const c = byZone.get(z.zone);
      if (!c) continue;
      c.minSpeedKmh = Math.min(c.minSpeedKmh, z.minSpeedKmh);
      c.maxBrakePct = Math.max(c.maxBrakePct, z.maxBrakePct);
      c.tcEvents += z.tcActivations;
      c.tcMs += (z.tcActiveFrames ?? 0) * FRAME_MS;
      c.absEvents += z.absActivations;
      c.absMs += (z.absActiveFrames ?? 0) * FRAME_MS;
      c.overlapMs += z.overlapFrames * FRAME_MS;
      if (z.avgBrakeTempC) c.brakeTempsC = z.avgBrakeTempC;
    }
  }

  const criticalCorners = [...byZone.values()]
    .map((c) => ({
      ...c,
      minSpeedKmh: Number.isFinite(c.minSpeedKmh) ? c.minSpeedKmh : 0,
    }))
    .sort((a, b) => b.alertCount - a.alertCount);

  return {
    lapCount: laps.length,
    analyzableLapCount,
    bestLap,
    trend,
    laps: lapStats,
    criticalCorners,
    setupCount: setups.length,
  };
};
```

- [ ] **Step 2: Scrivi il self-check `session-stats.selfcheck.ts`**

```ts
/**
 * Runnable self-check for computeSessionStats (assert-only, no framework).
 *
 * `npx ts-node --esm` is broken in this environment. WORKING approach — compile
 * with tsc to a scratch outDir, then run with plain node:
 *
 *   npx tsc --ignoreConfig --module NodeNext --moduleResolution NodeNext --target ES2022 \
 *     --strict --esModuleInterop --types node --outDir .selfcheck-out \
 *     src/shared/types.ts src/main/coach/session-stats.ts src/main/coach/session-stats.selfcheck.ts
 *   node .selfcheck-out/main/coach/session-stats.selfcheck.js
 *   rm -rf .selfcheck-out
 */
import assert from "node:assert/strict";
import { computeSessionStats } from "./session-stats.js";
import type { Alert, LapRow, ZoneData } from "../../shared/types.js";

const mkLap = (
  lap_number: number,
  lap_time: number,
  zones: ZoneData[],
  extra: Partial<LapRow> = {},
): LapRow => ({
  id: lap_number,
  session_id: 1,
  setup_id: null,
  lap_number,
  lap_time,
  sector1: 1,
  sector2: 1,
  sector3: 1,
  valid: true,
  zones_json: JSON.stringify(zones),
  recorded_at: "2026-07-26T00:00:00.000Z",
  ...extra,
});

const zone = (z: number, over: Partial<ZoneData> = {}): ZoneData => ({
  zone: z,
  dist: z * 50,
  avgSpeedKmh: 100,
  minSpeedKmh: 80,
  maxBrakePct: 0.5,
  avgThrottlePct: 0.5,
  maxSteerAbs: 0.2,
  steerDuringBrake: 0.1,
  brakeFrames: 10,
  throttleFrames: 10,
  coastFrames: 0,
  overlapFrames: 3,
  tcActivations: 1,
  absActivations: 0,
  tcActiveFrames: 4,
  absActiveFrames: 0,
  brakeStartDist: null,
  brakeEndDist: null,
  throttlePickupDist: null,
  ...over,
});

const alert = (z: number, type: string): Alert => ({
  type: type as Alert["type"],
  priority: 3,
  zone: z,
  dist: z * 50,
  lap: 2,
  message: "x",
  immediate: false,
  timestamp: 0,
});

// --- Deltas / gap / trend on a clean monotonic-improving 3-lap set ---
const improving = computeSessionStats({
  laps: [
    mkLap(1, 120, [zone(8)]),
    mkLap(2, 118, [zone(8)]),
    mkLap(3, 116, [zone(8)]),
  ],
  bestLap: 116,
  setups: [],
  alerts: [alert(8, "LATE_BRAKE"), alert(8, "LATE_BRAKE")],
  cornerNames: new Map([[8, "Curva 8"]]),
});

assert.equal(improving.lapCount, 3);
assert.equal(improving.laps[0].deltaPrevSec, null);
assert.equal(improving.laps[1].deltaPrevSec, -2);
assert.equal(improving.laps[2].deltaBestSec, 0);
assert.ok(Math.abs(improving.laps[0].gapToBestPct - (4 / 116) * 100) < 1e-9);
assert.equal(improving.trend, "improving");

// --- criticalCorners sorted desc by alertCount + aggregation from zones ---
const ranked = computeSessionStats({
  laps: [mkLap(1, 100, [zone(8), zone(15)]), mkLap(2, 100, [zone(8), zone(15)])],
  bestLap: 100,
  setups: [],
  alerts: [
    alert(15, "SLOW_THROTTLE"),
    alert(8, "LATE_BRAKE"),
    alert(8, "LATE_BRAKE"),
  ],
  cornerNames: new Map([[8, "Curva 8"]]),
});
assert.equal(ranked.criticalCorners[0].zone, 8);
assert.equal(ranked.criticalCorners[0].alertCount, 2);
assert.equal(ranked.criticalCorners[0].cornerName, "Curva 8");
assert.equal(ranked.criticalCorners[1].zone, 15);
assert.equal(ranked.criticalCorners[1].cornerName, null);
// zone 8 seen on 2 laps: tcEvents = 1+1, tcMs = (4+4)*16, overlapMs = (3+3)*16
assert.equal(ranked.criticalCorners[0].tcEvents, 2);
assert.equal(ranked.criticalCorners[0].tcMs, 128);
assert.equal(ranked.criticalCorners[0].overlapMs, 96);

// --- flat trend ---
const flat = computeSessionStats({
  laps: [mkLap(1, 100, []), mkLap(2, 100.01, [])],
  bestLap: 100,
  setups: [],
  alerts: [],
  cornerNames: new Map(),
});
assert.equal(flat.trend, "flat");
assert.equal(flat.criticalCorners.length, 0);

console.log("session-stats.selfcheck OK");
```

- [ ] **Step 3: Esegui il self-check (deve compilare ed asserire)**

Run:
```bash
npx tsc --ignoreConfig --module NodeNext --moduleResolution NodeNext --target ES2022 --strict --esModuleInterop --types node --outDir .selfcheck-out src/shared/types.ts src/main/coach/session-stats.ts src/main/coach/session-stats.selfcheck.ts
node .selfcheck-out/main/coach/session-stats.selfcheck.js
```
Expected: `session-stats.selfcheck OK`. Poi `rm -rf .selfcheck-out`.

- [ ] **Step 4: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/coach/session-stats.ts src/main/coach/session-stats.selfcheck.ts
git commit -m "feat(coach): add pure computeSessionStats precompute + self-check"
```

### Task 3: Blocco "Dati Calcolati" in `prompt-builder.ts`

**Files:**
- Modify: `src/main/coach/prompt-builder.ts` (import + nuova `buildStatsBlock`)

**Interfaces:**
- Consumes: `SessionStats` da `session-stats.ts`.
- Produces: `buildStatsBlock(stats: SessionStats): string` — usato da Task 4 (buildSessionPrompt) e Task 6 (buildSummaryPrompt).

- [ ] **Step 1: Import in `prompt-builder.ts`**

In cima a `src/main/coach/prompt-builder.ts` (dopo gli import esistenti) aggiungi:
```ts
import type { SessionStats } from "./session-stats.js";
```

- [ ] **Step 2: Aggiungi `buildStatsBlock`** (subito prima di `export type SessionPromptInput`)

```ts
/**
 * Authoritative numeric facts block, injected verbatim into both prompts.
 * The system prompts instruct the model to cite these numbers and never recompute.
 */
export const buildStatsBlock = (stats: SessionStats): string => {
  const lines: string[] = [];
  lines.push(
    `## Dati Calcolati (autorevoli — cita questi numeri, NON ricalcolare)`,
  );
  lines.push(
    `- Giri: ${stats.lapCount} (analizzabili: ${stats.analyzableLapCount}) · Trend: ${stats.trend}` +
      (stats.bestLap != null
        ? ` · Miglior giro: ${formatLapTime(stats.bestLap)}`
        : ""),
  );
  lines.push(`- Setup caricati: ${stats.setupCount}`);
  if (stats.laps.length > 0) {
    lines.push(`- Tempi giro:`);
    for (const l of stats.laps) {
      const dp =
        l.deltaPrevSec == null
          ? "—"
          : `${l.deltaPrevSec >= 0 ? "+" : ""}${l.deltaPrevSec.toFixed(3)}s`;
      lines.push(
        `  - Giro ${l.lapNumber}: ${formatLapTime(l.lapTime)} ` +
          `(∆prec ${dp}, gap best +${l.deltaBestSec.toFixed(3)}s / +${l.gapToBestPct.toFixed(2)}%)` +
          `${l.valid ? "" : " [non valido]"}` +
          `${l.setupLabel ? ` [setup "${l.setupLabel}"]` : ""}`,
      );
    }
  }
  if (stats.criticalCorners.length > 0) {
    lines.push(`- Curve critiche (ordinate per numero di alert):`);
    for (const c of stats.criticalCorners) {
      const label = c.cornerName ? `${c.cornerName} (@${c.dist}m)` : `@${c.dist}m`;
      const types = Object.entries(c.alertsByType)
        .map(([t, n]) => `${t}×${n}`)
        .join(", ");
      const bits = [
        `${c.alertCount} alert (${types})`,
        `v.min ${c.minSpeedKmh.toFixed(0)}km/h`,
        `freno ${(c.maxBrakePct * 100).toFixed(0)}%`,
      ];
      if (c.tcEvents > 0) bits.push(`TC ${c.tcEvents}ev/${c.tcMs}ms`);
      if (c.absEvents > 0) bits.push(`ABS ${c.absEvents}ev/${c.absMs}ms`);
      if (c.overlapMs > 0) bits.push(`overlap ${c.overlapMs}ms`);
      lines.push(`  - Zona ${c.zone} ${label}: ${bits.join(", ")}`);
    }
  }
  lines.push("");
  return lines.join("\n");
};
```

- [ ] **Step 3: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS (`buildStatsBlock` esportato ma non ancora usato — nessun errore, non è un'import inutilizzata).

- [ ] **Step 4: Commit**

```bash
git add src/main/coach/prompt-builder.ts
git commit -m "feat(prompt): add authoritative Dati Calcolati block from SessionStats"
```

---

## Fase 3 — Riorganizzazione prompt Livello 2 (Analisi approfondita)

### Task 4: Riscrivi `SESSION_SYSTEM_PROMPT` + `buildSessionPrompt` (paragrafi, niente `[N]`), wiring stats

**Files:**
- Modify: `src/main/coach/prompt-builder.ts` (`SESSION_SYSTEM_PROMPT`, `SessionPromptInput`, refactor `buildSessionPrompt`)
- Modify: `src/main/coach/session-coach.ts` (call site `analyzeSession`: calcola e passa `stats`)

**Interfaces:**
- Consumes: `buildStatsBlock`, `computeSessionStats`.
- Produces: `buildSessionContext(input): string` (interno), `buildSessionPrompt(input)` con `SessionPromptInput.stats: SessionStats`.

- [ ] **Step 1: Sostituisci `SESSION_SYSTEM_PROMPT`** (`src/main/coach/prompt-builder.ts:42-151`)

```ts
export const SESSION_SYSTEM_PROMPT = `Sei un ingegnere di pista esperto che analizza l'intera sessione di guida di un pilota.
Rispondi SEMPRE in italiano con tono tecnico da ingegnere. Includi SEMPRE dati numerici specifici (durate in secondi, delta secondi, PSI/kPa, km/h, percentuali).
I dati di telemetria riportano durate in millisecondi (1 campione = 16ms). Converti SEMPRE in secondi quando citi questi valori (es. 160ms → 0.16s).

I numeri esatti della sessione (tempi giro, ∆, convergenza, conteggi alert, durate aiuti) sono nel blocco "## Dati Calcolati" del messaggio utente: CITA quei numeri, NON ricalcolarli. L'unico numero che DEVI stimare tu è l'impatto in secondi/giro (giudizio derivato dai dati).

Analizzi più giri e più setup caricati nella sessione. Devi:
- Identificare i trend (miglioramento/peggioramento tra giri), coerenti con il campo Trend dei Dati Calcolati.
- Confrontare l'effetto dei diversi setup caricati (se più di uno) sulla telemetria e sui tempi.
- Segnalare problemi ricorrenti per curva con volume di alert.
- Se esistono analisi precedenti nella sessione, tenerne conto e confermare/aggiornare i consigli.

Usa il simbolo ∆ per i delta di tempo. Esprimi sempre le durate in secondi (es. "0.16s di overlap freno/gas").
Quando citi un tempo sul giro usa SEMPRE la forma "il tempo di X" (es. "il tempo di 1:16.322"). Non usare mai l'articolo apostrofato davanti al numero (mai "l'1:16").

---

## FORMATO OBBLIGATORIO

Produci un'unica sezione radice "## Analisi approfondita" con queste sottosezioni:

### Analisi telemetria
Panoramica sessione (numero giri, setup, trend direzionale). Trend giro-per-giro con la causa meccanica del miglioramento/peggioramento. Curve critiche per volume di alert nel formato "@XXXm NomeCurva: N alert (tipo+durata in secondi, …), causa probabile". Osservazioni pressioni gomme (ometti se non disponibili). Dati critici mancanti (ometti se nessuno).

### Problemi identificati
Tabella markdown: Rank | Problema | Localizzazione | Alert Count | Impatto Stim.
Poi "Dettagli per curva" (un bullet per curva critica, con entry speed, ∆ sterzata %, durate in secondi, causa meccanica) e "Pattern sistemico" (analisi trasversale: apprendimento pilota vs gestione termica vs setup).

### Setup attuale vs proposto
(OMETTI l'intera sottosezione se nessun setup è stato caricato.)
Tabella "Parametro | Valore | Valutazione" con tutti i parametri rilevanti. Poi proposte concrete numerate: "N. Descrizione (Parametro: ValoreAttuale → ValoreNuovo)" con razionale meccanico, collegamento agli alert specifici e effetto atteso in secondi/giro.

---

## Regole Generali
- NOMI CURVE: usa ESCLUSIVAMENTE i nomi presenti nella sezione "## Nomi Curve Autorizzati" del prompt utente. NON dedurre, NON inventare. Se una zona non ha nome, usa SOLO "@XXXm".
- Temperatura freni ideale: 550°C ±137.5°C (finestra 413-688°C). Se valore = -1, ignora.
- Pressioni gomme: PSI per ACE, kPa per R3E (1 bar = 14.5038 PSI).
- R3E Leaderboard: gomme fisse 85°C → non è un problema da segnalare.
- Ogni affermazione deve essere supportata da almeno un dato numerico.
- Unità di misura OBBLIGATORIE per il TTS: "XXXm" per le distanze (mai solo "XXX"), "X secondi" oppure "X s" per i delta (mai solo "X").

Tutte le sottosezioni sono obbligatorie tranne "Setup attuale vs proposto", omissibile SOLO se nessun setup è caricato.`;
```

- [ ] **Step 2: Aggiungi `stats` a `SessionPromptInput`** (`src/main/coach/prompt-builder.ts:218-230`)

Aggiungi in fondo al type:
```ts
  fixedSetup?: boolean;
  stats: SessionStats;
```

- [ ] **Step 3: Refactor `buildSessionPrompt` → `buildSessionContext` + closing Livello 2**

Sostituisci l'intera funzione `buildSessionPrompt` (`src/main/coach/prompt-builder.ts:232-412`) con: (a) una funzione interna `buildSessionContext` identica al corpo attuale **fino a prima del `parts.push(...)` finale** (righe 405-410), con in più l'iniezione del blocco stats subito dopo gli alert; (b) `buildSessionPrompt` che compone contesto + istruzione di chiusura Livello 2.

Modifica di dettaglio nella parte alerts→stats (righe ~391-403): dopo il blocco `if (alerts && alerts.length > 0) { … }` inserisci:
```ts
  parts.push(buildStatsBlock(input.stats));
```

Sostituisci la chiusura (`return parts.join("\n")` preceduta dal `parts.push` finale, righe 405-411) così:

```ts
  return parts.join("\n");
};

/** Level 2 (on-demand): full "Analisi approfondita" deep-dive. */
export const buildSessionPrompt = (input: SessionPromptInput): string => {
  const context = buildSessionContext(input);
  return (
    context +
    "\n" +
    `Produci l'analisi come "## Analisi approfondita" con le sottosezioni ` +
    `"Analisi telemetria", "Problemi identificati" e "Setup attuale vs proposto". ` +
    `Ometti "Setup attuale vs proposto" SOLO se nessun setup è caricato. ` +
    `NON produrre la sintesi né le azioni suggerite (già generate a parte). ` +
    `Cita i numeri dal blocco "## Dati Calcolati".`
  );
};
```

E rinomina l'attuale `export const buildSessionPrompt = (input: SessionPromptInput): string => {` (riga 232) in:
```ts
const buildSessionContext = (input: SessionPromptInput): string => {
```
(togliendo l'`export` e cambiando il nome; il corpo resta invariato salvo l'inserimento del `buildStatsBlock` e la rimozione del `parts.push` finale spostato nella nuova `buildSessionPrompt`).

- [ ] **Step 4: Wiring in `analyzeSession`** (`src/main/coach/session-coach.ts`)

Aggiungi l'import:
```ts
import { computeSessionStats } from "./session-stats.js";
```
Prima di `const prompt = buildSessionPrompt({` (riga 198) inserisci:
```ts
      const stats = computeSessionStats({
        laps,
        bestLap: session.best_lap,
        setups,
        alerts,
        cornerNames,
      });
```
e passa `stats` all'oggetto `buildSessionPrompt({ … })`:
```ts
        fixedSetup: flags?.fixedSetup,
        stats,
```

- [ ] **Step 5: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. (In questo stato transitorio `analyzeSession` produce già l'"Analisi approfondita" e la salva in `synthesis`; verrà spostata al Livello 1 nella Fase 4.)

- [ ] **Step 6: Commit**

```bash
git add src/main/coach/prompt-builder.ts src/main/coach/session-coach.ts
git commit -m "refactor(prompt): rewrite session prompt as Analisi approfondita, inject stats"
```

---

## Fase 4 — Livello 1 (Analisi sintetica + Azioni suggerite + sintesi vocale)

### Task 5: `voice-summary.ts` (extract/strip) + self-check

**Files:**
- Create: `src/main/coach/voice-summary.ts`
- Create: `src/main/coach/voice-summary.selfcheck.ts`

**Interfaces:**
- Produces: `extractVoiceSummary(text): string`, `stripVoiceTag(text): string` — usati da Task 7 (`analyzeSession`).

- [ ] **Step 1: Scrivi `voice-summary.ts`**

```ts
/**
 * Extract / strip the <sintesi-vocale> block that the Level-1 output appends.
 * Pure module (no deps) so it stays self-checkable without the Anthropic SDK.
 */

const VOICE_TAG = /<sintesi-vocale>([\s\S]*?)<\/sintesi-vocale>/i;

export const extractVoiceSummary = (text: string): string =>
  VOICE_TAG.exec(text)?.[1]?.trim() ?? "";

export const stripVoiceTag = (text: string): string =>
  text.replace(VOICE_TAG, "").trimEnd();
```

- [ ] **Step 2: Scrivi `voice-summary.selfcheck.ts`**

```ts
/**
 * Self-check for the <sintesi-vocale> helpers (assert-only).
 *
 *   npx tsc --ignoreConfig --module NodeNext --moduleResolution NodeNext --target ES2022 \
 *     --strict --esModuleInterop --types node --outDir .selfcheck-out \
 *     src/main/coach/voice-summary.ts src/main/coach/voice-summary.selfcheck.ts
 *   node .selfcheck-out/voice-summary.selfcheck.js
 *   rm -rf .selfcheck-out
 */
import assert from "node:assert/strict";
import { extractVoiceSummary, stripVoiceTag } from "./voice-summary.js";

const withTag = `## Analisi sintetica
Corpo.

<sintesi-vocale>
Perdi due decimi in staccata alla Curva 1. Anticipa di dieci metri.
</sintesi-vocale>`;

assert.equal(
  extractVoiceSummary(withTag),
  "Perdi due decimi in staccata alla Curva 1. Anticipa di dieci metri.",
);
assert.equal(stripVoiceTag(withTag), "## Analisi sintetica\nCorpo.");
assert.ok(!stripVoiceTag(withTag).includes("sintesi-vocale"));

// No tag ⇒ empty summary, text unchanged (trimEnd only).
const noTag = "## Analisi sintetica\nCorpo.";
assert.equal(extractVoiceSummary(noTag), "");
assert.equal(stripVoiceTag(noTag), noTag);

console.log("voice-summary.selfcheck OK");
```

- [ ] **Step 3: Esegui il self-check**

Run:
```bash
npx tsc --ignoreConfig --module NodeNext --moduleResolution NodeNext --target ES2022 --strict --esModuleInterop --types node --outDir .selfcheck-out src/main/coach/voice-summary.ts src/main/coach/voice-summary.selfcheck.ts
node .selfcheck-out/voice-summary.selfcheck.js
```
Expected: `voice-summary.selfcheck OK`. Poi `rm -rf .selfcheck-out`.

- [ ] **Step 4: typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
```bash
git add src/main/coach/voice-summary.ts src/main/coach/voice-summary.selfcheck.ts
git commit -m "feat(coach): add voice-summary tag extract/strip helpers + self-check"
```

### Task 6: `SUMMARY_SYSTEM_PROMPT` + `buildSummaryPrompt`

**Files:**
- Modify: `src/main/coach/prompt-builder.ts`

**Interfaces:**
- Consumes: `buildSessionContext` (interno), `SessionPromptInput`.
- Produces: `SUMMARY_SYSTEM_PROMPT: string`, `buildSummaryPrompt(input: SessionPromptInput): string`.

- [ ] **Step 1: Aggiungi `SUMMARY_SYSTEM_PROMPT`** (subito dopo `SESSION_SYSTEM_PROMPT`)

```ts
export const SUMMARY_SYSTEM_PROMPT = `Sei un ingegnere di pista esperto. Produci una SINTESI BREVE della sessione del pilota, in italiano, tono tecnico da ingegnere, sempre con dati numerici.
I numeri esatti (tempi giro, ∆, convergenza, conteggi alert, durate) sono nel blocco "## Dati Calcolati": CITA quei numeri, NON ricalcolarli. Le durate in ms vanno convertite in secondi (1 campione = 16ms). L'impatto in secondi/giro è un TUO giudizio derivato dai dati.

Output ESATTO: due sezioni markdown seguite da un blocco vocale, e NIENT'ALTRO (niente analisi approfondita, niente tabelle lunghe).

## Analisi sintetica
Un paragrafo condensato: diagnosi della sessione con i dati chiave (problema più critico con numeri, trend giri). È già la sintesi — nessuna etichetta "Sintesi".

## Azioni suggerite
Le azioni per migliorare i giri successivi (setup o stile di guida), MAX 3, una o due righe ciascuna:
1. **Setup — Parametro: A → B** — razionale breve; effetto atteso ~X.XX s/giro.
2. **Guida — @XXXm NomeCurva** — azione concreta (es. anticipa la staccata di 10m); effetto atteso ~X.XX s/giro.

Dopo le due sezioni aggiungi SEMPRE questo blocco (verrà letto ad alta voce dal TTS):
<sintesi-vocale>
Massimo 3 frasi, SENZA markdown (no asterischi, no elenchi, no intestazioni). Menziona il problema più critico con un dato numerico e l'azione principale.
</sintesi-vocale>

Regole: nomi curva SOLO dalla whitelist "## Nomi Curve Autorizzati" (altrimenti "@XXXm"); unità sempre esplicite ("XXXm" per le distanze, "X secondi"/"X s" per i tempi).`;
```

- [ ] **Step 2: Aggiungi `buildSummaryPrompt`** (subito dopo `buildSessionPrompt`)

```ts
/** Level 1 (always): short "Analisi sintetica" + "Azioni suggerite" + <sintesi-vocale>. */
export const buildSummaryPrompt = (input: SessionPromptInput): string => {
  const context = buildSessionContext(input);
  return (
    context +
    "\n" +
    `Produci SOLO le due sezioni "## Analisi sintetica" e "## Azioni suggerite", ` +
    `seguite dal blocco <sintesi-vocale>. Niente tabelle, niente analisi approfondita. ` +
    `Cita i numeri dal blocco "## Dati Calcolati".`
  );
};
```

- [ ] **Step 3: typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
```bash
git add src/main/coach/prompt-builder.ts
git commit -m "feat(prompt): add Level-1 summary prompt (Analisi sintetica + Azioni suggerite)"
```

### Task 7: Riscrivi `analyzeSession` → Livello 1

**Files:**
- Modify: `src/main/coach/session-coach.ts`

**Interfaces:**
- Consumes: `buildSummaryPrompt`, `SUMMARY_SYSTEM_PROMPT`, `extractVoiceSummary`, `stripVoiceTag`.
- Produces: `analyzeSession` genera Livello 1 → `synthesis = stripVoiceTag(fullText)`, `summary = extractVoiceSummary(fullText)`, `detail = null`.

- [ ] **Step 1: Aggiorna gli import** (`src/main/coach/session-coach.ts:11-16`)

```ts
import {
  COMMENT_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  buildCommentPrompt,
  buildSummaryPrompt,
} from "./prompt-builder.js";
import { extractVoiceSummary, stripVoiceTag } from "./voice-summary.js";
```
(rimuovi `SESSION_SYSTEM_PROMPT` e `buildSessionPrompt` dagli import: verranno usati in `expandAnalysis` nella Fase 5, dove li reimporterai — oppure lasciali importati fin d'ora se preferisci evitare due edit; ESLint segnala import inutilizzati, quindi rimuovili ora e reintroducili in Task 8.)

- [ ] **Step 2: Rimuovi `extractSection5`** (`src/main/coach/session-coach.ts:95-109`) — non più usato.

- [ ] **Step 3: Riscrivi il corpo streaming di `analyzeSession`**

Sostituisci il blocco `const prompt = buildSessionPrompt({...})` … fino a `options.onDone?.({ sessionId, analysis }); return analysis;` (righe ~198-276) con:

```ts
      const stats = computeSessionStats({
        laps,
        bestLap: session.best_lap,
        setups,
        alerts,
        cornerNames,
      });

      const prompt = buildSummaryPrompt({
        session,
        laps,
        setups,
        priorAnalyses,
        cornerNames,
        carName: resolved?.carName,
        trackName: resolved?.trackName,
        layoutName: resolved?.layoutName,
        alerts,
        leaderboardMode: flags?.leaderboardMode,
        fixedSetup: flags?.fixedSetup,
        stats,
      });

      const nextVersion = (priorAnalyses.at(-1)?.version ?? 0) + 1;

      let fullText = "";
      try {
        // Level 1 is short (~2k tokens): no truncation handling needed here.
        const stream = client.messages.stream({
          model,
          max_tokens: 2000,
          system: SUMMARY_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            fullText += event.delta.text;
            options.onChunk?.({
              sessionId,
              version: nextVersion,
              token: event.delta.text,
            });
          }
        }
      } catch (err) {
        console.error("[SessionCoach] Claude API error:", err);
        if (isCreditOrQuotaError(err)) {
          options.onError?.(buildAnthropicErrorMessage(err));
        }
        return null;
      }

      const synthesis = stripVoiceTag(fullText);
      const summary = extractVoiceSummary(fullText);
      const createdAt = new Date().toISOString();

      const result = db
        .prepare(
          `INSERT INTO ${analysesTable} (session_id, version, synthesis, summary, created_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(sessionId, nextVersion, synthesis, summary, createdAt);

      const analysis: SessionAnalysisRow = {
        id: Number(result.lastInsertRowid),
        session_id: sessionId,
        version: nextVersion,
        synthesis,
        detail: null,
        summary,
        created_at: createdAt,
        comments: [],
      };

      options.onDone?.({ sessionId, analysis });
      return analysis;
```

Nota: il `computeSessionStats` introdotto in Task 4 (Fase 3) qui viene mantenuto ma ora alimenta `buildSummaryPrompt`.

- [ ] **Step 4: typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS. `buildSessionPrompt`/`SESSION_SYSTEM_PROMPT` ora non hanno più chiamanti (verranno usati in Task 8) — assicurati di averli rimossi dagli import in Step 1 per evitare `no-unused-vars`.

- [ ] **Step 5: Commit**

```bash
git add src/main/coach/session-coach.ts
git commit -m "feat(coach): analyzeSession now generates Level-1 summary only (faster default)"
```

---

## Fase 5 — Livello 2 backend (`expandAnalysis` + IPC)

### Task 8: `loadSessionBundle` condiviso + `expandAnalysis` in `session-coach.ts`

**Files:**
- Modify: `src/main/coach/session-coach.ts` (import, nuovo helper interno `loadSessionBundle`, refactor `analyzeSession` per usarlo, type `SessionCoachEngine`, nuova funzione `expandAnalysis`)

**Interfaces:**
- Consumes: `SESSION_SYSTEM_PROMPT`, `buildSessionPrompt`, `computeSessionStats`.
- Produces:
  - `loadSessionBundle(game, sessionId, opts?: { beforeVersion?: number }): { session, laps, setups, priorAnalyses } | null` — helper interno alla closure `createSessionCoachEngine`; carica in un colpo i dati di sessione condivisi da `analyzeSession` ed `expandAnalysis`. `beforeVersion` (usato da `expandAnalysis`) restringe `priorAnalyses` alle versioni `< beforeVersion`; omesso (`analyzeSession`) le restituisce tutte. `null` quando la sessione non esiste.
  - `expandAnalysis(analysisId, game, resolved?, modelOverride?): Promise<SessionAnalysisRow | null>` — genera `detail` col modello `modelOverride ?? model`, aggiorna la riga esistente, riusa i canali push per `(sessionId, version)`.

- [ ] **Step 1: Reintroduci gli import Livello 2** (`src/main/coach/session-coach.ts`)

```ts
import {
  COMMENT_SYSTEM_PROMPT,
  SESSION_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  buildCommentPrompt,
  buildSessionPrompt,
  buildSummaryPrompt,
} from "./prompt-builder.js";
```

- [ ] **Step 2: Aggiungi l'helper interno `loadSessionBundle`** (nella closure `createSessionCoachEngine`, subito prima del `return {`)

```ts
  /**
   * Shared session-data loader used by analyzeSession and expandAnalysis.
   * Returns null when the session row does not exist.
   * `beforeVersion` (expandAnalysis) restricts priorAnalyses to versions < it;
   * omitted (analyzeSession) returns all versions.
   */
  const loadSessionBundle = (
    game: GameSource,
    sessionId: number,
    opts?: { beforeVersion?: number },
  ): {
    session: SessionRow;
    laps: LapRow[];
    setups: SessionSetupRow[];
    priorAnalyses: SessionAnalysisRow[];
  } | null => {
    const sessionsTable = tableFor(game, "sessions");
    const lapsTable = tableFor(game, "laps");
    const setupsTable = tableFor(game, "session_setups");
    const analysesTable = tableFor(game, "session_analyses");

    const sessionRow = db
      .prepare(`SELECT * FROM ${sessionsTable} WHERE id = ?`)
      .get(sessionId) as
      | (Omit<SessionRow, "game"> & Record<string, unknown>)
      | undefined;
    if (!sessionRow) return null;

    const session: SessionRow = {
      id: sessionRow.id as number,
      game,
      car: sessionRow.car as string,
      track: sessionRow.track as string,
      layout: sessionRow.layout as string,
      session_type: sessionRow.session_type as string,
      started_at: sessionRow.started_at as string,
      ended_at: (sessionRow.ended_at as string | null) ?? null,
      best_lap: (sessionRow.best_lap as number | null) ?? null,
      lap_count: sessionRow.lap_count as number,
    };

    const laps = db
      .prepare(
        `SELECT * FROM ${lapsTable} WHERE session_id = ? ORDER BY lap_number ASC`,
      )
      .all(sessionId) as LapRow[];

    const setupRowsRaw = db
      .prepare(
        `SELECT * FROM ${setupsTable} WHERE session_id = ? ORDER BY loaded_at ASC, id ASC`,
      )
      .all(sessionId) as Array<{
      id: number;
      session_id: number;
      loaded_at: string;
      setup_json: string;
      setup_screenshots: string | null;
    }>;
    const setups: SessionSetupRow[] = setupRowsRaw.map(parseSetupRow);

    const priorAnalysesRaw = (
      opts?.beforeVersion != null
        ? db
            .prepare(
              `SELECT * FROM ${analysesTable} WHERE session_id = ? AND version < ? ORDER BY version ASC`,
            )
            .all(sessionId, opts.beforeVersion)
        : db
            .prepare(
              `SELECT * FROM ${analysesTable} WHERE session_id = ? ORDER BY version ASC`,
            )
            .all(sessionId)
    ) as Array<{
      id: number;
      session_id: number;
      version: number;
      synthesis: string;
      summary: string | null;
      detail: string | null;
      created_at: string;
      comments_json: string | null;
    }>;
    const priorAnalyses: SessionAnalysisRow[] = priorAnalysesRaw.map((r) => ({
      id: r.id,
      session_id: r.session_id,
      version: r.version,
      synthesis: r.synthesis,
      detail: r.detail,
      summary: r.summary,
      created_at: r.created_at,
      comments: parseAnalysisComments(r.comments_json),
    }));

    return { session, laps, setups, priorAnalyses };
  };
```

- [ ] **Step 3: Refactor `analyzeSession` per usare `loadSessionBundle`**

In `analyzeSession`, sostituisci l'intero blocco di caricamento in testa alla funzione — i quattro `const …Table = tableFor(...)`, il load di `sessionRow` + mapping `session`, `laps`, `setupRowsRaw` + `setups`, e `priorAnalysesRaw` + `priorAnalyses` (dopo Fase 1 ai nomi nuovi) — con:

```ts
      const analysesTable = tableFor(game, "session_analyses");
      const bundle = loadSessionBundle(game, sessionId);
      if (!bundle) return null;
      const { session, laps, setups, priorAnalyses } = bundle;
```

`analysesTable` resta perché serve alla `INSERT` più in basso; `session`/`laps`/`setups`/`priorAnalyses` mantengono gli stessi nomi, quindi il resto di `analyzeSession` (stats, `buildSummaryPrompt`, `nextVersion`, streaming, INSERT) è invariato.

- [ ] **Step 4: Aggiungi la firma a `SessionCoachEngine`** (dopo `analyzeSession`, righe 80-86)

```ts
  expandAnalysis: (
    analysisId: number,
    game: GameSource,
    resolved?: { carName?: string; trackName?: string; layoutName?: string },
    modelOverride?: string, // Level-2 model (anthropicModelDetail); default = base model
  ) => Promise<SessionAnalysisRow | null>;
```

- [ ] **Step 5: Implementa `expandAnalysis`** (nel returned object, dopo `analyzeSession`)

```ts
    expandAnalysis: async (analysisId, game, resolved, modelOverride) => {
      const useModel = modelOverride ?? model;
      const analysesTable = tableFor(game, "session_analyses");

      const row = db
        .prepare(`SELECT * FROM ${analysesTable} WHERE id = ?`)
        .get(analysisId) as
        | {
            id: number;
            session_id: number;
            version: number;
            synthesis: string;
            summary: string | null;
            detail: string | null;
            created_at: string;
            comments_json: string | null;
          }
        | undefined;
      if (!row) return null;
      const sessionId = row.session_id;

      const bundle = loadSessionBundle(game, sessionId, {
        beforeVersion: row.version,
      });
      if (!bundle) return null;
      const { session, laps, setups, priorAnalyses } = bundle;

      const stats = computeSessionStats({
        laps,
        bestLap: session.best_lap,
        setups,
        cornerNames,
      });

      const prompt = buildSessionPrompt({
        session,
        laps,
        setups,
        priorAnalyses,
        cornerNames,
        carName: resolved?.carName,
        trackName: resolved?.trackName,
        layoutName: resolved?.layoutName,
        stats,
      });

      let fullText = "";
      try {
        // Level 2 inherits the 652f7d4 fix: generous cap + truncation surfacing.
        // useModel = anthropicModelDetail override (or base model when unset).
        const stream = client.messages.stream({
          model: useModel,
          max_tokens: 32000,
          system: SESSION_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        });

        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            fullText += event.delta.text;
            options.onChunk?.({
              sessionId,
              version: row.version,
              token: event.delta.text,
            });
          }
        }

        const finalMsg = await stream.finalMessage();
        if (finalMsg.stop_reason === "max_tokens") {
          options.onError?.(
            "Analisi approfondita troncata: raggiunto il limite di token. Il testo parziale è stato salvato; riprova.",
          );
        }
      } catch (err) {
        console.error("[SessionCoach] expand API error:", err);
        if (isCreditOrQuotaError(err)) {
          options.onError?.(buildAnthropicErrorMessage(err));
        }
        return null;
      }

      db.prepare(`UPDATE ${analysesTable} SET detail = ? WHERE id = ?`).run(
        fullText,
        analysisId,
      );

      const analysis: SessionAnalysisRow = {
        id: row.id,
        session_id: sessionId,
        version: row.version,
        synthesis: row.synthesis,
        detail: fullText,
        summary: row.summary,
        created_at: row.created_at,
        comments: parseAnalysisComments(row.comments_json),
      };

      options.onDone?.({ sessionId, analysis });
      return analysis;
    },
```

- [ ] **Step 6: typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
```bash
git add src/main/coach/session-coach.ts
git commit -m "feat(coach): extract loadSessionBundle, add expandAnalysis for on-demand Level-2 deep-dive"
```

### Task 9: IPC `session:expandAnalysis` + preload + types

**Files:**
- Modify: `src/main/main.ts` (nuovo `ipcMain.handle`)
- Modify: `src/preload/index.ts`
- Modify: `src/shared/types.ts` (`ElectronAPI`)

**Interfaces:**
- Produces: `window.electronAPI.sessionExpandAnalysis({ analysisId, game }) => Promise<{ ok: boolean; reason?: string }>`.

- [ ] **Step 1: `main.ts` — handler `session:expandAnalysis`** (subito dopo il blocco `session:analyze`, dopo riga 1299)

```ts
  ipcMain.handle(
    "session:expandAnalysis",
    async (
      _event,
      params: { analysisId: number; game?: GameSource },
    ) => {
      const game = params.game ?? currentSessionGame;
      if (!params.analysisId) {
        return { ok: false, reason: "Nessuna analisi selezionata." };
      }
      const apiKey = getAnthropicApiKey();
      if (!apiKey) {
        return { ok: false, reason: "API Key Anthropic non configurata." };
      }
      sessionCoach.updateApiKey(apiKey);
      sessionCoach.updateCornerNames(buildCornerMap());

      const sRow = db
        .prepare(
          `SELECT s.car, s.track, s.layout FROM ${t("sessions", game)} s
           JOIN ${t("session_analyses", game)} a ON a.session_id = s.id
           WHERE a.id = ?`,
        )
        .get(params.analysisId) as
        | { car: string; track: string; layout: string }
        | undefined;
      const resolved = sRow
        ? resolveNames(game, sRow.car, sRow.track, sRow.layout)
        : undefined;

      // Resolve the Level-2 model live: anthropicModelDetail override, else base.
      const detailModel =
        (getConfig("anthropicModelDetail") as string | undefined) ||
        getAnthropicModel();

      const expandKey = `expand:${params.analysisId}:${game}`;
      if (analyzingInProgress.has(expandKey)) {
        return { ok: false, reason: "Approfondimento già in corso." };
      }
      analyzingInProgress.add(expandKey);
      sessionCoach
        .expandAnalysis(params.analysisId, game, resolved, detailModel)
        .catch((err) => console.error("[SessionCoach] expand error:", err))
        .finally(() => analyzingInProgress.delete(expandKey));

      return { ok: true };
    },
  );
```

- [ ] **Step 2: `preload/index.ts` — espone `sessionExpandAnalysis`** (dopo `sessionCommentAnalysis`, riga 117)

```ts
  sessionExpandAnalysis: (params: { analysisId: number; game: string }) =>
    ipcRenderer.invoke("session:expandAnalysis", params),
```

- [ ] **Step 3: `types.ts` — firma su `ElectronAPI`** (dopo `sessionCommentAnalysis`, riga 500)

```ts
  sessionExpandAnalysis: (params: {
    analysisId: number;
    game: GameSource;
  }) => Promise<{ ok: boolean; reason?: string }>;
```

- [ ] **Step 4: typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
```bash
git add src/main/main.ts src/preload/index.ts src/shared/types.ts
git commit -m "feat(ipc): add session:expandAnalysis channel"
```

---

## Fase 6 — UI + PDF

### Task 10: `sessionStore` — `expandAnalysis` + streaming dettaglio

**Files:**
- Modify: `src/renderer/store/sessionStore.ts`

**Interfaces:**
- Consumes: `window.electronAPI.sessionExpandAnalysis`.
- Produces: `expandAnalysis(id: number): Promise<void>` sullo store. Lo streaming del Livello 2 riusa `_applyAnalysisChunk`/`_applyAnalysisDone` esistenti (chiave `(sessionId, version)`); `_applyAnalysisDone` già rimpiazza per `version`, quindi la riga con `detail` popolato sostituisce quella esistente senza modifiche.

- [ ] **Step 1: Aggiungi `expandAnalysis` al type `State`** (dopo `commentAnalysis`, riga 39)

```ts
  expandAnalysis: (id: number) => Promise<void>;
```

- [ ] **Step 2: Implementa `expandAnalysis`** (dopo il metodo `commentAnalysis`, riga 170)

```ts
  expandAnalysis: async (id) => {
    const s = get();
    if (!s.session) return;
    const res = await window.electronAPI.sessionExpandAnalysis({
      analysisId: id,
      game: s.session.game,
    });
    if (!res.ok) {
      set({ error: res.reason ?? "Errore durante l'approfondimento." });
    }
  },
```
La firma `{ analysisId, game }` è già tipizzata su `ElectronAPI` (Task 9 Step 3): nessun cast.

- [ ] **Step 3: typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
```bash
git add src/renderer/store/sessionStore.ts
git commit -m "feat(store): add expandAnalysis action wiring session:expandAnalysis"
```

### Task 11: `AnalysisList` — render `detail` + pulsante "Mostra analisi approfondita" + CSS

**Files:**
- Modify: `src/renderer/components/AnalysisList.tsx`
- Modify: `src/renderer/global.css`

**Interfaces:**
- Consumes: `useSessionStore().expandAnalysis`, `a.detail`, `streamingVersion`.

- [ ] **Step 1: Rendering `detail` + pulsante nell'Accordion.Body**

In `src/renderer/components/AnalysisList.tsx`:

Aggiungi in cima al componente il selettore azione e uno stato per la versione in espansione:
```ts
  const expandAnalysis = useSessionStore((s) => s.expandAnalysis);
```

Aggiungi un memo per il markdown del `detail`:
```ts
  const renderedDetailById = useMemo(
    () =>
      new Map(
        analyses
          .filter((a) => a.detail)
          .map((a) => [a.id, renderMd(a.detail as string)]),
      ),
    [analyses],
  );
```

Dentro `<Accordion.Body>`, subito dopo il `<div className="deb-content" ... a.synthesis>` (righe 181-188), inserisci il blocco Livello 2:
```tsx
              {renderedDetailById.has(a.id) ? (
                <details className="analysis-detail" open>
                  <summary>Analisi approfondita</summary>
                  <div
                    className="deb-content"
                    // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
                    dangerouslySetInnerHTML={{
                      __html: renderedDetailById.get(a.id) ?? "",
                    }}
                  />
                </details>
              ) : streamingVersion?.version === a.version ? (
                <div className="analysis-detail-streaming">
                  <Spinner size="sm" className="me-2" />
                  <div
                    className="deb-content"
                    // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
                    dangerouslySetInnerHTML={{
                      __html: renderMd(streamingVersion.text),
                    }}
                  />
                </div>
              ) : (
                <Button
                  variant="outline-light"
                  size="sm"
                  className="mt-2"
                  onClick={() => expandAnalysis(a.id)}
                >
                  Mostra analisi approfondita
                </Button>
              )}
```
> Nota: `streamingVersion` è passato dal componente padre. Quando l'utente lancia `expandAnalysis`, i chunk arrivano su `(sessionId, version)` esistente e popolano `streamingVersion` per quella `version`; a `onDone` la riga ottiene `detail` e il ramo `renderedDetailById.has(a.id)` prevale. Verifica nel padre (`RealtimeAnalysis`/`SessionDetail`) che `streamingVersion` sia derivato dallo `streaming` dello store (già così).

- [ ] **Step 2: CSS dark-theme** (`src/renderer/global.css`, in coda)

```css
.analysis-detail {
  margin-top: 0.75rem;
  border-top: 1px solid var(--border);
  padding-top: 0.5rem;
}
.analysis-detail > summary {
  cursor: pointer;
  color: var(--accent);
  font-weight: 600;
  margin-bottom: 0.5rem;
}
.analysis-detail-streaming {
  margin-top: 0.75rem;
  border-top: 1px solid var(--border);
  padding-top: 0.5rem;
}
```

- [ ] **Step 3: typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
```bash
git add src/renderer/components/AnalysisList.tsx src/renderer/global.css
git commit -m "feat(ui): show/expand Analisi approfondita in AnalysisList"
```

### Task 12: PDF `detail ?? synthesis` + mock contenuti nuova forma

**Files:**
- Modify: `src/main/pdf-generator.ts:115`
- Modify: `src/renderer/mocks/mockData.ts` (contenuti delle 3 analisi)

- [ ] **Step 1: PDF rende l'approfondita se disponibile**

In `src/main/pdf-generator.ts:115`:
```ts
        <div class="analysis-body">${postProcess(marked.parse(a.detail ?? a.synthesis, { async: false }) as string)}</div>
```

- [ ] **Step 2: mock contenuti nella forma "Analisi sintetica/approfondita"**

In `src/renderer/mocks/mockData.ts`, riscrivi i contenuti (non solo i nomi già rinominati in Task 1) delle 3 analisi. Esempio per `ANALYSIS_R3E`:
```ts
const ANALYSIS_R3E: SessionAnalysisRow = {
  id: -1,
  session_id: -1,
  version: 1,
  synthesis: `## Analisi sintetica
Sessione in miglioramento: dal giro 1 (1:58.456) al giro 2 (1:55.234), ∆ -3.222s, best al giro 2. Perdi ~0.20s complessivi in staccata alla Einfahrt Mercedes (18m di ritardo, apice -3 km/h) e alla Ford Kurve (trail braking eccessivo).

## Azioni suggerite
1. **Guida — @380m Einfahrt Mercedes** — anticipa la staccata di ~10m; effetto atteso ~0.12 s/giro.
2. **Guida — @1080m Ford Kurve** — rilascia il freno 5m prima per stabilizzare l'uscita; effetto atteso ~0.05 s/giro.`,
  detail: `## Analisi approfondita

### Analisi telemetria
2 giri analizzati (2-3), trend improving, best 1:55.234 al giro 2. La convergenza mostra -3.222s tra giro 1 e giro 2, guadagno concentrato nelle zone 5-18.

### Problemi identificati
| Rank | Problema | Localizzazione | Alert Count | Impatto Stim. |
|---|---|---|---|---|
| 1 | Staccata ritardata | @380m Einfahrt Mercedes | 2 (LATE_BRAKE) | -0.10 a -0.15s/giro |
| 2 | Trail braking | @1080m Ford Kurve | 1 (TRAIL_BRAKING) | -0.05s/giro |

**Pattern sistemico:** miglioramento prevalentemente da apprendimento pilota (staccate), non da gestione termica.

### Setup attuale vs proposto
Nessun setup caricato: proposte non applicabili.`,
  summary:
    "Buon ritmo, BMW. Perdi tre decimi in staccata alla Mercedes e alla Ford Kurve. Anticipa di dieci metri e rilascia il freno prima in uscita.",
  created_at: "2026-04-17T08:25:00.000Z",
  comments: [],
};
```
Applica la stessa forma a `ANALYSIS_ACE` (contenuto Monza/Porsche) e ad `ANALYSIS_AMS2` (Interlagos/Formula), ma per **uno dei tre** imposta `detail: null` per esercitare il pulsante "Mostra analisi approfondita" (es. `ANALYSIS_AMS2` con `detail: null`).

- [ ] **Step 3: typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
```bash
git add src/main/pdf-generator.ts src/renderer/mocks/mockData.ts
git commit -m "feat(pdf,mock): render detail when present; migrate mock analyses to two-tier form"
```

- [ ] **Step 4: Smoke manuale (dev)**

Run: `npm run dev`
Verifica: (1) "Esegui analisi" produce solo Analisi sintetica + Azioni suggerite in ~15-25s; il `<sintesi-vocale>` NON compare nel testo; (2) "Mostra analisi approfondita" genera e mostra l'Analisi approfondita in streaming; (3) mock mode mostra le 3 analisi (una col pulsante non ancora espanso); (4) PDF export rende l'approfondita quando presente.

### Task 13: SettingsPanel — override modello Livello 2 (`anthropicModelDetail`)

**Files:**
- Modify: `src/renderer/store/settingsStore.ts`
- Modify: `src/renderer/loaders/settingsLoader.ts`
- Modify: `src/renderer/components/SettingsPanel.tsx`

**Interfaces:**
- Produces: config key `anthropicModelDetail` (stringa; `""` = usa il modello base). Letta live dall'handler `session:expandAnalysis` (Task 9).

- [ ] **Step 1: `settingsStore.ts` — campo + setter + initFromConfig**

Nel type `SettingsStore` aggiungi accanto a `anthropicModel: string;` (riga 13):
```ts
  anthropicModel: string;
  anthropicModelDetail: string; // Level-2 override; "" = use anthropicModel
```
Aggiungi il setter accanto a `setAnthropicModel` (riga 41):
```ts
  setAnthropicModel: (v: string) => void;
  setAnthropicModelDetail: (v: string) => void;
```
Nel type di `initFromConfig` aggiungi accanto a `anthropicModel: string | null;` (riga 67):
```ts
    anthropicModel: string | null;
    anthropicModelDetail: string | null;
```
Nel valore iniziale accanto a `anthropicModel: "claude-haiku-4-5-20251001",` (riga 78):
```ts
  anthropicModel: "claude-haiku-4-5-20251001",
  anthropicModelDetail: "",
```
Nell'implementazione setter accanto a `setAnthropicModel` (riga 95):
```ts
  setAnthropicModel: (anthropicModel) => set({ anthropicModel }),
  setAnthropicModelDetail: (anthropicModelDetail) =>
    set({ anthropicModelDetail }),
```
In `initFromConfig` accanto al blocco `anthropicModel` (righe 127-129):
```ts
      ...(values.anthropicModel
        ? { anthropicModel: values.anthropicModel }
        : {}),
      ...(values.anthropicModelDetail
        ? { anthropicModelDetail: values.anthropicModelDetail }
        : {}),
```

- [ ] **Step 2: `settingsLoader.ts` — carica la chiave**

In `src/renderer/loaders/settingsLoader.ts`: aggiungi `anthropicModelDetail` alla destructuring (dopo `anthropicModel,`, riga 33), la `configGet("anthropicModelDetail")` all'array `Promise.all` (dopo `configGet("anthropicModel"),`, riga 45), e `anthropicModelDetail` all'oggetto passato a `initFromConfig` (dopo `anthropicModel,`, riga 59).

- [ ] **Step 3: `SettingsPanel.tsx` — destructure + handler**

Nel destructuring dello store (righe 161-162) aggiungi:
```ts
    anthropicModel,
    setAnthropicModel,
    anthropicModelDetail,
    setAnthropicModelDetail,
```
Dopo `handleSaveModel` (riga 230) aggiungi:
```ts
  const handleSaveModelDetail = async () => {
    await configSet("anthropicModelDetail", anthropicModelDetail);
    showSaved("modelDetail");
  };
```

- [ ] **Step 4: `SettingsPanel.tsx` — secondo selettore**

Subito dopo la chiusura del `Form.Group` del modello base + il suo `Form.Text` (dopo riga 479, prima di `</div>`) inserisci:
```tsx
            <Form.Group
              as={Row}
              className="mb-2"
              controlId="anthropic-model-detail"
            >
              <Form.Label column sm={3}>
                Modello analisi approfondita
              </Form.Label>
              <Col sm={7}>
                <Form.Select
                  value={anthropicModelDetail}
                  onChange={(e) => setAnthropicModelDetail(e.target.value)}
                >
                  <option value="">Come modello base (default)</option>
                  {modelOptionsSorted.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.display_name}
                    </option>
                  ))}
                </Form.Select>
              </Col>
              <Col sm={2}>
                <Button variant="danger" onClick={handleSaveModelDetail}>
                  {settingSaved === "modelDetail" ? (
                    <>
                      <FontAwesomeIcon icon={faCheck} /> Salvato
                    </>
                  ) : (
                    "Salva"
                  )}
                </Button>
              </Col>
            </Form.Group>
            <Row>
              <Col sm={{ span: 9, offset: 3 }}>
                <Form.Text>
                  Modello usato solo per l&apos;analisi approfondita (on-demand).
                  Vuoto = stesso modello base. Il Livello 1 (sintesi) e la voce
                  usano sempre il modello base.
                </Form.Text>
              </Col>
            </Row>
```
> ponytail: un modello di dettaglio non più presente nella lista live non viene marcato "(obsoleto)" come il base; lasciarlo così finché non serve.

- [ ] **Step 5: typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
```bash
git add src/renderer/store/settingsStore.ts src/renderer/loaders/settingsLoader.ts src/renderer/components/SettingsPanel.tsx
git commit -m "feat(settings): add optional Level-2 analysis model override (anthropicModelDetail)"
```

- [ ] **Step 6: Smoke manuale (dev)**

Run: `npm run dev`
Verifica: impostando "Modello analisi approfondita" su un modello diverso dal base e salvando, un nuovo "Mostra analisi approfondita" usa quel modello (senza restart); lasciandolo vuoto usa il base.

---

## Fase 7 — (Opzionale) Prompt caching

### Task 14: `cache_control` sul prefisso stabile del Livello 2

**Files:**
- Modify: `src/main/coach/session-coach.ts` (solo `expandAnalysis`)

Opzionale, non blocca il core. Applica `cache_control: { type: "ephemeral" }` all'ultimo blocco `system` del Livello 2 per accelerare le ri-espansioni dello stesso livello.

- [ ] **Step 1: `system` come array con cache_control** (in `expandAnalysis`, blocco `client.messages.stream`)

```ts
        const stream = client.messages.stream({
          model,
          max_tokens: 32000,
          system: [
            {
              type: "text",
              text: SESSION_SYSTEM_PROMPT,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: prompt }],
        });
```

- [ ] **Step 2: typecheck + lint + commit**

Run: `npm run typecheck && npm run lint`
```bash
git add src/main/coach/session-coach.ts
git commit -m "perf(coach): cache Level-2 system prefix (ephemeral)"
```

---

## Self-Review

**1. Spec coverage:**
- Modello dati (rename + `detail`, migrazione guarded, retrocompat) → Task 1. ✅
- Precalcolo `session-stats.ts` + self-check → Task 2. ✅
- Blocco "Dati Calcolati" iniettato in entrambi i prompt → Task 3 + iniezione in `buildSessionContext` (Task 4) usata anche da `buildSummaryPrompt` (Task 6). ✅
- Riorganizzazione prompt Livello 2 (Analisi approfondita, niente `[N]`) → Task 4. ✅
- Livello 1 (Analisi sintetica + Azioni suggerite + `<sintesi-vocale>`), `extractVoiceSummary`/`stripVoiceTag`, riscrittura `analyzeSession`, `max_tokens 2000` → Task 5-7. ✅
- Fix `652f7d4` preservata nel Livello 2 (`max_tokens 32000` + `stop_reason`) → Task 8. ✅
- `expandAnalysis` + IPC + preload + types → Task 8-9. ✅
- Loader condiviso `loadSessionBundle` (DRY: `analyzeSession` + `expandAnalysis` non duplicano il caricamento sessione) → Task 8 Step 2-3. ✅
- Renderer (store + AnalysisList) + PDF `detail ?? synthesis` → Task 10-12. ✅
- Override modello Livello 2 (`anthropicModelDetail`, base + override, live) → Task 8 (param `modelOverride`) + Task 9 (risoluzione live nell'handler) + Task 13 (config key + selettore SettingsPanel). ✅
- Contesto analisi precedenti usa `summary`/`synthesis` → Task 1 Step 7-8. ✅
- mockData migrato → Task 1 Step 11 (rename) + Task 12 (contenuti). ✅
- Verifica self-check `computeSessionStats` + `extractVoiceSummary`/`stripVoiceTag` → Task 2 / Task 5. ✅
- Prompt caching opzionale → Task 14. ✅ implementato, poi **rimosso il 2026-07-29** (vedi nota in testa al piano).
- Nota follow-up `CLAUDE.md` (fuori runtime) → vedi sotto.

**2. Placeholder scan:** nessun "TBD"/"handle edge cases"; ogni step di codice mostra il codice reale. Unica semplificazione dichiarata: Task 13 Step 4 non marca "(obsoleto)" un modello di dettaglio ritirato (nota `ponytail:` inline).

**3. Type consistency:** `synthesis`/`detail`/`summary` coerenti da DB→raw row→`SessionAnalysisRow`→renderer. `computeSessionStats`/`ComputeStatsInput`/`SessionStats` coerenti tra Task 2, 3, 4, 7, 8. `buildSessionContext` (interno), `buildSessionPrompt`/`buildSummaryPrompt` (export) e `SessionPromptInput.stats` coerenti. `sessionExpandAnalysis({ analysisId, game })` coerente tra preload, types, store, main.

## Fuori scope (YAGNI)

- Rigenerazione parziale di singoli paragrafi; secondo modello per il Livello 2; più versioni di `detail` (una sola, ri-espandere sovrascrive); Agent Skills.

## Follow-up (fuori dalle Fasi 1-7)

`session-stats.ts` (`criticalCorners`): una curva con alert ma senza dati zona in nessun giro viene azzerata a `minSpeedKmh: 0` / `maxBrakePct: 0` e nel blocco Dati Calcolati appare come "v.min 0km/h, freno 0%" — il modello può leggerlo come uno zero misurato. Fix: tenerli `null` e far omettere il campo a `buildStatsBlock`. Tracciato come commento `ponytail:` nel codice.

`CLAUDE.md` cita "Template v3" e "section [5]" (architettura `session-coach`, decisioni di design, schema DB): aggiornare ai nuovi nomi (Analisi sintetica/approfondita, `synthesis`/`detail`/`summary`, `<sintesi-vocale>`) a implementazione conclusa. Aggiornare anche la decisione "Analysis model"/"Coach model" per riflettere il knob `anthropicModelDetail` (override del solo Livello 2; Livello 1 + voce restano su `anthropicModel`). Non è nella catena runtime.
