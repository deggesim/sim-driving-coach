# Guida utente multilingua + revisione didascalie Impostazioni

Data: 2026-11-15. Stato: in attesa di approvazione.

## Intento

Un pilota che apre l'app per la prima volta deve capire in pochi minuti cosa configurare e in che ordine usarla. La guida è una nuova scheda della title bar, dopo "Impostazioni", sempre consultabile: le viste si smontano al cambio scheda, ma la sessione vive in `sessionStore` e nel main process, quindi aprire la guida durante una sessione non la tocca.

In parallelo si correggono le didascalie di `SettingsPanel.tsx`, che oggi contengono imprecisioni verificate nel codice.

## Obiettivi

- Scheda `guide` accanto a `current-session | session-list | settings`, testi nelle cinque lingue (`de/en/es/fr/it`), lingua = quella scelta nel menu a tendina.
- Percorso "primi passi" in ordine d'uso (sezioni sotto), leggibile anche come consultazione.
- Didascalie di Impostazioni corrette e coerenti con il comportamento reale.

## Non obiettivi

Nessuno screenshot o immagine, nessuna ricerca nel testo, nessun deep-link da Impostazioni alla guida, nessuna persistenza della sezione aperta, nessun editor di contenuti. Nessuna modifica al comportamento di app, voce o sessione.

## Approcci considerati

1. **Chiavi nei locale, namespace separato** (scelto). Segue la regola "ogni testo da i18next" e permette di estendere il controllo di parità a cinque lingue.
2. Un file markdown per lingua con `?raw` + `marked`: più comodo da scrivere, ma fuori dalla convenzione i18n e senza parità automatica.
3. Chiavi `guide.*` dentro i `{lang}.json` esistenti: più semplice, ma gonfia file già lunghi. Scartato su richiesta: file dedicati.

## Design

**Namespace.** Nuovi file `src/shared/locales/guide/{de,en,es,fr,it}.json`, namespace i18next `guide`.

- `i18n.ts`: `RESOURCES.<lang>` diventa `{ translation, guide }`.
- `i18next.d.ts`: `resources` aggiunge `guide: typeof guideIt`.
- `locales.selfcheck.ts`: stesso confronto chiavi e `{{variabili}}` ripetuto per entrambi i namespace (it come riferimento). Gli array sono coperti: `flatten` li espande per indice, quindi anche la lunghezza deve coincidere.
- La voce di menu `titleBar.guide` resta nel namespace `translation`, in tutte e cinque le lingue.

**Struttura dei testi** (`guide`): `title`, `intro`, `sections.<id>.title`, `sections.<id>.steps` (array di stringhe). Il grassetto e il codice sono ottenuti con `<Trans>` e `components={{ b, code, kbd }}`, come già fa `SettingsPanel` per `<code>`. Le etichette di pulsanti e menu citate nei testi devono coincidere con quelle dei locale principali di ciascuna lingua.

**Sezioni** (id → contenuto):

1. `prerequisites`: chiave Anthropic; chiave e regione Azure per voce e dettatura; cosa funziona senza.
2. `session`: "Nuova sessione", scelta del gioco, il sim deve emettere frame; chiusura sessione.
3. `driving`: alert vocali durante il giro, priorità, silenzio tra un alert e l'altro.
4. `setup`: gestione setup, tre modi (R3E JSON dagli appunti, ACE file `.carsetup`, AMS2 screenshot), comando vocale "acquisisci setup".
5. `voice`: tasto controller o tastiera (si assegna in Impostazioni; assegnarne uno rimuove l'altro), **un solo tocco** avvia il microfono, la registrazione si ferma da sola dopo 5 secondi, i tocchi sono ignorati finché il coach elabora o risponde; comandi vocali riconosciuti.
6. `analysis`: "Esegui analisi" (sintesi), "Mostra analisi approfondita", commenti, costi in chiamate API.
7. `history`: storico sessioni, filtri, esportazione PDF, eliminazione.

**Componente.** `GuidePanel.tsx` in `src/renderer/components/`: react-bootstrap `Accordion`, prima sezione aperta, titoli numerati. L'`Accordion` ha già override dark in `global.css` (usato da `AnalysisList`), da riusare senza CSS nuovo se basta.

**Cablaggio.** Il tipo `Tab` è duplicato in `App.tsx` e `TitleBar.tsx`: aggiungere `"guide"` a entrambi, un pulsante dopo "Impostazioni" e `{tab === "guide" && <GuidePanel />}`.

**Didascalie di `SettingsPanel`** (testi nei `{lang}.json` principali, tutte e cinque):

- `controller.hint` e `keyboard.hint`: "premi una volta, hai 5 secondi per parlare"; la tastiera dichiara che assegnare un tasto rimuove l'altro.
- `azure.title` e `azure.hint`: coprono anche STT; l'anteprima voce è menzionata solo dove ha senso (dopo "Carica voci").
- `model.hint`: indica che serve Salva.
- `anthropic.hint`: l'analisi è per sessione e a richiesta, non "post-giro".
- `dev.telemetryHint`: elenco giochi da verificare nel codice (AMS2 incluso o no).
- `dev.mockHint`: "Formula Ultimate Gen2".
- Nuovo hint per il nome assistente (richiamo a voce, massimo 16 caratteri) e per l'interruttore Azure (cosa succede da spento).
- Codice: la precedenza in `frame.carSpeed?.toFixed(1) ?? "0" + " km/h"` (e `dist`) fa sparire l'unità quando il valore c'è; il pulsante Salva Azure usa l'icona come gli altri invece di "✓" testuale.

**Documentazione.** `CLAUDE.md` radice: correggere "Keyboard shortcut hold" in "un tocco, 5 s". `src/renderer/CLAUDE.md`: aggiungere `GuidePanel` e il nuovo tab. `src/shared/CLAUDE.md`: namespace `guide` in `i18n.ts`/`locales.selfcheck.ts`.

## Vincoli

TypeScript strict, funzioni a freccia, nessun testo hard-coded, parità cinque lingue, tema dark. Gate prima di ogni commit: `typecheck`, `lint`, `format:check`, `selfcheck`, `fallow:check`. Nessun commit senza tua conferma.

## Lasciato al realizzatore

Il testo esatto di ogni passo nelle cinque lingue (derivato dai locale principali per le etichette), la tipizzazione di `t(..., { returnObjects: true })` con le risorse tipizzate, e se servono piccoli ritocchi CSS all'accordion.
