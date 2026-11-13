/**
 * Setup overview ("quadro assetto", spec 2026-10-26-quadro-assetto-design):
 * judges eight setup areas from Frezza's guides - springs, ride heights and
 * rake, bumpstops, third springs, dampers, anti-roll bars, toe, aero - on the
 * same judged laps as the setup ladder. Pure: every judgment and number is made
 * here, the prompt only cites it. A family absent from every zone gives "na"
 * with a reason, never a zero. Each measured symptom has one owner area; the
 * other areas that could fix it only cite it by name ("see ride heights and rake").
 */

import {
  ABS_SHARE,
  blockedAtLimit,
  type LadderStatus,
  type Move,
  type SetupLadder,
} from "./setup-ladder.js";
import type { SetupLevers } from "./setup-levers.js";
import type { WeightDistribution } from "./weight-distribution.js";
import type { GameSource, SetupParam, ZoneData } from "../../shared/types.js";

// Judgment thresholds (spec), to tune on real sessions.
const SPRING_RATIO_TOL = 0.03; // |spring ratio ÷ weight ratio − 1|
const RH_HIGH_M = 0.015; // min ride height above this with no touch: too high
const BUMP_UPSET_PER_LAP = 0.1; // upsetting brake/other touches per judged lap
const THIRD_HIGH_M = 0.01; // fast-straight − mid-corner mean ride height
const MIN_CLASS_CORNERS = 3; // corners per speed class
const WEAVE_PER_KM = 6; // steering reversals per km of fast straight
const WEAVE_MIN_M = 2000; // fast straight needed to judge toe
const TYRE_CONFIRM_C = 5; // axle temperature gap that confirms a balance symptom

type Quartet = [number, number, number, number];

export type OverviewArea = {
  n: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  label: string;
  status: LadderStatus;
  reason: string; // English data for the model: numbers + direction (fix) or why (na)
  proposable: boolean; // false under fixedSetup
};
export type SetupOverview = {
  areas: OverviewArea[];
  current: number | null; // first "fix" && proposable, only when ladder.current == null && ladder.lapsMissing === 0
  afterLadder: boolean; // true when the ladder still has a current step: every area "review after the base setup"
  weight: WeightDistribution;
  tyreLine: string | null; // null in Leaderboard
};

type N = OverviewArea["n"];
const LABELS = [
  "springs",
  "ride heights and rake",
  "bumpstop",
  "third springs",
  "dampers",
  "anti-roll bars",
  "toe",
  "aerodynamics",
];
type Symptom = "entryUnder" | "upset" | "straightBottom" | "slowMid" | "aero";
// Spec "Symptoms and owners": area → [symptom, owner area] it cites.
const CITES: Partial<Record<N, [Symptom, N][]>> = {
  2: [
    ["upset", 3],
    ["straightBottom", 4],
  ],
  3: [["straightBottom", 4]],
  6: [
    ["entryUnder", 2],
    ["aero", 8],
  ],
  7: [["slowMid", 6]],
  8: [["straightBottom", 4]],
};
const DAMPERS = {
  slowBump: "slow bump",
  slowRebound: "slow rebound",
  fastBump: "fast bump",
  fastRebound: "fast rebound",
} as const;

const mean = (xs: number[]): number =>
  xs.reduce((a, b) => a + b, 0) / xs.length;
const mm = (m: number): string => `${Math.round(m * 1000)} mm`;
const signed = (x: number): string => `${x >= 0 ? "+" : ""}${x.toFixed(1)}`;
const num = (x: number): string => `${+x.toFixed(1)}`;
const touchesOf = (n: number): string =>
  n ? `${n} floor ${n === 1 ? "touch" : "touches"}` : "no floor touch";

/** Field-wise Σ of a counter family over the zones carrying it, null when none does. */
const sumFamily = <T extends Record<string, number>>(fs: T[]): T | null =>
  fs.length
    ? (Object.fromEntries(
        Object.keys(fs[0]).map((k) => [k, fs.reduce((a, f) => a + f[k], 0)]),
      ) as T)
    : null;

/** A judged datum, with the direction when it needs fixing. */
type Part = { data: string; fix?: string; moves?: Move[][] }; // moves: R3E, see blockedAtLimit

