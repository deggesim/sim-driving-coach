/**
 * Setup ladder (Frezza method, spec 2026-10-20-scaletta-setup): judges the six
 * setup steps in order - brake ducts, brake bias, engine braking, pressures,
 * camber, differential - on the judged laps (tyres settled) of the last setup segment, by
 * summing the per-zone counters LapRecorder stored in zones_json. Pure: every
 * judgment and number is made here, the prompt only cites it. A field absent
 * from every judged zone means "no data" and gives "na", never a zero.
 */

import { WHEEL_LABELS } from "../../shared/alert-types.js";
import type { Ams2Car } from "../ams2/ams2-cars.js";
import type {
  GameSource,
  LapRow,
  SetupParam,
  ZoneData,
} from "../../shared/types.js";
import type { SetupOverview } from "./setup-overview.js";

// Judgment thresholds, to tune on real sessions.
const PLATEAU_C = 2; // |Δ mean tyre temp vs previous lap| still settled
const FALLBACK_WARMUP_LAPS = 3; // no centre temps: laps 1-3 warm the tyres, judged from the 4th
const MIN_JUDGED_LAPS = 2;
const READY_JUDGED_LAPS = 3; // judged laps before the stint is worth an analysis: the pressure drift needs ≥ 3
const DUCT_FRONT_MAX_C = 700;
const DUCT_IMBALANCE = 0.2; // |front − rear| / max(front, rear)
// Brake window 550 ± 137.5 °C: with both axles on one side of it, only the
// duct move that brings the off axle back toward it.
const BRAKE_MIN_C = 412.5;
const BRAKE_MAX_C = 687.5;
const LOCK_SHARE = 0.05; // of the hard-brake frames carrying slip
const LOCK_RATIO = 2; // one axle locks at least this many times the other
export const ABS_SHARE = 0.2; // of the hard-brake frames; the overview's rake reuses it
const NERVOUS_SHARE = 0.2; // of the downshifts
const TYRE_BALANCE_TOL_C = 1.25; // |centre − mean(shoulders)| still ok
const CAMBER_MIN_C = 2; // inner − outer below this: more negative camber
const CAMBER_MAX_C = 10; // above this: less negative camber
const DIFF_SPIN_SHARE = 0.2; // of the exit frames
const DRIVEN_SLIP_EPS = 0.01; // front − rear throttle slip that marks fwd
const FIXED_DIFFS = ["FIXED", "SPOOL", "OPEN"]; // AMS2 differentials with nothing to adjust
// Lever per step, by setup parameter name (R3E idToLabel, ACE labels, AMS2 canonical names).
const LEVERS: Record<LadderStep["n"], RegExp> = {
  1: /duct|condott/i,
  2: /brake bias|ripartizione frenata|bilanciamento fren|brake pressure|pressione freni/i,
  3: /coast|freno motore|engine brak/i,
  4: /tyre pressure|^pressione (fl|fr|rl|rr)\b/i, // not "Pressione freni"
  5: /camber|campanatura/i,
  6: /differential (power|preload)|power locking|power ramp|precarico|preload|bias ratio/i,
};
// AMS2 Vision categories (buildAms2SetupSystemPrompt) holding each step's lever.
const AMS2_LEVER_PAGES: Record<LadderStep["n"], string[]> = {
  1: ["Freni"],
  2: ["Freni"],
  3: ["Motore/Elettronica", "Differenziale"],
  4: ["Gomme"],
  5: ["Sospensioni"],
  6: ["Differenziale"],
};
const GEARED_DIFFS = ["G-LSD", "GC-LSD"]; // AMS2 differentials tuned by bias ratio, not ramps

type Quartet = [number, number, number, number];

export type LadderStatus = "ok" | "fix" | "na";
export type LadderStep = {
  n: 1 | 2 | 3 | 4 | 5 | 6;
  label: string;
  status: LadderStatus;
  reason: string; // Italian: numbers + direction (fix) or why (na)
  proposable: boolean; // false only for step 1 under fixedSetup
  // R3E range check: the R3E parameter each fix would move, and which way.
  moves?: Move[];
};
type PressureState = "alta" | "ok" | "bassa";
export type TyreSummary = {
  setupLabel: string | null;
  judgedLaps: number;
  hotPressurePsi: Quartet | null;
  deltaC: Quartet; // centre − mean(shoulders), mean of per-lap values
  innerMinusOuterC: Quartet | null; // null when the game's shoulder temps cannot judge camber
  pressureState: PressureState[]; // majority of judged laps
  driftPsi: Quartet | null; // last − first judged lap, only with ≥ 3 judged laps
};
/** One R3E parameter a fix would move, and which way (the numeric value). */
export type Move = { param: string; dir: "up" | "down" };

