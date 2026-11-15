# Guida utente multilingua + didascalie Impostazioni — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aggiungere la scheda "Guida" (dopo Impostazioni) in cinque lingue e correggere le didascalie di `SettingsPanel.tsx`.

**Architecture:** Nuovo namespace i18next `guide` con file dedicati `src/shared/locales/guide/<lang>.json`, esteso al controllo di parità. Un componente `GuidePanel` (react-bootstrap `Accordion`) legge `sections.<id>.steps` come array. Il `Tab` è duplicato in `App.tsx` e `TitleBar.tsx`: entrambi ricevono `"guide"`.

**Tech Stack:** TypeScript strict, React 19, react-bootstrap, react-i18next, i18next (risorse inline), selfcheck assert-based (nessun test runner).

**Spec:** `docs/superpowers/specs/2026-11-15-guida-utente-design.md`

## Global Constraints

- Funzioni a freccia, niente `function`/`class`; `type` e non `interface`; import relativi.
- Ogni testo utente passa da i18next, chiavi identiche in `de/en/es/fr/it` (`locales.selfcheck.ts`).
- Tema dark: nessun componente Bootstrap chiaro; riusare gli override esistenti di `Accordion`.
- Un solo tocco avvia il microfono, registrazione automatica di 5 s (`MAX_RECORD_MS = 5000`); assegnare un tasto controller rimuove la tastiera e viceversa.
- Etichette di pulsanti citate nella guida = quelle dei locale principali della stessa lingua.
- Nessun commit senza conferma dell'utente. Gate: `npm run typecheck && npm run lint && npm run format:check && npm run selfcheck && npm run fallow:check`.
- Messaggi di commit convenzionali, `feat:` per la guida.

## Review Focus

1. Una lingua con meno passi di `it` in una sezione: deve fallire il selfcheck (lunghezza array).
2. `t(..., { returnObjects: true })` con chiave mancante restituisce una stringa, non un array: `GuidePanel` non deve crashare.
3. Cambio lingua con la guida aperta: i testi si aggiornano senza rimontare la scheda.
4. Aprire la guida durante una sessione live non scrive negli store né apre modali.
5. Tag `<b>/<code>/<kbd>` non chiusi in una lingua rompono il rendering di `<Trans>`: verificare in tutte e cinque.

## File Structure

- Create `src/shared/locales/guide/{de,en,es,fr,it}.json` — testi della guida.
- Create `src/renderer/components/GuidePanel.tsx` — render dell'accordion.
- Modify `src/shared/i18n.ts`, `src/shared/i18next.d.ts`, `src/shared/locales.selfcheck.ts` — namespace e parità.
- Modify `src/renderer/App.tsx`, `src/renderer/components/TitleBar.tsx` — tab `guide`.
- Modify `src/shared/locales/{de,en,es,fr,it}.json` — `titleBar.guide`, didascalie.
- Modify `src/renderer/components/SettingsPanel.tsx` — fix unità, icona Salva, hint nuovi.
- Modify `CLAUDE.md`, `src/renderer/CLAUDE.md`, `src/shared/CLAUDE.md`.

---

### Task 1: Namespace `guide` e parità

**Files:**
- Create: `src/shared/locales/guide/{de,en,es,fr,it}.json`
- Modify: `src/shared/i18n.ts`, `src/shared/i18next.d.ts`, `src/shared/locales.selfcheck.ts`

**Interfaces:**
- Produces: `RESOURCES[lang].guide`; namespace `"guide"` utilizzabile con `useTranslation("guide")`; chiavi `title: string`, `intro: string` in ogni file.

