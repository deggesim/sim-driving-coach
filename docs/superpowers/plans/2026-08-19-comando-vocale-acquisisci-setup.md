# Comando vocale "Acquisisci setup" — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quattro trigger vocali equivalenti ("acquisisci / carica / preleva / nuovo setup") acquisiscono un setup nel gioco della sessione aperta — clipboard per R3E, ultimo `.carsetup` per ACE, 3 screenshot più recenti via Claude Vision per AMS2 — chiedendo il nome a voce dove serve.

**Architecture:** Un nuovo intent `acquireSetup` in `voice-intent.ts` viene dispatchato in `coach:voiceQuery` verso un acquirer per gioco; i tre acquirer divergono solo nel procurarsi un `SetupData` e convergono su un unico `insertSetup()`, che è la INSERT già esistente estratta dall'handler `session:loadSetup` (quindi il push `session:setupLoaded` aggiorna la UI senza codice nuovo). Il nome viene chiesto riusando il meccanismo `listenAgain` della domanda "Quale gioco?": uno stato `pendingSetup` con TTL consuma il transcript successivo come nome invece di riclassificarlo.

**Tech Stack:** TypeScript strict, Electron main process (`clipboard` da `electron`, `fs`/`path` sincroni), `better-sqlite3`, Anthropic SDK (`claude-sonnet-5` per Vision), selfcheck assert-based via `npm run selfcheck`.

**Spec:** `docs/superpowers/specs/2026-08-19-comando-vocale-acquisisci-setup-design.md`

## Global Constraints

- **TypeScript strict mode.** `type` e non `interface`. Named exports, import relativi, nessun path alias.
- **Solo arrow function.** Le keyword `function` e `class` sono vietate — un hook `PostToolUse` (`.claude/scripts/style-check.mjs`) le segnala a ogni Write/Edit.
- **Import con estensione `.js` da `src/main/`** (`../../shared/types.js`), **senza estensione da `src/renderer/`** (`../../shared/types`). I due lati compilano con moduleResolution diversi.
- **Nessun `process.env` in `src/renderer/`.** Main e preload sono Node e lo usano liberamente.
- **Testo utente in italiano**, tono ingegnere di pista, dato numerico sempre presente dove esiste.
- **ES2024+**: `toSorted`, `Object.groupBy`, `at()`, `structuredClone` sono disponibili e preferiti.
- **Prettier è cablato**: `npm run format` a fine task, mai allineare lo stile a mano.
- **Messaggi vocali, verbatim dalla specifica** (non riformularli, non aggiungere punteggiatura):
  - `"Nessun setup presente nella clipboard."`
  - `"Setup non presente per la combinazione auto tracciato, o errore nella decodifica."`
  - `"Nessuno screenshot da acquisire o errore nella scansione."`
  - `"Setup salvato con nome <nome>."`
  - `"Non c'è nessuna sessione aperta."`
  - `"API Key Anthropic non configurata."`
  - `"Come vuoi chiamare il setup?"`
  - `"Acquisizione annullata."`
- **Nessuna modifica allo schema DB.** `session_setups_*` ha già tutte le colonne necessarie.
- **Commit dopo ogni task**, messaggio Conventional Commits in italiano.

---

### Task 1: `shared/r3e-setup-parse.ts` — il parsing JSON R3E esce dal componente React

Il parsing vive dentro `R3eSetupPicker.tsx`, quindi il main process non può leggere la clipboard. Va in `shared/` perché avrà due consumatori su lati opposti dell'IPC (stesso criterio di `preprocessTTSText` in `shared/format.ts`).

**Files:**

- Create: `src/shared/r3e-setup-parse.ts`
- Create: `src/shared/r3e-setup-parse.selfcheck.ts`
- Modify: `src/renderer/components/R3eSetupPicker.tsx:15-96` (rimuove il blocco spostato), `:1-6` (import), `:106` (chiamata)

**Interfaces:**

- Consumes: `SetupParam` da `src/shared/types.ts` (già esistente).
- Produces:
  - `type R3ESetupItem = { id: string; currentStep: number; minValue: number; stepSize: number; suffix: string | string[]; disabled: boolean }`
  - `parseR3eSetupJson(text: string): SetupParam[]` — throw su testo non-JSON (`SyntaxError` da `JSON.parse`) e su JSON senza `values` (`Error("Formato JSON non valido: manca il campo 'values'")`). È il modo in cui i chiamanti distinguono un setup da qualunque altro testo.

- [ ] **Step 1: Scrivere il selfcheck (rosso)**

Crea `src/shared/r3e-setup-parse.selfcheck.ts`:

