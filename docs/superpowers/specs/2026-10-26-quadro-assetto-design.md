# Quadro assetto: le guide Frezza fuori dalla sequenza — design

Data: 2026-10-26 · Stato: approvato · Estende `2026-10-20-scaletta-setup-design.md` (la "sequenza setup", sei passi).

Fonti:

- Le guide PDF di Riccardo Frezza in `C:\Google Drive\Guide Riccardo Frezza\` (fuori dal repo, da non versionare): una guida per argomento più la "GUIDA FINITA COMPLETA (ASCIUTTO)", che le concatena e aggiunge solo il capitolo Geared LSD. I numeri di slide citati sono le pagine della guida completa. Le guide sono scritte per AMS2; i concetti valgono per i tre sim.
- Il foglio comunitario "Cars of AMS2" (<https://docs.google.com/spreadsheets/d/1tJ899Wf-ElgVdhXFcQOG8ofQDYKTf8J6Lg8IXavCRxA>, scheda `gid=2095352073`): 208 auto, tutte con peso, distribuzione dei pesi, trazione e tipo di differenziale. Per la 992 GT3 R dà 1.390 kg e 43,8 / 56,2, gli stessi numeri della guida molle di Frezza.

Le decisioni marcate **(utente)** sono state prese dall'utente in questa conversazione; quelle marcate **(scelta)** sono decisioni di design da tarare su sessioni vere.

## Perché

La sequenza setup copre condotti, bilanciamento, freno motore, pressioni, campanatura e differenziale. Quando è tutta a posto l'analisi non ha più una guida: il Livello 2 può proporre su sospensioni, barre, altezze e aerodinamica "citando il dato", ma il modello non conosce le regole di Frezza e nessun giudizio è calcolato in TS. È l'anti-obiettivo della sequenza: il modello che inventa una soglia.

Le guide fuori dalla sequenza (molle, altezze e rake, bumpstop, terze molle, ammortizzatori, barre antirollio, convergenze, aerodinamica, calore delle gomme) contengono regole operative precise: un ordine (molle → altezze → rake → bumpstop → terze molle → ammortizzatori), una formula per le molle, procedure per altezze e bumpstop, tabelle leva → effetto per barre, convergenze e ali.

Successo = a sequenza completa, il Livello 2 mostra un **quadro di tutte le aree dell'assetto**, ognuna con uno stato deciso in TS, il dato che lo sostiene e la direzione secondo Frezza; il Livello 1 propone **una sola** azione, la prima area da correggere.

## Obiettivi

- Un **quadro assetto** calcolato in TS (accanto a `setup-ladder.ts`), stampato nel blocco "## Dati Calcolati" e citato dai prompt.
- Livello 2: il quadro completo **(utente)**, in una nuova sottosezione `### Quadro assetto` di `## Analisi approfondita`.
- Livello 1: resta **una sola azione di setup (utente)**. A sequenza completa è la prima area "da correggere" del quadro, nell'ordine del quadro.
- Nuovi canali di telemetria: **altezza da terra (utente)** sui tre giochi, più velocità delle sospensioni e carico per ruota dove esistono.
- **Distribuzione dei pesi**: misurata dalla telemetria su R3E e ACE, dal foglio "Cars of AMS2" su AMS2 **(utente)**.
- Estrarre in TS i valori numerici del setup che servono ai giudizi (molle, altezze, ammortizzatori, barre, convergenze, ali, presenza delle terze molle).

## Non obiettivi

- Guide e condizioni da bagnato.
- Alert vocali in tempo reale sul quadro: come la sequenza, serve una media su uno stint.
- Rapporti di leva delle sospensioni (motion ratio): nessun gioco li espone; la formula di Frezza li ignora e così fa il quadro.
- Finestre di temperatura gomme assolute per auto: il "verde" dell'HUD cambia da auto ad auto. Il calore gomme si legge solo in relativo.
- Scrivere il setup nel gioco.
- Una tabella auto per R3E e ACE: lì la distribuzione dei pesi si misura.

## Anti-obiettivi (fallimento anche se "funziona")

