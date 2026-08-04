# Reader Reset via Badge Cliccabile — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendere cliccabile il badge "connesso" nella StatusBar per forzare un ciclo stop+start sul reader del simulatore corrispondente.

**Architecture:** Nuovo IPC handler `reader:reset` nel main process esegue `stop()` + `start()` sul reader specificato; gli handler `disconnected`/`connected` esistenti aggiornano automaticamente `activeGame` e chiamano `pushStatus()`. Il renderer espone `readerReset` via preload e lo chiama dal click sul badge.

**Tech Stack:** Electron IPC (`ipcMain.handle`), React + react-bootstrap (`Button`/`Badge`), TypeScript strict, Zustand (`ipcStore`).

---

## File modificati

| File | Modifica |
|------|----------|
| `src/main/main.ts` | Nuovo handler `ipcMain.handle("reader:reset", ...)` |
| `src/shared/types.ts` | Aggiunta `readerReset` a `ElectronAPI` |
| `src/preload/index.ts` | Esposizione `readerReset` via `contextBridge` |
| `src/renderer/components/StatusBar.tsx` | Prop `onResetReader`, badge connesso → `<Button>` |
| `src/renderer/App.tsx` | Passaggio `onResetReader` a `<StatusBar>` |

---

## Task 1: IPC handler `reader:reset` in main.ts

**Files:**
- Modify: `src/main/main.ts` (intorno a riga 898, dopo `ipcMain.handle("telemetry:getLogDir", ...)`)

- [ ] **Step 1: Aggiungere l'handler IPC**

Inserire subito dopo la riga 898 (`ipcMain.handle("telemetry:getLogDir", () => telemetryLogDir);`):

```ts
  ipcMain.handle(
    "reader:reset",
    (_event, { game }: { game: GameSource }) => {
      if (game === "r3e") {
        r3eReader.stop();
        setTimeout(() => r3eReader.start(), 150);
      } else {
        aceReader.stop();
        setTimeout(() => aceReader.start(), 150);
      }
    },
  );
```

`r3eReader` e `aceReader` sono già in scope a riga 620-621 di `main.ts` e la variabile `GameSource` è già importata. Il `stop()` emette `disconnected` → i listener esistenti (`r3eReader.on("disconnected", ...)` e `aceReader.on("disconnected", ...)`) aggiornano `activeGame` e chiamano `pushStatus()` automaticamente.

- [ ] **Step 2: Verificare typecheck**

```powershell
npm run typecheck
```

Expected: nessun errore nuovo.

- [ ] **Step 3: Commit**

```powershell
git add src/main/main.ts
git commit -m "feat: add reader:reset IPC handler for forced stop+start cycle"
```

---

## Task 2: Tipo `readerReset` in `ElectronAPI`

**Files:**
- Modify: `src/shared/types.ts` (intorno a riga 550, prima della chiusura di `ElectronAPI`)

- [ ] **Step 1: Aggiungere la firma a `ElectronAPI`**

In `src/shared/types.ts`, aggiungere prima di `};` che chiude `ElectronAPI` (riga 551):

```ts
  // Reader control
  readerReset: (game: GameSource) => Promise<void>;
```

Il blocco finale di `ElectronAPI` diventa:

```ts
  aceReadSetup: (params: { filePath: string }) => Promise<SetupData>;

  // Reader control
  readerReset: (game: GameSource) => Promise<void>;
};
```

- [ ] **Step 2: Verificare typecheck**

```powershell
npm run typecheck
```

Expected: errore su `preload/index.ts` perché `readerReset` non è ancora esposto (verrà risolto nel task successivo).

- [ ] **Step 3: Commit**

```powershell
git add src/shared/types.ts
git commit -m "feat: add readerReset to ElectronAPI type"
```

---

## Task 3: Esposizione `readerReset` nel preload

**Files:**
- Modify: `src/preload/index.ts` (ultima voce prima di `});`)

- [ ] **Step 1: Aggiungere l'esposizione nel contextBridge**

In `src/preload/index.ts`, aggiungere dopo la riga `aceReadSetup: (params: { filePath: string }) => ipcRenderer.invoke("ace:readSetup", params),` e prima di `});`:

```ts
  readerReset: (game: GameSource) =>
    ipcRenderer.invoke("reader:reset", { game }),
```

`GameSource` è già usato nel file tramite i tipi inferiti — non serve un import esplicito in preload (i tipi sono solo per la firma del contextBridge; il runtime non li usa). Verificare che il file compili senza import aggiuntivi.

- [ ] **Step 2: Verificare typecheck**

```powershell
npm run typecheck
```

Expected: nessun errore.

- [ ] **Step 3: Commit**

```powershell
git add src/preload/index.ts
git commit -m "feat: expose readerReset via contextBridge preload"
```

---

## Task 4: StatusBar — badge connesso → Button cliccabile

**Files:**
- Modify: `src/renderer/components/StatusBar.tsx`

- [ ] **Step 1: Aggiornare props e import**

Sostituire l'intero contenuto di `src/renderer/components/StatusBar.tsx` con:

```tsx
import { faMicrophone } from "@fortawesome/free-solid-svg-icons/faMicrophone";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { ReactNode } from "react";
import { Badge, Button } from "react-bootstrap";
import type { GameSource, GameStatus } from "../../shared/types";

type StatusBarProps = {
  status: GameStatus;
  onResetReader?: (game: GameSource) => void;
};

const StatusBar = ({ status, onResetReader }: StatusBarProps) => {
  const calibrationText: ReactNode = status.calibrating ? (
    `Calibrazione: ${status.lapsToCalibration} ${status.lapsToCalibration === 1 ? "giro rimanente" : "giri rimanenti"}`
  ) : (
    <>
      <FontAwesomeIcon icon={faMicrophone} /> Coach attivo
    </>
  );

  return (
    <div className="status-bar">
      {/* Connection - one badge per game */}
      <div className="d-flex align-items-center gap-1">
        {status.r3eConnected ? (
          <Button
            variant="success"
            size="sm"
            className="status-badge"
            title="Forza riconnessione R3E"
            onClick={() => onResetReader?.("r3e")}
          >
            R3E connesso
          </Button>
        ) : (
          <Badge bg="secondary" className="status-badge">
            R3E disconnesso
          </Badge>
        )}
        {status.aceConnected ? (
          <Button
            variant="success"
            size="sm"
            className="status-badge ms-1"
            title="Forza riconnessione ACE"
            onClick={() => onResetReader?.("ace")}
          >
            ACE connesso
          </Button>
        ) : (
          <Badge bg="secondary" className="status-badge ms-1">
            ACE disconnesso
          </Badge>
        )}
      </div>

      {/* Car / Track */}
      {status.car && (
        <div className="status-session">
          <span className="status-car">{status.car}</span>
          {status.track && (
            <>
              <span className="status-sep"> - </span>
              <span className="status-track">
                {status.track}
                {status.layout ? ` (${status.layout})` : ""}
              </span>
            </>
          )}
        </div>
      )}

      {/* Calibration / Active */}
      <div className="status-calibration">
        {status.connected ? calibrationText : "—"}
      </div>
    </div>
  );
};

export default StatusBar;
```

- [ ] **Step 2: Verificare che `.status-badge` esista già nel CSS**

```powershell
Select-String -Path "src\renderer\assets\global.css" -Pattern "status-badge"
```

Expected: almeno un match. Se `.status-badge` non imposta `border-radius` o `font-size` che confliggano con `<Button size="sm">`, non serve CSS aggiuntivo. Se il `<Button>` appare troppo alto rispetto al `<Badge>`, aggiungere in `global.css`:

```css
.status-bar .btn.status-badge {
  padding: 0.2em 0.5em;
  font-size: 0.75em;
  line-height: 1;
  border-radius: 0.375rem;
}
```

- [ ] **Step 3: Verificare typecheck**

```powershell
npm run typecheck
```

Expected: nessun errore (warning atteso su `onResetReader` opzionale non passato in `App.tsx` — risolto nel task 5).

- [ ] **Step 4: Commit**

```powershell
git add src/renderer/components/StatusBar.tsx
git commit -m "feat: make connected StatusBar badge a clickable reset button"
```

---

## Task 5: App.tsx — passare `onResetReader` a `<StatusBar>`

**Files:**
- Modify: `src/renderer/App.tsx` (riga 124)

- [ ] **Step 1: Aggiornare il mount di `<StatusBar>`**

In `src/renderer/App.tsx`, sostituire:

```tsx
      <StatusBar status={status} />
```

con:

```tsx
      <StatusBar
        status={status}
        onResetReader={(game) => window.electronAPI.readerReset(game)}
      />
```

- [ ] **Step 2: Verificare typecheck**

```powershell
npm run typecheck
```

Expected: nessun errore.

- [ ] **Step 3: Commit**

```powershell
git add src/renderer/App.tsx
git commit -m "feat: wire onResetReader in App.tsx to electronAPI.readerReset"
```

---

## Task 6: Verifica end-to-end in dev

- [ ] **Step 1: Avviare l'app in modalità dev**

```powershell
npm run dev
```

- [ ] **Step 2: Con R3E o ACE connesso, verificare che il badge diventi un pulsante**

Il badge verde "connesso" deve avere `cursor: pointer` all'hover e mostrare il tooltip "Forza riconnessione R3E" (o ACE).

- [ ] **Step 3: Cliccare il badge e verificare il comportamento**

1. Il badge passa brevemente a "disconnesso" (grigio) — conferma che `stop()` ha funzionato e `pushStatus()` è stato chiamato.
2. Dopo ~150ms il reader riparte il probe.
3. Se il simulatore è ancora aperto, il badge torna verde entro ~1s (tempo del probe SHM).
4. Se il simulatore è chiuso, il badge rimane grigio — comportamento corretto.

- [ ] **Step 4: Verificare che il badge disconnesso non sia cliccabile**

Il badge grigio "disconnesso" deve rendere visivamente non-interattivo (`cursor: default`, nessun hover effect).
