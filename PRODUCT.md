# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Sim racer amatoriali e competitivi che guidano RaceRoom Racing Experience, Assetto Corsa EVO e Automobilista 2 su Windows e vogliono abbassare il tempo sul giro e mettere a punto l'auto. Durante il giro usano solo l'audio. Lo schermo lo consultano a fine sessione (box, debriefing), non mentre guidano. Distribuzione pubblica prevista (electron-builder è già configurato).

## Product Purpose

App desktop Electron che fa da coach vocale in tempo reale: legge la memoria condivisa del sim, analizza la tecnica di guida e dà avvisi vocali in italiano durante il giro solo quando c'è un problema. A richiesta, per sessione, produce un debriefing con l'API Claude in due livelli: sintesi breve, poi approfondimento solo se l'utente lo chiede. Successo: il pilota capisce cosa correggere nella guida e nel setup, con numeri concreti, e migliora sessione dopo sessione.

## Positioning

- Analisi LLM a due livelli: i numeri esatti (delta giro, convergenza, conteggi allarmi, durata degli aiuti) sono calcolati in TypeScript e il modello li cita senza ricalcolarli.
- Consigli di setup in sequenza: un solo intervento alla volta, sul primo passo da correggere, secondo la logica di messa a punto di base e poi del quadro assetto (guide Riccardo Frezza). Una telemetria generica non limita il consiglio a una sola azione.

## Operating Context

- Sessione esplicita avviata e chiusa dall'utente, con scelta del gioco all'avvio (nessun autorilevamento). I giri si accumulano nella sessione e il setup caricato viene collegato ai giri successivi.
- Durante la guida: audio, alert-driven, push-to-talk da tastiera o gamepad per domande a voce e comandi come "acquisisci setup".
- Dopo la sessione: storico sessioni, dettaglio giro con grafici di telemetria e mappa pista, analisi sintetica e approfondita, esportazione PDF.
- Il caricamento del setup differisce per gioco: JSON dagli appunti (R3E), file `.carsetup` (ACE), screenshot decodificati con Claude Vision (AMS2).

## Capabilities and Constraints

- Solo Windows, perché i tre sim lo sono. Finestra 1200×800 senza cornice.
- Tutti i testi UI e la voce sono in italiano, tono da ingegnere di pista, sempre con dati numerici. Il testo non nomina mai la procedura ("scaletta", "sequenza", "passo N"): un ingegnere nomina la regolazione.
- Sorgenti dati: shared memory dei sim. R3E non ha temperatura aria/asfalto. In qualifica e leaderboard le gomme sono fisse a 85 °C e non vanno segnalate.
- Voce e STT tramite Azure Cognitive Services, con Web Speech come ripiego solo per gli alert in tempo reale. Analisi tramite API Claude.
- Taratura sul sim ancora aperta: soglie di slip, canale `fuel`, calibrazione pressioni.

## Brand Commitments

Nome: Sim Driving Coach. Voce: ingegnere di pista, diretto, numerico, in italiano. Nessun logo o identità visiva documentati.

## Evidence on Hand

Nessun testimonial, cliente, benchmark o dato di mercato. Non inventarne. Sono disponibili solo i dati reali di sessioni nel database locale e i PDF di analisi generati dall'app.

## Product Principles

1. Audio durante il giro, schermo dopo: ogni informazione si decide in base al momento in cui il pilota la riceve.
2. Un consiglio alla volta: un solo intervento di setup, sul punto giusto, mai più azioni concorrenti.
3. I numeri sono calcolati, non generati: il modello spiega, il codice misura.
4. Sintesi prima, approfondimento a richiesta: l'utente decide quanta profondità vuole.
5. Parlare come un ingegnere di pista, non come un manuale di procedura.

## Accessibility & Inclusion

Nessuno standard formale richiesto. Da decidere se necessario prima della distribuzione pubblica.