// R3E parameter names (idToLabel) of the overview's levers, wheels FL, FR, RL, RR.
const R3E_WHEELS = ["Front Left", "Front Right", "Rear Left", "Rear Right"];
const all4 = (name: string, dir: Move["dir"], wheels = [0, 1, 2, 3]): Move[] =>
  wheels.map((w) => ({ param: `${name} ${R3E_WHEELS[w]}`, dir }));

export const computeSetupOverview = (input: {
  zones: ZoneData[];
  judgedLaps: number;
  ladder: SetupLadder;
  weight: WeightDistribution;
  levers: SetupLevers | null;
  fixedSetup: boolean;
  leaderboardMode: boolean;
  setupParams?: SetupParam[] | null; // the setup on the last segment, when loaded
  game?: GameSource; // range limits are read only on R3E
}): SetupOverview => {
  const { zones, judgedLaps, ladder, weight, levers } = input;
  const sum = (k: keyof ZoneData): number | null => {
    const vs = zones.map((z) => z[k]).filter((v) => typeof v === "number");
    return vs.length ? vs.reduce((a, b) => a + b, 0) : null;
  };
  const rhs = zones.flatMap((z) => (z.rideHeight ? [z.rideHeight] : []));
  const rhSum = sumFamily(rhs);
  const rh = rhSum && {
    ...rhSum,
    minF: Math.min(...rhs.map((r) => r.minF)),
    minR: Math.min(...rhs.map((r) => r.minR)),
  };
  const bot = sumFamily(
    zones.flatMap((z) => (z.bottoming ? [z.bottoming] : [])),
  );
  const steer = sumFamily(
    zones.flatMap((z) => (z.straightSteer ? [z.straightSteer] : [])),
  );
  // The axle with more touches in the area's own phase, a tie goes to the front.
  const axleOf = (f: number, r: number) => (f >= r ? "front" : "rear");

  // Symptoms first, so the areas that only cite them can.
  const entry = sum("cornersEntry");
  const entryUnder = sum("cornersEntryUnder") ?? 0;
  const hard = sum("hardBrakeFrames");
  // With ABS dominant, entry understeer belongs to ladder step 2 (brake bias).
  const absDominant =
    !!hard && (sum("absHardBrakeFrames") ?? 0) / hard > ABS_SHARE;
  const slow = sum("cornersSlow");
  const slowUnder = sum("cornersSlowUnder") ?? 0;
  const slowOver = sum("cornersSlowOver") ?? 0;
  const slowDir =
    slow != null && slow >= MIN_CLASS_CORNERS
      ? slowUnder > slow / 2
        ? "under"
        : slowOver > slow / 2
          ? "over"
          : null
      : null;
  const fast = sum("cornersFast");
  const fastUnder = sum("cornersFastUnder");
  const fastOver = sum("cornersFastOver");
  // Aero: a mid-corner symptom in most fast corners that the slow ones lack
  // (in both classes it is the bars' symptom, area 6).
  const aeroDir =
    slow != null &&
    fast != null &&
    slow >= MIN_CLASS_CORNERS &&
    fast >= MIN_CLASS_CORNERS &&
    fastUnder != null &&
    fastOver != null
      ? fastUnder > fast / 2 && slowUnder <= slow / 2
        ? "under"
        : fastOver > fast / 2 && slowOver <= slow / 2
          ? "over"
          : null
      : null;
  const sym: Record<Symptom, boolean> = {
    entryUnder: !!rh && !!entry && entryUnder > entry / 2 && !absDominant,
    upset: !!bot && bot.upset / Math.max(judgedLaps, 1) > BUMP_UPSET_PER_LAP,
    straightBottom: (bot?.straight ?? 0) > 0,
    slowMid: slowDir != null,
    aero: aeroDir != null,
  };

  const step = (n: N, status: LadderStatus, reason: string): OverviewArea => ({
    n,
    label: LABELS[n - 1],
    status,
    reason,
    proposable: !input.fixedSetup,
  });
  // R3E: a fix whose every alternative is already at the end of its range is
  // reported, not proposed (same rule as the setup ladder).
  const params = input.game === "r3e" ? input.setupParams : null;
  const judge = (n: N, raw: Part[]): OverviewArea => {
    const parts = raw.map((p) =>
      p.fix && p.moves && params && blockedAtLimit(p.moves, params)
        ? { data: `${p.data}; ${p.fix}: already at end of range` }
        : p,
    );
    return step(
      n,
      parts.some((p) => p.fix) ? "fix" : "ok",
      parts.map((p) => (p.fix ? `${p.data} → ${p.fix}` : p.data)).join("; "),
    );
  };

  // 1 - springs: isofrequency, stiffness in proportion to the axle weight.
  const springs = ((): OverviewArea => {
    if (!levers) return step(1, "na", "no setup loaded");
    if (!weight.known) return step(1, "na", weight.reason);
    const s = levers.springs;
    if (!s) return step(1, "na", "parameter not present in the loaded setup");
    if (s.values.some((v) => !(v > 0)))
      return step(1, "na", "zero or negative springs in the loaded setup");
    const [fl, fr, rl, rr] = s.values;
    const f = (fl + fr) / 2;
    const r = (rl + rr) / 2;
    const frontHeavy = weight.frontPct >= 50;
    const rearPct = 100 - weight.frontPct;
    const wRatio = frontHeavy
      ? weight.frontPct / rearPct
      : rearPct / weight.frontPct;
    const sRatio = frontHeavy ? f / r : r / f;
    const u = s.unit;
    const target = `${frontHeavy ? "front" : "rear"} springs ${Math.round((frontHeavy ? r : f) * wRatio)} ${u}`;
    const off = Math.abs(sRatio / wRatio - 1) > SPRING_RATIO_TOL;
    // R3E/ACE spring rates ignore the motion ratio: live Monza defaults run the
    // rear softer with 58-61 % of the weight behind, so the target is shown only.
    const shownOnly = weight.source === "measured";
    const parts: Part[] = [
      {
        data: `springs front ${num(f)} ${u}, rear ${num(r)} ${u} (ratio ${sRatio.toFixed(2)}), weights front ${weight.frontPct.toFixed(1)} % rear ${rearPct.toFixed(1)} % (${weight.source}, ratio ${wRatio.toFixed(2)})${off && shownOnly ? `; isofrequency would give ${target}, not proposed: suspension motion ratio unknown` : ""}`,
        fix: off && !shownOnly ? target : undefined,
      },
    ];
    // Left ≠ right is a legitimate choice (one-way tracks, corner weights):
    // shown, never a fix; the ratio above uses the axle means.
    if (fl !== fr || rl !== rr)
      parts.push({ data: `front ${fl}/${fr}, rear ${rl}/${rr} ${u}` });
    return judge(1, parts);
  })();

  // 2 - ride heights and rake
  const heights = ((): OverviewArea => {
    // Spec §2: not judgeable without ride height, the rake included.
    if (!rh) return step(2, "na", "ride height not available");
    const touches = bot ? bot.straight + bot.brake + bot.other : 0;
    const parts: Part[] = [
      {
        data: `minimum height front ${mm(rh.minF)}, rear ${mm(rh.minR)}, ${touchesOf(touches)}`,
        fix:
          !touches && Math.min(rh.minF, rh.minR) > RH_HIGH_M
            ? "lower by one click, the same mm on both axles"
            : undefined,
        moves: [all4("Ride Height", "down")],
      },
    ];
    if (entry)
      parts.push({
        data: `understeer on entry in ${entryUnder}/${entry} corners${absDominant && entryUnder > entry / 2 ? ", with ABS dominant: fix it with the brake bias" : ""}`,
        fix: sym.entryUnder
          ? "more rake (rear higher or front lower)"
          : undefined,
        moves: [
          all4("Ride Height", "up", [2, 3]),
          all4("Ride Height", "down", [0, 1]),
        ],
      });
    return judge(2, parts);
  })();

  // 3 - bumpstops: touches under braking or elsewhere that upset the car.
  const bumpstops = ((): OverviewArea => {
    if (!bot) return step(3, "na", "ride height missing");
    const touches = bot.brake + bot.other;
    const axle = axleOf(bot.upsetFront, bot.upsetRear);
    return judge(3, [
      sym.upset
        ? {
            data: `${touchesOf(bot.upset)} upsetting the car in ${judgedLaps} laps, ${axle} axle`,
            fix: `bring the ${axle} bumpstop closer; if the car has no adjustable bumpstops, or they are already at the maximum, raise all four ride heights by 2 mm`,
            moves: [all4("Ride Height", "up")],
          }
        : {
            data: `${touchesOf(touches)} under braking or in corners, which upset the car: ${bot.upset} in ${judgedLaps} laps`,
          },
    ]);
  })();

  // 4 - third springs: aero squat on the fast straights.
  const thirds = ((): OverviewArea => {
    if (!rh) return step(4, "na", "ride height missing");
    const straightTouches = bot?.straight ?? 0;
    const axle = axleOf(bot?.straightFront ?? 0, bot?.straightRear ?? 0);
    const parts: Part[] = [
      straightTouches
        ? {
            data: `${touchesOf(straightTouches)} on the fast straight, ${axle} axle`,
            fix: `stiffen the ${axle} third spring; if that is not enough, +1 mm on the ride heights keeping the rake; if the car has no third springs, bring the ${axle} bumpstops closer`,
            moves: [
              [
                {
                  param: `Springs ${axle === "front" ? "Front" : "Rear"} Third`,
                  dir: "up",
                },
              ],
              all4("Ride Height", "up"),
            ],
          }
        : { data: "no floor touch on the fast straight" },
    ];
    if (rh.straightN && rh.midN) {
      const straight = (rh.straightF + rh.straightR) / 2 / rh.straightN;
      const mid = (rh.midF + rh.midR) / 2 / rh.midN;
      parts.push({
        data: `mean height on the fast straight ${mm(straight)}, mid-corner ${mm(mid)}`,
        // Never opposite to "stiffen": with straight touches the gap is moot.
        fix:
          !straightTouches && straight - mid > THIRD_HIGH_M
            ? "soften the third springs"
            : undefined,
        moves: [
          [
            { param: "Springs Front Third", dir: "down" },
            { param: "Springs Rear Third", dir: "down" },
          ],
        ],
      });
    }
    return judge(4, parts);
  })();

  // 5 - dampers: shown, never judged. Asymmetry is a legitimate choice (front
  // vs rear always, left vs right on one-way tracks), and prolonged oscillation
  // did not move with +3 clicks of slow rebound on R3E (Monza, 2026-10-28):
  // kerbs dominate it. No telemetry criterion is left to judge them by.
  const dampers = ((): OverviewArea => {
    if (!levers) return step(5, "na", "no setup loaded");
    const families = (Object.keys(DAMPERS) as (keyof typeof DAMPERS)[]).flatMap(
      (k) => {
        const q: Quartet | undefined = levers[k];
        return q ? [{ name: DAMPERS[k], q }] : [];
      },
    );
    if (!families.length)
      return step(5, "na", "parameter not present in the loaded setup");
    return step(
      5,
      "na",
      `${families.map(({ name, q }) => `${name} front ${q[0]}/${q[1]} rear ${q[2]}/${q[3]}`).join(", ")}; not judged: no reliable criterion from the telemetry`,
    );
  })();

  // 6 - anti-roll bars: mid-corner balance in the slow corners (no aero there).
  const bars = ((): OverviewArea => {
    if (slow == null) return step(6, "na", "no slow corner measured");
    if (slow < MIN_CLASS_CORNERS)
      return step(
        6,
        "na",
        `${slow} slow corners, at least ${MIN_CLASS_CORNERS} needed`,
      );
    return judge(6, [
      {
        data: `mid-corner in the slow corners understeer in ${slowUnder}/${slow}, oversteer in ${slowOver}/${slow}`,
        fix:
          slowDir === "under"
            ? "softer front bar or stiffer rear bar"
            : slowDir === "over"
              ? "stiffer front bar or softer rear bar"
              : undefined,
        moves:
          slowDir === "under"
            ? [
                [{ param: "Anti Roll Bar Front", dir: "down" }],
                [{ param: "Anti Roll Bar Rear", dir: "up" }],
              ]
            : [
                [{ param: "Anti Roll Bar Front", dir: "up" }],
                [{ param: "Anti Roll Bar Rear", dir: "down" }],
              ],
      },
    ]);
  })();

  // 7 - toe: steering corrections on the fast straights.
  const toe = ((): OverviewArea => {
    if (!steer) return step(7, "na", "no fast straight measured");
    const km = steer.metres / 1000;
    if (steer.metres < WEAVE_MIN_M)
      return step(
        7,
        "na",
        `${km.toFixed(1)} km of fast straight, at least ${WEAVE_MIN_M / 1000} needed`,
      );
    const perKm = steer.reversals / km;
    return judge(7, [
      {
        data: `${perKm.toFixed(1)} steering corrections per km over ${km.toFixed(1)} km of fast straight`,
        fix:
          perKm > WEAVE_PER_KM
            ? "more front toe-in (or less toe-out)"
            : undefined,
        moves: [[{ param: "Toe In Front", dir: "up" }]],
      },
    ]);
  })();

  // 8 - aero: a mid-corner symptom in the fast corners only.
  const aero = ((): OverviewArea => {
    if (slow == null || fast == null)
      return step(8, "na", "no slow or fast corner measured");
    if (slow < MIN_CLASS_CORNERS || fast < MIN_CLASS_CORNERS)
      return step(
        8,
        "na",
        `slow corners ${slow}, fast ${fast}: at least ${MIN_CLASS_CORNERS} per class needed`,
      );
    if (fastUnder == null || fastOver == null)
      return step(8, "na", "fast-corner balance not recorded");
    return judge(8, [
      {
        data: `mid-corner understeer in ${fastUnder}/${fast} fast corners and ${slowUnder}/${slow} slow, oversteer in ${fastOver}/${fast} fast and ${slowOver}/${slow} slow`,
        fix:
          aeroDir === "under"
            ? "more front downforce (or less rear)"
            : aeroDir === "over"
              ? "more rear downforce (or less front)"
              : undefined,
        moves:
          aeroDir === "under"
            ? [
                [{ param: "Splitter", dir: "up" }],
                [{ param: "Wing Angle", dir: "down" }],
              ]
            : [
                [{ param: "Wing Angle", dir: "up" }],
                [{ param: "Splitter", dir: "down" }],
              ],
      },
    ]);
  })();

  // Tyre heat: carcass, else centre surface; fixed at 85 °C in Leaderboard.
  const temps = zones.flatMap((z) => {
    const t = z.avgTyreTempC ?? z.avgTyreTempCenterC;
    return t ? [t] : [];
  });
  const t =
    input.leaderboardMode || !temps.length
      ? null
      : [0, 1, 2, 3].map((w) => mean(temps.map((q) => q[w])));
  const frontMinusRear = t ? (t[0] + t[1]) / 2 - (t[2] + t[3]) / 2 : 0;
  const tyreLine = t
    ? `front−rear ${signed(frontMinusRear)} °C, left−right ${signed((t[0] + t[2]) / 2 - (t[1] + t[3]) / 2)} °C`
    : null;

  const springsNa = springs.status === "na";
  const areas = [
    springs,
    heights,
    bumpstops,
    thirds,
    dampers,
    bars,
    toe,
    aero,
  ].map((a) => {
    const notes = [
      springsNa && a.n >= 2 && a.n <= 5 ? "springs not verified" : null,
      ...(CITES[a.n] ?? []).map(([s, owner]) =>
        sym[s] ? `see ${LABELS[owner - 1]}` : null,
      ),
      a.n === 6 && t && slowDir === "under" && frontMinusRear >= TYRE_CONFIRM_C
        ? `confirmed: front hotter by ${frontMinusRear.toFixed(1)} °C`
        : null,
      a.n === 6 && t && slowDir === "over" && -frontMinusRear >= TYRE_CONFIRM_C
        ? `confirmed: rear hotter by ${(-frontMinusRear).toFixed(1)} °C`
        : null,
    ].filter((x) => x != null);
    return { ...a, reason: [a.reason, ...notes].join(" · ") };
  });

  const afterLadder = ladder.current != null;
  return {
    areas,
    current:
      afterLadder || ladder.lapsMissing > 0
        ? null
        : (areas.find((a) => a.status === "fix" && a.proposable)?.n ?? null),
    afterLadder,
    weight,
    tyreLine,
  };
};
