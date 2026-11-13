/**
 * Runnable self-check for computeSetupOverview (assert-only, no framework).
 *
 *   npm run selfcheck
 */
import assert from "node:assert/strict";
import { chassisCounters } from "../chassis-counters.js";
import { computeSetupOverview, type SetupOverview } from "./setup-overview.js";
import type { SetupLadder } from "./setup-ladder.js";
import type { SetupLevers } from "./setup-levers.js";
import type { WeightDistribution } from "./weight-distribution.js";
import type { SetupParam, ZoneData } from "../../shared/types.js";

// A zone recorded before this work: base fields only.
const legacyZone: ZoneData = {
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
};
const z = (over: Partial<ZoneData>): ZoneData => ({
  ...legacyZone,
  avgTyreTempC: [85, 85, 85, 85],
  ...over,
});
const rh = (over: Partial<NonNullable<ZoneData["rideHeight"]>> = {}) => ({
  minF: 0.005,
  minR: 0.006,
  straightF: 0,
  straightR: 0,
  straightN: 0,
  midF: 0,
  midR: 0,
  midN: 0,
  ...over,
});
const noBottoming = {
  straight: 0,
  brake: 0,
  other: 0,
  upset: 0,
  front: 0,
  rear: 0,
  straightFront: 0,
  straightRear: 0,
  upsetFront: 0,
  upsetRear: 0,
};

const ladderOk: SetupLadder = {
  setupLabel: null,
  firstJudgedLap: 2,
  lastJudgedLap: 6,
  judgedLaps: 5,
  lapsMissing: 0,
  ductsLaps: 4,
  steps: [],
  current: null,
  tyres: [],
};
const w438: WeightDistribution = {
  known: true,
  frontPct: 43.8,
  source: "AMS2 table",
  aeroFrontPct: null,
  fuelL: null,
};
const springsOff: SetupLevers = {
  springs: { values: [225, 225, 225, 225], unit: "N/mm" },
};
const base = {
  zones: [z({})],
  judgedLaps: 5,
  ladder: ladderOk,
  weight: { known: false, reason: "wheel load not available" },
  levers: null,
  fixedSetup: false,
  leaderboardMode: false,
} satisfies Parameters<typeof computeSetupOverview>[0];
const area = (o: SetupOverview, n: number) =>
  o.areas.find((a) => a.n === n) ?? assert.fail(`area ${n} missing`);
const withZones = (...zones: ZoneData[]): SetupOverview =>
  computeSetupOverview({ ...base, zones });

// A real pre-quadro zone: the ladder-era counters (corners with entry
// understeer included), none of the chassis or speed-class families.
const preQuadroZone: ZoneData = {
  ...legacyZone,
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
  cornersEntryUnder: 3,
  cornersEntryOver: 0,
  cornersExit: 4,
  cornersExitOver: 0,
};

// Old session: no quadro fields → eight areas, all na, no throw; the entry
// understeer does not reach area 2 (no ride height) nor area 6's citations.
const old = computeSetupOverview({
  ...base,
  zones: [preQuadroZone],
  levers: null,
  weight: { known: false, reason: "wheel load not available" },
});
assert.equal(old.areas.length, 8);
assert.deepEqual(
  old.areas.map((a) => a.n),
  [1, 2, 3, 4, 5, 6, 7, 8],
);
assert.ok(
  old.areas.every((a) => a.status === "na" && a.reason.length > 0),
  JSON.stringify(old.areas),
);
assert.ok(old.areas.every((a) => !/NaN|undefined/.test(a.reason)));
assert.equal(old.current, null);
assert.equal(old.afterLadder, false);
assert.equal(
  area(old, 2).reason,
  "ride height not available · springs not verified",
);
assert.ok(!area(old, 6).reason.includes("see ride heights and rake"));
assert.equal(area(old, 8).reason, "no slow or fast corner measured");
assert.equal(
  computeSetupOverview({ ...base, zones: [legacyZone] }).tyreLine,
  null,
  "no temperatures",
);

