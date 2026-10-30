# Sequenza setup dalla telemetria (metodo Frezza) — design

Data: 2026-10-20 · Stato: approvato · Assorbe la diagnosi pressioni gomme (passo 4).

Fonte principale: la guida PDF di Riccardo Frezza "GUIDA FINITA COMPLETA (ASCIUTTO)" (135 slide, AMS2, concetti validi per tutti e tre i sim), conservata fuori dal repo in `D:\Progetti\riferimenti-sim-driving-coach\` e da non versionare. Le soglie numeriche marcate **(utente)** vengono dall'esperienza in pista dell'utente; quelle marcate **(scelta)** sono decisioni di design da tarare su sessioni vere.

## Perché

Oggi l'analisi (Livello 1 e 2) propone leve di setup "su ogni area che i dati sostengono": può suggerire campanatura e pressioni nella stessa analisi, oppure toccare le pressioni con i freni ancora sbilanciati. La guida insegna un **ordine**: ogni regolazione sposta quelle che vengono dopo (i condotti cambiano le pressioni, le pressioni cambiano le temperature su cui si legge la campanatura). Un coach che segue l'ordine fa cambiare una cosa alla volta, e ogni giro di prove serve a verificare quella sola cosa.

Successo = dopo uno stint con un setup, l'analisi dice **quale passo della sequenza è il primo non a posto**, propone una sola leva di setup su quel passo citando il numero calcolato che la giustifica, e dichiara i passi saltati perché non misurabili.

## Obiettivi

- Calcolare in TypeScript (`session-stats.ts`) lo stato di ogni passo della sequenza e il **passo corrente**, per R3E, ACE e AMS2.
- Stamparlo nel blocco "## Dati Calcolati", che i prompt già obbligano a citare alla lettera.
- Livello 1: proposte di setup **solo** sul passo corrente. Livello 2: stato di tutti i passi.
- Rendere misurabile lo slip ratio su AMS2 (oggi assente).
- Leggere le tre temperature superficiali (interna / centro / esterna) su tutti e tre i giochi.

## Non obiettivi

- Alert vocali in tempo reale sulla sequenza: serve una media su uno stint.
- Incidenza, convergenze, molle, terze molle, bumpstop, ammortizzatori, barre, altezze, aerodinamica (slide 37-44 e 62-135): fuori dalla sequenza. Il Livello 2 può citarle solo come informazione, senza proposte, finché la sequenza ha un passo corrente **(scelta)**.
- Finestre di pressione assolute per categoria di auto (GT3 1,9-2,1 bar…): l'app non conosce la categoria.
- Salvare su disco il raggio gomma AMS2 stimato.
- Ricalcolare la sequenza su sessioni già registrate oltre ciò che i loro dati permettono (vedi "Non valutabile").

## Anti-obiettivi (fallimento anche se "funziona")

- Il modello che fa aritmetica o inventa una soglia: ogni giudizio nasce in TS, il prompt lo cita.
- Più di una leva di setup per analisi al Livello 1.
- Un passo saltato in silenzio: un passo non valutabile va sempre dichiarato con il motivo.
- I consigli di tecnica di guida soppressi: restano come oggi, la sequenza governa solo il setup.

## La sequenza

Ordine della guida (slide 54): condotti → bilanciamento freni (provvisorio) → rampe (provvisorie) → freno motore e forza frenante → pressioni → campanatura e incidenza → rampe (definitive) → precarico. L'app la riduce a sei passi misurabili **(scelta)**: le rampe provvisorie e definitive si misurano allo stesso modo, quindi stanno in un passo solo, in fondo; l'incidenza non è separabile dalla campanatura nei dati.

Ogni passo ha uno stato: `ok`, `da correggere` (con direzione e numero), `non valutabile` (con motivo). **Passo corrente** = il primo `da correggere`; i `non valutabile` si scavalcano dichiarandoli **(utente)**. Nessun `da correggere` → "sequenza completa".

### Passo 1 — Condotti freni

Dati: `avgBrakeTempC` per zona (già in `ZoneData`). Media per asse sui giri giudicati.

- `da correggere` se **almeno una** **(utente)**:
  - media dischi anteriori > **700 °C** **(utente, dalla guida slide 8)** → aprire i condotti anteriori;
  - sbilanciamento tra assi > **20 %** **(utente)**, con `sbil = |ant − post| / max(ant, post)` **(scelta)** → aprire i condotti dell'asse più caldo (o chiudere quelli dell'asse più freddo).
- `non valutabile`: temperature a `-1` (alcune auto R3E) o assenti.
- La finestra fissa 413-688 °C resta stampata come informazione, non decide il passo: il "verde" cambia da auto ad auto (slide 9).

### Passo 2 — Bilanciamento freni

Due regole, secondo se l'auto ha l'ABS attivo nei giri giudicati (ABS considerato attivo se `abss` lo indica o se `abs` scatta almeno una volta — dettaglio al builder).

**Senza ABS** (slide 12-14) **(scelta, non contestata dall'utente)**:
- Frame di frenata = `brk > 0,30`. Bloccaggio = una ruota con `sr < −0,25` **(utente, valore di partenza da tarare sul sim: la frenata al limite senza bloccaggio arriva già a −0,08…−0,15 su molti modelli di gomma)**.
- Per asse: quota dei frame di frenata con almeno una ruota dell'asse bloccata.
- `da correggere` se un asse blocca in > **5 %** dei frame di frenata **e** almeno il doppio dell'altro asse. Anteriore → bilanciamento verso il posteriore ("l'auto tira dritta"); posteriore → verso l'anteriore ("il posteriore scoda").
- **Aggiornato 2026-10-26:** se **entrambi** gli assi bloccano oltre il 5 % senza che uno sia il doppio dell'altro, nessun bilanciamento lo risolve → `da correggere` con "ridurre la forza frenante (brake pressure), poi rifare il bilanciamento" (guida "La forza frenante"). Prima questo caso dava `ok`.

**Con ABS** **(utente)**: un bilanciamento troppo in avanti allunga la frenata e fa sottosterzare in inserimento.
- `da correggere` se **entrambi**:
  - l'ABS è attivo in > **20 %** dei frame di frenata **(utente)**;
  - c'è sottosterzo in inserimento (definizione sotto) **(scelta)**.
- Direzione: bilanciamento verso il posteriore.

**Sottosterzo/sovrasterzo per fase (metrica condivisa con il passo 6)** **(scelta)**: per ogni frame con `|str| > 0,05` si calcola la curvatura ottenuta per unità di sterzo, `k = |gLat| / (v² · |str|)` (v in m/s). Il `v²` serve: senza, a velocità d'ingresso più alte il rapporto `gLat/str` crescerebbe solo per la velocità. Per ogni curva si confronta la media di `k` in tre fasi:
- inserimento: `brk > 0,05`;
- centro curva: `brk ≤ 0,05` e `thr ≤ 0,20`;
- uscita: `thr > 0,50`.

Inserimento più basso del centro curva di oltre il **15 %** = curva sottosterzante in ingresso; più alto di oltre il 15 % = sovrasterzante in ingresso. Stessa cosa per l'uscita. *(2026-10-27, verifica live a Monza: il sovrasterzo in inserimento e in uscita non usa più il rapporto dei `k`, che cresce anche su un'auto neutra perché `gLat` segue lo sterzo con il ritardo dell'imbardata (uscita ×1,1-3,6 senza scivolata avvertita). È sovrasterzo una fase con controsterzo, segno di `str·gLat` opposto a quello prevalente nella curva, in più del 15 % dei suoi frame: lo stesso criterio del centro curva. Il sottosterzo in inserimento resta sul rapporto dei `k`.)* Il passo considera il sintomo presente se lo mostra la maggioranza delle curve con dati in tutte e due le fasi **(scelta)**. Confrontare dentro la stessa curva evita un riferimento per auto.

**Cos'è una curva qui** **(scelta)**: le zone da 50 m spezzano le fasi e `corner_names` (sulle piste sconosciute) copre solo le frenate. `LapRecorder` delimita quindi da solo le curve: tratti contigui di frame con `|str| > 0,05`, uniti se separati da meno di 0,3 s, scartati se durano meno di 1 s. Per ogni curva calcola le medie di `k` per fase, la classifica (ingresso sotto/sovra/neutro, uscita sovra/neutro, fasi mancanti) e somma i risultati come contatori sulla zona in cui la curva comincia. `session-stats` si limita a sommare i contatori.

- `non valutabile`: senza ABS e senza `sr` (sessioni AMS2 precedenti a questa modifica); con ABS e senza `gLat`.

### Passo 3 — Freno motore e forza frenante

Sintomo **(utente)**: in scalata il posteriore scoda. Slide 20-23: prima si **abbassa** (chiude) la coast ramp, poi si riduce il freno motore. **Corretto 2026-10-26:** qui c'era "si apre", contro le slide: la 22 dà "35 deg sottosterza, 36 deg sovrasterza" e la 53 "coast ramp aperto = sovrasterzo in frenata e decelerazione", quindi abbassare = chiudere.

- Scalata = `gear` che scende tra due frame consecutivi con `brk > 0` o `thr ≤ 0,05`.
- Scalata nervosa = entro **0,5 s** una ruota posteriore ha `sr < −0,10` **(utente, da tarare sul sim)**: soglia più bassa del bloccaggio del passo 2, perché il freno motore fa slittare la ruota all'indietro senza bloccarla.
- `da correggere` se > **20 %** delle scalate sono nervose **(scelta, per simmetria con la soglia ABS dell'utente)** → coast ramp più chiusa (su AMS2 valore più basso); se il setup attivo la mostra già al minimo, meno freno motore. In AMS2 un valore *basso* di engine braking = *più* freno motore (slide 17): la proposta deve dirlo.
- `non valutabile`: senza `sr`; auto a trazione anteriore (le posteriori non subiscono freno motore) **(scelta)**. Come riconoscere la trazione: lasciato al builder (dal setup attivo se lo espone, altrimenti dallo slip in trazione: le ruote motrici sono quelle con slip medio in trazione nettamente maggiore).

### Passo 4 — Pressioni

È lo spec del 2026-10-20, con queste correzioni:

- `Δ = T_centro − (T_interna + T_esterna) / 2` per ruota. Δ > +tol = alta, Δ < −tol = bassa.
- `TYRE_BALANCE_TOL_C = 1.25` **(scelta)**: punto medio tra gli esempi "ok" della guida (|Δ| ≤ 1,0) e quelli fuori (|Δ| = 1,5). Punti di calibrazione: 84/81/81 → bassa; 73/73/70 → alta; 89/88/87 e 85/83/79 → ok. Costante unica da tarare.
- `da correggere` se almeno una ruota è non-ok sulla maggioranza dei giri giudicati. La proposta va sul valore **a freddo** del setup: N click a freddo = N click a caldo (slide 25). Assi anteriore e posteriore valutati separatamente, una sola azione pressioni per analisi. Passo indicativo: 0,05 bar (AMS2), 0,7 PSI (ACE), 5 kPa (R3E).
- Restano dallo spec: pressione media a caldo e deriva primo→ultimo giro per ruota; valori per setup quando nella sessione ce ne sono più di uno (informazione per il Livello 2; il giudizio usa solo l'ultimo segmento).
- `non valutabile`: senza temperature interna/centro/esterna (sessioni registrate prima di questa modifica).

### Passo 5 — Campanatura

Solo sulle ruote con pressione `ok` al passo 4 **(scelta)**: con la pressione sbagliata, la differenza tra le spalle non indica la campanatura (slide 30).

- `d = T_interna − T_esterna`.
- `d < 2 °C` (comprese le tre temperature uguali, o l'interna più fredda dell'esterna) → più campanatura negativa **(scelta, dalla guida slide 33: obiettivo ~5 °C, tre uguali = allarme)**.
- `d > 10 °C` → meno campanatura negativa **(utente)**. **Aggiornato 2026-10-26:** sulle anteriori anche "o più incidenza (se regolabile)": con incidenza bassa le spalle interne anteriori scaldano di più (guida "L'angolo di incidenza"). Leva alternativa, non un giudizio separato: nei dati resta inseparabile dalla campanatura.
- Per ruota, giudizio sulla maggioranza dei giri come al passo 4.
- `non valutabile`: come al passo 4.

### Passo 6 — Rampe e precarico del differenziale

Slide 45-54. Usa la metrica `k` per fase del passo 2.

- **Uscita (power ramp)** **(utente)**: il sintomo è la ruota posteriore interna che pattina senza spingere. Misura senza bisogno di sapere quale ruota sia l'interna: in uscita (`thr > 0,50`, `|str| > 0,05`), `|sr_RL − sr_RR| > 0,15` (soglia dal thread Reiza) su più del 20 % dei frame **(scelta)** → **chiudere** la power ramp (più bloccaggio). Su auto a trazione anteriore si usano le anteriori.
- Uscita con sovrasterzo (`k` uscita > centro curva +15 %) **senza** ruota interna che pattina → **aprire** la power ramp **(scelta, dalla guida slide 50)**.
- **Aggiornato 2026-10-26:** il precarico è la leva di riserva anche della power ramp: già chiusa del tutto → più precarico; già aperta del tutto → meno precarico (guida "Il differenziale": precarico alto = più chiusura in entrambe le fasi). Al passo 3, il ripiego "meno freno motore" aggiunge "più forza frenante per non allungare la frenata".
- **Ingresso (coast ramp)**: sovrasterzo in ingresso (`k` inserimento > centro curva +15 %) → **chiudere** la coast ramp; se il setup attivo la mostra già al minimo, più precarico (slide 54). Il sottosterzo in ingresso appartiene al passo 2, che viene prima.
- Geared LSD (slide 55-61, bias power/coast) al posto delle rampe quando il setup attivo lo indica: la proposta usa quel nome di parametro.
- `non valutabile`: senza `sr` o `gLat`.
- Questo passo sostituisce l'invito attuale nei prompt a "verificare differenziale power/coast" dalle asimmetrie di slip.

## Quali giri si giudicano

- Solo l'**ultimo segmento-setup**: i giri consecutivi finali con lo stesso `setup_id` (anche `null` vale come segmento).
- Esclusi i giri non validi e i **primi 3 giri** del segmento: la guida legge temperature e pressioni a gomme stabilizzate, "dopo almeno 4 giri senza fermarsi" (slide 12, 25) **(scelta: si giudica dal 4° giro)**. I giri non validi contano comunque per il riscaldamento, perché le gomme le scaldano lo stesso **(scelta)**.
- **Aggiornato 2026-10-22 (utente):** il riscaldamento non si conta più in giri. Un giro è giudicabile se è valido e la temperatura media del centro (4 ruote) è variata al massimo di 2 °C rispetto al giro precedente (valido o no). Niente pavimento di giri: dopo una sosta con gomme fredde i giri tornano giudicabili solo a plateau raggiunto, quindi il segmento non deve più ripartire per forza al cambio di `setup_id`. Senza temperature del centro (ACE/AMS2 non verificati) o in Leaderboard (gomme fisse a 85 °C) resta il vecchio criterio: giri 1-3 esclusi, si giudica dal 4°. I freni non entrano nel criterio: la finestra 413-688 °C escluderebbe proprio i giri che il passo 1 deve poter segnalare.
- Servono almeno **2** giri giudicabili **(scelta)**. Altrimenti nessun passo è giudicato e la riga dice "completa ancora N giri con questo setup" (N = `max(0, 2 − giri giudicabili)`, un minimo: quanti giri servono davvero dipende dal plateau).

## Dati nuovi

### Temperature interna / centro / esterna

Canali semantici in `CompactFrame`, quartetti `[FL, FR, RL, RR]` in °C: `tti` (interna), `ttc` (centro), `tto` (esterna). L'orientamento si risolve nel reader, così nessun consumatore deve conoscere le convenzioni dei giochi. Questo sostituisce `ttl/ttr` dello spec precedente.

| Gioco | interna | centro | esterna |
| --- | --- | --- | --- |
| R3E | ruote sx: `TireTemp_*_Right`; ruote dx: `TireTemp_*_Left` | `TireTemp_*_Center` | ruote sx: `_Left`; ruote dx: `_Right` |
| ACE | `PHY.tyreTempI` @368 | `tyreTempM` @384 | `tyreTempO` @400 |
| AMS2 | ruote sx: `mTyreTempRight` @20360; ruote dx: `mTyreTempLeft` @20328 | `mTyreTempCenter` @20344 | ruote sx: `mTyreTempLeft`; ruote dx: `mTyreTempRight` |

- R3E e AMS2: convenzione **assunta per ora (utente)** — sulle ruote sinistre "left" = esterna, sulle destre "left" = interna. Coincide con l'HUD di AMS2 (E-M-I a sinistra, I-M-E a destra, slide 28). Va confermata sul sim: in curva lunga a destra la spalla esterna delle ruote sinistre deve scaldarsi di più.
- ACE: I/M/O usati per nome, senza regola sinistra/destra **(scelta)**.
- `-1` (R3E) o `0` (AMS2 UNSET) su una ruota → quartetto assente, come per `tt`.
- Arrotondamento a 0,1 °C in scrittura per contenere `frames_blob` (dal piano precedente).
- `ZoneData` guadagna le medie per zona dei tre quartetti.

### Slip ratio AMS2

`mTyreRPS` (float[4]) è in **rad/s** nonostante il nome (thread Reiza, plugin SimHub `CalcLngWheelSlip`). Offset da camminare in `SharedMemory.h` v14, con selfcheck dell'aritmetica.

- Raggio per ruota stimato nel reader, rifatto a ogni sessione, senza file: nei frame con v > 50 km/h, `brk = 0`, `thr < 0,05`, `|gLat|` e `|str|` vicini a zero, `r = v / |ω|`; si usa la mediana dei campioni (soglie dal plugin SimHub).
- `sr = (r·|ω| − v) / v`, con la convenzione dell'app (negativo = bloccaggio). Sotto ~1 m/s, `sr` = 0.
- Finché il raggio non è stimato, `sr` è **assente**, non zero.
- Limite noto (`ponytail:` nel codice): il freno motore in rilascio fa scivolare le ruote motrici di circa l'1 %, quindi il raggio posteriore risulta leggermente sottostimato. È trascurabile rispetto alle soglie del 5-15 %.
- Conferma sul sim con la riga `[AMS2] canali`: in rettilineo a velocità costante lo slip deve stare vicino a 0.

### Contatori per zona

`session-stats` lavora su `zones_json`, non sui frame grezzi. Le misure che richiedono la sequenza dei frame (bloccaggi per asse, quota ABS in frenata, `k` per fase, scalate nervose, pattinamento della ruota interna) si contano in `LapRecorder` a fine giro e diventano campi opzionali di `ZoneData`, sul modello di `absActiveFrames` **(scelta)**. Così `session-stats` somma soltanto, e le sessioni vecchie risultano "non valutabile" invece di dare valori sbagliati. Nomi e forma dei campi spettano al builder.

## Output

### `SessionStats`

Nuovo campo `setupLadder` (sempre calcolato, anche in Leaderboard), con:
- giri giudicati e giri mancanti;
- per ogni passo: stato, motivo o direzione, numeri citabili;
- passo corrente.

La forma esatta del tipo spetta al builder. Vecchi campi `slipAsym*` e `suspAsym*`: restano finché qualcosa li stampa. Il builder decide se il passo 6 li rende superflui (`fallow:check` lo segnalerà).

### Blocco "Dati Calcolati" (`prompt-builder.ts`)

Una riga di sintesi più i dettagli per passo, nello stile per ruota già in uso `(ANT-SX/ANT-DX/POST-SX/POST-DX)`, con unità da `pressureUnit(game)`. Esempio indicativo:

```
- Sequenza setup (giri 4-9 del setup "Gara B", 6 giudicati):
    1 condotti: ok (ant 612 °C, post 548 °C, sbil. 10 %)
    2 bilanciamento freni: NON VALUTABILE (manca lo slip: sessione registrata prima del calcolo AMS2)
    3 freno motore: ok (scalate nervose 2/31)
    4 pressioni: DA CORREGGERE ← PASSO CORRENTE | (ANT-SX/ANT-DX/POST-SX/POST-DX) Δ +2.1/+1.8/+0.3/−0.2 °C | stato alta/alta/ok/ok | press. a caldo 2.04/2.03/1.95/1.94 bar
    5 campanatura: da rivedere dopo il passo 4
    6 differenziale: da rivedere dopo il passo 4
