# Scaletta più rapida — design

Stato: approvato, 2026-10-27.

## Perché

Percorrere la scaletta (6 passi) e il quadro assetto (8 aree) richiede molti giri: ogni modifica apre un segmento di setup che vuole il riscaldamento delle gomme (1-3 giri dopo il giro di uscita) e 3 giri giudicati prima dell'avviso vocale "Stint analizzabile". Il tempo al simulatore non sempre c'è. L'utente vuole accorciare i tempi **mantenendo le linee guida di Frezza**: una modifica alla volta, nell'ordine della scaletta.

## Obiettivi

1. **Prontezza adattiva**: l'avviso arriva appena il verdetto è stabile, non dopo un numero fisso di giri. Mai più tardi di oggi.
2. **Condotti freni senza attendere le gomme**: il passo 1 si giudica sui giri del segmento dopo il primo, senza il plateau delle temperature gomme, perché guarda solo le temperature dei freni.
3. **Promemoria di ripresa**: all'apertura di una sessione, se esiste una sessione precedente con la stessa auto e la stessa pista, una frase dice quale setup caricare e da dove si riprende.

## Non obiettivi

- Più modifiche insieme. Anche fra passi che sembrano indipendenti: i condotti freni cambiano la temperatura delle gomme, quindi il passo 4.
- Riportare i giudizi da una sessione all'altra. La scaletta rigiudica già tutti i passi dal primo stint, quindi riportarli non fa risparmiare giri.
- Cambiare `lapsMissing` e la frase "completa ancora N giri" del prompt. L'analisi resta possibile da 2 giri giudicati, come oggi.

## Anti-obiettivi

- Un avviso che arriva prima di oggi su un verdetto che il giro successivo ribalterebbe.
- Un promemoria che indica il setup sbagliato, per esempio quello di un altro layout.

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

## 3. Promemoria di ripresa

All'apertura di una sessione, sia da voce che da interfaccia, dopo la frase "Sessione aperta su …", si cerca la sessione precedente più recente dello stesso gioco con la stessa auto, lo stesso circuito e lo stesso layout, e con almeno un giro.

Se esiste, si pronuncia una frase con:
- **la data** della sessione precedente;
- **il setup dell'ultimo segmento**: il suo nome se è stato acquisito, altrimenti "setup non acquisito";
- **lo stato** calcolato su quella sessione con `computeSessionStats`:
  - "passo N, ⟨etichetta⟩, da correggere" se la scaletta ha un passo corrente;
  - "sequenza completa, area N, ⟨etichetta⟩" se c'è un'area corrente del quadro;
  - "nessun passo da correggere" altrimenti;
  - "giri insufficienti per un giudizio" se mancano giri.

Esempio: "Ultima sessione con questa combinazione: 27 ottobre, setup Monza v2, passo 4, pressioni, da correggere. Per riprendere carica quel setup."

Non c'è nessun confronto automatico fra il setup caricato e quello della sessione precedente.

## Vincoli

- Calcoli in TypeScript puro, verificati dai selfcheck esistenti (`setup-ladder.selfcheck.ts`, `session-stats.selfcheck.ts`).
- Nessuna colonna nuova nel DB: le sessioni precedenti si leggono con le tabelle per gioco (`tableFor`).
- La frase vocale è in italiano, con tono da ingegnere, senza elenchi.

## Lasciato a chi costruisce

- Dove calcolare la stabilità. Indicazione: `session-stats.ts`, che ha già sia i giri giudicati sia scaletta e quadro.
- Come leggere la sessione precedente. Indicazione: `session-coach.ts`, accanto a `loadSessionBundle`.
- La forma esatta della data detta a voce.
