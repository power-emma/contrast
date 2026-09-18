// Memory bus modeling a Macintosh 512K/512Ke address map (see memoryMap.jsx)
import { SonyDrive, TRACK_COUNT, byteToTrack } from './sony.js';

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
export const RAM_SIZE = 0x80000; // 512K (Mac 512K/512Ke)
const RAM_WINDOW = 0x400000; // 0..3FFFFF mirrors the 512K RAM repeatedly
// ROM overlay shadows a fixed 128K window so reset can fetch SSP/PC from ROM
const OVERLAY_WINDOW = 0x20000;
// While the overlay is on, RAM is also aliased at $600000; the boot RAM test runs there
const OVERLAY_RAM_BASE = 0x600000;
const OVERLAY_RAM_END = 0x800000;
const ROM_BASE = 0x400000;
const ROM_WINDOW_END = 0x420000; // 128K window, exactly fits the 128K ROM
const ROM_SIZE = 0x20000; // 128K
const SCC_READ_BASE = 0x800000, SCC_READ_END = 0xa00000;
const SCC_WRITE_BASE = 0xa00000, SCC_WRITE_END = 0xc00000;
const IWM_BASE = 0xc00000, IWM_END = 0xe00000;
const VIA_BASE = 0xe80000, VIA_END = 0xf00000;

// VIA registers are 512-byte-spaced; ORA/ORB and the shift register are modeled
const VIA_REG0_ADDR = 0xefe1fe;
const VIA_REG_ORB = 0;
const VIA_REG_ORA = 1;
const VIA_REG_SR = 10;
const VIA_REG_ACR = 11;
const VIA_REG_IFR = 13;
const VIA_REG_IER = 14;
const VIA_REG_ORA_NH = 15;
// ACR bits 4..2 select the shift register's mode; the ROM's keyboard driver
// leaves this in "shift in under CB1" between commands, which is also the
// idle state the keyboard uses to deliver an unsolicited key transition
const VIA_ACR_SR_MASK = 0x1c;
const VIA_ACR_SR_IN_CB1 = 0x0c;
const VIA_OVERLAY_BIT = 0x10;
// Port B bits 3..5: mouse switch and X/Y quadrature direction lines
const VIA_PB_SW = 0x08;
const VIA_PB_X2 = 0x10;
const VIA_PB_Y2 = 0x20;
// Port B bits 0..2 carry the Apple RTC chip's serial link (see _rtcUpdate)
const VIA_PB_RTC_DATA = 0x01;
const VIA_PB_RTC_CLK = 0x02;
const VIA_PB_RTC_ENABLE = 0x04;
// Whole seconds between the RTC's 1904 epoch and the Unix 1970 one
const RTC_EPOCH_OFFSET = 2082844800;
// IFR/IER bit 2 is the Shift Register, used for keyboard transfers
const VIA_SR_BIT = 0x04;
// IFR/IER bit 1 is CA1, wired to vertical blanking for the VBL interrupt
const VIA_CA1_BIT = 0x02;
// IFR bit 5 is Timer 2, latched on a fixed cadence for the Time Manager
const VIA_T2_BIT = 0x20;
const VIA_T2_REG_CL = 8;
const VIA_T2_REG_CH = 9;
const T2_INTERVAL = 2000; // instructions between synthetic T2 ticks

// Mouse quadrature X1/Y1 run to the SCC DCD inputs; ROM reads a 3-bit SAV cause code
const SCC_VECTOR_MASK = 0x0e; // bits 3..1
const SCC_CAUSE_CH_A_EXT_STATUS = 5;
const SCC_CAUSE_CH_B_EXT_STATUS = 1;
// WR0 command 010 is Reset Ext/Status Interrupts, the ack for this
const SCC_CMD_MASK = 0x38;
const SCC_CMD_RESET_EXT_STATUS = 0x10;

// M0110 keyboard protocol command bytes and responses (see _keyboardCommand)
const KBD_INQUIRY = 0x10;
const KBD_INSTANT = 0x14;
const KBD_MODEL = 0x16;
const KBD_TEST = 0x36;
const KBD_NULL = 0x7b;
const KBD_TEST_ACK = 0x7d;
// Bit 0 set (valid), bits 1..3 = model 1 (M0110, no keypad)
const KBD_MODEL_RESPONSE = 0x09;

