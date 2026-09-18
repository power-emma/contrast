// AND, OR (register/ea forms), ANDI/ORI/EORI, NOT, TST
import { resolveEA } from '../addressing.js';
import { logicFlags } from '../alu.js';

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

// AND/OR register with ea, base 0xC000 (AND) / 0x8000 (OR)
export function installAnd(table) {
  for (const dn of DATA_REGS) {
    for (const { bits, bytes: size } of SIZES) {
      forEachFullEA((mode, reg) => {
        table[0xc000 | (dn << 9) | (bits << 6) | (mode << 3) | reg] = (cpu) => {
          const src = resolveEA(cpu, mode, reg, size).read();
          const result = (cpu.reg.getD(dn, size) & src) >>> 0;
          cpu.reg.setD(dn, result, size);
          cpu.reg.setFlags(logicFlags(result, size));
        };
      });
      forEachAlterableEA((mode, reg) => {
        if (mode === 0 || mode === 1) return; // reserved for ABCD/EXG
        table[0xc100 | (dn << 9) | (bits << 6) | (mode << 3) | reg] = (cpu) => {
          const dest = resolveEA(cpu, mode, reg, size);
          const result = (dest.read() & cpu.reg.getD(dn, size)) >>> 0;
          dest.write(result);
          cpu.reg.setFlags(logicFlags(result, size));
        };
      });
    }
  }
}

export function installOr(table) {
  for (const dn of DATA_REGS) {
    for (const { bits, bytes: size } of SIZES) {
      forEachFullEA((mode, reg) => {
        table[0x8000 | (dn << 9) | (bits << 6) | (mode << 3) | reg] = (cpu) => {
          const src = resolveEA(cpu, mode, reg, size).read();
          const result = (cpu.reg.getD(dn, size) | src) >>> 0;
          cpu.reg.setD(dn, result, size);
          cpu.reg.setFlags(logicFlags(result, size));
        };
      });
      forEachAlterableEA((mode, reg) => {
        if (mode === 0 || mode === 1) return; // reserved for SBCD
        table[0x8100 | (dn << 9) | (bits << 6) | (mode << 3) | reg] = (cpu) => {
          const dest = resolveEA(cpu, mode, reg, size);
          const result = (dest.read() | cpu.reg.getD(dn, size)) >>> 0;
          dest.write(result);
          cpu.reg.setFlags(logicFlags(result, size));
        };
      });
    }
  }
}

function fetchImmediate(cpu, size) {
  if (size === 4) return cpu.fetchLong();
  return cpu.fetchWord() & (size === 1 ? 0xff : 0xffff);
}

function installImmediateLogic(table, ttt, op) {
  for (const { bits, bytes: size } of SIZES) {
    forEachAlterableEA((mode, reg) => {
      table[(ttt << 9) | (bits << 6) | (mode << 3) | reg] = (cpu) => {
        const imm = fetchImmediate(cpu, size);
        const dest = resolveEA(cpu, mode, reg, size);
        const result = (op(dest.read(), imm)) >>> 0;
        dest.write(result);
        cpu.reg.setFlags(logicFlags(result, size));
      };
    });
  }
}

export function installAndiOriEori(table) {
  installImmediateLogic(table, 0b000, (a, b) => a | b); // ORI
  installImmediateLogic(table, 0b001, (a, b) => a & b); // ANDI
  installImmediateLogic(table, 0b101, (a, b) => a ^ b); // EORI
}

export function installNot(table) {
  for (const { bits, bytes: size } of SIZES) {
    forEachAlterableEA((mode, reg) => {
      table[0x4600 | (bits << 6) | (mode << 3) | reg] = (cpu) => {
        const dest = resolveEA(cpu, mode, reg, size);
        const mask = size === 4 ? 0xffffffff : size === 2 ? 0xffff : 0xff;
        const result = (~dest.read()) & mask;
        dest.write(result >>> 0);
        cpu.reg.setFlags(logicFlags(result, size));
      };
    });
  }
}

export function installTst(table) {
  for (const { bits, bytes: size } of SIZES) {
    forEachAlterableEA((mode, reg) => {
      table[0x4a00 | (bits << 6) | (mode << 3) | reg] = (cpu) => {
        const val = resolveEA(cpu, mode, reg, size).read();
        cpu.reg.setFlags(logicFlags(val, size));
      };
    });
  }
}
