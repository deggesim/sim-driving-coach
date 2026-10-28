/**
 * Runnable self-check for computeSetupLadder (assert-only, no framework).
 *
 *   npm run selfcheck
 */
import assert from "node:assert/strict";
import {
  computeSetupLadder,
  judgedLapsOfLastSegment,
  ladderFlags,
  stintReadyMessage,
  verdictKey,
  type SetupLadder,
} from "./setup-ladder.js";
import type { SetupOverview } from "./setup-overview.js";
import type { Ams2Car } from "../ams2/ams2-cars.js";
import type {
  GameSource,
  LapRow,
  SetupParam,
  ZoneData,
} from "../../shared/types.js";

const mkLap = (
  lap_number: number,
  zones: ZoneData[],
  extra: Partial<LapRow> = {},
): LapRow => ({
  id: lap_number,
  session_id: 1,
  setup_id: null,
  lap_number,
  lap_time: 100,
  sector1: 1,
  sector2: 1,
  sector3: 1,
  valid: true,
  zones_json: JSON.stringify(zones),
  recorded_at: "2026-10-20T00:00:00.000Z",
  ...extra,
});

const zone = (over: Partial<ZoneData> = {}): ZoneData => ({
  zone: 0,
  dist: 0,
  avgSpeedKmh: 100,
  minSpeedKmh: 80,
  maxBrakePct: 0.5,
  avgThrottlePct: 0.5,
  maxSteerAbs: 0.2,
  steerDuringBrake: 0.1,
  brakeFrames: 10,
  throttleFrames: 10,
  coastFrames: 0,
  overlapFrames: 0,
  tcActivations: 0,
  absActivations: 0,
  tcActiveFrames: 0,
  absActiveFrames: 0,
  brakeStartDist: null,
  brakeEndDist: null,
  throttlePickupDist: null,
  ...over,
});

// A zone where every step reads "ok": rwd, no locks, no nervous downshift,
// pressures and camber in the window, no spin, neutral corners.
const okZone = (over: Partial<ZoneData> = {}): ZoneData =>
  zone({
    avgBrakeTempC: [600, 600, 560, 560],
    maxGLat: 1.5,
    avgSlipRatioThrottle: [0.01, 0.01, 0.06, 0.06],
    avgTyrePressure: [27, 27, 26, 26],
    avgTyreTempInnerC: [87, 87, 87, 87],
    avgTyreTempCenterC: [86, 86, 86, 86],
    avgTyreTempOuterC: [83, 83, 83, 83],
    hardBrakeFrames: 100,
    absHardBrakeFrames: 0,
    srHardBrakeFrames: 100,
    lockFramesFront: 1,
    lockFramesRear: 1,
    downshifts: 10,
    nervousDownshifts: 0,
    exitFrames: 100,
    spinFramesFront: 0,
    spinFramesRear: 5,
    cornersEntry: 4,
    cornersEntryUnder: 0,
    cornersEntryOver: 0,
    cornersExit: 4,
    cornersExitOver: 0,
    ...over,
  });

// n laps (1..n) with the same zone and setup.
const stint = (n: number, z: ZoneData, extra: Partial<LapRow> = {}): LapRow[] =>
  Array.from({ length: n }, (_, i) => mkLap(i + 1, [z], extra));

const ladder = (z: ZoneData, fixedSetup = false): SetupLadder =>
  computeSetupLadder(stint(5, z), new Map(), { fixedSetup });

const stepOf = (l: SetupLadder, n: number) =>
  l.steps.find((s) => s.n === n) ?? assert.fail(`step ${n} missing`);

// --- Lap selection ---
const short = computeSetupLadder(stint(2, okZone()), new Map(), {
  fixedSetup: false,
});
assert.equal(short.judgedLaps, 1, "settled from the 2nd lap: no fixed floor");
assert.equal(short.lapsMissing, 1, "1 of the 2 judged laps missing");
assert.deepEqual(
  short.steps.map((s) => s.n),
  [1],
  "step 1 is judged on the lap after the out-lap",
);
assert.equal(short.current, null);

const twoSetups = computeSetupLadder(
  [
    ...stint(2, okZone(), { setup_id: 3 }),
    ...stint(5, okZone(), { setup_id: 7 }).map((l) => ({
      ...l,
      lap_number: l.lap_number + 2,
    })),
  ],
  new Map([
    [3, "Prove A"],
    [7, "Gara B"],
  ]),
  { fixedSetup: false },
);
assert.equal(
  twoSetups.judgedLaps,
  4,
  "laps 4-7: the segment's 1st lap has no reference",
);
assert.equal(twoSetups.firstJudgedLap, 4);
assert.equal(twoSetups.lastJudgedLap, 7);
assert.equal(twoSetups.lapsMissing, 0);
assert.equal(twoSetups.setupLabel, "Gara B");
assert.equal(twoSetups.steps.length, 6);
assert.ok(
  twoSetups.steps.every((s) => s.status === "ok"),
  JSON.stringify(twoSetups.steps),
);
assert.equal(twoSetups.current, null, "no step to fix");