- Il modello che decide uno stato, una soglia o fa un'aritmetica: ogni giudizio e ogni numero del quadro nasce in TS (stessa regola della sequenza). Unica eccezione, già in uso nella sequenza: "valore attuale ± un passo minimo".
- Più di un'azione di setup al Livello 1.
- Proposte del quadro mentre la sequenza ha un passo corrente: le aree a valle cambiano quando cambia il passo corrente (la stessa ragione per cui la sequenza ha un ordine).
- **Un sintomo corretto da due aree nella stessa analisi** **(scelta)**: ogni sintomo misurato ha un'area "proprietaria"; le altre aree che potrebbero correggerlo lo citano come "vedi area X", senza proposta.
- Un'area nascosta perché non misurabile: è sempre presente, con stato "non valutabile" e motivo.
- Molle usate per correggere sottosterzo o sovrasterzo: la guida le regola solo per l'isofrequenza (slide "Le molle", effetti alla guida "non vanno guardati").

## Il quadro

Le aree, nell'ordine **(utente, dalla playback)**:

1. Molle
2. Altezze da terra e rake
3. Bumpstop
4. Terze molle
5. Ammortizzatori
6. Barre antirollio
7. Convergenze
8. Aerodinamica

Più una riga di diagnosi trasversale, **Calore gomme**, senza stato proprio.

Ogni area ha uno stato: `ok`, `da correggere` (con direzione e numero), `non valutabile` (con motivo). Le aree si giudicano sugli stessi giri giudicati della sequenza (ultimo segmento di setup, gomme a plateau).

**Area corrente** = la prima `da correggere` nell'ordine sopra, solo se la sequenza non ha un passo corrente e non chiede giri. Con un passo corrente il quadro si calcola e si stampa lo stesso, ma tutte le aree sono "da rivedere dopo la sequenza" e senza proposte.

Le aree `non valutabile` si scavalcano dichiarandole, come i passi della sequenza **(utente, regola della sequenza)**. Le molle sono il prerequisito di altezze, bumpstop, terze molle e ammortizzatori: quando le molle sono `non valutabile`, la riga di ognuna di queste aree aggiunge "molle non verificate" al dato **(scelta)**.

**Proposte su più aree** **(utente: "quadro completo", proposte ordinate)**: il Livello 2 dà una proposta per ogni area `da correggere`, numerate nell'ordine del quadro, con l'avvertenza che vanno applicate **una alla volta, in quell'ordine**, e che dopo ogni modifica le aree successive vanno riverificate con un nuovo stint. Il Livello 1 ne propone solo una, l'area corrente.

