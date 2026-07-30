# Commenti di integrazione alle analisi — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere al pilota di commentare un'analisi di sessione (via testo o voce) e ricevere da Claude un'integrazione breve e focalizzata, mostrata sotto l'analisi con il commento su sfondo più chiaro.

**Architecture:** Nuova colonna `comments_json` su `session_analyses_*` che memorizza `AnalysisComment[]`. Un IPC `session:commentAnalysis` carica l'analisi, costruisce un prompt focalizzato (testo dell'analisi + commento), chiama Claude in modo non-streaming, accoda `{comment,response,created_at}` e ritorna la riga aggiornata. Il renderer mostra due nuovi pulsanti (commento/microfono) nell'header dell'analisi e renderizza i commenti sotto il corpo Template v3.

**Tech Stack:** Electron (IPC), better-sqlite3, `@anthropic-ai/sdk` (non-streaming `messages.create`), React 19 + react-bootstrap, Zustand, `marked`, MediaRecorder + Azure STT.

## Global Constraints

- TypeScript strict mode; `type` (mai `interface`); named exports; import relativi con estensione `.js`.
- Arrow functions ovunque; nessuna `class`; stile funzionale.
- UI: react-bootstrap + tema dark esclusivo via CSS var (`--bg`, `--bg2`, `--bg3`, `--border`, `--text`, `--text-dim`, `--accent`, `--accent2`). Sfondo "più chiaro" del commento = `--bg3` (#242424).
- Icone Font Awesome importate singolarmente da `@fortawesome/free-solid-svg-icons`.
- Tutto il testo UI e l'output vocale in italiano.
- Coach model: `claude-haiku-4-5-20251001`, override via `anthropicModel` (già gestito dal motore).
- Generazione integrazione: **non-streaming** (spinner). Nessun nuovo canale push.

## Testing Approach

Il repo **non ha un framework di test** né una cartella `scripts/`, e Node non risolve gli specificatori `.js`→`.ts` (impossibile eseguire i moduli sorgente in isolamento senza aggiungere un runner — fuori scope). Il gate automatico per ogni task è quindi:

```bash
npm run typecheck   # tsc su main+preload+shared e su web
npm run lint        # eslint .
```

`typecheck` è il gate forte: copre la coerenza di tipi/firme attraverso IPC, store e componenti (la maggior parte del rischio di questa feature). L'ultimo task contiene una checklist di **smoke test manuale** in `npm run dev`.
`ponytail:` niente unit test isolati — logica quasi tutta stringhe pure + wiring tipizzato; `typecheck`+`lint`+smoke manuale sono il livello proporzionato. Upgrade path: se in futuro si aggiunge `vitest`/`tsx`, testare `buildCommentPrompt` e `parseAnalysisComments`.

## File Structure

**Shared**

- `src/shared/types.ts` (mod) — `AnalysisComment`, campo `comments` su `SessionAnalysisRow`, `sessionCommentAnalysis` su `ElectronAPI`.

**Main**

- `src/main/db/db.ts` (mod) — 2 migrazioni `ALTER TABLE … ADD COLUMN comments_json TEXT`.
- `src/main/db/setup-row.ts` (mod) — `parseAnalysisComments(json): AnalysisComment[]`.
- `src/main/coach/prompt-builder.ts` (mod) — `COMMENT_SYSTEM_PROMPT`, `buildCommentPrompt`, estensione `buildSessionPrompt`.
- `src/main/coach/session-coach.ts` (mod) — metodo `commentAnalysis`, mapping `comments` su priorAnalyses e sul ritorno di `analyzeSession`.
- `src/main/main.ts` (mod) — IPC `session:commentAnalysis`, mapping `comments` in `loadSessionDetail`.
- `src/main/pdf-generator.ts` (mod) — render commenti nel PDF.

**Preload**

- `src/preload/index.ts` (mod) — espone `sessionCommentAnalysis`.

**Renderer**

- `src/renderer/lib/audio.ts` (new) — `pickMimeType`, `convertToWav` (estratti da `useVoiceCoach`).
- `src/renderer/hooks/useVoiceCoach.ts` (mod) — importa da `lib/audio`.
- `src/renderer/store/sessionStore.ts` (mod) — metodo `commentAnalysis`.
- `src/renderer/components/AnalysisCommentControls.tsx` (new) — pulsanti commento/microfono + modale + registrazione.
- `src/renderer/components/AnalysisList.tsx` (mod) — monta i controlli + render commenti.
- `src/renderer/styles/global.css` (mod) — stile `.analysis-comment`.
- `src/renderer/mocks/mockData.ts` (mod) — `comments: []` sui due literal analisi.

---

### Task 1: Tipi condivisi + fixup literal

**Files:**

- Modify: `src/shared/types.ts` (blocco `SessionAnalysisRow` ~233-240; `ElectronAPI` dopo `sessionDeleteAnalysis` ~479-482)
- Modify: `src/renderer/mocks/mockData.ts` (literal `ANALYSIS_R3E` ~46-48 e `ANALYSIS_ACE` ~89-91)
- Modify: `src/main/coach/session-coach.ts` (literal di ritorno di `analyzeSession` ~223-230)

**Interfaces:**

- Produces:
  - `type AnalysisComment = { comment: string; response: string; created_at: string }`
  - `SessionAnalysisRow.comments: AnalysisComment[]`
  - `ElectronAPI.sessionCommentAnalysis: (params: { id: number; game: GameSource; comment: string }) => Promise<{ ok: boolean; reason?: string; analysis?: SessionAnalysisRow }>`

- [ ] **Step 1: Aggiungi il tipo `AnalysisComment` e il campo `comments`**

In `src/shared/types.ts`, sostituisci il blocco `SessionAnalysisRow`:

```ts
export type AnalysisComment = {
  comment: string;
  response: string;
  created_at: string;
};

export type SessionAnalysisRow = {
  id: number;
  session_id: number;
  version: number;
  template_v3: string;
  section5_summary: string | null;
  created_at: string;
  comments: AnalysisComment[];
};
```

- [ ] **Step 2: Aggiungi la firma IPC su `ElectronAPI`**

In `src/shared/types.ts`, subito dopo il blocco `sessionDeleteAnalysis: (...) => Promise<void>;`:

```ts
sessionCommentAnalysis: (params: {
  id: number;
  game: GameSource;
  comment: string;
}) => Promise<{ ok: boolean; reason?: string; analysis?: SessionAnalysisRow }>;
```

- [ ] **Step 3: Aggiorna i literal mock**

In `src/renderer/mocks/mockData.ts`, aggiungi `comments: [],` dopo `created_at` in **entrambi** `ANALYSIS_R3E` e `ANALYSIS_ACE` (le righe `created_at: "2026-04-17T..."`). Esempio:

```ts
  created_at: "2026-04-17T08:25:00.000Z",
  comments: [],
```

- [ ] **Step 4: Aggiungi `comments: []` al ritorno di `analyzeSession` (stopgap)**

In `src/main/coach/session-coach.ts`, nel literal `const analysis: SessionAnalysisRow = { … }` di `analyzeSession`, aggiungi `comments: [],` dopo `created_at: createdAt,`:

```ts
const analysis: SessionAnalysisRow = {
  id: Number(result.lastInsertRowid),
  session_id: sessionId,
  version: nextVersion,
  template_v3: fullText,
  section5_summary: section5,
  created_at: createdAt,
  comments: [],
};
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS (nessun errore). Se compaiono errori "Property 'comments' is missing", c'è un altro literal `SessionAnalysisRow` da aggiornare — aggiungi `comments: []`.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/renderer/mocks/mockData.ts src/main/coach/session-coach.ts
git commit -m "feat(types): add AnalysisComment and comments field to analysis row"
```

---

### Task 2: Migrazione DB + parser commenti

**Files:**

- Modify: `src/main/db/db.ts` (array `migrations` in `migrateSchema` ~224-229)
- Modify: `src/main/db/setup-row.ts` (import ~6; nuova export in fondo)

**Interfaces:**

- Consumes: `AnalysisComment` (Task 1)
- Produces: `parseAnalysisComments(json: string | null | undefined): AnalysisComment[]`

- [ ] **Step 1: Aggiungi le migrazioni**

In `src/main/db/db.ts`, dentro l'array `migrations`, aggiungi in coda:

```ts
    `ALTER TABLE session_analyses_r3e ADD COLUMN comments_json TEXT`,
    `ALTER TABLE session_analyses_ace ADD COLUMN comments_json TEXT`,
```

- [ ] **Step 2: Aggiungi `parseAnalysisComments`**

In `src/main/db/setup-row.ts`, aggiorna l'import dei tipi e aggiungi la funzione in fondo al file:

```ts
import type {
  AnalysisComment,
  GameSource,
  SessionSetupRow,
  SetupData,
} from "../../shared/types.js";
```

```ts
export const parseAnalysisComments = (
  json: string | null | undefined,
): AnalysisComment[] => {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as AnalysisComment[]) : [];
  } catch {
    return [];
  }
};
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/main/db/db.ts src/main/db/setup-row.ts
git commit -m "feat(db): add comments_json column and parseAnalysisComments helper"
```

---

### Task 3: Prompt builder per i commenti

**Files:**

- Modify: `src/main/coach/prompt-builder.ts` (import tipi ~10-18; nuova export; sezione "Analisi precedenti" ~365-381)

**Interfaces:**

- Consumes: `AnalysisComment` (Task 1)
- Produces:
  - `COMMENT_SYSTEM_PROMPT: string`
  - `type CommentPromptInput = { analysisText: string; priorComments: AnalysisComment[]; comment: string; carName?: string; trackName?: string }`
  - `buildCommentPrompt(input: CommentPromptInput): string`

- [ ] **Step 1: Importa `AnalysisComment`**

In `src/main/coach/prompt-builder.ts`, aggiungi `AnalysisComment` all'import da `../../shared/types.js`:

```ts
import type {
  Alert,
  AnalysisComment,
  Deviation,
  ZoneData,
  LapRow,
  SessionRow,
  SessionSetupRow,
  SessionAnalysisRow,
} from "../../shared/types.js";
```

- [ ] **Step 2: Aggiungi `COMMENT_SYSTEM_PROMPT` e `buildCommentPrompt`**

In fondo a `src/main/coach/prompt-builder.ts`:

```ts
export const COMMENT_SYSTEM_PROMPT = `Sei un ingegnere di pista esperto. Il pilota ha appena letto una tua analisi di sessione e ti lascia un commento per correggerla o chiederti un'integrazione (es. un parametro di setup non modificabile, una valutazione che ritiene errata, una richiesta di approfondimento mirato).

Rispondi SOLO al commento, in italiano, con tono tecnico da ingegnere. Includi dati numerici quando rilevanti.
La risposta deve essere BREVE e FOCALIZZATA (massimo 4-6 frasi): conferma o correggi la valutazione e, se serve, proponi un'alternativa concreta.
NON riscrivere l'intera analisi. NON usare le intestazioni del Template v3 ([1], [2], [3], [4], [5]). NON produrre tabelle lunghe: al massimo poche righe markdown se indispensabili.
Se il pilota segnala che un parametro non è modificabile, accetta la correzione e proponi una leva alternativa effettivamente disponibile.`;

export type CommentPromptInput = {
  analysisText: string;
  priorComments: AnalysisComment[];
  comment: string;
  carName?: string;
  trackName?: string;
};

export const buildCommentPrompt = (input: CommentPromptInput): string => {
  const parts: string[] = [];
  parts.push(`## Contesto`);
  if (input.carName) parts.push(`- Auto: ${input.carName}`);
  if (input.trackName) parts.push(`- Circuito: ${input.trackName}`);
  parts.push("");
  parts.push(`## Analisi a cui si riferisce il commento`);
  parts.push(input.analysisText);
  parts.push("");
  if (input.priorComments.length > 0) {
    parts.push(`## Commenti e integrazioni precedenti su questa analisi`);
    input.priorComments.forEach((c, i) => {
      parts.push(`### Commento ${i + 1}`);
      parts.push(`Pilota: ${c.comment}`);
      parts.push(`Integrazione: ${c.response}`);
      parts.push("");
    });
  }
  parts.push(`## Nuovo commento del pilota`);
  parts.push(input.comment);
  parts.push("");
  parts.push(
    `Rispondi in modo breve e mirato a questo commento, seguendo le regole del system prompt.`,
  );
  return parts.join("\n");
};
```

- [ ] **Step 3: Includi i commenti nel prompt delle analisi future**

In `buildSessionPrompt`, nel blocco `if (priorAnalyses.length > 0)`, dentro il `for (const a of priorAnalyses)`, **prima** del `parts.push("")` finale del loop, aggiungi:

```ts
if (a.comments && a.comments.length > 0) {
  parts.push(`Commenti del pilota e integrazioni su questa analisi:`);
  for (const c of a.comments) {
    parts.push(`- Pilota: ${c.comment}`);
    parts.push(`  Integrazione: ${c.response}`);
  }
}
```

Il loop risultante:

```ts
for (const a of priorAnalyses) {
  parts.push(`### Analisi #${a.version} (${a.created_at})`);
  if (a.section5_summary) {
    parts.push(`Sintesi: ${a.section5_summary}`);
  } else {
    parts.push(a.template_v3.slice(0, 500));
  }
  if (a.comments && a.comments.length > 0) {
    parts.push(`Commenti del pilota e integrazioni su questa analisi:`);
    for (const c of a.comments) {
      parts.push(`- Pilota: ${c.comment}`);
      parts.push(`  Integrazione: ${c.response}`);
    }
  }
  parts.push("");
}
```

- [ ] **Step 4: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/coach/prompt-builder.ts
git commit -m "feat(coach): add comment prompt and surface comments in session prompt"
```

