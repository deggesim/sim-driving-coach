/**
 * Decodifica dei setup AMS2 dalle schermate: AMS2 è l'unico gioco il cui import
 * setup passa da Claude Vision (R3E incolla JSON, ACE decodifica un protobuf).
 * Estratto da main.ts perché ha due chiamanti — l'handler `setup:decodeSetup`
 * per la UI e il comando vocale "acquisisci setup" — e il system prompt non va
 * duplicato: due copie divergono alla prima correzione di OCR.
 */

import fs from "fs";
import path from "path";
import type { SetupData } from "../../shared/types.js";

const AMS2_STEAM_APPID = "1066890";
const VISION_MODEL = "claude-sonnet-5";
const STEAM_USERDATA = "C:\\Program Files (x86)\\Steam\\userdata";

/** Auto-detect del singolo account Steam → cartella screenshot di AMS2. */
export const resolveAms2ScreenshotsDir = (): string | null => {
  try {
    const accounts = fs
      .readdirSync(STEAM_USERDATA)
      .filter((d) => /^\d+$/.test(d));
    if (accounts.length === 0) return null;
    return path.join(
      STEAM_USERDATA,
      accounts[0],
      "760",
      "remote",
      AMS2_STEAM_APPID,
      "screenshots",
    );
  } catch {
    return null;
  }
};

/**
 * Nome + mtime, dal più recente. Niente thumbnail: il chiamante vocale vuole tre
 * nomi, non cinquanta immagini in base64 (`setup:listScreenshots` se li
 * costruisce sopra questo elenco). Ordinato per mtime e non per nome perché
 * "cronologico" e "alfabetico" coincidono solo finché Steam tiene i nomi
 * timestampati.
 */
export const listAms2Screenshots = (
  dir: string,
): Array<{ name: string; mtimeMs: number }> => {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => /\.(jpg|jpeg|png)$/i.test(f))
      .map((name) => ({
        name,
        mtimeMs: fs.statSync(path.join(dir, name)).mtimeMs,
      }))
      .toSorted((a, b) => b.mtimeMs - a.mtimeMs);
  } catch {
    return [];
  }
};

/**
 * Canonical names for the spring and damper rows: `extractSetupLevers` reads
 * them back by exact name, so the OCR must not paraphrase them.
 */
export const AMS2_CANONICAL_PARAMS = [
  ...[
    "Spring",
    "Slow Bump",
    "Slow Rebound",
    "Fast Bump",
    "Fast Rebound",
    "Tyre Pressure",
    "Camber",
  ].flatMap((name) => ["FL", "FR", "RL", "RR"].map((w) => `${name} ${w}`)),
  // The setup-ladder levers (setup-ladder.ts LEVERS matches these names).
  "Brake Ducts",
  "Brake Bias",
  "Brake Pressure",
  "Engine Braking",
  "Coast Ramp",
  "Power Ramp",
  "Preload",
];

export const buildAms2SetupSystemPrompt = (expectedCar: string): string =>
  `You are a setup expert for the racing simulator Automobilista 2 (AMS2).
Analyse the car setup screenshots and return a JSON with exactly this structure:
{
  "carVerified": boolean,
  "carFound": "car name found in the screenshots",
  "setupText": "markdown summary of the setup, in English",
  "params": [
{ "category": "category", "parameter": "parameter name", "value": "value" }
  ]
}
Check whether the car in the screenshots matches: "${expectedCar}".
Extract ALL the visible setup parameters.
For each parameter set "category" to EXACTLY one of these values:
- "Tyres": per-wheel tyre parameters (pressures, etc.)
- "Brakes": brake pressure/bias, brake ducts
- "Chassis": non-per-wheel chassis parameters (ballast, weight distribution, steering)
- "Suspension": per-wheel suspension parameters (ride height, spring, camber, toe, bump/rebound dampers, etc.)
- "Front": front-axle suspension parameters that are not per-wheel (e.g. front anti-roll bar)
- "Rear": rear-axle suspension parameters that are not per-wheel (e.g. rear anti-roll bar)
- "Active Suspension": active suspension parameters, if present
- "Engine/Electronics": engine map, engine braking, boost, TC, ABS, etc.
- "Gear Ratios": final drive and individual gears
- "Differential": preload, power/coast ramps, plates, front and rear differential
For per-wheel parameters (categories "Tyres" and "Suspension") create one parameter per wheel and append the wheel code at the end of the parameter name: " FL", " FR", " RL", " RR" (e.g. "Tyre Pressure FL"). Do not use categories other than those listed.
For these parameters use EXACTLY these names (always in English, whatever the game language): ${AMS2_CANONICAL_PARAMS.join(", ")}. Report springs with the unit shown in the game (e.g. "220 N/mm").
IMPORTANT - numeric precision: read every digit of every value with the greatest care. UI sliders and other graphic elements may appear next to the numbers: ignore them and transcribe only the digits of the numeric text shown on screen.
Return only the JSON, with no additional text.`;

export const decodeAms2Setup = async ({
  screenshotsDir,
  filenames,
  expectedCar,
  apiKey,
}: {
  screenshotsDir: string;
  filenames: string[];
  expectedCar: string;
  apiKey: string;
}): Promise<SetupData> => {
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });

  const imageContents = filenames.map((name) => {
    // Caller-supplied names must be bare filenames; a path component
    // ("..", "/" or "\\") would escape the screenshots directory.
    if (path.basename(name) !== name) {
      throw new Error(`Nome file screenshot non valido: ${name}`);
    }
    const fullPath = path.join(screenshotsDir, name);
    const data = fs.readFileSync(fullPath).toString("base64");
    const mediaType: "image/png" | "image/jpeg" = /\.png$/i.test(name)
      ? "image/png"
      : "image/jpeg";
    return {
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: mediaType,
        data,
      },
    };
  });

  const systemPrompt = buildAms2SetupSystemPrompt(expectedCar);

  const response = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 4000,
    thinking: { type: "disabled" },
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: [
          ...imageContents,
          {
            type: "text" as const,
            text: `Analizza queste ${filenames.length} schermate del setup e restituisci il JSON.`,
          },
        ],
      },
    ],
  });

  // sonnet-5 may emit a leading thinking block; find the text block explicitly
  // rather than assuming content[0], then guard the parse.
  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock?.type === "text" ? textBlock.text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(
      "Claude Vision non ha restituito un JSON di setup valido. Riprova o seleziona schermate più leggibili.",
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error(
      "Risposta di Claude Vision non interpretabile (JSON malformato). Riprova.",
    );
  }

  return {
    carVerified: parsed.carVerified ?? false,
    carFound: parsed.carFound ?? "",
    setupText: parsed.setupText ?? "",
    params: parsed.params ?? [],
    screenshots: filenames,
  } as SetupData;
};
