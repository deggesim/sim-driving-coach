---
name: Sim Driving Coach
description: Console scura e sobria da muretto box per rivedere sessioni, giri e analisi dopo la guida.
colors:
  accent: "#e8451a"
  info: "#1a8ae8"
  surface-base: "#0f0f0f"
  surface-raised: "#1a1a1a"
  surface-inset: "#242424"
  hairline: "#2e2e2e"
  text: "#e8e8e8"
  text-dim: "#888888"
  ok: "#2ecc71"
  danger: "#e74c3c"
  warning: "#f1c40f"
  game-r3e: "#e53935"
  game-ace: "#039be5"
  game-ams2: "#f5c518"
typography:
  body:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  analysis:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.7
  headline:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 600
  title:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 600
  label:
    fontFamily: "Segoe UI, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    letterSpacing: "0.5px"
  mono:
    fontFamily: "Cascadia Code, Consolas, monospace"
    fontSize: "14px"
rounded:
  xs: "3px"
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
components:
  title-bar:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text}"
    height: "38px"
    padding: "0 12px"
  tab-button:
    backgroundColor: "transparent"
    textColor: "{colors.text-dim}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
  tab-button-active:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.text}"
  status-bar:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-dim}"
    height: "30px"
    padding: "0 14px"
  analysis-comment:
    backgroundColor: "{colors.surface-inset}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "10px 12px"
  game-badge-r3e:
    backgroundColor: "{colors.game-r3e}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
  game-badge-ace:
    backgroundColor: "{colors.game-ace}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
  game-badge-ams2:
    backgroundColor: "{colors.game-ams2}"
    textColor: "{colors.surface-raised}"
    rounded: "{rounded.md}"
---

# Design System: Sim Driving Coach

## Overview

**Creative North Star: "Il muretto box"**

È la postazione dell'ingegnere di pista, non il cruscotto del pilota. Durante il giro parla solo la voce. Lo schermo si apre dopo, nei box, e deve far leggere in fretta numeri, giri e analisi senza decorazioni. Il sistema è scuro, piatto e utilitario: controlli Bootstrap ridipinti con le variabili di `global.css`, nessuna espressione per sé stessa.

La profondità viene dal contrasto fra tre grigi e da bordi di 1px. L'unico accento è un arancio caldo, che marca ciò che è attivo, il titolo di una sezione o il punto su cui intervenire. I colori dei giochi (rosso, azzurro, giallo) identificano la sorgente e non fanno parte della palette dell'interfaccia.

**Key Characteristics:**

- Solo tema scuro. Ogni componente nuovo usa le variabili `:root`, e ogni componente Bootstrap aggiunto riceve il suo override scuro in `global.css`.
- Densità da strumento: testo a 14px, etichette a 11px maiuscole, tabelle e modali compatti.
- Superfici piatte a strati tonali, senza ombre.
- Un accento, tre colori di gioco, quattro colori di stato.

## Colors

Palette quasi monocromatica: tre grigi quasi neri, un testo chiaro con una variante attenuata, un accento arancio e colori di stato usati solo per il loro significato.

### Primary

