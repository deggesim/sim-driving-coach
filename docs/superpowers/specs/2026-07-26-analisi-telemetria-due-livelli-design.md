# Analisi telemetria a due livelli (Analisi sintetica + Analisi approfondita)

**Data:** 2026-07-26
**Stato:** approvato

## Obiettivo

Rendere l'analisi di sessione **più veloce** e **più affidabile**, e insieme
**riorganizzare il prompt in modo semanticamente corretto** ora che le sezioni
finali sono sempre presenti.

Tre leve, un'unica architettura a due livelli:

1. **Velocità** — l'analisi è _output-bound_: il report pieno è 16k–32k token di
   output (a ~100 tok/s di Haiku ≈ 2.5–5 min, con rischio troncamento — tetto
   alzato 16k→32k in `652f7d4`). Cura alla radice: generare di default solo la
   parte breve (**Analisi sintetica**, ~2k token, ~15–25s) e produrre la parte
   pesante (**Analisi approfondita**) **solo su richiesta**.
2. **Precisione** — la sfiducia è complessiva. Cura: **precalcolare in TypeScript
   i fatti numerici esatti** e passarli al modello come dati autorevoli. Il
   modello **racconta e giudica**, non **calcola**.
3. **Semantica del prompt** — spariscono i marcatori numerici `[1]…[5]`. Il
   Livello 1 diventa **Analisi sintetica** (diagnosi condensata — assorbe la ex
   `[5]` Sintesi) + **Azioni suggerite** (ex `[4]`, setup o stile di guida); le
   tre iniziali (ex `[1]` Telemetria, `[2]` Problemi, `[3]` Setup) diventano
   **paragrafi** dentro **Analisi approfondita** (Livello 2).

## Decisioni concordate

- **Approccio A** (due livelli). La riorganizzazione semantica combacia con la
  suddivisione: Livello 1 = Analisi sintetica + Azioni suggerite; Livello 2 =
  Analisi approfondita.
- **Mapping colonne ↔ sezioni** (i tre campi di `session_analyses_<game>` vengono
  **rinominati** e se ne aggiunge uno):

  | Colonna nuova | Ex nome | Sezione | Livello |
  |---|---|---|---|
  | `synthesis` (`NOT NULL`) | `template_v3` | **Analisi sintetica** (diagnosi) + **Azioni suggerite** (setup / stile di guida) | 1 — sempre |
  | `detail` (nullable) | *(nuova, ex `detail_md` in bozza)* | **Analisi approfondita** (Telemetria / Problemi / Setup come paragrafi) | 2 — on-demand |
  | `summary` (nullable) | `section5_summary` | estratto TTS, max 3 frasi | letto ad alta voce |

- **Campo TTS `summary`**: prodotto come **blocco separato** delimitato in coda
  all'output del Livello 1 — `<sintesi-vocale> … </sintesi-vocale>` (max 3 frasi,
  senza markdown). Estratto e **rimosso** da `synthesis` prima del salvataggio.
- **Livello 1 = due sezioni**: **Analisi sintetica** (diagnosi condensata della
  sessione con i dati chiave — è già la sintesi, nessuna etichetta "Sintesi") +
  **Azioni suggerite** (setup o stile di guida per i giri successivi, 1–2 righe per
  azione, max 3). Niente formato ricco per-modifica
  (Razionale/Implementazione/Target/…).
- **Precalcolo fatti, non giudizi**: numeri esatti in TS; l'"impatto stimato in
  secondi/giro" resta al modello, derivato dai fatti forniti.
- **Modello per livello** (base + override L2): `anthropicModel` (default Haiku)
  guida il Livello 1 e la voce; una nuova chiave nullable `anthropicModelDetail`
  fa da override per il **solo Livello 2** (se vuota → ricade su `anthropicModel`).
  Il guadagno di velocità del Livello 1 resta dovuto all'output più piccolo; il
  Livello 2, on-demand, può usare un modello più capace per il ragionamento. Il
  modello del Livello 2 è risolto **live** nell'handler IPC (letto da config a ogni
  chiamata) e passato a `expandAnalysis` come parametro — nessuno stato mutabile
  nell'engine.
- **Non perdere la fix `652f7d4`**: il Livello 2 eredita `max_tokens: 32000` + la
  gestione `stop_reason === "max_tokens"`. Il Livello 1 non ne ha bisogno.
- **Prompt caching**: fase opzionale, non blocca il core.

## Modello dati

Ogni analisi resta **una riga** in `session_analyses_<game>` (r3e/ace/ams2). Riuso
di versioning, `comments_json`, delete, PDF, streaming.

