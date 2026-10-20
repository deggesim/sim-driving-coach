# Diagnosi pressioni gomme da temperatura superficiale — design

Data: 2026-10-20 · Stato: bozza da approvare · Fonte: video di Riccardo Frezza (AMS2, Porsche 911 GT1 a Interlagos), trascrizione in `Trascrizione_ripulita.txt`.

## Obiettivo

Portare nell'analisi sintetica (Livello 1) e approfondita (Livello 2) un suggerimento di pressione gomme basato sul metodo del video, per R3E, ACE e AMS2: la pressione è giusta quando la temperatura **centrale** del battistrada sta a metà tra le due spalle. Il suggerimento deve citare un numero calcolato in TypeScript, come tutti gli altri nel blocco "## Dati Calcolati".

Successo = su una sessione con gomme in temperatura, l'analisi propone (o esclude) un cambio di pressione per ruota con il Δ che lo giustifica, e lo fa nelle unità del gioco, sul valore **a freddo** del setup.

## Il criterio

`Δ = T_centro − (T_spalla1 + T_spalla2) / 2`, per ruota.

- Δ > +tol → pressione alta (il centro è più caldo delle spalle).
- Δ < −tol → pressione bassa.
- |Δ| ≤ tol → nella finestra.

Equivale a "centro a metà" del video, ma non dipende dall'orientamento interna/esterna o sinistra/destra, che le tre API definiscono ciascuna a modo suo. La frase del video "centro vicino alla spalla esterna = bassa" vale solo quando l'esterna è la spalla più fredda.

**Tolleranza**: `TYRE_BALANCE_TOL_C = 1.0` come punto di partenza. Unico dato disponibile: negli esempi a gomme ancora fredde Frezza chiama "bassa" un Δ di circa −1…−1,5°C. Non è validata su sessioni vere: costante unica da tarare.

## Cosa dice il video, e dove finisce

| Regola del video | Dove la applichiamo |
| --- | --- |
| Prima bilanciamento freni, poi condotti, poi pressioni | Prompt L1 e L2: se le temperature freni (già nel blocco dati) sono fuori da 413–688°C, la prima azione è sui freni e le pressioni sono dichiarate "dopo" |
| Non un valore unico: una finestra min–max | Lo stato è alta / ok / bassa, mai "valore ideale" |
| Anteriore/posteriore e sx/dx indipendenti | Δ e stato per ruota |
| Gomme non in temperatura falsano la diagnosi | Esclusi dal calcolo il primo giro di ogni segmento-setup e i giri non validi |
| Ritmo lento = pressioni salgono; conta la temperatura asfalto | Deriva primo→ultimo giro nel blocco dati; avvertenza nel prompt L2; `at`/`rt` già presenti per ACE e AMS2 |
| Pressioni a gomma calda vs setup | Telemetria = caldo, setup = freddo: le proposte modificano il freddo |

## Dati: tre canali nuovi (scelta B)

`CompactFrame` guadagna tre quartetti opzionali `[FL, FR, RL, RR]` in °C: `ttl`, `ttc`, `ttr` (spalla A, centro, spalla B). `tt` resta com'è, perché le analisi esistenti lo citano.

| Canale | R3E | ACE (PhysicsEvo) | AMS2 |
| --- | --- | --- | --- |
| `ttl` | `TireTemp_*_Left` | `tyreTempI` @368 | `mTyreTempLeft` @20328 |
| `ttc` | `TireTemp_*_Center` | `tyreTempM` @384 | `mTyreTempCenter` @20344 |
| `ttr` | `TireTemp_*_Right` | `tyreTempO` @400 | `mTyreTempRight` @20360 |

- `ttl`/`ttr` non hanno significato fisico di lato: si usano solo la media e la differenza simmetrica. Il commento del tipo lo dice.
- ACE: `tt` continua a essere `tyreCoreTemperature` (nucleo); `ttc` è la temperatura **superficiale** centrale. Per R3E `ttc` coincide con `tt`.
- R3E: `-1` = N/A come per le altre grandezze; il quartetto si scarta se una ruota legge `< 0` (stessa regola di `tt`).
- AMS2: gli offset sono calcolati camminando `SharedMemory.h` v14 (CREST2-AMS2) da `mAirPressure` = 7372, con `STORED_PARTICIPANTS_MAX=64`, `STRING_LENGTH_MAX=64`, `TYRE_COMPOUND_NAME_LENGTH_MAX=40`. `UNSET = 0.0f`: un quartetto a zero è trattato come assente (`meanChannel` lo fa già).
- **Gli offset ACE e AMS2 non sono verificati su un sim acceso.** Il selfcheck asserisce solo l'aritmetica (spaziatura di 16 byte, dentro la struct). La conferma è la riga `[ACE]`/`[AMS2] canali` di `channel-log`, estesa con `ttl/ttc/ttr`.
- Costo: 12 float in più per frame in `frames_blob`. Va misurata la dimensione del blob di un giro prima/dopo; se l'aumento è significativo si arrotonda a 0,1°C in scrittura.