const invalidFourth = computeSetupLadder(
  stint(6, okZone()).map((l) =>
    l.lap_number === 4 ? { ...l, valid: false } : l,
  ),
  new Map(),
  { fixedSetup: false },
);
// The overview judges the same laps: the 1st lap of the segment has no reference.
assert.equal(judgedLapsOfLastSegment(stint(5, okZone()), {}).length, 4);
assert.equal(
  invalidFourth.judgedLaps,
  4,
  "laps 2,3,5,6: the invalid lap is skipped",
);

// The tyres decide, not the lap count: a warm-up ramp is judged only once the
// mean centre temperature moves ≤ 2 °C per lap.
const tempLap = (n: number, t: number, extra: Partial<LapRow> = {}): LapRow =>
  mkLap(
    n,
    [
      okZone({
        avgTyreTempInnerC: [t + 1, t + 1, t + 1, t + 1],
        avgTyreTempCenterC: [t, t, t, t],
        avgTyreTempOuterC: [t - 3, t - 3, t - 3, t - 3],
      }),
    ],
    extra,
  );
const ladderOf = (temps: number[]): SetupLadder =>
  computeSetupLadder(
    temps.map((t, i) => tempLap(i + 1, t)),
    new Map(),
    { fixedSetup: false },
  );
const ramp = ladderOf([60, 75, 82, 85, 86, 86]);
assert.equal(ramp.judgedLaps, 2, "Δ 15, 7, 3 are still warming: laps 5-6 only");
assert.equal(ramp.firstJudgedLap, 5);
assert.equal(ramp.lapsMissing, 0);
// A pit stop (tyres cold again) drops the laps until they are back at temperature.
const pit = ladderOf([86, 86, 86, 86, 60, 72, 80, 85, 86]);
assert.equal(pit.judgedLaps, 4, "laps 2-4, then 9");
assert.equal(pit.lastJudgedLap, 9);
assert.equal(ladderOf([60, 75, 82]).lapsMissing, 2, "nothing settled yet");

// Without centre temperatures (ACE/AMS2) the fixed warm-up stays: judged from the 4th lap.
const noTemps = computeSetupLadder(stint(5, zone()), new Map(), {
  fixedSetup: false,
});
assert.equal(noTemps.firstJudgedLap, 4);
assert.equal(noTemps.judgedLaps, 2);
assert.equal(
  computeSetupLadder(stint(3, zone()), new Map(), { fixedSetup: false })
    .lapsMissing,
  2,
);

// --- Step 1: brake ducts ---
const hotFront = ladder(okZone({ avgBrakeTempC: [720, 720, 400, 400] }));
assert.equal(stepOf(hotFront, 1).status, "fix");
assert.equal(hotFront.current, 1);
const unbalanced = ladder(okZone({ avgBrakeTempC: [450, 450, 250, 250] }));
assert.equal(stepOf(unbalanced, 1).status, "fix");
assert.ok(stepOf(unbalanced, 1).reason.includes("44 %"));
assert.ok(stepOf(unbalanced, 1).reason.includes(", o chiudere"));
// Both axles under the window (live Monza: 362/280 °C): only close the colder.
const bothCold = stepOf(
  ladder(okZone({ avgBrakeTempC: [362, 362, 280, 280] })),
  1,
).reason;
assert.ok(bothCold.endsWith("→ chiudere i condotti dell'asse più freddo"));
const bothHot = stepOf(
  ladder(okZone({ avgBrakeTempC: [690, 690, 900, 900] })),
  1,
).reason;
assert.ok(bothHot.endsWith("→ aprire i condotti dell'asse più caldo"));
assert.equal(stepOf(ladder(okZone()), 1).status, "ok");
const noBrakeTemps = ladder(
  okZone({
    avgBrakeTempC: [-1, -1, -1, -1],
    absHardBrakeFrames: 30,
    cornersEntryUnder: 3,
  }),
);
assert.equal(stepOf(noBrakeTemps, 1).status, "na");
assert.equal(noBrakeTemps.current, 2, "a na step is skipped, never current");

// --- Step 2 without ABS ---
const frontLock = ladder(okZone({ lockFramesFront: 8, lockFramesRear: 2 }));
assert.equal(stepOf(frontLock, 2).status, "fix");
assert.ok(stepOf(frontLock, 2).reason.includes("posteriore"));
// Both axles lock, neither twice the other: brake pressure, not bias.
const bothLock = stepOf(
  ladder(okZone({ lockFramesFront: 8, lockFramesRear: 6 })),
  2,
);
assert.equal(bothLock.status, "fix");
assert.ok(bothLock.reason.includes("ridurre la forza frenante"));
assert.equal(
  stepOf(ladder(okZone({ lockFramesFront: 8, lockFramesRear: 5 })), 2).status,
  "ok",
  "front over 5 %, rear at 5 %, not twice: still ok",
);
const rearLock = ladder(okZone({ lockFramesFront: 0, lockFramesRear: 6 }));
assert.ok(stepOf(rearLock, 2).reason.includes("verso l'anteriore"));
// Lock share is over the frames that carry slip, not every hard-brake frame.
const fewSlipFrames = ladder(
  okZone({ srHardBrakeFrames: 40, lockFramesFront: 4, lockFramesRear: 0 }),
);
assert.equal(stepOf(fewSlipFrames, 2).status, "fix", "4/40 = 10 %");
assert.equal(
  stepOf(ladder(okZone({ srHardBrakeFrames: 0 })), 2).reason,
  "manca lo slip",
);