// IWM soft switches: address bits 9..12 select a phase line, touching flips it
const IWM_Q6_OFF_NIBBLE = 12, IWM_Q6_ON_NIBBLE = 13;
const IWM_Q7_OFF_NIBBLE = 14, IWM_Q7_ON_NIBBLE = 15;
function iwmNibbleFor(addr) {
  return ((addr - IWM_BASE) >> 9) & 0xf;
}
function viaRegFor(addr) {
  return (((addr - VIA_REG0_ADDR) & 0xffffff) >> 9) & 0xf;
}

// Main screen buffer sits at RAM top minus $5900, 512x342 @ 1bpp
export const SCREEN_BASE = RAM_SIZE - 0x5900;
const MAC_SCREEN_W = 512;
const MAC_SCREEN_H = 342;
export const SCREEN_BYTES = (MAC_SCREEN_W / 8) * MAC_SCREEN_H;
const SCREEN_ROW_BYTES = MAC_SCREEN_W / 8;

// RAM split into fixed blocks so the memory-map panel can track last-written
export const RAM_BLOCK_SIZE = 0x1000; // 4KB/block
export const RAM_BLOCK_COUNT = RAM_SIZE / RAM_BLOCK_SIZE; // 128 blocks
const RAM_BLOCK_SHIFT = 12; // log2(RAM_BLOCK_SIZE)

// Fixed wait-state approximations for the slower SCC/IWM/VIA peripherals
const SCC_WAIT_STATES = 4;
const IWM_WAIT_STATES = 4;
const VIA_WAIT_STATES = 5;

// Video and CPU share RAM; a fixed 1-in-N ratio stands in for cycle contention
const VIDEO_STEAL_RATIO = 4;

