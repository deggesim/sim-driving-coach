# Delete Setup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permettere all'utente di eliminare un setup dalla cronologia storica nel modale "Gestione setup", con blocco se il setup è usato da almeno un giro.

**Architecture:** Nuovo IPC handler `session:deleteSetup` nel main process che verifica i giri prima di eliminare. Il renderer aggiorna store e lista locale dopo una eliminazione riuscita. La UI di conferma è inline per riga nel modale, senza modal aggiuntivi.

**Tech Stack:** Electron IPC, better-sqlite3, React + react-bootstrap, Zustand, TypeScript strict, FontAwesome.

---

## File modificati

| File                                              | Tipo                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `src/main/main.ts`                                | Modifica — aggiunge handler `session:deleteSetup`                                          |
| `src/preload/index.ts`                            | Modifica — espone `sessionDeleteSetup`                                                     |
| `src/shared/types.ts`                             | Modifica — aggiunge firma `sessionDeleteSetup` in `ElectronAPI` e `deleteSetup` in `State` |
| `src/renderer/store/sessionStore.ts`              | Modifica — aggiunge metodo `deleteSetup`                                                   |
| `src/renderer/components/AnalysisHeader.tsx`      | Modifica — rinomina label bottone                                                          |
| `src/renderer/components/SetupSelectionModal.tsx` | Modifica — aggiunge UI delete per riga                                                     |

---

## Task 1: IPC handler nel main process

**File:** `src/main/main.ts`

- [ ] **Step 1: Aggiungere handler `session:deleteSetup` dopo il handler `session:deleteAnalysis` (riga ~1276)**

  Inserire dopo la chiusura di `ipcMain.handle("session:deleteAnalysis", ...)`:

  ```ts
  ipcMain.handle(
    "session:deleteSetup",
    (_event, { id, game }: { id: number; game: GameSource }) => {
      const lapCountRow = db
        .prepare(
          `SELECT COUNT(*) AS cnt FROM ${t("laps", game)} WHERE setup_id = ?`,
        )
        .get(id) as { cnt: number };
      if (lapCountRow.cnt > 0) {
        return { ok: false, lapCount: lapCountRow.cnt };
      }
      db.prepare(`DELETE FROM ${t("session_setups", game)} WHERE id = ?`).run(
        id,
      );
      return { ok: true };
    },
  );
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  npm run typecheck
  ```

  Expected: nessun errore (i tipi verranno aggiornati nel Task 3).

---

## Task 2: Preload

**File:** `src/preload/index.ts`

- [ ] **Step 1: Aggiungere `sessionDeleteSetup` dopo `sessionDeleteAnalysis` (riga ~110)**

  Inserire dopo la riga `sessionDeleteAnalysis: ...`:

  ```ts
  sessionDeleteSetup: (params: { id: number; game: string }) =>
    ipcRenderer.invoke("session:deleteSetup", params),
  ```

---

## Task 3: Tipi condivisi

**File:** `src/shared/types.ts`

- [ ] **Step 1: Aggiungere firma `sessionDeleteSetup` in `ElectronAPI` dopo `sessionDeleteAnalysis` (riga ~482)**

  Inserire dopo:

  ```ts
  sessionDeleteAnalysis: (params: { id: number; game: GameSource }) =>
    Promise<void>;
  ```

  Aggiungere:

  ```ts
  sessionDeleteSetup: (params: { id: number; game: GameSource }) =>
    Promise<{ ok: true } | { ok: false; lapCount: number }>;
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  npm run typecheck
  ```

  Expected: nessun errore.

---

## Task 4: Metodo store

**File:** `src/renderer/store/sessionStore.ts`

- [ ] **Step 1: Aggiungere `deleteSetup` al tipo `State` (dopo `deleteAnalysis`)**

  Nel blocco `type State = { ... }`, dopo:

  ```ts
  deleteAnalysis: (id: number) => Promise<void>;
  ```

  Aggiungere:

  ```ts
  deleteSetup: (id: number, game: GameSource) =>
    Promise<{ ok: true } | { ok: false; lapCount: number }>;
  ```

