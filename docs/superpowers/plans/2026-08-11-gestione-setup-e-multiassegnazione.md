# Gestione setup unificata, editor manuale e multi-assegnazione — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portare AMS2 e ACE sullo stesso flusso di gestione setup di R3E, aggiungere un editor manuale per creare un setup da uno esistente, permettere l'assegnazione di un setup a più giri in blocco e mostrare il setup in uso nell'header della sessione.

**Architecture:** Tutto renderer-side tranne una riga nel main process (`session:getCurrent` che espone `currentSetupId`). `SetupSelectionModal` è già generico sui tre giochi: basta smettere di bypassarlo per ACE/AMS2. Il nuovo `SetupEditorModal` produce un normale `SetupData` e riusa la pipeline di salvataggio esistente (`useSetupPicker.handleSetupConfirm` → `session:loadSetup`). La multi-assegnazione generalizza lo stato del picker da un giro a una lista di id, riusando lo stesso modal già montato.

**Tech Stack:** Electron + React 19 + TypeScript strict + react-bootstrap + Zustand + Vite (electron-vite).

## Global Constraints

- **Niente framework di test per i componenti React in questo repo.** Gli unici test automatici sono i selfcheck assert-based (`npm run selfcheck`) e valgono per moduli di logica pura. Le tre feature sono interamente UI: la verifica di ogni task è `npm run typecheck` + `npm run lint` + uno smoke manuale in `npm run dev`. **Non inventare un test runner, non aggiungere vitest/jest.**
- **TypeScript strict.** `type` invece di `interface`. Named export. Import relativi.
- **Solo arrow function.** Mai la keyword `function`, mai `class`. Un hook `PostToolUse` blocca gli edit che le introducono.
- **Testi UI in italiano.**
- **react-bootstrap**: usare i componenti (`Button`, `Form`, `Modal`, `Table`) invece delle classi Bootstrap a mano quando il componente esiste.
- **Icone FontAwesome**: import singolo per icona da `@fortawesome/free-solid-svg-icons`, mai `import * as`.
- **Tema dark**: colori solo dalle CSS custom properties di `src/renderer/styles/global.css` (`--bg`, `--bg2`, `--bg3`, `--border`, `--text`, `--text-dim`, `--accent`, `--yellow`).
- **Prettier è cablato**: dopo le modifiche lanciare `npm run format`, non allineare lo stile a mano.
- **ESLint gira al commit** (husky + lint-staged): mettere in stage un `.ts`/`.tsx` fa partire `npm run lint` sull'intero progetto (~25s) e un exit non-zero aborta il commit.
- **Commit in PowerShell**: i messaggi multi-riga con here-string (`git commit -m @'…'@`) falliscono in questo ambiente. Scrivere il messaggio in un file temporaneo e usare `git commit -F <path>`.
- **Regola dell'utente: mai committare senza conferma esplicita.** Ogni step "Commit" va proposto, non eseguito d'ufficio.
- Branch di lavoro: `feat/gestione-setup-e-multiassegnazione` (già creato, spec già committata).

---

## File Structure

| File | Responsabilità | Task |
| --- | --- | --- |
| `src/shared/types.ts` | `SessionDetail.activeSetupId` | 1 |
| `src/main/main.ts` | `session:getCurrent` espone `currentSetupId` | 1 |
| `src/renderer/store/sessionStore.ts` | Stato `activeSetupId` + `setActiveSetup` | 1 |
| `src/renderer/components/AnalysisHeader.tsx` | Mostra il setup in uso | 1 |
| `src/renderer/styles/global.css` | `.deb-setup`, `.setup-editor-row`, `.laps-select-cell` | 1, 3, 4 |
| `src/renderer/components/SessionPanel.tsx` | Apertura gestione setup per tutti i giochi, mount editor, wiring multiselezione | 2, 3, 4 |
| `src/renderer/components/SetupSelectionModal.tsx` | Label per gioco, prop `onDuplicateSetup` | 2, 3 |
| `src/renderer/components/SetupDetailModal.tsx` | Pulsante "Crea setup da esistente" | 3 |
| `src/renderer/components/SetupEditorModal.tsx` *(nuovo)* | Editor manuale dei valori | 3 |
| `src/renderer/hooks/useSetupPicker.ts` | `setActiveSetup`, `editorBase`, `pickerLapIds`/`pendingLapIds` | 1, 3, 4 |
| `src/renderer/components/LapsTable.tsx` | Colonna checkbox + pulsante "Assegna setup" | 4 |
| `src/renderer/CLAUDE.md` | Descrizioni dei componenti toccati | 2, 3, 4 |

---

## Task 1: Setup attivo esposto e mostrato nell'header

**Files:**
- Modify: `src/shared/types.ts:251-256`
- Modify: `src/main/main.ts:1379-1382`
- Modify: `src/renderer/store/sessionStore.ts`
- Modify: `src/renderer/hooks/useSetupPicker.ts:54-90`
- Modify: `src/renderer/components/AnalysisHeader.tsx`
- Modify: `src/renderer/styles/global.css`

**Interfaces:**
- Consumes: niente dai task precedenti.
- Produces:
  - `SessionDetail.activeSetupId?: number | null` (shared type)
  - `useSessionStore` state: `activeSetupId: number | null`
  - `useSessionStore` method: `setActiveSetup: (id: number | null) => void`

