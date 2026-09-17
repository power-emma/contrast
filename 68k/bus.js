// Memory bus for the testbed's declared map (see memoryMap.jsx):
//   $000000-$1FFFFF  RAM (2MB, mirrored again at $200000-$3FFFFF)
//   $400000-$4FFFFF  ROM (64K, mirrored across the 1MB window)
//   $800000-$9FFFFF  SCC (read)
//   $A00000-$BFFFFF  SCC (write)
//   $C00000-$DFFFFF  IWM (disk controller)
//   $E80000-$EFFFFF  VIA
// SCC/IWM/VIA aren't implemented yet — they read as open bus ($FF) and
// ignore writes, so boot code that polls them will stall rather than
// crash. The MC68000 has 24 address pins, so every access is masked to
// 24 bits before decoding, matching real hardware.

export class BusFault extends Error {
  constructor(type, address, isWrite, size) {
    super(`${type} error at $${(address >>> 0).toString(16)}`);
    this.type = type; // 'address' | 'bus'
    this.address = address >>> 0;
    this.isWrite = isWrite;
    this.size = size;
  }
}

const ADDR_MASK = 0xffffff; // 24-bit bus
export const RAM_SIZE = 0x200000; // 2MB
const RAM_WINDOW = 0x400000; // 0..3FFFFF mirrors the 2MB RAM twice
const ROM_BASE = 0x400000;
const ROM_WINDOW_END = 0x500000;
const ROM_SIZE = 0x10000; // 64K
const SCC_READ_BASE = 0x800000, SCC_READ_END = 0xa00000;
const SCC_WRITE_BASE = 0xa00000, SCC_WRITE_END = 0xc00000;
const IWM_BASE = 0xc00000, IWM_END = 0xe00000;
const VIA_BASE = 0xe80000, VIA_END = 0xf00000;

// Classic compact-Mac convention: the main screen buffer sits just below
// the top of RAM (RAM top minus $5900), 512x342 @ 1bpp. Defined here (not
// just in runtime.js) so the memory controller's simulated video fetch
// address can reference the same location the actual video hardware reads.
export const SCREEN_BASE = RAM_SIZE - 0x5900;
export const SCREEN_BYTES = (512 / 8) * 342;
const SCREEN_ROW_BYTES = 512 / 8;

// RAM is divided into fixed-size blocks so the UI's memory-map panel can
// track "last written" per block (a heat-map) without rescanning all of
// RAM every frame.
export const RAM_BLOCK_SIZE = 0x4000; // 16KB/block
export const RAM_BLOCK_COUNT = RAM_SIZE / RAM_BLOCK_SIZE; // 128 blocks
const RAM_BLOCK_SHIFT = 14; // log2(RAM_BLOCK_SIZE)

// SCC/IWM/VIA are real peripherals clocked much slower than the 68000 and
// historically needed hardware-inserted wait states while the CPU
// synchronized to them (the VIA in particular runs off the ~783kHz E
// clock). Fixed approximations stand in for that here since this testbed
// doesn't model cycle-exact bus timing.
const SCC_WAIT_STATES = 4;
const IWM_WAIT_STATES = 4;
const VIA_WAIT_STATES = 5;

// The video generator and the CPU share the same RAM, so on real hardware
// the video circuitry periodically steals a memory cycle from the CPU
// (contended RAM). True timing depends on scanline phase; lacking a
// cycle-exact core, a fixed "1 in N" ratio stands in for that contention.
const VIDEO_STEAL_RATIO = 4;

export class Bus {
  constructor(romBytes) {
    this.ram = new Uint8Array(RAM_SIZE);
    this.rom = new Uint8Array(ROM_SIZE);
    if (romBytes) this.rom.set(romBytes.subarray(0, ROM_SIZE));
    // ROM overlay: on reset, the CPU must be able to fetch its initial
    // SSP/PC from $000000/$000004, which physically only exist in ROM.
    // Real 68000-based Macs do this with a hardware "overlay" latch that
    // shadows ROM at the bottom of the address space until software
    // switches it off (normally via the VIA). VIA isn't modeled here yet,
    // so overlay can only be cleared programmatically — it stays mapped
    // for the life of the run, which is a known simplification.
    this.overlay = true;
    this.stats = { sccReads: 0, sccWrites: 0, iwmReads: 0, iwmWrites: 0, viaReads: 0, viaWrites: 0 };

    // Memory controller state (see statusLines() / advanceFrame()).
    this.frame = 0;
    this.ramBlockWriteFrame = new Int32Array(RAM_BLOCK_COUNT).fill(-1);
    this.deviceWriteFrame = { sccWrite: -1, iwm: -1, via: -1 };
    this.waitStates = 0;
    this.contentionStalls = 0;
    this.ramAccessCount = 0;
    this.busOwner = 'cpu';
  }