/**
 * R3E: true when a fix cannot be applied. `alternatives` are ORed, the moves
 * inside one are needed together; an alternative naming a parameter absent
 * from the setup is unknown and ignored. Blocked = at least one known
 * alternative, and each has a move already at the end of its range.
 */
export const blockedAtLimit = (
  alternatives: Move[][],
  params: SetupParam[],
): boolean => {
  const known = alternatives.flatMap((alt) => {
    const ps = alt.map((m) => params.find((q) => q.parameter === m.param));
    return ps.every((p) => p)
      ? [alt.map((m, i) => ({ ...m, limit: ps[i]!.limit }))]
      : [];
  });
  return (
    known.length > 0 &&
    known.every((alt) =>
      alt.some((m) => m.limit === (m.dir === "up" ? "max" : "min")),
    )
  );
};

export type SetupLadder = {
  setupLabel: string | null;
  firstJudgedLap: number | null;
  lastJudgedLap: number | null;
  judgedLaps: number;
  lapsMissing: number; // > 0 ⇒ steps is [] or holds step 1 alone
  ductsLaps: number; // laps of the segment after the first: step 1's own laps
  steps: LadderStep[];
  current: number | null; // n of the first step with status "fix" && proposable
  tyres: TyreSummary[]; // one per segment with ≥ 2 judged laps and surface temps, chronological
};

export const parseZones = (json: string | null): ZoneData[] => {
  if (!json) return [];
  try {
    return JSON.parse(json) as ZoneData[];
  } catch {
    return [];
  }
};

const WHEELS = Object.keys(WHEEL_LABELS); // ANT-SX, ANT-DX, POST-SX, POST-DX
const R3E_WHEELS = ["Front Left", "Front Right", "Rear Left", "Rear Right"]; // idToLabel suffixes
const W = [0, 1, 2, 3] as const;