// Springs: 43.8 / 56.2, springs 225 all round → fix, target round(225 × 56.2 / 43.8) = 289.
const springs = computeSetupOverview({
  ...base,
  weight: w438,
  levers: springsOff,
});
assert.equal(area(springs, 1).status, "fix");
assert.ok(
  area(springs, 1).reason.includes("rear springs 289 N/mm"),
  area(springs, 1).reason,
);
assert.equal(springs.current, 1);
// Measured (R3E/ACE): the isofrequency target is shown, never proposed.
const measured = area(
  computeSetupOverview({
    ...base,
    weight: { ...w438, source: "measured" },
    levers: springsOff,
  }),
  1,
);
assert.equal(measured.status, "ok");
assert.ok(
  measured.reason.includes(
    "isofrequency would give rear springs 289 N/mm, not proposed",
  ),
  measured.reason,
);
// Springs within 3 %: ok.
assert.equal(
  area(
    computeSetupOverview({
      ...base,
      weight: w438,
      levers: { springs: { values: [225, 225, 286, 286], unit: "N/mm" } },
    }),
    1,
  ).status,
  "ok",
);
// Left ≠ right on one axle is a legitimate choice (one-way tracks, corner
// weights): never a fix, the axle mean is what the ratio uses.
const asym = area(
  computeSetupOverview({
    ...base,
    weight: w438,
    levers: { springs: { values: [222, 228, 286, 286], unit: "N/mm" } },
  }),
  1,
);
assert.equal(asym.status, "ok");
assert.ok(!asym.reason.includes("equalise"));
// Weight unknown → na with the weight's reason; springs absent → na; a zero spring → na.
assert.equal(area(old, 1).status, "na");
assert.equal(
  area(computeSetupOverview({ ...base, weight: w438, levers: {} }), 1).reason,
  "parameter not present in the loaded setup",
);
assert.equal(
  area(
    computeSetupOverview({
      ...base,
      weight: w438,
      levers: { springs: { values: [0, 0, 225, 225], unit: "N/mm" } },
    }),
    1,
  ).status,
  "na",
);
assert.ok(
  area(
    computeSetupOverview({ ...base, levers: springsOff }),
    1,
  ).reason.includes("wheel load not available"),
);
// Springs na → areas 2-5 say "springs not verified"; with springs judged they do not.
assert.ok(area(old, 3).reason.includes("springs not verified"));
for (const n of [2, 3, 4, 5])
  assert.ok(area(old, n).reason.includes("springs not verified"));
assert.ok(!area(old, 6).reason.includes("springs not verified"));
assert.ok(!area(springs, 3).reason.includes("springs not verified"));

// Bumpstop: 2 upsetting events in 5 judged laps (0.4 > 0.1), front → fix with the conditional fallback.
const bump = withZones(
  z({
    rideHeight: rh(),
    bottoming: { ...noBottoming, brake: 2, upset: 2, front: 2, upsetFront: 2 },
  }),
);
assert.equal(area(bump, 3).status, "fix");
assert.ok(
  area(bump, 3).reason.startsWith(
    "2 floor touches upsetting the car in 5 laps, front axle → bring the front bumpstop closer",
  ),
  area(bump, 3).reason,
);
assert.ok(
  area(bump, 3).reason.includes("if the car has no adjustable bumpstops"),
);
assert.ok(area(bump, 2).reason.includes("see bumpstop"));
assert.equal(area(bump, 2).status, "ok", "a cited symptom never fixes area 2");
// Touches that do not upset the car: ok.
assert.equal(
  area(
    withZones(
      z({
        rideHeight: rh(),
        bottoming: { ...noBottoming, brake: 3, rear: 3 },
      }),
    ),
    3,
  ).status,
  "ok",
);

// Altezze: no touch and min height 18/22 mm → lower one click.
const high = area(
  withZones(
    z({ rideHeight: rh({ minF: 0.018, minR: 0.022 }), bottoming: noBottoming }),
  ),
  2,
);
assert.equal(high.status, "fix");
assert.ok(
  high.reason.startsWith(
    "minimum height front 18 mm, rear 22 mm, no floor touch → lower by one click, the same mm on both axles",
  ),
  high.reason,
);