- [ ] **Step 1: Extend `locales.selfcheck.ts`** per ripetere il confronto chiavi e variabili sia su `translation` sia su `guide` (riferimento `it`), con messaggio `${lang}.${ns} keys`.
- [ ] **Step 2: Run** `npm run selfcheck` — atteso: errore di compilazione/assert su `RESOURCES.it.guide` mancante.
- [ ] **Step 3: Create the five guide files** con soli `title` e `intro` (testo reale nella lingua), importarli in `i18n.ts` con `with { type: "json" }` e portare `RESOURCES` a `{ translation, guide }` per lingua.
- [ ] **Step 4: Update `i18next.d.ts`**: `resources: { translation: typeof it; guide: typeof guideIt }` (import del json `guide/it.json`).
- [ ] **Step 5: Run** `npm run typecheck && npm run selfcheck` — atteso: exit 0. Provare a cancellare `title` da `de` e verificare che fallisca, poi ripristinare.
- [ ] **Step 6: Commit** (solo dopo conferma): `feat: namespace i18n guide con parità cinque lingue`.

### Task 2: Contenuti della guida (7 sezioni × 5 lingue)

**Files:** Modify `src/shared/locales/guide/{de,en,es,fr,it}.json`

**Interfaces:**
- Consumes: namespace `guide` (Task 1).
- Produces: `sections.<id>.title: string` e `sections.<id>.steps: string[]` per `id` in ordine: `prerequisites`, `session`, `driving`, `setup`, `voice`, `analysis`, `history`. Markup ammesso nei passi: `<b>`, `<code>`, `<kbd>`.

- [ ] **Step 1: Scrivere `it.json`** (riferimento) seguendo i contenuti per sezione della spec. Verificare le etichette reali (Nuova sessione, Esegui analisi, Mostra analisi approfondita, Carica setup, Esporta PDF, ecc.) in `it.json` principale e negli `AnalysisHeader`/`SetupSelectionModal`. `voice` deve dire: un solo tocco, 5 secondi, tocchi ignorati mentre il coach elabora o risponde, assegnare un tasto rimuove l'altro. Lo stesso per i comandi vocali da `src/main/coach/voice-lexicon.ts` (lingua per lingua, non tradurre a occhio).
- [ ] **Step 2: Scrivere `en`, `de`, `es`, `fr`** con le stesse sezioni e lo stesso numero di passi, usando le etichette dei rispettivi locale principali. Possono essere scritte in parallelo da quattro subagent.
- [ ] **Step 3: Run** `npm run selfcheck && npm run format:check` — atteso: exit 0 (se Prettier segnala i JSON, `npm run format`).
- [ ] **Step 4: Commit** (dopo conferma): `feat: testi della guida utente in cinque lingue`.

### Task 3: `GuidePanel` e scheda in title bar

**Files:**
- Create: `src/renderer/components/GuidePanel.tsx`
- Modify: `src/renderer/App.tsx`, `src/renderer/components/TitleBar.tsx`, `src/shared/locales/{de,en,es,fr,it}.json` (`titleBar.guide`)

**Interfaces:**
- Consumes: `guide` namespace; ordine sezioni fisso `GUIDE_SECTIONS = ["prerequisites","session","driving","setup","voice","analysis","history"] as const` definito in `GuidePanel.tsx` (non esportato).
- Produces: `export default GuidePanel: () => JSX.Element`; `Tab` = `"current-session" | "session-list" | "settings" | "guide"` in `App.tsx` e `TitleBar.tsx`.

- [ ] **Step 1: Create `GuidePanel`**: `useTranslation("guide")`, titolo e intro, `Accordion defaultActiveKey="prerequisites"`; per ogni sezione un item con titolo numerato e un `<ol>` dei passi, ciascuno reso con `<Trans i18nKey=... ns="guide" components={{ b: <b />, code: <code />, kbd: <kbd /> }} />`. Se `t(key, { returnObjects: true })` non è un array, usare `[]` (Review Focus 2).
- [ ] **Step 2: Wire the tab**: aggiungere `"guide"` ai due `Tab`, un pulsante dopo "Impostazioni" in `TitleBar` (stesse classi e `aria-current` del bottone settings), `{tab === "guide" && <GuidePanel />}` in `App.tsx`; chiave `titleBar.guide` nelle cinque lingue.
- [ ] **Step 3: Run** `npm run typecheck && npm run lint && npm run selfcheck` — atteso: exit 0.
- [ ] **Step 4: Verify in app**: `npm run dev`, aprire la scheda Guida in ogni lingua (menu a tendina), cambiare lingua con la guida aperta, aprirla con una sessione attiva (nessun effetto sulla sessione). Controllare il tema dark dell'accordion; ritoccare `global.css` solo se serve.
- [ ] **Step 5: Commit** (dopo conferma): `feat: scheda Guida nella title bar`.

