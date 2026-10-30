# Verifica dal vivo — ammortizzatori dall'istogramma della velocità

Data: 2026-10-29. Spec: `docs/superpowers/specs/2026-10-26-quadro-assetto-design.md` §5. Piano: `docs/superpowers/plans/2026-10-28-ammortizzatori-istogramma.md` (commit 2ceeaaf, d8550c3, 2af4d0e, d7633ed).

> **Aggiornamento 2026-10-30**: il confronto fra rebound al minimo e al massimo corregge parte di questo documento. Vedi le ultime due sezioni.

## Esito

- **Registrazione: corretta.** Velocità sospensioni letta, tarata e salvata per zona in ogni giro.
- **Criterio: non discrimina.** +3 click di slow rebound sulle quattro ruote spostano la quota di rebound lento di +1,2 punti all'anteriore e +0,3 al posteriore: dentro la variazione fra un giro e l'altro. La spec (verifica dal vivo, §5) prevede che in questo caso il criterio venga tolto, come le oscillazioni.

## Sessioni confrontate

R3E, Monza (track 1670, layout 1671), auto 12090, practice, 4 giri ciascuna.

| Sessione | Data | Setup | Bump F / R | Rebound F / R | Log |
|---|---|---|---|---|---|
| 54 | 2026-10-29 08:30 | 81, default | 12 / 11 | 14 / 15 | `sdc-20261029-0929.txt` |
| 53 | 2026-10-28 17:48 | 80, +3 click | 12 / 11 | 17 / 18 (post a fondo scala) | `sdc-20261028-1846.txt` |

Le sessioni 50 (default) e 51 (+3) sono state registrate prima del canale `sv` e non hanno l'istogramma.

## Registrazione

- **Calibrazione per giro**: riuscita in tutti gli 8 giri. `k` fra 0,87 e 0,95, sempre unità m/s, sempre compressione positiva: unità e segno stabili, come richiesto dalla spec.
- **Canale `vsosp`**: decine di mm/s, picchi di 100-126 mm/s sui cordoli.
- **Segno coerente con la fisica**: in frenata a 244 km/h l'anteriore comprime (+22/+28 mm/s) e il posteriore si estende (−87/−91 mm/s).
- **DB**: `damperHist` presente in tutte le zone di ogni giro (115-116 su 115-116); 6500-7800 campioni lenti per asse per giro, ben sopra la soglia di 1000.

## Quota di rebound fra i campioni sotto 50 mm/s

| Giro | Default ant | Default post | +3 ant | +3 post |
|---|---|---|---|---|
| 1 | 47,9 % | 47,9 % | 50,0 % | 47,7 % |
| 2 | 48,7 % | 47,8 % | 49,8 % | 48,8 % |
| 3 | 49,0 % | 47,9 % | 48,7 % | 47,9 % |
| 4 | 47,5 % | 48,0 % | 49,6 % | 48,2 % |
| **Media** | **48,3 %** | **47,9 %** | **49,5 %** | **48,2 %** |

- Anteriore: direzione attesa, ma +1,2 punti con intervalli sovrapposti (48,7-49,0 % compare in entrambi).
- Posteriore: nessuno spostamento.
- Con circa 0,4 punti per click servirebbero oltre 15 click per uscire dalla banda 40-65 %: il criterio darebbe `ok` a qualunque setup ragionevole.
- L'ipotesi della spec sui cordoli (quota sopra il 50 % anche con ammortizzatori bilanciati) è smentita: tutte le quote sono fra 47 e 50 %.

Quota di campioni oltre 50 mm/s: default 8,7-12,1 %, +3 6,4-10,9 %; quota di rebound fra questi 50,8-53,2 % contro 50,7-54,3 %.

## Misure alternative provate sui frame grezzi

Ricalcolate da `frames_blob` (frame a velocità ≥ 30 km/h, velocità in mm/s, + = compressione), per vedere se un'altra grandezza separa i due setup.

