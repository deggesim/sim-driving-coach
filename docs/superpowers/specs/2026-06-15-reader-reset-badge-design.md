# Design: Reset reader via badge cliccabile nella StatusBar

**Data:** 2026-06-15
**Stato:** Approvato

## Problema

Quando l'utente cambia simulatore, il reader del vecchio simulatore può rimanere in stato "connesso" (shared memory ancora aperta). Il badge nella StatusBar mostra entrambi i reader come verdi senza offrire un modo per forzare la riconnessione.

## Soluzione

Rendere cliccabile il badge di stato solo quando il reader corrispondente è connesso. Il click forza un ciclo `stop()` + `start()` sul reader, che emette `disconnected` (aggiornando lo stato e `activeGame`) e riprende il probe.

## Comportamento

- **Badge connesso** → cliccabile, tooltip "Forza riconnessione", cursor pointer. Click → `reader:reset` IPC.
- **Badge disconnesso** → non cliccabile, visivamente invariato.

## Architettura

### 1. IPC — `main.ts`

Nuovo handler `reader:reset`:

```ts
ipcMain.handle("reader:reset", (_, { game }: { game: GameSource }) => {
  const reader = game === "r3e" ? r3eReader : aceReader;
  reader.stop();
  setTimeout(() => reader.start(), 150);
});
```

- `stop()` emette `disconnected` → gli handler esistenti aggiornano `activeGame` e chiamano `pushStatus()`.
- `start()` dopo 150ms riprende il probe SHM; se il simulatore è ancora in esecuzione, riemette `connected`.
- Nessuna nuova logica di stato necessaria.

### 2. Tipi — `src/shared/types.ts`

Aggiunta a `ElectronAPI`:

```ts
readerReset: (game: GameSource) => Promise<void>;
```

### 3. Preload — `src/preload/index.ts`

```ts
readerReset: (game: GameSource) => ipcRenderer.invoke('reader:reset', { game }),
```

### 4. UI — `src/renderer/components/StatusBar.tsx`

Nuova prop:

```ts
type StatusBarProps = {
  status: GameStatus;
  onResetReader?: (game: GameSource) => void;
};
```

Badge connesso → `<Button variant="success" size="sm" className="status-badge" title="Forza riconnessione">`.
Badge disconnesso → `<Badge bg="secondary" className="status-badge">` (invariato).

### 5. Chiamante — `App.tsx` (o dove viene montato `StatusBar`)

```ts
<StatusBar
  status={status}
  onResetReader={(game) => window.electronAPI.readerReset(game)}
/>
```

## Fuori scope

- Nessuna modifica alla logica di `activeGame` (gestita dagli handler `connected`/`disconnected` esistenti).
- Nessun nuovo canale push (il feedback arriva da `onStatus` già sottoscritto).
- Nessun click sul badge disconnesso (i reader hanno già auto-probe ogni ~1s).
