// MOVE/MOVEA, MOVEQ, MOVEM, MOVEP, LEA, PEA, EXG, SWAP, EXT, CLR, LINK, UNLK
import { resolveEA, signExtend } from '../addressing.js';
import { logicFlags } from '../alu.js';

const DATA_REGS = [0, 1, 2, 3, 4, 5, 6, 7];

// All 12 addressing modes as a general source operand.
function forEachSourceEA(fn) {
  for (let mode = 0; mode <= 6; mode++) for (const reg of DATA_REGS) fn(mode, reg);
  for (let reg = 0; reg <= 4; reg++) fn(7, reg);
}

// Writable non-immediate destination, including An direct (makes MOVE into MOVEA)
function forEachAlterableEA(fn) {
  for (let mode = 0; mode <= 6; mode++) for (const reg of DATA_REGS) fn(mode, reg);
  fn(7, 0);
  fn(7, 1);
}

export function installMove(table) {
  // size field maps to opcode sizeBits and byte count
  const SIZES = [
    { bits: 0b01, bytes: 1 },
    { bits: 0b11, bytes: 2 },
    { bits: 0b10, bytes: 4 },
  ];

  for (const { bits: sizeBits, bytes: size } of SIZES) {
    forEachSourceEA((srcMode, srcReg) => {
      forEachAlterableEA((destMode, destReg) => {
        if (destMode === 1 && size === 1) return; // MOVEA has no byte form
        const opcode = (sizeBits << 12) | (destReg << 9) | (destMode << 6) | (srcMode << 3) | srcReg;
        table[opcode] = (cpu) => {
          const src = resolveEA(cpu, srcMode, srcReg, size);
          const value = src.read();
          if (destMode === 1) {
            cpu.reg.setA(destReg, size === 4 ? value : signExtend(value, size));
            return;
          }
          const dest = resolveEA(cpu, destMode, destReg, size);
          dest.write(value);
          cpu.reg.setFlags(logicFlags(value, size));
        };
      });
    });
  }
}

export function installMoveq(table) {
  for (const dn of DATA_REGS) {
    for (let data = 0; data <= 0xff; data++) {
      const opcode = 0x7000 | (dn << 9) | data;
      const value = signExtend(data, 1) >>> 0;
      table[opcode] = (cpu) => {
        cpu.reg.setD(dn, value, 4);
        cpu.reg.setFlags(logicFlags(value, 4));
      };
    }
  }
}

export function installLea(table) {
  forEachSourceEA((mode, reg) => {
    if (mode === 0 || mode === 1 || mode === 3 || mode === 4 || (mode === 7 && reg === 4)) return; // control addressing only
    for (const an of DATA_REGS) {
      const opcode = 0x41c0 | (an << 9) | (mode << 3) | reg;
      table[opcode] = (cpu) => {
        const ea = resolveEA(cpu, mode, reg, 4);
        cpu.reg.setA(an, ea.address);
      };
    }
  });
}

export function installPea(table) {
  forEachSourceEA((mode, reg) => {
    if (mode === 0 || mode === 1 || mode === 3 || mode === 4 || (mode === 7 && reg === 4)) return;
    const opcode = 0x4840 | (mode << 3) | reg;
    table[opcode] = (cpu) => {
      const ea = resolveEA(cpu, mode, reg, 4);
      const sp = (cpu.reg.getA(7) - 4) >>> 0;
      cpu.bus.write32(sp, ea.address);
      cpu.reg.setA(7, sp);
    };
  });
}

export function installSwap(table) {
  for (const dn of DATA_REGS) {
    const opcode = 0x4840 | dn;
    // SWAP base 0x4840 with EA-mode fixed to Dn; no collision with PEA
    table[opcode] = (cpu) => {
      const v = cpu.reg.getD(dn, 4);
      const swapped = (((v << 16) | (v >>> 16)) >>> 0);
      cpu.reg.setD(dn, swapped, 4);
      cpu.reg.setFlags(logicFlags(swapped, 4));
    };
  }
}

