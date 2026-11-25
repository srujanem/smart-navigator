/**
 * Pure TypeScript ISO/IEC 18004 QR Code Matrix Encoder (Versions 1..10, Byte Mode, ECC Level L).
 * Zero external dependencies, zero network calls, 100% offline & scannable by iOS / Android cameras.
 */

// Total codewords & ECC codewords per single block (Versions 1..10 at ECC Level L)
// Note: Versions 1..9 use 1 RS block at ECC-L; Version 10 uses 2 blocks of (68 data, 18 ecc) + 2 blocks of (69 data, 18 ecc)
const V_TOTAL_DATA_L: Record<number, { dataBytes: number; blocks: { data: number; ecc: number }[] }> = {
  1: { dataBytes: 19, blocks: [{ data: 19, ecc: 7 }] },
  2: { dataBytes: 34, blocks: [{ data: 34, ecc: 10 }] },
  3: { dataBytes: 55, blocks: [{ data: 55, ecc: 15 }] },
  4: { dataBytes: 80, blocks: [{ data: 80, ecc: 20 }] },
  5: { dataBytes: 108, blocks: [{ data: 108, ecc: 26 }] },
  6: { dataBytes: 136, blocks: [{ data: 136, ecc: 18 }, { data: 0, ecc: 0 }].filter((b) => b.data > 0) },
  7: { dataBytes: 156, blocks: [{ data: 78, ecc: 20 }, { data: 78, ecc: 20 }] },
  8: { dataBytes: 194, blocks: [{ data: 97, ecc: 24 }, { data: 97, ecc: 24 }] },
  9: { dataBytes: 232, blocks: [{ data: 116, ecc: 30 }, { data: 116, ecc: 30 }] },
  10: {
    dataBytes: 274,
    blocks: [
      { data: 68, ecc: 18 },
      { data: 68, ecc: 18 },
      { data: 69, ecc: 18 },
      { data: 69, ecc: 18 },
    ],
  },
};

// Fix Version 6 exact ECC-L block structure: 2 blocks of (68 data, 18 ecc)
V_TOTAL_DATA_L[6] = {
  dataBytes: 136,
  blocks: [
    { data: 68, ecc: 18 },
    { data: 68, ecc: 18 },
  ],
};

const ALIGNMENT_POS: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

