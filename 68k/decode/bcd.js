// ABCD, SBCD, NBCD packed-BCD byte arithmetic; Z is sticky, N and V left as-is
import { resolveEA } from '../addressing.js';

const DATA_REGS = [0, 1, 2, 3, 4, 5, 6, 7];

function bcdAdd(a, b, x) {
  let lo = (a & 0xf) + (b & 0xf) + x, carryLo = 0;
  if (lo > 9) { lo -= 10; carryLo = 1; }
  let hi = ((a >> 4) & 0xf) + ((b >> 4) & 0xf) + carryLo, carryOut = 0;
  if (hi > 9) { hi -= 10; carryOut = 1; }
  return { result: ((hi & 0xf) << 4) | (lo & 0xf), carry: carryOut === 1 };
}

function bcdSub(a, b, x) {
  let lo = (a & 0xf) - (b & 0xf) - x, borrowLo = 0;
  if (lo < 0) { lo += 10; borrowLo = 1; }
  let hi = ((a >> 4) & 0xf) - ((b >> 4) & 0xf) - borrowLo, borrowOut = 0;
  if (hi < 0) { hi += 10; borrowOut = 1; }
  return { result: ((hi & 0xf) << 4) | (lo & 0xf), carry: borrowOut === 1 };
}

function applyStickyFlags(cpu, result, carry) {
  cpu.reg.setFlags({ X: carry, C: carry, Z: result !== 0 ? false : undefined });
}

export function installAbcdSbcd(table) {
  for (const rx of DATA_REGS) {
    for (const ry of DATA_REGS) {
      table[0xc100 | (rx << 9) | ry] = (cpu) => { // ABCD Dy,Dx
        const x = cpu.reg.getFlags().X ? 1 : 0;
        const a = cpu.reg.getD(ry, 1), b = cpu.reg.getD(rx, 1);
        const { result, carry } = bcdAdd(b, a, x);
        cpu.reg.setD(rx, result, 1);
        applyStickyFlags(cpu, result, carry);
      };
      table[0xc108 | (rx << 9) | ry] = (cpu) => { // ABCD -(Ay),-(Ax)
        const x = cpu.reg.getFlags().X ? 1 : 0;
        const addrY = (cpu.reg.getA(ry) - 1) >>> 0; cpu.reg.setA(ry, addrY);
        const addrX = (cpu.reg.getA(rx) - 1) >>> 0; cpu.reg.setA(rx, addrX);
        const a = cpu.bus.read8(addrY), b = cpu.bus.read8(addrX);
        const { result, carry } = bcdAdd(b, a, x);
        cpu.bus.write8(addrX, result);
        applyStickyFlags(cpu, result, carry);
      };
      table[0x8100 | (rx << 9) | ry] = (cpu) => { // SBCD Dy,Dx
        const x = cpu.reg.getFlags().X ? 1 : 0;
        const a = cpu.reg.getD(ry, 1), b = cpu.reg.getD(rx, 1);
        const { result, carry } = bcdSub(b, a, x);
        cpu.reg.setD(rx, result, 1);
        applyStickyFlags(cpu, result, carry);
      };
      table[0x8108 | (rx << 9) | ry] = (cpu) => { // SBCD -(Ay),-(Ax)
        const x = cpu.reg.getFlags().X ? 1 : 0;
        const addrY = (cpu.reg.getA(ry) - 1) >>> 0; cpu.reg.setA(ry, addrY);
        const addrX = (cpu.reg.getA(rx) - 1) >>> 0; cpu.reg.setA(rx, addrX);
        const a = cpu.bus.read8(addrY), b = cpu.bus.read8(addrX);
        const { result, carry } = bcdSub(b, a, x);
        cpu.bus.write8(addrX, result);
        applyStickyFlags(cpu, result, carry);
      };
    }
  }
}

export function installNbcd(table) {
  const MODES = [0, 2, 3, 4, 5, 6];
  for (const mode of MODES) {
    for (const reg of DATA_REGS) {
      table[0x4800 | (mode << 3) | reg] = (cpu) => runNbcd(cpu, mode, reg);
    }
  }
  for (const reg of [0, 1]) {
    table[0x4800 | (7 << 3) | reg] = (cpu) => runNbcd(cpu, 7, reg);
  }
}

function runNbcd(cpu, mode, reg) {
  const ea = resolveEA(cpu, mode, reg, 1);
  const x = cpu.reg.getFlags().X ? 1 : 0;
  const v = ea.read();
  const { result, carry } = bcdSub(0, v, x);
  ea.write(result);
  applyStickyFlags(cpu, result, carry);
}
