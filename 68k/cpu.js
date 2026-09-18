import { Registers, SR_S, SR_T, SR_I } from './registers.js';
import { BusFault } from './bus.js';
import { buildOpcodeTable } from './decode/index.js';
import {
  CpuTrap,
  VEC_BUS_ERROR,
  VEC_ADDRESS_ERROR,
  VEC_ILLEGAL_INSTRUCTION,
  VEC_LINE_A,
  VEC_LINE_F,
  VEC_AUTOVECTOR_BASE,
} from './exceptions.js';

// Opcode table is stateless, built once and shared by every CPU instance
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
    // Set by STOP: resumes on a high-priority interrupt, unlike halted
    this.stopped = false;
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

  // Reset exception: read initial SSP from vector 0 and PC from vector 1
  reset() {
    this.reg.reset();
    this.halted = false;
    this.haltReason = '';
    this.instructionCount = 0;
    this.stopped = false;
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

  // Only the VIA's autovector level 1 (VBL) is modeled
  _maybeInterrupt() {
    const level = this.bus.pendingInterruptLevel ? this.bus.pendingInterruptLevel() : 0;
    if (level === 0) return false;
    const mask = (this.reg.getSR() & SR_I) >>> 8;
    if (level <= mask) return false;
    this._takeException(VEC_AUTOVECTOR_BASE + level, this.reg.pc);
    this.reg.sr = (this.reg.sr & ~SR_I) | (level << 8);
    return true;
  }

  // Execute a single instruction. Returns false once halted.
  step() {
    if (this.halted) return false;
    if (this.stopped) {
      if (this._maybeInterrupt()) this.stopped = false;
      return true; // idle tick while stopped, whether or not it woke up
    }
    const startPC = this.reg.pc;
    try {
      this._maybeInterrupt();
      const opcode = this.fetchWord();
      const topNibble = opcode >>> 12;
      // Line 1010/1111 emulator traps are their own vectors, not illegal instruction
      if (topNibble === 0xa) {
        // Let the bus service the trap itself; if it does, continue as if it ran
        if (this.bus.serviceTrap && this.bus.serviceTrap(this, opcode)) {
          this.instructionCount++;
          return true;
        }
        throw new CpuTrap(VEC_LINE_A, 'start');
      }
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
      // Anything else is an emulator bug, stop cleanly instead of corrupting state
      this.halted = true;
      this.haltReason = `internal error: ${err.message}`;
      return false;
    }
  }

  // Run up to count instructions, stopping early if halted. Returns count run
  run(count) {
    let n = 0;
    while (n < count && !this.halted) {
      this.step();
      n++;
    }
    return n;
  }

  // Push the SR+PC exception frame, enter supervisor mode, clear trace, vector
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
      ? `status: halted - ${this.haltReason}`
      : this.stopped
        ? 'status: stopped (waiting for interrupt)'
        : `status: running (${this.instructionCount} instr executed)`;
    return this.reg.toLines([status]);
  }
}
