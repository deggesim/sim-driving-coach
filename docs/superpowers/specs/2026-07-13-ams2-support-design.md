# Supporto Automobilista 2 (AMS2) — Design

Data: 2026-07-13
Branch di partenza: `analysis-integration`

## Obiettivo

Aggiungere **Automobilista 2** come terzo gioco supportato, accanto a R3E e ACE,
riusando l'intera pipeline coach/analisi tramite l'astrazione `GameFrame`.
AMS2 deve comportarsi come gli altri giochi: sessioni, giri, analisi Claude,
PDF, voice coach, grafici telemetria e track map.

## Fatti accertati (esplorazione)

- **AMS2 usa il motore Project CARS 2.** Memoria condivisa: **una sola** pagina
  memory-mapped `$pcars2$`, struct unica `SharedMemory`, `mVersion == 14`.
  Fonte: `…/Automobilista 2/Support/SharedMemory/AMS2_SharedMemoryExampleApp/`
  (`SharedMemory.h`, `App.cpp`).
- **Letture atomiche via `mSequenceNumber`**: dispari = scrittura in corso
  (scarta), pari = stabile. Dopo la copia si ri-verifica che il numero non sia
  cambiato (pattern del sample `App.cpp`).
- **Setup NON decodificabili.** I file `.vts`
  (`D:\Documenti\Automobilista 2\savegame\<steamid>\automobilista 2\vehiclesetups_1_6\`)
  sono cifrati: entropia 7.92/8 bit, tutti i 256 valori di byte presenti,
  nessun magic di compressione. → si usa il flusso a screenshot (vedi §5).
- **Screenshot Steam AMS2**: appid **1066890** →
  `Steam/userdata/<steamid>/760/remote/1066890/screenshots`. La cartella viene
  creata da Steam al primo F12 (attualmente assente). Un solo account userdata
  presente (`11234306`) → lo steamid si auto-rileva.
- **AMS2 è più ricco di ACE**: espone tempi di settore reali, `lapDistance`
  diretta, world position, brake temps già in °C, nomi auto/pista leggibili
  (`mCarName`, `mCarClassName`, `mTrackLocation`+`mTrackVariation`) →
  **nessun data-loader** come R3E; identificatori string come ACE.

## Decisioni

1. **Modello Vision setup**: costante dedicata `claude-sonnet-5`, separata dal
   modello coach (haiku), perché il decode dei valori numerici da schermata
   richiede accuratezza. Il coach resta invariato.
2. **Picker a screenshot solo per AMS2.** R3E resta su JSON incollato, ACE su
   file `.carsetup`. Ogni gioco mantiene il suo metodo nativo.

## Architettura

### 1. Tipo cardine e schema DB

- `src/shared/types.ts`: `GameSource = "r3e" | "ace"` → `"r3e" | "ace" | "ams2"`.
- `src/main/db/db.ts`: aggiungere il set completo di tabelle `*_ams2`
  (`sessions_ams2`, `session_setups_ams2`, `laps_ams2`, `session_analyses_ams2`,
  `track_maps_ams2`, `baseline_ams2`, `baseline_tc_zones_ams2`,
  `baseline_abs_zones_ams2`, `corner_names_ams2`) + indici + le stesse migration
  (`leaderboard_mode`, `fixed_setup`, `comments_json`) applicate a R3E/ACE.
- **Bug latente da correggere**: i ternari a 2 vie in `db.ts`
  (`game === "r3e" ? corner_names_r3e : corner_names_ace` e l'analogo per
  `track_maps_*`) mappano silenziosamente `ams2` → tabella ACE. Sostituirli con
  interpolazione `corner_names_${game}` / `track_maps_${game}` (coerente con
  `tableFor()` in `setup-row.ts`).

### 2. Reader — `src/main/ams2/` (nuovo, pattern ACE)

- **`ams2-struct.ts`**: offset della struct pCARS2 v14 (Pack=4), read helper
  (riuso di `readInt32`/`readFloat`/`readUint8`/`readString`/`readFloatArray`,
  eventualmente estratti in un modulo condiviso o duplicati come per ACE).
  - Costanti: `AMS2_SHM_NAME = "$pcars2$"`, `AMS2_VERSION = 14`,
    `AMS2_STRUCT_SIZE` (sizeof calcolato), enum tyre order FL/FR/RL/RR,
    bit `mCarFlags` (CAR_ABS=1<<4, CAR_TCS=1<<6).
  - `ParticipantInfo` = 100 byte (bool+char[64]+float[3]+float+uint×3+int con
    padding Pack=4); array a 64 elementi. Il player è
    `mParticipantInfo[mViewedParticipantIndex]` per lapDistance / world-pos /
    lap / settore. Il resto del fisico (speed, brake, throttle, tyre/brake
    temps, rpm, gear) è top-level.
  - Gli offset **vanno verificati empiricamente** alla prima connessione
    (§Struct Offset Debugging del CLAUDE.md): validare `mVersion==14` e valori
    plausibili di speed/lapDistance/nome auto nei log.
- **`ams2-reader.ts`**: `createAms2Reader()` — EventEmitter, poll 16ms via
  koffi+kernel32 (stesso wrapper di ACE), doppia lettura su `mSequenceNumber`,
  rilevamento SHM stale (sequence congelato). Mock su non-Windows.
  - Emette: `connected`, `disconnected`, `ams2:frame` (`GameFrame`),
    `ams2:fullFrame` (telemetria estesa), `lapComplete` (`LapRecord`).
  - `getSessionInfo()` → `{ car, track, layout, trackLength }`.
    `layout` = `mTrackVariation` (o `mTrackLocation` se variation vuota).
  - Lap completo via incremento `mParticipantInfo[viewed].mLapsCompleted`;
    `lapTime` da `mLastLapTime`, `sectorTimes` da
    `mCurrentSector1/2/3Time` (disponibili, a differenza di ACE), `valid` da
    `!mLapInvalidated`. World-pos per frame per track map.
  - `GameFrame`: `lapDistance` (diretta), `absActive` da `mAntiLockActive`,
    `tcActive` **approssimato** (bit `CAR_TCS` + euristica su throttle/slip —
    AMS2 non espone un flag "TC taglia ora"; documentare con commento
    `ponytail:` e la via di upgrade), `brakeTemp*` da `mBrakeTempCelsius[4]`.
  - Speed `mSpeed` è m/s → ×3.6 per km/h nel `CompactFrame`.

### 3. Wiring — `src/main/main.ts`

- Istanziare `createAms2Reader()` come terzo reader in parallelo; ref globale.
- Handler `connected`/`disconnected` con priorità `activeGame` a 3 vie;
  `ams2:frame` (zoneTracker + ruleEngine + push `session:frame`),
  `ams2:fullFrame` (telemetria gating), `lapComplete` via `handleLapComplete`.
- `resolveNames("ams2", …)` = identità (stringhe già leggibili).
- `readerReset` esteso ad ams2.

### 4. Setup AMS2 = flusso screenshot (reintrodotto da git `465e719^`)

- **`src/renderer/components/Ams2SetupPicker.tsx`**: basato sul vecchio
  `ScreenshotPicker.tsx`. Fasi pick → confirm-duplicates → decoding → verify.
  Punta all'appid **1066890**, **steamid auto-rilevato** (glob dell'unica
  cartella `userdata/*`). Gestisce cartella screenshot assente (ritorna lista
  vuota con messaggio, come già faceva su errore `readdir`).
- **IPC reintrodotti** in `main.ts` + `preload` + `ElectronAPI`:
  - `setup:listScreenshots` → thumbnail base64 + annotazione "già usato" da
    `session_setups_ams2`.
  - `setup:decodeSetup` → Claude Vision (`claude-sonnet-5`) → `SetupData`
    (`carVerified`, `carFound`, `setupText`, `params[]`, `screenshots[]`).
    System prompt aggiornato per AMS2.
- **`SetupSelectionModal.tsx`**: sul ramo `game === "ams2"` apre
  `Ams2SetupPicker` (invece di R3e/Ace picker). La tab "storico setup" resta
  invariata (riuso via `sessionGetSetupHistory`/`sessionReuseSetup`).
- `SetupData.screenshots` e la colonna `setup_screenshots` sono già presenti:
  nessuna migration nuova per il setup.

### 5. Renderer — altri punti

- `SettingsPanel.tsx`: selettore `activeGame` → aggiungere opzione AMS2.
- `SessionHistory.tsx`: colonna/filtro "Sim" + label/icona AMS2.
- `StatusBar.tsx`: label gioco AMS2.
- `mocks/mockData.ts`: una `MOCK_SESSIONS` AMS2 + relativo `MOCK_DETAILS`.
- `settingsStore.ts`: `activeGame` già `GameSource`; nessun cambto strutturale.

## Flusso dati

```
$pcars2$ (SHM) → Ams2Reader (poll 16ms, seq-number read)
   ├─ ams2:frame → GameFrame → ZoneTracker → RuleEngine → Alert/TTS
   ├─ ams2:fullFrame → telemetry log (se attivo)
   └─ lapComplete → LapRecorder → AdaptiveBaseline / TrackMapBuilder → SQLite (*_ams2)

[Utente] "Carica setup" (AMS2) → Ams2SetupPicker → setup:listScreenshots
   → seleziona F12 → setup:decodeSetup (Claude Vision Sonnet 5) → SetupData
   → sessionLoadSetup → session_setups_ams2

[Utente] "Esegui analisi" → SessionCoachEngine (tableFor game-agnostic) → Claude → session_analyses_ams2
```

## Verifica

- `npm run typecheck` e `npm run lint` puliti.
- Reader offset: log alla prima connessione (mVersion, speed, lapDistance, nome
  auto/pista) confrontati con l'HUD in-game — come da §Struct Offset Debugging.
- Mock mode: sessione AMS2 visibile in SessionHistory e SessionDetail senza
  gioco attivo.
- Un self-check runnabile per `ParticipantInfo` size / offset chiave (assert su
  `AMS2_STRUCT_SIZE` e su un buffer di esempio) — piccolo, senza framework.

## Fuori scope (YAGNI)

- Decodifica dei file `.vts` (cifrati, nessun metodo pubblico).
- Setup a screenshot per R3E/ACE (mantengono i metodi nativi).
- Dati multi-partecipante oltre al player osservato (`mViewedParticipantIndex`).
- Campi AMS2 extra non usati dal coach (DRS, ERS, clutch temp, meteo).

## Rischi / note aperte

- **Offset struct**: da validare empiricamente; i campi v10 in coda
  (tyre temp L/C/R, ABS/TCS settings) richiedono di leggere l'intera struct
  (~28–30 KB). I campi essenziali del coach (brake/tyre temp, lapDistance) sono
  a metà struct.
- **`tcActive`**: nessun flag "TC attivo ora" in AMS2 → euristica documentata.
- **Screenshot F12**: dipende dall'utente che cattura le schermate del setup in
  AMS2; senza screenshot la sessione resta senza setup (comportamento valido).