// --- Step 2 with ABS ---
const absUnder = ladder(
  okZone({ absHardBrakeFrames: 30, cornersEntryUnder: 3 }),
);
assert.equal(stepOf(absUnder, 2).status, "fix");
assert.ok(stepOf(absUnder, 2).reason.includes("verso il posteriore"));
assert.equal(
  stepOf(ladder(okZone({ absHardBrakeFrames: 30, cornersEntryUnder: 1 })), 2)
    .status,
  "ok",
);
const absNoCorners = ladder(
  okZone({
    absHardBrakeFrames: 30,
    cornersEntry: undefined,
    maxGLat: undefined,
  }),
);
assert.equal(stepOf(absNoCorners, 2).status, "na");
assert.equal(stepOf(absNoCorners, 2).reason, "manca l'accelerazione laterale");
assert.equal(
  stepOf(ladder(okZone({ absHardBrakeFrames: 30, cornersEntry: undefined })), 2)
    .reason,
  "nessuna curva misurabile",
);
assert.equal(
  stepOf(ladder(okZone({ hardBrakeFrames: 0 })), 2).reason,
  "nessuna frenata forte",
);

// --- Step 3: engine braking ---
assert.equal(
  stepOf(ladder(okZone({ nervousDownshifts: 3 })), 3).status,
  "fix",
  "3/10 nervous",
);
// Guide slides 22-23/53: oversteer on downshift = close the coast ramp, never open it.
assert.ok(
  stepOf(ladder(okZone({ nervousDownshifts: 3 })), 3).reason.includes(
    "coast ramp più chiusa",
  ),
);
const fwd = ladder(
  okZone({
    nervousDownshifts: 3,
    avgSlipRatioThrottle: [0.08, 0.08, 0.01, 0.01],
  }),
);
assert.equal(stepOf(fwd, 3).status, "na");
assert.equal(stepOf(fwd, 3).reason, "trazione anteriore");
assert.equal(
  stepOf(ladder(okZone({ downshifts: 0, nervousDownshifts: 0 })), 3).reason,
  "nessuna scalata",
);

// --- Step 4: the four calibration points of Δ, one per wheel ---
const calib = ladder(
  okZone({
    avgTyreTempInnerC: [84, 73, 89, 85],
    avgTyreTempCenterC: [81, 73, 88, 83],
    avgTyreTempOuterC: [81, 70, 87, 79],
  }),
);
const calibTyres = calib.tyres.at(-1) ?? assert.fail("tyres missing");
assert.deepEqual(calibTyres.pressureState, ["bassa", "alta", "ok", "ok"]);
assert.equal(stepOf(calib, 4).status, "fix");
assert.ok(stepOf(calib, 4).reason.includes("ANT-SX"));
assert.ok(!stepOf(calib, 4).reason.includes("POST-SX"));
// The reason names the axle (largest |Δ|) and only its out-of-tolerance wheels.
assert.equal(
  stepOf(calib, 4).reason,
  "asse ANT: Δ ANT-SX -1.5 °C → alzare, Δ ANT-DX +1.5 °C → abbassare",
);
// Rear axle wins (|Δ| 3.0 vs 1.5): the front wheel that is also off is not listed.
const rearAxle = ladder(
  okZone({
    avgTyreTempInnerC: [85, 87, 84, 88],
    avgTyreTempCenterC: [86.5, 87, 87, 86],
    avgTyreTempOuterC: [85, 87, 84, 88],
  }),
);
assert.equal(
  stepOf(rearAxle, 4).reason,
  "asse POST: Δ POST-SX +3.0 °C → abbassare, Δ POST-DX -2.0 °C → alzare",
);
// Tie on |Δ| between the axles: the front.
const axleTie = ladder(
  okZone({
    avgTyreTempInnerC: [85, 87, 85, 87],
    avgTyreTempCenterC: [87, 87, 83, 87],
    avgTyreTempOuterC: [85, 87, 85, 87],
  }),
);
assert.equal(
  stepOf(axleTie, 4).reason,
  "asse ANT: Δ ANT-SX +2.0 °C → abbassare",
);
assert.deepEqual(calibTyres.hotPressurePsi, [27, 27, 26, 26]);
assert.equal(calibTyres.judgedLaps, 4);
assert.deepEqual(calibTyres.driftPsi, [0, 0, 0, 0]);
assert.equal(
  computeSetupLadder(stint(3, okZone()), new Map(), { fixedSetup: false })
    .tyres[0].driftPsi,
  null,
  "drift needs ≥ 3 judged laps",
);

