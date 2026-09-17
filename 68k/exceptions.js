// Exception vector numbers (multiply by 4 for the vector table address),
// and a lightweight signal type instruction handlers throw to request
// that the CPU take an exception mid-execute().

export const VEC_BUS_ERROR = 2;
export const VEC_ADDRESS_ERROR = 3;
export const VEC_ILLEGAL_INSTRUCTION = 4;
export const VEC_ZERO_DIVIDE = 5;
export const VEC_CHK = 6;
export const VEC_TRAPV = 7;
export const VEC_PRIVILEGE_VIOLATION = 8;
export const VEC_TRACE = 9;
export const VEC_LINE_A = 10;
export const VEC_LINE_F = 11;
export const VEC_TRAP_BASE = 32; // TRAP #0..#15 -> vectors 32..47

export class CpuTrap extends Error {
  // pcMode: 'next' (default, PC after the trapping instruction — TRAP,
  // TRAPV, CHK, zero divide) or 'start' (PC of the trapping instruction
  // itself — illegal instruction, line-A/F, privilege violation).
  constructor(vector, pcMode = 'next') {
    super(`cpu trap vector ${vector}`);
    this.vector = vector;
    this.pcMode = pcMode;
  }
}