- [ ] **Step 1: Aggiungere `activeSetupId` a `SessionDetail`**

In `src/shared/types.ts`, sostituire il type `SessionDetail`:

```ts
export type SessionDetail = {
  session: SessionRow;
  laps: LapRow[];
  setups: SessionSetupRow[];
  analyses: SessionAnalysisRow[];
  /** Setup attivo. Valorizzato solo da session:getCurrent — per una sessione
   *  storica non esiste un "setup in uso". */
  activeSetupId?: number | null;
};
```

- [ ] **Step 2: Esporre `currentSetupId` da `session:getCurrent`**

In `src/main/main.ts`, sostituire l'handler (righe 1379-1382):

```ts
  ipcMain.handle("session:getCurrent", () => {
    if (!currentSessionId) return null;
    const detail = loadSessionDetail(currentSessionId, currentSessionGame);
    return detail && { ...detail, activeSetupId: currentSetupId };
  });
```

`src/preload/index.ts` non va toccato: `sessionGetCurrent` inoltra già il payload così com'è.

- [ ] **Step 3: Tenere `activeSetupId` nel `sessionStore`**

In `src/renderer/store/sessionStore.ts`:

1. Nel type `State`, dopo `analyses: SessionAnalysisRow[];` aggiungere:

```ts
  /** Setup attivo della sessione live: quello che verrà agganciato ai prossimi giri. */
  activeSetupId: number | null;
```

2. Nello stesso type, dopo `assignLapSetup: ...` aggiungere:

```ts
  setActiveSetup: (id: number | null) => void;
```

3. Nel valore iniziale dello store, dopo `analyses: [],` aggiungere:

```ts
  activeSetupId: null,
```

4. Sostituire `setDetail` per propagare il campo:

```ts
  setDetail: (detail, mode) => {
    if (!detail) {
      set({
        session: null,
        laps: [],
        setups: [],
        analyses: [],
        activeSetupId: null,
        mode,
        working: null,
      });
      return;
    }
    set({
      session: detail.session,
      laps: detail.laps,
      setups: detail.setups,
      analyses: detail.analyses,
      activeSetupId: detail.activeSetupId ?? null,
      mode,
      working: null,
    });
  },
```

5. Aggiungere il metodo, subito dopo `assignLapSetup`:

```ts
  setActiveSetup: (id) => set({ activeSetupId: id }),
```

6. In `_applySetupLoaded`, un setup appena caricato diventa quello attivo:

```ts
  _applySetupLoaded: ({ sessionId, setup }) => {
    const s = get();
    if (!s.session || s.session.id !== sessionId) return;
    set({ setups: [...s.setups, setup], activeSetupId: setup.id });
  },
```

7. In `reset()`, aggiungere `activeSetupId: null,` accanto a `analyses: []`.

8. In `_applySessionStarted`, aggiungere al `set({...})`:

```ts
      activeSetupId: isSameSession ? current.activeSetupId : null,
```

- [ ] **Step 4: Aggiornare `activeSetupId` quando si riusa un setup**

In `src/renderer/hooks/useSetupPicker.ts`, aggiungere sotto `const assignLapSetup = ...`:

```ts
  const setActiveSetup = useSessionStore((s) => s.setActiveSetup);
```

e in `handleReuseSetup`, nel ramo `else if (!explicit)`, subito dopo la chiamata a `sessionReuseSetup`:

```ts
        await window.electronAPI.sessionReuseSetup({ setupId: targetSetupId });
        setActiveSetup(targetSetupId);
        showFlash("success", "Setup attivo aggiornato.");
```

Il ramo `explicit` (sessione storica) non tocca `activeSetupId`: lì il concetto non esiste.

- [ ] **Step 5: Mostrare il setup in uso in `AnalysisHeader`**

In `src/renderer/components/AnalysisHeader.tsx`, dopo `const analyses = useSessionStore((s) => s.analyses);` aggiungere:

```tsx
  const activeSetupId = useSessionStore((s) => s.activeSetupId);
```

e sotto `const isR3E = session?.game === "r3e";` aggiungere:

```tsx
  // Solo in live con sessione attiva: per una sessione storica o chiusa non c'è
  // un setup "in uso" (activeSetupId arriva solo da session:getCurrent).
  const activeSetupName =
    isLive && sessionActive && activeSetupId != null
      ? (setups.find((row) => row.id === activeSetupId)?.setup.name ??
        `#${activeSetupId}`)
      : null;
```

Nel JSX, subito dopo lo `<span className="text-muted">` con `{laps.length} giri`, dentro lo stesso frammento:

```tsx
          {activeSetupName && (
            <>
              <span className="text-muted">·</span>
              <span className="text-muted">
                setup <span className="deb-setup">{activeSetupName}</span>
              </span>
            </>
          )}