```

### Dal giudizio alla leva **(scelta)**

- **Chi decide.** TS decide se un passo è a posto e in quale direzione correggerlo, con una leva di riserva dove la guida ne prevede una (coast ramp già al minimo → freno motore oppure precarico). Quale parametro corrisponde nel setup attivo (rampe o bias del geared LSD, nome del parametro, valore attuale) lo sceglie il modello leggendo il testo del setup. Non si aggiunge uno strato di normalizzazione dei setup per gioco: `SetupParam` resta `{category, parameter, value}`.
- **Leva assente.** Se il setup attivo non contiene la leva del passo corrente (condotti non regolabili, differenziale fisso…), il modello lo dichiara e passa al passo `da correggere` successivo. È la stessa regola "salta dichiarando" che l'utente ha dato per i passi non valutabili. La riga dei Dati Calcolati riporta lo stato di tutti i passi, quindi il modello sa qual è il successivo.
- **Entità.** Sempre il passo minimo: un click, per le pressioni il passo indicativo del passo 4. La sequenza è iterativa: si cambia, si girano altri 4 giri e si rilegge. Il modello scrive B = A ± un passo, partendo dal valore a freddo del setup attivo. È l'unica aritmetica che fa, ed è banale.
- **Pressioni, una leva.** L'asse con il |Δ| maggiore; entrambe le ruote di quell'asse, ognuna nella propria direzione, e solo quelle non-ok.
- **Nessun setup attivo** (`setup_id` nullo): TS dà la direzione e il modello la scrive senza A → B.

### Prompt

- **Livello 1** (`SYNTHESIS_SYSTEM_PROMPT`): le azioni di setup riguardano **solo** il passo corrente: una leva, nel formato "Setup — X: A → B", con il numero della riga. I passi non valutabili saltati vanno nominati in una riga, con il motivo. Con meno giri del minimo, l'azione è "completa N giri". La tecnica di guida resta libera. Le righe di regola che oggi chiedono di coprire ogni area (riga ~112) e le indicazioni "verifica camber/differenziale" vicino alle asimmetrie vanno riscritte in modo da non contraddire la sequenza.
- **Livello 2** (`SESSION_SYSTEM_PROMPT`): tabella di stato di tutti i passi. I passi dopo il corrente sono "da rivedere dopo", perché cambiano quando cambia il passo corrente. "Setup attuale vs proposto" contiene solo la leva del passo corrente, sui valori a freddo. Nessun nuovo titolo `##`: vale il vincolo di `prompt-builder.selfcheck.ts`.
- **Setup Fisso** (oggi modificabili solo bilanciamento e pressione frenante): la sequenza mostra i passi 1-2. Il passo 1 viene stampato come informazione ma non è proponibile, perché i condotti non si toccano. Il passo 2 sì **(scelta)**.
- **Leaderboard** **(scelta)**: la sequenza resta; i passi 4-5 sono non valutabili ("gomme fisse a 85 °C (Leaderboard)") e non si stampano le righe "Gomme setup", perché le temperature sono fisse e prive di significato. I passi 1, 2, 3 e 6 si giudicano come al solito. Con Leaderboard e Setup Fisso insieme (il default su R3E) vale la regola di Setup Fisso: passi 1-2.
- **Livello 2, riga assente**: se nei Dati Calcolati c'è la riga "Sequenza setup", "Setup attuale vs proposto" è obbligatoria anche senza setup caricato (tabella dei passi sempre; tabella dei parametri e A → B solo con un setup). Senza la riga e senza setup, la sottosezione si omette; senza la riga ma con un setup, niente tabella dei passi né proposte numerate.
- `<sintesi-vocale>`: invariata.