const mean = (xs: number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;
const meanQ = (qs: Quartet[]): Quartet | null =>
  qs.length ? (W.map((i) => mean(qs.map((q) => q[i]))) as Quartet) : null;
const pct = (x: number): string => `${Math.round(x * 100)} %`;
const signed = (x: number): string => `${x >= 0 ? "+" : ""}${x.toFixed(1)}`;

/** Σ of a counter over the zones, null when no zone carries it. */
const total = (zones: ZoneData[], k: keyof ZoneData): number | null => {
  const vs = zones.map((z) => z[k]).filter((v) => typeof v === "number");
  return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
};

/** The state carried by a strict majority, else the fallback. */
const majority = <T>(states: T[], fallback: T): T =>
  states.find(
    (s) => states.filter((x) => x === s).length > states.length / 2,
  ) ?? fallback;

type Lap = LapRow & { zones: ZoneData[] };
type LapTyres = { delta: Quartet; d: Quartet }; // per-lap means over the zones

/**
 * Mean tyre temperature over the lap's zones, null when it carries none. Carcass
 * first: the surface centre swings with the load (ACE: 36-125 °C inside one lap),
 * so its lap mean never settles within PLATEAU_C. R3E's carcass is its centre.
 */
const settleTemp = (lap: Lap): number | null => {
  const ts = lap.zones.flatMap((z) => {
    const t = z.avgTyreTempC ?? z.avgTyreTempCenterC;
    return t ? [mean(t)] : [];
  });
  return ts.length ? mean(ts) : null;
};

const lapTyres = (lap: Lap): LapTyres | null => {
  const s = lap.zones.flatMap((z) => {
    const i = z.avgTyreTempInnerC;
    const c = z.avgTyreTempCenterC;
    const o = z.avgTyreTempOuterC;
    return i && c && o ? [{ i, c, o }] : [];
  });
  if (!s.length) return null;
  return {
    delta: meanQ(
      s.map(({ i, c, o }) => W.map((w) => c[w] - (i[w] + o[w]) / 2) as Quartet),
    ) as Quartet,
    d: meanQ(
      s.map(({ i, o }) => W.map((w) => i[w] - o[w]) as Quartet),
    ) as Quartet,
  };
};

const pressureOf = (delta: number): PressureState =>
  delta > TYRE_BALANCE_TOL_C
    ? "alta"
    : delta < -TYRE_BALANCE_TOL_C
      ? "bassa"
      : "ok";

const tyreSummary = (
  judged: Lap[],
  setupLabel: string | null,
  camberReadable: boolean,
): { summary: TyreSummary; perLap: LapTyres[] } | null => {
  const perLap = judged.map(lapTyres).filter((t) => t != null);
  if (!perLap.length) return null;
  const press = judged
    .map((l) =>
      meanQ(
        l.zones.flatMap((z) => (z.avgTyrePressure ? [z.avgTyrePressure] : [])),
      ),
    )
    .filter((q) => q != null);
  const first = press[0];
  const last = press.at(-1);
  return {
    perLap,
    summary: {
      setupLabel,
      judgedLaps: judged.length,
      hotPressurePsi: meanQ(press),
      deltaC: meanQ(perLap.map((t) => t.delta)) as Quartet,
      innerMinusOuterC: camberReadable
        ? (meanQ(perLap.map((t) => t.d)) as Quartet)
        : null,
      pressureState: W.map((w) =>
        majority(
          perLap.map((t) => pressureOf(t.delta[w])),
          "ok" as PressureState,
        ),
      ),
      driftPsi:
        press.length >= 3 && first && last
          ? (W.map((w) => last[w] - first[w]) as Quartet)
          : null,
    },
  };
};

/**
 * Session-row flags as the ladder wants them. Both DB columns default to 1 for
 * every game, but Leaderboard and Fixed Setup only exist on R3E (same rule as
 * buildSessionContext), so on ACE/AMS2 a default 1 must not switch the ladder off.
 * `camberUnreadable` is per game: ACE's inner/outer shoulder temps differ by ~1 °C
 * even at -3° camber (also seen in MoTeC), so the camber step cannot be judged.
 */
export const ladderFlags = (
  game: GameSource,
  flags: { leaderboardMode: boolean; fixedSetup: boolean },
): {
  leaderboardMode: boolean;
  fixedSetup: boolean;
  camberUnreadable: boolean;
} => ({
  leaderboardMode: game === "r3e" && flags.leaderboardMode,
  fixedSetup: game === "r3e" && flags.fixedSetup,
  camberUnreadable: game === "ace",
});

/** Segments: runs of consecutive laps with the same setup_id (null included). */
const segmentsOf = (laps: LapRow[]): Lap[][] => {
  const segments: Lap[][] = [];
  for (const l of laps) {
    const lap = { ...l, zones: parseZones(l.zones_json) };
    const seg = segments.at(-1);
    if (seg && seg[0].setup_id === l.setup_id) seg.push(lap);
    else segments.push([lap]);
  }
  return segments;
};

// Judged = valid laps whose tyres have settled: the mean centre temperature
// moved ≤ PLATEAU_C from the previous lap (valid or not: the tyres heat up
// anyway), so a pit stop or a slow spell drops laps until they are back at
// temperature. Without temperatures or with them fixed at 85 °C (Leaderboard)
// the plateau says nothing: fixed warm-up instead.
const judgedOf = (seg: Lap[], leaderboardMode?: boolean): Lap[] => {
  const temps = seg.map(settleTemp);
  const noSignal = leaderboardMode || temps.every((t) => t == null);
  return seg.filter((l, i) => {
    if (!l.valid) return false;
    if (noSignal) return i >= FALLBACK_WARMUP_LAPS;
    const prev = temps[i - 1];
    const cur = temps[i];
    return prev != null && cur != null && Math.abs(cur - prev) <= PLATEAU_C;
  });
};

/** The judged laps of the last setup segment: the laps the ladder and the overview judge. */
export const judgedLapsOfLastSegment = (
  laps: LapRow[],
  opts: { leaderboardMode?: boolean },
): Lap[] => judgedOf(segmentsOf(laps).at(-1) ?? [], opts.leaderboardMode);

export const computeSetupLadder = (
  laps: LapRow[],
  setupLabelById: Map<number, string>,
  opts: {
    fixedSetup: boolean;
    leaderboardMode?: boolean;
    camberUnreadable?: boolean;
    car?: Ams2Car | null; // AMS2 table row: driveline and differential type
    minJudgedLaps?: number; // 1 only to judge the verdict before the last lap
    setupParams?: SetupParam[] | null; // the setup on the last segment, when loaded
    game?: GameSource; // limits are read only on R3E
  },
): SetupLadder => {
  const minJudged = opts.minJudgedLaps ?? MIN_JUDGED_LAPS;
  const labelOf = (id: number | null): string | null =>
    id != null ? (setupLabelById.get(id) ?? null) : null;

  const segments = segmentsOf(laps);
  const analysed = segments.map((seg) => {
    const judged = judgedOf(seg, opts.leaderboardMode);
    return judged.length >= minJudged
      ? tyreSummary(judged, labelOf(seg[0].setup_id), !opts.camberUnreadable)
      : null;
  });

  const seg = segments.at(-1) ?? [];
  const judged = judgedOf(seg, opts.leaderboardMode);
  // Every lap after the out-lap, valid or not: a dirty lap still heats the brakes.
  const brakeLaps = seg.slice(1);
  // A lower bound: how many laps are still needed depends on the plateau.
  const lapsMissing = Math.max(0, minJudged - judged.length);
  const base = {
    setupLabel: labelOf(seg[0]?.setup_id ?? null),
    firstJudgedLap: judged[0]?.lap_number ?? null,
    lastJudgedLap: judged.at(-1)?.lap_number ?? null,
    judgedLaps: judged.length,
    lapsMissing,
    ductsLaps: brakeLaps.length,
    // Leaderboard: tyre temps are fixed at 85 °C, so no tyre lines either.
    tyres: opts.leaderboardMode
      ? []
      : analysed.flatMap((a) => (a ? [a.summary] : [])),
  };
  const step = (
    n: LadderStep["n"],
    label: string,
    status: LadderStatus,
    reason: string,
    moves?: LadderStep["moves"],
  ): LadderStep => ({
    n,
    label,
    status,
    reason,
    proposable: !(n === 1 && opts.fixedSetup),
    ...(moves && { moves }),
  });

  // 1 - brake ducts, on its own laps: brake temperatures need no tyre plateau.
  const ducts = ((): LadderStep => {
    const L = "condotti freni";
    const bz = brakeLaps.flatMap((l) => l.zones);
    const axle = (ws: number[]): number | null => {
      const ts = bz
        .flatMap((z) => ws.map((w) => z.avgBrakeTempC?.[w] ?? -1))
        .filter((t) => t > 0); // -1 = unavailable on this car
      return ts.length ? mean(ts) : null;
    };
    const front = axle([0, 1]);
    const rear = axle([2, 3]);
    if (front == null || rear == null)
      return step(1, L, "na", "temperature freni non disponibili");
    const imbalance = Math.abs(front - rear) / Math.max(front, rear);
    const fixes = [
      front > DUCT_FRONT_MAX_C ? "aprire i condotti anteriori" : null,
      imbalance <= DUCT_IMBALANCE
        ? null
        : Math.max(front, rear) < BRAKE_MIN_C
          ? "chiudere i condotti dell'asse più freddo"
          : Math.min(front, rear) > BRAKE_MAX_C
            ? "aprire i condotti dell'asse più caldo"
            : "aprire i condotti dell'asse più caldo, o chiudere quelli dell'asse più freddo",
    ].filter((f) => f != null);
    const data = `ant ${Math.round(front)} °C, post ${Math.round(rear)} °C, sbil. ${pct(imbalance)}`;
    return fixes.length
      ? step(1, L, "fix", `${data} → ${fixes.join("; ")}`)
      : step(1, L, "ok", data);
  })();

  // A step to fix whose lever the loaded setup lacks cannot be acted on: na,
  // skipped like the others (R3E/ACE often have no brake ducts).
  const params = opts.setupParams;
  // AMS2 setups come from the screenshots the user picked: a lever is missing
  // only if its page was read (a category of the step is present).
  const pageRead = (n: LadderStep["n"]): boolean =>
    opts.game !== "ams2" ||
    !!params?.some((p) => AMS2_LEVER_PAGES[n].includes(p.category));
  const levered = (s: LadderStep): LadderStep =>
    params &&
    s.status === "fix" &&
    pageRead(s.n) &&
    !params.some((p) => LEVERS[s.n].test(p.parameter))
      ? {
          ...s,
          status: "na",
          reason: `leva non presente nel setup caricato — ${s.reason}`,
        }
      : s;
  // R3E: a fix whose every known move is already at the end of its range
  // cannot be applied either: ok, with the note, and the ladder moves on.
  // Each move is its own alternative (one wheel, or one way to move the bias).
  const limited = (s: LadderStep): LadderStep =>
    opts.game === "r3e" &&
    params &&
    s.status === "fix" &&
    blockedAtLimit(
      (s.moves ?? []).map((m) => [m]),
      params,
    )
      ? { ...s, status: "ok", reason: `${s.reason} — già a fondo scala` }
      : s;
  const currentOf = (steps: LadderStep[]): number | null =>
    steps.find((s) => s.status === "fix" && s.proposable)?.n ?? null;

  // Laps missing: step 1 alone, current once it has 2 laps and needs a fix.
  if (lapsMissing > 0) {
    const steps = brakeLaps.length ? [levered(ducts)] : [];
    return {
      ...base,
      steps,
      current: brakeLaps.length >= MIN_JUDGED_LAPS ? currentOf(steps) : null,
    };
  }

  const zs = judged.flatMap((l) => l.zones);
  const sum = (k: keyof ZoneData): number | null => total(zs, k);
  const noCorners = zs.some((z) => z.maxGLat != null)
    ? "nessuna curva misurabile"
    : "manca l'accelerazione laterale";
  const slipT = meanQ(
    zs.flatMap((z) => (z.avgSlipRatioThrottle ? [z.avgSlipRatioThrottle] : [])),
  );
  // Driven axle: the AMS2 table when known, else throttle slip; awd/rwd/unknown
  // all count as rear-driven.
  const fwd = opts.car
    ? opts.car.driveline === "FWD"
    : slipT != null &&
      (slipT[0] + slipT[1]) / 2 - (slipT[2] + slipT[3]) / 2 > DRIVEN_SLIP_EPS;

  // 2 - brake bias
  const bias = ((): LadderStep => {
    const L = "bilanciamento freni";
    const hard = sum("hardBrakeFrames");
    if (hard == null) return step(2, L, "na", "mancano i contatori di frenata");
    if (hard === 0) return step(2, L, "na", "nessuna frenata forte");
    const absHard = sum("absHardBrakeFrames") ?? 0;
    if (absHard > 0) {
      const share = absHard / hard;
      const entry = sum("cornersEntry");
      if (!entry) return step(2, L, "na", noCorners);
      const under = sum("cornersEntryUnder") ?? 0;
      const data = `ABS nel ${pct(share)} delle frenate forti, sottosterzo in inserimento in ${under}/${entry} curve`;
      return share > ABS_SHARE && under > entry / 2
        ? step(2, L, "fix", `${data} → bilanciamento verso il posteriore`, [
            { param: "Brake Bias", dir: "up" },
          ])
        : step(2, L, "ok", data);
    }
    const srHard = sum("srHardBrakeFrames");
    if (!srHard) return step(2, L, "na", "manca lo slip");
    const f = (sum("lockFramesFront") ?? 0) / srHard;
    const r = (sum("lockFramesRear") ?? 0) / srHard;
    const data = `bloccaggi ant ${pct(f)}, post ${pct(r)} delle frenate forti`;
    if (f > LOCK_SHARE && f >= LOCK_RATIO * r)
      return step(
        2,
        L,
        "fix",
        `${data} → bilanciamento verso il posteriore (l'auto tira dritta)`,
        [{ param: "Brake Bias", dir: "up" }],
      );
    if (r > LOCK_SHARE && r >= LOCK_RATIO * f)
      return step(
        2,
        L,
        "fix",
        `${data} → bilanciamento verso l'anteriore (il posteriore scoda)`,
        [{ param: "Brake Bias", dir: "down" }],
      );
    // Both axles lock and neither dominates: no bias fixes it (guide: "forza
    // frenante" - lower the brake pressure, then redo the bias).
    if (f > LOCK_SHARE && r > LOCK_SHARE)
      return step(
        2,
        L,
        "fix",
        `${data} → bloccano entrambi gli assi: ridurre la forza frenante (brake pressure), poi rifare il bilanciamento`,
        [{ param: "Brake Pressure", dir: "down" }],
      );
    return step(2, L, "ok", data);
  })();

  // 3 - engine braking
  const engine = ((): LadderStep => {
    const L = "freno motore";
    if (fwd) return step(3, L, "na", "trazione anteriore");
    const downs = sum("downshifts");
    if (downs == null) return step(3, L, "na", "manca lo slip");
    if (downs === 0) return step(3, L, "na", "nessuna scalata");
    const nervous = sum("nervousDownshifts") ?? 0;
    const data = `scalate nervose ${nervous}/${downs} (${pct(nervous / downs)})`;
    return nervous / downs > NERVOUS_SHARE
      ? step(
          3,
          L,
          "fix",
          // Guide slides 22-23: "abbassare il coast ramp" (35 deg understeers,
          // 36 deg oversteers) = close it; slide 53: open coast = oversteer.
          `${data} → coast ramp più chiusa (su AMS2 valore più basso); se è già al minimo, meno freno motore (su AMS2 engine braking più alto = meno freno motore) e più forza frenante per non allungare la frenata`,
        )
      : step(3, L, "ok", data);
  })();

  // 4 - pressures, 5 - camber
  const tyres = opts.leaderboardMode ? undefined : analysed.at(-1);
  const noTemps = opts.leaderboardMode
    ? "gomme fisse a 85 °C (Leaderboard)"
    : "mancano le temperature interna/centro/esterna";
  const pressures = ((): LadderStep => {
    const L = "pressioni";
    if (!tyres) return step(4, L, "na", noTemps);
    const { deltaC, pressureState } = tyres.summary;
    const off = W.filter((w) => pressureState[w] !== "ok");
    // The axle with the largest |Δ| among the out-of-tolerance wheels; a tie
    // goes to the front.
    const axleMax = (ws: number[]): number =>
      Math.max(
        0,
        ...off.filter((w) => ws.includes(w)).map((w) => Math.abs(deltaC[w])),
      );
    const front = axleMax([0, 1]) >= axleMax([2, 3]);
    const wheels = off.filter((w) => w < 2 === front);
    return off.length
      ? step(
          4,
          L,
          "fix",
          `asse ${front ? "ANT" : "POST"}: ${wheels
            .map(
              (w) =>
                `Δ ${WHEELS[w]} ${signed(deltaC[w])} °C → ${pressureState[w] === "alta" ? "abbassare" : "alzare"}`,
            )
            .join(", ")}`,
          wheels.map((w) => ({
            param: `Tyre Pressure ${R3E_WHEELS[w]}`,
            dir: pressureState[w] === "alta" ? "down" : "up",
          })),
        )
      : step(4, L, "ok", `Δ entro ±${TYRE_BALANCE_TOL_C} °C su tutte le ruote`);
  })();
  const camber = ((): LadderStep => {
    const L = "campanatura";
    if (!tyres) return step(5, L, "na", noTemps);
    const { innerMinusOuterC, pressureState } = tyres.summary;
    if (!innerMinusOuterC)
      return step(
        5,
        L,
        "na",
        "su ACE la differenza tra spalla interna ed esterna è troppo piccola per giudicare (anche con campanatura estrema)",
      );
    const okWheels = W.filter((w) => pressureState[w] === "ok");
    if (!okWheels.length)
      return step(5, L, "na", "nessuna ruota con pressione a posto");
    const moves: NonNullable<LadderStep["moves"]> = [];
    const off = okWheels.flatMap((w) => {
      const dir = majority(
        tyres.perLap.map((t) =>
          t.d[w] < CAMBER_MIN_C ? "più" : t.d[w] > CAMBER_MAX_C ? "meno" : "ok",
        ),
        "ok",
      );
      // More negative camber = a lower raw value.
      if (dir !== "ok")
        moves.push({
          param: `Camber ${R3E_WHEELS[w]}`,
          dir: dir === "più" ? "down" : "up",
        });
      return dir === "ok"
        ? []
        : [
            // Guide: low caster heats the front inner shoulders, so more caster
            // is the alternative lever there (not separable from camber in the data).
            `${WHEELS[w]} ${signed(innerMinusOuterC[w])} °C → ${dir} campanatura negativa${dir === "meno" && w < 2 ? " o più incidenza (se regolabile)" : ""}`,
          ];
    });
    return off.length
      ? step(5, L, "fix", `interna−esterna ${off.join(", ")}`, moves)
      : step(
          5,
          L,
          "ok",
          `interna−esterna tra ${CAMBER_MIN_C} e ${CAMBER_MAX_C} °C su ${okWheels.map((w) => WHEELS[w]).join(", ")}`,
        );
  })();

  // 6 - differential
  const diff = ((): LadderStep => {
    const L = "differenziale";
    const dt = opts.car?.differential;
    if (dt && FIXED_DIFFS.includes(dt))
      return step(6, L, "na", "differenziale non regolabile");
    const geared = dt != null && GEARED_DIFFS.includes(dt);
    const exit = sum("exitFrames");
    if (exit == null) return step(6, L, "na", "manca lo slip");
    const entry = sum("cornersEntry");
    if (!entry) return step(6, L, "na", noCorners);
    const spin = exit
      ? (sum(fwd ? "spinFramesFront" : "spinFramesRear") ?? 0) / exit
      : 0;
    const exits = sum("cornersExit") ?? 0;
    const exitOver = sum("cornersExitOver") ?? 0;
    const entryOver = sum("cornersEntryOver") ?? 0;
    const data = `pattinamento ruota interna ${pct(spin)} dei frame in uscita, sovrasterzo in uscita ${exitOver}/${exits} e in inserimento ${entryOver}/${entry} curve`;
    if (spin > DIFF_SPIN_SHARE)
      return step(
        6,
        L,
        "fix",
        geared
          ? `${data} → alzare il bias ratio power (più bloccaggio)`
          : `${data} → chiudere la power ramp (più bloccaggio); se è già chiusa del tutto, più precarico`,
      );
    if (exitOver > exits / 2)
      return step(
        6,
        L,
        "fix",
        geared
          ? `${data} → abbassare il bias ratio power`
          : `${data} → aprire la power ramp; se è già aperta del tutto, meno precarico`,
      );
    if (entryOver > entry / 2)
      return step(
        6,
        L,
        "fix",
        geared
          ? `${data} → alzare il bias ratio coast`
          : `${data} → chiudere la coast ramp; se è già al minimo, più precarico`,
      );
    return step(6, L, "ok", data);
  })();

  // Fixed setup: only ducts and bias exist, and the ducts cannot be touched.
  const steps = (
    opts.fixedSetup
      ? [ducts, bias]
      : [ducts, bias, engine, pressures, camber, diff]
  ).map((s) => limited(levered(s)));
  return { ...base, steps, current: currentOf(steps) };
};

const NUMBER = /\d+(?:[.,]\d+)?/g;
const keyOf = (xs: { n: number; status: string; reason: string }[]): string[] =>
  xs.map((x) => `${x.n}:${x.status}:${x.reason.replace(NUMBER, "#")}`);

/**
 * The verdict the stint stands on, numbers blanked: the steps up to the
 * current one (all without one) and, once the ladder is complete, the overview
 * areas up to the current area. Equal keys = same states, directions, wheels.
 */
export const verdictKey = (
  ladder: SetupLadder,
  overview?: SetupOverview | null,
): string => {
  const upTo = <T extends { n: number }>(xs: T[], cur: number | null): T[] =>
    cur == null ? xs : xs.filter((x) => x.n <= cur);
  const areas =
    ladder.current == null && ladder.lapsMissing === 0 && overview
      ? keyOf(upTo(overview.areas, overview.current))
      : [];
  return [...keyOf(upTo(ladder.steps, ladder.current)), ...areas].join("|");
};

/**
 * Spoken at the end of a lap once the stint can be analysed, null while it
 * cannot: 3 counted laps, or 2 when the verdict did not change with the last
 * one (`prev`: the stats before it). Step 4 always waits for 3 (pressure drift).
 */
export const stintReadyMessage = (
  ladder: SetupLadder,
  overview?: SetupOverview | null,
  prev?: { ladder: SetupLadder; overview?: SetupOverview | null } | null,
): string | null => {
  const counted =
    ladder.lapsMissing > 0 && ladder.current === 1
      ? ladder.ductsLaps
      : ladder.judgedLaps;
  const stable =
    counted >= MIN_JUDGED_LAPS &&
    ladder.current !== 4 &&
    prev != null &&
    verdictKey(prev.ladder, prev.overview) === verdictKey(ladder, overview);
  if (counted < READY_JUDGED_LAPS && !stable) return null;
  const current = ladder.steps.find((s) => s.n === ladder.current);
  const area = overview?.areas.find((a) => a.n === overview.current);
  const verdict = current
    ? `Primo passo da correggere: ${current.label}.`
    : area
      ? `Sequenza completa, prima area dell'assetto: ${area.label}.`
      : "Nessun passo da correggere.";
  return `Stint analizzabile: ${counted} giri giudicati. ${verdict} Puoi metterti in pausa ed eseguire l'analisi.`;
};
