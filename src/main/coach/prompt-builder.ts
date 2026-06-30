/**
 * Builds the Claude API prompt for session-level analysis (Template v3 output).
 *
 * Output format: Italian, engineer tone, numeric data always included.
 * Exposes buildSessionPrompt + SESSION_SYSTEM_PROMPT (consumed by SessionCoachEngine)
 * and getSignificantZones (zone filtering shared with the session prompt).
 */

import { BRAKE_TEMP } from "../../shared/alert-types.js";
import type {
  Alert,
  AnalysisComment,
  Deviation,
  ZoneData,
  LapRow,
  SessionRow,
  SessionSetupRow,
  SessionAnalysisRow,
} from "../../shared/types.js";
import { formatLapTime } from "../../shared/format.js";

/**
 * Select zones that are "interesting" for the analysis:
 * zones with deviations, braking zones, or high TC/ABS activity.
 */
export const getSignificantZones = (
  zones: ZoneData[],
  deviations: Deviation[] | null,
): ZoneData[] => {
  const deviationZones = new Set(deviations?.map((d) => d.zone) ?? []);

  return zones.filter(
    (z) =>
      deviationZones.has(z.zone) ||
      z.maxBrakePct > 0.3 ||
      z.tcActivations > 2 ||
      z.absActivations > 2 ||
      z.overlapFrames > 3,
  );
};

