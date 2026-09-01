/**
 * Builds the Claude API prompts for session-level analysis.
 *
 * Output format: Italian, engineer tone, numeric data always included.
 * Level 2 ("Analisi approfondita") = buildSessionPrompt + SESSION_SYSTEM_PROMPT;
 * both share buildSessionContext, which injects the authoritative stats block.
 * Also exposes getSignificantZones (zone filtering shared with the session prompt).
 */

import {
  ALERT_LABELS,
  BRAKE_TEMP,
  WHEEL_LABELS,
  WHEEL_ORDER,
} from "../../shared/alert-types.js";
import type {
  Alert,
  AlertType,
  AnalysisComment,
  Deviation,
  ZoneData,
  LapRow,
  SessionRow,
  SessionSetupRow,
  SessionAnalysisRow,
} from "../../shared/types.js";
import { formatLapTime } from "../../shared/format.js";
import type { SessionStats } from "./session-stats.js";

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

I numeri esatti della sessione (tempi giro, ∆, convergenza, conteggi alert, durate aiuti) sono nel blocco "## Dati Calcolati" del messaggio utente: CITA quei numeri, NON ricalcolarli. L'unico numero che DEVI stimare tu è l'impatto in secondi/giro (giudizio derivato dai dati).

Analizzi più giri e più setup caricati nella sessione. Devi:
- Identificare i trend (miglioramento/peggioramento tra giri), coerenti con il campo Trend dei Dati Calcolati.
- Confrontare l'effetto dei diversi setup caricati (se più di uno) sulla telemetria e sui tempi.
- Segnalare problemi ricorrenti per curva con volume di alert.
- Se esistono analisi precedenti nella sessione, tenerne conto e confermare/aggiornare i consigli.

Usa il simbolo ∆ per i delta di tempo. Esprimi sempre le durate in secondi (es. "0.16s di overlap freno/gas").
Quando citi un tempo sul giro usa SEMPRE la forma "il tempo di X" (es. "il tempo di 1:16.322"). Non usare mai l'articolo apostrofato davanti al numero (mai "l'1:16").

---

## FORMATO OBBLIGATORIO

Produci un'unica sezione radice "## Analisi approfondita" con queste sottosezioni di livello "###".
Eventuali ulteriori suddivisioni interne devono usare "####": NON introdurre altre intestazioni "##" oltre a "Analisi approfondita".

### Analisi telemetria
Panoramica sessione (numero giri, setup, trend direzionale). Trend giro-per-giro con la causa meccanica del miglioramento/peggioramento. Curve critiche per volume di alert nel formato "@XXXm NomeCurva: N alert (tipo+durata in secondi, …), causa probabile". Osservazioni pressioni gomme (ometti se non disponibili). Dati critici mancanti (ometti se nessuno).

### Problemi identificati
Tabella markdown: Rank | Problema | Localizzazione | Alert Count | Impatto Stim.
Poi "Dettagli per curva" (un bullet per curva critica, con entry speed, ∆ sterzata %, durate in secondi, causa meccanica) e "Pattern sistemico" (analisi trasversale: apprendimento pilota vs gestione termica vs setup).