`synthesis` è sempre presente (ex `template_v3`, resta `NOT NULL`): il rename
preserva il vincolo, quindi il campo sempre-presente (la sintesi) riempie la
colonna sempre-presente. `detail` è la nuova colonna nullable (Livello 2).

### Migrazione (`db.ts`)

1. **`CREATE TABLE`** (3 tabelle) aggiornata ai nomi nuovi: `synthesis TEXT NOT
   NULL`, `detail TEXT`, `summary TEXT`.
2. **`migrateSchema`** — nuove istruzioni guarded (try/catch, stesso pattern di
   `comments_json`), per ciascun gioco `<g>` ∈ {r3e, ace, ams2}:
   ```sql
   ALTER TABLE session_analyses_<g> RENAME COLUMN template_v3 TO synthesis;
   ALTER TABLE session_analyses_<g> RENAME COLUMN section5_summary TO summary;
   ALTER TABLE session_analyses_<g> ADD COLUMN detail TEXT;
   ```
   - DB nuovo: la `CREATE` usa già i nomi nuovi → le tre ALTER falliscono
     (colonna assente / già presente) e vengono ignorate dal try/catch.
   - DB esistente: la `CREATE IF NOT EXISTS` è no-op → i due RENAME + l'ADD
     applicano. (`RENAME COLUMN` richiede SQLite ≥ 3.25, incluso in better-sqlite3.)
3. **Retrocompat dati**: analisi vecchie → `synthesis` = report pieno,
   `detail` = null, `summary` = ex `section5_summary`. La UI le mostra come
   sintesi "lunga" senza pulsante approfondimento. Nessuna migrazione di contenuti.

## Precalcolo — `src/main/coach/session-stats.ts` (nuovo)

Modulo puro, `computeSessionStats(input): SessionStats`, riusa i `ZoneData` di
`zones_json` (stessa fonte del prompt-builder).

```ts
// locale a session-stats.ts (non serve al renderer → fuori da shared/types.ts)
type LapStat = {
  lapNumber: number;
  lapTime: number;
  deltaPrevSec: number | null;   // lapTime[n] - lapTime[n-1]
  deltaBestSec: number;          // lapTime[n] - bestLap
  gapToBestPct: number;          // deltaBestSec / bestLap * 100 (0 = è il best)
  valid: boolean;
  setupLabel: string | null;
};
type CornerStat = {
  zone: number; dist: number; cornerName: string | null;
  alertCount: number; alertsByType: Record<string, number>;
  minSpeedKmh: number; maxBrakePct: number;
  tcEvents: number; tcMs: number; absEvents: number; absMs: number;
  overlapMs: number;
  brakeTempsC: [number, number, number, number] | null;
};
type SessionStats = {
  lapCount: number; analyzableLapCount: number; bestLap: number | null;
  trend: "improving" | "worsening" | "mixed" | "flat";
  laps: LapStat[];
  criticalCorners: CornerStat[];  // ordinate desc per alertCount
  setupCount: number;
};
```

Formule verificabili: delta/gap = aritmetica diretta; `criticalCorners` =
aggregazione per `zone` su tutti i giri + sort desc; durate = frame×16ms.
`trend` = media ultimo terzo vs primo terzo dei tempi.
<!-- ponytail: trend euristico su 3 fasce; regressione lineare se serve finezza -->
**Non** calcolato: impatto stimato (resta giudizio del modello).

## Main process

### prompt-builder.ts

Blocco condiviso `## Dati Calcolati (autorevoli — cita questi numeri, NON
ricalcolare)` da `SessionStats`, iniettato in **entrambi** i prompt. I system
prompt impongono: cita esattamente questi numeri, mai ricalcolare. Spariscono
ovunque i marcatori `[1]…[5]` e la terminologia "Template v3"; via anche le
istruzioni "sezioni obbligatorie [1][3][4][5]" e "non troncare prima di [4]/[5]".

**Livello 1 — `buildSummaryPrompt` + `SUMMARY_SYSTEM_PROMPT` (nuovi):**
output =
```
## Analisi sintetica
Paragrafo condensato: diagnosi della sessione con i dati chiave (problema più
critico con numeri, trend giri). È già la sintesi — nessuna etichetta "Sintesi".

## Azioni suggerite
Azioni per migliorare i giri successivi (setup o stile di guida), max 3:
1. **Setup — Parametro: A → B** — razionale breve; effetto atteso ~X.XX s/giro.
2. **Guida — @XXXm NomeCurva** — azione (es. anticipa la staccata di 10m);
   effetto atteso ~X.XX s/giro.

<sintesi-vocale>
Massimo 3 frasi, SENZA markdown — versione parlata (feed `summary`/TTS).
</sintesi-vocale>
```