- [ ] **Step 2: Implementare il metodo nello store (dopo `deleteAnalysis`)**

  Nel corpo di `create<State>((set, get) => ({ ... }))`, dopo l'implementazione di `deleteAnalysis`:

  ```ts
  deleteSetup: async (id, game) => {
    const res = await window.electronAPI.sessionDeleteSetup({ id, game });
    if (res.ok) {
      set({ setups: get().setups.filter((s) => s.id !== id) });
    }
    return res;
  },
  ```

- [ ] **Step 3: Typecheck**

  ```bash
  npm run typecheck
  ```

  Expected: nessun errore.

---

## Task 5: Rinomina label in AnalysisHeader

**File:** `src/renderer/components/AnalysisHeader.tsx`

- [ ] **Step 1: Cambiare il testo del bottone setup (riga ~152)**

  Trovare:

  ```tsx
  <FontAwesomeIcon icon={faGear} className="me-1" /> Carica setup
  ```

  Sostituire con:

  ```tsx
  <FontAwesomeIcon icon={faGear} className="me-1" /> Gestione setup
  ```

- [ ] **Step 2: Typecheck**

  ```bash
  npm run typecheck
  ```

  Expected: nessun errore.

---

## Task 6: UI delete in SetupSelectionModal

**File:** `src/renderer/components/SetupSelectionModal.tsx`

- [ ] **Step 1: Aggiornare gli import**

  Sostituire la riga degli import React:

  ```ts
  import { useEffect, useMemo, useState } from "react";
  ```

  Con:

  ```ts
  import { Fragment, useEffect, useMemo, useState } from "react";
  ```

  Sostituire la riga degli import FontAwesome icons:

  ```ts
  import { faCheck, faFileCode } from "@fortawesome/free-solid-svg-icons";
  ```

  Con:

  ```ts
  import {
    faCheck,
    faFileCode,
    faTrash,
  } from "@fortawesome/free-solid-svg-icons";
  ```

  Aggiungere dopo l'import di `GameSource, SessionSetupRow`:

  ```ts
  import { useSessionStore } from "../store/sessionStore";
  ```

- [ ] **Step 2: Aggiungere il tipo `DeleteState` e lo state locale**

  Dopo la funzione `formatDate`, prima di `const SetupSelectionModal = ...`, aggiungere:

  ```ts
  type DeleteState =
    | { phase: "idle" }
    | { phase: "confirm"; id: number }
    | { phase: "working"; id: number }
    | { phase: "error"; id: number; lapCount: number };
  ```

  All'interno di `SetupSelectionModal`, dopo `const [selectedId, setSelectedId] = useState<number | null>(null);`, aggiungere:

  ```ts
  const [deleteState, setDeleteState] = useState<DeleteState>({
    phase: "idle",
  });
  const deleteSetup = useSessionStore((s) => s.deleteSetup);
  ```

- [ ] **Step 3: Aggiungere reset di `deleteState` alla chiusura del modale**

  Nel `useEffect` esistente che dipende da `[show, car, track, layout, game]`, aggiungere il reset **prima** dell'early return — così scatta sia alla chiusura del modale che al cambio di auto/circuito:

  ```ts
  useEffect(() => {
    setDeleteState({ phase: "idle" });   // ← aggiunto (prima del return)
    if (!show || !car || !track) return;
    setLoading(true);
    window.electronAPI
      // ... resto invariato
  ```

- [ ] **Step 4: Aggiungere la funzione `handleDelete`**

  Dopo la riga `const setupById = useMemo(...)`, aggiungere:

  ```ts
  const handleDelete = async (id: number): Promise<void> => {
    setDeleteState({ phase: "working", id });
    const res = await deleteSetup(id, game);
    if (res.ok) {
      setHistory((prev) => prev.filter((r) => r.id !== id));
      setDeleteState({ phase: "idle" });
    } else {
      setDeleteState({ phase: "error", id, lapCount: res.lapCount });
    }
  };
  ```

