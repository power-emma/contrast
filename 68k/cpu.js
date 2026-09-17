import { Registers, SR_S, SR_T } from './registers.js';
import { BusFault } from './bus.js';
import { buildOpcodeTable } from './decode/index.js';
import {
  CpuTrap,
  VEC_BUS_ERROR,
  VEC_ADDRESS_ERROR,
  VEC_ILLEGAL_INSTRUCTION,
  VEC_LINE_A,
  VEC_LINE_F,
} from './exceptions.js';

// The opcode table is pure/stateless (handlers close over nothing but
// their own bit-field constants), so it's built once and shared by every
// CPU instance.
let sharedTable = null;
function getTable() {
  if (!sharedTable) sharedTable = buildOpcodeTable();
  return sharedTable;
}

export class CPU {
  constructor(bus) {
    this.bus = bus;
    this.reg = new Registers();
    this.table = getTable();
    this.halted = false;
    this.haltReason = '';
    this.instructionCount = 0;
  }

  fetchWord() {
    const v = this.bus.read16(this.reg.pc);
    this.reg.pc = (this.reg.pc + 2) >>> 0;
    return v;
  }

  fetchLong() {
    const hi = this.fetchWord();
    const lo = this.fetchWord();
    return ((hi << 16) | lo) >>> 0;
  }

  // MC68000 reset exception: read the initial SSP from vector 0 and the
  // initial PC from vector 1. On this testbed those only exist behind
  // the bus's ROM overlay (see bus.js) since RAM starts zeroed.
  reset() {
    this.reg.reset();
    this.halted = false;
    this.haltReason = '';
    this.instructionCount = 0;
    try {
      const ssp = this.bus.read32(0);
      const pc = this.bus.read32(4);
      this.reg.a[7] = ssp >>> 0;
      this.reg.ssp = ssp >>> 0;
      this.reg.pc = pc >>> 0;
    } catch (e) {
      this.halted = true;
      this.haltReason = `reset vector fetch failed: ${e.message}`;
    }
  }

  // Execute a single instruction. Returns false once halted.
  step() {
    if (this.halted) return false;
    const startPC = this.reg.pc;
    try {
      const opcode = this.fetchWord();
      const topNibble = opcode >>> 12;
      // Line 1010 / 1111 emulator traps (used by classic Mac OS as the
      // toolbox dispatch mechanism) are their own vectors, not "illegal
      // instruction" — they're never in the main dispatch table.
      if (topNibble === 0xa) throw new CpuTrap(VEC_LINE_A, 'start');
      if (topNibble === 0xf) throw new CpuTrap(VEC_LINE_F, 'start');

      const handler = this.table[opcode];
      if (!handler) throw new CpuTrap(VEC_ILLEGAL_INSTRUCTION, 'start');
      handler(this, opcode);
      this.instructionCount++;
      return true;
    } catch (err) {
      if (err instanceof CpuTrap) {
        const pc = err.pcMode === 'start' ? startPC : this.reg.pc;
        this._takeException(err.vector, pc);
        return true;
      }
      if (err instanceof BusFault) {
        const vector = err.type === 'address' ? VEC_ADDRESS_ERROR : VEC_BUS_ERROR;
        this._takeException(vector, startPC);
        return true;
      }
      // Anything else is a bug in this emulator, not a modeled CPU
      // condition — stop cleanly instead of corrupting further state.
      this.halted = true;
      this.haltReason = `internal error: ${err.message}`;
      return false;
    }
  }

  // Run up to `count` instructions, stopping early if halted. Returns
  // the number actually executed — used to batch work per render frame.
  run(count) {
    let n = 0;
    while (n < count && !this.halted) {
      this.step();
      n++;
    }
    return n;
  }

  // Push the standard SR+PC exception frame, enter supervisor mode,
  // clear trace, and vector to the handler. Note: the real MC68000 also
  // pushes extra diagnostic words (instruction register, fault address,
  // access type) for bus/address errors ("group 0" frame); this testbed
  // uses the same simplified SR+PC frame for every exception type rather
  // than reproducing that exact 7-word layout.
  _takeException(vector, pc) {
    const regs = this.reg;
    const oldSR = regs.getSR();
    if (!regs.isSupervisor()) regs.setSR(oldSR | SR_S);
    regs.setSR(regs.getSR() & ~SR_T);
    try {
      let sp = regs.getA(7);
      sp = (sp - 4) >>> 0;
      this.bus.write32(sp, pc);
      sp = (sp - 2) >>> 0;
      this.bus.write16(sp, oldSR);
      regs.setA(7, sp);
      regs.pc = this.bus.read32((vector * 4) >>> 0) >>> 0;
    } catch (e) {
      this.halted = true;
      this.haltReason = `double fault taking vector ${vector}: ${e.message}`;
    }
  }

  statusLines() {
    const status = this.halted
      ? `status: halted — ${this.haltReason}`
      : `status: running (${this.instructionCount} instr executed)`;
    return this.reg.toLines([status]);
  }
}