```ts
// Self-check: l'aritmetica del parsing R3E (minValue + currentStep * stepSize) e
// la formattazione per-categoria vivevano dentro un componente React senza alcun
// test. Ora hanno due chiamanti su lati opposti dell'IPC: un errore qui sbaglia
// silenziosamente ogni setup R3E, sia incollato a mano sia preso dalla clipboard.
import assert from "node:assert/strict";
import { parseR3eSetupJson } from "./r3e-setup-parse.js";

const item = (
  id: string,
  minValue: number,
  stepSize: number,
  currentStep: number,
  extra: { suffix?: string | string[]; disabled?: boolean } = {},
) => ({
  id,
  minValue,
  stepSize,
  currentStep,
  suffix: extra.suffix ?? "",
  disabled: extra.disabled ?? false,
});

const parse = (values: unknown[]) => parseR3eSetupJson(JSON.stringify({ values }));

// ── Brake bias: l'unico valore che diventa una coppia front/rear ──────────────
assert.deepEqual(parse([item("BrakeBias", 0.4, 0.01, 10)]), [
  { category: "Freni", parameter: "Brake Bias", value: "50.00/50.00%" },
]);

// ── Compound: indice → nome, non il numero ───────────────────────────────────
assert.equal(parse([item("TyreCompoundFront", 0, 1, 2)])[0].value, "Soft");
assert.equal(parse([item("TyreCompoundFront", 0, 1, 0)])[0].value, "Hard");

// ── Unità implicite per famiglia di parametro ────────────────────────────────
assert.equal(parse([item("SpringsFrontLeft", 100, 5, 2)])[0].value, "110 N/mm");
assert.equal(parse([item("TyrePressureFrontLeft", 150, 1, 15)])[0].value, "165 kPa");
assert.equal(parse([item("RideHeightRearRight", 5, 0.5, 4)])[0].value, "7 cm");
assert.equal(parse([item("FuelLoad", 0, 1, 42)])[0].value, "42 L");

// ── suffix: stringa o array, in quel caso vince il primo ────────────────────
assert.equal(
  parse([item("CamberFrontLeft", -4, 0.1, 5, { suffix: ["deg", "°"] })])[0].value,
  "-3.5 deg",
);

// ── Categorie e label: camelCase → parole, "Toein" → "Toe In" ───────────────
assert.deepEqual(parse([item("AntiRollBarFront", 1, 1, 4)])[0], {
  category: "ARB",
  parameter: "Anti Roll Bar Front",
  value: "5",
});
assert.deepEqual(parse([item("ToeinFrontLeft", -0.2, 0.05, 4)])[0], {
  category: "Geometria",
  parameter: "Toe In Front Left",
  value: "0",
});
assert.equal(parse([item("QualcosaDiIgnoto", 0, 1, 1)])[0].category, "Altro");

// ── Gli item disabilitati non entrano nel setup ─────────────────────────────
assert.deepEqual(
  parse([item("BrakeBias", 0.4, 0.01, 10, { disabled: true })]),
  [],
);

// ── Testo che non è un setup: throw, non un array vuoto. È così che main.ts
//    distingue una clipboard con un setup da una clipboard con qualsiasi cosa.
assert.throws(() => parseR3eSetupJson("ciao come stai"));
assert.throws(() => parseR3eSetupJson('{"action":"setCarSetupValues"}'), /values/);
assert.throws(() => parseR3eSetupJson(""), /.*/);

console.log("r3e-setup-parse selfcheck OK");
```

- [ ] **Step 2: Eseguirlo e verificare che fallisca**

Run: `npm run selfcheck`
Expected: FAIL — `tsc` esce non-zero con `TS2307: Cannot find module './r3e-setup-parse.js'`.

- [ ] **Step 3: Creare `src/shared/r3e-setup-parse.ts`**

Sposta il blocco `R3eSetupPicker.tsx:15-96` **senza modificarne la logica**: `R3ESetupItem`, `categorize`, `idToLabel`, `TYRE_COMPOUNDS`, `formatValue`, e `parseR3EJson` rinominata `parseR3eSetupJson`. Esporta il tipo e la funzione, lascia gli helper interni al modulo.

```ts
/**
 * Parsing del JSON che RaceRoom mette in clipboard con CTRL+C nella schermata
 * setup. In shared/ e non nel componente perché ha due chiamanti su lati opposti
 * dell'IPC: R3eSetupPicker (JSON incollato a mano) e main.ts (clipboard letta dal
 * comando vocale "acquisisci setup"). Puro: nessun React, nessun IPC, così
 * `r3e-setup-parse.selfcheck.ts` può asserirlo.
 */

import type { SetupParam } from "./types.js";

export type R3ESetupItem = {
  id: string;
  currentStep: number;
  minValue: number;
  stepSize: number;
  suffix: string | string[];
  disabled: boolean;
};

// ...categorize / idToLabel / TYRE_COMPOUNDS / formatValue invariati...

export const parseR3eSetupJson = (text: string): SetupParam[] => {
  const parsed = JSON.parse(text) as { values?: R3ESetupItem[] };
  if (!parsed.values || !Array.isArray(parsed.values)) {
    throw new Error("Formato JSON non valido: manca il campo 'values'");
  }
  return parsed.values
    .filter((item) => !item.disabled)
    .map((item) => ({
      category: categorize(item.id),
      parameter: idToLabel(item.id),
      value: formatValue(item),
    }));
};
```

Attenzione all'import: da `src/shared/` verso `src/shared/types.ts` l'estensione `.js` è obbligatoria (il modulo viene compilato anche da `tsconfig.selfcheck.json` con `moduleResolution: NodeNext`). Il renderer lo importerà comunque senza estensione perché è Vite a risolverlo.

- [ ] **Step 4: Eseguire il selfcheck e verificare che passi**

Run: `npm run selfcheck`
Expected: PASS — `r3e-setup-parse selfcheck OK` e il conteggio dei selfcheck sale di uno.

Se una asserzione fallisce, **non toccare l'implementazione**: è codice invariato che finora funzionava in produzione, quindi l'errore è nell'asserzione appena scritta. Ricalcola a mano `minValue + currentStep * stepSize` e correggi il valore atteso.

- [ ] **Step 5: Ripulire `R3eSetupPicker.tsx`**

Cancella le righe 15-96 (tipo + quattro helper + `parseR3EJson`), aggiungi l'import e aggiorna l'unica chiamata:

```tsx
import { parseR3eSetupJson } from "../../shared/r3e-setup-parse";
// ...
setParams(parseR3eSetupJson(jsonText));
```

`SetupParam` resta importato (serve allo `useState`), `SetupData` pure. Se `SetupParam` risultasse non più usato, ESLint lo segnalerebbe: in quel caso togli solo quello dall'import, non l'intera riga.

- [ ] **Step 6: Verificare che nulla si sia rotto**

Run: `npm run typecheck && npm run lint && npm run format`
Expected: nessun errore. `npm run format` può riformattare i due file: è previsto.

- [ ] **Step 7: Commit**

```bash
git add src/shared/r3e-setup-parse.ts src/shared/r3e-setup-parse.selfcheck.ts src/renderer/components/R3eSetupPicker.tsx
git commit -F <file temporaneo>
```

Messaggio:

```
refactor(setup): parsing del JSON R3E in shared/ con selfcheck

Il parsing viveva dentro R3eSetupPicker.tsx, quindi il main process non poteva
usarlo: serve al comando vocale "acquisisci setup", che legge il JSON dalla
clipboard. Codice spostato invariato (parseR3EJson -> parseR3eSetupJson) e messo
sotto selfcheck: l'aritmetica minValue + currentStep * stepSize e la
formattazione per famiglia di parametro non avevano alcun test.
```

---

### Task 2: `ams2/ams2-setup-vision.ts` — la decodifica Vision esce da `main.ts`