export const SESSION_SYSTEM_PROMPT = `Sei un ingegnere di pista esperto che analizza l'intera sessione di guida di un pilota.
Rispondi SEMPRE in italiano con tono tecnico da ingegnere. Includi SEMPRE dati numerici specifici (durate in secondi, delta secondi, PSI/kPa, km/h, percentuali).
I dati di telemetria riportano durate in millisecondi (1 campione = 16ms). Converti SEMPRE in secondi quando citi questi valori (es. 160ms → 0.16s).

Analizzi più giri e più setup caricati nella sessione. Devi:
- Identificare trend (miglioramento/peggioramento tra giri).
- Confrontare l'effetto dei diversi setup caricati (se più di uno) sulla telemetria e sui tempi.
- Segnalare problemi ricorrenti per curva con volume di alert.
- Se esistono analisi precedenti nella sessione, tieni conto di quanto già detto e aggiungi nuove osservazioni o conferma/smentisci raccomandazioni.

Usa il simbolo ∆ per i delta di tempo. Esprimi sempre le durate in secondi (es. "0.16s di overlap freno/gas"). Calcola sempre l'impatto stimato in secondi per giro.
Quando citi un tempo sul giro usa SEMPRE la forma "il tempo di X" (es. "il tempo di 1:16.322" oppure "il tempo di 58.322s"). Non usare mai l'articolo apostrofato davanti al numero (mai "l'1:16").

---

## FORMATO OBBLIGATORIO - Template v3

### [1] Analisi Telemetria

**Panoramica Sessione:**
Paragrafo con: numero giri, setup utilizzato/i, trend direzionale della sessione. Includi tutti i tempi giro con ∆ rispetto al giro precedente e percentuale di convergenza.

**Trend Giri:**
Lista bullet, uno per transizione Giro N→N+1. Descrivi la causa meccanica del miglioramento/peggioramento (es. stabilizzazione gomme, gestione termica freni, cambio setup).

**Curve Critiche (per volume di alert):**
Lista numerata, ordinata per numero totale di alert. Formato per ogni voce:
  @XXXm NomeCurva: N alert (tipo+durata in secondi, tipo+durata in secondi, …). Causa probabile e comportamento del pilota.

**Osservazioni Pressioni Gomme:** (ometti se dati non disponibili)
Valori FL/FR/RL/RR in PSI/kPa, margine operativo, valutazione bilanciamento ant/post.

**Dati Critici Mancanti:** (ometti se nessuno)
Riporta onestamente quali dati non erano disponibili (es. settori S1/S2/S3, temperature freni) e il loro impatto sull'analisi.

---

### [2] Problemi Identificati

Tabella markdown con colonne: Rank | Problema | Localizzazione | Alert Count | Impatto Stim.
- Rank: numero progressivo per impatto decrescente
- Localizzazione: @XXXm NomeCurva (più localizzazioni separate da virgola)
- Alert Count: numero di alert + descrizione tipo
- Impatto Stim.: range in secondi/giro (es. -0.15 a -0.25s/giro)

**Dettagli per Curva:**
Lista bullet, una per curva critica. Formato:
  @XXXm NomeCurva (NomeUfficiale se disponibile): descrizione comportamento con dati numerici (entry speed, ∆ sterzata %, durate in secondi). Causa meccanica e impatto teorico sul delta.

**Pattern Sistemico:**
Paragrafo di analisi trasversale: confronto alert tra giri, distinzione tra miglioramento da apprendimento pilota vs da gestione termica vs da setup.


---

### [3] Setup Attuale vs Proposto

(Ometti l'intera sezione se nessun setup è stato caricato.)

**Setup "NomeSetup" Analisi:** (usa il nome esatto del setup dal contesto dati, non un numero sequenziale)
Tabella markdown con colonne: Parametro | Valore | Valutazione
Includi tutti i parametri rilevanti: sterzo, ripartizione freno, ARB, molle, ammortizzatori, campanatura, TC/ABS, ala posteriore, pressioni gomme.

**Proposte Concrete:**
Lista numerata. Per ogni proposta:
  N. **Descrizione modifica (Parametro: ValoreAttuale → ValoreNuovo):**
  Paragrafo con razionale meccanico, collegamento agli alert specifici (tipo @XXXm, durata in secondi), effetto atteso.

**Sintesi Setup:**
Paragrafo riassuntivo: punti di forza del setup attuale e trade-off sfavorevoli identificati.


---

### [4] Raccomandazioni Modifiche

**Azioni Concrete per Prossimi Giri:**

Per ogni modifica usa un H3 con label di priorità:
#### Modifica Prioritaria N: DescrizioneBreve (Parametro VecchioValore → NuovoValore)
- **Razionale:** percentuale di variazione, effetto meccanico atteso, collegamento agli alert specifici.
- **Implementazione:** numero setup da caricare, parametri da modificare.
- **Target:** alert/metriche da eliminare (es. "alert sterzata anomala delta >10% scompaiono").
- **Giro di verifica:** quando e dove verificare l'effetto (curva specifica, entry speed).
- **Metrica di successo:** dato numerico misurabile (es. "overlap freno/gas <0.05s; velocità exit +2 km/h").
- **Cautela:** (solo se la modifica ha rischi o effetti collaterali da monitorare)

Usa label "Prioritaria" per modifiche setup che impattano >0.10s/giro, "Secondaria" per 0.05-0.10s, "Terziaria" per <0.05s o condizionali.

---

### [5] Sintesi e Prossimo Step

Paragrafo unico, massimo 3 frasi, SENZA markdown (no asterischi, no grassetto, no bullet).
Menziona: problema più critico con dato numerico specifico, setup o parametro da caricare, tempo target atteso nel giro di validazione.
Questa sezione viene letta ad alta voce - NO elenchi, NO tabelle, NO intestazioni.

---

## Regole Generali
- NOMI CURVE: usa ESCLUSIVAMENTE i nomi presenti nella sezione "## Nomi Curve Autorizzati" del prompt utente. NON dedurre, NON inventare, NON aggiungere nomi da conoscenza esterna del circuito (es. "Bus Stop", "Canada Corner", ecc. non presenti nell'elenco). Se una zona non ha nome nell'elenco, usa SOLO "@XXXm" senza alcun nome aggiuntivo.
- Temperatura freni ideale: 550°C ±137.5°C (finestra 413-688°C). Se valore = -1, ignora.
- Pressioni gomme: PSI per ACE, kPa per R3E (1 bar = 14.5038 PSI).
- R3E Leaderboard: gomme fisse 85°C → non è un problema da segnalare.
- Ogni affermazione deve essere supportata da almeno un dato numerico proveniente dalla telemetria.
- Unità di misura OBBLIGATORIE per il TTS: scrivi SEMPRE l'unità accanto al numero. Distanze: "XXXm" (mai solo "XXX"). Delta tempi: "X secondi" oppure "X s" (mai solo "X" o "~X"). Esempio corretto: "frenata ritardata di 24m", "puoi guadagnare ~0.2 secondi". Il TTS legge "m" come "metri" e "s" come "secondi".

## Sezioni obbligatorie
Le sezioni [1], [3], [4] e [5] devono essere SEMPRE presenti, qualunque sia la quantità di dati disponibili.
La sezione [2] è l'UNICA che può essere omessa (solo se nessun setup è stato caricato).`;