### Setup attuale vs proposto
(OMETTI l'intera sottosezione se nessun setup è stato caricato.)
Tabella "Parametro | Valore | Valutazione" con tutti i parametri rilevanti. Poi proposte concrete numerate: "N. Descrizione (Parametro: ValoreAttuale → ValoreNuovo)" con razionale meccanico, collegamento agli alert specifici e effetto atteso in secondi/giro.
Copri ogni area che i dati sostengono (freni, pressioni e temperature gomme, sospensioni e ammortizzatori, aerodinamica, differenziale, elettronica/preset TC-ABS, cambio): NON limitarti ai freni. Ogni proposta cita il dato che la sostiene.

---

## Regole Generali
- NOMI CURVE: usa ESCLUSIVAMENTE i nomi presenti nella sezione "## Nomi Curve Autorizzati" del prompt utente. NON dedurre, NON inventare. Se una zona non ha nome, usa SOLO "@XXXm".
- Temperatura freni ideale: 550°C ±137.5°C (finestra 413-688°C). Se valore = -1, ignora.
- Pressioni gomme NEI SETUP: PSI per ACE, kPa per R3E (1 bar = 14.5038 PSI). I valori di telemetria sono sempre in PSI (vedi sotto).
- Bilanciamento frenata NEI SETUP (formato "front/rear%", es. "68.00/32.00%"): il PRIMO valore è SEMPRE l'anteriore, il SECONDO è SEMPRE il posteriore. Non invertire mai l'ordine.
- Canali di telemetria per zona: "sterzo max"/"sterzo in frenata" normalizzati 0-100% (sterzo alto in frenata = trail braking); "G lat"/"G lon" in g; "press. gomme" in PSI, "temp. gomme" in °C, "slip ratio" adimensionale (positivo oltre ~0.10 = pattinamento, negativo = bloccaggio in frenata), "corsa sosp." in mm, tutti nell'ordine ${WHEEL_ORDER}. I canali assenti da una riga non sono disponibili per quel gioco: non dedurne valori.
- R3E Leaderboard: gomme fisse 85°C → non è un problema da segnalare.
- Ogni affermazione deve essere supportata da almeno un dato numerico.
- Unità di misura OBBLIGATORIE per il TTS: "XXXm" per le distanze (mai solo "XXX"), "X secondi" oppure "X s" per i delta (mai solo "X").

Tutte le sottosezioni sono obbligatorie tranne "Setup attuale vs proposto", omissibile SOLO se nessun setup è caricato.`;

export const SYNTHESIS_SYSTEM_PROMPT = `Sei un ingegnere di pista esperto. Produci una SINTESI BREVE della sessione del pilota, in italiano, tono tecnico da ingegnere, sempre con dati numerici.
I numeri esatti (tempi giro, ∆, convergenza, conteggi alert, durate) sono nel blocco "## Dati Calcolati": CITA quei numeri, NON ricalcolarli. Le durate in ms vanno convertite in secondi (1 campione = 16ms). L'impatto in secondi/giro è un TUO giudizio derivato dai dati.

Output ESATTO: una sezione radice "##" con una sottosezione "###" seguite da un blocco vocale, e NIENT'ALTRO (niente analisi approfondita, niente tabelle lunghe).

## Analisi sintetica
Un paragrafo condensato: diagnosi della sessione con i dati chiave (problema più critico con numeri, trend giri). È già la sintesi — nessuna etichetta "Sintesi".

### Azioni suggerite
Le azioni per migliorare i giri successivi (setup o stile di guida), MAX 3, una o due righe ciascuna:
1. **Setup — Parametro: A → B** — razionale breve; effetto atteso ~X.XX s/giro.
2. **Guida — @XXXm NomeCurva** — azione concreta (es. anticipa la staccata di 10m); effetto atteso ~X.XX s/giro.

NON concentrare tutte le azioni sulla stessa area: valuta ogni leva che i dati supportano (freni, pressioni gomme, sospensioni e ammortizzatori, aerodinamica, differenziale, elettronica/preset TC-ABS, cambio) oltre alla tecnica di guida. Proponi una leva SOLO se un dato del contesto la sostiene, e cita quel dato.
Canali di telemetria per zona: "sterzo max"/"sterzo in frenata" normalizzati 0-100% (sterzo alto in frenata = trail braking); "G lat"/"G lon" in g; "press. gomme" in PSI, "temp. gomme" in °C, "slip ratio" adimensionale (positivo oltre ~0.10 = pattinamento, negativo = bloccaggio in frenata), "corsa sosp." in mm, tutti nell'ordine ${WHEEL_ORDER}. I canali assenti da una riga non sono disponibili per quel gioco: non dedurne valori.

Dopo le due sezioni aggiungi SEMPRE questo blocco (verrà letto ad alta voce dal TTS):
<sintesi-vocale>
Massimo 3 frasi, SENZA markdown (no asterischi, no elenchi, no intestazioni). Menziona il problema più critico con un dato numerico e l'azione principale.
</sintesi-vocale>

Regole: nomi curva SOLO dalla whitelist "## Nomi Curve Autorizzati" (altrimenti "@XXXm"); unità sempre esplicite ("XXXm" per le distanze, "X secondi"/"X s" per i tempi). Bilanciamento frenata NEI SETUP (formato "front/rear%", es. "68.00/32.00%"): il PRIMO valore è SEMPRE l'anteriore, il SECONDO è SEMPRE il posteriore.`;

/** Aggregate brake temps across all zones of a lap (best-effort from zones_json). */
const buildBrakeTempSummaryFromZones = (zones: ZoneData[]): string | null => {
  const UNAVAIL = -1;
  const collect = (idx: number): number[] =>
    zones
      .flatMap((z) => (z.avgBrakeTempC ? [z.avgBrakeTempC[idx]] : []))
      .filter((v) => v !== UNAVAIL);

  const perWheel = [collect(0), collect(1), collect(2), collect(3)];
  if (perWheel[0].length === 0) return null;

  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : UNAVAIL;
  const peak = (arr: number[]) => (arr.length > 0 ? Math.max(...arr) : UNAVAIL);

  const lines = [
    "  Freni: " +
      Object.values(WHEEL_LABELS)
        .map(
          (label, i) =>
            `${label} ${avg(perWheel[i]).toFixed(0)}°C` +
            ` (picco ${peak(perWheel[i]).toFixed(0)}°C)`,
        )
        .join(" | "),
  ];

  const allPeaks = perWheel.map(peak).filter((v) => v !== UNAVAIL);
  const overheating = allPeaks.filter((t) => t > BRAKE_TEMP.max);
  if (overheating.length > 0) {
    lines.push(
      `  ⚠ ${overheating.length} freni oltre soglia critica ${BRAKE_TEMP.max}°C`,
    );
  }
  return lines.join("\n");
};

/**
 * Per-wheel quartet for the prompt; null when the field is absent or all-zero.
 * lap-recorder floors a missing channel to 0 and turns the whole extended block
 * on from `rpm` alone - AMS2 has rpm but no tyre/slip/suspension channels, so it
 * produces [0,0,0,0], and a printed "0.0/0.0/0.0/0.0" reads as a measured zero.
 */
const wheelQuartet = (
  vals: [number, number, number, number] | null | undefined,
  scale: number,
  digits: number,
): string | null =>
  !vals || vals.every((v) => v === 0)
    ? null
    : vals.map((v) => (v * scale).toFixed(digits)).join("/");

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
    // Steer is normalised -1..1 on all three games (same scale the trail-braking
    // threshold in adaptive-baseline compares against).
    bits.push(`sterzo max ${(z.maxSteerAbs * 100).toFixed(0)}%`);
    if (z.steerDuringBrake > 0)
      bits.push(`sterzo in frenata ${(z.steerDuringBrake * 100).toFixed(0)}%`);
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
    if (z.maxGLat != null) bits.push(`G lat ${z.maxGLat.toFixed(2)}g`);
    if (z.maxGLon != null) bits.push(`G lon ${z.maxGLon.toFixed(2)}g`);
    lines.push(`  - ${label} → ${bits.join(", ")}`);

    // Setup-relevant per-wheel channels on their own line: four values per field
    // would drown the driving metrics above. Which of them arrive depends on the
    // game - see the coverage table in src/main/CLAUDE.md.
    const extra: string[] = [];
    const tp = wheelQuartet(z.avgTyrePressure, 1, 1);
    if (tp) extra.push(`press. gomme ${tp} PSI`);
    const tt = wheelQuartet(z.avgTyreTempC, 1, 0);
    if (tt) extra.push(`temp. gomme ${tt} °C`);
    const sr = wheelQuartet(z.avgSlipRatio, 1, 3);
    if (sr) extra.push(`slip ratio ${sr}`);
    const sus = wheelQuartet(z.avgSuspTravel, 1000, 1);
    if (sus) extra.push(`corsa sosp. ${sus} mm`);
    if (extra.length > 0)
      lines.push(`    (${WHEEL_ORDER}) ${extra.join(" | ")}`);
  }
  return lines;
};

