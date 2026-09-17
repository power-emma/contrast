// ADD/ADDA/ADDI/ADDQ/ADDX, SUB/SUBA/SUBI/SUBQ/SUBX, CMPI, NEG/NEGX,
// MULU/MULS, DIVU/DIVS.

import { resolveEA, signExtend } from '../addressing.js';
import { addFlags, subFlags, logicFlags } from '../alu.js';
import { CpuTrap, VEC_ZERO_DIVIDE } from '../exceptions.js';

const DATA_REGS = [0, 1, 2, 3, 4, 5, 6, 7];
const SIZES = [{ bits: 0, bytes: 1 }, { bits: 1, bytes: 2 }, { bits: 2, bytes: 4 }];

function forEachFullEA(fn) {
  for (let mode = 0; mode <= 6; mode++) for (const reg of DATA_REGS) fn(mode, reg);
  for (let reg = 0; reg <= 4; reg++) fn(7, reg);
}

function forEachAlterableEA(fn) {
  for (const mode of [0, 2, 3, 4, 5, 6]) for (const reg of DATA_REGS) fn(mode, reg);
  fn(7, 0);
  fn(7, 1);
}

function forEachMemoryAlterableEA(fn) {
  for (const mode of [2, 3, 4, 5, 6]) for (const reg of DATA_REGS) fn(mode, reg);
  fn(7, 0);
  fn(7, 1);
}

// ADDQ/SUBQ additionally allow An-direct (whole 32-bit register, no flags).
function forEachAlterableEAWithAn(fn) {
  for (const mode of [0, 1, 2, 3, 4, 5, 6]) for (const reg of DATA_REGS) fn(mode, reg);
  fn(7, 0);
  fn(7, 1);
}

function fetchImmediate(cpu, size) {
  if (size === 4) return cpu.fetchLong();
  return cpu.fetchWord() & (size === 1 ? 0xff : 0xffff);
}

// ADD/SUB register<->ea (base 0xD000/0x9000) plus ADDA/SUBA (opmode 3/7).
function installAddOrSub(table, base, flagsFn, applyOp) {
  for (const dn of DATA_REGS) {
    for (const { bits, bytes: size } of SIZES) {
      forEachFullEA((mode, reg) => {
        table[base | (dn << 9) | (bits << 6) | (mode << 3) | reg] = (cpu) => {
          const src = resolveEA(cpu, mode, reg, size).read();
          const dst = cpu.reg.getD(dn, size);
          const f = flagsFn(dst, src, size);
          cpu.reg.setD(dn, f.result, size);
          cpu.reg.setFlags({ N: f.N, Z: f.Z, V: f.V, C: f.C, X: f.C });
        };
      });
      forEachMemoryAlterableEA((mode, reg) => {
        table[(base | 0x100) | (dn << 9) | (bits << 6) | (mode << 3) | reg] = (cpu) => {
          const dest = resolveEA(cpu, mode, reg, size);
          const f = flagsFn(dest.read(), cpu.reg.getD(dn, size), size);
          dest.write(f.result);
          cpu.reg.setFlags({ N: f.N, Z: f.Z, V: f.V, C: f.C, X: f.C });
        };
      });
    }
    // ADDA/SUBA: opmode 3 = word (sign-extended), opmode 7 = long. No CCR effect.
    forEachFullEA((mode, reg) => {
      table[base | (dn << 9) | (0b011 << 6) | (mode << 3) | reg] = (cpu) => {
        const value = signExtend(resolveEA(cpu, mode, reg, 2).read(), 2);
        cpu.reg.setA(dn, applyOp(cpu.reg.getA(dn), value));
      };
      table[base | (dn << 9) | (0b111 << 6) | (mode << 3) | reg] = (cpu) => {
        const value = resolveEA(cpu, mode, reg, 4).read();
        cpu.reg.setA(dn, applyOp(cpu.reg.getA(dn), value));
      };
    });
  }
}

export function installAdd(table) {
  installAddOrSub(table, 0xd000, (a, b, size) => addFlags(a, b, size), (a, b) => (a + b) >>> 0);
}

export function installSub(table) {
  installAddOrSub(table, 0x9000, (a, b, size) => subFlags(a, b, size), (a, b) => (a - b) >>> 0);
}