// One symptom, one owner: entry understeer fixes area 2 only; area 6 cites it.
const entryUnder = withZones(
  z({
    cornersEntry: 4,
    cornersEntryUnder: 3,
    rideHeight: rh(),
    bottoming: noBottoming,
  }),
);
assert.equal(area(entryUnder, 2).status, "fix");
assert.ok(area(entryUnder, 2).reason.includes("more rake"));
assert.ok(area(entryUnder, 6).reason.includes("see ride heights and rake"));
assert.notEqual(area(entryUnder, 6).status, "fix");
// With ABS dominant (30 % of the hard-brake frames) the same understeer is the
// ladder's step 2: no rake here, and area 6 does not cite area 2.
const absEntry = withZones(
  z({
    cornersEntry: 4,
    cornersEntryUnder: 3,
    hardBrakeFrames: 100,
    absHardBrakeFrames: 30,
    rideHeight: rh(),
    bottoming: noBottoming,
  }),
);
assert.equal(area(absEntry, 2).status, "ok");
assert.ok(area(absEntry, 2).reason.includes("fix it with the brake bias"));
assert.ok(!area(absEntry, 6).reason.includes("see ride heights and rake"));

// Terze molle (4): a touch on a fast straight → stiffer third spring; straight
// 10+ mm higher than mid-corner → softer; neither → ok.
const third = withZones(
  z({
    rideHeight: rh(),
    bottoming: { ...noBottoming, straight: 1, rear: 1, straightRear: 1 },
  }),
);
assert.equal(area(third, 4).status, "fix");
assert.ok(
  area(third, 4).reason.includes("stiffen the rear third spring"),
  area(third, 4).reason,
);
assert.ok(
  area(third, 4).reason.startsWith("1 floor touch on the fast straight"),
);
assert.ok(area(third, 4).reason.includes("bring the rear bumpstops closer"));
for (const n of [2, 3, 8])
  assert.ok(area(third, n).reason.includes("see third springs"));
// Each area names the axle of its own phase: front upsetting brake touches,
// rear straight touches (more touches on the front overall).
const byPhase = withZones(
  z({
    rideHeight: rh(),
    bottoming: {
      ...noBottoming,
      brake: 2,
      upset: 2,
      upsetFront: 2,
      straight: 1,
      straightRear: 1,
      front: 2,
      rear: 1,
    },
  }),
);
assert.ok(area(byPhase, 3).reason.includes("front axle"));
assert.ok(
  area(byPhase, 4).reason.includes("stiffen the rear third spring"),
  area(byPhase, 4).reason,
);
// Straight touches and a straight 15 mm above mid-corner: only "stiffen".
const both = area(
  withZones(
    z({
      rideHeight: rh({
        straightF: 0.035,
        straightR: 0.035,
        straightN: 1, // 35 mm
        midF: 0.02,
        midR: 0.02,
        midN: 1, // 20 mm
      }),
      bottoming: { ...noBottoming, straight: 1, rear: 1, straightRear: 1 },
    }),
  ),
  4,
);
assert.ok(both.reason.includes("stiffen"));
assert.ok(!both.reason.includes("soften"), both.reason);
// A rolled mid-corner (outside wheel low, inside high) with the straight's axle
// mean, through the real counters: no "soften".
const rolled = chassisCounters(
  Array.from({ length: 20 }, (_, i) => ({
    d: i,
    spd: i < 10 ? 250 : 120,
    thr: i < 10 ? 1 : 0.1,
    brk: 0,
    str: i < 10 ? 0 : 0.2,
    gear: 5,
    abs: 0,
    tc: 0,
    bt: [500, 500, 500, 500],
    ts: i * 16,
    gLat: i < 10 ? 0 : 1.5,
    gLon: 0,
    rh: i < 10 ? [0.05, 0.05, 0.05, 0.05] : [0.03, 0.07, 0.03, 0.07],
  })),
  () => 0,
).get(0)!;
const rolledArea = area(withZones(z({ ...rolled })), 4);
assert.equal(rolledArea.status, "ok", rolledArea.reason);
assert.ok(!rolledArea.reason.includes("soften"));
const thirdSoft = area(
  withZones(
    z({
      rideHeight: rh({
        straightF: 0.07,
        straightR: 0.07,
        straightN: 2, // 35 mm
        midF: 0.02,
        midR: 0.025,
        midN: 1, // 22.5 mm
      }),
      bottoming: noBottoming,
    }),
  ),
  4,
);
assert.equal(thirdSoft.status, "fix");
assert.ok(thirdSoft.reason.includes("soften the third springs"));
assert.equal(
  area(
    withZones(
      z({
        rideHeight: rh({
          straightF: 0.05,
          straightR: 0.05,
          straightN: 2, // 25 mm
          midF: 0.02,
          midR: 0.02,
          midN: 1, // 20 mm
        }),
        bottoming: noBottoming,
      }),
    ),
    4,
  ).status,
  "ok",
);