export class Bus {
  constructor(romBytes, diskBytes, disk2Bytes) {
    this.ram = new Uint8Array(RAM_SIZE);
    this.rom = new Uint8Array(ROM_SIZE);
    if (romBytes) this.rom.set(romBytes.subarray(0, ROM_SIZE));
    // Two drives on the IWM bus: [0] internal (boot.dsk), [1] external (paint.dsk)
    this.drives = [
      diskBytes ? new SonyDrive(diskBytes) : null,
      disk2Bytes ? new SonyDrive(disk2Bytes) : null,
    ];
    // ROM overlay latch shadows ROM at low addresses until software clears it
    this.overlay = true;
    this.viaORA = 0xff; // idle-high default; bit4 set == overlay mapped
    this.viaIFR = 0x00; // interrupt flags (latched)
    this.viaIER = 0x00; // interrupt enables
    this.iwmQ6 = 0;
    this.iwmQ7 = 0;
    this.iwmMode = 0;
    // IWM phase/control lines addressing the Sony drive registers (see _iwmTouch)
    this.iwmCA0 = 0;
    this.iwmCA1 = 0;
    this.iwmCA2 = 0;
    this.iwmLSTRB = 0;
    this.iwmMotor = 0;
    this.iwmDriveSel = 0;
    this.t2Counter = 0; // synthetic VIA Timer 2 timebase (see pendingInterruptLevel)
    this.viaORB = 0xff; // idle-high default, same convention as viaORA
    this.viaSR = 0;
    this.viaACR = 0;

    // Real-time clock serial state machine (Apple RTC on Port B bits 0..2)
    this.rtcEnabled = false;      // chip selected (rTCEnable is active-low)
    this.rtcClockLine = 0;        // last rTCClock level, for edge detection
    this.rtcState = 'cmd';        // 'cmd' | 'read' | 'write' | 'idle'
    this.rtcShiftIn = 0;          // command / write-data bits shifted in
    this.rtcBitCount = 0;         // bits shifted in the current byte
    this.rtcCmd = 0;              // latched command byte
    this.rtcOutByte = 0;          // byte being clocked out on a read
    this.rtcOutIndex = 7;         // next bit (MSB-first) to present
    this.rtcDataBit = 1;          // current rTCData level the chip drives
    this.rtcWriteProtect = false; // set via the write-protect register
    this.rtcPram = new Uint8Array(256);

    // Mouse quadrature direction bits and button state (VIA Port B)
    this.mouseX2 = 1;
    this.mouseY2 = 1;
    this.mouseButtonDown = false;
    this.mouseDX = 0;
    this.mouseDY = 0;
    // Set by _stepMouse() when a quadrature edge awaits ROM acknowledgment
    this.sccIntPending = false;
    this.sccIntChannel = null;

    // Keyboard: raw M0110 bytes queued by keyEvent(), drained by ROM polling
    this.keyQueue = [];

    this.stats = { sccReads: 0, sccWrites: 0, iwmReads: 0, iwmWrites: 0, viaReads: 0, viaWrites: 0 };

    // Per-drive, per-track last read/write frame for the disk activity panel
    this.diskActivity = [0, 1].map(() => ({
      read: new Int32Array(TRACK_COUNT).fill(-1),
      write: new Int32Array(TRACK_COUNT).fill(-1),
    }));

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

  // The drive the IWM register file currently addresses (see iwmDriveSel)
  get disk() {
    return this.drives[this.iwmDriveSel] || null;
  }

  // Swap fresh media into a drive: rebuilds the Sony geometry from the image and
  // clears the drive's activity heat-map. `imageBytes` are raw 512-byte sectors;
  // `name` is the source filename, shown in the disk activity panel.
  insertDisk(driveIdx, imageBytes, name) {
    const idx = driveIdx >= 1 ? 1 : 0;
    this.drives[idx] = new SonyDrive(imageBytes);
    this.drives[idx].imageName = name || null;
    this.diskActivity[idx] = {
      read: new Int32Array(TRACK_COUNT).fill(-1),
      write: new Int32Array(TRACK_COUNT).fill(-1),
    };
  }

  // Remove the media from a drive (leaves the empty drive present on the bus).
  ejectDisk(driveIdx) {
    const idx = driveIdx >= 1 ? 1 : 0;
    this.drives[idx] = new SonyDrive(new Uint8Array(0));
    this.drives[idx].imageName = null;
    this.diskActivity[idx] = {
      read: new Int32Array(TRACK_COUNT).fill(-1),
      write: new Int32Array(TRACK_COUNT).fill(-1),
    };
  }

  // High-level disk read shortcut: intercept the .Sony _Read trap and copy from the image
  serviceTrap(cpu, opcode) {
    const trap = opcode & 0xf0ff;
    if (trap !== 0xa002 && trap !== 0xa003) return false; // _Read / _Write trap family
    const isWrite = trap === 0xa003;

    const a0 = cpu.reg.getA(0) >>> 0;
    let refNum = this._read(a0 + 0x18, 2) & 0xffff; // ioRefNum
    if (refNum & 0x8000) refNum -= 0x10000;
    if (refNum !== -5) return false; // not the .Sony disk driver

    // ioVRefNum holds the drive number: 1 = internal, 2 = external
    let drvNum = this._read(a0 + 0x16, 2) & 0xffff; // ioVRefNum (drive number)
    if (drvNum & 0x8000) drvNum -= 0x10000;
    const driveIdx = drvNum >= 2 ? 1 : 0;
    const drive = this.drives[driveIdx];
    if (!drive || !drive.image || drive.image.length === 0) return false;

    const buffer = this._read(a0 + 0x20, 4) >>> 0; // ioBuffer
    const count = this._read(a0 + 0x24, 4) >>> 0; // ioReqCount
    const pos = this._read(a0 + 0x2e, 4) >>> 0; // ioPosOffset (absolute byte offset)
    const img = drive.image;

    let act = 0;
    if (isWrite) {
      for (; act < count; act++) {
        const dst = pos + act;
        if (dst < img.length) img[dst] = this._read(buffer + act, 1) & 0xff;
      }
      drive.trackCache.clear(); // written bytes invalidate the cached GCR streams
    } else {
      for (; act < count; act++) {
        const src = pos + act;
        this._write(buffer + act, 1, src < img.length ? img[src] : 0);
      }
    }
    this._markDiskAccess(driveIdx, drive.sides, pos, act, isWrite);

    this._write(a0 + 0x28, 4, act); // ioActCount = bytes transferred
    this._write(a0 + 0x10, 2, 0); // ioResult = noErr
    this._write(a0 + 0x2e, 4, (pos + act) >>> 0); // advance ioPosOffset past the transfer
    cpu.reg.d[0] = 0; // trap glue returns the result code in D0...
    cpu.reg.setSR((cpu.reg.getSR() & ~0x000f) | 0x04); // ...and reflects it in CCR (Z set)
    return true;
  }

  // Stamp the current frame on every track a disk transfer touched
  _markDiskAccess(driveIdx, sides, byteOffset, byteCount, isWrite) {
    if (byteCount <= 0) return;
    const first = byteToTrack(byteOffset, sides);
    const last = byteToTrack(byteOffset + byteCount - 1, sides);
    const arr = isWrite ? this.diskActivity[driveIdx].write : this.diskActivity[driveIdx].read;
    for (let t = first; t <= last; t++) arr[t] = this.frame;
  }

  // Called once per rendered frame so refresh counters and heat-map ages advance
  advanceFrame() {
    this.frame++;
    // Latch VIA CA1 once per vertical retrace, as a real 6522 does
    this.viaIFR |= VIA_CA1_BIT;
  }

  // Checked between instructions; only the VIA (autovector level 1) is modeled
  pendingInterruptLevel() {
    // Mouse motion is a synthetic SCC interrupt at level 2, outranking the VIA
    this._stepMouse();
    if (this.sccIntPending) return 2;

    // Advance the synthetic Timer 2 timebase, latching its flag when due
    if (++this.t2Counter >= T2_INTERVAL) {
      this.t2Counter = 0;
      this.viaIFR |= VIA_T2_BIT;
    }
    return (this.viaIFR & this.viaIER & 0x7f) !== 0 ? 1 : 0;
  }

  // Advance pending mouse motion by at most one quadrature edge per call
  _stepMouse() {
    if (this.sccIntPending) return; // previous edge not yet acknowledged
    if (this.mouseDX !== 0) {
      const right = this.mouseDX > 0;
      this.mouseDX += right ? -1 : 1;
      // Flipped to match this ROM's observed cursor direction
      this.mouseX2 = right ? 0 : 1;
      this.sccIntPending = true;
      this.sccIntChannel = 'A';
    } else if (this.mouseDY !== 0) {
      const down = this.mouseDY > 0;
      this.mouseDY += down ? -1 : 1;
      this.mouseY2 = down ? 0 : 1;
      this.sccIntPending = true;
      this.sccIntChannel = 'B';
    }
  }

  // Queue relative mouse motion for _stepMouse() to drain (see videoscreen.jsx)
  mouseMove(dx, dy) {
    this.mouseDX += dx;
    this.mouseDY += dy;
  }

  // Absolute mouse positioning: poke the Mac's low-memory mouse globals
  setMouseLoc(x, y) {
    x = Math.max(0, Math.min(MAC_SCREEN_W - 1, x | 0));
    y = Math.max(0, Math.min(MAC_SCREEN_H - 1, y | 0));
    const pt = (((y & 0xffff) << 16) | (x & 0xffff)) >>> 0;
    this._write(0x0828, 4, pt); // MTemp
    this._write(0x082c, 4, pt); // RawMouse
    this._write(0x0830, 4, pt); // Mouse
    this._write(0x08ce, 1, 0xff); // CrsrNew: flag the move for the cursor task
    this._write(0x08cf, 1, 0xff); // CrsrCouple: keep the cursor coupled
  }

  setMouseButton(down) {
    this.mouseButtonDown = down;
  }

  // Queue raw M0110 bytes for the ROM's Inquiry/Instant commands to drain,
  // or straight to the shift register if the ROM is already idle-listening
  keyEvent(rawBytes) {
    for (const b of rawBytes) this.keyQueue.push(b);
    this._maybeDeliverKey();
  }

  // Mirrors the keyboard autonomously clocking in a byte: only possible
  // while the VIA's shift register is parked in "shift in under CB1" (the
  // ROM's idle state) and no unread reply is already sitting in SR.
  _maybeDeliverKey() {
    if ((this.viaACR & VIA_ACR_SR_MASK) !== VIA_ACR_SR_IN_CB1) return;
    if (this.viaIFR & VIA_SR_BIT) return;
    if (this.keyQueue.length === 0) return;
    this.viaSR = this.keyQueue.shift();
    this.viaIFR |= VIA_SR_BIT;
  }

  // Answer each keyboard command byte immediately with the response in vSR
  _keyboardCommand(cmd) {
    switch (cmd) {
      case KBD_INQUIRY:
      case KBD_INSTANT:
        return this.keyQueue.length ? this.keyQueue.shift() : KBD_NULL;
      case KBD_MODEL:
        return KBD_MODEL_RESPONSE;
      case KBD_TEST:
        return KBD_TEST_ACK;
      default:
        return KBD_NULL;
    }
  }

  // Where the video generator is currently reading to paint the screen
  get videoFetchAddr() {
    const rows = SCREEN_BYTES / SCREEN_ROW_BYTES;
    const row = this.frame % rows;
    return SCREEN_BASE + row * SCREEN_ROW_BYTES;
  }

  // One shared RAM chip contended between CPU and video (see VIDEO_STEAL_RATIO)
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

    if (this.overlay && addr < OVERLAY_WINDOW) {
      const romIdx = addr & (ROM_SIZE - 1);
      return this._readBytes(this.rom, romIdx, size);
    }
    if (this.overlay && addr >= OVERLAY_RAM_BASE && addr < OVERLAY_RAM_END) {
      this._ramCycle();
      return this._readBytes(this.ram, addr & (RAM_SIZE - 1), size);
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
      // Open bus except for the SAV cause code the mouse handler decodes from bits 3..1
      let byte = 0xff;
      if (this.sccIntPending) {
        const cause = this.sccIntChannel === 'A' ? SCC_CAUSE_CH_A_EXT_STATUS : SCC_CAUSE_CH_B_EXT_STATUS;
        byte = (byte & ~SCC_VECTOR_MASK) | (cause << 1);
      }
      return size === 1 ? byte : size === 2 ? ((byte << 8) | byte) : (((byte << 24) | (byte << 16) | (byte << 8) | byte) >>> 0);
    }
    if (addr >= IWM_BASE && addr < IWM_END) {
      this.stats.iwmReads++;
      this.waitStates += IWM_WAIT_STATES;
      this._iwmTouch(addr);
      return this._iwmReadValue(size);
    }
    if (addr >= VIA_BASE && addr < VIA_END) {
      this.stats.viaReads++;
      this.waitStates += VIA_WAIT_STATES;
      const reg = viaRegFor(addr);
      // Reading the Timer 2 low-order counter clears its interrupt flag.
      if (reg === VIA_T2_REG_CL) this.viaIFR &= ~VIA_T2_BIT;
      if (reg === VIA_REG_ORA || reg === VIA_REG_ORA_NH) {
        return size === 1 ? this.viaORA
          : size === 2 ? ((this.viaORA << 8) | this.viaORA)
          : (((this.viaORA << 24) | (this.viaORA << 16) | (this.viaORA << 8) | this.viaORA) >>> 0);
      }
      if (reg === VIA_REG_ORB) {
        let b = this.viaORB;
        b = this.mouseButtonDown ? (b & ~VIA_PB_SW) : (b | VIA_PB_SW);
        b = this.mouseX2 ? (b | VIA_PB_X2) : (b & ~VIA_PB_X2);
        b = this.mouseY2 ? (b | VIA_PB_Y2) : (b & ~VIA_PB_Y2);
        // While clocking a byte out the RTC drives rTCData; otherwise bit 0 echoes writes
        if (this.rtcEnabled && this.rtcState === 'read') {
          b = this.rtcDataBit ? (b | VIA_PB_RTC_DATA) : (b & ~VIA_PB_RTC_DATA);
        }
        b &= 0xff;
        return size === 1 ? b : size === 2 ? ((b << 8) | b) : (((b << 24) | (b << 16) | (b << 8) | b) >>> 0);
      }
      if (reg === VIA_REG_SR) {
        const b = this.viaSR;
        this.viaIFR &= ~VIA_SR_BIT; // reading vSR clears the shift-complete flag
        return size === 1 ? b : size === 2 ? ((b << 8) | b) : (((b << 24) | (b << 16) | (b << 8) | b) >>> 0);
      }
      if (reg === VIA_REG_ACR) {
        const b = this.viaACR;
        return size === 1 ? b : size === 2 ? ((b << 8) | b) : (((b << 24) | (b << 16) | (b << 8) | b) >>> 0);
      }
      if (reg === VIA_REG_IFR) {
        // Bit 7 mirrors "any enabled flag active", matching real 6522 reads.
        const byte = (this.viaIFR & 0x7f) | (this.pendingInterruptLevel() ? 0x80 : 0);
        return size === 1 ? byte : size === 2 ? ((byte << 8) | byte) : (((byte << 24) | (byte << 16) | (byte << 8) | byte) >>> 0);
      }
      if (reg === VIA_REG_IER) {
        const byte = (this.viaIER & 0x7f) | 0x80; // bit 7 always reads back as 1
        return size === 1 ? byte : size === 2 ? ((byte << 8) | byte) : (((byte << 24) | (byte << 16) | (byte << 8) | byte) >>> 0);
      }
      return size === 1 ? 0xff : size === 2 ? 0xffff : 0xffffffff;
    }
    // Unmapped / SCC-write-only region read back as open bus.
    return size === 1 ? 0xff : size === 2 ? 0xffff : 0xffffffff;
  }