---

### Task 4: `commentAnalysis` nel SessionCoachEngine

**Files:**

- Modify: `src/main/coach/session-coach.ts` (import ~11-20; type `SessionCoachEngine` ~67-77; load `priorAnalyses` ~159-163; nuovo metodo nel return)

**Interfaces:**

- Consumes: `buildCommentPrompt`, `COMMENT_SYSTEM_PROMPT` (Task 3); `parseAnalysisComments` (Task 2); `AnalysisComment` (Task 1)
- Produces: `SessionCoachEngine.commentAnalysis(analysisId: number, game: GameSource, comment: string, resolved?: { carName?: string; trackName?: string }) => Promise<SessionAnalysisRow | null>`

- [ ] **Step 1: Aggiorna gli import**

In `src/main/coach/session-coach.ts`:

```ts
import {
  COMMENT_SYSTEM_PROMPT,
  SESSION_SYSTEM_PROMPT,
  buildCommentPrompt,
  buildSessionPrompt,
} from "./prompt-builder.js";
import {
  parseAnalysisComments,
  parseSetupRow,
  tableFor,
} from "../db/setup-row.js";
import type {
  Alert,
  AnalysisComment,
  GameSource,
  LapRow,
  SessionAnalysisRow,
  SessionRow,
  SessionSetupRow,
} from "../../shared/types.js";
```