export function installExt(table) {
  for (const dn of DATA_REGS) {
    // EXT.W: byte to word
    table[0x4880 | dn] = (cpu) => {
      const v = signExtend(cpu.reg.getD(dn, 1), 1) & 0xffff;
      cpu.reg.setD(dn, v, 2);
      cpu.reg.setFlags(logicFlags(v, 2));
    };
    // EXT.L: word to long
    table[0x48c0 | dn] = (cpu) => {
      const v = signExtend(cpu.reg.getD(dn, 2), 2) >>> 0;
      cpu.reg.setD(dn, v, 4);
      cpu.reg.setFlags(logicFlags(v, 4));
    };
  }
}

export function installClr(table) {
  const SIZES = [{ bits: 0, bytes: 1 }, { bits: 1, bytes: 2 }, { bits: 2, bytes: 4 }];
  for (const { bits, bytes: size } of SIZES) {
    // data-alterable: all alterable modes except An direct
    for (let mode = 0; mode <= 6; mode++) {
      if (mode === 1) continue;
      for (const reg of DATA_REGS) {
        const opcode = 0x4200 | (bits << 6) | (mode << 3) | reg;
        table[opcode] = (cpu) => {
          const dest = resolveEA(cpu, mode, reg, size);
          dest.write(0);
          cpu.reg.setFlags({ N: false, Z: true, V: false, C: false });
        };
      }
    }
    for (const reg of [0, 1]) {
      const opcode = 0x4200 | (bits << 6) | (7 << 3) | reg;
      table[opcode] = (cpu) => {
        const dest = resolveEA(cpu, 7, reg, size);
        dest.write(0);
        cpu.reg.setFlags({ N: false, Z: true, V: false, C: false });
      };
    }
  }
}

export function installExg(table) {
  const modeDD = 0b01000, modeAA = 0b01001, modeDA = 0b10001;
  for (const rx of DATA_REGS) {
    for (const ry of DATA_REGS) {
      table[0xc100 | (rx << 9) | (modeDD << 3) | ry] = (cpu) => {
        const a = cpu.reg.getD(rx, 4), b = cpu.reg.getD(ry, 4);
        cpu.reg.setD(rx, b, 4);
        cpu.reg.setD(ry, a, 4);
      };
      table[0xc100 | (rx << 9) | (modeAA << 3) | ry] = (cpu) => {
        const a = cpu.reg.getA(rx), b = cpu.reg.getA(ry);
        cpu.reg.setA(rx, b);
        cpu.reg.setA(ry, a);
      };
      table[0xc100 | (rx << 9) | (modeDA << 3) | ry] = (cpu) => {
        const a = cpu.reg.getD(rx, 4), b = cpu.reg.getA(ry);
        cpu.reg.setD(rx, b, 4);
        cpu.reg.setA(ry, a);
      };
    }
  }
}

export function installLink(table) {
  for (const an of DATA_REGS) {
    table[0x4e50 | an] = (cpu) => {
      const disp = signExtend(cpu.fetchWord(), 2);
      const sp0 = (cpu.reg.getA(7) - 4) >>> 0;
      cpu.bus.write32(sp0, cpu.reg.getA(an));
      cpu.reg.setA(7, sp0);
      cpu.reg.setA(an, sp0);
      cpu.reg.setA(7, (sp0 + disp) >>> 0);
    };
    table[0x4e58 | an] = (cpu) => {
      const addr = cpu.reg.getA(an);
      const val = cpu.bus.read32(addr);
      cpu.reg.setA(7, (addr + 4) >>> 0);
      cpu.reg.setA(an, val);
    };
  }
}

export function installMovep(table) {
  for (const dn of DATA_REGS) {
    for (const an of DATA_REGS) {
      for (const opmode of [4, 5, 6, 7]) {
        const opcode = 0x0008 | (dn << 9) | (opmode << 6) | an;
        const isLong = opmode === 5 || opmode === 7;
        const toMemory = opmode === 6 || opmode === 7;
        const n = isLong ? 4 : 2;
        table[opcode] = (cpu) => {
          const disp = signExtend(cpu.fetchWord(), 2);
          const addr = (cpu.reg.getA(an) + disp) >>> 0;
          if (toMemory) {
            const val = cpu.reg.getD(dn, 4);
            for (let i = 0; i < n; i++) {
              const shift = (n - 1 - i) * 8;
              cpu.bus.write8((addr + i * 2) >>> 0, (val >>> shift) & 0xff);
            }
          } else {
            let val = 0;
            for (let i = 0; i < n; i++) val = (val << 8) | cpu.bus.read8((addr + i * 2) >>> 0);
            if (isLong) cpu.reg.setD(dn, val >>> 0, 4);
            else cpu.reg.setD(dn, val & 0xffff, 2);
          }
        };
      }
    }
  }
}