- [ ] **Step 5: Aggiornare il titolo del modale**

  Trovare:

  ```tsx
  <Modal.Title style={{ fontSize: 16 }}>Carica setup</Modal.Title>
  ```

  Sostituire con:

  ```tsx
  <Modal.Title style={{ fontSize: 16 }}>Gestione setup</Modal.Title>
  ```

- [ ] **Step 6: Aggiornare l'header della tabella aggiungendo colonna azioni**

  Trovare:

  ```tsx
  <thead>
    <tr>
      <th>Nome setup</th>
      <th style={{ width: 160 }}>Data caricamento</th>
    </tr>
  </thead>
  ```

  Sostituire con:

  ```tsx
  <thead>
    <tr>
      <th>Nome setup</th>
      <th style={{ width: 160 }}>Data caricamento</th>
      <th style={{ width: 110 }}></th>
    </tr>
  </thead>
  ```

- [ ] **Step 7: Sostituire il corpo della tabella con la versione con delete**

  Trovare l'intero blocco `<tbody>...</tbody>` (da `{history.map((row) => {` a `</tbody>`) e sostituirlo con:

  ```tsx
  <tbody>
    {history.map((row) => {
      const displayName =
        row.setup.name ?? row.setup.carFound ?? `Setup #${row.id}`;
      const isConfirm =
        deleteState.phase === "confirm" && deleteState.id === row.id;
      const isWorking =
        deleteState.phase === "working" && deleteState.id === row.id;
      const errorForRow =
        deleteState.phase === "error" && deleteState.id === row.id
          ? deleteState
          : null;
      const isActive = isConfirm || isWorking || errorForRow != null;
      return (
        <Fragment key={row.id}>
          <tr
            className="sh-row"
            style={{ cursor: isActive ? "default" : "pointer" }}
            onClick={isActive ? undefined : () => setSelectedId(row.id)}
          >
            <td>
              {displayName}
              {row.setup.carVerified && (
                <Badge bg="success" className="ms-2" style={{ fontSize: 10 }}>
                  <FontAwesomeIcon icon={faCheck} className="me-1" />
                  verificato
                </Badge>
              )}
            </td>
            <td className="text-muted">{formatDate(row.loaded_at)}</td>
            <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
              {isConfirm && (
                <span className="d-flex gap-1 justify-content-end">
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(row.id);
                    }}
                  >
                    Elimina
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteState({ phase: "idle" });
                    }}
                  >
                    Annulla
                  </Button>
                </span>
              )}
              {isWorking && (
                <span className="d-flex gap-1 justify-content-end">
                  <Button size="sm" variant="danger" disabled>
                    <Spinner size="sm" />
                  </Button>
                  <Button size="sm" variant="secondary" disabled>
                    Annulla
                  </Button>
                </span>
              )}
              {errorForRow != null && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteState({ phase: "idle" });
                  }}
                >
                  Annulla
                </Button>
              )}
              {!isActive && (
                <Button
                  size="sm"
                  variant="outline-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteState({ phase: "confirm", id: row.id });
                  }}
                >
                  <FontAwesomeIcon icon={faTrash} />
                </Button>
              )}
            </td>
          </tr>
          {errorForRow != null && (
            <tr>
              <td
                colSpan={3}
                className="text-danger"
                style={{ fontSize: 12, paddingTop: 2, paddingBottom: 6 }}
              >
                Impossibile eliminare: {errorForRow.lapCount}{" "}
                {errorForRow.lapCount === 1 ? "giro usa" : "giri usano"} questo
                setup
              </td>
            </tr>
          )}
        </Fragment>
      );
    })}
  </tbody>
  ```

- [ ] **Step 8: Typecheck finale**

  ```bash
  npm run typecheck
  ```

  Expected: nessun errore.

- [ ] **Step 9: Commit**

  ```bash
  git add src/main/main.ts src/preload/index.ts src/shared/types.ts src/renderer/store/sessionStore.ts src/renderer/components/AnalysisHeader.tsx src/renderer/components/SetupSelectionModal.tsx
  git commit -m "feat: add setup deletion with in-use guard in Gestione setup modal"
  ```