- [ ] **Step 2: Mappa `comments` quando carichi `priorAnalyses`**

In `analyzeSession`, sostituisci il caricamento di `priorAnalyses`:

```ts
const priorAnalysesRaw = db
  .prepare(
    `SELECT * FROM ${analysesTable} WHERE session_id = ? ORDER BY version ASC`,
  )
  .all(sessionId) as Array<{
  id: number;
  session_id: number;
  version: number;
  template_v3: string;
  section5_summary: string | null;
  created_at: string;
  comments_json: string | null;
}>;
const priorAnalyses: SessionAnalysisRow[] = priorAnalysesRaw.map((r) => ({
  id: r.id,
  session_id: r.session_id,
  version: r.version,
  template_v3: r.template_v3,
  section5_summary: r.section5_summary,
  created_at: r.created_at,
  comments: parseAnalysisComments(r.comments_json),
}));
```

- [ ] **Step 3: Dichiara `commentAnalysis` sul type `SessionCoachEngine`**

In `export type SessionCoachEngine = { … }`, dopo `analyzeSession: (...)`:

```ts
commentAnalysis: (
  analysisId: number,
  game: GameSource,
  comment: string,
  resolved?: { carName?: string; trackName?: string },
) => Promise<SessionAnalysisRow | null>;
```

