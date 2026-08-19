/**
 * Parsing del JSON che RaceRoom mette in clipboard con CTRL+C nella schermata
 * setup. In shared/ e non nel componente perché ha due chiamanti su lati opposti
 * dell'IPC: R3eSetupPicker (JSON incollato a mano) e main.ts (clipboard letta dal
 * comando vocale "acquisisci setup"). Puro: nessun React, nessun IPC, così
 * `r3e-setup-parse.selfcheck.ts` può asserirlo.
 */

import type { SetupParam } from "./types.js";

export type R3ESetupItem = {
  id: string;
  currentStep: number;
  minValue: number;
  stepSize: number;
  suffix: string | string[];
  disabled: boolean;
};

const categorize = (id: string): string => {
  if (/^Brake/.test(id)) return "Freni";
  if (/^Fuel/.test(id)) return "Carburante";
  if (/^Tyre/.test(id)) return "Gomme";
  if (/^(Steering|Ffb)/.test(id)) return "Sterzo";
  if (/^AntiRollBar/.test(id)) return "ARB";
  if (/^Toein/.test(id)) return "Geometria";
  if (/^(Splitter|Wing|Aero)/.test(id)) return "Aerodinamica";
  if (/^(Springs|RideHeight|Camber|Bump|Rebound|FastBump|FastRebound)/.test(id))
    return "Sospensioni";
  if (/^ABS/.test(id)) return "ABS";
  if (/^Tc/.test(id)) return "Controllo Trazione";
  if (/^(Rev|Engine)/.test(id)) return "Motore";
  if (/Gear$/.test(id)) return "Trasmissione";
  if (/^Differential/.test(id)) return "Differenziale";
  if (/^(MGU|Discharge|Regen)/.test(id)) return "Ibrido";
  return "Altro";
};

const idToLabel = (id: string): string => {
  return id
    .replace(/Toein/g, "Toe In")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
};

const TYRE_COMPOUNDS: Record<number, string> = {
  0: "Hard",
  1: "Medium",
  2: "Soft",
};

const formatValue = (item: R3ESetupItem): string => {
  const val = item.minValue + item.currentStep * item.stepSize;
  const rounded = Math.round(val * 1000) / 1000;

  if (/^BrakeBias/.test(item.id) && val >= 0 && val <= 1) {
    const front = ((1 - val) * 100).toFixed(2);
    const rear = (val * 100).toFixed(2);
    return `${front}/${rear}%`;
  }

  if (/^TyreCompound(Front|Rear)$/.test(item.id)) {
    return TYRE_COMPOUNDS[Math.round(val)] ?? String(Math.round(val));
  }

  if (/^Springs(Front|Rear)(Left|Right)$/.test(item.id))
    return `${rounded} N/mm`;
  if (/^TyrePressure(Front|Rear)(Left|Right)$/.test(item.id))
    return `${rounded} kPa`;
  if (/^RideHeight(Front|Rear)(Left|Right)$/.test(item.id))
    return `${rounded} cm`;
  if (/^Fuel/.test(item.id)) return `${rounded} L`;

  const suffix = Array.isArray(item.suffix) ? item.suffix[0] : item.suffix;
  return suffix ? `${rounded} ${suffix}` : String(rounded);
};

/**
 * Il throw su `values` mancante non è una rifinitura: è il modo in cui il
 * percorso clipboard distingue un setup da qualunque altro testo copiato.
 */
export const parseR3eSetupJson = (text: string): SetupParam[] => {
  const parsed = JSON.parse(text) as { values?: R3ESetupItem[] };
  if (!parsed.values || !Array.isArray(parsed.values)) {
    throw new Error("Formato JSON non valido: manca il campo 'values'");
  }
  return parsed.values
    .filter((item) => !item.disabled)
    .map((item) => ({
      category: categorize(item.id),
      parameter: idToLabel(item.id),
      value: formatValue(item),
    }));
};
