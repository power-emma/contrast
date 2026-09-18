// Sony 800K GCR floppy model, feeding the ROM driver an encoded nibble stream

// 6-bit value to disk byte; only these 64 values appear in encoded data
const DISKBYTES = [
  0x96, 0x97, 0x9a, 0x9b, 0x9d, 0x9e, 0x9f, 0xa6,
  0xa7, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb2, 0xb3,
  0xb4, 0xb5, 0xb6, 0xb7, 0xb9, 0xba, 0xbb, 0xbc,
  0xbd, 0xbe, 0xbf, 0xcb, 0xcd, 0xce, 0xcf, 0xd3,
  0xd6, 0xd7, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde,
  0xdf, 0xe5, 0xe6, 0xe7, 0xe9, 0xea, 0xeb, 0xec,
  0xed, 0xee, 0xef, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6,
  0xf7, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe, 0xff,
];

// Format byte baked into each address field: 0x22 = 800K DS, 0x02 = 400K SS
const FORMAT_DS = 0x22;
const FORMAT_SS = 0x02;
const SECTOR_SIZE = 512;
const TAG_SIZE = 12; // raw .dsk images omit tags; we synthesize zeros

// Variable-speed zones: outer tracks hold more sectors (12/11/10/9/8)
function sectorsPerTrack(track) {
  return 12 - (track >> 4);
}

// First logical block of a track, summing all sides of earlier tracks
function trackStartBlock(track, sides) {
  let b = 0;
  for (let t = 0; t < track; t++) b += sides * sectorsPerTrack(t);
  return b;
}

export const TRACK_COUNT = 80;

// Map an absolute image byte offset to the track that holds it
export function byteToTrack(byteOffset, sides) {
  const block = Math.floor(byteOffset / SECTOR_SIZE);
  let b = 0;
  for (let t = 0; t < TRACK_COUNT; t++) {
    b += sides * sectorsPerTrack(t);
    if (block < b) return t;
  }
  return TRACK_COUNT - 1;
}

// Apple 3.5" 6-and-2 nibblize of one 524-byte sector into 699 nibbles plus checksum
function nibblize(inp) {
  const b1 = new Uint8Array(175);
  const b2 = new Uint8Array(175);
  const b3 = new Uint8Array(175);
  let i = 0;
  let j = 0;
  let c1 = 0;
  let c2 = 0;
  let c3 = 0;
  let val;
  for (;;) {
    c1 = (c1 & 0xff) << 1;
    if (c1 & 0x100) c1++;

    val = inp[i++];
    c3 += val;
    if (c1 & 0x100) {
      c3++;
      c1 &= 0xff;
    }
    b1[j] = (val ^ c1) & 0xff;

    val = inp[i++];
    c2 += val;
    if (c3 > 0xff) {
      c2++;
      c3 &= 0xff;
    }
    b2[j] = (val ^ c3) & 0xff;

    if (i === 524) break;

    val = inp[i++];
    c1 += val;
    if (c2 > 0xff) {
      c1++;
      c2 &= 0xff;
    }
    b3[j] = (val ^ c2) & 0xff;
    j++;
  }
  const c4 = ((c1 & 0xc0) >> 6) | ((c2 & 0xc0) >> 4) | ((c3 & 0xc0) >> 2);
  b3[174] = 0;

  const nib = new Uint8Array(699);
  let k = 0;
  for (i = 0; i <= 174; i++) {
    const w1 = b1[i] & 0x3f;
    const w2 = b2[i] & 0x3f;
    const w3 = b3[i] & 0x3f;
    const w4 = ((b1[i] & 0xc0) >> 2) | ((b2[i] & 0xc0) >> 4) | ((b3[i] & 0xc0) >> 6);
    nib[k++] = w4;
    nib[k++] = w1;
    nib[k++] = w2;
    if (i !== 174) nib[k++] = w3;
  }
  return { nib, csum: [c1 & 0x3f, c2 & 0x3f, c3 & 0x3f, c4 & 0x3f] };
}

// Sync/gap length in whole $FF bytes before a field
const GAP_ADDR = 40;
const GAP_DATA = 6;
const GAP_TAIL = 4;