// GF(256) log/exp tables with primitive polynomial 0x11d
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsRemainder(data: Uint8Array, eccLen: number): Uint8Array {
  const gen = rsGeneratorPoly(eccLen);
  const rem = new Uint8Array(eccLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[eccLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < eccLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

function appendBits(bits: number[], val: number, len: number): void {
  for (let i = len - 1; i >= 0; i--) {
    bits.push((val >>> i) & 1);
  }
}

function computeFormatBits(eccLevelBits: number, mask: number): number {
  const data = (eccLevelBits << 3) | mask;
  let rem = data << 10;
  for (let i = 14; i >= 10; i--) {
    if ((rem >>> i) & 1) {
      rem ^= 0x537 << (i - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function computeVersionBits(version: number): number {
  let rem = version << 12;
  for (let i = 17; i >= 12; i--) {
    if ((rem >>> i) & 1) {
      rem ^= 0x1f25 << (i - 12);
    }
  }
  return (version << 12) | rem;
}

export function encodeQrMatrix(text: string): boolean[][] {
  const utf8 = new TextEncoder().encode(text);
  let version = 1;
  while (version <= 10) {
    const cap = V_TOTAL_DATA_L[version].dataBytes - (version <= 9 ? 2 : 3);
    if (utf8.length <= cap) break;
    version++;
  }
  if (version > 10) {
    // Truncate gracefully if an unusually long URL is passed
    return encodeQrMatrix(text.slice(0, 260));
  }

  const spec = V_TOTAL_DATA_L[version];
  const bits: number[] = [];
  // Byte mode indicator = 0100
  appendBits(bits, 0b0100, 4);
  appendBits(bits, utf8.length, version <= 9 ? 8 : 16);
  for (const b of utf8) appendBits(bits, b, 8);

  const maxBits = spec.dataBytes * 8;
  appendBits(bits, 0, Math.min(4, maxBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const dataBytes = new Uint8Array(spec.dataBytes);
  for (let i = 0; i < bits.length / 8; i++) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i * 8 + j];
    dataBytes[i] = byte;
  }
  let padToggle = true;
  for (let i = bits.length / 8; i < spec.dataBytes; i++) {
    dataBytes[i] = padToggle ? 0xec : 0x11;
    padToggle = !padToggle;
  }

  // Split into RS blocks & interleave
  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  let offset = 0;
  for (const blk of spec.blocks) {
    const slice = dataBytes.slice(offset, offset + blk.data);
    offset += blk.data;
    dataBlocks.push(slice);
    eccBlocks.push(rsRemainder(slice, blk.ecc));
  }

  const finalCodewords: number[] = [];
  const maxDataLen = Math.max(...spec.blocks.map((b) => b.data));
  for (let i = 0; i < maxDataLen; i++) {
    for (const db of dataBlocks) {
      if (i < db.length) finalCodewords.push(db[i]);
    }
  }
  const eccLen = spec.blocks[0].ecc;
  for (let i = 0; i < eccLen; i++) {
    for (const eb of eccBlocks) {
      finalCodewords.push(eb[i]);
    }
  }

  const size = version * 4 + 17;
  const modules: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunc: boolean[][] = Array.from({ length: size }, () => Array(size).fill(false));

  const setFunc = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    modules[y][x] = dark;
    isFunc[y][x] = true;
  };

  const drawFinder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        setFunc(cx + dx, cy + dy, dist !== 2 && dist !== 4);
      }
    }
  };

  drawFinder(3, 3);
  drawFinder(size - 4, 3);
  drawFinder(3, size - 4);

  // Timing patterns
  for (let i = 0; i < size; i++) {
    if (!isFunc[6][i]) setFunc(i, 6, i % 2 === 0);
    if (!isFunc[i][6]) setFunc(6, i, i % 2 === 0);
  }

  // Alignment patterns
  const align = ALIGNMENT_POS[version];
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === align.length - 1) ||
        (i === align.length - 1 && j === 0)
      ) {
        continue;
      }
      const cx = align[i];
      const cy = align[j];
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          setFunc(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }

  // Reserve format info & dark module
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      if (!isFunc[8][i]) setFunc(i, 8, false);
      if (!isFunc[i][8]) setFunc(8, i, false);
    }
  }
  for (let i = 0; i < 8; i++) {
    if (!isFunc[8][size - 1 - i]) setFunc(size - 1 - i, 8, false);
    if (!isFunc[size - 1 - i][8]) setFunc(8, size - 1 - i, false);
  }
  setFunc(8, size - 8, true);

  if (version >= 7) {
    const vbits = computeVersionBits(version);
    for (let i = 0; i < 18; i++) {
      const bit = ((vbits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunc(b, a, bit);
      setFunc(a, b, bit);
    }
  }

  // Zigzag data placement
  let bitIdx = 0;
  const totalBits = finalCodewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!isFunc[y][x] && bitIdx < totalBits) {
          const byte = finalCodewords[bitIdx >>> 3];
          const bit = ((byte >>> (7 - (bitIdx & 7))) & 1) !== 0;
          modules[y][x] = bit;
          bitIdx++;
        }
      }
    }
  }

  // Apply Mask 0 ((x + y) % 2 === 0) & write format bits (ECC Level L = 01)
  const mask = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!isFunc[y][x] && (x + y) % 2 === 0) {
        modules[y][x] = !modules[y][x];
      }
    }
  }

  const fbits = computeFormatBits(0b01, mask);
  for (let i = 0; i <= 5; i++) setFunc(8, i, ((fbits >>> i) & 1) !== 0);
  setFunc(8, 7, ((fbits >>> 6) & 1) !== 0);
  setFunc(8, 8, ((fbits >>> 7) & 1) !== 0);
  setFunc(7, 8, ((fbits >>> 8) & 1) !== 0);
  for (let i = 9; i < 15; i++) setFunc(14 - i, 8, ((fbits >>> i) & 1) !== 0);

  for (let i = 0; i < 8; i++) setFunc(size - 1 - i, 8, ((fbits >>> i) & 1) !== 0);
  for (let i = 8; i < 15; i++) setFunc(8, size - 15 + i, ((fbits >>> i) & 1) !== 0);
  setFunc(8, size - 8, true);

  return modules;
}