```

- [ ] **Step 6: Stile del badge setup**

In `src/renderer/styles/global.css`, accanto alle altre regole `.deb-*` dell'header:

```css
.deb-setup {
  color: var(--accent);
  font-weight: 600;
}
```

- [ ] **Step 7: Verificare tipi e lint**

```bash
npm run format
npm run typecheck
npm run lint
```

Atteso: entrambi puliti, exit 0. Se `typecheck` segnala `activeSetupId` mancante in un oggetto `SessionDetail`, il campo è opzionale — controllare di non aver dimenticato il `?`.

- [ ] **Step 8: Smoke manuale**

```bash
npm run dev
```

Con un sim in esecuzione: apri una sessione, carica un setup, verifica che nell'header compaia `· setup <nome>`. Apri "Gestione setup", riusa un setup diverso dallo storico: il nome nell'header deve cambiare. Apri una sessione storica dalla lista: il setup **non** deve comparire.

- [ ] **Step 9: Commit** *(chiedere conferma prima di eseguirlo)*

```bash
git add src/shared/types.ts src/main/main.ts src/renderer/store/sessionStore.ts src/renderer/hooks/useSetupPicker.ts src/renderer/components/AnalysisHeader.tsx src/renderer/styles/global.css
Set-Content -Path "$env:TEMP\commit-msg.txt" -Value "feat(setup): mostra il setup in uso nell'header della sessione"
git commit -F "$env:TEMP\commit-msg.txt"
```

---

## Task 2: Gestione setup unificata per i tre giochi

**Files:**
- Modify: `src/renderer/components/SessionPanel.tsx:76-86` e `:142-146`
- Modify: `src/renderer/components/SetupSelectionModal.tsx:1-11` e `:269-272`
- Modify: `src/renderer/CLAUDE.md`

**Interfaces:**
- Consumes: niente dal Task 1.
- Produces: `SetupSelectionModal` è ora la porta d'ingresso unica alla gestione setup per R3E, ACE e AMS2. Il picker specifico del gioco (`showPicker`) resta raggiungibile solo dal pulsante in fondo al modal.

- [ ] **Step 1: Non aprire più la gestione setup all'avvio sessione**

In `src/renderer/components/SessionPanel.tsx`, in `handleGamePicked`, rimuovere la riga `if (game === "r3e") setShowSetupSelection(true);`. Il blocco diventa:

```tsx
  const handleGamePicked = async (game: GameSource): Promise<void> => {
    setShowGamePicker(false);
    const res = await window.electronAPI.sessionStart(game);
    announceOutcome(res);
    if (!res.ok) {
      showFlash("danger", res.reason);
    } else {
      showFlash("success", "Sessione aperta.");
    }
  };
```

Il parametro `game` resta usato da `sessionStart(game)`, quindi nessun warning di variabile inutilizzata.

- [ ] **Step 2: Aprire `SetupSelectionModal` per tutti i giochi**

Sempre in `SessionPanel.tsx`, nella prop `onOpenPicker` di `<AnalysisHeader>`, sostituire il ternario con:

```tsx
        onOpenPicker={() => setShowSetupSelection(true)}