  // Update Q6/Q7 for any IWM-range touch (see IWM_Q6_OFF_NIBBLE)
  _iwmTouch(addr) {
    const nibble = iwmNibbleFor(addr);
    switch (nibble) {
      case 0: this.iwmCA0 = 0; break;
      case 1: this.iwmCA0 = 1; break;
      case 2: this.iwmCA1 = 0; break;
      case 3: this.iwmCA1 = 1; break;
      case 4: this.iwmCA2 = 0; break;
      case 5: this.iwmCA2 = 1; break;
      case 6: this._iwmStrobe(0); break; // LSTRB low
      case 7: this._iwmStrobe(1); break; // LSTRB high, execute on rising edge
      case 8: this.iwmMotor = 0; if (this.disk) this.disk.motor = false; break;
      case 9: this.iwmMotor = 1; if (this.disk) this.disk.motor = true; break;
      case 10: this.iwmDriveSel = 0; break;
      case 11: this.iwmDriveSel = 1; break;
      case IWM_Q6_OFF_NIBBLE: this.iwmQ6 = 0; break;
      case IWM_Q6_ON_NIBBLE: this.iwmQ6 = 1; break;
      case IWM_Q7_OFF_NIBBLE: this.iwmQ7 = 0; break;
      case IWM_Q7_ON_NIBBLE: this.iwmQ7 = 1; break;
      default: break;
    }
  }

