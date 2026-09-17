// Program control (Bcc/BSR/BRA, DBcc, Scc, JMP/JSR/RTS/RTE/RTR, CHK,
// TRAP/TRAPV, RESET/STOP/NOP/ILLEGAL) and system-register access
// (MOVE to/from SR, MOVE to CCR, MOVE USP, ANDI/ORI/EORI to CCR/SR).

import { resolveEA, signExtend } from '../addressing.js';
import {
  CpuTrap,
  VEC_CHK,
  VEC_TRAPV,
  VEC_TRAP_BASE,
  VEC_PRIVILEGE_VIOLATION,
  VEC_ILLEGAL_INSTRUCTION,
} from '../exceptions.js';

const DATA_REGS = [0, 1, 2, 3, 4, 5, 6, 7];

function evalCondition(cc, f) {
  switch (cc) {
    case 0x0: return true; // T
    case 0x1: return false; // F
    case 0x2: return !f.C && !f.Z; // HI
    case 0x3: return f.C || f.Z; // LS
    case 0x4: return !f.C; // CC
    case 0x5: return f.C; // CS
    case 0x6: return !f.Z; // NE
    case 0x7: return f.Z; // EQ
    case 0x8: return !f.V; // VC
    case 0x9: return f.V; // VS
    case 0xa: return !f.N; // PL
    case 0xb: return f.N; // MI
    case 0xc: return f.N === f.V; // GE
    case 0xd: return f.N !== f.V; // LT
    case 0xe: return !f.Z && f.N === f.V; // GT
    case 0xf: return f.Z || f.N !== f.V; // LE
    default: return false;
  }
}

function requireSupervisor(cpu) {
  if (!cpu.reg.isSupervisor()) throw new CpuTrap(VEC_PRIVILEGE_VIOLATION, 'start');
}

export function installBranches(table) {
  for (let cc = 0; cc <= 0xf; cc++) {
    for (let disp8 = 0; disp8 <= 0xff; disp8++) {
      const opcode = 0x6000 | (cc << 8) | disp8;
      table[opcode] = (cpu) => {
        const opcodeAddr = (cpu.reg.pc - 2) >>> 0;
        const disp = disp8 === 0 ? signExtend(cpu.fetchWord(), 2) : signExtend(disp8, 1);
        if (cc === 1) { // BSR
          const returnAddr = cpu.reg.pc;
          const sp = (cpu.reg.getA(7) - 4) >>> 0;
          cpu.bus.write32(sp, returnAddr);
          cpu.reg.setA(7, sp);
          cpu.reg.pc = (opcodeAddr + 2 + disp) >>> 0;
          return;
        }
        if (evalCondition(cc, cpu.reg.getFlags())) {
          cpu.reg.pc = (opcodeAddr + 2 + disp) >>> 0;
        }
      };
    }
  }
}

export function installDbcc(table) {
  for (let cc = 0; cc <= 0xf; cc++) {
    for (const dn of DATA_REGS) {
      const opcode = 0x50c8 | (cc << 8) | dn;
      table[opcode] = (cpu) => {
        const opcodeAddr = (cpu.reg.pc - 2) >>> 0;
        const disp = signExtend(cpu.fetchWord(), 2);
        if (evalCondition(cc, cpu.reg.getFlags())) return;
        const counter = (cpu.reg.getD(dn, 2) - 1) & 0xffff;
        cpu.reg.setD(dn, counter, 2);
        if (counter !== 0xffff) cpu.reg.pc = (opcodeAddr + 2 + disp) >>> 0;
      };
    }
  }
}

