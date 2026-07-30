# Delete Setup — Design Spec

**Date:** 2026-06-11  
**Scope:** Aggiungere la possibilità di eliminare un setup dalla cronologia, sia per ACE che per R3E.

---

## Requisiti

- L'utente può eliminare un setup dalla lista cronologica nel modale "Gestione setup".
- Se il setup è referenziato da almeno un giro (`laps_*.setup_id = setup.id`), l'eliminazione è **bloccata** con messaggio esplicito.
- Il bottone "Carica setup" in `AnalysisHeader` viene rinominato "Gestione setup".
- Il comportamento vale identicamente per R3E e ACE (tabelle separate, stessa logica).

---

## Backend

### Nuovo IPC handler: `session:deleteSetup`

**Input:** `{ id: number, game: GameSource }`

**Logica:**

1. Conta i giri che referenziano il setup:
   ```sql
   SELECT COUNT(*) AS cnt FROM laps_<game> WHERE setup_id = ?
   ```
2. Se `cnt > 0`: ritorna `{ ok: false, lapCount: cnt }`
3. Se `cnt === 0`: esegue `DELETE FROM session_setups_<game> WHERE id = ?`, ritorna `{ ok: true }`

### Preload (`src/preload/index.ts`)

Aggiunta di:

```ts
sessionDeleteSetup: (params: { id: number; game: string }) =>
  ipcRenderer.invoke("session:deleteSetup", params),
```

### Tipo `ElectronAPI` (`src/shared/types.ts`)

```ts
sessionDeleteSetup: (params: { id: number; game: GameSource }) =>
  Promise<{ ok: true } | { ok: false; lapCount: number }>;
```

---

## Store

### `sessionStore.ts` — nuovo metodo `deleteSetup`

```ts
deleteSetup: async (id: number, game: GameSource) => {
  const res = await window.electronAPI.sessionDeleteSetup({ id, game });
  if (res.ok) {
    set({ setups: get().setups.filter((s) => s.id !== id) });
  }
  return res;
},
```

Aggiornare il tipo `State` con la firma del metodo.

---

## UI

### `AnalysisHeader.tsx`

Cambiare il testo del bottone da `"Carica setup"` a `"Gestione setup"`.

### `SetupSelectionModal.tsx`

**Stato locale aggiunto:**

```ts
type DeleteState =
  | { phase: "idle" }
  | { phase: "confirm"; id: number }
  | { phase: "error"; id: number; lapCount: number };

const [deleteState, setDeleteState] = useState<DeleteState>({ phase: "idle" });
```

**Per ogni riga della cronologia:**

- Stato `idle`: mostra icona cestino (`faTrash`) come `Button size="sm" variant="outline-danger"` allineato a destra. Click → `setDeleteState({ phase: "confirm", id: row.id })`.
- Stato `confirm` (solo sulla riga corrispondente): sostituisce i controlli normali con due bottoni inline `[Elimina] [Annulla]`. Click Elimina → chiama `deleteSetup(id, game)`:
  - Se `ok`: rimuove la riga dalla lista locale (`setHistory(prev => prev.filter(...))`), reset `deleteState`.
  - Se `!ok`: `setDeleteState({ phase: "error", id, lapCount })`.
- Stato `error` (sulla riga corrispondente): mostra testo rosso sotto la riga: `"Impossibile eliminare: {lapCount} giri usano questo setup"`, con solo bottone `[Annulla]`.

**Interazione con la riga:**

- Il click sulla riga (che apre `SetupDetailModal`) è gestito sulla cella del nome/data, non sull'intera riga `<tr>`, così l'icona cestino non propaga.
- Quando `deleteState.phase !== "idle"` per una riga, il click sulla riga per aprire il dettaglio è disabilitato per quella riga.

---

## Cosa NON cambia

- `SetupDetailModal`: nessun bottone di eliminazione (il delete è solo nella lista cronologica).
- `AceSetupPicker`, `R3eSetupPicker`: invariati.
- Cascading delete su sessione: invariato (già implementato via `ON DELETE CASCADE`).
- La lista `setups` nel store per la sessione corrente viene aggiornata localmente dopo il delete, senza refetch.

---

## File modificati

| File                                              | Tipo modifica                                       |
| ------------------------------------------------- | --------------------------------------------------- |
| `src/main/main.ts`                                | Nuovo handler `session:deleteSetup`                 |
| `src/preload/index.ts`                            | Nuovo metodo `sessionDeleteSetup`                   |
| `src/shared/types.ts`                             | Aggiunta firma in `ElectronAPI` + metodo in `State` |
| `src/renderer/store/sessionStore.ts`              | Nuovo metodo `deleteSetup`                          |
| `src/renderer/components/SetupSelectionModal.tsx` | Cestino + stati confirm/error per riga              |
| `src/renderer/components/AnalysisHeader.tsx`      | Label bottone                                       |