  setOverlay(on) {
    this.overlay = on;
  }

  // Called once per rendered frame (see runtime.js's tick loop) so the
  // controller's refresh-cycle counter and write heat-map ages advance in
  // real time rather than per instruction.
  advanceFrame() {
    this.frame++;
  }

  // Where the video generator is currently reading from to paint the
  // screen. Real hardware sweeps this continuously in lockstep with the
  // pixel clock; this testbed only re-renders once per animation frame,
  // so it advances one scanline's worth of the buffer per frame instead.
  get videoFetchAddr() {
    const rows = SCREEN_BYTES / SCREEN_ROW_BYTES;
    const row = this.frame % rows;
    return SCREEN_BASE + row * SCREEN_ROW_BYTES;
  }

  // One shared RAM chip is contended between the CPU and the video
  // generator (see VIDEO_STEAL_RATIO above); call this for every actual
  // RAM-chip cycle (not ROM-overlay reads, which don't touch the shared
  // chip) to account for that.
  _ramCycle() {
    this.ramAccessCount++;
    if (this.ramAccessCount % VIDEO_STEAL_RATIO === 0) {
      this.contentionStalls++;
      this.busOwner = 'video';
    } else {
      this.busOwner = 'cpu';
    }
  }

  _markRamWrite(idx, size) {
    const first = idx >> RAM_BLOCK_SHIFT;
    const last = (idx + size - 1) >> RAM_BLOCK_SHIFT;
    for (let b = first; b <= last; b++) this.ramBlockWriteFrame[b] = this.frame;
  }

  statusLines() {
    const fmtAddr = (a) => `$${(a >>> 0).toString(16).padStart(6, '0').toUpperCase()}`;
    const owner = this.busOwner === 'video' ? 'VIDEO (stolen cycle)' : 'CPU';
    return [
      'MEMORY CONTROLLER',
      '-----------------------',
      ` bus owner          ${owner}`,
      ` refresh cycle       ${this.frame}`,
      ` video fetch addr    ${fmtAddr(this.videoFetchAddr)}`,
      ` wait states          ${this.waitStates}`,
      ` contention stalls    ${this.contentionStalls}`,
      '-----------------------',
      ` SCC  rd/wr   ${this.stats.sccReads}/${this.stats.sccWrites}`,
      ` IWM  rd/wr   ${this.stats.iwmReads}/${this.stats.iwmWrites}`,
      ` VIA  rd/wr   ${this.stats.viaReads}/${this.stats.viaWrites}`,
      '-----------------------',
      'status: live',
    ];
  }

  _checkAlign(addr, size, isWrite) {
    if (size > 1 && (addr & 1) !== 0) {
      throw new BusFault('address', addr, isWrite, size);
    }
  }

  read8(addr) {
    return this._read(addr, 1);
  }

  read16(addr) {
    this._checkAlign(addr, 2, false);
    return this._read(addr, 2);
  }

  read32(addr) {
    this._checkAlign(addr, 4, false);
    return this._read(addr, 4);
  }

  write8(addr, value) {
    this._write(addr, 1, value);
  }

  write16(addr, value) {
    this._checkAlign(addr, 2, true);
    this._write(addr, 2, value);
  }

  write32(addr, value) {
    this._checkAlign(addr, 4, true);
    this._write(addr, 4, value);
  }

