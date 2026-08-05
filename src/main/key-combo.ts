/**
 * Parses the stored keyboard-shortcut format (a JS `event.key`, prefixed with
 * modifiers joined by "+") and maps the keys that `event.key` *names* to their
 * Windows virtual-key code. Single characters are not resolved here: the layout
 * decides their VK, so `input-manager.ts` asks Windows via VkKeyScanW.
 *
 * Dependency-free on purpose (no electron, no koffi) so `key-combo.selfcheck.ts`
 * can assert it without a window or a sim.
 */

export type KeyCombo = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** The bare key, still in `event.key` form (e.g. "M", "F9", "ArrowUp", " "). */
  key: string;
};

const MODIFIER_PREFIXES = ["Ctrl", "Alt", "Shift"] as const;

/**
 * Parses modifiers greedily, which is what keeps a combo whose actual key is "+"
 * ("Ctrl++") unambiguous. `SettingsPanel` never stores a "Meta" prefix, so Win
 * is not a modifier here.
 */
export const parseKeyCombo = (stored: string): KeyCombo => {
  let ctrl = false;
  let alt = false;
  let shift = false;
  let key = stored;

  for (let changed = true; changed;) {
    changed = false;
    for (const mod of MODIFIER_PREFIXES) {
      if (!key.startsWith(mod + "+")) continue;
      if (mod === "Ctrl") ctrl = true;
      if (mod === "Alt") alt = true;
      if (mod === "Shift") shift = true;
      key = key.slice(mod.length + 1);
      changed = true;
      break;
    }
  }

  return { ctrl, alt, shift, key };
};

/** Named keys → virtual-key code. Values from WinUser.h. */
const NAMED_VK: Record<string, number> = {
  " ": 0x20,
  Backspace: 0x08,
  Tab: 0x09,
  Enter: 0x0d,
  Escape: 0x1b,
  PageUp: 0x21,
  PageDown: 0x22,
  End: 0x23,
  Home: 0x24,
  ArrowLeft: 0x25,
  ArrowUp: 0x26,
  ArrowRight: 0x27,
  ArrowDown: 0x28,
  Insert: 0x2d,
  Delete: 0x2e,
};

/** VK of a named key, or null when the key is a single character. */
export const vkForNamedKey = (key: string): number | null => {
  const named = NAMED_VK[key];
  if (named !== undefined) return named;
  // F1..F24 are contiguous from VK_F1 = 0x70
  const fn = /^F([1-9]|1\d|2[0-4])$/.exec(key);
  return fn ? 0x6f + Number(fn[1]) : null;
};
