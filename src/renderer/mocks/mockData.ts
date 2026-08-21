import type {
  SessionRow,
  LapRow,
  SessionDetail,
  SessionAnalysisRow,
} from "../../shared/types";

const ANALYSIS_R3E: SessionAnalysisRow = {
  id: -1,
  session_id: -1,
  version: 1,
  synthesis: `## Analisi sintetica
Sessione in miglioramento: dal giro 1 (1:58.456, non valido) al giro 2 (1:55.234) il ∆ è -3.222s, best al giro 2; il giro 3 (1:55.780) conferma il ritmo a +0.546s. Perdi circa 0.25 s/giro complessivi in staccata alla Einfahrt Mercedes (freno 18m più tardi della baseline, apice -3 km/h) e alla Ford Kurve (trail braking fino a 22m dall'apice contro 14m di riferimento).

### Azioni suggerite
1. **Guida — @380m Einfahrt Mercedes** — anticipa la staccata di ~10m; effetto atteso ~0.12 s/giro.
2. **Guida — @730m Rettifilo est** — apri il gas 0.4s prima dopo l'apice, il posteriore è stabile; effetto atteso ~0.08 s/giro.
3. **Guida — @1080m Ford Kurve** — rilascia il freno 5m prima per stabilizzare l'uscita; effetto atteso ~0.05 s/giro.`,
  detail: `## Analisi approfondita

### Analisi telemetria
3 giri registrati, 2 validi (giro 2-3), trend in miglioramento, best 1:55.234 al giro 2. Convergenza di -3.222s tra giro 1 e giro 2, poi +0.546s al giro 3: il guadagno è concentrato nelle zone 5-18, mentre le zone 20-28 restano stabili circa 0.3s sopra il riferimento cumulativo.

### Problemi identificati
| Rank | Problema | Localizzazione | Alert | Impatto stimato |
|---|---|---|---|---|
| 1 | Staccata ritardata | @380m Einfahrt Mercedes | 2 (frenata tardiva) | -0.10 / -0.15 s/giro |
| 2 | Gas ritardato in uscita | @730m Rettifilo est | 1 (accelerazione tardiva) | -0.08 s/giro |
| 3 | Trail braking eccessivo | @1080m Ford Kurve | 1 (trail braking eccessivo) | -0.05 s/giro |

**Pattern sistemico:** il miglioramento arriva dall'apprendimento sulle staccate, non dalla gestione termica — le temperature freno restano nella finestra 413-688°C su tutti i giri validi.`,
  summary:
    "Buon ritmo, BMW. Stai perdendo tre decimi in frenata alla Mercedes e alla Ford Kurve. Anticipa la staccata di dieci metri e apri il gas prima in uscita.",
  created_at: "2026-04-17T08:25:00.000Z",
  comments: [],
};

