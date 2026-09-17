// Shared arithmetic/flag helpers used across the instruction groups.
// All sizes are handled uniformly: values are treated as unsigned
// `size`-byte quantities and results are wrapped back into that width.

export const SIZE_MASK = { 1: 0xff, 2: 0xffff, 4: 0xffffffff };

export function wrap(sum, size) {
  return size === 4 ? (sum >>> 0) : (sum & SIZE_MASK[size]);
}

export function signBit(value, size) {
  return (value >>> (size * 8 - 1)) & 1;
}

export function nz(result, size) {
  return { N: signBit(result, size) === 1, Z: (result & SIZE_MASK[size]) === 0 };
}

// a + b (+x for ADDX). Returns { result, N, Z, V, C, X }.
export function addFlags(a, b, size, x = 0) {
  const mask = SIZE_MASK[size];
  const ua = a & mask, ub = b & mask;
  const sum = ua + ub + (x & 1);
  const result = wrap(sum, size);
  const carry = sum > mask;
  const sa = signBit(ua, size), sb = signBit(ub, size), sr = signBit(result, size);
  const overflow = sa === sb && sr !== sa;
  return { result, N: sr === 1, Z: result === 0, V: overflow, C: carry, X: carry };
}

// a - b (-x for SUBX). Returns { result, N, Z, V, C, X }.
export function subFlags(a, b, size, x = 0) {
  const mask = SIZE_MASK[size];
  const ua = a & mask, ub = b & mask;
  const diff = ua - ub - (x & 1);
  const result = wrap(diff, size);
  const borrow = diff < 0;
  const sa = signBit(ua, size), sb = signBit(ub, size), sr = signBit(result, size);
  const overflow = sa !== sb && sr !== sa;
  return { result, N: sr === 1, Z: result === 0, V: overflow, C: borrow, X: borrow };
}

// Logical ops (AND/OR/EOR/NOT/MOVE/TST): C and V always cleared, X unaffected.
export function logicFlags(result, size) {
  const { N, Z } = nz(result, size);
  return { N, Z, V: false, C: false };
}