/**
 * Authoritative numeric facts block, injected verbatim into both prompts.
 * The system prompts instruct the model to cite these numbers and never recompute.
 */
export const buildStatsBlock = (stats: SessionStats): string => {
  const lines: string[] = [];
  lines.push(
    `## Dati Calcolati (autorevoli — cita questi numeri, NON ricalcolare)`,
  );
  lines.push(
    `- Giri: ${stats.lapCount} (analizzabili: ${stats.analyzableLapCount}) · Trend: ${stats.trend}` +
      (stats.bestLap != null
        ? ` · Miglior giro: ${formatLapTime(stats.bestLap)}`
        : ""),
  );
  lines.push(`- Setup caricati: ${stats.setupCount}`);
  if (
    stats.avgAirTempC != null ||
    stats.avgRoadTempC != null ||
    stats.avgRainDensity != null ||
    stats.avgWindSpeed != null ||
    stats.avgCloudBrightness != null
  ) {
    const bits: string[] = [];
    if (stats.avgAirTempC != null)
      bits.push(`aria ${stats.avgAirTempC.toFixed(0)}°C`);
    if (stats.avgRoadTempC != null)
      bits.push(`asfalto ${stats.avgRoadTempC.toFixed(0)}°C`);
    if (stats.avgRainDensity != null)
      bits.push(`pioggia ${(stats.avgRainDensity * 100).toFixed(0)}%`);
    if (stats.avgWindSpeed != null)
      bits.push(`vento ${stats.avgWindSpeed.toFixed(1)} m/s`);
    if (stats.avgCloudBrightness != null)
      bits.push(`nuvolosità ${(stats.avgCloudBrightness * 100).toFixed(0)}%`);
    lines.push(`- Condizioni: ${bits.join(", ")}`);
  }
  if (stats.suspAsymFrontMm != null || stats.suspAsymRearMm != null) {
    const bits: string[] = [];
    if (stats.suspAsymFrontMm != null)
      bits.push(`anteriore ${stats.suspAsymFrontMm.toFixed(1)}mm (FL-FR)`);
    if (stats.suspAsymRearMm != null)
      bits.push(`posteriore ${stats.suspAsymRearMm.toFixed(1)}mm (RL-RR)`);
    lines.push(
      `- Asimmetria corsa sospensione (media sessione): ${bits.join(", ")} — verifica camber/altezza da terra`,
    );
  }
  if (
    stats.slipAsymFrontThrottle != null ||
    stats.slipAsymRearThrottle != null
  ) {
    const bits: string[] = [];
    if (stats.slipAsymFrontThrottle != null)
      bits.push(`anteriore ${stats.slipAsymFrontThrottle.toFixed(3)} (FL-FR)`);
    if (stats.slipAsymRearThrottle != null)
      bits.push(`posteriore ${stats.slipAsymRearThrottle.toFixed(3)} (RL-RR)`);
    lines.push(
      `- Asimmetria slip ratio in trazione (media sessione): ${bits.join(", ")} — verifica differenziale power`,
    );
  }
  if (stats.slipAsymFrontRelease != null || stats.slipAsymRearRelease != null) {
    const bits: string[] = [];
    if (stats.slipAsymFrontRelease != null)
      bits.push(`anteriore ${stats.slipAsymFrontRelease.toFixed(3)} (FL-FR)`);
    if (stats.slipAsymRearRelease != null)
      bits.push(`posteriore ${stats.slipAsymRearRelease.toFixed(3)} (RL-RR)`);
    lines.push(
      `- Asimmetria slip ratio in rilascio/frenata (media sessione): ${bits.join(", ")} — verifica differenziale coast`,
    );
  }
  if (stats.laps.length > 0) {
    lines.push(`- Tempi giro:`);
    for (const l of stats.laps) {
      const dp =
        l.deltaPrevSec == null
          ? "—"
          : `${l.deltaPrevSec >= 0 ? "+" : ""}${l.deltaPrevSec.toFixed(3)}s`;
      lines.push(
        `  - Giro ${l.lapNumber}: ${formatLapTime(l.lapTime)} ` +
          `(∆prec ${dp}, gap best +${l.deltaBestSec.toFixed(3)}s / +${l.gapToBestPct.toFixed(2)}%)` +
          `${l.valid ? "" : " [non valido]"}` +
          `${l.setupLabel ? ` [setup "${l.setupLabel}"]` : ""}`,
      );
    }
  }
  if (stats.criticalCorners.length > 0) {
    lines.push(`- Curve critiche (ordinate per numero di alert):`);
    for (const c of stats.criticalCorners) {
      const label = c.cornerName
        ? `${c.cornerName} (@${c.dist}m)`
        : `@${c.dist}m`;
      const types = Object.entries(c.alertsByType)
        .map(([t, n]) => `${ALERT_LABELS[t as AlertType] ?? t}×${n}`)
        .join(", ");
      const bits = [
        `${c.alertCount} alert (${types})`,
        `v.min ${c.minSpeedKmh.toFixed(0)}km/h`,
        `freno ${(c.maxBrakePct * 100).toFixed(0)}%`,
        `sterzo max ${(c.maxSteerAbs * 100).toFixed(0)}%`,
      ];
      if (c.steerDuringBrake > 0)
        bits.push(
          `sterzo in frenata ${(c.steerDuringBrake * 100).toFixed(0)}%`,
        );
      if (c.tcEvents > 0) bits.push(`TC ${c.tcEvents}ev/${c.tcMs}ms`);
      if (c.absEvents > 0) bits.push(`ABS ${c.absEvents}ev/${c.absMs}ms`);
      if (c.overlapMs > 0) bits.push(`overlap ${c.overlapMs}ms`);
      if (c.maxGLat != null) bits.push(`G lat ${c.maxGLat.toFixed(2)}g`);
      if (c.maxGLon != null) bits.push(`G lon ${c.maxGLon.toFixed(2)}g`);
      lines.push(`  - Zona ${c.zone} ${label}: ${bits.join(", ")}`);

      // Per-wheel line, same shape as the lap zones. brakeTempsC was computed
      // here and never printed either; a wheel with no sensor reads -1, and the
      // "-1 means ignore" rule only exists in the Level-2 system prompt.
      const perWheel: string[] = [];
      if (c.brakeTempsC?.some((v) => v > 0))
        perWheel.push(
          `temp. freni ${c.brakeTempsC.map((v) => (v > 0 ? v.toFixed(0) : "n.d.")).join("/")} °C`,
        );
      const tp = wheelQuartet(c.avgTyrePressure, 1, 1);
      if (tp) perWheel.push(`press. gomme ${tp} PSI`);
      const tt = wheelQuartet(c.avgTyreTempC, 1, 0);
      if (tt) perWheel.push(`temp. gomme ${tt} °C`);
      const sr = wheelQuartet(c.avgSlipRatio, 1, 3);
      if (sr) perWheel.push(`slip ratio ${sr}`);
      const sus = wheelQuartet(c.avgSuspTravel, 1000, 1);
      if (sus) perWheel.push(`corsa sosp. ${sus} mm`);
      if (perWheel.length > 0)
        lines.push(`    (${WHEEL_ORDER}) ${perWheel.join(" | ")}`);
    }
  }
  lines.push("");
  return lines.join("\n");
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
  stats: SessionStats;
  // Level 2 only: the Level-1 output of the analysis being expanded. Not part of
  // priorAnalyses, which excludes the current version by design (beforeVersion).
  currentSynthesis?: string;
};