```

- [ ] **Step 3: Label e icona del pulsante di acquisizione per gioco**

In `src/renderer/components/SetupSelectionModal.tsx`, aggiungere `faCamera` all'import di `@fortawesome/free-solid-svg-icons`:

```tsx
import {
  faCamera,
  faCheck,
  faFileCode,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";
```

Sotto `const formatDate = ...`, aggiungere la mappa:

```tsx
const ACQUIRE: Record<GameSource, { label: string; icon: typeof faFileCode }> = {
  r3e: { label: "Carica da JSON", icon: faFileCode },
  ace: { label: "Seleziona file", icon: faFileCode },
  ams2: { label: "Acquisisci screenshot", icon: faCamera },
};
```

Sostituire il pulsante in fondo al `Modal.Body` (righe 269-272):

```tsx
          <Button variant="secondary" onClick={onJsonPicker} className="w-100">
            <FontAwesomeIcon icon={ACQUIRE[game].icon} className="me-2" />
            {ACQUIRE[game].label}
          </Button>
```

- [ ] **Step 4: Aggiornare la documentazione dei componenti**

In `src/renderer/CLAUDE.md`, nella voce **SetupSelectionModal.tsx**, sostituire la descrizione con:

```
- **SetupSelectionModal.tsx** — Modal per la gestione setup, unico punto d'ingresso per **tutti e tre i giochi**. Offre: (1) lo storico setup per la combinazione auto/circuito corrente (`sessionGetSetupHistory` IPC → riuso via `sessionReuseSetup`, eliminazione via `deleteSetup`); (2) l'acquisizione di un nuovo setup, che passa la mano al picker specifico del gioco tramite `onJsonPicker` — il parent (`SessionPanel`) monta tutti e tre (`R3eSetupPicker` / `AceSetupPicker` / `Ams2SetupPicker`) e sceglie in base al gioco. Label e icona del pulsante di acquisizione dipendono dal gioco (mappa `ACQUIRE`): R3E "Carica da JSON", ACE "Seleziona file", AMS2 "Acquisisci screenshot". Mostra `SetupDetailModal` per l'anteprima
```

Nella voce **SessionPanel.tsx**, aggiungere in coda alla descrizione:

```
. All'avvio di una nuova sessione la gestione setup **non** si apre automaticamente per nessun gioco
```

- [ ] **Step 5: Verificare tipi e lint**

```bash
npm run format
npm run typecheck
npm run lint
```

Atteso: exit 0. Se `GameSource` non risulta importato in `SetupSelectionModal.tsx`, è già nell'import di `../../shared/types` alla riga 9 — verificare.

- [ ] **Step 6: Smoke manuale**

```bash
npm run dev
```

Apri una nuova sessione: **nessun modal** deve comparire dopo la conferma del gioco. Premi "Gestione setup": deve aprirsi lo storico setup per tutti e tre i giochi. Verifica la label in fondo al modal: "Acquisisci screenshot" su AMS2, "Seleziona file" su ACE, "Carica da JSON" su R3E. Il pulsante deve aprire il picker corretto.

- [ ] **Step 7: Commit** *(chiedere conferma prima di eseguirlo)*

```bash
git add src/renderer/components/SessionPanel.tsx src/renderer/components/SetupSelectionModal.tsx src/renderer/CLAUDE.md
Set-Content -Path "$env:TEMP\commit-msg.txt" -Value "feat(setup): gestione setup unificata per R3E, ACE e AMS2"
git commit -F "$env:TEMP\commit-msg.txt"
```

---

## Task 3: Editor manuale — "Crea setup da esistente"

**Files:**
- Create: `src/renderer/components/SetupEditorModal.tsx`
- Modify: `src/renderer/components/SetupDetailModal.tsx`
- Modify: `src/renderer/components/SetupSelectionModal.tsx`
- Modify: `src/renderer/hooks/useSetupPicker.ts`
- Modify: `src/renderer/components/SessionPanel.tsx`
- Modify: `src/renderer/styles/global.css`
- Modify: `src/renderer/CLAUDE.md`

**Interfaces:**
- Consumes: `useSetupPicker.handleSetupConfirm(setup: SetupData) => Promise<void>` (esistente), `setPendingLapIds` **non** esiste ancora — in questo task il picker per giro usa ancora `pendingLapId`. Il Task 4 lo rinomina.
- Produces:
  - `SetupEditorModal` — named export, props `{ base: SetupData; onClose: () => void; onConfirm: (setup: SetupData) => void }`
  - `SetupDetailModalProps.onDuplicate?: () => void`
  - `SetupSelectionModal` prop `onDuplicateSetup: (setup: SetupData) => void`
  - `useSetupPicker` ritorna `editorBase: SetupData | null` e `setEditorBase`

- [ ] **Step 1: Creare `SetupEditorModal`**

Creare `src/renderer/components/SetupEditorModal.tsx`:

```tsx
/**
 * SetupEditorModal — crea un nuovo setup partendo da uno esistente, modificando
 * i valori a mano. I valori di SetupParam sono stringhe libere ("24.5 kPa",
 * "58/42%", "Soft"): l'editor non parsa né valida nulla, quello che scrivi è
 * quello che finisce nel setup.
 */

import { faCheck, faXmark } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { useState } from "react";
import { Button, Form, Modal } from "react-bootstrap";
import type { SetupData, SetupParam } from "../../shared/types";

type Props = {
  base: SetupData;
  onClose: () => void;
  onConfirm: (setup: SetupData) => void;
};

export const SetupEditorModal = ({ base, onClose, onConfirm }: Props) => {
  const [name, setName] = useState("");
  const [params, setParams] = useState<SetupParam[]>(() =>
    base.params.map((p) => ({ ...p })),
  );

  const setValue = (index: number, value: string): void =>
    setParams((prev) =>
      prev.map((p, i) => (i === index ? { ...p, value } : p)),
    );

  // ponytail: raggruppamento O(n²) su qualche decina di parametri, una Map non
  // si ripaga. L'ordine delle categorie segue quello di apparizione.
  const groups = [...new Set(params.map((p) => p.category))].map(
    (category) => ({
      category,
      items: params
        .map((p, index) => ({ p, index }))
        .filter((e) => e.p.category === category),
    }),
  );

  const handleConfirm = (): void => {
    if (!name.trim()) return;
    onConfirm({
      name: name.trim(),
      carVerified: true,
      carFound: base.carFound,
      setupText: base.setupText,
      params,
      // Il setup manuale non deve marcare come "già scansionati" gli screenshot
      // del setup di origine.
      screenshots: [],
    });
  };

  return (
    <Modal show onHide={onClose} size="xl" className="screenshot-picker-modal">
      <Modal.Header className="picker-header">
        <Modal.Title className="picker-title">
          Crea setup da esistente
          <span className="picker-subtitle">
            {" "}
            · {base.name ?? base.carFound}
          </span>
        </Modal.Title>
        <Button variant="link" className="picker-close" onClick={onClose}>
          <FontAwesomeIcon icon={faXmark} />
        </Button>
      </Modal.Header>

      <Modal.Body className="picker-body">
        <Form.Group className="mb-3" style={{ maxWidth: 360 }}>
          <Form.Label className="text-muted" style={{ fontSize: 14 }}>
            Nome setup <span className="text-danger">*</span>
          </Form.Label>
          <Form.Control
            size="sm"
            type="text"
            placeholder="es. Qualifica Interlagos rev2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Form.Group>

        <div className="picker-params">
          {groups.map((g) => (
            <div key={g.category} className="setup-editor-section">
              <div className="setup-subsection-title">{g.category}</div>
              {g.items.map(({ p, index }) => (
                <div key={`${p.category}|${p.parameter}`} className="setup-editor-row">
                  <span className="text-muted">{p.parameter}</span>
                  <Form.Control
                    size="sm"
                    type="text"
                    value={p.value}
                    onChange={(e) => setValue(index, e.target.value)}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </Modal.Body>

      <Modal.Footer className="picker-footer">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Annulla
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={!name.trim()}
          onClick={handleConfirm}
        >
          <FontAwesomeIcon icon={faCheck} className="me-1" />
          Salva setup
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
```

Il componente non ha stato da resettare: il parent lo monta solo quando `editorBase != null`, quindi ogni apertura è un mount pulito e `useState` riparte da zero.

- [ ] **Step 2: Stile delle righe dell'editor**

In `src/renderer/styles/global.css`, dopo il blocco `.setup-value`:

```css
/* ── Setup Editor Modal ── */
.setup-editor-section {
  margin-bottom: 12px;
}
.setup-editor-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 8px;
  border-bottom: 1px solid var(--border);
  font-size: 14px;
}
.setup-editor-row > span {
  flex: 1;
  min-width: 0;
}
.setup-editor-row .form-control {
  width: 150px;
  flex: none;
  background: var(--bg2);
  color: var(--text);
  border-color: var(--border);
  text-align: right;
}
```

- [ ] **Step 3: Pulsante "Crea setup da esistente" in `SetupDetailModal`**

In `src/renderer/components/SetupDetailModal.tsx`:

1. Import: `import { faCheck, faCopy } from "@fortawesome/free-solid-svg-icons";`
2. Nel type props, dopo `onUse?: () => void;` aggiungere `onDuplicate?: () => void;`
3. Destrutturare `onDuplicate` nella firma del componente.
4. Sostituire il footer:

```tsx
      {(onUse || onDuplicate) && (
        <Modal.Footer>
          {onDuplicate && (
            <Button size="sm" variant="secondary" onClick={onDuplicate}>
              <FontAwesomeIcon icon={faCopy} className="me-1" />
              Crea setup da esistente
            </Button>
          )}
          {onUse && (
            <Button size="sm" variant="primary" onClick={onUse}>
              <FontAwesomeIcon icon={faCheck} className="me-1" />
              Usa questo setup
            </Button>
          )}
        </Modal.Footer>
      )}
```

- [ ] **Step 4: Inoltrare la duplicazione da `SetupSelectionModal`**

In `src/renderer/components/SetupSelectionModal.tsx`:

1. Aggiungere `SetupData` all'import dei tipi:

```tsx
import type { GameSource, SessionSetupRow, SetupData } from "../../shared/types";
```

2. Nel type `Props`, dopo `onJsonPicker: () => void;` aggiungere:

```tsx
  onDuplicateSetup: (setup: SetupData) => void;
```

3. Destrutturare `onDuplicateSetup` nella firma del componente.
4. Aggiungere la prop al `<SetupDetailModal>` in fondo al file:

```tsx
        onDuplicate={() => {
          const row =
            selectedId != null ? setupById.get(selectedId) : undefined;
          if (row) onDuplicateSetup(row.setup);
          setSelectedId(null);
          onClose();
        }}
```

- [ ] **Step 5: Stato dell'editor in `useSetupPicker`**

In `src/renderer/hooks/useSetupPicker.ts`, dopo `const [pendingLapId, setPendingLapId] = useState<number | null>(null);`:

```ts
  /** Setup di partenza dell'editor manuale; null = editor chiuso. */
  const [editorBase, setEditorBase] = useState<SetupData | null>(null);
```

e aggiungere `editorBase,` e `setEditorBase,` all'oggetto ritornato.

- [ ] **Step 6: Montare l'editor in `SessionPanel`**

In `src/renderer/components/SessionPanel.tsx`:

1. Import: `import { SetupEditorModal } from "./SetupEditorModal";`
2. Destrutturare `editorBase, setEditorBase` da `useSetupPicker(...)`.
3. Al primo `<SetupSelectionModal>` (quello della gestione setup) aggiungere:

```tsx
          onDuplicateSetup={setEditorBase}
```

4. Al secondo `<SetupSelectionModal>` (quello per giro) aggiungere — duplicare da lì assegna il nuovo setup allo stesso giro, come già fa `onJsonPicker`:

```tsx
          onDuplicateSetup={(setup) => {
            setPendingLapId(pickerLap!.id);
            setPickerLap(null);
            setEditorBase(setup);
          }}
```

5. Montare l'editor dopo i due `SetupSelectionModal`:

```tsx
      {editorBase && (
        <SetupEditorModal
          base={editorBase}
          onClose={() => setEditorBase(null)}
          onConfirm={(setup) => {
            setEditorBase(null);
            void handleSetupConfirm(setup);
          }}
        />
      )}
```

- [ ] **Step 7: Documentare i componenti**

In `src/renderer/CLAUDE.md`, aggiungere dopo la voce **SetupDetailModal.tsx**:

```
- **SetupEditorModal.tsx** — Editor manuale dei valori di un setup, aperto da "Crea setup da esistente" nel `SetupDetailModal`. Un `Form.Control` di testo per parametro, raggruppati per `category` in ordine di apparizione. I valori sono stringhe libere: nessun parsing di unità, nessuna validazione. Alla conferma produce un nuovo `SetupData` con `screenshots: []` (un setup manuale non deve marcare come "già scansionati" gli screenshot dell'originale) e passa per `useSetupPicker.handleSetupConfirm`, quindi diventa il setup attivo. Il nome è obbligatorio e parte vuoto — non viene precompilato dal setup di origine. Valido per tutti e tre i giochi
```

e aggiornare la voce **SetupDetailModal.tsx** aggiungendo in coda:

```
. Prop opzionale `onDuplicate`: mostra "Crea setup da esistente" accanto a "Usa questo setup"
```

- [ ] **Step 8: Verificare tipi e lint**

```bash
npm run format
npm run typecheck
npm run lint
```

Atteso: exit 0. Errore probabile: `onDuplicateSetup` mancante su uno dei due `SetupSelectionModal` (la prop è obbligatoria) — aggiungerlo a entrambi.

- [ ] **Step 9: Smoke manuale**

```bash
npm run dev
```

Su AMS2: "Gestione setup" → clic su un setup dello storico → "Crea setup da esistente" → l'editor mostra tutti i parametri raggruppati per categoria. Il pulsante "Salva setup" è disabilitato finché il nome è vuoto. Modifica due valori, dai un nome, salva: il nuovo setup compare nel contatore dell'header ("Gestione setup (N)"), nell'header appare `· setup <nuovo nome>`, e riaprendo la gestione setup il nuovo setup è nello storico con i valori modificati. Ripetere su R3E e ACE.

- [ ] **Step 10: Commit** *(chiedere conferma prima di eseguirlo)*

```bash
git add src/renderer/components/SetupEditorModal.tsx src/renderer/components/SetupDetailModal.tsx src/renderer/components/SetupSelectionModal.tsx src/renderer/components/SessionPanel.tsx src/renderer/hooks/useSetupPicker.ts src/renderer/styles/global.css src/renderer/CLAUDE.md
Set-Content -Path "$env:TEMP\commit-msg.txt" -Value "feat(setup): editor manuale per creare un setup da uno esistente"
git commit -F "$env:TEMP\commit-msg.txt"
```

---

## Task 4: Multiselezione dei giri e assegnazione in blocco

**Files:**
- Modify: `src/renderer/hooks/useSetupPicker.ts`
- Modify: `src/renderer/components/LapsTable.tsx`
- Modify: `src/renderer/components/SessionPanel.tsx`
- Modify: `src/renderer/styles/global.css`
- Modify: `src/renderer/CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-08-11-gestione-setup-e-multiassegnazione-design.md` (già allineato: la selezione persiste al cambio pagina)

**Interfaces:**
- Consumes: `useSessionStore.assignLapSetup(lapId: number, setupId: number | null) => Promise<void>` (esistente), `editorBase`/`setEditorBase` dal Task 3.
- Produces:
  - `useSetupPicker` ritorna `pickerLapIds: number[] | null`, `setPickerLapIds`, `setPendingLapIds` (sostituiscono `pickerLap`, `setPickerLap`, `setPendingLapId`)
  - `LapsTable` prop `onAssignSetup?: (lapIds: number[]) => void`; `onPickSetup?: (lap: LapRow) => void` resta invariata

- [ ] **Step 1: Generalizzare `useSetupPicker` da un giro a N giri**

In `src/renderer/hooks/useSetupPicker.ts`:

1. Sostituire i due state:

```ts
  /** Giri a cui assegnare il setup scelto dal modal; null = modal chiuso. */
  const [pickerLapIds, setPickerLapIds] = useState<number[] | null>(null);
  /** Giri in attesa del setup che sta per essere creato dal picker/editor. */
  const [pendingLapIds, setPendingLapIds] = useState<number[] | null>(null);
```

2. `LapRow` non è più usato nel file: rimuoverlo dall'import dei tipi, che diventa:

```ts
import type { SessionSetupRow, SetupData } from "../../shared/types";
```

3. Aggiungere sopra le funzioni un helper per il testo del flash:

```ts
const lapsLabel = (n: number): string => `${n} ${n === 1 ? "giro" : "giri"}`;
```

4. Sostituire il ramo `pendingLapId` di `handleSetupConfirm`:

```ts
      const { setupId } = await window.electronAPI.sessionLoadSetup(params);
      if (pendingLapIds != null) {
        // ponytail: un update per giro, sono decine non migliaia - niente IPC bulk
        for (const lapId of pendingLapIds) await assignLapSetup(lapId, setupId);
        showFlash(
          "success",
          `Setup ${named.name} caricato e assegnato a ${lapsLabel(pendingLapIds.length)}.`,
        );
        setPendingLapIds(null);
      } else {
        showFlash("success", `Setup caricato: ${named.name}`);
      }
```

5. Sostituire `handleLapReuseSetup`:

```ts
  const handleLapReuseSetup = async (row: SessionSetupRow): Promise<void> => {
    const lapIds = pickerLapIds;
    if (!lapIds?.length) return;
    try {
      let targetSetupId = row.id;
      // If the setup is not in the current session, copy it first so setup_id
      // resolves correctly in setupById and persists on reload.
      if (!setupById.has(row.id)) {
        const named: SetupData = row.setup.name
          ? row.setup
          : { ...row.setup, name: row.setup.carFound || "Setup" };
        const params =
          explicit && session
            ? { setup: named, sessionId: session.id, game: session.game }
            : { setup: named };
        const result = await window.electronAPI.sessionLoadSetup(params);
        targetSetupId = result.setupId;
      }
      for (const lapId of lapIds) await assignLapSetup(lapId, targetSetupId);
      showFlash("success", `Setup assegnato a ${lapsLabel(lapIds.length)}.`);
    } catch (err) {
      showFlash("danger", String(err));
    }
  };
```

6. Aggiornare l'oggetto ritornato: `pickerLapIds`, `setPickerLapIds`, `setPendingLapIds` al posto di `pickerLap`, `setPickerLap`, `setPendingLapId`.

- [ ] **Step 2: Colonna di selezione in `LapsTable`**

In `src/renderer/components/LapsTable.tsx`:

1. Aggiungere `faGear` all'import delle icone e `Form` all'import di react-bootstrap:

```tsx
import { Badge, Button, Form, Modal, Table } from "react-bootstrap";
```

2. Estendere le props:

```tsx
type LapsTableProps = {
  setupById: Map<number, SessionSetupRow>;
  live?: boolean;
  onPickSetup?: (lap: LapRow) => void;
  onAssignSetup?: (lapIds: number[]) => void;
};
```

e la destrutturazione:

```tsx
const LapsTable = ({
  setupById,
  live = false,
  onPickSetup,
  onAssignSetup,
}: LapsTableProps) => {
```

3. Aggiungere lo state dopo `const [hideInvalid, setHideInvalid] = useState(true);`:

```tsx
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
```

4. Dopo `const pageCount = ...`, derivare la selezione effettiva:

```tsx
  // La selezione effettiva è l'intersezione con i giri visibili: così cambio
  // sessione, filtro validi ed eliminazione di un giro la ripuliscono da soli,
  // senza effetti né reset espliciti. Persiste invece al cambio pagina, che è
  // esattamente il caso d'uso dell'assegnazione in blocco.
  // ponytail: O(n²) su qualche decina di giri
  const selectedIds = visibleLaps
    .filter((l) => selected.has(l.id))
    .map((l) => l.id);
  const allSelected =
    visibleLaps.length > 0 && selectedIds.length === visibleLaps.length;

  const toggleSelected = (id: number): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = (): void =>
    setSelected(allSelected ? new Set() : new Set(visibleLaps.map((l) => l.id)));
```

5. Nel `thead`, sostituire la prima `<th>` (`<th className="col-icon"></th>`) con **due** colonne — la checkbox e quella del chevron:

```tsx
            <th className="laps-select-cell">
              <Form.Check.Input
                type="checkbox"
                checked={allSelected}
                ref={(el: HTMLInputElement | null) => {
                  if (el)
                    el.indeterminate =
                      selectedIds.length > 0 &&
                      selectedIds.length < visibleLaps.length;
                }}
                onChange={toggleAll}
                title="Seleziona tutti i giri visibili"
              />
            </th>
            <th className="col-icon"></th>
```

6. Nel `tbody`, aggiungere la cella corrispondente come **prima** cella di ogni riga giro, prima di `<td className={iconCellClass}>`:

```tsx
                  <td
                    className="laps-select-cell"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Form.Check.Input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={() => toggleSelected(l.id)}
                      title="Seleziona giro"
                    />
                  </td>
```

7. Aggiornare **entrambi** i `colSpan={10}` a `colSpan={11}`: quello della riga "Nessun giro" e quello della riga telemetria.

- [ ] **Step 3: Pulsante "Assegna setup" nell'header della sezione Giri**

Sempre in `LapsTable.tsx`, sostituire il blocco header:

```tsx
      <div className="d-flex justify-content-between align-items-center mb-1">
        <h6 className="text-uppercase mb-1">Giri</h6>
        <div className="d-flex gap-2">
          {selectedIds.length > 0 && (
            <Button
              variant="primary"
              className="laps-toggle-btn"
              onClick={() => {
                onAssignSetup?.(selectedIds);
                setSelected(new Set());
              }}
            >
              <FontAwesomeIcon icon={faGear} className="me-1" />
              Assegna setup ({selectedIds.length})
            </Button>
          )}
          {laps.length > 0 && (
            <Button
              variant="secondary"
              className="laps-toggle-btn"
              onClick={toggleHideInvalid}
            >
              <FontAwesomeIcon
                icon={hideInvalid ? faEye : faEyeSlash}
                className="me-1"
              />
              {hideInvalid ? "Mostra non validi" : "Nascondi non validi"}
            </Button>
          )}
        </div>
      </div>
```

- [ ] **Step 4: Stile della colonna di selezione**

In `src/renderer/styles/global.css`, accanto alle altre regole `.laps-*`:

```css
.laps-select-cell {
  width: 34px;
  text-align: center;
  vertical-align: middle;
}
.laps-select-cell .form-check-input {
  margin: 0;
  cursor: pointer;
}
```

- [ ] **Step 5: Wiring in `SessionPanel`**

In `src/renderer/components/SessionPanel.tsx`:

1. Nella destrutturazione di `useSetupPicker`, sostituire `pickerLap`, `setPickerLap`, `setPendingLapId` con `pickerLapIds`, `setPickerLapIds`, `setPendingLapIds`.
2. `<LapsTable>` diventa:

```tsx
          <LapsTable
            setupById={setupById}
            live={isLive}
            onPickSetup={(lap) => setPickerLapIds([lap.id])}
            onAssignSetup={setPickerLapIds}
          />
```

3. Il secondo `<SetupSelectionModal>` diventa:

```tsx
      {session && (
        <SetupSelectionModal
          show={pickerLapIds != null}
          car={session.car}
          track={session.track}
          layout={session.layout}
          game={session.game}
          onClose={() => setPickerLapIds(null)}
          onReuseSetup={handleLapReuseSetup}
          onDuplicateSetup={(setup) => {
            setPendingLapIds(pickerLapIds);
            setPickerLapIds(null);
            setEditorBase(setup);
          }}
          onJsonPicker={() => {
            setPendingLapIds(pickerLapIds);
            setPickerLapIds(null);
            setShowPicker(true);
          }}
        />
      )}
```

- [ ] **Step 6: Documentare i componenti**

In `src/renderer/CLAUDE.md`, sostituire la voce **LapsTable.tsx**:

```
- **LapsTable.tsx** — Bootstrap dark Table con i giri della sessione corrente (checkbox di selezione, lap#, tempo, settori, flag valido, badge setup, timestamp). Legge da `sessionStore`. Il badge setup mostra il nome del setup collegato e apre il picker per quel giro. Multiselezione: checkbox per riga + "seleziona tutti" nel `thead` (agisce sui giri **visibili**, non solo sulla pagina), e un pulsante "Assegna setup (N)" nell'header della sezione che chiama `onAssignSetup(lapIds)`. La selezione effettiva è derivata intersecando gli id selezionati con i giri visibili — così filtro, cambio sessione ed eliminazione la ripuliscono da soli — e **persiste al cambio pagina**, che è il caso d'uso dell'assegnazione in blocco. Click sulla riga → `LapTelemetryCharts`
```

e la voce **useSetupPicker.ts** nella sezione `hooks/`:

```
- **useSetupPicker.ts** — Stato della UI di selezione setup (apertura/chiusura, picker specifico del gioco, flusso di riuso, `editorBase` dell'editor manuale). L'assegnazione ai giri lavora su **liste di id** (`pickerLapIds`, `pendingLapIds`): lo stesso `SetupSelectionModal` serve sia il singolo giro (badge di riga) sia l'assegnazione in blocco dalla multiselezione, ciclando `assignLapSetup` un giro alla volta
```

- [ ] **Step 7: Verificare tipi e lint**

```bash
npm run format
npm run typecheck
npm run lint
```

Atteso: exit 0. Errori probabili: riferimenti residui a `pickerLap`/`setPendingLapId` in `SessionPanel.tsx`, oppure `LapRow` importato ma non più usato in `useSetupPicker.ts`.

- [ ] **Step 8: Smoke manuale**

```bash
npm run dev
```

Apri una sessione con almeno 6 giri (anche storica, dalla lista sessioni):

1. Seleziona 3 giri con le checkbox → compare "Assegna setup (3)".
2. Premi il pulsante → si apre la gestione setup → scegli un setup → "Usa questo setup". Il flash deve dire "Setup assegnato a 3 giri." e il badge setup deve cambiare su tutte e tre le righe.
3. Con più di 5 giri visibili, seleziona un giro in pagina 1, vai in pagina 2, selezionane un altro: il contatore deve dire 2.
4. "Seleziona tutti" nel thead: seleziona tutti i giri visibili; con selezione parziale la checkbox deve essere in stato indeterminato.
5. Attiva "Mostra non validi": i giri non validi entrano nella selezione possibile, il contatore resta coerente.
6. Dal pulsante di selezione premi "Assegna setup" e poi, nel modal, "Acquisisci screenshot" / "Carica da JSON": il setup appena creato deve finire su tutti i giri selezionati.
7. Clic sul badge setup di una singola riga: deve continuare a funzionare come prima (un solo giro).

- [ ] **Step 9: Verifica finale completa**

```bash
npm run format:check
npm run typecheck
npm run lint
npm run selfcheck
```

Tutti e quattro devono uscire con exit 0. `selfcheck` non copre queste feature (sono UI) ma deve restare verde: se fallisce, la regressione è altrove.

- [ ] **Step 10: Commit** *(chiedere conferma prima di eseguirlo)*

```bash
git add src/renderer/hooks/useSetupPicker.ts src/renderer/components/LapsTable.tsx src/renderer/components/SessionPanel.tsx src/renderer/styles/global.css src/renderer/CLAUDE.md docs/superpowers/specs/2026-08-11-gestione-setup-e-multiassegnazione-design.md
Set-Content -Path "$env:TEMP\commit-msg.txt" -Value "feat(laps): multiselezione dei giri e assegnazione setup in blocco"
git commit -F "$env:TEMP\commit-msg.txt"
```

---

## Note per chi esegue

- **`npm run rebuild:native` non serve** se non si tocca `package.json`: nessuna dipendenza nuova in questo piano.
- Se `npm run dev` mostra errori TypeScript, fermarsi e lanciare `npm run typecheck` per la lista completa prima di riavviare (vedi CLAUDE.md).
- L'hook `PostToolUse` in `.claude/settings.local.json` controlla lo stile a ogni Write/Edit: segnala `function`/`class`, import wildcard di FontAwesome e `process.env` in `src/renderer/`. I suoi messaggi citano un `CODE_STYLE.md` che non esiste — le regole vere sono in `CLAUDE.md` e `.claude/rules/project.md`.