## Vincoli

- Codice del progetto: arrow function, nessuna `class`, `type` invece di `interface`, commenti in inglese.
- Gate prima di ogni commit: `npm run typecheck && npm run lint && npm run format:check && npm run selfcheck && npm run fallow:check`.
- Nuovi campi tutti opzionali: ogni task compila da solo.
- Le costanti di soglia sono nominate e raccolte in un unico punto di `session-stats.ts`, perché vanno tarate.

## Lasciato al builder

Nomi e forma dei nuovi campi di `ZoneData` e del tipo `setupLadder`; come rilevare la trazione e la presenza dell'ABS; l'ordine dei task; se tenere o rimuovere i campi `*Asym*`; gli offset esatti di `mTyreRPS`.

## Verifica

- Selfcheck:
  - `session-stats`: un caso per ogni stato di ogni passo, il salto dei passi non valutabili, la selezione dei giri (ultimo segmento, dal 4° giro, almeno 2 giri), i quattro punti di calibrazione del Δ;
  - `lap-recorder`: i contatori per zona;
  - `ams2-struct`: l'offset di `mTyreRPS`;
  - stima del raggio e calcolo `sr` AMS2 su frame sintetici;
  - `prompt-builder`: blocco presente o assente (senza sequenza nessuna riga), gerarchia `##` invariata;
  - `channel-log`: i nuovi canali.
- Con i sim accesi, fuori dal gate:
  - riga `canali` di ACE e AMS2 con `tti/ttc/tto` plausibili;
  - verso interna/esterna in curva lunga;
  - `sr` AMS2 vicino a 0 in rettilineo;
  - segno di `slipRatio` ACE: va confermato che un bloccaggio in frenata dia un valore negativo. Il reader oggi lo copia così com'è, senza verifiche. Se ACE restituisse solo il modulo, i passi 2, 3 e 6 diventano `non valutabile` su ACE finché non si ricava lo slip;
  - una sessione vera per tarare le soglie.

## Destino del lavoro precedente

Lo spec `2026-10-20-tyre-pressure-diagnosis-design.md` (commit `32bbf2a`) e il suo piano, mai committato, sono stati eliminati. Il loro contenuto utile è confluito nel passo 4 e nella sezione "Dati nuovi". Dal piano si recuperano `src/main/tyre-temps.ts` (`roundTemps` a 0,1 °C) e il passaggio di `leaderboardMode` a `computeSessionStats` nei tre punti di chiamata in `session-coach.ts`.