// Ammortizzatori (5): never judged, only shown. Suspension oscillations did not
// move with +3 clicks of slow rebound (R3E, Monza), and asymmetric dampers are
// a legitimate choice (front/rear always, left/right on one-way tracks).
const noSetup = area(withZones(z({})), 5);
assert.equal(noSetup.status, "na");
assert.ok(noSetup.reason.startsWith("no setup loaded"));
const noDampers = area(computeSetupOverview({ ...base, levers: {} }), 5);
assert.equal(noDampers.status, "na");
assert.ok(
  noDampers.reason.startsWith("parameter not present in the loaded setup"),
);
const shown = area(
  computeSetupOverview({
    ...base,
    levers: { slowBump: [12, 12, 8, 8], slowRebound: [10, 11, 9, 9] },
  }),
  5,
);
assert.equal(shown.status, "na");
assert.ok(
  shown.reason.startsWith(
    "slow bump front 12/12 rear 8/8, slow rebound front 10/11 rear 9/9; not judged: no reliable criterion from the telemetry",
  ),
  shown.reason,
);

// Convergenze (7): 7 reversals/km over 3 km → fix; 5/km → ok; under 2 km → na.
const weave = withZones(z({ straightSteer: { metres: 3000, reversals: 21 } }));
assert.equal(area(weave, 7).status, "fix");
assert.ok(area(weave, 7).reason.includes("more front toe-in"));
assert.equal(
  area(withZones(z({ straightSteer: { metres: 3000, reversals: 15 } })), 7)
    .status,
  "ok",
);
assert.equal(
  area(withZones(z({ straightSteer: { metres: 1500, reversals: 30 } })), 7)
    .status,
  "na",
);

// Barre (6): understeer in 3 of 4 slow corners, fronts 6 °C hotter → confirmed.
const slowUnder = withZones(
  z({
    cornersSlow: 4,
    cornersSlowUnder: 3,
    cornersSlowOver: 0,
    kSlowSum: 4,
    avgTyreTempC: [91, 91, 85, 85],
  }),
);
assert.equal(area(slowUnder, 6).status, "fix");
assert.ok(
  area(slowUnder, 6).reason.includes("softer front bar or stiffer rear bar"),
);
assert.ok(
  area(slowUnder, 6).reason.includes("confirmed: front hotter by 6.0 °C"),
  area(slowUnder, 6).reason,
);
assert.ok(area(slowUnder, 7).reason.includes("see anti-roll bars"));
assert.equal(slowUnder.tyreLine, "front−rear +6.0 °C, left−right +0.0 °C");

// Aero: the same mid-corner symptom in the fast corners but not in the slow ones.
const speedClasses = {
  cornersSlow: 6,
  cornersSlowUnder: 1,
  cornersSlowOver: 0,
  kSlowSum: 6,
  cornersFast: 5,
  cornersFastUnder: 0,
  cornersFastOver: 0,
  kFastSum: 5,
};
const aeroUnder = withZones(z({ ...speedClasses, cornersFastUnder: 4 }));
assert.equal(area(aeroUnder, 8).status, "fix");
assert.ok(
  area(aeroUnder, 8).reason.startsWith(
    "mid-corner understeer in 4/5 fast corners and 1/6 slow",
  ),
  area(aeroUnder, 8).reason,
);
assert.ok(area(aeroUnder, 8).reason.includes("more front downforce"));
const aeroOver = area(withZones(z({ ...speedClasses, cornersFastOver: 3 })), 8);
assert.equal(aeroOver.status, "fix");
assert.ok(aeroOver.reason.includes("more rear downforce"), aeroOver.reason);
// Understeer in fast AND slow corners is area 6's symptom, not aero.
const underEverywhere = withZones(
  z({ ...speedClasses, cornersFastUnder: 4, cornersSlowUnder: 4 }),
);
assert.equal(area(underEverywhere, 8).status, "ok");
assert.equal(area(underEverywhere, 6).status, "fix");
// A low fast-corner k with no fast-corner symptom no longer reads as aero.
assert.equal(
  area(withZones(z({ ...speedClasses, kFastSum: 2 })), 8).status,
  "ok",
);
// Aero na: the real counts when too few.
assert.equal(
  area(withZones(z({ ...speedClasses, cornersSlow: 2 })), 8).reason,
  "slow corners 2, fast 5: at least 3 per class needed",
);
// Fast corners recorded without their balance counters: na, never a 0/N.
assert.equal(
  area(
    withZones(
      z({
        ...speedClasses,
        cornersFastUnder: undefined,
        cornersFastOver: undefined,
      }),
    ),
    8,
  ).reason,
  "fast-corner balance not recorded",
);
assert.equal(area(withZones(z(speedClasses)), 8).status, "ok");
assert.ok(area(aeroUnder, 6).reason.includes("see aerodynamics"));
assert.equal(area(aeroUnder, 6).status, "ok");

