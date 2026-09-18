// Simplest possible floppy model: reads hand back bytes in a loop, not a real IWM
export class Disk {
  constructor(bytes) {
    this.bytes = bytes;
    this.pos = 0;
  }

  readByte() {
    if (this.bytes.length === 0) return 0;
    const b = this.bytes[this.pos];
    this.pos = (this.pos + 1) % this.bytes.length;
    return b;
  }
}
