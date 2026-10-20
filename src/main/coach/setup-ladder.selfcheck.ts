/**
 * Runnable self-check for computeSetupLadder (assert-only, no framework).
 *
 *   npm run selfcheck
 */
import assert from "node:assert/strict";
import { computeSetupLadder, type SetupLadder } from "./setup-ladder.js";
import type { LapRow, ZoneData } from "../../shared/types.js";

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
assert.equal(short.lapsMissing, 3, "1 warm-up lap + 2 judged laps missing");
assert.equal(short.steps.length, 0);
assert.equal(short.current, null);

const twoSetups = computeSetupLadder(
  [
    ...stint(4, okZone(), { setup_id: 3 }),
    ...stint(5, okZone(), { setup_id: 7 }).map((l) => ({
      ...l,
      lap_number: l.lap_number + 4,
    })),
  ],
  new Map([
    [3, "Prove A"],
    [7, "Gara B"],
  ]),
  { fixedSetup: false },
);
assert.equal(twoSetups.judgedLaps, 2);
assert.equal(twoSetups.firstJudgedLap, 8);
assert.equal(twoSetups.lastJudgedLap, 9);
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
assert.equal(invalidFourth.judgedLaps, 2);

// --- Step 1: brake ducts ---
const hotFront = ladder(okZone({ avgBrakeTempC: [720, 720, 400, 400] }));
assert.equal(stepOf(hotFront, 1).status, "fix");
assert.equal(hotFront.current, 1);
const unbalanced = ladder(okZone({ avgBrakeTempC: [450, 450, 250, 250] }));
assert.equal(stepOf(unbalanced, 1).status, "fix");
assert.ok(stepOf(unbalanced, 1).reason.includes("44 %"));
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
assert.equal(
  stepOf(ladder(okZone({ lockFramesFront: 8, lockFramesRear: 6 })), 2).status,
  "ok",
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
assert.deepEqual(calibTyres.hotPressurePsi, [27, 27, 26, 26]);
assert.equal(calibTyres.judgedLaps, 2);
assert.equal(calibTyres.driftPsi, null, "drift needs ≥ 3 judged laps");

// Majority of judged laps: alta on 1 of 2 laps is not a majority (the alta
// lap comes first, so a non-strict majority would pick it).
const split = computeSetupLadder(
  [
    ...stint(3, okZone()),
    mkLap(4, [
      okZone({
        avgTyreTempInnerC: [73, 87, 87, 87],
        avgTyreTempCenterC: [73, 86, 86, 86],
        avgTyreTempOuterC: [70, 83, 83, 83],
      }),
    ]),
    mkLap(5, [okZone()]),
  ],
  new Map(),
  { fixedSetup: false },
);
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
assert.ok(
  stepOf(ladder(okZone({ cornersExitOver: 3 })), 6).reason.includes(
    "aprire la power ramp",
  ),
);
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
assert.equal(twoSetups.tyres.length, 1, "a 4-lap segment has 1 judged lap");

console.log("setup-ladder self-check OK");
