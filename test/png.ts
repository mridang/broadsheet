import { expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** The width and height a PNG file declares in its IHDR header chunk. */
export function pngSize(file: string): { width: number; height: number } {
  const bytes = readFileSync(file);
  // 8-byte signature, then the IHDR chunk: 4 length, 4 type, 4 width, 4 height.
  expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The data of every IDAT chunk of a PNG file, joined in order. */
function imageData(bytes: Buffer): Buffer {
  const parts: Buffer[] = [];
  // Chunks follow the 8-byte signature: 4 length, 4 type, data, 4 checksum.
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    if (bytes.toString('ascii', at + 4, at + 8) === 'IDAT') {
      parts.push(bytes.subarray(at + 8, at + 8 + length));
    }
    at += 12 + length;
  }
  return Buffer.concat(parts);
}

/** What PNG's Paeth filter predicts from the byte left, above and above-left. */
function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/**
 * Whether every pixel of a PNG file is fully opaque (a file may carry an alpha
 * channel and still have no transparent pixel, as the home-screen icon does).
 * Reads 8-bit RGB and RGBA files that are not interlaced, which is what the
 * app's icons are, and fails on anything else rather than guess.
 */
export function pngIsOpaque(file: string): boolean {
  const bytes = readFileSync(file);
  const [depth, colorType, , , interlace] = bytes.subarray(24, 29);
  if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
    throw new Error('Only 8-bit RGB and RGBA PNG files, not interlaced.');
  }
  if (colorType === 2) {
    return true;
  }
  const { width, height } = pngSize(file);
  const raw = inflateSync(imageData(bytes));
  const stride = width * 4;
  let above = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const start = y * (stride + 1);
    const filter = raw[start];
    const row = Buffer.from(raw.subarray(start + 1, start + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? (row[i - 4] ?? 0) : 0;
      const up = above[i] ?? 0;
      const upLeft = i >= 4 ? (above[i - 4] ?? 0) : 0;
      const predicted =
        filter === 1
          ? left
          : filter === 2
            ? up
            : filter === 3
              ? (left + up) >> 1
              : filter === 4
                ? paeth(left, up, upLeft)
                : 0;
      row[i] = ((row[i] ?? 0) + predicted) & 255;
      if (i % 4 === 3 && row[i] !== 255) {
        return false;
      }
    }
    above = row;
  }
  return true;
}