Tre chiusure dentro `main.ts` (~200 righe totali fra risoluzione cartella, scansione e chiamata Vision) diventano un modulo. Il percorso vocale AMS2 ha bisogno delle stesse tre cose, e duplicare il system prompt Vision significherebbe farne divergere due copie.

**Files:**

- Create: `src/main/ams2/ams2-setup-vision.ts`
- Modify: `src/main/main.ts:2129-2151` (rimuove `AMS2_STEAM_APPID`, `SETUP_VISION_MODEL`, `getAms2ScreenshotsDir`), `:2153-2222` (`setup:listScreenshots` delega), `:2224-2336` (`setup:decodeSetup` delega), `:41-91` (import)

**Interfaces:**

- Consumes: `SetupData` da `src/shared/types.ts`.
- Produces:
  - `resolveAms2ScreenshotsDir(): string | null` — cartella screenshot Steam di AMS2 (appid `1066890`), `null` se non trovabile.
  - `listAms2Screenshots(dir: string): Array<{ name: string; mtimeMs: number }>` — jpg/jpeg/png, **ordinati per `mtimeMs` decrescente**, `[]` se la cartella non è leggibile.
  - `decodeAms2Setup(params: { screenshotsDir: string; filenames: string[]; expectedCar: string; apiKey: string }): Promise<SetupData>`

- [ ] **Step 1: Creare il modulo**

Crea `src/main/ams2/ams2-setup-vision.ts` spostando il codice **invariato** da `main.ts`. La sola modifica di comportamento è l'ordinamento di `listAms2Screenshots` (mtime desc invece di nome desc) e il fatto che non produce più thumbnail.

```ts
/**
 * Decodifica dei setup AMS2 dalle schermate: AMS2 è l'unico gioco il cui import
 * setup passa da Claude Vision (R3E incolla JSON, ACE decodifica un protobuf).
 * Estratto da main.ts perché ha due chiamanti — l'handler setup:decodeSetup per
 * la UI e il comando vocale "acquisisci setup" — e il system prompt non va
 * duplicato: due copie divergono alla prima correzione di OCR.
 */

import fs from "fs";
import path from "path";
import type { SetupData } from "../../shared/types.js";

const AMS2_STEAM_APPID = "1066890";
const VISION_MODEL = "claude-sonnet-5";
const STEAM_USERDATA = "C:\\Program Files (x86)\\Steam\\userdata";

/** Auto-detect del singolo account Steam → cartella screenshot di AMS2. */
export const resolveAms2ScreenshotsDir = (): string | null => {
  try {
    const accounts = fs
      .readdirSync(STEAM_USERDATA)
      .filter((d) => /^\d+$/.test(d));
    if (accounts.length === 0) return null;
    return path.join(
      STEAM_USERDATA,
      accounts[0],
      "760",
      "remote",
      AMS2_STEAM_APPID,
      "screenshots",
    );
  } catch {
    return null;
  }
};

/**
 * Nome + mtime, ordinati dal più recente. Niente thumbnail: il chiamante vocale
 * vuole tre nomi, non cinquanta immagini in base64. Ordinato per mtime e non per
 * nome perché "cronologico" e "alfabetico" coincidono solo finché Steam tiene i
 * nomi timestampati.
 */
export const listAms2Screenshots = (
  dir: string,
): Array<{ name: string; mtimeMs: number }> => {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
      .map((name) => ({
        name,
        mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs,
      }))
      .toSorted((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
};

export const decodeAms2Setup = async ({
  screenshotsDir,
  filenames,
  expectedCar,
  apiKey,
}: {
  screenshotsDir: string;
  filenames: string[];
  expectedCar: string;
  apiKey: string;
}): Promise<SetupData> => {
  // ...corpo invariato da main.ts:2224-2336, con `screenshotsDir` al posto
  // della await getAms2ScreenshotsDir() e `VISION_MODEL` al posto di
  // SETUP_VISION_MODEL. Il system prompt italiano va copiato carattere per
  // carattere: le categorie che elenca sono le stesse che ams2-setup-sections.ts
  // usa per raggruppare le tab della UI.
};
```

Il corpo di `decodeAms2Setup` conserva tutto quello che c'è oggi, in particolare:

- il controllo `path.basename(name) !== name` su ogni filename (un componente di path uscirebbe dalla cartella screenshot — è una validazione al confine di fiducia, non una rifinitura);
- la ricerca esplicita del blocco `text` in `response.content` (sonnet-5 può emettere un blocco thinking prima);
- il match `/\{[\s\S]*\}/` e il `JSON.parse` guardato, con i due messaggi d'errore già scritti;
- `thinking: { type: "disabled" }` e `max_tokens: 4000`.

Gli `import` dinamici (`await import("fs")`, `await import("@anthropic-ai/sdk")`) diventano statici per `fs`/`path` e restano dinamici per l'SDK Anthropic, come oggi.

- [ ] **Step 2: Far delegare i due handler**

In `main.ts`, `setup:listScreenshots` conserva le annotazioni `alreadyUsed` e i thumbnail, ma prende l'elenco dal modulo:

```ts
ipcMain.handle("setup:listScreenshots", () => {
  const screenshotsDir = resolveAms2ScreenshotsDir();
  if (!screenshotsDir) return [];
  const thumbnailsDir = path.join(screenshotsDir, "thumbnails");
  const usedMap = /* ...blocco invariato... */;
  return listAms2Screenshots(screenshotsDir).map(({ name }) => {
    const thumbPath = path.join(thumbnailsDir, name);
    const fullPath = path.join(screenshotsDir, name);
    const src = fs.existsSync(thumbPath) ? thumbPath : fullPath;
    const thumbnailB64 = fs.readFileSync(src).toString("base64");
    const alreadyUsed = usedMap.get(name);
    return { name, thumbnailB64, ...(alreadyUsed ? { alreadyUsed } : {}) };
  });
});
```

`setup:decodeSetup` diventa un guscio: risolve la cartella, prende la API key, delega.