`ZoneData` guadagna `avgTyreTempLeftC`, `avgTyreTempCenterC`, `avgTyreTempRightC` (quartetti, presenti solo se il canale c'era). `aggregateZones` li calcola con lo stesso `quartet()` per canale già usato per `tt`, estendendo il tipo di chiave.

## Statistiche (`session-stats.ts`)

Nuovo campo `tyreDiagnosis: TyreDiagnosis | null` in `SessionStats`.

- Giri inclusi: validi, esclusi il primo giro di ogni segmento-setup (un segmento = giri consecutivi con lo stesso `setup_id`). Se restano meno di 2 giri → `null`.
- Per ruota, su tutte le zone dei giri inclusi: pressione media a caldo (PSI, come `tp`), Δ medio, stato, giri nello stato non-ok sul totale, deriva di pressione primo→ultimo giro incluso (solo con ≥ 3 giri).
- Con ≥ 2 setup (`setup_id` distinti) tra i giri inclusi: pressione e Δ medi **per setup**, per ruota.
- Calcolo solo in TS; il modello cita, non ricalcola.
- Non incluso, come upgrade: stima per interpolazione della pressione a Δ = 0 e della finestra da due setup (`// ponytail:` nel codice). Con due soli punti è fragile, e il modello non deve fare l'aritmetica.

## Prompt (`prompt-builder.ts`)

`buildStatsBlock` stampa, dopo le asimmetrie, il blocco "Diagnosi pressioni gomme" con la stessa forma per-ruota delle altre righe (`(WHEEL_ORDER) …`), unità da `pressureUnit(game)` (bar per AMS2):

```
- Diagnosi pressioni gomme (Δ = centro − media spalle; soglia ±1.0°C; N giri, primo giro di ogni setup escluso):
    (ANT-SX/ANT-DX/POST-SX/POST-DX) press. a caldo 27.1/27.3/26.0/26.2 PSI | Δ +3.4/+3.1/-0.2/+0.1 °C | stato alta/alta/ok/ok | giri non ok 5/6, 5/6, 0/6, 1/6 | deriva +0.4/+0.3/0.0/+0.1 PSI
    Setup "A": … | Setup "B": …
```

- **Leaderboard**: il blocco non viene emesso (gomme fisse a 85°C). `buildStatsBlock` riceve il flag dal chiamante, che già lo ha in `SessionPromptInput`.
- **Setup Fisso**: nessun codice nuovo, perché la riga "ometti le raccomandazioni di setup" già lo copre; il blocco resta come informazione.
- **Livello 1** (`SYNTHESIS_SYSTEM_PROMPT`): una riga di regola — una ruota con stato non-ok su una maggioranza di giri è un candidato per "Setup — Pressione XX: A → B"; cita il Δ; una sola azione pressioni; asse anteriore e posteriore valutati a parte; se i freni sono fuori finestra la prima azione è sui freni. Passo di partenza ≈ 0,05 bar: 0,05 bar (AMS2), 0,7 PSI (ACE), 5 kPa (R3E) — dalla larghezza della finestra nel video (1,80–1,90 bar su una sola auto), quindi indicativo.
- **Livello 2** (`SESSION_SYSTEM_PROMPT`): "Osservazioni pressioni gomme" diventa una tabella per ruota (Δ, stato, deriva, per setup se presenti) con le avvertenze su ritmo e asfalto; "Setup attuale vs proposto" usa i valori a freddo del setup e la direzione dal Δ. Solo sottosezioni `####` interne, nessun nuovo `##` (vincolo di `prompt-builder.selfcheck.ts`).
- Il testo vocale (`<sintesi-vocale>`) non cambia.

## Fuori scope

- Alert vocali in tempo reale sulle pressioni: la diagnosi richiede una media su uno stint.
- Diagnosi del camber dalla differenza tra le spalle: i dati ci sono con B, ma il criterio non è nel video.
- Uso di `Optimal/Cold/Hot` di R3E per decidere se le gomme sono in temperatura.
- Il campo ACE `f6.f1` ("pressioni raw incerte"): non lo si usa.

## File toccati

`src/shared/types.ts`, `src/main/r3e/r3e-reader.ts`, `src/main/ace/ace-struct.ts` + `ace-reader.ts`, `src/main/ams2/ams2-struct.ts` + `ams2-reader.ts`, `src/main/channel-log.ts`, `src/main/lap-recorder.ts`, `src/main/coach/session-stats.ts`, `src/main/coach/prompt-builder.ts`, i relativi `*.selfcheck.ts`, la tabella di copertura in `src/main/CLAUDE.md` e la descrizione di `types.ts` in `src/shared/CLAUDE.md`.

## Verifica

- `*.selfcheck.ts`: classificazione e soglia del Δ, esclusione del primo giro per segmento-setup, per-setup, `null` sotto 2 giri; `channel-log` con i tre canali; `ams2-struct` con la spaziatura degli offset; `prompt-builder` con blocco presente solo con dati, assente in Leaderboard, e gerarchia `##` invariata.
- Gate completo: `npm run typecheck && npm run lint && npm run format:check && npm run selfcheck && npm run fallow:check`.
- **Fuori dal gate, da fare con i sim accesi**: leggere la riga `canali` di ACE e AMS2 e controllare che `ttl/ttc/ttr` siano numeri plausibili (decine di °C, non "zeri"), poi una sessione reale per tarare `TYRE_BALANCE_TOL_C`.

## Ordine di implementazione

1. Tipi + `lap-recorder` + `channel-log` (campi opzionali, nessuna rottura).
2. Reader ×3 con i rispettivi struct.
3. `session-stats`.
4. `prompt-builder` (blocco e due system prompt).
5. Documentazione.

Ogni passo compila da solo: i campi nuovi sono opzionali, non c'è nessuna union da estendere.
