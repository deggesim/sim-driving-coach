/**
 * Setup ladder (Frezza method, spec 2026-10-20-scaletta-setup): judges the six
 * setup steps in order - brake ducts, brake bias, engine braking, pressures,
 * camber, differential - on the judged laps of the last setup segment, by
 * summing the per-zone counters LapRecorder stored in zones_json. Pure: every
 * judgment and number is made here, the prompt only cites it. A field absent
 * from every judged zone means "no data" and gives "na", never a zero.
 */

import { WHEEL_LABELS } from "../../shared/alert-types.js";
import type { GameSource, LapRow, ZoneData } from "../../shared/types.js";

// Judgment thresholds, to tune on real sessions.
const WARMUP_LAPS = 3; // laps 1-3 of a segment warm the tyres, judged from the 4th
const MIN_JUDGED_LAPS = 2;
const DUCT_FRONT_MAX_C = 700;
const DUCT_IMBALANCE = 0.2; // |front − rear| / max(front, rear)
const LOCK_SHARE = 0.05; // of the hard-brake frames carrying slip
const LOCK_RATIO = 2; // one axle locks at least this many times the other
const ABS_SHARE = 0.2; // of the hard-brake frames
const NERVOUS_SHARE = 0.2; // of the downshifts
const TYRE_BALANCE_TOL_C = 1.25; // |centre − mean(shoulders)| still ok
const CAMBER_MIN_C = 2; // inner − outer below this: more negative camber
const CAMBER_MAX_C = 10; // above this: less negative camber
const DIFF_SPIN_SHARE = 0.2; // of the exit frames
const DRIVEN_SLIP_EPS = 0.01; // front − rear throttle slip that marks fwd

type Quartet = [number, number, number, number];