```ts
ipcMain.handle(
  "setup:decodeSetup",
  async (
    _event,
    { filenames, expectedCar }: { filenames: string[]; expectedCar: string },
  ) => {
    const screenshotsDir = resolveAms2ScreenshotsDir();
    if (!screenshotsDir) throw new Error("Cartella screenshot AMS2 non trovata");
    const apiKey = getAnthropicApiKey();
    if (!apiKey) throw new Error("Anthropic API Key non configurata");
    return decodeAms2Setup({ screenshotsDir, filenames, expectedCar, apiKey });
  },
);
```

Nota: `setup:listScreenshots` non è più `async` (non ha più `await import`). L'IPC non se ne accorge — `ipcMain.handle` avvolge comunque il ritorno in una promise — e il tipo in `ElectronAPI` resta `Promise<...>`.

- [ ] **Step 3: Verificare la compilazione**

Run: `npm run typecheck && npm run lint`
Expected: nessun errore. Se `lint` segnala `fs`/`path` non usati in `main.ts`, sono ancora usati altrove (gzip dei frame, PDF): non toccare l'import.

- [ ] **Step 4: Verifica manuale della UI AMS2 (invariata)**

Run: `npm run dev`, apri una sessione AMS2, apri il picker setup.
Expected: la griglia degli screenshot si popola come prima, con le annotazioni "già usato". L'ordine ora è per data di modifica invece che per nome: sui nomi timestampati di Steam le due sequenze coincidono, quindi visivamente non deve cambiare nulla.

Se non hai AMS2 a disposizione, salta la verifica e dichiarala esplicitamente saltata nel report del task — non affermare che la UI funziona.

- [ ] **Step 5: Commit**

```
refactor(ams2): decodifica Vision dei setup in un modulo dedicato

resolveAms2ScreenshotsDir, listAms2Screenshots e decodeAms2Setup escono dalle
chiusure di main.ts: il comando vocale "acquisisci setup" ha bisogno delle stesse
tre cose e il system prompt Vision non va duplicato. listAms2Screenshots ordina
per mtime decrescente (prima: nome) e non produce thumbnail; l'handler
setup:listScreenshots continua a costruirli sopra il suo elenco.
```

---

### Task 3: `voice-intent.ts` — l'intent `acquireSetup` e i quattro trigger

**Files:**

- Modify: `src/main/coach/voice-intent.ts:8-14` (union), `:121-139` (`classifyCommand`)
- Modify: `src/main/coach/voice-intent.selfcheck.ts` (in coda, prima del `console.log` finale se presente)

**Interfaces:**

- Produces: la variante `{ kind: "acquireSetup" }` in `VoiceIntent`. Il Task 5 la consuma in `coach:voiceQuery`. **Non porta il gioco**: il gioco è quello della sessione aperta.

- [ ] **Step 1: Scrivere le asserzioni (rosso)**

Aggiungi in coda a `src/main/coach/voice-intent.selfcheck.ts`:

```ts
// ── acquireSetup: quattro trigger equivalenti ────────────────────────────────
// Sono quattro modi di attivare la stessa funzionalità, non quattro varianti:
// se uno solo di questi smette di combaciare, il comando sparisce senza errori.
for (const phrase of [
  "acquisisci setup",
  "carica setup",
  "preleva setup",
  "nuovo setup",
]) {
  assert.deepEqual(
    classifyVoiceIntent(phrase, NAME),
    { kind: "acquireSetup" },
    `trigger non riconosciuto: ${phrase}`,
  );
}

// Con il richiamo per nome davanti, con l'articolo, e coniugati come capita
// parlando: la frase pronunciata non è mai quella della specifica.
assert.deepEqual(classifyVoiceIntent("Ciao Robert, acquisisci il setup", NAME), {
  kind: "acquireSetup",
});
assert.deepEqual(classifyVoiceIntent("caricami il setup nuovo", NAME), {
  kind: "acquireSetup",
});
assert.deepEqual(classifyVoiceIntent("puoi prelevare il setup?", NAME), {
  kind: "acquireSetup",
});
// Azure STT scrive il prestito inglese anche staccato, imprevedibilmente.
assert.deepEqual(classifyVoiceIntent("acquisisci il set up", NAME), {
  kind: "acquireSetup",
});

// ── Nessuna collisione con gli intent già esistenti ──────────────────────────
// "nuova sessione" contiene un verbo di acquisizione ma non è un setup.
assert.equal(classifyVoiceIntent("apri una nuova sessione", NAME).kind, "newSession");
// I rami di sessione vengono prima: una frase che nomina entrambi apre la sessione.
assert.equal(
  classifyVoiceIntent("nuova sessione e carica il setup", NAME).kind,
  "newSession",
);
// "valuta il nuovo setup" è una richiesta di analisi, non di acquisizione:
// il ramo analyze precede acquireSetup proprio per questo.
assert.equal(classifyVoiceIntent("valuta il nuovo setup", NAME).kind, "analyze");
// Una domanda sul setup resta una domanda.
assert.equal(classifyVoiceIntent("com'è il setup adesso?", NAME).kind, "freeform");
assert.equal(
  classifyVoiceIntent("quanto pesa il setup sul sottosterzo?", NAME).kind,
  "freeform",
);
```

- [ ] **Step 2: Eseguirlo e verificare che fallisca**

Run: `npm run selfcheck`
Expected: FAIL — la prima asserzione del ciclo rompe con `trigger non riconosciuto: acquisisci setup`, perché `classifyVoiceIntent` restituisce `{ kind: "freeform", question: "acquisisci setup" }`.

- [ ] **Step 3: Aggiungere la variante alla union**

In `src/main/coach/voice-intent.ts`, dopo `| { kind: "analyze" }`:

```ts
  | { kind: "acquireSetup" }
```

- [ ] **Step 4: Aggiungere il ramo a `classifyCommand`**

**Dopo** il ramo `analyze` e prima del `return null` finale:

```ts
  // Quattro trigger equivalenti dalla specifica ("acquisisci/carica/preleva/nuovo
  // setup"), più le coniugazioni che capitano parlando. `set ?up` perché Azure STT
  // scrive il prestito inglese attaccato o staccato senza una regola.
  // Ultimo dei rami di comando di proposito: "valuta il nuovo setup" nomina un
  // setup ma chiede un'analisi, e "nuova sessione" non è un setup affatto.
  if (
    /\bset ?up\b/.test(s) &&
    /\b(acquisisci|acquisire|acquisisce|carica|caricare|caricami|preleva|prelevare|nuovo|nuova)\b/.test(
      s,
    )
  )
    return { kind: "acquireSetup" };
```

