# Verifica dal vivo — ammortizzatori dall'istogramma della velocità

Data: 2026-10-29. Spec: `docs/superpowers/specs/2026-10-26-quadro-assetto-design.md` §5. Piano: `docs/superpowers/plans/2026-10-28-ammortizzatori-istogramma.md` (commit 2ceeaaf, d8550c3, 2af4d0e, d7633ed).

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

## Proposta

1. **Raccomandata — togliere tutto**: area 5 torna `non valutabile` con i valori del setup mostrati per asse; via l'istogramma per zona (`damperHist`), la calibrazione e il canale `sv`. Diff più piccolo, nessun dato registrato e mai usato. I frame delle sessioni 53 e 54 restano nel DB per riprovare un'altra misura.
2. **Togliere solo il giudizio**: canale `sv` e riga `vsosp` restano nel log per prove future.

In entrambi i casi la spec §5 va aggiornata con questi numeri, come già fatto per le oscillazioni.