export function installMovem(table) {
  const STORE_MODES = [2, 4, 5, 6]; // (An) -(An) (d16,An) (d8,An,Xn)
  const STORE_ABS = [0, 1]; // 7/0 abs.W, 7/1 abs.L
  const LOAD_MODES = [2, 3, 5, 6]; // (An) (An)+ (d16,An) (d8,An,Xn)
  const LOAD_MODE7 = [0, 1, 2, 3]; // abs.W abs.L (d16,PC) (d8,PC,Xn)

  const runStore = (cpu, mode, reg, sizeBytes) => {
    const mask = cpu.fetchWord();
    if (mode === 4) {
      // Predecrement: reversed mask order, pointer reg stores its original value
      const initialA = [];
      for (let i = 0; i < 8; i++) initialA[i] = cpu.reg.getA(i);
      let addr = cpu.reg.getA(reg);
      for (let bit = 0; bit < 16; bit++) {
        if (!((mask >>> bit) & 1)) continue;
        addr = (addr - sizeBytes) >>> 0;
        const val = bit < 8 ? initialA[7 - bit] : cpu.reg.getD(15 - bit, 4);
        if (sizeBytes === 2) cpu.bus.write16(addr, val & 0xffff);
        else cpu.bus.write32(addr, val >>> 0);
      }
      cpu.reg.setA(reg, addr);
      return;
    }
    const ea = resolveEA(cpu, mode, reg, 4);
    let addr = ea.address;
    for (let bit = 0; bit < 16; bit++) {
      if (!((mask >>> bit) & 1)) continue;
      const val = bit < 8 ? cpu.reg.getD(bit, 4) : cpu.reg.getA(bit - 8);
      if (sizeBytes === 2) cpu.bus.write16(addr, val & 0xffff);
      else cpu.bus.write32(addr, val >>> 0);
      addr = (addr + sizeBytes) >>> 0;
    }
  };

  const runLoad = (cpu, mode, reg, sizeBytes) => {
    const mask = cpu.fetchWord();
    const isPostInc = mode === 3;
    let addr = isPostInc ? cpu.reg.getA(reg) : resolveEA(cpu, mode, reg, 4).address;
    for (let bit = 0; bit < 16; bit++) {
      if (!((mask >>> bit) & 1)) continue;
      const raw = sizeBytes === 2 ? cpu.bus.read16(addr) : cpu.bus.read32(addr);
      const val = (sizeBytes === 2 ? signExtend(raw, 2) : (raw | 0)) >>> 0;
      if (bit < 8) cpu.reg.setD(bit, val, 4);
      else cpu.reg.setA(bit - 8, val);
      addr = (addr + sizeBytes) >>> 0;
    }
    if (isPostInc) cpu.reg.setA(reg, addr);
  };

  for (const sizeBit of [0, 1]) {
    const sizeBytes = sizeBit === 0 ? 2 : 4;
    for (const mode of STORE_MODES) {
      for (const reg of DATA_REGS) {
        table[0x4880 | (sizeBit << 6) | (mode << 3) | reg] = (cpu) => runStore(cpu, mode, reg, sizeBytes);
      }
    }
    for (const reg of STORE_ABS) {
      table[0x4880 | (sizeBit << 6) | (7 << 3) | reg] = (cpu) => runStore(cpu, 7, reg, sizeBytes);
    }
    for (const mode of LOAD_MODES) {
      for (const reg of DATA_REGS) {
        table[0x4c80 | (sizeBit << 6) | (mode << 3) | reg] = (cpu) => runLoad(cpu, mode, reg, sizeBytes);
      }
    }
    for (const reg of LOAD_MODE7) {
      table[0x4c80 | (sizeBit << 6) | (7 << 3) | reg] = (cpu) => runLoad(cpu, 7, reg, sizeBytes);
    }
  }
}

export { forEachSourceEA, forEachAlterableEA };