export type LadderStatus = "ok" | "fix" | "na";
export type LadderStep = {
  n: 1 | 2 | 3 | 4 | 5 | 6;
  label: string;
  status: LadderStatus;
  reason: string; // Italian: numbers + direction (fix) or why (na)
  proposable: boolean; // false only for step 1 under fixedSetup
};
type PressureState = "alta" | "ok" | "bassa";
export type TyreSummary = {
  setupLabel: string | null;
  judgedLaps: number;
  hotPressurePsi: Quartet | null;
  deltaC: Quartet; // centre − mean(shoulders), mean of per-lap values
  innerMinusOuterC: Quartet;
  pressureState: PressureState[]; // majority of judged laps
  driftPsi: Quartet | null; // last − first judged lap, only with ≥ 3 judged laps
};
export type SetupLadder = {
  setupLabel: string | null;
  firstJudgedLap: number | null;
  lastJudgedLap: number | null;
  judgedLaps: number;
  lapsMissing: number; // > 0 ⇒ steps is []
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
      innerMinusOuterC: meanQ(perLap.map((t) => t.d)) as Quartet,
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
 */
export const ladderFlags = (
  game: GameSource,
  flags: { leaderboardMode: boolean; fixedSetup: boolean },
): { leaderboardMode: boolean; fixedSetup: boolean } => ({
  leaderboardMode: game === "r3e" && flags.leaderboardMode,
  fixedSetup: game === "r3e" && flags.fixedSetup,
});

export const computeSetupLadder = (
  laps: LapRow[],
  setupLabelById: Map<number, string>,
  opts: { fixedSetup: boolean; leaderboardMode?: boolean },
): SetupLadder => {
  const labelOf = (id: number | null): string | null =>
    id != null ? (setupLabelById.get(id) ?? null) : null;

  // Segments: runs of consecutive laps with the same setup_id (null included).
  const segments: Lap[][] = [];
  for (const l of laps) {
    const lap = { ...l, zones: parseZones(l.zones_json) };
    const seg = segments.at(-1);
    if (seg && seg[0].setup_id === l.setup_id) seg.push(lap);
    else segments.push([lap]);
  }
  // Warm-up counts every lap, valid or not: the tyres heat up anyway.
  const judgedOf = (seg: Lap[]): Lap[] =>
    seg.filter((l, i) => i >= WARMUP_LAPS && l.valid);
  const analysed = segments.map((seg) => {
    const judged = judgedOf(seg);
    return judged.length >= MIN_JUDGED_LAPS
      ? tyreSummary(judged, labelOf(seg[0].setup_id))
      : null;
  });

  const seg = segments.at(-1) ?? [];
  const judged = judgedOf(seg);
  const lapsMissing =
    judged.length < MIN_JUDGED_LAPS
      ? Math.max(0, WARMUP_LAPS - seg.length) +
        Math.max(0, MIN_JUDGED_LAPS - judged.length)
      : 0;
  const base = {
    setupLabel: labelOf(seg[0]?.setup_id ?? null),
    firstJudgedLap: judged[0]?.lap_number ?? null,
    lastJudgedLap: judged.at(-1)?.lap_number ?? null,
    judgedLaps: judged.length,
    lapsMissing,
    // Leaderboard: tyre temps are fixed at 85 °C, so no tyre lines either.
    tyres: opts.leaderboardMode
      ? []
      : analysed.flatMap((a) => (a ? [a.summary] : [])),
  };
  if (lapsMissing > 0) return { ...base, steps: [], current: null };

  const zs = judged.flatMap((l) => l.zones);
  const sum = (k: keyof ZoneData): number | null => total(zs, k);
  const step = (
    n: LadderStep["n"],
    label: string,
    status: LadderStatus,
    reason: string,
  ): LadderStep => ({ n, label, status, reason, proposable: true });
  const noCorners = zs.some((z) => z.maxGLat != null)
    ? "nessuna curva misurabile"
    : "manca l'accelerazione laterale";
  const slipT = meanQ(
    zs.flatMap((z) => (z.avgSlipRatioThrottle ? [z.avgSlipRatioThrottle] : [])),
  );
  // Driven axle from throttle slip; awd/rwd/unknown all count as rear-driven.
  const fwd =
    slipT != null &&
    (slipT[0] + slipT[1]) / 2 - (slipT[2] + slipT[3]) / 2 > DRIVEN_SLIP_EPS;

  // 1 - brake ducts
  const ducts = ((): LadderStep => {
    const L = "condotti freni";
    const axle = (ws: number[]): number | null => {
      const ts = zs
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
      imbalance > DUCT_IMBALANCE
        ? "aprire i condotti dell'asse più caldo, o chiudere quelli dell'asse più freddo"
        : null,
    ].filter((f) => f != null);
    const data = `ant ${Math.round(front)} °C, post ${Math.round(rear)} °C, sbil. ${pct(imbalance)}`;
    return fixes.length
      ? step(1, L, "fix", `${data} → ${fixes.join("; ")}`)
      : step(1, L, "ok", data);
  })();

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
        ? step(2, L, "fix", `${data} → bilanciamento verso il posteriore`)
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
      );
    if (r > LOCK_SHARE && r >= LOCK_RATIO * f)
      return step(
        2,
        L,
        "fix",
        `${data} → bilanciamento verso l'anteriore (il posteriore scoda)`,
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
          `${data} → coast ramp più aperta; se è già al minimo, meno freno motore (su AMS2 engine braking più alto = meno freno motore)`,
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
        )
      : step(4, L, "ok", `Δ entro ±${TYRE_BALANCE_TOL_C} °C su tutte le ruote`);
  })();
  const camber = ((): LadderStep => {
    const L = "campanatura";
    if (!tyres) return step(5, L, "na", noTemps);
    const { innerMinusOuterC, pressureState } = tyres.summary;
    const okWheels = W.filter((w) => pressureState[w] === "ok");
    if (!okWheels.length)
      return step(5, L, "na", "nessuna ruota con pressione a posto");
    const off = okWheels.flatMap((w) => {
      const dir = majority(
        tyres.perLap.map((t) =>
          t.d[w] < CAMBER_MIN_C ? "più" : t.d[w] > CAMBER_MAX_C ? "meno" : "ok",
        ),
        "ok",
      );
      return dir === "ok"
        ? []
        : [
            `${WHEELS[w]} ${signed(innerMinusOuterC[w])} °C → ${dir} campanatura negativa`,
          ];
    });
    return off.length
      ? step(5, L, "fix", `interna−esterna ${off.join(", ")}`)
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
        `${data} → chiudere la power ramp (più bloccaggio)`,
      );
    if (exitOver > exits / 2)
      return step(6, L, "fix", `${data} → aprire la power ramp`);
    if (entryOver > entry / 2)
      return step(
        6,
        L,
        "fix",
        `${data} → chiudere la coast ramp; se è già al minimo, più precarico`,
      );
    return step(6, L, "ok", data);
  })();

  // Fixed setup: only ducts and bias exist, and the ducts cannot be touched.
  const steps = opts.fixedSetup
    ? [{ ...ducts, proposable: false }, bias]
    : [ducts, bias, engine, pressures, camber, diff];
  return {
    ...base,
    steps,
    current: steps.find((s) => s.status === "fix" && s.proposable)?.n ?? null,
  };
};