export function installScc(table) {
  const MODES = [0, 2, 3, 4, 5, 6];
  for (let cc = 0; cc <= 0xf; cc++) {
    for (const mode of MODES) {
      for (const reg of DATA_REGS) {
        table[0x50c0 | (cc << 8) | (mode << 3) | reg] = (cpu) => {
          const dest = resolveEA(cpu, mode, reg, 1);
          dest.write(evalCondition(cc, cpu.reg.getFlags()) ? 0xff : 0x00);
        };
      }
    }
    for (const reg of [0, 1]) {
      table[0x50c0 | (cc << 8) | (7 << 3) | reg] = (cpu) => {
        const dest = resolveEA(cpu, 7, reg, 1);
        dest.write(evalCondition(cc, cpu.reg.getFlags()) ? 0xff : 0x00);
      };
    }
  }
}

function forEachControlEA(fn) {
  for (const mode of [2, 5, 6]) for (const reg of DATA_REGS) fn(mode, reg);
  for (const reg of [0, 1, 2, 3]) fn(7, reg);
}

export function installJmpJsr(table) {
  forEachControlEA((mode, reg) => {
    table[0x4ec0 | (mode << 3) | reg] = (cpu) => {
      const ea = resolveEA(cpu, mode, reg, 4);
      cpu.reg.pc = ea.address;
    };
    table[0x4e80 | (mode << 3) | reg] = (cpu) => {
      const ea = resolveEA(cpu, mode, reg, 4);
      const returnAddr = cpu.reg.pc;
      const sp = (cpu.reg.getA(7) - 4) >>> 0;
      cpu.bus.write32(sp, returnAddr);
      cpu.reg.setA(7, sp);
      cpu.reg.pc = ea.address;
    };
  });
}

export function installReturns(table) {
  table[0x4e75] = (cpu) => { // RTS
    const sp = cpu.reg.getA(7);
    const addr = cpu.bus.read32(sp);
    cpu.reg.setA(7, (sp + 4) >>> 0);
    cpu.reg.pc = addr;
  };
  table[0x4e73] = (cpu) => { // RTE
    requireSupervisor(cpu);
    const sp = cpu.reg.getA(7);
    const sr = cpu.bus.read16(sp);
    const pc = cpu.bus.read32((sp + 2) >>> 0);
    cpu.reg.setA(7, (sp + 6) >>> 0);
    cpu.reg.setSR(sr);
    cpu.reg.pc = pc;
  };
  table[0x4e77] = (cpu) => { // RTR
    const sp = cpu.reg.getA(7);
    const ccr = cpu.bus.read16(sp) & 0x1f;
    const pc = cpu.bus.read32((sp + 2) >>> 0);
    cpu.reg.setA(7, (sp + 6) >>> 0);
    cpu.reg.setCCR(ccr);
    cpu.reg.pc = pc;
  };
}

export function installMisc(table) {
  table[0x4e71] = () => {}; // NOP
  table[0x4e70] = (cpu) => { requireSupervisor(cpu); }; // RESET (no external devices modeled)
  table[0x4e72] = (cpu) => { // STOP
    requireSupervisor(cpu);
    const sr = cpu.fetchWord();
    cpu.reg.setSR(sr);
    cpu.halted = true;
    cpu.haltReason = 'STOP executed (interrupts are not modeled)';
  };
  table[0x4afc] = () => { throw new CpuTrap(VEC_ILLEGAL_INSTRUCTION, 'start'); }; // ILLEGAL

  for (let v = 0; v <= 0xf; v++) {
    table[0x4e40 | v] = () => { throw new CpuTrap(VEC_TRAP_BASE + v, 'next'); }; // TRAP #v
  }
  table[0x4e76] = (cpu) => { // TRAPV
    if (cpu.reg.getFlags().V) throw new CpuTrap(VEC_TRAPV, 'next');
  };
}

export function installChk(table) {
  const MODES_DATA = [0, 2, 3, 4, 5, 6];
  for (const dn of DATA_REGS) {
    for (const mode of MODES_DATA) {
      for (const reg of DATA_REGS) {
        table[0x4180 | (dn << 9) | (mode << 3) | reg] = (cpu) => runChk(cpu, dn, mode, reg);
      }
    }
    for (const reg of [0, 1, 2, 3, 4]) {
      table[0x4180 | (dn << 9) | (7 << 3) | reg] = (cpu) => runChk(cpu, dn, 7, reg);
    }
  }
}