// Build the encoded nibble stream for one cylinder, both heads back to back
function buildTrack(image, track, sides, formatByte) {
  const ns = sectorsPerTrack(track);
  const startBlock = trackStartBlock(track, sides);
  const out = [];
  const push = (b) => out.push(b & 0xff);
  const gap = (n) => {
    for (let g = 0; g < n; g++) push(0xff);
  };

  for (let side = 0; side < sides; side++) {
    const sideByte = (side ? 0x20 : 0x00) | (track & 0x40 ? 0x01 : 0x00);
    for (let sector = 0; sector < ns; sector++) {
      const block = startBlock + side * ns + sector;
      const base = block * SECTOR_SIZE;

      // 524-byte sector = 12 zero tag bytes then 512 data bytes.
      const sec = new Uint8Array(TAG_SIZE + SECTOR_SIZE);
      for (let d = 0; d < SECTOR_SIZE; d++) sec[TAG_SIZE + d] = image[base + d] | 0;
      const { nib, csum } = nibblize(sec);

      // Address field
      gap(GAP_ADDR);
      push(0xd5); push(0xaa); push(0x96); // address mark
      const sum = (track ^ sector ^ sideByte ^ formatByte) & 0x3f;
      push(DISKBYTES[track & 0x3f]);
      push(DISKBYTES[sector]);
      push(DISKBYTES[sideByte]);
      push(DISKBYTES[formatByte]);
      push(DISKBYTES[sum]);
      push(0xde); push(0xaa); // epilogue (bit-slip marks)

      // Data field
      gap(GAP_DATA);
      push(0xd5); push(0xaa); push(0xad); // data mark
      push(DISKBYTES[sector]); // "spare"/sector byte
      for (let n = 0; n < nib.length; n++) push(DISKBYTES[nib[n]]);
      for (let c = 3; c >= 0; c--) push(DISKBYTES[csum[c]]);
      push(0xde); push(0xaa); // epilogue
      gap(GAP_TAIL);
    }
  }
  return Uint8Array.from(out);
}

export class SonyDrive {
  constructor(imageBytes) {
    this.image = imageBytes || new Uint8Array(0);
    // Pick geometry and format byte from the image size
    this.hasDisk = this.image.length >= 409600;
    this.sides = this.image.length >= 819200 ? 2 : 1;
    this.formatByte = this.sides === 2 ? FORMAT_DS : FORMAT_SS;
    this.trackCache = new Map(); // key track to Uint8Array (all sides)

    // Drive state driven by the IWM control lines (see bus.js).
    this.headTrack = 0; // 0..79
    this.side = 0; // SEL line state (used only for sense addressing)
    this.motor = false;
    this.stepDir = 0; // latched step direction
    this.tach = 0; // toggles to fake tachometer pulses
    this.pos = 0; // read cursor within current cylinder stream
    this.curTrack = -1;
  }

  _stream() {
    if (this.headTrack !== this.curTrack) {
      // Keep a continuous rotational cursor; the media never stops spinning
      this.curTrack = this.headTrack;
    }
    let s = this.trackCache.get(this.headTrack);
    if (!s) {
      s = this.hasDisk
        ? buildTrack(this.image, this.headTrack, this.sides, this.formatByte)
        : new Uint8Array([0xff]);
      this.trackCache.set(this.headTrack, s);
    }
    return s;
  }

  // One assembled GCR byte off the rotating media, always bit 7 set
  readNibble() {
    const s = this._stream();
    if (s.length === 0) return 0xff;
    if (this.pos >= s.length) this.pos = 0;
    const b = s[this.pos];
    this.pos = (this.pos + 1) % s.length;
    return b;
  }

  // SEL records the head for sense addressing only, not the read cursor
  setSide(side) {
    this.side = side & 1;
  }

  step() {
    // stepDir latched from SEL: 0 toward higher tracks, 1 toward track 0
    if (this.stepDir) this.headTrack = Math.max(0, this.headTrack - 1);
    else this.headTrack = Math.min(79, this.headTrack + 1);
  }

  // RD line value for the register addressed by {CA2,CA1,CA0,SEL}
  senseBit(ca2, ca1, ca0, sel) {
    const key = (ca2 << 3) | (ca1 << 2) | (ca0 << 1) | sel;
    switch (key) {
      case 0x0: return this.stepDir; // DIRTN readback
      case 0x1: return this.hasDisk ? 0 : 1; // CSTIN: 0 = disk in place
      case 0x2: return 1; // STEP: 1 = step complete (we finish instantly)
      case 0x3: return 0; // WRTPRT: 0 = write-protected (boot read-only)
      case 0x4: return this.motor ? 0 : 1; // MOTORON: 0 = motor running
      case 0x5: return this.headTrack === 0 ? 0 : 1; // TK0: 0 = at track 0
      case 0x7: // TACH: clean rotation-pulse edges, bit 6 flips every 64 reads
        return (this.tach++ >> 6) & 1;
      case 0xc: return this.motor ? 0 : 1; // motor-status alias
      case 0xd: return 0; // READY: 0 = up to speed / ready to read
      // RDDATA0/1 (head select), SWITCHED, SUPERDRIVE, DRVIN, etc.: benign.
      default: return 0;
    }
  }
}