// Majority of judged laps: alta on 1 of 2 laps is not a majority (the alta
// lap comes first, so a non-strict majority would pick it). Its centre moves
// 0.6 °C, so the plateau still judges it.
const split = computeSetupLadder(
  [
    mkLap(1, [okZone()]),
    mkLap(2, [okZone({ avgTyreTempCenterC: [86.6, 86, 86, 86] })]),
    mkLap(3, [okZone()]),
  ],
  new Map(),
  { fixedSetup: false },
);
assert.equal(split.judgedLaps, 2);
assert.equal(stepOf(split, 4).status, "ok");

// Drift: last − first judged lap, with 3 judged laps.
const drift = computeSetupLadder(
  [
    ...stint(4, okZone()),
    mkLap(5, [okZone({ avgTyrePressure: [27.5, 27, 26, 26] })]),
    mkLap(6, [okZone({ avgTyrePressure: [28, 27, 26, 26] })]),
  ],
  new Map(),
  { fixedSetup: false },
);
assert.deepEqual(drift.tyres.at(-1)?.driftPsi, [1, 0, 0, 0]);

// --- Step 5: camber, only on wheels whose pressure is ok ---
const camberMore = ladder(
  okZone({
    avgTyreTempInnerC: [80, 80, 80, 80],
    avgTyreTempCenterC: [80, 80, 80, 80],
    avgTyreTempOuterC: [79, 79, 79, 79],
  }),
);
assert.equal(stepOf(camberMore, 4).status, "ok");
assert.equal(stepOf(camberMore, 5).status, "fix");
assert.ok(stepOf(camberMore, 5).reason.includes("più campanatura negativa"));
const camberLess = ladder(
  okZone({
    avgTyreTempInnerC: [92, 92, 92, 92],
    avgTyreTempCenterC: [85, 85, 85, 85],
    avgTyreTempOuterC: [80, 80, 80, 80],
  }),
);
assert.equal(stepOf(camberLess, 5).status, "fix");
assert.ok(stepOf(camberLess, 5).reason.includes("meno campanatura negativa"));
// Caster is offered on the front wheels only: two of the four wheels.
assert.equal(
  stepOf(camberLess, 5).reason.split("o più incidenza").length - 1,
  2,
);
assert.ok(!stepOf(camberMore, 5).reason.includes("incidenza"));
// FL has high pressure (Δ +7.5) and d = 15: ignored, so the step is ok.
const highIgnored = ladder(
  okZone({
    avgTyreTempInnerC: [90, 87, 87, 87],
    avgTyreTempCenterC: [90, 86, 86, 86],
    avgTyreTempOuterC: [75, 83, 83, 83],
  }),
);
assert.equal(stepOf(highIgnored, 4).status, "fix");
assert.equal(stepOf(highIgnored, 5).status, "ok");
const allHigh = ladder(
  okZone({
    avgTyreTempInnerC: [90, 90, 90, 90],
    avgTyreTempCenterC: [90, 90, 90, 90],
    avgTyreTempOuterC: [75, 75, 75, 75],
  }),
);
assert.equal(stepOf(allHigh, 5).reason, "nessuna ruota con pressione a posto");

// --- Step 6: differential ---
const spin = ladder(okZone({ spinFramesRear: 30 }));
assert.equal(stepOf(spin, 6).status, "fix");
assert.ok(stepOf(spin, 6).reason.includes("chiudere la power ramp"));
assert.ok(stepOf(spin, 6).reason.includes("più precarico"));
const exitOver = stepOf(ladder(okZone({ cornersExitOver: 3 })), 6).reason;
assert.ok(exitOver.includes("aprire la power ramp"));
assert.ok(exitOver.includes("meno precarico"));
assert.ok(
  stepOf(ladder(okZone({ cornersEntryOver: 3 })), 6).reason.includes(
    "chiudere la coast ramp",
  ),
);
// Front-wheel drive reads the front spin counter.
assert.equal(
  stepOf(
    ladder(
      okZone({
        avgSlipRatioThrottle: [0.08, 0.08, 0.01, 0.01],
        spinFramesFront: 30,
      }),
    ),
    6,
  ).status,
  "fix",
);

// --- AMS2 car table: driveline and differential type ---
const car = (over: Partial<Ams2Car>): Ams2Car => ({
  name: "x",
  weightKg: 1000,
  frontPct: 45,
  driveline: "RWD",
  differential: "C-LSD",
  tankL: null,
  ...over,
});
const withCar = (z: ZoneData, c: Ams2Car | null | undefined): SetupLadder =>
  computeSetupLadder(stint(5, z), new Map(), { fixedSetup: false, car: c });