- [ ] **Step 5: Eseguire il selfcheck e verificare che passi**

Run: `npm run selfcheck`
Expected: PASS su tutti i selfcheck, incluso `voice-intent`.

- [ ] **Step 6: Verificare che il consumatore compili ancora**

Run: `npm run typecheck`
Expected: **un errore atteso** se `coach:voiceQuery` fa un match esaustivo sulla union. Oggi il dispatcher usa `if` a catena con un fallback freeform, quindi lo `switch` esaustivo non c'è e il typecheck passa pulito. Se invece compare un errore di esaustività, **non silenziarlo con un `default`**: è il Task 5 a chiudere il ramo, e fino ad allora l'errore è informazione corretta. In quel caso committa comunque questo task (il selfcheck è verde) e annota che il typecheck si chiude nel Task 5.

- [ ] **Step 7: Commit**

```
feat(voice): intent acquireSetup con i quattro trigger vocali

"acquisisci setup", "carica setup", "preleva setup" e "nuovo setup" (piu' le
coniugazioni spontanee e la forma "set up" staccata che Azure STT produce)
classificano un nuovo intent. Il ramo e' l'ultimo dei comandi: "nuova sessione"
resta newSession e "valuta il nuovo setup" resta analyze, entrambi asseriti.
```

---

### Task 4: `main.ts` — estrarre `insertSetup()` e `listAceSetupFiles()`

Due estrazioni, nessun comportamento nuovo. Servono al Task 5 e valgono da sole: la INSERT del setup è oggi raggiungibile solo via IPC, e la lettura della cartella ACE solo via IPC.

**Files:**

- Modify: `src/main/main.ts:1195-1252` (`session:loadSetup` → `insertSetup` + wrapper), `:2055-2075` (`ace:listSetupFiles` → `listAceSetupFiles` + wrapper)

**Interfaces:**

- Produces:
  - `insertSetup(params: { setup: SetupData; sessionId: number; game: GameSource; activate?: boolean }): number` — INSERT in `session_setups_<game>`, avanza `currentSetupId` se `sessionId === currentSessionId` e `activate !== false`, pusha `session:setupLoaded`, ritorna il `setupId`.
  - `listAceSetupFiles(car: string, track: string): AceSetupFileInfo[]` — contenuto di `{aceSetupsBase}\{car}\{track}`, `[]` su cartella illeggibile. **Ordine invariato rispetto a oggi** (nome decrescente): è la UI a dipenderne.

- [ ] **Step 1: Estrarre `insertSetup`**

Definiscila **prima** di `ipcMain.handle("session:loadSetup", ...)`, nello stesso scope (le serve `db`, `t`, `currentSessionId`, `currentSetupId`, `pushToRenderer`). Il corpo è quello di oggi, con `targetId`/`targetGame` già risolti dal chiamante:

```ts
/**
 * Unico punto di scrittura di un setup di sessione: l'handler session:loadSetup e
 * il comando vocale "acquisisci setup" passano entrambi da qui, così il push
 * session:setupLoaded (che aggiorna la UI) non ha una seconda copia da tenere in
 * sincronia.
 */
const insertSetup = ({
  setup,
  sessionId,
  game,
  activate,
}: {
  setup: SetupData;
  sessionId: number;
  game: GameSource;
  activate?: boolean;
}): number => {
  const loadedAt = new Date().toISOString();
  const screenshots =
    game === "ace" ? null : JSON.stringify(setup.screenshots ?? []);
  const result = db
    .prepare(
      `INSERT INTO ${t("session_setups", game)} (session_id, loaded_at, setup_json, setup_screenshots)
       VALUES (?, ?, ?, ?)`,
    )
    .run(sessionId, loadedAt, JSON.stringify(setup), screenshots);
  const setupId = Number(result.lastInsertRowid);
  // Only advance currentSetupId when loading into the current live session, and
  // only when the caller wants this setup active (activate: false is used to
  // re-tag old laps without hijacking the setup the next laps will use).
  if (sessionId === currentSessionId && activate !== false)
    currentSetupId = setupId;
  const row: SessionSetupRow = {
    id: setupId,
    session_id: sessionId,
    loaded_at: loadedAt,
    setup,
    setup_screenshots: screenshots,
  };
  pushToRenderer("session:setupLoaded", {
    sessionId,
    game,
    setup: row,
    activate,
  });
  return setupId;
};
```

Nota su un dettaglio che l'originale sbagliava di poco: `loaded_at` veniva calcolato **due volte** con due `new Date().toISOString()` distinti (uno per la INSERT, uno per la riga pushata al renderer), quindi la riga in UI poteva avere un millisecondo diverso da quella su disco. Qui è un solo `loadedAt`. È una correzione, non una regressione: mantienila.

- [ ] **Step 2: Ridurre l'handler a un wrapper**

```ts
ipcMain.handle(
  "session:loadSetup",
  (
    _event,
    {
      setup,
      sessionId: sid,
      game: g,
      activate,
    }: {
      setup: SetupData;
      sessionId?: number;
      game?: GameSource;
      activate?: boolean;
    },
  ) => {
    const targetId = sid ?? currentSessionId;
    if (!targetId) {
      throw new Error(
        "Nessuna sessione attiva. Apri una sessione prima di caricare un setup.",
      );
    }
    return {
      setupId: insertSetup({
        setup,
        sessionId: targetId,
        game: g ?? currentSessionGame,
        activate,
      }),
    };
  },
);
```

- [ ] **Step 3: Estrarre `listAceSetupFiles`**

Subito dopo `getAceSetupsBase`, e l'handler la delega:

```ts
/** Contenuto di {base}\{car}\{track}, ordinato per nome decrescente come si
 *  aspetta AceSetupPicker. Il comando vocale riordina per modifiedAt. */
const listAceSetupFiles = (car: string, track: string): AceSetupFileInfo[] => {
  const dir = path.join(getAceSetupsBase(), car, track);
  try {
    return fs
      .readdirSync(dir)
      .filter((f: string) => f.endsWith(".carsetup"))
      .sort()
      .reverse()
      .map((filename: string): AceSetupFileInfo => {
        const filePath = path.join(dir, filename);
        return {
          filename,
          filePath,
          modifiedAt: fs.statSync(filePath).mtime.toISOString(),
        };
      });
  } catch {
    return [];
  }
};

ipcMain.handle(
  "ace:listSetupFiles",
  (_event, { car, track }: { car: string; track: string }) =>
    listAceSetupFiles(car, track),
);
```