- [ ] **Step 4: Implementa `commentAnalysis` nel return**

Nel `return { … }` della factory, dopo il metodo `analyzeSession`, aggiungi:

```ts
    commentAnalysis: async (analysisId, game, comment, resolved) => {
      const analysesTable = tableFor(game, "session_analyses");
      const row = db
        .prepare(`SELECT * FROM ${analysesTable} WHERE id = ?`)
        .get(analysisId) as
        | {
            id: number;
            session_id: number;
            version: number;
            template_v3: string;
            section5_summary: string | null;
            created_at: string;
            comments_json: string | null;
          }
        | undefined;
      if (!row) return null;

      const priorComments = parseAnalysisComments(row.comments_json);
      const prompt = buildCommentPrompt({
        analysisText: row.template_v3,
        priorComments,
        comment,
        carName: resolved?.carName,
        trackName: resolved?.trackName,
      });

      let responseText = "";
      try {
        const msg = await client.messages.create({
          model,
          max_tokens: 2000,
          system: COMMENT_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        });
        responseText = msg.content
          .map((b) => (b.type === "text" ? b.text : ""))
          .join("");
      } catch (err) {
        console.error("[SessionCoach] comment API error:", err);
        if (isCreditOrQuotaError(err)) {
          options.onError?.(buildAnthropicErrorMessage(err));
        }
        return null;
      }

      const newComment: AnalysisComment = {
        comment,
        response: responseText,
        created_at: new Date().toISOString(),
      };
      const comments = [...priorComments, newComment];

      db.prepare(
        `UPDATE ${analysesTable} SET comments_json = ? WHERE id = ?`,
      ).run(JSON.stringify(comments), analysisId);

      return {
        id: row.id,
        session_id: row.session_id,
        version: row.version,
        template_v3: row.template_v3,
        section5_summary: row.section5_summary,
        created_at: row.created_at,
        comments,
      };
    },
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/main/coach/session-coach.ts
git commit -m "feat(coach): add commentAnalysis method to session coach engine"
```

---

### Task 5: IPC `session:commentAnalysis` + mapping in `loadSessionDetail`

**Files:**

- Modify: `src/main/main.ts` (import setup-row ~66; `loadSessionDetail` analyses ~536-541; nuovo handler vicino a `session:deleteAnalysis` ~1282-1289)

**Interfaces:**

- Consumes: `sessionCoach.commentAnalysis` (Task 4); `parseAnalysisComments` (Task 2)
- Produces: canale IPC `"session:commentAnalysis"` → `{ ok, reason?, analysis? }`

- [ ] **Step 1: Importa `parseAnalysisComments`**

In `src/main/main.ts`, aggiorna l'import da `./db/setup-row.js`:

```ts
import { parseAnalysisComments, parseSetupRow } from "./db/setup-row.js";
```

- [ ] **Step 2: Mappa `comments` in `loadSessionDetail`**

Sostituisci il caricamento `analyses` dentro `loadSessionDetail`:

```ts
const analysesRaw = db
  .prepare(
    `SELECT * FROM ${t("session_analyses", game)} WHERE session_id = ? ORDER BY version ASC`,
  )
  .all(sessionId) as Array<{
  id: number;
  session_id: number;
  version: number;
  template_v3: string;
  section5_summary: string | null;
  created_at: string;
  comments_json: string | null;
}>;
const analyses: SessionAnalysisRow[] = analysesRaw.map((r) => ({
  id: r.id,
  session_id: r.session_id,
  version: r.version,
  template_v3: r.template_v3,
  section5_summary: r.section5_summary,
  created_at: r.created_at,
  comments: parseAnalysisComments(r.comments_json),
}));

return { session, laps, setups, analyses };
```

- [ ] **Step 3: Aggiungi l'handler IPC**

In `src/main/main.ts`, subito dopo l'handler `ipcMain.handle("session:deleteAnalysis", …)`:

```ts
ipcMain.handle(
  "session:commentAnalysis",
  async (
    _event,
    { id, game, comment }: { id: number; game: GameSource; comment: string },
  ) => {
    const text = (comment ?? "").trim();
    if (!text) return { ok: false, reason: "Commento vuoto." };

    const apiKey = getAnthropicApiKey();
    if (!apiKey) {
      return { ok: false, reason: "API Key Anthropic non configurata." };
    }
    sessionCoach.updateApiKey(apiKey);
    sessionCoach.updateCornerNames(buildCornerMap());

    const sRow = db
      .prepare(
        `SELECT s.car AS car, s.track AS track, s.layout AS layout
             FROM ${t("session_analyses", game)} a
             JOIN ${t("sessions", game)} s ON s.id = a.session_id
            WHERE a.id = ?`,
      )
      .get(id) as { car: string; track: string; layout: string } | undefined;
    const resolved = sRow
      ? resolveNames(game, sRow.car, sRow.track, sRow.layout)
      : undefined;

    const analysis = await sessionCoach.commentAnalysis(
      id,
      game,
      text,
      resolved,
    );
    if (!analysis) {
      return { ok: false, reason: "Impossibile generare l'integrazione." };
    }
    return { ok: true, analysis };
  },
);
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (Se `getAnthropicApiKey` / `buildCornerMap` / `resolveNames` risultassero non in scope, sono definiti nello stesso modulo — verifica di essere dentro la stessa funzione che registra gli altri `session:*` handler.)

- [ ] **Step 5: Commit**

```bash
git add src/main/main.ts
git commit -m "feat(ipc): add session:commentAnalysis handler and map comments in detail"
```

---

### Task 6: Espone `sessionCommentAnalysis` nel preload

**Files:**

- Modify: `src/preload/index.ts` (vicino a `sessionDeleteAnalysis` ~110-111)

**Interfaces:**

- Consumes: canale `"session:commentAnalysis"` (Task 5)
- Produces: `electronAPI.sessionCommentAnalysis`

- [ ] **Step 1: Aggiungi il metodo**

In `src/preload/index.ts`, dopo `sessionDeleteAnalysis`:

```ts
  sessionCommentAnalysis: (params: { id: number; game: string; comment: string }) =>
    ipcRenderer.invoke("session:commentAnalysis", params),
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat(preload): expose sessionCommentAnalysis"
```

---

### Task 7: Estrai utility audio condivise

**Files:**

- Create: `src/renderer/lib/audio.ts`
- Modify: `src/renderer/hooks/useVoiceCoach.ts` (rimuovi `pickMimeType` ~118-128 e `convertToWav` ~137-188; importa da `lib/audio`)

**Interfaces:**

- Produces: `pickMimeType(): string`, `convertToWav(blob: Blob): Promise<ArrayBuffer>`

- [ ] **Step 1: Crea `src/renderer/lib/audio.ts`**

```ts
/**
 * Audio helpers shared by voice features (voice coach + analysis voice comments).
 * Records via MediaRecorder, converts to WAV PCM 16-bit mono 16 kHz for Azure STT.
 */

/** Pick the best supported MIME type for MediaRecorder. */
export const pickMimeType = (): string => {
  for (const type of [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ]) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
};

/**
 * Convert any audio Blob (WebM/Opus, Ogg, etc.) to WAV PCM 16-bit mono 16 kHz.
 *
 * Azure STT REST API accepts WebM/Opus in theory but in practice returns
 * Success with an empty transcript. WAV/PCM is the only format the REST
 * endpoint handles reliably without the full Azure Speech SDK.
 */
export const convertToWav = async (blob: Blob): Promise<ArrayBuffer> => {
  const raw = await blob.arrayBuffer();

  const decodeCtx = new AudioContext();
  const decoded = await decodeCtx.decodeAudioData(raw);
  await decodeCtx.close();

  const TARGET_RATE = 16000;
  const numFrames = Math.ceil(decoded.duration * TARGET_RATE);
  const offlineCtx = new OfflineAudioContext(1, numFrames, TARGET_RATE);
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();

  const samples = rendered.getChannelData(0);
  const dataBytes = samples.length * 2;
  const wav = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(wav);

  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_RATE, true);
  view.setUint32(28, TARGET_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return wav;
};
```

- [ ] **Step 2: Rimuovi i duplicati da `useVoiceCoach.ts` e importa**

In `src/renderer/hooks/useVoiceCoach.ts`:

1. Cancella la funzione `pickMimeType` (def. locale) e l'intera funzione `convertToWav` (def. locale) con i loro commenti.
2. Aggiungi in testa, dopo gli import React esistenti:

```ts
import { convertToWav, pickMimeType } from "../lib/audio";
```

Lascia invariate `playActivationSound` / `playDeactivationSound` / `toArrayBuffer` (restano locali).

- [ ] **Step 3: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS (nessun "unused" — `pickMimeType`/`convertToWav` ora vengono importati e usati).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/lib/audio.ts src/renderer/hooks/useVoiceCoach.ts
git commit -m "refactor(renderer): extract shared audio helpers to lib/audio"
```

---

### Task 8: Metodo `commentAnalysis` nello store

**Files:**

- Modify: `src/renderer/store/sessionStore.ts` (type `State` dopo `deleteAnalysis` ~38; implementazione dopo `deleteAnalysis` ~139-147)

**Interfaces:**

- Consumes: `electronAPI.sessionCommentAnalysis` (Task 6)
- Produces: `useSessionStore().commentAnalysis(id: number, comment: string) => Promise<void>`

- [ ] **Step 1: Dichiara il metodo nel type `State`**

In `src/renderer/store/sessionStore.ts`, nel type `State`, dopo `deleteAnalysis: (id: number) => Promise<void>;`:

```ts
commentAnalysis: (id: number, comment: string) => Promise<void>;
```

- [ ] **Step 2: Implementa il metodo**

Dopo l'implementazione di `deleteAnalysis` nel `create<State>(...)`:

```ts
  commentAnalysis: async (id, comment) => {
    const s = get();
    if (!s.session) return;
    const res = await window.electronAPI.sessionCommentAnalysis({
      id,
      game: s.session.game,
      comment,
    });
    if (res.ok && res.analysis) {
      const updated = res.analysis;
      set({
        analyses: get().analyses.map((a) => (a.id === updated.id ? updated : a)),
      });
    } else {
      set({ error: res.reason ?? "Errore durante l'integrazione del commento." });
    }
  },
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/renderer/store/sessionStore.ts
git commit -m "feat(store): add commentAnalysis to sessionStore"
```

---

### Task 9: Componente `AnalysisCommentControls`

**Files:**

- Create: `src/renderer/components/AnalysisCommentControls.tsx`

**Interfaces:**

- Consumes: `useSessionStore().commentAnalysis` (Task 8); `useSettingsStore` (`azureSpeechKey`, `azureRegion`); `convertToWav`, `pickMimeType` (Task 7); `electronAPI.sttTranscribe`
- Produces: `default export AnalysisCommentControls` con props `{ analysisId: number }`

- [ ] **Step 1: Crea il componente**

```tsx
import { faComment, faMicrophone } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useRef, useState } from "react";
import { Button, Form, Modal, Spinner } from "react-bootstrap";
import { convertToWav, pickMimeType } from "../lib/audio";
import { useSessionStore } from "../store/sessionStore";
import { useSettingsStore } from "../store/settingsStore";

/** Max recording duration in ms before auto-stopping. */
const MAX_RECORD_MS = 8000;

type Props = { analysisId: number };

const AnalysisCommentControls = ({ analysisId }: Props) => {
  const commentAnalysis = useSessionStore((s) => s.commentAnalysis);
  const azureSpeechKey = useSettingsStore((s) => s.azureSpeechKey);
  const azureRegion = useSettingsStore((s) => s.azureRegion);
  const sttReady = azureSpeechKey.trim() !== "" && azureRegion.trim() !== "";

  const [showModal, setShowModal] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const submit = async (value: string) => {
    const v = value.trim();
    if (!v) return;
    setBusy(true);
    try {
      await commentAnalysis(analysisId, v);
    } finally {
      setBusy(false);
    }
  };

  const handleTextConfirm = () => {
    const v = text;
    setShowModal(false);
    setText("");
    void submit(v);
  };

  const stopRecording = () => {
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  };

  const startRecording = () => {
    if (busy || recording || !sttReady) return;
    const mimeType = pickMimeType();
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const recorder = new MediaRecorder(
          stream,
          mimeType ? { mimeType } : undefined,
        );
        recorderRef.current = recorder;
        const chunks: BlobPart[] = [];

        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          recorderRef.current = null;
          setRecording(false);

          const blob = new Blob(chunks, {
            type: mimeType || "audio/webm;codecs=opus",
          });
          if (blob.size === 0) return;

          setBusy(true);
          convertToWav(blob)
            .then((buf) => window.electronAPI.sttTranscribe(buf, "audio/wav"))
            .then((transcript) => {
              const trimmed = transcript.trim();
              if (trimmed) return commentAnalysis(analysisId, trimmed);
            })
            .catch((err: unknown) =>
              console.error("[CommentControls] STT error:", err),
            )
            .finally(() => setBusy(false));
        };

        recorder.start();
        setRecording(true);
        setTimeout(() => {
          if (recorder.state !== "inactive") recorder.stop();
        }, MAX_RECORD_MS);
      })
      .catch((err: unknown) => {
        console.error("[CommentControls] mic error:", err);
        setRecording(false);
      });
  };

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="p-0 px-3 rounded-0"
        title="Commenta l'analisi"
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          setShowModal(true);
        }}
      >
        {busy ? <Spinner size="sm" /> : <FontAwesomeIcon icon={faComment} />}
      </Button>
      <Button
        type="button"
        variant={recording ? "danger" : "secondary"}
        size="sm"
        className="p-0 px-3 rounded-0"
        title={
          sttReady
            ? recording
              ? "Ferma registrazione"
              : "Commento vocale"
            : "Azure STT non configurato"
        }
        disabled={busy || !sttReady}
        onClick={(e) => {
          e.stopPropagation();
          if (recording) stopRecording();
          else startRecording();
        }}
      >
        <FontAwesomeIcon icon={faMicrophone} />
      </Button>

      <Modal
        show={showModal}
        onHide={() => setShowModal(false)}
        centered
        className="delete-confirm-modal"
      >
        <Modal.Header closeButton>
          <Modal.Title>Commenta l&apos;analisi</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form.Control
            as="textarea"
            rows={4}
            value={text}
            autoFocus
            placeholder="Suggerisci una modifica o correggi una valutazione…"
            onChange={(e) => setText(e.target.value)}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModal(false)}>
            Annulla
          </Button>
          <Button
            variant="primary"
            onClick={handleTextConfirm}
            disabled={text.trim() === ""}
          >
            Invia
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
};

export default AnalysisCommentControls;
```