/** Aggregate brake temps across all zones of a lap (best-effort from zones_json). */
const buildBrakeTempSummaryFromZones = (zones: ZoneData[]): string | null => {
  const UNAVAIL = -1;
  const collect = (idx: number): number[] =>
    zones
      .flatMap((z) => (z.avgBrakeTempC ? [z.avgBrakeTempC[idx]] : []))
      .filter((v) => v !== UNAVAIL);

  const fl = collect(0);
  if (fl.length === 0) return null;
  const fr = collect(1);
  const rl = collect(2);
  const rr = collect(3);

  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : UNAVAIL;
  const peak = (arr: number[]) => (arr.length > 0 ? Math.max(...arr) : UNAVAIL);

  const lines = [
    `  Freni: ANT-SX ${avg(fl).toFixed(0)}°C (picco ${peak(fl).toFixed(0)}°C)` +
      ` | ANT-DX ${avg(fr).toFixed(0)}°C (picco ${peak(fr).toFixed(0)}°C)` +
      ` | POST-SX ${avg(rl).toFixed(0)}°C (picco ${peak(rl).toFixed(0)}°C)` +
      ` | POST-DX ${avg(rr).toFixed(0)}°C (picco ${peak(rr).toFixed(0)}°C)`,
  ];

  const allPeaks = [peak(fl), peak(fr), peak(rl), peak(rr)].filter(
    (v) => v !== UNAVAIL,
  );
  const overheating = allPeaks.filter((t) => t > BRAKE_TEMP.max);
  if (overheating.length > 0) {
    lines.push(
      `  ⚠ ${overheating.length} freni oltre soglia critica ${BRAKE_TEMP.max}°C`,
    );
  }
  return lines.join("\n");
};

const summarizeLapZones = (
  zones: ZoneData[],
  cornerNames: Map<number, string>,
): string[] => {
  const significant = getSignificantZones(zones, null).slice(0, 8);
  const lines: string[] = [];
  for (const z of significant) {
    const cname = cornerNames.get(z.zone);
    const label = cname ? `${cname} (@${z.dist}m)` : `@${z.dist}m`;
    const bits: string[] = [];
    bits.push(`min ${z.minSpeedKmh.toFixed(0)}km/h`);
    bits.push(`freno ${(z.maxBrakePct * 100).toFixed(0)}%`);
    bits.push(`gas ${(z.avgThrottlePct * 100).toFixed(0)}%`);
    if (z.tcActivations > 0) {
      const durMs = ((z.tcActiveFrames ?? z.tcActivations) * 16).toFixed(0);
      bits.push(`TC:${z.tcActivations}ev/${durMs}ms`);
    }
    if (z.absActivations > 0) {
      const durMs = ((z.absActiveFrames ?? z.absActivations) * 16).toFixed(0);
      bits.push(`ABS:${z.absActivations}ev/${durMs}ms`);
    }
    if (z.overlapFrames > 3)
      bits.push(`overlap:${(z.overlapFrames * 16).toFixed(0)}ms`);
    lines.push(`  - ${label} → ${bits.join(", ")}`);
  }
  return lines;
};

export type SessionPromptInput = {
  session: SessionRow;
  laps: LapRow[]; // ordered by lap_number asc
  setups: SessionSetupRow[]; // ordered by loaded_at asc
  priorAnalyses: SessionAnalysisRow[]; // ordered by version asc
  cornerNames: Map<number, string>;
  carName?: string;
  trackName?: string;
  layoutName?: string;
  alerts?: Alert[];
  leaderboardMode?: boolean;
  fixedSetup?: boolean;
};

