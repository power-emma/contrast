// BTST/BCHG/BCLR/BSET (static bit-number and dynamic Dn forms), and TAS.

import { resolveEA } from '../addressing.js';

const DATA_REGS = [0, 1, 2, 3, 4, 5, 6, 7];
const OPS = ['btst', 'bchg', 'bclr', 'bset'];

function applyBitOp(cpu, mode, reg, bitNum, op) {
  if (mode === 0) {
    bitNum &= 31;
    const val = cpu.reg.getD(reg, 4);
    const bit = (val >>> bitNum) & 1;
    cpu.reg.setFlags({ Z: bit === 0 });
    if (op === 'btst') return;
    let nv = val;
    if (op === 'bchg') nv = val ^ (1 << bitNum);
    else if (op === 'bclr') nv = val & ~(1 << bitNum);
    else if (op === 'bset') nv = val | (1 << bitNum);
    cpu.reg.setD(reg, nv >>> 0, 4);
  } else {
    bitNum &= 7;
    const ea = resolveEA(cpu, mode, reg, 1);
    const val = ea.read();
    const bit = (val >>> bitNum) & 1;
    cpu.reg.setFlags({ Z: bit === 0 });
    if (op === 'btst') return;
    let nv = val;
    if (op === 'bchg') nv = val ^ (1 << bitNum);
    else if (op === 'bclr') nv = val & ~(1 << bitNum);
    else if (op === 'bset') nv = val | (1 << bitNum);
    ea.write(nv & 0xff);
  }
}

export function installBitOpsDynamic(table) {
  OPS.forEach((op, oo) => {
    const readModes = op === 'btst' ? [0, 2, 3, 4, 5, 6] : [0, 2, 3, 4, 5, 6];
    const mode7 = op === 'btst' ? [0, 1, 2, 3] : [0, 1];
    for (const dn of DATA_REGS) {
      for (const mode of readModes) {
        for (const reg of DATA_REGS) {
          table[0x0100 | (dn << 9) | (oo << 6) | (mode << 3) | reg] = (cpu) =>
            applyBitOp(cpu, mode, reg, cpu.reg.getD(dn, 4), op);
        }
      }
      for (const reg of mode7) {
        table[0x0100 | (dn << 9) | (oo << 6) | (7 << 3) | reg] = (cpu) =>
          applyBitOp(cpu, 7, reg, cpu.reg.getD(dn, 4), op);
      }
    }
  });
}

export function installBitOpsStatic(table) {
  OPS.forEach((op, oo) => {
    const readModes = [0, 2, 3, 4, 5, 6];
    const mode7 = op === 'btst' ? [0, 1, 2, 3] : [0, 1];
    for (const mode of readModes) {
      for (const reg of DATA_REGS) {
        table[0x0800 | (oo << 6) | (mode << 3) | reg] = (cpu) => {
          const bitNum = cpu.fetchWord() & 0xff;
          applyBitOp(cpu, mode, reg, bitNum, op);
        };
      }
    }
    for (const reg of mode7) {
      table[0x0800 | (oo << 6) | (7 << 3) | reg] = (cpu) => {
        const bitNum = cpu.fetchWord() & 0xff;
        applyBitOp(cpu, 7, reg, bitNum, op);
      };
    }
  });
}

export function installTas(table) {
  const MODES = [0, 2, 3, 4, 5, 6];
  for (const mode of MODES) {
    for (const reg of DATA_REGS) {
      table[0x4ac0 | (mode << 3) | reg] = (cpu) => runTas(cpu, mode, reg);
    }
  }
  for (const reg of [0, 1]) {
    table[0x4ac0 | (7 << 3) | reg] = (cpu) => runTas(cpu, 7, reg);
  }
}

function runTas(cpu, mode, reg) {
  const ea = resolveEA(cpu, mode, reg, 1);
  const v = ea.read();
  cpu.reg.setFlags({ N: (v & 0x80) !== 0, Z: v === 0, V: false, C: false });
  ea.write(v | 0x80);
}