// Driveline from the table beats the slip heuristic: FWD → step 3 na even with rear-biased slip.
assert.equal(
  stepOf(
    withCar(okZone({ nervousDownshifts: 3 }), car({ driveline: "FWD" })),
    3,
  ).reason,
  "trazione anteriore",
);
// ...and RWD/AWD beat a front-biased slip (not fwd).
for (const driveline of ["RWD", "AWD"])
  assert.equal(
    stepOf(
      withCar(
        okZone({
          avgSlipRatioThrottle: [0.08, 0.08, 0.01, 0.01],
          nervousDownshifts: 3,
        }),
        car({ driveline }),
      ),
      3,
    ).status,
    "fix",
  );
// Non-adjustable differential → step 6 na, before any other check.
for (const differential of ["FIXED", "SPOOL", "OPEN"])
  assert.equal(
    stepOf(withCar(okZone({ spinFramesRear: 30 }), car({ differential })), 6)
      .reason,
    "differenziale non regolabile",
  );
assert.equal(
  stepOf(withCar(zone(), car({ differential: "FIXED" })), 6).reason,
  "differenziale non regolabile",
  "even without counters",
);
// Geared LSD → bias ratio wording, no preload fallback.
for (const differential of ["G-LSD", "GC-LSD"]) {
  const g = (z: Partial<ZoneData>) =>
    stepOf(withCar(okZone(z), car({ differential })), 6).reason;
  const power = g({ spinFramesRear: 30 });
  assert.ok(power.includes("alzare il bias ratio power"), power);
  assert.ok(!power.includes("precarico") && !power.includes("ramp"), power);
  const open = g({ cornersExitOver: 3 });
  assert.ok(open.includes("abbassare il bias ratio power"), open);
  assert.ok(!open.includes("precarico") && !open.includes("ramp"), open);
  const coast = g({ cornersEntryOver: 3 });
  assert.ok(coast.includes("alzare il bias ratio coast"), coast);
  assert.ok(!coast.includes("precarico") && !coast.includes("ramp"), coast);
}
// Clutch LSDs (incl. SPL/C-LSD) keep the ramp wording; no car = today's behaviour.
for (const c of [
  car({ differential: "C-LSD" }),
  car({ differential: "SPL/C-LSD" }),
  null,
  undefined,
])
  assert.ok(
    stepOf(withCar(okZone({ spinFramesRear: 30 }), c), 6).reason.includes(
      "chiudere la power ramp (più bloccaggio); se è già chiusa del tutto, più precarico",
    ),
  );

// --- Old session: base fields only ---
const old = ladder(zone());
assert.equal(old.steps.length, 6);
assert.ok(
  old.steps.every((s) => s.status === "na"),
  JSON.stringify(old.steps),
);
assert.equal(old.current, null);
assert.equal(old.tyres.length, 0);

// --- fixedSetup: steps 1-2 only, step 1 not proposable ---
const fixed = ladder(
  okZone({ avgBrakeTempC: [720, 720, 400, 400], lockFramesFront: 8 }),
  true,
);
assert.equal(fixed.steps.length, 2);
assert.equal(stepOf(fixed, 1).status, "fix");
assert.equal(stepOf(fixed, 1).proposable, false);
assert.equal(fixed.current, 2);

// --- leaderboardMode: tyres fixed at 85 °C, so steps 4-5 are na and no tyre lines ---
const lbZone = okZone({
  avgTyreTempCenterC: [95, 95, 95, 95], // would be "alta" outside Leaderboard
  spinFramesRear: 50, // step 6 still judged
});
const lb = computeSetupLadder(stint(5, lbZone), new Map(), {
  fixedSetup: false,
  leaderboardMode: true,
});
assert.equal(lb.steps.length, 6, "Leaderboard keeps all six steps");
for (const n of [4, 5]) {
  assert.equal(stepOf(lb, n).status, "na");
  assert.equal(stepOf(lb, n).reason, "gomme fisse a 85 °C (Leaderboard)");
}
assert.equal(stepOf(lb, 1).status, "ok", "steps 1-3 judged as usual");
assert.equal(stepOf(lb, 6).status, "fix", "step 6 judged as usual");
assert.equal(lb.current, 6);
assert.equal(lb.tyres.length, 0, "no tyre lines in Leaderboard");
assert.equal(
  stepOf(ladder(lbZone), 4).status,
  "fix",
  "the same data outside Leaderboard is judged",
);
const lbFixed = computeSetupLadder(
  stint(5, okZone({ lockFramesFront: 8 })),
  new Map(),
  { fixedSetup: true, leaderboardMode: true },
);
assert.equal(lbFixed.steps.length, 2, "Leaderboard + Fixed Setup: steps 1-2");
assert.equal(lbFixed.current, 2);
assert.equal(lbFixed.tyres.length, 0);
assert.equal(
  computeSetupLadder(stint(2, okZone()), new Map(), {
    fixedSetup: false,
    leaderboardMode: true,
  }).tyres.length,
  0,
  "also while laps are missing",
);