export const buildSessionPrompt = (input: SessionPromptInput): string => {
  const {
    session,
    laps,
    setups,
    priorAnalyses,
    cornerNames,
    alerts,
    leaderboardMode,
    fixedSetup,
  } = input;
  const parts: string[] = [];

  parts.push(`## Sessione`);
  parts.push(`- Gioco: ${session.game.toUpperCase()}`);
  parts.push(`- Auto: ${input.carName ?? session.car}`);
  parts.push(
    `- Circuito: ${input.trackName ?? session.track} (${input.layoutName ?? session.layout})`,
  );
  parts.push(`- Inizio: ${session.started_at}`);

  if (session.game === "r3e") {
    if (leaderboardMode) {
      parts.push(
        `- **Modalità Leaderboard ATTIVA**: temperature e pressioni gomme fisse a 85°C, temperature freni potrebbero non essere significative - non diagnosticare questi valori come problemi.`,
      );
    }
    if (fixedSetup) {
      parts.push(
        `- **Setup Fisso ATTIVO**: il pilota può modificare SOLO bilanciamento freni e pressione frenante. Tutte le altre raccomandazioni di setup (sospensioni, aerodinamica, differenziale, ecc.) non sono applicabili - ometti o segnala esplicitamente questa limitazione nella sezione [3] e [4].`,
      );
    }
  }
  if (session.ended_at) parts.push(`- Fine: ${session.ended_at}`);
  parts.push(`- Giri registrati: ${laps.length}`);
  if (session.best_lap != null)
    parts.push(`- Miglior giro: ${formatLapTime(session.best_lap)}`);
  parts.push("");

  // Explicit corner name whitelist - model must use ONLY these names
  parts.push(`## Nomi Curve Autorizzati (FONTE ESCLUSIVA)`);
  parts.push(
    `REGOLA ASSOLUTA: usa i nomi curva ESCLUSIVAMENTE da questo elenco. NON usare nomi dedotti da conoscenze esterne sul circuito. Se una curva non compare qui, usa SOLO la notazione "@XXXm".`,
  );
  if (cornerNames.size > 0) {
    const sorted = [...cornerNames.entries()].sort(([a], [b]) => a - b);
    for (const [zone, name] of sorted) parts.push(`- Zona ${zone}: ${name}`);
  } else {
    parts.push(
      `- Nessun nome curva disponibile per questo circuito - usa SOLO "@XXXm" per tutte le posizioni.`,
    );
  }
  parts.push("");

  const setupNameById = new Map<number, string>(
    setups.map((s) => [s.id, s.setup.name ?? s.setup.carFound]),
  );

  // Laps missing any sector time cannot be valid - exclude them from analysis.
  const analyzableLaps = laps.filter(
    (l) => l.sector1 != null && l.sector2 != null && l.sector3 != null,
  );

  if (analyzableLaps.length > 0) {
    parts.push(`## Giri`);
    for (const lap of analyzableLaps) {
      const s1 = formatLapTime(lap.sector1!);
      const s2 = formatLapTime(lap.sector2!);
      const s3 = formatLapTime(lap.sector3!);
      const valid = lap.valid ? "✓" : "✗";
      const setupLabel =
        lap.setup_id != null ? setupNameById.get(lap.setup_id) : undefined;
      const setupTag = setupLabel != null ? ` [setup "${setupLabel}"]` : "";
      parts.push(
        `- Giro ${lap.lap_number}: ${formatLapTime(lap.lap_time)} [S1:${s1} S2:${s2} S3:${s3}] ${valid}${setupTag}`,
      );
      if (lap.zones_json) {
        try {
          const zones = JSON.parse(lap.zones_json) as ZoneData[];
          const z0 = zones[0];
          if (z0?.tcSetting !== undefined && z0.tcSetting > 0) {
            if (session.game === "r3e") {
              parts.push(
                `  TC preset: ${z0.tcSetting}/6 | ABS preset: ${z0.absSetting ?? "?"}/6 (scala inversa: 1=massimo, 6=minimo/assente)`,
              );
            } else {
              parts.push(
                `  TC: ${z0.tcSetting} | ABS: ${z0.absSetting ?? "?"}`,
              );
            }
          }
          const summary = summarizeLapZones(zones, cornerNames);
          if (summary.length > 0) parts.push(...summary);
          const btSummary = buildBrakeTempSummaryFromZones(zones);
          if (btSummary) parts.push(btSummary);
        } catch {
          // ignore malformed
        }
      }
    }
    const excluded = laps.length - analyzableLaps.length;
    if (excluded > 0)
      parts.push(
        `*(${excluded} giro/i esclusi perché privi di tempo settore)*`,
      );
    parts.push("");
  }

  if (setups.length > 0) {
    parts.push(`## Setup caricati in sessione (ordine cronologico)`);
    setups.forEach((s) => {
      const label = s.setup.name ?? s.setup.carFound;
      parts.push(`### Setup "${label}" (id=${s.id}, caricato ${s.loaded_at})`);
      parts.push(
        `- Auto: ${s.setup.carFound}${s.setup.carVerified ? " (verificata)" : " (non verificata)"}`,
      );
      for (const p of s.setup.params) {
        parts.push(`- ${p.category} / ${p.parameter}: ${p.value}`);
      }
      parts.push("");
    });
    if (setups.length > 1) {
      parts.push(
        `Confronta i setup sopra elencati in sezione [2] evidenziando le differenze e l'impatto sulla telemetria dei giri associati.`,
      );
      parts.push("");
    }
  } else {
    parts.push(
      `## Setup\nNessun setup caricato in sessione. Ometti la sezione [2] o proponi suggerimenti generici.`,
    );
    parts.push("");
  }

  if (priorAnalyses.length > 0) {
    parts.push(`## Analisi precedenti (riassunto)`);
    for (const a of priorAnalyses) {
      parts.push(`### Analisi #${a.version} (${a.created_at})`);
      if (a.section5_summary) {
        parts.push(`Sintesi: ${a.section5_summary}`);
      } else {
        // Fallback: first ~500 chars of templateV3
        parts.push(a.template_v3.slice(0, 500));
      }
      if (a.comments && a.comments.length > 0) {
        parts.push(`Commenti del pilota e integrazioni su questa analisi:`);
        for (const c of a.comments) {
          parts.push(`- Pilota: ${c.comment}`);
          parts.push(`  Integrazione: ${c.response}`);
        }
      }
      parts.push("");
    }
    parts.push(
      `Questa è l'analisi #${priorAnalyses.length + 1}: tieni conto delle precedenti, conferma o aggiorna i consigli in base ai nuovi dati.`,
    );
    parts.push("");
  }

  if (alerts && alerts.length > 0) {
    const PRIORITY_LABEL: Record<number, string> = {
      1: "P1",
      2: "P2",
      3: "P3",
    };
    parts.push(`## Alert generati in sessione (${alerts.length})`);
    for (const a of alerts) {
      const prio = PRIORITY_LABEL[a.priority] ?? `P${a.priority}`;
      parts.push(`- [${prio}] @${a.dist}m zona ${a.zone}: ${a.message}`);
    }
    parts.push("");
  }

  parts.push(
    `Produci l'analisi nel formato Template v3. Le sezioni [1], [3], [4] e [5] sono SEMPRE obbligatorie.\n` +
      `ATTENZIONE: non interrompere la generazione prima di aver completato [4] Raccomandazioni Modifiche e [5] Sintesi e Prossimo Step.\n` +
      `Se i dati sono pochi, scrivi sezioni più concise - ma NON omettere [4] e [5] in nessun caso.\n` +
      `[5] deve essere un paragrafo singolo di massimo 3 frasi senza markdown.`,
  );
  return parts.join("\n");
};