  _read(addr, size) {
    addr = addr & ADDR_MASK;

    if (this.overlay && addr < RAM_WINDOW) {
      const romIdx = addr & (ROM_SIZE - 1);
      return this._readBytes(this.rom, romIdx, size);
    }
    if (addr < RAM_WINDOW) {
      this._ramCycle();
      return this._readBytes(this.ram, addr & (RAM_SIZE - 1), size);
    }
    if (addr >= ROM_BASE && addr < ROM_WINDOW_END) {
      return this._readBytes(this.rom, addr & (ROM_SIZE - 1), size);
    }
    if (addr >= SCC_READ_BASE && addr < SCC_READ_END) {
      this.stats.sccReads++;
      this.waitStates += SCC_WAIT_STATES;
      return size === 1 ? 0xff : size === 2 ? 0xffff : 0xffffffff;
    }
    if (addr >= IWM_BASE && addr < IWM_END) {
      this.stats.iwmReads++;
      this.waitStates += IWM_WAIT_STATES;
      return this._iwmReadValue(size);
    }
    if (addr >= VIA_BASE && addr < VIA_END) {
      this.stats.viaReads++;
      this.waitStates += VIA_WAIT_STATES;
      return size === 1 ? 0xff : size === 2 ? 0xffff : 0xffffffff;
    }
    // Unmapped / SCC-write-only region read back as open bus.
    return size === 1 ? 0xff : size === 2 ? 0xffff : 0xffffffff;
  }

  // Minimal IWM (disk controller) model: no drive is attached and the
  // chip is idle. This testbed doesn't decode the real 8-register
  // CA0-CA2/LSTRB handshake interface — it only needs to satisfy the ROM's
  // startup poll, which reads the status register and waits for the
  // "busy" bit (bit 5) to clear before falling through to its normal
  // no-disk-present handling. Reporting that bit permanently clear (with
  // everything else idle-high, matching real open-bus/pulled-up lines)
  // is enough for that without modeling drive state.
  _iwmReadValue(size) {
    const byte = 0xff & ~0x20; // 0xdf
    if (size === 1) return byte;
    if (size === 2) return (byte << 8) | byte;
    return (((byte << 24) | (byte << 16) | (byte << 8) | byte) >>> 0);
  }

  _write(addr, size, value) {
    addr = addr & ADDR_MASK;

    // Overlay only shadows reads — writes still land in real RAM so that
    // boot code populating low-memory vectors has somewhere to land.
    if (addr < RAM_WINDOW) {
      const idx = addr & (RAM_SIZE - 1);
      this._ramCycle();
      this._writeBytes(this.ram, idx, size, value);
      this._markRamWrite(idx, size);
      return;
    }
    if (addr >= ROM_BASE && addr < ROM_WINDOW_END) {
      return; // ROM is read-only
    }
    if (addr >= SCC_WRITE_BASE && addr < SCC_WRITE_END) {
      this.stats.sccWrites++;
      this.waitStates += SCC_WAIT_STATES;
      this.deviceWriteFrame.sccWrite = this.frame;
      return;
    }
    if (addr >= IWM_BASE && addr < IWM_END) {
      this.stats.iwmWrites++;
      this.waitStates += IWM_WAIT_STATES;
      this.deviceWriteFrame.iwm = this.frame;
      return;
    }
    if (addr >= VIA_BASE && addr < VIA_END) {
      this.stats.viaWrites++;
      this.waitStates += VIA_WAIT_STATES;
      this.deviceWriteFrame.via = this.frame;
      return;
    }
    // Unmapped write: no device present, ignored.
  }

  _readBytes(arr, idx, size) {
    if (size === 1) return arr[idx];
    if (size === 2) return ((arr[idx] << 8) | arr[idx + 1]) >>> 0;
    return (
      ((arr[idx] << 24) | (arr[idx + 1] << 16) | (arr[idx + 2] << 8) | arr[idx + 3]) >>> 0
    );
  }

  _writeBytes(arr, idx, size, value) {
    if (size === 1) {
      arr[idx] = value & 0xff;
      return;
    }
    if (size === 2) {
      arr[idx] = (value >>> 8) & 0xff;
      arr[idx + 1] = value & 0xff;
      return;
    }
    arr[idx] = (value >>> 24) & 0xff;
    arr[idx + 1] = (value >>> 16) & 0xff;
    arr[idx + 2] = (value >>> 8) & 0xff;
    arr[idx + 3] = value & 0xff;
  }
}