**Livello 2 — `buildSessionPrompt` + `SESSION_SYSTEM_PROMPT` (riscritti):**
output =
```
## Analisi approfondita

### Analisi telemetria      (ex [1] — panoramica, trend giri, curve critiche, gomme, dati mancanti)
### Problemi identificati    (ex [2] — tabella rank + dettagli per curva + pattern sistemico)
### Setup attuale vs proposto (ex [3] — omesso se nessun setup caricato)
```
Regole conservate: whitelist "Nomi Curve Autorizzati"; finestra temp freni; PSI/kPa;
leaderboard R3E; ogni affermazione con dato numerico. Il paragrafo Setup è l'unico
omissibile (nessun setup).

**Contesto analisi precedenti** (in `buildSessionPrompt` e altrove): usa
`a.summary` (ex `section5_summary`); fallback `a.synthesis.slice(0, 500)`
(ex `a.template_v3.slice`).

### session-coach.ts

- Estrattore TTS: `extractSection5` → **`extractVoiceSummary`** su tag
  `<sintesi-vocale>`; + `stripVoiceTag` che lo rimuove dal testo.
  ```ts
  const VOICE_TAG = /<sintesi-vocale>([\s\S]*?)<\/sintesi-vocale>/i;
  const extractVoiceSummary = (t: string) => VOICE_TAG.exec(t)?.[1]?.trim() ?? "";
  const stripVoiceTag = (t: string) => t.replace(VOICE_TAG, "").trimEnd();
  ```
- `analyzeSession` (**riscritto → Livello 1**): `computeSessionStats` →
  `buildSummaryPrompt`, streaming `max_tokens ~2000`, `SUMMARY_SYSTEM_PROMPT`.
  Persiste `synthesis = stripVoiceTag(fullText)`, `summary = extractVoiceSummary(fullText)`.
  `detail` = null. Nessuna gestione troncamento qui.
  INSERT: `(session_id, version, synthesis, summary, created_at)`.
- `expandAnalysis` (**nuovo**):
  ```ts
  expandAnalysis: (
    analysisId: number, game: GameSource,
    resolved?: { carName?: string; trackName?: string; layoutName?: string },
    modelOverride?: string, // Livello 2 (anthropicModelDetail); default = base model
  ) => Promise<SessionAnalysisRow | null>;
  ```
  Ricarica sessione+giri+setup+precedenti, ricomputa `SessionStats`,
  `buildSessionPrompt`, streaming con `model: modelOverride ?? model`,
  `max_tokens: 32000` + gestione `stop_reason === "max_tokens"` → `onError`
  (eredita `652f7d4`).
  `UPDATE … SET detail = ?`. Ritorna la riga aggiornata.
  Streaming instradato alla riga esistente via `(sessionId, version)` sui canali
  push esistenti — non crea una nuova versione.
- Tutti i tipi-riga raw e i mapping interni: `template_v3→synthesis`,
  `section5_summary→summary`, `+ detail`.

### main.ts

- Nuovo IPC `session:expandAnalysis` (`{ analysisId, game }`), stesso schema di
  `session:analyze` (valida apiKey, aggiorna cornerNames, risolve nomi,
  fire-and-forget con `analyzingInProgress`). Risolve il modello Livello 2 live:
  `(getConfig("anthropicModelDetail") as string) || getAnthropicModel()` e lo passa
  come `modelOverride` a `expandAnalysis`.
- `loadSessionDetail` (righe ~568–581): mapping ai nomi nuovi + `detail`.
- TTS post-analisi (~1896): `analysis.section5_summary` → `analysis.summary`.

## Preload + types

- `preload/index.ts`: espone `sessionExpandAnalysis` (invoke `session:expandAnalysis`).
- `shared/types.ts` — `SessionAnalysisRow`:
  ```ts
  synthesis: string;        // ex template_v3 (Analisi sintetica)
  detail: string | null;    // Analisi approfondita (Livello 2)
  summary: string | null;   // ex section5_summary (TTS)
  comments: AnalysisComment[];
  ```
  + firma `sessionExpandAnalysis` su `ElectronAPI`.

## Renderer

### sessionStore.ts

- Streaming/aggiornamento dettaglio: i chunk del Livello 2 si accumulano sulla
  riga bersaglio (per `version`); a `onDone` la riga in `analyses` è rimpiazzata
  con `detail` popolato. Nuovo metodo `expandAnalysis(id, game)` → IPC; `error`
  se `!ok`.

### AnalysisList.tsx

