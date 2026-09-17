// MC68000 programmer's model: eight 32-bit data registers, eight 32-bit
// address registers (A7 is banked between USP and SSP depending on S),
// a 32-bit PC and a 16-bit status register (T . S . . III . . . XNZVC).
// Only the fields the 68000 actually implements are modeled — no MMU,
// no 68010+ vector base register, no coprocessor state.

export const SR_T = 0x8000; // trace
export const SR_S = 0x2000; // supervisor
export const SR_I = 0x0700; // interrupt priority mask (bits 10-8)
export const SR_X = 0x0010;
export const SR_N = 0x0008;
export const SR_Z = 0x0004;
export const SR_V = 0x0002;
export const SR_C = 0x0001;

const SIZE_MASK = { 1: 0xff, 2: 0xffff, 4: 0xffffffff };

export class Registers {
  constructor() {
    this.d = new Uint32Array(8);
    this.a = new Uint32Array(8);
    this.pc = 0;
    this.sr = SR_S | 0x0700; // supervisor, interrupt mask 7 — reset default
    this.ssp = 0;
    this.usp = 0;
  }

  reset() {
    this.d.fill(0);
    this.a.fill(0);
    this.pc = 0;
    this.sr = SR_S | 0x0700;
    this.ssp = 0;
    this.usp = 0;
  }

  // -- data registers: size-aware so byte/word writes preserve the
  // untouched upper bits, matching real MC68000 behavior. --
  getD(n, size = 4) {
    const v = this.d[n];
    if (size === 4) return v >>> 0;
    return v & SIZE_MASK[size];
  }

  getDSigned(n, size = 4) {
    const v = this.getD(n, size);
    if (size === 1) return (v << 24) >> 24;
    if (size === 2) return (v << 16) >> 16;
    return v | 0;
  }

  setD(n, value, size = 4) {
    if (size === 4) {
      this.d[n] = value >>> 0;
      return;
    }
    const mask = SIZE_MASK[size];
    this.d[n] = ((this.d[n] & ~mask) | (value & mask)) >>> 0;
  }

  // -- address registers: always affect the full 32 bits. Callers doing
  // word-sized loads (MOVEA.W, ADDA.W, ...) must sign-extend beforehand. --
  getA(n) {
    if (n === 7) return this.a[7] >>> 0;
    return this.a[n] >>> 0;
  }

  setA(n, value) {
    this.a[n] = value >>> 0;
  }

  // -- status register / CCR --
  getSR() {
    return this.sr & 0xffff;
  }

  setSR(value) {
    const wasSupervisor = (this.sr & SR_S) !== 0;
    this.sr = value & 0xffff;
    const isSupervisor = (this.sr & SR_S) !== 0;
    if (wasSupervisor !== isSupervisor) this._bankSP(isSupervisor);
  }

  getCCR() {
    return this.sr & 0x1f;
  }

  setCCR(value) {
    this.sr = (this.sr & 0xff00) | (value & 0x1f);
  }

  // Swap A7 between USP/SSP banks when the S bit changes.
  _bankSP(enteringSupervisor) {
    if (enteringSupervisor) {
      this.usp = this.a[7] >>> 0;
      this.a[7] = this.ssp >>> 0;
    } else {
      this.ssp = this.a[7] >>> 0;
      this.a[7] = this.usp >>> 0;
    }
  }

  isSupervisor() {
    return (this.sr & SR_S) !== 0;
  }

  getFlags() {
    return {
      X: (this.sr & SR_X) !== 0,
      N: (this.sr & SR_N) !== 0,
      Z: (this.sr & SR_Z) !== 0,
      V: (this.sr & SR_V) !== 0,
      C: (this.sr & SR_C) !== 0,
    };
  }

  // Pass `null`/`undefined` for a flag to leave it unchanged.
  setFlags({ X, N, Z, V, C }) {
    let sr = this.sr;
    const apply = (bit, val) => {
      if (val === undefined || val === null) return;
      sr = val ? (sr | bit) : (sr & ~bit);
    };
    apply(SR_X, X);
    apply(SR_N, N);
    apply(SR_Z, Z);
    apply(SR_V, V);
    apply(SR_C, C);
    this.sr = sr & 0xffff;
  }

  ccrString() {
    const f = this.getFlags();
    const bit = (name, set) => (set ? name : '-');
    return (
      bit('X', f.X) + bit('N', f.N) + bit('Z', f.Z) + bit('V', f.V) + bit('C', f.C)
    );
  }

  // Register dump matching the layout of the existing CPU_LINES stub in
  // contrast.jsx, so the live readout can drop straight into that panel.
  toLines(extra = []) {
    const hex = (v, w) => (v >>> 0).toString(16).padStart(w, '0');
    const d = (i) => `D${i}=${hex(this.getD(i), 8)}`;
    const a = (i) => `A${i}=${hex(this.getA(i), 8)}`;
    const t = (this.sr & SR_T) ? 'T' : '.';
    const s = (this.sr & SR_S) ? 'S' : '.';
    const iMask = (this.sr & SR_I) >>> 8;
    const f = this.getFlags();
    const flag = (name, set) => (set ? name : '.');
    return [
      'MC68000',
      '-----------------------',
      ` ${d(0)}  ${d(1)}  ${d(2)}  ${d(3)}`,
      ` ${d(4)}  ${d(5)}  ${d(6)}  ${d(7)}`,
      ` ${a(0)}  ${a(1)}  ${a(2)}  ${a(3)}`,
      ` ${a(4)}  ${a(5)}  ${a(6)}  ${a(7)}`,
      ` PC=${hex(this.pc, 8)}  SR=${hex(this.getSR(), 4)}  [${t}${s}..${iMask}...` +
        `${flag('X', f.X)}${flag('N', f.N)}${flag('Z', f.Z)}${flag('V', f.V)}${flag('C', f.C)}]`,
      ` SSP=${hex(this.isSupervisor() ? this.a[7] : this.ssp, 8)}` +
        `  USP=${hex(this.isSupervisor() ? this.usp : this.a[7], 8)}`,
      '-----------------------',
      ...extra,
    ];
  }
}