// --- tyres: one per segment with ≥ 2 judged laps ---
const twoStints = computeSetupLadder(
  [
    ...stint(5, okZone(), { setup_id: 3 }),
    ...stint(5, okZone(), { setup_id: 7 }).map((l) => ({
      ...l,
      lap_number: l.lap_number + 5,
    })),
  ],
  new Map([
    [3, "Prove A"],
    [7, "Gara B"],
  ]),
  { fixedSetup: false },
);
assert.equal(twoStints.tyres.length, 2);
assert.equal(twoStints.tyres[0].setupLabel, "Prove A");
assert.equal(twoStints.tyres[1].setupLabel, "Gara B");
assert.equal(twoSetups.tyres.length, 1, "a 2-lap segment has 1 judged lap");

// --- stintReadyMessage: spoken once the stint has ≥ 3 judged laps ---
const readyOf = (laps: number, z: ZoneData): string | null =>
  stintReadyMessage(
    computeSetupLadder(stint(laps, z), new Map(), { fixedSetup: false }),
  );
assert.equal(readyOf(3, okZone()), null, "2 judged laps: not yet");
assert.equal(
  readyOf(4, okZone()),
  "Stint analizzabile: 3 giri giudicati. Nessun passo da correggere. Puoi metterti in pausa ed eseguire l'analisi.",
);
assert.equal(
  readyOf(5, okZone({ avgBrakeTempC: [720, 720, 400, 400] })),
  "Stint analizzabile: 4 giri giudicati. Primo passo da correggere: condotti freni. Puoi metterti in pausa ed eseguire l'analisi.",
);
// No temperatures (fixed warm-up, 3 judged laps by lap 6) and every step na: still speaks.
assert.ok(readyOf(6, zone())?.includes("Nessun passo da correggere"));

// --- stintReadyMessage with the overview: complete ladder, first area to fix ---
const ladderComplete = computeSetupLadder(stint(4, okZone()), new Map(), {
  fixedSetup: false,
});
const overviewCurrent6 = {
  areas: [
    {
      n: 6,
      label: "barre antirollio",
      status: "fix",
      reason: "x",
      proposable: true,
    },
  ],
  current: 6,
  afterLadder: false,
  weight: { known: false, reason: "x" },
  tyreLine: null,
} satisfies SetupOverview;
assert.ok(
  stintReadyMessage(ladderComplete, overviewCurrent6)?.includes(
    "Sequenza completa, prima area dell'assetto: barre antirollio.",
  ),
);
assert.ok(
  stintReadyMessage(ladderComplete)?.includes("Nessun passo da correggere."),
  "overview absent: unchanged",
);
assert.ok(
  stintReadyMessage(ladderComplete, {
    ...overviewCurrent6,
    current: null,
  })?.includes("Nessun passo da correggere."),
);

// --- ladderFlags: the DB columns default to 1 for every game, but the two
// flags only mean something on R3E; camber is unreadable on ACE only ---
const both = { leaderboardMode: true, fixedSetup: true };
assert.deepEqual(ladderFlags("ace", both), {
  leaderboardMode: false,
  fixedSetup: false,
  camberUnreadable: true,
});
assert.deepEqual(ladderFlags("ams2", both), {
  leaderboardMode: false,
  fixedSetup: false,
  camberUnreadable: false,
});
assert.deepEqual(ladderFlags("r3e", both), {
  ...both,
  camberUnreadable: false,
});
assert.deepEqual(
  ladderFlags("r3e", { leaderboardMode: false, fixedSetup: true }),
  { leaderboardMode: false, fixedSetup: true, camberUnreadable: false },
);

// --- plateau on the carcass: ACE's centre surface temp swings with the load
// (36-125 °C in one lap), so its lap mean never settles; the carcass does ---
const carcassLap = (n: number, carcass: number, centre: number): LapRow =>
  mkLap(n, [
    okZone({
      avgTyreTempC: [carcass, carcass, carcass, carcass],
      avgTyreTempCenterC: [centre, centre, centre, centre],
    }),
  ]);
const swingy = computeSetupLadder(
  [
    carcassLap(1, 60, 50),
    carcassLap(2, 64, 62),
    carcassLap(3, 64.5, 55),
    carcassLap(4, 65, 66),
  ],
  new Map(),
  { fixedSetup: false },
);
assert.equal(swingy.judgedLaps, 2, "carcass Δ 0.5 on laps 3-4, centre ignored");
assert.equal(swingy.firstJudgedLap, 3);
const hot = computeSetupLadder(
  [carcassLap(1, 60, 80), carcassLap(2, 67, 80), carcassLap(3, 74, 80)],
  new Map(),
  { fixedSetup: false },
);
assert.equal(
  hot.judgedLaps,
  0,
  "carcass still climbing, a flat centre does not settle it",
);

// --- camber on ACE: the step is "na", and no inner-outer figure is handed to the prompt ---
const flatShoulders = (flags: { camberUnreadable: boolean }): SetupLadder =>
  computeSetupLadder(
    stint(
      5,
      okZone({
        avgTyreTempInnerC: [86, 86, 86, 86],
        avgTyreTempOuterC: [85, 85, 85, 85], // inner − outer 1 °C: below the 2 °C floor
      }),
    ),
    new Map(),
    { fixedSetup: false, ...flags },
  );
