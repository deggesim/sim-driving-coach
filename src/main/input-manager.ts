/**
 * Global push-to-talk key, via a WH_KEYBOARD_LL hook (koffi → user32).
 *
 * NOT Electron's globalShortcut: that registers a Windows hotkey (RegisterHotKey)
 * and Windows does not deliver it while a sim holds the foreground - confirmed
 * with RaceRoom in both fullscreen and borderless, where neither the main nor the
 * renderer side ever saw the trigger. A low-level keyboard hook sits earlier in
 * the input pipeline and still fires, which is how sim-racing push-to-talk tools
 * do it. No key is ever consumed - unlike globalShortcut, the push-to-talk key
 * still reaches the sim, so binding it to something in-game keeps working.
 */

import { createRequire } from "node:module";
import { parseKeyCombo, vkForNamedKey } from "./key-combo.js";

const _require = createRequire(import.meta.url);

const WH_KEYBOARD_LL = 13;
const HC_ACTION = 0;
const WM_KEYDOWN = 0x0100;
const WM_KEYUP = 0x0101;
const WM_SYSKEYDOWN = 0x0104;
const WM_SYSKEYUP = 0x0105;
const VK_SHIFT = 0x10;
const VK_CONTROL = 0x11;
const VK_MENU = 0x12; // Alt

export type InputManager = {
  setKeyboard: (key: string | null) => void;
  destroy: () => void;
};

type Target = { vk: number; ctrl: boolean; alt: boolean; shift: boolean };

export const createInputManager = (onTrigger: () => void): InputManager => {
  if (process.platform !== "win32") {
    return { setKeyboard: () => {}, destroy: () => {} };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let koffi: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let user32: any = null;
  let hookPtr: unknown = null;
  let callbackPtr: unknown = null;
  let target: Target | null = null;
  // Holding the key repeats WM_KEYDOWN; only the first one is a trigger.
  let held = false;

  const modifiersMatch = (t: Target): boolean => {
    const down = (vk: number): boolean =>
      (user32.GetAsyncKeyState(vk) & 0x8000) !== 0;
    return (
      down(VK_CONTROL) === t.ctrl &&
      down(VK_MENU) === t.alt &&
      down(VK_SHIFT) === t.shift
    );
  };

  const loadUser32 = (): boolean => {
    if (user32) return true;
    try {
      koffi = _require("koffi");
      const lib = koffi.load("user32.dll");
      koffi.proto(
        "intptr_t __stdcall HOOKPROC(int nCode, uintptr_t wParam, void *lParam)",
      );
      user32 = {
        SetWindowsHookExW: lib.func(
          "void * __stdcall SetWindowsHookExW(int idHook, HOOKPROC *lpfn, void *hmod, uint32_t dwThreadId)",
        ),
        UnhookWindowsHookEx: lib.func(
          "int __stdcall UnhookWindowsHookEx(void *hhk)",
        ),
        CallNextHookEx: lib.func(
          "intptr_t __stdcall CallNextHookEx(void *hhk, int nCode, uintptr_t wParam, void *lParam)",
        ),
        GetAsyncKeyState: lib.func(
          "int16_t __stdcall GetAsyncKeyState(int vKey)",
        ),
        VkKeyScanW: lib.func("int16_t __stdcall VkKeyScanW(uint16_t ch)"),
      };
      return true;
    } catch (err) {
      console.error("[InputManager] user32 load failed:", err);
      user32 = null;
      return false;
    }
  };

  /** VK of a stored combo's key: named keys from the table, the rest from the layout. */
  const resolveVk = (key: string): number | null => {
    const named = vkForNamedKey(key);
    if (named !== null) return named;
    if (key.length !== 1) return null;
    const scan = user32.VkKeyScanW(key.charCodeAt(0));
    // -1 = the current layout cannot type this character
    return scan === -1 ? null : scan & 0xff;
  };

  // Runs inside the Windows message pump: stay short, never block. The trigger
  // itself is deferred so no Electron work happens inside the hook callback, and
  // the event is always passed on so the sim still sees the key.
  const hookProc = (
    nCode: number,
    wParam: bigint,
    lParam: unknown,
  ): unknown => {
    if (nCode === HC_ACTION && target) {
      const msg = Number(wParam);
      const vk = koffi.decode(lParam, "uint32_t") as number;
      if (vk === target.vk) {
        if (msg === WM_KEYUP || msg === WM_SYSKEYUP) {
          held = false;
        } else if (
          (msg === WM_KEYDOWN || msg === WM_SYSKEYDOWN) &&
          !held &&
          modifiersMatch(target)
        ) {
          held = true;
          setImmediate(onTrigger);
        }
      }
    }
    return user32.CallNextHookEx(null, nCode, wParam, lParam);
  };

  const uninstall = (): void => {
    if (hookPtr) {
      try {
        user32.UnhookWindowsHookEx(hookPtr);
      } catch {
        /* ignore */
      }
      hookPtr = null;
    }
    if (callbackPtr) {
      try {
        koffi.unregister(callbackPtr);
      } catch {
        /* ignore */
      }
      callbackPtr = null;
    }
    held = false;
  };

  const setKeyboard = (key: string | null): void => {
    target = null;
    if (!key) {
      uninstall();
      return;
    }
    if (!loadUser32()) return;

    const combo = parseKeyCombo(key);
    const vk = resolveVk(combo.key);
    if (vk === null) {
      console.warn(`[InputManager] Unsupported shortcut key: ${key}`);
      uninstall();
      return;
    }
    target = { vk, ctrl: combo.ctrl, alt: combo.alt, shift: combo.shift };
    held = false;

    if (hookPtr) {
      console.log(
        `[InputManager] Shortcut set to ${key} (vk 0x${vk.toString(16)})`,
      );
      return;
    }
    try {
      callbackPtr = koffi.register(hookProc, "HOOKPROC *");
      hookPtr = user32.SetWindowsHookExW(WH_KEYBOARD_LL, callbackPtr, null, 0);
      if (!hookPtr || koffi.address(hookPtr) === 0n) {
        hookPtr = null;
        console.error("[InputManager] SetWindowsHookExW failed");
        uninstall();
        return;
      }
      console.log(
        `[InputManager] Keyboard hook installed for ${key} (vk 0x${vk.toString(16)})`,
      );
    } catch (err) {
      console.error("[InputManager] Hook install failed:", err);
      uninstall();
    }
  };

  return { setKeyboard, destroy: uninstall };
};
