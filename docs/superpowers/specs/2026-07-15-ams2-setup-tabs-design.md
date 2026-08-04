# AMS2 setup — vista a 3 tab (Tyres/Brakes/Chassis · Suspension · Drivetrain)

**Data:** 2026-07-15
**Stato:** approvato (design) — pronto per la pianificazione

## Contesto e problema

I setup AMS2 vengono decodificati dagli screenshot via Claude Vision (`setup:decodeSetup` in `main.ts`) in una `SetupData` con `params: SetupParam[]` (`{ category, parameter, value }`). Oggi:

- Il prompt Vision assegna una `category` **libera**, non standardizzata.
- La fase *verify* di `Ams2SetupPicker` mostra una tabella piatta a 3 colonne (Categoria | Parametro | Valore).
- `SetupDetailModal` per AMS2 cade nel ramo `else` e usa **`R3eSetupTabs`** (categorie R3E ≠ AMS2 → raggruppamento errato).

Obiettivo: mostrare i setup AMS2 in **3 tab che rispecchiano le schermate di gioco**, ciascuno suddiviso in sezioni, sia nel dettaglio (storico/riuso) sia nell'anteprima subito dopo il decode.

## Obiettivi

- Vista a 3 tab per i setup AMS2, con sezioni fisse.
- Categorie deterministiche prodotte dal decode Vision (vocabolario fisso).
- Fallback robusto per setup già salvati (categorie vecchie) e per drift del modello.
- Riuso del pattern e dello stile esistenti (`AceSetupTabs`, classi CSS `setup-*`).

## Non obiettivi

