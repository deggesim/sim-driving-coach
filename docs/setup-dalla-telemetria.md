# Setup dalla telemetria: cosa si rileva e cosa si corregge

Riepilogo della PR #15 (scaletta setup e quadro assetto), aggiornato al 2026-11-01.
Per ogni intervento: cosa la telemetria rileva e in che direzione va la modifica
della voce di setup, per ciascuno dei tre giochi.

**Legenda**

- **S1–S6:** scaletta (messa a punto di base), valutata nell'ordine. Codice: `src/main/coach/setup-ladder.ts`.
- **Q1–Q8:** quadro assetto, che si apre solo quando la scaletta non ha più correzioni. Codice: `src/main/coach/setup-overview.ts`.
- **n.v.:** non valutabile.
- **"come R3E":** stessa regola e stessa direzione della colonna R3E.

L'analisi sintetica propone una sola modifica: sul primo passo da correggere della
scaletta oppure, se la scaletta non ha correzioni, sulla prima area del quadro. Tutti
i giudizi usano solo i giri giudicati, cioè validi e con gomme stabili (±2 °C rispetto
al giro precedente). Fanno eccezione i condotti freni, che usano tutti i giri dopo il primo.

| Intervento | R3E | ACE | AMS2 |
|---|---|---|---|
| **S1 Condotti freni** | Rileva la temperatura media dei freni anteriori e posteriori. **Anteriori oltre 700 °C:** aprire gli anteriori. **Sbilanciamento tra gli assi oltre il 20 %:** chiudere i condotti dell'asse freddo se entrambi sono sotto 412 °C; aprire quelli dell'asse caldo se entrambi sono sopra 687 °C. Spesso il setup non ha la regolazione dei condotti: in quel caso è n.v. e la scaletta passa oltre. Con Fixed Setup il problema viene rilevato ma non proposto. | Come R3E; anche qui spesso manca la regolazione nel setup. | Come R3E, con la regolazione "Condotti freni". Verificato dal vivo: con sbilanciamento del 28–29 % propone di chiudere i posteriori. |
| **S2 Bilanciamento freni** | **Con l'ABS in più del 20 % delle frenate forti e sottosterzo in inserimento nella maggior parte delle curve:** bilanciamento verso il posteriore. **Senza ABS, dai bloccaggi rilevati con lo slip:** se blocca soprattutto l'anteriore (oltre il 5 % e almeno il doppio del posteriore), bilanciamento verso il posteriore; se blocca soprattutto il posteriore, verso l'anteriore; se bloccano entrambi gli assi, ridurre la pressione freni. | Come R3E. | Come R3E. Lo slip è disponibile dal primo giro (verificato l'1/11). |
| **S3 Freno motore** | Rileva le scalate nervose: slip posteriore sotto −0,1 entro 500 ms da una scalata. **Oltre il 20 % delle scalate:** coast ramp più chiusa; se è già al minimo, meno freno motore e più pressione freni. n.v. con la trazione anteriore. | Come R3E. | Come R3E. Le indicazioni tengono conto delle scale AMS2: coast ramp più chiusa = valore più basso; engine braking più alto = meno freno motore. La trazione viene dalla tabella auto. |
| **S4 Pressioni** | Rileva per ogni ruota la differenza tra centro battistrada e media delle due spalle, su più giri. **Fuori da ±1,25 °C sull'asse peggiore:** centro più caldo → abbassare; centro più freddo → alzare. n.v. in Leaderboard (gomme fisse a 85 °C). | Come R3E. | Come R3E. Verificato dal vivo: tutte le ruote nella tolleranza con 1,54/1,60 bar a freddo. |
| **S5 Campanatura** | Rileva la differenza tra spalla interna ed esterna. **Sotto 2 °C:** più campanatura negativa. **Sopra 10 °C:** meno campanatura negativa; all'anteriore, in alternativa, più incidenza. | **n.v.:** le spalle differiscono di circa 1 °C anche con campanatura estrema. | **Regola Frezza:** le temperature sono lette appena sotto la superficie, quindi non c'è un gradiente preciso da seguire. **Interna ed esterna uguali (differenza sotto 1 °C):** più campanatura negativa, a poco a poco, fino a circa 5 °C tra le spalle. Non chiede mai meno campanatura; se frenata o trazione perdono grip, è troppa. Prova dell'1/11: −4,0° e −3,0° danno lo stesso gradiente. |
| **S6 Differenziale** | Rileva con lo slip il pattinamento della ruota interna in uscita, il sovrasterzo in uscita e quello in inserimento. **Pattinamento oltre il 20 %:** più bloccaggio (power ramp più chiusa, poi più precarico). **Sovrasterzo in uscita nella maggior parte delle curve:** aprire la power ramp o ridurre il precarico. **Sovrasterzo in inserimento:** chiudere la coast ramp o aumentare il precarico. | Come R3E. | Come R3E, più i dati della tabella auto. **Differenziale fisso, bloccato o aperto:** n.v. **Differenziale a ingranaggi:** alzare o abbassare il bias ratio in accelerazione o in rilascio. |
| **Q1 Molle** | Calcola la distribuzione dei pesi dai carichi ruota a bassa velocità e confronta il rapporto delle molle con quello dei pesi (isofrequenza). Mostra il valore obiettivo ma **non lo propone**, perché il rapporto di leva delle sospensioni non è noto. | Come R3E (pesi misurati dai carichi ruota). | Pesi presi dalla tabella auto, perché AMS2 non fornisce il carico ruota. **Proposto:** molla dell'asse più carico = molla dell'altro asse × rapporto dei pesi. Esempio reale: anteriori da 185 a 176 N/mm. |
| **Q2 Altezze e rake** | Rileva l'altezza da terra minima per asse e i tocchi del fondo. **Sopra 15 mm senza tocchi:** abbassare di un click, stessi mm sui due assi. **Sottosterzo in inserimento nella maggior parte delle curve, senza ABS dominante:** più rake. | Come R3E; l'altezza è misurata per asse, non per ruota. | Come R3E (altezza verificata dal vivo il 31/10). |
| **Q3 Bumpstop** | Rileva i tocchi del fondo (sotto 3 mm per 3 campioni) in frenata o in curva seguiti da una scomposta dell'auto. **Più di 0,1 per giro:** avvicinare il bumpstop dell'asse; se non è regolabile o è già al massimo, alzare le altezze di 2 mm. | Come R3E. | Come R3E. |
| **Q4 Terze molle** | Rileva i tocchi del fondo in rettilineo veloce e la differenza tra altezza in rettilineo e a centro curva. **Tocchi in rettilineo:** irrigidire la terza molla dell'asse, poi +1 mm alle altezze, oppure avvicinare il bumpstop. **Auto oltre 10 mm più alta in rettilineo che a centro curva:** ammorbidire le terze molle. | Come R3E. | Come R3E. |
| **Q5 Ammortizzatori** | Valori **mostrati, mai giudicati**: nessun criterio affidabile dalla telemetria. | Come R3E. | Come R3E. |
| **Q6 Barre antirollio** | Valuta l'equilibrio a centro curva nelle curve lente, sotto 100 km/h, con almeno 3 curve. **Sottosterzo nella maggior parte:** barra anteriore più morbida o posteriore più rigida. **Sovrasterzo:** l'opposto. | Come R3E. | Come R3E. |
| **Q7 Convergenze** | Conta le correzioni di sterzo per km sui rettilinei veloci, con almeno 2 km. **Più di 6 per km:** più convergenza anteriore, o meno divergenza. | Come R3E. | Come R3E. |
| **Q8 Aerodinamica** | Rileva un sintomo presente nella maggior parte delle curve veloci (sopra 120 km/h) ma non in quelle lente. **Sottosterzo:** più carico anteriore o meno ala. **Sovrasterzo:** più ala o meno carico anteriore. | Come R3E. | Come R3E. |

## Differenze per gioco

- **R3E**
  - È l'unico gioco che fornisce i limiti di ogni parametro. Una correzione già a fine corsa viene segnalata come "già a fondo scala" e non proposta.
  - Con Fixed Setup restano solo condotti e bilanciamento freni, e i condotti non vengono proposti. Anche il quadro non viene proposto.
  - In Leaderboard pressioni e campanatura sono n.v., anche con il flag spento se le gomme risultano a temperatura fissa.
- **ACE**
  - Campanatura n.v.
  - Altezza da terra misurata per asse.
  - Spesso il setup non ha la regolazione dei condotti.
- **AMS2**
  - Il setup viene letto dagli screenshot.
  - Mancano il carico ruota e il carburante: i pesi delle molle vengono dalla tabella auto, che fornisce anche la trazione e il tipo di differenziale.
  - Campanatura: solo l'allarme a temperature uguali (regola Frezza), mai "meno campanatura".
  - Slip e intervento del TC sono verificati dal vivo l'1/11.
