import type { TFunction } from "i18next";

// Wheel codes (AMS2/ACE) and R3E wheel words closing a parameter name.
const WHEEL =
  /^(.*\S)\s+(FL|FR|RL|RR|Front Left|Front Right|Rear Left|Rear Right)$/;

type Lookup = (key: string, opts: { defaultValue: string }) => string;

// i18next keys cannot hold its separators; the sanitised form is the JSON key.
const keyOf = (s: string): string => s.replace(/[.:]/g, "_");

/** Localised setup parameter or category name; untranslated names stay English. */
export const localizeSetupName = (t: TFunction, name: string): string => {
  const tr = t as unknown as Lookup;
  const m = WHEEL.exec(name);
  const base = m ? m[1] : name;
  const miss = `\u0000${base}`;
  const hit = (prefix: string): string | undefined => {
    const v = tr(`setup.${prefix}.${keyOf(base)}`, { defaultValue: miss });
    return v === miss ? undefined : v;
  };
  const label = hit("param") ?? hit("category") ?? base;
  if (!m) return label;
  const wheel = tr(`setup.wheel.${m[2]}`, { defaultValue: m[2] });
  return `${label} ${wheel}`;
};

/** App-generated "Turn N" corner names are localised; real corner names are kept. */
export const localizeCorner = (t: TFunction, name: string): string => {
  const m = /^Turn (\d+)$/.exec(name);
  return m ? t("corner", { n: Number(m[1]) }) : name;
};