// ADDQ/SUBQ: base 0x5000, bit8 selects SUBQ, data field 0 means 8.
export function installAddSubQuick(table) {
  for (let quick3 = 0; quick3 <= 7; quick3++) {
    const quick = quick3 === 0 ? 8 : quick3;
    for (const isSub of [false, true]) {
      const subBit = isSub ? 0x100 : 0;
      for (const { bits, bytes: size } of SIZES) {
        forEachAlterableEAWithAn((mode, reg) => {
          const opcode = 0x5000 | (quick3 << 9) | subBit | (bits << 6) | (mode << 3) | reg;
          table[opcode] = (cpu) => {
            if (mode === 1) {
              const an = cpu.reg.getA(reg);
              cpu.reg.setA(reg, isSub ? (an - quick) >>> 0 : (an + quick) >>> 0);
              return;
            }
            const dest = resolveEA(cpu, mode, reg, size);
            const f = isSub ? subFlags(dest.read(), quick, size) : addFlags(dest.read(), quick, size);
            dest.write(f.result);
            cpu.reg.setFlags({ N: f.N, Z: f.Z, V: f.V, C: f.C, X: f.C });
          };
        });
      }
    }
  }
}

// ADDI/SUBI/CMPI: group-0 immediate forms.
export function installImmediateArith(table) {
  const install = (ttt, run) => {
    for (const { bits, bytes: size } of SIZES) {
      forEachAlterableEA((mode, reg) => {
        table[(ttt << 9) | (bits << 6) | (mode << 3) | reg] = (cpu) => run(cpu, mode, reg, size);
      });
    }
  };
  install(0b011, (cpu, mode, reg, size) => { // ADDI
    const imm = fetchImmediate(cpu, size);
    const dest = resolveEA(cpu, mode, reg, size);
    const f = addFlags(dest.read(), imm, size);
    dest.write(f.result);
    cpu.reg.setFlags({ N: f.N, Z: f.Z, V: f.V, C: f.C, X: f.C });
  });
  install(0b010, (cpu, mode, reg, size) => { // SUBI
    const imm = fetchImmediate(cpu, size);
    const dest = resolveEA(cpu, mode, reg, size);
    const f = subFlags(dest.read(), imm, size);
    dest.write(f.result);
    cpu.reg.setFlags({ N: f.N, Z: f.Z, V: f.V, C: f.C, X: f.C });
  });
  install(0b110, (cpu, mode, reg, size) => { // CMPI
    const imm = fetchImmediate(cpu, size);
    const ea = resolveEA(cpu, mode, reg, size);
    const f = subFlags(ea.read(), imm, size);
    cpu.reg.setFlags({ N: f.N, Z: f.Z, V: f.V, C: f.C });
  });
}

// ADDX/SUBX: base 0xD100/0x9100, EA-mode field fixed to 0 (Dn/Dn) or 1
// (-(Ay),-(Ax)); Z is sticky (cleared if nonzero, unchanged if zero).
function installExtend(table, base, flagsFn) {
  for (const dx of DATA_REGS) {
    for (const { bits, bytes: size } of SIZES) {
      for (const dy of DATA_REGS) {
        table[base | (dx << 9) | (bits << 6) | dy] = (cpu) => {
          const x = cpu.reg.getFlags().X ? 1 : 0;
          const f = flagsFn(cpu.reg.getD(dx, size), cpu.reg.getD(dy, size), size, x);
          cpu.reg.setD(dx, f.result, size);
          cpu.reg.setFlags({ N: f.N, Z: f.result !== 0 ? false : undefined, V: f.V, C: f.C, X: f.C });
        };
        table[base | (dx << 9) | (bits << 6) | 0x8 | dy] = (cpu) => {
          const x = cpu.reg.getFlags().X ? 1 : 0;
          const addrY = (cpu.reg.getA(dy) - size) >>> 0; cpu.reg.setA(dy, addrY);
          const addrX = (cpu.reg.getA(dx) - size) >>> 0; cpu.reg.setA(dx, addrX);
          const read = size === 1 ? cpu.bus.read8.bind(cpu.bus) : size === 2 ? cpu.bus.read16.bind(cpu.bus) : cpu.bus.read32.bind(cpu.bus);
          const write = size === 1 ? cpu.bus.write8.bind(cpu.bus) : size === 2 ? cpu.bus.write16.bind(cpu.bus) : cpu.bus.write32.bind(cpu.bus);
          const f = flagsFn(read(addrX), read(addrY), size, x);
          write(addrX, f.result);
          cpu.reg.setFlags({ N: f.N, Z: f.result !== 0 ? false : undefined, V: f.V, C: f.C, X: f.C });
        };
      }
    }
  }
}

