/**
 * Self-check for key-combo.ts - the stored-shortcut parser feeding the low-level
 * keyboard hook. Runs at import time: a failed assert exits non-zero.
 */

import assert from "node:assert/strict";
import { parseKeyCombo, vkForNamedKey } from "./key-combo.js";

// Bare keys
assert.deepEqual(parseKeyCombo("M"), {
  ctrl: false,
  alt: false,
  shift: false,
  key: "M",
});
assert.deepEqual(parseKeyCombo("F9"), {
  ctrl: false,
  alt: false,
  shift: false,
  key: "F9",
});

// Modifiers, in any order and combination
assert.deepEqual(parseKeyCombo("Ctrl+Alt+M"), {
  ctrl: true,
  alt: true,
  shift: false,
  key: "M",
});
assert.deepEqual(parseKeyCombo("Shift+F5"), {
  ctrl: false,
  alt: false,
  shift: true,
  key: "F5",
});
assert.deepEqual(parseKeyCombo("Alt+Ctrl+ArrowUp"), {
  ctrl: true,
  alt: true,
  shift: false,
  key: "ArrowUp",
});

// "+" as the actual key is why modifiers are parsed greedily
assert.equal(parseKeyCombo("+").key, "+");
assert.deepEqual(parseKeyCombo("Ctrl++"), {
  ctrl: true,
  alt: false,
  shift: false,
  key: "+",
});

// Space is stored as event.key, i.e. a single space
assert.equal(parseKeyCombo(" ").key, " ");
assert.equal(parseKeyCombo("Ctrl+ ").key, " ");

// Named keys → VK, single characters left to the keyboard layout
assert.equal(vkForNamedKey("F1"), 0x70);
assert.equal(vkForNamedKey("F12"), 0x7b);
assert.equal(vkForNamedKey("F24"), 0x87);
assert.equal(vkForNamedKey("F25"), null);
assert.equal(vkForNamedKey("F0"), null);
assert.equal(vkForNamedKey(" "), 0x20);
assert.equal(vkForNamedKey("Enter"), 0x0d);
assert.equal(vkForNamedKey("ArrowDown"), 0x28);
assert.equal(vkForNamedKey("M"), null);
assert.equal(vkForNamedKey("+"), null);

console.log("key-combo.selfcheck OK");