- Corpo pannello: mostra **sempre** `renderMd(a.synthesis)` (ex `a.template_v3`).
- Sotto:
  - se `a.detail` presente → lo rende (blocco `.deb-content`, dietro un toggle
    "Analisi approfondita");
  - altrimenti → pulsante **"Mostra analisi approfondita"** → `expandAnalysis(a.id)`;
  - durante la generazione → spinner + streaming (riuso del placeholder esistente;
    la parte streamata del Livello 1 viene ripulita del tag `<sintesi-vocale>`).

### global.css

Override dark-theme per l'eventuale contenitore/toggle "Analisi approfondita".

### SettingsPanel.tsx + settingsStore + settingsLoader

Nuova chiave config nullable `anthropicModelDetail` (modello del Livello 2). Un
secondo selettore modello in `SettingsPanel` che **riusa la stessa lista live**
(`anthropicListModels`) del selettore base, con un'opzione vuota "Come modello base
(default)". `settingsStore` aggiunge il campo `anthropicModelDetail` (default `""`) +
setter; `settingsLoader` lo bulk-carica; su salvataggio `configSet("anthropicModelDetail", …)`.
Stringa vuota = usa `anthropicModel`.

## PDF (`pdf-generator.ts`)

Rende `detail ?? synthesis` (approfondita se disponibile, altrimenti sintetica).
Aggiornati i riferimenti di colonna.

## voice-coach.ts

Contesto vocale: `a.section5_summary` → `a.summary`; fallback
`a.template_v3.slice(600)` → `a.synthesis.slice(600)`.

## mockData.ts

Le 3 analisi mock migrano alla nuova forma: `synthesis` = "## Analisi sintetica…",
`detail` = "## Analisi approfondita…" (o null su una per testare il pulsante),
`summary` = testo TTS. Rimossi i marcatori `## [5]`.

## Verifica (self-check)

Test `assert`-based (no framework):
- `computeSessionStats` su fixture 2–3 giri: `deltaPrevSec`/`deltaBestSec`/
  `gapToBestPct` tornano; `criticalCorners` ordinate desc per `alertCount`;
  `trend` coerente.
- `extractVoiceSummary`/`stripVoiceTag`: da un output con `<sintesi-vocale>`,
  estrae il testo e lo rimuove da `synthesis` (roundtrip); assenza del tag →
  `summary` = "".

## Fase opzionale — Prompt caching

`cache_control: {type:"ephemeral"}` sul prefisso stabile (system + Dati Calcolati)
del Livello 2. Cross-hit summary→dettaglio richiede `system` identico tra i livelli
(match posizionale): se serve, unificare in un `ANALYSIS_SYSTEM_PROMPT` unico con
scelta di formato nell'istruzione utente finale; altrimenti (default, più lazy) il
caching aiuta solo le ri-esecuzioni dello stesso livello. Non blocca il core.

## Fasi di implementazione (ordine)

1. **Dati** — `CREATE` aggiornata + RENAME×2 + ADD `detail` in `migrateSchema`;
   `SessionAnalysisRow` (synthesis/detail/summary); mapping in `loadSessionDetail`,
   `session-coach`, `voice-coach`, `pdf-generator`, `mockData`. (Rename propagato
   su tutta la catena; l'app resta compilabile.)
2. **Precisione** — `session-stats.ts` + self-check + blocco Dati Calcolati.
3. **Riorganizzazione prompt** — `SESSION_SYSTEM_PROMPT`/`buildSessionPrompt`
   riscritti in "Analisi approfondita" (paragrafi, niente `[N]`).
4. **Livello 1** — `buildSummaryPrompt`/`SUMMARY_SYSTEM_PROMPT` + `<sintesi-vocale>`
   + `extractVoiceSummary`/`stripVoiceTag` + riscrittura `analyzeSession`.
   _Qui arriva il guadagno di velocità._
5. **Livello 2** — `expandAnalysis` + IPC `session:expandAnalysis` + preload/types.
6. **UI** — `sessionStore` + `AnalysisList` (pulsante + streaming approfondita) + PDF.
7. **(Opzionale)** prompt caching.

## Fuori scope (YAGNI)

- Rigenerazione parziale di singoli paragrafi.
- Secondo modello dedicato al Livello 2.
- Più versioni di `detail` per la stessa analisi (una sola; ri-espandere sovrascrive).
- Agent Skills / code execution.

## Nota documentazione (follow-up)

`CLAUDE.md` cita "Template v3" e l'estrazione "section [5]" in più punti
(architettura `session-coach`, decisioni di design, schema DB). Da aggiornare ai
nuovi nomi (Analisi sintetica/approfondita, `synthesis`/`detail`/`summary`,
`<sintesi-vocale>`) al termine dell'implementazione — non è nella catena runtime,
quindi fuori dalle fasi 1–7.
