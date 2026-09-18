// Host KeyboardEvent.code to Apple M0110 keyboard-protocol raw code
const RAW_CODES = {
  Backquote: 0x65,
  Digit1: 0x25, Digit2: 0x27, Digit3: 0x29, Digit4: 0x2b, Digit5: 0x2f,
  Digit6: 0x2d, Digit7: 0x35, Digit8: 0x39, Digit9: 0x33, Digit0: 0x3b,
  Minus: 0x37, Equal: 0x31, Backspace: 0x67,
  Tab: 0x61,
  KeyQ: 0x19, KeyW: 0x1b, KeyE: 0x1d, KeyR: 0x1f, KeyT: 0x23, KeyY: 0x21,
  KeyU: 0x41, KeyI: 0x45, KeyO: 0x3f, KeyP: 0x47,
  BracketLeft: 0x43, BracketRight: 0x3d, Backslash: 0x55,
  CapsLock: 0x73,
  KeyA: 0x01, KeyS: 0x03, KeyD: 0x05, KeyF: 0x07, KeyG: 0x0b, KeyH: 0x09,
  KeyJ: 0x4d, KeyK: 0x51, KeyL: 0x4b,
  Semicolon: 0x53, Quote: 0x4f, Enter: 0x49, // "Return"
  ShiftLeft: 0x71, ShiftRight: 0x71,
  KeyZ: 0x0d, KeyX: 0x0f, KeyC: 0x11, KeyV: 0x13, KeyB: 0x17,
  KeyN: 0x5b, KeyM: 0x5d, Comma: 0x57, Period: 0x5f, Slash: 0x59,
  AltLeft: 0x75, AltRight: 0x75, // Option
  MetaLeft: 0x6f, MetaRight: 0x6f, // Command (Apple key)
  Space: 0x63,
  NumpadEnter: 0x69, // the M0110's own separate "Enter" key, right of Space
};

// Arrow keys transmit a keypad prefix byte then their own code byte
const ARROW_CODES = {
  ArrowLeft: 0x0d,
  ArrowRight: 0x05,
  ArrowUp: 0x1b,
  ArrowDown: 0x11,
};
const KEYPAD_PREFIX = 0x79;

// Returns the raw protocol byte(s) for a key transition, or null if unmapped
export function keyEventBytes(code, down) {
  const arrow = ARROW_CODES[code];
  if (arrow !== undefined) {
    return [KEYPAD_PREFIX, down ? arrow : (arrow | 0x80)];
  }
  const raw = RAW_CODES[code];
  if (raw === undefined) return null;
  return [down ? raw : (raw | 0x80)];
}