/**
 * Push injected markdown below its wrapper heading. Analysis text carries its own
 * `## Analisi sintetica` / `## Analisi approfondita`, and injecting it verbatim
 * puts a second copy of the exact headings the model is asked to produce at the
 * same level as its own output - so it either continues the wrong hierarchy or
 * treats the section as already written.
 */
export const nestHeadings = (md: string, levels: number): string =>
  md.replace(/^(#{1,6} )/gm, "#".repeat(levels) + "$1");

/** Shared data context for both analysis levels (no closing instruction). */
const buildSessionContext = (input: SessionPromptInput): string => {
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
        `- **Setup Fisso ATTIVO**: il pilota può modificare SOLO bilanciamento freni e pressione frenante. Tutte le altre raccomandazioni di setup (sospensioni, aerodinamica, differenziale, ecc.) non sono applicabili - ometti o segnala esplicitamente questa limitazione nelle proposte di setup.`,
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
        `Confronta i setup sopra elencati evidenziando le differenze e l'impatto sulla telemetria dei giri associati.`,
      );
      parts.push("");
    }
  } else {
    parts.push(
      `## Setup\nNessun setup caricato in sessione. Ometti le proposte di setup o limitati a suggerimenti generici.`,
    );
    parts.push("");
  }

  if (priorAnalyses.length > 0) {
    // The most recent prior analysis goes in whole (synthesis + deep-dive when
    // it exists), older ones stay as their 3-sentence voice summary. The system
    // prompts ask to "confermare/aggiornare i consigli", and the concrete setup
    // proposals live in `detail`: a voice summary cannot carry them, so with
    // summaries alone the model re-derived or re-proposed them blind.
    // ponytail: no cap on `detail`. A deep-dive that hit the 32000-token ceiling
    // is injected whole; slice it, or keep only its "Setup attuale vs proposto"
    // subsection, if the prompt size starts to matter.
    const latestVersion = priorAnalyses.at(-1)?.version;
    parts.push(`## Analisi precedenti`);
    for (const a of priorAnalyses) {
      const isLatest = a.version === latestVersion;
      parts.push(
        `### Analisi #${a.version} (${a.created_at})` +
          (isLatest ? ` — la più recente, testo integrale` : ""),
      );
      if (isLatest) {
        parts.push(nestHeadings(a.synthesis, 2));
        if (a.detail) parts.push("", nestHeadings(a.detail, 2));
      } else if (a.summary) {
        parts.push(`Sintesi: ${a.summary}`);
      } else {
        // Fallback: first ~500 chars of the synthesis
        parts.push(a.synthesis.slice(0, 500));
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

  parts.push(buildStatsBlock(input.stats));

  return parts.join("\n");
};

/** Level 2 (on-demand): full "Analisi approfondita" deep-dive. */
export const buildSessionPrompt = (input: SessionPromptInput): string => {
  const context = buildSessionContext(input);
  // Level 1 of THIS analysis. Without it the deep-dive is written blind to the
  // synthesis and the actions it must complement - while the closing instruction
  // below tells it not to repeat them, which it cannot honour unseen.
  const alreadyProduced = input.currentSynthesis
    ? `## Livello 1 già prodotto per questa analisi (NON ripeterlo)\n` +
      `${nestHeadings(input.currentSynthesis, 1)}\n\n`
    : "";
  return (
    context +
    "\n" +
    alreadyProduced +
    `Produci l'analisi come "## Analisi approfondita" con le sottosezioni ` +
    `"Analisi telemetria", "Problemi identificati" e "Setup attuale vs proposto". ` +
    `Ometti "Setup attuale vs proposto" SOLO se nessun setup è caricato. ` +
    `NON produrre la sintesi né le azioni suggerite (già generate a parte). ` +
    `Cita i numeri dal blocco "## Dati Calcolati".`
  );
};

/** Level 1 (always): short "## Analisi sintetica" + "### Azioni suggerite" + <sintesi-vocale>. */
export const buildSynthesisPrompt = (input: SessionPromptInput): string => {
  const context = buildSessionContext(input);
  return (
    context +
    "\n" +
    `Produci SOLO la sezione "## Analisi sintetica" con la sottosezione "### Azioni suggerite", ` +
    `seguite dal blocco <sintesi-vocale>. Niente tabelle, niente analisi approfondita. ` +
    `Cita i numeri dal blocco "## Dati Calcolati".`
  );
};

export const COMMENT_SYSTEM_PROMPT = `Sei un ingegnere di pista esperto. Il pilota ha appena letto una tua analisi di sessione e ti lascia un commento per correggerla o chiederti un'integrazione (es. un parametro di setup non modificabile, una valutazione che ritiene errata, una richiesta di approfondimento mirato, un dato di sessione non citato nell'analisi).

Rispondi SOLO al commento, in italiano, con tono tecnico da ingegnere. Includi dati numerici quando rilevanti, citandoli dal blocco "## Dati Calcolati" se presente — non dichiarare un dato "non disponibile" se compare lì.
La risposta deve essere BREVE e FOCALIZZATA (massimo 4-6 frasi): conferma o correggi la valutazione e, se serve, proponi un'alternativa concreta.
NON riscrivere l'intera analisi. NON usare le intestazioni delle sezioni di analisi ("Analisi sintetica", "Azioni suggerite", "Analisi approfondita" e relative sottosezioni). NON produrre tabelle lunghe: al massimo poche righe markdown se indispensabili.
Se il pilota segnala che un parametro non è modificabile, accetta la correzione e proponi una leva alternativa effettivamente disponibile.`;

export type CommentPromptInput = {
  analysisText: string;
  priorComments: AnalysisComment[];
  comment: string;
  carName?: string;
  trackName?: string;
  stats?: SessionStats;
};

export const buildCommentPrompt = (input: CommentPromptInput): string => {
  const parts: string[] = [];
  parts.push(`## Contesto`);
  if (input.carName) parts.push(`- Auto: ${input.carName}`);
  if (input.trackName) parts.push(`- Circuito: ${input.trackName}`);
  parts.push("");
  if (input.stats) {
    parts.push(buildStatsBlock(input.stats));
    parts.push("");
  }
  parts.push(`## Analisi a cui si riferisce il commento`);
  parts.push(nestHeadings(input.analysisText, 1));
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