const ANALYSIS_ACE: SessionAnalysisRow = {
  id: -2,
  session_id: -2,
  version: 1,
  synthesis: `## Analisi sintetica
Progressione netta: dal giro 1 (1:49.120, non valido) al giro 2 (1:47.456) il ∆ è -1.664s, best al giro 2; il giro 3 chiude a 1:47.892 (+0.436s). Il tempo si perde quasi tutto nelle due varianti — 0.3s di sovrapposizione freno/gas alla Prima variante e 0.7s di coasting alla Seconda — per circa 0.20 s/giro complessivi.

### Azioni suggerite
1. **Guida — @180m Prima variante** — separa le fasi: chiudi la frenata prima di aprire il gas; effetto atteso ~0.09 s/giro.
2. **Guida — @530m Seconda variante** — elimina il coasting, passa dal freno al gas senza pausa; effetto atteso ~0.11 s/giro.
3. **Guida — @1330m Lesmo 2** — anticipa la staccata di ~12m, il grip posteriore è disponibile; effetto atteso ~0.07 s/giro.`,
  detail: `## Analisi approfondita

### Analisi telemetria
3 giri registrati, 2 validi (giro 2-3), trend in miglioramento, best 1:47.456 al giro 2. Il settore 1 è già allineato al riferimento; settori 2 e 3 restano migliorabili di circa 0.4s ciascuno, concentrati sulle varianti e sull'uscita dai Lesmo. La ripetibilità è buona: +0.436s tra best e giro 3.

### Problemi identificati
| Rank | Problema | Localizzazione | Alert | Impatto stimato |
|---|---|---|---|---|
| 1 | Coasting tra freno e gas | @530m Seconda variante | 3 (coasting) | -0.11 s/giro |
| 2 | Sovrapposizione freno/gas | @180m Prima variante | 2 (sovrapposizione freno gas) | -0.09 s/giro |
| 3 | Staccata ritardata | @1330m Lesmo 2 | 1 (frenata tardiva) | -0.07 s/giro |

**Pattern sistemico:** entrambi i problemi principali sono di transizione tra i pedali, non di traiettoria — la velocità di apice è in linea col riferimento in tutte le zone tranne Lesmo 2 (-5 km/h in uscita).`,
  summary:
    "Porsche, perdi il tempo principalmente alle due varianti. Alla prima, stai sovrapponendo freno e gas: separa le fasi. Alla seconda, entra con più fiducia e apri il gas 0.5 secondi prima.",
  created_at: "2026-04-17T14:38:00.000Z",
  comments: [],
};

const ANALYSIS_AMS2: SessionAnalysisRow = {
  id: -3,
  session_id: -3,
  version: 1,
  // detail intentionally null: exercises the "Mostra analisi approfondita"
  // button in mock mode, where the other two sessions render a saved detail.
  synthesis: `## Analisi sintetica
Buon passo generale: dal giro 1 (1:13.560, non valido) al giro 2 (1:11.234) il ∆ è -2.326s, best al giro 2; il giro 3 chiude a 1:11.678 (+0.444s). Perdi circa 0.25 s/giro tra la staccata della Senna S (freno 9m più tardi, apice -4 km/h) e la sovrapposizione freno/gas alla Junção (0.2s in ingresso).

### Azioni suggerite
1. **Guida — @130m Curva 1 (Senna S)** — anticipa la staccata, la monoposto ha ancora carico disponibile; effetto atteso ~0.10 s/giro.
2. **Guida — @680m Reta Oposta** — apri il gas 0.3s prima dopo l'apice, il posteriore regge; effetto atteso ~0.09 s/giro.
3. **Guida — @930m Junção** — separa freno e gas in ingresso per non destabilizzare l'anteriore; effetto atteso ~0.06 s/giro.`,
  detail: null,
  summary:
    "Formula, buon passo generale. Stai perdendo tempo alla Senna S e alla Junção: anticipa la staccata e separa freno e gas. Sulla retta opposta apri il gas un decimo prima in uscita.",
  created_at: "2026-04-17T18:32:00.000Z",
  comments: [],
};

export const MOCK_SESSIONS: SessionRow[] = [
  {
    id: -1,
    game: "r3e",
    car: "10022",
    track: "3045",
    layout: "gp",
    session_type: "Practice",
    started_at: "2026-04-17 08:00:00",
    ended_at: "2026-04-17 08:32:00",
    best_lap: 115.234,
    lap_count: 3,
    car_name: "BMW M4 GT3",
    car_class_name: "GT3",
    track_name: "Nürburgring",
    layout_name: "Grand Prix",
  },
  {
    id: -2,
    game: "ace",
    car: "ks_porsche_718_gt4",
    track: "monza",
    layout: "circuit",
    session_type: "Practice",
    started_at: "2026-04-17 14:00:00",
    ended_at: "2026-04-17 14:45:00",
    best_lap: 107.456,
    lap_count: 3,
    car_name: "Porsche 718 GT4",
    car_class_name: "GT4",
    track_name: "Monza",
    layout_name: "Circuit",
  },
  {
    id: -3,
    game: "ams2",
    car: "formula_ultimate_gen2",
    track: "Interlagos",
    layout: "Grand Prix",
    session_type: "Practice",
    started_at: "2026-04-17 18:00:00",
    ended_at: "2026-04-17 18:40:00",
    best_lap: 71.234,
    lap_count: 3,
    car_name: "Formula Ultimate Gen2",
    car_class_name: "Formula",
    track_name: "Interlagos",
    layout_name: "Grand Prix",
  },
];