export function installAddxSubx(table) {
  installExtend(table, 0xd100, (a, b, size, x) => addFlags(a, b, size, x));
  installExtend(table, 0x9100, (a, b, size, x) => subFlags(a, b, size, x));
}

export function installNegNegx(table) {
  for (const { bits, bytes: size } of SIZES) {
    forEachAlterableEA((mode, reg) => {
      table[0x4400 | (bits << 6) | (mode << 3) | reg] = (cpu) => { // NEG
        const dest = resolveEA(cpu, mode, reg, size);
        const f = subFlags(0, dest.read(), size);
        dest.write(f.result);
        cpu.reg.setFlags({ N: f.N, Z: f.Z, V: f.V, C: f.C, X: f.C });
      };
      table[0x4000 | (bits << 6) | (mode << 3) | reg] = (cpu) => { // NEGX
        const dest = resolveEA(cpu, mode, reg, size);
        const x = cpu.reg.getFlags().X ? 1 : 0;
        const f = subFlags(0, dest.read(), size, x);
        dest.write(f.result);
        cpu.reg.setFlags({ N: f.N, Z: f.result !== 0 ? false : undefined, V: f.V, C: f.C, X: f.C });
      };
    });
  }
}

export function installMulDiv(table) {
  for (const dn of DATA_REGS) {
    forEachFullEA((mode, reg) => {
      table[0xc0c0 | (dn << 9) | (mode << 3) | reg] = (cpu) => { // MULU
        const src = resolveEA(cpu, mode, reg, 2).read() & 0xffff;
        const dst = cpu.reg.getD(dn, 2) & 0xffff;
        const result = (src * dst) >>> 0;
        cpu.reg.setD(dn, result, 4);
        cpu.reg.setFlags(logicFlags(result, 4));
      };
      table[0xc1c0 | (dn << 9) | (mode << 3) | reg] = (cpu) => { // MULS
        const src = signExtend(resolveEA(cpu, mode, reg, 2).read(), 2);
        const dst = cpu.reg.getDSigned(dn, 2);
        const result = (src * dst) >>> 0;
        cpu.reg.setD(dn, result, 4);
        cpu.reg.setFlags(logicFlags(result, 4));
      };
      table[0x80c0 | (dn << 9) | (mode << 3) | reg] = (cpu) => runDivu(cpu, dn, mode, reg);
      table[0x81c0 | (dn << 9) | (mode << 3) | reg] = (cpu) => runDivs(cpu, dn, mode, reg);
    });
  }
}

function runDivu(cpu, dn, mode, reg) {
  const divisor = resolveEA(cpu, mode, reg, 2).read() & 0xffff;
  if (divisor === 0) throw new CpuTrap(VEC_ZERO_DIVIDE, 'next');
  const dividend = cpu.reg.getD(dn, 4) >>> 0;
  const quotient = Math.floor(dividend / divisor);
  const remainder = dividend % divisor;
  if (quotient > 0xffff) {
    cpu.reg.setFlags({ V: true });
    return;
  }
  cpu.reg.setD(dn, ((remainder & 0xffff) << 16) | (quotient & 0xffff), 4);
  cpu.reg.setFlags({ N: (quotient & 0x8000) !== 0, Z: (quotient & 0xffff) === 0, V: false, C: false });
}

function runDivs(cpu, dn, mode, reg) {
  const divisor = signExtend(resolveEA(cpu, mode, reg, 2).read(), 2);
  if (divisor === 0) throw new CpuTrap(VEC_ZERO_DIVIDE, 'next');
  const dividend = cpu.reg.getDSigned(dn, 4);
  const quotient = Math.trunc(dividend / divisor);
  const remainder = dividend % divisor;
  if (quotient > 32767 || quotient < -32768) {
    cpu.reg.setFlags({ V: true });
    return;
  }
  cpu.reg.setD(dn, (((remainder & 0xffff) << 16) | (quotient & 0xffff)) >>> 0, 4);
  cpu.reg.setFlags({ N: quotient < 0, Z: quotient === 0, V: false, C: false });
}