- [ ] **Step 4: Verificare**

Run: `npm run typecheck && npm run lint && npm run selfcheck`
Expected: nessun errore, selfcheck verdi.

- [ ] **Step 5: Verifica manuale (comportamento invariato)**

Run: `npm run dev`, apri una sessione, carica un setup dalla UI del gioco che hai a disposizione.
Expected: il setup appare nel pannello sessione come prima e il contatore "Gestione setup (N)" si incrementa. Se non puoi provarlo, dichiaralo saltato.

- [ ] **Step 6: Commit**

```
refactor(setup): insertSetup e listAceSetupFiles estratti dagli handler IPC

Entrambi erano raggiungibili solo via IPC e servono al comando vocale
"acquisisci setup": la INSERT in session_setups_* con il push
session:setupLoaded, e la lettura della cartella dei .carsetup ACE.
Comportamento invariato, tranne loaded_at che ora e' un solo timestamp invece di
due new Date() distinti fra la riga su disco e quella pushata al renderer.
```

---

### Task 5: `main.ts` — `acquireSetupByVoice()` e la domanda sul nome

Il cuore della feature. Nessun selfcheck possibile: ogni ramo tocca clipboard, filesystem o rete. La verifica è il typecheck più tre prove manuali.

**Files:**

- Modify: `src/main/main.ts:11` (import `clipboard`), `:41-91` (import dei tre moduli), `:411-416` (stato pending), `:1921-1950` (blocco pending in testa a `coach:voiceQuery`), `:1960-1985` (dispatch dell'intent), e le nuove funzioni prima dell'handler

**Interfaces:**

- Consumes: `parseR3eSetupJson` (Task 1), `resolveAms2ScreenshotsDir` / `listAms2Screenshots` / `decodeAms2Setup` (Task 2), `{ kind: "acquireSetup" }` (Task 3), `insertSetup` / `listAceSetupFiles` (Task 4), più il preesistente `decodeCarSetup` da `ace/ace-setup-reader.js`, `speakText`, `resolveNames`, `getAnthropicApiKey`, `currentSessionId` / `currentSessionGame` / `currentCar` / `currentTrack`.
- Produces: nulla per i task successivi.

- [ ] **Step 1: Import e stato**

`clipboard` va aggiunto all'import di `electron` (riga 11):

```ts
import { app, BrowserWindow, clipboard, ipcMain, shell } from "electron";
```

Aggiungi gli import dei moduli dei Task 1 e 2 (estensione `.js`, è main process):

```ts
import { parseR3eSetupJson } from "../shared/r3e-setup-parse.js";
import {
  decodeAms2Setup,
  listAms2Screenshots,
  resolveAms2ScreenshotsDir,
} from "./ams2/ams2-setup-vision.js";
```

Rinomina la costante del TTL e aggiungi lo stato del setup in attesa di nome, accanto a `pendingGame` (righe 411-416):

```ts
  let pendingGame = false;
  let pendingGameAt = 0;
  /** Setup acquisito in attesa che il pilota ne pronunci il nome. */
  let pendingSetup: SetupData | null = null;
  let pendingSetupAt = 0;
  // Una risposta che non arriva entro il TTL va trattata come assente, invece di
  // divorare un comando successivo e slegato. Vale per entrambe le attese: il
  // nome vecchio (PENDING_GAME_TTL_MS), applicato all'attesa del nome di un
  // setup, mentirebbe.
  const PENDING_ANSWER_TTL_MS = 60_000;
```

Aggiorna l'unico uso esistente (`main.ts:1927`, condizione del blocco `pendingGame`) da `PENDING_GAME_TTL_MS` a `PENDING_ANSWER_TTL_MS`. Verifica con `grep -n PENDING_GAME_TTL_MS src/main/main.ts` che non ne resti nessuno.

- [ ] **Step 2: I tre acquirer + salvataggio + conferma**

Definiscili prima di `ipcMain.handle("coach:voiceQuery", ...)`, dopo `openSessionByVoice` (che è il vicino logico e usa gli stessi helper):

```ts
/** Messaggio d'errore per gioco, verbatim dalla specifica: per chi guida
 *  "clipboard vuota" e "JSON malformato" sono lo stesso problema, quindi ogni
 *  acquirer collassa qualunque fallimento in una sola frase. */
const ACQUIRE_ERROR: Record<GameSource, string> = {
  r3e: "Nessun setup presente nella clipboard.",
  ace: "Setup non presente per la combinazione auto tracciato, o errore nella decodifica.",
  ams2: "Nessuno screenshot da acquisire o errore nella scansione.",
};

/** Parole con cui il pilota rinuncia invece di dettare un nome. Senza questa
 *  via d'uscita uno STT confuso persiste una riga session_setups_* con un nome
 *  spazzatura, cancellabile solo dalla UI. */
const CANCEL_WORDS = /^(annulla|annullo|lascia stare|lascia perdere|niente|no)$/i;

/** Nome dell'auto della sessione, risolto: per R3E currentCar è un id numerico. */
const sessionCarName = (): string =>
  resolveNames(currentSessionGame, currentCar, currentTrack, currentLayout)
    .carName || currentCar;

/** R3E: il JSON che RaceRoom mette in clipboard con CTRL+C. parseR3eSetupJson
 *  fa throw su qualunque testo che non sia un setup, ed è il controllo. */
const acquireR3eSetup = (): SetupData => {
  const params = parseR3eSetupJson(clipboard.readText());
  if (params.length === 0) throw new Error("setup senza parametri attivi");
  return {
    carVerified: true,
    carFound: sessionCarName(),
    setupText: "",
    params,
    screenshots: [],
  };
};

/** ACE: l'ultimo .carsetup per la combinazione auto/tracciato della sessione.
 *  modifiedAt è ISO, quindi l'ordine lessicografico è già quello cronologico. */
const acquireAceSetup = (): SetupData => {
  const newest = listAceSetupFiles(currentCar, currentTrack).toSorted((a, b) =>
    b.modifiedAt.localeCompare(a.modifiedAt),
  )[0];
  if (!newest) throw new Error("nessun .carsetup per la combinazione");
  const setup = decodeCarSetup(fs.readFileSync(newest.filePath), currentCar);
  return { ...setup, name: newest.filename.replace(/\.carsetup$/i, "") };
};

/** AMS2: i 3 screenshot più recenti → Claude Vision. */
const acquireAms2Setup = async (): Promise<SetupData> => {
  const screenshotsDir = resolveAms2ScreenshotsDir();
  if (!screenshotsDir) throw new Error("cartella screenshot non trovata");
  const filenames = listAms2Screenshots(screenshotsDir)
    .slice(0, 3)
    .map((s) => s.name);
  if (filenames.length === 0) throw new Error("nessuno screenshot");
  const apiKey = getAnthropicApiKey();
  if (!apiKey) throw new Error("API key assente");
  return decodeAms2Setup({
    screenshotsDir,
    filenames,
    expectedCar: sessionCarName(),
    apiKey,
  });
};

/** Scrive il setup e lo annuncia. Ricontrolla la sessione perché fra la domanda
 *  sul nome e la risposta il pilota può averla chiusa. */
const saveAcquiredSetup = async (setup: SetupData): Promise<void> => {
  const sessionId = currentSessionId;
  if (!sessionId) {
    await speakText("Non c'è nessuna sessione aperta.");
    return;
  }
  insertSetup({
    setup,
    sessionId,
    game: currentSessionGame,
    activate: true,
  });
  // carVerified arriva da Claude Vision solo per AMS2: quando l'auto sulle
  // schermate non è quella della sessione il dato esiste già, tacerlo sarebbe
  // peggio che dirlo.
  const warn = setup.carVerified
    ? ""
    : ` Attenzione, l'auto rilevata è ${setup.carFound}.`;
  await speakText(`Setup salvato con nome ${setup.name}.${warn}`);
};