const aceLadder = flatShoulders({ camberUnreadable: true });
assert.equal(stepOf(aceLadder, 5).status, "na");
assert.ok(stepOf(aceLadder, 5).reason.includes("ACE"));
assert.equal(aceLadder.tyres[0].innerMinusOuterC, null);
assert.equal(
  stepOf(aceLadder, 4).status,
  "ok",
  "pressures stay judged: the centre-vs-shoulders delta does not depend on orientation",
);
assert.equal(
  stepOf(flatShoulders({ camberUnreadable: false }), 5).status,
  "fix",
  "the same flat shoulders elsewhere are judged: more negative camber",
);

// --- Step 1 on the laps after the out-lap, before the judged laps ---
// Tyres never settle (+5 °C per lap): 0 judged laps, but brakes are judged on laps 2..n.
type Q = [number, number, number, number];
const drifting = (n: number, brakes: Q, extra: Partial<LapRow> = {}) =>
  Array.from({ length: n }, (_, i) =>
    mkLap(
      i + 1,
      [
        okZone({
          avgBrakeTempC: brakes,
          avgTyreTempC: [70 + 5 * i, 70 + 5 * i, 70 + 5 * i, 70 + 5 * i],
        }),
      ],
      extra,
    ),
  );
const early = computeSetupLadder(drifting(3, [720, 720, 400, 400]), new Map(), {
  fixedSetup: false,
});
assert.ok(early.lapsMissing > 0);
assert.equal(early.ductsLaps, 2);
assert.equal(early.current, 1);
assert.deepEqual(
  early.steps.map((s) => s.n),
  [1],
);
assert.equal(early.steps[0].status, "fix");
// Brakes in the window: step 1 shown, not current.
const earlyOk = computeSetupLadder(
  drifting(3, [600, 600, 560, 560]),
  new Map(),
  { fixedSetup: false },
);
assert.equal(earlyOk.current, null);
assert.equal(earlyOk.steps[0].status, "ok");
// Invalid laps still count for the brakes.
assert.equal(
  computeSetupLadder(
    drifting(3, [720, 720, 400, 400], { valid: false }),
    new Map(),
    {
      fixedSetup: false,
    },
  ).current,
  1,
);
// One lap after the out-lap: step 1 shown, not yet current.
const oneLap = computeSetupLadder(
  drifting(2, [720, 720, 400, 400]),
  new Map(),
  {
    fixedSetup: false,
  },
);
assert.equal(oneLap.ductsLaps, 1);
assert.equal(oneLap.current, null);
assert.equal(oneLap.steps[0].status, "fix");
// Only the out-lap: no step yet.
assert.deepEqual(
  computeSetupLadder(drifting(1, [720, 720, 400, 400]), new Map(), {
    fixedSetup: false,
  }).steps,
  [],
);
// Fixed Setup: step 1 is not proposable, so never current before the judged laps.
assert.equal(
  computeSetupLadder(drifting(3, [720, 720, 400, 400]), new Map(), {
    fixedSetup: true,
  }).current,
  null,
);

// --- Readiness: 2 counted laps when the verdict is stable, else 3 ---
const L = (laps: LapRow[]) =>
  computeSetupLadder(laps, new Map(), { fixedSetup: false });
// The verdict before the last counted lap is judged on a single lap.
const L1 = (laps: LapRow[]) =>
  computeSetupLadder(laps, new Map(), { fixedSetup: false, minJudgedLaps: 1 });
assert.equal(L1(stint(2, okZone())).lapsMissing, 0);
// Stable at 2 judged laps: speaks one lap earlier than today.
assert.equal(
  stintReadyMessage(L(stint(3, okZone())), null, {
    ladder: L1(stint(2, okZone())),
  }),
  "Stint analizzabile: 2 giri giudicati. Nessun passo da correggere. Puoi metterti in pausa ed eseguire l'analisi.",
);
// Numbers alone differ: still stable.
const hotF = (t: number) => okZone({ avgBrakeTempC: [t, t, 400, 400] });
assert.equal(
  verdictKey(L(stint(3, hotF(720)))),
  verdictKey(L(stint(3, hotF(730)))),
);
// The verdict flips with the second judged lap: wait for the third.
assert.equal(
  stintReadyMessage(L(stint(3, okZone())), null, {
    ladder: L1(stint(2, hotF(720))),
  }),
  null,
);
// Without prev: today's rule (3 judged laps).
assert.equal(stintReadyMessage(L(stint(3, okZone()))), null);
// Current step 4 (pressures): 3 laps even when stable.
const lowPress = okZone({ avgTyreTempCenterC: [83, 83, 83, 83] }); // Δ centre − shoulders −2 °C: "bassa"
assert.equal(L(stint(3, lowPress)).current, 4);
assert.equal(
  stintReadyMessage(L(stint(3, lowPress)), null, {
    ladder: L1(stint(2, lowPress)),
  }),
  null,
);
// Early step 1 (`drifting`): 2 brake laps, stable against 1 → ready.
assert.equal(
  stintReadyMessage(L(drifting(3, [720, 720, 400, 400])), null, {
    ladder: L(drifting(2, [720, 720, 400, 400])),
  }),
  "Stint analizzabile: 2 giri giudicati. Primo passo da correggere: condotti freni. Puoi metterti in pausa ed eseguire l'analisi.",
);

