// ASL/ASR, LSL/LSR, ROL/ROR, ROXL/ROXR — register form (variable count,
// byte/word/long) and memory form (fixed 1-bit shift, word only).

import { resolveEA } from '../addressing.js';
import { nz } from '../alu.js';

const DATA_REGS = [0, 1, 2, 3, 4, 5, 6, 7];
const TYPES = ['ASx', 'LSx', 'ROXx', 'ROx'];

// Bit-accurate simulation shared by both forms. `type` is one of TYPES;
// `count` may be 0 (only reachable via the register-count register form).
function computeShift(value, size, count, type, dirLeft, xIn) {
  const bits = size * 8;
  const mask = size === 4 ? 0xffffffff : size === 2 ? 0xffff : 0xff;
  const signBit = 1 << (bits - 1);
  let v = value & mask;
  let x = xIn ? 1 : 0;
  let lastOut = 0;
  let signChanged = false;

  for (let i = 0; i < count; i++) {
    if (type === 'ASx' && dirLeft) {
      const before = (v & signBit) ? 1 : 0;
      lastOut = (v >>> (bits - 1)) & 1;
      v = (v << 1) & mask;
      if (((v & signBit) ? 1 : 0) !== before) signChanged = true;
    } else if (type === 'ASx') { // right
      const sign = (v & signBit) ? 1 : 0;
      lastOut = v & 1;
      v = ((v >>> 1) | (sign ? signBit : 0)) & mask;
    } else if (type === 'LSx' && dirLeft) {
      lastOut = (v >>> (bits - 1)) & 1;
      v = (v << 1) & mask;
    } else if (type === 'LSx') { // right
      lastOut = v & 1;
      v = (v >>> 1) & mask;
    } else if (type === 'ROx' && dirLeft) {
      lastOut = (v >>> (bits - 1)) & 1;
      v = ((v << 1) | lastOut) & mask;
    } else if (type === 'ROx') { // right
      lastOut = v & 1;
      v = ((v >>> 1) | (lastOut ? signBit : 0)) & mask;
    } else if (type === 'ROXx' && dirLeft) {
      const outBit = (v >>> (bits - 1)) & 1;
      v = ((v << 1) | x) & mask;
      x = outBit; lastOut = outBit;
    } else if (type === 'ROXx') { // right
      const outBit = v & 1;
      v = ((v >>> 1) | (x ? signBit : 0)) & mask;
      x = outBit; lastOut = outBit;
    }
  }

  const V = type === 'ASx' ? signChanged : false;
  if (count === 0) {
    if (type === 'ROXx') return { result: v >>> 0, C: !!xIn, X: !!xIn, V: false };
    return { result: v >>> 0, C: false, X: undefined, V: false };
  }
  if (type === 'ROx') return { result: v >>> 0, C: !!lastOut, X: undefined, V };
  if (type === 'ROXx') return { result: v >>> 0, C: !!x, X: !!x, V: false };
  return { result: v >>> 0, C: !!lastOut, X: !!lastOut, V };
}

function applyResult(cpu, f, size) {
  const { N, Z } = nz(f.result, size);
  cpu.reg.setFlags({ N, Z, V: f.V, C: f.C, X: f.X });
}

export function installShiftRegister(table) {
  const SIZE_BYTES = [1, 2, 4];
  for (let dr = 0; dr <= 1; dr++) {
    for (let tt = 0; tt <= 3; tt++) {
      for (let ss = 0; ss <= 2; ss++) {
        const size = SIZE_BYTES[ss];
        for (let i = 0; i <= 1; i++) {
          for (const ccc of DATA_REGS) {
            for (const rrr of DATA_REGS) {
              const opcode = 0xe000 | (ccc << 9) | (dr << 8) | (ss << 6) | (i << 5) | (tt << 3) | rrr;
              table[opcode] = (cpu) => {
                const count = i === 0 ? (ccc === 0 ? 8 : ccc) : (cpu.reg.getD(ccc, 4) & 0x3f);
                const value = cpu.reg.getD(rrr, size);
                const f = computeShift(value, size, count, TYPES[tt], dr === 1, cpu.reg.getFlags().X);
                cpu.reg.setD(rrr, f.result, size);
                applyResult(cpu, f, size);
              };
            }
          }
        }
      }
    }
  }
}

export function installShiftMemory(table) {
  const MODES = [2, 3, 4, 5, 6];
  for (let dr = 0; dr <= 1; dr++) {
    for (let tt = 0; tt <= 3; tt++) {
      for (const mode of MODES) {
        for (const reg of DATA_REGS) {
          table[0xe1c0 | (tt << 10) | (dr << 9) | (mode << 3) | reg] = (cpu) => runShiftMemory(cpu, mode, reg, tt, dr);
        }
      }
      for (const reg of [0, 1]) {
        table[0xe1c0 | (tt << 10) | (dr << 9) | (7 << 3) | reg] = (cpu) => runShiftMemory(cpu, 7, reg, tt, dr);
      }
    }
  }
}

function runShiftMemory(cpu, mode, reg, tt, dr) {
  const dest = resolveEA(cpu, mode, reg, 2);
  const f = computeShift(dest.read(), 2, 1, TYPES[tt], dr === 1, cpu.reg.getFlags().X);
  dest.write(f.result);
  applyResult(cpu, f, 2);
}