  // Disk SEL line is VIA Port A bit 5, doubling as head-select and a register line
  _selLine() {
    return (this.viaORA >> 5) & 1;
  }

  // LSTRB strobes a command selected by CA2/CA1/CA0 with SEL as data
  _iwmStrobe(level) {
    const prev = this.iwmLSTRB;
    this.iwmLSTRB = level;
    if (!level || prev || !this.disk) return; // act only on the rising edge
    // CA0/CA1 select the command; CA2 encodes direction and motor
    const c0 = this.iwmCA0, c1 = this.iwmCA1, c2 = this.iwmCA2;
    if (c0 && !c1) {
      this.disk.step();
    } else if (c1 && !c0) {
      this.disk.motor = c2 === 0;
      this.iwmMotor = this.disk.motor ? 1 : 0;
    } else if (!c0 && !c1) {
      this.disk.stepDir = c2; // 1 => step toward track 0
    }
  }

  // Minimal IWM model routed by Q6/Q7: data, status, handshake, mode registers
  _iwmReadValue(size) {
    let byte;
    if (!this.iwmQ6 && !this.iwmQ7) {
      // Data register: next assembled GCR byte, always bit 7 set
      if (this.disk) {
        this.disk.setSide(this._selLine());
        byte = this.disk.readNibble();
        this.diskActivity[this.iwmDriveSel].read[this.disk.headTrack] = this.frame;
      } else {
        byte = 0xff;
      }
    } else if (this.iwmQ6 && !this.iwmQ7) {
      // Status register: bit 7 = SENSE, bit 5 = motor, low bits mirror mode
      const sense = this.disk
        ? this.disk.senseBit(this.iwmCA2, this.iwmCA1, this.iwmCA0, this._selLine())
        : 0;
      byte = (sense ? 0x80 : 0) | (this.iwmMotor ? 0x20 : 0) | (this.iwmMode & 0x1f);
    } else if (!this.iwmQ6 && this.iwmQ7) {
      byte = 0xc0; // write handshake: ready, no underrun
    } else {
      byte = this.iwmMode; // mode register read-back
    }
    if (size === 1) return byte;
    if (size === 2) return (byte << 8) | byte;
    return (((byte << 24) | (byte << 16) | (byte << 8) | byte) >>> 0);
  }