| Misura | Default (54) | +3 (53) | Separa? |
|---|---|---|---|
| Quota rebound su tutte le velocità, ant | 47,9-49,3 % | 49,1-50,0 % | no |
| Quota rebound su tutte le velocità, post | 48,2-48,4 % | 48,1-49,0 % | no |
| Mediana bump / rebound, ant | 8,2-9,9 / 9,2-11,3 mm/s | 7,6-9,4 / 7,7-10,1 mm/s | no |
| 95° percentile bump / rebound, post | 69,8-86,1 / 77,4-99,2 mm/s | 56,8-81,2 / 65,6-87,7 mm/s | no, si sovrappone |
| RMS velocità, ant | 34,1-49,7 mm/s | 30,5-35,9 mm/s | debole: il giro 4 del default (49,7) varia più della differenza fra setup |

La varianza fra giri (traiettoria, cordoli) domina l'effetto di 3 click.

## Perché non funziona

Su un giro chiuso la sospensione torna al punto di partenza, quindi l'integrale della velocità è nullo: un rebound più frenato dovrebbe solo allungare il tempo in estensione. Su R3E, con 3 click, l'effetto vale circa un punto percentuale, mentre le sollecitazioni della pista cambiano la distribuzione di più da un giro all'altro. A differenza delle oscillazioni il limite non è il campionamento a 33 Hz, che basta per un istogramma, ma la grandezza scelta.

## Aggiornamento 2026-10-30: rebound al minimo e al massimo

Sessioni 55 (rebound 1/1, setup 82) e 56 (18/18, setup 83), stessa auto e pista. Rispetto al default cambiano solo il rebound e il moltiplicatore FFB (1× contro 1,5×), che non tocca la fisica ma può cambiare la guida. Giri validi lanciati: 4, 2, 3 e 3.

| Rebound (ant/post) | Rapporto mediane rebound/bump, ant | Rapporto, post | Mediana rebound, ant/post (mm/s) | Quota rebound lento, ant/post |
|---|---|---|---|---|
| 1/1 minimo (55) | 1,37-1,53 | 1,58-1,68 | 16,0-16,6 / 18,9-19,9 | 43,3 / 40,6 % |
| 14/15 default (54) | 1,07-1,11 | 1,03-1,07 | 10,2-10,6 / 10,5-10,8 | 48,4 / 47,9 % |
| 17/18 (53) | 1,06-1,11 | 0,99-1,07 | 9,9-10,1 / 9,6-10,1 | 49,4 / 48,3 % |
| 18/18 massimo (56) | 1,06-1,16 | 0,97-1,08 | 9,5-10,4 / 9,5-10,2 | 48,8 / 48,6 % |

La quota è la media dei giri dopo il lancio, compresi quelli invalidati.

- **Il segnale esiste, ma solo lontano dal default.** Il minimo si distingue senza sovrapposizioni, su tutti i settori, le fasi e le ruote. Da 14 a 18 click la risposta è quasi piatta. Le sessioni 53 e 56, con lo stesso rebound posteriore, danno gli stessi valori: la misura è ripetibile.
- **Correzioni a quanto scritto sopra.** "Il criterio non discrimina" vale fra default e +3, non in generale. La tabella delle misure alternative includeva il giro di lancio: sui soli giri validi la mediana rebound al posteriore separa default e +3 di circa 0,7 mm/s, con solo 2 giri validi sul default. La stima "oltre 15 click" era un'estrapolazione lineare, e la risposta non è lineare.
- **Il criterio tolto restava sbagliato.** Con la banda 40-65 % anche 1 click al posteriore (40,4-40,7 %) sarebbe stato "ok".
- **Risoluzione stimata del rapporto.** Variazione fra giri circa 0,05: con 4 giri due setup si distinguono da 0,07 in su, cioè 2-3 click al meglio sotto il default, e nulla da 14 a 18 click. Non può dire "troppo rebound" né indicare il valore ottimale.
- **Proposte esterne provate agli estremi.** Il ritorno del muso al rilascio del freno resta rumore. La posizione in curva si sposta nel verso atteso (+0,9 mm al posteriore in 19 zone su 19, +0,4 mm all'anteriore), ma è troppo piccola, sparisce sopra il default e non ha un riferimento assoluto.

## Decisione

Analisi chiusa: si parte sempre dal setup di default, dove un rilevatore del genere non scatterebbe mai. Area 5 `non valutabile` con i valori del setup per asse; tolti giudizio, istogramma, calibrazione e canale `sv`. I frame delle sessioni 53-56 restano nel DB.
