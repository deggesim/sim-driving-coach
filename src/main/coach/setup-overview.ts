/**
 * Setup overview ("quadro assetto", spec 2026-10-26-quadro-assetto-design):
 * judges eight setup areas from Frezza's guides - springs, ride heights and
 * rake, bumpstops, third springs, dampers, anti-roll bars, toe, aero - on the
 * same judged laps as the setup ladder. Pure: every judgment and number is made
 * here, the prompt only cites it. A family absent from every zone gives "na"
 * with a reason, never a zero. Each measured symptom has one owner area; the
 * other areas that could fix it only cite it ("vedi area N").
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
  reason: string; // Italian: numbers + direction (fix) or why (na)
  proposable: boolean; // false under fixedSetup
};
export type SetupOverview = {
  areas: OverviewArea[];
  current: number | null; // first "fix" && proposable, only when ladder.current == null && ladder.lapsMissing === 0
  afterLadder: boolean; // true when the ladder still has a current step: every area "da rivedere dopo la messa a punto di base"
  weight: WeightDistribution;
  tyreLine: string | null; // null in Leaderboard
};

type N = OverviewArea["n"];
const LABELS = [
  "molle",
  "altezze e rake",
  "bumpstop",
  "terze molle",
  "ammortizzatori",
  "barre antirollio",
  "convergenze",
  "aerodinamica",
];
type Symptom = "entryUnder" | "upset" | "straightBottom" | "slowMid" | "aero";
// Spec "Sintomi e proprietari": area → [symptom, owner area] it cites.
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
  n
    ? `${n} ${n === 1 ? "tocco" : "tocchi"} del fondo`
    : "nessun tocco del fondo";

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
  const axleOf = (f: number, r: number) =>
    f >= r ? "anteriore" : "posteriore";

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
        ? { data: `${p.data}; ${p.fix}: già a fondo scala` }
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
    if (!levers) return step(1, "na", "nessun setup caricato");
    if (!weight.known) return step(1, "na", weight.reason);
    const s = levers.springs;
    if (!s) return step(1, "na", "parametro non presente nel setup caricato");
    if (s.values.some((v) => !(v > 0)))
      return step(1, "na", "molle a zero o negative nel setup caricato");
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
    const target = `molle ${frontHeavy ? "anteriori" : "posteriori"} ${Math.round((frontHeavy ? r : f) * wRatio)} ${u}`;
    const off = Math.abs(sRatio / wRatio - 1) > SPRING_RATIO_TOL;
    // R3E/ACE spring rates ignore the motion ratio: live Monza defaults run the
    // rear softer with 58-61 % of the weight behind, so the target is shown only.
    const shownOnly = weight.source === "misurata";
    const parts: Part[] = [
      {
        data: `molle ant ${num(f)} ${u}, post ${num(r)} ${u} (rapporto ${sRatio.toFixed(2)}), pesi ant ${weight.frontPct.toFixed(1)} % post ${rearPct.toFixed(1)} % (${weight.source}, rapporto ${wRatio.toFixed(2)})${off && shownOnly ? `; l'isofrequenza darebbe ${target}, non proposto: rapporto di leva delle sospensioni sconosciuto` : ""}`,
        fix: off && !shownOnly ? target : undefined,
      },
    ];
    // Left ≠ right is a legitimate choice (one-way tracks, corner weights):
    // shown, never a fix; the ratio above uses the axle means.
    if (fl !== fr || rl !== rr)
      parts.push({ data: `ant ${fl}/${fr}, post ${rl}/${rr} ${u}` });
    return judge(1, parts);
  })();

  // 2 - ride heights and rake
  const heights = ((): OverviewArea => {
    // Spec §2: not judgeable without ride height, the rake included.
    if (!rh) return step(2, "na", "altezza da terra non disponibile");
    const touches = bot ? bot.straight + bot.brake + bot.other : 0;
    const parts: Part[] = [
      {
        data: `altezza minima ant ${mm(rh.minF)}, post ${mm(rh.minR)}, ${touchesOf(touches)}`,
        fix:
          !touches && Math.min(rh.minF, rh.minR) > RH_HIGH_M
            ? "abbassare di un click, stessi mm sui due assi"
            : undefined,
        moves: [all4("Ride Height", "down")],
      },
    ];
    if (entry)
      parts.push({
        data: `sottosterzo in inserimento in ${entryUnder}/${entry} curve${absDominant && entryUnder > entry / 2 ? ", con ABS dominante: va corretto con il bilanciamento freni" : ""}`,
        fix: sym.entryUnder
          ? "più rake (posteriore più alto o anteriore più basso)"
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
    if (!bot) return step(3, "na", "manca l'altezza da terra");
    const touches = bot.brake + bot.other;
    const axle = axleOf(bot.upsetFront, bot.upsetRear);
    return judge(3, [
      sym.upset
        ? {
            data: `${touchesOf(bot.upset)} che ${bot.upset === 1 ? "scompone" : "scompongono"} l'auto in ${judgedLaps} giri, asse ${axle}`,
            fix: `avvicinare il bumpstop ${axle}; se l'auto non ha bumpstop regolabili, o sono già al massimo, alzare le quattro altezze di 2 mm`,
            moves: [all4("Ride Height", "up")],
          }
        : {
            data: `${touchesOf(touches)} in frenata o in curva, che scompongono l'auto: ${bot.upset} in ${judgedLaps} giri`,
          },
    ]);
  })();

  // 4 - third springs: aero squat on the fast straights.
  const thirds = ((): OverviewArea => {
    if (!rh) return step(4, "na", "manca l'altezza da terra");
    const straightTouches = bot?.straight ?? 0;
    const axle = axleOf(bot?.straightFront ?? 0, bot?.straightRear ?? 0);
    const parts: Part[] = [
      straightTouches
        ? {
            data: `${touchesOf(straightTouches)} in rettilineo veloce, asse ${axle}`,
            fix: `irrigidire la terza molla ${axle}; se non basta, +1 mm alle altezze mantenendo il rake; se l'auto non ha terze molle, avvicinare i bumpstop ${axle === "anteriore" ? "anteriori" : "posteriori"}`,
            moves: [
              [
                {
                  param: `Springs ${axle === "anteriore" ? "Front" : "Rear"} Third`,
                  dir: "up",
                },
              ],
              all4("Ride Height", "up"),
            ],
          }
        : { data: "nessun tocco del fondo in rettilineo veloce" },
    ];
    if (rh.straightN && rh.midN) {
      const straight = (rh.straightF + rh.straightR) / 2 / rh.straightN;
      const mid = (rh.midF + rh.midR) / 2 / rh.midN;
      parts.push({
        data: `altezza media in rettilineo veloce ${mm(straight)}, a centro curva ${mm(mid)}`,
        // Never opposite to "irrigidire": with straight touches the gap is moot.
        fix:
          !straightTouches && straight - mid > THIRD_HIGH_M
            ? "ammorbidire le terze molle"
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
    if (!levers) return step(5, "na", "nessun setup caricato");
    const families = (Object.keys(DAMPERS) as (keyof typeof DAMPERS)[]).flatMap(
      (k) => {
        const q: Quartet | undefined = levers[k];
        return q ? [{ name: DAMPERS[k], q }] : [];
      },
    );
    if (!families.length)
      return step(5, "na", "parametro non presente nel setup caricato");
    return step(
      5,
      "na",
      `${families.map(({ name, q }) => `${name} ant ${q[0]}/${q[1]} post ${q[2]}/${q[3]}`).join(", ")}; non giudicati: nessun criterio affidabile dalla telemetria`,
    );
  })();

  // 6 - anti-roll bars: mid-corner balance in the slow corners (no aero there).
  const bars = ((): OverviewArea => {
    if (slow == null) return step(6, "na", "nessuna curva lenta misurata");
    if (slow < MIN_CLASS_CORNERS)
      return step(
        6,
        "na",
        `${slow} curve lente, ne servono almeno ${MIN_CLASS_CORNERS}`,
      );
    return judge(6, [
      {
        data: `a centro curva nelle curve lente sottosterzo in ${slowUnder}/${slow}, sovrasterzo in ${slowOver}/${slow}`,
        fix:
          slowDir === "under"
            ? "barra anteriore più morbida o posteriore più rigida"
            : slowDir === "over"
              ? "barra anteriore più rigida o posteriore più morbida"
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
    if (!steer) return step(7, "na", "nessun rettilineo veloce misurato");
    const km = steer.metres / 1000;
    if (steer.metres < WEAVE_MIN_M)
      return step(
        7,
        "na",
        `${km.toFixed(1)} km di rettilineo veloce, ne servono almeno ${WEAVE_MIN_M / 1000}`,
      );
    const perKm = steer.reversals / km;
    return judge(7, [
      {
        data: `${perKm.toFixed(1)} correzioni di sterzo per km su ${km.toFixed(1)} km di rettilineo veloce`,
        fix:
          perKm > WEAVE_PER_KM
            ? "più convergenza anteriore (o meno divergenza)"
            : undefined,
        moves: [[{ param: "Toe In Front", dir: "up" }]],
      },
    ]);
  })();

  // 8 - aero: a mid-corner symptom in the fast corners only.
  const aero = ((): OverviewArea => {
    if (slow == null || fast == null)
      return step(8, "na", "nessuna curva lenta o veloce misurata");
    if (slow < MIN_CLASS_CORNERS || fast < MIN_CLASS_CORNERS)
      return step(
        8,
        "na",
        `curve lente ${slow}, veloci ${fast}: ne servono almeno ${MIN_CLASS_CORNERS} per classe`,
      );
    if (fastUnder == null || fastOver == null)
      return step(8, "na", "bilanciamento delle curve veloci non registrato");
    return judge(8, [
      {
        data: `sottosterzo a centro curva in ${fastUnder}/${fast} curve veloci e ${slowUnder}/${slow} lente, sovrasterzo in ${fastOver}/${fast} veloci e ${slowOver}/${slow} lente`,
        fix:
          aeroDir === "under"
            ? "più carico anteriore (o meno posteriore)"
            : aeroDir === "over"
              ? "più carico posteriore (o meno anteriore)"
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
    ? `ant−post ${signed(frontMinusRear)} °C, sx−dx ${signed((t[0] + t[2]) / 2 - (t[1] + t[3]) / 2)} °C`
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
      springsNa && a.n >= 2 && a.n <= 5 ? "molle non verificate" : null,
      ...(CITES[a.n] ?? []).map(([s, owner]) =>
        sym[s] ? `vedi ${LABELS[owner - 1]}` : null,
      ),
      a.n === 6 && t && slowDir === "under" && frontMinusRear >= TYRE_CONFIRM_C
        ? `conferma: anteriori più calde di ${frontMinusRear.toFixed(1)} °C`
        : null,
      a.n === 6 && t && slowDir === "over" && -frontMinusRear >= TYRE_CONFIRM_C
        ? `conferma: posteriori più calde di ${(-frontMinusRear).toFixed(1)} °C`
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