  _write(addr, size, value) {
    addr = addr & ADDR_MASK;

    // Overlay shadows reads only; writes still land in real RAM
    if (addr < RAM_WINDOW || (this.overlay && addr >= OVERLAY_RAM_BASE && addr < OVERLAY_RAM_END)) {
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
      // Only a real Reset Ext/Status command (bits 5..3 = 010) acknowledges the interrupt
      if (this.sccIntPending && (value & SCC_CMD_MASK) === SCC_CMD_RESET_EXT_STATUS) {
        this.sccIntPending = false;
        this.sccIntChannel = null;
      }
      return;
    }
    if (addr >= IWM_BASE && addr < IWM_END) {
      this.stats.iwmWrites++;
      this.waitStates += IWM_WAIT_STATES;
      this.deviceWriteFrame.iwm = this.frame;
      this._iwmTouch(addr);
      if (this.iwmQ6 && this.iwmQ7) this.iwmMode = value & 0xff; // mode register
      return;
    }
    if (addr >= VIA_BASE && addr < VIA_END) {
      this.stats.viaWrites++;
      this.waitStates += VIA_WAIT_STATES;
      this.deviceWriteFrame.via = this.frame;
      const reg = viaRegFor(addr);
      // Writing the Timer 2 high-order counter reloads T2 and clears its flag.
      if (reg === VIA_T2_REG_CH) this.viaIFR &= ~VIA_T2_BIT;
      if (reg === VIA_REG_ORA || reg === VIA_REG_ORA_NH) {
        this.viaORA = value & 0xff;
        this.setOverlay((this.viaORA & VIA_OVERLAY_BIT) !== 0);
      } else if (reg === VIA_REG_ORB) {
        this.viaORB = value & 0xff;
        this._rtcUpdate(this.viaORB); // Port B bits 0..2 drive the RTC
      } else if (reg === VIA_REG_SR) {
        this.viaSR = this._keyboardCommand(value & 0xff);
        this.viaIFR |= VIA_SR_BIT;
      } else if (reg === VIA_REG_ACR) {
        this.viaACR = value & 0xff;
        // The ROM leaves the shift register parked in "shift in" mode
        // between commands, exactly like the keyboard's own idle state.
        // Real hardware lets the keyboard clock a key transition in
        // unprompted whenever the bus is free like this; mirror that here
        // instead of only ever answering a byte the CPU explicitly asked for.
        this._maybeDeliverKey();
      } else if (reg === VIA_REG_IFR) {
        // Real 6522: writing a 1 to an IFR bit clears that flag.
        this.viaIFR &= ~(value & 0x7f);
      } else if (reg === VIA_REG_IER) {
        // Real 6522: bit 7 of the value selects set vs clear for bits 0..6
        if (value & 0x80) this.viaIER |= (value & 0x7f);
        else this.viaIER &= ~(value & 0x7f);
      }
      return;
    }
    // Unmapped write: no device present, ignored.
  }