const acquireSetupByVoice = async (): Promise<void> => {
  if (!currentSessionId) {
    await speakText("Non c'è nessuna sessione aperta.");
    return;
  }
  const game = currentSessionGame;
  if (game === "ams2" && !getAnthropicApiKey()) {
    await speakText("API Key Anthropic non configurata.");
    return;
  }
  let setup: SetupData;
  try {
    setup =
      game === "r3e"
        ? acquireR3eSetup()
        : game === "ace"
          ? acquireAceSetup()
          : await acquireAms2Setup();
  } catch (err) {
    console.error("[VoiceCoach] Setup acquisition failed:", err);
    await speakText(ACQUIRE_ERROR[game]);
    return;
  }
  // ACE porta già il nome del file: niente da chiedere.
  if (setup.name) {
    await saveAcquiredSetup(setup);
    return;
  }
  pendingSetup = setup;
  pendingSetupAt = Date.now();
  await speakText("Come vuoi chiamare il setup?", { listenAgain: true });
};
```

- [ ] **Step 3: Consumare il nome in testa a `coach:voiceQuery`**

Subito dopo il blocco `pendingGame` esistente (che finisce con `pendingGame = false;`), e **prima** di `classifyVoiceIntent`:

```ts
    // Un "come vuoi chiamare il setup?" pendente ingoia la trascrizione
    // successiva: è un nome, non un comando.
    if (pendingSetup && Date.now() - pendingSetupAt < PENDING_ANSWER_TTL_MS) {
      const setup = pendingSetup;
      pendingSetup = null;
      const name = question.trim().replace(/[.!?]+$/, "");
      if (!name || CANCEL_WORDS.test(name)) {
        await speakText("Acquisizione annullata.");
        return;
      }
      await saveAcquiredSetup({ ...setup, name });
      return;
    }
    pendingSetup = null;
```

Il `replace` finale toglie il punto che Azure STT appende a una frase isolata: senza di esso il setup si chiamerebbe "Qualifica Monza.".

- [ ] **Step 4: Dispatchare l'intent**

Accanto agli altri rami (dopo `intent.kind === "closeSession"`, prima di `analyze` o dopo, indifferente):

```ts
    if (intent.kind === "acquireSetup") {
      await acquireSetupByVoice();
      return;
    }
```

- [ ] **Step 5: Verificare la compilazione**

Run: `npm run typecheck && npm run lint && npm run selfcheck`
Expected: nessun errore, tutti i selfcheck verdi. Un errore di esaustività della union residuo dal Task 3, se c'era, si chiude qui.

- [ ] **Step 6: Prova manuale R3E**

Run: `npm run dev` con RaceRoom avviato e in pista.

1. Apri una sessione R3E dalla UI.
2. In RaceRoom, schermata setup, CTRL+C.
3. Tieni premuto il tasto push-to-talk e di' "acquisisci setup".
4. Expected: il coach risponde "Come vuoi chiamare il setup?" e **riapre il microfono da sé** (nessun tasto da premere).
5. Di' "qualifica Monza".
6. Expected: "Setup salvato con nome qualifica Monza." e il setup appare nel pannello sessione senza ricaricare nulla.
7. Svuota la clipboard (copia una parola qualsiasi) e ripeti il comando.
8. Expected: "Nessun setup presente nella clipboard."

- [ ] **Step 7: Prova manuale ACE**

Con ACE avviato, sessione aperta, e almeno un `.carsetup` in `{aceSetupsPath}\{car}\{track}`:

1. "carica setup" → Expected: "Setup salvato con nome `<nome del file più recente>`." senza alcuna domanda.
2. Verifica che il file annunciato sia davvero quello con `mtime` più recente (`ls -lt` sulla cartella), non il primo in ordine alfabetico.
3. Apri una sessione su una combinazione auto/tracciato senza setup salvati e ripeti: Expected "Setup non presente per la combinazione auto tracciato, o errore nella decodifica."

- [ ] **Step 8: Prova manuale AMS2**

Con AMS2 avviato, sessione aperta, e almeno 3 screenshot del setup nella cartella Steam:

1. "preleva setup" → Expected: ~10-20 s di silenzio (Claude Vision), poi "Come vuoi chiamare il setup?".
2. Di' un nome → Expected: "Setup salvato con nome X." e il setup nel pannello.
3. Verifica in `SetupDetailModal` che i parametri provengano dalle **3 schermate più recenti**.
4. Ripeti dicendo "annulla" alla domanda sul nome → Expected: "Acquisizione annullata." e **nessuna** riga nuova nel pannello setup.

Ogni prova che non puoi eseguire va dichiarata saltata nel report, non data per riuscita.

- [ ] **Step 9: Commit**

```
feat(voice): comando vocale "acquisisci setup" per i tre giochi

