import { AMS2_CARS, type Ams2Car } from "./ams2-cars.js";

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

const BY_NAME = new Map(AMS2_CARS.map((c) => [norm(c.name), c]));

export const findAms2Car = (name: string): Ams2Car | null =>
  BY_NAME.get(norm(name)) ?? null;