  // RTC counts seconds since 1 Jan 1904 in local time
  _rtcSeconds() {
    const utcSecs = Math.floor(Date.now() / 1000);
    const offsetSecs = new Date().getTimezoneOffset() * 60; // local = UTC minus offset
    return (utcSecs - offsetSecs + RTC_EPOCH_OFFSET) >>> 0;
  }

  // Called on every Port B write; runs the RTC's serial shift register
  _rtcUpdate(portB) {
    const enabled = (portB & VIA_PB_RTC_ENABLE) === 0;
    const clock = (portB & VIA_PB_RTC_CLK) !== 0 ? 1 : 0;
    const dataIn = portB & VIA_PB_RTC_DATA ? 1 : 0;

    if (!enabled || !this.rtcEnabled) {
      // Deselected or a new selection: restart the transfer, ignore this edge
      this.rtcEnabled = enabled;
      this.rtcState = 'cmd';
      this.rtcShiftIn = 0;
      this.rtcBitCount = 0;
      this.rtcClockLine = clock;
      return;
    }

    const rising = clock === 1 && this.rtcClockLine === 0;
    const falling = clock === 0 && this.rtcClockLine === 1;
    this.rtcClockLine = clock;

    if (this.rtcState === 'cmd') {
      // Command / write-data bits are latched into the chip on rising edges.
      if (rising) {
        this.rtcShiftIn = ((this.rtcShiftIn << 1) | dataIn) & 0xff;
        if (++this.rtcBitCount === 8) this._rtcDecode(this.rtcShiftIn);
      }
    } else if (this.rtcState === 'write') {
      if (rising) {
        this.rtcShiftIn = ((this.rtcShiftIn << 1) | dataIn) & 0xff;
        if (++this.rtcBitCount === 8) {
          this._rtcApply(this.rtcCmd, this.rtcShiftIn);
          this.rtcState = 'idle';
        }
      }
    } else if (this.rtcState === 'read') {
      // The chip shifts each output bit onto rTCData on the falling edge, MSB first
      if (falling && this.rtcOutIndex >= 0) {
        this.rtcDataBit = (this.rtcOutByte >> this.rtcOutIndex) & 1;
        this.rtcOutIndex--;
      }
    }
  }