- Ri-decodificare automaticamente i setup AMS2 già salvati (resteranno nella sezione "Altro" finché non ri-decodificati manualmente).
- Modifiche a `prompt-builder`/`pdf-generator` (consumano i params in modo generico; le categorie standardizzate non li rompono).
- Toccare la vista dei setup R3E o ACE (a parte l'estrazione di primitive condivise, invariante nel comportamento).

## Struttura tab → sezioni

Tab (etichette in inglese, *come gli screenshot*), sezioni (in italiano):

| Tab | Sezione (categoria) | Rendering |
|---|---|---|
| **Tyres/Brakes/Chassis** | `Gomme` (per-angolo) | griglia 4-ruote, header "Gomme" |
| | `Freni` | tabella piatta |
| | `Chassis` | tabella piatta |
| | `Altro` (fallback) | tabella piatta (solo se presente) |
| **Suspension** | `Sospensioni` (per-angolo) | griglia 4-ruote, header "Sospensioni" |
| | `Anteriore` | tabella piatta |
| | `Posteriore` | tabella piatta |
| | `Sospensioni attive` | tabella piatta |
| **Drivetrain** | `Motore/Elettronica` | tabella piatta |
| | `Rapporti del cambio` | tabella piatta |
| | `Differenziale` | tabella piatta |

- Un tab viene renderizzato solo se ha almeno un parametro; idem per ogni sezione (come `AceSetupTabs`).
- Le sezioni per-angolo (`Gomme`, `Sospensioni`) usano la griglia 4-ruote: le ruote FL/FR/RL/RR sono già visibili nella griglia, quindi l'header di sezione è "Gomme"/"Sospensioni".
- `Altro` cattura ogni categoria fuori dall'elenco fisso (setup vecchi con categorie libere, o drift Vision) e appare in coda al primo tab.

## Design

### 1. Prompt Vision (`main.ts`, handler `setup:decodeSetup`)

Vincolo il campo `category` all'elenco fisso e impongo il suffisso ruota sui parametri per-angolo (stessa convenzione di ACE — regex `\s(FL|FR|RL|RR)(\s|$)`).

Aggiunta al `systemPrompt`:

```
Per ogni parametro assegna "category" ESATTAMENTE uno di questi valori:
- "Gomme": parametri gomma per singola ruota (pressioni, ecc.)
- "Freni": pressione/bilanciamento freni, condotti freni
- "Chassis": parametri telaio non per-ruota (zavorra, ripartizione pesi, sterzo)
- "Sospensioni": parametri sospensione per singola ruota (altezza, molla, camber,
  convergenza, ammortizzatori bump/rebound, ecc.)
- "Anteriore": parametri sospensione assale anteriore non per-ruota (es. barra antirollio ant.)
- "Posteriore": parametri sospensione assale posteriore non per-ruota (es. barra antirollio post.)
- "Sospensioni attive": parametri di sospensione attiva, se presenti
- "Motore/Elettronica": mappa motore, freno motore, boost, TC, ABS, ecc.
- "Rapporti del cambio": rapporto finale e singole marce
- "Differenziale": precarico, rampe power/coast, dischi, differenziale ant./post.
Per i parametri per singola ruota (category "Gomme" e "Sospensioni") crea un
parametro per ruota e aggiungi il codice ruota in fondo al nome: " FL", " FR",
" RL", " RR" (es. "Pressione FL"). Non usare altre categorie.
```

`max_tokens` resta 4000; da tenere d'occhio: l'espansione per-ruota aumenta il numero di righe — se compaiono troncamenti alzare a ~6000. `thinking: disabled` invariato.

### 2. Primitive condivise — `SetupTabsCommon.tsx` (nuovo)

Estraggo da `AceSetupTabs.tsx`, invariati:

- `WHEEL_KEYS`, `WHEEL_LABELS`, `WheelKey`
- `getWheelKey(parameter)`, `stripWheelSuffix(parameter)`
- `ParamTable` (tabella label/valore)
- `FourCornerGrid` (griglia FL/FR/RL/RR + blocco "shared" per i non-per-ruota)

`AceSetupTabs.tsx` viene rifattorizzato per importarle (nessun cambio di comportamento: mossa pura, verificata da `typecheck`). `AceSetupTabs` mantiene il suo `SuspensionTab` specifico ACE.

### 3. Nuovo componente — `Ams2SetupTabs.tsx`

- `AMS2_TAB_ORDER = ["Tyres/Brakes/Chassis", "Suspension", "Drivetrain"]`.
- `SECTION_TO_TAB`: mappa categoria → tab (le categorie non note → "Altro" nel primo tab).
- `TAB_SECTIONS`: per ogni tab, l'ordine delle sezioni.
- Raggruppa i `params` per sezione (match esatto su `category` normalizzato con `trim`; il resto → "Altro").
- Rende `Nav` tabs (solo i tab con params) + corpo: sezioni con titolo; `Gomme`/`Sospensioni` → `FourCornerGrid`, le altre → `ParamTable`.
- Prop identica ad `AceSetupTabs`: `{ params: SetupParam[] }`. `export default`.

### 4. Wiring

- `SetupDetailModal.tsx`: aggiungo il ramo `game === "ams2" → <Ams2SetupTabs params={row.setup.params} />` (oggi cade su `R3eSetupTabs`). Resta: `ace → AceSetupTabs`, altrimenti `R3eSetupTabs`.
- `Ams2SetupPicker.tsx` (fase *verify*): sostituisco la tabella piatta (`decodedSetup.params` → `<table>`) con `<Ams2SetupTabs params={decodedSetup.params} />`.

### 5. CSS

Riuso delle classi `setup-*` esistenti (`setup-nav-tabs`, `setup-tab-body`, `setup-tab-table`, `setup-value`, `setup-axle-col`, `setup-subsection-title`, `setup-subsection-title` per gli header di sezione). Nessuna nuova regola prevista; se serve un titolo di sezione dedicato, riuso `setup-subsection-title`.

## Retrocompatibilità

I setup AMS2 già salvati hanno categorie libere. Alla visualizzazione:
- Le categorie che coincidono per caso con il vocabolario (`Freni`, `Sospensioni`, `Gomme`, `Differenziale`, …) finiscono nella sezione giusta.
- Tutte le altre confluiscono in **"Altro"** (primo tab). Nessun crash, nessuna perdita di dati. Ri-decodificando il setup si ottiene la ripartizione completa.

## Testing

Self-check runnable (stile assert, senza framework) sulla logica pura:
- `sectionForCategory(category)` → sezione attesa per categorie note; categoria ignota → "Altro".
- `tabForSection(section)` → tab atteso.
- Rilevamento ruota: `getWheelKey("Pressione FL") === "FL"`, `getWheelKey("Barra antirollio") === null`.
- Le 3 diramazioni: categoria nota per-angolo (grid), categoria nota piatta, categoria ignota → Altro.

`npm run typecheck` e `npm run lint` puliti.

## File toccati

| File | Azione |
|---|---|
| `src/main/main.ts` | Prompt Vision: vocabolario categorie fisso + regola suffisso ruota |
| `src/renderer/components/SetupTabsCommon.tsx` | **nuovo** — primitive condivise estratte da AceSetupTabs |
| `src/renderer/components/AceSetupTabs.tsx` | Importa le primitive da SetupTabsCommon (comportamento invariato) |
| `src/renderer/components/Ams2SetupTabs.tsx` | **nuovo** — vista a 3 tab AMS2 |
| `src/renderer/components/SetupDetailModal.tsx` | Ramo `ams2 → Ams2SetupTabs` |
| `src/renderer/components/Ams2SetupPicker.tsx` | Fase verify: tabella piatta → Ams2SetupTabs |