function runChk(cpu, dn, mode, reg) {
  const ea = resolveEA(cpu, mode, reg, 2);
  const bound = signExtend(ea.read(), 2);
  const val = cpu.reg.getDSigned(dn, 2);
  if (val < 0) {
    cpu.reg.setFlags({ N: true });
    throw new CpuTrap(VEC_CHK, 'next');
  }
  if (val > bound) {
    cpu.reg.setFlags({ N: false });
    throw new CpuTrap(VEC_CHK, 'next');
  }
}

export function installSrMoves(table) {
  const READ_MODES = [0, 2, 3, 4, 5, 6];
  const READ_MODE7 = [0, 1, 2, 3, 4];
  const ALTER_MODES = [0, 2, 3, 4, 5, 6];
  const ALTER_MODE7 = [0, 1];

  // MOVE <ea>,CCR
  for (const mode of READ_MODES) for (const reg of DATA_REGS) {
    table[0x44c0 | (mode << 3) | reg] = (cpu) => { cpu.reg.setCCR(resolveEA(cpu, mode, reg, 2).read() & 0x1f); };
  }
  for (const reg of READ_MODE7) {
    table[0x44c0 | (7 << 3) | reg] = (cpu) => { cpu.reg.setCCR(resolveEA(cpu, 7, reg, 2).read() & 0x1f); };
  }

  // MOVE <ea>,SR (privileged)
  for (const mode of READ_MODES) for (const reg of DATA_REGS) {
    table[0x46c0 | (mode << 3) | reg] = (cpu) => { requireSupervisor(cpu); cpu.reg.setSR(resolveEA(cpu, mode, reg, 2).read()); };
  }
  for (const reg of READ_MODE7) {
    table[0x46c0 | (7 << 3) | reg] = (cpu) => { requireSupervisor(cpu); cpu.reg.setSR(resolveEA(cpu, 7, reg, 2).read()); };
  }

  // MOVE SR,<ea> (not privileged on the plain MC68000)
  for (const mode of ALTER_MODES) for (const reg of DATA_REGS) {
    table[0x40c0 | (mode << 3) | reg] = (cpu) => { resolveEA(cpu, mode, reg, 2).write(cpu.reg.getSR()); };
  }
  for (const reg of ALTER_MODE7) {
    table[0x40c0 | (7 << 3) | reg] = (cpu) => { resolveEA(cpu, 7, reg, 2).write(cpu.reg.getSR()); };
  }

  // MOVE USP
  for (const an of DATA_REGS) {
    table[0x4e60 | an] = (cpu) => { requireSupervisor(cpu); cpu.reg.usp = cpu.reg.getA(an); };
    table[0x4e68 | an] = (cpu) => { requireSupervisor(cpu); cpu.reg.setA(an, cpu.reg.usp); };
  }

  // ANDI/ORI/EORI to CCR / SR
  table[0x023c] = (cpu) => { const imm = cpu.fetchWord() & 0xff; cpu.reg.setCCR(cpu.reg.getCCR() & imm); };
  table[0x003c] = (cpu) => { const imm = cpu.fetchWord() & 0xff; cpu.reg.setCCR(cpu.reg.getCCR() | imm); };
  table[0x0a3c] = (cpu) => { const imm = cpu.fetchWord() & 0xff; cpu.reg.setCCR(cpu.reg.getCCR() ^ imm); };
  table[0x027c] = (cpu) => { requireSupervisor(cpu); const imm = cpu.fetchWord(); cpu.reg.setSR(cpu.reg.getSR() & imm); };
  table[0x007c] = (cpu) => { requireSupervisor(cpu); const imm = cpu.fetchWord(); cpu.reg.setSR(cpu.reg.getSR() | imm); };
  table[0x0a7c] = (cpu) => { requireSupervisor(cpu); const imm = cpu.fetchWord(); cpu.reg.setSR(cpu.reg.getSR() ^ imm); };
}
