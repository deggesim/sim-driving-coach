import type { CompactFrame } from "../shared/types.js";

/**
 * Maps left/right surface temps to inner/outer. Wheels are [FL, FR, RL, RR]:
 * on the left wheels (0, 2) the inner shoulder is the car-side one = the sensor
 * labelled "right"; on the right wheels (1, 3) it is the one labelled "left".
 */
export const leftRightToInnerOuter = (
  left: number[],
  right: number[],
): [inner: number[], outer: number[]] => {
  const isLeftWheel = (i: number): boolean => i % 2 === 0;
  return [
    left.map((l, i) => (isLeftWheel(i) ? right[i] : l)),
    left.map((l, i) => (isLeftWheel(i) ? l : right[i])),
  ];
};

const round1 = (v: number): number => Math.round(v * 10) / 10;

/**
 * Packs the three surface-temp quartets into frame fields. Any value <= 0 means
 * unavailable (R3E -1, AMS2 UNSET 0), and a partial triple would be misleading,
 * so the whole set is dropped.
 */
export const surfaceTemps = (
  inner: number[],
  center: number[],
  outer: number[],
): Pick<CompactFrame, "tti" | "ttc" | "tto"> =>
  [inner, center, outer].some((q) => q.some((v) => !(v > 0)))
    ? {}
    : {
        tti: inner.map(round1),
        ttc: center.map(round1),
        tto: outer.map(round1),
      };
