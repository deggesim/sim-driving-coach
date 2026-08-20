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

  const systemPrompt = `Sei un esperto di setup per il simulatore di guida Automobilista 2 (AMS2).
Analizza le schermate del setup dell'auto e restituisci un JSON con questa struttura esatta:
{
  "carVerified": boolean,
  "carFound": "nome auto trovato nelle schermate",
  "setupText": "riepilogo markdown del setup",
  "params": [
{ "category": "categoria", "parameter": "nome parametro", "value": "valore" }
  ]
}
Devi verificare se l'auto nelle schermate corrisponde a: "${expectedCar}".
Estrai TUTTI i parametri di setup visibili.
Per ogni parametro assegna "category" ESATTAMENTE uno di questi valori:
- "Gomme": parametri gomma per singola ruota (pressioni, ecc.)
- "Freni": pressione/bilanciamento freni, condotti freni
- "Chassis": parametri telaio non per-ruota (zavorra, ripartizione pesi, sterzo)
- "Sospensioni": parametri sospensione per singola ruota (altezza, molla, camber, convergenza, ammortizzatori bump/rebound, ecc.)
- "Anteriore": parametri sospensione assale anteriore non per-ruota (es. barra antirollio anteriore)
- "Posteriore": parametri sospensione assale posteriore non per-ruota (es. barra antirollio posteriore)
- "Sospensioni attive": parametri di sospensione attiva, se presenti
- "Motore/Elettronica": mappa motore, freno motore, boost, TC, ABS, ecc.
- "Rapporti del cambio": rapporto finale e singole marce
- "Differenziale": precarico, rampe power/coast, dischi, differenziale anteriore e posteriore
Per i parametri per singola ruota (category "Gomme" e "Sospensioni") crea un parametro per ruota e aggiungi il codice ruota in fondo al nome del parametro: " FL", " FR", " RL", " RR" (es. "Pressione FL"). Non usare categorie diverse da quelle elencate.
IMPORTANTE — precisione numerica: leggi ogni cifra di ogni valore con la massima attenzione. Gli slider e altri elementi grafici dell'UI possono apparire adiacenti ai numeri: ignorali e trascrivi solo le cifre del testo numerico visualizzato sullo schermo.
Restituisci solo il JSON, senza testo aggiuntivo.`;

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