// --- A step to fix without its lever in the loaded setup is skipped ---
const P = (...names: string[]): SetupParam[] =>
  names.map((parameter) => ({ category: "x", parameter, value: "1" }));
const withParams = (laps: LapRow[], params: SetupParam[] | null) =>
  computeSetupLadder(laps, new Map(), {
    fixedSetup: false,
    setupParams: params,
  });
const unbalancedLaps = stint(
  5,
  okZone({ avgBrakeTempC: [720, 720, 400, 400] }),
);
// R3E Porsche (2026-10-27): no duct lever → step 1 na, the ladder moves on.
const noDucts = withParams(
  unbalancedLaps,
  P(
    "Brake Bias",
    "Tyre Pressure Front Left",
    "Camber Front Left",
    "Differential Preload",
  ),
);
assert.equal(stepOf(noDucts, 1).status, "na");
assert.ok(
  stepOf(noDucts, 1).reason.startsWith(
    "leva non presente nel setup caricato — ",
  ),
);
assert.equal(noDucts.current, null);
// ACE never exports ducts either.
assert.equal(
  withParams(
    unbalancedLaps,
    P("Ripartizione Frenata Anteriore", "Pressione FL"),
  ).current,
  null,
);
// The lever exists → unchanged.
assert.equal(withParams(unbalancedLaps, P("Condotti freni")).current, 1);
// No setup loaded → unchanged.
assert.equal(withParams(unbalancedLaps, null).current, 1);
// Early step 1 (`drifting`) without the lever: not current.
assert.equal(
  withParams(drifting(3, [720, 720, 400, 400]), P("Brake Bias")).current,
  null,
);
// An ok step without its lever stays ok.
assert.equal(stepOf(withParams(stint(5, okZone()), P()), 1).status, "ok");
// Brake pressure is not a tyre-pressure lever.
assert.equal(
  stepOf(withParams(stint(5, lowPress), P("Pressione freni")), 4).status,
  "na",
);
assert.equal(
  stepOf(withParams(stint(5, lowPress), P("Pressione RL")), 4).status,
  "fix",
);

// --- R3E: a step whose moves are all at the end of their range is ok ---
const lp = (parameter: string, limit?: "min" | "max"): SetupParam => ({
  category: "x",
  parameter,
  value: "1",
  limit,
});
// inner−outer +1 °C (more negative camber), pressures in the window.
const camberLaps = stint(
  5,
  okZone({
    avgTyreTempInnerC: [84, 84, 84, 84],
    avgTyreTempCenterC: [84, 84, 84, 84],
    avgTyreTempOuterC: [83, 83, 83, 83],
  }),
);
const r3eLadder = (params: SetupParam[], game: GameSource = "r3e") =>
  computeSetupLadder(camberLaps, new Map(), {
    fixedSetup: false,
    setupParams: params,
    game,
  });
const corners4 = ["Front Left", "Front Right", "Rear Left", "Rear Right"];
const free = r3eLadder(corners4.map((w) => lp(`Camber ${w}`)));
assert.equal(free.current, 5, "camber is the step to fix");
const atEnd = r3eLadder(corners4.map((w) => lp(`Camber ${w}`, "min")));
assert.equal(stepOf(atEnd, 5).status, "ok");
assert.ok(stepOf(atEnd, 5).reason.endsWith(" — già a fondo scala"));
assert.equal(atEnd.current, null);
// One wheel can still move → still fix.
assert.equal(
  stepOf(
    r3eLadder([
      ...corners4.slice(1).map((w) => lp(`Camber ${w}`, "min")),
      lp("Camber Front Left"),
    ]),
    5,
  ).status,
  "fix",
);
// "max" does not block a move down.
assert.equal(
  stepOf(r3eLadder(corners4.map((w) => lp(`Camber ${w}`, "max"))), 5).status,
  "fix",
);
// Limits are R3E-only.
assert.equal(
  stepOf(
    r3eLadder(
      corners4.map((w) => lp(`Camber ${w}`, "min")),
      "ace",
    ),
    5,
  ).status,
  "fix",
);
// Bias toward the rear (front locks) blocked at the top of Brake Bias.
const frontLocks = stint(5, okZone({ lockFramesFront: 20, lockFramesRear: 1 }));
const biasAt = (limit?: "min" | "max") =>
  stepOf(
    computeSetupLadder(frontLocks, new Map(), {
      fixedSetup: false,
      setupParams: [lp("Brake Bias", limit)],
      game: "r3e",
    }),
    2,
  ).status;
assert.equal(biasAt(), "fix");
assert.equal(biasAt("max"), "ok");
assert.equal(biasAt("min"), "fix");
