# Commenti di integrazione alle analisi di sessione

**Data:** 2026-06-25
**Stato:** approvato

## Obiettivo

Dopo che un'analisi di sessione è stata generata (in tempo reale o offline), il
pilota deve poter **commentare l'analisi** per suggerire modifiche o correggere
valutazioni errate (es. il coach suggerisce di cambiare un parametro di setup non
modificabile). Il commento innesca una richiesta a Claude che produce una
risposta **focalizzata sul commento** (non un Template v3 completo), aggiunta
all'analisi esistente insieme al commento dell'utente, mostrato con uno sfondo
più chiaro per distinguere l'input umano.

Inserimento commento tramite due pulsanti accanto al pulsante di eliminazione:
- icona "commenta" → apre una modale con una `textarea`;
- icona "microfono" → commento vocale.

Alla conferma della modale o al termine dell'input vocale parte subito la
richiesta di integrazione (nessuno step di conferma per la voce).

## Decisioni concordate

- **Generazione**: non-streaming, spinner sull'analisi finché la risposta (breve)
  è pronta. Nessun nuovo canale push.
- **Contesto futuro**: i commenti e le integrazioni sono inclusi nel prompt delle
  analisi successive (`buildSessionPrompt`).
- **PDF**: l'export include commenti e integrazioni.

## Modello dati

Colonna dedicata (no append dentro `template_v3`).

Migrazione in `db.ts` (`migrateSchema`, stesso pattern try/catch esistente):

```sql
ALTER TABLE session_analyses_r3e ADD COLUMN comments_json TEXT;
ALTER TABLE session_analyses_ace ADD COLUMN comments_json TEXT;
```

`comments_json` contiene la serializzazione di `AnalysisComment[]`:

```ts
// shared/types.ts
export type AnalysisComment = {
  comment: string;     // testo (o trascrizione) inserito dall'utente
  response: string;    // integrazione focalizzata prodotta da Claude (markdown)
  created_at: string;  // ISO
};

// SessionAnalysisRow guadagna:
comments: AnalysisComment[]; // parsato da comments_json (default [])
```

`loadSessionDetail` (main.ts) e il caricamento analisi in `session-coach.ts`
mappano `comments_json` → `comments` (parse con fallback `[]`).

## Main process

### prompt-builder.ts

- `COMMENT_SYSTEM_PROMPT`: ingegnere di pista, italiano, tono tecnico, dati
  numerici quando rilevanti. Deve produrre una risposta **breve e mirata** che
  risponde SOLO al commento — conferma/smentisce la valutazione, propone
  l'alternativa. **Niente intestazioni Template v3**, niente ripetizione
  dell'intera analisi.
- `buildCommentPrompt({ analysis, comment, carName, trackName }): string`:
  include identità sessione (auto/circuito), il testo `analysis.template_v3` come
  contesto, gli eventuali commenti precedenti dell'analisi, e il nuovo commento
  utente. Non ricarica giri/setup: l'analisi li riassume già.
- `buildSessionPrompt`: nella sezione "Analisi precedenti", per ogni analisi con
  `comments.length > 0`, elenca commento + integrazione, così le analisi
  successive ne tengono conto.

### session-coach.ts

Nuovo metodo su `SessionCoachEngine`:

```ts
commentAnalysis: (
  analysisId: number,
  game: GameSource,
  comment: string,
  resolved?: { carName?: string; trackName?: string },
) => Promise<SessionAnalysisRow | null>;
```

Flusso:
1. `SELECT *` dell'analisi (template_v3 + comments_json) dalla tabella del gioco;
   `null` se assente.
2. `buildCommentPrompt(...)`.
3. `client.messages.create` (non-streaming, stesso model/apiKey del motore;
   `max_tokens` ridotto, es. 2000). Riusa `isCreditOrQuotaError` /
   `buildAnthropicErrorMessage` per gli errori.
4. Accoda `{ comment, response, created_at }` all'array parsato, `UPDATE
   comments_json`.
5. Ritorna la `SessionAnalysisRow` aggiornata (con `comments` popolato).

### main.ts

- IPC `session:commentAnalysis`:
  ```ts
  ({ id, game, comment }: { id: number; game: GameSource; comment: string })
    => Promise<{ ok: boolean; reason?: string; analysis?: SessionAnalysisRow }>
  ```
  Valida apiKey (riusa `getAnthropicApiKey`), aggiorna apiKey/cornerNames sul
  motore, risolve i nomi, delega a `sessionCoach.commentAnalysis`. Restituisce
  `{ ok: true, analysis }` o `{ ok: false, reason }`.
- `loadSessionDetail`: mappa le righe analisi parsando `comments_json` → `comments`.

## Preload + types

- `preload/index.ts`: espone `commentAnalysis` su `electronAPI` (invoke
  `session:commentAnalysis`).
- `shared/types.ts`: `AnalysisComment`, campo `comments` su `SessionAnalysisRow`,
  firma `commentAnalysis` su `ElectronAPI`.

## Renderer

### lib/audio.ts (nuovo)

Estrae da `useVoiceCoach` (dedup): `convertToWav(blob): Promise<ArrayBuffer>` e
`pickMimeType(): string`. `useVoiceCoach` li reimporta — nessun cambiamento di
comportamento.

### AnalysisCommentControls.tsx (nuovo)

Componente per-analisi, riceve `{ analysisId }`. Contiene:
- pulsante `faComment` → apre la modale con `textarea`; "Conferma" →
  `commentAnalysis(analysisId, text)`.
- pulsante `faMicrophone` → registra (riuso `MediaRecorder` + `convertToWav` +
  `sttTranscribe`), max ~5s o stop manuale; a fine registrazione trascrive e
  chiama subito `commentAnalysis(analysisId, transcript)`. Disabilitato se Azure
  STT non configurato (`settingsStore.azureSpeechKey` / `azureRegion`).
- spinner / pulsanti disabilitati mentre la richiesta è in volo (stato locale).

### AnalysisList.tsx

- Nell'header di ogni analisi, monta `<AnalysisCommentControls analysisId={a.id} />`
  accanto al pulsante elimina (stesso stile a barra dell'attuale `faTrash`).
- Sotto il corpo `template_v3`, renderizza `a.comments`: per ognuno un box
  `.analysis-comment` (sfondo `--bg3`, più chiaro) col testo del commento (plain
  text, non markdown), seguito dalla risposta resa con `marked`.

### sessionStore.ts

```ts
commentAnalysis: (id: number, comment: string) => Promise<void>;
```
Chiama l'IPC; se `ok`, rimpiazza la riga analisi in `analyses` con
`res.analysis`. Se `!ok`, imposta `error`.

### global.css

Override dark-theme per `.analysis-comment` (sfondo `--bg3`, bordo `--border`,
padding, label "Commento").

## PDF

`pdf-generator.ts`: in `analysesHtml`, dopo `.analysis-body`, per ogni
`a.comments` rende un box commento (sfondo chiaro) + la risposta
(`marked.parse`). Stile inline coerente col tema chiaro del PDF.

## Verifica (self-check)

Un piccolo script/test `assert`-based che copre la logica non banale:
- roundtrip append → serialize → parse di `comments_json` (l'ordine e i campi si
  conservano);
- `buildCommentPrompt` include il testo del commento e NON è un Template v3
  completo (assenza di intestazioni `[1]..[5]`).

## Fuori scope (YAGNI)

- Streaming token-by-token dell'integrazione.
- Eliminazione/modifica del singolo commento.
- Commento ancorato a una sezione/proposta specifica (il commento è sull'intera
  analisi).
