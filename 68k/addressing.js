// Effective-address resolution for the 68000's addressing modes
function signExtend(value, size) {
  if (size === 1) return (value << 24) >> 24;
  if (size === 2) return (value << 16) >> 16;
  return value | 0;
}

function readBrief(cpu) {
  const ext = cpu.fetchWord();
  const isAddr = (ext & 0x8000) !== 0;
  const regNum = (ext >>> 12) & 7;
  const isLong = (ext & 0x0800) !== 0;
  const disp8 = signExtend(ext & 0xff, 1);
  const regVal = isAddr ? cpu.reg.getA(regNum) : cpu.reg.getD(regNum, 4);
  const indexVal = isLong ? (regVal | 0) : signExtend(regVal & 0xffff, 2);
  return disp8 + indexVal;
}

// Read-only helper: fetch the operand at an EA descriptor's location.
function makeMemoryHandle(cpu, address, size) {
  return {
    isRegister: false,
    address,
    read() {
      if (size === 1) return cpu.bus.read8(address);
      if (size === 2) return cpu.bus.read16(address);
      return cpu.bus.read32(address);
    },
    write(value) {
      if (size === 1) cpu.bus.write8(address, value);
      else if (size === 2) cpu.bus.write16(address, value);
      else cpu.bus.write32(address, value);
    },
  };
}

// Resolve a 6-bit EA field (mode:3 reg:3) to a read/write handle
export function resolveEA(cpu, mode, reg, size) {
  const regs = cpu.reg;

  switch (mode) {
    case 0: // Dn
      return {
        isRegister: true,
        isDataRegister: true,
        address: null,
        read: () => regs.getD(reg, size),
        write: (v) => regs.setD(reg, v, size),
      };

    case 1: // An
      return {
        isRegister: true,
        isAddrRegister: true,
        address: null,
        read: () => (size === 4 ? regs.getA(reg) : regs.getA(reg) & (size === 1 ? 0xff : 0xffff)),
        write: (v) => regs.setA(reg, size === 4 ? v : signExtend(v, size)),
      };

    case 2: { // (An)
      const addr = regs.getA(reg);
      return makeMemoryHandle(cpu, addr, size);
    }

    case 3: { // (An)+
      const addr = regs.getA(reg);
      const step = reg === 7 ? Math.max(size, 2) : size;
      regs.setA(reg, addr + step);
      return makeMemoryHandle(cpu, addr, size);
    }

    case 4: { // -(An)
      const step = reg === 7 ? Math.max(size, 2) : size;
      const addr = (regs.getA(reg) - step) >>> 0;
      regs.setA(reg, addr);
      return makeMemoryHandle(cpu, addr, size);
    }

    case 5: { // (d16,An)
      const disp = signExtend(cpu.fetchWord(), 2);
      const addr = (regs.getA(reg) + disp) >>> 0;
      return makeMemoryHandle(cpu, addr, size);
    }

    case 6: { // (d8,An,Xn)
      const base = regs.getA(reg);
      const addr = (base + readBrief(cpu)) >>> 0;
      return makeMemoryHandle(cpu, addr, size);
    }

    case 7:
      switch (reg) {
        case 0: { // (xxx).W
          const addr = signExtend(cpu.fetchWord(), 2) >>> 0;
          return makeMemoryHandle(cpu, addr, size);
        }
        case 1: { // (xxx).L
          const addr = cpu.fetchLong() >>> 0;
          return makeMemoryHandle(cpu, addr, size);
        }
        case 2: { // (d16,PC)
          const base = regs.pc;
          const disp = signExtend(cpu.fetchWord(), 2);
          const addr = (base + disp) >>> 0;
          return makeMemoryHandle(cpu, addr, size);
        }
        case 3: { // (d8,PC,Xn)
          const base = regs.pc;
          const addr = (base + readBrief(cpu)) >>> 0;
          return makeMemoryHandle(cpu, addr, size);
        }
        case 4: { // #imm
          if (size === 4) {
            const v = cpu.fetchLong();
            return { isRegister: false, isImmediate: true, address: null, read: () => v >>> 0, write: () => {} };
          }
          // Byte/word immediates still occupy a full 16-bit extension word.
          const v = cpu.fetchWord() & (size === 1 ? 0xff : 0xffff);
          return { isRegister: false, isImmediate: true, address: null, read: () => v, write: () => {} };
        }
        default:
          throw new Error(`illegal EA mode 7/${reg}`);
      }

    default:
      throw new Error(`illegal EA mode ${mode}`);
  }
}

export { signExtend };