  _rtcDecode(cmd) {
    this.rtcCmd = cmd;
    this.rtcBitCount = 0;
    this.rtcShiftIn = 0;
    if ((cmd & 0x80) !== 0) { // bit 7 set = read
      this.rtcOutByte = this._rtcReadRegister(cmd);
      this.rtcOutIndex = 7;
      this.rtcDataBit = (this.rtcOutByte >> 7) & 1;
      this.rtcState = 'read';
    } else {
      this.rtcState = 'write';
    }
  }

  // Command bits 6..0 select the register; clock bytes read live from the host
  _rtcReadRegister(cmd) {
    switch (cmd & 0x7f) {
      case 0x01: return this._rtcSeconds() & 0xff;
      case 0x05: return (this._rtcSeconds() >>> 8) & 0xff;
      case 0x09: return (this._rtcSeconds() >>> 16) & 0xff;
      case 0x0d: return (this._rtcSeconds() >>> 24) & 0xff;
      default: return this.rtcPram[this._rtcPramAddr(cmd)];
    }
  }

  _rtcApply(cmd, value) {
    const r = cmd & 0x7f;
    if (r === 0x35) { this.rtcWriteProtect = (value & 0x80) !== 0; return; } // write-protect reg
    if (this.rtcWriteProtect) return; // every other register is now locked
    if (r === 0x31) return; // test register: no observable effect modeled
    // The host clock is authoritative, so accept but discard clock writes.
    if (r === 0x01 || r === 0x05 || r === 0x09 || r === 0x0d) return;
    this.rtcPram[this._rtcPramAddr(cmd)] = value & 0xff;
  }

  // Map a PRAM command to a stable byte index
  _rtcPramAddr(cmd) {
    const r = cmd & 0x7f;
    if ((r & 0x43) === 0x41) return 0x10 + ((r >> 2) & 0x0f); // 16-byte block
    return (r >> 2) & 0x0f; // 4-byte clock-group block / fallback
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