### Task 4: Didascalie di `SettingsPanel`

**Files:** Modify `src/renderer/components/SettingsPanel.tsx`, `src/shared/locales/{de,en,es,fr,it}.json` (blocco `settings`)

**Interfaces:**
- Produces: nuove chiavi `settings.assistant.nameHint`, `settings.azure.statusHint` in tutte e cinque le lingue.

- [ ] **Step 1: Riscrivere le chiavi esistenti** (stesse chiavi, nuovo testo, cinque lingue): `controller.hint` e `keyboard.hint` ("premi una volta, 5 secondi per parlare"; la tastiera dice che assegnare un tasto rimuove l'altro), `azure.title`/`azure.hint` (anche dettatura; anteprima menzionata solo come azione sul selettore voce), `model.hint` (serve Salva), `anthropic.hint` (analisi per sessione, a richiesta), `dev.mockHint` ("Formula Ultimate Gen2"), `dev.telemetryHint` (giochi: verificare in `src/main/` quali emettono il log JSONL e riportarli esatti).
- [ ] **Step 2: Aggiungere i due hint nuovi** (`nameHint`: richiamo a voce per nome, massimo 16 caratteri; `statusHint`: da spento la sintesi ricade su Web Speech per gli alert) e renderli con `<Form.Text>` nelle righe corrispondenti, stesso pattern `Row/Col sm={{ span: 9, offset: 3 }}`.
- [ ] **Step 3: Fix codice**: in `SettingsPanel.tsx` correggere la precedenza di `speed` e `dist` nel debug frame (`` `${frame.carSpeed?.toFixed(1) ?? "0"} km/h` `` e simile per `dist` con `m`); il pulsante Salva Azure usa `<FontAwesomeIcon icon={faCheck} />` come gli altri.
- [ ] **Step 4: Run** `npm run typecheck && npm run lint && npm run format:check && npm run selfcheck` — atteso: exit 0.
- [ ] **Step 5: Verify in app** le didascalie in almeno `it` e `en`, e il debug frame con unità visibili (mock o sim).
- [ ] **Step 6: Commit** (dopo conferma): `fix: didascalie delle impostazioni corrette e unità nel debug frame`.

### Task 5: Documentazione e gate finale

**Files:** Modify `CLAUDE.md`, `src/renderer/CLAUDE.md`, `src/shared/CLAUDE.md`

- [ ] **Step 1: `CLAUDE.md`** (radice, riga "Voice queries"): sostituire "Keyboard shortcut hold" con "un tocco avvia la registrazione (5 s automatici)".
- [ ] **Step 2: `src/renderer/CLAUDE.md`**: voce `GuidePanel.tsx` in `components/`; nota in `SettingsPanel` sulle didascalie e sul tab `guide`.
- [ ] **Step 3: `src/shared/CLAUDE.md`**: `i18n.ts` — `RESOURCES` con namespace `translation` e `guide`; `locales.selfcheck.ts` controlla entrambi.
- [ ] **Step 4: Run il gate completo** — `npm run typecheck && npm run lint && npm run format:check && npm run selfcheck && npm run fallow:check` — atteso: cinque exit 0.
- [ ] **Step 5: Commit** (dopo conferma): `docs: aggiornare i CLAUDE.md per guida e voce`.
