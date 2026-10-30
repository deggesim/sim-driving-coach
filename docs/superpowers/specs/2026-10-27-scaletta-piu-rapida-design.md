# Scaletta più rapida — design

Stato: approvato, 2026-10-27.

## Perché

Percorrere la scaletta (6 passi) e il quadro assetto (8 aree) richiede molti giri: ogni modifica apre un segmento di setup che vuole il riscaldamento delle gomme (1-3 giri dopo il giro di uscita) e 3 giri giudicati prima dell'avviso vocale "Stint analizzabile". Il tempo al simulatore non sempre c'è. L'utente vuole accorciare i tempi **mantenendo le linee guida di Frezza**: una modifica alla volta, nell'ordine della scaletta.

## Obiettivi

1. **Prontezza adattiva**: l'avviso arriva appena il verdetto è stabile, non dopo un numero fisso di giri. Mai più tardi di oggi.
2. **Condotti freni senza attendere le gomme**: il passo 1 si giudica sui giri del segmento dopo il primo, senza il plateau delle temperature gomme, perché guarda solo le temperature dei freni.
3. **Nessun blocco**: un passo senza leva nel setup, o con la leva a fondo scala, non ferma la scaletta (§3).

## Non obiettivi

- Più modifiche insieme. Anche fra passi che sembrano indipendenti: i condotti freni cambiano la temperatura delle gomme, quindi il passo 4.
- Riportare i giudizi o suggerire la ripresa da una sessione all'altra. Una sessione nuova riparte sempre dal passo 1; per riprendere da un passo già analizzato si riapre la sessione precedente (`session:reopen`). *(Decisione dell'utente, 2026-10-28: il promemoria di ripresa all'apertura di una sessione nuova è stato tolto.)*
- Cambiare `lapsMissing` e la frase "completa ancora N giri" del prompt. L'analisi resta possibile da 2 giri giudicati, come oggi.

## Anti-obiettivi

- Un avviso che arriva prima di oggi su un verdetto che il giro successivo ribalterebbe.

## 1. Prontezza adattiva

Oggi `stintReadyMessage` parla quando ci sono almeno `READY_JUDGED_LAPS = 3` giri giudicati.

Nuova regola: lo stint è pronto con **3 giri giudicati, come oggi, oppure con 2** se il verdetto è **stabile**. Stabile significa che il verdetto calcolato sul solo primo giro giudicato è uguale a quello calcolato sui primi due.

- **Verdetto**: lo stato e il motivo di ogni passo della scaletta, dal passo 1 fino al passo corrente compreso, oppure tutti e 6 i passi se non c'è un passo corrente. Quando la scaletta è completa, il verdetto include anche lo stato e il motivo delle aree del quadro, dalla 1 fino all'area corrente compresa (tutte e 8 se non c'è un'area corrente).
- **Confronto**: si confrontano lo stato e il motivo con i numeri sostituiti da un segnaposto. Lo stesso verdetto con numeri diversi ("sbil. 22 %" e "sbil. 25 %") è stabile; una direzione o una ruota diversa no.
- **Eccezione**: se il passo corrente è il 4 (pressioni) servono sempre 3 giri, perché la deriva delle pressioni ne richiede 3.
- **Effetti sul resto**: la frase vocale resta quella di oggi; cambia solo quando viene pronunciata. Scaletta, quadro e prompt non cambiano.

**Risparmio atteso**: un giro per modifica quando il verdetto è netto. Nei casi al limite nessun risparmio.

## 2. Condotti freni senza attendere le gomme

Oggi tutti i passi usano i giri giudicati: giri validi con la temperatura media delle gomme stabile entro 2 °C rispetto al giro precedente.

Nuova regola: il passo 1 usa **i giri del segmento dal secondo in poi**, validi e non validi. Il primo è il giro di uscita, con i freni ancora freddi. Una pista sporca non cambia la temperatura dei freni.

Il passo 1 si giudica anche quando la scaletta è ancora in "completa ancora N giri", cioè con meno di 2 giri giudicati:
- se ci sono almeno 2 giri del segmento dopo il primo e il passo 1 risulta DA CORREGGERE, la scaletta restituisce subito il passo 1 come passo corrente, con i passi successivi non ancora giudicati;
- se il passo 1 è ok, si aspettano i giri giudicati come oggi.

Prontezza del passo 1 quando è il passo corrente: la stessa regola di stabilità del §1, applicata ai giri del segmento dal secondo in poi (2 giri stabili, oppure 3).

**Risparmio atteso**: sul primo passo, i giri di riscaldamento delle gomme. Nella sessione ACE del 2026-10-27 il primo giro giudicato era il 5, mentre i freni erano utilizzabili dal giro 2.

## 3. Passo senza leva o con la leva a fondo scala

Problema: se il passo corrente è DA CORREGGERE ma il setup caricato non ha la sua leva, la scaletta resta ferma su quel passo per sempre. Succede lo stesso se la leva è già a fondo scala nella direzione richiesta. Il quadro non diventa mai corrente, perché finché la scaletta ha un passo corrente è "da rivedere dopo la sequenza". È il caso reale del 2026-10-27:
- la Porsche 911 GT3 R su R3E non ha parametri per i condotti dei freni, e power e coast del differenziale sono disabilitati;
- l'importatore ACE non produce mai un parametro per i condotti.

