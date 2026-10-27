import { AMS2_CARS, type Ams2Car } from "./ams2-cars.js";

// Lowercase, accents folded, every run of non-alphanumerics -> one space.
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const sameCar = (a: Ams2Car, b: Ams2Car) =>
  a.weightKg === b.weightKg &&
  a.frontPct === b.frontPct &&
  a.driveline === b.driveline &&
  a.differential === b.differential;

// Names that collapse to the same key with different specs are ambiguous -> null.
const BY_NAME = new Map<string, Ams2Car | null>();
for (const car of AMS2_CARS) {
  const key = norm(car.name);
  const seen = BY_NAME.get(key);
  BY_NAME.set(
    key,
    seen === undefined || (seen !== null && sameCar(seen, car)) ? car : null,
  );
}

export const findAms2Car = (name: string): Ams2Car | null =>
  BY_NAME.get(norm(name)) ?? null;
