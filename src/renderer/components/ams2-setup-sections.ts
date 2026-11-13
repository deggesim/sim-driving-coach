export const AMS2_TABS = [
  "Tyres/Brakes/Chassis",
  "Suspension",
  "Drivetrain",
] as const;
export type Ams2Tab = (typeof AMS2_TABS)[number];

export type Ams2Section =
  | "Tyres"
  | "Brakes"
  | "Chassis"
  | "Other"
  | "Suspension"
  | "Front"
  | "Rear"
  | "Active Suspension"
  | "Engine/Electronics"
  | "Gear Ratios"
  | "Differential";

export const SECTION_TO_TAB: Record<Ams2Section, Ams2Tab> = {
  Tyres: "Tyres/Brakes/Chassis",
  Brakes: "Tyres/Brakes/Chassis",
  Chassis: "Tyres/Brakes/Chassis",
  Other: "Tyres/Brakes/Chassis",
  Suspension: "Suspension",
  Front: "Suspension",
  Rear: "Suspension",
  "Active Suspension": "Suspension",
  "Engine/Electronics": "Drivetrain",
  "Gear Ratios": "Drivetrain",
  Differential: "Drivetrain",
};

// Render order of sections within each tab.
export const TAB_SECTIONS: Record<Ams2Tab, Ams2Section[]> = {
  "Tyres/Brakes/Chassis": ["Tyres", "Brakes", "Chassis", "Other"],
  Suspension: ["Suspension", "Front", "Rear", "Active Suspension"],
  Drivetrain: ["Engine/Electronics", "Gear Ratios", "Differential"],
};

// Sections rendered as a per-corner (FL/FR/RL/RR) grid.
export const GRID_SECTIONS: ReadonlySet<Ams2Section> = new Set<Ams2Section>([
  "Tyres",
  "Suspension",
]);

const KNOWN_CATEGORIES: ReadonlySet<string> = new Set(
  (Object.keys(SECTION_TO_TAB) as Ams2Section[]).filter((s) => s !== "Other"),
);

// Map a decoded param's free-form category to a known section; unknown → "Other".
export const sectionForCategory = (category: string): Ams2Section => {
  const c = category.trim();
  return (KNOWN_CATEGORIES.has(c) ? c : "Other") as Ams2Section;
};
