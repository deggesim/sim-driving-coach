export const AMS2_TABS = [
  "Tyres/Brakes/Chassis",
  "Suspension",
  "Drivetrain",
] as const;
export type Ams2Tab = (typeof AMS2_TABS)[number];

export type Ams2Section =
  | "Gomme"
  | "Freni"
  | "Chassis"
  | "Altro"
  | "Sospensioni"
  | "Anteriore"
  | "Posteriore"
  | "Sospensioni attive"
  | "Motore/Elettronica"
  | "Rapporti del cambio"
  | "Differenziale";

export const SECTION_TO_TAB: Record<Ams2Section, Ams2Tab> = {
  Gomme: "Tyres/Brakes/Chassis",
  Freni: "Tyres/Brakes/Chassis",
  Chassis: "Tyres/Brakes/Chassis",
  Altro: "Tyres/Brakes/Chassis",
  Sospensioni: "Suspension",
  Anteriore: "Suspension",
  Posteriore: "Suspension",
  "Sospensioni attive": "Suspension",
  "Motore/Elettronica": "Drivetrain",
  "Rapporti del cambio": "Drivetrain",
  Differenziale: "Drivetrain",
};

// Render order of sections within each tab.
export const TAB_SECTIONS: Record<Ams2Tab, Ams2Section[]> = {
  "Tyres/Brakes/Chassis": ["Gomme", "Freni", "Chassis", "Altro"],
  Suspension: ["Sospensioni", "Anteriore", "Posteriore", "Sospensioni attive"],
  Drivetrain: ["Motore/Elettronica", "Rapporti del cambio", "Differenziale"],
};

// Sections rendered as a per-corner (FL/FR/RL/RR) grid.
export const GRID_SECTIONS: ReadonlySet<Ams2Section> = new Set<Ams2Section>([
  "Gomme",
  "Sospensioni",
]);

const KNOWN_CATEGORIES: ReadonlySet<string> = new Set(
  (Object.keys(SECTION_TO_TAB) as Ams2Section[]).filter((s) => s !== "Altro"),
);

// Map a decoded param's free-form category to a known section; unknown → "Altro".
export const sectionForCategory = (category: string): Ams2Section => {
  const c = category.trim();
  return (KNOWN_CATEGORIES.has(c) ? c : "Altro") as Ams2Section;
};