**Valori proposti** **(scelta)**: l'unico valore calcolato in TS è la molla dell'asse pesante (molla attuale dell'asse leggero × rapporto dei pesi, arrotondata all'intero nell'unità del setup). Per le altre aree TS dà direzione e ruote/asse; il valore è "attuale ± un passo minimo", che il modello legge dal setup, come fa già la sequenza. `SetupParam` non conserva minimo e passo del setup, quindi la variante di Frezza "asse leggero al minimo" non si propone.

**Una sola area proprietaria per sintomo** **(scelta)**: il proprietario di un sintomo è fisso e non dipende da cosa contiene il setup. Quando la leva del proprietario potrebbe mancare sull'auto, la sua direzione porta il ripiego della guida in forma condizionale, es. "avvicinare il bumpstop dell'asse anteriore; se l'auto non ha bumpstop regolabili, alzare le quattro altezze di 2 mm". Le altre aree della tabella citano il sintomo come "vedi area X", senza proposta.

### Sintomi e proprietari **(scelta)**

| Sintomo misurato | Area proprietaria | Altre aree che lo citano |
|---|---|---|
| Molle non isofrequenziali (setup) | Molle | — |
| Auto più alta del necessario (nessun tocco del fondo, margine ampio) | Altezze | — |
| Sottosterzo in inserimento senza ABS dominante (la sequenza lo lascia libero) | Altezze → rake | Barre |
| Fondo che tocca in frenata, sui cordoli o in curva | Bumpstop (direzione con il ripiego "altrimenti Altezze +2 mm") | Altezze |
| Fondo che tocca nei rettilinei veloci | Terze molle (direzione con il ripiego "altrimenti Bumpstop") | Bumpstop, Altezze, Aerodinamica |
| Quota di rebound lento fuori banda (istogramma velocità) | Ammortizzatori | — |
| Sotto/sovrasterzo a centro curva nelle curve lente | Barre | Convergenze |
| Instabilità in rettilineo veloce | Convergenze | — |
| Bilanciamento che cambia con la velocità (lente vs veloci) | Aerodinamica | Barre |

### 1. Molle

Guida "La registrazione delle molle": molle isofrequenziali, rigidezza in proporzione al peso sull'asse. L'asse più leggero al minimo; l'altro = leggero × (peso pesante / peso leggero). Esempio 992 GT3 R: 781,2 / 608,8 = 1,28 → 225 × 1,28 = 288 N/mm.

- Dati: distribuzione dei pesi (vedi "Distribuzione dei pesi"); molle delle quattro ruote dal setup.
- `da correggere` se il rapporto attuale `molla asse pesante / molla asse leggero` differisce dal rapporto dei pesi di oltre **3 % (scelta)**. Proposta: asse pesante = molla attuale dell'asse leggero × rapporto dei pesi, calcolata in TS e arrotondata all'intero.
- Sinistra e destra dello stesso asse diverse: mostrate, mai `da correggere` (2026-10-28). È una scelta legittima sui tracciati a prevalenza di curve nello stesso verso e per il bilanciamento dei pesi sulle ruote; il rapporto usa la media dell'asse.
- `non valutabile`: distribuzione dei pesi sconosciuta; molle assenti dal setup; nessun setup caricato.

### 2. Altezze da terra e rake

Guida "Le altezze da terra": più bassa possibile (tenuta e velocità di punta); dopo le molle, anteriore al minimo mantenendo il rake del preset; se tocca e si scompone, +2 mm su tutte e quattro; poi il rake. Rake positivo = inserimento migliore, accelerazione più difficile; negativo = il contrario. Il rake è "una prima correzione dopo la regolazione delle molle".

- Dati: altezza da terra per ruota (ACE: per asse) dalla telemetria; altezze del setup.
- **Troppo alta**: nessun evento "fondo" e altezza minima del giro per asse > **15 mm (scelta)** → abbassare di un click, entrambi gli assi dello stesso numero di mm (mantiene il rake).
- **Rake**: sottosterzo in inserimento in più della metà delle curve (`cornersEntryUnder`, già contato) **e** la sequenza non lo ha preso al passo 2 (senza ABS, o ABS sotto soglia) → più rake (posteriore più alto o anteriore più basso). Sovrasterzo o pattinamento in uscita appartengono già al passo 6 e qui non si usano.
- Il tocco del fondo non è di quest'area (vedi Bumpstop/Terze molle), salvo il ripiego "+2 mm su tutte e quattro" quando il bumpstop non è regolabile.
- `non valutabile`: senza altezza da terra in telemetria.

### 3. Bumpstop

Guida "I bumpstop": regolazione facoltativa. Altezze al minimo; se il fondo tocca, avvicinare il bumpstop finché non tocca più; se il bumpstop non ha corsa sufficiente, alzare le quattro altezze dello stesso numero di mm.

- **Evento "fondo"** **(scelta)**: altezza da terra < **3 mm** per ≥ 3 frame consecutivi su una ruota (ACE: un asse). Classificato per fase: rettilineo veloce (|gLat| < 0,3 g, nessuna frenata, velocità > 70 % della massima del giro), frenata (`brk > 0,30`), altro (curva, cordoli).
- **Si scompone** **(scelta)**: entro 0,5 s dall'evento, inversione di segno dello sterzo con |Δ gLat| > 0,3 g.
- `da correggere` se ci sono eventi in frenata o "altro" che scompongono l'auto in più del **10 % dei giri giudicati (scelta)** → "avvicinare il bumpstop dell'asse che tocca; se l'auto non ha bumpstop regolabili, o sono già al massimo, alzare le quattro altezze di 2 mm". L'area resta proprietaria anche quando il setup caricato non mostra i bumpstop.
- Tocchi che non scompongono l'auto: `ok` con il conteggio (la guida: "se tocca ma non si scompone, si passa al rake").
- `non valutabile`: senza altezza da terra.

### 4. Terze molle

Guida "Le terze molle": contrastano lo schiacciamento aerodinamico alle alte velocità senza irrigidire le molle d'angolo.

- `da correggere` se ci sono eventi "fondo" nei rettilinei veloci → "irrigidire la terza molla dell'asse che tocca; se non basta, +1 mm alle altezze mantenendo il rake; se l'auto non ha terze molle, avvicinare i bumpstop dell'asse che tocca". L'area resta proprietaria anche quando il setup caricato non mostra le terze molle.
- Auto troppo alta in rettilineo ma non in curva (altezza in rettilineo veloce − altezza a centro curva > **10 mm, scelta**) → ammorbidire le terze molle.
- `non valutabile`: senza altezza da terra.

### 5. Ammortizzatori

Guida "Gli ammortizzatori": prima molle isofrequenziali, poi i quattro ammortizzatori con gli stessi valori; oscillazioni prolungate → più slow rebound sulle quattro, se non basta anche slow bump; fast bump/rebound al minimo su AMS2, salvo cordoli digeriti male (prima verificare altezze e bumpstop).

- **Setup: non giudicato** (2026-10-28). La guida parte dai quattro ammortizzatori uguali come metodo di costruzione, non come regola di correttezza: anteriore diverso dal posteriore è la norma, sinistra diversa da destra è una scelta sui tracciati a senso prevalente. I valori del setup, quando caricato, si mostrano per asse accanto al giudizio, mai come correzione.
- **Oscillazioni: non giudicate** (verifica live del 2026-10-28). Il contatore previsto (semiperiodi con |velocità| > 30 % del picco entro 1 s, ≥ 3 in più del 20 % dei picchi) non misura lo smorzamento: su R3E a Monza, Porsche 911 GT3 R, +3 click di slow rebound sulle quattro ruote hanno lasciato la quota al 65-74 %, come il setup di default (61-74 %). I picchi sono quasi tutti cordoli, e i frame a 33 Hz sono troppo radi per il decadimento libero.
- **Istogramma della velocità degli ammortizzatori** (2026-10-28, criterio scelto da Claude su richiesta dell'utente). La distribuzione delle velocità si stima anche con campioni radi, a differenza del decadimento, purché la velocità sia quella istantanea del gioco e non una differenza di corse: R3E `Player_SuspensionVelocity`, AMS2 `mSuspensionVelocity` (offset 7356, tra `mSuspensionTravel` e `mAirPressure`); ACE non la espone → `non valutabile`. Riferimento: gli istogrammi di velocità ammortizzatori di TelemetryTool e la pratica d'ingegneria (simmetria compressione/estensione).
  - **Calibrazione per giro**, perché segno e unità della velocità non sono documentati né verificati dal vivo: la velocità del gioco si confronta con la derivata della corsa (`sus`) tra frame consecutivi. Pendenza `k = Σ v·d / Σ d²` con |k| fra 0,3 e 3 → m/s, fra 300 e 3000 → mm/s; altrimenti il canale è assente (offset o unità sbagliati), mai un giudizio. Il verso della compressione è quello in cui si sposta la corsa anteriore in frenata forte (l'avantreno affonda); giro senza frenate forti → canale assente.
  - **Grandezza giudicata**: per asse, la quota di campioni in estensione (rebound) fra quelli sotto **50 mm/s (scelta)**, il campo dello slow damping; esclusi i frame sotto 30 km/h. Ammortizzatori bilanciati danno una quota vicina al 50 %: la corsa torna sempre al punto di partenza, quindi un rebound più frenato si allunga nel tempo. Banda accettata **40-65 % (scelta, da tarare)**: il rebound è di norma più duro del bump.
  - `da correggere` quando un asse esce dalla banda; si corregge solo l'asse più lontano dalla banda (l'altro resta come dato), così il modello non sceglie. Quota sopra 65 % → "meno slow rebound" su quell'asse; sotto 40 % → "più slow rebound". Leva unica: la guida mette il rebound per primo.
  - Mostrati ma non giudicati: la quota di campioni oltre 50 mm/s per asse (cordoli; la guida vuole il fast al minimo salvo cordoli digeriti male) e i valori del setup.
- `non valutabile`: velocità ammortizzatori non disponibile (ACE, registrazioni precedenti, calibrazione fallita); meno di **1000 campioni lenti (scelta)** per asse.

### 6. Barre antirollio

Guida "Le barre anti rollio": agiscono solo sul rollio, quindi solo quando si usa lo sterzo (trail braking, percorrenza, accelerazione graduale). Anteriore più rigida = più sottosterzo; più morbida = più sovrasterzo e bloccaggi dell'anteriore interna. Posteriore più rigida = più rotazione, più sovrasterzo amplificato dal differenziale; più morbida = sottosterzo.

- Dati: bilanciamento a **centro curva nelle curve lente** (velocità media della fase < **100 km/h, scelta**, era 120 fino al 2026-10-27: sotto i 100-120 km/h l'aerodinamica è trascurabile, guida "Introduzione aerodinamica").
- Metriche nuove, contate da `ladder-counters` sulle curve che già delimita **(scelta, da tarare)**:
  - sovrasterzo a centro curva = frame di controsterzo (segno dello sterzo opposto a quello di gLat) in più del 15 % dei frame della fase;
  - sottosterzo a centro curva = per ≥ 300 ms lo sterzo cresce di oltre il 20 % mentre |gLat| varia meno del 2 %.
- `da correggere` se più della metà delle curve lente mostra lo stesso sintomo → sottosterzo: "barra anteriore più morbida o posteriore più rigida"; sovrasterzo: il contrario. Il Livello 2 sceglie quale delle due in base al setup; il Livello 1 propone quella anteriore **(scelta: è la prima che la guida descrive)**.
- `non valutabile`: senza `gLat` o senza curve lente.

### 7. Convergenze

Guida "Convergenze e divergenze": rifinitura di un setup già costruito. Anteriore divergente = più direzionalità con poco sterzo, instabile in rettilineo, sottosterzo a centro curva; anteriore convergente = stabile in rettilineo. Posteriore divergente = più rotazione, meno stabilità in accelerazione; convergente = il contrario.

- **Instabilità in rettilineo** **(scelta)**: nei rettilinei veloci (velocità > 150 km/h, |gLat| < 0,2 g) inversioni di sterzo con ampiezza > 0,01 oltre una soglia per km (da tarare) → "più convergenza anteriore (o meno divergenza)".
- `non valutabile`: senza sterzo o senza rettilinei veloci.

### 8. Aerodinamica

Guida "Introduzione aerodinamica": più carico davanti = più sovrasterzo e meno velocità; più carico dietro = più sottosterzo e meno velocità; effetti sopra 100-120 km/h. I condotti freni e il radiatore aumentano la resistenza.

- **Bilanciamento con la velocità** **(scelta, rivista il 2026-10-27)**: gli stessi rilevatori di sotto/sovrasterzo a centro curva delle curve lente, applicati alle curve veloci (> **120 km/h**; era 160 fino al 2026-10-27, ma a Monza Lesmo, Ascari e Parabolica stanno a 120-155 km/h a centro curva e nessuna curva risultava veloce). Sottosterzo in più della metà delle veloci e al massimo nella metà delle lente (< 100 km/h) → "più carico anteriore (o meno posteriore)"; sovrasterzo nello stesso modo → "più carico posteriore (o meno anteriore)"; lo stesso sintomo in entrambe le classi è delle barre (area 6). Il rapporto dei `k` non si usa: misura il gradiente di sottosterzo, non l'aerodinamica.
- Informazione, senza stato: quota di carico aerodinamico per asse dalla regressione del carico ruota (R3E, ACE; vedi sotto); velocità massima per giro.
- `non valutabile`: meno di **3 curve (scelta)** per classe di velocità.

### Calore gomme (diagnosi trasversale)

Guida "Il calore delle gomme": una gomma fuori temperatura dà un sintomo preciso (anteriore sinistra → sottosterzo nelle curve a destra e bloccaggi in quelle a sinistra, e così via). Il primo rimedio sono i condotti, che però spostano bilanciamento e pressioni.

- Una riga, nessuno stato: differenza di temperatura media (carcassa, altrimenti centro superficie) anteriore − posteriore e sinistra − destra.
- Se concorda con il sintomo di un'area (es. anteriori più calde e sottosterzo a centro curva), la riga dell'area lo cita come conferma. Differenze sotto **5 °C (scelta)**: nessuna conferma.

## Dati nuovi

### Canali di telemetria

Si aggiungono a `CompactFrame`, con la regola esistente: un gioco che non ha il canale lo omette, e `aggregateZones` decide la presenza per canale.

| Canale | R3E | ACE | AMS2 |
|---|---|---|---|
| Altezza da terra (m) | `Player_RideHeight[4]` (unità da verificare) | `rideHeight[2]` @268, per asse (anteriore, posteriore) | `mRideHeight[4]`, cm → m. Aggiunta AMS2, assente da `SharedMemory.h` di pCARS2: offset da calcolare sulla struct v14 |
| Velocità sospensione (m/s) | `Player_SuspensionVelocity[4]` | assente: derivata da `suspensionTravel` | `mSuspensionVelocity[4]` (subito dopo `mSuspensionTravel`) |
| Carico ruota (N) | `TireLoad[4]` (già nella struct) | `wheelLoad[4]` @72 | assente |

Fonte della struct AMS2 per i nuovi campi: `Structs/AMS2Page.cs` di [AMS2SharedMemoryNet](https://github.com/Domaslau/AMS2SharedMemoryNet). Tutti gli offset nuovi vanno verificati dal vivo con `channel-log` (stessa procedura delle temperature ACE) e asseriti in `ams2-struct.selfcheck.ts` dove possibile.

### Distribuzione dei pesi

- **R3E e ACE, misurata** **(utente)**: campioni in linea retta senza trasferimenti (|gLat| < 0,05 g, |gLon| < 0,05 g, |sterzo| < 0,02, velocità ≥ 30 km/h, **scelta**). Per asse, regressione lineare del carico contro v²: l'intercetta è il carico statico, la pendenza il carico aerodinamico. Quota anteriore = statico anteriore / statico totale. Servono almeno **300 campioni (scelta)** sui giri giudicati, altrimenti sconosciuta. Si riporta anche il carburante medio dei campioni (la guida pesa l'auto a vuoto).
- **AMS2, dal foglio "Cars of AMS2"** **(utente)**: colonna `weight_distribution` ("43.8 / 56.2" = anteriore / posteriore).

### Tabella auto AMS2 **(scelta)**

- Una copia del foglio salvata nel repo come file di dati (JSON), generata da uno script che scarica la scheda in CSV (`/export?format=csv&gid=2095352073`), come i dati generati delle curve R3E. Campi tenuti: nome, peso, distribuzione dei pesi, trazione, tipo di differenziale, serbatoio, motore. Attribuzione alla fonte nell'intestazione del file.
- Associazione con il nome auto di AMS2 (`mCarName`, salvato nelle sessioni): confronto per nome normalizzato (minuscole, spazi e punteggiatura). **Da verificare dal vivo**: non è ancora noto se i nomi della memoria condivisa coincidono con quelli del foglio. Un'auto non trovata viene registrata nel log e le molle risultano "non valutabile: auto non presente nella tabella".
- Usi nella sequenza esistente **(scelta)**:
  - trazione dalla tabella al posto della stima dallo slip (passi 3 e 6) su AMS2;
  - differenziale `FIXED`, `SPOOL` o `OPEN` → passo 6 "non valutabile: differenziale non regolabile";
  - `G-LSD` / `GC-LSD` → la riga del passo 6 nomina bias ratio power/coast invece delle rampe.

### Valori del setup in TS

La sequenza si era data la regola "nessuno strato di normalizzazione dei setup": la scelta del parametro la faceva il modello. Il quadro non può rispettarla, perché molle, ammortizzatori e terze molle si giudicano sui **numeri** del setup. **Si cambia (scelta)**, in modo limitato:

- Un estrattore puro che, dato `SetupParam[]` e il gioco, restituisce solo i valori numerici che il quadro usa: molla, altezza, slow/fast bump e rebound per ruota; barra anteriore/posteriore; convergenza anteriore/posteriore; ali/carico anteriore e posteriore; presenza e valore delle terze molle; bumpstop per ruota. Un valore non trovato è assente, mai zero.
- R3E: id deterministici del JSON (`SpringsFrontLeft`, `RideHeight…`, `Bump…`, `FastRebound…`, `AntiRollBar…`, `Toein…`, `Wing…`/`Splitter…`). Il minimo e il passo (`minValue`, `stepSize`) sono noti.
- ACE: etichette fisse di `ace-setup-reader.ts`.
- AMS2: il prompt di Claude Vision (`ams2-setup-vision.ts`) riceve una lista di **nomi canonici obbligatori** per questi parametri (es. "Molla FL", "Slow Bump FL", "Terza molla anteriore"), così l'estrattore li trova; gli altri parametri restano liberi.
- Il resto del setup continua ad arrivare al modello come testo, come oggi.
- **Parametro assente** **(utente)**: su nessuno dei tre giochi un parametro assente prova che l'auto non abbia quella regolazione. R3E: il parser scarta le voci `disabled` del JSON. ACE: il `.carsetup` può non contenere un campo. AMS2: la schermata di quella pagina può non essere stata acquisita. Quindi:
  - le aree giudicate sulla **telemetria** (altezze, bumpstop, terze molle, barre, convergenze, aerodinamica) restano `da correggere` quando il sintomo c'è, con la direzione condizionale del proprietario (vedi "Una sola area proprietaria per sintomo");
  - i giudizi sui **numeri del setup** (isofrequenza delle molle) diventano `non valutabile` con motivo "parametro non presente nel setup caricato".

## Output

### `SessionStats`

Un nuovo campo accanto a `setupLadder` (nome al builder): per ogni area `{ n, label, status, reason, owner }`, l'area corrente o `null`, la riga calore gomme, la distribuzione dei pesi usata (con fonte: misurata/tabella) e i dati informativi (carico aerodinamico per asse, velocità massima).

### Blocco "Dati Calcolati"

Dopo le righe della sequenza, una riga "Quadro assetto" e una riga per area, nello stesso stile dei passi: `  1 molle: DA CORREGGERE — rapporto 1,10, pesi 1,28 (tabella AMS2) → molle posteriori 288 N/mm`. Con la sequenza che ha un passo corrente, ogni riga porta "(da rivedere dopo la sequenza)".

### Prompt

- **Livello 2**: nuova sottosezione `### Quadro assetto` dopo `### Setup attuale vs proposto`, con la tabella "Area | Stato | Dato | Direzione" con tutte le aree e la riga calore gomme. Proposte numerate "Parametro: attuale → nuovo" per ogni area `da correggere`, solo se la sequenza non ha un passo corrente e un setup è caricato. Senza setup: solo direzioni. Resta valido il vincolo dei titoli: solo `## Analisi sintetica` e `## Analisi approfondita` sono radici; `prompt-builder.selfcheck.ts` va esteso alla nuova sottosezione.
- **Livello 1**: invariato quando la sequenza ha un passo corrente. A sequenza completa, l'unica azione di setup è l'area corrente del quadro, citandone la riga. Nessuna area corrente → nessuna azione di setup.
- La riga del Livello 2 che oggi limita le "altre aree" a semplici osservazioni viene sostituita dal quadro.
- `stintReadyMessage` **(scelta)**: con "nessun passo da correggere", se c'è un'area corrente la nomina ("Sequenza completa, prima area dell'assetto: barre antirollio").

## Vincoli

- Giudizi puri in TS, soglie come costanti nominate in cima al modulo, ogni area asserita da un selfcheck (`*.selfcheck.ts`).
- Presenza per canale: un canale assente produce "non valutabile" con motivo, mai uno zero.
- Tabelle per gioco nel DB (suffisso `_r3e` / `_ace` / `_ams2`), mai una tabella condivisa con una colonna `game`.
- Unità: altezze in mm nel testo per il modello; molle nell'unità del setup.
- Leaderboard (R3E): gomme fisse a 85 °C, quindi la riga calore gomme non si stampa. Setup Fisso (R3E): il quadro si calcola come informazione, ma nessuna area è proponibile (le molle e le altre leve non si possono modificare).

## Lasciato al builder

- Dove salvare gli aggregati per giro (somme della regressione del carico, eventi "fondo", metriche di centro curva): `zones_json`, una nuova colonna per giro, oppure una nuova lettura di `frames_blob` in fase di analisi. Vincolo: nessuna tabella condivisa tra giochi.
- Il nome del modulo e del campo in `SessionStats`.
- Le soglie marcate **(scelta)**: valori di partenza da tarare.
- Il formato esatto della riga della tabella AMS2 e lo script di aggiornamento.

## Verifica

- Selfcheck: estrattore del setup sui tre giochi (con fixture JSON R3E, etichette ACE, nomi canonici AMS2); ogni area (`ok`, `da correggere`, `non valutabile`); regola "un sintomo, un'area"; regressione della distribuzione dei pesi su dati sintetici con aerodinamica nota; associazione dei nomi auto AMS2.
- Ammortizzatori, dal vivo su R3E e AMS2: la riga `channel-log` mostra `vsosp` in decine/centinaia di mm/s; una sessione con +3 click di slow rebound sulle quattro ruote deve alzare la quota di rebound lento rispetto al setup di partenza. Se non si sposta, il criterio va tolto come le oscillazioni.
- Dal vivo, per ogni gioco: la riga `channel-log` mostra altezza da terra, velocità sospensioni e carico ruota plausibili (altezza: decine di mm che scendono in frenata e ad alta velocità; carico: somma ≈ peso × 9,81 a bassa velocità); la distribuzione misurata di un'auto R3E o ACE confrontata con il dato pubblicato; il nome di almeno tre auto AMS2 trovato nella tabella.
- Gate del repo: `npm run typecheck && npm run lint && npm run format:check && npm run selfcheck && npm run fallow:check`.

## Scelte del piano e decisioni d'implementazione (2026-10-27)

- La velocità delle sospensioni si deriva dalla corsa (`sus`) per tutti e tre i giochi, per scelta: un solo metodo (R3E mappa `Player_SuspensionVelocity`, ACE non ne ha). *(2026-10-28: superata dal §5, l'istogramma usa la velocità istantanea del gioco su R3E e AMS2; la derivata della corsa serve solo a calibrarne segno e unità.)*
- L'estrattore del setup si limita a molle e quattro famiglie di ammortizzatori; le altre leve restano fuori.
- Ammortizzatori uniformi entro un click (`DAMPER_SPREAD_CLICKS`), come al §5. *(2026-10-27: era 5 %, ma segnalava i setup di default di R3E e ACE, che differiscono di un click fra anteriore e posteriore. 2026-10-28: tolto del tutto, vedi §5.)*
- Gli aggregati per giro stanno in `zones_json`, nessuna nuova colonna né lettura di `frames_blob`.
- Soglia bumpstop come eventi per giro giudicato, non per giro registrato.
- Il carburante si legge solo su R3E e ACE.
- Bersaglio molle con il rapporto di pesi esatto (289, non il 288 arrotondato di Frezza).
- Altezza da terra con mediana del giro (medie per asse) fuori da 5–300 mm = assente (offset o unità sbagliati, il caso tutto a zero incluso).
- Quota aerodinamica solo se almeno l'1 % del carico statico.
- Ricerca auto AMS2 normalizzata (minuscole, accenti, punteggiatura → spazio); i nomi le cui righe differiscono sono ambigui → `null` (9 casi).
- Peso plausibile 100–6000 kg, verificato nello script di aggiornamento della tabella.
- Area 2 `na` senza altezza da terra (vince il §2 della spec sul piano).
- Guardia ABS sul rake (§2 della spec).
- Il quadro si stampa solo quando non mancano giri (`lapsMissing === 0`).
- Area 8 giudicata sul sintomo a centro curva delle curve veloci contro quello delle lente (`cornersFastUnder/Over`), non sul rapporto dei `k` (gradiente di sottosterzo, non aerodinamica).