Nei due casi il passo corrente era proprio il passo 1.

**Leva assente** (tutti i giochi, solo con un setup caricato sull'ultimo segmento): un passo DA CORREGGERE la cui leva non compare fra i parametri del setup diventa NON VALUTABILE, con motivo "leva non presente nel setup caricato" seguito dal dato originale. Si salta come gli altri passi NON VALUTABILI. Leve per passo, riconosciute dal nome del parametro senza distinguere maiuscole e minuscole:
1. condotti freni: `duct`, `condott`;
2. bilanciamento: `brake bias`, `ripartizione frenata`, `bilanciamento fren`, e la forza frenante (`brake pressure`, `pressione freni`), che il passo stesso indica quando bloccano entrambi gli assi;
3. freno motore: `coast`, `freno motore`, `engine brak`;
4. pressioni: `tyre pressure`, oppure `pressione` seguito dalla ruota (FL, FR, RL, RR), così "Pressione freni" non conta *(2026-10-28, in implementazione)*;
5. campanatura: `camber`, `campanatura`;
6. differenziale: `differential power`, `differential preload`, `power locking`, `power ramp`, `precarico`, `preload`, `bias ratio` (G-LSD e GC-LSD su AMS2).

Il passo resta valido se basta una delle leve. Senza un setup caricato non cambia niente. Su AMS2 il setup viene dalle schermate scelte, che possono non includere tutte le pagine: la leva risulta assente solo se il setup contiene almeno un parametro della categoria Vision del passo (Freni per i passi 1-2, Motore/Elettronica o Differenziale per il 3, Gomme per il 4, Sospensioni per il 5, Differenziale per il 6). *(2026-10-28, dalla revisione finale.)* AMS2 riceve questi nomi fra i nomi canonici imposti alla Vision.

**Leva a fondo scala** (solo R3E, l'unico gioco che esporta minimo e massimo di ogni parametro; `maxStep` è il numero di passi, quindi l'ultimo è `maxStep − 1`: con l'indice il bilanciamento arriverebbe a 0,005 × 201 = 1,005): un passo DA CORREGGERE le cui mosse sono tutte bloccate diventa ok, con nota "già a fondo scala". Una mossa è bloccata quando il parametro è già al valore minimo (mossa "giù") o massimo (mossa "su"). Mosse considerate, solo quelle con direzione univoca:
- passo 2: bilanciamento verso il posteriore = Brake Bias su (il valore grezzo è la quota posteriore), verso l'anteriore = giù, ridurre la forza frenante = Brake Pressure giù;
- passo 4: pressione alta = Tyre Pressure della ruota giù, bassa = su;
- passo 5: più campanatura negativa = Camber della ruota giù (valore più negativo), meno negativa = su.

Il differenziale e il coast restano fuori: su R3E sono percentuali di bloccaggio, su AMS2 angoli di rampa, e la direzione non è univoca.

**Fondo scala nel quadro** *(2026-10-28, richiesta dell'utente)*: la stessa regola vale per le aree del quadro. Una correzione può avere più alternative ("barra anteriore più morbida **o** posteriore più rigida"), e un'alternativa può richiedere più mosse insieme ("abbassare, stessi mm sui due assi" = le quattro altezze giù). Una correzione è bloccata se ogni alternativa nota ha almeno una mossa già a fondo scala; allora diventa un dato con la nota "…: già a fondo scala" e l'area, senza altre correzioni, è ok. Le direzioni sono quelle del valore numerico, come le applica già il Livello 1 (valore ± passo minimo):
- area 2: abbassare = Ride Height ×4 giù; più rake = posteriori su, oppure anteriori giù;
- area 3: le quattro altezze su (R3E non espone bumpstop);
- area 4: irrigidire = Springs <asse> Third su, oppure le quattro altezze su; ammorbidire = le due terze molle giù;
- area 5: più slow rebound = Rebound ×4 su, oppure Bump ×4 su;
- area 6: barra anteriore e posteriore (Anti Roll Bar Front/Rear, N/mm) nel verso indicato;
- area 7: Toe In Front su;
- area 8: più carico anteriore = Splitter su, oppure Wing Angle giù (e viceversa).

Molle (isofrequenza solo mostrata su R3E, "uguagliare") e ammortizzatori da uniformare non hanno una direzione e restano fuori.

## Vincoli

- Calcoli in TypeScript puro, verificati dai selfcheck esistenti (`setup-ladder.selfcheck.ts`, `session-stats.selfcheck.ts`).
- Nessuna colonna nuova nel DB.
- La frase vocale è in italiano, con tono da ingegnere, senza elenchi.

## Lasciato a chi costruisce

- Dove calcolare la stabilità. Indicazione: `session-stats.ts`, che ha già sia i giri giudicati sia scaletta e quadro.