R3E legge il JSON dalla clipboard, ACE decodifica l'ultimo .carsetup per la
combinazione auto/tracciato della sessione (per mtime, non per nome), AMS2 manda
i 3 screenshot piu' recenti a Claude Vision. Il nome viene chiesto a voce dove
non arriva dalla sorgente, riusando il listenAgain della domanda "Quale gioco?":
lo stato pendingSetup consuma la trascrizione successiva come nome, con lo stesso
TTL di 60s (PENDING_GAME_TTL_MS rinominata PENDING_ANSWER_TTL_MS, ora ne governa
due) e una via d'uscita per annullare, cosi' uno STT confuso non persiste una
riga con un nome spazzatura.
```

---

### Task 6: Documentazione e verifica finale

**Files:**

- Modify: `CLAUDE.md` (sezione "Key Design Decisions" — le tre voci "Setup loading", la voce "Voice queries", il diagramma dell'architettura)
- Modify: `src/main/CLAUDE.md` (`coach/voice-intent.ts`, `ams2/`, `main.ts`)
- Modify: `src/shared/CLAUDE.md` (nuovo `r3e-setup-parse.ts`)

**Interfaces:** nessuna.

- [ ] **Step 1: `CLAUDE.md` — le tre voci "Setup loading"**

A ognuna delle tre (`Setup loading R3E`, `ACE`, `AMS2`) aggiungi in coda la strada vocale, perché oggi affermano che l'import passa dal picker e diventerebbero false:

- R3E: «Il comando vocale "acquisisci setup" legge lo stesso JSON dalla clipboard via `parseR3eSetupJson` (`src/shared/r3e-setup-parse.ts`, condiviso con il picker) e chiede il nome a voce.»
- ACE: «Il comando vocale prende l'ultimo `.carsetup` della combinazione per `mtime` e usa il nome del file, senza chiedere nulla.»
- AMS2: «Il comando vocale manda i 3 screenshot più recenti allo stesso `decodeAms2Setup` e chiede il nome a voce.»

- [ ] **Step 2: `CLAUDE.md` — voce "Voice queries"**

Estendila con l'elenco dei comandi riconosciuti, `acquireSetup` incluso, e la nota che il gioco è quello della sessione aperta (l'intent non lo porta).

- [ ] **Step 3: `CLAUDE.md` — diagramma dell'architettura**

Nel blocco del flusso vocale, dopo `VoiceCoach streams Claude response`, aggiungi il ramo dell'acquisizione setup con le tre sorgenti, così il diagramma resta la mappa completa dei comandi.

- [ ] **Step 4: `src/main/CLAUDE.md`**

- `coach/voice-intent.ts`: aggiungi `acquireSetup` all'elenco degli intent, notando che è l'ultimo ramo di comando e perché.
- `ams2/`: nuova voce `ams2-setup-vision.ts` con le tre funzioni esportate e la nota sull'ordinamento per `mtime`.
- `main.ts`: menziona `insertSetup` come unico punto di scrittura dei setup e `pendingSetup`/`PENDING_ANSWER_TTL_MS` accanto a `pendingGame`.

- [ ] **Step 5: `src/shared/CLAUDE.md`**

Nuova voce `r3e-setup-parse.ts`: cosa fa, perché sta in `shared/` (due chiamanti su lati opposti dell'IPC), e che fa throw su testo che non è un setup — è il controllo che usa il percorso clipboard.

- [ ] **Step 6: Verifica finale completa**

Run: `npm run typecheck && npm run lint && npm run format:check && npm run selfcheck`
Expected: quattro comandi a zero. `format:check` deve passare **senza** riformattare: se fallisce, esegui `npm run format` e ricommitta.

- [ ] **Step 7: Rileggere il diff completo**

Run: `git diff master...HEAD --stat` e poi `git diff master...HEAD -- src/`
Cerca: `console.log` di debug rimasti, `mockHistoryMode` toccato per sbaglio, blocchi `catch {}` vuoti aggiunti, e ogni divergenza fra i messaggi vocali implementati e quelli della sezione "Global Constraints" di questo piano (carattere per carattere).

- [ ] **Step 8: Commit**

```
docs(voice): documenta il comando "acquisisci setup"

Le tre voci "Setup loading" di CLAUDE.md affermavano che l'import setup passa
solo dai picker della UI. Aggiornate con la strada vocale, insieme al diagramma
del flusso voce, ai nuovi moduli in src/main/CLAUDE.md e src/shared/CLAUDE.md.
```

---

## Note per l'esecutore

**Commit multi-riga in PowerShell**: `git commit -m @'…'@` con here-string **fallisce** in questo ambiente (`Remove-Item on system path '/' is blocked`). Scrivi il messaggio in un file temporaneo nella scratchpad e usa `git commit -F <path>`.

**Hook di commit**: husky + lint-staged eseguono il `npm run lint` **di tutto il progetto** (~25 s) quando lo stage contiene almeno un `.ts`/`.tsx`; un commit di soli `.md` li salta (~4 s). Un lint rosso aborta il commit: risolvi, non usare `--no-verify`.

**Ordine dei task**: 1 e 2 sono indipendenti fra loro; 3 è indipendente da tutti; 4 dipende solo da sé; **5 dipende da 1, 2, 3 e 4**; 6 va per ultimo. Non anticipare il 5.

**Cosa non è testabile in automatico**: clipboard, filesystem ACE/Steam e la chiamata Vision. Le prove manuali del Task 5 sono l'unica verifica di quei rami — se un gioco non è disponibile, dichiara la prova saltata invece di dedurla dal codice.