- **Arancio muretto** (#e8451a): nome dell'app, tab attivi, titoli `h2`/`h3` dell'analisi, voce di accordion aperta, nome auto e setup nell'intestazione, hover della paginazione. Nell'interfaccia è l'unico colore enfatico.

### Secondary

- **Blu informativo** (#1a8ae8): solo il filetto sinistro (3px) dei commenti dell'utente sull'analisi.

### Neutral

- **Asfalto nero** (#0f0f0f): sfondo dell'app.
- **Cordolo scuro** (#1a1a1a): barra del titolo, barra di stato, contenuto di modali e accordion.
- **Gomma grafite** (#242424): intestazioni di modale e accordion, hover, tab attivo, riquadri incassati.
- **Filo di bordo** (#2e2e2e): ogni bordo e divisore da 1px.
- **Bianco lavagna** (#e8e8e8): testo.
- **Grigio sbiadito** (#888888): testo secondario, etichette, icone non attive.

### Stato e gioco

- **Verde ok** (#2ecc71) con alone di 4px: punto "connesso".
- **Rosso errore** (#e74c3c): punto "disconnesso", hover del pulsante di chiusura finestra.
- **Giallo avviso** (#f1c40f): ultimo allarme nella barra di stato.
- **Rosso R3E** (#e53935), **azzurro ACE** (#039be5), **giallo AMS2** (#f5c518): solo nel badge del gioco. Testo bianco su rosso e azzurro, scuro sul giallo.

### Named Rules

**The One Accent Rule.** L'arancio marca ciò che è attivo o da leggere per primo. Non si usa per decorare riquadri né per ripetere uno stato.

**The Game Colour Rule.** I colori R3E/ACE/AMS2 identificano la sorgente e compaiono soltanto in `.game-badge--*`.

## Typography

**Display Font:** nessuno, l'interfaccia non ha titoli di vetrina.
**Body Font:** Segoe UI (con system-ui, sans-serif)
**Label/Mono Font:** Cascadia Code (con Consolas, monospace) per codice e valori da setup.

**Character:** un solo sans di sistema, neutro e compatto. La gerarchia nasce da peso e colore (arancio sui titoli di sezione), non da dimensioni grandi.

### Hierarchy

- **Headline** (600, 17px): `h2` dell'analisi ("Analisi sintetica", "Analisi approfondita"), arancio, con filo inferiore.
- **Title** (600, 15px): `h3` dell'analisi, arancio.
- **Body** (400, 14px, 1.5): testo di interfaccia. Nel contenuto dell'analisi il line-height sale a 1.7.
- **Label** (400, 11px, 0.5px, maiuscolo, grigio sbiadito): etichette sopra commenti e sezioni.
- **Mono** (14px): codice e valori tecnici.

### Named Rules

**The Heading Ladder Rule.** `h2` e `h3` dell'analisi sono arancio, `h4` e oltre usano il colore del testo. Le due intestazioni radice sono le sole `h2`, e tutto il resto si annida sotto.

## Layout

Finestra desktop 1200×800 senza cornice, a colonna: barra del titolo (38px) in alto, area centrale che riempie lo spazio, barra di stato (30px) in basso. L'area centrale non scorre come pagina. Scorrono i pannelli interni, come il corpo dell'accordion delle analisi, che occupa tutto lo spazio verticale rimasto quando è aperto.

Ritmo con passi di 4, 8, 12 e 16px. Le intestazioni di pannello hanno padding 10px 16px. Tabelle paginate con barra di paginazione fissata in basso nel pannello.

## Elevation & Depth

Nessuna ombra strutturale. La profondità viene dalla scala tonale (#0f0f0f → #1a1a1a → #242424) e da bordi di 1px (#2e2e2e). L'unica luce è l'alone verde di 4px sul punto "connesso", che è un indicatore di stato e non un livello.

### Named Rules

**The Flat Layers Rule.** Un livello più in alto vuol dire un grigio più chiaro, non un'ombra. Per separare due superfici si usa un bordo da 1px.

## Shapes

Angoli appena smussati: 6px su pulsanti-tab, riquadri e badge, 4px su pulsanti piccoli e controlli di finestra, 3px su codice inline e numeri di pagina, 8px sui pannelli più grandi, cerchio pieno solo per i punti di stato. Nessun clipping né silhouette decorativa.

## Components

Controlli sobri e utilitari: Bootstrap ridipinto, senza decorazioni.

### Buttons

- **Shape:** angoli smussati (4–6px).
- **Primary / Secondary / Danger:** dalle varianti react-bootstrap (`secondary` e `danger` sono i più usati, poi `link` per azioni discrete).
- **Tab (barra del titolo):** trasparente con testo grigio; hover e attivo passano a sfondo #242424 e testo chiaro, con transizione di 0.15s.
- **Chiusura finestra:** hover rosso (#e74c3c) con testo bianco.

### Cards / Containers

- **Commenti sull'analisi:** sfondo #242424, bordo 1px, filetto sinistro blu da 3px, raggio 6px, padding 10px 12px.
- **Accordion:** intestazione #242424, corpo #1a1a1a, voce aperta con testo arancio, nessuna ombra di focus.

### Inputs / Fields

- Sfondo #1a1a1a, testo #e8e8e8, bordo #2e2e2e. Nelle modali l'intestazione e il piè di pagina sono #242424 con bordo #2e2e2e, e il pulsante di chiusura è invertito per lo sfondo scuro.

### Navigation

- Tab nella barra del titolo (sessione corrente, storico, impostazioni), controllo muto voce e comandi finestra a destra. Barra di stato con punto di connessione, auto, circuito, calibrazione e ultimo allarme in giallo, che sfuma dopo l'uso.

### Badge del gioco

- Etichetta compatta (12px, peso 600) colorata per gioco, usata in intestazione sessione, storico, selettore gioco e barra di stato.

### Overlay voce

- Overlay fisso per ascolto, elaborazione e risposta. Microfono che pulsa (scala 1→1.2, 1s) durante l'ascolto e cursore lampeggiante nel testo in arrivo.

## Do's and Don'ts

### Do:

- **Do** usare le variabili `--bg`, `--bg2`, `--bg3`, `--border`, `--text`, `--text-dim`, `--accent` per ogni colore di interfaccia.
- **Do** aggiungere l'override scuro in `global.css` per ogni componente Bootstrap nuovo (modale, accordion, card).
- **Do** distinguere i livelli con un grigio più chiaro e un bordo da 1px.
- **Do** riservare l'arancio a ciò che è attivo, ai titoli di sezione dell'analisi e al punto di attenzione.
- **Do** mostrare sempre il dato numerico accanto alla sua etichetta, con testo da ingegnere.

### Don't:

- **Don't** usare componenti Bootstrap chiari senza override scuro.
- **Don't** aggiungere ombre per dare rilievo: usare un bordo o un grigio più chiaro.
- **Don't** usare i colori R3E/ACE/AMS2 fuori dal badge del gioco.
- **Don't** introdurre un secondo colore enfatico accanto all'arancio.
- **Don't** nominare nella UI la procedura di messa a punto ("scaletta", "sequenza", "passo N"): l'interfaccia usa il nome della regolazione.