export const COMMENT_SYSTEM_PROMPT = `Sei un ingegnere di pista esperto. Il pilota ha appena letto una tua analisi di sessione e ti lascia un commento per correggerla o chiederti un'integrazione (es. un parametro di setup non modificabile, una valutazione che ritiene errata, una richiesta di approfondimento mirato).

Rispondi SOLO al commento, in italiano, con tono tecnico da ingegnere. Includi dati numerici quando rilevanti.
La risposta deve essere BREVE e FOCALIZZATA (massimo 4-6 frasi): conferma o correggi la valutazione e, se serve, proponi un'alternativa concreta.
NON riscrivere l'intera analisi. NON usare le intestazioni del Template v3 ([1], [2], [3], [4], [5]). NON produrre tabelle lunghe: al massimo poche righe markdown se indispensabili.
Se il pilota segnala che un parametro non è modificabile, accetta la correzione e proponi una leva alternativa effettivamente disponibile.`;

export type CommentPromptInput = {
  analysisText: string;
  priorComments: AnalysisComment[];
  comment: string;
  carName?: string;
  trackName?: string;
};

export const buildCommentPrompt = (input: CommentPromptInput): string => {
  const parts: string[] = [];
  parts.push(`## Contesto`);
  if (input.carName) parts.push(`- Auto: ${input.carName}`);
  if (input.trackName) parts.push(`- Circuito: ${input.trackName}`);
  parts.push("");
  parts.push(`## Analisi a cui si riferisce il commento`);
  parts.push(input.analysisText);
  parts.push("");
  if (input.priorComments.length > 0) {
    parts.push(`## Commenti e integrazioni precedenti su questa analisi`);
    input.priorComments.forEach((c, i) => {
      parts.push(`### Commento ${i + 1}`);
      parts.push(`Pilota: ${c.comment}`);
      parts.push(`Integrazione: ${c.response}`);
      parts.push("");
    });
  }
  parts.push(`## Nuovo commento del pilota`);
  parts.push(input.comment);
  parts.push("");
  parts.push(
    `Rispondi in modo breve e mirato a questo commento, seguendo le regole del system prompt.`,
  );
  return parts.join("\n");
};