// Ladder with a current step: areas computed, no current area.
const pending = computeSetupOverview({
  ...base,
  ladder: { ...ladderOk, current: 4 },
  weight: w438,
  levers: springsOff,
});
assert.equal(area(pending, 1).status, "fix");
assert.equal(pending.current, null);
assert.equal(pending.afterLadder, true);
// Laps still missing: no current area either.
assert.equal(
  computeSetupOverview({
    ...base,
    ladder: { ...ladderOk, lapsMissing: 1 },
    weight: w438,
    levers: springsOff,
  }).current,
  null,
);
// Fixed setup: nothing proposable, so no current area.
const fixed = computeSetupOverview({
  ...base,
  fixedSetup: true,
  weight: w438,
  levers: springsOff,
});
assert.ok(fixed.areas.every((a) => !a.proposable));
assert.equal(fixed.current, null);
// Leaderboard: no tyre line.
assert.equal(base.zones.length, 1);
assert.equal(
  computeSetupOverview(base).tyreLine,
  "front−rear +0.0 °C, left−right +0.0 °C",
);
assert.equal(
  computeSetupOverview({ ...base, leaderboardMode: true }).tyreLine,
  null,
);

// --- R3E: an area whose fix has every alternative at the end of its range ---
const lp = (parameter: string, limit?: "min" | "max"): SetupParam => ({
  category: "x",
  parameter,
  value: "1",
  limit,
});
const rhParams = (front?: "min" | "max", rear?: "min" | "max") => [
  lp("Ride Height Front Left", front),
  lp("Ride Height Front Right", front),
  lp("Ride Height Rear Left", rear),
  lp("Ride Height Rear Right", rear),
];
const highZone = z({
  rideHeight: rh({ minF: 0.018, minR: 0.022 }),
  bottoming: noBottoming,
});
const lowerWith = (params: SetupParam[], game: "r3e" | "ace" = "r3e") =>
  area(
    computeSetupOverview({
      ...base,
      zones: [highZone],
      setupParams: params,
      game,
    }),
    2,
  );
// Free to lower: unchanged.
assert.equal(lowerWith(rhParams()).status, "fix");
// The R3E Porsche of 2026-10-27: front already at its lowest. "The same mm on
// both axles" needs both axles, so the fix cannot be applied: ok with the note.
const frontAtMin = lowerWith(rhParams("min"));
assert.equal(frontAtMin.status, "ok");
assert.ok(
  frontAtMin.reason.includes(
    "lower by one click, the same mm on both axles: already at end of range",
  ),
  frontAtMin.reason,
);
// R3E only.
assert.equal(lowerWith(rhParams("min"), "ace").status, "fix");
// Bars: front softer OR rear stiffer — blocked only when both are.
const barsWith = (front?: "min" | "max", rear?: "min" | "max") =>
  area(
    computeSetupOverview({
      ...base,
      zones: [
        z({
          cornersSlow: 4,
          cornersSlowUnder: 3,
          cornersSlowOver: 0,
          kSlowSum: 4,
        }),
      ],
      setupParams: [
        lp("Anti Roll Bar Front", front),
        lp("Anti Roll Bar Rear", rear),
      ],
      game: "r3e",
    }),
    6,
  ).status;
assert.equal(barsWith("min"), "fix");
assert.equal(barsWith("min", "max"), "ok");