- [ ] **Step 2: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/AnalysisCommentControls.tsx
git commit -m "feat(ui): add AnalysisCommentControls (text + voice comment)"
```

---

### Task 10: Integra i controlli e renderizza i commenti in `AnalysisList`

**Files:**

- Modify: `src/renderer/components/AnalysisList.tsx` (header component ~26-69; map ~168-186)
- Modify: `src/renderer/styles/global.css` (in coda alla sezione Accordion ~177)

**Interfaces:**

- Consumes: `AnalysisCommentControls` (Task 9); `SessionAnalysisRow.comments` (Task 1)

- [ ] **Step 1: Importa il componente**

In `src/renderer/components/AnalysisList.tsx`, dopo gli import esistenti:

```ts
import AnalysisCommentControls from "./AnalysisCommentControls";
```

- [ ] **Step 2: Passa `analysisId` all'header e monta i controlli**

Aggiorna i props di `AnalysisAccordionHeader` (aggiungi `analysisId: number;`) e monta i due pulsanti **prima** del pulsante "Elimina":

```tsx
const AnalysisAccordionHeader = ({
  eventKey,
  analysisId,
  version,
  createdAt,
  onDelete,
}: {
  eventKey: string;
  analysisId: number;
  version: number;
  createdAt: string;
  onDelete: (e: React.MouseEvent) => void;
}) => {
  const { activeEventKey } = use(AccordionContext);
  const handleToggle = useAccordionButton(eventKey);
  const isOpen = Array.isArray(activeEventKey)
    ? activeEventKey.includes(eventKey)
    : activeEventKey === eventKey;

  return (
    <h2 className="accordion-header dark-header d-flex align-items-stretch">
      <AnalysisCommentControls analysisId={analysisId} />
      <Button
        type="button"
        variant="danger"
        size="sm"
        className="p-0 px-3 rounded-0"
        title="Elimina analisi"
        onClick={onDelete}
      >
        <FontAwesomeIcon icon={faTrash} />
      </Button>
      <button
        type="button"
        className={`accordion-button flex-grow-1${isOpen ? "" : " collapsed"}`}
        onClick={handleToggle}
      >
        <span className="flex-grow-1">
          Analisi #{version}
          <span className="ms-2">
            {new Date(createdAt).toLocaleString("it-IT")}
          </span>
        </span>
      </button>
    </h2>
  );
};
```

- [ ] **Step 3: Passa `analysisId` nella map**

Nel render, aggiorna l'uso di `<AnalysisAccordionHeader … />` aggiungendo `analysisId={a.id}`:

```tsx
<AnalysisAccordionHeader
  eventKey={`v${a.version}`}
  analysisId={a.id}
  version={a.version}
  createdAt={a.created_at}
  onDelete={(e) => handleDeleteClick(e, a.id, a.version)}
/>
```

- [ ] **Step 4: Renderizza i commenti sotto il corpo dell'analisi**

Nella `Accordion.Body` dell'item analisi, dopo il `<div className="deb-content" … />`, aggiungi:

```tsx
<Accordion.Body className="overflow-y-auto">
  <div
    className="deb-content"
    // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
    dangerouslySetInnerHTML={{
      __html: renderedById.get(a.id) ?? "",
    }}
  />
  {a.comments.length > 0 && (
    <div className="analysis-comments">
      {a.comments.map((c) => (
        <div key={c.created_at} className="analysis-comment">
          <div className="analysis-comment-label">Commento</div>
          <div className="analysis-comment-text">{c.comment}</div>
          <div
            className="analysis-comment-response deb-content"
            // eslint-disable-next-line @eslint-react/dom-no-dangerously-set-innerhtml
            dangerouslySetInnerHTML={{ __html: renderMd(c.response) }}
          />
        </div>
      ))}
    </div>
  )}
</Accordion.Body>
```

- [ ] **Step 5: Aggiungi lo stile dark del commento**

In `src/renderer/styles/global.css`, in coda alla sezione Accordion (dopo `.accordion-header.dark-header { … }`):

```css
/* Analysis integration comments (user input + AI response) */
.analysis-comment {
  background: var(--bg3);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent2);
  border-radius: 6px;
  padding: 10px 12px;
  margin-top: 12px;
}
.analysis-comment-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-dim);
  margin-bottom: 4px;
}
.analysis-comment-text {
  white-space: pre-wrap;
  color: var(--text);
  margin-bottom: 8px;
}
.analysis-comment-response {
  border-top: 1px solid var(--border);
  padding-top: 8px;
}
```

- [ ] **Step 6: Typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/AnalysisList.tsx src/renderer/styles/global.css
git commit -m "feat(ui): mount comment controls and render comments in AnalysisList"
```

---

### Task 11: Commenti nel PDF

**Files:**

- Modify: `src/main/pdf-generator.ts` (import ~11; `analysesHtml` ~92-98; `<style>` ~102-119)

**Interfaces:**

- Consumes: `SessionAnalysisRow.comments` (Task 1)

- [ ] **Step 1: Importa il tipo**

In `src/main/pdf-generator.ts`:

```ts
import type {
  GameSource,
  SessionAnalysisRow,
  SessionDetail,
} from "../shared/types.js";
```

- [ ] **Step 2: Rendi i commenti dopo ogni analisi**

Sostituisci la definizione di `analysesHtml`:

```ts
const commentsHtml = (a: SessionAnalysisRow): string =>
  a.comments.length === 0
    ? ""
    : a.comments
        .map(
          (c) => `
        <div class="comment-box">
          <div class="comment-label">Commento pilota</div>
          <div class="comment-text">${escapeHtml(c.comment)}</div>
          <div class="comment-response">${postProcess(marked.parse(c.response, { async: false }) as string)}</div>
        </div>`,
        )
        .join("");

const analysesHtml = analyses
  .map(
    (a) => `
        <h2>Analisi #${a.version} <span class="muted">(${new Date(a.created_at).toLocaleString("it-IT")})</span></h2>
        <div class="analysis-body">${postProcess(marked.parse(a.template_v3, { async: false }) as string)}</div>
        ${commentsHtml(a)}`,
  )
  .join("");
```

- [ ] **Step 3: Aggiungi lo stile PDF**

Nel blocco `<style>` di `buildSessionHtml`, prima di `.footer`:

```css
.comment-box {
  background: #f4f7fb;
  border: 1px solid #d0d9e6;
  border-left: 3px solid #0a3d62;
  border-radius: 4px;
  padding: 8px 10px;
  margin: 8px 0;
}
.comment-label {
  font-size: 9px;
  text-transform: uppercase;
  color: #5a6b80;
  margin-bottom: 3px;
}
.comment-text {
  font-style: italic;
  color: #333;
  margin-bottom: 6px;
  white-space: pre-wrap;
}
.comment-response {
  font-size: 11px;
  line-height: 1.5;
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/main/pdf-generator.ts
git commit -m "feat(pdf): include analysis comments in session PDF"
```

---

### Task 12: Verifica finale + smoke test manuale

**Files:** nessuna modifica (solo verifica).

- [ ] **Step 1: Gate completo**

Run: `npm run typecheck && npm run lint`
Expected: PASS, zero errori.

- [ ] **Step 2: Avvia l'app**

Run: `npm run dev`
Expected: l'app parte senza errori in console main/renderer.

- [ ] **Step 3: Smoke test commento testuale**

1. Apri una sessione (o aprine una storica con almeno un'analisi); se serve genera un'analisi con "Esegui analisi".
2. Nell'header dell'analisi compaiono due nuovi pulsanti (commento, microfono) accanto al cestino.
3. Click sul pulsante commento → si apre la modale con la `textarea`.
4. Scrivi es. "La ripartizione freni non è modificabile su quest'auto, proponi un'alternativa" → "Invia".
5. Il pulsante commento mostra lo spinner; al termine, sotto il corpo dell'analisi appare un box più chiaro (`--bg3`) con il tuo commento + la risposta di integrazione (breve, mirata, senza intestazioni [1]..[5]).

Expected: comportamento come sopra; il commento persiste riaprendo la sessione (verifica con "Indietro" → riapri il dettaglio).

- [ ] **Step 4: Smoke test commento vocale (se Azure STT configurato)**

1. Click sul pulsante microfono → diventa rosso (registrazione); parla; click di nuovo per fermare (o attendi l'auto-stop).
2. Al termine parte la trascrizione e subito l'integrazione, senza step di conferma.

Expected: nuovo box commento con la trascrizione + risposta. Se Azure STT non è configurato, il pulsante microfono è disabilitato (tooltip "Azure STT non configurato").

- [ ] **Step 5: Smoke test PDF**

1. "Esporta PDF" sulla sessione commentata.
2. Apri il PDF: sotto l'analisi compaiono i box commento (sfondo chiaro) con commento + integrazione.

Expected: i commenti sono presenti nel PDF.

- [ ] **Step 6: Verifica re-analisi con contesto**

1. Con un commento già presente, click "Esegui analisi" per generare una nuova versione.
2. La nuova analisi tiene conto del commento (es. non ripropone il parametro segnalato come non modificabile).

Expected: la nuova analisi riflette il commento precedente.

---

## Self-Review

**Spec coverage:**

- Due pulsanti accanto a Elimina (commento/microfono) → Task 9 + Task 10. ✓
- Modale con textarea, invio alla conferma → Task 9. ✓
- Commento vocale, invio a fine input → Task 9. ✓
- Risposta focalizzata (non Template v3) → Task 3 (`COMMENT_SYSTEM_PROMPT`/`buildCommentPrompt`) + Task 4. ✓
- Aggiunta all'analisi esistente + commento con sfondo più chiaro → Task 1 (dati), Task 10 (render + CSS `--bg3`). ✓
- Persistenza → Task 2 (colonna) + Task 4/5 (UPDATE + mapping). ✓
- Contesto nelle analisi future → Task 3 (`buildSessionPrompt`) + Task 4 (mapping priorAnalyses). ✓
- PDF → Task 11. ✓
- Non-streaming/spinner → Task 4 (`messages.create`) + Task 9 (`busy`). ✓

**Placeholder scan:** nessun TODO/TBD; ogni step ha codice o comando concreto.

**Type consistency:** `AnalysisComment` { comment, response, created_at } usato identico in types/setup-row/prompt-builder/session-coach/AnalysisList/pdf-generator. IPC `sessionCommentAnalysis` con firma `{ id, game, comment } → { ok, reason?, analysis? }` coerente tra types (Task 1), preload (Task 6), main handler (Task 5), store (Task 8). `commentAnalysis(analysisId, game, comment, resolved?)` coerente tra engine type e implementazione (Task 4). `buildCommentPrompt(CommentPromptInput)` coerente tra Task 3 e Task 4.

## Execution Handoff

Piano salvato in `docs/superpowers/plans/2026-06-25-analysis-comments.md`.
