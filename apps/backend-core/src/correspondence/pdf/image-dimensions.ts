/** خواندن ابعاد تصویر از سربرگ فایل (بدون رمزگشایی کامل) — برای رد «بمب پیکسلی» پیش از رسیدن به Chromium. */
export const MAX_IMAGE_PIXELS = 25_000_000;
export const MAX_IMAGE_SIDE = 8000;

export type Dimensions = { w: number; h: number };

export function readPngSize(b: Buffer): Dimensions | null {
  // امضا(8) + طول(4) + 'IHDR'(4) + w(4) + h(4)
  if (b.length < 24 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

export function readJpegSize(b: Buffer): Dimensions | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    let marker = b[i + 1];
    while (marker === 0xff && i + 2 < b.length) { i++; marker = b[i + 1]; }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    // SOF0..SOF15 به‌جز DHT(c4)، JPG(c8)، DAC(cc)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

export function readWebpSize(b: Buffer): Dimensions | null {
  if (b.length < 30 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WEBP') return null;
  const kind = b.toString('latin1', 12, 16);
  if (kind === 'VP8 ') {
    // frame tag(3) + start code 9d 01 2a + w(2) + h(2) در offset 20
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  }
  if (kind === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const bits = b.readUInt32LE(21);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (kind === 'VP8X') {
    return { w: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1, h: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1 };
  }
  return null;
}

export function readImageSize(type: 'png' | 'jpeg' | 'webp', b: Buffer): Dimensions | null {
  return type === 'png' ? readPngSize(b) : type === 'jpeg' ? readJpegSize(b) : readWebpSize(b);
}

export function dimensionsAcceptable(d: Dimensions | null): boolean {
  return !!d && d.w > 0 && d.h > 0 && d.w <= MAX_IMAGE_SIDE && d.h <= MAX_IMAGE_SIDE && d.w * d.h <= MAX_IMAGE_PIXELS;
}
