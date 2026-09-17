import {
  installMove, installMoveq, installLea, installPea, installSwap, installExt,
  installClr, installExg, installLink, installMovep, installMovem,
} from './dataMovement.js';
import {
  installBranches, installDbcc, installScc, installJmpJsr, installReturns,
  installMisc, installChk, installSrMoves,
} from './control.js';
import { installBitOpsDynamic, installBitOpsStatic, installTas } from './bitops.js';
import { installAbcdSbcd, installNbcd } from './bcd.js';
import { installAnd, installOr, installAndiOriEori, installNot, installTst } from './logic.js';
import {
  installAdd, installSub, installAddSubQuick, installImmediateArith,
  installAddxSubx, installNegNegx, installMulDiv,
} from './arithmetic.js';
import { installCmp, installEorCmpm } from './compareGroup.js';
import { installShiftRegister, installShiftMemory } from './shiftRotate.js';

// Builds the full 65536-entry MC68000 opcode dispatch table. Unfilled
// slots (reserved/undefined opcodes) stay `null`, which CPU.step()
// treats as an illegal-instruction exception — line-A ($Axxx) and
// line-F ($Fxxx) traps are handled directly in cpu.js before this table
// is even consulted, since they're not "illegal instruction" (vector 4)
// but their own dedicated vectors.
export function buildOpcodeTable() {
  const table = new Array(0x10000).fill(null);

  installMove(table);
  installMoveq(table);
  installLea(table);
  installPea(table);
  installSwap(table);
  installExt(table);
  installClr(table);
  installExg(table);
  installLink(table);
  installMovep(table);
  installMovem(table);

  installBranches(table);
  installDbcc(table);
  installScc(table);
  installJmpJsr(table);
  installReturns(table);
  installMisc(table);
  installChk(table);
  installSrMoves(table);

  installBitOpsDynamic(table);
  installBitOpsStatic(table);
  installTas(table);

  installAbcdSbcd(table);
  installNbcd(table);

  installAnd(table);
  installOr(table);
  installAndiOriEori(table);
  installNot(table);
  installTst(table);

  installAdd(table);
  installSub(table);
  installAddSubQuick(table);
  installImmediateArith(table);
  installAddxSubx(table);
  installNegNegx(table);
  installMulDiv(table);

  installCmp(table);
  installEorCmpm(table);

  installShiftRegister(table);
  installShiftMemory(table);

  return table;
}