const MOCK_LAPS_R3E: LapRow[] = [
  {
    id: -101,
    session_id: -1,
    setup_id: null,
    lap_number: 1,
    lap_time: 118.456,
    sector1: 38.2,
    sector2: 42.1,
    sector3: 38.156,
    valid: false,
    zones_json: null,
    recorded_at: "2026-04-17T08:08:00.000Z",
  },
  {
    id: -102,
    session_id: -1,
    setup_id: null,
    lap_number: 2,
    lap_time: 115.234,
    sector1: 37.1,
    sector2: 40.8,
    sector3: 37.334,
    valid: true,
    zones_json: null,
    recorded_at: "2026-04-17T08:17:00.000Z",
  },
  {
    id: -103,
    session_id: -1,
    setup_id: null,
    lap_number: 3,
    lap_time: 115.78,
    sector1: 37.3,
    sector2: 41.0,
    sector3: 37.48,
    valid: true,
    zones_json: null,
    recorded_at: "2026-04-17T08:25:00.000Z",
  },
];

const MOCK_LAPS_ACE: LapRow[] = [
  {
    id: -201,
    session_id: -2,
    setup_id: null,
    lap_number: 1,
    lap_time: 109.12,
    sector1: 34.5,
    sector2: 40.3,
    sector3: 34.32,
    valid: false,
    zones_json: null,
    recorded_at: "2026-04-17T14:09:00.000Z",
  },
  {
    id: -202,
    session_id: -2,
    setup_id: null,
    lap_number: 2,
    lap_time: 107.456,
    sector1: 33.8,
    sector2: 39.7,
    sector3: 33.956,
    valid: true,
    zones_json: null,
    recorded_at: "2026-04-17T14:18:00.000Z",
  },
  {
    id: -203,
    session_id: -2,
    setup_id: null,
    lap_number: 3,
    lap_time: 107.892,
    sector1: 33.9,
    sector2: 39.9,
    sector3: 34.092,
    valid: true,
    zones_json: null,
    recorded_at: "2026-04-17T14:27:00.000Z",
  },
];

const MOCK_LAPS_AMS2: LapRow[] = [
  {
    id: -301,
    session_id: -3,
    setup_id: null,
    lap_number: 1,
    lap_time: 73.56,
    sector1: 23.8,
    sector2: 26.1,
    sector3: 23.66,
    valid: false,
    zones_json: null,
    recorded_at: "2026-04-17T18:09:00.000Z",
  },
  {
    id: -302,
    session_id: -3,
    setup_id: null,
    lap_number: 2,
    lap_time: 71.234,
    sector1: 23.1,
    sector2: 25.3,
    sector3: 22.834,
    valid: true,
    zones_json: null,
    recorded_at: "2026-04-17T18:18:00.000Z",
  },
  {
    id: -303,
    session_id: -3,
    setup_id: null,
    lap_number: 3,
    lap_time: 71.678,
    sector1: 23.2,
    sector2: 25.4,
    sector3: 23.078,
    valid: true,
    zones_json: null,
    recorded_at: "2026-04-17T18:27:00.000Z",
  },
];

export const MOCK_DETAILS: Record<number, SessionDetail> = {
  [-1]: {
    session: MOCK_SESSIONS[0],
    laps: MOCK_LAPS_R3E,
    setups: [],
    analyses: [ANALYSIS_R3E],
  },
  [-2]: {
    session: MOCK_SESSIONS[1],
    laps: MOCK_LAPS_ACE,
    setups: [],
    analyses: [ANALYSIS_ACE],
  },
  [-3]: {
    session: MOCK_SESSIONS[2],
    laps: MOCK_LAPS_AMS2,
    setups: [],
    analyses: [ANALYSIS_AMS2],
  },
};
