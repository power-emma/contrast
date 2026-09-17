// Opcode group 1011 (0xB000): CMP, CMPA, EOR, and CMPM. EOR and CMPM
// share the same opmode range (4-6) — CMPM occupies exactly the
// EA-mode-1 slot that's invalid for EOR (a destination can't be An
// direct), using it as a fixed bit pattern for postincrement compare.

import { resolveEA, signExtend } from '../addressing.js';
import { subFlags, logicFlags } from '../alu.js';

const DATA_REGS = [0, 1, 2, 3, 4, 5, 6, 7];
const SIZES = [{ bits: 0, bytes: 1 }, { bits: 1, bytes: 2 }, { bits: 2, bytes: 4 }];

function forEachFullEA(fn) {
  for (let mode = 0; mode <= 6; mode++) for (const reg of DATA_REGS) fn(mode, reg);
  for (let reg = 0; reg <= 4; reg++) fn(7, reg);
}

export function installCmp(table) {
  for (const dn of DATA_REGS) {
    for (const { bits, bytes: size } of SIZES) {
      forEachFullEA((mode, reg) => {
        table[0xb000 | (dn << 9) | (bits << 6) | (mode << 3) | reg] = (cpu) => {
          const src = resolveEA(cpu, mode, reg, size).read();
          const f = subFlags(cpu.reg.getD(dn, size), src, size);
          cpu.reg.setFlags({ N: f.N, Z: f.Z, V: f.V, C: f.C });
        };
      });
    }
    forEachFullEA((mode, reg) => {
      table[0xb000 | (dn << 9) | (0b011 << 6) | (mode << 3) | reg] = (cpu) => { // CMPA.W
        const value = signExtend(resolveEA(cpu, mode, reg, 2).read(), 2);
        const f = subFlags(cpu.reg.getA(dn), value, 4);
        cpu.reg.setFlags({ N: f.N, Z: f.Z, V: f.V, C: f.C });
      };
      table[0xb000 | (dn << 9) | (0b111 << 6) | (mode << 3) | reg] = (cpu) => { // CMPA.L
        const value = resolveEA(cpu, mode, reg, 4).read();
        const f = subFlags(cpu.reg.getA(dn), value, 4);
        cpu.reg.setFlags({ N: f.N, Z: f.Z, V: f.V, C: f.C });
      };
    });
  }
}

export function installEorCmpm(table) {
  const EOR_MODES = [0, 2, 3, 4, 5, 6]; // excludes An-direct (mode 1 -> CMPM)
  for (const dn of DATA_REGS) {
    for (const { bits, bytes: size } of SIZES) {
      for (const mode of EOR_MODES) {
        for (const reg of DATA_REGS) {
          table[0xb100 | (dn << 9) | (bits << 6) | (mode << 3) | reg] = (cpu) => {
            const dest = resolveEA(cpu, mode, reg, size);
            const result = (dest.read() ^ cpu.reg.getD(dn, size)) >>> 0;
            dest.write(result);
            cpu.reg.setFlags(logicFlags(result, size));
          };
        }
      }
      for (const reg of [0, 1]) {
        table[0xb100 | (dn << 9) | (bits << 6) | (7 << 3) | reg] = (cpu) => {
          const dest = resolveEA(cpu, 7, reg, size);
          const result = (dest.read() ^ cpu.reg.getD(dn, size)) >>> 0;
          dest.write(result);
          cpu.reg.setFlags(logicFlags(result, size));
        };
      }
      // CMPM.<size> (Ay)+,(Ax)+
      for (const ay of DATA_REGS) {
        const ax = dn;
        table[0xb108 | (dn << 9) | (bits << 6) | ay] = (cpu) => {
          const addrY = cpu.reg.getA(ay);
          const addrX = cpu.reg.getA(ax);
          const read = size === 1 ? cpu.bus.read8.bind(cpu.bus) : size === 2 ? cpu.bus.read16.bind(cpu.bus) : cpu.bus.read32.bind(cpu.bus);
          const a = read(addrY), b = read(addrX);
          cpu.reg.setA(ay, (addrY + size) >>> 0);
          cpu.reg.setA(ax, (addrX + size) >>> 0);
          const f = subFlags(b, a, size);
          cpu.reg.setFlags({ N: f.N, Z: f.Z, V: f.V, C: f.C });
        };
      }
    }
  }
}
